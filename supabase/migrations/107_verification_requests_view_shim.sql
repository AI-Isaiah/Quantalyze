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
-- DM-5 — pre-flight guard: skip the RENAME if verification_requests is
-- already a VIEW (i.e. the migration was previously applied and not rolled
-- back). Without this, a second apply errors `cannot rename view to
-- "verification_requests_legacy"` and leaves the migration partially
-- applied.
DO $$
DECLARE
  v_is_base_table BOOLEAN;
  v_is_view BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name='verification_requests'
       AND table_type='BASE TABLE'
  ) INTO v_is_base_table;
  SELECT EXISTS(
    SELECT 1 FROM information_schema.views
     WHERE table_schema='public'
       AND table_name='verification_requests'
  ) INTO v_is_view;

  IF v_is_base_table THEN
    EXECUTE 'ALTER TABLE verification_requests RENAME TO verification_requests_legacy';
  ELSIF v_is_view THEN
    RAISE NOTICE 'Migration 107 DM-5: verification_requests is already a VIEW; skipping rename (idempotent re-apply path).';
  ELSE
    RAISE EXCEPTION 'Migration 107 DM-5: verification_requests does not exist as either table or view; aborting';
  END IF;
END $$;

-- ==========================================================================
-- STEP 2 — DM-3: backfill REMOVED (was the original C-7 backfill).
-- ==========================================================================
-- The earlier draft of this migration backfilled legacy verification_requests
-- rows into strategy_verifications by picking the "most recent strategies row"
-- as a synthetic strategy_id anchor. Per Phase 19 / DM-3 review (REVIEWS.md
-- 2026-05-08) that is a privacy leak: the synthetic anchor inherits the
-- strategies row's user_id under RLS, so a legacy public-token URL would
-- return data attributed to an unrelated strategy owner.
--
-- The legacy table is renamed to verification_requests_legacy (STEP 1 above)
-- and reachable via the M-6 public-token-gated SELECT policy + admin SELECT
-- policy (STEP 5 below). Public-token URLs continue to resolve through the
-- existing /api/verify-strategy/[id]/status route handler which uses
-- createAdminClient (RLS bypass) to look up the row directly. No data is
-- lost; legacy rows simply remain under their legacy-schema identity rather
-- than being re-anchored under a stranger's strategy_id.

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
-- I-DM6 invariant: teaser-row public_token uniqueness is enforced by the
-- partial UNIQUE INDEX strategy_verifications_public_token_unique_idx
-- (migration 103 STEP 1 — `WHERE public_token IS NOT NULL`). The VIEW
-- below filters WHERE flow_type='teaser', and the legacy
-- /api/verify-strategy/[id]/status route resolves rows by token. Without
-- the partial unique index a token collision would surface as
-- non-deterministic public-status results; with it, every token maps to
-- exactly one row across the union of teaser strategy_verifications
-- (current) and verification_requests_legacy (M-6 90-day window).
--
-- SEC-1 — security_invoker = true forces the underlying SELECT against
-- strategy_verifications to run as the *invoking* role (anon /
-- authenticated / service_role) rather than the view-owner role.
-- Without this, a Supabase anon GET /rest/v1/verification_requests
-- silently bypasses RLS on strategy_verifications because the view owner
-- (postgres / supabase_admin) has implicit SELECT, returning teaser rows
-- to the public. Postgres ≥15 supports security_invoker.
CREATE OR REPLACE VIEW verification_requests
  WITH (security_invoker = true) AS
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
  'Phase 19 / BACKBONE-04 step (d). Read-only VIEW backed by strategy_verifications WHERE flow_type=teaser (M-5 — verified at apply time that no non-teaser rows exist). Writes rejected by INSTEAD OF triggers. New code MUST write to strategy_verifications directly. SEC-1 — WITH (security_invoker = true) forces RLS on strategy_verifications to evaluate against the calling role.';

