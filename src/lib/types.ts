import { z } from "zod";
import type { AlertSeverity, DocType, SupportedExchange } from "./utils";

// ---------------------------------------------------------------------------
// audit-2026-05-07 H-0517 — branded identifier vocabulary
//
// SEC-005 was the canonical class: a strategies row's `api_key_id` could
// point at another user's key, but the TS type system would let any
// string from any source flow into the field. The SQL trigger added in
// migration 028 catches this at the DB boundary; branded id types make
// the same invariant visible to the compiler — code that mixes ids of
// different owning entities becomes a type error.
//
// USAGE NOTES (current rollout = type vocabulary only):
//   - The branded aliases are EXPORTED so new code can opt into the
//     invariant. The existing interface fields below still type these
//     ids as `string` to keep the broader codebase compiling without a
//     cross-cutting cast-everywhere refactor. Callers reading rows from
//     Supabase can stamp the brand via the `cast*Id()` helpers below.
//   - When the codebase migrates to branded ids at the DTO/cast boundary
//     in a follow-up PR, the interface fields below will be retyped and
//     the cascading call-site fixes happen at once.
//   - Cross-tenant assignments (e.g. assigning an `ApiKeyId` belonging
//     to user B into `Strategy.api_key_id` of user A) are not yet
//     statically impossible — the SQL trigger remains the load-bearing
//     check. The brand makes the intent EXPRESSIBLE; full enforcement is
//     a deliberate next step.
// ---------------------------------------------------------------------------
export type UserId = string & { readonly __brand: "UserId" };
export type ApiKeyId = string & { readonly __brand: "ApiKeyId" };
export type StrategyId = string & { readonly __brand: "StrategyId" };
export type PortfolioId = string & { readonly __brand: "PortfolioId" };
export type TenantId = string & { readonly __brand: "TenantId" };

/**
 * Cast a raw string (e.g. fresh out of Supabase, validated by `isUuid`)
 * to a branded id. There is no runtime check — callers are expected to
 * have validated the string at the source. The brand is a discipline
 * marker: it says "this string came from the row of THIS entity".
 *
 * Anti-pattern: passing a `UserId` into a place that wants `ApiKeyId`.
 * The branded types make this a compile error at the point of misuse.
 */
export const castUserId = (s: string): UserId => s as UserId;
export const castApiKeyId = (s: string): ApiKeyId => s as ApiKeyId;
export const castStrategyId = (s: string): StrategyId => s as StrategyId;
export const castPortfolioId = (s: string): PortfolioId => s as PortfolioId;
export const castTenantId = (s: string): TenantId => s as TenantId;

// ---------------------------------------------------------------------------
// audit-2026-05-07 H-0514 / H-0515 / H-0516 / M-0580 / M-0584 — unit vocabulary
//
// The v0.17.1 KPI-17 saga (PRs #95-100) was caused by this exact drift:
// Python returned percent-scaled, TS multiplied by 100 again, allocators
// saw 5500%. The root cause was that every numeric metric — fraction
// (0.05), percent (5.0), unitless ratio (0.5), score (5), days, hours,
// seconds, USD — flowed through the same bare `number` type.
//
// File-wide UNIT CONTRACT (binding for new code, normative for review):
//   - Every field whose name ends in `_pct` is a FRACTION in [0,1] (0.05 = 5%).
//   - Every field whose name ends in `_days`, `_seconds`, `_hours`,
//     `_minutes` is the named unit. No conversion at field level.
//   - Every field whose name ends in `_usd` or `_usdt` is a money quantity
//     in the named denomination (USD ≠ USDT for the purposes of math).
//   - `risk_reward_ratio` / `profit_factor*` / `payoff_ratio` are
//     UNITLESS RATIOS (0.5 means 0.5×, not 50%).
//   - `sqn` is a SCORE (System Quality Number, 0-7 typical range).
//   - `expectancy` is a FRACTION (per-trade expected return as a fraction
//     of risked capital).
//
// Branded aliases are exported so new code can express intent at types.
// Existing interface fields remain `number` for the same reason as the
// branded ids above — full migration is a deliberate cross-cutting PR,
// not a sneak-in. New writers should reach for the branded alias when
// adding fields.
//
// PRECISION FOOTNOTE (H-0515): USD-denominated NUMERIC columns lose
// precision through JSON.parse → IEEE-754 for values > 2^53 (~$9
// quadrillion). For realistic hedge-fund AUMs (< $10B) the float
// representation is exact at cent boundaries. Branded `Usd` / `Usdt`
// stays a `number` to match the wire shape; future Decimal migration
// would change the brand's underlying type, not the field name.
// ---------------------------------------------------------------------------
export type Fraction = number & { readonly __unit: "Fraction" };
export type Ratio = number & { readonly __unit: "Ratio" };
export type Score = number & { readonly __unit: "Score" };
export type Days = number & { readonly __unit: "Days" };
export type Hours = number & { readonly __unit: "Hours" };
export type Seconds = number & { readonly __unit: "Seconds" };
export type Usd = number & { readonly __unit: "Usd" };
export type Usdt = number & { readonly __unit: "Usdt" };

/**
 * Unit-stamping helpers. As with `castUserId`, these are vocabulary
 * markers — no runtime check, no conversion. The whole point is to
 * make the unit visible in code review and type errors.
 */
export const asFraction = (n: number): Fraction => n as Fraction;
export const asRatio = (n: number): Ratio => n as Ratio;
export const asScore = (n: number): Score => n as Score;
export const asDays = (n: number): Days => n as Days;
export const asHours = (n: number): Hours => n as Hours;
export const asSeconds = (n: number): Seconds => n as Seconds;
export const asUsd = (n: number): Usd => n as Usd;
export const asUsdt = (n: number): Usdt => n as Usdt;

export type Role = "manager" | "allocator" | "both";

export const ROLES: { value: Role; label: string; description: string }[] = [
  { value: "manager", label: "Asset Manager", description: "Publish strategies with verified exchange data" },
  { value: "allocator", label: "Allocator", description: "Discover, compare, and connect with managers" },
  { value: "both", label: "Both", description: "Manage strategies and discover others" },
];

export interface Profile {
  id: string;
  display_name: string;
  company: string | null;
  description: string | null;
  email: string | null;
  telegram: string | null;
  website: string | null;
  linkedin: string | null;
  avatar_url: string | null;
  role: Role;
  manager_status: "newbie" | "pending" | "verified";
  allocator_status: "newbie" | "pending" | "verified";
  created_at: string;
  /**
   * Added in migration 016. Optional tag scoping this profile to a partner
   * pilot. NULL = native Quantalyze user; any string = member of that pilot.
   * Set by /api/admin/partner-import.
   */
  partner_tag?: string | null;
}

export type DisclosureTier = "institutional" | "exploratory";

export interface Strategy {
  id: string;
  user_id: string;
  category_id: string | null;
  api_key_id: string | null;
  name: string;
  description: string | null;
  strategy_types: string[];
  subtypes: string[];
  markets: string[];
  supported_exchanges: string[];
  leverage_range: string | null;
  avg_daily_turnover: number | null;
  aum: number | null;
  max_capacity: number | null;
  start_date: string | null;
  status: "draft" | "pending_review" | "published" | "archived";
  is_example: boolean;
  benchmark: string;
  created_at: string;
  /** Added in migration 012. "exploratory" is the safe default for legacy rows. */
  disclosure_tier?: DisclosureTier;
  /**
   * Added in migration 014. Pseudonym displayed for exploratory-tier strategies.
   * When set, `displayStrategyName()` returns this instead of `name` regardless
   * of tier, so managers can opt into a codename even on institutional tier.
   */
  codename?: string | null;
  /** Optional relay email on the strategy itself. Nullable; falls back to manager profile email. */
  public_contact_email?: string | null;
  /** Nullable for whitelabel v1 (migration 012). Null means the default Quantalyze tenant. */
  tenant_id?: string | null;
  /**
   * Added in migration 016. Optional tag scoping this strategy to a partner
   * pilot. Set by /api/admin/partner-import.
   */
  partner_tag?: string | null;
  /**
   * Phase 15 / CSV-03: trust-tier label for the strategy. Joined from
   * strategy_verifications.trust_tier in getStrategyDetail() and
   * getStrategiesByCategory(); NOT a column on the strategies table per
   * locked decision D-04 (no denormalization). Optional/nullable because
   * a strategy without any verification row has no trust tier.
   * Phase 17 / DESIGN-01 polishes the visual; the data wiring is final here.
   */
  trust_tier?: "api_verified" | "csv_uploaded" | "self_reported" | null;
}

