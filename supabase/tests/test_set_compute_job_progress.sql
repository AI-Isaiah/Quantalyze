-- Test for migration 20260712130000_set_compute_job_progress.sql — the
-- claim-token-fenced JSONB-merge progress RPC. Phase 95 (PROG-02).
--
-- set_compute_job_progress merges a per-member `member_progress` array plus a
-- server-stamped `member_progress_at` heartbeat into compute_jobs.metadata,
-- under the P97 claim-token fence, service-role only. It is the write side the
-- 95-03 poll route + stall detector consume.
--
-- This file asserts:
--   Part 1 — privilege (T-95-04): anon has NO EXECUTE, authenticated has NO
--            EXECUTE, service_role HAS EXECUTE (has_function_privilege).
--   Part 2 — fenced merge (T-95-02 / T-95-03), all inside one BEGIN/ROLLBACK:
--     2a. matching token on a 'running' row → RETURNS true, member_progress +
--         member_progress_at are written, and the pre-existing source /
--         correlation_id keys SURVIVE the merge (|| never clobbers the blob).
--     2b. stale/mismatched token → RETURNS false, NOTHING is written (the row's
--         metadata is unchanged; no member_progress key appears).
--     2c. NULLed token (watchdog-reclaimed row) → RETURNS false, NOTHING
--         written even when the caller passes NULL (the claim_token IS NOT NULL
--         guard rejects a reclaimed row).
--     2d. non-'running' row (status='done') with a MATCHING token → RETURNS
--         false, NOTHING written (terminal rows are never progressed).
--
-- pgTAP is NOT installed (CLAUDE.md / Lane B). Plain PL/pgSQL `DO $$ ... $$`
-- with RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands (the
-- sql-tests preflight rejects shell-out / copy / redirection). Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. Filename matches the
-- `test_*.sql` glob so the job auto-discovers it (with migration
-- 20260712130000 applied). Pre-migration (RED): Part 1 fails (function absent →
-- has_function_privilege on a missing regprocedure errors, which under
-- ON_ERROR_STOP aborts — the intended pre-migration failure).
--
-- Hygiene: all fixture work runs inside an explicit transaction that ends in
-- ROLLBACK, so the shared test DB is never polluted. All ids are
-- gen_random_uuid() and every auth.users email is derived from a fresh uuid, so
-- a concurrent CI run against the shared test project (Phase-97 CI-01 /
-- parallelism-safe) cannot collide and no defensive pre-clean is needed. The
-- FK chain compute_jobs.strategy_id -> strategies.id -> profiles.id ->
-- auth.users.id is seeded per the house recipe in
-- test_compute_jobs_rpc_error_clear_and_fanin.sql.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_set_compute_job_progress.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, REDUNDER-BACKFILL). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ 20260712130000 is the ONLY definition of set_compute_job_progress — no
-- later migration re-issues it — so both twins target it. The five identities
-- collapse to TWO sections (`Part 1`, and `2` covering 2a-2d), and the section
-- 2 twin is anchored at 2b: it is the identity the fence removal makes the
-- FIRST failure, because 2a's matching-token write still succeeds, while 2c
-- and 2d stay guarded by the separate `claim_token IS NOT NULL` and
-- `status = 'running'` terms the same mutation leaves standing.
-- ⚠️ `claim_token` is added by 20260515114555, not by the migration under test,
-- so that migration is in the apply list below — without it the gate aborts
-- with a raw 42703 before any assertion runs.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260712130000_set_compute_job_progress.sql"]}

