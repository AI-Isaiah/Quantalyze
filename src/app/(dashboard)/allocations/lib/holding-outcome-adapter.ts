/**
 * Phase 09 / D-11. Thin prop adapter for holding-sourced Bridge outcome recording.
 *
 * Maps (flaggedHolding, topCandidate, matchDecision) → strategy-shaped props that
 * the existing Bridge V2 components (BridgeOutcomeBanner / AllocatedForm /
 * RejectedForm / OutcomeRecordedRow) already expect. Those components are
 * preserved verbatim — this adapter is the ONLY boundary change per D-11.
 *
 * Pure TypeScript — no fetch, no side effects. Use at the UI boundary; never
 * leak the raw FlaggedHolding shape into the Bridge V2 components.
 */
import type { BridgeOutcome } from "@/lib/bridge-outcome-schema";

export type HoldingType = "spot" | "derivative";

export type FlaggedHolding = {
  venue: string;
  symbol: string;
  holding_type: HoldingType;
  value_usd: number;
  /** Top candidate composite >= FLAG_COMPOSITE_THRESHOLD = 50 — the strategy the Bridge wants allocator to swap into */
  top_candidate_strategy_id: string;
  top_candidate_name: string;
  /** Composite score on 0..100 scale (match_engine.py:787 final_score) */
  top_candidate_composite: number;
  /** Breach reasons rendered in the expandable sub-row */
  breach_reasons: Array<"max_weight" | "correlation_ceiling">;
};

/**
 * scope_ref = "holding:{venue}:{symbol}:{holding_type}" — matches Phase 08 D-08
 * buildHoldingScopeRef output prepended with "holding:" prefix.
 *
 * The parity with buildHoldingScopeRef is asserted in holding-outcome-adapter.test.ts
 * (the test does: `holding:${buildHoldingScopeRef({venue, symbol, holding_type})}`
 * === `buildHoldingRef(h)`).
 */
export function buildHoldingRef(h: Pick<FlaggedHolding, "venue" | "symbol" | "holding_type">): string {
  return `holding:${h.venue}:${h.symbol}:${h.holding_type}`;
}

export type BridgeOutcomeBannerCallbacks = {
  onAllocatedClick: () => void;
  onRejectedClick: () => void;
  onDismiss: () => void;
};

/**
 * Maps a flagged holding → BridgeOutcomeBanner props.
 * strategyId = top_candidate_strategy_id (the strategy we want allocator to swap INTO — NOT the pseudo holding-id).
 * Per RESEARCH Pattern 2: BridgeOutcomeBanner expects a real strategy UUID.
 */
export function toBridgeOutcomeBannerProps(
  h: FlaggedHolding,
  cb: BridgeOutcomeBannerCallbacks,
): { strategyId: string } & BridgeOutcomeBannerCallbacks {
  return {
    strategyId: h.top_candidate_strategy_id,
    ...cb,
  };
}

export type AllocatedFormCallbacks = {
  onRecorded: (outcome: BridgeOutcome) => void;
  onCancel: () => void;
  maxWeight?: number | null;
};

/**
 * Maps a flagged holding → AllocatedForm props.
 * strategyId = top_candidate_strategy_id (the candidate being allocated into).
 */
export function toAllocatedFormProps(
  h: FlaggedHolding,
  cb: AllocatedFormCallbacks,
): { strategyId: string; maxWeight: number | null; onRecorded: (o: BridgeOutcome) => void; onCancel: () => void } {
  return {
    strategyId: h.top_candidate_strategy_id,
    maxWeight: cb.maxWeight ?? null,
    onRecorded: cb.onRecorded,
    onCancel: cb.onCancel,
  };
}

export type RejectedFormCallbacks = {
  onRecorded: (outcome: BridgeOutcome) => void;
  onCancel: () => void;
};

/**
 * Maps a flagged holding → RejectedForm props.
 * strategyId = top_candidate_strategy_id (the rejected candidate).
 */
export function toRejectedFormProps(
  h: FlaggedHolding,
  cb: RejectedFormCallbacks,
): { strategyId: string; onRecorded: (o: BridgeOutcome) => void; onCancel: () => void } {
  return {
    strategyId: h.top_candidate_strategy_id,
    onRecorded: cb.onRecorded,
    onCancel: cb.onCancel,
  };
}

/**
 * Derives outcome eligibility for a flagged holding at the adapter boundary.
 *
 * Rules (per D-11 + CONTEXT §D-11):
 *   - No match_decision exists → eligible=false (no intro recorded yet; cannot record outcome)
 *   - Outcome already recorded → eligible=false, returns existingOutcome
 *   - Decision exists, no outcome → eligible=true (show banner + forms)
 */
export function deriveEligibleForOutcome(
  h: FlaggedHolding,
  matchDecisionsByHoldingRef: Record<string, { id: string } | null>,
  existingOutcomesByHoldingRef: Record<string, BridgeOutcome | null>,
): { eligible: boolean; existingOutcome: BridgeOutcome | null } {
  const ref = buildHoldingRef(h);
  const existing = existingOutcomesByHoldingRef[ref] ?? null;
  const decision = matchDecisionsByHoldingRef[ref] ?? null;
  return {
    eligible: decision !== null && existing === null,
    existingOutcome: existing,
  };
}

// ---------------------------------------------------------------------------
// Phase 10 Plan 01 / Task 3 — voluntary kind synthetic shapes (D-10 + D-11).
//
// The Scenario commit drawer (Plan 07) constructs payload diffs to POST to
// the commit API route. For two of the four diff kinds (voluntary_remove
// and voluntary_add), no real Bridge match_decision exists yet — the drawer
// uses these synthetic shapes to drive its inline form props identically to
// the real bridge_recommended path. The actual match_decisions row insert
// happens server-side in the commit route; the synthetic shapes are pure
// client-side payload constructors.
//
// DON'T modify FlaggedHolding, buildHoldingRef, or any of the four existing
// adapter functions — they are locked by Phase 09 D-11 and used unchanged
// by ScenarioFlaggedHoldingsList.tsx (v1 path) and the v2 composer.
// ---------------------------------------------------------------------------

/** Synthetic match_decision shape for voluntary_remove — used by ScenarioCommitDrawer (Plan 07). */
export interface VoluntaryRemoveDecisionShape {
  kind: "voluntary_remove";
  original_holding_ref: string;   // buildHoldingRef(holding)
  suggested_strategy_id: null;
  original_strategy_id: null;
}

/** Synthetic match_decision shape for voluntary_add — used by ScenarioCommitDrawer (Plan 07). */
export interface VoluntaryAddDecisionShape {
  kind: "voluntary_add";
  original_holding_ref: null;
  original_strategy_id: null;
  suggested_strategy_id: string;  // strategy UUID
}

export function toVoluntaryRemoveDecision(
  h: Pick<FlaggedHolding, "venue" | "symbol" | "holding_type">,
): VoluntaryRemoveDecisionShape {
  return {
    kind: "voluntary_remove",
    original_holding_ref: buildHoldingRef(h),
    suggested_strategy_id: null,
    original_strategy_id: null,
  };
}

export function toVoluntaryAddDecision(strategyId: string): VoluntaryAddDecisionShape {
  return {
    kind: "voluntary_add",
    original_holding_ref: null,
    original_strategy_id: null,
    suggested_strategy_id: strategyId,
  };
}
