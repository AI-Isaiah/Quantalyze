import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { castRow } from "@/lib/supabase/cast";
import { loadManagerIdentity as loadManagerIdentityRaw } from "./manager-identity";
import { extractAnalytics, EMPTY_ANALYTICS } from "./utils";
import { API_KEY_USER_COLUMNS } from "./constants";
import { equitySnapshotsToDailyPoints } from "@/lib/allocation-helpers";
import {
  buildDateMapCache,
  computeScenario,
  type DailyPoint,
  type ScenarioState,
  type StrategyForBuilder,
} from "@/lib/scenario";
import { deriveSnapshotDrawdowns } from "@/app/(dashboard)/allocations/lib/drawdown";
import type { FlaggedHolding } from "@/app/(dashboard)/allocations/lib/holding-outcome-adapter";
import type {
  Strategy,
  StrategyAnalytics,
  PortfolioWithCount,
  DeckWithCount,
  Portfolio,
  PortfolioAnalytics,
  PortfolioAlert,
  AllocationEvent,
  DisclosureTier,
  ManagerIdentity,
  LazyMetricsPayload,
} from "./types";
import { getOwnPreferences, type AllocatorPreferences } from "./preferences";

/**
 * Load + redact the manager identity for a strategy.
 *
 * Why this wrapper exists
 *   The disclosure tier system has TWO security gates:
 *
 *     1. The bio/years_trading/aum_range columns on `profiles` had column-level
 *        SELECT REVOKE'd from anon + authenticated in migration 012, so a
 *        client with a session token cannot read them at all — bypassing the
 *        legacy `profiles_read_public USING (true)` policy that would
 *        otherwise leak the institutional manager identity to anyone holding
 *        a user_id.
 *
 *     2. This server-side predicate: only fetch + return manager identity for
 *        `disclosure_tier='institutional'` strategies. Exploratory strategies
 *        get `null` and the profile is never queried.
 *
 *   The raw SELECT lives in `src/lib/manager-identity.ts` — this wrapper adds
 *   the tier gate + admin-client plumbing. Keeping them in separate files
 *   means the low-level fetch can be reused by the email routes without
 *   duplicating the bio/years_trading/aum_range column list.
 */
async function loadManagerIdentity(
  strategy: { user_id?: string | null },
  disclosureTier: DisclosureTier,
): Promise<ManagerIdentity | null> {
  if (!strategy.user_id || disclosureTier !== "institutional") {
    return null;
  }
  const admin = createAdminClient();
  return loadManagerIdentityRaw(admin, strategy.user_id);
}

function readDisclosureTier(strategy: unknown): DisclosureTier {
  return (
    (strategy as { disclosure_tier?: DisclosureTier }).disclosure_tier ??
    "exploratory"
  );
}

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

/** Metric keys we compute percentile ranks for */
const PERCENTILE_METRICS = [
  "cagr",
  "sharpe",
  "sortino",
  "calmar",
  "max_drawdown",
  "volatility",
  "cumulative_return",
] as const;

type PercentileMetric = (typeof PERCENTILE_METRICS)[number];

/** Metrics where lower values are better — percentile is inverted */
const LOWER_IS_BETTER: ReadonlySet<string> = new Set(["max_drawdown", "volatility"]);

export type PercentileMap = Record<string, Record<PercentileMetric, number>>;

/**
 * Compute percentile ranks for each published strategy across key metrics.
 * Returns null when fewer than 5 published strategies exist (not enough data).
 *
 * If categorySlug is provided, computes within that category only.
 * Percentile formula: (count of values <= v) / N * 100
 * For lower-is-better metrics: percentile = 100 - raw_percentile
 */
export async function getPercentiles(categorySlug?: string): Promise<PercentileMap | null> {
  const supabase = await createClient();

  const analyticsColumns = "cagr, sharpe, sortino, calmar, max_drawdown, volatility, cumulative_return";

  const query = categorySlug
    ? supabase
        .from("strategies")
        .select(`id, discovery_categories!inner(slug), strategy_analytics (${analyticsColumns})`)
        .eq("discovery_categories.slug", categorySlug)
        .eq("status", "published")
    : supabase
        .from("strategies")
        .select(`id, strategy_analytics (${analyticsColumns})`)
        .eq("status", "published");

  const { data: strategies, error } = await query;
  if (error || !strategies) return null;
  if (strategies.length < 5) return null;

  // Extract analytics for each strategy
  const rows: { id: string; analytics: Record<string, number | null> }[] = [];
  for (const s of strategies) {
    const a = extractAnalytics((s as Record<string, unknown>).strategy_analytics);
    if (!a) continue;
    rows.push({ id: s.id, analytics: castRow<Record<string, number | null>>(a, "analytics") });
  }

  if (rows.length < 5) return null;

  const result: PercentileMap = {};

  for (const metric of PERCENTILE_METRICS) {
    // Collect non-null values for this metric
    const values: { id: string; val: number }[] = [];
    for (const row of rows) {
      const v = row.analytics[metric];
      if (v != null) values.push({ id: row.id, val: v });
    }

    const n = values.length;
    if (n === 0) continue;

    for (const entry of values) {
      const countLessOrEqual = values.filter((x) => x.val <= entry.val).length;
      let percentile = (countLessOrEqual / n) * 100;

      if (LOWER_IS_BETTER.has(metric)) {
        percentile = 100 - percentile;
      }

      if (!result[entry.id]) {
        result[entry.id] = {} as Record<PercentileMetric, number>;
      }
      result[entry.id][metric] = Math.round(percentile);
    }
  }

  return result;
}

// Convenience re-export so callers that already pull from `@/lib/queries` for
// server-side reads don't need a second import line just for these helpers.
// Both helpers are pure and have no Supabase dependency — they live in utils.
export { extractAnalytics, EMPTY_ANALYTICS };

export async function getStrategiesByCategory(categorySlug: string): Promise<StrategyWithAnalytics[]> {
  const supabase = await createClient();

  // Single query: join strategies with category filter + analytics
  const { data: strategies, error } = await supabase
    .from("strategies")
    .select(`*, discovery_categories!inner(slug), strategy_analytics (*)`)
    .eq("discovery_categories.slug", categorySlug)
    .eq("status", "published");

  if (error) {
    console.error("Strategy query failed:", error.message);
    return [];
  }

  if (!strategies || strategies.length === 0) return [];

  return strategies.map((s) => ({
    ...s,
    analytics: extractAnalytics(s.strategy_analytics) ?? { ...EMPTY_ANALYTICS, strategy_id: s.id },
  }));
}

export async function getPopulatedCategorySlugs(): Promise<string[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("strategies")
    .select("discovery_categories!inner(slug)")
    .eq("status", "published");

  if (error || !data) return [];

  const slugs = new Set<string>();
  for (const row of data) {
    const raw = (row as Record<string, unknown>).discovery_categories;
    const cats = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const cat of cats) {
      const slug = (cat as Record<string, unknown>)?.slug;
      if (typeof slug === "string") slugs.add(slug);
    }
  }
  return Array.from(slugs);
}

const PUBLIC_ANALYTICS_COLUMNS = "cumulative_return, cagr, volatility, sharpe, sortino, calmar, max_drawdown, max_drawdown_duration_days, six_month_return, sparkline_returns, computation_status, computed_at";

export async function getPublicStrategyDetail(strategyId: string): Promise<{
  strategy: Strategy;
  analytics: ReturnType<typeof extractAnalytics>;
  manager: ManagerIdentity | null;
  disclosureTier: DisclosureTier;
} | null> {
  const supabase = await createClient();

  const { data: strategy, error } = await supabase
    .from("strategies")
    .select(`*, strategy_analytics (${PUBLIC_ANALYTICS_COLUMNS})`)
    .eq("id", strategyId)
    .eq("status", "published")
    .single();

  if (error || !strategy) return null;

  const disclosureTier = readDisclosureTier(strategy);
  const manager = await loadManagerIdentity(strategy, disclosureTier);

  return {
    strategy,
    analytics: extractAnalytics(strategy.strategy_analytics),
    manager,
    disclosureTier,
  };
}

