-- audit-2026-05-07 mitigation (specialist-review apply pass take 2)
-- Closes: HIGH-1 (data-migration c8)
--   migs 20260516160400 + 20260516160500 added the v2 CHECKs as
--   NOT VALID and emitted a RAISE NOTICE telling the operator to
--   run `ALTER TABLE match_decisions VALIDATE CONSTRAINT ...`
--   manually after backfill. The operator runbook is fragile;
--   cron.job_run_details is rarely scraped (the NOTICE may go
--   unread); without VALIDATE the v2 CHECKs are effectively
--   per-insert filters with no full-table guarantee.
--
-- Source migrations:
--   supabase/migrations/20260516160400_match_decisions_bridge_recommended_xor.sql
--   supabase/migrations/20260516160500_match_decisions_voluntary_modify_check.sql
-- (do NOT edit those files.)
--
-- Strategy: run VALIDATE for both constraints in a DO/BEGIN/EXCEPTION
-- block. If a violator row exists, the VALIDATE fails with
-- check_violation; we catch + RAISE EXCEPTION with a clear violator-count
-- diagnostic so the operator can backfill before retrying.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: pre-flight violator counts for both v2 constraints
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_bridge_recommended_violators INTEGER := 0;
  v_voluntary_modify_violators INTEGER := 0;
BEGIN
  -- bridge_recommended XOR violators: both originals set, or both null
  SELECT COUNT(*) INTO v_bridge_recommended_violators
    FROM match_decisions
   WHERE kind = 'bridge_recommended'
     AND (
       strategy_id IS NULL
       OR (
         (original_strategy_id IS NOT NULL) = (original_holding_ref IS NOT NULL)
       )
     );

  -- voluntary_modify v2 violators: original_strategy_id NOT NULL
  SELECT COUNT(*) INTO v_voluntary_modify_violators
    FROM match_decisions
   WHERE kind = 'voluntary_modify'
     AND NOT (
       original_holding_ref IS NOT NULL
       AND strategy_id IS NULL
       AND original_strategy_id IS NULL
     );

  IF v_bridge_recommended_violators > 0 THEN
    RAISE EXCEPTION
      'audit-2026-05-07 HIGH-1 VALIDATE pre-flight: % bridge_recommended row(s) violate match_decisions_kind_bridge_recommended_v2. Backfill these rows before re-running this migration (NULL one of original_strategy_id / original_holding_ref so XOR holds).',
      v_bridge_recommended_violators;
  END IF;

  IF v_voluntary_modify_violators > 0 THEN
    RAISE EXCEPTION
      'audit-2026-05-07 HIGH-1 VALIDATE pre-flight: % voluntary_modify row(s) violate match_decisions_kind_voluntary_modify_v2. Backfill these rows (NULL the original_strategy_id) before re-running this migration.',
      v_voluntary_modify_violators;
  END IF;

  RAISE NOTICE
    'audit-2026-05-07 HIGH-1 VALIDATE pre-flight: 0 violators. Proceeding with VALIDATE CONSTRAINT on both v2 CHECKs.';
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: VALIDATE both v2 CHECK constraints
-- --------------------------------------------------------------------------
-- VALIDATE CONSTRAINT only takes SHARE UPDATE EXCLUSIVE lock (not
-- ACCESS EXCLUSIVE), so it does not block concurrent reads or writes —
-- it only blocks DDL on the same table.
ALTER TABLE public.match_decisions
  VALIDATE CONSTRAINT match_decisions_kind_bridge_recommended_v2;

ALTER TABLE public.match_decisions
  VALIDATE CONSTRAINT match_decisions_kind_voluntary_modify_v2;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block — assert convalidated=true
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_bridge_validated BOOLEAN;
  v_voluntary_validated BOOLEAN;
BEGIN
  SELECT convalidated INTO v_bridge_validated
    FROM pg_constraint
   WHERE conrelid = 'public.match_decisions'::regclass
     AND conname = 'match_decisions_kind_bridge_recommended_v2';

  IF v_bridge_validated IS NULL OR NOT v_bridge_validated THEN
    RAISE EXCEPTION
      'audit-2026-05-07 HIGH-1 verification failed: match_decisions_kind_bridge_recommended_v2 still NOT VALID after VALIDATE CONSTRAINT';
  END IF;

  SELECT convalidated INTO v_voluntary_validated
    FROM pg_constraint
   WHERE conrelid = 'public.match_decisions'::regclass
     AND conname = 'match_decisions_kind_voluntary_modify_v2';

  IF v_voluntary_validated IS NULL OR NOT v_voluntary_validated THEN
    RAISE EXCEPTION
      'audit-2026-05-07 HIGH-1 verification failed: match_decisions_kind_voluntary_modify_v2 still NOT VALID after VALIDATE CONSTRAINT';
  END IF;
END $$;

COMMIT;
