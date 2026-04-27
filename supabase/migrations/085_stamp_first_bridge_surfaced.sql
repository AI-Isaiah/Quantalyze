-- Migration 085: stamp_first_bridge_surfaced — atomic single-fire RPC.
--
-- Retires Phase 11 review finding WR-02 (see
-- .planning/phases/11-onboarding-and-security-readiness/11-REVIEW.md:161-225
-- and 11-REVIEW-FIX.md WR-02 "DEFERRED-but-mitigated").
--
-- Background
-- ----------
-- The reader-side helper `maybeEmitFirstBridgeSurfaced` in
-- `src/lib/analytics/onboarding-funnel.ts` performs both the source-side
-- stamp AND the PostHog emission (unlike the four other markers, which
-- have a separate trigger / RPC / route writing the source stamp). The
-- previous implementation read `meta.first_bridge_surfaced_emitted_at`,
-- checked it absent, fired PostHog, then wrote BOTH `*_at` and
-- `*_emitted_at` via `admin.auth.admin.updateUserById`. Two concurrent
-- `/allocations` requests for the same user (e.g. browser prefetch +
-- user navigation) could both pass the read-side gate, both fire the
-- event, and both stamp the marker. The shipped mitigation (deterministic
-- `stamped_at` derived from `user.created_at`, so both racing calls
-- produced an identical property bag and PostHog content-hash dedupe
-- collapsed duplicates) was a workaround — PostHog content-hash dedupe
-- is approximate.
--
-- Proper fix
-- ----------
-- Mirror migration 084's `stamp_first_sync_success`:
--   - SECURITY DEFINER (writes to restricted auth.users.raw_user_meta_data).
--   - search_path = pg_catalog, public.
--   - REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO service_role (the admin
--     client uses a service-role JWT).
--   - SELECT ... FOR UPDATE locks the auth.users row so concurrent
--     callers serialize at the Postgres level.
--   - Idempotent: only stamps on the FIRST call per user. Returns
--     `{stamped: true|false, stamped_at: <iso8601>}` so the TS caller
--     knows whether to emit PostHog and what value to use as the
--     `stamped_at` property (deterministic across racing callers).
--
-- The TS helper now calls this RPC first; only the call that actually
-- wrote the marker (`stamped: true`) emits PostHog. The other call
-- observes `stamped: false` and no-ops. PostHog single-fire is now
-- guaranteed at the Postgres level rather than via approximate dedupe.

BEGIN;

-- ----------------------------------------------------------------------
-- RPC: stamp_first_bridge_surfaced(p_user_id UUID)
-- Returns JSONB: {"stamped": true|false, "stamped_at": "<iso8601>"}.
--
-- Semantics:
--   - First call per user: writes `first_bridge_surfaced_at = now()`,
--     returns `{stamped: true, stamped_at: <just-written>}`.
--   - Subsequent calls: no-op, return `{stamped: false, stamped_at:
--     <existing>}`.
--   - Defensive: if the user_id doesn't exist (FK violation upstream),
--     return `{stamped: false, stamped_at: null}` rather than raising —
--     analytics MUST NOT crash a host request.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_first_bridge_surfaced(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_meta JSONB;
  v_existing TIMESTAMPTZ;
  v_existing_text TEXT;
  v_new_stamp TEXT;
BEGIN
  -- Lock the auth.users row so concurrent callers serialize. This is
  -- the atomic primitive that retires the WR-02 race.
  SELECT raw_user_meta_data
    INTO v_meta
    FROM auth.users
    WHERE id = p_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    -- Defensive: caller passed a user_id that doesn't exist. No-op
    -- rather than raising — analytics must not crash the host request.
    RETURN jsonb_build_object('stamped', false, 'stamped_at', NULL);
  END IF;

  -- Defensive: handle the NULL-initial-state case (mirrors migration 084).
  v_meta := COALESCE(v_meta, '{}'::JSONB);
  v_existing_text := NULLIF(v_meta->>'first_bridge_surfaced_at', '');
  v_existing := v_existing_text::TIMESTAMPTZ;

  -- Idempotent: only stamp on the FIRST call per user. Subsequent calls
  -- return the existing stamp with stamped=false so the TS caller can
  -- pass the persisted value as the PostHog property if some downstream
  -- path ever needs it.
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'stamped', false,
      'stamped_at', v_existing_text
    );
  END IF;

  -- First call per user — compute the stamp once, persist it, and return
  -- it as the canonical value. Format mirrors migration 084's `to_char`
  -- shape so the test pin (ISO_MS_RE) matches.
  v_new_stamp := to_char(now() AT TIME ZONE 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
                              || jsonb_build_object(
                                   'first_bridge_surfaced_at', v_new_stamp
                                 )
   WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'stamped', true,
    'stamped_at', v_new_stamp
  );
END;
$$;

-- Lockdown: revoke from PUBLIC, grant only to service_role (admin client).
REVOKE ALL ON FUNCTION public.stamp_first_bridge_surfaced(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stamp_first_bridge_surfaced(UUID) TO service_role;

-- ----------------------------------------------------------------------
-- Self-verifying DO block — fails the migration at install time if the
-- function isn't installed correctly. Mirrors migration 084's verify
-- pattern. This is the last-mile guarantee that the TS helper's RPC
-- call site can rely on the function being live in prod.
-- ----------------------------------------------------------------------
DO $$
DECLARE
  has_fn BOOLEAN;
  has_grant BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'stamp_first_bridge_surfaced'
      AND p.prosecdef = TRUE
  ) INTO has_fn;
  IF NOT has_fn THEN
    RAISE EXCEPTION 'Migration 085 failed: stamp_first_bridge_surfaced function missing or not SECURITY DEFINER';
  END IF;

  -- Verify service_role has EXECUTE — the TS helper uses an admin client
  -- backed by a service-role JWT, so missing this grant would surface as
  -- a 42501 permission-denied error at every call site.
  SELECT has_function_privilege('service_role',
                                'public.stamp_first_bridge_surfaced(UUID)',
                                'EXECUTE')
    INTO has_grant;
  IF NOT has_grant THEN
    RAISE EXCEPTION 'Migration 085 failed: service_role missing EXECUTE on stamp_first_bridge_surfaced(UUID)';
  END IF;

  RAISE NOTICE 'Migration 085: stamp_first_bridge_surfaced RPC installed and verified.';
END
$$;

COMMIT;
