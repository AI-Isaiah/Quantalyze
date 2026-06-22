/**
 * Scenario stress-test / VaR engine (Plan 26-01, STRESS-01 + STRESS-02).
 *
 * A pure, side-effect-free sibling of `scenario-benchmark.ts`. It returns a
 * fully null-safe `ScenarioStress` result so the consuming section renders an
 * em-dash on degeneracy and NEVER a fabricated 0. Two paths:
 *
 *   - VaR / CVaR (STRESS-02) — historical / EMPIRICAL (not parametric, no
 *     Normal-tail assumption) over the already-leveraged
 *     `portfolio_daily_returns` series. We WRAP the golden-tested
 *     `computeVaR` / `computeExpectedShortfall` from `@/lib/portfolio-stats`
 *     (do NOT fork the quantile/tail arithmetic). Those helpers return a
 *     fabricated `0` (NOT null) on an empty/degenerate series — the trap. So
 *     this lib short-circuits to `null` on degeneracy BEFORE calling them, so
 *     no fabricated 0 can ever escape:
 *       1. `portfolioDaily.length === 0` (the engine emits `[]` for
 *          n<10 / constant / non-finite series) → var/cvar null.
 *       2. A numerically-CONSTANT series with n>=60 (float-residue variance
 *          ~1e-37 that an exact `=== 0` would miss) → var/cvar null, detected
 *          via the SAME relative-scale guard `scenario-benchmark.ts` uses.
 *     VaR/CVaR are computed on `portfolioDaily.map(d => d.value)` with NO
 *     leverage multiplier — leverage is ALREADY baked into
 *     `portfolio_daily_returns` via `w·L·r` in `computeScenario` (re-applying
 *     it double-counts). The quantile of a linearly-scaled daily series scales
 *     linearly, so 2x uniform leverage ~doubles VaR/CVaR automatically.
 *
 *   - β-propagated shock (STRESS-01) — `projectedImpact = β_portfolio · shock`,
 *     where `β_portfolio = computeScenarioBenchmark(portfolioDaily, btcDaily).beta`
 *     over the BTC inner-join INTERSECTION (never a zero-filled union). We reuse
 *     `computeScenarioBenchmark` directly so we inherit its relative-scale
 *     degeneracy guard — we do NOT call `computeAlphaBeta` directly (it
 *     fabricates a finite β ~2 on a numerically-constant benchmark via float
 *     residue passing its `varB > 0` branch). A null β ⇒ null impact ⇒ "—". A
 *     near-market-neutral book (cov ≈ 0 ⇒ β ≈ 0) ⇒ |impact| ≈ 0, NOT the full
 *     shock — the load-bearing success-criterion behavior.
 *
 * Loss-sign convention: VaR / CVaR / projectedImpact are SIGNED returns
 * (negative for a downside tail, or for a positive-β book under a −30% shock).
 * Never flip the sign.
 *
 * The two-N trap: `varN` (the VaR window = the scenario overlap,
 * `portfolioDaily.length`) and `betaN` (the β-shock window = the BTC inner-join
 * overlap, which can be STRICTLY smaller) are tracked as two distinct fields.
 * Conflating them is a misrepresentation bug.
 */

import { computeVaR, computeExpectedShortfall } from "@/lib/portfolio-stats";
import { mean, type DailyPoint } from "@/lib/portfolio-math-utils";
import { computeScenarioBenchmark, innerJoinByDate } from "./scenario-benchmark";

export interface ScenarioStress {
  /** VaR window overlap (the scenario N = `portfolioDaily.length`). */
  varN: number;
  /** β-shock window overlap (the BTC inner-join N; can be strictly smaller). */
  betaN: number;
  /** CAPM β cov(p,b)/var(b) over the BTC overlap. `null` on degeneracy. */
  beta: number | null;
  /** β_portfolio · shock — signed return. `null` when β is null. */
  projectedImpact: number | null;
  /** Historical VaR at `confidence` (signed return quantile). `null` on degeneracy. */
  var: number | null;
  /** CVaR / Expected Shortfall — mean of the tail at/beyond VaR. `null` on degeneracy. */
  cvar: number | null;
}

const NULL_VAR = { var: null as number | null, cvar: null as number | null };

