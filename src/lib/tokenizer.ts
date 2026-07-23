/**
 * tokenizer.ts
 * -----------------------------------------------------------------------------
 * Ported from the legacy js/tokenizer.js. Lightweight token estimation and
 * cost math shared by the calculator (client) and the chat route (server).
 *
 *   - CJK characters: ~1.5 chars per token
 *   - Latin / other:  ~4 chars per token
 *
 * For billing-grade accuracy the provider API `usage` field is authoritative.
 * -----------------------------------------------------------------------------
 */

export interface Pricing {
  input: number; // USD per 1M input tokens
  output: number; // USD per 1M output tokens
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  totalCost: number;
}

/** Estimate the number of tokens in a string. */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // CJK Unified Ideographs + Hangul + Kana + fullwidth forms.
  const cjkRegex = /[一-鿿㐀-䶿豈-﫿぀-ゟ゠-ヿ가-힯＀-￯]/g;
  const cjkMatches = text.match(cjkRegex);
  const cjkChars = cjkMatches ? cjkMatches.length : 0;
  const otherChars = text.length - cjkChars;

  const cjkTokens = cjkChars / 1.5;
  const otherTokens = otherChars / 4;
  return Math.ceil(cjkTokens + otherTokens);
}

/** Estimate tokens for a list of chat messages (OpenAI message format). */
export function estimateMessagesTokens(
  messages: Array<{ role: string; content: string }>
): number {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content || "");
    total += 4; // per-message overhead
  }
  total += 2; // conversation priming overhead
  return Math.ceil(total);
}

/** Compute the estimated cost for a given token breakdown under a model. */
export function computeCost(
  pricing: Pricing,
  inputTokens: number,
  outputTokens: number
): CostBreakdown {
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return {
    inputCost: roundCents(inputCost),
    outputCost: roundCents(outputCost),
    totalCost: roundCents(inputCost + outputCost),
  };
}

/** Round to 6 decimals so sub-cent costs still display meaningfully. */
export function roundCents(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Format a number as USD currency. */
export function formatUSD(n: number): string {
  if (n < 0.01) return "$" + n.toFixed(6);
  if (n < 1) return "$" + n.toFixed(4);
  return "$" + n.toFixed(2);
}

/** Format a token count with thousands separators. */
export function formatTokens(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}
