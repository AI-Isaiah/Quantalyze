import { describe, it, expect } from "vitest";
import { compute } from "./compute";

/**
 * Phase 169.1 plan 03 (D-36, W1): compute()'s conventions argument.
 *
 * The first describe block FREEZES compute()'s output with no fifth argument,
 * taken from the compute() that existed BEFORE the conventions argument was
 * added. Its inline snapshots were written once by vitest against the unedited
 * compute.ts and committed alone. They are the pre-change values, so a later
 * edit that moves any default figure fails here.
 *
 * APPEND-ONLY: never run `-u` on this file, never edit a frozen line. New cases
 * go below the frozen block.
 */

const P = 365;

/** ISO dates from 2024-01-01, skipping the given day offsets. */
function isoDays(count: number, skip: ReadonlySet<number> = new Set()): string[] {
  const out: string[] = [];
  for (let d = 0; out.length < count; d++) {
    if (skip.has(d)) continue;
    out.push(new Date(Date.UTC(2024, 0, 1 + d)).toISOString().slice(0, 10));
  }
  return out;
}

/** A deterministic return with an upward drift, real losses and a drawdown. */
const baseReturn = (i: number): number =>
  0.0006 + 0.009 * Math.sin(i * 0.7) + 0.004 * Math.cos(i * 1.9);

// Fixture A: a trending series, every calendar day present.
const TREND_RETS = Array.from({ length: 30 }, (_, i) => baseReturn(i));
const TREND_DATES = isoDays(30);

// Fixture B: the same shape with zero-return days (every fifth day flat).
const ZERO_RETS = Array.from({ length: 30 }, (_, i) => (i % 5 === 3 ? 0 : baseReturn(i)));
const ZERO_DATES = isoDays(30);

// Fixture C: interior calendar gaps (six calendar days absent).
const GAP_SKIP = new Set([4, 9, 10, 17, 22, 23]);
const GAP_RETS = Array.from({ length: 30 }, (_, i) => baseReturn(i + 3));
const GAP_DATES = isoDays(30, GAP_SKIP);

