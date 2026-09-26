/**
 * The ONE TypeScript home of every dispersion-based ratio: dispersion, Sharpe,
 * Pearson correlation and beta over a daily-return series.
 *
 * WHY ONE MODULE (founder direction 2026-09-25, Phase 166.1 D-17, verbatim:
 * "Why don't you calculate Sharpe once and the 20 places all read it from
 * there?"). About twenty TS sites each carried their own copy of a Sharpe,
 * correlation or beta formula behind a `> 0` guard. On a compounding-NAV
 * constant yield (returns taken as `E_t / E_{t-1} - 1` over an exactly
 * compounding NAV) the sample sd is not 0 but about 1.3e-16, so every copy
 * passed its guard and computed a Sharpe of 1e12 to 1e14 or a residue
 * correlation. Pasting a floor into twenty copies would leave twenty formulas
 * to drift apart; computing each figure here removes the copies and the defect
 * together. Every Tier-2 site (the series exists only on the TS side at that
 * moment) calls these functions and keeps no local formula.
 *
 * THE FLOOR is the TS twin of the Python rule in
 * `analytics-service/services/dispersion.py` (before Phase 166.1 plan 01 lands,
 * `services/metrics.py`): a standard deviation at or below
 * `DISPERSION_RESIDUE_REL * max(1, |mean|)` is float residue, not dispersion.
 * The constant is pinned to the Python source by `return-stats.test.ts`, which
 * reads the Python file as text, so the two languages cannot drift silently.
 * `max(1, |mean|)` rather than `|mean|` is Phase 166 review round 2, CR-01: a
 * return is a ratio to 1, so the residue of a compounding NAV is about 1e-16
 * ABSOLUTE whatever the yield, and a floor scaled by a small `|mean|` sank under
 * it (a 1e-4 daily yield persisted a Sharpe of 1.49e13).
 *
 * `dispersion` REPORTS A RESIDUE SD AS EXACTLY 0 (Phase 166.1 D-07): no
 * dispersion means the value an exactly constant series gives. Every ratio
 * built on it therefore answers a compounding constant yield exactly as it
 * answers an all-zero series.
 *
 * A NULL RATIO IS AN ABSENCE, END TO END (founder decision D7, 2026-09-26,
 * "Show — everywhere", amending D-07 for display). A statistic that does not
 * exist stays empty through every caller (null, a NaN in a `number` field, or
 * a missing cell) and renders "—" or a gap on every page, never 0.00 and never
 * "unchanged". D-07 had each caller map null to the value it emitted for an
 * exact constant, which was 0 at eight sites and made the factsheet say
 * "Sharpe 0.00" where the OG card for the same series said "—". A caller must
 * not turn null into a number. A NaN field reaches a renderer as NaN, or as
 * null once a JSON cache has round-tripped it, so renderers test
 * `Number.isFinite`, which is false for both.
 *
 * ARITHMETIC ORDER is the factsheet's, so adopting sites keep their numbers to
 * the last bit wherever their order already matched: the Sharpe is
 * `src/lib/factsheet/compute.ts`'s expression, the correlation is the SUMS form
 * of `build-payload.ts` `pearsonCorr` and of the retired `/compare` Pearson, and
 * the beta is `factsheet/joint.ts`'s `cov / varX` with both sums divided by n.
 * The mean and sd are `portfolio-math-utils`' `mean` and `stdDev`, so there is
 * one mean and one sd, not a third copy.
 *
 * All functions are pure: no Date, no randomness, no I/O.
 */
import { mean, stdDev } from "@/lib/portfolio-math-utils";

/**
 * A standard deviation at or below `DISPERSION_RESIDUE_REL * max(1, |mean|)` is
 * float residue, not dispersion. Pinned to the Python constant by a test.
 */
export const DISPERSION_RESIDUE_REL = 1e-12;

/** `DISPERSION_RESIDUE_REL * max(1, |mean|)`. A NaN `mean` gives a NaN floor. */
export function residueFloor(meanValue: number): number {
  return DISPERSION_RESIDUE_REL * Math.max(1, Math.abs(meanValue));
}

/**
 * True when `sd` is zero or only the float residue of a constant series. A NaN
 * on either side answers false: each caller handles NaN on its own path.
 */
