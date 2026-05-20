import type { CorrelationRow, DailyReturn, FactsheetPayload, AllocatorPortfolioPayload, QuantilePayload, TrustTierKind } from "./types";
import { alignReturns } from "./align";
import { compute, cumEq, worstDrawdowns } from "./compute";
import { rollingVol, rollingSharpe, rollingSortino, pickRollingWindow, ROLL_WINDOW_90D, ROLL_WINDOW_30D } from "./rolling";
import { buildComparatorBlock, noneComparatorBlock } from "./comparator-block";
import {
  BTC_DAILY,
  SPX_DAILY,
  ETH_DAILY,
  GLD_DAILY,
  IEF_DAILY,
} from "./benchmarks";
import { computeStyleDrift } from "./style-drift";
import { computePeerPercentile } from "./peer-cohort";
import { blend, buildAllocatorMetrics } from "./allocator";
import { streakLengths, streakHistogram } from "./streak";
import { calmarByYear } from "./calmar-by-year";
import { bootstrapCI } from "./bootstrap";
import { monthlyReturnsMatrix, dailyReturnsByYear } from "./period-buckets";
import { computeEventSignatures } from "./event-signatures";
import { computeStressWindows } from "./stress-windows";

/**
 * Build the full FactsheetPayload from a strategy's daily-return rows.
 *
 * Behavior:
 *   1. Sort + dedupe the strategy series by date.
 *   2. Clip to the benchmark coverage window (so BTC/SPX always have data).
 *   3. Compute strategy headline metrics.
 *   4. Build a comparator block for each of BTC / SPX (and the "none" stub).
 */
