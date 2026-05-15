-- Rollback for migration 108: Phase 19 / DM-1 + DM-2 forward repair.
--
-- Restores the pre-108 state (which is the pre-DM-2 / pre-DM-1 shape — i.e.
-- the broken-but-applied state migration 104 left the live test DB in).
-- This rollback exists strictly so we can roundtrip 108 in CI; in practice
-- you would NOT roll back this repair against any environment that ever
-- enqueued a process_key_long row, because the row would then violate the
-- restored coherence CHECK.

BEGIN;

-- DM-2 reverse: drop the extended coherence CHECK and re-add the migration 070
-- shape (no process_key_long branch).
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
      AND portfolio_id IS NULL AND allocator_id IS NULL)
);

-- DM-1 reverse: remove process_key_long from compute_job_kinds ONLY if no
-- compute_jobs row references it (defensive — preserves data integrity if
-- rollback is run against a DB that has live process_key_long jobs).
DELETE FROM compute_job_kinds
 WHERE name = 'process_key_long'
   AND NOT EXISTS (
     SELECT 1 FROM compute_jobs WHERE kind = 'process_key_long'
   );

DO $$ BEGIN RAISE NOTICE 'Migration 108 rollback: completed.'; END $$;

COMMIT;
