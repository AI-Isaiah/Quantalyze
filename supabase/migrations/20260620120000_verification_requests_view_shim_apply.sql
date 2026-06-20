-- ============================================================================
-- Migration: verification_requests VIEW-shim — REAL APPLY ("migration 107")
-- Phase 19 / BACKBONE-04 step (d)
-- ============================================================================
-- This is the genuine apply of the VIEW-shim that the placeholder
-- `20260509082818_verification_requests_view_shim.sql` only RESERVED (its
-- schema_migrations row was inserted to stop `db push` re-applying, but its
-- SQL body NEVER executed on prod — see that file's DEFERRED-APPLY header).
--
-- Per that header's instruction ("write a NEW migration file with a different
-- timestamp containing the corrected body + corresponding sanitize_user
-- patch"), this file carries:
--   1. The corrected migration 107 body (rename + VIEW + INSTEAD OF triggers
--      + legacy RLS), identical in intent to the placeholder but apply-ready.
--   2. STEP 5.5 — the MANDATORY sanitize_user repoint (B3). Without it, GDPR
--      erasure (`DELETE FROM verification_requests`) hits the VIEW's INSTEAD OF
--      DELETE trigger and raises SQLSTATE 42501, breaking account deletion.
--
-- The placeholder file + its schema_migrations row are intentionally LEFT IN
-- PLACE (do not delete — that re-opens the original supabase-migrate failure).
-- `db push` skips the placeholder (version recorded) and applies THIS file.
--
-- Prereqs verified against prod (khslejtfbuezsmvmtsdn) on 2026-05-25:
--   • M-5 preflight: 0 non-teaser rows with public_token IS NOT NULL.
--   • public.current_user_has_app_role(text[]) exists.
--   • verification_requests is a BASE TABLE; verification_requests_legacy absent.
--   • sanitize_user contains exactly one `DELETE FROM verification_requests
--     WHERE email` line (SECURITY DEFINER, search_path public,pg_catalog).
--
-- GATE STATUS (2026-06-20 — soak COMPLETE, shipping): the 168h soak is green.
-- Kill-switch process_key_unified_backbone='on' since 2026-05-25T15:51:07Z
-- (~620h elapsed >> 168h); 0 writes to the legacy table since the flip; 14/7
-- daily error-rate rows recorded, max 0.0% (< 0.5%). Prod preconditions
-- re-verified on apply day: verification_requests is a BASE TABLE,
-- verification_requests_legacy absent, sanitize_user still un-repointed, all 9
-- VIEW-projected strategy_verifications columns present, M-5 count 0. See
-- .planning/phase-19/stability-log.md + .github/workflows/phase-19-stability.yml.
-- The STEP 0.5 apply-time gate below still self-aborts if the flag is not 'on'.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 0 — M-5 PRE-FLIGHT (PR-X1-narrowed): abort if any non-teaser row is
-- reachable through the legacy public-status path (flow_type<>'teaser' AND
-- public_token IS NOT NULL). Those — and only those — would be silently
-- hidden by the VIEW's `WHERE flow_type='teaser'` filter.
-- ==========================================================================
DO $$
DECLARE
  v_non_teaser_count INT;
BEGIN
  SELECT count(*) INTO v_non_teaser_count
    FROM strategy_verifications
   WHERE flow_type <> 'teaser'
     AND public_token IS NOT NULL;
  IF v_non_teaser_count > 0 THEN
    RAISE EXCEPTION 'view-shim M-5 ABORT: % non-teaser rows in strategy_verifications have public_token IS NOT NULL and would be hidden by the VIEW filter; widen filter or migrate those rows separately', v_non_teaser_count;
  END IF;
END $$;

-- ==========================================================================
-- STEP 0.5 — APPLY-TIME SAFETY GATE (fail-loud foot-gun guard).
-- The LIVE legacy verify-strategy handler enforces a per-email rate limit by
-- counting verification_requests.email (src/app/api/verify-strategy/route.ts).
-- This VIEW maps email -> NULL, so applying the shim while the legacy path is
-- still live (kill-switch 'off') silently degrades that limit. The shim must
-- only apply once the unified backbone owns traffic (kill-switch 'on' + soak).
--
-- Rebuild-safe: a fresh `supabase db reset` seeds the kill-switch 'off' via
-- migration 20260510173005 (updated_by='migration-104-seed') and has no
-- traffic, so the pristine never-flipped seed is EXEMPT (as are absent/'on'
-- states). We abort ONLY when the flag is 'off' AND has been touched in a real
-- environment (updated_by <> the seed marker) — i.e. a genuine prod
-- premature-apply. (The public endpoint also has an IP rate-limit backstop.)
-- ==========================================================================
DO $$
DECLARE
  v_value      TEXT;
  v_updated_by TEXT;
BEGIN
  SELECT value, updated_by INTO v_value, v_updated_by
    FROM feature_flags
   WHERE flag_key = 'process_key_unified_backbone';

  IF v_value = 'off' AND COALESCE(v_updated_by, '') <> 'migration-104-seed' THEN
    RAISE EXCEPTION 'view-shim apply-time gate: process_key_unified_backbone is OFF (updated_by=%). Applying now would null verification_requests.email while the legacy verify path is live, degrading its per-email rate limit. Flip the kill-switch ON and complete the 168h soak first. (Pristine db-reset seed is exempt.)', v_updated_by;
  END IF;
END $$;

-- ==========================================================================
-- STEP 0.7 — Retire the soak detector. By PR-D the 168h soak is complete, so
-- the verification_requests_post_phase19_audit trigger (migration 20260525113000)
-- has done its job. Drop it BEFORE the rename so it doesn't travel to
-- verification_requests_legacy and keep logging. Rollback does NOT recreate it
-- (the soak is over regardless of a Stage-D revert).
-- ==========================================================================
DROP TRIGGER IF EXISTS verification_requests_post_phase19_audit ON verification_requests;
DROP FUNCTION IF EXISTS public.verification_requests_legacy_write_audit();

-- ==========================================================================
-- STEP 1 — Rename the legacy table out of the way (data + FKs preserved).
-- DM-5 idempotency guard: skip the RENAME if verification_requests is already
-- a VIEW (re-apply path); abort if it is neither table nor view.
-- ==========================================================================
DO $$
DECLARE
  v_is_base_table BOOLEAN;
  v_is_view BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public' AND table_name='verification_requests' AND table_type='BASE TABLE'
  ) INTO v_is_base_table;
  SELECT EXISTS(
    SELECT 1 FROM information_schema.views
     WHERE table_schema='public' AND table_name='verification_requests'
  ) INTO v_is_view;

  IF v_is_base_table THEN
    EXECUTE 'ALTER TABLE verification_requests RENAME TO verification_requests_legacy';
  ELSIF v_is_view THEN
    RAISE NOTICE 'view-shim DM-5: verification_requests is already a VIEW; skipping rename (idempotent re-apply).';
  ELSE
    RAISE EXCEPTION 'view-shim DM-5: verification_requests does not exist as table or view; aborting';
  END IF;