describe("compute() with no conventions argument is byte-identical to the pre-change compute() (D-36, W1, FROZEN)", () => {
  it("fixture A: a trending series", () => {
    expect(compute(TREND_RETS, TREND_DATES, 0, P)).toMatchInlineSnapshot(`
      {
        "ann_vol": 0.13018299107383202,
        "avg_loss": -0.006055680613517227,
        "avg_win": 0.005933744477927336,
        "best_day": 0.013335760777443011,
        "best_month": 0.0339892190644242,
        "best_quarter": 0.0339892190644242,
        "best_week": 0.020162638186289605,
        "best_year": 0.0339892190644242,
        "cagr": 0.5234445469627809,
        "calmar": 20.27835940200425,
        "common_sense_ratio": 1.5342570191507563,
        "cum_ret": 0.0339892190644242,
        "cvar95": -0.011901035706018574,
        "dd": [
          0,
          0,
          0,
          0,
          0,
          -0.006545737673992136,
          -0.012178840397557122,
          -0.01738572161701324,
          -0.025812963296776625,
          -0.025773909288145713,
          -0.015576004922060682,
          -0.008047477426619487,
          -0.002561909877499491,
          0,
          -0.002284901494851499,
          -0.01347511734117346,
          -0.019498117162991546,
          -0.021878000012257592,
          -0.024660232876583033,
          -0.018307961107965953,
          -0.005216350920181578,
          0,
          0,
          0,
          -0.007575660598421519,
          -0.01938653809716162,
          -0.02159331457889002,
          -0.018562634247952126,
          -0.015791912146644327,
          -0.005927983413284932,
        ],
        "end": "2024-01-30",
        "eq": [
          1.0046,
          1.0097282830019065,
          1.016094798267676,
          1.0279909673469378,
          1.032740216454629,
          1.0259801699123352,
          1.0201626381862896,
          1.014785282548655,
          1.0060821311521806,
          1.0061224637975075,
          1.0166542497599218,
          1.0244292628751483,
          1.030094429093203,
          1.0374113584002396,
          1.035040975636655,
          1.0234321186147302,
          1.0171837901879335,
          1.014714872688443,
          1.0118285527132773,
          1.0184184715976858,
          1.0319998567062416,
          1.0380420565815642,
          1.0391129810752442,
          1.040155242086756,
          1.0322753790030377,
          1.0199902328590786,
          1.017694842733495,
          1.0208472207668093,
          1.0237292018848503,
          1.0339892190644242,
        ],
        "kurt": -0.9577449530401743,
        "longest_dd": 8,
        "max_dd": -0.025812963296776625,
        "mtd": 0.0339892190644242,
        "n": 30,
        "omega_ratio": 1.4697962598990828,
        "p1y": null,
        "p3m": null,
        "p3y": null,
        "p5y": null,
        "p6m": null,
        "pain_index": 0.010268042949934124,
        "profit_factor": 1.4697962598990828,
        "recovery_factor": 1.3167499861849872,
        "sharpe": 3.190590934087568,
        "skew": -0.1731354262707745,
        "sortino": 5.019977944237869,
        "start": "2024-01-01",
        "tail_ratio": 1.0438569351483447,
        "ulcer_index": 0.013763131046560571,
        "var95": -0.011215842942627662,
        "win_rate": 0.6,
        "worst_day": -0.011901035706018574,
        "worst_month": 0.0339892190644242,
        "worst_quarter": 0.0339892190644242,
        "worst_week": -0.010806819271300228,
        "worst_year": 0.0339892190644242,
        "yearly": {
          "2024": 0.0339892190644242,
        },
        "years": 0.07939767282683094,
        "ytd": 0.0339892190644242,
      }
    `);
  });

  it("fixture B: a series with zero-return days", () => {
    expect(compute(ZERO_RETS, ZERO_DATES, 0, P)).toMatchInlineSnapshot(`
      {
        "ann_vol": 0.11757149566205052,
        "avg_loss": -0.006124735564049107,
        "avg_win": 0.0060121675145779095,
        "best_day": 0.013335760777443011,
        "best_month": 0.022598300507845392,
        "best_quarter": 0.022598300507845392,
        "best_week": 0.018470252571972434,
        "best_year": 0.022598300507845392,
        "cagr": 0.32505419329474794,
        "calmar": 14.857582645243307,
        "common_sense_ratio": 1.2825993784842245,
        "cum_ret": 0.022598300507845392,
        "cvar95": -0.011901035706018574,
        "dd": [
          0,
          0,
          0,
          0,
          0,
          -0.006545737673992247,
          -0.012178840397557233,
          -0.01738572161701346,
          -0.01738572161701346,
          -0.017346329770209112,
          -0.007060208048028982,
          0,
          0,
          0,
          -0.002284901494851388,
          -0.01347511734117346,
          -0.019498117162991324,
          -0.02187800001225737,
          -0.02187800001225737,
          -0.015507607892278008,
          -0.002378652863916919,
          0,
          0,
          0,
          -0.00757566059842163,
          -0.019386538097161732,
          -0.021593314578890133,
          -0.018562634247952126,
          -0.018562634247952126,
          -0.008726474241231519,
        ],
        "end": "2024-01-30",
        "eq": [
          1.0046,
          1.0097282830019065,
          1.016094798267676,
          1.016094798267676,
          1.0207890878745747,
          1.014107270284874,
          1.0083570604937822,
          1.0030419329631022,
          1.0030419329631022,
          1.0030821437304713,
          1.0135821045410225,
          1.0213336229731997,
          1.026981670083834,
          1.026981670083834,
          1.0246351181306743,
          1.01314297157222,
          1.0069574611562948,
          1.0045133650931517,
          1.0045133650931517,
          1.011055641031617,
          1.0245388371930988,
          1.0305373539507552,
          1.0316005360126,
          1.0316005360126,
          1.0237854804786186,
          1.0116013729201392,
          1.0093248611187282,
          1.0124513125726067,
          1.0124513125726067,
          1.0225983005078454,
        ],
        "kurt": -0.5121819307317383,
        "longest_dd": 7,
        "max_dd": -0.02187800001225737,
        "mtd": 0.022598300507845392,
        "n": 30,
        "omega_ratio": 1.374269049232962,
        "p1y": null,
        "p3m": null,
        "p3y": null,
        "p5y": null,
        "p6m": null,
        "pain_index": 0.008973673730504986,
        "profit_factor": 1.374269049232962,
        "recovery_factor": 1.0329235074131304,
        "sharpe": 2.3721427668612827,
        "skew": -0.11360716852722538,
        "sortino": 3.645527545583594,
        "start": "2024-01-01",
        "tail_ratio": 0.9332956884971672,
        "ulcer_index": 0.012358056506158052,
        "var95": -0.011215842942627662,
        "win_rate": 0.4666666666666667,
        "worst_day": -0.011901035706018574,
        "worst_month": 0.022598300507845392,
        "worst_quarter": 0.022598300507845392,
        "worst_week": -0.011798015049978794,
        "worst_year": 0.022598300507845392,
        "yearly": {
          "2024": 0.022598300507845392,
        },
        "years": 0.07939767282683094,
        "ytd": 0.022598300507845392,
      }
    `);
  });

  it("fixture C: a series with interior calendar gaps", () => {
    expect(compute(GAP_RETS, GAP_DATES, 0, P)).toMatchInlineSnapshot(`
      {
        "ann_vol": 0.13434996646165637,
        "avg_loss": -0.005955826733994135,
        "avg_win": 0.006052683745174569,
        "best_day": 0.013335760777443011,
        "best_month": 0.020254801874638906,
        "best_quarter": 0.025026681312998678,
        "best_week": 0.031139830713601935,
        "best_year": 0.025026681312998678,
        "cagr": 0.29428276694257405,
        "calmar": 11.400580536188231,
        "common_sense_ratio": 1.3898060302762072,
        "cum_ret": 0.025026681312998678,
        "cvar95": -0.011901035706018574,
        "dd": [
          0,
          0,
          -0.006545737673992025,
          -0.012178840397557011,
          -0.01738572161701324,
          -0.025812963296776736,
          -0.025773909288145935,
          -0.015576004922060793,
          -0.008047477426619487,
          -0.002561909877499602,
          0,
          -0.002284901494851388,
          -0.01347511734117346,
          -0.019498117162991324,
          -0.02187800001225748,
          -0.02466023287658292,
          -0.018307961107965842,
          -0.005216350920181356,
          0,
          0,
          0,
          -0.007575660598421741,
          -0.019386538097161732,
          -0.02159331457889002,
          -0.018562634247952015,
          -0.015791912146644438,
          -0.005927983413285154,
          0,
          0,
          -0.004757580179717058,
        ],
        "end": "2024-02-05",
        "eq": [
          1.0117077354391966,
          1.0163817571109817,
          1.009728788752302,
          1.0040034059081384,
          0.9987112268252394,
          0.9901459321191625,
          0.9901856259010768,
          1.0005505898595282,
          1.0082024478638032,
          1.0137778786481286,
          1.020978908827115,
          1.0186460725921243,
          1.0072210982278065,
          1.001071742441861,
          0.9986419322472808,
          0.9958013311733589,
          1.0022868666722549,
          1.015653124556569,
          1.0215996168382182,
          1.0226535780389898,
          1.023679329783107,
          1.0159242826190504,
          1.0038337314569898,
          1.001574699987193,
          1.0046771447971545,
          1.0075134757408364,
          1.01761097569563,
          1.0295469093660676,
          1.0299266398814613,
          1.0250266813129987,
        ],
        "kurt": -1.0307006085452965,
        "longest_dd": 8,
        "max_dd": -0.025812963296776736,
        "mtd": 0.020254801874638906,
        "n": 30,
        "omega_ratio": 1.3289587370435494,
        "p1y": null,
        "p3m": null,
        "p3y": null,
        "p5y": null,
        "p6m": null,
        "pain_index": 0.010426628955924692,
        "profit_factor": 1.3289587370435494,
        "recovery_factor": 0.9695392592187879,
        "sharpe": 2.3065394136537356,
        "skew": 0.036844507138638946,
        "sortino": 3.6720722932906,
        "start": "2024-01-01",
        "tail_ratio": 1.0457856903578668,
        "ulcer_index": 0.013790513472807341,
        "var95": -0.011215842942627662,
        "win_rate": 0.5666666666666667,
        "worst_day": -0.011901035706018574,
        "worst_month": 0.004677144797154531,
        "worst_quarter": 0.025026681312998678,
        "worst_week": -0.018307961107965953,
        "worst_year": 0.025026681312998678,
        "yearly": {
          "2024": 0.025026681312998678,
        },
        "years": 0.09582477754962354,
        "ytd": 0.025026681312998678,
      }
    `);
  });
});

