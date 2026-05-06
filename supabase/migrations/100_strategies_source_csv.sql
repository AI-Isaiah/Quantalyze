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
-- Regression coverage: src/__tests__/migrations-strategies-source-csv.test.ts
-- (Vitest) asserts a real INSERT INTO strategies (..., source='csv', ...) on the
-- live test project Supabase instance succeeds without violating the constraint.

BEGIN;

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

COMMIT;

COMMENT ON CONSTRAINT strategies_source_check ON strategies IS
  'Phase 18 / FIX-03 (2026-05-06): admits ''csv'' so Phase 15 finalize_csv_strategy RPC (migration 093) succeeds. Also pre-admits {okx,binance,bybit} for Phase 19 BACKBONE-04 forward-compat — mirrors the strategy_verifications.source forward-compat pattern. Original constraint only admitted {legacy,wizard,admin_import,allocator_connected}.';
