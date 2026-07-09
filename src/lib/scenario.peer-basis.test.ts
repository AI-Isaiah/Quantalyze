/**
 * PEER-02 convention pin (Phase 42, ADR-0025 §4).
 *
 * The scenario BLEND's peer rank must be computed on the SAME numerical basis as
 * the cohort it is ranked against. The cohort's stored `strategy_analytics`
 * Sharpe/Sortino are written by the Python analytics-service via quantstats,
 * which uses SAMPLE stdev (`std(ddof=1)`) annualized × √252 (Sharpe) and a
 * downside-RMS divided by TOTAL observations × √252 (Sortino). The factsheet
 * HEADLINE metrics (`compute.ts`) instead use POPULATION stdev — a DIFFERENT,
 * higher-Sharpe basis. Ranking a population-basis Sharpe against a sample-basis
 * cohort would inflate the rank (population stdev < sample stdev → bigger Sharpe
 * → inflated percentile).
 *
 * The engine `computeScenario` (`scenario.ts:341-388`) ALREADY produces the
 * blend's Sharpe/Sortino on the sample/252 basis — exactly the cohort's
 * quantstats convention — and returns them rounded to the engine's payload
 * contract (`sharpe`/`sortino` toFixed(3), `max_drawdown` toFixed(5),
 * `scenario.ts:464-466`). This test PINS that:
 *
 *   1. `computeScenario`'s sharpe/sortino equal a hand-derived sample/252
 *      reference (rounded to the engine's contract) for a fixed returns series.
 *   2. The POPULATION-basis Sharpe for the SAME series is DISTINCT and STRICTLY
 *      HIGHER — so the two bases provably diverge, and a future regression that
 *      ranks from `compute.ts`/`payload.strategyMetrics` (population) instead of
 *      `scenarioMetrics` (sample) would FAIL this pin.
 *   3. max_drawdown is basis-invariant (no stdev) — it matches under both.
 *
 * The reference is a pure deterministic function of the fixed series — no PRNG,
 * no Date.now() — so the rank is reload-stable (PEER-02). A drift in either the
 * engine's metric math OR this convention fails the pin.
 */
import { describe, it, expect } from "vitest";
import {
  buildDateMapCache,
  computeScenario,
  type StrategyForBuilder,
  type ScenarioState,
} from "./scenario";

// --------------------------------------------------------------------------
// Fixed, deterministic daily-return series (30 obs, 12 negative days). Chosen
// to exercise a non-trivial Sharpe AND Sortino (downside present), with n ≥ 10
// so the engine does not early-return. Reload-stable: a literal array.
// --------------------------------------------------------------------------
const RETS = [
  0.012, -0.008, 0.005, 0.021, -0.013, 0.009, -0.004, 0.017, -0.011, 0.006,
  0.014, -0.007, 0.003, 0.019, -0.015, 0.01, -0.002, 0.008, 0.013, -0.009,
  0.004, 0.016, -0.006, 0.011, -0.012, 0.007, 0.015, -0.005, 0.002, 0.018,
] as const;
const ANNUALIZE = Math.sqrt(252);
/** The engine rounds sharpe/sortino to 3 decimals (scenario.ts:464-465). */
const round3 = (x: number) => Number(x.toFixed(3));

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
 * strategy, the engine's renormalized weight is exactly 1, so the blend's
 * portfolio daily returns equal this strategy's returns verbatim — letting us
 * pin the engine's metric math against a hand-derived reference on RETS.
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

// --------------------------------------------------------------------------
// Hand-derived references on RETS. These re-derive the cohort's quantstats
// conventions transparently so the basis is legible in the test itself.
// --------------------------------------------------------------------------
const N = RETS.length;
const MEAN = RETS.reduce((s, r) => s + r, 0) / N;

/** SAMPLE (ddof=1) Sharpe × √252 — the cohort/quantstats basis (the engine's). */
const sampleVariance = RETS.reduce((s, r) => s + (r - MEAN) ** 2, 0) / (N - 1);
const sampleSharpeRef = (MEAN * 252) / (Math.sqrt(sampleVariance) * ANNUALIZE);

/** POPULATION (ddof=0) Sharpe × √252 — the compute.ts headline basis (WRONG for ranking). */
const populationVariance = RETS.reduce((s, r) => s + (r - MEAN) ** 2, 0) / N;
const populationSharpeRef =
  (MEAN * 252) / (Math.sqrt(populationVariance) * ANNUALIZE);

/** Sortino: downside RMS over TOTAL n × √252, rf=0 — quantstats basis (the engine's). */
const downsideSumSq = RETS.reduce((s, r) => s + (r < 0 ? r * r : 0), 0);
const sortinoRef = (MEAN * 252) / (Math.sqrt(downsideSumSq / N) * ANNUALIZE);

// #597 — the same sample/downside basis annualized on √365 (crypto). A crypto
// cohort's stored quantstats Sharpe/Sortino are annualized √365, so ranking a
// crypto blend requires the engine to annualize √365 too (via periodsPerYear).
const ANNUALIZE_365 = Math.sqrt(365);
const sampleSharpeRef365 =
  (MEAN * 365) / (Math.sqrt(sampleVariance) * ANNUALIZE_365);
