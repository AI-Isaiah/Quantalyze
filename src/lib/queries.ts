import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { castRow } from "@/lib/supabase/cast";
import { loadManagerIdentity as loadManagerIdentityRaw } from "./manager-identity";
import { extractAnalytics, EMPTY_ANALYTICS } from "./utils";
import { API_KEY_USER_COLUMNS } from "./constants";
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
} from "./types";

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
    account_balance_usdt: number | null;
    created_at: string;
  }>;
}

export const getMyAllocationDashboard = cache(
  async (userId: string): Promise<MyAllocationDashboardPayload> => {
    const supabase = await createClient();
    const admin = createAdminClient();

    // Step 1: the real portfolio anchors everything else.
    const portfolio = await getRealPortfolio(userId);
    if (!portfolio) {
      // No real portfolio yet — still fetch api_keys so the page can
      // prompt the user to connect their first exchange.
      return {
        portfolio: null,
        analytics: null,
        strategies: [],
        apiKeys: await getUserApiKeys(userId),
        alertCount: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
      };
    }

    // Step 2: parallel fetch everything. The admin client is used only for
    // portfolio_analytics and portfolio_strategies — both need daily_returns
    // which is column-level REVOKE'd from anon/authenticated (migration 010).
    // the three eligibility fan-outs (match_decisions,
    // bridge_outcomes, bridge_outcome_dismissals) use the user-scoped client
    // so RLS enforces the allocator_id ownership gate as a second defence.
    const nowIso = new Date().toISOString();
    const [
      analyticsRes,
      strategiesRes,
      apiKeys,
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
      getUserApiKeys(userId),
      supabase
        .from("portfolio_alerts")
        .select("id, severity")
        .eq("portfolio_id", portfolio.id)
        .is("acknowledged_at", null),
      // fan-out: strategies introduced to this allocator.
      // Uses user-scoped client — RLS owns the allocator_id gate as a
      // second defence; admin client would silently return all rows if the
      // .eq("allocator_id", userId) filter were ever accidentally dropped.
      supabase
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
      apiKeys: apiKeys,
      alertCount: alertCounts,
    };
  },
);
