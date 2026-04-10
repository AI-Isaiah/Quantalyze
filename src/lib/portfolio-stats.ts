/**
 * Portfolio statistics calculation library.
 *
 * 15 quantitative functions for portfolio analytics: monthly/annual
 * returns, rolling metrics, VaR, expected shortfall, distribution,
 * win rate, best/worst periods, alpha/beta, tracking error, risk
 * decomposition, concentration, regime detection, weight drift, and
 * rebalance suggestions.
 *
 * All functions operate on plain arrays and DailyPoint — no external
 * dependencies beyond portfolio-math-utils.
 */

import type { DailyPoint } from "./portfolio-math-utils";
import { mean, stdDev, compound } from "./portfolio-math-utils";

// ── 1. computeMonthlyReturns ────────────────────────────────────────
/**
 * Group daily returns by year+month and compound each month.
 * Output dates are "YYYY-MM" format.
 */
export function computeMonthlyReturns(daily: DailyPoint[]): DailyPoint[] {
  if (daily.length === 0) return [];
  const groups = new Map<string, number[]>();
  for (const d of daily) {
    const key = d.date.slice(0, 7); // "YYYY-MM"
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(d.value);
  }
  const result: DailyPoint[] = [];
  for (const [key, returns] of groups) {
    result.push({ date: key, value: compound(returns) });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// ── 2. computeAnnualReturns ─────────────────────────────────────────
/**
 * Group daily returns by year and compound each year.
 * Output dates are "YYYY" format.
 */
export function computeAnnualReturns(daily: DailyPoint[]): DailyPoint[] {
  if (daily.length === 0) return [];
  const groups = new Map<string, number[]>();
  for (const d of daily) {
    const key = d.date.slice(0, 4); // "YYYY"
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(d.value);
  }
  const result: DailyPoint[] = [];
  for (const [key, returns] of groups) {
    result.push({ date: key, value: compound(returns) });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

// ── 3. computeRollingMetric ─────────────────────────────────────────
/**
 * Compute a sliding-window metric over daily returns.
 * - "sharpe": mean * sqrt(252) / std  (annualized, rf=0)
 * - "volatility": std * sqrt(252)  (annualized)
 *
 * Returns (n - window + 1) points, each dated at the window's last day.
 */
export function computeRollingMetric(
  daily: DailyPoint[],
  window: number,
  metric: "sharpe" | "volatility",
): DailyPoint[] {
  if (daily.length < window) return [];
  const result: DailyPoint[] = [];
  const sqrt252 = Math.sqrt(252);

  for (let i = window - 1; i < daily.length; i++) {
    const slice = daily.slice(i - window + 1, i + 1).map((d) => d.value);
    const m = mean(slice);
    const s = stdDev(slice, true);

    let value: number;
    if (metric === "sharpe") {
      value = s > 0 ? (m * sqrt252) / s : 0;
    } else {
      value = s * sqrt252;
    }
    result.push({ date: daily[i].date, value });
  }
  return result;
}

// ── 4. computeVaR ───────────────────────────────────────────────────
/**
 * Value at Risk: the return at the (1-confidence) quantile.
 * Sort ascending, pick index floor((1-confidence) * n).
 */
export function computeVaR(returns: number[], confidence: number): number {
  if (returns.length === 0) return 0;
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor((1 - confidence) * sorted.length);
  return sorted[Math.max(0, idx)];
}

// ── 5. computeExpectedShortfall ─────────────────────────────────────
/**
 * Expected Shortfall (CVaR): mean of all returns at or below the VaR.
 */
export function computeExpectedShortfall(
  returns: number[],
  confidence: number,
): number {
  const var_ = computeVaR(returns, confidence);
  const tail = returns.filter((r) => r <= var_);
  if (tail.length === 0) return var_;
  return mean(tail);
}

// ── 6. computeReturnDistribution ────────────────────────────────────
export interface DistributionBin {
  min: number;
  max: number;
  count: number;
}

/**
 * Histogram of return values split into equal-width bins.
 * Every return is counted exactly once; the last bin is inclusive on both ends.
 */
export function computeReturnDistribution(
  returns: number[],
  bins: number,
): DistributionBin[] {
  if (returns.length === 0 || bins <= 0) return [];
  const minVal = Math.min(...returns);
  const maxVal = Math.max(...returns);
  const range = maxVal - minVal;
  const binWidth = range / bins;

  const result: DistributionBin[] = Array.from({ length: bins }, (_, i) => ({
    min: minVal + i * binWidth,
    max: minVal + (i + 1) * binWidth,
    count: 0,
  }));

  for (const r of returns) {
    let idx = binWidth > 0 ? Math.floor((r - minVal) / binWidth) : 0;
    // Clamp the max value into the last bin
    if (idx >= bins) idx = bins - 1;
    result[idx].count++;
  }

  return result;
}

// ── 7. computeWinRate ───────────────────────────────────────────────
export interface WinRateResult {
  winRate: number;
  profitFactor: number;
}

/**
 * Win rate = positive returns / total.
 * Profit factor = sum(positive returns) / |sum(negative returns)|.
 */
export function computeWinRate(returns: number[]): WinRateResult {
  if (returns.length === 0) return { winRate: 0, profitFactor: 0 };
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const winRate = wins.length / returns.length;
  const sumWins = wins.reduce((s, v) => s + v, 0);
  const sumLosses = losses.reduce((s, v) => s + v, 0);
  const profitFactor =
    sumLosses === 0 ? (sumWins > 0 ? Infinity : 0) : sumWins / Math.abs(sumLosses);
  return { winRate, profitFactor };
}

// ── 8. computeBestWorstPeriods ──────────────────────────────────────
interface PeriodExtreme {
  date: string;
  value: number;
}

export interface BestWorstResult {
  day: { best: PeriodExtreme; worst: PeriodExtreme };
  week: { best: PeriodExtreme; worst: PeriodExtreme };
  month: { best: PeriodExtreme; worst: PeriodExtreme };
  quarter: { best: PeriodExtreme; worst: PeriodExtreme };
}

/**
 * Get ISO week key for a date string. Returns "YYYY-WNN".
 */
function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayOfYear =
    Math.floor(
      (d.getTime() - new Date(Date.UTC(d.getUTCFullYear(), 0, 1)).getTime()) /
        86_400_000,
    ) + 1;
  const weekNum = Math.ceil(dayOfYear / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function quarterKey(dateStr: string): string {
  const month = parseInt(dateStr.slice(5, 7), 10);
  const q = Math.ceil(month / 3);
  return `${dateStr.slice(0, 4)}-Q${q}`;
}

function aggregatePeriods(
  daily: DailyPoint[],
  keyFn: (d: DailyPoint) => string,
): Map<string, number> {
  const groups = new Map<string, number[]>();
  for (const d of daily) {
    const key = keyFn(d);
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(d.value);
  }
  const result = new Map<string, number>();
  for (const [key, returns] of groups) {
    result.set(key, compound(returns));
  }
  return result;
}

function findMinMax(
  periods: Map<string, number>,
): { best: PeriodExtreme; worst: PeriodExtreme } {
  if (periods.size === 0) {
    return {
      best: { date: "", value: 0 },
      worst: { date: "", value: 0 },
    };
  }
  let bestKey = "";
  let bestVal = -Infinity;
  let worstKey = "";
  let worstVal = Infinity;
  for (const [key, val] of periods) {
    if (val > bestVal) {
      bestVal = val;
      bestKey = key;
    }
    if (val < worstVal) {
      worstVal = val;
      worstKey = key;
    }
  }
  return {
    best: { date: bestKey, value: bestVal },
    worst: { date: worstKey, value: worstVal },
  };
}

/**
 * Find the best and worst return periods at day, week, month, and
 * quarter granularity. Returns are compounded within each period.
 */
export function computeBestWorstPeriods(
  daily: DailyPoint[],
): BestWorstResult {
  // Day: each point is its own period (no compounding needed)
  const dayPeriods = new Map<string, number>();
  for (const d of daily) dayPeriods.set(d.date, d.value);

  const weekPeriods = aggregatePeriods(daily, (d) => isoWeekKey(d.date));
  const monthPeriods = aggregatePeriods(daily, (d) => d.date.slice(0, 7));
  const qPeriods = aggregatePeriods(daily, (d) => quarterKey(d.date));

  return {
    day: findMinMax(dayPeriods),
    week: findMinMax(weekPeriods),
    month: findMinMax(monthPeriods),
    quarter: findMinMax(qPeriods),
  };
}

// ── 9. computeAlphaBeta ─────────────────────────────────────────────
export interface AlphaBetaResult {
  alpha: number;
  beta: number;
}

/**
 * CAPM alpha and beta.
 * beta = cov(r, b) / var(b)
 * alpha = annualized excess return (mean(r) - beta * mean(b)) * 252
 */
export function computeAlphaBeta(
  returns: number[],
  benchmark: number[],
): AlphaBetaResult {
  const n = Math.min(returns.length, benchmark.length);
  if (n < 2) return { alpha: 0, beta: 0 };

  const r = returns.slice(0, n);
  const b = benchmark.slice(0, n);
  const meanR = mean(r);
  const meanB = mean(b);

  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const dr = r[i] - meanR;
    const db = b[i] - meanB;
    cov += dr * db;
    varB += db * db;
  }

  const beta = varB > 0 ? cov / varB : 0;
  const alpha = (meanR - beta * meanB) * 252;
  return { alpha, beta };
}

// ── 10. computeTrackingError ────────────────────────────────────────
/**
 * Tracking error: annualized standard deviation of the return
 * difference (r - benchmark).
 * TE = std(r - b) * sqrt(252)
 */
export function computeTrackingError(
  returns: number[],
  benchmark: number[],
): number {
  const n = Math.min(returns.length, benchmark.length);
  if (n < 2) return 0;
  const diff: number[] = [];
  for (let i = 0; i < n; i++) {
    diff.push(returns[i] - benchmark[i]);
  }
  return stdDev(diff, true) * Math.sqrt(252);
}

// ── 11. computeRiskDecomposition ────────────────────────────────────
export interface RiskContribution {
  /** Marginal contribution to portfolio variance. */
  contribution: number;
  /** Percentage of total portfolio variance. */
  percentage: number;
}

/**
 * Risk decomposition via covariance matrix.
 * Marginal contribution of asset i = w_i * (C * w)_i
 * where C is the covariance matrix and w is the weight vector.
 */
export function computeRiskDecomposition(
  weights: number[],
  covMatrix: number[][],
): RiskContribution[] {
  const n = weights.length;

  // Compute C * w
  const cw: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      cw[i] += covMatrix[i][j] * weights[j];
    }
  }

  // Marginal contribution: w_i * (C * w)_i
  const contributions: number[] = weights.map((w, i) => w * cw[i]);
  const totalVariance = contributions.reduce((s, c) => s + c, 0);

  return contributions.map((c) => ({
    contribution: c,
    percentage: totalVariance > 0 ? (c / totalVariance) * 100 : 0,
  }));
}

// ── 12. computeHerfindahlIndex ──────────────────────────────────────
/**
 * Herfindahl-Hirschman Index: sum of squared weights.
 * Ranges from 1/n (perfectly diversified) to 1 (single asset).
 */
export function computeHerfindahlIndex(weights: number[]): number {
  return weights.reduce((s, w) => s + w * w, 0);
}

// ── 13. detectRegimeChanges ─────────────────────────────────────────
export interface RegimeCrossover {
  /** Date of the crossover. */
  date: string;
  /** Index in the original series. */
  index: number;
  /** "bullish" if fast MA crosses above slow, "bearish" if below. */
  direction: "bullish" | "bearish";
}

/**
 * Detect regime changes via 50-day vs 200-day moving average crossover
 * on cumulative returns. Returns crossover points where the fast MA
 * crosses the slow MA.
 */
export function detectRegimeChanges(
  daily: DailyPoint[],
  fastWindow = 50,
  slowWindow = 200,
): RegimeCrossover[] {
  if (daily.length < slowWindow) return [];

  // Build cumulative return series
  const cumulative: number[] = [];
  let c = 1;
  for (const d of daily) {
    c *= 1 + d.value;
    cumulative.push(c);
  }

  // Compute MAs and detect crossovers
  const result: RegimeCrossover[] = [];

  function movingAvg(arr: number[], end: number, window: number): number {
    let sum = 0;
    for (let i = end - window + 1; i <= end; i++) sum += arr[i];
    return sum / window;
  }

  let prevFastAbove: boolean | null = null;
  for (let i = slowWindow - 1; i < cumulative.length; i++) {
    const fastMA = movingAvg(cumulative, i, fastWindow);
    const slowMA = movingAvg(cumulative, i, slowWindow);
    const fastAbove = fastMA > slowMA;

    if (prevFastAbove !== null && fastAbove !== prevFastAbove) {
      result.push({
        date: daily[i].date,
        index: i,
        direction: fastAbove ? "bullish" : "bearish",
      });
    }
    prevFastAbove = fastAbove;
  }

  return result;
}

// ── 14. computeWeightDrift ──────────────────────────────────────────
/**
 * Pairwise difference: current[i] - target[i].
 * Positive drift = overweight; negative = underweight.
 */
export function computeWeightDrift(
  current: number[],
  target: number[],
): number[] {
  return current.map((c, i) => c - (target[i] ?? 0));
}

// ── 15. computeRebalanceSuggestions ─────────────────────────────────
export interface RebalanceSuggestion {
  name: string;
  drift: number;
  direction: "buy" | "sell" | "hold";
}

/**
 * Generate rebalance suggestions from current vs target weights.
 * Each suggestion includes the drift amount and a direction.
 */
export function computeRebalanceSuggestions(
  current: number[],
  target: number[],
  names: string[],
): RebalanceSuggestion[] {
  const drift = computeWeightDrift(current, target);
  return drift.map((d, i) => ({
    name: names[i] ?? `Asset ${i}`,
    drift: d,
    direction: d > 0 ? "sell" : d < 0 ? "buy" : "hold",
  }));
}
