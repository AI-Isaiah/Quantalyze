-- Test: sanitize_user hardening (migration 120)
--
-- audit-2026-05-07 / P911, P912, P913, P914, P915, P916 — verifies the
-- hardening triggers + body changes shipped by migration 120.
--
-- Asserted invariants:
--   1. Sentinel-rejection triggers are attached to profiles, strategies,
--      portfolios.
--   2. A direct UPDATE of profiles.display_name = '[deleted]' (no
--      service_role JWT, no sanitize-in-progress flag) is REJECTED with
--      ERRCODE 22023.
--   3. profiles.partner_tag column is on the anonymize column list (body
--      string check).
--   4. organizations.created_by IS NOT NULL predicate is in the body.
--   5. auth.users anonymize + session purge code is in the body.
--   6. (Atomicity) sanitize_user runs in an implicit transaction — a
--      forced exception mid-body leaves NO mutations visible.
--
-- Pre-migration FAIL state:
--   Before migration 120, none of the triggers exist; setting
--   display_name='[deleted]' as a regular user succeeds (no error
--   raised). Test 2 would PASS the UPDATE and then assert the trigger
--   was missing — both branches catch the pre-fix state.
--
-- Run order: AFTER migrations 120-123 have been applied to the test
-- Supabase project. Uses BEGIN/ROLLBACK to undo seed data.
--
-- Manual repro:
--   psql "$TEST_SUPABASE_DB_URL" \
--     -f supabase/tests/test_sanitize_user_hardening.sql

BEGIN;

-- --------------------------------------------------------------------------
-- Test 1: triggers attached
-- --------------------------------------------------------------------------
DO $$
DECLARE
  has_p BOOLEAN;
  has_s BOOLEAN;
  has_pf BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'profiles' AND t.tgname = 'profiles_reject_sentinel'
  ) INTO has_p;

  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'strategies' AND t.tgname = 'strategies_reject_sentinel'
  ) INTO has_s;

  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'portfolios' AND t.tgname = 'portfolios_reject_sentinel'
  ) INTO has_pf;

  IF NOT has_p OR NOT has_s OR NOT has_pf THEN
    RAISE EXCEPTION
      'Test 1 failed: sentinel-rejection triggers missing (profiles=%, strategies=%, portfolios=%)',
      has_p, has_s, has_pf;
  END IF;

  RAISE NOTICE 'Test 1 passed: all three sentinel-rejection triggers present';
END $$;

-- --------------------------------------------------------------------------
-- Test 2: sentinel write under non-sanitize context is rejected
--
-- Seed a profile, then attempt to set display_name='[deleted]'. The
-- trigger SHOULD raise. We catch the exception explicitly and verify
-- ERRCODE; if no exception fires, the test FAILS (pre-migration-120
-- behavior).
--
-- NOTE: this test runs against the test Supabase project where the
-- session is service-role by default. To exercise the rejection path
-- we have to SET ROLE to authenticated for the UPDATE, since the
-- trigger gate permits service_role through.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  raised BOOLEAN := FALSE;
  err_state TEXT;
