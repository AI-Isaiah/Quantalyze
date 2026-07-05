-- Fix: sync_strategy_analytics_status must DISCOUNT a superseded failed_final.
--
-- Bug (surfaced by the P72 live Deribit onboarding canary): step (b) mapped
-- "ANY failed_final → failed". A strategy that failed once (failed_final) and
-- then RE-RAN cleanly (a new job generation, all 'done') still had the stale
-- failed_final row, so the status was poisoned to 'failed' forever — a
-- retry-after-failure showed a red strategy despite a valid recomputed
-- factsheet. (Not a regression from any recent change; migration 038's original
-- mapping. The P72 plan flagged it deferred; now fixed.)
--
-- Fix: a failed_final marks the strategy 'failed' ONLY when it is NOT superseded
-- by a LATER 'done' job (updated_at strictly greater). The analytics chain
-- (process_key_long → derive_broker_dailies → compute_analytics_from_csv) only
-- produces a 'done' AFTER a failure when a subsequent generation recomputed
-- successfully, so "a newer 'done' exists" is exactly the supersession signal.
-- A genuine unrecovered permanent failure has no newer 'done' and still shows
-- 'failed'. Steps (a) computing and (c) complete are unchanged.
--
-- CREATE OR REPLACE, re-based on the LATEST def (038 @ 20260412094454; no later
-- redefinition exists in the tree). Idempotent; auto-applies to prod on merge.

CREATE OR REPLACE FUNCTION sync_strategy_analytics_status(p_strategy_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_job_count          INTEGER;
  v_nonterminal_count  INTEGER;
  v_failed_count       INTEGER;
  v_latest_error       TEXT;
BEGIN
  IF p_strategy_id IS NULL THEN
    RAISE EXCEPTION 'sync_strategy_analytics_status: p_strategy_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (d) no rows → preserve the existing strategy_analytics row (bail before any
  -- write). Protects brand-new 'pending' rows and legacy pre-Sprint-3 analytics.
  SELECT count(*) INTO v_job_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id;

  IF v_job_count = 0 THEN
    RETURN;
  END IF;

  -- (a) any non-terminal row → 'computing'. failed_retry is non-terminal (the
  -- worker re-picks it after backoff).
  SELECT count(*) INTO v_nonterminal_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id
     AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry');

  IF v_nonterminal_count > 0 THEN
    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
    VALUES (p_strategy_id, 'computing', NULL)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = EXCLUDED.computation_status,
           computation_error  = EXCLUDED.computation_error,
           computed_at        = now();
    RETURN;
  END IF;

  -- (b) all terminal, an UNSUPERSEDED failed_final → 'failed'. A failed_final
  -- that a LATER 'done' job superseded (a since-retried generation that
  -- recomputed cleanly) must NOT poison the strategy — count only failures with
  -- no strictly-newer 'done' job. `updated_at` is stamped by the
  -- compute_jobs_set_updated_at trigger (032:254).
  SELECT count(*) INTO v_failed_count
    FROM compute_jobs f
   WHERE f.strategy_id = p_strategy_id
     AND f.status = 'failed_final'
     AND NOT EXISTS (
       SELECT 1
         FROM compute_jobs d
        WHERE d.strategy_id = p_strategy_id
          AND d.status = 'done'
          AND d.updated_at > f.updated_at
     );

  IF v_failed_count > 0 THEN
    SELECT f.last_error
      INTO v_latest_error
      FROM compute_jobs f
     WHERE f.strategy_id = p_strategy_id
       AND f.status = 'failed_final'
       AND NOT EXISTS (
         SELECT 1
           FROM compute_jobs d
          WHERE d.strategy_id = p_strategy_id
            AND d.status = 'done'
            AND d.updated_at > f.updated_at
       )
     ORDER BY f.updated_at DESC
     LIMIT 1;

    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
    VALUES (p_strategy_id, 'failed', v_latest_error)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = EXCLUDED.computation_status,
           computation_error  = EXCLUDED.computation_error,
           computed_at        = now();
    RETURN;
  END IF;

  -- (c) all terminal, none unsuperseded-failed → 'complete'. Clears any stale
  -- computation_error so the UI never shows "complete with error X".
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
  VALUES (p_strategy_id, 'complete', NULL)
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = EXCLUDED.computation_status,
         computation_error  = EXCLUDED.computation_error,
         computed_at        = now();
END;
$$;

REVOKE ALL ON FUNCTION sync_strategy_analytics_status FROM PUBLIC, anon, authenticated;

-- Self-verifying guard (mirrors 038): the function must still be SECURITY
-- DEFINER with a baked search_path after the replace.
DO $$
DECLARE
  v_secdef BOOLEAN;
  v_search_path TEXT;
BEGIN
  SELECT p.prosecdef, array_to_string(p.proconfig, ',')
    INTO v_secdef, v_search_path
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.proname = 'sync_strategy_analytics_status'
   LIMIT 1;

  IF v_secdef IS NULL THEN
    RAISE EXCEPTION 'sync_status_supersede: function missing after replace';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'sync_status_supersede: function is not SECURITY DEFINER';
  END IF;
  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'sync_status_supersede: function does not SET search_path';
  END IF;
END $$;
