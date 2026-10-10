import type { ComputeResult } from "./types";
import { dispersion, sharpe as sharpeRatio } from "@/lib/return-stats";

/**
 * Phase 169 D-11 (SC6) + 164.6.6.3.3 plan 08: ONE coverage rule for every return
 * window, shared by `compute()` and the factsheet rail so no second calendar rule
 * exists. `cutoff` is the window's cutoff date, or a number of days back from the
 * record's last date (182 for 6 Month, 365 for 1 Year; the offsets `compute` uses).
 *
 * A window is shown only when the record covers it, i.e. the first observation date is
 * on or before the window's cutoff plus one UTC day; otherwise it is null.
 * Without this, a record shorter than the window compounded its WHOLE history
 * under the window's label (a 5-month record printed a "1 Year" return).
 * Multi-year windows are calendar days (3 x 365, 5 x 365), never an
 * observation count: 756 observations is three years on a weekday venue and
 * about two on a 24/7 one.
 *
 * 169 review WR-02 (2026-09-29): "cutoff plus one day" is the window's first
 * SESSION only on a 7-day venue. On a weekday venue (see WR-R2-01 below) the first
 * session after the cutoff is the first day that is not a Saturday, a Sunday,
 * 1 January or 25 December, and a record starting there misses nothing. So
 * the rule is: covered iff every UTC day strictly between the cutoff and the
 * first observation is a day the venue did not trade. The 7-day basis has no
 * such day, which keeps its rule exactly "cutoff + 1 day". Without this a
 * weekday strategy launched on 2 January showed YTD as the em-dash all year,
 * and a Monday start after a Saturday cutoff dropped rows the record covers.
 * Only those four days are assumed closed, because every weekday venue this
 * product carries (equities, FX / CFD via MT5) is shut on them; any other
 * holiday differs by venue, and assuming it would admit a window missing a
 * session that traded. Known limit: a start after another holiday (a Labor
 * Day Monday on the 1st, an observed New Year Monday) is the em-dash.
 *
 * 169 review round 2, WR-R2-01 (2026-09-29): the calendar is a property of
 * the SERIES, never of the asset class. It was `periodsPerYear === 252`, but
 * 252 is what every non-crypto class gets, including the DB default
 * 'traditional', so a 24/7 record left on the default borrowed the weekend
 * tolerance and could show a window missing up to three traded days. It also
 * let a change of asset class move a return number, which closed-sets.ts
 * (#597) forbids. Now: a record is on the weekday calendar only when it spans
 * at least one Saturday and has no Saturday or Sunday observation at all. A
 * single weekend print anywhere proves the venue trades weekends; a record
 * too short to span a weekend proves nothing. Both keep the strict rule
 * (cutoff + 1 day), so the failure direction is always the em-dash.
 */
export function recordCoversWindow(dates: string[], cutoff: Date | number): boolean {
  const n = dates.length;
  if (n === 0) return false;
  const startDate = new Date(dates[0]);
  const lastDate = new Date(dates[n - 1]);
  const cutoffDate =
    typeof cutoff === "number"
      ? (() => {
          const d = new Date(lastDate);
          d.setUTCDate(d.getUTCDate() - cutoff);
          return d;
        })()
      : cutoff;
  const tradesWeekends = dates.some((d) => {
    const w = new Date(d).getUTCDay();
    return w === 0 || w === 6;
  });
  const firstDow = startDate.getUTCDay();
  const spanDays = Math.round((lastDate.getTime() - startDate.getTime()) / 86_400_000);
  const spansSaturday = (6 - firstDow + 7) % 7 <= spanDays;
  const weekdayVenue = spansSaturday && !tradesWeekends;
  const isNonTradingDay = (d: Date): boolean => {
    if (!weekdayVenue) return false;
    const dow = d.getUTCDay();
    const md = d.getUTCMonth() * 100 + d.getUTCDate();
    return dow === 0 || dow === 6 || md === 1 || md === 1125;
  };
  const firstSession = new Date(cutoffDate);
  firstSession.setUTCDate(firstSession.getUTCDate() + 1);
  // At most three non-trading days run together (a weekend beside 1 Jan or
  // 25 Dec); 7 is only a bound on the loop.
  for (let i = 0; i < 7 && isNonTradingDay(firstSession); i++) {
    firstSession.setUTCDate(firstSession.getUTCDate() + 1);
  }
  return !(startDate > firstSession);
}

