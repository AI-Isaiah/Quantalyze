-- FIXTURE (red) - R1-variable-conditioned-raise, taint through a PLAIN assignment.
--
-- The count is read into one variable and COPIED into a second with `:=` before
-- it is tested. No `SELECT` appears on the right-hand side, so a detector that
-- looked only for a read there treated the copy as a CLEARING assignment and
-- the guard walked through the refusal. This is ordinary PL/pgSQL, not a
-- contrived evasion: the block still refuses on a data-empty TEST and still
-- withholds the production apply it gates.
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

  v_total := v_seeded;

  IF v_total <> 3 THEN
    RAISE EXCEPTION 'fixture: expected 3 reference rows, found %', v_total;
  END IF;
END
$fixture$;

COMMIT;
