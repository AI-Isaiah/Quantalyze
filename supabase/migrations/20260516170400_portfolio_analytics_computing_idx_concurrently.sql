-- audit-2026-05-07 mitigation (specialist-review apply pass take 2)
-- Closes: HIGH-3 (performance c8)
--   mig 20260516122247 (merged via PR #184) ran
--     CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_computing
--       ON portfolio_analytics (...) WHERE computation_status = 'computing';
--   without CONCURRENTLY. This took an exclusive lock on
--   portfolio_analytics for the duration of the build, blocking every
--   live INSERT/UPDATE/DELETE from the analytics worker.
--
-- Source: supabase/migrations/20260516122247_portfolio_analytics_stuck_row_reaper.sql:L66-L68
--
-- Strategy: DROP the existing blocking index + re-create it CONCURRENTLY.
-- The DROP itself takes ACCESS EXCLUSIVE briefly; lock_timeout=5s aborts
-- if the lock cannot be acquired quickly. Both operations are idempotent
-- via IF EXISTS / IF NOT EXISTS.
--
-- CONCURRENTLY cannot run inside a transaction block, so this file is
-- two phases — phase 1 in a tx for the DROP + lock_timeout, phase 2
-- non-transactional for the CONCURRENTLY build.

-- --------------------------------------------------------------------------
-- PHASE 1: drop the existing blocking-build index (in a short tx)
-- --------------------------------------------------------------------------
BEGIN;
SET lock_timeout = '5s';

DROP INDEX IF EXISTS public.idx_portfolio_analytics_computing;

COMMIT;

-- --------------------------------------------------------------------------
-- PHASE 2: rebuild CONCURRENTLY (NO transaction wrapper)
-- --------------------------------------------------------------------------
-- The partial WHERE predicate keeps the index small. CONCURRENTLY takes
-- SHARE UPDATE EXCLUSIVE only, so concurrent writers proceed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_portfolio_analytics_computing
  ON public.portfolio_analytics (portfolio_id, computed_at DESC)
  WHERE computation_status = 'computing';

-- --------------------------------------------------------------------------
-- VERIFICATION
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_idx_present BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'portfolio_analytics'
       AND indexname = 'idx_portfolio_analytics_computing'
  ) INTO v_idx_present;

  IF NOT v_idx_present THEN
    RAISE EXCEPTION
      'audit-2026-05-07 HIGH-3 verification failed: idx_portfolio_analytics_computing missing after CONCURRENTLY rebuild';
  END IF;
END $$;
