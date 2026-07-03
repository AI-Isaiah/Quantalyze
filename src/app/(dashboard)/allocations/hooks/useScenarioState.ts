"use client";

/**
 * Phase 10 Plan 06a — React hook wrapping the Plan 01 pure scenario-state
 * module. As of B7a-2 the React/localStorage lifecycle is owned by the B7
 * `useCrossTabStorage` primitive; this hook layers the scenario-domain concerns
 * (default-init from live holdings, fingerprint-mismatch banner, diff count,
 * per-allocator auth-change clear) on top of it.
 *
 * What the primitive handles by construction (the unifying refactor):
 *   - debounced persist (H-0125 — no more JSON.stringify+setItem per keystroke),
 *   - a single mount-time decode (M-0137 — no double localStorage read),
 *   - zod-validated parse + version trichotomy via `scenarioDraftCodec`
 *     (M-0153 — no unchecked cast; forward-version blobs are read-only, never
 *     down-converted),
 *   - cross-tab `storage`-event sync with flush-before-adopt (the documented
 *     two-tab limitation M-0136 pinned is now closed),
 *   - fail-loud recovery breadcrumb + Sentry on a quota/corrupt write
 *     (H-0137's silently-swallowed quota error).
 *
 * What stays here (scenario domain):
 *   - `defaultDraftFromHoldings` initial draft, memoized once per
 *     (holdings, fingerprint) so `diffCount` no longer rebuilds it — and busts
 *     its memo via `new Date()` — on every draft mutation (H-0127),
 *   - `fingerprintMismatch`: a stored draft whose `init_holdings_fingerprint`
 *     no longer matches live holdings is surfaced as the reset-vs-keep banner,
 *     and the working draft falls back to the default (the stored draft is for
 *     a different holdings set). Derived as pure render state from the
 *     primitive's hydrated `value`, so an allocator-key flip can't race it,
 *   - the OLD allocator's scoped key clear on an in-session allocatorId change
 *     (T-10-02). H-0137's cross-account leak on real sign-out is closed by the
 *     `allocations.` namespace purge in SignOutButton (storage-namespaces.ts);
 *     this clear is the in-session defense-in-depth.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeHoldingsFingerprint,
  defaultDraftFromHoldings,
  scenarioDraftCodec,
  scenarioStorageKey,
  clearScenarioDraft,
  toggleHolding as toggleHoldingPure,
  addStrategyBrowse as addBrowsePure,
  addStrategyBridge as addBridgePure,
  removeAddedStrategy as removePure,
  setWeightOverride as setWeightPure,
  applyWeightOverrides as applyWeightsPure,
  setWindow as setWindowPure,
  type ScenarioDraft,
  type AddedStrategy,
  type HoldingForDefault,
} from "../lib/scenario-state";
import type { CoverageWindow } from "@/lib/scenario-window";
import { useCrossTabStorage } from "@/lib/storage/cross-tab";

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
   * holdings fingerprint. The composer uses this flag to render the warning
   * banner offering reset-vs-keep — once the allocator chooses,
   * `dismissFingerprintMismatchBanner()` clears it.
   */
  fingerprintMismatch: boolean;
  diffCount: number;
  toggleHolding: (scopeRef: string) => void;
  addStrategyBrowse: (s: AddedStrategy) => void;
  addStrategyBridge: (holdingScopeRef: string, s: AddedStrategy) => void;
  removeAddedStrategy: (id: string) => void;
  setWeightOverride: (scopeRef: string, weight: number) => void;
  /**
   * WR-01 (Phase 63 review) — `basisIds` is the optimizer apply-back's engine
   * unit universe (per-key api_key ids + added ids). Passing it renormalizes the
   * applied vector over the engine basis rather than the draft's `holding:`
   * toggle basis, so the mixed per-key + added path reproduces the suggestion
   * (no #528 dilution). Omitted by non-optimizer callers.
   */
  applyWeightOverrides: (
    weights: Record<string, number>,
    basisIds?: ReadonlyArray<string>,
  ) => void;
  /**
   * v1.5 PERSIST-01 (review CR-01) — write the composer's APPLIED coverage
   * window through into the draft, so autosave / save / share / compare all
   * carry it. Only the user-gesture path (`applyWindow`) calls this; the
   * intersection auto-default never does (a never-touched window persists as
   * ABSENT, and reopen re-derives the default). Rebases via `baseOf` like every
   * other mutator, so a window applied during the fingerprint-mismatch banner
   * operates on the default draft the user actually sees.
   */
  setWindow: (window: CoverageWindow) => void;
  reset: () => void;
  dismissFingerprintMismatchBanner: () => void;
  /**
   * Phase 23 / PERSIST-02 — the reopen seam. Writes a saved scenario's draft
   * into the in-memory working draft via the SAME `setValue` path the mutators
   * use (NOT `removeStored`, which would destructively wipe the localStorage
   * key — Pitfall 6). Because the saved draft carries its own
   * `init_holdings_fingerprint`, the existing `fingerprintMismatch` banner
   * DERIVES automatically when the saved draft was built against a different
   * holdings set — there is no `loadedFromDb` bypass branch (Pitfall 2). The
   * codec trichotomy (`scenarioDraftCodec`: ok / readonly / reset) is applied
   * by the caller BEFORE invoking this — a `reset` draft is never hydrated (the
   * composer renders an honest "older format" notice instead). A fresh open
   * un-dismisses the banner so a freshly-opened drifted scenario shows it.
   */
  hydrateFromSaved: (draft: ScenarioDraft) => void;
}

