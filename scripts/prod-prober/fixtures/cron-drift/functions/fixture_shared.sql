-- FIXTURE, hand-written in the shape `scripts/dump-sql-functions.ts` emits.
-- Not @generated. See README.md in this directory.
--
-- ⛔ THE SHARED NODE OF THE F6 DEPTH-MEMOISATION CHAIN. It READS Vault — through
-- `fixture_vault_reader`, one edge away — so a walk that reaches it with budget
-- to spare must answer ACCEPT. Reached at the depth cap it cannot, which is
-- correct; what was wrong is that the truncated answer was then MEMOISED and
-- returned to a later, shallower approach.

-- source migration: (none — fixture)
CREATE OR REPLACE FUNCTION public.fixture_shared()
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM public.fixture_vault_reader();
END;
$fn$;
