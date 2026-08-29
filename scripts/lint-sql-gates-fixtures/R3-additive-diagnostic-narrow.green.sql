-- GREEN FIXTURE for R3-additive-diagnostic-narrow — the repaired idiom, quoted
-- from supabase/tests/test_strategy_shares_rls.sql (N1 1c and REVOKE 1c):
-- "⛔ SUBTRACT, NEVER `gen_mint + 1`".
--
-- The difference of two counter reads is always small and never overflows, so
-- the arm states its diagnosis instead of aborting on its own arithmetic. Both
-- the condition and the message slots carry raw reads, not derived sums.
DO $$
DECLARE
  gen_pre  bigint;
  gen_post bigint;
BEGIN
  SELECT generation INTO gen_pre FROM public.strategy_shares WHERE strategy_id = 1;
  PERFORM public.revoke_strategy_share(1);
  SELECT generation INTO gen_post FROM public.strategy_shares WHERE strategy_id = 1;

  IF (gen_post - gen_pre) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R3): generation is % after one revoke, up from % — expected exactly one more. If it is UNCHANGED the revoke is COSMETIC and every previously-copied link keeps working.',
      gen_post, gen_pre;
  END IF;
END $$;
