-- Migration 045: api_keys.last_fetched_trade_timestamp checkpoint
-- Sprint 5 Task 5.1a — Sync Checkpointing
--
-- Why this migration exists
-- -------------------------
-- Today `api_keys.last_sync_at` is the only checkpoint written by the
-- sync_trades worker. It is stamped once at the very end of
-- run_sync_trades_job, AFTER:
--   Phase 1: daily_pnl fetch + sync_trades RPC upsert
--   Phase 2: raw fills fetch + trades table upsert (USE_RAW_TRADE_INGESTION)
--   downstream: compute_analytics, reconstruct_positions, etc.
--
-- If Phase 2 succeeds but any downstream step fails, the job re-runs from
-- scratch — re-fetching every fill since the previous `last_sync_at`. This
-- is wasted work and adds reconciliation noise (duplicate upsert churn,
-- unnecessary exchange API load close to the 429 circuit-breaker window).
--
-- Fix: split the checkpoint into two. `last_fetched_trade_timestamp` is
-- written immediately after the raw_fills upsert succeeds — representing
-- "we have durably captured fills up to this point". `last_sync_at` keeps
-- its current semantics: "the full sync_trades pipeline completed". The
-- next run of sync_trades prefers `last_fetched_trade_timestamp` when
-- non-null so a Phase 2 success survives downstream failure.
--
-- What this migration does
-- ------------------------
-- 1. Adds api_keys.last_fetched_trade_timestamp TIMESTAMPTZ (NULLable,
--    no default). NULL means "never checkpointed" — callers fall back to
--    last_sync_at, preserving pre-migration behavior.
-- 2. Self-verifying DO block confirms the column landed.
--
-- What this migration does NOT do
-- -------------------------------
-- - Does NOT rename or touch last_sync_at. It remains the full-pipeline
--   checkpoint.
-- - Does NOT backfill. Existing rows keep NULL until the next successful
--   Phase 2 upsert writes the new cursor.
-- - Does NOT add RLS changes. api_keys already has tenant-scoped RLS from
--   earlier migrations; a new column inherits those policies.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: add last_fetched_trade_timestamp column
-- --------------------------------------------------------------------------
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS last_fetched_trade_timestamp TIMESTAMPTZ;

COMMENT ON COLUMN api_keys.last_fetched_trade_timestamp IS
  'Partial-success checkpoint for sync_trades: stamped immediately after raw fills are durably upserted (Phase 2), distinct from last_sync_at which represents full-pipeline success. NULL = never checkpointed (callers fall back to last_sync_at). Prefer this over last_sync_at when resuming since_ms. See migration 045.';

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'api_keys'
      AND column_name = 'last_fetched_trade_timestamp'
      AND data_type = 'timestamp with time zone'
      AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'Migration 045 failed: api_keys.last_fetched_trade_timestamp missing or wrong type/nullability';
  END IF;

  RAISE NOTICE 'Migration 045: api_keys.last_fetched_trade_timestamp installed and verified.';
END
$$;

COMMIT;
