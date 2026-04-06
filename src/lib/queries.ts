import { createClient } from "@/lib/supabase/server";
import type { Strategy, StrategyAnalytics, PortfolioWithCount, DeckWithCount, Portfolio, PortfolioAnalytics, PortfolioAlert, AllocationEvent } from "./types";

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

// Supabase returns embedded relations as object (unique FK) or array
export function extractAnalytics(raw: unknown): StrategyAnalytics | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  if (typeof raw === "object") return raw as StrategyAnalytics;
  return null;
}

export const EMPTY_ANALYTICS: StrategyAnalytics = {
  id: "",
  strategy_id: "",
  computed_at: "",
  computation_status: "pending",
  computation_error: null,
  benchmark: null,
  cumulative_return: null,
  cagr: null,
  volatility: null,
  sharpe: null,
  sortino: null,
  calmar: null,
  max_drawdown: null,
  max_drawdown_duration_days: null,
  six_month_return: null,
  sparkline_returns: null,
  sparkline_drawdown: null,
  metrics_json: null,
  returns_series: null,
  drawdown_series: null,
  monthly_returns: null,
  daily_returns: null,
  rolling_metrics: null,
  return_quantiles: null,
  trade_metrics: null,
};

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

export async function getPublicStrategyDetail(strategyId: string) {
  const supabase = await createClient();

  const { data: strategy, error } = await supabase
    .from("strategies")
    .select(`*, strategy_analytics (${PUBLIC_ANALYTICS_COLUMNS})`)
    .eq("id", strategyId)
    .eq("status", "published")
    .single();

  if (error || !strategy) return null;

  return {
    strategy,
    analytics: extractAnalytics(strategy.strategy_analytics),
  };
}

export async function getFactsheetDetail(strategyId: string) {
  const supabase = await createClient();

  const { data: strategy, error } = await supabase
    .from("strategies")
    .select(`*, strategy_analytics (${PUBLIC_ANALYTICS_COLUMNS}, monthly_returns, metrics_json)`)
    .eq("id", strategyId)
    .eq("status", "published")
    .single();

  if (error || !strategy) return null;

  return {
    strategy,
    analytics: extractAnalytics(strategy.strategy_analytics),
  };
}

export async function getStrategyDetail(strategyId: string): Promise<{
  strategy: Strategy;
  analytics: StrategyAnalytics;
} | null> {
  const supabase = await createClient();

  const { data: strategy, error } = await supabase
    .from("strategies")
    .select("*, strategy_analytics (*)")
    .eq("id", strategyId)
    .single();

  if (error || !strategy) return null;

  return {
    strategy,
    analytics: extractAnalytics(strategy.strategy_analytics) ?? { ...EMPTY_ANALYTICS, strategy_id: strategyId },
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
