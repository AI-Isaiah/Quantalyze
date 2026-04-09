/**
 * Winners and losers derivation.
 *
 * Pure: takes the parsed `attribution_breakdown` from `PortfolioAnalytics`
 * and returns top contributors + bottom detractors. The /demo
 * `<WinnersLosersStrip>` calls this once per render.
 *
 * Sort is stable (deterministic by strategy_id on ties) so the same
 * portfolio always renders the same order across reloads.
 */

import type { AttributionRow } from "./types";

export interface WinnersLosersResult {
  winners: AttributionRow[];
  losers: AttributionRow[];
}

export interface WinnersLosersOptions {
  /** How many winners + losers to return at most. Default 3 of each. */
  count?: number;
}

/**
 * Sort attribution rows by contribution descending. Ties broken by
 * strategy_id ascending so the order is deterministic across reloads.
 */
function sortByContribution(rows: AttributionRow[]): AttributionRow[] {
  return [...rows].sort((a, b) => {
    if (a.contribution === b.contribution) {
      return a.strategy_id.localeCompare(b.strategy_id);
    }
    return b.contribution - a.contribution;
  });
}

/**
 * Compute winners and losers from an attribution breakdown.
 *
 * - `winners` = top N positive contributors (descending by contribution)
 * - `losers`  = bottom N negative contributors (ascending by contribution)
 *
 * Strategies with zero contribution are excluded entirely. If fewer than N
 * positive or negative strategies exist, the returned array is shorter.
 *
 * Returns empty arrays when input is null or empty — never throws.
 */
export function computeWinnersLosers(
  attribution: AttributionRow[] | null,
  options: WinnersLosersOptions = {},
): WinnersLosersResult {
  const count = options.count ?? 3;
  if (!attribution || attribution.length === 0) {
    return { winners: [], losers: [] };
  }

  const sorted = sortByContribution(attribution);
  const winners = sorted.filter((r) => r.contribution > 0).slice(0, count);
  // Losers: pull from the end of the sorted (positive→negative) list, then
  // reverse so the worst is first.
  const losers = sorted
    .filter((r) => r.contribution < 0)
    .slice(-count)
    .reverse();
  return { winners, losers };
}
