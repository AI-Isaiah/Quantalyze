/**
 * Phase 169 D-12 / D-25 (SC5): the record length is stated ONE way.
 *
 * Why this matters: the factsheet used to state a record's length four ways on
 * two clocks. "166 trading days" and an observation count divided by 252 (or by
 * the payload's periodsPerYear) read a 24/7 or a sparse record as the wrong
 * length: 166 observations spread over 1.20 calendar years printed "0.45y".
 * Every site now asks this one formatter, which states the CALENDAR years it is
 * given and the observation count, and never derives one from the other.
 *
 * The expected values are literals, not re-derivations, so a change of wording
 * or of clock fails here first.
 */
import { describe, it, expect } from "vitest";
import { formatCagrSpan, formatRecordLength } from "./record-length";

describe("formatRecordLength — calendar years plus daily observations (D-12)", () => {
  it("states a 166-point, 0.45-calendar-year record once, in calendar years with two decimals", () => {
    expect(formatRecordLength({ n: 166, years: 0.4545 })).toEqual({
      years: "0.45",
      observations: "166 daily observations",
      text: "0.45 years, 166 daily observations",
    });
  });

  it("never computes years from the count: 166 observations over 1.1992 calendar years reads 1.20, not 166 / 365", () => {
    const out = formatRecordLength({ n: 166, years: 1.1992 });
    expect(out.years).toBe("1.20");
    expect(out.text).toBe("1.20 years, 166 daily observations");
    expect(out.text).not.toContain("0.45");
    expect(out.text).not.toContain("0.66");
  });

  it("a single observation is singular", () => {
    expect(formatRecordLength({ n: 1, years: 0.0027 }).observations).toBe("1 daily observation");
    expect(formatRecordLength({ n: 1, years: 0.0027 }).text).toBe("0.00 years, 1 daily observation");
  });

  it("the count carries a thousands separator (DESIGN.md Numbers Contract: integers)", () => {
    expect(formatRecordLength({ n: 2191, years: 5.9986 }).text).toBe("6.00 years, 2,191 daily observations");
  });

  it("a non-finite years value is the em-dash for the years part, never 0.00", () => {
    for (const years of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const out = formatRecordLength({ n: 166, years });
      expect(out.years).toBe("—");
      expect(out.text).toBe("—, 166 daily observations");
      expect(out.text).not.toMatch(/NaN|Infinity|0\.00/);
    }
  });

  it("a non-finite count is the em-dash, never NaN", () => {
    const out = formatRecordLength({ n: Number.NaN, years: 0.45 });
    expect(out.observations).toBe("— daily observations");
    expect(out.text).not.toContain("NaN");
  });
});

describe("formatCagrSpan, the span CAGR covers (236 plan 11, CONTEXT Q1)", () => {
  it("states the dates and the whole first-to-last days, 598 for 2024-03-14 to 2025-11-02", () => {
    expect(formatCagrSpan("2024-03-14", "2025-11-02")).toBe("CAGR over Mar\u00a014,\u00a02024 to Nov\u00a02,\u00a02025 (598 days)");
  });

  it("counts whole first-to-last days, not coveredDays' inclusive count: one day apart is 1 day, not 2", () => {
    expect(formatCagrSpan("2025-01-01", "2025-01-02")).toBe("CAGR over Jan\u00a01,\u00a02025 to Jan\u00a02,\u00a02025 (1 day)");
  });

  it("is null when either end is absent, so an old row renders nothing", () => {
    expect(formatCagrSpan(null, "2025-11-02")).toBeNull();
    expect(formatCagrSpan("2024-03-14", undefined)).toBeNull();
    expect(formatCagrSpan(undefined, undefined)).toBeNull();
  });

  it("is null for a value that is not a day, never invented text", () => {
    expect(formatCagrSpan("not-a-date", "2025-11-02")).toBeNull();
    expect(formatCagrSpan("2024-03-14", "2025-13-45")).toBeNull();
  });

  it("is null when the span is not a span (same day or reversed)", () => {
    expect(formatCagrSpan("2025-01-01", "2025-01-01")).toBeNull();
    expect(formatCagrSpan("2025-02-01", "2025-01-01")).toBeNull();
  });
});
