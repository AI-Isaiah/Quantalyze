-- Migration 034: position_snapshots table
-- Sprint 3 Task 3.2: Forward-going position polling
--
-- Ordering note: this migration ships BEFORE 036 (poll_positions kind) so
-- the table exists before any job can possibly execute against it. Codex
-- + Grok final pass 2026-04-11 flagged the reverse ordering as a race
-- window — the worker could dequeue a poll_positions job and try to write
-- to a table that didn't exist yet.
--
-- Why this migration exists
-- -------------------------
-- Sprint 3 wires the 6 placeholder widgets on the My Allocation dashboard
-- to real data. Widgets #28 Exposure by Asset and #29 Net Exposure Over
-- Time both need per-strategy position data aggregated by day. The trades
-- table only contains daily_pnl summary rows (see exchange.py
-- fetch_daily_pnl) — there are no real fills, so position reconstruction
-- from trades is not viable. The only honest way to populate position
-- history is forward-going daily polling via CCXT fetch_positions.
--
-- position_snapshots captures the daily state. One row per (strategy,
-- symbol, side) per day. Dual-side accounts (OKX hedge mode) produce two
-- rows per symbol per day (one long, one short). Net exposure queries
-- sum signed size across sides.
--
-- What this migration ships
-- -------------------------
-- 1. position_snapshots table with strategy_analytics-mirroring RLS
--    (published OR owned) so allocators who hold a published strategy in
--    their portfolio can read its position data — not just the manager
--    who owns the strategy.
-- 2. Primary ordering index (strategy_id, snapshot_date DESC).
-- 3. Partial unique index (strategy_id, snapshot_date, symbol, side) for
--    idempotent upserts from the worker.
-- 4. Self-verifying DO block.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: position_snapshots table
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS position_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id     UUID NOT NULL REFERENCES strategies ON DELETE CASCADE,
  snapshot_date   DATE NOT NULL,
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('long', 'short', 'flat')),
  size_base       DECIMAL,
  size_usd        DECIMAL,
  entry_price     DECIMAL,
  mark_price      DECIMAL,
  unrealized_pnl  DECIMAL,
  exchange        TEXT CHECK (exchange IS NULL OR exchange IN ('binance', 'okx', 'bybit')),
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE position_snapshots IS
  'Daily position snapshots per strategy. One row per (strategy, symbol, side) per day. Populated forward-going by the worker poll_positions handler. Existing strategies start with empty history; no historical reconstruction. See migration 034.';

COMMENT ON COLUMN position_snapshots.side IS
  'long = positive size, short = negative size, flat = zero (usually not stored). Dual-side accounts (OKX hedge mode) produce two rows per symbol per day.';

COMMENT ON COLUMN position_snapshots.computed_at IS
  'When the worker wrote the row. Widgets read MAX(computed_at) per strategy to render "updated Xh ago" or "stale" badges.';

-- --------------------------------------------------------------------------
-- STEP 2: indexes
-- --------------------------------------------------------------------------
-- Primary ordering: widgets query "latest N snapshots for strategy X".
CREATE INDEX IF NOT EXISTS position_snapshots_strategy_date
  ON position_snapshots (strategy_id, snapshot_date DESC);

-- Idempotent upsert target. ON CONFLICT (strategy_id, snapshot_date, symbol, side)
-- DO UPDATE lets the worker re-run safely without creating duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS position_snapshots_unique_per_day
  ON position_snapshots (strategy_id, snapshot_date, symbol, side);

-- --------------------------------------------------------------------------
-- STEP 3: RLS
-- --------------------------------------------------------------------------
-- Service-role writes via worker. User-scoped reads mirror the existing
-- strategy_analytics pattern at 002_rls_policies.sql:35-42: a strategy's
-- data is readable if the strategy is published OR owned by the caller.
--
-- This is the critical Grok-final-pass-finding-#4 fix: the earlier draft
-- spec used `strategy_id IN (SELECT id FROM strategies WHERE user_id =
-- auth.uid())` which would have blocked allocators from reading position
-- data for strategies they hold in their portfolios (since the strategies
-- are owned by the manager, not the allocator). The published-OR-owned
-- pattern allows allocators reading a published strategy (their portfolio
-- holdings) AND managers reading their own strategies (draft or published).
ALTER TABLE position_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS position_snapshots_read ON position_snapshots;
CREATE POLICY position_snapshots_read ON position_snapshots FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM strategies s
    WHERE s.id = position_snapshots.strategy_id
      AND (s.status = 'published' OR s.user_id = auth.uid())
  )
);

-- Deny all writes from non-service-role. Writes go through the worker
-- which uses the service-role client.
DROP POLICY IF EXISTS position_snapshots_insert_deny ON position_snapshots;
CREATE POLICY position_snapshots_insert_deny ON position_snapshots FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS position_snapshots_update_deny ON position_snapshots;
CREATE POLICY position_snapshots_update_deny ON position_snapshots FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS position_snapshots_delete_deny ON position_snapshots;
CREATE POLICY position_snapshots_delete_deny ON position_snapshots FOR DELETE
  USING (false);

COMMENT ON POLICY position_snapshots_read ON position_snapshots IS
  'Allocators reading published strategies they hold AND managers reading their own. Mirrors 002_rls_policies.sql:35-42 strategy_analytics pattern. See migration 034.';

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_rls_enabled BOOLEAN;
BEGIN
  -- 1. table exists
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'position_snapshots'
  ) THEN
    RAISE EXCEPTION 'Migration 034 failed: position_snapshots table missing';
  END IF;

  -- 2. indexes exist
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'position_snapshots_strategy_date') THEN
    RAISE EXCEPTION 'Migration 034 failed: position_snapshots_strategy_date index missing';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'position_snapshots_unique_per_day') THEN
    RAISE EXCEPTION 'Migration 034 failed: position_snapshots_unique_per_day index missing';
  END IF;

  -- 3. RLS enabled
  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'position_snapshots'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'Migration 034 failed: RLS not enabled on position_snapshots';
  END IF;

  -- 4. read policy present
  IF NOT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'position_snapshots'
      AND policyname = 'position_snapshots_read'
  ) THEN
    RAISE EXCEPTION 'Migration 034 failed: position_snapshots_read policy missing';
  END IF;

  RAISE NOTICE 'Migration 034: position_snapshots table + 2 indexes + RLS installed and verified.';
END
$$;

COMMIT;
