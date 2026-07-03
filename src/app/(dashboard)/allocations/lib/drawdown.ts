/**
 * Server-safe drawdown derivation. Extracted from DrawdownChart.tsx
 * (a "use client" module) so the SSR path in src/lib/queries.ts
 * (`liveBaselineMetricsFromPerKeyDailies`) can call this without
 * tripping React's server/client boundary.
 *
 * Pure function — no DOM, no React, no client-only imports.
 */

import type { DailyPoint } from "@/lib/portfolio-math-utils";

/**
 * Convert a cumulative-wealth-multiplier series into peak-anchored
 * drawdown values. peak resets only on new highs; drawdown is
 * (current − peak) / peak when peak > 0, else 0.
 */
export function deriveSnapshotDrawdowns(
  points: DailyPoint[],
): { date: string; value: number }[] {
  if (points.length === 0) return [];
  let peak = Math.max(points[0].value, 0);
  const result: { date: string; value: number }[] = [];
  for (const d of points) {
    if (d.value > peak) peak = d.value;
    const dd = peak > 0 ? (d.value - peak) / peak : 0;
    result.push({ date: d.date, value: dd });
  }
  return result;
}

/**
 * 09.1-REVIEW WR-05 — fallback Max DD over a cumulative-RETURN curve.
 *
 * Callers emit cumulative-return points where
 * `value = wealth - 1` (return form). Computing drawdown directly on
 * the return form via `(value - peakValue) / (1 + peakValue)` blows up
 * when peakValue approaches -1 (catastrophic-loss windows on
 * highly-leveraged short slices). Convert to wealth and compute
 * drawdown against peakWealth, with a peakWealth > 0 guard mirroring
 * deriveSnapshotDrawdowns above.
 *
 * Returns the most-negative drawdown encountered (≤ 0). Empty / single-
 * point curves return 0.
 */
export function computeMaxDDFromReturnCurve(
  points: ReadonlyArray<{ value: number }>,
): number {
  if (points.length < 2) return 0;
  let peakWealth = 1 + points[0].value;
  let maxDD = 0;
  for (const p of points) {
    const wealth = 1 + p.value;
    if (wealth > peakWealth) peakWealth = wealth;
    if (peakWealth > 0) {
      const dd = (wealth - peakWealth) / peakWealth;
      if (dd < maxDD) maxDD = dd;
    }
  }
  return maxDD;
}
