import { describe, it, expect } from "vitest";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { pickRollingWindow, rollingCalendarStats, rollingSharpe, rollingSortino, rollingVol } from "@/lib/factsheet/rolling";
import { buildScenarioFactsheetPayload } from "./scenario-factsheet-payload";

/**
 * Phase 194 plan 14 (D-11 as superseded by D-15; D-14) - the Scenario factsheet mount
 * carries the same rolling verdict as a real factsheet, for the BLEND.
 *
 * Why each case matters:
 *   - the record is the blend's own overlap, and its crypto flag is the `periodsPerYear`
 *     the composer hands the builder (a blend with one crypto leg is crypto), so the same
 *     70 dates are withheld at 365 and drawn at 252 (the bound differs by convention);
 *   - D-14 is ADDITIVE: a blend of a year or more keeps the 126-row window and gains the
 *     365-day one, and a shorter blend carries the four 1y keys as `null`, so the mount
 *     and the real factsheet have one shape.
 *
 * Expected spans, windows and counts are computed here from the fixture dates.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const START = "2024-01-01"; // a Monday

const value = (i: number) => 0.0011 + Math.sin(i * 0.37) * 0.011 + Math.cos(i * 0.11) * 0.005;

const daily = (n: number): DailyPoint[] => Array.from({ length: n }, (_, i) => ({ date: addDays(START, i), value: value(i) }));

/** `n` weekday observations (Mon-Fri) from START. */
function weekdays(n: number): DailyPoint[] {
  const out: DailyPoint[] = [];
  for (let d = 0; out.length < n; d++) {
    const date = addDays(START, d);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push({ date, value: value(out.length) });
  }
  return out;
}

const spanOf = (rows: DailyPoint[]) =>
  Math.round((Date.parse(rows[rows.length - 1].date) - Date.parse(rows[0].date)) / DAY) + 1; // D-20: both ends

describe("D-21: a blend of 365 daily returns fills the 1y window, 364 do not", () => {
  it("365 returns draw exactly one 1y point, the last day", () => {
    const p = buildScenarioFactsheetPayload({ portfolioDaily: daily(365), periodsPerYear: 365 });
    expect(p.rollingWindow1y).toMatchObject({ window: 365, label: "1y", calendarDays: 365 });
    const live = (xs: Array<number | null> | null | undefined) => xs!.flatMap((v, i) => (v === null ? [] : [i]));
    expect(live(p.strategyRollingVol1y)).toEqual([364]);
    expect(live(p.strategyRollingSharpe1y)).toEqual([364]);
    expect(live(p.strategyRollingSortino1y)).toEqual([364]);
  });

  it("364 returns draw none: the four 1y keys are null", () => {
    const p = buildScenarioFactsheetPayload({ portfolioDaily: daily(364), periodsPerYear: 365 });
    expect(p.rollingWindow1y).toBeNull();
    expect(p.strategyRollingVol1y).toBeNull();
  });
});

describe("a blend of a year or more: D-14 is additive", () => {
  const rows = daily(400);
  const p = buildScenarioFactsheetPayload({ portfolioDaily: rows, periodsPerYear: 365 });

  it("rollingWindow is STILL the 126-row 6mo window, short, days 126, with today's series", () => {
    expect(p.rollingWindow).toEqual({
      window: 126,
      label: "6mo",
      enough: true,
      annualization: { state: "short", days: 126, cause: null },
    });
    const r = rows.map((x) => x.value);
    expect(p.strategyRollingVol).toEqual(rollingVol(r, 126, 365));
    expect(p.strategyRollingSharpe).toEqual(rollingSharpe(r, 126, 365));
    expect(p.strategyRollingSortino).toEqual(rollingSortino(r, 126, 365));
  });

  it("rollingWindow1y is the 365-day window, full, and its series equal rollingCalendarStats on the blend returns", () => {
    expect(p.rollingWindow1y).toEqual({
      window: 365,
      label: "1y",
      enough: true,
      calendarDays: 365,
      annualization: { state: "full", days: 365, cause: null },
    });
    const want = rollingCalendarStats(
      rows.map((x) => x.value),
      rows.map((x) => x.date),
      365,
      365,
    );
    expect(p.strategyRollingVol1y).toEqual(want.vol);
    expect(p.strategyRollingSharpe1y).toEqual(want.sharpe);
    expect(p.strategyRollingSortino1y).toEqual(want.sortino);
    expect(typeof p.strategyRollingVol1y![399]).toBe("number");
  });

  it("the payload's figureRecord is the blend's: span 400 days, 400 observations, crypto", () => {
    expect(p.figureRecord).toEqual({ spanDays: spanOf(rows), observations: 400, crypto: true });
    expect(p.figureRecord).toEqual({ spanDays: 400, observations: 400, crypto: true });
  });
});

