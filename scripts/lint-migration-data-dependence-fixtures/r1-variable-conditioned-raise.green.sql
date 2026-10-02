-- FIXTURE (green) - R1-variable-conditioned-raise.
--
-- The SAME shape, reading the CATALOGUE instead of the data. This is the
-- self-verification shape this repository prescribes ("self-verify must be
-- CATALOGUE-ONLY"), it is true on TEST and on PROD alike, and the refusal must
-- not fight it.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO $fixture$
DECLARE
  v_seeded INTEGER;
BEGIN
  SELECT count(*) INTO v_seeded
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'fx_ledger';

  IF v_seeded <> 1 THEN
    RAISE EXCEPTION 'fixture: public.fx_ledger is absent from the catalogue';
  END IF;
END
$fixture$;

COMMIT;
