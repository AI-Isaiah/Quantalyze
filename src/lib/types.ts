import { z } from "zod";
import type { AlertSeverity } from "./utils";

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

export interface StrategyAnalytics {
  id: string;
  strategy_id: string;
  computed_at: string;
  computation_status: "pending" | "computing" | "complete" | "failed";
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
  metrics_json: Record<string, unknown> | null;
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
 */
export interface TradeMixBucket {
  count: number;
  total_notional: number;
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

export interface StrategyAnalyticsSeriesRow {
  strategy_id: string;
  kind: StrategyAnalyticsSeriesKind;
  payload: Record<string, unknown>;
  computed_at: string;
}

/**
 * Phase 12 / D-04: Lazy-fetch RPC return shape.
 * Maps panel_id → {kind: payload}. Empty object when strategy is not visible
 * to the caller or no kinds match the panel mapping.
 */
export type LazyMetricsPayload = Record<StrategyAnalyticsSeriesKind, unknown> | Record<string, never>;

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
export const PositionRowSchema = z.object({
  id: z.string(),
  strategy_id: z.string(),
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  status: z.enum(["open", "closed"]),
  entry_price_avg: z.number(),
  exit_price_avg: z.number().nullable(),
  size_base: z.number(),
  size_peak: z.number(),
  realized_pnl: z.number().nullable(),
  fee_total: z.number().nullable(),
  fill_count: z.number(),
  opened_at: z.string(),
  closed_at: z.string().nullable(),
  duration_days: z.number().nullable(),
  roi: z.number().nullable(),
  funding_pnl: z.number(),
}) satisfies z.ZodType<Position>;

/**
 * Parse an array of unknown rows (typically `positionsResult.data` from a
 * Supabase select) into a typed `Position[]`. Rows that fail the schema are
 * dropped and a `console.warn` is emitted with the row id (when present) and
 * the Zod issues, so silent shape drift surfaces in server logs.
 *
 * Returning `Position[]` (never `null`) is intentional: the page-level call
 * site is responsible for preserving the null-vs-empty distinction it cares
 * about (see `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`).
 */
export function parsePositionRows(rows: unknown[]): Position[] {
  const out: Position[] = [];
  for (const row of rows) {
    const parsed = PositionRowSchema.safeParse(row);
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      const rowId = (row && typeof row === "object" && "id" in row)
        ? (row as { id?: unknown }).id
        : undefined;
      console.warn(
        "[parsePositionRows] dropping invalid position row",
        { rowId, issues: parsed.error.issues },
      );
    }
  }
  return out;
}

/**
 * funding_fees row — one per 8-hour funding window per
 * (strategy, exchange, symbol). Signed amount: positive = received,
 * negative = paid. See migration 044.
 */
export interface FundingFee {
  id: string;
  strategy_id: string;
  exchange: "binance" | "okx" | "bybit";
  symbol: string;
  amount: number;
  currency: string;
  timestamp: string;
  match_key: string;
  raw_data: Record<string, unknown> | null;
  created_at: string;
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
  exchange: "binance" | "okx" | "bybit";
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
 */
export interface PortfolioAnalytics {
  id: string;
  portfolio_id: string;
  computed_at: string;
  computation_status: "pending" | "computing" | "complete" | "failed";
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

export type BridgeFitLabel = "Strong fit" | "Good fit" | "Moderate fit" | "Weak fit";

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
 */
export interface SimulatorCandidate {
  candidate_id: string;
  candidate_name: string;
  portfolio_id: string;
  status: SimulatorStatus;
  overlap_days: number;
  /** True when overlap_days < ~6mo of business days; UI shows a warning. */
  partial_history: boolean;
  deltas: SimulatorDeltas;
  current: SimulatorMetricsSnapshot;
  proposed: SimulatorMetricsSnapshot;
  equity_curve_current: TimeSeriesPoint[];
  equity_curve_proposed: TimeSeriesPoint[];
}

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
  doc_type: "contract" | "note" | "factsheet" | "founder_update" | "other";
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
  exchange: "binance" | "okx" | "bybit";
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
  exchange: "binance" | "okx" | "bybit" | null;
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
  exchange: "binance" | "okx" | "bybit" | null;
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
