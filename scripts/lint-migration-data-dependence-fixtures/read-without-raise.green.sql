-- FIXTURE (green) - a data READ that conditions a data WRITE, never a raise.
--
-- THE REFUSED PROPERTY IS A CONJUNCTION, and this fixture is what proves the
-- second half is load-bearing. The block reads an application relation - the
-- same relation the red fixtures read - and the result drives a conditional
-- seed rather than an exception. On a data-empty TEST it simply takes the other
-- branch, which is the whole point: it cannot withhold an apply.
--
-- RAISE NOTICE is not an exception. A refusal that treated it as one would
-- refuse most of this corpus and be switched off within a week.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO $fixture$
DECLARE
  v_rows INTEGER;
BEGIN
  SELECT count(*) INTO v_rows
    FROM public.fx_ledger
   WHERE kind = 'reference';

  IF v_rows = 0 THEN
    INSERT INTO public.fx_ledger (kind, label)
    VALUES ('reference', 'seeded by this migration')
    ON CONFLICT DO NOTHING;
  END IF;

  RAISE NOTICE 'fixture: % reference row(s) present before the seed', v_rows;
END
$fixture$;

COMMIT;