END $$;

-- ==========================================================================
-- STEP 2 — DM-3: backfill intentionally OMITTED (privacy). Legacy rows stay
-- under their legacy identity in verification_requests_legacy, reachable via
-- the M-6 public-token policy + the /api/verify-strategy/[id]/status route's
-- admin-client lookup. (Re-anchoring under a synthetic strategy_id leaked the
-- unrelated owner's user_id under RLS — see REVIEWS.md 2026-05-08.)
-- ==========================================================================

-- ==========================================================================
-- STEP 3 — CREATE VIEW verification_requests over strategy_verifications.
-- SEC-1: security_invoker=true so RLS on strategy_verifications evaluates
-- against the calling role, not the view owner. Column shape matches what
-- src/app/api/verify-strategy/[id]/status/route.ts reads.
-- ==========================================================================
CREATE OR REPLACE VIEW verification_requests
  WITH (security_invoker = true) AS
SELECT
  sv.id                AS id,
  NULL::TEXT           AS email,
  sv.source            AS exchange,
  NULL::TEXT           AS api_key_encrypted,
  NULL::TEXT           AS api_secret_encrypted,
  NULL::TEXT           AS passphrase_encrypted,
  NULL::TEXT           AS dek_encrypted,
  sv.status            AS status,
  sv.public_token      AS public_token,
  sv.expires_at        AS expires_at,
  sv.metrics_snapshot  AS results,
  sv.created_at        AS created_at,
  sv.transitioned_at   AS completed_at
FROM strategy_verifications sv
WHERE sv.flow_type = 'teaser';

COMMENT ON VIEW verification_requests IS
  'Phase 19 / BACKBONE-04 step (d). Read-only VIEW over strategy_verifications WHERE flow_type=teaser. Writes rejected by INSTEAD OF triggers; new code writes strategy_verifications directly. SEC-1: security_invoker=true.';

REVOKE SELECT ON verification_requests FROM anon, authenticated;
GRANT SELECT ON verification_requests TO service_role;

-- ==========================================================================
-- STEP 4 — INSTEAD OF triggers (C-9: INSERT + UPDATE + DELETE all rejected).
-- ==========================================================================
CREATE OR REPLACE FUNCTION verification_requests_view_readonly_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'verification_requests is now a read-only VIEW (Phase 19 / BACKBONE-04 step d). Writes go to strategy_verifications via POST /process-key. See .planning/phase-19/migration-plan.md slot 107.'
    USING ERRCODE = '42501',
          HINT = 'Operation rejected on the verification_requests VIEW. The legacy BASE TABLE was renamed to verification_requests_legacy. GDPR erasure deletes from verification_requests_legacy (see sanitize_user STEP 5.5).';
END;
$$;

DROP TRIGGER IF EXISTS verification_requests_view_readonly_insert ON verification_requests;
CREATE TRIGGER verification_requests_view_readonly_insert
  INSTEAD OF INSERT ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();
DROP TRIGGER IF EXISTS verification_requests_view_readonly_update ON verification_requests;
CREATE TRIGGER verification_requests_view_readonly_update
  INSTEAD OF UPDATE ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();
DROP TRIGGER IF EXISTS verification_requests_view_readonly_delete ON verification_requests;
CREATE TRIGGER verification_requests_view_readonly_delete
  INSTEAD OF DELETE ON verification_requests
  FOR EACH ROW EXECUTE FUNCTION verification_requests_view_readonly_trigger();

-- ==========================================================================
-- STEP 5 — RLS on the renamed legacy table (admin SELECT + M-6 public_token
-- window) and defense-in-depth REVOKEs (SEC-2 anon, CT-2 authenticated).
-- ==========================================================================
ALTER TABLE verification_requests_legacy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verification_requests_legacy_admin_select ON verification_requests_legacy;
CREATE POLICY verification_requests_legacy_admin_select ON verification_requests_legacy
  FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']::text[]));

DROP POLICY IF EXISTS verification_requests_legacy_public_token_select ON verification_requests_legacy;
CREATE POLICY verification_requests_legacy_public_token_select ON verification_requests_legacy
  FOR SELECT
  USING (
    public_token IS NOT NULL
    AND expires_at > now()
    AND created_at > (now() - interval '90 days')
  );

COMMENT ON POLICY verification_requests_legacy_public_token_select ON verification_requests_legacy IS
  'M-6 — 90-day public-token reachability window. WARNING: this USING clause has NO token-equality predicate; it is safe ONLY because (a) SELECT is REVOKEd from anon + authenticated below, and (b) the /api/verify-strategy/[id]/status route reads via the admin client (RLS bypass) and matches the token in app code with a constant-time safeCompare. If a future migration re-GRANTs base SELECT to anon/authenticated, this policy alone would let that role enumerate every non-expired teaser row — re-add an explicit public_token match before any such GRANT.';

-- Defense-in-depth (rls-policy-auditor 2026-06-20): the original
-- verification_requests table predates the migration-020 REVOKE-then-GRANT-back
-- convention, and ALTER TABLE ... RENAME preserves the prior ACL — so any
-- residual PUBLIC grant would travel onto the legacy table and slip past the
-- role-specific REVOKEs below, re-coupling to the predicate-less M-6 policy.
-- REVOKE PUBLIC first so the M-6 SELECT policy can never be reached by an
-- inherited grant.
REVOKE ALL ON verification_requests_legacy FROM PUBLIC;
REVOKE SELECT ON verification_requests_legacy FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON verification_requests_legacy FROM authenticated;

DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.verification_requests_legacy', 'SELECT') THEN
    RAISE EXCEPTION 'view-shim CT-2: authenticated still has SELECT on verification_requests_legacy after REVOKE';
  END IF;
END $$;

-- ==========================================================================
-- STEP 5.5 — B3 (GDPR-critical): repoint sanitize_user's legacy DELETE from
-- `verification_requests` (now a write-rejecting VIEW) to the renamed base
-- table `verification_requests_legacy`. Done IN-PLACE via pg_get_functiondef
-- + targeted replace so the entire 100-line SECURITY DEFINER body, search_path,
-- and every other statement are preserved byte-for-byte; only the one table
-- reference changes. Idempotent (skips if already repointed) and drift-guarded
-- (aborts if the expected line is absent, rather than silently no-op'ing).
-- ==========================================================================
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'sanitize_user';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'view-shim B3: public.sanitize_user not found — cannot repoint GDPR delete';
  END IF;

  IF position('DELETE FROM verification_requests_legacy WHERE email' IN v_def) > 0 THEN
    RAISE NOTICE 'view-shim B3: sanitize_user already targets verification_requests_legacy; skipping.';
  ELSIF position('DELETE FROM verification_requests WHERE email' IN v_def) > 0 THEN
    v_def := replace(
      v_def,
      'DELETE FROM verification_requests WHERE email',
      'DELETE FROM verification_requests_legacy WHERE email'
    );
    EXECUTE v_def;
    RAISE NOTICE 'view-shim B3: sanitize_user repointed to verification_requests_legacy.';
  ELSE
    RAISE EXCEPTION 'view-shim B3 ABORT: sanitize_user contains neither the expected `DELETE FROM verification_requests WHERE email` line nor the repointed form — the function has drifted from the 2026-05-25 snapshot. Re-sync before applying.';
  END IF;
END $$;

-- ==========================================================================
-- STEP 6 — Self-verifying assertions (fail the migration if any invariant
-- is unmet).
-- ==========================================================================
DO $$
DECLARE
  v_view_exists BOOLEAN;
  v_legacy_exists BOOLEAN;
  v_trigger_count INT;
  v_legacy_policy_count INT;
  v_security_invoker_ok BOOLEAN;
  v_su_def TEXT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name='verification_requests') INTO v_view_exists;
  IF NOT v_view_exists THEN RAISE EXCEPTION 'view-shim: verification_requests VIEW missing'; END IF;

  SELECT EXISTS(
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
     WHERE n.nspname='public' AND c.relname='verification_requests'
       AND c.reloptions @> ARRAY['security_invoker=true']
  ) INTO v_security_invoker_ok;
  IF NOT v_security_invoker_ok THEN
    RAISE EXCEPTION 'view-shim SEC-1: verification_requests VIEW must have WITH (security_invoker = true)';
  END IF;

  SELECT EXISTS(SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='verification_requests_legacy' AND table_type='BASE TABLE')
    INTO v_legacy_exists;
  IF NOT v_legacy_exists THEN RAISE EXCEPTION 'view-shim: verification_requests_legacy table missing'; END IF;

  SELECT count(*) INTO v_trigger_count FROM pg_trigger
    WHERE tgname IN (
      'verification_requests_view_readonly_insert',
      'verification_requests_view_readonly_update',
      'verification_requests_view_readonly_delete');
  IF v_trigger_count <> 3 THEN RAISE EXCEPTION 'view-shim C-9: expected 3 INSTEAD OF triggers, got %', v_trigger_count; END IF;

  SELECT count(*) INTO v_legacy_policy_count FROM pg_policies
    WHERE tablename='verification_requests_legacy'
      AND policyname='verification_requests_legacy_public_token_select';
  IF v_legacy_policy_count <> 1 THEN RAISE EXCEPTION 'view-shim M-6: public_token-gated SELECT policy missing'; END IF;

  -- B3 — assert GDPR erasure now targets the renamed base table, not the VIEW.
  SELECT pg_get_functiondef(p.oid) INTO v_su_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='sanitize_user';
  IF position('DELETE FROM verification_requests_legacy WHERE email' IN v_su_def) = 0 THEN
    RAISE EXCEPTION 'view-shim B3: sanitize_user does not target verification_requests_legacy after repoint';
  END IF;

  RAISE NOTICE 'view-shim: all assertions passed (VIEW + 3 INSTEAD OF triggers + M-6 RLS + B3 sanitize_user repoint).';
END $$;

COMMIT;

-- phase-19-shim-step-d marker (plan-checker reads this string).
-- ============================================================================
-- END
-- ============================================================================
