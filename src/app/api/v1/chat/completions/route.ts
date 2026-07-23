/**
 * POST /api/v1/chat/completions
 * -----------------------------------------------------------------------------
 * Public, OpenAI-compatible chat endpoint authenticated by a user API key.
 *
 *   Authorization: Bearer tp_live_xxx
 *   Body: { model, messages, temperature?, max_tokens? }
 *
 * Runs the provider call server-side, enforces the user's plan allowance,
 * records a UsageLog row (source="api"), and returns an OpenAI-shaped
 * chat.completion object.
 * -----------------------------------------------------------------------------
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bearerFromHeader, verifyKey } from "@/lib/apikey";
import { checkAllowance } from "@/lib/usage";
import { chatComplete } from "@/lib/providers";

const schema = z.object({
  model: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      })
    )
    .min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(8192).optional(),
});

/** OpenAI-style error envelope. */
function apiError(message: string, status: number, type = "invalid_request_error") {
  return NextResponse.json({ error: { message, type } }, { status });
}

export async function POST(req: Request) {
  // ---- Authenticate via API key ----
  const token = bearerFromHeader(req.headers.get("authorization"));
  if (!token) {
    return apiError(
      "Missing API key. Pass it as 'Authorization: Bearer tp_live_...'.",
      401,
      "authentication_error"
    );
  }
  const authed = await verifyKey(token);
  if (!authed) {
    return apiError("Invalid or revoked API key.", 401, "authentication_error");
  }

  // ---- Validate body ----
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return apiError(parsed.error.errors[0]?.message || "Invalid request body", 400);
  }
  const { model: modelId, messages, temperature, max_tokens } = parsed.data;

  // ---- Resolve model + plan ----
  const [model, user] = await Promise.all([
    prisma.modelPricing.findUnique({ where: { id: modelId } }),
    prisma.user.findUnique({
      where: { id: authed.userId },
      select: { planId: true },
    }),
  ]);
  if (!model) {
    return apiError(`The model '${modelId}' does not exist.`, 404, "model_not_found");
  }

  // ---- Enforce plan allowance ----
  const allowance = await checkAllowance(authed.userId, user?.planId ?? "free");
  if (!allowance.allowed) {
    return apiError(
      `Monthly token allowance exceeded (${allowance.used}/${allowance.allowance}). Upgrade your plan to continue.`,
      429,
      "rate_limit_exceeded"
    );
  }

  // ---- Call provider + record usage ----
  try {
    const result = await chatComplete(modelId, messages, {
      temperature,
      maxTokens: max_tokens,
    });

    await prisma.usageLog.create({
      data: {
        userId: authed.userId,
        modelId: model.id,
        provider: model.provider,
        displayName: model.displayName,
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        cost: result.cost.totalCost,
        source: "api",
      },
    });

    // OpenAI-compatible response shape.
    return NextResponse.json({
      id: "chatcmpl-" + authed.keyId.slice(0, 12),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: model.id,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: result.content },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: result.usage.input,
        completion_tokens: result.usage.output,
        total_tokens: result.usage.total,
      },
      // Non-standard extra: our computed cost (USD).
      cost: result.cost.totalCost,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream provider error";
    return apiError(message, 502, "api_error");
  }
}
