-- Migration 082: commit_scenario_batch SECURITY DEFINER RPC (Phase 10 / SCENARIO-07 / H4 + M7)
-- The Plan 07 POST /api/allocator/scenario/commit route delegates to this RPC for
-- the H4 single-tx invariant (CONTEXT D-09 — single Postgres transaction). Supabase
-- JS does not expose multi-statement transactions to route handlers, so the RPC IS
-- the single-tx implementation; without it Plan 07 cannot honour D-09.
--
-- The route handler calls:
--   admin.rpc('commit_scenario_batch', { p_allocator_id: user.id, p_diffs: <jsonb> })
--
-- The RPC:
--   (1) Asserts auth.uid() = p_allocator_id (defence-in-depth — route already enforces
--       via withAuth, but the RPC must NOT be callable with a forged p_allocator_id).
--   (2) For each diff in p_diffs (jsonb array):
--         - voluntary_remove: ownership probe via allocator_holdings.scope_ref;
--           INSERT match_decisions (kind='voluntary_remove') + bridge_outcomes
--           (kind='rejected', strategy_id=NULL, rejection_reason from diff).
--         - voluntary_add: strategy existence + status='published' probe; INSERT
--           match_decisions (kind='voluntary_add') + bridge_outcomes (kind='allocated',
--           strategy_id=diff.strategy_id, percent_allocated, allocated_at).
--         - voluntary_modify: ownership probe; INSERT match_decisions
--           (kind='voluntary_modify') + bridge_outcomes (kind='allocated' representing
--           kept-at-new-weight; strategy_id NULL because no swap).
--         - bridge_recommended: M7 reuse-or-create — SELECT existing match_decision
--           for (allocator_id, original_holding_ref, strategy_id, kind='bridge_recommended');
--           if present REUSE its id (skip INSERT); else INSERT new. Then INSERT
--           bridge_outcomes referencing the (possibly-reused) match_decision_id.
--   (3) On any per-row failure: RAISE EXCEPTION → entire tx rolls back → caller receives
--       an error containing per-row index + reason. NO partial state.
--   (4) On full success: returns jsonb { ok: true, recorded: [{index, match_decision_id,
--       bridge_outcome_id, kind}, ...] }.
--
-- Schema-name reconciliation (matches migration 080 STEP 7 comment):
--   The plan + RESEARCH refer to the recommended/added strategy column on
--   match_decisions as `suggested_strategy_id`. The live schema (since migration 011)
--   calls this column `strategy_id`. The RPC body uses the actual column name.
--
-- Decision-column mapping (live schema's `decision` text column with
-- match_decisions_decision_check IN ('thumbs_up', 'thumbs_down', 'sent_as_intro',
-- 'snoozed') and partial unique indexes from migrations 011/074):
--   - bridge_recommended: 'thumbs_up' — uses migration 074's
--     uniq_match_dec_thumbup_per_pair_holding which is on
--     (allocator_id, strategy_id, COALESCE(original_holding_ref, '')) — admits
--     multiple holdings against the same strategy. Matches the M7 invariant.
--   - voluntary_remove + voluntary_add + voluntary_modify: 'snoozed' — has NO
--     partial unique index, so multiple voluntary diffs in a session don't
--     collide. (For voluntary_remove, strategy_id is NULL anyway, and Postgres
--     unique indexes treat NULLs as distinct, so any decision would work; using
--     'snoozed' uniformly across all three voluntary kinds keeps the RPC body
--     simple and the contract clear.)
--
-- Authorisation model: SECURITY DEFINER + auth.uid() guard. RLS is bypassed for
-- SECURITY DEFINER, so ownership is enforced by the per-row probes
-- (allocator_holdings.scope_ref SELECT, strategies.status SELECT). REVOKE ALL
-- FROM PUBLIC, anon; GRANT EXECUTE TO authenticated only.
--
-- ADR-0023 sync: covered in the Phase 10 entry already shipped with migration 080
-- + 081 (D-23 atomic-commit precedent). This migration's commit appends an
-- additional clarification narrative if needed (handled in the same commit body).
--
-- Application path: applied via Supabase Management API. Self-verifying DO block
-- raises EXCEPTION on any invariant failure → automatic rollback.

