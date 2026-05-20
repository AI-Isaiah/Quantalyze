import { describe, it, expect } from "vitest";
import { compute } from "./compute";

describe("compute — QuantStats metrics extension", () => {
  // 30-day toy series: alternating +1% and −0.5% — net positive drift.
  const rets = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.005));
  const dates = Array.from({ length: 30 }, (_, i) =>
    new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
  );
  const r = compute(rets, dates);

  it("recovery_factor = cum_ret / |max_dd| when drawdown observed", () => {
    expect(r.recovery_factor).not.toBeNull();
    expect(r.recovery_factor).toBeCloseTo(r.cum_ret / Math.abs(r.max_dd), 6);
  });

  it("pain_index >= 0 (mean of |drawdown|)", () => {
    expect(r.pain_index).toBeGreaterThanOrEqual(0);
  });

  it("ulcer_index >= pain_index when drawdowns are uneven (RMS amplifies tails)", () => {
    expect(r.ulcer_index).toBeGreaterThanOrEqual(r.pain_index - 1e-12);
  });

  it("tail_ratio is finite and non-negative when a left tail exists", () => {
    expect(r.tail_ratio).not.toBeNull();
    expect(Number.isFinite(r.tail_ratio!)).toBe(true);
    expect(r.tail_ratio!).toBeGreaterThanOrEqual(0);
  });

  it("omega_ratio matches profit_factor at threshold=0 (both are win/loss sums)", () => {
    expect(r.omega_ratio).toBeCloseTo(r.profit_factor, 8);
  });

  it("common_sense_ratio = tail_ratio × profit_factor", () => {
    expect(r.common_sense_ratio).toBeCloseTo(r.tail_ratio! * r.profit_factor, 8);
  });

  it("all-zero series → null for ratios whose denominator is 0 (no NaN sentinel)", () => {
    // No drawdown → recovery_factor undefined. No losses → omega undefined.
    // P5 = 0 → tail_ratio undefined. common_sense propagates null.
    const zeros = Array.from({ length: 30 }, () => 0);
    const zr = compute(zeros, dates);
    expect(zr.recovery_factor).toBeNull();
    expect(zr.tail_ratio).toBeNull();
    expect(zr.omega_ratio).toBeNull();
    expect(zr.common_sense_ratio).toBeNull();
    // pain/ulcer have no denominator → still defined and zero.
    expect(zr.pain_index).toBe(0);
    expect(zr.ulcer_index).toBe(0);
  });

  it("all-positive series → tail_ratio is null (no left tail to compare against)", () => {
    // Regression for the |P95/P5| sign bug — when P5 ≥ 0 the ratio is
    // gain/gain and has no risk-asymmetry meaning. Must surface null,
    // not a finite number that allocators would misread as "right-tail dominance".
    const pos = Array.from({ length: 30 }, () => 0.01);
    const pr = compute(pos, dates);
    expect(pr.tail_ratio).toBeNull();
    expect(pr.omega_ratio).toBeNull(); // no losses either
    expect(pr.common_sense_ratio).toBeNull();
    // Strictly-monotone series → no drawdown → recovery_factor null.
    expect(pr.recovery_factor).toBeNull();
  });
});
