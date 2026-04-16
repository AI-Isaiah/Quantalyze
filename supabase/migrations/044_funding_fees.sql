-- Migration 044: funding_fees table + positions.funding_pnl + sync_funding kind
-- Funding Rate Cutover: separates perpetual funding payments from trade P&L
--
-- Why this migration exists
-- -------------------------
-- Prior to this migration, perpetual-futures funding payments were routed
-- through exchange.py `fapiPrivate_get_income` (Binance) into the trades
-- table as `daily_pnl` rows with a synthesized price field that aggregated
-- REALIZED_PNL + COMMISSION + FUNDING_FEE into one undifferentiated number.
-- OKX `private_get_account_bills` and Bybit `private_get_v5_position_closed_pnl`
-- do the same (their endpoints return the combined cashflow).
--
-- Consequences:
--   1. The reconciliation engine cannot distinguish funding from
--      realized-trade P&L → every perp flags as discrepant.
--   2. PositionsTab tooltip shows "Price ROI excludes funding" but actually
--      can't exclude it — the number is already contaminated.
--   3. Separating funding from price-ROI is a prerequisite for accurate
--      per-position attribution (a long-perp holder with flat price but
--      paying 3× 0.01% funding/day over 30 days has a real economic loss
--      that `realized_pnl` currently masks).
--
-- Forward-only cutover architecture
-- ---------------------------------
-- Both /plan-eng-review voices flagged the naive "retroactively strip
-- FUNDING_FEE from daily_pnl" migration as unsafe: daily_pnl rows are
-- aggregated (lossy) — we cannot reliably subtract the historical funding
-- component from the combined number without re-fetching source data.
--
-- Instead:
--   (a) Code change in exchange.py stops routing FUNDING_FEE into daily_pnl
--       on go-forward syncs.
--   (b) This migration creates the funding_fees table + positions.funding_pnl
--       column so future reconstruction runs can attribute funding to the
--       right position.
--   (c) `scripts/backfill_funding.py` fetches the last 90 days of funding
--       from exchanges' dedicated endpoints (FUNDING_FEE filter on
--       fapiPrivate_get_income, OKX account_bills type=8, Bybit
--       v5_account_transaction_log SETTLEMENT type). This gives us the
--       SAME historical truth the daily_pnl rows were silently carrying,
--       but now broken out by (exchange, symbol, 8-hour funding bucket).
--   (d) position_reconstruction.py sums matching funding_fees rows into
--       positions.funding_pnl during each reconstruct_positions run.
--
-- Existing daily_pnl rows are NOT rewritten. They retain their historical
-- funding component; rolling them back is strictly a code-only concern
-- (git revert the exchange.py line change). The funding_fees table is
-- additive and harmless if the reconstruction path is rolled back.
--
-- Match key design (Grok eng review recommendation)
-- -------------------------------------------------
-- Bybit rotates funding-fee IDs across API responses, so primary dedup
-- cannot be on the raw exchange fill_id alone. Instead we compute a
-- deterministic match_key:
--   strategy_id || ':' || exchange || ':' || symbol || ':' ||
--     date_trunc('8 hours', timestamp AT TIME ZONE 'UTC')
-- This collapses all funding events in the same 8-hour window (matching
-- Binance/OKX/Bybit's 3× daily funding cadence) into one canonical row.
-- Re-running the backfill on the same window is idempotent.
--
-- What this migration does
-- ------------------------
-- 1. Creates funding_fees table with match_key as the dedup primary-ish
--    column (UNIQUE constraint, not PK — keeps `id` as the FK target).
-- 2. Adds indexes for (strategy_id, timestamp DESC) and
--    (exchange, symbol, timestamp) query paths.
-- 3. Enables RLS. Read policy joins through strategies.user_id = auth.uid().
--    All writes are service-role only.
-- 4. Adds positions.funding_pnl NUMERIC NOT NULL DEFAULT 0.
--    (total_pnl_with_funding is computed client-side as realized_pnl + funding_pnl;
--     no generated stored column — avoids full table rewrite + storage overhead.)
-- 5. Registers 'sync_funding' in compute_job_kinds.
-- 6. Self-verifying DO block.
--
-- What this migration does NOT do
-- -------------------------------
-- - Does NOT rewrite existing daily_pnl rows. See rationale above.
-- - Does NOT backfill funding_fees automatically. Run
--   `scripts/backfill_funding.py` after migration + deploy.
-- - Does NOT schedule the sync_funding cron — that lives in vercel.json.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: funding_fees table
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS funding_fees (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id   UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  exchange      TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  amount        NUMERIC NOT NULL,
  currency      TEXT NOT NULL,
  timestamp     TIMESTAMPTZ NOT NULL,
  match_key     TEXT NOT NULL UNIQUE,
  raw_data      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE funding_fees IS
  'Perpetual-futures funding payments, one row per 8-hour funding window per (strategy, exchange, symbol). Signed amount: positive = received, negative = paid. Populated by the sync_funding worker kind + scripts/backfill_funding.py. See migration 044.';

COMMENT ON COLUMN funding_fees.amount IS
  'Signed funding amount in `currency` units. Positive = strategy received funding (short perp in contango, long perp in backwardation). Negative = strategy paid.';

COMMENT ON COLUMN funding_fees.match_key IS
  'Deterministic dedup key: strategy_id:exchange:symbol:8h-bucket(timestamp). UNIQUE so re-running the backfill on the same window is idempotent. Addresses Bybit fill_id rotation.';

COMMENT ON COLUMN funding_fees.raw_data IS
  'Original exchange response row, preserved for audit and debugging.';

-- --------------------------------------------------------------------------
-- STEP 2: indexes
-- --------------------------------------------------------------------------

-- Per-strategy timeline — the position_reconstruction join filters by
-- strategy_id and orders by timestamp to attribute funding to the right
-- position window.
CREATE INDEX IF NOT EXISTS funding_fees_strategy_timestamp
  ON funding_fees (strategy_id, timestamp DESC);

-- Cross-strategy symbol lookup (admin diagnostics, per-market funding
-- analysis).
CREATE INDEX IF NOT EXISTS funding_fees_exchange_symbol_timestamp
  ON funding_fees (exchange, symbol, timestamp);

-- --------------------------------------------------------------------------
-- STEP 3: RLS
-- --------------------------------------------------------------------------
ALTER TABLE funding_fees ENABLE ROW LEVEL SECURITY;

-- Funding fee data is tenant-isolated: only the owning manager can read their
-- strategy's funding rows. Allocator aggregation happens via the service-role
-- client (bypasses RLS), so allocators never need direct row access.
DROP POLICY IF EXISTS funding_fees_read ON funding_fees;
CREATE POLICY funding_fees_read ON funding_fees FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM strategies s
    WHERE s.id = funding_fees.strategy_id
      AND s.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS funding_fees_insert_deny ON funding_fees;
CREATE POLICY funding_fees_insert_deny ON funding_fees FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS funding_fees_update_deny ON funding_fees;
CREATE POLICY funding_fees_update_deny ON funding_fees FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS funding_fees_delete_deny ON funding_fees;
CREATE POLICY funding_fees_delete_deny ON funding_fees FOR DELETE
  USING (false);

COMMENT ON POLICY funding_fees_read ON funding_fees IS
  'Manager-only: only the owning strategy manager can read their funding rows. Allocator aggregation goes via service-role (bypasses RLS). Cross-tenant leak prevention.';

-- --------------------------------------------------------------------------
-- STEP 4: positions.funding_pnl
-- --------------------------------------------------------------------------
-- Note: total_pnl_with_funding is intentionally NOT a generated stored column.
-- A GENERATED STORED column forces a full table rewrite on the hot positions
-- table and adds storage cost for a trivial sum. Consumers compute
-- realized_pnl + funding_pnl client-side instead.
ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS funding_pnl NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN positions.funding_pnl IS
  'Sum of funding_fees.amount over [opened_at, closed_at] for (strategy_id, symbol). Populated by reconstruct_positions after funding_fees ingestion. Additive to realized_pnl (price-only ROI). Total economic P&L = realized_pnl + funding_pnl (computed client-side). See migration 044.';

-- --------------------------------------------------------------------------
-- STEP 5: register sync_funding kind
-- --------------------------------------------------------------------------
-- The compute_job_kinds registry uses `name` as the PK (see migration 032).
INSERT INTO compute_job_kinds (name) VALUES ('sync_funding')
  ON CONFLICT (name) DO NOTHING;

-- --------------------------------------------------------------------------
-- STEP 6: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_rls_enabled BOOLEAN;
BEGIN
  -- 1. funding_fees table exists
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'funding_fees'
  ) THEN
    RAISE EXCEPTION 'Migration 044 failed: funding_fees table missing';
  END IF;

  -- 2. match_key UNIQUE constraint
  IF NOT EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'funding_fees'
      AND indexdef ILIKE '%UNIQUE%match_key%'
  ) THEN
    RAISE EXCEPTION 'Migration 044 failed: funding_fees.match_key UNIQUE missing';
  END IF;

  -- 3. indexes exist
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'funding_fees_strategy_timestamp') THEN
    RAISE EXCEPTION 'Migration 044 failed: funding_fees_strategy_timestamp index missing';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'funding_fees_exchange_symbol_timestamp') THEN
    RAISE EXCEPTION 'Migration 044 failed: funding_fees_exchange_symbol_timestamp index missing';
  END IF;

  -- 4. RLS enabled
  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'funding_fees'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'Migration 044 failed: RLS not enabled on funding_fees';
  END IF;

  -- 5. read policy present
  IF NOT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'funding_fees'
      AND policyname = 'funding_fees_read'
  ) THEN
    RAISE EXCEPTION 'Migration 044 failed: funding_fees_read policy missing';
  END IF;

  -- 6. positions.funding_pnl column present with NOT NULL DEFAULT 0
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'positions'
      AND column_name = 'funding_pnl'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Migration 044 failed: positions.funding_pnl column missing or nullable';
  END IF;

  -- 7. sync_funding kind registered
  IF NOT EXISTS(
    SELECT 1 FROM compute_job_kinds WHERE name = 'sync_funding'
  ) THEN
    RAISE EXCEPTION 'Migration 044 failed: sync_funding kind not registered in compute_job_kinds';
  END IF;

  RAISE NOTICE 'Migration 044: funding_fees + positions.funding_pnl (no generated column) + sync_funding kind installed and verified.';
END
$$;

COMMIT;