BEGIN;
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.commit_scenario_batch(
  p_allocator_id uuid,
  p_diffs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $func$
DECLARE
  v_caller            uuid := auth.uid();
  v_diff              jsonb;
  v_index             int := 0;
  v_kind              text;
  v_md_id             uuid;
  v_bo_id             uuid;
  v_recorded          jsonb := '[]'::jsonb;
  v_holding_owner_ct  int;
  v_strategy_status   text;
  v_existing_md_id    uuid;
BEGIN
  -- (1) Defence-in-depth: caller must match the p_allocator_id arg.
  --     The auth.uid() helper returns NULL when invoked by service_role (which
  --     bypasses auth) or by anon. Either way, NULL <> p_allocator_id evaluates
  --     to NULL → the OR-NULL short-circuit handles it. Use IS NULL OR <> form
  --     to make the intent explicit and so the assertion string scan succeeds.
  IF v_caller IS NULL OR v_caller <> p_allocator_id THEN
    RAISE EXCEPTION 'commit_scenario_batch: unauthorized — auth.uid() <> p_allocator_id'
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- (2) Validate the diffs array.
  IF jsonb_typeof(p_diffs) <> 'array' OR jsonb_array_length(p_diffs) = 0 THEN
    RAISE EXCEPTION 'commit_scenario_batch: p_diffs must be a non-empty jsonb array'
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  -- (3) Iterate diffs in a single tx scope. Any RAISE EXCEPTION rolls back
  --     the entire batch (Postgres functions in plpgsql run inside the caller's
  --     transaction; an unhandled EXCEPTION propagates and rolls back).
  FOR v_diff IN SELECT * FROM jsonb_array_elements(p_diffs) LOOP
    v_kind := v_diff->>'kind';

    -- ----------------------------------------------------------------------
    IF v_kind = 'voluntary_remove' THEN
    -- ----------------------------------------------------------------------
      -- Ownership probe: parse the diff's holding_ref ('holding:{venue}:{symbol}:{type}')
      -- via parse_holding_ref (migration 073) and JOIN against allocator_holdings on
      -- the (venue, symbol, holding_type) tuple. The most-recent asof row's allocator_id
      -- proves ownership. Phase 06+08+09 keep allocator_holdings.{venue, symbol, holding_type}
      -- as the canonical scope columns; there is no scope_ref column on this table.
      SELECT COUNT(*) INTO v_holding_owner_ct
        FROM allocator_holdings ah
        JOIN LATERAL public.parse_holding_ref(v_diff->>'holding_ref') hp ON TRUE
       WHERE ah.allocator_id = p_allocator_id
         AND ah.venue = hp.venue
         AND ah.symbol = hp.symbol
         AND ah.holding_type = hp.holding_type;
      IF v_holding_owner_ct = 0 THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: holding_ref % not owned by allocator',
                        v_index, v_diff->>'holding_ref'
          USING ERRCODE = '42501';
      END IF;

      INSERT INTO match_decisions (
        allocator_id, strategy_id, decision, decided_by,
        original_strategy_id, original_holding_ref, kind
      )
      VALUES (
        p_allocator_id, NULL, 'snoozed', p_allocator_id,
        NULL, v_diff->>'holding_ref', 'voluntary_remove'
      )
      RETURNING id INTO v_md_id;

      INSERT INTO bridge_outcomes (
        allocator_id, match_decision_id, strategy_id,
        kind, rejection_reason
      )
      VALUES (
        p_allocator_id, v_md_id, NULL,
        'rejected', v_diff->>'rejection_reason'
      )
      RETURNING id INTO v_bo_id;

    -- ----------------------------------------------------------------------
    ELSIF v_kind = 'voluntary_add' THEN
    -- ----------------------------------------------------------------------
      SELECT status INTO v_strategy_status
        FROM strategies WHERE id = (v_diff->>'strategy_id')::uuid;
      IF v_strategy_status IS NULL OR v_strategy_status <> 'published' THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: strategy % not found or not published',
                        v_index, v_diff->>'strategy_id'
          USING ERRCODE = '23514';  -- check_violation
      END IF;

      INSERT INTO match_decisions (
        allocator_id, strategy_id, decision, decided_by,
        original_strategy_id, original_holding_ref, kind
      )
      VALUES (
        p_allocator_id, (v_diff->>'strategy_id')::uuid, 'snoozed', p_allocator_id,
        NULL, NULL, 'voluntary_add'
      )
      RETURNING id INTO v_md_id;

      INSERT INTO bridge_outcomes (
        allocator_id, match_decision_id, strategy_id,
        kind, percent_allocated, allocated_at
      )
      VALUES (
        p_allocator_id, v_md_id, (v_diff->>'strategy_id')::uuid,
        'allocated',
        (v_diff->>'percent_allocated')::numeric,
        COALESCE((v_diff->>'effective_date')::date, CURRENT_DATE)
      )
      RETURNING id INTO v_bo_id;

    -- ----------------------------------------------------------------------
    ELSIF v_kind = 'voluntary_modify' THEN
    -- ----------------------------------------------------------------------
      -- Ownership probe: parse the diff's holding_ref ('holding:{venue}:{symbol}:{type}')
      -- via parse_holding_ref (migration 073) and JOIN against allocator_holdings on
      -- the (venue, symbol, holding_type) tuple. The most-recent asof row's allocator_id
      -- proves ownership. Phase 06+08+09 keep allocator_holdings.{venue, symbol, holding_type}
      -- as the canonical scope columns; there is no scope_ref column on this table.
      SELECT COUNT(*) INTO v_holding_owner_ct
        FROM allocator_holdings ah
        JOIN LATERAL public.parse_holding_ref(v_diff->>'holding_ref') hp ON TRUE
       WHERE ah.allocator_id = p_allocator_id
         AND ah.venue = hp.venue
         AND ah.symbol = hp.symbol
         AND ah.holding_type = hp.holding_type;
      IF v_holding_owner_ct = 0 THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: holding_ref % not owned by allocator',
                        v_index, v_diff->>'holding_ref'
          USING ERRCODE = '42501';
      END IF;

      INSERT INTO match_decisions (
        allocator_id, strategy_id, decision, decided_by,
        original_strategy_id, original_holding_ref, kind
      )
      VALUES (
        p_allocator_id, NULL, 'snoozed', p_allocator_id,
        NULL, v_diff->>'holding_ref', 'voluntary_modify'
      )
      RETURNING id INTO v_md_id;

      INSERT INTO bridge_outcomes (
        allocator_id, match_decision_id, strategy_id,
        kind, percent_allocated, allocated_at
      )
      VALUES (
        p_allocator_id, v_md_id, NULL,
        'allocated',
        COALESCE((v_diff->>'percent_allocated')::numeric,
                 (v_diff->>'new_weight')::numeric * 100),
        COALESCE((v_diff->>'effective_date')::date, CURRENT_DATE)
      )
      RETURNING id INTO v_bo_id;

    -- ----------------------------------------------------------------------
    ELSIF v_kind = 'bridge_recommended' THEN
    -- ----------------------------------------------------------------------
      SELECT status INTO v_strategy_status
        FROM strategies WHERE id = (v_diff->>'strategy_id')::uuid;
      IF v_strategy_status IS NULL OR v_strategy_status <> 'published' THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: strategy % not found or not published',
                        v_index, v_diff->>'strategy_id'
          USING ERRCODE = '23514';
      END IF;

      -- Ownership probe: parse the diff's holding_ref ('holding:{venue}:{symbol}:{type}')
      -- via parse_holding_ref (migration 073) and JOIN against allocator_holdings on
      -- the (venue, symbol, holding_type) tuple. The most-recent asof row's allocator_id
      -- proves ownership. Phase 06+08+09 keep allocator_holdings.{venue, symbol, holding_type}
      -- as the canonical scope columns; there is no scope_ref column on this table.
      SELECT COUNT(*) INTO v_holding_owner_ct
        FROM allocator_holdings ah
        JOIN LATERAL public.parse_holding_ref(v_diff->>'holding_ref') hp ON TRUE
       WHERE ah.allocator_id = p_allocator_id
         AND ah.venue = hp.venue
         AND ah.symbol = hp.symbol
         AND ah.holding_type = hp.holding_type;
      IF v_holding_owner_ct = 0 THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: holding_ref % not owned by allocator',
                        v_index, v_diff->>'holding_ref'
          USING ERRCODE = '42501';
      END IF;

      -- M7 — reuse-or-create. SELECT existing match_decision for the natural
      -- per-recommendation tuple. This avoids the migration-074 widened unique
      -- (allocator_id, strategy_id, COALESCE(original_holding_ref, '')) WHERE
      -- decision='thumbs_up' index from rejecting a re-commit of the same
      -- recommendation.
      SELECT id INTO v_existing_md_id
        FROM match_decisions
       WHERE allocator_id = p_allocator_id
         AND original_holding_ref = v_diff->>'holding_ref'
         AND strategy_id = (v_diff->>'strategy_id')::uuid
         AND kind = 'bridge_recommended'
       LIMIT 1;

      IF v_existing_md_id IS NOT NULL THEN
        v_md_id := v_existing_md_id;
      ELSE
        INSERT INTO match_decisions (
          allocator_id, strategy_id, decision, decided_by,
          original_strategy_id, original_holding_ref, kind
        )
        VALUES (
          p_allocator_id, (v_diff->>'strategy_id')::uuid,
          'thumbs_up', p_allocator_id,
          NULL, v_diff->>'holding_ref', 'bridge_recommended'
        )
        RETURNING id INTO v_md_id;
      END IF;

      INSERT INTO bridge_outcomes (
        allocator_id, match_decision_id, strategy_id,
        kind, percent_allocated, allocated_at
      )
      VALUES (
        p_allocator_id, v_md_id, (v_diff->>'strategy_id')::uuid,
        'allocated',
        (v_diff->>'percent_allocated')::numeric,
        COALESCE((v_diff->>'effective_date')::date, CURRENT_DATE)
      )
      RETURNING id INTO v_bo_id;

    -- ----------------------------------------------------------------------
    ELSE
    -- ----------------------------------------------------------------------
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: unknown kind %',
                      v_index, v_kind
        USING ERRCODE = '22023';
    END IF;

    v_recorded := v_recorded || jsonb_build_object(
      'index', v_index,
      'match_decision_id', v_md_id,
      'bridge_outcome_id', v_bo_id,
      'kind', v_kind
    );
    v_index := v_index + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'recorded', v_recorded);
