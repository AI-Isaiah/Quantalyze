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
 * Phase 169.5 BENCHCOMPARE (SC3, D-09, D-54) — the BTC comparator's prices as a
 * factsheet build used them: read from `benchmark_prices` (169.2's reader, merged
 * with the bundled fixture strictly before the DB's first stored date and trimmed
 * to the build's bounds), or the bundled fixture bounded the same way when no read
 * was made, or the unavailable marker when the read failed.
 */
export type BenchmarkPricesOpt =
  | { prices: DailyPrice[]; through: string | null; dropped: string[] }
  | { unavailable: true };

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
  /** NaN when the Sharpe does not exist (no dispersion, or a non-finite return);
   *  null after a JSON cache round-trip. Renders "—" (D7). */
  sharpe: number;
  sortino: number;
  calmar: number;
  max_dd: number;
  longest_dd: number;
  skew: number;
  kurt: number;
  // Period returns relative to the series' end date. Phase 169 D-11 (SC6): a
  // window is null when the record does not cover it (the first observation is
  // after the window's cutoff plus one day), never the whole-record return
  // under the window's label.
  mtd: number | null;
  ytd: number | null;
  p3m: number | null;
  p6m: number | null;
  p1y: number | null;
  /** 3 x 365 calendar days back from the series end (D-11). OPTIONAL only so a
   *  hand-built zeroed summary compiles unedited (D-21); `compute()` always
   *  sets it. A reader treats ABSENT like null (`== null`, D-17). */
  p3y?: number | null;
  /** 5 x 365 calendar days back from the series end (D-11). Optional for the
   *  same reason as `p3y`; `compute()` always sets it. */
  p5y?: number | null;
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

/** Strategy-vs-comparator joint metrics (only meaningful when bench != null).
 *  A ratio that does not exist (beta, corr, r2, info_ratio, treynor, alpha, or a
 *  capture ratio with no benchmark move to divide by) is NaN, or null after a
 *  JSON cache round-trip, and renders "—" (founder decision D7, 2026-09-26). */
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
  /**
   * 169.4 review round 2 (SFH-R2 MEDIUM-2): set when `joint` is null ONLY
   * because the record pairs fewer than `MIN_PAIRED_OBSERVATIONS` intervals with
   * this comparator (`paired` is that count). The KPI strip's alpha/IR cells and
   * §IV then read "—" beside `pairedFloorReason`, never a silent drop. Null on a
   * block whose joint was computed. `buildComparatorBlock` always sets it; the
   * none, unavailable and hand-built (scenario) blocks leave it absent, since
   * their null joint has another cause.
   */
  jointWithheld?: { paired: number; floor: number } | null;
  /**
   * Comparator's own cumulative equity (strategy line stays in payload.strategyEquity).
   * Phase 169.5-02 (SC3, D-09): null at an index the comparator has no return for,
   * so the chart breaks the line there.
   */
  cumulative: Array<number | null> | null;
  /** Strategy ÷ comparator (rebased to 1.0 at start). Only series in the cumVsBench chart. Null where `cumulative` is. */
  cumVsBench: Array<number | null> | null;
  /**
   * Comparator's own daily returns aligned to strategy dates.
   * Phase 169.5-04 (SC3, D-09, D-21): null at an index the comparator has no
   * return for, never 0, so no EoY figure or histogram overlay counts that day.
   */
  dailyReturns: Array<number | null> | null;
  /** Comparator's own rolling 6mo annualized vol. Nulls during warmup. */
  rollingVol: Array<number | null> | null;
  /** Comparator's own rolling 6mo Sharpe. Nulls during warmup. */
  rollingSharpe: Array<number | null> | null;
  /** Comparator's own rolling 6mo Sortino. Nulls during warmup. */
  rollingSortino: Array<number | null> | null;
  /** Vol-matched bench equity: bench returns scaled to strategy's ann vol, then cumEq. Null where `cumulative` is. */
  volMatched: Array<number | null> | null;
  /** Display label for the vol-matched series, e.g., "BTC × 0.10". */
  volMatchedLabel: string | null;
  /** Strategy ÷ bench rolling 90d β. Nulls during warmup. */
  rollingBeta: Array<number | null> | null;
  /**
   * Phase 169.5 (SC3, D-09): the comparator's last real close on or before the
   * strategy's last date; null in the unavailable form (with `summary` null).
   * OPTIONAL only so a hand-built block (the 167.1.2 scenario adapter) compiles
   * (169 D-21); `buildComparatorBlock` always sets it. Absent means "no coverage
   * information", distinct from the unavailable form.
   */
  through?: string | null;
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

/** Per-year Calmar (year return / |year max DD|); NaN (or null after a JSON cache) for a year with no drawdown (D7). */
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
  /** `n_valid`: the resamples that have the ratio (see `BootstrapCISummary`);
   *  absent on a payload cached before it existed, read as `n_resamples`. */
  sharpe: { point: number; lo: number; hi: number; hist: BootstrapMetricHist; n_valid?: number };
  sortino: { point: number; lo: number; hi: number; hist: BootstrapMetricHist; n_valid?: number };
  max_dd: { point: number; lo: number; hi: number; hist: BootstrapMetricHist };
  n_resamples: number;
  block_len: number;
  /** Phase 103 (MTM-04, Finding #6): the basis-selected observation count the
   *  resamples were drawn FROM — the low-N reliability gate reads THIS so an MTM
   *  bootstrap over a short MTM window warns even when cash clears 252. */
  n: number;
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
  /** NaN (null after a JSON round-trip) when the strategy has no Sharpe: no rank (D7). */
  sharpe: number;
  sortino: number;
  max_dd: number;
};

