-- Migration 072: match_decisions.original_holding_ref + XOR CHECK + bridge_outcomes widened UNIQUE + match_batches.holding_flags
-- Phase 09 / D-13 + findings f4 + f5 — holdings-sourced Bridge outcome attribution (LIVE-04 + LIVE-05).
-- Mutually exclusive with original_strategy_id via match_decisions_original_xor CHECK.
-- Widens bridge_outcomes UNIQUE constraint along holding-ref axis via denormalized column + trigger.
-- Adds match_batches.holding_flags JSONB as the persistence seam between 09-02 engine writes and 09-03 SSR reads.
--
-- What this migration does (7 steps):
--   STEP 1: DROP NOT NULL on match_decisions.original_strategy_id (Pitfall 1 — must precede XOR)
--   STEP 2: ADD COLUMN match_decisions.original_holding_ref TEXT NULL
--   STEP 3: ADD XOR CHECK constraint on match_decisions (DROP IF EXISTS + re-add)
--   STEP 4: CREATE partial B-tree index on match_decisions.original_holding_ref
--   STEP 5: Widen bridge_outcomes UNIQUE constraint (denormalized column + sync trigger + widened index)
--   STEP 6: ADD match_batches.holding_flags JSONB NOT NULL DEFAULT '[]'::jsonb
--   STEP 7: Self-verifying DO block (7 assertions a–g) + greppable NOTICE strings (finding g3)
--
-- What this migration does NOT do:
--   - Touch RLS policies on match_decisions / bridge_outcomes / match_batches (all already have 3-tier RLS)
--   - Add FKs on original_holding_ref (Phase 08 D-08: scope_ref is text by design; no typed FK)
--   - Backfill match_decisions rows (pre-existing rows trivially satisfy XOR: original_strategy_id IS NOT NULL, original_holding_ref IS NULL → XOR = TRUE <> FALSE = TRUE)
--   - Register new pg_cron jobs
--   - Touch bridge_outcomes other RLS policies or its updated_at trigger (already in place via migration 059)
--
-- Application path: authored here; applied via `supabase db push`.
-- Self-verifying DO block raises EXCEPTION on any invariant failure.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: DROP NOT NULL on match_decisions.original_strategy_id
-- --------------------------------------------------------------------------
-- Migration 065 tightened this column to NOT NULL. The XOR CHECK added in
-- STEP 3 requires BOTH columns to be nullable — otherwise every new
-- holding-sourced INSERT would fail the existing NOT NULL before we even
-- reach the XOR evaluation. Pitfall 1 from RESEARCH.md mandates this DROP
-- precedes the XOR CHECK.
ALTER TABLE match_decisions
  ALTER COLUMN original_strategy_id DROP NOT NULL;

-- --------------------------------------------------------------------------
-- STEP 2: ADD COLUMN match_decisions.original_holding_ref
-- --------------------------------------------------------------------------
ALTER TABLE match_decisions
  ADD COLUMN IF NOT EXISTS original_holding_ref TEXT;

COMMENT ON COLUMN match_decisions.original_holding_ref IS
  'Phase 09 / D-13. scope_ref = "holding:{venue}:{symbol}:{holding_type}" '
  'for holdings-sourced Bridge decisions. Mutually exclusive with '
  'original_strategy_id via match_decisions_original_xor CHECK. '
  'No FK — scope_ref is text by design (Phase 08 D-08). '
  'See .planning/phases/09-bridge-live-against-real-holdings/09-CONTEXT.md §D-13.';

-- --------------------------------------------------------------------------
-- STEP 3: XOR CHECK on match_decisions (idempotent — DROP IF EXISTS first)
-- --------------------------------------------------------------------------
-- Enforces exactly one non-null per row: strategy-sourced decisions keep
-- original_strategy_id; holding-sourced decisions use original_holding_ref.
-- SQLSTATE 23514 on violation (both-set OR neither-set).
ALTER TABLE match_decisions
  DROP CONSTRAINT IF EXISTS match_decisions_original_xor;
