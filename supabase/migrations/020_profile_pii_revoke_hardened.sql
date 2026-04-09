-- Migration 020: HARDENED PII revoke on profiles.
--
-- Why this migration exists
-- -------------------------
-- Migrations 012 and 017 both tried to protect sensitive columns on
-- `profiles` with `REVOKE SELECT (<col>) ON profiles FROM anon, authenticated`.
-- Both were silent no-ops.
--
-- Root cause: `profiles` has `GRANT ALL ON TABLE profiles TO anon, authenticated`
-- at the TABLE level (arwdDxtm). Postgres rule: `REVOKE SELECT (col)` only
-- revokes an explicit COLUMN-level grant. If the role has SELECT via the
-- broader table-level grant, the column-level REVOKE finds nothing to
-- remove and silently succeeds. The table-level grant still applies to
-- every column.
--
-- Discovered 2026-04-09 while probing runtime state via the Supabase MCP:
--   SELECT grantee, column_name, privilege_type
--   FROM information_schema.column_privileges
--   WHERE table_schema = 'public' AND table_name = 'profiles'
--     AND column_name IN ('email','linkedin','bio','years_trading','aum_range')
--     AND grantee IN ('anon','authenticated') AND privilege_type='SELECT';
--   → all 10 rows returned SELECT.
--
-- Fix pattern
-- -----------
-- 1. REVOKE SELECT on profiles from anon + authenticated at the table level.
--    This nukes SELECT on every column.
-- 2. GRANT SELECT (<allowlist>) back for the public-safe columns only.
--    Anything NOT in the allowlist becomes admin-only (service_role).
-- 3. At the END of the migration, DO-block assertions that RAISE EXCEPTION
--    if any PII column still has anon/authenticated SELECT. This makes the
--    migration SELF-VERIFYING: it either achieves the intended state or
--    the transaction rolls back. Never again a silent no-op.
--
-- NOT changed by this migration (out of scope, filed as follow-ups):
-- - Table-level INSERT/UPDATE/DELETE grants on profiles (RLS still gates
--   them; tightening them is a larger audit).
-- - The same `GRANT ALL` pattern on the other 29 tables in public.
-- - The `profiles_read_public` RLS policy's `OR true` → public-read fallback.
--
-- Allowlist rationale (per-column)
-- -------------------------------
-- Safe for public read (marketplace discovery UI depends on these):
--   id                      — primary key, referenced everywhere
--   display_name            — public name shown in strategy cards
--   company                 — public org affiliation
--   description             — self-entered public bio for the marketplace
--   website                 — self-entered public URL
--   avatar_url              — public profile image
--   role                    — 'manager' | 'allocator' | 'admin'
--   manager_status          — 'verified' | 'pending' etc., shown on cards
--   allocator_status        — 'verified' | 'pending' etc., shown on cards
--   created_at              — join date, displayed on profile pages
--   preferences_updated_at  — displayed on allocator preferences surfaces
--   tenant_id               — multi-tenancy scope key, not PII
--   partner_tag             — partner-channel tag, used for routing
--   is_admin                — user dashboard uses self-read to gate admin UI
--
-- Admin-only (service_role, not exposed to anon/authenticated):
--   email          — PII, contact info
--   telegram       — PII, contact info
--   linkedin       — PII, contact info
--   bio            — free-text user bio (legacy column, may contain PII)
--   years_trading  — sensitive manager profile data
--   aum_range      — sensitive manager profile data
--
-- Caller impact
-- -------------
-- Based on the caller audit already recorded inline in migration 017 (lines
-- 14-51), every caller that reads email/linkedin/bio/etc. routes through
-- createAdminClient() (service_role) or is a self-read already restricted
-- to the profile owner. Non-admin non-self SELECTs of those columns do not
-- exist in src/**. If a future PR introduces one, the user-client SELECT
-- will return the column as NULL (Postgres behavior for missing grants
-- under column-level GRANT pattern) and the caller will see a broken UI —
-- a loud failure mode that's easier to debug than a silent PII leak.

-- --------------------------------------------------------------------------
-- STEP 1: drop the broad table-level SELECT
-- --------------------------------------------------------------------------
REVOKE SELECT ON profiles FROM anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 2: grant back the public-safe column allowlist
-- --------------------------------------------------------------------------
GRANT SELECT (
  id,
  display_name,
  company,
  description,
  website,
  avatar_url,
  role,
  manager_status,
  allocator_status,
  created_at,
  is_admin,
  preferences_updated_at,
  tenant_id,
  partner_tag
) ON profiles TO anon, authenticated;

-- service_role keeps full table-level access — the admin client is the
-- privileged path for every non-self read of PII columns.

-- --------------------------------------------------------------------------
-- STEP 3: document the protected columns
-- --------------------------------------------------------------------------
COMMENT ON COLUMN profiles.email IS
  'PII. Table-level SELECT revoked from anon/authenticated per migration 020. Access via createAdminClient() only.';
COMMENT ON COLUMN profiles.linkedin IS
  'PII. Table-level SELECT revoked from anon/authenticated per migration 020. Access via createAdminClient() only.';
COMMENT ON COLUMN profiles.telegram IS
  'PII. Table-level SELECT revoked from anon/authenticated per migration 020. Access via createAdminClient() only.';
COMMENT ON COLUMN profiles.bio IS
  'Sensitive. Table-level SELECT revoked from anon/authenticated per migration 020. Access via createAdminClient() only.';
COMMENT ON COLUMN profiles.years_trading IS
  'Sensitive. Table-level SELECT revoked from anon/authenticated per migration 020. Access via createAdminClient() only.';
COMMENT ON COLUMN profiles.aum_range IS
  'Sensitive. Table-level SELECT revoked from anon/authenticated per migration 020. Access via createAdminClient() only.';

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying assertion
-- --------------------------------------------------------------------------
-- If any of the protected columns still has anon or authenticated SELECT,
-- RAISE and roll back the whole transaction. This is the mechanism that
-- prevents the class of silent no-op that broke migrations 012 and 017.
--
-- We check via information_schema.column_privileges because it reflects
-- both explicit column grants AND table-level inheritance.
DO $$
DECLARE
  leaks int;
BEGIN
  SELECT count(*) INTO leaks
  FROM information_schema.column_privileges
  WHERE table_schema = 'public'
    AND table_name   = 'profiles'
    AND column_name  IN ('email', 'linkedin', 'telegram', 'bio', 'years_trading', 'aum_range')
    AND grantee      IN ('anon', 'authenticated')
    AND privilege_type = 'SELECT';

  IF leaks > 0 THEN
    RAISE EXCEPTION
      'Migration 020 failed: % anon/authenticated SELECT privileges still exist on profiles PII columns. Rolling back.',
      leaks;
  END IF;
END
$$;

-- Also assert the allowlist columns are still readable by anon/authenticated —
-- if the REVOKE-then-GRANT pattern accidentally dropped coverage for one of
-- them, the dashboard and marketplace UI would break at runtime and the
-- bug would only surface on the next page load. Better to fail here.
DO $$
DECLARE
  missing int;
BEGIN
  SELECT count(*) INTO missing
  FROM (
    VALUES
      ('id'), ('display_name'), ('company'), ('description'), ('website'),
      ('avatar_url'), ('role'), ('manager_status'), ('allocator_status'),
      ('created_at'), ('is_admin'), ('preferences_updated_at'),
      ('tenant_id'), ('partner_tag')
  ) AS expected(col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name   = 'profiles'
      AND column_name  = expected.col
      AND grantee      = 'anon'
      AND privilege_type = 'SELECT'
  );

  IF missing > 0 THEN
    RAISE EXCEPTION
      'Migration 020 failed: % allowlist columns lost anon SELECT coverage. Rolling back.',
      missing;
  END IF;
END
$$;
