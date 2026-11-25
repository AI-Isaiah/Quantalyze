-- ============================================================================
-- ROLLBACK for 20261124120600_orphan_reaped_attempt_record.sql
-- Phase 227 JOBLEDGER, plan 07 (MT5D-01).
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
-- NULL, re-set it before running anything here. What this file undoes, in order:
--   1. DROPS the trigger compute_jobs_record_orphan_reaped_attempt on public.compute_jobs.
--   2. DROPS public.record_orphan_reaped_attempt().
--
-- ⚠️ DATA IS KEPT (the keep-data rule). Ledger rows with cause_class orphan_reaped that the
-- trigger already wrote stay in public.compute_job_attempt_failures. Nothing here touches
-- that table. After this file runs, a reaped orphan is no longer recorded, and the
-- terminalizer (whose cron command this plan never changed) keeps running exactly as before.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records version
-- 20261124120600 as applied while the schema no longer carries it, and `supabase db push`
-- will not re-apply the migration. To re-apply it, delete that ledger row in the same change
-- (or mark it reverted with `supabase migration repair --status reverted 20261124120600`
-- against the intended database, after the marker query above names that database).
--
-- Order against the other plans of phase 227: this file only removes the orphan_reaped
-- writer, so it can run before or after the plan 01 rollback. If the plan 01 rollback ran
-- first, the ledger table is already renamed aside and the trigger would have failed every
-- terminalizer reap on the missing table; run this one FIRST in that case.
--
-- The DO blocks are catalogue-only (no table row is read): the precondition refuses, before
-- anything changes, on a database that does not carry the trigger; the postcondition aborts
-- the whole rollback if the trigger or the function still resolves.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.record_orphan_reaped_attempt()') IS NULL THEN
    RAISE EXCEPTION 'rollback 20261124120600: public.record_orphan_reaped_attempt() does not exist, so this database does not carry the migration (or it was already rolled back). Nothing was changed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = to_regclass('public.compute_jobs')
       AND t.tgname = 'compute_jobs_record_orphan_reaped_attempt'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'rollback 20261124120600: the trigger compute_jobs_record_orphan_reaped_attempt does not exist on public.compute_jobs, so this database does not carry the migration (or it was already rolled back). Nothing was changed.';
  END IF;
END
$precondition$;

-- ───────────── the change
DROP TRIGGER compute_jobs_record_orphan_reaped_attempt ON public.compute_jobs;
DROP FUNCTION public.record_orphan_reaped_attempt();

-- ───────────── postcondition — CATALOGUE ONLY, reads no row
DO $postcondition$
BEGIN
  IF to_regprocedure('public.record_orphan_reaped_attempt()') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 20261124120600: public.record_orphan_reaped_attempt() still resolves after the rollback, so the whole rollback is aborted.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = to_regclass('public.compute_jobs')
       AND t.tgname = 'compute_jobs_record_orphan_reaped_attempt'
  ) THEN
    RAISE EXCEPTION 'rollback 20261124120600: the trigger compute_jobs_record_orphan_reaped_attempt still exists after the rollback, so the whole rollback is aborted.';
  END IF;
END
$postcondition$;
