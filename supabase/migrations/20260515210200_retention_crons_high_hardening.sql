-- Migration: retention crons HIGH hardening (audit-2026-05-07 H-pass on mig 056)
--
-- Audit findings addressed: H-0910, H-0913, H-0917, H-0920, H-0921.
--
-- Why this migration exists
-- -------------------------
-- The audit-2026-05-07 H-pass on supabase/migrations/056_retention_crons.sql
-- identified five SQL-actionable HIGH defects beyond what migrations
-- 057 / 121 / 123 closed in the prior remediation rounds:
--
--   * H-0910 (code-reviewer c9): JOB 6 (api_key_rotation_reminder) inserts
--     `recipient_email=p.email, status='queued'` rows that no consumer
--     drains. JOB 3 (retention_notification_dispatches) then DELETEs
--     rows >180d with NO status filter — queued reminders are silently
--     discarded after 6 months without ever being sent.
--   * H-0913 (performance c9): JOB 6's NOT EXISTS subquery filters
--     notification_dispatches by (notification_type, recipient_email,
--     created_at). There is no composite index on those columns. At
--     production scale the nightly job runs O(N×M) row scans.
--   * H-0917 (data-migration c8): the hot→cold cron filters
--     audit_log.created_at < now() - interval '2 years' but the table
--     has no index on created_at (only user_id + entity_type/entity_id).
--     The nightly DELETE is a full sequential scan + DELETE under an
--     exclusive table lock. Migration 057 added the matching index on
--     audit_log_cold — but never on the hot table itself.
--   * H-0920 (silent-failure-hunter c8): the hot→cold CTE uses
--     `ON CONFLICT (id) DO NOTHING` after the row is already removed
--     from audit_log. If audit_log_cold already has a row with the
--     same id (manual recovery import, botched prior migration, UUID
--     collision after pg_restore), the INSERT silently no-ops AND the
--     hot row is gone — permanent data loss without any RAISE.
--   * H-0921 (data-migration c7): retention_compute_jobs_failed DELETEs
--     `status IN ('failed_final','failed_retry') AND created_at < now() -
--     interval '90 days'`. The cutoff uses created_at, not next_attempt_at
--     or updated_at, so a job in slow-burn retry (long-tail exchange
--     outage with day-scale backoff) hits the 90d wall and is silently
--     dropped MID-RECOVERY.
--
-- Items NOT in this migration
-- ---------------------------
--   * H-0911 (audit_log_cold missing created_at index): CLOSED by mig 057.
--   * H-0916 (audit_log.user_id no FK): CLOSED by mig 123.
--   * H-0919 (pg_cron-missing silent fallback): CLOSED by mig 121.
--   * H-0912 (03:00 cluster contention): mig 121 reschedules and the
--     existing 5-minute spacing is adequate. No high-leverage SQL fix.
--   * H-0914 / H-0918 / H-0915 / H-0922 / H-0923: composite chains
--     requiring consumer-side / process / Sprint-7 work. Out of scope
--     for a SQL-only migration.
--
-- What this migration ships
-- -------------------------
-- 1. CREATE INDEX `idx_audit_log_created_at` ON audit_log (created_at).
--    Pairs with mig 057's idx_audit_log_cold_created_at so both crons
--    can range-scan. IF NOT EXISTS so re-apply is a no-op.
-- 2. Re-schedule JOB 1 (audit_log_hot_to_cold) with a hardened body
--    that RAISE NOTICE on every ON CONFLICT (id) DO NOTHING row so a
--    UUID collision is observable. The body is functionally identical
--    to mig 121's version except for the post-INSERT WITH-archived
--    re-check.
-- 3. Re-schedule JOB 3 (retention_notification_dispatches) with a
--    body that PRESERVES queued reminders so an un-consumed signal
--    isn't silently purged. Rows with status='queued' are excluded
--    from the 180d DELETE; rows in sent/failed/error/etc terminal
--    states are still pruned on the existing 180d schedule.
-- 4. Re-schedule JOB 5 (retention_compute_jobs_failed) with a body
--    that uses `next_attempt_at` (when present) as the cutoff instead
--    of `created_at`. A failed_retry row with a future next_attempt_at
--    is mid-recovery and must not be reaped. failed_final rows have a
--    static next_attempt_at = now() (per mig 109 P4) so the 90d wall
--    still trips them on schedule.
-- 5. CREATE INDEX `idx_notification_dispatches_reminder_lookup` ON
--    notification_dispatches (notification_type, recipient_email,
--    created_at). The migration-056 NOT EXISTS subquery in JOB 6 hits
--    this index directly. IF NOT EXISTS so re-apply is a no-op.
-- 6. Self-verifying DO block.
--
-- Idempotency
-- -----------
-- * cron.unschedule + cron.schedule is the canonical re-apply pattern
--   (matches mig 121's STEP 2).
-- * CREATE INDEX IF NOT EXISTS for both new indexes.
-- * The retention_delete_guard triggers installed by mig 121 still
--   protect against unbounded-DELETE regressions in any of the
--   re-scheduled cron bodies.
--
-- Rollback
-- --------
-- supabase/migrations/down/20260515210200-rollback.sql restores mig 121's
-- cron bodies and drops the two new indexes.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: H-0917 — index on audit_log.created_at
-- --------------------------------------------------------------------------
-- The hot→cold cron filters by created_at < now() - interval '2 years'.
-- Without this index the nightly DELETE is a full sequential scan + a
-- table-exclusive lock blocking every concurrent log_audit_event call.
-- BTREE matches the cold-side index added in mig 057 line 93. The
-- mig 121 retention_delete_guard caps per-statement DELETE volume at
-- 100k rows so a runaway scan can't wipe the table.
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON audit_log (created_at);

COMMENT ON INDEX idx_audit_log_created_at IS
  'audit-2026-05-07 H-0917. Range-scan support for the audit_log_hot_to_cold cron '
  '(DELETE WHERE created_at < now() - interval ''2 years''). Mirrors the cold-side '
  'idx_audit_log_cold_created_at added by migration 057.';

-- --------------------------------------------------------------------------
-- STEP 2: H-0913 — composite index for api_key_rotation_reminder NOT EXISTS
-- --------------------------------------------------------------------------
-- JOB 6 (mig 056 / 121) performs:
--   NOT EXISTS (SELECT 1 FROM notification_dispatches nd
--               WHERE nd.notification_type = 'api_key_rotation_reminder'
--                 AND nd.recipient_email   = p.email
--                 AND nd.created_at > now() - interval '60 days')
-- The composite index serves the WHERE clause directly (leading
-- equality columns, range on created_at). At 5k profiles × 5k api_keys
-- × 10k dispatches/180d this is the difference between O(N) and O(log
-- N) per row. BTREE on (notification_type, recipient_email, created_at)
-- DESC so the most recent matching row is at the index leaf.
CREATE INDEX IF NOT EXISTS idx_notification_dispatches_reminder_lookup
  ON notification_dispatches (notification_type, recipient_email, created_at DESC);

COMMENT ON INDEX idx_notification_dispatches_reminder_lookup IS
  'audit-2026-05-07 H-0913. Composite index for the api_key_rotation_reminder '
  'cron''s NOT EXISTS subquery: leading equality on notification_type + '
  'recipient_email, trailing range on created_at DESC. Pushes the dedup probe '
  'from O(N×M) to O(log N) per profile.';

-- --------------------------------------------------------------------------
-- STEP 3: H-0910 + H-0920 + H-0921 — re-schedule the affected crons
-- --------------------------------------------------------------------------
-- Wrap in a DO block that fails loud if pg_cron isn't installed
-- (matching mig 121's posture).
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'audit-2026-05-07: pg_cron extension is NOT installed. Retention re-scheduling cannot proceed. Install pg_cron via Supabase Dashboard → Database → Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- ---- JOB 1: audit_log_hot_to_cold (H-0920) ----
  -- Body is functionally identical to mig 121's version PLUS a
  -- post-INSERT RAISE NOTICE on rows that lost the ON CONFLICT race.
  -- Operator sees "K rows fell into ON CONFLICT — UUID collision" so
  -- silent data loss is observable. The retention_delete_guard
  -- (mig 121 STEP 1) still backstops unbounded DELETEs.
  --
  -- The NOTICE-on-conflict design is conservative: re-inserting the
  -- pre-existing cold row could overwrite legitimate manual recovery
  -- data, so we surface the conflict instead of silently re-writing.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit_log_hot_to_cold') THEN
    PERFORM cron.unschedule('audit_log_hot_to_cold');
  END IF;
  PERFORM cron.schedule(
    'audit_log_hot_to_cold',
    '0 3 * * *',
    $cron$
    DO $body$
    DECLARE
      v_archived INTEGER;
      v_inserted INTEGER;
    BEGIN
      WITH archived AS (
        DELETE FROM audit_log
         WHERE created_at < now() - interval '2 years'
        RETURNING id, user_id, action, entity_type, entity_id, metadata, created_at
      ),
      inserted AS (
        INSERT INTO audit_log_cold (id, user_id, action, entity_type, entity_id, metadata, created_at)
        SELECT id, user_id, action, entity_type, entity_id, metadata, created_at
          FROM archived
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      SELECT (SELECT count(*) FROM archived),
             (SELECT count(*) FROM inserted)
        INTO v_archived, v_inserted;

      IF v_archived <> v_inserted THEN
        RAISE NOTICE 'audit-2026-05-07 H-0920: audit_log_hot_to_cold lost % rows to ON CONFLICT (archived=%, inserted=%). Investigate cold table for pre-existing UUID collisions.',
          (v_archived - v_inserted), v_archived, v_inserted;
      END IF;
    END $body$;
    $cron$
  );

  -- ---- JOB 3: retention_notification_dispatches (H-0910) ----
  -- Preserve queued reminders so an un-consumed signal isn't silently
  -- discarded. Terminal-state rows (sent/failed/error) follow the
  -- existing 180d schedule. The api_key_rotation_reminder consumer
  -- (Sprint 7) drains queued rows; until it ships, queued rows
  -- accumulate but are NOT lost.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_notification_dispatches') THEN
    PERFORM cron.unschedule('retention_notification_dispatches');
  END IF;
  PERFORM cron.schedule(
    'retention_notification_dispatches',
    '10 3 * * *',
    $cron$
    DELETE FROM notification_dispatches
     WHERE created_at < now() - interval '180 days'
       AND status <> 'queued';
    $cron$
  );

  -- ---- JOB 5: retention_compute_jobs_failed (H-0921) ----
  -- Use next_attempt_at as the cutoff so a failed_retry row in
  -- slow-burn recovery (day-scale backoff) is not reaped MID-recovery.
  -- mig 109 P4 sets next_attempt_at=now() for failed_final transitions,
  -- so failed_final rows always hit the 90d wall on schedule.
  -- failed_retry rows whose scheduled next_attempt_at is still in
  -- the future are protected.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_failed') THEN
    PERFORM cron.unschedule('retention_compute_jobs_failed');
  END IF;
  PERFORM cron.schedule(
    'retention_compute_jobs_failed',
    '30 3 * * *',
    $cron$
    DELETE FROM compute_jobs
     WHERE status IN ('failed_final', 'failed_retry')
       AND COALESCE(next_attempt_at, created_at) < now() - interval '90 days';
    $cron$
  );

  RAISE NOTICE 'audit-2026-05-07: retention crons re-scheduled (H-0910 queued-preserve, H-0920 conflict-notice, H-0921 recovery-aware).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_command TEXT;
  v_exists  BOOLEAN;
BEGIN
  -- H-0917: idx_audit_log_created_at present
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'audit_log'
       AND indexname = 'idx_audit_log_created_at'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0917 verification failed: idx_audit_log_created_at missing';
  END IF;

  -- H-0913: composite reminder-lookup index present
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'notification_dispatches'
       AND indexname = 'idx_notification_dispatches_reminder_lookup'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0913 verification failed: idx_notification_dispatches_reminder_lookup missing';
  END IF;

  -- H-0920: hot→cold body contains the NOTICE branch
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'audit_log_hot_to_cold';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07: audit_log_hot_to_cold cron job missing';
  END IF;
  IF v_command NOT ILIKE '%H-0920%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0920 verification failed: audit_log_hot_to_cold body lacks the ON CONFLICT NOTICE branch';
  END IF;

  -- H-0910: notification_dispatches retention preserves queued rows
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'retention_notification_dispatches';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07: retention_notification_dispatches cron job missing';
  END IF;
  IF v_command NOT ILIKE '%status <> ''queued''%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0910 verification failed: retention_notification_dispatches body does not exclude queued rows';
  END IF;

  -- H-0921: compute_jobs failed retention uses next_attempt_at cutoff
  SELECT command INTO v_command FROM cron.job WHERE jobname = 'retention_compute_jobs_failed';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07: retention_compute_jobs_failed cron job missing';
  END IF;
  IF v_command NOT ILIKE '%COALESCE(next_attempt_at, created_at)%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0921 verification failed: retention_compute_jobs_failed body does not use next_attempt_at cutoff';
  END IF;
END $$;

COMMIT;
