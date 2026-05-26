-- Migration: audit-2026-05-26 NEW-C10-04
-- ==========================================================================
-- Context
-- -------
-- `log_audit_event` (migration 049) raises SQLSTATE 42501
-- ('insufficient_privilege') when auth.uid() IS NULL. The TS classifier in
-- `src/lib/audit.ts` maps 42501 → permission_denied (fatal: Sentry capture
-- tagged `audit_permission_denied=true`, row dropped, re-throw).
--
-- The 42501 fatal alarm was designed to catch one specific catastrophe:
-- EXECUTE-grant drift on the `log_audit_event` function (the P701/P702
-- threat). But migration 049's NULL-auth guard ALSO raises 42501 — and an
-- expired JWT in the deferred `after()` window is an EVERYDAY occurrence
-- (the JWT may lapse between response-flush and the post-flush RPC settle).
--
-- Result: every session-expiry-in-after() emits a FATAL Sentry event tagged
-- `audit_permission_denied=true`, training operators to ignore the exact tag
-- meant to scream on real EXECUTE-grant drift. Signal/noise collapsed.
--
-- Fix
-- ---
-- Change the NULL-auth guard's ERRCODE from `insufficient_privilege` (42501)
-- to `invalid_authorization_specification` (28000). This is the same SQLSTATE
-- used by the sibling RPCs `update_allocator_mandates` (migration 062) and
-- `validate_scenario_diff_numeric_cast_hardening` for their own NULL-auth
-- guards — consistent with the codebase convention.
--
-- The TS classifier (NEW-C10-04 companion) then maps 28000 → unauthenticated
-- (non-fatal: console.warn + Sentry warning, NOT fatal, no `audit_permission_
-- denied=true` tag). The 42501 path is now exclusively the EXECUTE-grant-drift
-- signal — the catastrophic case — so the Sentry alert rule regains its
-- intended precision.
--
-- NOTE: the `audit_log.user_id` column is still NOT NULL (migration 049
-- hardened it); NULL auth.uid() is still rejected by the function. Only
-- the SQLSTATE changes — the guard's semantics are identical.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.log_audit_event(
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
  v_user_id UUID;
  v_row_id  UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    -- NEW-C10-04: changed from ERRCODE 'insufficient_privilege' (42501) to
    -- 'invalid_authorization_specification' (28000). 42501 is reserved for
    -- the fatal EXECUTE-grant-drift signal; 28000 is the standard code for
    -- "caller is not authenticated", matching the sibling RPCs' convention.
    RAISE EXCEPTION 'log_audit_event: auth.uid() is NULL — caller must be authenticated'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF p_action IS NULL OR length(p_action) = 0 THEN
    RAISE EXCEPTION 'log_audit_event: p_action is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_entity_type IS NULL OR length(p_entity_type) = 0 THEN
    RAISE EXCEPTION 'log_audit_event: p_entity_type is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'log_audit_event: p_entity_id is required (audit_log.entity_id is NOT NULL)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, p_action, p_entity_type, p_entity_id, p_metadata)
  RETURNING id INTO v_row_id;

  RETURN v_row_id;
END;
$$;

COMMENT ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) IS
  'Fire-and-forget audit event emitter. SECURITY DEFINER; derives user_id from auth.uid() so the caller cannot spoof attribution. Raises SQLSTATE 28000 if unauthenticated (auth.uid() IS NULL), SQLSTATE 42501 if EXECUTE-grant drifted. See migrations 049 + NEW-C10-04 and ADR-0023.';

-- Verification: confirm the function body now raises 28000, not 42501, on
-- NULL auth. We cannot invoke it in a NULL-auth context from a migration DO
-- block (we would need to unset the JWT GUC, which is impractical here), so
-- we assert the source contains the new ERRCODE text as a smoke-test.
DO $$
DECLARE
  v_prosrc TEXT;
BEGIN
  SELECT prosrc INTO v_prosrc
  FROM pg_proc
  WHERE proname = 'log_audit_event'
    AND pronargs = 4;

  IF v_prosrc IS NULL THEN
    RAISE EXCEPTION 'Migration NEW-C10-04 failed: log_audit_event(text,text,uuid,jsonb) not found';
  END IF;

  IF v_prosrc NOT LIKE '%invalid_authorization_specification%' THEN
    RAISE EXCEPTION 'Migration NEW-C10-04 failed: log_audit_event body does not contain invalid_authorization_specification (28000). Body: %', left(v_prosrc, 200);
  END IF;

  -- Ensure the old 42501 guard is gone from the NULL-auth branch.
  -- The function may reference 42501 in comments; we check the RAISE EXCEPTION
  -- + ERRCODE = 'insufficient_privilege' pair specifically.
  IF v_prosrc LIKE '%ERRCODE = ''insufficient_privilege''%' THEN
    RAISE EXCEPTION 'Migration NEW-C10-04 failed: log_audit_event body still contains ERRCODE insufficient_privilege (42501). Did the CREATE OR REPLACE succeed?';
  END IF;

  RAISE NOTICE 'Migration NEW-C10-04: log_audit_event NULL-auth guard now raises 28000 (invalid_authorization_specification) instead of 42501 — verified.';
END;
$$;
