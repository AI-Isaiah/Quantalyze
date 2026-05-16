-- audit-2026-05-07 mitigation (specialist-review apply pass take 2)
-- Closes: CRITICAL-2 (security c9)
--   `reset_stalled_portfolio_analytics(INTERVAL)` was created with no
--   REVOKE EXECUTE FROM PUBLIC and no targeted GRANT. Postgres default
--   grants EXECUTE to PUBLIC on CREATE FUNCTION → ANY authenticated
--   user (or anon) could invoke a SECURITY DEFINER function that runs
--   as postgres and UPDATEs portfolio_analytics across all tenants.
--   The p_stale_threshold parameter is caller-controlled with only a
--   `> 0` check — a caller can pass interval '1 second' to reap
--   virtually all 'computing' rows across every tenant, flipping them
--   to status='failed'. Cross-tenant data tampering + DoS against
--   in-flight portfolio analytics.
--
-- Source migration: supabase/migrations/20260516122247_portfolio_analytics_stuck_row_reaper.sql
-- (cannot edit — already merged via PR #184)
--
-- Mitigation: REVOKE EXECUTE FROM PUBLIC, anon, authenticated; GRANT
-- to service_role only. Mirrors the reset_stalled_compute_jobs ACL
-- pattern in 20260412094449_compute_jobs_admin_and_defer.sql.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: lock down EXECUTE ACL
-- --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.reset_stalled_portfolio_analytics(INTERVAL)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_stalled_portfolio_analytics(INTERVAL)
  TO service_role;

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_role_can_execute BOOLEAN;
BEGIN
  -- (a) PUBLIC EXECUTE absent
  PERFORM public._assert_no_public_execute('public.reset_stalled_portfolio_analytics(interval)');

  -- (b) anon cannot execute
  SELECT has_function_privilege(
    'anon',
    'public.reset_stalled_portfolio_analytics(interval)',
    'execute'
  ) INTO v_role_can_execute;
  IF v_role_can_execute THEN
    RAISE EXCEPTION 'audit-2026-05-07 CRITICAL-2 verification failed: anon retains EXECUTE on reset_stalled_portfolio_analytics';
  END IF;

  -- (c) authenticated cannot execute
  SELECT has_function_privilege(
    'authenticated',
    'public.reset_stalled_portfolio_analytics(interval)',
    'execute'
  ) INTO v_role_can_execute;
  IF v_role_can_execute THEN
    RAISE EXCEPTION 'audit-2026-05-07 CRITICAL-2 verification failed: authenticated retains EXECUTE on reset_stalled_portfolio_analytics';
  END IF;

  -- (d) service_role CAN execute (Railway worker call path)
  SELECT has_function_privilege(
    'service_role',
    'public.reset_stalled_portfolio_analytics(interval)',
    'execute'
  ) INTO v_role_can_execute;
  IF NOT v_role_can_execute THEN
    RAISE EXCEPTION 'audit-2026-05-07 CRITICAL-2 verification failed: service_role lost EXECUTE on reset_stalled_portfolio_analytics — Railway worker would break';
  END IF;
END $$;

COMMIT;
