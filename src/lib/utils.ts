import type { StrategyAnalytics } from "./types";

export function formatPercent(
  value: number | null | undefined,
  decimals = 2,
): string {
  if (value == null) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(decimals)}%`;
}

const numberFormatters = new Map<number, Intl.NumberFormat>();
function getNumberFormatter(decimals: number) {
  let fmt = numberFormatters.get(decimals);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormatters.set(decimals, fmt);
  }
  return fmt;
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "—";
  return getNumberFormatter(decimals).format(value);
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function metricColor(value: number | null | undefined): string {
  if (value == null) return "text-text-muted";
  return value >= 0 ? "text-positive" : "text-negative";
}

export function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** RFC 4122 hex UUID regex. Used by every API route that takes an id
 *  from a client body. Case-insensitive to match Postgres' output. */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Human-friendly "N{m,h,d} ago" formatter with a fallback to absolute
 *  date once the gap crosses 30 days. Callers pass an explicit `now`
 *  so the function stays pure and client components can memo-gate on
 *  bucket changes. Both branches use the `en-US` locale + UTC
 *  timezone so SSR and client-first-paint produce identical strings. */
export function formatRelativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatAbsoluteDate(iso);
}

/** SSR-deterministic short date. Same output on Node and browser. */
export function formatAbsoluteDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Minute-bucket key used to gate relative-time re-renders. Callers
 *  that tick every minute can compare buckets and skip the state
 *  update when it hasn't changed. */
export function minuteBucket(now: number): number {
  return Math.floor(now / 60_000);
}

/** Multi-strategy chart color palette — design system approved.
 *  No purples/violets per DESIGN.md anti-patterns. */
export const STRATEGY_PALETTE = [
  "#1B6B5A", "#2563EB", "#D97706", "#0F766E",
  "#DC2626", "#059669", "#DB2777", "#4338CA",
] as const;

/** Tailwind class map for alert severity badges. */
export const SEVERITY_STYLES: Record<"high" | "medium" | "low", string> = {
  high: "bg-negative/10 text-negative",
  medium: "bg-badge-market-neutral/10 text-badge-market-neutral",
  low: "bg-badge-other/10 text-badge-other",
};

/** Hex colors for alert severity (for HTML emails). */
export const SEVERITY_HEX: Record<"high" | "medium" | "low", string> = {
  high: "#DC2626",
  medium: "#D97706",
  low: "#0D9488",
};

/** Document types for portfolio relationship_documents. */
export const DOC_TYPES = ["contract", "note", "factsheet", "founder_update", "other"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** Supported exchanges for verification + analytics. Must match the Python schema check. */
export const SUPPORTED_EXCHANGES = ["binance", "okx", "bybit"] as const;
export type SupportedExchange = (typeof SUPPORTED_EXCHANGES)[number];

/** Supabase returns embedded relations as object (unique FK) or array. */
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
