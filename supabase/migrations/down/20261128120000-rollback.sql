-- ============================================================================
-- ROLLBACK for 20261128120000_compute_job_seed_hold.sql
-- Phase 257 SEEDHOLD, plan 02 (founder ruling 2026-11-28).
-- ============================================================================
-- Manual, off the auto-apply path: CI does not apply rollbacks, and nothing runs
-- this file unless a person does, after the marker query in CLAUDE.md has named
-- the database.
--
-- WHAT IT UNDOES. It drops public.set_compute_job_seed_hold(uuid, uuid, bigint),
-- the claim-token-fenced writer of the seed-hold mark in compute_jobs.metadata.
-- It touches no table, no policy and no other function, because the migration
-- changed none.
--
-- CALLERS FIRST. Revert the caller (the analytics worker's run_sync_trades_job,
-- the later plan of this phase) BEFORE running this file. A worker whose RPC has
-- vanished logs the failed seed-hold write at ERROR and carries on; that is the
-- named double-fault residual while the re-read bound RPC is also down. The order
-- is about noise, not about data loss.
--
-- WHAT ROLLING BACK COSTS. No data changes: seed-hold marks already written stay on
-- their job rows (a key of compute_jobs.metadata) and age out with the 30-day
-- `done` reaper. A next run that still reads such a mark keeps honouring it.
--
-- THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20261128120000 as applied while the function no longer exists.
-- `supabase db push` will therefore NOT re-apply the migration. To re-apply it,
-- delete that ledger row in the same change that re-applies it (or mark it
-- reverted with `supabase migration repair --status reverted 20261128120000`
-- against the intended database, after the marker query in CLAUDE.md names that
-- database). Until then VAC-08's ledger check reports the version as present,
-- which is true of the ledger and false of the function.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.set_compute_job_seed_hold(uuid, uuid, bigint);

-- Catalogue-only check: the function is gone.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE proname = 'set_compute_job_seed_hold'
                AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'Rollback 20261128120000: set_compute_job_seed_hold still exists after the DROP';
  END IF;
  RAISE NOTICE 'Rollback 20261128120000: set_compute_job_seed_hold dropped.';
END $$;

COMMIT;
