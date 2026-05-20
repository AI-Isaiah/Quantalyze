/**
 * Shared types for the factsheet TS port.
 *
 * Ports the data shapes used by `/tmp/gen_factsheet_v3.py` (the mockup
 * generator) into TypeScript. The mockup is the visual contract; these types
 * shape the payload that flows from a server component into the client
 * chart engine.
 */

/** One day of strategy or benchmark returns. `value` is a decimal return (not %). */
export type DailyReturn = { date: string; value: number };

/** One day of benchmark close prices (used for forward-fill alignment). */
export type DailyPrice = { date: string; close: number };

/**
 * Result of `compute()` — full per-series metrics matching the Python `S` / `B` dicts.
 *
 * `eq` and `dd` are the heavy arrays (length n). The PAYLOAD shape that crosses the
 * server→client boundary uses {@link ComputeSummary} (everything except those two
 * arrays) so we don't ship duplicated equity/drawdown series — they already live on
 * `FactsheetPayload.strategyEquity` / `strategyDrawdowns`.
 */
export type ComputeResult = {
  n: number;
  start: string;
  end: string;
  years: number;
  eq: number[];
  dd: number[];
  cum_ret: number;
  cagr: number;
  ann_vol: number;
  sharpe: number;
  sortino: number;
  calmar: number;
  max_dd: number;
  longest_dd: number;
  skew: number;
  kurt: number;
  // Period returns relative to the series' end date
  mtd: number;
  ytd: number;
  p3m: number;
  p6m: number;
  p1y: number;
  // Single-day extremes (compounded for non-day periods)
  best_day: number;
  worst_day: number;
  best_week: number;
  worst_week: number;
  best_month: number;
  worst_month: number;
  best_quarter: number;
  worst_quarter: number;
  best_year: number;
  worst_year: number;
  // Win/loss
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  profit_factor: number;
  // Tail risk
  var95: number;
  cvar95: number;
  // QuantStats canonical higher-order metrics
  /** cum_ret / |max_dd|. null when the series shows no drawdown (denominator = 0). */
  recovery_factor: number | null;
  /** mean(|drawdown|) — depth × duration. Always ≥ 0. */
  pain_index: number;
  /** sqrt(mean(drawdown²)). Always ≥ 0. */
  ulcer_index: number;
  /** P95(returns) / |P5(returns)|. null when P5 ≥ 0 (no left tail observed → ratio is meaningless). */
  tail_ratio: number | null;
  /** Σ gains / |Σ losses|. Identical to profit_factor at threshold=0 — duplicated under
   * this name because IC memos cite it. null when there are no losses. */
  omega_ratio: number | null;
  /** tail_ratio × profit_factor. null when either factor is null. */
  common_sense_ratio: number | null;
  // Yearly totals (year string → return) — used for Calmar-by-year table.
  yearly: Record<string, number>;
};

/** Compute result minus the heavy eq/dd arrays — used at server→client boundaries. */
export type ComputeSummary = Omit<ComputeResult, "eq" | "dd">;

/** Strategy-vs-comparator joint metrics (only meaningful when bench != null). */
export type JointMetrics = {
  alpha: number;
  beta: number;
  corr: number;
  r2: number;
  info_ratio: number;
  treynor: number;
  tracking_error: number;
  up_capture: number;
  down_capture: number;
};

