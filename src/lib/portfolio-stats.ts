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

// ── Non-finite drop diagnostic ──────────────────────────────────────
// computeReturnDistribution, findMinMax, and detectRegimeChanges all
// SKIP non-finite (NaN/±Infinity) values to stay crash-safe (see each
// call site). Dropping silently would mask an upstream data-corruption
// signal — e.g. a malformed CSV daily_return — so each emits a one-shot
// console.warn breadcrumb naming the dropped count + function context.
// This mirrors the sibling drawdown-math.ts "corrupted-input signal"
// convention. There is no shared logger util in src/lib; console.warn
// is the established channel.
//
// These functions can run per-render, so the breadcrumb must not spam:
// a module-level Set of function-context keys fires the warning at most
// ONCE per context per process. Return values are unaffected — this is
// purely an added diagnostic.
const nonFiniteWarnedContexts = new Set<string>();

function warnDroppedNonFinite(context: string, dropped: number): void {
  if (dropped <= 0) return;
  if (nonFiniteWarnedContexts.has(context)) return;
  nonFiniteWarnedContexts.add(context);
  if (typeof console !== "undefined") {
    console.warn(
      `[${context}] dropped ${dropped} non-finite (NaN/±Infinity) value(s) — ` +
        `likely upstream data corruption (e.g. a malformed daily_return). ` +
        `These were skipped to stay crash-safe; output reflects only finite values.`,
    );
  }
}

/**
 * Test-only: clear the module-scoped one-shot warn guard so a test can
 * assert the breadcrumb fires (and, separately, that clean input does
 * NOT warn) without a process restart. Mirrors the codebase's
 * `__resetXForTest` convention.
 */
export function __resetNonFiniteWarningsForTest(): void {
  nonFiniteWarnedContexts.clear();
}

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
  // F2 M-0541: clamp BOTH bounds. confidence=0 gives idx = floor(1 * n) = n →
  // sorted[n] is `undefined`, which then poisons computeExpectedShortfall
  // (`filter(r => r <= undefined)` → []) and propagates NaN to any consumer.
  // The lower clamp already existed; the upper bound was missing.
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((1 - confidence) * sorted.length)),
  );
  return sorted[idx];
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
  if (bins <= 0) return [];
  // Drop non-finite values (NaN/±Infinity). A single +Infinity entry
  // otherwise drives binWidth to Infinity and produces idx = floor(x/Inf)
  // = NaN, which dereferences result[NaN] (undefined) → TypeError; NaN
  // entries silently corrupt every bin boundary into NaN.
  let minVal = Infinity;
  let maxVal = -Infinity;
  let finiteCount = 0;
  for (const r of returns) {
    if (!Number.isFinite(r)) continue;
    finiteCount++;
    if (r < minVal) minVal = r;
    if (r > maxVal) maxVal = r;
  }
  warnDroppedNonFinite("computeReturnDistribution", returns.length - finiteCount);
  if (finiteCount === 0) return [];
  const range = maxVal - minVal;
  // M-0542: when every finite return is identical (range === 0) the generic
  // path emits `bins` bins all sharing min === max === minVal — bin 0 holds
  // every count while bins 1..n-1 are zero-count noise bins with identical
  // boundaries, a misleading histogram for a constant-return strategy.
  // Collapse to the single meaningful bin.
  if (range === 0) {
    return [{ min: minVal, max: minVal, count: finiteCount }];
  }
  const binWidth = range / bins;

  const result: DistributionBin[] = Array.from({ length: bins }, (_, i) => ({
    min: minVal + i * binWidth,
    max: minVal + (i + 1) * binWidth,
    count: 0,
  }));

  for (const r of returns) {
    if (!Number.isFinite(r)) continue;
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
  /**
   * Sum(wins) / |sum(losses)|. `null` when there are wins but no losses — the
   * ratio is mathematically infinite, and M-0543: a non-finite `number` is
   * silently coerced to `null` by JSON.stringify (RFC 8259 §6) on its way to
   * the client anyway, so a `number`-typed field would lie over the wire.
   * `null` makes "undefined ratio (no downside)" explicit and JSON-round-
   * trippable. `0` stays reserved for the genuinely-zero cases (no trades, or
   * no wins) — distinct from "infinitely good".
   */
  profitFactor: number | null;
}

