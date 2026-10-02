-- GREEN FIXTURE for R2-functiondef-comment-strip — the repaired idiom, quoted
-- from supabase/tests/test_strategy_shares_rls.sql:696.
--
-- The body passes through regexp_replace(..., '--[^\n]*', '', 'g') before any
-- pattern touches it, so prose describing the rule can no longer stand in for
-- the rule. The NULL pre-check matters for the same family of reasons: a probe
-- against a NULL body is vacuously true, so the arm asserts it read something
-- before it asserts what it read.
DO $$
DECLARE
  v_trigfn_s text;
BEGIN
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') INTO v_trigfn_s
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'strategy_shares_enforce_monotonic_generation';

  IF v_trigfn_s IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R2-pre): the trigger function body could not be read, so the rule probe below would be VACUOUSLY true on NULL';
  END IF;

  IF v_trigfn_s !~* 'NEW\.nonce\s+IS\s+DISTINCT\s+FROM\s+OLD\.nonce' THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R2): the monotonicity trigger lost its nonce rule';
  END IF;
END $$;
