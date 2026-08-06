-- Test for the Phase 150 OWN-03 / D-03-A ALLOCATION INVARIANT:
--   * 20260806120000_strategies_capital_ownership.sql
--       part 3 — trg_portfolio_strategies_own_capital_only (BEFORE INSERT)
--       part 4 — flip_capital_ownership_to_team_review(uuid)
--
-- Why this must be a DB test and not a vitest file
-- -----------------------------------------------
-- D-03 claims "no code path creates an allocation from a team-review strategy".
-- Two SHIPPED components insert portfolio_strategies rows straight from the
-- browser under RLS only — AddToPortfolio.tsx:54 and MigrationWizard.tsx:72 —
-- and any authenticated session can POST to PostgREST directly. A route-level
-- check therefore cannot make D-03 true; only the table-layer trigger can. And
-- per MEMORY `reference_db_test_ci_wiring`, *_rls.test.ts live-DB vitest files
-- NEVER run in CI (they skip on missing env), so supabase/tests/test_*.sql is
-- the only DB gate with real teeth.
--
-- The predicate under test is the AMENDED D-03-A form. RAISE when:
--     mark = 'team_review'                                   (UNCONDITIONAL)
--  OR (strategy.user_id = portfolio.user_id                  (SELF-OWNED)
--      AND mark IS DISTINCT FROM 'own_capital')
-- A blanket `IS DISTINCT FROM 'own_capital'` would DELETE three shipped
-- THIRD-PARTY allocation paths (AddToPortfolio, MigrationWizard, the demo seed)
-- whose strategies the allocating user has no authority to mark. Case 8 is the
-- regression pin for that, and it is the case a "simplifying" reviewer breaks.
--
-- Assertions:
--   1. SELF-OWNED + own_capital  -> INSERT SUCCEEDS (positive control; without
--      it, every negative below could pass because the trigger blocks all).
--   2a. SELF-OWNED + team_review -> RAISEs check_violation.
--   2b. THIRD-PARTY + team_review (published) -> RAISEs. The team_review arm is
--       UNCONDITIONAL — SC 2b literally, not "unless someone else owns it".
--   2c. THIRD-PARTY + team_review + status='private' -> RAISEs. The inserting
--       session CANNOT SELECT that strategy (strategies_read =
--       published OR own), so this case fails unless the trigger function is
--       SECURITY DEFINER. It is the falsifiable proof that the unconditional
--       arm is not silently RLS-blind.
--   3. SELF-OWNED + NULL -> RAISEs. NULL ("never asked") and team_review are
--      BOTH non-allocatable for self-owned rows: two logic states, three
--      display states.
--   4. Upsert-edit path: INSERT ... ON CONFLICT (portfolio_id, strategy_id)
--      DO UPDATE on a row whose SELF-OWNED strategy was later un-marked ALSO
--      RAISEs — Postgres fires BEFORE INSERT triggers on the ON CONFLICT insert
--      attempt. This is DELIBERATE (editing the amount also requires the mark)
--      and is pinned here so nobody "fixes" it.
--   5. Legacy-alias regression (150-RESEARCH § Pitfall 2 / T-150-06): an alias
--      UPDATE on an existing position whose strategy is now unmarked MUST
--      SUCCEED. Proves the trigger has no UPDATE arm. This is the assertion
--      that reddens if someone widens the trigger's event list.
--   6. Duplicate-add (D-13 / SC 4): a second plain INSERT of the same
--      (portfolio_id, strategy_id) violates the composite PRIMARY KEY. The
--      "never a second row" guarantee is STRUCTURAL, not a UI convention.
--   7. Flip RPC (T-150-02 / T-150-05): ONE call sets the mark to team_review AND
--      removes the caller's positions. A non-owner call is a total no-op — zero
--      positions removed, zero strategies updated, victim state untouched. Plus
--      a STRUCTURAL sub-case (7c) pinning the explicit auth.uid() predicate on
--      both statements, which the behavioural arm provably cannot see because
--      RLS masks its removal.
--   8. THIRD-PARTY regression (the INSERT-side twin of case 5): a position for
--      ANOTHER owner's strategy with a NULL mark MUST SUCCEED, and so must one
--      for a third-party own_capital strategy. This is the shipped
--      AddToPortfolio / MigrationWizard / demo-seed shape.
--
-- Negative cases catch `check_violation` SPECIFICALLY (SQLSTATE 23514), so an
-- unrelated failure (RLS 42501, FK 23503, PK 23505) cannot false-pass them.
--
-- pgTAP is NOT installed in this project (zero of the 53 supabase/tests/*.sql
-- files use plan/ok/finish). House convention is plain PL/pgSQL `DO $$ ... $$`
-- with RAISE EXCEPTION on failure / RAISE NOTICE on pass, run under
-- `psql -v ON_ERROR_STOP=1` by .github/workflows/ci.yml `sql-tests`.
--
-- Hygiene (shared TEST DB — STATE Phase-142.1 item 5 class): every fixture row
-- is created inside this test's own transaction with its own generated UUIDs;
-- every UPDATE/DELETE predicate names those ids; there is NO table-wide
-- mutation anywhere in this file; the transaction ends in ROLLBACK. The
-- third-party cases need TWO distinct user_ids on their fixture rows — the
-- trigger reads table COLUMNS (strategies.user_id, portfolios.user_id), not
-- auth.uid(), so plain fixture rows are sufficient for them.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_capital_ownership_allocation_guard.sql

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- Scoped to this file's OWN sentinel emails; ON DELETE CASCADE chains
-- auth.users -> profiles -> {strategies, portfolios} -> portfolio_strategies.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-capital-ownership-guard-a@quantalyze.test',
    'test-capital-ownership-guard-b@quantalyze.test'
  );

BEGIN;

DO $$
DECLARE
  uid_a               UUID := gen_random_uuid();  -- allocator; owns the portfolio
  uid_b               UUID := gen_random_uuid();  -- OTHER owner; the third party
  port_a              UUID;                       -- portfolio owned by A

  strat_a_own         UUID;  -- A, own_capital            -> allocatable
  strat_a_team        UUID;  -- A, team_review            -> blocked
  strat_a_null        UUID;  -- A, NULL (never asked)     -> blocked
  strat_a_legacy      UUID;  -- A, own_capital -> NULL after a position exists
  strat_a_flip        UUID;  -- A, own_capital + position -> flip RPC target

  strat_b_null        UUID;  -- B, NULL,        published -> third-party, allowed
  strat_b_own         UUID;  -- B, own_capital, published -> third-party, allowed
  strat_b_team_pub    UUID;  -- B, team_review, published -> blocked (arm 1)
  strat_b_team_priv   UUID;  -- B, team_review, PRIVATE   -> blocked (SECDEF probe)

  row_cnt             INTEGER;
  v_removed           INTEGER;
  v_updated           INTEGER;
  mark_now            TEXT;
  alias_now           TEXT;
  raised              BOOLEAN;
BEGIN
  -- ======================================================================
  -- SEED (seeding/service-role context — bypasses RLS)
  -- ======================================================================
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-capital-ownership-guard-a@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'cap-own guard allocator a',
          'test-capital-ownership-guard-a@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-capital-ownership-guard-b@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'cap-own guard manager b',
          'test-capital-ownership-guard-b@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO portfolios (user_id, name)
  VALUES (uid_a, 'cap-own guard book A')
  RETURNING id INTO port_a;

  -- A's own strategies (strategy.user_id = portfolio.user_id => SELF-OWNED).
  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'cap-own A own', 'private', 'own_capital', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a_own;

  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'cap-own A team', 'private', 'team_review', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a_team;

  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'cap-own A unmarked', 'private', NULL, '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a_null;

  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'cap-own A legacy', 'private', 'own_capital', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a_legacy;

  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'cap-own A flip', 'private', 'own_capital', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a_flip;

  -- B's strategies (strategy.user_id <> portfolio.user_id => THIRD-PARTY).
  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_b, 'cap-own B unmarked', 'published', NULL, '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_b_null;

  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_b, 'cap-own B own', 'published', 'own_capital', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_b_own;

  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_b, 'cap-own B team published', 'published', 'team_review', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_b_team_pub;

  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_b, 'cap-own B team private', 'private', 'team_review', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_b_team_priv;

  -- Two pre-existing positions, created while their strategies are still marked
  -- own_capital (so the trigger admits them), for cases 4/5 and case 7.
  INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
  VALUES (port_a, strat_a_legacy, 100000);
  INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
  VALUES (port_a, strat_a_flip, 250000);

  -- Un-mark the legacy strategy AFTER its position exists — this is exactly the
  -- shape of every pre-existing PROD position: a live row whose strategy the
  -- retro Mark path has not reached. Scoped to this fixture's own id.
  UPDATE strategies SET capital_ownership = NULL WHERE id = strat_a_legacy;

  RAISE NOTICE 'Seed OK: A=% B=% portfolio=% (self: own=% team=% null=% legacy=% flip=%) (third-party: null=% own=% team_pub=% team_priv=%)',
    uid_a, uid_b, port_a, strat_a_own, strat_a_team, strat_a_null, strat_a_legacy,
    strat_a_flip, strat_b_null, strat_b_own, strat_b_team_pub, strat_b_team_priv;

  -- ======================================================================
  -- Everything below runs as the AUTHENTICATED role with A's JWT — the same
  -- context the two shipped client-direct insert paths run in.
  -- ======================================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- ----- 1: SELF-OWNED + own_capital -> INSERT SUCCEEDS --------------------
  -- Positive control. Without it, every negative case below could pass simply
  -- because the trigger blocks EVERY insert.
  INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
  VALUES (port_a, strat_a_own, 120000);
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_a_own;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (1): a SELF-OWNED own_capital strategy could not become a position (got % rows) — the guard over-blocks and the whole feature is dead', row_cnt;
  END IF;

  -- ----- 2a: SELF-OWNED + team_review -> RAISEs ----------------------------
  raised := FALSE;
  BEGIN
    INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
    VALUES (port_a, strat_a_team, 1000);
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (2a): a SELF-OWNED team_review strategy became a position — D-03 hard invariant broken';
  END IF;

  -- ----- 2b: THIRD-PARTY + team_review (published) -> RAISEs ---------------
  -- The team_review arm is UNCONDITIONAL (SC 2b). "Can never become a position"
  -- means never, including in someone else's book.
  raised := FALSE;
  BEGIN
    INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
    VALUES (port_a, strat_b_team_pub, 1000);
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (2b): a third-party team_review strategy became a position — the team_review arm is supposed to be UNCONDITIONAL (SC 2b)';
  END IF;

  -- ----- 2c: THIRD-PARTY + team_review + PRIVATE -> RAISEs -----------------
  -- SECURITY DEFINER probe. As A, `SELECT * FROM strategies WHERE id =
  -- strat_b_team_priv` returns ZERO rows (strategies_read = published OR own),
  -- so a SECURITY INVOKER trigger would read a NULL mark and wave this through.
  -- Prove first that A genuinely cannot see the row, THEN prove the guard still
  -- fires — otherwise this case could pass vacuously on a readable row.
  SELECT count(*) INTO row_cnt FROM strategies WHERE id = strat_b_team_priv;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (2c setup): allocator A can SELECT another owner''s PRIVATE strategy (% rows) — the SECURITY DEFINER probe is vacuous and strategies_read has regressed', row_cnt;
  END IF;
  raised := FALSE;
  BEGIN
    INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
    VALUES (port_a, strat_b_team_priv, 1000);
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (2c): a third-party team_review strategy the caller CANNOT READ became a position — the trigger function is RLS-blind (it must be SECURITY DEFINER)';
  END IF;

  -- ----- 3: SELF-OWNED + NULL (never asked) -> RAISEs ----------------------
  raised := FALSE;
  BEGIN
    INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
    VALUES (port_a, strat_a_null, 1000);
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (3): a SELF-OWNED UNMARKED strategy became a position — NULL is "never asked", and silence is not consent (SC 3)';
  END IF;

  -- ----- 4: upsert-edit on an un-marked SELF-OWNED strategy -> RAISEs ------
  -- Postgres fires BEFORE INSERT row triggers on the ON CONFLICT insert
  -- ATTEMPT, before the conflict is detected. So an amount edit routed through
  -- an upsert also requires the mark. DELIBERATE — pinned so nobody "fixes" it.
  raised := FALSE;
  BEGIN
    INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
    VALUES (port_a, strat_a_legacy, 999999)
    ON CONFLICT (portfolio_id, strategy_id)
    DO UPDATE SET allocated_amount = EXCLUDED.allocated_amount;
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (4): an ON CONFLICT DO UPDATE upsert bypassed the mark requirement on a SELF-OWNED unmarked strategy';
  END IF;
  -- The failed upsert must NOT have changed the amount (subtransaction rollback).
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_a_legacy
     AND allocated_amount = 100000;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (4): the blocked upsert still mutated allocated_amount on the legacy row';
  END IF;

  -- ----- 5: LEGACY-ALIAS REGRESSION — alias UPDATE MUST SUCCEED ------------
  -- 150-RESEARCH § Pitfall 2 / T-150-06. The shipped alias route
  -- (api/portfolio-strategies/alias/route.ts:148) UPDATEs exactly this shape:
  -- a live position whose strategy is unmarked. If the trigger ever grows an
  -- UPDATE arm, this reddens — which is the entire point of the case.
  UPDATE portfolio_strategies SET alias = 'my legacy sleeve'
   WHERE portfolio_id = port_a AND strategy_id = strat_a_legacy;
  SELECT alias INTO alias_now
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_a_legacy;
  IF alias_now IS DISTINCT FROM 'my legacy sleeve' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (5): the alias UPDATE on a legacy unmarked position did not take (alias=%) — the trigger must be INSERT-scoped ONLY', COALESCE(alias_now, '<null>');
  END IF;

  -- ----- 6: duplicate-add is a PRIMARY KEY violation (D-13 / SC 4) ---------
  -- strat_a_own is own_capital, so it clears the trigger; the ONLY thing left
  -- to stop a second row is the composite PK. Structural, not a UI convention.
  raised := FALSE;
  BEGIN
    INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
    VALUES (port_a, strat_a_own, 55555);
  EXCEPTION WHEN unique_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (6): a second portfolio_strategies row was minted for the same (portfolio_id, strategy_id) — the composite PRIMARY KEY is gone and double-counting is possible';
  END IF;
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_a_own;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (6): expected exactly 1 position row for the pair, found %', row_cnt;
  END IF;

  -- ----- 7a: flip RPC — ONE call flips the mark AND removes the position ---
  SELECT removed_positions, updated_strategies
    INTO v_removed, v_updated
    FROM flip_capital_ownership_to_team_review(strat_a_flip);
  IF v_removed <> 1 OR v_updated <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7a): flip returned (removed=%, updated=%), expected (1, 1)', v_removed, v_updated;
  END IF;
  SELECT capital_ownership INTO mark_now FROM strategies WHERE id = strat_a_flip;
  IF mark_now IS DISTINCT FROM 'team_review' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7a): after the flip the mark is %, expected team_review', COALESCE(mark_now, '<null>');
  END IF;
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies WHERE strategy_id = strat_a_flip;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7a): % position(s) survived the flip — a stranded position on a team-review strategy is exactly the hole this RPC exists to close', row_cnt;
  END IF;

  RESET ROLE;

  -- ----- 7b: flip RPC by a NON-OWNER is a total no-op ----------------------
  -- B calls flip on A's strategy. Both statements carry an auth.uid() predicate,
  -- so nothing is removed and nothing is marked. strat_a_own still holds the
  -- live position created in case 1 — the victim state must be untouched.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT removed_positions, updated_strategies
    INTO v_removed, v_updated
    FROM flip_capital_ownership_to_team_review(strat_a_own);
  IF v_removed <> 0 OR v_updated <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7b): a NON-OWNER flip affected rows (removed=%, updated=%), expected (0, 0)', v_removed, v_updated;
  END IF;
  RESET ROLE;

  SELECT capital_ownership INTO mark_now FROM strategies WHERE id = strat_a_own;
  IF mark_now IS DISTINCT FROM 'own_capital' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7b): a NON-OWNER flip changed the victim''s mark to %', COALESCE(mark_now, '<null>');
  END IF;
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_a_own;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7b): a NON-OWNER flip removed the victim''s position (% rows remain)', row_cnt;
  END IF;

  -- ----- 7c: BOTH flip statements carry an explicit auth.uid() predicate ---
  -- Structural, deliberately. Case 7b alone CANNOT catch the removal of these
  -- predicates: RLS `strategies_update USING (user_id = auth.uid())` and
  -- `portfolio_strategies_owner USING (...)` independently reduce a non-owner
  -- flip to zero rows, so deleting the in-body predicates leaves 7b GREEN
  -- (measured — mutation M6 of this file's ledger). They are defence-in-depth,
  -- and defence-in-depth that no test can see is defence-in-depth that gets
  -- deleted in the next refactor. The predicates matter the moment anyone makes
  -- this function SECURITY DEFINER or calls it from a service-role context,
  -- where RLS stops helping.
  SELECT count(*) INTO row_cnt
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'flip_capital_ownership_to_team_review'
    AND (length(pg_get_functiondef(p.oid))
         - length(replace(pg_get_functiondef(p.oid), 'auth.uid()', ''))) / length('auth.uid()') >= 2;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7c): flip_capital_ownership_to_team_review does not carry an explicit auth.uid() predicate on BOTH its DELETE and its UPDATE — RLS currently masks the loss, so nothing else in this suite would notice';
  END IF;

  -- ----- 8: THIRD-PARTY regression — the shipped paths must still work -----
  -- The INSERT-side twin of case 5. AddToPortfolio.tsx:54,
  -- MigrationWizard.tsx:72 and seed-full-app-demo.ts:1697,1929 all insert
  -- positions for strategies owned by SOMEONE ELSE, which the allocating user
  -- cannot mark (marking is owner-authz'd). A blanket
  -- `IS DISTINCT FROM 'own_capital'` predicate deletes all three features.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 8a: third-party, mark NULL (the overwhelmingly common shape today).
  INSERT INTO portfolio_strategies (portfolio_id, strategy_id)
  VALUES (port_a, strat_b_null);
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_b_null;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (8a): a third-party UNMARKED strategy could not become a position (% rows) — this breaks discovery AddToPortfolio, the manager MigrationWizard and the demo seed', row_cnt;
  END IF;

  -- 8b: third-party, mark own_capital (the other owner marked it themselves).
  INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
  VALUES (port_a, strat_b_own, 75000);
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_b_own;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (8b): a third-party own_capital strategy could not become a position (% rows)', row_cnt;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  RAISE NOTICE 'test_capital_ownership_allocation_guard: ALL PASS (D-03-A both arms, SECURITY DEFINER probe, upsert arm, legacy-alias + third-party regressions, composite PK, atomic flip).';
END
$$;

ROLLBACK;