describe("a blend under a year carries the four 1y keys as null", () => {
  it("200 days: 126-row window, short, days 126; the four keys are present and null", () => {
    const p = buildScenarioFactsheetPayload({ portfolioDaily: daily(200), periodsPerYear: 365 });
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

  it("the row window's pick matches the existing ladder", () => {
    const p = buildScenarioFactsheetPayload({ portfolioDaily: daily(200), periodsPerYear: 365 });
    const pick = pickRollingWindow(200);
    expect(p.rollingWindow.window).toBe(pick.window);
    expect(p.rollingWindow.label).toBe(pick.label);
    expect(p.rollingWindow.enough).toBe(pick.enough);
  });
});

describe("D-15: the blend's TOTAL record withholds, a short rolling window only carries the note", () => {
  it("100 days at 365: the 30-row fallback is drawn, short, days 30", () => {
    const p = buildScenarioFactsheetPayload({ portfolioDaily: daily(100), periodsPerYear: 365 });
    expect(p.rollingWindow.window).toBe(30);
    expect(p.rollingWindow.annualization).toEqual({ state: "short", days: 30, cause: null });
  });

  it("70 weekday observations at 252 (two traditional legs): the 30-row window, short", () => {
    const rows = weekdays(70);
    const p = buildScenarioFactsheetPayload({ portfolioDaily: rows, periodsPerYear: 252 });
    expect(p.figureRecord).toEqual({ spanDays: spanOf(rows), observations: 70, crypto: false });
    expect(p.rollingWindow.window).toBe(30);
    expect(p.rollingWindow.annualization?.state).toBe("short");
    expect(p.rollingWindow.annualization?.cause).toBeNull();
  });

  it("70 consecutive days at 365 (one crypto leg): withheld with cause gate, the crypto bound is 90 days", () => {
    const rows = daily(70);
    const p = buildScenarioFactsheetPayload({ portfolioDaily: rows, periodsPerYear: 365 });
    expect(p.figureRecord).toEqual({ spanDays: 70, observations: 70, crypto: true });
    expect(spanOf(rows)).toBeLessThan(90);
    expect(p.rollingWindow.annualization).toEqual({ state: "withheld", days: 70, cause: "gate" });
  });

  it("the same 70 WEEKDAY dates at 365 cover 96 days, which clears the crypto bound: drawn, short", () => {
    // The bound is the calendar span for a crypto blend, whatever the observation count.
    const rows = weekdays(70);
    expect(spanOf(rows)).toBeGreaterThanOrEqual(90);
    const p = buildScenarioFactsheetPayload({ portfolioDaily: rows, periodsPerYear: 365 });
    expect(p.rollingWindow.annualization?.state).toBe("short");
  });
});

describe("the empty blend", () => {
  it("rollingWindow.annualization is withheld with cause record, days 0; no record is claimed", () => {
    const p = buildScenarioFactsheetPayload({ portfolioDaily: [] });
    expect(p.rollingWindow.annualization).toEqual({ state: "withheld", days: 0, cause: "record" });
    expect(p.rollingWindow.enough).toBe(false);
    expect("figureRecord" in p).toBe(false);
    for (const k of ["rollingWindow1y", "strategyRollingVol1y", "strategyRollingSharpe1y", "strategyRollingSortino1y"] as const) {
      expect(p[k], k).toBeNull();
    }
  });

  it("rollingBetaWindow carries no annualization (rolling beta is not annualized)", () => {
    const p = buildScenarioFactsheetPayload({ portfolioDaily: [] });
    expect("annualization" in p.rollingBetaWindow).toBe(false);
    const populated = buildScenarioFactsheetPayload({ portfolioDaily: daily(200), periodsPerYear: 365 });
    expect("annualization" in populated.rollingBetaWindow).toBe(false);
    expect("calendarDays" in populated.rollingBetaWindow).toBe(false);
  });
});
