import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import ApiKeysClient from "./ApiKeysClient";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");

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

  return (
    <ApiKeysClient
      initialKeys={keys.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        revoked: k.revoked,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      }))}
    />
  );
}
