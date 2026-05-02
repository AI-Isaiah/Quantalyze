-- supabase/migrations/098_resend_message_correlation.sql
-- 093-097 reserved for Phase 19 (see STATE.md Phase-Internal Gates table) — Phase 16 lands at 098
--
-- Phase 16 / OBSERV-03 — correlation_id ↔ resend_message_id mapping table.
--
-- Best-effort fallback per Pitfall 17 (RESEARCH §Open Question 1): the Resend
-- webhook payload may not echo the `tags` array reliably. This table is the
-- safety net. src/lib/email.ts writes a row on every successful send (1 retry
-- on transient failure; failure is logged as `correlation_chain_broken` but
-- does NOT block the send). The webhook handler falls back to a lookup by
-- resend_message_id when `tags` is missing or shape-mismatched.
--
-- RLS: service-role only. No tenant column needed — correlation_id is a UUID
-- v4 with no semantic meaning; resend_message_id is a Resend-internal ID.
-- Cross-tenant leak surface: an attacker who learned a victim's
-- correlation_id could already grep their own logs by it (no privilege
-- escalation). Locking to service-role keeps it tidy and audit-friendly.
-- Asserted via analytics-service/tests/test_resend_correlation_rls.py
-- (Plan 16-05 Task 4).
--
-- Retention: 90 days via pg_cron job (cron defined inline below; mirrors
-- migration 056 audit_log retention pattern). Older rows are no longer
-- correlatable to live diagnostic sessions — pruning bounds the table size.

CREATE TABLE IF NOT EXISTS public.resend_message_correlation (
    id              bigserial PRIMARY KEY,
    correlation_id  uuid NOT NULL,
    resend_message_id text NOT NULL,
    sent_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT resend_message_correlation_unique_msg UNIQUE (resend_message_id)
);

CREATE INDEX IF NOT EXISTS resend_message_correlation_correlation_id_idx
    ON public.resend_message_correlation (correlation_id);

CREATE INDEX IF NOT EXISTS resend_message_correlation_sent_at_idx
    ON public.resend_message_correlation (sent_at);

ALTER TABLE public.resend_message_correlation ENABLE ROW LEVEL SECURITY;

-- No anon / authenticated SELECT — service-role only.
-- (RLS-enabled with no policies = deny all to non-service-role JWTs.)

GRANT SELECT, INSERT, DELETE ON public.resend_message_correlation TO service_role;
GRANT USAGE ON SEQUENCE public.resend_message_correlation_id_seq TO service_role;

-- 90-day retention via pg_cron (mirrors migration 056 audit_log retention pattern).
-- If pg_cron is not enabled in this project, the cron line is a no-op. Phase 18
-- follow-up if retention pressure becomes an issue.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule(
            'resend_message_correlation_retention_90d',
            '15 3 * * *',  -- daily at 03:15 UTC
            $$DELETE FROM public.resend_message_correlation WHERE sent_at < now() - INTERVAL '90 days';$$
        );
    END IF;
END $$;

-- Optional rollback (commented for safety):
-- DROP TABLE IF EXISTS public.resend_message_correlation;
