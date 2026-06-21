/**
 * Pure TypeScript — no fetch, no side effects, no DOM/time reads.
 *
 * Coverage-caveat support (IMPACT-01, Plan 21-02 T1). The honesty caveat under
 * the scenario projection reads:
 *
 *   "Projected from {n} overlapping days. Shortest history: {name}. Not a forecast."
 *
 * `n` is `scenarioMetrics.n` (the overlapping-day count, scenario.ts:191). This
 * helper supplies the `{name}` half: the de-aliased strategy with the least
 * history. Both halves are derived from data already present client-side — no
 * new server field (Assumption A1).
 *
 * "Shortest history" is defined as the FEWEST available trading days, i.e. the
 * shortest `daily_returns` window. The strategy with the fewest return points
 * is the one whose short record most constrains an honest correlation/overlap;
 * naming it tells the allocator which strategy is limiting the analysis. (An
 * earliest-start definition would name a strategy that may nonetheless have a
 * dense record; window length is the count that actually feeds the overlap.)
 *
 * Mirrors the location/export convention of its sibling `scenario-dealias.ts`
 * and the pure-reduce shape of the `pickTopTenByAvgCorr` fn it replaces.
 */
import type { StrategyForBuilder } from "@/lib/scenario";

/**
 * Return the NAME of the strategy with the shortest return history (fewest
 * `daily_returns` points) in the de-aliased strategy set.
 *
 * Accepts the `StrategyForBuilder` element type of `deAliased.strategies` (the
 * output of `collapseAliasedHoldingStrategies`) that the composer/builder call
 * sites already hold — reads ONLY `name` + `daily_returns.length`.
 *
 * Tiebreak: deterministic — the first strategy by input order wins, so equal
 * window lengths never produce a non-deterministic name.
 *
 * Degenerate cases (never throws):
 *  - empty input        → `null` (no strategy to name; the caveat omits the half)
 *  - single strategy    → that lone strategy's name.
 */
export function shortestHistoryName(
  strategies: ReadonlyArray<StrategyForBuilder>,
): string | null {
  if (strategies.length === 0) return null;

  let shortest = strategies[0];
  let shortestLen = shortest.daily_returns.length;
  // Start at index 1; strict `<` preserves the first-seen tiebreak.
  for (let i = 1; i < strategies.length; i++) {
    const len = strategies[i].daily_returns.length;
    if (len < shortestLen) {
      shortest = strategies[i];
      shortestLen = len;
    }
  }
  return shortest.name;
}
