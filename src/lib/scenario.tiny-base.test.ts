/**
 * Phase 188 (TINYBASE) plan 09, D-07, SC-3, SC-5: `computeScenario` reads a unit's tiny-base day
 * as a day with NO return, never as r = 0.
 *
 * The rule is the TypeScript mirror of the compose's
 * `portfolio_returns(dropped_days_by_key=...)` (RESEARCH "Book arithmetic", option A): on a day a
 * unit names in `undefined_return_days`, that unit sits out the day's numerator AND its weight in
 * the weight sum; the date axis is built without a unit's named days, so a day on which no unit
 * has a return is absent from the output, never written as 0; correlation uses ONE day set for
 * every pair (the axis days no unit names, T-KL1-CORR). Only named days change: every other
 * absent day keeps its 0-fill, and a unit without the field, or with an empty list, is
 * byte-identical to before.
 *
 * Every expected value below is typed beside the sum it comes from, or is an independent
 * invariant (a product of typed returns, a Pearson written out here). None is derived by running
 * the engine on the same input. Each arm is RED on an engine that reads a named day as 0
 * (neutered `continue` in the weighted-sum loop, or the axis loops, or the correlation filter).
 */
import { describe, it, expect } from "vitest";
import {
  buildDateMapCache,
  computeScenario,
  type ScenarioState,
  type StrategyForBuilder,
} from "./scenario";

const DAYS = [
  "2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06",
  "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12",
];
const NAMED = ["2026-03-07", "2026-03-08"];

// Unit A: every day.
const A = [0.01, -0.005, 0.02, 0.0, 0.015, -0.01, 0.02, -0.01, 0.005, 0.01, -0.02, 0.012];
// Unit B: every day EXCEPT 2026-03-07 and 2026-03-08, in date order.
const B_DAYS = DAYS.filter((d) => !NAMED.includes(d));
const B = [0.03, -0.02, 0.01, 0.005, -0.015, 0.025, 0.02, -0.01, 0.015, -0.005];
// Unit K: every day, dispersed so including 2026-03-07/08 moves its correlation with A.
const K = [0.004, 0.011, -0.008, 0.012, -0.003, 0.009, -0.03, 0.04, 0.002, -0.006, 0.007, -0.001];

function unit(
  id: string,
  days: string[],
  values: number[],
  extra: Partial<StrategyForBuilder> = {},
): StrategyForBuilder {
  return {
    id,
    name: `Unit ${id}`,
    codename: null,
    disclosure_tier: "exploratory",
    strategy_types: [],
    markets: [],
    start_date: null,
    daily_returns: days.map((date, i) => ({ date, value: values[i] })),
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
    asset_class: "crypto",
    ...extra,
  };
}

function run(
  strategies: StrategyForBuilder[],
  weights: Record<string, number>,
  window?: { start: string; end: string },
) {
  const selected: Record<string, boolean> = {};
  const startDates: Record<string, string> = {};
  for (const s of strategies) {
    selected[s.id] = true;
    startDates[s.id] = "2026-01-01";
  }
  const state: ScenarioState = { selected, weights, startDates, ...(window ? { window } : {}) };
  return computeScenario(strategies, state, buildDateMapCache(strategies), 365);
}

/** Pearson written out here, so the oracle never calls the code under test. */
function pearsonRef(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return cov / Math.sqrt(va * vb);
}
const round3 = (x: number) => Number(x.toFixed(3));

const WEIGHTS = { A: 1, B: 3 }; // normalised 0.25 / 0.75
const bNamed = () => unit("B", B_DAYS, B, { undefined_return_days: NAMED });
const bPlain = () => unit("B", B_DAYS, B);
const aUnit = () => unit("A", DAYS, A);

// Hand arithmetic, (rA + 3 rB) / 4 on a day both have a return; A alone on a named day.
//   01: (0.01   + 3*0.03 ) / 4 = 0.025
//   02: (-0.005 + 3*-0.02) / 4 = -0.01625
//   03: (0.02   + 3*0.01 ) / 4 = 0.0125
//   04: (0.0    + 3*0.005) / 4 = 0.00375
//   05: (0.015  + 3*-0.015)/ 4 = -0.0075
//   06: (-0.01  + 3*0.025) / 4 = 0.01625
//   07: A alone            = 0.02
//   08: A alone            = -0.01
//   09: (0.005  + 3*0.02 ) / 4 = 0.01625
//   10: (0.01   + 3*-0.01) / 4 = -0.005
//   11: (-0.02  + 3*0.015) / 4 = 0.00625
//   12: (0.012  + 3*-0.005)/ 4 = -0.00075
const EXPECTED_DAILY = [
  0.025, -0.01625, 0.0125, 0.00375, -0.0075, 0.01625, 0.02, -0.01, 0.01625, -0.005, 0.00625,
  -0.00075,
];

