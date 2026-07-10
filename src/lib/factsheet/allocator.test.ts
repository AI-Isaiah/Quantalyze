import { describe, it, expect } from "vitest";
import { blend, buildAllocatorMetrics } from "./allocator";

/**
 * #597 part 2 (BLEND-02) — buildAllocatorMetrics is the reference-panel math
 * behind build-payload.ts's `allocatorPortfolios`. The locked leg-decided
 * ruling: the 60/40 pure-tradfi panel stays √252 (byte-identical), the
 * BTC-legged all-weather + BTC/ETH panels ride √365. These tests pin:
 *   (1) default-identity: the trailing `periodsPerYear` param defaults to 252
 *       so the 60/40 call (which passes NO arg) is unchanged.
 *   (2) the √365 scaling of the frequency-annualized vols (ann_vol / blend_vol).
 *   (3) invariance of the basis-free metrics (cum_ret / max_dd / corr / tails).
 */
describe("blend", () => {
  it("weights multiple equal-length series pointwise", () => {
    expect(blend([0.5, 0.5], [[0.1, -0.2], [0.3, 0.4]])).toEqual([0.2, 0.1]);
  });
  it("throws on a weight/series length mismatch", () => {
    expect(() => blend([1], [[0.1], [0.2]])).toThrow();
  });
});

describe("buildAllocatorMetrics — asset-class annualization basis (BLEND-02)", () => {
  // A LOW-volatility fixture: daily std is small enough that the annualized
  // blend vols stay well BELOW the VOL_TARGET (0.18) at BOTH the 252 and 365
  // bases. That matters for the sleeve grid-scan: since every candidate blend
  // vol v(w) is below target at both bases and v(w) scales by the SAME √N factor
  // across all w, the grid's argmin |v(w) − target| (== argmax v here) is
  // scale-STABLE for THIS fixture — so sleeve_pct is identical and blend_vol
  // scales cleanly. This is a property of the engineered fixture, NOT a general
  // invariance claim (a near-target fixture could legitimately shift sleeve_pct).
  const N = 40;
  const rets = Array.from({ length: N }, (_, i) => 0.002 * Math.sin(i / 3) + 0.0005);
  const mm = Array.from({ length: N }, (_, i) => 0.0015 * Math.cos(i / 4) - 0.0003);

  const RATIO = Math.sqrt(365 / 252);

  it("defaults to the 252 basis (byte-identical to an explicit 252 call)", () => {
    const implicit = buildAllocatorMetrics(rets, mm);
    const explicit252 = buildAllocatorMetrics(rets, mm, 252);
    expect(implicit).toEqual(explicit252);
  });

  it("ann_vol and blend_vol scale ×√(365/252) at the crypto basis", () => {
    const at252 = buildAllocatorMetrics(rets, mm, 252);
    const at365 = buildAllocatorMetrics(rets, mm, 365);

    // Falsifiable: the two bases genuinely differ (a still-hardcoded √252 impl
    // would leave ann_vol identical and fail here).
    expect(at365.ann_vol).not.toBe(at252.ann_vol);

    expect(at365.ann_vol / at252.ann_vol).toBeCloseTo(RATIO, 12);
    // Sleeve grid-scan is scale-stable for this sub-target fixture (see header),
    // so the chosen blend_vol scales by the same √N factor.
    expect(at365.sleeve_pct).toBe(at252.sleeve_pct);
    expect(at365.blend_vol / at252.blend_vol).toBeCloseTo(RATIO, 12);
    // Both annualized vols stay under the 0.18 target at both bases (the premise
    // of the scale-stable argmax above).
    expect(at365.ann_vol).toBeLessThan(0.18);
  });

  it("cum_ret / max_dd / corr / tail_* are basis-free (identical across 252 and 365)", () => {
    const at252 = buildAllocatorMetrics(rets, mm, 252);
    const at365 = buildAllocatorMetrics(rets, mm, 365);
    expect(at365.cum_ret).toBe(at252.cum_ret);
    expect(at365.max_dd).toBe(at252.max_dd);
    expect(at365.corr).toBe(at252.corr);
    expect(at365.tail_count).toBe(at252.tail_count);
    expect(at365.tail_mm_mean).toBe(at252.tail_mm_mean);
    expect(at365.tail_mm_median).toBe(at252.tail_mm_median);
    expect(at365.tail_mm_pos).toBe(at252.tail_mm_pos);
  });
});
