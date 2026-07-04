/**
 * Phase 10 Plan 01 — Scenario draft state machine + localStorage persistence.
 *
 * Pure TypeScript module. No React, no hooks, no fetch, no DOM access except
 * inside the SSR-guarded localStorage helpers at the bottom. The `useScenarioState`
 * React hook lands in Plan 06 alongside the composer; this module only exposes
 * the immutable state transforms and the persistence primitives the hook will wrap.
 *
 * Key invariants:
 *   - sum(weightOverrides[ref] for ref where toggleByScopeRef[ref] === true) === 1.0
 *     after every transform operation (within 1e-9 tolerance).
 *   - All transforms return a NEW draft object — input is never mutated.
 *   - addStrategyBrowse / addStrategyBridge are dedupe-guarded (M9): a second add
 *     with the same id returns the SAME draft reference (no-op).
 *   - localStorage helpers are SSR-safe (typeof window check) and Safari-private-mode
 *     safe (try/catch swallows QuotaExceededError + JSON.parse errors).
 *   - localStorage keys are scoped per allocator (N1 defense-in-depth) — eliminates
 *     cross-tenant collision at the persistence layer.
 *   - schema_version mismatch on load returns null (forces default-init from current
 *     live holdings on schema drift).
 */

import { z } from "zod";
import { holdingScopeKey } from "@/lib/keys";
import type { DecodeResult, StorageCodec } from "@/lib/storage/cross-tab";
import { stripPoisonKeys } from "@/lib/storage/codecs";
import type { CoverageWindow } from "@/lib/scenario-window";

/**
 * H5 — phantom branded type. At runtime this is just a string; at compile time
 * it acts as a guard so a hand-rolled string can't be used as an `AddedStrategy.id`
 * without an explicit cast. Only `addStrategyBrowse`/`addStrategyBridge` mint
 * branded values via the input strategy's `id` field, and the cast happens once
 * at the boundary in scenario-adapter.ts when keying lookup maps.
 */
export type StrategyForBuilderId = string & {
  readonly __brand: "scenario-builder-id";
};

/** N1 — base storage key, exported for grep-discovery only. All load/save/clear
 *  callers MUST use scenarioStorageKey(allocatorId) to scope to a single allocator. */
export const SCENARIO_STORAGE_KEY_BASE = "allocations.scenario_v0_15";

/** Bumped when the persisted ScenarioDraft shape changes incompatibly. Loads with
 *  a different schema_version are dropped on read (return null) so the hook
 *  re-initializes from current live holdings — the reset-on-mismatch idiom
 *  shared by the versioned-storage codecs.
 *
 *  v1 → v2 (read-only-tokens model): live holdings are now FIXED context — the UI
 *  no longer renders a per-holding toggle or weight/leverage input. A v1 draft
 *  could carry a holding toggled OFF or manually reweighted; under the new UI that
 *  state is unreachable AND silently mis-drives the projection / scenarioAum /
 *  diffCount (a holding excluded from the curve with no affordance to re-enable,
 *  and a diffCount that enables Commit while handleCommit produces nothing). The
 *  bump drops those legacy drafts on load so every draft starts from the current
 *  holdings with all holdings included — the clean root fix, not a per-consumer
 *  guard against legacy toggle state.
 *
 *  v2 → v3 (v1.5 PERSIST-01, coverage window): adds an OPTIONAL, additive
 *  `window?: CoverageWindow` field. Unlike v1→v2, this transition is
 *  NON-DESTRUCTIVE — a v2 draft is fully valid, just windowless, so it MUST
 *  upgrade on read (outcome "ok" + a transient provenance marker), never reset.
 *  See the `SCENARIO_SCHEMA_VERSION_PREV` branch in scenarioDraftCodec.decode:
 *  reusing the reset-on-mismatch path here would SILENTLY DELETE every saved
 *  scenario (Phase-59 Pitfall 1).
 *
 *  v3 → v4 (v1.6 MEMBER-01, explicit series membership): adds a REQUIRED-at-v4
 *  `memberKeyIds: string[]` field. Like v2→v3 this transition is
 *  NON-DESTRUCTIVE — a v3 draft is fully valid, just membership-less, so it
 *  upgrades on read (outcome "ok" + reason "upgraded_v3_membership", membership
 *  left UNDERIVED), never reset. Because the bump is a DOUBLE bump (PREV also
 *  moves 2→3), a two-versions-back v2 draft would otherwise fall to the final
 *  reset — so the codec carries a SECOND, literal-`rawVersion === 2` chain
 *  branch (reason "upgraded_v2_chain") alongside the PREV (v3) branch. Both
 *  decode "ok"; neither drops a stored draft. The v4 membership CONTRACT is
 *  fail-loud at the SAVE boundary only (`scenarioDraftSaveSchema`), never in the
 *  codec — an underived-v4 draft that round-trips through the localStorage codec
 *  MUST decode "ok" or every upgraded draft is silently dropped (the blocker). */
export const SCENARIO_SCHEMA_VERSION = 4;

/** The immediately-prior schema version. Keys the NON-DESTRUCTIVE v3→v4 upgrade
 *  branch in the codec (a named constant is clearer than a bare
 *  `SCENARIO_SCHEMA_VERSION - 1` and documents WHY that branch exists). Bump
 *  this to the old CURRENT whenever SCENARIO_SCHEMA_VERSION is bumped and the
 *  transition is non-destructive. NOTE: because the v3→v4 bump is a DOUBLE bump,
 *  the codec ALSO carries a literal-`rawVersion === 2` chain branch below PREV
 *  (reason "upgraded_v2_chain") so a two-versions-back v2 draft is not dropped. */
export const SCENARIO_SCHEMA_VERSION_PREV = 3;

/** N1 — eliminates cross-tenant collision at the persistence layer. Returns
 *  "allocations.scenario_v0_15.{allocatorId}". */
export function scenarioStorageKey(allocatorId: string): string {
  return `${SCENARIO_STORAGE_KEY_BASE}.${allocatorId}`;
}

