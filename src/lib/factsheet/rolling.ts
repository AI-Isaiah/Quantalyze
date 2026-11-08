/**
 * Rolling-window statistics ported from `rolling()` in
 * `/tmp/gen_factsheet_v3.py`. Default window is 6 months (126 trading
 * days) — matches the mockup's `W6` constant.
 *
 * Each function returns an array of the same length as input, with `null`
 * for indices before the window fills (i < window-1). Consumers paint a
 * warmup overlay over the leading null region so the user knows those
 * samples are statistically noisy.
 *
 * A window whose ratio does not exist (a flat or constant-yield window, or one
 * holding a non-finite value) is `null` as well, so the chart shows a GAP and
 * the rolling summary skips it (founder decision D7, 2026-09-26). It used to be
 * 0, which drew a flat "Sharpe 0" / "beta 0" regime the data cannot support and
 * pulled the panel's average toward 0.
 */

import type { RollWindowPick } from "./types";
import { ONE_YEAR_DAYS, coveredDays, spanDays } from "@/lib/figure-gate";
import { mean } from "@/lib/portfolio-math-utils";
import { beta, dispersion, sharpe } from "@/lib/return-stats";

export const ROLL_WINDOW_6MO = 126;
export const ROLL_WINDOW_90D = 90;
export const ROLL_WINDOW_30D = 30;

/**
 * Pick a rolling window starting from a preferred size, falling back to
 * smaller windows when the series is too short to fill the preferred one.
 *
 * Threshold: need at least `window + 5` points so the rolling series has
 * a small post-warmup tail to plot. Below the smallest window we return
 * `enough: false` so the caller can render a "Not enough data" message
 * instead of an empty chart.
 *
 * `tiers` is ordered preferred → fallback. The first tier whose threshold
 * is met wins; otherwise the last tier is returned with `enough: false`.
 */
export function pickRollingWindow(
  seriesLength: number,
  tiers: Array<{ window: number; label: string }> = [
    { window: ROLL_WINDOW_6MO, label: "6mo" },
    { window: ROLL_WINDOW_30D, label: "30d" },
  ],
): RollWindowPick {
  for (const t of tiers) {
    if (seriesLength >= t.window + 5) {
      return { ...t, enough: true };
    }
  }
  const last = tiers[tiers.length - 1];
  return { ...last, enough: false };
}

/**
 * Rolling regression beta of `strat` on `bench` over a sliding window.
 * Ports `_rolling_beta()` from the mockup generator. Default window 90d
 * matches the mockup's choice for the Rolling β chart.
 */
export function rollingBeta(
  strat: number[],
  bench: number[],
  window = ROLL_WINDOW_90D,
): Array<number | null> {
  const n = Math.min(strat.length, bench.length);
  const out: Array<number | null> = new Array(n).fill(null);
  for (let i = window - 1; i < n; i++) {
    // Each window's beta comes from `@/lib/return-stats` (Phase 166.2 D-17): a
    // bench window whose only dispersion is float residue answers exactly as an
    // all-zero window does (D-07), and both are a gap, null (D7).
    out[i] = beta(strat.slice(i - window + 1, i + 1), bench.slice(i - window + 1, i + 1));
  }
  return out;
}

// #597 — `periodsPerYear` (N) is the annualization basis: 252 (traditional,
// default — byte-identical to pre-#597) or 365 (crypto). Derive it from the
// strategy's asset class via annualizationPeriods().
export function rollingVol(
  rets: number[],
  window = ROLL_WINDOW_6MO,
  periodsPerYear = 252,
): Array<number | null> {
  const out: Array<number | null> = new Array(rets.length).fill(null);
  const sqrtN = Math.sqrt(periodsPerYear);
  for (let i = window - 1; i < rets.length; i++) {
    const w = rets.slice(i - window + 1, i + 1);
    // The shared population sd (SFH-M7): bitwise `stdDev(w, false)` except that
    // a float-residue window reads exactly 0, as `compute`'s ann_vol does, not
    // about 1e-15.
    out[i] = dispersion(w, 0).sd * sqrtN;
  }
  return out;
}

export function rollingSharpe(
  rets: number[],
  window = ROLL_WINDOW_6MO,
  periodsPerYear = 252,
): Array<number | null> {
  const out: Array<number | null> = new Array(rets.length).fill(null);
  for (let i = window - 1; i < rets.length; i++) {
    // The window's Sharpe comes from `@/lib/return-stats` (Phase 166.2 D-17),
    // population sd: a residue window answers as an all-zero window does (D-07),
    // and both are a gap, null (D7).
    out[i] = sharpe(rets.slice(i - window + 1, i + 1), { periodsPerYear, ddof: 0 });
  }
  return out;
}

