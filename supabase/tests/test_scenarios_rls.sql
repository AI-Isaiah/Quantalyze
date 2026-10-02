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
-- ⭐ RED-UNDER ANNOTATIONS (Phase 164.4). Each assertion below carries a prose
-- `RED-UNDER:` naming the smallest production change that makes it fail, and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE it reds on its own arm, then restores
-- GREEN. Schema: scripts/mutation-runner/GRAMMAR.md. The line below declares
-- what the lane applies before this gate.
-- ⚠️ 07-fixture-supabase-default-privileges.sql IS LOAD-BEARING, NOT PADDING.
-- It reproduces Supabase's `ALTER DEFAULT PRIVILEGES … GRANT ALL … TO anon,
-- authenticated`, which is the very grant the migration's `REVOKE ALL ON
-- scenarios FROM anon` exists to take away. WITHOUT it, assertion 5's 42501
-- would be produced by anon never having HELD the grant — the same SQLSTATE for
-- a completely different reason, i.e. an arm that reports the REVOKE is
-- enforced on a lane where the REVOKE does nothing. Measured 2026-09-04: with
-- the fixture removed the file dies at assertion 2 with `permission denied for
-- table scenarios`, so the provisioning is checked, not assumed.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/13-fixture-csv-finalize-fold.sql","supabase/migrations/20260621120000_scenarios_table_and_rls.sql"]}
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
  raised      BOOLEAN;
  err_state   TEXT;
BEGIN
  -- ----- SEED (service role / superuser context — bypasses RLS) ----------

  -- Tenant A: auth.users row, profile, one scenarios row.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-scen-rls-tenant-a@quantalyze.test', now(), now());

  -- The on_auth_user_created trigger pre-creates the profile row (without a
  -- role) the instant the auth.users INSERT above commits its row trigger, so
  -- ON CONFLICT DO NOTHING would leave role NULL and never land 'allocator'.
  -- DO UPDATE the role + display_name (mirrors test_api_key_delete_atomicity).
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'scen-rls tenant a', 'test-scen-rls-tenant-a@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (uid_a, 'tenant a scenario', '{"k":"a"}'::jsonb, 1)
  RETURNING id INTO scen_a_id;

  -- Tenant B: same shape, separate tenant.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-scen-rls-tenant-b@quantalyze.test', now(), now());

  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'scen-rls tenant b', 'test-scen-rls-tenant-b@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (uid_b, 'tenant b scenario', '{"k":"b"}'::jsonb, 1)
  RETURNING id INTO scen_b_id;

  RAISE NOTICE 'Seed OK: tenant A=% scen=%, tenant B=% scen=%',
    uid_a, scen_a_id, uid_b, scen_b_id;

  -- ----- ASSERTION 1: service role / superuser sees BOTH rows -----------
  -- Sanity check that we seeded what we think we seeded.
  -- RED-UNDER: stop tenant B's scenario landing — replace its seed INSERT with
  --            `scen_b_id := NULL;`. Every assertion below is a statement ABOUT
  --            tenant B's row (A cannot see it, cannot write it, and it survives
  --            A's own-row writes), so a B row that was never created would make
  --            assertions 2, 3 and 4 pass while proving nothing. Refusing that
  --            is this arm's entire job, and it is the only arm that can.
  --            (Seed-targeting twin, same shape as `7i setup` in
  --            test_capital_ownership_allocation_guard.sql. No assertion,
  --            failure branch or identity is touched — GRAMMAR 3a/3b bind.)
  -- RED-UNDER-M: {"arm":"sanity","apply":[{"kind":"edit","file":"supabase/tests/test_scenarios_rls.sql","find":"  INSERT INTO scenarios (allocator_id, name, draft, schema_version)\n  VALUES (uid_b, 'tenant b scenario', '{\"k\":\"b\"}'::jsonb, 1)\n  RETURNING id INTO scen_b_id;\n","replace":"  scen_b_id := NULL;\n","occurrences":1}]}
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

  -- RED-UNDER: open the owner predicate — `USING (allocator_id = auth.uid())`
  --            becomes `USING (true)` in migration 20260621120000. RLS FAILS
  --            SILENTLY: no error, no log, every allocator's scenario drafts
  --            readable by every other. Only a cross-tenant CONTENT assertion
  --            like this one notices, which is why the header refuses a
  --            pg_policies presence check.
  -- RED-UNDER-M: {"arm":"Assertion 2","apply":[{"kind":"edit","file":"supabase/migrations/20260621120000_scenarios_table_and_rls.sql","find":"  USING (allocator_id = auth.uid())\n  WITH CHECK (allocator_id = auth.uid());","replace":"  USING (true)\n  WITH CHECK (allocator_id = auth.uid());","occurrences":1}]}
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
  -- RED-UNDER: open the owner predicate — `USING (allocator_id = auth.uid())`
  --            becomes `USING (true)` in migration 20260621120000, and its
  --            WITH CHECK with it — MEASURED: leaving the WITH CHECK owner-
  --            scoped makes A's UPDATE of B's row raise 42501 `new row
  --            violates row-level security policy`, a raw error carrying no
  --            arm identity at all (`NO-IDENTITY` on the lane). A can then
  --            UPDATE and DELETE tenant B's row, which is the cross-tenant
  --            WRITE this arm exists to refuse.
  --            NEUTERS Assertion 2 (all three of its raises) — required, and
  --            the reason is a MEASURED property of PostgreSQL, not a
  --            convenience: an UPDATE or DELETE carrying a WHERE clause needs
  --            SELECT privileges, so the SELECT policies are applied to it too.
  --            A predicate loose enough for A to WRITE B's row is therefore
  --            necessarily loose enough for A to READ it, and assertion 2 fires
  --            first. MEASURED 2026-09-04: a write-only `FOR UPDATE USING
  --            (true)` policy added BESIDE the owner one leaves this arm GREEN
  --            (`NO-RED` on the lane) for exactly that reason — the read
  --            predicate, not the write one, is what selects the row.
  --            So this arm is defence in depth BEHIND assertion 2, and the
  --            neuter is what lets it say so out loud rather than look
  --            unfalsifiable.
  -- RED-UNDER-M: {"arm":"Assertion 3","apply":[{"kind":"edit","file":"supabase/migrations/20260621120000_scenarios_table_and_rls.sql","find":"  USING (allocator_id = auth.uid())\n  WITH CHECK (allocator_id = auth.uid());","replace":"  USING (true)\n  WITH CHECK (true);","occurrences":1}],"neuter":[{"arm":"Assertion 2"},{"arm":"Assertion 2"},{"arm":"Assertion 2"}]}
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

  -- RED-UNDER: narrow the owner policy to reads — `FOR ALL` becomes
  --            `FOR SELECT` (and its WITH CHECK goes, which FOR SELECT does not
  --            accept) in migration 20260621120000. Every NEGATIVE assertion
  --            above still passes: A still sees only its own row, and A's writes
  --            to B's row still affect 0 rows — MORE tightly than before. An
  --            over-tight policy is invisible to a leak test, and silently
  --            breaks every legitimate owner edit in the product.
  -- RED-UNDER-M: {"arm":"Assertion 4","apply":[{"kind":"edit","file":"supabase/migrations/20260621120000_scenarios_table_and_rls.sql","find":"  FOR ALL\n  TO authenticated\n  USING (allocator_id = auth.uid())\n  WITH CHECK (allocator_id = auth.uid());","replace":"  FOR SELECT\n  TO authenticated\n  USING (allocator_id = auth.uid());","occurrences":1}]}
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

  -- ----- ASSERTION 5: anon (no forged jwt) cannot read scenarios --------
  -- Defense-in-depth: migration 20260621120000 REVOKEs ALL on scenarios from
  -- anon, so a SELECT as the anon role lacks the table-level grant entirely —
  -- it raises permission_denied (ERRCODE 42501) BEFORE RLS row-filtering even
  -- applies. (With NO forged request.jwt.claims, auth.uid() is also NULL, so the
  -- scenarios_owner predicate would deny every row even if the grant survived —
  -- but the REVOKE makes the grant layer the binding constraint here.) Pin the
  -- exception so a future re-GRANT to anon (which would re-expose the rows to
  -- the RLS-only gate) fails this test loudly. Note tenant B's row still exists
  -- here (A only deleted its own in Assertion 4), so a missing REVOKE would let
  -- anon SELECT a real row — exactly the leak this guards.
  PERFORM set_config('request.jwt.claims', NULL, true);
  SET LOCAL ROLE anon;

  -- RED-UNDER: grant anon SELECT back on the table. Expressed as a live `sql`
  --            step rather than an edit because the migration's own
  --            `REVOKE ALL ON scenarios FROM anon` is the pinned posture — the
  --            drift being modelled is a LATER migration (or a Supabase default
  --            ACL) re-granting it, not this file changing.
  --            anon then reaches the RLS layer instead of the grant layer, where
  --            the owner policy is `TO authenticated` and simply returns zero
  --            rows — no error at all. `raised` stays FALSE and this arm reds,
  --            which is precisely the both-layers claim it is here to make.
  -- RED-UNDER-M: {"arm":"Assertion 5","apply":[{"kind":"sql","stmt":"GRANT SELECT ON public.scenarios TO anon"}]}
  raised := FALSE;
  BEGIN
    -- A bare existence check is enough to trip the table-level grant gate.
    PERFORM 1 FROM scenarios WHERE id = scen_b_id;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;

  RESET ROLE;

  IF NOT raised THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 5): anon SELECT on scenarios SUCCEEDED — the REVOKE ALL FROM anon (migration 20260621120000) was not applied or was re-granted. anon must be blocked at the grant layer.';
  END IF;
  IF err_state <> '42501' THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 5): anon SELECT raised %, expected 42501 (insufficient_privilege from the table-level REVOKE)', err_state;
  END IF;
  RAISE NOTICE 'Assertion 5 OK: anon SELECT on scenarios rejected with ERRCODE 42501 (REVOKE ALL FROM anon enforced).';

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
