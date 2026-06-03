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
import {
  CORRELATION_90D_MIN_DAYS,
  insufficientHistoryMessage,
} from "@/lib/min-history";
import {
  CHART_ACCENT,
  CHART_BORDER,
  CHART_REFERENCE_DASH,
  CHART_TEXT_MUTED,
  CHART_TICK_STYLE,
} from "./chart-tokens";

type CorrelationPoint = { date: string; value: number };

/**
 * Discriminated outcome of resolving the 90-day BTC correlation series.
 *
 * Background (audit-2026-05-07 G11.A P64): the previous implementation had
 * TWO correlation pipelines for the same strategy:
 *   1. Server: Python `metrics.py:_rolling_correlation` writing
 *      `metrics_json.btc_rolling_correlation_90d` (authoritative, true daily
 *      aligned returns).
 *   2. Client fallback: cumulative -> daily reconstruction with 6-decimal
 *      rounding loss, then `rollingCorrelation` in JS.
 *
 * The two pipelines disagreed by ±0.02-0.05 in low-correlation regions —
 * a senior allocator visually comparing chart vs. PDF would lose trust.
 * Audit fix path (b): delete the client fallback entirely. When the server
 * has not produced a valid precomputed series, surface a clean status
 * state instead of recomputing.
 */
export type ResolvedBenchmarkCorrelation =
  | { kind: "ok"; series: CorrelationPoint[] }
  | { kind: "computing"; message: string }
  | { kind: "insufficient"; message: string }
  | { kind: "unavailable"; message: string };

function isCorrelationPointArray(value: unknown): value is CorrelationPoint[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry): entry is CorrelationPoint => {
    if (!entry || typeof entry !== "object") return false;
    const e = entry as Record<string, unknown>;
    return (
      typeof e.date === "string" &&
      typeof e.value === "number" &&
      Number.isFinite(e.value) &&
      // M-0395 (B9 boundary parity): a rolling correlation is mathematically
      // bounded to [-1, 1]. An out-of-range value (a producer regression) makes
      // the guard return false, routing the whole series through the existing
      // "malformed -> unavailable" branch (which logs the greppable
      // `[CorrelationWithBenchmark] … malformed` line) rather than rendering an
      // absurd >1 correlation point on the chart.
      e.value >= -1 &&
      e.value <= 1
    );
  });
}

/**
 * Best-effort estimate of the actual aligned-history depth so the
 * "insufficient history" message can include a real day count rather than
 * a generic "not enough" string. We use `returns_series.length` (the
 * cumulative strategy-side curve) as a proxy — it's the upper bound on
 * aligned daily returns and what the user sees on the cumulative-returns
 * panel, so the number is meaningful to them. The benchmark side may
 * truncate this further, but quoting the strategy-side count matches what
 * appears elsewhere on the page.
 *
 * Returns `null` when no count is inferable (caller falls back to a
 * generic message).
 */
function inferActualDays(
  analytics: Pick<StrategyAnalytics, "returns_series">,
): number | null {
  const series = analytics.returns_series;
  if (!Array.isArray(series)) return null;
  // returns_series is a cumulative curve seeded at value=1.0, so the number
  // of daily-return samples is `length - 1` (n-1 differences from n points).
  // Clamp at 0 — a 1-point or empty series has zero daily returns.
  return Math.max(0, series.length - 1);
}

/**
 * Input shape for the resolver. Two fields are always required
 * (`returns_series`, `metrics_json`) because they are read unconditionally;
 * `computation_status` is OPTIONAL so that lazy/sub-panel call-sites (which
 * type their own narrower analytics subset, e.g.
 * `ExposureAndGreeksPanel.tsx`'s `CorrelationAnalyticsSubset`) can pass an
 * object that omits the field. When absent we conservatively fall through
 * to the `unavailable` branch rather than `computing`.
 */
export type CorrelationResolverInput =
  Pick<StrategyAnalytics, "returns_series" | "metrics_json"> &
    Partial<Pick<StrategyAnalytics, "computation_status">>;

