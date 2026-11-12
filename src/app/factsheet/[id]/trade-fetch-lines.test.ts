import { describe, it, expect } from "vitest";
import { formatIsoDate } from "./trade-fetch-lines";
import { formatDay } from "@/lib/utils";

// Phase 201 D-11, U-14: the factsheet's one date formatter is the app-wide `formatDay`. A copy of
// its own month array is what let the factsheet drift from every other surface, so the arms compare
// against `formatDay` and against hand-typed strings, never against this module's own code.
describe("formatIsoDate delegates to formatDay", () => {
  it("prints the full day, in UTC, for a date and for a timestamp", () => {
    expect(formatIsoDate("2026-10-09")).toBe("Oct\u00a09,\u00a02026");
    // 00:30 UTC is still Oct 9: the instant decides the day, not the runtime time zone.
    expect(formatIsoDate("2026-10-09T00:30:00Z")).toBe("Oct\u00a09,\u00a02026");
  });

  it("agrees with formatDay on every input, including one that does not parse", () => {
    for (const iso of ["2026-01-01", "2024-02-29T23:59:59Z", "not-a-date", ""]) {
      expect(formatIsoDate(iso)).toBe(formatDay(iso));
    }
    expect(formatIsoDate("not-a-date")).toBe("—");
  });
});
