import type { CorrelationRow, DailyReturn, FactsheetPayload, FactsheetCommon, TrustTierKind, IngestSource } from "./types";
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
import { quantileSummary } from "./quantiles";

/**
 * Classify a strategy's ingest source from its raw `strategy_analytics.daily_returns`
 * column value. The CSV ingester writes `daily_returns` (an array — possibly empty — or a
 * legacy object dict); the analytics-service (live API) path leaves it null/undefined and
 * writes `returns_series` instead.
 *
 * CRITICAL (FINDING-1): an EMPTY array means the CSV ingester ran but produced zero rows —
 * that is STILL a CSV strategy. Only null/undefined classifies as "api". Mis-classifying a
 * CSV strategy as "api" would unlock the synthesized demo panels (PeerPercentile /
 * AllocatorSection / Signatures) the no-invented-data contract forbids for CSV.
 *
 * SINGLE SOURCE OF TRUTH (B6): both the factsheet page (`factsheet/[id]/v2/page.tsx`) and the
 * discovery detail page derive `ingestSource` through THIS function — the derivation turns
 * raw `unknown` DB data into the discriminant BEFORE the typed FactsheetPayload exists, so it
 * is the one no-invented-data gate the discriminated union can't backstop at compile time.
 * `audit-c20.test.ts` (RED-TEAM-H1) tests this exact function, so a branch flip fails the
 * test instead of silently diverging across the two surfaces.
 */
export function deriveIngestSource(dailyRaw: unknown): IngestSource {
  if (Array.isArray(dailyRaw)) return "csv"; // any array, empty or not = CSV path touched this strategy
  if (typeof dailyRaw === "object" && dailyRaw !== null) return "csv"; // object dict = CSV attempted
  return "api"; // null/undefined = only the analytics-service path wrote a series
}

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
    /** Origin of the daily-return series — "api" (live-ingested) or "csv"
     *  (user-uploaded). Defaults to "csv" when absent so existing callers
     *  that don't know the source are conservative. (NEW-C20-01) */
    ingestSource?: IngestSource;
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
  // Default to "csv" (conservative) when the caller doesn't specify — avoids
  // exposing non-derivable panels for strategies whose source isn't explicitly
  // known. The synthesized demo panels (peer cohort, allocator portfolios,
  // event signatures) are computed + attached ONLY on the "api" arm below.
  // (NEW-C20-01)
  const ingestSource: IngestSource = strategy.ingestSource ?? "csv";

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

  // Fields shared by both ingest arms. The discriminated FactsheetPayload (B6)
  // appends the synthesized api-only panels onto this for "api" strategies.
  const common: FactsheetCommon = {
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
    stressWindows: computeStressWindows(dates, stratRet, btcRet, "BTC", strategy.markets),
    quantiles,
  };

  // No-invented-data contract (NEW-C20-01, RED-TEAM-M2/M3, B6): the synthesized
  // demo panels are NOT derivable from a bare daily-return series, so they are
  // computed + attached ONLY on the "api" arm. For csv strategies they are
  // absent from the returned object entirely — never serialized into the RSC
  // blob — so the discriminated union makes a csv consumer physically unable to
  // read them, and zero-population csv signatures never add payload weight.
  if (ingestSource === "api") {
    const peer = computePeerPercentile(strategyMetrics.sharpe, strategyMetrics.sortino, strategyMetrics.max_dd);
    return {
      ...common,
      ingestSource: "api",
      peerPercentile: peer
        ? {
            cohortSize: peer.cohort.length,
            sharpe: peer.sharpe,
            sortino: peer.sortino,
            max_dd: peer.max_dd,
          }
        : null,
      allocatorPortfolios: [
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
      ],
      eventSignatures: computeEventSignatures(stratRet, btcRet, stratEquity),
      benchEventSignatures: computeEventSignatures(btcRet, btcRet, cumEq(btcRet)),
    };
  }

  return { ...common, ingestSource: "csv" };
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

