import { describe, it, expect } from "vitest";
import { buildComparatorBlock } from "./comparator-block";
import { buildFactsheetPayload } from "./build-payload";
import { cumEq } from "./compute";
import { rollingCalendarStats, ROLL_WINDOW_1Y_DAYS } from "./rolling";
import { coveredDays } from "@/lib/figure-gate";
import type { DailyReturn } from "./types";

/**
 * Phase 194 plan 21 (D-14, additive) - the comparator carries its own 365-calendar-day
 * rolling volatility, Sharpe and Sortino beside its row-window series.
 *
 * Why each case matters: the strategy's 1y line (plan 14) is a 365-CALENDAR-day window.
 * A benchmark line drawn against it on a row window would be a different statistic (126
 * rows is half a year of crypto and a quarter more of a weekday index), so the comparison
 * would mislead. Expected values are computed here by calling `rollingCalendarStats`
 * directly on the fixture, an independent path from the block's wiring. The row series
 * are pinned byte-identical so the 1y keys can only ADD (the replaced A-194-D14-04
 * reading wrote the 1y series into the row keys).
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const START = "2023-01-02"; // a Monday
const daily = (n: number) => Array.from({ length: n }, (_, i) => addDays(START, i));
const strat = (n: number) => Array.from({ length: n }, (_, i) => 0.001 + Math.sin(i * 0.37) * 0.011 + Math.cos(i * 0.11) * 0.005);
const benchOf = (n: number) => Array.from({ length: n }, (_, i) => Math.cos(i * 0.53) * 0.02 + Math.sin(i * 0.07) * 0.004 - 0.0003);

function build(
  dates: string[],
  s: number[],
  b: Array<number | null>,
  ppy: number,
  rollCalendarDays?: number,
) {
  return buildComparatorBlock("BTC-USD", "BTC", b, s, cumEq(s), dates, 0.5, 30, 60, 365, ppy, null, null, rollCalendarDays);
}

const KEYS_1Y = ["rollingVol1y", "rollingSharpe1y", "rollingSortino1y"] as const;
const expectClose = (got: Array<number | null>, want: Array<number | null>, label: string) => {
  expect(got.length, `${label} length`).toBe(want.length);
  for (let i = 0; i < want.length; i++) {
    if (want[i] == null) expect(got[i], `${label}[${i}]`).toBeNull();
    else expect(Math.abs((got[i] as number) - (want[i] as number)), `${label}[${i}]`).toBeLessThan(1e-12);
  }
};

describe("a 500-day daily comparator with rollCalendarDays 365", () => {
  const dates = daily(500);
  const s = strat(500);
  const b = benchOf(500);
  const on = build(dates, s, b, 365, ROLL_WINDOW_1Y_DAYS);
  const off = build(dates, s, b, 365);
  const want = rollingCalendarStats(b, dates, 365, 365);

  it("its 1y series equal rollingCalendarStats point for point, null before the first full 365 days", () => {
    expectClose(on.rollingVol1y!, want.vol, "vol");
    expectClose(on.rollingSharpe1y!, want.sharpe, "sharpe");
    expectClose(on.rollingSortino1y!, want.sortino, "sortino");
    // Fixture self-check, from the dates written here (D-21): the first point is the 365th date,
    // the first whose first-to-here span covers 365 days, both ends counted.
    expect(on.rollingVol1y![363]).toBeNull();
    expect(typeof on.rollingVol1y![364]).toBe("number");
    expect(coveredDays(dates[0], dates[364])).toBe(365);
    expect(coveredDays(dates[0], dates[363])).toBe(364);
  });

  it("additivity pin: the row series are byte-identical to the same call without rollCalendarDays", () => {
    expect(JSON.stringify(on.rollingVol)).toBe(JSON.stringify(off.rollingVol));
    expect(JSON.stringify(on.rollingSharpe)).toBe(JSON.stringify(off.rollingSharpe));
    expect(JSON.stringify(on.rollingSortino)).toBe(JSON.stringify(off.rollingSortino));
    // Row window 30 vs calendar 365: the two are different series, so a row-for-1y swap shows here.
    expect(JSON.stringify(on.rollingVol)).not.toBe(JSON.stringify(on.rollingVol1y));
  });

  it("rolling beta is identical with and without it", () => {
    expect(JSON.stringify(on.rollingBeta)).toBe(JSON.stringify(off.rollingBeta));
  });
});

describe("without rollCalendarDays the three 1y keys are absent", () => {
  const dates = daily(500);
  const block = build(dates, strat(500), benchOf(500), 365);
  it("no 1y key is set", () => {
    for (const k of KEYS_1Y) expect(k in block, k).toBe(false);
  });
  it("the row series are populated as before", () => {
    expect(block.rollingVol!.some(v => typeof v === "number")).toBe(true);
  });
});

describe("a weekday comparator against a crypto strategy: 365 calendar days, never 365 rows", () => {
  const n = 600;
  const dates = daily(n);
  const s = strat(n);
  // SPX closes on weekdays only: null on Saturday and Sunday (START is a Monday, so i % 7 in {5, 6}).
  const b = benchOf(n).map((v, i) => (i % 7 >= 5 ? null : v));
  const block = build(dates, s, b, 252, ROLL_WINDOW_1Y_DAYS);

  // Independent expectation: compact to the covered returns and their own dates, run the
  // calendar window, scatter back onto the full axis.
  const coveredRets: number[] = [];
  const coveredDates: string[] = [];
  const coveredIdx: number[] = [];
  b.forEach((v, i) => {
    if (v != null) {
      coveredRets.push(v);
      coveredDates.push(dates[i]);
      coveredIdx.push(i);
    }
  });
  const cal = rollingCalendarStats(coveredRets, coveredDates, 365, 252);

  it("equals the calendar window over the comparator's own covered dates, null on uncovered days", () => {
    const scatter = (vals: Array<number | null>) => {
      const out: Array<number | null> = new Array(n).fill(null);
      coveredIdx.forEach((idx, j) => (out[idx] = vals[j]));
      return out;
    };
    expectClose(block.rollingVol1y!, scatter(cal.vol), "vol");
    expectClose(block.rollingSharpe1y!, scatter(cal.sharpe), "sharpe");
    expectClose(block.rollingSortino1y!, scatter(cal.sortino), "sortino");
  });

  it("its first point is 365 calendar days after the first covered date, which a 365-row window would not give", () => {
    const first = block.rollingVol1y!.findIndex(v => v != null);
    expect(first).toBeGreaterThan(0);
    const covered = coveredDays(coveredDates[0], dates[first]);
    expect(covered).toBeGreaterThanOrEqual(365);
    expect(covered).toBeLessThan(372);
    // 365 covered rows of a weekday comparator span about 511 calendar days.
    expect(coveredDays(coveredDates[0], coveredDates[365])).toBeGreaterThan(500);
  });
});

describe("through the builder", () => {
  const STRATEGY = {
    id: "s-194-21-d14",
    name: "D14 Strategy",
    types: ["quant"],
    markets: ["crypto"],
    computedAt: "2026-10-01T00:00:00Z",
    trustTier: null,
    assetClass: "crypto",
    ingestSource: "csv" as const,
  };
  // From 2024-01-01: the bundled BTC closes begin 2023-04-26, so every date is covered.
  const rows = (n: number): DailyReturn[] =>
    Array.from({ length: n }, (_, i) => addDays("2024-01-01", i)).map((date, i) => ({ date, value: 0.0011 + Math.sin(i * 0.37) * 0.011 + Math.cos(i * 0.11) * 0.005 }));

  it("a 400-day payload's BTC block carries the three 1y keys, equal to rollingCalendarStats of its own returns", () => {
    const p = buildFactsheetPayload(STRATEGY, rows(400), {})!;
    const btc = p.comparators.btc;
    const bench = btc.dailyReturns!;
    expect(bench.every(r => r != null), "fixture: BTC covers every date").toBe(true);
    const want = rollingCalendarStats(bench as number[], p.dates, 365, 365);
    expectClose(btc.rollingVol1y!, want.vol, "vol");
    expectClose(btc.rollingSharpe1y!, want.sharpe, "sharpe");
    expectClose(btc.rollingSortino1y!, want.sortino, "sortino");
    // The row keys are still the row window (the 126-row pick on a 400-day record).
    expect(btc.rollingVol!.findIndex(v => v != null)).toBe(125);
    // The SPX comparator is a comparator too.
    expect(p.comparators.spx.rollingVol1y).toBeDefined();
  });

  it("a 200-day payload's BTC block carries no 1y key", () => {
    const p = buildFactsheetPayload(STRATEGY, rows(200), {})!;
    for (const k of KEYS_1Y) expect(k in p.comparators.btc, k).toBe(false);
    for (const k of KEYS_1Y) expect(k in p.comparators.spx, k).toBe(false);
  });
});
