-- Test for migration 20260728120000_csv_finalize_double_submit_idempotency.sql
-- Phase 140.4 / SEAMRIM-03 — end-of-milestone review finding C-2.
--
-- WHAT THIS FILE IS FOR
-- ---------------------
-- CONTEXT §3 of this phase: "a grep proves a STATE; only a guard proves the state
-- is HELD." The single GREEN in the programme's first mutation sample landed on a
-- closure verdict whose receipt was a one-time `grep -> empty`. This file is the
-- EXECUTABLE receipt for C-2: it calls the real RPC against a real Postgres and
-- asserts the observable behaviour, not the shape of the DDL. (The structural
-- assertions about the index itself live in
-- supabase/tests/test_wizard_session_idempotency.sql — deliberately kept in a
-- separate file so that a structural failure cannot abort this one before the
-- behavioural cases have run.)
--
-- ⚠️ The already-shipped SQL gate CANNOT catch this regression.
-- supabase/tests/test_strategy_verifications_wizard_session_tenant_scope.sql
-- would have passed, GREEN, on it: its A1 assertion REQUIRES the composite
-- `UNIQUE (strategy_id, wizard_session_id)` behaviour that PRODUCES the defect
-- (finalize_csv_strategy mints a fresh strategy_id, so that composite can never
-- collide). Do not weaken that file and do not expect it to cover this one.
--
-- WHAT IS ASSERTED
--   Part 1 — first submit: finalize_csv_strategy succeeds, creates EXACTLY ONE
--            strategies row with source='csv', and that row CARRIES the session
--            id. The column write is the load-bearing half: the index is partial
--            on `WHERE wizard_session_id IS NOT NULL`, so a NULL here puts the
--            row outside the fence, which IS finding C-2.
--   Part 2 — double submit: a SECOND call with the same (user_id,
--            wizard_session_id) raises SQLSTATE 23505.
--   Part 3 — the rollback, ASSERTED rather than assumed: after the failed second
--            call, EXACTLY ONE strategies row and EXACTLY ONE
--            strategy_verifications row exist. finalize_csv_strategy has no
--            `EXCEPTION` block, so the unhandled 23505 aborts the function and
--            both inserts roll back — that claim is verified here, not trusted.
--   Part 4 — THE CROSS-SOURCE CONTROL. An existing source='wizard' API draft
--            carrying session S must NOT block a CSV finalize with the SAME S.
--            This is the assertion that pins the `source` column in the index.
--            WITHOUT IT A TWO-COLUMN INDEX PASSES THIS ENTIRE FILE — Parts 1-3
--            are satisfied by (user_id, wizard_session_id) alone. It is also the
--            case that reddens under Falsifiability Ledger row M93.
--            Why the control is REAL and not hypothetical:
--            src/lib/wizard/localStorage.ts:379-381 restores wizardSessionId
--            unconditionally on source from ONE shared storage key, so an
--            abandoned API draft is replayed into the CSV wizard, and every retry
--            reuses the same id — a two-column index breaks that user's FIRST
--            legitimate CSV submit PERMANENTLY.
--
-- Part 4 uses the REAL API writer (create_wizard_strategy) rather than a
-- hand-built INSERT, so the control is about the actual cross-source scenario and
-- not about a row this test shaped to suit itself. It carries its own VACUITY
-- FENCE: it first asserts the API draft really does carry source='wizard' AND the
-- session id. Without that fence, an API writer that silently stopped writing
-- wizard_session_id would make Part 4 pass for the wrong reason and the control
-- would prove nothing.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with RAISE
-- EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. NO psql backslash meta-commands — the
-- sql-tests preflight (.github/workflows/ci.yml) rejects them. Under
-- `psql -v ON_ERROR_STOP=1` (what the `sql-tests` job runs) a failed assertion
-- exits non-zero and fails the job.
--
-- Hygiene: all fixture work runs inside an explicit transaction that ends in
-- ROLLBACK, so the shared test DB is never polluted and no defensive pre-clean is
-- needed. All ids are gen_random_uuid() and every auth.users email is derived
-- from a fresh uuid, so a concurrent CI run against the shared test project
-- cannot collide. auth.uid() is driven by set_config on request.jwt.claims (the
-- Supabase JWT GUC the SECURITY DEFINER functions read); the outer block stays in
-- the service-role context so verification SELECTs bypass RLS.
--
-- Pre-migration (RED): Part 2 fails — the second submit SUCCEEDS and mints a
-- duplicate, which is exactly finding C-2.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_csv_finalize_double_submit.sql

BEGIN;

DO $$
DECLARE
  uid_a        UUID := gen_random_uuid();  -- double-submit tenant
  uid_b        UUID := gen_random_uuid();  -- cross-source control tenant
  session_a    UUID := gen_random_uuid();
  session_b    UUID := gen_random_uuid();
  v_strat_csv1 UUID;
  v_strat_csv2 UUID;
  v_strat_api  UUID;
  v_key_api    UUID;
  v_wsid       UUID;
  v_source     TEXT;
  row_cnt      INTEGER;
  sv_cnt       INTEGER;
  raised       BOOLEAN;
  err_code     TEXT;
  err_msg      TEXT;
