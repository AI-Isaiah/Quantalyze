-- Test for migration 20260624120000_csv_daily_returns_per_key_axis.sql —
-- the per-key dailies axis RLS + owner-coherence trigger. Phase 35 (DAILIES-04).
--
-- This is the phase's load-bearing tenant-isolation test. csv_daily_returns now
-- holds BOTH strategy-scoped rows (strategy_id set, the existing CSV pipeline) and
-- per-key rows (api_key_id + denormalized allocator_id set, strategy_id NULL). The
-- new policy `csv_daily_returns_allocator_owner_select` gates per-key reads by
-- `allocator_id = auth.uid()`. RLS FAILS SILENTLY — a loosened predicate ships
-- GREEN unless a test inspects the returned rows by CONTENT (id presence/absence).
-- A test that asserts "a row came back" is not proof. This file asserts:
--   * allocator A sees A's own per-key row, and NEVER allocator B's (cross-tenant);
--   * allocator B sees B's own per-key row, and NEVER A's;
--   * the strategy-owner policy does NOT leak per-key rows: a per-key row has
--     strategy_id NULL, so `NULL IN (SELECT id FROM strategies WHERE user_id=uid)`
--     is NULL (never TRUE) — an allocator who owns strategies still sees 0 of
--     another allocator's per-key rows (the NULL-IN-subquery leak guard);
--   * anon sees 0 per-key rows (TO authenticated only);
--   * the owner-coherence trigger rejects a per-key row whose allocator_id does
--     not equal api_keys.user_id (defense-in-depth, parity with allocator_holdings);
--   * the source XOR rejects a row that sets BOTH strategy_id and api_key_id.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands (the sql-tests
-- preflight rejects shell-out / copy / output redirection). Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. Filename matches the
-- `test_*.sql` glob so the job auto-discovers it against the test project (with
-- migration 20260624120000 applied).
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_csv_daily_returns_perkey_rls.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4). Each prose RED-UNDER below an arm
-- carries an adjacent `RED-UNDER-M` object that scripts/mutation-runner executes:
-- it mutates COPIES on a throwaway pg-lane cluster, requires the FIRST
-- `TEST FAILED (…)` to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md. The line below declares what the lane
-- applies before this gate. DISCOVERED, not guessed — plan 164.4-06 iterated it
-- over 2 lane runs to `All … assertions passed`, mean 0.95 s/lane over 3 timed
-- GREEN runs.
-- ⚠️ 07-fixture-supabase-default-privileges.sql is what makes Assertion 5
-- falsifiable. csv_daily_returns is created by a migration IN this list, so
-- Supabase's bootstrap default privileges give `anon` the table grant it holds in
-- production; without them anon would answer 42501, the gate's handler would read
-- that as 0 rows, and the arm would pass whatever the POLICY said. Its twin below
-- opens the policy to anon and the arm reddens — which it could not do on a
-- cluster where anon had no grant at all.
-- ⚠️ 12-fixture-profiles-is-admin.sql defaults to FALSE on purpose: an
-- admin-by-default profile would let csv_daily_returns_admin_select return every
-- row and make every cross-tenant assertion here pass or fail for a reason
-- unrelated to the policy under test.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","supabase/migrations/20260522111839_csv_daily_returns.sql","supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql"]}

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have left synthetic rows).
-- ON DELETE CASCADE chains auth.users -> profiles -> {strategies, api_keys}
-- -> csv_daily_returns, so deleting auth.users by email drops the subtree.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-perkey-rls-tenant-a@quantalyze.test',
    'test-perkey-rls-tenant-b@quantalyze.test'
  );

DO $$
DECLARE
  uid_a    UUID := gen_random_uuid();
  uid_b    UUID := gen_random_uuid();
  key_a    UUID;
  key_b    UUID;
  strat_a  UUID;
  row_cnt  INTEGER;
  raised   BOOLEAN;
  err_state TEXT;
  err_msg  TEXT;
