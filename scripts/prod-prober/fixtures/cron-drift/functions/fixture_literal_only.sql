-- FIXTURE, hand-written in the shape `scripts/dump-sql-functions.ts` emits.
-- Not @generated. See README.md in this directory.
--
-- The literal half of the same trap: the table name is inside a string, which
-- `scanSql` blanks in `masked`, so the body reaches no Vault read.

-- source migration: (none — fixture)
CREATE OR REPLACE FUNCTION public.fixture_literal_only()
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE NOTICE 'reads FROM vault.decrypted_secrets';
END;
$fn$;
