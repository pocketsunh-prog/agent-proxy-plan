/**
 * providers.ts
 * -----------------------------------------------------------------------------
 * Server-side provider adapters. Ported from the legacy js/api.js, but instead
 * of a browser CORS proxy these run in the Next.js `api/chat` route and call
 * the provider APIs directly (no CORS issue server-side). API keys are read
 * from the ProviderConfig table and never reach the browser.
 *
 * Each adapter returns a normalized:
 *   { content, usage: {input, output, total}, cost: {inputCost, outputCost, totalCost} }
 * -----------------------------------------------------------------------------
 */
import { prisma } from "@/lib/prisma";
import { computeCost, estimateTokens, type CostBreakdown } from "@/lib/tokenizer";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  content: string;
  usage: { input: number; output: number; total: number };
  cost: CostBreakdown;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

/** Map a ModelPricing.provider string to a ProviderConfig id. */
function providerId(provider: string): string {
  return provider.toLowerCase();
}

/** Common fields resolved for both streaming and non-streaming calls. */
interface ResolvedChat {
  model: Awaited<ReturnType<typeof prisma.modelPricing.findUnique>> & {};
  provider: Awaited<ReturnType<typeof prisma.providerConfig.findUnique>> & {};
  pricing: { input: number; output: number };
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  isAnthropic: boolean;
  isMiniMax: boolean;
}

/**
 * Load the model + provider config from the DB and build the request headers
 * and body. Shared by the streaming and non-streaming adapters. `stream` is
 * threaded into the request body so upstream providers respond with an SSE
 * stream when we want one.
 */
async function resolveChat(
  modelId: string,
  messages: ChatMessage[],
  options: ChatOptions,
  stream: boolean
): Promise<ResolvedChat> {
  const model = await prisma.modelPricing.findUnique({ where: { id: modelId } });
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  if (!model.enabled) throw new Error(`Model disabled: ${modelId}`);

  const provider = await prisma.providerConfig.findUnique({
    where: { id: providerId(model.provider) },
  });
  if (!provider) throw new Error(`No provider config for ${model.provider}`);
  if (!provider.enabled) throw new Error(`Provider disabled: ${model.provider}`);
  if (!provider.apiKey) {
    throw new Error(
      `No API key configured for ${model.provider} (set it in the admin area)`
    );
  }

  const pricing = {
    input: Number(model.inputPrice),
    output: Number(model.outputPrice),
  };
  const url = provider.baseUrl.replace(/\/+$/, "") + provider.chatPath;
  const isAnthropic = provider.id === "anthropic";
  const isMiniMax = provider.id === "minimax";

  const { temperature = 0.7, maxTokens = 1024 } = options;

  // Providers speak different wire formats. Build request headers + body per
  // provider, then parse each response back into our normalized shape.
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: Record<string, unknown>;

  if (isAnthropic) {
    // Anthropic Messages API: `system` is a top-level field, not a message
    // role, and auth uses the x-api-key header.
    const systemMsgs = messages.filter((m) => m.role === "system");
    const chatMsgs = messages.filter((m) => m.role !== "system");
    body = {
      model: model.id,
      messages: chatMsgs,
      max_tokens: maxTokens,
      temperature,
      stream,
    };
    if (systemMsgs.length) {
      body.system = systemMsgs.map((m) => m.content).join("\n\n");
    }
    headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    // OpenAI-compatible (DeepSeek, LongCat, OpenAI, ...) plus MiniMax.
    body = { model: model.id, messages, temperature, stream };
    // MiniMax uses tokens_to_generate; OpenAI-compatible providers use max_tokens.
    if (isMiniMax) body.tokens_to_generate = maxTokens;
    else body.max_tokens = maxTokens;
    headers["Authorization"] = "Bearer " + provider.apiKey;
  }

  return { model, provider, pricing, url, headers, body, isAnthropic, isMiniMax };
}

/**
 * Run a chat completion for a model id. Loads the model pricing and its
 * provider config from the DB, dispatches to the right adapter, and returns a
 * normalized result with usage + cost.
 */
