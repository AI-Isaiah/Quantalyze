-- Phase 18 / Day-2 root-cause fix
--
-- WHAT
-- Make `mark_compute_job_done` and `mark_compute_job_failed` atomically
-- recompute `strategy_analytics.computation_status` for the affected
-- strategy in the SAME transaction that flips `compute_jobs.status` to
-- terminal. Eliminates the dispatch-order race in `main_worker.py`
-- where the UI bridge fired BEFORE the row reached terminal state.
--
-- WHY (root cause, found 2026-05-05 via wizard E2E + Railway log
-- timestamps + Supabase row inspection):
--
-- The Python worker dispatch loop (`main_worker.py:155-165`) ran in this
-- order, starting at Sprint 3:
--
--   1. result = await dispatch(job)
--        ├─ run_sync_trades_job()  → 11:10:02.317 work complete
--        └─ sync_strategy_analytics_status RPC at 11:10:02.638
--           → at this moment compute_jobs.status is STILL 'running'
--           → 038 RPC's "any non-terminal → 'computing'" branch fires
--           → strategy_analytics.computation_status = 'computing'
--   2. await mark_compute_job_done(job.id)  → 11:10:02.689
--           → compute_jobs.status NOW = 'done'
--           → BUT the bridge is never called again
--           → strategy_analytics frozen at 'computing' forever
--
-- The wizard's `SyncPreviewStep` polls
-- `strategy_analytics.computation_status` for `'complete'`. It never
-- arrived. Customers saw "Sync is taking much longer than expected"
-- and gave up — exactly the recurrence pattern that drove 5 patches in
-- 19 days without fixing the root cause.
--
-- WHY THIS FIX (vs. moving the bridge call to main_worker.py post-mark)
-- - Atomic: bridge runs in the SAME transaction as the status flip.
--   No reader can see the in-between state.
-- - Defense in depth: any future caller of `mark_compute_job_done` /
--   `mark_compute_job_failed` (manual re-runs, the watchdog at
--   `main_worker.py:209`, the cron tick at `routers/cron.py`) gets
--   correct UI status without remembering to call the bridge separately.
-- - The 038 RPC is idempotent and cheap: a single SELECT count(*) plus
--   at most one UPSERT inside a SECURITY DEFINER function.
--
-- ROLLBACK
-- Restoring the prior version of these RPCs (without the bridge tail
-- call) is safe — the worker continues to call
-- `sync_strategy_analytics_status` from `dispatch()`, which means
-- failure-mode is "back to the racy pre-fix behaviour", not "broken".
-- See migration 032 STEP 12 / STEP 13 for the original definitions.
--
-- CALL-SITE COMPATIBILITY
-- Function signatures, parameter defaults, and RETURNS types are all
-- preserved exactly.
--   - mark_compute_job_done(uuid) RETURNS VOID
--   - mark_compute_job_failed(uuid, text, text DEFAULT 'unknown') RETURNS TIMESTAMPTZ
-- Existing callers
--   - analytics-service/main_worker.py:160 (mark_done after dispatch)
--   - analytics-service/main_worker.py:174 (mark_failed after dispatch)
--   - analytics-service/main_worker.py:207 (mark_failed_fallback)
-- continue to work unchanged.

BEGIN;

