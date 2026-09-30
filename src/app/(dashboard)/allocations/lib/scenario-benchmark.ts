/**
 * Scenario ↔ BTC benchmark active-return engine (Plan 24-01, BENCH-01; pairing
 * rewritten by Phase 169.4 ALLOCTRUTH, SC12 / D-68).
 *
 * The pairing rule (D-68). The Scenario pairs its portfolio daily returns with
 * BTC through ONE function, `pairScenarioWithBtc`, over the BTC CLOSES that
 * `/api/benchmark/btc/prices` serves (D-67). It is the engine's rule (Phase
 * 166.4 D-A with D-05) applied through 169.5's `alignCoveredReturns` on BTC's
 * own 7-day calendar, the same helper and calendar the factsheet comparator
 * block uses: day one pairs with BTC's return dated that day, each later
 * portfolio interval pairs with BTC's compounded move over the same interval,
 * and an interval with a BTC close missing or dropped inside it is unpaired
 * (so a BTC return that bridges a missing stored day is never paired as one
 * day's move, SC11 / D-66). The benchmark is never zero-filled or interpolated:
 * an unpaired date is an absence, not a 0% return. The earlier date-
 * intersection join is gone; the portfolio compute in `analytics-service`
 * still pairs by intersection and is surfaced for routing in 169.4-CONTEXT.md.
 *
 *   - `computeScenarioBenchmark(portfolioDaily, btcCloses, periodsPerYear = 252)`
 *     pairs the two series, then assembles tracking error / information
 *     ratio / alpha / beta / correlation over the paired window, annualizing
 *     the RISK metrics on `periodsPerYear` (252 traditional default, byte-
 *     identical to pre-#597; 365 for a crypto-legged blend, #597 part 2),
 *     REUSING the golden-tested `computeAlphaBeta` + `computeTrackingError`
 *     from `@/lib/portfolio-stats` (do not re-implement the OLS / std math).
 *
 * Honesty invariants (tested):
 *   - A degenerate window (n<2) yields `null` for every field — never a
 *     fabricated 0 — so the UI renders an em-dash.
 *   - A CONSTANT benchmark yields `null` for beta/alpha, the absence
 *     `computeAlphaBeta` itself returns for an undefined beta (D7).
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

import { alignCoveredReturns, COMPARATOR_CALENDARS } from "@/lib/factsheet/align";
import type { BenchmarkPricesOpt, DailyPrice } from "@/lib/factsheet/types";
import { computeAlphaBeta, computeTrackingError } from "@/lib/portfolio-stats";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { pearson, sharpe } from "@/lib/return-stats";

/** BTC closes as `/api/benchmark/btc/prices` serves them: the available arm of `BenchmarkPricesOpt`. */
export type BtcCloses = Extract<BenchmarkPricesOpt, { prices: DailyPrice[] }>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isStrictlyAscendingIsoDates(dates: readonly unknown[]): dates is string[] {
  for (let i = 0; i < dates.length; i += 1) {
    const d = dates[i];
    if (typeof d !== "string" || !ISO_DATE.test(d)) return false;
    if (i > 0 && !((dates[i - 1] as string) < d)) return false;
  }
  return true;
}

/**
 * Phase 169.4 ALLOCTRUTH (D-67): the shape guard for the body of
 * `/api/benchmark/btc/prices`. Returns the closes when the body is exactly
 * `{ prices, dropped, through }` with every close finite and positive, the
 * price dates and the dropped dates each strictly ascending ISO dates, and
 * `through` a string or null; null for anything else. The old returns body
 * (an array of `{ date, value }`) is null, so a consumer that reads a stale
 * body shows "unavailable", never a partial or misread series.
 */
export function parseBtcCloses(body: unknown): BtcCloses | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const { prices, dropped, through } = body as Record<string, unknown>;
  if (!Array.isArray(prices) || !Array.isArray(dropped)) return null;
  if (!(through === null || typeof through === "string")) return null;
  const out: DailyPrice[] = [];
  for (const p of prices) {
    if (typeof p !== "object" || p === null) return null;
    const { date, close } = p as Record<string, unknown>;
    if (typeof date !== "string" || typeof close !== "number") return null;
    if (!Number.isFinite(close) || close <= 0) return null;
    out.push({ date, close });
  }
  if (!isStrictlyAscendingIsoDates(out.map((p) => p.date))) return null;
  if (!isStrictlyAscendingIsoDates(dropped)) return null;
  return { prices: out, dropped: [...dropped], through };
}

