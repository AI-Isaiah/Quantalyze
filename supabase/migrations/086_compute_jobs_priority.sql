-- Migration 086: compute_jobs.priority enum + partial index + claim_compute_jobs_with_priority RPC
-- Phase 12 / METRICS-16 (D-05, D-06): priority-aware queue dispatch for backfill throttle.
--
-- Why this migration exists
-- -------------------------
-- Phase 12 backfills `compute_analytics` for every published strategy on
-- deploy (~20 enqueues). Without priority awareness, live `sync_trades`
-- queues behind these, producing visible staleness for active allocators.
-- This migration adds a `priority` enum (low/normal/high) so the worker's
-- claim path can prefer 'normal' (live sync_trades + first-class
-- compute_analytics) and 'high' (manual force-recompute) over 'low'
-- (post-deploy backfill). When ANY normal/high job is pending, the new
-- claim RPC excludes 'low' rows from the claim batch — effectively
-- throttling backfill so live work always wins.
--
-- What this migration does
-- ------------------------
-- 1. Adds `compute_jobs.priority TEXT NOT NULL DEFAULT 'normal'` with
--    CHECK (priority IN ('low','normal','high')). Default 'normal' so
--    legacy enqueue paths keep working unchanged; backfill enqueuer
--    explicitly sets 'low' (METRICS-14, Plan 12-08).
-- 2. Adds partial index `idx_compute_jobs_priority_pending` on
--    (priority, next_attempt_at) WHERE priority IN ('normal','high')
--    AND status = 'pending'. Used by the existence-probe inside the
--    new claim RPC; pre-filters to ~tens of rows during throttled windows
--    instead of scanning the whole queue.
-- 3. Creates `claim_compute_jobs_with_priority(p_batch_size, p_worker_id)`
--    SECURITY DEFINER RPC mirroring `claim_compute_jobs` (migration 032
--    STEP 10) but with priority-aware ORDER BY + throttle guard. Hardened
--    via `SET search_path = public, pg_temp` (per H-B from 12-REVIEWS.md
--    — `pg_temp` not `pg_catalog`; prevents privilege-escalation via
--    search_path pollution against `pg_catalog`).
-- 4. Self-verifying DO block asserts column, index, RPC, and the H-B
--    search_path hardening on the RPC's proconfig.
--
-- What this migration does NOT do
-- -------------------------------
-- - Does NOT swap `dispatch_tick` to call the new RPC. That happens in
--   Plan 12-08 (METRICS-14 throttled backfill enqueuer). After this
--   migration applies, the existing `claim_compute_jobs` keeps working
--   for callers that haven't migrated. Both coexist by design.
-- - Does NOT enqueue any backfill jobs. Plan 12-10 (deploy script) does
--   that as a separate step after the migration.
-- - Does NOT change the existing `claim_compute_jobs` RPC signature or
--   semantics. That RPC still claims any pending row regardless of
--   priority. New worker code calls `claim_compute_jobs_with_priority`.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: priority column on compute_jobs
-- --------------------------------------------------------------------------
ALTER TABLE compute_jobs
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high'));

COMMENT ON COLUMN compute_jobs.priority IS
  'Dispatch priority. low = post-deploy backfill (throttled to 5/min when normal/high pending). normal = live sync_trades + first-class compute_analytics. high = manual force-recompute. Read by claim_compute_jobs_with_priority(). See migration 086.';

-- --------------------------------------------------------------------------
-- STEP 2: partial index for live (normal/high) pending jobs
-- --------------------------------------------------------------------------
-- The existence probe inside claim_compute_jobs_with_priority counts
-- pending normal/high jobs to decide whether to throttle low rows.
-- Without this index, that probe scans the whole queue on each tick.
-- WHERE priority IN ('normal','high') AND status='pending' makes the
-- probe touch only the rows that matter.
CREATE INDEX IF NOT EXISTS idx_compute_jobs_priority_pending
  ON compute_jobs (priority, next_attempt_at)
  WHERE priority IN ('normal','high') AND status = 'pending';

