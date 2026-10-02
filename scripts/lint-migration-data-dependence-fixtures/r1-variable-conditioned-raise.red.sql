-- FIXTURE (red) - R1-variable-conditioned-raise.
--
-- An anonymous block reads an APPLICATION relation into a variable and then
-- RAISEs on a condition derived from that variable. TEST carries PROD's
-- catalogue and none of its rows, so the count is 0 there, the guard fires, the
-- TEST apply refuses, and the production apply it gates is withheld.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO $fixture$
DECLARE
  v_seeded INTEGER;
BEGIN
  SELECT count(*) INTO v_seeded
    FROM public.fx_ledger
   WHERE kind = 'reference';

  IF v_seeded <> 3 THEN
    RAISE EXCEPTION 'fixture: expected 3 reference rows, found %', v_seeded;
  END IF;
END
$fixture$;

COMMIT;
