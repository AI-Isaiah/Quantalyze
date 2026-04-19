-- Migration 065: tighten match_decisions.original_strategy_id to NOT NULL
-- Sprint 8 Phase 5 (Outcomes Dashboard) — Voice-C3 follow-up (2026-04-19).
--
-- Migration 064 added the column as NULL-allowed. This migration tightens
-- to NOT NULL once the admin UI has been confirmed shipping values
-- (see 5-01-W1-04 + 5-01-W3-02). The DO-block guard below verifies no
-- existing row violates the NOT NULL invariant BEFORE the ALTER runs;
-- RAISE EXCEPTION aborts the migration if any NULL row exists.

BEGIN;

------------------------------------------------------------------
-- 1. Pre-tighten guard: verify no existing NULL rows.
------------------------------------------------------------------
DO $$
DECLARE
  v_null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_null_count
  FROM match_decisions
  WHERE original_strategy_id IS NULL;

  IF v_null_count > 0 THEN
    RAISE EXCEPTION 'Migration 065 aborted: % match_decisions rows have NULL original_strategy_id. Resolve before tightening to NOT NULL (admin UI may not yet be deployed, OR legacy rows exist).', v_null_count;
  END IF;

  RAISE NOTICE 'Migration 065: zero NULL rows confirmed — proceeding with NOT NULL tightening.';
END
$$;

------------------------------------------------------------------
-- 2. Tighten to NOT NULL.
------------------------------------------------------------------
ALTER TABLE match_decisions
  ALTER COLUMN original_strategy_id SET NOT NULL;

------------------------------------------------------------------
-- 3. Post-tighten verification.
------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'match_decisions'
       AND column_name = 'original_strategy_id'
       AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'Migration 065 failed: match_decisions.original_strategy_id still nullable';
  END IF;

  RAISE NOTICE 'Migration 065: match_decisions.original_strategy_id tightened to NOT NULL.';
END
$$;

COMMIT;
