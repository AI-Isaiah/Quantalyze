-- Migration 041: strategy_analytics — volume_metrics + exposure_metrics JSONB columns
-- Sprint 4 Task 1: Analytics columns for fill-derived metrics
--
-- Why this migration exists
-- -------------------------
-- Migrations 039 (raw fills) and 040 (positions) provide the data substrate
-- for rich trade analytics. The compute_analytics worker needs a place to
-- store aggregated fill-level metrics alongside the existing strategy-level
-- analytics (cumulative_return, sharpe, etc.). Two new JSONB columns extend
-- strategy_analytics without altering its relational shape:
--
--   volume_metrics — aggregated trading volume data:
--     - total_volume_usd: lifetime notional volume
--     - avg_daily_volume_usd: average daily notional
--     - maker_ratio: fraction of fills that were maker (fee optimization signal)
--     - volume_by_symbol: { "BTC/USDT": 12345.67, ... }
--     - volume_by_month: { "2026-01": 12345.67, ... }
--
--   exposure_metrics — position and risk exposure data:
--     - avg_position_count: mean concurrent open positions
--     - max_position_count: peak concurrent open positions
--     - avg_leverage: mean leverage across positions
--     - long_short_ratio: ratio of long to short exposure
--     - concentration_top3: fraction of exposure in top 3 symbols
--
-- JSONB gives the worker freedom to evolve the schema (add fields, nest
-- deeper) without requiring a new migration for each metric. The frontend
-- reads these columns via the existing strategy_analytics RLS policies
-- (002_rls_policies.sql) — no RLS changes needed.
--
-- What this migration does
-- ------------------------
-- 1. Adds volume_metrics JSONB column to strategy_analytics.
-- 2. Adds exposure_metrics JSONB column to strategy_analytics.
-- 3. Self-verifying DO block.
--
-- What this migration does NOT do
-- --------------------------------
-- - Does NOT populate these columns. The compute_analytics worker writes
--   them after processing fills and positions.
-- - Does NOT add GIN indexes. The frontend reads these columns by
--   strategy_id (already indexed via the UNIQUE constraint on strategy_id
--   from migration 001). JSONB path queries are not expected.
-- - Does NOT alter RLS. strategy_analytics already has published-OR-owned
--   read policies from 002_rls_policies.sql.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: new JSONB columns
-- --------------------------------------------------------------------------
ALTER TABLE strategy_analytics ADD COLUMN IF NOT EXISTS volume_metrics JSONB;
ALTER TABLE strategy_analytics ADD COLUMN IF NOT EXISTS exposure_metrics JSONB;

COMMENT ON COLUMN strategy_analytics.volume_metrics IS
  'Aggregated trading volume data from raw fills: total_volume_usd, avg_daily_volume_usd, maker_ratio, volume_by_symbol, volume_by_month. Populated by compute_analytics worker. See migration 041.';

COMMENT ON COLUMN strategy_analytics.exposure_metrics IS
  'Position and risk exposure data from reconstructed positions: avg_position_count, max_position_count, avg_leverage, long_short_ratio, concentration_top3. Populated by compute_analytics worker. See migration 041.';

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_col TEXT;
  v_expected_cols TEXT[] := ARRAY['volume_metrics', 'exposure_metrics'];
BEGIN
  FOREACH v_col IN ARRAY v_expected_cols LOOP
    IF NOT EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'strategy_analytics'
        AND column_name = v_col
    ) THEN
      RAISE EXCEPTION 'Migration 041 failed: strategy_analytics.% column missing', v_col;
    END IF;

    -- Verify JSONB type
    IF NOT EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'strategy_analytics'
        AND column_name = v_col
        AND data_type = 'jsonb'
    ) THEN
      RAISE EXCEPTION 'Migration 041 failed: strategy_analytics.% is not JSONB', v_col;
    END IF;
  END LOOP;

  RAISE NOTICE 'Migration 041: strategy_analytics volume_metrics + exposure_metrics columns installed and verified.';
END
$$;

COMMIT;
