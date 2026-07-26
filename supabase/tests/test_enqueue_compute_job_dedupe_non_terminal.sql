-- Regression fence for the enqueue_compute_job dedupe that Phase 140.1
-- Plan 02 (PYAPI-09 / finding C-19) now DEPENDS ON.
--
-- Why this file exists
-- --------------------
-- /process-key's WIZARD_DUPLICATE path used to return a hardcoded
-- `queued: false` ~170 lines above the enqueue it never reached, so a session
-- whose draft strategy_verifications row committed but whose compute_job was
-- never written stayed wedged forever (C-19), and the wedge was rendered to the
-- user as success. The fix (routers/process_key.py, _resume_duplicate_job) is to
-- RE-CALL enqueue_compute_job on that path and report what is actually true.
--
-- That fix is only safe because _enqueue_compute_job_internal
-- (20260716090000_retire_compute_analytics_kind_rpc_guard.sql:181+) already
-- dedupes: it SELECTs an existing row for (target, kind) restricted to
-- status IN ('pending','running','done_pending_children') and RETURNS that id
-- instead of inserting. So re-calling it cannot double-enqueue while a job is
-- live, and DOES create one when none exists.
--
-- enqueue_compute_job is a SHARED RPC with many callers across the codebase.
-- Plan 02's correctness is therefore load-bearing on a behaviour this phase
-- neither owns nor changed. This file PINS it, so a future edit to the RPC that
-- looks harmless in its own PR cannot silently re-open C-19.
--
-- This is a REGRESSION FENCE, not a RED-first test: it passes today by
-- construction. Its value is entirely in failing later.
--
-- What it asserts
-- ---------------
--   B1. DEDUPE WHILE NON-TERMINAL. Two consecutive enqueue_compute_job calls
--       for the same (strategy, kind) while the first row is still 'pending'
--       leave exactly ONE compute_jobs row, and the second call returns the
--       FIRST call's id. Both halves matter: a count of 1 with a NULL/new id
--       returned would still break the caller, which uses the returned id.
--   B2. NEW ROW AFTER TERMINAL. Transitioning that row to a terminal status
--       ('done') and calling a THIRD time creates a SECOND row with a NEW id.
--       This is the behaviour the Plan 02 gate relies on in the other
--       direction: because the dedupe MISSES on terminal rows, the Python side
--       must gate its re-enqueue on the strategy_verifications row still being
--       'draft', or a stray replay of a completed session would silently
--       re-sync it. B2 also proves B1's "1" is a real dedupe rather than an
--       enqueue that never inserts anything at all.
--
-- Every count below is scoped to the LITERAL fixture strategy id declared in
-- this file — never a global count. The shared test DB carries other
-- compute_jobs rows, so a global count could pass vacuously. Expected values
-- are literals (1, 2), never read back out of the RPC under test.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands. Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs at
-- :692-838) a failed assertion exits non-zero and fails the job. The filename
-- matches the `test_*.sql` glob so the job auto-discovers it.
--
-- Hygiene: all fixture work runs inside an explicit transaction that ends in
-- ROLLBACK, so the shared test DB is never polluted.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_enqueue_compute_job_dedupe_non_terminal.sql

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- compute_jobs.strategy_id is ON DELETE CASCADE from strategies, and
-- auth.users -> profiles -> strategies cascades too, so deleting the user by
-- email drops the whole subtree. The literal-id delete ahead of it is
-- belt-and-braces: it can only ever match this file's own fixture.
-- --------------------------------------------------------------------------
DELETE FROM compute_jobs
  WHERE strategy_id = '5c5c5c5c-0000-4000-8000-000000000031';

DELETE FROM strategies
  WHERE id = '5c5c5c5c-0000-4000-8000-000000000031';

DELETE FROM auth.users
  WHERE email = 'test-pyapi09-enqueue-dedupe@quantalyze.test';

BEGIN;

DO $$
DECLARE
  -- Literal fixtures. Every assertion is scoped to strat_c.
  uid_c     UUID := 'c1c1c1c1-0000-4000-8000-000000000003';
  strat_c   UUID := '5c5c5c5c-0000-4000-8000-000000000031';

  -- The kind /process-key enqueues for its long-fetch flows
  -- (routers/process_key.py, p_kind => 'process_key_long'). Pinning THIS kind
  -- rather than an arbitrary one keeps the fence aligned with the caller it
  -- protects; the compute_jobs_kind_target_coherence CHECK requires it be
  -- strategy-scoped, which it is.
  job_kind  TEXT := 'process_key_long';

  first_id  UUID;
  second_id UUID;
  third_id  UUID;
  row_cnt   INTEGER;
