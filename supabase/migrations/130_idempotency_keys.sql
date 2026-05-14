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
--   request_hash  text        -- SHA-256 of the canonicalised request body
--   response      jsonb       -- the cached success response payload
--   schema_version smallint   -- response shape version, bumped on shape change
--   created_at    timestamptz -- audit + TTL anchor (future cron)
--
-- request_hash binding (round-2-D code-review):
--   RFC draft-ietf-httpapi-idempotency-key §2.5 requires the server to
--   reject reuse of the same key with a different body (422). Without the
--   hash column the cache returns the FIRST body for any subsequent body
--   under the same key, silently masking a client bug. The route computes
--   SHA-256 over the canonical-JSON of the parsed (and post-normalised)
--   diffs and stores it here; lookups compare hashes and 422 on mismatch.
--
-- schema_version (round-2-D type-design review):
--   A cached jsonb row written by an older route revision must not be
--   returned by a newer route that has changed the response shape. The
--   route validates `response` against a zod schema before returning it,
--   AND treats a schema_version other than the current constant as a
--   cache miss (fresh RPC + overwrite). Default 1 = the current shape
--   { recorded:number; results:RpcRecordedRow[]; errors:[] }.
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
--
-- Idempotency note (round-2-D red-team CRITICAL):
--   The CREATE TABLE + ADD COLUMN IF NOT EXISTS structure below is
--   defensively idempotent. Any environment that applied an earlier
--   revision of this same file (one without `request_hash` /
--   `schema_version`) will get the missing columns added by the ALTER
--   TABLE statements below — `CREATE TABLE IF NOT EXISTS` alone would
--   skip the new columns when the table already exists.

BEGIN;
SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS scenario_commit_idempotency (
  allocator_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 128),
  request_hash    text NOT NULL CHECK (length(request_hash) = 64),
  response        jsonb NOT NULL,
  schema_version  smallint NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (allocator_id, idempotency_key)
);

-- Defensive idempotent backfill for environments that applied a prior
-- revision of this migration without these columns. `ADD COLUMN IF NOT
-- EXISTS` is a no-op on a fresh CREATE; on an existing table it adds the
-- column. The NOT NULL is enforced after backfill (sentinel-zero hash +
-- schema_version=0 sentinel) so the constraint isn't violated on existing
-- rows. Round-2-D red-team CRITICAL.
ALTER TABLE scenario_commit_idempotency
  ADD COLUMN IF NOT EXISTS request_hash text;
ALTER TABLE scenario_commit_idempotency
  ADD COLUMN IF NOT EXISTS schema_version smallint;

UPDATE scenario_commit_idempotency
  SET request_hash = repeat('0', 64)
  WHERE request_hash IS NULL;
UPDATE scenario_commit_idempotency
  SET schema_version = 0
  WHERE schema_version IS NULL;

ALTER TABLE scenario_commit_idempotency
  ALTER COLUMN request_hash SET NOT NULL;
ALTER TABLE scenario_commit_idempotency
  ALTER COLUMN schema_version SET NOT NULL;
ALTER TABLE scenario_commit_idempotency
  ALTER COLUMN schema_version SET DEFAULT 1;

-- request_hash length CHECK as an ADD CONSTRAINT IF NOT EXISTS-equivalent.
-- Postgres lacks `ADD CONSTRAINT IF NOT EXISTS`; we drop-then-add inside a
-- DO block guarded by pg_constraint introspection so re-running this
-- migration on a previously-applied state is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scenario_commit_idem_request_hash_len_chk'
  ) THEN
    ALTER TABLE scenario_commit_idempotency
      ADD CONSTRAINT scenario_commit_idem_request_hash_len_chk
      CHECK (length(request_hash) = 64);
  END IF;
END $$;

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
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'scenario_commit_idempotency'
      AND column_name = 'request_hash'
  ) THEN
    RAISE EXCEPTION 'Migration 130: scenario_commit_idempotency.request_hash column missing (RFC 7234-style body-binding for Idempotency-Key)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'scenario_commit_idempotency'
      AND column_name = 'schema_version'
  ) THEN
    RAISE EXCEPTION 'Migration 130: scenario_commit_idempotency.schema_version column missing';
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
