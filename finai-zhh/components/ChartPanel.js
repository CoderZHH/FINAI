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
const BASELINE_COLOR = "rgb(246, 146, 26)";

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
  return String(modelId ?? "").trim().toLowerCase().startsWith(BASELINE_MODEL_PREFIX);
}

function isLikelyBenchmark(seriesOrModel = {}) {
  const modelId = String(seriesOrModel?.model_id ?? seriesOrModel?.modelId ?? "");
  return (
    Boolean(seriesOrModel?.is_benchmark) ||
    Boolean(seriesOrModel?.isBenchmark) ||
    isBaselineModelId(modelId)
  );
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

      const rawDollarSource = point.dollar_equity ?? point.equity;
      const parsedDollar =
        rawDollarSource == null ? null : Number(rawDollarSource);
      const rawDollar =
        Number.isFinite(parsedDollar) && parsedDollar > 0 ? parsedDollar : null;
      const parsedPercent =
        point.cum_pnl_pct == null ? null : Number(point.cum_pnl_pct);
      const rawPercent =
        Number.isFinite(parsedPercent) ? parsedPercent * 100 : null;
      const value = viewMode === "dollar" ? rawDollar : rawPercent;

      timestampEntries.get(tsBucket)[series.line_key] = value;
    });
  });

  const rows = Array.from(timestampEntries.values()).sort((a, b) => a.ts - b.ts);

  // 模型创建前保持 null，不补 0；创建后只延续最近一个有效值。
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
    const isBenchmark = Boolean(series?.is_benchmark) || isBaselineModelId(series?.model_id);
    const latest = series.points.at(-1) ?? {
      dollar_equity: 0,
      cum_pnl_pct: 0,
    };
    return {
      lineKey: series.line_key,
      modelId: series.model_id,
      name: series.name,
      color: isBenchmark ? BASELINE_COLOR : series.color,
      iconValue:
        iconLookup?.get(series.model_id) ??
        series.icon ??
        series.iconValue ??
        null,
      strokeDasharray: series.strokeDasharray,
      isBenchmark,
      latestDollar: latest.dollar_equity,
      latestPct: latest.cum_pnl_pct,
    };
  });
}

function findLastFiniteValue(rows, lineKey) {
  if (!Array.isArray(rows) || !lineKey) return NaN;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const v = Number(rows[i]?.[lineKey]);
    if (Number.isFinite(v)) return v;
  }
  return NaN;
}

/** 下方卡片（与图表系列保持一致） */
function deriveCards(models, legendData, chartRows) {
  const modelById = new Map();
  (models ?? []).forEach((model) => {
    const modelId = String(model?.model_id ?? "");
    if (modelId) modelById.set(modelId, model);
  });

  // 卡片与 legend 一一对应：图上有线，就有卡片
  return (legendData ?? [])
    .map((entry) => {
      const modelId = String(entry?.modelId ?? entry?.model_id ?? "");
      if (!modelId) return null;
      const model = modelById.get(modelId) ?? {};
      const isBenchmark = Boolean(entry?.isBenchmark) || isBaselineModelId(modelId);
      let latest = Number(entry?.latestDollar ?? NaN);
      if (!Number.isFinite(latest)) {
        latest = findLastFiniteValue(chartRows, entry?.lineKey);
      }
      if (!Number.isFinite(latest)) {
        latest = Number(model?.latest_equity ?? NaN);
      }
      if (!Number.isFinite(latest)) return null;

      const modelStarting = Number(model.starting_equity ?? NaN);
      let pnlPct = Number(entry?.latestPct ?? NaN);
      if (!Number.isFinite(pnlPct)) {
        pnlPct =
          Number.isFinite(modelStarting) && modelStarting > 0
            ? latest / modelStarting - 1
            : 0;
      }

      let starting = modelStarting;
      if (!Number.isFinite(starting) || starting <= 0) {
        const denominator = 1 + pnlPct;
        starting =
          Number.isFinite(denominator) && denominator !== 0
            ? latest / denominator
            : 10000;
      }
      if (!Number.isFinite(starting)) starting = 10000;

      return {
        modelId,
        name: model.display_name ?? entry?.name ?? modelId,
        color: isBenchmark ? BASELINE_COLOR : (entry?.color ?? model.color_hex ?? "#111827"),
        latestDollar: latest,
        pnlAbs: latest - starting,
        pnlPct,
        iconValue: model.display_icon ?? entry?.iconValue ?? null,
        isBenchmark,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.isBenchmark && !b.isBenchmark) return -1;
      if (!a.isBenchmark && b.isBenchmark) return 1;
      return String(a.name ?? "").localeCompare(String(b.name ?? ""));
    });
}

export default function ChartPanel() {
  const [viewMode, setViewMode] = useState("dollar");
  const [timeWindow, setTimeWindow] = useState("all");
  const [activeModelId, setActiveModelId] = useState(null);

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
        const isBenchmark = Boolean(series?.is_benchmark) || isBaselineModelId(series?.model_id);
        const color = isBenchmark
          ? BASELINE_COLOR
          : (series.color ?? COLOR_PALETTE[idx % COLOR_PALETTE.length]);

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
        legendData,
        chartData,
      ),
    [modelsData, legendData, chartData],
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
          activeModelId={activeModelId}
          onActiveModelChange={setActiveModelId}
        />
      </div>

      {/* 下方卡片区 */}
      <div className="mt-4 border-t pt-3 text-xs">
        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2">
          {cards.map((item) => (
            <div
              key={item.modelId}
              onMouseEnter={() => setActiveModelId(item.modelId)}
              onMouseLeave={() => setActiveModelId(null)}
              className={`flex min-h-[108px] w-[240px] shrink-0 flex-col justify-between rounded-xl border bg-white px-3 py-2 shadow-sm transition ${
                activeModelId === item.modelId
                  ? "border-neutral-900 shadow-md"
                  : "border-neutral-300"
              }`}
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
                <span className="text-[15px] font-semibold tracking-[0.08em] leading-none">
                  {item.name}
                </span>
              </div>

              <div className="mono mt-1 text-[15px] leading-snug text-neutral-900">
                总权益 {formatUsd(item.latestDollar)}
              </div>

              <div
                className={`text-[12px] font-semibold leading-snug ${
                  item.pnlAbs >= 0 ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                累计盈亏 {formatUsd(item.pnlAbs)}（{formatPct(item.pnlPct)}）
              </div>
            </div>
          ))}
          </div>
        </div>
      </div>
    </section>
  );
}
