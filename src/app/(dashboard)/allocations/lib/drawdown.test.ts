import { describe, it, expect } from "vitest";
import {
  computeMaxDDFromReturnCurve,
  deriveSnapshotDrawdowns,
} from "./drawdown";

// ===========================================================================
// 09.1-REVIEW WR-05 — computeMaxDDFromReturnCurve
//
// This helper computes the fallback Max DD KPI over a cumulative-return curve.
// The previous inline implementation divided by `(1 + peak_value)` where
// peak_value is in return form (`wealth - 1`); when wealth approached 0
// the denominator approached 0 and the formula produced ±Infinity. The
// helper tracks wealth explicitly and guards against peakWealth <= 0.
// ===========================================================================

describe("computeMaxDDFromReturnCurve (WR-05 fix)", () => {
  it("returns 0 for empty curve", () => {
    expect(computeMaxDDFromReturnCurve([])).toBe(0);
  });

  it("returns 0 for single-point curve", () => {
    expect(computeMaxDDFromReturnCurve([{ value: 0.1 }])).toBe(0);
  });

  it("returns 0 for a flat curve (no drawdown)", () => {
    const curve = [{ value: 0 }, { value: 0 }, { value: 0 }];
    expect(computeMaxDDFromReturnCurve(curve)).toBe(0);
  });

  it("computes -25% for a 1.0 -> 1.2 -> 1.0 -> 0.9 wealth curve", () => {
    // wealth: 1.0 -> 1.2 -> 1.0 -> 0.9
    // peak  : 1.0    1.2    1.2    1.2
    // dd    : 0      0     -0.166 -0.25
    const curve = [
      { value: 0 }, // wealth 1.0
      { value: 0.2 }, // wealth 1.2
      { value: 0 }, // wealth 1.0
      { value: -0.1 }, // wealth 0.9
    ];
    expect(computeMaxDDFromReturnCurve(curve)).toBeCloseTo(-0.25, 6);
  });

  it("WR-05: stays finite for a leading near-total-loss curve", () => {
    // wealth = 0.001 — the OLD formula divided by 0.001, magnifying
    // numerical jitter into massive (in absolute value) DD numbers.
    const curve = [
      { value: -0.999 },
      { value: -0.9995 },
      { value: -0.999 },
    ];
    const dd = computeMaxDDFromReturnCurve(curve);
    expect(Number.isFinite(dd)).toBe(true);
    expect(dd).toBeLessThanOrEqual(0);
  });

  it("WR-05: returns finite value when wealth literally hits 0 mid-curve", () => {
    // OLD formula: at the wealth=0 point, peak_value = -1, divisor
    // (1 + -1) = 0 -> ±Infinity. NEW helper: peakWealth = 1 still
    // (curve started at value=0 -> wealth 1), so dd = (0 - 1) / 1 = -1
    // — finite.
    const curve = [
      { value: 0 }, // wealth 1
      { value: -1 }, // wealth 0
      { value: -0.5 }, // wealth 0.5
    ];
    const dd = computeMaxDDFromReturnCurve(curve);
    expect(Number.isFinite(dd)).toBe(true);
    expect(dd).toBeCloseTo(-1, 6);
  });

  it("WR-05: catastrophic curve (wealth dips below 0) does not produce NaN/Infinity", () => {
    // Mathematically possible for highly-leveraged synthetic windows.
    // peakWealth=1.5 stays positive throughout; the negative-wealth
    // points produce DD values like (-1 - 1.5)/1.5 = -1.666... which
    // ARE finite — the contract is just "no Infinity / NaN".
    const curve = [
      { value: 0.5 }, // wealth 1.5  (peak)
      { value: -0.2 }, // wealth 0.8
      { value: -2 }, // wealth -1   — peakWealth still 1.5 > 0
    ];
    const dd = computeMaxDDFromReturnCurve(curve);
    expect(Number.isFinite(dd)).toBe(true);
    expect(dd).toBeLessThanOrEqual(0);
  });

  it("WR-05: peak settles at -1 with subsequent value < -1 — old formula produces -Infinity", () => {
    // This is the smoking-gun case: leading -100% return drives peak
    // to -1 (1 + peak == 0), then a sub-(-1) return makes the OLD
    // formula compute (value - -1) / 0 = -Infinity. The fix tracks
    // peakWealth which stays at 0 (1 + -1) and is guarded out by
    // peakWealth > 0, so the fallback returns the largest finite DD.
    const curve = [
      { value: -1 }, // wealth 0   — peak settles here in old formula
      { value: -2 }, // wealth -1  — old: -1/0 = -Infinity
    ];
    const dd = computeMaxDDFromReturnCurve(curve);
    expect(Number.isFinite(dd)).toBe(true);
    expect(dd).toBeLessThanOrEqual(0);
    expect(dd).not.toBe(-Infinity);
  });

  it("WR-05: never returns ±Infinity across a sweep of pathological inputs", () => {
    // Property-style sweep: any curve whose return values stay >= -1
    // (a real-world floor for losing money) MUST produce a finite DD.
    const samples: Array<{ value: number }>[] = [
      [{ value: -0.5 }, { value: -0.99 }],
      [{ value: -0.99 }, { value: -0.5 }],
      [{ value: 0 }, { value: -0.999999 }],
      [{ value: 0.5 }, { value: -1 }, { value: -1 }],
      [{ value: -1 }, { value: -1 }, { value: 0 }], // peakWealth starts at 0
      [{ value: -1 }, { value: -1.5 }], // OLD bug: -Infinity
      [{ value: -0.5 }, { value: -1 }, { value: -2 }], // OLD bug: -Infinity at last point
    ];
    for (const sample of samples) {
      const dd = computeMaxDDFromReturnCurve(sample);
      expect(Number.isFinite(dd)).toBe(true);
      expect(dd).toBeLessThanOrEqual(0);
    }
  });
});

// ===========================================================================
// deriveSnapshotDrawdowns — sanity coverage so the existing helper is
// still tested alongside the new one.
// ===========================================================================

describe("deriveSnapshotDrawdowns (sanity)", () => {
  it("returns [] for empty input", () => {
    expect(deriveSnapshotDrawdowns([])).toEqual([]);
  });

  it("emits 0 drawdown at peaks and negative values below them", () => {
    const points = [
      { date: "2026-01-01", value: 1 },
      { date: "2026-01-02", value: 1.2 },
      { date: "2026-01-03", value: 1 },
    ];
    const out = deriveSnapshotDrawdowns(points);
    expect(out[0].value).toBeCloseTo(0, 6);
    expect(out[1].value).toBeCloseTo(0, 6);
    expect(out[2].value).toBeCloseTo(-1 / 6, 6);
  });
});
