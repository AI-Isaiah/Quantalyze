-- Migration: claim_compute_jobs done_pending_children guard (C39 / NEW-C39-01)
--
-- Why this migration exists
-- -------------------------
-- Migration 090 (claim_dedupe_partition_keys) introduced a `ranked`/`deduped`
-- CTE that scans candidates with `status IN ('pending', 'failed_retry')`.
-- The four partial unique indices guard
--   status IN ('pending', 'running', 'done_pending_children')
-- for each partition column (portfolio_id / strategy_id / allocator_id /
-- api_key_id).
--
-- Because `failed_retry` is NOT in the index predicate, a `failed_retry` row
-- can coexist in the table alongside a `done_pending_children` row for the
-- same `(kind, partition_col)`. The `ranked` CTE sees the `failed_retry` row,
-- selects it as the dedupe winner, and the ensuing batch UPDATE flips it to
-- `running`. This violates the partial unique index against the live
-- `done_pending_children` row and raises:
--
--   ERROR 23505: duplicate key value violates unique constraint
--     "compute_jobs_one_inflight_per_kind_<partition>"
--
-- The dispatch-loop spin this causes is the exact failure mode migration 090
-- was designed to eliminate.
--
-- Migration 117 (claim_token_fencing) preserved `claim_compute_jobs`'s
-- `status IN ('pending', 'failed_retry')` scan, so the vulnerability carried
-- forward. Migration 117's `claim_compute_jobs_with_priority` body was
-- narrowed to `status = 'pending'` only — a `pending` row cannot coexist with
-- `done_pending_children` for the same partition (the unique index blocks the
-- INSERT), so that function is NOT vulnerable.
--
-- Latency today vs. future activation
-- ------------------------------------
-- No worker currently passes `parent_job_ids` so no `done_pending_children`
-- rows exist in production. The vulnerability goes live the moment any kind
-- enqueues children via `parent_job_ids`. The fix must land before that
-- happens.
--
-- What this migration does
-- ------------------------
-- 1. CREATE OR REPLACE `claim_compute_jobs` (non-priority, last replaced in
--    mig 117) to add a `NOT EXISTS` guard in the `deduped` CTE. The guard
--    excludes a candidate row when the same `(kind, partition_col)` already
--    has a row in `status IN ('running', 'done_pending_children')`. This
--    supersedes both the H-1240 running-watchdog guard and the NEW-C39-01
--    done_pending_children gap.
--
-- 2. The guard is applied per-partition-column independently (each has its
--    own sub-SELECT). A candidate with `api_key_id IS NOT NULL` is excluded
--    if any `running` or `done_pending_children` row exists with the same
--    `(kind, api_key_id)`. NULL partition columns skip their respective
--    guard (NULL is excluded from the relevant partial unique index).
--
-- 3. All other semantics from mig 117 are preserved verbatim:
--    - `status IN ('pending', 'failed_retry')` candidate filter
--    - `claim_token = gen_random_uuid()` P97 fence
--    - `attempts = attempts + 1`
--    - `FOR UPDATE SKIP LOCKED` concurrency primitive
--    - `SET search_path = public, pg_temp` H-B hardening
--    - `REVOKE ALL ... FROM PUBLIC, anon, authenticated`
--
-- 4. Self-verifying DO block asserts the guard is present in the installed
--    function body at every apply.
--
-- claim_compute_jobs_with_priority is NOT modified — its `status = 'pending'`
-- scan cannot reach `done_pending_children` coexistence (the unique index
-- blocks any `pending` INSERT for a partition that already has an inflight
-- row). Modifying it here would be speculative.

