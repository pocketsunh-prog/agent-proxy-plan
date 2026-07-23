"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ModelDTO, PlanDTO } from "@/lib/catalog";

interface Props {
  plans: PlanDTO[];
  models: ModelDTO[];
}

export default function PlansAdminClient({ plans, models }: Props) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // Local editable copies.
  const [planState, setPlanState] = useState(plans);
  const [modelState, setModelState] = useState(models);

  function flash(text: string) {
    setMsg(text);
    setTimeout(() => setMsg(""), 2000);
  }

  async function savePlan(p: PlanDTO) {
    setError("");
    const res = await fetch("/api/admin/plans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "plan",
        id: p.id,
        name: p.name,
        monthlyFee: p.monthlyFee,
        allowance: p.allowance, // null = unlimited
        overage: p.overage,
        highlight: p.highlight,
      }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Save failed");
      return;
    }
    flash(`Saved plan "${p.name}"`);
    router.refresh();
  }

  async function saveModel(m: ModelDTO) {
    setError("");
    const res = await fetch("/api/admin/plans", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "model",
        id: m.id,
        displayName: m.displayName,
        provider: m.provider,
        inputPrice: m.inputPrice,
        outputPrice: m.outputPrice,
        contextWindow: m.contextWindow,
        enabled: m.enabled,
      }),
    });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Save failed");
      return;
    }
    flash(`Saved model "${m.displayName}"`);
    router.refresh();
  }

  function updatePlan(id: string, patch: Partial<PlanDTO>) {
    setPlanState((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch } : p))
    );
  }
  function updateModel(id: string, patch: Partial<ModelDTO>) {
    setModelState((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
  }

  return (
    <>
      {msg && <div className="notice notice-info">{msg}</div>}
      {error && <div className="notice notice-error">{error}</div>}

      <div className="card">
        <div className="card-title">Plans</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Monthly Fee ($)</th>
                <th>Allowance (tokens)</th>
                <th>Unlimited</th>
                <th>Highlight</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {planState.map((p) => (
                <tr key={p.id}>
                  <td className="text-muted">{p.id}</td>
                  <td>
                    <input
                      value={p.name}
                      onChange={(e) => updatePlan(p.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={p.monthlyFee}
                      onChange={(e) =>
                        updatePlan(p.id, {
                          monthlyFee: parseInt(e.target.value) || 0,
                        })
                      }
                      style={{ width: 100 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      disabled={p.allowance === null}
                      value={p.allowance ?? ""}
                      onChange={(e) =>
                        updatePlan(p.id, {
                          allowance: parseInt(e.target.value) || 0,
                        })
                      }
                      style={{ width: 140 }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={p.allowance === null}
                      onChange={(e) =>
                        updatePlan(p.id, {
                          allowance: e.target.checked ? null : 500000,
                        })
                      }
                      style={{ width: "auto" }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={p.highlight}
                      onChange={(e) =>
                        updatePlan(p.id, { highlight: e.target.checked })
                      }
                      style={{ width: "auto" }}
                    />
                  </td>
                  <td>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => savePlan(p)}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card mt-16">
        <div className="card-title">Model Pricing (USD per 1M tokens)</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Display Name</th>
                <th>Provider</th>
                <th>Input</th>
                <th>Output</th>
                <th>Context</th>
                <th>Enabled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {modelState.map((m) => (
                <tr key={m.id}>
                  <td className="text-muted">{m.id}</td>
                  <td>
                    <input
                      value={m.displayName}
                      onChange={(e) =>
                        updateModel(m.id, { displayName: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      value={m.provider}
                      onChange={(e) =>
                        updateModel(m.id, { provider: e.target.value })
                      }
                      style={{ width: 110 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={m.inputPrice}
                      onChange={(e) =>
                        updateModel(m.id, {
                          inputPrice: parseFloat(e.target.value) || 0,
                        })
                      }
                      style={{ width: 90 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      value={m.outputPrice}
                      onChange={(e) =>
                        updateModel(m.id, {
                          outputPrice: parseFloat(e.target.value) || 0,
                        })
                      }
                      style={{ width: 90 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={m.contextWindow}
                      onChange={(e) =>
                        updateModel(m.id, {
                          contextWindow: parseInt(e.target.value) || 0,
                        })
                      }
                      style={{ width: 110 }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      onChange={(e) =>
                        updateModel(m.id, { enabled: e.target.checked })
                      }
                      style={{ width: "auto" }}
                    />
                  </td>
                  <td>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => saveModel(m)}
                    >
                      Save
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
