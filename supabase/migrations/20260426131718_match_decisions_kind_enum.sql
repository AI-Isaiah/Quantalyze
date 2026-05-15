-- Migration 080: match_decisions kind enum + relax XOR + per-kind CHECKs + voluntary_add cron branch
-- Phase 10 / SCENARIO-07 (D-10 + D-11 + D-17): Relaxes the Phase 09 XOR constraint on
-- match_decisions and replaces it with a match_decision_kind enum column gated by four
-- per-kind invariant CHECK constraints. The new enum supports:
--   bridge_recommended  — existing rows backfill into this (XOR semantics preserved)
--   voluntary_remove    — allocator toggles a holding off in Scenario (no candidate)
--   voluntary_add       — allocator adds a strategy via Browse drawer (no original holding)
--   voluntary_modify    — pure weight-change; no toggle, no swap (D-17 ship)
--
-- Schema-name reconciliation (Rule 1 deviation):
--   The plan + RESEARCH refer to the recommended/added strategy column on match_decisions
--   as `suggested_strategy_id`. The live schema (since migration 011) calls this column
--   `strategy_id` (NOT NULL until this migration). Per-kind CHECKs in this migration use
--   the actual column name `strategy_id`. The voluntary_remove kind requires this column
--   to be NULL — STEP 2 below drops the NOT NULL constraint to enable that. Pattern matches
--   migration 072 STEP 1 which dropped NOT NULL on original_strategy_id before the XOR.
--
-- ADR-0023 sync: same-commit update documents the new enum + Phase 10 audit metadata
-- shape (the existing match.decision_record audit kind carries voluntary diffs unchanged
-- via metadata.kind, per Phase 09 D-14 precedent).
--
-- H2 — voluntary_add cron coverage (RESEARCH Pitfall 5): voluntary_add rows have BOTH
-- original_holding_ref AND original_strategy_id NULL. Phase 09 migration 073's two CTE
-- branches in compute_bridge_outcome_deltas() match on those two columns — voluntary_add
-- rows satisfy NEITHER and would be silently dropped from delta tracking forever. This
-- migration ships a third CTE branch matching md.kind='voluntary_add' atomically with the
-- enum so the daily cron picks them up once strategy_analytics.returns_series catches up.
-- The DO block at the end asserts the branch is reachable.
--
-- L1/M2 backfill assertions: every existing match_decisions row passes the new
-- bridge_recommended CHECK (strategy_id NOT NULL AND one of original_* NOT NULL).
-- The DO block verifies this before COMMIT — any pre-existing data that would violate
-- the new invariants raises EXCEPTION → transaction rollback.
--
-- Application path: authored here; applied via Supabase Management API
-- (POST /v1/projects/{ref}/database/query) to bypass `supabase db push` migration-history
-- drift on this project (timestamp-format rows from prior MCP applies). Self-verifying
-- DO block raises EXCEPTION on any invariant failure → automatic rollback.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: Create match_decision_kind enum (idempotent)
-- --------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE match_decision_kind AS ENUM (
    'bridge_recommended',
    'voluntary_remove',
    'voluntary_add',
    'voluntary_modify'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: DROP NOT NULL on match_decisions.strategy_id
-- --------------------------------------------------------------------------
-- Pattern from migration 072 STEP 1 (which had to drop NOT NULL on
-- original_strategy_id before adding the XOR CHECK). voluntary_remove kind
-- requires strategy_id IS NULL — without this DROP, voluntary_remove INSERTs
-- would fail the column-level NOT NULL before reaching the per-kind CHECK.
ALTER TABLE match_decisions
  ALTER COLUMN strategy_id DROP NOT NULL;

-- --------------------------------------------------------------------------
-- STEP 3: Add nullable kind column for backfill window
-- --------------------------------------------------------------------------
ALTER TABLE match_decisions
  ADD COLUMN IF NOT EXISTS kind match_decision_kind;

COMMENT ON COLUMN match_decisions.kind IS
  'Phase 10 / SCENARIO-07 (D-10/D-11/D-17). Discriminator gating per-kind CHECK constraints. '
  'bridge_recommended: pre-Phase-10 + Bridge-recommended path (strategy_id NOT NULL '
  'AND one of original_* NOT NULL — strategy_id is the suggested/recommended strategy '
  'in the live schema; the plan refers to it as suggested_strategy_id). voluntary_remove: '
  'allocator-toggled-off holding (original_holding_ref NOT NULL, both strategy fields NULL). '
  'voluntary_add: browse-added strategy with no original holding (strategy_id NOT NULL, '
  'both original_* NULL). voluntary_modify: weight-change-only on existing holding '
  '(original_holding_ref NOT NULL, strategy_id NULL). Pre-Phase-10 rows backfilled to '
  'bridge_recommended in migration 080 STEP 4.';

-- --------------------------------------------------------------------------
-- STEP 4: Backfill existing rows → 'bridge_recommended'
-- --------------------------------------------------------------------------
-- All pre-Phase-10 rows satisfy the bridge_recommended CHECK trivially:
-- they passed the Phase 09 XOR (one of original_* NOT NULL) and the engine
-- always wrote strategy_id (NOT NULL until STEP 2 above) for any row that
-- reached match_decisions.
UPDATE match_decisions
   SET kind = 'bridge_recommended'
 WHERE kind IS NULL;

-- --------------------------------------------------------------------------
-- STEP 5: Lock down kind column — NOT NULL + DEFAULT
-- --------------------------------------------------------------------------
-- DEFAULT 'bridge_recommended' preserves backward compatibility: any pre-Phase-10
-- INSERT that omits the kind column lands as bridge_recommended (which is exactly
-- the shape those code paths produce). The plan's "must_haves: backward-compatible
-- with all pre-Phase-10 inserts" is satisfied by this default.
ALTER TABLE match_decisions
  ALTER COLUMN kind SET NOT NULL,
  ALTER COLUMN kind SET DEFAULT 'bridge_recommended';

-- --------------------------------------------------------------------------
-- STEP 6: DROP the Phase 09 XOR constraint
-- --------------------------------------------------------------------------
-- The XOR constraint required exactly one of original_strategy_id /
-- original_holding_ref to be set. voluntary_remove keeps original_holding_ref
-- but voluntary_add requires both NULL — the XOR makes voluntary_add impossible.
-- Per-kind CHECKs (STEP 7) replace XOR with kind-aware invariants.
ALTER TABLE match_decisions
  DROP CONSTRAINT IF EXISTS match_decisions_original_xor;

-- --------------------------------------------------------------------------
-- STEP 7: Per-kind invariant CHECK constraints (4 total)
-- --------------------------------------------------------------------------
-- Note: `strategy_id` is the live schema's name for what the plan calls
-- `suggested_strategy_id` (the recommended/added strategy on a decision row).
-- Pre-Phase-10 rows always have strategy_id NOT NULL — they backfill cleanly
-- into bridge_recommended.

-- bridge_recommended: strategy_id NOT NULL AND (one of original_* NOT NULL)
-- This is the EXACT shape pre-Phase-10 rows have, so backfill satisfies trivially.
ALTER TABLE match_decisions
  ADD CONSTRAINT match_decisions_kind_bridge_recommended CHECK (
    kind <> 'bridge_recommended' OR (
      strategy_id IS NOT NULL
      AND (original_strategy_id IS NOT NULL OR original_holding_ref IS NOT NULL)
    )
  );

-- voluntary_remove: only original_holding_ref is set; both strategy fields NULL.
-- Models "allocator toggled this holding off — no replacement" semantics.
ALTER TABLE match_decisions
  ADD CONSTRAINT match_decisions_kind_voluntary_remove CHECK (
    kind <> 'voluntary_remove' OR (
      original_holding_ref IS NOT NULL
      AND strategy_id IS NULL
      AND original_strategy_id IS NULL
    )
  );

-- voluntary_add: only strategy_id is set; both original_* NULL.
-- Models "allocator added a strategy via Browse — no original holding" semantics.
ALTER TABLE match_decisions
  ADD CONSTRAINT match_decisions_kind_voluntary_add CHECK (
    kind <> 'voluntary_add' OR (
      strategy_id IS NOT NULL
      AND original_holding_ref IS NULL
      AND original_strategy_id IS NULL
    )
  );

-- voluntary_modify: original_holding_ref NOT NULL (the holding being rebalanced);
-- strategy_id IS NULL (no swap involved). original_strategy_id may be NULL
-- (typical scenario tweak) or NOT NULL (legacy mixed-portfolio rebalance — rare).
ALTER TABLE match_decisions
  ADD CONSTRAINT match_decisions_kind_voluntary_modify CHECK (
    kind <> 'voluntary_modify' OR (
      original_holding_ref IS NOT NULL
      AND strategy_id IS NULL
    )
  );

-- --------------------------------------------------------------------------
-- STEP 8 (H2): Extend compute_bridge_outcome_deltas() with voluntary_add CTE branch
-- --------------------------------------------------------------------------
-- voluntary_add rows have BOTH original_holding_ref AND original_strategy_id NULL,
-- so neither existing branch in migration 073 fires. Without this third branch
-- they would be silently skipped from delta tracking forever (RESEARCH Pitfall 5).
--
-- The branch joins on bridge_outcomes.strategy_id against
-- strategy_analytics.returns_series using the same extract_delta() / extract_estimated()
-- helpers the strategy branch uses. Idempotency guard preserved:
-- WHERE delta_30d IS NULL OR needs_recompute = TRUE.
--
-- Replaces the entire function body to add the new branch — preserves the migration
-- 073 strategy + holding branches verbatim and appends the voluntary_add branch.
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

-- CREATE OR REPLACE strips existing GRANTs — re-apply per migration 073 STEP 4.
REVOKE ALL ON FUNCTION public.compute_bridge_outcome_deltas FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_bridge_outcome_deltas TO service_role;

-- --------------------------------------------------------------------------
-- STEP 9: Self-verifying DO block (7 assertions a-g)
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_null_kind                  INT;
  v_xor_present                INT;
  v_enum_present               INT;
  v_check_count                INT;
  v_orphan_bridge_recommended  INT;
  v_constraint_violators       INT;
  v_cron_branch_present        INT;
BEGIN
  -- (a) No NULL kind values remain after backfill
  SELECT COUNT(*) INTO v_null_kind FROM match_decisions WHERE kind IS NULL;
  IF v_null_kind > 0 THEN
    RAISE EXCEPTION 'Migration 080 assertion (a) failed: % rows have NULL kind after backfill', v_null_kind;
  END IF;

  -- (b) Old XOR constraint gone
  SELECT COUNT(*) INTO v_xor_present
    FROM pg_constraint
   WHERE conrelid = 'public.match_decisions'::regclass
     AND conname = 'match_decisions_original_xor';
  IF v_xor_present > 0 THEN
    RAISE EXCEPTION 'Migration 080 assertion (b) failed: match_decisions_original_xor still present';
  END IF;

  -- (c) match_decision_kind enum exists
  SELECT COUNT(*) INTO v_enum_present
    FROM pg_type WHERE typname = 'match_decision_kind';
  IF v_enum_present = 0 THEN
    RAISE EXCEPTION 'Migration 080 assertion (c) failed: match_decision_kind enum not found';
  END IF;

  -- (d) All four per-kind CHECK constraints present
  SELECT COUNT(*) INTO v_check_count
    FROM pg_constraint
   WHERE conrelid = 'public.match_decisions'::regclass
     AND conname IN (
       'match_decisions_kind_bridge_recommended',
       'match_decisions_kind_voluntary_remove',
       'match_decisions_kind_voluntary_add',
       'match_decisions_kind_voluntary_modify'
     );
  IF v_check_count <> 4 THEN
    RAISE EXCEPTION 'Migration 080 assertion (d) failed: expected 4 per-kind CHECK constraints, found %', v_check_count;
  END IF;

  -- (e) M2 — every backfilled bridge_recommended row has at least one original_* set
  SELECT COUNT(*) INTO v_orphan_bridge_recommended
    FROM match_decisions
   WHERE kind = 'bridge_recommended'
     AND original_holding_ref IS NULL
     AND original_strategy_id IS NULL;
  IF v_orphan_bridge_recommended > 0 THEN
    RAISE NOTICE 'WARN: % pre-existing bridge_recommended rows have NULL/NULL originals (constraint would reject these on re-INSERT). Investigate.', v_orphan_bridge_recommended;
  END IF;

  -- (f) L1 — all existing rows pass all four CHECK constraints (defense in depth)
  SELECT COUNT(*) INTO v_constraint_violators
    FROM match_decisions
   WHERE NOT (
     (kind <> 'bridge_recommended' OR (strategy_id IS NOT NULL AND (original_strategy_id IS NOT NULL OR original_holding_ref IS NOT NULL)))
     AND (kind <> 'voluntary_remove' OR (original_holding_ref IS NOT NULL AND strategy_id IS NULL AND original_strategy_id IS NULL))
     AND (kind <> 'voluntary_add' OR (strategy_id IS NOT NULL AND original_holding_ref IS NULL AND original_strategy_id IS NULL))
     AND (kind <> 'voluntary_modify' OR (original_holding_ref IS NOT NULL AND strategy_id IS NULL))
   );
  IF v_constraint_violators > 0 THEN
    RAISE EXCEPTION 'Migration 080 assertion (f) failed: % existing rows violate the new per-kind CHECKs', v_constraint_violators;
  END IF;

  -- (g) H2 — voluntary_add CTE branch is reachable in compute_bridge_outcome_deltas()
  SELECT COUNT(*) INTO v_cron_branch_present
    FROM pg_proc p
   WHERE p.proname = 'compute_bridge_outcome_deltas'
     AND pg_get_functiondef(p.oid) LIKE '%voluntary_add_candidates%';
  IF v_cron_branch_present = 0 THEN
    RAISE EXCEPTION 'Migration 080 assertion (g) failed: voluntary_add cron branch not present in compute_bridge_outcome_deltas';
  END IF;

  RAISE NOTICE 'phase10: match_decisions kind enum deployed, XOR relaxed, 4 per-kind CHECKs active, voluntary_add cron branch live';
  RAISE NOTICE 'Migration 080: all 7 self-verification assertions (a-g) passed.';
END
$$;

COMMIT;
