/**
 * Server-side helpers to read the model/plan catalog from the DB and return
 * plain, serializable objects for client components (Decimal/BigInt -> number).
 */
import { prisma } from "@/lib/prisma";

export interface ModelDTO {
  id: string;
  provider: string;
  displayName: string;
  inputPrice: number;
  outputPrice: number;
  contextWindow: number;
  capabilities: string[];
  description: string | null;
  enabled: boolean;
}

export interface PlanDTO {
  id: string;
  name: string;
  monthlyFee: number;
  allowance: number | null; // null = unlimited
  overage: boolean;
  features: string[];
  highlight: boolean;
}

export async function listModels(includeDisabled = false): Promise<ModelDTO[]> {
  const rows = await prisma.modelPricing.findMany({
    where: includeDisabled ? {} : { enabled: true },
    orderBy: { displayName: "asc" },
  });
  return rows.map((m) => ({
    id: m.id,
    provider: m.provider,
    displayName: m.displayName,
    inputPrice: Number(m.inputPrice),
    outputPrice: Number(m.outputPrice),
    contextWindow: m.contextWindow,
    capabilities: (m.capabilities as string[]) ?? [],
    description: m.description,
    enabled: m.enabled,
  }));
}

export async function listPlans(): Promise<PlanDTO[]> {
  const rows = await prisma.plan.findMany();
  // Keep free before payg for stable display order.
  const order = ["free", "payg"];
  rows.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    monthlyFee: p.monthlyFee,
    allowance: p.allowance === null ? null : Number(p.allowance),
    overage: p.overage,
    features: (p.features as string[]) ?? [],
    highlight: p.highlight,
  }));
}
