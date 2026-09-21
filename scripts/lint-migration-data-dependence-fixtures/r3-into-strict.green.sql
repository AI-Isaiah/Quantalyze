-- FIXTURE (green) - `INTO STRICT` over the CATALOGUE.
--
-- The refused property is the RELATION, never the keyword. A catalogue row is
-- present on TEST and on production alike, so a STRICT read of one answers the
-- same way on both and cannot withhold an apply. A refusal that fired on
-- `STRICT` as such would fight the prescribed self-verification shape.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO $fixture$
DECLARE
  v_oid OID;
BEGIN
  SELECT c.oid INTO STRICT v_oid
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'fx_ledger';

  RAISE NOTICE 'fixture: public.fx_ledger is present';
END
$fixture$;

COMMIT;
