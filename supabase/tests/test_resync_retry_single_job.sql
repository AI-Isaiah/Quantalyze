-- Real-index substrate for Phase 141 SC2/SC3 (SEAM — retry-with-backoff).
--
-- Why this file exists
-- --------------------
-- Phase 141 allowlists `resync` for a bounded Vercel->Railway seam retry. SC2
-- requires that a retried resync produces EXACTLY ONE server-side effect of
-- record, and SC3 requires that `teaser`'s non-idempotency is a real property of
-- the schema, not a mock artifact. Both claims stand on how REAL Postgres
-- behaves under two indexes this phase neither owns nor changed. This file pins
-- that behaviour against the live test DB so a future migration cannot silently
-- re-open the class the Python-side dedup (routers/process_key.py, the resync
-- draft pre-check) and the teaser non-idempotency pin depend on.
--
-- What it asserts (each in its own DO block, all counts scoped to the LITERAL
-- fixture strategy id — never a global count on the shared test DB)
-- ---------------------------------------------------------------------------
--   (a) SC2 JOB HALF. Two enqueue_compute_job calls for the same
--       (strategy, 'process_key_long') while the first is non-terminal leave
--       exactly ONE non-terminal compute_jobs row. The JOB is SC2's
--       money-bearing "exactly one effect of record": resync mints its OWN
--       draft strategy_verifications row per call by construction (it carries no
--       caller wizard_session_id — RESEARCH Pitfall 3), so the SV row cannot be
--       the dedup anchor for the retry; the compute_jobs partial-unique index
--       (compute_jobs_one_inflight_per_kind_strategy) is. This is exactly the
--       RPC the Python resync dedup re-calls on its WIZARD_DUPLICATE path.
--   (b) SV INDEX REALITY — DISTINCT SESSIONS PASS. Two draft
--       strategy_verifications rows for the fixture strategy with two DIFFERENT
--       wizard_session_ids insert cleanly (2 rows). This is WHY teaser/resync
--       duplicates are possible at the DB layer at all — a fresh uuid4 per call
--       slips the (strategy_id, wizard_session_id) index — and therefore why the
--       Python application-level pre-check is load-bearing, not redundant.
--   (c) SV INDEX REALITY — SAME SESSION 23505s. A third insert reusing one
--       (strategy_id, wizard_session_id) pair raises SQLSTATE 23505. The onboard
--       fence (strategy_verifications_strategy_wizard_session_uniq) is real.
--
-- Form: plain PL/pgSQL `DO $$ ... $$` with RAISE EXCEPTION on failure — pgTAP is
-- NOT installed (CLAUDE.md). Under `psql -v ON_ERROR_STOP=1` (what
-- .github/workflows/ci.yml `sql-tests` runs) a failed assertion exits non-zero
-- and fails the job. The `test_*.sql` filename is auto-discovered by that job.
-- All ASSERTION work runs inside BEGIN ... ROLLBACK; the defensive pre-clean
-- below deliberately runs OUTSIDE it and commits, so a prior aborted run's
-- synthetic rows are removed. Both scopes touch only this file's literal
-- fixture ids, so the shared test DB is never polluted (the two-scope split is
-- the point: a pre-clean inside the transaction would be rolled back with
-- everything else and could never recover an aborted run). Expected values are
-- literals (1, 2); nothing is read back out of the RPC/index under test and
-- re-asserted against itself.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_resync_retry_single_job.sql
-- Never run against PROD.

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- compute_jobs.strategy_id and strategy_verifications.strategy_id are ON DELETE
-- CASCADE from strategies, and auth.users -> profiles -> strategies cascades
-- too, so deleting the user by email drops the whole subtree. The literal-id
-- deletes ahead of it are belt-and-braces and can only match this file's fixture.
-- --------------------------------------------------------------------------
DELETE FROM compute_jobs
  WHERE strategy_id = '6d6d6d6d-0000-4000-8000-000000000041';

DELETE FROM strategy_verifications
  WHERE strategy_id = '6d6d6d6d-0000-4000-8000-000000000041';

DELETE FROM strategies
  WHERE id = '6d6d6d6d-0000-4000-8000-000000000041';