export function buildFactsheetPayload(
  strategy: {
    id: string;
    name: string;
    types: string[];
    markets: string[];
    computedAt: string;
    trustTier: TrustTierKind | null;
    description?: string | null;
    subtypes?: string[];
    supportedExchanges?: string[];
    leverageRange?: string | null;
    aum?: number | null;
    maxCapacity?: number | null;
    avgDailyTurnover?: number | null;
    startDate?: string | null;
    benchmark?: string | null;
  },
  dailyReturns: DailyReturn[],
): FactsheetPayload | null {
  if (!dailyReturns.length) return null;

  const sorted = [...dailyReturns]
    .filter(d => d && typeof d.date === "string" && Number.isFinite(d.value))
    .sort((a, b) => a.date.localeCompare(b.date));

  const dedup: DailyReturn[] = [];
  let lastDate: string | null = null;
  for (const d of sorted) {
    if (d.date === lastDate) continue;
    dedup.push(d);
    lastDate = d.date;
  }

  // The strategy series is the source of truth. Benchmark fixtures
  // (BTC/SPX/etc.) carry a fixed date range; `alignReturns` forward-fills
  // benchmark prices on dates outside that range so the strategy panel
  // set still renders even when the strategy is entirely outside the
  // bench window — comparator series just go flat on the unsupported
  // dates instead of dropping the whole factsheet. Drop only when the
  // raw series itself doesn't have 2 distinct dated observations.
  if (dedup.length < 2) {
    console.warn(
      "[buildFactsheetPayload] strategy series has fewer than 2 unique dated observations — returning null",
      {
        strategyId: strategy.id,
        rawCount: dailyReturns.length,
        sortedDedupCount: dedup.length,
        sample: dedup[0] ?? null,
      },
    );
    return null;
  }
  const clipped = dedup;

  const dates = clipped.map(d => d.date);
  const stratRet = clipped.map(d => d.value);

  // Series shorter than ROLL_WINDOW_6MO + 5 can't fill the preferred 6-month
  // rolling window — pickRollingWindow falls back to 30d so the chart isn't
  // pure warmup band. Rolling β has its own (smaller) preferred window with
  // a 90d → 30d → not-enough-data ladder. Both windows ride along on the
  // payload so chart titles and the MetricsColumn header reflect reality.
  const rollWindow = pickRollingWindow(stratRet.length);
  const rollBetaWindow = pickRollingWindow(stratRet.length, [
    { window: ROLL_WINDOW_90D, label: "90d" },
    { window: ROLL_WINDOW_30D, label: "30d" },
  ]);

  const fullMetrics = compute(stratRet, dates);
  // Strip eq/dd before serialization — already shipped as strategyEquity / strategyDrawdowns
  // at the top level; carrying them twice burns ~16 KB on a 1049-day series.
  const { eq: _eq, dd: stratDd, ...strategyMetrics } = fullMetrics;
  const stratEquity = cumEq(stratRet);

  const btcRet = alignReturns(BTC_DAILY, dates);
  const spxRet = alignReturns(SPX_DAILY, dates);
  const ethRet = alignReturns(ETH_DAILY, dates);
  const gldRet = alignReturns(GLD_DAILY, dates);
  const iefRet = alignReturns(IEF_DAILY, dates);

  const styleDrift = computeStyleDrift(stratRet, dates);
  const peer = computePeerPercentile(strategyMetrics.sharpe, strategyMetrics.sortino, strategyMetrics.max_dd);

  const allocator: AllocatorPortfolioPayload[] = [
    {
      key: "sixty_forty",
      name: "60/40 Stocks/Bonds",
      composition: "60% S&P 500 · 40% IEF (US 10y Treasury)",
      ...buildAllocatorMetrics(blend([0.6, 0.4], [spxRet, iefRet]), stratRet),
    },
    {
      key: "multi_asset",
      name: "Multi-Asset Risk Parity",
      composition: "25% S&P 500 · 25% Gold · 25% IEF · 25% BTC",
      ...buildAllocatorMetrics(blend([0.25, 0.25, 0.25, 0.25], [spxRet, gldRet, iefRet, btcRet]), stratRet),
    },
    {
      key: "crypto_book",
      name: "Diversified Crypto Book",
      composition: "70% BTC · 30% ETH",
      ...buildAllocatorMetrics(blend([0.7, 0.3], [btcRet, ethRet]), stratRet),
    },
  ];

  const correlations: CorrelationRow[] = [
    { name: "BTC", rho: pearsonCorr(stratRet, btcRet) },
    { name: "ETH", rho: pearsonCorr(stratRet, ethRet) },
    { name: "S&P 500", rho: pearsonCorr(stratRet, spxRet) },
    { name: "Gold", rho: pearsonCorr(stratRet, gldRet) },
    { name: "US 10Y (IEF)", rho: pearsonCorr(stratRet, iefRet) },
  ];

  // Full pairwise matrix — strategy short-name on the diagonal head so the
  // matrix reads as a self-similarity heatmap with one corner for the strategy.
  const matrixSeries: Array<{ name: string; rets: number[] }> = [
    { name: strategy.name.length > 12 ? strategy.name.slice(0, 11) + "…" : strategy.name, rets: stratRet },
    { name: "BTC", rets: btcRet },
    { name: "ETH", rets: ethRet },
    { name: "SPX", rets: spxRet },
    { name: "Gold", rets: gldRet },
    { name: "IEF", rets: iefRet },
  ];
  const labels = matrixSeries.map(s => s.name);
  const matrix: number[][] = matrixSeries.map((a, i) =>
    matrixSeries.map((b, j) => (i === j ? 1 : pearsonCorr(a.rets, b.rets))),
  );

  const quantiles = quantileSummary(stratRet);

  return {
    strategyId: strategy.id,
    strategyName: strategy.name,
    strategyTypes: strategy.types,
    markets: strategy.markets,
    computedAt: strategy.computedAt,
    trustTier: strategy.trustTier,
    description: strategy.description ?? null,
    subtypes: strategy.subtypes ?? [],
    supportedExchanges: strategy.supportedExchanges ?? [],
    leverageRange: strategy.leverageRange ?? null,
    aum: strategy.aum ?? null,
    maxCapacity: strategy.maxCapacity ?? null,
    avgDailyTurnover: strategy.avgDailyTurnover ?? null,
    startDate: strategy.startDate ?? null,
    benchmark: strategy.benchmark ?? null,
    dates,
    strategyReturns: stratRet,
    strategyEquity: stratEquity,
    strategyRollingVol: rollingVol(stratRet, rollWindow.window),
    strategyRollingSharpe: rollingSharpe(stratRet, rollWindow.window),
    strategyRollingSortino: rollingSortino(stratRet, rollWindow.window),
    rollingWindow: rollWindow,
    rollingBetaWindow: rollBetaWindow,
    strategyDrawdowns: stratDd,
    strategyWorst10: worstDrawdowns(stratDd, 10),
    strategyMetrics,
    activeComparator: "btc",
    comparators: {
      btc: buildComparatorBlock("BTC-USD", "BTC", btcRet, stratRet, stratEquity, dates, strategyMetrics.ann_vol, rollWindow.window, rollBetaWindow.window),
      spx: buildComparatorBlock("S&P 500", "SPX", spxRet, stratRet, stratEquity, dates, strategyMetrics.ann_vol, rollWindow.window, rollBetaWindow.window),
      none: noneComparatorBlock,
    },
    styleDrift,
    peerPercentile: {
      cohortSize: peer.cohort.length,
      sharpe: peer.sharpe,
      sortino: peer.sortino,
      max_dd: peer.max_dd,
    },
    allocatorPortfolios: allocator,
    streaks: (() => {
      const { wins, losses } = streakLengths(stratRet);
      const MAX_LEN = 14;
      return {
        winsByLength: streakHistogram(wins, MAX_LEN),
        lossesByLength: streakHistogram(losses, MAX_LEN),
        totalWins: wins.length,
        totalLosses: losses.length,
        longestWin: wins.length > 0 ? Math.max(...wins) : 0,
        longestLoss: losses.length > 0 ? Math.max(...losses) : 0,
        maxLen: MAX_LEN,
      };
    })(),
    calmarByYear: calmarByYear(stratRet, dates),
    bootstrapCI: bootstrapCI(stratRet),
    monthlyReturns: monthlyReturnsMatrix(stratRet, dates),
    dailyHeatmap: dailyReturnsByYear(stratRet, dates),
    correlations,
    correlationMatrix: { labels, matrix },
    eventSignatures: computeEventSignatures(stratRet, btcRet, stratEquity),
    benchEventSignatures: computeEventSignatures(btcRet, btcRet, cumEq(btcRet)),
    stressWindows: computeStressWindows(dates, stratRet, btcRet, "BTC", strategy.markets),
    quantiles,
  };
}

function pearsonCorr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  const denom = Math.sqrt(va * vb);
  return denom > 0 ? cov / denom : NaN;
}

function quantileSummary(rets: number[]): QuantilePayload {
  const n = rets.length;
  if (n === 0) {
    return { p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, min: 0, max: 0, mean: 0 };
  }
  const sorted = [...rets].sort((a, b) => a - b);
  const q = (p: number) => {
    if (n === 1) return sorted[0];
    const idx = p * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const frac = idx - lo;
    return sorted[lo] * (1 - frac) + sorted[hi] * frac;
  };
  let sum = 0;
  for (const r of rets) sum += r;
  return {
    p05: q(0.05),
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    p95: q(0.95),
    min: sorted[0],
    max: sorted[n - 1],
    mean: sum / n,
  };
}
