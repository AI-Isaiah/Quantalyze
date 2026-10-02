-- RED FIXTURE for R2-functiondef-comment-strip (mechanism 2).
--
-- The arm reads a function body with pg_get_functiondef and matches a regex
-- against the RAW text. pg_get_functiondef returns the body verbatim, comments
-- included, so a `-- ... NEW.nonce IS DISTINCT FROM OLD.nonce ...` line that
-- merely DOCUMENTS the rule satisfies the pattern by itself. The arm then
-- passes with the rule deleted from the executable body.
--
-- MEASURED instance of the same shape: PROD's 7-param
-- _enqueue_compute_job_internal reports 0 occurrences of `INTO STRICT` in code
-- and 1 including comments.
DO $$
DECLARE
  v_trigfn text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_trigfn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'strategy_shares_enforce_monotonic_generation';

  IF v_trigfn !~* 'NEW\.nonce\s+IS\s+DISTINCT\s+FROM\s+OLD\.nonce' THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R2): the monotonicity trigger lost its nonce rule';
  END IF;
END $$;
