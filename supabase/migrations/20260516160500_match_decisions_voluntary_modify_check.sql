-- audit-2026-05-07 mitigation
-- Closes: H-0957 (red-team c8), H-0961 (silent-failure-hunter c8), H-0963 (data-migration c7)
-- Source file: supabase/migrations/20260426131718_match_decisions_kind_enum.sql (was 080)
-- Issue:
--   H-0957/H-0961/H-0963: the voluntary_modify CHECK in mig 080 leaves
--   `original_strategy_id` deliberately unconstrained ("may be NULL or
--   NOT NULL — rare legacy"). Consequences:
--     * Both-set rows pass the CHECK but fall out of every cron CTE
--       branch in compute_bridge_outcome_deltas() — silently lose
--       realized-delta tracking.
--     * The holding-branch in compute_bridge_outcome_deltas filters on
--       `md.original_strategy_id IS NULL AND md.original_holding_ref IS NOT NULL`
--       — exactly the voluntary_modify shape when original_strategy_id
--       IS NULL. So voluntary_modify with NULL original_strategy_id is
--       silently picked up by the holding branch (incorrect attribution).
-- Mitigation: tighten the voluntary_modify CHECK to require
--   `original_strategy_id IS NULL`. This forces the "pure weight-change
--   on existing holding" shape explicitly. Pre-flight violator count
--   emits NOTICE on existing rows that would fail the new CHECK
--   (operator can backfill).
--
-- Pattern: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT NOT VALID.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: pre-flight violator count
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_violators INTEGER;
BEGIN
  -- Existing voluntary_modify rows with original_strategy_id NOT NULL —
  -- the new CHECK forbids them. ADR-0023 narrative calls these "rare
  -- legacy mixed-portfolio rebalance". Probe live data — abort decision
  -- depends on count.
  SELECT COUNT(*) INTO v_violators
    FROM match_decisions
   WHERE kind = 'voluntary_modify'
     AND original_strategy_id IS NOT NULL;

  IF v_violators > 0 THEN
    RAISE NOTICE
      'audit-2026-05-07 H-0957/H-0961/H-0963: % voluntary_modify row(s) have original_strategy_id NOT NULL. The new CHECK is added NOT VALID so apply does not abort; backfill these rows (NULL the original_strategy_id) and run ALTER TABLE match_decisions VALIDATE CONSTRAINT match_decisions_kind_voluntary_modify_v2 to enforce on the full table.',
      v_violators;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: drop the old CHECK and add the new one
-- --------------------------------------------------------------------------
DO $$
BEGIN
  -- Drop old (v1, from mig 080)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.match_decisions'::regclass
       AND conname = 'match_decisions_kind_voluntary_modify'
  ) THEN
    ALTER TABLE public.match_decisions
      DROP CONSTRAINT match_decisions_kind_voluntary_modify;
  END IF;

  -- Add new (v2) if missing
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.match_decisions'::regclass
       AND conname = 'match_decisions_kind_voluntary_modify_v2'
  ) THEN
    ALTER TABLE public.match_decisions
      ADD CONSTRAINT match_decisions_kind_voluntary_modify_v2 CHECK (
        kind <> 'voluntary_modify' OR (
          original_holding_ref IS NOT NULL
          AND strategy_id IS NULL
          AND original_strategy_id IS NULL
        )
      ) NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT match_decisions_kind_voluntary_modify_v2
  ON public.match_decisions IS
  'audit-2026-05-07 H-0957/H-0961/H-0963. Tightens mig 080 voluntary_modify '
  'CHECK to require original_strategy_id IS NULL (was deliberately '
  'unconstrained). Pure weight-change-on-existing-holding shape only. '
  'Closes the silent cron mis-attribution path where voluntary_modify with '
  'NULL original_strategy_id was picked up by compute_bridge_outcome_deltas() '
  'holding branch. NOT VALID at install; operator validates after backfill.';

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
       AND conname = 'match_decisions_kind_voluntary_modify'
  ) INTO v_v1_present;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.match_decisions'::regclass
       AND conname = 'match_decisions_kind_voluntary_modify_v2'
  ) INTO v_v2_present;

  IF v_v1_present THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0957/H-0961/H-0963 verification failed: legacy match_decisions_kind_voluntary_modify (v1) still present';
  END IF;

  IF NOT v_v2_present THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0957/H-0961/H-0963 verification failed: match_decisions_kind_voluntary_modify_v2 missing';
  END IF;
END $$;

COMMIT;
