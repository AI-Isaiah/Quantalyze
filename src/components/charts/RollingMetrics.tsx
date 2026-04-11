"use client";

import { useMemo } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import {
  CHART_ACCENT,
  CHART_AXIS_TICK,
  CHART_BORDER,
  CHART_FONT_MONO,
  CHART_REFERENCE_DASH,
  CHART_TEXT_MUTED,
  CHART_TEXT_SECONDARY,
} from "./chart-tokens";

interface RollingMetricsProps {
  data: Record<string, { date: string; value: number }[]>;
  /**
   * Overall (all-time) Sharpe ratio for this strategy. When provided,
   * renders as a dashed horizontal reference line labeled "avg" so
   * allocators can see whether the recent rolling window is above or
   * below the strategy's long-run average.
   */
  overallSharpe?: number | null;
}

const STROKE_BY_KEY: Record<string, string> = {
  sharpe_30d: CHART_TEXT_MUTED,
  sharpe_90d: CHART_TEXT_SECONDARY,
  sharpe_365d: CHART_ACCENT,
};

const LABELS: Record<string, string> = {
  sharpe_30d: "30d",
  sharpe_90d: "90d",
  sharpe_365d: "365d",
};

export function RollingMetrics({ data, overallSharpe }: RollingMetricsProps) {
  // Merge by date key (series have different lengths due to window sizes).
  // Memoized so the O(N·K) merge+sort runs once per `data` reference change
  // rather than on every parent render.
  const merged = useMemo(() => {
    const keys = Object.keys(data);
    if (keys.length === 0) return [];
    const dateMap = new Map<string, Record<string, string | number>>();
    for (const key of keys) {
      for (const point of data[key]) {
        if (!dateMap.has(point.date)) dateMap.set(point.date, { date: point.date });
        dateMap.get(point.date)![key] = point.value;
      }
    }
    return Array.from(dateMap.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date))
    );
  }, [data]);

  const keys = Object.keys(data);
  if (keys.length === 0) return null;

  const hasAvg =
    typeof overallSharpe === "number" && Number.isFinite(overallSharpe);

  return (
    <ResponsiveContainer width="100%" height={250}>
      <LineChart data={merged} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
          tickLine={false}
          axisLine={{ stroke: CHART_BORDER }}
          tickFormatter={(d: string) => d.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{ fontSize: 12, borderColor: CHART_BORDER }}
          formatter={(v, name) => [Number(v).toFixed(2), LABELS[String(name)] ?? name]}
        />
        <Legend formatter={(name: string) => LABELS[name] ?? name} />
        {hasAvg && (
          <ReferenceLine
            y={overallSharpe as number}
            stroke={CHART_TEXT_MUTED}
            strokeDasharray={CHART_REFERENCE_DASH}
            label={{
              value: "avg",
              position: "right",
              fontSize: 10,
              fill: CHART_TEXT_SECONDARY,
            }}
          />
        )}
        {keys.map((key) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={STROKE_BY_KEY[key] ?? CHART_TEXT_MUTED}
            strokeWidth={1.5}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
