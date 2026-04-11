import { describe, expect, it } from "vitest";
import { pearson, rollingCorrelation } from "./correlation-math";

describe("pearson", () => {
  it("returns ~1 for perfectly positively correlated series", () => {
    expect(pearson([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("returns ~-1 for perfectly inversely correlated series", () => {
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it("returns 0 for empty arrays", () => {
    expect(pearson([], [])).toBe(0);
  });

  it("returns 0 when n < 2 (single pair)", () => {
    expect(pearson([1], [1])).toBe(0);
  });

  it("uses Math.min(a.length, b.length) for mismatched lengths", () => {
    // Only the first 2 elements of each are used: [1,2] and [1,2] => ~1
    expect(pearson([1, 2, 3], [1, 2])).toBeCloseTo(1, 10);
  });

  it("returns 0 (not NaN) when variance is zero", () => {
    expect(pearson([1, 1, 1], [2, 3, 4])).toBe(0);
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
});
