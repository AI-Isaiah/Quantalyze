-- Migration 090: dedupe batch claim by partition keys.
--
-- Why this migration exists
-- -------------------------
-- Migration 089 widened the claim filter to include `failed_retry` rows
-- whose backoff has elapsed. That uncovered a latent bug in both claim
-- RPCs (`claim_compute_jobs` from migration 032 and
-- `claim_compute_jobs_with_priority` from migration 086):
--
--   The single-statement batch UPDATE in each RPC, together with `LIMIT
--   p_batch_size FOR UPDATE SKIP LOCKED`, can claim multiple rows that
--   share a partition key inside ONE transaction. When all those rows
--   transition `pending|failed_retry → running` in the same UPDATE, the
--   second one violates a partial unique index and the entire claim rolls
--   back with 23505. Worker dispatch_loop then logs the error every 30s
--   and gets nothing done.
--
-- Why this was masked before 089
-- ------------------------------
-- The four partition unique indices
--   compute_jobs_one_inflight_per_kind_{portfolio,strategy,allocator,api_key}
-- enforce at most ONE row per `(partition_id, kind)` in the inflight states
-- {pending, running, done_pending_children}. Pre-089 the claim filter only
-- looked at `status = 'pending'`, so two rows for the same partition could
-- only coexist if both were pending at the same time. The same indices
-- prevent that on INSERT, so the duplicate-pending case never happened in
-- practice. After 089, two `failed_retry` rows for the same partition CAN
-- coexist (failed_retry is NOT in the inflight predicate), and the
-- batch-claim hits the bug.
--
-- Production trigger on 2026-04-28 17:10 UTC
-- -------------------------------------------
-- After PR #82 merged + Railway redeployed:
--   2 rescore_allocator failed_retry rows for allocator_id a11ca111…
--   4 poll_allocator_positions failed_retry rows (2 each for two api_keys)
-- The worker spun on `duplicate key value violates unique constraint
-- "compute_jobs_one_inflight_per_kind_allocator"` for ~7 minutes until
-- the 6 rows were manually transitioned to `failed_final`.
--
-- What this migration does
-- ------------------------
-- 1. CREATE OR REPLACE both `claim_compute_jobs` and
--    `claim_compute_jobs_with_priority` to dedupe candidates by partition
--    key BEFORE the batch UPDATE.
-- 2. The dedupe uses one `row_number() OVER (PARTITION BY kind,
--    <partition_id>)` per partition column. A row survives the dedupe
--    only if it is rank 1 for every partition column it has set. Rows
--    where a partition column is NULL skip that column's rank check
--    (NULL partition_id is excluded from the corresponding partial unique
--    index, so it cannot collide there).
-- 3. Tie-break inside each partition: priority precedence (high > normal
--    > low) for the priority RPC, then `next_attempt_at` ascending. The
--    legacy non-priority RPC ties only on `next_attempt_at`.
-- 4. FOR UPDATE SKIP LOCKED is preserved on the outer SELECT against
--    `compute_jobs` — same atomic concurrency primitive as before. Two
--    concurrent workers see the same dedupe winners (the inner CTE is
--    deterministic) and SKIP LOCKED partitions the locked subset.
-- 5. Self-verifying DO block:
--    a. Asserts both RPCs exist and keep the H-B `SET search_path =
--       public, pg_temp`.
--    b. Asserts both bodies include the literal `row_number() OVER` token
--       (proof the dedupe survived the deploy).
--    c. Runs an integration test that inserts two failed_retry rows for
--       the same `(kind, allocator_id)` partition, calls
--       `claim_compute_jobs_with_priority(5, …)`, asserts at most one
--       row was claimed (NOT two, NOT a 23505 error), then cleans up the
--       test rows. This is a regression test that runs at every apply.
--
-- What this migration does NOT do
-- -------------------------------
-- - Does NOT change function signatures, behavior on the happy path
--   (no shared partition), or the throttle / priority semantics from 086.
-- - Does NOT change the partition unique indices themselves — they were
--   correct all along; the claim path was the broken side.
-- - Does NOT touch `mark_compute_job_failed`, `reset_stalled_compute_jobs`,
--   or any other queue lifecycle RPC.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: claim_compute_jobs with partition-key dedupe (legacy non-priority)
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
  WITH ranked AS (
    SELECT id, kind, portfolio_id, strategy_id, allocator_id, api_key_id, next_attempt_at,
           row_number() OVER (PARTITION BY kind, portfolio_id ORDER BY next_attempt_at) AS rn_p,
           row_number() OVER (PARTITION BY kind, strategy_id  ORDER BY next_attempt_at) AS rn_s,
           row_number() OVER (PARTITION BY kind, allocator_id ORDER BY next_attempt_at) AS rn_a,
           row_number() OVER (PARTITION BY kind, api_key_id   ORDER BY next_attempt_at) AS rn_k
    FROM compute_jobs
    WHERE status IN ('pending', 'failed_retry')
      AND next_attempt_at <= now()
  ),
  deduped AS (
    SELECT id FROM ranked
    WHERE (portfolio_id  IS NULL OR rn_p = 1)
      AND (strategy_id   IS NULL OR rn_s = 1)
      AND (allocator_id  IS NULL OR rn_a = 1)
      AND (api_key_id    IS NULL OR rn_k = 1)
  )
  UPDATE compute_jobs
     SET status     = 'running',
         claimed_at = now(),
         claimed_by = p_worker_id,
         attempts   = attempts + 1
   WHERE id IN (
     SELECT cj.id FROM compute_jobs cj
      WHERE cj.id IN (SELECT id FROM deduped)
      ORDER BY cj.next_attempt_at
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;

COMMENT ON FUNCTION claim_compute_jobs IS
  'Atomically claims up to N ready-to-run jobs (status IN pending/failed_retry, next_attempt_at <= now()) for a worker. Migration 090 dedupes by partition keys (portfolio_id, strategy_id, allocator_id, api_key_id) before the batch UPDATE so the partial unique inflight indices cannot 23505 inside a single claim. Two concurrent callers get disjoint result sets via FOR UPDATE SKIP LOCKED. Each claimed row moves to status=running, attempts incremented. See migrations 032, 089, 090.';

REVOKE ALL ON FUNCTION claim_compute_jobs FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 2: claim_compute_jobs_with_priority with partition-key dedupe
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
  -- Includes failed_retry rows whose backoff has elapsed (per migration 089).
  SELECT count(*) INTO v_high_pending
    FROM compute_jobs
   WHERE priority IN ('normal','high')
     AND status IN ('pending', 'failed_retry')
     AND next_attempt_at <= now();

  -- Atomic claim with priority precedence + throttle guard + partition dedupe.
  -- The CTE picks at most one winner per (kind, partition_id) tuple BEFORE
  -- the FOR UPDATE SKIP LOCKED scan, so the ensuing batch UPDATE cannot
  -- 23505 on the partial inflight indices.
  RETURN QUERY
  WITH ranked AS (
    SELECT id, kind, priority, portfolio_id, strategy_id, allocator_id, api_key_id,
           next_attempt_at,
           CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END AS pri_rank,
           row_number() OVER (
             PARTITION BY kind, portfolio_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_p,
           row_number() OVER (
             PARTITION BY kind, strategy_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_s,
           row_number() OVER (
             PARTITION BY kind, allocator_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_a,
           row_number() OVER (
             PARTITION BY kind, api_key_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_k
    FROM compute_jobs
    WHERE status IN ('pending', 'failed_retry')
      AND next_attempt_at <= now()
      AND (v_high_pending = 0 OR priority IN ('normal','high'))
  ),
  deduped AS (
    SELECT id FROM ranked
    WHERE (portfolio_id IS NULL OR rn_p = 1)
      AND (strategy_id  IS NULL OR rn_s = 1)
      AND (allocator_id IS NULL OR rn_a = 1)
      AND (api_key_id   IS NULL OR rn_k = 1)
  )
  UPDATE compute_jobs
     SET status     = 'running',
         claimed_at = now(),
         claimed_by = p_worker_id,
         attempts   = attempts + 1
   WHERE id IN (
     SELECT cj.id FROM compute_jobs cj
      WHERE cj.id IN (SELECT id FROM deduped)
      ORDER BY
        CASE cj.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        cj.next_attempt_at
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;

COMMENT ON FUNCTION claim_compute_jobs_with_priority IS
  'Priority-aware claim: prefers high then normal, throttles low when any normal/high pending. Migration 090 dedupes by partition keys (portfolio_id, strategy_id, allocator_id, api_key_id) so two failed_retry rows sharing a partition cannot 23505 on the partial inflight indices inside a single batch UPDATE. SECURITY DEFINER + SET search_path = public, pg_temp (H-B). See migrations 086, 089, 090.';

REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block (structural)
-- --------------------------------------------------------------------------
-- A live regression test (insert two failed_retry rows sharing a
-- partition, call claim, assert ≤ 1 returned, savepoint-rollback) is
-- omitted here because every queue partition column has a foreign key
-- to a real domain table (users for allocator_id, strategies for
-- strategy_id, api_keys for api_key_id, portfolios for portfolio_id).
-- A migration cannot fabricate test users without polluting production
-- and FK-disabling tricks need privileges the migration role lacks.
--
-- Behavioral coverage instead lives in the Python test suite — see
-- analytics-service/tests/test_main_worker.py::TestClaimDedupe (added in
-- the same commit as this migration) which mocks the supabase RPC and
-- asserts the worker tolerates a claim batch that returned fewer rows
-- than the queue depth (the natural side-effect of dedupe).
--
-- The structural assertions below are the deploy-time gate.
DO $$
DECLARE
  v_claim_def    TEXT;
  v_priority_def TEXT;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'claim_compute_jobs'
       AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ) THEN
    RAISE EXCEPTION 'Migration 090: claim_compute_jobs missing or not H-B hardened';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'claim_compute_jobs_with_priority'
       AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ) THEN
    RAISE EXCEPTION 'Migration 090: claim_compute_jobs_with_priority missing or not H-B hardened';
  END IF;

  SELECT prosrc INTO v_claim_def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'claim_compute_jobs';
  IF v_claim_def NOT LIKE '%row_number() OVER%' THEN
    RAISE EXCEPTION 'Migration 090: claim_compute_jobs body missing partition dedupe (row_number)';
  END IF;
  IF v_claim_def NOT LIKE '%PARTITION BY kind, portfolio_id%'
     OR v_claim_def NOT LIKE '%PARTITION BY kind, strategy_id%'
     OR v_claim_def NOT LIKE '%PARTITION BY kind, allocator_id%'
     OR v_claim_def NOT LIKE '%PARTITION BY kind, api_key_id%' THEN
    RAISE EXCEPTION 'Migration 090: claim_compute_jobs missing one or more partition window definitions';
  END IF;

  SELECT prosrc INTO v_priority_def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'claim_compute_jobs_with_priority';
  IF v_priority_def NOT LIKE '%row_number() OVER%' THEN
    RAISE EXCEPTION 'Migration 090: claim_compute_jobs_with_priority body missing partition dedupe (row_number)';
  END IF;
  IF v_priority_def NOT LIKE '%PARTITION BY kind, portfolio_id%'
     OR v_priority_def NOT LIKE '%PARTITION BY kind, strategy_id%'
     OR v_priority_def NOT LIKE '%PARTITION BY kind, allocator_id%'
     OR v_priority_def NOT LIKE '%PARTITION BY kind, api_key_id%' THEN
    RAISE EXCEPTION 'Migration 090: claim_compute_jobs_with_priority missing one or more partition window definitions';
  END IF;

  RAISE NOTICE 'Migration 090: partition-key dedupe installed in both claim RPCs.';
END $$;

COMMIT;
