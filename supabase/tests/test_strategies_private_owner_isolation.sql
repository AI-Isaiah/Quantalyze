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
--      any finalize caller. Pins the never-published invariant at the FINALIZE layer.
--   6. TABLE GUARD (red-team Finding 1): owner A, as the authenticated role,
--      cannot UPDATE its OWN private strategy to status='published' directly —
--      the guard_strategies_publish_transition trigger RAISEs insufficient_privilege.
--   7. TABLE GUARD (red-team Finding 1): owner A, as the authenticated role,
--      cannot INSERT a fresh status='published' strategy directly — same trigger.
--   8. POSITIVE CONTROL: the service_role (the admin review route's client) CAN
--      transition a pending_review strategy to published — proving the trigger
--      blocks only end-users, never the sole sanctioned publisher.
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
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4). Each prose RED-UNDER below an arm
-- carries an adjacent `RED-UNDER-M` object that scripts/mutation-runner executes:
-- it mutates COPIES on a throwaway pg-lane cluster, requires the FIRST
-- `TEST FAILED (…)` to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md. The line below declares what the lane
-- applies before this gate. DISCOVERED, not guessed — plan 164.4-06 iterated it
-- over 2 lane runs to `ALL PASS`, mean 0.97 s/lane over 3 timed GREEN runs.
-- ⚠️ 10-fixture-strategies-rls-baseline.sql is NOT padding. It DROPs
-- 01-fixture-core.sql's stand-in `strategies_read` so the REAL
-- 20260405061912_rls_policies.sql defines the policy RLS 1-4 assert on, and it
-- restores the table privileges Supabase's bootstrap gives `strategies` in
-- production. MEASURED without it: the file still printed ALL PASS while GUARD 6
-- and GUARD 7 were refused by the GRANT layer with the same 42501 those arms read
-- as trigger proof, and `anon` held no SELECT at all — three vacuous passes.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","supabase/migrations/20260405061912_rls_policies.sql","supabase/migrations/20260716130000_strategies_status_private.sql","supabase/migrations/20260716130500_finalize_terminal_status_param.sql","supabase/migrations/20260716131000_guard_strategies_publish_transition.sql"]}

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
  strat_pending  UUID;  -- owned by A, status='pending_review' (positive-control publish target)
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

  -- Owner A's pending_review strategy — the positive-control publish target for
  -- GUARD 8 (service_role may promote it; an authenticated end-user may not).
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'contrib-private A pending', 'pending_review', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_pending;

  RAISE NOTICE 'Seed OK: A uid=% private=% pub=% draft=% pending=%, B uid=%',
    uid_a, strat_private, strat_pub, strat_draft, strat_pending, uid_b;

  -- ----- RLS 1: owner B sees 0 of owner A's PRIVATE row (isolation) ---------
  -- RED-UNDER: widen `strategies_read` to `USING (TRUE)` in migration
  --            20260405061912 — the "browse shows every row" drift that makes
  --            owner A's private strategy visible to owner B.
  -- RED-UNDER-M: {"arm":"RLS 1","apply":[{"kind":"edit","file":"supabase/migrations/20260405061912_rls_policies.sql","find":"  status = 'published' OR user_id = auth.uid()","replace":"  TRUE","occurrences":1}]}
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
  -- RED-UNDER: drop the `status = 'published' OR` disjunct from `strategies_read`
  --            in migration 20260405061912 — an owner-only read policy, which
  --            hides A's PUBLISHED control row from B and would make RLS 1's 0
  --            a broken harness rather than isolation.
  -- RED-UNDER-M: {"arm":"RLS 2","apply":[{"kind":"edit","file":"supabase/migrations/20260405061912_rls_policies.sql","find":"  status = 'published' OR user_id = auth.uid()","replace":"  user_id = auth.uid()","occurrences":1}]}
  SELECT count(*) INTO row_cnt FROM strategies WHERE id = strat_pub;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 2): owner B sees % rows for owner A''s PUBLISHED control, expected 1 — session switch broken or published-read regressed', row_cnt;
  END IF;
  RESET ROLE;

  -- ----- RLS 3: owner A sees its OWN private row (owner-positive control) ----
  -- RED-UNDER: drop the `OR user_id = auth.uid()` disjunct from `strategies_read`
  --            in migration 20260405061912 — a published-only read policy, which
  --            hides owner A's OWN private strategy from owner A.
  -- RED-UNDER-M: {"arm":"RLS 3","apply":[{"kind":"edit","file":"supabase/migrations/20260405061912_rls_policies.sql","find":"  status = 'published' OR user_id = auth.uid()","replace":"  status = 'published'","occurrences":1}]}
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
  -- RED-UNDER: add 'published' to the p_terminal_status allow-list in
  --            finalize_wizard_strategy (migration 20260716130500) — the
  --            never-published invariant's exact inverse. The needle spans two
  --            lines because the identical `IF p_terminal_status NOT IN (…)`
  --            guard also opens finalize_csv_strategy in the same migration.
  -- RED-UNDER-M: {"arm":"GUARD 5","apply":[{"kind":"edit","file":"supabase/migrations/20260716130500_finalize_terminal_status_param.sql","find":"  IF p_terminal_status NOT IN ('pending_review', 'private') THEN\n    RAISE EXCEPTION 'finalize_wizard_strategy: p_terminal_status % is not allowed (expected pending_review or private)',","replace":"  IF p_terminal_status NOT IN ('pending_review', 'private', 'published') THEN\n    RAISE EXCEPTION 'finalize_wizard_strategy: p_terminal_status % is not allowed (expected pending_review or private)',","occurrences":1}]}
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

  -- ----- GUARD 6: authenticated owner A cannot UPDATE own private -> published --
  -- Still authenticated as owner A (RLS strategies_update passes — A owns the
  -- row), so the ONLY thing that can raise insufficient_privilege (42501) here is
  -- the guard_strategies_publish_transition trigger. A different failure (e.g. a
  -- constraint) would NOT be insufficient_privilege, so this cannot false-pass.
  -- RED-UNDER: point the guard's role test at a role nobody ever runs as
  --            (`current_user = 'nobody'`) in migration 20260716131000 — the
  --            trigger stays installed and still fires, so this is the drift a
  --            `pg_trigger` existence check cannot see, and the UPDATE goes
  --            through.
  -- RED-UNDER-M: {"arm":"GUARD 6","apply":[{"kind":"edit","file":"supabase/migrations/20260716131000_guard_strategies_publish_transition.sql","find":"    IF current_user = 'authenticated' THEN","replace":"    IF current_user = 'nobody' THEN","occurrences":1}]}
  raised := FALSE;
  BEGIN
    UPDATE strategies SET status = 'published' WHERE id = strat_private;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (GUARD 6): authenticated owner A published its own private strategy via a direct UPDATE — table-level never-published guard missing';
  END IF;

  -- ----- GUARD 7: authenticated owner A cannot INSERT a fresh published row -----
  -- user_id = uid_a so RLS strategies_insert (WITH CHECK user_id=auth.uid())
  -- passes; the trigger is the sole source of 42501.
  -- RED-UNDER: narrow the trigger to `BEFORE UPDATE` in migration 20260716131000,
  --            dropping INSERT from its event list. Scoped deliberately: GUARD 6
  --            still bites (UPDATE stays guarded), so this arm — and not GUARD 6 —
  --            is the first failure.
  -- RED-UNDER-M: {"arm":"GUARD 7","apply":[{"kind":"edit","file":"supabase/migrations/20260716131000_guard_strategies_publish_transition.sql","find":"  BEFORE INSERT OR UPDATE ON public.strategies","replace":"  BEFORE UPDATE ON public.strategies","occurrences":1}]}
  raised := FALSE;
  BEGIN
    INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
    VALUES (uid_a, 'contrib-private A self-published', 'published', '{}', '{}', '{}', ARRAY['binance']);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (GUARD 7): authenticated owner A created a fresh published strategy via a direct INSERT — table-level never-published guard missing';
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ----- GUARD 8: service_role (admin review route) CAN publish (positive control)
  -- Proves the trigger blocks only current_user='authenticated', never the sole
  -- sanctioned publisher. Without this, GUARD 6/7 could pass simply because the
  -- trigger over-blocks EVERYONE — which would break the real admin route.
  -- RED-UNDER: make the guard over-block the sanctioned publisher — but SILENTLY.
  -- ⚠️ SILENT ON PURPOSE. This arm is a POSITIVE CONTROL and its UPDATE is
  --            deliberately NOT wrapped in a handler, so the literal drift its
  --            prose would name (widen the role test so service_role is REFUSED)
  --            aborts the file on an unhandled 42501 with no `TEST FAILED (…)` at
  --            all and scores NO-IDENTITY, not this arm biting (MEASURED in plan
  --            164.4-05 on test_scenario_shares_rls.sql Assertion 7). The twin
  --            therefore uses the SILENT form of the same over-block — a BEFORE
  --            ROW trigger returning NULL, which DROPS the write instead of
  --            refusing it — which is exactly what `got % published rows`
  --            measures. Scoped to service_role so GUARD 6 and GUARD 7 still bite.
  -- RED-UNDER-M: {"arm":"GUARD 8","apply":[{"kind":"edit","file":"supabase/migrations/20260716131000_guard_strategies_publish_transition.sql","find":"  END IF;\n  RETURN NEW;\nEND;","replace":"  END IF;\n  IF NEW.status = 'published' AND current_user = 'service_role' THEN\n    RETURN NULL;\n  END IF;\n  RETURN NEW;\nEND;","occurrences":1}]}
  SET LOCAL ROLE service_role;
  UPDATE strategies SET status = 'published' WHERE id = strat_pending;
  SELECT count(*) INTO row_cnt FROM strategies WHERE id = strat_pending AND status = 'published';
  RESET ROLE;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (GUARD 8): service_role could NOT publish a pending_review strategy (got % published rows) — the guard over-blocks the sanctioned admin publisher', row_cnt;
  END IF;

  -- ----- RLS 4: anon sees 0 of owner A's PRIVATE row -----------------------
  -- anon can SELECT strategies (the public /browse catalog reads published rows
  -- as anon), but strategies_read filters to published-only for a session with
  -- no auth.uid(). The private row must be invisible.
  -- RED-UNDER: add an `OR current_user = 'anon'` disjunct to `strategies_read` in
  --            migration 20260405061912 — the "let the logged-out /browse catalog
  --            see everything" drift. Scoped to the anon role on purpose: RLS 1-3
  --            read as `authenticated` and still bite, so this arm is the first
  --            failure and needs no `neuter`.
  -- RED-UNDER-M: {"arm":"RLS 4","apply":[{"kind":"edit","file":"supabase/migrations/20260405061912_rls_policies.sql","find":"  status = 'published' OR user_id = auth.uid()","replace":"  status = 'published' OR user_id = auth.uid() OR current_user = 'anon'","occurrences":1}]}
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
