import { describe, it, expect } from "vitest";
import {
  figureRecord,
  figureSpan,
  gateAnnualized,
  gateDelta,
  gateRollingWindow,
  recordClears,
  widenedWithheldReason,
  withheldCellTitle,
  withheldReason,
  type FigureRecord,
} from "@/lib/figure-gate";
import { buildComparatorBlock } from "./comparator-block";
import { cumEq } from "./compute";
import { rollingCalendarStats } from "./rolling";

/**
 * Phase 194 review R4 WR-02 (D-17): an ABSENT date is unknown and shows the value; a date that
 * is PRESENT but malformed must not. Before the fix every malformed date made a span NaN, and
 * every consumer read NaN as "unknown", so Sharpe / CAGR / alpha showed on a record that could
 * be 20 days. Each case here fails when its guard is removed.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daily = (n: number, start = "2024-01-01") => Array.from({ length: n }, (_, i) => addDays(start, i));

describe("figureRecord: a PRESENT but unparsable headlineSince is withheld (R5 WR-02); an absent one is unknown", () => {
  const rec = (headlineSince: string | null | undefined, seriesEnd = "2025-12-31") =>
    figureRecord({
      seriesStart: "2023-01-01",
      seriesEnd,
      headlineSince,
      observations: 400,
      periodsPerYear: 365,
    });

  it.each(["garbage", "2026-13-99", "2026-1-5"])(
    "a chain-broken 20-day suffix in a 3-year series with headlineSince %j is unreadable and withheld, never read as the 3-year record",
    (headlineSince) => {
      const r = rec(headlineSince);
      // The generous fallback span (3 years) is exactly what must never be judged on.
      expect(figureSpan({ seriesStart: "2023-01-01", seriesEnd: "2025-12-31", headlineSince })).toBe(1096);
      expect(r.unreadable).toBe(true);
      expect(recordClears(r)).toBe(false);
      expect(gateAnnualized(r)).toBe("withheld");
      expect(gateAnnualized(r, 400)).toBe("withheld");
      expect(gateDelta(r, r, 400)).toBe("withheld");
    },
  );

  it.each([null, undefined, ""])("an absent headlineSince %j stays unknown-free: the series span decides, the record is readable", (absent) => {
    const r = rec(absent);
    expect(r.unreadable).toBeUndefined();
    expect(r.spanDays).toBe(1096);
    expect(gateAnnualized(r)).toBe("full");
  });

  it("a 20-day crypto record with a malformed headlineSince is withheld", () => {
    const r = figureRecord({
      seriesStart: "2025-01-01",
      seriesEnd: "2025-01-20",
      headlineSince: "garbage",
      observations: 20,
      periodsPerYear: 365,
    });
    expect(r.unreadable).toBe(true);
    expect(gateAnnualized(r)).toBe("withheld");
  });

  it("a valid headlineSince later than the series start still wins", () => {
    const r = rec("2025-12-01");
    expect(r.unreadable).toBeUndefined();
    expect(r.spanDays).toBe(31);
    expect(gateAnnualized(r)).toBe("withheld");
  });
});

describe("figureRecord: a PRESENT but unparsable series end is withheld; an ABSENT one stays unknown", () => {
  const bad = (over: { seriesStart?: string | null; seriesEnd?: string | null }, crypto = true, observations = 200) =>
    figureRecord({
      seriesStart: "2025-01-01",
      seriesEnd: "2025-12-31",
      observations,
      periodsPerYear: crypto ? 365 : 252,
      ...over,
    });

  it.each([
    ["seriesStart", { seriesStart: "garbage" }],
    ["seriesEnd", { seriesEnd: "2026-13-99" }],
  ])("a malformed %s is unreadable, withheld by every verdict", (_n, over) => {
    const rec = bad(over);
    expect(rec.unreadable).toBe(true);
    expect(rec.spanDays).toBeNull();
    expect(recordClears(rec)).toBe(false);
    expect(gateAnnualized(rec)).toBe("withheld");
    expect(gateAnnualized(rec, 400)).toBe("withheld");
    expect(gateDelta(rec, rec, 400)).toBe("withheld");
    expect(gateRollingWindow(rec, daily(400), { rows: 30 }, true)).toMatchObject({ state: "withheld", cause: "gate" });
  });

  it("a non-crypto record with a stored count that clears is still withheld when its dates are unreadable", () => {
    expect(gateAnnualized(bad({ seriesEnd: "garbage" }, false, 500))).toBe("withheld");
  });

  it.each([null, undefined, ""])("an absent %j end keeps today's unknown behaviour", (absent) => {
    const rec = bad({ seriesEnd: absent });
    expect(rec.unreadable).toBeUndefined();
    expect(recordClears(rec)).toBeNull();
    expect(gateAnnualized(rec)).toBe("null");
  });

  it("no reason text for an unreadable record prints an invented length", () => {
    const rec: FigureRecord = bad({ seriesStart: "garbage" });
    const texts = [
      withheldReason("record", rec),
      withheldReason("blend", rec),
      withheldCellTitle(rec),
      ...(["delta", "overlap", "rolling", "rolling-record", "half"] as const).map((k) => widenedWithheldReason(k, rec)),
    ];
    for (const t of texts) {
      expect(t).toContain("could not be read");
      expect(t).not.toMatch(/covers|so far|\bhas\b|0 days?\b/);
    }
  });
});

describe("rollingCalendarStats: a span that is not a number emits no point", () => {
  const n = 400;
  const rets = Array.from({ length: n }, (_, i) => 0.001 + Math.sin(i * 0.37) * 0.011);

  it("a malformed first date emits nothing at all", () => {
    const dates = daily(n);
    dates[0] = "garbage";
    const out = rollingCalendarStats(rets, dates, 365, 365);
    expect(out.vol.every((v) => v === null)).toBe(true);
    expect(out.sharpe.every((v) => v === null)).toBe(true);
  });

  it("a malformed last date emits no point there, while the readable points before it stay", () => {
    const clean = rollingCalendarStats(rets, daily(n), 365, 365);
    expect(clean.sharpe[n - 2]).not.toBeNull();
    const dates = daily(n);
    dates[n - 1] = "garbage";
    const out = rollingCalendarStats(rets, dates, 365, 365);
    expect(out.sharpe[n - 1]).toBeNull();
    expect(out.vol[n - 1]).toBeNull();
    expect(out.sharpe[n - 2]).toBe(clean.sharpe[n - 2]);
  });

  it("a malformed date at the window start emits no point once the window reaches it (the drop loop cannot step over it)", () => {
    const dates = daily(n);
    dates[20] = "garbage";
    const out = rollingCalendarStats(rets, dates, 365, 365);
    // The window start reaches index 20 at i = 385; from there the span is NaN, so nothing
    // is drawn from a window whose own start cannot be dated. Earlier points are untouched.
    expect(out.sharpe[364]).not.toBeNull();
    expect(out.sharpe.slice(385).every((v) => v === null)).toBe(true);
    expect(out.vol.slice(385).every((v) => v === null)).toBe(true);
  });
});

describe("buildComparatorBlock: a span that is not a number withholds, never shows without a note", () => {
  const n = 400;
  const strat = Array.from({ length: n }, (_, i) => 0.001 + Math.sin(i * 0.37) * 0.011 + Math.cos(i * 0.11) * 0.005);
  const bench = Array.from({ length: n }, (_, i) => Math.cos(i * 0.53) * 0.02 + Math.sin(i * 0.07) * 0.004);
  const goodDates = daily(n);
  const record = figureRecord({ seriesStart: goodDates[0], seriesEnd: goodDates[n - 1], observations: null, periodsPerYear: 365 });
  const build = (dates: string[], rec: FigureRecord | null) =>
    buildComparatorBlock("BTC-USD", "BTC", bench, strat, cumEq(strat), dates, 0.5, 30, 60, 365, 365, null, rec);

  it("control: readable dates keep the five annualized benchmark cells and the joint", () => {
    const block = build(goodDates, record);
    for (const k of ["cagr", "ann_vol", "sharpe", "sortino", "calmar"] as const) {
      expect(Number.isFinite(block.summary![k] as number), k).toBe(true);
    }
    expect(Number.isFinite(block.joint!.alpha)).toBe(true);
    expect(block.jointAnnualization).toBeUndefined();
  });

  it("an unreadable covered span dashes the benchmark's annualized cells (NaN), keeping cum_ret and max_dd", () => {
    const dates = [...goodDates];
    dates[0] = "garbage";
    const block = build(dates, record);
    for (const k of ["cagr", "ann_vol", "sharpe", "sortino", "calmar"] as const) {
      expect(block.summary![k], k).toBeNaN();
    }
    expect(Number.isFinite(block.summary!.max_dd as number)).toBe(true);
  });

  it("control: readable dates build the vol-matched curve and label, and carry no unreadable marker", () => {
    const block = build(goodDates, record);
    expect(block.volMatched).not.toBeNull();
    expect(block.volMatchedLabel).toMatch(/^BTC × \d/);
    expect(block.coveredSpanUnreadable).toBeUndefined();
  });

  it("R5 SFH-M2: an unreadable covered span builds NO vol-matched curve or label from the withheld vol, and says so with the marker", () => {
    const dates = [...goodDates];
    dates[0] = "garbage";
    const block = build(dates, record);
    // The vol that scales the curve is the benchmark's own, which the column shows as a dash.
    expect(block.summary!.ann_vol).toBeNaN();
    expect(block.volMatched).toBeNull();
    expect(block.volMatchedLabel).toBeNull();
    expect(block.coveredSpanUnreadable).toBe(true);
  });

  it("an unreadable overlap withholds alpha, IR, TE and Treynor with the unreadable marker, even with a cleared record", () => {
    const dates = [...goodDates];
    dates[n - 1] = "garbage";
    const block = build(dates, record);
    for (const k of ["alpha", "info_ratio", "tracking_error", "treynor"] as const) {
      expect(block.joint![k], k).toBeNaN();
    }
    expect(block.jointAnnualization).toEqual({ state: "withheld", days: 0, unreadable: true });
  });

  it("an unreadable overlap withholds with NO record at all too (a present malformed date is not unknown)", () => {
    const dates = [...goodDates];
    dates[n - 1] = "garbage";
    const block = build(dates, null);
    expect(block.joint!.alpha).toBeNaN();
    expect(block.jointAnnualization?.unreadable).toBe(true);
  });

  it("a record under the minimum keeps its own reason (no unreadable marker) even over an unreadable overlap", () => {
    const dates = daily(60);
    dates[59] = "garbage";
    const short = figureRecord({ seriesStart: "2024-01-01", seriesEnd: "2024-02-29", observations: null, periodsPerYear: 365 });
    const block = buildComparatorBlock("BTC-USD", "BTC", bench.slice(0, 60), strat.slice(0, 60), cumEq(strat.slice(0, 60)), dates, 0.5, 30, 60, 365, 365, null, short);
    expect(block.jointAnnualization).toEqual({ state: "withheld", days: 0 });
  });
});