-- ==========================================================================
-- Part 1 — structural: anon/authenticated must NOT hold EXECUTE; service_role
-- MUST. Zero side effects; RED pre-migration (function absent → the
-- regprocedure text resolves to a missing function and has_function_privilege
-- errors under ON_ERROR_STOP — the intended pre-migration failure).
-- ==========================================================================
DO $$
BEGIN
  -- RED-UNDER: in migration 20260712130000, widen the final GRANT to
  --            `TO service_role, authenticated`. The REVOKE on the line above
  --            it still runs and still names authenticated, so the function is
  --            revoked and then re-granted — the exact "REVOKE missing"
  --            end-state this arm names (T-95-04), reached the way it would
  --            really happen: someone adds a role to a GRANT without noticing
  --            the REVOKE it contradicts. `anon` is untouched, so the anon
  --            branch above still passes and the authenticated branch is the
  --            FIRST failure. Granting explicitly rather than shortening the
  --            REVOKE is deliberate: it does not lean on the pg-lane's
  --            ALTER DEFAULT PRIVILEGES stand-in (fixture 07) to do the work,
  --            so the arm is falsified by the migration, not by the fixture.
  -- RED-UNDER-M: {"arm":"Part 1","apply":[{"kind":"edit","file":"supabase/migrations/20260712130000_set_compute_job_progress.sql","find":"GRANT EXECUTE ON FUNCTION set_compute_job_progress(UUID, UUID, JSONB) TO service_role;","replace":"GRANT EXECUTE ON FUNCTION set_compute_job_progress(UUID, UUID, JSONB) TO service_role, authenticated;","occurrences":1}]}
  IF has_function_privilege('anon',
       'public.set_compute_job_progress(uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1): anon can EXECUTE set_compute_job_progress — REVOKE missing (T-95-04)';
  END IF;
  IF has_function_privilege('authenticated',
       'public.set_compute_job_progress(uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1): authenticated can EXECUTE set_compute_job_progress — REVOKE missing (T-95-04)';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.set_compute_job_progress(uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1): service_role LOST EXECUTE on set_compute_job_progress — GRANT missing';
  END IF;
  RAISE NOTICE 'Part 1 OK: anon + authenticated have no EXECUTE, service_role retains EXECUTE.';
END $$;

-- ==========================================================================
-- Part 2 — functional fence + merge. Isolated in a transaction that always
-- rolls back; all ids gen_random_uuid().
-- ==========================================================================
BEGIN;

DO $$
DECLARE
  v_user      UUID := gen_random_uuid();
  v_strat1    UUID;
  v_strat2    UUID;
  v_strat3    UUID;
  v_strat4    UUID;
  v_job_match UUID := gen_random_uuid();  -- 2a: matching-token merge
  v_job_stale UUID := gen_random_uuid();  -- 2b: mismatched token no-op
  v_job_null  UUID := gen_random_uuid();  -- 2c: NULLed token no-op
  v_job_done  UUID := gen_random_uuid();  -- 2d: non-running no-op
  v_token     UUID := gen_random_uuid();
  v_wrong     UUID := gen_random_uuid();
  v_progress  JSONB := jsonb_build_array(
    jsonb_build_object('seq', 1, 'exchange', 'deribit', 'label', 'Main', 'status', 'successful'),
    jsonb_build_object('seq', 2, 'exchange', NULL,      'label', NULL,   'status', 'in_process')
  );
  v_ret       BOOLEAN;
  v_meta      JSONB;
BEGIN
  -- FK chain: compute_jobs.strategy_id -> strategies.id -> profiles.id ->
  -- auth.users.id. handle_new_user auto-creates the profile; absorb it.
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'prog-sql-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'prog-test') ON CONFLICT (id) DO NOTHING;

  -- Four distinct strategy targets so the one-inflight-per-(strategy,kind)
  -- partial unique index never trips across the four seeded jobs (all rows
  -- share now() as created_at inside the txn, so ordering by created_at would
  -- be non-deterministic — capture each id explicitly instead).
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'prog-strat-1') RETURNING id INTO v_strat1;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'prog-strat-2') RETURNING id INTO v_strat2;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'prog-strat-3') RETURNING id INTO v_strat3;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'prog-strat-4') RETURNING id INTO v_strat4;

  -- Four running/done jobs, each with a pre-existing metadata blob carrying
  -- source + correlation_id (what enqueue_compute_job writes) so the merge-
  -- preservation assertions in 2a have something to preserve.
  INSERT INTO public.compute_jobs (id, kind, strategy_id, status, claim_token, metadata)
  VALUES
    (v_job_match, 'compute_analytics', v_strat1,
       'running', v_token, '{"source":"wizard","correlation_id":"corr-abc"}'::jsonb),
    (v_job_stale, 'compute_analytics', v_strat2,
       'running', v_token, '{"source":"wizard","correlation_id":"corr-def"}'::jsonb),
    (v_job_null,  'compute_analytics', v_strat3,
       'running', NULL,    '{"source":"wizard","correlation_id":"corr-ghi"}'::jsonb),
    (v_job_done,  'compute_analytics', v_strat4,
       'done',    v_token, '{"source":"wizard","correlation_id":"corr-jkl"}'::jsonb);

  -- ---- 2a: matching token on a running row → true + merge -----------------
  v_ret := public.set_compute_job_progress(v_job_match, v_token, v_progress);
  IF v_ret IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (2a): matching-token write returned % (expected true)', v_ret;
  END IF;
  SELECT metadata INTO v_meta FROM public.compute_jobs WHERE id = v_job_match;
  IF v_meta->'member_progress' IS NULL OR v_meta->'member_progress' <> v_progress THEN
    RAISE EXCEPTION 'TEST FAILED (2a): member_progress not merged into metadata (got %)', v_meta->'member_progress';
  END IF;
  IF v_meta->>'member_progress_at' IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2a): member_progress_at heartbeat not stamped';
  END IF;
  -- The pre-existing keys MUST survive the || merge (never clobber the blob).
  IF v_meta->>'source' IS DISTINCT FROM 'wizard' THEN
    RAISE EXCEPTION 'TEST FAILED (2a): source key clobbered by merge (got %)', v_meta->>'source';
  END IF;
  IF v_meta->>'correlation_id' IS DISTINCT FROM 'corr-abc' THEN
    RAISE EXCEPTION 'TEST FAILED (2a): correlation_id clobbered by merge (got %)', v_meta->>'correlation_id';
  END IF;

  -- ---- 2b: mismatched token → false + no write ----------------------------
  -- RED-UNDER: in migration 20260712130000, replace the UPDATE's
  --            `AND claim_token IS NOT DISTINCT FROM p_claim_token` fence term
  --            with `AND TRUE`. The claim fence is then gone while every other
  --            guard survives, so a worker holding a STALE token — one whose
  --            job the watchdog already reclaimed and handed to a second
  --            worker — can overwrite the live worker's member_progress. That
  --            is T-95-03, and it is invisible to 2a (a matching token still
  --            writes), to 2c (the separate `claim_token IS NOT NULL` term
  --            still rejects a reclaimed row) and to 2d (the `status =
  --            'running'` term still rejects a terminal row), which is why 2b
  --            is the one identity that can name this regression.
  -- RED-UNDER-M: {"arm":"2b","apply":[{"kind":"edit","file":"supabase/migrations/20260712130000_set_compute_job_progress.sql","find":"     AND claim_token IS NOT DISTINCT FROM p_claim_token","replace":"     AND TRUE","occurrences":1}]}
  v_ret := public.set_compute_job_progress(v_job_stale, v_wrong, v_progress);
  IF v_ret IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (2b): stale-token write returned % (expected false)', v_ret;
  END IF;
  SELECT metadata INTO v_meta FROM public.compute_jobs WHERE id = v_job_stale;
  IF v_meta ? 'member_progress' THEN
    RAISE EXCEPTION 'TEST FAILED (2b): a mismatched claim_token wrote member_progress — fence broken (T-95-03)';
  END IF;
  IF v_meta->>'correlation_id' IS DISTINCT FROM 'corr-def' THEN
    RAISE EXCEPTION 'TEST FAILED (2b): stale-token no-op still mutated metadata';
  END IF;

  -- ---- 2c: NULLed (reclaimed) token → false + no write --------------------
  -- A watchdog-reclaimed row has claim_token NULL. Even a NULL-passing caller
  -- must NOT write (the claim_token IS NOT NULL guard).
  v_ret := public.set_compute_job_progress(v_job_null, NULL, v_progress);
  IF v_ret IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (2c): NULL-token write on a reclaimed row returned % (expected false)', v_ret;
  END IF;
  SELECT metadata INTO v_meta FROM public.compute_jobs WHERE id = v_job_null;
  IF v_meta ? 'member_progress' THEN
    RAISE EXCEPTION 'TEST FAILED (2c): a NULL claim_token wrote member_progress on a reclaimed row — fence broken';
  END IF;

  -- ---- 2d: non-running row (done) with matching token → false + no write --
  v_ret := public.set_compute_job_progress(v_job_done, v_token, v_progress);
  IF v_ret IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (2d): write on a done row returned % (expected false)', v_ret;
  END IF;
  SELECT metadata INTO v_meta FROM public.compute_jobs WHERE id = v_job_done;
  IF v_meta ? 'member_progress' THEN
    RAISE EXCEPTION 'TEST FAILED (2d): a terminal (done) row accepted a progress write — status guard broken';
  END IF;

  RAISE NOTICE 'test_set_compute_job_progress: ALL PASS (fenced merge, source/correlation_id survive, stale/NULL/done no-ops).';
END
$$;

ROLLBACK;