/**
 * Compute the stress / VaR result over the already-leveraged scenario daily
 * returns + the BTC factor series.
 *
 * Each field is null-safe, so this can run unconditionally; the section gates
 * RENDER on `evaluateSampleFloor(varN / betaN, SAMPLE_FLOOR_OVERLAPPING_DAYS)`
 * before showing the numbers. The lib returns the value + the N; the section
 * owns the floor-gating.
 *
 * @param portfolioDaily  Already-leveraged `portfolio_daily_returns` (`[]` when
 *                        the engine suppresses a degenerate scenario).
 * @param btcDaily        The BTC factor daily-return series (the shock factor).
 * @param opts.confidence VaR/CVaR confidence (default 0.95 — the locked headline).
 * @param opts.shock      Factor shock magnitude (default −0.30 — "BTC −30%").
 */
export function computeScenarioStress(
  portfolioDaily: DailyPoint[],
  btcDaily: DailyPoint[],
  opts?: { confidence?: number; shock?: number },
): ScenarioStress {
  const confidence = opts?.confidence ?? 0.95;
  const shock = opts?.shock ?? -0.3;

  // ── VaR / CVaR path (STRESS-02) — WRAP, never fork ──────────────────
  // The VaR window N is the scenario overlap (portfolioDaily.length). The
  // engine already emits `[]` for n<10 / constant / non-finite, so length===0
  // is the scenario-side degenerate short-circuit.
  const varN = portfolioDaily.length;
  const { var: var_, cvar } = computeVarPath(portfolioDaily, confidence);

  // ── β-shock path (STRESS-01) — REUSE the β source, never re-derive ──
  // computeScenarioBenchmark already inner-joins, computes cov/var via the
  // golden-tested computeAlphaBeta, AND null-guards the constant-benchmark
  // degeneracy via its relative-scale test. Its `.n` IS the inner-join overlap
  // (the BTC-overlap N) — but we read betaN from innerJoinByDate explicitly so
  // the two-N intent is unambiguous at the call site.
  const betaN = innerJoinByDate(portfolioDaily, btcDaily).p.length;
  const beta = computeScenarioBenchmark(portfolioDaily, btcDaily).beta;
  // null β (degenerate / constant BTC / below n<2 overlap) ⇒ null impact ⇒ "—".
  const projectedImpact = beta === null ? null : beta * shock;

  return { varN, betaN, beta, projectedImpact, var: var_, cvar };
}

/**
 * The null-on-degenerate VaR/CVaR envelope around the existing `computeVaR` /
 * `computeExpectedShortfall`. Returns `{ var: null, cvar: null }` on a degenerate
 * series so a fabricated 0 never escapes; otherwise the floor-quantile VaR + the
 * tail-mean CVaR over the (leverage-already-baked-in) signed daily returns.
 */
function computeVarPath(
  portfolioDaily: DailyPoint[],
  confidence: number,
): { var: number | null; cvar: number | null } {
  // 1. The engine emits [] for n<10 / constant / non-finite → scenario-side null.
  if (portfolioDaily.length === 0) return NULL_VAR;

  const values = portfolioDaily.map((d) => d.value);

  // 1b. Finite-aware short-circuit — honor the "fully null-safe" contract for a
  // NaN/Infinity injected DIRECTLY through this public signature, independent of
  // the upstream `computeScenario` producer. A non-finite contaminant defeats the
  // relative-scale guard below (NaN <= NaN is false, so it would NOT short-circuit)
  // and reaches `computeVaR`, whose `sort((a,b) => a - b)` returns NaN for any pair
  // involving the contaminant → an undefined ordering / corrupted (possibly
  // non-NaN-but-wrong) quantile that the section would render as a confident,
  // fabricated number. Surface null instead so no fabricated value can escape.
  if (!values.every(Number.isFinite)) return NULL_VAR;

  // 2. Relative-scale degeneracy guard (copied from scenario-benchmark.ts:139-140).
  // A numerically-constant n>=60 window leaves a float-residue variance (~1e-37)
  // that an exact `=== 0` would miss, letting computeVaR return a meaningless
  // (constant) quantile that the section would render as a fabricated number.
  // The honest test is: the series' own spread (std) is negligible relative to
  // its level → surface null so the UI renders "—".
  const meanSeries = mean(values);
  const varSeries = mean(values.map((x) => (x - meanSeries) ** 2));
  const seriesIsDegenerate =
    Math.sqrt(varSeries) <= 1e-12 * (Math.abs(meanSeries) + 1e-12);
  if (seriesIsDegenerate) return NULL_VAR;

  // 3. Non-empty, non-constant series → the floor-quantile VaR + tail-mean CVaR.
  // NO leverage multiplier — leverage is baked into portfolio_daily_returns.
  return {
    var: computeVaR(values, confidence),
    cvar: computeExpectedShortfall(values, confidence),
  };
}