/**
 * Subset of the manager's profile used for display on institutional-tier
 * strategies. Exploratory-tier strategies receive a redacted version with
 * everything but the codename nulled out — see `getStrategyDetail()`.
 */
export interface ManagerIdentity {
  display_name: string | null;
  company: string | null;
  bio: string | null;
  years_trading: number | null;
  aum_range: string | null;
  linkedin: string | null;
}

/**
 * audit-2026-05-07 M-0582: typed envelope for `strategy_analytics.metrics_json`.
 *
 * The column is JSONB and catches every derived metric series whose shape
 * varies (rolling correlations, drawdown episodes, risk of ruin, trade
 * mix). The interface enumerates the known key NAMES so a typo (e.g.
 * `bencmark_returns`) is a compile error. Values stay `unknown` because
 * the JSONB source can legitimately ship a malformed payload — every
 * consumer (PerformanceReport, WorstDrawdowns, CorrelationWithBenchmark)
 * keeps its existing `isCorrelationPointArray` / `isServerEpisode`
 * runtime predicate; the type-level promise is "this key name is part
 * of the contract", not "this value is well-shaped".
 *
 * JSDoc on each known key documents the EXPECTED shape that the
 * runtime predicate should accept; the index signature retains
 * forward-compat for analytics-service additions that don't yet have
 * a UI consumer.
 */
// audit-2026-05-07 type-design HIGH (red-team apply): the prior JSDoc on
// this interface claimed "a typo (e.g. `bencmark_returns`) is a compile
// error". That was a LIE in practice: the `[key: string]: unknown` index
// signature accepts every string key, so `metrics.bencmark_returns` types
// as `unknown` instead of erroring, AND consumers like
// `src/components/strategy/MetricPanel.tsx` cast through
// `Record<string, number>` to access ~25-30 scalar metric keys that this
// interface doesn't enumerate. Removing the index signature would break
// those consumers (and the type would still under-promise without all
// scalar keys enumerated). The honest fix is to correct the JSDoc to
// match what the index signature actually delivers: forward-compat for
// arbitrary keys, with NO typo protection at the type level. Consumers
// that want typo protection should reach for the dedicated scalar
// accessors / Zod schemas, not this catch-all envelope.
export interface MetricsJson {
  /** Expected: TimeSeriesPoint[]. Per-strategy benchmark daily returns. */
  benchmark_returns?: unknown;
  /** Expected: TimeSeriesPoint[]. Benchmark returns keyed for BTC overlay. */
  btc_benchmark_returns?: unknown;
  /** Expected: TimeSeriesPoint[]. Rolling 90d correlation series vs BTC. */
  btc_rolling_correlation_90d?: unknown;
  /** Expected: array of {start, end, depth, recovery}. */
  drawdown_episodes?: unknown;
  /** Expected: { loss_pct: number; probability: number }[]. */
  risk_of_ruin?: unknown;
  /** Expected: TradeMixBuckets. (Also surfaced via TradeMetrics.trade_mix.) */
  trade_mix?: unknown;
  /** Expected: number. Authoritative history length (days). */
  history_days?: unknown;
  /**
   * Catch-all for the many scalar metrics emitted by analytics-service
   * (var_1d_95, mtd, ytd, alpha, beta, info_ratio, omega, skewness,
   * profit_factor, etc.). The runtime carries dozens of named scalars
   * read via `Record<string, number>` casts in consumers like
   * `MetricPanel.tsx`. The index signature is a deliberate trade-off:
   * NO typo protection at the type level, but no churn in the ~30
   * consumer sites that already cast through it.
   *
   * If you need typo protection for a specific scalar, add a typed
   * accessor (or a Zod schema slice) — do NOT rely on this interface.
   */
  [key: string]: unknown;
}

export interface StrategyAnalytics {
  id: string;
  strategy_id: string;
  computed_at: string;
  computation_status: "pending" | "computing" | "complete" | "complete_with_warnings" | "failed";
  computation_error: string | null;
  benchmark: string | null;
  cumulative_return: number | null;
  cagr: number | null;
  volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  max_drawdown: number | null;
  max_drawdown_duration_days: number | null;
  six_month_return: number | null;
  sparkline_returns: number[] | null;
  sparkline_drawdown: number[] | null;
  /**
   * audit-2026-05-07 M-0582: typed envelope for the catch-all metrics blob.
   * Known keys are documented on `MetricsJson`; the index signature retains
   * forward-compat (analytics writer can add fields without breaking the
   * type) — but that index signature also means typos on UNKNOWN keys are
   * NOT a compile error. See MetricsJson's JSDoc for the trade-off.
   * Consumers reading well-known keys (`benchmark_returns`,
   * `btc_rolling_correlation_90d`, `drawdown_episodes`, `risk_of_ruin`,
   * `trade_mix`) get `unknown` typed values they still need to validate.
   */
  metrics_json: MetricsJson | null;
  returns_series: { date: string; value: number }[] | null;
  drawdown_series: { date: string; value: number }[] | null;
  monthly_returns: Record<string, Record<string, number>> | null;
  daily_returns: Record<string, Record<string, number>> | null;
  rolling_metrics: Record<string, { date: string; value: number }[]> | null;
  return_quantiles: Record<string, number[]> | null;
  trade_metrics: TradeMetrics | null;
  volume_metrics: VolumeMetrics | null;
  exposure_metrics: ExposureMetrics | null;
  data_quality_flags: AnalyticsDataQualityFlags | null;
}

/**
 * Mirrors the keys that `analytics-service/services/analytics_runner.py`
 * writes into `strategy_analytics.data_quality_flags`. Every key is optional
 * because each flag is independent: a strategy can have any subset of these
 * conditions, or none. The Python writer ONLY sets a flag when its
 * condition fires (no `false` writes), so consumers should treat absence
 * as "fine" and presence-with-truthy-value as "degraded".
 *
 * Most flags signal a degraded computation (presence ⇒ warn the
 * operator). One flag — `no_linked_api_key` — signals INHERENT
 * demo/paper state, not degradation. The UI surfaces it with neutral
 * copy ("Demo strategy") rather than the warning amber chip used for
 * the others.
 *
 * Adding a new flag here without a matching consumer surface is a smell —
 * unread flags hide degraded states from allocators. See
 * src/components/strategy/VolumeExposureTab.tsx and
 * src/components/strategy-v2/TradeAndPositionPanel.tsx for current surfaces.
 */
