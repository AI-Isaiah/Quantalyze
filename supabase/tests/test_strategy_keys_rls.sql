-- Test for migration 20260710120000_strategy_keys.sql — the strategy_keys
-- composite-membership RLS + owner-coherence trigger. Phase 85 (COMP-01).
--
-- This is the phase's load-bearing tenant-isolation test. strategy_keys links a
-- strategy to N api_keys, each carrying a half-open [window_start, window_end)
-- window and a seq ordinal, gated by RLS `owner_id = auth.uid()` and an
-- owner-coherence BEFORE trigger. RLS FAILS SILENTLY — a loosened USING ships
-- GREEN unless a test inspects the returned rows by CONTENT (count / owner_id).
-- A test that asserts "a row came back" is not proof, nor is checking that a
-- policy exists in pg_policy. This file asserts:
--   * tenant A sees exactly A's rows and NEVER any of B's (cross-tenant);
--   * tenant B sees exactly B's row and NEVER any of A's;
--   * anon sees 0 rows (TO authenticated only + REVOKE anon);
--   * the owner-coherence trigger rejects owner_id != api_keys.user_id
--     (the '%must match%' arm, pinned), a cross-tenant strategy/key attach,
--     and a dangling api_key reference;
--   * the window CHECK rejects an empty half-open interval (window_end = start);
--   * the (strategy_id, seq) unique index rejects a duplicate seq;
--   * the RLS WITH CHECK blocks writing a row owned by another tenant.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands (the
-- sql-tests preflight rejects shell-out / copy / output redirection). Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. Filename matches the
-- `test_*.sql` glob so the job auto-discovers it against the test project (with
-- migration 20260710120000 applied).
--
-- Hygiene: all fixture work runs inside an explicit transaction that ends in
-- ROLLBACK, so the shared test DB is never polluted (no committed fixture rows).
-- The exception-trapped arms use nested BEGIN ... EXCEPTION (an implicit
-- savepoint) so a deliberately-failing INSERT does not abort the outer block.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_strategy_keys_rls.sql

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- ON DELETE CASCADE chains auth.users -> profiles -> {strategies, api_keys}
-- -> strategy_keys, so deleting auth.users by email drops the whole subtree.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-skeys-rls-tenant-a@quantalyze.test',
    'test-skeys-rls-tenant-b@quantalyze.test'
  );

BEGIN;

DO $$
DECLARE
  uid_a    UUID := gen_random_uuid();
  uid_b    UUID := gen_random_uuid();
  key_a    UUID;
  key_b    UUID;
  strat_a  UUID;
  strat_b  UUID;
  row_cnt  INTEGER;
  raised   BOOLEAN;
  err_msg  TEXT;
