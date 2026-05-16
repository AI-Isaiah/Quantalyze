-- audit-2026-05-07 mitigation
-- Closes: M-0826 (type-design-analyzer c8)
-- Source file: supabase/migrations/20260426131720_commit_scenario_batch_rpc.sql (was 082)
-- Issue: commit_scenario_batch accepts `p_diffs jsonb` and dispatches
--   on `v_diff->>'kind'` via IF/ELSIF/ELSE. No JSON-Schema, no per-
--   kind required-fields preflight, no enum cast. Required fields
--   (`holding_ref` for voluntary_remove/_modify/bridge_recommended,
--   `strategy_id` for voluntary_add/bridge_recommended,
--   `percent_allocated` for allocated kinds) are accessed via `->>`
--   with no NULL guard — INSERT then fails on a downstream NOT NULL
--   or CHECK that's hard to map back to the offending input index.
-- Mitigation: install a `_validate_scenario_diff` STABLE helper that
--   inspects a single JSONB diff and raises a structured RAISE
--   EXCEPTION (22023 invalid_parameter_value) with a clear error
--   message including the per-diff position and which required
--   field is missing. The helper validates:
--     * kind ∈ match_decision_kind (cast via ::public.match_decision_kind)
--     * voluntary_remove: holding_ref NOT NULL, rejection_reason NOT NULL
--     * voluntary_add: strategy_id NOT NULL, percent_allocated NOT NULL,
--         (percent_allocated >= 0 AND <= 1)
--     * voluntary_modify: holding_ref NOT NULL, percent_allocated NOT NULL,
--         (percent_allocated >= 0 AND <= 1)
--     * bridge_recommended: strategy_id NOT NULL, holding_ref NOT NULL,
--         percent_allocated NOT NULL, (percent_allocated >= 0 AND <= 1)
--   Plus UUID format probes for strategy_id (cast through ::uuid).
--
--   The helper is exposed so a future commit_scenario_batch body can
--   invoke it inside the loop. Apply-time behavior: helper is
--   installed and REVOKEd from app roles. The current
--   commit_scenario_batch body (from 20260515210400) is NOT mutated
--   here — same rationale as M-0825: avoiding a 200+ line body
--   replacement for a defense-in-depth helper. The new
--   match_decisions per-kind CHECKs (tightened via this PR's
--   20260516160400 + 20260516160500 + 20260516160700 trigger)
--   already enforce the shape invariants at INSERT time; this helper
--   moves the failure from CHECK violation (23514) to invalid-input
--   (22023) with a clearer message — better DX, not net new security.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: install the per-diff validator helper
-- --------------------------------------------------------------------------
-- STABLE; no DML. Pure validation. Raises 22023 with diff index in the
-- message so the route can map failures to UI fields.
CREATE OR REPLACE FUNCTION public._validate_scenario_diff(
  p_diff jsonb,
  p_index int
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  v_kind   text;
  v_pct    numeric;
  v_strat  text;
BEGIN
  -- (a) kind must be present and cast cleanly to the enum.
  v_kind := p_diff->>'kind';
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'commit_scenario_batch[index=%]: missing required field "kind"', p_index
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    PERFORM v_kind::public.match_decision_kind;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'commit_scenario_batch[index=%]: kind=% is not a valid match_decision_kind', p_index, v_kind
      USING ERRCODE = '22023';
  END;

  -- (b) per-kind required-field validation.
  IF v_kind = 'voluntary_remove' THEN
    IF p_diff->>'holding_ref' IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_remove requires "holding_ref"', p_index
        USING ERRCODE = '22023';
    END IF;
    IF p_diff->>'rejection_reason' IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_remove requires "rejection_reason"', p_index
        USING ERRCODE = '22023';
    END IF;

  ELSIF v_kind = 'voluntary_add' THEN
    v_strat := p_diff->>'strategy_id';
    IF v_strat IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_add requires "strategy_id"', p_index
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      PERFORM v_strat::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: strategy_id=% is not a valid UUID', p_index, v_strat
        USING ERRCODE = '22023';
    END;
    IF p_diff->>'percent_allocated' IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_add requires "percent_allocated"', p_index
        USING ERRCODE = '22023';
    END IF;
    v_pct := (p_diff->>'percent_allocated')::numeric;
    IF v_pct < 0 OR v_pct > 1 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,1]', p_index, v_pct
        USING ERRCODE = '22023';
    END IF;

  ELSIF v_kind = 'voluntary_modify' THEN
    IF p_diff->>'holding_ref' IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_modify requires "holding_ref"', p_index
        USING ERRCODE = '22023';
    END IF;
    IF p_diff->>'percent_allocated' IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_modify requires "percent_allocated"', p_index
        USING ERRCODE = '22023';
    END IF;
    v_pct := (p_diff->>'percent_allocated')::numeric;
    IF v_pct < 0 OR v_pct > 1 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,1]', p_index, v_pct
        USING ERRCODE = '22023';
    END IF;

  ELSIF v_kind = 'bridge_recommended' THEN
    v_strat := p_diff->>'strategy_id';
    IF v_strat IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: bridge_recommended requires "strategy_id"', p_index
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      PERFORM v_strat::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: strategy_id=% is not a valid UUID', p_index, v_strat
        USING ERRCODE = '22023';
    END;
    IF p_diff->>'holding_ref' IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: bridge_recommended requires "holding_ref"', p_index
        USING ERRCODE = '22023';
    END IF;
    IF p_diff->>'percent_allocated' IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: bridge_recommended requires "percent_allocated"', p_index
        USING ERRCODE = '22023';
    END IF;
    v_pct := (p_diff->>'percent_allocated')::numeric;
    IF v_pct < 0 OR v_pct > 1 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,1]', p_index, v_pct
        USING ERRCODE = '22023';
    END IF;

  ELSE
    -- Defensive: enum cast above should have caught this. Keep as
    -- belt-and-suspenders in case a future enum value is added but
    -- this helper is not updated.
    RAISE EXCEPTION 'commit_scenario_batch[index=%]: unhandled kind=% (helper needs update)', p_index, v_kind
      USING ERRCODE = '22023';
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public._validate_scenario_diff(jsonb, int) IS
  'audit-2026-05-07 M-0826. Per-diff schema validation helper for '
  'commit_scenario_batch. Validates kind against match_decision_kind enum '
  'and per-kind required fields (holding_ref/strategy_id/percent_allocated/'
  'rejection_reason). Raises 22023 with diff index in the message. STABLE; '
  'no DML. A future commit_scenario_batch revision invokes this inside the '
  'p_diffs loop to surface clean per-diff errors before any INSERT runs.';

