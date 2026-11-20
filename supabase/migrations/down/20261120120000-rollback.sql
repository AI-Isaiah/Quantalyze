-- ============================================================================
-- ROLLBACK for 20261120120000_auth_user_has_password.sql
-- Phase 219 ACCOUNTEMAIL, gap closure plan 04 (GD-05a).
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
--   1. Drops the function public.auth_user_has_password(uuid), and with it the
--      service_role EXECUTE grant it carried.
--
-- ⚠️ NO DATA IS TOUCHED. After this file runs, the change-email route's call to
-- the function fails, so the route answers every failed password check with a 502
-- until a fix ships, because its RPC is gone. Run it only if that is the intended state.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261120120000 as applied while the schema no longer carries it, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that
-- ledger row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261120120000` against the intended
-- database, after the marker query above names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that does not carry the migration. The DO block after
-- the change is catalogue-only too and aborts the whole rollback if the function still
-- resolves. Neither reads a row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.auth_user_has_password(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261120120000 refused: public.auth_user_has_password(uuid) is not present, so this database does not carry 20261120120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

DROP FUNCTION IF EXISTS public.auth_user_has_password(uuid);

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF to_regprocedure('public.auth_user_has_password(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261120120000 failed: public.auth_user_has_password(uuid) still resolves';
  END IF;

  RAISE NOTICE 'Rollback 20261120120000: public.auth_user_has_password(uuid) is dropped. No data was touched. The migration ledger row is left in place (see the header).';
END
$verify$;
