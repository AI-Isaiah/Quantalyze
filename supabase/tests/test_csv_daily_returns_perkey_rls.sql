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
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM csv_daily_returns WHERE api_key_id = key_a;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (Assertion 1): allocator A sees % of its own per-key rows, expected 1', row_cnt;
  END IF;

  -- ----- ASSERTION 2: A does NOT see B's per-key row (cross-tenant) -------
  SELECT count(*) INTO row_cnt FROM csv_daily_returns WHERE api_key_id = key_b;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (Assertion 2): allocator A sees % of allocator B''s per-key rows, expected 0 — CROSS-TENANT LEAK', row_cnt;
  END IF;

  -- ----- ASSERTION 3: strategy-owner policy still works for A's strategy --
  SELECT count(*) INTO row_cnt FROM csv_daily_returns WHERE strategy_id = strat_a;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (Assertion 3): allocator A sees % of its own strategy-scoped rows, expected 1 — strategy-owner policy regressed', row_cnt;
  END IF;
  RESET ROLE;

  -- ----- ASSERTION 4: B sees B's per-key row, never A's ------------------
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
  raised := FALSE;
  BEGIN
    INSERT INTO csv_daily_returns (api_key_id, allocator_id, date, daily_return)
    VALUES (key_a, uid_b, '2026-01-02', 0.01);  -- key_a owned by A, allocator_id=B
  EXCEPTION WHEN raise_exception THEN
    raised := TRUE; err_state := SQLSTATE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Assertion 6): a per-key row with allocator_id != api_keys.user_id was ACCEPTED — owner-coherence trigger missing or loosened';
  END IF;

  -- ----- ASSERTION 7: source XOR rejects a both-set row -----------------
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