export async function chatComplete(
  modelId: string,
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResult> {
  const { model, pricing, url, headers, body, isAnthropic, isMiniMax } =
    await resolveChat(modelId, messages, options, false);

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${model.provider} API ${res.status}: ${err}`);
  }

  const data = await res.json();
  const usage = data.usage || {};

  let content: string;
  let inputTokens: number;
  let outputTokens: number;

  if (isAnthropic) {
    // Anthropic: content is an array of blocks; usage.{input,output}_tokens.
    const blocks = (data.content as Array<{ type: string; text: string }>) ?? [];
    content = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    inputTokens = usage.input_tokens || 0;
    outputTokens = usage.output_tokens || 0;
  } else if (isMiniMax) {
    // MiniMax native format: choices[].text, usage.total_tokens.
    content = data.choices?.[0]?.text ?? data.choices?.[0]?.message?.content ?? "";
    const totalTokens = usage.total_tokens || 0;
    outputTokens = usage.output_tokens || estimateTokens(content);
    inputTokens = Math.max(0, totalTokens - outputTokens);
  } else {
    // OpenAI-compatible: choices[].message.content, usage.{prompt,completion}_tokens.
    content = data.choices?.[0]?.message?.content ?? "";
    inputTokens = usage.prompt_tokens || 0;
    outputTokens = usage.completion_tokens || 0;
  }

  const cost = computeCost(pricing, inputTokens, outputTokens);
  return {
    content,
    usage: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
    cost,
  };
}

/**
 * A chunk emitted by the streaming adapter. `delta` carries a piece of text as
 * it arrives from the upstream provider; `done` carries the final usage + cost
 * once the upstream stream ends.
 */
export type StreamChunk =
  | { type: "delta"; content: string }
  | {
      type: "done";
      usage: { input: number; output: number; total: number };
      cost: CostBreakdown;
    };

/**
 * Run a streaming chat completion. Returns an async generator that yields text
 * deltas live from the upstream provider's SSE stream, then a final `done`
 * chunk with usage + cost. Token usage is recorded by the caller once the
 * generator is exhausted.
 */
export async function* chatCompleteStream(
  modelId: string,
  messages: ChatMessage[],
  options: ChatOptions = {}
): AsyncGenerator<StreamChunk> {
  const { model, pricing, url, headers, body, isAnthropic, isMiniMax } =
    await resolveChat(modelId, messages, options, true);

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${model.provider} API ${res.status}: ${err}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error(`${model.provider} returned no response body for streaming`);

  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let content = "";

  // Read the upstream SSE stream event-by-event. Events are separated by a
  // blank line; each may carry one or more `data:` lines.
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sepIndex: number;
    while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex);
      buffer = buffer.slice(sepIndex + 2);

      for (const line of rawEvent.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        // OpenAI-compatible streams end with a `data: [DONE]` sentinel; some
        // providers emit empty data lines. Skip both.
        if (!data || data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);

          if (isAnthropic) {
            // Anthropic streams message_start -> content_block_delta* ->
            // message_delta -> message_stop. We care about the text deltas and
            // the usage reported at the start/end of the message.
            switch (parsed.type) {
              case "message_start":
                inputTokens = parsed.message?.usage?.input_tokens || 0;
                break;
              case "content_block_delta": {
                const text = parsed.delta?.text;
                if (text) {
                  content += text;
                  yield { type: "delta", content: text };
                }
                break;
              }
              case "message_delta":
                outputTokens = parsed.usage?.output_tokens || 0;
                break;
            }
          } else {
            // OpenAI-compatible (and MiniMax) stream chat.completion.chunk
            // objects. MiniMax uses choices[].text; others use
            // choices[].delta.content. Handle both.
            const choice = parsed.usage
              ? undefined
              : parsed.choices?.[0];
            const text = choice?.delta?.content ?? choice?.text;
            if (text) {
              content += text;
              yield { type: "delta", content: text };
            }
            // Some providers (OpenAI, DeepSeek) report usage on the final
            // chunk; MiniMax reports it via a usage-only chunk.
            if (parsed.usage) {
              inputTokens =
                parsed.usage.prompt_tokens ??
                parsed.usage.input_tokens ??
                inputTokens;
              outputTokens =
                parsed.usage.completion_tokens ??
                parsed.usage.output_tokens ??
                outputTokens;
              totalTokens = parsed.usage.total_tokens ?? totalTokens;
            }
          }
        } catch {
          // Ignore a single malformed JSON line and keep streaming.
        }
      }
    }
  }

  // Fall back to estimated token counts if the provider didn't report them.
  if (!outputTokens) outputTokens = estimateTokens(content);
  if (!inputTokens) inputTokens = Math.max(0, totalTokens - outputTokens);
  const total = inputTokens + outputTokens;

  const cost = computeCost(pricing, inputTokens, outputTokens);
  yield { type: "done", usage: { input: inputTokens, output: outputTokens, total }, cost };
}