-- --------------------------------------------------------------------------
-- STEP 3: claim_compute_jobs_with_priority RPC
-- --------------------------------------------------------------------------
-- Mirrors `claim_compute_jobs` (032 STEP 10) but with priority-aware
-- ordering and a throttle guard:
--   1. Validates batch size (p_batch_size in (0, 1000]) — same bounds
--      as claim_compute_jobs (032:541-558).
--   2. Counts pending normal/high jobs into v_high_pending. The partial
--      index from STEP 2 makes this an index-only scan touching at most
--      a few rows.
--   3. Atomically claims rows via UPDATE … WHERE id IN (SELECT … FOR
--      UPDATE SKIP LOCKED) — same lockless concurrency pattern as
--      claim_compute_jobs.
--   4. Throttle: when v_high_pending > 0, the inner SELECT excludes
--      priority='low' rows. When v_high_pending = 0, all priorities
--      claim.
--   5. ORDER BY priority precedence (high=0, normal=1, low=2) then
--      next_attempt_at — high jumps the queue without breaking
--      next_attempt_at ordering within a priority tier.
--
-- H-B from 12-REVIEWS.md: SECURITY DEFINER + `SET search_path = public,
-- pg_temp` hardens against the privilege-escalation pattern where an
-- attacker plants malicious functions in pg_temp/pg_catalog. The DO
-- block at the end asserts `'search_path=public, pg_temp' = ANY(proconfig)`.
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
  -- Validation matches claim_compute_jobs (032:541-558) — same lower
  -- bound, same upper cap of 1000 against runaway batches.
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

  -- Are any normal/high jobs ready to run? Index-only scan via
  -- idx_compute_jobs_priority_pending.
  SELECT count(*) INTO v_high_pending
    FROM compute_jobs
   WHERE priority IN ('normal','high')
     AND status = 'pending'
     AND next_attempt_at <= now();

  -- Atomic claim with priority precedence + throttle guard. The inner
  -- SELECT FOR UPDATE SKIP LOCKED is the same concurrency primitive
  -- used by claim_compute_jobs; two concurrent workers get disjoint
  -- result sets with no blocking.
  RETURN QUERY
  UPDATE compute_jobs
     SET status = 'running',
         claimed_at = now(),
         claimed_by = p_worker_id,
         attempts = attempts + 1
   WHERE id IN (
     SELECT id FROM compute_jobs
       WHERE status = 'pending'
         AND next_attempt_at <= now()
         -- Throttle: if any normal/high pending, exclude low this tick.
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
  'Priority-aware claim: prefers high then normal, throttles low when any normal/high pending. Mirrors claim_compute_jobs (032) concurrency via FOR UPDATE SKIP LOCKED. SECURITY DEFINER + SET search_path = public, pg_temp (H-B). See migration 086.';

-- service_role only — no anon/authenticated reach this RPC.
REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
-- Mirrors the 032 self-verify pattern. Asserts:
--   1. priority column present
--   2. partial index present
--   3. claim_compute_jobs_with_priority RPC present
--   4. RPC has SET search_path = public, pg_temp (H-B hardening)
DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'compute_jobs'
       AND column_name = 'priority'
  ) THEN
    RAISE EXCEPTION 'Migration 086: priority column missing on compute_jobs';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_class
     WHERE relname = 'idx_compute_jobs_priority_pending'
  ) THEN
    RAISE EXCEPTION 'Migration 086: partial index idx_compute_jobs_priority_pending missing';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'claim_compute_jobs_with_priority'
  ) THEN
    RAISE EXCEPTION 'Migration 086: claim_compute_jobs_with_priority RPC missing';
  END IF;

  -- H-B: assert search_path is hardened against privilege-escalation.
  -- proconfig stores per-function GUC settings; we want the entry
  -- 'search_path=public, pg_temp' verbatim.
  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'claim_compute_jobs_with_priority'
       AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ) THEN
    RAISE EXCEPTION 'Migration 086: claim_compute_jobs_with_priority missing SET search_path = public, pg_temp (H-B hardening)';
  END IF;

  RAISE NOTICE 'Migration 086: priority enum + partial index + claim RPC installed.';
END $$;

COMMIT;
