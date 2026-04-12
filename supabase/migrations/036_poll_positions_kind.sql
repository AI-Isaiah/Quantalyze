-- Migration 036: poll_positions compute job kind
-- Sprint 3 Task 3.2: Register the new kind + relax the kind_target_coherence CHECK
--
-- Ordering note: this migration ships AFTER 034 (position_snapshots table)
-- so the worker's poll_positions handler has a table to write to before the
-- kind can be enqueued. Reversing the order would create a race window.
--
-- Why this migration exists
-- -------------------------
-- Migration 032 seeded compute_job_kinds with three entries: sync_trades,
-- compute_analytics, compute_portfolio. Sprint 3 adds a fourth kind,
-- poll_positions, which the worker handles via positions.py. The 032
-- header explicitly called out that new kinds land as INSERTs, not ALTER
-- TABLE, so no schema changes are needed on compute_job_kinds itself.
--
-- The compute_jobs_kind_target_coherence CHECK constraint (032:147-150)
-- restricts the relationship between kind and the target_id columns.
-- Original constraint:
--   (kind = 'compute_portfolio' AND portfolio_id IS NOT NULL) OR
--   (kind IN ('sync_trades', 'compute_analytics') AND strategy_id IS NOT NULL)
--
-- The new poll_positions kind is strategy-scoped (one job per strategy
-- per day polls that strategy's positions from its api_key_id's exchange).
-- It needs to be added to the strategy-scoped arm of the CHECK. We DROP
-- the existing constraint and ADD a new one with the extended list —
-- Postgres doesn't allow ALTER CONSTRAINT to edit a CHECK in place.
--
-- What this migration ships
-- -------------------------
-- 1. INSERT poll_positions into compute_job_kinds (idempotent via
--    ON CONFLICT DO NOTHING).
-- 2. DROP + ADD compute_jobs_kind_target_coherence with poll_positions
--    included in the strategy-scoped arm.
-- 3. Self-verifying DO block confirming both the kind row and the
--    updated CHECK exist.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: register the kind
-- --------------------------------------------------------------------------
INSERT INTO compute_job_kinds (name) VALUES
  ('poll_positions')
  ON CONFLICT (name) DO NOTHING;

-- --------------------------------------------------------------------------
-- STEP 2: relax kind_target_coherence CHECK
-- --------------------------------------------------------------------------
-- Drop the existing constraint and re-add with poll_positions included in
-- the strategy-scoped arm. IF EXISTS is safe because re-running the
-- migration idempotently should not fail if the DROP+ADD already ran.
ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
    (kind = 'compute_portfolio' AND portfolio_id IS NOT NULL) OR
    (kind IN ('sync_trades', 'compute_analytics', 'poll_positions') AND strategy_id IS NOT NULL)
  );

COMMENT ON CONSTRAINT compute_jobs_kind_target_coherence ON compute_jobs IS
  'Kind <-> target-type coherence. compute_portfolio is portfolio-scoped; sync_trades, compute_analytics, and poll_positions are strategy-scoped. poll_positions added in migration 036.';

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_kind_exists BOOLEAN;
  v_check_def TEXT;
BEGIN
  -- 1. Kind registered
  SELECT EXISTS(
    SELECT 1 FROM compute_job_kinds WHERE name = 'poll_positions'
  ) INTO v_kind_exists;

  IF NOT v_kind_exists THEN
    RAISE EXCEPTION 'Migration 036 failed: poll_positions kind missing from compute_job_kinds';
  END IF;

  -- 2. Updated CHECK references poll_positions
  SELECT pg_get_constraintdef(oid) INTO v_check_def
    FROM pg_constraint
    WHERE conname = 'compute_jobs_kind_target_coherence';

  IF v_check_def IS NULL THEN
    RAISE EXCEPTION 'Migration 036 failed: compute_jobs_kind_target_coherence constraint missing';
  END IF;

  IF v_check_def NOT LIKE '%poll_positions%' THEN
    RAISE EXCEPTION 'Migration 036 failed: kind_target_coherence does not include poll_positions. Got: %', v_check_def;
  END IF;

  -- 3. Sanity: can we actually insert a poll_positions row? (service-role
  -- only, so the RLS deny-all on compute_jobs applies to this DO block if
  -- it runs as a non-service-role, which it won't during migration apply —
  -- supabase-cli runs migrations as postgres superuser which bypasses RLS.
  -- We skip the dry-run insert; the DO block above is sufficient.)

  RAISE NOTICE 'Migration 036: poll_positions kind registered + kind_target_coherence CHECK updated and verified.';
END
$$;

COMMIT;
