"use client";

import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { TouchTooltip } from "./TouchTooltip";
import { RollingXAxis } from "./EdgeFitXTick";
import { formatFixedSigned } from "@/lib/factsheet/display-sign";
import {
  CHART_ACCENT,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_STYLE,
} from "./chart-tokens";

interface RollingSortinoChartProps {
  data: { date: string; value: number }[];
}

/**
 * Rolling Sortino chart.
 *
 * Single-line Recharts wrapper. Identical structure to
 * RollingVolatilityChart but Y-axis renders as a unitless ratio
 * (2 dp, through the shared sign rule) — Sortino is a ratio, not a percent. Returns `null`
 * on empty data.
 */
export function RollingSortinoChart({ data }: RollingSortinoChartProps) {
  if (!data || data.length === 0) return null;
  return (
    <div role="img" aria-label="Rolling Sortino">
      <ResponsiveContainer width="100%" height={250}>
        <LineChart accessibilityLayer={false} data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <RollingXAxis dates={data.map((d) => d.date)} />
          <YAxis
            tick={CHART_TICK_STYLE}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatFixedSigned(v, { dp: 2 })}
          />
          <TouchTooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v) => [formatFixedSigned(Number(v), { dp: 2 }), "Sortino"]}
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
