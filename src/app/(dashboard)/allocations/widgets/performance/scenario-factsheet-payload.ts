/**
 * Scenario → FactsheetPayload adapter — the single source of truth for the
 * date-keyed → index-aligned bridge that lets the composer's hypothetical
 * scenario blend render through the SAME factsheet `TimeSeriesChart` +
 * `MasterBrush` engine (Phase 38, PARITY-01). The factsheet is the truth: a
 * scenario blend is "just another strategy," so we synthesize a minimal,
 * VALID `FactsheetPayload` (the `csv` arm) rather than fork or reimplement the
 * chart engine. Synthesizing keeps every factsheet file byte-identical — their
 * tests cannot break.
 *
 * Pure TS, zero dependencies, no fetch / DOM / time. Consumes the composer's
 * toWealth-normalized scenario series (cumulative wealth, start ~1.0) plus an
 * optional benchmark, and emits the shape the two charts ACTUALLY read:
 *   - dates            : the scenario's own date axis (the canonical x-model;
 *                        index = position in `dates` for `TimeSeriesChart`,
 *                        `MasterBrush`, and the `setXRange` clamp).
 *   - strategyEquity   : scenario wealth index-aligned over `dates` — the
 *                        accent strategy line AND the MasterBrush sparkline.
 *   - strategyDrawdowns: deriveSnapshotDrawdowns(scenario) — the underwater
 *                        config's series (REUSED helper; identical peak-anchoring).
 *   - comparators.btc.cumulative : benchmark index-aligned over `dates`
 *                        (missing day → null, dropped by TimeSeriesChart's path
 *                        builder); every other comparator field is null.
 *   - activeComparator : "btc" when a benchmark is present, else "none".
 *
 * Convention pins (LOCKED — see scenario-factsheet-payload.test.ts):
 *   - ONE canonical `dates[]` axis = the scenario's dates; the benchmark is
 *     projected onto it via a date→value Map (mirrors EquityChart.tsx:593-595).
 *   - Color/width is NEVER inlined here: `resolveSeries` (chart-configs.ts)
 *     owns the scenario→accent / benchmark→muted contract via the exported
 *     ChartConfig constants below. No `stroke`/`color:` in this module.
 *   - Degenerate input (empty scenario, or ANY non-finite scenario value)
 *     collapses to a safe empty payload (dates [], strategyEquity [],
 *     comparator cumulative null) and NEVER throws — no NaN reaches the chart.
 *   - The `csv` arm is correct by construction: a hypothetical scenario
 *     physically cannot carry peer-rank / portfolio panels (no-invented-data).
 */
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { deriveSnapshotDrawdowns } from "@/app/(dashboard)/allocations/lib/drawdown";
import { compute, worstDrawdowns } from "@/lib/factsheet/compute";
import {
  rollingVol,
  rollingSharpe,
  rollingSortino,
  pickRollingWindow,
  ROLL_WINDOW_90D,
  ROLL_WINDOW_30D,
} from "@/lib/factsheet/rolling";
import { streakLengths, streakHistogram } from "@/lib/factsheet/streak";
import { calmarByYear } from "@/lib/factsheet/calmar-by-year";
import { bootstrapCI } from "@/lib/factsheet/bootstrap";
import { monthlyReturnsMatrix, dailyReturnsByYear } from "@/lib/factsheet/period-buckets";
import { computeStressWindows } from "@/lib/factsheet/stress-windows";
import { quantileSummary } from "@/lib/factsheet/quantiles";
import type {
  ChartConfig,
} from "@/app/factsheet/[id]/v2/chart-configs";
import type {
  ComparatorBlock,
  ComputeSummary,
  FactsheetCsvPayload,
  RollWindowPick,
} from "@/lib/factsheet/types";

/** Default x-model legend label for the scenario blend (the strategy line). */
const SCENARIO_NAME = "Scenario";
/** Stable scenario-scoped synthetic id (Plan 02 reads this for the storage key). */
const DEFAULT_SCENARIO_ID = "scenario";

/**
 * Equity chart config — mirrors chart-configs.ts `cumulative` (:82-95). The
 * scenario wealth resolves into the accent strategy line (`strategyEquity`);
 * the benchmark resolves into the muted comparator line (`cumulative`).
 * `baseline:1` + `rebaseOnZoom:true` make the growth-format reading match the
 * composer's "+X% since window start" semantics.
 */
