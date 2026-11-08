import { describe, it, expect } from "vitest";
import { buildComparatorBlock } from "./comparator-block";
import { cumEq } from "./compute";
import { jointMetrics, MIN_PAIRED_OBSERVATIONS } from "./joint";
import { figureRecord } from "@/lib/figure-gate";
import type { FigureRecord } from "@/lib/figure-gate";
import type { JointMetrics } from "./types";

/**
 * Phase 194 plan 21 (D-11 as superseded by D-15) - the factsheet's alpha, information ratio,
 * tracking error and Treynor are withheld (NaN, every reader prints a dash) ONLY when the
 * strategy's TOTAL record is under D-15's minimum. The paired overlap only qualifies the
 * figure (`short` under a year, values kept). Beta, correlation, R-squared and the captures
 * are not annualized and never move.
 *
 * Why each case matters: the gate sits in the one producer of these figures, so a case that
 * only looked at the overlap (the superseded 90-day rule) would withhold a 400-day record's
 * figure for pairing 60 days with a benchmark, which is the founder's D-15 saying the client
 * who zooms in or has a short overlap still wants the numbers. Expected values come from
 * `jointMetrics` called directly on the fixture, never from the block's own wiring.
 */

const DAY = 86_400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const START = "2024-01-01";
const daily = (n: number) => Array.from({ length: n }, (_, i) => addDays(START, i));
const strat = (n: number) => Array.from({ length: n }, (_, i) => 0.001 + Math.sin(i * 0.37) * 0.011 + Math.cos(i * 0.11) * 0.005);
const bench = (n: number) => Array.from({ length: n }, (_, i) => Math.cos(i * 0.53) * 0.02 + Math.sin(i * 0.07) * 0.004);

const FOUR = ["alpha", "info_ratio", "tracking_error", "treynor"] as const;
const UNTOUCHED = ["beta", "corr", "r2", "up_capture", "down_capture"] as const;

function build(
  dates: string[],
  s: number[],
  b: Array<number | null>,
  record: FigureRecord | null | undefined,
  ppy = 365,
) {
  return buildComparatorBlock("BTC-USD", "BTC", b, s, cumEq(s), dates, 0.5, 30, 60, ppy, ppy, null, record);
}

const cryptoRecord = (dates: string[]) =>
  figureRecord({ seriesStart: dates[0], seriesEnd: dates[dates.length - 1], observations: null, periodsPerYear: 365 });

function expectFourFinite(j: JointMetrics | null, ref: JointMetrics) {
  for (const k of FOUR) expect(j![k], k).toBe(ref[k]);
  for (const k of FOUR) expect(Number.isFinite(j![k]), k).toBe(true);
}

describe("crypto record covering 60 days (under the 90-day bound): withheld", () => {
  const dates = daily(60);
  const s = strat(60);
  const b = bench(60);
  const ref = jointMetrics(s, b, 0, 365);
  const block = build(dates, s, b, cryptoRecord(dates));

  it("alpha, information ratio, tracking error and Treynor are NaN", () => {
    for (const k of FOUR) expect(block.joint![k], k).toBeNaN();
  });
  it("beta, correlation, R-squared and the captures equal the ungated values (A-194-D11-03)", () => {
    for (const k of UNTOUCHED) expect(block.joint![k], k).toBe(ref[k]);
  });
  it("says so: jointAnnualization withheld, days = first to last paired date", () => {
    expect(block.jointAnnualization).toEqual({ state: "withheld", days: 60 });
    expect(block.jointWithheld).toBeNull();
  });
});

describe("D-15: a cleared 400-day record paired over only 60 dates keeps its values", () => {
  // The record is the strategy's 400-day history; the comparator pairs only the last 60 of
  // the block's dates. The superseded 90-day overlap rule would have had 59 < 90 withhold.
  const all = daily(400);
  const record = cryptoRecord(all);
  const dates = all.slice(340);
  const s = strat(60);
  const b = bench(60);
  const ref = jointMetrics(s, b, 0, 365);
  const block = build(dates, s, b, record);

  it("every joint value is finite and equals the ungated value", () => {
    expect(record.spanDays).toBe(400);
    expectFourFinite(block.joint, ref);
    for (const k of UNTOUCHED) expect(block.joint![k], k).toBe(ref[k]);
  });
  it("is short, over the paired span", () => {
    expect(block.jointAnnualization).toEqual({ state: "short", days: 60 });
  });
});

