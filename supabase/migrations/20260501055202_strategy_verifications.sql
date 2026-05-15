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
-- `p_strategy_name` (the user-typed value from the Upload step). The user
-- types the name on the Upload step (locked in 15-CONTEXT.md and
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

-- ==========================================================================
-- STEP 5: finalize_csv_strategy RPC (sibling per D-02; SECURITY DEFINER)
-- ==========================================================================
-- RPC param resolution note (Phase 15 WARNING fix from checker iteration 1):
-- No overload exists for finalize_csv_strategy; PostgREST resolves by named
-- argument matching, NOT by positional argument order. The order of
-- (p_user_id, p_wizard_session_id, p_fmt, p_strategy_name) below is
-- documentation only — at call time, the Next.js route in plan 15-05
-- passes a JSON object whose keys match these parameter names, and
-- PostgREST routes by key. Reordering the SQL signature would NOT break
-- existing callers; renaming any parameter WOULD. Do not rename.
--
-- Cross-AI revision 2026-04-30: parameter is `p_strategy_name`. The user
-- types the name on the Upload step; the route forwards it; this RPC
-- writes it to strategies.name.
--
-- Pattern: copy the structure of create_wizard_strategy at
-- supabase/migrations/20260411103316_wizard_source_column.sql:118-186 (atomic two-table
-- insert with SECURITY DEFINER + manual auth.uid() guard) but adapt for the
-- CSV path: no api_keys insert; instead an immediate strategy_verifications
-- insert at status='validated', trust_tier='csv_uploaded'.
CREATE OR REPLACE FUNCTION public.finalize_csv_strategy(
  p_user_id            UUID,
  p_wizard_session_id  UUID,
  p_fmt                TEXT,
  p_strategy_name      TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid     UUID := auth.uid();
  v_strategy_id  UUID;
BEGIN
  -- Caller-identity guard (mirrors create_wizard_strategy:140-153):
  -- the route layer calls with the authenticated user's id; we assert
  -- it matches the JWT so a SECURITY DEFINER RPC can't be abused via
  -- service_role to write rows under another user.
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_csv_strategy called without an auth session'
      USING ERRCODE = '42501';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = '42501';
  END IF;

  -- Format whitelist (mirrors the analytics service envelope contract).
  IF p_fmt NOT IN ('daily_returns','daily_nav','trades') THEN
    RAISE EXCEPTION 'finalize_csv_strategy: invalid fmt %', p_fmt
      USING ERRCODE = '22023';
  END IF;

  -- Strategy-name guard — the user typed it on the Upload step. We
  -- enforce 1–80 chars matching the UI-SPEC contract; the route layer
  -- also validates, but defense-in-depth lives here so a service-role
  -- caller cannot bypass the limit. Empty / oversize / NULL all reject
  -- under SQLSTATE 22023 with a distinguishing message substring so
  -- plan 15-06 tests can pin the guard separately from the fmt guard.
  IF p_strategy_name IS NULL OR length(p_strategy_name) = 0 THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_strategy_name is required'
      USING ERRCODE = '22023';
  END IF;

  IF length(p_strategy_name) > 80 THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_strategy_name exceeds 80 characters'
      USING ERRCODE = '22023';
  END IF;

  -- Insert the strategies row. source='csv' marks the row's ingestion
  -- path; status='pending_review' matches finalize_wizard_strategy's
  -- post-promotion state so downstream queries (strategy_grid,
  -- /strategies/[id]) treat CSV strategies the same as API strategies
  -- once they reach this terminal state. supported_exchanges is empty
  -- because CSV strategies have no broker linkage. strategy_types /
  -- subtypes / markets default empty per Phase 15 v0; Phase 17 metadata
  -- step (deferred) will populate.
  INSERT INTO strategies (
    user_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges
  )
  VALUES (
    p_user_id, p_strategy_name, 'pending_review', 'csv',
    '{}', '{}', '{}', '{}'::text[]
  )
  RETURNING id INTO v_strategy_id;

  -- Insert the verification row at status='validated', trust_tier='csv_uploaded'.
  -- Phase 16 / OBSERV-06 will populate correlation_id; we leave NULL.
  -- FK ordering note: PostgreSQL allows the strategy_verifications.strategy_id
  -- FK to reference the just-inserted strategy because both inserts run in
  -- the same transaction (the SECURITY DEFINER function body is implicitly
  -- transactional). The FK check happens at COMMIT, not at the second INSERT.
  INSERT INTO strategy_verifications (
    strategy_id, wizard_session_id, status, trust_tier, flow_type, source,
    errors, correlation_id
  ) VALUES (
    v_strategy_id, p_wizard_session_id, 'validated', 'csv_uploaded', 'csv', 'csv',
    NULL, NULL
  );

  RETURN v_strategy_id;
END;
$$;

-- ==========================================================================
-- STEP 6: REVOKE / GRANT EXECUTE on finalize_csv_strategy
-- ==========================================================================
-- Mirrors the create_wizard_strategy / finalize_wizard_strategy revoke +
-- grant pattern from migration 031: PUBLIC and anon get nothing;
-- authenticated callers (the Next.js route under withAuth) get EXECUTE;
-- service_role also gets EXECUTE so worker / admin tooling can finalize
-- on behalf of a user during integration tests.
REVOKE ALL ON FUNCTION public.finalize_csv_strategy(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_csv_strategy(UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_csv_strategy(UUID, UUID, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.finalize_csv_strategy IS
  'Phase 15 / CSV-01: sibling to finalize_wizard_strategy. Atomically creates a strategies row (source=csv, status=pending_review, name=p_strategy_name) AND a strategy_verifications row (status=validated, trust_tier=csv_uploaded) for the CSV ingestion path. p_strategy_name is the user-typed name from the Upload step (1-80 chars). Phase 19 / BACKBONE-04 will absorb this into the unified backbone via VIEW-shim sequence.';

-- ==========================================================================
-- STEP 7: Self-verifying DO block — 6 assertions (a-f)
-- ==========================================================================
-- Mirror migration 070 STEP 10 / 087 STEP 6 structure. Each RAISE
-- EXCEPTION includes the migration number so apply-time failures are
-- unambiguous. The migration is wrapped in BEGIN ... COMMIT; if any
-- assertion fires the entire transaction rolls back and the database is
-- unchanged — no partial migration state is possible.
DO $$
DECLARE
  v_column_count INT;
  v_rls_enabled  BOOLEAN;
  v_policy_count INT;
  v_index_count  INT;
  v_fn_oid       OID;
BEGIN
  -- (a) table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='strategy_verifications'
  ) THEN
    RAISE EXCEPTION 'Migration 093 failed: strategy_verifications table missing';
  END IF;

  -- (b) all 12 expected columns present
  SELECT count(*) INTO v_column_count
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='strategy_verifications'
      AND column_name IN (
        'id','strategy_id','wizard_session_id','status','trust_tier',
        'flow_type','source','metrics_snapshot','errors','correlation_id',
        'created_at','updated_at'
      );
  IF v_column_count <> 12 THEN
    RAISE EXCEPTION 'Migration 093 failed: expected 12 columns, found %', v_column_count;
  END IF;

  -- (c) RLS enabled
  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname='strategy_verifications'
      AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public');
  IF NOT COALESCE(v_rls_enabled, false) THEN
    RAISE EXCEPTION 'Migration 093 failed: RLS not enabled on strategy_verifications';
  END IF;

  -- (d) 3 named policies present
  SELECT count(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname='public' AND tablename='strategy_verifications'
      AND policyname IN (
        'strategy_verifications_owner_select',
        'strategy_verifications_admin_select',
        'strategy_verifications_service_all'
      );
  IF v_policy_count <> 3 THEN
    RAISE EXCEPTION 'Migration 093 failed: expected 3 RLS policies, found %', v_policy_count;
  END IF;

  -- (e) 2 secondary indexes present
  SELECT count(*) INTO v_index_count
    FROM pg_indexes
    WHERE schemaname='public' AND tablename='strategy_verifications'
      AND indexname IN (
        'strategy_verifications_strategy_id_idx',
        'strategy_verifications_status_idx'
      );
  IF v_index_count <> 2 THEN
    RAISE EXCEPTION 'Migration 093 failed: expected 2 secondary indexes, found %', v_index_count;
  END IF;

  -- (f) finalize_csv_strategy RPC registered
  SELECT oid INTO v_fn_oid
    FROM pg_proc
    WHERE proname='finalize_csv_strategy'
      AND pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='public');
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 093 failed: finalize_csv_strategy RPC missing';
  END IF;

  RAISE NOTICE 'Migration 093: all assertions passed.';
END
$$;

COMMIT;

-- ==========================================================================
-- END OF MIGRATION 093
-- ==========================================================================
-- Summary (one-line per step):
--   Step 1 — strategy_verifications table (12 columns + 4 TEXT CHECKs +
--            FK to strategies(id) ON DELETE CASCADE)
--   Step 2 — 2 secondary indexes (strategy_id + status)
--   Step 3 — 3-tier RLS policies (owner SELECT, admin SELECT,
--            service_role ALL)
--   Step 4 — COMMENT ON TABLE / COLUMNS for table + 5 forward-compat slots
--   Step 5 — finalize_csv_strategy SECURITY DEFINER RPC (atomic
--            strategies + strategy_verifications insert)
--   Step 6 — REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated,
--            service_role
--   Step 7 — self-verifying DO block: 6 assertions (a-f)
--
-- Downstream consumers
-- --------------------
-- - Plan 15-02: Pandera csv_validator.py — pure logic; does not touch this
--   migration.
-- - Plan 15-03: factsheet + marketplace tile join — reads
--   strategy_verifications.trust_tier filtered by strategy_id.
-- - Plan 15-04: <TrustTierLabel> component — purely client-side, consumes
--   the trust_tier value joined upstream.
-- - Plan 15-05: Next.js /api/strategies/csv-finalize route — calls
--   finalize_csv_strategy via supabase.rpc('finalize_csv_strategy', {
--     p_user_id, p_wizard_session_id, p_fmt, p_strategy_name }).
-- - Plan 15-06: integration tests — exercise the RPC under owner /
--   admin / service-role auth and assert RLS isolation.
-- - Plan 15-07: /admin/csv-status page — reads the admin SELECT policy.
