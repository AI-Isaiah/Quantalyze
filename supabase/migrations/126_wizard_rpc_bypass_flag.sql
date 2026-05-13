-- Migration 126: fix the production-breaking interaction between
-- migration 125 (P475 trigger hardening) and migration 031's
-- finalize_wizard_strategy SECURITY DEFINER RPC.
--
-- Audit-2026-05-07 follow-up: ISSUE 1 (95/100 confidence)
--
-- Why this migration exists
-- -------------------------
-- Migration 125 added an `auth.uid() IS NOT NULL` check to the
-- guard_wizard_draft_updates() trigger. The intent was defense-in-depth
-- against future roles that aren't `authenticated` but still carry an
-- end-user JWT. The migration's own commentary (lines 49-89) acknowledges
-- the subtle issue but mis-reasoned the resolution: `auth.uid()` returns
-- the JWT user's UUID even inside SECURITY DEFINER contexts because the
-- JWT is bound to the CONNECTION, not to the executing role. Postgres
-- SECURITY DEFINER changes `current_user` but NOT the GUC settings that
-- `auth.uid()` reads.
--
-- Concrete impact: when `finalize_wizard_strategy` (SECURITY DEFINER,
-- migration 031) executes `UPDATE strategies SET status='pending_review'`,
-- the BEFORE UPDATE trigger fires, evaluates `auth.uid()` (non-null —
-- the JWT is on the wire), and the OR clause
-- `auth.uid() IS NOT NULL OR current_user = 'authenticated'` short-
-- circuits TRUE. The trigger raises 'insufficient_privilege' and EVERY
-- wizard submit fails in production.
--
-- Fix shape
-- ---------
-- SET LOCAL bypass pattern. The trigger gates on a per-transaction GUC
-- ('quantalyze.wizard_rpc_active') that ONLY the two SECURITY DEFINER
-- RPCs set. Direct UPDATEs from the authenticated role cannot set the
-- GUC because (a) they don't pass through PERFORM set_config(...,true)
-- and (b) even if they did, the local-scope flag is wiped at transaction
-- end so cross-transaction smuggling is impossible.
--
-- The trigger condition becomes:
--   IF current_user = 'authenticated'
--      AND coalesce(current_setting('quantalyze.wizard_rpc_active', true), 'off') <> 'on'
--   THEN raise
--
-- Direct authenticated-role UPDATEs: blocked (no GUC).
-- SECURITY DEFINER RPC path: GUC set to 'on' for the txn, trigger sees
--   the bypass marker and returns NEW. This is the only legitimate way
--   to flip the GUC because EXECUTE on the RPCs is granted only to
--   `authenticated` and the RPCs call PERFORM set_config(...) inside
--   their body, which is invisible to direct REST/SQL writers.
-- pg_cron / service-role: current_user is not 'authenticated', so the
--   first condition fails — pass-through preserved (same as 125).
--
-- This migration:
--   1. Replaces the trigger function with the new GUC-based condition.
--   2. Replaces create_wizard_strategy and finalize_wizard_strategy
--      with versions that PERFORM set_config('quantalyze.wizard_rpc_active',
--      'on', true) at the top of their body. Migration 031's bodies are
--      preserved unchanged below the set_config call.
--   3. Self-verifying DO block: asserts the function bodies contain
--      the set_config marker and the trigger contains the GUC check.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: replace guard_wizard_draft_updates with the GUC-gated check.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_wizard_draft_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
-- SECURITY INVOKER (default). current_user at trigger time reflects the
-- role that initiated the UPDATE. Direct authenticated clients keep
-- current_user='authenticated'; SECURITY DEFINER RPCs keep their owner.
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_bypass TEXT;
BEGIN
  -- Only guard wizard drafts.
  IF OLD.source <> 'wizard' OR OLD.status <> 'draft' THEN
    RETURN NEW;
  END IF;

  -- Allow no-op writes that keep the row as a wizard draft (autosave).
  IF NEW.source = 'wizard' AND NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- Issue 1 fix (audit-2026-05-07 follow-up):
  -- Replace migration 125's broken `auth.uid() IS NOT NULL` clause with
  -- a per-transaction GUC. The two wizard SECURITY DEFINER RPCs set
  -- 'quantalyze.wizard_rpc_active' to 'on' at the top of their body
  -- (transaction-local, second arg to set_config = true). Any other
  -- caller — including a direct authenticated-role UPDATE that tries
  -- to mimic the RPC path — cannot smuggle the flag in because
  -- (a) the GUC's lifetime is the current transaction, and
  -- (b) only the two RPC bodies invoke set_config under the wizard key.
  v_bypass := coalesce(current_setting('quantalyze.wizard_rpc_active', true), 'off');

  IF current_user = 'authenticated' AND v_bypass <> 'on' THEN
    RAISE EXCEPTION
      'Direct update on wizard draft % blocked. Use finalize_wizard_strategy or delete the draft.',
      OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION guard_wizard_draft_updates() IS
  'Blocks direct client updates that would flip a wizard draft out of (source=wizard, status=draft). Gated on current_user=authenticated AND the per-txn GUC quantalyze.wizard_rpc_active not being on. The two SECURITY DEFINER wizard RPCs set the GUC; nothing else does. See migrations 031, 125, 126.';