export function dispersionIsResidue(sd: number, meanValue: number): boolean {
  return sd <= residueFloor(meanValue);
}

/**
 * True when `sd` is above the residue floor: a leg that really moves. The
 * complement of `dispersionIsResidue` EXCEPT on NaN, where both are false.
 */
export function dispersionIsReal(sd: number, meanValue: number): boolean {
  return sd > residueFloor(meanValue);
}

/**
 * The mean and standard deviation of `xs`, with a residue sd reported as
 * exactly 0 (D-07). `ddof` 1 is the sample sd (n - 1), 0 the population sd.
 * Otherwise `sd` is bitwise `stdDev(xs, ddof === 1)` and `mean` is `mean(xs)`;
 * a NaN sd stays NaN.
 */
export function dispersion(
  xs: number[],
  ddof: 0 | 1,
): { n: number; mean: number; sd: number } {
  const m = mean(xs);
  const sd = stdDev(xs, ddof === 1);
  return { n: xs.length, mean: m, sd: dispersionIsResidue(sd, m) ? 0 : sd };
}

/**
 * Annualised Sharpe ratio:
 * `((mean - rf / periodsPerYear) * periodsPerYear) / (sd * sqrt(periodsPerYear))`,
 * the arithmetic order of `factsheet/compute.ts`. `rf` is annual (default 0).
 *
 * Null when there are fewer than 2 points, when any input is non-finite, or
 * when the dispersion is 0 or residue. A caller keeps the null as an absence
 * (D7): it renders "—", never 0.
 */
export function sharpe(
  xs: number[],
  opts: { periodsPerYear: number; ddof: 0 | 1; rf?: number },
): number | null {
  if (xs.length < 2 || xs.some((x) => !Number.isFinite(x))) return null;
  const { mean: m, sd } = dispersion(xs, opts.ddof);
  if (sd === 0) return null;
  const n = opts.periodsPerYear;
  const rf = opts.rf ?? 0;
  return ((m - rf / n) * n) / (sd * Math.sqrt(n));
}

/**
 * Pearson correlation over the first `min(a.length, b.length)` points, in the
 * sums form `cov / sqrt(varA * varB)`.
 *
 * Null when correlation is UNDEFINED (audit 2026-05-07 G11.E.5 contract): fewer
 * than 2 points, or either leg's population dispersion is 0 or residue, or the
 * denominator is not positive (a NaN leg). "No correlation" and "correlation
 * cannot be measured" are different answers, so a caller keeps the null as an
 * absence (D7) and never renders it as 0.
 */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const da = dispersion(a.length === n ? a : a.slice(0, n), 0);
  const db = dispersion(b.length === n ? b : b.slice(0, n), 0);
  if (da.sd === 0 || db.sd === 0) return null;
  const ma = da.mean;
  const mb = db.mean;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const dA = a[i] - ma;
    const dB = b[i] - mb;
    cov += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }
  const denom = Math.sqrt(varA * varB);
  return denom > 0 ? cov / denom : null;
}

/**
 * Beta of `y` on `x`: `cov(y, x) / var(x)` with both sums divided by the same n
 * (ddof-invariant; the form of `factsheet/joint.ts`).
 *
 * The arrays must be the same length (a RangeError otherwise: callers align
 * or slice first). Null when there are fewer than 2 points, when either leg
 * holds a non-finite value, or when `x`'s population dispersion is 0 or
 * residue. Both legs are checked for finiteness explicitly, as `sharpe` does.
 * Before Phase 166.2's review round 1 (SFH-M5) only `x` was guarded, through
 * its variance, so a NaN in `y` came back as NaN, not null, and passed every
 * caller's null check.
 */
export function beta(y: number[], x: number[]): number | null {
  if (y.length !== x.length) {
    throw new RangeError("beta(): y and x must be the same length");
  }
  const n = x.length;
  if (n < 2) return null;
  if (y.some((v) => !Number.isFinite(v)) || x.some((v) => !Number.isFinite(v))) return null;
  const dx = dispersion(x, 0);
  if (dx.sd === 0) return null;
  const mx = dx.mean;
  const my = mean(y);
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < n; i++) {
    const dX = x[i] - mx;
    cov += (y[i] - my) * dX;
    varX += dX * dX;
  }
  cov /= n;
  varX /= n;
  return varX > 0 ? cov / varX : null;
}
