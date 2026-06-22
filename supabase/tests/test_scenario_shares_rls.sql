-- Test for Migration 20260622120000_scenario_shares_and_read_rpc.sql —
-- scenario_shares RLS + the get_shared_scenario SECURITY DEFINER read path.
-- Phase 25 / Plan 25-01 (SHARE-02, SHARE-03).
--
-- This is the phase's load-bearing honesty test. The share read path bypasses
-- RLS (SECURITY DEFINER) and is the SOLE anon/cross-tenant data path, so the
-- scoping lives INSIDE get_shared_scenario, not in a policy. Both RLS and a
-- SECURITY DEFINER body FAIL SILENTLY — a loosened predicate (an extra join, a
-- SELECT *, a forgotten revoked_at filter) ships GREEN unless a test inspects
-- the returned CONTENT by field. A test that asserts "the RPC returned a row"
-- or "the page returned 200" is NOT proof; it passes for the wrong reason
-- (RESEARCH §Pitfall 2). This file asserts:
--   * the returned payload carries ONLY the share's own scenario name/draft/
--     schema_version + its addedStrategies[].id PUBLISHED series, and NO key
--     matching api_key|allocated_amount|account_balance|value_usd (CONTENT-by-
--     field — the over-return / live-book leak guard, SHARE-02);
--   * an empty-addedStrategies draft resolves to series = [] (no holdings leak);
--   * an unknown token → 0 rows (→ 404);
--   * setting revoked_at = now() makes the SAME token return 0 rows immediately
--     (data-layer revoke immediacy, SHARE-03);
--   * tenant B's token resolves ONLY B's content, never A's (cross-tenant read);
--   * anon has NO direct SELECT on scenario_shares (42501, REVOKE ALL FROM anon);
--   * tenant A cannot revoke tenant B's share row (RLS silently scopes → 0 rows,
--     not 42501);
--   * CR-01: tenant A cannot MINT a share for tenant B's scenario — the
--     scenario_shares_owner WITH CHECK owner-coherence EXISTS clause rejects the
--     INSERT (42501) (layer 2);
--   * CR-01: even a force-inserted mis-owned share row (created_by=A pointing at
--     B's scenario, inserted from the RLS-bypassing seeding context) NEVER
--     resolves through get_shared_scenario — the RPC's owner-coherence join
--     predicate (s.allocator_id = sh.created_by) returns 0 rows (layer 3).
--
-- The token model is hash-in-Node (Plan 25-02 owns the digest): the RPC takes
-- p_token_hash TEXT (a precomputed sha256 hex). This test IS the digest caller
-- standing in for the route — it computes sha256 hex of its raw tokens itself
-- via encode(sha256(...),'hex') (pg14+ core sha256(bytea), no pgcrypto digest
-- extension needed) and stores ONLY the hash. The raw token never lands in a
-- column, exactly as the production route behaves.
--
-- pgTAP is NOT installed in this project (CLAUDE.md / Lane B audit), so this
-- uses the same plain PL/pgSQL convention as the other supabase/tests/
-- test_*.sql files: `DO $$ ... $$` blocks with `RAISE EXCEPTION` on failure and
-- `RAISE NOTICE` on assertion pass. No pgTAP, no psql backslash meta-commands
-- (the sql-tests preflight rejects shell-out / copy / output redirection). Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. Filename matches the
-- `test_*.sql` glob so the job auto-discovers it against the test project (with
-- migration 20260622120000 applied).
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_scenario_shares_rls.sql
--
-- The test seeds two synthetic tenants (A and B) end-to-end:
--   auth.users -> profiles -> strategies(published) -> strategy_analytics
--                          -> scenarios -> scenario_shares
-- forges request.jwt.claims so auth.uid() resolves to each tenant where RLS is
-- exercised, and otherwise runs as the seeding (service-role/superuser) context
-- to call get_shared_scenario (the page invokes it via the service_role
-- transport, so the test calls it from the un-forged context).

-- --------------------------------------------------------------------------
-- Defensive pre-clean. If a prior run aborted between seed and teardown the
-- synthetic rows may still be present. ON DELETE CASCADE chains
-- auth.users -> profiles -> {strategies, scenarios} -> {strategy_analytics,
-- scenario_shares}, so deleting the auth.users row by email drops the subtree.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-share-rls-tenant-a@quantalyze.test',
    'test-share-rls-tenant-b@quantalyze.test'
  );

