-- Migration N+2: Register compute_analytics_from_csv kind + extend coherence.
-- Pattern: migration 036 (poll_positions_kind).

BEGIN;

SET lock_timeout = '3s';

INSERT INTO compute_job_kinds (name) VALUES ('compute_analytics_from_csv')
  ON CONFLICT (name) DO NOTHING;

ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
  (kind = 'compute_portfolio'
      AND portfolio_id IS NOT NULL AND strategy_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'rescore_allocator'
      AND allocator_id IS NOT NULL AND strategy_id IS NULL AND portfolio_id IS NULL) OR
  (kind IN (
    'sync_trades','compute_analytics','poll_positions',
    'sync_funding','reconcile_strategy','compute_intro_snapshot',
    'compute_analytics_from_csv'
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
  'Kind ↔ target-type coherence. compute_analytics_from_csv added for CSV pipeline.';

DO $$
DECLARE
  v_check_def TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM compute_job_kinds WHERE name='compute_analytics_from_csv') THEN
    RAISE EXCEPTION 'compute_analytics_from_csv migration: kind missing from compute_job_kinds';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v_check_def
    FROM pg_constraint WHERE conname = 'compute_jobs_kind_target_coherence';
  IF v_check_def IS NULL THEN
    RAISE EXCEPTION 'compute_analytics_from_csv migration: coherence constraint missing';
  END IF;
  IF v_check_def NOT LIKE '%compute_analytics_from_csv%' THEN
    RAISE EXCEPTION 'compute_analytics_from_csv migration: kind not in coherence constraint';
  END IF;
  RAISE NOTICE 'compute_analytics_from_csv migration: all assertions passed.';
END $$;

COMMIT;
