/**
 * Scenario → FactsheetPayload adapter — the single source of truth for the
 * full-resolution returns axis that lets the composer's hypothetical scenario
 * blend render through the SAME factsheet `TimeSeriesChart` + `MasterBrush`
 * engine (Phase 38, PARITY-01). The factsheet is the truth: a scenario blend is
 * "just another strategy," so we synthesize a minimal, VALID `FactsheetPayload`
 * (the `csv` arm) rather than fork or reimplement the chart engine. Synthesizing
 * keeps every factsheet file byte-identical — their tests cannot break.
 *
 * SINGLE-AXIS BY CONSTRUCTION (WR-01 fix). A valid `FactsheetPayload` has ONE
 * date axis: `dates[i] ↔ strategyReturns[i] ↔ strategyEquity[i] ↔
 * strategyDrawdowns[i] ↔ every rolling/panel array`. We therefore build the
 * WHOLE payload — chart line AND metric/panel body — off the engine's
 * full-resolution `portfolio_daily_returns` (daily RETURN form), exactly the
 * way the real `build-payload.ts` does (parity-by-construction). This mirrors
 * `build-payload.ts`: `dates = returnDates`, `strategyEquity = cumEq(rets)`,
 * `strategyDrawdowns = drawdowns(cumEq(rets))`, `strategyReturns = rets`.
 *
 * The earlier two-axis design (D-2 "Option a") sourced the chart LINE from the
 * composer's `equity_curve` wealth series — but `equity_curve` is downsampled
 * every 5 business days + 5-decimal-rounded (scenario.ts:435-447), length ≈ n/5,
 * while `portfolio_daily_returns` is full-resolution, length n. That made
 * `dates.length ≈ n/5` but `strategyReturns.length === n`: the returns/rolling
 * panels desynced ~5x against the shared `dates` axis (WR-01). D-2's premise that
 * `dates === datesR` was FALSE. A complete payload can have only ONE axis, and it
 * must be the full-res returns axis so the returns panels are honest. The line is
 * now `cumEq(rets)` — the same curve `equity_curve` downsamples, just full-res and
 * unrounded.
 *
 * Pure TS, zero dependencies, no fetch / DOM / time. Consumes the engine's
 * `portfolio_daily_returns` plus an optional benchmark, and emits the shape the
 * two charts ACTUALLY read:
 *   - dates            : the returns date axis (the canonical x-model; index =
 *                        position in `dates` for `TimeSeriesChart`,
 *                        `MasterBrush`, and the `setXRange` clamp).
 *   - strategyEquity   : cumEq(rets) — full-res cumulative wealth (base 1.0),
 *                        index-aligned over `dates`. The accent strategy line AND
 *                        the MasterBrush sparkline.
 *   - strategyDrawdowns: drawdowns(cumEq(rets)) — the underwater config's series
 *                        (shared factsheet helpers; identical peak-anchoring).
 *   - comparators.btc.cumulative : benchmark index-aligned over `dates`
 *                        (missing day → null, dropped by TimeSeriesChart's path
 *                        builder); every other comparator field is null.
 *   - activeComparator : "btc" when a benchmark is present, else "none".
 *
 * Convention pins (LOCKED — see scenario-factsheet-payload.test.ts):
 *   - ONE canonical `dates[]` axis = the returns dates; the benchmark is
 *     projected onto it via a date→value Map (mirrors EquityChart.tsx:593-595).
 *   - Color/width is NEVER inlined here: `resolveSeries` (chart-configs.ts)
 *     owns the scenario→accent / benchmark→muted contract via the exported
 *     ChartConfig constants below. No `stroke`/`color:` in this module.
 *   - ONE degenerate gate governs everything: when `portfolioDaily` is degenerate
 *     (empty / ANY non-finite return / < 2 dated points) the WHOLE payload is
 *     safe-empty (dates [], equity [], drawdowns [], all panels empty, comparator
 *     null) and NEVER throws — no NaN/Inf reaches the chart.
 *   - The `csv` arm is correct by construction: a hypothetical scenario
 *     physically cannot carry peer-rank / portfolio panels (no-invented-data).
 */
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { compute, cumEq, drawdowns, worstDrawdowns } from "@/lib/factsheet/compute";
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
  PeerPercentilePayload,
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
  /**
   * The engine's `portfolio_daily_returns` — daily RETURN form (decimal, e.g.
   * 0.012), the input `compute()` consumes. The SINGLE source for the entire
   * payload (WR-01): the `dates` axis, the chart line (`strategyEquity =
   * cumEq(rets)`, `strategyDrawdowns = drawdowns(cumEq(rets))`), the full scalar
   * metric set, AND every panel array — all index-aligned on this one axis
   * (parity-by-construction with `build-payload.ts`). Empty/absent → safe-empty
   * payload (the engine already pre-collapses to [] below n<10).
   */
  portfolioDaily?: DailyPoint[];
  /** Optional benchmark overlay (cumulative wealth form), date-keyed. */
  benchmark?: DailyPoint[] | null;
  /** Scenario-scoped synthetic strategy id (storage-key scoping). */
  strategyId?: string;
  /**
   * Phase 42 (PEER-01, ADR-0025) — the blend's peer rank vs the REAL verified
   * universe, on the cohort's sample/252 basis. Additive + optional: every
   * existing call site omits it, so the returned csv payload stays
   * byte-identical (the key is OMITTED, not set to undefined, when absent —
   * see the conditional spread in the return below). The carve-out NEVER flips
   * `ingestSource` — the three genuinely-synthetic api panels stay absent.
   */
  scenarioPeer?: PeerPercentilePayload;
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
 * The ENTIRE returns-derived payload body, synthesized from the blend's
 * `portfolio_daily_returns` (daily RETURN form) on ONE full-resolution axis
 * (WR-01) via the population-convention `compute.ts`/`rolling.ts` helper family —
 * mirroring `build-payload.ts`'s csv-arm assembly field-for-field (PAYLOAD-01/02/
 * 03/04). This covers BOTH the chart line (`dates`, `strategyEquity = cumEq(rets)`,
 * `strategyDrawdowns = drawdowns(cumEq(rets))`) AND the full scalar metric set +
 * every panel array — all index-aligned on the single returns axis so
 * `dates[i] ↔ strategyReturns[i] ↔ strategyEquity[i] ↔ …` holds by construction.
 *
 * Returns the safe-empty defaults when `portfolioDaily` is degenerate (empty /
 * any non-finite return / < 2 dated points) WITHOUT calling `compute()` (which
 * throws on empty) — never NaN/Inf, never fabricated zeros presented as real
 * metrics (PAYLOAD-05). `strategyMetrics.n` flows from `rets.length` (the true
 * overlapping-observation count), driving the unchanged n<252 caveat.
 */
