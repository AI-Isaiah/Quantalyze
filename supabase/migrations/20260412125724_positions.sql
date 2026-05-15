-- Migration 040: positions table — reconstructed position lifecycles
-- Sprint 4 Task 1: Position reconstruction from raw fills
--
-- Why this migration exists
-- -------------------------
-- Migration 039 extends the trades table with raw fill data. Once fills are
-- ingested, the next step is reconstructing position lifecycles: grouping
-- fills into logical positions (open → partial add → partial reduce → close)
-- with entry/exit price averages, realized P&L, ROI, and duration.
--
-- position_snapshots (migration 034) captures the daily forward-going state
-- from CCXT fetch_positions — a point-in-time snapshot. This table captures
-- the full lifecycle: when a position opened, how it was built, when it
-- closed, and what it returned. The two are complementary:
--   - position_snapshots → "what does the exchange say right now?"
--   - positions → "what happened from entry to exit?"
--
-- What this migration does
-- ------------------------
-- 1. Creates the positions table with lifecycle columns (entry/exit prices,
--    size, P&L, fees, fill count, duration, ROI).
-- 2. Creates 3 indexes for common query patterns.
-- 3. RLS: published-OR-owned read pattern (mirrors position_snapshots at 034).
--    Deny all writes from non-service-role.
-- 4. updated_at trigger (mirrors compute_jobs pattern at 032).
-- 5. Self-verifying DO block.
--
-- What this migration does NOT do
-- --------------------------------
-- - Does NOT create the fill-to-position reconstruction logic. That ships
--   as a Python service in the worker.
-- - Does NOT link individual fills back to positions via a FK. The worker
--   uses the trades table's strategy_id + symbol + timestamp range to
--   attribute fills to positions.
-- - Does NOT populate historical data.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: positions table
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id     UUID NOT NULL REFERENCES strategies ON DELETE CASCADE,
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('long', 'short')),
  status          TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  entry_price_avg DECIMAL NOT NULL,
  exit_price_avg  DECIMAL,
  size_base       DECIMAL NOT NULL,
  size_peak       DECIMAL NOT NULL,
  realized_pnl    DECIMAL,
  unrealized_pnl  DECIMAL,
  fee_total       DECIMAL,
  fill_count      INTEGER NOT NULL DEFAULT 0,
  opened_at       TIMESTAMPTZ NOT NULL,
  closed_at       TIMESTAMPTZ,
  duration_days   INTEGER,
  roi             DECIMAL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE positions IS
  'Reconstructed position lifecycles derived from raw fills in the trades table. One row per (strategy, symbol, side) lifecycle from open to close. Populated by the worker position-reconstruction service. See migration 040.';

COMMENT ON COLUMN positions.side IS
  'long = net-long entry, short = net-short entry. Derived from the first fill direction.';

COMMENT ON COLUMN positions.status IS
  'open = position still held (unrealized_pnl updated by worker), closed = fully exited (realized_pnl final).';

COMMENT ON COLUMN positions.entry_price_avg IS
  'Volume-weighted average entry price across all opening fills.';

COMMENT ON COLUMN positions.exit_price_avg IS
  'Volume-weighted average exit price across all closing fills. NULL while position is open.';

COMMENT ON COLUMN positions.size_base IS
  'Current position size in base asset. Zero when closed.';

COMMENT ON COLUMN positions.size_peak IS
  'Maximum position size reached during the lifecycle. Used for position sizing analysis.';

COMMENT ON COLUMN positions.fill_count IS
  'Number of individual fills attributed to this position lifecycle.';

COMMENT ON COLUMN positions.duration_days IS
  'Days from opened_at to closed_at. NULL while open. Computed on close.';

COMMENT ON COLUMN positions.roi IS
  'Return on investment: realized_pnl / (entry_price_avg * size_peak). NULL while open.';

-- --------------------------------------------------------------------------
-- STEP 2: indexes
-- --------------------------------------------------------------------------

