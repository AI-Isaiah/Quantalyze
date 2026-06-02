// Phase 5 pure-function KPI computer for the Outcomes Dashboard widget.
// Mirrors Phase 4 feedback_engine.py filter rules (D-08/D-11/D-12/D-21) so
// the dashboard "win rate" tells the same story as the scoring feedback
// loop. Any change to Phase 4 filters MUST update this module + the shared
// fixture tests/fixtures/outcomes-kpi-parity.json in the SAME PR.
//
// D-12 revised (2026-04-19 per Voice-D2): most-mature delta preference
// order is delta_180d -> delta_90d -> delta_30d, matching Phase 4
// feedback_engine._success_value lines 156-166. Fixture avgRealizedDelta
// = 0.00333 on the 7-row parity fixture.

import { mostMatureDelta, type BridgeOutcome } from "./bridge-outcome-schema";

export type OutcomeKPIs = {
  /** D-13: simple count of all rows (allocated + rejected + pending). */
  totalOutcomes: number;
  /** D-11: wins / denominator over allocated rows surviving D-08 filters; null when denominator=0. */
  winRate: number | null;
  /** D-12 revised: arithmetic mean of most-mature non-NULL delta per surviving allocated row; null when denominator=0. */
  avgRealizedDelta: number | null;
  /** D-14 sub-label source: count of allocated rows with percent>=1 but all three deltas NULL. */
  pendingCount: number;
  /**
   * NEW-C27-02: denominator of winRate — count of mature allocated rows
   * (percent>=1, at least one non-null delta) that contributed a numeric delta
   * to the win-rate calculation (= `deltas.length` after the `mostMatureDelta`
   * filter). In practice equals `mature.length` because `mostMatureDelta` can
   * only return null when all three delta fields are null, but the `mature`
   * filter already guarantees at least one is non-null. Returned explicitly so
   * consumers can show a consistent "N settled" sub-label using the SAME
   * population as the rate itself rather than a different slice (e.g. rows with
   * delta_90d != null). Do NOT substitute `mature.length` — if the `mature`
   * filter or `mostMatureDelta` logic ever changes the two could diverge.
   */
  winRateDenominator: number;
};

// F2 H-0463/H-0464 — mostMatureDelta now lives in bridge-outcome-schema as the
// single, NaN-safe source of truth shared with deriveOutcomeStatusPill (the KPI
// strip and the status pill can no longer drift or disagree on a corrupt delta).

/**
 * Pairwise (divide-and-conquer) summation. Gives cross-runtime IEEE-754 parity
 * with Python's built-in `sum()` (which also uses a compensated / pairwise-ish
 * algorithm). A plain left-fold `reduce((a,b)=>a+b, 0)` accumulates a single
 * running total and can differ by 1 ULP from Python on the same inputs —
 * enough to break fixture equality. Voice-D21 parity requires bit-exact
 * equality, so we use pairwise here.
 */
function pairwiseSum(arr: number[]): number {
  if (arr.length === 0) return 0;
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr[0] + arr[1];
  const mid = Math.floor(arr.length / 2);
  return pairwiseSum(arr.slice(0, mid)) + pairwiseSum(arr.slice(mid));
}

export function computeOutcomeKPIs(outcomes: BridgeOutcome[]): OutcomeKPIs {
  const totalOutcomes = outcomes.length;

  // Step 1 (D-08 step 2): drop allocated rows with <1% allocated (token-size dabbles aren't conviction).
  // Step 2: restrict to allocated (rejected rows excluded from win rate per D-11).
  const allocatedSized = outcomes.filter(
    (o) => o.kind === "allocated" && (o.percent_allocated ?? 0) >= 1.0,
  );

  // Step 3 (F2 H-0464/M-0532): partition by a FINITE most-mature delta.
  // mostMatureDelta is NaN-safe — it treats NaN/Infinity from a buggy
  // analytics-worker write as ABSENT (NaN passes a plain `!== null` check, then
  // counts as a loss because `NaN > 0` is false, and poisons the average to NaN;
  // Infinity counts as a spurious win). A row whose only deltas are non-finite
  // therefore resolves to null and is counted PENDING (not a fabricated loss),
  // and mature/pending/deltas stay mutually consistent (winRateDenominator ==
  // deltas.length). A row with a non-finite high delta but a valid lower one uses
  // the valid lower delta rather than the corrupt value.
  const deltas: number[] = [];
  let nonFiniteDropped = 0;
  for (const o of allocatedSized) {
    const d = mostMatureDelta(o);
    if (d !== null) {
      deltas.push(d);
    } else if (
      o.delta_30d !== null ||
      o.delta_90d !== null ||
      o.delta_180d !== null
    ) {
      // Had delta value(s), but every one was non-finite — a data corruption
      // worth surfacing rather than silently folding into "pending".
      nonFiniteDropped++;
    }
  }
  const pendingCount = allocatedSized.length - deltas.length;

  // Rule 12 (fail loud): a corrupt non-finite delta is a real data bug
  // (analytics-worker divide-by-zero / malformed series). Surface it instead of
  // letting it vanish into the pending bucket. Fires only when such a row exists.
  if (nonFiniteDropped > 0) {
    console.error(
      `[computeOutcomeKPIs] excluded ${nonFiniteDropped} allocated row(s) with non-finite delta_* values (NaN/Infinity) from the win-rate — likely a corrupt analytics-worker write.`,
    );
  }

  if (deltas.length === 0) {
    return { totalOutcomes, winRate: null, avgRealizedDelta: null, pendingCount, winRateDenominator: 0 };
  }

  // D-12 revised: strict > 0 for win (Phase 4 _success_value parity).
  // D-02 revised (Voice-D6) locks the same rule for the status pill.
  const wins = deltas.filter((d) => d > 0).length;
  const winRate = wins / deltas.length;
  const avgRealizedDelta = pairwiseSum(deltas) / deltas.length;

  return { totalOutcomes, winRate, avgRealizedDelta, pendingCount, winRateDenominator: deltas.length };
}
