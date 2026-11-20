-- ============================================================================
-- auth_user_has_password: tell an account that HAS NO password apart from one
-- whose password was typed wrong
-- (2026-11-20, Phase 219 ACCOUNTEMAIL, gap closure plan 04; GD-05a, GD-01)
-- ============================================================================
--
-- What this is for
-- ----------------
-- The change-email route re-checks the caller's current password before it asks
-- Supabase Auth to start an email change. When that check fails, GoTrue answers
-- "Invalid login credentials" for BOTH a wrong password and an account that was
-- never given one, and neither the GoTrue user object nor its identities say which.
-- Only auth.users.encrypted_password knows, and only the database can read it.
-- Password-less accounts are real: the admin partner-import path creates auth users
-- that are email-confirmed and carry no password. Those users must be told to set a
-- password first (GD-05a) instead of being told their password is wrong.
--
-- What it adds: ONE function, public.auth_user_has_password(p_user_id uuid), that
-- returns ONE boolean about ONE id and nothing else. The route passes the id from
-- the caller's own auth.getUser(), never an id from the request, so the answer
-- leaks nothing about any other user. It is SECURITY DEFINER with a pinned
-- search_path, because service_role has no SELECT on auth.users, and its EXECUTE is
-- granted to service_role only, so no client session can probe a user id.
--
-- Returns true when the row exists and its password hash is a non-empty string.
-- Returns false for an empty string, a NULL, or an id that matches no row. Never NULL.
--
-- Reaches TEST and then PROD only through Supabase Migrate on merge (apply-test,
-- then the PROD apply, which runs with no human gate, D-10). Nothing here is applied
-- by hand.
--
-- No existing function is replaced, so the rule to re-base on the latest definition
-- of a replaced function is met vacuously. One new function is created.
--
-- Transaction style: NO explicit transaction statements (migration-reviewer
-- invariant 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to
-- that wrap.
--
-- Rollback (manual, off the auto-apply path; no data is touched):
-- supabase/migrations/down/20261120120000-rollback.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1 - the function. A single EXISTS gives false, never NULL, for an unknown
-- id. The schema-qualified table and the pinned search_path keep a hijacked
-- search_path from redirecting the read.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_user_has_password(p_user_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM auth.users u
     WHERE u.id = p_user_id AND u.encrypted_password IS NOT NULL AND u.encrypted_password <> ''
  );
$function$;

-- --------------------------------------------------------------------------
-- STEP 2 - grants. Server-side callers only: nobody else may ask whether a user
-- id has a password.
-- --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.auth_user_has_password(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_has_password(uuid) TO service_role;

COMMENT ON FUNCTION public.auth_user_has_password(uuid) IS
  'Phase 219 ACCOUNTEMAIL (GD-05a). One boolean about one auth user id: true when a password is set, false when it is empty, unset or the id is unknown. Never NULL, never exposes the hash. Runs with its owner''s rights and a pinned search_path; EXECUTE is held by service_role only.';

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read. Asserted: the function resolves by name and signature.
-- Deliberately NOT asserted here: the body, the security mode, the search_path
-- and the grants. A verify block that checked them would abort the apply of a
-- mutated copy of this file, and the SQL gate that mutates those lines needs
-- that apply to succeed in order to go RED on the behaviour instead.
DO $verify$
BEGIN
  IF to_regprocedure('public.auth_user_has_password(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Migration 20261120120000 failed: public.auth_user_has_password(uuid) is missing';
  END IF;

  RAISE NOTICE 'Migration 20261120120000: public.auth_user_has_password(uuid) exists.';
END
$verify$;
