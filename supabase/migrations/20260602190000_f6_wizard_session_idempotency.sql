-- F6 — wizard/key submission idempotency (audit-2026-05-07: H-0304/H-0311/H-0186).
--
-- ROOT CAUSE (verified against live schema 2026-06-02): POST
-- /api/strategies/create-with-key validates + encrypts an exchange key via
-- Railway, then calls create_wizard_strategy(...) which inserts an api_keys +
-- strategies (source='wizard', status='draft') pair. The client passes a
-- stable wizard_session_id (localStorage idempotency token), the route has a
-- `23505 -> DRAFT_ALREADY_EXISTS` catch, and create_wizard_strategy DECLARES
-- p_wizard_session_id — but NOTHING enforces it: there is no UNIQUE constraint
-- or index anywhere on strategies/api_keys beyond the PK (confirmed via
-- pg_constraint + pg_indexes), and the RPC body never stored or checked the
-- session id. So the 23505 branch was DEAD CODE, and a client double-click or
-- browser retry minted TWO draft strategies + TWO encrypted-secret rows and
-- spent the Railway validate/encrypt budget + the exchange per-key probe quota
-- TWICE (H-0304/H-0311). A doc comment in WizardClient referencing a
-- "unique(user, api_key) trigger" was doc-rot — no such constraint existed.
--
-- FIX (charter: "partial-unique (user_id, wizard_session_id) + idempotency
-- fence"):
--   1. strategies.wizard_session_id column (nullable; only wizard drafts set it).
--   2. partial-unique (user_id, wizard_session_id) WHERE wizard_session_id IS
--      NOT NULL — the defense-in-depth backstop.
--   3. create_wizard_strategy made idempotent: a per-(user, session)
--      transaction-scoped advisory lock + select-existing fence returns the
--      draft already created for this (user, session) instead of inserting a
--      duplicate pair. Re-based VERBATIM on the latest definition (migration
--      20260515114310) — only the fence + the column write are added (B5b
--      lesson: grep ALL migrations for the function name, re-base on the
--      newest def before CREATE OR REPLACE so an older body is not silently
--      reverted).
-- The route adds a pre-Railway existence check (separate, app layer) so a
-- retry short-circuits BEFORE the expensive validate+encrypt — this migration
-- guarantees the DB layer never duplicates even if the app check races.
--
-- Existing in-flight drafts predate the column (wizard_session_id = NULL) and
-- are excluded by the partial index's WHERE clause — no backfill, no conflict.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: idempotency-token column
-- --------------------------------------------------------------------------
ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS wizard_session_id uuid;

COMMENT ON COLUMN public.strategies.wizard_session_id IS
  'F6: per-submission idempotency token (client localStorage, stable across retries) for the onboarding wizard. NULL for legacy/admin/CSV strategies. Partial-unique with user_id so a double-submit of POST /api/strategies/create-with-key dedups to one draft instead of minting duplicate strategies + api_keys + Railway validate/encrypt charges (audit H-0304/H-0311/H-0186).';

-- --------------------------------------------------------------------------
-- STEP 2: partial-unique backstop (RPC select-under-advisory-lock is primary)
-- --------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS strategies_user_wizard_session_uniq
  ON public.strategies (user_id, wizard_session_id)
  WHERE wizard_session_id IS NOT NULL;

COMMENT ON INDEX public.strategies_user_wizard_session_uniq IS
  'F6: at most one wizard draft per (user, wizard_session_id). Backstop for create_wizard_strategy''s advisory-lock + select-existing idempotency fence (audit H-0304/H-0311/H-0186).';

-- --------------------------------------------------------------------------
-- STEP 3: idempotent create_wizard_strategy
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
SET lock_timeout = '3s'
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

  -- F6 (H-0304/H-0311/H-0186): idempotency fence. Serialize concurrent calls
  -- carrying the same wizard_session_id on a transaction-scoped advisory lock
  -- (auto-released on commit/rollback; advisory locks are not subject to
  -- lock_timeout), then return any draft already created for this
  -- (user, session) instead of minting a duplicate strategies + api_keys pair.
  -- A client double-click or browser retry now resolves to the SAME draft
  -- rather than two drafts + two encrypted-secret rows.
  PERFORM pg_advisory_xact_lock(
    hashtext('wizdraft:' || p_user_id::text || ':' || p_wizard_session_id::text)
  );

  -- Only replay a COMPLETE draft (api_key_id present). If an orphaned draft
  -- exists for this session with a NULL api_key_id (its api_keys row was deleted
  -- out from under it via the ON DELETE SET NULL FK), do NOT hand back a NULL
  -- key — fall through so the INSERT trips strategies_user_wizard_session_uniq
  -- (23505 → the route's recoverable DRAFT_ALREADY_EXISTS 409) instead of
  -- returning a NULL api_key_id the route would reject with a permanent 500
  -- (red-team MEDIUM-1: route fence requires api_key_id; the two fences must agree).
  SELECT s.id, s.api_key_id
    INTO v_strategy_id, v_key_id
    FROM strategies s
   WHERE s.user_id = p_user_id
     AND s.wizard_session_id = p_wizard_session_id
     AND s.api_key_id IS NOT NULL
   LIMIT 1;

  IF v_strategy_id IS NOT NULL THEN
    -- Idempotent replay: hand back the existing draft, no new rows.
    RETURN QUERY SELECT v_strategy_id, v_key_id;
    RETURN;
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
    strategy_types, subtypes, markets, supported_exchanges,
    wizard_session_id
  )
  VALUES (
    p_user_id, v_key_id, p_placeholder_name, 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY[p_exchange],
    p_wizard_session_id
  )
  RETURNING id INTO v_strategy_id;

  RETURN QUERY SELECT v_strategy_id, v_key_id;
END;
$$;

COMMENT ON FUNCTION create_wizard_strategy IS
  'Atomic, idempotent api_keys + strategies (source=wizard, status=draft) insert. SECURITY DEFINER — guard_wizard_draft_updates allows the write via current_user shift. F6: a per-(user, wizard_session_id) advisory lock + select-existing fence dedups double-submits to one draft (audit H-0304/H-0311/H-0186); strategies_user_wizard_session_uniq is the backstop. See migrations 031, 126, 127.';

REVOKE ALL ON FUNCTION create_wizard_strategy FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_wizard_strategy TO authenticated;

-- --------------------------------------------------------------------------
-- STEP 4: self-verify structural posture (fail the migration loudly if any
-- invariant regressed). Runs inside the same transaction; a failed ASSERT
-- aborts the COMMIT.
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_col_exists   boolean;
  v_idx_def      text;
  v_fn_src       text;
BEGIN
  -- (a) column present + uuid
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='strategies'
       AND column_name='wizard_session_id' AND data_type='uuid'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN
    RAISE EXCEPTION 'F6 self-verify: strategies.wizard_session_id uuid column missing';
  END IF;

  -- (b) partial-unique index present + actually partial + actually unique
  SELECT indexdef INTO v_idx_def
    FROM pg_indexes
   WHERE schemaname='public' AND tablename='strategies'
     AND indexname='strategies_user_wizard_session_uniq';
  IF v_idx_def IS NULL THEN
    RAISE EXCEPTION 'F6 self-verify: strategies_user_wizard_session_uniq index missing';
  END IF;
  IF v_idx_def NOT ILIKE '%UNIQUE%'
     OR v_idx_def NOT ILIKE '%wizard_session_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'F6 self-verify: index is not a partial-UNIQUE on the expected predicate: %', v_idx_def;
  END IF;

  -- (c) RPC carries the idempotency fence (advisory lock + select-existing +
  --     the wizard_session_id column write).
  SELECT pg_get_functiondef('create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid)'::regprocedure)
    INTO v_fn_src;
  IF v_fn_src NOT ILIKE '%pg_advisory_xact_lock%'
     OR v_fn_src NOT ILIKE '%wizdraft:%'
     OR v_fn_src NOT ILIKE '%s.wizard_session_id = p_wizard_session_id%'
     OR v_fn_src NOT ILIKE '%wizard_session_id%' THEN
    RAISE EXCEPTION 'F6 self-verify: create_wizard_strategy is missing the idempotency fence';
  END IF;

  -- (d) grants intact (authenticated can EXECUTE, anon cannot)
  IF NOT has_function_privilege('authenticated',
        'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'F6 self-verify: authenticated lost EXECUTE on create_wizard_strategy';
  END IF;
  IF has_function_privilege('anon',
        'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'F6 self-verify: anon must NOT have EXECUTE on create_wizard_strategy';
  END IF;

  RAISE NOTICE 'F6 self-verify OK: wizard_session_id idempotency fence in place.';
END
$verify$;

COMMIT;
