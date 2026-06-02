-- B9 (Boundary Validation Parity) — extend strategy_analytics.computation_status
-- CHECK to admit 'complete_with_warnings'. 2026-06-02.
--
-- Why this migration exists
-- -------------------------
-- The analytics worker UPSERTs strategy_analytics.computation_status =
-- 'complete_with_warnings' whenever a computation SUCCEEDS but used a
-- consumer-specific fallback (used_heuristic_capital / balance_error):
--   - analytics-service/services/analytics_runner.py:1765-1786 — the SINGLE
--     strategy_analytics upsert: computation_status_value =
--     "complete_with_warnings" if consumer_specific_flags else "complete"
--   - analytics-service/services/job_worker.py:1775
--   - analytics-service/services/exchange.py:2299 (heuristic-capital fallback)
-- and the frontend read-gates were deliberately hardened (B3, v0.24.9.34) to
-- ADMIT 'complete_with_warnings' (factsheet pdf/tearsheet gates, strategy page),
-- and the TS row type (src/lib/types.ts StrategyAnalytics.computation_status)
-- lists it. BUT the column CHECK was never widened to match: it was still the
-- initial-schema set IN ('pending','computing','complete','failed') — verified
-- live in prod 2026-06-02 (strategy_analytics_computation_status_check =
-- computation_status = ANY (ARRAY['pending','computing','complete','failed'])).
--
-- Result: a LATENT prod bug — the first strategy whose computation hits the
-- heuristic-capital fallback would have its ENTIRE metrics upsert rejected with
-- SQLSTATE 23514 (check constraint violation), because that single upsert also
-- carries all metrics_json. Latent only because no current prod strategy has
-- hit that path yet (10 'complete', 31 'failed', 0 'complete_with_warnings').
-- This is the exact NEW-C40-01 / #399 boundary-parity class B9 closes: a
-- producer value the DB CHECK rejects.
--
-- Fix: widen the CHECK to the intended 5-value set. Widening is SAFE — every
-- existing row is already in the subset, so no row can violate the new
-- constraint. 'stale' remains REJECTED (it was never a valid computation_status;
-- it was the illegal value the cron tried to write pre-#399). The TS
-- single-source-of-truth is src/lib/closed-sets.ts
-- STRATEGY_ANALYTICS_COMPUTATION_STATUSES, pinned against this CHECK by
-- src/__tests__/contracts/check-zod-db-check-parity.test.ts.
--
-- DROP-then-ADD idiom (re-runnable no-op; ordering-independent).

BEGIN;

ALTER TABLE strategy_analytics
  DROP CONSTRAINT IF EXISTS strategy_analytics_computation_status_check;
ALTER TABLE strategy_analytics
  ADD CONSTRAINT strategy_analytics_computation_status_check
  CHECK (computation_status IN ('pending', 'computing', 'complete', 'complete_with_warnings', 'failed'));

-- Self-verifying DO block: assert the new constraint exists, ADMITS
-- 'complete_with_warnings', and still REJECTS 'stale'.
DO $$
DECLARE
  def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conname = 'strategy_analytics_computation_status_check'
    AND conrelid = 'public.strategy_analytics'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'B9 migration failed: strategy_analytics_computation_status_check not found';
  END IF;
  IF position('complete_with_warnings' IN def) = 0 THEN
    RAISE EXCEPTION 'B9 migration failed: CHECK does not admit complete_with_warnings (def=%)', def;
  END IF;
  IF position('stale' IN def) <> 0 THEN
    RAISE EXCEPTION 'B9 migration failed: CHECK must NOT admit stale (def=%)', def;
  END IF;
END $$;

COMMIT;
