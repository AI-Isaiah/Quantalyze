-- Migration 050: rebalance_drift alert type + portfolio_alerts.strategy_id +
-- portfolios/portfolio_strategies triggers that seed NULL weight_snapshots rows.
--
-- Sprint 5 Task 5.4 — Rebalance-to-Target Alerts
--
-- Why this migration exists
-- -------------------------
-- Sprint 5 Task 5.4 fires a `rebalance_drift` alert when a strategy's current
-- weight diverges > 5% from its target. Two-layer safety against alert storms:
--   1. Honeymoon: suppress for the first 7 days after portfolio creation.
--   2. Null-target guard: suppress when target_weight is null (user hasn't set
--      targets yet — we must not interpret "not yet set" as "target = 0").
-- Plus weekly dedup enforced by the concurrent partial unique index created
-- in migration 051.
--
-- Numbering deviation
-- -------------------
-- The original Sprint 5 plan called this migration 047a. Migrations 047b/047c
-- (ack tokens, critical severity) have already shipped and consumed those
-- numbers. 050/051 are the next free slots. This migration is split in two:
-- 050 (transactional: CHECK/column/trigger/index for portfolio_alerts dedup
-- carve-out) and 051 (non-transactional: CREATE INDEX CONCURRENTLY).
--
-- What this migration does
-- ------------------------
-- 1. Extend portfolio_alerts_alert_type_check to include 'rebalance_drift'.
-- 2. Add nullable portfolio_alerts.strategy_id (FK → strategies, ON DELETE
--    SET NULL) so rebalance_drift rows can pin the source strategy. Other
--    alert types leave it NULL.
-- 3. Recreate the 042 dedup index excluding rebalance_drift. The weekly
--    per-strategy unique index lives in migration 051 and supersedes the
--    per-portfolio+type dedup for this alert type only.
-- 4. Add triggers on portfolios (AFTER INSERT) and portfolio_strategies
--    (AFTER INSERT) that seed rows into weight_snapshots with
--    target_weight=NULL, actual_weight=NULL. NULL is EXPLICIT — it means
--    "user has not yet set a target", which is the null-target guard's
--    entire purpose. Idempotent via ON CONFLICT on the existing
--    weight_snapshots_unique_per_day index (migration 035).
-- 5. Self-verifying DO block.
--
-- Lock-holding notes
-- ------------------
-- `SET lock_timeout = '3s'` bounds the ADD COLUMN / DROP CONSTRAINT /
-- CREATE TRIGGER statements. portfolio_alerts is small, so AccessExclusive
-- locks should release within a few ms; the cap is a safety rail only.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: extend alert_type CHECK to add 'rebalance_drift'
-- --------------------------------------------------------------------------
ALTER TABLE portfolio_alerts DROP CONSTRAINT IF EXISTS portfolio_alerts_alert_type_check;
ALTER TABLE portfolio_alerts ADD CONSTRAINT portfolio_alerts_alert_type_check
  CHECK (alert_type IN (
    'drawdown', 'correlation_spike', 'sync_failure', 'status_change',
    'optimizer_suggestion', 'regime_shift', 'underperformance',
    'concentration_creep', 'rebalance_drift'
  ));

-- --------------------------------------------------------------------------
-- STEP 2: add nullable strategy_id column
-- --------------------------------------------------------------------------
-- Nullable because only rebalance_drift (and future per-strategy alerts)
-- carry this. Other rows stay NULL. ON DELETE SET NULL so removing the
-- strategy doesn't cascade-delete the historical alert record.
ALTER TABLE portfolio_alerts
  ADD COLUMN IF NOT EXISTS strategy_id UUID REFERENCES strategies(id) ON DELETE SET NULL;

COMMENT ON COLUMN portfolio_alerts.strategy_id IS
  'Pinned source strategy for per-strategy alert types (rebalance_drift). NULL for portfolio-wide alerts. See migration 050.';

-- --------------------------------------------------------------------------
-- STEP 3: recreate the existing 042 dedup index excluding rebalance_drift
-- --------------------------------------------------------------------------
-- The 042 partial unique index on (portfolio_id, alert_type) WHERE
-- acknowledged_at IS NULL prevents multiple unacked alerts of the same type
-- per portfolio. For rebalance_drift we want a WEEKLY refire window (the
-- alert should re-fire next week if drift persists), so we carve it out
-- here and let migration 051's weekly index take over.
--
-- DROP and recreate is cheap: portfolio_alerts is small (thousands of rows
-- at most) and the index already existed, so no app code path breaks.
DROP INDEX IF EXISTS portfolio_alerts_dedup_unacked;
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_alerts_dedup_unacked
  ON portfolio_alerts (portfolio_id, alert_type)
  WHERE acknowledged_at IS NULL
    AND alert_type <> 'rebalance_drift';

