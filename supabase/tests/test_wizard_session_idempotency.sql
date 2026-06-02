-- Test for migration 20260602190000 — F6 wizard/key submission idempotency
-- (audit-2026-05-07: H-0304 / H-0311 / H-0186).
--
-- ROOT CAUSE the migration fixes: POST /api/strategies/create-with-key passed a
-- stable wizard_session_id and had a `23505 -> DRAFT_ALREADY_EXISTS` catch, but
-- NOTHING enforced uniqueness (no constraint/index on strategies or api_keys
-- beyond the PK) and create_wizard_strategy never stored or checked the session
-- id — so the catch was dead code and a double-submit minted two drafts + two
-- encrypted-secret rows + two Railway validate/encrypt charges.
--
-- This file pins the structural invariants of the fix. pgTAP is not set up in
-- this project (CLAUDE.md / Lane B audit), so assertions RAISE EXCEPTION on
-- failure — a clean run prints NOTICEs; a failed assertion aborts with a clear
-- message. The functional behavior (replay dedups to one draft; distinct
-- sessions are isolated) is exercised by create_wizard_strategy's own
-- self-verify block, the live probe run at authoring time, and the route-level
-- vitest suite (create-with-key/route.test.ts — idempotency fence).
--
-- Usage:
--   psql "$DATABASE_URL" -f supabase/tests/test_wizard_session_idempotency.sql

DO $$
DECLARE
  v_col_type   TEXT;
  v_idx_def    TEXT;
  v_fn_src     TEXT;
BEGIN
  -- ----- 1. strategies.wizard_session_id column exists and is uuid ----------
  SELECT data_type INTO v_col_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'strategies'
     AND column_name = 'wizard_session_id';
  IF v_col_type IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: strategies.wizard_session_id column is missing';
  END IF;
  IF v_col_type <> 'uuid' THEN
    RAISE EXCEPTION 'TEST FAILED: strategies.wizard_session_id must be uuid, got %', v_col_type;
  END IF;

  -- ----- 2. partial-UNIQUE index on (user_id, wizard_session_id) ------------
  SELECT indexdef INTO v_idx_def
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'strategies'
     AND indexname = 'strategies_user_wizard_session_uniq';
  IF v_idx_def IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: strategies_user_wizard_session_uniq index is missing';
  END IF;
  IF v_idx_def NOT ILIKE '%UNIQUE%' THEN
    RAISE EXCEPTION 'TEST FAILED: strategies_user_wizard_session_uniq must be UNIQUE: %', v_idx_def;
  END IF;
  IF v_idx_def NOT ILIKE '%user_id%' OR v_idx_def NOT ILIKE '%wizard_session_id%' THEN
    RAISE EXCEPTION 'TEST FAILED: index must cover (user_id, wizard_session_id): %', v_idx_def;
  END IF;
  -- Must be PARTIAL (WHERE wizard_session_id IS NOT NULL) so legacy/CSV rows
  -- (NULL session id) are excluded — otherwise every NULL collides.
  IF v_idx_def NOT ILIKE '%wizard_session_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'TEST FAILED: index must be partial (WHERE wizard_session_id IS NOT NULL): %', v_idx_def;
  END IF;

  -- ----- 3. create_wizard_strategy carries the idempotency fence ------------
  SELECT pg_get_functiondef(p.oid) INTO v_fn_src
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'create_wizard_strategy';
  IF v_fn_src IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: create_wizard_strategy function is missing';
  END IF;
  -- (a) per-(user, session) advisory lock serializes concurrent double-submits
  IF v_fn_src NOT ILIKE '%pg_advisory_xact_lock%' OR v_fn_src NOT ILIKE '%wizdraft:%' THEN
    RAISE EXCEPTION 'TEST FAILED: create_wizard_strategy is missing the per-(user, session) advisory lock';
  END IF;
  -- (b) select-existing fence returns the prior draft instead of inserting
  IF v_fn_src NOT ILIKE '%s.wizard_session_id = p_wizard_session_id%' THEN
    RAISE EXCEPTION 'TEST FAILED: create_wizard_strategy is missing the select-existing fence';
  END IF;
  -- (c) the INSERT now stores the session id (so the fence + index can see it)
  IF v_fn_src NOT ILIKE '%wizard_session_id%' THEN
    RAISE EXCEPTION 'TEST FAILED: create_wizard_strategy does not store wizard_session_id';
  END IF;
  -- (d) still SECURITY DEFINER (the wizard write rides the current_user shift)
  IF v_fn_src NOT ILIKE '%SECURITY DEFINER%' THEN
    RAISE EXCEPTION 'TEST FAILED: create_wizard_strategy must remain SECURITY DEFINER';
  END IF;

  -- ----- 4. grants: authenticated EXECUTEs, anon does NOT ------------------
  IF NOT has_function_privilege('authenticated',
        'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: authenticated lost EXECUTE on create_wizard_strategy';
  END IF;
  IF has_function_privilege('anon',
        'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: anon must NOT have EXECUTE on create_wizard_strategy';
  END IF;

  RAISE NOTICE 'PASS: F6 wizard-session idempotency invariants intact (column + partial-unique + advisory-lock fence + grants).';
END $$;
