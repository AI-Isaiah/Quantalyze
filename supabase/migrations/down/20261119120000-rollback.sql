-- ============================================================================
-- ROLLBACK for 20261119120000_sync_profile_email_from_auth.sql
-- Phase 219 ACCOUNTEMAIL, plan 01 (D-06, D-07).
-- ============================================================================
-- Manual, off the auto-apply path. Run it as ONE transaction, so it either happens
-- whole or not at all (this file carries no transaction statements, like a migration):
--
--   psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
--
-- against the database the marker query in CLAUDE.md names. Run that query FIRST:
--
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
--
-- current_database() is `postgres` on BOTH projects and proves nothing; if the marker is
-- NULL, re-set it before running anything here. What this file undoes:
--   1. Drops the trigger on_auth_user_email_updated from auth.users.
--   2. Drops the trigger function public.sync_profile_email_from_auth().
--   3. Re-grants UPDATE on the email column of public.profiles to authenticated, the
--      column-level grant that 20260529150000_lock_profile_privileged_columns.sql
--      created and the migration withdrew.
--
-- ⚠️ NO DATA IS TOUCHED. profiles.email keeps whatever value the trigger last wrote. After
-- this file runs, a confirmed email change in Supabase Auth no longer reaches
-- profiles.email, and a user session can write that column again. Run it only if that is
-- the intended state (the sync is what the account-email UI depends on).
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261119120000 as applied while the schema no longer carries it, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that
-- ledger row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261119120000` against the intended
-- database, after the marker query above names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that does not carry the migration. The DO block after
-- the change is catalogue-only too and aborts the whole rollback if the function or the
-- trigger still resolves. Neither reads a row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.sync_profile_email_from_auth()') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261119120000 refused: public.sync_profile_email_from_auth() is not present, so this database does not carry 20261119120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'on_auth_user_email_updated'
                    AND tgrelid = 'auth.users'::regclass
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Rollback 20261119120000 refused: trigger on_auth_user_email_updated is not present on auth.users. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
DROP FUNCTION IF EXISTS public.sync_profile_email_from_auth();

-- Restores the column grant of 20260529150000 section 1b.
GRANT UPDATE (email) ON public.profiles TO authenticated;

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF to_regprocedure('public.sync_profile_email_from_auth()') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261119120000 failed: public.sync_profile_email_from_auth() still resolves';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgname = 'on_auth_user_email_updated'
                AND tgrelid = 'auth.users'::regclass
                AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Rollback 20261119120000 failed: trigger on_auth_user_email_updated still exists on auth.users';
  END IF;

  RAISE NOTICE 'Rollback 20261119120000: the email sync trigger and its function are dropped and authenticated may update profiles.email again. No data was touched. The migration ledger row is left in place (see the header).';
END
$verify$;
