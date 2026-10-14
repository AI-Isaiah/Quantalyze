-- ============================================================================
-- ROLLBACK for 20261014120000_api_keys_history_reconstruct_marker.sql
-- Phase 167.1.2.1 RECONMARKER, plan 01 (PR 1), decisions D-04, D-05, D-12, D-13.
-- ============================================================================
-- ⚠️ MARKER VALUES ARE LOST WITH THE COLUMNS. history_reconstructed_at and
-- history_reconstruct_attempts are dropped, so every key goes back to being
-- inferred from compute_jobs and allocator_equity_snapshots. A key reconstructed
-- more than 30 days ago will look unreconstructed again. This file deletes no
-- job and no audit row.
--
-- ⚠️ ROLL BACK PR 2 FIRST IF IT HAS MERGED. PR 2's fan-out reads and increments
-- these columns and PR 2's Python writes the marker; dropping the columns under
-- them makes every reconstruct completion and every fan-out run fail. Revert PR 2
-- and let that deployment land, THEN run this file.
--
-- Manual, off the auto-apply path, applied by its own migration PR. What it does:
--   1. restores public.request_allocator_holdings_sync(uuid) to
--      20260924233749's body, COMMENT and ACL pair, copied VERBATIM from that file
--      (never from memory). The RPC goes first so nothing reads a column that is
--      about to be dropped;
--   2. drops public.backfill_api_keys_history_reconstructed_at();
--   3. drops both columns (the CHECK and the column SELECT grant go with them).
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20261014120000 as applied. To re-apply the migration, delete
-- that ledger row in the same change (or `supabase migration repair --status
-- reverted 20261014120000` against the intended database, after the marker query
-- in CLAUDE.md names that database).
--
-- The DO block at the end is catalogue-only: it RAISEs, and so aborts the whole
-- rollback, if the restored body still names failed_retry in the reconstruct
-- gate, if either column or the backfill function survives, or if anon or
-- authenticated gained EXECUTE where it must not hold it.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ───────────── 1. 20260924233749's RPC, verbatim
CREATE OR REPLACE FUNCTION public.request_allocator_holdings_sync(p_api_key_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid                UUID := auth.uid();
  v_owner              UUID;
  v_disconnected       TIMESTAMPTZ;
  v_job_id             UUID;
  v_next_attempt       TIMESTAMPTZ;
  v_prior_reconstruct  BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, disconnected_at INTO v_owner, v_disconnected
    FROM api_keys
    WHERE id = p_api_key_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'api_key_not_found_or_not_owned'
      USING ERRCODE = '42501';
  END IF;

  -- Migration 075: reject sync on soft-disconnected keys. Checked after
  -- ownership, so a non-owner never learns the key's state, and before the
  -- in-flight look-up, so a disconnected key is never reported as queued.
  IF v_disconnected IS NOT NULL THEN
    RAISE EXCEPTION 'api_key_disconnected'
      USING ERRCODE = 'P0001';
  END IF;

  -- Migration 067: look for a live poll job BEFORE enqueuing. The enqueue
  -- helper answers a duplicate by returning the existing id, and raises
  -- nothing, so this look-up is the only way the caller can learn that its
  -- request collapsed onto a job that was already queued.
  SELECT next_attempt_at INTO v_next_attempt
    FROM compute_jobs
    WHERE api_key_id = p_api_key_id
      AND kind = 'poll_allocator_positions'
      AND status IN ('pending', 'running', 'done_pending_children')
    ORDER BY next_attempt_at DESC
    LIMIT 1;

  IF v_next_attempt IS NOT NULL THEN
    -- f8: surface queued state to the UI, which renders the exchange-cooldown
    -- helper from next_attempt_at.
    RETURN jsonb_build_object(
      'already_inflight', true,
      'next_attempt_at', v_next_attempt
    );
  END IF;

  -- No live job, so enqueue a fresh one. Two concurrent calls that both got
  -- past the look-up collapse onto one row inside the enqueue helper, and the
  -- loser receives the winner's id (the accepted race, see the file header).
  v_job_id := enqueue_compute_job(
    p_strategy_id := NULL,
    p_kind        := 'poll_allocator_positions',
    p_api_key_id  := p_api_key_id
  );

  -- Per-api_key reconstruction gate (replaces migration 070's allocator-
  -- scoped snapshot-count check). Skip enqueue ONLY if THIS key has
  -- previously completed a reconstruct OR is currently in-flight.
  SELECT EXISTS (
    SELECT 1 FROM compute_jobs
    WHERE api_key_id = p_api_key_id
      AND kind = 'reconstruct_allocator_history'
      AND status IN ('done','pending','running','done_pending_children')
  ) INTO v_prior_reconstruct;

  IF NOT v_prior_reconstruct THEN
    BEGIN
      PERFORM enqueue_compute_job(
        p_strategy_id     := NULL,
        p_kind            := 'reconstruct_allocator_history',
        p_idempotency_key := 'reconstruct-alloc-' || p_api_key_id::text || '-initial',
        p_api_key_id      := p_api_key_id
      );
    EXCEPTION WHEN unique_violation THEN
      NULL; -- racing first-connect call landed first; benign
    END;
  END IF;

  UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_allocator_holdings_sync(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_allocator_holdings_sync(uuid) TO authenticated;

COMMENT ON FUNCTION public.request_allocator_holdings_sync(uuid) IS
  'Authenticated wrapper for a holdings sync request. Returns {already_inflight: true, next_attempt_at} when a poll_allocator_positions job for the key is already pending, running or done_pending_children; otherwise enqueues one and returns {ok: true, job_id}, and for an api_key with no prior reconstruct_allocator_history job (done or in-flight) also enqueues that. Raises 42501 for an unauthenticated caller or a key the caller does not own, and P0001 api_key_disconnected for a soft-disconnected key. Phase 164.9.1: restores migration 067''s in-flight look-up and migration 075''s disconnected-key refusal on migration 076''s per-api_key reconstruct gate.';

-- ───────────── 2. the backfill function
DROP FUNCTION public.backfill_api_keys_history_reconstructed_at();

-- ───────────── 3. the columns (the CHECK and the column grant go with them)
ALTER TABLE public.api_keys
  DROP COLUMN history_reconstruct_attempts,
  DROP COLUMN history_reconstructed_at;

-- ───────────── 4. verify — CATALOGUE ONLY
DO $verify$
DECLARE
  v_body text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'api_keys'
       AND column_name IN ('history_reconstructed_at', 'history_reconstruct_attempts')
  ) THEN
    RAISE EXCEPTION 'Rollback 20261014120000 failed: a history_reconstruct column survives on api_keys';
  END IF;

  IF to_regprocedure('public.backfill_api_keys_history_reconstructed_at()') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261014120000 failed: the backfill function survives';
  END IF;

  IF to_regprocedure('public.request_allocator_holdings_sync(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261014120000 failed: request_allocator_holdings_sync(uuid) is missing';
  END IF;
  v_body := regexp_replace(regexp_replace(pg_get_functiondef('public.request_allocator_holdings_sync(uuid)'::regprocedure), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_body IS NULL OR v_body ~ 'failed_retry' OR v_body ~ 'history_reconstructed_at' THEN
    RAISE EXCEPTION 'Rollback 20261014120000 failed: the restored RPC body is unreadable or still names failed_retry or history_reconstructed_at';
  END IF;
  PERFORM public._assert_no_public_execute('public.request_allocator_holdings_sync(uuid)');
  IF has_function_privilege('anon', 'public.request_allocator_holdings_sync(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.request_allocator_holdings_sync(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261014120000 failed: the RPC ACL did not converge (anon must not, authenticated must hold EXECUTE)';
  END IF;

  RAISE NOTICE 'Rollback 20261014120000: 20260924233749''s RPC body restored, the backfill function and both history_reconstruct columns dropped.';
END
$verify$;

COMMIT;
