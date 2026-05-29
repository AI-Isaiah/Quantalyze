-- ============================================================================
-- Lock profiles.role at signup (2026-05-20)
-- ============================================================================
--
-- Background
-- ----------
-- The product has two account types: allocators (capital) and quant managers
-- (strategy publishers). The schema's role column allows ('manager',
-- 'allocator', 'both') with default 'manager'. Until this migration:
--
--   1. SignupForm collected email + password + display_name only. The
--      `handle_new_user` trigger always inserted role='manager' regardless
--      of intent.
--   2. OnboardingWizard collected the role choice AFTER signup, in a
--      separate step, and UPDATE'd profiles.role to whatever the user
--      picked there.
--   3. ProfileForm let the user re-pick their role at any time from
--      the /profile page.
--
-- That model lets a user accidentally — or deliberately — toggle between
-- allocator and manager surfaces, which makes no sense for downstream
-- analytics, bridge attribution, or notification preferences (an allocator
-- doesn't have strategies; a manager doesn't have a discovery feed).
--
-- What changes
-- ------------
-- Two coupled DB changes seed role at signup and enforce immutability:
--
--   1. `handle_new_user` reads `role` from `auth.users.raw_user_meta_data`
--      and writes it on the INSERT. The SignupForm now passes the choice
--      via `supabase.auth.signUp({ options: { data: { role } } })`. Falls
--      back to 'manager' when the metadata is missing (CLI sign-ups, legacy
--      test fixtures, etc.) so existing flows that don't supply role still
--      work.
--
--   2. `prevent_profile_role_change` is a BEFORE UPDATE OF role trigger that
--      raises if `NEW.role IS DISTINCT FROM OLD.role` and the caller is
--      NOT a privileged session role (`postgres`, `service_role`,
--      `supabase_admin`). Admin / support flows that need to fix a wrong
--      choice continue to work through service_role; regular authenticated
--      clients cannot change role from the UI or via direct PostgREST.
--
-- 'both' is intentionally NOT removed from the CHECK constraint — historical
-- profiles with role='both' continue to function, and a future migration
-- could backfill them, but that's out of scope here.
--
-- Idempotency
-- -----------
-- - handle_new_user is CREATE OR REPLACE; safe to re-run.
-- - prevent_profile_role_change is CREATE OR REPLACE; safe to re-run.
-- - The trigger is DROPPed-if-exists before CREATE so re-running on a
--   partially-applied state converges.
-- ============================================================================

-- ─────────────────────────────────────────────────────────── handle_new_user
-- Read role from auth.users.raw_user_meta_data->>'role' with a fallback.
-- Validates that the value is one of the schema's allowed roles before
-- using it, otherwise falls back to 'manager' (the legacy default).
--
-- ┌─ SECURITY BOUNDARY (NEW-C15-05) ─────────────────────────────────────────┐
-- │ The `v_raw_role IN ('manager', 'allocator', 'both')` allowlist below is  │
-- │ THE trust boundary for the role a new account gets — NOT the SignupForm  │
-- │ TS union `"allocator" | "manager"`. `raw_user_meta_data.role` is fully   │
-- │ ATTACKER-CONTROLLED: it comes from `supabase.auth.signUp({ options: {    │
-- │ data: { role } } })`, so a scripted client can POST any string (e.g.     │
-- │ 'admin', 'service_role', 'both'). This allowlist is fail-CLOSED — every  │
-- │ value outside the three product roles (including NULL / absent) collapses │
-- │ to 'manager', the least-privileged account type. Nothing upstream is a   │
-- │ guard; the client union only shapes the UI.                              │
-- │                                                                          │
-- │ DO NOT widen this `IN (...)` set to add an internal/elevated value       │
-- │ (e.g. 'admin', 'support') and rely on the client to never send it —     │
-- │ that re-opens self-elevation at signup. An elevated role must be granted │
-- │ post-signup through a service_role path (see prevent_profile_role_change │
-- │ below), never seeded from attacker metadata. Guarded by                  │
-- │ supabase/tests/test_handle_new_user_role_allowlist.sql.                  │
-- └──────────────────────────────────────────────────────────────────────────┘
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role     text;
  v_raw_role text;
BEGIN
  v_raw_role := NEW.raw_user_meta_data->>'role';
  IF v_raw_role IN ('manager', 'allocator', 'both') THEN
    v_role := v_raw_role;
  ELSE
    v_role := 'manager';
  END IF;

  INSERT INTO public.profiles (id, display_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    v_role
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

-- ─────────────────────────────────────────────────── role immutability trigger
-- Blocks UPDATE OF role on profiles when the caller is a regular client
-- (authenticated / anon). Service-role / postgres / supabase_admin paths
-- (admin support, backfills, migrations) keep working — they bypass the
-- check intentionally.
--
-- A no-op UPDATE (role unchanged) is always allowed so existing UI calls
-- that include `role` in their payload during the transition window don't
-- error out; only an actual change is blocked. The client paths in
-- ProfileForm / OnboardingWizard have been updated to omit role entirely,
-- but a stale tab or a third-party caller could still send the unchanged
-- value, and that path stays silently green.
CREATE OR REPLACE FUNCTION prevent_profile_role_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  -- Privileged session roles can change role for admin / support cases.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'profiles.role is set at signup and cannot be changed from the client. '
    'Contact support to switch between allocator and manager accounts.'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog;

DROP TRIGGER IF EXISTS profiles_lock_role ON public.profiles;
CREATE TRIGGER profiles_lock_role
BEFORE UPDATE OF role ON public.profiles
FOR EACH ROW EXECUTE FUNCTION prevent_profile_role_change();

COMMENT ON FUNCTION prevent_profile_role_change() IS
  'Locks profiles.role after signup (2026-05-20). The signup form is now the '
  'only place a regular user picks their role. Admin support paths through '
  'service_role still work; the trigger no-ops when role is unchanged so '
  'stale UI payloads that re-send the same value do not break.';

COMMENT ON TRIGGER profiles_lock_role ON public.profiles IS
  'Companion to prevent_profile_role_change(). Fires only on UPDATE OF role '
  'so other profile column updates (display_name, company, telegram, etc.) '
  'have zero overhead.';
