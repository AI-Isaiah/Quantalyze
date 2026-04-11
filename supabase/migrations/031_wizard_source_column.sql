-- Migration 031: source column on strategies + wizard_context on for_quants_leads
-- plus SECURITY DEFINER RPCs for the /strategies/new/wizard onboarding flow.
--
-- Why this migration exists
-- -------------------------
-- Sprint 1 Task 1.2 ships the "Connect Your Strategy" wizard. The flow
-- needs a server-side draft row before sync runs (Railway Python analytics
-- writes to strategy_analytics keyed on strategies.id), but the `draft`
-- status value already has two unrelated meanings in this schema:
--
--   1. Rejected-back-for-edits  (admin strategy-review flow,
--      see src/app/api/admin/strategy-review/route.ts:72)
--   2. Partner-import seeds     (see src/app/api/admin/partner-import/route.ts:263)
--   3. Wizard in-progress        (new, introduced by this migration)
--
-- Codex's Phase 3 engineering review independently caught this three-way
-- collision. Cross-filtering by status alone would hide legitimate draft
-- workflows in admin and partner flows. We add a `source` discriminator
-- column so the wizard's in-progress rows can be identified and excluded
-- from user-facing queries WITHOUT touching the admin/partner-import paths.
--
-- A prior design considered a separate `draft_strategies` table + schema
-- addendum on `strategy_analytics` (draft_strategy_id FK + XOR constraint).
-- That approach would have required matching changes in the Python
-- Railway analytics service (`analytics-service/routers/analytics.py`,
-- `exchange.py`, `models/schemas.py`) because Python only writes to
-- `strategy_analytics` keyed on `strategy_id`. The coordination risk of
-- shipping Next.js before Python redeploys on Railway, combined with the
-- fact that the `source` discriminator cleanly solves the original
-- pollution concern, made the strategies+source approach the chosen path.
-- See the plan file at ~/.claude/plans/magical-weaving-yao.md for the
-- full mid-implementation adjustment rationale.
--
-- What this migration does
-- ------------------------
-- 1. Adds `strategies.source TEXT NOT NULL DEFAULT 'legacy'` with a CHECK
--    constraint limiting values to ('legacy','wizard','admin_import').
--    Existing rows backfill to 'legacy' automatically via the default.
-- 2. Adds `for_quants_leads.wizard_context JSONB` (nullable) so the
--    Request-a-Call modal inside the wizard can attach {strategy_id, step}
--    context to each lead. Zero impact on existing landing-page leads.
-- 3. Creates two SECURITY DEFINER RPCs that encapsulate the wizard's
--    multi-row writes in transactions:
--      - `create_wizard_strategy(...)` inserts an api_keys row + a
--        strategies row (source='wizard', status='draft') atomically.
--      - `finalize_wizard_strategy(...)` promotes a wizard draft to
--        `status='pending_review'` after verifying ownership, source,
--        and the current status.
-- 4. Self-verifying DO block that RAISES EXCEPTION if any assertion
--    about the column, the RPCs, or their security-definer status fails.
--
-- What this migration does NOT do
-- -------------------------------
-- - No changes to migration 028 trigger (`check_strategy_api_key_ownership_trigger`).
--   Both wizard-created strategies rows with `api_key_id` linked, and legacy
--   rows updated to set `api_key_id`, still fire the tenant check.
-- - No changes to RLS policies on strategies (migration 002:28-33). The
--   wizard inserts via the SECURITY DEFINER RPC so it bypasses RLS
--   during the atomic insert; existing policies still apply to direct
--   client reads/writes.
-- - No cleanup cron. Sprint 2 adds:
--     DELETE FROM strategies
--      WHERE source = 'wizard'
--        AND status = 'draft'
--        AND created_at < now() - interval '24 hours';
--   The cascade FK on api_keys handles orphaned key rows automatically.
-- - No Python Railway changes. The analytics-service continues to write
--   strategy_analytics keyed on strategy_id, which is preserved.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: strategies.source column
-- --------------------------------------------------------------------------
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE strategies
  DROP CONSTRAINT IF EXISTS strategies_source_check;

ALTER TABLE strategies
  ADD CONSTRAINT strategies_source_check
    CHECK (source IN ('legacy', 'wizard', 'admin_import'));

COMMENT ON COLUMN strategies.source IS
  'Origin of the strategies row. ''legacy'' = original StrategyForm / CSV flow, ''wizard'' = Task 1.2 onboarding wizard, ''admin_import'' = partner CSV import. Used to discriminate draft lifetimes: wizard drafts auto-expire after 24h, legacy/admin drafts persist. See migration 031.';

-- Index for the cleanup cron query (Sprint 2) and any call-site filters.
CREATE INDEX IF NOT EXISTS idx_strategies_source_status_created
  ON strategies (source, status, created_at)
  WHERE source = 'wizard' AND status = 'draft';

