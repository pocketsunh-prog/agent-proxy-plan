import { prisma } from "@/lib/prisma";
import { formatTokens, formatUSD } from "@/lib/tokenizer";

export const dynamic = "force-dynamic";

export default async function AdminUsagePage() {
  const [logs, agg] = await Promise.all([
    prisma.usageLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { user: { select: { email: true } } },
    }),
    prisma.usageLog.aggregate({
      _sum: { inputTokens: true, outputTokens: true, cost: true },
      _count: true,
    }),
  ]);

  const totalTokens =
    (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
  const totalCost = Number(agg._sum.cost ?? 0);
  const calls = agg._count;

  return (
    <>
      <div className="stat-grid mb-16">
        <div className="stat-card accent">
          <div className="label">Total Spend</div>
          <div className="value">{formatUSD(totalCost)}</div>
          <div className="sub">All users, all time</div>
        </div>
        <div className="stat-card green">
          <div className="label">Total Tokens</div>
          <div className="value">{formatTokens(totalTokens)}</div>
          <div className="sub">Input + Output</div>
        </div>
        <div className="stat-card amber">
          <div className="label">API Calls</div>
          <div className="value">{calls}</div>
          <div className="sub">Across the platform</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">All Usage (latest 300)</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Model</th>
                <th>Input</th>
                <th>Output</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted text-center">
                    No usage recorded yet.
                  </td>
                </tr>
              ) : (
                logs.map((l) => (
                  <tr key={l.id}>
                    <td className="text-muted">
                      {l.createdAt.toLocaleString()}
                    </td>
                    <td>{l.user?.email ?? "—"}</td>
                    <td>{l.displayName}</td>
                    <td>{formatTokens(l.inputTokens)}</td>
                    <td>{formatTokens(l.outputTokens)}</td>
                    <td>{formatUSD(Number(l.cost))}</td>
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
