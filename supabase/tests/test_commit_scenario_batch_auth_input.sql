-- Test: commit_scenario_batch auth + input validation gates (migration 128).
--
-- audit-2026-05-07 round 2 Block E Task E.1.
--
-- Covers the function's "front door" branches that exist independent of
-- the P1956/P1957 hardening but landed in the same CREATE OR REPLACE.
-- A regression here means the auth.uid() guard or input validation has
-- been weakened.
--
-- Asserted invariants:
--   1. EXECUTE is granted to authenticated, revoked from PUBLIC and anon.
--      A future migration that GRANTs to PUBLIC (or removes the
--      authenticated grant) breaks this contract.
--   2. auth.uid() <> p_allocator_id raises ERRCODE 42501. Driven by
--      forging the JWT sub to user A then calling the RPC with user B's
--      uuid.
--   3. p_diffs = '[]'::jsonb (empty array) raises ERRCODE 22023.
--   4. p_diffs is not an array (e.g. '{}'::jsonb) raises ERRCODE 22023.
--   5. An unknown kind value raises ERRCODE 22023 (the ELSE branch).
--
-- Pre-migration-128 FAIL state: none of these gates change semantically
-- in mig 128 vs mig 083 — the assertions catch REGRESSION rather than
-- pre-fix state. CLAUDE.md regression rule: callers unchanged by the
-- patch are still regression candidates because mig 128 rewrites the
-- whole function body.
--
-- Run order: AFTER migration 128 has been applied.

BEGIN;

-- --------------------------------------------------------------------------
-- Test 1: EXECUTE grant shape.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_auth_can BOOLEAN;
  v_anon_can BOOLEAN;
  v_pub_can  BOOLEAN;
BEGIN
  SELECT has_function_privilege('authenticated',
           'public.commit_scenario_batch(uuid, jsonb)', 'EXECUTE')
    INTO v_auth_can;
  IF v_auth_can IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 1 failed: authenticated lacks EXECUTE on commit_scenario_batch';
  END IF;

  SELECT has_function_privilege('anon',
           'public.commit_scenario_batch(uuid, jsonb)', 'EXECUTE')
    INTO v_anon_can;
  IF v_anon_can IS TRUE THEN
    RAISE EXCEPTION 'Test 1 failed: anon has EXECUTE on commit_scenario_batch — REVOKE regressed';
  END IF;

  -- PUBLIC: use pg_proc.proacl to detect. has_function_privilege('PUBLIC',...)
  -- is not a thing; we infer via the absence of `=X/` for PUBLIC in proacl.
  -- A safer pattern: check that public role does NOT have EXECUTE by
  -- introspecting routine_privileges with grantee='PUBLIC'.
  SELECT EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
     WHERE routine_schema = 'public'
       AND routine_name   = 'commit_scenario_batch'
       AND grantee        = 'PUBLIC'
  ) INTO v_pub_can;
  IF v_pub_can THEN
    RAISE EXCEPTION 'Test 1 failed: PUBLIC has EXECUTE on commit_scenario_batch — REVOKE regressed';
  END IF;

  RAISE NOTICE 'Test 1 passed: authenticated has EXECUTE; anon + PUBLIC do not';
END $$;

-- --------------------------------------------------------------------------
-- Test 2: auth.uid() <> p_allocator_id raises 42501.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  caller_uid UUID := gen_random_uuid();
  victim_uid UUID := gen_random_uuid();
  raised BOOLEAN := FALSE;
  err_state TEXT;
BEGIN
  -- Seed both users so FK chains (if reached) are valid — though the
  -- guard should fire before any insert touches them.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (caller_uid, '00000000-0000-0000-0000-000000000000',
          'test-csb-auth-caller-' || caller_uid::text || '@quantalyze.test',
          now(), now()),
         (victim_uid, '00000000-0000-0000-0000-000000000000',
          'test-csb-auth-victim-' || victim_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (caller_uid, 'caller', 'test-csb-caller@quantalyze.test'),
         (victim_uid, 'victim', 'test-csb-victim@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email        = EXCLUDED.email;

  -- JWT says caller, but we pass victim's id.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', caller_uid::text, 'role', 'authenticated')::text,
    true
  );

  BEGIN
    PERFORM public.commit_scenario_batch(
      victim_uid,
      jsonb_build_array(
        jsonb_build_object('kind', 'voluntary_add', 'strategy_id', gen_random_uuid()::text)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION
      'Test 2 failed: auth.uid() <> p_allocator_id call SUCCEEDED — privilege boundary broken';
  END IF;
  IF err_state <> '42501' THEN
    RAISE EXCEPTION
      'Test 2 failed: expected ERRCODE 42501 (insufficient_privilege), got %', err_state;
  END IF;

  RAISE NOTICE 'Test 2 passed: cross-allocator call rejected with ERRCODE 42501';

  DELETE FROM profiles WHERE id IN (caller_uid, victim_uid);
  DELETE FROM auth.users WHERE id IN (caller_uid, victim_uid);
END $$;

-- --------------------------------------------------------------------------
-- Test 3: empty diffs array raises 22023.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  caller_uid UUID := gen_random_uuid();
  raised BOOLEAN := FALSE;
  err_state TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (caller_uid, '00000000-0000-0000-0000-000000000000',
          'test-csb-empty-' || caller_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (caller_uid, 'empty-test', 'test-csb-empty@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email        = EXCLUDED.email;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', caller_uid::text, 'role', 'authenticated')::text,
    true
  );

  BEGIN
    PERFORM public.commit_scenario_batch(caller_uid, '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'Test 3 failed: empty diffs array call SUCCEEDED — input validation broken';
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'Test 3 failed: expected 22023, got %', err_state;
  END IF;

  -- Non-array diffs.
  raised := FALSE;
  BEGIN
    PERFORM public.commit_scenario_batch(caller_uid, '{"kind":"voluntary_add"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'Test 3 failed: non-array diffs call SUCCEEDED — input validation broken';
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'Test 3 failed: non-array expected 22023, got %', err_state;
  END IF;

  RAISE NOTICE 'Test 3 passed: empty + non-array diffs rejected with ERRCODE 22023';

  DELETE FROM profiles WHERE id = caller_uid;
  DELETE FROM auth.users WHERE id = caller_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 4: unknown kind raises 22023.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  caller_uid UUID := gen_random_uuid();
  raised BOOLEAN := FALSE;
  err_state TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (caller_uid, '00000000-0000-0000-0000-000000000000',
          'test-csb-unkkind-' || caller_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (caller_uid, 'unkkind-test', 'test-csb-unkkind@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email        = EXCLUDED.email;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', caller_uid::text, 'role', 'authenticated')::text,
    true
  );

  BEGIN
    PERFORM public.commit_scenario_batch(
      caller_uid,
      jsonb_build_array(jsonb_build_object('kind', 'definitely_not_a_real_kind'))
    );
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'Test 4 failed: unknown-kind diff call SUCCEEDED — ELSE branch unreachable';
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION 'Test 4 failed: expected 22023, got %', err_state;
  END IF;

  RAISE NOTICE 'Test 4 passed: unknown kind rejected with ERRCODE 22023';

  DELETE FROM profiles WHERE id = caller_uid;
  DELETE FROM auth.users WHERE id = caller_uid;
END $$;

ROLLBACK;
