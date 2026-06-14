-- ==========================================================================
-- Register `derive_broker_dailies` as a strategy-scoped compute job kind.
--
-- New path (services.job_worker.run_derive_broker_dailies_job): after a key's
-- history sync, derive the strategy's daily-return series from realized PnL +
-- FUNDING anchored to current equity, persist to csv_daily_returns, and hand
-- off to compute_analytics_from_csv. Funding is the dominant return driver for
-- perp strategies and the legacy compute_analytics excluded it (see
-- services/broker_dailies.py). The sync_trades epilogue + cron_sync enqueue
-- this kind when BROKER_DAILIES_VIA_FUNDING is on (default).
--
-- Three registration points, mirroring the compute_analytics_from_csv
-- precedent (migration 20260522111858 + hotfix 20260525074649):
--   1. compute_job_kinds registry (INSERT)
--   2. compute_jobs_kind_check          (list-form admission CHECK)
--   3. compute_jobs_kind_target_coherence (strategy-scoped arm)
--
-- Both CHECKs use DROP IF EXISTS + ADD with the prior list preserved as a
-- STRICT SUPERSET — no in-flight insert for an already-admitted kind can fail
-- under the swap. Bases are the LATEST live definitions:
--   kind_check        ← 20260525074649 (csv hotfix)
--   coherence         ← 20260522111858 (Phase 19.1 / Task 2)
-- ==========================================================================

BEGIN;

SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1 — Register in the kinds registry (idempotent; name is PK per mig 032).
-- --------------------------------------------------------------------------
INSERT INTO compute_job_kinds (name) VALUES ('derive_broker_dailies')
  ON CONFLICT (name) DO NOTHING;

-- --------------------------------------------------------------------------
-- STEP 2 — DROP + ADD compute_jobs_kind_check with the new kind appended.
-- Verbatim from 20260525074649 with 'derive_broker_dailies' added.
-- --------------------------------------------------------------------------
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
    'derive_broker_dailies'::text          -- broker key full-history -> dailies -> CSV route
  ])
);

COMMENT ON CONSTRAINT compute_jobs_kind_check ON compute_jobs IS
  'Simple list-form kind admission check. 2026-06-14: extended with derive_broker_dailies (broker full-history -> funding-inclusive dailies -> CSV route).';

-- --------------------------------------------------------------------------
-- STEP 3 — DROP + ADD compute_jobs_kind_target_coherence with the new kind in
-- the strategy-scoped arm. Verbatim from 20260522111858 with
-- 'derive_broker_dailies' added (strategy_id NOT NULL, all others NULL —
-- same target shape as compute_analytics / compute_analytics_from_csv).
-- --------------------------------------------------------------------------
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
  (kind = 'compute_portfolio'
      AND portfolio_id IS NOT NULL AND strategy_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'rescore_allocator'
      AND allocator_id IS NOT NULL AND strategy_id IS NULL AND portfolio_id IS NULL) OR
  (kind IN (
    'sync_trades','compute_analytics','poll_positions',
    'sync_funding','reconcile_strategy','compute_intro_snapshot',
    'compute_analytics_from_csv',
    'derive_broker_dailies'                                       -- 2026-06-14
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
  'Kind<->target-type coherence. 2026-06-14: derive_broker_dailies branch added (strategy-scoped).';

-- --------------------------------------------------------------------------
-- STEP 4 — Self-verifying DO block.
--   (a) registry row landed
--   (b) both CHECKs admit derive_broker_dailies
--   (c) strict-superset regression guards (prior kinds still present)
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_check_clause     text;
  v_coherence_clause text;
  v_kind             text;
  v_prior_kinds      text[] := ARRAY[
    'sync_trades','compute_analytics','compute_portfolio','poll_positions',
    'sync_funding','reconcile_strategy','compute_intro_snapshot',
    'rescore_allocator','poll_allocator_positions',
    'reconstruct_allocator_history','refresh_allocator_equity_daily',
    'process_key_long','compute_analytics_from_csv'
  ];
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM compute_job_kinds WHERE name = 'derive_broker_dailies'
  ) THEN
    RAISE EXCEPTION 'derive_broker_dailies missing from compute_job_kinds registry';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_check_clause
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass
     AND conname = 'compute_jobs_kind_check';
  SELECT pg_get_constraintdef(oid) INTO v_coherence_clause
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass
     AND conname = 'compute_jobs_kind_target_coherence';

  IF v_check_clause IS NULL OR position('derive_broker_dailies' IN v_check_clause) = 0 THEN
    RAISE EXCEPTION 'derive_broker_dailies not admitted by compute_jobs_kind_check';
  END IF;
  IF v_coherence_clause IS NULL OR position('derive_broker_dailies' IN v_coherence_clause) = 0 THEN
    RAISE EXCEPTION 'derive_broker_dailies not admitted by compute_jobs_kind_target_coherence';
  END IF;

  FOREACH v_kind IN ARRAY v_prior_kinds LOOP
    IF position(v_kind IN v_check_clause) = 0 THEN
      RAISE EXCEPTION 'prior kind % regressed out of compute_jobs_kind_check', v_kind;
    END IF;
  END LOOP;

  -- Coherence-side superset guard (mirrors 20260522111858): the prior
  -- branches must survive the DROP+ADD. process_key_long and
  -- compute_analytics_from_csv are the two most-recently-added branches and
  -- the canonical regression tripwires for this constraint.
  IF position('process_key_long' IN v_coherence_clause) = 0 THEN
    RAISE EXCEPTION 'process_key_long branch regressed out of compute_jobs_kind_target_coherence';
  END IF;
  IF position('compute_analytics_from_csv' IN v_coherence_clause) = 0 THEN
    RAISE EXCEPTION 'compute_analytics_from_csv branch regressed out of compute_jobs_kind_target_coherence';
  END IF;

  RAISE NOTICE 'derive_broker_dailies registered: kinds registry + both CHECKs extended.';
END
$$;

COMMIT;
