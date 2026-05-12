import { describe, expect, it } from "vitest";
import { pearson, rollingCorrelation } from "./correlation-math";

describe("pearson", () => {
  it("returns ~1 for perfectly positively correlated series", () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("returns ~-1 for perfectly inversely correlated series", () => {
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it("returns null for empty arrays (correlation undefined)", () => {
    expect(pearson([], [])).toBeNull();
  });

  it("returns null when n < 2 (single pair, correlation undefined)", () => {
    expect(pearson([1], [1])).toBeNull();
  });

  it("uses Math.min(a.length, b.length) for mismatched lengths", () => {
    // Only the first 2 elements of each are used: [1,2] and [1,2] => ~1
    expect(pearson([1, 2, 3], [1, 2])).toBeCloseTo(1, 10);
  });

  /**
   * Audit 2026-05-07 G11.E.5 regression: zero-variance series MUST return
   * null (correlation mathematically undefined), NOT 0. The pre-audit
   * behaviour conflated "no correlation" with "correlation cannot be
   * measured" — for a flat-for-90-days strategy, allocators saw a clean
   * 0.000 line indistinguishable from a genuinely uncorrelated window.
   * Test asserts the null return so the chart layer can render a gap
   * with the "flat window — correlation undefined" tooltip.
   */
  it("returns null (NOT 0) when variance is zero — correlation undefined (G11.E.5)", () => {
    expect(pearson([1, 1, 1], [2, 3, 4])).toBeNull();
    // And the symmetric case: zero variance on the second array.
    expect(pearson([2, 3, 4], [1, 1, 1])).toBeNull();
    // And both flat → still undefined.
    expect(pearson([1, 1, 1], [5, 5, 5])).toBeNull();
  });
});

describe("rollingCorrelation", () => {
  it("returns one point per window position, all ~1 for monotonic series", () => {
    const out = rollingCorrelation([1, 2, 3, 4, 5], [1, 2, 3, 4, 5], 3);
    expect(out).toHaveLength(3);
    for (const pt of out) {
      expect(pt.value).toBeCloseTo(1, 10);
    }
  });

  it("returns [] when the window exceeds the series length", () => {
    expect(rollingCorrelation([1, 2, 3], [1, 2, 3], 5)).toEqual([]);
  });

  it("returns [] when window < 2 (nonsensical)", () => {
    expect(rollingCorrelation([1, 2, 3], [1, 2, 3], 1)).toEqual([]);
  });

  it("emits the absolute index of the window's right edge", () => {
    const out = rollingCorrelation([1, 2, 3, 4, 5], [1, 2, 3, 4, 5], 3);
    expect(out.map((p) => p.index)).toEqual([2, 3, 4]);
  });

  /**
   * Audit 2026-05-07 G11.E.5: rolling correlation must propagate the
   * undefined-variance signal as `null` per window so consumers can
   * render a gap instead of plotting a misleading 0.
   */
  it("emits null for windows where one series is flat (G11.E.5)", () => {
    // Window @ index 2 (slice [0..2]): a=[1,1,1] flat → undefined → null.
    // Window @ index 3 (slice [1..3]): a=[1,1,2] non-flat, b=[2,3,4]
    // monotone-increasing — both have variance, correlation is defined.
    const out = rollingCorrelation([1, 1, 1, 2, 5], [1, 2, 3, 4, 5], 3);
    expect(out).toHaveLength(3);
    expect(out[0].value).toBeNull();
    // The remaining windows should be real numbers (not null) — the
    // exact value isn't load-bearing for this test, just that pearson()
    // returned something defined.
    expect(typeof out[1].value === "number").toBe(true);
    expect(typeof out[2].value === "number").toBe(true);
  });
});
