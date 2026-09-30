import type { DailyPrice } from "./types";
import { pricesToDailyReturns } from "./benchmark-source";

/**
 * Forward-fill benchmark prices onto a strategy's observation dates, then
 * return aligned daily returns. Ports `align_returns()` from
 * `/tmp/gen_factsheet_v3.py`.
 *
 * The strategy's date list is authoritative — benchmark trading-day gaps are
 * filled by carrying the last seen close forward. The first returned value
 * is always 0 (no prior price to diff against).
 */
export function alignReturns(prices: DailyPrice[], dates: string[]): number[] {
  const byDate = new Map<string, number>();
  for (const p of prices) byDate.set(p.date, p.close);

  const aligned: Array<number | null> = [];
  let lastP: number | null = null;
  for (const d of dates) {
    const p = byDate.get(d);
    if (p !== undefined) lastP = p;
    aligned.push(lastP);
  }

  const rets: number[] = [0];
  for (let i = 1; i < aligned.length; i++) {
    const a = aligned[i];
    const b = aligned[i - 1];
    if (a != null && b != null && b !== 0) rets.push(a / b - 1);
    else rets.push(0);
  }
  return rets;
}

/** One comparator aligned onto a strategy's dates by {@link alignCoveredReturns}. */
export type CoveredAlignment = {
  /** Per strategy date: the benchmark move over the strategy's own interval, or null. */
  returns: Array<number | null>;
  /** Per strategy date: true when the interval is PAIRED (joint metrics, correlations). */
  paired: boolean[];
  /** The benchmark's last close on or before the strategy's last date; null when none. */
  through: string | null;
};

const DAY_MS = 86_400_000;

