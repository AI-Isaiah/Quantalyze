-- audit-2026-05-07 (NEW-C18-02) — drop the stale [0.1, 50] inline percent CHECK
-- on bridge_outcomes.percent_allocated so the column matches the canonical
-- [0, 100] range used by every other layer.
--
-- LIVE BUG (confidence 10, verified against prod khslejtfbuezsmvmtsdn
-- 2026-05-28). `bridge_outcomes.percent_allocated` carries TWO column CHECKs:
--
--   bridge_outcomes_percent_allocated_check       CHECK (pct >= 0.1 AND pct <= 50)
--       -- installed inline by mig 20260418060747 (table create), NEVER dropped
--   bridge_outcomes_percent_allocated_range_check CHECK (pct >= 0   AND pct <= 100)
--       -- added by mig 20260514045553 as "defense in depth", WIDER on purpose,
--          with an explicit comment that it should "survive a FUTURE migration
--          that drops the inline check" (future tense — that drop never landed).
--
-- Postgres ANDs the two CHECKs, so the EFFECTIVE persistable range is the
-- intersection [0.1, 50]. Meanwhile the whole application stack canonicalises
-- on [0, 100]:
--   * route Zod  : src/app/api/allocator/scenario/commit/route.ts  z.number().min(0).max(100)
--   * drawer     : ScenarioCommitDrawer.tsx  input min=0 max=100, allFilled accepts 0..100
--   * validator  : _validate_scenario_diff  [0, 100]  (mig 20260528183000)
--   * range_check: [0, 100]
--
-- Result: an ordinary allocation (0%, 60%, 75%, 100%) passes client + server
-- validation, then raises 23514 on INSERT inside commit_scenario_batch, whose
-- single-transaction RPC rolls back the ENTIRE batch with an opaque per-row
-- error. mig 20260528183000 (B9) reconciled the dead _validate_scenario_diff
-- helper but did NOT touch the real column constraint — this migration closes
-- the actual gap.
--
-- Fix: pick ONE canonical range = [0, 100] (already the convention everywhere
-- else) by dropping the stale tighter inline check. The surviving
-- bridge_outcomes_percent_allocated_range_check [0, 100] remains the single
-- source of truth.
--
-- Data safety: every existing row satisfies [0.1, 50] which is a strict subset
-- of the surviving [0, 100], so no row can violate the remaining constraint —
-- the change only WIDENS what is persistable. Idempotent (DROP ... IF EXISTS)
-- and guarded for DR re-apply. Auto-applies to PROD on merge to main
-- (supabase-migrate auto-on-push) — verify both constraints' final state via
-- Supabase MCP after the run (only range_check should remain).

SET LOCAL search_path = public, pg_catalog;

-- Brief catalog-only ACCESS EXCLUSIVE lock; bound it so a long-running txn on
-- bridge_outcomes cannot stall the migration indefinitely.
SET LOCAL lock_timeout = '10s';

-- --------------------------------------------------------------------------
-- STEP 1: drop the stale inline [0.1, 50] check (idempotent).
-- --------------------------------------------------------------------------

ALTER TABLE public.bridge_outcomes
  DROP CONSTRAINT IF EXISTS bridge_outcomes_percent_allocated_check;

-- --------------------------------------------------------------------------
-- STEP 2: verification — assert the final constraint state.
--   The stale check must be gone; the canonical [0, 100] range_check must
--   remain and be validated. (Value-level persistability of 0/60/100 is
--   pinned by the route parity test + a post-apply MCP probe; we do not
--   INSERT probe rows into the FK-heavy bridge_outcomes table inside a
--   prod-auto-applying migration.)
-- --------------------------------------------------------------------------

DO $verify$
DECLARE
  v_inline_exists  boolean;
  v_range_ok       boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bridge_outcomes'::regclass
      AND conname  = 'bridge_outcomes_percent_allocated_check'
  ) INTO v_inline_exists;

  IF v_inline_exists THEN
    RAISE EXCEPTION
      'NEW-C18-02 verification failed: stale bridge_outcomes_percent_allocated_check still present';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.bridge_outcomes'::regclass
      AND conname  = 'bridge_outcomes_percent_allocated_range_check'
      AND convalidated
  ) INTO v_range_ok;

  IF NOT v_range_ok THEN
    RAISE EXCEPTION
      'NEW-C18-02 verification failed: canonical [0,100] range_check missing or not validated';
  END IF;
END;
$verify$;