export async function getFactsheetDetail(strategyId: string): Promise<{
  strategy: Strategy & { discovery_categories?: { slug: string } | null };
  analytics: StrategyAnalytics;
  manager: ManagerIdentity | null;
  disclosureTier: DisclosureTier;
} | null> {
  const supabase = await createClient();

  const { data: strategy, error } = await supabase
    .from("strategies")
    .select(
      `*, strategy_analytics (${PUBLIC_ANALYTICS_COLUMNS}, monthly_returns, metrics_json), discovery_categories (slug)`,
    )
    .eq("id", strategyId)
    .eq("status", "published")
    .single();

  if (error || !strategy) return null;

  const analytics = extractAnalytics(strategy.strategy_analytics);
  if (!analytics) return null;

  const disclosureTier = readDisclosureTier(strategy);
  const manager = await loadManagerIdentity(strategy, disclosureTier);

  return {
    strategy,
    analytics,
    manager,
    disclosureTier,
  };
}

export async function getStrategyDetail(strategyId: string): Promise<{
  strategy: Strategy;
  analytics: StrategyAnalytics;
  manager: ManagerIdentity | null;
  disclosureTier: DisclosureTier;
} | null> {
  const supabase = await createClient();

  const { data: strategy, error } = await supabase
    .from("strategies")
    .select("*, strategy_analytics (*)")
    .eq("id", strategyId)
    .single();

  if (error || !strategy) return null;

  const disclosureTier = readDisclosureTier(strategy);
  const manager = await loadManagerIdentity(strategy, disclosureTier);

  return {
    strategy,
    analytics: extractAnalytics(strategy.strategy_analytics) ?? { ...EMPTY_ANALYTICS, strategy_id: strategyId },
    manager,
    disclosureTier,
  };
}

/**
 * Phase 12 / Plan 12-08 / METRICS-15 / D-04: Panel IDs accepted by the
 * `fetch_strategy_lazy_metrics` RPC. MUST stay in sync with the SQL `CASE`
 * statement in `supabase/migrations/087_strategy_analytics_series.sql`. Adding
 * a new panel here without a matching SQL CASE branch results in the RPC
 * silently returning `{}` (defense-in-depth: see threat T-12-08-02).
 *
 * Panel → kinds mapping (per migration 087):
 *   - overview     → []                              (scalars only, no series)
 *   - equity       → [log_returns_series]           (equity_series_1y stays in metrics_json per H-D)
 *   - drawdown     → []                              (scalars only)
 *   - returns_dist → [daily_returns_grid]
 *   - rolling      → [rolling_sortino_3m/6m/12m, rolling_volatility_3m/6m/12m, rolling_alpha, rolling_beta]
 *   - trades       → []                              (scalars only)
 *   - exposure     → [exposure_series, turnover_series]
 */
export type LazyMetricsPanelId =
  | "overview"
  | "equity"
  | "drawdown"
  | "returns_dist"
  | "rolling"
  | "trades"
  | "exposure";

/**
 * Phase 12 / Plan 12-08 / METRICS-15 / D-04: Lazy-fetch heavy series for
 * panels 4–7 of the Single-Strategy v2 page. Wraps the
 * `fetch_strategy_lazy_metrics(p_strategy_id, p_panel_id)` SECURITY DEFINER
 * RPC shipped in migration 087.
 *
 * Returns a `{kind: payload}` map where `kind` is a value of
 * `StrategyAnalyticsSeriesKind` applicable to the requested panel. Returns
 * an empty object `{}` when:
 *   - The panel has no series (overview / drawdown / trades — scalars only)
 *   - The strategy is not visible to the caller (private + not the owner;
 *     RPC returns `{}` rather than an error to avoid leaking existence —
 *     T-12-08-01)
 *   - The strategy has no series rows yet (compute_analytics not run)
 *   - The RPC call fails for any reason (defensive fallback; T-12-08-01)
 *
 * Phase 12 ships only the consumer + type union. Phase 14b actually invokes
 * this from each lazy panel's `useEffect` once the panel mounts via the
 * IntersectionObserver scaffold (KPI-22). Memoization (React Query / SWR /
 * useEffect deps) is the consumer's responsibility — see threat T-12-08-04.
 */
export async function fetchStrategyLazyMetrics(
  strategyId: string,
  panelId: LazyMetricsPanelId,
): Promise<LazyMetricsPayload> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fetch_strategy_lazy_metrics", {
    p_strategy_id: strategyId,
    p_panel_id: panelId,
  });

  if (error) {
    // T-12-08-01: log for developer observability but never propagate the
    // error to UI. Returning `{}` matches the visibility-miss path so a
    // caller cannot distinguish "private strategy" from "transient error".
    console.error("fetchStrategyLazyMetrics RPC error:", {
      strategyId,
      panelId,
      code: error.code,
      message: error.message,
    });
    return {} as LazyMetricsPayload;
  }

  return (data ?? {}) as LazyMetricsPayload;
}

export async function getUserPortfolios(): Promise<PortfolioWithCount[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: portfolios, error } = await supabase
    .from("portfolios")
    .select("*, portfolio_strategies(strategy_id)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error || !portfolios) return [];

  return portfolios.map((p) => ({
    id: p.id,
    user_id: p.user_id,
    name: p.name,
    description: p.description,
    created_at: p.created_at,
    is_test: p.is_test ?? false,
    strategy_count: Array.isArray(p.portfolio_strategies) ? p.portfolio_strategies.length : 0,
  }));
}

export async function getDecks(): Promise<DeckWithCount[]> {
  const supabase = await createClient();

  const { data: decks, error } = await supabase
    .from("decks")
    .select("*, deck_strategies(strategy_id)")
    .order("created_at", { ascending: false });

  if (error || !decks) return [];

  return decks.map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    slug: d.slug,
    created_at: d.created_at,
    strategy_count: Array.isArray(d.deck_strategies) ? d.deck_strategies.length : 0,
  }));
}

export async function getPortfolioDetail(portfolioId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("portfolios")
    .select("*")
    .eq("id", portfolioId)
    .single();
  if (error) return null;
  return data as Portfolio;
}

/**
 * Verify the user owns the portfolio. Returns true if owned, false otherwise.
 * Use in API routes after auth check.
 */
export async function assertPortfolioOwnership(
  portfolioId: string,
  userId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolios")
    .select("id")
    .eq("id", portfolioId)
    .eq("user_id", userId)
    .maybeSingle();
  return data !== null;
}

export async function getPortfolioStrategies(portfolioId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolio_strategies")
    .select(`
      *, strategies (id, name, status, strategy_types, supported_exchanges, start_date, aum,
        strategy_analytics (cagr, sharpe, max_drawdown, volatility, cumulative_return, sparkline_returns, computed_at, computation_status, returns_series, daily_returns)
      )
    `)
    .eq("portfolio_id", portfolioId)
    .order("added_at", { ascending: false });
  return data ?? [];
}

export async function getPortfolioAnalytics(portfolioId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolio_analytics")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .single();
  return data as PortfolioAnalytics | null;
}

/**
 * Fetch the latest analytics row AND the latest row that successfully
 * completed. The dashboard uses this to show "stale fallback" data when the
 * most recent run failed: render last-good values with a stale badge instead
 * of an error card. Both queries run in parallel.
 *
 * If no row exists at all, both fields are null. If the latest row is
 * already complete, `lastGood` and `latest` reference the same row.
 */
export interface PortfolioAnalyticsWithFallback {
  latest: PortfolioAnalytics | null;
  lastGood: PortfolioAnalytics | null;
}

