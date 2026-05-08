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

-- Drop the feature_flags kill-switch table (RLS policies cascade with the table).
DROP TABLE IF EXISTS feature_flags;

DO $$ BEGIN RAISE NOTICE 'Migration 104 rollback: completed.'; END $$;

COMMIT;
