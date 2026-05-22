-- ==========================================================================
-- Phase 19.1 / Task 2 — register compute_analytics_from_csv as a strategy-
-- scoped job kind.
--
-- Strict superset of migration 108's compute_jobs_kind_target_coherence —
-- every existing kind preserved verbatim, only compute_analytics_from_csv
-- added to the strategy-scoped `kind IN (...)` arm. No in-flight insert can
-- fail under the swap.
--
-- Pattern verbatim from migration 108 (DROP + ADD).
-- ==========================================================================

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1 — Register compute_analytics_from_csv in the kinds registry.
--
-- Idempotent — the conflict clause swallows re-applies because
-- compute_job_kinds.name is the PK per migration 032.
-- ==========================================================================
INSERT INTO compute_job_kinds (name) VALUES ('compute_analytics_from_csv')
  ON CONFLICT (name) DO NOTHING;

-- ==========================================================================
-- STEP 2 — DROP + ADD compute_jobs_kind_target_coherence with the new branch.
--
-- The kinds list mirrors migration 108 verbatim, with
-- 'compute_analytics_from_csv' appended to the strategy-scoped arm. The
-- process_key_long branch (added in 108) is preserved on its own line — the
-- self-verify DO block below asserts it is still present so a future
-- regression of this migration cannot silently drop it.
-- ==========================================================================
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
  (kind = 'compute_portfolio'
      AND portfolio_id IS NOT NULL AND strategy_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'rescore_allocator'
      AND allocator_id IS NOT NULL AND strategy_id IS NULL AND portfolio_id IS NULL) OR
  (kind IN (
    'sync_trades','compute_analytics','poll_positions',
    'sync_funding','reconcile_strategy','compute_intro_snapshot',
    'compute_analytics_from_csv'                                  -- Phase 19.1 / Task 2
  ) AND strategy_id IS NOT NULL AND portfolio_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'poll_allocator_positions'
      AND api_key_id IS NOT NULL AND strategy_id IS NULL
      AND portfolio_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'reconstruct_allocator_history'
      AND api_key_id IS NOT NULL AND strategy_id IS NULL
      AND portfolio_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'refresh_allocator_equity_daily'
      AND api_key_id IS NOT NULL AND strategy_id IS NULL
      AND portfolio_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'process_key_long'
      AND strategy_id IS NOT NULL AND portfolio_id IS NULL
      AND allocator_id IS NULL AND api_key_id IS NULL)
);

COMMENT ON CONSTRAINT compute_jobs_kind_target_coherence ON compute_jobs IS
  'Kind<->target-type coherence. Phase 19.1 / Task 2: compute_analytics_from_csv branch added (strategy-scoped).';

-- ==========================================================================
-- STEP 3 — Self-verifying DO block.
--
-- (a) registry row for compute_analytics_from_csv landed
-- (b) coherence constraint exists AND admits compute_analytics_from_csv
-- (c) coherence constraint still admits process_key_long (strict-superset
--     regression guard — protects the migration 108 contract)
-- ==========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM compute_job_kinds WHERE name = 'compute_analytics_from_csv'
  ) THEN
    RAISE EXCEPTION 'Migration 19.1/02: compute_analytics_from_csv missing from compute_job_kinds';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_name = 'compute_jobs_kind_target_coherence'
       AND check_clause LIKE '%compute_analytics_from_csv%'
  ) THEN
    RAISE EXCEPTION 'Migration 19.1/02: compute_analytics_from_csv branch missing from compute_jobs_kind_target_coherence';
  END IF;

  -- Strict-superset assertion: process_key_long branch still present.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_name = 'compute_jobs_kind_target_coherence'
       AND check_clause LIKE '%process_key_long%'
  ) THEN
    RAISE EXCEPTION 'Migration 19.1/02 regresses migration 108 — process_key_long branch missing from compute_jobs_kind_target_coherence';
  END IF;

  RAISE NOTICE 'Migration 19.1/02: compute_analytics_from_csv kind registered + coherence extended.';
END
$$;

COMMIT;
