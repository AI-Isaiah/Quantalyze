-- GREEN FIXTURE for R1-exception-handler-probe — the repaired idiom, the shape
-- supabase/tests/test_strategy_shares_rls.sql uses for its NO-DELETE arm.
--
-- The handler records ONLY a flag. Every probe runs AFTER the END, outside the
-- implicit subtransaction, so it observes committed state and the arm reddens
-- when the DELETE is actually permitted.
DO $$
DECLARE
  raised    boolean;
  survivors integer;
BEGIN
  raised := FALSE;
  BEGIN
    DELETE FROM public.strategy_shares WHERE strategy_id = 1;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE;
  END;

  SELECT count(*) INTO survivors FROM public.strategy_shares WHERE strategy_id = 1;
  IF NOT raised OR survivors <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R1): DELETE was not refused (raised=%, survivors=%)',
      raised, survivors;
  END IF;
END $$;
