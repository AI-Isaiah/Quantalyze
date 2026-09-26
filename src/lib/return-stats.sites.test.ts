/**
 * Site tests T1-T5 for Phase 166.2 plan 01: each Tier-2 site that computes a
 * Sharpe, correlation or diversification ratio from daily returns must answer
 * a compounding-NAV constant yield EXACTLY as it answers an all-zero series of
 * the same length (Phase 166.1 D-07), because that site now computes through
 * `src/lib/return-stats.ts` (D-17).
 *
 * Why it matters: before the fix each site passed its own `> 0` guard on a
 * residue sd of about 1.3e-16 and showed a Sharpe of 1e12 to 1e14, or a residue
 * correlation, to an allocator. The cent-rounded 1% APY NAV is the control on
 * the other side of the floor: its dispersion is real, so its ratio must stay a
 * finite number, and widening the floor goes red.
 *
 * Expected values are never hard-coded: each test computes the site's output on
 * the all-zero input and asserts the constant-yield output identical to it.
 */
import { describe, it, expect } from "vitest";
import { reconstructAndAnalyze } from "@/app/(dashboard)/compare/lib/holding-compare-adapter";
import { sampleBasisRatios } from "@/lib/sample-basis-ratios";
import {
  buildDateMapCache,
  computeScenario,
  type ScenarioState,
  type StrategyForBuilder,
} from "@/lib/scenario";
import {
  constituentVols,
  covarianceMatrix,
  diversificationRatio,
  portfolioVarianceFromCov,
} from "@/lib/diversification";
import {
  CONSTANT_YIELDS,
  apyToDaily,
  navConstantYield,
  navLevelsConstantYield,
} from "@/__tests__/fixtures/dispersion-nav";

const YIELD_IDS = Object.keys(CONSTANT_YIELDS);

/** Daily ISO dates from 2024-01-01, deterministic. */
function isoDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date("2024-01-01T00:00:00Z");
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** A deterministic noisy daily-return series (no PRNG, reload-stable). */
function noisy(n: number, phase: number, drift = 0.001): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(drift + 0.02 * Math.sin(i * 1.7 + phase) + 0.005 * Math.cos(i * 0.31 + 2 * phase));
  }
  return out;
}

const ZEROS = new Array(366).fill(0);
const CENT_CONTROL = navConstantYield(apyToDaily(0.01), 366, 10_000, true);
const NOISY_A = noisy(366, 0.3);
const NOISY_B = noisy(366, 1.1, -0.0005);

/** A scenario over `members` (id -> daily returns on one shared daily axis), equal weights. */
function scenarioOf(members: Record<string, number[]>, periodsPerYear = 365) {
  const ids = Object.keys(members);
  const dates = isoDates(members[ids[0]].length);
  const strategies: StrategyForBuilder[] = ids.map((id) => ({
    id,
    name: id,
    codename: null,
    disclosure_tier: "institutional",
    strategy_types: ["arbitrage"],
    markets: ["USDC"],
    start_date: dates[0],
    daily_returns: dates.map((date, i) => ({ date, value: members[id][i] })),
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
  }));
  const state: ScenarioState = {
    selected: Object.fromEntries(ids.map((id) => [id, true])),
    weights: Object.fromEntries(ids.map((id) => [id, 1])),
    startDates: Object.fromEntries(ids.map((id) => [id, dates[0]])),
    leverage: Object.fromEntries(ids.map((id) => [id, 1])),
  };
  return computeScenario(strategies, state, buildDateMapCache(strategies), periodsPerYear);
}

/** The Choueifaty DR of an equal-weight book, composed exactly as computeDiversification composes it. */
function drOf(book: Record<string, number[]>): number | null {
  const ids = Object.keys(book);
  const weights = Object.fromEntries(ids.map((id) => [id, 1 / ids.length]));
  const cov = covarianceMatrix(book, ids)!;
  const vols = constituentVols(book, ids)!;
  return diversificationRatio(weights, vols, Math.sqrt(portfolioVarianceFromCov(ids, weights, cov)));
}

/** Equity snapshots whose `symbol` breakdown walks through `levels`. */
function snapshotsFromLevels(levels: number[], symbol = "USDC") {
  const dates = isoDates(levels.length);
  return levels.map((v, i) => ({ asof: dates[i], breakdown: { [symbol]: v } }));
}

