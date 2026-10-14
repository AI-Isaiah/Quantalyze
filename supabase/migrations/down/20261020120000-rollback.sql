-- ============================================================================
-- ROLLBACK for 20261020120000_ops_staleness_check.sql
-- Phase 164.6.8 OUTAGEALERT, plan 05 (added after plan 02 shipped the migration
-- without one; D-10, D-11).
-- ============================================================================
-- ⛔ UNSCHEDULE THE PG_CRON JOB FIRST, if it has been registered. The migration
-- itself registers nothing; the registration is a live operation recorded in
-- docs/runbooks/ops-staleness-go-live.md, and its rollback section is the
-- statement that removes the job (plus the manifest re-capture). Dropping the
-- function under a live job makes that job error on every tick
-- (`undefined_function` in cron.job_run_details) rather than do nothing.
--
-- Manual, off the auto-apply path: CI does not apply rollbacks, and nothing runs
-- this file unless a person does, after the marker query in CLAUDE.md has named
-- the database. What it drops: public.ops_staleness_check(). The migration
-- creates nothing else (the COMMENT and the REVOKE go with the function).
--
-- ⚠️ DATA: nothing is deleted. The observer rows the function wrote to
-- public.cron_runs under cron_name = 'ops_staleness_check' are LEFT IN PLACE:
-- they are evidence of what the alarm judged and when, and no foreign key points
-- at them. Remove them by hand only if you mean to.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20261020120000 as applied while the schema no longer carries
-- it. `supabase db push` will therefore NOT re-apply the migration. To re-apply
-- it, delete that ledger row in the same change that re-applies it (or mark it
-- reverted with `supabase migration repair --status reverted 20261020120000`
-- against the intended database, after the marker query in CLAUDE.md names that
-- database). Until then VAC-08's ledger check reports the version as present,
-- which is true of the ledger and false of the schema.
--
-- The DO block at the top is a catalogue-only PRECONDITION: it RAISEs, before the
-- DROP runs, unless the function exists. DROP ... IF EXISTS alone would report
-- success on a database that never carried the migration. The DO block at the end
-- is catalogue-only: it RAISEs, and so aborts the whole rollback, if the function
-- survives under any signature.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.ops_staleness_check()') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261020120000 refused: public.ops_staleness_check() does not exist, so this database does not carry 20261020120000. Nothing was dropped. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

-- No CASCADE: if anything depends on the function, the DROP must fail loud
-- rather than take the dependant with it.
DROP FUNCTION public.ops_staleness_check();

-- ───────────── verify — CATALOGUE ONLY
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'ops_staleness_check'
  ) THEN
    RAISE EXCEPTION 'Rollback 20261020120000 failed: a public.ops_staleness_check function survives';
  END IF;

  RAISE NOTICE 'Rollback 20261020120000: public.ops_staleness_check is gone. Observer rows in public.cron_runs and the migration ledger row are left in place (see the header).';
END
$verify$;

COMMIT;
