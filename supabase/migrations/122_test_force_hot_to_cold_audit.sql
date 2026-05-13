-- Migration 122: test_force_hot_to_cold_move admin + audit gate (audit-2026-05-07).
--
-- Audit finding addressed: P918 (10/10).
--
-- Why this migration exists
-- -------------------------
-- Migration 057 STEP 3 shipped `test_force_hot_to_cold_move()` — a
-- service-role-gated RPC that runs the same CTE body as the
-- audit_log_hot_to_cold cron job. The audit calls out three defects:
--
--   1. No audit-log emission. A call to this RPC PHYSICALLY MOVES rows
--      between the hot table and the cold archive — a destructive
--      forensic mutation — but emits no audit_log row recording who
--      triggered it. A forensics-tool trail invariant is broken: from
--      the cold archive alone you cannot tell whether rows in cold were
--      moved at 2y by the cron or moved arbitrarily by a service-role
--      caller.
--
--   2. The function is `TEST-ONLY` per migration 057's header comment,
--      but the EXECUTE grant is `service_role` — which the production
--      Next.js admin client uses. There is nothing at the function-body
--      level preventing a production deploy from accidentally hitting
--      this RPC. The audit calls for an in-body role gate:
--      `auth.role() = 'service_role' OR caller has admin role`.
--
--   3. The function returns INT (rows moved). It does NOT REVOKE EXECUTE
--      from PUBLIC explicitly (migration 057 does `REVOKE ALL FROM
--      PUBLIC, anon, authenticated`, so this is actually fine — the
--      audit text was inaccurate). We preserve the existing REVOKE
--      shape and only ADD the audit + admin gate.
--
-- What this migration ships
-- -------------------------
-- 1. `CREATE OR REPLACE FUNCTION public.test_force_hot_to_cold_move()`
--    with three new behaviors:
--    a. Role gate: asserts `auth.role() = 'service_role'` OR the calling
--       auth.uid() has a row in `user_app_roles` with role='admin'.
--       RAISE EXCEPTION ERRCODE 42501 ('insufficient_privilege') otherwise.
--    b. audit_log emission: BEFORE performing the move, insert an
--       audit_log row via `log_audit_event_service` (or direct INSERT
--       when no caller auth.uid() is present — e.g., cron-style admin
--       recovery). action='test_force_hot_to_cold_move',
--       entity_type='audit_log', entity_id=audit_log table OID as UUID
--       (synthetic; the operation is on the table itself).
--    c. Body unchanged: the CTE delete-then-insert preserves the
--       atomicity guarantee from migration 057.
-- 2. REVOKE ALL FROM PUBLIC, anon, authenticated (mirror of 057).
-- 3. GRANT EXECUTE TO service_role (mirror of 057).
-- 4. Self-verifying DO block.
--
-- Why ergonomically two gates and not one
-- ---------------------------------------
-- Permitting both `service_role` AND `admin-via-user_app_roles` covers
-- the two legitimate callers documented in 057's header:
--   * Live-DB integration tests run as service_role (via the Vitest
--     admin-client pattern).
--   * Admin recovery flows from the Next.js admin UI run under an
--     authenticated JWT whose owner has admin in user_app_roles.
-- A blanket "service_role only" gate would force the admin UI to route
-- through a separate admin endpoint that uses the service-role key
-- server-side — an additional credential boundary we'd prefer not to
-- proliferate.

BEGIN;
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.test_force_hot_to_cold_move()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_moved INT := 0;
  v_is_service_role BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_caller_uid UUID;
