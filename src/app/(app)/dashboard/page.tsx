import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getUserUsage } from "@/lib/usage";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const usage = await getUserUsage(session.user.id);
  return <DashboardClient usage={usage} />;
}
