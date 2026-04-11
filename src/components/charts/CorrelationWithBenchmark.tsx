"use client";

import { useMemo } from "react";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { StrategyAnalytics } from "@/lib/types";
import { rollingCorrelation } from "@/lib/correlation-math";
import {
  CHART_ACCENT,
  CHART_AXIS_TICK,
  CHART_BORDER,
  CHART_FONT_MONO,
  CHART_REFERENCE_DASH,
  CHART_TEXT_MUTED,
} from "./chart-tokens";

const ROLLING_WINDOW = 90;

type CorrelationPoint = { date: string; value: number };

export interface ResolvedBenchmarkCorrelation {
  series: CorrelationPoint[];
  message: string | null;
}

function isCorrelationPointArray(value: unknown): value is CorrelationPoint[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry): entry is CorrelationPoint => {
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Record<string, unknown>;
    return (
      typeof e.date === "string" &&
      typeof e.value === "number" &&
      Number.isFinite(e.value)
    );
  });
}

/**
 * Pure helper that resolves the correlation series from a StrategyAnalytics
 * row. Exported for unit testing — the component itself is a thin wrapper
 * around this logic.
 *
 * Three-way outcome:
 *   - Server-side series present: returns it directly, message = null.
 *   - Benchmark data missing entirely: message = "Benchmark data unavailable."
 *   - Benchmark present but < 90 aligned daily-return pairs: message =
 *     "Insufficient data — 90 days needed, {N} days so far."
 */
export function resolveBenchmarkCorrelation(
  analytics: Pick<StrategyAnalytics, "returns_series" | "metrics_json">,
): ResolvedBenchmarkCorrelation {
  // 1. Primary: server-side precomputed series.
  const precomputed = analytics.metrics_json?.btc_rolling_correlation_90d;
  if (isCorrelationPointArray(precomputed)) {
    return { series: precomputed, message: null };
  }

  // 2. Pull the cumulative series for both strategy and benchmark.
  const stratCumulative = analytics.returns_series ?? [];
  const benchmarkCumulativeRaw = analytics.metrics_json?.benchmark_returns;

  // No benchmark data at all → empty state. Validate entries if present —
  // a malformed fallback series is equivalent to "no benchmark".
  if (!isCorrelationPointArray(benchmarkCumulativeRaw)) {
    return { series: [], message: "Benchmark data unavailable." };
  }
  const benchmarkCumulative = benchmarkCumulativeRaw;

  // Empty strategy returns → empty state with "0 days".
  if (stratCumulative.length === 0) {
    return {
      series: [],
      message: `Insufficient data — ${ROLLING_WINDOW} days needed, 0 days so far.`,
    };
  }

  // 3. Cumulative -> daily.
  const stratDailyMap = cumulativeToDailyMap(stratCumulative);
  const benchDailyMap = cumulativeToDailyMap(benchmarkCumulative);

  // 4. Align by date-string intersection, sorted ascending.
  const alignedDates: string[] = [];
  const alignedStrat: number[] = [];
  const alignedBench: number[] = [];
  // Iterate the strategy side in order so the result is date-sorted.
  const sortedStratDates = Array.from(stratDailyMap.keys()).sort();
  for (const d of sortedStratDates) {
    const sVal = stratDailyMap.get(d);
    const bVal = benchDailyMap.get(d);
    if (sVal !== undefined && bVal !== undefined) {
      alignedDates.push(d);
      alignedStrat.push(sVal);
      alignedBench.push(bVal);
    }
  }

  if (alignedStrat.length < ROLLING_WINDOW) {
    return {
      series: [],
      message: `Insufficient data — ${ROLLING_WINDOW} days needed, ${alignedStrat.length} days so far.`,
    };
  }

  // 5. Rolling correlation. `index` on the output maps back into
  //    alignedDates to recover each window's right-edge date.
  const rolled = rollingCorrelation(alignedStrat, alignedBench, ROLLING_WINDOW);
  const series: CorrelationPoint[] = rolled.map(({ index, value }) => ({
    date: alignedDates[index],
    value,
  }));

  return { series, message: null };
}

/**
 * Convert a cumulative-returns curve into a map keyed by date of the
 * corresponding daily simple return. Drops the first entry (no prior value)
 * and any point where the prior cumulative value is <= 0 (defensive: avoids
 * division by zero / negative when a strategy has wiped out).
 *
 * BOTH inputs to the fallback branch are CUMULATIVE `(1+r).cumprod()` curves,
 * so we must convert them back to daily returns before correlating —
 * correlating cumulative curves would be trivially ~1 and meaningless.
 * The conversion is `daily[i] = cum[i] / cum[i-1] - 1` (skip i=0).
 */
function cumulativeToDailyMap(
  cumulative: CorrelationPoint[],
): Map<string, number> {
  // Sort a shallow copy by date to be safe — the server writes ascending
  // but we don't want to depend on that.
  const sorted = [...cumulative].sort((a, b) => a.date.localeCompare(b.date));
  const out = new Map<string, number>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value;
    const cur = sorted[i].value;
    if (prev <= 0 || !Number.isFinite(prev) || !Number.isFinite(cur)) continue;
    out.set(sorted[i].date, cur / prev - 1);
  }
  return out;
}

interface CorrelationWithBenchmarkProps {
  analytics: StrategyAnalytics;
}

export function CorrelationWithBenchmark({
  analytics,
}: CorrelationWithBenchmarkProps) {
  const { series, message } = useMemo(
    () => resolveBenchmarkCorrelation(analytics),
    [analytics.returns_series, analytics.metrics_json],
  );

  if (message !== null) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-text-muted text-center px-6">
        {message}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={series} margin={{ top: 5, right: 30, bottom: 5, left: 5 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
          tickLine={false}
          axisLine={{ stroke: CHART_BORDER }}
          tickFormatter={(d: string) => d.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[-1, 1]}
          ticks={[-1, -0.5, 0, 0.5, 1]}
          tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => v.toFixed(1)}
        />
        <ReferenceLine y={0} stroke={CHART_TEXT_MUTED} strokeDasharray={CHART_REFERENCE_DASH} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderColor: CHART_BORDER }}
          formatter={(v) => {
            const n = Number(v);
            return [Number.isFinite(n) ? n.toFixed(3) : "—", "90d correlation"];
          }}
          labelFormatter={(d) => d}
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
  );
}
