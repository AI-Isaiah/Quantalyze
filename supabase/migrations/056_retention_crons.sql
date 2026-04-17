-- Migration 056: data retention pg_cron jobs.
--
-- Sprint 6 closeout Task 7.3 — Data retention + GDPR workflow (part 2 of 2).
--
-- Why this migration exists
-- -------------------------
-- The product accumulates ephemeral observability rows (notification
-- dispatches, compute job outcomes) and forensic rows (audit log) that must
-- be pruned on a regulatory-grounded schedule. Per ADR-0008 (data retention
-- policy) the thresholds are:
--
--   * audit_log                     — 2y hot retention + 5y cold archive (7y total)
--   * notification_dispatches       — 180d
--   * compute_jobs status='done'    — 30d
--   * compute_jobs failed/cancelled — 90d
--
-- This migration registers four pg_cron jobs that enforce those thresholds
-- nightly. Each job is idempotent via `DELETE WHERE created_at < now() -
-- interval '…'` — re-running at 3 AM when yesterday's run already purged
-- the crossover rows simply finds zero rows to delete.
--
-- Scope decisions (locked)
-- ------------------------
--   * Hot/cold split for audit_log is NOT implemented in the DB. The 2y
--     hot bucket is enforced here as a DELETE at 7y total (2y hot + 5y
--     cold = 7y). An operator-run archive-to-S3 job (future sprint) would
--     ingest the rows older than 2y before the 7y DELETE purges them.
--     For Task 7.3 we ship the 7y delete threshold; the cold archive is
--     tracked as tech debt in docs/architecture/adr-0008-data-retention.md.
--   * Compute-job retention uses `created_at`, not `claimed_at` or
--     `updated_at`. created_at is the row's birth and is monotonic; using
--     a claim/update column would let a job with a long retry history
--     outlive its successful ancestor by minutes.
--
-- Numbering deviation
-- -------------------
-- The Sprint 6 closeout plan called this migration 052_retention_crons.sql.
-- Migrations 050-054 were consumed by Sprint 5 (050-053) and Task 7.2
-- (054), and Task 7.3's sanitize_user is in 055. 056 is the next free slot,
-- following the convention documented in 050's header.
--
-- What this migration ships
-- -------------------------
-- Four cron jobs, all scheduled daily UTC with distinct timeslots so they
-- don't contend for the same compute window or overlap the 01:00 match
-- engine cron (migration 015):
--
--   Name                              | Schedule       | Keep-window
--   ----------------------------------|----------------|-----------------
--   retention_audit_log               | 0 3 * * *      | 7 years
--   retention_notification_dispatches | 10 3 * * *     | 180 days
--   retention_compute_jobs_done       | 20 3 * * *     | 30 days
--   retention_compute_jobs_failed     | 30 3 * * *     | 90 days
--
-- Self-verifying DO block asserts all four jobs are registered in cron.job.
--
-- Caller impact
-- -------------
-- Zero at apply time. The jobs' first DELETE fires at 03:00 UTC on the next
-- cron tick. Before then, no row is deleted.

BEGIN;