export interface AddedStrategy {
  /** H5-branded — minted only when the strategy enters draft state via
   *  addStrategyBrowse / addStrategyBridge. Outside callers must cast at
   *  the construction boundary. */
  id: StrategyForBuilderId;
  name: string;
  markets: string[];
  strategy_types: string[];
}

export interface ScenarioDraft {
  schema_version: number;
  init_holdings_fingerprint: string;
  /** ref → enabled. Refs are either a holding scope_ref ("holding:{venue}:{symbol}:{type}")
   *  or an added strategy id (UUID). */
  toggleByScopeRef: Record<string, boolean>;
  addedStrategies: AddedStrategy[];
  /** ref → 0..1 weight; sum over enabled refs === 1.0. */
  weightOverrides: Record<string, number>;
  /**
   * H-0126 — refs the user explicitly re-weighted via `setWeightOverride`
   * (NOT the auto-renormalized weights that toggle-off / add* write across the
   * whole enabled set). `diffCount` reads ONLY this map for weight changes, so
   * a pure-rebalance (weight edits without any toggle/add) now counts toward
   * `diffCount` and un-blocks the Commit button — the documented
   * voluntary_modify (CONTEXT D-17) workflow the prior "conservative" zero
   * silently locked out. Optional + additive: pre-B7 drafts (field absent)
   * load unchanged; the zod codec marks it optional so no schema_version bump.
   */
  userWeightOverrides?: Record<string, number>;
  /**
   * v1.5 PERSIST-01 — the saved coverage window (the honest co-live blend
   * window). Optional + additive: a v2 (pre-v1.5) draft omits it and defaults
   * to the intersection via `defaultWindowFor()` on open. Same `CoverageWindow`
   * shape as `ScenarioState.window` so the value threads unchanged into the
   * engine. Left undefined by the non-destructive v2→v3 upgrade branch.
   */
  window?: CoverageWindow;
  /**
   * v1.6 MEMBER-01 — the EXPLICIT saved series membership: the api_key ids whose
   * strategies constitute this draft's book. REQUIRED at schema_version 4; an
   * empty array means blank-authored (no book members). The non-destructive
   * upgrade branches (v2-chain, v3-membership) leave it UNDERIVED (absent) — an
   * older draft predates the field, so the codec never fabricates membership;
   * plan 04 derives + stamps it on reopen. An underived-v4 blob that round-trips
   * through the localStorage codec also legitimately reaches the v4 branch with
   * this field absent, which is why the codec-decode schema is TOLERANT (see
   * scenarioDraftSchema). The v4 REQUIRED contract is enforced only at the save
   * boundary via `scenarioDraftSaveSchema`, never by the codec.
   */
  memberKeyIds: string[];
  lastEditedAt: string;
}

export interface HoldingForFingerprint {
  symbol: string;
  venue: string;
  holding_type: string;
}

