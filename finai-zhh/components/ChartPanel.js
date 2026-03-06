"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import dynamic from "next/dynamic";
import { resolveModelIcon, normaliseIconValue, DEFAULT_MODEL_ICON } from "../lib/llm/modelIcons";
import CoinBadge from "./CoinBadge";

/** 关闭 SSR 的图表组件 */
const ChartInner = dynamic(() => import("./ChartInner"), { ssr: false });

const fetcher = (url) => fetch(url).then((response) => response.json());

const formatUsd = (value) =>
  `US$${Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const formatPct = (value) => `${(Number(value) * 100).toFixed(2)}%`;

const VIEW_MODES = [
  { id: "dollar", label: "以美元查看", icon: "$" },
  { id: "percent", label: "以收益率查看", icon: "%" },
];

const TIME_WINDOWS = [
  { id: "all", label: "ALL" },
  { id: "72h", label: "72H", hours: 72 },
];

const COLOR_PALETTE = [
  "#2563EB",
  "#EA580C",
  "#16A34A",
  "#9333EA",
  "#DC2626",
  "#0EA5E9",
  "#F97316",
];

const BASELINE_MODEL_PREFIX = "btc_benchmark";
const PROVIDER_DEFAULT_BASE_URL = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  qwen: "https://dashscope.aliyuncs.com",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  moonshot: "https://api.moonshot.ai/v1",
  xai_grok: "https://api.x.ai/v1",
  doubao: "https://ark.cn-beijing.volces.com/api/v3",
  minimax: "https://api.minimax.io/v1",
  wenxin: "https://api.baidu.com/ernie-bot/v1",
  custom: "",
};

const PROVIDER_ICON_MAP = {
  openai: "icon:gpt",
  deepseek: "icon:deepseek",
  anthropic: "icon:claude",
  gemini: "icon:gemini",
  qwen: "icon:qwen",
  zhipu: "icon:zhipu",
  moonshot: "icon:kimi",
  xai_grok: "icon:grok",
  doubao: "icon:doubao",
  minimax: "icon:minimax",
  wenxin: "icon:wenxin",
  custom: DEFAULT_MODEL_ICON,
};

function inferProviderFromBaseUrl(baseUrl = "") {
  const normalized = baseUrl.trim().toLowerCase();
  if (!normalized) return "custom";
  const match = Object.entries(PROVIDER_DEFAULT_BASE_URL).find(
    ([, url]) => url && url.trim().toLowerCase() === normalized
  );
  return (match?.[0] ?? "custom");
}

function resolveIconForModel(model) {
  const rawIcon = normaliseIconValue(model?.display_icon ?? model?.icon ?? "");
  const provider = inferProviderFromBaseUrl(model?.api_base_url ?? "");
  const providerIcon = PROVIDER_ICON_MAP[provider] || DEFAULT_MODEL_ICON;

  if (!rawIcon) return providerIcon;
  if (rawIcon === DEFAULT_MODEL_ICON && provider && provider !== "openai") {
    return providerIcon;
  }
  return rawIcon;
}

function isBaselineModelId(modelId) {
  return String(modelId ?? "").startsWith(BASELINE_MODEL_PREFIX);
}

function renderIcon(iconValue) {
  const info = resolveModelIcon(iconValue);
  if (info.type === "image") {
    return (
      <img
        src={info.src}
        alt={info.alt ?? "模型图标"}
        className="h-5 w-5 rounded-full object-contain"
      />
    );
  }
  return <span>{info.text ?? info.value}</span>;
}

function formatTimestampLabel(ts) {
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TS_BUCKET_MS = 1000;

function bucketTimestamp(tsRaw) {
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return null;
  return Math.round(ts / TS_BUCKET_MS) * TS_BUCKET_MS;
}

/** 把后端返回的 series 转成 Recharts 用的数据结构 */
function deriveChartData(seriesMeta, viewMode) {
  if (!seriesMeta.length) return [];

  const timestampEntries = new Map();

  seriesMeta.forEach((series) => {
    series.points.forEach((point) => {
      const tsBucket = bucketTimestamp(point.timestamp ?? point.ts ?? point.time);
      if (tsBucket == null) return;

      if (!timestampEntries.has(tsBucket)) {
        timestampEntries.set(tsBucket, {
          ts: tsBucket,
          label: formatTimestampLabel(tsBucket),
        });
      }

      const rawDollar = Number(point.dollar_equity ?? point.equity ?? 0);
      const rawPercent = Number((point.cum_pnl_pct ?? 0) * 100);
      const value = viewMode === "dollar" ? rawDollar : rawPercent;

      timestampEntries.get(tsBucket)[series.line_key] = value;
    });
  });

  const rows = Array.from(timestampEntries.values()).sort((a, b) => a.ts - b.ts);

  // 对每条线做前值延续，避免“不同模型更新时刻不一致”造成的密集断点
  seriesMeta.forEach((series) => {
    let hasStarted = false;
    let lastValue = null;
    rows.forEach((row) => {
      const parsed = Number(row[series.line_key]);
      if (Number.isFinite(parsed)) {
        row[series.line_key] = parsed;
        hasStarted = true;
        lastValue = parsed;
        return;
      }
      row[series.line_key] = hasStarted ? lastValue : null;
    });
  });

  return rows;
}

/** 右侧 legend / 每条线的配置 */
function deriveLegend(seriesMeta, iconLookup) {
  return seriesMeta.map((series) => {
    const latest = series.points.at(-1) ?? {
      dollar_equity: 0,
      cum_pnl_pct: 0,
    };
    return {
      lineKey: series.line_key,
      modelId: series.model_id,
      name: series.name,
      color: series.color,
      iconValue:
        iconLookup?.get(series.model_id) ??
        series.icon ??
        series.iconValue ??
        null,
      strokeDasharray: series.strokeDasharray,
      isBenchmark: Boolean(series.is_benchmark),
      latestDollar: latest.dollar_equity,
      latestPct: latest.cum_pnl_pct,
    };
  });
}

/** 下方卡片 */
function deriveCards(models, seriesMeta) {
  const benchmarkModelIds = new Set(
    (seriesMeta ?? [])
      .filter((series) => Boolean(series?.is_benchmark))
      .map((series) => String(series.model_id ?? ""))
      .filter(Boolean)
  );
  const latestByModel = new Map();
  (seriesMeta ?? []).forEach((series) => {
    const latestPoint = series.points?.at(-1) ?? {};
    latestByModel.set(series.model_id, {
      latestDollar: Number(latestPoint.dollar_equity ?? 0),
      pnlPct: Number(latestPoint.cum_pnl_pct ?? 0),
    });
  });

  return (models ?? [])
    .filter((model) => {
      const modelId = String(model?.model_id ?? "");
      const displayName = String(model?.display_name ?? "").trim().toLowerCase();
      if (!modelId) return false;
      if (isBaselineModelId(modelId)) return false;
      if (benchmarkModelIds.has(modelId)) return false;
      if (displayName.includes("benchmark")) return false;
      return true;
    })
    .map((model) => {
      const seriesEntry = latestByModel.get(model.model_id);
      if (!seriesEntry) {
        // 若缺少时间序列，跳过该模型卡片，避免前端直接抛错
        return null;
      }

      const latest = Number(seriesEntry.latestDollar ?? NaN);
      const pctFromSeries = Number(seriesEntry.pnlPct ?? NaN);
      if (!Number.isFinite(latest) || !Number.isFinite(pctFromSeries)) {
        throw new Error(
          `模型 ${model.model_id} 时间序列数据异常，无法计算盈亏。`
        );
      }

      // 通过累计收益率反推起始权益
      const starting = latest / (1 + pctFromSeries);
      const pnlAbs = latest - starting;
      const pnlPct = pctFromSeries;

      return {
        modelId: model.model_id,
        name: model.display_name,
        color: model.color_hex ?? "#111827",
        latestDollar: latest,
        pnlAbs,
        pnlPct,
        iconValue: model.display_icon,
        isBenchmark: false,
      };
    })
    .filter(Boolean);
}

export default function ChartPanel() {
  const [viewMode, setViewMode] = useState("dollar");
  const [timeWindow, setTimeWindow] = useState("all");

  const { data: timeseriesData } = useSWR(
    "/api/performance/timeseries",
    fetcher,
    {
      refreshInterval: 5000,
      dedupingInterval: 0,
      revalidateOnFocus: true,
    },
  );
  const { data: modelsData } = useSWR("/api/models", fetcher);

  const rawSeries = timeseriesData?.series ?? [];
  const seriesMeta = useMemo(
    () =>
      rawSeries.map((series, idx) => {
        const color =
          series.color ?? COLOR_PALETTE[idx % COLOR_PALETTE.length];
        const isBenchmark =
          series.is_benchmark ?? isBaselineModelId(series.model_id);

        return {
          ...series,
          color,
          strokeDasharray:
            series.strokeDasharray ?? (isBenchmark ? "5 4" : undefined),
          is_benchmark: isBenchmark,
        };
      }),
    [rawSeries],
  );

  const chartData = useMemo(
    () => deriveChartData(seriesMeta, viewMode),
    [seriesMeta, viewMode],
  );

  /** 过滤时间窗口 */
  const filteredChartData = useMemo(() => {
    if (!chartData.length) return [];
    if (timeWindow === "all") return chartData;

    const meta = TIME_WINDOWS.find((item) => item.id === timeWindow);
    if (!meta?.hours) return chartData;

    const cutoff = Date.now() - meta.hours * 60 * 60 * 1000;
    return chartData.filter((row) => (row.ts ?? row.timestamp ?? 0) >= cutoff);
  }, [chartData, timeWindow]);

  const iconLookup = useMemo(() => {
    const map = new Map();
    (modelsData?.models ?? []).forEach((model) => {
      if (model?.model_id) {
        map.set(model.model_id, resolveIconForModel(model));
      }
    });
    return map;
  }, [modelsData]);

  const legendData = useMemo(
    () => deriveLegend(seriesMeta, iconLookup),
    [seriesMeta, iconLookup],
  );

  const cards = useMemo(
    () =>
      deriveCards(
        (modelsData?.models ?? []).map((model) => ({
          ...model,
          display_icon: resolveIconForModel(model),
        })),
        seriesMeta,
      ),
    [modelsData, seriesMeta],
  );

  const nameLookup = useMemo(() => {
    const map = new Map();
    legendData.forEach((item) => map.set(item.modelId, item.name));
    return map;
  }, [legendData]);

  const highestName = timeseriesData?.highest?.model_id
    ? nameLookup.get(timeseriesData.highest.model_id) ??
      timeseriesData.highest.model_id
    : null;
  const lowestName = timeseriesData?.lowest?.model_id
    ? nameLookup.get(timeseriesData.lowest.model_id) ??
      timeseriesData.lowest.model_id
    : null;

  const yFormatter =
    viewMode === "dollar"
      ? (value) =>
          `US$${Number(value).toLocaleString("zh-CN", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })}`
      : (value) => `${value}%`;

  const tooltipFormatter =
    viewMode === "dollar"
      ? (value) => formatUsd(Number(value))
      : (value) => `${Number(value).toFixed(2)}%`;

  return (
    <section className="flex h-full min-h-[620px] flex-col rounded border border-neutral-200 bg-white px-5 py-4 shadow-sm">
      {/* 顶部：切换按钮 + 标题 + 时间窗口 */}
      <div className="relative flex items-center justify-between">
        {/* 左：$/% */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex overflow-hidden rounded border border-neutral-900">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.id}
                onClick={() => setViewMode(mode.id)}
                aria-label={mode.label}
                className={`px-3 py-1 text-xs font-semibold ${
                  viewMode === mode.id
                    ? "bg-neutral-900 text-white"
                    : "bg-white text-neutral-800"
                }`}
              >
                {mode.icon}
              </button>
            ))}
          </div>
        </div>

        {/* 中：标题 + 领先/落后 */}
        <div className="absolute left-1/2 top-0 flex -translate-x-1/2 flex-col items-center">
          <div className="mono text-xs tracking-[0.25em]">账户总权益</div>
          {(highestName || lowestName) && (
            <div className="mt-1 whitespace-nowrap text-xs text-neutral-500">
              领先模型：{highestName ?? "—"} | 落后模型：
              {lowestName ?? "—"} | 基准：BTC BUY&amp;HOLD
            </div>
          )}
        </div>

        {/* 右：时间窗口 ALL / 72H */}
        <div className="flex items-center gap-2 text-xs">
          <div className="flex overflow-hidden rounded border border-neutral-900">
            {TIME_WINDOWS.map((item) => (
              <button
                key={item.id}
                onClick={() => setTimeWindow(item.id)}
                className={`px-3 py-1 text-xs font-semibold ${
                  timeWindow === item.id
                    ? "bg-neutral-900 text-white"
                    : "bg-white text-neutral-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 图表区域 */}
      <div className="mt-3 flex-1 min-w-0 min-h-[320px]">
        <ChartInner
          data={filteredChartData}
          series={legendData}
          yFormatter={yFormatter}
          valueFormatter={tooltipFormatter}
          xFormatter={formatTimestampLabel}
        />
      </div>

      {/* 下方卡片区 */}
      <div className="mt-4 grid grid-cols-1 gap-3 border-t pt-3 text-xs sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
        {cards.map((item) => (
          <div
            key={item.modelId}
            className="flex flex-col justify-between rounded-xl border border-neutral-300 bg-white px-3 py-2 shadow-sm"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="text-base"
                style={{ color: item.color }}
              >
                {item.isBenchmark ? (
                  <CoinBadge symbol="BTC" size={22} />
                ) : (
                  renderIcon(item.iconValue)
                )}
              </span>
              <span className="font-semibold tracking-[0.18em]">
                {item.name}
              </span>
            </div>

            <div className="mono mt-1 text-neutral-900 text-sm">
              总权益 {formatUsd(item.latestDollar)}
            </div>

            <div
              className={`text-[11px] font-semibold ${
                item.pnlAbs >= 0 ? "text-emerald-600" : "text-rose-600"
              }`}
            >
              累计盈亏 {formatUsd(item.pnlAbs)}（{formatPct(item.pnlPct)}）
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
