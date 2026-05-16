-- audit-2026-05-07 mitigation
-- Closes: H-0956 (red-team c8), H-0962 (silent-failure-hunter c8)
-- Source file: supabase/migrations/20260426131718_match_decisions_kind_enum.sql (was 080)
-- Issue:
--   H-0956: the bridge_recommended CHECK uses OR ("original_strategy_id
--     IS NOT NULL OR original_holding_ref IS NOT NULL") — admitting
--     both-set rows that the Phase-09 XOR forbade. None of the cron
--     branches in compute_bridge_outcome_deltas() cover both-set rows,
--     so they silently lose realized-delta tracking.
--   H-0962: assertion (e) in mig 080's DO block is RAISE NOTICE
--     (warn-only) for orphan bridge_recommended rows. The CHECK relaxation
--     means future inserts can now silently create the same orphans.
--
-- Mitigation: tighten the `match_decisions_kind_bridge_recommended`
--   CHECK to require EXACTLY ONE of original_strategy_id /
--   original_holding_ref. Pre-flight count of any existing violators
--   (both-set OR both-NULL) — emit RAISE NOTICE if any exist, but do
--   NOT abort the migration (the orphans are pre-existing rows that
--   ADR-0023 explicitly tolerated as "rare legacy"; admin can clean
--   them later). The new CHECK is added with NOT VALID for safety.
--
-- Pattern: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT NOT VALID. The
-- DROP is idempotent. The ADD is idempotent via a DO block that
-- checks for an existing constraint of the new name (in case re-apply
-- after a partial run).

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: pre-flight violator count
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_both_set        INTEGER;
  v_both_null       INTEGER;
  v_strategy_null   INTEGER;
BEGIN
  -- Both-set: kind='bridge_recommended' with BOTH originals NOT NULL.
  -- Phase 09 XOR forbade this; mig 080 relaxed to OR; tightening to XOR
  -- here. Existing rows in this shape are rare-legacy per ADR-0023.
  SELECT COUNT(*) INTO v_both_set
    FROM match_decisions
   WHERE kind = 'bridge_recommended'
     AND original_strategy_id IS NOT NULL
     AND original_holding_ref IS NOT NULL;

  -- Both-NULL: would already violate mig 080's CHECK — should be 0
  -- after mig 080 applied. Probe anyway in case the OR-CHECK was
  -- partially-applied or rolled back.
  SELECT COUNT(*) INTO v_both_null
    FROM match_decisions
   WHERE kind = 'bridge_recommended'
     AND original_strategy_id IS NULL
     AND original_holding_ref IS NULL;

  -- Strategy_id NULL for bridge_recommended: would violate mig 080
  -- CHECK too. Probe for completeness.
  SELECT COUNT(*) INTO v_strategy_null
    FROM match_decisions
   WHERE kind = 'bridge_recommended'
     AND strategy_id IS NULL;

  IF v_both_set > 0 OR v_both_null > 0 OR v_strategy_null > 0 THEN
    RAISE NOTICE
      'audit-2026-05-07 H-0956/H-0962: pre-existing bridge_recommended violators detected — both_set=%, both_null=%, strategy_null=%. The new XOR CHECK is added NOT VALID so apply does not abort; backfill these rows and run ALTER TABLE match_decisions VALIDATE CONSTRAINT match_decisions_kind_bridge_recommended_v2 to enforce on the full table.',
      v_both_set, v_both_null, v_strategy_null;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: drop the old OR-shaped CHECK and add the new XOR-shaped one
-- --------------------------------------------------------------------------
-- Use a fresh constraint name so the OLD constraint can be dropped
-- IF EXISTS and the NEW one can be ADDed IF NOT EXISTS. Both DDLs
-- are idempotent across re-apply.
DO $$
BEGIN
  -- Drop old (the v1, OR-shaped, from migration 080)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.match_decisions'::regclass
       AND conname = 'match_decisions_kind_bridge_recommended'
  ) THEN
    ALTER TABLE public.match_decisions
      DROP CONSTRAINT match_decisions_kind_bridge_recommended;
  END IF;

  -- Add new (v2, XOR-shaped) if not already present
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.match_decisions'::regclass
       AND conname = 'match_decisions_kind_bridge_recommended_v2'
  ) THEN
    ALTER TABLE public.match_decisions
      ADD CONSTRAINT match_decisions_kind_bridge_recommended_v2 CHECK (
        kind <> 'bridge_recommended' OR (
          strategy_id IS NOT NULL
          AND ((original_strategy_id IS NOT NULL) <> (original_holding_ref IS NOT NULL))
        )
      ) NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT match_decisions_kind_bridge_recommended_v2
  ON public.match_decisions IS
  'audit-2026-05-07 H-0956/H-0962. Tightens mig 080 bridge_recommended CHECK '
  'from OR to true XOR: bridge_recommended requires strategy_id NOT NULL AND '
  'EXACTLY ONE of (original_strategy_id, original_holding_ref) NOT NULL. '
  'Closes the cron-coverage gap where both-set rows fell out of every CTE '
  'branch in compute_bridge_outcome_deltas(). NOT VALID at install; operator '
  'validates after backfilling pre-existing both-set / both-null rows.';

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_v1_present BOOLEAN;
  v_v2_present BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.match_decisions'::regclass
       AND conname = 'match_decisions_kind_bridge_recommended'
  ) INTO v_v1_present;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.match_decisions'::regclass
       AND conname = 'match_decisions_kind_bridge_recommended_v2'
  ) INTO v_v2_present;

  IF v_v1_present THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0956/H-0962 verification failed: legacy match_decisions_kind_bridge_recommended (v1) still present';
  END IF;

  IF NOT v_v2_present THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0956/H-0962 verification failed: match_decisions_kind_bridge_recommended_v2 (XOR) missing';
  END IF;
END $$;

COMMIT;
