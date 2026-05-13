-- Test for Migration 125 — guard_wizard_draft_updates() auth.uid() hardening.
--
-- This file is a SQL self-test that can be run manually against a live
-- Postgres instance with the migrations applied. pgTAP is not set up in
-- this project (see CLAUDE.md / Lane B audit), so the assertions use
-- RAISE EXCEPTION on failure — a successful run prints NOTICEs; a failed
-- assertion aborts with a clear message.
--
-- Usage (against a Supabase project with migration 125 applied):
--
--   psql "$DATABASE_URL" -f supabase/tests/test_guard_wizard_draft_updates_auth_uid.sql
--
-- The JS/TS counterpart (gated on a live test project) lives at
-- src/__tests__/wizard-rpcs-live-db.test.ts and covers the end-to-end
-- "direct UPDATE is blocked" assertion. This SQL test pins the
-- function-body invariants for environments where the JS suite is
-- not run.

DO $$
DECLARE
  fn_body TEXT;
  has_auth_uid_check BOOLEAN;
  has_current_user_fallback BOOLEAN;
  trigger_attached BOOLEAN;
BEGIN
  -- ----- 1. Function body must contain both checks -------------------------
  SELECT pg_get_functiondef(p.oid)
    INTO fn_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'guard_wizard_draft_updates';

  IF fn_body IS NULL THEN
    RAISE EXCEPTION
      'TEST FAILED: guard_wizard_draft_updates function is missing from public schema';
  END IF;

  has_auth_uid_check := fn_body LIKE '%auth.uid()%';
  IF NOT has_auth_uid_check THEN
    RAISE EXCEPTION
      'TEST FAILED: guard_wizard_draft_updates body does not reference auth.uid() — P475 hardening regressed';
  END IF;

  has_current_user_fallback := fn_body LIKE '%current_user%';
  IF NOT has_current_user_fallback THEN
    RAISE EXCEPTION
      'TEST FAILED: guard_wizard_draft_updates body lost the current_user fallback — defense-in-depth regressed';
  END IF;

  RAISE NOTICE 'Assertion 1 OK: function body contains both auth.uid() and current_user checks.';

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
  -- The trigger function is called BY the trigger machinery, not by end users
  -- directly. Granting EXECUTE to public would let a malicious caller invoke
  -- the function in a context that bypasses the BEFORE-UPDATE event flow.
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

  RAISE NOTICE 'All guard_wizard_draft_updates assertions passed (Migration 125 / P475).';
END
$$;
