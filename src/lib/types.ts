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
}

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

export interface ApiKey {
  id: string;
  user_id: string;
  exchange: "binance" | "okx" | "bybit";
  label: string;
  is_active: boolean;
  last_sync_at: string | null;
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