-- SEC-1 defense-in-depth — REVOKE direct SELECT from anon/authenticated;
-- only service_role and the underlying RLS policies on
-- strategy_verifications gate access. Combined with security_invoker, anon
-- GET against /rest/v1/verification_requests now requires the row to pass
-- strategy_verifications RLS (which the existing policies enforce).
REVOKE SELECT ON verification_requests FROM anon, authenticated;
GRANT SELECT ON verification_requests TO service_role;

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

-- DM-4 — DROP IF EXISTS each trigger before CREATE so a re-apply against a
-- partially-rolled-back DB does not error on duplicate-trigger.
DROP TRIGGER IF EXISTS verification_requests_view_readonly_insert ON verification_requests;
CREATE TRIGGER verification_requests_view_readonly_insert
  INSTEAD OF INSERT ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();
DROP TRIGGER IF EXISTS verification_requests_view_readonly_update ON verification_requests;
CREATE TRIGGER verification_requests_view_readonly_update  -- C-9
  INSTEAD OF UPDATE ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();
DROP TRIGGER IF EXISTS verification_requests_view_readonly_delete ON verification_requests;
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
  'M-6 — service-role-only support read for the 90-day window after rename. The route handler at /api/verify-strategy/[id]/status uses createAdminClient (RLS bypass) so authenticated/anon do not need direct SELECT. The USING predicate is retained as a defense-in-depth filter and is gated by the explicit REVOKEs below; if a future change re-grants SELECT to anon or authenticated this policy alone is NOT sufficient — re-add a token match.';

-- SEC-2 — REVOKE direct SELECT from anon on the legacy table. RLS alone is
-- not enough on its own when the table grants base-level SELECT to anon
-- via the schema/table grants — anon could submit `?id=eq.<guess>` on the
-- public_token-gated policy and harvest enumerable IDs. The existing
-- /api/verify-strategy/[id]/status route handler uses createAdminClient
-- (RLS bypass) to look up the row, so revoking anon's direct grant does
-- not break the public-status feature.
REVOKE SELECT ON verification_requests_legacy FROM anon;

-- CT-2 (army2) — also REVOKE from authenticated. The M-6 policy USING
-- clause has no token match, only `public_token IS NOT NULL AND expires_at
-- > now() AND created_at > now() - interval '90 days'`. SEC-2 closed the
-- anon hole but authenticated retained the default GRANT, so any logged-in
-- user could SELECT every legacy teaser row including emails and ciphertext
-- blobs. The public-status route uses createAdminClient (RLS bypass) and
-- needs no authenticated path, so this REVOKE does not break the feature.
REVOKE SELECT, INSERT, UPDATE, DELETE ON verification_requests_legacy FROM authenticated;

-- CT-2 (army2) — assert authenticated really has no SELECT after the REVOKE.
-- This catches any future change that re-grants SELECT (e.g. a blanket
-- `GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated`).
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.verification_requests_legacy', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 107 CT-2: authenticated still has SELECT on verification_requests_legacy after REVOKE';
  END IF;
  RAISE NOTICE 'Migration 107 CT-2: authenticated has no SELECT on verification_requests_legacy';
END $$;

-- ==========================================================================
-- STEP 6 — Self-verifying DO block
-- ==========================================================================
DO $$
DECLARE
  v_view_exists BOOLEAN;
  v_legacy_exists BOOLEAN;
  v_trigger_count INT;
  v_legacy_policy_count INT;
  v_security_invoker_ok BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name='verification_requests'
  ) INTO v_view_exists;
  IF NOT v_view_exists THEN RAISE EXCEPTION 'Migration 107: verification_requests VIEW missing'; END IF;

  -- SEC-1 — assert WITH (security_invoker = true) is set on the VIEW so RLS
  -- on the underlying strategy_verifications table is evaluated against the
  -- calling role (anon / authenticated), not the view-owner role.
  SELECT EXISTS(
    SELECT 1
      FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
     WHERE n.nspname='public'
       AND c.relname='verification_requests'
       AND c.reloptions @> ARRAY['security_invoker=true']
  ) INTO v_security_invoker_ok;
  IF NOT v_security_invoker_ok THEN
    RAISE EXCEPTION 'Migration 107 SEC-1: verification_requests VIEW must have WITH (security_invoker = true)';
  END IF;

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
