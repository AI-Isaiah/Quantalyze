-- Migration 074: Widen match_decisions partial UNIQUE indexes along holding-ref axis
-- Phase 09 / D-14 addendum — follow-up to migration 072 (which widened bridge_outcomes
-- but omitted the symmetric fix on match_decisions itself).
--
-- Finding (post-migration 072 live-DB regression):
--   uniq_match_dec_thumbup_per_pair  ON match_decisions (allocator_id, strategy_id) WHERE decision='thumbs_up'
--   uniq_match_dec_thumbdown_per_pair ON match_decisions (allocator_id, strategy_id) WHERE decision='thumbs_down'
--   → Both were created in migration 011 (strategy-sourced path only).
--   → Phase 09 holding-sourced path: same (allocator_id, strategy_id) pair may produce
--     two or more decisions for DIFFERENT holdings — these constraints block that.
--
-- Fix: drop old narrow partial indexes and replace with widened versions that include
-- COALESCE(original_holding_ref, '') so:
--   • Strategy-sourced rows (original_holding_ref IS NULL) → coalesces to '' → preserve
--     the 1-per-pair guarantee for the strategy path.
--   • Holding-sourced rows (original_holding_ref IS NOT NULL) → different holdings
--     have different coalesced values → all succeed.
--
-- This migration is idempotent: DROP IF EXISTS + CREATE ... IF NOT EXISTS.
-- No data backfill needed: all pre-Phase-09 rows have original_holding_ref IS NULL
-- → COALESCE to '' → single slot per pair → exactly the prior guarantee.

BEGIN;
SET lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- STEP 1: Drop the old narrow partial UNIQUE indexes from migration 011
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.uniq_match_dec_thumbup_per_pair;
DROP INDEX IF EXISTS public.uniq_match_dec_thumbdown_per_pair;

-- ---------------------------------------------------------------------------
-- STEP 2: Recreate as widened partial UNIQUE indexes with holding-ref axis
-- ---------------------------------------------------------------------------
-- thumbs_up: one thumbs_up per (allocator, strategy, holding_ref_or_empty)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_match_dec_thumbup_per_pair_holding
  ON match_decisions (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
  WHERE decision = 'thumbs_up';

COMMENT ON INDEX uniq_match_dec_thumbup_per_pair_holding IS
  'Phase 09 / migration 074. Widened from uniq_match_dec_thumbup_per_pair (dropped). '
  'Allows multiple thumbs_up decisions on the same (allocator, strategy) when they '
  'originate from different holdings. COALESCE(original_holding_ref, '''') normalizes '
  'NULL→'''' so strategy-sourced rows (original_holding_ref IS NULL) still get '
  'a single slot per pair (migration 011 guarantee preserved).';

-- thumbs_down: one thumbs_down per (allocator, strategy, holding_ref_or_empty)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_match_dec_thumbdown_per_pair_holding
  ON match_decisions (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
  WHERE decision = 'thumbs_down';

COMMENT ON INDEX uniq_match_dec_thumbdown_per_pair_holding IS
  'Phase 09 / migration 074. Widened from uniq_match_dec_thumbdown_per_pair (dropped). '
  'Same semantics as uniq_match_dec_thumbup_per_pair_holding — see above.';

-- ---------------------------------------------------------------------------
-- STEP 3: Self-verifying DO block (3 assertions)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_old_up_present   BOOLEAN;
  v_old_dn_present   BOOLEAN;
  v_new_up_present   BOOLEAN;
  v_new_dn_present   BOOLEAN;
BEGIN

  -- (a) Old narrow indexes are gone
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'match_decisions'
       AND indexname  = 'uniq_match_dec_thumbup_per_pair'
  ) INTO v_old_up_present;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'match_decisions'
       AND indexname  = 'uniq_match_dec_thumbdown_per_pair'
  ) INTO v_old_dn_present;

  IF v_old_up_present THEN
    RAISE EXCEPTION 'Migration 074 assertion (a) failed: uniq_match_dec_thumbup_per_pair still present';
  END IF;

  IF v_old_dn_present THEN
    RAISE EXCEPTION 'Migration 074 assertion (a) failed: uniq_match_dec_thumbdown_per_pair still present';
  END IF;

  -- (b) New widened indexes exist
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'match_decisions'
       AND indexname  = 'uniq_match_dec_thumbup_per_pair_holding'
  ) INTO v_new_up_present;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'match_decisions'
       AND indexname  = 'uniq_match_dec_thumbdown_per_pair_holding'
  ) INTO v_new_dn_present;

  IF NOT v_new_up_present THEN
    RAISE EXCEPTION 'Migration 074 assertion (b) failed: uniq_match_dec_thumbup_per_pair_holding not found';
  END IF;

  IF NOT v_new_dn_present THEN
    RAISE EXCEPTION 'Migration 074 assertion (b) failed: uniq_match_dec_thumbdown_per_pair_holding not found';
  END IF;

  -- (c) No existing match_decisions row violates the widened uniqueness
  --     (pre-existing rows all have original_holding_ref IS NULL → coalesces to '' → each
  --     has a unique (allocator_id, strategy_id, '') per decision → invariant holds)
  IF EXISTS (
    SELECT allocator_id, strategy_id, COALESCE(original_holding_ref, ''), decision, COUNT(*)
      FROM match_decisions
     WHERE decision IN ('thumbs_up', 'thumbs_down')
     GROUP BY allocator_id, strategy_id, COALESCE(original_holding_ref, ''), decision
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Migration 074 assertion (c) failed: duplicate (allocator_id, strategy_id, COALESCE(original_holding_ref,''''''), decision) tuples found — data inconsistency';
  END IF;

  RAISE NOTICE 'phase09: match_decisions UNIQUE indexes widened for holding-ref siblings ✓';
  RAISE NOTICE 'Migration 074: all 3 self-verification assertions (a-c) passed.';

END
$$;

COMMIT;
