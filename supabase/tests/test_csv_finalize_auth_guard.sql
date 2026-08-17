-- Test: finalize_csv_strategy auth guards — SQLSTATE 42501, both halves
-- Phase 145 / JOB-06 / SC#1 arm 1 (the positive control of the reproduction).
--
-- WHAT THIS FILE IS FOR
-- ---------------------
-- The stale TODOS.md claim ("42501 when PROCESS_KEY_UNIFIED_BACKBONE routes
-- csv-finalize through a service-role client") is CANNOT REPRODUCE at HEAD:
-- the GUARD is live, the PATH is closed (every caller is user-scoped; the flag
-- has zero code readers). This file is the arm that keeps the FIRST half of
-- that split a CI fact rather than a dated grep: it calls the REAL deployed
-- finalize_csv_strategy and asserts both 42501 raises fire. If a future
-- refactor ever routes a finalize call through a service-role client again,
-- auth.uid() will be NULL there — and the ONLY thing standing between that
-- caller and silently writing strategies rows under an arbitrary user is the
-- guard this file pins. A weakened or deleted guard reddens HERE, in CI,
-- instead of 42501-ing (or worse, succeeding) in production.
--
-- WHY THE EXISTING GREEN GATES CANNOT CATCH THIS
-- ----------------------------------------------
-- supabase/tests/test_csv_finalize_double_submit.sql only ever calls the
-- function WITH valid matching claims — it exercises the happy path and the
-- 23505 fence, so it stays GREEN if both 42501 guards are deleted outright.
-- The pytest gates (test_process_key.py csv_finalize family) are mock-level:
-- they prove the Python router WIRES the user-scoped client, not that the
-- deployed SQL body enforces anything. No existing gate executes the guards.
--
-- RE-POINTING NOTE (Plan 03)
-- --------------------------
-- Phase 145's SC#2 fold may supersede finalize_csv_strategy with a folded
-- function (and DROP the 5-arg form). If that lands, this file must be
-- RE-POINTED at the folded function IN THE SAME COMMIT as the DROP — extended,
-- never deleted: the folded function must raise the same two 42501s and Part A
-- pins the exact no-session message string, so the re-point is a deliberate
-- edit, not a silent skip. (The Phase-144-§8 trap: a gate that names a dropped
-- function reds the sql-tests job on a CORRECT migration.)
--
-- WHAT IS ASSERTED
--   Part A — NO SESSION: with request.jwt.claims cleared, the call must raise
--            SQLSTATE 42501 with the EXACT message
--            'finalize_csv_strategy called without an auth session'
--            (20260728120000:225-228).
--   Part B — WRONG IDENTITY: with claims sub = user X, a call passing
--            p_user_id = user Y must raise SQLSTATE 42501 with the mismatch
--            message shape ('... does not match auth.uid ...',
--            20260728120000:230-234).
--
-- Both parts are UNGATED — no presence-check green-skip arm. If the function
-- is missing, Part A fails loudly (42883), which is the correct signal.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO blocks with RAISE
-- EXCEPTION on failure / RAISE NOTICE on pass. NO psql backslash
-- meta-commands anywhere in this file. Each part runs inside its own
-- BEGIN ... ROLLBACK so the shared TEST DB is never polluted; all ids are
-- gen_random_uuid() so concurrent CI runs cannot collide. auth.uid() is
-- driven by set_config on request.jwt.claims (the Supabase JWT GUC the
-- SECURITY DEFINER function reads), the repo's standing claims idiom
-- (test_csv_finalize_double_submit.sql:119/:230/:285).
--
-- Neuter-RED record (observed 2026-08-17, throwaway Postgres 16 cluster via
-- .planning/phases/145-job-csv-finalize-atomicity/145-repro-harness.sql, with
-- the anti-vacuity loader assertion passing first):
--   * Part A neutered (valid claims matching p_user_id set before the call,
--     guard satisfied) -> RED: "TEST FAILED (Part A): finalize_csv_strategy
--     with NO auth session RETURNED <uuid> instead of raising".
--   * Part B neutered (call made with MATCHING identity, mismatch raise
--     absent) -> RED: "TEST FAILED (Part B): finalize_csv_strategy with a
--     MISMATCHED identity RETURNED <uuid> instead of raising".
-- Real parts restored, re-run GREEN. Full verbatim outputs:
-- .planning/phases/145-job-csv-finalize-atomicity/145-REPRODUCTION.md arm 1.
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
    v_result := public.finalize_csv_strategy(
      probe_user, probe_session, 'daily_returns', 'guard probe', 'pending_review');
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS
      err_state = RETURNED_SQLSTATE,
      err_msg   = MESSAGE_TEXT;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part A): finalize_csv_strategy with NO auth session RETURNED % instead of raising - the no-session guard (20260728120000:225-228) is dead, and a service-role caller would silently write strategies rows under an arbitrary user', v_result;
  END IF;

  IF err_state <> '42501' THEN
    RAISE EXCEPTION 'TEST FAILED (Part A): expected SQLSTATE 42501 from the no-session call, got % (message: %) - the guard was weakened or replaced by a different failure', err_state, err_msg;
  END IF;

  IF err_msg <> 'finalize_csv_strategy called without an auth session' THEN
    RAISE EXCEPTION 'TEST FAILED (Part A): 42501 raised but with message "%" - expected the EXACT guard message at 20260728120000:226. If the function was renamed or folded, re-point this gate in the same commit as that change; do not loosen this assertion', err_msg;
  END IF;

  RAISE NOTICE 'Part A OK: no-session finalize_csv_strategy call raised 42501 with the exact guard message.';
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
    v_result := public.finalize_csv_strategy(
      other_user, probe_session, 'daily_returns', 'guard probe identity', 'pending_review');
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS
      err_state = RETURNED_SQLSTATE,
      err_msg   = MESSAGE_TEXT;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part B): finalize_csv_strategy with a MISMATCHED identity RETURNED % instead of raising - the identity guard (20260728120000:230-234) is dead, and an authenticated caller could write strategies rows under another user', v_result;
  END IF;

  IF err_state <> '42501' THEN
    RAISE EXCEPTION 'TEST FAILED (Part B): expected SQLSTATE 42501 from the mismatched-identity call, got % (message: %) - the identity guard was weakened or replaced by a different failure', err_state, err_msg;
  END IF;

  IF err_msg NOT LIKE '%does not match auth.uid%' THEN
    RAISE EXCEPTION 'TEST FAILED (Part B): 42501 raised but with message "%" - expected the mismatch message shape at 20260728120000:230-234 (substring "does not match auth.uid"). If the message was rewritten, re-point this assertion deliberately', err_msg;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'Part B OK: mismatched-identity finalize_csv_strategy call raised 42501 with the mismatch message.';
  RAISE NOTICE 'test_csv_finalize_auth_guard: ALL PASS (no-session 42501 with exact message; identity-mismatch 42501).';
END $$;

ROLLBACK;
