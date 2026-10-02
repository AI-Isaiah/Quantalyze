-- FIXTURE (red) - R2-subquery-conditioned-raise.
--
-- No variable at all: the read is an INLINE SUBQUERY sitting directly in the
-- condition that controls the RAISE. Same dependence on rows TEST does not
-- have, a different spelling - and a refusal that only saw the variable
-- spelling would be routed around by this one without anyone meaning to.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO $fixture$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.fx_ledger WHERE kind = 'reference') THEN
    RAISE EXCEPTION 'fixture: no reference row is present at apply time';
  END IF;
END
$fixture$;

COMMIT;
