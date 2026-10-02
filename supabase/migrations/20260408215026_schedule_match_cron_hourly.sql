-- APP-GUC-LINEAGE: retired 2026-09-07; occurrences: 4; successor: 20260907120000_analytics_service_settings_and_vault_tick.sql; reason: four app-namespace sites — TWO preflight reads inside the one-shot DO block that ran once at apply on 2026-04-08, and TWO inside the $cron$ command literal this migration WROTE. This migration SUPERSEDES 20260408113029 (same jobname, daily to hourly), so only this one ever described the row that existed; it is itself superseded on PROD by the 2026-09-01 hand repair captured verbatim in scripts/prod-prober/cron-manifest.json jobid 1, whose command reads the key from vault.decrypted_secrets and carries the URL as a literal. A FRESH apply of this file would still write the GUC-reading command — a latent-on-rebuild defect, NOT an ongoing outage. The mechanism PROD actually runs is described by the successor.
-- Repointing the LIVE job row at the successor's public.match_engine_cron_tick() is
-- Phase 164.5 item 7 — one production row, deliberately outside Phase 164.7's fence,
-- which changes only what the MIGRATIONS READ.
-- Migration 015: Reschedule match engine cron to hourly (was daily in 013)
--
-- T-0.6 from the 2026-04-09 cap-intro friend demo sprint. Migration 013 ships
-- the match_engine_cron on a daily `'0 1 * * *'` schedule. For the demo, the
-- freshness bar is "Computed <12h ago" — the 23-hour staleness window around
-- a daily tick is too risky. Hourly is cheap (~3 sec per recompute × 3 demo
-- allocators ≈ 10 sec of Railway CPU per hour) and makes the "Computed <1h ago"
-- badge feel alive during the meeting.
--
-- Safety:
--   * Idempotent: unschedules any prior `match_engine_cron` job before
--     rescheduling, so a redeploy or DB restore that re-runs this migration
--     doesn't leave two scheduled copies.
--   * Transactional: the unschedule + reschedule pair runs inside a single DO
--     block. If pg_cron honors txns for `cron.job` mutations (it does as of
--     pg_cron ~1.4+), a failure in `cron.schedule()` rolls back the unschedule.
--     On older pg_cron, a failure between the two calls leaves the job
--     unscheduled — fail-loud via the sentinel row below makes this visible.
--   * Fail-loud: if extensions or GUCs are missing, insert a sentinel row in
--     `cron_runs` with `status='error'` so `latest_cron_success()` returns NULL
--     distinguishably and the 36h-stale alert fires immediately.
--   * Secret hygiene: the `X-Service-Key` header and analytics URL are resolved
--     at execution time from GUCs (`app.analytics_service_key`, `app.analytics_service_url`)
--     so the secret never lands in `cron.job.command`.

DO $$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron extension not installed — skipping hourly reschedule.';
    INSERT INTO cron_runs (cron_name, status, completed_at, error)
    VALUES ('match_engine_cron', 'error', now(), 'pg_cron extension missing at migration 015');
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_net extension not installed — skipping hourly reschedule.';
    INSERT INTO cron_runs (cron_name, status, completed_at, error)
    VALUES ('match_engine_cron', 'error', now(), 'pg_net extension missing at migration 015');
    RETURN;
  END IF;

  v_url := current_setting('app.analytics_service_url', true);
  v_key := current_setting('app.analytics_service_key', true);

  IF v_url IS NULL OR v_url = '' OR v_key IS NULL OR v_key = '' THEN
    RAISE NOTICE 'GUC app.analytics_service_url or app.analytics_service_key not set — skipping hourly reschedule.';
    INSERT INTO cron_runs (cron_name, status, completed_at, error)
    VALUES ('match_engine_cron', 'error', now(), 'GUC unset at migration 015');
    RETURN;
  END IF;

  -- Unschedule the prior (daily) version atomically with the reschedule below.
  -- pg_cron supports transactional `cron.job` mutations on recent versions.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'match_engine_cron') THEN
    PERFORM cron.unschedule('match_engine_cron');
  END IF;

  -- Reschedule at hourly. URL + key resolved at execution time from GUCs so
  -- the secret never lands in `cron.job.command`. Operators can rotate the
  -- secret via `ALTER DATABASE postgres SET app.analytics_service_key = ...`
  -- without re-running this migration.
  PERFORM cron.schedule(
    'match_engine_cron',
    '0 * * * *',
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

  RAISE NOTICE 'match_engine_cron rescheduled: hourly (0 * * * *) → %/api/match/cron-recompute', v_url;
END $$;

------------------------------------------------------------------
-- ROLLBACK (for operational use — not auto-applied)
------------------------------------------------------------------
-- To revert to the daily schedule from migration 013:
-- BEGIN;
--   DO $$
--   BEGIN
--     IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
--        AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'match_engine_cron') THEN
--       PERFORM cron.unschedule('match_engine_cron');
--       -- Re-apply migration 013's DO block to restore the daily schedule.
--     END IF;
--   END $$;
-- COMMIT;
