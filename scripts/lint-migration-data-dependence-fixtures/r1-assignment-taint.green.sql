-- FIXTURE (green) - an assignment that mentions no tainted local still CLEARS.
--
-- THE CLEARING DIRECTION IS THE POINT. A long block reuses a scratch variable:
-- the data read here is overwritten by a literal before the test, so by the time
-- the raise is reached the condition no longer depends on any row. Propagating
-- taint must not make an assignment one-way - a taint that could never be
-- cleared would condemn most of this corpus and the gate would be switched off
-- within a week.
--
-- The catalogue copy below is the second half: `:=` from a catalogue-derived
-- variable inherits a CATALOGUE answer, which is true on TEST and on PROD alike.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO $fixture$
DECLARE
  v_seeded INTEGER;
  v_total  INTEGER;
BEGIN
  SELECT count(*) INTO v_seeded
    FROM public.fx_ledger
   WHERE kind = 'reference';

  RAISE NOTICE 'fixture: % reference row(s) present', v_seeded;

  v_seeded := 3;
  v_total  := v_seeded;

  IF v_total <> 3 THEN
    RAISE EXCEPTION 'fixture: the literal was overwritten';
  END IF;

  SELECT count(*) INTO v_seeded
    FROM pg_catalog.pg_class
   WHERE relname = 'fx_ledger';

  v_total := v_seeded;

  IF v_total <> 1 THEN
    RAISE EXCEPTION 'fixture: public.fx_ledger is absent from the catalogue';
  END IF;
END
$fixture$;

COMMIT;
