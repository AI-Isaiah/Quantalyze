-- ============================================================================
-- ROLLBACK for 20261123180100_swap_account_slot.sql
-- Phase 225 ONEACCOUNTONCE, plan 04 (MT5D-08, founder ruling Q1).
-- ============================================================================
-- Manual, off the auto-apply path. Run it as ONE transaction (this file carries no
-- transaction statements, like a migration):
--
--   psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
--
-- against the database the marker query in CLAUDE.md names. Run that query FIRST:
--
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
--
-- current_database() is `postgres` on BOTH projects and proves nothing; if the marker is
-- NULL, re-set it before running anything here.
--
-- What this file undoes: DROPs public.swap_account_slot(uuid, uuid, text, text). The
-- function writes only through the existing columns, so no data is involved and nothing
-- is restored. Rows it already moved (a stamp on a new key, a 'duplicate' marker on an
-- old holder) are ordinary data and stay as they are.
--
-- ⚠️ ROLL THE CODE BACK FIRST. Once a connect route or the identity stamper calls the
-- function, dropping it makes that call fail (PGRST202). Revert the callers, then run this.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so `supabase db push` will not re-apply
-- 20261123180100 afterwards. To re-apply it, delete that ledger row in the same change
-- (or `supabase migration repair --status reverted 20261123180100` against the intended
-- database, after the marker query names it).
--
-- The DO block after the DROP is a catalogue-only verify. It reads no row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

DROP FUNCTION public.swap_account_slot(uuid, uuid, text, text);

DO $verify$
BEGIN
  IF to_regprocedure('public.swap_account_slot(uuid,uuid,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261123180100: swap_account_slot is still present after the DROP';
  END IF;
  RAISE NOTICE 'Rollback 20261123180100: swap_account_slot removed (catalogue verified).';
END
$verify$;
