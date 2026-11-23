/**
 * Phase 237 (FACTSHEETHONEST) FACT-02 — the ONE held-re-run verdict every
 * surface that follows the factsheet asks, so no two surfaces keep their own
 * status ladder.
 *
 * A "held" row is a `pending` or `computing` row over a stored success result:
 * the numbers on it are the last success's, still true, while a re-run is in
 * flight. This restates the factsheet resolve stage in
 * `src/lib/factsheet/fetch-and-build-payload.ts` (Phase 190 plan 03). That stage
 * makes three refusals, and `analyticsHold` reproduces each:
 *
 *   1. not a terminal success and not updating  -> withheld;
 *   2. a terminal-success row whose derive prestamp left no bound snapshot
 *      (D-04, `hasUnboundDerivePrestamp`)        -> withheld;
 *   3. a composite while updating                -> withheld.
 *
 * It is never a second rule: change the resolve stage and this function moves
 * with it, or the two drift. A `failed` row is never admitted, whatever it
 * stores (`isRecomputeOverStoredResult` admits only `pending` and `computing`).
 *
 * Row state only, never lane state: nothing here reads a viewer, a cookie or a
 * header. A projection that does not ship the `data_quality_flags` blob cannot
 * answer the D-04 or composite terms, so it must not call this with a bare
 * projection and claim parity (Phase 190 plan 07 precedent: the lists and
 * /compare record that they do not apply it).
 *
 * No server-only import and no client directive: the OG route, the PDF routes,
 * client components and plain tests may all import it.
 */

import { isComputedAnalytics, isRecomputeOverStoredResult } from "@/lib/closed-sets";
import {
  effectiveDataQualityFlags,
  hasStoredAnalyticsResult,
  hasUnboundDerivePrestamp,
} from "@/lib/stored-analytics-result";

/**
 * The columns the verdict reads from a `strategy_analytics` row: the evidence
 * keys `hasStoredAnalyticsResult` reads, plus the status. Null and undefined
 * (no row) are accepted and answer "not held, not admitted".
 */
export type HoldRow =
  | {
      computation_status?: unknown;
      daily_returns?: unknown;
      returns_series?: unknown;
      series_end?: unknown;
      cumulative_return?: unknown;
      data_quality_flags?: unknown;
      computed_at?: unknown;
      cumulative_method?: unknown;
      last_success_cumulative_method?: unknown;
      last_success_computed_at?: unknown;
    }
  | null
  | undefined;

export type AnalyticsHold = {
  /** True only for a pending or computing row over a stored, non-composite success result. */
  updating: boolean;
  /**
   * True when the row's stored numbers may be shown: a terminal success with no
   * unbound derive prestamp, or a held re-run. A failed row is never admitted.
   */
  admitted: boolean;
};

export function analyticsHold(row: HoldRow): AnalyticsHold {
  const status = typeof row?.computation_status === "string" ? row.computation_status : null;
  const composite = effectiveDataQualityFlags(row).flags?.composite === true;
  const updating = isRecomputeOverStoredResult(status, hasStoredAnalyticsResult(row)) && !composite;
  const admitted = (isComputedAnalytics(status) && !hasUnboundDerivePrestamp(row)) || updating;
  return { updating, admitted };
}

/**
 * The cache a render of a held re-run may carry. Short, so the held card does
 * not outlive the re-run by long, and deliberately without
 * `stale-while-revalidate`: that would let a CDN serve the held card after it
 * expires. The OG route aliases it; both PDF routes import it. The OG route
 * keeps `LONG_CACHE_CONTROL` and `FAILURE_CACHE_CONTROL` where they are.
 */
export const HELD_RERUN_CACHE_CONTROL = "public, max-age=60, s-maxage=60";
