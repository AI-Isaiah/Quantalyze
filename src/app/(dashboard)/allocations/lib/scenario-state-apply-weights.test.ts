import { describe, it, expect } from "vitest";
import {
  applyWeightOverrides,
  setWeightOverride,
  togglePerKeySource,
  type ScenarioDraft,
} from "./scenario-state";

/**
 * Phase 28 OPT-01 (C1 red-team finding) — applying a FULL optimizer weight
 * vector must reproduce it, NOT the corrupted result of looping the single-ref
 * `setWeightOverride` (which renormalizes the others on each call). This is the
 * regression that fails with the old loop-of-setWeightOverride apply path.
 */

function draft(overrides: Record<string, number>): ScenarioDraft {
  const toggleByScopeRef: Record<string, boolean> = {};
  for (const id of Object.keys(overrides)) toggleByScopeRef[id] = true;
  return {
    schema_version: 2,
    init_holdings_fingerprint: "fp",
    toggleByScopeRef,
    addedStrategies: [],
    weightOverrides: overrides,
    memberKeyIds: [],
    lastEditedAt: "2024-01-01T00:00:00.000Z",
  };
}

describe("applyWeightOverrides — atomic full-vector apply (C1)", () => {
  it("reproduces the supplied sum-to-1 vector exactly (within float error)", () => {
    const next = applyWeightOverrides(draft({ a: 0.34, b: 0.33, c: 0.33 }), {
      a: 0.7,
      b: 0.2,
      c: 0.1,
    });
    expect(next.weightOverrides.a).toBeCloseTo(0.7, 9);
    expect(next.weightOverrides.b).toBeCloseTo(0.2, 9);
    expect(next.weightOverrides.c).toBeCloseTo(0.1, 9);
  });

  it("is DEMONSTRABLY different from looping setWeightOverride (the bug it fixes)", () => {
    // The old apply path: loop setWeightOverride per id. Each call renormalizes
    // the OTHERS, so the earlier-set ids drift — only the last lands exactly.
    let looped = draft({ a: 0.34, b: 0.33, c: 0.33 });
    for (const [id, w] of Object.entries({ a: 0.7, b: 0.2, c: 0.1 })) {
      looped = setWeightOverride(looped, id, w);
    }
    // The loop corrupts the head of the vector (a is NOT 0.7).
    expect(Math.abs(looped.weightOverrides.a - 0.7)).toBeGreaterThan(0.001);
    // The atomic apply does not.
    const atomic = applyWeightOverrides(draft({ a: 0.34, b: 0.33, c: 0.33 }), {
      a: 0.7,
      b: 0.2,
      c: 0.1,
    });
    expect(Math.abs(atomic.weightOverrides.a - 0.7)).toBeLessThan(1e-9);
  });

  it("records every applied ref as a user-explicit override (un-blocks Commit)", () => {
    const next = applyWeightOverrides(draft({ a: 0.5, b: 0.5 }), { a: 0.8, b: 0.2 });
    expect(next.userWeightOverrides?.a).toBeCloseTo(0.8, 9);
    expect(next.userWeightOverrides?.b).toBeCloseTo(0.2, 9);
  });

  it("non-finite / negative / empty input is a no-op (defensive)", () => {
    const base = draft({ a: 0.5, b: 0.5 });
    expect(applyWeightOverrides(base, {})).toBe(base);
    expect(applyWeightOverrides(base, { a: NaN, b: 0.5 })).toBe(base);
    expect(applyWeightOverrides(base, { a: -0.1, b: 1.1 })).toBe(base);
  });

  // WR-01 (Phase 63 review) — #528 apply-back dilution on the mixed per-key +
  // added path. In book+gate mode the ENGINE universe is the per-key units
  // (api_key UUIDs) + added ids, but the DRAFT's toggle basis (enabledIdsOf) is
  // `holding:` refs + added ids — api_key ids never enter the toggle map
  // (defaultDraftFromHoldings seeds toggles for holdings only). Renormalizing an
  // optimizer suggestion over the toggle basis leaves the stale holding-override
  // mass in the denominator and silently dilutes the added sleeve. The fix
  // renormalizes over the ENGINE unit ids passed as `basisIds`.
  //
  // WHY it matters: the composer's projectionState reads
  // `draft.weightOverrides[engineId]` per engine strategy; the committed
  // `size_at_decision_usd` uses that weight. A diluted added weight ships a
  // mandate decision that differs from what the allocator applied.
  it("WR-01 renormalizes an optimizer vector over the ENGINE basis, not the draft toggle basis (mixed per-key + added)", () => {
    // 3 holdings (default overrides .5/.3/.2) + 1 added "A", all toggled on.
    // The engine universe is {k1, k2, A}; the holding refs are inert at compute
    // in book+gate mode (the engine set is per-key units + added).
    const mixed: ScenarioDraft = {
      schema_version: 2,
      init_holdings_fingerprint: "fp",
      toggleByScopeRef: {
        "holding:binance:BTC:spot": true,
        "holding:binance:ETH:spot": true,
        "holding:binance:SOL:spot": true,
        A: true,
      },
      weightOverrides: {
        "holding:binance:BTC:spot": 0.5,
        "holding:binance:ETH:spot": 0.3,
        "holding:binance:SOL:spot": 0.2,
      },
      addedStrategies: [],
      memberKeyIds: ["k1", "k2"],
      lastEditedAt: "2024-01-01T00:00:00.000Z",
    };
    const suggestion = { k1: 0.4, k2: 0.4, A: 0.2 };
    const basisIds = ["k1", "k2", "A"];

    const next = applyWeightOverrides(mixed, suggestion, basisIds);

    // The suggestion sums to 1 over the engine basis → reproduced EXACTLY.
    // Against the pre-fix code (renormalizing over {h1,h2,h3,A}, sum 1.2) the
    // added sleeve A lands at .1667 and this assertion is RED.
    expect(next.weightOverrides.A).toBeCloseTo(0.2, 9);
    expect(next.weightOverrides.k1).toBeCloseTo(0.4, 9);
    expect(next.weightOverrides.k2).toBeCloseTo(0.4, 9);
  });

  it("WR-01 without basisIds preserves the legacy enabled-set renormalization (back-compat)", () => {
    // No basisIds → renormalize over enabledIdsOf(draft) exactly as before.
    const next = applyWeightOverrides(draft({ a: 0.34, b: 0.33, c: 0.33 }), {
      a: 0.7,
      b: 0.2,
      c: 0.1,
    });
    expect(next.weightOverrides.a).toBeCloseTo(0.7, 9);
    expect(next.weightOverrides.b).toBeCloseTo(0.2, 9);
    expect(next.weightOverrides.c).toBeCloseTo(0.1, 9);
  });
});

