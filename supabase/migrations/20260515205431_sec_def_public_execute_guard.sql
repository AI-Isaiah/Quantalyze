-- Migration 134: PUBLIC EXECUTE absence guard for the scenario-commit
-- SECURITY DEFINER slice (audit-2026-05-07 C-0284).
--
-- Why this migration exists
-- -------------------------
-- audit-2026-05-07 C-0284 (S14c red-team, c=9) flagged that migration
-- 082's self-verification (assertion (f) at line 386 of
-- 20260426131720_commit_scenario_batch_rpc.sql) probes for a PUBLIC
-- EXECUTE leak using:
--
--   has_function_privilege('public', 'public.commit_scenario_batch(uuid, jsonb)', 'EXECUTE')
--
-- The first argument to has_function_privilege is a Postgres role name.
-- While `public` is recognized as a pseudo-grantee by ACL functions in
-- modern Postgres, the contract is brittle:
--
--   * It varies across PG versions / catalog snapshots.
--   * On a fresh CREATE OR REPLACE that leaks PUBLIC EXECUTE, the
--     check may return TRUE because authenticated/anon are PUBLIC
--     members, masking the leak rather than catching it.
--   * The audit-team's reproduction matrix found cases where the
--     literal `'public'` is treated as "look up a role named public",
--     which never exists in Supabase, and the check silently returns
--     FALSE — meaning the assertion CANNOT detect the actual leak it
--     claims to guard against.
--
-- The reliable probe is to read pg_proc.proacl directly and inspect
-- aclexplode rows for a grantee = 0 entry (OID 0 is the canonical
-- representation of the PUBLIC pseudo-grantee in pg_authid). If the
-- grantee=0 row carries EXECUTE (`X`) privilege for the function,
-- PUBLIC has the leak, regardless of the function-privilege helper's
-- behavior.
--
-- This migration installs a `_assert_no_public_execute(text)` helper
-- that performs the correct probe and runs it against the two
-- SECURITY DEFINER functions in the audit slice:
--
--   * public.commit_scenario_batch(uuid, jsonb)   (mig 082 / 128)
--   * public.compute_bridge_outcome_deltas()      (mig 074 / 080)
--
-- Each function is also defensively REVOKEd from PUBLIC, anon
-- before the assertion runs, so the migration is corrective if any
-- prior CREATE OR REPLACE → REVOKE timing window left an inadvertent
-- grant in place. The helper is preserved (not dropped) so future
-- migrations that add SECURITY DEFINER functions can call it as a
-- one-line self-verifier.
--
-- Idempotency
-- -----------
-- CREATE OR REPLACE for the helper. REVOKEs are no-ops on already-
-- revoked grants. The assertion is read-only.
--
-- Rollback
-- --------
-- Dropping the helper is safe (it has no callers in app code; it is
-- a migration-only utility). The defensive REVOKEs cannot be rolled
-- back to a prior buggy state — and should not be. See
-- supabase/migrations/down/20260515205431-rollback.sql.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: install the PUBLIC EXECUTE absence assertion helper.
-- --------------------------------------------------------------------------
-- Inspects pg_proc.proacl via aclexplode and asserts that no aclitem in
-- the function's ACL grants EXECUTE to grantee=0 (the canonical PUBLIC
-- pseudo-grantee OID). Raises EXCEPTION on leak with a domain-specific
-- ERRCODE so callers can distinguish from real DB errors.
CREATE OR REPLACE FUNCTION public._assert_no_public_execute(p_function_signature TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_oid   OID;
  v_leaks INTEGER;
BEGIN
  -- Resolve the function signature to an OID. regprocedure rejects an
  -- ambiguous or missing signature with a clear error.
  v_oid := p_function_signature::regprocedure::oid;

  -- aclexplode returns one row per (grantor, grantee, privilege) tuple.
  -- grantee = 0 is the PUBLIC pseudo-grantee in pg_authid. privilege_type
  -- = 'EXECUTE' is the EXECUTE bit. If any such row exists, PUBLIC has
  -- the function — by definition the leak the audit C-0284 targets.
  SELECT COUNT(*) INTO v_leaks
    FROM pg_proc p,
         LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
   WHERE p.oid = v_oid
     AND a.grantee = 0
     AND a.privilege_type = 'EXECUTE';

  IF v_leaks > 0 THEN
    RAISE EXCEPTION
      '_assert_no_public_execute: PUBLIC has EXECUTE on % — SECURITY DEFINER leak detected via pg_proc.proacl (aclexplode grantee=0). audit-2026-05-07 C-0284.',
      p_function_signature
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public._assert_no_public_execute(TEXT) IS
  'Migration 134 / audit-2026-05-07 C-0284. Asserts a function has NO PUBLIC '
  'EXECUTE grant by inspecting pg_proc.proacl via aclexplode(grantee=0). '
  'Correct replacement for has_function_privilege(''public'', ...) which is '
  'brittle across PG versions. Migration-utility only — REVOKE-d from anon/'
  'authenticated below so it cannot be invoked from the API layer.';

REVOKE ALL ON FUNCTION public._assert_no_public_execute(TEXT) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 2: defensive REVOKE on the audit-slice SECURITY DEFINER functions.
-- --------------------------------------------------------------------------
-- Idempotent. If a prior CREATE OR REPLACE left an inadvertent PUBLIC
-- grant, this strips it. If no such grant exists, the REVOKE is a no-op.
-- Note: mig 131 (20260515130006_commit_scenario_batch_idempotency.sql) DROPped
-- the (uuid, jsonb) signature and created the 4-arg
-- (uuid, jsonb, text, text) form. Target the 4-arg signature so this REVOKE
-- runs on a fresh apply.
REVOKE ALL ON FUNCTION public.commit_scenario_batch(uuid, jsonb, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.compute_bridge_outcome_deltas() FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 3: run the correct PUBLIC EXECUTE assertion on both functions.
-- --------------------------------------------------------------------------
-- These are the C-0284 acceptance criteria. If either function has
-- PUBLIC EXECUTE post-REVOKE, the migration aborts — which is the
-- right failure mode (a leak we cannot revoke is a real CRITICAL).
DO $$
BEGIN
  PERFORM public._assert_no_public_execute('public.commit_scenario_batch(uuid, jsonb, text, text)');
  PERFORM public._assert_no_public_execute('public.compute_bridge_outcome_deltas()');
  RAISE NOTICE 'Migration 134: PUBLIC EXECUTE absence verified for commit_scenario_batch + compute_bridge_outcome_deltas via aclexplode grantee=0 probe.';
END $$;

COMMIT;
