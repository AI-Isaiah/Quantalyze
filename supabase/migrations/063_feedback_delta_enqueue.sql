-- Migration 063: feedback-loop delta cron enqueue — extends
-- compute_bridge_outcome_deltas() so that ONLY allocators whose outcomes
-- just transitioned NULL -> non-NULL on any of delta_30d/90d/180d are
-- enqueued for rescore_allocator. Captures the transitioned rowset via
-- UPDATE ... RETURNING into a CTE, aggregates allocator_ids into a
-- PL/pgSQL UUID[], then FOREACH-iterates to PERFORM enqueue_compute_job.
-- Sprint 8 / Phase 4 — FEEDBACK-04 + D-11 + D-12 + VOICES-ACCEPTED D1.
--
-- What this does
-- --------------
-- 1. Amend compute_bridge_outcome_deltas (via CREATE-OR-REPLACE) with a
--    two-phase structure:
--      Phase A — CTE chain (candidates + computed), feeding a CTE-wrapped
--      UPDATE ... RETURNING bo.allocator_id that restricts to rows where
--      AT LEAST ONE of delta_30d/90d/180d transitions NULL -> non-NULL.
--      The result is array_agg'd into v_allocator_ids UUID[].
--      Phase B — FOREACH v_allocator_id IN ARRAY v_allocator_ids LOOP
--      PERFORM enqueue_compute_job(...); END LOOP. Each PERFORM runs
--      inside an inner BEGIN...EXCEPTION WHEN OTHERS subtransaction so an
--      individual enqueue failure cannot abort the batch.
--
-- 2. Math preservation — the computed CTE calls extract_delta with the
--    identical (series, anchor, days) shape used by migration 060. This
--    pins the CTE signature to migration 060's definition (C1 finding).
--
-- 3. Self-verifying DO block asserts the new function body references
--    enqueue_compute_job AND 'rescore_allocator' AND
--    'RETURNING bo.allocator_id' AND 'array_agg(DISTINCT allocator_id)'
--    AND 'extract_delta(' via pg-function-source string search. Failure
--    raises EXCEPTION and rolls back.
--
-- What this does NOT do
-- ---------------------
-- - No schema changes. No new columns, no new CHECK constraints.
-- - No change to pg_cron schedule — cron.schedule('compute_bridge_outcome_deltas',
--   '0 3 * * *', ...) from migration 060 step 5 keeps firing; it just does
--   targeted enqueue work per run (only on transitions).
-- - No new RLS policies. SECURITY DEFINER + service_role EXECUTE grant
--   preserved from migration 060.
-- - No signature change — CREATE OR REPLACE applies cleanly (no DROP needed).
-- - No sub-transaction-control statement in DO blocks (Rule 1 auto-fix —
--   PL/pgSQL DO blocks cannot issue save-point / rollback-to statements;
--   per-iteration failures are isolated via inner BEGIN...EXCEPTION
--   WHEN OTHERS subtxn).
--
-- Sanity
-- ------
-- pg_cron sessions have NULL current-user context (migration 060 comment).
-- DO NOT reference any caller-id helper anywhere in this migration; use the
-- local v_allocator_id from the FOREACH loop.

BEGIN;

SET lock_timeout = '3s';

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
  v_allocator_ids UUID[];
  v_allocator_id UUID;
BEGIN
  -- Phase A — compute transitions AND capture the allocator_id set in one pass.
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
  transitioned AS (
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
      AND bo.kind = 'allocated'
      AND (
        (bo.delta_30d  IS NULL AND c.d30  IS NOT NULL) OR
        (bo.delta_90d  IS NULL AND c.d90  IS NOT NULL) OR
        (bo.delta_180d IS NULL AND c.d180 IS NOT NULL)
      )
    RETURNING bo.allocator_id
  )
  SELECT array_agg(DISTINCT allocator_id), COUNT(*)::INT
    INTO v_allocator_ids, v_updated
  FROM transitioned;

  IF v_allocator_ids IS NULL THEN
    v_allocator_ids := ARRAY[]::UUID[];
  END IF;

  -- Phase B — FOREACH iterate the allocator array and enqueue. Inner
  -- BEGIN...EXCEPTION subtransaction isolates per-allocator failures.
  FOREACH v_allocator_id IN ARRAY v_allocator_ids
  LOOP
    BEGIN
      PERFORM enqueue_compute_job(
        p_strategy_id     := NULL,
        p_kind            := 'rescore_allocator',
        p_idempotency_key := NULL,
        p_parent_job_ids  := '{}',
        p_exchange        := NULL,
        p_metadata        := NULL,
        p_allocator_id    := v_allocator_id
      );
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'feedback enqueue failed for allocator=%: %',
          v_allocator_id, SQLERRM;
    END;
  END LOOP;

  RETURN QUERY SELECT v_updated, v_failed, v_started;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_bridge_outcome_deltas FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_bridge_outcome_deltas TO service_role;

DO $$
DECLARE
  v_body TEXT;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body
    FROM pg_proc
    WHERE proname = 'compute_bridge_outcome_deltas'
      AND pronamespace = 'public'::regnamespace;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Migration 063 failed: compute_bridge_outcome_deltas function not found';
  END IF;
  IF v_body NOT LIKE '%enqueue_compute_job%' THEN
    RAISE EXCEPTION 'Migration 063 failed: body does not reference enqueue_compute_job';
  END IF;
  IF v_body NOT LIKE '%''rescore_allocator''%' THEN
    RAISE EXCEPTION 'Migration 063 failed: body does not reference ''rescore_allocator'' literal';
  END IF;
  IF v_body NOT LIKE '%RETURNING bo.allocator_id%' THEN
    RAISE EXCEPTION 'Migration 063 failed: body does not RETURN the transitioned allocator_id rowset (D1 finding)';
  END IF;
  IF v_body NOT LIKE '%array_agg(DISTINCT allocator_id)%' THEN
    RAISE EXCEPTION 'Migration 063 failed: body does not array_agg(DISTINCT allocator_id) into a UUID[] (D1 finding)';
  END IF;
  IF v_body NOT LIKE '%extract_delta(%' THEN
    RAISE EXCEPTION 'Migration 063 failed: body does not call extract_delta() — CTE signature parity with migration 060 broken (C1 finding)';
  END IF;
  RAISE NOTICE 'Migration 063: compute_bridge_outcome_deltas amended with transition-scoped rescore_allocator enqueue loop verified (D1 + C1).';
END$$;

COMMIT;