-- SUPABASE: explicit-transaction
-- This migration uses explicit BEGIN/COMMIT to ensure STEP 1 (CREATE OR REPLACE)
-- and STEP 2 (self-verifying DO block) are atomic. The pattern is intentional and
-- consistent with every multi-step compute_jobs migration since mig 090 (see migs
-- 090, 117). The Supabase CLI wraps this in a savepoint; this inner transaction
-- ensures partial-apply of either step alone rolls back both.
BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: claim_compute_jobs — add done_pending_children guard in deduped CTE
-- --------------------------------------------------------------------------
-- Body mirrors migration 117 STEP 2 verbatim with one addition in the
-- `deduped` CTE: a NOT EXISTS sub-SELECT per partition column that
-- excludes candidates whose partition already has an inflight
-- (running or done_pending_children) row.
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
      -- C39 / NEW-C39-01: exclude candidates whose partition already has
      -- an inflight (running or done_pending_children) row. Without this
      -- guard a failed_retry row can coexist with a done_pending_children
      -- row for the same (kind, partition_col) and the batch UPDATE that
      -- flips failed_retry → running violates the partial unique index
      -- (23505). The guard is per-partition-column; NULL partition columns
      -- are skipped (they are excluded from the relevant index predicate).
      AND (portfolio_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = ranked.kind
           AND x.portfolio_id = ranked.portfolio_id
           AND x.status IN ('running', 'done_pending_children')
      ))
      AND (strategy_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind        = ranked.kind
           AND x.strategy_id = ranked.strategy_id
           AND x.status IN ('running', 'done_pending_children')
      ))
      AND (allocator_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = ranked.kind
           AND x.allocator_id = ranked.allocator_id
           AND x.status IN ('running', 'done_pending_children')
      ))
      AND (api_key_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind       = ranked.kind
           AND x.api_key_id = ranked.api_key_id
           AND x.status IN ('running', 'done_pending_children')
      ))
  )
  UPDATE compute_jobs
     SET status      = 'running',
         claimed_at  = now(),
         claimed_by  = p_worker_id,
         attempts    = attempts + 1,
         claim_token = gen_random_uuid()    -- mig 117: P97 fence
   WHERE id IN (
     SELECT cj.id FROM compute_jobs cj
      WHERE cj.id IN (SELECT id FROM deduped)
        AND cj.status IN ('pending', 'failed_retry')  -- H-1/M-1: re-check status after CTE snapshot+lock to guard against concurrent status transitions
      ORDER BY cj.next_attempt_at
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;

COMMENT ON FUNCTION claim_compute_jobs IS
  'Atomically claims up to N ready-to-run jobs (status IN pending/failed_retry, '
  'next_attempt_at <= now()) for a worker. Migration 090 dedupes by partition keys; '
  'migration 117 adds claim_token = gen_random_uuid() (P97 fence). '
  'Migration C39 / NEW-C39-01: the deduped CTE now excludes candidates whose '
  '(kind, partition_col) already has a running or done_pending_children row, '
  'closing the 23505 collision vector between failed_retry and done_pending_children '
  'that migrations 090 and 117 left open. FOR UPDATE SKIP LOCKED concurrency '
  'preserved. See migrations 032, 089, 090, 117, C39.';

REVOKE ALL ON FUNCTION claim_compute_jobs FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_body TEXT;
BEGIN
  -- Confirm the function is installed with H-B hardening.
  -- Use LIKE patterns instead of an exact-string match against proconfig entries:
  -- PostgreSQL's GUC serialization of SET search_path can vary across minor versions
  -- (e.g. quoting, spacing). A LIKE match on the key name + expected values is robust
  -- across serialization variants while still catching a missing or misconfigured
  -- search_path. (M conf=9 finding: b10-migration reviewer, 2026-05-26)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'claim_compute_jobs'
       AND pg_get_function_identity_arguments(p.oid) = 'p_batch_size integer, p_worker_id text'  -- M-3: pin to exact signature to avoid false-pass under future overloads
       AND EXISTS (
         SELECT 1 FROM unnest(p.proconfig) AS cfg
          WHERE cfg LIKE 'search_path=%'
            AND cfg LIKE '%public%'
            AND cfg LIKE '%pg_temp%'
       )
  ) THEN
    RAISE EXCEPTION 'C39 migration verification failed: claim_compute_jobs missing or not H-B hardened';
  END IF;

  -- Fetch the installed function body.
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'claim_compute_jobs'
     AND pg_get_function_identity_arguments(p.oid) = 'p_batch_size integer, p_worker_id text';

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'C39 migration verification failed: claim_compute_jobs body not retrievable';
  END IF;

  -- The mig 090 / 117 partition-key dedupe must still be present.
  IF v_body !~* 'row_number\(\)\s+OVER' THEN
    RAISE EXCEPTION 'C39 migration verification failed: claim_compute_jobs lost mig 090 partition-key dedupe (row_number)';
  END IF;

  -- The mig 117 P97 claim_token stamp must still be present.
  IF v_body !~* 'claim_token\s*=\s*gen_random_uuid\(\)' THEN
    RAISE EXCEPTION 'C39 migration verification failed: claim_compute_jobs lost mig 117 P97 claim_token stamp';
  END IF;

  -- The C39 done_pending_children guard must be present for each partition column.
  -- We check for the pattern in the NOT EXISTS sub-SELECT bodies.
  IF v_body !~* 'done_pending_children' THEN
    RAISE EXCEPTION 'C39 migration verification failed: claim_compute_jobs deduped CTE missing done_pending_children guard';
  END IF;

  IF v_body !~* 'x\.portfolio_id\s*=\s*ranked\.portfolio_id' THEN
    RAISE EXCEPTION 'C39 migration verification failed: claim_compute_jobs missing portfolio_id NOT EXISTS guard';
  END IF;

  IF v_body !~* 'x\.strategy_id\s*=\s*ranked\.strategy_id' THEN
    RAISE EXCEPTION 'C39 migration verification failed: claim_compute_jobs missing strategy_id NOT EXISTS guard';
  END IF;

  IF v_body !~* 'x\.allocator_id\s*=\s*ranked\.allocator_id' THEN
    RAISE EXCEPTION 'C39 migration verification failed: claim_compute_jobs missing allocator_id NOT EXISTS guard';
  END IF;

  IF v_body !~* 'x\.api_key_id\s*=\s*ranked\.api_key_id' THEN
    RAISE EXCEPTION 'C39 migration verification failed: claim_compute_jobs missing api_key_id NOT EXISTS guard';
  END IF;

  RAISE NOTICE 'C39 / NEW-C39-01: claim_compute_jobs done_pending_children guard installed and verified.';
END $$;

COMMIT;
