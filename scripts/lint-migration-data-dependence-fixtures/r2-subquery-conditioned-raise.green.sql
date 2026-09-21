-- FIXTURE (green) - R2-subquery-conditioned-raise.
--
-- The same inline-subquery spelling over a CATALOGUE relation. Allowed: the
-- catalogue is restored with the schema, so this guard answers the same way on
-- TEST as it does on PROD.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO $fixture$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'fx_ledger'
       AND policyname = 'fx_ledger_owner_read'
  ) THEN
    RAISE EXCEPTION 'fixture: the fx_ledger owner-read policy is absent';
  END IF;
END
$fixture$;

COMMIT;
