-- Audit C-0213 / H-0572 — portfolio_analytics 'computing' row reaper
--
-- Without a watchdog, _compute_portfolio_analytics's INSERT of a
-- computation_status='computing' row at the start of work plus a
-- SIGKILL / pod eviction / OOM mid-pipeline leaves the row in
-- 'computing' forever. The HTTP endpoint's in-flight guard at
-- routers/portfolio.py then permanently returns 409 to every
-- future request for that portfolio_id, and the cron path piles
-- on more 'computing' rows.
--
-- This function mirrors the per-kind watchdog pattern from
-- 20260412094449_compute_jobs_admin_and_defer.sql:reset_stalled_compute_jobs
-- but targets portfolio_analytics specifically. It's intended to be
-- called from the Railway cron tick / pod startup hook with a
-- conservative threshold (default 30 minutes — well past the
-- realistic 1-3 minute compute time for very large portfolios).
--
-- Semantics:
--   * computation_status='computing' AND computed_at < now() - threshold
--     → flips to 'failed' with computation_error='watchdog: stale row'
--   * The row is NOT deleted (preserves audit trail) and the next
--     compute attempt INSERTs a fresh row per the append-only contract.
--   * Returns count of rows reaped.

CREATE OR REPLACE FUNCTION reset_stalled_portfolio_analytics(
  p_stale_threshold INTERVAL DEFAULT interval '30 minutes'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reset INTEGER := 0;
BEGIN
  IF p_stale_threshold IS NULL OR p_stale_threshold <= interval '0' THEN
    RAISE EXCEPTION
      'reset_stalled_portfolio_analytics: p_stale_threshold must be > 0, got %',
      p_stale_threshold
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE portfolio_analytics
     SET computation_status = 'failed',
         computation_error  = COALESCE(
           computation_error,
           'watchdog: stale ''computing'' row reaped after stale_threshold'
         )
   WHERE computation_status = 'computing'
     AND computed_at < (now() - p_stale_threshold);

  GET DIAGNOSTICS v_reset = ROW_COUNT;

  RETURN v_reset;
END;
$$;

COMMENT ON FUNCTION reset_stalled_portfolio_analytics(INTERVAL) IS
  'audit-2026-05-07 C-0213/H-0572 — reap portfolio_analytics rows stuck '
  'in computation_status=computing past the stale_threshold. Call from '
  'the Railway worker cron tick / pod startup.';

-- Partial index keeps the watchdog SELECT cheap as the table grows.
-- The 'computing' state is a hot dirty-read column for the in-flight
-- check anyway (portfolio.py:946-948).
CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_computing
  ON portfolio_analytics (portfolio_id, computed_at DESC)
  WHERE computation_status = 'computing';