// ===========================================================================
// Phase 112 · Plan 00 (Wave 0 RED scaffold) — WEIGHTS-01/02 state-layer pins.
//
// The engine-unit weight basis for a MIXED constituent set: two PER-KEY refs
// (K1/K2 — api_key_id-style ids that ride the included-by-default per-key state,
// so they are ABSENT from `toggleByScopeRef` and out of `enabledIdsOf`, per
// CONSTIT-03 `togglePerKeySource`) plus one ADDED strategy A (toggled on, with a
// `weightOverrides` entry). Phase 112 makes the per-key rows weightable, so the
// sum-to-1 basis becomes the SELECTED ENGINE UNIT SET {K1,K2,A} rather than the
// added-only `enabledIdsOf` basis.
//
// One RED (a) + three GREEN pins (b,c,d). The GREEN pins characterize the
// existing state-machine behavior the Plan-01 composer writer must respect; the
// RED pins the diffCount-honesty extension Plan 01 adds.
// ===========================================================================
describe("Phase 112 — engine-unit weight basis over a mixed per-key + added set", () => {
  const K1 = "apikey-11111111-1111-1111-1111-111111111111"; // per-key unit id
  const K2 = "apikey-22222222-2222-2222-2222-222222222222"; // per-key unit id
  const A = "added-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"; // added strategy id

  /** A mixed draft: K1/K2 are per-key units (ABSENT from toggleByScopeRef — the
   *  included-by-default per-key state), A is an added strategy toggled on. The
   *  caller supplies the `weightOverrides` seed each test needs. */
  function mixedDraft(weightOverrides: Record<string, number>): ScenarioDraft {
    return {
      schema_version: 2,
      init_holdings_fingerprint: "fp",
      // Only A carries an explicit toggle — per-key refs are absent (=== included
      // by default), exactly as togglePerKeySource leaves a re-included per-key
      // unit. So enabledIdsOf(draft) === [A].
      toggleByScopeRef: { [A]: true },
      addedStrategies: [
        {
          id: A,
          name: "Added A",
          markets: [],
          strategy_types: [],
        },
      ] as unknown as ScenarioDraft["addedStrategies"],
      weightOverrides,
      memberKeyIds: [],
      lastEditedAt: "2024-01-01T00:00:00.000Z",
    };
  }

  // (a) RED — userExplicitRefs. Plan 01 extends applyWeightOverrides with a
  // FOURTH argument naming the single ref the USER actually edited, so a
  // one-row edit stamps ONLY that ref into userWeightOverrides (diffCount
  // honesty). Today every provided ref is stamped (scenario-state.ts:677-680),
  // so K2 and A leak into userWeightOverrides and this assertion is RED. The
  // 4th positional arg does not exist on the current signature — @ts-expect-error
  // marks that gap; Plan 01 removes the directive when it adds the parameter.
  it("(a) RED — a single-row weight edit stamps ONLY the user-edited ref into userWeightOverrides (not the whole basis)", () => {
    const next = applyWeightOverrides(
      mixedDraft({ [A]: 0.5 }),
      { [K1]: 0.3, [K2]: 0.311111, [A]: 0.388889 },
      [K1, K2, A],
      // Phase 112 WEIGHTS-01 — the userExplicitRefs (4th) parameter now exists;
      // a single-row edit stamps ONLY the user-edited ref (K1).
      [K1],
    );
    // The user only edited K1 → only K1 is a user-explicit override.
    expect(next.userWeightOverrides).toHaveProperty(K1);
    expect(next.userWeightOverrides).not.toHaveProperty(K2);
    expect(next.userWeightOverrides).not.toHaveProperty(A);
  });

  // (b) GREEN — engine-unit basis sum-to-1. A sum-1 vector renormalized over the
  // exact engine basis {K1,K2,A} is identity-scale, so every ref lands verbatim
  // and the three sum to 1 within the scenario-state.ts:10 1e-9 invariant.
  it("(b) GREEN — a sum-1 vector over the {K1,K2,A} basis reproduces exactly and sums to 1 within 1e-9", () => {
    const next = applyWeightOverrides(
      mixedDraft({ [A]: 0.5 }),
      { [K1]: 0.3, [K2]: 0.311111, [A]: 0.388889 },
      [K1, K2, A],
    );
    expect(next.weightOverrides[K1]).toBeCloseTo(0.3, 9);
    expect(next.weightOverrides[K2]).toBeCloseTo(0.311111, 9);
    expect(next.weightOverrides[A]).toBeCloseTo(0.388889, 9);
    const sum =
      next.weightOverrides[K1] +
      next.weightOverrides[K2] +
      next.weightOverrides[A];
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  // (c) GREEN (wrong-tool characterization, 112-VALIDATION Wave-0 item 2) —
  // plain setWeightOverride renormalizes over enabledIdsOf === [A] only, so a
  // per-key edit leaves K2 untouched and the sum over the mixed engine set
  // {K1,K2,A} does NOT equal 1. This documents WHY the composer writer must
  // route per-key edits through the engine-unit basis (Pitfall 2, the #528
  // drift class), never through plain setWeightOverride.
  it("(c) GREEN — setWeightOverride on a per-key ref is the WRONG tool: it skips K2 and the mixed-set sum ≠ 1", () => {
    const next = setWeightOverride(mixedDraft({ [K2]: 0.4, [A]: 0.5 }), K1, 0.3);
    // K2 is a per-key unit outside enabledIdsOf → never rescaled.
    expect(next.weightOverrides[K2]).toBeCloseTo(0.4, 9);
    // K1 took the typed value; the only enabled other (A) absorbed the rest.
    expect(next.weightOverrides[K1]).toBeCloseTo(0.3, 9);
    expect(next.weightOverrides[A]).toBeCloseTo(0.7, 9);
    // The sum over the mixed engine set is NOT 1 — the invariant is broken,
    // exactly the failure the engine-unit basis writer must prevent.
    const mixedSum =
      next.weightOverrides[K1] +
      next.weightOverrides[K2] +
      next.weightOverrides[A];
    expect(mixedSum).toBeCloseTo(1.4, 9);
    expect(Math.abs(mixedSum - 1)).toBeGreaterThan(0.001);
  });

  // (d) GREEN — weight preservation across a per-key exclude/re-include cycle.
  // togglePerKeySource NEVER touches weightOverrides (it only writes/deletes the
  // toggleByScopeRef entry), so a typed per-key weight survives both the exclude
  // and the re-include — the preserve-and-restore contract Open Question 2
  // relies on.
  it("(d) GREEN — togglePerKeySource preserves a typed per-key weight across exclude → re-include", () => {
    const seeded = mixedDraft({ [K1]: 0.3, [A]: 0.5 });

    const excluded = togglePerKeySource(seeded, K1);
    // Exclude wrote toggleByScopeRef[K1] = false but left the weight intact.
    expect(excluded.toggleByScopeRef[K1]).toBe(false);
    expect(excluded.weightOverrides[K1]).toBeCloseTo(0.3, 9);

    const reincluded = togglePerKeySource(excluded, K1);
    // Re-include DELETED the ref (back to included-by-default) but STILL left
    // the weight intact.
    expect(reincluded.toggleByScopeRef).not.toHaveProperty(K1);
    expect(reincluded.weightOverrides[K1]).toBeCloseTo(0.3, 9);
  });
});
