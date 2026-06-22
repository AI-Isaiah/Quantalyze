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
});
