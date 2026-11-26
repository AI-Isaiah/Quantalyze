-- ============================================================================
-- ROLLBACK for 20261126130000_strategy_analytics_computed_at_nullable.sql
-- Phase 238 NEVERCOMPUTED, plan 05 (FACT-03, founder ruling "A: allow an empty date").
-- ============================================================================
-- Manual, off the auto-apply path. Run it as ONE transaction, so it either happens
-- whole or not at all (this file carries no transaction statements, like a migration):
--
--   psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
--
-- ⛔ THIS COMMAND TARGETS WHICHEVER DATABASE YOU POINT IT AT. This checkout's Supabase
-- CLI is linked to PRODUCTION. Run the marker query FIRST and read the answer before any
-- `--linked` command:
--
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
--
-- current_database() is `postgres` on BOTH projects and proves nothing; if the marker is
-- NULL, re-set it before running anything here.
--
-- WHAT THIS UNDOES
--   1. Fills every NULL computed_at with the EPOCH (TIMESTAMPTZ 'epoch', 1970-01-01 UTC),
--      with the hold trigger switched off for that one UPDATE.
--   2. Restores DEFAULT now() and NOT NULL on strategy_analytics.computed_at.
--   3. Re-enables the hold trigger.
--
-- ⛔ THE FILL VALUE IS THE EPOCH, NOT now(), AND THIS IS DELIBERATE.
-- NOT NULL cannot be restored while a row holds NULL, so those rows need SOME instant, and
-- every candidate is a claim about the row:
--   * now() would reintroduce exactly the false "computed just now" date that this phase
--     removes: a row that never computed would read as freshly computed again, the
--     FreshnessChip would show it as current, and the staleness view would take the
--     rollback time as a compute time. That is the defect the migration exists to fix.
--   * The epoch is the instant the product ALREADY treats as "never computed". The
--     factsheet payload builder falls back to "1970-01-01T00:00:00Z" for a missing
--     computed_at (src/lib/factsheet/fetch-and-build-payload.ts), and the renderers match it
--     through isNeverComputedStamp (src/lib/factsheet/never-computed-stamp.ts), which
--     recognises any value at instant 0, including the "1970-01-01T00:00:00+00:00" spelling
--     PostgREST returns for this fill, so the chip renders its "not computed" state.
--     computeFreshness reads the epoch as stale, and freshnessScore (src/lib/health-score.ts)
--     returns 25, its lowest non-zero band, for an epoch date (it returns 0 only for a null or
--     empty input), so nothing treats a never-computed row as current.
--   * The one visible cost: the Sync badge (SyncBadge) prints a very large age for these
--     rows ("analytics last computed" an enormous time ago) for as long as the rollback
--     stands. Accepted, because this rollback is manual and off the auto-apply path, and a
--     very old date is the honest direction of error.
--
-- ⛔ THE HOLD TRIGGER MUST BE SWITCHED OFF FOR THE FILL, the same defeat the forward path
-- has. strategy_analytics_hold_computed_at_until_success restores OLD.computed_at on every
-- UPDATE whose NEW status is failed or computing, so an UPDATE of the NULL rows that sit
-- in those statuses reports success and leaves them NULL; SET NOT NULL then refuses with
-- "contains null values". DISABLE and ENABLE sit inside this one transaction, so an abort
-- restores the trigger.
--
-- ⚠️ ROLL THE CODE BACK FIRST if the readers that handle a NULL date (plans 06 and 08 of
-- this phase) are still deployed: they stay correct on an epoch date, but an epoch is not
-- what they were written to show.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records version
-- 20261126130000 as applied and `supabase db push` will not re-apply the migration. To
-- re-apply it deliberately, re-run the migration file itself (it is idempotent) after the
-- marker query above names the intended database.

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.strategy_analytics
  DISABLE TRIGGER strategy_analytics_hold_computed_at_until_success_trigger;

UPDATE public.strategy_analytics
   SET computed_at = TIMESTAMPTZ 'epoch'
 WHERE computed_at IS NULL;

ALTER TABLE public.strategy_analytics
  ENABLE TRIGGER strategy_analytics_hold_computed_at_until_success_trigger;

ALTER TABLE public.strategy_analytics
  ALTER COLUMN computed_at SET DEFAULT now(),
  ALTER COLUMN computed_at SET NOT NULL;