-- --------------------------------------------------------------------------
-- STEP 4: triggers that seed weight_snapshots with NULL target/actual
-- --------------------------------------------------------------------------
-- Two triggers because portfolio_strategies rows are typically inserted
-- AFTER the parent portfolio row (wizard flow). A portfolio-only trigger
-- would fire on an empty link table and miss every strategy.
--
-- Both triggers insert with target_weight=NULL, actual_weight=NULL. The
-- rebalance_drift logic treats NULL target as "skip" — this is the
-- null-target guard's ground truth. A later call (/api/portfolios/<id>
-- PATCH, the weight editor, the nightly worker) overwrites with a real
-- value on its normal schedule.
--
-- Idempotent via ON CONFLICT against weight_snapshots_unique_per_day
-- (migration 035: UNIQUE (portfolio_id, strategy_id, snapshot_date)). If a
-- row for today already exists, the trigger silently no-ops.
CREATE OR REPLACE FUNCTION seed_weight_snapshot_for_portfolio_strategy()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO weight_snapshots (
    portfolio_id, strategy_id, snapshot_date, target_weight, actual_weight
  )
  VALUES (
    NEW.portfolio_id, NEW.strategy_id, CURRENT_DATE, NULL, NULL
  )
  ON CONFLICT (portfolio_id, strategy_id, snapshot_date) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS portfolio_strategies_seed_weight_snapshot_trigger ON portfolio_strategies;
CREATE TRIGGER portfolio_strategies_seed_weight_snapshot_trigger
  AFTER INSERT ON portfolio_strategies
  FOR EACH ROW
  EXECUTE FUNCTION seed_weight_snapshot_for_portfolio_strategy();

-- portfolio-level trigger: fans out over every child row at the moment
-- the portfolio is inserted. Usually this is a no-op (portfolio_strategies
-- rows haven't been inserted yet), but it gives us correctness on the
-- unusual path where a bulk INSERT INTO portfolios ... with existing links
-- happens (e.g., a seed script, a migration, a restore). The per-child
-- trigger above handles the common wizard flow.
CREATE OR REPLACE FUNCTION seed_weight_snapshots_for_portfolio()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO weight_snapshots (
    portfolio_id, strategy_id, snapshot_date, target_weight, actual_weight
  )
  SELECT NEW.id, ps.strategy_id, CURRENT_DATE, NULL, NULL
  FROM portfolio_strategies ps
  WHERE ps.portfolio_id = NEW.id
  ON CONFLICT (portfolio_id, strategy_id, snapshot_date) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS portfolios_seed_weight_snapshots_trigger ON portfolios;
CREATE TRIGGER portfolios_seed_weight_snapshots_trigger
  AFTER INSERT ON portfolios
  FOR EACH ROW
  EXECUTE FUNCTION seed_weight_snapshots_for_portfolio();

-- --------------------------------------------------------------------------
-- STEP 5: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  has_rebalance_drift BOOLEAN;
  has_strategy_id_col BOOLEAN;
  has_ps_trigger BOOLEAN;
  has_portfolio_trigger BOOLEAN;
  has_dedup_idx BOOLEAN;
BEGIN
  -- 1. CHECK includes rebalance_drift
  SELECT pg_get_constraintdef(oid) LIKE '%rebalance_drift%'
    INTO has_rebalance_drift
    FROM pg_constraint
    WHERE conname = 'portfolio_alerts_alert_type_check'
      AND conrelid = 'public.portfolio_alerts'::regclass;
  IF NOT COALESCE(has_rebalance_drift, FALSE) THEN
    RAISE EXCEPTION 'Migration 050 failed: portfolio_alerts_alert_type_check does not include rebalance_drift';
  END IF;

  -- 2. strategy_id column exists
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'portfolio_alerts'
      AND column_name = 'strategy_id'
  ) INTO has_strategy_id_col;
  IF NOT has_strategy_id_col THEN
    RAISE EXCEPTION 'Migration 050 failed: portfolio_alerts.strategy_id column missing';
  END IF;

  -- 3. portfolio_strategies trigger installed
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'portfolio_strategies_seed_weight_snapshot_trigger'
      AND tgrelid = 'public.portfolio_strategies'::regclass
  ) INTO has_ps_trigger;
  IF NOT has_ps_trigger THEN
    RAISE EXCEPTION 'Migration 050 failed: portfolio_strategies_seed_weight_snapshot_trigger missing';
  END IF;

  -- 4. portfolios trigger installed
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'portfolios_seed_weight_snapshots_trigger'
      AND tgrelid = 'public.portfolios'::regclass
  ) INTO has_portfolio_trigger;
  IF NOT has_portfolio_trigger THEN
    RAISE EXCEPTION 'Migration 050 failed: portfolios_seed_weight_snapshots_trigger missing';
  END IF;

  -- 5. dedup index rebuilt with rebalance_drift carve-out
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'portfolio_alerts'
      AND indexname = 'portfolio_alerts_dedup_unacked'
      AND indexdef ILIKE '%rebalance_drift%'
  ) INTO has_dedup_idx;
  IF NOT has_dedup_idx THEN
    RAISE EXCEPTION 'Migration 050 failed: portfolio_alerts_dedup_unacked does not carve out rebalance_drift';
  END IF;

  RAISE NOTICE 'Migration 050: rebalance_drift CHECK + strategy_id + triggers + dedup carve-out installed.';
END
$$;

COMMIT;
