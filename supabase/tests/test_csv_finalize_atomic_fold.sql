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
--   Part 3d — TERMINAL STATUS, THE REFUSAL SIDE (v1.19 review C4): a
--            p_terminal_status='published' call raises 22023 and commits
--            nothing. Part 3 only ever proved the two ACCEPTED values; the
--            whitelist's refusal arm shipped ungated, so nothing would have
--            noticed a direct-RPC caller finalizing straight onto the public
--            surface without entering the admin review queue.
--   Part 4 — TRADES-EMPTY (RESEARCH Pitfall 2): an EMPTY p_rows array with
--            fmt='trades' SUCCEEDS with zero dailies — the parents'
--            empty-array 22023 must NOT have been copied verbatim, or every
--            trades finalize breaks.
--   Part 5 — THE CAP: 5001 rows raises 22023 (the 20260522111839:160-162 cap
--            survived the fold verbatim) and commits nothing.
--   Part 6 — THE INPUT GUARDS (v1.19 review A1, migration 20260819130000).
--            Twelve negative sub-Parts (6a-6h, 6j-6m), each asserting the call
--            RAISED, that RETURNED_SQLSTATE is EXACTLY '22023', and that
--            strategies / strategy_verifications / csv_daily_returns each hold
--            ZERO rows for the probe — proving the guard ran BEFORE any write
--            rather than being undone by a rollback afterwards. Plus 6i, the
--            UNWRAPPED conforming-payload counterpart, without which a body
--            that refuses EVERYTHING would pass Part 6 perfectly.
--            ⚠️ Reachability, stated so nobody re-files this as a live break:
--            the route already 400s the empty-series shapes at
--            route.ts:1337-1352. These guards are BOUNDARY HARDENING against
--            an AUTHENTICATED DIRECT-RPC caller, confined by the fold's own
--            auth.uid() guard to poisoning that caller's OWN tenant.
--   Part 7 — THE RE-HOMED fmt / NAME GUARDS (v1.19 review B5): invalid fmt,
--            empty name, name > 80 chars each raise 22023 and commit nothing.
--
-- WHY PARTS 6 AND 7 LIVE HERE AND NOT IN VITEST (v1.19 review B5)
-- ----------------------------------------------------------------
-- The invalid-fmt / empty-name / oversize-name guard behaviours used to be
-- asserted in src/__tests__/csv-finalize-rpc.test.ts. Those cases were
-- `it.skipIf(!HAS_LIVE_DB)` and HAS_LIVE_DB is false in EVERY CI vitest shard
-- by explicit instruction (.github/workflows/ci.yml:286), so they had never
-- executed in CI even once — and since Phase 145 they also called
-- finalize_csv_strategy, a function 20260819120000 DROPped, so they could
-- never pass again. They were re-homed here because THIS file is
-- auto-discovered by the sql-tests glob (supabase/tests/test_*.sql) and runs
-- under `psql -v ON_ERROR_STOP=1` against the TEST project. Coverage that
-- cannot execute is not coverage.
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
-- Part 3d — TERMINAL STATUS, THE REFUSAL SIDE (v1.19 review C4):
--           p_terminal_status='published' raises 22023 and commits nothing
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  probe_user    UUID := gen_random_uuid();
  probe_session UUID := gen_random_uuid();
  payload       JSONB := '[{"date":"2026-05-01","daily_return":0.0111}]'::jsonb;
  v_result      UUID;
  raised        BOOLEAN := FALSE;
  err_state     TEXT;
  err_msg       TEXT;
  n_strat       INT;
  n_sv          INT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (probe_user, '00000000-0000-0000-0000-000000000000',
          'test-fold-pub-' || probe_user || '@quantalyze.test', now(), now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', probe_user::text, 'role', 'authenticated')::text, true);

  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'fold published probe', payload, 'published');
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS
      err_state = RETURNED_SQLSTATE,
      err_msg   = MESSAGE_TEXT;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3d): a p_terminal_status=''published'' call SUCCEEDED and returned % - the CONTRIB-02 whitelist (D-08) is gone, so a direct-RPC caller can finalize an unreviewed CSV strategy straight onto the public surface without ever entering the admin review queue', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3d): the ''published'' call failed with SQLSTATE % (%) - expected 22023 from the terminal-status whitelist, BEFORE any write. A different code means the refusal came from somewhere else (a CHECK constraint, an enum cast) and the whitelist itself may already be gone', err_state, err_msg;
  END IF;

  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  IF n_strat <> 0 OR n_sv <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3d): after the refused ''published'' call, counts are strategies=%, verifications=% - expected 0/0. The whitelist ran AFTER a write instead of as the FIRST statement, which is the placement D-08 requires', n_strat, n_sv;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'Part 3d OK: p_terminal_status=''published'' raised 22023 (%) and committed nothing.', err_msg;
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
END $$;

