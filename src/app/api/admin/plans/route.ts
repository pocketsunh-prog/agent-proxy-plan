/**
 * Admin plan + model-pricing management.
 *   PATCH /api/admin/plans   body: { kind: "plan", id, ...fields }
 *                             or   { kind: "model", id, ...fields }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";

const planSchema = z.object({
  kind: z.literal("plan"),
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  monthlyFee: z.number().int().min(0).optional(),
  allowance: z.number().int().min(0).nullable().optional(), // null = unlimited
  overage: z.boolean().optional(),
  highlight: z.boolean().optional(),
  features: z.array(z.string()).optional(),
});

const modelSchema = z.object({
  kind: z.literal("model"),
  id: z.string().min(1),
  displayName: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  inputPrice: z.number().min(0).optional(),
  outputPrice: z.number().min(0).optional(),
  contextWindow: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
  description: z.string().optional(),
});

const schema = z.discriminatedUnion("kind", [planSchema, modelSchema]);

export async function PATCH(req: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  if (parsed.data.kind === "plan") {
    const { kind, id, allowance, ...rest } = parsed.data;
    void kind;
    await prisma.plan.update({
      where: { id },
      data: {
        ...rest,
        ...(allowance !== undefined
          ? { allowance: allowance === null ? null : BigInt(allowance) }
          : {}),
      },
    });
  } else {
    const { kind, id, ...rest } = parsed.data;
    void kind;
    await prisma.modelPricing.update({ where: { id }, data: rest });
  }

  return NextResponse.json({ ok: true });
}