-- Filter open/closed positions per strategy. The most common query pattern:
-- "show me all open positions" or "show me closed positions for analysis".
CREATE INDEX IF NOT EXISTS positions_strategy_status
  ON positions (strategy_id, status);

-- Per-symbol lookup: "show me all positions for BTC/USDT, most recent first".
CREATE INDEX IF NOT EXISTS positions_strategy_symbol_opened
  ON positions (strategy_id, symbol, opened_at DESC);

-- Top/worst trades: leaderboard of best and worst closed positions by ROI.
-- Partial index — only closed positions have final ROI.
CREATE INDEX IF NOT EXISTS positions_strategy_roi
  ON positions (strategy_id, roi DESC)
  WHERE status = 'closed';

-- --------------------------------------------------------------------------
-- STEP 3: RLS
-- --------------------------------------------------------------------------
-- Published-OR-owned pattern mirrors position_snapshots (migration 034).
-- Service-role writes via worker bypass RLS. User reads go through the
-- strategy ownership/publication check.
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS positions_read ON positions;
CREATE POLICY positions_read ON positions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM strategies s
    WHERE s.id = positions.strategy_id
      AND (s.status = 'published' OR s.user_id = auth.uid())
  )
);

DROP POLICY IF EXISTS positions_insert_deny ON positions;
CREATE POLICY positions_insert_deny ON positions FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS positions_update_deny ON positions;
CREATE POLICY positions_update_deny ON positions FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS positions_delete_deny ON positions;
CREATE POLICY positions_delete_deny ON positions FOR DELETE
  USING (false);

COMMENT ON POLICY positions_read ON positions IS
  'Allocators reading published strategies they hold AND managers reading their own. Mirrors position_snapshots_read (034). See migration 040.';

-- --------------------------------------------------------------------------
-- STEP 4: updated_at trigger
-- --------------------------------------------------------------------------
-- Same pattern as compute_jobs (migration 032 step 6).
CREATE OR REPLACE FUNCTION positions_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS positions_set_updated_at_trigger ON positions;
CREATE TRIGGER positions_set_updated_at_trigger
  BEFORE UPDATE ON positions
  FOR EACH ROW
  EXECUTE FUNCTION positions_set_updated_at();

-- --------------------------------------------------------------------------
-- STEP 5: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_rls_enabled BOOLEAN;
BEGIN
  -- 1. table exists
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'positions'
  ) THEN
    RAISE EXCEPTION 'Migration 040 failed: positions table missing';
  END IF;

  -- 2. key columns exist
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'positions'
      AND column_name = 'roi'
  ) THEN
    RAISE EXCEPTION 'Migration 040 failed: positions.roi column missing';
  END IF;

  -- 3. indexes exist
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'positions_strategy_status') THEN
    RAISE EXCEPTION 'Migration 040 failed: positions_strategy_status index missing';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'positions_strategy_symbol_opened') THEN
    RAISE EXCEPTION 'Migration 040 failed: positions_strategy_symbol_opened index missing';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'positions_strategy_roi') THEN
    RAISE EXCEPTION 'Migration 040 failed: positions_strategy_roi index missing';
  END IF;

  -- 4. RLS enabled
  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'positions'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'Migration 040 failed: RLS not enabled on positions';
  END IF;

  -- 5. read policy present
  IF NOT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'positions'
      AND policyname = 'positions_read'
  ) THEN
    RAISE EXCEPTION 'Migration 040 failed: positions_read policy missing';
  END IF;

  -- 6. updated_at trigger present
  IF NOT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'positions'
      AND t.tgname = 'positions_set_updated_at_trigger'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Migration 040 failed: positions_set_updated_at_trigger missing';
  END IF;

  RAISE NOTICE 'Migration 040: positions table + 3 indexes + RLS + updated_at trigger installed and verified.';
END
$$;

COMMIT;
