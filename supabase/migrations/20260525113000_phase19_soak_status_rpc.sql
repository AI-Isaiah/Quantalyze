-- ============================================================================
-- Phase 19 soak detector — audit trigger + read-only production probe RPC
-- ============================================================================
-- Two pieces that together let the hourly stability workflow
-- (.github/workflows/phase-19-stability.yml) measure PRODUCTION robustly,
-- without holding a service_role key:
--
--   1. TRIGGER `verification_requests_post_phase19_audit` — fires AFTER every
--      INSERT/UPDATE/DELETE on the legacy `verification_requests` table and
--      logs one row to `audit_log` with entity_type='verification_requests_legacy_write'.
--      Counting actual writes (not timestamp columns) is the only way to catch
--      UPDATEs (e.g. the legacy public_token UPDATE in verify-strategy/route.ts,
--      which touches neither created_at nor completed_at) and DELETEs (GDPR
--      sanitize_user). A timestamp-column proxy is blind to both. (Red-team
--      2026-05-25 caught the proxy's blind spot.)
--
--   2. FUNCTION `phase19_soak_status(p_since)` — SECURITY DEFINER probe that
--      returns ONLY non-sensitive scalars:
--        • flag_value         — kill-switch value ('on' | 'off' | 'unset')
--        • vr_is_view         — whether the view-shim (PR-D) has been applied
--        • legacy_write_count — count of the audit-log rows above since p_since
--      No row data, no PII, so it is safe to GRANT to anon. The workflow then
--      needs only the prod ANON key (publishable; RLS-blocked from everything
--      else), not a god-mode service_role key in an hourly cron.
--
-- Additive + safe to apply immediately. Independent of the destructive
-- view-shim ("PR-D"), which is parked in .planning/phase-19/pr-d-ready/ and
-- ships only after the 168h soak. (That parked migration DROPs this trigger.)
-- ============================================================================

BEGIN;

-- ==========================================================================
-- 1. Audit trigger — log every direct write to verification_requests.
-- ==========================================================================
-- SECURITY DEFINER + pinned search_path so the insert runs as the owner and
-- bypasses audit_log RLS regardless of the writing role. Direct INSERT (NOT
-- log_audit_event_service, which RAISEs on a NULL user_id) — audit_log.user_id
-- is nullable; this is an unauthenticated/system write with no user. The insert
-- supplies all NOT-NULL columns (action, entity_type, entity_id) so it can
-- never fail and roll back the underlying write.
CREATE OR REPLACE FUNCTION public.verification_requests_legacy_write_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
  VALUES (
    NULL,
    lower(TG_OP),                              -- 'insert' | 'update' | 'delete'
    'verification_requests_legacy_write',
    COALESCE(NEW.id, OLD.id),                  -- verification_requests.id (PK, NOT NULL)
    jsonb_build_object('tg_op', TG_OP, 'writer', session_user)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.verification_requests_legacy_write_audit() IS
  'Phase 19 soak detector trigger fn. Logs every direct write to verification_requests into audit_log (entity_type=verification_requests_legacy_write) so phase19_soak_status can count post-flip writes. SECURITY DEFINER; direct INSERT (audit_log.user_id is nullable, no log_audit_event_service which requires user_id).';

DROP TRIGGER IF EXISTS verification_requests_post_phase19_audit ON public.verification_requests;
CREATE TRIGGER verification_requests_post_phase19_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.verification_requests_legacy_write_audit();

-- ==========================================================================
-- 2. Read-only probe RPC.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.phase19_soak_status(p_since timestamptz DEFAULT now())
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_flag          TEXT;
  v_is_view       BOOLEAN;
  v_legacy_writes BIGINT := 0;
BEGIN
  SELECT value INTO v_flag
    FROM feature_flags
   WHERE flag_key = 'process_key_unified_backbone';

  SELECT EXISTS(
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'public' AND table_name = 'verification_requests'
  ) INTO v_is_view;

  -- Robust write detection: count the audit-log rows the trigger above emits
  -- on EVERY write (INSERT/UPDATE/DELETE). Works whether verification_requests
  -- is still a BASE TABLE (pre view-shim) or has been renamed to
  -- verification_requests_legacy (the trigger travels with the table on rename).
  SELECT count(*) INTO v_legacy_writes
    FROM audit_log
   WHERE entity_type = 'verification_requests_legacy_write'
     AND created_at > p_since;

  RETURN jsonb_build_object(
    'flag_value',         COALESCE(v_flag, 'unset'),
    'vr_is_view',         v_is_view,
    'legacy_write_count', v_legacy_writes,
    'since',              p_since,
    'checked_at',         now()
  );
END;
$$;

COMMENT ON FUNCTION public.phase19_soak_status(timestamptz) IS
  'Phase 19 soak probe. SECURITY DEFINER; returns ONLY scalars (kill-switch flag value, whether verification_requests is a VIEW, and the count of verification_requests_legacy_write audit rows since p_since). No row data / PII. GRANTed to anon so the hourly stability workflow can measure prod without a service_role key.';

-- Least privilege: revoke the implicit PUBLIC execute, grant only to the roles
-- that call it. anon is the one the CI workflow uses.
REVOKE ALL ON FUNCTION public.phase19_soak_status(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.phase19_soak_status(timestamptz) TO anon, authenticated, service_role;

-- ==========================================================================
-- 3. Self-verify (fail the migration if any invariant is unmet).
-- ==========================================================================
DO $$
BEGIN
  IF NOT has_function_privilege('anon', 'public.phase19_soak_status(timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'phase19_soak_status: anon lacks EXECUTE after GRANT';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'verification_requests'
       AND t.tgname = 'verification_requests_post_phase19_audit'
       AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'phase19 soak detector: trigger verification_requests_post_phase19_audit missing on verification_requests';
  END IF;
  RAISE NOTICE 'phase19 soak detector: trigger + RPC created, anon EXECUTE granted.';
END $$;

COMMIT;
