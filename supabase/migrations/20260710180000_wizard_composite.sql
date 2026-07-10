-- Phase 88 (v1.9 multi-key composite strategy): composite-assembly RPCs.
-- Requirement: ONB-03 (per-key add proceeds; membership written wholesale).
--
-- PURE ADDITIVE. This migration only CREATEs two new SECURITY DEFINER functions
-- and their grants. It writes ZERO existing rows, adds NO column / index /
-- constraint / trigger, and does NOT touch create_wizard_strategy,
-- create-with-key, or the strategies_user_wizard_session_uniq backstop index —
-- the entire single-key path resolves its key exactly as today, byte-identically
-- (SC-4). A canary in the self-verify DO block asserts create_wizard_strategy
-- still carries its 'wizdraft:' fence, proving this migration did not replace it.
--
-- WHAT IT ADDS (the composite data path — nothing INSERTs strategy_keys today):
--   1. add_wizard_composite_key(...) — signature MIRRORS create_wizard_strategy.
--      Lazily creates the ONE api_key_id=NULL composite draft per
--      (user, wizard_session_id) under a DISTINCT 'wizcomposite:' advisory-lock
--      space (the single-key 'wizdraft:' lock space is left untouched), then
--      ALWAYS inserts a fresh encrypted api_keys row and returns both ids. The
--      DRAFT is fenced (double-click dedup, ported from F6); the KEY add
--      proceeds (ONB-03). The existing strategies_user_wizard_session_uniq
--      partial index (predicate: wizard_session_id IS NOT NULL — already covers
--      api_key_id=NULL rows) backstops the draft; a session that already holds a
--      SINGLE-KEY draft trips a 23505 here and fails loud (the route maps it,
--      never silently converts).
--   2. set_wizard_composite_members(p_user_id, p_strategy_id, p_members) —
--      WHOLESALE delete-then-insert of strategy_keys members, seq derived
--      SERVER-SIDE from window_start ASC order (client NEVER sends seq).
--
-- L-4 RESOLUTION: membership is rewritten wholesale (DELETE all, then INSERT
-- with fresh seq). Because there is no in-place seq UPDATE, a member reorder can
-- never produce a transient (strategy_id, seq) 23505 — L-4 dissolves at write
-- time. A deferred-unique-constraint DDL approach was deliberately rejected (no
-- repo precedent; unnecessary once the write is wholesale; RESEARCH Pillar C).
-- This migration adds no such constraint — L-4 is resolved by the wholesale
-- write, not by DDL.
--
-- Owner/tenant coherence on members is enforced by the EXISTING
-- strategy_keys_owner_coherence BEFORE trigger (fires for definer writes too);
-- NO new trigger and NO app-layer duplicate check is added.
--
-- Overlap enforcement is NOT re-derived here: authoritative disjointness stays
-- with the worker's assert_windows_disjoint (fail-loud) + the client zod schema
-- (UX). A third SQL overlap derivation would violate the one-spec rule.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- FUNCTION 1: add_wizard_composite_key — composite-draft fence + per-key add.
-- Signature is column-for-column identical to create_wizard_strategy so the
-- route's encrypt+persist call site is a drop-in sibling.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_wizard_composite_key(
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
    RAISE EXCEPTION 'add_wizard_composite_key called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'add_wizard_composite_key: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Idempotency fence for the DRAFT only (ONB-03: the per-KEY add proceeds).
  -- DISTINCT 'wizcomposite:' lock space so the single-key 'wizdraft:' fence is
  -- untouched. Serializes concurrent adds for this (user, session) so two calls
  -- resolve to ONE composite draft instead of two.
  PERFORM pg_advisory_xact_lock(
    hashtext('wizcomposite:' || p_user_id::text || ':' || p_wizard_session_id::text)
  );

  -- The composite draft is the (user, session) strategies row with a NULL
  -- api_key_id (the single-key link is NEVER set for a composite). If none
  -- exists yet, create it. A single-key draft for the same session (api_key_id
  -- set) does NOT match this predicate, so we fall through to INSERT and trip
  -- strategies_user_wizard_session_uniq (23505 → the route maps it loud).
  SELECT s.id
    INTO v_strategy_id
    FROM strategies s
   WHERE s.user_id = p_user_id
     AND s.wizard_session_id = p_wizard_session_id
     AND s.api_key_id IS NULL
   LIMIT 1;

  IF v_strategy_id IS NULL THEN
    -- Mirrors create_wizard_strategy's strategies INSERT column-for-column
    -- EXCEPT api_key_id, which is omitted so it stays NULL for the composite.
    INSERT INTO strategies (
      user_id, name, status, source,
      strategy_types, subtypes, markets, supported_exchanges,
      wizard_session_id
    )
    VALUES (
      p_user_id, p_placeholder_name, 'draft', 'wizard',
      '{}', '{}', '{}', ARRAY[p_exchange],
      p_wizard_session_id
    )
    RETURNING id INTO v_strategy_id;
  END IF;

  -- ALWAYS mint a fresh encrypted api_keys row (this IS the per-key add — the
  -- api_keys INSERT column list mirrors create_wizard_strategy verbatim).
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

  RETURN QUERY SELECT v_strategy_id, v_key_id;