const sortinoRef365 =
  (MEAN * 365) / (Math.sqrt(downsideSumSq / N) * ANNUALIZE_365);

const TOL = 1e-9;

describe("PEER-02 convention pin: the blend's ranking basis is sample/252, not population", () => {
  it("computeScenario sharpe equals the SAMPLE (ddof=1) × √252 reference (the cohort basis)", () => {
    const m = singleStrategyScenario(businessDates("2024-01-02", N));
    expect(m.n).toBe(N);
    expect(m.sharpe).not.toBeNull();
    // The engine rounds to 3 decimals; the reference is rounded the same way.
    expect(m.sharpe!).toBe(round3(sampleSharpeRef));
  });

  it("computeScenario sortino equals the downside-RMS/n × √252 reference (the cohort basis)", () => {
    const m = singleStrategyScenario(businessDates("2024-01-02", N));
    expect(m.sortino).not.toBeNull();
    expect(m.sortino!).toBe(round3(sortinoRef));
  });

  it("the POPULATION-basis Sharpe is DISTINCT and STRICTLY HIGHER — a population bleed would fail the pin", () => {
    // population stdev < sample stdev (÷n vs ÷(n−1)) → population Sharpe is
    // higher by exactly √(n/(n−1)). The divergence survives the engine's 3-dp
    // rounding (5.784 vs 5.883). If a regression ever ranked the blend from
    // compute.ts/payload.strategyMetrics (population) instead of scenarioMetrics
    // (sample), the engine's sharpe would equal round3(populationSharpeRef) and
    // the sample-basis assertion above would break. Pin the divergence here.
    expect(populationSharpeRef).toBeGreaterThan(sampleSharpeRef + TOL);
    // Exact divergence ratio is a pure-math property of the two bases (raw refs).
    expect(populationSharpeRef / sampleSharpeRef).toBeCloseTo(
      Math.sqrt(N / (N - 1)),
      9,
    );
    // The divergence is observable at the engine's rounded precision.
    expect(round3(populationSharpeRef)).toBeGreaterThan(round3(sampleSharpeRef));

    // And the engine must match the SAMPLE leg, never the population leg.
    const m = singleStrategyScenario(businessDates("2024-01-02", N));
    expect(m.sharpe!).toBe(round3(sampleSharpeRef));
    expect(m.sharpe!).not.toBe(round3(populationSharpeRef));
  });

  it("max_drawdown is basis-invariant — the engine's value is reload-stable and unit-free", () => {
    // No stdev in the drawdown computation → identical under either basis. Pin
    // it as a deterministic, reproducible value (re-running yields the same).
    const a = singleStrategyScenario(businessDates("2024-01-02", N));
    const b = singleStrategyScenario(businessDates("2024-01-02", N));
    expect(a.max_drawdown).not.toBeNull();
    expect(a.max_drawdown).toBe(b.max_drawdown); // reload-stable
    // Hand-reference: cumulative product of (1+r), peak-to-trough min, rounded
    // to the engine's 5-dp max_drawdown contract (scenario.ts:466).
    let c = 1;
    let peak = -Infinity;
    let maxDD = 0;
    for (const r of RETS) {
      c *= 1 + r;
      if (c > peak) peak = c;
      const dd = c / peak - 1;
      if (dd < maxDD) maxDD = dd;
    }
    expect(a.max_drawdown!).toBe(Number(maxDD.toFixed(5)));
  });
});

describe("#597 — the crypto blend ranks on the √365 basis (periodsPerYear=365)", () => {
  it("computeScenario(...,365) sharpe/sortino equal the hand-derived √365 references", () => {
    const m = singleStrategyScenario(businessDates("2024-01-02", N), 365);
    expect(m.n).toBe(N);
    expect(m.sharpe!).toBe(round3(sampleSharpeRef365));
    expect(m.sortino!).toBe(round3(sortinoRef365));
  });

  it("√365 ranking metrics are STRICTLY HIGHER than √252 (non-vacuous) but max_drawdown is invariant", () => {
    const m252 = singleStrategyScenario(businessDates("2024-01-02", N), 252);
    const m365 = singleStrategyScenario(businessDates("2024-01-02", N), 365);
    // mean·N / (vol·√N) = mean·√N/vol → scales by √(365/252) > 1 for a positive-mean series.
    expect(m365.sharpe!).toBeGreaterThan(m252.sharpe! + TOL);
    expect(m365.sortino!).toBeGreaterThan(m252.sortino! + TOL);
    expect(m365.max_drawdown).toBe(m252.max_drawdown); // basis-invariant
  });

  it("the default (no periodsPerYear arg) equals explicit 252 — existing callers unchanged", () => {
    const mDefault = singleStrategyScenario(businessDates("2024-01-02", N));
    const m252 = singleStrategyScenario(businessDates("2024-01-02", N), 252);
    expect(mDefault.sharpe).toBe(m252.sharpe);
    expect(mDefault.sortino).toBe(m252.sortino);
    expect(mDefault.volatility).toBe(m252.volatility);
  });
});
