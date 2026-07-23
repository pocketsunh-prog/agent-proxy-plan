/**
 * Usage query helpers. Serialize UsageLog rows (Decimal -> number) for the UI.
 */
import { prisma } from "@/lib/prisma";

export interface UsageRow {
  id: string;
  time: string; // ISO
  modelId: string;
  displayName: string;
  provider: string;
  input: number;
  output: number;
  cost: number;
}

export async function getUserUsage(
  userId: string,
  take = 200
): Promise<UsageRow[]> {
  const rows = await prisma.usageLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.map(serialize);
}

/**
 * Sum of input+output tokens a user has consumed since the start of the current
 * UTC month. Used for plan-allowance enforcement.
 */
export async function getMonthlyTokenUsage(userId: string): Promise<number> {
  const now = new Date();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const agg = await prisma.usageLog.aggregate({
    where: { userId, createdAt: { gte: monthStart } },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
}

/**
 * Check whether a user may make a call under their plan's monthly allowance.
 * Returns { allowed, allowance, used }. A null allowance means unlimited.
 */
export async function checkAllowance(
  userId: string,
  planId: string
): Promise<{ allowed: boolean; allowance: number | null; used: number }> {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  const allowance = plan?.allowance === null || plan?.allowance === undefined
    ? null
    : Number(plan.allowance);
  if (allowance === null) return { allowed: true, allowance: null, used: 0 };

  const used = await getMonthlyTokenUsage(userId);
  return { allowed: used < allowance, allowance, used };
}

export function serialize(r: {
  id: string;
  createdAt: Date;
  modelId: string;
  displayName: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cost: unknown;
}): UsageRow {
  return {
    id: r.id,
    time: r.createdAt.toISOString(),
    modelId: r.modelId,
    displayName: r.displayName,
    provider: r.provider,
    input: r.inputTokens,
    output: r.outputTokens,
    cost: Number(r.cost),
  };
}
