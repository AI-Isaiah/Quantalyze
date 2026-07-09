-- Migration: close the SI-02 `failed_final`-bounce warned-status launder
-- =============================================================================
-- Root cause (v1.9, 2026-07-08) — the residual bounce launder (defect (2))
-- ----------------------------------------------------------------------
-- Migration 20260707120000 made sync_strategy_analytics_status PRESERVE a
-- runner-written 'complete_with_warnings' in branches (a)/(c) by reading the
-- EXISTING computation_status in a CASE. Its header documented ONE residual it
-- could NOT close in the bridge alone (defect (2)): a warned strategy whose
-- SIBLING job hits failed_final then recovers (done) WITHOUT an analytics re-run
-- is still laundered — branch (b) writes computation_status='failed' over the
-- sticky value, and the later branch (c) then reads 'failed' → plain 'complete'
-- while data_quality_flags still carry the warning. The preserve CASE keyed on
-- computation_status cannot survive its own overwrite, and re-deriving warned-ness
-- from data_quality_flags in SQL would FORK the runner's consumer_specific_flags
-- promotion policy (only SOME flags promote) and drift.
--
-- Fix (this migration) — a RUNNER-OWNED PERSISTED warned marker
-- --------------------------------------------------------------
-- The analytics runner now writes a sticky boolean `strategy_analytics.
-- computation_warned` in its OWN column wherever it writes the terminal status
-- (services/analytics_runner.py: TRUE when its consumer_specific_flags promotion
-- fires → 'complete_with_warnings', FALSE on a clean recompute). The bridge's
-- branches (a) and (c) CASE now READ that column
-- (`OR strategy_analytics.computation_warned`) instead of re-deriving warned-ness
-- from data_quality_flags — a ONE-COLUMN read, NOT a policy fork.
--
-- This closure is ORDERING-INDEPENDENT and closes defect (2): because the marker
-- lives in its OWN column, branch (b)'s 'failed' write over computation_status
-- CANNOT destroy it (the bridge NEVER writes computation_warned — only the runner
-- does), and branch (c)'s CASE resolves to 'complete_with_warnings' by reading the
-- marker regardless of the sibling-job interleaving. Only the runner clears the
-- warning, via its own clean-recompute terminal write (computation_warned=FALSE).
--
-- The alternative "runner idempotently re-writes its warned status on a sibling
-- recovery" was REJECTED: the analytics runner is NOT invoked when a sibling job
-- (poll_positions / sync_funding) transitions failed_final→recover, so it has no
-- execution point at that moment and could never close this launder. The
-- sticky-column marker is the only approach with a valid closure path.
--
-- Re-based on the sole live CREATE OR REPLACE of this function
-- (20260707120000_sync_status_preserve_warnings.sql) — verified via grep across
-- ALL migrations that every later migration only CALLS it. Branches (b)/(d), the
-- SECURITY DEFINER posture, search_path, and REVOKE are byte-identical to that
-- definition; branches (a) AND (c) gain ONLY the `OR ...computation_warned` read.
--
-- Known adjacent defect NOT fixed here (surgical, out of scope): branch (b)'s
-- "any failed_final → failed" poisons retry-after-failure (mig-038 status poison,
-- defect (1)). It is WATCHED during the v1.9 80-04 live re-runs, not touched here.

BEGIN;

-- Runner-owned PERSISTED warned marker. Its OWN column so a compute_jobs-derived
-- branch (b) 'failed' write over computation_status cannot destroy the warning.
-- The bridge READS it (branches (a)/(c)) but NEVER writes it — only the analytics
-- runner does. Backfill existing warned rows so an already-warned strategy is
-- protected immediately (the preserve migration ensured such rows can now exist).
ALTER TABLE public.strategy_analytics
  ADD COLUMN IF NOT EXISTS computation_warned BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.strategy_analytics
   SET computation_warned = TRUE
 WHERE computation_status = 'complete_with_warnings'
   AND computation_warned IS DISTINCT FROM TRUE;

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

-- Self-verifying DO block: structure + the marker-read behavior.
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
    RAISE EXCEPTION 'failed_final-bounce migration failed: sync_strategy_analytics_status is not SECURITY DEFINER';
  END IF;

  SELECT array_to_string(p.proconfig, ',')
    INTO v_search_path
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'sync_strategy_analytics_status'
   LIMIT 1;
  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'failed_final-bounce migration failed: search_path not set';
  END IF;

  -- The marker read must be present in BOTH preserving branches (else the
  -- failed_final-bounce launder re-opens). This is the fail-without-fix anchor.
  IF v_fn !~* 'OR\s+strategy_analytics\.computation_warned' THEN
    RAISE EXCEPTION 'failed_final-bounce migration failed: branches (a)/(c) do not read computation_warned (marker CASE missing)';
  END IF;

  -- The marker column must exist (the bridge reads it).
  IF NOT EXISTS(
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.strategy_analytics'::regclass
       AND attname = 'computation_warned'
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'failed_final-bounce migration failed: strategy_analytics.computation_warned column missing';
  END IF;

  -- strategy_analytics still has the UNIQUE/PK constraint on strategy_id.
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
    RAISE EXCEPTION 'failed_final-bounce migration failed: strategy_analytics.strategy_id has no UNIQUE/PK constraint — ON CONFLICT clauses will break';
  END IF;

  RAISE NOTICE 'sync_strategy_analytics_status now reads the runner-owned computation_warned marker in branches (a)/(c); failed_final-bounce launder closed.';
END
$$;

COMMIT;
