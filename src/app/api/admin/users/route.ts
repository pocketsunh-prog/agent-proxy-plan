/**
 * Admin user management.
 *   GET   /api/admin/users            list users (optional ?q= search)
 *   PATCH /api/admin/users            update { id, role?, disabled?, planId? }
 *   DELETE /api/admin/users?id=...     delete a user
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/adminGuard";

export async function GET(req: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const q = new URL(req.url).searchParams.get("q")?.trim();
  const users = await prisma.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q } },
            { name: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      disabled: true,
      planId: true,
      createdAt: true,
      _count: { select: { usage: true } },
    },
  });

  return NextResponse.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      disabled: u.disabled,
      planId: u.planId,
      createdAt: u.createdAt.toISOString(),
      usageCount: u._count.usage,
    }))
  );
}

const patchSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["USER", "ADMIN"]).optional(),
  disabled: z.boolean().optional(),
  planId: z.string().min(1).optional(),
});

export async function PATCH(req: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { id, ...data } = parsed.data;

  // Guard: don't let an admin disable or demote themselves (avoid lockout).
  if (id === guard.session!.user.id) {
    if (data.role === "USER" || data.disabled === true) {
      return NextResponse.json(
        { error: "You cannot demote or disable your own account." },
        { status: 400 }
      );
    }
  }

  await prisma.user.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  if (id === guard.session!.user.id) {
    return NextResponse.json(
      { error: "You cannot delete your own account." },
      { status: 400 }
    );
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