/**
 * Phase 169.4 ALLOCTRUTH (SC12, D-68): the ONE pairing of a Scenario portfolio
 * with BTC. It calls 169.5's `alignCoveredReturns` on BTC's own 7-day calendar
 * (`COMPARATOR_CALENDARS.btc`) and keeps exactly the indices where `paired[i]`
 * is true and the value is non-null, the filter the factsheet comparator block
 * uses. The rule is the engine's, owned by Phase 166.4 BENCHALIGN (founder
 * decision D-A, with D-05) and applied in TypeScript by Phase 169.5 D-64:
 *   - day one pairs with BTC's own return dated the portfolio's first date;
 *   - index k >= 1 pairs with BTC's move over the portfolio's own interval
 *     (date k-1, date k], compounded, only when BTC has a close dated both
 *     endpoints (so a Friday-to-Monday portfolio interval pairs with BTC's
 *     Friday-to-Monday move, not its one-day Sunday-to-Monday move);
 *   - an interval with a BTC date missing inside it is unpaired (166.4 review
 *     WR-01, 169.5 D-64(2)), so a BTC return that bridges a missing stored day
 *     is never paired as one day's move (SC11, D-66).
 *
 * `portfolioDaily` must be strictly ascending by date (the order
 * `alignCoveredReturns` assumes). Returns `{ dates, p, b }`, positionally
 * aligned, ready for `computeAlphaBeta` / `computeTrackingError`.
 */
export function pairScenarioWithBtc(
  portfolioDaily: readonly DailyPoint[],
  btcCloses: Pick<BtcCloses, "prices" | "dropped">,
): { dates: string[]; p: number[]; b: number[] } {
  const portfolioDates = portfolioDaily.map((d) => d.date);
  const aligned = alignCoveredReturns(
    btcCloses.prices,
    btcCloses.dropped,
    portfolioDates,
    COMPARATOR_CALENDARS.btc,
  );
  const dates: string[] = [];
  const p: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < portfolioDaily.length; i += 1) {
    const bv = aligned.returns[i];
    if (!aligned.paired[i] || bv === null) continue;
    dates.push(portfolioDates[i]);
    p.push(portfolioDaily[i].value);
    b.push(bv);
  }
  return { dates, p, b };
}

/**
 * Phase 169.4 ALLOCTRUTH (D-66): the Scenario BTC overlay as the close LEVEL,
 * `close / first close`, one point per stored close. A missing day or a
 * dropped (corrupt) date has no close and so no point. Compounding daily
 * returns instead would lose the move across a dropped close for good (the
 * returns rule refuses to bridge it), and every later level would be wrong.
 */
export function btcLevelsFromCloses(prices: readonly DailyPrice[]): DailyPoint[] {
  if (prices.length === 0) return [];
  const first = prices[0].close;
  return prices.map((p) => ({ date: p.date, value: p.close / first }));
}

export interface ScenarioBenchmark {
  /** Paired overlap count (`pairScenarioWithBtc`) — the {N} the UI heading reports. */
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

const NULL_RESULT = (n: number): ScenarioBenchmark => ({
  n,
  trackingError: null,
  informationRatio: null,
  alpha: null,
  beta: null,
  correlation: null,
});

/**
 * Assemble the four active-return metrics + correlation over the pairs
 * `pairScenarioWithBtc` gives for the scenario daily returns and the BTC closes
 * (D-68). `btcCloses` null (no benchmark) answers n = 0 and every field null.
 *
 * Each field is null-safe, so this can run unconditionally; the caller gates
 * RENDER on `evaluateSampleFloor(n, 30)` before showing the numbers.
 */
export function computeScenarioBenchmark(
  portfolioDaily: readonly DailyPoint[],
  btcCloses: Pick<BtcCloses, "prices" | "dropped"> | null,
  periodsPerYear = 252,
): ScenarioBenchmark {
  if (btcCloses === null) return NULL_RESULT(0);
  const { p, b } = pairScenarioWithBtc(portfolioDaily, btcCloses);
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

  // Alpha and beta come straight from computeAlphaBeta, which since Phase
  // 166.2's review round 1 (founder decision D7, 2026-09-26) answers an
  // undefined beta, including a constant benchmark (an exact constant, or the
  // ~1e-16 float residue of a compounding constant yield, judged by the shared
  // floor), with { alpha: null, beta: null }. This file used to detect the
  // constant benchmark itself with a local variance, because computeAlphaBeta
  // answered it with beta 0 and alpha meanR * periodsPerYear; that second
  // degeneracy test (SFH-M7) is gone with the fabrication it guarded against.
  const { alpha, beta } = computeAlphaBeta(p, b, periodsPerYear); // beta=cov/var, alpha=(meanP−β·meanB)·periodsPerYear

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