export function rollingSortino(
  rets: number[],
  window = ROLL_WINDOW_6MO,
  periodsPerYear = 252,
): Array<number | null> {
  const out: Array<number | null> = new Array(rets.length).fill(null);
  const sqrtN = Math.sqrt(periodsPerYear);
  for (let i = window - 1; i < rets.length; i++) {
    const w = rets.slice(i - window + 1, i + 1);
    const m = mean(w);
    let downSq = 0;
    let hasNeg = false;
    for (const x of w) {
      if (x < 0) {
        downSq += x * x;
        hasNeg = true;
      }
    }
    const dd = hasNeg ? Math.sqrt(downSq / window) * sqrtN : 0;
    // A window with no losing day has no Sortino: a gap (null), as a window
    // with no Sharpe is, never a drawn 0 that the Rolling panel's "Now" would
    // print as "0.00" (founder decision D7; review round 2, HI-02 class).
    out[i] = dd > 0 ? (m * periodsPerYear) / dd : null;
  }
  return out;
}

/**
 * 194 D-14 (founder, 2026-11-07, "Add a 365-day window"): the rolling window, in
 * CALENDAR days, whose filled windows span a year and so show without the short
 * note. Python twin: `ROLLING_1Y_WINDOW_DAYS` in analytics-service/services/metrics.py
 * (`rolling-calendar.test.ts` pins the pair).
 */
export const ROLL_WINDOW_1Y_DAYS = ONE_YEAR_DAYS;

/**
 * Rolling annualized volatility, Sharpe and Sortino over a CALENDAR window, the twin of
 * `_rolling_calendar_stats` in analytics-service/services/metrics.py. Both are proven
 * equal on `analytics-service/tests/fixtures/rolling_1y_vectors.json` (closed-form
 * expected values, read by pytest and vitest).
 *
 * The point at index i aggregates the returns dated after `dates[i] - windowDays` days,
 * up to and including `dates[i]`, and exists only when the returns from `dates[0]` to
 * `dates[i]` cover `windowDays` days (`coveredDays`, D-21: 365 daily returns fill a
 * 365-day window; the window itself already holds 365 days); every other index is `null`, as is a
 * window with no ratio. `dates` are ISO yyyy-mm-dd, ascending, one per return. Non-finite
 * returns are skipped inside a window (pandas skipna), and the downside root divides by
 * the window's own count.
 *
 * ONE definition, the producer's (D-01; A-194-D14-02): the SAMPLE standard deviation
 * (ddof 1), so a point is not the factsheet's row-window figure, which stays on the
 * population standard deviation (ddof 0). Sharpe is null where the standard deviation
 * does not clear the residue floor; Sortino is null where no return is below 0 (MAR).
 */
export function rollingCalendarStats(
  rets: number[],
  dates: string[],
  windowDays: number,
  periodsPerYear: number,
): {
  vol: Array<number | null>;
  sharpe: Array<number | null>;
  sortino: Array<number | null>;
} {
  const n = Math.min(rets.length, dates.length);
  const vol: Array<number | null> = new Array(rets.length).fill(null);
  const sharpeOut: Array<number | null> = new Array(rets.length).fill(null);
  const sortino: Array<number | null> = new Array(rets.length).fill(null);
  const sqrtN = Math.sqrt(periodsPerYear);
  let start = 0;
  for (let i = 0; i < n; i++) {
    // Window = (dates[i] - windowDays, dates[i]]: drop every date exactly windowDays
    // or more before dates[i]. That window holds windowDays covered days; the warm-up
    // below asks for the same count (D-21), so a point exists from the first full window.
    while (spanDays(dates[start], dates[i]) >= windowDays) start++;
    if (coveredDays(dates[0], dates[i]) < windowDays) continue;
    // 194 D-17 (review R4 WR-02): a window whose span is not a number (a date that is not a date,
    // here or at its start, where the drop loop above cannot step over it) emits no point. This
    // also covers a malformed first date: the loop then never leaves index 0, so the span is NaN.
    if (!Number.isFinite(spanDays(dates[start], dates[i]))) continue;
    const w = rets.slice(start, i + 1).filter(Number.isFinite);
    if (w.length < 2) continue;
    const { sd } = dispersion(w, 1);
    vol[i] = sd * sqrtN;
    sharpeOut[i] = sharpe(w, { periodsPerYear, ddof: 1 });
    let downSq = 0;
    let hasNeg = false;
    for (const x of w) {
      if (x < 0) {
        downSq += x * x;
        hasNeg = true;
      }
    }
    const dd = hasNeg ? Math.sqrt(downSq / w.length) * sqrtN : 0;
    sortino[i] = dd > 0 ? (mean(w) * periodsPerYear) / dd : null;
  }
  return { vol, sharpe: sharpeOut, sortino };
}