// ---------------------------------------------------------------------------
// Appended below the frozen block (Phase 169.1 plan 03, Task 3). The imports
// sit here, not at the top, so the frozen block's lines stay untouched; ES
// imports are hoisted, so their position does not matter.
// ---------------------------------------------------------------------------
import { arithmeticUnderwater, metricsBasisSeries, type ComputeConventions } from "./compute";
import { BASIS_KPI_MAP } from "./basis-metrics";

const sumOf = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const DAY_MS = 86_400_000;
const calendarDaysInclusive = (dates: string[]) =>
  Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / DAY_MS) + 1;
const withConv = (rets: number[], dates: string[], c: ComputeConventions) => compute(rets, dates, 0, P, c);

/** The zero-days fixture's non-zero returns and their dates. */
const ACTIVE_RETS = ZERO_RETS.filter((r) => r !== 0);
const ACTIVE_DATES = ZERO_DATES.filter((_, i) => ZERO_RETS[i] !== 0);

describe("metricsBasisSeries: the series the headline risk statistics run over (D-30, D-36)", () => {
  it("under the active basis: exactly the non-zero finite returns, with null positions on the zero days", () => {
    const b = metricsBasisSeries(ZERO_RETS, ZERO_DATES, { dayBasis: "active" });
    expect(b.returns).toEqual(ACTIVE_RETS);
    expect(b.returns.length).toBe(24);
    ZERO_RETS.forEach((r, i) => {
      const pos = b.positions[i];
      if (r === 0) expect(pos, `day ${i}`).toBeNull();
      else expect(b.returns[pos as number], `day ${i}`).toBe(r);
    });
  });

  it("with no conventions (and on the calendar basis): rets itself, identity positions", () => {
    for (const c of [undefined, { dayBasis: "calendar" } as const]) {
      const b = metricsBasisSeries(ZERO_RETS, ZERO_DATES, c);
      expect(b.returns).toBe(ZERO_RETS);
      expect(b.positions).toEqual(ZERO_RETS.map((_, i) => i));
    }
  });
});

