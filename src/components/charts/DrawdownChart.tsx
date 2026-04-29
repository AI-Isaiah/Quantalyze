"use client";

import { Area, AreaChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  CHART_ACCENT,
  CHART_BORDER,
  CHART_REFERENCE_DASH,
  CHART_TEXT_MUTED,
  CHART_TICK_STYLE,
} from "./chart-tokens";

interface DrawdownChartProps {
  data: { date: string; value: number }[];
  /**
   * Optional BTC benchmark series in the same shape as `data`.
   * When provided, DrawdownChart converts it to a running-max drawdown series
   * and overlays it as a dashed muted line (CHART_TEXT_MUTED, strokeDasharray
   * per CHART_REFERENCE_DASH). Pass `null` / omit to hide the overlay.
   */
  benchmarkSeries?: { date: string; value: number }[] | null;
}

/**
 * Merges strategy drawdown data with an optional benchmark drawdown series,
 * aligning by date so Recharts can render both on the same AreaChart.
 */
function mergeWithBenchmark(
  strategyData: { date: string; value: number }[],
  benchmarkSeries: { date: string; value: number }[] | null | undefined,
): { date: string; value: number; benchmarkDrawdown?: number }[] {
  if (!benchmarkSeries || benchmarkSeries.length === 0) {
    return strategyData.map((d) => ({ ...d }));
  }

  // Compute benchmark drawdown
  let bmMax = benchmarkSeries[0]?.value ?? 1;
  const bmDrawdownMap = new Map<string, number>();
  for (const d of benchmarkSeries) {
    bmMax = Math.max(bmMax, d.value);
    bmDrawdownMap.set(d.date, d.value / bmMax - 1);
  }

  return strategyData.map((d) => ({
    ...d,
    benchmarkDrawdown: bmDrawdownMap.get(d.date),
  }));
}

export function DrawdownChart({ data, benchmarkSeries }: DrawdownChartProps) {
  const hasBenchmark = Boolean(benchmarkSeries && benchmarkSeries.length > 0);
  const chartData = mergeWithBenchmark(data, benchmarkSeries);

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <defs>
          <linearGradient id="drawdown-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_ACCENT} stopOpacity={0.2} />
            <stop offset="100%" stopColor={CHART_ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tick={CHART_TICK_STYLE}
          tickLine={false}
          axisLine={{ stroke: CHART_BORDER }}
          tickFormatter={(d: string) => d.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={CHART_TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          domain={["dataMin", 0]}
        />
        <Tooltip
          formatter={(v, name) => [
            `${(Number(v) * 100).toFixed(2)}%`,
            name === "benchmarkDrawdown" ? "BTC" : "Drawdown",
          ]}
          contentStyle={{ fontSize: 12, borderColor: CHART_BORDER }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={CHART_ACCENT}
          strokeWidth={1.5}
          fill="url(#drawdown-fill)"
        />
        {hasBenchmark && (
          <Line
            type="monotone"
            dataKey="benchmarkDrawdown"
            stroke={CHART_TEXT_MUTED}
            strokeWidth={1}
            strokeDasharray={CHART_REFERENCE_DASH}
            dot={false}
            activeDot={false}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
