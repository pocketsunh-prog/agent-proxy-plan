"use client";

import { useMemo, useState } from "react";
import type { ModelDTO } from "@/lib/catalog";
import ModelChips from "@/components/ModelChips";
import {
  computeCost,
  estimateTokens,
  formatTokens,
  formatUSD,
} from "@/lib/tokenizer";

export default function CalculatorClient({ models }: { models: ModelDTO[] }) {
  const [selectedId, setSelectedId] = useState(models[0]?.id ?? "");
  const [inputTokens, setInputTokens] = useState(1000);
  const [outputTokens, setOutputTokens] = useState(500);
  const [text, setText] = useState("");

  const selected = models.find((m) => m.id === selectedId) ?? models[0];

  const cost = useMemo(() => {
    if (!selected) return { inputCost: 0, outputCost: 0, totalCost: 0 };
    return computeCost(
      { input: selected.inputPrice, output: selected.outputPrice },
      inputTokens,
      outputTokens
    );
  }, [selected, inputTokens, outputTokens]);

  function estimateFromText() {
    setInputTokens(estimateTokens(text));
  }

  if (!selected) {
    return (
      <div className="notice notice-warn">
        No models are configured. Ask an admin to add model pricing.
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <h2>Token Calculator</h2>
        <p>
          Estimate token usage and cost across all supported models before you
          spend a cent.
        </p>
      </div>

      <div className="card">
        <div className="card-title">Select Model</div>
        <ModelChips
          models={models}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      <div className="card mt-16">
        <div className="form-grid">
          <div className="form-row">
            <label htmlFor="calc-input-tokens">Input Tokens (prompt)</label>
            <input
              id="calc-input-tokens"
              type="number"
              min={0}
              value={inputTokens}
              onChange={(e) => setInputTokens(parseInt(e.target.value) || 0)}
            />
          </div>
          <div className="form-row">
            <label htmlFor="calc-output-tokens">
              Output Tokens (completion)
            </label>
            <input
              id="calc-output-tokens"
              type="number"
              min={0}
              value={outputTokens}
              onChange={(e) => setOutputTokens(parseInt(e.target.value) || 0)}
            />
          </div>
        </div>
        <div className="form-row">
          <label htmlFor="calc-text">Or paste text to auto-estimate tokens</label>
          <textarea
            id="calc-text"
            placeholder="Paste your prompt or content here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <button className="btn btn-secondary btn-sm" onClick={estimateFromText}>
          Estimate from text
        </button>
      </div>

      <div className="card mt-16">
        <div className="card-title">Estimated Cost</div>

        <div>
          <div className="cost-row">
            <div>
              <div style={{ fontWeight: 600 }}>Input</div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                {formatTokens(inputTokens)} tokens
              </div>
            </div>
            <span className="amt">{formatUSD(cost.inputCost)}</span>
          </div>
          <div className="cost-row">
            <div>
              <div style={{ fontWeight: 600 }}>Output</div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                {formatTokens(outputTokens)} tokens
              </div>
            </div>
            <span className="amt">{formatUSD(cost.outputCost)}</span>
          </div>
          <div className="cost-row total">
            <span>Total estimated cost</span>
            <span className="amt">{formatUSD(cost.totalCost)}</span>
          </div>
        </div>

        <table className="mt-16">
          <thead>
            <tr>
              <th>Model</th>
              <th>Input Cost</th>
              <th>Output Cost</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => {
              const c = computeCost(
                { input: m.inputPrice, output: m.outputPrice },
                inputTokens,
                outputTokens
              );
              const isSel = m.id === selected.id;
              return (
                <tr
                  key={m.id}
                  style={isSel ? { background: "var(--accent-glow)" } : undefined}
                >
                  <td>
                    {m.displayName}
                    {isSel ? " ➠" : ""}
                  </td>
                  <td>{formatUSD(c.inputCost)}</td>
                  <td>{formatUSD(c.outputCost)}</td>
                  <td>{formatUSD(c.totalCost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
