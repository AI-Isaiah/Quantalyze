-- ============================================================================
-- ROLLBACK for 20261013120000_strategy_analytics_hold_computed_at_until_success.sql
-- Phase 166.3.1 NAVBREACH, plan 02 (founder decisions D-04 and D-05).
-- ============================================================================
-- Manual, off the auto-apply path. Drops the BEFORE UPDATE trigger and then its
-- function; nothing else depends on either, and the migration created nothing else.
--
-- ⛔ WHAT RETURNS AFTER THIS ROLLBACK. The status bridge's branch (b) re-stamps
-- strategy_analytics.computed_at = now() on every unprotected failure, and its
-- branch (a) re-stamps it at every job start. So a failed recompute makes a stale
-- strategy read as just recomputed, and queueing a retry does the same before
-- anything ran: the D-04 and D-05 defects are back, on the FreshnessChip and the
-- portfolio PDF vintage. The Python runner writes no computed_at on a failure, so
-- the bridge is the only writer that reopens.
--
-- Plan 06's computation_status keyPart in the factsheet cache key stays in place
-- and is harmless without the trigger (a status change moves the key, as well as
-- a date change). Plan 07's Sync-panel evidence (c) stays and is harmless too.
--
-- The supabase_migrations ledger row for 20261013120000 is LEFT IN PLACE. Deleting
-- it would make the migration look un-applied to the next `db push`, which would
-- re-apply it. To re-apply deliberately, re-run the migration file itself.
--
-- ⛔ THIS COMMAND TARGETS WHICHEVER DATABASE YOU POINT IT AT. This checkout's
-- Supabase CLI is linked to PRODUCTION. Run the marker query FIRST and read the
-- answer before any `--linked` command:
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
-- A NULL answer means the marker was lost: re-set it before writing.

SET LOCAL lock_timeout = '3s';

DROP TRIGGER IF EXISTS strategy_analytics_hold_computed_at_until_success_trigger ON public.strategy_analytics;
DROP FUNCTION IF EXISTS public.strategy_analytics_hold_computed_at_until_success();
