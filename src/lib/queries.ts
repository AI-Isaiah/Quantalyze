import { createClient } from "@/lib/supabase/server";
import type { Strategy, StrategyAnalytics, PortfolioWithCount, DeckWithCount } from "./types";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

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
    analytics: s.strategy_analytics?.[0] ?? { ...EMPTY_ANALYTICS, strategy_id: s.id },
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
    analytics: strategy.strategy_analytics?.[0] ?? null,
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
    analytics: strategy.strategy_analytics?.[0] ?? null,
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
    analytics: strategy.strategy_analytics?.[0] ?? { ...EMPTY_ANALYTICS, strategy_id: strategyId },
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
