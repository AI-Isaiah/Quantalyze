/**
 * Scenario math — client-side portfolio analytics from raw daily returns.
 *
 * Extracted from `src/components/scenarios/ScenarioBuilder.tsx` in PR 3
 * of the My Allocation restructure so the exact same math can power both
 * the Scenario Builder page (unchanged behavior) and the Favorites panel
 * overlay on the My Allocation dashboard (new in PR 3/4).
 *
 * The core function `computeScenario` takes a set of strategies with
 * embedded daily-return series, a weights + include-from state object,
 * and a pre-built date-map cache, and returns a full set of portfolio
 * metrics: TWR, CAGR, volatility, Sharpe, Sortino, max drawdown, the
 * correlation matrix, and a cumulative equity curve.
 *
 * Behavior notes preserved verbatim from ScenarioBuilder:
 *
 *   1. Per-strategy "include from" dates are honored PER strategy. The
 *      merged date axis is the UNION of every active strategy's dates
 *      >= its own configured start. On days where a strategy isn't yet
 *      active, its return is zero-filled and the weight sum is
 *      renormalized so the active subset still sums to 1. This prevents
 *      the scenario from silently shrinking its window to the overlap
 *      when a late-inception strategy joins, and makes earlier
 *      include-from dates actually take effect.
 *
 *   2. Correlation uses SAMPLE covariance (divide by n-1), consistent
 *      with the SAMPLE std used for portfolio volatility. Correlation
 *      between two identical series is 1.
 *
 *   3. Avg pairwise correlation is the average of ABSOLUTE correlations.
 *      A signed average would mask a book that's half strongly positive
 *      and half strongly negative as "diversified".
 *
 *   4. Sortino divides the downside RMS by TOTAL observations (n), not
 *      by the count of negative days. Dividing by downsides.length
 *      inflates Sortino during calm periods.
 *
 *   5. Equity curve is downsampled to every 5 business days for payload
 *      size, with the final point always included so the curve touches
 *      the effective_end date.
 *
 * Any change to these behaviors is a regression — unit tests in
 * `src/lib/scenario.test.ts` pin them (PR 3 scope).
 */

import type { DailyPoint } from "./portfolio-math-utils";
export type { DailyPoint } from "./portfolio-math-utils";

export interface StrategyForBuilder {
  id: string;
  name: string;
  codename: string | null;
  disclosure_tier: string;
  strategy_types: string[];
  markets: string[];
  start_date: string | null;
  daily_returns: DailyPoint[];
  cagr: number | null;
  sharpe: number | null;
  volatility: number | null;
  max_drawdown: number | null;
}

export interface ScenarioState {
  selected: Record<string, boolean>;
  weights: Record<string, number>; // 0..1 (or any non-negative — renormalized)
  startDates: Record<string, string>; // ISO date; strategy included from >= this
}

export interface ComputedMetrics {
  n: number;
  twr: number | null;
  cagr: number | null;
  volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  max_drawdown: number | null;
  max_dd_days: number | null;
  correlation_matrix: Record<string, Record<string, number>> | null;
  avg_pairwise_correlation: number | null;
  equity_curve: Array<{ date: string; value: number }>;
  effective_start: string | null;
  effective_end: string | null;
}

/**
 * Build a per-strategy lookup Map (strategy_id → (date → daily return)).
 * The caller memoizes this against the `strategies` array so toggling a
 * checkbox or scrubbing a weight input doesn't reallocate 15 Maps of ~1000
 * entries each on every recompute.
 */
export function buildDateMapCache(
  strategies: StrategyForBuilder[],
): Map<string, Map<string, number>> {
  const cache = new Map<string, Map<string, number>>();
  for (const s of strategies) {
    const m = new Map<string, number>();
    for (const d of s.daily_returns) m.set(d.date, d.value);
    cache.set(s.id, m);
  }
  return cache;
}

