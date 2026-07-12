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
 * bootstrapCI, styleDrift, stressWindows).
 *
 * EXCLUDES (stay top-level CASH by construction — the client merge passes them
 * through as cash with ZERO per-panel branching): correlations / correlationMatrix
 * (EXTERNAL-DATA — need BTC/ETH/SPX/Gold/IEF series with no MTM equivalent), and
 * strategyMetrics (the KpiStrip's persisted-scalar overlay owns MTM there, Phase
 * 102). stressWindows is the MIXED panel: its strategy columns follow MTM, its
 * BTC-benchmark column is basis-invariant BY CONSTRUCTION (the same BTC series
 * aligned to the MTM date axis — no new math, no cash-held-for-honesty).
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
  // All OPTIONAL + absent-by-default so single-key payloads stay byte-identical
  // (the object-spread over the discriminated union at page.tsx preserves the
  // `ingestSource` discriminant). Populated ONLY on the composite (csv-arm)
  // branch of the read path (page.tsx `fetchAndBuildPayload`).
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
   * FS-03 — persisted `metrics_json_by_basis`. `cash_settlement` is present on a
   * COMPOSITE payload (drives the D3 cash-scalar overlay onto `strategyMetrics` at
   * build-payload.ts:243) but ABSENT on a single-key options payload, which carries
   * ONLY `mark_to_market` (Phase 101/102 decision — the SC-4 keystone: with no
   * cash key the cash overlay is a no-op, so the cash headline stays byte-identical).
   * `mark_to_market` is OMITTED (never JSON null) when the venue/book can't produce
   * an MTM basis. Drives the KpiStrip/MetricsColumn basis relabel (D5).
   */
  metricsByBasis?: {
    cash_settlement?: Record<string, number>;
    mark_to_market?: Record<string, number>;
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
  };
  /** Phase 90.5 (LEV-01/D2): #597 annualization basis (365 crypto / 252 traditional) — enables the client leverage recompute. Optional: absent (stale v4 cache drain) => leverage control hidden, fail-closed. */
  periodsPerYear?: number;
  /**
   * Phase 103 (MTM-04) — per-basis series bundles keyed by basis. The cash
   * series stays TOP-LEVEL (the fields above), so this is ADDITIVE-ONLY:
   * absent when no persisted MTM series feeds the build → the object serializes
   * away and the cash payload is BYTE-IDENTICAL (SC-4). Present only
   * `mark_to_market` in Phase 103; the client (Plan 04) picks the active-basis
   * bundle via `useBasis()` and view-merges it over the cash top-level. External
   * panels (correlations/correlationMatrix) are NOT in the bundle, so the merge
   * passes them through as cash with zero per-panel branching.
   */
  seriesByBasis?: { mark_to_market?: BasisSeriesBundle };
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
