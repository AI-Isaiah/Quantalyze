-- ============================================================================
-- strategy_analytics.unit_segments: the two native segments of a strategy whose
-- unit switched (2026-11-27, Phase 256 OKXUNITSWITCH, plan 02, SC-2 and SC-7)
-- ============================================================================
--
-- What this is for
-- ----------------
-- An OKX account can move from a USDT-margined book into a coin-margined one.
-- The account's equity series is then in two native units: USD up to the switch
-- day, a coin (BTC, ETH, ...) after it. Chaining the two is not honest (a coin
-- return is not a USD return), so the derive stores each segment on its own,
-- each with its unit named, and the factsheet renders them side by side.
-- unit_segments is that store. Shape, as a jsonb OBJECT:
--
--   { "version": 1,
--     "segments": [
--       { "unit": "USD", "from_day": ISO, "to_day": ISO (= last_usd_day),
--         "returns": [ { "date": ISO, "value": float } ] },
--       { "unit": "<coin>", "base_day": ISO (= last_usd_day),
--         "from_day": ISO (= first_coin_return_day), "to_day": ISO,
--         "returns": [ { "date": ISO, "value": float } ] } ],
--     "unpriced_days": [ ISO ] }
--
-- Dates are YYYY-MM-DD. The database enforces object-ness ONLY; the readers
-- validate the rest and render nothing on a malformed value. NULL means the
-- strategy never switched unit, which is the state of every strategy that
-- exists today.
-- Writer: the analytics derive (strategy mode, service role). Readers: the
-- factsheet payload.
--
-- Why this lives OUTSIDE data_quality_flags
-- -----------------------------------------
-- run_csv_strategy_analytics rebuilds data_quality_flags wholesale on every run
-- and copies it into last_success_snapshot. A roughly 270-point series stored
-- there would be duplicated into every snapshot, and a re-derive that finds no
-- switch would erase it. A column of its own survives both. data_quality_flags
-- still carries the small marker that says a switch exists; this column carries
-- the series. (The same reasoning put series_provenance in its own column, see
-- 20261010130000.)
--
-- Shape: one nullable column, NO default, NO backfill, one CHECK, no index, no
-- trigger, no function, no scheduled job. NULL is the honest value for every
-- existing row: filling it would invent a unit history nobody observed.
--
-- ⛔ DEPLOY ORDER: THIS SHIPS IN ITS OWN PR, AHEAD OF EVERY READER AND WRITER.
-- Merging supabase/migrations/** to `main` applies to shared TEST and then to
-- PROD with no human stop. A PostgREST select or upsert that names a column the
-- table does not have fails the WHOLE request, so the factsheet select and the
-- derive's write land only after this has applied to PROD.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION, and no DO block here reads a
-- row. Shared TEST holds PROD's catalogue and none of its data, and a failed
-- TEST apply blocks the PROD apply, so a data-reading DO block that RAISEs on an
-- unexpected count would block a production deploy on an empty database. Every
-- check below is DDL or catalogue-only.
--
-- RLS and grants: NOTHING is written. strategy_analytics already carries
-- analytics_read (published or owner), analytics_insert_deny and
-- analytics_update_deny, and table-level privileges cover a new column, so the
-- column is readable by exactly the audience of returns_series and writable by
-- the service role alone (it bypasses RLS). The post-verify below proves the
-- three policies are still present, so this file demonstrably changed no RLS.
--
-- Framing: BEGIN/COMMIT with SET LOCAL, so the 3s lock bound dies with the
-- transaction instead of leaking into later migrations of the same `db push`.
-- No function is added, so no SECURITY DEFINER / search_path rule applies, and
-- nothing is scheduled.
-- Rollback (manual, off the auto-apply path):
-- supabase/migrations/down/20261127200000-rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ───────────────────────────── 1. the column (no default, no backfill)
ALTER TABLE public.strategy_analytics
  ADD COLUMN IF NOT EXISTS unit_segments jsonb NULL;

-- ─────────── 2. unit_segments is an object or NULL (T-256-05)
-- Guarded on pg_constraint because ADD CONSTRAINT has no IF NOT EXISTS in this
-- PG version (the form of 20261010130000). Added directly rather than NOT VALID +
-- VALIDATE: every row is NULL, but ADD CONSTRAINT still scans the whole table
-- under ACCESS EXCLUSIVE to COMMIT (one row per strategy, milliseconds).
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.strategy_analytics'::regclass
       AND conname  = 'strategy_analytics_unit_segments_object_chk'
  ) THEN
    ALTER TABLE public.strategy_analytics
      ADD CONSTRAINT strategy_analytics_unit_segments_object_chk
      CHECK (unit_segments IS NULL OR jsonb_typeof(unit_segments) = 'object');
  END IF;
END
$constraint$;

-- ─────────── 3. COMMENT that says who writes it and why NULL is normal
COMMENT ON COLUMN public.strategy_analytics.unit_segments IS
  'Phase 256 OKXUNITSWITCH. A jsonb OBJECT (strategy_analytics_unit_segments_object_chk '
  'enforces object-ness only; the readers validate the rest and render nothing '
  'on a malformed value): {version, segments[{unit, from_day, to_day, '
  '[base_day], returns[{date, value}]}], unpriced_days[]}. The two native '
  'segments of a strategy whose unit switched, USD before the switch and a '
  'coin after it, each with its unit named. Dates are YYYY-MM-DD. Writer: the '
  'analytics derive in strategy mode (service role). Readers: the factsheet '
  'payload. It lives OUTSIDE data_quality_flags because '
  'run_csv_strategy_analytics rebuilds that field wholesale on every run and '
  'copies it into last_success_snapshot. NULL = the strategy never switched '
  'unit, which is the normal state.';

-- ───────────── 4. post-verify: CATALOGUE ONLY, passes on an empty database
DO $verify$
DECLARE
  v_missing text;
  v_wrong   text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'strategy_analytics'
       AND column_name = 'unit_segments'
  ) THEN
    RAISE EXCEPTION 'Migration 20261127200000 failed: strategy_analytics lacks column unit_segments';
  END IF;

  -- ADD COLUMN IF NOT EXISTS no-ops on a pre-existing column of ANY type, so
  -- the type, nullability and default are read back rather than assumed.
  SELECT c.column_name || ' is ' || c.data_type INTO v_wrong
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'strategy_analytics'
     AND c.column_name = 'unit_segments'
     AND c.data_type <> 'jsonb';
  IF v_wrong IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261127200000 failed: wrong column type: %', v_wrong;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = 'strategy_analytics'
       AND c.column_name = 'unit_segments'
       AND c.is_nullable <> 'YES'
  ) THEN
    RAISE EXCEPTION 'Migration 20261127200000 failed: unit_segments is not nullable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name = 'strategy_analytics'
       AND c.column_name = 'unit_segments'
       AND c.column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Migration 20261127200000 failed: unit_segments carries a DEFAULT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.strategy_analytics'::regclass
       AND conname = 'strategy_analytics_unit_segments_object_chk'
       AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'Migration 20261127200000 failed: constraint strategy_analytics_unit_segments_object_chk is missing';
  END IF;

  SELECT string_agg(p, ', ') INTO v_missing
    FROM unnest(ARRAY['analytics_read', 'analytics_insert_deny', 'analytics_update_deny']) AS p
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'strategy_analytics' AND policyname = p
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261127200000 failed: strategy_analytics lost RLS policy(ies) %', v_missing;
  END IF;

  RAISE NOTICE 'Migration 20261127200000: unit_segments present (jsonb, nullable, no default), object CHECK in force, the three RLS policies untouched.';
END
$verify$;

COMMIT;
