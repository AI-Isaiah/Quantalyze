-- Migration 113: positions atomic rebuild RPC
--
-- WHAT
-- Adds a SECURITY DEFINER RPC `reconstruct_positions_atomic(p_strategy_id,
-- p_positions)` that performs DELETE-then-INSERT of all positions for a
-- single strategy in ONE transaction (the function body), guarded by
-- pg_advisory_xact_lock(hashtext(p_strategy_id::text)) so concurrent
-- recompute ticks serialize cleanly per-strategy.
--
-- WHY (root-cause, audit-2026-05-07 G12.C.1 + G12.C.2)
-- analytics-service/services/position_reconstruction.py:740-757 ran
--   1. supabase.table('positions').delete().eq('strategy_id', X).execute()
--   2. for batch in chunks(rows, 100): supabase.table('positions').insert(batch).execute()
-- as TWO independent PostgREST round-trips with NO transaction wrapper
-- and no advisory lock. Three separate failure modes were observed in
-- production:
--   - DELETE succeeds; an INSERT batch raises (RLS hiccup, payload limit,
--     network blip, schema drift). The strategy ends up with PARTIAL or
--     ZERO positions. analytics_runner only logged a warning and flagged
--     position_metrics_failed → user saw a self-contradictory dashboard
--     ("Total: 23 / Closed: 23 / Best Trades: empty / Worst Trades: empty").
--   - DELETE succeeds mid-cron-tick; concurrent allocator dashboard read
--     hits the empty positions table while strategy_analytics still claims
--     total_positions=23. PositionsTab.tsx's "no positions reconstructed
--     yet" empty-state never fires because trade_metrics is non-empty.
--   - Two cron ticks for the same strategy interleave (15-min sync_trades
--     + 15-min compute_analytics overlap on long-running strategies).
--     Each issues its own DELETE+INSERT pair; whichever DELETE lands last
--     wipes the other's writes.
--
-- The fix: a single SECURITY DEFINER plpgsql function that takes the full
-- snapshot of positions as JSONB and performs DELETE+INSERT inside its
-- own transaction (PL/pgSQL function bodies run in a single subtransaction;
-- if any statement raises the entire body rolls back). An advisory xact
-- lock keyed off `hashtext(p_strategy_id::text)` mirrors the sync_trades
-- pattern (007_security_hardening.sql L27-style) so two ticks for the
-- same strategy serialize without locking unrelated strategies.
--
-- ROLLBACK
-- DROP FUNCTION reconstruct_positions_atomic(uuid, jsonb); the Python
-- caller falls back via try/except is NOT installed — Python now hard-
-- depends on this RPC. To roll back, also revert the position_reconstruction.py
-- diff that introduced the RPC call.
--
-- ORDERING NOTE (vs migration 114)
-- This migration is intentionally numbered BEFORE 114 (which adds a
-- UNIQUE (strategy_id, symbol, side, opened_at) constraint and a
-- duration_seconds column to positions). 113 does NOT depend on either:
-- the column list below matches the EXISTING 040+044+092 schema only.
-- Once 114 lands, the RPC will continue to work because INSERT pulls the
-- column set from the JSONB payload and ignores keys missing from the
-- payload (i.e. duration_seconds is sourced from the Python writer once
-- 114 is applied).

BEGIN;

