import type { BenchmarkPricesOpt, CorrelationRow, DailyReturn, FactsheetPayload, FactsheetCommon, BasisSeriesBundle, TrustTierKind, IngestSource } from "./types";
import { alignCoveredReturns, COMPARATOR_CALENDARS } from "./align";
import type { CoveredAlignment } from "./align";
import { compute, cumEq, metricsBasisSeries, worstDrawdowns } from "./compute";
import { overlayBasisScalars } from "./basis-metrics";
import { rollingVol, rollingSharpe, rollingSortino, pickRollingWindow, ROLL_WINDOW_90D, ROLL_WINDOW_30D } from "./rolling";
import { buildComparatorBlock, noneComparatorBlock, unavailableComparatorBlock } from "./comparator-block";
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
import { pearson } from "@/lib/return-stats";
import { alignBlend, buildAllocatorMetrics, comparatorLeg } from "./allocator";
import type { BlendLeg } from "./allocator";
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
 * Phase 169.5 BENCHCOMPARE (SC3, D-09, D-54) — the BTC comparator's prices; the
 * type lives in `./types` (the payload carries it, D-21) and is re-exported here
 * for the build opt's callers. As a build opt, ABSENT (the allocator path until
 * Phase 169.4) means the bundled BTC fixture, bounded by
 * {@link fixtureBenchmarkPrices}.
 */
export type { BenchmarkPricesOpt };

/**
 * Phase 90 (D3/D6) — optional build opts, first added for composites and since
 * shared by the single-key arm (Phases 102/103/133, and 169). Additive + defaulted-undefined so
 * every existing 2-arg call site is byte-identical (GUARD-02). The field types
 * are anchored to {@link FactsheetCommon} so the payload contract and the opts
 * contract can't drift.
 */
export type BuildFactsheetOpts = {
  /**
   * "arithmetic" swaps the three curve fields; default geometric. Set by the
   * composite reader, and since Phase 169 review round 1 (SFH H-2) by the
   * single-key owner for a `simple` returns_denominator_config.
   */
  cumulativeMethod?: "geometric" | "arithmetic";
  /**
   * Phase 164.6.6.2 (D-08, D-09) — the native unit of the strategy's returns,
   * already parsed by `parseReturnsUnit`. Emitted only when set (see the spread
   * in the payload), so a USD build carries no key.
   */
  returnsUnit?: FactsheetCommon["returnsUnit"];
  /**
   * Phase 169.1 (D-30) — the strategy's day basis; "active" runs vol, Sharpe
   * and Sortino over the non-zero days (the engine's `stat_returns`). Default
   * calendar. Set by the composite reader's conventions resolver.
   */
  dayBasis?: "calendar" | "active";
  segmentBoundaries?: FactsheetCommon["segmentBoundaries"];
  missingSegments?: FactsheetCommon["missingSegments"];
  metricsByBasis?: FactsheetCommon["metricsByBasis"];
  dataQuality?: FactsheetCommon["dataQuality"];
  mtmGate?: FactsheetCommon["mtmGate"];
  /** Phase 133 (SMTM-01) — the smoothed sibling of {@link mtmGate}. */
  smoothedGate?: FactsheetCommon["smoothedGate"];
  /**
   * Phase 103 (MTM-04) — the persisted MTM daily series (read from the
   * `mtm_daily_returns` `strategy_analytics_series` row via
   * `composite-read-path.ts readMtmSeries`). When present with ≥2 valid rows,
   * `buildFactsheetPayload` emits `payload.seriesByBasis.mark_to_market` derived
   * by the SAME `deriveSeriesBundle` as cash (own axis + own mask from
   * `gapSpans`). Threaded ONLY when the scalar MTM gate is `available` (the F-4
   * DONE + hasBasisHeadline gate), so a non-options / gated strategy passes
   * `undefined` and the cash payload stays byte-identical (SC-4). `gapSpans` is
   * the Python-derived coverage mask — reused, never re-derived client-side.
   */
  mtmSeries?: {
    dailyReturns: DailyReturn[];
    gapSpans: Array<{ start: string; end: string }>;
  };
  /**
   * Phase 133 (SMTM-01) — the smoothed sibling of {@link mtmSeries} (read from the
   * `smoothed_mtm_daily_returns` row via `composite-read-path.ts readSmoothedSeries`).
   * When present with ≥2 valid rows, `buildFactsheetPayload` emits
   * `payload.seriesByBasis.smoothed_mtm` from the SAME `deriveSeriesBundle`. Threaded
   * ONLY when the smoothed gate is `available`, so a gated/non-options strategy passes
   * `undefined` and the payload stays byte-identical (SC-4).
   */
  smoothedSeries?: {
    dailyReturns: DailyReturn[];
    gapSpans: Array<{ start: string; end: string }>;
  };
  /** Phase 169.5 (SC3, D-09) — BTC from the database; see {@link BenchmarkPricesOpt}. */
  benchmarkPrices?: BenchmarkPricesOpt;
};

/**
 * Phase 169.5 (D-54, D-09) — the five comparators aligned on one date axis through
 * the ONE coverage-aware helper. BTC comes from `benchmarkPrices` (null when it is
 * the unavailable marker); the four others from their fixtures. A fixture has no
 * `dropped` list. BTC is an ARGUMENT here, never read from the bundled fixture, so
 * the server build and the browser re-derive align it from the same closes.
 */
