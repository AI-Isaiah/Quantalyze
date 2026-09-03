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
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, REDUNDER-BACKFILL). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ TWO MIGRATIONS ARE UNDER TEST, and each twin targets whichever LAST
-- defines the object it mutates: 20260421060316 is the newest definition of all
-- four owner policies, 20260715090000 the newest definition of the scope_kind
-- CHECK. 20260412094453 is in the list because it creates the table those two
-- reshape.
-- ⚠️ 16-fixture-user-notes-baseline.sql DROPS 02-fixture-sanitize-tables.sql's
-- one-column `user_notes` stand-in. It has to: the real table is created with
-- CREATE TABLE IF NOT EXISTS, so with the stand-in present the real CREATE is a
-- NO-OP and every object these arms name would be missing from a table that
-- nonetheless exists — the narrower-stand-in vacuity class plan 164.4-06
-- measured.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/16-fixture-user-notes-baseline.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20260412094453_user_notes.sql","supabase/migrations/20260421060316_user_notes_multiscope.sql","supabase/migrations/20260715090000_user_notes_dashboard_scope.sql"]}

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

  -- RED-UNDER: widen the scope_kind CHECK in migration 20260715090000 to
  --            admit 'bogus' as well. The migration's own self-verify only
  --            asserts that 'dashboard' IS admitted, so the widened list
  --            applies clean — which is precisely why this arm has to exist:
  --            an additive CHECK that stops rejecting anything is not a CHECK.
  -- RED-UNDER-M: {"arm":"Assertion 0","apply":[{"kind":"edit","file":"supabase/migrations/20260715090000_user_notes_dashboard_scope.sql","find":"  CHECK (scope_kind IN ('portfolio','holding','bridge_outcome','strategy','dashboard'));","replace":"  CHECK (scope_kind IN ('portfolio','holding','bridge_outcome','strategy','dashboard','bogus'));","occurrences":1}]}
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

  -- RED-UNDER: close user_notes_select_own to `USING (false)` in migration
  --            20260421060316. The policy still exists under its own name and
  --            RLS is still enabled — all the multiscope self-verify checks —
  --            while every owner reads an empty Notes widget. Assertion 0 is
  --            a bypass-context INSERT and is unaffected, so this arm is the
  --            first failure.
  -- RED-UNDER-M: {"arm":"Assertion 1","apply":[{"kind":"edit","file":"supabase/migrations/20260421060316_user_notes_multiscope.sql","find":"CREATE POLICY user_notes_select_own ON user_notes FOR SELECT\n  USING (user_id = auth.uid());","replace":"CREATE POLICY user_notes_select_own ON user_notes FOR SELECT\n  USING (false);","occurrences":1}]}
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

  -- RED-UNDER: open user_notes_select_own to `USING (true)` in migration
  --            20260421060316. Assertion 1 still passes — A does see its own
  --            note — which is exactly why a test that only asserts `a row
  --            came back` is not proof, and why this arm counts B's view of
  --            A's rows by CONTENT.
  -- RED-UNDER-M: {"arm":"Assertion 2","apply":[{"kind":"edit","file":"supabase/migrations/20260421060316_user_notes_multiscope.sql","find":"CREATE POLICY user_notes_select_own ON user_notes FOR SELECT\n  USING (user_id = auth.uid());","replace":"CREATE POLICY user_notes_select_own ON user_notes FOR SELECT\n  USING (true);","occurrences":1}]}
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

  -- RED-UNDER: open BOTH user_notes_select_own and user_notes_update_own to
  --            `true` in migration 20260421060316, with Assertion 2 neutered.
  --            BOTH are required: an UPDATE whose WHERE clause reads table
  --            columns is filtered by the SELECT policy as well, so opening
  --            the UPDATE gate alone still touches 0 rows and this arm could
  --            not observe it. Assertion 2 sees the read leak first and takes
  --            the neuter (the 164.4-06 rule for two arms reading one
  --            property).
  -- RED-UNDER-M: {"arm":"Assertion 3","apply":[{"kind":"edit","file":"supabase/migrations/20260421060316_user_notes_multiscope.sql","find":"CREATE POLICY user_notes_select_own ON user_notes FOR SELECT\n  USING (user_id = auth.uid());","replace":"CREATE POLICY user_notes_select_own ON user_notes FOR SELECT\n  USING (true);","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260421060316_user_notes_multiscope.sql","find":"CREATE POLICY user_notes_update_own ON user_notes FOR UPDATE\n  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());","replace":"CREATE POLICY user_notes_update_own ON user_notes FOR UPDATE\n  USING (true) WITH CHECK (true);","occurrences":1}],"neuter":[{"arm":"Assertion 2"}]}
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

  -- RED-UNDER: open user_notes_insert_own's WITH CHECK to `true` in migration
  --            20260421060316, and in the same layered apply drop the UNIQUE
  --            from user_notes_unique_multiscope (the name survives, which is
  --            all that migration's own self-verify checks). B's INSERT carrying
  --            A's user_id is then accepted — a note attributed to a user who
  --            never wrote it. The read and update gates are untouched, so
  --            Assertions 1-3 stay green and this arm is the first failure.
  --            ⚠️ MEASURED, and worth knowing: opening the WITH CHECK ALONE
  --            scores NO-IDENTITY. B's forge targets A's EXISTING
  --            (user_id, scope_kind, scope_ref) triple, so once the policy lets
  --            it through the composite unique index refuses it with 23505 —
  --            which this arm's handler (insufficient_privilege OR
  --            check_violation) does not catch, so the file dies outside every
  --            arm. The index is a second, incidental fence on THIS forge only;
  --            a forge at a fresh scope_ref would meet the policy alone. Booked
  --            as a coverage note in the phase's deferred-items.md.
  -- RED-UNDER-M: {"arm":"Assertion 4","apply":[{"kind":"edit","file":"supabase/migrations/20260421060316_user_notes_multiscope.sql","find":"CREATE POLICY user_notes_insert_own ON user_notes FOR INSERT\n  WITH CHECK (user_id = auth.uid());","replace":"CREATE POLICY user_notes_insert_own ON user_notes FOR INSERT\n  WITH CHECK (true);","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260421060316_user_notes_multiscope.sql","find":"CREATE UNIQUE INDEX IF NOT EXISTS user_notes_unique_multiscope\n  ON user_notes (user_id, scope_kind, scope_ref);","replace":"CREATE INDEX IF NOT EXISTS user_notes_unique_multiscope\n  ON user_notes (user_id, scope_kind, scope_ref);","occurrences":1}]}
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

  -- RED-UNDER: the same read+update leak as Assertion 3, with Assertions 2 and
  --            3 neutered. This arm is the CONTENT proof the file's header
  --            demands: Assertion 3 asks how many rows B's UPDATE touched,
  --            this one reads A's note back and asks whether it still says
  --            what A wrote. Reddening it requires B's write to have actually
  --            LANDED, which is why both gates move.
  -- RED-UNDER-M: {"arm":"Assertion 5","apply":[{"kind":"edit","file":"supabase/migrations/20260421060316_user_notes_multiscope.sql","find":"CREATE POLICY user_notes_select_own ON user_notes FOR SELECT\n  USING (user_id = auth.uid());","replace":"CREATE POLICY user_notes_select_own ON user_notes FOR SELECT\n  USING (true);","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260421060316_user_notes_multiscope.sql","find":"CREATE POLICY user_notes_update_own ON user_notes FOR UPDATE\n  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());","replace":"CREATE POLICY user_notes_update_own ON user_notes FOR UPDATE\n  USING (true) WITH CHECK (true);","occurrences":1}],"neuter":[{"arm":"Assertion 2"},{"arm":"Assertion 3"}]}
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
