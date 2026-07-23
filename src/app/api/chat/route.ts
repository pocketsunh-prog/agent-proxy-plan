/**
 * POST /api/chat — server-side chat completion.
 * Body: { modelId, messages, temperature?, maxTokens? }
 *
 * Runs the provider call server-side (key injected from ProviderConfig),
 * writes a UsageLog row for the current user, and returns { content, usage,
 * cost }. The API key never reaches the browser.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { chatComplete } from "@/lib/providers";

const schema = z.object({
  modelId: z.string().min(1),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string(),
      })
    )
    .min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(8192).optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || "Invalid input" },
      { status: 400 }
    );
  }

  const { modelId, messages, temperature, maxTokens } = parsed.data;

  const model = await prisma.modelPricing.findUnique({ where: { id: modelId } });
  if (!model) {
    return NextResponse.json({ error: "Unknown model" }, { status: 404 });
  }

  try {
    const result = await chatComplete(modelId, messages, {
      temperature,
      maxTokens,
    });

    // Record usage for this user.
    await prisma.usageLog.create({
      data: {
        userId: session.user.id,
        modelId: model.id,
        provider: model.provider,
        displayName: model.displayName,
        inputTokens: result.usage.input,
        outputTokens: result.usage.output,
        cost: result.cost.totalCost,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