-- --------------------------------------------------------------------------
-- STEP 2: for_quants_leads.wizard_context
-- --------------------------------------------------------------------------
-- The Request-a-Call modal inside the wizard (ConnectKeyStep, SyncPreviewStep,
-- MetadataStep, SubmitStep) attaches a JSONB blob like
-- {"strategy_id": "...", "step": "sync_preview"} so the founder can triage
-- leads from inside the flow separately from cold landing-page leads.
ALTER TABLE for_quants_leads
  ADD COLUMN IF NOT EXISTS wizard_context JSONB;

COMMENT ON COLUMN for_quants_leads.wizard_context IS
  'Optional wizard context blob: {strategy_id, step}. NULL for landing-page leads. See migration 031.';

-- --------------------------------------------------------------------------
-- STEP 3: create_wizard_strategy RPC (SECURITY DEFINER)
-- --------------------------------------------------------------------------
-- Called from /api/strategies/create-with-key after validate+encrypt succeeds.
-- Inserts an api_keys row with the encrypted payload + a draft strategies row
-- linked to it in a single transaction. Returns the new strategy_id and
-- api_key_id so the client can advance to the sync step.
--
-- SECURITY DEFINER: the function owner (postgres) has write access to
-- api_keys and strategies regardless of RLS. The function verifies
-- `p_user_id = auth.uid()` explicitly so it cannot be abused by one user
-- to create rows for another user.
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
  -- Verify the caller is writing for themselves. RLS would normally
  -- enforce this, but SECURITY DEFINER bypasses RLS so we enforce
  -- manually. This is the single most important assertion in the RPC.
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'create_wizard_strategy called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'create_wizard_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Insert the encrypted key row. All SEC-005-protected columns are
  -- populated here; migration 027's REVOKE pattern allows INSERT but
  -- blocks SELECT on the encrypted columns for end clients.
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

  -- Insert the draft strategies row with the new key linked. Migration
  -- 028's tenant-check trigger fires here and asserts the api_key_id
  -- belongs to p_user_id; since we just inserted that key with the same
  -- user_id, the check passes. The source discriminator marks this row
  -- as a wizard in-progress draft so queries can exclude it.
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
  'Atomic api_keys + strategies (source=wizard, status=draft) insert for Task 1.2. See migration 031.';

REVOKE ALL ON FUNCTION create_wizard_strategy FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_wizard_strategy TO authenticated;

-- --------------------------------------------------------------------------
-- STEP 4: finalize_wizard_strategy RPC (SECURITY DEFINER)
-- --------------------------------------------------------------------------
-- Called from /api/strategies/finalize-wizard on SubmitStep. Updates the
-- draft strategies row with final metadata and flips status to
-- `pending_review`. Verifies ownership, source, and status before the
-- update so a raw caller cannot hijack or double-promote a strategy.
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

  -- Lock the row FOR UPDATE while we assert + promote. Matches the
  -- pattern used in migration 020 for RLS-scoped PII revokes.
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
  'Promotes a wizard draft (source=wizard, status=draft) to status=pending_review after asserting ownership. See migration 031.';

REVOKE ALL ON FUNCTION finalize_wizard_strategy FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finalize_wizard_strategy TO authenticated;

-- --------------------------------------------------------------------------
-- STEP 5: lock wizard drafts from direct client writes
-- --------------------------------------------------------------------------
-- The `finalize_wizard_strategy` RPC is advertised as the single choke
-- point for wizard draft promotion. Without the trigger below, that
-- invariant is a comment rather than a constraint: the existing
-- `strategies_update` RLS policy (migration 002) lets any owner
-- directly `UPDATE strategies SET status='pending_review' WHERE id=X`
-- without going through the RPC. That bypasses every guard the RPC
-- enforces (status validation, source validation, metadata cleanup)
-- and poisons the admin review queue.
--
-- This trigger runs BEFORE UPDATE ON strategies and blocks any
-- non-SECURITY-DEFINER caller from mutating a row where
-- `source='wizard' AND status='draft'` unless the new status is
-- still 'draft' (autosave case). SECURITY DEFINER calls from
-- `finalize_wizard_strategy` bypass this because they execute with
-- the table owner's role, not the `authenticated` role.
CREATE OR REPLACE FUNCTION guard_wizard_draft_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
-- SECURITY INVOKER intentionally: we need `current_user` at trigger
-- time to reflect the role that actually initiated the UPDATE. When a
-- client using the `authenticated` role runs an UPDATE, current_user
-- is `authenticated`, and the guard fires. When `finalize_wizard_strategy`
-- (SECURITY DEFINER) runs an UPDATE internally, current_user is the
-- function owner (postgres/table owner), and the guard passes.
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

  -- If we got here, someone tried to flip a wizard draft to a new
  -- status or source value. The SECURITY DEFINER RPCs promote wizard
  -- drafts as the function owner role, which does NOT match
  -- `authenticated`. Direct client UPDATEs from the RLS-scoped
  -- supabase client DO run as `authenticated`, so they hit this branch
  -- and get blocked. This is the single-chokepoint guarantee
  -- finalize_wizard_strategy advertises.
  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION
      'Direct update on wizard draft % blocked. Use finalize_wizard_strategy or delete the draft.',
      OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION guard_wizard_draft_updates() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_wizard_draft_updates_trigger ON strategies;