export interface AnalyticsDataQualityFlags {
  /**
   * Phase 19.1 — present (and true) when the strategy_analytics row was
   * produced by `run_csv_strategy_analytics`, i.e. the CSV → analytics
   * pipeline. CSV-sourced runs route directly through `compute_all_metrics`
   * from a `csv_daily_returns` series and DO NOT touch trades / fills /
   * positions; trade_metrics / volume_metrics / exposure_metrics are NULL
   * by design. Distinct from the exchange-backed path; surfacing this lets
   * the UI render an appropriate provenance pill instead of falsely
   * implying "missing data". Absent when written by the legacy exchange
   * runner.
   */
  csv_source?: boolean;
  benchmark_unavailable?: boolean;
  /** Human-readable note paired with `benchmark_unavailable`. Emitted by
   *  analytics_runner.py:868 when benchmark_returns is None or stale. */
  benchmark_note?: string;
  position_reconstruction_failed?: boolean;
  position_reconstruction_error?: string;
  position_snapshots_unavailable?: boolean;
  position_snapshots_error?: string;
  position_metrics_failed?: boolean;
  position_metrics_error?: string;
  fills_fetch_failed?: boolean;
  fills_fetch_error?: string;
  position_side_volume_failed?: boolean;
  position_side_volume_error?: string;
  trade_mix_approximation?: boolean;
  /**
   * api_key_id IS set on the strategy but the balance lookup didn't
   * return a usable value (no balance configured, or fetch threw).
   * Distinct from `no_linked_api_key`: this is a real degraded state
   * an operator should resolve.
   */
  account_balance_unavailable?: boolean;
  /**
   * Strategy has no linked api_key_id (demo/paper). Same fallback
   * denominator as `account_balance_unavailable` but inherent state,
   * not a degraded computation — the UI surfaces it differently so
   * allocators don't read "approximate" as a problem on a demo.
   */
  no_linked_api_key?: boolean;
  sibling_kinds_failed?: boolean;
  /** 200-char truncated error tail paired with `sibling_kinds_failed`.
   *  Emitted by analytics_runner.py:980 when the sibling-table batch
   *  upsert RPC fails. Surfaced on the admin compute-jobs page. */
  sibling_kinds_error?: string;
  /** Audit-2026-05-07 round-2 / P1994: count of closed positions with
   *  `realized_pnl == 0.0` (exit price equals entry, no fees). Pre-fix
   *  the runner's `roi <= 0` bucketing lumped these into the losers
   *  bucket, depressing avg_losing_trade. Emitted by
   *  position_reconstruction.py and lifted to the top-level column by
   *  analytics_runner.py so allocators can distinguish "won/lost" from
   *  "neither". Absent when zero. */
  breakeven_positions?: number;
  /** Audit-2026-05-07 round-2 / P1994: count of closed positions whose
   *  `realized_pnl` is null in the source data — a data-integrity hole
   *  worth surfacing rather than silently coercing to zero. Pre-fix
   *  these were silently bucketed as losers via `(roi or 0) <= 0`.
   *  Absent when zero. */
  positions_missing_realized_pnl?: number;
  /** Audit-2026-05-07 round-2 / P1995: list of dates whose row in the
   *  turnover series spans more than one calendar day (sparse-day
   *  artifact — multi-day position delta divided by single-day NAV).
   *  Downstream consumers can decide whether to drop, smooth, or
   *  normalize the affected rows. Emitted by
   *  compute_turnover_series_with_flags via analytics_runner.py.
   *  Note: Quantalyze is crypto-first (24/7 markets, no weekends), so
   *  any gap > 1 day is a real data hole. Absent when no gaps. */
  turnover_gap_dates?: string[];
  /** Audit-2026-05-07 H-0646: fraction of fills missing `is_maker`
   *  metadata, rounded to 4 decimals (e.g. 0.1429 == 14.29%). Trade Mix
   *  4-bucket mode silently skips fills without `is_maker`; the per-run
   *  coverage gate caps that at <1% by design, but this DQF surfaces the
   *  exact percentage so allocators can spot a compromised exchange
   *  connector / malicious tenant emitting `is_maker: null` to suppress
   *  the trade_mix panel. Absent when zero. */
  fills_missing_is_maker_pct?: number;
}

export interface VolumeMetrics {
  buy_volume_pct: number;
  sell_volume_pct: number;
  long_volume_pct: number;
  short_volume_pct: number;
  total_fills: number;
  total_volume_usd: number;
}

export interface ExposureMetrics {
  mean_gross_exposure: number;
  std_gross_exposure: number;
  max_gross_exposure: number;
  mean_net_exposure: number;
  std_net_exposure: number;
  max_net_exposure: number;
}

export interface TradeMetrics {
  total_positions: number;
  open_positions: number;
  closed_positions: number;
  win_rate: number;
  avg_roi: number;
  avg_duration_days: number;
  long_count: number;
  short_count: number;
  best_trade_roi: number;
  worst_trade_roi: number;
  // Derived trade metrics (7 total)
  expectancy: number | null;
  risk_reward_ratio: number | null;
  weighted_risk_reward_ratio: number | null;  // weighted by win/loss size and count
  sqn: number | null;
  profit_factor_long: number | null;
  profit_factor_short: number | null;
  // Volume aggregator extras emitted into the same JSONB blob by
  // _compute_volume_aggregator + _compute_derived_trade_metrics. Optional
  // because `reconstruct_positions` may have failed (degraded run) — a
  // consumer that reads `gross_volume_usd` should null-check.
  gross_volume_usd?: number | null;
  mean_trade_size_usd?: number | null;
  daily_turnover_usd?: number | null;
  monthly_turnover_usd?: number | null;
  payoff_ratio?: number | null;
  profit_factor?: number | null;
  winners_count?: number;
  losers_count?: number;
  // Trade mix breakdown (4-bucket when is_maker is reliably reported on
  // every venue; 2-bucket fallback otherwise).
  trade_mix?: TradeMixBuckets;
}

/**
 * Single bucket in trade_mix breakdown.
 * Each bucket counts trades partitioned by side × maker/taker.
 *
 * audit-2026-05-07 H-0512 / H-0513 / M-0579: \`avg_holding_period_hours\` was
 * declared in the original S15f diff (3-field bucket) but dropped on the way
 * to merge. The Python writer side does NOT emit it today (verified absent
 * from the canonical golden fixture). Listed here as OPTIONAL so:
 *   - consumers reading \`bucket.avg_holding_period_hours\` get
 *     \`number | undefined\` (no \`as any\` cast); reads will be \`undefined\`
 *     until/unless Python emits the field.
 *   - the field is UNITED to Hours (audit's mixed-units risk, see
 *     unit vocabulary above). The suffix IS the contract.
 *   - the type-test in MetricPanel.types.test.ts continues to compile.
 */
export interface TradeMixBucket {
  count: number;
  total_notional: number;
  /** Average holding period for trades in this bucket, in HOURS. Optional
   *  until the Python writer side begins emitting; consumers must null-check. */
  avg_holding_period_hours?: number;
}

/**
 * Trade mix breakdown.
 * - 4-bucket variant ships when is_maker is reliably reported on all 3
 *   exchanges (long_maker, long_taker, short_maker, short_taker).
 * - 2-bucket fallback ships otherwise (long, short only).
 * - Read via `Strategy.trade_metrics?.trade_mix?.long_maker?.count` etc.
 * - FROZEN: adding keys requires a coordinated schema/test/spec amendment.
 */
export interface TradeMixBuckets {
  long?: TradeMixBucket;
  short?: TradeMixBucket;
  long_maker?: TradeMixBucket;
  long_taker?: TradeMixBucket;
  short_maker?: TradeMixBucket;
  short_taker?: TradeMixBucket;
}

/**
 * One row in the `strategy_analytics_series` sibling table.
 * Heavy series payloads keyed by (strategy_id, kind).
 * Read via fetch_strategy_lazy_metrics(strategy_id, panel_id) RPC.
 *
 * The union has exactly 12 sibling kinds. `equity_series_1y` lives in
 * `metrics_json` (above-the-fold series), NOT in the sibling table.
 */
