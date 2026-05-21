import { describe, it, expect } from "vitest";
import { formatPreviewCell } from "./CsvPreviewStep";

// Regression: /qa CSV report 2026-05-21 ISSUE-014. The Preview step
// rendered the date_range pill in ISO ('2025-04-03 → 2026-05-06')
// but the sample-row table fell back to `String(value)` for each
// cell — so a US-format date like '4/3/2025' rendered raw, breaking
// the user's expectation that one date format applies across the
// whole step. The fix normalizes to ISO for the `date` column only
// and leaves other columns untouched.
describe("formatPreviewCell", () => {
  it("normalizes US-format date like '4/3/2025' to ISO", () => {
    expect(formatPreviewCell("4/3/2025", "date")).toBe("2025-04-03");
  });

  it("normalizes padded US-format date '04/03/2025' to ISO", () => {
    expect(formatPreviewCell("04/03/2025", "date")).toBe("2025-04-03");
  });

  it("returns ISO-format date unchanged", () => {
    expect(formatPreviewCell("2025-04-03", "date")).toBe("2025-04-03");
  });

  it("returns unrecognized date string unchanged (no silent coerce)", () => {
    // Validator-side normalization is the source of truth — we don't
    // want the wizard to invent a date if the value doesn't look like
    // one of the two formats we know.
    expect(formatPreviewCell("not-a-date", "date")).toBe("not-a-date");
  });

  it("does not touch non-date columns even if value looks date-like", () => {
    // Numeric / return columns rendered through this same helper should
    // not get coerced. The `daily_return` column may legitimately have
    // a slash in some weird upload.
    expect(formatPreviewCell("4/3/2025", "daily_return")).toBe("4/3/2025");
    expect(formatPreviewCell(-0.0123, "daily_return")).toBe("-0.0123");
  });

  it("handles null and undefined safely (renders empty)", () => {
    expect(formatPreviewCell(null, "date")).toBe("");
    expect(formatPreviewCell(undefined, "date")).toBe("");
  });

  it("does not shift dates due to timezone (timezone-stable)", () => {
    // Naive `new Date('4/3/2025').toISOString()` shifts back one day
    // in U.S. timezones. Explicit-format-detection avoids this.
    expect(formatPreviewCell("4/3/2025", "date")).toBe("2025-04-03");
    expect(formatPreviewCell("1/1/2025", "date")).toBe("2025-01-01");
    expect(formatPreviewCell("12/31/2024", "date")).toBe("2024-12-31");
  });
});
