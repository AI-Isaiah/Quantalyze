"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";

interface RollingMetricsProps {
  data: Record<string, { date: string; value: number }[]>;
}

const COLORS = ["#0D9488", "#6366F1", "#94A3B8"];
const LABELS: Record<string, string> = {
  sharpe_30d: "30d",
  sharpe_90d: "90d",
  sharpe_365d: "365d",
};

export function RollingMetrics({ data }: RollingMetricsProps) {
  const keys = Object.keys(data);
  if (keys.length === 0) return null;

  // Merge by date key (series have different lengths due to window sizes)
  const dateMap = new Map<string, Record<string, string | number>>();
  for (const key of keys) {
    for (const point of data[key]) {
      if (!dateMap.has(point.date)) dateMap.set(point.date, { date: point.date });
      dateMap.get(point.date)![key] = point.value;
    }
  }
  const merged = Array.from(dateMap.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={merged} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "#64748B" }}
          tickLine={false}
          axisLine={{ stroke: "#E2E8F0" }}
          tickFormatter={(d: string) => d.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#64748B", fontFamily: "'JetBrains Mono', monospace" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderColor: "#E2E8F0" }}
          formatter={(v, name) => [Number(v).toFixed(2), LABELS[String(name)] ?? name]}
        />
        <Legend formatter={(name: string) => LABELS[name] ?? name} />
        {keys.map((key, i) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={COLORS[i % COLORS.length]}
            strokeWidth={1.5}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
