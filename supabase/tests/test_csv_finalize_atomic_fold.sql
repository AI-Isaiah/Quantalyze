-- Test: finalize_csv_strategy_with_returns — the folded three-write SECURITY
-- DEFINER transaction (migration 20260819120000_csv_finalize_atomic_fold.sql).
-- Phase 145 / JOB-06 / SC#2 (D-07) + SC#3's SQL half (D-08).
--
-- WHAT THIS FILE IS FOR
-- ---------------------
-- SC#2's guarantee is "a partial failure leaves no orphan strategy row", and
-- its only honest proof is EXECUTION AT THE DEPLOYED BODY: this file calls the
-- real fold against a real Postgres with a payload engineered to fail AFTER
-- the strategies INSERT has run, and asserts ZERO rows remain in ALL THREE
-- tables. A grep for "no handler clause" proves a state; only this execution
-- proves the state HOLDS behaviorally (the 143/D-19 oracle-discipline lesson:
-- never re-type the predicate — execute the deployed object).
--
-- WHY THE OTHER GATES CANNOT CATCH WHAT THIS ONE PINS
-- ---------------------------------------------------
-- test_csv_finalize_double_submit.sql exercises the 23505 fence and its
-- rollback; it never drives a MID-BODY data fault, never calls with
-- p_terminal_status='private', never submits an empty trades payload, and
-- never exceeds the cap. test_csv_finalize_auth_guard.sql only exercises the
-- two 42501 guards. Each of Parts 2-5 below reddens under an edit every other
-- gate stays green on.
--
-- WHAT IS ASSERTED
--   Part 1 — STRUCTURAL (deliberately UNGATED — no presence green-skip; on
--            the shared TEST project this part is designed-RED until Plan 06
--            applies 20260819120000 there, which is this file's free-standing
--            RED proof): the fold exists as EXACTLY ONE 6-arg overload,
--            SECURITY DEFINER, authenticated holds EXECUTE, anon does not.
--   Part 2 — THE ATOMICITY ORACLE (SC#2): a 10-element payload whose 6th
--            element carries a malformed date (bypassing the route validator
--            by calling the RPC directly) raises during the dailies INSERT —
--            i.e. AFTER the strategies and verification INSERTs ran — and
--            leaves ZERO strategies rows, ZERO verification rows, ZERO
--            dailies for that session.
--   Part 3 — TERMINAL STATUS (SC#3 / D-08): a 'private' call writes
--            strategies.status='private' (losing this silently promotes
--            CONTRIB-02 private contributions into the admin publish queue);
--            a default call writes 'pending_review'. Economic oracle on the
--            dailies: persisted count and a spot-checked (date, value) pair
--            equal WHAT WAS SUBMITTED — never the fold's own formula.
--   Part 4 — TRADES-EMPTY (RESEARCH Pitfall 2): an EMPTY p_rows array with
--            fmt='trades' SUCCEEDS with zero dailies — the parents'
--            empty-array 22023 must NOT have been copied verbatim, or every
--            trades finalize breaks.
--   Part 5 — THE CAP: 5001 rows raises 22023 (the 20260522111839:160-162 cap
--            survived the fold verbatim) and commits nothing.
--
-- Register: test_reconcile_dropped_enqueue_sweep.sql — ungated structural
-- Part 1; every writing part opens its OWN `BEGIN;`, sets
-- `SET LOCAL lock_timeout = '5s'`, and closes with `ROLLBACK;` (NO outer
-- whole-file transaction — psql's nested BEGIN emits a warning, creates no
-- savepoint, and the first inner rollback would end the outer transaction and
-- autocommit later seeds onto the SHARED test project). Seeds go through the
-- real FK chain with gen_random_uuid() ids so concurrent CI runs cannot
-- collide; claims are driven via set_config on request.jwt.claims (the repo's
-- standing idiom). NO psql backslash meta-commands.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_csv_finalize_atomic_fold.sql

-- ==========================================================================
-- Part 1 — STRUCTURAL: the fold exists, SECDEF, one 6-arg overload, grants
-- ==========================================================================
DO $$
DECLARE
  v_cnt    INT;
  v_secdef BOOLEAN;
  v_nargs  INT;
BEGIN
  SELECT count(*), bool_and(p.prosecdef), min(p.pronargs)
    INTO v_cnt, v_secdef, v_nargs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'finalize_csv_strategy_with_returns';

  IF v_cnt = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1): finalize_csv_strategy_with_returns does not exist - migration 20260819120000 is not applied to this database. On the shared TEST project this is the DESIGNED RED until Plan 06 applies it; anywhere else it means the csv-finalize path has NO writer at all';
  END IF;
  IF v_cnt > 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1): % overloads of finalize_csv_strategy_with_returns exist - PostgREST answers PGRST203 to every csv-finalize call while two overloads are visible', v_cnt;
  END IF;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1): finalize_csv_strategy_with_returns is not SECURITY DEFINER - every INSERT runs as the caller and fails RLS, breaking every finalize';
  END IF;
  IF v_nargs <> 6 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1): finalize_csv_strategy_with_returns has % args, expected 6 - the route caller passes 6 named arguments and would 42883', v_nargs;
  END IF;

  IF NOT has_function_privilege('authenticated',
        'public.finalize_csv_strategy_with_returns(uuid,uuid,text,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1): authenticated holds no EXECUTE on finalize_csv_strategy_with_returns - every legitimate csv-finalize answers 42501 (the 20260522111839:200-208 outage class); re-GRANT to authenticated, never to service_role';
  END IF;
  IF has_function_privilege('anon',
        'public.finalize_csv_strategy_with_returns(uuid,uuid,text,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1): anon holds EXECUTE on finalize_csv_strategy_with_returns - an unauthenticated browser can POST /rest/v1/rpc/finalize_csv_strategy_with_returns directly; a DROP+CREATE re-granted it via pg_default_acl - re-issue the REVOKE';
  END IF;

  RAISE NOTICE 'Part 1 OK: finalize_csv_strategy_with_returns is live (one 6-arg SECDEF overload; authenticated EXECUTE; anon shut out).';
END $$;

-- ==========================================================================
-- Part 2 — THE ATOMICITY ORACLE (SC#2): mid-body fault leaves ZERO rows in
--          ALL THREE tables
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  probe_user    UUID := gen_random_uuid();
  probe_session UUID := gen_random_uuid();
  v_rows        JSONB;
  v_result      UUID;
  raised        BOOLEAN := FALSE;
  err_state     TEXT;
  err_msg       TEXT;
  n_strat       INT;
  n_sv          INT;
  n_dl          INT;
BEGIN
  -- Seed through the real FK chain.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (probe_user, '00000000-0000-0000-0000-000000000000',
          'test-fold-atom-' || probe_user || '@quantalyze.test', now(), now());

  -- 10 elements; the 6th carries a date the ::DATE cast must refuse. The
  -- route validator would 400 this payload — calling the RPC directly is the
  -- point: the DB-side guarantee must hold for callers the route never sees.
  SELECT jsonb_agg(jsonb_build_object(
           'date', CASE WHEN i = 5 THEN 'not-a-date' ELSE (DATE '2026-02-01' + i)::text END,
           'daily_return', 0.002))
    INTO v_rows
    FROM generate_series(0, 9) i;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', probe_user::text, 'role', 'authenticated')::text, true);

  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'atomicity oracle probe', v_rows);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS
      err_state = RETURNED_SQLSTATE,
      err_msg   = MESSAGE_TEXT;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2a): a payload with a malformed date at element 6 SUCCEEDED and returned % - the dailies cast is not running (the dailies INSERT was removed, or the payload is being silently coerced); the atomicity oracle has nothing to observe and SC#2 is unproven', v_result;
  END IF;

  -- The exact SQLSTATE is the date-cast's (22007 invalid_datetime_format on
  -- PG16); pin the CLASS, not the code — a future PG major bumping the code
  -- within class 22 is not a regression of the guarantee under test.
  IF err_state NOT LIKE '22%' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2b): the malformed-date call failed with SQLSTATE % (%) - expected a class-22 data exception from the ::DATE cast; a different failure means the fault injected is not the fault this oracle was designed around', err_state, err_msg;
  END IF;

  -- THE ORACLE: zero rows in all three tables for this (user, session). The
  -- strategies INSERT ran before the cast raised; if ANY row survives, the
  -- fold has a handler clause (or split transactions) and the orphan-strategy
  -- class SC#2 dissolves is back.
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = probe_user;

  IF n_strat <> 0 OR n_sv <> 0 OR n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2c): after the mid-body fault, counts are strategies=%, verifications=%, dailies=% - expected 0/0/0. A committed remainder here IS the orphan strategy row JOB-06 exists to make impossible: some write survived a failure that aborted the rest', n_strat, n_sv, n_dl;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'Part 2 OK: mid-body fault (SQLSTATE %, element 6 of 10) left ZERO rows in strategies, strategy_verifications and csv_daily_returns.', err_state;
