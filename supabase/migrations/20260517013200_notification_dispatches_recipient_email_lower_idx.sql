-- PR #182 retroactive audit follow-up (Task #57) — companion to
-- 20260517013100_sanitize_user_recipient_email_case_insensitive.sql
--
-- Issue:
--   The companion sanitize_user fix changes the recipient_email DELETE
--   predicate from
--     WHERE recipient_email = v_target_email
--   to
--     WHERE LOWER(recipient_email) = LOWER(v_target_email)
--   for GDPR Art. 17 case-insensitivity (RFC 5321). The existing index
--   idx_notification_dispatches_recipient_email (built by
--   20260516170300) is on (recipient_email) plain — it cannot serve
--   the LOWER(...) predicate. Without a functional index, every
--   sanitize_user run (called inside an advisory lock that serializes
--   concurrent admin sanitize calls) seq-scans
--   notification_dispatches — re-introducing the exact perf footgun
--   20260516170300 closed.
--
-- Fix:
--   CREATE INDEX CONCURRENTLY a B-tree on LOWER(recipient_email) so
--   the LOWER-side predicate is index-eligible. Plain
--   recipient_email = ? predicates from other callers still use the
--   existing plain index; this functional index is additive.
--
-- Pattern: CREATE INDEX CONCURRENTLY in a NO-BEGIN/COMMIT migration —
-- CONCURRENTLY cannot run inside a transaction block (per
-- migration-reviewer invariant #5). Idempotent via `IF NOT EXISTS`.
-- This file MUST stay separate from 20260517013100 (which uses
-- explicit BEGIN/COMMIT for the CREATE OR REPLACE FUNCTION).
--
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS
--   public.idx_notification_dispatches_recipient_email_lower;
-- (Reverting the companion sanitize_user fix to case-sensitive
-- restores the plain index sufficiency.)

-- NOTE: NO `BEGIN;` / `COMMIT;` — CONCURRENTLY requires implicit-tx mode.
-- Supabase's migration-runner already handles per-file non-transactional
-- apply when no explicit BEGIN is present.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_dispatches_recipient_email_lower
  ON public.notification_dispatches (LOWER(recipient_email));

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
       AND indexname = 'idx_notification_dispatches_recipient_email_lower'
  ) INTO v_idx_present;

  IF NOT v_idx_present THEN
    RAISE EXCEPTION
      'PR #182 retro audit verification failed: idx_notification_dispatches_recipient_email_lower missing after CONCURRENTLY build';
  END IF;
END $$;
