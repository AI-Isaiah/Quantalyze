-- ============================================================================
-- ROLLBACK for 20261103120000_request_allocator_holdings_sync_no_reconstruct.sql
-- Phase 176 LEGACYRETIRE, plan 09 (D-04).
-- ============================================================================
-- Manual, off the auto-apply path. What it undoes:
--   Re-creates public.request_allocator_holdings_sync(uuid) as its previous
--   definition, migration 20261014120000_api_keys_history_reconstruct_marker.sql
--   (section 5): the per-key reconstruct gate (a job in flight or awaiting its
--   retry, or a set history_reconstructed_at marker) and the guarded
--   reconstruct_allocator_history enqueue with its benign-collision handler are
--   back. SECURITY DEFINER, the search_path pin and the ACL are re-issued with the
--   full signature, and the function comment is restored to its 20261014120000 text.
--
-- THE ANALYTICS WORKER STUB MAKES THIS HARMLESS. Phase 176 plan 08 turned the
-- reconstruct_allocator_history handler into a no-op that finishes the job DONE
-- without a database call. So running this file brings the enqueue back but not the
-- crawl: every reconstruct job the restored RPC queues finishes as a no-op. Restoring
-- the crawl itself is a worker rollback, not a database one.
--
-- THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261103120000 as applied while the schema no longer carries it, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that
-- ledger row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261103120000` against the intended
-- database, after the marker query in CLAUDE.md names that database).
--
-- The DO block after the change is catalogue-only and reads no row.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

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
  v_reconstructed_at   TIMESTAMPTZ;
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
  -- scoped snapshot-count check). Skip enqueue ONLY if THIS key's marker says it
  -- was reconstructed (below) OR a reconstruct for it is currently in flight.
  -- Phase 167.1.2.1 SC-5 / D-13: a job awaiting its retry (failed_retry) IS in
  -- flight. The in-flight unique index omits it, so without it here a second
  -- pending row would be inserted and a 30-minute crawl would run twice.
  -- O-2: a finished (`done`) job is NOT listed. The marker is authoritative, and
  -- a retained `done` job alone must not suppress a reconstruct (a D-15 key
  -- keeps one for up to 30 days and is still owed).
  SELECT EXISTS (
    SELECT 1 FROM compute_jobs
    WHERE api_key_id = p_api_key_id
      AND kind = 'reconstruct_allocator_history'
      AND status IN ('pending','running','done_pending_children','failed_retry')
  ) INTO v_prior_reconstruct;

  -- Phase 167.1.2.1 D-04 / O-2: the per-key marker is the decider. It outlives the
  -- 30-day job retention, and a set marker counts as a prior reconstruct.
  SELECT history_reconstructed_at INTO v_reconstructed_at
    FROM api_keys
    WHERE id = p_api_key_id;
  v_prior_reconstruct := v_prior_reconstruct OR v_reconstructed_at IS NOT NULL;

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
  'Authenticated wrapper for a holdings sync request. Returns {already_inflight: true, next_attempt_at} when a poll_allocator_positions job for the key is already pending, running or done_pending_children; otherwise enqueues one and returns {ok: true, job_id}, and for an api_key whose history_reconstructed_at marker is NULL and with no reconstruct_allocator_history job in flight (pending, running, done_pending_children) or awaiting retry (failed_retry) also enqueues that; a finished (done) job alone does not suppress it, the marker is authoritative (O-2). Raises 42501 for an unauthenticated caller or a key the caller does not own, and P0001 api_key_disconnected for a soft-disconnected key. Phase 164.9.1: restores migration 067''s in-flight look-up and migration 075''s disconnected-key refusal on migration 076''s per-api_key reconstruct gate. Phase 167.1.2.1: the reconstruct gate counts failed_retry (SC-5, D-13) and a set marker (D-04) and no longer counts a done job (O-2); the poll look-up is unchanged.';

-- ───────────── post-condition — CATALOGUE ONLY, reads no row
DO $postcondition$
DECLARE
  v_oid oid := to_regprocedure('public.request_allocator_holdings_sync(uuid)');
  v_src text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261103120000 failed: public.request_allocator_holdings_sync(uuid) is gone';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = v_oid;
  IF position('reconstruct_allocator_history' IN v_src) = 0 THEN
    RAISE EXCEPTION 'Rollback 20261103120000 failed: public.request_allocator_holdings_sync(uuid) is not the 20261014120000 definition';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid) THEN
    RAISE EXCEPTION 'Rollback 20261103120000 failed: public.request_allocator_holdings_sync(uuid) is not SECURITY DEFINER';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261103120000 failed: the ACL on public.request_allocator_holdings_sync(uuid) did not converge (anon must not, authenticated must hold EXECUTE)';
  END IF;
END
$postcondition$;

COMMIT;
