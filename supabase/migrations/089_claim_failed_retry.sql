-- Migration 089: extend claim filters to include failed_retry rows whose
-- next_attempt_at has arrived.
--
-- Why this migration exists
-- -------------------------
-- The compute_jobs queue had a documented retry mechanic (`mark_compute_job_failed`
-- writes status='failed_retry' with backoff schedule 30s/2min/8min before
-- transitioning to 'failed_final' at attempt 3) but no code path actually
-- transitioned 'failed_retry' back to 'pending' when next_attempt_at arrived.
-- Both `claim_compute_jobs` (migration 032) and `claim_compute_jobs_with_priority`
-- (migration 086) filtered `WHERE status = 'pending'`, so failed_retry rows
-- sat in the queue forever.
--
-- Production state observed before this fix on 2026-04-28:
--   compute_analytics:        15 stuck (all overdue, Phase 12 backfill)
--   poll_allocator_positions:  4 stuck (overdue from 2026-04-27, ~24h)
--   rescore_allocator:         2 stuck (oldest from 2026-04-19, 9 days)
--
-- Migration 038 line 106 documented the INTENT ("failed_retry is non-terminal
-- because the worker will pick it up again") but the implementation never
-- caught up.
--
-- What this migration does
-- ------------------------
-- 1. Replaces `claim_compute_jobs` to claim `status IN ('pending','failed_retry')`
--    where next_attempt_at <= now(). Same FOR UPDATE SKIP LOCKED concurrency.
-- 2. Replaces `claim_compute_jobs_with_priority` (Phase 12 / migration 086)
--    with the same widened filter. Throttle probe (`v_high_pending`) is also
--    updated to count failed_retry alongside pending so backfill jobs in
--    failed_retry state are correctly throttled when normal/high traffic exists.
-- 3. Drops + recreates `idx_compute_jobs_priority_pending` (migration 086) with
--    the widened predicate so the throttle probe stays index-only.
--
-- Attempts counter semantics
-- --------------------------
-- claim_compute_jobs increments `attempts` on every claim (mig 032:565).
-- mark_compute_job_failed does NOT increment (it reads the already-incremented
-- value). So a failed_retry row at attempts=N gets re-claimed → attempts=N+1.
-- After max_attempts (default 3), mark_compute_job_failed transitions directly
-- to failed_final regardless of error_kind. The 30s/2min/8min backoff schedule
-- in mark_compute_job_failed (mig 032:743-747) still gates how soon the row
-- becomes claimable again via next_attempt_at.
--
-- H-B hardening: both RPCs use SET search_path = public, pg_temp (NOT pg_catalog).
-- This is a tightening for the legacy claim_compute_jobs (was pg_catalog before).
-- Verified safe: pg_catalog is always implicitly searched first by Postgres
-- regardless of search_path, so unqualified `now()` etc. still resolve correctly.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: replace claim_compute_jobs with widened filter
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_compute_jobs(
  p_batch_size INTEGER,
  p_worker_id  TEXT
)
RETURNS SETOF compute_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs: p_batch_size must be > 0, got %', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_batch_size > 1000 THEN
    RAISE EXCEPTION 'claim_compute_jobs: p_batch_size % exceeds cap of 1000', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_worker_id IS NULL OR length(p_worker_id) = 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs: p_worker_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  UPDATE compute_jobs
     SET status = 'running',
         claimed_at = now(),
         claimed_by = p_worker_id,
         attempts = attempts + 1
   WHERE id IN (
     SELECT id FROM compute_jobs
       WHERE status IN ('pending', 'failed_retry')
         AND next_attempt_at <= now()
       ORDER BY next_attempt_at
       LIMIT p_batch_size
       FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;

COMMENT ON FUNCTION claim_compute_jobs IS
  'Atomically claims up to N ready-to-run jobs (status IN pending/failed_retry, next_attempt_at <= now()) for a worker via SELECT FOR UPDATE SKIP LOCKED. failed_retry rows whose backoff has elapsed are claimable again per migration 089. Two concurrent callers get disjoint result sets. Each claimed row moves to status=running, attempts incremented, claimed_at/claimed_by set. See migrations 032 and 089.';

REVOKE ALL ON FUNCTION claim_compute_jobs FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 2: replace claim_compute_jobs_with_priority with widened filter
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_compute_jobs_with_priority(
  p_batch_size INTEGER,
  p_worker_id  TEXT
)
RETURNS SETOF compute_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_high_pending INTEGER;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_batch_size must be > 0, got %', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_batch_size > 1000 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_batch_size % exceeds cap of 1000', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_worker_id IS NULL OR length(p_worker_id) = 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_worker_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Throttle probe: count normal/high jobs that are ready to claim.
  -- Includes failed_retry rows whose backoff has elapsed (per migration 089) so
  -- a normal/high failed_retry row correctly throttles low-priority work.
  SELECT count(*) INTO v_high_pending
    FROM compute_jobs
   WHERE priority IN ('normal','high')
     AND status IN ('pending', 'failed_retry')
     AND next_attempt_at <= now();

  -- Atomic claim with priority precedence + throttle guard.
  RETURN QUERY
  UPDATE compute_jobs
     SET status = 'running',
         claimed_at = now(),
         claimed_by = p_worker_id,
         attempts = attempts + 1
   WHERE id IN (
     SELECT id FROM compute_jobs
       WHERE status IN ('pending', 'failed_retry')
         AND next_attempt_at <= now()
         AND (v_high_pending = 0 OR priority IN ('normal','high'))
       ORDER BY
         CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
         next_attempt_at
       LIMIT p_batch_size
       FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;

COMMENT ON FUNCTION claim_compute_jobs_with_priority IS
  'Priority-aware claim with widened filter (status IN pending/failed_retry, next_attempt_at <= now()): prefers high then normal, throttles low when any normal/high pending. failed_retry rows whose backoff has elapsed are claimable again per migration 089. SECURITY DEFINER + SET search_path = public, pg_temp (H-B). See migrations 086 and 089.';

REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 3: replace partial index to match the widened throttle probe
-- --------------------------------------------------------------------------
-- The partial index from migration 086 had predicate
--   `priority IN ('normal','high') AND status = 'pending'`.
-- After this migration, the throttle probe also reads failed_retry rows.
-- Drop the old index and recreate with the widened predicate so the probe
-- stays an index-only scan.
DROP INDEX IF EXISTS idx_compute_jobs_priority_pending;

CREATE INDEX IF NOT EXISTS idx_compute_jobs_priority_pending
  ON compute_jobs (priority, next_attempt_at)
  WHERE priority IN ('normal','high') AND status IN ('pending', 'failed_retry');

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_claim_def TEXT;
  v_priority_def TEXT;
BEGIN
  -- Verify both functions exist and have the H-B hardened search_path.
  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'claim_compute_jobs'
       AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ) THEN
    RAISE EXCEPTION 'Migration 089: claim_compute_jobs missing or not H-B hardened';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'claim_compute_jobs_with_priority'
       AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ) THEN
    RAISE EXCEPTION 'Migration 089: claim_compute_jobs_with_priority missing or not H-B hardened';
  END IF;

  -- Verify the function bodies actually include the widened filter. Look for
  -- the literal `status IN ('pending', 'failed_retry')` text in pg_proc.prosrc.
  SELECT prosrc INTO v_claim_def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'claim_compute_jobs';
  IF v_claim_def NOT LIKE '%status IN (''pending'', ''failed_retry'')%' THEN
    RAISE EXCEPTION 'Migration 089: claim_compute_jobs body does not include the widened filter';
  END IF;

  SELECT prosrc INTO v_priority_def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'claim_compute_jobs_with_priority';
  IF v_priority_def NOT LIKE '%status IN (''pending'', ''failed_retry'')%' THEN
    RAISE EXCEPTION 'Migration 089: claim_compute_jobs_with_priority body does not include the widened filter';
  END IF;

  -- Verify the partial index has the widened predicate (the predicate text is
  -- stored as canonicalized SQL in pg_indexes.indexdef).
  IF NOT EXISTS(
    SELECT 1 FROM pg_indexes
     WHERE indexname = 'idx_compute_jobs_priority_pending'
       AND indexdef LIKE '%status = ANY (ARRAY[''pending''::text, ''failed_retry''::text])%'
  ) THEN
    RAISE EXCEPTION 'Migration 089: idx_compute_jobs_priority_pending missing or has wrong predicate';
  END IF;

  RAISE NOTICE 'Migration 089: failed_retry rows are now claimable when next_attempt_at <= now().';
END $$;

COMMIT;
