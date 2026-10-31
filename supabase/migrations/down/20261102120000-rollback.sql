-- ============================================================================
-- ROLLBACK for 20261102120000_bridge_outcome_holding_branch_derived.sql
-- Phase 176 LEGACYRETIRE, plan 02 (SC-1; D-03, D-05, D-06).
-- ============================================================================
-- Manual, off the auto-apply path. What it undoes:
--   1. Re-creates public.compute_bridge_outcome_deltas() as its latest earlier definition,
--      migration 20260426131718_match_decisions_kind_enum.sql (STEP 8), i.e. with the
--      holding branch measured per symbol through public.extract_symbol_value_at and without
--      the allocated_at window conjunct. The body below is that definition byte for byte.
--      Signature, SECURITY DEFINER and the pinned search_path are the same in both versions;
--      the REVOKE and GRANT are re-issued with full signatures, as the migration did, and
--      the function comment is restored to the 20260426131718 text.
--   2. DROPs public.derived_account_return_over(uuid, date, integer) and
--      public.reset_holding_bridge_outcomes_to_derived_basis() by full signature. Nothing
--      else depends on either once step 1 has run.
--
-- ⚠️ THE D-06 RESET IS NOT UNDONE. The migration set needs_recompute = TRUE and NULLed
-- delta_30d, delta_90d, delta_180d and deltas_computed_at on every holding outcome inside
-- the allocated_at window, and those stored values are gone; this file cannot bring them
-- back. After this file runs, the next 03:00Z run of the compute_bridge_outcome_deltas cron
-- recomputes those rows on the OLD per-symbol basis, and that works only while
-- public.allocator_equity_snapshots exists, i.e. before Phase 176 PR 3 drops it. Rows the
-- batch had already measured on the derived basis keep those values (the old body skips a
-- row that has deltas and needs_recompute FALSE), so a rolled-back database can hold both
-- bases until the rows are reset again.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records version
-- 20261102120000 as applied while the schema no longer carries it, and `supabase db push`
-- will not re-apply the migration. To re-apply it, delete that ledger row in the same
-- change (or mark it reverted with `supabase migration repair --status reverted
-- 20261102120000` against the intended database, after the marker query in CLAUDE.md names
-- that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that does not carry the migration. The DO block after it
-- is catalogue-only too and aborts the whole rollback if either dropped function survives
-- or the restored batch does not read the per-symbol breakdown. Neither reads a row.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.derived_account_return_over(uuid,date,integer)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261102120000 refused: public.derived_account_return_over(uuid, date, integer) is not present, so this database does not carry 20261102120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

-- 1. The batch as 20260426131718 defined it (STEP 8), byte for byte.
CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas()
RETURNS TABLE(updated_count INT, failed_count INT, batch_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $func$
DECLARE
  v_updated INT := 0;
  v_failed  INT := 0;
  v_started TIMESTAMPTZ := NOW();
BEGIN
  WITH
  -- ---------------- strategy branch (verbatim from migration 073) ----------------
  strategy_candidates AS (
    SELECT
      bo.id,
      bo.allocated_at,
      sa.returns_series AS series
    FROM public.bridge_outcomes AS bo
    LEFT JOIN public.match_decisions md ON md.id = bo.match_decision_id
    JOIN public.strategy_analytics sa ON sa.strategy_id = bo.strategy_id
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
      AND (
        bo.match_decision_id IS NULL
        OR (md.original_strategy_id IS NOT NULL AND md.original_holding_ref IS NULL)
      )
  ),
  strategy_computed AS (
    SELECT
      c.id,
      public.extract_delta(c.series, c.allocated_at, 30)  AS d30,
      public.extract_delta(c.series, c.allocated_at, 90)  AS d90,
      public.extract_delta(c.series, c.allocated_at, 180) AS d180,
      est.bps  AS est_bps,
      est.days AS est_days
    FROM strategy_candidates c
    LEFT JOIN LATERAL public.extract_estimated(c.series, c.allocated_at) AS est ON TRUE
  ),
  strategy_updated AS (
    UPDATE public.bridge_outcomes AS bo
    SET
      delta_30d           = COALESCE(c.d30,      bo.delta_30d),
      delta_90d           = COALESCE(c.d90,      bo.delta_90d),
      delta_180d          = COALESCE(c.d180,     bo.delta_180d),
      estimated_delta_bps = COALESCE(c.est_bps,  bo.estimated_delta_bps),
      estimated_days      = COALESCE(c.est_days, bo.estimated_days),
      needs_recompute     = FALSE,
      deltas_computed_at  = v_started
    FROM strategy_computed c
    WHERE bo.id = c.id
      AND bo.kind = 'allocated'
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  ),
  -- ---------------- holding branch (verbatim from migration 073) ----------------
  holding_candidates AS (
    SELECT
      bo.id,
      bo.allocator_id,
      bo.allocated_at,
      hp.symbol
    FROM public.bridge_outcomes bo
    JOIN public.match_decisions md ON md.id = bo.match_decision_id
    LEFT JOIN LATERAL public.parse_holding_ref(md.original_holding_ref) hp ON TRUE
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
      AND md.original_strategy_id IS NULL
      AND md.original_holding_ref IS NOT NULL
      AND hp.symbol IS NOT NULL
  ),
  holding_computed AS (
    SELECT
      hc.id,
      CASE
        WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at) IS NULL
          OR public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 30) IS NULL
        THEN NULL
        ELSE (
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 30) /
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at)
        ) - 1
      END AS d30,
      CASE
        WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at) IS NULL
          OR public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 90) IS NULL
        THEN NULL
        ELSE (
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 90) /
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at)
        ) - 1
      END AS d90,
      CASE
        WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at) IS NULL
          OR public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 180) IS NULL
        THEN NULL
        ELSE (
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 180) /
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at)
        ) - 1
      END AS d180
    FROM holding_candidates hc
  ),
  holding_updated AS (
    UPDATE public.bridge_outcomes AS bo
    SET
      delta_30d          = COALESCE(hc.d30,  bo.delta_30d),
      delta_90d          = COALESCE(hc.d90,  bo.delta_90d),
      delta_180d         = COALESCE(hc.d180, bo.delta_180d),
      needs_recompute    = FALSE,
      deltas_computed_at = v_started
    FROM holding_computed hc
    WHERE bo.id = hc.id
      AND bo.kind = 'allocated'
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  ),
  -- ---------------- voluntary_add branch (NEW — Phase 10 / H2) ----------------
  -- voluntary_add rows: md.kind='voluntary_add', original_* both NULL,
  -- strategy_id (the suggested strategy) NOT NULL. Match against
  -- strategy_analytics.returns_series the same way the strategy branch does — but
  -- gate on md.kind='voluntary_add' to be unambiguous and avoid double-counting
  -- bridge_recommended rows that the strategy branch already covers.
  voluntary_add_candidates AS (
    SELECT
      bo.id,
      bo.allocated_at,
      sa.returns_series AS series
    FROM public.bridge_outcomes AS bo
    JOIN public.match_decisions md ON md.id = bo.match_decision_id
    JOIN public.strategy_analytics sa ON sa.strategy_id = bo.strategy_id
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
      AND md.kind = 'voluntary_add'
      AND md.strategy_id IS NOT NULL
      AND md.original_holding_ref IS NULL
      AND md.original_strategy_id IS NULL
  ),
  voluntary_add_computed AS (
    SELECT
      vc.id,
      public.extract_delta(vc.series, vc.allocated_at, 30)  AS d30,
      public.extract_delta(vc.series, vc.allocated_at, 90)  AS d90,
      public.extract_delta(vc.series, vc.allocated_at, 180) AS d180,
      est.bps  AS est_bps,
      est.days AS est_days
    FROM voluntary_add_candidates vc
    LEFT JOIN LATERAL public.extract_estimated(vc.series, vc.allocated_at) AS est ON TRUE
  ),
  voluntary_add_updated AS (
    UPDATE public.bridge_outcomes AS bo
    SET
      delta_30d           = COALESCE(c.d30,      bo.delta_30d),
      delta_90d           = COALESCE(c.d90,      bo.delta_90d),
      delta_180d          = COALESCE(c.d180,     bo.delta_180d),
      estimated_delta_bps = COALESCE(c.est_bps,  bo.estimated_delta_bps),
      estimated_days      = COALESCE(c.est_days, bo.estimated_days),
      needs_recompute     = FALSE,
      deltas_computed_at  = v_started
    FROM voluntary_add_computed c
    WHERE bo.id = c.id
      AND bo.kind = 'allocated'
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  )
  SELECT
    (SELECT COUNT(*)::INT FROM strategy_updated) +
    (SELECT COUNT(*)::INT FROM holding_updated) +
    (SELECT COUNT(*)::INT FROM voluntary_add_updated)
  INTO v_updated;

  RETURN QUERY SELECT v_updated, v_failed, v_started;
