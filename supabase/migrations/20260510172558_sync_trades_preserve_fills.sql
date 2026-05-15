-- Migration 102: sync_trades RPC must NOT wipe raw fills (audit-2026-05-07 G12.A.1)
--
-- Why this migration exists
-- -------------------------
-- The original sync_trades RPC (migration 007:42) starts with an
-- unconditional `DELETE FROM trades WHERE strategy_id = p_strategy_id`
-- before re-inserting the JSONB-supplied rows. When migration 039
-- introduced the raw-fill ingestion path (Phase 2: `is_fill = true` rows
-- written directly via PostgREST upsert with the
-- `trades_dedup_fill` partial unique index), the DELETE became a
-- destructive cross-phase invariant violation:
--
--   * Phase 1 path (this RPC) writes legacy daily_pnl summary rows
--     (`is_fill = false`) and is the sole supported channel for that
--     shape.
--   * Phase 2 path (job_worker.run_sync_trades_job after the
--     USE_RAW_TRADE_INGESTION feature flag) writes per-fill rows
--     (`is_fill = true`) directly via `.upsert(... on_conflict=..., ignore_duplicates=true)`.
--
-- Phase 1 currently runs BEFORE Phase 2 in the worker. Every successful
-- Phase 1 run therefore wipes whatever Phase 2 had persisted on the
-- previous tick. The worker comment at job_worker.py:575 already calls
-- this out ("Cannot use sync_trades RPC — it DELETE+INSERTs, which
-- would destroy Phase 1 daily_pnl") but the comment guards the worker
-- only — anyone (cron, admin script, future caller) that hits the RPC
-- still wipes raw fills.
--
-- Compounding hazard (G12.A.2): the compute_jobs queue's watchdog
-- reclaims sync_trades jobs after 15 minutes. A worker that successfully
-- writes some Phase 2 rows then crashes before Phase 1 commits will be
-- reclaimed; the retry's Phase 1 DELETE wipes those Phase 2 rows. With
-- the filter in this migration the retry is harmless.
--
-- The Postgres-grade fix is to scope Phase 1's DELETE to legacy
-- (non-fill) rows only:
--
--   DELETE FROM trades
--   WHERE strategy_id = p_strategy_id
--     AND COALESCE(is_fill, false) = false;
--
-- This preserves any Phase 2 fills that have been ingested in prior
-- runs while still letting Phase 1 own its summary-row replacement
-- contract. The advisory transaction lock is unchanged so the existing
-- per-strategy serialization invariant still holds.
--
-- Idempotency: the function body is replaced via CREATE OR REPLACE, so
-- re-running this migration is safe. The EXECUTE grants from migration
-- 021 (REVOKE FROM PUBLIC, anon, authenticated) survive CREATE OR
-- REPLACE; the function ACL is preserved across the DDL.
--
-- Tests: a regression test will assert that an is_fill=true row with a
-- distinct exchange_fill_id survives a sync_trades call replacing a
-- daily_pnl payload (see analytics-service/tests).

CREATE OR REPLACE FUNCTION sync_trades(
  p_strategy_id UUID,
  p_trades JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  trade_count INTEGER;
BEGIN
  -- Acquire advisory lock scoped to this transaction (auto-released on
  -- commit/rollback). Same per-strategy serialization invariant as
  -- migration 007.
  PERFORM pg_advisory_xact_lock(hashtext(p_strategy_id::text));

  -- Delete only legacy (non-fill) rows. is_fill=true rows are owned by
  -- the Phase 2 raw-fill ingestion path and persist across Phase 1
  -- replacements. COALESCE() defends against any pre-migration-039 rows
  -- that may carry NULL is_fill (the column DEFAULT is false but a
  -- column-add ALTER on a populated table can produce NULL until the
  -- backfill finalizes).
  DELETE FROM trades
  WHERE strategy_id = p_strategy_id
    AND COALESCE(is_fill, false) = false;

  -- Insert new daily_pnl summary rows from JSONB array. is_fill is
  -- omitted from the column list and falls back to the trades.is_fill
  -- column DEFAULT false (migration 039:46), keeping legacy semantics.
  INSERT INTO trades (strategy_id, exchange, symbol, side, price, quantity, fee, fee_currency, timestamp, order_type)
  SELECT
    p_strategy_id,
    (t->>'exchange')::text,
    (t->>'symbol')::text,
    (t->>'side')::text,
    (t->>'price')::decimal,
    (t->>'quantity')::decimal,
    COALESCE((t->>'fee')::decimal, 0),
    COALESCE(t->>'fee_currency', 'USDT'),
    (t->>'timestamp')::timestamptz,
    COALESCE(t->>'order_type', 'market')
  FROM jsonb_array_elements(p_trades) AS t;

  GET DIAGNOSTICS trade_count = ROW_COUNT;
  RETURN trade_count;
END;
$$;

COMMENT ON FUNCTION sync_trades(UUID, JSONB) IS
  'Phase-1 daily_pnl replacement for a strategy. DELETEs only is_fill=false rows so Phase 2 raw fills (migration 039) are preserved. Migration 102 (audit-2026-05-07 G12.A.1).';

-- Self-verification: confirm the redefined function has the expected
-- DELETE clause. We assert via pg_get_functiondef so a future migration
-- that drops the is_fill filter without realizing it fails loudly here.
DO $$
DECLARE
  function_body TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO function_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'sync_trades'
      AND pg_get_function_arguments(p.oid) ILIKE '%uuid%jsonb%';

  IF function_body IS NULL THEN
    RAISE EXCEPTION 'Migration 102 verification failed: sync_trades(UUID, JSONB) not found after CREATE OR REPLACE';
  END IF;

  IF function_body NOT ILIKE '%COALESCE(is_fill, false) = false%' THEN
    RAISE EXCEPTION
      'Migration 102 verification failed: sync_trades body does not include the COALESCE(is_fill, false) = false guard. Body:%s',
      E'\n' || function_body;
  END IF;
END $$;
