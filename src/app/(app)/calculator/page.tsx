import { listModels } from "@/lib/catalog";
import CalculatorClient from "./CalculatorClient";

export default async function CalculatorPage() {
  const models = await listModels();
  return <CalculatorClient models={models} />;
}
