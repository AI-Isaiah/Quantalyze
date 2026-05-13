-- Migration 128: commit_scenario_batch hardening (P1956 + P1957)
-- audit-2026-05-07 Round 2 Block E Task E.1
--
-- Slot note (2026-05-13)
-- ----------------------
-- The Round-2 plan (`.planning/audit-2026-05-07/PLAN-ROUND-2-CRITICAL.md`)
-- pre-allocated this work to slot 089. Slot 089 was already claimed by
-- `089_claim_failed_retry.sql` (Phase 12 / claim_compute_jobs retry fix) by
-- the time Block E was authored. Slot 128 is the next-available slot. The
-- audit-ID anchors (P1956 / P1957) are preserved verbatim so cross-block
-- references in PLAN-ROUND-2-CRITICAL.md (Block B.3 dependency, ADR cross
-- refs) still resolve.
--
-- Two coupled CRITICAL fixes batched into a single CREATE OR REPLACE of
-- public.commit_scenario_batch(uuid, jsonb) — the same function migration
-- 083 last touched. The signature is unchanged so Plan 07's commit/route.ts
-- call site (admin.rpc('commit_scenario_batch', ...)) keeps working.
--
-- Change 1 — P1956 (CRITICAL): single percent encoding (voluntary_modify).
-- ------------------------------------------------------------------------
-- Migration 083 voluntary_modify branch encoded percent_allocated TWO ways:
--
--   COALESCE((v_diff->>'percent_allocated')::numeric,
--            (v_diff->>'new_weight')::numeric * 100)
--
-- The dual encoding let a client pass `new_weight: 50` (intended as
-- "50 percent") AND have it silently multiplied by 100 → 5000. Round-2
-- audit S14c.RT.2 observed three production diffs landing at
-- percent_allocated = 4750..5000, far outside the 0..100 valid range.
-- The fix collapses to the single canonical encoding
-- `(v_diff->>'percent_allocated')::numeric` and adds a NOT VALID-then-
-- VALIDATE CHECK constraint on bridge_outcomes.percent_allocated as a
-- defense-in-depth backstop. Block D drops the `new_weight` field from
-- the zod schema in commit/route.ts so the request side stops accepting
-- it; this migration enforces the SQL side independently.
--
-- Change 2 — P1957 (CRITICAL): asof + value_usd-filtered ownership probe.
-- -----------------------------------------------------------------------
-- All three ownership probes (voluntary_remove L106-117, voluntary_modify
-- L175-186, bridge_recommended L222-233 in migration 083) currently COUNT
-- across the FULL history of allocator_holdings — any past row at any asof
-- with any value_usd satisfies the predicate. Round-2 audit S14c.RT.3
-- noted that an allocator who divested last week (most-recent asof has
-- value_usd = 0) could still manufacture voluntary_remove / voluntary_modify
-- / bridge_recommended diffs against the now-zero holding because the
-- pre-divestment row at an earlier asof still satisfies COUNT >= 1.
--
-- The fix filters each probe to `asof = (latest asof for that
-- {allocator, venue, symbol, holding_type})` AND `value_usd > 0`. A
-- divested allocator now fails the probe.
--
-- Pattern: this migration mirrors migration 083's structure verbatim
-- (BEGIN; SET lock_timeout; CREATE OR REPLACE FUNCTION; REVOKE/GRANT;
-- COMMENT ON FUNCTION; self-verifying DO block; COMMIT). The DO block
-- preserves migration 083's a-d assertions and adds e/f/g for the new
-- invariants.
--
-- Application path: applied LIVE via Supabase Management API alongside
-- the source-of-truth file commit. Self-verifying DO block raises
-- EXCEPTION on any invariant failure → automatic rollback.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: bridge_outcomes.percent_allocated range CHECK (P1956 defense in
--         depth). NOT VALID + VALIDATE-in-same-tx pattern: the ADD
--         CONSTRAINT acquires ACCESS EXCLUSIVE briefly to flip catalog
--         state without scanning rows; VALIDATE CONSTRAINT then does the
--         scan under SHARE UPDATE EXCLUSIVE which permits concurrent
--         reads. Both run in this BEGIN/COMMIT so the migration is
--         atomic. Existing rows are scanned, but readers are not blocked
--         during the scan window. If VALIDATE fails (a stale dual-encoded
--         row sneaked through before this migration applied), the
--         wrapping transaction rolls back so the DO block at STEP 3 never
--         runs. Both ALTERs are wrapped in pg_constraint guards so a
--         re-apply (DR recovery, manual replay) no-ops instead of
--         42710-aborting before the function-replacement work runs.
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bridge_outcomes_percent_allocated_range_check'
       AND conrelid = 'public.bridge_outcomes'::regclass
  ) THEN
    ALTER TABLE bridge_outcomes
      ADD CONSTRAINT bridge_outcomes_percent_allocated_range_check
      CHECK (percent_allocated IS NULL OR (percent_allocated >= 0 AND percent_allocated <= 100))
      NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bridge_outcomes_percent_allocated_range_check'
       AND conrelid = 'public.bridge_outcomes'::regclass
       AND convalidated = false
  ) THEN
    ALTER TABLE bridge_outcomes
      VALIDATE CONSTRAINT bridge_outcomes_percent_allocated_range_check;
  END IF;
