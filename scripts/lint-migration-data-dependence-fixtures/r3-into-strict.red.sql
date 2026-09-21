-- FIXTURE (red) - R3-into-strict-over-application-relation.
--
-- THERE IS NO `RAISE` ANYWHERE IN THIS BLOCK, and that is the whole point.
-- `INTO STRICT` makes the row count itself the assertion: PostgreSQL raises
-- P0002 when the query returns no rows and P0003 when it returns more than one.
-- On a data-empty TEST the SELECT returns nothing, the block raises P0002, the
-- TEST apply refuses, and the production apply it gates is withheld - with the
-- refusal spelt entirely in a keyword a `RAISE`-hunting detector never sees.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO $fixture$
DECLARE
  v_id BIGINT;
BEGIN
  SELECT id INTO STRICT v_id
    FROM public.fx_ledger
   WHERE kind = 'reference';

  UPDATE public.fx_ledger
     SET label = 'anchored'
   WHERE id = v_id;
END
$fixture$;

COMMIT;
