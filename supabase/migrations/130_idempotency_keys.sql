-- Migration 130: scenario_commit_idempotency dedup table.
--
-- audit-2026-05-07 round-2 Block D / P1945 dep.
--
-- The /api/allocator/scenario/commit route must accept an
-- Idempotency-Key request header per RFC draft-ietf-httpapi-idempotency-key.
-- Without server-side dedup, a retried request (network blip, mobile
-- background-tab kill, browser-history navigation) would replay the
-- `commit_scenario_batch` RPC, double-recording match_decisions and
-- bridge_outcomes despite the route's "single-tx" contract.
--
-- This migration adds a small per-allocator dedup row that the route
-- writes after a successful commit and re-reads on each subsequent
-- request bearing the same Idempotency-Key. Schema:
--
--   (allocator_id, idempotency_key) PRIMARY KEY
--   response   jsonb       -- the cached success response payload
--   created_at timestamptz -- audit + TTL anchor (future cron)
--
-- RLS model:
--   - SELECT policy `scenario_commit_idem_self` lets an allocator read
--     their OWN dedup rows. This is defense-in-depth — the route always
--     queries via the service-role admin client (see route.ts comment),
--     but a future migration that re-routes the read through the
--     user-scoped client must not silently leak rows across tenants.
--   - INSERT / UPDATE / DELETE: no policies are defined. By design,
--     RLS-enabled tables with no policies for a verb are CLOSED to
--     non-service-role callers (this is the secure-by-default Postgres
--     RLS contract). Writes go through the service-role admin client
--     in the route handler, which bypasses RLS unconditionally.
--
-- Key-length CHECK:
--   16..128 chars matches the RFC's "client-generated, opaque, hard-to-
--   guess" guidance. Below 16 chars an Idempotency-Key is too easy to
--   collide; above 128 the key starts to look like an attempt to stash
--   payload into a header (which would also defeat row-locality for the
--   PK B-tree).
--
-- Self-verifying DO block at the bottom — fails the migration loudly if
-- the table or RLS policy is missing after CREATE TABLE / CREATE POLICY.

BEGIN;
SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS scenario_commit_idempotency (
  allocator_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 128),
  response        jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (allocator_id, idempotency_key)
);

COMMENT ON TABLE scenario_commit_idempotency IS
  'Per-allocator Idempotency-Key dedup cache for POST /api/allocator/scenario/commit. Row inserted after a successful commit; lookups short-circuit retries with the cached response. See migration 130 + audit-2026-05-07 round-2 Block D.';

ALTER TABLE scenario_commit_idempotency ENABLE ROW LEVEL SECURITY;

CREATE POLICY scenario_commit_idem_self ON scenario_commit_idempotency
  FOR SELECT USING (allocator_id = auth.uid());

COMMENT ON POLICY scenario_commit_idem_self ON scenario_commit_idempotency IS
  'Defense-in-depth: an allocator can SELECT only their own dedup rows. The route uses the service-role admin client (bypasses RLS) for both the SELECT lookup and the post-commit INSERT; this policy guards a future re-route through the user-scoped client.';

-- Writes via service-role only (route handler uses admin client for upsert).
-- No INSERT/UPDATE/DELETE policies for authenticated users by design.

-- --------------------------------------------------------------------------
-- Self-verifying DO block — fails loudly if the table or policy is missing.
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'scenario_commit_idempotency'
  ) THEN
    RAISE EXCEPTION 'Migration 130: scenario_commit_idempotency table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'scenario_commit_idempotency'
      AND policyname = 'scenario_commit_idem_self'
  ) THEN
    RAISE EXCEPTION 'Migration 130: RLS policy scenario_commit_idem_self missing';
  END IF;

  RAISE NOTICE 'Migration 130: scenario_commit_idempotency installed';
END $$;

COMMIT;
