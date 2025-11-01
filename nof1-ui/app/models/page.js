"use client";
import useSWR from "swr";

const fetcher = (u) => fetch(u).then((r) => r.json());

export default function ModelsPage() {
  const { data } = useSWR("/api/models", fetcher, { suspense: false });
  const items = data?.models ?? [];
  return (
    <div className="mx-auto max-w-[1200px] p-4">
      <h1 className="text-xl font-bold">Models</h1>
      <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((m) => (
          <div key={m.id} className="card rounded p-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{m.name}</div>
              <div className="text-xs text-neutral-500">v{m.version}</div>
            </div>
            <div className="mt-2 text-sm text-neutral-600">{m.summary}</div>
            <div className="mt-3 text-xs flex items-center justify-between">
              <div>Sharpe: <span className="font-medium">{m.sharpe}</span></div>
              <div>Trades: <span className="font-medium">{m.trades}</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
