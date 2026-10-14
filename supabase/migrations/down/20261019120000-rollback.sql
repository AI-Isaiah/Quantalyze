-- ============================================================================
-- ROLLBACK for 20261019120000_get_published_trade_venues.sql
-- Phase 170.6.1 DISCOVERYPHONE, plan 01 (SC-2, D-04, D-08).
-- ============================================================================
-- Manual, off the auto-apply path: CI does not apply rollbacks, and nothing runs
-- this file unless a person does, after the marker query in CLAUDE.md has named
-- the database.
--
-- WHAT IT UNDOES. It drops public.get_published_trade_venues(uuid[]), the
-- published-only primitive that names the venue a strategy's trades come from. It
-- touches no table, no policy and no grant on api_keys or strategy_keys, because
-- the migration changed none.
--
-- READERS FIRST. Revert the PR-B reader (readPublishedTradeVenues, plan 04) BEFORE
-- running this file. The reader degrades to the listed exchange when the function
-- is missing, so dropping the function never breaks a page; the order is about
-- logs (a reader calling a missing function logs a degradation on every request),
-- not about breakage.
--
-- WHAT ROLLING BACK COSTS. Discovery goes back to labelling a row from
-- supported_exchanges[1], the exchange the manager listed, instead of the
-- exchange of the key the trades come from. No data changes.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20261019120000 as applied while the function no longer exists.
-- `supabase db push` will therefore NOT re-apply the migration. To re-apply it,
-- delete that ledger row in the same change that re-applies it (or mark it
-- reverted with `supabase migration repair --status reverted 20261019120000`
-- against the intended database, after the marker query in CLAUDE.md names that
-- database). Until then VAC-08's ledger check reports the version as present,
-- which is true of the ledger and false of the function.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.get_published_trade_venues(uuid[]);

-- Catalogue-only check: the function is gone.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE proname = 'get_published_trade_venues'
                AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'Rollback 20261019120000: get_published_trade_venues still exists after the DROP';
  END IF;
  RAISE NOTICE 'Rollback 20261019120000: get_published_trade_venues dropped.';
END $$;

COMMIT;