export type StrategyAnalyticsSeriesKind =
  | "daily_returns_grid"
  | "rolling_sortino_3m" | "rolling_sortino_6m" | "rolling_sortino_12m"
  | "rolling_volatility_3m" | "rolling_volatility_6m" | "rolling_volatility_12m"
  | "rolling_alpha" | "rolling_beta"
  | "exposure_series" | "turnover_series" | "log_returns_series";

/**
 * audit-2026-05-07 M-0581: discriminated payload shape per kind.
 *
 * Each `kind` has a known payload shape:
 *   - `daily_returns_grid` → `Record<string, Record<string, number>>` (year → month → return)
 *   - rolling_* (sortino/volatility 3m/6m/12m, alpha, beta) → `TimeSeriesPoint[]`
 *   - `exposure_series` / `turnover_series` / `log_returns_series` → `TimeSeriesPoint[]`
 *
 * Discriminating on `kind` makes the payload narrowing automatic — a
 * consumer reading `row.payload` for a `rolling_sortino_3m` row gets
 * `TimeSeriesPoint[]` without an `as` cast. Previously the payload was
 * `Record<string, unknown>` and every reader hand-rolled a predicate.
 */
type RollingKind =
  | "rolling_sortino_3m"
  | "rolling_sortino_6m"
  | "rolling_sortino_12m"
  | "rolling_volatility_3m"
  | "rolling_volatility_6m"
  | "rolling_volatility_12m"
  | "rolling_alpha"
  | "rolling_beta";

type SeriesKindWithPointArrayPayload =
  | RollingKind
  | "exposure_series"
  | "turnover_series"
  | "log_returns_series";

export type StrategyAnalyticsSeriesRow =
  | {
      strategy_id: string;
      kind: SeriesKindWithPointArrayPayload;
      payload: TimeSeriesPoint[];
      computed_at: string;
    }
  | {
      strategy_id: string;
      kind: "daily_returns_grid";
      payload: Record<string, Record<string, number>>;
      computed_at: string;
    };

/**
 * Phase 12 / D-04: Lazy-fetch RPC return shape.
 * Maps panel_id → {kind: payload}. Empty object when strategy is not visible
 * to the caller or no kinds match the panel mapping.
 *
 * audit-2026-05-07 (C-0182 / C-0183 / H-0518 / H-1118): the RPC returns a
 * PARTIAL projection of `StrategyAnalyticsSeriesKind` — each panel only
 * emits the 0-8 kinds applicable to it. The previous shape
 * `Record<StrategyAnalyticsSeriesKind, unknown> | Record<string, never>`
 * was a structural lie because `Record<K,V>` in TS is TOTAL: every K must
 * be present. The union also collapsed to `{}` because `Record<string,never>`
 * subsumes the keyed map. Consumers reading e.g. `payload.daily_returns_grid`
 * believed the key always existed and crashed at runtime when fetching a panel
 * that didn't emit that kind. Switching to `Partial<...>` forces consumers
 * to null-check before each key access, matching reality.
 */
export type LazyMetricsPayload = Partial<Record<StrategyAnalyticsSeriesKind, unknown>>;

export interface Position {
  id: string;
  strategy_id: string;
  symbol: string;
  side: "long" | "short";
  status: "open" | "closed";
  entry_price_avg: number;
  exit_price_avg: number | null;
  size_base: number;
  size_peak: number;
  realized_pnl: number | null;
  fee_total: number | null;
  fill_count: number;
  opened_at: string;
  closed_at: string | null;
  duration_days: number | null;
  // High-precision duration in whole seconds — added by migration 114
  // (PR #139 / G12.D.3) and populated by position_reconstruction.py
  // (PR #140 / G12.C.9). Nullable because:
  //   - open positions have no close_at and emit NULL.
  //   - rows reconstructed before PR #140 lands carry NULL until the
  //     next analytics tick rewrites them.
  // Cross-PR specialist finding: extending this interface + the Zod
  // schema NOW (PR #138) keeps the .strict() guard forward-compatible
  // with PRs #139 and #140 — without this, the moment any UI consumer
  // adds duration_seconds to a SELECT projection, EVERY row gets
  // dropped by safeParse and the Discovery page renders empty positions.
  duration_seconds: number | null;
  roi: number | null;
  // funding_pnl is the sum of funding_fees over the position window.
  // Total economic P&L = realized_pnl + funding_pnl (computed client-side;
  // no generated DB column). NOT NULL DEFAULT 0 — rows without funding carry 0.
  funding_pnl: number;
}

/**
 * G12.E.1 (audit 2026-05-07) — Runtime guard for Position rows fetched from
 * Supabase. The TS `Position.side: 'long'|'short'` and
 * `Position.status: 'open'|'closed'` unions are compile-time only; raw rows
 * cast directly from `supabase.from('positions').select(...)` would satisfy
 * the type even when the DB returns `'LONG'` (case drift) or a future enum
 * addition like `'partial'`. This Zod schema validates each row at the trust
 * boundary so violations are dropped + warned about, never silently rendered.
 *
 * Mirrors the schema-validation pattern already used in
 * `src/lib/analytics-schemas.ts` for the Python service trust boundary.
 */
// Adversarial-review hardening (PR #138 follow-up):
//   1. PostgREST returns DECIMAL/NUMERIC columns as strings when arbitrary
//      precision matters — supabase-js may or may not coerce depending on
//      the column metadata pipeline. Use z.coerce.number() so the schema
//      accepts BOTH number and string-encoded number; coercion produces a
//      typed Position[] either way and the call site downstream stays
//      number-shaped. Defensive against PostgREST shape drift.
//   2. opened_at / closed_at are TIMESTAMPTZ strings — pin format with
//      .datetime({ offset: true }) so a corrupted '' doesn't silently
//      pass through and produce NaN durations downstream.
//   3. .strict() on the object: if the SELECT later picks up a new column
//      (e.g. unrealized_pnl from migration 040 — currently NOT selected
//      but exists in the DB), the row gets dropped with a warning instead
//      of silently passing through with shape drift. The whole point of
//      the guard is to make schema drift loud, not invisible.
const _coerceNumber = z.coerce.number();
const _coerceNumberNullable = z.coerce.number().nullable();
const _isoTimestamp = z.string().datetime({ offset: true });
const _isoTimestampNullable = z.string().datetime({ offset: true }).nullable();

// audit-2026-05-07 silent-failure HIGH (red-team apply): explicit
// pre-validation that does NOT silently coerce empty strings, booleans,
// arrays, or NaN into 0. Use for fields where 0 is a meaningful value
// distinct from "absent" (FundingFee.amount, ApiKey.account_balance_usdt).
const _strictNumberOrStringNumeric = z.preprocess((v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}, z.number().finite());

const _strictNumberOrStringNumericNullable = z.preprocess((v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}, z.number().finite().nullable());

// audit-2026-05-07 type-design HIGH (red-team apply): `duration_seconds` was
// REQUIRED on the .strict() schema but ABSENT from the discovery page's
// SELECT projection (page.tsx:44). Every row was silently dropped by
// safeParse, so the Discovery position table rendered empty for every
// strategy. The runtime contract is "the SELECT projection" — the schema
// must match what is actually fetched. Marking `duration_seconds` as
// `.optional()` aligns the guard with the live projection; the underlying
// `Position.duration_seconds` field stays `number | null` because rows
// produced by migrations 114+ (post-PR-#140) DO carry it once they pass
// through a SELECT that asks for it. Optional-on-the-schema + nullable-on-
// the-type is the truthful encoding of "may or may not be in this row".
export const PositionRowSchema = z.object({
  id: z.string(),
  strategy_id: z.string(),
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  status: z.enum(["open", "closed"]),
  entry_price_avg: _coerceNumber,
  exit_price_avg: _coerceNumberNullable,
  size_base: _coerceNumber,
  size_peak: _coerceNumber,
  realized_pnl: _coerceNumberNullable,
  fee_total: _coerceNumberNullable,
  fill_count: _coerceNumber,
  opened_at: _isoTimestamp,
  closed_at: _isoTimestampNullable,
  duration_days: _coerceNumberNullable,
  duration_seconds: _coerceNumberNullable.optional(),
  roi: _coerceNumberNullable,
  funding_pnl: _coerceNumber,
}).strict().transform((row): Position => ({
  ...row,
  // Normalize `duration_seconds: undefined` (absent from SELECT projection)
  // to `null` so downstream consumers see a uniform `number | null` shape
  // matching the `Position` type. This preserves the storage-boundary
  // promise: pass through what's there, fill what's not.
  duration_seconds: row.duration_seconds ?? null,
}));

