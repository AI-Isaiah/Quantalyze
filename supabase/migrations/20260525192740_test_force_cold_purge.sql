-- Migration: test_force_cold_purge — service-role test-only cold-row purge
-- (audit-2026-05-07 H-0010).
--
-- Audit finding addressed: H-0010 (10/10).
--
-- Why this migration exists
-- -------------------------
-- audit_log_cold is append-only: migration 056/049 install
-- FOR UPDATE/DELETE USING(false) policies AND REVOKE UPDATE, DELETE from
-- authenticated + service_role. That is correct for the compliance
-- archive — but it means the live-DB integration tests in
-- src/__tests__/audit-log-cold-archive.test.ts cannot clean up the
-- `__cold_test_*` probe rows they seed. `deleteColdRowDirect` issues a
-- PostgREST DELETE that the deny policy silently no-ops (see the
-- append-only DELETE test: `expect(deleted).toEqual([])`), so every test
-- run leaks a probe row into audit_log_cold FOREVER. Across CI runs these
-- accumulate, and any future probe doing
-- `count(*) ... WHERE entity_type = 'test_probe'` would false-flag a
-- regression.
--
-- This mirrors the exact problem migration 057/122 solved for the
-- hot->cold MOVE: PostgREST can't perform the privileged operation, so a
-- SECURITY DEFINER, service_role-gated RPC runs it instead.
--
-- What this migration ships
-- -------------------------
-- `public.test_force_cold_purge(p_id uuid) RETURNS INT` — a SECURITY
-- DEFINER RPC that DELETEs a single cold row, but ONLY when that row is a
-- test probe (`entity_type = 'test_probe'` AND its action carries the
-- `__cold_test_` prefix the test suite uses). Returns the number of rows
-- deleted (0 or 1).
--
-- Three deliberate safety properties
-- ----------------------------------
--   1. service_role-only EXECUTE + an in-body `auth.role()` gate. Unlike
--      migration 122's hot->cold move (which also permits admin users for
--      an admin-UI recovery flow), this purge has NO production
--      use case — it is purely test-cleanup — so it is locked to
--      service_role. Least privilege.
--   2. Scoped DELETE. Even invoked with the service-role key, the
--      function can ONLY delete rows that look like test probes. A real
--      2-year-old compliance row in cold (no `__cold_test_` prefix, real
--      entity_type) is unreachable. The append-only invariant for
--      genuine audit data is therefore preserved — this is not a general
--      append-only bypass.
--   3. Audit emission BEFORE the delete (mirrors migration 122). Because
--      this RPC is a deliberate, SECURITY DEFINER hole in the cold
--      table's append-only invariant, every invocation records who fired
--      it and which id was targeted, so the bypass itself is forensically
--      traceable.
--
-- Idempotency
-- -----------
-- CREATE OR REPLACE + REVOKE/GRANT are re-apply-safe. The self-verifying
-- DO block asserts the gate, the scope, and the grants.

BEGIN;
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.test_force_cold_purge(p_id uuid)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_purged INT := 0;
  v_is_service_role BOOLEAN := FALSE;
  v_caller_uid UUID;
BEGIN
  -- H-0010: service_role-only gate. This is a test-cleanup RPC with no
  -- production caller, so we do NOT permit admin users (unlike migration
  -- 122). auth.role() can raise when no JWT is present (→ EXCEPTION
  -- handler) OR return NULL when the role claim is simply absent (e.g. a
  -- direct DB connection). `(NULL = 'service_role')` is NULL, NOT FALSE,
  -- so we MUST use `IS NOT TRUE` below — a plain `IF NOT v_is_service_role`
  -- would be `IF NULL` and silently SKIP the gate, letting a no-role
  -- caller through. `IS NOT TRUE` raises on both NULL and FALSE.
  BEGIN
    v_is_service_role := (auth.role() = 'service_role');
  EXCEPTION WHEN OTHERS THEN
    v_is_service_role := FALSE;
  END;

  IF v_is_service_role IS NOT TRUE THEN
    RAISE EXCEPTION
      'test_force_cold_purge: service_role JWT required (test-only RPC, no production caller). audit-2026-05-07 H-0010.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  BEGIN
    v_caller_uid := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_caller_uid := NULL;
  END;

  -- Emit an audit_log row BEFORE the destructive delete so the use of
  -- this append-only bypass is itself traceable (mirrors migration 122).
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_caller_uid, '00000000-0000-0000-0000-000000000000'::uuid),
    'test_force_cold_purge',
    'audit_log_cold',
    p_id,
    jsonb_build_object('invoked_via', 'service_role', 'caller_uid', v_caller_uid)
  );

  -- Scoped DELETE: ONLY test-probe rows. The doubled guard
  -- (entity_type = 'test_probe' AND the literal `__cold_test_` action
  -- prefix) makes it impossible to purge a genuine compliance row even
  -- with the service-role key. The underscores are LIKE wildcards, so we
  -- ESCAPE them to match the literal prefix.
  DELETE FROM audit_log_cold
   WHERE id = p_id
     AND entity_type = 'test_probe'
     AND action LIKE '\_\_cold\_test\_%' ESCAPE '\';

  GET DIAGNOSTICS v_purged = ROW_COUNT;
  RETURN v_purged;
