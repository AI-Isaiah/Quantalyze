-- FIXTURE (red) - R4-not-found-conditioned-raise.
--
-- NO DECLARED VARIABLE AND NO SUBQUERY. `FOUND` is the implicit flag the last
-- SQL statement left behind, so the condition names nothing the variable half
-- or the subquery half of the detector can see - and it carries exactly the
-- row-count answer the preceding application read produced. On a data-empty
-- TEST the read finds nothing, `NOT FOUND` is true, the guard fires and the
-- production apply it gates is withheld.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO $fixture$
BEGIN
  PERFORM 1
     FROM public.fx_ledger
    WHERE kind = 'reference';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'fixture: no reference row present';
  END IF;
END
$fixture$;

COMMIT;
