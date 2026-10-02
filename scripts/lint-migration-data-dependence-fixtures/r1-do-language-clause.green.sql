-- FIXTURE (green) - the LEADING `LANGUAGE` clause is not the refused property.
--
-- The same spelling over the CATALOGUE. Recognising the clause must make the
-- block SCANNED, not refused: if this went red, the fix would have been a
-- detector that refuses on a keyword rather than on a data read.
--
-- The trailing-clause spelling `DO $tag$ ... $tag$ LANGUAGE plpgsql` is carried
-- by the other R1 fixtures, which end on the word `DO`.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO LANGUAGE plpgsql $fixture$
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
