-- Test for Migrations 125 + 126 + 127 — guard_wizard_draft_updates().
--
-- Audit-2026-05-07 P475 + follow-up ISSUE 1 + red-team Finding 1.
--
-- Migration 127 supersedes the GUC-based bypass introduced by 126: the
-- trigger now gates on current_user='authenticated' alone, and the
-- SECURITY DEFINER RPCs no longer call PERFORM set_config(...). The GUC
-- bypass was set_config-forgeable from an authenticated session and is
-- removed in 127.
--
-- This file is a SQL self-test that can be run manually against a live
-- Postgres instance with the migrations applied. pgTAP is not set up in
-- this project (see CLAUDE.md / Lane B audit), so the assertions use
-- RAISE EXCEPTION on failure — a successful run prints NOTICEs; a failed
-- assertion aborts with a clear message.
--
-- Usage (against a Supabase project with migrations 125 + 126 + 127 applied):
--
--   psql "$DATABASE_URL" -f supabase/tests/test_guard_wizard_draft_updates_auth_uid.sql
--
-- The JS/TS counterpart (gated on a live test project) lives at
-- src/__tests__/wizard-rpcs-live-db.test.ts and covers the end-to-end
-- "direct UPDATE is blocked" + "SECURITY DEFINER path passes" assertions.
-- This SQL test pins the function-body invariants for environments where
-- the JS suite is not run.

DO $$
DECLARE
  guard_body TEXT;
  create_body TEXT;
  finalize_body TEXT;
  has_current_user_check BOOLEAN;
  trigger_attached BOOLEAN;
