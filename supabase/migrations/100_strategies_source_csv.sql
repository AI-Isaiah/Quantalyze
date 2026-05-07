-- Migration 100 — extend strategies.source check constraint to admit 'csv'.
--
-- Surfaced 2026-05-06 during Phase 18 founder UAT (FIX-03 onboarding teams via CSV path).
-- Migration 093 added the `finalize_csv_strategy` RPC which inserts INTO strategies
-- VALUES (..., source='csv', ...). The pre-existing `strategies_source_check`
-- constraint (created by an earlier migration before Phase 15) only admitted
-- {'legacy','wizard','admin_import','allocator_connected'} — the Phase 15 PR
-- shipped the RPC but did NOT extend the constraint.
--
-- Symptom: every CSV-path strategy submission returns HTTP 500 from
-- /api/strategies/csv-finalize with Postgres error
-- "new row for relation \"strategies\" violates check constraint \"strategies_source_check\"".
-- Zero CSV strategies have ever been ingested in production. Phase 15 shipped a
-- broken CSV path; this migration unblocks all 10 founder LP onboarding teams
-- on the CSV side.
--
-- The fix is a single ALTER TABLE that drops and re-adds the CHECK with the
-- additional 'csv' value. No data backfill required (no rows currently use 'csv'
-- because the broken constraint blocked them all). The new constraint also pre-
-- admits 'okx', 'binance', 'bybit' as a Phase 19 BACKBONE follow-on hint —
-- mirroring the same forward-compat pattern strategy_verifications.source uses
-- in migration 093 (lines 91 + 161-162). Phase 19 BACKBONE-04 VIEW-shim sequence
-- will not need to ALTER this constraint again.
--
-- Regression coverage: src/__tests__/strategies-source-csv-constraint.test.ts
-- (Vitest) asserts a real INSERT INTO strategies (..., source='csv', ...) on the
-- live test project Supabase instance succeeds without violating the constraint.
--
-- Forward-only / no down migration: this constraint expansion is a one-way
-- door. Re-narrowing the CHECK list once any row exists with source IN
-- ('csv','okx','binance','bybit') would fail the new constraint validation
-- (every existing CSV/broker row would need to be deleted or migrated first).
-- If a rollback is ever needed: (1) delete or update strategies rows with
-- source IN ('csv','okx','binance','bybit'), (2) DROP + ADD the legacy
-- 4-value CHECK manually. There is no DOWN.sql shim — the recovery path is
-- intentionally not automated to force operator intent.

BEGIN;

-- Bound the apply-time blast radius if the strategies table is locked or the
-- full-table CHECK validation scan is slow. Mirrors migration 093 line 66.
SET lock_timeout = '3s';

ALTER TABLE strategies
  DROP CONSTRAINT IF EXISTS strategies_source_check;

ALTER TABLE strategies
  ADD CONSTRAINT strategies_source_check
  CHECK (source IN (
    'legacy',
    'wizard',
    'admin_import',
    'allocator_connected',
    'csv',
    'okx',
    'binance',
    'bybit'
  ));

-- Self-verify: assert the new constraint actually admits the Phase 18 / FIX-03
-- target value. Mirrors the assert pattern in migrations 031 + 093. RAISE
-- EXCEPTION on missing — silent no-op apply (e.g. concurrent migration race)
-- would otherwise reintroduce the symptom this migration claims to fix.
DO $$
DECLARE
  constraint_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
  INTO constraint_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'strategies'
    AND c.conname = 'strategies_source_check';

  IF constraint_def IS NULL THEN
    RAISE EXCEPTION 'migration 100 self-verify failed: strategies_source_check constraint missing after apply';
  END IF;

  IF constraint_def NOT LIKE '%csv%' THEN
    RAISE EXCEPTION 'migration 100 self-verify failed: strategies_source_check does not admit ''csv'' (definition: %)', constraint_def;
  END IF;
END $$;

COMMIT;

COMMENT ON CONSTRAINT strategies_source_check ON strategies IS
  'Phase 18 / FIX-03 (2026-05-06): admits ''csv'' so Phase 15 finalize_csv_strategy RPC (migration 093) succeeds. Also pre-admits {okx,binance,bybit} for Phase 19 BACKBONE-04 forward-compat — mirrors the strategy_verifications.source forward-compat pattern. Original constraint only admitted {legacy,wizard,admin_import,allocator_connected}.';
