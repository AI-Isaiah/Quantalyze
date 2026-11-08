/**
 * Phase 194 plan 12 (TRUST-05, D-11 as superseded by D-15, plus D-14): the shared verdicts
 * and copy for the widened kinds (deltas and lifts, alpha / tracking error / information
 * ratio / Treynor, rolling charts, half-record figures). Each case pins WHY: a record too
 * short to annualise is withheld, a window shorter than a year only earns a note, and no
 * verdict looks at a figure's size (D-05).
 *
 * Assumptions recorded by the plan (D-11 leaves them open):
 * - A-194-D11-01: a rolling window's span is in calendar days from its first to its last
 *   return date, so a 126-row daily window spans 125 days. Every row-window chart in use
 *   today therefore carries the short-track note (revised by D-14 / D-15: drawn, never withheld).
 * - A-194-D11-02: the copy for the widened kinds is new, in the UI-SPEC idiom.
 * - A-194-D11-03: Treynor is gated with alpha, tracking error and information ratio; beta,
 *   correlation, R-squared and the captures are not annualized and stay.
 * - A-194-D11-04: rolling beta is not annualized and stays ungated.
 * - A-194-D15-01: when the total record fails the gate AND holds no full window the cause is
 *   `gate`; `record` is reserved for a record that clears but is shorter than the window.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ONE_YEAR_DAYS,
  figureRecord,
  gateDelta,
  gateRollingWindow,
  rollingWindowSpanDays,
  shorterSpan,
  coveredDays,
  widenedShortNote,
  widenedWithheldReason,
  type FigureRecord,
  type WidenedKind,
} from "./figure-gate";
import { rollingSharpe, rollingSortino, rollingVol } from "./factsheet/rolling";

const DAY_MS = 86_400_000;
const START = Date.parse("2024-01-01T00:00:00Z");
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** `n` consecutive calendar days from START. */
const dailyDates = (n: number): string[] => Array.from({ length: n }, (_, i) => iso(START + i * DAY_MS));

/** `n` weekday dates (Mon-Fri) from Monday 2024-01-01. */
const weekdayDates = (n: number): string[] => {
  const out: string[] = [];
  for (let day = 0; out.length < n; day++) {
    const dow = new Date(START + day * DAY_MS).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(iso(START + day * DAY_MS));
  }
  return out;
};

/** The record a strategy holding exactly these dates would be judged on. */
const recordOf = (dates: readonly string[], periodsPerYear: number): FigureRecord =>
  figureRecord({
    seriesStart: dates[0],
    seriesEnd: dates[dates.length - 1],
    observations: dates.length,
    periodsPerYear,
  });

const cryptoDays = (n: number): FigureRecord => recordOf(dailyDates(n), 365);

describe("shorterSpan", () => {
  it("is the shortest window, and an unknown window stays unknown", () => {
    expect(shorterSpan(60, 200)).toBe(60);
    expect(shorterSpan(200, null)).toBeNull();
    expect(shorterSpan()).toBeNull();
    expect(shorterSpan(Number.NaN, 200)).toBeNull();
    expect(shorterSpan(200, undefined)).toBeNull();
  });
});

describe("gateDelta (D-15: the records withhold, the compared window qualifies)", () => {
  const long400 = cryptoDays(400); // covers 400 days
  const long500 = cryptoDays(500);

  it("withholds when either compared record fails the total-record gate", () => {
    expect(gateDelta(cryptoDays(61), long400, 60)).toBe("withheld");
    expect(gateDelta(long400, cryptoDays(61), 60)).toBe("withheld");
  });

  it("a record that clears but whose window is under a year is short, from a year full", () => {
    expect(gateDelta(cryptoDays(121), long400, shorterSpan(120, 400))).toBe("short");
    expect(gateDelta(long400, long500, 400)).toBe("full");
  });

  it("a non-crypto record is judged on its observations, not on a 90-day span", () => {
    const trad59 = recordOf(weekdayDates(59), 252);
    expect(gateDelta(trad59, long400, 60)).toBe("withheld");
  });

  it("a short compared window never withholds (D-15)", () => {
    // 61 weekday observations span ~85 days: clears 60 observations, window 85 days -> short.
    const trad61 = recordOf(weekdayDates(61), 252);
    expect(trad61.spanDays).toBeGreaterThanOrEqual(80);
    expect(gateDelta(trad61, long400, 85)).toBe("short");
  });

  it("either record undeterminable is the null state, so the figure stays with no note", () => {
    const unknown = figureRecord({ seriesStart: null, seriesEnd: null, observations: null, periodsPerYear: 365 });
    expect(gateDelta(unknown, long400, 400)).toBe("null");
    expect(gateDelta(long400, unknown, 400)).toBe("null");
  });

  it("a failing record outranks an undeterminable one", () => {
    const unknown = figureRecord({ seriesStart: null, seriesEnd: null, observations: null, periodsPerYear: 365 });
    expect(gateDelta(unknown, cryptoDays(61), 60)).toBe("withheld");
  });
});

