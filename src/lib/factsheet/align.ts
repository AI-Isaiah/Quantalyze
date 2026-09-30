import type { DailyPrice } from "./types";
import { pricesToDailyReturns } from "./benchmark-source";

/** One comparator aligned onto a strategy's dates by {@link alignCoveredReturns}. */
export type CoveredAlignment = {
  /** Per strategy date: the benchmark move over the strategy's own interval, or null. */
  returns: Array<number | null>;
  /** Per strategy date: true when the interval is PAIRED (joint metrics, correlations). */
  paired: boolean[];
  /** The benchmark's last close on or before the strategy's last date; null when none. */
  through: string | null;
  /**
   * Phase 169.5 review WR-01: true when no date of the benchmark's OWN calendar lies
   * in (`through`, the strategy's last date], so the benchmark has every close it
   * could have for the strategy's range; false when `through` is null. A weekday
   * benchmark whose last close is the Friday before a weekend last date is covered.
   * Computed by {@link isPastCoverage}, the rule the coverage caption also calls.
   * Required (review WR-02): a hand-built alignment (the unavailable form, the
   * strategy leg of a correlation, both `through: null`) states `false` itself.
   */
  coveredToEnd: boolean;
};

/**
 * A benchmark's trading calendar: index = weekday (0 = Sunday), true when the
 * benchmark carries a close on that weekday.
 */
export type WeekdayCalendar = readonly boolean[];

/** Every weekday: a 7-day market (BTC, ETH). */
export const CALENDAR_7D: WeekdayCalendar = Object.freeze([true, true, true, true, true, true, true]);
/** Monday to Friday: an exchange-traded market (SPX, GLD, IEF). */
export const CALENDAR_WEEKDAY: WeekdayCalendar = Object.freeze([false, true, true, true, true, true, false]);

/**
 * Each comparator key's own calendar: the one `alignCoveredReturns` pairs on and the
 * coverage caption reads (review WR-01, WR-02), so the two agree by construction.
 */
export const COMPARATOR_CALENDARS = {
  btc: CALENDAR_7D,
  eth: CALENDAR_7D,
  spx: CALENDAR_WEEKDAY,
  gld: CALENDAR_WEEKDAY,
  ief: CALENDAR_WEEKDAY,
} as const satisfies Record<string, WeekdayCalendar>;

const DAY_MS = 86_400_000;

function utcDay(iso: string): number {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

/** Weekday (0 = Sunday) of a UTC day number; day 0 (1970-01-01) is a Thursday. */
function weekdayOfDay(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/**
 * Phase 169.5 review WR-01: the ONE "past coverage" rule, shared by
 * `buildComparatorBlock`'s windows (through `coveredToEnd`) and the picker's
 * coverage caption so the two cannot drift. A benchmark is past its coverage when
 * `through` is null, or when a date on the benchmark's OWN `calendar` lies in
 * (`through`, `lastDate`]. A raw-date comparison is wrong for a weekday benchmark
 * against a 7-day strategy ending on a weekend: the Friday close determines every
 * window, and nothing is missing.
 */
export function isPastCoverage(
  through: string | null,
  lastDate: string | undefined,
  calendar: WeekdayCalendar,
): boolean {
  if (through === null) return true;
  if (lastDate === undefined || lastDate <= through) return false;
  const to = utcDay(lastDate);
  for (let day = utcDay(through) + 1; day <= to; day++) {
    if (calendar[weekdayOfDay(day)]) return true;
  }
  return false;
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
 *     calendar is an INPUT, fixed per comparator ({@link COMPARATOR_CALENDARS}:
 *     seven days for BTC and ETH, Monday to Friday for SPX, GLD and IEF). It is
 *     never inferred from `prices` (Phase 169.5 review WR-02 / SFH-M-03): the
 *     route hands in a window trimmed to the strategy's range, and a short window
 *     whose only Saturday is missing would drop Saturday from an inferred
 *     calendar and pair the very Fri-to-Mon interval the engine leaves unpaired
 *     (the engine infers `traded` from the FULL stored series).
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
 * `coveredToEnd` is {@link isPastCoverage}'s negation on the same calendar.
 */
export function alignCoveredReturns(
  prices: readonly DailyPrice[],
  dropped: readonly string[],
  dates: readonly string[],
  calendar: WeekdayCalendar,
): CoveredAlignment {
  const n = dates.length;
  const returns: Array<number | null> = new Array(n).fill(null);
  const paired: boolean[] = new Array(n).fill(false);
  if (n === 0) return { returns, paired, through: null, coveredToEnd: false };

  const closeDates = prices.map((p) => p.date);
  const closeSet = new Set(closeDates);
  const points = pricesToDailyReturns([...prices], dropped);
  const pointDates = points.map((p) => p.date);

  const lastStrategyDate = dates[n - 1];
  const throughIdx = lastAtOrBefore(closeDates, lastStrategyDate);
  const through = throughIdx >= 0 ? closeDates[throughIdx] : null;

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

  return { returns, paired, through, coveredToEnd: !isPastCoverage(through, lastStrategyDate, calendar) };
}