REVOKE ALL ON FUNCTION guard_wizard_draft_updates() FROM PUBLIC, anon, authenticated;

-- Trigger binding is preserved by CREATE OR REPLACE on the function.
-- Re-attach defensively (no-op if already present).
DROP TRIGGER IF EXISTS guard_wizard_draft_updates_trigger ON strategies;

CREATE TRIGGER guard_wizard_draft_updates_trigger
  BEFORE UPDATE ON strategies
  FOR EACH ROW
  EXECUTE FUNCTION guard_wizard_draft_updates();

COMMENT ON TRIGGER guard_wizard_draft_updates_trigger ON strategies IS
  'Blocks direct client updates that would flip a wizard draft out of (source=wizard, status=draft). Gated on the per-txn quantalyze.wizard_rpc_active GUC set by the two wizard SECURITY DEFINER RPCs. See migrations 031, 125, 126.';

-- --------------------------------------------------------------------------
-- STEP 2: replace create_wizard_strategy — body identical to migration
-- 031 except for the new PERFORM set_config at the top.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_wizard_strategy(
  p_user_id UUID,
  p_exchange TEXT,
  p_label TEXT,
  p_api_key_encrypted TEXT,
  p_api_secret_encrypted TEXT,
  p_passphrase_encrypted TEXT,
  p_dek_encrypted TEXT,
  p_nonce TEXT,
  p_kek_version INTEGER,
  p_placeholder_name TEXT,
  p_wizard_session_id UUID
)
RETURNS TABLE(strategy_id UUID, api_key_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_key_id UUID;
  v_strategy_id UUID;
BEGIN
  -- Issue 1 fix: mark this transaction as "wizard RPC active" so the
  -- guard_wizard_draft_updates trigger lets writes through. Local-scope
  -- (third arg true) means the flag is wiped at COMMIT/ROLLBACK; no
  -- cross-transaction leak. create_wizard_strategy doesn't actually
  -- touch an existing wizard draft (it INSERTs a new one), so the flag
  -- is only relevant on the trigger's defensive path. Set it
  -- unconditionally so the RPC body is symmetric with finalize.
  PERFORM set_config('quantalyze.wizard_rpc_active', 'on', true);

  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'create_wizard_strategy called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'create_wizard_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO api_keys (
    user_id, exchange, label,
    api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
    dek_encrypted, nonce, kek_version, is_active
  )
  VALUES (
    p_user_id, p_exchange, p_label,
    p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,
    p_dek_encrypted, p_nonce, COALESCE(p_kek_version, 1), TRUE
  )
  RETURNING id INTO v_key_id;

  INSERT INTO strategies (
    user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges
  )
  VALUES (
    p_user_id, v_key_id, p_placeholder_name, 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY[p_exchange]
  )
  RETURNING id INTO v_strategy_id;

  RETURN QUERY SELECT v_strategy_id, v_key_id;
END;
$$;

COMMENT ON FUNCTION create_wizard_strategy IS
  'Atomic api_keys + strategies (source=wizard, status=draft) insert for Task 1.2. Sets the quantalyze.wizard_rpc_active GUC for trigger bypass (migration 126). See migrations 031, 126.';

REVOKE ALL ON FUNCTION create_wizard_strategy FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_wizard_strategy TO authenticated;

-- --------------------------------------------------------------------------
-- STEP 3: replace finalize_wizard_strategy — body identical to migration
-- 031 except for the new PERFORM set_config at the top.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finalize_wizard_strategy(
  p_strategy_id UUID,
  p_user_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_category_id UUID,
  p_strategy_types TEXT[],
  p_subtypes TEXT[],
  p_markets TEXT[],
  p_supported_exchanges TEXT[],
  p_leverage_range TEXT,
  p_aum NUMERIC,
  p_max_capacity NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_current_status TEXT;
  v_current_source TEXT;
  v_current_owner UUID;
BEGIN
  -- Issue 1 fix: mark this transaction as "wizard RPC active" BEFORE
  -- the UPDATE below fires the trigger. Local-scope = wiped at txn end.
  -- This is the only legitimate caller path that flips a wizard draft
  -- to pending_review; any UPDATE that reaches the trigger without this
  -- flag set is, by construction, a direct-client write attempt and
  -- gets blocked.
  PERFORM set_config('quantalyze.wizard_rpc_active', 'on', true);

  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_wizard_strategy called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT status, source, user_id
    INTO v_current_status, v_current_source, v_current_owner
    FROM strategies
    WHERE id = p_strategy_id
    FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % not found', p_strategy_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_current_owner <> p_user_id THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % is not owned by user %',
      p_strategy_id, p_user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_current_source <> 'wizard' THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % has source=% (expected wizard)',
      p_strategy_id, v_current_source
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_current_status <> 'draft' THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % has status=% (expected draft)',
      p_strategy_id, v_current_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE strategies
    SET
      name = p_name,
      description = p_description,
      category_id = p_category_id,
      strategy_types = COALESCE(p_strategy_types, '{}'),
      subtypes = COALESCE(p_subtypes, '{}'),
      markets = COALESCE(p_markets, '{}'),
      supported_exchanges = COALESCE(p_supported_exchanges, '{}'),
      leverage_range = p_leverage_range,
      aum = p_aum,
      max_capacity = p_max_capacity,
      status = 'pending_review'
    WHERE id = p_strategy_id;

  RETURN p_strategy_id;
END;
$$;

COMMENT ON FUNCTION finalize_wizard_strategy IS
  'Promotes a wizard draft (source=wizard, status=draft) to status=pending_review after asserting ownership. Sets the quantalyze.wizard_rpc_active GUC for trigger bypass (migration 126). See migrations 031, 126.';

REVOKE ALL ON FUNCTION finalize_wizard_strategy FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finalize_wizard_strategy TO authenticated;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  guard_body TEXT;
  create_body TEXT;
  finalize_body TEXT;
  trigger_exists BOOLEAN;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO guard_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'guard_wizard_draft_updates';

  IF guard_body IS NULL THEN
    RAISE EXCEPTION 'Migration 126 failed: guard_wizard_draft_updates function missing';
  END IF;

  IF guard_body NOT LIKE '%quantalyze.wizard_rpc_active%' THEN
    RAISE EXCEPTION 'Migration 126 failed: guard_wizard_draft_updates body missing GUC bypass check';
  END IF;

  IF guard_body NOT LIKE '%current_user%' THEN
    RAISE EXCEPTION 'Migration 126 failed: guard_wizard_draft_updates body lost current_user check';
  END IF;

  SELECT pg_get_functiondef(p.oid)
    INTO create_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'create_wizard_strategy';

  IF create_body IS NULL THEN
    RAISE EXCEPTION 'Migration 126 failed: create_wizard_strategy function missing';
  END IF;

  IF create_body NOT LIKE '%quantalyze.wizard_rpc_active%' THEN
    RAISE EXCEPTION 'Migration 126 failed: create_wizard_strategy body missing set_config bypass marker';
  END IF;

  SELECT pg_get_functiondef(p.oid)
    INTO finalize_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'finalize_wizard_strategy';

  IF finalize_body IS NULL THEN
    RAISE EXCEPTION 'Migration 126 failed: finalize_wizard_strategy function missing';
  END IF;

  IF finalize_body NOT LIKE '%quantalyze.wizard_rpc_active%' THEN
    RAISE EXCEPTION 'Migration 126 failed: finalize_wizard_strategy body missing set_config bypass marker';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'strategies'
      AND t.tgname = 'guard_wizard_draft_updates_trigger'
      AND NOT t.tgisinternal
  ) INTO trigger_exists;

  IF NOT trigger_exists THEN
    RAISE EXCEPTION 'Migration 126 failed: guard_wizard_draft_updates_trigger not attached to strategies';
  END IF;

  RAISE NOTICE 'Migration 126: wizard RPC bypass GUC + trigger gate installed. finalize_wizard_strategy production path restored.';
END
$$;

COMMIT;
