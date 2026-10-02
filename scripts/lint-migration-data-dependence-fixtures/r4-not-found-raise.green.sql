-- FIXTURE (green) - `FOUND` after a CATALOGUE read, and after a clearing read.
--
-- Two directions in one file. The first guard tests `FOUND` after reading the
-- catalogue: true on TEST and on production alike. The second reads an
-- application relation and then reads the catalogue, so by the time `FOUND` is
-- tested it carries the CATALOGUE statement's answer - a later statement clears
-- the attribution exactly as an overwrite clears a variable's taint. An
-- attribution that could reach back past an intervening read would condemn a
-- guard that no longer depends on the data.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO $fixture$
BEGIN
  PERFORM 1
     FROM pg_catalog.pg_class
    WHERE relname = 'fx_ledger';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fixture: public.fx_ledger is absent from the catalogue';
  END IF;

  PERFORM 1
     FROM public.fx_ledger
    WHERE kind = 'reference';

  PERFORM 1
     FROM pg_catalog.pg_namespace
    WHERE nspname = 'public';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fixture: the public schema is absent';
  END IF;
  -- THE POLARITY DIRECTION, pinned deliberately. `IF FOUND THEN RAISE` is the
  -- INVERSE of the refused shape: on a data-empty TEST it is false and the
  -- apply proceeds, so it cannot withhold a production apply through TEST. Every
  -- refusal this linter carries names a guard that fires when the table is
  -- EMPTY; refusing this one would be the gate reaching outside its own charter.
  PERFORM 1
     FROM public.fx_ledger
    WHERE kind = 'reference';

  IF FOUND THEN
    RAISE EXCEPTION 'fixture: a reference row is present and must not be';
  END IF;
END
$fixture$;

COMMIT;
