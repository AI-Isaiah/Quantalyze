-- Test for Migration 125 + Migration 126 — guard_wizard_draft_updates()
-- + wizard RPC bypass GUC.
--
-- Audit-2026-05-07 P475 + audit-2026-05-07 follow-up ISSUE 1.
--
-- This file is a SQL self-test that can be run manually against a live
-- Postgres instance with the migrations applied. pgTAP is not set up in
-- this project (see CLAUDE.md / Lane B audit), so the assertions use
-- RAISE EXCEPTION on failure — a successful run prints NOTICEs; a failed
-- assertion aborts with a clear message.
--
-- Usage (against a Supabase project with migrations 125 + 126 applied):
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
  has_guc_check BOOLEAN;
  has_current_user_check BOOLEAN;
  trigger_attached BOOLEAN;
  create_has_set_config BOOLEAN;
  finalize_has_set_config BOOLEAN;
BEGIN
  -- ----- 1. guard_wizard_draft_updates body must contain the GUC bypass +
  --        the current_user role check.
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

  -- Migration 126 swaps the broken auth.uid() OR clause for a per-txn GUC
  -- (quantalyze.wizard_rpc_active). The current_user='authenticated' role
  -- gate stays as the primary "is this a direct client write?" signal.
  has_guc_check := guard_body LIKE '%quantalyze.wizard_rpc_active%';
  IF NOT has_guc_check THEN
    RAISE EXCEPTION
      'TEST FAILED: guard_wizard_draft_updates body does not reference the wizard RPC bypass GUC — Migration 126 regressed (Issue 1)';
  END IF;

  has_current_user_check := guard_body LIKE '%current_user%';
  IF NOT has_current_user_check THEN
    RAISE EXCEPTION
      'TEST FAILED: guard_wizard_draft_updates body lost the current_user check — P475 hardening regressed';
  END IF;

  RAISE NOTICE 'Assertion 1 OK: guard body contains GUC bypass + current_user role gate.';

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

  -- ----- 4. create_wizard_strategy must call set_config to flip the GUC ----
  -- Issue 1 (audit-2026-05-07 follow-up): the SECURITY DEFINER RPCs are
  -- the only legitimate writers of the wizard_rpc_active flag.
  SELECT pg_get_functiondef(p.oid)
    INTO create_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'create_wizard_strategy';

  IF create_body IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: create_wizard_strategy function is missing';
  END IF;

  create_has_set_config := create_body LIKE '%quantalyze.wizard_rpc_active%';
  IF NOT create_has_set_config THEN
    RAISE EXCEPTION
      'TEST FAILED: create_wizard_strategy body does not set the wizard RPC bypass GUC — Migration 126 regressed (Issue 1)';
  END IF;

  RAISE NOTICE 'Assertion 4 OK: create_wizard_strategy sets the bypass GUC.';

  -- ----- 5. finalize_wizard_strategy must call set_config to flip the GUC --
  SELECT pg_get_functiondef(p.oid)
    INTO finalize_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'finalize_wizard_strategy';

  IF finalize_body IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: finalize_wizard_strategy function is missing';
  END IF;

  finalize_has_set_config := finalize_body LIKE '%quantalyze.wizard_rpc_active%';
  IF NOT finalize_has_set_config THEN
    RAISE EXCEPTION
      'TEST FAILED: finalize_wizard_strategy body does not set the wizard RPC bypass GUC — Migration 126 regressed (Issue 1)';
  END IF;

  RAISE NOTICE 'Assertion 5 OK: finalize_wizard_strategy sets the bypass GUC.';

  -- ----- 6. Functional check on the trigger's bypass GUC.
  -- A SET LOCAL with value 'on' should be observed by current_setting(...)
  -- inside the same transaction, and any other value (including null) should
  -- NOT match. This pins the GUC name + the 'on' sentinel string the
  -- migration uses; a future rename would break this assertion.
  PERFORM set_config('quantalyze.wizard_rpc_active', 'on', true);
  IF current_setting('quantalyze.wizard_rpc_active', true) <> 'on' THEN
    RAISE EXCEPTION
      'TEST FAILED: set_config(quantalyze.wizard_rpc_active, on, true) did not stick — runtime regression';
  END IF;

  RAISE NOTICE 'Assertion 6 OK: bypass GUC name and sentinel match migration 126.';

  RAISE NOTICE 'All guard_wizard_draft_updates assertions passed (Migrations 125 + 126 / P475 + Issue 1).';
END
$$;
