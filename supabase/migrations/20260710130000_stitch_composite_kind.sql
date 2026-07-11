-- ==========================================================================
-- Phase 86 (v1.9 multi-key composite strategy): register `stitch_composite`
-- as a STRATEGY-scoped compute job kind.
--
-- New path (services.job_worker.run_stitch_composite_job, Plan 03): fan out
-- over a strategy's strategy_keys members (Phase 85), reconstruct each member
-- key's daily series, clip to its half-open [window_start, window_end) window,
-- fail-loud overlap guard, arithmetic-stitch into ONE combined series, compute
-- per-basis metrics, and persist metrics_json_by_basis + data_quality_flags.
-- The Next.js dispatch route enqueues this kind via enqueue_compute_job
-- (p_strategy_id) — worker-only decryption, no route/client credential access.
--
-- OQ-2 (ADOPTED, 86-RESEARCH): a NEW kind, NOT an overload of
-- derive_broker_dailies (which is single-key). Cleaner blast radius; the Phase
-- 87 publish gate attaches to composites specifically.
--
-- Three registration points, mirroring 20260614120000_derive_broker_dailies_kind:
--   1. compute_job_kinds registry (INSERT ... ON CONFLICT DO NOTHING)
--   2. compute_jobs_kind_check              (list-form admission CHECK)
--   3. compute_jobs_kind_target_coherence   (strategy-scoped arm)
--
-- Both CHECKs use DROP IF EXISTS + ADD with the prior definition preserved as a
-- STRICT SUPERSET — no in-flight insert for an already-admitted kind can fail
-- under the swap. Bases are the LATEST live definitions (grep ALL migrations
-- before DROP+ADD — cross-cutting-refactor lesson):
--   kind_check ← 20260525074649 as extended by 20260614120000 (14 kinds)
--   coherence  ← 20260624120100 (the DUAL-target definition — it carries the
--                derive_broker_dailies api_key arm added for allocator per-key
--                derives). Copying the older 20260614120000 coherence verbatim
--                would SILENTLY DROP that api_key arm and break allocator derives.
--
-- Transaction style: NO explicit BEGIN/COMMIT — Supabase wraps each migration
-- in an implicit transaction (migration-reviewer invariant #14, Phase 85
-- precedent 20260710120000). SET LOCAL lock_timeout applies to that wrap.
-- Pure-additive: this migration writes ZERO existing rows (the only INSERT is
-- into the compute_job_kinds registry) and modifies no other table's data.
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1 — Register in the kinds registry (idempotent; name is PK).
-- --------------------------------------------------------------------------
INSERT INTO compute_job_kinds (name) VALUES ('stitch_composite')
  ON CONFLICT (name) DO NOTHING;

-- --------------------------------------------------------------------------
-- STEP 2 — DROP + ADD compute_jobs_kind_check with the new kind appended.
-- Verbatim from 20260614120000 (14 kinds) with 'stitch_composite' added as a
-- strict superset (15 kinds).
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
    'derive_broker_dailies'::text,
    'stitch_composite'::text               -- 2026-07-10: composite fan-out -> stitch -> per-basis metrics
  ])
);

COMMENT ON CONSTRAINT compute_jobs_kind_check ON compute_jobs IS
  'Simple list-form kind admission check. 2026-07-10: extended with stitch_composite (multi-key composite fan-out -> clip -> fail-loud overlap -> arithmetic stitch -> per-basis metrics).';

