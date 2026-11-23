-- ============================================================================
-- ROLLBACK for 20261124120400_first_hop_enqueue_sweep.sql
-- Phase 227 JOBLEDGER, plan 05 (HEAL-01).
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
-- NULL, re-set it before running anything here.
--
-- ⛔ REMOVE THE REGISTERED JOB FIRST. If the hourly job was registered by
-- docs/runbooks/jobledger-go-live.md, run that runbook's Rollback section BEFORE this
-- file. Dropping the function while the job is still registered leaves a job that
-- fails every hour. The precondition below refuses to run while a job still names the
-- function, so the order is enforced rather than remembered.
--
-- What this file undoes:
--   1. Drops the function public.first_hop_enqueue_sweep().
--   2. Revokes every privilege on public.first_hop_enqueue_retries and RENAMES the
--      table aside with a dated suffix. The table is not dropped: it holds the
--      once-only record of which strategies were re-enqueued, which is evidence.
--
-- ⚠️ NAMED-STATE ROWS ALREADY WRITTEN STAY. A strategy the sweep showed the failed
-- state to keeps that strategy_analytics row; it is user-visible history and the
-- user's own retry path (the existing re-sync) overwrites it the normal way. Compute
-- jobs the sweep inserted (metadata source first-hop-sweep) stay too.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261124120400 as applied while the schema no longer carries it, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that
-- ledger row in the same change and drop the renamed-aside table first (or mark the
-- version reverted with `supabase migration repair --status reverted 20261124120400`
-- against the intended database, after the marker query above names that database).
--
-- Both DO blocks read catalogues only. The one row read is cron.job, pg_cron's own
-- registry, to refuse while a job still names the function; no application table is read.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY
DO $precondition$
BEGIN
  IF to_regprocedure('public.first_hop_enqueue_sweep()') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120400 refused: public.first_hop_enqueue_sweep() is not present, so this database does not carry 20261124120400. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
  IF to_regclass('public.first_hop_enqueue_retries') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120400 refused: public.first_hop_enqueue_retries is not present, so there is nothing to rename aside and the migration is only half applied. Nothing was changed.';
  END IF;
  -- A still-registered job would fail every hour once the function is gone. The
  -- cron schema may be absent on a database without pg_cron, so test for it.
  IF to_regclass('cron.job') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job j WHERE j.command ILIKE '%first_hop_enqueue_sweep%') THEN
      RAISE EXCEPTION 'Rollback 20261124120400 refused: a pg_cron job still names first_hop_enqueue_sweep. Remove it first with the Rollback section of docs/runbooks/jobledger-go-live.md, then re-run this file. Nothing was changed.';
    END IF;
  END IF;
END
$precondition$;

DROP FUNCTION IF EXISTS public.first_hop_enqueue_sweep();

REVOKE ALL ON public.first_hop_enqueue_retries FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.first_hop_enqueue_retries
  RENAME TO first_hop_enqueue_retries_rolled_back_20261124;

-- ───────────── postcondition — CATALOGUE ONLY
DO $postcondition$
BEGIN
  IF to_regprocedure('public.first_hop_enqueue_sweep()') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120400 failed: public.first_hop_enqueue_sweep() still resolves after DROP FUNCTION. The whole rollback is aborted.';
  END IF;
  IF to_regclass('public.first_hop_enqueue_retries') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120400 failed: public.first_hop_enqueue_retries still resolves after the rename. The whole rollback is aborted.';
  END IF;
END
$postcondition$;
