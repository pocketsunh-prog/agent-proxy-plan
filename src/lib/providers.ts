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
import type { ToolDefinition, ToolCall, ToolResult } from "@/lib/tools";
import { executeTool } from "@/lib/tools";

/**
 * A tool call as the model emits it, in our internal (OpenAI) representation.
 * Re-exported from tools.ts for convenience.
 */
export type { ToolCall, ToolResult };

/**
 * An OpenAI-function tool definition as it arrives in the request body.
 * Re-exported from tools.ts for convenience.
 */
export type OpenAIToolDefinition = ToolDefinition;

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** Present on assistant messages that request tool calls. */
  tool_calls?: OpenAIToolCall[];
  /** Present on tool (result) messages. */
  tool_call_id?: string;
  /** Optional name of the tool that produced a tool message. */
  name?: string;
}

/** A tool call in OpenAI wire format (arguments is a JSON *string*). */
export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatResult {
  content: string | null;
  /** Non-empty when the model wants us to run tools and feed results back. */
  toolCalls?: OpenAIToolCall[];
  /** Why the model stopped generating. */
  stopReason?: "stop" | "tool_use" | "length";
  usage: { input: number; output: number; total: number };
  cost: CostBreakdown;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
}

// ---------------------------------------------------------------------------
// OpenAI ↔ Anthropic wire-format conversion helpers
// ---------------------------------------------------------------------------

/** Convert an array of OpenAI tool definitions to Anthropic's format. */
function toAnthropicTools(
  tools: OpenAIToolDefinition[]
): Array<{ name: string; description?: string; input_schema: Record<string, unknown> }> {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
}

/**
 * Convert internal messages to Anthropic's message format. Handles the
 * OpenAI-specific shapes the proxy accepts:
 *   - assistant messages with `tool_calls` → content blocks of `tool_use`
 *   - `role: "tool"` messages → a user message with a `tool_result` block
 */
function toAnthropicMessages(messages: ChatMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      // Tool results become a user message with a tool_result content block.
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id ?? "",
            content: m.content ?? "",
          },
        ],
      });
      continue;
    }

    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      // Assistant turn with requested tool calls: emit text + tool_use blocks.
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.tool_calls) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments || "{}");
        } catch {
          input = {};
        }
        blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
      out.push({ role: "assistant", content: blocks });
      continue;
    }

    // Plain text message (system is stripped by the caller).
    out.push({ role: m.role, content: m.content ?? "" });
  }
  return out;
}

/** Map an Anthropic stop_reason to our internal stopReason. */
function fromAnthropicStopReason(reason: string | undefined): "stop" | "tool_use" | "length" {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "length";
    default:
      return "stop";
  }
}

/** Map an OpenAI finish_reason to our internal stopReason. */
function fromOpenAIStopReason(reason: string | undefined): "stop" | "tool_use" | "length" {
  switch (reason) {
    case "tool_calls":
      return "tool_use";
    case "length":
      return "length";
    default:
      return "stop";
  }
}

/**
 * Parse an OpenAI response's `tool_calls` array into our internal shape.
 * Each entry's `function.arguments` is a JSON string; we parse it so the
 * executor receives a real object.
 */
function fromOpenAIToolCalls(
  raw: Array<{ id?: string; type?: string; function?: { name?: string; arguments?: string } }> | undefined
): OpenAIToolCall[] {
  if (!raw || !Array.isArray(raw)) return [];
  const calls: OpenAIToolCall[] = [];
  for (const tc of raw) {
    if (!tc || !tc.id || !tc.function?.name) continue;
    calls.push({
      id: tc.id,
      type: "function",
      function: { name: tc.function.name, arguments: tc.function.arguments ?? "{}" },
    });
  }
  return calls;
}

/**
 * Extract tool calls from an Anthropic response's content blocks.
 * Returns the tool_use blocks converted to our internal OpenAIToolCall shape.
 */
