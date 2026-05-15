-- Migration 039: trades table — raw fill columns + dedup/analysis indexes
-- Sprint 4 Task 1: Raw fill ingestion substrate
--
-- Why this migration exists
-- -------------------------
-- The trades table (migration 001) currently stores only daily_pnl summary
-- rows synthesized by exchange.py fetch_daily_pnl. These are coarse-grained
-- aggregates — one row per day per strategy — which cannot support:
--
--   1. Position reconstruction from individual fills (entry/exit attribution)
--   2. Per-trade ROI and win/loss ratio analytics
--   3. Maker/taker fee breakdown and volume analysis
--   4. Fill-level deduplication for idempotent exchange polling
--
-- This migration extends the existing trades table with columns that capture
-- raw exchange fills alongside the legacy daily_pnl rows. The `is_fill`
-- boolean distinguishes the two populations: false for legacy rows (the
-- default, so existing data is unaffected), true for raw fills ingested by
-- the CCXT fetch_my_trades worker. The partial unique index on
-- (strategy_id, exchange, exchange_fill_id) WHERE is_fill = true provides
-- idempotent upsert semantics for the fill ingestion path.
--
-- What this migration does
-- ------------------------
-- 1. Adds 6 columns to trades: exchange_order_id, exchange_fill_id, is_fill,
--    is_maker, cost, raw_data.
-- 2. Creates 3 partial indexes (WHERE is_fill = true) for fill-specific
--    queries: dedup unique, per-symbol analysis, long/short attribution.
-- 3. Self-verifying DO block.
--
-- What this migration does NOT do
-- --------------------------------
-- - Does NOT modify existing RLS policies. The trades table already has
--   user-scoped read + service-role write policies from 002_rls_policies.sql.
-- - Does NOT backfill existing rows. Legacy daily_pnl rows keep is_fill=false
--   and NULL fill-specific columns.
-- - Does NOT alter the primary key or existing indexes.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: new columns on trades
-- --------------------------------------------------------------------------
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exchange_order_id TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS exchange_fill_id TEXT;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS is_fill BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS is_maker BOOLEAN;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS cost DECIMAL;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS raw_data JSONB;

COMMENT ON COLUMN trades.exchange_order_id IS
  'Exchange-side order identifier. Populated for raw fills, NULL for legacy daily_pnl rows. See migration 039.';

COMMENT ON COLUMN trades.exchange_fill_id IS
  'Exchange-side fill/execution identifier. Unique per (strategy, exchange) for dedup. See migration 039.';

COMMENT ON COLUMN trades.is_fill IS
  'true = raw fill from CCXT fetch_my_trades; false = legacy daily_pnl summary row. Partial indexes filter on this. See migration 039.';

COMMENT ON COLUMN trades.is_maker IS
  'true = maker fill (rebate-eligible on most exchanges), false = taker. NULL for legacy rows. Used for fee analysis. See migration 039.';

COMMENT ON COLUMN trades.cost IS
  'Notional value of the fill (price * quantity). Pre-computed for volume aggregation without re-multiplying. See migration 039.';

COMMENT ON COLUMN trades.raw_data IS
  'Original exchange response JSON from CCXT. Preserved for audit trail and debugging. See migration 039.';

-- --------------------------------------------------------------------------
-- STEP 2: indexes (partial, fill-only)
-- --------------------------------------------------------------------------

-- Dedup: idempotent fill upsert. ON CONFLICT (strategy_id, exchange,
-- exchange_fill_id) WHERE is_fill = true DO UPDATE lets the worker re-poll
-- an exchange time range without creating duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS trades_dedup_fill
  ON trades (strategy_id, exchange, exchange_fill_id)
  WHERE is_fill = true;

-- Per-symbol analysis: "show me all fills for BTC/USDT on strategy X,
-- ordered by time" for position reconstruction and per-symbol P&L.
CREATE INDEX IF NOT EXISTS trades_strategy_symbol_ts
  ON trades (strategy_id, symbol, timestamp)
  WHERE is_fill = true;

-- Long/short attribution: aggregate buy vs. sell fills per strategy over
-- time for directional exposure analysis.
CREATE INDEX IF NOT EXISTS trades_strategy_side_ts
  ON trades (strategy_id, side, timestamp)
  WHERE is_fill = true;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_col_names TEXT[];
  v_expected_cols TEXT[] := ARRAY[
    'exchange_order_id', 'exchange_fill_id', 'is_fill',
    'is_maker', 'cost', 'raw_data'
  ];
  v_col TEXT;
  v_expected_indexes TEXT[] := ARRAY[
    'trades_dedup_fill', 'trades_strategy_symbol_ts', 'trades_strategy_side_ts'
  ];
  v_idx TEXT;
BEGIN
  -- 1. All new columns exist
  FOREACH v_col IN ARRAY v_expected_cols LOOP
    IF NOT EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'trades'
        AND column_name = v_col
    ) THEN
      RAISE EXCEPTION 'Migration 039 failed: trades.% column missing', v_col;
    END IF;
  END LOOP;

  -- 2. is_fill default is false
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'trades'
      AND column_name = 'is_fill'
      AND column_default = 'false'
  ) THEN
    RAISE EXCEPTION 'Migration 039 failed: trades.is_fill default is not false';
  END IF;

  -- 3. All indexes exist
  FOREACH v_idx IN ARRAY v_expected_indexes LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname = v_idx) THEN
      RAISE EXCEPTION 'Migration 039 failed: % index missing', v_idx;
    END IF;
  END LOOP;

  -- 4. trades_dedup_fill is unique
  IF NOT EXISTS(
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON i.indexrelid = c.oid
    WHERE c.relname = 'trades_dedup_fill'
      AND i.indisunique = true
  ) THEN
    RAISE EXCEPTION 'Migration 039 failed: trades_dedup_fill is not UNIQUE';
  END IF;

  RAISE NOTICE 'Migration 039: trades raw fill columns + 3 indexes installed and verified.';
END
$$;

COMMIT;
