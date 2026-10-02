-- Additive stand-in for `strategy_analytics.computation_error`, which
-- 03-fixture-compute-jobs.sql deliberately omits: that fixture carries only the
-- four columns the ledger-refresh staleness view reads (:42-48). Production
-- declares it in 20260405061911_initial_schema.sql:75 as a bare `TEXT`, and that
-- migration is in no apply list.
--
-- Read AND WRITTEN by the real object under test in
-- `test_sync_status_marked_refresh_protected.sql` — branch (b-prime) of
-- `sync_strategy_analytics_status`, whose whole CR-01 claim is that a protected
-- marked refresh records a CURATED sentence here while writing no
-- computation_status. Without the column the gate dies at
-- `42703 column "computation_error" of relation "strategy_analytics" does not
-- exist` before assertion 0a runs (MEASURED 2026-09-04).
--
-- ⚠️ STAND-IN, NOT THE SCHEMA. The type is production's, and nothing else about
-- the column is asserted structurally; the bridge function that fills it comes
-- from the real migrations 20260825150000 + 20260826120000. Apply AFTER
-- 03-fixture-compute-jobs.sql. Never a second base.
ALTER TABLE public.strategy_analytics
  ADD COLUMN IF NOT EXISTS computation_error TEXT;
