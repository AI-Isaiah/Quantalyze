-- Rollback for migration 104: Phase 19 / BACKBONE-05 + BACKBONE-08 + BACKBONE-09
-- Reverses wizard_session_id UNIQUE INDEX, compute_jobs.kind CHECK widening,
-- claim_compute_jobs_with_priority 3-arg form, and feature_flags table.
-- The 086 2-arg signature is NOT dropped — that belongs to migration 086.
--
-- C-8 — paired down-migration.

BEGIN;

-- Drop the 3-arg form added in 104; the 086 2-arg form remains untouched.
DROP FUNCTION IF EXISTS claim_compute_jobs_with_priority(INTEGER, TEXT, BOOLEAN);

-- Drop the wizard idempotency UNIQUE INDEX.
DROP INDEX IF EXISTS strategy_verifications_wizard_session_id_unique_idx;

-- Restore the kind CHECK to its pre-104 form (process_key_long removed).
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_check;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_check CHECK (kind IN (
  'sync_trades', 'compute_analytics', 'compute_portfolio', 'poll_positions',
  'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot',
  'rescore_allocator', 'poll_allocator_positions',
  'reconstruct_allocator_history', 'refresh_allocator_equity_daily'
));

-- I-DM5 — also reverse the DM-2 coherence-CHECK widening that 104 source
-- now applies. Pre-104 had no process_key_long branch; this DROP
-- removes the branch we added in 104 STEP 2 so the rollback restores the
-- pre-104 state. Idempotent: DROP CONSTRAINT IF EXISTS handles a clean
-- DB that didn't apply 104.
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;
-- Re-add the migration-070 shape (no process_key_long branch). Mirrors
-- migration 070 STEP 4 verbatim so a 104 rollback returns the live
-- coherence CHECK to the same shape migration 070 left it in.
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
      AND portfolio_id IS NULL AND allocator_id IS NULL)
);

-- I-DM5 — remove process_key_long from compute_job_kinds ONLY if no live
-- jobs reference it. Defensive: rolling back against a DB with live
-- jobs would orphan the FK target, so we leave the row in place.
DELETE FROM compute_job_kinds
 WHERE name = 'process_key_long'
   AND NOT EXISTS (
     SELECT 1 FROM compute_jobs WHERE kind = 'process_key_long'
   );

-- Drop the feature_flags kill-switch table (RLS policies cascade with the table).
DROP TABLE IF EXISTS feature_flags;

DO $$ BEGIN RAISE NOTICE 'Migration 104 rollback: completed.'; END $$;

COMMIT;
