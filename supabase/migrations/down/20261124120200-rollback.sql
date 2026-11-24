-- ============================================================================
-- ROLLBACK for 20261124120200_compute_job_claim_renewal.sql
-- Phase 227 JOBLEDGER, plan 03 (HEAL-02).
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
-- What this file undoes: it drops public.renew_compute_job_claims(uuid[], uuid[]). The
-- function owns no table, row or persisted state, so there is nothing to keep. Rows it
-- renewed keep their moved claimed_at, which is an ordinary running-row timestamp.
--
-- ORDER WITH THE WORKER. This file does NOT need the analytics worker rolled back first.
-- Plan 08's worker treats a missing function (SQLSTATE 42883, or the PostgREST spelling
-- PGRST202 for a function absent from its schema cache) as "dispatch as today", i.e. it
-- stops renewing and relies on each row's own watchdog threshold, which is the behaviour
-- before this phase.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261124120200 as applied while the schema no longer carries the function, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that ledger
-- row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261124120200` against the intended
-- database, after the marker query above names that database).
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.renew_compute_job_claims(uuid[],uuid[])') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120200 refused: public.renew_compute_job_claims(uuid[], uuid[]) is not present, so this database does not carry 20261124120200. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

DROP FUNCTION public.renew_compute_job_claims(uuid[], uuid[]);

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF to_regprocedure('public.renew_compute_job_claims(uuid[],uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120200 failed: public.renew_compute_job_claims(uuid[], uuid[]) still resolves';
  END IF;

  RAISE NOTICE 'Rollback 20261124120200: public.renew_compute_job_claims(uuid[], uuid[]) dropped. The migration ledger row is left in place (see the header).';
END
$verify$;
