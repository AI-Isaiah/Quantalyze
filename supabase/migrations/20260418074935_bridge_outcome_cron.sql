-- Migration 060 — Bridge Outcome Cron
--
-- Purpose: Daily compute of realized 30/90/180-day deltas for recorded
-- bridge_outcomes rows where kind='allocated'. Idempotent (re-running same
-- day produces identical values; WHERE guard prevents re-work).
--
-- NOTE: pg_cron only. Vercel Hobby 2/2 cron cap is full (warm-analytics +
-- alert-digest — see src/__tests__/vercel-cron-limits.test.ts). Do NOT add
-- an entry to vercel.json.
--
-- Data source: strategy_analytics.returns_series (JSONB cumulative equity
-- curve: [{date:"YYYY-MM-DD", value:NUMERIC}, ...]). Math: ratio at day N
-- = value_at(anchor + N) / value_at(anchor) - 1. NEVER SUM(daily_return) —
-- returns_series is cumulative, not period-over-period.
--
-- Dependencies: migration 058 (log_audit_event), migration 059 (bridge_outcomes).

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: helper — extract_equity_at
-- --------------------------------------------------------------------------
-- Returns the cumulative equity value on target_date from a returns_series
-- JSONB array. Returns NULL when the date is not present, or when the value
-- is 0 (prevent divide-by-zero in extract_delta).
CREATE OR REPLACE FUNCTION public.extract_equity_at(
  series JSONB,
  target_date DATE
) RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF((entry->>'value')::NUMERIC, 0)
  FROM jsonb_array_elements(series) AS entry
  WHERE (entry->>'date')::DATE = target_date
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.extract_equity_at IS
  'Returns the cumulative equity value on target_date from a returns_series JSONB array '
  '[{date:"YYYY-MM-DD", value:NUMERIC}, ...], or NULL when the date is not in the series. '
  'Values of 0 are treated as NULL to prevent divide-by-zero in extract_delta.';

-- --------------------------------------------------------------------------
-- STEP 2: helper — extract_delta
-- --------------------------------------------------------------------------
-- Computes the realized delta across N days from the anchor date using the
-- cumulative equity curve formula:
--   delta = (equity_at(anchor + N) / equity_at(anchor)) - 1
-- Returns NULL when either endpoint is absent from the series.
-- NEVER implement as SUM(daily_return) — returns_series is cumulative.
CREATE OR REPLACE FUNCTION public.extract_delta(
  series JSONB,
  anchor DATE,
  days INT
) RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- Cumulative equity curve: (value_at(anchor + days) / value_at(anchor)) - 1.
  -- Returns NULL if either anchor or anchor+days is missing from the series.
  SELECT
    CASE
      WHEN public.extract_equity_at(series, anchor) IS NULL THEN NULL
      WHEN public.extract_equity_at(series, anchor + days) IS NULL THEN NULL
      ELSE (public.extract_equity_at(series, anchor + days) /
            public.extract_equity_at(series, anchor)) - 1
    END;
$$;

COMMENT ON FUNCTION public.extract_delta IS
  'Realized delta across N days from the anchor, using cumulative equity math. '
  'Formula: (equity_at(anchor + days) / equity_at(anchor)) - 1. '
  'NEVER implement as SUM of daily returns — returns_series is cumulative.';

-- --------------------------------------------------------------------------
-- STEP 3: helper — extract_estimated
-- --------------------------------------------------------------------------
-- Returns the estimated delta (in bps) and days elapsed for the partial
-- in-window period between anchor and the most recent entry in the series.
-- Only returns a row when days_elapsed is between 1 and 29 inclusive.
-- Realized windows (30/90/180d) take over via extract_delta beyond day 29.
CREATE OR REPLACE FUNCTION public.extract_estimated(
  series JSONB,
  anchor DATE
) RETURNS TABLE(bps NUMERIC, days INT)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  last_entry RECORD;
  last_date DATE;
  last_value NUMERIC;
  anchor_value NUMERIC;
  days_elapsed INT;
BEGIN
  IF series IS NULL OR jsonb_array_length(series) = 0 THEN
    RETURN;
  END IF;

  anchor_value := public.extract_equity_at(series, anchor);
  IF anchor_value IS NULL THEN
    RETURN;
  END IF;

  -- Most recent entry in the series
  SELECT
    (entry->>'date')::DATE AS d,
    (entry->>'value')::NUMERIC AS v
  INTO last_entry
  FROM jsonb_array_elements(series) AS entry
  ORDER BY (entry->>'date')::DATE DESC
  LIMIT 1;

  last_date := last_entry.d;
  last_value := last_entry.v;
  days_elapsed := (last_date - anchor);

  -- Only return an estimate when we have between 1 and 29 days of data since
  -- anchor. Realized windows (30/90/180) take over via extract_delta.
  IF days_elapsed < 1 OR days_elapsed > 29 THEN
    RETURN;
  END IF;

  IF last_value IS NULL OR last_value = 0 THEN
    RETURN;
  END IF;

  bps := ((last_value / anchor_value) - 1) * 10000;
  days := days_elapsed;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.extract_estimated IS
  'Estimated delta in basis points + days elapsed for an anchor-to-most-recent window. '
  'Returns 0 rows when outside the 1..29 day range or when anchor is missing from the series. '
  'Used for the D-12 "Estimated: +X.X% (Nd)" label before the 30-day realized window populates.';

