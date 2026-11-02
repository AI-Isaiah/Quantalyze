import { describe, expect, it } from "vitest";
import { isIsoCalendarDate } from "./snapshot-rebuild-boundary";

// Typed-literal oracles: the expected value is written out, never derived from
// the function. nav-marks-start.ts reads worker-written JSONB through this
// check, so a malformed date must be refused rather than rendered.

describe("isIsoCalendarDate", () => {
  it("accepts a real calendar date written YYYY-MM-DD", () => {
    expect(isIsoCalendarDate("2026-07-24")).toBe(true);
    expect(isIsoCalendarDate("2024-02-29")).toBe(true);
  });

  it.each([
    ["an impossible date (2026-02-30)", "2026-02-30"],
    ["a leap day in a non-leap year", "2025-02-29"],
    ["an unpadded date", "2026-1-5"],
    ["a timestamp, not a date", "2026-07-24T00:00:00Z"],
    ["a date with leading whitespace", " 2026-07-24"],
    ["a number", 20260724],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s", (_name, input) => {
    expect(isIsoCalendarDate(input)).toBe(false);
  });
});
