"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import dynamic from "next/dynamic";
import { resolveModelIcon } from "../lib/modelIcons";
import CoinBadge from "./CoinBadge";

/**
 * ChartInner 图表组件（关闭 SSR，避免浏览器 API 报错）
 */
const ChartInner = dynamic(() => import("./ChartInner"), { ssr: false });

/** 用于 SWR 的 fetcher（返回 JSON） */
const fetcher = (url) => fetch(url).then((response) => response.json());

/** 美元格式化 */
const formatUsd = (value) =>
  `US$${Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** 百分比格式化（0.123 → "12.30%"） */
const formatPct = (value) => `${(Number(value) * 100).toFixed(2)}%`;

/** 切换美元 / 收益率显示 */
const VIEW_MODES = [
  { id: "dollar", label: "以美元查看", icon: "$" },
  { id: "percent", label: "以收益率查看", icon: "%" },
];

/** 选择时间窗口 */
const TIME_WINDOWS = [
  { id: "all", label: "ALL" },
  { id: "72h", label: "72H", hours: 72 },
];

/** 线条颜色组合（不足时循环使用） */
const COLOR_PALETTE = [
  "#2563EB",
  "#EA580C",
  "#16A34A",
  "#9333EA",
  "#DC2626",
  "#0EA5E9",
  "#F97316",
];

/** 基准模型 ID，用于过滤 card 以及判断虚线 */
const BASELINE_MODEL_ID = "btc_benchmark";

/**
 * 将模型的图标（可能是图片 / 文本）渲染成 <img> 或 <span>
 */
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

/**
 * ===========================
 * 将 API 返回的数据转换为图表专用格式
 * ===========================
 * 结构示例：
 * {
 *   ts: 1736849820000,
 *   time: "1/14 14:00",
 *   model_a: 10450,
 *   model_b: 10320,
 *   ...
 * }
 */
function deriveChartData(seriesMeta, viewMode) {
  if (!seriesMeta.length) return [];

  const timestampEntries = new Map();

  seriesMeta.forEach((series) => {
    series.points.forEach((point) => {
      // 兼容 timestamp / ts / time
      const ts = point.timestamp ?? point.ts ?? point.time;
      if (!ts) return;

      // 如果此时间点尚未初始化，先建一个对象
      if (!timestampEntries.has(ts)) {
        timestampEntries.set(ts, {
          ts,
          time: new Date(ts).toLocaleString("zh-CN", {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
          }),
        });
      }

      // 美元值 or 百分比值
      const rawDollar = Number(point.dollar_equity ?? point.equity ?? 0);
      const rawPercent = Number((point.cum_pnl_pct ?? 0) * 100);
      const value = viewMode === "dollar" ? rawDollar : rawPercent;

      // 给对应模型的 key 赋值
      timestampEntries.get(ts)[series.line_key] = value;
    });
  });

  // 转换为数组并按时间升序排序
  return Array.from(timestampEntries.values()).sort((a, b) => a.ts - b.ts);
}

/**
 * 图例（legend）数据：用于决定图表右上角小色块以及线条配置
 */
function deriveLegend(seriesMeta) {
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
      iconValue: series.icon,
      strokeDasharray: series.strokeDasharray,
      isBenchmark: Boolean(series.is_benchmark),
      latestDollar: latest.dollar_equity,
      latestPct: latest.cum_pnl_pct,
    };
  });
}

/**
 * 渲染卡片区：每个模型一张卡，显示最新权益、累计盈亏
 */
function deriveCards(models) {
  return (models ?? [])
    // 基准模型不显示在下方 card 区
    .filter((model) => model.model_id !== BASELINE_MODEL_ID)
    .map((model) => {
      const latest = Number(model.latest_equity ?? 0);
      const starting = Number(model.starting_equity ?? 10000);
      const pnlAbs = latest - starting;
      const pnlPct = starting ? pnlAbs / starting : 0;

      return {
        modelId: model.model_id,
        name: model.display_name,
        color: model.color_hex ?? "#111827",
        iconValue: model.display_icon,
        latestDollar: latest,
        pnlAbs,
        pnlPct,
        isBenchmark: false,
      };
    });
}

export default function ChartPanel() {
  /** 当前查看模式：美元/收益率 */
  const [viewMode, setViewMode] = useState("dollar");
  /** 当前时间窗口：all / 72h */
  const [timeWindow, setTimeWindow] = useState("all");

  /**
   * ===========================
   * SWR：自动从后端获取时间序列数据、模型配置
   * ===========================
   */

  // tick 刷新图表，每 5 秒更新
  const { data: timeseriesData } = useSWR("/api/performance/timeseries", fetcher, {
    refreshInterval: 5000,
    dedupingInterval: 0,
    revalidateOnFocus: true,
  });

  // 获取模型配置
  const { data: modelsData } = useSWR("/api/models", fetcher);

  /**
   * ===========================
   * 构建 seriesMeta：给每条线补充颜色 / 基准线判断等信息
   * ===========================
   */
  const rawSeries = timeseriesData?.series ?? [];
  const seriesMeta = useMemo(
    () =>
      rawSeries.map((series, idx) => {
        const color = series.color ?? COLOR_PALETTE[idx % COLOR_PALETTE.length];
        const isBenchmark = series.is_benchmark ?? series.model_id === BASELINE_MODEL_ID;

        return {
          ...series,
          color,
          icon: series.icon,
          strokeDasharray: series.strokeDasharray ?? (isBenchmark ? "5 4" : undefined),
          is_benchmark: isBenchmark,
        };
      }),
    [rawSeries],
  );

  /** 转换为图表可用数据结构 */
  const chartData = useMemo(
    () => deriveChartData(seriesMeta, viewMode),
    [seriesMeta, viewMode],
  );

  /**
   * ===========================
   * 过滤图表数据（按 72h / 全部）
   * ===========================
   */
  const filteredChartData = useMemo(() => {
    if (!chartData.length) return [];
    if (timeWindow === "all") return chartData;

    const meta = TIME_WINDOWS.find((item) => item.id === timeWindow);
    if (!meta?.hours) return chartData;

    const cutoff = Date.now() - meta.hours * 60 * 60 * 1000;
    return chartData.filter((row) => (row.ts ?? row.timestamp ?? 0) >= cutoff);
  }, [chartData, timeWindow]);

  /** 图例数据 */
  const legendData = useMemo(() => deriveLegend(seriesMeta), [seriesMeta]);

  /** 卡片区数据 */
  const cards = useMemo(() => deriveCards(modelsData?.models ?? []), [modelsData]);

  /** map：modelId → 名称，用于显示领先模型/落后模型 */
  const nameLookup = useMemo(() => {
    const map = new Map();
    legendData.forEach((item) => map.set(item.modelId, item.name));
    return map;
  }, [legendData]);

  /** 最强 / 最弱模型显示名称 */
  const highestName = timeseriesData?.highest?.model_id
    ? nameLookup.get(timeseriesData.highest.model_id) ??
      timeseriesData.highest.model_id
    : null;
  const lowestName = timeseriesData?.lowest?.model_id
    ? nameLookup.get(timeseriesData.lowest.model_id) ??
      timeseriesData.lowest.model_id
    : null;

  /** Y 轴格式化：根据模式显示 $ 或 % */
  const yFormatter =
    viewMode === "dollar"
      ? (value) =>
          `US$${Number(value).toLocaleString("zh-CN", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          })}`
      : (value) => `${value}%`;

  /** tooltip 格式：悬浮提示框显示数值 */
  const tooltipFormatter =
    viewMode === "dollar"
      ? (value) => formatUsd(Number(value))
      : (value) => `${Number(value).toFixed(2)}%`;

  /**
   * ===========================
   * UI 渲染
   * ===========================
   */
  return (
    <section className="flex h-full min-h-[620px] flex-col rounded border border-neutral-200 bg-white px-5 py-4 shadow-sm">
      {/* 顶部区域：切换按钮 + 标题 + 时间窗口 */}
      <div className="relative flex items-center justify-between">
        {/* 左：切换美元 / 收益率 */}
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

        {/* 中：标题 + 领先/落后模型 */}
        <div className="absolute left-1/2 top-0 flex -translate-x-1/2 flex-col items-center">
          <div className="mono text-xs tracking-[0.25em]">账户总权益</div>
          {(highestName || lowestName) && (
            <div className="mt-1 whitespace-nowrap text-xs text-neutral-500">
              领先模型：{highestName ?? "—"} | 落后模型：{lowestName ?? "—"} | 基准：BTC BUY&HOLD
            </div>
          )}
        </div>

        {/* 右：切换 ALL / 72H */}
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
      <div className="mt-3 flex-1 min-h-0">
        <ChartInner
          data={filteredChartData}
          series={legendData}
          yFormatter={yFormatter}
          valueFormatter={tooltipFormatter}
        />
      </div>

      {/* 下方卡片区：各模型最新表现 */}
      <div className="mt-4 grid grid-cols-1 gap-3 border-t pt-3 text-xs sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
        {cards.map((item) => (
          <div
            key={item.modelId}
            className="flex flex-col justify-between rounded-xl border border-neutral-300 bg-white px-3 py-2 shadow-sm"
          >
            {/* 模型标题（图标 + 名字） */}
            <div className="flex items-center gap-2">
              <span aria-hidden className="text-base" style={{ color: item.color }}>
                {item.isBenchmark ? (
                  <CoinBadge symbol="BTC" size={22} />
                ) : (
                  renderIcon(item.iconValue)
                )}
              </span>
              <span className="font-semibold tracking-[0.18em]">{item.name}</span>
            </div>

            {/* 最新账户权益 */}
            <div className="mono mt-1 text-neutral-900 text-sm">
              总权益 {formatUsd(item.latestDollar)}
            </div>

            {/* 累计盈亏 */}
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