ROLLBACK;

-- ==========================================================================
-- Part 6 — THE INPUT GUARDS (v1.19 review A1; migration 20260819130000).
--          Twelve NEGATIVE sub-Parts. Each asserts three things IN ORDER:
--          (i) the call RAISED, (ii) RETURNED_SQLSTATE is EXACTLY '22023',
--          (iii) strategies / strategy_verifications / csv_daily_returns each
--          hold ZERO rows for the probe. (iii) is what separates "the guard
--          ran before any write" from "a rollback cleaned up afterwards" —
--          without it, moving a guard below the strategies INSERT would go
--          unnoticed.
--
--          ⚠️ EXACT SQLSTATE, never LIKE '22%' and never "any error". Sub-Parts
--          6f/6m (missing daily_return / missing date) exist precisely to prove
--          the guard fires AHEAD of csv_daily_returns' NOT NULL constraints,
--          which would give 23502; sub-Part 6h proves it fires ahead of
--          csv_daily_returns_strategy_date_key, which would give 23505. A
--          class-pinned assertion would PASS on the very failure mode being
--          fenced.
--
--          ⚠️ Each sub-Part is written out in full rather than driven from a
--          loop, deliberately: a loop would collapse to a single
--          GET STACKED DIAGNOSTICS site and to one generic consequence
--          message, and a loop that iterates zero times passes while asserting
--          nothing.
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  probe_user    UUID := gen_random_uuid();
  probe_session UUID;
  v_result      UUID;
  raised        BOOLEAN;
  err_state     TEXT;
  err_msg       TEXT;
  n_strat       INT;
  n_sv          INT;
  n_dl          INT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (probe_user, '00000000-0000-0000-0000-000000000000',
          'test-fold-guards-' || probe_user || '@quantalyze.test', now(), now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', probe_user::text, 'role', 'authenticated')::text, true);

  -- ---- Part 6a — p_rows := NULL, fmt='daily_returns' ----------------------
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'fold guard probe 6a', NULL::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6a): a NULL p_rows call SUCCEEDED and returned % - the NULL guard is gone. jsonb_typeof(NULL) is NULL, NULL <> ''array'' is NULL and plpgsql takes the ELSE branch, so a NULL argument walks past EVERY rows guard and commits a strategy with zero dailies that the Phase 143 sweep structurally cannot heal', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6a): the NULL p_rows call failed with SQLSTATE % (%) - expected 22023 from the p_rows NULL guard, BEFORE any write', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = probe_user;
  IF n_strat <> 0 OR n_sv <> 0 OR n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6a): counts are strategies=%, verifications=%, dailies=% after the refused call - expected 0/0/0; the guard ran AFTER a write instead of before every write', n_strat, n_sv, n_dl;
  END IF;
  RAISE NOTICE 'Part 6a OK: NULL p_rows raised 22023 (%) and committed nothing.', err_msg;

  -- ---- Part 6b — p_rows := '[]', fmt='daily_returns' ----------------------
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'fold guard probe 6b', '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6b): an EMPTY daily_returns payload SUCCEEDED and returned % - the empty-array guard is gone or is still scoped to every fmt, and a strategy now exists whose entire track record is nothing', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6b): the empty daily_returns call failed with SQLSTATE % (%) - expected 22023 from the empty-rows guard, BEFORE any write', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = probe_user;
  IF n_strat <> 0 OR n_sv <> 0 OR n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6b): counts are strategies=%, verifications=%, dailies=% after the refused call - expected 0/0/0; the guard ran AFTER a write instead of before every write', n_strat, n_sv, n_dl;
  END IF;
  RAISE NOTICE 'Part 6b OK: empty daily_returns raised 22023 (%) and committed nothing.', err_msg;

  -- ---- Part 6c — p_rows := '[]', fmt := NULL ------------------------------
  -- The NULL-fmt reachability probe. Without `p_fmt IS NULL OR` on the fmt
  -- whitelist, `p_fmt NOT IN (...)` is NULL for a NULL fmt and plpgsql takes
  -- the ELSE branch, so an unformatted call walks past the whitelist AND past
  -- a `<>`-scoped empty-array guard, and finalizes with zero dailies.
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, NULL::text, 'fold guard probe 6c', '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6c): an empty payload with a NULL fmt SUCCEEDED and returned % - both the fmt whitelist and the empty-rows guard are NULL-blind, which is the exact three-valued-logic hole finding A1 measured', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6c): the NULL-fmt call failed with SQLSTATE % (%) - expected 22023 from a NULL-explicit guard, BEFORE any write', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = probe_user;
  IF n_strat <> 0 OR n_sv <> 0 OR n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6c): counts are strategies=%, verifications=%, dailies=% after the refused call - expected 0/0/0; the guard ran AFTER a write instead of before every write', n_strat, n_sv, n_dl;
  END IF;
  RAISE NOTICE 'Part 6c OK: NULL fmt raised 22023 (%) and committed nothing.', err_msg;

  -- ---- Part 6d — daily_return "NaN" ---------------------------------------
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'fold guard probe 6d',
      '[{"date":"2026-02-01","daily_return":"NaN"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6d): a NaN daily_return SUCCEEDED and returned % - the value scan is gone. A NaN in the series makes Sharpe, Sortino and every drawdown undefined for every downstream consumer, and no recompute can ever turn it back into a number', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6d): the NaN call failed with SQLSTATE % (%) - expected 22023 from the value scan, BEFORE any write', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = probe_user;
  IF n_strat <> 0 OR n_sv <> 0 OR n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6d): counts are strategies=%, verifications=%, dailies=% after the refused call - expected 0/0/0; the guard ran AFTER a write instead of before every write', n_strat, n_sv, n_dl;
  END IF;
  RAISE NOTICE 'Part 6d OK: NaN daily_return raised 22023 (%) and committed nothing.', err_msg;

  -- ---- Part 6e — daily_return 1e300 ---------------------------------------
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'fold guard probe 6e',
      '[{"date":"2026-02-01","daily_return":1e300}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6e): a 1e300 daily_return SUCCEEDED and returned % - the magnitude bound is gone, and a single such row overflows every compounded equity curve derived from this series to Infinity', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6e): the 1e300 call failed with SQLSTATE % (%) - expected 22023 from the value scan, BEFORE any write', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = probe_user;
  IF n_strat <> 0 OR n_sv <> 0 OR n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6e): counts are strategies=%, verifications=%, dailies=% after the refused call - expected 0/0/0; the guard ran AFTER a write instead of before every write', n_strat, n_sv, n_dl;
  END IF;
  RAISE NOTICE 'Part 6e OK: 1e300 daily_return raised 22023 (%) and committed nothing.', err_msg;

  -- ---- Part 6f — daily_return ABSENT (must be 22023, NOT 23502) -----------
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'fold guard probe 6f',
      '[{"date":"2026-02-01"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6f): an element with no daily_return SUCCEEDED and returned % - the NULL-value arm of the value scan is gone', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6f): the missing-daily_return call failed with SQLSTATE % (%) - expected 22023 EXACTLY. 23502 here means the payload was stopped by csv_daily_returns'' NOT NULL constraint AFTER the guards let it through: the caller gets an error naming a column instead of the offending input, and the route has no arm that maps it', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = probe_user;
  IF n_strat <> 0 OR n_sv <> 0 OR n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6f): counts are strategies=%, verifications=%, dailies=% after the refused call - expected 0/0/0; the guard ran AFTER a write instead of before every write', n_strat, n_sv, n_dl;
  END IF;
  RAISE NOTICE 'Part 6f OK: missing daily_return raised 22023 (%) and committed nothing.', err_msg;

  -- ---- Part 6g — date '9999-12-31' ----------------------------------------
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'fold guard probe 6g',
      '[{"date":"9999-12-31","daily_return":0.01}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6g): a 9999-12-31 dated return SUCCEEDED and returned % - the future-date fence is gone, and a track record that extends past today is a claim about performance that has not happened yet', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6g): the future-dated call failed with SQLSTATE % (%) - expected 22023 from the value scan, BEFORE any write', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = probe_user;
  IF n_strat <> 0 OR n_sv <> 0 OR n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6g): counts are strategies=%, verifications=%, dailies=% after the refused call - expected 0/0/0; the guard ran AFTER a write instead of before every write', n_strat, n_sv, n_dl;
  END IF;
  RAISE NOTICE 'Part 6g OK: 9999-12-31 raised 22023 (%) and committed nothing.', err_msg;

  -- ---- Part 6h — two elements sharing one date (22023, NOT 23505) ---------
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'fold guard probe 6h',
      '[{"date":"2026-02-01","daily_return":0.01},
        {"date":"2026-02-01","daily_return":0.02}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6h): a payload with two returns for one day SUCCEEDED and returned % - the duplicate-date scan is gone', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6h): the duplicate-date call failed with SQLSTATE % (%) - expected 22023 EXACTLY. 23505 here means the payload reached the dailies INSERT and tripped csv_daily_returns_strategy_date_key: the route''s resolve arm reads ANY 23505 as the double-submit fence, so a permanent input defect comes back to the user as a 503 invitation to retry forever', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = probe_user;
  IF n_strat <> 0 OR n_sv <> 0 OR n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6h): counts are strategies=%, verifications=%, dailies=% after the refused call - expected 0/0/0; the guard ran AFTER a write instead of before every write', n_strat, n_sv, n_dl;
  END IF;
  RAISE NOTICE 'Part 6h OK: duplicate dates raised 22023 (%) and committed nothing.', err_msg;

  -- ---- Part 6j — daily_return 10.5, THE NEAR-BOUNDARY PROBE ---------------
  -- ⭐ Do not drop this sub-Part. Without it the magnitude guard can be widened
  -- from BETWEEN -10 AND 10 to BETWEEN -10 AND 100 with EVERY other detector
  -- staying green: 6d's NaN fails any BETWEEN whatever the bound (Postgres
  -- sorts NaN above all numbers), 6e's 1e300 still exceeds 100, and a bare
  -- substring gate is satisfied by '-10 AND 100' as a prefix. 6j is the only
  -- probe that sits between 10 and 100; with 6i (9.9 accepted) it is the
  -- discriminating pair that pins the bound at exactly +/-10.
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'fold guard probe 6j',
      '[{"date":"2026-02-01","daily_return":10.5}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6j): a daily_return of 10.5 (a +1050%% day) SUCCEEDED and returned % - the magnitude bound has been WIDENED past +/-10 and no longer mirrors MAX_DAILY_RETURN at route.ts:198-200, so the DB accepts series the route refuses and the two fences disagree silently', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6j): the 10.5 call failed with SQLSTATE % (%) - expected 22023 from the value scan, BEFORE any write', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = probe_user;
  IF n_strat <> 0 OR n_sv <> 0 OR n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6j): counts are strategies=%, verifications=%, dailies=% after the refused call - expected 0/0/0; the guard ran AFTER a write instead of before every write', n_strat, n_sv, n_dl;
  END IF;
  RAISE NOTICE 'Part 6j OK: 10.5 raised 22023 (%) and committed nothing.', err_msg;

  -- ---- Part 6k — date '0001-01-01', the LOWER date fence ------------------
  -- The only probe of the `< 1900-01-01` arm. Without it that arm can be
  -- deleted with 6g (a FUTURE date) still green.
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'fold guard probe 6k',
      '[{"date":"0001-01-01","daily_return":0.01}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6k): a 0001-01-01 dated return SUCCEEDED and returned % - the lower date fence is gone, and every window, drawdown and annualization downstream now reads a two-millennium span as the strategy''s real history', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6k): the 0001-01-01 call failed with SQLSTATE % (%) - expected 22023 from the value scan, BEFORE any write', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = probe_user;
  IF n_strat <> 0 OR n_sv <> 0 OR n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6k): counts are strategies=%, verifications=%, dailies=% after the refused call - expected 0/0/0; the guard ran AFTER a write instead of before every write', n_strat, n_sv, n_dl;
  END IF;
  RAISE NOTICE 'Part 6k OK: 0001-01-01 raised 22023 (%) and committed nothing.', err_msg;

  -- ---- Part 6l — daily_return "-Infinity", the LOWER magnitude fence ------
  -- The only probe that pins the LOWER bound. A guard mis-written as
  -- `daily_return > 10` still catches NaN (which sorts above every number),
  -- 1e300 and 10.5 — 6d, 6e and 6j would all stay green while every negative
  -- outlier walked straight through.
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'fold guard probe 6l',
      '[{"date":"2026-02-01","daily_return":"-Infinity"}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6l): a -Infinity daily_return SUCCEEDED and returned % - the LOWER half of the magnitude bound is gone (a guard written as "> 10" passes 6d, 6e and 6j and catches nothing on this side), and one such row drives every compounded curve derived from the series to -Infinity', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6l): the -Infinity call failed with SQLSTATE % (%) - expected 22023 from the value scan, BEFORE any write', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = probe_user;
  IF n_strat <> 0 OR n_sv <> 0 OR n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6l): counts are strategies=%, verifications=%, dailies=% after the refused call - expected 0/0/0; the guard ran AFTER a write instead of before every write', n_strat, n_sv, n_dl;
  END IF;
  RAISE NOTICE 'Part 6l OK: -Infinity raised 22023 (%) and committed nothing.', err_msg;

  -- ---- Part 6m — date ABSENT (must be 22023, NOT 23502) -------------------
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'fold guard probe 6m',
      '[{"daily_return":0.01}]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6m): an element with no date SUCCEEDED and returned % - the missing-date arm of the value scan is gone', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6m): the missing-date call failed with SQLSTATE % (%) - expected 22023 EXACTLY. 23502 here means csv_daily_returns'' NOT NULL constraint stopped it AFTER the guards let it through, which is the same illegible-error class 6f fences for the sibling column', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  SELECT count(*) INTO n_dl FROM public.csv_daily_returns d
    JOIN public.strategies s ON s.id = d.strategy_id
   WHERE s.user_id = probe_user;
  IF n_strat <> 0 OR n_sv <> 0 OR n_dl <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6m): counts are strategies=%, verifications=%, dailies=% after the refused call - expected 0/0/0; the guard ran AFTER a write instead of before every write', n_strat, n_sv, n_dl;
  END IF;
  RAISE NOTICE 'Part 6m OK: missing date raised 22023 (%) and committed nothing.', err_msg;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'Part 6 (negatives) OK: 6a-6h and 6j-6m each raised 22023 before any write (0/0/0 across all three tables).';
