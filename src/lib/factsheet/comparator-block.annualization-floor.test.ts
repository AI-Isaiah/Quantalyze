import { describe, it, expect } from "vitest";
import { buildComparatorBlock } from "./comparator-block";
import { cumEq } from "./compute";
import type { ComparatorSummary } from "./types";

/**
 * Phase 194 D-16 (founder, 2026-11-07, review WR-01: "D-15 wins"), superseding Phase 170.6
 * D-07's 90-day overlap gate on the comparator summary. The benchmark's CAGR, volatility,
 * Sharpe, Sortino and Calmar show on any zoom, whatever the overlap's length; only the
 * strategy's TOTAL record withholds (`gateAnnualized`, in the rail). A zoomed window and a
 * comparator overlap under 90 days therefore carry finite figures, in `summary` AND in
 * `summarySince`, with cumulative return and max drawdown unchanged.
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

describe("a 5-day SPX overlap still annualizes (D-16)", () => {
  // Mon 2024-07-29 .. Fri 2024-08-02: 4 elapsed calendar days, far under 90.
  const dates = ["2024-07-29", "2024-07-30", "2024-07-31", "2024-08-01", "2024-08-02"];
  const spx = [0.01, -0.005, 0.012, 0.003, 0.008];
  const b = block(dates, spx, 252);

  it("reads a finite Sharpe, Sortino, CAGR and annualized volatility", () => {
    expect(b.summary).toBeTruthy();
    for (const k of ["sharpe", "cagr", "ann_vol"] as const) expect(Number.isFinite(b.summary![k]), k).toBe(true);
  });

  it("keeps cumulative return and max drawdown, typed by hand", () => {
    // 1.01 * 0.995 * 1.012 * 1.003 * 1.008 = 1.0282209116 -> +2.82209%.
    expect(b.summary!.cum_ret).toBeCloseTo(0.0282209, 6);
    // Peak 1.01, trough 1.01 * 0.995 = 1.00495: a 0.5% drawdown.
    expect(b.summary!.max_dd).toBeCloseTo(-0.005, 9);
  });
});

describe("89 elapsed calendar days annualizes like 90 (D-16)", () => {
  it("2024-01-01 .. 2024-03-30 is 89 elapsed days: all five fields are finite numbers", () => {
    const dates = span("2024-01-01", 90);
    expect(dates[89]).toBe("2024-03-30");
    const b = block(dates, wiggle(90), 365);
    for (const k of ANNUALIZED) expect(Number.isFinite(b.summary![k]), k).toBe(true);
  });

  it("an overlap that starts late (the comparator covers the last 61 of 91 days) annualizes too", () => {
    const dates = span("2024-01-01", 91);
    const bench = wiggle(91).map((r, i) => (i < 30 ? null : r));
    const b = block(dates, bench, 365);
    for (const k of ANNUALIZED) expect(Number.isFinite(b.summary![k]), k).toBe(true);
  });
});

describe("summarySince annualizes on a slice under 90 days (D-16)", () => {
  const dates = span("2024-01-01", 182); // .. 2024-06-30
  const bench = wiggle(182);

  it("a 60-day slice carries finite figures beside the whole record's", () => {
    const b = block(dates, bench, 365, "2024-05-01"); // 2024-05-01 .. 06-30 = 60 elapsed days
    for (const k of ANNUALIZED) expect(Number.isFinite(b.summary![k]), `summary.${k}`).toBe(true);
    expect(b.summarySince).toBeTruthy();
    for (const k of ANNUALIZED) expect(Number.isFinite(b.summarySince![k]), `summarySince.${k}`).toBe(true);
    expect(Number.isFinite(b.summarySince!.cum_ret)).toBe(true);
    expect(Number.isFinite(b.summarySince!.max_dd)).toBe(true);
  });
});
