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

-- ⭐ RED-UNDER ANNOTATIONS (Phase 164.4). Each assertion below carries a prose
-- `RED-UNDER:` naming the smallest production change that makes it fail, and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE it reds on its OWN arm, then restores
-- GREEN. Schema: scripts/mutation-runner/GRAMMAR.md. The line below declares
-- what the lane applies before this gate.
--
-- ⚠️ THIS GATE IS DEFENCE IN DEPTH, AND (a)'S TWIN HAS TO SAY SO. The header
-- above names compute_jobs_one_inflight_per_kind_strategy as the dedup anchor.
-- MEASURED 2026-09-04 on a real lane, and PROVED APPLIED by re-reading
-- pg_indexes.indexdef: excluding `process_key_long` from that index ALONE
-- leaves this gate at exit 0, because _enqueue_compute_job_internal's own
-- optimistic select-existing already returns the live job. Removing that
-- select-existing ALONE is equally a no-red, because the partial unique index
-- then dedups via ON CONFLICT DO NOTHING and the lost-the-race re-read hands
-- back the same id. (a) only reds when BOTH halves of the (strategy_id, kind)
-- dedup go -- which is exactly what its own message says ("without the
-- (strategy_id, kind) dedup a seam retry mints a second job") -- so its twin is
-- LAYERED across the two migrations that last define them. A single-layer twin
-- would be reported as "mutation applied, arm did not redden": a false defect.
--
-- ⚠️ 20260416125430 IS THE LAST-DEFINING MIGRATION FOR THE INFLIGHT INDEX (it
-- DROPs the 20260411144407 version and recreates it with the
-- compute_intro_snapshot carve-out), and 20260420073003 for
-- _enqueue_compute_job_internal (20260515210300 replaces only the PUBLIC
-- wrapper). Twins cut THERE, not at the migrations that first created them.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260501055202_strategy_verifications.sql","supabase/migrations/20260501055213_strategy_verifications_rls_polish.sql","supabase/migrations/20260510172738_strategy_verifications_state_machine.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260726000225_strategy_verifications_tenant_scope_uniq.sql"]}

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
  -- RED-UNDER: remove BOTH halves of the (strategy_id, kind) dedup this
  --            assertion's own message names. Half one: delete the
  --            strategy-branch optimistic select-existing from
  --            _enqueue_compute_job_internal in migration 20260420073003, on
  --            the reasonable-sounding ground that the partial unique index is
  --            "the final arbiter" anyway. Half two: widen that index's
  --            carve-out in migration 20260416125430 to skip `process_key_long`
  --            as well as `compute_intro_snapshot`, the way a future
  --            per-(allocator, strategy) kind would be added. EITHER change
  --            alone is a measured NO-RED -- the other half still dedups --
  --            which is precisely why the twin is layered.
  -- RED-UNDER-M: {"arm":"a","apply":[{"kind":"edit","file":"supabase/migrations/20260420073003_allocator_holdings.sql","find":"  IF p_strategy_id IS NOT NULL THEN\n    SELECT id INTO v_existing_id\n      FROM compute_jobs\n     WHERE strategy_id = p_strategy_id\n       AND kind = p_kind\n       AND status IN ('pending', 'running', 'done_pending_children')\n     LIMIT 1;\n  ELSIF p_portfolio_id IS NOT NULL THEN\n","replace":"  IF FALSE THEN\n    NULL;\n  ELSIF p_portfolio_id IS NOT NULL THEN\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260416125430_contact_request_metadata.sql","find":"    AND kind <> 'compute_intro_snapshot'\n","replace":"    AND kind NOT IN ('compute_intro_snapshot', 'process_key_long')\n","occurrences":1}]}
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
  -- RED-UNDER: narrow the onboard fence back to a SINGLE column -- change STEP
  --            1 of migration 20260726000225 to build
  --            strategy_verifications_strategy_wizard_session_uniq on
  --            (strategy_id) alone, the shape a "one draft per strategy" reading
  --            of the fence would produce. That migration SELF-VERIFIES its own
  --            indexed column list from pg_index in STEP 3, so the narrowing
  --            aborts the apply unless that check is re-based in the same edit
  --            -- hence a LAYERED twin (GRAMMAR Shape 3), not a single step.
  --            MEASURED: STEP 3 bites TWICE. Its check (a) compares the indexed
  --            column list to {strategy_id,wizard_session_id}; its check (c)
  --            counts the unique indexes covering wizard_session_id and demands
  --            exactly 1, which a (strategy_id)-only index makes 0. Re-basing
  --            only the first still aborts with 'PYAPI-01: expected exactly 1
  --            unique index covering wizard_session_id, found 0' -- the lane
  --            emits no TEST FAILED at all and the runner reports
  --            wrong-first-failure, which is how the second layer was found.
  --            NOTE the drop-only mutation is (c)'s, not this one: with NO
  --            unique index at all, two distinct sessions still insert cleanly
  --            and (b) stays GREEN.
  -- RED-UNDER-M: {"arm":"b","apply":[{"kind":"edit","file":"supabase/migrations/20260726000225_strategy_verifications_tenant_scope_uniq.sql","find":"  ON strategy_verifications (strategy_id, wizard_session_id);\n","replace":"  ON strategy_verifications (strategy_id);\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260726000225_strategy_verifications_tenant_scope_uniq.sql","find":"  IF v_cols IS DISTINCT FROM ARRAY['strategy_id', 'wizard_session_id']::TEXT[] THEN\n","replace":"  IF FALSE THEN\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260726000225_strategy_verifications_tenant_scope_uniq.sql","find":"  IF v_uniq <> 1 THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
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
  -- RED-UNDER: drop strategy_verifications_strategy_wizard_session_uniq and put
  --            NOTHING in its place -- the state the header's own "manual
  --            rollback" recipe passes through, and the state a migration that
  --            retires the fence as "redundant with the application pre-check"
  --            would leave behind. A `sql` step, not a migration edit: STEP 3 of
  --            20260726000225 asserts the index EXISTS and is VALID, so deleting
  --            its CREATE aborts the apply instead of reaching this arm.
  --            ⚠️ The header's FULL rollback -- which also rebuilds the
  --            single-column (wizard_session_id) index -- is a NO-RED here: that
  --            index still refuses the same-session reinsert, so (c) passes. It
  --            is (a) of the tenant-scope gate that catches THAT change.
  -- RED-UNDER-M: {"arm":"c","apply":[{"kind":"sql","stmt":"DROP INDEX public.strategy_verifications_strategy_wizard_session_uniq"}]}
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