/**
 * Headline per-series metrics for the strategy and each benchmark. Mirrors the
 * Python reference's numerical conventions:
 *
 *   - annualization = `periodsPerYear` trading days / year (#597: 252
 *     traditional / 365 crypto; default 252 keeps every existing caller
 *     byte-identical). Applies to vol/Sharpe/Sortino only — CAGR stays on the
 *     CALENDAR year (days / 365.25), which is asset-class-invariant.
 *   - population stdev (not sample) — `statistics.pstdev`
 *   - CAGR = eq[-1] ** (1 / years) - 1 by default (geometric); under the
 *     arithmetic method (`conventions.cumulativeMethod`) it is the mean daily
 *     return times periodsPerYear (see the CAGR block below)
 *   - calendar windows (MTD … 5Y) and buckets (week / month / quarter / year)
 *     compound by default and SUM under the arithmetic method (Phase 169.1 D-31)
 *   - Sharpe / Sortino use rf = 0 unless explicitly passed
 *
 * Degenerate cases (no drawdown, no losses, no left tail) surface as `null`
 * rather than 0 — `0 recovery_factor` would imply a real but zero ratio.
 */
export function compute(
  rets: number[],
  dates: string[],
  rf = 0,
  periodsPerYear = 252,
  conventions: ComputeConventions = {},
): ComputeResult {
  const n = rets.length;
  if (n === 0 || dates.length !== n) {
    throw new Error("compute(): rets and dates must be non-empty arrays of equal length");
  }

  // Phase 169.1 (D-28, D-30, D-36): the strategy's own conventions, mirroring
  // `compute_all_metrics` in analytics-service/services/metrics.py. Absent, every
  // figure is the geometric, calendar-basis one this function always returned.
  // Under ARITHMETIC the equity and the underwater are the running-sum curves the
  // composite chart draws, so cum_ret, max_dd, calmar and every drawdown-derived
  // figure below (longest_dd, recovery_factor, pain_index, ulcer_index) follow
  // them unchanged in form.
  const arithmetic = conventions.cumulativeMethod === "arithmetic";
  const eq = arithmetic ? arithmeticEquity(rets) : cumEq(rets);
  const dd = arithmetic ? arithmeticUnderwater(rets) : drawdowns(eq);
  // Phase 166.2 (D-17, D-07): the mean and the population sd come from the
  // shared return-stats module, which reports a float-residue sd (a
  // compounding constant yield) as exactly 0, so ann_vol, skew and kurtosis
  // below answer such a series exactly as they answer an all-zero one.
  const { mean: m, sd: s } = dispersion(rets, 0);
  const startDate = new Date(dates[0]);
  const endDate = new Date(dates[n - 1]);
  const days = Math.max(1, (endDate.getTime() - startDate.getTime()) / 86_400_000);
  const years = days / 365.25;

  // D-30 / D-36 (W2): the day basis moves EXACTLY ann_vol, sharpe, sortino and
  // the arithmetic CAGR (so calmar under arithmetic). They run over the basis
  // series, with its OWN mean and deviation; skew and kurt keep the all-returns
  // `m` / `s` above, and var95, cvar95, win_rate, profit_factor and every other
  // figure keep all returns, as the engine's do. On the calendar basis the basis
  // series IS `rets`, so every figure is the one this function always returned,
  // except on a calendar-dense series (a composite), where it is the zero-filled
  // calendar series the engine computes them over (D-32; see metricsBasisSeries).
  const basisReturns = metricsBasisSeries(rets, dates, conventions).returns;
  const basisN = basisReturns.length;
  const { mean: basisMean, sd: basisSd } = dispersion(basisReturns, 0);

  const cumRet = eq[n - 1] - 1;
  // Geometric: a calendar-span compound, on either day basis (the engine's is).
  // Arithmetic: the mean daily return times periodsPerYear, the engine's
  // `mean(stat_returns) * periods_per_year`, over the basis series: the non-zero
  // days on the active basis, the calendar days from the first to the last date
  // inclusive on a calendar-dense series (a composite, zero-filled by the stitch;
  // the filled 0.0 days add nothing to the sum, so this is the sum over the
  // calendar-day count), and the observations otherwise. An active basis with no
  // non-zero day has no mean: NaN, as the engine's None.
  let cagr: number;
  if (arithmetic) {
    cagr = basisN > 0 ? (sumOf(basisReturns) / basisN) * periodsPerYear : NaN;
  } else {
    cagr = years > 0 && eq[n - 1] > 0 ? Math.pow(eq[n - 1], 1 / years) - 1 : 0;
  }
  // A basis series of 0 or 1 return carries no deviation: the engine's
  // `stat_returns.std()` of it is NaN, stored as None (metrics.py `_safe_float`).
  // `dispersion` reports sd 0 there, which would render a measured-looking "0.0%"
  // beside a "—" Sharpe. Reachable on the active basis, where a window over an
  // idle stretch holds fewer than two non-zero days (169.1 review MD-03). On the
  // calendar basis basisN = n >= 2 on every rendered path, so nothing moves there.
  const annVol = basisN >= 2 ? basisSd * Math.sqrt(periodsPerYear) : NaN;
  // The Sharpe is the shared one. A null (no dispersion, or a non-finite
  // return) stays an absence: NaN, which every factsheet formatter renders as
  // "—", as the OG card and the tearsheet do for the same series (founder
  // decision D7, 2026-09-26, reversing D-07's "answer null as 0" for display).
  // `ComputeResult.sharpe` stays a `number`; NaN (or the null a JSON cache turns
  // it into) is the absent value, so a consumer tests `Number.isFinite`.
  const sharpe = sharpeRatio(basisReturns, { periodsPerYear, ddof: 0, rf }) ?? NaN;

  const neg = basisReturns.filter(x => x < 0);
  const ddDev = neg.length > 0 ? Math.sqrt(neg.reduce((a, x) => a + x * x, 0) / basisN) * Math.sqrt(periodsPerYear) : 0;
  // A series with no losing day has no Sortino, and one with no drawdown has no
  // Calmar: the ratio would be infinite, which means "does not exist", not 0.
  // Both stay NaN and render "—", as the tearsheet shows for the same series
  // (the analytics service persists None for both) and as the Sharpe above
  // does (founder decision D7, 2026-09-26; review round 2 HI-02).
  const sortino = ddDev > 0 ? ((basisMean - rf / periodsPerYear) * periodsPerYear) / ddDev : NaN;

  let maxDd = 0;
  for (let i = 0; i < dd.length; i++) if (dd[i] < maxDd) maxDd = dd[i];
  const calmar = maxDd !== 0 ? cagr / Math.abs(maxDd) : NaN;

  // With no dispersion the standardised moments are 0/0: the series has no
  // skew and no kurtosis. NaN renders "—", never a measured-looking "+0.00"
  // (founder decision D7; review round 3 WR3-01, superseding CONTEXT T13's
  // "keep the s > 0 gate" answer of 0).
  const skew = s > 0 ? rets.reduce((a, x) => a + Math.pow((x - m) / s, 3), 0) / n : NaN;
  const kurt = s > 0 ? rets.reduce((a, x) => a + Math.pow((x - m) / s, 4), 0) / n - 3 : NaN;

  let longestDd = 0;
  let curRun = 0;
  for (const v of dd) {
    if (v < 0) {
      curRun += 1;
      if (curRun > longestDd) longestDd = curRun;
    } else {
      curRun = 0;
    }
  }

  // Win/loss + tail-risk extras + period buckets.
  let winCount = 0;
  let winSum = 0;
  let lossSum = 0;
  let lossCount = 0;
  let bestDay = -Infinity;
  let worstDay = Infinity;
  for (const r of rets) {
    if (r > 0) {
      winCount++;
      winSum += r;
    } else if (r < 0) {
      lossCount++;
      lossSum += r;
    }
    if (r > bestDay) bestDay = r;
    if (r < worstDay) worstDay = r;
  }
  const winRate = n > 0 ? winCount / n : 0;
  // No winning (losing) day means no average win (loss): NaN, rendered "—",
  // never a measured-looking 0.00% (founder decision D7; review round 3
  // SFH-R3 MEDIUM-2 for Avg Loss, and the symmetric Avg Win arm).
  const avgWin = winCount > 0 ? winSum / winCount : NaN;
  const avgLoss = lossCount > 0 ? lossSum / lossCount : NaN;
  // A book with no losing day has no profit factor: gross gain over a gross
  // loss of 0 is infinite, which means "does not exist", not 0. NaN renders
  // "—", as omega_ratio below (the same number) and the analytics service's
  // None already say (founder decision D7; review round 3 HI3-01).
  const profitFactor = lossSum !== 0 ? winSum / Math.abs(lossSum) : NaN;
  const sortedRets = [...rets].sort((a, b) => a - b);
  const var95 = sortedRets[Math.max(0, Math.floor(0.05 * n))];
  const cvar95Slice = sortedRets.slice(0, Math.max(1, Math.floor(0.05 * n)));
  const cvar95 = cvar95Slice.reduce((acc, x) => acc + x, 0) / cvar95Slice.length;

  // Recovery factor — return earned per unit of max drawdown. Allocator threshold: ≥ 2.
  // null when no drawdown observed — "0 recovery" would imply a measured zero ratio.
  const recoveryFactor = maxDd !== 0 ? cumRet / Math.abs(maxDd) : null;
  // Pain index — mean(|drawdown|). Captures DD persistence (5% × 200d > 10% × 5d).
  const painIndex = dd.length > 0 ? dd.reduce((a, x) => a + Math.abs(x), 0) / dd.length : 0;
  // Ulcer index — RMS of drawdowns. Penalises deep DDs more than the pain index.
  const ulcerIndex = dd.length > 0
    ? Math.sqrt(dd.reduce((a, x) => a + x * x, 0) / dd.length)
    : 0;
  // Tail ratio — P95 / |P5|. > 1 = right tail dominates. Only meaningful when
  // P5 < 0 (a left tail actually exists); for an all-positive series the ratio
  // collapses to gain/gain which has no risk-asymmetry interpretation.
  const p95Idx = Math.min(n - 1, Math.floor(0.95 * n));
  const p5Idx = Math.max(0, Math.floor(0.05 * n));
  const p95 = sortedRets[p95Idx];
  const p5 = sortedRets[p5Idx];
  const tailRatio = p5 < 0 ? Math.abs(p95 / p5) : null;
  // Omega ratio at threshold = 0. Numerically identical to profit_factor; the
  // metric is duplicated under this name because allocator IC memos cite it.
  // null when there are no losses (no probability mass below threshold).
  const omegaRatio = lossSum !== 0 ? winSum / Math.abs(lossSum) : null;
  // Common-sense ratio — tail × profit_factor. null if either input is null.
  // tailRatio is null whenever there is no losing day (p5 ≥ 0), which is the
  // only case profitFactor is NaN, so a NaN never reaches this product.
  const commonSenseRatio = tailRatio != null ? tailRatio * profitFactor : null;

  // Bucketed returns. Geometric (the default) compounds the returns within each
  // bucket; ARITHMETIC sums them, as `compute_all_metrics`'s `simple` arm sums
  // its monthly grid and `_bucket_return` (Phase 169.1 D-31). So on an
  // arithmetic series the months of a year add up to that year.
  const accum = arithmetic ? accumSum : accumProduct;
  const monthly = new Map<string, number>();
  const quarterly = new Map<string, number>();
  const yearly = new Map<string, number>();
  const weekly = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const d = dates[i];
    const yr = d.slice(0, 4);
    const mo = d.slice(5, 7);
    const quarter = `${yr}-Q${Math.floor((parseInt(mo, 10) - 1) / 3) + 1}`;
    const isoWeek = isoWeekKey(dates[i]);
    accum(monthly, `${yr}-${mo}`, rets[i]);
    accum(quarterly, quarter, rets[i]);
    accum(yearly, yr, rets[i]);
    accum(weekly, isoWeek, rets[i]);
  }
  const monthlyVals = Array.from(monthly.values());
  const quarterlyVals = Array.from(quarterly.values());
  const yearlyVals = Array.from(yearly.values());
  const weeklyVals = Array.from(weekly.values());

  const lastIso = dates[n - 1];
  const lastDate = new Date(lastIso);
  const lastYear = lastIso.slice(0, 4);
  const lastMonth = lastIso.slice(0, 7);
  // The return of the dates after `cutoff`. Geometric (the default) compounds;
  // ARITHMETIC sums, mirroring `_bucket_return` in `compute_all_metrics` (`s.sum()`
  // under the `simple` method), which feeds the engine's MTD, YTD, 3M and 6M
  // (Phase 169.1 D-31). Only the accumulation follows the method: the cutoffs and
  // D-11's coverage rule (`recordCoversWindow`) stay the one implementation for both.
  const returnFrom = (cutoff: Date): number => {
    if (arithmetic) {
      let s = 0;
      for (let i = 0; i < n; i++) {
        if (new Date(dates[i]) > cutoff) s += rets[i];
      }
      return s;
    }
    let c = 1;
    for (let i = 0; i < n; i++) {
      if (new Date(dates[i]) > cutoff) c *= 1 + rets[i];
    }
    return c - 1;
  };
  const mtdCutoff = new Date(`${lastMonth}-01T00:00:00Z`);
  mtdCutoff.setUTCDate(0);
  const ytdCutoff = new Date(`${lastYear}-01-01T00:00:00Z`);
  ytdCutoff.setUTCDate(0);
  const offsetDays = (days: number) => {
    const d = new Date(lastDate);
    d.setUTCDate(d.getUTCDate() - days);
    return d;
  };
  // Phase 169 D-11 (SC6): ONE coverage rule for every return window, owned by
  // `recordCoversWindow` above (164.6.6.3.3 plan 08: the rail shares it).
  const windowReturn = (cutoff: Date): number | null =>
    recordCoversWindow(dates, cutoff) ? returnFrom(cutoff) : null;

  const yearlyObj: Record<string, number> = {};
  yearly.forEach((v, k) => {
    yearlyObj[k] = v;
  });

  return {
    n,
    start: dates[0],
    end: dates[n - 1],
    years,
    eq,
    dd,
    cum_ret: cumRet,
    cagr,
    ann_vol: annVol,
    sharpe,
    sortino,
    calmar,
    max_dd: maxDd,
    longest_dd: longestDd,
    skew,
    kurt,
    mtd: windowReturn(mtdCutoff),
    ytd: windowReturn(ytdCutoff),
    p3m: windowReturn(offsetDays(90)),
    p6m: windowReturn(offsetDays(182)),
    p1y: windowReturn(offsetDays(365)),
    p3y: windowReturn(offsetDays(3 * 365)),
    p5y: windowReturn(offsetDays(5 * 365)),
    best_day: bestDay === -Infinity ? 0 : bestDay,
    worst_day: worstDay === Infinity ? 0 : worstDay,
    best_week: weeklyVals.length > 0 ? Math.max(...weeklyVals) : 0,
    worst_week: weeklyVals.length > 0 ? Math.min(...weeklyVals) : 0,
    best_month: monthlyVals.length > 0 ? Math.max(...monthlyVals) : 0,
    worst_month: monthlyVals.length > 0 ? Math.min(...monthlyVals) : 0,
    best_quarter: quarterlyVals.length > 0 ? Math.max(...quarterlyVals) : 0,
    worst_quarter: quarterlyVals.length > 0 ? Math.min(...quarterlyVals) : 0,
    best_year: yearlyVals.length > 0 ? Math.max(...yearlyVals) : 0,
    worst_year: yearlyVals.length > 0 ? Math.min(...yearlyVals) : 0,
    win_rate: winRate,
    avg_win: avgWin,
    avg_loss: avgLoss,
    profit_factor: profitFactor,
    var95,
    cvar95,
    recovery_factor: recoveryFactor,
    pain_index: painIndex,
    ulcer_index: ulcerIndex,
    tail_ratio: tailRatio,
    omega_ratio: omegaRatio,
    common_sense_ratio: commonSenseRatio,
    yearly: yearlyObj,
  };
}

