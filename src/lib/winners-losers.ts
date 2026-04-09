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
 * Sort attribution rows by contribution ascending (most negative first).
 * Ties broken by strategy_id ascending for determinism. Used by the losers
 * branch so the tie-break is applied independently of the winners branch.
 */
function sortByContributionAscending(rows: AttributionRow[]): AttributionRow[] {
  return [...rows].sort((a, b) => {
    if (a.contribution === b.contribution) {
      return a.strategy_id.localeCompare(b.strategy_id);
    }
    return a.contribution - b.contribution;
  });
}

/**
 * Compute winners and losers from an attribution breakdown.
 *
 * - `winners` = top N positive contributors (descending by contribution)
 * - `losers`  = bottom N negative contributors (ascending by contribution
 *   so the worst detractor is at index 0)
 *
 * Strategies with zero contribution are excluded entirely. If fewer than N
 * positive or negative strategies exist, the returned array is shorter.
 *
 * Tie-breaking is by `strategy_id` ascending, applied independently to
 * each sub-list so the order is stable regardless of which side of the
 * scale a tied pair lives on. Fix for PR 3 review finding: the previous
 * implementation sorted globally descending then sliced the tail and
 * reversed, which inverted the tie-break for losers relative to winners.
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

  const positives = attribution.filter((r) => r.contribution > 0);
  const negatives = attribution.filter((r) => r.contribution < 0);
  const winners = sortByContribution(positives).slice(0, count);
  const losers = sortByContributionAscending(negatives).slice(0, count);
  return { winners, losers };
}
