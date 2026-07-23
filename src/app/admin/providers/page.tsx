import { prisma } from "@/lib/prisma";
import ProvidersClient from "./ProvidersClient";

export const dynamic = "force-dynamic";

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 6) return "••••";
  return "••••••" + key.slice(-4);
}

export default async function AdminProvidersPage() {
  const providers = await prisma.providerConfig.findMany({
    orderBy: { displayName: "asc" },
  });

  return (
    <ProvidersClient
      providers={providers.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        baseUrl: p.baseUrl,
        chatPath: p.chatPath,
        enabled: p.enabled,
        hasKey: !!p.apiKey,
        keyMask: maskKey(p.apiKey),
      }))}
    />
  );
}