-- --------------------------------------------------------------------
-- mark_compute_job_done (Phase 18 — preserves migration 032 STEP 12
-- semantics verbatim and adds atomic bridge tail call)
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_compute_job_done(
  p_job_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_strategy_id UUID;
  v_child_id    UUID;
BEGIN
  -- Atomically flip running → done AND capture strategy_id in one
  -- statement via UPDATE … RETURNING. Preserves the original
  -- `WHERE … AND status='running'` guard so concurrent calls cannot
  -- both succeed.
  UPDATE compute_jobs
     SET status = 'done'
   WHERE id = p_job_id
     AND status = 'running'
  RETURNING strategy_id INTO v_strategy_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_compute_job_done: job % not found or not running', p_job_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Advance any children that are now fully ready (fan-in).
  FOR v_child_id IN
    SELECT id FROM compute_jobs
      WHERE p_job_id = ANY(parent_job_ids)
        AND status = 'done_pending_children'
  LOOP
    IF check_fan_in_ready(v_child_id) THEN
      UPDATE compute_jobs
         SET status = 'pending',
             next_attempt_at = now()
       WHERE id = v_child_id
         AND status = 'done_pending_children';
    END IF;
  END LOOP;

  -- Phase 18: atomic UI status bridge. Now that the row is 'done',
  -- recompute strategy_analytics.computation_status from the
  -- compute_jobs aggregate. Same transaction, no race possible.
  -- Strategy-scoped jobs only — portfolio jobs have a NULL strategy_id.
  IF v_strategy_id IS NOT NULL THEN
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;
END;
$$;

COMMENT ON FUNCTION mark_compute_job_done IS
  'Terminal success transition. Flips status=running→done atomically, advances any waiting children via fan-in, and (Phase 18) recomputes strategy_analytics.computation_status via sync_strategy_analytics_status in the SAME transaction so the wizard never sees a "running job + ''computing'' UI" race. See migration 099.';

REVOKE ALL ON FUNCTION mark_compute_job_done FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- mark_compute_job_failed (Phase 18 — preserves migration 032 STEP 13
-- semantics verbatim and adds atomic bridge tail call)
-- --------------------------------------------------------------------
-- Original schedule preserved: attempt 1 → +30s, attempt 2 → +2min,
-- ELSE → +8min. Permanent / max-attempts → failed_final.
-- Returns the scheduled next_attempt_at (TIMESTAMPTZ). Releases the
-- claim (claimed_at/claimed_by NULL) so the next worker can pick it up.
CREATE OR REPLACE FUNCTION mark_compute_job_failed(
  p_job_id     UUID,
  p_error      TEXT,
  p_error_kind TEXT DEFAULT 'unknown'
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_attempts     INTEGER;
  v_max_attempts INTEGER;
  v_next_attempt TIMESTAMPTZ;
  v_new_status   TEXT;
  v_strategy_id  UUID;
BEGIN
  IF p_error_kind IS NOT NULL
     AND p_error_kind NOT IN ('transient', 'permanent', 'unknown') THEN
    RAISE EXCEPTION 'mark_compute_job_failed: p_error_kind must be transient/permanent/unknown, got %', p_error_kind
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT attempts, max_attempts, strategy_id
    INTO v_attempts, v_max_attempts, v_strategy_id
    FROM compute_jobs
    WHERE id = p_job_id
      AND status = 'running'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_compute_job_failed: job % not found or not running', p_job_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Permanent failures skip retries regardless of attempt count.
  IF p_error_kind = 'permanent' THEN
    v_new_status := 'failed_final';
    v_next_attempt := now();
  ELSIF v_attempts >= v_max_attempts THEN
    v_new_status := 'failed_final';
    v_next_attempt := now();
  ELSE
    v_new_status := 'failed_retry';
    -- Backoff schedule: attempt 1 -> +30s, attempt 2 -> +2min, ELSE -> +8min.
    -- See migration 032 STEP 13 comment for ELSE-arm rationale; we preserve
    -- it verbatim so existing operator runbooks remain accurate.
    CASE
      WHEN v_attempts <= 1 THEN v_next_attempt := now() + interval '30 seconds';
      WHEN v_attempts = 2 THEN v_next_attempt := now() + interval '2 minutes';
      ELSE                      v_next_attempt := now() + interval '8 minutes';
    END CASE;
  END IF;

  UPDATE compute_jobs
     SET status          = v_new_status,
         last_error      = p_error,
         error_kind      = COALESCE(p_error_kind, 'unknown'),
         next_attempt_at = v_next_attempt,
         claimed_at      = NULL,
         claimed_by      = NULL
   WHERE id = p_job_id;

  -- Phase 18: atomic UI status bridge. The 038 RPC classifies
  -- failed_retry as non-terminal and leaves UI at 'computing' (correct
  -- — the row will be re-claimed). On failed_final it sets UI to
  -- 'failed' with the diagnostic from the latest failed_final row's
  -- last_error.
  IF v_strategy_id IS NOT NULL THEN
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;

  RETURN v_next_attempt;
END;
$$;

COMMENT ON FUNCTION mark_compute_job_failed IS
  'Transitions a running job to failed_retry (with backoff) or failed_final. Backoff schedule: attempt 1 -> +30s, 2 -> +2min, ELSE -> +8min. Permanent errors go straight to failed_final regardless of attempts. (Phase 18) Recomputes strategy_analytics.computation_status atomically in the same transaction. Returns the scheduled next_attempt_at. See migration 099.';

REVOKE ALL ON FUNCTION mark_compute_job_failed FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- Self-verifying assertion — invariant must hold after the migration.
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_done_body   TEXT;
  v_failed_body TEXT;
BEGIN
  SELECT pg_get_functiondef('mark_compute_job_done(uuid)'::regprocedure)
    INTO v_done_body;
  IF position('sync_strategy_analytics_status' IN v_done_body) = 0 THEN
    RAISE EXCEPTION 'Migration 099 invariant violated: mark_compute_job_done body lacks sync_strategy_analytics_status tail call';
  END IF;

  SELECT pg_get_functiondef('mark_compute_job_failed(uuid, text, text)'::regprocedure)
    INTO v_failed_body;
  IF position('sync_strategy_analytics_status' IN v_failed_body) = 0 THEN
    RAISE EXCEPTION 'Migration 099 invariant violated: mark_compute_job_failed body lacks sync_strategy_analytics_status tail call';
  END IF;

  RAISE NOTICE 'Migration 099 applied: mark_compute_job_done + mark_compute_job_failed now call sync_strategy_analytics_status atomically.';
END;
$$;

COMMIT;