export const SCENARIO_EQUITY_CONFIG: ChartConfig = {
  key: "scenario-equity",
  title: "Cumulative Returns",
  valueFormat: "growth",
  scalable: true,
  defaultScale: "log",
  baseline: 1,
  stratField: "strategyEquity",
  comparatorField: "cumulative",
  rebaseOnZoom: true,
};

/**
 * Drawdown chart config — mirrors chart-configs.ts `underwaterAcc` (:206-218).
 * Renders the underwater fill off the scenario's `strategyDrawdowns`; no
 * comparator line on the underwater panel.
 */
export const SCENARIO_DRAWDOWN_CONFIG: ChartConfig = {
  key: "scenario-underwater",
  title: "Underwater Chart for Accumulated Capital",
  subtitle: "drawdown from running peak",
  valueFormat: "percent",
  scalable: false,
  defaultScale: "linear",
  baseline: 0,
  height: 160,
  stratField: "strategyDrawdowns",
  comparatorField: null,
  fill: true,
};

export interface ScenarioFactsheetPayloadArgs {
  /** Scenario wealth series (toWealth-normalized; cumulative, start ~1.0). */
  scenario: DailyPoint[];
  /**
   * Live baseline series. Accepted for call-site symmetry with the composer
   * (blank mode passes []/null). The synthesized payload's strategy line is
   * ALWAYS the scenario — a hypothetical has no live baseline to merge — so
   * this is not folded into `strategyEquity`. Its presence does not change the
   * output; it documents the blank-slate contract (PARITY-03).
   */
  baseline?: DailyPoint[] | null;
  /** Optional benchmark overlay (cumulative wealth form), date-keyed. */
  benchmark?: DailyPoint[] | null;
  /**
   * The engine's `portfolio_daily_returns` — daily RETURN form (decimal, e.g.
   * 0.012), the input `compute()` consumes; distinct from `scenario` which is
   * cumulative WEALTH (~1.0). This is the parity-by-construction source for the
   * full scalar metric set + every panel array (Phase 39). Empty/absent →
   * safe-empty body (the engine already pre-collapses to [] below n<10).
   */
  portfolioDaily?: DailyPoint[];
  /** Scenario-scoped synthetic strategy id (storage-key scoping). */
  strategyId?: string;
}

/** Zeroed scalar metrics — no KpiStrip mounts in the composer, so the two
 *  charts never read these. Present only for `FactsheetPayload` completeness. */
function zeroedComputeSummary(): ComputeSummary {
  return {
    n: 0,
    start: "",
    end: "",
    years: 0,
    cum_ret: 0,
    cagr: 0,
    ann_vol: 0,
    sharpe: 0,
    sortino: 0,
    calmar: 0,
    max_dd: 0,
    longest_dd: 0,
    skew: 0,
    kurt: 0,
    mtd: 0,
    ytd: 0,
    p3m: 0,
    p6m: 0,
    p1y: 0,
    best_day: 0,
    worst_day: 0,
    best_week: 0,
    worst_week: 0,
    best_month: 0,
    worst_month: 0,
    best_quarter: 0,
    worst_quarter: 0,
    best_year: 0,
    worst_year: 0,
    win_rate: 0,
    avg_win: 0,
    avg_loss: 0,
    profit_factor: 0,
    var95: 0,
    cvar95: 0,
    recovery_factor: null,
    pain_index: 0,
    ulcer_index: 0,
    tail_ratio: null,
    omega_ratio: null,
    common_sense_ratio: null,
    yearly: {},
  };
}

/** An inert comparator block — every series field null. The benchmark (when
 *  present) is injected into `comparators.btc.cumulative` by the builder. */
function inertComparatorBlock(name: string, shortName: string): ComparatorBlock {
  return {
    name,
    shortName,
    summary: null,
    joint: null,
    cumulative: null,
    cumVsBench: null,
    dailyReturns: null,
    rollingVol: null,
    rollingSharpe: null,
    rollingSortino: null,
    volMatched: null,
    volMatchedLabel: null,
    rollingBeta: null,
  };
}

/** Rolling configs are not mounted in the composer; `enough:false` is the
 *  "Not enough data" default the cumulative/underwater configs never read. */
function notEnoughWindow(): RollWindowPick {
  return { window: 0, label: "", enough: false };
}