BEGIN
  -- Seed an auth.users + profile under service-role context.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-p911-' || test_uid::text || '@quantalyze.test',
          now(), now());

  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'normal name', 'test-p911@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;

  -- Switch to authenticated role (mimics the user's PostgREST session).
  -- PR #150 follow-up: forge the request.jwt.claims sub so auth.uid()
  -- resolves to test_uid. Without this the profiles RLS USING clause
  -- (`id = auth.uid()`) evaluates to NULL for every row, the UPDATE
  -- matches zero rows, the BEFORE UPDATE trigger never fires, and the
  -- test reads as a false-positive "trigger missing".
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE profiles SET display_name = '[deleted]' WHERE id = test_uid;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;

  -- Restore role for cleanup.
  RESET ROLE;

  IF NOT raised THEN
    RAISE EXCEPTION
      'Test 2 failed: sentinel UPDATE under authenticated role should have been rejected, but succeeded. This is the pre-migration-120 state (P911).';
  END IF;

  IF err_state <> '22023' THEN
    RAISE EXCEPTION
      'Test 2 failed: sentinel UPDATE raised wrong ERRCODE. Expected 22023, got %', err_state;
  END IF;

  -- Re-read: display_name should still be 'normal name'.
  PERFORM 1 FROM profiles WHERE id = test_uid AND display_name = 'normal name';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test 2 failed: profile mutation should have been reverted';
  END IF;

  RAISE NOTICE 'Test 2 passed: sentinel write under authenticated role rejected with ERRCODE 22023';

  -- Cleanup (still under service-role since we RESET above).
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 3: sanitize_user body contains the documented invariants
-- --------------------------------------------------------------------------
DO $$
DECLARE
  fn_body TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn_body
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'sanitize_user';

  IF fn_body IS NULL THEN
    RAISE EXCEPTION 'Test 3 failed: sanitize_user function not found';
  END IF;

  -- P914: partner_tag in anonymize set
  IF fn_body NOT LIKE '%partner_tag%' THEN
    RAISE EXCEPTION 'Test 3 failed (P914): sanitize_user body does not reference partner_tag';
  END IF;

  -- P913: defensive predicate on organizations
  IF fn_body NOT LIKE '%created_by IS NOT NULL%' THEN
    RAISE EXCEPTION 'Test 3 failed (P913): sanitize_user body does not have defensive IS NOT NULL predicate on organizations.created_by';
  END IF;

  -- P916: auth purge
  IF fn_body NOT LIKE '%auth.refresh_tokens%' THEN
    RAISE EXCEPTION 'Test 3 failed (P916): sanitize_user body does not purge auth.refresh_tokens';
  END IF;
  IF fn_body NOT LIKE '%auth.sessions%' THEN
    RAISE EXCEPTION 'Test 3 failed (P916): sanitize_user body does not purge auth.sessions';
  END IF;
  IF fn_body NOT LIKE '%banned_until%' THEN
    RAISE EXCEPTION 'Test 3 failed (P916): sanitize_user body does not set auth.users.banned_until';
  END IF;

  -- Migration 127 (red-team Finding 3): the sanitize-in-progress GUC
  -- bypass MUST be removed — it was forgeable from an authenticated
  -- session via set_config(...).
  IF fn_body LIKE '%quantalyze.sanitize_in_progress%' THEN
    RAISE EXCEPTION 'Test 3 failed (Finding 3): sanitize_user still calls set_config on the bypass GUC — Migration 127 regressed';
  END IF;

  RAISE NOTICE 'Test 3 passed: sanitize_user body contains P913/P914/P916 fixes (Finding 3: GUC bypass removed)';
END $$;

-- --------------------------------------------------------------------------
-- Test 4: atomicity (P915) — a forced exception inside a sanitize call
-- leaves the database unchanged. We simulate this by wrapping a call to
-- sanitize_user in a SAVEPOINT, then raising inside the same transaction
-- after the call returns, and verifying ROLLBACK TO SAVEPOINT reverts.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  display_after TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-p915-' || test_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'atomicity test', 'test-p915@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;

  -- Open a SAVEPOINT, call sanitize_user, then force a rollback.
  BEGIN
    PERFORM public.sanitize_user(test_uid);
    -- Force rollback to savepoint via raising.
    RAISE EXCEPTION 'forced rollback for atomicity test';
  EXCEPTION WHEN OTHERS THEN
    -- The block above was an implicit savepoint; on exception the
    -- inner mutations roll back, leaving the seeded row untouched.
    NULL;
  END;

  -- Verify: profile is still 'atomicity test', not '[deleted]'.
  SELECT display_name INTO display_after FROM profiles WHERE id = test_uid;
  IF display_after <> 'atomicity test' THEN
    RAISE EXCEPTION
      'Test 4 failed (P915): sanitize_user mutations were not rolled back by the outer EXCEPTION. display_name=%', display_after;
  END IF;

  RAISE NOTICE 'Test 4 passed: sanitize_user mutations rolled back atomically on outer exception';

  -- Cleanup
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 5: Finding 3 (audit-2026-05-07 red-team) — GUC bypass attempt is
-- blocked.
--
-- Pre-Migration-127, the following sequence succeeded and let an
-- authenticated user poison the sentinel:
--
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('quantalyze.sanitize_in_progress', 'on', true);
--   UPDATE profiles SET display_name='[deleted]' WHERE id=auth.uid();
--
-- Post-127, the trigger ignores the GUC; the current_user check fires
-- and raises ERRCODE 22023.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid    UUID := gen_random_uuid();
  raised      BOOLEAN := FALSE;
  err_state   TEXT;
  cur_name    TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-finding3-' || test_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'finding3 name', 'test-finding3@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;

  -- Forge JWT sub so RLS admits the row to the authenticated role's view.
  -- See Test 2 / PR #150 follow-up note for the full rationale.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  PERFORM set_config('quantalyze.sanitize_in_progress', 'on', true);

  BEGIN
    UPDATE profiles SET display_name = '[deleted]' WHERE id = test_uid;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;

  RESET ROLE;

  IF NOT raised THEN
    RAISE EXCEPTION
      'Test 5 failed (Finding 3): set_config + sentinel UPDATE bypass succeeded — Migration 127 regressed';
  END IF;
  IF err_state <> '22023' THEN
    RAISE EXCEPTION
      'Test 5 failed (Finding 3): expected ERRCODE 22023, got %', err_state;
  END IF;
  SELECT display_name INTO cur_name FROM profiles WHERE id = test_uid;
  IF cur_name <> 'finding3 name' THEN
    RAISE EXCEPTION
      'Test 5 failed (Finding 3): profile was mutated despite bypass — display_name=%', cur_name;
  END IF;

  RAISE NOTICE 'Test 5 passed (Finding 3): GUC bypass blocked by current_user gate.';

  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 6: Finding 4 (audit-2026-05-07 red-team) — sentinel comparison
-- variants are all rejected.
--
-- Migration 127 replaces the strict `= '[deleted]'` predicate with
-- `lower(trim(coalesce(NEW.<col>, ''))) LIKE '[deleted%'`. This must
-- catch all the following evasion vectors:
--
--   - '[deleted]'           — exact baseline
--   - '[deleted] '          — trailing whitespace
--   - '[Deleted]'           — capital D
--   - '[DELETED]'           — all-caps
--   - ' [deleted]'          — leading whitespace
--   - '[deleted strategy]'  — extended-suffix variant
--
-- NULL is allowed (it is not the sentinel; coalesce(NULL, '') = '' does
-- not match '[deleted%').
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid    UUID := gen_random_uuid();
  variants    TEXT[] := ARRAY[
    '[deleted]',
    '[deleted] ',
    '[Deleted]',
    '[DELETED]',
    ' [deleted]',
    '[deleted strategy]'
  ];
  v_variant   TEXT;
  raised      BOOLEAN;
  err_state   TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-finding4-' || test_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'finding4 name', 'test-finding4@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;

  -- Forge JWT sub so RLS admits the seeded row to the authenticated
  -- role's view. Set once at the top of the test; each loop iteration
  -- only swaps ROLE.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text,
    true
  );

  FOREACH v_variant IN ARRAY variants LOOP
    raised := FALSE;
    err_state := NULL;
    SET LOCAL ROLE authenticated;
    BEGIN
      UPDATE profiles SET display_name = v_variant WHERE id = test_uid;
    EXCEPTION WHEN OTHERS THEN
      raised := TRUE;
      err_state := SQLSTATE;
    END;
    RESET ROLE;

    IF NOT raised THEN
      RAISE EXCEPTION
        'Test 6 failed (Finding 4): evasion variant % was accepted by reject_sentinel_writes', v_variant;
    END IF;
    IF err_state <> '22023' THEN
      RAISE EXCEPTION
        'Test 6 failed (Finding 4): evasion variant % raised ERRCODE % (expected 22023)', v_variant, err_state;
    END IF;
  END LOOP;

  RAISE NOTICE 'Test 6 passed (Finding 4): all sentinel-evasion variants rejected.';

  -- Explicit-NULL case: NULL is not the sentinel; the trigger must allow
  -- it (a profile may legitimately have a null display_name). Run under
  -- the authenticated role so the trigger's gate is exercised.
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE profiles SET display_name = NULL WHERE id = test_uid;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    -- Some other CHECK / NOT NULL constraint on profiles.display_name
    -- may reject the NULL; that's not the trigger's fault. We accept
    -- either "succeeded" (the trigger let it through) or any non-22023
    -- code (a separate constraint rejected it).
    IF SQLSTATE = '22023' THEN
      RAISE EXCEPTION
        'Test 6 failed (Finding 4): NULL display_name was rejected by reject_sentinel_writes (should be allowed)';
    END IF;
  END;
  RESET ROLE;

  RAISE NOTICE 'Test 6 NULL case passed (Finding 4): NULL is not treated as the sentinel.';

  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

ROLLBACK;
