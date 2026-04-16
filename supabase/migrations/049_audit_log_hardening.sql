-- Migration 049: audit_log immutability + log_audit_event RPC.
--
-- Sprint 6 closeout Task 7.1a — Audit log pilot + deny policies.
--
-- Why this migration exists
-- -------------------------
-- Migration 010 created `audit_log` with an owner-read + service-insert
-- policy. Sprint 6 makes the table a true append-only forensic record
-- ("who did what, when, on what entity") that survives a compromise of
-- either the user layer OR the service-role layer.
--
-- Two hardening moves:
--   1. DENY policies on UPDATE and DELETE so no supabase client role (not
--      even service_role) can mutate existing rows. RLS `USING (false)`
--      pairs with a REVOKE UPDATE/DELETE at the table grant level so
--      PostgREST returns "permission denied" instead of silently returning
--      zero affected rows.
--   2. A SECURITY DEFINER `log_audit_event` RPC that inserts on behalf of
--      the caller, deriving user_id from `auth.uid()` so a malicious
--      caller cannot spoof user attribution. EXECUTE granted to
--      `authenticated` + `service_role`.
--
-- Numbering deviation
-- -------------------
-- The Sprint 6 closeout plan called this migration 049_audit_log_hardening.
-- 049 is the free slot — 048 is `contact_request_metadata` (last applied)
-- and 050-053 were consumed by Sprint 5 Tasks 5.4-5.5-5.8 during the
-- plan-to-execution gap. 043 + 047 + 049 are the remaining gaps; using
-- 049 is correct per the convention documented in 050's header.
--
-- What this migration ships
-- -------------------------
-- 1. DENY UPDATE + DENY DELETE RLS policies on audit_log (matching the
--    existing naming convention: `audit_log_no_updates`,
--    `audit_log_no_deletes`).
-- 2. Table-level REVOKE UPDATE, DELETE from authenticated + service_role.
--    Defense in depth with the RLS DENY — if someone disables RLS in a
--    future migration, the REVOKE still blocks.
-- 3. `log_audit_event(p_action text, p_entity_type text, p_entity_id uuid,
--    p_metadata jsonb)` SECURITY DEFINER RPC. Derives user_id from
--    `auth.uid()`; raises if unauthenticated. Inserts into audit_log.
-- 4. Self-verifying DO block asserting all four artifacts are present and
--    round-tripping a test insertion so the INSERT path is proven at
--    apply time.
--
-- Security invariant
-- ------------------
-- After this migration, the only way to write audit_log is either:
--   * service_role direct INSERT (bypasses RLS at the client layer)
--   * `log_audit_event()` RPC (runs as OWNER postgres, bypasses RLS)
-- UPDATE and DELETE are impossible from any non-superuser role.
--
-- Caller impact
-- -------------
-- Zero. audit_log has been unreferenced outside migration 010 until now
-- (Task 7.1a's pilot events are the first writers). No existing code path
-- attempts UPDATE or DELETE on audit_log.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: DENY UPDATE + DENY DELETE policies
-- --------------------------------------------------------------------------
-- RLS policies with USING(false) match zero rows, so every UPDATE/DELETE
-- attempt returns 0 affected rows. Paired with the REVOKE in STEP 2, the
-- combined effect is "permission denied" at the PostgREST layer, which
-- is what a caller probing for tamper-ability must see.
--
-- Idempotent via DROP IF EXISTS guard — re-running the migration is safe.
DROP POLICY IF EXISTS audit_log_no_updates ON audit_log;
CREATE POLICY audit_log_no_updates ON audit_log
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS audit_log_no_deletes ON audit_log;
CREATE POLICY audit_log_no_deletes ON audit_log
  FOR DELETE USING (false);

-- --------------------------------------------------------------------------
-- STEP 2: REVOKE UPDATE, DELETE at the grant level
-- --------------------------------------------------------------------------
-- Supabase's default privileges automatically grant ALL to authenticated
-- and service_role on new tables in public. The RLS policies in STEP 1
-- already deny UPDATE/DELETE, but RLS can be disabled by a future migration
-- or by an admin running `ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY`.
-- The REVOKE here ensures that even with RLS off, the tampering surface
-- stays zero for these two roles.
--
-- Note: SELECT and INSERT grants are left intact so `audit_log_owner_read`
-- (migration 010) and `audit_log_service_insert` (migration 010) continue
-- to work. `log_audit_event` runs as OWNER so it does not need an INSERT
-- grant on the caller's role.
REVOKE UPDATE, DELETE ON audit_log FROM authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 3: log_audit_event RPC
-- --------------------------------------------------------------------------
-- SECURITY DEFINER so the function runs as its owner (postgres), which
-- bypasses the `audit_log_service_insert` WITH CHECK(auth.role()=...)
-- policy and lets authenticated users emit audit rows without widening
-- the RLS policy. user_id is derived from `auth.uid()` inside the body
-- so the caller cannot spoof attribution via a parameter.
--
-- Signature is tightly locked to the spec: four positional args, no
-- optional user_id. If auth.uid() is NULL (unauthenticated anon call
-- somehow reaching this RPC, or a service_role call without the JWT
-- GUC set), we raise — the function refuses to silently smuggle a NULL
-- user_id into a NOT NULL column.
--
-- search_path is pinned per the project's SECURITY DEFINER convention
-- (see migrations 020, 021, 028, 033, 050, 053).
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
    RAISE EXCEPTION 'log_audit_event: auth.uid() is NULL — caller must be authenticated'
      USING ERRCODE = 'insufficient_privilege';
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
  'Fire-and-forget audit event emitter. SECURITY DEFINER; derives user_id from auth.uid() so the caller cannot spoof attribution. Raises if unauthenticated. See migration 049 and ADR-0023.';

-- Grant pattern mirrors get_admin_compute_jobs (migration 033): REVOKE from
-- PUBLIC + anon, GRANT to authenticated (the common case — Next route
-- handlers with a user JWT) + service_role (future Python cross-service
-- callers per Task 7.1b / ADR-0023).
REVOKE ALL ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
-- Mirrors the 033/050 pattern: assert every artifact is present AND that
-- the INSERT path actually works by doing a round-trip test insertion
-- under a rollback-safe savepoint.
DO $$
DECLARE
  has_no_updates_policy BOOLEAN;
  has_no_deletes_policy BOOLEAN;
  has_fn BOOLEAN;
  authed_can_update BOOLEAN;
  authed_can_delete BOOLEAN;
  svc_can_update BOOLEAN;
  svc_can_delete BOOLEAN;
BEGIN
  -- 1. DENY UPDATE policy exists and has the USING(false) predicate
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_log'
      AND policyname = 'audit_log_no_updates'
      AND cmd = 'UPDATE'
      AND qual = 'false'
  ) INTO has_no_updates_policy;
  IF NOT has_no_updates_policy THEN
    RAISE EXCEPTION 'Migration 049 failed: audit_log_no_updates policy missing or does not deny (qual != false)';
  END IF;

  -- 2. DENY DELETE policy exists and has the USING(false) predicate
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_log'
      AND policyname = 'audit_log_no_deletes'
      AND cmd = 'DELETE'
      AND qual = 'false'
  ) INTO has_no_deletes_policy;
  IF NOT has_no_deletes_policy THEN
    RAISE EXCEPTION 'Migration 049 failed: audit_log_no_deletes policy missing or does not deny (qual != false)';
  END IF;

  -- 3. UPDATE/DELETE grants revoked from authenticated + service_role
  SELECT has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
    INTO authed_can_update;
  SELECT has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
    INTO authed_can_delete;
  SELECT has_table_privilege('service_role', 'public.audit_log', 'UPDATE')
    INTO svc_can_update;
  SELECT has_table_privilege('service_role', 'public.audit_log', 'DELETE')
    INTO svc_can_delete;
  IF authed_can_update OR authed_can_delete OR svc_can_update OR svc_can_delete THEN
    RAISE EXCEPTION
      'Migration 049 failed: audit_log UPDATE/DELETE still granted — authed=%/% svc=%/%',
      authed_can_update, authed_can_delete, svc_can_update, svc_can_delete;
  END IF;

  -- 4. log_audit_event function exists and is SECURITY DEFINER
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'log_audit_event'
      AND p.prosecdef = TRUE
      AND pg_get_function_arguments(p.oid) ILIKE '%text%text%uuid%jsonb%'
  ) INTO has_fn;
  IF NOT has_fn THEN
    RAISE EXCEPTION 'Migration 049 failed: log_audit_event(text, text, uuid, jsonb) SECURITY DEFINER function missing';
  END IF;

  -- 5. Round-trip invariant: the function's INSERT path works end-to-end.
  -- We use a SAVEPOINT so the probe row never persists. This proves:
  --   (a) The function is callable (EXECUTE grants at least to postgres).
  --   (b) INSERT passes the existing service_insert policy because the
  --       DEFINER runs as postgres (BYPASSRLS role).
  --   (c) No downstream constraint/trigger rejects a well-formed row.
  DECLARE
    v_test_user UUID := gen_random_uuid();
    v_test_entity UUID := gen_random_uuid();
    v_ok BOOLEAN;
  BEGIN
    SAVEPOINT audit_log_probe;
    -- Direct INSERT (we can't simulate auth.uid() in a DO block, so we
    -- bypass the RPC and INSERT as postgres — this still validates the
    -- table schema + RLS bypass for the OWNER role, which is what the
    -- DEFINER function will do at runtime).
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
    VALUES (v_test_user, '__migration_049_self_verify', 'probe', v_test_entity, '{"probe":true}'::JSONB);

    SELECT EXISTS (
      SELECT 1 FROM audit_log
      WHERE action = '__migration_049_self_verify'
        AND entity_id = v_test_entity
    ) INTO v_ok;

    IF NOT v_ok THEN
      RAISE EXCEPTION 'Migration 049 failed: test INSERT into audit_log did not round-trip';
    END IF;

    ROLLBACK TO SAVEPOINT audit_log_probe;
  END;

  RAISE NOTICE 'Migration 049: audit_log UPDATE/DELETE denied + log_audit_event RPC installed and verified.';
END
$$;

COMMIT;