export async function getPortfolioAnalyticsWithFallback(
  portfolioId: string,
): Promise<PortfolioAnalyticsWithFallback> {
  const supabase = await createClient();
  const [latestRes, completeRes] = await Promise.all([
    supabase
      .from("portfolio_analytics")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("portfolio_analytics")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .eq("computation_status", "complete")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    latest: (latestRes.data ?? null) as PortfolioAnalytics | null,
    lastGood: (completeRes.data ?? null) as PortfolioAnalytics | null,
  };
}

export async function getPortfolioAlerts(portfolioId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("portfolio_alerts")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .is("acknowledged_at", null)
    .order("triggered_at", { ascending: false });
  return (data ?? []) as PortfolioAlert[];
}

export async function getAllocationEvents(portfolioId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("allocation_events")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("event_date", { ascending: false });
  return (data ?? []) as AllocationEvent[];
}

export async function getAllocatorAggregates(userId: string) {
  const supabase = await createClient();
  const { data: portfolios } = await supabase
    .from("portfolios")
    .select("id, name, description, created_at")
    .eq("user_id", userId);

  if (!portfolios?.length) return { portfolios: [], analytics: [] };

  const portfolioIds = portfolios.map((p) => p.id);
  const { data: analytics } = await supabase
    .from("portfolio_analytics")
    .select("*")
    .in("portfolio_id", portfolioIds)
    .order("computed_at", { ascending: false });

  return { portfolios, analytics: (analytics ?? []) as PortfolioAnalytics[] };
}

// =========================================================================
// My Allocation (migrations 023, 025)
// =========================================================================
//
// v0.4.0 pivot: My Allocation is a Scenarios-style live view of the
// allocator's ACTUAL investments — each row is an investment they made
// by giving a team a read-only API key on their exchange account. The
// page reuses the scenario math library (src/lib/scenario.ts) to render
// the composite curve, KPI strip, and per-strategy list from real
// data. No Test Portfolios, no Favorites panel, no Save-as-Test. The
// what-if exploration surface is /scenarios.

/**
 * Fetch the single real portfolio for the given user — the one row with
 * `is_test = false`. Migration 023 enforces at most one real portfolio
 * per user via a partial unique index, so this query is guaranteed to
 * return either exactly one row or null. Wrapped in React.cache() so
 * multiple server components in the same render tree deduplicate to
 * one DB call per request.
 */
export const getRealPortfolio = cache(
  async (userId: string): Promise<Portfolio | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("portfolios")
      .select("*")
      .eq("user_id", userId)
      .eq("is_test", false)
      .maybeSingle();
    if (error || !data) return null;
    return data as Portfolio;
  },
);

/**
 * Everything the My Allocation page needs, fetched in one parallel
 * round of Supabase queries. `strategies` rows carry the
 * allocator-provided `alias` from migration 025 (nullable — UI falls
 * back to the canonical strategy name when unset) plus raw
 * `daily_returns` for the scenario math. `apiKeys` drives the
 * inline "Add Investment" / "Connected exchanges" section.
 */
import type { BridgeOutcome } from "./bridge-outcome-schema";

/**
 * Phase 5 D-15 (revised) — allocator-scoped bridge_outcomes row with the
 * joined underperformer resolved via the nested FK hop
 * `match_decision_id -> match_decisions.original_strategy_id -> strategies`.
 * Top-level `replacement_strategy` is joined from `bridge_outcomes.strategy_id`.
 */
export type OutcomeRow = BridgeOutcome & {
  /**
   * FK to match_decisions(id). Nullable per migration 059 ON DELETE SET NULL —
   * in practice every outcome created via POST /api/bridge/outcome has a
   * non-null FK. When null, the UI renders em-dash for the Original column
   * (D-03 convention).
   */
  match_decision_id: string | null;
  /** Derived from bridge_outcomes.strategy_id via strategies!fk embed. */
  replacement_strategy: { id: string; name: string } | null;
  /**
   * Resolved from bridge_outcomes.match_decision_id ->
   * match_decisions.original_strategy_id -> strategies(id, name) via
   * nested Supabase embed. Null when match_decision_id is null (theoretical
   * case; should not occur for outcomes created by the current POST route).
   */
  match_decision: {
    original_strategy: { id: string; name: string };
  } | null;
};

