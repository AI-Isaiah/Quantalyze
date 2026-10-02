-- Additive stand-in for `public.current_user_has_app_role(TEXT[])` and the
-- `user_app_roles` table its body reads. Apply AFTER 01-fixture-core.sql (which
-- drops schema public) and BEFORE any migration whose policies name the helper.
-- Never a second base.
--
-- ⛔ WHY A STAND-IN AND NOT THE REAL MIGRATION — this is forced by MEASUREMENT,
-- not preference. The helper's only defining migration is
-- supabase/migrations/20260417031851_user_app_roles.sql:137. That file CANNOT
-- APPLY to a vanilla PostgreSQL 16 cluster at all: its STEP 6 self-verification
-- issues `SAVEPOINT probe_058;` / `ROLLBACK TO SAVEPOINT probe_058;` INSIDE a
-- PL/pgSQL `DO $$ … $$;` body (:407, :428). PL/pgSQL has no savepoint
-- statements — its own BEGIN…EXCEPTION blocks are built on top of them — so the
-- body fails to PARSE. MEASURED on the lane 2026-09-04:
--   `psql:supabase/migrations/20260417031851_user_app_roles.sql:433:
--    ERROR: 42601: syntax error at or near "TO"`
-- That is the SECOND instance of the class booked as `[REDUNDER-SAVEPOINT]` in
-- TODOS.md (the first is 20260416201929_audit_log_hardening.sql:239-267, found
-- by plan 164.4-00's stubbed-chain probe 3 and reproduced there from an 8-line DO
-- body on an empty cluster). Nothing applied before it changes the outcome, and
-- the only other lever — editing the migration — is production and forbidden.
--
-- ⚠️ WHAT THIS IS AND IS NOT. It is SCAFFOLD, exactly like 15-fixture-auth-role's
-- `auth.role()`: it exists so that `CREATE POLICY … USING
-- (public.current_user_has_app_role(ARRAY['admin']))` PARSES and evaluates. No
-- arm in any gate using this file asserts anything about the helper or about
-- `user_app_roles` — the arms assert what the POLICY does with the result.
--
-- It is deliberately NOT narrower than production where narrowness would matter.
-- The body below is the real one (20260417031851:137-159) verbatim in behaviour:
-- NULL auth.uid() returns FALSE, otherwise EXISTS over user_app_roles by
-- (user_id, role). A hardcoded `RETURN FALSE` stub would have been cheaper and
-- WRONG — it would make every admin-policy arm structurally unfalsifiable while
-- the gate printed ALL PASS. The grants likewise mirror production AFTER
-- 20260715120000_grant_anon_execute_current_user_has_app_role.sql, which added
-- anon to the {authenticated, service_role} set 20260417031851:165-168 left.
-- ⚠️ ORDER-ROBUST ON PURPOSE. 02-fixture-sanitize-tables.sql:32 also carries
-- `CREATE TABLE IF NOT EXISTS user_app_roles (user_id UUID)` — one column, no
-- `role`. Whichever of the two files lands first, the other's create no-ops, so
-- the CREATE alone would leave the helper's body raising 42703 on `role` at CALL
-- time (an arm would then abort on a raw driver error naming no arm, instead of
-- failing as itself). The ALTER below closes that in the other direction, so
-- this fixture is correct BEFORE or AFTER 02.
CREATE TABLE IF NOT EXISTS user_app_roles (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);
ALTER TABLE user_app_roles
  ADD COLUMN IF NOT EXISTS role       TEXT,
  ADD COLUMN IF NOT EXISTS granted_by UUID,
  ADD COLUMN IF NOT EXISTS granted_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.current_user_has_app_role(p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM user_app_roles
    WHERE user_id = v_user_id
      AND role = ANY(p_roles)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.current_user_has_app_role(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_has_app_role(TEXT[])
  TO anon, authenticated, service_role;
