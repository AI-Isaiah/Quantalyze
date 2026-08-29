-- RED FIXTURE for R1-exception-handler-probe (mechanism 1).
--
-- The arm below means to prove that `authenticated` cannot DELETE the row. It
-- places its verification probe INSIDE the EXCEPTION handler. PL/pgSQL wraps
-- every BEGIN...EXCEPTION block in an implicit subtransaction, so by the time
-- the handler runs the DELETE has already been rolled back — the probe reads
-- the pre-DELETE state and reports "still there, refusal confirmed" whether the
-- database refused the write or performed it. The arm cannot fail.
--
-- The repaired shape is in R1-exception-handler-probe.green.sql: record a flag
-- in the handler, probe AFTER the END.
DO $$
DECLARE
  survivors integer;
BEGIN
  BEGIN
    DELETE FROM public.strategy_shares WHERE strategy_id = 1;
  EXCEPTION WHEN insufficient_privilege THEN
    SELECT count(*) INTO survivors FROM public.strategy_shares WHERE strategy_id = 1;
    IF survivors <> 1 THEN
      RAISE EXCEPTION 'TEST FAILED (FIXTURE R1): the row did not survive the refused DELETE';
    END IF;
  END;
END $$;
