-- Migration 115: for_quants_leads notify-attempt markers (audit-2026-05-07 G9.B.7).
--
-- Why this migration exists
-- -------------------------
-- PR #143 (PR-1, audit-2026-05-07) shipped the silent-failure-detection
-- half of G9.B.7 — once-per-process Sentry capture when ADMIN_EMAIL is
-- unset. The audit's full fix recipe ALSO required the founder CRM to
-- distinguish "lead inserted, founder never told" from "lead inserted,
-- founder notified". Without per-row markers, a transient Resend outage
-- silently degrades the queue: the lead is in the DB, but no human
-- knows about it, and the CRM view shows "All caught up" with the
-- in-flight failure invisible.
--
-- Three columns:
--   * `notify_attempted_at` TIMESTAMPTZ — set the moment after() begins
--     the founder-notify path. NEVER reset; if the row has this set
--     but `notify_succeeded_at` is NULL the operator can see the
--     attempt without a re-send.
--   * `notify_succeeded_at` TIMESTAMPTZ — set when notifyFounderGeneric
--     returns without throwing. Pair-with-attempted indicates a clean
--     send.
--   * `notify_error` TEXT — sanitized error message (truncated to 500
--     chars) when notifyFounderGeneric throws OR ADMIN_EMAIL is unset.
--     Distinct from a generic "missing markers" path because the
--     operator wants to know WHY the send failed (config vs network vs
--     auth).
--
-- "Stuck pending notify" predicate (used by ForQuantsLeadsTable):
--   notify_attempted_at IS NOT NULL AND notify_succeeded_at IS NULL
--
-- Why not flip the existing `processed_at` semantics?
-- ----------------------------------------------------
-- `processed_at` means "the founder reached out to the lead" — a manual
-- triage state. The notify markers describe an automated email send,
-- a strictly upstream state. Conflating them would mean a transient
-- Resend outage marks rows as "processed" without any human action.
--
-- Caller impact
-- -------------
-- Only `/api/for-quants-lead/route.ts` writes the markers (service-role
-- path). `/lib/for-quants-leads-admin.ts` extends LEAD_SELECT to
-- include them. `ForQuantsLeadsTable.tsx` renders a "stuck pending
-- notify" badge using the predicate above. No other readers exist.
--
-- Backwards compatibility: all 3 columns are NULL-able with no
-- default; pre-migration rows simply lack the markers and render
-- without the badge. No backfill needed.

-- --------------------------------------------------------------------------
-- STEP 1: add columns
-- --------------------------------------------------------------------------
ALTER TABLE for_quants_leads
  ADD COLUMN IF NOT EXISTS notify_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notify_succeeded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notify_error TEXT;

COMMENT ON COLUMN for_quants_leads.notify_attempted_at IS
  'Timestamp when /api/for-quants-lead after() began the founder-notify path. NULL pre-attempt or for legacy rows. audit-2026-05-07 G9.B.7.';
COMMENT ON COLUMN for_quants_leads.notify_succeeded_at IS
  'Timestamp when notifyFounderGeneric returned without throwing. NULL when the send is in flight, the helper threw, or ADMIN_EMAIL was unset.';
COMMENT ON COLUMN for_quants_leads.notify_error IS
  'Sanitized error message (max 500 chars) when notifyFounderGeneric threw OR ADMIN_EMAIL was unset. NULL on clean sends.';

-- --------------------------------------------------------------------------
-- STEP 2: index for the founder CRM "stuck pending notify" view
-- --------------------------------------------------------------------------
-- Partial index keeps the index size proportional to the genuinely
-- stuck queue (target: ~0 rows in steady state). Founder CRM page
-- queries `WHERE processed_at IS NULL` already; layering this index
-- on top means the "show only stuck" filter is index-only.
CREATE INDEX IF NOT EXISTS idx_for_quants_leads_stuck_notify
  ON for_quants_leads (notify_attempted_at DESC)
  WHERE notify_attempted_at IS NOT NULL
    AND notify_succeeded_at IS NULL
    AND processed_at IS NULL;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
-- Same defense-in-depth pattern as migration 030: the migration either
-- achieves the intended state or rolls back. Catches the case where
-- IF NOT EXISTS silently no-ops on a column-name typo or schema drift.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'for_quants_leads'
      AND column_name = 'notify_attempted_at'
  ) THEN
    RAISE EXCEPTION 'migration 115 failed: notify_attempted_at column missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'for_quants_leads'
      AND column_name = 'notify_succeeded_at'
  ) THEN
    RAISE EXCEPTION 'migration 115 failed: notify_succeeded_at column missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'for_quants_leads'
      AND column_name = 'notify_error'
  ) THEN
    RAISE EXCEPTION 'migration 115 failed: notify_error column missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'for_quants_leads'
      AND indexname = 'idx_for_quants_leads_stuck_notify'
  ) THEN
    RAISE EXCEPTION 'migration 115 failed: idx_for_quants_leads_stuck_notify missing';
  END IF;
END $$;