export function computeScenario(
  strategies: StrategyForBuilder[],
  state: ScenarioState,
  dateMapCache: Map<string, Map<string, number>>,
): ComputedMetrics {
  const activeIds = strategies
    .map((s) => s.id)
    .filter((id) => state.selected[id]);
  if (activeIds.length === 0) {
    return {
      n: 0,
      twr: null,
      cagr: null,
      volatility: null,
      sharpe: null,
      sortino: null,
      max_drawdown: null,
      max_dd_days: null,
      correlation_matrix: null,
      avg_pairwise_correlation: null,
      equity_curve: [],
      effective_start: null,
      effective_end: null,
    };
  }

  const activeStrategies = strategies.filter((s) => state.selected[s.id]);
  const totalWeight = activeStrategies.reduce(
    (s, x) => s + (state.weights[x.id] ?? 0),
    0,
  );
  const normWeight = (id: string) =>
    totalWeight > 0 ? (state.weights[id] ?? 0) / totalWeight : 0;

  const strategyStart = new Map<string, string>();
  for (const s of activeStrategies) {
    const chosen = state.startDates[s.id] ?? s.start_date ?? "2022-01-01";
    strategyStart.set(s.id, chosen);
  }

  // Union of all dates that appear in ANY active strategy AFTER its own
  // include-from. Sorted chronologically.
  const allDateSet = new Set<string>();
  for (const s of activeStrategies) {
    const from = strategyStart.get(s.id)!;
    for (const d of s.daily_returns) {
      if (d.date >= from) allDateSet.add(d.date);
    }
  }
  const commonDates = Array.from(allDateSet).sort();
  const n = commonDates.length;
  if (n < 10) {
    return {
      n,
      twr: null,
      cagr: null,
      volatility: null,
      sharpe: null,
      sortino: null,
      max_drawdown: null,
      max_dd_days: null,
      correlation_matrix: null,
      avg_pairwise_correlation: null,
      equity_curve: [],
      effective_start: commonDates[0] ?? null,
      effective_end: commonDates[n - 1] ?? null,
    };
  }

  const strategyReturns: Record<string, number[]> = {};
  for (const s of activeStrategies) {
    const map = dateMapCache.get(s.id)!;
    const from = strategyStart.get(s.id)!;
    strategyReturns[s.id] = commonDates.map((d) =>
      d >= from ? (map.get(d) ?? 0) : 0,
    );
  }

  // Portfolio daily returns = weighted sum, with renormalization on days
  // where some strategies haven't started yet.
  const portDaily: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let activeWeightSum = 0;
    for (const s of activeStrategies) {
      const from = strategyStart.get(s.id)!;
      if (commonDates[i] < from) continue;
      const w = normWeight(s.id);
      r += w * strategyReturns[s.id][i];
      activeWeightSum += w;
    }
    portDaily[i] = activeWeightSum > 0 ? r / activeWeightSum : 0;
  }

  // Cumulative (full-resolution) used for TWR / CAGR / drawdown. Equity
  // curve output is downsampled below for payload size.
  const cumulative: number[] = new Array(n);
  let c = 1;
  for (let i = 0; i < n; i++) {
    c *= 1 + portDaily[i];
    cumulative[i] = c;
  }
  const twr = cumulative[n - 1] - 1;
  const years = n / 252;
  const cagr = years > 0 ? Math.pow(1 + twr, 1 / years) - 1 : null;

  // Vol (sample std), Sharpe (rf=0), Sortino (rf=0).
  const meanR = portDaily.reduce((s, r) => s + r, 0) / n;
  const variance =
    portDaily.reduce((s, r) => s + (r - meanR) * (r - meanR), 0) / (n - 1);
  const volDaily = Math.sqrt(variance);
  const volatility = volDaily * Math.sqrt(252);
  const sharpe = volatility > 0 ? (meanR * 252) / volatility : null;

  // Sortino: downside RMS divides by TOTAL observations (n), not by the
  // count of negative days. See the file-level behavior notes.
  const downsideSumSq = portDaily.reduce(
    (s, r) => s + (r < 0 ? r * r : 0),
    0,
  );
  const downsideVar = downsideSumSq / n;
  const downsideVol = Math.sqrt(downsideVar) * Math.sqrt(252);
  const sortino = downsideVol > 0 ? (meanR * 252) / downsideVol : (sharpe ?? 0);

  // Max drawdown + duration.
  let peak = cumulative[0];
  let maxDD = 0;
  let currentDuration = 0;
  let maxDuration = 0;
  for (let i = 0; i < n; i++) {
    if (cumulative[i] > peak) {
      peak = cumulative[i];
      currentDuration = 0;
    } else {
      currentDuration += 1;
    }
    const dd = cumulative[i] / peak - 1;
    if (dd < maxDD) maxDD = dd;
    if (currentDuration > maxDuration) maxDuration = currentDuration;
  }

  // Correlation matrix (Pearson on daily returns). Sample covariance
  // (n-1) to match the sample-std denominator above.
  const strategyStats = new Map<
    string,
    { mean: number; std: number; demeaned: number[] }
  >();
  for (const s of activeStrategies) {
    const vec = strategyReturns[s.id];
    const mean = vec.reduce((sum, v) => sum + v, 0) / vec.length;
    const demeaned = vec.map((v) => v - mean);
    const sampleVar =
      vec.length > 1
        ? demeaned.reduce((sum, d) => sum + d * d, 0) / (vec.length - 1)
        : 0;
    strategyStats.set(s.id, {
      mean,
      std: Math.sqrt(sampleVar),
      demeaned,
    });
  }

  const correlation_matrix: Record<string, Record<string, number>> = {};
  let absCorrSum = 0;
  let corrCount = 0;
  for (let i = 0; i < activeStrategies.length; i++) {
    const idA = activeStrategies[i].id;
    correlation_matrix[idA] = {};
    const statA = strategyStats.get(idA)!;
    for (let j = 0; j < activeStrategies.length; j++) {
      const idB = activeStrategies[j].id;
      if (i === j) {
        correlation_matrix[idA][idB] = 1;
        continue;
      }
      const statB = strategyStats.get(idB)!;
      const T = statA.demeaned.length;
      let cov = 0;
      for (let k = 0; k < T; k++) {
        cov += statA.demeaned[k] * statB.demeaned[k];
      }
      cov = T > 1 ? cov / (T - 1) : 0;
      const corr =
        statA.std > 0 && statB.std > 0 ? cov / (statA.std * statB.std) : 0;
      correlation_matrix[idA][idB] = Number(corr.toFixed(3));
      if (j > i) {
        // Absolute values to match the "Avg |corr|" label.
        absCorrSum += Math.abs(corr);
        corrCount += 1;
      }
    }
  }
  const avg_pairwise_correlation =
    corrCount > 0 ? Number((absCorrSum / corrCount).toFixed(3)) : null;

  // Downsampled equity curve (weekly, every 5 business days).
  const equity_curve: Array<{ date: string; value: number }> = [];
  for (let i = 0; i < n; i += 5) {
    equity_curve.push({
      date: commonDates[i],
      value: Number((cumulative[i] - 1).toFixed(5)),
    });
  }
  if (equity_curve[equity_curve.length - 1]?.date !== commonDates[n - 1]) {
    equity_curve.push({
      date: commonDates[n - 1],
      value: Number((cumulative[n - 1] - 1).toFixed(5)),
    });
  }

  return {
    n,
    twr: Number(twr.toFixed(5)),
    cagr: cagr !== null ? Number(cagr.toFixed(5)) : null,
    volatility: Number(volatility.toFixed(5)),
    sharpe: sharpe !== null ? Number(sharpe.toFixed(3)) : null,
    sortino: Number(sortino.toFixed(3)),
    max_drawdown: Number(maxDD.toFixed(5)),
    max_dd_days: maxDuration,
    correlation_matrix,
    avg_pairwise_correlation,
    equity_curve,
    effective_start: commonDates[0],
    effective_end: commonDates[n - 1],
  };
}

