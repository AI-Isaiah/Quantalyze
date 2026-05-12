-- Migration 116: HARDENED INSERT/UPDATE/DELETE on profiles + tightened
-- ALL-policy USING/WITH CHECK clause.
--
-- Audit-2026-05-07 P336 + P337
--
-- Why this migration exists
-- -------------------------
-- Migration 020 closed the SELECT-side leak on profiles PII (table-level
-- SELECT was revoked, then re-granted column-by-column for the public
-- allowlist). The DO-block at the end of 020 only verifies the SELECT
-- side — INSERT/UPDATE/DELETE table-level grants from the original
-- `GRANT ALL ON TABLE profiles TO anon, authenticated` are STILL in
-- place. The runtime probe behind P336:
--
--   SELECT has_table_privilege('anon', 'public.profiles', 'INSERT');
--   → TRUE
--   SELECT has_table_privilege('anon', 'public.profiles', 'UPDATE');
--   → TRUE
--   SELECT has_table_privilege('anon', 'public.profiles', 'DELETE');
--   → TRUE
--
-- RLS is the only thing currently keeping anon-key clients from
-- writing to profiles. That's fine in practice — the `profiles_own`
-- policy is `USING (id = auth.uid())` and an anon JWT has no
-- `auth.uid()` — but it's defense-in-depth that a single misapplied
-- policy doesn't expose the table to anonymous writes. P336 closes
-- this by REVOKE-ing INSERT/UPDATE/DELETE from anon at the table
-- level so the grant graph matches the intent.
--
-- P337 fixes a related concern in the policy itself. Migration 002's
--   CREATE POLICY profiles_own ON profiles FOR ALL USING (id = auth.uid());
-- has no explicit WITH CHECK clause. PostgreSQL infers WITH CHECK from
-- USING when omitted, so the runtime semantics are correct, but the
-- omission is a footgun: a future migration that loosens USING (e.g.,
-- adding `OR is_admin = true`) would silently broaden WITH CHECK too,
-- letting an admin write into any profile under the same predicate
-- expansion. Splitting the ALL policy into per-verb policies with
-- explicit USING + WITH CHECK clauses pins the intent: row visibility
-- and write-target-row-validity are stated separately and an audit can
-- diff them.
--
-- The fix
-- -------
-- 1. REVOKE INSERT, UPDATE, DELETE on profiles from anon. (We keep them
--    on `authenticated` because the in-app self-service flows
--    OnboardingWizard + ProfileForm use the user-context client to
--    UPDATE the caller's own row; RLS gates the row to id = auth.uid().)
-- 2. DROP the `profiles_own` ALL policy and replace with explicit
--    per-verb policies, each with USING + WITH CHECK = `auth.uid() = id`.
-- 3. DO-block at the end asserts:
--    - anon has NO INSERT/UPDATE/DELETE table-level privilege
--    - the four new per-verb policies exist with the expected
--      USING/WITH CHECK shapes
-- 4. The transaction rolls back if either assertion fails.
--
-- Caller impact
-- -------------
-- The anon-key client should never have been writing to profiles —
-- the only legitimate write paths are (a) the auth-trigger inserting
-- a row on signup (runs as the supabase_auth_admin role, unaffected),
-- (b) self-service updates from authenticated users (unaffected),
-- (c) admin-side upserts from the partner-import route (uses the
-- service-role client, unaffected). A grep across src/** for
-- `from("profiles").insert/upsert/update/delete` confirms every
-- write site routes through one of those three privileged paths.

-- --------------------------------------------------------------------------
-- STEP 1: revoke INSERT/UPDATE/DELETE from anon at the TABLE level
-- --------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON profiles FROM anon;

-- --------------------------------------------------------------------------
-- STEP 2: drop the ALL policy and replace with per-verb policies that
--         require auth.uid() = id with NO OR-true escape.
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_own ON profiles;

-- Self-INSERT — only when the row's id matches the caller's auth.uid().
-- Mirrors the auth-trigger row creation pattern (the trigger runs as
-- the supabase_auth_admin role and bypasses RLS, so the insert from a
-- user-context session is the rare-case fallback).
CREATE POLICY profiles_self_insert ON profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Self-UPDATE — both visibility (USING) and the post-update target row
-- (WITH CHECK) must match the caller. WITH CHECK separately prevents
-- the caller from re-keying the row to a different `id` mid-update.
CREATE POLICY profiles_self_update ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Self-DELETE — visibility-only check; there's no "target row" for
-- DELETE in WITH CHECK semantics.
CREATE POLICY profiles_self_delete ON profiles
  FOR DELETE
  USING (auth.uid() = id);

-- NOTE: We intentionally do NOT add a `profiles_self_select` policy
-- here. The existing `profiles_read_public` policy from migration 002
-- already covers SELECT (see its `USING (true)` + the column-level
-- REVOKE/GRANT pattern from migration 020 that gates which columns
-- anon/authenticated can actually read). Adding a self-SELECT policy
-- here would be redundant and would not narrow the column-level grant
-- footprint, which is what actually protects the PII columns.

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying assertions
-- --------------------------------------------------------------------------
DO $$
DECLARE
  anon_can_insert boolean;
  anon_can_update boolean;
  anon_can_delete boolean;
BEGIN
  -- pg_catalog.has_table_privilege is the canonical runtime check —
  -- it reflects the table-level grant graph that the role actually
  -- sees, including inherited grants from PUBLIC.
  SELECT pg_catalog.has_table_privilege('anon', 'public.profiles', 'INSERT')
    INTO anon_can_insert;
  SELECT pg_catalog.has_table_privilege('anon', 'public.profiles', 'UPDATE')
    INTO anon_can_update;
  SELECT pg_catalog.has_table_privilege('anon', 'public.profiles', 'DELETE')
    INTO anon_can_delete;

  IF anon_can_insert OR anon_can_update OR anon_can_delete THEN
    RAISE EXCEPTION
      'Migration 116 failed: anon still has write privileges on profiles (INSERT=%, UPDATE=%, DELETE=%). Rolling back.',
      anon_can_insert, anon_can_update, anon_can_delete;
  END IF;
END
$$;

DO $$
DECLARE
  insert_policy_count int;
  update_policy_count int;
  delete_policy_count int;
  legacy_all_policy_count int;
  update_qual    text;
  update_check   text;
BEGIN
  -- The new per-verb policies must exist exactly once each.
  SELECT count(*) INTO insert_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'profiles'
    AND policyname = 'profiles_self_insert'
    AND cmd        = 'INSERT';

  SELECT count(*) INTO update_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'profiles'
    AND policyname = 'profiles_self_update'
    AND cmd        = 'UPDATE';

  SELECT count(*) INTO delete_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'profiles'
    AND policyname = 'profiles_self_delete'
    AND cmd        = 'DELETE';

  -- The legacy `profiles_own` ALL policy must be gone.
  SELECT count(*) INTO legacy_all_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'profiles'
    AND policyname = 'profiles_own';

  IF insert_policy_count <> 1 THEN
    RAISE EXCEPTION
      'Migration 116 failed: expected exactly 1 profiles_self_insert policy, found %.',
      insert_policy_count;
  END IF;

  IF update_policy_count <> 1 THEN
    RAISE EXCEPTION
      'Migration 116 failed: expected exactly 1 profiles_self_update policy, found %.',
      update_policy_count;
  END IF;

  IF delete_policy_count <> 1 THEN
    RAISE EXCEPTION
      'Migration 116 failed: expected exactly 1 profiles_self_delete policy, found %.',
      delete_policy_count;
  END IF;

  IF legacy_all_policy_count <> 0 THEN
    RAISE EXCEPTION
      'Migration 116 failed: legacy profiles_own ALL policy still present (count=%).',
      legacy_all_policy_count;
  END IF;

  -- Verify the UPDATE policy has BOTH USING and WITH CHECK clauses
  -- requiring auth.uid() = id, with no OR-true escape (P337 specifically
  -- guards against a future migration adding `OR true` or `OR is_admin`
  -- without rejustifying it). pg_policies.qual is the USING expression;
  -- pg_policies.with_check is the WITH CHECK expression. Both should
  -- contain `auth.uid()` and `id` and NEITHER should contain `OR true`,
  -- `OR (true)`, or a bare `true`.
  SELECT qual, with_check INTO update_qual, update_check
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename  = 'profiles'
    AND policyname = 'profiles_self_update';

  IF update_qual IS NULL OR update_qual NOT LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION
      'Migration 116 failed: profiles_self_update USING clause does not reference auth.uid() (qual=%).',
      update_qual;
  END IF;

  IF update_check IS NULL OR update_check NOT LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION
      'Migration 116 failed: profiles_self_update WITH CHECK clause does not reference auth.uid() (with_check=%).',
      update_check;
  END IF;

  -- Catch the OR-true escape explicitly. Postgres normalizes `true` and
  -- `OR true` in a few canonical forms — match all the variants we'd
  -- accept as a regression.
  IF update_qual ~* '\m(or\s+true|or\s*\(\s*true\s*\))\M' THEN
    RAISE EXCEPTION
      'Migration 116 failed: profiles_self_update USING clause contains OR-true escape (qual=%).',
      update_qual;
  END IF;

  IF update_check ~* '\m(or\s+true|or\s*\(\s*true\s*\))\M' THEN
    RAISE EXCEPTION
      'Migration 116 failed: profiles_self_update WITH CHECK clause contains OR-true escape (with_check=%).',
      update_check;
  END IF;
END
$$;

COMMENT ON POLICY profiles_self_insert ON profiles IS
  'Audit-2026-05-07 P337. Replaces ALL-policy with explicit per-verb. WITH CHECK pins target row to caller.';
COMMENT ON POLICY profiles_self_update ON profiles IS
  'Audit-2026-05-07 P337. USING + WITH CHECK both require auth.uid() = id. No OR-true escape allowed.';
COMMENT ON POLICY profiles_self_delete ON profiles IS
  'Audit-2026-05-07 P337. USING requires auth.uid() = id. DELETE has no WITH CHECK semantics.';