DO $$
DECLARE
  -- Tenant A
  uid_a        UUID := gen_random_uuid();
  strat_a_id   UUID;
  scen_a_id    UUID;       -- A's scenario WITH an added published strategy
  scen_a_empty_id UUID;    -- A's scenario with EMPTY addedStrategies
  share_a_id   UUID;       -- active share for scen_a_id
  share_a_empty_id UUID;   -- active share for scen_a_empty_id
  -- Tenant B
  uid_b        UUID := gen_random_uuid();
  strat_b_id   UUID;
  scen_b_id    UUID;
  share_b_id   UUID;
  -- Raw tokens (live only here, like the URL) + their stored sha256 hex hashes
  raw_a        TEXT := 'raw-share-token-tenant-a-' || gen_random_uuid()::text;
  raw_a_empty  TEXT := 'raw-share-token-tenant-a-empty-' || gen_random_uuid()::text;
  raw_b        TEXT := 'raw-share-token-tenant-b-' || gen_random_uuid()::text;
  hash_a       TEXT;
  hash_a_empty TEXT;
  hash_b       TEXT;
  -- Assertion scratch
  r            RECORD;
  row_cnt      INTEGER;
  affected     INTEGER;
  series_text  TEXT;
  draft_text   TEXT;
  payload_text TEXT;
  raised       BOOLEAN;
  err_state    TEXT;
