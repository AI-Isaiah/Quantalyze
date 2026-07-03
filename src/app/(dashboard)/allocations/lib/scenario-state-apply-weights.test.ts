import { describe, it, expect } from "vitest";
import { applyWeightOverrides, setWeightOverride, type ScenarioDraft } from "./scenario-state";

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
