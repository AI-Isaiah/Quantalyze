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
import { formatRecordLength } from "./record-length";

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