END;
$func$;

-- REVOKE must explicitly list `anon` — Postgres CREATE defaults grant EXECUTE
-- to PUBLIC, and Supabase's `anon` role inherits separately on some configs.
REVOKE ALL ON FUNCTION public.commit_scenario_batch(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_scenario_batch(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.commit_scenario_batch IS
  'Phase 10 / SCENARIO-07 / H4 + M7. SECURITY DEFINER RPC that commits a batch '
  'of scenario diffs (voluntary_remove / voluntary_add / voluntary_modify / '
  'bridge_recommended) in a SINGLE Postgres transaction. Plan 07''s commit route '
  'delegates here. auth.uid() = p_allocator_id guard at entry; per-row ownership '
  '(allocator_holdings.scope_ref) + strategy status (strategies.status=''published'') '
  'gates inside the loop. M7 reuse-or-create for bridge_recommended avoids '
  'migration 074 unique-index violations on retry. RAISE EXCEPTION on any per-row '
  'failure rolls back the entire batch. Returns { ok: true, recorded: [...] } on '
  'success.';

-- --------------------------------------------------------------------------
-- Self-verifying DO block (6 assertions a-f)
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_secdef                 bool;
  v_search_path            text;
  v_prosrc_has_guard       int;
  v_authenticated_can      bool;
  v_anon_can               bool;
  v_public_can             bool;
BEGIN
  -- (a) Function exists + SECURITY DEFINER
  SELECT prosecdef INTO v_secdef
    FROM pg_proc WHERE proname = 'commit_scenario_batch';
  IF v_secdef IS NULL THEN
    RAISE EXCEPTION 'Migration 082 assertion (a) failed: commit_scenario_batch not installed';
  END IF;
  IF v_secdef <> true THEN
    RAISE EXCEPTION 'Migration 082 assertion (a) failed: commit_scenario_batch is not SECURITY DEFINER';
  END IF;

  -- (b) search_path is set on the function
  SELECT array_to_string(proconfig, ',') INTO v_search_path
    FROM pg_proc WHERE proname = 'commit_scenario_batch';
  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'Migration 082 assertion (b) failed: search_path not set on commit_scenario_batch (got %)', v_search_path;
  END IF;

  -- (c) auth.uid() guard string is present in the function source
  SELECT COUNT(*) INTO v_prosrc_has_guard
    FROM pg_proc
   WHERE proname = 'commit_scenario_batch'
     AND prosrc LIKE '%auth.uid() <> p_allocator_id%';
  IF v_prosrc_has_guard = 0 THEN
    RAISE EXCEPTION 'Migration 082 assertion (c) failed: auth.uid() <> p_allocator_id guard not found in commit_scenario_batch source';
  END IF;

  -- (d) authenticated has EXECUTE
  SELECT has_function_privilege('authenticated', 'public.commit_scenario_batch(uuid, jsonb)', 'EXECUTE')
    INTO v_authenticated_can;
  IF v_authenticated_can IS NOT TRUE THEN
    RAISE EXCEPTION 'Migration 082 assertion (d) failed: authenticated lacks EXECUTE on commit_scenario_batch';
  END IF;

  -- (e) anon does NOT have EXECUTE
  SELECT has_function_privilege('anon', 'public.commit_scenario_batch(uuid, jsonb)', 'EXECUTE')
    INTO v_anon_can;
  IF v_anon_can IS TRUE THEN
    RAISE EXCEPTION 'Migration 082 assertion (e) failed: anon unexpectedly has EXECUTE on commit_scenario_batch';
  END IF;

  -- (f) public role does NOT have EXECUTE
  SELECT has_function_privilege('public', 'public.commit_scenario_batch(uuid, jsonb)', 'EXECUTE')
    INTO v_public_can;
  IF v_public_can IS TRUE THEN
    RAISE EXCEPTION 'Migration 082 assertion (f) failed: public unexpectedly has EXECUTE on commit_scenario_batch';
  END IF;

  RAISE NOTICE 'phase10: commit_scenario_batch RPC installed — SECURITY DEFINER, search_path locked, auth.uid() guard, EXECUTE granted to authenticated only';
  RAISE NOTICE 'Migration 082: all 6 self-verification assertions (a-f) passed.';
END
$$;

COMMIT;