export interface MyAllocationDashboardPayload {
  portfolio: Portfolio | null;
  analytics: PortfolioAnalytics | null;
  strategies: Array<{
    strategy_id: string;
    current_weight: number | null;
    allocated_amount: number | null;
    alias: string | null;
    /**
     * True when:
     *   - the allocator has a match_decisions row with decision='sent_as_intro' for this strategy, AND
     *   - no bridge_outcomes row exists for (allocator, strategy), AND
     *   - no active (non-expired) bridge_outcome_dismissals row exists.
     * The banner should only render when this is true (D-03).
     */
    eligible_for_outcome: boolean;
    /**
     * The existing bridge_outcomes row, if any. Non-null implies
     * eligible_for_outcome===false (the banner has already been actioned).
     */
    existing_outcome: BridgeOutcome | null;
    strategy: {
      id: string;
      name: string;
      codename: string | null;
      disclosure_tier: DisclosureTier;
      strategy_types: string[];
      markets: string[];
      start_date: string | null;
      strategy_analytics: Pick<
        StrategyAnalytics,
        "daily_returns" | "cagr" | "sharpe" | "volatility" | "max_drawdown"
      > | null;
    };
  }>;
  apiKeys: Array<{
    id: string;
    exchange: string;
    label: string;
    is_active: boolean;
    sync_status: string | null;
    last_sync_at: string | null;
    account_balance_usdt: number | null;
    created_at: string;
  }>;
  alertCount: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  /** Phase 5 D-15: full outcome history for the allocator, sorted created_at DESC, capped at 200 most-recent (Voice-D5). */
  outcomes: OutcomeRow[];
  // ─────────────────────────────────────────────────────────────────────
  // Phase 07 / 07-03 extensions (VOICES-ACCEPTED f7 + f9)
  // ─────────────────────────────────────────────────────────────────────
  /**
   * Per-allocator equity time series from `allocator_equity_snapshots`
   * (Phase 07 plan 01). Ordered ascending by `asof`. Empty array when
   * the allocator has no snapshots yet (first-connect reconstruction
   * may still be running). The `history_depth_months` column carries
   * the per-venue retention cap so the UI can show venue-specific
   * warm-up copy (f9).
   */
  equitySnapshots: Array<{
    asof: string;
    value_usd: number;
    breakdown: Record<string, number> | null;
    source: "exchange_primary" | "coingecko_fallback" | "mixed";
    history_depth_months: number | null;
  }>;
  /**
   * Latest-asof-per-symbol collapse of `allocator_holdings` (Phase 06
   * table). Populated by the Phase 06 poll_allocator_positions cron.
   *
   * Phase 08 Plan 02: `api_key_id` is projected so HoldingsTable can
   * cross-reference the source key's current sync_status (for the
   * revoked-key strikethrough + amber chip treatment per MANAGE-02).
   * The join is done client-side against the `apiKeys` array that's
   * already on the dashboard payload — cheaper than widening this
   * projection with a nested `api_keys(sync_status)` Supabase join.
   */
  holdingsSummary: Array<{
    symbol: string;
    quantity: number;
    mark_price_usd: number | null;
    value_usd: number;
    venue: string;
    holding_type: "spot" | "derivative";
    api_key_id: string;
  }>;
  /** Row count in allocator_equity_snapshots for this allocator — drives the warm-up gate (snapshotCount < 30 → KPIs render `—`). */
  snapshotCount: number;
  /** True when every active api_key's last_sync_at is older than 24h. Drives the stale KPI render + WarningBanner. */
  allKeysStale: boolean;
  /** Most recent `last_sync_at` across all active api_keys (ISO string) or null. */
  lastSyncAt: string | null;
  /** True when any active api_key has sync_status='syncing'. */
  hasSyncing: boolean;
  /**
   * Per VOICES-ACCEPTED f7: DailyPoint[] derived from equitySnapshots
   * via equitySnapshotsToDailyPoints. Consumed by EquityCurve /
   * DrawdownChart through the parallel-prop path (prefer this over
   * strategies-derived compute when provided).
   */
  equityDailyPoints: DailyPoint[];
  /**
   * Per VOICES-ACCEPTED f9: min(history_depth_months) across the
   * allocator's snapshots, or null when every snapshot's column is
   * NULL (e.g., pure CoinGecko-fallback data). Drives the venue-
   * specific warm-up copy in KpiStrip (when < 3, show "Only N months
   * of history available on {venues}").
   */
  minHistoryDepthMonths: number | null;
  /**
   * Per VOICES-ACCEPTED f9: sorted, deduped display-cased venue
   * labels from the allocator's active api_keys (e.g., ["Binance",
   * "OKX"]). Used in the venue-specific warm-up copy.
   */
  activeVenues: string[];
  // ─────────────────────────────────────────────────────────────────────
  // Phase 09 / D-07 + D-08 + D-11 + finding f5
  // ─────────────────────────────────────────────────────────────────────
  /**
   * Flagged holdings READ from match_batches.holding_flags JSONB (written by
   * Plan 09-02's compute_holding_flags). Phase 09-03 does NOT derive flags
   * from match_candidates + allocator_preferences — that derivation was
   * explicitly flagged as ungrounded by Voice A and replaced by this
   * direct-read path per finding f5.
   *
   * Each entry has top_candidate_strategy_id resolved to its strategy name
   * via a strategies table join. Empty array when no batch exists or no
   * holdings are flagged.
   */
  flaggedHoldings: FlaggedHolding[];
  /**
   * Phase 09 / D-11. Keyed by scope_ref "holding:{venue}:{symbol}:{holding_type}".
   * null = no decision yet; { id } = decision exists (drives deriveEligibleForOutcome).
   * Read via admin client with explicit .eq("allocator_id", userId) ownership gate
   * (match_decisions lacks owner-self-SELECT RLS — queries.ts:968-976 precedent).
   */
  matchDecisionsByHoldingRef: Record<string, { id: string } | null>;
  /**
   * Phase 09.1 PR1 (dashboard parity) — allocator's mandate preferences row.
   * Null when no row exists yet OR when the `allocator_preferences` table is
   * not provisioned. Consumed by the V2 Overview MandateSnapshot widget via
   * `lib/mandate-gates.ts` `deriveMandateGates`. The mandate widget renders
   * an empty state when this is null. Editing surface lives at
   * /profile?tab=mandate (`MandateForm`); this projection is read-only.
   */
  mandate: AllocatorPreferences | null;
  // ─────────────────────────────────────────────────────────────────────
  // Phase 10 / Plan 10-03 (scenario builder + what-if)
  // ─────────────────────────────────────────────────────────────────────
  /**
   * Phase 10 / D-04. Per-holding daily return series reconstructed from
   * allocator_equity_snapshots.breakdown JSONB. Keyed by scope_ref
   * "holding:{venue}:{symbol}:{holding_type}". Empty record when no
   * snapshots exist or no breakdown data is available. One pass at SSR
   * time — never recomputed in the component tree.
   *
   * M5 multi-venue caveat: breakdown JSONB is keyed by SYMBOL only —
   * holdings sharing the same symbol across venues (BTC@binance + BTC@okx)
   * map to IDENTICAL return series. The composer in Plan 06b surfaces a
   * tooltip on holding rows when scope_ref shares a series with another row.
   */
  holdingReturnsByScopeRef: Record<string, DailyPoint[]>;
  /**
   * Phase 10 / H3. The authenticated allocator's user.id, sourced from
   * supabase.auth.getUser() server-side. Consumed by Plan 06a's per-allocator
   * localStorage scoping (N1 defense-in-depth eliminates cross-tenant draft
   * collision) AND by Plan 07's per-row ownership probe in the commit route.
   * Cheapest fix for the cross-review HIGH-3 finding (allocator_id was
   * previously not propagated through the payload).
   */
  allocator_id: string;
  /**
   * Phase 10 / M4. Live-baseline ComputedMetrics computed ONCE at SSR via
   * computeScenario(holdings) on the all-enabled, default-weighted live set.
   * The composer (Plan 06b) consumes this instead of re-deriving the live
   * baseline on every render. The scenario projection adapter still runs
   * client-side because it depends on toggle state (which is client-only).
   * Performance hit was real at >=30 holdings × >=365 days; SSR lift removes
   * it for the live case.
   */
  liveBaselineMetrics: {
    aum: number;
    ytdTwr: number | null;
    sharpe: number | null;
    maxDd: number | null;
    avgRho: number | null;
    equity: DailyPoint[]; // wealth-form (NOT cumulative-return) — Pitfall 1 already converted
    drawdown: DailyPoint[]; // pre-derived via deriveSnapshotDrawdowns()
  };
  // ─────────────────────────────────────────────────────────────────────
  // Phase 11 / 11-05 (onboarding & security readiness — D-02 + D-04)
  // ─────────────────────────────────────────────────────────────────────
  /**
   * Phase 11 / D-02 — server-side count of api_keys rows for this user
   * (RLS-scoped). Source of truth for the OnboardingBanner (S1) and
   * MandateQuickSetCard (S2) visibility predicate. NOT cached client-side
   * (D-02 LOCKED forbids localStorage). Re-evaluated on every page load.
   *
   * `0` triggers the empty-state surfaces; `>= 1` hides them permanently.
   */
  apiKeysCount: number;
  /**
   * Phase 11 / D-04 + ONBOARD-02 — true when the user has saved any
   * mandate field (max_weight or preferred_strategy_types). Used by
   * the MandateQuickSetCard (S2) visibility predicate to hide the
   * card once the user has explicitly saved a mandate.
   *
   * Derivation (matches UI-SPEC §Interaction Contract):
   *   mandate !== null
   *   && (mandate.max_weight !== null
   *       || (mandate.preferred_strategy_types?.length ?? 0) > 0)
   *
   * NOTE on BLOCK-2 reconciliation: A user types "15" into the empty
   * input and clicks Save → max_weight=0.15 → mandateIsSet flips to
   * true on next page load. Phase 02 D-09 LOCKED forbids SILENT default
   * save (input pre-filled with 15 then submit-on-mount); BLOCK-2
   * resolution: input is empty on first render so saving without a
   * typed value is impossible (Save button disabled while empty).
   *
   * Pure-function derivation lives in `deriveMandateIsSet` below so the
   * W-02 4-case truth table is unit-testable without spinning up the full
   * getMyAllocationDashboard fetch.
   */
  mandateIsSet: boolean;
}

/**
 * Phase 11 / W-02 — Pure helper for deriving `mandateIsSet` from an
 * AllocatorPreferences row (or null). Exported so the unit test in
 * src/lib/queries.mandateIsSet.test.ts can exercise the 4-case truth
 * table without spinning up the full getMyAllocationDashboard fetch.
 *
 * Truth table:
 *   1. mandate row missing (null)                                       → false
 *   2. mandate row exists, both fields null/empty                        → false
 *   3. mandate row exists, max_weight set (any non-null number)          → true
 *   4. mandate row exists, preferred_strategy_types non-empty            → true
 *
 * NOTE: max_weight === 0 is treated as "set" (a saved zero is a valid
 * persisted value; only `null` means "unset").
 */
export function deriveMandateIsSet(
  mandate: AllocatorPreferences | null,
): boolean {
  if (mandate === null) return false;
  if (mandate.max_weight !== null && mandate.max_weight !== undefined) return true;
  if ((mandate.preferred_strategy_types?.length ?? 0) > 0) return true;
  return false;
}

/**
 * Fetch all API keys for a user. Shared by the allocations page
 * (empty-state + full dashboard) and the exchanges page so column
 * projections stay in sync.
 *
 * Uses the user-scoped client so the query runs under RLS
 * (api_keys has a policy allowing SELECT where user_id = auth.uid()).
 *
 * Projects only `API_KEY_USER_COLUMNS` from constants.ts. After migration
 * 027 (SEC-005), any other projection will silently return NULL for revoked
 * columns. Do not use `.select("*")` on api_keys from a user client.
 */