export function useScenarioState(
  opts: UseScenarioStateOptions,
): UseScenarioStateReturn {
  const { holdingsSummary, allocatorId } = opts;

  const fingerprint = useMemo(
    () => computeHoldingsFingerprint(holdingsSummary),
    [holdingsSummary],
  );

  // H-0127 — the default draft is memoized once per (holdings, fingerprint).
  // diffCount reads it without rebuilding it (and re-running its
  // `new Date().toISOString()`) on every draft mutation, and the codec uses it
  // as the absent/corrupt/version-ahead fallback.
  const defaultDraft = useMemo(
    () => defaultDraftFromHoldings(holdingsSummary, fingerprint),
    [holdingsSummary, fingerprint],
  );

  // Codec recreated only when the default fallback changes. decode is pure;
  // fingerprint-mismatch is handled below, not inside the codec.
  const codec = useMemo(() => scenarioDraftCodec(defaultDraft), [defaultDraft]);

  const {
    value,
    setValue,
    removeStored,
    isHydrated,
  } = useCrossTabStorage<ScenarioDraft>({
    key: scenarioStorageKey(allocatorId),
    initial: defaultDraft,
    codec,
    // Empty allocatorId (pre-auth) runs the hook in pure in-memory mode — never
    // touches a prefix-only `allocations.scenario_v0_15.` key.
    enabled: Boolean(allocatorId),
    // Long-form weight edits debounce so a fast typist/slider drag coalesces
    // into one write instead of a setItem per keystroke (H-0125).
    debounceMs: 150,
    sentryArea: "scenario-draft",
    // No recoveryKey: a corrupt/forward-version read still fails loud via the
    // primitive's console.warn + Sentry breadcrumb. We deliberately do NOT emit
    // the sessionStorage recovery breadcrumb because the scenario surface has no
    // banner draining it yet — an un-drained breadcrumb is a dead surface. A
    // user-facing forward-version read-only UX (a banner + reset-to-recover) is
    // deferred until the scenario surface grows a recovery banner of its own.
  });

  // Stable refs so the mutator callbacks can rebase onto the current default
  // without re-creating. Updated in an effect (not during render — the
  // react-hooks/refs lint forbids render-time ref writes); `baseOf` reads them
  // only at event time, by which point the effect has run and they are current.
  // useRef's initializer seeds them correctly for the first render too.
  const fingerprintRef = useRef(fingerprint);
  const defaultDraftRef = useRef(defaultDraft);
  useEffect(() => {
    fingerprintRef.current = fingerprint;
    defaultDraftRef.current = defaultDraft;
  }, [fingerprint, defaultDraft]);

  // Fingerprint-mismatch is PURE derived state, not an effect: a stored draft
  // whose fingerprint differs from current holdings means the draft was built
  // for a different holdings set. The default draft's fingerprint always equals
  // `fingerprint` by construction, so `value.init_holdings_fingerprint !==
  // fingerprint` identifies "the hydrated stored draft is for a stale holdings
  // set". Deriving it (instead of reconciling in an effect) re-evaluates it on
  // every render, so once the primitive re-hydrates `value` for a flipped
  // allocator key the flag settles to the correct result. There is a brief
  // window on an in-session key flip where `value` still holds the prior key's
  // draft while `fingerprint` is already the new holdings' — the flag is gated
  // on `isHydrated` and is only advisory (mutators rebase via `baseOf`, the
  // banner is dismissable), so a transient read is benign and self-corrects on
  // the re-hydration render.
  const storedMismatch =
    isHydrated &&
    Boolean(allocatorId) &&
    value.init_holdings_fingerprint !== fingerprint;

  const [mismatchDismissed, setMismatchDismissed] = useState(false);
  // A new allocator gets a fresh banner — un-dismiss when the allocator
  // changes. React's "adjust state on a prop change during render" idiom
  // (https://react.dev/learn/you-might-not-need-an-effect) rather than an
  // effect, which the react-hooks/set-state-in-effect lint forbids.
  const [prevAllocatorId, setPrevAllocatorId] = useState(allocatorId);
  if (prevAllocatorId !== allocatorId) {
    setPrevAllocatorId(allocatorId);
    setMismatchDismissed(false);
  }

  const fingerprintMismatch = storedMismatch && !mismatchDismissed;

  // On a mismatch the WORKING draft is the default (the stored draft is for a
  // different holdings set); the stale stored blob is left untouched until the
  // user edits (which persists the default-derived draft, fingerprint-current)
  // or resets (which removes it). This reproduces the pre-B7 "mismatch →
  // default-init + banner" contract without an extra write on mount.
  const draft = storedMismatch ? defaultDraft : value;

  // Auth-change side effect — clear the OLD allocator's scoped key on an
  // in-session allocatorId change. T-10-02 in-session defense-in-depth; real
  // sign-out is covered by the `allocations.` namespace purge.
  const lastClearedAllocatorId = useRef(allocatorId);
  useEffect(() => {
    if (lastClearedAllocatorId.current === allocatorId) return;
    clearScenarioDraft(lastClearedAllocatorId.current);
    lastClearedAllocatorId.current = allocatorId;
  }, [allocatorId]);

  // Mutators rebase onto the default when the primitive currently holds a
  // stale (fingerprint-mismatched) stored draft, so an edit during the banner
  // operates on the default the user actually sees — and the resulting write,
  // carrying the current fingerprint, clears the mismatch.
  const baseOf = useCallback((prev: ScenarioDraft): ScenarioDraft => {
    return prev.init_holdings_fingerprint !== fingerprintRef.current
      ? defaultDraftRef.current
      : prev;
  }, []);

  const toggleHolding = useCallback(
    (scopeRef: string) => {
      setValue((prev) => toggleHoldingPure(baseOf(prev), scopeRef));
    },
    [setValue, baseOf],
  );
  const addStrategyBrowse = useCallback(
    (s: AddedStrategy) => {
      setValue((prev) => addBrowsePure(baseOf(prev), s));
    },
    [setValue, baseOf],
  );
  const addStrategyBridge = useCallback(
    (holdingScopeRef: string, s: AddedStrategy) => {
      setValue((prev) => addBridgePure(baseOf(prev), holdingScopeRef, s));
    },
    [setValue, baseOf],
  );
  const removeAddedStrategy = useCallback(
    (id: string) => {
      setValue((prev) => removePure(baseOf(prev), id));
    },
    [setValue, baseOf],
  );
  const setWeightOverride = useCallback(
    (scopeRef: string, weight: number) => {
      setValue((prev) => setWeightPure(baseOf(prev), scopeRef, weight));
    },
    [setValue, baseOf],
  );
  const applyWeightOverrides = useCallback(
    (weights: Record<string, number>, basisIds?: ReadonlyArray<string>) => {
      setValue((prev) => applyWeightsPure(baseOf(prev), weights, basisIds));
    },
    [setValue, baseOf],
  );
  const setWindow = useCallback(
    (window: CoverageWindow) => {
      setValue((prev) => setWindowPure(baseOf(prev), window));
    },
    [setValue, baseOf],
  );
  const reset = useCallback(() => {
    // removeStored: removeItem the scoped key + set in-memory to the default
    // WITHOUT re-persisting it (the next user edit persists). Clears the banner.
    removeStored(defaultDraftRef.current);
    setMismatchDismissed(false);
  }, [removeStored]);
  const dismissFingerprintMismatchBanner = useCallback(() => {
    setMismatchDismissed(true);
  }, []);

  // Phase 23 / PERSIST-02 — reopen a saved scenario. Routed through `setValue`
  // (the mutator path), NOT `removeStored` (the reset path): the saved draft
  // becomes the in-memory working draft and autosave persists it on the next
  // edit, without destructively wiping the allocator-scoped key. The
  // fingerprint-mismatch banner is NOT special-cased here — it derives from
  // `value.init_holdings_fingerprint !== fingerprint` on the next render, so a
  // drifted saved draft surfaces the existing banner with no extra branch. A
  // fresh open un-dismisses the banner (a freshly-opened drifted scenario gets
  // a fresh banner). The codec trichotomy runs in the caller before this.
  const hydrateFromSaved = useCallback(
    (saved: ScenarioDraft) => {
      setValue(() => saved);
      setMismatchDismissed(false);
    },
    [setValue],
  );

  // M8 / H-0126 — diffCount counts:
  //   (a) toggle changes vs the default-init toggleByScopeRef,
  //   (b) added strategies (each is a user-explicit add),
  //   (c) user-explicit weight overrides via `userWeightOverrides`.
  // Toggle-off renormalization rewrites the entire weightOverrides map but NOT
  // userWeightOverrides, so it counts as exactly one toggle change (T_USE13),
  // never N weight changes. `setWeightOverride` is the only writer of
  // userWeightOverrides, so a pure-rebalance now counts (H-0126) — the prior
  // "conservative zero" locked out the voluntary_modify workflow.
  const diffCount = useMemo(() => {
    let count = 0;
    for (const [k, v] of Object.entries(draft.toggleByScopeRef)) {
      if (defaultDraft.toggleByScopeRef[k] !== v) count++;
    }
    count += draft.addedStrategies.length;
    const userExplicit = draft.userWeightOverrides ?? {};
    for (const [k, v] of Object.entries(userExplicit)) {
      // A disabled ref's user weight is not part of the committed allocation
      // (the commit path skips toggled-off refs), so it must NOT count — else a
      // weight-edit-then-toggle-off of the SAME ref double-counts (one toggle
      // change + one stale override) and the "N changes" chip over-reports.
      if (draft.toggleByScopeRef[k] !== true) continue;
      const defaultWeight = defaultDraft.weightOverrides[k];
      if (defaultWeight == null) continue;
      if (Math.abs(v - defaultWeight) > 1e-9) count++;
    }
    return count;
  }, [draft, defaultDraft]);

  return {
    draft,
    fingerprintMismatch,
    diffCount,
    toggleHolding,
    addStrategyBrowse,
    addStrategyBridge,
    removeAddedStrategy,
    setWeightOverride,
    applyWeightOverrides,
    setWindow,
    reset,
    dismissFingerprintMismatchBanner,
    hydrateFromSaved,
  };
}
