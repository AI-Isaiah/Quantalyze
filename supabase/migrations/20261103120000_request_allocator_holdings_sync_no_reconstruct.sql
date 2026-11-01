-- ============================================================================
-- VAC-04 ACKNOWLEDGEMENT: the PROD body this CREATE OR REPLACE overwrites is
-- the 20261014120000 definition (section 5). It equals the committed baseline
-- snapshot on main (PROD-dumped), and main's baseline-content-drift gate reads
-- no drift for it. Overwriting it is intended. MEASURED 2026-11-01 with the
-- gate's own normalizer:
--   git show origin/main:supabase/schema/baseline.sql > <scratch>
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql <scratch>
-- reports MATCH for request_allocator_holdings_sync/1 at the hash below.
--
-- prod-body-ack: 1f3190144ca048a64c8d034538aba5e07065a1474622587eac053188ce6edb7f
--
-- ============================================================================
-- Phase 176 LEGACYRETIRE, plan 09 (PR 2, database tier), decision D-04.
-- public.request_allocator_holdings_sync(uuid) stops enqueueing a history
-- reconstruct.
-- ============================================================================
--
-- THE DECISION (CONTEXT D-04, verbatim)
-- -------------------------------------
--   D-04: "Retire the job (Recommended)". The `reconstruct_allocator_history`
--   job retires with the table. All three enqueue paths stop, including the one
--   in `request_allocator_holdings_sync`, which is re-based in a migration. The
--   handler becomes a stub that returns DONE, so already-queued jobs finish as
--   no-ops. Its `compute_job_kinds` row stays, because `compute_jobs.kind` is a
--   foreign key to it. The cap and marker machinery is left inert, and its
--   removal is booked as a follow-up.
--
-- THE RE-BASE (measured at authoring with `grep -l` over supabase/migrations)
-- ---------------------------------------------------------------------------
-- The newest definer of this function is
-- 20261014120000_api_keys_history_reconstruct_marker.sql (section 5). This file
-- re-bases on that body and REMOVES, and only removes:
--   * the two declarations `v_prior_reconstruct` and `v_reconstructed_at`;
--   * the comment block that opens "Per-api_key reconstruction gate";
--   * the existence probe over this key's reconstruct jobs;
--   * the read of the key's history marker and the fold of it into the probe;
--   * the guarded block that enqueued the reconstruct job, with its
--     benign-collision exception handler.
-- Everything else is copied byte for byte: the authentication refusal, the
-- ownership check, the soft-disconnect refusal, the in-flight poll look-up and
-- its early return, the poll enqueue, the sync_status update and both return
-- shapes. SECURITY DEFINER, the `search_path = public, pg_catalog` pin and the
-- ACL (PUBLIC and anon revoked, authenticated granted) are unchanged and are
-- re-issued below with the full signature.
--
-- WHAT THIS FILE DOES NOT DO
-- --------------------------
--   * The `reconstruct_allocator_history` compute_job_kinds row STAYS, because
--     compute_jobs.kind is a foreign key to it and historical rows reference it
--     (the 20260716090000 precedent). The analytics worker already finishes any
--     queued job of that kind as a no-op (plan 08), so a job enqueued by an
--     older RPC body is harmless.
--   * The daily cron path stops by a hand-run unschedule in plan 12, and the
--     operator force path stops when its runbook procedure is retired in plan
--     10. Neither is done here. This file has no cron statement.
--   * The marker column and the attempts column on api_keys stay, inert
--     (D-04: their removal is a booked follow-up).
--
-- NO EXPLICIT TRANSACTION. This file carries no BEGIN and no COMMIT (invariant
-- 14): the migration runner wraps each file in its own transaction, and an inner
-- COMMIT would end it early and let the statements below run outside it.
--
-- NO DATA CENSUS. The verify block below reads the catalogue only (pg_proc and
-- friends), so it passes on an empty database. Shared TEST holds the schema and
-- none of PROD's rows, and a verify that read a count would refuse there and
-- block the PROD apply.
--
-- WHY THE VERIFY ASSERTS NO BODY TEXT. The mutation twins of
-- supabase/tests/test_api_keys_history_reconstruct_marker.sql edit this file
-- (a re-inserted enqueue, a widened poll look-up list). A verify that matched
-- body text would RAISE under those edits and the runner would score a defect
-- with no arm identity. The behavioural proof is arms R3 and R4 of that gate.
--
-- ROLLBACK: supabase/migrations/down/20261103120000-rollback.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- Schema-qualified deliberately: an unqualified CREATE OR REPLACE resolves
-- against the SESSION search_path, and under one that does not put public first
-- it CREATES a second function elsewhere, which arrives with default privileges.
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

  UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_allocator_holdings_sync(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_allocator_holdings_sync(uuid) TO authenticated;

COMMENT ON FUNCTION public.request_allocator_holdings_sync(uuid) IS
  'Authenticated wrapper for a holdings sync request. Returns {already_inflight: true, next_attempt_at} when a poll_allocator_positions job for the key is already pending, running or done_pending_children; otherwise enqueues one and returns {ok: true, job_id}. Raises 42501 for an unauthenticated caller or a key the caller does not own, and P0001 api_key_disconnected for a soft-disconnected key. Phase 164.9.1: restores migration 067''s in-flight look-up and migration 075''s disconnected-key refusal. Phase 176 D-04: it no longer enqueues a reconstruct_allocator_history job; the history reconstruct is retired.';

-- ───────────── self-verify — CATALOGUE ONLY, reads no row, passes on an empty
-- database. It asserts no body text (see the header).
DO $verify$
DECLARE
  v_oid     oid;
  v_n       int;
  v_secdef  boolean;
  v_cfg     text[];
  c_sig     CONSTANT text := 'public.request_allocator_holdings_sync(uuid)';
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'request_allocator_holdings_sync';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'request-sync-no-reconstruct: expected exactly one public.request_allocator_holdings_sync overload, found %; a second overload would arrive with default privileges', v_n;
  END IF;

  v_oid := to_regprocedure(c_sig);
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'request-sync-no-reconstruct: public.request_allocator_holdings_sync(uuid) not found';
  END IF;

  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = v_oid;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'request-sync-no-reconstruct: request_allocator_holdings_sync is not SECURITY DEFINER; it reads and writes rows the caller cannot';
  END IF;
  IF v_cfg IS DISTINCT FROM ARRAY['search_path=public, pg_catalog']::text[] THEN
    RAISE EXCEPTION 'request-sync-no-reconstruct: request_allocator_holdings_sync proconfig is %, expected exactly {"search_path=public, pg_catalog"}', v_cfg;
  END IF;

  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'request-sync-no-reconstruct: the anon or authenticated role does not exist on this database, so the ACL cannot be evaluated. These are Supabase-standard roles; their absence means this migration is running somewhere it was not written for.';
  END IF;

  -- PUBLIC first, so a PUBLIC leak is named as a PUBLIC leak. A NULL proacl is
  -- the default ACL, which grants EXECUTE to PUBLIC.
  IF EXISTS (
    SELECT 1
      FROM pg_proc p,
           LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'request-sync-no-reconstruct: PUBLIC holds EXECUTE on request_allocator_holdings_sync';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'request-sync-no-reconstruct: anon holds EXECUTE on request_allocator_holdings_sync; an unauthenticated caller must be refused by the grant, not only by the body';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'request-sync-no-reconstruct: authenticated lost EXECUTE on request_allocator_holdings_sync; every holdings sync request from the app would fail';
  END IF;

  RAISE NOTICE 'request-sync-no-reconstruct: one overload, SECURITY DEFINER, search_path pinned to public, pg_catalog, PUBLIC and anon refused, authenticated granted.';
END
$verify$;