/** One comparator slice consumed by the chart engine on picker swap. */
export type ComparatorBlock = {
  name: string;
  shortName: string;
  summary: Pick<ComputeResult,
    "cum_ret" | "cagr" | "ann_vol" | "sharpe" | "sortino" | "calmar" | "max_dd" | "longest_dd"
    | "mtd" | "ytd" | "p3m" | "p6m" | "p1y" | "win_rate" | "profit_factor"> | null;
  joint: JointMetrics | null;
  /** Comparator's own cumulative equity (strategy line stays in payload.strategyEquity). */
  cumulative: number[] | null;
  /** Strategy ÷ comparator (rebased to 1.0 at start). Only series in the cumVsBench chart. */
  cumVsBench: number[] | null;
  /** Comparator's own daily returns aligned to strategy dates. */
  dailyReturns: number[] | null;
  /** Comparator's own rolling 6mo annualized vol. Nulls during warmup. */
  rollingVol: Array<number | null> | null;
  /** Comparator's own rolling 6mo Sharpe. Nulls during warmup. */
  rollingSharpe: Array<number | null> | null;
  /** Comparator's own rolling 6mo Sortino. Nulls during warmup. */
  rollingSortino: Array<number | null> | null;
  /** Vol-matched bench equity: bench returns scaled to strategy's ann vol, then cumEq. */
  volMatched: number[] | null;
  /** Display label for the vol-matched series, e.g., "BTC × 0.10". */
  volMatchedLabel: string | null;
  /** Strategy ÷ bench rolling 90d β. Nulls during warmup. */
  rollingBeta: Array<number | null> | null;
};

/** Counts at lengths 1..14+ of consecutive winning / losing day streaks. */
export type StreakPayload = {
  winsByLength: number[];
  lossesByLength: number[];
  totalWins: number;
  totalLosses: number;
  longestWin: number;
  longestLoss: number;
  maxLen: number;
};

/** Per-year Calmar (year return / |year max DD|). */
export type CalmarYearPayload = {
  year: string;
  ret: number;
  max_dd: number;
  calmar: number;
  days: number;
};

/** Pre-aggregated histogram of bootstrap resamples for one metric. */
export type BootstrapMetricHist = { lo: number; hi: number; bins: number[]; degenerate?: boolean };

/** Block-bootstrap 95% CIs + resample-distribution histograms. */
export type BootstrapCIPayload = {
  sharpe: { point: number; lo: number; hi: number; hist: BootstrapMetricHist };
  sortino: { point: number; lo: number; hi: number; hist: BootstrapMetricHist };
  max_dd: { point: number; lo: number; hi: number; hist: BootstrapMetricHist };
  n_resamples: number;
  block_len: number;
};

/** Style-drift summary — strategy returns split 50/50 with KS test.
 *  Uses {@link ComputeSummary} (no eq/dd) — the Style Drift panel only reads
 *  scalar fields, so we don't ship two 500-length arrays per half to the client. */
export type StyleDriftPayload = {
  h1: ComputeSummary;
  h2: ComputeSummary;
  ksD: number;
  ksP: number;
};

/** Peer percentile summary — demo cohort + MM's percentile in each dimension. */
export type PeerPercentilePayload = {
  cohortSize: number;
  sharpe: number;
  sortino: number;
  max_dd: number;
};

/** Single demo allocator portfolio with precomputed sleeve + tail metrics. */
export type AllocatorPortfolioPayload = {
  key: string;
  name: string;
  composition: string;
  ann_vol: number;
  cum_ret: number;
  max_dd: number;
  corr: number;
  sleeve_pct: number;
  blend_vol: number;
  vol_target: number;
  tail_count: number;
  tail_mm_mean: number;
  tail_mm_median: number;
  tail_mm_pos: number;
};

/** One year of monthly compounded returns. byMonth has 12 slots (Jan..Dec); null = no obs. */
export type MonthlyReturnsRow = {
  year: string;
  byMonth: (number | null)[];
  ytd: number;
};

/** GitHub-contributions style grid for one calendar year of daily returns. */
export type DailyHeatmapYear = {
  year: string;
  /** 53 weeks × 7 weekdays (Mon..Sun). null when not a trading day. */
  cells: (number | null)[][];
  /** Weekday of Jan 1 (Mon=0..Sun=6) — needed to render month labels correctly. */
  firstWeekOffset: number;
};

/** Cross-asset correlation strip — one row per benchmark (ρ vs strategy daily returns). */
export type CorrelationRow = { name: string; rho: number };