END $$;

ROLLBACK;

-- ==========================================================================
-- Part 6i — THE ANTI-VACUITY COUNTERPART: a CONFORMING 2-row daily_returns
--           payload SUCCEEDS and persists exactly what was submitted.
--
--           Deliberately NOT wrapped in a handler (Part 4's rule): a
--           regression must surface as the raw SQLSTATE under ON_ERROR_STOP=1.
--           Without this sub-Part a body whose guards refuse EVERYTHING would
--           pass all of Part 6 perfectly — twelve negatives are twelve pieces
--           of evidence for a deny-all function.
--
--           The two values are 9.9 and -9.9: just INSIDE both ends of the
--           +/-10 bound. Paired with 6j (10.5 refused) and 6l (-Infinity
--           refused) they pin the bound at exactly +/-10 from both sides.
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  probe_user    UUID := gen_random_uuid();
  probe_session UUID := gen_random_uuid();
  payload       JSONB := '[{"date":"2026-02-01","daily_return":9.9},
                           {"date":"2026-02-02","daily_return":-9.9}]'::jsonb;
  v_result      UUID;
  n_dl          INT;
  v_spot_hi     DOUBLE PRECISION;
  v_spot_lo     DOUBLE PRECISION;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (probe_user, '00000000-0000-0000-0000-000000000000',
          'test-fold-conform-' || probe_user || '@quantalyze.test', now(), now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', probe_user::text, 'role', 'authenticated')::text, true);

  v_result := public.finalize_csv_strategy_with_returns(
    probe_user, probe_session, 'daily_returns', 'fold conforming probe 6i', payload);

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6i): a conforming 2-row daily_returns finalize returned NULL';
  END IF;

  SELECT count(*) INTO n_dl FROM public.csv_daily_returns WHERE strategy_id = v_result;
  IF n_dl <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6i): % dailies persisted for a conforming 2-row submission - expected 2. A guard is refusing or dropping legitimate rows, which means Part 6''s twelve negatives are evidence for a function that refuses everything rather than for guards that discriminate', n_dl;
  END IF;

  -- Economic oracle: read the values back from the table, never re-derived
  -- through the fold's own expressions.
  SELECT daily_return INTO v_spot_hi FROM public.csv_daily_returns
   WHERE strategy_id = v_result AND date = DATE '2026-02-01';
  SELECT daily_return INTO v_spot_lo FROM public.csv_daily_returns
   WHERE strategy_id = v_result AND date = DATE '2026-02-02';
  IF v_spot_hi IS DISTINCT FROM 9.9 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6i): daily_return for 2026-02-01 is % - expected 9.9 exactly as submitted; a transformed value here means the fold is EDITING the user''s track record, which is money-data fabrication', v_spot_hi;
  END IF;
  IF v_spot_lo IS DISTINCT FROM -9.9 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6i): daily_return for 2026-02-02 is % - expected -9.9 exactly as submitted; the NEGATIVE in-bound value is what proves the magnitude guard admits the whole legitimate range and not just its upper half', v_spot_lo;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'Part 6i OK: a conforming payload with 9.9 / -9.9 finalized (strategy %) and persisted both values verbatim.', v_result;