function alignComparators(
  dates: string[],
  benchmarkPrices: BenchmarkPricesOpt,
): {
  btc: CoveredAlignment | null;
  spx: CoveredAlignment;
  eth: CoveredAlignment;
  gld: CoveredAlignment;
  ief: CoveredAlignment;
} {
  const btc =
    "unavailable" in benchmarkPrices
      ? null
      : alignCoveredReturns(benchmarkPrices.prices, benchmarkPrices.dropped, dates, COMPARATOR_CALENDARS.btc);
  return {
    btc,
    spx: alignCoveredReturns(SPX_DAILY, [], dates, COMPARATOR_CALENDARS.spx),
    eth: alignCoveredReturns(ETH_DAILY, [], dates, COMPARATOR_CALENDARS.eth),
    gld: alignCoveredReturns(GLD_DAILY, [], dates, COMPARATOR_CALENDARS.gld),
    ief: alignCoveredReturns(IEF_DAILY, [], dates, COMPARATOR_CALENDARS.ief),
  };
}

function isoMinusOneDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Phase 169.5 (SC3, D-09, D-64(4) Amendment A, RESEARCH Pitfall 2) — the
 * bundled BTC fixture bounded as the route bounds its read: `[earliest date on any
 * axis minus one day, latest date on any axis]`, min / max over every entry, with an
 * empty `dropped` list and `through` its last carried close. The day before the
 * earliest date carries the prior close day one's return is taken from (D-64).
 * No close in the bound is the unavailable marker. Used only when a build is
 * handed no `benchmarkPrices` opt, so the payload still carries the exact closes
 * its BTC comparator was computed from.
 */
export function fixtureBenchmarkPrices(axes: ReadonlyArray<readonly DailyReturn[]>): BenchmarkPricesOpt {
  let min: string | null = null;
  let max: string | null = null;
  for (const axis of axes) {
    for (const r of axis) {
      if (min === null || r.date < min) min = r.date;
      if (max === null || r.date > max) max = r.date;
    }
  }
  if (min === null || max === null) return { unavailable: true };
  const from = isoMinusOneDay(min);
  const to = max;
  const prices = BTC_DAILY.filter(p => p.date >= from && p.date <= to);
  if (prices.length === 0) return { unavailable: true };
  return { prices, through: prices[prices.length - 1].date, dropped: [] };
}

/** The unavailable alignment: every return null, nothing paired. */
function unavailableAlignment(n: number): CoveredAlignment {
  return { returns: new Array(n).fill(null), paired: new Array(n).fill(false), through: null, coveredToEnd: false };
}

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
 * Sort ascending by date, drop malformed rows (non-string date / non-finite
 * value), and dedupe by date (keeping the first occurrence). The ONE normalize
 * both the cash series and the Phase-103 MTM series pass through, so they share
 * the exact same sanitize (no second implementation to drift).
 *
 * Exported (Phase 170.5 D-07) so `v2-joint.ts` runs the factsheet's own
 * normalize rather than a second one; the builder's behaviour is unchanged.
 */