/**
 * Phase 42 (PEER-04, ADR-0025) — per-constituent mandate metadata for the
 * scenario BLEND. Built ONLY from genuinely-available `StrategyForBuilder`
 * fields (`strategy_types`, `markets`) + the per-constituent leverage from the
 * composer's `ScenarioState.leverage` (id → L; default 1.0). NO fabricated
 * aggregate single-strategy mandate, and NOT `leverage_range`/`description`
 * (those live on `FactsheetCommon`, free-text — out of v1.2.2 chip scope per
 * 42-UI-SPEC §2 / CONTEXT D-07). Honest-empty per constituent is the consumer's
 * job: a constituent with empty `strategy_types` AND `markets` renders
 * "no mandate metadata". Blend-only (a csv-arm carve-out, NOT FactsheetCommon).
 */
export type ScenarioMandatePayload = {
  constituents: Array<{
    name: string;
    /** Genuinely-available strategy classification chips (may be empty). */
    strategy_types: string[];
    /** Genuinely-available market chips (may be empty). */
    markets: string[];
    /** Per-constituent leverage multiplier (ScenarioState.leverage[id] ?? 1.0). */
    leverage: number;
  }>;
};

/**
 * Phase 42 (PEER-05, ADR-0025) — the scenario blend's head-to-head delta vs the
 * allocator's LIVE book. Each field is the blend's core ratio MINUS the live
 * book's ratio, BOTH computed on the SAME sample/252 basis (via
 * `sampleBasisRatios` on each leg's daily returns) so the comparison is
 * basis-consistent with the blend's ranking metrics and the peer cohort
 * (T-42-15). A signed difference is NOT P&L. Each ratio is null when its leg is
 * insufficient (e.g. a sub-2-obs book, or no down days for Sortino). Blend-only
 * (a csv-arm carve-out, NOT FactsheetCommon).
 */
export type OwnBookDeltaPayload = {
  /** blend_sharpe − book_sharpe (sample/252). null when either leg is null. */
  sharpe: number | null;
  /** blend_sortino − book_sortino (sample/252). null when either leg is null. */
  sortino: number | null;
  /** blend_max_dd − book_max_dd. Positive = blend shallower = better (sign INVERTED for color). */
  max_dd: number | null;
  /**
   * Observation count of the BLEND leg (the engine's overlap-window n). Disclosed
   * alongside `book_n` so the reader sees the two legs cover DIFFERENT windows —
   * the delta shares the sample/252 FORMULA but NOT necessarily the same calendar
   * window (WR-02 honesty fix). A larger gap = a coarser like-for-like.
   */
  blend_n: number;
  /** Observation count of the live book (for the basis note). */
  book_n: number;
};

/**
 * Single demo allocator portfolio with precomputed sleeve + tail metrics.
 * Phase 169.4 D-70(4): every measured figure is null when the blend has fewer
 * than 2 usable days on its legs' common calendar; the panel renders the em-dash
 * with a dated "prices through" caption, never a number.
 */