DELETE FROM auth.users
  WHERE email = 'test-seam06-resync-retry@quantalyze.test';

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- SEED (default role — auth.users insert needs elevated privilege).
-- ==========================================================================
DO $$
DECLARE
  uid_r   UUID := 'd1d1d1d1-0000-4000-8000-000000000041';
  strat_r UUID := '6d6d6d6d-0000-4000-8000-000000000041';
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_r, '00000000-0000-0000-0000-000000000000',
          'test-seam06-resync-retry@quantalyze.test', now(), now());

  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_r, 'seam06 resync retry fixture',
          'test-seam06-resync-retry@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO strategies
    (id, user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES
    (strat_r, uid_r, 'seam06 resync retry fixture strategy', 'draft',
     '{}', '{}', '{}', ARRAY['binance']);

  RAISE NOTICE 'Seed OK: uid=% strategy=%', uid_r, strat_r;
END $$;

-- Mirror the real caller: /process-key enqueues through the SERVICE-ROLE client
-- (services/db.py). enqueue_compute_job is SECURITY DEFINER and its _assert_owner
-- gate short-circuits when auth.uid() is NULL, so the role can neither mask nor
-- manufacture the outcome — it is set here only so the test mirrors the caller.
-- SET LOCAL is transaction-scoped: it holds across the DO blocks below.
SET LOCAL ROLE service_role;

-- ==========================================================================
-- (a) SC2 JOB HALF — two enqueues, ONE non-terminal job.
-- ==========================================================================
DO $$
DECLARE
  strat_r  UUID := '6d6d6d6d-0000-4000-8000-000000000041';
  -- The kind /process-key enqueues for its long-fetch flows (onboard/resync),
  -- pinned so the fence stays aligned with the caller it protects.
  job_kind TEXT := 'process_key_long';
  first_id  UUID;
  second_id UUID;
  row_cnt   INTEGER;
BEGIN
  first_id := enqueue_compute_job(
    p_strategy_id => strat_r,
    p_kind        => job_kind,
    p_metadata    => jsonb_build_object('fixture', 'seam06-a-first')
  );
  second_id := enqueue_compute_job(
    p_strategy_id => strat_r,
    p_kind        => job_kind,
    p_metadata    => jsonb_build_object('fixture', 'seam06-a-second')
  );

  SELECT count(*) INTO row_cnt
    FROM compute_jobs
   WHERE strategy_id = strat_r
     AND kind = job_kind
     AND status IN ('pending', 'running', 'done_pending_children');

  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (a): two enqueue_compute_job calls for strategy % kind % left % non-terminal compute_jobs rows, expected exactly 1. This is SC2''s single money-bearing effect of record for a retried resync — without the (strategy_id, kind) dedup a seam retry mints a second job.',
      strat_r, job_kind, row_cnt;
  END IF;

  IF second_id IS DISTINCT FROM first_id THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (a): the deduped second enqueue returned % but the live job is % — the RPC must hand back the EXISTING id (process_key.py reads it back to label job_state).',
      second_id, first_id;
  END IF;

  RAISE NOTICE '(a) OK: 2 enqueues -> 1 non-terminal job, both returned %', first_id;
END $$;

-- ==========================================================================
-- (b) SV INDEX REALITY — DISTINCT SESSIONS PASS (2 rows).
-- ==========================================================================
DO $$
DECLARE
  strat_r   UUID := '6d6d6d6d-0000-4000-8000-000000000041';
  session_1 UUID := '7e7e7e7e-0000-4000-8000-000000000001';
  session_2 UUID := '7e7e7e7e-0000-4000-8000-000000000002';
  row_cnt   INTEGER;
BEGIN
  -- The INSERT is wrapped in the SAME `BEGIN ... EXCEPTION WHEN unique_violation`
  -- idiom assertion (c) below already uses, for the MIRROR-IMAGE reason. (c)
  -- needs the handler because the collision it describes is the PASS; (b) needs
  -- it because the collision is the FAILURE -- and an UNHANDLED 23505 here
  -- aborts psql with a raw driver error before this arm can name itself, so the
  -- one production change this assertion exists to refuse would be
  -- indistinguishable from any other crash. Phase 164.4 measured exactly that.
  BEGIN
    INSERT INTO strategy_verifications
      (strategy_id, wizard_session_id, status, trust_tier, flow_type, source)
    VALUES
      (strat_r, session_1, 'draft', 'api_verified', 'resync', 'binance'),
      (strat_r, session_2, 'draft', 'api_verified', 'resync', 'binance');
  EXCEPTION
    WHEN unique_violation THEN
      RESET ROLE;
      RAISE EXCEPTION
        'TEST FAILED (b): two draft strategy_verifications rows for strategy % with DISTINCT wizard_session_ids (%, %) collided on a unique violation, but distinct sessions must insert cleanly. The onboard fence has to stay tenant-scoped as (strategy_id, wizard_session_id) -- narrowed to (strategy_id) alone, two DISTINCT wizard sessions can no longer both hold a draft, which is exactly the property that lets a fresh-uuid4 resync retry mint a duplicate DRAFT and therefore exactly the property the Python resync pre-check is load-bearing against.',
        strat_r, session_1, session_2;
  END;

  SELECT count(*) INTO row_cnt
    FROM strategy_verifications
   WHERE strategy_id = strat_r;

  IF row_cnt <> 2 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (b): two draft strategy_verifications rows with DISTINCT wizard_session_ids for strategy % produced % rows, expected 2. The (strategy_id, wizard_session_id) index must admit distinct sessions — that is exactly why a fresh-uuid4 retry can mint a duplicate DRAFT and why the Python resync pre-check is load-bearing.',
      strat_r, row_cnt;
  END IF;

  RAISE NOTICE '(b) OK: two distinct-session draft rows admitted (% rows)', row_cnt;
END $$;

-- ==========================================================================
-- (c) SV INDEX REALITY — SAME SESSION 23505s.
-- ==========================================================================
DO $$
DECLARE
  strat_r   UUID := '6d6d6d6d-0000-4000-8000-000000000041';
  session_1 UUID := '7e7e7e7e-0000-4000-8000-000000000001';
BEGIN
  BEGIN
    INSERT INTO strategy_verifications
      (strategy_id, wizard_session_id, status, trust_tier, flow_type, source)
    VALUES
      (strat_r, session_1, 'draft', 'api_verified', 'resync', 'binance');
    -- Reached only if the unique index did NOT fire.
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (c): a third insert reusing (strategy_id=%, wizard_session_id=%) did NOT raise 23505 — the tenant-scoped unique index strategy_verifications_strategy_wizard_session_uniq is missing; the onboard double-submit fence is gone.',
      strat_r, session_1;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE '(c) OK: same-session reinsert raised 23505 as expected';
  END;
END $$;

RESET ROLE;

DO $$
BEGIN
  RAISE NOTICE 'ALL ASSERTIONS PASSED (a, b, c) — SC2/SC3 DB substrate is fenced.';
END $$;

ROLLBACK;
