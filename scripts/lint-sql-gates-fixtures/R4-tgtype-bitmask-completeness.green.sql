-- GREEN FIXTURE for R4-tgtype-bitmask-completeness — the repaired idiom, quoted
-- from supabase/tests/test_strategy_shares_rls.sql:672-675 (SHAPE 5).
--
-- Every bit the failure message CLAIMS is tested: ROW=1, BEFORE=2, INSERT=4 and
-- UPDATE=16. Narrowing the trigger in any of those four directions now fails a
-- term, so the arm reddens on the change it exists to catch.
DO $$
DECLARE
  row_cnt integer;
BEGIN
  SELECT count(*) INTO row_cnt
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.strategy_shares'::regclass
     AND NOT t.tgisinternal
     AND t.tgname = 'strategy_shares_monotonic_generation'
     AND (t.tgtype & 1) = 1
     AND (t.tgtype & 2) = 2
     AND (t.tgtype & 4) = 4
     AND (t.tgtype & 16) = 16;

  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R4): expected exactly 1 BEFORE INSERT OR UPDATE FOR EACH ROW trigger named strategy_shares_monotonic_generation on strategy_shares, found %', row_cnt;
  END IF;
END $$;