-- --------------------------------------------------------------------
-- positions.duration_seconds (paired with G12.C.9 + G12.D.3)
-- --------------------------------------------------------------------
-- Adversarial-review hardening (PR #140 follow-up): ensure the
-- positions.duration_seconds column exists at migration-apply time so
-- the RPC's INSERT projection below can write it. Migration 114
-- (PR #139) also adds this column with IF NOT EXISTS — both migrations
-- are idempotent, so whichever lands first wins and the other is a
-- no-op for this column. Without this, the original 113 omitted the
-- column from INSERT and the Python writer's duration_seconds value
-- would be silently discarded forever (defeating G12.C.9).
ALTER TABLE positions ADD COLUMN IF NOT EXISTS duration_seconds BIGINT NULL;

-- --------------------------------------------------------------------
-- reconstruct_positions_atomic
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION reconstruct_positions_atomic(
  p_strategy_id UUID,
  p_positions   JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  IF p_strategy_id IS NULL THEN
    RAISE EXCEPTION 'reconstruct_positions_atomic: p_strategy_id must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Per-strategy advisory lock: serializes concurrent rebuilds for the
  -- same strategy without blocking unrelated strategies. Released at
  -- COMMIT (xact-scoped). Mirrors the sync_trades hardening pattern.
  PERFORM pg_advisory_xact_lock(hashtext(p_strategy_id::text));

  -- Step 1 — wipe existing positions for this strategy. Inside the same
  -- transaction as the INSERT below, so a failure rolls both back.
  DELETE FROM positions WHERE strategy_id = p_strategy_id;

  -- Step 2 — bulk insert from the JSONB payload. Column list MUST match
  -- the Python writer in position_reconstruction.py. If the payload is
  -- NULL or empty, the SELECT yields zero rows and the INSERT is a no-op
  -- (a strategy with all positions purged is a valid state).
  IF p_positions IS NOT NULL AND jsonb_typeof(p_positions) = 'array' THEN
    INSERT INTO positions (
      strategy_id,
      symbol,
      side,
      status,
      entry_price_avg,
      exit_price_avg,
      size_base,
      size_peak,
      realized_pnl,
      fee_total,
      roi,
      duration_days,
      duration_seconds,
      opened_at,
      closed_at,
      fill_count,
      funding_pnl
    )
    SELECT
      (elem->>'strategy_id')::UUID,
      elem->>'symbol',
      elem->>'side',
      elem->>'status',
      (elem->>'entry_price_avg')::NUMERIC,
      NULLIF(elem->>'exit_price_avg', '')::NUMERIC,
      (elem->>'size_base')::NUMERIC,
      (elem->>'size_peak')::NUMERIC,
      NULLIF(elem->>'realized_pnl', '')::NUMERIC,
      NULLIF(elem->>'fee_total', '')::NUMERIC,
      NULLIF(elem->>'roi', '')::NUMERIC,
      NULLIF(elem->>'duration_days', '')::NUMERIC,
      NULLIF(elem->>'duration_seconds', '')::BIGINT,
      (elem->>'opened_at')::TIMESTAMPTZ,
      NULLIF(elem->>'closed_at', '')::TIMESTAMPTZ,
      COALESCE((elem->>'fill_count')::INTEGER, 0),
      COALESCE((elem->>'funding_pnl')::NUMERIC, 0)
    FROM jsonb_array_elements(p_positions) AS elem;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  ELSE
    v_inserted := 0;
  END IF;

  RAISE NOTICE 'reconstruct_positions_atomic: strategy=% inserted=%', p_strategy_id, v_inserted;
END;
$$;

COMMENT ON FUNCTION reconstruct_positions_atomic(UUID, JSONB) IS
  'Atomic DELETE-then-INSERT of positions for a single strategy. Acquires pg_advisory_xact_lock(hashtext(strategy_id)) so concurrent recompute ticks serialize per-strategy. Body runs in a single transaction — partial INSERT failure rolls back the DELETE so the strategy never observes empty positions mid-tick. See migration 113 + audit-2026-05-07 G12.C.1/G12.C.2.';

-- --------------------------------------------------------------------
-- Grants — service_role only (the Python worker calls this via the
-- service-role JWT). PUBLIC, anon, authenticated explicitly denied.
-- --------------------------------------------------------------------
REVOKE ALL ON FUNCTION reconstruct_positions_atomic(UUID, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reconstruct_positions_atomic(UUID, JSONB)
  TO service_role;

-- --------------------------------------------------------------------
-- Self-verifying assertion — the function exists with the right
-- signature after this migration applies.
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'reconstruct_positions_atomic'
      AND pg_get_function_identity_arguments(p.oid) = 'p_strategy_id uuid, p_positions jsonb';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Migration 113 invariant violated: reconstruct_positions_atomic(uuid, jsonb) not found (count=%)', v_count;
  END IF;

  RAISE NOTICE 'Migration 113 applied: reconstruct_positions_atomic(uuid, jsonb) is installed.';
END;
$$;

COMMIT;
