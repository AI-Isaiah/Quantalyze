-- Test for migrations 20260728120000_csv_finalize_double_submit_idempotency.sql
-- and 20260819120000_csv_finalize_atomic_fold.sql (Phase 145 / JOB-06 re-point).
-- Phase 140.4 / SEAMRIM-03 — end-of-milestone review finding C-2, extended to
-- the folded three-write body.
--
-- WHAT THIS FILE IS FOR
-- ---------------------
-- CONTEXT §3 of phase 140.4: "a grep proves a STATE; only a guard proves the
-- state is HELD." This file is the EXECUTABLE receipt for the double-submit
-- fence: it calls the real RPC against a real Postgres and asserts the
-- observable behaviour, not the shape of the DDL. (The structural assertions
-- about the index itself live in
-- supabase/tests/test_wizard_session_idempotency.sql — deliberately kept in a
-- separate file so that a structural failure cannot abort this one before the
-- behavioural cases have run.)
--
-- RE-POINTED AT THE FOLD (Phase 145 / 20260819120000, same commit as the DROP
-- — the 144-§8 rule: a gate that names a dropped function reds sql-tests on a
-- CORRECT migration). finalize_csv_strategy (5-arg) and
-- persist_csv_daily_returns are GONE; the single writer is now
-- finalize_csv_strategy_with_returns(p_user_id, p_wizard_session_id, p_fmt,
-- p_strategy_name, p_rows, p_terminal_status DEFAULT 'pending_review'),
-- which writes strategies + strategy_verifications + csv_daily_returns in ONE
-- transaction with NO handler clause. The 23505 from
-- strategies_user_wizard_session_source_uniq therefore rolls back THREE
-- writes, not two — Part 3 asserts exactly that widening.
--
-- ⚠️ The already-shipped SQL gate CANNOT catch this regression.
-- supabase/tests/test_strategy_verifications_wizard_session_tenant_scope.sql
-- would have passed, GREEN, on it: its A1 assertion REQUIRES the composite
-- `UNIQUE (strategy_id, wizard_session_id)` behaviour that PRODUCES the defect
-- (the finalize writer mints a fresh strategy_id, so that composite can never
-- collide). Do not weaken that file and do not expect it to cover this one.
--
-- WHAT IS ASSERTED
--   Part 1 — first submit: finalize_csv_strategy_with_returns succeeds,
--            creates EXACTLY ONE strategies row with source='csv' CARRYING the
--            session id (the column write is the load-bearing half: the index
--            is partial on `WHERE wizard_session_id IS NOT NULL`, so a NULL
--            here puts the row outside the fence — finding C-2), AND the
--            dailies LANDED: count equals the submitted payload and a
--            spot-checked (date, value) pair equals what was submitted — the
--            economic oracle (persisted == submitted), never the fold's own
--            formula.
--   Part 2 — double submit: a SECOND call with the same (user_id,
--            wizard_session_id) raises SQLSTATE 23505.
--   Part 3 — the rollback, ASSERTED rather than assumed, WIDENED TO THREE
--            TABLES: after the failed second call, EXACTLY ONE strategies row,
--            EXACTLY ONE strategy_verifications row, and the FIRST
--            submission's dailies count UNCHANGED. The folded body has no
--            handler clause, so the unhandled 23505 aborts the function and
--            all three inserts roll back — verified here, not trusted. A
--            future handler that swallows the violation after any INSERT (or
--            catches, writes dailies onto the existing row, and re-raises)
--            reddens these counts.
--   Part 4 — THE CROSS-SOURCE CONTROL. An existing source='wizard' API draft
--            carrying session S must NOT block a CSV finalize with the SAME S.
--            This is the assertion that pins the `source` column in the index.
--            WITHOUT IT A TWO-COLUMN INDEX PASSES THIS ENTIRE FILE — Parts 1-3
--            are satisfied by (user_id, wizard_session_id) alone. It is also
--            the case that reddens under Falsifiability Ledger row M93.
--            Why the control is REAL and not hypothetical:
--            src/lib/wizard/localStorage.ts:379-381 restores wizardSessionId
--            unconditionally on source from ONE shared storage key, so an
--            abandoned API draft is replayed into the CSV wizard, and every
--            retry reuses the same id — a two-column index breaks that user's
--            FIRST legitimate CSV submit PERMANENTLY.
--
-- Part 4 uses the REAL API writer (create_wizard_strategy) rather than a
-- hand-built INSERT, so the control is about the actual cross-source scenario
-- and not about a row this test shaped to suit itself. It carries its own
-- VACUITY FENCE: it first asserts the API draft really does carry
-- source='wizard' AND the session id. Without that fence, an API writer that
-- silently stopped writing wizard_session_id would make Part 4 pass for the
-- wrong reason and the control would prove nothing.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with RAISE
-- EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. NO psql backslash meta-commands — the
-- sql-tests preflight (.github/workflows/ci.yml) rejects them. Under
-- `psql -v ON_ERROR_STOP=1` (what the `sql-tests` job runs) a failed assertion
-- exits non-zero and fails the job.
--
-- Hygiene: all fixture work runs inside an explicit transaction that ends in
-- ROLLBACK, so the shared test DB is never polluted and no defensive pre-clean
-- is needed. All ids are gen_random_uuid() and every auth.users email is
-- derived from a fresh uuid, so a concurrent CI run against the shared test
-- project cannot collide. auth.uid() is driven by set_config on
-- request.jwt.claims (the Supabase JWT GUC the SECURITY DEFINER functions
-- read); the outer block stays in the service-role context so verification
-- SELECTs bypass RLS.
--
-- Pre-migration (RED): until 20260819120000 is applied to the target database
-- this file reds at Part 1 with 42883 (the fold does not exist) — that is the
-- designed free-standing RED on the PR's first sql-tests run, before Plan 06
-- applies the migration to the TEST project.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_csv_finalize_double_submit.sql
--
-- ⭐ RED-UNDER ANNOTATIONS (Phase 164.4). Each assertion below carries a prose
-- `RED-UNDER:` naming the smallest production change that makes it fail, and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE it reds on its own arm, then restores
-- GREEN. Schema: scripts/mutation-runner/GRAMMAR.md. The line below declares
-- what the lane applies before this gate.
-- ⚠️ THE OBJECTS UNDER TEST ARE REAL. The fold is the same three-migration
-- chain test_csv_finalize_atomic_fold.sql pins (20260819120000 -> 130000 ->
-- 151000, the LAST of which every fold twin mutates); the fence index and the
-- 5-arg parent's re-base come from 20260728120000; and Part 4's API-path writer
-- is the REAL `create_wizard_strategy` from 20260814120000, the migration whose
-- Phase 156 narrowing is why Part 4's claim is service_role-shaped.
-- 17-fixture-wizard-draft-writer.sql supplies only the api_keys secret-material
-- columns that writer's INSERT names — no arm in this file reads any of them.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/13-fixture-csv-finalize-fold.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/17-fixture-wizard-draft-writer.sql","supabase/migrations/20260522111839_csv_daily_returns.sql","supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql","supabase/migrations/20260728120000_csv_finalize_double_submit_idempotency.sql","supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql","supabase/migrations/20260819120000_csv_finalize_atomic_fold.sql","supabase/migrations/20260819130000_csv_finalize_fold_input_guards.sql","supabase/migrations/20260819151000_csv_finalize_fold_guard1_null_safe.sql"]}