/**
 * Compute a single strategy's cumulative equity curve from its daily
 * returns series. Returns full daily resolution (NOT downsampled) so the
 * multi-strategy chart on the My Allocation dashboard can align all lines
 * on the same date axis without interpolation.
 *
 * `value` is the cumulative wealth multiplier: 1.0 = flat, 1.18 = +18%,
 * matching the format PortfolioEquityCurve expects for its `strategies[]`
 * prop.
 */
export function computeStrategyCurve(
  dailyReturns: DailyPoint[],
): DailyPoint[] {
  let c = 1;
  const out: DailyPoint[] = new Array(dailyReturns.length);
  for (let i = 0; i < dailyReturns.length; i++) {
    c *= 1 + dailyReturns[i].value;
    out[i] = { date: dailyReturns[i].date, value: Number(c.toFixed(6)) };
  }
  return out;
}

/**
 * Compute a weighted composite cumulative curve for a set of strategies
 * with explicit per-strategy weights. Thin wrapper over computeScenario
 * that skips the correlation/risk metrics and just returns the curve in
 * full daily resolution, suitable for direct rendering via
 * PortfolioEquityCurve.
 *
 * Used by the My Allocation page to render the real portfolio's composite
 * curve (no favorites, current weights) and by PR 4's Favorites panel to
 * render the "+ Favorites" overlay curve (real + toggled favorites with a
 * sleeve carved out of the book).
 *
 * `weightsById` maps strategy_id → weight (any non-negative; renormalized
 * internally by computeScenario). `inceptionDate` is the portfolio's
 * inception (typically portfolios.created_at) — every strategy defaults
 * to starting from this date, but if a strategy's own start_date is
 * later, its include-from is clamped to that later date so the overlay
 * never time-travels.
 */
