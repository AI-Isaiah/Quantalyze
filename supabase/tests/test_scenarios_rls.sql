-- Test for Migration 20260621120000_scenarios_table_and_rls.sql — scenarios RLS.
-- Phase 23 / Plan 23-01 (PERSIST-01).
--
-- scenarios_owner is FOR ALL with USING + WITH CHECK keyed on
-- `allocator_id = auth.uid()`. RLS FAILS SILENTLY — a loosened predicate (or a
-- dropped policy) ships with no error unless an integration test connects AS
-- one tenant and asserts on cross-tenant CONTENT (specific row id), not on
-- pg_policies presence. This file is that honesty test.
--
-- pgTAP is NOT installed in this project (see CLAUDE.md / Lane B audit), so it
-- uses the same plain PL/pgSQL convention as the other supabase/tests/
-- test_*.sql files: `DO $$ ... $$` blocks with `RAISE EXCEPTION` on failure and
-- `RAISE NOTICE` on assertion pass. No pgTAP, and no psql backslash
-- meta-commands (the sql-tests preflight rejects shell-out / copy / output
-- redirection meta-commands). Under `psql -v ON_ERROR_STOP=1`
-- (what .github/workflows/ci.yml `sql-tests` runs) a failed assertion exits
-- non-zero and fails the job.
--
-- Filename matches ci.yml's `test_*.sql` glob so the job auto-discovers it
-- against the test project (with the migration applied).
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_scenarios_rls.sql
--
-- The test seeds two synthetic tenants (A and B) end-to-end:
--   auth.users -> profiles -> scenarios
-- (no api_keys/strategies needed — scenarios references profiles directly via
-- allocator_id), forges request.jwt.claims so auth.uid() resolves to each
-- tenant, switches role to `authenticated`, and asserts the owner policy by
-- cross-tenant row id (read + negative write) plus the positive own-row path.

-- --------------------------------------------------------------------------
-- Defensive pre-clean. If a prior run aborted between seed and teardown the
-- synthetic profile rows may still be present. ON DELETE CASCADE chains
-- auth.users -> profiles -> scenarios, so deleting the auth.users row by email
-- drops everything below.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-scen-rls-tenant-a@quantalyze.test',
    'test-scen-rls-tenant-b@quantalyze.test'
  );

DO $$
DECLARE
  -- Tenant A
  uid_a       UUID := gen_random_uuid();
  scen_a_id   UUID;
  -- Tenant B
  uid_b       UUID := gen_random_uuid();
  scen_b_id   UUID;
  -- Assertion scratch
  visible_cnt INTEGER;
  affected    INTEGER;
  b_name      TEXT;