export async function getUserApiKeys(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("api_keys")
    .select(API_KEY_USER_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Array<{
    id: string;
    exchange: string;
    label: string;
    is_active: boolean;
    sync_status: string | null;
    last_sync_at: string | null;
    // Phase 06 (migration 066) — worker-sanitized error message surfaced
    // to the owning allocator. Column-level SELECT granted to the
    // `authenticated` role in migration 066; projected via
    // API_KEY_USER_COLUMNS_ARR (constants.ts). NULL on success or when
    // no sync has run yet.
    sync_error: string | null;
    // Phase 06 / ISSUE-006 (migration 068) — timestamp of the last ccxt
    // 429 (stamped by the Python worker). The allocator-facing UI uses
    // this + EXCHANGE_COOLDOWN_SECONDS to render the `rate_limited` pill's
    // "retry in Ns" countdown. NULL when the key has never hit a 429.
    last_429_at: string | null;
    // Migration 075 — NULL when the key is connected. When non-null, the
    // key is soft-disconnected: workers skip it, UI renders the
    // Disconnected section with a Reconnect button.
    disconnected_at: string | null;
    account_balance_usdt: number | null;
    created_at: string;
  }>;
}

// Per VOICES-ACCEPTED f9 — venue display-case map. Any string not in the
// map falls back to its original value (defensive against new exchanges).
const VENUE_DISPLAY: Record<string, string> = {
  binance: "Binance",
  okx: "OKX",
  bybit: "Bybit",
};

/**
 * Phase 10 / D-04 — Reconstruct per-holding daily-return series from
 * allocator_equity_snapshots.breakdown JSONB. Mirrors the Phase 09 Python
 * engine convention (analytics-service/routers/match.py::_load_allocator_context):
 * per-day per-symbol USD value differences → daily return series, ascending by asof.
 *
 * Caveats (per 10-RESEARCH.md Pattern 3):
 * - M5 multi-venue: breakdown JSONB is keyed by SYMBOL only — venue is not
 *   disambiguated. If an allocator holds BTC on both Binance and OKX, both
 *   scope_refs (the same symbol across venues) map to the same return
 *   series. Phase 09 Python engine accepts this approximation.
 * - prev=0 days are skipped (avoids division by zero / non-finite values).
 * - Series with fewer than 2 snapshots produce no returns (a return is a
 *   difference; you need at least two values to subtract).
 * - L6 all-NULL breakdowns: when every snapshot's breakdown column is null
 *   the helper returns an empty record (no Object.entries on null; no crash).
 */
export function reconstructHoldingReturnsByScopeRef(
  equitySnapshots: Array<{
    asof: string;
    breakdown: Record<string, number> | null;
  }>,
  holdingsSummary: Array<{
    symbol: string;
    venue: string;
    holding_type: string;
  }>,
): Record<string, DailyPoint[]> {
  const symbolSeriesUSD = new Map<
    string,
    Array<{ asof: string; value: number }>
  >();
  for (const snap of equitySnapshots) {
    if (!snap.breakdown) continue;
    for (const [symbol, value] of Object.entries(snap.breakdown)) {
      if (!Number.isFinite(value)) continue;
      if (!symbolSeriesUSD.has(symbol)) symbolSeriesUSD.set(symbol, []);
      symbolSeriesUSD.get(symbol)!.push({ asof: snap.asof, value });
    }
  }
  const result: Record<string, DailyPoint[]> = {};
  for (const h of holdingsSummary) {
    const scopeRef = `holding:${h.venue}:${h.symbol}:${h.holding_type}`;
    const series = symbolSeriesUSD.get(h.symbol);
    if (!series || series.length < 2) continue;
    const sorted = [...series].sort((a, b) => a.asof.localeCompare(b.asof));
    const dailyReturns: DailyPoint[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1].value;
      const curr = sorted[i].value;
      if (prev === 0) continue;
      const ret = (curr - prev) / prev;
      if (!Number.isFinite(ret)) continue;
      dailyReturns.push({ date: sorted[i].asof, value: ret });
    }
    if (dailyReturns.length > 0) result[scopeRef] = dailyReturns;
  }
  return result;
}

/**
 * Phase 10 / M4 — Compute the live-baseline `ComputedMetrics`-shaped object
 * ONCE at SSR. The composer (Plan 06b) consumes this instead of re-deriving
 * the live baseline on every render. The scenario projection adapter still
 * runs client-side because it depends on toggle state (client-only).
 *
 * The function inlines the StrategyForBuilder set construction that Plan
 * 01's `scenario-adapter.ts::buildStrategyForBuilderSet` will eventually
 * own. Inlining is intentional: Plan 01 ships in the same wave (wave 1)
 * and is not yet present on this branch, so importing from it would be a
 * compile-time blocker. Once Plan 01 lands the helper can be swapped in
 * with no behavioral change — the contract (StrategyForBuilder[] + all-
 * selected ScenarioState + computeScenario) is identical.
 *
 * Returns the empty-default shape when no holdings have ≥2 returns
 * (warm-up case).
 */
function liveBaselineMetricsFromHoldings(
  holdingsSummary: MyAllocationDashboardPayload["holdingsSummary"],
  holdingReturnsByScopeRef: Record<string, DailyPoint[]>,
): MyAllocationDashboardPayload["liveBaselineMetrics"] {
  const totalAum = holdingsSummary.reduce(
    (s, h) => s + (Number.isFinite(h.value_usd) ? h.value_usd : 0),
    0,
  );
  const emptyDefault: MyAllocationDashboardPayload["liveBaselineMetrics"] = {
    aum: totalAum,
    ytdTwr: null,
    sharpe: null,
    maxDd: null,
    avgRho: null,
    equity: [],
    drawdown: [],
  };

  // Build the StrategyForBuilder set: each holding becomes a "strategy"
  // whose daily_returns series is its scope_ref entry in the per-holding
  // returns map. Holdings without returns are excluded — they cannot
  // contribute to the live baseline.
  const strategies: StrategyForBuilder[] = [];
  for (const h of holdingsSummary) {
    const scopeRef = `holding:${h.venue}:${h.symbol}:${h.holding_type}`;
    const returns = holdingReturnsByScopeRef[scopeRef];
    if (!returns || returns.length === 0) continue;
    strategies.push({
      id: scopeRef,
      name: `${h.venue} ${h.symbol}`,
      codename: null,
      disclosure_tier: "exploratory",
      strategy_types: [],
      markets: [],
      start_date: null,
      daily_returns: returns,
      cagr: null,
      sharpe: null,
      volatility: null,
      max_drawdown: null,
    });
  }
  if (strategies.length === 0) return emptyDefault;

  // All-enabled, value-weighted live set (mirrors the all-on default the
  // composer shows on first paint). Weights normalize inside computeScenario.
  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = {};
  const startDates: Record<string, string> = {};
  for (const h of holdingsSummary) {
    const scopeRef = `holding:${h.venue}:${h.symbol}:${h.holding_type}`;
    if (!holdingReturnsByScopeRef[scopeRef]) continue;
    selected[scopeRef] = true;
    weights[scopeRef] = Math.max(0, h.value_usd ?? 0);
  }
  const state: ScenarioState = { selected, weights, startDates };
  const cache = buildDateMapCache(strategies);
  const liveCM = computeScenario(strategies, state, cache);

  if (liveCM.n === 0 || liveCM.equity_curve.length === 0) return emptyDefault;

  // Pitfall 1: scenario.ts emits cumulative RETURN values (0.18 = +18%).
  // Convert to cumulative WEALTH (1.0 starting value) before storing — the
  // EquityChart widget expects wealth-form points.
  const equity: DailyPoint[] = liveCM.equity_curve.map((p) => ({
    date: p.date,
    value: p.value + 1,
  }));
  // Drawdown: derive once from wealth-scaled USD series (deriveSnapshotDrawdowns
  // expects cumulative USD values, NOT 1.0-based wealth or cumulative return).
  const drawdown = totalAum > 0
    ? deriveSnapshotDrawdowns(
        liveCM.equity_curve.map((p) => ({
          date: p.date,
          value: (p.value + 1) * totalAum,
        })),
      )
    : [];

  return {
    aum: totalAum,
    ytdTwr: liveCM.twr,
    sharpe: liveCM.sharpe,
    maxDd: liveCM.max_drawdown,
    // ComputedMetrics field is `avg_pairwise_correlation` — surface it as
    // `avgRho` on the payload to match the composer's render contract.
    avgRho: liveCM.avg_pairwise_correlation,
    equity,
    drawdown,
  };
}

