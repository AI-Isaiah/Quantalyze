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
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, REDUNDER-BACKFILL). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ THIS FILE NAMES NO MIGRATION STAMP, so the apply list below was derived by
-- object-name lookup, and each twin targets whichever migration LAST defines
-- the object it mutates. The header cites 20260716090000 for the dedupe, but
-- 20260826150000 re-issues _enqueue_compute_job_internal in full and is the
-- newest definition — mutating the 20260716090000 copy would be overwritten
-- later in the apply list and prove nothing.
-- ⛔ B1's dedupe is LAYERED — TWO independent mechanisms, and a twin that
-- removes only one is a twin that proves nothing. Measured on the lane:
-- neutering the RPC's optimistic look-up alone leaves the partial unique index
-- compute_jobs_one_inflight_per_kind_strategy as the arbiter, so the second
-- INSERT hits `ON CONFLICT DO NOTHING`, the lost-race re-read hands back the
-- SAME id, and the file still passes — one row, one id, green. B1's twin
-- therefore mutates BOTH: the look-up in 20260826150000 AND the index in
-- 20260416125430 (its last definition). B2 needs only the look-up, because a
-- terminal row is outside the index's own partial predicate.
-- ⚠️ 20260510173005 is deliberately ABSENT from the apply list: it issues
-- `ROLLBACK TO SAVEPOINT` inside a `DO $$ … $$` body, which PL/pgSQL cannot
-- parse, so it aborts on a vanilla cluster (TODOS [REDUNDER-SAVEPOINT], the
-- same class Plan 00 booked against 20260416201929). Nothing is lost: it is
-- not the last definition of anything this file touches — 20260525074649
-- re-issues compute_jobs_kind_check with a DROP/ADD, and 20260717233529 is the
-- last definition of both that CHECK and the coherence CHECK.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql"]}

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
  -- RED-UNDER: narrow the strategy-scoped optimistic look-up in migration
  --            20260826150000 from the three non-terminal statuses to
  --            `status IN ('running')`, AND exclude process_key_long from the
  --            partial unique index in migration 20260416125430. The first job
  --            is 'pending', so the look-up no longer sees it and the INSERT no
  --            longer conflicts: a second row is minted and B1 reads 2 rows.
  --            This is the C-19 regression exactly — /process-key re-calls the
  --            RPC on every WIZARD_DUPLICATE hit, so a page refresh would mint
  --            a job each time.
  -- ⚠️ LAYERED, and the layering is the whole point: the dedupe has TWO
  --    independent arbiters. Mutating the look-up ALONE was measured NON-BITING
  --    on the lane — the index still rejects the second INSERT, `ON CONFLICT DO
  --    NOTHING` swallows it, and the lost-race re-read returns the SAME id, so
  --    the file stays green while the RPC's own dedupe is gone. A single-step
  --    twin here would have shipped looking correct and proving nothing.
  -- RED-UNDER-M: {"arm":"B1","apply":[{"kind":"edit","file":"supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","find":"    SELECT id INTO v_existing_id\n      FROM compute_jobs\n     WHERE strategy_id = p_strategy_id\n       AND kind = p_kind\n       AND status IN ('pending', 'running', 'done_pending_children')","replace":"    SELECT id INTO v_existing_id\n      FROM compute_jobs\n     WHERE strategy_id = p_strategy_id\n       AND kind = p_kind\n       AND status IN ('running')","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260416125430_contact_request_metadata.sql","find":"    AND kind <> 'compute_intro_snapshot'","replace":"    AND kind NOT IN ('compute_intro_snapshot', 'process_key_long')","occurrences":1}]}
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
  -- RED-UNDER: widen the SAME strategy-scoped look-up in migration
  --            20260826150000 to `status IN ('pending', 'running',
  --            'done_pending_children', 'done')`. The dedupe then MATCHES the
  --            terminal row this arm just created, so the third call hands back
  --            the finished job's id instead of enqueueing a new one and B2
  --            reads 1 row where it demands 2. That is the failure mode the
  --            Python side's `draft` gate exists to make safe: if a completed
  --            job blocked re-enqueue, a strategy could never be re-synced at
  --            all. One step suffices here — unlike B1, the partial unique
  --            index cannot mask this, because its own WHERE clause covers
  --            only the three non-terminal statuses and so ignores a 'done'
  --            row entirely.
  -- RED-UNDER-M: {"arm":"B2","apply":[{"kind":"edit","file":"supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","find":"    SELECT id INTO v_existing_id\n      FROM compute_jobs\n     WHERE strategy_id = p_strategy_id\n       AND kind = p_kind\n       AND status IN ('pending', 'running', 'done_pending_children')","replace":"    SELECT id INTO v_existing_id\n      FROM compute_jobs\n     WHERE strategy_id = p_strategy_id\n       AND kind = p_kind\n       AND status IN ('pending', 'running', 'done_pending_children', 'done')","occurrences":1}]}
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
