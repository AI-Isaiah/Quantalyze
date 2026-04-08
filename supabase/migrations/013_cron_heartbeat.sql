-- Migration 013: pg_cron heartbeat + match engine schedule (Sprint 1 T1.5 + T1.5a)
--
-- Observability for the FastAPI match engine cron.
--
-- Two things ship in this migration:
--   1. cron_runs heartbeat table — the FastAPI service writes a row at start +
--      completion of every cron invocation, status=('running'|'ok'|'error').
--   2. pg_cron schedule calling the FastAPI service at /api/match/cron-recompute
--      every day at 01:00 UTC. Wrapped in a DO block so the migration applies
--      cleanly on local dev databases (where pg_cron isn't installed) or on
--      staging databases where the Railway URL isn't set yet.
--
-- Prerequisites before production apply
--   * pg_cron extension enabled in Supabase
--   * pg_net extension enabled in Supabase
--   * Before running this migration:
--       ALTER DATABASE postgres SET app.analytics_service_url = 'https://<your-railway-host>';
--       ALTER DATABASE postgres SET app.analytics_service_key = '<X-Service-Key>';
--
-- If either setting is missing, the scheduler is skipped with a NOTICE and you
-- can run the SELECT cron.schedule(...) call manually once the values are
-- configured. The heartbeat table + latest_cron_success() helper still apply.

------------------------------------------------------------------
-- 1. cron_runs heartbeat table
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cron_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cron_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  error TEXT,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_name_recent
  ON cron_runs (cron_name, completed_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_cron_runs_running
  ON cron_runs (cron_name, started_at DESC)
  WHERE status = 'running';

COMMENT ON TABLE cron_runs IS
  'Heartbeat rows written by cron jobs at start + completion. Monitored by latest_cron_success() for the 36h stale alert.';

-- RLS: admin + service_role only (no allocator or manager should see these)
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cron_runs_admin_read" ON cron_runs;
DROP POLICY IF EXISTS "cron_runs_service_role" ON cron_runs;

CREATE POLICY "cron_runs_admin_read" ON cron_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

CREATE POLICY "cron_runs_service_role" ON cron_runs
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

------------------------------------------------------------------
-- 2. latest_cron_success(cron_name) — used by the stale alert
--
--    Restricted to admins + service_role. The function is SECURITY DEFINER
--    so it bypasses cron_runs RLS, which means we MUST gate the caller
--    inside the function body OR via the GRANT. We do BOTH:
--      * EXECUTE granted only to service_role (not authenticated)
--      * Function asserts admin/service_role inside the body so any future
--        broader grant still fails closed.
--    Without these gates, any logged-in user could probe match-engine health
--    and learn when each cron job last succeeded — useful reconnaissance for
--    timing attacks against the data freshness window.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION latest_cron_success(p_cron_name TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  IF auth.role() <> 'service_role' THEN
    SELECT COALESCE(p.is_admin, false) INTO v_is_admin
    FROM profiles p WHERE p.id = auth.uid();
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN (
    SELECT MAX(completed_at)
    FROM cron_runs
    WHERE cron_name = p_cron_name AND status = 'ok'
  );
END;
$$;

REVOKE ALL ON FUNCTION latest_cron_success(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION latest_cron_success(TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION latest_cron_success(TEXT) TO service_role;

------------------------------------------------------------------
-- 3. Schedule the match engine cron (idempotent)
--    Guard against missing pg_cron / missing settings so local dev applies cleanly.
--
--    Secret hygiene: the X-Service-Key is NEVER interpolated into the
--    cron.job.command body. Instead the cron body resolves it via
--    current_setting('app.analytics_service_key', true) at execution time,
--    so the secret stays only in the GUC. Rotating the key with
--    `ALTER DATABASE postgres SET app.analytics_service_key = '...'` then
--    takes effect on the next cron run with no re-schedule required.
--    The service URL is also resolved at execution time for the same reason.
--
--    Fail-loud: if the extensions or GUCs are missing, we INSERT a sentinel
--    cron_runs row with status='error' so latest_cron_success() returns
--    NULL distinguishably and the 36h-stale alert dashboard surfaces the
--    misconfiguration immediately. Otherwise an unconfigured prod migration
--    looks identical to a healthy-but-just-not-yet-run cron.
------------------------------------------------------------------
DO $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron extension not installed — skipping match_engine_cron schedule. Enable in Supabase Dashboard → Database → Extensions.';
    INSERT INTO cron_runs (cron_name, status, completed_at, error)
    VALUES ('match_engine_cron', 'error', now(), 'pg_cron extension not installed');
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net extension not installed — skipping match_engine_cron schedule. Enable in Supabase Dashboard → Database → Extensions.';
    INSERT INTO cron_runs (cron_name, status, completed_at, error)
    VALUES ('match_engine_cron', 'error', now(), 'pg_net extension not installed');
    RETURN;
  END IF;

  v_url := current_setting('app.analytics_service_url', true);
  v_key := current_setting('app.analytics_service_key', true);

  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'app.analytics_service_url or app.analytics_service_key not set — skipping match_engine_cron schedule. Run ALTER DATABASE postgres SET both values and re-run this DO block.';
    INSERT INTO cron_runs (cron_name, status, completed_at, error)
    VALUES ('match_engine_cron', 'error', now(), 'analytics_service_url or analytics_service_key not configured');
    RETURN;
  END IF;

  -- Idempotent re-scheduling: unschedule any prior version first
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'match_engine_cron') THEN
    PERFORM cron.unschedule('match_engine_cron');
  END IF;

  -- IMPORTANT: do NOT bake v_url/v_key into the body via format(%L, ...).
  -- Resolve them inside the cron body so the secret never lands in
  -- cron.job.command. Operators can rotate the GUC without re-scheduling.
  PERFORM cron.schedule(
    'match_engine_cron',
    '0 1 * * *',
    $cron$
    SELECT net.http_post(
      url := current_setting('app.analytics_service_url', true) || '/api/match/cron-recompute',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Service-Key', current_setting('app.analytics_service_key', true)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
    $cron$
  );

  RAISE NOTICE 'match_engine_cron scheduled: daily at 01:00 UTC → %/api/match/cron-recompute', v_url;
END $$;

------------------------------------------------------------------
-- ROLLBACK (for operational use — not auto-applied)
------------------------------------------------------------------
-- BEGIN;
--   DO $$
--   BEGIN
--     IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
--        AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'match_engine_cron') THEN
--       PERFORM cron.unschedule('match_engine_cron');
--     END IF;
--   END $$;
--   DROP FUNCTION IF EXISTS latest_cron_success(TEXT);
--   DROP TABLE IF EXISTS cron_runs;
-- COMMIT;