-- Idempotent re-scheduling: each job's registration block unschedules any
-- prior version first, then schedules. The outer DO block handles the
-- pg_cron-missing case gracefully so local dev applies cleanly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron extension not installed — skipping retention crons. Enable in Supabase Dashboard → Database → Extensions and re-run this migration.';
    RETURN;
  END IF;

  ------------------------------------------------------------------
  -- JOB 1: audit_log — 7-year retention (2y hot + 5y cold, both
  -- enforced by the same DELETE until the cold-archive ingest job
  -- ships in a future sprint — see ADR-0008).
  ------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_audit_log') THEN
    PERFORM cron.unschedule('retention_audit_log');
  END IF;

  PERFORM cron.schedule(
    'retention_audit_log',
    '0 3 * * *',
    $cron$
    DELETE FROM audit_log
    WHERE created_at < now() - interval '7 years';
    $cron$
  );

  ------------------------------------------------------------------
  -- JOB 2: notification_dispatches — 180-day retention.
  ------------------------------------------------------------------
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

  ------------------------------------------------------------------
  -- JOB 3: compute_jobs status='done' — 30-day retention.
  -- Done-state queue rows are observability. 30 days is plenty for the
  -- admin compute-jobs dashboard retrospective queries.
  ------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_done') THEN
    PERFORM cron.unschedule('retention_compute_jobs_done');
  END IF;

  PERFORM cron.schedule(
    'retention_compute_jobs_done',
    '20 3 * * *',
    $cron$
    DELETE FROM compute_jobs
    WHERE status = 'done'
      AND created_at < now() - interval '30 days';
    $cron$
  );

  ------------------------------------------------------------------
  -- JOB 4: compute_jobs failed_final / cancelled — 90-day retention.
  -- The plan text says "failed_final/cancelled" but the schema's
  -- status enum is ('pending','running','done','done_pending_children',
  -- 'failed_retry','failed_final'). There is no 'cancelled' state
  -- today (migration 032). We purge 'failed_final' rows at 90d and
  -- 'failed_retry' rows at 90d too — once a retry is 90d cold it is
  -- terminally dead (the backoff ladder tops out in hours, not months)
  -- and should not be resurrecting. A future 'cancelled' status would
  -- fall under the same window.
  ------------------------------------------------------------------
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

  ------------------------------------------------------------------
  -- JOB 5: 90-day API key rotation reminder. Queues a row into
  -- notification_dispatches for every user whose most recent api_keys
  -- row was created >90d ago AND they do NOT already have a recent
  -- reminder dispatch row in the last 60d (so a rotating user doesn't
  -- get re-nagged until the clock resets). api_keys has no
  -- `rotated_at` column — rotation means DELETE + INSERT, so the new
  -- row's `created_at` is the effective rotation timestamp.
  ------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'api_key_rotation_reminder') THEN
    PERFORM cron.unschedule('api_key_rotation_reminder');
  END IF;

  PERFORM cron.schedule(
    'api_key_rotation_reminder',
    '0 4 * * *',
    $cron$
    INSERT INTO notification_dispatches (
      notification_type, recipient_email, subject, status, metadata
    )
    SELECT
      'api_key_rotation_reminder' AS notification_type,
      p.email,
      'Rotate your exchange API key' AS subject,
      'queued' AS status,
      jsonb_build_object(
        'user_id',     p.id,
        'api_key_id',  k.id,
        'exchange',    k.exchange,
        'created_at',  k.created_at
      ) AS metadata
    FROM api_keys k
    JOIN profiles p ON p.id = k.user_id
    WHERE k.is_active = TRUE
      AND k.created_at < now() - interval '90 days'
      AND p.email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM notification_dispatches nd
        WHERE nd.notification_type = 'api_key_rotation_reminder'
          AND nd.recipient_email  = p.email
          AND nd.created_at > now() - interval '60 days'
      );
    $cron$
  );

  RAISE NOTICE 'Migration 056: 5 retention/reminder cron jobs scheduled (4x retention + 1x api_key_rotation_reminder).';
END $$;

-- --------------------------------------------------------------------------
-- Self-verifying DO block
-- --------------------------------------------------------------------------
-- Asserts every job is registered in cron.job IF pg_cron is installed.
-- If pg_cron is missing (local dev), we skip the assertion so `supabase
-- db reset` works cleanly.
DO $$
DECLARE
  expected_jobs TEXT[] := ARRAY[
    'retention_audit_log',
    'retention_notification_dispatches',
    'retention_compute_jobs_done',
    'retention_compute_jobs_failed',
    'api_key_rotation_reminder'
  ];
  jobname_probe TEXT;
  missing_count INT := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Migration 056 self-verify: pg_cron not installed, skipping cron.job assertions.';
    RETURN;
  END IF;

  FOREACH jobname_probe IN ARRAY expected_jobs LOOP
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = jobname_probe) THEN
      RAISE WARNING 'Migration 056 self-verify: cron.job % not registered', jobname_probe;
      missing_count := missing_count + 1;
    END IF;
  END LOOP;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Migration 056 failed: % expected cron.job rows missing', missing_count;
  END IF;

  RAISE NOTICE 'Migration 056 self-verify: all 5 retention/reminder cron jobs present.';
END $$;

COMMIT;