BEGIN
  -- The RPC contract is hash-in-Node: store sha256 hex of the raw token. pg14+
  -- exposes sha256(bytea) in core (no pgcrypto digest extension); this mirrors
  -- exactly what hashShareToken(raw) (Plan 25-02) computes in the route.
  hash_a       := encode(sha256(raw_a::bytea), 'hex');
  hash_a_empty := encode(sha256(raw_a_empty::bytea), 'hex');
  hash_b       := encode(sha256(raw_b::bytea), 'hex');

  -- ----- SEED (service role / superuser context — bypasses RLS) ----------

  -- Tenant A: auth.users -> profile -> a PUBLISHED strategy with analytics.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-share-rls-tenant-a@quantalyze.test', now(), now());

  -- The on_auth_user_created trigger pre-creates the profile (no role) on the
  -- auth.users INSERT, so DO UPDATE the role/display_name to land 'allocator'.
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'share-rls tenant a', 'test-share-rls-tenant-a@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO strategies (
    user_id, name, status, strategy_types, subtypes, markets, supported_exchanges
  ) VALUES (
    uid_a, 'share-rls A published strategy', 'published',
    '{}', '{}', '{}', ARRAY['binance']
  ) RETURNING id INTO strat_a_id;

  INSERT INTO strategy_analytics (strategy_id, computation_status, daily_returns)
  VALUES (strat_a_id, 'complete',
          '[{"date":"2026-01-01","value":0.01},{"date":"2026-01-02","value":-0.004}]'::jsonb);

  -- A's scenario references strat_a_id in addedStrategies (the resolvable class).
  -- Holdings refs ("holding:...") are deliberately present too, to prove the
  -- RPC does NOT resolve them.
  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (
    uid_a, 'tenant a shared scenario',
    jsonb_build_object(
      'addedStrategies', jsonb_build_array(
        jsonb_build_object('id', strat_a_id::text, 'name', 'A strat',
                           'markets', jsonb_build_array(), 'strategy_types', jsonb_build_array())
      ),
      'toggleByScopeRef', jsonb_build_object('holding:binance:BTC:spot', true),
      'weightOverrides',  jsonb_build_object('holding:binance:BTC:spot', 0.5)
    ),
    2
  ) RETURNING id INTO scen_a_id;

  -- A's EMPTY scenario: pure holdings reweight, zero added strategies.
  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (
    uid_a, 'tenant a empty scenario',
    jsonb_build_object(
      'addedStrategies', jsonb_build_array(),
      'toggleByScopeRef', jsonb_build_object('holding:binance:ETH:spot', true)
    ),
    2
  ) RETURNING id INTO scen_a_empty_id;

  -- Tenant B: same shape, separate tenant + its own published strategy.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-share-rls-tenant-b@quantalyze.test', now(), now());

  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'share-rls tenant b', 'test-share-rls-tenant-b@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE
    SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO strategies (
    user_id, name, status, strategy_types, subtypes, markets, supported_exchanges
  ) VALUES (
    uid_b, 'share-rls B published strategy', 'published',
    '{}', '{}', '{}', ARRAY['binance']
  ) RETURNING id INTO strat_b_id;

  INSERT INTO strategy_analytics (strategy_id, computation_status, daily_returns)
  VALUES (strat_b_id, 'complete',
          '[{"date":"2026-01-01","value":0.02}]'::jsonb);

  INSERT INTO scenarios (allocator_id, name, draft, schema_version)
  VALUES (
    uid_b, 'tenant b shared scenario',
    jsonb_build_object(
      'addedStrategies', jsonb_build_array(
        jsonb_build_object('id', strat_b_id::text, 'name', 'B strat',
                           'markets', jsonb_build_array(), 'strategy_types', jsonb_build_array())
      )
    ),
    2
  ) RETURNING id INTO scen_b_id;

  -- Mint shares (store ONLY the hash, created_by from the owner).
  INSERT INTO scenario_shares (scenario_id, created_by, token_hash)
  VALUES (scen_a_id, uid_a, hash_a) RETURNING id INTO share_a_id;
  INSERT INTO scenario_shares (scenario_id, created_by, token_hash)
  VALUES (scen_a_empty_id, uid_a, hash_a_empty) RETURNING id INTO share_a_empty_id;
  INSERT INTO scenario_shares (scenario_id, created_by, token_hash)
  VALUES (scen_b_id, uid_b, hash_b) RETURNING id INTO share_b_id;

  RAISE NOTICE 'Seed OK: A uid=% scen=% share=%, B uid=% scen=% share=%',
    uid_a, scen_a_id, share_a_id, uid_b, scen_b_id, share_b_id;

  -- ----- ASSERTION 1: CONTENT — A's token returns A's own content ONLY ---
  -- Resolve A's share via the RPC (the page calls it via service_role; the test
  -- runs in the un-forged seeding context, which is the service-role analog).
  SELECT * INTO r FROM public.get_shared_scenario(hash_a);
  IF r.name IS NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 1): get_shared_scenario(hash_a) returned no row — RPC/table missing or gate too tight';
  END IF;
  IF r.name <> 'tenant a shared scenario' THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 1): RPC returned name=% (expected "tenant a shared scenario") — wrong scenario resolved', r.name;
  END IF;

  -- The series MUST contain A's published strategy_id and NOTHING else.
  series_text := r.series::text;
  IF position(strat_a_id::text IN series_text) = 0 THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 1): series does not contain A''s published strategy_id % — addedStrategies resolution regressed', strat_a_id;
  END IF;
  IF position(strat_b_id::text IN series_text) <> 0 THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 1): series contains tenant B''s strategy_id % — CROSS-TENANT SERIES LEAK', strat_b_id;
  END IF;

  -- CONTENT-by-field over-return guard: the WHOLE payload (name + draft + series)
  -- must carry NO key/value shaped like the forbidden live-book set. A loosened
  -- RPC that joins api_keys / holdings / AUM trips this even when it returns 200.
  payload_text := lower(coalesce(r.name,'') || ' ' || coalesce(r.draft::text,'') || ' ' || coalesce(r.series::text,''));
  IF payload_text ~ 'api_key|allocated_amount|account_balance|value_usd' THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 1): shared payload contains a forbidden live-book field (api_key|allocated_amount|account_balance|value_usd) — OVER-RETURN LEAK. payload=%', payload_text;
  END IF;
  RAISE NOTICE 'Assertion 1 OK: A''s token returns A''s scenario + only A''s published series; no forbidden live-book field.';

  -- ----- ASSERTION 2: EMPTY addedStrategies → series = [] (no holdings) ---
  SELECT * INTO r FROM public.get_shared_scenario(hash_a_empty);
  IF r.name IS NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 2): empty-addedStrategies share returned no row — the gate should still resolve the scenario';
  END IF;
  IF r.series IS NULL OR r.series::text <> '[]' THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 2): empty-addedStrategies share series=% (expected []) — HOLDINGS LEAK or wrong default', r.series::text;
  END IF;
  RAISE NOTICE 'Assertion 2 OK: empty-addedStrategies scenario resolves to series = [] (no holdings leak).';

  -- ----- ASSERTION 3: UNKNOWN token → 0 rows (→ 404) --------------------
  SELECT count(*) INTO row_cnt
    FROM public.get_shared_scenario(encode(sha256('does-not-exist'::bytea), 'hex'));
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 3): unknown token returned % rows, expected 0 (→ 404)', row_cnt;
  END IF;
  RAISE NOTICE 'Assertion 3 OK: unknown token returns 0 rows.';

  -- ----- ASSERTION 4: CROSS-TENANT READ — B''s token returns ONLY B ------
  SELECT * INTO r FROM public.get_shared_scenario(hash_b);
  IF r.name IS NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 4): get_shared_scenario(hash_b) returned no row';
  END IF;
  IF r.name <> 'tenant b shared scenario' THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 4): B''s token resolved name=% (expected "tenant b shared scenario")', r.name;
  END IF;
  IF position(strat_a_id::text IN r.series::text) <> 0 THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 4): B''s token series contains tenant A''s strategy_id % — CROSS-TENANT LEAK', strat_a_id;
  END IF;
  RAISE NOTICE 'Assertion 4 OK: B''s token resolves ONLY B''s content.';

  -- ----- ASSERTION 5: REVOKE IMMEDIACY (SHARE-03) -----------------------
  -- Set revoked_at = now() on A''s share, then the SAME token must return 0 rows
  -- immediately (the RPC predicate is revoked_at IS NULL — data-layer immediacy).
  UPDATE scenario_shares SET revoked_at = now() WHERE id = share_a_id;
  SELECT count(*) INTO row_cnt FROM public.get_shared_scenario(hash_a);
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 5): revoked token still returned % rows, expected 0 — REVOKE NOT IMMEDIATE (revoked_at IS NULL predicate missing)', row_cnt;
  END IF;
  RAISE NOTICE 'Assertion 5 OK: revoked_at = now() makes the same token return 0 rows immediately.';

  -- ----- ASSERTION 6: anon has NO direct SELECT on scenario_shares ------
  -- migration 20260622120000 REVOKEs ALL on scenario_shares from anon, so a
  -- SELECT as the anon role lacks the table-level grant → 42501 BEFORE RLS
  -- row-filtering even applies. Pin the exception so a future re-GRANT to anon
  -- fails this test loudly. (B''s share row still exists — A only revoked its
  -- own — so a missing REVOKE would expose a real row to anon.)
  PERFORM set_config('request.jwt.claims', NULL, true);
  SET LOCAL ROLE anon;
  raised := FALSE;
  BEGIN
    PERFORM 1 FROM scenario_shares WHERE id = share_b_id;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;
  RESET ROLE;
  IF NOT raised THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 6): anon SELECT on scenario_shares SUCCEEDED — REVOKE ALL FROM anon (migration 20260622120000) not applied or re-granted.';
  END IF;
  IF err_state <> '42501' THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 6): anon SELECT raised %, expected 42501 (insufficient_privilege from the table-level REVOKE)', err_state;
  END IF;
  RAISE NOTICE 'Assertion 6 OK: anon SELECT on scenario_shares rejected with ERRCODE 42501.';

  -- ----- ASSERTION 7: CROSS-TENANT WRITE — A cannot revoke B''s share ---
  -- As tenant A (forged JWT, authenticated role), an UPDATE of B''s share row is
  -- silently scoped out by the scenario_shares_owner USING predicate
  -- (created_by = auth.uid()) → 0 rows affected (no error — RLS scopes, not
  -- 42501). Mirrors test_scenarios_rls Assertion 3.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  UPDATE scenario_shares SET revoked_at = now() WHERE id = share_b_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF affected <> 0 THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 7): tenant A revoke of tenant B share affected % rows, expected 0 — CROSS-TENANT WRITE', affected;
  END IF;
  -- Ground-truth: B''s share is still active (not revoked by A).
  IF EXISTS (SELECT 1 FROM scenario_shares WHERE id = share_b_id AND revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 7): tenant B share was revoked by tenant A — CROSS-TENANT WRITE persisted';
  END IF;
  RAISE NOTICE 'Assertion 7 OK: tenant A revoke of tenant B share affected 0 rows; B share untouched.';

  -- ----- ASSERTION 8: CR-01 — A CANNOT MINT A SHARE FOR B''s SCENARIO ----
  -- The leak the phase brief names: an authenticated allocator minting a public
  -- share link for a scenario they do NOT own. As tenant A (forged JWT,
  -- authenticated role) attempt to INSERT a scenario_shares row pointing at
  -- tenant B''s scenario (scen_b_id) with created_by = A. The
  -- scenario_shares_owner WITH CHECK requires created_by = auth.uid() AND
  -- EXISTS(scenarios s WHERE s.id = scenario_id AND s.allocator_id = auth.uid())
  -- — B''s scenario is NOT owned by A, so the WITH CHECK fails → 42501
  -- (RLS WITH CHECK violation, "new row violates row-level security policy").
  -- This is the layer-2 (table RLS) half of the CR-01 fix. If the owner-coherence
  -- EXISTS clause were removed, this INSERT would SUCCEED — the test fails loudly.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  raised := FALSE;
  BEGIN
    INSERT INTO scenario_shares (scenario_id, created_by, token_hash)
    VALUES (scen_b_id, uid_a, encode(sha256('a-forges-share-for-b'::bytea), 'hex'));
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF NOT raised THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 8): tenant A INSERT of a share for tenant B''s scenario SUCCEEDED — CROSS-TENANT SHARE MINT (CR-01). The scenario_shares_owner WITH CHECK owner-coherence EXISTS clause is missing or loosened.';
  END IF;
  IF err_state <> '42501' THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 8): tenant A cross-tenant share INSERT raised %, expected 42501 (RLS WITH CHECK violation)', err_state;
  END IF;
  RAISE NOTICE 'Assertion 8 OK: tenant A cannot mint a share for tenant B''s scenario (RLS WITH CHECK rejected with 42501).';

  -- ----- ASSERTION 9: CR-01 RPC backstop — a mis-owned share NEVER resolves
  -- Defense-in-depth (layer 3): even if a cross-tenant share row somehow exists
  -- (a future RLS loosening, a service-role mis-insert, a data migration), the
  -- get_shared_scenario RPC''s owner-coherence join predicate
  -- (s.allocator_id = sh.created_by) must refuse to resolve another tenant''s
  -- content. We force-insert such a row from the SEEDING (superuser) context —
  -- which BYPASSES RLS, so it sidesteps Assertion 8''s WITH CHECK — and then
  -- prove the RPC returns 0 rows (→ 404) and NEVER B''s name/draft/series.
  --
  -- B''s scenario still has its seeded ACTIVE share (Assertion 7 confirmed A
  -- could not revoke it). The scenario_shares_one_active_idx partial unique
  -- index forbids a SECOND active share per scenario, so revoke B''s seeded
  -- share first. This does NOT weaken the assertion: the force-inserted row is
  -- still active (revoked_at IS NULL) and still mis-owned (created_by = A, which
  -- is NOT scen_b''s owner B) — exactly what the RPC owner-coherence backstop is
  -- probed on. (In production create_scenario_share revoke-then-inserts in one
  -- transaction, so the invariant is never violated; only this superuser
  -- force-insert must mirror that ordering.)
  UPDATE scenario_shares SET revoked_at = now() WHERE id = share_b_id;
  INSERT INTO scenario_shares (scenario_id, created_by, token_hash)
  VALUES (scen_b_id, uid_a, encode(sha256('mis-owned-share-row'::bytea), 'hex'));
  -- ^ created_by = A, scenario_id = B''s scenario. A is NOT B''s scenario owner.
  SELECT * INTO r
    FROM public.get_shared_scenario(encode(sha256('mis-owned-share-row'::bytea), 'hex'));
  IF r.name IS NOT NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 9): the RPC resolved a mis-owned share (created_by=A pointing at B''s scenario) and returned name=% — CROSS-TENANT DISCLOSURE (CR-01). The get_shared_scenario owner-coherence predicate (s.allocator_id = sh.created_by) is missing or loosened.', r.name;
  END IF;
  -- Belt-and-braces: the RPC must return 0 rows for that token, not just a NULL
  -- name row.
  SELECT count(*) INTO row_cnt
    FROM public.get_shared_scenario(encode(sha256('mis-owned-share-row'::bytea), 'hex'));
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 9): the RPC returned % rows for a mis-owned share, expected 0 (→ 404) — CR-01 owner-coherence predicate missing.', row_cnt;
  END IF;
  RAISE NOTICE 'Assertion 9 OK: a force-inserted mis-owned share (A→B) resolves to 0 rows; B''s content never disclosed via an A-created share.';

  -- ----- TEARDOWN -------------------------------------------------------
  -- ON DELETE CASCADE chains auth.users -> profiles -> {strategies, scenarios}
  -- -> {strategy_analytics, scenario_shares}. One delete per tenant cleans the
  -- whole subtree.
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);

  RAISE NOTICE 'All scenario_shares + get_shared_scenario assertions passed (leak boundary intact).';
END
$$;

-- --------------------------------------------------------------------------
-- Defensive post-clean. If an assertion above aborted with RAISE EXCEPTION the
-- seed rows would survive; run one more cleanup outside the DO block so
-- subsequent runs start clean.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-share-rls-tenant-a@quantalyze.test',
    'test-share-rls-tenant-b@quantalyze.test'
  );
