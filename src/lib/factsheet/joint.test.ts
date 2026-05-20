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
});
