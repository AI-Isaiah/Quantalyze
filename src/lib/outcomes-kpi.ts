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

import type { BridgeOutcome } from "./bridge-outcome-schema";

export type OutcomeKPIs = {
  /** D-13: simple count of all rows (allocated + rejected + pending). */
  totalOutcomes: number;
  /** D-11: wins / denominator over allocated rows surviving D-08 filters; null when denominator=0. */
  winRate: number | null;
  /** D-12 revised: arithmetic mean of most-mature non-NULL delta per surviving allocated row; null when denominator=0. */
  avgRealizedDelta: number | null;
  /** D-14 sub-label source: count of allocated rows with percent>=1 but all three deltas NULL. */
  pendingCount: number;
};

function mostMatureDelta(o: BridgeOutcome): number | null {
  // D-12 revised: prefer delta_180d > delta_90d > delta_30d, matching
  // Phase 4 feedback_engine._success_value lines 156-166.
  if (o.delta_180d !== null) return o.delta_180d;
  if (o.delta_90d !== null) return o.delta_90d;
  return o.delta_30d;
}

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

  // Step 3: partition by matured (any non-NULL delta) vs pending (all NULL).
  const mature = allocatedSized.filter(
    (o) => o.delta_30d !== null || o.delta_90d !== null || o.delta_180d !== null,
  );
  const pendingCount = allocatedSized.length - mature.length;

  if (mature.length === 0) {
    return { totalOutcomes, winRate: null, avgRealizedDelta: null, pendingCount };
  }

  const deltas = mature
    .map(mostMatureDelta)
    .filter((d): d is number => d !== null);

  // D-12 revised: strict > 0 for win (Phase 4 _success_value parity).
  // D-02 revised (Voice-D6) locks the same rule for the status pill.
  const wins = deltas.filter((d) => d > 0).length;
  const winRate = wins / deltas.length;
  const avgRealizedDelta = pairwiseSum(deltas) / deltas.length;

  return { totalOutcomes, winRate, avgRealizedDelta, pendingCount };
}