END $$;

ROLLBACK;

-- ==========================================================================
-- Part 7 — THE RE-HOMED fmt / NAME GUARDS (v1.19 review B5). These three
--          behaviours were asserted in src/__tests__/csv-finalize-rpc.test.ts
--          against a function that no longer exists, in cases that CI never
--          ran. See "WHY PARTS 6 AND 7 LIVE HERE" in the header.
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  probe_user    UUID := gen_random_uuid();
  probe_session UUID;
  payload       JSONB := '[{"date":"2026-02-01","daily_return":0.01}]'::jsonb;
  v_result      UUID;
  raised        BOOLEAN;
  err_state     TEXT;
  err_msg       TEXT;
  n_strat       INT;
  n_sv          INT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (probe_user, '00000000-0000-0000-0000-000000000000',
          'test-fold-namefmt-' || probe_user || '@quantalyze.test', now(), now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', probe_user::text, 'role', 'authenticated')::text, true);

  -- ---- Part 7a — p_fmt := 'nonsense' --------------------------------------
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'nonsense', 'fold guard probe 7a', payload);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 7a): fmt=''nonsense'' SUCCEEDED and returned % - the fmt whitelist is gone, and the series would be interpreted downstream by whichever reader guesses first (returns vs NAV vs trades are three different economic meanings for the same numbers)', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 7a): the bogus-fmt call failed with SQLSTATE % (%) - expected 22023 from the fmt whitelist, BEFORE any write', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  IF n_strat <> 0 OR n_sv <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 7a): counts are strategies=%, verifications=% after the refused call - expected 0/0; the guard ran AFTER a write', n_strat, n_sv;
  END IF;
  RAISE NOTICE 'Part 7a OK: invalid fmt raised 22023 (%) and committed nothing.', err_msg;

  -- ---- Part 7b — p_strategy_name := '' ------------------------------------
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', '', payload);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 7b): an EMPTY strategy name SUCCEEDED and returned % - the name guard is gone, and an unnamed strategy renders as a blank row the owner cannot identify in any list, picker or factsheet', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 7b): the empty-name call failed with SQLSTATE % (%) - expected 22023 from the name guard, BEFORE any write', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  IF n_strat <> 0 OR n_sv <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 7b): counts are strategies=%, verifications=% after the refused call - expected 0/0; the guard ran AFTER a write', n_strat, n_sv;
  END IF;
  RAISE NOTICE 'Part 7b OK: empty name raised 22023 (%) and committed nothing.', err_msg;

  -- ---- Part 7c — p_strategy_name of 81 characters -------------------------
  probe_session := gen_random_uuid();
  raised := FALSE; err_state := NULL; err_msg := NULL; v_result := NULL;
  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', repeat('x', 81), payload);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS err_state = RETURNED_SQLSTATE, err_msg = MESSAGE_TEXT;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 7c): an 81-character strategy name SUCCEEDED and returned % - the 80-character cap is gone (or is off by one), so the DB accepts names the wizard refuses and the two limits disagree silently', v_result;
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 7c): the oversize-name call failed with SQLSTATE % (%) - expected 22023 from the name-length guard, BEFORE any write', err_state, err_msg;
  END IF;
  SELECT count(*) INTO n_strat FROM public.strategies
   WHERE user_id = probe_user AND wizard_session_id = probe_session;
  SELECT count(*) INTO n_sv FROM public.strategy_verifications
   WHERE wizard_session_id = probe_session;
  IF n_strat <> 0 OR n_sv <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 7c): counts are strategies=%, verifications=% after the refused call - expected 0/0; the guard ran AFTER a write', n_strat, n_sv;
  END IF;
  RAISE NOTICE 'Part 7c OK: 81-character name raised 22023 (%) and committed nothing.', err_msg;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'Part 7 OK: the fmt / name guards re-homed from csv-finalize-rpc.test.ts now execute in CI.';
  RAISE NOTICE 'test_csv_finalize_atomic_fold: ALL PASS (structural; atomicity oracle zero/zero/zero; private + default status; published refused; trades-empty; 5000 cap; input guards 6a-6h + 6j-6m refused before any write with the conforming 6i counterpart accepted; re-homed fmt/name guards 7a-7c).';
END $$;

ROLLBACK;
