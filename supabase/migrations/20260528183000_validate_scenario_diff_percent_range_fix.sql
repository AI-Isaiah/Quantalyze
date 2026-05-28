-- audit-2026-05-07 B9 (NEW-C18-02 / NEW-C18-03) — _validate_scenario_diff
-- percent_allocated range reconciliation.
--
-- Background.
--   `bridge_outcomes.percent_allocated` is canonically encoded as
--   percent-as-integer in [0, 100] (column-level CHECK installed by mig
--   20260514045553; route-side Zod accepts [0, 100] in
--   src/app/api/allocator/scenario/commit/route.ts:105/125/135). The
--   `commit_scenario_batch` INSERT path casts `v_diff->>'percent_allocated'`
--   directly to NUMERIC and inserts it without scaling.
--
--   `_validate_scenario_diff` was installed by mig 20260516160800 and last
--   rewritten by mig 20260516170600 with stale [0, 1] range gates in three
--   places (voluntary_add L99, voluntary_modify L121, bridge_recommended
--   L154). The function is presently dead code — `commit_scenario_batch`
--   does NOT call it; only the post-migration smoke DO blocks call it
--   — so the range mismatch is currently latent. But the moment a future
--   PR follows the documented intent and wires the validator into the
--   per-diff loop (CROSS-CUTTING-REFACTOR-PLAN.md B9 / NEW-C18-03), every
--   legitimate request encoding `percent_allocated=50` would raise 22023
--   "percent_allocated=50 out of range [0,1]" and the surface would 500.
--
-- This migration replaces `_validate_scenario_diff` with the same body
-- but the percent guards updated to [0, 100] to match the actual column
-- + route + commit_scenario_batch encoding. The function stays STABLE,
-- SET search_path, and the per-cast BEGIN/EXCEPTION wrappers preserved
-- verbatim from mig 20260516170600. No GRANT or REVOKE changes — the
-- ACL trail is unchanged.
--
-- Effect on production: ZERO behaviour change today (function is
-- not on the hot path). Removes a documented stale range claim so the
-- function is safely callable when a future PR wires it up.

SET LOCAL search_path = public, pg_catalog;

-- --------------------------------------------------------------------------
-- STEP 1: replace _validate_scenario_diff with corrected percent range.
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._validate_scenario_diff(
  p_diff jsonb,
  p_index int
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_kind   text;
  v_pct    numeric;
  v_strat  text;
  v_pct_text text;
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
    v_pct_text := p_diff->>'percent_allocated';
    IF v_pct_text IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_add requires "percent_allocated"', p_index
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_pct := v_pct_text::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% is not a valid numeric', p_index, v_pct_text
        USING ERRCODE = '22023';
    END;
    -- audit-2026-05-07 B9 (NEW-C18-02/-03): canonical range [0, 100]
    -- matching bridge_outcomes_percent_allocated_range_check
    -- (mig 20260514045553) and route Zod in scenario/commit/route.ts.
    IF v_pct < 0 OR v_pct > 100 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,100]', p_index, v_pct
        USING ERRCODE = '22023';
    END IF;

  ELSIF v_kind = 'voluntary_modify' THEN
    IF p_diff->>'holding_ref' IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_modify requires "holding_ref"', p_index
        USING ERRCODE = '22023';
    END IF;
    v_pct_text := p_diff->>'percent_allocated';
    IF v_pct_text IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_modify requires "percent_allocated"', p_index
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_pct := v_pct_text::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% is not a valid numeric', p_index, v_pct_text
        USING ERRCODE = '22023';
    END;
    IF v_pct < 0 OR v_pct > 100 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,100]', p_index, v_pct
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
    v_pct_text := p_diff->>'percent_allocated';
    IF v_pct_text IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: bridge_recommended requires "percent_allocated"', p_index
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      v_pct := v_pct_text::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% is not a valid numeric', p_index, v_pct_text
        USING ERRCODE = '22023';
    END;
    IF v_pct < 0 OR v_pct > 100 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,100]', p_index, v_pct
        USING ERRCODE = '22023';
    END IF;

  ELSE
    -- Defensive: enum cast above should have caught this.
    RAISE EXCEPTION 'commit_scenario_batch[index=%]: unhandled kind=%', p_index, v_kind
      USING ERRCODE = '22023';
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public._validate_scenario_diff(jsonb, int) IS
  'Per-diff validator for commit_scenario_batch. Raises 22023 with a '
  'commit_scenario_batch[index=N]: <reason> message. audit-2026-05-07 B9 '
  '(NEW-C18-02/-03) — percent ranges reconciled to [0, 100] matching '
  'bridge_outcomes_percent_allocated_range_check + route Zod. The prior '
  '[0, 1] guard was stale latent code that would have 500ed every '
  'legitimate request the moment the helper was wired into '
  'commit_scenario_batch.';

REVOKE ALL ON FUNCTION public._validate_scenario_diff(jsonb, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._validate_scenario_diff(jsonb, int) TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 2: verification — smoke-probe the new range gates.
-- --------------------------------------------------------------------------

DO $verify$
DECLARE
  v_caught BOOLEAN := false;
BEGIN
  -- A: 50 is now accepted by all three pct-bearing branches.
  PERFORM public._validate_scenario_diff(
    jsonb_build_object(
      'kind', 'voluntary_add',
      'strategy_id', '11111111-1111-1111-1111-111111111111',
      'percent_allocated', 50
    ),
    0
  );

  PERFORM public._validate_scenario_diff(
    jsonb_build_object(
      'kind', 'voluntary_modify',
      'holding_ref', 'okx:spot:BTC-USDT:spot',
      'percent_allocated', 50
    ),
    0
  );

  PERFORM public._validate_scenario_diff(
    jsonb_build_object(
      'kind', 'bridge_recommended',
      'strategy_id', '11111111-1111-1111-1111-111111111111',
      'holding_ref', 'okx:spot:BTC-USDT:spot',
      'percent_allocated', 50
    ),
    0
  );

  -- B: 101 still rejected (out-of-range above 100).
  BEGIN
    PERFORM public._validate_scenario_diff(
      jsonb_build_object(
        'kind', 'voluntary_add',
        'strategy_id', '11111111-1111-1111-1111-111111111111',
        'percent_allocated', 101
      ),
      0
    );
    RAISE EXCEPTION 'B9 verification failed: percent_allocated=101 was accepted';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'B9 verification failed: out-of-range probe did not raise 22023';
  END IF;
END;
$verify$;
