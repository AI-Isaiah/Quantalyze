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
    out[i] = dd > 0 ? (m * periodsPerYear) / dd : 0;
  }
  return out;
}
