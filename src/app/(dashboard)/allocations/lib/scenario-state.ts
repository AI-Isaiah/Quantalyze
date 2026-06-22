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
 *  guard against legacy toggle state. */
export const SCENARIO_SCHEMA_VERSION = 2;

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
  // ISO-8601 timestamp (`new Date().toISOString()` is 24 chars); 64 is generous.
  lastEditedAt: z.string().max(64),
});

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

      // Exact version — whole-shape validate (M-0153) and adopt.
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

      // Missing / lower / non-integer / non-numeric version — no legacy
      // migration exists (CURRENT === 1, no prior persisted shape). A
      // non-integer like 1.5 reaches here too (the readonly guard above requires
      // Number.isInteger). Reset, mirroring the pre-B7 strict
      // `schema_version !== 1 → null` behavior, but fail-loud (the primitive
      // emits a console.warn + Sentry breadcrumb on "reset").
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