BEGIN
  -- ----- SEED (seeding/service-role context - bypasses RLS) ----------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_c, '00000000-0000-0000-0000-000000000000',
          'test-pyapi09-enqueue-dedupe@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_c, 'pyapi09 dedupe fixture',
          'test-pyapi09-enqueue-dedupe@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO strategies
    (id, user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES
    (strat_c, uid_c, 'pyapi09 dedupe fixture strategy', 'draft',
     '{}', '{}', '{}', ARRAY['binance']);

  RAISE NOTICE 'Seed OK: uid=% strategy=% kind=%', uid_c, strat_c, job_kind;

  -- Call the RPC exactly as /process-key does: through the SERVICE-ROLE
  -- client (services/db.py:71-76). enqueue_compute_job is SECURITY DEFINER and
  -- its _assert_owner gate short-circuits when auth.uid() is NULL, so the role
  -- can neither mask nor manufacture the outcome - it is set here only so the
  -- test mirrors the real caller.
  SET LOCAL ROLE service_role;

  -- ======================================================================
  -- B1 - DEDUPE WHILE NON-TERMINAL.
  -- Two calls, one live job. This is the "duplicate with a job already in
  -- flight" case: process_key.py re-calls the RPC on EVERY idempotent hit, so
  -- a regression here would mint a job per page refresh.
  -- ======================================================================
  first_id := enqueue_compute_job(
    p_strategy_id => strat_c,
    p_kind        => job_kind,
    p_metadata    => jsonb_build_object('fixture', 'pyapi09-b1-first')
  );

  second_id := enqueue_compute_job(
    p_strategy_id => strat_c,
    p_kind        => job_kind,
    p_metadata    => jsonb_build_object('fixture', 'pyapi09-b1-second')
  );

  SELECT count(*) INTO row_cnt
    FROM compute_jobs
   WHERE strategy_id = strat_c
     AND kind = job_kind;

  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (B1): two consecutive enqueue_compute_job calls for strategy % kind % produced % compute_jobs rows, expected exactly 1. _enqueue_compute_job_internal no longer dedupes over the non-terminal statuses (pending/running/done_pending_children). Phase 140.1 PYAPI-09 depends on this: /process-key re-calls this RPC on every WIZARD_DUPLICATE hit, so without the dedupe a page refresh mints a job each time (findings C-19).',
      strat_c, job_kind, row_cnt;
  END IF;

  IF second_id IS DISTINCT FROM first_id THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (B1): the deduped second enqueue_compute_job call returned % but the live job is %. The RPC must RETURN THE EXISTING id, not NULL and not a fresh one - process_key.py reads that id back to report job_state.',
      second_id, first_id;
  END IF;

  RAISE NOTICE 'B1 OK: 2 calls -> 1 row, both returned %', first_id;

  -- ======================================================================
  -- B2 - NEW ROW AFTER TERMINAL.
  -- The dedupe window is deliberately restricted to NON-terminal statuses, so
  -- a finished job does not block a genuinely new one. That is exactly why the
  -- Python side gates its re-enqueue on the strategy_verifications row still
  -- being 'draft': without that gate, a replay of a COMPLETED session would
  -- land here and silently re-sync it.
  -- ======================================================================
  UPDATE compute_jobs
     SET status = 'done'
   WHERE id = first_id;

  third_id := enqueue_compute_job(
    p_strategy_id => strat_c,
    p_kind        => job_kind,
    p_metadata    => jsonb_build_object('fixture', 'pyapi09-b2-third')
  );

  SELECT count(*) INTO row_cnt
    FROM compute_jobs
   WHERE strategy_id = strat_c
     AND kind = job_kind;

  IF row_cnt <> 2 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (B2): after transitioning the first job to a terminal status, a third enqueue_compute_job call for strategy % kind % left % compute_jobs rows, expected exactly 2. The dedupe must MISS on terminal rows - if it now matches them, a completed strategy can never be re-enqueued at all.',
      strat_c, job_kind, row_cnt;
  END IF;

  IF third_id IS NOT DISTINCT FROM first_id THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (B2): the post-terminal enqueue returned the OLD job id % instead of a new one. A terminal job must not be handed back as if it were in flight.',
      third_id;
  END IF;

  RAISE NOTICE 'B2 OK: post-terminal call -> 2 rows, new id %', third_id;

  RESET ROLE;
  RAISE NOTICE 'ALL ASSERTIONS PASSED (B1, B2) - enqueue_compute_job dedupe is fenced.';
END $$;

ROLLBACK;
