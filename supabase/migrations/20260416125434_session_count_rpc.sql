-- Migration 053: increment_user_session_count RPC
-- Sprint 5 Task 5.5 — atomic session_count bump.
--
-- Why this RPC exists
-- -------------------
-- /api/usage/session-start does a read-modify-write on
-- auth.users.raw_user_meta_data.session_count. Two concurrent calls
-- for the same user_id (e.g. two browser tabs reloading after a brief
-- offline period) both read the same value, both increment, both write
-- back the same N+1 — losing one session.
--
-- This function does the SELECT...FOR UPDATE + UPDATE inside a single
-- transaction so concurrent callers serialize on the row lock. It also
-- bakes in the 30-minute debounce window so the route doesn't have to
-- maintain that as two separate trips. Returns the resulting count and
-- a boolean indicating whether the increment was actually applied (so
-- the route still knows whether to fire the PostHog event).
--
-- Permissions: SECURITY DEFINER + locked-down search_path. Granted to
-- service_role only; the user-scoped client must NOT have direct EXECUTE
-- (no public/anon/authenticated grant). The Next route calls this via
-- createAdminClient (service-role).

BEGIN;

CREATE OR REPLACE FUNCTION public.increment_user_session_count(
  p_user_id UUID,
  p_debounce_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE (session_count INTEGER, debounced BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_meta JSONB;
  v_current_count INTEGER;
  v_last_start TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_next_count INTEGER;
BEGIN
  -- Lock the auth.users row so concurrent callers serialize. The lock
  -- is released at COMMIT (statement-end for this function).
  SELECT raw_user_meta_data
    INTO v_meta
    FROM auth.users
    WHERE id = p_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
  END IF;

  v_meta := COALESCE(v_meta, '{}'::JSONB);

  v_current_count := COALESCE((v_meta->>'session_count')::INTEGER, 0);
  v_last_start := NULLIF(v_meta->>'last_session_start_at', '')::TIMESTAMPTZ;

  -- Debounce: within p_debounce_seconds of the previous start, return
  -- the existing count and don't bump.
  IF v_last_start IS NOT NULL
     AND v_now - v_last_start < make_interval(secs => p_debounce_seconds) THEN
    session_count := v_current_count;
    debounced := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  v_next_count := v_current_count + 1;

  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
                              || jsonb_build_object(
                                   'session_count', v_next_count,
                                   'last_session_start_at',
                                     to_char(v_now AT TIME ZONE 'UTC',
                                             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                 )
   WHERE id = p_user_id;

  session_count := v_next_count;
  debounced := FALSE;
  RETURN NEXT;
END;
$$;

-- Lock down: revoke from PUBLIC, grant only to service_role.
REVOKE ALL ON FUNCTION public.increment_user_session_count(UUID, INTEGER)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_user_session_count(UUID, INTEGER)
  TO service_role;

COMMIT;
