-- Migration 093: strategy_verifications table + RLS + 2 secondary indexes +
-- finalize_csv_strategy SECURITY DEFINER RPC + self-verifying DO block.
-- Phase 15 / CSV-01..CSV-03 — first-class flow_type='csv' adapter.
--
-- Why this migration exists
-- -------------------------
-- Phase 15 unblocks 10 onboarding teams with a CSV ingestion path that runs
-- alongside (not through) the API-key wizard. Per locked decision D-04 the
-- `trust_tier` column lives ONLY on `strategy_verifications` — no
-- denormalization onto `strategies`. Per locked decision D-02 the CSV
-- finalize is a SIBLING RPC named `finalize_csv_strategy`; it does NOT
-- extend `finalize_wizard_strategy`. Phase 19 reserves migration slots
-- 094–097 (VIEW shim sequence + fingerprint + idempotency); Phase 15 owns
-- 093 only.
--
-- Cross-AI revision 2026-04-30: the RPC parameter for the strategy name is
-- `p_strategy_name` (NOT the prior iteration-1 name `p_placeholder_name`).
-- The user types the name on the Upload step (locked in 15-CONTEXT.md and
-- 15-UI-SPEC.md §8.2); the route forwards the typed value to the RPC; the
-- RPC writes it verbatim to strategies.name. The legacy STRATEGY_NAMES
-- codename array is NOT imported anywhere on the Phase 15 CSV path.
--
-- What this migration does (10-step ordering, mirrors migration 070 shape)
-- -----------------------------------------------------------------------
-- 1. CREATE TABLE strategy_verifications — TEXT CHECK on status / trust_tier
--    / flow_type / source; FK to strategies(id) ON DELETE CASCADE.
--    wizard_session_id intentionally has no UNIQUE INDEX in Phase 15;
--    Phase 19 / BACKBONE-07 will add it during the idempotency PR.
-- 2. Two secondary indexes (strategy_id + status) for the factsheet +
--    marketplace + admin status page join paths.
-- 3. ENABLE ROW LEVEL SECURITY + 3-tier policies (owner SELECT, admin
--    SELECT, service_role ALL) mirroring migration 070 STEP 9.
-- 4. COMMENT ON TABLE / COLUMNS — anchors the row to Phase 15 + flags
--    Phase 19 BACKBONE-07 wizard_session_id and Phase 16 OBSERV-06
--    correlation_id slots so future readers know the forward-compat seams.
-- 5. CREATE OR REPLACE FUNCTION finalize_csv_strategy — atomic two-table
--    insert: strategies (source='csv', status='pending_review') +
--    strategy_verifications (status='validated', trust_tier='csv_uploaded').
--    SECURITY DEFINER + manual auth.uid() guard mirroring migration 031's
--    create_wizard_strategy lines 118-186.
-- 6. REVOKE / GRANT EXECUTE for finalize_csv_strategy.
-- 7. Self-verifying DO block — 6 assertions (a-f): table exists, all 12
--    expected columns named, RLS enabled, 3 named policies present, 2
--    secondary indexes present, finalize_csv_strategy RPC registered.
--
-- What this migration does NOT do
-- -------------------------------
-- - Does NOT add `strategy_verifications.wizard_session_id` UNIQUE INDEX
--   (Phase 19 / BACKBONE-07 reservation).
-- - Does NOT denormalize `trust_tier` onto `strategies` (per D-04).
-- - Does NOT extend `finalize_wizard_strategy` (per D-02 — sibling RPC).
-- - Does NOT write any rows; downstream waves (15-02, 15-05, 15-06) do.
-- - Does NOT register correlation_id values (Phase 16 / OBSERV-06).
--
-- Application path
-- ----------------
-- Authored here; applied to the linked Supabase TEST project
-- (qmnijlgmdhviwzwfyzlc) via mcp__plugin_supabase_supabase__apply_migration.
-- The self-verifying DO block at the tail raises EXCEPTION on any invariant
-- failure — if push returns non-zero, read the error and fix the migration.
-- Do NOT skip past a failed self-verify. Production deployment is a
-- separate gate handled at /ship time.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: CREATE TABLE strategy_verifications (D-04 + 15-PATTERNS.md §1)
-- ==========================================================================
-- Schema lifted verbatim from 15-CONTEXT.md §Specifics + 15-PATTERNS.md §1
-- TEXT CHECK pattern (NOT enum types — ALTER ergonomics matter when Phase
-- 19 BACKBONE adds new flow_type / source values). The flow_type and
-- source CHECK lists carry the FULL Phase 19 vocabulary; Phase 15 only
-- writes flow_type='csv' + source='csv', but admitting the broader set
-- means migration 094 doesn't have to ALTER the constraint.
CREATE TABLE IF NOT EXISTS strategy_verifications (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id        UUID        NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  wizard_session_id  UUID        NOT NULL,
  status             TEXT        NOT NULL CHECK (status IN (
                       'draft','validated','metrics_captured',
                       'encrypted','report_queued','published'
                     )),
  trust_tier         TEXT        NOT NULL CHECK (trust_tier IN (
                       'api_verified','csv_uploaded','self_reported'
                     )),
  flow_type          TEXT        NOT NULL CHECK (flow_type IN (
                       'teaser','onboard','internal_report','csv','resync'
                     )),
  source             TEXT        NOT NULL CHECK (source IN (
                       'okx','binance','bybit','csv'
                     )),
  metrics_snapshot   JSONB,
  errors             JSONB,
  correlation_id     UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================================================
-- STEP 2: Secondary indexes (15-PATTERNS.md §1 + factsheet/marketplace/admin
-- read paths)
-- ==========================================================================
-- Two indexes — strategy_id for the factsheet + marketplace + admin status
-- page join paths, status for admin filters / future flag-monitor cron.
CREATE INDEX IF NOT EXISTS strategy_verifications_strategy_id_idx
  ON strategy_verifications (strategy_id);
CREATE INDEX IF NOT EXISTS strategy_verifications_status_idx
  ON strategy_verifications (status);

-- ==========================================================================
-- STEP 3: 3-tier RLS policies (15-PATTERNS.md §1; analog: migration 070
-- STEP 9 lines 391-413 — copied verbatim with table-name substitution)
-- ==========================================================================
ALTER TABLE strategy_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_verifications_owner_select ON strategy_verifications;
CREATE POLICY strategy_verifications_owner_select ON strategy_verifications FOR SELECT
  USING (
    strategy_id IN (
      SELECT id FROM strategies WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS strategy_verifications_admin_select ON strategy_verifications;
CREATE POLICY strategy_verifications_admin_select ON strategy_verifications FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']::text[]));

-- Belt-and-suspenders explicit service_role policy (070 line 407 rationale —
-- service_role bypasses RLS by default per ADR-0003, but an explicit policy
-- documents intent and survives any future bypass-flip).
DROP POLICY IF EXISTS strategy_verifications_service_all ON strategy_verifications;
CREATE POLICY strategy_verifications_service_all ON strategy_verifications FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- NOTE: No INSERT/UPDATE/DELETE policy for authenticated — the
-- finalize_csv_strategy RPC writes rows via SECURITY DEFINER (STEP 5),
-- which bypasses RLS while enforcing auth.uid() = p_user_id manually.
-- Admin status page reads (plan 15-07) ride the admin SELECT policy above.

-- ==========================================================================
-- STEP 4: Comments (anchor to Phase 15 + Phase 16 / Phase 19 forward-compat)
-- ==========================================================================
COMMENT ON TABLE strategy_verifications IS
  'Per-strategy verification tracking row. Phase 15 / CSV-01..CSV-03 — migration 093. Status state machine + trust-tier label; flow_type discriminates teaser/onboard/csv/internal_report/resync. Phase 19 / BACKBONE-07 will add UNIQUE INDEX on wizard_session_id (idempotency).';

COMMENT ON COLUMN strategy_verifications.wizard_session_id IS
  'Phase 19 / BACKBONE-07 will add a UNIQUE INDEX here for cross-flow idempotency. Phase 15 leaves it un-uniqued so reruns of the CSV path during early-customer onboarding do not collide.';

COMMENT ON COLUMN strategy_verifications.correlation_id IS
  'Phase 16 / OBSERV-06 will populate this with the request correlation_id from analytics-client.ts:66. Phase 15 leaves NULL — the column is reserved so 094 does not have to ALTER TABLE.';

COMMENT ON COLUMN strategy_verifications.trust_tier IS
  'csv_uploaded variant ships in Phase 15 (the only value finalize_csv_strategy writes). api_verified + self_reported are reserved for Phase 17 / DESIGN-01 trust-tier polish + Phase 19 unified backbone consumers.';

COMMENT ON COLUMN strategy_verifications.flow_type IS
  'Phase 15 only writes flow_type=''csv''. The full vocabulary (teaser/onboard/internal_report/csv/resync) is admitted by the CHECK so Phase 19 BACKBONE PRs do not have to ALTER the constraint when the unified flow lights up.';

COMMENT ON COLUMN strategy_verifications.source IS
  'Phase 15 only writes source=''csv''. The full vocabulary (okx/binance/bybit/csv) is admitted by the CHECK so Phase 19 BACKBONE PRs unifying API + CSV paths do not have to ALTER the constraint.';

-- (Task 2 will append: finalize_csv_strategy RPC, REVOKE/GRANT, self-verify
--  DO block, and the matching COMMIT; do NOT close the transaction here.)
