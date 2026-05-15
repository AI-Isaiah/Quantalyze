-- Migration 127: replace the GUC-based trigger bypass with a current_user
-- check (audit-2026-05-07 red-team Findings 1 + 3 + 4 + 8).
--
-- Why this migration exists
-- -------------------------
-- Migrations 120 (P911 sentinel-rejection triggers) and 126 (Issue 1 wizard
-- RPC bypass GUC) both shipped a "the RPC sets a custom-namespaced GUC,
-- the trigger checks it" bypass design. The red-team review identified
-- this as a privilege-escalation vector:
--
--   PostgreSQL allows ANY role — including `authenticated` — to call
--   `SELECT set_config('quantalyze.<name>', 'on', true)` for any
--   custom-namespaced GUC (any key containing a dot). The
--   set_config(name, value, is_local := true) form is permissive on
--   custom namespaces; the documented `superuser`-only ACL applies only
--   to `pg_*` and other reserved namespaces. The premise that "only the
--   RPC bodies set this GUC" was false.
--
-- Concrete impact (pre-fix):
--   1. (Finding 1) Wizard draft trigger bypass:
--        Authenticated user runs
--          SELECT set_config('quantalyze.wizard_rpc_active', 'on', true);
--          UPDATE strategies SET status = 'pending_review' WHERE id = <draft>;
--        The guard_wizard_draft_updates trigger sees the GUC = 'on' and
--        lets the write through. The draft skips review entirely.
--
--   2. (Finding 3) Sanitize sentinel trigger bypass:
--        Authenticated user runs
--          SELECT set_config('quantalyze.sanitize_in_progress', 'on', true);
--          UPDATE profiles SET display_name = '[deleted]' WHERE id = auth.uid();
--        The reject_sentinel_writes trigger sees the GUC = 'on' and lets
--        the write through. The user has now poisoned the sentinel.
--        Subsequent sanitize_user calls observe v_already_sanitized = TRUE
--        on the very first SELECT (line 251 of mig 120) and short-circuit,
--        leaving:
--          - api_keys uncleaned (decryption keys still on disk)
--          - trades.raw_data uncleaned (per-fill PII still present)
--          - auth.refresh_tokens uncleaned (live sessions still mint JWTs)
--          - auth.sessions uncleaned (refresh path still works)
--        i.e. silent partial-completion of a GDPR Art. 17 request — the
--        deletion_request status flips to "completed" while half the PII
--        remains. This is the highest-severity finding.
--
-- Fix shape
-- ---------
-- Replace the GUC check with a `current_user` check. Inside a
-- SECURITY DEFINER function `current_user` returns the effective role —
-- which is the function OWNER (typically `postgres` or a service-role-
-- owned role), NOT the role on the connection. A direct UPDATE issued
-- by a real authenticated user has `current_user = 'authenticated'`,
-- so the trigger can distinguish "this write is from a SECURITY DEFINER
-- RPC body" from "this write is a direct end-user write" without any
-- GUC the attacker can flip.
--
-- This is the standard Postgres idiom for this exact problem; it is
-- unforgeable because `current_user` shifts atomically with the
-- function-call boundary and cannot be set by `SET ROLE` from an
-- authenticated session (authenticated has no SET ROLE privilege).
--
-- What this migration ships
-- -------------------------
-- 1. Replace `guard_wizard_draft_updates` so the predicate is just
--    `current_user = 'authenticated'`. Drops the GUC bypass clause AND
--    the auth.uid() OR-clause (mig 125 lineage); both are obsoleted by
--    the simpler, unforgeable current_user gate.
-- 2. Replace `reject_sentinel_writes` so:
--      a. The bypass check is `current_user NOT IN ('authenticated','anon')`.
--         Service role + the SECURITY DEFINER function owner BOTH pass.
--      b. Sentinel comparison (Finding 4) is null/whitespace/casing safe:
--         `lower(trim(coalesce(NEW.<col>, ''))) LIKE '[deleted%'`.
--         This catches all of:
--           '[deleted]', '[deleted] ', '[Deleted]', '[deleted strategy]',
--           '[DELETED PORTFOLIO]', etc.
--         A null is coalesced to '' which does not match the prefix —
--         expected (null is not the sentinel).
--      c. (Finding 8) The auth.role() try/except is replaced with the
--         current_user check, which cannot throw. The vestigial
--         `EXCEPTION WHEN OTHERS` block is removed.
-- 3. Replace `create_wizard_strategy` + `finalize_wizard_strategy` +
--    `sanitize_user` to remove the now-useless `PERFORM set_config(...)`
--    calls. The SECURITY DEFINER context itself is the signal; no
--    in-band GUC is needed.
-- 4. Self-verifying DO block: assert the trigger function bodies no
--    longer reference `quantalyze.wizard_rpc_active` or
--    `quantalyze.sanitize_in_progress`; assert they DO reference
--    `current_user`.
--
-- Why a startswith LIKE for the sentinel comparison (Finding 4)
-- ------------------------------------------------------------
-- The pre-fix `NEW.<col> = '<sentinel>'` was evadable in three ways:
--   - Trailing whitespace: `'[deleted] '` is not equal to `'[deleted]'`
--   - Casing: `'[Deleted]'` is not equal to `'[deleted]'`
--   - Extended variant: `'[deleted strategy]'` passes the profiles
--     check (different sentinel) but the strategies-specific check
--     was a strict equality so a trailing-space `'[deleted strategy] '`
--     evaded.
--
-- `lower(trim(coalesce(NEW.<col>, ''))) LIKE '[deleted%'` collapses all
-- three vectors into one comparison:
--   - trim() neutralizes leading/trailing whitespace
--   - lower() neutralizes casing
--   - coalesce(..., '') is null-safe (null is not the sentinel)
--   - LIKE '[deleted%' catches the prefix variants (the trailing label
--     is what the migration uses to distinguish profiles/strategies/
--     portfolios sentinels)
--
-- `IS NOT DISTINCT FROM` would be cleaner for null safety alone but
-- does not handle whitespace/casing. We could combine both
-- (`IS NOT DISTINCT FROM` + lower(trim(...))) but the startswith LIKE
-- already encompasses the null case via coalesce, so the single
-- predicate is simpler.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: replace guard_wizard_draft_updates with the current_user check.
-- --------------------------------------------------------------------------
-- Inside finalize_wizard_strategy (SECURITY DEFINER), the trigger sees
-- `current_user = <function owner>` (typically postgres / supabase_admin).
-- Direct authenticated-role UPDATEs have `current_user = 'authenticated'`.
-- The check is unforgeable from an authenticated session.
CREATE OR REPLACE FUNCTION guard_wizard_draft_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
-- SECURITY INVOKER (default). current_user at trigger time reflects the
-- effective role of the statement that fired it.
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Only guard wizard drafts.
  IF OLD.source <> 'wizard' OR OLD.status <> 'draft' THEN
    RETURN NEW;
  END IF;

  -- Allow no-op writes that keep the row as a wizard draft (autosave).
  IF NEW.source = 'wizard' AND NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- Finding 1 fix (audit-2026-05-07 red-team):
  -- Block any write whose current_user is 'authenticated'. The wizard
  -- SECURITY DEFINER RPCs run as the function owner, so current_user
  -- inside their bodies is NOT 'authenticated' — they pass through.
  -- An authenticated client trying to bypass via set_config(...) is
  -- still 'authenticated' at trigger time; the GUC they flipped is
  -- ignored because the trigger no longer reads it.
  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION
      'Direct update on wizard draft % blocked. Use finalize_wizard_strategy or delete the draft.',
      OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION guard_wizard_draft_updates() IS
  'Blocks direct authenticated-role updates that would flip a wizard draft out of (source=wizard, status=draft). Gated on current_user=authenticated; SECURITY DEFINER RPCs execute under the function owner and pass. See migrations 031, 125, 126, 127 (red-team Finding 1).';