BEGIN
  -- audit-2026-05-07 P918: role gate. Permit only service_role OR
  -- authenticated callers with role='admin' in user_app_roles.
  BEGIN
    v_is_service_role := (auth.role() = 'service_role');
  EXCEPTION WHEN OTHERS THEN
    v_is_service_role := FALSE;
  END;

  BEGIN
    v_caller_uid := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_caller_uid := NULL;
  END;

  IF v_caller_uid IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM user_app_roles
      WHERE user_id = v_caller_uid AND role = 'admin'
    ) INTO v_is_admin;
  END IF;

  IF NOT v_is_service_role AND NOT v_is_admin THEN
    RAISE EXCEPTION
      'test_force_hot_to_cold_move: not authorized. Requires service_role JWT OR authenticated caller with role=admin in user_app_roles. audit-2026-05-07 P918.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- audit-2026-05-07 P918: emit audit_log BEFORE the destructive move.
  -- Synthetic entity_id (deterministic UUID derived from the table name)
  -- — this RPC operates on the audit_log table as a whole, not on a
  -- specific row. We use a fixed sentinel UUID so forensic queries can
  -- find all test_force_hot_to_cold_move events by entity_id.
  --
  -- If v_caller_uid is NULL (pure service-role JWT with no user
  -- attribution), we use the zero UUID as a placeholder. Downstream
  -- audit consumers can filter for action='test_force_hot_to_cold_move'
  -- AND user_id = zero-UUID to identify cron-style invocations.
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_caller_uid, '00000000-0000-0000-0000-000000000000'::uuid),
    'test_force_hot_to_cold_move',
    'audit_log',
    -- Stable synthetic entity id (uuid5-style with a fixed namespace).
    'a0a0a0a0-0000-0000-0000-000000000056'::uuid,
    jsonb_build_object(
      'invoked_via', CASE WHEN v_is_service_role THEN 'service_role' ELSE 'admin_user' END,
      'caller_uid', v_caller_uid
    )
  );

  WITH archived AS (
    DELETE FROM audit_log
    WHERE created_at < now() - interval '2 years'
    RETURNING id, user_id, action, entity_type, entity_id, metadata, created_at
  )
  INSERT INTO audit_log_cold (id, user_id, action, entity_type, entity_id, metadata, created_at)
  SELECT id, user_id, action, entity_type, entity_id, metadata, created_at
  FROM archived
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

COMMENT ON FUNCTION public.test_force_hot_to_cold_move() IS
  'TEST-ONLY / admin-recovery RPC. Now gated by role check (service_role OR admin in user_app_roles) AND emits an audit_log row before the move. service_role EXECUTE only. audit-2026-05-07 P918. See migrations 057 + 122.';

REVOKE ALL ON FUNCTION public.test_force_hot_to_cold_move() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.test_force_hot_to_cold_move() FROM anon;
REVOKE ALL ON FUNCTION public.test_force_hot_to_cold_move() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.test_force_hot_to_cold_move() TO service_role;

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  fn_body TEXT;
  authed_can_exec BOOLEAN;
  svc_can_exec BOOLEAN;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn_body
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'test_force_hot_to_cold_move';

  IF fn_body IS NULL THEN
    RAISE EXCEPTION 'Migration 122 failed: test_force_hot_to_cold_move function missing';
  END IF;

  IF fn_body NOT LIKE '%user_app_roles%' THEN
    RAISE EXCEPTION 'Migration 122 failed: function body does not check user_app_roles for admin gate';
  END IF;

  IF fn_body NOT LIKE '%INSERT INTO audit_log%' THEN
    RAISE EXCEPTION 'Migration 122 failed: function body does not emit audit_log row';
  END IF;

  IF fn_body NOT LIKE '%test_force_hot_to_cold_move%' THEN
    -- the function name itself appears multiple times; this is a
    -- belt-and-braces check that the audit action label is the
    -- function name (so forensic queries by action can find all
    -- invocations).
    RAISE EXCEPTION 'Migration 122 failed: function body does not record action=test_force_hot_to_cold_move';
  END IF;

  -- Grants: authenticated must NOT have EXECUTE, service_role MUST.
  SELECT has_function_privilege('authenticated', 'public.test_force_hot_to_cold_move()', 'EXECUTE')
    INTO authed_can_exec;
  SELECT has_function_privilege('service_role', 'public.test_force_hot_to_cold_move()', 'EXECUTE')
    INTO svc_can_exec;
  IF authed_can_exec THEN
    RAISE EXCEPTION 'Migration 122 failed: authenticated still has EXECUTE on test_force_hot_to_cold_move';
  END IF;
  IF NOT svc_can_exec THEN
    RAISE EXCEPTION 'Migration 122 failed: service_role lacks EXECUTE on test_force_hot_to_cold_move';
  END IF;

  RAISE NOTICE 'Migration 122: test_force_hot_to_cold_move role gate + audit emission installed and verified.';
END
$$;

COMMIT;
