-- audit-2026-05-07 B5 (C-PR5-02 defense-in-depth) — strict claim_token
-- on terminal mark RPCs.
--
-- Background.
--   Migration 117 (`20260515114555_compute_jobs_claim_token_fencing.sql`)
--   added `p_claim_token UUID DEFAULT NULL` to mark_compute_job_done /
--   mark_compute_job_failed and gated the running→done/failed_retry/
--   failed_final transitions on it. The transition gate read:
--
--       WHERE ... AND (p_claim_token IS NULL OR claim_token = p_claim_token)
--
--   The `p_claim_token IS NULL` disjunct preserved a back-compat path
--   for legacy callers that hadn't been updated to thread the token.
--   `analytics-service/main_worker.py` (the only production caller; see
--   lines 522, 543, 589) was updated by PR #347 to thread `claim_token`
--   to BOTH mark RPCs and to the late-mark fallback path. The C-PR5-02
--   regression test (`tests/test_main_worker.py::
--   test_c_pr5_02_no_null_claim_token_on_mark_done_for_fenced_jobs`)
--   pins that contract — the worker can no longer regress to a NULL
--   token without breaking the build.
--
--   With the worker rollout complete, the `p_claim_token IS NULL`
--   disjunct is now pure attack surface: any holder of `SERVICE_KEY`
--   (or any future legacy code path that calls the RPC without
--   forwarding the token) can bypass the P97 race fence. Per the
--   PR-5 security review (`security.md` C-PR5-02 mitigation step 2),
--   we now remove the disjunct.
--
-- Scope.
--   1. Replace `mark_compute_job_done(p_job_id, p_claim_token)` body —
--      reject `p_claim_token IS NULL` with 22023 invalid_parameter_value
--      BEFORE touching the row.
--   2. Same for `mark_compute_job_failed(p_job_id, p_error, p_error_kind,
--      p_claim_token)`.
--   3. Drop the IS NULL disjuncts in BOTH the running-row WHERE clauses
--      and the already-done idempotent-retry branches — token is now
--      mandatory; mismatch still raises 'serialization_failure' per
--      mig 117's P97 contract.
--   4. Signature unchanged (DEFAULT NULL preserved) so PostgREST routing
--      is stable; callers that omit the parameter now get a clean
--      structured 22023 instead of silently slipping through the fence.
--   5. Verification DO block: NULL token MUST raise; valid token MUST
--      pass on a seeded running job.
--
-- Production impact.
--   Worker is the sole caller (3 sites in main_worker.py); all 3 thread
--   the token from `claim_compute_jobs` result rows. No production-side
--   behavior change for the worker path. Direct-SERVICE_KEY callers that
--   omitted the token (none known) would now 22023.

SET LOCAL search_path = public, pg_catalog;

