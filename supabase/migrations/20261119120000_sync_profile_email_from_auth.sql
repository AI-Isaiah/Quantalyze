-- ============================================================================
-- sync_profile_email_from_auth: keep the derived public.profiles.email in step
-- with the Supabase Auth sign-in email, and close the user-session write path
-- to that column
-- (2026-11-19, Phase 219 ACCOUNTEMAIL, plan 01; D-06, D-07, D-08, D-10, D-11)
-- ============================================================================
--
-- What this is for
-- ----------------
-- The signed-in account can now change its sign-in email through Supabase Auth's
-- confirm-by-email flow (supabase.auth.updateUser, plan 02 of this phase). Auth
-- itself writes the new address into auth.users.email once the user confirms it.
-- public.profiles.email is a DERIVED COPY of that address, set once at signup by
-- handle_new_user, and nothing keeps it current. Seven transactional send routes,
-- the admin pages and the org_invites_* policies read the copy, so without a sync
-- they keep using the OLD address after a confirmed change. This migration adds
-- the sync, and withdraws the one grant that let a user session set the copy by
-- hand.
--
-- D-11: the application NEVER writes auth.users. The only writer of
-- auth.users.email is Supabase Auth. The trigger below runs AFTER Auth wrote the
-- address, and copies the confirmed value into the derived profiles column. That
-- is the whole mechanism; an app-side write in /auth/callback stays ruled out.
--
--   1. public.sync_profile_email_from_auth()   trigger function, SECURITY DEFINER with
--                                              a pinned search_path, EXECUTE revoked
--                                              from PUBLIC, anon and authenticated.
--   2. on_auth_user_email_updated              AFTER-UPDATE row trigger on auth.users,
--                                              limited to the email column.
--   3. column privilege                        authenticated loses UPDATE on
--                                              public.profiles.email (D-07).
--
-- Decisions
--   D-06  ONE guard only, in the function body: the copy is written only when the
--         new address differs from the old one. The trigger carries no WHEN clause;
--         two guards would mask each other and the "unchanged address writes nothing"
--         arm of the gate could not bite when either was removed.
--   D-06  The function does nothing while quantalyze.sanitize_in_progress is on.
--         sanitize_user (account erasure) sets that setting for its transaction and
--         then NULLs auth.users.email; without the early return this trigger would
--         write the NULL into profiles.email and fight the erasure it belongs to.
--   D-07  The column revoke is conditional on a writer proof, re-run at HEAD by the
--         plan executor: no client or user-session path writes profiles.email (the
--         two client writers, ProfileForm and OnboardingWizard, never send it; the
--         admin partner-import writes it as service_role; sanitize_user and
--         handle_new_user are definer functions). The proof is pasted in the plan
--         SUMMARY. The grant being withdrawn is the COLUMN-level one that
--         20260529150000_lock_profile_privileged_columns.sql re-granted, so this
--         revoke removes a real privilege (the table-level case it warns about does
--         not apply).
--   A1    EXECUTE on a trigger function is checked when CREATE TRIGGER runs, not
--         when the trigger fires, so withdrawing it from the roles that never
--         create this trigger cannot stop Auth's own write from syncing. The gate
--         proves it (arm 1b) with a role that holds no EXECUTE.
--   No backfill. The measured gap is nil (0 of 38 production profiles differ from
--   their auth email), and a data-writing step would behave differently on the
--   data-empty shared TEST database.
--
-- Cited and NOT replaced: handle_new_user (latest definition
-- 20260520222848_lock_profile_role_at_signup.sql) and sanitize_user (latest
-- definition 20260827130000_sanitize_user_revoke_strategy_shares.sql). This file
-- changes neither, so the rule to re-base on the latest definition of a replaced
-- function is met vacuously. One new function is created; no existing one is
-- replaced.
--
-- Why this does not fight the profiles triggers: the function is SECURITY DEFINER,
-- so current_user inside it is the function owner. reject_sentinel_writes returns
-- early unless current_user is authenticated or anon, and
-- prevent_profile_privileged_change fires only on an UPDATE of the six privileged
-- columns, which email is not. profiles.email carries no unique constraint, so the
-- copy cannot raise a unique violation that would abort Auth's own transaction.
--
-- Reaches TEST and then PROD only through Supabase Migrate on merge (apply-test,
-- then the PROD apply, which now runs with no human gate). Nothing here is applied
-- by hand.
--
-- Transaction style: NO explicit transaction statements (migration-reviewer
-- invariant 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to
-- that wrap.
--
-- Rollback (manual, off the auto-apply path; no data is touched):
-- supabase/migrations/down/20261119120000-rollback.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1 - the trigger function. SECURITY DEFINER because Auth's role cannot
-- write profiles.email; the pinned search_path and the schema-qualified table
-- keep a hijacked search_path from redirecting the write.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF current_setting('quantalyze.sanitize_in_progress', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.sync_profile_email_from_auth() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.sync_profile_email_from_auth() IS
  'Phase 219 ACCOUNTEMAIL (D-06). Copies a changed auth.users.email into the derived public.profiles.email for the same id. Skips an unchanged address and skips entirely while quantalyze.sanitize_in_progress is on, so account erasure is never fought. Runs with its owner''s rights and a pinned search_path; EXECUTE revoked from PUBLIC, anon and authenticated (a trigger function is checked at CREATE TRIGGER, not at fire time).';

-- --------------------------------------------------------------------------
-- STEP 2 - the trigger, limited to the email column so an unrelated update of
-- auth.users (last sign-in, tokens) never reaches the function.
-- --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email_from_auth();

-- --------------------------------------------------------------------------
-- STEP 3 - D-07: a user session may no longer write the derived copy. The
-- other columns of the 20260529150000 allowlist stay writable.
-- --------------------------------------------------------------------------
REVOKE UPDATE (email) ON public.profiles FROM authenticated;

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read. Asserted: the function and the trigger resolve by name.
-- Deliberately NOT asserted here: the function body, the trigger's column list,
-- the grants and the privilege on profiles.email. A verify block that checked
-- them would abort the apply of a mutated copy of this file, and the SQL gate
-- that mutates those lines needs that apply to succeed in order to go RED on
-- the behaviour instead.
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                   JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public'
                    AND p.proname = 'sync_profile_email_from_auth') THEN
    RAISE EXCEPTION 'Migration 20261119120000 failed: public.sync_profile_email_from_auth() is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'on_auth_user_email_updated'
                    AND tgrelid = 'auth.users'::regclass
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Migration 20261119120000 failed: trigger on_auth_user_email_updated is missing on auth.users';
  END IF;

  RAISE NOTICE 'Migration 20261119120000: public.sync_profile_email_from_auth() and its trigger on auth.users exist.';
END
$verify$;
