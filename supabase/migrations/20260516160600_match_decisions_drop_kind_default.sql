-- audit-2026-05-07 mitigation
-- Closes: H-0960 (silent-failure-hunter c8)
-- Source file: supabase/migrations/20260426131718_match_decisions_kind_enum.sql (was 080)
-- Issue: migration 080 STEP 5 set DEFAULT 'bridge_recommended' on
--   match_decisions.kind for back-compat with pre-Phase-10 INSERTs.
--   The DEFAULT is also active for Phase-10 code paths — a future
--   voluntary_X writer that forgets to pass `kind` will silently land
--   as bridge_recommended, then either trip a CHECK violation
--   (if shape doesn't match) or silently mis-categorize (if shape
--   happens to satisfy bridge_recommended).
-- Mitigation: backfill is COMPLETE (mig 080 STEP 4 ran successfully on
--   apply, plus mig 080 STEP 9 assertion (a) confirms no NULL kind
--   remained). Drop the DEFAULT so every INSERT MUST specify `kind`
--   explicitly. NOT NULL on the column (mig 080 STEP 5) ensures the
--   missing-DEFAULT-plus-missing-INSERT-value path raises 23502
--   loudly instead of silently inheriting 'bridge_recommended'.
--
-- Pre-flight: confirm zero NULL kind rows. If any exist (shouldn't,
-- per mig 080 STEP 9 assertion (a)), the migration aborts so an
-- operator can investigate before tightening.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: pre-flight — assert no NULL kind rows
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_null_count INTEGER;
  v_has_default BOOLEAN;
BEGIN
  SELECT COUNT(*) INTO v_null_count FROM match_decisions WHERE kind IS NULL;

  IF v_null_count > 0 THEN
    RAISE EXCEPTION
      'audit-2026-05-07 H-0960: cannot drop DEFAULT — % rows have NULL kind. mig 080 backfill should have closed this. Investigate before re-applying.',
      v_null_count
      USING ERRCODE = 'data_exception';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'match_decisions'
       AND column_name = 'kind'
       AND column_default IS NOT NULL
  ) INTO v_has_default;

  IF NOT v_has_default THEN
    RAISE NOTICE 'audit-2026-05-07 H-0960: match_decisions.kind already has no DEFAULT — no-op.';
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: drop the DEFAULT
-- --------------------------------------------------------------------------
-- ALTER ... DROP DEFAULT is idempotent on a column with no default. The
-- NOT NULL constraint set by mig 080 STEP 5 is preserved.
ALTER TABLE public.match_decisions
  ALTER COLUMN kind DROP DEFAULT;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_has_default BOOLEAN;
  v_is_not_null BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'match_decisions'
       AND column_name = 'kind'
       AND column_default IS NOT NULL
  ) INTO v_has_default;

  IF v_has_default THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0960 verification failed: match_decisions.kind still has a DEFAULT';
  END IF;

  -- Confirm NOT NULL is preserved (mig 080 STEP 5 invariant)
  SELECT (is_nullable = 'NO') INTO v_is_not_null
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'match_decisions'
     AND column_name = 'kind';

  IF NOT v_is_not_null THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0960 verification failed: match_decisions.kind lost NOT NULL constraint. mig 080 STEP 5 contract violated.';
  END IF;
END $$;

COMMIT;
</content>
</invoke>