ALTER TABLE match_decisions
  ADD CONSTRAINT match_decisions_original_xor CHECK (
    (original_strategy_id IS NOT NULL) <> (original_holding_ref IS NOT NULL)
  );

-- --------------------------------------------------------------------------
-- STEP 4: Partial B-tree index on match_decisions.original_holding_ref
-- --------------------------------------------------------------------------
-- Covering index for outcome-attribution lookups by holding_ref.
-- Partial (WHERE IS NOT NULL) avoids indexing strategy-sourced rows (majority).
CREATE INDEX IF NOT EXISTS match_decisions_original_holding_ref
  ON match_decisions (original_holding_ref)
  WHERE original_holding_ref IS NOT NULL;

-- --------------------------------------------------------------------------
-- STEP 5: Widen bridge_outcomes UNIQUE constraint along holding-ref axis
-- --------------------------------------------------------------------------
-- Finding f4: the current bridge_outcomes_unique_per_strategy index only
-- allows ONE outcome per (allocator_id, strategy_id). After Phase 09 ships,
-- two different holdings can both record outcomes against the same top-
-- candidate strategy — so the constraint must be widened to include the
-- holding-ref dimension.
--
-- Postgres requires IMMUTABLE index expressions; sub-selects against other
-- tables are not IMMUTABLE. The denormalized-column + trigger fallback from
-- finding f4 is the approved approach for Postgres 17 (per supabase/config.toml
-- [db] major_version = 17).
--
-- 5a. Denormalized column on bridge_outcomes ----------------------------
ALTER TABLE bridge_outcomes
  ADD COLUMN IF NOT EXISTS original_holding_ref TEXT;

COMMENT ON COLUMN bridge_outcomes.original_holding_ref IS
  'Phase 09 / finding f4. Denormalized mirror of match_decisions.original_holding_ref '
  'populated by bridge_outcomes_sync_holding_ref_trigger on INSERT/UPDATE OF match_decision_id. '
  'Enables the widened bridge_outcomes_unique_per_strategy_holding index. '
  'NULL for strategy-sourced rows (original_strategy_id path). '
  'NULL when match_decision_id IS NULL (legacy rows without a linked decision).';

-- 5b. Sync trigger: bridge_outcomes_sync_holding_ref ------------------
-- BEFORE INSERT OR UPDATE OF match_decision_id so the denormalized column
-- is populated atomically before the widened UNIQUE index evaluates.
-- SECURITY DEFINER with locked search_path: reads match_decisions by PK only
-- (parameterized — no dynamic SQL). T-09-01-PRIV threat mitigated.
CREATE OR REPLACE FUNCTION bridge_outcomes_sync_holding_ref()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.match_decision_id IS NOT NULL THEN
    SELECT original_holding_ref
      INTO NEW.original_holding_ref
      FROM match_decisions
     WHERE id = NEW.match_decision_id;
  ELSE
    NEW.original_holding_ref := NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION bridge_outcomes_sync_holding_ref IS
  'Phase 09 / finding f4. BEFORE INSERT OR UPDATE OF match_decision_id trigger function '
  'that denormalizes match_decisions.original_holding_ref into bridge_outcomes. '
  'SECURITY DEFINER + locked search_path; reads match_decisions by PK only (parameterized). '
  'Returns NEW with original_holding_ref populated or NULL when match_decision_id is NULL.';

DROP TRIGGER IF EXISTS bridge_outcomes_sync_holding_ref_trigger ON bridge_outcomes;
CREATE TRIGGER bridge_outcomes_sync_holding_ref_trigger
  BEFORE INSERT OR UPDATE OF match_decision_id ON bridge_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION bridge_outcomes_sync_holding_ref();