BEGIN
  -- ----- SEED users/profiles (service-role context) -------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-csv-dup-' || uid_a || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'csv dup a', 'test-csv-dup-' || uid_a || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-csv-dup-' || uid_b || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'csv dup b', 'test-csv-dup-' || uid_b || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  -- ======================================================================
  -- Part 1 — the first CSV submit succeeds and STORES the session id
  -- ======================================================================
  -- Drive auth.uid() = uid_a (the JWT GUC the SECDEF fn reads). Stay in the
  -- service-role role so verification SELECTs below bypass RLS.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  v_strat_csv1 := public.finalize_csv_strategy(
    uid_a, session_a, 'trades', 'CSV double-submit receipt A');

  IF v_strat_csv1 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1a): the first finalize_csv_strategy returned NULL - the CSV finalize path is broken before this test can say anything about double submits';
  END IF;

  SELECT wizard_session_id, source INTO v_wsid, v_source
    FROM public.strategies WHERE id = v_strat_csv1;

  IF v_source IS DISTINCT FROM 'csv' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1b): the finalized strategy carries source=% , expected ''csv''', v_source;
  END IF;

  -- The load-bearing column write. The fence index is PARTIAL on
  -- `WHERE wizard_session_id IS NOT NULL`, so a NULL here silently removes the
  -- row from the index and the double-submit below would succeed. This is
  -- finding C-2 stated as an assertion.
  IF v_wsid IS DISTINCT FROM session_a THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1c): the finalized strategy carries wizard_session_id=% , expected % - finalize_csv_strategy is not writing the column, so every CSV row sits OUTSIDE the partial unique index (review finding C-2)', v_wsid, session_a;
  END IF;

  RAISE NOTICE 'Part 1 OK: first CSV finalize created strategy % with source=csv and wizard_session_id=%.', v_strat_csv1, session_a;

  -- ======================================================================
  -- Part 2 — the SECOND submit of the same session raises 23505
  -- ======================================================================
  -- The duplicate the product's own copy INSTRUCTS: CSV_SUBMIT_NO_STRATEGY_ID's
  -- fix line reads "Submit again." Before this migration that second call
  -- returned 200 OK with a duplicate strategies row and a duplicate
  -- strategy_verifications row, silently, logged csv_finalize_ok.
  --
  -- `WHEN others` + an explicit SQLSTATE check rather than
  -- `WHEN unique_violation`: if the call fails for some OTHER reason (42501 auth,
  -- 22023 validation) we must report THAT, not silently accept any failure as
  -- proof of the fence.
  raised := FALSE;
  BEGIN
    v_strat_csv2 := public.finalize_csv_strategy(
      uid_a, session_a, 'trades', 'CSV double-submit receipt A retry');
  EXCEPTION WHEN others THEN
    raised   := TRUE;
    err_code := SQLSTATE;
    err_msg  := SQLERRM;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2a): the SECOND finalize_csv_strategy for (user, session) SUCCEEDED and returned % - a CSV double-submit just minted a duplicate strategy (review finding C-2)', v_strat_csv2;
  END IF;
  IF err_code <> '23505' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2b): the second finalize_csv_strategy failed with SQLSTATE % (%) - expected 23505 unique_violation from strategies_user_wizard_session_source_uniq', err_code, err_msg;
  END IF;

  RAISE NOTICE 'Part 2 OK: the second CSV finalize for the same (user, session) raised 23505.';

  -- ======================================================================
  -- Part 3 — the rollback, ASSERTED rather than assumed
  -- ======================================================================
  -- finalize_csv_strategy has NO `EXCEPTION` block, so the unhandled 23505 aborts
  -- the function and the enclosing statement and BOTH inserts roll back. If a
  -- future edit adds an EXCEPTION block that swallows the violation after the
  -- strategies INSERT, the counts below catch it.
  SELECT count(*) INTO row_cnt
    FROM public.strategies
   WHERE user_id = uid_a AND wizard_session_id = session_a;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3a): % strategies rows for (uid_a, session_a) after the rejected double submit, expected exactly 1', row_cnt;
  END IF;

  SELECT count(*) INTO sv_cnt
    FROM public.strategy_verifications sv
    JOIN public.strategies s ON s.id = sv.strategy_id
   WHERE s.user_id = uid_a AND sv.wizard_session_id = session_a;
  IF sv_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3b): % strategy_verifications rows for (uid_a, session_a) after the rejected double submit, expected exactly 1 - the failed call did not roll back its verification row', sv_cnt;
  END IF;

  RAISE NOTICE 'Part 3 OK: exactly 1 strategies row and 1 strategy_verifications row survive - the failed submit rolled both back.';

  -- ======================================================================
  -- Part 4 — THE CROSS-SOURCE CONTROL (pins the `source` column in the index)
  -- ======================================================================
  -- An ABANDONED API draft carrying session S must not block a later CSV finalize
  -- with the SAME S. Reachable because deriveWizardResumeOverrides restores
  -- wizardSessionId across the CSV/API boundary from one shared storage key.
  --
  -- ⚠️ THIS IS THE ONLY CASE IN THIS FILE THAT A TWO-COLUMN
  -- (user_id, wizard_session_id) INDEX FAILS. Parts 1-3 pass under both shapes.
  -- Deleting or weakening it silently deletes the whole reason `source` is in the
  -- key, and re-opens a PERMANENT first-submit failure for the affected user.
  -- Service-role-shaped call.
  --
  -- ⭐ WHY THIS CHANGED IN PHASE 156, and why it is the ONLY claim in this file
  -- that changes. It precedes the `create_wizard_strategy` call below — a WIZARD
  -- RPC, whose body Migration B (20260814120000) narrowed to
  -- `auth.role() = 'service_role'`, deleting the auth.uid() comparison this
  -- claim's `'role', 'authenticated'` used to satisfy. That call is DELIBERATELY
  -- NOT wrapped in an EXCEPTION handler (see the note at the control itself), so
  -- under the old claim a 42501 would propagate and, under ON_ERROR_STOP=1, kill
  -- this whole file — not with a message about the `source` column, but with an
  -- authorization error from a fixture that simply called the wrong way.
  -- ⛔ Part 1's claim above is NOT touched and must not be: it precedes
  -- `finalize_csv_strategy`, which is not a wizard RPC, is untouched by Phase
  -- 156, and still reads auth.uid(). Flipping it would silently change what
  -- Parts 1-3 mean.
  -- `sub` is retained: the body no longer reads it, but the fixture still says
  -- whose draft this is meant to be, and the row's ownership is asserted from
  -- `p_user_id` immediately below.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'service_role')::text, true);

  -- Use the REAL API-path writer, so the control is about the genuine
  -- cross-source scenario rather than a row this test shaped to suit itself.
  SELECT strategy_id, api_key_id INTO v_strat_api, v_key_api
    FROM public.create_wizard_strategy(
      uid_b, 'binance', 'cross-source key',
      'enc', 'sec', 'pass', 'dek', 'nonce', 1, 'Abandoned API draft B', session_b);

  -- VACUITY FENCE. If the API writer ever stops setting source='wizard' or stops
  -- storing the session id, the CSV finalize below would succeed for a reason
  -- that has nothing to do with the `source` column, and this control would
  -- report agreement forever. Assert the precondition before relying on it.
  SELECT wizard_session_id, source INTO v_wsid, v_source
    FROM public.strategies WHERE id = v_strat_api;
  IF v_source IS DISTINCT FROM 'wizard' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4a, vacuity fence): the API draft carries source=% , expected ''wizard'' - the cross-source control below would be testing nothing', v_source;
  END IF;
  IF v_wsid IS DISTINCT FROM session_b THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4a, vacuity fence): the API draft carries wizard_session_id=% , expected % - with no session id on the API row there is no cross-source collision to control for', v_wsid, session_b;
  END IF;

  -- The control itself: same user, SAME session id, different source -> MUST
  -- SUCCEED. Deliberately NOT wrapped in an EXCEPTION handler: a 23505 here
  -- propagates and, under ON_ERROR_STOP=1, fails the job with the raw
  -- constraint name, which is the most useful possible failure message.
  v_strat_csv2 := public.finalize_csv_strategy(
    uid_b, session_b, 'daily_returns', 'CSV first submit after abandoned API draft');

  IF v_strat_csv2 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4b): the cross-source CSV finalize returned NULL';
  END IF;
  IF v_strat_csv2 = v_strat_api THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4b): the cross-source CSV finalize returned the API draft''s id (%) instead of minting its own strategy', v_strat_api;
  END IF;

  -- Exactly two rows for (uid_b, session_b): one per source, each independently
  -- fenced. This is the positive statement of what the three-column key buys.
  SELECT count(*) INTO row_cnt
    FROM public.strategies
   WHERE user_id = uid_b AND wizard_session_id = session_b;
  IF row_cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4c): % strategies rows for (uid_b, session_b), expected exactly 2 (one source=wizard, one source=csv)', row_cnt;
  END IF;

  SELECT count(*) INTO row_cnt
    FROM public.strategies
   WHERE user_id = uid_b AND wizard_session_id = session_b AND source = 'csv';
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4c): % strategies rows with source=''csv'' for (uid_b, session_b), expected exactly 1', row_cnt;
  END IF;

  RAISE NOTICE 'Part 4 OK: a CSV finalize succeeded against a session id already used by an abandoned source=wizard draft - the `source` column in the index is live.';

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'test_csv_finalize_double_submit: ALL PASS (first submit stores the session id, the second raises 23505, both rows roll back, and the cross-source first submit still succeeds).';
END
$$;

ROLLBACK;
