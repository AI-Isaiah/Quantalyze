import { describe, expect, it } from "vitest";
import { computeRegimeChange } from "./regime-change";
import type { TimeSeriesPoint } from "./types";

// The regime-change implementation only reads `.value`, so the `.date`
// field is opaque — we just need stable, unique-ish strings per index.
function point(i: number, value: number): TimeSeriesPoint {
  return { date: `2026-01-${String(i + 1).padStart(2, "0")}`, value };
}

function constSeries(n: number, value: number): TimeSeriesPoint[] {
  return Array.from({ length: n }, (_, i) => point(i, value));
}

function shiftSeries(
  n: number,
  prior: number,
  recent: number,
): TimeSeriesPoint[] {
  // First half = prior value, second half = recent value.
  // Precondition: n MUST be `window * 2` (even number) for the split to
  // align cleanly with `slice(-window)` / `slice(-window * 2, -window)`.
  if (n % 2 !== 0) {
    throw new Error(`shiftSeries expects even n, got ${n}`);
  }
  const mid = n / 2;
  return Array.from({ length: n }, (_, i) =>
    point(i, i < mid ? prior : recent),
  );
}

describe("computeRegimeChange", () => {
  it("returns null when input is null", () => {
    expect(computeRegimeChange(null)).toBeNull();
  });

  it("returns null when rolling_correlation is null", () => {
    expect(computeRegimeChange({ rolling_correlation: null })).toBeNull();
  });

  it("returns null when no pair has enough points", () => {
    const result = computeRegimeChange(
      {
        rolling_correlation: {
          "a:b": constSeries(10, 0.3),
        },
      },
      { window: 30 },
    );
    expect(result).toBeNull();
  });

  it("computes a stable regime when values do not change", () => {
    const result = computeRegimeChange(
      {
        rolling_correlation: {
          "a:b": constSeries(20, 0.4),
        },
      },
      { window: 5 },
    );
    expect(result).not.toBeNull();
    expect(result?.recentAvg).toBeCloseTo(0.4);
    expect(result?.priorAvg).toBeCloseTo(0.4);
    expect(result?.delta).toBeCloseTo(0);
    expect(result?.shiftDetected).toBe(false);
    expect(result?.pairsUsed).toBe(1);
  });

  it("detects a tightening shift", () => {
    const result = computeRegimeChange(
      {
        rolling_correlation: {
          "a:b": shiftSeries(20, 0.1, 0.5),
        },
      },
      { window: 10, minDelta: 0.2 },
    );
    expect(result?.recentAvg).toBeCloseTo(0.5);
    expect(result?.priorAvg).toBeCloseTo(0.1);
    expect(result?.delta).toBeCloseTo(0.4);
    expect(result?.shiftDetected).toBe(true);
  });

  it("detects a loosening shift", () => {
    const result = computeRegimeChange(
      {
        rolling_correlation: {
          "a:b": shiftSeries(20, 0.6, 0.2),
        },
      },
      { window: 10, minDelta: 0.2 },
    );
    expect(result?.delta).toBeCloseTo(-0.4);
    expect(result?.shiftDetected).toBe(true);
  });

  it("aggregates across multiple pairs", () => {
    const result = computeRegimeChange(
      {
        rolling_correlation: {
          "a:b": shiftSeries(20, 0.1, 0.3),
          "a:c": shiftSeries(20, 0.2, 0.4),
          "b:c": shiftSeries(20, 0.0, 0.2),
        },
      },
      { window: 10, minDelta: 0.15 },
    );
    expect(result?.pairsUsed).toBe(3);
    expect(result?.recentAvg).toBeCloseTo(0.3);
    expect(result?.priorAvg).toBeCloseTo(0.1);
    expect(result?.shiftDetected).toBe(true);
  });

  it("does not flag a shift below the noise floor", () => {
    const result = computeRegimeChange(
      {
        rolling_correlation: {
          "a:b": shiftSeries(20, 0.2, 0.25),
        },
      },
      { window: 10, minDelta: 0.1 },
    );
    expect(result?.shiftDetected).toBe(false);
  });

  it("uses a default noise floor of 0.15 (plan spec)", () => {
    // 0.12 delta should NOT fire under the default threshold.
    const result = computeRegimeChange({
      rolling_correlation: {
        "a:b": shiftSeries(60, 0.2, 0.32),
      },
    });
    expect(result).not.toBeNull();
    expect(result?.shiftDetected).toBe(false);
  });

  it("does fire at the plan default threshold when delta >= 0.15", () => {
    const result = computeRegimeChange({
      rolling_correlation: {
        "a:b": shiftSeries(60, 0.1, 0.3),
      },
    });
    expect(result?.shiftDetected).toBe(true);
  });

  it("handles NaN and Infinity values in the series without poisoning the delta", () => {
    // Regression: a single NaN in a pair series used to propagate through
    // the mean and set delta to NaN, which always failed the |delta| >=
    // minDelta check silently. The avg() helper now filters non-finite.
    const goodPair = shiftSeries(20, 0.1, 0.5);
    // Corrupt one point in the recent window
    goodPair[15] = { date: "2026-01-16", value: Number.NaN };
    goodPair[17] = { date: "2026-01-18", value: Number.POSITIVE_INFINITY };
    const result = computeRegimeChange(
      {
        rolling_correlation: {
          "a:b": goodPair,
        },
      },
      { window: 10, minDelta: 0.2 },
    );
    expect(result).not.toBeNull();
    expect(Number.isFinite(result?.delta ?? Number.NaN)).toBe(true);
    // Two of the 10 recent points are non-finite and filtered; mean of the
    // remaining 8 should still be close to 0.5.
    expect(result?.recentAvg).toBeCloseTo(0.5);
    expect(result?.shiftDetected).toBe(true);
  });

  it("returns null when every value in the series is non-finite", () => {
    const pair = constSeries(20, Number.NaN);
    const result = computeRegimeChange(
      { rolling_correlation: { "a:b": pair } },
      { window: 10, minDelta: 0.1 },
    );
    expect(result).toBeNull();
  });
});
