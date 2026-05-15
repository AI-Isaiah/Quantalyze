-- Migration 108: Phase 19 / DM-1 + DM-2 forward-repair for live DB.
--
-- Why this migration exists
-- -------------------------
-- Migration 104 already shipped to the test Supabase project
-- (qmnijlgmdhviwzwfyzlc) WITHOUT the DM-1 INSERT into compute_job_kinds and
-- WITHOUT the DM-2 extension to compute_jobs_kind_target_coherence. The
-- 104 source has been retro-fixed (so a fresh apply against a clean DB is
-- correct) but the live test DB needs an idempotent forward repair. This
-- migration delivers exactly that.
--
-- Two idempotent operations, both safe to re-apply:
--   1. INSERT 'process_key_long' into compute_job_kinds (ON CONFLICT DO NOTHING).
--   2. DROP + ADD compute_jobs_kind_target_coherence with the new branch
--      mirroring the post-fix 104 source. Pattern follows migration 070
--      STEP 4 verbatim.
--
-- Self-verifying DO block at the bottom asserts both operations landed.
--
-- Per AGENTS.md / orchestrator policy: this migration ships in source as
-- part of the army-backend slice, but is NOT applied here. The orchestrator
-- applies it to qmnijlgmdhviwzwfyzlc post-merge.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1 — DM-1 forward repair: register process_key_long in the registry
-- ==========================================================================
-- Idempotent: ON CONFLICT (name) DO NOTHING. compute_job_kinds.name is the
-- PK per migration 032.
INSERT INTO compute_job_kinds (name) VALUES ('process_key_long')
  ON CONFLICT (name) DO NOTHING;

-- ==========================================================================
-- STEP 2 — DM-2 forward repair: extend kind_target_coherence
-- ==========================================================================
-- DROP+ADD pattern per migration 070 STEP 4. process_key_long is
-- strategy-scoped (same shape as sync_trades / compute_analytics); the
-- long-fetch worker reads compute_jobs.metadata for the per-flow context.
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
  (kind = 'compute_portfolio'
      AND portfolio_id IS NOT NULL AND strategy_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'rescore_allocator'
      AND allocator_id IS NOT NULL AND strategy_id IS NULL AND portfolio_id IS NULL) OR
  (kind IN (
    'sync_trades','compute_analytics','poll_positions',
    'sync_funding','reconcile_strategy','compute_intro_snapshot'
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
  -- Phase 19 / DM-2 — process_key_long is strategy-scoped.
  (kind = 'process_key_long'
      AND strategy_id IS NOT NULL AND portfolio_id IS NULL
      AND allocator_id IS NULL AND api_key_id IS NULL)
);

COMMENT ON CONSTRAINT compute_jobs_kind_target_coherence ON compute_jobs IS
  'Kind<->target-type coherence. Phase 19 / DM-2: process_key_long branch added (strategy-scoped). Repair migration 108 forward-fixes the live test DB; 104 source retro-fixed for fresh applies.';

-- ==========================================================================
-- STEP 3 — Self-verifying DO block
-- ==========================================================================
DO $$
BEGIN
  -- DM-1 verify
  IF NOT EXISTS(
    SELECT 1 FROM compute_job_kinds WHERE name = 'process_key_long'
  ) THEN
    RAISE EXCEPTION 'Migration 108 DM-1: process_key_long missing from compute_job_kinds';
  END IF;

  -- DM-2 verify
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_name='compute_jobs_kind_target_coherence'
       AND check_clause LIKE '%process_key_long%'
  ) THEN
    RAISE EXCEPTION 'Migration 108 DM-2: process_key_long branch missing from compute_jobs_kind_target_coherence';
  END IF;

  RAISE NOTICE 'Migration 108: DM-1 + DM-2 forward repairs verified.';
END $$;

COMMIT;

-- ==========================================================================
-- END OF MIGRATION 108
-- ==========================================================================
