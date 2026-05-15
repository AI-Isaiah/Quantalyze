-- Migration 131: commit_scenario_batch — SQL-side Idempotency-Key dedup
-- (audit-2026-05-07 round-2 Block D / F.2 root-cause fix).
--
-- The round-2-D red-team identified that the route-layer cache
-- (SELECT-then-RPC-then-UPSERT) does NOT prevent concurrent retries
-- from both invoking the RPC and double-recording match_decisions +
-- bridge_outcomes. Two clients that pass the route's SELECT before
-- either's UPSERT will both reach the RPC; the existing function has
-- no row-level dedup for voluntary_remove / voluntary_add /
-- voluntary_modify (only bridge_recommended is reuse-aware via M7).
--
-- Root-cause fix: move idempotency reservation INTO the same Postgres
-- transaction as the data inserts. INSERT ... ON CONFLICT DO NOTHING
-- on scenario_commit_idempotency acquires a row lock during conflict
-- detection, so a concurrent transaction either:
--   (a) wins the race, runs the RPC, UPDATEs the cache row with the
--       final response, COMMIT — the loser sees the COMMITted row
--       and returns the cached response without re-running the loop, OR
--   (b) sees the placeholder (schema_version=0) — the loser returns
--       a structured "in_flight" error envelope and the route maps it
--       to 409 Retry-After so the client can re-poll once the winner
--       finishes.
-- If the winner ROLLBACKs (RAISE EXCEPTION in the commit loop), the
-- placeholder is rolled back with it. The loser's next retry can
-- proceed fresh.
--
-- Signature change:
--   Old: commit_scenario_batch(p_allocator_id uuid, p_diffs jsonb)
--   New: commit_scenario_batch(p_allocator_id uuid, p_diffs jsonb,
--                              p_idempotency_key text DEFAULT NULL,
--                              p_request_hash text DEFAULT NULL)
--
-- Calls without an Idempotency-Key (the original 2-arg shape) still
-- work — the new parameters default to NULL and the reservation block
-- is skipped, preserving the exact pre-migration behaviour for that
-- code path.
--
-- Response envelope additions:
--   ok:false envelopes now carry one of three idempotency error codes
--   so the route can map them to specific HTTP statuses:
--     - 'idempotency_body_mismatch'  → HTTP 422 (RFC §2.5)
--     - 'idempotency_in_flight'      → HTTP 409 + Retry-After
--     - 'idempotency_schema_drift'   → HTTP 503 (stale cache row)
--   Existing per-row commit failures continue to RAISE EXCEPTION
--   (route sees rpcErr → HTTP 500), unchanged.
--
-- Cached replay:
--   ok:true envelopes carry an optional `cached:true` field when the
--   response was served from the dedup cache. The route does not need
--   to distinguish — the body shape is identical to a fresh commit.
--
-- Migration script structure:
--   BEGIN; SET lock_timeout; DROP old signature; CREATE new signature;
--   REVOKE / GRANT; COMMENT; self-verifying DO block; COMMIT.

