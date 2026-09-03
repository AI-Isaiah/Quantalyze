-- Test for the Phase 150 OWN-03 / D-03-A ALLOCATION INVARIANT:
--   * 20260806120000_strategies_capital_ownership.sql
--       part 3  — trg_portfolio_strategies_own_capital_only (BEFORE INSERT)
--                 trg_portfolio_strategies_own_capital_on_repoint
--                 (BEFORE UPDATE OF strategy_id) — rev-3, finding F4
--       part 3b — trg_strategies_team_review_mark_guard
--                 (BEFORE UPDATE OF capital_ownership) — rev-2, finding F2
--       part 4  — flip_capital_ownership_to_team_review(uuid)
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
--      removes the OWNER's positions. A non-owner call is a total no-op — zero
--      positions removed, zero strategies updated, victim state untouched. Plus
--      a STRUCTURAL sub-case (7c) pinning the explicit auth.uid() predicates,
--      which the behavioural arm provably cannot see because RLS masks their
--      removal. rev-2 adds four sub-cases:
--      7d (finding F1) — the non-owner caller HOLDS a position in the target.
--         Before the owner precheck, flip() deleted the CALLER's own position
--         (its DELETE is scoped to the caller's portfolios, not the owner's)
--         and returned (1, 0) while the mark update no-oped. Case 7b cannot see
--         this: its caller holds nothing in the victim strategy, so the buggy
--         DELETE has nothing to hit. Silent position loss for a bystander.
--      7e (finding F3) — after an OWNER's flip, a THIRD-PARTY position in the
--         now-team_review strategy SURVIVES. Accepted narrowing, pinned here so
--         a future reader cannot "close the gap" with a cross-tenant delete
--         that rewrites another allocator's book (migration header (g)).
--      7f (finding F2) — a raw `UPDATE strategies SET capital_ownership =
--         'team_review'`, which `strategies_update USING (user_id = auth.uid())`
--         permits the owner outright from PostgREST with no route involved,
--         RAISEs check_violation while a live owner position exists. Without
--         part 3b, SC 2b was INSERT-only and this PATCH stranded the position —
--         the exact hole the flip RPC exists to close, reachable without ever
--         calling it. The case then flips the SAME strategy through the RPC and
--         requires it to SUCCEED: same end state, one route blocked, the
--         sanctioned one open.
--      7g — positive control for part 3b. Transitions to 'own_capital' and back
--         to NULL on a strategy with a LIVE position must SUCCEED. Without it,
--         a guard that raised on EVERY capital_ownership update would leave 7f
--         green while silently killing the retro Mark path (and the seed's own
--         un-mark step below).
--      7h — STRUCTURAL, 7c's twin: part 3b's guard is SECURITY DEFINER with a
--         pinned search_path. No behavioural case here can see the loss, because
--         only the owner can reach the guard today and an owner sees their own
--         book either way (measured — mutation M19 stays green as INVOKER).
--      rev-3 adds one:
--      7i (finding F4) — THE REPOINT HOLE. An owner UPDATEs an EXISTING
--         position's `strategy_id` to point at a team_review (and then at a
--         self-owned unmarked) strategy. Before the repoint trigger BOTH
--         UPDATEs succeeded: no INSERT happened, so the D-03-A trigger never
--         fired, and `strategies.capital_ownership` never changed, so part 3b's
--         guard never fired either — the forbidden state reached through the
--         one door neither rev-2 guard watches. The case also re-asserts that
--         a non-strategy_id UPDATE (the shipped alias write, case 5's shape) on
--         a legacy unmarked position STILL SUCCEEDS with the new trigger
--         installed: `UPDATE OF strategy_id` does not fire for a statement
--         whose SET list does not name that column, so Pitfall 2 stays closed.
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
-- every UPDATE/DELETE predicate names those ids (including the rev-2 cases 7f
-- and 7g, which UPDATE `strategies` by fixture id only, and the rev-3 case 7i,
-- whose UPDATEs name a fixture (portfolio_id, strategy_id) pair); there is NO table-wide
-- mutation anywhere in this file; the transaction ends in ROLLBACK. The
-- third-party cases need TWO distinct user_ids on their fixture rows — the
-- trigger reads table COLUMNS (strategies.user_id, portfolios.user_id), not
-- auth.uid(), so plain fixture rows are sufficient for them.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_capital_ownership_allocation_guard.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, VAC-01). Each prose RED-UNDER below
-- carries an adjacent `RED-UNDER-M` object that scripts/mutation-runner executes
-- on every push: it mutates COPIES, requires the FIRST `TEST FAILED (…)` to name
-- that arm, and restores GREEN. The schema is scripts/mutation-runner/GRAMMAR.md.
-- The line below declares what the lane applies before this gate. It was
-- DISCOVERED, not guessed — plan 164.4-05 iterated it over 5 lane runs to
-- `ALL PASS`, mean 0.99 s/lane over 3 timed GREEN runs. This file names NO
-- migration stamp in its own header except the one under test, so the list was
-- resolved by OBJECT NAME across supabase/migrations/.
-- ⚠️ portfolio_strategies is a STAND-IN here (06-fixture-…): its real home,
--    20260405061911_initial_schema.sql, cannot join this list — it re-CREATEs
--    tables 01-fixture-core.sql already stands in for. Its grants, its owner RLS
--    policy and the strategies write policies are mirrored VERBATIM from
--    20260405061912 / 20260410225610 so no arm passes merely because the
--    stand-in is unguarded. The objects UNDER TEST — both triggers, the
--    mark-transition guard and the flip RPC — are the REAL ones from 20260806120000.
-- ⭐ FOUR ARMS HERE ARE POSITIVE CONTROLS (1, 5, 6, 8a), and a positive control's
--    literal drift RAISES rather than fails quietly — outside any handler, which
--    aborts the file with no `TEST FAILED (…)` at all and is scored NO-IDENTITY,
--    not the arm biting (MEASURED this batch on test_scenario_shares_rls.sql's
--    Assertion 7). Each of their twins therefore uses the SILENT form of the same
--    drift — a write that is dropped rather than refused — which is exactly what
--    the arm's own assertion measures. Each says so at the arm.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/06-fixture-portfolio-strategies.sql","supabase/migrations/20260806120000_strategies_capital_ownership.sql"]}

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
  port_b              UUID;                       -- portfolio owned by B (7d/7e)

  strat_a_own         UUID;  -- A, own_capital            -> allocatable
  strat_a_team        UUID;  -- A, team_review            -> blocked
  strat_a_null        UUID;  -- A, NULL (never asked)     -> blocked
  strat_a_legacy      UUID;  -- A, own_capital -> NULL after a position exists
  strat_a_flip        UUID;  -- A, own_capital + position -> flip RPC target
  strat_a_shared      UUID;  -- A, published own_capital, held by BOTH A and B
                             --   -> 7d (F1 non-owner flip) + 7e (F3 survival)
  strat_a_repoint     UUID;  -- A, own_capital + position -> 7i repoint source.
                             --   Its OWN fixture on purpose: by the time 7i
                             --   runs, every other A position has been consumed
                             --   (7a/7e/7f flip theirs away), and a repoint case
                             --   needs a LIVE, legitimately-allocated row to
                             --   move. Untouched by cases 1-7h.

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

  -- B needs a book of their own: cases 7d and 7e both turn on the distinction
  -- between "the caller's positions" and "the strategy owner's positions",
  -- which is invisible while only one allocator holds anything.
  INSERT INTO portfolios (user_id, name)
  VALUES (uid_b, 'cap-own guard book B')
  RETURNING id INTO port_b;

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

  -- PUBLISHED (so B could discover and allocate to it the way AddToPortfolio
  -- does) and own_capital, so both the owner's and the third party's positions
  -- clear the INSERT guard when they are seeded below.
  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'cap-own A shared', 'published', 'own_capital', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a_shared;

  -- rev-3 (F4): the repoint case's source row. own_capital and self-owned, so
  -- its position below is a LEGITIMATE allocation — 7i then tries to move that
  -- position onto a forbidden strategy, which is the whole point: the row is
  -- valid where it is and invalid where the UPDATE would put it.
  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'cap-own A repoint source', 'private', 'own_capital', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a_repoint;

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

  -- TWO positions in ONE strategy, one per allocator: A's own (self-owned +
  -- own_capital) and B's third-party (owner <> portfolio owner + own_capital).
  -- Both clear the INSERT guard. This pair is what makes 7d and 7e falsifiable.
  INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
  VALUES (port_a, strat_a_shared, 300000);
  INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
  VALUES (port_b, strat_a_shared, 400000);

  -- rev-3 (F4): A's live, legitimately-allocated position that case 7i tries to
  -- re-point. Seeded here rather than reusing another case's row so 7i cannot
  -- silently depend on the flip ordering of 7a/7e/7f.
  INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
  VALUES (port_a, strat_a_repoint, 500000);

  -- Un-mark the legacy strategy AFTER its position exists — this is exactly the
  -- shape of every pre-existing PROD position: a live row whose strategy the
  -- retro Mark path has not reached. Scoped to this fixture's own id.
  --
  -- rev-2 NOTE: trg_strategies_team_review_mark_guard (part 3b) fires on this
  -- statement — the trigger is column-targeted on capital_ownership and fires
  -- regardless of the executing role, so the seeding context gets no pass. It
  -- does not raise because the guard is scoped to transitions INTO
  -- 'team_review', and NULL is not 'team_review' (the function uses IS NOT
  -- DISTINCT FROM so the comparison is explicit rather than a NULL falling
  -- through the IF). Case 7g is the standing positive control for exactly this.
  UPDATE strategies SET capital_ownership = NULL WHERE id = strat_a_legacy;

  RAISE NOTICE 'Seed OK: A=% B=% books=(%, %) (self: own=% team=% null=% legacy=% flip=% shared=% repoint=%) (third-party: null=% own=% team_pub=% team_priv=%)',
    uid_a, uid_b, port_a, port_b, strat_a_own, strat_a_team, strat_a_null, strat_a_legacy,
    strat_a_flip, strat_a_shared, strat_a_repoint,
    strat_b_null, strat_b_own, strat_b_team_pub, strat_b_team_priv;

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
  -- RED-UNDER: make guard_allocation_requires_own_capital() in migration
  --            20260806120000 `RETURN NULL` instead of `RETURN NEW` — a BEFORE row
  --            trigger that returns NULL silently DROPS the write.
  -- ⚠️ SILENT ON PURPOSE. Widening the predicate so this row is REFUSED makes the
  --    unwrapped INSERT above raise, which aborts the file with no TEST FAILED at
  --    all (NO-IDENTITY, not this arm). A dropped write is the observable form of
  --    "the guard over-blocks", and it is what the row count below measures.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20260806120000_strategies_capital_ownership.sql","find":"            HINT = 'Mark the strategy as your own capital in My Strategies before allocating to it.';\n  END IF;\n\n  RETURN NEW;","replace":"            HINT = 'Mark the strategy as your own capital in My Strategies before allocating to it.';\n  END IF;\n\n  RETURN NULL;","occurrences":1}]}
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
  -- RED-UNDER: delete the UNCONDITIONAL team_review arm from the D-03-A predicate
  --            in migration 20260806120000, leaving only "self-owned and unmarked"
  --            — the pre-SC-2b shape, in which a team_review mark blocks nothing.
  -- ⚠️ Case 1 stays GREEN under it: an own_capital self-owned strategy is still
  --    admitted, so the positive control does not shadow this arm.
  -- RED-UNDER-M: {"arm":"2a","apply":[{"kind":"edit","file":"supabase/migrations/20260806120000_strategies_capital_ownership.sql","find":"  IF v_mark = 'team_review'\n     OR (v_strategy_owner = v_portfolio_owner AND v_mark IS DISTINCT FROM 'own_capital') THEN","replace":"  IF (v_strategy_owner = v_portfolio_owner AND v_mark IS NULL) THEN","occurrences":1}]}
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
  -- RED-UNDER: widen the `strategies_read` policy on the live lane database to
  --            `USING (true)`, so allocator A CAN read another owner's private
  --            strategy and the SECURITY DEFINER probe below becomes vacuous.
  -- ⚠️ `sql` steps, not a migration edit: the policy's real home is
  --    20260405061912_rls_policies.sql, which is not in this apply list (it is a
  --    whole-schema RLS migration). The mutation targets the LIVE policy — the
  --    same object, by name — and the guard's own SECURITY DEFINER reads are
  --    unaffected, so only the probe changes. That isolation is the point.
  -- RED-UNDER-M: {"arm":"2c setup","apply":[{"kind":"sql","stmt":"DROP POLICY strategies_read ON public.strategies"},{"kind":"sql","stmt":"CREATE POLICY strategies_read ON public.strategies FOR SELECT TO authenticated USING (true)"}]}
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
  -- RED-UNDER: exempt a NULL mark from the owner-scoped arm in migration
  --            20260806120000 (`AND v_mark IS NOT NULL`), making silence consent —
  --            the exact reading SC 3 refuses.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20260806120000_strategies_capital_ownership.sql","find":"AND v_mark IS DISTINCT FROM 'own_capital') THEN","replace":"AND v_mark IS DISTINCT FROM 'own_capital' AND v_mark IS NOT NULL) THEN","occurrences":1}]}
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
  -- RED-UNDER: the SAME `AND v_mark IS NOT NULL` exemption as case 3, with case 3's
  --            own raise neutered so the upsert is the first failure.
  -- ⚠️ SHADOWED BY DESIGN: case 3 exercises the identical predicate on a plain
  --    INSERT three assertions earlier, so nothing that reaches the upsert path can
  --    leave case 3 green. Case 3 raises exactly once, so ONE neuter entry suffices.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20260806120000_strategies_capital_ownership.sql","find":"AND v_mark IS DISTINCT FROM 'own_capital') THEN","replace":"AND v_mark IS DISTINCT FROM 'own_capital' AND v_mark IS NOT NULL) THEN","occurrences":1}],"neuter":[{"arm":"3"}]}
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
  -- RED-UNDER: add a RESTRICTIVE `FOR UPDATE USING (false)` policy to
  --            portfolio_strategies on the live lane database, so the shipped alias
  --            write matches zero rows and takes silently.
  -- ⚠️ SILENT ON PURPOSE, for the reason in the header: the drift this arm NAMES —
  --    the guard growing an UPDATE arm — RAISES, and this UPDATE is unwrapped, so
  --    the file aborts with no TEST FAILED and the arm is never credited. What the
  --    arm actually measures is `alias_now IS DISTINCT FROM 'my legacy sleeve'`,
  --    and a write that is scoped out is precisely that.
  -- RED-UNDER-M: {"arm":"5","apply":[{"kind":"sql","stmt":"CREATE POLICY portfolio_strategies_update_drift ON public.portfolio_strategies AS RESTRICTIVE FOR UPDATE USING (false)"}]}
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
  -- RED-UNDER: attach a BEFORE INSERT row trigger to portfolio_strategies on the
  --            live lane database that RETURNs NULL when the (portfolio_id,
  --            strategy_id) pair already exists — a second add that neither raises
  --            nor lands.
  -- ⚠️ DROPPING THE PRIMARY KEY, the drift this arm names, is NOT usable: case 4's
  --    `ON CONFLICT (portfolio_id, strategy_id)` then fails inference with 42P10,
  --    which is not a check_violation, is not caught by case 4's handler, and
  --    aborts the file (NO-IDENTITY). The trigger name sorts AFTER
  --    trg_portfolio_strategies_own_capital_only, so the real guard still fires
  --    first everywhere it should — case 4 included.
  -- RED-UNDER-M: {"arm":"6","apply":[{"kind":"sql","stmt":"CREATE OR REPLACE FUNCTION public._pk_drift_skip_duplicate() RETURNS TRIGGER\nLANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $t$\nBEGIN\n  IF EXISTS (SELECT 1 FROM portfolio_strategies ps\n              WHERE ps.portfolio_id = NEW.portfolio_id AND ps.strategy_id = NEW.strategy_id) THEN\n    RETURN NULL;\n  END IF;\n  RETURN NEW;\nEND $t$"},{"kind":"sql","stmt":"CREATE TRIGGER zz_pk_drift_skip_duplicate BEFORE INSERT ON public.portfolio_strategies\n  FOR EACH ROW EXECUTE FUNCTION public._pk_drift_skip_duplicate()"}]}
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
  -- RED-UNDER: make the flip RPC's mark UPDATE match nothing (`AND FALSE`) in
  --            migration 20260806120000, so the atomic pair degrades to a DELETE
  --            with no mark change — (1, 0) instead of (1, 1).
  -- ⚠️ The DELETE is left alone deliberately: suppressing IT instead leaves the
  --    owner's position live, and part 3b then refuses the UPDATE with an unhandled
  --    23514 — an abort, not this arm. All three auth.uid() predicates survive, so
  --    case 7c's structural pin is untouched.
  -- RED-UNDER-M: {"arm":"7a","apply":[{"kind":"edit","file":"supabase/migrations/20260806120000_strategies_capital_ownership.sql","find":"  UPDATE public.strategies\n     SET capital_ownership = 'team_review'\n   WHERE id = p_strategy_id\n     AND user_id = auth.uid();\n  GET DIAGNOSTICS v_updated = ROW_COUNT;","replace":"  UPDATE public.strategies\n     SET capital_ownership = 'team_review'\n   WHERE id = p_strategy_id\n     AND user_id = auth.uid()\n     AND FALSE;\n  GET DIAGNOSTICS v_updated = ROW_COUNT;","occurrences":1}]}
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

  -- ----- 7c: ALL THREE flip auth.uid() predicates are present --------------
  -- Structural, deliberately. Case 7b alone CANNOT catch the removal of the
  -- statement predicates: RLS `strategies_update USING (user_id = auth.uid())`
  -- and `portfolio_strategies_owner USING (...)` independently reduce a
  -- non-owner flip to zero rows, so deleting the in-body predicates leaves 7b
  -- GREEN (measured — mutation M6 of this file's ledger). They are
  -- defence-in-depth, and defence-in-depth that no test can see is
  -- defence-in-depth that gets deleted in the next refactor. They matter the
  -- moment anyone makes this function SECURITY DEFINER or calls it from a
  -- service-role context, where RLS stops helping.
  --
  -- rev-2: the threshold is 3, not 2. The owner precheck (finding F1) added a
  -- third `auth.uid()`; leaving the bar at 2 would let the DELETE's or the
  -- UPDATE's predicate be deleted while the precheck alone kept the count at
  -- the old bar — i.e. this case would have quietly lost half its teeth as a
  -- side effect of the F1 fix. The precheck's own presence is additionally
  -- pinned behaviourally by 7d and structurally by the migration self-check.
  SELECT count(*) INTO row_cnt
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'flip_capital_ownership_to_team_review'
    AND (length(pg_get_functiondef(p.oid))
         - length(replace(pg_get_functiondef(p.oid), 'auth.uid()', ''))) / length('auth.uid()') >= 3;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7c): flip_capital_ownership_to_team_review does not carry all three explicit auth.uid() predicates (owner precheck + DELETE + UPDATE) — RLS currently masks the loss of the statement predicates, so nothing else in this suite would notice';
  END IF;

  -- ----- 7d: NON-OWNER flip WHEN THE CALLER HOLDS A POSITION (F1) ----------
  -- The finding case 7b structurally cannot reach. flip()'s DELETE is scoped to
  -- `portfolios WHERE user_id = auth.uid()` — the CALLER's book, not the
  -- owner's. So before the owner precheck, B calling flip() on A's strategy
  -- deleted B's OWN position and returned (1, 0), while the mark update no-oped
  -- against `strategies_update`. The documented contract said "total no-op
  -- returning (0, 0)". Silent position loss for a bystander who merely happened
  -- to hold the strategy someone else was marking.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT removed_positions, updated_strategies
    INTO v_removed, v_updated
    FROM flip_capital_ownership_to_team_review(strat_a_shared);
  IF v_removed <> 0 OR v_updated <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7d): a NON-OWNER flip on a strategy the CALLER holds affected rows (removed=%, updated=%), expected (0, 0) — the owner precheck is missing and the caller''s own position was destroyed', v_removed, v_updated;
  END IF;
  -- B can only see B's own positions under RLS, which is precisely the row at
  -- risk. Assert it survived while still wearing B's JWT.
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_b AND strategy_id = strat_a_shared;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7d): the non-owner caller''s OWN position was deleted by their flip attempt (% rows remain) — flip() deleted from the caller''s book while failing to update the owner''s mark', row_cnt;
  END IF;
  RESET ROLE;

  -- Owner-side state, read outside B's RLS: mark untouched, A's position intact.
  SELECT capital_ownership INTO mark_now FROM strategies WHERE id = strat_a_shared;
  IF mark_now IS DISTINCT FROM 'own_capital' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7d): a NON-OWNER flip changed the owner''s mark to %', COALESCE(mark_now, '<null>');
  END IF;
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_a_shared;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7d): a NON-OWNER flip removed the OWNER''s position (% rows remain)', row_cnt;
  END IF;

  -- ----- 7e: a THIRD-PARTY position SURVIVES the owner's flip (F3) ---------
  -- Accepted narrowing, migration header (g): 'team_review' means "never NEWLY
  -- allocatable", not "zero rows referencing it exist". The owner's flip clears
  -- the owner's book and nothing else, because the alternative is a
  -- cross-tenant DELETE in which one allocator's bookkeeping silently rewrites
  -- another's portfolio. Pinned here so nobody "closes the gap".
  --
  -- This case doubles as the ORDERING proof for part 3b: the flip's UPDATE into
  -- 'team_review' is admitted only because its DELETE already cleared the
  -- owner-scoped count to zero, WHILE B's third-party position is still live —
  -- i.e. the guard's owner-scoping is what lets a flip happen at all here.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT removed_positions, updated_strategies
    INTO v_removed, v_updated
    FROM flip_capital_ownership_to_team_review(strat_a_shared);
  IF v_removed <> 1 OR v_updated <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7e): the OWNER''s flip returned (removed=%, updated=%), expected (1, 1) — a third-party position must neither be deleted nor block the flip', v_removed, v_updated;
  END IF;
  RESET ROLE;

  SELECT capital_ownership INTO mark_now FROM strategies WHERE id = strat_a_shared;
  IF mark_now IS DISTINCT FROM 'team_review' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7e): after the owner''s flip the mark is %, expected team_review — part 3b''s guard must be OWNER-scoped, not strategy-wide, or a third party can hold an owner''s flip hostage', COALESCE(mark_now, '<null>');
  END IF;
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_a_shared;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7e): the owner''s own position survived their flip (% rows)', row_cnt;
  END IF;
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_b AND strategy_id = strat_a_shared;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7e): a THIRD-PARTY position was destroyed by the owner''s flip (% rows remain, expected 1) — a flip must never touch another allocator''s book (migration header (g))', row_cnt;
  END IF;

  -- ----- 7f: raw UPDATE into team_review with a live position -> RAISEs (F2)
  -- `strategies_update USING (user_id = auth.uid())` lets the owner PATCH this
  -- column straight through PostgREST. Before part 3b, that stranded every live
  -- position on a team-review strategy — the precise hole the flip RPC exists
  -- to close, reachable without ever calling it, so SC 2b held on the INSERT
  -- side only. strat_a_own still carries the position minted in case 1.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  raised := FALSE;
  BEGIN
    UPDATE strategies SET capital_ownership = 'team_review' WHERE id = strat_a_own;
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7f): a raw UPDATE marked a strategy team_review while the owner''s position was live — the position is now stranded and SC 2b is INSERT-only';
  END IF;
  -- Subtransaction rollback: neither the mark nor the position moved.
  SELECT capital_ownership INTO mark_now FROM strategies WHERE id = strat_a_own;
  IF mark_now IS DISTINCT FROM 'own_capital' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7f): the blocked UPDATE still changed the mark to %', COALESCE(mark_now, '<null>');
  END IF;
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_a_own;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7f): the blocked UPDATE disturbed the position (% rows)', row_cnt;
  END IF;

  -- The SANCTIONED route to the same end state must still be open. Same row,
  -- same session, one statement later: the guard blocks the write that strands
  -- and admits the transaction that does not.
  SELECT removed_positions, updated_strategies
    INTO v_removed, v_updated
    FROM flip_capital_ownership_to_team_review(strat_a_own);
  IF v_removed <> 1 OR v_updated <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7f): the flip RPC returned (removed=%, updated=%) on a row the raw UPDATE was refused for, expected (1, 1) — part 3b must not block the sanctioned path (it DELETEs before it UPDATEs)', v_removed, v_updated;
  END IF;
  RESET ROLE;

  SELECT capital_ownership INTO mark_now FROM strategies WHERE id = strat_a_own;
  IF mark_now IS DISTINCT FROM 'team_review' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7f): after the sanctioned flip the mark is %, expected team_review', COALESCE(mark_now, '<null>');
  END IF;

  -- ----- 7g: POSITIVE CONTROL for part 3b ----------------------------------
  -- Transitions that are NOT into 'team_review' must pass even with a live
  -- position. Without this case a guard that raised on EVERY capital_ownership
  -- UPDATE would leave 7f green while killing the retro Mark path (D-09/D-11)
  -- and the un-mark step this very file seeds with. strat_a_legacy is the exact
  -- shape: NULL mark, live position.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  UPDATE strategies SET capital_ownership = 'own_capital' WHERE id = strat_a_legacy;
  SELECT capital_ownership INTO mark_now FROM strategies WHERE id = strat_a_legacy;
  IF mark_now IS DISTINCT FROM 'own_capital' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7g): marking a strategy own_capital with a live position did not take (mark=%) — part 3b must guard the transition INTO team_review only, or the retro Mark path is dead', COALESCE(mark_now, '<null>');
  END IF;

  -- ...and back to NULL, the seed's own shape, restated as an assertion.
  UPDATE strategies SET capital_ownership = NULL WHERE id = strat_a_legacy;
  SELECT capital_ownership INTO mark_now FROM strategies WHERE id = strat_a_legacy;
  IF mark_now IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7g): un-marking a strategy with a live position did not take (mark=%) — NULL is not team_review and must pass the guard', mark_now;
  END IF;
  RESET ROLE;

  -- ----- 7h: part 3b's guard is SECURITY DEFINER with a pinned search_path --
  -- Structural, for the same reason 7c is (this file's M6 lesson): NO
  -- behavioural case in this suite can see the loss. Every UPDATE that reaches
  -- this guard today comes from the OWNER — `strategies_update USING (user_id =
  -- auth.uid())` permits no one else — and an owner can always read their own
  -- portfolios, so a SECURITY INVOKER guard counts exactly the same rows and 7f
  -- stays green (measured, mutation M19). It stops being the same the moment a
  -- service-role or admin path marks a strategy from a context that cannot see
  -- the owner's book: INVOKER would read zero positions and strand them, which
  -- is precisely the failure this trigger exists to prevent.
  SELECT count(*) INTO row_cnt
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'guard_team_review_mark_no_stranded_positions'
    AND p.prosecdef
    AND p.proconfig @> ARRAY['search_path=public, pg_catalog'];
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7h): guard_team_review_mark_no_stranded_positions() is not SECURITY DEFINER with a pinned search_path — under INVOKER its position count is RLS-filtered by the updating session, and no behavioural case in this file can see the difference';
  END IF;

  -- ----- 7i: REPOINTING an existing position -> RAISEs (rev-3, finding F4) --
  -- THE THIRD ROUTE INTO THE STRANDED STATE, and the one both rev-2 guards are
  -- structurally blind to. An owner PATCHes `portfolio_strategies.strategy_id`
  -- on a LIVE position — permitted outright by `portfolio_strategies_owner`
  -- FOR ALL USING (portfolio owned by auth.uid()) — moving it onto a
  -- team_review or self-owned unmarked strategy. No INSERT happens, so the
  -- BEFORE INSERT D-03-A trigger never fires; `strategies.capital_ownership` is
  -- never written, so part 3b's mark-transition guard never fires either. The
  -- end state is byte-for-byte the state case 2a and case 3 prove is forbidden,
  -- reached by a door neither of them watches. Closed by
  -- trg_portfolio_strategies_own_capital_on_repoint (BEFORE UPDATE OF
  -- strategy_id), which REUSES the same guard function.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Non-vacuity first: if the source row were missing or already moved, both
  -- UPDATEs below would match ZERO rows and the case would pass without ever
  -- reaching a trigger.
  -- RED-UNDER: change THIS FILE's own seed of the repoint source position from
  --            500000 to 500001, so the non-vacuity probe below finds no row at
  --            the amount it asserts.
  -- ⚠️ The only gate-file edit in this file, and the right target: this arm's
  --    subject is the FIXTURE it stands on, not a production object — it exists
  --    to refuse a vacuous pass when the source row is not where 7i expects it.
  --    No failure branch is touched (rule 3b); the seed statement is.
  -- ⚠️ The needle spans TWO lines on purpose. A single-line needle for a gate-file
  --    edit is reproduced VERBATIM inside this annotation's own JSON, so the
  --    measured `occurrences` becomes 1 before the twin is written and 2 after —
  --    a self-inflicted MEASURE_FAIL (observed here). JSON encodes the newline as
  --    \n, so a multi-line literal never appears in the file.
  -- RED-UNDER-M: {"arm":"7i setup","apply":[{"kind":"edit","file":"supabase/tests/test_capital_ownership_allocation_guard.sql","find":"  INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)\n  VALUES (port_a, strat_a_repoint, 500000);","replace":"  INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)\n  VALUES (port_a, strat_a_repoint, 500001);","occurrences":1}]}
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_a_repoint
     AND allocated_amount = 500000;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7i setup): the repoint source position is not live as seeded (% rows at 500000) — the UPDATEs below would match nothing and pass vacuously', row_cnt;
  END IF;

  -- 7i-1: repoint onto a team_review strategy (ARM 1, unconditional).
  raised := FALSE;
  BEGIN
    UPDATE portfolio_strategies
       SET strategy_id = strat_a_team
     WHERE portfolio_id = port_a AND strategy_id = strat_a_repoint;
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7i): an existing position was RE-POINTED at a team_review strategy — D-03-A is INSERT-scoped again and the invariant is reachable by UPDATE (rev-3 finding F4)';
  END IF;

  -- 7i-2: repoint onto a SELF-OWNED UNMARKED strategy (ARM 2). Both arms must
  -- hold on the repoint event, or the hole is only half closed.
  raised := FALSE;
  BEGIN
    UPDATE portfolio_strategies
       SET strategy_id = strat_a_null
     WHERE portfolio_id = port_a AND strategy_id = strat_a_repoint;
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7i): an existing position was RE-POINTED at a SELF-OWNED UNMARKED strategy — silence is not consent on the UPDATE side either (SC 3)';
  END IF;

  -- Subtransaction rollback: the original row is exactly where it was.
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_a_repoint
     AND allocated_amount = 500000;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7i): the blocked repoint disturbed the original position (% rows still at (port_a, strat_a_repoint, 500000))', row_cnt;
  END IF;
  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_a
     AND strategy_id IN (strat_a_team, strat_a_null);
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7i): % position row(s) landed on a forbidden strategy after the blocked repoint', row_cnt;
  END IF;

  -- POSITIVE CONTROL — case 5's shape, re-asserted now that the repoint trigger
  -- exists. `UPDATE OF strategy_id` fires only when the statement's SET list
  -- NAMES strategy_id, so the shipped alias write on a legacy unmarked position
  -- must still succeed. If this reddens, the repoint trigger has lost its
  -- column target and Pitfall 2 is reopened for every pre-existing PROD row.
  UPDATE portfolio_strategies SET alias = 'rev-3 alias still writable'
   WHERE portfolio_id = port_a AND strategy_id = strat_a_legacy;
  SELECT alias INTO alias_now
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_a_legacy;
  IF alias_now IS DISTINCT FROM 'rev-3 alias still writable' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (7i): the alias UPDATE on a legacy unmarked position stopped working (alias=%) — the repoint trigger must be column-targeted on strategy_id, never a blanket UPDATE arm', COALESCE(alias_now, '<null>');
  END IF;
  RESET ROLE;

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
  -- RED-UNDER: attach a BEFORE INSERT row trigger to portfolio_strategies on the
  --            live lane database that RETURNs NULL for a THIRD-PARTY row whose
  --            strategy is not marked own_capital — the blanket
  --            `IS DISTINCT FROM 'own_capital'` predicate, in its silent form.
  -- ⚠️ SILENT ON PURPOSE (header): the blanket predicate itself REFUSES this row,
  --    and the INSERT above is unwrapped, so the file aborts with no TEST FAILED.
  -- ⚠️ Scoped to `IS DISTINCT FROM 'own_capital'` so the seed's third-party
  --    own_capital position (port_b, strat_a_shared) survives — 7d and 7e stand on
  --    it, and dropping it would fire them first.
  -- RED-UNDER-M: {"arm":"8a","apply":[{"kind":"sql","stmt":"CREATE OR REPLACE FUNCTION public._third_party_drift_skip() RETURNS TRIGGER\nLANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $t$\nDECLARE v_mark TEXT; v_strategy_owner UUID; v_portfolio_owner UUID;\nBEGIN\n  SELECT s.capital_ownership, s.user_id INTO v_mark, v_strategy_owner\n    FROM public.strategies s WHERE s.id = NEW.strategy_id;\n  SELECT p.user_id INTO v_portfolio_owner FROM portfolios p WHERE p.id = NEW.portfolio_id;\n  IF v_strategy_owner IS DISTINCT FROM v_portfolio_owner\n     AND v_mark IS DISTINCT FROM 'own_capital' THEN\n    RETURN NULL;\n  END IF;\n  RETURN NEW;\nEND $t$"},{"kind":"sql","stmt":"CREATE TRIGGER zz_third_party_drift_skip BEFORE INSERT ON public.portfolio_strategies\n  FOR EACH ROW EXECUTE FUNCTION public._third_party_drift_skip()"}]}
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

  RAISE NOTICE 'test_capital_ownership_allocation_guard: ALL PASS (D-03-A both arms, SECURITY DEFINER probe, upsert arm, legacy-alias + third-party regressions, composite PK, atomic flip, owner precheck, third-party survival, raw-UPDATE mark-transition guard + its positive control, repoint guard + its alias positive control).';
END
$$;

ROLLBACK;
