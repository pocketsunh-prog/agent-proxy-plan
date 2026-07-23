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
  const isMiniMax = provider.id === "minimax";

  const { temperature = 0.7, maxTokens = 1024 } = options;
  const body: Record<string, unknown> = {
    model: model.id,
    messages,
    temperature,
  };
  // MiniMax uses tokens_to_generate; OpenAI-compatible providers use max_tokens.
  if (isMiniMax) body.tokens_to_generate = maxTokens;
  else body.max_tokens = maxTokens;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + provider.apiKey,
    },
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

  if (isMiniMax) {
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
