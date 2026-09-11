-- FIXTURE, hand-written in the shape `scripts/dump-sql-functions.ts` emits.
-- Not @generated: nothing replays it, and `npm run schema:functions` must never
-- write here. See README.md in this directory.

-- source migration: (none — fixture)
CREATE OR REPLACE FUNCTION public.fixture_vault_reader()
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_key TEXT;
BEGIN
  -- The EXECUTING read. This is the shape `VAULT_READ_RE` matches on masked text.
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'fixture_key';
  PERFORM v_key;
END;
$fn$;