END $$;

ROLLBACK;

-- ==========================================================================
-- Part 3 — TERMINAL STATUS (SC#3 / D-08) + the economic oracle on dailies
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  probe_user  UUID := gen_random_uuid();
  session_pv  UUID := gen_random_uuid();
  session_df  UUID := gen_random_uuid();
  payload     JSONB := '[{"date":"2026-05-01","daily_return":0.0111},
                         {"date":"2026-05-02","daily_return":-0.0032}]'::jsonb;
  v_private   UUID;
  v_default   UUID;
  v_status    TEXT;
  n_dl        INT;
  v_spot      DOUBLE PRECISION;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (probe_user, '00000000-0000-0000-0000-000000000000',
          'test-fold-priv-' || probe_user || '@quantalyze.test', now(), now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', probe_user::text, 'role', 'authenticated')::text, true);

  -- (a) explicit 'private' — the CONTRIB-02 wire (route.ts contribution arm
  -- passes it explicitly). Losing the argument silently promotes private
  -- contributions into the admin publish queue (keyed on
  -- status='pending_review').
  v_private := public.finalize_csv_strategy_with_returns(
    probe_user, session_pv, 'daily_returns', 'fold private probe', payload, 'private');
  SELECT status INTO v_status FROM public.strategies WHERE id = v_private;
  IF v_status IS DISTINCT FROM 'private' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3a): a p_terminal_status=''private'' call wrote strategies.status=% - expected ''private''. The argument is being ignored or forced, and every CONTRIB-02 private contribution now lands in the admin publish queue (D-08)', v_status;
  END IF;

  -- (b) default — the manager flow omits the argument and must get
  -- 'pending_review'.
  v_default := public.finalize_csv_strategy_with_returns(
    probe_user, session_df, 'daily_returns', 'fold default probe', payload);
  SELECT status INTO v_status FROM public.strategies WHERE id = v_default;
  IF v_status IS DISTINCT FROM 'pending_review' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3b): a default-status call wrote strategies.status=% - expected ''pending_review''. The DEFAULT was changed and every manager finalize now lands in the wrong state', v_status;
  END IF;

  -- (c) economic oracle: persisted equals submitted — count and one
  -- spot-checked (date, value) pair, read back from the table, never
  -- re-derived through the fold's own expressions.
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns WHERE strategy_id = v_private;
  IF n_dl <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3c): % dailies persisted for a 2-row submission - persisted must equal submitted', n_dl;
  END IF;
  SELECT daily_return INTO v_spot FROM public.csv_daily_returns
   WHERE strategy_id = v_private AND date = DATE '2026-05-02';
  IF v_spot IS DISTINCT FROM -0.0032 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3c): daily_return for 2026-05-02 is % - expected -0.0032 exactly as submitted; a transformed value here means the fold is EDITING the user''s track record, which is money-data fabrication', v_spot;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'Part 3 OK: ''private'' writes private, default writes pending_review, and the persisted series equals the submitted file (2 rows; spot 2026-05-02 = -0.0032).';