BEGIN
  -- ----- SEED (service role / superuser context — bypasses RLS) ----------

  -- Tenant A: auth.users row, profile, one scenarios row.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-scen-rls-tenant-a@quantalyze.test', now(), now());

  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'scen-rls tenant a', 'test-scen-rls-tenant-a@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (uid_a, 'tenant a scenario', '{"k":"a"}'::jsonb, 1)
  RETURNING id INTO scen_a_id;

  -- Tenant B: same shape, separate tenant.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-scen-rls-tenant-b@quantalyze.test', now(), now());

  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'scen-rls tenant b', 'test-scen-rls-tenant-b@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (uid_b, 'tenant b scenario', '{"k":"b"}'::jsonb, 1)
  RETURNING id INTO scen_b_id;

  RAISE NOTICE 'Seed OK: tenant A=% scen=%, tenant B=% scen=%',
    uid_a, scen_a_id, uid_b, scen_b_id;

  -- ----- ASSERTION 1: service role / superuser sees BOTH rows -----------
  -- Sanity check that we seeded what we think we seeded.
  SELECT COUNT(*) INTO visible_cnt FROM scenarios
    WHERE id IN (scen_a_id, scen_b_id);
  IF visible_cnt <> 2 THEN
    RAISE EXCEPTION
      'TEST FAILED (sanity): service-role SELECT returned % rows, expected 2', visible_cnt;
  END IF;
  RAISE NOTICE 'Assertion 1 OK: service-role sees both seeded scenarios rows.';

  -- ----- ASSERTION 2: tenant A SELECT returns own row only --------------
  -- Forge the JWT sub claim so auth.uid() resolves to uid_a for this
  -- transaction, then drop to the authenticated role so RLS applies.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;

  -- Tenant A must see exactly its own row over the seeded set, not 2.
  SELECT COUNT(*) INTO visible_cnt FROM scenarios
    WHERE id IN (scen_a_id, scen_b_id);
  IF visible_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (Assertion 2): tenant A SELECT returned % rows over seeded set, expected 1 (cross-tenant leak)', visible_cnt;
  END IF;

  -- And specifically: A's own row, not B's — content assertion BY ROW ID.
  IF NOT EXISTS (SELECT 1 FROM scenarios WHERE id = scen_a_id) THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (Assertion 2): tenant A cannot see own scenario — read policy regressed';
  END IF;
  IF EXISTS (SELECT 1 FROM scenarios WHERE id = scen_b_id) THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (Assertion 2): tenant A can see tenant B scenario — CROSS-TENANT LEAK';
  END IF;
  RAISE NOTICE 'Assertion 2 OK: tenant A sees own row by id, cannot see tenant B row by id.';

  -- ----- ASSERTION 3: tenant A cannot tamper with tenant B's row --------
  -- The owner USING predicate filters B's row out of A's view entirely, so an
  -- UPDATE / DELETE targeting scen_b_id from tenant A's session affects 0 rows
  -- (no error — RLS silently scopes the write). Assert 0 rows affected, then
  -- (after RESET ROLE) verify B's row is byte-for-byte unchanged BY ROW ID.
  UPDATE scenarios SET name = 'hijacked' WHERE id = scen_b_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (Assertion 3): tenant A UPDATE of tenant B row affected % rows, expected 0 — CROSS-TENANT WRITE', affected;
  END IF;

  DELETE FROM scenarios WHERE id = scen_b_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (Assertion 3): tenant A DELETE of tenant B row affected % rows, expected 0 — CROSS-TENANT WRITE', affected;
  END IF;

  -- Ground-truth verification as service role: B's row is unchanged by id.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT name INTO b_name FROM scenarios WHERE id = scen_b_id;
  IF b_name IS NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 3): tenant B row missing after tenant A write attempt — CROSS-TENANT DELETE';
  END IF;
  IF b_name <> 'tenant b scenario' THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 3): tenant B name=% (expected unchanged "tenant b scenario") — CROSS-TENANT WRITE', b_name;
  END IF;
  RAISE NOTICE 'Assertion 3 OK: tenant A UPDATE/DELETE of tenant B row affected 0 rows; B row unchanged by id.';

  -- ----- ASSERTION 4: tenant A CAN update + delete its OWN row ----------
  -- Guards against an over-tight policy that would also block legitimate
  -- owner writes (the WITH CHECK must admit allocator_id = auth.uid()).
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;

  UPDATE scenarios SET name = 'tenant a renamed' WHERE id = scen_a_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (Assertion 4): tenant A UPDATE of own row affected % rows, expected 1 — owner policy over-tight', affected;
  END IF;

  DELETE FROM scenarios WHERE id = scen_a_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (Assertion 4): tenant A DELETE of own row affected % rows, expected 1 — owner policy over-tight', affected;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Confirm A's row is gone (service-role read) and B's row still present.
  IF EXISTS (SELECT 1 FROM scenarios WHERE id = scen_a_id) THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 4): tenant A own-row DELETE did not persist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM scenarios WHERE id = scen_b_id) THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 4): tenant B row vanished during tenant A own-row writes';
  END IF;
  RAISE NOTICE 'Assertion 4 OK: tenant A can update + delete its OWN row; tenant B row untouched.';

  -- ----- TEARDOWN -------------------------------------------------------
  -- ON DELETE CASCADE chains auth.users -> profiles -> scenarios. One delete
  -- per tenant cleans the whole subtree.
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);

  RAISE NOTICE 'All scenarios RLS assertions passed (scenarios_owner policy intact).';
END
$$;

-- --------------------------------------------------------------------------
-- Defensive post-clean. If an assertion above aborted with RAISE EXCEPTION the
-- seed rows would survive; run one more cleanup outside the DO block so
-- subsequent runs start clean.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-scen-rls-tenant-a@quantalyze.test',
    'test-scen-rls-tenant-b@quantalyze.test'
  );
