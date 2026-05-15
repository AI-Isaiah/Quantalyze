-- Migration 052: key_permission_audit — append-only log of live permission probes.
--
-- Sprint 5 Task 5.8 — Live Key Permission Viewer.
--
-- Why this migration exists
-- -------------------------
-- The new POST /internal/keys/{key_id}/permissions endpoint hits exchange APIs
-- on demand to surface live {read, trade, withdraw} scopes for an api_keys row.
-- Each call decrypts a stored credential and reaches out to the exchange, so
-- we want a per-call audit row in case a stolen-key scenario triggers an
-- investigation later: who hit which key, when, from what caller IP.
--
-- The endpoint itself is VPC-gated by an X-Internal-Token shared secret (v1
-- — Sprint 7 will add network-level VPC restrictions). The audit row is the
-- forensic complement to the auth check: it lets us reconstruct usage if
-- the secret ever leaks.
--
-- Schema is intentionally minimal. We don't store the {read, trade, withdraw}
-- result here because it's an op-tooling table, not a cache: cache lives in
-- process memory inside the Python service (services/key_permissions.py).
--
-- RLS: enabled, no policies → service-role writes only. There is no
-- user-facing read of this table in v1; an admin export is a Sprint 6+ ask.
--
-- Cascade: an api_keys row deletion drops its audit history. Keys are deleted
-- when a user removes them; we don't need orphan audit rows pointing at gone
-- keys (and the FK + cascade simplifies cleanup if a user nukes their account).
--
-- Idempotent (IF NOT EXISTS) so re-running the migration is a no-op.

BEGIN;

CREATE TABLE IF NOT EXISTS key_permission_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  caller_ip TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index supports the two main query shapes ops will use:
--   1. "Show me the last N probes for this key" → range scan on (key_id, time DESC)
--   2. "How many probes for this key in the last hour?" → bounded scan on same
CREATE INDEX IF NOT EXISTS idx_key_permission_audit_key_time
  ON key_permission_audit (api_key_id, requested_at DESC);

ALTER TABLE key_permission_audit ENABLE ROW LEVEL SECURITY;

-- No policies. Service role (createAdminClient / SUPABASE_SERVICE_KEY)
-- bypasses RLS for both inserts and reads. User-facing reads are blocked
-- by default — explicit policy needed to expose later.

-- Self-verifying DO block. Mirrors the pattern used in 047b/050/051: the
-- migration runner checks both presence AND validity so a partial run
-- can't pass silently.
DO $$
DECLARE
  tbl_exists BOOLEAN;
  idx_exists BOOLEAN;
  rls_enabled BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'key_permission_audit'
  ) INTO tbl_exists;
  IF NOT tbl_exists THEN
    RAISE EXCEPTION 'Migration 052 failed: key_permission_audit table not created';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'key_permission_audit'
      AND indexname = 'idx_key_permission_audit_key_time'
  ) INTO idx_exists;
  IF NOT idx_exists THEN
    RAISE EXCEPTION 'Migration 052 failed: idx_key_permission_audit_key_time not created';
  END IF;

  SELECT relrowsecurity FROM pg_class
  WHERE relname = 'key_permission_audit' AND relnamespace = 'public'::regnamespace
  INTO rls_enabled;
  IF NOT rls_enabled THEN
    RAISE EXCEPTION 'Migration 052 failed: RLS not enabled on key_permission_audit';
  END IF;

  RAISE NOTICE 'Migration 052: key_permission_audit table installed.';
END
$$;

COMMIT;
