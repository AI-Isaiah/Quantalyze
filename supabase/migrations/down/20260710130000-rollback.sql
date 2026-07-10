-- ============================================================================
-- ROLLBACK for 20260710130000_stitch_composite_kind.sql
-- Phase 86 / Plan 86-01 — stitch_composite compute-job kind reversal.
-- ============================================================================
-- Restores both CHECKs to their EXACT prior definitions and removes the
-- registry row. The registry DELETE runs LAST: a compute_jobs.kind FK references
-- compute_job_kinds(name), so the kind must first be gone from any admitted set
-- (the CHECK swaps do not touch existing rows, and no stitch_composite job can
-- exist unless one was committed post-forward — the orchestrator down-proof runs
-- before any such enqueue). If a stitch_composite compute_jobs row exists, the
-- FK will (correctly) block the registry DELETE — surface it, do not force.
--
--   kind_check ← restored to 20260614120000 (14 kinds, stitch_composite removed)
--   coherence  ← restored to 20260624120100 (dual-target; stitch_composite
--                removed from the strategy-scoped arm, derive_broker_dailies
--                api_key arm preserved verbatim)
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- 1. Restore compute_jobs_kind_check to the 20260614120000 definition (14 kinds).
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_check;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_check CHECK (
  kind = ANY (ARRAY[
    'sync_trades'::text,
    'compute_analytics'::text,
    'compute_portfolio'::text,
    'poll_positions'::text,
    'sync_funding'::text,
    'reconcile_strategy'::text,
    'compute_intro_snapshot'::text,
    'rescore_allocator'::text,
    'poll_allocator_positions'::text,
    'reconstruct_allocator_history'::text,
    'refresh_allocator_equity_daily'::text,
    'process_key_long'::text,
    'compute_analytics_from_csv'::text,
    'derive_broker_dailies'::text
  ])
);

COMMENT ON CONSTRAINT compute_jobs_kind_check ON compute_jobs IS
  'Simple list-form kind admission check. 2026-06-14: extended with derive_broker_dailies (broker full-history -> funding-inclusive dailies -> CSV route).';

-- 2. Restore compute_jobs_kind_target_coherence to the 20260624120100 definition
--    (dual-target; the derive_broker_dailies api_key arm preserved verbatim).
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
  ((kind = 'compute_portfolio') AND (portfolio_id IS NOT NULL) AND (strategy_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'rescore_allocator') AND (allocator_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL))
  OR ((kind = ANY (ARRAY['sync_trades', 'compute_analytics', 'poll_positions', 'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot', 'compute_analytics_from_csv', 'derive_broker_dailies'])) AND (strategy_id IS NOT NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'poll_allocator_positions') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'reconstruct_allocator_history') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'refresh_allocator_equity_daily') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'derive_broker_dailies') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'process_key_long') AND (strategy_id IS NOT NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL) AND (api_key_id IS NULL))
);

COMMENT ON CONSTRAINT compute_jobs_kind_target_coherence ON compute_jobs IS
  'Kind<->target-type coherence. 2026-06-24: derive_broker_dailies dual-target (strategy + api_key arms).';

-- 3. Remove the registry row LAST (FK-safe ordering).
DELETE FROM compute_job_kinds WHERE name = 'stitch_composite';
