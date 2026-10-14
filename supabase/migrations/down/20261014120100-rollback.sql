-- ============================================================================
-- ROLLBACK for 20261014120100_log_audit_event_deny_worker_only_actions.sql
-- Phase 167.1.2.1 RECONMARKER, plan 01, decision D-18.
-- ============================================================================
-- Restores public.log_audit_event(text,text,uuid,jsonb) to 20260526095850's body
-- and COMMENT, copied VERBATIM from that file (never from memory), and re-issues
-- the ACL pair of 20260416201929. After this runs a signed-in user can again
-- write any audit action, including allocator.equity.reconstruct_complete, which
-- re-opens own-key forgery of the reconstruct marker's backfill evidence.
-- Manual, off the auto-apply path. The migration ledger row is left in place; to
-- re-apply, delete it in the same change.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

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

REVOKE ALL ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) TO service_role;

DO $verify$
DECLARE
  v_oid  oid := to_regprocedure('public.log_audit_event(text,text,uuid,jsonb)');
  v_body text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261014120100 failed: log_audit_event is missing';
  END IF;
  v_body := regexp_replace(regexp_replace(pg_get_functiondef(v_oid), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_body IS NULL OR v_body ~ 'auth\.role\(\)' OR v_body ~ 'allocator\.equity\.' THEN
    RAISE EXCEPTION 'Rollback 20261014120100 failed: the restored body is unreadable or still carries the D-18 deny branch';
  END IF;
  PERFORM public._assert_no_public_execute('public.log_audit_event(text,text,uuid,jsonb)');
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261014120100 failed: the log_audit_event ACL did not converge';
  END IF;
  RAISE NOTICE 'Rollback 20261014120100: 20260526095850''s log_audit_event body restored.';
END
$verify$;

COMMIT;
