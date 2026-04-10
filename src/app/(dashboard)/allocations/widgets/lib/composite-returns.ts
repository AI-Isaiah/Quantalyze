/**
 * Shared helper: build a single composite weighted daily return series
 * from multiple strategies. Extracted from ~12 widgets that all had
 * the same dateMap + totalWeight pattern.
 */

import {
  normalizeDailyReturns,
  type DailyPoint,
} from "@/lib/portfolio-math-utils";

interface StrategyInput {
  strategy?: {
    strategy_analytics?: {
      daily_returns?: unknown;
    } | null;
  };
  weight?: number;
  current_weight?: number | null;
}

/**
 * Build a weighted-average composite daily return series from an array
 * of strategies. Each strategy's daily returns are weighted by
 * `weight` (or `current_weight`); the result is the weighted average
 * across all strategies for each date.
 *
 * Returns an empty array if totalWeight is zero or no strategies have data.
 */
export function buildCompositeReturns(strategies: StrategyInput[]): DailyPoint[] {
  if (!strategies?.length) return [];

  const dateMap = new Map<string, number>();
  let totalWeight = 0;

  for (const s of strategies) {
    const dr = normalizeDailyReturns(
      s.strategy?.strategy_analytics?.daily_returns,
    );
    const w = s.weight ?? s.current_weight ?? 0;
    if (w === 0) continue;
    totalWeight += w;
    for (const d of dr) {
      dateMap.set(d.date, (dateMap.get(d.date) ?? 0) + d.value * w);
    }
  }

  if (totalWeight === 0) return [];

  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, val]) => ({ date, value: val / totalWeight }));
}
