-- Test: anon can EXECUTE public.current_user_has_app_role(text[]).
-- Guards migration 20260715120000_grant_anon_execute_current_user_has_app_role.sql.
--
-- Background
-- ----------
-- `current_user_has_app_role` is STABLE SECURITY DEFINER and null-guards anon
-- (returns FALSE when auth.uid() is null). It is called inside {public}-scoped
-- admin SELECT RLS policies on 9 tables, including strategy_verifications, which
-- is embedded in the public /browse strategy query. Before this fix anon lacked
-- EXECUTE, so any anon read touching one of those tables threw
-- `42501: permission denied for function current_user_has_app_role` — the SSR
-- query caught it and returned [], so logged-out visitors saw ZERO strategies on
-- /browse (the marketing CTA), with a clean browser console.
--
-- Asserted invariants:
--   1. anon holds EXECUTE on current_user_has_app_role(text[]).
--   2. Behavioral: calling it AS the anon role succeeds and returns FALSE
--      (the exact path that threw 42501 before the grant).
--
-- Test DB lag: the shared test DB tracks prod but lags main, so on a PR branch
-- the grant may not be applied yet. Invariant 1 is gated on a NOTICE-skip so the
-- test does not red-fail pre-apply; it becomes a hard guard once the test DB
-- catches up (the migration is applied to the test project before merge). Whole
-- test rolls back.

BEGIN;

DO $$
BEGIN
  -- Skip ONLY on genuine test-DB lag: the function itself absent (neither its
  -- defining migration 20260417031851 nor this grant applied yet). If the
  -- function EXISTS, the anon grant MUST be present — a missing anon EXECUTE is a
  -- real regression (e.g. a future hardening pass re-REVOKEs anon), not lag, and
  -- must hard-fail rather than skip green. (The reviewer's LOW finding: gate the
  -- skip on existence, not on the privilege being audited.)
  IF to_regprocedure('public.current_user_has_app_role(text[])') IS NULL THEN
    RAISE NOTICE 'SKIP: current_user_has_app_role not present yet (test DB lag)';
    RETURN;
  END IF;

  -- Invariant 1 — the grant exists (hard fail if regressed).
  IF NOT has_function_privilege(
        'anon', 'public.current_user_has_app_role(text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'REGRESSION: anon lacks EXECUTE on current_user_has_app_role — anon reads touching a {public} admin RLS policy (e.g. the /browse strategy_verifications embed) will 42501, and the public discovery pages will show zero strategies to logged-out visitors';
  END IF;

  -- Invariant 2 — behavioral: as anon, the call must succeed and return FALSE.
  -- Without the grant this SET ROLE + call is exactly what threw 42501.
  SET LOCAL ROLE anon;
  IF public.current_user_has_app_role(ARRAY['admin']) IS NOT FALSE THEN
    RESET ROLE;
    RAISE EXCEPTION 'REGRESSION: anon current_user_has_app_role([admin]) did not return FALSE';
  END IF;
  RESET ROLE;

  RAISE NOTICE 'PASS: anon can execute current_user_has_app_role and it returns FALSE';
END $$;

ROLLBACK;
