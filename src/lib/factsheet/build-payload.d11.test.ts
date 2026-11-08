import { describe, it, expect } from "vitest";
import { buildFactsheetPayload, deriveSeriesBundle } from "./build-payload";
import type { BuildFactsheetOpts } from "./build-payload";
import { pickRollingWindow, rollingCalendarStats, rollingSharpe, rollingSortino, rollingVol, ROLL_WINDOW_1Y_DAYS } from "./rolling";
import type { DailyReturn, FactsheetPayload } from "./types";
import type { FigureRecord } from "@/lib/figure-gate";

/**
 * Phase 194 plan 14 (D-11 as superseded by D-15; D-14) - the rolling verdict rides the
 * window it describes, and a record of a year or more ALSO carries the 365-calendar-day
 * window, beside the row window and never in its place.
 *
 * Every expected span, window and count is computed in this file from the fixture dates.
 * The 1y series oracle is `rollingCalendarStats` (plan 23: proven equal to the producer's
 * `_rolling_calendar_stats` on a closed-form fixture); the row-window oracle is the
 * existing `rollingVol` / `rollingSharpe` / `rollingSortino`, which this plan must not move.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const START = "2024-01-01"; // a Monday

const CRYPTO = {
  id: "s-194-14",
  name: "Rolling Verdict Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2026-10-01T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  ingestSource: "csv" as const,
};
const TRADITIONAL = { ...CRYPTO, assetClass: "traditional" };

const value = (i: number) => 0.0011 + Math.sin(i * 0.37) * 0.011 + Math.cos(i * 0.11) * 0.005;

function daily(n: number): DailyReturn[] {
  return Array.from({ length: n }, (_, i) => ({ date: addDays(START, i), value: value(i) }));
}

/** `n` weekday observations (Mon-Fri) from START. */
function weekdays(n: number): DailyReturn[] {
  const out: DailyReturn[] = [];
  for (let d = 0; out.length < n; d++) {
    const date = addDays(START, d);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push({ date, value: value(out.length) });
  }
  return out;
}

/** The stored count rides `recordObservations`, on every build, with or without a stored overlay. */
function build(
  rows: DailyReturn[],
  opts: { observations?: number | null; strategy?: typeof CRYPTO; rest?: Partial<BuildFactsheetOpts> } = {},
): FactsheetPayload {
  const full: BuildFactsheetOpts = {
    ...(opts.rest ?? {}),
    ...(opts.observations !== undefined ? { recordObservations: opts.observations } : {}),
  };
  const p = buildFactsheetPayload(opts.strategy ?? CRYPTO, rows, full);
  if (!p) throw new Error("fixture must build a payload");
  return p;
}

/** The record this test expects the builder to have used, computed from the fixture. */
function recordOf(rows: DailyReturn[], observations: number | null, crypto = true): FigureRecord {
  return {
    spanDays: Math.round((Date.parse(rows[rows.length - 1].date) - Date.parse(rows[0].date)) / DAY) + 1,
    observations,
    crypto,
  };
}

const bundleArgs = (record: FigureRecord | null) => ({
  periodsPerYear: 365,
  isArithmetic: false,
  markets: [] as string[],
  strategyName: "Bundle",
  benchmarkPrices: { unavailable: true } as const,
  figureRecord: record,
});

describe("D-14 is additive: a record of a year or more keeps the row window and gains the 1y window", () => {
  const rows = daily(400);
  const p = build(rows, { observations: 400 });

  it("rollingWindow is STILL the 126-row 6mo window, short, with today's three series", () => {
    expect(p.rollingWindow).toEqual({
      window: 126,
      label: "6mo",
      enough: true,
      annualization: { state: "short", days: 126, cause: null },
    });
    const r = p.strategyReturns;
    expect(p.strategyRollingVol).toEqual(rollingVol(r, 126, 365));
    expect(p.strategyRollingSharpe).toEqual(rollingSharpe(r, 126, 365));
    expect(p.strategyRollingSortino).toEqual(rollingSortino(r, 126, 365));
  });

  it("rollingWindow1y starts at the first point whose window is a full year, and its verdict is full", () => {
    expect(p.rollingWindow1y).toEqual({
      window: 365, // D-21: the first point is index 364 (365 days covered, both ends counted), plus one
      label: "1y",
      enough: true,
      calendarDays: ROLL_WINDOW_1Y_DAYS,
      annualization: { state: "full", days: 365, cause: null },
    });
  });

  it("the three 1y series equal rollingCalendarStats on the payload's own dates, null before the first full year", () => {
    const want = rollingCalendarStats(p.strategyReturns, p.dates, ROLL_WINDOW_1Y_DAYS, 365);
    expect(p.strategyRollingVol1y).toEqual(want.vol);
    expect(p.strategyRollingSharpe1y).toEqual(want.sharpe);
    expect(p.strategyRollingSortino1y).toEqual(want.sortino);
    expect(p.strategyRollingVol1y!.slice(0, 364).every((v) => v === null)).toBe(true);
    expect(typeof p.strategyRollingVol1y![364]).toBe("number");
    expect(typeof p.strategyRollingVol1y![399]).toBe("number");
  });

  it("rollingBetaWindow carries neither an annualization nor a calendarDays key (rolling beta is not annualized)", () => {
    expect("annualization" in p.rollingBetaWindow).toBe(false);
    expect("calendarDays" in p.rollingBetaWindow).toBe(false);
  });
});

