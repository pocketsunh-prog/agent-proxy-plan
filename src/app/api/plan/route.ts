/**
 * POST /api/plan — change the current user's selected plan.
 * Body: { planId }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

const schema = z.object({ planId: z.string().min(1) });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const plan = await prisma.plan.findUnique({
    where: { id: parsed.data.planId },
  });
  if (!plan) {
    return NextResponse.json({ error: "Unknown plan" }, { status: 404 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { planId: plan.id },
  });

  return NextResponse.json({ ok: true, planId: plan.id });
}
