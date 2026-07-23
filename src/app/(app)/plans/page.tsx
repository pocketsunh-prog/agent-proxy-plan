import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listModels, listPlans } from "@/lib/catalog";
import PlansClient from "./PlansClient";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const [plans, models] = await Promise.all([listPlans(), listModels()]);
  return (
    <PlansClient
      plans={plans}
      models={models}
      currentPlanId={session.user.planId}
    />
  );
}
