-- FIXTURE (green) - a FUNCTION body that reads data and raises. ALLOWED.
--
-- A dollar-quoted body is not by itself a guard. `CREATE FUNCTION ... $$ ... $$`
-- is TEXT at apply time: the body is stored, not executed, so a data read
-- inside it cannot refuse an apply on a data-empty TEST. Only an ANONYMOUS
-- block - `DO $tag$ ... $tag$` - runs while the migration is applying.
--
-- This discrimination is load-bearing rather than decorative: measured over
-- this repository's migration corpus, a scan that could not tell a function
-- body from an anonymous block would sweep in most of the corpus and be
-- switched off, which is how a gate stops being a gate.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

CREATE OR REPLACE FUNCTION public.fx_ledger_assert_seeded()
RETURNS void
LANGUAGE plpgsql
AS $body$
DECLARE
  v_rows INTEGER;
BEGIN
  SELECT count(*) INTO v_rows
    FROM public.fx_ledger
   WHERE kind = 'reference';

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'fx_ledger carries no reference rows';
  END IF;
END
$body$;

COMMIT;
