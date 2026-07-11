import type { CorrelationRow, DailyReturn, FactsheetPayload, FactsheetCommon, TrustTierKind, IngestSource } from "./types";
import { alignReturns } from "./align";
import { compute, cumEq, worstDrawdowns, arithmeticEquity, arithmeticUnderwater } from "./compute";
import { overlayBasisScalars } from "./basis-metrics";
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
import { annualizationPeriods } from "@/lib/closed-sets";
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
 * Phase 90 (D3/D6) — optional composite opts. Additive + defaulted-undefined so
 * every existing 2-arg call site is byte-identical (GUARD-02). The field types
 * are anchored to {@link FactsheetCommon} so the payload contract and the opts
 * contract can't drift.
 */
export type BuildFactsheetOpts = {
  /** "arithmetic" swaps the three curve fields (composite branch); default geometric. */
  cumulativeMethod?: "geometric" | "arithmetic";
  segmentBoundaries?: FactsheetCommon["segmentBoundaries"];
  missingSegments?: FactsheetCommon["missingSegments"];
  metricsByBasis?: FactsheetCommon["metricsByBasis"];
  dataQuality?: FactsheetCommon["dataQuality"];
  mtmGate?: FactsheetCommon["mtmGate"];
};

/**
 * Derive FS-01 segment boundaries + FS-02 missing segments from a persisted
 * `data_quality_flags` object (Phase 86). Pure + defensive: tolerates absent /
 * malformed `per_key` / `gap_spans` by returning empty arrays (A1 — optional
 * fields degrade gracefully).
 *
 * - segmentBoundaries: one per `per_key[]` with `seq > 1` (seq 1 = inception,
 *   NOT a seam per UI-SPEC §2); `date` = that key's `first_day`, label = seq.
 * - missingSegments: one per `gap_spans[]`, `kind:"gap"`, `days` computed
 *   INCLUSIVE both ends (UTC date diff + 1). `gap_spans` are inclusive both
 *   ends (stitch_composite), CONTRAST the half-open `[start,end)` member-window
 *   convention in windowOverlap.ts — normalized here at the ONE assembly seam.
 */
export function deriveSegmentMarkers(dqf: {
  per_key?: Array<{ seq?: unknown; first_day?: unknown }> | unknown;
  gap_spans?: Array<{ start?: unknown; end?: unknown }> | unknown;
} | null | undefined): {
  segmentBoundaries: NonNullable<FactsheetCommon["segmentBoundaries"]>;
  missingSegments: NonNullable<FactsheetCommon["missingSegments"]>;
} {
  // F6 (IN-06): a present-but-non-array `per_key`/`gap_spans` is a malformed
  // persist (Phase-86 always writes arrays). Silently coercing it to [] would
  // under-report the segment/gap count with no signal — warn so the bad shape is
  // observable rather than degrading to 0 markers invisibly.
  if (dqf?.per_key != null && !Array.isArray(dqf.per_key)) {
    console.warn("[factsheet] deriveSegmentMarkers — per_key present but not an array; treating as empty", {
      type: typeof dqf.per_key,
    });
  }
  if (dqf?.gap_spans != null && !Array.isArray(dqf.gap_spans)) {
    console.warn("[factsheet] deriveSegmentMarkers — gap_spans present but not an array; treating as empty", {
      type: typeof dqf.gap_spans,
    });
  }
  const perKey = Array.isArray(dqf?.per_key) ? (dqf!.per_key as Array<{ seq?: unknown; first_day?: unknown }>) : [];
  const gapSpans = Array.isArray(dqf?.gap_spans) ? (dqf!.gap_spans as Array<{ start?: unknown; end?: unknown }>) : [];

  const segmentBoundaries = perKey
    .filter(k => k && typeof k.seq === "number" && k.seq > 1 && typeof k.first_day === "string")
    .map(k => ({ date: k.first_day as string, seq: k.seq as number, label: String(k.seq) }));

  const missingSegments = gapSpans
    .filter(g => g && typeof g.start === "string" && typeof g.end === "string")
    .map(g => ({
      start: g.start as string,
      end: g.end as string,
      kind: "gap" as const,
      days: inclusiveDayCount(g.start as string, g.end as string),
    }));

  return { segmentBoundaries, missingSegments };
}

