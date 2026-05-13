-- Test: log_audit_event_service ceiling + FK + test_force_hot_to_cold_move
-- audit & gate (migrations 122 + 123).
--
-- audit-2026-05-07 / P918, P919, P920.
--
-- Asserted invariants:
--   1. (P919) audit_log.user_id has FK to auth.users(id) with ON DELETE
--      SET NULL.
--   2. (P919) audit_log.user_id is nullable.
--   3. (P920) Calling log_audit_event_service with a metadata payload
--      exceeding 32 KB raises ERRCODE 22023.
--   4. (P920) Calling log_audit_event_service with a small payload
--      succeeds and returns a row id.
--   5. (P918) test_force_hot_to_cold_move body references user_app_roles
--      (admin gate) AND inserts an audit_log row.
--   6. (P918) test_force_hot_to_cold_move EXECUTE remains revoked from
--      authenticated.
--
-- Pre-migration FAIL state:
--   * Before 123, no FK on audit_log.user_id (Test 1 catches).
--   * Before 123, the 32 KB ceiling does not exist; a large metadata
--     payload would INSERT (Test 3 catches by asserting the raise).
--   * Before 122, test_force_hot_to_cold_move body lacks the role gate
--     and audit emission (Test 5 catches by string-grep).
--
-- Run order: AFTER migrations 120-123 have been applied.
--
-- JWT-claims scaffolding (PR #150 follow-up — first CI run of sql-tests):
-- Tests 3, 4, and 6 call log_audit_event_service which gates on
-- `auth.role() IN ('authenticated','service_role')` (migration 123 / P919).
-- Connecting via the Supabase pooler as the `postgres` role does NOT
-- carry a JWT, so without an explicit forge auth.role() returns NULL
-- and the gate raises ERRCODE 42501 — masking the size-ceiling check
-- that Test 3 is actually trying to assert. Setting
-- request.jwt.claims.role='service_role' as the first statement inside
-- the outer transaction makes auth.role() resolve to 'service_role' for
-- every DO block below (transaction-local config persists across
-- statements in the same transaction).

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

-- --------------------------------------------------------------------------
-- Test 1: audit_log.user_id FK shape (P919)
-- --------------------------------------------------------------------------
DO $$
DECLARE
  fk_action CHAR(1);
  fk_ref TEXT;
  user_id_nullable TEXT;
BEGIN
  SELECT confdeltype,
         (SELECT relname FROM pg_class WHERE oid = confrelid)
    INTO fk_action, fk_ref
  FROM pg_constraint
  WHERE conname = 'audit_log_user_id_fkey'
    AND conrelid = 'public.audit_log'::regclass;

  IF fk_action IS NULL THEN
    RAISE EXCEPTION 'Test 1 failed (P919): audit_log_user_id_fkey FK missing (pre-migration-123 state)';
  END IF;
  IF fk_action <> 'n' THEN
    RAISE EXCEPTION 'Test 1 failed (P919): FK action must be SET NULL (n), got %', fk_action;
  END IF;
  IF fk_ref <> 'users' THEN
    RAISE EXCEPTION 'Test 1 failed (P919): FK must reference auth.users, got %', fk_ref;
  END IF;

  SELECT is_nullable INTO user_id_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'audit_log'
    AND column_name = 'user_id';
  IF user_id_nullable <> 'YES' THEN
    RAISE EXCEPTION 'Test 1 failed (P919): audit_log.user_id is not nullable (%); FK SET NULL would not be valid', user_id_nullable;
  END IF;

  RAISE NOTICE 'Test 1 passed: audit_log.user_id FK = SET NULL → auth.users, nullable';
END $$;

-- --------------------------------------------------------------------------
-- Test 2: log_audit_event_service body has the role gate + 32 KB ceiling
-- --------------------------------------------------------------------------
DO $$
DECLARE
  fn_body TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn_body
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'log_audit_event_service';

  IF fn_body IS NULL THEN
    RAISE EXCEPTION 'Test 2 failed: log_audit_event_service function not found';
  END IF;
  IF fn_body NOT LIKE '%auth.role()%' THEN
    RAISE EXCEPTION 'Test 2 failed (P919): function body lacks auth.role() gate';
  END IF;
  IF fn_body NOT LIKE '%32768%' THEN
    RAISE EXCEPTION 'Test 2 failed (P920): function body lacks 32 KB ceiling literal';
  END IF;

  RAISE NOTICE 'Test 2 passed: log_audit_event_service body has role gate + 32 KB ceiling';
END $$;

-- --------------------------------------------------------------------------
-- Test 3: large-payload INSERT raises ERRCODE 22023.
--
-- We construct a 40 KB jsonb payload (>32768) and call the RPC. The
-- guarded raise should fire. NOTE: this test runs in service_role context
-- (test Supabase project), so the auth.role() check passes; the only gate
-- that should reject is the size ceiling.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  big_meta JSONB;
  raised BOOLEAN := FALSE;
  err_state TEXT;
BEGIN
  -- Seed an auth.users row to satisfy the FK.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-p920-' || test_uid::text || '@quantalyze.test',
          now(), now());

  -- Build a ~40 KB jsonb. repeat('x', 40000) produces a 40000-char
  -- string, which serializes to ~40 KB jsonb.
  big_meta := jsonb_build_object('blob', repeat('x', 40000));

  BEGIN
    PERFORM public.log_audit_event_service(
      test_uid,
      'test.p920',
      'test_probe',
      gen_random_uuid(),
      big_meta
    );
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'Test 3 failed (P920): 40 KB metadata payload did NOT raise — ceiling not enforced';
  END IF;

  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'Test 3 failed (P920): expected ERRCODE 22023 (invalid_parameter_value), got %', err_state;
  END IF;

  RAISE NOTICE 'Test 3 passed: 40 KB metadata payload rejected with ERRCODE 22023';

  -- Cleanup. auth.users delete cascades — but audit_log_user_id_fkey is
  -- SET NULL, so the rejected attempt left no audit row anyway.
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 4: small-payload INSERT succeeds and returns a UUID.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  v_row_id UUID;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-p920-ok-' || test_uid::text || '@quantalyze.test',
          now(), now());

  SELECT public.log_audit_event_service(
    test_uid,
    'test.p920_ok',
    'test_probe',
    gen_random_uuid(),
    jsonb_build_object('small', 'payload', 'size_bytes', 100)
  ) INTO v_row_id;

  IF v_row_id IS NULL THEN
    RAISE EXCEPTION 'Test 4 failed: log_audit_event_service did not return a row id for valid payload';
  END IF;

  -- Verify the row landed
  PERFORM 1 FROM audit_log WHERE id = v_row_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test 4 failed: audit_log row % not inserted', v_row_id;
  END IF;

  RAISE NOTICE 'Test 4 passed: small-payload INSERT succeeded (row id=%)', v_row_id;

  DELETE FROM audit_log WHERE id = v_row_id;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 5: test_force_hot_to_cold_move body has role gate + audit emit (P918)