REVOKE ALL ON FUNCTION guard_wizard_draft_updates() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_wizard_draft_updates_trigger ON strategies;
CREATE TRIGGER guard_wizard_draft_updates_trigger
  BEFORE UPDATE ON strategies
  FOR EACH ROW
  EXECUTE FUNCTION guard_wizard_draft_updates();

COMMENT ON TRIGGER guard_wizard_draft_updates_trigger ON strategies IS
  'Blocks direct authenticated-role updates that would flip a wizard draft out of (source=wizard, status=draft). Gated on current_user=authenticated. See migrations 031, 125, 126, 127.';

-- --------------------------------------------------------------------------
-- STEP 2: replace reject_sentinel_writes with current_user gate +
-- null/whitespace/casing-safe sentinel comparison.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_sentinel_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- Finding 3 fix (audit-2026-05-07 red-team):
  -- Allow any role that is NOT a direct end-user role. Inside
  -- sanitize_user (SECURITY DEFINER) current_user is the function
  -- owner; service-role admin writes have current_user='service_role';
  -- both pass. Only direct authenticated / anon writes reach the
  -- sentinel reject below.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  -- Finding 4 fix: null/whitespace/casing-safe sentinel comparison.
  -- See migration header for rationale. The predicate collapses all
  -- three evasion vectors into a single LIKE prefix match against the
  -- canonicalized (trim + lower) post-row value.
  IF TG_TABLE_NAME = 'profiles' THEN
    IF lower(trim(coalesce(NEW.display_name, ''))) LIKE '[deleted%' THEN
      RAISE EXCEPTION
        'reject_sentinel_writes: profiles.display_name cannot be set to the [deleted] sentinel by user-originated writes (sentinel reserved for sanitize_user). audit-2026-05-07 P911 + red-team Finding 4.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSIF TG_TABLE_NAME = 'strategies' THEN
    IF lower(trim(coalesce(NEW.name, ''))) LIKE '[deleted%' THEN
      RAISE EXCEPTION
        'reject_sentinel_writes: strategies.name cannot be set to the [deleted strategy] sentinel by user-originated writes (sentinel reserved for sanitize_user). audit-2026-05-07 P911 + red-team Finding 4.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSIF TG_TABLE_NAME = 'portfolios' THEN
    IF lower(trim(coalesce(NEW.name, ''))) LIKE '[deleted%' THEN
      RAISE EXCEPTION
        'reject_sentinel_writes: portfolios.name cannot be set to the [deleted portfolio] sentinel by user-originated writes (sentinel reserved for sanitize_user). audit-2026-05-07 P911 + red-team Finding 4.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.reject_sentinel_writes() IS
  'Rejects user-originated writes that land the sanitize_user sentinel literal (any case/whitespace variant) into profiles/strategies/portfolios. Gated on current_user IN (authenticated, anon). See migrations 120, 127 (red-team Findings 3 + 4 + 8).';

