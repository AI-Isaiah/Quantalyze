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

/**
 * Build a minimal, valid `FactsheetPayload` (csv arm) from the composer's
 * date-keyed scenario + optional benchmark. Index-aligns everything to ONE
 * canonical `dates[]` axis (the scenario's own dates). Returns a safe empty
 * payload when the scenario is empty or carries any non-finite value.
 */
export function buildScenarioFactsheetPayload(
  args: ScenarioFactsheetPayloadArgs,
): FactsheetCsvPayload {
  const { scenario, benchmark, strategyId } = args;
  const id = strategyId ?? DEFAULT_SCENARIO_ID;

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
    strategyReturns: [],
    strategyEquity,
    strategyRollingVol: [],
    strategyRollingSharpe: [],
    strategyRollingSortino: [],
    rollingWindow: notEnoughWindow(),
    rollingBetaWindow: notEnoughWindow(),
    strategyDrawdowns,
    strategyWorst10: [],
    strategyMetrics: zeroedComputeSummary(),
    activeComparator: hasBenchmark ? "btc" : "none",
    comparators: {
      btc,
      spx: inertComparatorBlock("S&P 500", "SPX"),
      none: inertComparatorBlock("None", "None"),
    },
    styleDrift: null,
    streaks: {
      winsByLength: [],
      lossesByLength: [],
      totalWins: 0,
      totalLosses: 0,
      longestWin: 0,
      longestLoss: 0,
      maxLen: 0,
    },
    calmarByYear: [],
    bootstrapCI: {
      sharpe: { point: 0, lo: 0, hi: 0, hist: { lo: 0, hi: 0, bins: [] } },
      sortino: { point: 0, lo: 0, hi: 0, hist: { lo: 0, hi: 0, bins: [] } },
      max_dd: { point: 0, lo: 0, hi: 0, hist: { lo: 0, hi: 0, bins: [] } },
      n_resamples: 0,
      block_len: 0,
    },
    monthlyReturns: [],
    dailyHeatmap: [],
    correlations: [],
    correlationMatrix: { labels: [], matrix: [] },
    stressWindows: {
      windows: [],
      benchName: "",
      totalCatalogued: 0,
      droppedOutOfRange: 0,
      droppedPartial: 0,
    },
    quantiles: { p05: 0, p25: 0, p50: 0, p75: 0, p95: 0, min: 0, max: 0, mean: 0 },
  };
}
