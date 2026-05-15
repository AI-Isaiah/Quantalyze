-- Rollback for migration 20260515210000_compute_jobs_high_hardening.sql
-- audit-2026-05-07 H-0849 / H-0851 / H-0857 / H-0865 / H-0866.
--
-- Restores the pre-forward state:
--   * Drops the compute_jobs.metadata size + claimed_by shape CHECKs.
--   * Rebuilds compute_jobs_parent_lookup as a full-table GIN (no
--     partial WHERE) — the mig 032 shape.
--   * Restores the mig 117 mark_compute_job_done body verbatim (the
--     `p_job_id = ANY(parent_job_ids)` predicate, no GET DIAGNOSTICS).
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + DROP INDEX IF EXISTS +
-- CREATE OR REPLACE FUNCTION + IF NOT EXISTS index recreate.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: drop the CHECK constraints
-- --------------------------------------------------------------------------
ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_metadata_size_bounded;

ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_claimed_by_safe;

-- --------------------------------------------------------------------------
-- STEP 2: restore the full-table GIN on parent_job_ids
-- --------------------------------------------------------------------------
DROP INDEX IF EXISTS compute_jobs_parent_lookup;

CREATE INDEX IF NOT EXISTS compute_jobs_parent_lookup
  ON compute_jobs USING GIN (parent_job_ids);

-- --------------------------------------------------------------------------
-- STEP 3: restore the mig 117 mark_compute_job_done body
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_compute_job_done(
  p_job_id      UUID,
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
  UPDATE compute_jobs
     SET status = 'done'
   WHERE id = p_job_id
     AND status = 'running'
     AND (p_claim_token IS NULL OR claim_token = p_claim_token)
  RETURNING strategy_id INTO v_strategy_id;

  IF NOT FOUND THEN
    SELECT status, strategy_id, claim_token
      INTO v_current_status, v_strategy_id, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % not found', p_job_id
        USING ERRCODE = 'no_data_found';
    END IF;

    IF v_current_status = 'done' THEN
      IF p_claim_token IS NULL OR v_current_token IS NOT DISTINCT FROM p_claim_token THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (late mark on already-done row, caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
    END IF;

    IF v_current_status = 'running'
       AND p_claim_token IS NOT NULL
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
    END IF;

    RAISE EXCEPTION 'mark_compute_job_done: job % in unexpected status % (expected running)',
      p_job_id, v_current_status
      USING ERRCODE = 'no_data_found';
  END IF;

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

  IF v_strategy_id IS NOT NULL THEN
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION mark_compute_job_done(UUID, UUID) FROM PUBLIC, anon, authenticated;

COMMIT;
