-- Migration 018: notification_dispatches audit trail
--
-- Every notification send attempt writes a row here. The `send()` helper in
-- src/lib/email.ts inserts a row with status='queued' before calling Resend,
-- then updates to 'sent' on success or 'failed' with error detail on failure.
--
-- Why: on a flaky Resend day the app currently says "intro sent" via console
-- log only, and nobody knows whether the email actually landed. With this
-- table, /admin/match/eval and future observability surfaces can flag stuck
-- or failed sends.
--
-- RLS: admin-read + service_role-all. Regular users cannot read or write
-- dispatch rows — they're operator observability, not user-facing.

CREATE TABLE IF NOT EXISTS notification_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  subject TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  error TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_dispatches_type_created
  ON notification_dispatches (notification_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_dispatches_failed
  ON notification_dispatches (status, created_at DESC)
  WHERE status = 'failed';

ALTER TABLE notification_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_dispatches_admin_read" ON notification_dispatches;
DROP POLICY IF EXISTS "notification_dispatches_service_role" ON notification_dispatches;

CREATE POLICY "notification_dispatches_admin_read" ON notification_dispatches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

CREATE POLICY "notification_dispatches_service_role" ON notification_dispatches
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE notification_dispatches IS
  'Audit trail for every notification send attempt. Written by src/lib/email.ts::send(). RLS: admin-read + service_role-all.';
