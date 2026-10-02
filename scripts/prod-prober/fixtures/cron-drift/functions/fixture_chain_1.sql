-- FIXTURE, hand-written in the shape `scripts/dump-sql-functions.ts` emits.
-- Not @generated. See README.md in this directory.
--
-- ⛔ ONE LINK OF THE F6 DEPTH-MEMOISATION CHAIN. Reached through
-- `fixture_chain_1` the walk arrives at `fixture_shared` at depth 5 — the cap —
-- so `fixture_shared`'s own callee is truncated. `visited` used to be a Set, so
-- that truncated exploration memoised `false` for `fixture_shared`, and the
-- SECOND, depth-0 approach to it returned the memo without exploring. It is now
-- a Map of name -> shallowest depth explored. Deleting any link of this chain
-- shortens it below the cap and the control stops measuring anything.

-- source migration: (none — fixture)
CREATE OR REPLACE FUNCTION public.fixture_chain_1()
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM public.fixture_chain_2();
END;
$fn$;
