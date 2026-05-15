-- Migration 123: log_audit_event_service hardening (audit-2026-05-07).
--
-- Audit findings addressed: P919 (9/10), P920 (8/10).
--
-- Why this migration exists
-- -------------------------
-- Migration 058 ships `log_audit_event_service(uuid, text, text, uuid,
-- jsonb)` — the cross-service audit emitter used by the Python
-- analytics-service and by Next.js email-ack paths where no JWT is on
-- the wire. The audit identified two defects:
--
-- P919 (9/10) — Three concerns combined:
--   (a) `audit_log.user_id` has NO foreign key to `auth.users(id)`. A
--   future test (or a misbehaving worker) could insert an audit row
--   citing a UUID that does not belong to any user; the audit row would
--   then "haunt" the forensic queries with no resolvable subject.
--   Confirmed via migration 010 line 67-75: `audit_log` declares
--   `user_id UUID NOT NULL` but does not add `REFERENCES auth.users(id)`.
--
--   Fix: ADD CONSTRAINT audit_log_user_id_fkey FOREIGN KEY (user_id)
--   REFERENCES auth.users(id) ON DELETE SET NULL. Use SET NULL (not
--   CASCADE) because deleting an audit row when the subject is purged
--   would destroy the forensic record GDPR Art. 17 EXPLICITLY allows us
--   to preserve under anonymize-not-delete (see migration 055's matrix).
--   SET NULL preserves the row with user_id=NULL; the anonymized
--   profiles row references migration 055 sentinels for the
--   already-sanitized case. But ALSO: ALTER user_id to NULLABLE first
--   so SET NULL is valid.
--
--   (b) The RPC has no role gate. Migration 058 already locks down
--   EXECUTE at the grant layer (REVOKE FROM authenticated/anon, GRANT
--   to service_role only). But defense-in-depth calls for an in-body
--   check that `auth.role() IN ('authenticated','service_role')` so a
--   future grant-leak (a regression that re-grants EXECUTE to
--   authenticated) still fails closed. The migration-058 path is fine
--   under current grants; we add the in-body check as belt-and-braces.
--
--   (c) The Python portfolio.py path bypasses any per-caller role
--   check by invoking the RPC as service_role. This is intentional —
--   the cross-service emission pattern is the WHOLE POINT of having
--   this RPC distinct from log_audit_event (see ADR-0023 §8 / migration
--   058 header). We document it as a known limitation: the in-body
--   role gate added in this migration treats service_role as authorized,
--   so portfolio.py continues to work; an authenticated JWT (which would
--   be rejected at the grant layer anyway) also passes the in-body
--   check. The in-body check fails CLOSED only for `anon` JWTs and any
--   future "machine" role not in the allow list.
--
-- P920 (8/10) — Unbounded JSONB payload. The RPC accepts arbitrary
--   jsonb in p_metadata and inserts it directly. A pathological caller
--   (or a bug in analytics-service that loops over an unbounded result
--   set and appends to a metadata array) could insert a metadata blob
--   of arbitrary size, blowing audit_log row sizes past PostgreSQL's
--   row limit (~1.6KB at the page level, with TOAST kicking in for
--   larger fields). Even within TOAST limits, an oversized metadata
--   blob:
--     * inflates storage costs unboundedly
--     * makes audit_log queries slow (TOAST detoasts every row read)
--     * defeats the retention cron's per-row delete cost assumptions
--
--   Fix: enforce `octet_length(p_metadata::text) <= 32768` (32 KB
--   ceiling). RAISE EXCEPTION ERRCODE 22023 ('invalid_parameter_value')
--   on overflow. 32 KB is a generous ceiling — typical audit metadata
--   is sub-1 KB (subject id + action + a few flags), but the bridge
--   scoring path emits candidate arrays that can reach a few KB.
--   32 KB leaves comfortable headroom while still capping the storage
--   blast radius.
--
-- What this migration ships
-- -------------------------
-- 1. ALTER audit_log.user_id DROP NOT NULL (precondition for SET NULL FK).
-- 2. ADD FK constraint audit_log_user_id_fkey ON DELETE SET NULL.
-- 3. CREATE OR REPLACE log_audit_event_service with:
--    a. In-body role gate: auth.role() IN ('authenticated','service_role').
--    b. 32 KB metadata ceiling on octet_length(p_metadata::text).
--    c. All existing validations from migration 058 preserved.
-- 4. Self-verifying DO block.
--
-- Caller impact
-- -------------
-- The FK addition is the only schema change. It is a metadata-only
-- catalog edit on tables we own (no row rewrite, no scan past
-- catalog), but Postgres DOES validate every existing row against the
-- new constraint at ALTER time. If any audit_log row references a
-- user_id that does not exist in auth.users (orphan audit), the ALTER
-- raises. We treat that as a pre-condition: a separate one-off
-- migration would be required to NULL the orphan user_ids first. The
-- audit text indicates no orphans are expected in production today.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: relax audit_log.user_id to nullable (precondition for SET NULL FK)
-- --------------------------------------------------------------------------
-- The original schema (migration 010 line 69) declares user_id NOT NULL.
-- ON DELETE SET NULL requires the column to permit NULL, otherwise the
-- cascade would itself raise not_null_violation. Drop the NOT NULL.
-- Existing rows are unaffected (none are NULL today).
ALTER TABLE audit_log ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN audit_log.user_id IS
  'Subject of the audit event. Nullable since migration 123 — the audit_log_user_id_fkey FK uses ON DELETE SET NULL so audit rows survive auth.users hard-delete with the subject attribution preserved as NULL. See migrations 010 + 123.';

-- --------------------------------------------------------------------------
-- STEP 2: add FK constraint with ON DELETE SET NULL
-- --------------------------------------------------------------------------
-- Idempotent via DROP IF EXISTS (handles re-apply). The FK validates
-- every existing row; if any row has a user_id not in auth.users, the
-- ALTER raises and the whole migration rolls back. A pre-migration
-- consistency check is the operator's responsibility.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_user_id_fkey;
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- --------------------------------------------------------------------------
-- STEP 3: log_audit_event_service hardening
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_audit_event_service(
  p_user_id     UUID,
  p_action      TEXT,
  p_entity_type TEXT,
  p_entity_id   UUID,
  p_metadata    JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_row_id UUID;
  v_role TEXT;
  v_metadata_size INT;
BEGIN
  -- audit-2026-05-07 P919: in-body role gate (defense-in-depth on top
  -- of the grant-layer REVOKE). auth.role() returns the JWT's role
  -- claim; we accept service_role and authenticated (the two intended
  -- callers). anon, dashboard_user, and any future custom roles are
  -- rejected.
  BEGIN
    v_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;

  IF v_role IS NULL OR v_role NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION
      'log_audit_event_service: auth.role() must be authenticated or service_role (got %). audit-2026-05-07 P919.', v_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'log_audit_event_service: p_user_id is required (this RPC does not derive user_id from auth.uid())'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_action IS NULL OR length(p_action) = 0 THEN
    RAISE EXCEPTION 'log_audit_event_service: p_action is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_entity_type IS NULL OR length(p_entity_type) = 0 THEN
    RAISE EXCEPTION 'log_audit_event_service: p_entity_type is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'log_audit_event_service: p_entity_id is required (audit_log.entity_id is NOT NULL)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- audit-2026-05-07 P920: 32 KB ceiling on the metadata JSONB. We
  -- measure octet_length of the text representation — a fine proxy
  -- for the storage footprint (TOAST will compress, but the
  -- pre-compression ceiling is what we care about for caller
  -- correctness). NULL metadata is fine (octet_length on NULL returns
  -- NULL; the comparison short-circuits).
  IF p_metadata IS NOT NULL THEN
    v_metadata_size := octet_length(p_metadata::text);
    IF v_metadata_size > 32768 THEN
      RAISE EXCEPTION
        'log_audit_event_service: p_metadata exceeds 32 KB ceiling (octet_length=% bytes, max=32768). audit-2026-05-07 P920.', v_metadata_size
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
  VALUES (p_user_id, p_action, p_entity_type, p_entity_id, p_metadata)
  RETURNING id INTO v_row_id;

  RETURN v_row_id;
END;
$$;

COMMENT ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) IS
  'Service-role-only audit emitter. Hardened in migration 123: (a) in-body role gate (authenticated OR service_role), (b) 32 KB JSONB metadata ceiling, (c) audit_log.user_id now has FK to auth.users(id) ON DELETE SET NULL. portfolio.py continues to call this as service_role (intentional cross-service bypass — see migration 058 + ADR-0023 §8). audit-2026-05-07 P919, P920.';

-- Re-assert grant pattern (defensive — migration 058 already did this,
-- but re-applying makes the migration self-contained).
REVOKE ALL ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  user_id_is_nullable TEXT;
  fk_action CHAR(1);
  fk_ref_table TEXT;
  fn_body TEXT;
BEGIN
  -- 1. audit_log.user_id is nullable
  SELECT is_nullable INTO user_id_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'audit_log'
    AND column_name = 'user_id';
  IF user_id_is_nullable IS NULL THEN
    RAISE EXCEPTION 'Migration 123 failed: audit_log.user_id column not found';
  END IF;
  IF user_id_is_nullable <> 'YES' THEN
    RAISE EXCEPTION 'Migration 123 failed: audit_log.user_id is still NOT NULL (is_nullable=%)', user_id_is_nullable;
  END IF;

  -- 2. audit_log_user_id_fkey constraint exists, points to auth.users, ON DELETE SET NULL
  SELECT confdeltype,
         (SELECT relname FROM pg_class WHERE oid = confrelid)
    INTO fk_action, fk_ref_table
  FROM pg_constraint
  WHERE conname = 'audit_log_user_id_fkey'
    AND conrelid = 'public.audit_log'::regclass;

  IF fk_action IS NULL THEN
    RAISE EXCEPTION 'Migration 123 failed: audit_log_user_id_fkey constraint not found';
  END IF;
  IF fk_action <> 'n' THEN
    RAISE EXCEPTION
      'Migration 123 failed: audit_log_user_id_fkey must be ON DELETE SET NULL (confdeltype=n), got %', fk_action;
  END IF;
  IF fk_ref_table <> 'users' THEN
    RAISE EXCEPTION
      'Migration 123 failed: audit_log_user_id_fkey must reference auth.users, got %', fk_ref_table;
  END IF;

  -- 3. log_audit_event_service body contains both new gates
  SELECT pg_get_functiondef(p.oid) INTO fn_body
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'log_audit_event_service';

  IF fn_body IS NULL THEN
    RAISE EXCEPTION 'Migration 123 failed: log_audit_event_service function not found';
  END IF;
  IF fn_body NOT LIKE '%auth.role()%' THEN
    RAISE EXCEPTION 'Migration 123 failed: log_audit_event_service body lacks auth.role() role gate';
  END IF;
  IF fn_body NOT LIKE '%32768%' THEN
    RAISE EXCEPTION 'Migration 123 failed: log_audit_event_service body lacks 32 KB metadata ceiling';
  END IF;

  RAISE NOTICE 'Migration 123: audit_log FK + log_audit_event_service hardening installed and verified.';
END
$$;

COMMIT;