describe("computeScenario - a named day is a day with no return (188 D-07)", () => {
  it("a unit sits out a named day's numerator AND weight: A alone on 03-07 and 03-08, the 3:1 blend elsewhere", () => {
    const out = run([aUnit(), bNamed()], WEIGHTS);
    const got = out.portfolio_daily_returns!;
    expect(got.map((p) => p.date)).toEqual(DAYS);
    got.forEach((p, i) => expect(p.value).toBeCloseTo(EXPECTED_DAILY[i], 12));
    // Named days read A alone. Today they read 0.02/4 = 0.005 and -0.01/4 = -0.0025.
    expect(got[6].value).toBeCloseTo(0.02, 12);
    expect(got[7].value).toBeCloseTo(-0.01, 12);
  });

  it("twr is the product of the typed day returns, so the left-out days are not chained as flat days", () => {
    const out = run([aUnit(), bNamed()], WEIGHTS);
    const product = EXPECTED_DAILY.reduce((c, r) => c * (1 + r), 1) - 1;
    expect(out.twr).toBeCloseTo(product, 5);
    // Non-vacuity: the field-less run differs, so this arm can fail.
    const without = run([aUnit(), bPlain()], WEIGHTS);
    expect(without.twr).not.toBeCloseTo(product, 5);
  });

  it("correlation uses one day set for every pair: the axis days no unit names", () => {
    const out = run([aUnit(), bNamed(), unit("K", DAYS, K)], { ...WEIGHTS, K: 2 });
    const keep = DAYS.map((d) => !NAMED.includes(d));
    const a10 = A.filter((_, i) => keep[i]);
    const k10 = K.filter((_, i) => keep[i]);
    // A-B on the 10 days neither names (B's typed array is already those 10 days).
    expect(out.correlation_matrix!.A.B).toBe(round3(pearsonRef(a10, B)));
    // A-K also leaves 03-07/03-08 out although K names nothing (T-KL1-CORR).
    expect(out.correlation_matrix!.A.K).toBe(round3(pearsonRef(a10, k10)));
    expect(out.correlation_matrix!.B.K).toBe(round3(pearsonRef(B, k10)));
    // Non-vacuity: the 12-day A-K correlation rounds differently.
    expect(round3(pearsonRef(A, K))).not.toBe(round3(pearsonRef(a10, k10)));
  });

  it("a sole unit on a stale row: the named day is absent, not written as 0, and not chained", () => {
    const C = [0.01, -0.005, 0.02, 0.0, 0.015, -0.01, 0.02, -0.01, 0.47, 0.01, -0.02, 0.012];
    const out = run([unit("C", DAYS, C, { undefined_return_days: ["2026-03-09"] })], { C: 1 });
    const got = out.portfolio_daily_returns!;
    expect(got).toHaveLength(11);
    expect(got.some((p) => p.date === "2026-03-09")).toBe(false);
    const eleven = [0.01, -0.005, 0.02, 0.0, 0.015, -0.01, 0.02, -0.01, 0.01, -0.02, 0.012];
    expect(out.twr).toBeCloseTo(eleven.reduce((c, r) => c * (1 + r), 1) - 1, 5);
  });

  it("the present-window path sits the unit out the same way: member_count 2, A alone on the named days", () => {
    const out = run([aUnit(), bNamed()], WEIGHTS, { start: "2026-03-01", end: "2026-03-12" });
    expect(out.member_count).toBe(2);
    const got = out.portfolio_daily_returns!;
    expect(got[6].value).toBeCloseTo(0.02, 12);
    expect(got[7].value).toBeCloseTo(-0.01, 12);
    expect(got[0].value).toBeCloseTo(0.025, 12);
  });

  it("SC-4: an absent day the unit does NOT name keeps today's 0-fill", () => {
    // B also lacks 03-10, which is not named.
    const days = DAYS.filter((d) => d !== "2026-03-07" && d !== "2026-03-08" && d !== "2026-03-10");
    const values = [0.03, -0.02, 0.01, 0.005, -0.015, 0.025, 0.02, 0.015, -0.005];
    const out = run(
      [aUnit(), unit("B", days, values, { undefined_return_days: NAMED })],
      WEIGHTS,
    );
    const got = out.portfolio_daily_returns!;
    // 03-10: (0.25 * 0.01 + 0.75 * 0) / 1 = 0.0025 (B counts as 0 and keeps its weight).
    expect(got[9].date).toBe("2026-03-10");
    expect(got[9].value).toBeCloseTo(0.0025, 12);
    // The named days still read A alone.
    expect(got[6].value).toBeCloseTo(0.02, 12);
    expect(got[7].value).toBeCloseTo(-0.01, 12);
  });

  it("byte identity: no field, an empty list and a list of a day off the axis give the same output", () => {
    const base = run([aUnit(), bPlain()], WEIGHTS);
    const empty = run([aUnit(), unit("B", B_DAYS, B, { undefined_return_days: [] })], WEIGHTS);
    const offAxis = run(
      [aUnit(), unit("B", B_DAYS, B, { undefined_return_days: ["2025-01-01"] })],
      WEIGHTS,
    );
    expect(empty).toStrictEqual(base);
    expect(offAxis).toStrictEqual(base);
  });
});