describe("rollingWindowSpanDays (A-194-D11-01)", () => {
  it("126 consecutive daily dates cover 126 days (D-20: one day per daily return)", () => {
    expect(rollingWindowSpanDays(dailyDates(126), 126)).toBe(126);
  });

  it("D-20 boundary: a 365-row daily window covers 365 days, a 364-row one covers 364", () => {
    expect(rollingWindowSpanDays(dailyDates(365), 365)).toBe(365);
    expect(rollingWindowSpanDays(dailyDates(400), 364)).toBe(364);
  });

  it("a weekday calendar takes the shortest of its full windows", () => {
    const dates = weekdayDates(126);
    const span = rollingWindowSpanDays(dates, 126);
    expect(span).toBe(coveredDays(dates[0], dates[125]));
    expect(span).toBeGreaterThanOrEqual(175);
  });

  it("takes the minimum over every full window, not just the first", () => {
    // A 3-row window over dates with one gap: the gap window is wider, the dense one covers 3 days.
    const dates = ["2024-01-01", "2024-01-02", "2024-01-03", "2024-02-01", "2024-02-02", "2024-02-03"];
    expect(rollingWindowSpanDays(dates, 3)).toBe(3);
  });

  it("400 daily dates with window 30 cover 30 days", () => {
    expect(rollingWindowSpanDays(dailyDates(400), 30)).toBe(30);
  });

  it("is null when the record holds fewer dates than the window, or the window is under 2", () => {
    expect(rollingWindowSpanDays(dailyDates(20), 30)).toBeNull();
    expect(rollingWindowSpanDays(dailyDates(20), 1)).toBeNull();
    expect(rollingWindowSpanDays(dailyDates(20), 0)).toBeNull();
  });
});

