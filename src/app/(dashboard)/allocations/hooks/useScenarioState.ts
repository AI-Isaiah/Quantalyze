"use client";

/**
 * Phase 10 Plan 06a — React hook wrapping the Plan 01 pure scenario-state
 * module with localStorage hydration + persistence + per-allocator scoped
 * storage key (N1 defense-in-depth: eliminates cross-tenant collision at
 * the persistence layer).
 *
 * Plan 01's `lib/scenario-state.ts` ships:
 *   - scenarioStorageKey(allocatorId)         — base key + ".{allocatorId}"
 *   - loadScenarioDraft(allocatorId)          — SSR-safe, schema-version
 *                                                gated, returns null on miss
 *   - saveScenarioDraft(allocatorId, draft)   — SSR-safe, swallows quota
 *   - clearScenarioDraft(allocatorId)         — SSR-safe removeItem
 *   - defaultDraftFromHoldings(holdings, fp?) — initial draft
 *   - toggleHolding / addStrategyBrowse / addStrategyBridge /
 *     removeAddedStrategy / setWeightOverride — pure transforms
 *
 * This hook ENCAPSULATES React state lifecycle for scenario draft:
 * hydration, persistence, mutation, fingerprint detection, allocator-scope
 * guard. The pure module remains pure; this hook is the integration layer
 * between pure functions and React's render cycle.
 *
 * Auth-change clear is the T-10-02 mitigation, made redundant-but-defended-
 * in-depth by N1's per-allocator scoped key. The hook clears the OLD
 * allocator's key on auth change (NOT the new one — the new allocator may
 * already have a draft they want to resume).
 */

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  computeHoldingsFingerprint,
  defaultDraftFromHoldings,
  loadScenarioDraft,
  saveScenarioDraft,
  clearScenarioDraft,
  toggleHolding as toggleHoldingPure,
  addStrategyBrowse as addBrowsePure,
  addStrategyBridge as addBridgePure,
  removeAddedStrategy as removePure,
  setWeightOverride as setWeightPure,
  type ScenarioDraft,
  type AddedStrategy,
  type HoldingForDefault,
} from "../lib/scenario-state";

export interface UseScenarioStateOptions {
  holdingsSummary: HoldingForDefault[];
  /**
   * T-10-02 + N1 — scopes the localStorage key per allocator. Pass the
   * authenticated user's id (allocator id). Two allocators in the same
   * browser do NOT collide because their drafts live at different keys
   * (`allocations.scenario_v0_15.{allocatorId}`).
   */
  allocatorId: string;
}

export interface UseScenarioStateReturn {
  draft: ScenarioDraft;
  /**
   * `fingerprintMismatch` is true when the allocator's stored draft has an
   * `init_holdings_fingerprint` that does not match the current live
   * holdings fingerprint. The composer uses this `fingerprintMismatch`
   * flag to render the warning banner offering reset-vs-keep — once the
   * allocator chooses, `dismissFingerprintMismatchBanner()` clears it.
   */
  fingerprintMismatch: boolean;
  diffCount: number;
  toggleHolding: (scopeRef: string) => void;
  addStrategyBrowse: (s: AddedStrategy) => void;
  addStrategyBridge: (holdingScopeRef: string, s: AddedStrategy) => void;
  removeAddedStrategy: (id: string) => void;
  setWeightOverride: (scopeRef: string, weight: number) => void;
  reset: () => void;
  dismissFingerprintMismatchBanner: () => void;
}

