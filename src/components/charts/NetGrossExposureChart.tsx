"use client";

import {
  Area,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
 * net long vs net short at a glance. Y-axis tickFormatter renders percent.
 *
 * Returns null on empty data — caller renders the empty-state banner.
 *
 * Decimal-fraction convention: `gross`/`net` are dimensionless ratios.
 * Y-axis multiplies by 100 for display.
 */
export function NetGrossExposureChart({ data }: NetGrossExposureChartProps) {
  if (!data || data.length === 0) return null;
  return (
    <div role="img" aria-label="Net and gross exposure over time">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
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
            formatter={(v, name) => [`${(Number(v) * 100).toFixed(1)}%`, String(name)]}
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