/** Safe-empty streaks block — the degenerate-path default (no win/loss runs). */
function emptyStreaks(): FactsheetCsvPayload["streaks"] {
  return {
    winsByLength: [],
    lossesByLength: [],
    totalWins: 0,
    totalLosses: 0,
    longestWin: 0,
    longestLoss: 0,
    maxLen: 0,
  };
}

/** Safe-empty bootstrap-CI block — zeroed point/lo/hi + empty histograms. */
function emptyBootstrapCI(): FactsheetCsvPayload["bootstrapCI"] {
  return {
    sharpe: { point: 0, lo: 0, hi: 0, hist: { lo: 0, hi: 0, bins: [] } },
    sortino: { point: 0, lo: 0, hi: 0, hist: { lo: 0, hi: 0, bins: [] } },
    max_dd: { point: 0, lo: 0, hi: 0, hist: { lo: 0, hi: 0, bins: [] } },
    n_resamples: 0,
    block_len: 0,
  };
}

/** Safe-empty stress-window block — no windows, empty benchName. */
function emptyStressWindows(): FactsheetCsvPayload["stressWindows"] {
  return {
    windows: [],
    benchName: "",
    totalCatalogued: 0,
    droppedOutOfRange: 0,
    droppedPartial: 0,
  };
}

/** Safe-empty quantile summary — every percentile zero. */
function emptyQuantiles(): FactsheetCsvPayload["quantiles"] {
  return { p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, min: 0, max: 0, mean: 0 };
}

/**
 * Daily-return-derived body fields: the full scalar metric set + every panel
 * array, synthesized from the blend's `portfolio_daily_returns` (daily RETURN
 * form) via the population-convention `compute.ts`/`rolling.ts` helper family —
 * mirroring `build-payload.ts`'s csv-arm assembly field-for-field (PAYLOAD-01/02/
 * 03/04). Returns the safe-empty defaults when `portfolioDaily` is degenerate
 * (empty / any non-finite return / < 2 dated points) WITHOUT calling `compute()`
 * (which throws on empty) — never NaN/Inf, never fabricated zeros presented as
 * real metrics (PAYLOAD-05). `strategyMetrics.n` flows from `rets.length` (the
 * true overlapping-observation count), driving the unchanged n<252 caveat.
 *
 * NOTE: this is DISTINCT from the equity/drawdown chart LINE, which keeps its
 * existing WEALTH-series source (D-2 Option a) so the Phase-38 chart-parity pins
 * stay byte-identical. The returns axis (`datesR`) is the metric/panel axis; the
 * chart line reads the scenario `dates`/`scenario` axis.
 */
type ReturnsBody = {
  strategyReturns: FactsheetCsvPayload["strategyReturns"];
  strategyRollingVol: FactsheetCsvPayload["strategyRollingVol"];
  strategyRollingSharpe: FactsheetCsvPayload["strategyRollingSharpe"];
  strategyRollingSortino: FactsheetCsvPayload["strategyRollingSortino"];
  rollingWindow: FactsheetCsvPayload["rollingWindow"];
  rollingBetaWindow: FactsheetCsvPayload["rollingBetaWindow"];
  strategyWorst10: FactsheetCsvPayload["strategyWorst10"];
  strategyMetrics: ComputeSummary;
  streaks: FactsheetCsvPayload["streaks"];
  calmarByYear: FactsheetCsvPayload["calmarByYear"];
  bootstrapCI: FactsheetCsvPayload["bootstrapCI"];
  monthlyReturns: FactsheetCsvPayload["monthlyReturns"];
  dailyHeatmap: FactsheetCsvPayload["dailyHeatmap"];
  stressWindows: FactsheetCsvPayload["stressWindows"];
  quantiles: FactsheetCsvPayload["quantiles"];
};

