import { describe, it, expect } from "vitest";
import { buildComparatorBlock, COMPARATOR_ANNUALIZATION_FLOOR_DAYS } from "./comparator-block";
import { cumEq } from "./compute";
import type { ComparatorSummary } from "./types";

/**
 * Phase 170.6 plan 11 (D-07): a comparator overlap shorter than 90 elapsed calendar
 * days is too short to annualize. Its Sharpe, Sortino, Calmar, CAGR and annualized
 * volatility are NaN (the rail prints "—") in `summary` AND in `summarySince`;
 * cumulative return and max drawdown keep their values.
 *
 * Every expected number is typed here by hand. The 5-day SPX fixture reproduces the
 * defect class behind the 10.24 SPX Sharpe the founder saw on PROD (a week of SPX
 * annualized as though it were a year): on the code before this plan its Sharpe is a
 * large finite number.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const span = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i));

/** Build a block with the comparator's returns `bench` over `dates`; the strategy leg is any varying series. */
function block(
  dates: string[],
  bench: Array<number | null>,
  ppy: number,
  spanStart: string | null = null,
) {
  const strat = dates.map((_, i) => ((i % 5) - 2) / 400);
  return buildComparatorBlock("SPX", "SPX", bench, strat, cumEq(strat), dates, 0.15, 30, 60, ppy, ppy, spanStart);
}

const ANNUALIZED = ["sharpe", "sortino", "calmar", "cagr", "ann_vol"] as const satisfies ReadonlyArray<keyof ComparatorSummary>;

/** A varying series of `n` returns that is neither flat nor monotone, so every ratio is defined at length. */
const wiggle = (n: number): number[] => Array.from({ length: n }, (_, i) => ((i % 7) - 3) / 300 + 0.0004);

describe("COMPARATOR_ANNUALIZATION_FLOOR_DAYS (D-07)", () => {
  it("is 90, the founder's number", () => {
    expect(COMPARATOR_ANNUALIZATION_FLOOR_DAYS).toBe(90);
  });
});

describe("a 5-day SPX overlap annualizes nothing (D-07)", () => {
  // Mon 2024-07-29 .. Fri 2024-08-02: 4 elapsed calendar days, far under 90.
  const dates = ["2024-07-29", "2024-07-30", "2024-07-31", "2024-08-01", "2024-08-02"];
  const spx = [0.01, -0.005, 0.012, 0.003, 0.008];
  const b = block(dates, spx, 252);

  it("reads NaN for Sharpe, Sortino, Calmar, CAGR and annualized volatility", () => {
    expect(b.summary).toBeTruthy();
    for (const k of ANNUALIZED) expect(b.summary![k], k).toBeNaN();
  });

  it("keeps cumulative return and max drawdown, typed by hand", () => {
    // 1.01 * 0.995 * 1.012 * 1.003 * 1.008 = 1.0282209116 -> +2.82209%.
    expect(b.summary!.cum_ret).toBeCloseTo(0.0282209, 6);
    // Peak 1.01, trough 1.01 * 0.995 = 1.00495: a 0.5% drawdown.
    expect(b.summary!.max_dd).toBeCloseTo(-0.005, 9);
  });
});

describe("the boundary: 90 elapsed calendar days annualizes, 89 does not (D-07)", () => {
  it("2024-01-01 .. 2024-03-31 is 90 elapsed days: Sharpe is a finite number", () => {
    const dates = span("2024-01-01", 91);
    expect(dates[90]).toBe("2024-03-31");
    const b = block(dates, wiggle(91), 365);
    for (const k of ANNUALIZED) expect(Number.isFinite(b.summary![k]), k).toBe(true);
  });

  it("2024-01-01 .. 2024-03-30 is 89 elapsed days: the five fields are NaN, the other two stay", () => {
    const dates = span("2024-01-01", 90);
    expect(dates[89]).toBe("2024-03-30");
    const b = block(dates, wiggle(90), 365);
    for (const k of ANNUALIZED) expect(b.summary![k], k).toBeNaN();
    expect(Number.isFinite(b.summary!.cum_ret)).toBe(true);
    expect(Number.isFinite(b.summary!.max_dd)).toBe(true);
  });

  it("counts from the comparator's first COVERED date, not the strategy's first date", () => {
    // The strategy runs 91 days, but the comparator has prices for the last 60 only.
    const dates = span("2024-01-01", 91);
    const bench = wiggle(91).map((r, i) => (i < 30 ? null : r));
    const b = block(dates, bench, 365);
    for (const k of ANNUALIZED) expect(b.summary![k], k).toBeNaN();
  });
});

describe("summarySince is gated on ITS slice (D-07)", () => {
  const dates = span("2024-01-01", 182); // .. 2024-06-30
  const bench = wiggle(182);

  it("a slice under 90 days is NaN even though the whole record spans over 90", () => {
    const b = block(dates, bench, 365, "2024-05-01"); // 2024-05-01 .. 06-30 = 60 elapsed days
    for (const k of ANNUALIZED) expect(Number.isFinite(b.summary![k]), `summary.${k}`).toBe(true);
    expect(b.summarySince).toBeTruthy();
    for (const k of ANNUALIZED) expect(b.summarySince![k], `summarySince.${k}`).toBeNaN();
    expect(Number.isFinite(b.summarySince!.cum_ret)).toBe(true);
    expect(Number.isFinite(b.summarySince!.max_dd)).toBe(true);
  });

  it("a slice of 90 or more days keeps its figures", () => {
    const b = block(dates, bench, 365, "2024-03-01"); // 2024-03-01 .. 06-30 = 121 elapsed days
    for (const k of ANNUALIZED) expect(Number.isFinite(b.summarySince![k]), `summarySince.${k}`).toBe(true);
  });
});