END;
$func$;

COMMENT ON FUNCTION public.compute_bridge_outcome_deltas IS
  'Daily batch: realized 30/90/180-day deltas for bridge_outcomes where '
  'kind=''allocated'' AND (delta_30d IS NULL OR needs_recompute=TRUE). '
  'Phase 10 extension (migration 080): adds voluntary_add CTE branch matching '
  'md.kind=''voluntary_add'' so browse-added strategies accrue deltas once '
  'strategy_analytics.returns_series catches up. Strategy + holding branches '
  'preserved verbatim from migration 073. Idempotent — re-run produces no '
  'changes once windows populate.';

REVOKE ALL ON FUNCTION public.compute_bridge_outcome_deltas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_bridge_outcome_deltas() TO service_role;

-- 2. The helper and the reset function: nothing else depends on them now.
DROP FUNCTION IF EXISTS public.derived_account_return_over(uuid, date, integer);
DROP FUNCTION IF EXISTS public.reset_holding_bridge_outcomes_to_derived_basis();

-- ───────────── post-condition — CATALOGUE ONLY, reads no row
DO $postcondition$
DECLARE
  v_src text;
BEGIN
  IF to_regprocedure('public.derived_account_return_over(uuid,date,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261102120000 failed: public.derived_account_return_over(uuid, date, integer) survived';
  END IF;
  IF to_regprocedure('public.reset_holding_bridge_outcomes_to_derived_basis()') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261102120000 failed: public.reset_holding_bridge_outcomes_to_derived_basis() survived';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p WHERE p.oid = to_regprocedure('public.compute_bridge_outcome_deltas()');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261102120000 failed: public.compute_bridge_outcome_deltas() is gone';
  END IF;
  v_src := regexp_replace(v_src, '--[^\n]*', '', 'g');
  IF position('extract_symbol_value_at' IN v_src) = 0 OR position('derived_account_return_over' IN v_src) > 0 THEN
    RAISE EXCEPTION 'Rollback 20261102120000 failed: public.compute_bridge_outcome_deltas() is not the 20260426131718 definition';
  END IF;
END
$postcondition$;

COMMIT;
