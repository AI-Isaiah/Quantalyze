-- Migration 047c: Extend portfolio_alerts.severity CHECK to allow 'critical'
-- Sprint 5 Task 5.2 — Critical Alert Banner
--
-- Why this migration exists
-- -------------------------
-- Migration 010 created portfolio_alerts with severity CHECK IN
-- ('high','medium','low'). Sprint 5 Task 5.1b's reconciliation worker
-- (analytics-service/services/reconciliation.py) assigns severity='critical'
-- when a report is flagged `needs_manual_review`, and the alert-routing-v1
-- contract (docs/notes/alert-routing-v1.md) designates 'critical' as the
-- banner-only tier. Without this CHECK extension those inserts fail and the
-- critical banner has no rows to render.
--
-- Numbering convention: migration 047 (main) is reserved for Sprint 5
-- Task 5.4 (atomic-split rebalance_drift CHECK swap). 047a/b/c are the
-- ack-ecosystem counterparts this sprint. 047b introduces used_ack_tokens
-- for one-time email ack tokens; this file (047c) extends the severity CHECK.
-- Both use IF NOT EXISTS / DROP-then-ADD idioms so ordering doesn't matter
-- and re-runs are no-ops.

BEGIN;

ALTER TABLE portfolio_alerts DROP CONSTRAINT IF EXISTS portfolio_alerts_severity_check;
ALTER TABLE portfolio_alerts ADD CONSTRAINT portfolio_alerts_severity_check
  CHECK (severity IN ('critical', 'high', 'medium', 'low'));

-- Self-verifying DO block
DO $$
DECLARE
  ok BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'portfolio_alerts_severity_check'
      AND conrelid = 'public.portfolio_alerts'::regclass
  ) INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION 'Migration 047c failed: severity CHECK constraint not found';
  END IF;
END $$;

COMMIT;
