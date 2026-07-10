/**
 * Scenario peer-rank request gate — the pure decision the composer's fetch
 * effect consumes (Phase 42, PEER-01/03). Keeping the gate + body construction
 * here (rather than inline in the 2.5k-line composer) makes the load-bearing
 * suppression rules unit-testable in isolation:
 *
 *   - SAMPLE FLOOR (PEER-03): a blend with fewer than 252 overlapping
 *     observations is too short to rank honestly on the sample/252 basis. The
 *     composer must NOT fetch — `scenarioPeer` stays null, the panel is absent.
 *   - FINITE GUARD: a degenerate blend (no overlap, single strategy collapse,
 *     etc.) leaves the engine's sharpe/sortino null or non-finite. Ranking a
 *     non-finite metric is meaningless, so we suppress the fetch.
 *   - SAMPLE BASIS (PEER-02): the request body carries the ENGINE's own
 *     annualized `sharpe`/`sortino`/`max_drawdown` (scenario.ts), NEVER the
 *     population headline from `compute.ts`. Since Phase 84 the engine annualizes
 *     on the blend's asset-class basis (√365 if any crypto leg, else √252), so a
 *     crypto blend feeds √365 scalars here — that is CORRECT and must NOT be
 *     rescaled: annualized Sharpe/Sortino are frequency-invariant, so √365 and
 *     √252 values rank directly against the cohort (a √(252/365) "correction"
 *     would double-penalize 24/7 sleeves — rejected in #597). `maxDD` is
 *     forwarded as the engine's signed magnitude; the ROUTE applies `Math.abs`
 *     (the RPC compares on magnitude — plan 02).
 *
 * Pure, dependency-free, no fetch/DOM/time — so the gate is reload-stable (a
 * pure function of the blend metrics) and the effect that calls it can stay a
 * thin shell with a stale-response guard.
 */
import type { ComputedMetrics } from "@/lib/scenario";

/** The minimum overlapping-observation count to rank a blend (PEER-03). Mirrors
 *  the factsheet's n<252 reliability caveat. */
export const PEER_RANK_MIN_OBS = 252;

/** POST body of `/api/scenario/peer-rank` (plan 02 contract). */
export type ScenarioPeerRankRequest = {
  sharpe: number;
  sortino: number;
  maxDD: number;
  n: number;
};

/**
 * Decide whether the blend qualifies for a peer-rank fetch and, if so, build the
 * request body from the engine's sample-basis metrics. Returns `null` when the
 * blend is below the sample floor (n < 252) OR any ranking metric is non-finite
 * (null / NaN / ±Infinity) — in both cases the composer skips the fetch and
 * `scenarioPeer` stays null (honest absence).
 *
 * The `n` field is the true overlapping-observation count; sharpe/sortino/maxDD
 * are the engine's rounded annualized scalars at the blend's own basis (√365
 * crypto / √252 tradfi since Phase 84 — the SAME values the factsheet ranking
 * convention pins, scenario.peer-basis.test.ts; frequency-invariant, un-rescaled).
 */
export function buildScenarioPeerRankRequest(
  metrics: Pick<ComputedMetrics, "sharpe" | "sortino" | "max_drawdown" | "n">,
): ScenarioPeerRankRequest | null {
  const { sharpe, sortino, max_drawdown, n } = metrics;
  if (!Number.isFinite(n) || n < PEER_RANK_MIN_OBS) return null;
  if (
    sharpe == null ||
    sortino == null ||
    max_drawdown == null ||
    !Number.isFinite(sharpe) ||
    !Number.isFinite(sortino) ||
    !Number.isFinite(max_drawdown)
  ) {
    return null;
  }
  return { sharpe, sortino, maxDD: max_drawdown, n };
}
