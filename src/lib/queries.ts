import { createClient } from "@/lib/supabase/server";
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
    console.warn("Category lookup failed:", catError?.message);
    return [];
  }

  const { data: strategies, error: stratError } = await supabase
    .from("strategies")
    .select(`*, strategy_analytics (*)`)
    .eq("category_id", category.id)
    .eq("status", "published");

  if (stratError) {
    console.error("Strategy query failed:", stratError.message);
    return [];
  }

  if (!strategies || strategies.length === 0) return [];

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

  if (error || !strategy) return null;

  const { data: analytics } = await supabase
    .from("strategy_analytics")
    .select("*")
    .eq("strategy_id", strategyId)
    .single();

  return {
    strategy,
    analytics: analytics ?? { ...EMPTY_ANALYTICS, strategy_id: strategyId },
  };
}