describe("T1 reconstructAndAnalyze (holding Sharpe on /compare)", () => {
  const FLAT = snapshotsFromLevels(new Array(367).fill(10_000));

  it.each(YIELD_IDS)("%s: sharpe is identical to the flat-NAV holding's", (id) => {
    const got = reconstructAndAnalyze(
      snapshotsFromLevels(navLevelsConstantYield(CONSTANT_YIELDS[id])),
      "USDC",
    );
    const flat = reconstructAndAnalyze(FLAT, "USDC");
    expect(Object.is(got.sharpe, flat.sharpe), `sharpe=${got.sharpe}`).toBe(true);
  });

  it("the cent-rounded 1% APY NAV keeps a finite sharpe", () => {
    const a = reconstructAndAnalyze(
      snapshotsFromLevels(navLevelsConstantYield(apyToDaily(0.01), 366, 10_000, true)),
      "USDC",
    );
    expect(a.sharpe).not.toBeNull();
    expect(Number.isFinite(a.sharpe!)).toBe(true);
  });

  it("cumulative_return, max_drawdown and vol keep today's formula on a noisy NAV, bitwise", () => {
    const levels: number[] = [10_000];
    for (let i = 1; i < 200; i++) {
      levels.push(levels[i - 1] * (1 + 0.001 + 0.02 * Math.sin(i * 1.7 + 0.3)));
    }
    const a = reconstructAndAnalyze(snapshotsFromLevels(levels), "USDC");
    const returns = levels.slice(1).map((v, i) => v / levels[i] - 1);
    const n = returns.length;
    const m = returns.reduce((x, y) => x + y, 0) / n;
    const std = Math.sqrt(returns.reduce((x, y) => x + (y - m) ** 2, 0) / n);
    let peak = levels[0];
    let maxDD = 0;
    for (const v of levels) {
      if (v > peak) peak = v;
      const dd = (v - peak) / peak;
      if (dd < maxDD) maxDD = dd;
    }
    expect(Object.is(a.vol, std * Math.sqrt(365))).toBe(true);
    expect(Object.is(a.cumulative_return, returns.reduce((acc, r) => acc * (1 + r), 1) - 1)).toBe(true);
    expect(Object.is(a.max_drawdown, maxDD)).toBe(true);
    // The Sharpe moves from (mean / std) * sqrt(365) to the factsheet order,
    // the same number to rounding.
    expect(a.sharpe!).toBeCloseTo((m / std) * Math.sqrt(365), 10);
  });
});

describe("T2 sampleBasisRatios (own-book ratios beside the composer)", () => {
  it.each(YIELD_IDS)("%s: sharpe is identical to the all-zero series' at 252 and 365", (id) => {
    const r = navConstantYield(CONSTANT_YIELDS[id]);
    for (const basis of [252, 365]) {
      const got = sampleBasisRatios(r, basis).sharpe;
      const zero = sampleBasisRatios(ZEROS, basis).sharpe;
      expect(Object.is(got, zero), `basis=${basis} sharpe=${got}`).toBe(true);
    }
  });

  it("the cent-rounded 1% APY NAV keeps a finite sharpe", () => {
    const s = sampleBasisRatios(CENT_CONTROL, 365).sharpe;
    expect(s).not.toBeNull();
    expect(Number.isFinite(s!)).toBe(true);
  });

  it("sortino and max_drawdown keep today's formula on a noisy series", () => {
    const n = NOISY_A.length;
    const m = NOISY_A.reduce((s, r) => s + r, 0) / n;
    const downside = Math.sqrt(NOISY_A.reduce((s, r) => s + (r < 0 ? r * r : 0), 0) / n) * Math.sqrt(365);
    let c = 1;
    let peak = -Infinity;
    let maxDD = 0;
    for (const r of NOISY_A) {
      c *= 1 + r;
      if (c > peak) peak = c;
      if (c / peak - 1 < maxDD) maxDD = c / peak - 1;
    }
    const got = sampleBasisRatios(NOISY_A, 365);
    expect(got.sortino).toBe(Number(((m * 365) / downside).toFixed(3)));
    expect(got.max_drawdown).toBe(Number(maxDD.toFixed(5)));
  });

  it("parity by construction: equals computeScenario's Sharpe for the same single-member series", () => {
    expect(sampleBasisRatios(NOISY_A, 365).sharpe).toBe(scenarioOf({ a: NOISY_A }).sharpe);
  });
});

