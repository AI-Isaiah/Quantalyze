-- ==========================================================================
-- 2026-05-25 prod incident hotfix — extend compute_jobs_kind_check with
-- 'compute_analytics_from_csv'.
--
-- Phase 19.1 / Plan 02 migration 20260522120100 added the new job kind to
-- compute_jobs_kind_target_coherence but FORGOT the sibling list-form
-- compute_jobs_kind_check CHECK on the same table. Every CSV-uploaded
-- strategy since v0.24.7.0 (2026-05-22) failed at enqueue time with:
--
--   compute job enqueue failed: new row for relation "compute_jobs"
--   violates check constraint "compute_jobs_kind_check"
--
-- The route's enqueue-error placeholder then wrote
-- strategy_analytics.computation_status='failed' so the wizard's poller
-- could break out, but no analytics ever computed. csv_daily_returns
-- was populated correctly for both confirmed-affected strategies
-- (FX-AI2 90 rows, break-momentum 1,112 rows) — only the enqueue + worker
-- pass are missing.
--
-- Pattern verbatim from migration 108 (process_key_long, lines 108-109):
-- DROP IF EXISTS + ADD with the prior list preserved as a strict superset.
-- Migration 108 is the lockstep precedent — it updated BOTH constraints in
-- a single migration; 19.1/02 forgot the kind_check half.
--
-- After-fix recovery: the two failed strategy_analytics rows
-- (206114ce-...-69297 + f0c43303-...-65170) need their computation_status
-- reset so the worker re-runs. Tracked in the runbook follow-up — NOT
-- handled by this migration (data fix runs separately so an apply-failure
-- doesn't half-mutate the rows).
-- ==========================================================================

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1 — DROP + ADD compute_jobs_kind_check with the new kind.
--
-- The kind list mirrors the live prod constraint definition (captured via
-- pg_get_constraintdef during the 2026-05-25 investigation) verbatim, with
-- 'compute_analytics_from_csv' appended. Strict superset — no in-flight
-- insert for a previously-admitted kind can fail under the swap.
-- ==========================================================================
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
    'compute_analytics_from_csv'::text   -- 2026-05-25 hotfix: closes 19.1/02 gap
  ])
);

COMMENT ON CONSTRAINT compute_jobs_kind_check ON compute_jobs IS
  'Simple list-form kind admission check. 2026-05-25: extended with compute_analytics_from_csv to close the 19.1/02 lockstep gap (the sibling compute_jobs_kind_target_coherence already had the kind since 20260522120100).';

-- ==========================================================================
-- STEP 2 — Self-verifying DO block.
--
-- (a) compute_analytics_from_csv branch admitted by compute_jobs_kind_check
-- (b) every PRIOR kind still admitted (strict-superset regression guard)
-- (c) compute_jobs_kind_target_coherence still admits compute_analytics_from_csv
--     (cross-constraint coherence — both must agree)
-- ==========================================================================
DO $$
DECLARE
  v_kind text;
  v_prior_kinds text[] := ARRAY[
    'sync_trades',
    'compute_analytics',
    'compute_portfolio',
    'poll_positions',
    'sync_funding',
    'reconcile_strategy',
    'compute_intro_snapshot',
    'rescore_allocator',
    'poll_allocator_positions',
    'reconstruct_allocator_history',
    'refresh_allocator_equity_daily',
    'process_key_long'
  ];
  v_clause text;
BEGIN
  SELECT pg_get_constraintdef(oid)
    INTO v_clause
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass
     AND conname = 'compute_jobs_kind_check';

  IF v_clause IS NULL THEN
    RAISE EXCEPTION '2026-05-25 hotfix: compute_jobs_kind_check constraint missing after ADD';
  END IF;

  IF position('compute_analytics_from_csv' IN v_clause) = 0 THEN
    RAISE EXCEPTION '2026-05-25 hotfix: compute_analytics_from_csv not admitted by compute_jobs_kind_check';
  END IF;

  FOREACH v_kind IN ARRAY v_prior_kinds LOOP
    IF position(v_kind IN v_clause) = 0 THEN
      RAISE EXCEPTION '2026-05-25 hotfix: prior kind % regressed out of compute_jobs_kind_check', v_kind;
    END IF;
  END LOOP;

  -- Cross-constraint coherence guard: both CHECKs must agree on the new
  -- kind. Use pg_get_constraintdef rather than
  -- information_schema.check_constraints — the latter rewrites the clause
  -- (e.g. ANY(ARRAY[...]) normalization) and may not literally contain the
  -- substring we grep for. The reviewer-pattern matches lines 93-97 above.
  DECLARE
    v_coherence_clause text;
  BEGIN
    SELECT pg_get_constraintdef(oid)
      INTO v_coherence_clause
      FROM pg_constraint
     WHERE conrelid = 'public.compute_jobs'::regclass
       AND conname = 'compute_jobs_kind_target_coherence';

    IF v_coherence_clause IS NULL
       OR position('compute_analytics_from_csv' IN v_coherence_clause) = 0 THEN
      RAISE EXCEPTION '2026-05-25 hotfix: compute_analytics_from_csv missing from compute_jobs_kind_target_coherence — migration 19.1/02 either rolled back or never applied; re-apply 20260522120100 before this hotfix';
    END IF;
  END;

  RAISE NOTICE '2026-05-25 hotfix: compute_jobs_kind_check now admits compute_analytics_from_csv. CSV analytics enqueue unblocked.';
END
$$;

COMMIT;
