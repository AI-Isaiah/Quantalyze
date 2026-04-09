import { describe, expect, it } from "vitest";
import { computeRegimeChange } from "./regime-change";
import type { TimeSeriesPoint } from "./types";

function constSeries(n: number, value: number): TimeSeriesPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    value,
  }));
}

function shiftSeries(
  n: number,
  prior: number,
  recent: number,
): TimeSeriesPoint[] {
  // First half = prior value, second half = recent value.
  const mid = Math.floor(n / 2);
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    value: i < mid ? prior : recent,
  }));
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
});