describe("gateRollingWindow (D-11 as superseded by D-15; D-14 calendar window)", () => {
  const d400 = dailyDates(400);
  const rec400 = recordOf(d400, 365);

  it("a 126-row window over a cleared record is short with its span, never withheld", () => {
    expect(gateRollingWindow(rec400, d400, { rows: 126 }, true)).toEqual({ state: "short", days: 126, cause: null });
  });

  it("a 30-row window is short too: D-15 no longer withholds a window under 90 days", () => {
    expect(gateRollingWindow(rec400, d400, { rows: 30 }, true)).toEqual({ state: "short", days: 30, cause: null });
  });

  it("a record that clears but holds no full window is withheld with cause record", () => {
    const d100 = dailyDates(100);
    expect(gateRollingWindow(recordOf(d100, 365), d100, { rows: 126 }, false)).toEqual({
      state: "withheld",
      days: 100,
      cause: "record",
    });
  });

  it("`enough` false withholds even when the dates would hold a window", () => {
    expect(gateRollingWindow(rec400, d400, { rows: 30 }, false).cause).toBe("record");
  });

  it("a record that fails the total gate is withheld with cause gate (A-194-D15-01)", () => {
    const d60 = dailyDates(60);
    expect(gateRollingWindow(recordOf(d60, 365), d60, { rows: 30 }, true)).toEqual({
      state: "withheld",
      days: 60,
      cause: "gate",
    });
  });

  it("the gate cause outranks the no-window cause", () => {
    const d20 = dailyDates(20);
    expect(gateRollingWindow(recordOf(d20, 365), d20, { rows: 126 }, false).cause).toBe("gate");
  });

  it("a non-crypto 70-observation weekday record clears 60 observations and its 30-row window is short", () => {
    const wd = weekdayDates(70);
    const verdict = gateRollingWindow(recordOf(wd, 252), wd, { rows: 30 }, true);
    expect(verdict.state).toBe("short");
    expect(verdict.cause).toBeNull();
    expect(verdict.days).toBe(rollingWindowSpanDays(wd, 30));
  });

  it("D-20: a window of 365 daily rows covers a year and is full; 364 rows are short", () => {
    const d = dailyDates(400);
    expect(gateRollingWindow(rec400, d, { rows: 365 }, true)).toEqual({ state: "full", days: 365, cause: null });
    expect(gateRollingWindow(rec400, d, { rows: 364 }, true)).toEqual({ state: "short", days: 364, cause: null });
  });

  it("D-14: a calendar year window over a record that fills it is full and draws plain", () => {
    expect(gateRollingWindow(rec400, d400, { calendarDays: 365 }, true)).toEqual({
      state: "full",
      days: 365,
      cause: null,
    });
  });

  it("D-14: a 365-observation weekday record spanning over a year fills the window", () => {
    const wd = weekdayDates(365);
    const rec = recordOf(wd, 252);
    expect(rec.spanDays).toBeGreaterThanOrEqual(365);
    expect(gateRollingWindow(rec, wd, { calendarDays: 365 }, true).state).toBe("full");
  });

  it("D-14: a record shorter than the calendar window holds no filled window", () => {
    const d300 = dailyDates(300);
    expect(gateRollingWindow(recordOf(d300, 365), d300, { calendarDays: 365 }, true)).toEqual({
      state: "withheld",
      days: 300,
      cause: "record",
    });
  });

  it("an empty date list is withheld with cause record and 0 days", () => {
    const empty = figureRecord({ seriesStart: null, seriesEnd: null, observations: 0, periodsPerYear: 365 });
    expect(gateRollingWindow(empty, [], { rows: 30 }, true)).toEqual({ state: "withheld", days: 0, cause: "record" });
  });
});

describe("rolling series are null before the first full window (D-14: never drawn)", () => {
  // Deterministic series with both signs so every window has dispersion and a loss.
  const rets = Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? -0.01 : 0.004) + (i % 7) * 0.0003);

  it.each([
    ["rollingVol", rollingVol],
    ["rollingSharpe", rollingSharpe],
    ["rollingSortino", rollingSortino],
  ] as const)("%s is null at indices 0..124 and finite at 125 for window 126", (_name, fn) => {
    const out = fn(rets, 126, 365);
    for (let i = 0; i < 125; i++) expect(out[i], `index ${i}`).toBeNull();
    expect(Number.isFinite(out[125] as number)).toBe(true);
  });
});

