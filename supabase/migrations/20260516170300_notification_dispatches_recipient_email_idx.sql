-- audit-2026-05-07 mitigation (specialist-review apply pass take 2)
-- Closes: HIGH-2 (red-team c9)
--   sanitize_user (mig 20260516160100 L158) does
--     DELETE FROM notification_dispatches WHERE recipient_email = v_target_email;
--   inside an advisory-locked transaction. None of the existing
--   notification_dispatches indexes lead with recipient_email
--   (idx_notification_dispatches_type_created leads on notification_type;
--   idx_notification_dispatches_reminder_lookup has recipient_email as
--   the SECOND key — not usable for a recipient-only equality predicate).
--   Every sanitize_user invocation seq-scans notification_dispatches
--   inside the advisory lock; a GDPR deletion request stalls all other
--   admin sanitize calls and prevents concurrent retention-cron purges.
--
-- Source: supabase/migrations/20260516160100_sanitize_user_purge_notification_dispatches.sql:L158
--
-- Pattern: CREATE INDEX CONCURRENTLY in a NO-BEGIN/COMMIT migration
-- (CONCURRENTLY cannot run inside a transaction block). Idempotent via
-- `IF NOT EXISTS`. The index is partial-free (full-table) because
-- recipient_email = ? is the only filter we know the DELETE will use.

-- NOTE: NO `BEGIN;` / `COMMIT;` — CONCURRENTLY requires implicit-tx mode.
-- Supabase's migration-runner already handles per-file non-transactional
-- apply when no explicit BEGIN is present.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_dispatches_recipient_email
  ON public.notification_dispatches (recipient_email);

-- Verification block — must be a SEPARATE statement after the CONCURRENTLY
-- build, NOT wrapped in a transaction.
DO $$
DECLARE
  v_idx_present BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'notification_dispatches'
       AND indexname = 'idx_notification_dispatches_recipient_email'
  ) INTO v_idx_present;

  IF NOT v_idx_present THEN
    RAISE EXCEPTION
      'audit-2026-05-07 HIGH-2 verification failed: idx_notification_dispatches_recipient_email missing after CONCURRENTLY build';
  END IF;
END $$;
