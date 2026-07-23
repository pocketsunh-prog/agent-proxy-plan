import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listModels } from "@/lib/catalog";
import ApiTestClient from "./ApiTestClient";

export const dynamic = "force-dynamic";

export default async function ApiTestPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const models = await listModels();
  return <ApiTestClient models={models} />;
}
