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
 * shortest `daily_returns` window — and the user-facing copy says exactly that
 * ("Shortest history: {name}"). It is a transparent PROXY for the most
 * history-limited strategy, not a provable claim that this strategy alone
 * caps the overlap `n`: the binding overlap constraint depends on WHICH dates
 * each strategy covers, not merely how many points it has, so a strategy with
 * fewer points but dense common-window coverage may not be the true limiter.
 * Naming the fewest-points strategy is an honest, deterministic heuristic that
 * points the allocator at the most likely limiting record without inventing a
 * precise per-strategy overlap attribution the client data can't support.
 *
 * Mirrors the location/export convention of the pure lib helpers in `src/lib/`
 * and the pure-reduce shape of the `pickTopTenByAvgCorr` fn it replaces.
 */
import type { StrategyForBuilder } from "@/lib/scenario";

/**
 * Canonical coverage-caveat methodology line (IMPACT-01, HONEST-01).
 *
 * Single source of the literal both projection surfaces render — the composer
 * (own-book) and the Strategy Sandbox (example universe). It leads with the
 * ACTUAL method ("Historical realized"), names the live overlapping-day count,
 * and the honest horizon ("not a forecast"). Each call site appends its own
 * "Shortest history: {name}." clause (from `shortestHistoryName`) where the
 * de-aliased set is in scope; this builder owns only the invariant prefix so
 * the two surfaces cannot drift.
 */
export function methodologyLine(n: number): string {
  return `Historical realized · ${n} overlapping days · not a forecast.`;
}

/**
 * Return the NAME of the strategy with the shortest return history (fewest
 * `daily_returns` points) in the de-aliased strategy set.
 *
 * Accepts the `StrategyForBuilder` element type of the engine strategy set that
 * the composer/builder call sites already hold — reads ONLY `name` +
 * `daily_returns.length`.
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
