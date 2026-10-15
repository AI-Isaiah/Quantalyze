-- ============================================================================
-- ROLLBACK for 20261026120000_okx_archive_rebuild.sql
-- Phase 167.1.2.2.2.1 OKXHISTORY, plan 01 (SC-1, SC-2, SC-4).
-- ============================================================================
-- Manual, off the auto-apply path. What it restores and removes, in this order:
--   1. DROPs public.apply_okx_archive_rebuild(uuid, jsonb, jsonb, jsonb). Nothing
--      else depends on it. Run it only after the analytics worker that calls it
--      (the okx_archive_rebuild job handler) has been rolled back, or the worker
--      will fail every apply with "function does not exist".
--   2. Restores compute_jobs_kind_check to the 20260717233529 definition (16 kinds,
--      okx_archive_rebuild removed).
--   3. Restores compute_jobs_kind_target_coherence to the 20260717233529
--      definition VERBATIM (the derive_broker_dailies api_key arm and the
--      derive_allocator_equity allocator arm preserved).
--   4. DELETEs the compute_job_kinds registry row LAST. The compute_jobs.kind FK
--      references that registry, so a compute_jobs row of the kind blocks the
--      DELETE: surface it, do not force. The same goes for step 2, whose ADD
--      CONSTRAINT validates existing rows and refuses while a job of the kind
--      exists. Because this file runs as one transaction, a refusal at any step
--      leaves the database exactly as it was. Remove or finish the jobs first.
--
-- ⚠️ DATA IS KEPT. The csv_daily_returns rows the function wrote and the
-- reconstructed_ranges entries it appended to strategy_analytics.series_provenance
-- are NOT removed by this file. Removing them is a founder decision, carried out
-- by a runbook form (plan 10 of this phase), because a rebuilt day may already
-- count in published metrics. The unrecovered_gaps the function narrowed are not
-- restored either.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20261026120000 as applied while the schema no longer carries
-- it, and `supabase db push` will not re-apply the migration. To re-apply it,
-- delete that ledger row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261026120000` against the
-- intended database, after the marker query in CLAUDE.md names that database).
--
-- The DO block before the changes is a catalogue-only PRECONDITION: it refuses,
-- before anything changes, on a database that does not carry the migration. The
-- DO block after them is catalogue-only too and aborts the whole rollback if the
-- function or the kind survives. Neither reads a row.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.apply_okx_archive_rebuild(uuid,jsonb,jsonb,jsonb)') IS NULL
     AND position('okx_archive_rebuild' IN COALESCE((
           SELECT pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conrelid = 'public.compute_jobs'::regclass AND conname = 'compute_jobs_kind_check'), '')) = 0 THEN
    RAISE EXCEPTION 'Rollback 20261026120000 refused: neither apply_okx_archive_rebuild nor the okx_archive_rebuild kind is present, so this database does not carry 20261026120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

-- 1. The function first: nothing else depends on it.
DROP FUNCTION IF EXISTS public.apply_okx_archive_rebuild(uuid, jsonb, jsonb, jsonb);

-- 2. Restore compute_jobs_kind_check to the 20260717233529 definition (16 kinds).
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
    'stitch_composite'::text,
    'derive_allocator_equity'::text
  ])
);

COMMENT ON CONSTRAINT compute_jobs_kind_check ON compute_jobs IS
  'Simple list-form kind admission check. 2026-07-18: extended with derive_allocator_equity (allocator-scoped compose of the P115 derivation core onto allocator_equity_derived). Re-based on 20260710130000.';

-- 3. Restore compute_jobs_kind_target_coherence to the 20260717233529 definition.
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
  OR ((kind = 'derive_allocator_equity') AND (allocator_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (api_key_id IS NULL))
);

COMMENT ON CONSTRAINT compute_jobs_kind_target_coherence ON compute_jobs IS
  'Kind<->target-type coherence. 2026-07-18: derive_allocator_equity added to a new allocator-scoped arm (allocator_id NOT NULL). Preserves the 20260624120100/20260710130000 dual-target derive_broker_dailies api_key arm — copying an older def would silently drop it and break key-mode allocator derives.';

-- 4. Remove the registry row LAST (FK-safe ordering).
DELETE FROM compute_job_kinds WHERE name = 'okx_archive_rebuild';

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
DECLARE
  v_kind_check text;
  v_coherence  text;
BEGIN
  IF to_regprocedure('public.apply_okx_archive_rebuild(uuid,jsonb,jsonb,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261026120000 failed: apply_okx_archive_rebuild survives';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO v_kind_check
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass AND conname = 'compute_jobs_kind_check';
  SELECT pg_get_constraintdef(oid) INTO v_coherence
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass AND conname = 'compute_jobs_kind_target_coherence';
  IF v_kind_check IS NULL OR v_coherence IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261026120000 failed: compute_jobs_kind_check or compute_jobs_kind_target_coherence is missing after the restore';
  END IF;
  IF position('okx_archive_rebuild' IN v_kind_check) > 0 OR position('okx_archive_rebuild' IN v_coherence) > 0 THEN
    RAISE EXCEPTION 'Rollback 20261026120000 failed: okx_archive_rebuild survives in a compute_jobs CHECK';
  END IF;
  -- The restore must not itself regress an earlier arm.
  IF position('derive_allocator_equity' IN v_kind_check) = 0
     OR position('derive_allocator_equity' IN v_coherence) = 0
     OR position('stitch_composite' IN v_kind_check) = 0
     OR v_coherence NOT LIKE '%derive_broker_dailies%api_key_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'Rollback 20261026120000 failed: the restore dropped an earlier kind or arm';
  END IF;

  RAISE NOTICE 'Rollback 20261026120000: the function, the kind and its coherence arm are gone; both CHECKs are back on the 20260717233529 definitions. Rows and reconstructed_ranges the function wrote are kept, and the migration ledger row is left in place (see the header).';
END
$verify$;

COMMIT;