/**
 * Phase 07 / 07-03: compute the Phase 07 payload derivations shared by
 * both branches (portfolio-exists and !portfolio). Kept internal — the
 * dashboard function is the only caller.
 */
function derivePhase07Fields(
  apiKeys: Array<{
    is_active: boolean;
    exchange: string;
    sync_status: string | null;
    last_sync_at: string | null;
  }>,
  equitySnapshots: MyAllocationDashboardPayload["equitySnapshots"],
  snapshotCount: number,
  holdingsRows: Array<{
    symbol: string;
    quantity: number;
    mark_price: number | null;
    value_usd: number;
    venue: string;
    holding_type: "spot" | "derivative";
    asof: string;
    api_key_id: string;
  }>,
): Pick<
  MyAllocationDashboardPayload,
  | "equitySnapshots"
  | "holdingsSummary"
  | "snapshotCount"
  | "allKeysStale"
  | "lastSyncAt"
  | "hasSyncing"
  | "equityDailyPoints"
  | "minHistoryDepthMonths"
  | "activeVenues"
> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const activeKeys = apiKeys.filter((k) => k.is_active);
  const allKeysStale =
    activeKeys.length > 0 &&
    activeKeys.every((k) => !k.last_sync_at || k.last_sync_at < cutoff);
  const lastSyncAt = activeKeys.reduce<string | null>((max, k) => {
    if (!k.last_sync_at) return max;
    return !max || k.last_sync_at > max ? k.last_sync_at : max;
  }, null);
  const hasSyncing = activeKeys.some((k) => k.sync_status === "syncing");

  // f7 adapter: DailyPoint[] for EquityCurve/DrawdownChart parallel-prop.
  const equityDailyPoints = equitySnapshotsToDailyPoints(
    equitySnapshots.map((s) => ({ asof: s.asof, value_usd: s.value_usd })),
  );

  // f9: min non-null history_depth_months across snapshots. Null when
  // every snapshot's column is NULL (e.g. pure CoinGecko-fallback).
  const depths = equitySnapshots
    .map((s) => s.history_depth_months)
    .filter((d): d is number => d != null);
  const minHistoryDepthMonths = depths.length > 0 ? Math.min(...depths) : null;

  // f9: sorted deduped display-cased venues from active keys.
  const activeVenues = Array.from(
    new Set(
      activeKeys.map(
        (k) => VENUE_DISPLAY[k.exchange.toLowerCase()] ?? k.exchange,
      ),
    ),
  ).sort();

  // Collapse holdings to latest-asof-per-symbol via linear scan of the
  // max-asof comparator. Input order is IRRELEVANT for correctness — the
  // `.order("asof", { ascending: false })` clause on the PostgREST query
  // above is a log-inspection hedge (newest rows render first in debug
  // dumps), not a correctness requirement. Do NOT flip the comparator to
  // "first-seen wins" thinking ordering is guaranteed — removing `.order()`
  // would silently regress that assumption.
  const holdingsMap = new Map<string, (typeof holdingsRows)[number]>();
  for (const r of holdingsRows) {
    const existing = holdingsMap.get(r.symbol);
    if (!existing || r.asof > existing.asof) holdingsMap.set(r.symbol, r);
  }
  const holdingsSummary = Array.from(holdingsMap.values()).map((r) => ({
    symbol: r.symbol,
    quantity: r.quantity,
    mark_price_usd: r.mark_price,
    value_usd: r.value_usd,
    venue: r.venue,
    holding_type: r.holding_type,
    api_key_id: r.api_key_id,
  }));

  return {
    equitySnapshots,
    holdingsSummary,
    snapshotCount,
    allKeysStale,
    lastSyncAt,
    hasSyncing,
    equityDailyPoints,
    minHistoryDepthMonths,
    activeVenues,
  };
}

