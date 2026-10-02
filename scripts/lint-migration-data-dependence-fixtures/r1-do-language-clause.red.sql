-- FIXTURE (red) - R1-variable-conditioned-raise, LEADING `LANGUAGE` clause.
--
-- `DO LANGUAGE plpgsql $tag$ ... $tag$` is the standard's other spelling of the
-- SAME statement: the clause may precede the body instead of following it. A
-- block detector that read only the word immediately before the dollar-quote
-- saw `plpgsql` here and never scanned the block at all - and a block that is
-- never scanned is a refusal that cannot fire.
--
-- This file is a FIXTURE. It is never applied to any database.
BEGIN;

DO LANGUAGE plpgsql $fixture$
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
