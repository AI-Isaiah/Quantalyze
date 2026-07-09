/**
 * Phase 42 Plan 05 (PEER-05) — the `sampleBasisRatios` standalone helper +
 * its PARITY pin to the FROZEN scenario engine.
 *
 * ⛔ `src/lib/scenario.ts` is FROZEN (SCENARIO-05) — the v1.2 frozen-spine guards
 * assert it is zero-diff vs the phase baseline, so the engine's sample/252 math
 * could NOT be extracted into a shared helper. `sampleBasisRatios` is therefore a
 * STANDALONE replica. This test is the SOLE proof the replica matches the frozen
 * engine — exactly the diversification-consistency-pin pattern (parity-by-
 * construction). It makes three load-bearing proofs:
 *
 *   1. HAND-DERIVED REFERENCE: `sampleBasisRatios(RETS)` equals a transparently
 *      hand-computed SAMPLE(ddof=1)×√252 Sharpe + downside-RMS/n×√252 Sortino +
 *      peak-to-trough max_drawdown, rounded to the engine's payload contract.
 *      The basis is legible in the test itself (no opaque golden numbers).
 *   2. ENGINE PARITY: for a single-strategy blend whose portfolio daily returns
 *      equal RETS verbatim (weight 1.0 / leverage 1.0), `computeScenario`'s
 *      rounded sharpe/sortino/max_drawdown EQUAL `sampleBasisRatios(RETS)`. A
 *      drift in EITHER the frozen engine OR this replica fails the pin — the
 *      own-book delta is then provably on the SAME basis as the blend (T-42-15).
 *   3. DEGENERATE + DOWN-DAY guards: <2 obs / non-finite → all-null; a no-down-day
 *      series → null Sortino (not a Sharpe-relabeled value, audit G8.E.6 / P343).
 *
 * The reference is a pure function of a fixed literal array — no PRNG / Date.now()
 * — so it is reload-stable.
 */
import { describe, it, expect } from "vitest";
import { sampleBasisRatios } from "./sample-basis-ratios";
import {
  buildDateMapCache,
  computeScenario,
  type StrategyForBuilder,
  type ScenarioState,
} from "./scenario";

// --------------------------------------------------------------------------
// Fixed deterministic daily-return series (30 obs, with down days for Sortino).
// Mirrors the basis-pin fixture so the two tests share a legible reference.
// --------------------------------------------------------------------------
const RETS = [
  0.012, -0.008, 0.005, 0.021, -0.013, 0.009, -0.004, 0.017, -0.011, 0.006,
  0.014, -0.007, 0.003, 0.019, -0.015, 0.01, -0.002, 0.008, 0.013, -0.009,
  0.004, 0.016, -0.006, 0.011, -0.012, 0.007, 0.015, -0.005, 0.002, 0.018,
];
const ANNUALIZE = Math.sqrt(252);
const round3 = (x: number) => Number(x.toFixed(3));
const round5 = (x: number) => Number(x.toFixed(5));

const N = RETS.length;
const MEAN = RETS.reduce((s, r) => s + r, 0) / N;

/** SAMPLE (ddof=1) Sharpe × √252 — the cohort/quantstats basis. */
const sampleVariance = RETS.reduce((s, r) => s + (r - MEAN) ** 2, 0) / (N - 1);
const sampleSharpeRef = (MEAN * 252) / (Math.sqrt(sampleVariance) * ANNUALIZE);

/** Sortino: downside RMS over TOTAL n × √252, rf=0. */
const downsideSumSq = RETS.reduce((s, r) => s + (r < 0 ? r * r : 0), 0);
const sortinoRef = (MEAN * 252) / (Math.sqrt(downsideSumSq / N) * ANNUALIZE);

// #597 — CRYPTO basis: same math, annualized on √365 instead of √252. Every
// annualized ratio scales by √(365/252) vs the traditional basis; max_drawdown
// is basis-invariant (no stdev) so it is UNCHANGED.
const ANNUALIZE_365 = Math.sqrt(365);
const sampleSharpeRef365 =
  (MEAN * 365) / (Math.sqrt(sampleVariance) * ANNUALIZE_365);
const sortinoRef365 =
  (MEAN * 365) / (Math.sqrt(downsideSumSq / N) * ANNUALIZE_365);

