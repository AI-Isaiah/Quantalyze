"use client";

import {
  SAMPLE_FLOOR_HEADING,
  belowFloorBody,
  noUsableSampleBody,
  fewStrategiesBody,
  type SampleFloorVerdict,
} from "@/lib/sample-floor";

interface SampleFloorEmptyStateProps {
  /** The verdict from `evaluateSampleFloor` (the gate decided this is below-floor). */
  verdict: SampleFloorVerdict;
  /**
   * The consuming feature's noun for the below-floor body (e.g. "stress",
   * "Monte-Carlo"). Defaults to a generic distributional-estimate noun.
   */
  feature?: string;
  /**
   * Optional active-strategy count. The gate (a pure floor check) cannot see
   * this; the call site supplies it so a 0/1-strategy set routes to the
   * "add at least 2 strategies" body instead of naming a meaningless overlap N.
   */
  strategyCount?: number;
}

/**
 * HONEST-02 — the shared below-floor honest empty state.
 *
 * Reuses the Phase-21 `CorrelationHeatmap` empty-state shell VERBATIM (the
 * pinned tokens; UI-SPEC §2) — it does NOT import or modify `CorrelationHeatmap`
 * (different statistic-specific threshold, same visual shell). The body copy +
 * heading come from `@/lib/sample-floor` (never re-authored here).
 *
 * Reason precedence (matches the gate's "never fabricate a number" contract):
 *   1. 0/1-strategy (caller count < 2)  → few-strategies body (no overlap N to name)
 *   2. no-usable-n (null/NaN/non-finite) → no-number body
 *   3. below-floor (finite n < floor)    → names the actual N + the floor
 *
 * A below-floor state is honest absence, NOT an error — not an alert role, no
 * red/warning color (UI-SPEC Color).
 *
 * This proves the empty state RENDERS for export to Phases 26/27; it is NOT
 * wired into the live composer/sandbox projection (RESEARCH Open Q3).
 */
export function SampleFloorEmptyState({
  verdict,
  feature = "distributional",
  strategyCount,
}: SampleFloorEmptyStateProps) {
  const { n, floor, reason } = verdict;

  // WR-02 (Phase 22 review): this component's precondition is "the gate decided
  // below-floor". If a (future P26/27) call site mis-wires it with a PASSING
  // verdict, render nothing rather than a self-contradictory "{n} days — fewer
  // than the {floor} needed" card for an n >= floor verdict (fail loud, not lie).
  if (reason === "ok") return null;

  let body: string;
  if (strategyCount !== undefined && strategyCount < 2) {
    body = fewStrategiesBody(floor);
  } else if (reason === "no-usable-n" || n == null) {
    body = noUsableSampleBody();
  } else {
    body = belowFloorBody(n, floor, feature);
  }

  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
      <div className="font-semibold text-text-secondary">{SAMPLE_FLOOR_HEADING}</div>
      <div className="mt-1 text-[11px]">{body}</div>
    </div>
  );
}
