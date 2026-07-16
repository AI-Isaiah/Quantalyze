-- Test for the Phase 110 CONTRIB private-by-default DB unit:
--   * 20260716130000_strategies_status_private.sql (status CHECK admits 'private')
--   * 20260716130500_finalize_terminal_status_param.sql (guarded p_terminal_status)
-- CONTRIB-04 (RLS layer) + CONTRIB-02 (never-published invariant, DB layer).
--
-- What this asserts, and why by CONTENT not by error
-- --------------------------------------------------
-- strategies_read RLS = `status='published' OR user_id=auth.uid()`
-- (20260405061912_rls_policies.sql:28-30). RLS FAILS SILENTLY — a loosened USING
-- ships GREEN unless a test inspects the returned rows by CONTENT (count). A test
-- that asserts "a row came back" is not proof, nor is checking a policy exists in
-- pg_policy. Every assertion below is a count scoped to a SPECIFIC fixture id
-- (never a global count — the shared test DB carries other strategies), so no
-- assertion can pass vacuously on an empty set.
--
-- This file asserts, in BOTH directions:
--   1. owner B sees ZERO rows for owner A's status='private' strategy (isolation);
--   2. owner B DOES see owner A's status='published' control row (proves the
--      session switch works and the 0 in (1) is isolation, not a broken harness);
--   3. owner A sees its OWN status='private' strategy (owner-positive control);
--   4. anon sees ZERO rows for the status='private' strategy;
--   5. GUARD PIN (CONTRIB-02 / T-110-02): finalize_wizard_strategy called with
--      p_terminal_status => 'published' RAISEs — 'published' is unreachable from
--      any finalize caller. Pins the never-published invariant at the DB layer.
--
-- The private-row INSERT is ALSO the CHECK-widen probe: it fails loudly with a
-- check_violation (23514) if 20260716130000 is not applied — this test is
-- RED-guarded on migration A.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands. Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. Filename matches the
-- `test_*.sql` glob so the job auto-discovers it against the test project (with
-- migrations 20260716130000 + 20260716130500 applied).
--
-- Hygiene: all fixture work runs inside an explicit transaction that ends in
-- ROLLBACK, so the shared test DB is never polluted (no committed fixture rows).
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_strategies_private_owner_isolation.sql

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- ON DELETE CASCADE chains auth.users -> profiles -> strategies, so deleting
-- auth.users by email drops the whole subtree.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-contrib-private-owner-a@quantalyze.test',
    'test-contrib-private-owner-b@quantalyze.test'
  );

BEGIN;

DO $$
DECLARE
  uid_a          UUID := gen_random_uuid();
  uid_b          UUID := gen_random_uuid();
  strat_private  UUID;  -- owned by A, status='private'
  strat_pub      UUID;  -- owned by A, status='published' (control)
  strat_draft    UUID;  -- owned by A, wizard draft (for the guard-pin call)
  row_cnt        INTEGER;
  raised         BOOLEAN;
  err_msg        TEXT;
BEGIN
  -- ----- SEED (seeding/service-role context — bypasses RLS) ----------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-contrib-private-owner-a@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'contrib-private owner a', 'test-contrib-private-owner-a@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-contrib-private-owner-b@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'contrib-private owner b', 'test-contrib-private-owner-b@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  -- Owner A's private strategy. This INSERT is the CHECK-widen probe: it throws
  -- 23514 (check_violation) if migration 20260716130000 is not applied.
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'contrib-private A private', 'private', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_private;

  -- Owner A's published control strategy.
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'contrib-private A published', 'published', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_pub;

  -- Owner A's wizard draft (source='wizard', status='draft') for the guard-pin
  -- finalize call. The guard is the FIRST statement in finalize_wizard_strategy,
  -- so it RAISEs before the draft is even read — the draft only needs to exist
  -- so the call is realistic.
  INSERT INTO strategies (user_id, name, status, source, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'contrib-private A draft', 'draft', 'wizard', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_draft;

  RAISE NOTICE 'Seed OK: A uid=% private=% pub=% draft=%, B uid=%',
    uid_a, strat_private, strat_pub, strat_draft, uid_b;

  -- ----- RLS 1: owner B sees 0 of owner A's PRIVATE row (isolation) ---------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM strategies WHERE id = strat_private;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 1): owner B sees % rows for owner A''s private strategy, expected 0 — CROSS-OWNER LEAK', row_cnt;
  END IF;

  -- ----- RLS 2: owner B DOES see owner A's PUBLISHED control (harness proof) -
  -- Without this, RLS 1 could pass simply because the session switch is broken
  -- and B sees nothing at all. A published row MUST be visible to B.
  SELECT count(*) INTO row_cnt FROM strategies WHERE id = strat_pub;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 2): owner B sees % rows for owner A''s PUBLISHED control, expected 1 — session switch broken or published-read regressed', row_cnt;
  END IF;
  RESET ROLE;

  -- ----- RLS 3: owner A sees its OWN private row (owner-positive control) ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM strategies WHERE id = strat_private;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 3): owner A sees % rows for its OWN private strategy, expected 1 — owner-visibility regressed', row_cnt;
  END IF;

  -- ----- GUARD 5: finalize_wizard_strategy rejects p_terminal_status='published'
  -- Still authenticated as owner A (auth.uid() = uid_a matches p_user_id). The
  -- p_terminal_status guard is the FIRST body statement, so it RAISEs before the
  -- owner/source/draft gauntlet or the strategies UPDATE. 'published' is
  -- unreachable from any finalize caller (T-110-02).
  raised := FALSE;
  BEGIN
    PERFORM finalize_wizard_strategy(
      strat_draft,          -- p_strategy_id
      uid_a,                -- p_user_id
      'contrib-private A draft',  -- p_name
      NULL,                 -- p_description
      NULL,                 -- p_category_id
      ARRAY[]::text[],      -- p_strategy_types
      ARRAY[]::text[],      -- p_subtypes
      ARRAY[]::text[],      -- p_markets
      ARRAY[]::text[],      -- p_supported_exchanges
      NULL,                 -- p_leverage_range
      NULL,                 -- p_aum
      NULL,                 -- p_max_capacity
      'published'           -- p_terminal_status  <-- MUST be rejected
    );
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (GUARD 5): finalize_wizard_strategy ACCEPTED p_terminal_status=published — never-published invariant broken';
  END IF;
  IF err_msg NOT LIKE '%p_terminal_status%' OR err_msg NOT LIKE '%not allowed%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (GUARD 5): finalize_wizard_strategy raised the WRONG error (expected the p_terminal_status guard, got: %)', err_msg;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ----- RLS 4: anon sees 0 of owner A's PRIVATE row -----------------------
  -- anon can SELECT strategies (the public /browse catalog reads published rows
  -- as anon), but strategies_read filters to published-only for a session with
  -- no auth.uid(). The private row must be invisible.
  SET LOCAL ROLE anon;
  raised := FALSE;
  BEGIN
    SELECT count(*) INTO row_cnt FROM strategies WHERE id = strat_private;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; row_cnt := 0;
  END;
  RESET ROLE;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (RLS 4): anon sees % rows for owner A''s private strategy, expected 0', row_cnt;
  END IF;

  RAISE NOTICE 'test_strategies_private_owner_isolation: ALL PASS (cross-owner isolation + never-published guard intact).';
END
$$;

ROLLBACK;
