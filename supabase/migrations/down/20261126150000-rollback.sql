-- ============================================================================
-- ROLLBACK for 20261126150000_strategy_fills_reread_bound.sql
-- Phase 253 BINANCECURSOR.
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
--   1. DROP FUNCTION public.set_strategy_fills_reread_bound(uuid, uuid, uuid, uuid, timestamptz, timestamptz)
--   2. DROP TABLE public.strategy_fills_reread_bounds (its deny-all policy and grants go with it)
--
-- ⚠️ DATA LOSS. Every pending bound is lost. A strategy whose Binance fills read stopped
-- below a per-key column that is ahead of its own fills may again seed past a span it never
-- read, and no later run re-reads it. Run this only if that is the intended state. The
-- analytics worker (phase 253 plan 02 onwards) calls the function from its sync_trades
-- epilogue; roll that code back first, or its calls fail with 42883 into its fail-open branch.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261126150000 as applied while the objects are gone, and `supabase db push`
-- will not re-apply the migration. To re-apply it, delete that ledger row in the same
-- change (or mark it reverted with
-- `supabase migration repair --status reverted 20261126150000` against the intended
-- database, after the marker query above names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that carries neither object. The DO block after the
-- change is catalogue-only too and aborts the whole rollback if either object remains.
-- Neither reads a row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.set_strategy_fills_reread_bound(uuid,uuid,uuid,uuid,timestamptz,timestamptz)') IS NULL
     AND to_regclass('public.strategy_fills_reread_bounds') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261126150000 refused: neither public.set_strategy_fills_reread_bound nor public.strategy_fills_reread_bounds is present. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

DROP FUNCTION IF EXISTS public.set_strategy_fills_reread_bound(uuid, uuid, uuid, uuid, timestamptz, timestamptz);
DROP TABLE IF EXISTS public.strategy_fills_reread_bounds;

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF to_regprocedure('public.set_strategy_fills_reread_bound(uuid,uuid,uuid,uuid,timestamptz,timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261126150000 failed: public.set_strategy_fills_reread_bound still exists';
  END IF;
  IF to_regclass('public.strategy_fills_reread_bounds') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261126150000 failed: public.strategy_fills_reread_bounds still exists';
  END IF;

  RAISE NOTICE 'Rollback 20261126150000: the re-read bound function and table are gone. Every pending bound was lost. The migration ledger row is left in place (see the header).';
END
$verify$;
