import { describe, it, expect } from "vitest";
import { jointMetrics } from "./joint";

describe("jointMetrics", () => {
  it("returns beta ≈ 1 and corr ≈ 1 for an identical series", () => {
    const rets = [0.01, -0.02, 0.005, 0.012, -0.003];
    const r = jointMetrics(rets, rets);
    expect(r.beta).toBeCloseTo(1, 6);
    expect(r.corr).toBeCloseTo(1, 6);
    expect(r.r2).toBeCloseTo(1, 6);
    expect(r.tracking_error).toBeCloseTo(0, 6);
  });

  it("returns beta ≈ -1 and corr ≈ -1 for an inverted series", () => {
    const a = [0.01, -0.02, 0.005, 0.012, -0.003];
    const b = a.map(x => -x);
    const r = jointMetrics(a, b);
    expect(r.beta).toBeCloseTo(-1, 6);
    expect(r.corr).toBeCloseTo(-1, 6);
  });

  it("yields up_capture > 1 when strategy outperforms bench on up days", () => {
    // Bench: alternating up/down. Strategy: same direction, 2× magnitude on ups.
    const bench = [0.01, -0.01, 0.01, -0.01, 0.01];
    const strat = [0.02, -0.01, 0.02, -0.01, 0.02];
    const r = jointMetrics(strat, bench);
    expect(r.up_capture).toBeCloseTo(2, 6);
    expect(r.down_capture).toBeCloseTo(1, 6);
  });

  it("throws on mismatched lengths", () => {
    expect(() => jointMetrics([0.01], [0.01, 0.02])).toThrow();
    expect(() => jointMetrics([], [])).toThrow();
  });

  // #597 — asset-class annualization threads periodsPerYear through the
  // annualized joint stats (alpha ∝ N, tracking_error ∝ √N, info_ratio ∝ √N,
  // treynor ∝ N). beta/corr/r2/captures are basis-free and must not move.
  describe("#597 periodsPerYear", () => {
    const strat = [0.012, -0.006, 0.008, 0.011, -0.004, 0.009];
    const bench = [0.010, -0.005, 0.006, 0.009, -0.003, 0.007];

    it("default param == explicit 252 (byte-identical)", () => {
      const def = jointMetrics(strat, bench);
      const explicit = jointMetrics(strat, bench, 0, 252);
      expect(explicit.alpha).toBe(def.alpha);
      expect(explicit.tracking_error).toBe(def.tracking_error);
      expect(explicit.info_ratio).toBe(def.info_ratio);
      expect(explicit.treynor).toBe(def.treynor);
    });

    it("365 scales alpha/treynor by 365/252 and TE/info_ratio by √(365/252); beta/corr invariant", () => {
      const trad = jointMetrics(strat, bench, 0, 252);
      const crypto = jointMetrics(strat, bench, 0, 365);
      const n = 365 / 252;
      const rootN = Math.sqrt(n);
      expect(crypto.alpha).toBeCloseTo(trad.alpha * n, 10);
      expect(crypto.treynor).toBeCloseTo(trad.treynor * n, 10);
      expect(crypto.tracking_error).toBeCloseTo(trad.tracking_error * rootN, 10);
      expect(crypto.info_ratio).toBeCloseTo(trad.info_ratio * rootN, 10);
      // Basis-free — dimensionless.
      expect(crypto.beta).toBe(trad.beta);
      expect(crypto.corr).toBe(trad.corr);
      expect(crypto.r2).toBe(trad.r2);
      expect(crypto.up_capture).toBe(trad.up_capture);
    });
  });
});
