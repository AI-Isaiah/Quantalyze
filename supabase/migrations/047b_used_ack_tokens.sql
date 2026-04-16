-- Migration 047b: used_ack_tokens — one-time-use record for email ack tokens
-- Sprint 5 Task 5.2 — Email digest ack-from-email + HMAC one-time-use tokens.
--
-- Why this migration exists
-- -------------------------
-- The alert digest email (src/lib/email.ts::sendAlertDigest) now carries a
-- per-alert "Acknowledge" link that redirects to /api/alerts/ack?id=X&t=<token>.
-- The token is a signed HMAC-SHA256 over (alertId + exp) with TTL 48h. HMAC
-- alone prevents forgery but does NOT prevent replay: a forwarded/logged
-- URL could be re-submitted any number of times inside the 48h window.
--
-- To make ack one-time-use, each successful POST hashes the token (sha256
-- hex) and inserts the hash into this table BEFORE mutating the alert.
-- Subsequent submissions of the same token hit the PK constraint and are
-- treated as 'already-acked'.
--
-- Numbering convention: main 047 is reserved for Sprint 5 Task 5.4 (atomic
-- rebalance_drift CHECK swap). 047b/c are the ack-ecosystem split —
-- ordering between 047b and 047c doesn't matter because both use idempotent
-- IF NOT EXISTS guards.
--
-- What this migration does
-- ------------------------
-- 1. CREATE TABLE used_ack_tokens with PK (token_hash). Deleting the alert
--    cascades and drops stale hashes so the weekly cleanup cron can focus
--    on 30-day retention instead of orphan pruning.
-- 2. Index used_at so the weekly cleanup cron
--    (src/app/api/cron/cleanup-ack-tokens/route.ts) can range-scan.
-- 3. RLS: enable, with NO policies — service-role writes only (the ack
--    route calls createAdminClient). No public reads.

BEGIN;

CREATE TABLE IF NOT EXISTS used_ack_tokens (
  token_hash TEXT PRIMARY KEY,
  alert_id UUID NOT NULL REFERENCES portfolio_alerts(id) ON DELETE CASCADE,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_used_ack_tokens_used_at
  ON used_ack_tokens(used_at);

ALTER TABLE used_ack_tokens ENABLE ROW LEVEL SECURITY;

-- No public policies. Service role (createAdminClient) bypasses RLS.

-- Self-verifying DO block
DO $$
DECLARE
  tbl_exists BOOLEAN;
  idx_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'used_ack_tokens'
  ) INTO tbl_exists;
  IF NOT tbl_exists THEN
    RAISE EXCEPTION 'Migration 047b failed: used_ack_tokens table not created';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'used_ack_tokens'
      AND indexname = 'idx_used_ack_tokens_used_at'
  ) INTO idx_exists;
  IF NOT idx_exists THEN
    RAISE EXCEPTION 'Migration 047b failed: idx_used_ack_tokens_used_at not created';
  END IF;
END $$;

COMMIT;