CREATE TRIGGER guard_wizard_draft_updates_trigger
  BEFORE UPDATE ON strategies
  FOR EACH ROW
  EXECUTE FUNCTION guard_wizard_draft_updates();

COMMENT ON TRIGGER guard_wizard_draft_updates_trigger ON strategies IS
  'Blocks direct client updates that would flip a wizard draft out of (source=wizard, status=draft). Only finalize_wizard_strategy (SECURITY DEFINER) can promote wizard drafts. See migration 031.';

-- --------------------------------------------------------------------------
-- STEP 6: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  source_col_exists BOOLEAN;
  source_default TEXT;
  source_check_exists BOOLEAN;
  leads_col_exists BOOLEAN;
  create_fn_exists BOOLEAN;
  create_fn_secdef BOOLEAN;
  finalize_fn_exists BOOLEAN;
  finalize_fn_secdef BOOLEAN;
  guard_trigger_exists BOOLEAN;
  index_exists BOOLEAN;
BEGIN
  -- 1. source column on strategies
  SELECT
    column_default,
    EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'strategies' AND column_name = 'source')
  INTO source_default, source_col_exists
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'strategies' AND column_name = 'source';

  IF NOT source_col_exists THEN
    RAISE EXCEPTION 'Migration 031 failed: strategies.source column missing';
  END IF;

  IF source_default IS NULL OR source_default NOT LIKE '%legacy%' THEN
    RAISE EXCEPTION 'Migration 031 failed: strategies.source default is %, expected a literal ''legacy''',
      source_default;
  END IF;

  -- 2. source CHECK constraint
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'strategies'
      AND c.conname = 'strategies_source_check'
      AND c.contype = 'c'
  ) INTO source_check_exists;

  IF NOT source_check_exists THEN
    RAISE EXCEPTION 'Migration 031 failed: strategies_source_check constraint missing';
  END IF;

  -- 3. for_quants_leads.wizard_context column
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'for_quants_leads' AND column_name = 'wizard_context'
  ) INTO leads_col_exists;

  IF NOT leads_col_exists THEN
    RAISE EXCEPTION 'Migration 031 failed: for_quants_leads.wizard_context column missing';
  END IF;

  -- 4. create_wizard_strategy RPC
  SELECT
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'create_wizard_strategy'),
    COALESCE(
      (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'create_wizard_strategy'),
      FALSE)
  INTO create_fn_exists, create_fn_secdef;

  IF NOT create_fn_exists THEN
    RAISE EXCEPTION 'Migration 031 failed: create_wizard_strategy function missing';
  END IF;

  IF NOT create_fn_secdef THEN
    RAISE EXCEPTION 'Migration 031 failed: create_wizard_strategy is not SECURITY DEFINER';
  END IF;

  -- 5. finalize_wizard_strategy RPC
  SELECT
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'finalize_wizard_strategy'),
    COALESCE(
      (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'finalize_wizard_strategy'),
      FALSE)
  INTO finalize_fn_exists, finalize_fn_secdef;

  IF NOT finalize_fn_exists THEN
    RAISE EXCEPTION 'Migration 031 failed: finalize_wizard_strategy function missing';
  END IF;

  IF NOT finalize_fn_secdef THEN
    RAISE EXCEPTION 'Migration 031 failed: finalize_wizard_strategy is not SECURITY DEFINER';
  END IF;

  -- 6. Guard trigger on strategies
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'strategies'
      AND t.tgname = 'guard_wizard_draft_updates_trigger'
      AND NOT t.tgisinternal
  ) INTO guard_trigger_exists;

  IF NOT guard_trigger_exists THEN
    RAISE EXCEPTION 'Migration 031 failed: guard_wizard_draft_updates_trigger not attached to strategies';
  END IF;

  -- 7. Partial index on (source, status, created_at)
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'idx_strategies_source_status_created'
  ) INTO index_exists;

  IF NOT index_exists THEN
    RAISE EXCEPTION 'Migration 031 failed: idx_strategies_source_status_created missing';
  END IF;

  RAISE NOTICE 'Migration 031: source column + wizard_context column + create_wizard_strategy + finalize_wizard_strategy + guard trigger installed and verified.';
END
$$;

COMMIT;
