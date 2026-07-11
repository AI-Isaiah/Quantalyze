-- ============================================================================
-- ROLLBACK for 20260710150000_sync_status_supersede_failed_per_kind.sql
-- Phase 87 / Plan 87-01 — per-(strategy,kind) failed_final supersession reversal.
-- ============================================================================
-- This migration mutated the EXISTING shared SECURITY-DEFINER function
-- sync_strategy_analytics_status via CREATE OR REPLACE (it did not create a new
-- object), so rollback = RESTORE the prior body, NOT a DROP. The body below is a
-- BYTE-IDENTICAL copy of the mig-038 definition
-- (20260708120000_sync_status_failed_final_bounce.sql:65-174): branch (b) reverts
-- to the unconditional "any failed_final → failed" (ORDER BY updated_at DESC),
-- branches (a)/(c) keep both `OR strategy_analytics.computation_warned` marker
-- reads, and the SECURITY DEFINER / search_path / REVOKE posture is preserved.
-- Restoring this re-opens the F-3 resubmit-poison (that is the point of a
-- rollback) but does NOT regress SI-02 (the marker reads are intact).
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION sync_strategy_analytics_status(p_strategy_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_job_count          INTEGER;
  v_nonterminal_count  INTEGER;
  v_failed_count       INTEGER;
  v_latest_error       TEXT;
BEGIN
  IF p_strategy_id IS NULL THEN
    RAISE EXCEPTION 'sync_strategy_analytics_status: p_strategy_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (d) no rows → preserve existing strategy_analytics row (unchanged).
  SELECT count(*) INTO v_job_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id;

  IF v_job_count = 0 THEN
    RETURN;
  END IF;

  -- (a) any non-terminal row → 'computing', UNLESS the runner has already
  -- written 'complete_with_warnings' OR set its runner-owned computation_warned
  -- marker. That warning is a runner-owned terminal sub-state the compute_jobs
  -- aggregate cannot see; this branch fires whenever ANY sibling job for the
  -- strategy is still in flight (e.g. a poll_positions / sync_funding job claimed
  -- in the same batch as the warned analytics job, or a pre-mark bridge call while
  -- this job's own row is still 'running'). Writing a bare 'computing' here would
  -- launder the warning, which branch (c) would then resolve to a plain 'complete'
  -- — ordering-dependent, so it leaked on multi-job (live-API) strategies.
  -- Preserve it. Only the analytics runner clears the warning, via its own
  -- 'computing' entry-write + clean terminal write when it actually recomputes;
  -- the bridge must never downgrade it.
  SELECT count(*) INTO v_nonterminal_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id
     AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry');

  IF v_nonterminal_count > 0 THEN
    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
    VALUES (p_strategy_id, 'computing', NULL)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = CASE
             WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                  OR strategy_analytics.computation_warned
             THEN 'complete_with_warnings'
             ELSE 'computing'
           END,
           computation_error  = EXCLUDED.computation_error,
           computed_at        = now();
    RETURN;
  END IF;

  -- (b) all terminal, any failed_final → 'failed' with latest error (unchanged).
  -- NOTE: this write does NOT touch computation_warned — the runner-owned marker
  -- survives the 'failed' bounce in its own column, so branch (c) can recover the
  -- warning after a sibling failed_final→done recovery WITHOUT an analytics re-run
  -- (this is the SI-02 failed_final-bounce launder closed by mig 20260708120000).
  SELECT count(*) INTO v_failed_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id
     AND status = 'failed_final';

  IF v_failed_count > 0 THEN
    SELECT last_error
      INTO v_latest_error
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND status = 'failed_final'
     ORDER BY updated_at DESC
     LIMIT 1;

    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
    VALUES (p_strategy_id, 'failed', v_latest_error)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = EXCLUDED.computation_status,
           computation_error  = EXCLUDED.computation_error,
           computed_at        = now();
    RETURN;
  END IF;

  -- (c) all rows 'done' → terminal SUCCESS. PRESERVE an existing
  -- 'complete_with_warnings' OR a runner-owned computation_warned marker (a
  -- more-informative success the analytics worker already wrote — the marker
  -- read is what closes the failed_final-bounce launder, since branch (b) may
  -- have bounced computation_status to 'failed' in between); otherwise resolve
  -- to 'complete'. Clears any stale computation_error either way.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
  VALUES (p_strategy_id, 'complete', NULL)
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = CASE
           WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                OR strategy_analytics.computation_warned
           THEN 'complete_with_warnings'
           ELSE 'complete'
         END,
         computation_error  = NULL,
         computed_at        = now();
END;
$$;

COMMENT ON FUNCTION sync_strategy_analytics_status IS
  'Atomic UI status bridge. Derives strategy_analytics.computation_status from the compute_jobs aggregate for the given strategy in a single SQL statement (no read-then-write race). Mapping: any non-terminal row → computing, any failed_final → failed (with latest error), all done → complete; EXCEPT a row already at complete_with_warnings OR carrying the runner-owned computation_warned marker is preserved as complete_with_warnings in BOTH the non-terminal (a) and all-done (c) branches (a sticky, more-informative terminal success the analytics runner wrote and only the runner clears). The marker read makes preservation ordering-independent and closes the failed_final-bounce launder: branch (b) may bounce computation_status to failed, but computation_warned survives in its own column and branch (c) recovers complete_with_warnings from it. no rows → no-op (preserve existing). Called post-flip by mark_compute_job_done / mark_compute_job_failed (in-RPC PERFORM) and, for the DEFERRED outcome only, by services.job_worker.dispatch. Service-role only. See migrations 038 + 20260707120000 + 20260708120000.';

REVOKE ALL ON FUNCTION sync_strategy_analytics_status FROM PUBLIC, anon, authenticated;

-- Self-verifying DO block: the restored body is the pre-supersession mig-038 body.
DO $$
DECLARE
  v_secdef BOOLEAN;
  v_search_path TEXT;
  v_fn TEXT := pg_get_functiondef('sync_strategy_analytics_status(uuid)'::regprocedure);
BEGIN
  SELECT COALESCE(
    (SELECT p.prosecdef FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'sync_strategy_analytics_status'
      LIMIT 1), FALSE)
  INTO v_secdef;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'supersede-failed rollback failed: sync_strategy_analytics_status is not SECURITY DEFINER';
  END IF;

  SELECT array_to_string(p.proconfig, ',')
    INTO v_search_path
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'sync_strategy_analytics_status'
   LIMIT 1;
  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'supersede-failed rollback failed: search_path not set';
  END IF;

  -- The restored mig-038 body must NOT carry the per-kind supersession predicate.
  IF v_fn ~* 'd\.kind\s*=\s*f\.kind' THEN
    RAISE EXCEPTION 'supersede-failed rollback failed: per-kind supersession predicate still present (body not restored to mig-038)';
  END IF;

  -- ...and must STILL read the computation_warned marker (SI-02 stays closed).
  IF v_fn !~* 'OR\s+strategy_analytics\.computation_warned' THEN
    RAISE EXCEPTION 'supersede-failed rollback failed: branches (a)/(c) no longer read computation_warned (SI-02 launder re-opened)';
  END IF;

  RAISE NOTICE 'sync_strategy_analytics_status restored to the mig-038 body (unconditional failed_final poison); per-kind supersession removed, computation_warned marker intact.';
END
$$;

COMMIT;