describe("non-crypto record: the count decides, the overlap qualifies", () => {
  // n observations spread over 84 calendar days (every ~1.4th day, as weekday trading is).
  const spread = (n: number) => Array.from({ length: n }, (_, i) => addDays(START, Math.floor((i * 84) / (n - 1))));
  const rec = (dates: string[], observations: number) =>
    figureRecord({ seriesStart: dates[0], seriesEnd: dates[dates.length - 1], observations, periodsPerYear: 252 });

  it("60 observations over 84 days, all paired: values kept, short, 85 days", () => {
    const dates = spread(60);
    expect(new Set(dates).size).toBe(60);
    const s = strat(60);
    const b = bench(60);
    const ref = jointMetrics(s, b, 0, 252);
    const block = build(dates, s, b, rec(dates, 60), 252);
    expectFourFinite(block.joint, ref);
    expect(block.jointAnnualization).toEqual({ state: "short", days: 85 });
  });

  it("59 observations over 84 days: withheld", () => {
    const dates = spread(59);
    const block = build(dates, strat(59), bench(59), rec(dates, 59), 252);
    for (const k of FOUR) expect(block.joint![k], k).toBeNaN();
    expect(block.jointAnnualization).toEqual({ state: "withheld", days: 85 });
  });
});

describe("the overlap span qualifies a cleared record", () => {
  it("200 paired dates: values kept, short over 200 days", () => {
    const dates = daily(200);
    const s = strat(200);
    const b = bench(200);
    const block = build(dates, s, b, cryptoRecord(dates));
    expectFourFinite(block.joint, jointMetrics(s, b, 0, 365));
    expect(block.jointAnnualization).toEqual({ state: "short", days: 200 });
  });

  it("400 paired dates on a 400-day record: full, no marker, joint identical to the ungated one", () => {
    const dates = daily(400);
    const s = strat(400);
    const b = bench(400);
    const block = build(dates, s, b, cryptoRecord(dates));
    expect("jointAnnualization" in block).toBe(false);
    expect(block.joint).toEqual(jointMetrics(s, b, 0, 365));
  });
});

describe("the unknown-record (null) state and the paired floor", () => {
  it("no record passed: no marker, joint identical to the ungated one (the superseded gate never fires)", () => {
    const dates = daily(60);
    const s = strat(60);
    const b = bench(60);
    for (const rec of [undefined, null]) {
      const block = build(dates, s, b, rec);
      expect("jointAnnualization" in block).toBe(false);
      expect(block.joint).toEqual(jointMetrics(s, b, 0, 365));
    }
  });

  it("fewer paired dates than the floor: joint null, jointWithheld set as before, no marker", () => {
    const dates = daily(60);
    // Only the first 9 dates pair with the comparator.
    const b = bench(60).map((v, i) => (i < MIN_PAIRED_OBSERVATIONS - 1 ? v : null));
    const block = build(dates, strat(60), b, cryptoRecord(dates));
    expect(block.joint).toBeNull();
    expect(block.jointWithheld).toEqual({ paired: MIN_PAIRED_OBSERVATIONS - 1, floor: MIN_PAIRED_OBSERVATIONS });
    expect("jointAnnualization" in block).toBe(false);
  });
});

describe("a flat strategy leg on the 60-day crypto record: the NaN set is the union of both gates", () => {
  const dates = daily(60);
  const flat = new Array(60).fill(0);
  const b = bench(60);
  const flatOnly = build(dates, flat, b, null);
  const both = build(dates, flat, b, cryptoRecord(dates));

  it("flatLeg is set and the marker says withheld", () => {
    expect(flatOnly.flatLeg).toBe(true);
    expect(both.flatLeg).toBe(true);
    expect(both.jointAnnualization).toEqual({ state: "withheld", days: 60 });
  });
  it("each key is NaN exactly when either gate alone makes it NaN", () => {
    const keys = [...FOUR, ...UNTOUCHED] as const;
    for (const k of keys) {
      const expectNaN = Number.isNaN(flatOnly.joint![k]) || (FOUR as readonly string[]).includes(k);
      expect(Number.isNaN(both.joint![k]), k).toBe(expectNaN);
    }
    // The record gate adds tracking error, which the flat-leg gate alone leaves finite.
    expect(Number.isFinite(flatOnly.joint!.tracking_error)).toBe(true);
    expect(both.joint!.tracking_error).toBeNaN();
  });
});