-- Re-attach triggers (CREATE OR REPLACE on the function preserves the
-- binding, but we re-attach defensively).
DROP TRIGGER IF EXISTS profiles_reject_sentinel ON profiles;
CREATE TRIGGER profiles_reject_sentinel
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.reject_sentinel_writes();

DROP TRIGGER IF EXISTS strategies_reject_sentinel ON strategies;
CREATE TRIGGER strategies_reject_sentinel
  BEFORE INSERT OR UPDATE ON strategies
  FOR EACH ROW EXECUTE FUNCTION public.reject_sentinel_writes();

DROP TRIGGER IF EXISTS portfolios_reject_sentinel ON portfolios;
CREATE TRIGGER portfolios_reject_sentinel
  BEFORE INSERT OR UPDATE ON portfolios
  FOR EACH ROW EXECUTE FUNCTION public.reject_sentinel_writes();

-- --------------------------------------------------------------------------
-- STEP 3: replace create_wizard_strategy + finalize_wizard_strategy
-- without the set_config bypass marker.
-- --------------------------------------------------------------------------
-- Bodies identical to migration 126 except for the removed PERFORM
-- set_config(...) lines. The current_user shift inside SECURITY DEFINER
-- is now the bypass signal — no in-band GUC needed.
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
  'Atomic api_keys + strategies (source=wizard, status=draft) insert. SECURITY DEFINER — guard_wizard_draft_updates allows the write via current_user shift. See migrations 031, 126, 127 (red-team Finding 1).';

