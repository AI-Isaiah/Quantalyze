import type { ComputeResult } from "./types";

/**
 * Headline per-series metrics for the strategy and each benchmark. Mirrors the
 * Python reference's numerical conventions:
 *
 *   - 252 trading days / year
 *   - population stdev (not sample) — `statistics.pstdev`
 *   - CAGR = eq[-1] ** (1 / years) - 1
 *   - Sharpe / Sortino use rf = 0 unless explicitly passed
 *
 * Degenerate cases (no drawdown, no losses, no left tail) surface as `null`
 * rather than 0 — `0 recovery_factor` would imply a real but zero ratio.
 */
export function compute(rets: number[], dates: string[], rf = 0): ComputeResult {
  const n = rets.length;
  if (n === 0 || dates.length !== n) {
    throw new Error("compute(): rets and dates must be non-empty arrays of equal length");
  }

  const eq = cumEq(rets);
  const dd = drawdowns(eq);
  const m = mean(rets);
  const s = pstdev(rets, m);
  const startDate = new Date(dates[0]);
  const endDate = new Date(dates[n - 1]);
  const days = Math.max(1, (endDate.getTime() - startDate.getTime()) / 86_400_000);
  const years = days / 365.25;

  const cumRet = eq[n - 1] - 1;
  const cagr = years > 0 && eq[n - 1] > 0 ? Math.pow(eq[n - 1], 1 / years) - 1 : 0;
  const annVol = s * Math.sqrt(252);
  const sharpe = s > 0 ? ((m - rf / 252) * 252) / (s * Math.sqrt(252)) : 0;

  const neg = rets.filter(x => x < 0);
  const ddDev = neg.length > 0 ? Math.sqrt(neg.reduce((a, x) => a + x * x, 0) / n) * Math.sqrt(252) : 0;
  const sortino = ddDev > 0 ? ((m - rf / 252) * 252) / ddDev : 0;

  let maxDd = 0;
  for (let i = 0; i < dd.length; i++) if (dd[i] < maxDd) maxDd = dd[i];
  const calmar = maxDd !== 0 ? cagr / Math.abs(maxDd) : 0;

  const skew = s > 0 ? rets.reduce((a, x) => a + Math.pow((x - m) / s, 3), 0) / n : 0;
  const kurt = s > 0 ? rets.reduce((a, x) => a + Math.pow((x - m) / s, 4), 0) / n - 3 : 0;

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
  const avgWin = winCount > 0 ? winSum / winCount : 0;
  const avgLoss = lossCount > 0 ? lossSum / lossCount : 0;
  const profitFactor = lossSum !== 0 ? winSum / Math.abs(lossSum) : 0;
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
  const commonSenseRatio = tailRatio != null ? tailRatio * profitFactor : null;

  // Bucketed returns — compound returns within each bucket.
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
    accumProduct(monthly, `${yr}-${mo}`, rets[i]);
    accumProduct(quarterly, quarter, rets[i]);
    accumProduct(yearly, yr, rets[i]);
    accumProduct(weekly, isoWeek, rets[i]);
  }
  const monthlyVals = Array.from(monthly.values());
  const quarterlyVals = Array.from(quarterly.values());
  const yearlyVals = Array.from(yearly.values());
  const weeklyVals = Array.from(weekly.values());

  const lastIso = dates[n - 1];
  const lastDate = new Date(lastIso);
  const lastYear = lastIso.slice(0, 4);
  const lastMonth = lastIso.slice(0, 7);
  const compoundFrom = (cutoff: Date): number => {
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
    mtd: compoundFrom(mtdCutoff),
    ytd: compoundFrom(ytdCutoff),
    p3m: compoundFrom(offsetDays(90)),
    p6m: compoundFrom(offsetDays(182)),
    p1y: compoundFrom(offsetDays(365)),
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

/** ISO 8601 week key (YYYY-Www) — used for compounding weekly returns. */
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

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Population stdev — matches Python's `statistics.pstdev`. */
function pstdev(xs: number[], m: number): number {
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / xs.length);
}
