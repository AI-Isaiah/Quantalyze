-- ============================================================================
-- ROLLBACK for 20261028120000_replace_allocator_equity_snapshots_window.sql
-- Phase 167.2.1.1.2 ACCTREBUILD, plan 01 (SC-1, SC-2, SC-4).
-- ============================================================================
-- Manual, off the auto-apply path. What it removes:
--   1. DROPs public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date)
--      and nothing else. Run it only after the analytics worker that calls it (the
--      forced reconstruct of plans 06-08 of this phase) has been rolled back, or every
--      forced rebuild fails with "function does not exist".
--   2. Leaves public.replace_allocator_equity_snapshots(uuid, jsonb, integer) exactly
--      as it is. The migration never touched it, and the verify block below aborts
--      the whole rollback if it is gone.
--
-- ⚠️ DATA IS KEPT. The allocator_equity_snapshots rows the function rebuilt and every
-- snapshot_rebuild_boundary row it wrote to allocator_equity_derived stay where they
-- are. A rebuilt day may already count in what an allocator sees, so removing them is a
-- founder decision, not part of this file.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261028120000 as applied while the schema no longer carries it, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that
-- ledger row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261028120000` against the intended
-- database, after the marker query in CLAUDE.md names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that does not carry the migration. The DO block
-- after it is catalogue-only too and aborts the whole rollback if the function
-- survives or the older replace is gone. Neither reads a row.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.replace_allocator_equity_snapshots_window(uuid,jsonb,integer,date)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261028120000 refused: public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date) is not present, so this database does not carry 20261028120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

-- 1. The function: nothing else depends on it.
DROP FUNCTION IF EXISTS public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date);

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF to_regprocedure('public.replace_allocator_equity_snapshots_window(uuid,jsonb,integer,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261028120000 failed: replace_allocator_equity_snapshots_window survives';
  END IF;
  IF to_regprocedure('public.replace_allocator_equity_snapshots(uuid,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261028120000 failed: public.replace_allocator_equity_snapshots(uuid, jsonb, integer) is gone';
  END IF;

  RAISE NOTICE 'Rollback 20261028120000: replace_allocator_equity_snapshots_window is gone and replace_allocator_equity_snapshots is still in place. Rebuilt snapshot rows and snapshot_rebuild_boundary rows are kept, and the migration ledger row is left in place (see the header).';
END
$verify$;

COMMIT;
