-- Migration 058: `log_audit_event_service` RPC — service-role-only, caller-supplied user_id.
--
-- Sprint 6 closeout Task 7.1b — cross-service audit emission path.
--
-- Numbering lineage
-- -----------------
-- Sprint 6 closeout used slots 049 (audit hardening — Task 7.1a),
-- 054 (user_app_roles — Task 7.2), 055 (sanitize_user — Task 7.3),
-- 056 (retention_crons — Task 7.3), 057 (relax organizations.created_by).
-- Task 7.1b takes slot 058 — the next free slot after Task 7.3's
-- comprehensive fix (commit 6ff7592). See ADR-0023 §8 for the decision
-- record; option A1 (extend RPC signature, restrict via REVOKE) chosen
-- over A2 (direct service-role INSERT into audit_log) because the RPC
-- path retains centralized validation (non-null user_id, action, etc.)
-- which makes a drifted caller impossible to hide.
--
-- Why a sibling RPC and not an overload of log_audit_event
-- --------------------------------------------------------
-- Migration 049's `log_audit_event(text, text, uuid, jsonb)` derives
-- user_id from `auth.uid()` and REFUSES to run when auth.uid() is NULL.
-- The Python analytics-service (Task 7.1b's cross-service emission
-- target) runs with service_role credentials and therefore has NULL
-- auth.uid() — the existing RPC would raise `insufficient_privilege`
-- on every call.
--
-- Rather than widen the existing RPC (which would re-open the spoofing
-- question for every authenticated caller), we ship a second RPC with
-- a different grant pattern:
--
--   * `log_audit_event(text, text, uuid, jsonb)` — user-scope, keeps
--     `auth.uid()` derivation. Callable by `authenticated` + `service_role`.
--     Attribution-spoof-proof at the DB layer.
--
--   * `log_audit_event_service(uuid, text, text, uuid, jsonb)` — caller
--     supplies user_id. REVOKED from authenticated so the spoof surface
--     is gated at the grant level: only a service-role JWT (admin client
--     from Next.js, or supabase-py with service_role key from Python)
--     can reach it. Defense-in-depth: an `authenticated` JWT that
--     somehow ended up with the right role name still cannot call it
--     because the EXECUTE grant is service_role-only.
--
-- This is the exact pattern ADR-0023 §8 option A1 specifies, and mirrors
-- the service-role-only pattern used by `defer_compute_job` (migration
-- 033) elsewhere in the codebase.
--
-- Call shape
-- ----------
--   SELECT public.log_audit_event_service(
--     p_user_id     := '<acting user uuid>',
--     p_action      := 'bridge.score_candidates',
--     p_entity_type := 'bridge_run',
--     p_entity_id   := '<strategies.id or portfolios.id>',
--     p_metadata    := '{"candidate_count": 5}'::JSONB
--   );
--
-- Validation
-- ----------
-- 1. All five parameters must be non-NULL (matches migration 049's guards
--    for action/entity_type/entity_id). Empty strings for action or
--    entity_type also raise `invalid_parameter_value`.
-- 2. Writes the same row as log_audit_event but with the caller-supplied
--    user_id, so downstream consumers (audit_log_owner_read policy, the
--    2y hot→cold migrator) don't need to branch on emission source.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: log_audit_event_service RPC
-- --------------------------------------------------------------------------
-- SECURITY DEFINER so the function runs as its owner (postgres) and
-- bypasses the audit_log_service_insert WITH CHECK clause the same way
-- log_audit_event does. search_path is pinned per the project's
-- SECURITY DEFINER convention (migrations 020, 021, 028, 033, 049, 050,
-- 053, 055).
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
BEGIN
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

  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
  VALUES (p_user_id, p_action, p_entity_type, p_entity_id, p_metadata)
  RETURNING id INTO v_row_id;

  RETURN v_row_id;
END;
$$;

COMMENT ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) IS
  'Service-role-only audit event emitter. Caller supplies user_id (this RPC does NOT derive it from auth.uid()). Used by cross-service emitters (Python analytics-service) and email-ack paths where no JWT is on the wire. SECURITY DEFINER; REVOKED from authenticated so only service_role can call it. See migration 058 and ADR-0023 §8 (option A1).';

-- Lock down EXECUTE: service_role only. REVOKE everything first for a
-- clean slate, then GRANT only to service_role. `authenticated` is
-- explicitly excluded — a compromised user JWT cannot spoof attribution
-- via this RPC because the EXECUTE grant itself blocks it.
REVOKE ALL ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event_service(UUID, TEXT, TEXT, UUID, JSONB) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
-- Mirrors migration 049's pattern: assert the function exists with the
-- right security attributes AND that the grant pattern is locked down.
-- This is the load-bearing part of this migration — if `authenticated`
-- can call this RPC, the cross-service attribution-spoof gate fails.
DO $$
DECLARE
  has_fn                 BOOLEAN;
  authed_can_execute     BOOLEAN;
  anon_can_execute       BOOLEAN;
  service_can_execute    BOOLEAN;
BEGIN
  -- 1. Function exists, is SECURITY DEFINER, has the right signature
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'log_audit_event_service'
      AND p.prosecdef = TRUE
      AND pg_get_function_arguments(p.oid) ILIKE '%uuid%text%text%uuid%jsonb%'
  ) INTO has_fn;
  IF NOT has_fn THEN
    RAISE EXCEPTION 'Migration 058 failed: log_audit_event_service(uuid, text, text, uuid, jsonb) SECURITY DEFINER function missing';
  END IF;

  -- 2. Grant pattern — authenticated + anon MUST NOT have EXECUTE. This
  -- is the load-bearing invariant. If authenticated can call this RPC,
  -- a user JWT can spoof attribution by passing any user_id.
  SELECT has_function_privilege(
    'authenticated',
    'public.log_audit_event_service(uuid, text, text, uuid, jsonb)',
    'EXECUTE'
  ) INTO authed_can_execute;
  IF authed_can_execute THEN
    RAISE EXCEPTION 'Migration 058 failed: authenticated role has EXECUTE on log_audit_event_service — attribution-spoof gate is broken';
  END IF;

  SELECT has_function_privilege(
    'anon',
    'public.log_audit_event_service(uuid, text, text, uuid, jsonb)',
    'EXECUTE'
  ) INTO anon_can_execute;
  IF anon_can_execute THEN
    RAISE EXCEPTION 'Migration 058 failed: anon role has EXECUTE on log_audit_event_service — attribution-spoof gate is broken';
  END IF;

  -- 3. service_role MUST have EXECUTE (the positive case — without it,
  -- the Python cross-service emission is DOA).
  SELECT has_function_privilege(
    'service_role',
    'public.log_audit_event_service(uuid, text, text, uuid, jsonb)',
    'EXECUTE'
  ) INTO service_can_execute;
  IF NOT service_can_execute THEN
    RAISE EXCEPTION 'Migration 058 failed: service_role does not have EXECUTE on log_audit_event_service — cross-service emission will DOA';
  END IF;

  RAISE NOTICE 'Migration 058: log_audit_event_service RPC installed; authenticated+anon denied EXECUTE, service_role granted.';
END
$$;

COMMIT;
