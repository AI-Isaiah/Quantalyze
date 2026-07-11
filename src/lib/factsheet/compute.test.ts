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

// ---------------------------------------------------------------------------
// FS-02 (Phase 90) — sparse invariance: gap exclusion from compounding is true
// BY CONSTRUCTION. `compute()`/`cumEq()` only ever see the observations they are
// handed; they never zero-fill an interior gap. So a sparse series (gap days
// simply absent) is NOT the same as a dense series with explicit 0.0 gap rows —
// the observation count that drives every statistic equals the INPUT length.
// This pins that compute is a pure function of its inputs (no internal reindex).
// ---------------------------------------------------------------------------
describe("FS-02 sparse invariance (gap exclusion by construction)", () => {
  // 8-point sparse series with a real 2-day gap between 2025-08-04 and
  // 2025-08-07 (the 5th and 6th are ABSENT — never zero-filled).
  const SPARSE_RETS = [0.01, 0.02, -0.03, 0.04, -0.05, 0.06, -0.01, 0.02];
  const SPARSE_DATES = [
    "2025-08-01", "2025-08-02", "2025-08-03", "2025-08-04",
    "2025-08-07", "2025-08-08", "2025-08-09", "2025-08-10",
  ];
  // Dense twin — identical values with explicit 0.0 rows on the two gap dates.
  const DENSE_RETS = [0.01, 0.02, -0.03, 0.04, 0.0, 0.0, -0.05, 0.06, -0.01, 0.02];
  const DENSE_DATES = [
    "2025-08-01", "2025-08-02", "2025-08-03", "2025-08-04", "2025-08-05",
    "2025-08-06", "2025-08-07", "2025-08-08", "2025-08-09", "2025-08-10",
  ];

  it("the equity array length equals the INPUT length — compute never reindexes", () => {
    expect(cumEq(SPARSE_RETS).length).toBe(SPARSE_RETS.length);
    const r = compute(SPARSE_RETS, SPARSE_DATES);
    expect(r.n).toBe(SPARSE_RETS.length);
    expect(r.eq.length).toBe(SPARSE_RETS.length);
  });

  it("sparse vol (no gap days) differs from dense-with-0.0 vol — no internal zero-fill", () => {
    // If compute() secretly zero-filled the interior gap, the sparse vol would
    // equal the dense-with-0.0 vol. It does NOT: the two 0.0 rows change the
    // observation count and the mean, so the annualized vols must differ. This
    // is the by-construction proof that gap days never enter compounding.
    const sparseVol = compute(SPARSE_RETS, SPARSE_DATES).ann_vol;
    const denseVol = compute(DENSE_RETS, DENSE_DATES).ann_vol;
    expect(sparseVol).not.toBe(denseVol);
    expect(sparseVol).toBeGreaterThan(0);
    expect(denseVol).toBeGreaterThan(0);
  });
});
