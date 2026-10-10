-- ============================================================================
-- ROLLBACK for 20261010130000_strategy_analytics_trade_fetch_provenance.sql
-- Phase 167.1.2.2.2 TRADESYNC, plan 02 (SC-4, D-02, D-03, D-07, D-08).
-- ============================================================================
-- ⛔ ROLL THE READERS BACK FIRST. Code from plans 05 (the cron stamp), 09, 10, 11
-- and 22 reads or writes trades_fetched_at and series_provenance. Dropping a
-- column under a deployed reader makes a PostgREST select that names it fail the
-- WHOLE query (42703 / PGRST204), which would break the public list pages.
-- Revert and DEPLOY those readers before this runs.
--
-- Manual, off the auto-apply path. What it drops: the
-- strategy_analytics_series_provenance_is_object CHECK and the two columns
-- trades_fetched_at and series_provenance.
--
-- ⚠️ DATA: every stored fetch instant and every provenance range record is LOST
-- with the columns. trades_fetched_at refills on the next cron tick;
-- series_provenance is runbook-written and must be re-written by hand.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20261010130000 as applied while the schema no longer carries
-- it. `supabase db push` will therefore NOT re-apply the migration. To re-apply
-- it, delete that ledger row in the same change that re-applies it (or mark it
-- reverted with `supabase migration repair --status reverted 20261010130000`
-- against the intended database, after the marker query in CLAUDE.md names that
-- database). Until then VAC-08's ledger check reports the version as present,
-- which is true of the ledger and false of the schema.
--
-- The DO block at the top is a catalogue-only PRECONDITION: it RAISEs, before any
-- DROP runs, unless both columns the migration added exist. Every DROP below is
-- IF EXISTS, so without it this file run against a database that never had
-- 20261010130000 would drop nothing and still report success.
--
-- The DO block at the end is catalogue-only: it RAISEs, and so aborts the whole
-- rollback, if either column or the constraint survives.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['trades_fetched_at', 'series_provenance']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_attribute
      WHERE attrelid = 'public.strategy_analytics'::regclass
        AND attname = c
        AND NOT attisdropped
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261010130000 refused: strategy_analytics lacks column(s) % that the migration adds, so this database does not carry 20261010130000. Nothing was dropped. Run the marker query in CLAUDE.md to see which database this is.', v_missing;
  END IF;
END
$precondition$;

ALTER TABLE public.strategy_analytics
  DROP CONSTRAINT IF EXISTS strategy_analytics_series_provenance_is_object;

ALTER TABLE public.strategy_analytics
  DROP COLUMN IF EXISTS trades_fetched_at,
  DROP COLUMN IF EXISTS series_provenance;

-- ───────────── verify — CATALOGUE ONLY
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.strategy_analytics'::regclass
       AND attname IN ('trades_fetched_at', 'series_provenance')
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Rollback 20261010130000 failed: trades_fetched_at or series_provenance survives on strategy_analytics';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.strategy_analytics'::regclass
       AND conname = 'strategy_analytics_series_provenance_is_object'
  ) THEN
    RAISE EXCEPTION 'Rollback 20261010130000 failed: constraint strategy_analytics_series_provenance_is_object survives';
  END IF;

  RAISE NOTICE 'Rollback 20261010130000: both columns and the object CHECK are gone. The migration ledger row is left in place (see the header).';
END
$verify$;

COMMIT;
