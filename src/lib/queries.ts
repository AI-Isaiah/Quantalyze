import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadManagerIdentity as loadManagerIdentityRaw } from "./manager-identity";
import { extractAnalytics, EMPTY_ANALYTICS } from "./utils";
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
  UserFavoriteWithStrategy,
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
    rows.push({ id: s.id, analytics: a as unknown as Record<string, number | null> });
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
// My Allocation + Test Portfolios + Favorites (migrations 023, 024)
// =========================================================================

/**
 * Fetch the single real portfolio for the given user — the one row with
 * `is_test = false`. Migration 023 enforces at most one real portfolio
 * per user via a partial unique index, so this query is guaranteed to
 * return either exactly one row or null.
 *
 * Used by the My Allocation page (renamed from the old cross-portfolio
 * /allocations aggregator) to anchor all downstream queries — portfolio
 * analytics, portfolio_strategies + daily_returns, alerts — on a single
 * portfolio_id. Wrapped in React.cache() so multiple server components
 * in the same render tree deduplicate to one DB call per request.
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
 * Fetch saved test portfolios for the given user — any row with
 * `is_test = true`. Used by the renamed /portfolios page ("Test
 * Portfolios"), which now only shows hypothetical scenarios. Real-money
 * books live on the My Allocation page via getRealPortfolio.
 *
 * Each row is enriched with a strategy_count derived from the
 * portfolio_strategies join, matching the shape the existing
 * CreatePortfolioForm-consuming UI expects.
 */
export const getTestPortfolios = cache(
  async (userId: string): Promise<PortfolioWithCount[]> => {
    const supabase = await createClient();
    const { data: portfolios, error } = await supabase
      .from("portfolios")
      .select("*, portfolio_strategies(strategy_id)")
      .eq("user_id", userId)
      .eq("is_test", true)
      .order("created_at", { ascending: false });

    if (error || !portfolios) return [];

    return portfolios.map((p) => ({
      id: p.id,
      user_id: p.user_id,
      name: p.name,
      description: p.description,
      created_at: p.created_at,
      is_test: p.is_test,
      strategy_count: Array.isArray(p.portfolio_strategies)
        ? p.portfolio_strategies.length
        : 0,
    }));
  },
);

/**
 * Fetch the user's favorite strategies with the subset of strategy +
 * strategy_analytics fields the Favorites panel needs:
 *   - metadata for the list row (name, codename, type, markets, tier)
 *   - summary scalars for the row stats (cagr, sharpe, vol, max_drawdown)
 *   - raw daily_returns for the client-side composite curve math that
 *     powers the "+ Favorites" overlay on the My Allocation chart
 *
 * RLS on user_favorites restricts rows to auth.uid() = user_id, so even
 * though this query takes a userId argument, the server-side client
 * enforces the constraint automatically. Ordered by created_at DESC so
 * most-recently-starred strategies appear at the top.
 */
export const getUserFavorites = cache(
  async (userId: string): Promise<UserFavoriteWithStrategy[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("user_favorites")
      .select(
        `
        user_id,
        strategy_id,
        created_at,
        notes,
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
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error || !data) return [];

    // Supabase's join returns strategy as an array even with !inner when
    // the PostgREST embed isn't marked many-to-one. Normalize to a single
    // object; same pattern the allocations page already uses.
    return data.map((row) => {
      const rawStrategy = (row as unknown as { strategy: unknown }).strategy;
      const strategy = (
        Array.isArray(rawStrategy) ? rawStrategy[0] : rawStrategy
      ) as UserFavoriteWithStrategy["strategy"];
      const rawAnalytics = (strategy as unknown as { strategy_analytics: unknown })
        ?.strategy_analytics;
      const analytics = Array.isArray(rawAnalytics)
        ? rawAnalytics[0]
        : rawAnalytics;
      return {
        user_id: row.user_id,
        strategy_id: row.strategy_id,
        created_at: row.created_at,
        notes: row.notes,
        strategy: {
          ...strategy,
          strategy_analytics: (analytics ?? null) as
            | UserFavoriteWithStrategy["strategy"]["strategy_analytics"],
        },
      };
    });
  },
);
