/**
 * Scenario ↔ BTC benchmark active-return engine (Plan 24-01, BENCH-01).
 *
 * Two pure-TS primitives:
 *
 *   - `innerJoinByDate(port, bench)` aligns two dated daily-return series by
 *     INTERSECTION (inner-join) — only dates present in BOTH survive, with NO
 *     zero-fill and NO interpolation. This is the load-bearing honesty step:
 *     as of Phase 57 the scenario tab passes an explicit coverage window, so
 *     `computeScenario` blends over it (a strategy is a member iff its data
 *     span ⊇ the window, with a constant member-count divisor — v1.5 ADR-001)
 *     and the portfolio series this consumer receives is ALREADY the member-
 *     intersection window, no longer a union tail padded with 0. (Own-book
 *     callers that pass no `state.window` stay on the legacy union path.) The
 *     inner-join here stays load-bearing regardless (it intersects that
 *     portfolio series with BTC, ∩ against the smaller of the two), and the
 *     benchmark must still NOT be zero-filled — a non-overlapping day is an
 *     absence, not a 0% return. Mirrors
 *     `analytics-service/routers/portfolio.py:915-916`
 *     (`reindex(...).dropna()`).
 *
 *   - `computeScenarioBenchmark(portfolioDaily, btcDaily, periodsPerYear = 252)`
 *     inner-joins the two series, then assembles tracking error / information
 *     ratio / alpha / beta / correlation over the aligned window, annualizing
 *     the RISK metrics on `periodsPerYear` (252 traditional default, byte-
 *     identical to pre-#597; 365 for a crypto-legged blend, #597 part 2),
 *     REUSING the golden-tested `computeAlphaBeta` + `computeTrackingError`
 *     from `@/lib/portfolio-stats` (do not re-implement the OLS / std math).
 *
 * Honesty invariants (tested):
 *   - A degenerate window (n<2) yields `null` for every field — never a
 *     fabricated 0 — so the UI renders an em-dash.
 *   - A CONSTANT benchmark yields `null` for beta/alpha. `computeAlphaBeta`
 *     answers a constant benchmark with {beta: 0, alpha: meanR*periodsPerYear},
 *     a number, not an absence, so the constant-benchmark case MUST be detected
 *     HERE (varB computed first) and surfaced as null.
 *   - te=0 (p≡b), or an excess series that is constant, yields a `null`
 *     information ratio.
 *   - Every degeneracy test, the correlation and the information ratio come
 *     from `@/lib/return-stats`, the one TS home of dispersion-based ratios
 *     (Phase 166.1 D-17): its floor is `1e-12 * max(1, |mean|)`. The floor this
 *     file carried before scaled with `|mean|` alone, so a compounding-NAV
 *     constant yield, whose returns carry about 1e-16 of ABSOLUTE rounding
 *     residue whatever the yield, passed it at daily 1e-5, daily 1e-4 and APYs
 *     up to 3% (measured 2026-09-26) and reported a residue beta, correlation
 *     and information ratio. `max(1, |mean|)` catches that absolute residue.
 *   - RISK-metric annualization rides `periodsPerYear` (×N / ×√N) via the reused
 *     helpers — 252 by default (byte-identical to pre-#597), 365 for a crypto
 *     blend (#597 part 2). beta and correlation are basis-invariant ratios.
 */

import { computeAlphaBeta, computeTrackingError } from "@/lib/portfolio-stats";
import { mean, type DailyPoint } from "@/lib/portfolio-math-utils";
import { dispersionIsResidue, pearson, sharpe } from "@/lib/return-stats";

export interface ScenarioBenchmark {
  /** Aligned (intersection) overlap count — the {N} the UI heading reports. */
  n: number;
  /** Annualized std of (p−b). `null` for n<2. */
  trackingError: number | null;
  /** mean(p−b)·periodsPerYear / te (the shared Sharpe of p−b). `null` for n<2 or an excess with no dispersion. */
  informationRatio: number | null;
  /** CAPM alpha (mean(p) − β·mean(b))·periodsPerYear. `null` for n<2 or var(b)=0. */
  alpha: number | null;
  /** CAPM beta cov(p,b)/var(b). `null` for n<2 or var(b)=0. */
  beta: number | null;
  /** Pearson correlation (the shared `pearson`). `null` for n<2 or no dispersion on either side. */
  correlation: number | null;
}

/**
 * Inner-join two dated daily-return series by date (INTERSECTION only).
 * Iterates `port` in order, keeping a date only when `bench` also has it.
 * NO zero-fill, NO interpolation. The two returned arrays are positionally
 * aligned (`p[i]` and `b[i]` share `dates[i]`) so they can be fed straight
 * into the positional `computeAlphaBeta` / `computeTrackingError` helpers.
 */
