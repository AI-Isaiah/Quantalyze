import { describe, it, expect } from "vitest";
import { alignCoveredReturns } from "./align";

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
    const a = alignCoveredReturns(prices, [], ["2024-01-01", "2024-01-02", "2024-01-03"]);
    expect(a.returns[0]).toBeNull(); // no close before 01-01 (D-64 day one)
    expect(a.returns[1]).toBeNull(); // no close dated 01-02 (D-58)
    expect(a.returns[2]).toBeCloseTo(0.1, 12); // the move between two real closes (D-58 amendment)
    expect(a.paired).toEqual([false, false, false]);
  });

  it("a lone close has no prior close: day one is null, never 0", () => {
    const a = alignCoveredReturns([{ date: "2024-01-01", close: 50 }], [], ["2024-01-01"]);
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
    );
    expect(a.returns[0]).toBeCloseTo(0.25, 12);
    expect(a.paired).toEqual([true]);
  });

  it("the prior close unavailable: both indices null (D-09, D-54, D-64)", () => {
    const a = alignCoveredReturns([{ date: "2024-01-02", close: 100 }], [], ["2024-01-01", "2024-01-02"]);
    expect(a.returns).toEqual([null, null]);
    expect(a.paired).toEqual([false, false]);
  });

  it("a day missing INTERIOR to one interval (weekday strategy, BTC Saturday missing): exact Monday/Friday ratio, NOT paired (d1d1fc077)", () => {
    // 2024-01-05 is a Friday, 2024-01-08 a Monday. The week before is contiguous,
    // so BTC's own calendar (every weekday it carries a close on) is all seven days.
    const prices = [
      ...["2023-12-30", "2023-12-31", "2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04"].map((date, i) => ({
        date,
        close: 90 + i,
      })),
      { date: "2024-01-05", close: 100 },
      { date: "2024-01-07", close: 104 },
      { date: "2024-01-08", close: 98 },
    ];
    const a = alignCoveredReturns(prices, [], ["2024-01-05", "2024-01-08"]);
    expect(a.returns[1]).toBeCloseTo(98 / 100 - 1, 12);
    expect(a.paired[1]).toBe(false);
  });

  it("the base close (166.4 D-07): a strategy date equal to the first close pairs the next interval", () => {
    const prices = [
      { date: "2024-01-02", close: 100 },
      { date: "2024-01-03", close: 105 },
    ];
    const a = alignCoveredReturns(prices, [], ["2024-01-01", "2024-01-02", "2024-01-03"]);
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
    const a = alignCoveredReturns(prices, [], ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]);
    expect(a.through).toBe("2024-01-03");
    expect(a.returns[2]).toBeNull();
    expect(a.returns[3]).toBeNull();
    expect(a.paired.slice(2)).toEqual([false, false]);
  });
});
