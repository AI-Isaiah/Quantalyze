-- Rollback for migration 20260515210200_retention_crons_high_hardening.sql
-- audit-2026-05-07 H-0910 / H-0913 / H-0917 / H-0920 / H-0921.
--
-- Restores the pre-forward state:
--   * Drops the new indexes (idx_audit_log_created_at and the
--     notification_dispatches reminder-lookup composite).
--   * Re-schedules the three affected crons with the migration-121
--     bodies (no NOTICE-on-conflict, no queued exclusion, no
--     next_attempt_at cutoff).

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: drop the new indexes
-- --------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_audit_log_created_at;
DROP INDEX IF EXISTS public.idx_notification_dispatches_reminder_lookup;

-- --------------------------------------------------------------------------
-- STEP 2: restore mig 121's cron bodies for the affected jobs
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;
  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION 'rollback 20260515210200: pg_cron extension is NOT installed'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- audit_log_hot_to_cold — mig 121 body
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit_log_hot_to_cold') THEN
    PERFORM cron.unschedule('audit_log_hot_to_cold');
  END IF;
  PERFORM cron.schedule(
    'audit_log_hot_to_cold',
    '0 3 * * *',
    $cron$
    WITH archived AS (
      DELETE FROM audit_log
      WHERE created_at < now() - interval '2 years'
      RETURNING id, user_id, action, entity_type, entity_id, metadata, created_at
    )
    INSERT INTO audit_log_cold (id, user_id, action, entity_type, entity_id, metadata, created_at)
    SELECT id, user_id, action, entity_type, entity_id, metadata, created_at
    FROM archived
    ON CONFLICT (id) DO NOTHING;
    $cron$
  );

  -- retention_notification_dispatches — mig 121 body (no status filter)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_notification_dispatches') THEN
    PERFORM cron.unschedule('retention_notification_dispatches');
  END IF;
  PERFORM cron.schedule(
    'retention_notification_dispatches',
    '10 3 * * *',
    $cron$
    DELETE FROM notification_dispatches
    WHERE created_at < now() - interval '180 days';
    $cron$
  );

  -- retention_compute_jobs_failed — mig 121 body (created_at cutoff)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_failed') THEN
    PERFORM cron.unschedule('retention_compute_jobs_failed');
  END IF;
  PERFORM cron.schedule(
    'retention_compute_jobs_failed',
    '30 3 * * *',
    $cron$
    DELETE FROM compute_jobs
    WHERE status IN ('failed_final', 'failed_retry')
      AND created_at < now() - interval '90 days';
    $cron$
  );
END $$;

COMMIT;