END $$;

ROLLBACK;

-- ==========================================================================
-- Part 4 — TRADES-EMPTY: '[]' with fmt='trades' succeeds with zero dailies
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  probe_user    UUID := gen_random_uuid();
  probe_session UUID := gen_random_uuid();
  v_result      UUID;
  n_dl          INT;
  n_sv          INT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (probe_user, '00000000-0000-0000-0000-000000000000',
          'test-fold-trades-' || probe_user || '@quantalyze.test', now(), now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', probe_user::text, 'role', 'authenticated')::text, true);

  -- Deliberately NOT wrapped in a handler: if the parents' empty-array 22023
  -- was copied verbatim into the fold (RESEARCH Pitfall 2), this call raises,
  -- ON_ERROR_STOP aborts the file, and the failure message is the raw 22023 —
  -- which is exactly the regression: every fmt='trades' finalize (a
  -- legitimately empty series) would 500 in production.
  v_result := public.finalize_csv_strategy_with_returns(
    probe_user, probe_session, 'trades', 'fold trades-empty probe', '[]'::jsonb);

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4): the trades-empty finalize returned NULL';
  END IF;

  SELECT count(*) INTO n_dl FROM public.csv_daily_returns WHERE strategy_id = v_result;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications WHERE strategy_id = v_result;
  IF n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4): % dailies persisted for an EMPTY payload - the fold fabricated rows the user never submitted', n_dl;
  END IF;
  IF n_sv <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4): % verification rows for the trades-empty finalize, expected exactly 1', n_sv;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'Part 4 OK: an empty trades payload finalized successfully (strategy %, zero dailies, one verification row).', v_result;
