-- Test: allocator_equity_derived RLS — owner SELECT / cross-tenant deny / anon
-- deny / authenticated write deny / service-role atomic replace. Guards
-- migration 20260717233529_allocator_equity_derived_surface.sql (Phase 115.1 /
-- BACKBONE-02, T-115.1-04).
--
-- allocator_equity_derived holds derived per-key flow USD magnitudes + the
-- derived $-curve — money data. RLS is the ONLY gate on it for the SSR read
-- (the authenticated owner client, queries.ts:2505-2510 sequential auth assert).
-- RLS FAILS SILENTLY — a loosened predicate ships GREEN unless a test inspects
-- the returned rows by CONTENT. A test that asserts "a row came back" is not
-- proof. This file asserts, by content:
--   * owner A sees A's own row, NEVER B's (cross-tenant deny);
--   * owner B sees B's own row, NEVER A's;
--   * anon sees 0 rows (no anon policy);
--   * authenticated cannot INSERT/UPDATE/DELETE (worker is sole writer via
--     service_role) — verified by the table state being UNCHANGED afterwards,
--     robust to whether the denial surfaces as 42501 or a 0-row no-op;
--   * a service-role (RLS-bypass) upsert on (allocator_id, kind) conflict is a
--     single-row atomic REPLACE (the strategy_analytics_series atomicity
--     precedent), not a second row.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block with RAISE
-- EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands (the
-- sql-tests preflight rejects shell-out / copy / output redirection). Under
-- psql -v ON_ERROR_STOP=1 (what .github/workflows/ci.yml sql-tests runs) a
-- failed assertion exits non-zero and fails the job. The whole test rolls back.
--
-- Test-DB lag: the shared test DB tracks prod but lags main, so on a PR branch
-- the migration may not be applied yet. The assertions are gated on the table
-- being present (NOTICE skip otherwise) so this becomes a hard regression guard
-- once the test DB catches up (the migration is MCP-applied to the TEST project
-- before this runs) without red-failing pre-apply.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_allocator_equity_derived_rls.sql

BEGIN;

DO $$
DECLARE
  uid_a    UUID := gen_random_uuid();
  uid_b    UUID := gen_random_uuid();
  row_cnt  INTEGER;
  raised   BOOLEAN;
  v_payload JSONB;