BEGIN;

DO $$
DECLARE
  uid_a        UUID := gen_random_uuid();  -- double-submit tenant
  uid_b        UUID := gen_random_uuid();  -- cross-source control tenant
  session_a    UUID := gen_random_uuid();
  session_b    UUID := gen_random_uuid();
  payload_a    JSONB := '[{"date":"2026-03-01","daily_return":0.0123},
                          {"date":"2026-03-02","daily_return":-0.0021},
                          {"date":"2026-03-03","daily_return":0.0007}]'::jsonb;
  payload_b    JSONB := '[{"date":"2026-04-01","daily_return":0.005}]'::jsonb;
  v_strat_csv1 UUID;
  v_strat_csv2 UUID;
  v_strat_api  UUID;
  v_key_api    UUID;
  v_wsid       UUID;
  v_source     TEXT;
  row_cnt      INTEGER;
  sv_cnt       INTEGER;
  dl_cnt       INTEGER;
  v_spot_ret   DOUBLE PRECISION;
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
  -- Part 1 — the first CSV submit succeeds, STORES the session id, and the
  --          dailies LAND (the fold's third write, asserted economically)
  -- ======================================================================
  -- Drive auth.uid() = uid_a (the JWT GUC the SECDEF fn reads). Stay in the
  -- service-role role so verification SELECTs below bypass RLS.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  v_strat_csv1 := public.finalize_csv_strategy_with_returns(
    uid_a, session_a, 'daily_returns', 'CSV double-submit receipt A', payload_a);

  IF v_strat_csv1 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1a): the first finalize_csv_strategy_with_returns returned NULL - the CSV finalize path is broken before this test can say anything about double submits';
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
  -- RED-UNDER: stop the fold writing the session id — replace
  --            `p_wizard_session_id` with NULL in the strategies INSERT's
  --            VALUES in 20260819151000 (the LAST definition of the fold).
  --            Every CSV row then sits OUTSIDE the partial index and the
  --            double-submit fence is silently gone — finding C-2 itself.
  --            LAYERED: that migration's own post-verify (c) refuses the
  --            apply first, so the twin's second step removes THAT term
  --            and nothing else — the gate, not the migration, must red.
  -- RED-UNDER-M: {"arm":"Part 1c","apply":[{"kind":"edit","file":"supabase/migrations/20260819151000_csv_finalize_fold_guard1_null_safe.sql","find":"    '{}', '{}', '{}', '{}'::text[],\n    p_wizard_session_id\n  )","replace":"    '{}', '{}', '{}', '{}'::text[],\n    NULL\n  )","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819151000_csv_finalize_fold_guard1_null_safe.sql","find":"  IF v_ins_frag !~ '\\mp_wizard_session_id\\M' THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  IF v_wsid IS DISTINCT FROM session_a THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1c): the finalized strategy carries wizard_session_id=% , expected % - the fold is not writing the column, so every CSV row sits OUTSIDE the partial unique index (review finding C-2)', v_wsid, session_a;
  END IF;

  -- The dailies landed — the write the fold ADDED over the old two-write
  -- finalize. Economic oracle: WHAT IS PERSISTED EQUALS WHAT WAS SUBMITTED
  -- (row count + one spot-checked (date, value) pair), never a re-derivation.
  SELECT count(*) INTO dl_cnt
    FROM public.csv_daily_returns WHERE strategy_id = v_strat_csv1;
  IF dl_cnt <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1d): % csv_daily_returns rows for the finalized strategy, expected 3 (the submitted payload) - the fold''s dailies write is missing or partial, i.e. the two-RPC orphan shape is back', dl_cnt;
  END IF;
  SELECT daily_return INTO v_spot_ret
    FROM public.csv_daily_returns
   WHERE strategy_id = v_strat_csv1 AND date = DATE '2026-03-02';
  IF v_spot_ret IS DISTINCT FROM -0.0021 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1e): daily_return for 2026-03-02 is % , expected -0.0021 as submitted - the persisted series does not equal the submitted file', v_spot_ret;
  END IF;

  RAISE NOTICE 'Part 1 OK: first CSV finalize created strategy % with source=csv, wizard_session_id=%, and all 3 submitted dailies persisted (spot check 2026-03-02 = -0.0021).', v_strat_csv1, session_a;

  -- ======================================================================
  -- Part 2 — the SECOND submit of the same session raises 23505
  -- ======================================================================
  -- The duplicate the product's own copy INSTRUCTS: CSV_SUBMIT_NO_STRATEGY_ID's
  -- fix line reads "Submit again." Before 20260728120000 that second call
  -- returned 200 OK with duplicate rows, silently.
  --
  -- `WHEN others` + an explicit SQLSTATE check rather than
  -- `WHEN unique_violation`: if the call fails for some OTHER reason (42501
  -- auth, 22023 validation) we must report THAT, not silently accept any
  -- failure as proof of the fence.
  -- RED-UNDER: narrow STEP 1's partial predicate in 20260728120000 to
  --            `WHERE wizard_session_id IS NOT NULL AND source IS NULL`, so no
  --            finalized row is covered and the fence stops biting. The
  --            migration's own STEP 4 still passes — (a) sees the same three
  --            columns, (a2) still finds `wizard_session_id IS NOT NULL` in the
  --            indexdef — which is why a PREDICATE drift is the shape worth
  --            pinning behaviourally here rather than structurally.
  -- RED-UNDER-M: {"arm":"Part 2a","apply":[{"kind":"edit","file":"supabase/migrations/20260728120000_csv_finalize_double_submit_idempotency.sql","find":"  ON public.strategies (user_id, wizard_session_id, source)\n  WHERE wizard_session_id IS NOT NULL;","replace":"  ON public.strategies (user_id, wizard_session_id, source)\n  WHERE wizard_session_id IS NOT NULL AND source IS NULL;","occurrences":1}]}
  raised := FALSE;
  BEGIN
    v_strat_csv2 := public.finalize_csv_strategy_with_returns(
      uid_a, session_a, 'daily_returns', 'CSV double-submit receipt A retry', payload_a);
  EXCEPTION WHEN others THEN
    raised   := TRUE;
    err_code := SQLSTATE;
    err_msg  := SQLERRM;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2a): the SECOND finalize_csv_strategy_with_returns for (user, session) SUCCEEDED and returned % - a CSV double-submit just minted a duplicate strategy (review finding C-2)', v_strat_csv2;
  END IF;
  IF err_code <> '23505' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2b): the second finalize_csv_strategy_with_returns failed with SQLSTATE % (%) - expected 23505 unique_violation from strategies_user_wizard_session_source_uniq', err_code, err_msg;
  END IF;

  RAISE NOTICE 'Part 2 OK: the second CSV finalize for the same (user, session) raised 23505.';

  -- ======================================================================
  -- Part 3 — the rollback, ASSERTED rather than assumed — THREE tables
  -- ======================================================================
  -- The folded body has NO handler clause, so the unhandled 23505 aborts the
  -- function and the enclosing statement and ALL THREE inserts roll back.
  --
  -- ⚠️ HONESTY NOTE, SCOPE OF WHAT THE COUNTS BELOW CATCH (v1.19
  -- review-of-146.1 finding W2; same register as the 146.1-07 note at
  -- test_csv_finalize_atomic_fold.sql Part 2c). This header used to claim the
  -- counts catch a future handler that "swallows the violation after any
  -- INSERT — OR catches it, writes dailies onto the existing strategy, and
  -- re-raises". The first half is true. THE SECOND HALF WAS NOT, and it is
  -- retracted here rather than left standing:
  --
  -- Both variants were MEASURED on a throwaway postgres:16 over a miniature
  -- schema (phase 146.2 plan 05), by installing each handler in the fold and
  -- re-running this file — not reasoned about:
  --
  --   * SWALLOW variant — a handler that catches the 23505, writes, and
  --     returns normally: CAUGHT, twice over. Part 2a reds first ("the SECOND
  --     finalize ... SUCCEEDED and returned <id>") and stops the file under
  --     ON_ERROR_STOP; and the counts themselves do move — the same double
  --     submit driven outside this file reads strategies=1,
  --     verifications=2, dailies=3 against Part 3's expected 1 / 1 / 3, so
  --     Part 3b would red on its own if 2a ever went away.
  --   * CATCH-WRITE-AND-RE-RAISE variant — NOT caught, and not catchable by
  --     ANY row count. A plpgsql EXCEPTION block is an implicit
  --     SUBTRANSACTION (a savepoint). When the handler re-raises, that
  --     subtransaction rolls back, so the handler's OWN writes are undone by
  --     plpgsql semantics regardless of anything the fold does. MEASURED:
  --     with `EXCEPTION WHEN OTHERS THEN RAISE;` appended to the fold, Parts
  --     1, 2 and 3 of this file all report OK and Part 3 prints the same
  --     "exactly 1 ... 1 ... 3" it prints on a healthy body. Counting rows
  --     cannot distinguish "no handler" from "a handler whose writes were
  --     rolled back" — only STRUCTURE can.
  --
  -- The re-raise variant is fenced, but somewhere else: the standing
  -- comment-stripped prosrc assertion at
  -- supabase/tests/test_csv_finalize_atomic_fold.sql Part 1d reds on ANY
  -- handler clause in the deployed body, catch-and-re-raise included. If that
  -- pin is ever deleted, this variant becomes unfenced across the whole suite
  -- — do not delete it, and do not restore the retracted claim here to paper
  -- over its absence.
  --
  -- What Parts 3a-3c below assert therefore stands unchanged and is worth
  -- keeping: the FIRST submission's rows survive the rejected second call
  -- intact — neither deleted, nor doubled, nor upserted over.
  SELECT count(*) INTO row_cnt
    FROM public.strategies
   WHERE user_id = uid_a AND wizard_session_id = session_a;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3a): % strategies rows for (uid_a, session_a) after the rejected double submit, expected exactly 1', row_cnt;
  END IF;

  -- RED-UNDER: stop the fold stamping the session on its SECOND write —
  --            replace `p_wizard_session_id` with NULL in the
  --            strategy_verifications INSERT's VALUES in 20260819151000. The
  --            strategies row is untouched, so Part 3a still passes and only
  --            the verification half of the rollback claim goes dark.
  -- RED-UNDER-M: {"arm":"Part 3b","apply":[{"kind":"edit","file":"supabase/migrations/20260819151000_csv_finalize_fold_guard1_null_safe.sql","find":"    v_strategy_id, p_wizard_session_id, 'validated', 'csv_uploaded', 'csv', 'csv',","replace":"    v_strategy_id, NULL, 'validated', 'csv_uploaded', 'csv', 'csv',","occurrences":1}]}
  SELECT count(*) INTO sv_cnt
    FROM public.strategy_verifications sv
    JOIN public.strategies s ON s.id = sv.strategy_id
   WHERE s.user_id = uid_a AND sv.wizard_session_id = session_a;
  IF sv_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3b): % strategy_verifications rows for (uid_a, session_a) after the rejected double submit, expected exactly 1 - the failed call did not roll back its verification row', sv_cnt;
  END IF;

  -- The WIDENED third table: the first submission's dailies are untouched by
  -- the failed second call — neither deleted, nor doubled, nor upserted over.
  SELECT count(*) INTO dl_cnt
    FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = uid_a AND s.wizard_session_id = session_a;
  IF dl_cnt <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3c): % csv_daily_returns rows for (uid_a, session_a) after the rejected double submit, expected exactly 3 (the FIRST submission''s payload, unchanged) - the failed second call left partial dailies work behind, i.e. the fold''s all-or-nothing rollback is broken', dl_cnt;
  END IF;

  RAISE NOTICE 'Part 3 OK: exactly 1 strategies row, 1 strategy_verifications row and 3 dailies survive - the failed submit rolled all three writes back.';

  -- ======================================================================
  -- Part 4 — THE CROSS-SOURCE CONTROL (pins the `source` column in the index)
  -- ======================================================================
  -- An ABANDONED API draft carrying session S must not block a later CSV
  -- finalize with the SAME S. Reachable because deriveWizardResumeOverrides
  -- restores wizardSessionId across the CSV/API boundary from one shared
  -- storage key.
  --
  -- ⚠️ THIS IS THE ONLY CASE IN THIS FILE THAT A TWO-COLUMN
  -- (user_id, wizard_session_id) INDEX FAILS. Parts 1-3 pass under both
  -- shapes. Deleting or weakening it silently deletes the whole reason
  -- `source` is in the key, and re-opens a PERMANENT first-submit failure for
  -- the affected user. Service-role-shaped call.
  --
  -- ⭐ WHY THIS CLAIM IS service_role, and why it is the ONLY claim in this
  -- file shaped that way. It precedes the `create_wizard_strategy` call below
  -- — a WIZARD RPC, whose body Migration B (20260814120000) narrowed to
  -- `auth.role() = 'service_role'`, deleting the auth.uid() comparison a
  -- `'role', 'authenticated'` claim used to satisfy. That call is DELIBERATELY
  -- NOT wrapped in a handler (see the note at the control itself), so under
  -- the old claim a 42501 would propagate and, under ON_ERROR_STOP=1, kill
  -- this whole file — not with a message about the `source` column, but with
  -- an authorization error from a fixture that simply called the wrong way.
  -- ⛔ Part 1's claim above is NOT touched and must not be: it precedes the
  -- fold, which is not a wizard RPC, is untouched by Phase 156, and still
  -- reads auth.uid(). Flipping it would silently change what Parts 1-3 mean.
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

  -- VACUITY FENCE. If the API writer ever stops setting source='wizard' or
  -- stops storing the session id, the CSV finalize below would succeed for a
  -- reason that has nothing to do with the `source` column, and this control
  -- would report agreement forever. Assert the precondition before relying on
  -- it.
  -- RED-UNDER: make the REAL API writer stop labelling its draft — change
  --            `'draft', 'wizard',` to `'draft', 'api',` in
  --            create_wizard_strategy's strategies INSERT (20260814120000, the
  --            LAST definition). That is precisely the drift this fence exists
  --            to catch: without it the cross-source control below would
  --            succeed for a reason unrelated to the `source` column.
  -- RED-UNDER-M: {"arm":"Part 4a, vacuity fence","apply":[{"kind":"edit","file":"supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql","find":"    p_user_id, v_key_id, p_placeholder_name, 'draft', 'wizard',","replace":"    p_user_id, v_key_id, p_placeholder_name, 'draft', 'api',","occurrences":1}]}
  SELECT wizard_session_id, source INTO v_wsid, v_source
    FROM public.strategies WHERE id = v_strat_api;
  IF v_source IS DISTINCT FROM 'wizard' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4a, vacuity fence): the API draft carries source=% , expected ''wizard'' - the cross-source control below would be testing nothing', v_source;
  END IF;
  IF v_wsid IS DISTINCT FROM session_b THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4a, vacuity fence): the API draft carries wizard_session_id=% , expected % - with no session id on the API row there is no cross-source collision to control for', v_wsid, session_b;
  END IF;

  -- Restore the authenticated claim shape for the CSV finalize below, so the
  -- control call mirrors the fold's REAL caller (the route's user-scoped SSR
  -- session). auth.uid() reads `sub` either way — this flip is about calling
  -- the way production calls, not about making the call pass.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);

  -- The control itself: same user, SAME session id, different source -> MUST
  -- SUCCEED. Deliberately NOT wrapped in a handler: a 23505 here propagates
  -- and, under ON_ERROR_STOP=1, fails the job with the raw constraint name,
  -- which is the most useful possible failure message.
  v_strat_csv2 := public.finalize_csv_strategy_with_returns(
    uid_b, session_b, 'daily_returns', 'CSV first submit after abandoned API draft', payload_b);

  IF v_strat_csv2 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4b): the cross-source CSV finalize returned NULL';
  END IF;
  IF v_strat_csv2 = v_strat_api THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4b): the cross-source CSV finalize returned the API draft''s id (%) instead of minting its own strategy', v_strat_api;
  END IF;

  -- Exactly two rows for (uid_b, session_b): one per source, each
  -- independently fenced. This is the positive statement of what the
  -- three-column key buys.
  -- RED-UNDER: change the fold's ingestion label — `'csv'` to `'csv_import'`
  --            in the strategies INSERT's VALUES in 20260819151000. The
  --            double-submit fence still bites (both submits carry the SAME new
  --            label, so Parts 2 and 3 stay green) and the two rows for
  --            (uid_b, session_b) are still two — but neither is identifiable
  --            as the CSV one, which is the second half of what the
  --            three-column key buys.
  --            NEUTERS Part 1b: that arm reads the same label directly and
  --            would red first. Neutering it is what makes THIS arm the first
  --            failure; it is not a claim that Part 1b is redundant.
  -- RED-UNDER-M: {"arm":"Part 4c","apply":[{"kind":"edit","file":"supabase/migrations/20260819151000_csv_finalize_fold_guard1_null_safe.sql","find":"    p_user_id, p_strategy_name, p_terminal_status, 'csv',","replace":"    p_user_id, p_strategy_name, p_terminal_status, 'csv_import',","occurrences":1}],"neuter":[{"arm":"Part 1b"}]}
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
  RAISE NOTICE 'test_csv_finalize_double_submit: ALL PASS (first submit stores the session id and persists the submitted dailies, the second raises 23505, all THREE writes roll back, and the cross-source first submit still succeeds).';
END
$$;

ROLLBACK;
