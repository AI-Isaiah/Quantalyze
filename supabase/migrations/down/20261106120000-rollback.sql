-- ============================================================================
-- ROLLBACK for 20261106120000_refusalrace_metadata_merge_rpcs.sql
-- Phase 191 REFUSALRACE, plan 02 (D-01, D-03, D-07).
-- ============================================================================
-- Manual, off the auto-apply path: CI does not apply rollbacks, and nothing runs
-- this file unless a person does, after the marker query in CLAUDE.md has named
-- the database.
--
-- WHAT IT UNDOES. It drops public.mark_compute_job_kept_figures(uuid) and
-- public.retract_ledger_refresh_marker(uuid, text), the two single-statement
-- writers of compute_jobs.metadata. It touches no table, no policy and no other
-- function, because the migration changed none.
--
-- CALLERS FIRST. Revert the PR-2 caller PR (the Python worker, the Python
-- long-fetch tail and the TypeScript retraction helper) BEFORE running this file.
-- A caller whose RPC has vanished fails loud: the refusal marker write then fails
-- the job TRANSIENT (the refusal path retries), and the retraction fails logged and
-- non-fatal. The order is about noise and retries, not about data loss.
--
-- WHAT ROLLING BACK COSTS. The two writers go back to reading the whole metadata
-- object and writing it back, which reopens the lost-update race this phase closed.
-- No data changes: markers already written stay on their rows.
--
-- THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20261106120000 as applied while the functions no longer exist.
-- `supabase db push` will therefore NOT re-apply the migration. To re-apply it,
-- delete that ledger row in the same change that re-applies it (or mark it
-- reverted with `supabase migration repair --status reverted 20261106120000`
-- against the intended database, after the marker query in CLAUDE.md names that
-- database). Until then VAC-08's ledger check reports the version as present,
-- which is true of the ledger and false of the functions.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.mark_compute_job_kept_figures(uuid);
DROP FUNCTION IF EXISTS public.retract_ledger_refresh_marker(uuid, text);

-- Catalogue-only check: both functions are gone.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE proname IN ('mark_compute_job_kept_figures', 'retract_ledger_refresh_marker')
                AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'Rollback 20261106120000: a metadata merge function still exists after the DROP';
  END IF;
  RAISE NOTICE 'Rollback 20261106120000: mark_compute_job_kept_figures and retract_ledger_refresh_marker dropped.';
END $$;

COMMIT;