/**
 * Phase 169.1 (D-28, D-30) — the conventions a strategy's metrics were computed
 * under, as `compute_all_metrics` takes them. Every field is optional; absent
 * means geometric, calendar, not calendar-dense, so a caller passing nothing
 * gets exactly the figures it always got.
 *
 *   - `cumulativeMethod`: "arithmetic" is the engine's `"simple"` (Σr, capital
 *     reset); "geometric" compounds.
 *   - `dayBasis`: "active" runs the headline risk statistics over the non-zero
 *     days only (the engine's `stat_returns`); "calendar" over every day.
 *   - `calendarDense`: the series stands for every calendar day (a composite,
 *     zero-filled by the stitch), so on the calendar basis ann_vol, sharpe,
 *     sortino and the arithmetic CAGR run over the zero-filled calendar series,
 *     not over the observations (D-32; `metricsBasisSeries`).
 */
export type ComputeConventions = {
  cumulativeMethod?: "geometric" | "arithmetic";
  dayBasis?: "calendar" | "active";
  calendarDense?: boolean;
};

/**
 * Phase 169.1 (D-30, D-32, D-36) — the ONE place the series the three headline
 * risk statistics (ann_vol, sharpe, sortino) run over is chosen, and where each
 * day lands in it: `positions[i]` is the index of `dates[i]` in `returns`, or
 * null when the basis excludes that day. It mirrors `compute_all_metrics`'s
 * `stat_returns` over the series the engine is handed:
 *
 *   - active day basis: the non-zero finite returns (the engine's
 *     `stat_returns`); a zero or non-finite day is null. Density does not matter
 *     here: a zero-filled 0.0 day would be excluded anyway.
 *   - calendar basis with `calendarDense` (a composite): the zero-filled calendar
 *     series from `dates[0]` to the last date inclusive, as
 *     `gap_fill_daily_returns` (densify_policy "zero_fill" in
 *     `run_stitch_composite_job`) hands it to the engine. Each present day keeps
 *     its return, every absent calendar day is 0.0, and `positions[i]` is the day
 *     offset of `dates[i]` from `dates[0]` (D-32). The dates must strictly
 *     increase: the engine's index is sorted and unique, so anything else throws.
 *   - otherwise: `rets` itself with the identity positions (byte-identical).
 */