REVOKE ALL ON FUNCTION create_wizard_strategy FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_wizard_strategy TO authenticated;

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
  'Promotes a wizard draft (source=wizard, status=draft) to status=pending_review after asserting ownership. SECURITY DEFINER — guard_wizard_draft_updates allows the write via current_user shift. See migrations 031, 126, 127 (red-team Finding 1).';

REVOKE ALL ON FUNCTION finalize_wizard_strategy FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finalize_wizard_strategy TO authenticated;

-- --------------------------------------------------------------------------
-- STEP 4: replace sanitize_user without the set_config bypass marker.
-- --------------------------------------------------------------------------
-- Body identical to migration 120 except the
-- `PERFORM set_config('quantalyze.sanitize_in_progress', 'on', true)`
-- line is removed. The current_user shift inside SECURITY DEFINER is the
-- bypass signal for reject_sentinel_writes.
CREATE OR REPLACE FUNCTION public.sanitize_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_already_sanitized BOOLEAN;
  v_target_email TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'sanitize_user: p_user_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT (display_name = '[deleted]') INTO v_already_sanitized
  FROM profiles WHERE id = p_user_id;

  IF v_already_sanitized IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_already_sanitized THEN
    RETURN FALSE;
  END IF;

  SELECT email INTO v_target_email FROM profiles WHERE id = p_user_id;

  UPDATE profiles SET
    display_name  = '[deleted]',
    company       = NULL,
    description   = NULL,
    email         = NULL,
    telegram      = NULL,
    website       = NULL,
    linkedin      = NULL,
    avatar_url    = NULL,
    bio           = NULL,
    years_trading = NULL,
    aum_range     = NULL,
    partner_tag   = NULL
  WHERE id = p_user_id
    AND display_name IS DISTINCT FROM '[deleted]';

  DELETE FROM api_keys WHERE user_id = p_user_id;

  UPDATE strategies SET
    name                 = '[deleted strategy]',
    description          = NULL,
    codename             = NULL,
    public_contact_email = NULL,
    partner_tag          = NULL,
    review_note          = NULL
  WHERE user_id = p_user_id
    AND name IS DISTINCT FROM '[deleted strategy]';

  UPDATE trades SET
    raw_data          = NULL,
    exchange_order_id = NULL,
    exchange_fill_id  = NULL
  WHERE strategy_id IN (SELECT id FROM strategies WHERE user_id = p_user_id)
    AND (raw_data IS NOT NULL OR exchange_order_id IS NOT NULL OR exchange_fill_id IS NOT NULL);

  IF v_target_email IS NOT NULL THEN
    DELETE FROM verification_requests WHERE email = v_target_email;
  END IF;

  UPDATE portfolios SET
    name        = '[deleted portfolio]',
    description = NULL
  WHERE user_id = p_user_id
    AND name IS DISTINCT FROM '[deleted portfolio]';

  DELETE FROM allocator_preferences WHERE user_id = p_user_id;
  DELETE FROM user_favorites        WHERE user_id = p_user_id;
  DELETE FROM user_notes            WHERE user_id = p_user_id;
  DELETE FROM investor_attestations WHERE user_id = p_user_id;
  DELETE FROM user_app_roles        WHERE user_id = p_user_id;
  DELETE FROM organization_members  WHERE user_id = p_user_id;

  DELETE FROM match_batches WHERE allocator_id = p_user_id;
  DELETE FROM organization_invites WHERE invited_by = p_user_id;

  UPDATE organizations
    SET created_by = NULL
    WHERE created_by = p_user_id
      AND created_by IS NOT NULL;

  DELETE FROM auth.refresh_tokens WHERE user_id::text = p_user_id::text;
  DELETE FROM auth.sessions       WHERE user_id = p_user_id;

  UPDATE auth.users SET
    email               = NULL,
    encrypted_password  = NULL,
    raw_user_meta_data  = '{}'::jsonb,
    raw_app_meta_data   = '{}'::jsonb,
    banned_until        = 'infinity'::timestamptz,
    email_confirmed_at  = NULL,
    phone               = NULL,
    phone_confirmed_at  = NULL
  WHERE id = p_user_id;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.sanitize_user(UUID) IS
  'GDPR Art. 17 anonymize-not-delete RPC. SECURITY DEFINER. Idempotent. service_role-only EXECUTE. Sentinel-rejection triggers allow writes via current_user shift (no GUC bypass). See migrations 055, 120, 127 (red-team Findings 3 + 4 + 8).';