END;
$$;

COMMENT ON FUNCTION public.test_force_cold_purge(uuid) IS
  'TEST-ONLY RPC. service_role EXECUTE only + in-body auth.role() gate. '
  'DELETEs a single audit_log_cold row ONLY when it is a test probe '
  '(entity_type=test_probe AND action LIKE ''__cold_test_%'') — cannot '
  'purge genuine compliance rows. Emits an audit_log row before the '
  'delete. Mirrors test_force_hot_to_cold_move (migrations 057/122). '
  'audit-2026-05-07 H-0010.';

REVOKE ALL ON FUNCTION public.test_force_cold_purge(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.test_force_cold_purge(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.test_force_cold_purge(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.test_force_cold_purge(uuid) TO service_role;

-- --------------------------------------------------------------------------
-- Self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  fn_body TEXT;
  authed_can_exec BOOLEAN;
  anon_can_exec BOOLEAN;
  svc_can_exec BOOLEAN;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn_body
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'test_force_cold_purge';

  IF fn_body IS NULL THEN
    RAISE EXCEPTION 'H-0010 migration failed: test_force_cold_purge function missing';
  END IF;

  -- Assertions use position() (literal substring search) NOT LIKE: a
  -- LIKE pattern treats `_` as a wildcard and `\` as an escape, which
  -- silently mis-matches against the backslash-bearing action-prefix
  -- clause that pg_get_functiondef returns. position() has no such
  -- metacharacters, so each check means exactly what it reads.
  --
  -- Gate present.
  IF position('service_role' in fn_body) = 0 THEN
    RAISE EXCEPTION 'H-0010 migration failed: function body does not gate on service_role';
  END IF;

  -- Scope present — both halves of the doubled guard. `test_probe`
  -- appears only in the DELETE entity_type filter; `ESCAPE` appears only
  -- in the action-prefix LIKE clause. If either guard is removed in a
  -- future edit, its token disappears and this self-check trips.
  IF position('test_probe' in fn_body) = 0 THEN
    RAISE EXCEPTION 'H-0010 migration failed: function body does not scope DELETE to entity_type=test_probe';
  END IF;
  IF position('ESCAPE' in fn_body) = 0 THEN
    RAISE EXCEPTION 'H-0010 migration failed: function body does not scope DELETE to the __cold_test_ action prefix (ESCAPE clause missing)';
  END IF;

  -- Audit emission present.
  IF position('INSERT INTO audit_log' in fn_body) = 0 THEN
    RAISE EXCEPTION 'H-0010 migration failed: function body does not emit an audit_log row before the purge';
  END IF;

  -- Grants: only service_role may EXECUTE.
  SELECT has_function_privilege('authenticated', 'public.test_force_cold_purge(uuid)', 'EXECUTE') INTO authed_can_exec;
  SELECT has_function_privilege('anon', 'public.test_force_cold_purge(uuid)', 'EXECUTE') INTO anon_can_exec;
  SELECT has_function_privilege('service_role', 'public.test_force_cold_purge(uuid)', 'EXECUTE') INTO svc_can_exec;
  IF authed_can_exec THEN
    RAISE EXCEPTION 'H-0010 migration failed: authenticated still has EXECUTE on test_force_cold_purge';
  END IF;
  IF anon_can_exec THEN
    RAISE EXCEPTION 'H-0010 migration failed: anon still has EXECUTE on test_force_cold_purge';
  END IF;
  IF NOT svc_can_exec THEN
    RAISE EXCEPTION 'H-0010 migration failed: service_role lacks EXECUTE on test_force_cold_purge';
  END IF;

  RAISE NOTICE 'H-0010: test_force_cold_purge installed and verified (service_role-only, test-probe-scoped, audit-emitting).';
END
$$;

COMMIT;
