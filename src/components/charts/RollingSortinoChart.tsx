"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  CHART_ACCENT,
  CHART_BORDER,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_STYLE,
} from "./chart-tokens";

interface RollingSortinoChartProps {
  data: { date: string; value: number }[];
}

/**
 * Phase 14b-03 / KPI-10 — Rolling Sortino chart.
 *
 * Single-line Recharts wrapper. Identical structure to
 * RollingVolatilityChart but Y-axis renders as a unitless ratio
 * (`v.toFixed(2)`) — Sortino is a ratio, not a percent. Returns `null`
 * on empty data.
 */
export function RollingSortinoChart({ data }: RollingSortinoChartProps) {
  if (!data || data.length === 0) return null;
  return (
    <div role="img" aria-label="Rolling Sortino">
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
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v) => [Number(v).toFixed(2), "Sortino"]}
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
