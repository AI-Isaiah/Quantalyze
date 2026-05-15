-- Migration 035: weight_snapshots table
-- Sprint 3 Task 3.3: Weight history for Allocation Over Time widget
--
-- Why this migration exists
-- -------------------------
-- Widget #18 Allocation Over Time shows a stacked area chart of portfolio
-- weights over time — how each strategy's allocation share evolved. Today
-- there's no weight history storage: portfolio_strategies has a static
-- weight that gets overwritten on rebalance. weight_snapshots captures a
-- row every time the portfolio is updated or on a daily cadence, so the
-- widget can plot the time series.
--
-- Schema is portfolio-scoped (not strategy-scoped like position_snapshots)
-- because weights are a portfolio-level concept. RLS ties to portfolio
-- ownership directly — allocators only see weight history for their own
-- portfolios, never another allocator's.
--
-- What this migration ships
-- -------------------------
-- 1. weight_snapshots table with target_weight (user-set) and actual_weight
--    (computed from current position values or last-known state).
-- 2. Primary ordering index (portfolio_id, snapshot_date DESC).
-- 3. Partial unique index (portfolio_id, strategy_id, snapshot_date) for
--    idempotent daily writes.
-- 4. Portfolio-scoped RLS (user_id = auth.uid() on portfolios).
-- 5. Self-verifying DO block.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: weight_snapshots table
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weight_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id    UUID NOT NULL REFERENCES portfolios ON DELETE CASCADE,
  strategy_id     UUID NOT NULL REFERENCES strategies ON DELETE CASCADE,
  snapshot_date   DATE NOT NULL,
  target_weight   DECIMAL,
  actual_weight   DECIMAL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE weight_snapshots IS
  'Daily weight snapshots per (portfolio, strategy). Written on portfolio update or by worker daily. Feeds widget #18 Allocation Over Time. See migration 035.';

COMMENT ON COLUMN weight_snapshots.target_weight IS
  'User-set target weight for this strategy in this portfolio. Sum of target_weights across strategies in a portfolio should equal 1.0 (not enforced here).';

COMMENT ON COLUMN weight_snapshots.actual_weight IS
  'Realized weight after position moves and PnL. Computed from strategy NAV / portfolio NAV at snapshot time. May drift from target_weight between rebalances.';

-- --------------------------------------------------------------------------
-- STEP 2: indexes
-- --------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS weight_snapshots_portfolio_date
  ON weight_snapshots (portfolio_id, snapshot_date DESC);

-- Idempotent daily upsert target.
CREATE UNIQUE INDEX IF NOT EXISTS weight_snapshots_unique_per_day
  ON weight_snapshots (portfolio_id, strategy_id, snapshot_date);

-- --------------------------------------------------------------------------
-- STEP 3: RLS
-- --------------------------------------------------------------------------
-- Portfolio-scoped. Unlike position_snapshots (which mirrors
-- strategy_analytics' published-OR-owned pattern), weight data is private
-- to the portfolio owner. Another user can't know how an allocator weights
-- their portfolio even if all the strategies involved are published.
ALTER TABLE weight_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weight_snapshots_read ON weight_snapshots;
CREATE POLICY weight_snapshots_read ON weight_snapshots FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM portfolios p
    WHERE p.id = weight_snapshots.portfolio_id
      AND p.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS weight_snapshots_insert_deny ON weight_snapshots;
CREATE POLICY weight_snapshots_insert_deny ON weight_snapshots FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS weight_snapshots_update_deny ON weight_snapshots;
CREATE POLICY weight_snapshots_update_deny ON weight_snapshots FOR UPDATE
  USING (false);

DROP POLICY IF EXISTS weight_snapshots_delete_deny ON weight_snapshots;
CREATE POLICY weight_snapshots_delete_deny ON weight_snapshots FOR DELETE
  USING (false);

COMMENT ON POLICY weight_snapshots_read ON weight_snapshots IS
  'Portfolio owner only. Weight history is private to the allocator, never visible to other users. See migration 035.';

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_rls_enabled BOOLEAN;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'weight_snapshots'
  ) THEN
    RAISE EXCEPTION 'Migration 035 failed: weight_snapshots table missing';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'weight_snapshots_portfolio_date') THEN
    RAISE EXCEPTION 'Migration 035 failed: weight_snapshots_portfolio_date index missing';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'weight_snapshots_unique_per_day') THEN
    RAISE EXCEPTION 'Migration 035 failed: weight_snapshots_unique_per_day index missing';
  END IF;

  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'weight_snapshots'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'Migration 035 failed: RLS not enabled on weight_snapshots';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'weight_snapshots'
      AND policyname = 'weight_snapshots_read'
  ) THEN
    RAISE EXCEPTION 'Migration 035 failed: weight_snapshots_read policy missing';
  END IF;

  RAISE NOTICE 'Migration 035: weight_snapshots table + 2 indexes + RLS installed and verified.';
END
$$;

COMMIT;
