-- Rollback for migration 20260515210400_commit_scenario_batch_high_hardening.sql
-- audit-2026-05-07 H-0974 / H-0976 / H-0977 / H-0984.
--
-- Restores the pre-forward state:
--   * Drops allocator_holdings_ownership_probe_idx.
--   * Restores the migration-131 commit_scenario_batch body — minus
--     the 50-cap and the scenario.commit audit emission, BUT keeping
--     search_path locked to (public, pg_catalog). Restoring
--     `pg_temp` in search_path would re-introduce the SECURITY DEFINER
--     search-path hijack vector that audit-A Q#4 closed; a rollback
--     of the H-0974 audit additions is not a license to re-open a
--     known security weakness. Same policy as mig 134's rollback
--     ("restoring a known-bad ACL state is not a rollback, it is a
--     regression").

BEGIN;
SET lock_timeout = '5s';

DROP INDEX IF EXISTS public.allocator_holdings_ownership_probe_idx;

DROP FUNCTION IF EXISTS public.commit_scenario_batch(uuid, jsonb, text, text);

CREATE OR REPLACE FUNCTION public.commit_scenario_batch(
  p_allocator_id uuid,
  p_diffs jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- audit-2026-05-07 Q#4 + SFT #11 (Phase B): search_path stays locked to
-- (public, pg_catalog) even on rollback. Restoring `pg_temp` would
-- silently re-open the hijack vector the forward migration closed.
SET search_path = public, pg_catalog
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
  IF v_caller IS NULL OR v_caller <> p_allocator_id THEN
    RAISE EXCEPTION 'commit_scenario_batch: unauthorized — auth.uid() <> p_allocator_id'
      USING ERRCODE = '42501';
  END IF;

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
        RETURN jsonb_build_object(
          'ok', true,
          'cached', true,
          'recorded', COALESCE(v_cached_response->'results', '[]'::jsonb)
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', false,
        'errors', jsonb_build_array(jsonb_build_object(
          'index', -1,
          'error', 'Cached response has an unknown schema_version',
          'code', 'idempotency_schema_drift'
        ))
      );
    END IF;
  END IF;

  IF jsonb_typeof(p_diffs) <> 'array' OR jsonb_array_length(p_diffs) = 0 THEN
    RAISE EXCEPTION 'commit_scenario_batch: p_diffs must be a non-empty jsonb array'
      USING ERRCODE = '22023';
  END IF;

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

COMMIT;
