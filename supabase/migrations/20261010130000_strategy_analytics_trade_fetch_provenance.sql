-- ============================================================================
-- strategy_analytics.trades_fetched_at + strategy_analytics.series_provenance:
-- the last successful trade fetch, and the range-level provenance of a daily
-- series (2026-10-10, Phase 167.1.2.2.2 TRADESYNC, SC-4, D-02, D-03, D-07, D-08)
-- ============================================================================
--
-- What this is for
-- ----------------
-- trades_fetched_at (SC-4 / D-07). The instant of the last /api/cron-sync tick
-- that fetched and stored this strategy's trades. Its single writer is the
-- analytics service's routers/cron.py (service role). The freshness line the
-- public pages render reads it, and ONLY it: it is never derived from
-- computed_at (a derive timestamp, which moves when the series is recomputed
-- from stored trades without any fetch) and never from api_keys.last_sync_at
-- (a key-level stamp). NULL means no trade fetch is recorded, and the UI then
-- renders no claim at all.
--
-- series_provenance (D-03 / D-08 / D-02). A range-level record, as a jsonb
-- OBJECT with two optional arrays:
--   legacy_ranges    [{from, to, source, recorded_at}]  source is
--                    'returns_grid_carry_forward': points a legacy path carried
--                    forward instead of observing (D-08).
--   unrecovered_gaps [{from, to, recorded_at}]          ranges no fetch could
--                    recover, named rather than hidden (D-02).
-- Dates are YYYY-MM-DD and inclusive. A later phase (OKXHISTORY, 167.1.2.2.2.1)
-- may add a reconstructed_ranges array under the same column. The database
-- enforces object-ness ONLY; the reader validates the arrays and renders nothing
-- on a malformed value. Writers: the go-live runbook (hand-run, postgres) and,
-- later, OKXHISTORY.
-- ⚠️ It deliberately lives OUTSIDE data_quality_flags. run_csv_strategy_analytics
-- rebuilds data_quality_flags wholesale on every run, so a runbook write there
-- would be erased by the very re-derive it accompanies. It is not a per-row
-- source column on csv_daily_returns either: that table has many writers, and
-- the per-row shape is the costly migration kind.
--
-- Shape: two nullable columns, NO default, NO backfill, one CHECK, no index, no
-- trigger, no function, no scheduled job. NULL is the honest value for every
-- existing row: stamping them would fabricate a fetch or a provenance claim
-- about history nobody observed.
--
-- ⛔ DEPLOY ORDER: THIS SHIPS AHEAD OF EVERY READER. Merging
-- supabase/migrations/** to `main` applies to shared TEST and then to PROD with
-- no human stop. A frontend select naming an absent column fails the WHOLE
-- PostgREST query, which would break the public list pages during a deploy
-- window, so the readers (and the types patch) land after this applies.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION, and no DO block here reads a
-- row. Shared TEST holds PROD's catalogue and none of its data, and a failed
-- TEST apply blocks the PROD apply, so a data-reading DO block that RAISEs on an
-- unexpected count would block a production deploy on an empty database. Every
-- check below is DDL or catalogue-only.
--
-- RLS and grants: NOTHING is written. strategy_analytics already carries
-- analytics_read (published or owner), analytics_insert_deny and
-- analytics_update_deny, and table-level grants cover a new column, so both
-- columns are readable by exactly the audience of computed_at and writable by
-- the service role alone (it bypasses RLS). The post-verify below proves the
-- three policies are still present, so this file demonstrably changed no RLS.
--
-- Framing: BEGIN/COMMIT with SET LOCAL, so the 3s lock bound dies with the
-- transaction instead of leaking into later migrations of the same `db push`.
-- No function is added, so no SECURITY DEFINER / search_path rule applies, and
-- nothing is scheduled.
-- Rollback (manual, off the auto-apply path):
-- supabase/migrations/down/20261010130000-rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ───────────────────────────── 1. the two columns (no default, no backfill)
ALTER TABLE public.strategy_analytics
  ADD COLUMN IF NOT EXISTS trades_fetched_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS series_provenance jsonb NULL;

-- ─────────── 2. series_provenance is an object or NULL (T-167.1.2.2.2-08)
-- Guarded on pg_constraint because ADD CONSTRAINT has no IF NOT EXISTS in this
-- PG version (the form of 20261007120000). Added directly rather than NOT VALID +
-- VALIDATE: the column was created one statement ago, every row is NULL, so
-- validation reads no data.
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.strategy_analytics'::regclass
       AND conname  = 'strategy_analytics_series_provenance_is_object'
  ) THEN
    ALTER TABLE public.strategy_analytics
      ADD CONSTRAINT strategy_analytics_series_provenance_is_object
      CHECK (series_provenance IS NULL OR jsonb_typeof(series_provenance) = 'object');
  END IF;
END
$constraint$;

-- ─────────── 3. COMMENTs that say who writes it and why NULL is normal
COMMENT ON COLUMN public.strategy_analytics.trades_fetched_at IS
  'Phase 167.1.2.2.2 SC-4 / D-07. The instant of the last /api/cron-sync tick '
  'that fetched and stored this strategy''s trades (strategy_advances). Single '
  'writer: analytics-service routers/cron.py (service role). NULL = no fetch '
  'recorded, which the UI renders as no claim. Never derived from computed_at '
  'or api_keys.last_sync_at.';

COMMENT ON COLUMN public.strategy_analytics.series_provenance IS
  'Phase 167.1.2.2.2 D-03 / D-08 / D-02. A jsonb OBJECT (series_provenance_is_object '
  'enforces object-ness only; the reader validates the arrays and renders nothing '
  'on a malformed value) with two optional arrays: legacy_ranges '
  '[{from, to, source, recorded_at}] where source = returns_grid_carry_forward, '
  'and unrecovered_gaps [{from, to, recorded_at}]. Dates are YYYY-MM-DD, '
  'inclusive. A later phase (OKXHISTORY) may add reconstructed_ranges. Writers: '
  'the go-live runbook and, later, OKXHISTORY. It lives OUTSIDE '
  'data_quality_flags because run_csv_strategy_analytics rebuilds that field '
  'wholesale on every run, which would erase a runbook write. NULL = no range '
  'record, which is the normal state.';

-- ───────────── 4. post-verify: CATALOGUE ONLY, passes on an empty database
DO $verify$
DECLARE
  v_missing text;
  v_wrong   text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['trades_fetched_at', 'series_provenance']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'strategy_analytics' AND column_name = c
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261010130000 failed: strategy_analytics lacks column(s) %', v_missing;
  END IF;

  -- ADD COLUMN IF NOT EXISTS no-ops on a pre-existing column of ANY type, so
  -- the type, nullability and default are read back rather than assumed.
  SELECT string_agg(c.column_name || ' is ' || c.data_type, ', ') INTO v_wrong
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'strategy_analytics'
     AND ((c.column_name = 'trades_fetched_at' AND c.data_type <> 'timestamp with time zone')
       OR (c.column_name = 'series_provenance' AND c.data_type <> 'jsonb'));
  IF v_wrong IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261010130000 failed: wrong column type(s): %', v_wrong;
  END IF;

  SELECT string_agg(c.column_name, ', ') INTO v_wrong
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'strategy_analytics'
     AND c.column_name IN ('trades_fetched_at', 'series_provenance')
     AND c.is_nullable <> 'YES';
  IF v_wrong IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261010130000 failed: column(s) not nullable: %', v_wrong;
  END IF;

  SELECT string_agg(c.column_name, ', ') INTO v_wrong
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'strategy_analytics'
     AND c.column_name IN ('trades_fetched_at', 'series_provenance')
     AND c.column_default IS NOT NULL;
  IF v_wrong IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261010130000 failed: column(s) carry a DEFAULT: %', v_wrong;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.strategy_analytics'::regclass
       AND conname = 'strategy_analytics_series_provenance_is_object'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'Migration 20261010130000 failed: constraint strategy_analytics_series_provenance_is_object is missing';
  END IF;

  SELECT string_agg(p, ', ') INTO v_missing
    FROM unnest(ARRAY['analytics_read', 'analytics_insert_deny', 'analytics_update_deny']) AS p
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'strategy_analytics' AND policyname = p
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261010130000 failed: strategy_analytics lost RLS policy(ies) %', v_missing;
  END IF;

  RAISE NOTICE 'Migration 20261010130000: trades_fetched_at and series_provenance present (timestamptz / jsonb, nullable, no default), object CHECK in force, the three RLS policies untouched.';
END
$verify$;

COMMIT;
