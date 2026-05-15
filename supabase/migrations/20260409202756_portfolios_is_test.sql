-- Migration 023: distinguish the allocator's single REAL portfolio from
-- saved TEST portfolios (hypothetical what-if scenarios).
--
-- The My Allocation restructure pins a key product invariant: every
-- allocator has exactly ONE real invested book, composed of strategies,
-- which is what the /allocations page shows. Everything else is a saved
-- hypothetical, shown on the renamed /portfolios page ("Test Portfolios").
-- This migration makes that distinction explicit:
--
--   portfolios.is_test BOOLEAN NOT NULL DEFAULT false
--
-- and enforces the invariant at the database level via a partial unique
-- index, so any code path that accidentally tries to insert a second real
-- portfolio for the same user fails fast with a 23505 unique violation
-- instead of silently corrupting the allocator's mental model.
--
-- Backfill uses the full-app demo seed convention: "Active Allocation" is
-- the real portfolio, anything with a "What-if:" name prefix is a saved
-- scenario. Any other pre-existing rows default to real and the partial
-- unique index catches collisions.

-- Idempotent: every ALTER TABLE / CREATE INDEX uses IF NOT EXISTS so
-- re-running the migration (which can happen on fresh staging pulls or
-- a partially-applied CI run) does not crash. Matches the convention in
-- migrations 009, 012, 014, 016.
ALTER TABLE public.portfolios
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.portfolios.is_test IS
  'Kept for future use. v0.4.0 pivoted away from a Test Portfolios surface (Scenarios replaces what-if exploration), but the partial unique index portfolios_one_real_per_user is still valuable: it enforces at most one real portfolio per user_id at the DB level, which is the My Allocation invariant.';

-- Backfill: seed convention is "Active Allocation" = real,
-- "What-if: ..." = test. Case-insensitive match to be kind to future
-- typos in hand-created rows. WHERE is_test = false guard keeps this
-- idempotent on re-run (UPDATE becomes a no-op once backfilled).
UPDATE public.portfolios
   SET is_test = true
 WHERE name ILIKE 'what-if%'
   AND is_test = false;

-- Enforce "at most one REAL portfolio per user" at the DB level.
-- Partial unique index only applies to is_test = false rows.
CREATE UNIQUE INDEX IF NOT EXISTS portfolios_one_real_per_user
  ON public.portfolios (user_id)
  WHERE is_test = false;

-- Self-verifying assertion: if the backfill left any user with more than
-- one real portfolio, the CREATE INDEX above would have failed with a
-- duplicate-key error. This extra check surfaces a clearer error message
-- in case that failure mode ever triggers in a future re-run.
DO $$
DECLARE
  rogue_count integer;
BEGIN
  SELECT COUNT(*)
    INTO rogue_count
    FROM (
      SELECT user_id
        FROM public.portfolios
       WHERE is_test = false
       GROUP BY user_id
      HAVING COUNT(*) > 1
    ) rogue;

  IF rogue_count > 0 THEN
    RAISE EXCEPTION
      'Migration 023 failed: % users have multiple real portfolios after backfill. Inspect and reconcile manually before retrying.',
      rogue_count;
  END IF;
END $$;