-- --------------------------------------------------------------------------
-- STEP 3 — DROP + ADD compute_jobs_kind_target_coherence with the new kind in
-- the strategy-scoped arm. Base is the FULL verbatim definition from
-- 20260624120100 (including the derive_broker_dailies api_key-scoped arm and
-- the process_key_long arm), with 'stitch_composite' appended to the
-- strategy-scoped ANY-array arm (strategy_id NOT NULL, all other targets NULL
-- — same target shape as compute_analytics_from_csv).
-- --------------------------------------------------------------------------
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
  ((kind = 'compute_portfolio') AND (portfolio_id IS NOT NULL) AND (strategy_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'rescore_allocator') AND (allocator_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL))
  OR ((kind = ANY (ARRAY['sync_trades', 'compute_analytics', 'poll_positions', 'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot', 'compute_analytics_from_csv', 'derive_broker_dailies', 'stitch_composite'])) AND (strategy_id IS NOT NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'poll_allocator_positions') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'reconstruct_allocator_history') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'refresh_allocator_equity_daily') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'derive_broker_dailies') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
  OR ((kind = 'process_key_long') AND (strategy_id IS NOT NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL) AND (api_key_id IS NULL))
);

COMMENT ON CONSTRAINT compute_jobs_kind_target_coherence ON compute_jobs IS
  'Kind<->target-type coherence. 2026-07-10: stitch_composite added to the strategy-scoped arm (strategy_id NOT NULL). Preserves the 20260624120100 dual-target derive_broker_dailies api_key arm.';

-- --------------------------------------------------------------------------
-- STEP 4 — Self-verifying DO block.
--   (a) registry row landed
--   (b) both CHECKs admit stitch_composite
--   (c) strict-superset regression loop over ALL 14 prior kinds
--   (d) coherence tripwires: the derive_broker_dailies api_key arm from
--       20260624120100 survived, and process_key_long + compute_analytics_from_csv
--       branches are intact
-- Every RAISE format string is a SINGLE literal (Phase 85 invariant #21 —
-- no '||' concatenation inside a RAISE format slot).
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
    'process_key_long','compute_analytics_from_csv','derive_broker_dailies'
  ];
BEGIN
  -- (a) registry row present
  IF NOT EXISTS (
    SELECT 1 FROM compute_job_kinds WHERE name = 'stitch_composite'
  ) THEN
    RAISE EXCEPTION 'stitch_composite missing from compute_job_kinds registry';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_check_clause
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass
     AND conname = 'compute_jobs_kind_check';
  SELECT pg_get_constraintdef(oid) INTO v_coherence_clause
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass
     AND conname = 'compute_jobs_kind_target_coherence';

  -- (b) both CHECKs admit the new kind
  IF v_check_clause IS NULL OR position('stitch_composite' IN v_check_clause) = 0 THEN
    RAISE EXCEPTION 'stitch_composite not admitted by compute_jobs_kind_check';
  END IF;
  IF v_coherence_clause IS NULL OR position('stitch_composite' IN v_coherence_clause) = 0 THEN
    RAISE EXCEPTION 'stitch_composite not admitted by compute_jobs_kind_target_coherence';
  END IF;

  -- (c) strict-superset regression: every prior kind still present in kind_check
  FOREACH v_kind IN ARRAY v_prior_kinds LOOP
    IF position(v_kind IN v_check_clause) = 0 THEN
      RAISE EXCEPTION 'a prior kind regressed out of compute_jobs_kind_check';
    END IF;
  END LOOP;

  -- (d) coherence tripwires. The 20260624120100 derive_broker_dailies api_key
  -- arm MUST survive the DROP+ADD (copying the 20260614 template would drop it).
  IF v_coherence_clause NOT LIKE '%derive_broker_dailies%api_key_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'derive_broker_dailies api_key arm regressed out of compute_jobs_kind_target_coherence';
  END IF;
  IF position('process_key_long' IN v_coherence_clause) = 0 THEN
    RAISE EXCEPTION 'process_key_long branch regressed out of compute_jobs_kind_target_coherence';
  END IF;
  IF position('compute_analytics_from_csv' IN v_coherence_clause) = 0 THEN
    RAISE EXCEPTION 'compute_analytics_from_csv branch regressed out of compute_jobs_kind_target_coherence';
  END IF;

  RAISE NOTICE 'stitch_composite registered: kinds registry + both CHECKs extended (api_key arm preserved).';
END
$$;
