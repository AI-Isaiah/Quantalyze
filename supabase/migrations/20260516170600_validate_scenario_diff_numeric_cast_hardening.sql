-- audit-2026-05-07 mitigation (specialist-review apply pass take 2)
-- Closes:
--   MED-1 (code-reviewer c8 + red-team c8): three `::numeric` casts in
--     _validate_scenario_diff (mig 20260516160800 L103/L118/L144) are
--     bare casts with no protective BEGIN/EXCEPTION block. A diff with
--     `"percent_allocated": "not-a-number"` (or true / [] / {}) leaks
--     SQLSTATE 22P02 with a generic "invalid input syntax for type
--     numeric" message — the route's `if (err.code === '22023')` mapping
--     misses 22P02 and surfaces a generic 500. The helper's stated DX
--     contract ("structured 22023 with per-diff index") is broken in
--     3 of 9 cast sites.
--   MED-2 (code-reviewer c8 + security c6): _validate_scenario_diff
--     lacks `SET search_path = public, pg_catalog`. The helper has no
--     unqualified DML, but the codebase convention across 89 prior
--     migrations is to lock search_path even on plain plpgsql functions.
--
-- Source: supabase/migrations/20260516160800_commit_scenario_batch_diff_schema.sql
-- (do NOT edit that file.)
--
-- Idempotent: CREATE OR REPLACE preserves the existing GRANT to
-- authenticated/service_role (ACL is preserved across replace for the
-- same name+argtypes).

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: replace _validate_scenario_diff with numeric-cast hardening
--         and SET search_path
-- --------------------------------------------------------------------------
-- Body matches mig 20260516160800 verbatim, with two deltas:
--   (a) `SET search_path = public, pg_catalog` added (MED-2)
--   (b) each `::numeric` cast wrapped in BEGIN/EXCEPTION (MED-1)
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
    -- audit-2026-05-07 MED-1: structured 22023 on non-numeric input.
    BEGIN
      v_pct := v_pct_text::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% is not a valid numeric', p_index, v_pct_text
        USING ERRCODE = '22023';
    END;
    IF v_pct < 0 OR v_pct > 1 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,1]', p_index, v_pct
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
    -- audit-2026-05-07 MED-1: structured 22023 on non-numeric input.
    BEGIN
      v_pct := v_pct_text::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% is not a valid numeric', p_index, v_pct_text
        USING ERRCODE = '22023';
    END;
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
    v_pct_text := p_diff->>'percent_allocated';
    IF v_pct_text IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: bridge_recommended requires "percent_allocated"', p_index
        USING ERRCODE = '22023';
    END IF;
    -- audit-2026-05-07 MED-1: structured 22023 on non-numeric input.
    BEGIN
      v_pct := v_pct_text::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% is not a valid numeric', p_index, v_pct_text
        USING ERRCODE = '22023';
    END;
    IF v_pct < 0 OR v_pct > 1 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,1]', p_index, v_pct
        USING ERRCODE = '22023';
    END IF;

  ELSE
    -- Defensive: enum cast above should have caught this.
    RAISE EXCEPTION 'commit_scenario_batch[index=%]: unhandled kind=% (helper needs update)', p_index, v_kind
      USING ERRCODE = '22023';
  END IF;
END;
$fn$;

COMMENT ON FUNCTION public._validate_scenario_diff(jsonb, int) IS
  'audit-2026-05-07 M-0826 + specialist-review take 2 (MED-1 numeric '
  'cast hardening + MED-2 search_path). Per-diff schema validation helper '
  'for commit_scenario_batch. Validates kind against match_decision_kind '
  'enum and per-kind required fields. ALL numeric casts wrapped in '
  'BEGIN/EXCEPTION so non-numeric input raises structured 22023 with '
  'per-diff index — preserves the DX contract end-to-end.';

-- ACL preserved across CREATE OR REPLACE; re-apply defensively.
REVOKE ALL ON FUNCTION public._validate_scenario_diff(jsonb, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._validate_scenario_diff(jsonb, int) TO authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block — smoke-test the numeric error path
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_err_code TEXT;
  v_err_msg  TEXT;
BEGIN
  -- (a) search_path set on the function
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = '_validate_scenario_diff'
     AND 'search_path=public, pg_catalog' = ANY(p.proconfig)
  ) THEN
    RAISE EXCEPTION 'audit-2026-05-07 MED-2 verification failed: _validate_scenario_diff missing SET search_path = public, pg_catalog';
  END IF;

  -- (b) MED-1: non-numeric percent_allocated raises 22023 (not 22P02)
  BEGIN
    PERFORM public._validate_scenario_diff(
      jsonb_build_object(
        'kind', 'voluntary_add',
        'strategy_id', '00000000-0000-0000-0000-000000000000',
        'percent_allocated', 'not-a-number'
      ),
      0
    );
    RAISE EXCEPTION 'audit-2026-05-07 MED-1 verification failed: non-numeric percent_allocated did not raise';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
      IF v_err_msg !~ '\[index=0\]' THEN
        RAISE EXCEPTION 'audit-2026-05-07 MED-1 verification failed: numeric cast 22023 raised but message lacks per-diff index annotation (got: %)', v_err_msg;
      END IF;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err_code = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
      RAISE EXCEPTION 'audit-2026-05-07 MED-1 verification failed: numeric cast leaked sqlstate=% (expected 22023), msg=%', v_err_code, v_err_msg;
  END;
END $$;

COMMIT;
