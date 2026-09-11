-- FIXTURE, hand-written in the shape `scripts/dump-sql-functions.ts` emits.
-- Not @generated. See README.md in this directory.
--
-- ⭐ THE TRANSITIVE EDGE, AND IT IS THE REASON THE RESOLVER RECURSES AT ALL.
-- The real snapshot has ZERO such edges today (measured: 120 files, one reader,
-- no callers). This file is what stops a future
-- `SELECT public.hourly_tick();` wrapper around the Vault-reading tick from
-- re-opening the 164.5.1 collision the moment somebody writes it.

-- source migration: (none — fixture)
CREATE OR REPLACE FUNCTION public.fixture_wrapper()
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  PERFORM public.fixture_vault_reader();
END;
$fn$;
