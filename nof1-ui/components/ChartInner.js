"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Customized,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { resolveModelIcon } from "../lib/modelIcons";

const MARGIN = { top: 32, right: 160, left: 8, bottom: 12 };
const DEFAULT_VALUE_FORMATTER = (value) => value ?? 0;
const DEFAULT_X_FORMATTER = (ts) =>
  new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
const X_AXIS_ID = "ts-axis";
const Y_AXIS_ID = "equity-axis";

function SvgModelIcon({ iconValue, x, y, size = 16 }) {
  const info = resolveModelIcon(iconValue);
  if (info?.type === "image" && info.src) {
    return (
      <image
        href={info.src}
        x={x}
        y={y}
        width={size}
        height={size}
        preserveAspectRatio="xMidYMid slice"
      />
    );
  }
  const text = info?.text ?? info?.value ?? "◎";
  return (
    <text
      x={x + size / 2}
      y={y + size * 0.75}
      textAnchor="middle"
      fontSize={size * 0.75}
    >
      {text}
    </text>
  );
}

function collectLatestPoints(series, data) {
  if (!series.length || !data.length) return [];
  return series
    .map((entry) => {
      for (let idx = data.length - 1; idx >= 0; idx -= 1) {
        const row = data[idx];
        const value = Number(row?.[entry.lineKey]);
        if (!Number.isFinite(value)) continue;
        return {
          lineKey: entry.lineKey,
          modelId: entry.modelId,
          name: entry.name,
          color: entry.color,
          iconValue: entry.iconValue,
          value,
          ts: row.ts,
          label: row.label,
        };
      }
      return null;
    })
    .filter(Boolean);
}

