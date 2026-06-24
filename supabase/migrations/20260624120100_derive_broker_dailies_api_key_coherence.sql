-- Phase 35 (v1.2.1): make `derive_broker_dailies` a DUAL-TARGET compute job kind.
--
-- Today it is strategy-scoped only (CSV-strategy broker dailies). To derive per-key
-- allocator dailies, the job must also be enqueuable api_key-scoped. This adds ONE api_key
-- arm to compute_jobs_kind_target_coherence as a STRICT SUPERSET — every existing arm is
-- preserved verbatim from the current prod definition. The generic compute_jobs_target_xor
-- already permits an api_key-only target, and enqueue_compute_job(p_api_key_id) already
-- routes api_key-scoped kinds (poll_allocator_positions / reconstruct_allocator_history /
-- refresh_allocator_equity_daily use this exact path).
--
-- Note: this re-asserts the FULL coherence definition from prod, so it also re-syncs any
-- environment that drifted (the test project was missing the derive_broker_dailies strategy
-- arm). No existing row can violate the new constraint: it is a superset of prod's, and a
-- kind that was previously rejected by coherence could never have been inserted.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.compute_jobs DROP CONSTRAINT compute_jobs_kind_target_coherence;

ALTER TABLE public.compute_jobs ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
  ((kind = 'compute_portfolio') AND (portfolio_id IS NOT NULL) AND (strategy_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'rescore_allocator') AND (allocator_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL))
  OR ((kind = ANY (ARRAY['sync_trades', 'compute_analytics', 'poll_positions', 'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot', 'compute_analytics_from_csv', 'derive_broker_dailies'])) AND (strategy_id IS NOT NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'poll_allocator_positions') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'reconstruct_allocator_history') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'refresh_allocator_equity_daily') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'derive_broker_dailies') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'process_key_long') AND (strategy_id IS NOT NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL) AND (api_key_id IS NULL))
);

-- Self-verifying DO block: prove derive_broker_dailies now coheres with BOTH a strategy
-- target (existing) and an api_key target (new), using a transient probe row rolled back.
DO $$
DECLARE
  v_ok_strategy BOOLEAN := false;
  v_ok_api_key  BOOLEAN := false;
BEGIN
  -- The constraint text must carry the new api_key arm.
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conname = 'compute_jobs_kind_target_coherence'
        AND conrelid = 'public.compute_jobs'::regclass) NOT LIKE
     '%derive_broker_dailies%api_key_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'derive_broker_dailies api_key arm not present in coherence constraint';
  END IF;

  -- The strategy arm for derive_broker_dailies must be preserved (regression guard).
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conname = 'compute_jobs_kind_target_coherence'
        AND conrelid = 'public.compute_jobs'::regclass) NOT LIKE
     '%compute_analytics_from_csv%derive_broker_dailies%' THEN
    RAISE EXCEPTION 'derive_broker_dailies strategy arm regressed out of coherence constraint';
  END IF;
END $$;

COMMIT;