-- --------------------------------------------------------------------------
-- STEP 1: mark_compute_job_done — strict token, no NULL back-compat.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_compute_job_done(
  p_job_id     UUID,
  p_claim_token UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_strategy_id      UUID;
  v_current_status   TEXT;
  v_current_token    UUID;
  v_child_id         UUID;
BEGIN
  -- audit-2026-05-07 B5: token is now mandatory. NULL was a documented
  -- pre-mig-117 back-compat path; the only production caller (main_worker)
  -- threads the token uniformly post-PR-#347.
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'mark_compute_job_done: p_claim_token is required (post-mig-117 strict fence)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Atomic flip running → done with token fence + strategy capture.
  UPDATE compute_jobs
     SET status = 'done'
   WHERE id = p_job_id
     AND status = 'running'
     AND claim_token = p_claim_token
  RETURNING strategy_id INTO v_strategy_id;

  IF NOT FOUND THEN
    -- Row may exist but isn't running, OR row missing, OR token mismatch.
    SELECT status, strategy_id, claim_token
      INTO v_current_status, v_strategy_id, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % not found', p_job_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- mig 109 P6 / mig 117 second-pass fix #2: idempotent retry on
    -- already-done row ONLY when the caller's token matches the recorded
    -- one. The pre-B5 path also accepted NULL — removed now that NULL is
    -- rejected at the entrypoint above.
    IF v_current_status = 'done' THEN
      IF v_current_token IS NOT DISTINCT FROM p_claim_token THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (late mark on already-done row, caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
    END IF;

    -- mig 117 P97: token mismatch on a still-running row.
    IF v_current_status = 'running'
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
    END IF;

    -- Row in some other state (failed_retry, failed_final, pending,
    -- done_pending_children). Surface loudly.
    RAISE EXCEPTION 'mark_compute_job_done: job % in unexpected status % (expected running)',
      p_job_id, v_current_status
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Advance any children that are now fully ready.
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

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;
END;
$$;

COMMENT ON FUNCTION mark_compute_job_done(UUID, UUID) IS
  'Terminal success transition. Mig 117 / P97 fence + B5 strict-token '
  'follow-up: p_claim_token MUST be non-NULL (NULL raises 22023 '
  'invalid_parameter_value); mismatch on still-running or already-done '
  'row raises serialization_failure. Worker is sole caller; threading '
  'pinned by tests/test_main_worker.py::test_c_pr5_02_no_null_claim_token_*.';

REVOKE ALL ON FUNCTION mark_compute_job_done(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 2: mark_compute_job_failed — strict token, no NULL back-compat.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_compute_job_failed(
  p_job_id     UUID,
  p_error      TEXT,
  p_error_kind TEXT DEFAULT 'unknown',
  p_claim_token UUID DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_attempts      INTEGER;
  v_max_attempts  INTEGER;
  v_next_attempt  TIMESTAMPTZ;
  v_new_status    TEXT;
  v_strategy_id   UUID;
  v_current_token UUID;
  v_current_status TEXT;
BEGIN
  -- audit-2026-05-07 B5: token mandatory (see mark_compute_job_done above).
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'mark_compute_job_failed: p_claim_token is required (post-mig-117 strict fence)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

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
      AND claim_token = p_claim_token
    FOR UPDATE;

  IF NOT FOUND THEN
    SELECT status, claim_token
      INTO v_current_status, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'mark_compute_job_failed: job % not found', p_job_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- mig 117 P97: token mismatch on a still-running row.
    IF v_current_status = 'running'
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_failed: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
    END IF;

    RAISE EXCEPTION 'mark_compute_job_failed: job % not running (status=%)', p_job_id, v_current_status
      USING ERRCODE = 'no_data_found';
  END IF;

  IF p_error_kind = 'permanent' THEN
    v_new_status := 'failed_final';
    v_next_attempt := now();
  ELSIF v_attempts >= v_max_attempts THEN
    v_new_status := 'failed_final';
    v_next_attempt := now();
  ELSE
    v_new_status := 'failed_retry';
    CASE
      WHEN v_attempts <= 1 THEN v_next_attempt := now() + interval '30 seconds';
      WHEN v_attempts = 2 THEN v_next_attempt := now() + interval '2 minutes';
      WHEN v_attempts = 3 THEN v_next_attempt := now() + interval '10 minutes';
      WHEN v_attempts = 4 THEN v_next_attempt := now() + interval '1 hour';
      ELSE                     v_next_attempt := now() + interval '6 hours';
    END CASE;
  END IF;

  UPDATE compute_jobs
     SET status = v_new_status,
         last_error = p_error,
         last_error_kind = p_error_kind,
         next_attempt_at = v_next_attempt
   WHERE id = p_job_id;

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;

  RETURN v_next_attempt;
END;
$$;

COMMENT ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) IS
  'Terminal failure transition. Mig 117 / P97 fence + B5 strict-token '
  'follow-up: p_claim_token MUST be non-NULL (NULL raises 22023 '
  'invalid_parameter_value); mismatch raises serialization_failure. '
  'Backoff schedule preserved verbatim from mig 109 P4.';

REVOKE ALL ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 3: verification — strict-NULL gate on both RPCs.
--
-- The happy-path is NOT verified inline. A first draft seeded a real
-- compute_jobs row to exercise the running→done flip, but
-- compute_jobs.strategy_id FK → strategies.id, strategies.user_id FK →
-- profiles.id (NOT NULL). A `gen_random_uuid()` seed for user_id raises
-- 23503 foreign_key_violation, the DO block rolls back, and the entire
-- migration aborts — including the function body replacement that is
-- the only deliverable here. Since the function body's strict-NULL gate
-- IS exercised below (and live-DB pytest coverage in
-- `tests/test_compute_jobs_fencing.py` already pins the running→done
-- happy path against the test project per `project_supabase_migrate_auto_on_push`),
-- the happy-path probe is removed from the migration itself.
-- --------------------------------------------------------------------------

DO $verify$
DECLARE
  v_raised_done BOOLEAN := false;
  v_raised_failed BOOLEAN := false;
  v_dummy_job UUID := gen_random_uuid();
BEGIN
  -- Probe A: mark_compute_job_done with NULL → 22023.
  BEGIN
    PERFORM mark_compute_job_done(v_dummy_job, NULL);
    -- Should never reach here.
  EXCEPTION
    WHEN invalid_parameter_value THEN
      v_raised_done := true;
  END;

  IF NOT v_raised_done THEN
    RAISE EXCEPTION 'B5 verification failed: mark_compute_job_done(NULL) did not raise 22023';
  END IF;

  -- Probe B: mark_compute_job_failed with NULL → 22023.
  BEGIN
    PERFORM mark_compute_job_failed(v_dummy_job, 'probe', 'unknown', NULL);
  EXCEPTION
    WHEN invalid_parameter_value THEN
      v_raised_failed := true;
  END;

  IF NOT v_raised_failed THEN
    RAISE EXCEPTION 'B5 verification failed: mark_compute_job_failed(NULL) did not raise 22023';
  END IF;
END;
$verify$;
