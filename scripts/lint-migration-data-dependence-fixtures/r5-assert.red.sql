-- FIXTURE (red) - R5-assert-over-application-data.
--
-- THE SAME REFUSAL IN A DIFFERENT KEYWORD. `ASSERT` raises assert_failure when
-- its expression is false, which is a raise by another name; a gate that knew
-- only `RAISE` would be routed around by a single word. On a data-empty TEST
-- the count is 0, the assertion is false, and the production apply this guard
-- gates is withheld.
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

  ASSERT v_seeded = 3, 'fixture: expected 3 reference rows';
END
$fixture$;

COMMIT;