// audit-2026-05-07 RT-0001 (red-team apply): restore the type-level
// guarantee that PositionRowSchema's OUTPUT shape matches the `Position`
// interface. The transform's return-type annotation guarantees the
// schema's output, but doesn't guarantee that EVERY field of Position is
// covered. This assignment is a compile-time check: if `Position` grows
// a new field, the inferred output of `PositionRowSchema` won't satisfy
// `z.ZodType<Position, ...>`-output and TS will error here.
// (Cannot use `satisfies z.ZodType<Position>` directly on the schema
// because `.transform()`'s input-side widens to `unknown` for the
// generic check.)
const _positionRowSchemaOutputCheck: Position = {} as z.infer<typeof PositionRowSchema>;
void _positionRowSchemaOutputCheck;

/**
 * Parse an array of unknown rows (typically `positionsResult.data` from a
 * Supabase select) into a typed `Position[]`. Rows that fail the schema are
 * dropped and a `console.warn` is emitted with the row id (when present) and
 * the Zod issues, so silent shape drift surfaces in server logs.
 *
 * Returning `Position[]` (never `null`) is intentional: the page-level call
 * site is responsible for preserving the null-vs-empty distinction it cares
 * about (see `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`).
 *
 * audit-2026-05-07 silent-failure HIGH (red-team apply): callers can't
 * distinguish "no data" (zero rows in) from "all rows dropped by guard"
 * (drift / corrupt rows in). `parsePositionRowsWithDiagnostics` exposes
 * the same parse plus the counts so callers that care can branch on
 * `dropped > 0`. `parsePositionRows` stays the simple-array adapter for
 * the existing call sites; new code that needs diagnostics should reach
 * for the diagnostics variant.
 */
export interface ParseDiagnostics {
  /** Total rows attempted (input length). */
  total: number;
  /** Rows that successfully passed the schema. */
  accepted: number;
  /** Rows that were dropped due to schema failure. */
  dropped: number;
}

export function parsePositionRowsWithDiagnostics(
  rows: unknown[],
): { data: Position[]; diagnostics: ParseDiagnostics } {
  const out: Position[] = [];
  let dropped = 0;
  for (const row of rows) {
    const parsed = PositionRowSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      dropped += 1;
      // Adversarial-review hardening (PR #138 follow-up): only log paths
      // and codes — never the row contents or `received` values. Zod
      // issue `received` may include allocator-attributable strategy_id
      // and PnL numbers; warn payloads route to Vercel runtime logs
      // visible to ops, so we strip down to schema-shape information only.
      const rowId = (row && typeof row === "object" && "id" in row)
        ? (row as { id?: unknown }).id
        : undefined;
      const safeIssues = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
      }));
      console.warn(
        "[parsePositionRows] dropping invalid position row",
        { rowId, issues: safeIssues },
      );
    }
  }
  return {
    data: out,
    diagnostics: { total: rows.length, accepted: out.length, dropped },
  };
}

export function parsePositionRows(rows: unknown[]): Position[] {
  return parsePositionRowsWithDiagnostics(rows).data;
}

/**
 * audit-2026-05-07 M-0909: branded MatchKey type for `funding_fees.match_key`.
 * The dedup contract is `strategy_id:exchange:symbol:8h-bucket(timestamp)` and
 * backs a UNIQUE constraint. Branding prevents arbitrary string concatenations
 * from flowing into `match_key` without going through `buildFundingMatchKey`,
 * which is the single place that knows the canonical format.
 */
export type FundingFeeMatchKey = string & { readonly __brand: "FundingFeeMatchKey" };

/**
 * Canonical match_key constructor. Floors the timestamp to its enclosing
 * 8-hour funding bucket (00:00 / 08:00 / 16:00 UTC) — the same shape the
 * Python `_build_match_key` writer emits.
 */
export function buildFundingMatchKey(parts: {
  strategy_id: string;
  exchange: SupportedExchange;
  symbol: string;
  /** ISO-8601 UTC timestamp; floored to the 8h bucket. */
  timestamp: string;
}): FundingFeeMatchKey {
  const t = new Date(parts.timestamp).getTime();
  const bucketMs = 8 * 60 * 60 * 1000;
  const floored = Math.floor(t / bucketMs) * bucketMs;
  const bucket = new Date(floored).toISOString();
  return `${parts.strategy_id}:${parts.exchange}:${parts.symbol}:${bucket}` as FundingFeeMatchKey;
}

/**
 * audit-2026-05-07 M-0910: per-exchange raw response shapes preserved on
 * `funding_fees.raw_data`. Each exchange's normalizer writes one of these.
 * The full FundingFee type is a discriminated union on `exchange` so a
 * consumer narrowing on `fee.exchange === "binance"` gets the typed
 * Binance row body without an `as` cast.
 *
 * Fields are intentionally `unknown` because the raw response carries
 * extra fields beyond what we strictly key on; the discriminator is the
 * SHAPE of the row, not field-level types.
 */
export interface BinanceFundingRaw {
  incomeType?: unknown;
  income?: unknown;
  asset?: unknown;
  time?: unknown;
  tranId?: unknown;
  [key: string]: unknown;
}

export interface OkxFundingRaw {
  instId?: unknown;
  type?: unknown;
  pnl?: unknown;
  ccy?: unknown;
  ts?: unknown;
  billId?: unknown;
  [key: string]: unknown;
}

export interface BybitFundingRaw {
  symbol?: unknown;
  type?: unknown;
  funding?: unknown;
  currency?: unknown;
  transactionTime?: unknown;
  id?: unknown;
  [key: string]: unknown;
}

/**
 * funding_fees row — one per 8-hour funding window per
 * (strategy, exchange, symbol). Signed amount: positive = received,
 * negative = paid. See migration 044.
 *
 * audit-2026-05-07 M-0910: discriminated union on `exchange` so
 * `raw_data` narrows to the per-exchange raw shape automatically.
 */
interface FundingFeeBase {
  id: string;
  strategy_id: string;
  symbol: string;
  amount: number;
  currency: string;
  timestamp: string;
  // audit-2026-05-07 M-0909: branded MatchKey — only `buildFundingMatchKey`
  // produces values that satisfy the type. Prevents typo-shaped duplicates
  // from sailing past the UNIQUE constraint sister test that fakes a key.
  match_key: FundingFeeMatchKey;
  created_at: string;
}

export type FundingFee =
  | (FundingFeeBase & {
      exchange: "binance";
      raw_data: BinanceFundingRaw | null;
    })
  | (FundingFeeBase & {
      exchange: "okx";
      raw_data: OkxFundingRaw | null;
    })
  | (FundingFeeBase & {
      exchange: "bybit";
      raw_data: BybitFundingRaw | null;
    });

