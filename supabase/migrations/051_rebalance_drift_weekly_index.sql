-- Migration 051: partial unique index for weekly rebalance_drift dedup.
--
-- NON-TRANSACTIONAL. CREATE INDEX CONCURRENTLY cannot run inside a
-- BEGIN/COMMIT block (Postgres rejects it with ERROR 25001). Every other
-- migration in this repo is wrapped transactionally; this file is the
-- single exception. Do NOT add BEGIN/COMMIT around the CREATE INDEX.
--
-- Sprint 5 Task 5.4 — Rebalance-to-Target Alerts (Part 2 of 2).
--
-- Why this migration exists
-- -------------------------
-- Migration 050 added the rebalance_drift alert type and a nullable
-- portfolio_alerts.strategy_id column, and carved rebalance_drift OUT of
-- the existing 042 (portfolio_id, alert_type) dedup index because that
-- index would block weekly refires. This migration installs the
-- replacement: a partial unique index on
-- (portfolio_id, strategy_id, alert_type, ISO-week-of-triggered_at) for
-- unacked rebalance_drift rows only.
--
-- Note on timestamp column: portfolio_alerts uses `triggered_at` (migration
-- 010) as the alert event time. We bucket by the UTC ISO week boundary so
-- an alert that fired late Sunday still dedups against a refire on
-- Monday morning in the same week window.
--
-- The net effect for rebalance_drift:
--   - At most one unacked alert per (portfolio, strategy) per UTC week.
--   - Once acked, the row leaves the index and next week's drift can
--     re-fire.
--   - Different strategies in the same portfolio can each hold their own
--     unacked alert simultaneously (the per-strategy dimension).
--
-- CONCURRENTLY avoids an AccessExclusive lock on portfolio_alerts while
-- the index builds, which matters because the alert insert hot path runs
-- off the nightly analytics cron and we don't want to stall that cron
-- during the deploy window.
--
-- Lock-holding note
-- -----------------
-- `SET lock_timeout` still fires per statement here even without an
-- enclosing transaction. CONCURRENTLY takes a ShareUpdateExclusive lock,
-- which co-exists with normal reads/writes, so the 3-second cap is a
-- safety rail against an unexpected AutoVacuum worker or a concurrent
-- DDL operation on the same table.

SET lock_timeout = '3s';

-- Index expression notes
-- -----------------------
-- The 3-arg `date_trunc(text, timestamptz, text)` form (Postgres 14+) is
-- declared IMMUTABLE when the TZ arg is a literal, so it's safe to index.
-- The equivalent 2-arg form `date_trunc('week', ts AT TIME ZONE 'UTC')`
-- calls `timezone(text, timestamptz)` which is STABLE, and Postgres
-- rejects that in a UNIQUE INDEX expression. Supabase ships Postgres 15,
-- so the 3-arg form is always available.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS portfolio_alerts_rebalance_drift_weekly
  ON portfolio_alerts (
    portfolio_id,
    strategy_id,
    alert_type,
    (date_trunc('week', triggered_at, 'UTC'))
  )
  WHERE acknowledged_at IS NULL
    AND alert_type = 'rebalance_drift';

-- Self-verifying DO block runs as its own implicit transaction outside
-- the CONCURRENTLY statement, which is fine — no DDL inside.
DO $$
DECLARE
  idx_valid BOOLEAN;
BEGIN
  -- pg_index.indisvalid is FALSE if a concurrent build was interrupted
  -- mid-flight. We check both presence AND validity.
  SELECT EXISTS(
    SELECT 1
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE c.relname = 'portfolio_alerts_rebalance_drift_weekly'
      AND i.indisvalid
  ) INTO idx_valid;

  IF NOT idx_valid THEN
    RAISE EXCEPTION 'Migration 051 failed: portfolio_alerts_rebalance_drift_weekly missing or invalid';
  END IF;

  RAISE NOTICE 'Migration 051: weekly rebalance_drift dedup index installed.';
END
$$;