END $$;

ROLLBACK;

-- ==========================================================================
-- Part 5 — THE CAP: 5001 rows raises 22023 and commits nothing
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  probe_user    UUID := gen_random_uuid();
  probe_session UUID := gen_random_uuid();
  v_rows        JSONB;
  v_result      UUID;
  raised        BOOLEAN := FALSE;
  err_state     TEXT;
  err_msg       TEXT;
  n_strat       INT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (probe_user, '00000000-0000-0000-0000-000000000000',
          'test-fold-cap-' || probe_user || '@quantalyze.test', now(), now());

  SELECT jsonb_agg(jsonb_build_object('date', (DATE '2000-01-01' + i)::text, 'daily_return', 0.0001))
    INTO v_rows
    FROM generate_series(0, 5000) i;   -- 5001 elements

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', probe_user::text, 'role', 'authenticated')::text, true);

  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'fold cap probe', v_rows);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS
      err_state = RETURNED_SQLSTATE,
      err_msg   = MESSAGE_TEXT;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 5a): a 5001-row payload SUCCEEDED and returned % - the 5000-row cap (20260522111839:160-162) did not survive the fold; a direct RPC caller can insert an unbounded series (the route validator is bypassable by construction)', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 5b): the 5001-row call failed with SQLSTATE % (%) - expected 22023 from the cap guard, BEFORE any write', err_state, err_msg;
  END IF;

  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  IF n_strat <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 5c): % strategies rows exist after the capped call - the cap guard ran AFTER a write instead of before every write', n_strat;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'Part 5 OK: 5001 rows raised 22023 (%) and committed nothing.', err_msg;
  RAISE NOTICE 'test_csv_finalize_atomic_fold: ALL PASS (structural; atomicity oracle zero/zero/zero; private + default status; trades-empty; 5000 cap).';
END $$;

ROLLBACK;
