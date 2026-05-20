import { describe, it, expect } from "vitest";
import { compute, cumEq, drawdowns } from "./compute";

describe("cumEq", () => {
  it("compounds returns into a running equity curve from 1.0", () => {
    expect(cumEq([0.1, -0.05])).toEqual([1.1, 1.1 * 0.95]);
  });

  it("returns an empty array on empty input", () => {
    expect(cumEq([])).toEqual([]);
  });
});

describe("drawdowns", () => {
  it("computes drawdown from running peak", () => {
    // eq peaks at 1.1, then drops to 1.1 * 0.5 = 0.55 → dd = -0.5
    const dd = drawdowns([1.0, 1.1, 0.55, 0.66, 1.2]);
    expect(dd[0]).toBe(0);
    expect(dd[1]).toBe(0);
    expect(dd[2]).toBeCloseTo(-0.5, 10);
    expect(dd[3]).toBeCloseTo(-0.4, 10);
    expect(dd[4]).toBeCloseTo(0, 10); // new peak
  });
});

describe("compute", () => {
  it("returns sane summary for a positive-drift series", () => {
    // 252 days alternating +0.2% / 0.0% → mean drift ~0.1%/day, real vol
    const rets = Array.from({ length: 252 }, (_, i) => (i % 2 === 0 ? 0.002 : 0));
    const dates = Array.from({ length: 252 }, (_, i) => {
      const d = new Date("2024-01-01T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
    const r = compute(rets, dates);
    expect(r.n).toBe(252);
    expect(r.cum_ret).toBeGreaterThan(0.2); // ~126 winning days @ 0.2%
    expect(r.ann_vol).toBeGreaterThan(0);
    expect(r.max_dd).toBe(0); // never drew down — every other day flat
    expect(r.sharpe).toBeGreaterThan(0); // positive drift, finite vol
  });

  it("captures drawdowns in max_dd and longest_dd", () => {
    // Single sharp down day then recovery
    const rets = [0.1, -0.5, 0.1, 0.1, 0.1];
    const dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"];
    const r = compute(rets, dates);
    // eq: 1.1, 0.55, 0.605, 0.6655, 0.73205 — peak 1.1 → min eq 0.55 → max_dd -0.5
    expect(r.max_dd).toBeCloseTo(-0.5, 6);
    expect(r.longest_dd).toBeGreaterThanOrEqual(4);
  });

  it("computes positive skew for a right-tailed distribution", () => {
    // Mostly small positive, occasional large positive (right tail).
    const rets = [0.001, 0.001, 0.001, 0.001, 0.5, 0.001, 0.001];
    const dates = rets.map((_, i) => `2024-01-0${i + 1}`);
    const r = compute(rets, dates);
    expect(r.skew).toBeGreaterThan(0);
  });

  it("throws on empty input or mismatched lengths", () => {
    expect(() => compute([], [])).toThrow();
    expect(() => compute([0.01], ["2024-01-01", "2024-01-02"])).toThrow();
  });
});