/**
 * Win rate = positive returns / total.
 * Profit factor = sum(positive returns) / |sum(negative returns)|, or `null`
 * when there are wins but no losses (see {@link WinRateResult.profitFactor}).
 */
export function computeWinRate(returns: number[]): WinRateResult {
  if (returns.length === 0) return { winRate: 0, profitFactor: 0 };
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const winRate = wins.length / returns.length;
  const sumWins = wins.reduce((s, v) => s + v, 0);
  const sumLosses = losses.reduce((s, v) => s + v, 0);
  const profitFactor: number | null =
    sumLosses === 0 ? (sumWins > 0 ? null : 0) : sumWins / Math.abs(sumLosses);
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
 * Get the ISO 8601 week key for a date string. Returns "YYYY-WNN" where
 * YYYY is the ISO week-numbering year (which can differ from the calendar
 * year near year boundaries) and NN is the ISO week (01-53).
 *
 * ISO weeks start on Monday; week 1 is the week containing the year's
 * first Thursday. Days late in December or early in January can therefore
 * belong to the adjacent year's week — e.g. 2024-12-30 (Mon) is 2025-W01.
 * A naive ceil(dayOfYear/7) splits such weeks across the year boundary and
 * mislabels them.
 */
function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  // Shift to the Thursday of this date's ISO week. (getUTCDay()+6)%7 maps
  // Mon=0..Sun=6; subtracting it lands on Monday, +3 lands on Thursday.
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();
  // Thursday of ISO week 1 = the Thursday of the week containing Jan 4.
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const weekNum =
    1 +
    Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
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
  let sawFinite = false;
  let droppedNonFinite = 0;
  for (const [key, val] of periods) {
    // Skip non-finite periods: every comparison against NaN is false (so
    // NaN periods would be silently dropped while leaving the ±Infinity
    // sentinels in place), and a period that overflowed to ±Infinity is a
    // meaningless extreme to surface as "best"/"worst".
    if (!Number.isFinite(val)) {
      droppedNonFinite++;
      continue;
    }
    sawFinite = true;
    if (val > bestVal) {
      bestVal = val;
      bestKey = key;
    }
    if (val < worstVal) {
      worstVal = val;
      worstKey = key;
    }
  }
  warnDroppedNonFinite("findMinMax", droppedNonFinite);
  if (!sawFinite) {
    // No finite period: return the same neutral sentinel as empty input
    // rather than the misleading best=-Infinity / worst=+Infinity.
    return {
      best: { date: "", value: 0 },
      worst: { date: "", value: 0 },
    };
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
 * Herfindahl-Hirschman Index of portfolio concentration, computed on
 * gross-exposure weights (each weight divided by the total absolute exposure
 * Σ|wᵢ|). Ranges from 1/n (perfectly diversified) to 1 (single concentrated
 * position) for ANY book — including long-short books with negative weights.
 *
 * M-0544: the prior `Σwᵢ²` silently returned out-of-range values for shorts
 * (e.g. [1.5, -0.5] → 2.5, violating the documented [1/n, 1] range and
 * rendering "Concentration: 2.5" gibberish). Normalizing by gross exposure
 * keeps the result in range and preserves the concentration interpretation.
 * For an all-non-negative book that already sums to 1, Σ|wᵢ| = 1 so this
 * reduces to the textbook Σwᵢ² (backward compatible).
 *
 * Returns 0 for an empty or all-zero book — no exposure means concentration
 * is undefined, and 0 is the inert sentinel (distinct from the [1/n, 1] live
 * range, so a caller can tell "no book" from "fully diversified").
 */
export function computeHerfindahlIndex(weights: number[]): number {
  const gross = weights.reduce((s, w) => s + Math.abs(w), 0);
  if (gross === 0) return 0;
  return weights.reduce((s, w) => {
    const norm = Math.abs(w) / gross;
    return s + norm * norm;
  }, 0);
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

  // Build cumulative return series. Stop if the running product overflows
  // to a non-finite value: once c is Infinity every later point is Infinity
  // too, the moving averages all become Infinity, and `fastMA > slowMA`
  // (Infinity > Infinity) is false — so the detector would go permanently
  // dead. Detecting over the finite prefix is strictly better.
  const cumulative: number[] = [];
  let c = 1;
  for (const d of daily) {
    c *= 1 + d.value;
    if (!Number.isFinite(c)) break;
    cumulative.push(c);
  }
  warnDroppedNonFinite("detectRegimeChanges", daily.length - cumulative.length);

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