export function normalizeDailyReturns(rows: DailyReturn[]): DailyReturn[] {
  const sorted = [...rows]
    .filter(d => d && typeof d.date === "string" && Number.isFinite(d.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  const dedup: DailyReturn[] = [];
  let lastDate: string | null = null;
  for (const d of sorted) {
    if (d.date === lastDate) continue;
    dedup.push(d);
    lastDate = d.date;
  }
  return dedup;
}

/**
 * Phase 167.2.1 (D-04) — the fewest distinct dated observations a factsheet
 * builds from. The ONE constant behind the builder's point-count gate, the
 * buildability probe in `fetch-and-build-payload.ts`, and the owner-facing
 * "fewer than 2 days of returns" copy that cites it.
 */
export const MIN_FACTSHEET_SERIES_POINTS = 2;

declare const buildableSeriesBrand: unique symbol;

/**
 * 167.2.1-REVIEW WR-04 — a daily-return series {@link hasBuildableSeries} has
 * vouched for. The brand has no runtime form; the ONLY way to obtain the type
 * is to pass that predicate, so a value of this type is a series the builder's
 * two null exits cannot refuse.
 */
export type BuildableSeries = DailyReturn[] & { readonly [buildableSeriesBrand]: true };

/**
 * Phase 167.2.1 (D-04) — can this daily-return series build a factsheet? True
 * when {@link normalizeDailyReturns} (sort, drop malformed rows, dedupe by date)
 * leaves at least {@link MIN_FACTSHEET_SERIES_POINTS} rows. `buildFactsheetPayload`
 * calls THIS predicate at its point-count gate, and the buildability probe calls
 * it too, so the two cannot answer differently for the same series.
 *
 * 167.2.1-REVIEW WR-04: a type guard, so a series that passed it is a
 * {@link BuildableSeries}, and `buildFactsheetPayload` called with one is typed
 * to return a payload, never null.
 */
export function hasBuildableSeries(rows: DailyReturn[]): rows is BuildableSeries {
  return normalizeDailyReturns(rows).length >= MIN_FACTSHEET_SERIES_POINTS;
}

/**
 * Phase 103 (MTM-04) — the ONE per-basis series derivation. Both the cash series
 * and the persisted MTM series flow through THIS function, so every dailies-
 * derivable panel (chart tracks + rolling + worst-10 + comparators + heatmaps +
 * quantiles / streaks / calmarByYear / bootstrapCI / styleDrift / stressWindows +
 * correlations / correlationMatrix) is a pure function of the basis-selected daily
 * series — ONE derivation, never a parallel implementation (the SC-4 snapshot pins
 * that this factoring is byte-neutral for cash).
 *
 * The function derives its OWN dates + benchmark alignments (btc/eth/spx/gld/ief on
 * the bundle dates) so cash and MTM each get a COHERENT per-basis axis (Pitfall-1: an
 * MTM axis under cash-dated comparator arrays misaligns after a divergent gap).
 *
 * `comparatorAnnVol`: cash passes the OVERLAID `strategyMetrics.ann_vol` (so the
 * comparator volMatched stays byte-identical to the persisted cash overlay); MTM
 * omits it so the comparator uses the bundle's own computed vol (honest MTM).
 *
 * Phase 103 (MTM-04, correction): correlations + correlationMatrix are derived
 * HERE per basis too. They are NOT external — a correlation is
 * corr(strategy_returns, asset_returns): the benchmark legs are fixed INPUT series,
 * but the STRATEGY leg is the basis-selected dailies, so cash→MTM moves ρ. Nothing
 * bypasses the backbone; the ONLY thing that stays cash top-level is the api-only
 * synthesized allocator/signatures demo (basis-invariant by construction).
 */
export function deriveSeriesBundle(
  clipped: DailyReturn[],
  args: {
    periodsPerYear: number;
    isArithmetic: boolean;
    /** Phase 169.1 (D-30): the day basis; absent is calendar. */
    dayBasis?: "calendar" | "active";
    /**
     * Phase 169.1 (D-30): the series stands for every calendar day (a composite),
     * so a calendar-basis arithmetic CAGR divides by the calendar-day count.
     */
    calendarDense?: boolean;
    markets: string[];
    strategyName: string;
    comparatorAnnVol?: number;
    missingSegments?: FactsheetCommon["missingSegments"];
    /**
     * Phase 169.5 (SC3, D-09) — the BTC prices this bundle aligns BTC from (the
     * payload's own `benchmarkPrices`), or the unavailable marker. Required: the
     * bundle never falls back to the bundled fixture on its own.
     */
    benchmarkPrices: BenchmarkPricesOpt;
  },
): BasisSeriesBundle {
  const { periodsPerYear, isArithmetic, dayBasis, calendarDense, markets, strategyName } = args;
  const dates = clipped.map(d => d.date);
  const stratRet = clipped.map(d => d.value);

  // Series shorter than ROLL_WINDOW_6MO + 5 falls back to 30d (pickRollingWindow);
  // rolling β has its own 90d → 30d ladder. Both windows ride along on the bundle.
  const rollWindow = pickRollingWindow(stratRet.length);
  const rollBetaWindow = pickRollingWindow(stratRet.length, [
    { window: ROLL_WINDOW_90D, label: "90d" },
    { window: ROLL_WINDOW_30D, label: "30d" },
  ]);

  // Phase 169.1 (D-28, D-30): the conventions go INTO compute(), and the curves
  // are compute()'s own `eq` / `dd`: arithmetic (composite) vs geometric, all
  // THREE curve fields and every metric move together, from one place.
  const fullMetrics = compute(stratRet, dates, 0, periodsPerYear, {
    cumulativeMethod: isArithmetic ? "arithmetic" : "geometric",
    dayBasis,
    calendarDense,
  });
  const stratEquity = fullMetrics.eq;
  const stratDd = fullMetrics.dd;

  // Phase 169.1 (D-33, D-39): the rolling statistics run over the days the
  // engine runs them over. `compute_all_metrics` computes its rolling Sharpe on
  // `_rolling_basis` (`stat_returns` under the active basis, else `returns`) and
  // its rolling volatility and Sortino on `returns`, which for a composite is the
  // zero-filled calendar series. `metricsBasisSeries` is the one helper that
  // chooses that series (the same one compute() just used): the non-zero days
  // under active, the zero-filled calendar series on a calendar composite, and
  // `stratRet` itself with identity positions otherwise (byte-identical). The
  // volatility and Sortino run on `dense`, the engine's `returns` under EVERY day
  // basis: the zero-filled calendar series on a composite (`derive_basis_series`
  // gap-fills it before `compute_all_metrics`, which rolls vol and Sortino on
  // `returns`, metrics.py `sibling_kinds`), `stratRet` otherwise. The day basis
  // moves only the rolling Sharpe, as the engine's `_rolling_basis` does
  // (169.1 review MD-02: D-39's "under active they stay on `stratRet`" held for a
  // single-key strategy only). Each result is mapped back through `positions`
  // (null on an excluded day; a filled calendar day has no date and is dropped),
  // so every array stays index-aligned with `dates` and plan 169.1-02's window
  // restriction and `rollingStats`' "Now" hold unchanged. The window stays picked
  // on `stratRet.length`; a basis series shorter than it is all null (D-33).
  const basis = metricsBasisSeries(stratRet, dates, { dayBasis, calendarDense });
  const onBasis = (rolled: Array<number | null>) => basis.positions.map((pos) => (pos === null ? null : rolled[pos]));
  const dense = metricsBasisSeries(stratRet, dates, { calendarDense });
  const onDense = (rolled: Array<number | null>) => dense.positions.map((pos) => (pos === null ? null : rolled[pos]));

  // Benchmark alignments on THIS bundle's own date axis (169.5 D-54: one
  // coverage-aware helper for all five; BTC from the database when the route
  // passed it).
  const al = alignComparators(dates, args.benchmarkPrices);
  const btcAl = al.btc ?? unavailableAlignment(dates.length);

  // Phase 103 (MTM-04, correction) — correlations + the pairwise matrix are
  // derived HERE, per basis, NOT top-level cash. A correlation is
  // corr(strategy_returns, asset_returns): the benchmark legs are fixed INPUT
  // series, but the STRATEGY leg is the basis-selected dailies, so cash→MTM moves
  // ρ. Nothing bypasses the backbone. Pearson is a standard stat (no valuation
  // math). Under MTM the asset legs realign onto the MTM axis (Pitfall-1: same
  // axis as the strategy leg), so every cell compares like-for-like windows.
  //
  // Phase 169.5 (SC3, D-54, D-58 amendment): every cell is computed over the
  // intervals paired for BOTH legs; the strategy leg counts as paired everywhere.
  const stratAl: CoveredAlignment = {
    returns: stratRet,
    paired: stratRet.map(() => true),
    through: null,
    coveredToEnd: false,
  };
  const correlations: CorrelationRow[] = [
    { name: "BTC", rho: pairedCorr(stratAl, btcAl) },
    { name: "ETH", rho: pairedCorr(stratAl, al.eth) },
    { name: "S&P 500", rho: pairedCorr(stratAl, al.spx) },
    { name: "Gold", rho: pairedCorr(stratAl, al.gld) },
    { name: "US 10Y (IEF)", rho: pairedCorr(stratAl, al.ief) },
  ];
  // Full pairwise matrix — strategy short-name on the diagonal head so the matrix
  // reads as a self-similarity heatmap with one corner for the strategy.
  const matrixSeries: Array<{ name: string; al: CoveredAlignment }> = [
    { name: strategyName.length > 12 ? strategyName.slice(0, 11) + "…" : strategyName, al: stratAl },
    { name: "BTC", al: btcAl },
    { name: "ETH", al: al.eth },
    { name: "SPX", al: al.spx },
    { name: "Gold", al: al.gld },
    { name: "IEF", al: al.ief },
  ];
  const correlationLabels = matrixSeries.map(s => s.name);
  const correlationMatrix: number[][] = matrixSeries.map((a, i) =>
    matrixSeries.map((b, j) => (i === j ? 1 : pairedCorr(a.al, b.al))),
  );

  // Cash overrides with the persisted-overlay ann_vol; MTM uses its own.
  const annVol = args.comparatorAnnVol ?? fullMetrics.ann_vol;

  const { wins, losses } = streakLengths(stratRet);
  const MAX_LEN = 14;

  // Phase 103 (MTM-04 follow-through, Finding A): the full scalar summary for THIS
  // basis's series. eq/dd are compute()'s own above (arithmetic vs geometric),
  // so strip them to match the top-level ComputeSummary shape. The extended
  // distribution scalars (skew/kurt/VaR/CVaR/omega/…) read off this via view.
  const { eq: _bundleEq, dd: _bundleDd, ...bundleMetrics } = fullMetrics;

  return {
    dates,
    strategyReturns: stratRet,
    strategyEquity: stratEquity,
    strategyDrawdowns: stratDd,
    strategyRollingVol: onDense(rollingVol(dense.returns, rollWindow.window, periodsPerYear)),
    strategyRollingSharpe: onBasis(rollingSharpe(basis.returns, rollWindow.window, periodsPerYear)),
    strategyRollingSortino: onDense(rollingSortino(dense.returns, rollWindow.window, periodsPerYear)),
    rollingWindow: rollWindow,
    rollingBetaWindow: rollBetaWindow,
    strategyWorst10: worstDrawdowns(stratDd, 10),
    // Phase 169.5 D-59 (as amended 2026-09-27, Alternative A): each comparator's own
    // summary annualizes on the SMALLER of the strategy's and the comparator's basis
    // (vol / Sharpe / Sortino ride the observation clock, #597: a 7-day strategy sees
    // a weekday comparator ~252 times a year, a weekday strategy sees 7-day BTC ~252
    // times a year); the joint metrics keep the strategy's basis (166.4 D-A).
    comparators: {
      btc: al.btc === null ? unavailableComparatorBlock("BTC-USD", "BTC") : buildComparatorBlock("BTC-USD", "BTC", al.btc, stratRet, stratEquity, dates, annVol, rollWindow.window, rollBetaWindow.window, periodsPerYear, Math.min(periodsPerYear, annualizationPeriods("crypto"))),
      spx: buildComparatorBlock("S&P 500", "SPX", al.spx, stratRet, stratEquity, dates, annVol, rollWindow.window, rollBetaWindow.window, periodsPerYear, Math.min(periodsPerYear, annualizationPeriods("traditional"))),
      none: noneComparatorBlock,
    },
    // Phase 169.1 (D-31): the heatmap and Calmar by Year follow the method too,
    // so an arithmetic year's cells, its YTD, its Calmar row and `yearly` agree.
    monthlyReturns: monthlyReturnsMatrix(stratRet, dates, isArithmetic ? "arithmetic" : "geometric"),
    dailyHeatmap: dailyReturnsByYear(stratRet, dates),
    missingSegments: args.missingSegments,
    quantiles: quantileSummary(stratRet),
    streaks: {
      winsByLength: streakHistogram(wins, MAX_LEN),
      lossesByLength: streakHistogram(losses, MAX_LEN),
      totalWins: wins.length,
      totalLosses: losses.length,
      longestWin: wins.length > 0 ? Math.max(...wins) : 0,
      longestLoss: losses.length > 0 ? Math.max(...losses) : 0,
      maxLen: MAX_LEN,
    },
    calmarByYear: calmarByYear(stratRet, dates, isArithmetic ? "arithmetic" : "geometric"),
    // Phase 169.1 (D-34, D-27): the resample is drawn from the series the
    // headline's risk statistics run over (the one `basis` result above: the
    // non-zero days under active, the zero-filled calendar series on a calendar
    // composite, `stratRet` otherwise) and scored under the headline's method, so
    // the point Sharpe, Sortino and Max DD equal the headline beside them. `n` is
    // that series' length, the count the panel says the resamples are drawn from.
    bootstrapCI: bootstrapCI(basis.returns, 2000, 5, 42, periodsPerYear, isArithmetic ? "arithmetic" : "geometric"),
    styleDrift: computeStyleDrift(stratRet, dates),
    // CR-01 (SC3): stress windows take BTC null-honest — a window with an uncovered
    // BTC day gets null bench fields, never a compounded 0% day. Not under D-65.
    // Phase 169.1 (D-34): the strategy leg follows the headline's method.
    stressWindows: computeStressWindows(dates, stratRet, btcAl.returns, "BTC", markets, isArithmetic ? "arithmetic" : "geometric"),
    strategyMetrics: bundleMetrics,
    correlations,
    correlationMatrix: { labels: correlationLabels, matrix: correlationMatrix },
  };
}

/** The strategy identity and metadata `buildFactsheetPayload` renders. */
type FactsheetStrategyInput = {
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
    /** Phase 170.2 (SC-4, D-09) — `strategies.source`. Only `"csv"` reaches the payload. */
    source?: string | null;
    leverageRange?: string | null;
    aum?: number | null;
    maxCapacity?: number | null;
    avgDailyTurnover?: number | null;
    startDate?: string | null;
    benchmark?: string | null;
};

/**
 * Build the full FactsheetPayload from a strategy's daily-return rows.
 *
 * Behavior:
 *   1. Sort + dedupe the strategy series by date.
 *   2. Clip to the benchmark coverage window (so BTC/SPX always have data).
 *   3. Compute strategy headline metrics.
 *   4. Build a comparator block for each of BTC / SPX (and the "none" stub).
 *
 * 167.2.1-REVIEW WR-04 — NO NULL AFTER THE GATES, BY CONSTRUCTION. This
 * function holds exactly two null exits, the empty-series gate and the
 * `hasBuildableSeries` gate, and then hands a {@link BuildableSeries} to
 * `buildFromBuildableSeries`, whose declared return type is `FactsheetPayload`:
 * a new `return null` in the build body does not compile. Called with a
 * `BuildableSeries` (the overload below) this function is typed non-null, which
 * is what lets `fetchAndBuildPayload` answer a payload for every resolve that
 * succeeds. `fetch-and-build-payload.test.ts` pins that no third null exit is
 * added here (NO-NULL-AFTER-RESOLVE, source half).
 */
export function buildFactsheetPayload(
  strategy: FactsheetStrategyInput,
  dailyReturns: BuildableSeries,
  opts?: BuildFactsheetOpts,
): FactsheetPayload;
export function buildFactsheetPayload(
  strategy: FactsheetStrategyInput,
  dailyReturns: DailyReturn[],
  opts?: BuildFactsheetOpts,
): FactsheetPayload | null;
export function buildFactsheetPayload(
  strategy: FactsheetStrategyInput,
  dailyReturns: DailyReturn[],
  opts?: BuildFactsheetOpts,
): FactsheetPayload | null {
  if (!dailyReturns.length) return null;

  // The strategy series is the source of truth. A comparator is measured
  // only over the days it has real prices for (169 D-09, 169.5 D-54): an
  // uncovered or unpaired interval is null in its summary and joint metrics,
  // never a fabricated 0% day, and a window past its `through` is null. The
  // strategy panel set still renders when the strategy lies outside a
  // comparator's prices. Drop only when the raw series itself doesn't have 2
  // distinct dated observations.
  // D-04 (Phase 167.2.1): the gate is the shared predicate, so it normalizes a
  // second time; O(n log n) on a few thousand rows, accepted for one gate.
  if (!hasBuildableSeries(dailyReturns)) {
    const dedup = normalizeDailyReturns(dailyReturns);
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
  return buildFromBuildableSeries(strategy, dailyReturns, opts);
}

/**
 * The build body of `buildFactsheetPayload`, past its two gates. Its return
 * type is `FactsheetPayload` on purpose (167.2.1-REVIEW WR-04): it has no null
 * exit, and the compiler refuses one.
 */
function buildFromBuildableSeries(
  strategy: FactsheetStrategyInput,
  dailyReturns: BuildableSeries,
  opts?: BuildFactsheetOpts,
): FactsheetPayload {
  const clipped = normalizeDailyReturns(dailyReturns);

  const dates = clipped.map(d => d.date);
  const stratRet = clipped.map(d => d.value);

  // #597 — annualization basis for this strategy's KPIs (√365 crypto / √252
  // traditional). One value threaded into every single-strategy KPI surface
  // below so the whole factsheet renders on ONE coherent basis.
  const periodsPerYear = annualizationPeriods(strategy.assetClass);
  // computedMetrics feeds the cash-scalar overlay (strategyMetrics — top-level
  // cash-only; the KpiStrip's persisted-scalar path owns MTM there, Phase 102).
  // eq/dd are re-derived per basis inside deriveSeriesBundle, not carried here.
  //
  // Phase 90 (D3) — arithmetic vs geometric curve basis; threaded into
  // deriveSeriesBundle so all THREE curve fields move together per basis.
  // Arithmetic for a composite's "simple" method and, since Phase 169 review
  // round 1 (SFH H-2), a single-key `simple` returns_denominator_config.
  // Phase 169.1 (D-28, D-30): the same conventions reach compute() here and in
  // every bundle, with the day basis and, on a composite (zero-filled every
  // calendar day by the stitch), calendar density.
  const isArithmetic = opts?.cumulativeMethod === "arithmetic";
  const dayBasis = opts?.dayBasis;
  const calendarDense = opts?.dataQuality?.composite === true;
  const { eq: _eq, dd: _dd, ...computedMetrics } = compute(stratRet, dates, 0, periodsPerYear, {
    cumulativeMethod: isArithmetic ? "arithmetic" : "geometric",
    dayBasis,
    calendarDense,
  });

  // Phase 90 (D3) — cash-scalar overlay. The KpiStrip's seven headline scalars
  // read the PERSISTED `cash_settlement` basis so they agree with discovery /
  // ranking / acceptance, whatever cumulative method was persisted (geometric
  // mainline OR the Zavara "simple"/arithmetic override — Round-2 C-1). Round-2
  // H-1: the overlay is STRICT — a degenerate persisted scalar (`calmar:null` on
  // a zero-drawdown book) renders "—", not the client-geometric value it would
  // silently inherit. Since Phase 169 (D-10, SC4) the object is present on a
  // composite AND on a rankable single-key row (built from its persisted
  // top-level scalars by `readSingleKeyBasisOpts`); only where it is absent is
  // this a no-op (overlayBasisScalars returns base unchanged).
  const strategyMetrics = overlayBasisScalars(computedMetrics, opts?.metricsByBasis?.cash_settlement);

  // Phase 169.5 (SC3, D-09, D-21): the ONE BTC input of this build. The route's
  // opt is carried verbatim (already bounded over every axis and trimmed); with no
  // opt, the bundled fixture bounded over the same axes. It feeds every alignment
  // below AND rides on the payload, so the browser re-derive uses the same closes.
  const benchmarkPrices: BenchmarkPricesOpt =
    opts?.benchmarkPrices ??
    fixtureBenchmarkPrices([
      clipped,
      opts?.mtmSeries?.dailyReturns ?? [],
      opts?.smoothedSeries?.dailyReturns ?? [],
    ]);
  const apiAl = alignComparators(dates, benchmarkPrices);
  // Phase 169.4 (D-65, D-70(1)): the event signatures read BTC with its nulls kept
  // (the unavailable alignment when BTC is unavailable), so a missing BTC day is a
  // skipped event or a dropped trace, never a 0% day.
  const btcAligned = (apiAl.btc ?? unavailableAlignment(dates.length)).returns;

  // Default to "csv" (conservative) when the caller doesn't specify — avoids
  // exposing non-derivable panels for strategies whose source isn't explicitly
  // known. The synthesized demo panels (peer cohort, allocator portfolios,
  // event signatures) are computed + attached ONLY on the "api" arm below.
  // (NEW-C20-01)
  const ingestSource: IngestSource = strategy.ingestSource ?? "csv";

  // Phase 103 (MTM-04) — the cash series bundle. The comparator's volMatched rides
  // the OVERLAID strategyMetrics.ann_vol so it stays byte-identical to the persisted
  // cash overlay (SC-4). missingSegments stays the composite cash gap-spans opt.
  // correlations/correlationMatrix now come FROM this bundle (per-basis, MTM-04
  // correction) — the cash bundle reproduces the exact top-level values byte-for-byte.
  const cashBundle = deriveSeriesBundle(clipped, {
    periodsPerYear,
    isArithmetic,
    dayBasis,
    calendarDense,
    markets: strategy.markets,
    strategyName: strategy.name,
    comparatorAnnVol: strategyMetrics.ann_vol,
    missingSegments: opts?.missingSegments,
    benchmarkPrices,
  });

  // Phase 103 (MTM-04) — the MTM per-basis bundle, derived by the SAME function
  // from the persisted MTM series under the SAME conventions (the persisted MTM
  // scalars were computed under one cumulative_method per strategy). Own axis (MTM
  // gaps ≠ cash gaps) + own mask from the PERSISTED Python-derived gap_spans (never
  // a client re-derivation). Additive-only: absent → the cash payload is
  // byte-identical (SC-4). segmentBoundaries (composite key handoffs) are
  // basis-invariant and stay top-level; the client view-merge inherits them.
  let seriesByBasis: FactsheetCommon["seriesByBasis"];
  if (opts?.mtmSeries) {
    const mtmClipped = normalizeDailyReturns(opts.mtmSeries.dailyReturns);
    if (mtmClipped.length >= 2) {
      seriesByBasis = {
        mark_to_market: deriveSeriesBundle(mtmClipped, {
          periodsPerYear,
          isArithmetic,
          dayBasis,
          calendarDense,
          markets: strategy.markets,
          strategyName: strategy.name,
          // comparatorAnnVol omitted → the MTM comparator uses the MTM series'
          // own computed vol (honest MTM; no persisted cash overlay applies).
          missingSegments: deriveSegmentMarkers({ gap_spans: opts.mtmSeries.gapSpans }).missingSegments,
          benchmarkPrices,
        }),
      };
    }
  }
  // Phase 133 (SMTM-01) — the smoothed sibling of the MTM bundle above, derived by
  // the SAME function with its OWN axis + own Python-derived coverage mask. Additive:
  // absent → seriesByBasis stays whatever the MTM arm produced (or undefined), so the
  // cash/MTM payload is byte-identical (SC-4). Spreads over any existing MTM bundle so
  // a payload can legitimately carry both mark_to_market and smoothed_mtm.
  if (opts?.smoothedSeries) {
    const smoothedClipped = normalizeDailyReturns(opts.smoothedSeries.dailyReturns);
    if (smoothedClipped.length >= 2) {
      seriesByBasis = {
        ...seriesByBasis,
        smoothed_mtm: deriveSeriesBundle(smoothedClipped, {
          periodsPerYear,
          isArithmetic,
          dayBasis,
          calendarDense,
          markets: strategy.markets,
          strategyName: strategy.name,
          // comparatorAnnVol omitted → the smoothed comparator vol-matches the
          // smoothed series' own computed vol (honest; no persisted cash overlay).
          missingSegments: deriveSegmentMarkers({ gap_spans: opts.smoothedSeries.gapSpans }).missingSegments,
          benchmarkPrices,
        }),
      };
    }
  }

  // Fields shared by both ingest arms. The discriminated FactsheetPayload (B6)
  // appends the synthesized api-only panels onto this for "api" strategies. The
  // series-derived fields (INCLUDING correlations/correlationMatrix — MTM-04
  // correction: the strategy leg follows the basis) come from `cashBundle`, the ONE
  // derivation cash + MTM share; only strategyMetrics stays top-level cash (the
  // KpiStrip's persisted-scalar overlay owns MTM there, Phase 102). Key ORDER is
  // preserved verbatim so cash stays byte-identical.
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
    dates: cashBundle.dates,
    strategyReturns: cashBundle.strategyReturns,
    strategyEquity: cashBundle.strategyEquity,
    strategyRollingVol: cashBundle.strategyRollingVol,
    strategyRollingSharpe: cashBundle.strategyRollingSharpe,
    strategyRollingSortino: cashBundle.strategyRollingSortino,
    rollingWindow: cashBundle.rollingWindow,
    rollingBetaWindow: cashBundle.rollingBetaWindow,
    strategyDrawdowns: cashBundle.strategyDrawdowns,
    strategyWorst10: cashBundle.strategyWorst10,
    strategyMetrics,
    // Phase 164.6.6.2 (D-10, UI-SPEC A7): a BTC strategy measured against BTC is a flat
    // line, so a unit pins the comparator away from BTC. "none", never silently SPX.
    activeComparator: opts?.returnsUnit ? "none" : "btc",
    comparators: cashBundle.comparators,
    styleDrift: cashBundle.styleDrift,
    streaks: cashBundle.streaks,
    calmarByYear: cashBundle.calmarByYear,
    bootstrapCI: cashBundle.bootstrapCI,
    monthlyReturns: cashBundle.monthlyReturns,
    dailyHeatmap: cashBundle.dailyHeatmap,
    correlations: cashBundle.correlations,
    correlationMatrix: cashBundle.correlationMatrix,
    stressWindows: cashBundle.stressWindows,
    quantiles: cashBundle.quantiles,
    // Phase 90 — composite marker/basis fields. Optional-absent when opts
    // omitted (undefined values are dropped from the serialized RSC blob), so
    // single-key payloads stay byte-identical.
    segmentBoundaries: opts?.segmentBoundaries,
    missingSegments: opts?.missingSegments,
    metricsByBasis: opts?.metricsByBasis,
    mtmGate: opts?.mtmGate,
    // Phase 133 (SMTM-01) — additive smoothed gate passthrough (undefined dropped
    // from the serialized blob when no smoothed story, so cash/MTM stays identical).
    smoothedGate: opts?.smoothedGate,
    dataQuality: opts?.dataQuality,
    // Phase 169.1 (D-27 as amended, D-30, D-83 (b)) — the strategy's conventions,
    // for the browser re-derive arms. Emitted ONLY when non-default, by spread so
    // the key is absent (not undefined) otherwise: the read path returns a method
    // for EVERY composite ("geometric" included) and defaults the day basis to
    // "calendar", so an unconditional emit would add two keys to every geometric
    // composite payload.
    ...(opts?.cumulativeMethod === "arithmetic" ? { cumulativeMethod: "arithmetic" as const } : {}),
    // Phase 164.6.6.2 (D-08, D-09) — by spread, so a USD payload has no `returnsUnit`
    // key at all (not `undefined`) and its snapshot and cache entry are unchanged.
    ...(opts?.returnsUnit ? { returnsUnit: opts.returnsUnit } : {}),
    // Phase 170.2 (SC-4, D-09) — by spread, so a non-CSV payload has no `source`
    // key at all (not `undefined`) and its snapshot is byte-identical. The marker
    // is the STORED `strategies.source`, not `ingestSource`: that is derived from
    // `daily_returns`, which is NULL on every PROD strategy and so reads "api".
    ...(strategy.source === "csv" ? { source: "csv" as const } : {}),
    ...(opts?.dayBasis === "active" ? { dayBasis: "active" as const } : {}),
    // Phase 90.5 (LEV-01/D2) — emit the #597 annualization basis so the client
    // leverage recompute annualizes on the SAME basis the server did. Additive-
    // optional: single-key payloads carry a number here, stale caches lack it.
    periodsPerYear,
    // Phase 103 (MTM-04) — additive per-basis bundle; undefined (dropped from the
    // serialized blob) when no persisted MTM series feeds the build (SC-4).
    seriesByBasis,
    // Phase 169.5 (SC3, D-09, D-21) — the BTC series every comparator above was
    // computed from; the browser re-derive reads it instead of the fixture.
    benchmarkPrices,
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
    // Phase 169.4 (169.5 D-65; D-70(2)-(4)): each allocator portfolio blend is built
    // on its legs' COMMON calendar through `alignBlend` (the one alignment, every leg
    // and the book), so a missing leg day, a weekday leg's weekend and every day past
    // a fixture's last close is skipped or unpaired, never read as a 0% day. Each
    // blend annualizes on its own calendar's basis; a blend with fewer than 2 usable
    // days carries null figures and its `through` date.
    const btcLeg = (weight: number): BlendLeg =>
      "unavailable" in benchmarkPrices
        ? comparatorLeg("btc", weight, [], [])
        : comparatorLeg("btc", weight, benchmarkPrices.prices, benchmarkPrices.dropped);
    // Review SFH MEDIUM-2: a failed BTC read is named as the cause on the portfolios
    // with a BTC leg, so the panel never blames the strategy's data ("too few days").
    const btcUnavailable = "unavailable" in benchmarkPrices ? "BTC" : null;
    const portfolioFigures = (legs: BlendLeg[], unavailableLeg: string | null = null) => {
      const a = alignBlend(dates, stratRet, legs);
      return {
        ...buildAllocatorMetrics(a.returns, a.book, a.periodsPerYear, a.paired),
        through: a.through,
        unavailable_leg: unavailableLeg,
      };
    };
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
          // D-70(3): pure-tradfi legs (SPX + IEF), weekday calendar → 252.
          ...portfolioFigures([comparatorLeg("spx", 0.6, SPX_DAILY, []), comparatorLeg("ief", 0.4, IEF_DAILY, [])]),
        },
        {
          key: "multi_asset",
          name: "Multi-Asset Risk Parity",
          composition: "25% S&P 500 · 25% Gold · 25% IEF · 25% BTC",
          // D-70(3): 252, was 365 under #597 BLEND-02. Founder ruling 2026-09-30
          // ("Allow 252 here"): a narrow exception to BLEND-02 for this panel only,
          // because its points are weekdays once weekend gaps are no longer 0-filled.
          ...portfolioFigures([
            comparatorLeg("spx", 0.25, SPX_DAILY, []),
            comparatorLeg("gld", 0.25, GLD_DAILY, []),
            comparatorLeg("ief", 0.25, IEF_DAILY, []),
            btcLeg(0.25),
          ], btcUnavailable),
        },
        {
          key: "crypto_book",
          name: "Diversified Crypto Book",
          composition: "70% BTC · 30% ETH",
          // D-70(3): BTC + ETH legs, 7-day calendar → 365 (unchanged).
          ...portfolioFigures([btcLeg(0.7), comparatorLeg("eth", 0.3, ETH_DAILY, [])], btcUnavailable),
        },
      ],
      eventSignatures: computeEventSignatures(stratRet, btcAligned, cashBundle.strategyEquity),
      // BTC's own equity carries its level flat across a BTC null. That level is
      // never read: computeEventSignatures drops every trace whose window reads a
      // BTC null (D-70(1)), and a kept trace's ratios multiply only non-null
      // returns, so no figure reads a missing BTC day as 0%.
      benchEventSignatures: computeEventSignatures(btcAligned, btcAligned, cumEq(btcAligned.map(r => r ?? 0))),
    };
  }

  return { ...common, ingestSource: "csv" };
}

/**
 * Phase 169.5 (D-54, D-58 amendment) — the correlation of two aligned legs over
 * the indices paired for BOTH; NaN when fewer than two such indices remain.
 */
function pairedCorr(a: CoveredAlignment, b: CoveredAlignment): number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < a.returns.length; i++) {
    const x = a.returns[i];
    const y = b.returns[i];
    if (a.paired[i] && b.paired[i] && x != null && y != null) {
      xs.push(x);
      ys.push(y);
    }
  }
  return pearsonCorr(xs, ys);
}

function pearsonCorr(a: number[], b: number[]): number {
  // The correlation is computed by `@/lib/return-stats` (Phase 166.2 D-17). An
  // undefined correlation (fewer than 2 points, or a leg whose only dispersion
  // is float residue) reads NaN, as an all-zero leg always has here (D-07).
  return pearson(a, b) ?? NaN;
}