END;
$$;

COMMENT ON FUNCTION public.add_wizard_composite_key IS
  'ONB-03: lazily creates the ONE api_key_id=NULL composite draft per (user, wizard_session_id) under a wizcomposite: advisory-lock fence, then ALWAYS inserts a fresh encrypted api_keys row and returns (strategy_id, api_key_id). The DRAFT is fenced (double-click dedup, ported from F6/create_wizard_strategy); the per-KEY add proceeds. strategies_user_wizard_session_uniq backstops the draft. Single-key create_wizard_strategy is untouched (SC-4).';

REVOKE ALL ON FUNCTION public.add_wizard_composite_key(
  uuid, text, text, text, text, text, text, text, integer, text, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_wizard_composite_key(
  uuid, text, text, text, text, text, text, text, integer, text, uuid
) TO authenticated;

-- --------------------------------------------------------------------------
-- FUNCTION 2: set_wizard_composite_members — wholesale member write.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_wizard_composite_members(
  p_user_id UUID,
  p_strategy_id UUID,
  p_members JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_api_key_id UUID;
  v_count INTEGER;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'set_wizard_composite_members called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'set_wizard_composite_members: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Ownership + composite-draft guard in ONE least-disclosure lookup: filtering
  -- by user_id means "not found" and "not owned" are indistinguishable to the
  -- caller (no existence oracle). A single-key strategy (api_key_id NOT NULL)
  -- can NEVER acquire members through this fn (protects composite-detection).
  SELECT api_key_id
    INTO v_api_key_id
    FROM strategies
   WHERE id = p_strategy_id
     AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_wizard_composite_members: no composite draft for the caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_api_key_id IS NOT NULL THEN
    RAISE EXCEPTION 'set_wizard_composite_members: target is a single-key strategy, not a composite draft';
  END IF;

  -- WHOLESALE rewrite: DELETE all members, then INSERT with seq derived from
  -- window_start ASC order (1-indexed). No in-place seq UPDATE ⇒ no transient
  -- (strategy_id, seq) 23505 on reorder (L-4 dissolved). The existing
  -- strategy_keys_owner_coherence trigger enforces cross-tenant coherence on
  -- each INSERT — no app-layer duplicate. Deterministic tiebreak on api_key_id
  -- keeps seq stable if two members share a window_start.
  DELETE FROM strategy_keys WHERE strategy_id = p_strategy_id;

  INSERT INTO strategy_keys (
    strategy_id, api_key_id, owner_id, window_start, window_end, seq
  )
  SELECT
    p_strategy_id,
    (elem->>'api_key_id')::uuid,
    p_user_id,
    (elem->>'window_start')::date,
    (elem->>'window_end')::date,
    (row_number() OVER (
       ORDER BY (elem->>'window_start')::date ASC, (elem->>'api_key_id')
     ))::int
  FROM jsonb_array_elements(p_members) AS elem;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.set_wizard_composite_members IS
  'ONB-03/L-4: wholesale delete-then-insert of a composite draft''s strategy_keys members. seq is derived SERVER-SIDE from window_start ASC order (client never sends seq), so a re-submit is idempotent and a reorder never trips a transient (strategy_id, seq) 23505. Guards: auth.uid()=p_user_id, strategy owned by caller, api_key_id IS NULL (composite draft only). Cross-tenant coherence via the existing strategy_keys_owner_coherence trigger. Returns the member count written.';

REVOKE ALL ON FUNCTION public.set_wizard_composite_members(uuid, uuid, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_wizard_composite_members(uuid, uuid, jsonb)
  TO authenticated;

-- --------------------------------------------------------------------------
-- Self-verify structural posture (fail the apply loudly if any invariant
-- regressed). Runs inside the same transaction; a failed RAISE aborts COMMIT.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_add_src TEXT;
  v_set_src TEXT;
  v_cws_src TEXT;
BEGIN
  -- (a) both new functions exist (regprocedure resolves or errors).
  SELECT pg_get_functiondef(
    'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)'::regprocedure
  ) INTO v_add_src;
  SELECT pg_get_functiondef(
    'public.set_wizard_composite_members(uuid,uuid,jsonb)'::regprocedure
  ) INTO v_set_src;

  -- (b) add_wizard_composite_key carries the advisory-lock fence on the DISTINCT
  --     'wizcomposite:' space, and both fns bake SET search_path (T-88-05).
  IF v_add_src NOT ILIKE '%pg_advisory_xact_lock%'
     OR v_add_src NOT ILIKE '%wizcomposite:%' THEN
    RAISE EXCEPTION 'wizard_composite self-verify: add_wizard_composite_key is missing the wizcomposite: advisory-lock fence';
  END IF;
  IF v_add_src NOT ILIKE '%search_path%' OR v_set_src NOT ILIKE '%search_path%' THEN
    RAISE EXCEPTION 'wizard_composite self-verify: a composite RPC is missing its baked SET search_path (search_path hijack surface)';
  END IF;

  -- (c) grants: authenticated can EXECUTE, anon cannot — for BOTH fns (T-88-03).
  IF NOT has_function_privilege('authenticated',
       'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'wizard_composite self-verify: authenticated lost EXECUTE on add_wizard_composite_key';
  END IF;
  IF has_function_privilege('anon',
       'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'wizard_composite self-verify: anon must NOT have EXECUTE on add_wizard_composite_key';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.set_wizard_composite_members(uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'wizard_composite self-verify: authenticated lost EXECUTE on set_wizard_composite_members';
  END IF;
  IF has_function_privilege('anon',
       'public.set_wizard_composite_members(uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'wizard_composite self-verify: anon must NOT have EXECUTE on set_wizard_composite_members';
  END IF;

  -- (d) SC-4 canary: the single-key create_wizard_strategy STILL carries its
  --     'wizdraft:' fence — proof this migration did not replace it.
  SELECT pg_get_functiondef(
    'public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid)'::regprocedure
  ) INTO v_cws_src;
  IF v_cws_src NOT ILIKE '%wizdraft:%' THEN
    RAISE EXCEPTION 'wizard_composite self-verify: create_wizard_strategy lost its wizdraft: fence — the single-key path was altered (SC-4 violated)';
  END IF;

  RAISE NOTICE 'wizard_composite self-verify OK: both composite RPCs present (fenced, search_path-baked, grants intact); single-key create_wizard_strategy canary intact.';
END
$$;

COMMIT;
