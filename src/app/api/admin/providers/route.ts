/**
 * Admin provider config management.
 *   GET   /api/admin/providers   list providers (apiKey masked)
 *   PATCH /api/admin/providers   update { id, baseUrl?, chatPath?, enabled?, apiKey? }
 *                                apiKey only updated when a non-empty value sent.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";

/** Never return the raw key; show only a hint that one is set. */
function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 6) return "••••";
  return "••••••" + key.slice(-4);
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const providers = await prisma.providerConfig.findMany({
    orderBy: { displayName: "asc" },
  });
  return NextResponse.json(
    providers.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      baseUrl: p.baseUrl,
      chatPath: p.chatPath,
      enabled: p.enabled,
      hasKey: !!p.apiKey,
      keyMask: maskKey(p.apiKey),
    }))
  );
}

const schema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  chatPath: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  apiKey: z.string().optional(), // empty/undefined = leave unchanged
});

export async function PATCH(req: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { id, apiKey, ...rest } = parsed.data;

  await prisma.providerConfig.update({
    where: { id },
    data: {
      ...rest,
      // Only overwrite the key when a non-empty value is provided.
      ...(apiKey ? { apiKey } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