export function computeCompositeCurve(
  strategies: StrategyForBuilder[],
  weightsById: Record<string, number>,
  inceptionDate: string,
  dateMapCache?: Map<string, Map<string, number>>,
): DailyPoint[] {
  if (strategies.length === 0) return [];

  const cache = dateMapCache ?? buildDateMapCache(strategies);
  const selected: Record<string, boolean> = {};
  const startDates: Record<string, string> = {};
  for (const s of strategies) {
    selected[s.id] = true;
    // Clamp to the later of inception and the strategy's own start_date
    // so a favorite that launched AFTER the allocator's portfolio was
    // created only contributes from its own launch date forward.
    const strategyStart = s.start_date ?? inceptionDate;
    startDates[s.id] =
      strategyStart > inceptionDate ? strategyStart : inceptionDate;
  }

  const metrics = computeScenario(
    strategies,
    { selected, weights: weightsById, startDates },
    cache,
  );

  // computeScenario returns the curve as cumulative RETURN (0.18 = +18%).
  // PortfolioEquityCurve expects cumulative WEALTH (1.18 = +18%). Convert
  // by adding 1 to each value.
  return metrics.equity_curve.map((p) => ({
    date: p.date,
    value: Number((p.value + 1).toFixed(6)),
  }));
}

/**
 * Compute the "real + favorites overlay" composite curve.
 *
 * Takes the real portfolio's strategies with their current weights and a
 * list of toggled-on favorites, combines them so the favorites collectively
 * occupy `sleevePercent` of the total book (default 10%) split equally,
 * and the real strategies fill the remaining (1 - sleevePercent) pro-rata
 * to their existing weights. Returns a single cumulative curve suitable
 * for the overlay line on PortfolioEquityCurve.
 *
 * If `favorites` is empty, returns the real portfolio's baseline curve
 * (identity state) — the Favorites panel calls this with an empty array
 * when all toggles are off.
 */
export function computeFavoritesOverlayCurve(
  realStrategies: StrategyForBuilder[],
  realWeightsById: Record<string, number>,
  favorites: StrategyForBuilder[],
  inceptionDate: string,
  sleevePercent = 0.1,
): DailyPoint[] {
  if (favorites.length === 0) {
    return computeCompositeCurve(
      realStrategies,
      realWeightsById,
      inceptionDate,
    );
  }

  // Real strategies get (1 - sleevePercent) of the book, pro-rata to
  // their existing weights. Favorites split the sleeve equally.
  const realWeightSum = realStrategies.reduce(
    (s, x) => s + (realWeightsById[x.id] ?? 0),
    0,
  );
  const combinedWeights: Record<string, number> = {};
  if (realWeightSum > 0) {
    for (const s of realStrategies) {
      combinedWeights[s.id] =
        ((realWeightsById[s.id] ?? 0) / realWeightSum) * (1 - sleevePercent);
    }
  }
  const perFavoriteWeight = sleevePercent / favorites.length;
  for (const f of favorites) {
    combinedWeights[f.id] = perFavoriteWeight;
  }

  return computeCompositeCurve(
    [...realStrategies, ...favorites],
    combinedWeights,
    inceptionDate,
  );
}