function utcDay(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

/** Weekday (0 = Sunday) of a UTC day number; day 0 (1970-01-01) is a Thursday. */
function weekdayOfDay(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** Index of the last element of ascending `xs` that is <= `x`, or -1. */
function lastAtOrBefore(xs: readonly string[], x: string): number {
  let lo = 0;
  let hi = xs.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Phase 169.5 BENCHCOMPARE (D-54, D-58 and its planner amendment, D-64): the ONE
 * coverage-aware, interval-matched alignment of a benchmark onto a strategy's
 * dates. Every comparator (BTC from the database, SPX / ETH / GLD / IEF from
 * their fixtures) goes through it. `dates` are the strategy's dates, ascending.
 *
 * The pairing rule is the Python engine's: Phase 166.4 BENCHALIGN founder decision D-A
 * (with its ratified D-04, D-05 and D-07), as implemented by `_interval_matched_benchmark`
 * in `analytics-service/services/metrics.py`, including its interior-gap review fix
 * (166.4 review WR-01, engine commit d1d1fc077). This helper is its TypeScript
 * application (169.5 D-64, founder ruling 2026-09-27 "Engine's rule; 169.5 follows").
 *
 * Benchmark returns come ONLY from 169.2's one returns rule,
 * `pricesToDailyReturns(prices, dropped)` (a missing close is bridged into one
 * point, a dropped close yields none). A CLOSE at date d exists exactly when
 * `prices` holds a close dated d; a `dropped` date is never a close, and the
 * first close of `prices` IS one: it is 166.4 D-07's base close by construction
 * (the engine reconstructs it from returns as the first return's date minus one
 * day; here it is `prices[0]`). No close is ever synthesised before it.
 *
 * SERIES (the per-day value):
 *   - index 0 is the point dated exactly the first strategy date, the benchmark's
 *     own return for that date (166.4 D-05, D-64); null when there is none;
 *   - index k >= 1 is the compounded product of the points dated after strategy
 *     date k-1 and on or before strategy date k, minus one (one point is used
 *     verbatim, as the engine does). It is null, never 0, when strategy date k
 *     is after `through`, when the benchmark has no close dated strategy date k
 *     (D-58), when the interval holds no point (D-58: an empty product is null),
 *     when no close exists on or before strategy date k-1, or when a `dropped`
 *     date lies after the last close on or before strategy date k-1 and on or
 *     before strategy date k (a corrupt close is never bridged).
 *
 * PAIRING (joint metrics and correlations):
 *   - `paired[0]` is true exactly when the index-0 value is non-null (D-64: the
 *     series and the pairing agree at day one);
 *   - `paired[k]`, k >= 1, is true only when the series value is non-null AND the
 *     benchmark has a close dated exactly strategy date k-1 (166.4 D-A and D-04:
 *     both endpoints are closes, whichever leg is sparser) AND the number of
 *     points in (strategy date k-1, strategy date k] equals the number of dates
 *     in that interval falling on a weekday of the benchmark's own calendar
 *     (166.4 review WR-01, d1d1fc077: the engine's `count == expected`). The
 *     calendar is the set of weekdays on which `prices` carries a close: seven
 *     for BTC, Monday to Friday for SPX, GLD and IEF.
 *
 * Why the series and the pairing differ (the recorded deviation from reading
 * D-58 as "null after a gap too", and D-64's interior-gap half): nulling an
 * interval that follows or contains a missing close would drop a real move
 * between two real closes from the comparator's cumulative return (for SPX /
 * GLD / IEF against a 7-day strategy, every Friday-to-Monday move), a new wrong
 * number. So the series keeps the move since the last close, and only the
 * 166.4 D-A pairing excludes it.
 *
 * `through` is the last close on or before the strategy's last date.
 */
export function alignCoveredReturns(
  prices: readonly DailyPrice[],
  dropped: readonly string[],
  dates: readonly string[],
): CoveredAlignment {
  const n = dates.length;
  const returns: Array<number | null> = new Array(n).fill(null);
  const paired: boolean[] = new Array(n).fill(false);
  if (n === 0) return { returns, paired, through: null };

  const closeDates = prices.map((p) => p.date);
  const closeSet = new Set(closeDates);
  const points = pricesToDailyReturns([...prices], dropped);
  const pointDates = points.map((p) => p.date);

  const lastStrategyDate = dates[n - 1];
  const throughIdx = lastAtOrBefore(closeDates, lastStrategyDate);
  const through = throughIdx >= 0 ? closeDates[throughIdx] : null;

  const calendar = new Array<boolean>(7).fill(false);
  for (const d of closeDates) calendar[weekdayOfDay(utcDay(d))] = true;

  // Index 0: the benchmark's own return dated the first strategy date.
  const p0 = lastAtOrBefore(pointDates, dates[0]);
  if (p0 >= 0 && pointDates[p0] === dates[0]) {
    returns[0] = points[p0].value;
    paired[0] = true;
  }

  for (let k = 1; k < n; k++) {
    const prev = dates[k - 1];
    const cur = dates[k];
    if (through === null || cur > through) continue;
    if (!closeSet.has(cur)) continue;
    const baseIdx = lastAtOrBefore(closeDates, prev);
    if (baseIdx < 0) continue;
    const base = closeDates[baseIdx];
    // A dropped date in (base, cur] means a corrupt close sits inside the move.
    const dIdx = lastAtOrBefore(dropped, cur);
    if (dIdx >= 0 && dropped[dIdx] > base) continue;

    const lo = lastAtOrBefore(pointDates, prev) + 1;
    const hi = lastAtOrBefore(pointDates, cur);
    const count = hi - lo + 1;
    if (count <= 0) continue;
    let value: number;
    if (count === 1) {
      value = points[lo].value;
    } else {
      let g = 1;
      for (let i = lo; i <= hi; i++) g *= 1 + points[i].value;
      value = g - 1;
    }
    returns[k] = value;

    if (!closeSet.has(prev)) continue;
    let expected = 0;
    const from = utcDay(prev);
    const to = utcDay(cur);
    for (let day = from + 1; day <= to; day++) if (calendar[weekdayOfDay(day)]) expected++;
    paired[k] = count === expected;
  }

  return { returns, paired, through };
}
