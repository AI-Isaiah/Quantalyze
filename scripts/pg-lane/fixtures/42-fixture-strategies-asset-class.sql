-- Additive stand-in for `strategies.asset_class`, which 01-fixture-core.sql deliberately omits
-- (no lane fixture declares it). Production declares it in 20260709130000_strategies_asset_class.sql
-- as `text NOT NULL DEFAULT 'traditional'` with a CHECK over ('crypto', 'traditional'), and that
-- migration is in no apply list.
--
-- Read by the real object under test from Phase 194 on: `get_verified_cohort_rank`
-- (20261107140000_get_verified_cohort_rank_span_gate.sql) decides D-15's record minimum per row from
-- `s.asset_class` (non-crypto: observations; crypto: calendar span). The function is `plpgsql`, so a
-- missing column is NOT caught at CREATE time: the function creates fine and dies at the first call
-- with `42703 column s.asset_class does not exist`, mid-gate. Every lane that applies that migration
-- (or any gate that calls the function) applies this fixture first.
--
-- STAND-IN, NOT THE SCHEMA. The type, default and CHECK are production's; nothing else about the
-- column is asserted here, and every gate that does not seed it reads the column default
-- ('traditional'). Apply AFTER 01-fixture-core.sql (it needs `public.strategies`). Never a second base.
ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS asset_class text NOT NULL DEFAULT 'traditional'
    CHECK (asset_class IN ('crypto', 'traditional'));
