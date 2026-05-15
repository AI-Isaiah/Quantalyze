-- Migration 046: reconciliation_reports + reconcile_strategy kind
-- Sprint 5 Task 5.1b — Reconciliation Diff Service
--
-- Why this migration exists
-- -------------------------
-- Raw fill ingestion (migration 039 + 041) captures per-fill trades into
-- the `trades` table. Without a nightly cross-check against the live
-- exchange, a silent ingestion gap (Phase 2 always failing post-429,
-- Bybit rotating fill_ids, a symbol we never discovered) accumulates
-- for weeks before anyone notices via the strategy_analytics drift.
--
-- This migration adds the storage substrate for a nightly reconciliation
-- job:
--   - `reconciliation_reports` — one row per (strategy, report_date)
--     summarizing the diff. JSONB `discrepancies` holds the per-mismatch
--     detail for the admin read path.
--   - `reconcile_strategy` registered in compute_job_kinds so the new
--     worker handler can be enqueued by the nightly cron.
--
-- Admin UI for the reports is CUT from Sprint 5 (Task 5.1c); the table
-- is populated by the worker and readable only by the service role
-- client. No public-read RLS policy — v1 is strict service-role only.
--
-- What this migration does
-- ------------------------
-- 1. CREATE TABLE reconciliation_reports with UNIQUE (strategy_id,
--    report_date) so the worker can upsert idempotently if a job is
--    re-run for the same date.
-- 2. CHECK status IN ('clean','discrepancies','needs_manual_review').
-- 3. RLS enabled with NO public read/write policies. Service-role client
--    bypasses RLS (Supabase default), so the worker can INSERT/UPDATE
--    without additional grants. Admin read path would add a future
--    policy once the UI lands (5.1c).
-- 4. Register 'reconcile_strategy' in compute_job_kinds (follows the
--    migration-044 sync_funding pattern: INSERT ... ON CONFLICT DO
--    NOTHING into the registry table; no CHECK/ALTER needed).
-- 5. Self-verifying DO block.
--
-- What this migration does NOT do
-- -------------------------------
-- - Does NOT schedule the cron — that lives in `vercel.json` crons array.
-- - Does NOT backfill historical reports. First report lands on first
--   nightly run post-deploy.
-- - Does NOT wire `sync_failure` alerts — those are inserted by the
--   worker handler (`run_reconcile_strategy_job`) directly into
--   portfolio_alerts, leveraging migration 042's partial unique index
--   for dedup.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: reconciliation_reports table
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reconciliation_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id       UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  report_date       DATE NOT NULL,
  status            TEXT NOT NULL
                      CHECK (status IN ('clean', 'discrepancies', 'needs_manual_review')),
  discrepancy_count INT NOT NULL DEFAULT 0,
  discrepancies     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, report_date)
);

COMMENT ON TABLE reconciliation_reports IS
  'Nightly reconciliation output: one row per (strategy, date). Populated by run_reconcile_strategy_job (analytics-service). Admin-read-only in v1 — no public RLS policy; service-role client bypasses. See migration 046.';

COMMENT ON COLUMN reconciliation_reports.status IS
  'Roll-up: clean (no discrepancies), discrepancies (at least one mismatch), needs_manual_review (N:M ambiguous tuple match — escalated).';

COMMENT ON COLUMN reconciliation_reports.discrepancies IS
  'JSONB list of {kind, exchange_fill_id, details}. Kinds: missing_in_db, id_drift, mismatch_quantity, mismatch_price, unknown_in_exchange, needs_manual_review, stale_sync. See services/reconciliation.py.';

-- Admin diagnostic query path: "show me the latest report for strategy X".
CREATE INDEX IF NOT EXISTS reconciliation_reports_strategy_date
  ON reconciliation_reports (strategy_id, report_date DESC);

-- --------------------------------------------------------------------------
-- STEP 2: RLS
-- --------------------------------------------------------------------------
ALTER TABLE reconciliation_reports ENABLE ROW LEVEL SECURITY;

-- No public read/write policies — v1 is strict service-role only.
-- With RLS enabled and zero policies, authenticated/anon queries return
-- zero rows while the service-role client (which bypasses RLS by
-- default in Supabase) retains full read/write access for the worker
-- handler and future admin UI. Future admin-UI (5.1c cut for Sprint 5)
-- would add a SELECT policy gated on a profiles.is_admin flag.

-- --------------------------------------------------------------------------
-- STEP 3: register reconcile_strategy kind
-- --------------------------------------------------------------------------
-- compute_job_kinds is a simple registry table (migration 032); adding
-- a new kind is INSERT, not ALTER TABLE. Mirrors 044's sync_funding
-- registration.
INSERT INTO compute_job_kinds (name) VALUES ('reconcile_strategy')
  ON CONFLICT (name) DO NOTHING;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_rls_enabled BOOLEAN;
BEGIN
  -- 1. reconciliation_reports table exists
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'reconciliation_reports'
  ) THEN
    RAISE EXCEPTION 'Migration 046 failed: reconciliation_reports table missing';
  END IF;

  -- 2. UNIQUE (strategy_id, report_date)
  IF NOT EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'reconciliation_reports'
      AND indexdef ILIKE '%UNIQUE%strategy_id%report_date%'
  ) THEN
    RAISE EXCEPTION 'Migration 046 failed: reconciliation_reports (strategy_id, report_date) UNIQUE missing';
  END IF;

  -- 3. status CHECK constraint present
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reconciliation_reports'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%clean%discrepancies%needs_manual_review%'
  ) THEN
    RAISE EXCEPTION 'Migration 046 failed: reconciliation_reports status CHECK constraint missing';
  END IF;

  -- 4. RLS enabled
  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'reconciliation_reports'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'Migration 046 failed: RLS not enabled on reconciliation_reports';
  END IF;

  -- 5. reconcile_strategy kind registered
  IF NOT EXISTS(
    SELECT 1 FROM compute_job_kinds WHERE name = 'reconcile_strategy'
  ) THEN
    RAISE EXCEPTION 'Migration 046 failed: reconcile_strategy kind not registered in compute_job_kinds';
  END IF;

  RAISE NOTICE 'Migration 046: reconciliation_reports + reconcile_strategy kind installed and verified.';
END
$$;

COMMIT;
