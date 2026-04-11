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
  trade_metrics: Record<string, unknown> | null;
}

export interface ContactRequest {
  id: string;
  allocator_id: string;
  strategy_id: string;
  message: string | null;
  status: "pending" | "accepted" | "declined";
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
  alert_type: "drawdown" | "correlation_spike" | "sync_failure" | "status_change" | "optimizer_suggestion";
  severity: "high" | "medium" | "low";
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
export type JobKind = "sync_trades" | "compute_analytics" | "compute_portfolio";

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
