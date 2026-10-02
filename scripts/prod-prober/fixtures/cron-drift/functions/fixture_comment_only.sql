-- FIXTURE, hand-written in the shape `scripts/dump-sql-functions.ts` emits.
-- Not @generated. See README.md in this directory.
--
-- ⛔ THE `includes()` TRAP, ONE LEVEL DOWN. This body MENTIONS the Vault view
-- and READS NOTHING. A resolver that tested the body's raw text — the mistake
-- the command-level rule used to make — would accept every command that calls
-- this function.

-- source migration: (none — fixture)
CREATE OR REPLACE FUNCTION public.fixture_comment_only()
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- reads its key FROM vault.decrypted_secrets (it does not; this is a comment)
  PERFORM 1;
END;
$fn$;