describe("T3 computeScenario portfolio Sharpe (the what-if blend)", () => {
  it.each(YIELD_IDS)("%s: a single constant-yield member gives the all-zero member's sharpe", (id) => {
    const got = scenarioOf({ c: navConstantYield(CONSTANT_YIELDS[id]) }).sharpe;
    const zero = scenarioOf({ c: ZEROS }).sharpe;
    expect(Object.is(got, zero), `sharpe=${got}`).toBe(true);
  });

  it("the cent-rounded 1% APY member keeps a finite sharpe", () => {
    const s = scenarioOf({ c: CENT_CONTROL }).sharpe;
    expect(s).not.toBeNull();
    expect(Number.isFinite(s!)).toBe(true);
  });
});

describe("T4 computeScenario correlation matrix", () => {
  it.each(YIELD_IDS)("%s: the constant-yield member's cells equal an all-zero member's", (id) => {
    const got = scenarioOf({ c: navConstantYield(CONSTANT_YIELDS[id]), a: NOISY_A, b: NOISY_B });
    const zero = scenarioOf({ c: ZEROS, a: NOISY_A, b: NOISY_B });
    const gm = got.correlation_matrix!;
    const zm = zero.correlation_matrix!;
    for (const [x, y] of [["c", "a"], ["a", "c"], ["c", "b"], ["b", "c"]]) {
      expect(Object.is(gm[x][y], zm[x][y]), `${x}-${y}=${gm[x][y]}`).toBe(true);
    }
    expect(Number.isFinite(gm.a.b)).toBe(true);
    expect(gm.a.b).toBe(zm.a.b);
    expect(got.avg_pairwise_correlation).toBe(zero.avg_pairwise_correlation);
  });

  // D7 (founder, 2026-09-26), WR-03 / SFH-M2: an undefined pair is not a
  // measured 0. It has no cell, and it is out of the Avg |rho| sum AND count,
  // so a flat member cannot make the book read as more diversified.
  it("an all-zero member's pairs have no cell and are left out of the average", () => {
    const zero = scenarioOf({ c: ZEROS, a: NOISY_A, b: NOISY_B });
    const zm = zero.correlation_matrix!;
    expect(zm.c).toEqual({ c: 1 });
    expect("c" in zm.a).toBe(false);
    expect("c" in zm.b).toBe(false);
    // Only the a-b pair is measured, so the average is exactly its |rho|.
    const ab = scenarioOf({ a: NOISY_A, b: NOISY_B });
    expect(zero.avg_pairwise_correlation).toBe(ab.avg_pairwise_correlation);
    expect(zero.avg_pairwise_correlation).toBe(Math.abs(zm.a.b));
  });

  it("no measured pair at all gives a null average, never 0", () => {
    expect(scenarioOf({ c: ZEROS, d: ZEROS }).avg_pairwise_correlation).toBeNull();
  });

  it("the cent-rounded 1% APY member keeps a finite, measured correlation", () => {
    const m = scenarioOf({ c: CENT_CONTROL, a: NOISY_A }).correlation_matrix!;
    expect(Number.isFinite(m.c.a)).toBe(true);
  });
});

describe("T5 diversificationRatio (Choueifaty DR of the what-if book)", () => {
  it.each(YIELD_IDS)("%s: a book of constant-yield members gives the all-zero book's DR", (id) => {
    const y = CONSTANT_YIELDS[id];
    const got = drOf({ c1: navConstantYield(y), c2: navConstantYield(y, 366, 2_500) });
    const zero = drOf({ c1: ZEROS, c2: ZEROS });
    expect(Object.is(got, zero), `dr=${got}`).toBe(true);
  });

  it("a book of noisy members keeps a finite ratio", () => {
    const dr = drOf({ a: NOISY_A, b: NOISY_B });
    expect(dr).not.toBeNull();
    expect(Number.isFinite(dr!)).toBe(true);
  });

  it("a NaN portfolio sigma still answers null, as today", () => {
    expect(diversificationRatio({ a: 1 }, { a: 0.01 }, NaN)).toBeNull();
  });
});