export function useScenarioState(
  opts: UseScenarioStateOptions,
): UseScenarioStateReturn {
  const { holdingsSummary, allocatorId } = opts;

  const fingerprint = useMemo(
    () => computeHoldingsFingerprint(holdingsSummary),
    [holdingsSummary],
  );

  const [draft, setDraft] = useState<ScenarioDraft>(() => {
    const stored = loadScenarioDraft(allocatorId);
    if (stored && stored.init_holdings_fingerprint === fingerprint) {
      return stored;
    }
    return defaultDraftFromHoldings(holdingsSummary, fingerprint);
  });

  const [fingerprintMismatch, setFingerprintMismatch] = useState<boolean>(
    () => {
      const stored = loadScenarioDraft(allocatorId);
      return !!stored && stored.init_holdings_fingerprint !== fingerprint;
    },
  );

  // Track the previous allocatorId AS STATE (not as a ref) so we can detect
  // prop transitions during render. React 19 idiom per
  // https://react.dev/learn/you-might-not-need-an-effect §"Adjusting some
  // state when a prop changes" — calling setState during render lets React
  // discard the in-progress render and re-run with the updated state in a
  // single commit, avoiding the extra effect pass that the linter rejects
  // (`react-hooks/set-state-in-effect`).
  const [prevAllocatorId, setPrevAllocatorId] = useState(allocatorId);

  // We also keep a ref to the allocator id whose key was last cleared on
  // an auth change, so the localStorage side effect runs exactly once per
  // transition and knows which OLD key to remove.
  const lastClearedAllocatorId = useRef(allocatorId);

  if (prevAllocatorId !== allocatorId) {
    // Re-hydrate for the new allocator: respect their stored draft if its
    // fingerprint matches their current holdings; otherwise default-init
    // and surface the fingerprintMismatch banner.
    const stored = loadScenarioDraft(allocatorId);
    if (stored && stored.init_holdings_fingerprint === fingerprint) {
      setDraft(stored);
      setFingerprintMismatch(false);
    } else {
      setDraft(defaultDraftFromHoldings(holdingsSummary, fingerprint));
      setFingerprintMismatch(!!stored);
    }
    setPrevAllocatorId(allocatorId);
  }

  // Auth-change side effect — clear the OLD allocator's scoped key. T-10-02
  // mitigation made redundant-but-defended-in-depth by N1's per-allocator
  // scoped key. The ref tracks the LAST allocator we cleared, so a back-to-
  // back rerender with the same id is a no-op.
  useEffect(() => {
    if (lastClearedAllocatorId.current === allocatorId) return;
    clearScenarioDraft(lastClearedAllocatorId.current);
    lastClearedAllocatorId.current = allocatorId;
  }, [allocatorId]);

  // Persist on every draft change (per-allocator scoped key).
  useEffect(() => {
    saveScenarioDraft(allocatorId, draft);
  }, [allocatorId, draft]);

  const toggleHolding = useCallback((scopeRef: string) => {
    setDraft((d) => toggleHoldingPure(d, scopeRef));
  }, []);
  const addStrategyBrowse = useCallback((s: AddedStrategy) => {
    setDraft((d) => addBrowsePure(d, s));
  }, []);
  const addStrategyBridge = useCallback(
    (holdingScopeRef: string, s: AddedStrategy) => {
      setDraft((d) => addBridgePure(d, holdingScopeRef, s));
    },
    [],
  );
  const removeAddedStrategy = useCallback((id: string) => {
    setDraft((d) => removePure(d, id));
  }, []);
  const setWeightOverride = useCallback((scopeRef: string, weight: number) => {
    setDraft((d) => setWeightPure(d, scopeRef, weight));
  }, []);
  const reset = useCallback(() => {
    clearScenarioDraft(allocatorId);
    setDraft(defaultDraftFromHoldings(holdingsSummary, fingerprint));
    setFingerprintMismatch(false);
  }, [allocatorId, holdingsSummary, fingerprint]);
  const dismissFingerprintMismatchBanner = useCallback(() => {
    setFingerprintMismatch(false);
  }, []);

  // M8 — diffCount must NOT double-count weight overrides that are caused
  // by toggle-off renormalization (which writes new weights to ALL remaining
  // enabled rows). To avoid the "1 toggle = N changes" bug, we count:
  //   (a) toggle changes vs the default-init toggleByScopeRef
  //   (b) added strategies (each is a user-explicit add)
  //   (c) ONLY user-explicit weight overrides (not auto-renormalized weights)
  //
  // user-explicit weight overrides are tracked via the optional
  // `userWeightOverrides` field on the persisted draft. When the field is
  // absent (Plan 01's current shape), no weight changes count toward
  // diffCount — the conservative correct behavior, since toggle-off
  // renormalization writes the entire weights map and we cannot distinguish
  // explicit vs renormalized at that level. Plan 06b (composer) wires direct
  // weight inputs and may extend Plan 01 with userWeightOverrides at that
  // point; this hook reads it through a soft-typed accessor so the wiring
  // is forward-compatible.
  const diffCount = useMemo(() => {
    const defaultDraft = defaultDraftFromHoldings(holdingsSummary, fingerprint);
    let count = 0;
    // (a) toggle changes
    for (const [k, v] of Object.entries(draft.toggleByScopeRef)) {
      if (defaultDraft.toggleByScopeRef[k] !== v) count++;
    }
    // (b) added strategies
    count += draft.addedStrategies.length;
    // (c) user-explicit weight overrides (forward-compatible read)
    const userExplicit =
      (draft as { userWeightOverrides?: Record<string, number> })
        .userWeightOverrides ?? {};
    for (const [k, v] of Object.entries(userExplicit)) {
      const defaultWeight = defaultDraft.weightOverrides[k];
      if (defaultWeight == null) continue;
      if (Math.abs(v - defaultWeight) > 1e-9) count++;
    }
    return count;
  }, [draft, holdingsSummary, fingerprint]);

  return {
    draft,
    fingerprintMismatch,
    diffCount,
    toggleHolding,
    addStrategyBrowse,
    addStrategyBridge,
    removeAddedStrategy,
    setWeightOverride,
    reset,
    dismissFingerprintMismatchBanner,
  };
}