describe("widenedWithheldReason (D-15: names the total record's bound, never a window)", () => {
  const trad = (observations: number): FigureRecord => ({ spanDays: null, observations, crypto: false });

  it("delta", () => {
    expect(widenedWithheldReason("delta", cryptoDays(60))).toBe(
      "Changes in annualized figures appear once both records reach 90 days. The shorter covers 60 days.",
    );
    expect(widenedWithheldReason("delta", trad(45))).toBe(
      "Changes in annualized figures appear once both records reach 60 trading days. The shorter has 45 trading days.",
    );
  });

  it("overlap", () => {
    expect(widenedWithheldReason("overlap", cryptoDays(45))).toBe(
      "Alpha, information ratio, Treynor and tracking error appear once the record reaches 90 days. This record covers 45 days.",
    );
    expect(widenedWithheldReason("overlap", trad(40))).toBe(
      "Alpha, information ratio, Treynor and tracking error appear once the record reaches 60 trading days. This record has 40 trading days.",
    );
  });

  it("rolling", () => {
    expect(widenedWithheldReason("rolling", cryptoDays(59))).toBe(
      "Rolling annualized figures appear once the record reaches 90 days. This record covers 59 days.",
    );
    expect(widenedWithheldReason("rolling", trad(50))).toBe(
      "Rolling annualized figures appear once the record reaches 60 trading days. This record has 50 trading days.",
    );
  });

  it("rolling-record names no window length", () => {
    expect(widenedWithheldReason("rolling-record", cryptoDays(100))).toBe(
      "Rolling annualized figures appear once the record covers one full rolling window. This record covers 100 days.",
    );
  });

  it("half", () => {
    expect(widenedWithheldReason("half", cryptoDays(70))).toBe(
      "Half-record annualized figures appear once the record reaches 90 days. This record covers 70 days.",
    );
  });

  it("agrees on one day and on thousands", () => {
    expect(widenedWithheldReason("overlap", { spanDays: 1, observations: null, crypto: true })).toContain("covers 1 day.");
    expect(widenedWithheldReason("rolling-record", { spanDays: 1234, observations: null, crypto: true })).toContain(
      "covers 1,234 days.",
    );
    expect(widenedWithheldReason("delta", trad(1))).toContain("has 1 trading day.");
  });
});

describe("widenedShortNote", () => {
  it("each kind reads in the UI-SPEC idiom", () => {
    expect(widenedShortNote("delta", 200)).toBe("Changes in annualized figures are measured over 200 days, under one year.");
    expect(widenedShortNote("overlap", 200)).toBe(
      "Alpha, information ratio, Treynor and tracking error are annualized from 200 days of overlap, under one year.",
    );
    expect(widenedShortNote("rolling", 125)).toBe("Rolling figures are annualized from a 125-day window, under one year.");
    expect(widenedShortNote("half", 150)).toBe("Half-record figures are annualized from 150 days, under one year.");
  });

  it("agrees on one day, prints thousands, and the hyphenated window form never pluralises", () => {
    expect(widenedShortNote("half", 1)).toBe("Half-record figures are annualized from 1 day, under one year.");
    expect(widenedShortNote("delta", 1234)).toContain("measured over 1,234 days,");
    expect(widenedShortNote("rolling", 1)).toContain("a 1-day window");
    expect(widenedShortNote("rolling", 1234)).toContain("a 1,234-day window");
  });
});

describe("no D-11 sentence carries a banned string (UI-SPEC idiom)", () => {
  const banned = [/N\/A/, /0\.00%/, /[⚠✕✖✗]/u, /implausible/i, /plausib/i, /suspicious/i];
  const kinds: WidenedKind[] = ["delta", "overlap", "rolling", "rolling-record", "half"];
  const sentences = [
    ...kinds.flatMap((k) => [widenedWithheldReason(k, cryptoDays(50)), widenedWithheldReason(k, { spanDays: null, observations: 40, crypto: false })]),
    ...(["delta", "overlap", "rolling", "half"] as const).map((k) => widenedShortNote(k, 200)),
  ];

  it.each(sentences)("%s", (sentence) => {
    for (const re of banned) expect(sentence).not.toMatch(re);
  });

  it("a withheld sentence carries only the deciding bound and the record's own count", () => {
    // 90 and 60 are the bounds; 50 is the record. No window length (125, 126, 30, 365) appears.
    const s = widenedWithheldReason("rolling", cryptoDays(50));
    expect([...s.matchAll(/\d[\d,]*/g)].map((m) => m[0])).toEqual(["90", "50"]);
  });
});

describe("one definition: Python and TS agree on the one-year bound (text-read pin)", () => {
  it("metrics.py holds ONE_YEAR_DAYS = 365 exactly once and it equals the TS constant", () => {
    const py = readFileSync(resolve(process.cwd(), "analytics-service/services/metrics.py"), "utf8");
    const hits = [...py.matchAll(/^ONE_YEAR_DAYS = (\d+)\s*$/gm)];
    expect(hits, "ONE_YEAR_DAYS must be defined exactly once in metrics.py").toHaveLength(1);
    expect(Number(hits[0][1])).toBe(ONE_YEAR_DAYS);
  });
});