BEGIN
  -- ----- SEED (seeding/service-role context — bypasses RLS, fires trigger) --
  -- Tenant A: two member keys with distinct seq (0 closed window, 1 open-ended).
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-skeys-rls-tenant-a@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'skeys-rls tenant a', 'test-skeys-rls-tenant-a@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_a, 'binance', 'skeys-rls A key', 'x') RETURNING id INTO key_a;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'skeys-rls A strategy', 'published', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a;

  -- seq 0: closed half-open window [2025-08-01, 2025-10-01)
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
  VALUES (strat_a, key_a, uid_a, '2025-08-01', '2025-10-01', 0);
  -- seq 1: open-ended window [2025-10-01, ) — window_end NULL (still active)
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
  VALUES (strat_a, key_a, uid_a, '2025-10-01', NULL, 1);

  -- Tenant B: one member key.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-skeys-rls-tenant-b@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'skeys-rls tenant b', 'test-skeys-rls-tenant-b@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_b, 'binance', 'skeys-rls B key', 'x') RETURNING id INTO key_b;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_b, 'skeys-rls B strategy', 'published', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_b;

  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
  VALUES (strat_b, key_b, uid_b, '2025-08-01', NULL, 0);

  RAISE NOTICE 'Seed OK: A uid=% key=% strat=%, B uid=% key=% strat=%',
    uid_a, key_a, strat_a, uid_b, key_b, strat_b;

  -- ----- TRIGGER ARM 1: owner_id != api_keys.user_id → '%must match%' -------
  -- key_a is owned by A; owner_id=B is incoherent. FK is valid, so only the
  -- owner-mismatch arm can fire — the message must be pinned.
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_a, key_a, uid_b, '2026-01-01', NULL, 9);
  EXCEPTION WHEN raise_exception THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 1): a row with owner_id != api_keys.user_id was ACCEPTED — owner-coherence trigger missing or loosened';
  END IF;
  IF err_msg NOT LIKE '%must match%' THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 1): trigger raised the WRONG arm (expected owner-mismatch, got: %)', err_msg;
  END IF;

  -- ----- TRIGGER ARM 2: cross-tenant attach (strategy owner != key owner) ---
  -- owner_id=B coheres with key_b (owned B), but strat_a is owned by A.
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_a, key_b, uid_b, '2026-02-01', NULL, 8);
  EXCEPTION WHEN raise_exception THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 2): a cross-tenant strategy/key attach was ACCEPTED — owner-coherence trigger missing or loosened';
  END IF;
  IF err_msg NOT LIKE '%cross-tenant%' THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 2): trigger raised the WRONG arm (expected cross-tenant, got: %)', err_msg;
  END IF;

  -- ----- TRIGGER ARM 3: dangling api_key reference -------------------------
  -- A random api_key_id has no api_keys row; the BEFORE trigger resolves NULL
  -- owner and raises before the FK constraint is evaluated.
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_a, gen_random_uuid(), uid_a, '2026-03-01', NULL, 7);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 3): a row with a dangling api_key_id was ACCEPTED — dangling-reference guard missing';
  END IF;

  -- ----- CONSTRAINT ARM 4: empty half-open interval (window_end = start) ----
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_a, key_a, uid_a, '2025-08-01', '2025-08-01', 6);
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 4): window_end = window_start (empty half-open interval) was ACCEPTED — strategy_keys_window_order CHECK missing or loosened to >=';
  END IF;

  -- ----- CONSTRAINT ARM 5: duplicate (strategy_id, seq) -------------------
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_a, key_a, uid_a, '2026-04-01', NULL, 0);  -- seq 0 already used by A
  EXCEPTION WHEN unique_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 5): a duplicate (strategy_id, seq) was ACCEPTED — strategy_keys_strategy_seq_key unique index missing';
  END IF;

  -- ----- RLS 1: tenant A sees exactly A's 2 rows, 0 of B's ---------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM strategy_keys;
  IF row_cnt <> 2 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 1a): tenant A sees % strategy_keys rows, expected 2 (its own)', row_cnt;
  END IF;
  SELECT count(*) INTO row_cnt FROM strategy_keys WHERE owner_id = uid_b;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 1b): tenant A sees % of tenant B''s rows, expected 0 — CROSS-TENANT LEAK', row_cnt;
  END IF;
  RESET ROLE;

  -- ----- RLS 2: tenant B sees exactly B's 1 row, 0 of A's ---------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM strategy_keys;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 2a): tenant B sees % strategy_keys rows, expected 1 (its own)', row_cnt;
  END IF;
  SELECT count(*) INTO row_cnt FROM strategy_keys WHERE owner_id = uid_a;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 2b): tenant B sees % of tenant A''s rows, expected 0 — CROSS-TENANT LEAK', row_cnt;
  END IF;

  -- ----- RLS 3: WITH CHECK blocks writing another tenant's row ----------
  -- Still authenticated as tenant B. A coherent row (owner_id=B, key_b, strat_b)
  -- passes the trigger, but owner_id=A would violate WITH CHECK. Here we prove B
  -- cannot write a row owned by A (owner_id=A) — the trigger fires first on the
  -- owner-mismatch, or WITH CHECK blocks it; either way it MUST fail.
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_b, key_b, uid_a, '2026-05-01', NULL, 1);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 3): tenant B wrote a row with owner_id = tenant A — WITH CHECK / trigger not enforcing owner';
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ----- RLS 4: anon sees 0 rows ---------------------------------------
  -- Policy is TO authenticated + REVOKE anon; anon either lacks the grant
  -- (42501) or RLS returns 0. Either way anon must not read membership.
  SET LOCAL ROLE anon;
  raised := FALSE;
  BEGIN
    SELECT count(*) INTO row_cnt FROM strategy_keys;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; row_cnt := 0;
  END;
  RESET ROLE;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (RLS 4): anon sees % strategy_keys rows, expected 0', row_cnt;
  END IF;

  RAISE NOTICE 'test_strategy_keys_rls: ALL PASS (tenant isolation + owner coherence intact).';
END
$$;

ROLLBACK;