describe("the active day basis moves ONLY ann_vol, sharpe, sortino and the arithmetic CAGR (D-30, D-36 W2)", () => {
  const plain = compute(ZERO_RETS, ZERO_DATES, 0, P);
  const activeOnly = compute(ACTIVE_RETS, ACTIVE_DATES, 0, P);

  for (const method of ["geometric", "arithmetic"] as const) {
    it(`${method}: skew, kurt, var95, cvar95, win_rate and profit_factor keep all returns, zero days included`, () => {
      const r = withConv(ZERO_RETS, ZERO_DATES, { cumulativeMethod: method, dayBasis: "active" });
      for (const k of ["skew", "kurt", "var95", "cvar95", "win_rate", "profit_factor"] as const) {
        expect(r[k], k).toBe(plain[k]);
      }
    });

    it(`${method}: ann_vol, sharpe and sortino equal compute() of the non-zero returns alone`, () => {
      const r = withConv(ZERO_RETS, ZERO_DATES, { cumulativeMethod: method, dayBasis: "active" });
      expect(r.ann_vol).toBe(activeOnly.ann_vol);
      expect(r.sharpe).toBe(activeOnly.sharpe);
      expect(r.sortino).toBeCloseTo(activeOnly.sortino, 12);
      // and they are not the calendar figures (the zero days really dilute them here)
      expect(r.ann_vol).not.toBe(plain.ann_vol);
      expect(r.sharpe).not.toBe(plain.sharpe);
    });
  }

  it("arithmetic: the CAGR is the mean of the non-zero returns times periodsPerYear", () => {
    const r = withConv(ZERO_RETS, ZERO_DATES, { cumulativeMethod: "arithmetic", dayBasis: "active" });
    expect(r.cagr).toBeCloseTo((sumOf(ACTIVE_RETS) / ACTIVE_RETS.length) * P, 12);
  });

  it("geometric: the day basis does not move the CAGR (the engine's is a calendar-span compound)", () => {
    const r = withConv(ZERO_RETS, ZERO_DATES, { dayBasis: "active" });
    expect(r.cagr).toBe(plain.cagr);
  });

  it("an active basis with no non-zero day has no arithmetic CAGR (NaN, the engine's None), never a measured 0", () => {
    const flat = Array.from({ length: 10 }, () => 0);
    const r = withConv(flat, isoDays(10), { cumulativeMethod: "arithmetic", dayBasis: "active" });
    expect(Number.isNaN(r.cagr)).toBe(true);
  });
});

