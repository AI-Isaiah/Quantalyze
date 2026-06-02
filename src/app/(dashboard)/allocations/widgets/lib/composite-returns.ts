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

  // F2 H-0158: accumulate a PER-DATE contributing weight alongside the weighted
  // sum, and renormalize each date by the weight that actually contributed THAT
  // day. Dividing every date by the GLOBAL totalWeight under-weighted the
  // composite on partial-coverage dates: a date where only a 0.6-weight strategy
  // reported was divided by 1.0, understating its return to 0.6× the true value.
  // Per-date renormalization = the weighted average over the strategies present
  // on each date (the standard composite treatment of ragged coverage).
  const dateSum = new Map<string, number>();
  const dateWeight = new Map<string, number>();

  for (const s of strategies) {
    const dr = normalizeDailyReturns(
      s.strategy?.strategy_analytics?.daily_returns,
    );
    const w = s.weight ?? s.current_weight ?? 0;
    if (w === 0) continue;
    for (const d of dr) {
      dateSum.set(d.date, (dateSum.get(d.date) ?? 0) + d.value * w);
      dateWeight.set(d.date, (dateWeight.get(d.date) ?? 0) + w);
    }
  }

  if (dateSum.size === 0) return [];

  return Array.from(dateSum.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, val]) => {
      const w = dateWeight.get(date) ?? 0;
      return { date, value: w > 0 ? val / w : 0 };
    });
}