-- 5c. Backfill existing rows (one-off) --------------------------------
-- Defensive update for any existing bridge_outcomes rows that already have
-- a match_decision_id. Expected no-op on production (all rows are
-- strategy-sourced and match_decisions.original_holding_ref is NULL for
-- all pre-Phase-09 rows), but future-proofs against retro-insert migrations.
UPDATE bridge_outcomes bo
   SET original_holding_ref = md.original_holding_ref
  FROM match_decisions md
 WHERE md.id = bo.match_decision_id
   AND bo.original_holding_ref IS DISTINCT FROM md.original_holding_ref;

-- 5d. DROP the current over-broad UNIQUE index (verified name from 059:156-158)
DROP INDEX IF EXISTS bridge_outcomes_unique_per_strategy;

-- 5e. Recreate as widened UNIQUE: (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
-- COALESCE normalizes NULL to '' so strategy-sourced rows (original_holding_ref IS NULL)
-- share a single slot per (allocator, strategy) — preserving the migration 059 1-per-pair
-- guarantee for that path while allowing multiple different holdings against the same strategy.
CREATE UNIQUE INDEX IF NOT EXISTS bridge_outcomes_unique_per_strategy_holding
  ON bridge_outcomes (allocator_id, strategy_id, COALESCE(original_holding_ref, ''));

COMMENT ON INDEX bridge_outcomes_unique_per_strategy_holding IS
  'Phase 09 / finding f4. Widened from bridge_outcomes_unique_per_strategy (dropped) '
  'to permit two different holdings to both record outcomes against the same top-candidate '
  'strategy. Same (allocator, strategy, holding) still rejected with SQLSTATE 23505. '
  'COALESCE(..., '''') normalizes NULL to empty string so strategy-sourced rows '
  '(original_holding_ref IS NULL) share a single slot per (allocator, strategy).';

-- --------------------------------------------------------------------------
-- STEP 6: Add match_batches.holding_flags JSONB (finding f5 storage path)
-- --------------------------------------------------------------------------
-- Persistence seam between the analytics-service engine (Plan 09-02 writes
-- per-holding flag rows during score_candidates) and the Next.js SSR
-- dashboard (Plan 09-03 reads via getMyAllocationDashboard). Each array
-- entry: { holding_ref, value_usd, weight, breach_reasons, top_candidate_strategy_id,
-- top_candidate_composite, flagged }.
ALTER TABLE match_batches
  ADD COLUMN IF NOT EXISTS holding_flags JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN match_batches.holding_flags IS
  'Phase 09 / finding f5. Per-holding flag rows written by _load_allocator_context '
  'in Plan 09-02 and read by getMyAllocationDashboard in Plan 09-03. Each array '
  'entry: { holding_ref, value_usd, weight, breach_reasons[], top_candidate_strategy_id, '
  'top_candidate_composite, flagged }. Empty array when allocator has no holdings '
  'or no mandate breaches.';

-- --------------------------------------------------------------------------
-- STEP 7: Self-verifying DO block (7 assertions a–g)
-- --------------------------------------------------------------------------
-- Raises EXCEPTION on any invariant failure → transaction rollback.
-- Emits greppable NOTICE strings per finding g3.
DO $$
DECLARE
  v_col_nullable       BOOLEAN;
  v_xor_def            TEXT;
  v_violation_count    INT;
  v_old_index_present  BOOLEAN;
  v_new_index_present  BOOLEAN;
  v_holding_flags_type TEXT;
  v_holding_flags_null TEXT;
BEGIN

  -- (a) original_strategy_id is now nullable on match_decisions
  SELECT (is_nullable = 'YES')
    INTO v_col_nullable
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'match_decisions'
     AND column_name  = 'original_strategy_id';

  IF v_col_nullable IS NOT TRUE THEN
    RAISE EXCEPTION 'Migration 072 assertion (a) failed: match_decisions.original_strategy_id is still NOT NULL — STEP 1 DROP NOT NULL did not apply';
  END IF;

  -- (b) original_holding_ref exists on match_decisions as TEXT (nullable)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'match_decisions'
       AND column_name  = 'original_holding_ref'
       AND data_type    = 'text'
       AND is_nullable  = 'YES'
  ) THEN
    RAISE EXCEPTION 'Migration 072 assertion (b) failed: match_decisions.original_holding_ref TEXT NULL not found';
  END IF;

  -- (c) XOR CHECK constraint body contains both expected column references
  SELECT pg_get_constraintdef(oid)
    INTO v_xor_def
    FROM pg_constraint
   WHERE conrelid = 'public.match_decisions'::regclass
     AND conname  = 'match_decisions_original_xor';

  IF v_xor_def IS NULL THEN
    RAISE EXCEPTION 'Migration 072 assertion (c) failed: match_decisions_original_xor constraint not found';
  END IF;

  IF v_xor_def NOT LIKE '%original_strategy_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'Migration 072 assertion (c) failed: XOR def missing "original_strategy_id IS NOT NULL" — got: %', v_xor_def;
  END IF;

  IF v_xor_def NOT LIKE '%original_holding_ref IS NOT NULL%' THEN
    RAISE EXCEPTION 'Migration 072 assertion (c) failed: XOR def missing "original_holding_ref IS NOT NULL" — got: %', v_xor_def;
  END IF;

  -- (d) Partial index match_decisions_original_holding_ref exists on match_decisions
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'match_decisions'
       AND indexname  = 'match_decisions_original_holding_ref'
  ) THEN
    RAISE EXCEPTION 'Migration 072 assertion (d) failed: partial index match_decisions_original_holding_ref not found on match_decisions';
  END IF;

  -- (e) No existing match_decisions row violates the XOR CHECK
  SELECT COUNT(*) INTO v_violation_count
    FROM match_decisions
   WHERE NOT (
     (original_strategy_id IS NOT NULL) <> (original_holding_ref IS NOT NULL)
   );

  IF v_violation_count > 0 THEN
    RAISE EXCEPTION 'Migration 072 assertion (e) failed: % match_decisions rows violate the XOR CHECK', v_violation_count;
  END IF;

  -- (f) bridge_outcomes widened UNIQUE index swap: old gone, new present
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'bridge_outcomes'
       AND indexname  = 'bridge_outcomes_unique_per_strategy'
  ) INTO v_old_index_present;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'bridge_outcomes'
       AND indexname  = 'bridge_outcomes_unique_per_strategy_holding'
  ) INTO v_new_index_present;

  IF v_old_index_present THEN
    RAISE EXCEPTION 'Migration 072 assertion (f) failed: bridge_outcomes_unique_per_strategy still present — DROP did not apply';
  END IF;

  IF NOT v_new_index_present THEN
    RAISE EXCEPTION 'Migration 072 assertion (f) failed: bridge_outcomes_unique_per_strategy_holding not found';
  END IF;

  -- (g) match_batches.holding_flags is JSONB NOT NULL
  SELECT data_type, is_nullable
    INTO v_holding_flags_type, v_holding_flags_null
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'match_batches'
     AND column_name  = 'holding_flags';

  IF v_holding_flags_type IS NULL THEN
    RAISE EXCEPTION 'Migration 072 assertion (g) failed: match_batches.holding_flags column not found';
  END IF;

  IF v_holding_flags_type != 'jsonb' THEN
    RAISE EXCEPTION 'Migration 072 assertion (g) failed: match_batches.holding_flags data_type = % (expected jsonb)', v_holding_flags_type;
  END IF;

  IF v_holding_flags_null != 'NO' THEN
    RAISE EXCEPTION 'Migration 072 assertion (g) failed: match_batches.holding_flags is_nullable = % (expected NO)', v_holding_flags_null;
  END IF;

  -- All assertions passed — emit greppable NOTICE strings per finding g3
  RAISE NOTICE 'phase09: match_decisions.original_holding_ref XOR CHECK deployed ✓';
  RAISE NOTICE 'phase09: bridge_outcomes UNIQUE index widened for holding-ref siblings ✓';
  RAISE NOTICE 'phase09: match_batches.holding_flags JSONB column deployed ✓';
  RAISE NOTICE 'Migration 072: all 7 self-verification assertions (a-g) passed.';

END
$$;

COMMIT;