export interface HoldingForDefault extends HoldingForFingerprint {
  value_usd: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Internal: build the holding scope_ref via the canonical B8 key builder so
 *  this module cannot drift from the persisted/bridge scope_ref shape it is
 *  compared against cross-module. (keys.ts is import-free, so the Plan-01
 *  directive — no FlaggedHolding/adapter imports — is preserved.) */
function holdingRefOf(h: HoldingForFingerprint): string {
  return holdingScopeKey(h);
}

/**
 * Clamp a single weight value to [0, 1]. Non-finite inputs (NaN, Infinity)
 * collapse to 0 — the wire schema rejects anything outside [0, 1] and
 * negative or >1 weights produce nonsensical renormalize scaling. The
 * public mutators (toggleHolding / addStrategy* / setWeightOverride) wrap
 * their final weightOverrides map with `clampAllWeights` as a defense-in-
 * depth exit gate; setWeightOverride additionally rejects non-finite
 * inputs at the entry point to keep the no-op semantics it documents.
 */
function clampWeight(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clampAllWeights(
  weights: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(weights)) {
    out[k] = clampWeight(weights[k]);
  }
  return out;
}

/**
 * Deterministic, order-invariant fingerprint of a holdings set. Sort by
 * "{symbol}:{venue}:{holding_type}" then join with "|". Collision resistance
 * is NOT required — the fingerprint exists to detect when live holdings
 * have structurally changed since the draft was written. (Pitfall 4)
 */
export function computeHoldingsFingerprint(
  holdings: HoldingForFingerprint[],
): string {
  return holdings
    .map((h) => `${h.symbol}:${h.venue}:${h.holding_type}`)
    .slice()
    .sort((a, b) => a.localeCompare(b))
    .join("|");
}

/**
 * CR-01 (Phase 63 review) — the SINGLE drift predicate both the reopen path
 * (`ScenarioComposer.openSavedScenario`) and the hook (`useScenarioState`'s
 * `storedMismatch` / `baseOf`) consume, so the two decisions can never diverge.
 *
 * A draft is "drifted" (its saved holdings basis is stale relative to what the
 * composer now presents) IFF its fingerprint matches NEITHER:
 *   - the GATED default (`gatedFingerprint`) — the holdings the composer seeds
 *     THIS render (`[]` in blank mode), so a fresh blank-authored draft is never
 *     drifted; NOR
 *   - the LIVE book (`liveBookFingerprint`) — the mode-UNgated live holdings, so
 *     a book draft that still matches the live book is never drifted even when a
 *     gate=false holder is forced into blank mode (the CR-01 case-(a) hole).
 *
 * In book mode `gatedFingerprint === liveBookFingerprint`, so this reduces to
 * the pre-Phase-63 single-fingerprint check (book-mode behavior is unchanged).
 */
export function isDraftDrifted(
  draftFingerprint: string,
  gatedFingerprint: string,
  liveBookFingerprint: string,
): boolean {
  return (
    draftFingerprint !== gatedFingerprint &&
    draftFingerprint !== liveBookFingerprint
  );
}

/**
 * Renormalize weights so that the sum over `enabledIds` === 1.0. When the sum
 * of the input weights over the enabled subset is 0, fall back to equal
 * distribution. Disabled ids are excluded from the output entirely.
 */
export function renormalizeWeights(
  weights: Record<string, number>,
  enabledIds: string[],
): Record<string, number> {
  const sum = enabledIds.reduce((s, id) => s + (weights[id] ?? 0), 0);
  const out: Record<string, number> = {};
  if (sum === 0) {
    const equal = enabledIds.length > 0 ? 1 / enabledIds.length : 0;
    for (const id of enabledIds) out[id] = equal;
    return out;
  }
  for (const id of enabledIds) out[id] = (weights[id] ?? 0) / sum;
  return out;
}

/**
 * L5 — pinned signature: `defaultDraftFromHoldings(holdings: HoldingForDefault[], fingerprint?: string)`.
 * The hook in Plan 06 passes the fingerprint it already computed (avoids
 * double work); when omitted, this function calls computeHoldingsFingerprint
 * internally. Either way the returned `init_holdings_fingerprint` is
 * deterministic for the same holding set.
 */
export function defaultDraftFromHoldings(
  holdings: HoldingForDefault[],
  fingerprint?: string,
): ScenarioDraft {
  const total = holdings.reduce(
    (s, h) => s + (Number.isFinite(h.value_usd) ? h.value_usd : 0),
    0,
  );
  const toggleByScopeRef: Record<string, boolean> = {};
  const weightOverrides: Record<string, number> = {};
  for (const h of holdings) {
    const ref = holdingRefOf(h);
    toggleByScopeRef[ref] = true;
    weightOverrides[ref] = total > 0 ? h.value_usd / total : 0;
  }
  return {
    schema_version: SCENARIO_SCHEMA_VERSION,
    init_holdings_fingerprint: fingerprint ?? computeHoldingsFingerprint(holdings),
    toggleByScopeRef,
    addedStrategies: [],
    weightOverrides: clampAllWeights(weightOverrides),
    // v1.6 MEMBER-01 — a fresh holdings-seeded draft has no explicit book
    // members yet (only `holdings` is in scope here); the composer stamps real
    // membership via setMemberKeyIds on save (plan 04).
    memberKeyIds: [],
    lastEditedAt: new Date().toISOString(),
  };
}

function enabledIdsOf(draft: ScenarioDraft): string[] {
  return Object.keys(draft.toggleByScopeRef).filter(
    (k) => draft.toggleByScopeRef[k] === true,
  );
}

/**
 * Toggle a holding/strategy ref on or off. Uses a symmetric scale rule that
 * makes double-toggle exactly idempotent (T1.3 pin):
 *
 *   - Toggle OFF (row weight = w): preserve the off-row's weight in
 *     `weightOverrides`, and scale the OTHER enabled rows by `1 / (1 - w)`
 *     so they alone sum to 1.0. (Edge: if `w >= 1` or other-rows-sum is 0,
 *     fall back to equal distribution over the new enabled set.)
 *   - Toggle ON (row weight = w from history): scale the OTHER previously
 *     enabled rows by `(1 - w)` so the toggled row + others sum to 1.0
 *     again. (Edge: if no preserved weight or w == 0, fall back to
 *     proportional renormalization over the new enabled set.)
 *
 * Returns a new draft (never mutates).
 */
export function toggleHolding(
  draft: ScenarioDraft,
  scopeRef: string,
): ScenarioDraft {
  const currentlyOn = draft.toggleByScopeRef[scopeRef] === true;
  const nextOn = !currentlyOn;
  const nextToggle = { ...draft.toggleByScopeRef, [scopeRef]: nextOn };
  const w = draft.weightOverrides[scopeRef] ?? 0;

  // Decide the OTHER enabled set under the new toggle state.
  const otherEnabled = Object.keys(nextToggle).filter(
    (k) => nextToggle[k] === true && k !== scopeRef,
  );
  const otherSum = otherEnabled.reduce(
    (s, id) => s + (draft.weightOverrides[id] ?? 0),
    0,
  );

  const nextWeights: Record<string, number> = { ...draft.weightOverrides };

  if (!nextOn) {
    // Toggle OFF: preserve `w` for `scopeRef`; scale OTHER enabled rows so
    // they alone sum to 1.0.
    if (otherEnabled.length === 0) {
      // Only-row case: nothing to renormalize.
    } else if (w >= 1 || otherSum === 0) {
      const equal = 1 / otherEnabled.length;
      for (const id of otherEnabled) nextWeights[id] = equal;
    } else {
      const scale = 1 / (1 - w);
      for (const id of otherEnabled) {
        nextWeights[id] = (draft.weightOverrides[id] ?? 0) * scale;
      }
    }
  } else {
    // Toggle ON: this row had weight `w` historically. Restore `w` as the
    // source of truth and scale OTHER enabled rows by `(1 - w)` so the new sum
    // (this row + others) equals 1.0.
    //
    // M-0152: the guard is `w > 0 && w <= 1` (not the old `w < 1`) AND there
    // must be other enabled rows to absorb the complement. The old `w < 1`
    // boundary dropped a preserved weight of EXACTLY 1 (a holding toggled off
    // while it was the sole position, weight 1.0 preserved) into the
    // equal-distribution fallback below, silently discarding the 100% intent.
    // With `w === 1` + others, `scale = 0` zeroes the others and this row keeps
    // the full 1.0 — restoring intent. A preserved `w === 0` (sold-down row) or
    // a first-time enable (no stored weight) or the sole-row case still take the
    // proportional-renormalize fallback, where the sum-zero branch hands a lone
    // row the full 1.0.
    if (otherEnabled.length > 0 && w > 0 && w <= 1) {
      const scale = 1 - w;
      for (const id of otherEnabled) {
        nextWeights[id] = (draft.weightOverrides[id] ?? 0) * scale;
      }
      // `nextWeights[scopeRef]` already === w (carried from prior state).
      nextWeights[scopeRef] = w;
    } else {
      // No useful prior weight (first time enabling, stored value 0, or sole
      // enabled row) — fall back to plain renormalization over the new enabled
      // set, treating this row's prior weight as 0 so it picks up an
      // equal-share-of-zero fallback when others were also zero, or its
      // proportional share otherwise.
      const newEnabled = [scopeRef, ...otherEnabled];
      const renormed = renormalizeWeights(
        { ...draft.weightOverrides, [scopeRef]: 0 },
        newEnabled,
      );
      for (const id of newEnabled) nextWeights[id] = renormed[id] ?? 0;
    }
  }

  return {
    ...draft,
    toggleByScopeRef: nextToggle,
    weightOverrides: clampAllWeights(nextWeights),
    lastEditedAt: new Date().toISOString(),
  };
}

/**
 * Browse-add (D-03): the new strategy is allocated `1 / (n + 1)` and the
 * existing enabled set is scaled by `1 - 1/(n+1)`. Maintains sum === 1.0.
 *
 * M9 dedupe: if the strategy's id is already in `addedStrategies`, returns
 * the SAME draft reference (no-op).
 *
 * Disabled-row weight preservation (review fix P2): seed `nextWeights` from
 * the entire `weightOverrides` map (not an empty object) so any preserved
 * weight on a CURRENTLY DISABLED row survives the add. Without this, the
 * iteration below — which only touches `enabledBefore` ids — would drop the
 * disabled row's preserved value, and a subsequent toggle-on of that row
 * would fall back to equal-distribution instead of restoring the original
 * stored weight (toggleHolding's "Toggle ON" branch only restores a preserved
 * weight when there are other enabled rows and `w > 0 && w <= 1` — the M-0152
 * guard, which now also restores at exactly `w === 1`).
 */
export function addStrategyBrowse(
  draft: ScenarioDraft,
  strategy: AddedStrategy,
): ScenarioDraft {
  // M9 — dedupe guard: already in addedStrategies → no-op.
  if (draft.addedStrategies.some((s) => s.id === strategy.id)) return draft;

  const enabledBefore = enabledIdsOf(draft);
  const n = enabledBefore.length;
  const newWeight = 1 / (n + 1);
  const scale = 1 - newWeight;
  // Seed from existing overrides so disabled-row preserved weights survive.
  const nextWeights: Record<string, number> = { ...draft.weightOverrides };
  for (const id of enabledBefore) {
    nextWeights[id] = (draft.weightOverrides[id] ?? 0) * scale;
  }
  nextWeights[strategy.id] = newWeight;

  return {
    ...draft,
    addedStrategies: [...draft.addedStrategies, strategy],
    toggleByScopeRef: { ...draft.toggleByScopeRef, [strategy.id]: true },
    weightOverrides: clampAllWeights(nextWeights),
    lastEditedAt: new Date().toISOString(),
  };
}

/**
 * Bridge-add (D-03): the new strategy takes the flagged holding's current
 * weight; renormalize the entire enabled set so sum === 1.0. The flagged
 * holding REMAINS enabled — allocator may opt to dilute or toggle off later.
 *
 * M9 dedupe: if the strategy's id is already in `addedStrategies`, returns
 * the SAME draft reference (no-op).
 */
export function addStrategyBridge(
  draft: ScenarioDraft,
  holdingScopeRef: string,
  strategy: AddedStrategy,
): ScenarioDraft {
  // M9 — dedupe guard: already in addedStrategies → no-op.
  if (draft.addedStrategies.some((s) => s.id === strategy.id)) return draft;

  const heldWeight = draft.weightOverrides[holdingScopeRef] ?? 0;
  const preWeights: Record<string, number> = {
    ...draft.weightOverrides,
    [strategy.id]: heldWeight,
  };
  const nextToggle = { ...draft.toggleByScopeRef, [strategy.id]: true };
  const nextEnabled = Object.keys(nextToggle).filter(
    (k) => nextToggle[k] === true,
  );
  const nextWeights = renormalizeWeights(preWeights, nextEnabled);

  return {
    ...draft,
    addedStrategies: [...draft.addedStrategies, strategy],
    toggleByScopeRef: nextToggle,
    weightOverrides: clampAllWeights(nextWeights),
    lastEditedAt: new Date().toISOString(),
  };
}

/**
 * Remove an added strategy from the draft entirely (from `addedStrategies`,
 * `toggleByScopeRef`, and `weightOverrides`). Renormalizes the remaining
 * enabled set so sum === 1.0.
 */
export function removeAddedStrategy(
  draft: ScenarioDraft,
  strategyId: string,
): ScenarioDraft {
  const nextAdded = draft.addedStrategies.filter((s) => s.id !== strategyId);
  // No-op if nothing changed (defensive).
  if (nextAdded.length === draft.addedStrategies.length) return draft;

  const nextToggle = { ...draft.toggleByScopeRef };
  delete nextToggle[strategyId];
  const remainingWeights = { ...draft.weightOverrides };
  delete remainingWeights[strategyId];
  const nextEnabled = Object.keys(nextToggle).filter(
    (k) => nextToggle[k] === true,
  );
  const nextWeights = renormalizeWeights(remainingWeights, nextEnabled);

  return {
    ...draft,
    addedStrategies: nextAdded,
    toggleByScopeRef: nextToggle,
    weightOverrides: clampAllWeights(nextWeights),
    lastEditedAt: new Date().toISOString(),
  };
}

/**
 * Set a manual weight override for one ref. Other enabled refs are scaled
 * proportionally so the total sum === 1.0. Used by D-17 voluntary_modify
 * weight inputs.
 *
 * Non-finite inputs (NaN, Infinity from a bad paste) are refused as a no-op
 * so a coerced Number(input) at the input edge can't blow up downstream
 * renormalize math. The composer wraps this call to surface a visible error
 * for the same case so the rejection isn't silent at the UI layer.
 */
export function setWeightOverride(
  draft: ScenarioDraft,
  scopeRef: string,
  newWeight: number,
): ScenarioDraft {
  if (!Number.isFinite(newWeight)) return draft;
  const clamped = clampWeight(newWeight);

  const enabledIds = enabledIdsOf(draft);
  const otherIds = enabledIds.filter((id) => id !== scopeRef);
  const otherSum = otherIds.reduce(
    (s, id) => s + (draft.weightOverrides[id] ?? 0),
    0,
  );
  const remainingMass = 1 - clamped;
  const nextWeights: Record<string, number> = { ...draft.weightOverrides };
  nextWeights[scopeRef] = clamped;

  if (otherSum === 0) {
    // Fall back to equal distribution of the remaining mass.
    const equal = otherIds.length > 0 ? remainingMass / otherIds.length : 0;
    for (const id of otherIds) nextWeights[id] = equal;
  } else {
    const scale = remainingMass / otherSum;
    for (const id of otherIds) {
      nextWeights[id] = (draft.weightOverrides[id] ?? 0) * scale;
    }
  }

  return {
    ...draft,
    weightOverrides: clampAllWeights(nextWeights),
    // H-0126 — record the ref the USER explicitly re-weighted. This is the
    // only writer of userWeightOverrides; toggle-off / add* renormalization
    // (which rewrites the whole enabled set) deliberately does NOT touch it, so
    // diffCount counts a pure-rebalance without double-counting renormalization.
    userWeightOverrides: {
      ...(draft.userWeightOverrides ?? {}),
      [scopeRef]: clamped,
    },
    lastEditedAt: new Date().toISOString(),
  };
}

/**
 * Apply a FULL weight vector atomically (Phase 28 OPT-01 — "Apply suggested
 * weights to the draft").
 *
 * CRITICAL distinction from `setWeightOverride`: that primitive sets ONE ref and
 * proportionally renormalizes the OTHERS to keep the total at 1.0. Looping it
 * over a vector is WRONG — each call re-scales the weights written by the
 * previous calls, so the draft lands at a DIFFERENT allocation than the one
 * supplied (only the last ref is exact). This writes every provided ref in ONE
 * pass and renormalizes over the BASIS set exactly once, so applying an
 * optimizer's sum-to-1 vector reproduces it (within float error). `basisIds`
 * selects that renormalization basis: omit it for the draft's enabled toggle set
 * (legacy), or pass the engine unit ids (WR-01 — the composer's optimizer
 * apply-back does this so the mixed per-key + added path is not diluted by stale
 * `holding:` override mass). Non-finite / negative / empty input is a no-op
 * (defensive). Every provided ref is recorded as a user-explicit override (the
 * allocator clicked Apply).
 */
export function applyWeightOverrides(
  draft: ScenarioDraft,
  weights: Record<string, number>,
  basisIds?: ReadonlyArray<string>,
): ScenarioDraft {
  const refs = Object.keys(weights);
  if (refs.length === 0) return draft;
  if (!refs.every((r) => Number.isFinite(weights[r]) && weights[r] >= 0)) {
    return draft;
  }

  // WR-01 (Phase 63 review) — the renormalization basis. By default the DRAFT's
  // enabled toggle set (`holding:` refs + added ids). But in book+gate mode the
  // ENGINE universe is the per-key units (api_key UUIDs) + added ids, which
  // never enter the toggle map — so renormalizing an optimizer suggestion over
  // the toggle basis leaves the stale holding-override mass in the denominator
  // and silently dilutes the added sleeve (#528 apply-back drift). The composer
  // therefore passes the optimizer's ENGINE unit ids as `basisIds` so the
  // applied blend reproduces the suggestion exactly. When omitted (non-optimizer
  // callers), the legacy enabled-set basis is preserved.
  const normBasis = basisIds ? [...basisIds] : enabledIdsOf(draft);
  // Start from the current map, overwrite the provided refs, then renormalize
  // ONCE over the basis set (a single normalization, NOT the per-ref rebalance
  // setWeightOverride does). renormalizeWeights only writes the basis ids, so a
  // ref outside the basis keeps its prior stored weight (restored if it re-enters
  // the basis).
  const merged: Record<string, number> = { ...draft.weightOverrides };
  for (const r of refs) merged[r] = clampWeight(weights[r]);
  const normalized = renormalizeWeights(merged, normBasis);
  const nextWeights: Record<string, number> = { ...merged, ...normalized };

  return {
    ...draft,
    weightOverrides: clampAllWeights(nextWeights),
    userWeightOverrides: {
      ...(draft.userWeightOverrides ?? {}),
      ...Object.fromEntries(refs.map((r) => [r, nextWeights[r] ?? merged[r]])),
    },
    lastEditedAt: new Date().toISOString(),
  };
}

/**
 * v1.5 PERSIST-01 (review CR-01) — set the draft's saved coverage window.
 *
 * This is the ONE production writer of `draft.window`: the composer's
 * `applyWindow` (user gesture — preset / custom picker / "Show full range")
 * writes through here so the localStorage autosave, the save routes' POST/PUT
 * payload, a minted share, and compare all carry the applied window. The
 * WINDOW-01 intersection auto-default deliberately does NOT route here — a
 * never-touched window stays absent so a windowless draft saves windowless and
 * reopen re-derives the default (force-persisting the default would freeze it
 * against future coverage growth). Clearing happens by draft REPLACEMENT
 * (reset / hydrateFromSaved), never by a clear-gesture, so no undefined arm.
 *
 * M9-style no-op: setting the SAME window returns the SAME draft reference
 * (no lastEditedAt churn, no autosave write).
 */
export function setWindow(
  draft: ScenarioDraft,
  window: CoverageWindow,
): ScenarioDraft {
  if (
    draft.window &&
    draft.window.start === window.start &&
    draft.window.end === window.end
  ) {
    return draft;
  }
  return {
    ...draft,
    window: { start: window.start, end: window.end },
    lastEditedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// v1.6 MEMBER-01 — the three SHARED membership functions the rest of Phase 62
// consumes. Kept as pure exported definitions here (the ONE source of truth) so
// plans 02/03/04 import them rather than re-deriving membership divergently.
// ---------------------------------------------------------------------------

/**
 * The ONE upgrade-read derivation rule: given the runtime include-gate and the
 * currently-eligible api_key ids, return the explicit membership an upgraded
 * (pre-v4) draft SHOULD carry. Gate on → a COPY of the eligible ids; gate off →
 * empty. Returns a FRESH array (never the input reference) so a caller cannot
 * alias the source list into persisted draft state. Deliberately does NOT read
 * `entryMode` — old drafts predate it, so membership derives from the gate +
 * eligibility alone (plan 04 stamps the result via setMemberKeyIds on reopen).
 */
export function deriveMembershipFromGate(
  gate: boolean,
  eligibleApiKeyIds: string[],
): string[] {
  return gate ? [...eligibleApiKeyIds] : [];
}

/**
 * The new-save STAMP transform: return a copy of `draft` with `memberKeyIds`
 * replaced by `ids` (pure — never mutates the input). DISTINCT from
 * `deriveMembershipFromGate` (which COMPUTES the ids from the gate); this only
 * writes an already-computed membership into a draft. The composer invokes it on
 * save (plan 04) so the persisted localStorage blob converges to a proper
 * v4-with-membership draft.
 */
export function setMemberKeyIds(
  draft: ScenarioDraft,
  ids: string[],
): ScenarioDraft {
  return { ...draft, memberKeyIds: ids };
}

// ---------------------------------------------------------------------------
// B7 cross-tab storage codec — zod-validated parse + version trichotomy.
// The cross-tab primitive (useCrossTabStorage) owns the localStorage
// mechanics; this codec owns parse + validate + version + serialize for the
// ScenarioDraft shape. M-0153 — replaces the pre-B7 unchecked
// `JSON.parse(raw) as ScenarioDraft` with a whole-shape zod parse so a
// localStorage blob whose shape drifted from the in-memory type can no longer
// flow a wrong-typed toggleByScopeRef / missing weightOverrides into the
// running draft.
// ---------------------------------------------------------------------------

const addedStrategySchema = z.object({
  id: z.string(),
  name: z.string(),
  markets: z.array(z.string()),
  strategy_types: z.array(z.string()),
});

/**
 * Red-team FIX A (HIGH, DoS / storage-poison) — bound the entry count of every
 * unbounded `z.record(...)` in the draft. The save/update routes persist this
 * blob verbatim into `scenarios.draft` (jsonb); an UNCAPPED record let a
 * hostile client write an arbitrarily large map (millions of synthetic keys)
 * and poison the row / inflate storage. `MAX_DRAFT_RECORD_ENTRIES` is set far
 * beyond any realistic portfolio (a real allocator has <~100 holdings + a
 * handful of added strategies; 2000 is ~20× the largest plausible book) so a
 * LEGITIMATE draft is never rejected, while a synthetic mega-map is. Applied as
 * a `.refine()` on each record because zod has no native key-count cap.
 *
 * This mirrors the commit route's `.max()` DoS caps
 * (`init_holdings_fingerprint: z.string().max(200_000)`,
 * `diffs: z.array(...).max(50)`) — see commit/route.ts.
 */
const MAX_DRAFT_RECORD_ENTRIES = 2000;
const MAX_DRAFT_KEY_LENGTH = 512;

const boundedRecord = <V extends z.ZodTypeAny>(value: V, label: string) =>
  z
    .record(z.string().max(MAX_DRAFT_KEY_LENGTH), value)
    .refine((o) => Object.keys(o).length <= MAX_DRAFT_RECORD_ENTRIES, {
      message: `${label}: too many entries (max ${MAX_DRAFT_RECORD_ENTRIES})`,
    });

/** Whole-shape validation for a persisted ScenarioDraft. `schema_version` is
 *  validated as a number here; the version *trichotomy* (higher → read-only,
 *  equal → adopt, lower/missing → reset) is applied by the codec below, not by
 *  the schema. `userWeightOverrides` is optional so pre-B7 blobs validate.
 *
 *  FIX A — every variable-length field carries a GENEROUS upper bound so the
 *  persisted blob cannot be inflated without limit (DoS / storage-poison). The
 *  caps sit comfortably above any realistic portfolio so a legitimate draft
 *  validates unchanged; they only reject a synthetic mega-payload. */
export const scenarioDraftSchema = z.object({
  schema_version: z.number(),
  // Mirror the commit route's `init_holdings_fingerprint: z.string().max(200_000)`.
  init_holdings_fingerprint: z.string().max(200_000),
  toggleByScopeRef: boundedRecord(z.boolean(), "toggleByScopeRef"),
  // A real draft adds a handful of strategies; 200 is far beyond any UI flow.
  addedStrategies: z.array(addedStrategySchema).max(200),
  weightOverrides: boundedRecord(z.number(), "weightOverrides"),
  userWeightOverrides: boundedRecord(z.number(), "userWeightOverrides").optional(),
  // v1.5 PERSIST-01 — the saved coverage window. Optional so v2 (windowless)
  // drafts still validate. Each bound must be an exact `YYYY-MM-DD` ISO day
  // (pre-landing review I5): every first-party writer emits that shape, so a
  // non-ISO bound is corruption/tampering and fails safeParse → the codec's
  // established corrupt-v3 reset path (the regex subsumes the old `.max(32)`
  // FIX A storage-poison bound). Deliberately NO `start <= end` refine — a
  // refine failure on a v3 draft would route to reset and could DELETE a
  // user's draft over an inverted-but-well-formed window; the engine degrades
  // honestly on inversion instead (member_count 0 class, never a fabricated
  // curve).
  window: z
    .object({
      start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .optional(),
  // v1.6 MEMBER-01 — the explicit series membership. `.optional()` (Pitfall 3)
  // and DELIBERATELY NO superRefine on THIS shared schema: the codec safeParses
  // it in EVERY decode branch, so a v2/v3 upgrade blob (membership absent) AND
  // an underived-v4 round-trip blob (membership absent after the in-memory
  // upgrade re-serializes) both MUST safeParse clean — a required field or a
  // v4-membership superRefine here would fail safeParse and route those blobs to
  // reset, SILENTLY DELETING every upgraded draft on the localStorage round-trip
  // (the blocker). The v4 REQUIRED contract lives on `scenarioDraftSaveSchema`
  // below. Bounds (T-62-02 DoS): ≤64 ids, each ≤MAX_DRAFT_KEY_LENGTH chars,
  // under the route-level MAX_DRAFT_BODY_BYTES cap.
  memberKeyIds: z.array(z.string().max(MAX_DRAFT_KEY_LENGTH)).max(64).optional(),
  // ISO-8601 timestamp (`new Date().toISOString()` is 24 chars); 64 is generous.
  lastEditedAt: z.string().max(64),
});

/**
 * v1.6 MEMBER-01 — the SAVE-BOUNDARY-ONLY refined schema. Identical to the
 * tolerant `scenarioDraftSchema` PLUS a superRefine that requires `memberKeyIds`
 * once `schema_version >= 4` (a direct v4 POST without membership is rejected
 * fail-loud at the save route). This refine is deliberately kept OFF the shared
 * `scenarioDraftSchema` because the codec reuses that schema on EVERY decode
 * branch, including the underived-v4 localStorage round-trip that MUST decode
 * "ok" (never reset). A schema_version < 4 blob still passes (the refine skips),
 * so pre-v4 save/update fixtures are unaffected. Used ONLY by the two save
 * routes (saved/route.ts POST + saved/[id]/route.ts PUT); the codec-decode path
 * keeps using the tolerant schema.
 */
export const scenarioDraftSaveSchema = scenarioDraftSchema.superRefine(
  (draft, ctx) => {
    if (draft.schema_version >= 4 && draft.memberKeyIds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["memberKeyIds"],
        message: "memberKeyIds required at schema_version >= 4",
      });
    }
  },
);

/**
 * Build the {@link StorageCodec} for a per-allocator scenario draft.
 *
 * `defaultDraft` is the value returned for an absent / corrupt / version-
 * mismatched blob (the primitive then surfaces a recovery breadcrumb on the
 * non-"ok" outcomes). The codec is intentionally agnostic to
 * `init_holdings_fingerprint` — a valid v1 blob whose fingerprint differs from
 * the current holdings is still returned `"ok"` (it is not corrupt). The
 * fingerprint-mismatch decision (show the reset-vs-keep banner, fall back to the
 * default draft) is a domain concern owned by `useScenarioState`, not a storage
 * concern owned here.
 */
export function scenarioDraftCodec(
  defaultDraft: ScenarioDraft,
): StorageCodec<ScenarioDraft> {
  return {
    decode(raw: string | null): DecodeResult<ScenarioDraft> {
      if (raw == null) return { value: defaultDraft, outcome: "ok", reason: null };
      let parsedUnknown: unknown;
      try {
        parsedUnknown = JSON.parse(raw);
      } catch {
        return { value: defaultDraft, outcome: "reset", reason: "parse_failed" };
      }
      const parsed = stripPoisonKeys(parsedUnknown);
      const rawVersion =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>).schema_version
          : undefined;

      // Forward-compat: a newer build wrote a higher schema_version. Show the
      // user's data read-only; never down-convert by re-writing this build's
      // version (the pre-B7 path returned null → default → next save silently
      // down-converted the newer blob to v1). Require an INTEGER version — a
      // float/garbage version (e.g. 1.5) is malformed, not a real future build,
      // so it falls through to the reset path rather than being trusted.
      if (Number.isInteger(rawVersion) && (rawVersion as number) > SCENARIO_SCHEMA_VERSION) {
        const safe = scenarioDraftSchema.safeParse(parsed);
        return {
          value: safe.success
            ? (safe.data as unknown as ScenarioDraft)
            : defaultDraft,
          outcome: "readonly",
          reason: "version_ahead",
        };
      }

      // Exact version — whole-shape validate (M-0153) and adopt. Because the
      // schema is TOLERANT, a v4 blob WITHOUT memberKeyIds safeParses clean and
      // decodes "ok" with membership UNDERIVED (NOT reset) — this is the
      // underived-v4 localStorage round-trip survival the blocker requires (an
      // in-memory-upgraded v2/v3 draft re-serialized by useCrossTabStorage
      // re-enters HERE). The v4 membership contract is enforced at the save
      // boundary (scenarioDraftSaveSchema), never here.
      if (rawVersion === SCENARIO_SCHEMA_VERSION) {
        const safe = scenarioDraftSchema.safeParse(parsed);
        if (safe.success) {
          return {
            value: safe.data as unknown as ScenarioDraft,
            outcome: "ok",
            reason: null,
          };
        }
        return { value: defaultDraft, outcome: "reset", reason: "schema_invalid" };
      }

      // v1.5 PERSIST-01 — NON-DESTRUCTIVE v2→v3 upgrade. This is the ONE
      // genuinely-new decode branch in Phase 59. A v2 (pre-window) draft is
      // FULLY VALID, just windowless — `window?` is optional so it safeParses
      // against the current schema. Return "ok" (NOT reset): resetting here
      // would DELETE the user's saved scenario (Phase-59 Pitfall 1 — in reopen
      // it becomes a fresh live book, in share honest-absence/404, in compare
      // the older-format stamp + NULL_METRICS). Structurally mirrors the
      // `version_ahead → readonly` branch's safeParse-then-return shape, but
      // returns "ok" + a transient provenance marker. This branch MUST land in
      // the SAME change as the 2→3 version bump — the bump without it drops
      // every stored v2 scenario. A genuinely-corrupt v2 blob still falls to
      // reset (schema_invalid). `window` is left undefined so consumers default
      // it via defaultWindowFor() on open; the marker is read (not persisted)
      // by hydrate / share-resolve to render the provenance note (Pitfall 3).
      // Ship-review RT-4 (accepted rollout transient): during a mixed-version
      // deploy, an OLD-code tab's in-flight 150ms debounced v2 write can flush
      // over a just-written v3 blob before that tab adopts readonly
      // (cross-tab flush-before-adopt), reverting a just-applied window to the
      // auto-default ONCE — bounded, self-healing (the next v3 write wins),
      // localStorage-only.
      if (rawVersion === SCENARIO_SCHEMA_VERSION_PREV) {
        const safe = scenarioDraftSchema.safeParse(parsed);
        if (safe.success) {
          return {
            value: {
              ...(safe.data as unknown as ScenarioDraft),
              // Upgrade in-memory; the next save re-serializes at v4. The
              // `...safe.data` spread carries NO memberKeyIds (the tolerant
              // schema omits the absent optional), so membership is left
              // UNDERIVED — plan 04 derives + stamps it on reopen.
              schema_version: SCENARIO_SCHEMA_VERSION,
            },
            outcome: "ok",
            reason: "upgraded_v3_membership",
          };
        }
        return { value: defaultDraft, outcome: "reset", reason: "schema_invalid" };
      }

      // v1.6 MEMBER-01 — the SECOND non-destructive branch (the double-bump
      // chain). Because v3→v4 also moved PREV 2→3, a two-versions-back v2 draft
      // (pre-window AND pre-membership) is no longer caught by the PREV branch
      // above and would otherwise fall to the final reset — SILENTLY DELETING
      // every stored v2 draft (Pitfall 1). A v2 draft is FULLY VALID against the
      // tolerant schema (both `window?` and `memberKeyIds?` are optional), so it
      // safeParses clean and upgrades to "ok" with a DISTINCT reason. Keyed on
      // the LITERAL 2 (not a named constant — this is a fixed historical version
      // the chain must always span, not a sliding "prev-prev"). A genuinely
      // corrupt v2 blob still falls to reset(schema_invalid). Window + membership
      // are left undefined (underived); consumers default the window via
      // defaultWindowFor() and plan 04 stamps membership on reopen.
      if (rawVersion === 2) {
        const safe = scenarioDraftSchema.safeParse(parsed);
        if (safe.success) {
          return {
            value: {
              ...(safe.data as unknown as ScenarioDraft),
              schema_version: SCENARIO_SCHEMA_VERSION,
            },
            outcome: "ok",
            reason: "upgraded_v2_chain",
          };
        }
        return { value: defaultDraft, outcome: "reset", reason: "schema_invalid" };
      }

      // Missing / lower (< 2) / non-integer / non-numeric version — no legacy
      // migration exists for those shapes. A non-integer like 1.5 reaches here
      // too (the readonly guard above requires Number.isInteger). Reset,
      // fail-loud (the primitive emits a console.warn + Sentry breadcrumb on
      // "reset").
      return { value: defaultDraft, outcome: "reset", reason: "version_mismatch" };
    },
    encode(value: ScenarioDraft): string {
      // Byte-compatible with the pre-B7 `JSON.stringify(draft)` — the value IS
      // the full draft (schema_version is an in-shape field, not an envelope).
      return JSON.stringify(value);
    },
  };
}

// ---------------------------------------------------------------------------
// localStorage persistence — SSR-safe + Safari-private-mode safe.
// Per-allocator scoped key (N1 defense-in-depth) eliminates cross-tenant
// collision.
//
// RETAINED FOR BACK-COMPAT. As of B7a-2 the `useScenarioState` hook reads and
// writes drafts through the `useCrossTabStorage` primitive + `scenarioDraftCodec`
// above (debounced persist, cross-tab sync, zod validation, version trichotomy,
// fail-loud recovery). These bare helpers remain for any non-React caller and
// for the SSR-safe one-shot read contract their tests pin; they are NOT the
// hook's hot path.
//
// B7 sanctioned-exception: the three helpers below use bare `localStorage`
// deliberately — it is the test-mock surface (`vi.stubGlobal("localStorage",
// mock)` only intercepts the unqualified global, see the read helper's note)
// and these are the documented back-compat path, NOT new persistent state. New
// state MUST route through useCrossTabStorage. This marker exempts the file
// from the B25 `no-raw-localstorage` rule (the hot path is already migrated).
// ---------------------------------------------------------------------------

/** SSR-safe localStorage read. Returns null on SSR, missing key, schema-version
 *  mismatch, or any parse/access error.
 *
 *  ⚠️ IN-02 — DESTRUCTIVE on pre-v4 blobs. This helper returns null whenever
 *  `parsed.schema_version !== SCENARIO_SCHEMA_VERSION`, i.e. it SILENTLY DROPS
 *  any upgraded v2/v3 (or underived-v4 round-trip) draft — the exact opposite
 *  of the codec's non-destructive upgrade trichotomy (`scenarioDraftCodec`).
 *  It is retained for back-compat and is currently used ONLY by
 *  `scenario-state.localStorage.test.ts` (no production caller). It MUST NOT be
 *  used on the reopen/hydrate path — route hydration through `scenarioDraftCodec`
 *  so an upgraded/underived draft is preserved, never nulled to a fresh default.
 *
 *  Mock-surface note: we use bare `localStorage` (not `window.localStorage`)
 *  inside the function body so test mocks installed via
 *  `vi.stubGlobal("localStorage", mock)` actually intercept the calls.
 *  The `typeof window === "undefined"` SSR sentinel above still short-circuits
 *  on the server before any access — bare `localStorage` resolves to the
 *  global in browsers and would throw a ReferenceError on Node, but the
 *  guard prevents that path. */
export function loadScenarioDraft(allocatorId: string): ScenarioDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(scenarioStorageKey(allocatorId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScenarioDraft;
    if (parsed.schema_version !== SCENARIO_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    // Corrupted JSON or storage access error — treat as absent.
    return null;
  }
}

/** SSR-safe localStorage write. Swallows quota errors (Safari private mode)
 *  and any other access errors silently — draft is simply not persisted. */
export function saveScenarioDraft(allocatorId: string, draft: ScenarioDraft): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      scenarioStorageKey(allocatorId),
      JSON.stringify(draft),
    );
  } catch {
    // Quota exceeded or storage unavailable — silent fail.
  }
}

/** SSR-safe localStorage clear. */
export function clearScenarioDraft(allocatorId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(scenarioStorageKey(allocatorId));
  } catch {
    // Storage unavailable — silent fail.
  }
}