-- --------------------------------------------------------------------------
DO $$
DECLARE
  fn_body TEXT;
  authed_can_exec BOOLEAN;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn_body
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'test_force_hot_to_cold_move';

  IF fn_body IS NULL THEN
    RAISE EXCEPTION 'Test 5 failed: test_force_hot_to_cold_move function not found';
  END IF;
  IF fn_body NOT LIKE '%user_app_roles%' THEN
    RAISE EXCEPTION 'Test 5 failed (P918): function body lacks user_app_roles admin gate';
  END IF;
  IF fn_body NOT LIKE '%INSERT INTO audit_log%' THEN
    RAISE EXCEPTION 'Test 5 failed (P918): function body lacks audit_log INSERT';
  END IF;

  SELECT has_function_privilege('authenticated', 'public.test_force_hot_to_cold_move()', 'EXECUTE')
    INTO authed_can_exec;
  IF authed_can_exec THEN
    RAISE EXCEPTION 'Test 5 failed (P918): authenticated has EXECUTE on test_force_hot_to_cold_move — gate broken';
  END IF;

  RAISE NOTICE 'Test 5 passed: test_force_hot_to_cold_move has role gate + audit emit; EXECUTE locked';
END $$;

-- --------------------------------------------------------------------------
-- Test 6: end-to-end FK SET NULL — deleting an auth.users row that has
-- audit_log entries flips user_id to NULL but preserves the audit row.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  v_audit_id UUID;
  survived_user_id UUID;
  survived_action TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-p919-fk-' || test_uid::text || '@quantalyze.test',
          now(), now());

  -- Emit an audit row via the RPC (exercises the full path).
  SELECT public.log_audit_event_service(
    test_uid,
    'test.p919.fk',
    'test_probe',
    gen_random_uuid(),
    '{"end_to_end": true}'::jsonb
  ) INTO v_audit_id;

  -- Now delete the auth.users row. FK SET NULL must fire.
  DELETE FROM auth.users WHERE id = test_uid;

  -- The audit row must survive with user_id = NULL.
  SELECT user_id, action INTO survived_user_id, survived_action
  FROM audit_log WHERE id = v_audit_id;

  IF survived_action IS NULL THEN
    RAISE EXCEPTION 'Test 6 failed (P919): audit_log row vanished (FK should be SET NULL, not CASCADE)';
  END IF;
  IF survived_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Test 6 failed (P919): user_id should be NULL after auth.users delete, got %', survived_user_id;
  END IF;
  IF survived_action <> 'test.p919.fk' THEN
    RAISE EXCEPTION 'Test 6 failed (P919): audit row action lost, got %', survived_action;
  END IF;

  RAISE NOTICE 'Test 6 passed: FK SET NULL preserves audit row + nulls user_id on auth.users delete';

  DELETE FROM audit_log WHERE id = v_audit_id;
END $$;

ROLLBACK;