/**
 * Pure helper that resolves the correlation series from a StrategyAnalytics
 * row. Exported for unit testing — the component itself is a thin wrapper.
 *
 * Outcomes (see {@link ResolvedBenchmarkCorrelation}):
 *   - `ok`: server precomputed series is present and well-formed → render.
 *   - `computing`: server has not yet produced output and the row is
 *     `computation_status === 'computing'`.
 *   - `insufficient`: server explicitly returned `[]` (history < threshold).
 *   - `unavailable`: precomputed missing (and not computing), or malformed.
 *
 * No client-side fallback recomputation — see audit-2026-05-07 G11.A P64.
 */
export function resolveBenchmarkCorrelation(
  analytics: CorrelationResolverInput,
): ResolvedBenchmarkCorrelation {
  const precomputed = analytics.metrics_json?.btc_rolling_correlation_90d;

  // 1. Field absent (null/undefined) → either still computing or unavailable.
  if (precomputed === null || precomputed === undefined) {
    if (analytics.computation_status === "computing") {
      // Aligns with the PerformanceReport / ComputeStatus banner copy
      // so the same status reads identically across surfaces.
      return { kind: "computing", message: "Computing analytics…" };
    }
    return {
      kind: "unavailable",
      message: "Benchmark correlation unavailable.",
    };
  }

  // 2. Empty array → server decided no result (insufficient history).
  //    Surface the institutional-grade min-history message (P69).
  if (Array.isArray(precomputed) && precomputed.length === 0) {
    const actualDays = inferActualDays(analytics);
    return {
      kind: "insufficient",
      message:
        actualDays !== null
          ? insufficientHistoryMessage(
              "90-day BTC correlation",
              CORRELATION_90D_MIN_DAYS,
              actualDays,
            )
          : `Insufficient history for institutional-grade 90-day BTC correlation (need ${CORRELATION_90D_MIN_DAYS} days).`,
    };
  }

  // 3. Truthy but malformed → log (P67) and treat as unavailable.
  if (!isCorrelationPointArray(precomputed)) {
    // Stable prefix so this is greppable in the runtime-logs surface.
    const sample = Array.isArray(precomputed)
      ? JSON.stringify(precomputed.slice(0, 2))
      : typeof precomputed;
    // eslint-disable-next-line no-console
    console.error(
      `[CorrelationWithBenchmark] btc_rolling_correlation_90d malformed: ${sample}`,
    );
    return {
      kind: "unavailable",
      message: "Benchmark correlation unavailable.",
    };
  }

  // 4. Well-formed precomputed series.
  return { kind: "ok", series: precomputed };
}

interface CorrelationWithBenchmarkProps {
  /**
   * Narrowed to the keys actually consumed by resolveBenchmarkCorrelation.
   * `computation_status` is optional so lazy-panel call-sites with a
   * narrower analytics subset (e.g. `ExposureAndGreeksPanel`'s
   * `CorrelationAnalyticsSubset`) can still pass through. Full callers
   * (e.g. `PerformanceReport`) include it and unlock the `computing`
   * status copy.
   */
  analytics: CorrelationResolverInput;
}

export function CorrelationWithBenchmark({
  analytics,
}: CorrelationWithBenchmarkProps) {
  const resolved = useMemo(
    () => resolveBenchmarkCorrelation(analytics),
    [analytics],
  );

  if (resolved.kind !== "ok") {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-text-muted text-center px-6">
        {resolved.message}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart accessibilityLayer={false} data={resolved.series} margin={{ top: 5, right: 30, bottom: 5, left: 5 }}>
        <XAxis
          dataKey="date"
          tick={CHART_TICK_STYLE}
          tickLine={false}
          axisLine={{ stroke: CHART_BORDER }}
          tickFormatter={(d: string) => d.slice(5)}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[-1, 1]}
          ticks={[-1, -0.5, 0, 0.5, 1]}
          tick={CHART_TICK_STYLE}
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
