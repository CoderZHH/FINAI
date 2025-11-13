"use client";

// 该组件仅负责渲染图表，保持纯函数便于其它页面复用。
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from "recharts";

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card rounded p-2 text-xs">
      <div className="font-semibold">{label}</div>
      {payload.map((item) => (
        <div key={item.dataKey} className="flex gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
          <span className="text-neutral-600">{item.name}</span>
          <span className="font-medium">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

const defaultValueFormatter = (value) => value;

export default function ChartInner({ data, series, yFormatter, valueFormatter }) {
  // valueFormatter 允许外部传入自定义单位（例如美元 / 百分比）。
  const formatValue = valueFormatter || defaultValueFormatter;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="time" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={yFormatter} width={80} />
        <Tooltip content={<CustomTooltip />} formatter={(value) => formatValue(value)} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((item) => (
          <Line
            key={item.lineKey}
            type="linear"
            dataKey={item.lineKey}
            name={item.name}
            stroke={item.color}
            strokeDasharray={item.strokeDasharray}
            dot={false}
            strokeWidth={2}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