describe("under 365 days the four 1y keys are SET to null, never omitted", () => {
  const rows = daily(200);
  const p = build(rows, { observations: 200 });

  it("the 126-row window, short, days 126; the 1y keys are present and null on the payload", () => {
    expect(p.rollingWindow).toEqual({
      window: 126,
      label: "6mo",
      enough: true,
      annualization: { state: "short", days: 126, cause: null },
    });
    for (const k of ["rollingWindow1y", "strategyRollingVol1y", "strategyRollingSharpe1y", "strategyRollingSortino1y"] as const) {
      expect(k in p, k).toBe(true);
      expect(p[k], k).toBeNull();
    }
  });

  it("the cash bundle carries the same four null keys (the basis merge spreads a bundle over the payload)", () => {
    const b = deriveSeriesBundle(rows, bundleArgs(recordOf(rows, 200)));
    for (const k of ["rollingWindow1y", "strategyRollingVol1y", "strategyRollingSharpe1y", "strategyRollingSortino1y"] as const) {
      expect(k in b, k).toBe(true);
      expect(b[k], k).toBeNull();
    }
  });

  it("the row-window pick and series are the pre-194 values (window, label, enough, three series)", () => {
    const pick = pickRollingWindow(200);
    expect({ window: p.rollingWindow.window, label: p.rollingWindow.label, enough: p.rollingWindow.enough }).toEqual({
      window: pick.window,
      label: pick.label,
      enough: pick.enough,
    });
    const r = p.strategyReturns;
    expect(p.strategyRollingVol).toEqual(rollingVol(r, 126, 365));
    expect(p.strategyRollingSharpe).toEqual(rollingSharpe(r, 126, 365));
    expect(p.strategyRollingSortino).toEqual(rollingSortino(r, 126, 365));
  });
});

describe("D-21: 365 daily returns fill the 1y window, 364 do not", () => {
  it("365 returns draw exactly one 1y point, the last day; the window is 365 rows", () => {
    const p = build(daily(365), { observations: 365 });
    expect(p.rollingWindow1y).toMatchObject({ window: 365, label: "1y", calendarDays: 365 });
    const live = (xs: Array<number | null> | null | undefined) => xs!.flatMap((v, i) => (v === null ? [] : [i]));
    expect(live(p.strategyRollingVol1y)).toEqual([364]);
    expect(live(p.strategyRollingSharpe1y)).toEqual([364]);
    expect(live(p.strategyRollingSortino1y)).toEqual([364]);
  });

  it("364 returns draw none: the four 1y keys are null", () => {
    const p = build(daily(364), { observations: 364 });
    expect(p.rollingWindow1y).toBeNull();
    expect(p.strategyRollingVol1y).toBeNull();
    expect(p.strategyRollingSharpe1y).toBeNull();
    expect(p.strategyRollingSortino1y).toBeNull();
  });
});

describe("an unknown record (figureRecord null) is the null state", () => {
  it("rollingWindow carries no annualization key, on a short and on a year-long series", () => {
    for (const n of [200, 400]) {
      const b = deriveSeriesBundle(daily(n), bundleArgs(null));
      expect("annualization" in b.rollingWindow, `n=${n}`).toBe(false);
      expect(b.rollingWindow.window, `n=${n}`).toBe(126);
    }
  });

  it("the 1y window is still drawn from 365 days, without a verdict", () => {
    const b = deriveSeriesBundle(daily(400), bundleArgs(null));
    expect(b.rollingWindow1y).toEqual({ window: 365, label: "1y", enough: true, calendarDays: 365 });
  });
});

describe("D-15: the TOTAL record withholds, a short rolling window only carries the note", () => {
  it("100 crypto days: the 30-row fallback is drawn, short, days 30", () => {
    const p = build(daily(100), { observations: 100 });
    expect(p.rollingWindow.window).toBe(30);
    expect(p.rollingWindow.annualization).toEqual({ state: "short", days: 30, cause: null });
  });

  it("60 crypto days: withheld with cause gate, the record covers 60 days (under 90)", () => {
    const p = build(daily(60), { observations: 60 });
    expect(p.rollingWindow.annualization).toEqual({ state: "withheld", days: 60, cause: "gate" });
  });

  it("20 crypto days: withheld with cause gate (the gate is checked before the window)", () => {
    const p = build(daily(20), { observations: 20 });
    expect(p.rollingWindow.enough).toBe(false);
    expect(p.rollingWindow.annualization).toEqual({ state: "withheld", days: 20, cause: "gate" });
  });

  it("non-crypto: 70 stored weekday observations pick the 30-row window and are short", () => {
    const rows = weekdays(70);
    const p = build(rows, { observations: 70, strategy: TRADITIONAL });
    expect(p.periodsPerYear).toBe(252);
    expect(p.rollingWindow.window).toBe(30);
    // Weekday data: 30 rows cover at least 42 days (D-20 counts both ends), computed here from the dates.
    let min = Infinity;
    for (let i = 29; i < rows.length; i++) {
      min = Math.min(min, Math.round((Date.parse(rows[i].date) - Date.parse(rows[i - 29].date)) / DAY) + 1);
    }
    expect(p.rollingWindow.annualization).toEqual({ state: "short", days: min, cause: null });
  });

  it("non-crypto: 50 stored weekday observations are withheld with cause gate (the count decides, not the span)", () => {
    const rows = weekdays(50);
    const p = build(rows, { observations: 50, strategy: TRADITIONAL });
    expect(p.rollingWindow.annualization?.state).toBe("withheld");
    expect(p.rollingWindow.annualization?.cause).toBe("gate");
  });
});

