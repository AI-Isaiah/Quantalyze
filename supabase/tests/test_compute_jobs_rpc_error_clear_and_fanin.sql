-- Test: compute_jobs RPC corrections (migration
-- 20260603120000_compute_jobs_rpc_clear_error_and_gin_fanin.sql).
--
--   M-1137 / M-1138 — claim_compute_jobs + claim_compute_jobs_with_priority
--     clear last_error / error_kind on a failed_retry -> running re-claim, so a
--     re-claimed (now running) row no longer carries the prior attempt's error
--     (which get_admin_compute_jobs surfaces un-redacted).
--   G23-187-mig-01/03 — mark_compute_job_done's fan-in advance uses the
--     GIN-supported set-based `parent_job_ids @> ARRAY[p_job_id]` UPDATE, not
--     the per-child `= ANY(parent_job_ids)` FOR-loop the 20260528183100
--     strict-token rewrite had silently reverted it to.
--
-- pgTAP is not set up in this project (CLAUDE.md / Lane B), so assertions
-- RAISE EXCEPTION on failure; a clean run prints NOTICEs only. Run under
-- `psql -v ON_ERROR_STOP=1`. Run order: AFTER migration 20260603120000.
--
-- Part 2 seeds gen_random_uuid() ids inside an explicit BEGIN/ROLLBACK so a
-- concurrent CI run against the shared test project cannot collide and no row
-- is left behind even on assertion failure.

-- ==========================================================================
-- Part 1 — structural: the live function bodies carry both fixes AND have not
-- dropped the pre-existing invariants. Zero side effects; fails on any revert.
-- ==========================================================================
DO $$
DECLARE
  v_claim  TEXT := pg_get_functiondef('claim_compute_jobs(integer,text)'::regprocedure);
  v_claimp TEXT := pg_get_functiondef('claim_compute_jobs_with_priority(integer,text,boolean,text[],text[])'::regprocedure);
  v_done   TEXT := pg_get_functiondef('mark_compute_job_done(uuid,uuid)'::regprocedure);
BEGIN
  -- M-1137/M-1138: both claim RPCs clear the error columns on re-claim.
  IF v_claim !~* 'last_error\s*=\s*NULL' OR v_claim !~* 'error_kind\s*=\s*NULL' THEN
    RAISE EXCEPTION 'M-1137: claim_compute_jobs does not clear last_error/error_kind on re-claim';
  END IF;
  IF v_claimp !~* 'last_error\s*=\s*NULL' OR v_claimp !~* 'error_kind\s*=\s*NULL' THEN
    RAISE EXCEPTION 'M-1137: claim_compute_jobs_with_priority does not clear last_error/error_kind on re-claim';
  END IF;

  -- Pre-existing invariants must survive the full-body CREATE OR REPLACE.
  IF v_claimp !~* 'done_pending_children' THEN
    RAISE EXCEPTION 'priority claim RPC lost the C39 done_pending_children guard';
  END IF;
  IF v_claimp !~* 'compute_intro_snapshot' THEN
    RAISE EXCEPTION 'priority claim RPC lost the compute_intro_snapshot carve-out (H-1235)';
  END IF;
  IF v_claimp !~* 'claim_token\s*=\s*gen_random_uuid' THEN
    RAISE EXCEPTION 'priority claim RPC lost the P97 claim_token fence';
  END IF;

  -- G23-187-mig-01/03: GIN @> set-based fan-in present, FOR-loop gone.
  IF v_done !~* 'parent_job_ids\s*@>\s*ARRAY\[\s*p_job_id' THEN
    RAISE EXCEPTION 'G23-187-mig-01/03: mark_compute_job_done lost the GIN @> set-based fan-in';
  END IF;
  IF v_done ~* 'FOR\s+v_child_id\s+IN' THEN
    RAISE EXCEPTION 'G23-187-mig-01/03: mark_compute_job_done still has the regressed per-child FOR-loop';
  END IF;
  -- The B5 strict-token gate must remain on the rewritten mark_compute_job_done.
  IF v_done !~* 'p_claim_token IS NULL' OR v_done !~* 'invalid_parameter_value' THEN
    RAISE EXCEPTION 'mark_compute_job_done lost the B5 strict-token NULL gate';
  END IF;

  RAISE NOTICE 'Part 1 OK: claim RPCs clear last_error/error_kind; mark_compute_job_done uses GIN @> fan-in; pre-existing invariants intact.';
END $$;

-- ==========================================================================
-- Part 2 — functional: a re-claimed failed_retry row has last_error/error_kind
-- cleared by the live priority claim RPC (the worker's prod path). Isolated in
-- a transaction that always rolls back.
-- ==========================================================================
BEGIN;
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_strat uuid;
  v_job   uuid := gen_random_uuid();
  v_status     TEXT;
  v_last_error TEXT;
  v_error_kind TEXT;
BEGIN
  -- FK chain: compute_jobs.strategy_id -> strategies.id -> profiles.id ->
  -- auth.users.id. handle_new_user auto-creates the profile; absorb it.
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'mig-rpc-sql-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'mig-rpc-test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'mig-rpc-strat') RETURNING id INTO v_strat;

  -- A failed_retry job, DUE and dated at the unix epoch + high priority so the
  -- priority claim RPC's `ORDER BY priority, next_attempt_at, id` selects it
  -- FIRST deterministically: no real compute_jobs row predates 1970, so batch=1
  -- is guaranteed to land on the seeded row regardless of any committed rows in
  -- the shared test project (red-team A). Carries a prior-attempt error payload
  -- the re-claim must clear.
  INSERT INTO public.compute_jobs
      (id, kind, strategy_id, status, priority, attempts,
       next_attempt_at, last_error, error_kind, claim_token)
    VALUES
      (v_job, 'compute_analytics', v_strat, 'failed_retry', 'high', 1,
       TIMESTAMPTZ '1970-01-01 00:00:00+00', 'secret-leak-probe-xyz', 'transient', NULL);

  PERFORM public.claim_compute_jobs_with_priority(1, 'mig-rpc-worker-' || v_user, NULL);

  SELECT status, last_error, error_kind
    INTO v_status, v_last_error, v_error_kind
    FROM public.compute_jobs WHERE id = v_job;

  IF v_status <> 'running' THEN
    RAISE EXCEPTION 'Part 2: seeded failed_retry job was not claimed (status=%)', v_status;
  END IF;
  IF v_last_error IS NOT NULL THEN
    RAISE EXCEPTION 'M-1137/M-1138: re-claimed running row still carries last_error=% (expected NULL)', v_last_error;
  END IF;
  IF v_error_kind IS NOT NULL THEN
    RAISE EXCEPTION 'M-1137/M-1138: re-claimed running row still carries error_kind=% (expected NULL)', v_error_kind;
  END IF;

  RAISE NOTICE 'Part 2 OK: failed_retry -> running re-claim cleared last_error + error_kind.';
END $$;
ROLLBACK;