function fromAnthropicToolUse(
  content: Array<{ type: string; id?: string; name?: string; input?: unknown }>
): OpenAIToolCall[] {
  const calls: OpenAIToolCall[] = [];
  for (const block of content) {
    if (block.type !== "tool_use" || !block.id || !block.name) continue;
    calls.push({
      id: block.id,
      type: "function",
      function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
    });
  }
  return calls;
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
 * stream when we want one. `tools` (OpenAI format) are converted to each
 * provider's wire format.
 */
async function resolveChat(
  modelId: string,
  messages: ChatMessage[],
  options: ChatOptions,
  stream: boolean,
  tools?: OpenAIToolDefinition[]
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
      messages: toAnthropicMessages(chatMsgs),
      max_tokens: maxTokens,
      temperature,
      stream,
    };
    if (systemMsgs.length) {
      body.system = systemMsgs
        .map((m) => (typeof m.content === "string" ? m.content : m.content ?? ""))
        .join("\n\n");
    }
    if (tools && tools.length) {
      body.tools = toAnthropicTools(tools);
    }
    headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    // OpenAI-compatible (DeepSeek, LongCat, OpenAI, ...) plus MiniMax.
    // Pass messages and tools through in OpenAI wire format.
    body = { model: model.id, messages, temperature, stream };
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
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
  options: ChatOptions = {},
  tools?: OpenAIToolDefinition[]
): Promise<ChatResult> {
  const { model, pricing, url, headers, body, isAnthropic, isMiniMax } =
    await resolveChat(modelId, messages, options, false, tools);

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

  let content: string | null = null;
  let inputTokens: number;
  let outputTokens: number;
  let toolCalls: OpenAIToolCall[] | undefined;
  let stopReason: ChatResult["stopReason"] = "stop";

  if (isAnthropic) {
    // Anthropic: content is an array of blocks; usage.{input,output}_tokens.
    const blocks = (data.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>) ?? [];
    content = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    toolCalls = fromAnthropicToolUse(blocks);
    inputTokens = usage.input_tokens || 0;
    outputTokens = usage.output_tokens || 0;
    stopReason = fromAnthropicStopReason(data.stop_reason);
  } else if (isMiniMax) {
    // MiniMax native format: choices[].text, usage.total_tokens.
    content = data.choices?.[0]?.text ?? data.choices?.[0]?.message?.content ?? null;
    const totalTokens = usage.total_tokens || 0;
    outputTokens = usage.output_tokens || estimateTokens(content ?? "");
    inputTokens = Math.max(0, totalTokens - outputTokens);
    stopReason = fromOpenAIStopReason(data.choices?.[0]?.finish_reason);
  } else {
    // OpenAI-compatible: choices[].message.content, usage.{prompt,completion}_tokens.
    const message = data.choices?.[0]?.message;
    content = message?.content ?? null;
    toolCalls = fromOpenAIToolCalls(message?.tool_calls);
    inputTokens = usage.prompt_tokens || 0;
    outputTokens = usage.completion_tokens || 0;
    stopReason = fromOpenAIStopReason(data.choices?.[0]?.finish_reason);
  }

  const cost = computeCost(pricing, inputTokens, outputTokens);
  return {
    content,
    ...(toolCalls && toolCalls.length ? { toolCalls } : {}),
    stopReason,
    usage: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
    cost,
  };
}

/**
 * A chunk emitted by the streaming adapter.
 *   - `delta`: a piece of text as it arrives from the upstream provider.
 *   - `tool_calls`: one or more complete tool calls accumulated during this
 *     turn (emitted once their arguments finish streaming).
 *   - `done`: final usage + cost + stop reason once the upstream stream ends.
 */
export type StreamChunk =
  | { type: "delta"; content: string }
  | { type: "tool_calls"; toolCalls: OpenAIToolCall[] }
  | {
      type: "done";
      usage: { input: number; output: number; total: number };
      cost: CostBreakdown;
      stopReason: "stop" | "tool_use" | "length";
    };

/**
 * Run a streaming chat completion. Returns an async generator that yields text
 * deltas live from the upstream provider's SSE stream, then a final `done`
 * chunk with usage + cost + stop reason. When tools are supplied and the model
 * requests tool calls, a `tool_calls` chunk is emitted once each call's
 * arguments finish streaming. Token usage is recorded by the caller once the
 * generator is exhausted.
 */
