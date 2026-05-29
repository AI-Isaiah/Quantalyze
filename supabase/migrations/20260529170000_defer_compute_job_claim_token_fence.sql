-- audit-2026-05-07 cluster CL10 (NEW-C12-06) — claim_token fence on
-- defer_compute_job.
--
-- Background.
--   Migration 117 (`20260515114555_compute_jobs_claim_token_fencing.sql`)
--   added a per-claim `claim_token UUID` to compute_jobs and gated the
--   terminal mark RPCs (`mark_compute_job_done` / `mark_compute_job_failed`)
--   on it so a worker (W1) whose job was reclaimed by the watchdog and
--   re-claimed by another worker (W2) under a fresh token cannot mark W2's
--   actively-running row. `reset_stalled_compute_jobs` additionally NULLs
--   `claim_token` on reclaim (`20260516104201`:662,686).
--
--   `defer_compute_job` (migration 033, `20260412094449`) was NOT fenced.
--   It flips a running job back to pending, decrements attempts, NULLs
--   claimed_at/claimed_by and overwrites last_error — guarded ONLY by
--   `status = 'running'`. So the circuit-breaker preflight `_defer(J)` in
--   the worker (`services/job_worker.py:_check_circuit_breaker`) can yank a
--   job that the watchdog reclaimed and W2 re-claimed (status is running
--   again) back to pending: it decrements W2's attempts, clobbers W2's
--   last_error, and — because defer never NULLed claim_token — returns the
--   row to pending carrying W2's STALE token, weakening the fence on the
--   next claim cycle. The DEFERRED outcome is swallowed with only a log
--   (main_worker.py), so this corruption is silent.
--
-- Scope.
--   1. Re-create `defer_compute_job` with a trailing `p_claim_token UUID
--      DEFAULT NULL` parameter (signature change → DROP the 3-arg overload
--      first, exactly as mig 117 did for mark_compute_job_done, so we do
--      not leave two overloads behind).
--   2. Gate the running-row read on the token with mig-117's BACK-COMPAT
--      disjunct: `AND (p_claim_token IS NULL OR claim_token = p_claim_token)`.
--      The `p_claim_token IS NULL` arm preserves the legacy path for the
--      brief deploy window between this migration auto-applying to PROD on
--      merge and the Railway worker redeploying with the token threaded —
--      the old worker (no token) keeps deferring exactly as today (no
--      fence), and once the new worker threads `job['claim_token']` the
--      fence is live. A strict-NULL tightening (cf. mig
--      `20260528183100`) is a deliberate follow-up after the worker
--      rollout is confirmed, not part of this change.
--   3. On a NOT FOUND running-row read, re-read status+claim_token and
--      RAISE serialization_failure when the row IS running but the token
--      mismatches (W1 lost the race to W2's re-claim) — mirroring
--      mark_compute_job_done's P97 branch. Otherwise keep the existing
--      no_data_found "not found or not running" error verbatim.
--   4. Add `claim_token = NULL` to the UPDATE SET so a deferred row drops
--      its stale fence token (matches reset_stalled_compute_jobs).
--   5. REVOKE ALL FROM PUBLIC, anon, authenticated — identical to the
--      pre-existing grant posture; service_role EXECUTE is provided by the
--      schema-level default privilege (the same mechanism mark_* relies on,
--      preserved across DROP+CREATE for new functions in schema public).
--
-- Production impact.
--   The worker is the sole caller (`_check_circuit_breaker._defer`). The
--   back-compat disjunct means NO behavior change until the worker threads
--   the token; after that, a token mismatch on a re-claimed running row
--   raises serialization_failure (caught/classified by the worker) instead
--   of silently yanking W2's job. attempts/last_error semantics on the
--   legitimate defer path are unchanged.

SET LOCAL search_path = public, pg_catalog;

-- Signature changes (adds p_claim_token): drop the 3-arg overload so we do
-- not end up with both defer_compute_job(uuid,integer,text) AND
-- defer_compute_job(uuid,integer,text,uuid) live at once.
DROP FUNCTION IF EXISTS defer_compute_job(UUID, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION defer_compute_job(
  p_job_id        UUID,
  p_defer_seconds INTEGER,
  p_reason        TEXT DEFAULT NULL,
  p_claim_token   UUID DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_current_attempts INTEGER;
  v_next_attempt     TIMESTAMPTZ;
  v_current_status   TEXT;
  v_current_token    UUID;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'defer_compute_job: p_job_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_defer_seconds IS NULL OR p_defer_seconds < 0 THEN
    RAISE EXCEPTION 'defer_compute_job: p_defer_seconds must be >= 0, got %', p_defer_seconds
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Cap defer at 1 hour to prevent a misconfigured caller from parking a
  -- job for days and silently breaking downstream widgets that expect
  -- recent data. The longest legitimate cooldown today is Bybit at
  -- 10 minutes.
  IF p_defer_seconds > 3600 THEN
    RAISE EXCEPTION 'defer_compute_job: p_defer_seconds % exceeds cap of 3600 (1 hour)', p_defer_seconds
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- NEW-C12-06 claim-token fence (mirrors mark_compute_job_done, mig 117).
  -- Lock and read the running row, requiring the token to match when one is
  -- supplied. Deferring a non-running job doesn't make sense and would
  -- silently corrupt state if we let it through.
  SELECT attempts
    INTO v_current_attempts
    FROM compute_jobs
    WHERE id = p_job_id
      AND status = 'running'
      AND (p_claim_token IS NULL OR claim_token = p_claim_token)
    FOR UPDATE;

  IF NOT FOUND THEN
    -- Distinguish a token mismatch on a still-running row (W1 lost the race
    -- to W2's watchdog re-claim) from a genuine not-found / not-running,
    -- mirroring mark_compute_job_done's P97 serialization_failure branch.
    SELECT status, claim_token
      INTO v_current_status, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF FOUND
       AND v_current_status = 'running'
       AND p_claim_token IS NOT NULL
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'defer_compute_job: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
    END IF;

    RAISE EXCEPTION 'defer_compute_job: job % not found or not running', p_job_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_next_attempt := now() + (p_defer_seconds * interval '1 second');

  -- GREATEST(0, ...) defense: if attempts somehow landed at 0 before this
  -- call (shouldn't happen under the normal claim path but migrations
  -- or manual INSERTs could), don't let us go negative.
  UPDATE compute_jobs
     SET status          = 'pending',
         attempts        = GREATEST(0, v_current_attempts - 1),
         next_attempt_at = v_next_attempt,
         claimed_at      = NULL,
         claimed_by      = NULL,
         claim_token     = NULL,  -- NEW-C12-06: drop the stale fence token
         last_error      = p_reason
   WHERE id = p_job_id;

  RETURN v_next_attempt;
END;
$$;

COMMENT ON FUNCTION defer_compute_job(UUID, INTEGER, TEXT, UUID) IS
  'Defers a running job back to pending for circuit-breaker cooldowns. '
  'Decrements attempts by 1 to cancel claim_compute_jobs increment so the '
  'defer does not burn a retry. NEW-C12-06 (CL10): p_claim_token fences the '
  'running-row read (back-compat NULL arm for the deploy window) and a '
  'token mismatch on a still-running row raises serialization_failure; the '
  'deferred row has claim_token NULLed so it drops the stale fence token. '
  'Worker is sole caller (services/job_worker._check_circuit_breaker). '
  'See migrations 033 + 117.';

REVOKE ALL ON FUNCTION defer_compute_job(UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- Verification — exercise the new 4-arg signature + validations WITHOUT a
-- row seed. (compute_jobs.strategy_id → strategies.id → profiles.id NOT NULL,
-- so seeding a real running row inside the migration would 23503 and abort
-- the whole migration — the same constraint mig 20260528183100 documents.
-- The token-mismatch fence on a seeded running row is pinned by the live-DB
-- regression test tests/test_compute_jobs_fencing.py instead.)
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_raised_cap        BOOLEAN := false;
  v_raised_not_found  BOOLEAN := false;
  v_dummy_job UUID := gen_random_uuid();
BEGIN
  -- Probe A: out-of-range p_defer_seconds → invalid_parameter_value
  -- (proves the 4-arg signature routes + validation fires).
  BEGIN
    PERFORM defer_compute_job(v_dummy_job, 99999, 'probe', gen_random_uuid());
  EXCEPTION
    WHEN invalid_parameter_value THEN
      v_raised_cap := true;
  END;
  IF NOT v_raised_cap THEN
    RAISE EXCEPTION 'CL10 verification failed: defer_compute_job(...,99999,...) did not raise invalid_parameter_value';
  END IF;

  -- Probe B: defer a non-existent job (with a token) → no_data_found
  -- (proves the not-found branch, not the token-mismatch branch — no row).
  BEGIN
    PERFORM defer_compute_job(v_dummy_job, 60, 'probe', gen_random_uuid());
  EXCEPTION
    WHEN no_data_found THEN
      v_raised_not_found := true;
  END;
  IF NOT v_raised_not_found THEN
    RAISE EXCEPTION 'CL10 verification failed: defer_compute_job on missing job did not raise no_data_found';
  END IF;
END;
$verify$;