BEGIN;
SET lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.commit_scenario_batch(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.commit_scenario_batch(
  p_allocator_id uuid,
  p_diffs jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
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
  v_inserted_count    int;
  v_cached_hash       text;
  v_cached_response   jsonb;
  v_cached_version    smallint;
BEGIN
  -- (1) Defence-in-depth: caller must match the p_allocator_id arg.
  IF v_caller IS NULL OR v_caller <> p_allocator_id THEN
    RAISE EXCEPTION 'commit_scenario_batch: unauthorized — auth.uid() <> p_allocator_id'
      USING ERRCODE = '42501';
  END IF;

  -- (1b) Idempotency reservation (round-2-D F.2 root-cause fix).
  --      Either we INSERT the placeholder and own the slot, OR we
  --      observe an existing row and branch on its state. Both
  --      branches run inside the same transaction as the data inserts
  --      below, so PostgreSQL's ON CONFLICT row-lock serializes
  --      concurrent retries.
  IF p_idempotency_key IS NOT NULL THEN
    IF p_request_hash IS NULL OR length(p_request_hash) <> 64 THEN
      RAISE EXCEPTION 'commit_scenario_batch: p_idempotency_key requires a 64-char p_request_hash'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO scenario_commit_idempotency (
      allocator_id, idempotency_key, request_hash, response, schema_version
    ) VALUES (
      p_allocator_id, p_idempotency_key, p_request_hash,
      jsonb_build_object('_status', 'in_flight'),
      0
    )
    ON CONFLICT (allocator_id, idempotency_key) DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    IF v_inserted_count = 0 THEN
      -- Someone else owns the slot. Inspect their row.
      SELECT request_hash, response, schema_version
        INTO v_cached_hash, v_cached_response, v_cached_version
        FROM scenario_commit_idempotency
       WHERE allocator_id    = p_allocator_id
         AND idempotency_key = p_idempotency_key;

      IF v_cached_hash <> p_request_hash THEN
        RETURN jsonb_build_object(
          'ok', false,
          'errors', jsonb_build_array(jsonb_build_object(
            'index', -1,
            'error', 'Idempotency-Key reuse with different body',
            'code', 'idempotency_body_mismatch'
          ))
        );
      END IF;

      IF v_cached_version = 0 THEN
        RETURN jsonb_build_object(
          'ok', false,
          'errors', jsonb_build_array(jsonb_build_object(
            'index', -1,
            'error', 'Idempotent commit is already in flight; retry shortly',
            'code', 'idempotency_in_flight'
          ))
        );
      END IF;

      IF v_cached_version = 1 THEN
        -- Cached replay. The stored response carries `results` (the
        -- recorded[] array); we re-build the success envelope so the
        -- route doesn't need to distinguish fresh from cached.
        RETURN jsonb_build_object(
          'ok', true,
          'cached', true,
          'recorded', COALESCE(v_cached_response->'results', '[]'::jsonb)
        );
      END IF;

      -- Unknown schema_version (future revision wrote a shape this
      -- function doesn't understand). Refuse to serve a stale row.
      RETURN jsonb_build_object(
        'ok', false,
        'errors', jsonb_build_array(jsonb_build_object(
          'index', -1,
          'error', 'Cached response has an unknown schema_version',
          'code', 'idempotency_schema_drift'
        ))
      );
    END IF;
    -- v_inserted_count = 1 ⇒ we own the slot. Fall through to the
    -- commit loop; the post-loop UPDATE replaces the placeholder.
  END IF;

  -- (2) Validate the diffs array.
  IF jsonb_typeof(p_diffs) <> 'array' OR jsonb_array_length(p_diffs) = 0 THEN
    RAISE EXCEPTION 'commit_scenario_batch: p_diffs must be a non-empty jsonb array'
      USING ERRCODE = '22023';
  END IF;

  -- (3) Iterate diffs. Any RAISE EXCEPTION rolls back the entire batch
  --     including the idempotency placeholder, so a retry can succeed.
  FOR v_diff IN SELECT * FROM jsonb_array_elements(p_diffs) LOOP
    v_kind := v_diff->>'kind';

    IF v_kind = 'voluntary_remove' THEN
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

    ELSIF v_kind = 'voluntary_add' THEN
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

    ELSIF v_kind = 'voluntary_modify' THEN
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

    ELSIF v_kind = 'bridge_recommended' THEN
      SELECT status INTO v_strategy_status
        FROM strategies WHERE id = (v_diff->>'strategy_id')::uuid;
      IF v_strategy_status IS NULL OR v_strategy_status <> 'published' THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: strategy % not found or not published',
                        v_index, v_diff->>'strategy_id'
          USING ERRCODE = '23514';
      END IF;

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

      -- M7 race-safe reuse-or-create. See migration 128 for full rationale.
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

    ELSE
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

  -- (4) Replace the in-flight placeholder with the final response so a
  --     subsequent retry with the same key+hash short-circuits to the
  --     cached envelope above. Same transaction as the data inserts —
  --     a concurrent reader who races us sees either the placeholder
  --     (and gets idempotency_in_flight) or the final row.
  IF p_idempotency_key IS NOT NULL THEN
    UPDATE scenario_commit_idempotency
       SET response = jsonb_build_object(
             'recorded', jsonb_array_length(v_recorded),
             'results', v_recorded,
             'errors', '[]'::jsonb
           ),
           schema_version = 1
     WHERE allocator_id    = p_allocator_id
       AND idempotency_key = p_idempotency_key;
  END IF;

  RETURN jsonb_build_object('ok', true, 'recorded', v_recorded);
END;
$func$;

REVOKE ALL ON FUNCTION public.commit_scenario_batch(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_scenario_batch(uuid, jsonb, text, text) TO authenticated;

COMMENT ON FUNCTION public.commit_scenario_batch IS
  'audit-2026-05-07 round-2 Block D / F.2 root-cause fix. Idempotency-Key '
  'reservation lives in the SAME transaction as the match_decisions / '
  'bridge_outcomes inserts. ON CONFLICT DO NOTHING serializes concurrent '
  'retries via PostgreSQL row-lock during conflict detection. Per-row '
  'commit failures continue to RAISE EXCEPTION (route → 500). Idempotency '
  'contract violations return structured ok:false envelopes with error '
  'codes (idempotency_body_mismatch / idempotency_in_flight / '
  'idempotency_schema_drift) that the route maps to 422 / 409 / 503.';

-- --------------------------------------------------------------------------
-- Self-verifying DO block — confirms the new 4-arg signature is the
-- one resolved by the (uuid, jsonb, text, text) call shape the route
-- uses, AND that the old 2-arg signature is gone.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT COUNT(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.proname = 'commit_scenario_batch'
     AND pg_get_function_arguments(p.oid) LIKE '%p_idempotency_key%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Migration 131: commit_scenario_batch(p_idempotency_key, p_request_hash) not installed';
  END IF;

  -- The 2-arg signature must NOT coexist with the 4-arg signature, else
  -- supabase-js will pick by argument count and route the route's call
  -- away from the idempotency-aware function.
  SELECT COUNT(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.proname = 'commit_scenario_batch'
     AND pg_get_function_arguments(p.oid) NOT LIKE '%p_idempotency_key%';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Migration 131: old 2-arg commit_scenario_batch signature still exists — DROP did not run';
  END IF;

  RAISE NOTICE 'Migration 131: commit_scenario_batch installed with SQL-side idempotency dedup';
END $$;

COMMIT;