END
$$;

COMMENT ON CONSTRAINT bridge_outcomes_percent_allocated_range_check ON bridge_outcomes IS
  'Migration 128 / audit-2026-05-07 round 2 (P1956). Defense-in-depth range '
  'check on percent_allocated. The canonical write site is '
  'commit_scenario_batch, which encodes the value once (no dual COALESCE) '
  'after this migration. NULL permitted because kind=''rejected'' rows '
  'have NULL percent_allocated per migration 081.';

-- --------------------------------------------------------------------------
-- STEP 2: Replace commit_scenario_batch body with the P1956 + P1957
--         hardened logic. Signature preserved verbatim (uuid, jsonb)
--         RETURNS jsonb so Plan 07's commit/route.ts is unchanged.
-- --------------------------------------------------------------------------
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
      -- P1957: filter on latest asof + positive value_usd. A divested
      -- allocator (most-recent asof has value_usd = 0) must NOT be able
      -- to manufacture a voluntary_remove diff on a holding they no longer
      -- own.
      SELECT COUNT(*) INTO v_holding_owner_ct
        FROM allocator_holdings ah
        JOIN LATERAL public.parse_holding_ref(v_diff->>'holding_ref') hp ON TRUE
       WHERE ah.allocator_id = p_allocator_id
         AND ah.venue        = hp.venue
         AND ah.symbol       = hp.symbol
         AND ah.holding_type = hp.holding_type
         AND ah.asof = (
           SELECT MAX(asof) FROM allocator_holdings ah2
            WHERE ah2.allocator_id = p_allocator_id
              AND ah2.venue        = hp.venue
              AND ah2.symbol       = hp.symbol
              AND ah2.holding_type = hp.holding_type
         )
         AND ah.value_usd > 0;
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
          USING ERRCODE = '23514';
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
      -- P1957: latest-asof + positive value_usd ownership probe (see
      -- voluntary_remove comment above).
      SELECT COUNT(*) INTO v_holding_owner_ct
        FROM allocator_holdings ah
        JOIN LATERAL public.parse_holding_ref(v_diff->>'holding_ref') hp ON TRUE
       WHERE ah.allocator_id = p_allocator_id
         AND ah.venue        = hp.venue
         AND ah.symbol       = hp.symbol
         AND ah.holding_type = hp.holding_type
         AND ah.asof = (
           SELECT MAX(asof) FROM allocator_holdings ah2
            WHERE ah2.allocator_id = p_allocator_id
              AND ah2.venue        = hp.venue
              AND ah2.symbol       = hp.symbol
              AND ah2.holding_type = hp.holding_type
         )
         AND ah.value_usd > 0;
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

      -- P1956: single canonical percent encoding. The migration-083
      -- COALESCE((...percent_allocated)::numeric, (...new_weight)::numeric * 100)
      -- is gone. Clients MUST send percent_allocated directly. Block D's
      -- zod schema in commit/route.ts enforces the request side; the
      -- bridge_outcomes_percent_allocated_range_check CHECK constraint at
      -- STEP 1 is the defense-in-depth backstop.
      INSERT INTO bridge_outcomes (
        allocator_id, match_decision_id, strategy_id,
        kind, percent_allocated, allocated_at
      )
      VALUES (
        p_allocator_id, v_md_id, NULL,
        'allocated',
        (v_diff->>'percent_allocated')::numeric,
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

      -- P1957: latest-asof + positive value_usd ownership probe.
      SELECT COUNT(*) INTO v_holding_owner_ct
        FROM allocator_holdings ah
        JOIN LATERAL public.parse_holding_ref(v_diff->>'holding_ref') hp ON TRUE
       WHERE ah.allocator_id = p_allocator_id
         AND ah.venue        = hp.venue
         AND ah.symbol       = hp.symbol
         AND ah.holding_type = hp.holding_type
         AND ah.asof = (
           SELECT MAX(asof) FROM allocator_holdings ah2
            WHERE ah2.allocator_id = p_allocator_id
              AND ah2.venue        = hp.venue
              AND ah2.symbol       = hp.symbol
              AND ah2.holding_type = hp.holding_type
         )
         AND ah.value_usd > 0;
      IF v_holding_owner_ct = 0 THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: holding_ref % not owned by allocator',
                        v_index, v_diff->>'holding_ref'
          USING ERRCODE = '42501';
      END IF;

      -- M7 race-safe reuse-or-create. The migration-074 partial UNIQUE
      -- index `uniq_match_dec_thumbup_per_pair_holding` is on
      -- (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
      -- WHERE decision = 'thumbs_up'. ON CONFLICT can infer this index
      -- via the matching expression list + predicate. DO UPDATE (not DO
      -- NOTHING) is required so the loser of the race can read the
      -- winner's id via RETURNING — DO NOTHING returns no row when the
      -- conflict was suppressed.
      INSERT INTO match_decisions (
        allocator_id, strategy_id, decision, decided_by,
        original_strategy_id, original_holding_ref, kind
      )
      VALUES (
        p_allocator_id, (v_diff->>'strategy_id')::uuid,
        'thumbs_up', p_allocator_id,
        NULL, v_diff->>'holding_ref', 'bridge_recommended'
      )
      ON CONFLICT (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
        WHERE decision = 'thumbs_up'
        DO UPDATE SET decided_by = EXCLUDED.decided_by
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

-- Re-apply grants (CREATE OR REPLACE preserves them, but be explicit so
-- a future migration auditor can see the contract verbatim).
REVOKE ALL ON FUNCTION public.commit_scenario_batch(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_scenario_batch(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.commit_scenario_batch IS
  'P1956 P1957 audit-2026-05-07 round 2 (migration 128). SECURITY DEFINER '
  'RPC that commits a batch of scenario diffs (voluntary_remove / voluntary_add / '
  'voluntary_modify / bridge_recommended) in a SINGLE Postgres transaction. '
  'Plan 07''s commit route delegates here. auth.uid() = p_allocator_id guard at '
  'function entry; per-row ownership probe (allocator_holdings filtered to the '
  'LATEST asof AND value_usd > 0 — P1957) + strategy status '
  '(strategies.status=''published'') gates inside the loop. voluntary_modify '
  'uses single canonical percent_allocated encoding (no new_weight fallback — '
  'P1956); range enforced by bridge_outcomes_percent_allocated_range_check '
  'CHECK. M7 reuse-or-create for bridge_recommended uses INSERT ... ON CONFLICT '
  '... DO UPDATE targeting uniq_match_dec_thumbup_per_pair_holding (race-safe '
  'per migration 083). RAISE EXCEPTION on any per-row failure rolls back the '
  'entire batch. Returns { ok: true, recorded: [...] } on success.';

-- --------------------------------------------------------------------------
-- STEP 3: Self-verifying DO block.
--
-- Preserves migration 083's a-d assertions verbatim AND adds (e) (f) (g)
-- for the P1956 + P1957 invariants this migration establishes. All
-- assertions use schema+arg-qualified pg_proc lookups via regprocedure
-- form (migration 083's P1 hardening pattern).
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_secdef                 bool;
  v_search_path            text;
  v_prosrc                 text;
  v_authenticated_can      bool;
  v_partial_index_present  bool;
  v_check_present          bool;
  v_check_valid            bool;
BEGIN
  -- (a) Function is the active SECURITY DEFINER body — pg_proc lookup
  --     pinned via regprocedure form (mig 083 P1 hardening).
  SELECT prosecdef INTO v_secdef
    FROM pg_proc
   WHERE oid = 'public.commit_scenario_batch(uuid,jsonb)'::regprocedure;
  IF v_secdef IS NULL THEN
    RAISE EXCEPTION 'Migration 128 assertion (a) failed: public.commit_scenario_batch(uuid,jsonb) not installed';
  END IF;
  IF v_secdef <> true THEN
    RAISE EXCEPTION 'Migration 128 assertion (a) failed: commit_scenario_batch is not SECURITY DEFINER';
  END IF;

  -- (b) search_path still set; auth.uid() guard still present in source;
  --     race-safe ON CONFLICT path lands in the new body.
  SELECT array_to_string(proconfig, ',') INTO v_search_path
    FROM pg_proc
   WHERE oid = 'public.commit_scenario_batch(uuid,jsonb)'::regprocedure;
  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'Migration 128 assertion (b) failed: search_path not set on commit_scenario_batch (got %)', v_search_path;
  END IF;

  SELECT prosrc INTO v_prosrc
    FROM pg_proc
   WHERE oid = 'public.commit_scenario_batch(uuid,jsonb)'::regprocedure;
  IF v_prosrc IS NULL OR v_prosrc NOT LIKE '%auth.uid() <> p_allocator_id%' THEN
    RAISE EXCEPTION 'Migration 128 assertion (b) failed: auth.uid() guard string missing from prosrc';
  END IF;
  IF v_prosrc NOT LIKE '%ON CONFLICT%' THEN
    RAISE EXCEPTION 'Migration 128 assertion (b) failed: race-safe ON CONFLICT path not present in prosrc';
  END IF;

  -- (c) authenticated still has EXECUTE.
  SELECT has_function_privilege('authenticated', 'public.commit_scenario_batch(uuid, jsonb)', 'EXECUTE')
    INTO v_authenticated_can;
  IF v_authenticated_can IS NOT TRUE THEN
    RAISE EXCEPTION 'Migration 128 assertion (c) failed: authenticated lacks EXECUTE on commit_scenario_batch';
  END IF;

  -- (d) bridge_outcomes_legacy_per_strategy_holding_when_md_null partial
  --     UNIQUE index from migration 083 still present.
  SELECT EXISTS (
    SELECT 1
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'bridge_outcomes'
       AND indexname = 'bridge_outcomes_legacy_per_strategy_holding_when_md_null'
  ) INTO v_partial_index_present;
  IF NOT v_partial_index_present THEN
    RAISE EXCEPTION 'Migration 128 assertion (d) failed: bridge_outcomes_legacy_per_strategy_holding_when_md_null index missing';
  END IF;

  -- (e) P1957: prosrc contains the value_usd > 0 guard (asof+value_usd
  --     ownership probe shape landed in all three branches).
  IF v_prosrc NOT LIKE '%value_usd > 0%' THEN
    RAISE EXCEPTION 'Migration 128 assertion (e) failed: P1957 value_usd > 0 guard missing from prosrc';
  END IF;

  -- (f) P1956: prosrc does NOT contain the legacy new_weight fallback
  --     expression. The dual-encoding COALESCE is gone.
  IF v_prosrc LIKE '%new_weight%' THEN
    RAISE EXCEPTION 'Migration 128 assertion (f) failed: P1956 legacy new_weight fallback still present in prosrc';
  END IF;

  -- (g) P1956: bridge_outcomes_percent_allocated_range_check CHECK
  --     constraint is present AND validated.
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class      t ON t.oid = c.conrelid
      JOIN pg_namespace  n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'bridge_outcomes'
       AND c.conname = 'bridge_outcomes_percent_allocated_range_check'
  ) INTO v_check_present;
  IF NOT v_check_present THEN
    RAISE EXCEPTION 'Migration 128 assertion (g) failed: bridge_outcomes_percent_allocated_range_check constraint missing';
  END IF;

  SELECT c.convalidated INTO v_check_valid
    FROM pg_constraint c
    JOIN pg_class      t ON t.oid = c.conrelid
    JOIN pg_namespace  n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'bridge_outcomes'
     AND c.conname = 'bridge_outcomes_percent_allocated_range_check';
  IF v_check_valid IS NOT TRUE THEN
    RAISE EXCEPTION 'Migration 128 assertion (g) failed: bridge_outcomes_percent_allocated_range_check is not VALIDATED';
  END IF;

  RAISE NOTICE 'Migration 128: commit_scenario_batch P1956 + P1957 hardening installed';
  RAISE NOTICE 'Migration 128: all 7 self-verification assertions (a-g) passed.';
END
$$;

COMMIT;