function HoverLayer({
  hover,
  lineEndings,
  valueFormatter,
  xFormatter,
  width,
  height,
  offset,
  xAxisMap,
  yAxisMap,
}) {
  if (!lineEndings.length) return null;
  const chartLeft = offset?.left ?? 0;
  const chartRight = width - (offset?.right ?? 0);
  const chartTop = offset?.top ?? 0;
  const chartBottom = height - (offset?.bottom ?? 0);

  const xAxisKey = Object.keys(xAxisMap ?? {})[0];
  const yAxisKey = Object.keys(yAxisMap ?? {})[0];
  const xScale = xAxisKey ? xAxisMap[xAxisKey]?.scale : null;
  const yScale = yAxisKey ? yAxisMap[yAxisKey]?.scale : null;

  const crosshairX =
    hover && xScale && Number.isFinite(hover.ts)
      ? xScale(hover.ts) + chartLeft
      : hover?.coordinate?.x ?? null;
  const crosshairYStart = chartTop;
  const crosshairYEnd = chartBottom;

  const focusEntry = hover
    ? lineEndings.find((entry) => entry.lineKey === hover.lineKey)
    : null;

  const formattedValue =
    hover && hover.value != null ? valueFormatter(hover.value) : null;

  const formattedTime =
    hover && hover.ts != null
      ? (typeof xFormatter === "function" ? xFormatter(hover.ts) : hover.label)
      : null;

  const topLabelWidth = 212;
  const labelX =
    crosshairX != null
      ? Math.min(
          Math.max(chartLeft + 8, crosshairX - topLabelWidth / 2),
          chartRight - topLabelWidth - 8,
        )
      : chartLeft + 8;
  const topLabelY = chartTop + 4;

  return (
    <g className="recharts-hover-layer" pointerEvents="none">
      {hover && crosshairX != null && (
        <>
          <line
            x1={crosshairX}
            x2={crosshairX}
            y1={crosshairYStart}
            y2={crosshairYEnd}
            stroke="#0f172a"
            strokeDasharray="4 4"
            strokeWidth={1}
            opacity={0.6}
          />
          <g transform={`translate(${labelX}, ${topLabelY})`}>
            <rect
              width={topLabelWidth}
              height={40}
              rx={10}
              fill="#fff"
              stroke={focusEntry?.color ?? "#0f172a"}
              strokeWidth={1}
            />
            {formattedTime && (
              <text
                x={16}
                y={16}
                fontSize={11}
                fontWeight={500}
                fill="#475569"
              >
                {formattedTime}
              </text>
            )}
            <text
              x={40}
              y={formattedTime ? 30 : 22}
              fontSize={12}
              fontWeight={600}
              fill="#0f172a"
            >
              {(focusEntry?.name ?? hover.name ?? "").toUpperCase()}
            </text>
            <text
              x={topLabelWidth - 12}
              y={formattedTime ? 30 : 22}
              fontSize={12}
              fontWeight={600}
              textAnchor="end"
              fill="#0f172a"
            >
              {formattedValue}
            </text>
            {focusEntry?.iconValue && (
              <SvgModelIcon iconValue={focusEntry.iconValue} x={12} y={8} size={16} />
            )}
          </g>
        </>
      )}

      {lineEndings.map((entry) => {
        const x = xScale ? xScale(entry.ts) + chartLeft : chartRight - 20;
        const y = yScale ? yScale(entry.value) + chartTop : chartTop;
        const label = valueFormatter(entry.value);
        const bubbleWidth = Math.max(120, label.length * 6 + 70);
        const bubbleHeight = 28;
        const bubbleX = Math.min(chartRight - bubbleWidth, x + 8);
        const bubbleY = Math.min(
          chartBottom - bubbleHeight - 4,
          Math.max(chartTop + 4, y - bubbleHeight / 2),
        );
        const isFocused = hover?.lineKey === entry.lineKey;
        const bubbleFill = isFocused ? entry.color : "#fff";
        const textColor = isFocused ? "#fff" : "#0f172a";
        const opacity =
          hover && hover.lineKey !== entry.lineKey ? 0.35 : 1;

        return (
          <g
            key={entry.lineKey}
            transform={`translate(${bubbleX}, ${bubbleY})`}
            opacity={opacity}
          >
            <rect
              width={bubbleWidth}
              height={bubbleHeight}
              rx={bubbleHeight / 2}
              fill={bubbleFill}
              stroke={entry.color}
              strokeWidth={isFocused ? 1.4 : 0.9}
            />
            {entry.iconValue && (
              <SvgModelIcon iconValue={entry.iconValue} x={8} y={6} size={16} />
            )}
            <text
              x={32}
              y={18}
              fontSize={11}
              fontWeight={600}
              fill={textColor}
            >
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export default function ChartInner({
  data,
  series,
  yFormatter,
  valueFormatter,
  xFormatter,
}) {
  const formatValue = valueFormatter || DEFAULT_VALUE_FORMATTER;
  const formatX = xFormatter ?? DEFAULT_X_FORMATTER;
  const chartRef = useRef(null);
  const [hover, setHover] = useState(null);

  const lineEndings = useMemo(
    () => collectLatestPoints(series, data),
    [series, data],
  );

  const handleMouseMove = useCallback(
    (state) => {
      if (!state?.isTooltipActive || !state?.activePayload?.length) {
        setHover(null);
        return;
      }
      const axisMap = chartRef.current?.state?.yAxisMap ?? {};
      const axis = axisMap[Y_AXIS_ID];
      const pointerValue =
        axis && typeof axis.scale?.invert === "function"
          ? axis.scale.invert(state.chartY ?? 0)
          : null;
      let closest = null;
      let minDiff = Infinity;
      state.activePayload.forEach((payload) => {
        const val = Number(payload.payload?.[payload.dataKey]);
        if (!Number.isFinite(val)) return;
        const diff = pointerValue != null ? Math.abs(val - pointerValue) : 0;
        if (!closest || diff < minDiff) {
          closest = payload;
          minDiff = diff;
        }
      });
      if (!closest) {
        setHover(null);
        return;
      }
      const meta = series.find((item) => item.lineKey === closest.dataKey);
      const tsRaw = Number(closest.payload?.ts);
      const tsValue = Number.isFinite(tsRaw) ? tsRaw : null;
      const rawValue = Number(closest.payload?.[closest.dataKey]);
      setHover({
        ts: tsValue,
        lineKey: closest.dataKey,
        name: meta?.name ?? closest.name,
        value: Number.isFinite(rawValue) ? rawValue : null,
        label: closest.payload?.label ?? null,
        coordinate: state.activeCoordinate ?? { x: state.chartX, y: state.chartY },
      });
    },
    [series],
  );

  const handleMouseLeave = () => setHover(null);
  const focusKey = hover?.lineKey;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={data}
        margin={MARGIN}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        ref={chartRef}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
        <XAxis
          dataKey="ts"
          type="number"
          xAxisId={X_AXIS_ID}
          tick={{ fontSize: 12 }}
          tickFormatter={formatX}
          domain={["dataMin", "dataMax"]}
          allowDuplicatedCategory={false}
        />
        <YAxis
          yAxisId={Y_AXIS_ID}
          tick={{ fontSize: 12 }}
          tickFormatter={yFormatter}
          width={90}
          domain={["auto", "auto"]}
        />
        <Tooltip cursor={false} content={() => null} />
        {series.map((item) => {
          const isActive = !focusKey || focusKey === item.lineKey;
          const opacity = focusKey && focusKey !== item.lineKey ? 0.2 : 1;
          return (
            <Line
              key={item.lineKey}
              type="monotone"
              dataKey={item.lineKey}
              name={item.name}
              stroke={item.color}
              strokeDasharray={item.strokeDasharray}
              strokeWidth={isActive ? 3 : 1.8}
              strokeOpacity={opacity}
              yAxisId={Y_AXIS_ID}
              xAxisId={X_AXIS_ID}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          );
        })}
        <Customized
          component={(props) => (
            <HoverLayer
              {...props}
              hover={hover}
              lineEndings={lineEndings}
              valueFormatter={formatValue}
              xFormatter={formatX}
            />
          )}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
