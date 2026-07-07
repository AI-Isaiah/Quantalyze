-- Migration: sync_strategy_analytics_status must PRESERVE 'complete_with_warnings'
-- =============================================================================
-- Root cause (v1.8 re-open, 2026-07-07) — the bridge downgraded a warning
-- ----------------------------------------------------------------------
-- The analytics runner UPSERTs strategy_analytics.computation_status =
-- 'complete_with_warnings' whenever a DQ guard fires (a NAV-denominator guard,
-- flow-coverage terminus, unrealized-pnl wedge, etc.). That is a RUNNER-OWNED
-- terminal sub-state: it lives ONLY in strategy_analytics and is NOT derivable
-- from the compute_jobs aggregate the bridge reads. So ANY bridge write that
-- unconditionally set a compute_jobs-derived status DOWNGRADED (laundered) it:
--
--   * branch (c) ("all jobs done") wrote a bare 'complete', overwriting the
--     warning the runner had just written.
--   * branch (a) ("any non-terminal job") wrote a bare 'computing'. This fires
--     both PRE-MARK (services.job_worker.dispatch called the bridge before
--     main_worker flipped this job's own row to 'done' — row still 'running')
--     AND CROSS-JOB (a sibling strategy job — poll_positions / sync_funding —
--     still in flight when mark_compute_job_done bridges for the warned analytics
--     job). Whichever write ran, a later branch (c) then read 'computing' and
--     resolved to a plain 'complete'.
--
-- Live evidence: strategy 5fb2f06d ("Yellow Brick" / LTP068) carries
-- data_quality_flags:{negative_nav_guard:true} yet computation_status='complete' —
-- a guard-flagged, unreliable factsheet rendered to allocators as clean. Migration
-- 20260602120000 (which widened the CHECK to admit 'complete_with_warnings')
-- noted "0 'complete_with_warnings'" rows had ever persisted — the bridge reverted
-- every one. The `complete_with_warnings` channel was dead platform-wide.
--
-- Fix (this migration) — the bridge NEVER downgrades the warning
-- --------------------------------------------------------------
-- Branches (a) AND (c) both treat 'complete_with_warnings' as a sticky, more-
-- informative terminal success and preserve it via a CASE; every OTHER prior
-- state still resolves to 'computing' (a) / 'complete' (c) as before. This makes
-- preservation durable and ORDERING-INDEPENDENT: no sibling-job interleaving and
-- no pre-mark call can launder it, because no bridge branch writes over it. Only
-- the analytics runner clears the warning — via its own direct 'computing'
-- entry-write when it actually recomputes (a genuinely clean recompute then
-- reaches branch (c) as 'complete'). Branch (b) ('failed') still overrides, as a
-- job failure is the more severe state.
--
-- Companion change (services.job_worker.dispatch): the dispatch-side bridge is
-- now DEFERRED-only. For terminal outcomes the authoritative bridge is the
-- in-RPC PERFORM inside mark_compute_job_done/_failed AFTER the flip, so the
-- pre-mark dispatch call was redundant; removing it drops a per-job RPC and a
-- second (now-harmless, given branch (a) preserves) path to the clobber.
--
-- Re-based on the sole CREATE OR REPLACE of this function
-- (20260412094454_sync_strategy_analytics_status.sql) — verified via
-- grep across ALL migrations that every later migration only CALLS it. Branches
-- (b)/(d), the SECURITY DEFINER posture, search_path, and REVOKE are byte-
-- identical to that definition; branches (a) AND (c) gain the preserve CASE.
--
-- Known adjacent defects NOT fixed here (surgical): (1) branch (b)'s "any
-- failed_final → failed" poisons retry-after-failure (mig-038 status poison);
-- (2) a warned strategy whose sibling job hits failed_final then recovers
-- WITHOUT an analytics re-run is still laundered (branch (b) writes 'failed',
-- destroying the sticky value; the later branch (c) then sees 'failed' → plain
-- 'complete' while data_quality_flags still carry the warning). Neither is
-- fixable in the bridge without duplicating the runner's flag→status policy in
-- SQL: the warning is not derivable from compute_jobs, and although
-- data_quality_flags survives branch (b), only SOME flags promote to
-- complete_with_warnings (the runner's consumer_specific_flags logic), so
-- re-deriving warned-ness in the bridge would fork that policy and drift. It
-- stays deliberately runner-owned. Both interact with the mig-038 poison and are
-- tracked separately.

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
  -- written 'complete_with_warnings'. That warning is a runner-owned terminal
  -- sub-state the compute_jobs aggregate cannot see; this branch fires whenever
  -- ANY sibling job for the strategy is still in flight (e.g. a poll_positions /
  -- sync_funding job claimed in the same batch as the warned analytics job, or
  -- a pre-mark bridge call while this job's own row is still 'running'). Writing
  -- a bare 'computing' here would launder the warning, which branch (c) would
  -- then resolve to a plain 'complete' — ordering-dependent, so it leaked on
  -- multi-job (live-API) strategies. Preserve it. Only the analytics runner
  -- clears the warning, via its own 'computing' entry-write when it actually
  -- recomputes; the bridge must never downgrade it.
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
             THEN 'complete_with_warnings'
             ELSE 'computing'
           END,
           computation_error  = EXCLUDED.computation_error,
           computed_at        = now();
    RETURN;
  END IF;

  -- (b) all terminal, any failed_final → 'failed' with latest error (unchanged).
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
  -- 'complete_with_warnings' (a more-informative success the analytics worker
  -- already wrote); otherwise resolve to 'complete'. Clears any stale
  -- computation_error either way.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
  VALUES (p_strategy_id, 'complete', NULL)
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = CASE
           WHEN strategy_analytics.computation_status = 'complete_with_warnings'
           THEN 'complete_with_warnings'
           ELSE 'complete'
         END,
         computation_error  = NULL,
         computed_at        = now();
END;
$$;

COMMENT ON FUNCTION sync_strategy_analytics_status IS
  'Atomic UI status bridge. Derives strategy_analytics.computation_status from the compute_jobs aggregate for the given strategy in a single SQL statement (no read-then-write race). Mapping: any non-terminal row → computing, any failed_final → failed (with latest error), all done → complete; EXCEPT a row already at complete_with_warnings is preserved in BOTH the non-terminal (a) and all-done (c) branches (a sticky, more-informative terminal success the analytics runner wrote and only the runner clears); no rows → no-op (preserve existing). Called post-flip by mark_compute_job_done / mark_compute_job_failed (in-RPC PERFORM) and, for the DEFERRED outcome only, by services.job_worker.dispatch. Service-role only. See migrations 038 + 20260707120000.';

REVOKE ALL ON FUNCTION sync_strategy_analytics_status FROM PUBLIC, anon, authenticated;

-- Self-verifying DO block: structure + the preserve behavior.
DO $$
DECLARE
  v_secdef BOOLEAN;
  v_search_path TEXT;
BEGIN
  SELECT COALESCE(
    (SELECT p.prosecdef FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'sync_strategy_analytics_status'
      LIMIT 1), FALSE)
  INTO v_secdef;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'preserve-warnings migration failed: sync_strategy_analytics_status is not SECURITY DEFINER';
  END IF;

  SELECT array_to_string(p.proconfig, ',')
    INTO v_search_path
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'sync_strategy_analytics_status'
   LIMIT 1;
  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'preserve-warnings migration failed: search_path not set';
  END IF;

  -- strategy_analytics still has the UNIQUE/PK constraint on strategy_id.
  -- All three branches UPSERT via ON CONFLICT (strategy_id); if 001 ever loses
  -- this constraint the RPC breaks at first call, not at apply time. Re-assert
  -- it here (carried over from migration 038's self-check).
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'strategy_analytics'
      AND c.contype IN ('u', 'p')
      AND c.conkey = (
        SELECT array_agg(attnum)
          FROM pg_attribute
         WHERE attrelid = t.oid
           AND attname = 'strategy_id'
      )
  ) THEN
    RAISE EXCEPTION 'preserve-warnings migration failed: strategy_analytics.strategy_id has no UNIQUE/PK constraint — ON CONFLICT clauses will break';
  END IF;

  RAISE NOTICE 'sync_strategy_analytics_status now preserves complete_with_warnings in branches (a) and (c).';
END
$$;

COMMIT;
