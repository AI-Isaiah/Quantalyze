"use client";

import {
  Area,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { formatUsd } from "@/lib/dollar-validation";
import { formatCurrency } from "@/lib/utils";
import { TouchTooltip } from "./TouchTooltip";
import {
  CHART_ACCENT,
  CHART_BORDER,
  CHART_REFERENCE_DASH,
  CHART_TEXT_MUTED,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_STYLE,
} from "./chart-tokens";

interface NetGrossExposureChartProps {
  data: { date: string; gross: number; net: number }[];
}

/**
 * Net & Gross Exposure chart.
 *
 * Recharts ComposedChart with two visual layers:
 *   - Gross: filled <Area> at CHART_ACCENT with fillOpacity 0.2 (no stroke).
 *   - Net:   solid <Line> at CHART_ACCENT 1.5px (no dot).
 *
 * Reference line at y=0 in dashed CHART_TEXT_MUTED so allocators can read
 * net long vs net short at a glance. Y-axis ticks render compact dollars.
 *
 * Returns null on empty data — caller renders the empty-state banner.
 *
 * Unit: `gross`/`net` are USD notional, summed from position snapshots and
 * rounded to cents by the analytics worker (ExposurePoint in
 * position_reconstruction.py). The axis formats them compactly ($53.5K) and the
 * tooltip in whole dollars ($53,505). They are never converted to a percent:
 * no NAV is in the series, so there is no denominator to divide by.
 */
export function NetGrossExposureChart({ data }: NetGrossExposureChartProps) {
  if (!data || data.length === 0) return null;
  return (
    <div role="img" aria-label="Net and gross exposure over time, USD notional">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart accessibilityLayer={false} data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
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
            tickFormatter={(v: number) => formatCurrency(v)}
          />
          <TouchTooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v, name) => [formatUsd(Number.isFinite(Number(v)) ? Number(v) : null), String(name)]}
          />
          <Legend />
          <ReferenceLine
            y={0}
            stroke={CHART_TEXT_MUTED}
            strokeDasharray={CHART_REFERENCE_DASH}
          />
          <Area
            type="monotone"
            dataKey="gross"
            name="Gross"
            fill={CHART_ACCENT}
            fillOpacity={0.2}
            stroke="none"
          />
          <Line
            type="monotone"
            dataKey="net"
            name="Net"
            stroke={CHART_ACCENT}
            strokeWidth={1.5}
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