BEGIN
  -- ----- SEED (seeding/service-role context — bypasses RLS) ---------------
  -- Tenant A: auth.users -> profile(allocator) -> api_key -> per-key daily +
  -- a strategy with a strategy-scoped daily (to prove both axes coexist and the
  -- strategy-owner policy does not leak per-key rows).
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-perkey-rls-tenant-a@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'perkey-rls tenant a', 'test-perkey-rls-tenant-a@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_a, 'binance', 'perkey-rls A key', 'x') RETURNING id INTO key_a;

  INSERT INTO csv_daily_returns (api_key_id, allocator_id, date, daily_return)
  VALUES (key_a, uid_a, '2026-01-01', 0.0111);

  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'perkey-rls A strategy', 'published', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a;
  INSERT INTO csv_daily_returns (strategy_id, date, daily_return)
  VALUES (strat_a, '2026-01-01', 0.0222);

  -- Tenant B: auth.users -> profile(allocator) -> api_key -> per-key daily.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-perkey-rls-tenant-b@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'perkey-rls tenant b', 'test-perkey-rls-tenant-b@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_b, 'binance', 'perkey-rls B key', 'x') RETURNING id INTO key_b;

  INSERT INTO csv_daily_returns (api_key_id, allocator_id, date, daily_return)
  VALUES (key_b, uid_b, '2026-01-01', 0.0333);

  RAISE NOTICE 'Seed OK: A uid=% key=%, B uid=% key=%', uid_a, key_a, uid_b, key_b;

  -- ----- ASSERTION 1: A sees A's per-key row -----------------------------
  -- RED-UNDER: narrow the per-key owner policy in migration 20260624120000 to
  --            `allocator_id = auth.uid() AND strategy_id IS NOT NULL` — a per-key
  --            row has strategy_id NULL, so the policy stops matching the very
  --            rows it was added for. The policy still EXISTS, so the migration's
  --            own post-verify (:161) passes and the gate is the only thing that
  --            reddens. This arm is a positive control, but RLS withholds rows
  --            SILENTLY rather than raising, so the literal drift is observable.
  -- RED-UNDER-M: {"arm":"Assertion 1","apply":[{"kind":"edit","file":"supabase/migrations/20260624120000_csv_daily_returns_per_key_axis.sql","find":"  USING (allocator_id = auth.uid());","replace":"  USING (allocator_id = auth.uid() AND strategy_id IS NOT NULL);","occurrences":1}]}
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM csv_daily_returns WHERE api_key_id = key_a;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (Assertion 1): allocator A sees % of its own per-key rows, expected 1', row_cnt;
  END IF;

  -- ----- ASSERTION 2: A does NOT see B's per-key row (cross-tenant) -------
  -- RED-UNDER: add a SECOND permissive SELECT policy to the LIVE table admitting
  --            every per-key row to every authenticated session — the "the
  --            allocator dashboard needs to read these" drift. Added ALONGSIDE the
  --            correct policy, so Assertion 1 still sees exactly its own row and
  --            this cross-tenant arm is the first failure.
  -- RED-UNDER-M: {"arm":"Assertion 2","apply":[{"kind":"sql","stmt":"CREATE POLICY csv_daily_returns_perkey_open_select ON public.csv_daily_returns FOR SELECT TO authenticated USING (api_key_id IS NOT NULL)"}]}
  SELECT count(*) INTO row_cnt FROM csv_daily_returns WHERE api_key_id = key_b;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (Assertion 2): allocator A sees % of allocator B''s per-key rows, expected 0 — CROSS-TENANT LEAK', row_cnt;
  END IF;

  -- ----- ASSERTION 3: strategy-owner policy still works for A's strategy --
  -- RED-UNDER: DROP the strategy-owner SELECT policy from the LIVE table
  --            (`csv_daily_returns_owner_select`, 20260522111839:70) — the policy
  --            20260624120000's header promises it LEFT UNTOUCHED. A `sql` step,
  --            because that policy is defined in a migration this gate's apply list
  --            carries only as a prerequisite, and dropping it there would abort
  --            its own post-verify.
  -- RED-UNDER-M: {"arm":"Assertion 3","apply":[{"kind":"sql","stmt":"DROP POLICY csv_daily_returns_owner_select ON public.csv_daily_returns"}]}
  SELECT count(*) INTO row_cnt FROM csv_daily_returns WHERE strategy_id = strat_a;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (Assertion 3): allocator A sees % of its own strategy-scoped rows, expected 1 — strategy-owner policy regressed', row_cnt;
  END IF;
  RESET ROLE;

  -- ----- ASSERTION 4: B sees B's per-key row, never A's ------------------
  -- RED-UNDER: shut the per-key owner policy on the LIVE table with
  --            `ALTER POLICY … USING (false)` — the policy row survives, so the
  --            migration post-verify and any "does the policy exist" check still
  --            agree, and only a CONTENT assertion can see it.
  -- ⚠️ NEEDS A `neuter`. Assertions 1 and 4a are the SAME property read from two
  --            tenants — an allocator sees its own per-key row — so nothing that
  --            reddens 4a can leave 1 green. Assertion 1's raise is neutered on
  --            THIS arm's lane only; it carries its own twin above and is judged
  --            on its own lane.
  -- RED-UNDER-M: {"arm":"Assertion 4a","apply":[{"kind":"sql","stmt":"ALTER POLICY csv_daily_returns_allocator_owner_select ON public.csv_daily_returns USING (false)"}],"neuter":[{"arm":"Assertion 1"}]}
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM csv_daily_returns WHERE api_key_id = key_b;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (Assertion 4a): allocator B sees % of its own per-key rows, expected 1', row_cnt;
  END IF;
  SELECT count(*) INTO row_cnt FROM csv_daily_returns WHERE api_key_id = key_a;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (Assertion 4b): allocator B sees % of allocator A''s per-key rows, expected 0 — CROSS-TENANT LEAK', row_cnt;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ----- ASSERTION 5: anon sees 0 per-key rows --------------------------
  -- The policy is TO authenticated; anon either lacks the grant (42501) or RLS
  -- returns 0. Either way anon must not read per-key data. Treat 42501 as 0.
  -- RED-UNDER: add a `TO anon` SELECT policy to the LIVE table — the logged-out
  --            "public performance page" drift. Scoped to anon, so Assertions 1-4
  --            read as `authenticated` and still bite. ⭐ This arm can only redden
  --            because 07-fixture-supabase-default-privileges.sql gave anon the
  --            table grant it holds in production: without it anon answers 42501,
  --            the gate's own handler reads that as 0 rows, and no policy drift is
  --            visible at all.
  -- RED-UNDER-M: {"arm":"Assertion 5","apply":[{"kind":"sql","stmt":"CREATE POLICY csv_daily_returns_anon_open_select ON public.csv_daily_returns FOR SELECT TO anon USING (true)"}]}
  SET LOCAL ROLE anon;
  raised := FALSE;
  BEGIN
    SELECT count(*) INTO row_cnt FROM csv_daily_returns WHERE api_key_id IN (key_a, key_b);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; row_cnt := 0;
  END;
  RESET ROLE;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 5): anon sees % per-key rows, expected 0', row_cnt;
  END IF;

  -- ----- ASSERTION 6: owner-coherence trigger rejects mismatched owner ---
  -- Back in the seeding (service-role) context. A per-key row whose allocator_id
  -- is not the api_key's owner must be rejected by the BEFORE trigger.
  -- RED-UNDER: DROP the owner-coherence trigger from the LIVE table. A `sql` step:
  --            migration 20260624120000's post-verify (:166) re-reads pg_trigger
  --            for this exact trigger, so an edit removing it aborts the apply and
  --            never reaches the gate.
  -- RED-UNDER-M: {"arm":"Assertion 6","apply":[{"kind":"sql","stmt":"DROP TRIGGER csv_daily_returns_owner_coherence ON public.csv_daily_returns"}]}
  raised := FALSE;
  BEGIN
    INSERT INTO csv_daily_returns (api_key_id, allocator_id, date, daily_return)
    VALUES (key_a, uid_b, '2026-01-02', 0.01);  -- key_a owned by A, allocator_id=B
  EXCEPTION WHEN raise_exception THEN
    raised := TRUE; err_state := SQLSTATE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 6): a per-key row with allocator_id != api_keys.user_id was ACCEPTED — owner-coherence trigger missing or loosened';
  END IF;
  -- Pin the OWNER-MISMATCH arm specifically. The trigger has two RAISE arms
  -- (FK-missing + allocator-mismatch); key_a is a valid FK, so only the mismatch
  -- arm can fire here. Asserting the message keeps the test honest if a future
  -- refactor makes the trigger raise for the wrong reason.
  IF err_msg NOT LIKE '%must match api_keys.user_id%' THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 6): trigger raised the WRONG arm (expected owner-mismatch, got: %)', err_msg;
  END IF;

  -- ----- ASSERTION 7: source XOR rejects a both-set row -----------------
  -- RED-UNDER: DROP the csv_daily_returns_source_xor CHECK from the LIVE table, so
  --            a row can name BOTH axes at once. A `sql` step for the same reason
  --            as Assertion 6: post-verify (:145) re-reads the constraint by name.
  -- RED-UNDER-M: {"arm":"Assertion 7","apply":[{"kind":"sql","stmt":"ALTER TABLE public.csv_daily_returns DROP CONSTRAINT csv_daily_returns_source_xor"}]}
  raised := FALSE;
  BEGIN
    INSERT INTO csv_daily_returns (strategy_id, api_key_id, allocator_id, date, daily_return)
    VALUES (strat_a, key_a, uid_a, '2026-01-03', 0.01);
  EXCEPTION WHEN check_violation THEN
    raised := TRUE; err_state := SQLSTATE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 7): a row setting BOTH strategy_id and api_key_id was ACCEPTED — source XOR check missing or loosened';
  END IF;

  RAISE NOTICE 'All csv_daily_returns per-key RLS + coherence assertions passed (tenant isolation intact).';

  -- ----- TEARDOWN -------------------------------------------------------
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);
END
$$;

-- --------------------------------------------------------------------------
-- Defensive post-clean (if an assertion aborted, the seed rows would survive).
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-perkey-rls-tenant-a@quantalyze.test',
    'test-perkey-rls-tenant-b@quantalyze.test'
  );