function buildReturnsBody(portfolioDaily: DailyPoint[]): ReturnsBody {
  const rets = portfolioDaily.map((p) => p.value);
  const datesR = portfolioDaily.map((p) => p.date);

  // Returns-degenerate gate — evaluated BEFORE any compute() call (compute()
  // throws on empty). Empty / any non-finite return / a single dated point all
  // collapse to the safe-empty body (PAYLOAD-05). The frozen engine already
  // pre-collapses to [] below n<10, so realistically this sees [] or n>=10.
  const degenerate =
    portfolioDaily.length === 0 ||
    rets.some((v) => !Number.isFinite(v)) ||
    datesR.length < 2;

  if (degenerate) {
    return {
      strategyReturns: [],
      strategyRollingVol: [],
      strategyRollingSharpe: [],
      strategyRollingSortino: [],
      rollingWindow: notEnoughWindow(),
      rollingBetaWindow: notEnoughWindow(),
      strategyWorst10: [],
      strategyMetrics: zeroedComputeSummary(),
      streaks: emptyStreaks(),
      calmarByYear: [],
      bootstrapCI: emptyBootstrapCI(),
      monthlyReturns: [],
      dailyHeatmap: [],
      stressWindows: emptyStressWindows(),
      quantiles: emptyQuantiles(),
    };
  }

  // Populated path — mirror build-payload.ts:123-231 (csv arm), population
  // convention (252 vol/Sharpe, 365.25 CAGR). compute() sets n = rets.length →
  // PAYLOAD-04 automatic. Strip the heavy eq/dd arrays (the chart LINE carries
  // its own wealth-derived equity/drawdowns).
  const rollWindow = pickRollingWindow(rets.length);
  const rollBetaWindow = pickRollingWindow(rets.length, [
    { window: ROLL_WINDOW_90D, label: "90d" },
    { window: ROLL_WINDOW_30D, label: "30d" },
  ]);
  const { eq: _eq, dd, ...strategyMetrics } = compute(rets, datesR);
  const { wins, losses } = streakLengths(rets);
  const MAX_LEN = 14;

  return {
    strategyReturns: rets,
    strategyRollingVol: rollingVol(rets, rollWindow.window),
    strategyRollingSharpe: rollingSharpe(rets, rollWindow.window),
    strategyRollingSortino: rollingSortino(rets, rollWindow.window),
    rollingWindow: rollWindow,
    rollingBetaWindow: rollBetaWindow,
    strategyWorst10: worstDrawdowns(dd, 10),
    strategyMetrics,
    streaks: {
      winsByLength: streakHistogram(wins, MAX_LEN),
      lossesByLength: streakHistogram(losses, MAX_LEN),
      totalWins: wins.length,
      totalLosses: losses.length,
      longestWin: wins.length > 0 ? Math.max(...wins) : 0,
      longestLoss: losses.length > 0 ? Math.max(...losses) : 0,
      maxLen: MAX_LEN,
    },
    calmarByYear: calmarByYear(rets, datesR),
    bootstrapCI: bootstrapCI(rets),
    monthlyReturns: monthlyReturnsMatrix(rets, datesR),
    dailyHeatmap: dailyReturnsByYear(rets, datesR),
    // D-4 / Pitfall 5: the blend has no separate benchmark daily series, so pass
    // the strat's own returns as benchRet + an empty benchName (honest — the
    // window's bench column mirrors the strategy). markets=[] → full catalogue.
    stressWindows: computeStressWindows(datesR, rets, rets, "", []),
    quantiles: quantileSummary(rets),
  };
}

/**
 * Build a COMPLETE, valid `FactsheetPayload` (csv arm) from the composer's
 * date-keyed scenario + optional benchmark + the engine's daily-RETURN series.
 *
 * Two independent axes feed this payload, by design (D-2 Option a):
 *   - The chart LINE (`dates` / `strategyEquity` / `strategyDrawdowns`) reads
 *     the scenario WEALTH series, index-aligned to ONE canonical `dates[]` axis
 *     (the scenario's own dates) — preserving the Phase-38 chart-parity pins.
 *   - The full scalar metric set + every panel array (`strategyMetrics`,
 *     rolling*, streaks, calmar, bootstrap, monthly/heatmap, quantiles, stress)
 *     are synthesized from `portfolioDaily` (daily RETURN form) via the
 *     population-convention `compute.ts`/`rolling.ts` family — see
 *     `buildReturnsBody`. The blend never hits the Python compute.
 *
 * Both axes degenerate-collapse independently: a poisoned/empty WEALTH series →
 * empty chart line; a poisoned/empty/sub-2-date RETURNS series → safe-empty
 * metrics/panels (BEFORE any compute() call). Neither ever emits NaN/Inf.
 */
