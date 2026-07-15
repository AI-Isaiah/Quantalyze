-- Test for migration 20260715090000_user_notes_dashboard_scope.sql —
-- the additive `dashboard` scope_kind on user_notes. Phase 100 (PI-04).
--
-- This is the CI-AUTHORITATIVE owner-scope proof for the new scope. The vitest
-- live-DB notes tests SKIP in CI (no test DB), so RLS correctness for the
-- dashboard scope is proven HERE. user_notes RLS FAILS SILENTLY — a loosened
-- policy ships GREEN unless a test inspects the returned rows by CONTENT
-- (id presence/absence) and asserts writes actually took effect. This file
-- asserts:
--   * user A can insert + read its own scope_kind='dashboard' row;
--   * user B SELECTs 0 of A's dashboard rows (cross-tenant read denied);
--   * user B's UPDATE of A's dashboard note affects 0 rows (RLS USING gate);
--   * user B INSERTing a row with A's user_id is rejected by the INSERT policy
--     WITH CHECK (user_id = auth.uid()) — no forging another user's note;
--   * the CHECK accepts 'dashboard' and rejects an arbitrary value ('bogus').
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands. Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. Filename matches the
-- `test_*.sql` glob so the job auto-discovers it against the test project (with
-- migration 20260715090000 applied).
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_user_notes_dashboard_scope.sql

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have left synthetic rows).
-- ON DELETE CASCADE chains auth.users -> profiles -> user_notes, so deleting
-- auth.users by email drops the subtree.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-dashboard-note-a@quantalyze.test',
    'test-dashboard-note-b@quantalyze.test'
  );

DO $$
DECLARE
  uid_a    UUID := gen_random_uuid();
  uid_b    UUID := gen_random_uuid();
  row_cnt  INTEGER;
  raised   BOOLEAN;
BEGIN
  -- ----- SEED (seeding/service-role context — bypasses RLS) ---------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-dashboard-note-a@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'dashboard-note tenant a', 'test-dashboard-note-a@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-dashboard-note-b@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'dashboard-note tenant b', 'test-dashboard-note-b@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  RAISE NOTICE 'Seed OK: A uid=%, B uid=%', uid_a, uid_b;

  -- ----- ASSERTION 0: CHECK accepts 'dashboard', rejects 'bogus' ----------
  -- (service-role INSERT; still subject to the table CHECK constraint.)
  INSERT INTO user_notes (user_id, scope_kind, scope_ref, content)
  VALUES (uid_a, 'dashboard', 'allocations', 'A book note.');

  raised := FALSE;
  BEGIN
    INSERT INTO user_notes (user_id, scope_kind, scope_ref, content)
    VALUES (uid_a, 'bogus', 'allocations', 'x');
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 0): scope_kind=''bogus'' was ACCEPTED — CHECK constraint too permissive';
  END IF;

  -- ----- ASSERTION 1: A reads its own dashboard note ----------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM user_notes
    WHERE user_id = uid_a AND scope_kind = 'dashboard' AND scope_ref = 'allocations';
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (Assertion 1): user A sees % of its own dashboard notes, expected 1', row_cnt;
  END IF;
  RESET ROLE;

  -- ----- ASSERTION 2: B does NOT read A's dashboard note ------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM user_notes
    WHERE user_id = uid_a AND scope_kind = 'dashboard';
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (Assertion 2): user B sees % of user A''s dashboard notes, expected 0 — CROSS-TENANT LEAK', row_cnt;
  END IF;

  -- ----- ASSERTION 3: B's UPDATE of A's note affects 0 rows ---------------
  -- RLS USING (user_id = auth.uid()) hides A's row from B's UPDATE. A silent
  -- 0-row UPDATE (not an error) is the correct, owner-scoped outcome.
  UPDATE user_notes SET content = 'B tampered.'
    WHERE user_id = uid_a AND scope_kind = 'dashboard';
  GET DIAGNOSTICS row_cnt = ROW_COUNT;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (Assertion 3): user B UPDATEd % of user A''s dashboard rows, expected 0 — RLS UPDATE gate loosened', row_cnt;
  END IF;

  -- ----- ASSERTION 4: B cannot forge a note with A's user_id -------------
  -- INSERT policy WITH CHECK (user_id = auth.uid()) must reject a row whose
  -- user_id is another user. RLS surfaces this as insufficient_privilege.
  raised := FALSE;
  BEGIN
    INSERT INTO user_notes (user_id, scope_kind, scope_ref, content)
    VALUES (uid_a, 'dashboard', 'allocations', 'forged by B');
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    raised := TRUE;
  END;
  RESET ROLE;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 4): user B forged a dashboard note with user A''s user_id — INSERT WITH CHECK loosened';
  END IF;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ----- ASSERTION 5: A's note is unchanged (B never wrote it) -----------
  SELECT count(*) INTO row_cnt FROM user_notes
    WHERE user_id = uid_a AND scope_kind = 'dashboard' AND content = 'A book note.';
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 5): user A''s dashboard note was mutated by user B (found % unchanged rows, expected 1)', row_cnt;
  END IF;

  RAISE NOTICE 'All user_notes dashboard-scope RLS assertions passed (owner-only isolation intact).';

  -- ----- TEARDOWN -------------------------------------------------------
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);
END
$$;

-- --------------------------------------------------------------------------
-- Defensive post-clean (if an assertion aborted, the seed rows would survive).
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-dashboard-note-a@quantalyze.test',
    'test-dashboard-note-b@quantalyze.test'
  );
