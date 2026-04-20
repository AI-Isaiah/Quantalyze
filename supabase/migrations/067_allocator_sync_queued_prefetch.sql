-- ===========================================================================
-- Migration 067: Fix ISSUE-008 — f8 Queued helper is unreachable through
-- the real sync-request path
-- ===========================================================================
-- BUG: request_allocator_holdings_sync's `EXCEPTION WHEN unique_violation`
-- handler (migration 066 STEP 7) is dead code. It was intended to catch a
-- duplicate-enqueue and return `{already_inflight, next_attempt_at}` so the
-- UI can render "Queued — exchange cooldown, retry in {N}s" during a
-- per-exchange circuit-breaker contagion window (UI-SPEC f8).
--
-- Root cause (confirmed learning `on-conflict-do-nothing-hides-violations`):
-- `_enqueue_compute_job_internal`'s optimistic lookup returns the existing
-- job's id BEFORE attempting an INSERT; the INSERT itself uses ON CONFLICT
-- DO NOTHING (swallows the SQLSTATE 23505). Neither path raises
-- unique_violation, so the outer handler never fires. The RPC always
-- returns `{ok: true, job_id}` — the client can't distinguish a fresh
-- enqueue from a duplicate.
--
-- FIX (Option B — narrow blast radius): add a pre-enqueue SELECT on
-- compute_jobs keyed by (api_key_id, kind='poll_allocator_positions',
-- status IN ('pending','running','done_pending_children')). If a live job
-- exists, return `{already_inflight, next_attempt_at}` BEFORE calling
-- enqueue_compute_job. The dead EXCEPTION handler is removed.
--
-- Why Option B over Option A (refactor _enqueue_compute_job_internal to
-- surface was_duplicate): Option A cascades through enqueue_compute_job's
-- signature and impacts 5+ callers (strategy/allocator/feedback_delta/
-- cron). This fix is a 6-line pre-check on ONE function. The other
-- callers don't need was_duplicate today.
--
-- Note on race safety: between the pre-check SELECT and the enqueue_compute_
-- job call, another transaction could race in. That's OK —
-- `_enqueue_compute_job_internal` handles it via its own optimistic lookup
-- + ON CONFLICT DO NOTHING (race-lost re-read returns the winner's id).
-- The pre-check is an optimization for the common case (helper-visible
-- queued state), not a correctness boundary.
--
-- NO ROLLBACK NEEDED at the table level — this migration only redefines
-- ONE function in-place. The rollback is: re-apply the definition from
-- migration 066 STEP 7.
-- ===========================================================================

CREATE OR REPLACE FUNCTION request_allocator_holdings_sync(p_api_key_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_owner        UUID;
  v_job_id       UUID;
  v_next_attempt TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_owner
    FROM api_keys
    WHERE id = p_api_key_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'api_key_not_found_or_not_owned'
      USING ERRCODE = '42501';
  END IF;

  -- ISSUE-008 fix: pre-check for a live inflight job. Without this, the
  -- RPC never reaches the already_inflight branch — _enqueue_compute_job_
  -- internal swallows duplicates via optimistic lookup + ON CONFLICT DO
  -- NOTHING, so no unique_violation ever bubbles up.
  SELECT next_attempt_at INTO v_next_attempt
    FROM compute_jobs
    WHERE api_key_id = p_api_key_id
      AND kind = 'poll_allocator_positions'
      AND status IN ('pending', 'running', 'done_pending_children')
    ORDER BY next_attempt_at DESC
    LIMIT 1;

  IF v_next_attempt IS NOT NULL THEN
    -- f8: surface queued state to the UI. The frontend
    -- AllocatorSyncStatus renders "Queued — exchange cooldown, retry in
    -- {N}s" when the cooldown is >=30s out.
    RETURN jsonb_build_object(
      'already_inflight', true,
      'next_attempt_at', v_next_attempt
    );
  END IF;

  -- No live job — enqueue fresh. Race window is tolerated: if two
  -- concurrent calls pass the pre-check, _enqueue_compute_job_internal's
  -- partial unique index + ON CONFLICT DO NOTHING + race-lost re-read
  -- still collapse both calls onto the same row.
  v_job_id := enqueue_compute_job(
    p_strategy_id := NULL,
    p_kind        := 'poll_allocator_positions',
    p_api_key_id  := p_api_key_id
  );

  UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
END;
$$;

COMMENT ON FUNCTION request_allocator_holdings_sync IS
  'Authenticated-GRANTed wrapper over enqueue_compute_job for POST /api/allocator/holdings/sync. Gates on auth.uid() + api_key ownership. Pre-checks compute_jobs for an inflight poll_allocator_positions job and returns {already_inflight, next_attempt_at} without enqueuing (f8). Phase 06 / D-14. Migration 067: replaced dead unique_violation handler (ISSUE-008).';

-- REVOKE/GRANT idempotent — mirrors migration 066 STEP 7.
REVOKE ALL ON FUNCTION request_allocator_holdings_sync(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION request_allocator_holdings_sync(uuid) TO authenticated;

-- ===========================================================================
-- STEP 2 — Category A: self-verify the fix
-- ===========================================================================
-- Asserts the function body (post-migration) contains the pre-check SELECT
-- and NO LONGER contains the dead unique_violation handler. Catches an
-- accidental down-migration or a partial CREATE OR REPLACE that drops the
-- new body.
DO $$
DECLARE
  v_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body
    FROM pg_proc
    WHERE proname = 'request_allocator_holdings_sync' AND pronargs = 1;

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Migration 067 failed: request_allocator_holdings_sync(uuid) missing';
  END IF;

  IF v_body NOT LIKE '%status IN (''pending'', ''running'', ''done_pending_children'')%' THEN
    RAISE EXCEPTION 'Migration 067 failed: pre-check for inflight job missing in request_allocator_holdings_sync body';
  END IF;

  IF v_body LIKE '%EXCEPTION WHEN unique_violation%' THEN
    RAISE EXCEPTION 'Migration 067 failed: dead unique_violation handler still present in request_allocator_holdings_sync';
  END IF;

  RAISE NOTICE 'Migration 067: ISSUE-008 fix verified — pre-check present, dead handler removed.';
END
$$;

-- ===========================================================================
-- STEP 3 — Category D: functional probe
-- ===========================================================================
-- Wire-level proof that a pre-existing live job causes the RPC to return
-- already_inflight. Runs as the migration role (cli_login_postgres in hosted
-- Supabase) which bypasses auth.uid() — we temporarily seed a minimal
-- auth.users row, impersonate it via set_config(request.jwt.claim.sub),
-- and call the RPC.
--
-- If this probe fails (RPC returns {ok, job_id} instead of {already_inflight,
-- next_attempt_at}), the fix is broken and the migration aborts.
DO $$
DECLARE
  v_user         UUID := gen_random_uuid();
  v_key          UUID;
  v_pinned_job   UUID;
  v_resp         JSONB;
  v_claim_before TEXT;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'issue-008-probe-' || v_user || '@invalid.local')
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, dek_encrypted, is_active)
    VALUES (gen_random_uuid(), v_user, 'binance', 'issue-008-probe', 'x', 'y', true)
    RETURNING id INTO v_key;

  -- Pin a live job in the future so the worker won't claim it and the
  -- pre-check is guaranteed to see it.
  INSERT INTO compute_jobs (
    kind, api_key_id, status, next_attempt_at, max_attempts, attempts
  ) VALUES (
    'poll_allocator_positions', v_key, 'pending',
    now() + interval '600 seconds', 3, 0
  ) RETURNING id INTO v_pinned_job;

  -- Impersonate the owner for the RPC's auth.uid() check. Save/restore
  -- the prior claim so the probe is leak-free.
  v_claim_before := current_setting('request.jwt.claim.sub', true);
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  v_resp := request_allocator_holdings_sync(v_key);

  -- Restore claim (defense-in-depth; transaction-local anyway).
  PERFORM set_config(
    'request.jwt.claim.sub',
    COALESCE(v_claim_before, ''),
    true
  );

  IF v_resp->>'already_inflight' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Migration 067 probe failed: expected already_inflight=true, got: %',
      v_resp;
  END IF;

  IF v_resp->>'next_attempt_at' IS NULL THEN
    RAISE EXCEPTION 'Migration 067 probe failed: next_attempt_at missing from response: %',
      v_resp;
  END IF;

  -- Cleanup (FK order: compute_jobs → api_keys → auth.users).
  DELETE FROM compute_jobs WHERE id = v_pinned_job;
  DELETE FROM api_keys WHERE id = v_key;
  DELETE FROM auth.users WHERE id = v_user;

  RAISE NOTICE 'Migration 067: ISSUE-008 functional probe verified — RPC returns already_inflight+next_attempt_at.';
END
$$;
