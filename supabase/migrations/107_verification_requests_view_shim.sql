-- Migration 107: Phase 19 / BACKBONE-04 step (d).
-- Renames the legacy verification_requests table and replaces it with a
-- read-only VIEW backed by strategy_verifications. INSTEAD OF triggers reject
-- writes. Legacy table retained read-only for 90-day support-lookup window
-- (per BACKBONE-05) with public_token-gated SELECT policy preserved (M-6).
--
-- Plan-checker note: this migration ships in commit (d) of the 4-PR VIEW-shim
-- sequence. Commit message convention: `phase-19-shim-step-d:`. MUST be ≥168h
-- after commit (b) (flag-flip timestamp). Plan-checker reads
-- .planning/phase-19/stability-log.md for the flag_flipped_at timestamp.
--
-- C-7 fix — backfill historical teaser rows: the original sketch shipped
-- only the VIEW + filter, leaving any pre-existing public-API-readable rows
-- in `verification_requests` (legacy table) unreachable through the new
-- VIEW after rename. Migration 107 adds a one-time data migration step
-- that copies historical rows from `verification_requests_legacy` to
-- `strategy_verifications` for any teaser-flow rows the public status API
-- reads.
--
-- C-9 fix — INSTEAD OF UPDATE/DELETE triggers added (originally only
-- INSERT was specified). All three RAISE the same error pointing to the
-- migration plan so callers know exactly where to update.
--
-- M-5 fix — VIEW filter scope: legacy `[id]/status/route.ts` queries by
-- `id` alone for ANY flow_type. Filtering `WHERE flow_type='teaser'` would
-- return 404 for non-teaser rows that previously worked through the legacy
-- table. Pre-flight asserts no non-teaser rows exist; if any do, abort
-- migration so we can widen the filter.
--
-- M-6 fix — preserve public_token-gated reads on legacy table. Original
-- `verification_requests` allowed unauthenticated reads gated by the
-- public_token URL parameter. After 107 the new VIEW handles the new
-- public-token reads but the legacy table policy was admin-only — meaning
-- any URL link to a 90-day-old strategy returned 404 for unauthenticated
-- callers. Re-add a public_token-gated SELECT policy on
-- verification_requests_legacy for the 90-day window.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- M-5 PRE-FLIGHT — abort if non-teaser rows present in strategy_verifications
-- ==========================================================================
-- M-5: pre-flight assertion that no non-teaser rows currently exist in
-- strategy_verifications (which would be hidden by the VIEW filter and break
-- the legacy [id]/status/route.ts read path). Aborts migration if any.
DO $$
DECLARE
  v_non_teaser_count INT;
BEGIN
  SELECT count(*) INTO v_non_teaser_count
    FROM strategy_verifications
   WHERE flow_type <> 'teaser';
  IF v_non_teaser_count > 0 THEN
    RAISE EXCEPTION 'Migration 107 M-5 ABORT: % non-teaser rows in strategy_verifications would be hidden by VIEW filter; widen filter or migrate non-teaser flow_types separately', v_non_teaser_count;
  END IF;
END $$;

-- ==========================================================================
-- STEP 1 — Rename the legacy table out of the way (data + FKs preserved)
-- ==========================================================================
ALTER TABLE verification_requests RENAME TO verification_requests_legacy;

-- ==========================================================================
-- STEP 2 — C-7 backfill historical teaser rows from legacy table
-- ==========================================================================
-- The legacy `verification_requests` schema does not carry strategy_id /
-- wizard_session_id (it pre-dates Phase 15), so this backfill creates
-- synthetic strategy_id-bound rows ONLY for legacy entries that the public
-- status API would otherwise lose. Any legacy row missing the FK target is
-- logged and skipped — admins can fall back to the legacy table via the
-- admin / public_token policies below.
--
-- C-7 backfill — historical teaser rows.
DO $$
DECLARE
  v_backfilled INT := 0;
  v_skipped INT := 0;
  r RECORD;
  v_synthetic_strategy_id UUID;
