"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import {
  CHART_BORDER,
  CHART_NEGATIVE,
  CHART_POSITIVE,
  CHART_TEXT_MUTED,
  CHART_TICK_STYLE,
} from "./chart-tokens";

interface ReturnHistogramProps {
  returns: { date: string; value: number }[];
  /**
   * Optional benchmark return series. When provided (with ≥ 10 points), a
   * second translucent grey overlay bar series is rendered alongside the
   * strategy bars, sharing the same min/max/binWidth scaling so the bins
   * align.
   */
  benchmarkReturns?: { date: string; value: number }[];
  bins?: number;
}

/**
 * Return Histogram for the Returns Distribution panel.
 *
 * Identity tokens: positive bars use CHART_POSITIVE / negative use
 * CHART_NEGATIVE; axis ticks spread CHART_TICK_STYLE; tooltip border uses
 * the CHART_BORDER token; the optional benchmarkReturns overlay renders
 * at CHART_TEXT_MUTED with 0.4 opacity.
 */
export function ReturnHistogram({ returns, benchmarkReturns, bins = 20 }: ReturnHistogramProps) {
  if (!returns || returns.length < 10) return null;

  // Compute daily returns from cumulative equity: (equity[i+1] / equity[i]) - 1
  const cumulative = returns.map((r) => r.value);
  const dailyReturns = cumulative.slice(1).map((v, i) =>
    cumulative[i] !== 0 ? (v / cumulative[i]) - 1 : 0
  );

  const min = Math.min(...dailyReturns);
  const max = Math.max(...dailyReturns);
  if (max === min) return null; // All identical returns, nothing to show
  const binWidth = (max - min) / bins;

  // Pre-compute benchmark daily returns once so they share the same min/max
  // scaling as the strategy series — bins align by construction.
  const benchmarkAvailable = !!benchmarkReturns && benchmarkReturns.length >= 10;
  const benchmarkDailyReturns: number[] = benchmarkAvailable
    ? (benchmarkReturns ?? []).slice(1).map((v, i) => {
        const prev = (benchmarkReturns ?? [])[i];
        return prev && prev.value !== 0 ? v.value / prev.value - 1 : 0;
      })
    : [];

  const histogram = Array.from({ length: bins }, (_, i) => {
    const low = min + i * binWidth;
    const high = low + binWidth;
    const inBin = (r: number) => r >= low && (i === bins - 1 ? r <= high : r < high);
    const count = dailyReturns.filter(inBin).length;
    const benchmarkCount = benchmarkAvailable ? benchmarkDailyReturns.filter(inBin).length : 0;
    return {
      label: `${(low * 100).toFixed(1)}%`,
      value: low + binWidth / 2,
      count,
      benchmarkCount,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart accessibilityLayer={false} data={histogram} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
        <XAxis
          dataKey="label"
          tick={CHART_TICK_STYLE}
          tickLine={false}
          axisLine={{ stroke: CHART_BORDER }}
          interval={3}
        />
        <YAxis
          tick={CHART_TICK_STYLE}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={(v) => [Number(v), "Count"]}
          contentStyle={{ fontSize: 12, borderColor: CHART_BORDER }}
        />
        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
          {histogram.map((entry, i) => (
            <Cell key={i} fill={entry.value >= 0 ? CHART_POSITIVE : CHART_NEGATIVE} />
          ))}
        </Bar>
        {benchmarkAvailable && (
          <Bar dataKey="benchmarkCount" radius={[2, 2, 0, 0]}>
            {histogram.map((_, i) => (
              <Cell key={`bm-${i}`} fill={CHART_TEXT_MUTED} fillOpacity={0.4} />
            ))}
          </Bar>
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
