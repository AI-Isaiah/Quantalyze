-- FIXTURE (green) - `ASSERT` over the CATALOGUE.
--
-- The refused property is the read the expression rests on, never the keyword.
-- A catalogue assertion is the shape this repository PRESCRIBES for a
-- migration's self-verification, and it happens to be written with `ASSERT`
-- here rather than `IF ... THEN RAISE`. The refusal must not fight it.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO $fixture$
DECLARE
  v_present INTEGER;
BEGIN
  SELECT count(*) INTO v_present
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'fx_ledger';

  ASSERT v_present = 1, 'fixture: public.fx_ledger is absent from the catalogue';
END
$fixture$;

COMMIT;