BEGIN
  -- ----- presence gate (test-DB lag) -------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'allocator_equity_derived'
  ) THEN
    RAISE NOTICE 'SKIP: migration 20260717233529 not yet applied here (allocator_equity_derived absent). Assertions enforce once the test DB catches up.';
    RETURN;
  END IF;

  -- ----- SEED (service-role / RLS-bypass connection context) -------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'aed-rls-a-' || uid_a::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'aed-rls a', 'aed-rls-a-' || uid_a::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'aed-rls-b-' || uid_b::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'aed-rls b', 'aed-rls-b-' || uid_b::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO allocator_equity_derived (allocator_id, kind, payload)
  VALUES (uid_a, 'equity_curve',
          '{"curve": [{"date":"2026-01-01","equity_usd":100.0}], "is_trustworthy": true}'::jsonb);
  INSERT INTO allocator_equity_derived (allocator_id, kind, payload)
  VALUES (uid_b, 'equity_curve',
          '{"curve": [{"date":"2026-01-01","equity_usd":200.0}], "is_trustworthy": true}'::jsonb);

  RAISE NOTICE 'Seed OK: A=% B=%', uid_a, uid_b;

  -- ----- ASSERTION 1: A sees A's own row ---------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM allocator_equity_derived WHERE allocator_id = uid_a;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (1): owner A sees % of its own rows, expected 1', row_cnt;
  END IF;

  -- ----- ASSERTION 2: A does NOT see B's row (cross-tenant) ---------------
  SELECT count(*) INTO row_cnt FROM allocator_equity_derived WHERE allocator_id = uid_b;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): owner A sees % of owner B''s rows, expected 0 — CROSS-TENANT LEAK', row_cnt;
  END IF;
  RESET ROLE;

  -- ----- ASSERTION 3: B sees B's own row, never A's ----------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM allocator_equity_derived WHERE allocator_id = uid_b;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (3a): owner B sees % of its own rows, expected 1', row_cnt;
  END IF;
  SELECT count(*) INTO row_cnt FROM allocator_equity_derived WHERE allocator_id = uid_a;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (3b): owner B sees % of owner A''s rows, expected 0 — CROSS-TENANT LEAK', row_cnt;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ----- ASSERTION 4: anon sees 0 rows -----------------------------------
  -- No anon policy exists; anon either lacks the grant (42501) or RLS returns
  -- 0. Either way anon must not read derived money data. Treat 42501 as 0.
  SET LOCAL ROLE anon;
  raised := FALSE;
  BEGIN
    SELECT count(*) INTO row_cnt FROM allocator_equity_derived
     WHERE allocator_id IN (uid_a, uid_b);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; row_cnt := 0;
  END;
  RESET ROLE;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (4): anon sees % rows, expected 0', row_cnt;
  END IF;

  -- ----- ASSERTION 5: authenticated CANNOT write (worker is sole writer) --
  -- Content-based: attempt INSERT/UPDATE/DELETE as authenticated A, swallow any
  -- error, then verify (as the bypass role) that A's table state is UNCHANGED.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 5a INSERT a new kind row — MUST be denied (a success would be a write leak).
  raised := FALSE;
  BEGIN
    INSERT INTO allocator_equity_derived (allocator_id, kind, payload)
    VALUES (uid_a, 'key_inputs:leak', '{"leak": true}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    -- The INSERT did not raise; the row (if any) is caught by the content check
    -- below, but a silent-accept here is already a policy failure to surface.
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (5a): authenticated INSERT was NOT denied — owner write policy leaked';
  END IF;

  -- 5b UPDATE own row — no UPDATE policy → 0 rows or error; either is fine.
  BEGIN
    UPDATE allocator_equity_derived
       SET payload = '{"tampered": true}'::jsonb
     WHERE allocator_id = uid_a AND kind = 'equity_curve';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 5c DELETE own row — no DELETE policy → 0 rows or error; either is fine.
  BEGIN
    DELETE FROM allocator_equity_derived
     WHERE allocator_id = uid_a AND kind = 'equity_curve';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Content verification (bypass role): A still has exactly its original row.
  SELECT count(*) INTO row_cnt FROM allocator_equity_derived WHERE allocator_id = uid_a;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (5): after authenticated writes, A has % rows, expected 1 (unchanged)', row_cnt;
  END IF;
  SELECT payload INTO v_payload FROM allocator_equity_derived
   WHERE allocator_id = uid_a AND kind = 'equity_curve';
  IF v_payload IS NULL OR (v_payload ? 'tampered') THEN
    RAISE EXCEPTION 'TEST FAILED (5): A''s row was tampered by an authenticated UPDATE — write policy leaked';
  END IF;
  IF EXISTS (SELECT 1 FROM allocator_equity_derived WHERE allocator_id = uid_a AND kind = 'key_inputs:leak') THEN
    RAISE EXCEPTION 'TEST FAILED (5): an authenticated INSERT row persisted — write policy leaked';
  END IF;

  -- ----- ASSERTION 6: service-role upsert is atomic single-row replace ----
  -- Back in the bypass (service/superuser) context. A second upsert on the SAME
  -- (allocator_id, kind) REPLACES the row in place — never a second row.
  INSERT INTO allocator_equity_derived (allocator_id, kind, payload)
  VALUES (uid_a, 'equity_curve', '{"curve": [], "is_trustworthy": false, "v": 2}'::jsonb)
  ON CONFLICT (allocator_id, kind) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = now();

  SELECT count(*) INTO row_cnt FROM allocator_equity_derived
   WHERE allocator_id = uid_a AND kind = 'equity_curve';
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (6): upsert produced % rows for (A, equity_curve), expected 1 (atomic replace)', row_cnt;
  END IF;
  SELECT payload INTO v_payload FROM allocator_equity_derived
   WHERE allocator_id = uid_a AND kind = 'equity_curve';
  IF (v_payload ->> 'v') IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'TEST FAILED (6): upsert did not replace the payload (got v=%)', COALESCE(v_payload ->> 'v', '<null>');
  END IF;

  RAISE NOTICE 'All allocator_equity_derived RLS + atomicity assertions passed (tenant isolation + write-lockout intact).';

  -- ----- TEARDOWN (belt-and-suspenders; the outer ROLLBACK also discards) -
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);
END
$$;

ROLLBACK;
