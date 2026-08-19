"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import { Doughnut, Bar } from "react-chartjs-2";
import type { UsageRow } from "@/lib/usage";
import { formatTokens, formatUSD, formatDate } from "@/lib/tokenizer";

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend
);

const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#ec4899"];

export default function DashboardClient({ usage }: { usage: UsageRow[] }) {
  const totals = useMemo(() => {
    let totalCost = 0;
    let totalTokens = 0;
    for (const u of usage) {
      totalCost += u.cost;
      totalTokens += u.input + u.output;
    }
    const calls = usage.length;
    return {
      totalCost,
      totalTokens,
      calls,
      avgCost: calls ? totalCost / calls : 0,
    };
  }, [usage]);

  const byModel = useMemo(() => {
    const map: Record<
      string,
      { cost: number; input: number; output: number }
    > = {};
    for (const u of usage) {
      const key = u.displayName;
      if (!map[key]) map[key] = { cost: 0, input: 0, output: 0 };
      map[key].cost += u.cost;
      map[key].input += u.input;
      map[key].output += u.output;
    }
    const labels = Object.keys(map);
    return {
      labels,
      cost: labels.map((l) => map[l].cost),
      input: labels.map((l) => map[l].input),
      output: labels.map((l) => map[l].output),
    };
  }, [usage]);

  const doughnutData = {
    labels: byModel.labels.length ? byModel.labels : ["No data"],
    datasets: [
      {
        data: byModel.cost.length ? byModel.cost : [1],
        backgroundColor: COLORS,
        borderColor: "#1e293b",
        borderWidth: 2,
      },
    ],
  };

  const barData = {
    labels: byModel.labels.length ? byModel.labels : ["No data"],
    datasets: [
      {
        label: "Input Tokens",
        data: byModel.input.length ? byModel.input : [0],
        backgroundColor: "#6366f1",
        borderRadius: 4,
      },
      {
        label: "Output Tokens",
        data: byModel.output.length ? byModel.output : [0],
        backgroundColor: "#22c55e",
        borderRadius: 4,
      },
    ],
  };

  return (
    <>
      <div className="page-header">
        <h2>Cost Dashboard</h2>
        <p>Visual breakdown of your token usage and spending.</p>
      </div>

      <div className="stat-grid">
        <div className="stat-card accent">
          <div className="label">Total Spend</div>
          <div className="value">{formatUSD(totals.totalCost)}</div>
          <div className="sub">All time</div>
        </div>
        <div className="stat-card green">
          <div className="label">Total Tokens</div>
          <div className="value">{formatTokens(totals.totalTokens)}</div>
          <div className="sub">Input + Output</div>
        </div>
        <div className="stat-card amber">
          <div className="label">API Calls</div>
          <div className="value">{totals.calls}</div>
          <div className="sub">Successful requests</div>
        </div>
        <div className="stat-card">
          <div className="label">Avg Cost / Call</div>
          <div className="value">${totals.avgCost.toFixed(6)}</div>
          <div className="sub">Across all models</div>
        </div>
      </div>

      <div className="chart-grid mt-16">
        <div className="card">
          <div className="card-title">Spend by Model</div>
          <div className="chart-container">
            <Doughnut
              data={doughnutData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: "bottom",
                    labels: { color: "#94a3b8" },
                  },
                },
              }}
            />
          </div>
        </div>
        <div className="card">
          <div className="card-title">Tokens by Model</div>
          <div className="chart-container">
            <Bar
              data={barData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: { ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
                  y: { ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
                },
                plugins: { legend: { labels: { color: "#94a3b8" } } },
              }}
            />
          </div>
        </div>
      </div>

      <div className="card mt-16">
        <div className="card-title">Recent Usage Log</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Model</th>
                <th>Input Tokens</th>
                <th>Output Tokens</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {usage.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-muted text-center">
                    No usage yet. Try the AI Chat tab.
                  </td>
                </tr>
              ) : (
                usage.map((u) => (
                  <tr key={u.id}>
                    <td className="text-muted">{formatDate(u.time)}</td>
                    <td>{u.displayName}</td>
                    <td>{formatTokens(u.input)}</td>
                    <td>{formatTokens(u.output)}</td>
                    <td>{formatUSD(u.cost)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
