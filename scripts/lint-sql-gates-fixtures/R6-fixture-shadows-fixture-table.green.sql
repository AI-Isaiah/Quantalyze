-- GREEN FIXTURE for R6-fixture-shadows-fixture-table — the repaired idiom,
-- quoted from `scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql:39-53`.
--
-- This is the SAME collision the red twin demonstrates, on a pair that solved
-- it. `02-fixture-sanitize-tables.sql:32` declares `CREATE TABLE IF NOT EXISTS
-- user_app_roles (user_id UUID)` — one column, no `role`. `20-fixture-app-role-
-- helper.sql` then creates the real four-column table, and its create no-ops
-- when 02 landed first. Fixture 20 is nonetheless correct in EITHER order,
-- because it re-adds every column 02's stand-in lacks:
--
--     ALTER TABLE user_app_roles
--       ADD COLUMN IF NOT EXISTS role       TEXT,
--       ADD COLUMN IF NOT EXISTS granted_by UUID,
--       ADD COLUMN IF NOT EXISTS granted_at TIMESTAMPTZ NOT NULL DEFAULT now();
--
-- `user_id` needs no re-add: 02's own create already provides it. That is why
-- the rule compares the LATER create's columns against the EARLIER create's
-- rather than demanding a re-add of all four — demanding all four would have
-- flagged the file that fixed the class, which is how a rule earns a waiver it
-- should never have needed.
--
-- Its header (:39-44) states the contract this fixture encodes: "ORDER-ROBUST
-- ON PURPOSE ... Whichever of the two files lands first, the other's create
-- no-ops, so the CREATE alone would leave the helper's body raising 42703 on
-- `role` at CALL time (an arm would then abort on a raw driver error naming no
-- arm, instead of failing as itself)."
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql"]}

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'user_app_roles') THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R6): user_app_roles does not exist';
  END IF;
END $$;

COMMIT;