export function buildScenarioFactsheetPayload(
  args: ScenarioFactsheetPayloadArgs,
): FactsheetCsvPayload {
  const { scenario, benchmark, portfolioDaily, strategyId } = args;
  const id = strategyId ?? DEFAULT_SCENARIO_ID;

  // Returns-derived body (full scalars + panel arrays). Self-guards its own
  // returns-degenerate gate before calling compute() (PAYLOAD-01..05).
  const body = buildReturnsBody(portfolioDaily ?? []);

  // Degenerate-collapse: empty, or ANY non-finite scenario value → safe empty
  // payload (no NaN propagation into the chart). Mirrors the analog's rule.
  const degenerate =
    scenario.length === 0 ||
    scenario.some((p) => !Number.isFinite(p.value));

  const dates = degenerate ? [] : scenario.map((p) => p.date);
  const strategyEquity = degenerate ? [] : scenario.map((p) => p.value);
  const strategyDrawdowns = degenerate
    ? []
    : deriveSnapshotDrawdowns(scenario).map((d) => d.value);

  // Benchmark → comparators.btc.cumulative, index-aligned over `dates`.
  // Missing day → null (dropped by TimeSeriesChart's buildPath / Y-domain
  // scan, both of which `continue` on `v == null`). Mirrors the existing
  // benchmark date→value map at EquityChart.tsx:593-595. `ComparatorBlock.
  // cumulative` is typed `number[] | null` because the factsheet pre-aligns
  // the benchmark to a DENSE series upstream (comparator-block.ts:61); the
  // composer's benchmark is genuinely sparse against the scenario axis, so we
  // assign through the runtime-tolerated nullable shape at this one boundary.
  const hasBenchmark = !degenerate && !!benchmark && benchmark.length > 0;
  let benchAligned: (number | null)[] | null = null;
  if (hasBenchmark) {
    const byDate = new Map<string, number>();
    for (const p of benchmark!) {
      if (Number.isFinite(p.value)) byDate.set(p.date, p.value);
    }
    benchAligned = dates.map((d) => byDate.get(d) ?? null);
  }

  const btc = inertComparatorBlock("BTC", "BTC");
  btc.cumulative = benchAligned as ComparatorBlock["cumulative"];

  return {
    ingestSource: "csv",
    strategyId: id,
    strategyName: SCENARIO_NAME,
    strategyTypes: [],
    markets: [],
    computedAt: "",
    trustTier: null,
    description: null,
    subtypes: [],
    supportedExchanges: [],
    leverageRange: null,
    aum: null,
    maxCapacity: null,
    avgDailyTurnover: null,
    startDate: null,
    benchmark: null,
    dates,
    // ── Returns-derived body (full scalars + panel arrays, PAYLOAD-01/02/03/04/05) ──
    strategyReturns: body.strategyReturns,
    // strategyEquity / strategyDrawdowns stay on the WEALTH-series source (D-2
    // Option a) — the chart LINE keeps Phase-38 byte-parity; only the metrics
    // and panels above read the returns axis.
    strategyEquity,
    strategyRollingVol: body.strategyRollingVol,
    strategyRollingSharpe: body.strategyRollingSharpe,
    strategyRollingSortino: body.strategyRollingSortino,
    rollingWindow: body.rollingWindow,
    rollingBetaWindow: body.rollingBetaWindow,
    strategyDrawdowns,
    strategyWorst10: body.strategyWorst10,
    strategyMetrics: body.strategyMetrics,
    activeComparator: hasBenchmark ? "btc" : "none",
    comparators: {
      btc,
      spx: inertComparatorBlock("S&P 500", "SPX"),
      none: inertComparatorBlock("None", "None"),
    },
    // D-5: style-drift panel DEFERRED to v2 (CONTEXT wins over PAYLOAD-02's
    // mention — Rule 7). Phase 39 holds it null rather than fabricate it.
    styleDrift: null,
    streaks: body.streaks,
    calmarByYear: body.calmarByYear,
    bootstrapCI: body.bootstrapCI,
    monthlyReturns: body.monthlyReturns,
    dailyHeatmap: body.dailyHeatmap,
    // D-6: market correlations stay HONEST-EMPTY — there is no aligned benchmark
    // daily series to correlate against, and the CONSTITUENT-correlation matrix
    // is Phase 41's job. Never fabricate a self-correlation here.
    correlations: [],
    correlationMatrix: { labels: [], matrix: [] },
    stressWindows: body.stressWindows,
    quantiles: body.quantiles,
  };
}