-- --------------------------------------------------------------------------
-- STEP 4: main function — compute_bridge_outcome_deltas
-- --------------------------------------------------------------------------
-- Daily batch: for each bridge_outcomes row where kind='allocated' AND
-- (delta_30d IS NULL OR needs_recompute=TRUE), joins strategy_analytics,
-- computes 30/90/180d deltas + in-window estimate, and writes back.
-- Clears needs_recompute=FALSE atomically with the delta writes.
--
-- SECURITY DEFINER: runs as the function owner (postgres) so it can read
-- strategy_analytics across RLS. SET search_path pins the resolver to
-- prevent schema-shadowing attacks (T-01-04-01).
--
-- GRANT EXECUTE restricted to service_role only (T-01-04-06).
--
-- NOTE: This function intentionally does NOT call log_audit_event. pg_cron
-- runs under a session where auth.uid() is NULL, and log_audit_event
-- (migration 049) raises 'insufficient_privilege' on NULL auth.uid();
-- audit_log.entity_id is also NOT NULL so there is no viable batch-level
-- entity. Observability flows through pg_cron's native cron.job_run_details
-- table (see runbook "Signals" section). OUTCOME-08 mutation-auditing is
-- satisfied by the per-row logAuditEvent in the POST route (Plan 01-02),
-- which covers every mutation — the cron only updates derived delta columns.
CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas()
RETURNS TABLE(updated_count INT, failed_count INT, batch_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_updated INT := 0;
  v_failed  INT := 0;
  v_started TIMESTAMPTZ := NOW();
BEGIN
  WITH candidates AS (
    SELECT
      bo.id,
      bo.allocated_at,
      sa.returns_series AS series
    FROM public.bridge_outcomes AS bo
    JOIN public.strategy_analytics AS sa ON sa.strategy_id = bo.strategy_id
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
  ),
  computed AS (
    SELECT
      c.id,
      public.extract_delta(c.series, c.allocated_at, 30)  AS d30,
      public.extract_delta(c.series, c.allocated_at, 90)  AS d90,
      public.extract_delta(c.series, c.allocated_at, 180) AS d180,
      est.bps  AS est_bps,
      est.days AS est_days
    FROM candidates c
    LEFT JOIN LATERAL public.extract_estimated(c.series, c.allocated_at) AS est ON TRUE
  ),
  updated AS (
    UPDATE public.bridge_outcomes AS bo
    SET
      delta_30d           = COALESCE(c.d30,      bo.delta_30d),
      delta_90d           = COALESCE(c.d90,      bo.delta_90d),
      delta_180d          = COALESCE(c.d180,     bo.delta_180d),
      estimated_delta_bps = COALESCE(c.est_bps,  bo.estimated_delta_bps),
      estimated_days      = COALESCE(c.est_days, bo.estimated_days),
      needs_recompute     = FALSE,
      deltas_computed_at  = v_started
    FROM computed c
    WHERE bo.id = c.id
      AND bo.kind = 'allocated'           -- D-19 re-assert at UPDATE (T-01-04-02)
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  )
  SELECT COUNT(*)::INT INTO v_updated FROM updated;

  RETURN QUERY SELECT v_updated, v_failed, v_started;
END;
$$;

COMMENT ON FUNCTION public.compute_bridge_outcome_deltas IS
  'Daily batch: compute realized 30/90/180-day deltas + in-window estimate for '
  'bridge_outcomes where kind=''allocated'' AND (delta_30d IS NULL OR needs_recompute=TRUE). '
  'Idempotent — re-run produces no changes once windows populate. '
  'Observability via cron.job_run_details (NOT log_audit_event — pg_cron sessions have NULL auth.uid()).';

REVOKE ALL ON FUNCTION public.compute_bridge_outcome_deltas FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_bridge_outcome_deltas TO service_role;

-- --------------------------------------------------------------------------
-- STEP 5: pg_cron extension-gated scheduling
-- --------------------------------------------------------------------------
-- Idempotent re-scheduling: unschedule-then-schedule. Graceful skip when
-- pg_cron is absent (local dev without the extension) so supabase db reset
-- works cleanly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'compute_bridge_outcome_deltas') THEN
      PERFORM cron.unschedule('compute_bridge_outcome_deltas');
    END IF;
    PERFORM cron.schedule(
      'compute_bridge_outcome_deltas',
      '0 3 * * *',
      $cron$ SELECT public.compute_bridge_outcome_deltas(); $cron$
    );
    RAISE NOTICE 'Scheduled compute_bridge_outcome_deltas at 03:00 UTC';
  ELSE
    RAISE NOTICE 'pg_cron extension not present — skipping schedule (local dev)';
  END IF;
END$$;

-- --------------------------------------------------------------------------
-- STEP 6: self-verifying DO block
-- --------------------------------------------------------------------------
-- Asserts all 4 public functions exist and the pg_cron job is registered
-- (when pg_cron is installed). Raises EXCEPTION on any missing artifact
-- → transaction rollback, matching migration 056/059 self-verify pattern.
DO $$
DECLARE
  fn_count   INT;
  cron_count INT;
BEGIN
  SELECT COUNT(*) INTO fn_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'extract_equity_at',
      'extract_delta',
      'extract_estimated',
      'compute_bridge_outcome_deltas'
    );

  IF fn_count <> 4 THEN
    RAISE EXCEPTION 'Migration 060 self-verify failed: expected 4 public functions, found %', fn_count;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT COUNT(*) INTO cron_count
    FROM cron.job
    WHERE jobname = 'compute_bridge_outcome_deltas'
      AND schedule = '0 3 * * *';

    IF cron_count <> 1 THEN
      RAISE EXCEPTION 'Migration 060 self-verify failed: cron.job compute_bridge_outcome_deltas @ 0 3 * * * not found (cron_count=%)', cron_count;
    END IF;
  ELSE
    cron_count := 0;
  END IF;

  RAISE NOTICE 'Migration 060 self-verify: % functions, % cron entries (or pg_cron absent)', fn_count, cron_count;
END$$;

COMMIT;
