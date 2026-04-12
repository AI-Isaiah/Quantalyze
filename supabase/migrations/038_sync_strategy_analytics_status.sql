-- Migration 038: sync_strategy_analytics_status RPC
-- Sprint 3 Task 3.1 / Commit 2: UI status bridge between compute_jobs and
-- strategy_analytics.computation_status, atomic at the DB layer.
--
-- Why this migration exists
-- -------------------------
-- Sprint 3 moves ingestion + analytics from Next.js `after()` into the
-- durable compute_jobs queue (migrations 032/033). The UI still reads
-- strategy_analytics.computation_status to render the "computing /
-- complete / failed" badge on each strategy card — neither the wizard
-- nor the dashboard know anything about compute_jobs rows directly.
--
-- Without a bridge, strategy cards get stuck on 'pending' (the migration
-- 001 default) for every strategy that goes through the new worker path,
-- because nothing writes strategy_analytics.computation_status under the
-- new ingestion model. The bridge is a Python-side best-effort call
-- after every strategy-scoped job completes (see services.job_worker.
-- dispatch), invoking this RPC with the strategy_id.
--
-- Why a dedicated RPC instead of read-then-write in Python
-- --------------------------------------------------------
-- Eng review Finding 2-B (2026-04-11) required the derivation to be
-- atomic: two workers finishing jobs for the same strategy at nearly the
-- same time would otherwise race at "SELECT compute_jobs → derive
-- status → UPSERT strategy_analytics" and last-writer-wins, potentially
-- landing on a status that is already stale by the time it lands. A
-- single-statement RPC pushes the derivation into the database, which
-- uses MVCC + row locking to serialize the write.
--
-- Mapping rules (from Eng review Finding 2-C)
-- -------------------------------------------
-- Aggregate ALL compute_jobs rows for the strategy (not just the latest):
--   (a) ANY row in a non-terminal state (pending, running,
--       done_pending_children, failed_retry) → 'computing'
--   (b) else ANY row in 'failed_final' → 'failed' with
--       computation_error = latest failed_final's last_error
--   (c) else ALL rows 'done' → 'complete'
--   (d) no rows for this strategy → no-op (preserve whatever the row says
--       today, including the migration 001 'pending' default)
--
-- Case (d) is load-bearing: if we UPSERT 'pending' here on no-rows, we'd
-- stomp strategies that were previously marked 'complete' by the legacy
-- after() path, re-broadcasting "still computing" during the cutover
-- window. The RPC has to honor the existing value in that case.
--
-- Security posture
-- ----------------
-- SECURITY DEFINER with search_path = public, pg_catalog. REVOKE from
-- PUBLIC/anon/authenticated — only the service-role client (used by the
-- Python worker) should call this RPC. User-facing paths never invoke
-- the bridge; they read strategy_analytics.computation_status directly
-- via RLS on strategy_analytics itself (policies landed in 002).
--
-- No GRANT to authenticated: the bridge is infrastructure, not a user
-- action. Defense in depth.
--
-- Transaction wrapping, search_path, REVOKE defaults, and comment
-- conventions mirror migrations 032/033 exactly.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: sync_strategy_analytics_status RPC
-- --------------------------------------------------------------------------
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

  -- (d) no rows → preserve existing strategy_analytics row. Bail out
  -- before any write. Protects brand-new strategies with a default
  -- 'pending' row, and legacy strategies whose analytics landed through
  -- the pre-Sprint-3 after() path without ever going through compute_jobs.
  SELECT count(*) INTO v_job_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id;

  IF v_job_count = 0 THEN
    RETURN;
  END IF;

  -- (a) any non-terminal row → UI shows 'computing'. Terminal states are
  -- 'done' and 'failed_final' only; everything else is still in motion.
  -- failed_retry is non-terminal because the worker will pick it up again
  -- after the backoff window.
  SELECT count(*) INTO v_nonterminal_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id
     AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry');

  IF v_nonterminal_count > 0 THEN
    -- Upsert with on-conflict update. strategy_analytics has UNIQUE
    -- constraint on strategy_id (migration 001:72).
    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
    VALUES (p_strategy_id, 'computing', NULL)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = EXCLUDED.computation_status,
           computation_error  = EXCLUDED.computation_error;
    RETURN;
  END IF;

  -- (b) all terminal, any failed_final → UI shows 'failed'. Pull the
  -- latest failed_final row's last_error so the UI can render a meaningful
  -- diagnostic. `updated_at` is stamped by the compute_jobs_set_updated_at
  -- trigger (032:254), so ORDER BY updated_at DESC is the canonical way
  -- to pick the most recent terminal failure.
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
           computation_error  = EXCLUDED.computation_error;
    RETURN;
  END IF;

  -- (c) all rows 'done' → UI shows 'complete'. Clear any stale
  -- computation_error from a previous failed run so the UI doesn't show
  -- "complete with error X" contradictory state.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
  VALUES (p_strategy_id, 'complete', NULL)
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = EXCLUDED.computation_status,
         computation_error  = EXCLUDED.computation_error;
END;
$$;

COMMENT ON FUNCTION sync_strategy_analytics_status IS
  'Atomic UI status bridge. Derives strategy_analytics.computation_status from the compute_jobs aggregate for the given strategy in a single SQL statement (no read-then-write race). Mapping: any non-terminal row → computing, any failed_final → failed (with latest error), all done → complete, no rows → no-op (preserve existing). Called by services.job_worker.dispatch after every strategy-scoped job. Service-role only. See migration 038.';

REVOKE ALL ON FUNCTION sync_strategy_analytics_status FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
-- Matches 032/033/037 pattern. Loops named artifacts, raises if any
-- is missing at apply time.
DO $$
DECLARE
  v_exists BOOLEAN;
  v_secdef BOOLEAN;
  v_search_path TEXT;
BEGIN
  -- 1. Function exists
  SELECT EXISTS(
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'sync_strategy_analytics_status'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'Migration 038 failed: sync_strategy_analytics_status function missing';
  END IF;

  -- 2. SECURITY DEFINER
  SELECT COALESCE(
    (SELECT p.prosecdef FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.proname = 'sync_strategy_analytics_status'
      LIMIT 1),
    FALSE)
  INTO v_secdef;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Migration 038 failed: sync_strategy_analytics_status is not SECURITY DEFINER';
  END IF;

  -- 3. search_path baked in (defense against search-path hijack)
  SELECT array_to_string(p.proconfig, ',')
    INTO v_search_path
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.proname = 'sync_strategy_analytics_status'
   LIMIT 1;
  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'Migration 038 failed: sync_strategy_analytics_status does not SET search_path';
  END IF;

  -- 4. strategy_analytics still has the UNIQUE constraint on strategy_id
  -- (defensive — if 001 ever gets modified, this RPC's ON CONFLICT breaks).
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
    RAISE EXCEPTION 'Migration 038 failed: strategy_analytics.strategy_id has no UNIQUE/PK constraint — ON CONFLICT clauses will break';
  END IF;

  RAISE NOTICE 'Migration 038: sync_strategy_analytics_status RPC installed and verified.';
END
$$;

COMMIT;
