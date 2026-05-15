-- Migration 042: Expand portfolio_alerts alert_type constraint + dedup index
--
-- Sprint 4 Intelligence Layer adds 3 new alert types for insight-driven alerts.
-- Also adds a partial unique index to prevent duplicate unacknowledged alerts
-- of the same type for a given portfolio.

-- Step 1: Drop the existing CHECK constraint and re-create with expanded values
ALTER TABLE portfolio_alerts DROP CONSTRAINT IF EXISTS portfolio_alerts_alert_type_check;
ALTER TABLE portfolio_alerts ADD CONSTRAINT portfolio_alerts_alert_type_check
  CHECK (alert_type IN (
    'drawdown', 'correlation_spike', 'sync_failure', 'status_change',
    'optimizer_suggestion', 'regime_shift', 'underperformance', 'concentration_creep'
  ));

-- Step 2: Deduplicate existing unacknowledged alerts before creating the unique index.
-- Keep only the most recent per (portfolio_id, alert_type) where unacknowledged.
DELETE FROM portfolio_alerts a
USING (
  SELECT DISTINCT ON (portfolio_id, alert_type) id, portfolio_id, alert_type
  FROM portfolio_alerts
  WHERE acknowledged_at IS NULL
  ORDER BY portfolio_id, alert_type, triggered_at DESC NULLS LAST
) keep
WHERE a.acknowledged_at IS NULL
  AND a.id != keep.id
  AND a.portfolio_id = keep.portfolio_id
  AND a.alert_type = keep.alert_type;

-- Step 3: Partial unique index for alert deduplication
-- Prevents inserting a second unacknowledged alert of the same type for the same portfolio.
-- Once an alert is acknowledged (acknowledged_at IS NOT NULL), it leaves the index
-- and a new alert of that type can be created.
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_alerts_dedup_unacked
  ON portfolio_alerts (portfolio_id, alert_type)
  WHERE acknowledged_at IS NULL;

-- Step 3: Self-verifying DO block
DO $$
DECLARE
  allowed_count INTEGER;
  idx_exists BOOLEAN;
BEGIN
  -- Verify the CHECK constraint accepts the new types by checking pg_constraint
  SELECT count(*) INTO allowed_count
  FROM pg_constraint
  WHERE conname = 'portfolio_alerts_alert_type_check'
    AND conrelid = 'public.portfolio_alerts'::regclass;

  IF allowed_count < 1 THEN
    RAISE EXCEPTION 'Migration 042 failed: alert_type CHECK constraint not found';
  END IF;

  -- Verify the dedup index exists
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'portfolio_alerts'
      AND indexname = 'portfolio_alerts_dedup_unacked'
  ) INTO idx_exists;

  IF NOT idx_exists THEN
    RAISE EXCEPTION 'Migration 042 failed: dedup index portfolio_alerts_dedup_unacked not found';
  END IF;
END $$;