export const getMyAllocationDashboard = cache(
  async (userId: string): Promise<MyAllocationDashboardPayload> => {
    const supabase = await createClient();
    const admin = createAdminClient();

    // Step 1: fan out every userId-keyed fetch in one wave. The Phase 07
    // inputs (equity snapshots, allocator holdings, api keys) don't depend
    // on the portfolio row, so we parallelise them with getRealPortfolio
    // to cut cold-cache waves from 3 to 2. The !portfolio branch still
    // short-circuits Step 2 cleanly — Phase 07 allocators can have real
    // equity snapshots + holdings even without a portfolio_strategies row.
    const [
      portfolio,
      phase07EquityRes,
      phase07HoldingsRes,
      apiKeys,
      // Phase 09 / finding f5 — latest match_batches row for this allocator.
      // holding_flags JSONB is written by Plan 09-02's compute_holding_flags.
      // We do NOT derive flags from match_candidates + allocator_preferences
      // (Voice A flagged that as ungrounded; replaced by direct-read here).
      phase09MatchBatchRes,
      // Phase 09 / D-11 — match_decisions with original_holding_ref set.
      // Admin client required: match_decisions has no allocator-self-SELECT RLS.
      // Explicit .eq("allocator_id", userId) is the ownership gate (Pattern D).
      phase09MatchDecisionsRes,
      // Phase 09.1 PR1 (dashboard parity) — allocator_preferences row.
      // Reuses getOwnPreferences which already swallows PGRST205 (table
      // missing) into null so the dashboard renders cleanly on environments
      // pre-migration-011. Consumed by the V2 MandateSnapshot widget via
      // lib/mandate-gates.ts.
      mandate,
      // Phase 11 / D-02 — server-side COUNT of api_keys rows for the
      // visibility predicate of OnboardingBanner (S1) and
      // MandateQuickSetCard (S2). RLS-scoped via the user-scoped client
      // (api_keys has an owner-self-SELECT policy). NOT cached client-side
      // (D-02 LOCKED forbids localStorage). Note: a separate `apiKeys`
      // array fetch already runs above to project the full per-key columns
      // — we keep the count query as a distinct head-only round-trip so
      // (a) it's a single integer over the wire even when a user has many
      // keys, and (b) the count number remains correct under RLS even if
      // future projection-column changes alter the array length.
      apiKeysCountRes,
      // G-1 fix — hoisted to Step 1 so the outcomes payload is identical in
      // both the !portfolio (fresh allocator) branch and the portfolio
      // branch. Uses admin client because match_decisions has no allocator-
      // self-SELECT RLS policy (the nested join below relies on admin). The
      // .eq("allocator_id", userId) is the ownership gate (kept inline so a
      // reviewer can't accidentally drop it). .limit(200) caps the result
      // set at the 200 most-recent outcomes per allocator (Voice-D5).
      outcomesFullRes,
    ] = await Promise.all([
      getRealPortfolio(userId),
      supabase
        .from("allocator_equity_snapshots")
        .select("asof, value_usd, breakdown, source, history_depth_months")
        .eq("allocator_id", userId)
        .order("asof", { ascending: true })
        // Cap to the reconstruction BACKFILL_CAP_DAYS (2 years) so the
        // payload can't grow unbounded as the table accumulates days.
        .limit(730),
      supabase
        .from("allocator_holdings")
        .select(
          // Phase 08 Plan 02 — api_key_id projected so HoldingsTable can
          // resolve source_key_sync_status via the shared `apiKeys` array
          // (avoids a nested PostgREST join).
          "symbol, quantity, mark_price, value_usd, venue, holding_type, asof, api_key_id",
        )
        .eq("allocator_id", userId)
        .order("asof", { ascending: false }),
      getUserApiKeys(userId),
      admin
        .from("match_batches")
        .select("id, holding_flags")
        .eq("allocator_id", userId)
        .order("computed_at", { ascending: false })
        .limit(1),
      admin
        .from("match_decisions")
        .select("id, original_holding_ref")
        .eq("allocator_id", userId)
        .not("original_holding_ref", "is", null),
      getOwnPreferences(supabase, userId),
      supabase
        .from("api_keys")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
      admin
        .from("bridge_outcomes")
        .select(
          "id, strategy_id, match_decision_id, kind, percent_allocated, allocated_at, rejection_reason, note, delta_30d, delta_90d, delta_180d, estimated_delta_bps, estimated_days, needs_recompute, created_at, replacement_strategy:strategies!bridge_outcomes_strategy_id_fkey(id, name), match_decision:match_decisions!bridge_outcomes_match_decision_id_fkey(original_strategy:strategies!match_decisions_original_strategy_id_fkey(id, name))",
        )
        .eq("allocator_id", userId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    // G-1 fix — normalize outcomes once, use in both !portfolio and
    // portfolio branches. Supabase returns embedded strategies as object
    // OR array depending on join inference, so normalize both the direct
    // (replacement_strategy) and nested (match_decision.original_strategy)
    // embeds. Phase 5 D-15 (revised).
    type EmbeddedStrategy = { id: string; name: string };
    type RawRow = Record<string, unknown>;
    const normalizeEmbed = (v: unknown): EmbeddedStrategy | null => {
      if (v == null) return null;
      if (Array.isArray(v)) return (v[0] as EmbeddedStrategy | undefined) ?? null;
      return v as EmbeddedStrategy;
    };
    const outcomes: OutcomeRow[] = ((outcomesFullRes.data ?? []) as RawRow[]).map(
      (row) => {
        const replRaw = row.replacement_strategy;
        const mdRaw = row.match_decision;
        const mdObj = Array.isArray(mdRaw)
          ? ((mdRaw[0] as RawRow | undefined) ?? null)
          : (mdRaw as RawRow | null);
        const origInner = mdObj
          ? normalizeEmbed((mdObj as RawRow).original_strategy)
          : null;
        return {
          ...(row as unknown as BridgeOutcome),
          match_decision_id: (row.match_decision_id as string | null) ?? null,
          replacement_strategy: normalizeEmbed(replRaw),
          match_decision: origInner ? { original_strategy: origInner } : null,
        } satisfies OutcomeRow;
      },
    );

    // Phase 11 / D-02 — server-side COUNT result (head:true returns no rows;
    // the `count` field is the authoritative integer). PostgREST can return
    // null for `count` on transport error — coalesce to 0 so downstream
    // visibility predicates (apiKeysCount === 0) treat unknowable as
    // "show the onboarding nudge", which is a safer default than hiding it.
    const apiKeysCount = apiKeysCountRes.count ?? 0;
    // Phase 11 / D-04 — derive once via the pure helper (W-02 unit-tested).
    const mandateIsSet = deriveMandateIsSet(mandate);

    const equitySnapshots = (phase07EquityRes.data ??
      []) as MyAllocationDashboardPayload["equitySnapshots"];
    // The equity query returns every row in the allocator's window with no
    // pagination, so `length` is the authoritative count — a separate
    // head-only count query would be a redundant round-trip.
    const snapshotCount = equitySnapshots.length;
    const holdingsRows = (phase07HoldingsRes.data ?? []) as Array<{
      symbol: string;
      quantity: number;
      mark_price: number | null;
      value_usd: number;
      venue: string;
      holding_type: "spot" | "derivative";
      asof: string;
      api_key_id: string;
    }>;

    const phase07 = derivePhase07Fields(
      apiKeys,
      equitySnapshots,
      snapshotCount,
      holdingsRows,
    );

    // Phase 09 / D-07 + D-08 + D-11 + finding f5
    // Derive flaggedHoldings by READING match_batches.holding_flags JSONB.
    // DO NOT derive from match_candidates + allocator_preferences (Voice A rejected that as ungrounded).
    const latestBatch = (phase09MatchBatchRes.data ?? [])[0] as
      | { id: string; holding_flags: unknown }
      | undefined;
    const rawFlags = (latestBatch?.holding_flags ?? []) as Array<{
      holding_ref: string;
      value_usd: number;
      weight: number;
      breach_reasons: Array<"max_weight" | "correlation_ceiling">;
      top_candidate_strategy_id: string | null;
      top_candidate_composite: number | null;
      flagged: boolean;
    }>;

    const flaggedRowsOnly = rawFlags.filter(
      (f) => f.flagged && f.top_candidate_strategy_id,
    );

    // Resolve candidate strategy names from the strategies table.
    const candidateIds = Array.from(
      new Set(flaggedRowsOnly.map((f) => f.top_candidate_strategy_id!)),
    );
    const { data: candidateStrategies } =
      candidateIds.length > 0
        ? await supabase
            .from("strategies")
            .select("id, name")
            .in("id", candidateIds)
        : { data: [] as Array<{ id: string; name: string }> };
    const nameById = new Map(
      (candidateStrategies ?? []).map((s) => [s.id, s.name]),
    );

    const flaggedHoldings: FlaggedHolding[] = flaggedRowsOnly
      .map((f): FlaggedHolding | null => {
        // Parse holding_ref: "holding:{venue}:{symbol}:{holding_type}"
        const parts = f.holding_ref.split(":");
        if (parts.length !== 4 || parts[0] !== "holding") return null;
        const [, venue, symbol, holding_type] = parts;
        if (holding_type !== "spot" && holding_type !== "derivative") return null;
        const name = nameById.get(f.top_candidate_strategy_id!);
        if (!name) return null;
        return {
          venue,
          symbol,
          holding_type,
          value_usd: f.value_usd,
          top_candidate_strategy_id: f.top_candidate_strategy_id!,
          top_candidate_name: name,
          top_candidate_composite: f.top_candidate_composite!,
          breach_reasons: f.breach_reasons,
        };
      })
      .filter((x): x is FlaggedHolding => x !== null);

    // Build matchDecisionsByHoldingRef keyed by scope_ref.
    const matchDecisionsByHoldingRef: Record<string, { id: string } | null> =
      {};
    for (const d of phase09MatchDecisionsRes.data ?? []) {
      const row = d as { id: string; original_holding_ref: string | null };
      if (row.original_holding_ref) {
        matchDecisionsByHoldingRef[row.original_holding_ref] = { id: row.id };
      }
    }

    // Phase 10 / D-04 — Reconstruct per-holding daily-return series from
    // allocator_equity_snapshots.breakdown JSONB. Reuses the equitySnapshots
    // already fetched above; the helper is a pure JS transform (no I/O).
    const holdingReturnsByScopeRef = reconstructHoldingReturnsByScopeRef(
      equitySnapshots,
      phase07.holdingsSummary,
    );

    // Phase 10 / H3 — Propagate the authenticated allocator's user.id so
    // consumers (Plan 06a localStorage scoping, Plan 07 ownership probe)
    // can rely on it. Trust the `userId` argument: callers (the Server
    // Component path via getMyAllocationDashboard) ALREADY resolved
    // auth.getUser() and pass its id here. The previous review-pass
    // (P2) noted that re-fetching auth.getUser() inside this query was a
    // redundant network round-trip — drop it. If a future caller wants
    // to pass an arbitrary id, the existing ownership predicates
    // (.eq("allocator_id", userId)) below still gate every read.
    const allocator_id = userId;

    if (!portfolio) {
      // No real portfolio yet — still return a full Phase 07 payload so
      // fresh allocators with api_keys + snapshots see real equity. Legacy
      // fields collapse to empty/null so the Phase 5/9 widgets render
      // their empty states; Phase 07 KPI / equity / drawdown widgets
      // consume the new fields via the parallel-prop path (VOICES-
      // ACCEPTED f7 + Phase 07 SC3).
      // Phase 10 — even in the !portfolio branch the composer needs the new
      // payload fields (additive contract). The empty-default for
      // liveBaselineMetrics carries aum=0 (no holdings → no AUM) so the
      // composer renders its empty state cleanly.
      return {
        portfolio: null,
        analytics: null,
        strategies: [],
        apiKeys,
        alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
        outcomes,
        flaggedHoldings,
        matchDecisionsByHoldingRef,
        mandate,
        holdingReturnsByScopeRef,
        allocator_id: allocator_id,
        liveBaselineMetrics: liveBaselineMetricsFromHoldings(
          phase07.holdingsSummary,
          holdingReturnsByScopeRef,
        ),
        // Phase 11 / D-02 + D-04 — onboarding visibility predicate inputs.
        apiKeysCount,
        mandateIsSet,
        ...phase07,
      };
    }

    // Step 2: parallel fetch everything. The admin client is used for
    // portfolio_analytics and portfolio_strategies (daily_returns is
    // column-level REVOKE'd from anon/authenticated per migration 010) and
    // for the match_decisions read — that table does not have an allocator-
    // self-SELECT RLS policy, so a user-scoped client returns 0 rows even for
    // the allocator's own intros. The bridge_outcomes and bridge_outcome_dismissals
    // fan-outs run through the user-scoped client because migration 059 gave
    // each table an owner-select policy; RLS then enforces the allocator_id
    // gate as defence-in-depth.
    // NOTE: `apiKeys` is already fetched above in the Phase 07 parallel
    // round; we reuse that result here instead of firing a second
    // getUserApiKeys query. Destructure naming is preserved by
    // declaring a non-conflicting alias and letting the existing
    // call sites keep reading `apiKeys`.
    const nowIso = new Date().toISOString();
    const [
      analyticsRes,
      strategiesRes,
      alertsRes,
      sentAsIntroRes,
      existingOutcomesRes,
      activeDismissalsRes,
    ] = await Promise.all([
      admin
        .from("portfolio_analytics")
        .select("*")
        .eq("portfolio_id", portfolio.id)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("portfolio_strategies")
        .select(
          `
          strategy_id,
          current_weight,
          allocated_amount,
          alias,
          strategy:strategies!inner (
            id,
            name,
            codename,
            disclosure_tier,
            strategy_types,
            markets,
            start_date,
            strategy_analytics (
              daily_returns,
              cagr,
              sharpe,
              volatility,
              max_drawdown
            )
          )
          `,
        )
        .eq("portfolio_id", portfolio.id)
        .order("current_weight", { ascending: false }),
      supabase
        .from("portfolio_alerts")
        .select("id, severity")
        .eq("portfolio_id", portfolio.id)
        .is("acknowledged_at", null),
      // fan-out: strategies introduced to this allocator.
      // Uses admin client because match_decisions has no allocator-self-SELECT
      // RLS policy (reads are admin-only at the table level). The explicit
      // .eq("allocator_id", userId) is the ownership gate; keep it inline
      // with the query so a reviewer can't accidentally drop it.
      admin
        .from("match_decisions")
        .select("strategy_id")
        .eq("allocator_id", userId)
        .eq("decision", "sent_as_intro"),
      // fan-out: existing outcome records for this allocator.
      // User-scoped client — same defence-in-depth rationale as above.
      supabase
        .from("bridge_outcomes")
        .select(
          "id, strategy_id, kind, percent_allocated, allocated_at, rejection_reason, note, delta_30d, delta_90d, delta_180d, estimated_delta_bps, estimated_days, needs_recompute, created_at",
        )
        .eq("allocator_id", userId),
      // fan-out: active (non-expired) dismissals for this allocator.
      // User-scoped client — same defence-in-depth rationale as above.
      supabase
        .from("bridge_outcome_dismissals")
        .select("strategy_id, expires_at")
        .eq("allocator_id", userId)
        .gt("expires_at", nowIso),
      // G-1 fix: full outcome history (Phase 5 D-15) is now fetched in
      // Step 1's Promise.all so the !portfolio branch sees the same
      // payload. See `outcomesFullRes` and the `outcomes` derivation above.
    ]);

    // Normalize the strategies join: Supabase returns the embedded
    // strategy as either an object or an array depending on the embed
    // inference. Same normalization pattern the old allocations page
    // used. Alias + current_weight + allocated_amount carry through
    // from the join row.
    type StrategyPayload = MyAllocationDashboardPayload["strategies"][number]["strategy"];

    // build lookup structures for outcome eligibility.
    // D-03: eligibility filter runs server-side; client never needs to filter.
    const sentAsIntroSet = new Set<string>(
      (sentAsIntroRes.data ?? []).map(
        (r) => (r as { strategy_id: string }).strategy_id,
      ),
    );
    const existingOutcomesByStrategy = new Map<string, BridgeOutcome>();
    for (const row of existingOutcomesRes.data ?? []) {
      const r = row as { strategy_id: string } & BridgeOutcome;
      existingOutcomesByStrategy.set(r.strategy_id, r);
    }
    const activeDismissalSet = new Set<string>(
      (activeDismissalsRes.data ?? []).map(
        (r) => (r as { strategy_id: string }).strategy_id,
      ),
    );

    const strategies = (strategiesRes.data ?? []).map((row) => {
      const rawStrategy = castRow<{ strategy: unknown }>(row, "strategy-join").strategy;
      const strategy = (
        Array.isArray(rawStrategy) ? rawStrategy[0] : rawStrategy
      ) as StrategyPayload;
      const rawAnalytics = castRow<{ strategy_analytics: unknown }>(strategy, "analytics-join")
        ?.strategy_analytics;
      const analytics = Array.isArray(rawAnalytics)
        ? rawAnalytics[0]
        : rawAnalytics;

      // eligibility: a strategy is eligible for outcome
      // recording only when:
      //   1. it was sent_as_intro to this allocator
      //   2. no outcome has been recorded yet
      //   3. no active (non-expired) dismissal exists
      const existing_outcome =
        existingOutcomesByStrategy.get(row.strategy_id as string) ?? null;
      const eligible_for_outcome =
        sentAsIntroSet.has(row.strategy_id as string) &&
        existing_outcome === null &&
        !activeDismissalSet.has(row.strategy_id as string);

      return {
        strategy_id: row.strategy_id,
        current_weight: row.current_weight,
        allocated_amount: row.allocated_amount,
        alias: castRow<{ alias: string | null }>(row, "alias").alias ?? null,
        eligible_for_outcome,
        existing_outcome,
        strategy: {
          ...strategy,
          strategy_analytics: (analytics ?? null) as
            | MyAllocationDashboardPayload["strategies"][number]["strategy"]["strategy_analytics"],
        },
      };
    });

    const alertCounts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      total: 0,
    };
    for (const a of alertsRes.data ?? []) {
      const sev = (a as { severity: string }).severity;
      if (sev === "critical") alertCounts.critical++;
      else if (sev === "high") alertCounts.high++;
      else if (sev === "medium") alertCounts.medium++;
      else if (sev === "low") alertCounts.low++;
      alertCounts.total++;
    }

    return {
      portfolio,
      analytics: (analyticsRes.data ?? null) as PortfolioAnalytics | null,
      strategies,
      apiKeys,
      alertCount: alertCounts,
      // G-1 fix: `outcomes` is hoisted to Step 1 above so the !portfolio
      // branch returns the same payload shape (Phase 5 D-15).
      outcomes,
      flaggedHoldings,
      matchDecisionsByHoldingRef,
      mandate,
      holdingReturnsByScopeRef,
      allocator_id: allocator_id,
      liveBaselineMetrics: liveBaselineMetricsFromHoldings(
        phase07.holdingsSummary,
        holdingReturnsByScopeRef,
      ),
      // Phase 11 / D-02 + D-04 — onboarding visibility predicate inputs.
      apiKeysCount,
      mandateIsSet,
      ...phase07,
    };
  },
);

/**
 * Phase 13 / Plan 13-01 / DISCO-01 — getMyWatchlist
 *
 * Reads the authenticated user's full watchlist (`user_favorites` rows) and
 * returns a Set<strategy_id> for O(1) lookup at the row-render layer. Used by
 * StrategyTable's leading-column StarToggle to decide filled vs. outline icon
 * state on initial server render (matches starred state on first paint).
 *
 * - Schema: migration 024 ships `user_favorites (user_id, strategy_id)` PK,
 *   RLS enforces `auth.uid() = user_id`.
 * - On error or empty data: returns empty Set (read path is non-fatal — a
 *   transient DB error must not break /discovery render).
 *
 * Cross-link: `getMyWatchlist` complements the toggle handler at
 * `src/app/api/watchlist/[strategyId]/route.ts`. Together they implement the
 * full DISCO-01 contract.
 */
export async function getMyWatchlist(userId: string): Promise<Set<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_favorites")
    .select("strategy_id")
    .eq("user_id", userId);
  if (error || !data) {
    return new Set<string>();
  }
  return new Set(data.map((row) => row.strategy_id as string));
}
