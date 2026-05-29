-- HOTFIX (prod incident, 2026-05-29) — mark_compute_job_failed writes a
-- non-existent column.
--
-- Background.
--   Migration 20260528183100 (mark_compute_job_strict_claim_token, shipped
--   PR #348 v0.24.15.0) rewrote mark_compute_job_failed and, in the terminal
--   UPDATE, wrote `last_error_kind = p_error_kind`. compute_jobs has NO
--   `last_error_kind` column — the classification column is `error_kind`
--   (text, with the transient/permanent/unknown CHECK the worker's ErrorKind
--   Literal mirrors). plpgsql does not validate column references in a
--   function body at CREATE time (check_function_bodies is off on Supabase),
--   so the rewrite deployed clean and fails only at RUNTIME with
--   SQLSTATE 42703 ('column "last_error_kind" of relation "compute_jobs"
--   does not exist') on EVERY call.
--
--   Effect (live since 2026-05-28): every failed-job marking errors, so a
--   failing job never transitions to failed_retry / failed_final — it stays
--   'running' until the watchdog (reset_stalled_compute_jobs) reclaims it,
--   then is retried, looping far past max_attempts. New failures never record
--   error_kind / last_error, and a 'permanent' classification (e.g. the
--   NEW-C12-09 poison-rescore preflight) can never persist. Observed in prod:
--   running/pending jobs stuck over-budget (attempts > max_attempts), some
--   jobs at hundreds of attempts.
--
-- Scope.
--   CREATE OR REPLACE mark_compute_job_failed with the byte-identical body of
--   the live function EXCEPT the terminal UPDATE writes `error_kind` instead
--   of `last_error_kind`. Signature unchanged (UUID, TEXT, TEXT, UUID) → no
--   overload, no DROP needed. The strict-claim-token fence, the P97
--   serialization branch, the backoff schedule, and the UI bridge are
--   preserved verbatim. The sibling mark_compute_job_done has no such typo.
--
--   This migration is the root-cause cure. The pre-existing stuck jobs are
--   reset operationally after deploy (a targeted one-off, NOT in this
--   migration, so it cannot touch legitimately-running jobs on any other
--   environment).
--
-- Production impact.
--   The worker is the sole caller. After this applies, failed jobs mark
--   cleanly again (failed_retry / failed_final with error_kind recorded) and
--   the watchdog retry-loop stops accreting stuck rows. No schema change; no
--   behavior change beyond writing the correct column.

SET LOCAL search_path = public, pg_catalog;

CREATE OR REPLACE FUNCTION mark_compute_job_failed(
  p_job_id      UUID,
  p_error       TEXT,
  p_error_kind  TEXT DEFAULT 'unknown',
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

  -- HOTFIX 2026-05-29: write `error_kind` (the real column + CHECK target),
  -- NOT the non-existent `last_error_kind` that mig 20260528183100 introduced.
  UPDATE compute_jobs
     SET status = v_new_status,
         last_error = p_error,
         error_kind = p_error_kind,
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
  'Backoff schedule preserved verbatim from mig 109 P4. HOTFIX 20260529180000: '
  'writes error_kind (not the non-existent last_error_kind that mig '
  '20260528183100 typo-introduced, which 42703-errored every failed mark).';

REVOKE ALL ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- Verification — validation branches WITHOUT a row seed. compute_jobs' four
-- target columns each carry an FK (portfolio_id→portfolios, strategy_id→
-- strategies, allocator_id→auth.users, api_key_id→api_keys) AND a
-- kind_target_coherence + target_xor CHECK, so a self-contained running-row
-- seed would 23503/23514 and abort the migration (same constraint the sibling
-- defer/mark migrations document). The terminal-UPDATE happy path — that
-- error_kind (not the non-existent last_error_kind) is written and a job
-- flips to failed_final — is pinned by the live-DB regression test
-- tests/test_compute_jobs_fencing.py::test_mark_compute_job_failed_writes_error_kind
-- and was validated pre-merge against the test DB on a seeded job. The
-- fix itself is schema-guaranteed: error_kind exists (compute_jobs_error_kind_check)
-- and last_error_kind does not, so the corrected reference cannot 42703.
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_raised_null_token  BOOLEAN := false;
  v_raised_bad_kind    BOOLEAN := false;
  v_raised_not_found   BOOLEAN := false;
BEGIN
  -- NULL token → invalid_parameter_value (strict fence).
  BEGIN
    PERFORM mark_compute_job_failed(gen_random_uuid(), 'probe', 'permanent', NULL);
  EXCEPTION WHEN invalid_parameter_value THEN v_raised_null_token := true;
  END;
  IF NOT v_raised_null_token THEN
    RAISE EXCEPTION 'HOTFIX verify failed: NULL claim_token did not raise invalid_parameter_value';
  END IF;

  -- Out-of-vocabulary error_kind → invalid_parameter_value.
  BEGIN
    PERFORM mark_compute_job_failed(gen_random_uuid(), 'probe', 'bogus_kind', gen_random_uuid());
  EXCEPTION WHEN invalid_parameter_value THEN v_raised_bad_kind := true;
  END;
  IF NOT v_raised_bad_kind THEN
    RAISE EXCEPTION 'HOTFIX verify failed: invalid error_kind did not raise invalid_parameter_value';
  END IF;

  -- Unknown job (valid token) → no_data_found (proves the function routes;
  -- the UPDATE column fix is covered by the live-DB test cited above).
  BEGIN
    PERFORM mark_compute_job_failed(gen_random_uuid(), 'probe', 'permanent', gen_random_uuid());
  EXCEPTION WHEN no_data_found THEN v_raised_not_found := true;
  END;
  IF NOT v_raised_not_found THEN
    RAISE EXCEPTION 'HOTFIX verify failed: unknown job did not raise no_data_found';
  END IF;
END;
$verify$;