/** Max drawdown on the cumulative-product wealth curve. */
function maxDrawdownRef(rets: number[]): number {
  let c = 1;
  let peak = -Infinity;
  let maxDD = 0;
  for (const r of rets) {
    c *= 1 + r;
    if (c > peak) peak = c;
    const dd = c / peak - 1;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

/** N sequential business-day ISO dates (skips weekends), deterministic. */
function businessDates(startDate: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(startDate + "T00:00:00Z");
  let guard = 0;
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    if (++guard > n * 4) break;
  }
  return out;
}

/**
 * A single-strategy scenario at weight 1.0 / leverage 1.0. With one active
 * strategy the engine's renormalized weight is exactly 1, so the blend's
 * portfolio daily returns equal RETS verbatim — letting us pin the standalone
 * replica against the frozen engine's output for the SAME series.
 */
function singleStrategyScenario(dates: string[], periodsPerYear = 252) {
  const strategy: StrategyForBuilder = {
    id: "pin",
    name: "Pin",
    codename: null,
    disclosure_tier: "institutional",
    strategy_types: ["arbitrage"],
    markets: ["BTC"],
    start_date: dates[0],
    daily_returns: dates.map((date, i) => ({ date, value: RETS[i] })),
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
  };
  const state: ScenarioState = {
    selected: { pin: true },
    weights: { pin: 1 },
    startDates: { pin: dates[0] },
    leverage: { pin: 1 },
  };
  const cache = buildDateMapCache([strategy]);
  return computeScenario([strategy], state, cache, periodsPerYear);
}

describe("sampleBasisRatios — hand-derived sample/252 reference", () => {
  it("Sharpe equals the SAMPLE (ddof=1) × √252 reference (the cohort basis)", () => {
    const r = sampleBasisRatios(RETS);
    expect(r.sharpe).not.toBeNull();
    expect(r.sharpe!).toBe(round3(sampleSharpeRef));
  });

  it("Sortino equals the downside-RMS/n × √252 reference (the cohort basis)", () => {
    const r = sampleBasisRatios(RETS);
    expect(r.sortino).not.toBeNull();
    expect(r.sortino!).toBe(round3(sortinoRef));
  });

  it("max_drawdown equals the peak-to-trough reference (basis-invariant)", () => {
    const r = sampleBasisRatios(RETS);
    expect(r.max_drawdown).not.toBeNull();
    expect(r.max_drawdown!).toBe(round5(maxDrawdownRef(RETS)));
  });
});

describe("sampleBasisRatios — #597 crypto (√365) basis", () => {
  it("periodsPerYear=365 matches the hand-derived √365 Sharpe/Sortino reference", () => {
    const r = sampleBasisRatios(RETS, 365);
    expect(r.sharpe).not.toBeNull();
    expect(r.sortino).not.toBeNull();
    expect(r.sharpe!).toBe(round3(sampleSharpeRef365));
    expect(r.sortino!).toBe(round3(sortinoRef365));
  });

  it("√365 Sharpe = √252 Sharpe × √(365/252) on the SAME series", () => {
    // Annualized ratios scale by √N; the ratio of the two bases is √(365/252).
    const r252 = sampleBasisRatios(RETS, 252);
    const r365 = sampleBasisRatios(RETS, 365);
    const scale = Math.sqrt(365 / 252);
    expect(r365.sharpe!).toBeCloseTo(r252.sharpe! * scale, 2);
    expect(r365.sortino!).toBeCloseTo(r252.sortino! * scale, 2);
  });

  it("max_drawdown is basis-INVARIANT (identical at 252 and 365)", () => {
    expect(sampleBasisRatios(RETS, 365).max_drawdown).toBe(
      sampleBasisRatios(RETS, 252).max_drawdown,
    );
  });

  it("default (no arg) is byte-identical to explicit 252", () => {
    expect(sampleBasisRatios(RETS)).toEqual(sampleBasisRatios(RETS, 252));
  });
});

describe("sampleBasisRatios — ENGINE PARITY (replica ≡ frozen computeScenario)", () => {
  it("matches computeScenario's rounded sharpe/sortino/max_drawdown for the same series", () => {
    const m = singleStrategyScenario(businessDates("2024-01-02", N));
    const r = sampleBasisRatios(RETS);
    // The engine produced these on the same sample/252 basis (its own rounding).
    expect(m.n).toBe(N);
    expect(m.sharpe).not.toBeNull();
    expect(m.sortino).not.toBeNull();
    expect(m.max_drawdown).not.toBeNull();
    // Parity-by-construction: a drift in EITHER the engine OR this replica fails.
    expect(r.sharpe).toBe(m.sharpe);
    expect(r.sortino).toBe(m.sortino);
    expect(r.max_drawdown).toBe(m.max_drawdown);
  });

  it("#597 — parity ALSO holds at the crypto √365 basis (replica ≡ engine)", () => {
    // Thread the SAME periodsPerYear=365 through BOTH the engine and the
    // replica: they must still agree exactly. This proves the two stay in
    // lockstep at ANY basis, not just the 252 default.
    const m = singleStrategyScenario(businessDates("2024-01-02", N), 365);
    const r = sampleBasisRatios(RETS, 365);
    expect(m.n).toBe(N);
    expect(r.sharpe).toBe(m.sharpe);
    expect(r.sortino).toBe(m.sortino);
    expect(r.max_drawdown).toBe(m.max_drawdown);
    // And 365 genuinely differs from 252 for the annualized ratios (non-vacuous).
    const m252 = singleStrategyScenario(businessDates("2024-01-02", N), 252);
    expect(m.sharpe).not.toBe(m252.sharpe);
  });
});

describe("sampleBasisRatios — degenerate + down-day guards", () => {
  it("fewer than 2 observations → all-null (never NaN/Inf)", () => {
    expect(sampleBasisRatios([])).toEqual({
      sharpe: null,
      sortino: null,
      max_drawdown: null,
    });
    expect(sampleBasisRatios([0.01])).toEqual({
      sharpe: null,
      sortino: null,
      max_drawdown: null,
    });
  });

  it("any non-finite return → all-null (safe-collapse, never NaN/Inf)", () => {
    expect(sampleBasisRatios([0.01, Number.NaN, 0.02])).toEqual({
      sharpe: null,
      sortino: null,
      max_drawdown: null,
    });
    expect(sampleBasisRatios([0.01, Number.POSITIVE_INFINITY])).toEqual({
      sharpe: null,
      sortino: null,
      max_drawdown: null,
    });
  });

  it("a series with NO down days → null Sortino (not a Sharpe-relabeled value)", () => {
    const allUp = [0.004, 0.006, 0.005, 0.008, 0.003, 0.007];
    const r = sampleBasisRatios(allUp);
    // Sharpe is finite (variance > 0), but with zero downside there is no
    // Sortino denominator → null (audit G8.E.6 / P343), NOT sharpe ?? 0.
    expect(r.sharpe).not.toBeNull();
    expect(r.sortino).toBeNull();
    // Max drawdown is 0 (monotonic up).
    expect(r.max_drawdown).toBe(0);
  });
});
