-- Migration 084: first_api_key_added_at + first_sync_success_at marker primitives
-- Phase 11 / D-13 — single-fire onboarding funnel event source.
--
-- Why this trigger exists
-- -----------------------
-- The api_keys table has multiple INSERT paths across the codebase
-- (currently 4 production call sites verified 2026-04-26 in
-- RESEARCH §Validation Architecture lines 1012-1017):
--   1. POST /api/strategies/create-with-key — src/app/api/strategies/create-with-key/route.ts:180
--      (calls create_wizard_strategy RPC, which itself INSERTs into api_keys via migration 031)
--   2. POST /api/strategies/finalize-wizard — src/app/api/strategies/finalize-wizard/route.ts:170
--      (raw insert path)
--   3. src/components/exchanges/AllocatorExchangeManager.tsx:485
--      (allocator-side wizard, client-side .from('api_keys').insert)
--   4. src/components/strategy/ApiKeyManager.tsx:119
--      (client-side .from('api_keys').insert)
--   5. src/components/strategy/StrategyForm.tsx:105
--      (client-side .from('api_keys').insert)
-- This trigger fires AFTER INSERT FOR EACH ROW on api_keys, so all
-- paths above are covered uniformly — including any future 6th path
-- introduced in untracked or generated code. Per-route emission would
-- duplicate logic and risk drift.
--
-- Mirrors increment_user_session_count (migration 053):
--   - SECURITY DEFINER (writes to restricted auth.users.raw_user_meta_data)
--   - search_path = pg_catalog, public
--   - REVOKE from PUBLIC, no GRANT for the trigger fn (fires under postgres role)
--   - GRANT EXECUTE to service_role for stamp_first_sync_success (Python worker)
--
-- Defensive note for future Supabase upgrades:
--   If a future Supabase release changes auth.users.raw_user_meta_data
--   shape, the JSONB || merge will continue to work because freeform
--   keys are append-additive. The COALESCE(..., '{}'::JSONB) handles the
--   NULL-initial-state case (some auth users have raw_user_meta_data
--   NULL until first metadata write). No migration repair needed unless
--   Supabase removes the column entirely (breaking change unlikely).

BEGIN;

-- ----------------------------------------------------------------------
-- Trigger function: stamp_first_api_key_added
-- Fires AFTER INSERT FOR EACH ROW on api_keys. Idempotently sets
-- first_api_key_added_at on auth.users.raw_user_meta_data — only the
-- FIRST INSERT per user actually writes; subsequent rows no-op.
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_first_api_key_added()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_meta JSONB;
  v_existing TIMESTAMPTZ;
BEGIN
  -- Lock the auth.users row so concurrent INSERTs serialize.
  SELECT raw_user_meta_data
    INTO v_meta
    FROM auth.users
    WHERE id = NEW.user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    -- Defensive: api_keys.user_id has FK to profiles(id) which has FK
    -- to auth.users(id), so this should not happen under normal
    -- operation. Don't crash the INSERT — return.
    RETURN NEW;
  END IF;

  -- Defensive: handle the NULL-initial-state case. Some auth.users
  -- rows have raw_user_meta_data NULL until a first metadata write
  -- occurs. Without COALESCE, the `||` merge below would propagate NULL.
  v_meta := COALESCE(v_meta, '{}'::JSONB);
  v_existing := NULLIF(v_meta->>'first_api_key_added_at', '')::TIMESTAMPTZ;

  -- Idempotent: only stamp on the FIRST INSERT per user.
  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
                              || jsonb_build_object(
                                   'first_api_key_added_at',
                                   to_char(now() AT TIME ZONE 'UTC',
                                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                 )
   WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_first_api_key_added() FROM PUBLIC;

-- Idempotent re-run safety: drop the trigger before recreating.
DROP TRIGGER IF EXISTS api_keys_stamp_first_added ON api_keys;
CREATE TRIGGER api_keys_stamp_first_added
  AFTER INSERT ON api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_first_api_key_added();

-- ----------------------------------------------------------------------
-- RPC: stamp_first_sync_success(p_user_id UUID)
-- Symmetric primitive — Python analytics-service worker calls this via
-- service-role JWT after the first successful persist_allocator_holdings
-- for that allocator (Plan 03 wires the call site).
-- ----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_first_sync_success(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_meta JSONB;
  v_existing TIMESTAMPTZ;
BEGIN
  -- Lock the auth.users row so concurrent calls serialize.
  SELECT raw_user_meta_data
    INTO v_meta
    FROM auth.users
    WHERE id = p_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    -- Defensive: caller passed a user_id that doesn't exist. No-op
    -- rather than raising — the worker should not crash a sync run
    -- because of a stale user reference.
    RETURN;
  END IF;

  -- Defensive: handle the NULL-initial-state case (mirrors trigger fn).
  v_meta := COALESCE(v_meta, '{}'::JSONB);
  v_existing := NULLIF(v_meta->>'first_sync_success_at', '')::TIMESTAMPTZ;

  -- Idempotent: only stamp on the FIRST successful sync per user.
  IF v_existing IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
                              || jsonb_build_object(
                                   'first_sync_success_at',
                                   to_char(now() AT TIME ZONE 'UTC',
                                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                 )
   WHERE id = p_user_id;
END;
$$;

-- Lockdown: revoke from PUBLIC, grant only to service_role.
REVOKE ALL ON FUNCTION public.stamp_first_sync_success(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stamp_first_sync_success(UUID) TO service_role;

-- ----------------------------------------------------------------------
-- Self-verifying DO block — fails the migration at install time
-- if the function/trigger isn't installed correctly. This is the
-- last-mile guarantee that subsequent plans (11-03 reader, Python
-- worker call) can rely on the trigger + RPC being live in prod.
-- ----------------------------------------------------------------------
DO $$
DECLARE
  has_trigger_fn BOOLEAN;
  has_trigger BOOLEAN;
  has_sync_fn BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'stamp_first_api_key_added' AND p.prosecdef = TRUE
  ) INTO has_trigger_fn;
  IF NOT has_trigger_fn THEN
    RAISE EXCEPTION 'Migration 084 failed: stamp_first_api_key_added function missing or not SECURITY DEFINER';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'api_keys_stamp_first_added' AND tgrelid = 'public.api_keys'::regclass
  ) INTO has_trigger;
  IF NOT has_trigger THEN
    RAISE EXCEPTION 'Migration 084 failed: api_keys_stamp_first_added trigger missing';
  END IF;
  RAISE NOTICE 'Migration 084: stamp_first_api_key_added trigger installed and verified.';

  SELECT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'stamp_first_sync_success' AND p.prosecdef = TRUE
  ) INTO has_sync_fn;
  IF NOT has_sync_fn THEN
    RAISE EXCEPTION 'Migration 084 failed: stamp_first_sync_success function missing or not SECURITY DEFINER';
  END IF;
  RAISE NOTICE 'Migration 084: stamp_first_sync_success RPC installed and verified.';
END
$$;

COMMIT;
