-- ============================================================================
-- ROLLBACK for 20261124120300_reconcile_readmit_exhaustions.sql
-- Phase 227 JOBLEDGER, plan 04 (HEAL-03).
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
--   1. Drops the function public.record_reconcile_readmit_exhaustions(), and with it the
--      service_role EXECUTE grant it carried.
--   2. Revokes every privilege on public.reconcile_readmit_exhaustions from service_role.
--   3. RENAMES the table and its constraints aside with a dated suffix. It does NOT drop
--      the table: the rows are the durable record of which strategies the platform gave up
--      on, and they outlive the job rows they came from, so a rollback must not be the
--      thing that deletes them. Drop the renamed table by hand once the rows are no longer
--      wanted.
--
-- ⚠️ ROLL BACK PLAN 09'S READER FIRST. That reader calls the function and reads the table;
-- once this file has run, it logs the missing relation on every pass until it is rolled
-- back too.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261124120300 as applied while the schema no longer carries it, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that ledger
-- row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261124120300` against the intended
-- database, after the marker query above names that database), and drop the renamed
-- table first, because the migration's plain CREATE TABLE does not tolerate an existing
-- table of its name.
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that does not carry the migration. The DO block after
-- the change is catalogue-only too and aborts the whole rollback if the function still
-- resolves or the table still answers to its original name. Neither reads a row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.record_reconcile_readmit_exhaustions()') IS NULL
     OR to_regclass('public.reconcile_readmit_exhaustions') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120300 refused: public.record_reconcile_readmit_exhaustions() or public.reconcile_readmit_exhaustions is not present, so this database does not carry 20261124120300. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
  IF to_regclass('public.reconcile_readmit_exhaustions_rolled_back_20261124') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120300 refused: public.reconcile_readmit_exhaustions_rolled_back_20261124 already exists, so a previous rollback left its renamed table behind. Nothing was changed. Drop or rename it by hand first.';
  END IF;
END
$precondition$;

DROP FUNCTION IF EXISTS public.record_reconcile_readmit_exhaustions();

REVOKE ALL ON TABLE public.reconcile_readmit_exhaustions FROM service_role;

ALTER TABLE public.reconcile_readmit_exhaustions
  RENAME CONSTRAINT reconcile_readmit_exhaustions_marker_count_chk
  TO reconcile_readmit_exhaustions_marker_count_chk_rb20261124;
ALTER TABLE public.reconcile_readmit_exhaustions
  RENAME CONSTRAINT reconcile_readmit_exhaustions_strategy_generation_uq
  TO reconcile_readmit_exhaustions_strategy_generation_uq_rb20261124;
ALTER TABLE public.reconcile_readmit_exhaustions
  RENAME CONSTRAINT reconcile_readmit_exhaustions_pkey
  TO reconcile_readmit_exhaustions_pkey_rb20261124;
ALTER TABLE public.reconcile_readmit_exhaustions
  RENAME TO reconcile_readmit_exhaustions_rolled_back_20261124;

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF to_regprocedure('public.record_reconcile_readmit_exhaustions()') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120300 failed: public.record_reconcile_readmit_exhaustions() still resolves';
  END IF;
  IF to_regclass('public.reconcile_readmit_exhaustions') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120300 failed: public.reconcile_readmit_exhaustions still answers to its original name';
  END IF;
  IF to_regclass('public.reconcile_readmit_exhaustions_rolled_back_20261124') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120300 failed: the renamed table public.reconcile_readmit_exhaustions_rolled_back_20261124 is missing';
  END IF;
  IF has_table_privilege('service_role', 'public.reconcile_readmit_exhaustions_rolled_back_20261124'::regclass, 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Rollback 20261124120300 failed: service_role still holds a privilege on the renamed table';
  END IF;

  RAISE NOTICE 'Rollback 20261124120300: the function is dropped and the table is renamed to reconcile_readmit_exhaustions_rolled_back_20261124 with its rows intact. The migration ledger row is left in place (see the header).';
END
$verify$;