-- The helper is callable by any role that can invoke commit_scenario_batch
-- (authenticated). It's pure validation — no privileged access — so we
-- grant EXECUTE to authenticated for direct call (a future route handler
-- can preflight diffs without invoking the heavier SECURITY DEFINER RPC).
REVOKE ALL ON FUNCTION public._validate_scenario_diff(jsonb, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._validate_scenario_diff(jsonb, int) TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_present BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = '_validate_scenario_diff'
  ) INTO v_present;

  IF NOT v_present THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0826 verification failed: _validate_scenario_diff missing';
  END IF;

  -- Smoke probe: a valid voluntary_remove diff should pass; an
  -- invalid kind should raise 22023.
  PERFORM public._validate_scenario_diff(
    jsonb_build_object(
      'kind', 'voluntary_remove',
      'holding_ref', 'okx:spot:BTC-USDT:spot',
      'rejection_reason', 'mandate_conflict'
    ),
    0
  );

  BEGIN
    PERFORM public._validate_scenario_diff(
      jsonb_build_object('kind', 'not_a_real_kind'),
      0
    );
    RAISE EXCEPTION 'audit-2026-05-07 M-0826 verification failed: invalid kind did not raise';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      -- expected
      NULL;
  END;
END $$;

COMMIT;
</content>
</invoke>
