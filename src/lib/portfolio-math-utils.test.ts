import { describe, it, expect } from "vitest";
import {
  normalizeDailyReturns,
  mean,
  stdDev,
  compound,
  type DailyPoint,
} from "./portfolio-math-utils";

/**
 * Unit tests for the shared portfolio math primitives.
 *
 * P424 (audit-2026-05-07) — `normalizeDailyReturns` previously filtered
 * by `typeof value === "number"`, which accepts NaN and ±Infinity. Both
 * serialize to JSONB in unpredictable shapes and corrupt downstream
 * consumers (Python analytics reads `null`-coerced NaN as zero;
 * lightweight-charts crashes on Infinity domains). The fix replaces the
 * type check with `Number.isFinite(...)`. These tests pin that contract
 * at every entry point: array shape, flat-dict shape, and nested
 * year-keyed dict shape.
 */

describe("normalizeDailyReturns — P424 NaN/Infinity guard", () => {
  it("returns [] for null/undefined/falsy raw input", () => {
    expect(normalizeDailyReturns(null)).toEqual([]);
    expect(normalizeDailyReturns(undefined)).toEqual([]);
    expect(normalizeDailyReturns(0)).toEqual([]);
    expect(normalizeDailyReturns("")).toEqual([]);
  });

  it("array shape — accepts finite numbers and sorts by date", () => {
    const raw: DailyPoint[] = [
      { date: "2026-01-02", value: 0.5 },
      { date: "2026-01-01", value: 0.25 },
    ];
    expect(normalizeDailyReturns(raw)).toEqual([
      { date: "2026-01-01", value: 0.25 },
      { date: "2026-01-02", value: 0.5 },
    ]);
  });

  it("P424 — array shape: filters out NaN, +Infinity, -Infinity", () => {
    // The pre-fix `typeof value === "number"` accepted ALL of these:
    // NaN, Infinity, -Infinity. Each one corrupts a downstream JSONB
    // round-trip: NaN → null (depending on serializer), Infinity → string
    // "Infinity" or a parser exception. With Number.isFinite() they are
    // dropped at the boundary so the consumer never sees a corrupt frame.
    const raw = [
      { date: "2026-01-01", value: Number.NaN },
      { date: "2026-01-02", value: Number.POSITIVE_INFINITY },
      { date: "2026-01-03", value: Number.NEGATIVE_INFINITY },
      { date: "2026-01-04", value: 0.1 },
    ];
    const result = normalizeDailyReturns(raw);
    expect(result).toEqual([{ date: "2026-01-04", value: 0.1 }]);
  });

  it("array shape — still rejects non-number values (string, null, undefined)", () => {
    const raw = [
      { date: "2026-01-01", value: "0.1" },
      { date: "2026-01-02", value: null },
      { date: "2026-01-03", value: undefined },
      { date: "2026-01-04", value: 0.2 },
    ];
    const result = normalizeDailyReturns(raw);
    expect(result).toEqual([{ date: "2026-01-04", value: 0.2 }]);
  });

  it("flat-dict shape — accepts finite numbers", () => {
    const raw = { "2026-01-01": 0.1, "2026-01-02": 0.2 };
    expect(normalizeDailyReturns(raw)).toEqual([
      { date: "2026-01-01", value: 0.1 },
      { date: "2026-01-02", value: 0.2 },
    ]);
  });

  it("P424 — flat-dict shape: filters out NaN/Infinity", () => {
    const raw = {
      "2026-01-01": Number.NaN,
      "2026-01-02": Number.POSITIVE_INFINITY,
      "2026-01-03": Number.NEGATIVE_INFINITY,
      "2026-01-04": 0.1,
    };
    expect(normalizeDailyReturns(raw)).toEqual([
      { date: "2026-01-04", value: 0.1 },
    ]);
  });

  it("nested year-keyed dict — accepts finite numbers and pads MM-DD", () => {
    const raw = {
      "2026": {
        "1-3": 0.5,
        "01-02": 0.25,
      },
    };
    expect(normalizeDailyReturns(raw)).toEqual([
      { date: "2026-01-02", value: 0.25 },
      { date: "2026-01-03", value: 0.5 },
    ]);
  });

  it("P424 — nested year-keyed dict: filters out NaN/Infinity", () => {
    const raw = {
      "2026": {
        "01-01": Number.NaN,
        "01-02": Number.POSITIVE_INFINITY,
        "01-03": Number.NEGATIVE_INFINITY,
        "01-04": 0.1,
      },
    };
    expect(normalizeDailyReturns(raw)).toEqual([
      { date: "2026-01-04", value: 0.1 },
    ]);
  });
});

describe("mean / stdDev / compound", () => {
  it("mean returns 0 on empty input", () => {
    expect(mean([])).toBe(0);
  });
  it("mean computes arithmetic average", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
  it("stdDev returns 0 for fewer than 2 values when sample=true", () => {
    expect(stdDev([5])).toBe(0);
  });
  it("stdDev with sample=true uses Bessel's correction (n-1)", () => {
    // values [2,4,4,4,5,5,7,9] — population mean = 5, population variance
    // = 4, sample variance = 32/7 ≈ 4.571. Sqrt ≈ 2.138.
    const s = stdDev([2, 4, 4, 4, 5, 5, 7, 9], true);
    expect(s).toBeCloseTo(2.138, 2);
  });
  it("stdDev with sample=false uses population (n)", () => {
    // Same input, population stddev = 2 exactly.
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9], false)).toBeCloseTo(2, 6);
  });
  it("compound returns 0 for empty input (no growth)", () => {
    expect(compound([])).toBe(0);
  });
  it("compound chains period returns multiplicatively", () => {
    // (1.1 * 0.9) - 1 = -0.01
    expect(compound([0.1, -0.1])).toBeCloseTo(-0.01, 6);
  });
});
