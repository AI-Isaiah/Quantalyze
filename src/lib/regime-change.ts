/**
 * Regime change derivation.
 *
 * Aggregates the pair-keyed `rolling_correlation` JSONB into a single
 * portfolio-wide correlation series, then compares the most recent N points
 * against the prior N points to detect a regime shift.
 *
 * Why pair-keyed? `analytics-service/services/portfolio_risk.py` writes
 * a `Record<"sidA:sidB", TimeSeriesPoint[]>` because computing rolling
 * correlation for all O(n²) pairs is expensive — it skips beyond 20
 * strategies and limits to top-10 most-correlated pairs above 10. This
 * module averages across whichever pairs are present.
 */

import type { PortfolioAnalytics, TimeSeriesPoint } from "./types";

export interface RegimeChangeResult {
  /** Average pairwise correlation across the most recent N points. */
  recentAvg: number;
  /** Average pairwise correlation across the prior N points. */
  priorAvg: number;
  /** Signed delta: positive = tightening, negative = loosening. */
  delta: number;
  /** True when |delta| crosses the noise floor. */
  shiftDetected: boolean;
  /** Number of pair series used in the aggregation. */
  pairsUsed: number;
}

export interface RegimeChangeOptions {
  /** Window size in days for both recent and prior averages. Default 30. */
  window?: number;
  /** Minimum |delta| to report a shift. Default 0.1. */
  minDelta?: number;
}

/**
 * Average a list of `TimeSeriesPoint` values. Returns null when empty.
 */
function avg(points: TimeSeriesPoint[]): number | null {
  if (points.length === 0) return null;
  return points.reduce((s, p) => s + p.value, 0) / points.length;
}

/**
 * Compute the regime change for a portfolio. Returns null when there is not
 * enough data: at least one pair must have ≥ `window * 2` points so we can
 * compare a recent window against a prior window.
 */
export function computeRegimeChange(
  analytics: Pick<PortfolioAnalytics, "rolling_correlation"> | null,
  options: RegimeChangeOptions = {},
): RegimeChangeResult | null {
  const window = options.window ?? 30;
  const minDelta = options.minDelta ?? 0.1;
  if (!analytics?.rolling_correlation) return null;

  const recentValues: number[] = [];
  const priorValues: number[] = [];
  let pairsUsed = 0;

  for (const series of Object.values(analytics.rolling_correlation)) {
    if (series.length < window * 2) continue;
    pairsUsed += 1;
    const recent = series.slice(-window);
    const prior = series.slice(-window * 2, -window);
    const recentAvg = avg(recent);
    const priorAvg = avg(prior);
    if (recentAvg != null) recentValues.push(recentAvg);
    if (priorAvg != null) priorValues.push(priorAvg);
  }

  if (pairsUsed === 0 || recentValues.length === 0 || priorValues.length === 0) {
    return null;
  }

  const recentAvgAll = recentValues.reduce((s, v) => s + v, 0) / recentValues.length;
  const priorAvgAll = priorValues.reduce((s, v) => s + v, 0) / priorValues.length;
  const delta = recentAvgAll - priorAvgAll;
  return {
    recentAvg: recentAvgAll,
    priorAvg: priorAvgAll,
    delta,
    shiftDetected: Math.abs(delta) >= minDelta,
    pairsUsed,
  };
}
