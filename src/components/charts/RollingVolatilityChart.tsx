"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  CHART_ACCENT,
  CHART_BORDER,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_STYLE,
} from "./chart-tokens";

interface RollingVolatilityChartProps {
  data: { date: string; value: number }[];
}

/**
 * Phase 14b-03 / KPI-09 — Rolling Volatility chart.
 *
 * Single-line Recharts wrapper consuming `{ date, value }[]`. Stroke =
 * CHART_ACCENT (DESIGN.md identity). Y-axis renders as percent
 * (`0.21 → "21%"`); volatility is annualized stddev and is conventionally
 * rendered as a percent in quant tear-sheets. Returns `null` on empty
 * data so the parent can render the partial-data sub-banner cleanly.
 */
export function RollingVolatilityChart({ data }: RollingVolatilityChartProps) {
  if (!data || data.length === 0) return null;
  return (
    <div role="img" aria-label="Rolling volatility">
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
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
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Volatility"]}
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
