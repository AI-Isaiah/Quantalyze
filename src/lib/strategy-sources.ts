/**
 * Single source of truth for the `strategies.source` enum admitted by the
 * LATEST `strategies_source_check` migration
 * (`supabase/migrations/20260704200446_deribit_exchange_boundary_checks.sql`,
 * re-basing `20260506211806_strategies_source_csv.sql`).
 *
 * Every code path that branches on `strategies.source` must import from
 * here. Hand-coded literals across the codebase silently lose new values
 * (e.g. `csv` → admin badge fell through to "legacy" before D1).
 *
 * Adding a value here requires a paired migration extending the CHECK
 * constraint on `strategies.source` (set-equality pinned by
 * src/__tests__/strategy-sources-migration-parity.test.ts). Phase 68 (DRB-02)
 * added `deribit` alongside its migration in the same plan.
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
  "deribit",
] as const;

export type StrategySource = (typeof STRATEGY_SOURCES)[number];

export function isStrategySource(value: unknown): value is StrategySource {
  return (
    typeof value === "string" &&
    (STRATEGY_SOURCES as readonly string[]).includes(value)
  );
}
