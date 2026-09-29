import { describe, it, expect } from "vitest";
import { compute } from "./compute";

describe("compute — QuantStats metrics extension", () => {
  // 30-day toy series: alternating +1% and −0.5% — net positive drift.
  const rets = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.005));
  const dates = Array.from({ length: 30 }, (_, i) =>
    new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
  );
  const r = compute(rets, dates);

  it("recovery_factor = cum_ret / |max_dd| when drawdown observed", () => {
    expect(r.recovery_factor).not.toBeNull();
    expect(r.recovery_factor).toBeCloseTo(r.cum_ret / Math.abs(r.max_dd), 6);
  });

  it("pain_index >= 0 (mean of |drawdown|)", () => {
    expect(r.pain_index).toBeGreaterThanOrEqual(0);
  });

  it("ulcer_index >= pain_index when drawdowns are uneven (RMS amplifies tails)", () => {
    expect(r.ulcer_index).toBeGreaterThanOrEqual(r.pain_index - 1e-12);
  });

  it("tail_ratio is finite and non-negative when a left tail exists", () => {
    expect(r.tail_ratio).not.toBeNull();
    expect(Number.isFinite(r.tail_ratio!)).toBe(true);
    expect(r.tail_ratio!).toBeGreaterThanOrEqual(0);
  });

  it("omega_ratio matches profit_factor at threshold=0 (both are win/loss sums)", () => {
    expect(r.omega_ratio).toBeCloseTo(r.profit_factor, 8);
  });

  it("common_sense_ratio = tail_ratio × profit_factor", () => {
    expect(r.common_sense_ratio).toBeCloseTo(r.tail_ratio! * r.profit_factor, 8);
  });

  it("all-zero series → null for ratios whose denominator is 0 (no NaN sentinel)", () => {
    // No drawdown → recovery_factor undefined. No losses → omega undefined.
    // P5 = 0 → tail_ratio undefined. common_sense propagates null.
    const zeros = Array.from({ length: 30 }, () => 0);
    const zr = compute(zeros, dates);
    expect(zr.recovery_factor).toBeNull();
    expect(zr.tail_ratio).toBeNull();
    expect(zr.omega_ratio).toBeNull();
    expect(zr.common_sense_ratio).toBeNull();
    // pain/ulcer have no denominator → still defined and zero.
    expect(zr.pain_index).toBe(0);
    expect(zr.ulcer_index).toBe(0);
  });

  it("all-positive series → tail_ratio is null (no left tail to compare against)", () => {
    // Regression for the |P95/P5| sign bug — when P5 ≥ 0 the ratio is
    // gain/gain and has no risk-asymmetry meaning. Must surface null,
    // not a finite number that allocators would misread as "right-tail dominance".
    const pos = Array.from({ length: 30 }, () => 0.01);
    const pr = compute(pos, dates);
    expect(pr.tail_ratio).toBeNull();
    expect(pr.omega_ratio).toBeNull(); // no losses either
    expect(pr.common_sense_ratio).toBeNull();
    // Strictly-monotone series → no drawdown → recovery_factor null.
    expect(pr.recovery_factor).toBeNull();
  });
});

describe("compute — #597 asset-class annualization (periodsPerYear)", () => {
  const rets = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 0.012 : -0.006));
  const dates = Array.from({ length: 60 }, (_, i) =>
    new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10),
  );

  it("default param == explicit 252 (byte-identical to the pre-#597 hardcode)", () => {
    const def = compute(rets, dates);
    const explicit = compute(rets, dates, 0, 252);
    expect(explicit.sharpe).toBe(def.sharpe);
    expect(explicit.sortino).toBe(def.sortino);
    expect(explicit.ann_vol).toBe(def.ann_vol);
  });

  it("crypto (365) scales vol/Sharpe/Sortino by √(365/252) vs 252; CAGR & maxDD invariant", () => {
    const trad = compute(rets, dates, 0, 252);
    const crypto = compute(rets, dates, 0, 365);
    const k = Math.sqrt(365 / 252);
    // annVol ∝ √N.
    expect(crypto.ann_vol).toBeCloseTo(trad.ann_vol * k, 10);
    // Sharpe = mean·N / (s·√N) = mean·√N / s ∝ √N.
    expect(crypto.sharpe!).toBeCloseTo(trad.sharpe! * k, 10);
    expect(crypto.sortino!).toBeCloseTo(trad.sortino! * k, 10);
    // CAGR is calendar-based (days/365.25) — asset-class-invariant.
    expect(crypto.cagr).toBe(trad.cagr);
    // Max drawdown has no annualization term.
    expect(crypto.max_dd).toBe(trad.max_dd);
  });
});

