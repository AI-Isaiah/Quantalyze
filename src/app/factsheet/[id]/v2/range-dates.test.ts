import { describe, it, expect } from "vitest";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { basisAxisDates, resolveStoredRange, type StoredRange } from "./range-dates";

/**
 * Phase 239 (CACHE-02) — the pure resolver behind "a range the user set keeps its dates".
 *
 * The provider stores the range as two ISO days and resolves them to indices on the active
 * axis every render. These arms pin the resolver's contract: the strict off-axis rule (the
 * shrunk-axis fallback the provider had before), dates that fall between axis points, a
 * round trip that keeps the indices, no widening at resolve time, and the axis selection
 * that must mirror Layer 1 of useBasisSeriesView.
 */

/** n UTC-consecutive ISO days from `startISO`. */
function days(n: number, startISO: string): string[] {
  const d = new Date(`${startISO}T00:00:00Z`);
  return Array.from({ length: n }, () => {
    const iso = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
    return iso;
  });
}

/** Weekdays only (the weekends missing), from Monday 2024-01-01, `n` points. */
function weekdays(n: number): string[] {
  const out: string[] = [];
  const d = new Date("2024-01-01T00:00:00Z");
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const manual = (start: string, end: string): StoredRange => ({ kind: "manual", start, end });

describe("resolveStoredRange — strict off-axis rule", () => {
  const axis = days(20, "2024-01-01"); // 2024-01-01 .. 2024-01-20
  const full = [0, 19] as const;

  it("end one day after the last axis day gives fullRange", () => {
    expect(resolveStoredRange(manual("2024-01-05", "2024-01-21"), axis, full)).toBe(full);
  });

  it("start one day before the first axis day gives fullRange", () => {
    expect(resolveStoredRange(manual("2023-12-31", "2024-01-10"), axis, full)).toBe(full);
  });

  it("start on the first day and end on the last day resolve on the axis", () => {
    expect(resolveStoredRange(manual("2024-01-01", "2024-01-20"), axis, full)).toEqual([0, 19]);
  });
});

describe("resolveStoredRange — lookups on a gappy axis", () => {
  // 2024-01-01 is a Monday; index 4 = Fri 01-05, index 5 = Mon 01-08, index 9 = Fri 01-12.
  const axis = weekdays(30);
  const full = [0, axis.length - 1] as const;

  it("dates between axis points", () => {
    // Saturday start → the following Monday; Sunday end → the preceding Friday.
    expect(resolveStoredRange(manual("2024-01-06", "2024-01-14"), axis, full)).toEqual([5, 9]);
  });

  it("gappy round trip keeps the indices", () => {
    const pairs: Array<[number, number]> = [
      [0, 4],
      [3, 17],
      [5, 9],
      [12, 29],
      [0, 29],
    ];
    for (const [s, e] of pairs) {
      expect(resolveStoredRange(manual(axis[s], axis[e]), axis, full)).toEqual([s, e]);
    }
  });

  it("an inverted range gives fullRange", () => {
    // Saturday and Sunday of the same weekend: start → Monday (5), end → Friday (4).
    expect(resolveStoredRange(manual("2024-01-06", "2024-01-07"), axis, full)).toBe(full);
  });

  it("no widening at resolve", () => {
    // Three axis points (Mon..Wed), narrower than MIN_VISIBLE_SAMPLES: returned as resolved.
    expect(resolveStoredRange(manual("2024-01-08", "2024-01-10"), axis, full)).toEqual([5, 7]);
  });
});

describe("resolveStoredRange — nothing to resolve", () => {
  it("null stored or an empty axis gives fullRange", () => {
    const full = [0, 9] as const;
    expect(resolveStoredRange(null, days(10, "2024-01-01"), full)).toBe(full);
    expect(resolveStoredRange(manual("2024-01-01", "2024-01-05"), [], full)).toBe(full);
  });
});

describe("basisAxisDates", () => {
  const cashDates = days(10, "2020-01-01");
  const mtmDates = days(15, "2031-01-01");
  const smDates = days(15, "2032-01-01");
  const bundle = (dates: string[]) => ({ dates, strategyEquity: dates.map(() => 1), strategyReturns: dates.map(() => 0) });
  const payload = (seriesByBasis?: Record<string, unknown>) =>
    ({ dates: cashDates, seriesByBasis }) as unknown as FactsheetPayload;

  it("basisAxisDates picks the active basis axis", () => {
    const withMtm = payload({ mark_to_market: bundle(mtmDates) });
    // Cash on a payload that DOES carry an MTM bundle stays on the cash dates, by reference.
    expect(basisAxisDates(withMtm, "cash_settlement")).toBe(withMtm.dates);
    expect(basisAxisDates(withMtm, "mark_to_market")).toEqual(mtmDates);
    const bare = payload();
    expect(basisAxisDates(bare, "mark_to_market")).toBe(bare.dates);
    expect(basisAxisDates(payload({ smoothed_mtm: bundle(smDates) }), "smoothed_mtm")).toEqual(smDates);
  });
});