/**
 * audit-2026-05-07 H-1116: Zod guard for FundingFee rows fetched from
 * Supabase. Mirrors the pattern in `PositionRowSchema` — `z.coerce.number()`
 * on NUMERIC columns (PostgREST may surface DECIMAL as string for arbitrary
 * precision), `.datetime({ offset: true })` on TIMESTAMPTZ, `z.enum`
 * against `SUPPORTED_EXCHANGES` so a typo in the row's exchange becomes
 * a parse error rather than a silent fall-through. `.strict()` surfaces
 * column drift loudly.
 *
 * The schema is a flat object (single enum on `exchange`); the typed
 * discriminated union shape lives on `FundingFee` and the parser
 * `.transform()`s the validated row up to it. Modelling Zod as a
 * discriminated union of three near-identical branches doesn't buy
 * additional safety here because the raw_data per-exchange shapes are
 * all `Record<string, unknown> | null` at the wire level — the
 * discriminator value is the only thing the runtime can verify.
 */
const _fundingRawData = z.record(z.string(), z.unknown()).nullable();

// audit-2026-05-07 silent-failure HIGH (red-team apply):
//   1. `z.coerce.number()` silently turns ""/null/false into 0. For
//      FundingFee.amount that converts "balance not yet known" into a
//      literal $0 funding payment, which then corrupts every downstream
//      sum (FundingFee aggregates feed the funding_pnl PnL math).
//      Use `_strictNumberOrStringNumeric` — accepts real numbers + parseable
//      DECIMAL-as-string, rejects coercion-of-empty.
//   2. The original `.transform((row): FundingFee => ({...row, match_key:
//      row.match_key as FundingFeeMatchKey} as FundingFee))` had a top-
//      level `as FundingFee` cast. That cast bypassed the discriminated
//      union shape — Zod returns a flat object with `raw_data:
//      Record<string,unknown>|null`, but the discriminated `FundingFee`
//      requires the raw_data shape to match the `exchange` discriminator
//      branch. Casting to FundingFee defeats the whole point of the
//      discriminated union. The honest construction is a switch on
//      `row.exchange` so the right branch is selected at runtime; the
//      raw_data still types as the per-exchange Record because the wire
//      shape can carry extra fields beyond what we strictly key on.
export const FundingFeeRowSchema = z
  .object({
    id: z.string(),
    strategy_id: z.string(),
    exchange: z.enum(["binance", "okx", "bybit"]),
    symbol: z.string(),
    amount: _strictNumberOrStringNumeric,
    currency: z.string(),
    timestamp: _isoTimestamp,
    match_key: z.string(),
    raw_data: _fundingRawData,
    created_at: _isoTimestamp,
  })
  .strict()
  // audit-2026-05-07 RT-0003 (red-team apply): the transform's return-type
  // annotation is retained as `FundingFee` to ASSERT the output (so a
  // typo in a branch would TS-error here rather than at the call site).
  // The switch is exhaustive over the `exchange` enum; TS verifies
  // exhaustiveness because every enum value has a `case` arm with a
  // `return` and no `default` is needed.
  .transform((row): FundingFee => {
    const base = {
      id: row.id,
      strategy_id: row.strategy_id,
      symbol: row.symbol,
      amount: row.amount,
      currency: row.currency,
      timestamp: row.timestamp,
      match_key: row.match_key as FundingFeeMatchKey,
      created_at: row.created_at,
    };
    switch (row.exchange) {
      case "binance":
        return { ...base, exchange: "binance", raw_data: row.raw_data as BinanceFundingRaw | null };
      case "okx":
        return { ...base, exchange: "okx", raw_data: row.raw_data as OkxFundingRaw | null };
      case "bybit":
        return { ...base, exchange: "bybit", raw_data: row.raw_data as BybitFundingRaw | null };
    }
  });

/**
 * Parse an array of unknown rows (typically `data` from a Supabase select)
 * into a typed `FundingFee[]`. Mirrors `parsePositionRows`: rows that fail
 * the schema are dropped with a path/code-only `console.warn` (never the
 * row contents — PII / PnL leakage hazard via Vercel runtime logs).
 */
// audit-2026-05-07 silent-failure HIGH (red-team apply): see
// `parsePositionRowsWithDiagnostics`. Same pattern — array-only adapter
// for back-compat, diagnostics variant for callers that need to
// distinguish "no rows" from "all rows dropped".
export function parseFundingFeeRowsWithDiagnostics(
  rows: unknown[],
): { data: FundingFee[]; diagnostics: ParseDiagnostics } {
  const out: FundingFee[] = [];
  let dropped = 0;
  for (const row of rows) {
    const parsed = FundingFeeRowSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      dropped += 1;
      const rowId = (row && typeof row === "object" && "id" in row)
        ? (row as { id?: unknown }).id
        : undefined;
      const safeIssues = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
      }));
      console.warn(
        "[parseFundingFeeRows] dropping invalid funding_fee row",
        { rowId, issues: safeIssues },
      );
    }
  }
  return {
    data: out,
    diagnostics: { total: rows.length, accepted: out.length, dropped },
  };
}

export function parseFundingFeeRows(rows: unknown[]): FundingFee[] {
  return parseFundingFeeRowsWithDiagnostics(rows).data;
}

/**
 * Status values for `contact_requests.status` mirror migration 008's
 * `contact_requests_status_check` CHECK constraint:
 *   pending → intro_made → completed (or declined at any point)
 *
 * The interim `accepted` value was migrated to `intro_made` in migration 008
 * step 1; do not re-introduce it.
 */
export type ContactRequestStatus =
  | "pending"
  | "intro_made"
  | "completed"
  | "declined";

export interface ContactRequest {
  id: string;
  allocator_id: string;
  strategy_id: string;
  message: string | null;
  status: ContactRequestStatus;
  created_at: string;
  responded_at: string | null;
}

/**
 * Shape matches `API_KEY_USER_COLUMNS` in `lib/constants.ts`. When the
 * projection changes, update this interface too.
 */
export interface ApiKey {
  id: string;
  user_id: string;
  // audit-2026-05-07 H-0519: alias `SupportedExchange` for single source.
  exchange: SupportedExchange;
  label: string;
  is_active: boolean;
  sync_status: string | null;
  last_sync_at: string | null;
  account_balance_usdt: number | null;
  created_at: string;
  // Phase 06 (migration 066). Worker-sanitized error message surfaced via
  // the `error` / `complete_with_warnings` pill helper line.
  sync_error: string | null;
  // Phase 06 / ISSUE-006 (migration 068). Stamped by the Python worker on
  // ccxt 429s; drives the `rate_limited` pill's retry-in-Ns countdown.
  last_429_at: string | null;
  // Migration 075: soft-disconnect timestamp. NULL = connected; non-null =
  // disconnected (workers skip on the next cron tick). Present in
  // `API_KEY_USER_COLUMNS` projection and consumed by
  // AllocatorExchangeManager — schema must include it to avoid silent
  // row-drops.
  disconnected_at: string | null;
}

/**
 * audit-2026-05-07 M-0583: trust-boundary parser for `api_keys` rows.
 * The DB column `exchange` is plain TEXT with no CHECK constraint —
 * the TS narrow union `"binance"|"okx"|"bybit"` was a compile-time
 * promise the storage layer did not honor. A typo ("binnance") would
 * land silently and break downstream `EXCHANGE_LABELS[key.exchange]`
 * lookups with `undefined`. The Zod schema enforces the union at the
 * read boundary; `parseApiKeyRows()` drops violators with a redacted
 * warn. Mirrors `parsePositionRows` / `parseFundingFeeRows`.
 *
 * NOTE: this guard is opt-in for now — `getUserApiKeys` and the
 * other callers that read api_keys rows should switch to
 * `parseApiKeyRows(rows)` in a follow-up. The vocabulary lands here
 * first.
 */
