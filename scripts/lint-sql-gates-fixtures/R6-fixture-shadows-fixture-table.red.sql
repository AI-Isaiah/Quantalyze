-- RED FIXTURE for R6-fixture-shadows-fixture-table (mechanism 6).
--
-- ⭐ REAL FILES, REAL SHAPE, ONE THING CHANGED: THE ORDER. Both entries below
-- are real pg-lane fixtures, and both really do create `portfolio_strategies`:
--
--   `06-fixture-portfolio-strategies.sql` creates it with the columns the
--   allocator gates read — `allocated_amount`, `alias`, `added_at`.
--   `10-fixture-strategies-rls-baseline.sql:44+` creates an EMPTY stand-in of
--   the same name, whose column set is deliberately "only what
--   20260405061912's own policy predicates name — nothing else".
--
-- Listed in this order, 10's empty stand-in lands FIRST, 06's CREATE TABLE IF
-- NOT EXISTS is a silent no-op, and `allocated_amount`, `alias` and `added_at`
-- never exist. An arm reading them aborts on a raw 42703 that names no arm at
-- all — a gate that fails without being able to say what failed. No real gate
-- lists the two in this order today (MEASURED: zero apply lists in
-- `supabase/tests/` contain both), which is precisely why nothing but this rule
-- would notice if one started to.
--
-- ⚠️ CAUSALITY, not coincidence: the SAME two files in the opposite order are
-- clean, and `src/__tests__/lint-sql-gates.test.ts` asserts that counterfactual
-- so this fixture cannot be passing for an incidental reason.
--
-- The escape this rule honours is the fixture-20 idiom — see the green twin.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","scripts/pg-lane/fixtures/06-fixture-portfolio-strategies.sql"]}

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'portfolio_strategies') THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R6): portfolio_strategies does not exist';
  END IF;
END $$;

COMMIT;
