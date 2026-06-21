"use client";

import { EmptyStateCard } from "@/components/ui/EmptyStateCard";
import {
  SAMPLE_FLOOR_HEADING,
  sampleFloorBody,
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
 * Renders the shared `EmptyStateCard` shell (the pinned tokens; UI-SPEC §2),
 * the same primitive `CorrelationHeatmap` renders (different statistic-specific
 * threshold, same visual shell). The body copy + heading come from
 * `@/lib/sample-floor` (never re-authored here), and `sampleFloorBody` owns the
 * reason precedence so this layer only decides whether to render at all.
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
  // WR-02 (Phase 22 review): this component's precondition is "the gate decided
  // below-floor". If a (future P26/27) call site mis-wires it with a PASSING
  // verdict, render nothing rather than a self-contradictory "{n} days — fewer
  // than the {floor} needed" card for an n >= floor verdict (fail loud, not lie).
  if (verdict.reason === "ok") return null;

  return (
    <EmptyStateCard
      heading={SAMPLE_FLOOR_HEADING}
      body={sampleFloorBody(verdict, { feature, strategyCount })}
    />
  );
}
