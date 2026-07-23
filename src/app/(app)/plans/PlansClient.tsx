"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ModelDTO, PlanDTO } from "@/lib/catalog";
import { formatTokens } from "@/lib/tokenizer";

interface Props {
  plans: PlanDTO[];
  models: ModelDTO[];
  currentPlanId: string;
}

function allowanceLabel(p: PlanDTO): string {
  if (p.allowance === null) return "Unlimited";
  return formatTokens(p.allowance) + " / mo";
}

export default function PlansClient({ plans, models, currentPlanId }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState(currentPlanId);
  const [saving, setSaving] = useState<string | null>(null);

  async function selectPlan(planId: string) {
    setSaving(planId);
    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId }),
    });
    setSaving(null);
    if (res.ok) {
      setSelected(planId);
      router.refresh();
    }
  }

  // Comparison table config (ported from legacy renderCompareTable).
  const free = plans.find((p) => p.id === "free");
  const payg = plans.find((p) => p.id === "payg");
  const compareRows: Array<[string, string, string]> = [
    ["All models included", "✓", "✓"],
    ["Token calculator", "✓", "✓"],
    ["Usage dashboard", "✓", "✓"],
    ["Usage alerts", "—", "✓"],
    ["Priority throughput", "—", "✓"],
    ["Monthly fee", "$0", "$0"],
    [
      "Token allowance",
      free ? allowanceLabel(free) : "—",
      payg ? allowanceLabel(payg) : "—",
    ],
  ];

  return (
    <>
      <div className="page-header">
        <h2>Plans &amp; Pricing</h2>
        <p>Compare plans and see model rates side by side.</p>
      </div>

      <div className="plan-grid">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={"plan-card" + (plan.highlight ? " highlight" : "")}
          >
            {plan.highlight && <div className="badge">Popular</div>}
            <h3>{plan.name}</h3>
            <div className="price">
              {plan.monthlyFee === 0 ? "$0" : "$" + plan.monthlyFee}
              <small>
                {plan.monthlyFee === 0 ? " no monthly fee" : " / month"}
              </small>
            </div>
            <ul>
              {plan.features.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
            <button
              className={
                "btn full-width " +
                (plan.highlight ? "btn-primary" : "btn-secondary")
              }
              disabled={saving === plan.id || selected === plan.id}
              onClick={() => selectPlan(plan.id)}
            >
              {saving === plan.id ? (
                <span className="spinner" />
              ) : selected === plan.id ? (
                "Current Plan"
              ) : (
                "Select"
              )}
            </button>
          </div>
        ))}
      </div>

      <div className="card mt-16">
        <div className="card-title">Plan Comparison</div>
        <div className="table-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>{free?.name ?? "Free"}</th>
                <th>{payg?.name ?? "Pay-as-you-go"}</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map(([feature, a, b]) => (
                <tr key={feature}>
                  <td>{feature}</td>
                  <td className={a === "✓" ? "compare-yes" : "compare-no"}>
                    {a}
                  </td>
                  <td className={b === "✓" ? "compare-yes" : "compare-no"}>
                    {b}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt-16">
        <div className="card-title">Model Pricing (per 1M tokens)</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th>Provider</th>
                <th>Input</th>
                <th>Output</th>
                <th>Context Window</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.id}>
                  <td>{m.displayName}</td>
                  <td className="text-dim">{m.provider}</td>
                  <td>${m.inputPrice.toFixed(2)}</td>
                  <td>${m.outputPrice.toFixed(2)}</td>
                  <td>{formatTokens(m.contextWindow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
