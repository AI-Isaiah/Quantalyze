-- Test: finalize_csv_strategy_with_returns auth guards — SQLSTATE 42501, both
-- halves — plus the structural receipt that both parent RPCs are GONE.
-- Phase 145 / JOB-06 / SC#1 arm 1 (the positive control of the reproduction),
-- RE-POINTED at the fold by Plan 03 in the SAME COMMIT as migration
-- 20260819120000_csv_finalize_atomic_fold.sql DROPs the parents (the
-- Phase-144-§8 rule: a gate that names a dropped function reds the sql-tests
-- job on a CORRECT migration).
--
-- WHAT THIS FILE IS FOR
-- ---------------------
-- The stale TODOS.md claim ("42501 when PROCESS_KEY_UNIFIED_BACKBONE routes
-- csv-finalize through a service-role client") is CANNOT REPRODUCE at HEAD:
-- the GUARD is live, the PATH is closed (145-REPRODUCTION.md, all four arms).
-- This file keeps the FIRST half of that split a CI fact rather than a dated
-- grep: it calls the REAL deployed csv-finalize writer — now
-- finalize_csv_strategy_with_returns, the folded three-write SECURITY DEFINER
-- body — and asserts both 42501 raises fire. If a future refactor ever routes
-- a finalize call through a service-role client again, auth.uid() will be
-- NULL there — and the ONLY thing standing between that caller and silently
-- writing strategies rows (now WITH their dailies) under an arbitrary user is
-- the guard this file pins. A weakened or deleted guard reddens HERE, in CI,
-- instead of 42501-ing (or worse, succeeding) in production. That D-02
-- purpose transfers to the fold unchanged.
--
-- WHY THE EXISTING GREEN GATES CANNOT CATCH THIS
-- ----------------------------------------------
-- supabase/tests/test_csv_finalize_double_submit.sql only ever calls the
-- function WITH valid matching claims — it exercises the happy path and the
-- 23505 fence, so it stays GREEN if both 42501 guards are deleted outright.
-- The pytest gates (test_process_key.py csv_finalize family) are mock-level:
-- they prove Python wiring, not that the deployed SQL body enforces anything.
-- No other gate executes the guards.
--
-- WHAT IS ASSERTED
--   Part A — NO SESSION: with request.jwt.claims cleared, the call must raise
--            SQLSTATE 42501 with the EXACT message
--            'finalize_csv_strategy_with_returns called without an auth session'
--            (20260819120000 STEP 1; the fold's message is pinned literally —
--            if the function is renamed, re-point this gate in the same
--            commit, never loosen it).
--   Part B — WRONG IDENTITY: with claims sub = user X, a call passing
--            p_user_id = user Y must raise SQLSTATE 42501 with the mismatch
--            message shape ('... does not match auth.uid ...').
--   Part C — THE DROP'S RECEIPT: neither finalize_csv_strategy nor
--            persist_csv_daily_returns exists in pg_proc at ANY arity. This is
--            the gate that reds if someone "helpfully" restores a parent — a
--            surviving parent is a second writer that re-opens the
--            two-transaction orphan windows the fold dissolved (SC#2).
--
-- All parts are UNGATED — no presence-check green-skip arm. If the fold is
-- missing, Part A fails loudly (42883), which is the correct signal: on the
-- shared TEST project this file is designed-RED until Plan 06 applies
-- 20260819120000 there.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO blocks with RAISE
-- EXCEPTION on failure / RAISE NOTICE on pass. NO psql backslash
-- meta-commands anywhere in this file. Each part runs inside its own
-- BEGIN ... ROLLBACK so the shared TEST DB is never polluted; all ids are
-- gen_random_uuid() so concurrent CI runs cannot collide. auth.uid() is
-- driven by set_config on request.jwt.claims (the Supabase JWT GUC the
-- SECURITY DEFINER function reads), the repo's standing claims idiom
-- (test_csv_finalize_double_submit.sql).
--
-- Neuter-RED record:
--   * Plan 01 (pre-fold, against finalize_csv_strategy): both parts observed
--     RED with guard-satisfied variants — verbatim outputs in
--     .planning/phases/145-job-csv-finalize-atomicity/145-REPRODUCTION.md
--     arm 1.
--   * Plan 03 (re-pointed at the fold, throwaway Postgres 16 cluster via
--     145-fold-harness.sql): a fold VARIANT with both 42501 guards deleted
--     was deployed on the throwaway cluster only -> Part A RED ("RETURNED
--     <uuid> instead of raising"), Part B RED (same shape); real body
--     restored -> both parts GREEN. Part C observed RED against a cluster
--     with the parents still present (pre-migration state). Verbatim outputs
--     in 145-03-SUMMARY.md's neuter-RED table.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_csv_finalize_auth_guard.sql

-- ==========================================================================
-- Part A — no auth session: the 42501 no-session guard fires, exact message
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  probe_user    UUID := gen_random_uuid();
  probe_session UUID := gen_random_uuid();
  v_result      UUID;
  raised        BOOLEAN := FALSE;
  err_state     TEXT;
  err_msg       TEXT;
BEGIN
  -- Clear any session context: auth.uid() must resolve NULL for this call.
  PERFORM set_config('request.jwt.claims', NULL, true);

  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      probe_user, probe_session, 'daily_returns', 'guard probe',
      '[{"date":"2026-01-01","daily_return":0.001}]'::jsonb, 'pending_review');
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS
      err_state = RETURNED_SQLSTATE,
      err_msg   = MESSAGE_TEXT;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part A): finalize_csv_strategy_with_returns with NO auth session RETURNED % instead of raising - the no-session guard is dead, and a service-role caller would silently write strategies rows AND their dailies under an arbitrary user', v_result;
  END IF;

  IF err_state <> '42501' THEN
    RAISE EXCEPTION 'TEST FAILED (Part A): expected SQLSTATE 42501 from the no-session call, got % (message: %) - the guard was weakened or replaced by a different failure', err_state, err_msg;
  END IF;

  IF err_msg <> 'finalize_csv_strategy_with_returns called without an auth session' THEN
    RAISE EXCEPTION 'TEST FAILED (Part A): 42501 raised but with message "%" - expected the EXACT guard message from 20260819120000 STEP 1. If the function was renamed or re-folded, re-point this gate in the same commit as that change; do not loosen this assertion', err_msg;
  END IF;

  RAISE NOTICE 'Part A OK: no-session finalize_csv_strategy_with_returns call raised 42501 with the exact guard message.';
END $$;

ROLLBACK;

-- ==========================================================================
-- Part B — identity mismatch: claims sub <> p_user_id raises 42501
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  jwt_user      UUID := gen_random_uuid();  -- who the JWT says is calling
  other_user    UUID := gen_random_uuid();  -- who the call CLAIMS to act for
  probe_session UUID := gen_random_uuid();
  v_result      UUID;
  raised        BOOLEAN := FALSE;
  err_state     TEXT;
  err_msg       TEXT;
BEGIN
  -- Seed the JWT identity so the fixture mirrors a real session (the guard
  -- itself never reads auth.users; the row rolls back with this transaction).
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (jwt_user, '00000000-0000-0000-0000-000000000000',
          'test-csv-guard-' || jwt_user || '@quantalyze.test', now(), now());

  -- JWT says jwt_user; the call passes other_user.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', jwt_user::text, 'role', 'authenticated')::text, true);

  BEGIN
    v_result := public.finalize_csv_strategy_with_returns(
      other_user, probe_session, 'daily_returns', 'guard probe identity',
      '[{"date":"2026-01-01","daily_return":0.001}]'::jsonb, 'pending_review');
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS
      err_state = RETURNED_SQLSTATE,
      err_msg   = MESSAGE_TEXT;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part B): finalize_csv_strategy_with_returns with a MISMATCHED identity RETURNED % instead of raising - the identity guard is dead, and an authenticated caller could write strategies rows AND their dailies under another user', v_result;
  END IF;

  IF err_state <> '42501' THEN
    RAISE EXCEPTION 'TEST FAILED (Part B): expected SQLSTATE 42501 from the mismatched-identity call, got % (message: %) - the identity guard was weakened or replaced by a different failure', err_state, err_msg;
  END IF;

  IF err_msg NOT LIKE '%does not match auth.uid%' THEN
    RAISE EXCEPTION 'TEST FAILED (Part B): 42501 raised but with message "%" - expected the mismatch message shape (substring "does not match auth.uid"). If the message was rewritten, re-point this assertion deliberately', err_msg;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'Part B OK: mismatched-identity finalize_csv_strategy_with_returns call raised 42501 with the mismatch message.';
END $$;

ROLLBACK;

-- ==========================================================================
-- Part C — the DROP's receipt: both parent RPCs are gone at ANY arity
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_cnt   INT;
  v_names TEXT;
BEGIN
  SELECT count(*), string_agg(p.proname || '(' || p.pronargs || ' args)', ', ')
    INTO v_cnt, v_names
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('finalize_csv_strategy', 'persist_csv_daily_returns');

  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part C): % pre-fold csv-finalize function(s) still present in pg_proc: % - migration 20260819120000 DROPped both parents; a restored parent is a SECOND WRITER that re-opens the two-transaction orphan windows the fold dissolved (SC#2). If a migration recreated one "helpfully", delete it and re-point its caller at finalize_csv_strategy_with_returns', v_cnt, v_names;
  END IF;

  RAISE NOTICE 'Part C OK: finalize_csv_strategy and persist_csv_daily_returns are gone from pg_proc - the fold is the only csv-finalize writer.';
  RAISE NOTICE 'test_csv_finalize_auth_guard: ALL PASS (no-session 42501 with exact message; identity-mismatch 42501; both parents dropped).';
END $$;

ROLLBACK;
