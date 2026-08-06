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
