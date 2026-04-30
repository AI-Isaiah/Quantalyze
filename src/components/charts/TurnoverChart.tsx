"use client";

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART_ACCENT,
  CHART_BORDER,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_STYLE,
} from "./chart-tokens";

interface TurnoverChartProps {
  data: { date: string; value: number }[];
}

/**
 * Turnover chart.
 *
 * Single-line Recharts LineChart, height 200, CHART_ACCENT 1.5px stroke.
 * Y-axis renders percent with 1 decimal (`value` is the dimensionless
 * ratio `Σ|Δposition × price| / NAV`).
 *
 * Returns null on empty data — caller renders the empty-state banner.
 */
export function TurnoverChart({ data }: TurnoverChartProps) {
  if (!data || data.length === 0) return null;
  return (
    <div role="img" aria-label="Daily turnover as percent of NAV">
      <ResponsiveContainer width="100%" height={200}>
        <LineChart accessibilityLayer={false} data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
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
            tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Turnover"]}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={CHART_ACCENT}
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
