/**
 * Scenario ↔ BTC benchmark active-return engine (Plan 24-01, BENCH-01).
 *
 * Two pure-TS primitives:
 *
 *   - `innerJoinByDate(port, bench)` aligns two dated daily-return series by
 *     INTERSECTION (inner-join) — only dates present in BOTH survive, with NO
 *     zero-fill and NO interpolation. This is the load-bearing honesty step:
 *     the scenario engine's own date axis is a zero-filled UNION (late
 *     strategies contribute 0 before their inception, `scenario.ts:181-189`),
 *     but the benchmark must NOT be zero-filled — a non-overlapping day is an
 *     absence, not a 0% return. Mirrors `analytics-service/routers/portfolio.py
 *     :915-916` (`reindex(...).dropna()`).
 *
 *   - `computeScenarioBenchmark(portfolioDaily, btcDaily)` inner-joins the two
 *     series, then assembles tracking error / information ratio / alpha / beta
 *     / correlation over the aligned window with 252-day annualization,
 *     REUSING the golden-tested `computeAlphaBeta` + `computeTrackingError`
 *     from `@/lib/portfolio-stats` (do not re-implement the OLS / std math).
 *
 * Honesty invariants (tested):
 *   - A degenerate window (n<2) yields `null` for every field — never a
 *     fabricated 0 — so the UI renders an em-dash.
 *   - A CONSTANT benchmark (population var(b)=0) yields `null` for beta/alpha.
 *     `computeAlphaBeta` returns {alpha:0, beta:0} for BOTH n<2 AND var(b)=0 —
 *     those two are indistinguishable from its return value, so the
 *     constant-benchmark case is detected HERE (varB computed first) rather
 *     than inferred from the helper's silent 0.
 *   - te=0 (p≡b) yields a `null` information ratio (guard te>0 before dividing).
 *   - All annualization is ×252 / ×√252 via the reused helpers — never √365.
 */

import { computeAlphaBeta, computeTrackingError } from "@/lib/portfolio-stats";
import { mean, type DailyPoint } from "@/lib/portfolio-math-utils";

export interface ScenarioBenchmark {
  /** Aligned (intersection) overlap count — the {N} the UI heading reports. */
  n: number;
  /** Annualized std of (p−b). `null` for n<2. */
  trackingError: number | null;
  /** mean(p−b)·252 / te. `null` for n<2 or te=0. */
  informationRatio: number | null;
  /** CAPM alpha (mean(p) − β·mean(b))·252. `null` for n<2 or var(b)=0. */
  alpha: number | null;
  /** CAPM beta cov(p,b)/var(b). `null` for n<2 or var(b)=0. */
  beta: number | null;
  /** Pearson sample correlation. `null` for n<2 or zero variance on either side. */
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
): ScenarioBenchmark {
  const { p, b } = innerJoinByDate(portfolioDaily, btcDaily);
  const n = p.length;
  if (n < 2) return NULL_RESULT(n);

  // Tracking error + information ratio always come from the reused helper.
  const te = computeTrackingError(p, b); // std(p−b)·√252
  const excessMean = mean(p.map((v, i) => v - b[i]));
  const informationRatio = te > 0 ? (excessMean * 252) / te : null;

  // var(b): POPULATION variance of the aligned benchmark. Computed FIRST so
  // the constant-benchmark degenerate case is detected here, not inferred from
  // computeAlphaBeta's silent {alpha:0, beta:0} (which is indistinguishable
  // from its n<2 return). A constant benchmark must surface "—", not a 0.
  //
  // Degeneracy is detected by RELATIVE scale, not exact `varB === 0`: a
  // genuinely constant series (e.g. every value 0.003) does NOT yield an exact
  // zero variance once it passes through floating-point mean subtraction
  // (mean([0.003×6]) === 0.0029999999999999996, leaving ~1e-37 residual var,
  // which computeAlphaBeta then divides into a meaningless beta of ~2). The
  // honest test is: the benchmark's spread (std) is negligible relative to its
  // own level. This treats any numerically-constant benchmark as degenerate
  // while never mis-flagging a real BTC series.
  const meanB = mean(b);
  const varB = mean(b.map((x) => (x - meanB) ** 2));
  const benchmarkIsDegenerate =
    Math.sqrt(varB) <= 1e-12 * (Math.abs(meanB) + 1e-12);
  let alpha: number | null;
  let beta: number | null;
  if (benchmarkIsDegenerate) {
    alpha = null;
    beta = null;
  } else {
    const ab = computeAlphaBeta(p, b); // beta=cov/var, alpha=(meanP−β·meanB)·252
    alpha = ab.alpha;
    beta = ab.beta;
  }

  // Pearson sample correlation (mirror scenario.ts:389 — sample cov / std·std).
  // Null (not 0) when either side has effectively zero variance: an undefined
  // correlation is an absence, rendered as an em-dash, not a fabricated 0. The
  // degeneracy test is the SAME relative-scale check used for beta/alpha, so a
  // numerically-constant series (whose float residue leaves a ~1e-18 nonzero
  // std) is consistently treated as having no variance.
  const meanP = mean(p);
  let sampCov = 0;
  let varPsum = 0;
  let varBsum = 0;
  for (let i = 0; i < n; i++) {
    const dp = p[i] - meanP;
    const db = b[i] - meanB;
    sampCov += dp * db;
    varPsum += dp * dp;
    varBsum += db * db;
  }
  sampCov /= n - 1;
  const stdP = Math.sqrt(varPsum / (n - 1));
  const stdB = Math.sqrt(varBsum / (n - 1));
  const pIsDegenerate = stdP <= 1e-12 * (Math.abs(meanP) + 1e-12);
  const correlation =
    !pIsDegenerate && !benchmarkIsDegenerate ? sampCov / (stdP * stdB) : null;

  return {
    n,
    trackingError: te,
    informationRatio,
    alpha,
    beta,
    correlation,
  };
}
