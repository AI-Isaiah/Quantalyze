-- RED FIXTURE for R3-additive-diagnostic-narrow (mechanism 3).
--
-- The arm compares the post-state against `gen_pre + 1`, where gen_pre was read
-- out of the table under test. The comparison overflows in precisely the states
-- the arm is interesting in — a counter at the BIGINT ceiling is exactly the
-- condition a monotonic-generation gate exists to reason about — and an arm
-- that aborts on its own arithmetic raises `bigint out of range` instead of its
-- diagnosis. It is a test that cannot speak, which is barely better than one
-- that cannot fail. The `+ 1` in the RAISE argument list has the same defect
-- for the same reason: the message slot overflows exactly when it fires.
--
-- ⚠️ HONEST SCOPE: this rule is narrow by construction. Whether any particular
-- `+ 1` overflows is undecidable from the text; the mutation runner is the
-- primary net for mechanism 3. See the rule's `scope` in scripts/lint-sql-gates.mjs.
DO $$
DECLARE
  gen_pre  bigint;
  gen_post bigint;
BEGIN
  SELECT generation INTO gen_pre FROM public.strategy_shares WHERE strategy_id = 1;
  PERFORM public.revoke_strategy_share(1);
  SELECT generation INTO gen_post FROM public.strategy_shares WHERE strategy_id = 1;

  IF gen_post IS DISTINCT FROM gen_pre + 1 THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R3): generation is % after one revoke, expected %',
      gen_post, gen_pre + 1;
  END IF;
END $$;