export function metricsBasisSeries(
  rets: number[],
  dates: string[],
  conventions: ComputeConventions = {},
): { returns: number[]; positions: Array<number | null> } {
  if (conventions.dayBasis !== "active") {
    if (!conventions.calendarDense) {
      return { returns: rets, positions: rets.map((_, i) => i) };
    }
    const returns: number[] = [];
    const positions: Array<number | null> = [];
    for (let i = 0; i < rets.length; i++) {
      const offset = calendarDayOffset(dates[0], dates[i]);
      if (!Number.isFinite(offset) || offset < returns.length) {
        throw new Error(
          `metricsBasisSeries(): a calendar-dense series needs strictly increasing dates (got ${dates[i]} at index ${i}, after ${dates[i - 1] ?? "the start"})`,
        );
      }
      while (returns.length < offset) returns.push(0);
      positions.push(returns.length);
      returns.push(rets[i]);
    }
    return { returns, positions };
  }
  const returns: number[] = [];
  const positions: Array<number | null> = [];
  for (const r of rets) {
    if (Number.isFinite(r) && r !== 0) {
      positions.push(returns.length);
      returns.push(r);
    } else {
      positions.push(null);
    }
  }
  return { returns, positions };
}

/** Whole UTC days from the ISO date `from` to the ISO date `to` (NaN on an unparseable date). */
function calendarDayOffset(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function sumOf(xs: number[]): number {
  let t = 0;
  for (const x of xs) t += x;
  return t;
}

/** ISO 8601 week key (YYYY-Www) — the weekly bucket of compute()'s best / worst week. */
function isoWeekKey(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const diffWeeks = Math.round(
    ((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return `${d.getUTCFullYear()}-W${String(diffWeeks + 1).padStart(2, "0")}`;
}

/** Compounding accumulator for return buckets — `bucket *= (1 + r)`. */
function accumProduct(map: Map<string, number>, key: string, r: number): void {
  const prev = map.get(key);
  if (prev == null) map.set(key, r);
  else map.set(key, (1 + prev) * (1 + r) - 1);
}

/**
 * Summing accumulator for return buckets — `bucket += r`. The arithmetic
 * method's bucket (Phase 169.1 D-31), as the engine sums its monthly grid. It
 * starts at the first return, as {@link accumProduct} does, so a bucket is the
 * left fold of its returns in date order.
 */
function accumSum(map: Map<string, number>, key: string, r: number): void {
  const prev = map.get(key);
  map.set(key, prev == null ? r : prev + r);
}

/** Cumulative equity starting from 1.0. `cum_eq([r1, r2, ...])` → `[1+r1, (1+r1)*(1+r2), ...]`. */
export function cumEq(rets: number[]): number[] {
  const out: number[] = new Array(rets.length);
  let c = 1.0;
  for (let i = 0; i < rets.length; i++) {
    c *= 1 + rets[i];
    out[i] = c;
  }
  return out;
}

/**
 * Phase 90 (D3) — ARITHMETIC cumulative equity: `out[i] = 1 + running Σr`.
 * Mirrors `metrics.py:561-564` (`cumulative = 1.0 + returns.cumsum()`). Used for
 * COMPOSITE factsheets over the SPARSE `csv_daily_returns` series so the chart
 * endpoint equals the persisted (arithmetic) `cumulative_return` by construction.
 *
 * Gap-day invariant: an injected 0.0 return adds nothing to the running sum, so
 * the sparse-series endpoint == the dense-0.0-filled twin's endpoint (D3). This
 * is DISTINCT from the geometric {@link cumEq} (`∏(1+r)`) used on single-key
 * factsheets, which stays untouched.
 */
export function arithmeticEquity(rets: number[]): number[] {
  const out: number[] = new Array(rets.length);
  let s = 0;
  for (let i = 0; i < rets.length; i++) {
    s += rets[i];
    out[i] = 1 + s;
  }
  return out;
}

/**
 * Phase 90 (D3) — inception-seeded SUBTRACTIVE underwater: `cum = Σr`,
 * `peak = running max seeded at 0.0`, `out[i] = cum − peak` (≤ 0). Mirrors
 * `metrics.py:607-611` (`underwater = dd_cumsum − cummax().clip(lower=0)`).
 *
 * NOTE: this is NOT the geometric ratio {@link drawdowns} (`eq/peak − 1`). A
 * negative-first series is underwater from day 1 here (peak floored at 0),
 * whereas the geometric drawdown reports 0 on a monotone-up-from-inception leg.
 * Gap-day invariant: a 0.0 return advances neither `cum` nor `peak`, so the
 * trough (`min`) is identical between the sparse series and its dense-0.0 twin
 * (D3). Used only on the composite arithmetic branch.
 */
export function arithmeticUnderwater(rets: number[]): number[] {
  const out: number[] = new Array(rets.length);
  let cum = 0;
  let peak = 0; // seed at 0.0 → the running max is floored at inception
  for (let i = 0; i < rets.length; i++) {
    cum += rets[i];
    if (cum > peak) peak = cum;
    out[i] = cum - peak;
  }
  return out;
}

/** Drawdown from running peak. `drawdowns(eq) = eq/running_peak - 1`. */
export function drawdowns(eq: number[]): number[] {
  const out: number[] = new Array(eq.length);
  let peak = -Infinity;
  for (let i = 0; i < eq.length; i++) {
    if (eq[i] > peak) peak = eq[i];
    out[i] = peak !== 0 ? eq[i] / peak - 1 : 0;
  }
  return out;
}

/** A single drawdown period: peak → trough → recover-end, plus trough depth. */
export type DrawdownPeriod = {
  start: number;   // index of last peak before the drawdown
  trough: number;  // index of trough (lowest dd)
  recover: number; // index where dd first returns to ~0 (or last index if open)
  depth: number;   // dd value at trough (always ≤ 0)
};

/**
 * Walk a drawdown series and return every contiguous drawdown period.
 * Ports `all_dd_periods()` from `/tmp/gen_factsheet_v3.py`. Used to surface
 * the N worst drawdowns for the Worst-10 chart and the drawdown periods table.
 */
export function findDrawdownPeriods(dd: number[]): DrawdownPeriod[] {
  const out: DrawdownPeriod[] = [];
  let inDd = false;
  let start = 0;
  let trough = 0;
  let depth = 0;
  for (let i = 0; i < dd.length; i++) {
    const v = dd[i];
    if (!inDd && v < 0) {
      inDd = true;
      start = i > 0 ? i - 1 : 0;
      trough = i;
      depth = v;
    } else if (inDd) {
      if (v < depth) {
        trough = i;
        depth = v;
      }
      if (v >= -1e-9) {
        out.push({ start, trough, recover: i, depth });
        inDd = false;
      }
    }
  }
  if (inDd) out.push({ start, trough, recover: dd.length - 1, depth });
  return out;
}

/** Indices of the N deepest drawdowns. Used by the Worst-N DDs chart. */
export function worstDrawdowns(dd: number[], n = 10): DrawdownPeriod[] {
  return [...findDrawdownPeriods(dd)].sort((a, b) => a.depth - b.depth).slice(0, n);
}
