"use client";

import { useMemo } from "react";
import {
  Legend,
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
  CHART_REFERENCE_DASH,
  CHART_TEXT_MUTED,
  CHART_TICK_STYLE,
  CHART_TOOLTIP_STYLE,
} from "./chart-tokens";

interface RollingAlphaBetaChartProps {
  alpha: { date: string; value: number }[];
  beta: { date: string; value: number }[];
}

/**
 * Rolling Alpha & Beta chart.
 *
 * Two-line Recharts wrapper: alpha solid CHART_ACCENT (1.5px), beta
 * dashed CHART_TEXT_MUTED (1px) with strokeDasharray=CHART_REFERENCE_DASH.
 * Legend at top with lowercase Greek-letter labels.
 *
 * The two source series may not align by date (the lazy payload carries
 * `rolling_alpha` and `rolling_beta` independently). We merge by date key
 * inside a useMemo before passing to Recharts — same pattern as the
 * existing RollingMetrics component.
 *
 * Returns `null` only when BOTH alpha and beta are empty. If only one is
 * populated, the other Line is omitted but the chart still renders.
 */
export function RollingAlphaBetaChart({
  alpha,
  beta,
}: RollingAlphaBetaChartProps) {
  const merged = useMemo(() => {
    const dateMap = new Map<
      string,
      { date: string; alpha?: number; beta?: number }
    >();
    for (const p of alpha ?? []) {
      if (!dateMap.has(p.date)) dateMap.set(p.date, { date: p.date });
      dateMap.get(p.date)!.alpha = p.value;
    }
    for (const p of beta ?? []) {
      if (!dateMap.has(p.date)) dateMap.set(p.date, { date: p.date });
      dateMap.get(p.date)!.beta = p.value;
    }
    return Array.from(dateMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }, [alpha, beta]);

  if (merged.length === 0) return null;
  const hasAlpha = (alpha ?? []).length > 0;
  const hasBeta = (beta ?? []).length > 0;

  return (
    <div role="img" aria-label="Rolling alpha and beta">
      <ResponsiveContainer width="100%" height={250}>
        <LineChart
          accessibilityLayer={false}
          data={merged}
          margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
        >
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
            formatter={(v, name) => [Number(v).toFixed(3), String(name)]}
          />
          <Legend />
          {hasAlpha && (
            <Line
              type="monotone"
              dataKey="alpha"
              stroke={CHART_ACCENT}
              strokeWidth={1.5}
              dot={false}
            />
          )}
          {hasBeta && (
            <Line
              type="monotone"
              dataKey="beta"
              stroke={CHART_TEXT_MUTED}
              strokeWidth={1}
              strokeDasharray={CHART_REFERENCE_DASH}
              dot={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
