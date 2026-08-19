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
import {
  chatComplete,
  chatCompleteStream,
  type ChatMessage,
} from "@/lib/providers";

/**
 * OpenAI-compatible content: either a plain string or an array of content
 * blocks (the multimodal format). We accept both, then normalize to a string
 * before calling the provider. (Only used for non-tool messages.)
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

/** An OpenAI function-tool definition. */
const toolDefinitionSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  }),
});

const schema = z.object({
  model: z.string().min(1),
  messages: z
    .array(
      z.union([
        // Tool result messages: carry a tool_call_id instead of free content.
        z.object({
          role: z.literal("tool"),
          tool_call_id: z.string().min(1),
          content: z.string(),
          name: z.string().optional(),
        }),
        // System / user / assistant messages. An assistant message may also
        // carry tool_calls (when passing a conversation history back in).
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: contentSchema.optional().nullable(),
          name: z.string().optional(),
          tool_calls: z
            .array(
              z.object({
                id: z.string(),
                type: z.literal("function"),
                function: z.object({
                  name: z.string(),
                  arguments: z.string(),
                }),
              })
            )
            .optional(),
        }),
      ])
    )
    .min(1),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(128_000).optional(),
  stream: z.boolean().optional(),
  tools: z.array(toolDefinitionSchema).optional(),
  tool_choice: z
    .union([
      z.enum(["auto", "none"]),
      z.object({
        type: z.literal("function"),
        function: z.object({ name: z.string() }),
      }),
    ])
    .optional(),
  parallel_tool_calls: z.boolean().optional(),
});

/** Convert a validated request message into our internal ChatMessage shape. */
function toChatMessage(
  m: z.infer<typeof schema>["messages"][number]
): ChatMessage {
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.tool_call_id, content: m.content, name: m.name };
  }
  // system / user / assistant: normalize text content (may be null).
  const normalized = m.content ? normalizeContent(m.content) : null;
  if (m.role === "assistant" && m.tool_calls) {
    return { role: "assistant", content: normalized, tool_calls: m.tool_calls };
  }
  return { role: m.role, content: normalized };
}

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
  const { model: modelId, messages, temperature, max_tokens, stream, tools } = parsed.data;

  // Convert request messages to our internal shape. Tool messages and
  // assistant tool_calls are preserved; text content is normalized to a string.
  const normalized = messages.map(toChatMessage);

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

    const streamBody = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => {
          controller.enqueue(encoder.encode("data: " + JSON.stringify(obj) + "\n\n"));
        };
        // Usage is reported by the final `done` chunk; we capture it so we can
        // persist a UsageLog once the stream has been fully forwarded.
        let finalUsage: { input: number; output: number; total: number } | null = null;
        let finalCost = 0;
        let finalStopReason: "stop" | "tool_use" | "length" = "stop";

        // The proxy is transparent about tool use: it streams text + tool-call
        // deltas to the client and lets the client execute the tools. It does
        // NOT run a server-side tool loop. So a single generator pass covers
        // the whole turn.
        const activeTools = tools && tools.length ? tools : undefined;

        try {
          const generator = chatCompleteStream(
            modelId,
            normalized,
            { temperature, maxTokens: max_tokens },
            activeTools
          );

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
            } else if (chunk.type === "tool_call_delta") {
              // Forward the tool-call delta as-is in OpenAI wire format.
              send({
                id,
                object: "chat.completion.chunk",
                created,
                model: model.id,
                choices: [
                  {
                    index: 0,
                    delta: { tool_calls: [chunk.toolCall] },
                    finish_reason: null,
                  },
                ],
              });
            } else {
              // chunk.type === "done"
              finalUsage = chunk.usage;
              finalCost = chunk.cost.totalCost;
              finalStopReason = chunk.stopReason;
            }
          }

          // Map our internal stop reason to the OpenAI finish_reason.
          const finishReason =
            finalStopReason === "tool_use"
              ? "tool_calls"
              : finalStopReason === "length"
                ? "length"
                : "stop";

          // Emit the final chunk with usage + cost.
          if (finalUsage) {
            send({
              id,
              object: "chat.completion.chunk",
              created,
              model: model.id,
              choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
              usage: {
                prompt_tokens: finalUsage.input,
                completion_tokens: finalUsage.output,
                total_tokens: finalUsage.total,
              },
              cost: finalCost,
            });

            // Persist usage.
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
    // The proxy is transparent about tool use: a single provider call, and any
    // tool calls the model returns are handed to the client to execute. We do
    // NOT run a server-side tool loop.
    const result = await chatComplete(
      modelId,
      normalized,
      { temperature, maxTokens: max_tokens },
      tools && tools.length ? tools : undefined
    );

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

    // When the model requests tool calls, return them (in OpenAI wire format)
    // with finish_reason "tool_calls" instead of a text message.
    const hasToolCalls = !!result.toolCalls && result.toolCalls.length > 0;
    const message = hasToolCalls
      ? { role: "assistant", content: result.content, tool_calls: result.toolCalls }
      : { role: "assistant", content: result.content };
    const finishReason = hasToolCalls
      ? "tool_calls"
      : result.stopReason === "length"
        ? "length"
        : "stop";

    const responseBody = {
      id,
      object: "chat.completion",
      created,
      model: model.id,
      choices: [{ index: 0, message, finish_reason: finishReason }],
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
