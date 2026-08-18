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
import { chatComplete, chatCompleteStream } from "@/lib/providers";

/**
 * OpenAI-compatible content: either a plain string or an array of content
 * blocks (the multimodal format). We accept both, then normalize to a string
 * before calling the provider.
 */
const contentSchema = z.union([
  z.string(),
  z.array(
    z.object({
      type: z.string(),
      text: z.string().optional(),
    })
  ),
]);

function normalizeContent(content: z.infer<typeof contentSchema>): string {
  if (typeof content === "string") return content;
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text as string)
    .join("\n");
}

const schema = z.object({
  model: z.string().min(1),
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: contentSchema })).min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(128_000).optional(),
  stream: z.boolean().optional(),
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
  const rawBody = await req.text().catch(() => "");
  console.log("[chat/completions] request body:", rawBody);
  const parsed = schema.safeParse(rawBody ? JSON.parse(rawBody) : null);
  if (!parsed.success) {
    console.log("[chat/completions] validation error:", JSON.stringify(parsed.error.errors));
    return apiError(parsed.error.errors[0]?.message || "Invalid request body", 400);
  }
  const { model: modelId, messages, temperature, max_tokens, stream } = parsed.data;

  // Normalize multimodal content blocks to plain strings for the provider.
  const normalized = messages.map((m) => ({
    role: m.role,
    content: normalizeContent(m.content),
  }));

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

  const id = "chatcmpl-" + authed.keyId.slice(0, 12);
  const created = Math.floor(Date.now() / 1000);

  // ---- Streaming (SSE): pipe deltas live from the upstream provider ----
  if (stream) {
    const encoder = new TextEncoder();
    const generator = chatCompleteStream(modelId, normalized, {
      temperature,
      maxTokens: max_tokens,
    });

    const streamBody = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => {
          controller.enqueue(encoder.encode("data: " + JSON.stringify(obj) + "\n\n"));
        };
        // Usage is reported by the final `done` chunk; we capture it so we can
        // persist a UsageLog once the stream has been fully forwarded.
        let finalUsage: { input: number; output: number; total: number } | null = null;
        let finalCost = 0;
        try {
          for await (const chunk of generator) {
            if (chunk.type === "delta") {
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model: model.id,
                choices: [
                  { index: 0, delta: { content: chunk.content }, finish_reason: null },
                ],
              });
            } else {
              // chunk.type === "done"
              finalUsage = chunk.usage;
              finalCost = chunk.cost.totalCost;
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model: model.id,
                choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
                usage: {
                  prompt_tokens: chunk.usage.input,
                  completion_tokens: chunk.usage.output,
                  total_tokens: chunk.usage.total,
                },
                cost: chunk.cost.totalCost,
              });
            }
          }

          // Stream finished — persist usage.
          if (finalUsage) {
            await prisma.usageLog.create({
              data: {
                userId: authed.userId,
                modelId: model.id,
                provider: model.provider,
                displayName: model.displayName,
                inputTokens: finalUsage.input,
                outputTokens: finalUsage.output,
                cost: finalCost,
                source: "api",
              },
            });
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (err) {
          // Emit an error event in the stream so the client sees what happened.
          const message = err instanceof Error ? err.message : "Upstream provider error";
          send({ error: { message, type: "api_error" } });
        } finally {
          controller.close();
        }
      },
    });
    console.log("[chat/completions] streaming response, id:", id);
    return new Response(streamBody, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // ---- Non-streaming ----
  try {
    const result = await chatComplete(modelId, normalized, {
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

    const usageInfo = {
      prompt_tokens: result.usage.input,
      completion_tokens: result.usage.output,
      total_tokens: result.usage.total,
    };
    const responseBody = {
      id,
      object: "chat.completion",
      created,
      model: model.id,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: result.content },
          finish_reason: "stop",
        },
      ],
      usage: usageInfo,
      // Non-standard extra: our computed cost (USD).
      cost: result.cost.totalCost,
    };
    console.log("[chat/completions] response:", JSON.stringify(responseBody));
    return NextResponse.json(responseBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream provider error";
    return apiError(message, 502, "api_error");
  }
}
