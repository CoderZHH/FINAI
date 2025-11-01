"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

// 图表主体使用 Recharts，统一在客户端渲染，避免 Next.js SSR 报错。
const ChartInner = dynamic(() => import("./ChartInner"), { ssr: false });

const formatUsd = (v) => `US$${Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatPct = (v) => `${(v * 100).toFixed(2)}%`;

const VIEW_MODES = [
  { id: "dollar", label: "以美元查看", icon: "$" },
  { id: "percent", label: "以收益率查看", icon: "%" },
];

const TIME_WINDOWS = [
  { id: "all", label: "ALL" },
  { id: "72h", label: "72H" },
];

const LEGEND_ICONS = {
  "GPT 5": "🧠",
  "CLAUDE SONNET 4.5": "✴",
  "GEMINI 2.5 PRO": "◆",
  "GROK 4": "ø",
  "DEEPSEEK CHAT v3.1": "🛰",
  "QWEN3 MAX": "✶",
  "BTC BUY&HOLD": "●",
};

export default function ChartPanel() {
  const [viewMode, setViewMode] = useState("dollar");
  const [timeWindow, setTimeWindow] = useState("all");
  const [timeseries, setTimeseries] = useState(null);

  // TODO: 后端接入完成后，把该 fetch 替换为统一的性能数据请求封装，方便管理鉴权与错误处理。
  useEffect(() => {
    fetch("/api/performance/timeseries")
      .then((response) => response.json())
      .then(setTimeseries);
  }, []);

  const seriesMeta = timeseries?.series ?? [];

  const chartData = useMemo(() => {
    if (!seriesMeta.length) return [];
    const length = Math.max(...seriesMeta.map((series) => series.points.length));
    return Array.from({ length }, (_, idx) => {
      const basePoint = seriesMeta[0].points[idx];
      const time = basePoint ? new Date(basePoint.timestamp) : new Date();
      const label = time.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit" });
      const entry = { time: label };
      seriesMeta.forEach((series) => {
        const point = series.points[idx];
        if (!point) return;
        entry[series.line_key] =
          viewMode === "dollar"
            ? Number(point.dollar_equity.toFixed(2))
            : Number((point.cum_pnl_pct * 100).toFixed(2));
      });
      return entry;
    }).filter(Boolean);
  }, [seriesMeta, viewMode]);

  const filteredChartData = useMemo(() => {
    if (!chartData.length) return [];
    if (timeWindow === "all") return chartData;
    const numeric = parseInt(timeWindow, 10);
    if (Number.isFinite(numeric)) {
      return chartData.slice(-numeric);
    }
    return chartData;
  }, [chartData, timeWindow]);

  const legendData = useMemo(
    () =>
      seriesMeta.map((series) => {
        const latest = series.points.at(-1) ?? { dollar_equity: 0, cum_pnl_pct: 0 };
        return {
          lineKey: series.line_key,
          modelId: series.model_id,
          name: series.name,
          color: series.color,
          latestDollar: latest.dollar_equity,
          latestPct: latest.cum_pnl_pct,
        };
      }),
    [seriesMeta]
  );

  const nameLookup = useMemo(() => {
    const map = new Map();
    legendData.forEach((item) => map.set(item.modelId, item.name));
    return map;
  }, [legendData]);

  const yFormatter =
    viewMode === "dollar"
      ? (value) => `US$${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
      : (value) => `${value}%`;

  const tooltipFormatter =
    viewMode === "dollar"
      ? (value) => formatUsd(Number(value))
      : (value) => `${Number(value).toFixed(2)}%`;

  const highestName = timeseries?.highest?.model_id
    ? nameLookup.get(timeseries.highest.model_id) ?? timeseries.highest.model_id
    : null;
  const lowestName = timeseries?.lowest?.model_id
    ? nameLookup.get(timeseries.lowest.model_id) ?? timeseries.lowest.model_id
    : null;

  return (
    <section className="flex h-full min-h-[620px] flex-col rounded border border-neutral-200 bg-white px-5 py-4 shadow-sm">
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          <div className="flex overflow-hidden rounded border border-neutral-900">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setViewMode(mode.id)}
                aria-label={mode.label}
                className={`px-3 py-1 text-xs font-semibold ${viewMode === mode.id ? "bg-neutral-900 text-white" : "bg-white text-neutral-800"}`}
              >
                {mode.icon}
              </button>
            ))}
          </div>
        </div>

        <div className="absolute left-1/2 top-0 flex -translate-x-1/2 flex-col items-center">
          <div className="mono text-xs tracking-[0.25em]">账户总权益</div>
          {(highestName || lowestName) && (
            <div className="mt-1 whitespace-nowrap text-xs text-neutral-500">
              领先模型：{highestName ?? "—"} | 落后模型：{lowestName ?? "—"} | 基准：BTC BUY&HOLD
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="flex overflow-hidden rounded border border-neutral-900">
            {TIME_WINDOWS.map((item) => (
              <button
                key={item.id}
                onClick={() => setTimeWindow(item.id)}
                className={`px-3 py-1 text-xs font-semibold ${timeWindow === item.id ? "bg-neutral-900 text-white" : "bg-white text-neutral-800"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex-1 min-h-0">
        <ChartInner
          data={filteredChartData}
          series={legendData}
          yFormatter={yFormatter}
          valueFormatter={tooltipFormatter}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 border-t pt-3 text-xs sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
        {legendData.map((item) => (
          <div key={item.lineKey} className="flex flex-col justify-between rounded border px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-base" style={{ color: item.color }}>
                {LEGEND_ICONS[item.name] ?? "●"}
              </span>
              <span className="font-semibold tracking-[0.18em]">{item.name}</span>
            </div>
            <div className="mono mt-1 text-neutral-600">
              {viewMode === "dollar" ? formatUsd(item.latestDollar) : formatPct(item.latestPct)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