export const ApiKeyRowSchema = z
  .object({
    id: z.string(),
    user_id: z.string(),
    exchange: z.enum(["binance", "okx", "bybit"]),
    label: z.string(),
    is_active: z.boolean(),
    sync_status: z.string().nullable(),
    last_sync_at: _isoTimestampNullable,
    // Explicit pre-validation — see _strictNumberOrStringNumericNullable
    // above. Replaces the prior `_coerceNumberNullable` which silently
    // turned ""/false/[] into 0.
    account_balance_usdt: _strictNumberOrStringNumericNullable,
    created_at: _isoTimestamp,
    sync_error: z.string().nullable(),
    last_429_at: _isoTimestampNullable,
    disconnected_at: _isoTimestampNullable,
  })
  .strict() satisfies z.ZodType<ApiKey>;

// audit-2026-05-07 silent-failure HIGH (red-team apply): see
// `parsePositionRowsWithDiagnostics`.
export function parseApiKeyRowsWithDiagnostics(
  rows: unknown[],
): { data: ApiKey[]; diagnostics: ParseDiagnostics } {
  const out: ApiKey[] = [];
  let dropped = 0;
  for (const row of rows) {
    const parsed = ApiKeyRowSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      dropped += 1;
      const rowId = (row && typeof row === "object" && "id" in row)
        ? (row as { id?: unknown }).id
        : undefined;
      const safeIssues = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        code: i.code,
      }));
      console.warn(
        "[parseApiKeyRows] dropping invalid api_key row",
        { rowId, issues: safeIssues },
      );
    }
  }
  return {
    data: out,
    diagnostics: { total: rows.length, accepted: out.length, dropped },
  };
}

export function parseApiKeyRows(rows: unknown[]): ApiKey[] {
  return parseApiKeyRowsWithDiagnostics(rows).data;
}

export interface DiscoveryCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  access_level: "public" | "qualified_only";
  created_at: string;
}

export interface Portfolio {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  /**
   * Added in migration 023. False for the allocator's single real
   * invested book (shown on My Allocation). The partial unique index
   * portfolios_one_real_per_user enforces at most one is_test=false row
   * per user_id. The v0.4.0 pivot dropped the Test Portfolios surface,
   * but the column stays — the invariant is still valuable.
   */
  is_test: boolean;
}

export interface PortfolioWithCount extends Portfolio {
  strategy_count: number;
}

export interface Deck {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  created_at: string;
}

export interface DeckWithCount extends Deck {
  strategy_count: number;
}

export interface AllocationEvent {
  id: string;
  portfolio_id: string;
  strategy_id: string;
  event_type: "deposit" | "withdrawal";
  amount: number;
  event_date: string;
  notes: string | null;
  source: "auto" | "manual";
  created_at: string;
}

/**
 * `PortfolioAnalytics` mirrors the `portfolio_analytics` Postgres row.
 *
 * The JSONB columns reflect what `analytics-service/routers/portfolio.py`
 * actually persists. Earlier versions of these types described intended
 * shapes that did not match the writer; the demo-hero plan corrected them.
 *
 * If you change a shape here, you MUST also update
 * `src/lib/portfolio-analytics-adapter.ts` and the analytics-service writer.
 *
 * audit-2026-05-07 H-1119: every metric field is `number | null` and the
 * nullability is INDEPENDENT of `computation_status`. A computing or
 * pending row carries the same `null` shape as a complete-but-uncomputable
 * row (e.g. <30d history). Consumers MUST narrow on `computation_status`
 * via `isCompletedAnalytics()` (see below) before treating a `null` value
 * as "uncomputable" — otherwise "still warming up" renders identically
 * to "real null", and "0.00% YTD" reads identically to "freshly warmed
 * portfolio". A discriminated union by status is the strict design ideal;
 * the runtime type-guard below is the surgical preliminary.
 */
export type PortfolioAnalyticsComputationStatus =
  | "pending"
  | "computing"
  | "complete"
  | "failed";

export interface PortfolioAnalytics {
  id: string;
  portfolio_id: string;
  computed_at: string;
  computation_status: PortfolioAnalyticsComputationStatus;
  computation_error: string | null;
  total_aum: number | null;
  total_return_twr: number | null;
  total_return_mwr: number | null;
  portfolio_sharpe: number | null;
  portfolio_volatility: number | null;
  portfolio_max_drawdown: number | null;
  avg_pairwise_correlation: number | null;
  return_24h: number | null;
  return_mtd: number | null;
  return_ytd: number | null;
  narrative_summary: string | null;
  correlation_matrix: CorrelationMatrix | null;
  attribution_breakdown: AttributionRow[] | null;
  risk_decomposition: RiskDecompositionRow[] | null;
  benchmark_comparison: BenchmarkComparison | null;
  optimizer_suggestions: OptimizerSuggestionRow[] | null;
  portfolio_equity_curve: TimeSeriesPoint[] | null;
  /** Pair-keyed rolling correlation series. Key format: "<strategyA>:<strategyB>". */
  rolling_correlation: Record<string, TimeSeriesPoint[]> | null;
}

/**
 * audit-2026-05-07 H-1119 — type-guard for the "metrics are meaningful"
 * branch of PortfolioAnalytics. Use this to gate KPI/widget reads:
 *
 *   if (!isCompletedAnalytics(analytics)) return <PendingPlaceholder />;
 *   // `analytics.return_ytd` is still `number | null` here, but the
 *   // null now means "uncomputable" rather than "not yet warmed up".
 *
 * Returns false for `pending` / `computing` / `failed` so widgets can
 * distinguish "still warming up" from "real null" — which fixes the
 * silent rendering of a 0% return as a freshly-warmed portfolio.
 */
export function isCompletedAnalytics<
  T extends { computation_status: PortfolioAnalyticsComputationStatus },
>(a: T | null | undefined): a is T & { computation_status: "complete" } {
  return !!a && a.computation_status === "complete";
}

/**
 * Convenience: returns true while a row is still warming up. Use for
 * "Computing…" placeholders. Distinct from `failed` (terminal error
 * state) and `complete` (real metrics, possibly nullable).
 */
export function isPendingAnalytics<
  T extends { computation_status: PortfolioAnalyticsComputationStatus },