export function innerJoinByDate(
  port: DailyPoint[],
  bench: DailyPoint[],
): { dates: string[]; p: number[]; b: number[] } {
  const bMap = new Map(bench.map((d) => [d.date, d.value]));
  const dates: string[] = [];
  const p: number[] = [];
  const b: number[] = [];
  for (const d of port) {
    const bv = bMap.get(d.date);
    if (bv === undefined) continue; // intersection only — no zero-fill
    dates.push(d.date);
    p.push(d.value);
    b.push(bv);
  }
  return { dates, p, b };
}

const NULL_RESULT = (n: number): ScenarioBenchmark => ({
  n,
  trackingError: null,
  informationRatio: null,
  alpha: null,
  beta: null,
  correlation: null,
});

/**
 * Assemble the four active-return metrics + correlation over the
 * date-intersection of the scenario daily returns and the BTC daily returns.
 *
 * Each field is null-safe, so this can run unconditionally; the caller gates
 * RENDER on `evaluateSampleFloor(n, 30)` before showing the numbers.
 */
export function computeScenarioBenchmark(
  portfolioDaily: DailyPoint[],
  btcDaily: DailyPoint[],
  periodsPerYear = 252,
): ScenarioBenchmark {
  const { p, b } = innerJoinByDate(portfolioDaily, btcDaily);
  const n = p.length;
  if (n < 2) return NULL_RESULT(n);

  // Tracking error comes from the reused helper; the information ratio is the
  // shared Sharpe of the excess series. `periodsPerYear` is the annualization
  // basis (252 traditional default, byte-identical to pre-#597; 365 for a
  // crypto-legged blend) threaded to EVERY risk-metric annualization below
  // (te √N, IR ×N/√N, alpha ×N).
  const te = computeTrackingError(p, b, periodsPerYear); // std(p−b)·√periodsPerYear
  // IR = mean(p−b)·N / (sampleStd(p−b)·√N), which is exactly the shared
  // `sharpe` of the excess series with rf 0 and ddof 1 (the same mean, the same
  // sd and the same operation order, so it is bitwise the value this file
  // computed by hand before; `trackingError` keeps reporting te). Degeneracy is
  // the shared floor, not an exact `te > 0`: a numerically-constant-but-NONZERO
  // excess (e.g. steady +0.003/day outperformance, or a constant yield on top of
  // the benchmark) leaves std(excess) ≈ 1e-16 of mean-subtraction residue, which
  // passes `> 0` and fabricates IR ≈ 1e13 to 1e15, a finite number formatNumber
  // would render. The shared Sharpe answers null there, so the UI renders "—".
  // The floor is a test on the daily sd → basis-invariant (fires identically at
  // 252 and 365).
  const diff = p.map((v, i) => v - b[i]);
  const informationRatio = sharpe(diff, { periodsPerYear, ddof: 1 });

  // var(b): POPULATION variance of the aligned benchmark. Computed FIRST so
  // the constant-benchmark degenerate case is detected here. computeAlphaBeta
  // is NOT a safe net: it answers a constant benchmark with beta 0 and
  // alpha = meanR*periodsPerYear, a number where the honest answer is an
  // absence. A constant benchmark must surface "—", not a 0.
  //
  // Degeneracy is the shared floor, not exact `varB === 0`: a genuinely
  // constant series (e.g. every value 0.003) does NOT yield an exact zero
  // variance once it passes through floating-point mean subtraction
  // (mean([0.003×6]) === 0.0029999999999999996, leaving ~1e-37 residual var),
  // and a compounding-NAV constant yield leaves a spread of about 1e-16. The
  // honest test is: the benchmark's spread (std) is float residue at its own
  // level, `std <= 1e-12 * max(1, |mean|)`. This treats any numerically-constant
  // benchmark as degenerate while never mis-flagging a real BTC series.
  const meanB = mean(b);
  const varB = mean(b.map((x) => (x - meanB) ** 2));
  const benchmarkIsDegenerate = dispersionIsResidue(Math.sqrt(varB), meanB);
  let alpha: number | null;
  let beta: number | null;
  if (benchmarkIsDegenerate) {
    alpha = null;
    beta = null;
  } else {
    const ab = computeAlphaBeta(p, b, periodsPerYear); // beta=cov/var, alpha=(meanP−β·meanB)·periodsPerYear
    alpha = ab.alpha;
    beta = ab.beta;
  }

  // Pearson correlation: the shared `pearson` (the sums form, equal to the
  // sample form this file carried before to the display precision). Null (not
  // 0) when either side has no dispersion on the shared floor: an undefined
  // correlation is an absence, rendered as an em-dash, not a fabricated 0. A
  // numerically-constant series (whose float residue leaves a ~1e-16 nonzero
  // std) is consistently treated as having no variance, on either leg.
  const correlation = pearson(p, b);

  return {
    n,
    trackingError: te,
    informationRatio,
    alpha,
    beta,
    correlation,
  };
}
