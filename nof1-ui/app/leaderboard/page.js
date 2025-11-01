"use client";
import useSWR from "swr";

const fetcher = (u) => fetch(u).then((r) => r.json());

export default function LeaderboardPage() {
  const { data } = useSWR("/api/leaderboard", fetcher, { suspense: false });
  const rows = data?.rows ?? [];

  return (
    <div className="mx-auto max-w-[1200px] p-4">
      <h1 className="text-xl font-bold">Leaderboard</h1>
      <div className="mt-3 card rounded overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b">
            <tr>
              <th className="text-left px-3 py-2">Model</th>
              <th className="text-right px-3 py-2">P&L</th>
              <th className="text-right px-3 py-2">Sharpe</th>
              <th className="text-right px-3 py-2">Win %</th>
              <th className="text-right px-3 py-2">Trades</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.model} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{r.model}</td>
                <td className={`px-3 py-2 text-right ${r.pnl >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{r.pnl.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{r.sharpe.toFixed(2)}</td>
                <td className="px-3 py-2 text-right">{r.win}%</td>
                <td className="px-3 py-2 text-right">{r.trades}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
