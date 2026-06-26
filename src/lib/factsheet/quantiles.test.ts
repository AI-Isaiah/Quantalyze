import { describe, it, expect } from "vitest";
import { quantileSummary } from "./quantiles";

describe("quantileSummary", () => {
  it("empty input → all-zeros 5-number summary", () => {
    expect(quantileSummary([])).toEqual({
      p05: 0,
      p25: 0,
      p50: 0,
      p75: 0,
      p95: 0,
      min: 0,
      max: 0,
      mean: 0,
    });
  });

  it("single element (n===1) → every percentile equals that element", () => {
    expect(quantileSummary([0.05])).toEqual({
      p05: 0.05,
      p25: 0.05,
      p50: 0.05,
      p75: 0.05,
      p95: 0.05,
      min: 0.05,
      max: 0.05,
      mean: 0.05,
    });
  });

  it("multi-element series → linearly-interpolated 5-number summary", () => {
    // sorted = [0,1,2,3,4], n=5, mean=2.
    // q(p) = idx p*(n-1); p50 → idx 2 → 2; p05 → idx 0.2 → 0.2; p25 → idx 1 → 1;
    // p75 → idx 3 → 3; p95 → idx 3.8 → 3*0.2 + 4*0.8 = 3.8.
    const s = quantileSummary([0, 1, 2, 3, 4]);
    expect(s.p50).toBe(2);
    expect(s.mean).toBe(2);
    expect(s.min).toBe(0);
    expect(s.max).toBe(4);
    expect(s.p05).toBeCloseTo(0.2, 12);
    expect(s.p25).toBe(1);
    expect(s.p75).toBe(3);
    expect(s.p95).toBeCloseTo(3.8, 12);
  });

  it("is order-independent (sorts internally) and does not mutate input", () => {
    const input = [4, 0, 2, 1, 3];
    const s = quantileSummary(input);
    expect(s.p50).toBe(2);
    expect(s.mean).toBe(2);
    // input order preserved — quantileSummary copies before sorting.
    expect(input).toEqual([4, 0, 2, 1, 3]);
  });
});
