-- ============================================================================
-- Phase 19 / BACKBONE-04 — daily error-rate rollup table for the 168h soak gate
-- ============================================================================
-- Closes the "YYYY-MM-DD placeholder" gap in .planning/phase-19/stability-log.md.
-- The 7-day Sentry error-rate table was authored as scaffolding with no
-- mechanism filling it in. This migration adds a real audit table that the
-- new /api/cron/phase19-error-rollup Vercel cron writes once per day, plus
-- a small extension to phase19_soak_status() so the existing
-- phase-19-stability.yml workflow can read daily rollup state alongside
-- legacy_write_count in one round-trip.
--
-- Backward compatibility: phase19_soak_status's JSON shape is ADDITIVE only.
-- Existing fields (flag_value, vr_is_view, legacy_write_count, since,
-- checked_at) are preserved verbatim so scripts/verify-no-legacy-writes.sh
-- continues to parse correctly.
--
-- Write path: service_role only, via SECDEF phase19_soak_record_day(...).
-- The cron route uses the admin client. RLS denies all direct writes from
-- anon / authenticated even if the route is ever re-routed through them.
--
-- Read path: anon SELECT for the gate workflow (which uses the prod ANON
-- key — chosen for least blast radius, mirrors phase19_soak_status). No PII
-- in this table; only aggregate counts.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ----------------------------------------------------------------------------
-- STEP 1 — phase19_soak_daily table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.phase19_soak_daily (
  date_utc      DATE        PRIMARY KEY,
  day_index     SMALLINT    NOT NULL CHECK (day_index BETWEEN 1 AND 14),
  error_rate    NUMERIC(7,5) NOT NULL CHECK (error_rate >= 0 AND error_rate <= 1),
  total_events  INTEGER     NOT NULL CHECK (total_events >= 0),
  error_events  INTEGER     NOT NULL CHECK (error_events >= 0 AND error_events <= total_events),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes         TEXT
);

COMMENT ON TABLE public.phase19_soak_daily IS
  'Phase 19 / BACKBONE-04 daily rollup of /api/process-key error envelope rate during the 168h soak. Populated by /api/cron/phase19-error-rollup (Vercel daily cron). Read by .github/workflows/phase-19-stability.yml + go/no-go review. day_index = 1..7 relative to flag_flipped_at; allows 1..14 for over-extended soaks.';

ALTER TABLE public.phase19_soak_daily ENABLE ROW LEVEL SECURITY;

-- Anon read: the phase-19-stability.yml workflow uses the prod ANON key
-- (chosen for least blast radius) and needs to verify daily-row presence.
DROP POLICY IF EXISTS phase19_soak_daily_anon_select ON public.phase19_soak_daily;
CREATE POLICY phase19_soak_daily_anon_select ON public.phase19_soak_daily
  FOR SELECT
  TO anon, authenticated, service_role
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.phase19_soak_daily FROM anon, authenticated;