>(a: T | null | undefined): boolean {
  return !!a && (a.computation_status === "pending" || a.computation_status === "computing");
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

export type CorrelationMatrix = Record<string, Record<string, number | null>>;

export interface AttributionRow {
  strategy_id: string;
  strategy_name: string;
  contribution: number;
  allocation_effect: number;
}

export interface RiskDecompositionRow {
  strategy_id: string;
  strategy_name: string;
  marginal_risk_pct: number;
  standalone_vol: number;
  component_var: number;
  weight_pct: number;
}

export interface BenchmarkComparison {
  symbol: string;
  correlation: number | null;
  benchmark_twr: number | null;
  portfolio_twr: number | null;
  stale: boolean;
}

export interface OptimizerSuggestionRow {
  strategy_id: string;
  strategy_name: string;
  corr_with_portfolio: number;
  sharpe_lift: number;
  dd_improvement: number;
  score: number;
}

// audit-2026-05-07 M-0908: re-export the inferred Zod type so the
// schema (analytics-schemas.ts) is the single source of truth. Existing
// consumers that `import { BridgeFitLabel } from "./types"` keep working.
import type { BridgeFitLabel } from "./analytics-schemas";
export type { BridgeFitLabel };

export interface BridgeCandidate {
  strategy_id: string;
  strategy_name: string;
  sharpe_delta: number;
  dd_delta: number;
  corr_delta: number;
  composite_score: number;
  fit_label: BridgeFitLabel;
}

/**
 * Portfolio impact simulator (ADD scenario) status.
 *   - `ok`: simulation ran; deltas, curves, and metrics are populated.
 *   - `insufficient_data`: candidate failed the 30-day overlap floor. Current
 *     metrics are populated; proposed metrics are null and the proposed curve
 *     is empty.
 *   - `already_in_portfolio`: candidate is already a constituent; ADD is undefined.
 *   - `empty_portfolio`: nothing to add to.
 */
export type SimulatorStatus =
  | "ok"
  | "insufficient_data"
  | "already_in_portfolio"
  | "empty_portfolio";

/**
 * Deltas follow the "positive = improvement" sign convention, oriented
 * so all four chips render green when the candidate improves the portfolio:
 *   - sharpe_delta:        proposed_sharpe - current_sharpe
 *   - dd_delta:            current_max_dd  - proposed_max_dd
 *                          (MaxDD is a negative number; positive delta =
 *                           shallower drawdown in the proposed portfolio)
 *   - corr_delta:          current_avg_corr - proposed_avg_corr
 *                          (lower correlation = better diversification)
 *   - concentration_delta: current_hhi - proposed_hhi
 *                          (HHI = sum of squared weights; lower = more
 *                           diversified)
 */
export interface SimulatorDeltas {
  sharpe_delta: number;
  dd_delta: number;
  corr_delta: number;
  concentration_delta: number;
}

export interface SimulatorMetricsSnapshot {
  sharpe: number | null;
  max_drawdown: number | null;
  avg_correlation: number | null;
  concentration: number | null;
}

/**
 * Full simulator response for a single candidate against a portfolio.
 * Returned by POST /api/simulator.
 *
 * audit-2026-05-07 H-1120 / H-1121 / M-0911: the canonical shape is the
 * inferred type from `SimulatorResponseSchema` in `./api/simulatorSchema.ts`
 * — Zod is the single source of truth so the type cannot drift out of
 * lock-step with the runtime validator. The shape is a discriminated
 * union on `status`: `proposed` / `deltas` / `equity_curve_*` only
 * appear on the `ok` branch so illegal states cease to be representable
 * at the type level.
 *
 * Consumers narrow with `if (candidate.status === "ok") {…}` to access
 * the rich-result fields; the non-ok branches expose only `current`,
 * `overlap_days`, `partial_history`, and the id columns.
 */
import type { SimulatorResponse } from "./api/simulatorSchema";
export type SimulatorCandidate = SimulatorResponse;

export interface PortfolioStrategy {
  portfolio_id: string;
  strategy_id: string;
  added_at: string;
  allocated_amount: number | null;
  allocated_at: string | null;
  current_weight: number | null;
  relationship_status: "connected" | "paused" | "exited";
  founder_notes: { date: string; author: string; text: string }[];
  last_founder_contact: string | null;
}

export interface PortfolioDocument {
  id: string;
  portfolio_id: string;
  strategy_id: string | null;
  // audit-2026-05-07 H-0519: alias `DocType` from utils.ts. The canonical
  // tuple `DOC_TYPES` is the single source of truth so a new doc_type
  // forces an update in exactly one place.
  doc_type: DocType;
  title: string;
  file_path: string | null;
  content: string | null;
  uploaded_by: string;
  created_at: string;
}

export interface PortfolioAlert {
  id: string;
  portfolio_id: string;
  /**
   * Pinned source strategy for per-strategy alert types (rebalance_drift).
   * NULL for portfolio-wide alerts. Added in migration 050.
   */
  strategy_id: string | null;
  alert_type:
    | "drawdown"
    | "correlation_spike"
    | "sync_failure"
    | "status_change"
    | "optimizer_suggestion"
    | "regime_shift"
    | "underperformance"
    | "concentration_creep"
    | "rebalance_drift";
  severity: AlertSeverity;
  message: string;
  metadata: Record<string, unknown> | null;
  triggered_at: string;
  acknowledged_at: string | null;
  emailed_at: string | null;
}

export interface VerificationRequest {
  id: string;
  email: string;
  exchange: SupportedExchange;
  status: "pending" | "processing" | "complete" | "failed";
  error_message: string | null;
  results: Record<string, unknown> | null;
  matched_strategy_id: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Compute queue job kinds. Registered in Postgres via the
 * `compute_job_kinds` FK reference table (migration 032). Keep in sync
 * with the seeded rows and with `analytics-service/services/jobs.py`'s
 * dispatch table.
 */
export type JobKind = "sync_trades" | "compute_analytics" | "compute_portfolio" | "poll_positions";

/**
 * Compute queue job status. Mirrors the CHECK constraint on
 * `compute_jobs.status` in migration 032.
 *
 * - pending: ready to run when next_attempt_at <= now()
 * - running: claimed by a worker via SKIP LOCKED
 * - done: terminal success
 * - done_pending_children: parent finished but children are not all
 *   done yet. Fan-in handled by check_fan_in_ready().
 * - failed_retry: transient failure, scheduled for retry via backoff
 * - failed_final: gave up after max_attempts or classified permanent
 */
export type ComputeJobStatus =
  | "pending"
  | "running"
  | "done"
  | "done_pending_children"
  | "failed_retry"
  | "failed_final";

/**
 * Error classification used by `mark_compute_job_failed` to decide
 * retry vs final. Set by the Python runner's `classify_exception`
 * helper.
 */
export type ErrorKind = "transient" | "permanent" | "unknown";

/**
 * `ComputeJob` mirrors the `compute_jobs` Postgres row (migration 032).
 *
 * A compute job targets EXACTLY ONE of (`strategy_id`, `portfolio_id`);
 * the `compute_jobs_target_xor` CHECK constraint enforces this at the
 * DB level. The table is service-role-only (RLS deny-all policy); user
 * reads go through `get_user_compute_jobs()` SECURITY DEFINER.
 *
 * Admin UI consumers use this type via the server-side helper
 * `src/lib/compute-jobs-admin.ts::listComputeJobs`. The wizard
 * `SyncPreviewStep` subscribes to a user-scoped subset via Supabase
 * Realtime. The Railway Python runner reads/writes full rows.
 */
export interface ComputeJob {
  id: string;
  strategy_id: string | null;
  portfolio_id: string | null;
  kind: JobKind;
  parent_job_ids: string[];
  status: ComputeJobStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  claimed_at: string | null;
  claimed_by: string | null;
  last_error: string | null;
  error_kind: ErrorKind | null;
  idempotency_key: string | null;
  /** sync_trades only; NULL for compute_analytics and compute_portfolio. */
  exchange: SupportedExchange | null;
  /** Populated after a successful fetch_trades run, for observability. */
  trade_count: number | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Sprint 3 — admin, position snapshots, weight snapshots, activity, notes
// ---------------------------------------------------------------------------

export interface ComputeJobAdminRow {
  id: string;
  strategy_id: string | null;
  portfolio_id: string | null;
  kind: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  claimed_at: string | null;
  claimed_by: string | null;
  last_error: string | null;
  error_kind: string | null;
  idempotency_key: string | null;
  exchange: string | null;
  trade_count: number | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown> | null;
  strategy_name: string | null;
  portfolio_name: string | null;
  user_email: string | null;
}

export interface PositionSnapshot {
  id: string;
  strategy_id: string;
  snapshot_date: string;
  symbol: string;
  side: "long" | "short" | "flat";
  size_base: number | null;
  size_usd: number | null;
  entry_price: number | null;
  mark_price: number | null;
  unrealized_pnl: number | null;
  exchange: SupportedExchange | null;
  computed_at: string;
  created_at: string;
}

export interface WeightSnapshot {
  id: string;
  portfolio_id: string;
  strategy_id: string;
  snapshot_date: string;
  target_weight: number | null;
  actual_weight: number | null;
  created_at: string;
}

export interface DailyPnlRow {
  date: string;
  strategy_id: string;
  strategy_name: string;
  symbol: string;
  pnl_usd: number;
  exchange: string;
}

export interface UserNote {
  id: string;
  user_id: string;
  portfolio_id: string | null;
  content: string;
  updated_at: string;
  created_at: string;
}
