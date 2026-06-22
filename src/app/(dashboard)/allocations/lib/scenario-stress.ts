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
import { computeScenarioBenchmark } from "./scenario-benchmark";

export interface ScenarioStress {
  /** VaR window overlap (the scenario N = `portfolioDaily.length`). */
  varN: number;
  /** β-shock window overlap (the BTC inner-join N; can be strictly smaller). */
  betaN: number;
  /** CAPM β cov(p,b)/var(b) over the BTC overlap. `null` on degeneracy. */
  beta: number | null;
  /** β_portfolio · shock — signed return. `null` when β is null. */
  projectedImpact: number | null;
  /** Historical VaR at `VAR_CONFIDENCE` (signed return quantile). `null` on degeneracy. */
  var: number | null;
  /** CVaR / Expected Shortfall — mean of the tail at/beyond VaR. `null` on degeneracy. */
  cvar: number | null;
}

const NULL_VAR = { var: null as number | null, cvar: null as number | null };

/**
 * The VaR/CVaR confidence level. Locked to a single named constant — NOT an
 * `opts` knob — so it can never drift from the hard-coded "95% confidence."
 * disclosure label the section renders (`StressVarSection.tsx`). The headline
 * UI label is `VAR_CONFIDENCE_LABEL`, derived from this value, so the displayed
 * confidence and the computed quantile are the same source of truth. If a future
 * surface needs a non-95% confidence, expose it as an opt AND derive the label
 * from it in the same change — never reintroduce one without the other.
 */
export const VAR_CONFIDENCE = 0.95;
/** The displayed confidence label, derived from `VAR_CONFIDENCE` (no drift). */
export const VAR_CONFIDENCE_LABEL = `${Math.round(VAR_CONFIDENCE * 100)}%`;

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
 * @param opts.shock      Factor shock magnitude (default −0.30 — "BTC −30%").
 *
 * VaR/CVaR confidence is NOT an opt: it is locked to `VAR_CONFIDENCE` (0.95) so
 * the computed quantile can never desync from the section's hard-coded "95%"
 * disclosure label (WR-02). A non-default confidence would have to be added here
 * AND wired into the rendered label in the same change.
 */
export function computeScenarioStress(
  portfolioDaily: DailyPoint[],
  btcDaily: DailyPoint[],
  opts?: { shock?: number },
): ScenarioStress {
  const shock = opts?.shock ?? -0.3;

  // ── VaR / CVaR path (STRESS-02) — WRAP, never fork ──────────────────
  // The VaR window N is the scenario overlap (portfolioDaily.length). The
  // engine already emits `[]` for n<10 / constant / non-finite, so length===0
  // is the scenario-side degenerate short-circuit.
  const varN = portfolioDaily.length;
  const { var: var_, cvar } = computeVarPath(portfolioDaily);

  // ── β-shock path (STRESS-01) — REUSE the β source, never re-derive ──
  // computeScenarioBenchmark already inner-joins, computes cov/var via the
  // golden-tested computeAlphaBeta, AND null-guards the constant-benchmark
  // degeneracy via its relative-scale test. Call it ONCE and read both fields
  // off the single result: `.n` IS the inner-join overlap (the BTC-overlap N =
  // betaN) and `.beta` is the CAPM β. (Previously this also called
  // innerJoinByDate separately just to count the overlap — a second, redundant
  // inner-join over the same two series. betaN === bench.n by construction:
  // computeScenarioBenchmark sets n = innerJoinByDate(...).p.length.)
  const bench = computeScenarioBenchmark(portfolioDaily, btcDaily);
  const betaN = bench.n;
  // Finite-aware short-circuit on the β path — mirror computeVarPath's guard for
  // the SECOND (factor) axis. A NaN/Infinity injected through btcDaily defeats
  // computeScenarioBenchmark's relative-scale degeneracy test (the float-residue
  // guard short-circuits on a tiny std, not on NaN: Math.sqrt(NaN) <= x is
  // false), so it falls through to computeAlphaBeta, whose `varB > 0 ? : 0`
  // branch returns a FABRICATED finite β = 0 (not NaN, not null) for a
  // contaminated factor series → a fabricated projectedImpact = 0, the exact
  // false-confidence the "fully null-safe" contract forbids. A non-finite
  // contaminant anywhere in the factor feed makes it untrustworthy, so surface
  // null β ⇒ null impact ("—"). Checked on the raw btcDaily values (no second
  // inner-join — the dedupe keeps computeScenarioBenchmark the sole join site).
  const btcIsFinite = btcDaily.every((d) => Number.isFinite(d.value));
  const beta = btcIsFinite ? bench.beta : null;
  // null β (degenerate / constant BTC / below n<2 overlap / non-finite factor)
  // ⇒ null impact ⇒ "—".
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
    var: computeVaR(values, VAR_CONFIDENCE),
    cvar: computeExpectedShortfall(values, VAR_CONFIDENCE),
  };
}
