-- Additive stand-in for `portfolio_alerts`. Apply AFTER 06-fixture-portfolio-
-- strategies.sql (which supplies `portfolios`' key that the FK below points at)
-- and BEFORE the migrations under test. Never a second base.
--
-- WHY IT EXISTS. `20260416125431_rebalance_drift_check_and_trigger.sql` is the
-- migration that installs the two weight_snapshots SEED TRIGGERS — the objects
-- under test in test_weight_snapshot_seed_secdef.sql. Its STEPs 1-3 first
-- re-shape `portfolio_alerts`, a table created three migrations earlier in
-- 20260405061911_initial_schema.sql / 20260407075303_portfolio_intelligence.sql.
-- Neither of those is in the apply list: they carry the whole Phase-031 schema,
-- and 20260407075303 was MEASURED unapplicable to a vanilla cluster by plan
-- 164.4-00 (probe 1, `storage.foldername` at :219). MEASURED here 2026-09-04:
-- without this file the lane dies at
-- `20260416125431_rebalance_drift_check_and_trigger.sql:53 ERROR 42P01 relation
-- "portfolio_alerts" does not exist` — so the column set below is read off the
-- migration's own statements, not guessed:
--   * `alert_type`         — STEP 1's CHECK, and STEP 3's partial unique index
--   * `portfolio_id`       — STEP 3's index
--   * `acknowledged_at`    — STEP 3's index predicate
--   * `strategy_id`        — added by STEP 2 itself, so NOT declared here
--
-- ⚠️ STAND-IN, NOT THE SCHEMA. Nothing in the weight-snapshot gate family
-- asserts anything about `portfolio_alerts`; it is scaffold that lets STEPs 1-3
-- apply so STEP 4's trigger functions — which ARE under test — get installed.
-- The `id`/`created_at` columns are here only so the table is a plausible
-- relation, not because any assertion reads them.
CREATE TABLE IF NOT EXISTS portfolio_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id    UUID REFERENCES portfolios(id) ON DELETE CASCADE,
  alert_type      TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
