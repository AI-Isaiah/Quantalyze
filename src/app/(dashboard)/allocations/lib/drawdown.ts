/**
 * Server-safe drawdown derivation. Extracted from DrawdownChart.tsx
 * (a "use client" module) so the SSR path in src/lib/queries.ts
 * (`liveBaselineMetricsFromHoldings`) can call this without
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
