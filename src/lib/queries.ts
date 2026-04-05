import { createClient } from "@/lib/supabase/server";
import { MOCK_STRATEGIES, generateDetailAnalytics } from "./mock-data";
import type { Strategy, StrategyAnalytics } from "./types";

type StrategyWithAnalytics = Strategy & { analytics: StrategyAnalytics };

const EMPTY_ANALYTICS: StrategyAnalytics = {
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

  const { data: category, error: catError } = await supabase
    .from("discovery_categories")
    .select("id")
    .eq("slug", categorySlug)
    .single();

  if (catError || !category) {
    // Category not found in DB. Show mock data for demo purposes.
    console.warn("Category lookup failed, using mock data:", catError?.message);
    return MOCK_STRATEGIES;
  }

  const { data: strategies, error: stratError } = await supabase
    .from("strategies")
    .select(`
      *,
      strategy_analytics (*)
    `)
    .eq("category_id", category.id)
    .eq("status", "published");

  if (stratError) {
    console.error("Strategy query failed:", stratError.message);
    return MOCK_STRATEGIES;
  }

  if (!strategies || strategies.length === 0) return MOCK_STRATEGIES;

  return strategies.map((s) => ({
    ...s,
    analytics: s.strategy_analytics?.[0] ?? { ...EMPTY_ANALYTICS, strategy_id: s.id },
  }));
}

export async function getStrategyDetail(strategyId: string): Promise<{
  strategy: Strategy;
  analytics: StrategyAnalytics;
} | null> {
  const supabase = await createClient();

  const { data: strategy, error } = await supabase
    .from("strategies")
    .select("*")
    .eq("id", strategyId)
    .single();

  if (error || !strategy) {
    // Fallback to mock for demo
    const mock = MOCK_STRATEGIES.find((s) => s.id === strategyId);
    if (!mock) return null;
    return { strategy: mock, analytics: generateDetailAnalytics(strategyId) };
  }

  const { data: analytics } = await supabase
    .from("strategy_analytics")
    .select("*")
    .eq("strategy_id", strategyId)
    .single();

  return {
    strategy,
    analytics: analytics ?? generateDetailAnalytics(strategyId),
  };
}