/**
 * Phase 169 D-11 (SC6): ONE calendar coverage rule for every return window.
 *
 * A window with cutoff C is shown only when the record covers it: the first
 * observation date is on or before C plus one UTC day. Otherwise it is null,
 * which the factsheet renders as the em-dash (MTD / YTD / 3M) or omits as a row
 * (6M / 1Y / 3Y / 5Y, D-17 and D-57, plan 169-05).
 *
 * WHY this matters: before D-11 every window compounded "whatever lies after
 * the cutoff", which for a record shorter than the window is the WHOLE record.
 * A 5-month-old strategy therefore printed its since-inception return under a
 * "1 Year" label: a public, investment-grade claim about a year that was never
 * traded. Multi-year windows ride the CALENDAR (3x365 / 5x365 days), never an
 * observation count (3x252), because a 24/7 venue posts 365 bars a year.
 *
 * THE ORACLE IS NOT THE IMPLEMENTATION: cutoffs and the expected compounded
 * values are rebuilt here from `Date.UTC` day arithmetic, never by calling a
 * helper from compute.ts.
 */
describe("compute — 169 D-11 calendar coverage for every return window", () => {
  const DAY = 86_400_000;
  const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

  /** `count` consecutive UTC calendar days ending on `endIso`. */
  function dailyDatesEndingOn(endIso: string, count: number): string[] {
    const end = utc(endIso);
    return Array.from({ length: count }, (_, i) => ymd(end - (count - 1 - i) * DAY));
  }
  /** Deterministic, non-constant returns so a wrong slice moves the product. */
  const retsFor = (count: number) =>
    Array.from({ length: count }, (_, i) => 0.0008 + Math.sin(i * 0.37) * 0.004);

  /** Independent oracle: compound the returns dated strictly after `cutoffIso`. */
  function compoundAfter(rets: number[], dates: string[], cutoffIso: string): number {
    const c = utc(cutoffIso);
    let eq = 1;
    for (let i = 0; i < dates.length; i++) if (utc(dates[i]) > c) eq *= 1 + rets[i];
    return eq - 1;
  }

  const END = "2026-06-30";
  // Cutoffs for END, derived by hand and cross-checked against Date.UTC:
  //   MTD: last day of the previous month      -> 2026-05-31
  //   YTD: 31 Dec of the previous year          -> 2025-12-31
  //   3M / 6M / 1Y: END minus 90 / 182 / 365 d  -> 2026-04-01 / 2025-12-30 / 2025-06-30
  //   3Y / 5Y: END minus 1095 / 1825 days       -> 2023-07-01 / 2021-07-01
  const CUTOFF = {
    mtd: "2026-05-31",
    ytd: "2025-12-31",
    p3m: "2026-04-01",
    p6m: "2025-12-30",
    p1y: "2025-06-30",
    p3y: "2023-07-01",
    p5y: "2021-07-01",
  } as const;

  it("the oracle's cutoffs are the calendar offsets D-11 names (guards the test itself)", () => {
    const end = utc(END);
    expect(ymd(end - 90 * DAY)).toBe(CUTOFF.p3m);
    expect(ymd(end - 182 * DAY)).toBe(CUTOFF.p6m);
    expect(ymd(end - 365 * DAY)).toBe(CUTOFF.p1y);
    expect(ymd(end - 3 * 365 * DAY)).toBe(CUTOFF.p3y);
    expect(ymd(end - 5 * 365 * DAY)).toBe(CUTOFF.p5y);
  });

  it("a 0.45-year record (166 days) shows MTD and 3M, and nulls YTD, 6M, 1Y, 3Y and 5Y", () => {
    // Starts 2026-01-16: after 1 Jan (YTD) and after 31 Dec (6M), before 1 Jun
    // (MTD) and before 2 Apr (3M). Before D-11 the four long windows each
    // printed the whole-record return under their own label.
    const dates = dailyDatesEndingOn(END, 166);
    expect(dates[0]).toBe("2026-01-16");
    const rets = retsFor(166);
    const r = compute(rets, dates);

    expect(r.mtd).toBeCloseTo(compoundAfter(rets, dates, CUTOFF.mtd), 12);
    expect(r.p3m).toBeCloseTo(compoundAfter(rets, dates, CUTOFF.p3m), 12);
    expect(r.ytd).toBeNull();
    expect(r.p6m).toBeNull();
    expect(r.p1y).toBeNull();
    expect(r.p3y).toBeNull();
    expect(r.p5y).toBeNull();
    // The headline length is unchanged: still the calendar clock.
    expect(r.years).toBeCloseTo(165 / 365.25, 12);
  });

  it("a 6-year record shows every window, each the compounded return strictly after its cutoff", () => {
    const count = 6 * 365 + 2;
    const dates = dailyDatesEndingOn(END, count);
    const rets = retsFor(count);
    const r = compute(rets, dates);

    for (const key of ["mtd", "ytd", "p3m", "p6m", "p1y", "p3y", "p5y"] as const) {
      const got = r[key];
      expect(got, `${key} must be shown on a 6-year record`).not.toBeNull();
      expect(got, key).toBeCloseTo(compoundAfter(rets, dates, CUTOFF[key]), 12);
    }
    // A window value is a slice of the record, never the whole of it.
    expect(r.p1y).not.toBeCloseTo(r.cum_ret, 6);
  });

  it.each([
    { key: "mtd", covered: "2026-06-01", short: "2026-06-02" },
    { key: "ytd", covered: "2026-01-01", short: "2026-01-02" },
    { key: "p3m", covered: "2026-04-02", short: "2026-04-03" },
    { key: "p1y", covered: "2025-07-01", short: "2025-07-02" },
    { key: "p3y", covered: "2023-07-02", short: "2023-07-03" },
    { key: "p5y", covered: "2021-07-02", short: "2021-07-03" },
  ] as const)(
    "boundary $key on a 7-day venue: a record starting at cutoff + 1 day shows it, cutoff + 2 days nulls it",
    ({ key, covered, short }) => {
      // 169 review WR-02 (2026-09-29): these fixtures are consecutive calendar
      // days, i.e. a 24/7 venue, so they pass the 7-day basis (365) explicitly.
      // On that basis every day trades and "cutoff + 1 day" is exact. They used
      // the default basis (252) until the weekday calendar below existed; under
      // it two "short" starts here (Fri 2 Jan 2026 after the 1 Jan holiday, and
      // Mon 3 Jul 2023 after a Saturday cutoff) are covered weekday windows.
      const coveredCount = (utc(END) - utc(covered)) / DAY + 1;
      const coveredDates = dailyDatesEndingOn(END, coveredCount);
      expect(coveredDates[0]).toBe(covered);
      const coveredRets = retsFor(coveredCount);
      const shown = compute(coveredRets, coveredDates, 0, 365)[key];
      // Starting the day after the cutoff, the window IS the whole record.
      expect(shown).not.toBeNull();
      expect(shown).toBeCloseTo(compoundAfter(coveredRets, coveredDates, CUTOFF[key]), 12);

      const shortDates = dailyDatesEndingOn(END, coveredCount - 1);
      expect(shortDates[0]).toBe(short);
      expect(compute(retsFor(coveredCount - 1), shortDates, 0, 365)[key]).toBeNull();
    },
  );

  /**
   * 169 review WR-02 (2026-09-29): on a WEEKDAY venue (the 252 basis) the
   * window's first session is not always cutoff + 1 day. A weekend, 1 January
   * or 25 December between the cutoff and the record's first date is a day the
   * venue did not trade, so the record misses nothing by starting after it.
   *
   * WHY this matters: under "cutoff + 1 day" alone a weekday strategy launched
   * on Friday 2 January 2026 (1 January a Thursday holiday) showed YTD as the
   * em-dash for the whole of 2026 while "Since Inception" showed the same
   * period's return, and a Monday start after a Saturday cutoff dropped the
   * 3 Month / 3 Year / 5 Year rows the record supports.
   *
   * THE OTHER HALF MATTERS AS MUCH: a record that skipped a day the venue DID
   * trade is still not covering the window, so each case also pins the start one
   * trading day later as null, and the same dates on the 7-day basis as null.
   */
  describe("weekday venues (252 basis): non-trading days at the window start do not uncover it", () => {
    /** Weekdays from `startIso` to `endIso` inclusive, without 1 Jan and 25 Dec. */
    function weekdayDates(startIso: string, endIso: string): string[] {
      const out: string[] = [];
      for (let t = utc(startIso); t <= utc(endIso); t += DAY) {
        const iso = ymd(t);
        const dow = new Date(t).getUTCDay();
        if (dow === 0 || dow === 6 || iso.slice(5) === "01-01" || iso.slice(5) === "12-25") continue;
        out.push(iso);
      }
      return out;
    }
    const weekday = (iso: string) => new Date(utc(iso)).getUTCDay();

    it.each([
      // key, END, cutoff (hand-derived), first-session start, one trading day later, what lies between
      { key: "ytd", end: "2026-06-30", cutoff: "2025-12-31", covered: "2026-01-02", short: "2026-01-05", why: "Thu 1 Jan holiday" },
      { key: "mtd", end: "2026-02-27", cutoff: "2026-01-31", covered: "2026-02-02", short: "2026-02-03", why: "Sat cutoff, Sun 1 Feb" },
      { key: "p3m", end: "2026-06-26", cutoff: "2026-03-28", covered: "2026-03-30", short: "2026-03-31", why: "Sat cutoff, Sun" },
      { key: "p6m", end: "2026-06-24", cutoff: "2025-12-24", covered: "2025-12-26", short: "2025-12-29", why: "Thu 25 Dec holiday" },
      { key: "p1y", end: "2026-12-24", cutoff: "2025-12-24", covered: "2025-12-26", short: "2025-12-29", why: "Thu 25 Dec holiday" },
      { key: "p3y", end: "2026-06-23", cutoff: "2023-06-24", covered: "2023-06-26", short: "2023-06-27", why: "Sat cutoff, Sun" },
      { key: "p5y", end: "2026-06-25", cutoff: "2021-06-26", covered: "2021-06-28", short: "2021-06-29", why: "Sat cutoff, Sun" },
    ] as const)(
      "$key ($why): a record starting at the first session after the cutoff shows it; one trading day later nulls it",
      ({ key, end, cutoff, covered, short }) => {
        // Guard the fixture: every day strictly between the cutoff and `covered`
        // is a weekend or 1 Jan / 25 Dec, and `short` skipped a real weekday.
        for (let t = utc(cutoff) + DAY; t < utc(covered); t += DAY) {
          const iso = ymd(t);
          const closed = [0, 6].includes(new Date(t).getUTCDay()) || ["01-01", "12-25"].includes(iso.slice(5));
          expect(closed, `${iso} must be a non-trading day`).toBe(true);
        }
        expect([0, 6]).not.toContain(weekday(covered));

        const dates = weekdayDates(covered, end);
        expect(dates[0]).toBe(covered);
        const rets = retsFor(dates.length);
        const shown = compute(rets, dates, 0, 252)[key];
        expect(shown, `${key} is covered on a weekday venue`).not.toBeNull();
        // The window is the whole record, compounded strictly after the cutoff.
        expect(shown).toBeCloseTo(compoundAfter(rets, dates, cutoff), 12);
        // The 7-day rule is unchanged: the same dates on a 24/7 venue skipped days that traded.
        expect(compute(rets, dates, 0, 365)[key]).toBeNull();

        const shortDates = weekdayDates(short, end);
        expect(shortDates[0]).toBe(short);
        expect(compute(retsFor(shortDates.length), shortDates, 0, 252)[key]).toBeNull();
      },
    );

    it("a genuinely short weekday record (launched in March) still nulls YTD, 6 Month and 1 Year", () => {
      const dates = weekdayDates("2026-03-02", "2026-06-30");
      const r = compute(retsFor(dates.length), dates, 0, 252);
      expect(r.ytd).toBeNull();
      expect(r.p6m).toBeNull();
      expect(r.p1y).toBeNull();
      expect(r.p3y).toBeNull();
      expect(r.p5y).toBeNull();
      expect(r.mtd).not.toBeNull();
      expect(r.p3m).not.toBeNull();
    });

    it("known limit: only weekends, 1 Jan and 25 Dec are assumed closed — a start after any other holiday is the em-dash", () => {
      // Mon 1 Sep 2025 was US Labor Day, but many weekday venues trade that day,
      // so the rule does not assume it: a record starting Tue 2 Sep shows no
      // MTD for September rather than a month that may be missing a session.
      const dates = weekdayDates("2025-09-02", "2025-09-30");
      expect(compute(retsFor(dates.length), dates, 0, 252).mtd).toBeNull();
    });
  });

  it("3Y rides the calendar: 800 daily points (about 2.2 years) is NOT three years, though 800 > 3 x 252", () => {
    // The observation-clock error this replaces: 756 observations is three
    // years on a weekday venue and about two on a 24/7 one.
    const dates = dailyDatesEndingOn(END, 800);
    const r = compute(retsFor(800), dates);
    expect(r.p3y).toBeNull();
    expect(r.p5y).toBeNull();
    expect(r.p1y).not.toBeNull();
  });

  it("3Y rides the calendar the other way too: a sparse 4-year record with fewer than 756 points shows 3Y", () => {
    // Weekly points across ~4 calendar years: 209 observations, far under
    // 3 x 252, and the record still covers the whole 3-year window.
    const end = utc(END);
    const dates = Array.from({ length: 209 }, (_, i) => ymd(end - (208 - i) * 7 * DAY));
    const rets = retsFor(209);
    const r = compute(rets, dates);
    expect(r.p3y).not.toBeNull();
    expect(r.p3y).toBeCloseTo(compoundAfter(rets, dates, CUTOFF.p3y), 12);
    expect(r.p5y).toBeNull();
  });
});
