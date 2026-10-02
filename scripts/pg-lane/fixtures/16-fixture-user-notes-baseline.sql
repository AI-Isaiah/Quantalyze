-- Additive stand-in that lets the REAL user_notes migrations be the thing under
-- test for `test_user_notes_dashboard_scope.sql`. Apply AFTER 01/02 and BEFORE
-- 20260412094453_user_notes.sql. Never a second base.
--
-- ⭐ WHY THE STAND-IN TABLE IS DROPPED, AND WHY THAT IS THE ANTI-VACUITY MOVE.
-- 02-fixture-sanitize-tables.sql:30 declares `CREATE TABLE IF NOT EXISTS
-- user_notes (user_id UUID)` — a one-column stand-in whose only job is to give
-- sanitize_user something to delete from. The real table is created by
-- 20260412094453 with `CREATE TABLE IF NOT EXISTS`, so with the stand-in present
-- the real CREATE is a NO-OP and every object this gate asserts on — the
-- scope_kind CHECK, the four owner policies, RLS itself — would be missing or
-- absent from a table that nonetheless exists. Dropping the stand-in lets the
-- REAL migrations define the objects the arms name. This is the same defect
-- class plan 164.4-06 measured on 01-fixture-core.sql's narrower
-- `strategies_read`: a stand-in NARROWER than production does not merely
-- under-test, it makes arms unfalsifiable while the file prints PASS.
DROP TABLE IF EXISTS public.user_notes;

-- portfolios needs a key for 20260412094453's `portfolio_id UUID REFERENCES
-- portfolios` FK. 02-fixture-sanitize-tables.sql creates `portfolios` without
-- one; 03-fixture-compute-jobs.sql adds the id column but is not in this gate's
-- apply list (nothing here touches compute_jobs).
ALTER TABLE public.portfolios ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.portfolios'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.portfolios ADD PRIMARY KEY (id);
  END IF;
END $$;