type ReturnsBody = {
  dates: FactsheetCsvPayload["dates"];
  strategyEquity: FactsheetCsvPayload["strategyEquity"];
  strategyDrawdowns: FactsheetCsvPayload["strategyDrawdowns"];
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
      dates: [],
      strategyEquity: [],
      strategyDrawdowns: [],
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
  // PAYLOAD-04 automatic. The chart LINE is now full-res too (WR-01): the equity
  // line is `cumEq(rets)` — the same curve `equity_curve` downsamples, just
  // full-res/unrounded — and the underwater line is `drawdowns(cumEq(rets))`.
  const rollWindow = pickRollingWindow(rets.length);
  const rollBetaWindow = pickRollingWindow(rets.length, [
    { window: ROLL_WINDOW_90D, label: "90d" },
    { window: ROLL_WINDOW_30D, label: "30d" },
  ]);
  // The chart line is full-res (WR-01): `strategyEquity = cumEq(rets)` (the same
  // curve `equity_curve` downsamples, just full-res/unrounded), and the
  // underwater line = `drawdowns(eq)`. compute()'s own `dd` IS `drawdowns(cumEq
  // (rets))` (compute.ts:21-22), so `strategyDrawdowns` and the Worst-10 table
  // (built off `dd`) are the SAME peak-anchored series by construction.
  const { eq: _eq, dd, ...strategyMetrics } = compute(rets, datesR);
  const eq = cumEq(rets);
  const { wins, losses } = streakLengths(rets);
  const MAX_LEN = 14;

  return {
    dates: datesR,
    strategyEquity: eq,
    strategyDrawdowns: drawdowns(eq),
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
 * Build a COMPLETE, valid `FactsheetPayload` (csv arm) from the engine's
 * daily-RETURN series + an optional benchmark — on ONE full-resolution axis.
 *
 * SINGLE-AXIS (WR-01). The whole payload is synthesized from `portfolioDaily`
 * (daily RETURN form) via `buildReturnsBody`: the `dates` axis, the chart LINE
 * (`strategyEquity = cumEq(rets)`, `strategyDrawdowns = drawdowns(cumEq(rets))`),
 * the full scalar metric set, and every panel array — all index-aligned so
 * `dates[i] ↔ strategyReturns[i] ↔ strategyEquity[i] ↔ …` holds by construction
 * (parity with `build-payload.ts`). The blend never hits the Python compute.
 *
 * ONE degenerate gate: a poisoned/empty/sub-2-date RETURNS series collapses the
 * ENTIRE payload to safe-empty (dates [], equity [], drawdowns [], all panels
 * empty, comparator null) BEFORE any compute() call. Never NaN/Inf.
 */
export function buildScenarioFactsheetPayload(
  args: ScenarioFactsheetPayloadArgs,
): FactsheetCsvPayload {
  const { benchmark, portfolioDaily, strategyId, scenarioPeer } = args;
  const id = strategyId ?? DEFAULT_SCENARIO_ID;

  // The single returns-derived body — chart line + scalars + panel arrays, all
  // on one full-res axis. Self-guards its returns-degenerate gate before any
  // compute() call (PAYLOAD-01..05, WR-01). Degenerate → every field safe-empty.
  const body = buildReturnsBody(portfolioDaily ?? []);
  const { dates, strategyEquity, strategyDrawdowns } = body;
  const degenerate = dates.length === 0;

  // Benchmark → comparators.btc.cumulative, index-aligned over the returns axis
  // `dates`. Missing day → null (dropped by TimeSeriesChart's buildPath /
  // Y-domain scan, both of which `continue` on `v == null`). Mirrors the
  // existing benchmark date→value map at EquityChart.tsx:593-595. `ComparatorBlock.
  // cumulative` is typed `number[] | null` because the factsheet pre-aligns the
  // benchmark to a DENSE series upstream (comparator-block.ts:61); the composer's
  // benchmark is genuinely sparse against the returns axis, so we assign through
  // the runtime-tolerated nullable shape at this one boundary.
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
    // PEER-01 (ADR-0025): conditionally spread scenarioPeer so the key is
    // OMITTED (not undefined) when the arg is absent — every existing call site
    // produces a byte-identical payload, and the type-field invariant holds
    // (scenarioPeer is a csv-only additive field; the three synthetic api
    // panels stay structurally absent).
    ...(scenarioPeer ? { scenarioPeer } : {}),
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
    // ── Single full-res returns axis (WR-01): chart line + scalars + panels
    //    all index-aligned on `body.dates` (PAYLOAD-01/02/03/04/05) ──
    dates,
    strategyReturns: body.strategyReturns,
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