export type AllocatorPortfolioPayload = {
  key: string;
  name: string;
  composition: string;
  ann_vol: number | null;
  cum_ret: number | null;
  max_dd: number | null;
  /** NaN (null after a JSON round-trip) when the correlation is undefined (D7). */
  corr: number | null;
  sleeve_pct: number | null;
  blend_vol: number | null;
  vol_target: number;
  /** Null when nothing was measured, including tail_windows 0 (review round 2 WR-01): never a measured 0. */
  tail_count: number | null;
  /** Review SFH HIGH-2: the 21-date windows examined (every value priced); tail_count is out of these. */
  tail_windows: number | null;
  /** Null when tail_count is 0 (review WR-02): an empty set has no mean, median or share. */
  tail_mm_mean: number | null;
  tail_mm_median: number | null;
  tail_mm_pos: number | null;
  /** The last close every leg of the blend carries (D-70(4)); null when a leg has none. */
  through: string | null;
  /**
   * Review SFH MEDIUM-2: the leg whose price feed could not be read ("BTC" when
   * the BTC read failed), so the caption names the outage; null otherwise.
   */
  unavailable_leg: string | null;
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
  /** Null when any comparator day inside the window is uncovered (Phase 169.5
   *  CR-01, SC3: a gap is null, never 0) — the panel renders "—". */
  benchReturn: number | null;
  stratMaxDD: number;
  /** Null under the same rule as `benchReturn`. */
  benchMaxDD: number | null;
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

/**
 * Per-horizon bundle: win/loss event populations × {benchmark, equity} views.
 *
 * Phase 169.4 CR-01: each view is counted by its OWN traces. A benchmark null
 * (D-65, D-70(1)) drops a benchmark trace but not the equity trace of the same
 * event, so the two views can hold different populations; one shared count would
 * describe neither. A view with no trace at all is `null` (no aggregate), never
 * six all-zero series: a panel renders the em-dash state for it (DESIGN.md null
 * rule), not a flat 0% trajectory.
 */
export type EventSignaturesSet = {
  horizonDays: number;
  /** Equity-view traces aggregated (events with a full ±14d window on the event series). */
  winCount: number;
  lossCount: number;
  /** Benchmark-view traces aggregated (events whose ±14d benchmark window has no null). */
  benchWinCount: number;
  benchLossCount: number;
  /** Total events that satisfied the win/loss predicate, including edge-dropped ones. */
  eligibleWinCount: number;
  eligibleLossCount: number;
  /** Null when the view has no trace (`benchWinCount` / `benchLossCount` is 0). */
  winOfBenchmark: EventSignature | null;
  lossOfBenchmark: EventSignature | null;
  /** Null when the view has no trace (`winCount` / `lossCount` is 0). */
  winOfEquity: EventSignature | null;
  lossOfEquity: EventSignature | null;
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
 * Ingest source discriminator — whether the strategy's daily-return series
 * was ingested via live API trade data ("api") or uploaded as a CSV ("csv").
 *
 * This drives which analytical panels the factsheet renders: panels that
 * require fields not derivable from a daily-return series (PeerPercentile,
 * AllocatorPortfolios, event signatures) should be suppressed for CSV
 * strategies per the no-invented-data contract. (NEW-C20-01)
 */
export type IngestSource = "api" | "csv";

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

/**
 * Phase 103 (MTM-04) — a per-basis series bundle. Every field is a STRUCTURAL
 * CLONE of its {@link FactsheetCommon} sibling so a client view-merge
 * `{...payload, ...bundle}` stays well-typed and each panel that is a pure
 * function of the strategy's OWN daily-return series follows the active basis.
 *
 * Derived by `buildFactsheetPayload`'s internal `deriveSeriesBundle` from the
 * basis-selected `DailyReturn[]` — its OWN date axis + OWN gap mask (MTM gaps ≠
 * cash gaps: never overlay an MTM values array on the cash date axis, Pitfall-1).
 *
 * CARRIES: the three chart tracks (equity/drawdown/returns) + rolling + worst-10
 * + comparators (IN the bundle purely so the MTM axis and the comparator arrays
 * share ONE coherent date axis — Pitfall-1) + the two heatmap panels + EVERY
 * dailies-derivable statistics panel (quantiles, streaks, calmarByYear,
 * bootstrapCI, styleDrift, stressWindows) + correlations / correlationMatrix
 * (MTM-04 correction: NOT external — a correlation regresses the basis-selected
 * strategy leg against fixed benchmark INPUT series, so ρ follows the basis).
 *
 * EXCLUDES (stays top-level CASH by construction — the client merge passes it
 * through with ZERO per-panel branching): strategyMetrics (the KpiStrip's
 * persisted-scalar overlay owns MTM there, Phase 102 — the extended-distribution
 * scalars READ this bundle's own strategyMetrics via the view under MTM, but the
 * KpiStrip's seven persisted headline scalars stay overlay-owned). stressWindows
 * is the MIXED panel: its strategy columns follow MTM, its BTC-benchmark column is
 * basis-invariant BY CONSTRUCTION (the same BTC series aligned to the MTM date axis
 * — no new math, no cash-held-for-honesty). NOTE (carry-forward for the backbone
 * arc 104-106): the benchmark-family scalars (α/β/correlation) are OUTSIDE the
 * round-trip guarantee — re-deriving them from the persisted MTM rows ALONE needs
 * the benchmark series too (the persist conventions do not capture benchmark
 * identity).
 */
export type BasisSeriesBundle = {
  dates: string[];
  strategyReturns: number[];
  strategyEquity: number[];
  strategyDrawdowns: number[];
  strategyRollingVol: Array<number | null>;
  strategyRollingSharpe: Array<number | null>;
  strategyRollingSortino: Array<number | null>;
  rollingWindow: RollWindowPick;
  rollingBetaWindow: RollWindowPick;
  strategyWorst10: Array<{ start: number; trough: number; recover: number; depth: number }>;
  comparators: {
    btc: ComparatorBlock;
    spx: ComparatorBlock;
    none: ComparatorBlock;
  };
  monthlyReturns: MonthlyReturnsRow[];
  dailyHeatmap: DailyHeatmapYear[];
  /** Per-basis coverage mask — for MTM, derived from the persisted `gap_spans`
   *  (Python-owned, single implementation) via `deriveSegmentMarkers`. Optional
   *  so an absent mask serializes away (byte-identity discipline). */
  missingSegments?: { start: string; end: string; kind: "gap"; days: number }[];
  quantiles: QuantilePayload;
  streaks: StreakPayload;
  calmarByYear: CalmarYearPayload[];
  bootstrapCI: BootstrapCIPayload;
  styleDrift: StyleDriftPayload | null;
  stressWindows: StressWindowPayload;
  /** Phase 103 (MTM-04 follow-through, Finding A): the full scalar summary computed
   *  FROM this basis's daily series — the extended distribution scalars (skew /
   *  kurtosis / VaR / CVaR / omega / profit-factor / pain / ulcer / …) are pure
   *  functions of the dailies, so they follow the active basis via `view.
   *  strategyMetrics`. The seven persisted HEADLINE scalars are still owned by the
   *  KpiStrip (Phase-102 persisted overlay); this is the series-recomputed cache the
   *  extended-metrics panel reads. */
  strategyMetrics: ComputeSummary;
  /** Phase 103 (MTM-04, correction): strategy ρ vs each benchmark, derived per
   *  basis. The benchmark legs are fixed INPUT series but the strategy leg is the
   *  basis-selected dailies, so ρ follows cash→MTM (nothing bypasses the backbone). */
  correlations: CorrelationRow[];
  /** Phase 103 (MTM-04, correction): the full pairwise matrix, per basis (same
   *  rationale — the strategy row/column follows the basis). */
  correlationMatrix: CorrelationMatrixPayload;
};

/**
 * Fields shared by every factsheet payload regardless of ingest source.
 * The discriminated {@link FactsheetPayload} adds `ingestSource` plus the
 * api-only synthesized panels on top of this base.
 */
export type FactsheetCommon = {
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
  /** Strategy + benchmark behavior during named market-stress windows. */
  stressWindows: StressWindowPayload;
  /** Quantile box-plot summary on the strategy's daily-return distribution. */
  quantiles: QuantilePayload;

  // ---- Phase 90 (FS-01/FS-02/FS-03) composite marker + basis fields ----
  // All OPTIONAL + absent-by-default (the object-spread over the discriminated
  // union preserves the `ingestSource` discriminant). The segment markers are
  // composite-only; the basis fields (`metricsByBasis`, the gates, `dataQuality`)
  // are also set on the single-key arm (Phases 102/103/133 and 169), by
  // `composite-read-path.ts` `readSingleKeyBasisOpts` / `singleKeyDataQuality`.
  // On the factsheet route both arms are assembled by `fetch-and-build-payload.ts`
  // `fetchAndBuildPayload`; the discovery detail page still builds its own (169.1-01).
  /**
   * FS-01 — per-key handoff seams on the stitched equity track. One entry per
   * `data_quality_flags.per_key[]` with `seq > 1` (seq 1 = inception, NOT a
   * seam); `date` is that key's `first_day`, `label` the display seq.
   */
  segmentBoundaries?: { date: string; seq: number; label: string }[];
  /**
   * FS-02 — data-gap spans (from `data_quality_flags.gap_spans`), never
   * zero-filled and excluded from compounding by construction (the sparse
   * series never contains gap days). `days` is INCLUSIVE both ends. `kind` is
   * `"gap"` only for v1.9 (`"pre-rollout"` deferred per CONTEXT open-item 2).
   */
  missingSegments?: { start: string; end: string; kind: "gap"; days: number }[];
  /**
   * FS-03 — persisted per-basis headline scalars. `cash_settlement` drives the D3
   * cash-scalar overlay onto `strategyMetrics` (build-payload.ts). It is present on
   * a COMPOSITE payload (the stitch's persisted `metrics_json_by_basis` object) and,
   * since Phase 169 (D-10, SC4), on a RANKABLE single-key payload, where
   * `readSingleKeyBasisOpts` builds it from the row's persisted top-level
   * `strategy_analytics` scalars so the page reads the value the lists show. A
   * single-key row's RAW `metrics_json_by_basis.cash_settlement` is still never
   * threaded (the Phase 101/102 SC-4 keystone). Absent on a row that is not
   * rankable. `mark_to_market` is OMITTED (never JSON null) when the venue/book
   * can't produce an MTM basis. Drives the KpiStrip/MetricsColumn basis relabel (D5).
   */
  metricsByBasis?: {
    // Review round 1 (IN-02): each basis is `number | null`. Python's
    // `_safe_float` persists JSON null for a scalar that does not exist (a
    // Sortino with no losing day, a Calmar with no drawdown), and the single-key
    // cash headline carries the stored null through. Every reader checks
    // `typeof v === "number" && Number.isFinite(v)` (the strict overlay renders
    // anything else "—"); never do arithmetic on a value without that check.
    cash_settlement?: Record<string, number | null>;
    mark_to_market?: Record<string, number | null>;
    /**
     * Phase 132/133 (SMTM-01) — the smoothed daily-mark basis. SAME omission
     * contract as `mark_to_market`: present ONLY when the Phase-132 worker's
     * smoothed pass completed on an options-activity book (absent, never JSON
     * null, otherwise). Drives the third SegmentedControl segment + KpiStrip
     * overlay.
     */
    smoothed_mtm?: Record<string, number | null>;
  };
  /**
   * FS-03 — server-truth MTM gate (D1). `available` = the `mark_to_market` key
   * is present in `metrics_json_by_basis`; `reason` is the mapped disabled-copy
   * key from `data_quality_flags.mtm_gated_reason` (closed set + string
   * fallback for the generic-copy case).
   */
  mtmGate?: {
    available: boolean;
    reason?: "unsmoothed_options_book" | "mtm_basis_unavailable_for_venue" | string;
  };
  /**
   * Phase 133 (SMTM-01) — server-truth SMOOTHED gate, the sibling of {@link mtmGate}.
   * `available` = the `smoothed_mtm` key is present in `metrics_json_by_basis` with a
   * trustworthy headline. There is NO persisted smoothed-reason column (the worker
   * only persists the smoothed key on a completed options pass), so the disabled
   * `reason` is a single closed-set default — `"smoothed_basis_unavailable"`
   * ("not yet computed / marks missing / non-options book") — never a bare
   * per-row string invention. `smoothedDisabledReasonCopy` maps it to honest copy.
   */
  smoothedGate?: {
    available: boolean;
    reason?: "smoothed_basis_unavailable" | string;
  };
  /**
   * Server-truth composite discriminator (`data_quality_flags.composite`).
   * HARD-04 (#67): `insufficientWindow` flags a sub-90-calendar-day
   * annualization window (CAGR-site DQ annotation). Optional — pre-existing
   * cached payloads lack it, so readers MUST treat absent as false.
   * HARD-05 (Phase 93): `degradedMembers` lists composite members EXCLUDED from
   * the stitch (a ccxt venue not yet reconstructed) with honest zero coverage —
   * a closed `{seq, venue}` shape (the server `reason` enum is dropped as
   * server-only vocabulary). Absent/empty => nothing renders.
   */
  dataQuality?: {
    composite: boolean;
    insufficientWindow?: boolean;
    degradedMembers?: Array<{ seq: number; venue: string }>;
    /**
     * Phase 169 review round 1 (SFH H-1) — single-key only, present only when
     * true: `data_quality_flags.twr_chain_broken`, an INTERIOR chain break. The
     * stored `cumulative_return` and CAGR then compound only the stretch after
     * the last break, while the chart, the return windows and Years Observed
     * cover the whole series. The headline stays the stored value (D-25, SC4);
     * the page must say which span it covers.
     */
    twrChainBroken?: boolean;
    /**
     * Phase 169 review round 1 (SFH H-1) — present only on a chain-broken row
     * whose persisted cash headline is overlaid: the first day (ISO date) of the
     * span that headline covers, read from the stored `cash_settlement` series
     * row (`deriveHeadlineCoversFrom`). `null` when the stored data cannot name
     * it: a reader must then say the headline covers part of the record without
     * a date, never invent one.
     */
    headlineCoversFrom?: string | null;
    /**
     * Phase 169 review round 1 (SFH M-2) — single-key only, present only when
     * true: the stored headline was computed under a `returns_denominator_config`
     * TypeScript does not reproduce (`cumulative_method: "simple"`, or
     * `metrics_basis: "active_day"`). The client leverage re-derive cannot
     * continue it from L=1, so `leverageEligibleFor` withholds the what-if.
     */
    returnsConventionOverride?: boolean;
    /**
     * Phase 164.6.6.2 (D-25, founder 2026-10-08) — single-key only, present only
     * when true: `data_quality_flags.small_base_measured`. At least one MEASURED day
     * started from a balance under the unit's material equity (BTC 1e-4), so its
     * return is exact but can be extreme. INFORMATIONAL: the day is kept, the chain
     * is not broken, and the row is not a warning. The factsheet says so beside the
     * other data-quality caveats.
     */
    smallBaseMeasured?: boolean;
  };
  /** Phase 90.5 (LEV-01/D2): #597 annualization basis (365 crypto / 252 traditional) — enables the client leverage recompute. Optional: absent (stale v4 cache drain) => leverage control hidden, fail-closed. */
  periodsPerYear?: number;
  /**
   * Phase 169.1 (D-27 as amended, D-28) — the strategy's compounding method as
   * the engine computed it, resolved by the read path (the persisted
   * `data_quality_flags.cumulative_method`, then the frozen `cash_settlement`
   * conventions, then the config). Present ONLY when "arithmetic"; absent means
   * geometric, so a geometric payload is byte-identical (D-83 (b)). Consumed by
   * the browser re-derive arms (`rederiveArgs` in basis-context.tsx).
   */
  cumulativeMethod?: "geometric" | "arithmetic";
  /**
   * Phase 164.6.6.2 (D-08, D-09) — the unit this strategy's returns are measured
   * in, when it is not USD ("BTC" for an account denominated in BTC). Parsed once
   * in `buildFromResolved` from `strategy_analytics.data_quality_flags.native_unit`
   * through `parseReturnsUnit`; every surface reads THIS field and none reads the
   * `api_keys` row, so the masthead chip, the labels and the share card cannot
   * disagree. Absent for a USD-family strategy (a conditional spread, so the key
   * is not there at all and a USD payload is byte-identical).
   */
  returnsUnit?: string;
  /**
   * Phase 164.6.6.2.1 (D-15, D-19) — the native unit this payload's returns were
   * CONVERTED from. Present ONLY on the USD-view payload (`usdView.payload`) of a
   * native-unit strategy; panels read it for the per-view withholding reason
   * ("returns are converted from BTC"). The masthead never reads it. Absent for a
   * USD strategy and for the native payload, so those payloads are byte-identical.
   */
  convertedFrom?: string;
  /**
   * Phase 164.6.6.2.1 (D-06) — the USD view of a native-unit strategy, built
   * server-side next to the native payload. Absent for a USD strategy (a
   * conditional spread, so the key is not there at all and a USD payload is
   * byte-identical) and for a native strategy whose USD view could not be built
   * (see {@link usdViewUnavailable}).
   */
  usdView?: FactsheetUsdView;
  /**
   * Phase 164.6.6.2.1 (D-22) — why a native strategy has no {@link usdView}:
   * the price read failed, or no day had a stored close. Present only for a
   * native strategy whose USD view could not be built; absent otherwise, so a
   * USD payload stays byte-identical.
   */
  usdViewUnavailable?: "price_read_failed" | "no_priced_day";
  /**
   * Phase 170.2 (SC-4, D-09) — `strategies.source`, present ONLY when it is
   * `"csv"` (a conditional spread: any other source leaves the key out, so a
   * non-CSV payload is byte-identical). The masthead venue label keys on this.
   * It is NOT `ingestSource`, which is derived from `strategy_analytics.daily_returns`
   * (NULL on every PROD strategy, so "api") and is forced to "csv" for composites.
   * Optional so fixtures that spell out the common fields keep type-checking.
   */
  source?: "csv";
  /**
   * Phase 169.1 (D-30) — the strategy's day basis as the engine computed it,
   * resolved by the same read path. Present ONLY when "active" (vol, Sharpe and
   * Sortino over the non-zero days); absent means calendar, so a calendar
   * payload is byte-identical (D-83 (b)). Consumed by the browser re-derive arms.
   */
  dayBasis?: "calendar" | "active";
  /**
   * Phase 103 (MTM-04) — per-basis series bundles keyed by basis. The cash
   * series stays TOP-LEVEL (the fields above), so this is ADDITIVE-ONLY:
   * absent when no persisted MTM series feeds the build → the object serializes
   * away and the cash payload is BYTE-IDENTICAL (SC-4). Present only
   * `mark_to_market` in Phase 103; the client (Plan 04) picks the active-basis
   * bundle via `useBasis()` and view-merges it over the cash top-level. The bundle
   * carries EVERY dailies-derivable panel INCLUDING correlations / correlationMatrix
   * (MTM-04 correction — the strategy leg regresses the basis-selected dailies, so ρ
   * follows the basis; see {@link BasisSeriesBundle}). The KpiStrip's seven persisted
   * headline scalars are the only surface the merge does NOT own (Phase 102).
   */
  seriesByBasis?: {
    mark_to_market?: BasisSeriesBundle;
    /**
     * Phase 132/133 (SMTM-01) — the persisted smoothed daily-mark series bundle
     * (kind `smoothed_mtm_daily_returns`), derived by the SAME `deriveSeriesBundle`
     * as cash/MTM with its OWN axis + coverage mask. Additive-only: absent → the
     * cash/MTM payload is byte-identical (SC-4). The client view-merge
     * (`useBasisSeriesView`) swaps to this bundle under the `smoothed_mtm` basis.
     */
    smoothed_mtm?: BasisSeriesBundle;
  };
  /**
   * Phase 169.5 (SC3, D-09, D-21, D-54) — the bounded BTC series this payload's
   * comparators were computed from (or the unavailable marker), so the browser
   * re-derive (`useBasisSeriesView`, leverage) aligns BTC from the same closes and
   * the same `dropped` list as the server. OPTIONAL only so a hand-built payload
   * (the 167.1.2 scenario adapter) compiles unedited; both builders always set
   * it. Absent means "no coverage information", and the re-derive then treats BTC
   * as unavailable, never as the bundled fixture.
   */
  benchmarkPrices?: BenchmarkPricesOpt;
};

/**
 * Synthesized / demo analytical panels NOT derivable from a bare daily-return
 * series — peer cohort, allocator portfolios, event-study signatures. Per the
 * no-invented-data contract (NEW-C20-01, RED-TEAM-M2/M3, B6) these exist ONLY
 * on the "api" arm: for csv-ingested strategies they are ABSENT from the
 * payload entirely (never serialized into the RSC blob), so a consumer cannot
 * read them without first narrowing `ingestSource === "api"`, and a future
 * synthesized panel added here physically cannot render for a CSV strategy.
 */
export type FactsheetApiPayload = FactsheetCommon & {
  ingestSource: "api";
  /** Peer percentile (synthesized demo cohort). null when the cohort can't be computed. */
  peerPercentile: PeerPercentilePayload | null;
  /** Allocator portfolio analysis (demo portfolios). */
  allocatorPortfolios: AllocatorPortfolioPayload[] | null;
  /** Event-study signatures (1d + 7d horizons) driven by STRATEGY events. */
  eventSignatures: EventSignaturesPayload | null;
  /** Same shape, driven by BENCHMARK events — feeds the Cross Signatures overlay. */
  benchEventSignatures: EventSignaturesPayload | null;
};

/**
 * The csv arm: a strategy whose daily-return series was uploaded as a CSV.
 * The synthesized api-only panels are absent by construction (no-invented-data).
 */
export type FactsheetCsvPayload = FactsheetCommon & {
  ingestSource: "csv";
  /**
   * Phase 42 (PEER-01, ADR-0025) — blend-only peer rank vs the REAL verified
   * strategy universe, computed on the cohort's SAMPLE / 252 basis (the Python
   * `strategy_analytics` quantstats convention), NOT the population headline.
   *
   * Additive + optional: absent on every existing csv call site (the real
   * factsheet route, Discovery, Overview, and the Phase-39 scenario synth
   * payload), so the api path + the three genuinely-synthetic panels'
   * structural absence are provably unchanged. This is a DIFFERENT field name
   * from the api arm's `peerPercentile`, so the type-field invariant (the four
   * api-only fields never on the csv arm) is preserved.
   *
   * Blend-scoped by design — NOT promoted to {@link FactsheetCommon} (ADR §6):
   * peer-on-all-csv is out of scope for v1.2.2.
   */
  scenarioPeer?: PeerPercentilePayload;
  /**
   * Phase 42 (PEER-04, ADR-0025) — per-constituent mandate chips for the blend
   * (strategy_types + markets + per-constituent leverage). Additive + optional:
   * absent on every existing csv call site (the key is OMITTED, not undefined),
   * so the payload stays byte-identical and the api arm + the type-field
   * invariant (the four api-only fields never on csv) are unchanged. Blend-only.
   */
  scenarioMandate?: ScenarioMandatePayload;
  /**
   * Phase 42 (PEER-05, ADR-0025) — the blend-vs-live-book signed delta on the
   * SAME sample/252 basis as the peer rank. Additive + optional: omitted on
   * every existing csv call site (byte-identical payload) AND silently absent
   * when the allocator has no live book. Blend-only.
   */
  scenarioOwnBookDelta?: OwnBookDeltaPayload;
};

/**
 * Top-level payload built server-side and passed to the client view.
 *
 * Discriminated on {@link IngestSource}: "api" = live-ingested trade data
 * (carries the synthesized demo panels); "csv" = user-uploaded daily-return CSV
 * (synthesized panels absent). Drives panel-gating in the view so non-derivable
 * panels (PeerPercentile, AllocatorPortfolios, event signatures) are
 * unrepresentable for CSV strategies by construction. (NEW-C20-01, B6)
 */
export type FactsheetPayload = FactsheetApiPayload | FactsheetCsvPayload;

/**
 * Phase 164.6.6.2.1 (D-06, D-22; UI-SPEC B and C) — the USD view of a
 * native-unit strategy. Hangs off the native payload as `usdView`; absent for a
 * USD strategy, so a USD payload is byte-identical.
 */
export interface FactsheetUsdView {
  /** The factsheet payload recomputed on the USD-converted series. */
  payload: FactsheetPayload;
  /** The native unit the returns were converted from ("BTC"); parsed at the boundary. */
  convertedFrom: string;
  /** First date of the USD series (ISO day, UTC). */
  usdStart: string;
  /** Last date of the USD series (ISO day, UTC). */
  usdEnd: string;
  /**
   * True when the USD series starts later than the native series' SECOND date,
   * i.e. leading days had no stored close (UI-SPEC C curve break).
   */
  leadingHole: boolean;
  /** Interior calendar days (ISO, UTC) with no stored close (UI-SPEC B disclosure). */
  unpricedDays: string[];
  /**
   * `{k}` of UI-SPEC B: the count of native return days absent from the USD
   * series because their pairing interval contains an unpriced day (interior only).
   */
  removedReturns: number;
}
