import { listModels, listPlans } from "@/lib/catalog";
import PlansAdminClient from "./PlansAdminClient";

export const dynamic = "force-dynamic";

export default async function AdminPlansPage() {
  const [plans, models] = await Promise.all([
    listPlans(),
    listModels(true), // include disabled models for admin
  ]);
  return <PlansAdminClient plans={plans} models={models} />;
}