REVOKE ALL ON FUNCTION public.sanitize_user(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_user(UUID) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 5: self-verifying DO block — assert the GUC bypasses are gone and
-- the current_user gate is in place.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  guard_body       TEXT;
  sentinel_body    TEXT;
  create_body      TEXT;
  finalize_body    TEXT;
  sanitize_body    TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO guard_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'guard_wizard_draft_updates';
  IF guard_body IS NULL THEN
    RAISE EXCEPTION 'Migration 127 failed: guard_wizard_draft_updates function missing';
  END IF;
  -- The GUC bypass MUST be gone.
  IF guard_body LIKE '%quantalyze.wizard_rpc_active%' THEN
    RAISE EXCEPTION 'Migration 127 failed: guard_wizard_draft_updates still references the GUC bypass (Finding 1 regression)';
  END IF;
  -- The current_user gate MUST be present.
  IF guard_body NOT LIKE '%current_user%' THEN
    RAISE EXCEPTION 'Migration 127 failed: guard_wizard_draft_updates body lost current_user check';
  END IF;

  SELECT pg_get_functiondef(p.oid)
    INTO sentinel_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'reject_sentinel_writes';
  IF sentinel_body IS NULL THEN
    RAISE EXCEPTION 'Migration 127 failed: reject_sentinel_writes function missing';
  END IF;
  IF sentinel_body LIKE '%quantalyze.sanitize_in_progress%' THEN
    RAISE EXCEPTION 'Migration 127 failed: reject_sentinel_writes still references the GUC bypass (Finding 3 regression)';
  END IF;
  IF sentinel_body NOT LIKE '%current_user%' THEN
    RAISE EXCEPTION 'Migration 127 failed: reject_sentinel_writes body lost current_user check';
  END IF;
  IF sentinel_body NOT LIKE '%[deleted%%' THEN
    RAISE EXCEPTION 'Migration 127 failed: reject_sentinel_writes body lost prefix sentinel comparison';
  END IF;

  SELECT pg_get_functiondef(p.oid)
    INTO create_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'create_wizard_strategy';
  IF create_body LIKE '%quantalyze.wizard_rpc_active%' THEN
    RAISE EXCEPTION 'Migration 127 failed: create_wizard_strategy still calls set_config bypass';
  END IF;

  SELECT pg_get_functiondef(p.oid)
    INTO finalize_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'finalize_wizard_strategy';
  IF finalize_body LIKE '%quantalyze.wizard_rpc_active%' THEN
    RAISE EXCEPTION 'Migration 127 failed: finalize_wizard_strategy still calls set_config bypass';
  END IF;

  SELECT pg_get_functiondef(p.oid)
    INTO sanitize_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'sanitize_user';
  IF sanitize_body LIKE '%quantalyze.sanitize_in_progress%' THEN
    RAISE EXCEPTION 'Migration 127 failed: sanitize_user still calls set_config bypass';
  END IF;

  RAISE NOTICE 'Migration 127: GUC bypasses removed; current_user-based gate installed for guard_wizard_draft_updates and reject_sentinel_writes. Sentinel comparison is now null/whitespace/casing-safe.';
END
$$;

COMMIT;
