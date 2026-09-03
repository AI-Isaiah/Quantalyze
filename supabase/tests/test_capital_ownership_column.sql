-- Test for the Phase 150 OWN-03 capital-ownership COLUMN SHAPE:
--   * 20260806120000_strategies_capital_ownership.sql (part 2 — column + CHECK)
--
-- What this asserts, and why the SHAPE (not just existence) is the assertion
-- -------------------------------------------------------------------------
-- The load-bearing decision in OWN-03 is not "a column exists" — it is that the
-- column is NULLABLE with NO DEFAULT and was never backfilled. A
-- `DEFAULT 'team_review' NOT NULL` would stamp every pre-existing strategy
-- (Black Swan, Alpha Centauri, Arctic Fox) as "a trading team's key I am
-- verifying" — a fabricated claim about the founder's own capital, and a direct
-- violation of the project-wide no-invented-data invariant. A future "tidy-up"
-- migration that adds a default would leave every other test in this phase
-- GREEN. This file is the only thing that reddens.
--
-- Assertions:
--   1. `strategies.capital_ownership` exists and is TEXT.
--   2. It is NULLABLE (is_nullable = 'YES').
--   3. It has NO column default.
--   4. CHECK constraint `strategies_capital_ownership_check` exists and its
--      definition names BOTH 'own_capital' and 'team_review'.
--   5. A value outside the set is REJECTED with check_violation (23514) — the
--      constraint is enforced, not merely declared.
--   6. Both set members AND NULL are ACCEPTED (positive control; without this,
--      assertion 5 could pass because the column rejects everything).
--   7. NO BACKFILL: strategies created without naming the column land NULL.
--
-- pgTAP is NOT installed in this project (zero of the 53 supabase/tests/*.sql
-- files use plan/ok/finish). The house convention is plain PL/pgSQL
-- `DO $$ ... $$` with RAISE EXCEPTION on failure / RAISE NOTICE on pass. Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. No psql backslash
-- meta-commands. Filename matches the `test_*.sql` glob so the job discovers it.
--
-- Hygiene (shared TEST DB): every fixture row is created inside this test's own
-- transaction with its own generated UUIDs, every mutation predicate names those
-- ids, and the transaction ends in ROLLBACK. No table-wide UPDATE or DELETE.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_capital_ownership_column.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4). Each prose RED-UNDER below an arm
-- carries an adjacent `RED-UNDER-M` object that scripts/mutation-runner executes:
-- it mutates COPIES on a throwaway pg-lane cluster, requires the FIRST
-- `TEST FAILED (…)` to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md. The line below declares what the lane
-- applies before this gate. It is this gate's SIBLING list — byte-identical to
-- test_capital_ownership_allocation_guard.sql's, discovered there over 5 lane runs
-- and GREEN here on the FIRST iteration; mean 0.96 s/lane over 3 timed GREEN runs.
--
-- ⚠️ MOST TWINS BELOW ARE `sql` STEPS BECAUSE THE MIGRATION SELF-VERIFIES.
-- 20260806120000's post-verify 5a re-asserts that the CHECK names BOTH members
-- and 5b that the column is nullable with no default, so a migration edit aimed
-- at assertions 2, 3 or 4 aborts the apply and never reaches the gate. The two it
-- does NOT cover — the column's TYPE and the CHECK's out-of-set closure — are
-- migration edits, as authoring rule 2 requires wherever it can bind.
--
-- ⚠️ ASSERTIONS 6a/6b/6c AND 7 ARE POSITIVE CONTROLS WITH NO HANDLER. The drift
-- their prose names (a CHECK that refuses the value, a NOT NULL, a DEFAULT)
-- either RAISES outside any handler — which aborts the file with no
-- `TEST FAILED (…)` at all and scores NO-IDENTITY rather than the arm biting
-- (MEASURED in plan 164.4-05 on test_scenario_shares_rls.sql Assertion 7) — or
-- trips assertion 2/3 first. Their twins therefore use the SILENT form: a BEFORE
-- INSERT trigger that drops or stamps the value, which is exactly what
-- `got % matching rows` measures.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/06-fixture-portfolio-strategies.sql","supabase/migrations/20260806120000_strategies_capital_ownership.sql"]}

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- ON DELETE CASCADE chains auth.users -> profiles -> strategies, so deleting
-- auth.users by this test's OWN sentinel email drops the whole subtree. Scoped
-- to one address that no other test or seed uses.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email = 'test-capital-ownership-column@quantalyze.test';

BEGIN;

DO $$
DECLARE
  uid_a      UUID := gen_random_uuid();
  strat_id   UUID;
  def        TEXT;
  col_type   TEXT;
  col_null   TEXT;
  col_def    TEXT;
  row_cnt    INTEGER;
  raised     BOOLEAN;
BEGIN
  -- ----- SEED (seeding/service-role context — bypasses RLS) ----------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-capital-ownership-column@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'capital-ownership column owner',
          'test-capital-ownership-column@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  -- ----- 1/2/3: column exists, is TEXT, is nullable, has NO default ---------
  -- RED-UNDER: (assertion 1) retype the column in migration 20260806120000 from TEXT to
  --            VARCHAR(32) — the one shape claim of assertions 1/2/3 that the
  --            migration's own post-verify 5b does NOT re-read, so the edit
  --            applies cleanly and the gate is the only thing that reddens.
  -- RED-UNDER: (assertion 2) `ALTER TABLE public.strategies ALTER COLUMN capital_ownership
  --            SET NOT NULL` on the LIVE database — the "tidy-up" that forces a
  --            fabricated value onto every legacy row. A `sql` step: post-verify
  --            5b re-reads is_nullable, so a migration edit aborts the apply.
  -- RED-UNDER: (assertion 3) `… SET DEFAULT 'team_review'` on the LIVE database — the exact
  --            drift this file's header says nothing else reddens on. `sql` step
  --            for the same reason as (2).
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20260806120000_strategies_capital_ownership.sql","find":"  ADD COLUMN IF NOT EXISTS capital_ownership TEXT;","replace":"  ADD COLUMN IF NOT EXISTS capital_ownership VARCHAR(32);","occurrences":1}]}
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"sql","stmt":"ALTER TABLE public.strategies ALTER COLUMN capital_ownership SET NOT NULL"}]}
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"sql","stmt":"ALTER TABLE public.strategies ALTER COLUMN capital_ownership SET DEFAULT 'team_review'"}]}
  SELECT data_type, is_nullable, column_default
    INTO col_type, col_null, col_def
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'strategies'
    AND column_name = 'capital_ownership';

  IF col_type IS NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (1): strategies.capital_ownership does not exist — migration 20260806120000 not applied';
  END IF;
  IF col_type <> 'text' THEN
    RAISE EXCEPTION
      'TEST FAILED (1): strategies.capital_ownership is %, expected text', col_type;
  END IF;
  IF col_null <> 'YES' THEN
    RAISE EXCEPTION
      'TEST FAILED (2): strategies.capital_ownership is NOT NULL — legacy rows would need a fabricated value (no-invented-data)';
  END IF;
  IF col_def IS NOT NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (3): strategies.capital_ownership has a column default (%) — a default stamps every legacy strategy with a claim nobody made', col_def;
  END IF;

  -- ----- 4: CHECK constraint exists and names BOTH members ------------------
  -- RED-UNDER: rebuild the LIVE CHECK without 'team_review'. A `sql` step, not a
  --            migration edit: post-verify 5a re-reads the constraint definition
  --            for BOTH members, so the edit would abort the apply.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"sql","stmt":"ALTER TABLE public.strategies DROP CONSTRAINT strategies_capital_ownership_check, ADD CONSTRAINT strategies_capital_ownership_check CHECK (capital_ownership IS NULL OR capital_ownership = 'own_capital')"}]}
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conname = 'strategies_capital_ownership_check'
    AND conrelid = 'public.strategies'::regclass;

  IF def IS NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (4): constraint strategies_capital_ownership_check not found';
  END IF;
  IF position('own_capital' IN def) = 0 OR position('team_review' IN def) = 0 THEN
    RAISE EXCEPTION
      'TEST FAILED (4): strategies_capital_ownership_check is missing a member value (def=%)', def;
  END IF;

  -- ----- 6a: 'own_capital' is ACCEPTED (positive control) -------------------
  -- RED-UNDER: a BEFORE INSERT trigger on strategies that DROPS an 'own_capital'
  --            mark to NULL on the LIVE database.
  -- ⚠️ SILENT ON PURPOSE. This arm is a POSITIVE CONTROL and its INSERT carries no
  --            handler, so the drift its prose would name — a CHECK that refuses
  --            'own_capital' — aborts the file on an unhandled 23514 with no
  --            `TEST FAILED (…)` at all and scores NO-IDENTITY, not this arm
  --            biting (MEASURED in plan 164.4-05). A trigger that drops the write
  --            instead of refusing it is what `got % matching rows` can see.
  --            Scoped to 'own_capital' so 6b, 6c, 7 and 5 still read as intended.
  -- RED-UNDER-M: {"arm":"6a","apply":[{"kind":"sql","stmt":"DO $x$ BEGIN CREATE OR REPLACE FUNCTION public._m1644_drop_own_capital() RETURNS TRIGGER LANGUAGE plpgsql AS $f$ BEGIN IF NEW.capital_ownership = 'own_capital' THEN NEW.capital_ownership := NULL; END IF; RETURN NEW; END $f$; CREATE TRIGGER _m1644_drop_own_capital BEFORE INSERT ON public.strategies FOR EACH ROW EXECUTE FUNCTION public._m1644_drop_own_capital(); END $x$"}]}
  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'capital-ownership own', 'private', 'own_capital',
          '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_id;
  SELECT count(*) INTO row_cnt
    FROM strategies WHERE id = strat_id AND capital_ownership = 'own_capital';
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION
      'TEST FAILED (6a): own_capital did not persist (got % matching rows)', row_cnt;
  END IF;

  -- ----- 6b: 'team_review' is ACCEPTED (positive control) -------------------
  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'capital-ownership team', 'private', 'team_review',
          '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_id;
  SELECT count(*) INTO row_cnt
    FROM strategies WHERE id = strat_id AND capital_ownership = 'team_review';
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION
      'TEST FAILED (6b): team_review did not persist (got % matching rows)', row_cnt;
  END IF;

  -- ----- 6c: explicit NULL is ACCEPTED --------------------------------------
  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'capital-ownership explicit null', 'private', NULL,
          '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_id;
  SELECT count(*) INTO row_cnt
    FROM strategies WHERE id = strat_id AND capital_ownership IS NULL;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION
      'TEST FAILED (6c): an explicit NULL capital_ownership was rejected or coerced — the CHECK must admit NULL (three display states, two logic states)';
  END IF;

  -- ----- 7: NO BACKFILL — an unnamed column lands NULL, not a default -------
  -- RED-UNDER: a BEFORE INSERT trigger on strategies that STAMPS 'team_review'
  --            onto any NULL capital_ownership on the LIVE database — a backfill
  --            wearing a trigger instead of a column DEFAULT, so assertion 3 stays
  --            green and only this arm can see it.
  -- ⚠️ SILENT ON PURPOSE, and it needs a `neuter`. 6c and 7 both insert a NULL
  --            capital_ownership and are INDISTINGUISHABLE to any trigger — 6c
  --            names the column explicitly, 7 omits it, and the row reaching the
  --            trigger is identical. So the stamp reddens 6c FIRST; 6c's raise is
  --            neutered on this arm's lane so 7 is the first failure. Neither
  --            assertion is weakened: 6c carries its own twin under section 6a's
  --            SECTION, and this file's own run judges every section.
  -- RED-UNDER-M: {"arm":"7","apply":[{"kind":"sql","stmt":"DO $x$ BEGIN CREATE OR REPLACE FUNCTION public._m1644_stamp_team_review() RETURNS TRIGGER LANGUAGE plpgsql AS $f$ BEGIN IF NEW.capital_ownership IS NULL THEN NEW.capital_ownership := 'team_review'; END IF; RETURN NEW; END $f$; CREATE TRIGGER _m1644_stamp_team_review BEFORE INSERT ON public.strategies FOR EACH ROW EXECUTE FUNCTION public._m1644_stamp_team_review(); END $x$"}],"neuter":[{"arm":"6c"}]}
  INSERT INTO strategies (user_id, name, status,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'capital-ownership unnamed', 'private',
          '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_id;
  SELECT count(*) INTO row_cnt
    FROM strategies WHERE id = strat_id AND capital_ownership IS NULL;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION
      'TEST FAILED (7): a strategy created without naming capital_ownership did not land NULL — something is stamping a value legacy rows never claimed';
  END IF;

  -- ----- 5: a value OUTSIDE the set is REJECTED with check_violation --------
  -- Catching check_violation SPECIFICALLY (23514) means an unrelated failure
  -- (NOT NULL, FK, RLS) cannot false-pass this assertion.
  -- RED-UNDER: widen the CHECK in migration 20260806120000 to admit 'lp_capital'.
  --            A migration edit, not a `sql` step: post-verify 5a only requires
  --            the definition to NAME both members, which a widened IN-list still
  --            does, so the apply succeeds and assertion 4 stays green — this arm
  --            is the only thing that reddens.
  -- RED-UNDER-M: {"arm":"5","apply":[{"kind":"edit","file":"supabase/migrations/20260806120000_strategies_capital_ownership.sql","find":"  CHECK (capital_ownership IN ('own_capital', 'team_review'));","replace":"  CHECK (capital_ownership IN ('own_capital', 'team_review', 'lp_capital'));","occurrences":1}]}
  raised := FALSE;
  BEGIN
    INSERT INTO strategies (user_id, name, status, capital_ownership,
                            strategy_types, subtypes, markets, supported_exchanges)
    VALUES (uid_a, 'capital-ownership bogus', 'private', 'lp_capital',
            '{}', '{}', '{}', ARRAY['binance']);
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION
      'TEST FAILED (5): capital_ownership accepted the out-of-set value ''lp_capital'' — the CHECK constraint is not enforcing';
  END IF;

  RAISE NOTICE 'test_capital_ownership_column: ALL PASS (nullable, no default, no backfill, CHECK enforced on both members).';
END
$$;

ROLLBACK;