BEGIN
  -- ----- 1. guard_wizard_draft_updates body must gate on current_user
  --        (Migration 127 replaces the GUC bypass; red-team Finding 1).
  SELECT pg_get_functiondef(p.oid)
    INTO guard_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'guard_wizard_draft_updates';

  IF guard_body IS NULL THEN
    RAISE EXCEPTION
      'TEST FAILED: guard_wizard_draft_updates function is missing from public schema';
  END IF;

  -- Migration 127 removed the quantalyze.wizard_rpc_active GUC bypass:
  -- it was forgeable from an authenticated session via set_config(...).
  -- The trigger now keys solely on current_user='authenticated'.
  IF guard_body LIKE '%quantalyze.wizard_rpc_active%' THEN
    RAISE EXCEPTION
      'TEST FAILED: guard_wizard_draft_updates still references the GUC bypass — Migration 127 regressed (red-team Finding 1)';
  END IF;

  has_current_user_check := guard_body LIKE '%current_user%';
  IF NOT has_current_user_check THEN
    RAISE EXCEPTION
      'TEST FAILED: guard_wizard_draft_updates body lost the current_user gate — Migration 127 regressed';
  END IF;

  RAISE NOTICE 'Assertion 1 OK: guard body keys solely on current_user (GUC bypass removed).';

  -- ----- 2. Trigger must still be attached to strategies -------------------
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'strategies'
      AND t.tgname = 'guard_wizard_draft_updates_trigger'
      AND NOT t.tgisinternal
  ) INTO trigger_attached;

  IF NOT trigger_attached THEN
    RAISE EXCEPTION
      'TEST FAILED: guard_wizard_draft_updates_trigger is not attached to public.strategies';
  END IF;

  RAISE NOTICE 'Assertion 2 OK: trigger is attached to public.strategies.';

  -- ----- 3. Function must NOT be granted to PUBLIC/anon/authenticated -----
  IF EXISTS (
    SELECT 1
      FROM information_schema.routine_privileges
     WHERE routine_schema = 'public'
       AND routine_name = 'guard_wizard_draft_updates'
       AND grantee IN ('PUBLIC', 'anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION
      'TEST FAILED: guard_wizard_draft_updates has EXECUTE granted to a public/anon/authenticated role — should be REVOKE-only';
  END IF;

  RAISE NOTICE 'Assertion 3 OK: function EXECUTE is revoked from PUBLIC/anon/authenticated.';

  -- ----- 4. create_wizard_strategy must NOT call set_config on the GUC -----
  -- Migration 127 removed the now-useless bypass marker.
  SELECT pg_get_functiondef(p.oid)
    INTO create_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'create_wizard_strategy';

  IF create_body IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: create_wizard_strategy function is missing';
  END IF;

  IF create_body LIKE '%quantalyze.wizard_rpc_active%' THEN
    RAISE EXCEPTION
      'TEST FAILED: create_wizard_strategy still calls set_config on the bypass GUC — Migration 127 regressed (Finding 1)';
  END IF;

  RAISE NOTICE 'Assertion 4 OK: create_wizard_strategy no longer touches the bypass GUC.';

  -- ----- 5. finalize_wizard_strategy must NOT call set_config on the GUC --
  SELECT pg_get_functiondef(p.oid)
    INTO finalize_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'finalize_wizard_strategy';

  IF finalize_body IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: finalize_wizard_strategy function is missing';
  END IF;

  IF finalize_body LIKE '%quantalyze.wizard_rpc_active%' THEN
    RAISE EXCEPTION
      'TEST FAILED: finalize_wizard_strategy still calls set_config on the bypass GUC — Migration 127 regressed (Finding 1)';
  END IF;

  RAISE NOTICE 'Assertion 5 OK: finalize_wizard_strategy no longer touches the bypass GUC.';

  RAISE NOTICE 'All guard_wizard_draft_updates assertions passed (Migrations 125 + 126 + 127 / P475 + Issue 1 + Finding 1).';
END
$$;

-- --------------------------------------------------------------------------
-- Finding 1 bypass-attempt regression test (Migration 127).
--
-- Asserts that an authenticated session cannot smuggle the GUC bypass to
-- evade the trigger. Pre-Migration-127, the following sequence succeeded
-- and let the attacker promote a draft straight to pending_review:
--
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('quantalyze.wizard_rpc_active', 'on', true);
--   UPDATE strategies SET status='pending_review' WHERE id=<draft>;
--
-- Post-127, the trigger ignores the GUC entirely; the current_user
-- check fires and raises ERRCODE 42501.
--
-- RLS scaffolding (PR #150 follow-up — first CI run of sql-tests):
-- `SET LOCAL ROLE authenticated` alone leaves auth.uid() returning NULL,
-- so the strategies RLS USING clause (`user_id = auth.uid()`) excludes
-- every row from the role's visibility. The UPDATE then matches zero
-- rows and the BEFORE UPDATE trigger never fires, producing a
-- false-positive "bypass succeeded". The fix is to forge the
-- `request.jwt.claims` GUC so auth.uid() returns the seeded user's id,
-- giving the role legitimate UPDATE access — then the security boundary
-- the test is actually trying to assert (the trigger's current_user gate)
-- is the only thing standing between the role and the row.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid    UUID := gen_random_uuid();
  test_sid    UUID;
  test_kid    UUID;
  raised      BOOLEAN := FALSE;
  err_state   TEXT;
  cur_status  TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-finding1-' || test_uid::text || '@quantalyze.test',
          now(), now());

  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'finding1 test', 'test-finding1@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO api_keys (
    user_id, exchange, label, api_key_encrypted, is_active
  ) VALUES (
    test_uid, 'binance', 'finding1-test', 'encrypted-blob', TRUE
  ) RETURNING id INTO test_kid;

  INSERT INTO strategies (
    user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges
  ) VALUES (
    test_uid, test_kid, 'finding1 draft', 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY['binance']
  ) RETURNING id INTO test_sid;

  -- Forge the JWT sub claim so auth.uid() resolves to test_uid for the
  -- duration of this transaction. RLS on strategies then admits the row
  -- to the authenticated role's view; the only thing that can still
  -- reject the UPDATE is the guard trigger's current_user check (which
  -- is exactly what this test is asserting).
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;

  -- Attempt the bypass: smuggle the GUC then issue the promotion UPDATE.
  PERFORM set_config('quantalyze.wizard_rpc_active', 'on', true);
  BEGIN
    UPDATE strategies SET status = 'pending_review' WHERE id = test_sid;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;

  RESET ROLE;

  IF NOT raised THEN
    RAISE EXCEPTION
      'TEST FAILED (Finding 1): set_config + UPDATE bypass succeeded — Migration 127 regressed';
  END IF;

  IF err_state <> '42501' THEN
    RAISE EXCEPTION
      'TEST FAILED (Finding 1): expected ERRCODE 42501 (insufficient_privilege), got %', err_state;
  END IF;

  SELECT status INTO cur_status FROM strategies WHERE id = test_sid;
  IF cur_status <> 'draft' THEN
    RAISE EXCEPTION
      'TEST FAILED (Finding 1): bypass partially succeeded — strategy.status=% (expected draft)', cur_status;
  END IF;

  RAISE NOTICE 'Finding 1 regression test passed: set_config bypass blocked by current_user gate.';

  DELETE FROM strategies WHERE id = test_sid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END
$$;