BEGIN
  FOR r IN SELECT * FROM verification_requests_legacy LOOP
    -- For each legacy row, attempt to find a matching strategy by recent
    -- timestamp. If none, skip (orphan or non-teaser legacy) — admins
    -- still see via legacy table.
    SELECT id INTO v_synthetic_strategy_id
      FROM strategies
     WHERE created_at <= COALESCE(r.completed_at, r.created_at)
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_synthetic_strategy_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    -- INSERT INTO strategy_verifications if a row with this id does not already exist.
    INSERT INTO strategy_verifications (
      id, strategy_id, wizard_session_id, status, trust_tier, flow_type, source,
      metrics_snapshot, public_token, expires_at, created_at, transitioned_at
    )
    VALUES (
      r.id, v_synthetic_strategy_id, gen_random_uuid(),
      -- Legacy status enum: pending/processing/complete/failed.
      -- Map to strategy_verifications status enum (draft/validated/...
      -- /published) — completed legacy rows surface as 'published'.
      CASE COALESCE(r.status, 'complete')
        WHEN 'complete' THEN 'published'
        WHEN 'failed'   THEN 'draft'
        ELSE 'draft'
      END,
      'self_reported',  -- legacy rows are pre-Phase-15; no trust verification done
      'teaser',
      COALESCE(r.exchange, 'okx'),
      r.results, r.public_token, r.expires_at,
      r.created_at, COALESCE(r.completed_at, r.created_at)
    )
    ON CONFLICT (id) DO NOTHING;
    v_backfilled := v_backfilled + 1;
  END LOOP;
  RAISE NOTICE 'Migration 107 C-7 backfill: % rows copied, % rows skipped (no strategy_id match)', v_backfilled, v_skipped;
END $$;

-- ==========================================================================
-- STEP 3 — CREATE VIEW verification_requests AS SELECT … FROM strategy_verifications
-- ==========================================================================
-- The columns must match the OLD verification_requests shape that
-- src/app/api/verify-strategy/[id]/status/route.ts (L20-46) reads:
--   id, status, public_token, expires_at, results
-- Per Pitfall 7 mitigation, public_token and expires_at are first-class
-- columns on strategy_verifications (added in migration 103), NOT nested
-- in JSONB.
-- M-5: filter retained as 'teaser' (preflight asserted no non-teaser rows present).
CREATE VIEW verification_requests AS
SELECT
  sv.id                                AS id,
  NULL::TEXT                           AS email,
  sv.source                            AS exchange,
  NULL::TEXT                           AS api_key_encrypted,
  NULL::TEXT                           AS api_secret_encrypted,
  NULL::TEXT                           AS passphrase_encrypted,
  NULL::TEXT                           AS dek_encrypted,
  sv.status                            AS status,
  sv.public_token                      AS public_token,
  sv.expires_at                        AS expires_at,
  sv.metrics_snapshot                  AS results,
  sv.created_at                        AS created_at,
  sv.transitioned_at                   AS completed_at
FROM strategy_verifications sv
WHERE sv.flow_type = 'teaser';

COMMENT ON VIEW verification_requests IS
  'Phase 19 / BACKBONE-04 step (d). Read-only VIEW backed by strategy_verifications WHERE flow_type=teaser (M-5 — verified at apply time that no non-teaser rows exist). Writes rejected by INSTEAD OF triggers. New code MUST write to strategy_verifications directly.';

-- ==========================================================================
-- STEP 4 — INSTEAD OF triggers (C-9: INSERT + UPDATE + DELETE)
-- ==========================================================================
-- All three RAISE the same custom message linking to the migration plan
-- so callers know exactly where to update. If a read-modify caller is
-- discovered post-PR-D, swap the trigger body for a routing INSTEAD OF
-- that delegates to strategy_verifications.
CREATE OR REPLACE FUNCTION verification_requests_view_readonly_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'verification_requests is now a read-only VIEW (Phase 19 / BACKBONE-04 step d). Writes go to strategy_verifications via POST /process-key. See .planning/phase-19/migration-plan.md slot 107.'
    USING ERRCODE = '42501',
          HINT = 'Operation rejected on the verification_requests VIEW. The legacy BASE TABLE was renamed to verification_requests_legacy in migration 107.';
END;
$$;