export async function* chatCompleteStream(
  modelId: string,
  messages: ChatMessage[],
  options: ChatOptions = {},
  tools?: OpenAIToolDefinition[]
): AsyncGenerator<StreamChunk> {
  const { model, pricing, url, headers, body, isAnthropic, isMiniMax } =
    await resolveChat(modelId, messages, options, true, tools);

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
  let stopReason: "stop" | "tool_use" | "length" = "stop";

  // --- Tool-call accumulation state ---
  // Anthropic streams tool_use blocks across multiple SSE events; we accumulate
  // them here and emit a tool_calls chunk when a block closes.
  const anthropicToolByIndex: Array<{ id?: string; name?: string; arguments: string }> = [];
  let currentAnthropicTool: { id: string; name: string; arguments: string } | null = null;

  // OpenAI streams tool_calls deltas (id/name first, then argument fragments);
  // we accumulate by index and emit when arguments are complete.
  const openaiToolByIndex: Array<{ id?: string; function?: { name?: string; arguments: string } }> = [];
  let openaiToolCallsComplete = false;

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
            // Anthropic streams message_start -> content_block_start ->
            // content_block_delta* -> content_block_stop -> message_delta ->
            // message_stop. We care about text deltas, tool_use blocks, and the
            // usage reported at the start/end of the message.
            switch (parsed.type) {
              case "message_start":
                inputTokens = parsed.message?.usage?.input_tokens || 0;
                break;
              case "content_block_start": {
                const block = parsed.content_block;
                if (block?.type === "tool_use") {
                  currentAnthropicTool = {
                    id: block.id ?? "",
                    name: block.name ?? "",
                    arguments: "",
                  };
                }
                break;
              }
              case "content_block_delta": {
                // Text delta for a text block, or partial JSON for a tool_use block.
                if (parsed.delta?.type === "input_json_delta" && currentAnthropicTool) {
                  currentAnthropicTool.arguments += parsed.partial_json ?? "";
                } else if (parsed.delta?.text) {
                  content += parsed.delta.text;
                  yield { type: "delta", content: parsed.delta.text };
                }
                break;
              }
              case "content_block_stop": {
                // A tool_use block just closed — finalize it.
                if (currentAnthropicTool && currentAnthropicTool.id) {
                  let input: unknown = {};
                  try {
                    input = JSON.parse(currentAnthropicTool.arguments || "{}");
                  } catch {
                    input = {};
                  }
                  yield {
                    type: "tool_calls",
                    toolCalls: [
                      {
                        id: currentAnthropicTool.id,
                        type: "function",
                        function: {
                          name: currentAnthropicTool.name,
                          arguments: JSON.stringify(input),
                        },
                      },
                    ],
                  };
                  currentAnthropicTool = null;
                }
                break;
              }
              case "message_delta":
                outputTokens = parsed.usage?.output_tokens || 0;
                stopReason = fromAnthropicStopReason(parsed.stop_reason);
                break;
            }
          } else {
            // OpenAI-compatible (and MiniMax) stream chat.completion.chunk
            // objects. MiniMax uses choices[].text; others use
            // choices[].delta.content. Handle both.
            const choice = parsed.choices?.[0];

            // Accumulate streaming tool_call deltas.
            if (choice?.delta?.tool_calls && !openaiToolCallsComplete) {
              for (const tc of choice.delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!openaiToolByIndex[idx]) {
                  openaiToolByIndex[idx] = { function: { arguments: "" } };
                }
                const entry = openaiToolByIndex[idx];
                if (tc.id) entry.id = tc.id;
                if (tc.function?.name) entry.function!.name = tc.function.name;
                if (tc.function?.arguments) entry.function!.arguments += tc.function.arguments;
              }
            }

            // Emit accumulated tool calls once the model signals it's done.
            const fr = choice?.finish_reason;
            if ((fr === "tool_calls" || fr === "stop") && openaiToolByIndex.length && !openaiToolCallsComplete) {
              const calls = fromOpenAIToolCalls(
                openaiToolByIndex.map((e) => ({
                  id: e.id,
                  function: e.function,
                }))
              );
              if (calls.length) yield { type: "tool_calls", toolCalls: calls };
              openaiToolCallsComplete = true;
            }

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

            if (fr) stopReason = fromOpenAIStopReason(fr);
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
  yield { type: "done", usage: { input: inputTokens, output: outputTokens, total }, cost, stopReason };
}

/**
 * Run a non-streaming chat completion with a tool-use loop. Calls the provider;
 * if the model responds with tool calls, executes them (via the tool registry),
 * appends the assistant + tool-result messages, and re-calls — repeating until
 * the model produces a text response (no tool calls) or `maxIterations` is hit.
 *
 * Returns the final text ChatResult. Intermediate tool executions are logged to
 * the server console for observability.
 */
export async function runToolLoop(
  modelId: string,
  messages: ChatMessage[],
  options: ChatOptions = {},
  tools: OpenAIToolDefinition[],
  maxIterations: number = 10
): Promise<ChatResult> {
  let currentMessages: ChatMessage[] = messages.map((m) => ({ ...m }));

  for (let i = 0; i < maxIterations; i++) {
    const result = await chatComplete(modelId, currentMessages, options, tools);

    // No tool calls → the model is done. Return the final text result.
    if (!result.toolCalls || result.toolCalls.length === 0) {
      return result;
    }

    console.log(
      `[tool-loop] iteration ${i + 1}/${maxIterations}: model called ${result.toolCalls.length} tool(s):`,
      result.toolCalls.map((tc) => tc.function.name)
    );

    // Append the assistant message that requested the tool calls.
    currentMessages.push({
      role: "assistant",
      content: result.content,
      tool_calls: result.toolCalls,
    });

    // Execute each tool call and append its result. Run sequentially so output
    // ordering is deterministic; parallelize later if needed.
    for (const tc of result.toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        args = {};
      }
      const toolResult = await executeTool({ id: tc.id, name: tc.function.name, arguments: args });
      console.log(
        `[tool-loop]   → ${tc.function.name} (${tc.id}): ${
          toolResult.is_error ? "ERROR" : "ok"
        } — ${toolResult.content.length} chars`
      );
      currentMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: toolResult.content,
        name: tc.function.name,
      });
    }
  }

  // Guard hit: do one final call without returning more tools the model can use.
  console.warn(`[tool-loop] reached max iterations (${maxIterations}); forcing final response.`);
  return chatComplete(modelId, currentMessages, options, tools);
}
