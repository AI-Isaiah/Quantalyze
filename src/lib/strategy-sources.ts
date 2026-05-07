/**
 * Single source of truth for the `strategies.source` enum admitted by
 * `supabase/migrations/100_strategies_source_csv.sql`.
 *
 * Every code path that branches on `strategies.source` must import from
 * here. Hand-coded literals across the codebase silently lose new values
 * (e.g. `csv` → admin badge fell through to "legacy" before D1).
 *
 * Adding a value here requires a paired migration extending the CHECK
 * constraint on `strategies.source`.
 */

export const STRATEGY_SOURCES = [
  "legacy",
  "wizard",
  "admin_import",
  "allocator_connected",
  "csv",
  "okx",
  "binance",
  "bybit",
] as const;

export type StrategySource = (typeof STRATEGY_SOURCES)[number];

export function isStrategySource(value: unknown): value is StrategySource {
  return (
    typeof value === "string" &&
    (STRATEGY_SOURCES as readonly string[]).includes(value)
  );
}