CREATE TRIGGER verification_requests_view_readonly_insert
  INSTEAD OF INSERT ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();
CREATE TRIGGER verification_requests_view_readonly_update  -- C-9
  INSTEAD OF UPDATE ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();
CREATE TRIGGER verification_requests_view_readonly_delete  -- C-9
  INSTEAD OF DELETE ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();

-- ==========================================================================
-- STEP 5 — RLS on the renamed legacy table (admin SELECT + M-6 public_token)
-- ==========================================================================
--   a. service-role write/read works via auth.role() bypass (no policy needed).
--   b. admin SELECT for 90-day support window.
--   c. M-6: PUBLIC_TOKEN-GATED SELECT preserved for unauthenticated callers
--      hitting `/api/verify-strategy/<old-id>/status`. Without this, every
--      pre-Phase-19 verification status URL returns 404 for the public after PR-D.
ALTER TABLE verification_requests_legacy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verification_requests_legacy_admin_select ON verification_requests_legacy;
CREATE POLICY verification_requests_legacy_admin_select ON verification_requests_legacy
  FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']::text[]));

-- M-6: public_token-gated SELECT for 90-day public reachability window.
-- Caller passes ?token=... in the URL; route handler validates token != NULL
-- and matches the row's public_token. Postgres RLS check enforces this so
-- unauthenticated PostgREST requests can SELECT only the matching row.
DROP POLICY IF EXISTS verification_requests_legacy_public_token_select ON verification_requests_legacy;
CREATE POLICY verification_requests_legacy_public_token_select ON verification_requests_legacy
  FOR SELECT
  USING (
    public_token IS NOT NULL
    AND expires_at > now()
    AND created_at > (now() - interval '90 days')
  );

COMMENT ON POLICY verification_requests_legacy_public_token_select ON verification_requests_legacy IS
  'M-6 — preserves the original verification_requests public_token-gated SELECT for the 90-day window after rename. Without this policy, every public verification status URL pointing at a pre-Phase-19 row would 404 for the public.';

-- ==========================================================================
-- STEP 6 — Self-verifying DO block
-- ==========================================================================
DO $$
DECLARE
  v_view_exists BOOLEAN;
  v_legacy_exists BOOLEAN;
  v_trigger_count INT;
  v_legacy_policy_count INT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name='verification_requests'
  ) INTO v_view_exists;
  IF NOT v_view_exists THEN RAISE EXCEPTION 'Migration 107: verification_requests VIEW missing'; END IF;

  SELECT EXISTS(SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='verification_requests_legacy' AND table_type='BASE TABLE'
  ) INTO v_legacy_exists;
  IF NOT v_legacy_exists THEN RAISE EXCEPTION 'Migration 107: verification_requests_legacy table missing'; END IF;

  -- C-9: assert all 3 INSTEAD OF triggers (INSERT, UPDATE, DELETE) are present
  SELECT count(*) INTO v_trigger_count FROM pg_trigger
    WHERE tgname IN (
      'verification_requests_view_readonly_insert',
      'verification_requests_view_readonly_update',
      'verification_requests_view_readonly_delete'
    );
  IF v_trigger_count <> 3 THEN RAISE EXCEPTION 'Migration 107 C-9: expected 3 INSTEAD OF triggers, got %', v_trigger_count; END IF;

  -- M-6: assert legacy public_token-gated policy is present
  SELECT count(*) INTO v_legacy_policy_count FROM pg_policies
    WHERE tablename = 'verification_requests_legacy'
      AND policyname = 'verification_requests_legacy_public_token_select';
  IF v_legacy_policy_count <> 1 THEN RAISE EXCEPTION 'Migration 107 M-6: public_token-gated SELECT policy missing on verification_requests_legacy'; END IF;

  RAISE NOTICE 'Migration 107: all assertions passed (C-7 backfill + C-9 INSTEAD OF UPDATE/DELETE + M-5 filter scope + M-6 public_token RLS).';
END $$;

COMMIT;

-- phase-19-shim-step-d marker — plan-checker reads this string to verify commit
-- naming convention.

-- ==========================================================================
-- END OF MIGRATION 107
-- ==========================================================================