/** One named market-stress window — strategy + benchmark behavior during it. */
export type StressWindow = {
  name: string;
  note: string;
  start: string;
  end: string;
  /** Actual observed trading days inside the window. */
  days: number;
  /** Catalogue's expected days — trading days (M–F) for equity/macro events,
   *  calendar days for crypto-only events (which trade 7d/wk). Held as a
   *  single field so the UI's `${days}/${expectedCalendarDays}` display reads
   *  honestly against the strategy's actual observation cadence. */
  expectedCalendarDays: number;
  /** "full" when actualDays/expectedCalendarDays ≥ 0.85, else "partial". */
  coverage: "full" | "partial";
  stratReturn: number;
  benchReturn: number;
  stratMaxDD: number;
  benchMaxDD: number;
};
export type StressWindowPayload = {
  windows: StressWindow[];
  benchName: string;
  /** Catalogue size relevant to the strategy's asset class (after market filter). */
  totalCatalogued: number;
  /** Catalogue windows dropped because they fell outside the observation window. */
  droppedOutOfRange: number;
  /** Catalogue windows dropped because coverage was too partial to label honestly. */
  droppedPartial: number;
};

/** Square pairwise correlation matrix across strategy + each benchmark. */
export type CorrelationMatrixPayload = {
  labels: string[];
  /** matrix[i][j] = ρ between labels[i] and labels[j]. Diagonal = 1.0. */
  matrix: number[][];
};

/** One aggregated signature trace — six 29-point series at offsets ±14d. */
export type EventSignature = {
  mean: number[];
  median: number[];
  p25: number[];
  p75: number[];
  p05: number[];
  p95: number[];
};

/** Per-horizon bundle: win/loss event populations × {benchmark, equity} views. */
export type EventSignaturesSet = {
  horizonDays: number;
  /** Events whose trace landed in the aggregation (i.e. had a full ±14d window). */
  winCount: number;
  lossCount: number;
  /** Total events that satisfied the win/loss predicate, including edge-dropped ones. */
  eligibleWinCount: number;
  eligibleLossCount: number;
  winOfBenchmark: EventSignature;
  lossOfBenchmark: EventSignature;
  winOfEquity: EventSignature;
  lossOfEquity: EventSignature;
};

export type EventSignaturesPayload = {
  h1: EventSignaturesSet;
  h7: EventSignaturesSet;
  windowDays: number;
};

/** Quantile box-plot summary — 5-number summary on daily returns (decimal). */
export type QuantilePayload = {
  p05: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  min: number;
  max: number;
  mean: number;
};

/** Trust-tier from strategy_verifications — drives the verification badge. */
export type TrustTierKind = "api_verified" | "csv_uploaded" | "self_reported";

/**
 * Result of picking a rolling-window tier for a given series length.
 *
 * `enough: false` means even the smallest tier in the candidate set
 * couldn't be filled — consumers should render a "Not enough data"
 * placeholder instead of an empty warmup band. `label` carries the
 * display suffix ("6mo" / "30d" / "90d") so chart titles can render
 * the actual window without re-deriving it from `window`.
 */
export type RollWindowPick = {
  window: number;
  label: string;
  enough: boolean;
};

