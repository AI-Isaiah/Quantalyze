-- ============================================================================
-- Lock privileged profiles columns against client self-write (2026-05-29)
-- ============================================================================
--
-- Background — confirmed client-side privilege escalations
-- --------------------------------------------------------
-- profiles is exposed to PostgREST. The profiles_self_* RLS policies constrain
-- the ROW (auth.uid() = id), NOT the columns, and `authenticated` holds the
-- Supabase-default whole-table INSERT/UPDATE/DELETE grant (migration 116,
-- 20260512182319, revoked these from anon only and explicitly kept them on
-- authenticated). The only column-level protection was a BEFORE UPDATE OF role
-- trigger (prevent_profile_role_change, migration 20260520222848). Three holes,
-- all reachable by any logged-in user via a plain PATCH / POST / DELETE to
-- /rest/v1/profiles?id=eq.<own-uid>:
--
--   1. CRITICAL — is_admin via UPDATE. No trigger guarded is_admin. is_admin =
--      true is a live admin gate (admin-only RLS in
--      20260408113028_disclosure_and_tenancy.sql + the admin-route OR check), so
--      {"is_admin": true} self-grants full back-office admin.
--   2. CRITICAL — is_admin / tenant_id / *_status via DELETE + re-INSERT.
--      profiles_self_delete + profiles_self_insert let a user delete their own
--      row and INSERT a replacement with any column values (WITH CHECK only pins
--      id), bypassing any UPDATE-side guard entirely.
--   3. The role lock was INEFFECTIVE. prevent_profile_role_change is SECURITY
--      DEFINER, so inside it current_user is the function OWNER (postgres) and
--      the privileged-caller check ALWAYS passed → it never blocked anyone.
--
-- All three were confirmed by impersonating `authenticated` (SET LOCAL ROLE +
-- forged request.jwt.claims sub) on the test DB, rolled back.
--
-- What changes
-- ------------
--   1. PRIMARY GATE — column-level write privileges. A bare column-level
--      `REVOKE UPDATE (col, …)` is a NO-OP against authenticated's table-level
--      UPDATE grant (PostgreSQL cannot subtract a column from a table grant), so
--      we instead mirror migration 020's SELECT allowlist pattern for writes:
--        a. REVOKE the table-level INSERT, UPDATE, DELETE from authenticated/anon
--           (clean slate — anon keeps nothing, which matches migration 116's
--           intent; authenticated's blanket write grant is removed), then
--        b. GRANT UPDATE back to authenticated on ONLY the non-privileged,
--           self-editable columns. The six privileged columns (is_admin, role,
--           tenant_id, allocator_status, manager_status, partner_tag) are now
--           genuinely ungranted: has_column_privilege(...,'is_admin','UPDATE')
--           is FALSE and PostgREST rejects any UPDATE naming them.
--      No INSERT/DELETE is re-granted: the only profile-creation path is the
--      handle_new_user signup trigger (SECURITY DEFINER, runs as the owner →
--      bypasses grants), and account deletion goes through the service-role
--      data-deletion purge, not a client DELETE (no caller in the codebase uses
--      either). The now-inert profiles_self_insert / profiles_self_delete
--      policies are dropped so the RLS model matches the grants; profiles_self_
--      update stays (UPDATE is still granted per-column and the policy still
--      enforces row ownership). Legitimate self-edit surfaces (ProfileForm,
--      OnboardingWizard) only touch granted columns; every privileged-column
--      writer (admin approve / partner-import routes, role-revoke flow,
--      backfills, analytics worker) uses the service-role client.
--   2. DEFENSE-IN-DEPTH — a CORRECT trigger. prevent_profile_privileged_change
--      is SECURITY INVOKER (NOT definer), so current_user is the real caller
--      ('authenticated' for clients, 'service_role'/'postgres'/'supabase_admin'
--      for privileged paths). On UPDATE it blocks any change to a privileged
--      column; on INSERT it blocks a non-privileged caller from seeding an
--      elevated is_admin / tenant_id. It backstops a future re-grant and
--      supersedes the no-op prevent_profile_role_change (whose trigger we drop).
--      A no-op UPDATE (column unchanged) is implicitly allowed.
--
-- Idempotency
-- -----------
-- - REVOKE / GRANT / DROP POLICY IF EXISTS are idempotent.
-- - prevent_profile_privileged_change is CREATE OR REPLACE.
-- - Triggers are DROPped-if-exists before CREATE.
-- ============================================================================

-- ───────────────────────────────────── 1a. clean slate: revoke blanket writes
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM authenticated, anon;

-- ───────────────────────────── 1b. restore UPDATE on non-privileged columns only
-- Every column EXCEPT is_admin, role, tenant_id, allocator_status,
-- manager_status, partner_tag. This preserves all existing self-edit behavior
-- and removes ONLY the six privileged columns from client reach.
GRANT UPDATE (
  id, display_name, company, description, email, telegram, website, linkedin,
  avatar_url, created_at, preferences_updated_at, bio, years_trading, aum_range
) ON public.profiles TO authenticated;

-- ─────────────────────────── 1c. drop now-inert self-INSERT / self-DELETE policies
-- Their privileges are revoked above; profile creation is the handle_new_user
-- signup trigger and account deletion is the service-role purge path.
DROP POLICY IF EXISTS profiles_self_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_self_delete ON public.profiles;

-- ──────────────────────────────────── 2. DEFENSE-IN-DEPTH: correct (INVOKER) trigger
CREATE OR REPLACE FUNCTION prevent_profile_privileged_change()
RETURNS TRIGGER
LANGUAGE plpgsql
-- SECURITY INVOKER (the default — stated explicitly) is load-bearing: under
-- SECURITY DEFINER, current_user would be this function's owner and the
-- privileged-caller check would always pass (the exact bug that made
-- prevent_profile_role_change a no-op). As INVOKER, current_user is the role the
-- request runs under (authenticated / anon / service_role / postgres).
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Privileged callers may write these columns: service_role (admin support
  -- routes, the role-revoke flow, the analytics worker), and postgres /
  -- supabase_admin (the handle_new_user signup trigger, migrations, backfills).
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A non-privileged self-INSERT (should be impossible now — INSERT is
    -- revoked — but backstops a re-grant) must not seed an elevated profile.
    IF NEW.is_admin IS TRUE OR NEW.tenant_id IS NOT NULL THEN
      RAISE EXCEPTION
        'profiles: a client cannot create a row with elevated is_admin / tenant_id; use a service-role path.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: block any change to a privileged column (backstops a column re-grant).
  IF NEW.is_admin         IS DISTINCT FROM OLD.is_admin
     OR NEW.role          IS DISTINCT FROM OLD.role
     OR NEW.tenant_id     IS DISTINCT FROM OLD.tenant_id
     OR NEW.allocator_status IS DISTINCT FROM OLD.allocator_status
     OR NEW.manager_status   IS DISTINCT FROM OLD.manager_status
     OR NEW.partner_tag   IS DISTINCT FROM OLD.partner_tag
  THEN
    RAISE EXCEPTION
      'profiles privileged columns (is_admin, role, tenant_id, allocator_status, manager_status, partner_tag) cannot be changed from the client; use an admin / service-role path.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- Replace the role-only lock (now superseded) with the unified privileged-column
-- lock. prevent_profile_role_change() is left in place (orphaned, harmless) to
-- avoid breaking any external reference. The UPDATE OF column list keeps the
-- trigger off the hot path for ordinary profile edits; INSERT always fires.
DROP TRIGGER IF EXISTS profiles_lock_role ON public.profiles;
DROP TRIGGER IF EXISTS profiles_lock_privileged_cols ON public.profiles;
CREATE TRIGGER profiles_lock_privileged_cols
BEFORE INSERT OR UPDATE OF is_admin, role, tenant_id, allocator_status, manager_status, partner_tag
ON public.profiles
FOR EACH ROW EXECUTE FUNCTION prevent_profile_privileged_change();

COMMENT ON FUNCTION prevent_profile_privileged_change() IS
  'Defense-in-depth lock on privileged profiles columns (is_admin, role, '
  'tenant_id, allocator_status, manager_status, partner_tag) (2026-05-29). '
  'SECURITY INVOKER so current_user is the real caller — supersedes the no-op '
  'SECURITY DEFINER prevent_profile_role_change. Primary gate is the per-column '
  'UPDATE GRANT allowlist (privileged columns ungranted) + the INSERT/DELETE '
  'REVOKE; this trigger backstops a re-grant.';

COMMENT ON TRIGGER profiles_lock_privileged_cols ON public.profiles IS
  'Backstops client writes to privileged profiles columns. Fires on INSERT and '
  'on UPDATE OF the six privileged columns only, so ordinary profile edits '
  '(display_name, bio, company, …) never hit it. Companion to the column GRANT '
  'allowlist + INSERT/DELETE REVOKE in this migration.';
