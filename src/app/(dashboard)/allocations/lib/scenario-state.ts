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
 *     live holdings; identical idiom to useDashboardConfig.ts:82-109 + 296-320).
 */

import { holdingScopeKey } from "@/lib/keys";

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
 *  re-initializes from current live holdings — same reset-on-mismatch idiom as
 *  useDashboardConfig.ts (LAYOUT_VERSION). */
export const SCENARIO_SCHEMA_VERSION = 1;

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
    // Toggle ON: this row had weight `w` historically. Scale OTHER enabled
    // rows by `(1 - w)` so the new sum (this row + others) equals 1.0.
    if (w > 0 && w < 1) {
      const scale = 1 - w;
      for (const id of otherEnabled) {
        nextWeights[id] = (draft.weightOverrides[id] ?? 0) * scale;
      }
      // `nextWeights[scopeRef]` already === w (carried from prior state).
      nextWeights[scopeRef] = w;
    } else {
      // No useful prior weight (first time enabling, or stored value pathological)
      // — fall back to plain renormalization over the new enabled set, treating
      // this row's prior weight as 0 so it picks up an equal-share-of-zero
      // fallback when others were also zero, or its proportional share
      // otherwise.
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
 * stored weight (toggleHolding's "Toggle ON" branch only restores when
 * `w > 0 && w < 1`).
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
    lastEditedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// localStorage persistence — SSR-safe + Safari-private-mode safe.
// Pattern verbatim from useDashboardConfig.ts:82-109 + 296-320; per-allocator
// scoped key (N1 defense-in-depth) eliminates cross-tenant collision.
// ---------------------------------------------------------------------------

/** SSR-safe localStorage read. Returns null on SSR, missing key, schema-version
 *  mismatch, or any parse/access error.
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