-- ----------------------------------------------------------------------------
-- STEP 2 — phase19_soak_record_day(...) upsert RPC (SECDEF, service_role only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.phase19_soak_record_day(
  p_date_utc     DATE,
  p_day_index    SMALLINT,
  p_error_rate   NUMERIC,
  p_total_events INTEGER,
  p_error_events INTEGER,
  p_notes        TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Defense in depth: service_role / postgres only. SECDEF bypasses RLS,
  -- so this gate is what prevents a future ACL relaxation from letting
  -- a compromised authenticated session forge daily rollup rows.
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'phase19_soak_record_day: only service_role may write rollup rows (current_user=%)', current_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.phase19_soak_daily (
    date_utc, day_index, error_rate, total_events, error_events, notes, recorded_at
  ) VALUES (
    p_date_utc, p_day_index, p_error_rate, p_total_events, p_error_events, p_notes, now()
  )
  ON CONFLICT (date_utc) DO UPDATE SET
    day_index    = EXCLUDED.day_index,
    error_rate   = EXCLUDED.error_rate,
    total_events = EXCLUDED.total_events,
    error_events = EXCLUDED.error_events,
    notes        = EXCLUDED.notes,
    recorded_at  = now();

  RETURN jsonb_build_object(
    'ok',         true,
    'date_utc',   p_date_utc,
    'day_index',  p_day_index,
    'error_rate', p_error_rate
  );
END;
$$;

COMMENT ON FUNCTION public.phase19_soak_record_day(DATE, SMALLINT, NUMERIC, INTEGER, INTEGER, TEXT) IS
  'Phase 19 BACKBONE-04 upsert RPC for daily rollup. Idempotent on (date_utc) so a cron retry or manual backfill replaces the prior row. service_role only.';

REVOKE ALL ON FUNCTION public.phase19_soak_record_day(DATE, SMALLINT, NUMERIC, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phase19_soak_record_day(DATE, SMALLINT, NUMERIC, INTEGER, INTEGER, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- STEP 3 — phase19_soak_status extended with daily-rollup observability
-- ----------------------------------------------------------------------------
-- Additive JSON shape: existing fields (flag_value, vr_is_view,
-- legacy_write_count, since, checked_at) preserved verbatim so
-- scripts/verify-no-legacy-writes.sh continues to parse correctly. New
-- fields (daily_rows, max_error_rate, breach_count) are read by the
-- extended phase-19-stability.yml gate near ship time.
CREATE OR REPLACE FUNCTION public.phase19_soak_status(p_since timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_flag             TEXT;
  v_is_view          BOOLEAN;
  v_legacy_writes    BIGINT  := 0;
  v_daily_rows       INTEGER := 0;
  v_max_error_rate   NUMERIC := 0;
  v_breach_count     INTEGER := 0;
BEGIN
  SELECT value INTO v_flag
    FROM feature_flags
   WHERE flag_key = 'process_key_unified_backbone';

  SELECT EXISTS(
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'public' AND table_name = 'verification_requests'
  ) INTO v_is_view;

  -- Pre-view-shim: count direct writes to the legacy base table.
  -- Post-view-shim: gate is retired and value is meaningless, so report 0.
  IF NOT v_is_view THEN
    SELECT count(*) INTO v_legacy_writes
      FROM verification_requests
     WHERE created_at > p_since
        OR (completed_at IS NOT NULL AND completed_at > p_since);
  END IF;

  -- Daily rollup state — count rows with date >= p_since's date so a soak
  -- that started mid-day still picks up day 1's row written by the cron.
  SELECT count(*),
         COALESCE(max(error_rate), 0),
         count(*) FILTER (WHERE error_rate >= 0.005)
    INTO v_daily_rows, v_max_error_rate, v_breach_count
    FROM public.phase19_soak_daily
   WHERE date_utc >= (p_since AT TIME ZONE 'UTC')::date;

  RETURN jsonb_build_object(
    'flag_value',         COALESCE(v_flag, 'unset'),
    'vr_is_view',         v_is_view,
    'legacy_write_count', v_legacy_writes,
    'daily_rows',         v_daily_rows,
    'max_error_rate',     v_max_error_rate,
    'breach_count',       v_breach_count,
    'since',              p_since,
    'checked_at',         now()
  );
END;
$$;

COMMENT ON FUNCTION public.phase19_soak_status(timestamptz) IS
  'Phase 19 soak probe. SECURITY DEFINER; returns ONLY scalars. Extended 2026-05-27 to also report phase19_soak_daily rollup counts (daily_rows, max_error_rate, breach_count) so the phase-19-stability.yml workflow can verify both legacy-write absence AND daily-row presence in one round-trip. No row data / PII.';

GRANT EXECUTE ON FUNCTION public.phase19_soak_status(timestamptz) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- STEP 4 — self-verifying DO block
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_probe jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'phase19_soak_daily'
  ) THEN
    RAISE EXCEPTION 'phase19_soak_daily migration: table missing after CREATE';
  END IF;

  IF NOT has_function_privilege('anon', 'public.phase19_soak_status(timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'phase19_soak_daily migration: anon lost EXECUTE on phase19_soak_status';
  END IF;

  -- Backward-compat smoke test: phase19_soak_status must still expose the
  -- three fields scripts/verify-no-legacy-writes.sh parses.
  v_probe := public.phase19_soak_status(now());
  IF v_probe ? 'flag_value' = false
     OR v_probe ? 'vr_is_view' = false
     OR v_probe ? 'legacy_write_count' = false THEN
    RAISE EXCEPTION 'phase19_soak_status backward-compat broken: existing fields missing from response (got: %)', v_probe;
  END IF;
  IF v_probe ? 'daily_rows' = false
     OR v_probe ? 'max_error_rate' = false
     OR v_probe ? 'breach_count' = false THEN
    RAISE EXCEPTION 'phase19_soak_status extension verification failed: new fields missing (got: %)', v_probe;
  END IF;

  RAISE NOTICE 'phase19_soak_daily migration applied: table + record RPC + extended phase19_soak_status all live.';
END $$;

COMMIT;