/** Top-level payload built server-side and passed to the client view. */
export type FactsheetPayload = {
  strategyId: string;
  strategyName: string;
  strategyTypes: string[];
  markets: string[];
  computedAt: string;
  trustTier: TrustTierKind | null;
  /** Author-provided strategy description (registry row `strategies.description`). */
  description: string | null;
  /** Author-provided substrategy tags — e.g. ["basis_trade", "calendar_spread"]. */
  subtypes: string[];
  /** Exchanges the strategy is wired to (from registry `supported_exchanges`). */
  supportedExchanges: string[];
  /** Author-declared leverage band, free-text (e.g. "2x", "0-3x"). */
  leverageRange: string | null;
  /** Current AUM in USD, or null when undisclosed. */
  aum: number | null;
  /** Strategy's stated capacity ceiling in USD. */
  maxCapacity: number | null;
  /** Average daily turnover in USD — proxies strategy activity. */
  avgDailyTurnover: number | null;
  /** Live/track start date (registry row `start_date`), distinct from observation window. */
  startDate: string | null;
  /** Author-declared comparator ticker (registry row `benchmark`). */
  benchmark: string | null;
  dates: string[];
  /** Strategy daily returns (decimal). Used by daily-returns / vol-matched / rolling charts. */
  strategyReturns: number[];
  /** Strategy cumulative equity (running product of 1 + r), base 1.0. */
  strategyEquity: number[];
  /** Strategy rolling annualized vol over `rollingWindow.window` days. Nulls during warmup. */
  strategyRollingVol: Array<number | null>;
  /** Strategy rolling Sharpe over `rollingWindow.window` days. Nulls during warmup. */
  strategyRollingSharpe: Array<number | null>;
  /** Strategy rolling Sortino over `rollingWindow.window` days. Nulls during warmup. */
  strategyRollingSortino: Array<number | null>;
  /**
   * Effective rolling window used by `strategyRollingVol/Sharpe/Sortino`
   * (and the comparator equivalents). `window` is the lookback in trading
   * days, `label` is the display suffix appended to chart titles.
   * `enough` is false when even the smallest tier can't be filled — the
   * chart should render a "Not enough data" placeholder instead of a
   * flat warmup band.
   */
  rollingWindow: RollWindowPick;
  /** Same shape as `rollingWindow`, but for the Rolling β chart (90d → 30d). */
  rollingBetaWindow: RollWindowPick;
  /** Strategy drawdown from running peak (≤ 0). Drives the Underwater chart. */
  strategyDrawdowns: number[];
  /** Top-N worst drawdown periods, used by the Worst-DDs chart's shaded bands. */
  strategyWorst10: Array<{ start: number; trough: number; recover: number; depth: number }>;
  /** Headline scalar metrics. eq/dd live on strategyEquity / strategyDrawdowns — not duplicated here. */
  strategyMetrics: ComputeSummary;
  activeComparator: "btc" | "spx" | "none";
  comparators: {
    btc: ComparatorBlock;
    spx: ComparatorBlock;
    none: ComparatorBlock;
  };
  /** Batch D — style drift (real data, 50/50 split + KS test). */
  styleDrift: StyleDriftPayload | null;
  /** Batch D — peer percentile (synthesized demo cohort, badge in UI). */
  peerPercentile: PeerPercentilePayload;
  /** Batch D — allocator portfolio analysis (demo portfolios, badge in UI). */
  allocatorPortfolios: AllocatorPortfolioPayload[];
  /** Consecutive winning/losing day streaks. */
  streaks: StreakPayload;
  /** Per-year Calmar table. */
  calmarByYear: CalmarYearPayload[];
  /** Bootstrap CIs on the three headline ratios. */
  bootstrapCI: BootstrapCIPayload;
  /** Year × month compounded-returns matrix for the Monthly Returns heatmap. */
  monthlyReturns: MonthlyReturnsRow[];
  /** Per-year daily-return calendars for the Daily Returns heatmap. */
  dailyHeatmap: DailyHeatmapYear[];
  /** Strategy ρ vs each available benchmark — drives the correlation strip. */
  correlations: CorrelationRow[];
  /** Full pairwise correlation matrix across strategy + all benchmarks. */
  correlationMatrix: CorrelationMatrixPayload;
  /** Event-study signatures (1d and 7d horizons) driven by STRATEGY events. */
  eventSignatures: EventSignaturesPayload;
  /** Same shape, driven by BENCHMARK events — feeds the Cross Signatures overlay. */
  benchEventSignatures: EventSignaturesPayload;
  /** Strategy + benchmark behavior during named market-stress windows. */
  stressWindows: StressWindowPayload;
  /** Quantile box-plot summary on the strategy's daily-return distribution. */
  quantiles: QuantilePayload;
};
