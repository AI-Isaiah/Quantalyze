import type { StrategyAnalytics } from "./types";

export function formatPercent(
  value: number | null | undefined,
  decimals = 2,
  options?: { signed?: boolean },
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const signed = options?.signed ?? true;
  const sign = signed && value >= 0 ? "+" : "";
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
  if (value == null || !Number.isFinite(value)) return "—";
  return getNumberFormatter(decimals).format(value);
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  // code-review M: handle negative values in K/M ranges. The >= guards are
  // never true for negatives (-1500 >= 1000 is false), so without explicit
  // negative branches they fall through to `$${value.toFixed(0)}` producing
  // "$-1500" instead of "-$1.5K". unrealized_pnl_usd on a losing short can
  // be a large negative number; if totalAum goes negative the format call
  // would produce malformed output on the money-display surface.
  if (value <= -1_000_000) {
    return `-$${(-value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value <= -1_000) {
    const kStr = (-value / 1_000).toFixed(1);
    // Boundary guard (M-02): toFixed(1) on e.g. -999_999.5 yields "1000.0".
    // Re-route to the M branch instead of emitting "-$1000K".
    if (parseFloat(kStr) >= 1_000) return `-$${(-value / 1_000_000).toFixed(1)}M`;
    return `-$${kStr.endsWith(".0") ? kStr.slice(0, -2) : kStr}K`;
  }
  // NEW-C09-12: use toFixed(1) to preserve ≥1 sig-fig so $1,500 renders as
  // "$1.5K" instead of "$2K" (toFixed(0) rounds to the nearest $1K, which
  // overstates by up to ~33%). Strip the redundant ".0" suffix for round
  // thousands so $250,000 stays "$250K" rather than "$250.0K".
  if (value >= 1_000) {
    const kStr = (value / 1_000).toFixed(1);
    // Boundary guard (M-02): toFixed(1) on e.g. 999_999.5 yields "1000.0".
    // Re-route to the M branch instead of emitting "$1000K".
    if (parseFloat(kStr) >= 1_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    return `$${kStr.endsWith(".0") ? kStr.slice(0, -2) : kStr}K`;
  }
  // Negative sub-threshold values: render -$500 not $-500.
  if (value < 0) return `-$${(-value).toFixed(0)}`;
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

/** Severity union shared across alert/email/admin paths. */
export type AlertSeverity = "critical" | "high" | "medium" | "low";

/** Tailwind class map for alert severity badges. */
export const SEVERITY_STYLES: Record<AlertSeverity, string> = {
  critical: "bg-negative/10 text-negative",
  high: "bg-negative/10 text-negative",
  medium: "bg-badge-market-neutral/10 text-badge-market-neutral",
  low: "bg-badge-other/10 text-badge-other",
};

/** Hex colors for alert severity (for HTML emails). */
export const SEVERITY_HEX: Record<AlertSeverity, string> = {
  critical: "#DC2626",
  high: "#DC2626",
  medium: "#D97706",
  low: "#0D9488",
};

/** Document types for portfolio relationship_documents. */
export const DOC_TYPES = ["contract", "note", "factsheet", "founder_update", "other"] as const;
export type DocType = (typeof DOC_TYPES)[number];

/**
 * Supported exchanges for verification + analytics (lowercase, the wire/DB form).
 * B8: canonical definition is the closed-set registry; re-exported here so the
 * many `@/lib/utils` importers (routes, cron, queries, forms) are unchanged.
 * Must match the Python schema check (analytics-service schemas.py).
 *
 * Phase 68: SUPPORTED_EXCHANGES is the 4-value key-save boundary (admits
 * deribit). UI_EXCHANGE_CODES (public "offered" set) and FUNDING_EXCHANGES
 * (funding/reconcile-eligible set) stay DECOUPLED from it: Phase 69 flipped
 * UI_EXCHANGE_CODES to 4-value (offers deribit), while FUNDING_EXCHANGES stays
 * 3-value until Phase 70. Re-exported here so the VerificationForm and cron
 * importers keep their `@/lib/utils` path.
 */
export {
  SUPPORTED_EXCHANGES,
  UI_EXCHANGE_CODES,
  FUNDING_EXCHANGES,
  type SupportedExchange,
} from "./closed-sets";

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
  volume_metrics: null,
  exposure_metrics: null,
  data_quality_flags: null,
};