describe("the arithmetic method rides the running-sum curves (D-28)", () => {
  const r = withConv(TREND_RETS, TREND_DATES, { cumulativeMethod: "arithmetic" });

  it("cum_ret is the sum of the returns and the arithmetic equity's rise", () => {
    expect(r.cum_ret).toBeCloseTo(sumOf(TREND_RETS), 14);
    expect(r.cum_ret).toBe(r.eq[r.eq.length - 1] - 1);
  });

  it("dd is arithmeticUnderwater(rets); max_dd is its minimum; calmar is cagr / |max_dd|", () => {
    expect(r.dd).toEqual(arithmeticUnderwater(TREND_RETS));
    expect(r.max_dd).toBe(Math.min(...r.dd));
    expect(r.calmar).toBe(r.cagr / Math.abs(r.max_dd));
    // the geometric drawdown is a different number on this fixture
    expect(r.max_dd).not.toBe(compute(TREND_RETS, TREND_DATES, 0, P).max_dd);
  });

  it("longest_dd and recovery_factor follow the arithmetic dd", () => {
    let longest = 0;
    let run = 0;
    for (const v of r.dd) {
      run = v < 0 ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    expect(r.longest_dd).toBe(longest);
    expect(r.recovery_factor).toBe(r.cum_ret / Math.abs(r.max_dd));
  });
});

describe("the arithmetic calendar-basis CAGR divides by the right day count (D-30)", () => {
  it("calendarDense: the sum over the CALENDAR-day count times P", () => {
    const r = withConv(GAP_RETS, GAP_DATES, { cumulativeMethod: "arithmetic", calendarDense: true });
    const days = calendarDaysInclusive(GAP_DATES);
    expect(days).toBe(36);
    expect(r.cagr).toBeCloseTo((sumOf(GAP_RETS) / days) * P, 12);
  });

  it("calendarDense: a sparse series equals its twin with every missing day filled with 0.0 (gap-day invariance)", () => {
    const dense = isoDays(calendarDaysInclusive(GAP_DATES));
    const byDate = new Map(GAP_DATES.map((d, i) => [d, GAP_RETS[i]]));
    const denseRets = dense.map((d) => byDate.get(d) ?? 0);
    const c = { cumulativeMethod: "arithmetic", calendarDense: true } as const;
    const sparse = withConv(GAP_RETS, GAP_DATES, c);
    const twin = withConv(denseRets, dense, c);
    expect(sparse.cagr).toBeCloseTo(twin.cagr, 14);
    expect(sparse.cum_ret).toBeCloseTo(twin.cum_ret, 14);
    expect(sparse.max_dd).toBeCloseTo(twin.max_dd, 14);
  });

  it("not calendarDense (a single-key series): the sum over the OBSERVATION count times P", () => {
    const r = withConv(GAP_RETS, GAP_DATES, { cumulativeMethod: "arithmetic" });
    expect(r.cagr).toBeCloseTo((sumOf(GAP_RETS) / GAP_RETS.length) * P, 12);
  });
});

describe("every strip key either arm changes is overlaid on a composite's full-history strip (T-169-47)", () => {
  const MAP = new Set(BASIS_KPI_MAP.map((e) => e.tsKey));
  // The drawdown-derived extended metrics move with the arithmetic drawdown by
  // design (D-28, stated consequence); they are rail figures, not strip keys.
  const DRAWDOWN_DERIVED = new Set(["longest_dd", "recovery_factor", "pain_index", "ulcer_index"]);
  // Phase 169.1 D-31 (plan 169.1-05): the calendar windows and buckets SUM under
  // the arithmetic method, as the engine's do; they are rail rows (hidden while
  // a range is selected, D-27), never strip keys.
  const CALENDAR_SUMS = new Set([
    "mtd", "ytd", "p3m", "p6m", "p1y", "p3y", "p5y",
    "best_week", "worst_week", "best_month", "worst_month",
    "best_quarter", "worst_quarter", "best_year", "worst_year", "yearly",
  ]);
  const changed = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    Object.keys(a)
      .filter((k) => k !== "eq" && k !== "dd")
      .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      .sort();

  it("the active basis changes exactly ann_vol, sharpe and sortino, all in BASIS_KPI_MAP", () => {
    const base = compute(ZERO_RETS, ZERO_DATES, 0, P);
    const keys = changed(withConv(ZERO_RETS, ZERO_DATES, { dayBasis: "active" }), base);
    expect(keys).toEqual(["ann_vol", "sharpe", "sortino"]);
    for (const k of keys) expect(MAP.has(k), k).toBe(true);
  });

  it("the arithmetic arm changes cum_ret, cagr, max_dd and calmar (all in BASIS_KPI_MAP) and otherwise only drawdown-derived and D-31 calendar rail figures", () => {
    const base = compute(TREND_RETS, TREND_DATES, 0, P);
    const keys = changed(withConv(TREND_RETS, TREND_DATES, { cumulativeMethod: "arithmetic" }), base);
    expect(keys.filter((k) => MAP.has(k))).toEqual(["cagr", "calmar", "cum_ret", "max_dd"]);
    for (const k of keys.filter((k) => !MAP.has(k))) expect(DRAWDOWN_DERIVED.has(k) || CALENDAR_SUMS.has(k), k).toBe(true);
  });
});
