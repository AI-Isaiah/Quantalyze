import { describe, it, expect } from "vitest";
import { computeStyleDrift, ksStatPValue, ksTailProbability } from "./style-drift";

/**
 * Phase 164.6.6.3.3 (D-05): the two-sample KS p-value is 1 when the two halves are
 * the same distribution.
 *
 * Why this matters: the old tail was a 100-term alternating sum, which cancels to 0
 * as lambda approaches 0. A flat strategy (D = 0) therefore got p = 0, and the
 * style-drift panel printed "distributions differ at α=0.05" about two halves that
 * are identical: a statistical claim the data contradicts. The oracle below is the
 * Kolmogorov distribution's published tail (Q_KS(1.0) = 0.27, Q_KS(1.36) = 0.0495),
 * independent of the series being fixed.
 */
describe("ksTailProbability: Q_KS(lambda) against the published Kolmogorov table", () => {
  it("lambda 1.0 gives 0.27", () => {
    expect(Math.abs(ksTailProbability(1.0) - 0.27)).toBeLessThan(1e-3);
  });

  it("lambda 1.36 gives the 5% critical value, 0.0495", () => {
    expect(Math.abs(ksTailProbability(1.36) - 0.0495)).toBeLessThan(1e-3);
  });

  it("lambda 0.001 and 0.01 give 1 (the alternating sum gave 0.020 and 0.867)", () => {
    expect(ksTailProbability(0.001)).toBe(1);
    expect(ksTailProbability(0.01)).toBe(1);
  });

  it("lambda 0 (or negative or NaN) gives 1", () => {
    expect(ksTailProbability(0)).toBe(1);
    expect(ksTailProbability(-1)).toBe(1);
    expect(ksTailProbability(Number.NaN)).toBe(1);
  });

  it("is non-increasing in lambda (to the series' 1e-6 truncation) and stays inside [0, 1]", () => {
    let prev = 1;
    for (let lam = 0; lam <= 4; lam += 0.01) {
      const p = ksTailProbability(lam);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      // The stop rule truncates the series, so adjacent lambdas can wobble by ~1e-9
      // where p is 1 to nine places. That is not a probability that rises with lambda.
      expect(p).toBeLessThanOrEqual(prev + 1e-6);
      prev = p;
    }
  });
});

describe("ksStatPValue", () => {
  it("identical samples give { d: 0, p: 1 }", () => {
    const a = [0.01, -0.02, 0.03, 0.0, 0.015, -0.005];
    expect(ksStatPValue(a, [...a])).toEqual({ d: 0, p: 1 });
  });

  it("two all-zero samples (a flat strategy) give p = 1, not 'distributions differ'", () => {
    expect(ksStatPValue([0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0])).toEqual({ d: 0, p: 1 });
  });

  it("p is non-increasing as the second sample shifts away (D grows)", () => {
    const a = Array.from({ length: 60 }, (_, i) => i / 60);
    let prevD = -1;
    let prevP = 2;
    for (let shift = 0; shift <= 1.2; shift += 0.1) {
      const { d, p } = ksStatPValue(a, a.map(x => x + shift));
      expect(d).toBeGreaterThanOrEqual(prevD);
      expect(p).toBeLessThanOrEqual(prevP + 1e-12);
      prevD = d;
      prevP = p;
    }
    // Fully separated samples end at D = 1 and a vanishing p.
    expect(prevD).toBe(1);
    expect(prevP).toBeLessThan(1e-6);
  });

  it("real separation keeps its small p-value", () => {
    const a = Array.from({ length: 100 }, (_, i) => i / 100);
    const { d, p } = ksStatPValue(a, a.map(x => x + 0.5));
    expect(d).toBeGreaterThan(0.4);
    expect(p).toBeLessThan(0.001);
  });

  it("empty input still returns { d: 0, p: 1 }", () => {
    expect(ksStatPValue([], [1, 2, 3])).toEqual({ d: 0, p: 1 });
    expect(ksStatPValue([1, 2, 3], [])).toEqual({ d: 0, p: 1 });
  });
});

describe("computeStyleDrift on a flat series", () => {
  it("halves of all zeros give KS D = 0 and p = 1", () => {
    const n = 8;
    const dates = Array.from({ length: n }, (_, i) => `2024-01-${String(i + 1).padStart(2, "0")}`);
    const out = computeStyleDrift(new Array<number>(n).fill(0), dates);
    expect(out).not.toBeNull();
    expect(out?.ksD).toBe(0);
    expect(out?.ksP).toBe(1);
  });
});
