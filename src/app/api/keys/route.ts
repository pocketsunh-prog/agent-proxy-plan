/**
 * User API key management (session-authenticated).
 *   GET    /api/keys           list the current user's keys (no secrets)
 *   POST   /api/keys           create a key; returns the plaintext ONCE
 *   DELETE /api/keys?id=...     revoke a key
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { generateKey } from "@/lib/apikey";

export async function GET() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      revoked: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    keys.map((k) => ({
      ...k,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    }))
  );
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A key name (1–60 chars) is required" },
      { status: 400 }
    );
  }

  // Cap keys per user to keep things tidy.
  const count = await prisma.apiKey.count({
    where: { userId: session.user.id, revoked: false },
  });
  if (count >= 10) {
    return NextResponse.json(
      { error: "Key limit reached (10 active). Revoke one first." },
      { status: 400 }
    );
  }

  const { fullKey, keyHash, prefix } = generateKey();
  const created = await prisma.apiKey.create({
    data: {
      userId: session.user.id,
      name: parsed.data.name,
      keyHash,
      prefix,
    },
    select: { id: true, name: true, prefix: true, createdAt: true },
  });

  // The plaintext key is returned exactly once and never stored.
  return NextResponse.json(
    {
      ...created,
      createdAt: created.createdAt.toISOString(),
      key: fullKey,
    },
    { status: 201 }
  );
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // Scope the update to the owner so users can't revoke others' keys.
  const result = await prisma.apiKey.updateMany({
    where: { id, userId: session.user.id },
    data: { revoked: true },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