describe("the other basis bundles carry their own verdict and 1y window, gated on the payload's record", () => {
  it("an MTM bundle of 400 days gets its own annualization and 1y window; one of 200 days gets null 1y keys", () => {
    const cashRows = daily(400);
    const mtmRows = cashRows.map((d, i) => ({ date: d.date, value: value(i + 7) }));
    const p = build(cashRows, { observations: 400, rest: { mtmSeries: { dailyReturns: mtmRows, gapSpans: [] } } });
    const mtm = p.seriesByBasis!.mark_to_market!;
    expect(mtm.rollingWindow.annualization).toEqual({ state: "short", days: 126, cause: null });
    expect(mtm.rollingWindow1y).toEqual({
      window: 365,
      label: "1y",
      enough: true,
      calendarDays: 365,
      annualization: { state: "full", days: 365, cause: null },
    });
    const want = rollingCalendarStats(mtm.strategyReturns, mtm.dates, ROLL_WINDOW_1Y_DAYS, 365);
    expect(mtm.strategyRollingSharpe1y).toEqual(want.sharpe);
    // A bundle spanning under 365 days is judged on the SAME total record the cash bundle used.
    const shorter = deriveSeriesBundle(mtmRows.slice(200), bundleArgs(p.figureRecord!));
    expect(shorter.rollingWindow.annualization).toEqual({ state: "short", days: 126, cause: null });
    expect(shorter.rollingWindow1y).toBeNull();
    expect(shorter.strategyRollingVol1y).toBeNull();
  });
});

describe("the 1y series ride the same day basis as the row windows", () => {
  it("active basis: Sharpe is rolled over the non-zero days, volatility and Sortino over every day", () => {
    const rows = daily(400).map((d, i) => (i % 5 === 3 ? { ...d, value: 0 } : d));
    const p = build(rows, { observations: 400, rest: { dayBasis: "active" } });
    const idx = rows.map((_, i) => i).filter((i) => rows[i].value !== 0);
    const act = rollingCalendarStats(idx.map((i) => rows[i].value), idx.map((i) => rows[i].date), 365, 365);
    const all = rollingCalendarStats(rows.map((r) => r.value), rows.map((r) => r.date), 365, 365);
    const sharpeWant = rows.map(() => null as number | null);
    idx.forEach((i, j) => (sharpeWant[i] = act.sharpe[j]));
    expect(p.strategyRollingSharpe1y).toEqual(sharpeWant);
    expect(p.strategyRollingVol1y).toEqual(all.vol);
    expect(p.strategyRollingSortino1y).toEqual(all.sortino);
    expect(p.strategyRollingSharpe1y!.some((v) => v !== null)).toBe(true);
  });

  it("calendar composite with interior gaps: all three run over the zero-filled calendar series", () => {
    // 400 present days with one calendar day absent before every 40th observation.
    const rows: DailyReturn[] = [];
    let offset = 0;
    for (let i = 0; i < 400; i++) {
      if (i > 0 && i % 40 === 0) offset += 1;
      rows.push({ date: addDays(START, i + offset), value: value(i) });
    }
    const p = build(rows, { observations: 400, rest: { dataQuality: { composite: true } } as Partial<BuildFactsheetOpts> });
    const byDate = new Map(rows.map((r) => [r.date, r.value]));
    const zr: number[] = [];
    const zd: string[] = [];
    for (let d = rows[0].date; d <= rows[rows.length - 1].date; d = addDays(d, 1)) {
      zd.push(d);
      zr.push(byDate.get(d) ?? 0);
    }
    const want = rollingCalendarStats(zr, zd, 365, 365);
    const at = (arr: Array<number | null>) => rows.map((r) => arr[zd.indexOf(r.date)]);
    expect(p.strategyRollingVol1y).toEqual(at(want.vol));
    expect(p.strategyRollingSharpe1y).toEqual(at(want.sharpe));
    expect(p.strategyRollingSortino1y).toEqual(at(want.sortino));
    expect(p.strategyRollingVol1y!.some((v) => v !== null)).toBe(true);
  });
});
