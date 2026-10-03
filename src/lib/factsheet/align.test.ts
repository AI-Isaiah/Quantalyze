import { describe, it, expect } from "vitest";
import { alignCoveredReturns, CALENDAR_7D } from "./align";

/**
 * The interval-pairing rule these cases pin is Phase 166.4 BENCHALIGN founder decision D-A
 * (with its ratified D-05 day one and D-07 base close, and the engine's interior-gap fix
 * d1d1fc077, 166.4 review WR-01), applied in TypeScript by Phase 169.5 (169.5-CONTEXT D-63,
 * D-64). Rewritten 2026-09-30 (169.5-01, B3): the old helper filled an uncovered day with a
 * 0% return; a gap is null here, never 0 (169 D-09, 169.5 D-54, D-58, D-64).
 */
describe("alignCoveredReturns", () => {
  it("a BTC close missing AT a strategy date: that date is null, the next carries the move in the series, unpaired", () => {
    const prices = [
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-03", close: 110 },
    ];
    const a = alignCoveredReturns(prices, [], ["2024-01-01", "2024-01-02", "2024-01-03"], CALENDAR_7D);
    expect(a.returns[0]).toBeNull(); // no close before 01-01 (D-64 day one)
    expect(a.returns[1]).toBeNull(); // no close dated 01-02 (D-58)
    expect(a.returns[2]).toBeCloseTo(0.1, 12); // the move between two real closes (D-58 amendment)
    expect(a.paired).toEqual([false, false, false]);
  });

  it("a lone close has no prior close: day one is null, never 0", () => {
    const a = alignCoveredReturns([{ date: "2024-01-01", close: 50 }], [], ["2024-01-01"], CALENDAR_7D);
    expect(a.returns).toEqual([null]);
    expect(a.paired).toEqual([false]);
  });

  it("day one with a close before it is the benchmark's own return for that date, paired (D-64, 166.4 D-05)", () => {
    const a = alignCoveredReturns(
      [
        { date: "2023-12-31", close: 40 },
        { date: "2024-01-01", close: 50 },
      ],
      [],
      ["2024-01-01"],
      CALENDAR_7D,
    );
    expect(a.returns[0]).toBeCloseTo(0.25, 12);
    expect(a.paired).toEqual([true]);
  });

  it("the prior close unavailable: both indices null (D-09, D-54, D-64)", () => {
    const a = alignCoveredReturns([{ date: "2024-01-02", close: 100 }], [], ["2024-01-01", "2024-01-02"], CALENDAR_7D);
    expect(a.returns).toEqual([null, null]);
    expect(a.paired).toEqual([false, false]);
  });

  it("a day missing INTERIOR to one interval (weekday strategy, BTC Saturday missing): exact Monday/Friday ratio, NOT paired (d1d1fc077)", () => {
    // 2024-01-05 is a Friday, 2024-01-08 a Monday. BTC's calendar is all seven days,
    // passed in (review WR-02), never inferred from these closes.
    const prices = [
      ...["2023-12-30", "2023-12-31", "2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"].map((date, i) => ({
        date,
        close: 90 + i,
      })),
      { date: "2024-01-05", close: 100 },
      { date: "2024-01-07", close: 104 },
      { date: "2024-01-08", close: 98 },
    ];
    const a = alignCoveredReturns(prices, [], ["2024-01-05", "2024-01-08"], CALENDAR_7D);
    expect(a.returns[1]).toBeCloseTo(98 / 100 - 1, 12);
    expect(a.paired[1]).toBe(false);
  });

  it("review WR-02 / SFH-M-03: the calendar is BTC's seven days even when the window's only Saturday is missing", () => {
    // Weekday strategy Thu 2025-01-02, Fri 01-03, Mon 01-06, Tue 01-07. BTC closes daily
    // from 2025-01-01 with Saturday 01-04 missing, and the window holds no other Saturday.
    // Inferring the calendar from these closes would drop Saturday, so (Fri, Mon] would
    // expect 2 points, find 2 (Sunday bridges Fri->Sun) and pair. The engine infers from
    // BTC's full stored history, expects 3, and leaves it unpaired.
    const prices = [
      { date: "2025-01-01", close: 100 },
      { date: "2025-01-02", close: 101 },
      { date: "2025-01-03", close: 103 },
      { date: "2025-01-05", close: 99 },
      { date: "2025-01-06", close: 102 },
      { date: "2025-01-07", close: 104 },
    ];
    const a = alignCoveredReturns(prices, [], ["2025-01-02", "2025-01-03", "2025-01-06", "2025-01-07"], CALENDAR_7D);
    expect(a.paired).toEqual([true, true, false, true]);
    expect(a.returns[2]).toBeCloseTo(102 / 103 - 1, 12); // the series keeps the real move (D-64(2))
  });

  it("the base close (166.4 D-07): a strategy date equal to the first close pairs the next interval", () => {
    const prices = [
      { date: "2024-01-02", close: 100 },
      { date: "2024-01-03", close: 105 },
    ];
    const a = alignCoveredReturns(prices, [], ["2024-01-01", "2024-01-02", "2024-01-03"], CALENDAR_7D);
    expect(a.returns.slice(0, 2)).toEqual([null, null]);
    expect(a.returns[2]).toBeCloseTo(0.05, 12);
    expect(a.paired).toEqual([false, false, true]);
  });

  it("null past `through`, and `through` is the last close on or before the strategy's last date", () => {
    const prices = [
      { date: "2024-01-01", close: 100 },
      { date: "2024-01-02", close: 101 },
      { date: "2024-01-03", close: 102 },
    ];
    const a = alignCoveredReturns(prices, [], ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"], CALENDAR_7D);
    expect(a.through).toBe("2024-01-03");
    expect(a.returns[2]).toBeNull();
    expect(a.returns[3]).toBeNull();
    expect(a.paired.slice(2)).toEqual([false, false]);
  });
});

describe("isPastCoverage (169.5 review WR-01)", () => {
  it("reads the gap on the benchmark's own calendar, not by raw date", async () => {
    const { isPastCoverage, CALENDAR_7D, CALENDAR_WEEKDAY } = await import("./align");
    // Fri 2025-03-14 -> Sun 2025-03-16: nothing missing for a weekday market, two days for a 7-day one.
    expect(isPastCoverage("2025-03-14", "2025-03-16", CALENDAR_WEEKDAY)).toBe(false);
    expect(isPastCoverage("2025-03-14", "2025-03-16", CALENDAR_7D)).toBe(true);
    // Fri -> Mon is a missing weekday close.
    expect(isPastCoverage("2025-03-14", "2025-03-17", CALENDAR_WEEKDAY)).toBe(true);
    expect(isPastCoverage("2025-03-16", "2025-03-16", CALENDAR_7D)).toBe(false);
    expect(isPastCoverage(null, "2025-03-16", CALENDAR_7D)).toBe(true);
  });
});
