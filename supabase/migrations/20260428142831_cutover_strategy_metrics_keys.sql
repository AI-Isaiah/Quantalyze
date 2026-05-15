-- Migration 088: cutover_strategy_metrics_keys atomic dual-write RPC
-- Phase 12 / WR-04 long-term fix (REVIEW.md):
--
-- Replaces the non-atomic two-call pattern in phase12_kill_switch.cutover_strategy
-- (sibling-table upsert + metrics_json key strip) with a single transactional
-- Postgres function. The two writes now land in one implicit transaction —
-- partial failure is impossible.
--
-- Why this matters
-- ----------------
-- The kill-switch contract is "one-way move from metrics_json to sibling table".
-- Without atomicity, a network blip or deploy-job kill between the two writes
-- could leave a strategy with the same kinds living in BOTH surfaces, causing
-- subsequent reads to double-count (sibling-fetch returns the kind + path-extract
-- from metrics_json returns the same kind). The previous mitigation
-- (rollback-on-failure guard in Python) reduced exposure but is best-effort —
-- if the rollback DELETE itself failed, double-state could still occur.
-- This RPC eliminates the failure window entirely.
--
-- Distinction from upsert_strategy_analytics_series_batch (M-Grok-1)
-- -----------------------------------------------------------------
-- Migration 087's upsert_strategy_analytics_series_batch is the analytics_runner
-- write path (computation phase): it writes to the sibling table only and
-- LEAVES metrics_json untouched (because metrics_json is rewritten in full by
-- run_strategy_analytics each cycle). That contract is correct for runner
-- writes — DO NOT extend it to also strip metrics_json keys.
--
-- This new RPC is the kill-switch cutover path (operational migration phase):
-- it does BOTH the sibling write AND the in-place metrics_json strip in one
-- transaction. Used only by phase12_kill_switch.cutover_strategy when the
-- p99.9 size threshold is exceeded.
--
-- H-B hardening
-- -------------
-- SECURITY DEFINER + SET search_path = public, pg_temp (NOT pg_catalog).
-- Mirrors migrations 086 + 087 hardening pattern; self-verifying DO block
-- asserts proconfig contains the literal 'search_path=public, pg_temp' entry.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: cutover_strategy_metrics_keys RPC
-- --------------------------------------------------------------------------
-- Atomic dual-write: insert sibling-table rows AND strip the same keys from
-- metrics_json in one transaction. The function body's implicit transaction
-- means either both writes commit together or both are rolled back together.
--
-- NOTE on metrics_json - text[]:
--   `jsonb - text[]` strips a list of top-level keys from a JSONB object.
--   ARRAY(SELECT jsonb_object_keys(p_kinds)) extracts the kind names from
--   the JSONB input {kind: payload, ...}.
CREATE OR REPLACE FUNCTION cutover_strategy_metrics_keys(
  p_strategy_id UUID,
  p_kinds       JSONB  -- {kind: payload, kind: payload, ...}
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Step 1a: atomic upsert of sibling-table rows. Same shape as
  -- upsert_strategy_analytics_series_batch but lives in a different transaction
  -- because we additionally strip metrics_json below.
  INSERT INTO strategy_analytics_series (strategy_id, kind, payload, computed_at)
  SELECT p_strategy_id, key, value, now()
    FROM jsonb_each(p_kinds)
   ON CONFLICT (strategy_id, kind) DO UPDATE
      SET payload     = EXCLUDED.payload,
          computed_at = EXCLUDED.computed_at;

  -- Step 1b: strip the just-cutover keys from metrics_json. Atomic with 1a
  -- because we're inside the same plpgsql function body (one transaction).
  -- If 1b fails, 1a rolls back automatically — no partial state possible.
  UPDATE strategy_analytics
     SET metrics_json = metrics_json - ARRAY(SELECT jsonb_object_keys(p_kinds))
   WHERE strategy_id = p_strategy_id;
END;
$$;

COMMENT ON FUNCTION cutover_strategy_metrics_keys IS
  'Phase 12 / WR-04: atomic dual-write for kill-switch cutover. Inserts heavy kinds into strategy_analytics_series AND strips them from strategy_analytics.metrics_json in one transaction. service_role only. Replaces the non-atomic two-call pattern in phase12_kill_switch.cutover_strategy. Distinct from upsert_strategy_analytics_series_batch (which is the analytics_runner write path and leaves metrics_json alone). See migration 088.';

REVOKE ALL ON FUNCTION cutover_strategy_metrics_keys FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cutover_strategy_metrics_keys TO service_role;

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
-- Asserts the RPC exists AND is hardened with H-B search_path. Mirrors the
-- pattern in 086 and 087.
DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'cutover_strategy_metrics_keys'
  ) THEN
    RAISE EXCEPTION 'Migration 088: cutover_strategy_metrics_keys RPC missing';
  END IF;

  -- H-B: assert search_path is hardened against privilege-escalation
  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'cutover_strategy_metrics_keys'
       AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ) THEN
    RAISE EXCEPTION 'Migration 088: cutover_strategy_metrics_keys missing SET search_path = public, pg_temp (H-B hardening)';
  END IF;

  RAISE NOTICE 'Migration 088: cutover_strategy_metrics_keys atomic dual-write RPC installed.';
END $$;

COMMIT;
