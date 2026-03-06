/**
 * ============================================================================
 * ChartInner - ECharts 图表封装组件
 * ============================================================================
 * 
 * 功能说明：
 * - 使用 ECharts 渲染折线图，用于展示模型权益、收益率等时序数据
 * - 支持多条折线同时显示（如多个模型的权益曲线对比）
 * - 提供自定义的格式化器、工具提示、终点标签等功能
 * - 响应式设计，自动适配窗口大小变化
 * 
 * 设计特点：
 * - 使用 ECharts 实例复用，避免频繁创建销毁
 * - 通过 useMemo 优化图表配置计算
 * - 支持自定义图标显示（文字或图片）在折线终点
 * - 平滑曲线渲染，提升视觉效果
 * 
 * ============================================================================
 */

"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts";
import { resolveModelIcon, normaliseIconValue } from "../lib/llm/modelIcons";

/**
 * 默认数值格式化器：将数值格式化为中文千分位格式，保留2位小数
 * @param {number} value - 原始数值
 * @returns {string} 格式化后的字符串，如 "10,000.00"
 */
const DEFAULT_VALUE_FORMATTER = (value) =>
  Number(value ?? 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * 默认 X 轴时间格式化器：将时间戳格式化为 "时:分" 格式
 * @param {number|Date} ts - 时间戳或日期对象
 * @returns {string} 格式化后的时间字符串，如 "15:30"
 */
const DEFAULT_X_FORMATTER = (ts) =>
  new Date(ts ?? Date.now()).toLocaleString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

const X_AXIS_ID = "ts-axis";
const Y_AXIS_ID = "equity-axis";

const SERIES_COLOR_MAP = {
  btc: "rgb(247, 147, 26)",
  "icon:claude": "rgb(255, 107, 54)",
  "icon:deepseek": "rgb(78, 107, 254)",
  "icon:doubao": "rgb(202, 228, 255)",
  "icon:gemini": "rgb(47, 166, 250)",
  "icon:gpt": "rgb(18, 163, 127)",
  "icon:gro": "rgb(0, 0, 0)",
  "icon:kimi": "rgb(81, 81, 81)",
  "icon:minimax": "rgb(233, 41, 112)",
  "icon:qwen": "rgb(106, 0, 225)",
  "icon:wenxin": "rgb(221, 247, 252)",
  "icon:zhipu": "rgb(255, 255, 255)",
};

const BTC_ICON = "/api/asset-logo?symbol=BTC";

function getSeriesColor(entry) {
  if (entry.isBenchmark || entry.modelId === "btc_benchmark") {
    return SERIES_COLOR_MAP.btc;
  }
  const normalized = entry.iconValue ? normaliseIconValue(entry.iconValue) : null;
  if (normalized && SERIES_COLOR_MAP[normalized]) {
    return SERIES_COLOR_MAP[normalized];
  }
  return entry.color ?? "rgb(37, 99, 235)";
}

function getContrastColor(rgbString) {
  if (!rgbString) return "#0f172a";
  const match = rgbString.match(/(\d+\.?\d*)/g);
  if (!match || match.length < 3) return "#0f172a";
  const [r, g, b] = match.slice(0, 3).map((v) => Number(v));
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0f172a" : "#ffffff";
}

function buildEndLabelConfig(seriesEntry, fillColor, latestValue, formatValue) {
  const isBenchmark = seriesEntry.isBenchmark || seriesEntry.modelId === "btc_benchmark";
  const iconInfo = isBenchmark
    ? { type: "image", src: BTC_ICON, value: "BTC" }
    : resolveModelIcon(seriesEntry.iconValue);
  const displayText =
    iconInfo.type === "text"
      ? iconInfo.text?.slice(0, 3)?.toUpperCase() ?? ""
      : "";
  const contrastColor = getContrastColor(fillColor);
  const valueText = latestValue != null ? formatValue(latestValue) : "";

  const baseCircle = {
    height: 34,
    width: 34,
    align: "center",
    lineHeight: 34,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: fillColor ?? "rgba(15, 23, 42, 0.85)",
    backgroundColor: "transparent",
  };

  let rich;
  let formatterText;

  if (iconInfo.type === "image" && iconInfo.src) {
    // 图片图标：直接使用图片样式 + 数值
    rich = {
      icon: {
        height: 34,
        width: 34,
        backgroundColor: {
          image: iconInfo.src,
        },
        borderRadius: 17, // 使用像素值而非999，ECharts对图片背景的borderRadius支持更好
        borderWidth: 2,
        borderColor: fillColor ?? "rgba(15, 23, 42, 0.85)",
      },
      value: {
        color: fillColor ?? "#0f172a",
        fontSize: 11,
        fontWeight: 600,
        padding: [0, 0, 0, 6],
      },
    };
    formatterText = `{icon| } {value|${valueText}}`;
  } else {
    // 文字图标：填充圆圈 + 文字 + 数值
    rich = {
      outer: {
        ...baseCircle,
        fontSize: 13,
        fontWeight: 600,
        color: contrastColor,
        backgroundColor: fillColor ?? "rgba(15, 23, 42, 0.85)",
      },
      value: {
        color: fillColor ?? "#0f172a",
        fontSize: 11,
        fontWeight: 600,
        padding: [0, 0, 0, 6],
      },
    };
    formatterText = displayText
      ? `{outer|${displayText}} {value|${valueText}}`
      : `{outer| } {value|${valueText}}`;
  }

  return {
    show: true,
    distance: 14,
    formatter() {
      return formatterText;
    },
    rich,
    padding: [0, 0],
    borderRadius: 999,
    borderColor: "transparent",
    borderWidth: 0,
  };
}

/**
 * ChartInner 主组件
 * 
 * @param {Object} props - 组件属性
 * @param {Array} props.data - 图表数据数组，每项包含时间戳和各系列的值
 * @param {Array} props.series - 系列配置数组，定义要显示的折线及其样式
 * @param {Function} [props.yFormatter] - Y 轴标签格式化函数
 * @param {Function} [props.valueFormatter] - 数值格式化函数
 * @param {Function} [props.xFormatter] - X 轴标签格式化函数
 */
export default function ChartInner({
  data,
  series,
  yFormatter,
  valueFormatter,
  xFormatter,
}) {
  // ECharts 容器 DOM 引用
  const containerRef = useRef(null);
  // ECharts 实例引用（复用实例以提升性能）
  const chartRef = useRef(null);

  // 使用传入的格式化器或默认格式化器
  const formatValue = valueFormatter || DEFAULT_VALUE_FORMATTER;
  const formatX = xFormatter || DEFAULT_X_FORMATTER;
  const formatY = yFormatter || ((v) => formatValue(v));

  /**
   * 构建 ECharts 配置对象
   * 使用 useMemo 缓存，仅在依赖项变化时重新计算
   */
  const chartOption = useMemo(() => {
    // 数据或系列为空时，返回空配置
    if (!data?.length || !series?.length) {
      return {
        xAxis: { type: "category" },
        yAxis: { type: "value" },
        series: [],
      };
    }

    // 构建 X 轴标签数组（时间点）
    const xAxisLabels = data.map((row) => {
      if (row.label) return row.label;
      if (row.ts != null) return formatX(row.ts);
      return "";
    });

    // 构建每条折线的配置
    let globalMin = Number.POSITIVE_INFINITY;
    let globalMax = Number.NEGATIVE_INFINITY;

    const seriesOptions = series.map((entry) => {
      // 提取该系列在每个时间点的数值
      const values = data.map((row) => {
        const raw = row[entry.lineKey];
        const parsed = Number(raw);
        if (Number.isFinite(parsed)) {
          globalMin = Math.min(globalMin, parsed);
          globalMax = Math.max(globalMax, parsed);
          return parsed;
        }
        return raw ?? null;
      });

      const seriesColor = getSeriesColor(entry);

      return {
        name: entry.name,
        type: "line",
        data: values,
        showSymbol: false, // 不显示数据点标记
        smooth: 0.2, // 平滑曲线（0-1之间，0为折线，1为最平滑）
        emphasis: { focus: "series" }, // 鼠标悬停时高亮整条系列
        blur: {
          // 其他系列虚化效果
          lineStyle: { opacity: 0.15 },
          itemStyle: { opacity: 0.15 },
        },
        lineStyle: {
          width: entry.isBenchmark ? 2.4 : 3, // 基准线稍细
          color: seriesColor,
        },
        itemStyle: {
          color: seriesColor,
        },
        endLabel: buildEndLabelConfig(
          entry,
          seriesColor,
          values.at(-1),
          formatValue
        ), // 终点标签
      };
    });

    const hasRange =
      Number.isFinite(globalMin) && Number.isFinite(globalMax) && globalMax > globalMin;
    const padding = hasRange ? Math.max((globalMax - globalMin) * 0.08, 1) : 1;
    const axisMin = Number.isFinite(globalMin) ? globalMin - padding : undefined;
    const axisMax = Number.isFinite(globalMax) ? globalMax + padding : undefined;

    return {
      animationDuration: 600, // 动画时长（毫秒）
      tooltip: {
        trigger: "axis", // 坐标轴触发，显示该时间点所有系列的值
        appendToBody: true,
        axisPointer: {
          type: "cross", // 十字准星指示器
          label: {
            backgroundColor: "#0f172a",
            formatter(params) {
              // X 轴显示原始标签，Y 轴显示格式化数值
              if (params.axisDimension === "x") {
                return params.value;
              }
              return formatY(params.value);
            },
          },
        },
        // 自定义工具提示内容
        formatter(params = []) {
          if (!params.length) return "";
          const dataIndex = params[0].dataIndex ?? 0;
          const header = xAxisLabels[dataIndex] ?? "";
          
          // 构建每个系列的数值行
          const rows = params
            .map((item) => {
              const val = formatValue(item.value);
              return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:2px;">
                  <span style="display:flex;align-items:center;gap:6px;">
                    <span style="width:10px;height:10px;border-radius:999px;background:${item.color};display:inline-block;"></span>
                    <span style="font-size:11px;color:#475569;">${item.seriesName}</span>
                  </span>
                  <span style="font-weight:600;color:#0f172a;">${val}</span>
                </div>`;
            })
            .join("");
          
          return `<div style="font-size:12px;">
              <div style="font-weight:600;color:#0f172a;margin-bottom:4px;">${header}</div>
              ${rows}
            </div>`;
        },
      },
      grid: { 
        left: 40,    // 左边距（为 Y 轴标签留空间）
        top: 40,     // 上边距
        right: 220,  // 右边距（为终点标签留足够空间，增加到220以容纳图标+数值）
        bottom: 30   // 下边距（为 X 轴标签留空间）
      },
      xAxis: {
        type: "category",
        data: xAxisLabels,
        axisTick: { show: false },
        axisLabel: {
          color: "#475569",
          formatter: (value) => value,
        },
      },
      yAxis: {
        type: "value",
        min: axisMin,
        max: axisMax,
        scale: true,
        axisLabel: {
          color: "#475569",
          formatter: (value) => formatY(value),
        },
        splitLine: {
          lineStyle: { type: "dashed", color: "#e5e7eb" },
        },
      },
      legend: {
        show: false, // 不显示图例（使用终点标签代替）
      },
      series: seriesOptions,
    };
  }, [data, series, formatValue, formatX, formatY]);

  /**
   * 初始化和更新 ECharts 实例
   */
  useEffect(() => {
    if (!containerRef.current) return;
    
    // 首次渲染时创建 ECharts 实例
    if (!chartRef.current) {
      chartRef.current = echarts.init(containerRef.current);
    }
    
    const chart = chartRef.current;
    // 设置配置（第二个参数 true 表示不合并配置，完全替换）
    chart.setOption(chartOption, true);
    
    // 监听窗口大小变化，自动调整图表尺寸
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    
    return () => {
      window.removeEventListener("resize", resize);
    };
  }, [chartOption]);

  /**
   * 组件卸载时销毁 ECharts 实例，释放资源
   */
  useEffect(
    () => () => {
      if (chartRef.current) {
        chartRef.current.dispose();
        chartRef.current = null;
      }
    },
    [],
  );

  return <div ref={containerRef} className="h-full w-full" />;
}