/** UTC calendar days between two YYYY-MM-DD dates, INCLUSIVE both ends. */
function inclusiveDayCount(start: string, end: string): number {
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  return Math.round((e - s) / 86_400_000) + 1;
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
    /** #597 — the strategy's asset class ('crypto' | 'traditional'), driving
     *  the annualization basis of every SINGLE-STRATEGY KPI on this factsheet
     *  (headline / rolling / bootstrap CI / comparator joint): √365 crypto,
     *  √252 traditional. Additive + optional; absent → 252 (byte-identical to
     *  the pre-#597 hardcode). Canned reference-allocation panels stay on
     *  native 252 (see allocator.ts). */
    assetClass?: string | null;
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
  opts?: BuildFactsheetOpts,
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

  // #597 — annualization basis for this strategy's KPIs (√365 crypto / √252
  // traditional). One value threaded into every single-strategy KPI surface
  // below so the whole factsheet renders on ONE coherent basis.
  const periodsPerYear = annualizationPeriods(strategy.assetClass);
  const fullMetrics = compute(stratRet, dates, 0, periodsPerYear);
  // Strip eq/dd before serialization — already shipped as strategyEquity / strategyDrawdowns
  // at the top level; carrying them twice burns ~16 KB on a 1049-day series.
  const { eq: _eq, dd: geoDd, ...computedMetrics } = fullMetrics;

  // Phase 90 (D3) — arithmetic curve set for COMPOSITES. When
  // opts.cumulativeMethod==="arithmetic", all THREE curve fields move together
  // (RESEARCH §Resolved-1): the underwaterAcc chart + Worst-DD bands must agree
  // with the equity curve or they'd render on a different basis. Single-key
  // (geometric) path untouched → byte-identical.
  const isArithmetic = opts?.cumulativeMethod === "arithmetic";
  const stratEquity = isArithmetic ? arithmeticEquity(stratRet) : cumEq(stratRet);
  const stratDd = isArithmetic ? arithmeticUnderwater(stratRet) : geoDd;

  // Phase 90 (D3) — cash-scalar overlay. The KpiStrip's seven headline scalars
  // read the PERSISTED `cash_settlement` basis so they agree with discovery /
  // ranking / acceptance, whatever cumulative method the composite persisted
  // (geometric mainline OR the Zavara "simple"/arithmetic override — Round-2
  // C-1). Round-2 H-1: the overlay is now STRICT — a degenerate persisted scalar
  // (`calmar:null` on a zero-drawdown book) renders "—", not the client-geometric
  // value it would silently inherit. No-op (single-key byte-identical) when
  // `cash_settlement` is absent (overlayBasisScalars returns base unchanged).
  const strategyMetrics = overlayBasisScalars(computedMetrics, opts?.metricsByBasis?.cash_settlement);

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
    strategyRollingVol: rollingVol(stratRet, rollWindow.window, periodsPerYear),
    strategyRollingSharpe: rollingSharpe(stratRet, rollWindow.window, periodsPerYear),
    strategyRollingSortino: rollingSortino(stratRet, rollWindow.window, periodsPerYear),
    rollingWindow: rollWindow,
    rollingBetaWindow: rollBetaWindow,
    strategyDrawdowns: stratDd,
    strategyWorst10: worstDrawdowns(stratDd, 10),
    strategyMetrics,
    activeComparator: "btc",
    comparators: {
      btc: buildComparatorBlock("BTC-USD", "BTC", btcRet, stratRet, stratEquity, dates, strategyMetrics.ann_vol, rollWindow.window, rollBetaWindow.window, periodsPerYear),
      spx: buildComparatorBlock("S&P 500", "SPX", spxRet, stratRet, stratEquity, dates, strategyMetrics.ann_vol, rollWindow.window, rollBetaWindow.window, periodsPerYear),
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
    bootstrapCI: bootstrapCI(stratRet, 2000, 5, 42, periodsPerYear),
    monthlyReturns: monthlyReturnsMatrix(stratRet, dates),
    dailyHeatmap: dailyReturnsByYear(stratRet, dates),
    correlations,
    correlationMatrix: { labels, matrix },
    stressWindows: computeStressWindows(dates, stratRet, btcRet, "BTC", strategy.markets),
    quantiles,
    // Phase 90 — composite marker/basis fields. Optional-absent when opts
    // omitted (undefined values are dropped from the serialized RSC blob), so
    // single-key payloads stay byte-identical.
    segmentBoundaries: opts?.segmentBoundaries,
    missingSegments: opts?.missingSegments,
    metricsByBasis: opts?.metricsByBasis,
    mtmGate: opts?.mtmGate,
    dataQuality: opts?.dataQuality,
  };

  // No-invented-data contract (NEW-C20-01, RED-TEAM-M2/M3, B6): the synthesized
  // demo panels are NOT derivable from a bare daily-return series, so they are
  // computed + attached ONLY on the "api" arm. For csv strategies they are
  // absent from the returned object entirely — never serialized into the RSC
  // blob — so the discriminated union makes a csv consumer physically unable to
  // read them, and zero-population csv signatures never add payload weight.
  if (ingestSource === "api") {
    // #597 — rank the ANNUALIZED Sharpe/Sortino directly against the cohort; do
    // NOT rescale by the annualization basis. Annualized Sharpe is
    // frequency-invariant: Sharpe_ann = mean·P / (sd·√P) = mean·√P / sd, and a
    // crypto strategy's smaller daily returns (spread over P=365 days) × √365
    // recover the exact same annual Sharpe that a traditional strategy's larger
    // daily returns × √252 do. Two strategies with the same TRUE annual Sharpe
    // land on the same annualized value regardless of P, so a √365 Sharpe and a
    // √252 Sharpe are already on one common scale — the cohort (a fixed
    // distribution of annualized Sharpes) is asset-class-agnostic. Applying a
    // √(252/365) "basis correction" here would de-annualize crypto and stamp a
    // systematic ~17% penalty on every 24/7 sleeve — the wrong fix for a
    // non-problem. (Frequency only affects the standard ERROR of the estimate,
    // not its expectation; more obs → tighter, if anything shrink crypto LESS.)
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
          // #597 part 2 (BLEND-02): pure-tradfi legs (SPX + IEF) → √252. Passes
          // NO basis arg on purpose — the buildAllocatorMetrics default keeps this
          // panel BYTE-IDENTICAL to the pre-#597 math (the locked 252 case).
          ...buildAllocatorMetrics(blend([0.6, 0.4], [spxRet, iefRet]), stratRet),
        },
        {
          key: "multi_asset",
          name: "Multi-Asset Risk Parity",
          composition: "25% S&P 500 · 25% Gold · 25% IEF · 25% BTC",
          // #597 part 2 (BLEND-02): the BTC leg makes the joined series
          // calendar-daily → √365 under the blend rule (via the closed-set
          // registry, kept greppable rather than a bare 365 literal).
          ...buildAllocatorMetrics(
            blend([0.25, 0.25, 0.25, 0.25], [spxRet, gldRet, iefRet, btcRet]),
            stratRet,
            annualizationPeriods("crypto"),
          ),
        },
        {
          key: "crypto_book",
          name: "Diversified Crypto Book",
          composition: "70% BTC · 30% ETH",
          // #597 part 2 (BLEND-02): BTC + ETH legs → √365 under the blend rule.
          ...buildAllocatorMetrics(
            blend([0.7, 0.3], [btcRet, ethRet]),
            stratRet,
            annualizationPeriods("crypto"),
          ),
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

