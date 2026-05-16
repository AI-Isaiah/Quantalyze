-- Migration: commit_scenario_batch HIGH hardening (audit-2026-05-07 H-pass on mig 082)
--
-- Audit findings addressed: H-0974, H-0976, H-0977, H-0984.
--
-- Why this migration exists
-- -------------------------
-- The audit-2026-05-07 H-pass on supabase/migrations/082_commit_scenario_batch_rpc.sql
-- identified three clusters of SQL-actionable HIGH defects (four
-- individual H-IDs) beyond what migrations 083 / 128 / 131 / 134 closed
-- in the prior remediation rounds:
--
--   * H-0974 (silent-failure-hunter c8): commit_scenario_batch emits
--     ZERO audit_log rows on success. SECURITY DEFINER RPC that
--     materially mutates user-owned data (match_decisions +
--     bridge_outcomes) and produces no audit trail. Compliance review
--     cannot reconstruct who committed which diffs without joining
--     two tables by id range. The migration-080 / D-14 contract said
--     audit_events.match.decision_record would carry voluntary diffs
--     — never wired up.
--   * H-0976 (red-team c7) + H-0977 (security c7): the route layer
--     enforces a 50-diff cap; the RPC has no internal size cap. Any
--     authenticated session can invoke supabase.rpc() directly with a
--     100k-element array, holding privileged writes against partial
--     UNIQUE indices for 60+ seconds and inflating WAL.
--   * H-0984 (performance c8): the ownership probes on allocator_holdings
--     filter on (allocator_id, venue, symbol, holding_type) plus a
--     latest-asof subquery (mig 128 P1957) plus value_usd > 0. The
--     existing unique index (allocator_id, venue, symbol, asof) covers
--     the leading 3 columns and is reused with a heap-side filter for
--     holding_type, but the per-diff parse_holding_ref LATERAL + asof
--     subquery still re-traverses the index N times per batch.
--
-- Items NOT in this migration
-- ---------------------------
--   * H-0970 (self-verifier ambiguous pg_proc): CLOSED by mig 083 STEP 3
--     (regprocedure-qualified lookups).
--   * H-0971 / H-0981 / H-0985 / H-0986 (percent_allocated encoding,
--     range, dual encoding): CLOSED by mig 128 P1956 (single canonical
--     encoding + range CHECK).
--   * H-0972 / H-0975 / H-0980 (per-call / per-batch idempotency,
--     unbounded duplicates): CLOSED by mig 131 (SQL-side Idempotency-
--     Key reservation in the same txn).
--   * H-0973 (rejection_reason whitelist CHECK): CLOSED by migration 058
--     (bridge_outcomes.rejection_reason already has CHECK against the
--     allow-list {mandate_conflict, already_owned, timing_wrong,
--     underperforming_peers, other}).
--   * H-0978 / H-0979 (ownership probe asof + value_usd): CLOSED by
--     mig 128 P1957.
--   * H-0982 (has_function_privilege('public', ...) no-op): CLOSED by
--     mig 134 _assert_no_public_execute helper.
--   * H-0983 (N round-trips per diff): performance proposal requiring
--     a set-based RPC rewrite. Defer to a separate plan.
--
-- What this migration ships
-- -------------------------
-- 1. CREATE INDEX `allocator_holdings_ownership_probe_idx` on
--    (allocator_id, venue, symbol, holding_type, asof DESC) so the
--    commit_scenario_batch ownership probe lands on a single index
--    scan per diff (vs. the current bitmap-index + heap-filter
--    pattern). The DESC on asof matches the MAX(asof) subquery's
--    natural scan direction.
-- 2. CREATE OR REPLACE commit_scenario_batch with three additions on
--    top of the migration-131 body:
--    (a) A jsonb_array_length(p_diffs) > 50 cap, raising 22023
--        (invalid_parameter_value) on overflow. Matches the route
--        layer cap so a direct supabase.rpc() call cannot bypass it.
--    (b) Per-success audit_log emission via log_audit_event_service
--        — one row tagged `scenario.commit` per successful batch,
--        attributed to p_allocator_id, with metadata carrying the
--        recorded count + idempotency_key (when provided) so the
--        forensic trail joins the route-layer audit on the same
--        correlation token.
--    (c) Fail-soft on audit emission. A failed log_audit_event_service
--        call (mig 123 role gate denial, mig 123 32 KB metadata
--        overflow) emits RAISE NOTICE but does NOT roll back the
--        commit. Missing audit is recoverable — the operator can
--        replay the emission from the route-layer correlation token —
--        but a rolled-back commit silently discards the allocator's
--        scenario submission. The commit is the durable user-visible
--        contract; audit is the secondary trail.
--    The mig 131 4-arg signature `(uuid, jsonb, text, text)` is
--    preserved verbatim. Route handlers in src/app/api/allocator/scenario/
--    commit/route.ts continue to work unchanged.
--
-- Idempotency
-- -----------
-- * CREATE INDEX IF NOT EXISTS — re-apply is a no-op.
-- * DROP + CREATE OR REPLACE on commit_scenario_batch with the same
--   4-arg signature; supabase-js continues to resolve the same arity.
-- * Fail-soft audit emission means the migration is convergent even
--   if log_audit_event_service is mid-replay.
--
-- Rollback
-- --------
-- supabase/migrations/down/20260515210400-rollback.sql restores the
-- migration-131 commit_scenario_batch body and drops the new index.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: H-0984 — covering index for the ownership probe
-- --------------------------------------------------------------------------
-- The mig 128 P1957 probe filters on (allocator_id, venue, symbol,
-- holding_type) + asof equality (via latest-asof subquery) + value_usd
-- > 0. The pre-existing unique index covers leading
-- (allocator_id, venue, symbol, asof) — the planner can use it but
-- filters holding_type + value_usd at the heap. The new composite
-- index reorders columns so all four equality predicates land on the
-- index and asof DESC matches the natural scan direction of the
-- MAX(asof) subquery (which devolves to "first row by asof DESC").
-- BTREE only; GIN/GiST not applicable to this column shape.
CREATE INDEX IF NOT EXISTS allocator_holdings_ownership_probe_idx
  ON allocator_holdings (allocator_id, venue, symbol, holding_type, asof DESC);

COMMENT ON INDEX allocator_holdings_ownership_probe_idx IS
  'audit-2026-05-07 H-0984. Covering index for commit_scenario_batch ownership probe '
  '(mig 128 P1957). Leading 4-column equality matches the probe predicate; trailing '
  'asof DESC matches the latest-asof subquery scan direction.';

-- --------------------------------------------------------------------------
-- STEP 2: replace commit_scenario_batch body
-- --------------------------------------------------------------------------
-- The mig 131 4-arg signature is preserved. Body changes:
--   * Size cap: jsonb_array_length(p_diffs) > 50 raises 22023.
--   * Per-commit audit emission: log_audit_event_service is called
--     after the loop completes successfully (and after the
--     idempotency-cache UPDATE) with action='scenario.commit',
--     entity_type='allocator', entity_id=p_allocator_id, and metadata
--     carrying the recorded count + idempotency_key (when supplied).
--
-- The mig 128 P1957 latest-asof ownership probe is preserved.
-- The mig 128 P1956 single-encoding percent_allocated is preserved.
-- The mig 131 idempotency reservation block is preserved.
--
-- audit-2026-05-07 CR #1 (Phase B): the prior DROP FUNCTION IF EXISTS
-- was cargo-culted from mig 131 (which changed the signature). Here
-- the signature is identical to mig 131's, so CREATE OR REPLACE
-- preserves ACLs and dependent objects atomically without the
-- DROP+CREATE round-trip. Removed.
CREATE OR REPLACE FUNCTION public.commit_scenario_batch(
  p_allocator_id uuid,
  p_diffs jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- audit-2026-05-07 Q#4 audit-A: search_path is locked to (public, pg_catalog)
-- to match the rest of the audit-slice SECURITY DEFINER functions
-- (enqueue_compute_job / mark_compute_job_done / sanitize_user). pg_temp
-- is excluded so a less-trusted role with pg_temp WRITE cannot hijack
-- function/operator resolution inside the privileged body.
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
  v_batch_length      int;
BEGIN
  -- (1) Defence-in-depth: caller must match the p_allocator_id arg.
  IF v_caller IS NULL OR v_caller <> p_allocator_id THEN
    RAISE EXCEPTION 'commit_scenario_batch: unauthorized — auth.uid() <> p_allocator_id'
      USING ERRCODE = '42501';
  END IF;

  -- (2) Idempotency reservation (mig 131 / Block D F.2).
  -- audit-2026-05-07 Q#6 audit-A: the (3) 50-diff cap below runs AFTER
  -- this block so a retry with the same Idempotency-Key returns the
  -- cached envelope (or idempotency_body_mismatch on hash mismatch)
  -- instead of being intercepted with a 22023 cap error. First-ever
  -- calls with oversized bodies still hit the cap and roll back the
  -- 'in_flight' reservation atomically since the cap raises before any
  -- mutating work runs.
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

  -- (3) audit-2026-05-07 H-0976 + H-0977: 50-diff cap inside the RPC
  -- mirroring the route layer's zod-enforced cap. A direct
  -- supabase.rpc('commit_scenario_batch', ...) call from an authenticated
  -- session that bypasses the Next.js route cannot DoS the RPC by
  -- pushing a 100k-element array. Fires AFTER (2) so retries can be
  -- served from the idempotency cache before payload validation can
  -- mask the cached state (audit-A Q#6).
  IF jsonb_typeof(p_diffs) <> 'array' THEN
    RAISE EXCEPTION 'commit_scenario_batch: p_diffs must be a jsonb array'
      USING ERRCODE = '22023';
  END IF;
  v_batch_length := jsonb_array_length(p_diffs);
  IF v_batch_length = 0 THEN
    RAISE EXCEPTION 'commit_scenario_batch: p_diffs must be a non-empty jsonb array'
      USING ERRCODE = '22023';
  END IF;
  IF v_batch_length > 50 THEN
    RAISE EXCEPTION 'commit_scenario_batch: p_diffs exceeds the 50-diff per-batch cap (got %). audit-2026-05-07 H-0976.', v_batch_length
      USING ERRCODE = '22023';
  END IF;

  -- (4) Iterate diffs.
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

  -- (4) mig 131 idempotency-cache UPDATE — replace placeholder with
  -- final response so the next retry short-circuits to the cached
  -- envelope.
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

  -- audit-2026-05-07 H-0974: emit one scenario.commit audit_log row
  -- per successful batch. Attribute to the allocator. Metadata carries
  -- the recorded count + idempotency_key (when supplied) so the
  -- forensic trail joins the route-layer audit on the same key.
  --
  -- Fail-soft: a log_audit_event_service failure (e.g., mig 123 32 KB
  -- ceiling, role-gate denial, partial replay) emits RAISE NOTICE but
  -- does NOT roll back the commit. The commit is the durable user-
  -- visible action; missing audit is a follow-up to investigate, not
  -- a reason to fail the allocator's scenario commit.
  --
  -- NOTE: log_audit_event_service is bound to (UUID, TEXT, TEXT, UUID,
  -- JSONB). We pass p_allocator_id as both subject (user_id) and
  -- entity_id (the scenario commit is allocator-scoped). entity_type
  -- 'allocator' matches the audit_log readers' convention for
  -- allocator-scoped actions.
  BEGIN
    PERFORM public.log_audit_event_service(
      p_allocator_id,
      'scenario.commit',
      'allocator',
      p_allocator_id,
      jsonb_build_object(
        'recorded',         jsonb_array_length(v_recorded),
        'idempotency_key',  p_idempotency_key,
        'request_hash',     p_request_hash,
        'kinds',            (
          SELECT jsonb_agg(elem->>'kind' ORDER BY (elem->>'index')::int)
            FROM jsonb_array_elements(v_recorded) AS elem
        )
      )
    );
  EXCEPTION
    WHEN unique_violation
      OR check_violation
      OR string_data_right_truncation
      OR numeric_value_out_of_range
      OR insufficient_privilege THEN
      -- Narrow trap (see Q#3 audit-A finding): swallow only audit-shape /
      -- size / role-gate failures so the scenario commit completes;
      -- schema-drift errors (42703 undefined_column / 42P01 undefined_table /
      -- 42883 undefined_function) propagate so they surface loudly instead
      -- of silently dropping the scenario.commit audit_log row.
      RAISE NOTICE 'audit-2026-05-07 H-0974: scenario.commit audit emission failed for allocator % (sqlstate=%, msg=%); commit succeeded',
        p_allocator_id, SQLSTATE, SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'recorded', v_recorded);
END;
$func$;

REVOKE ALL ON FUNCTION public.commit_scenario_batch(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_scenario_batch(uuid, jsonb, text, text) TO authenticated;

COMMENT ON FUNCTION public.commit_scenario_batch IS
  'audit-2026-05-07 H-0974 / H-0976 / H-0977 + mig 131 idempotency dedup. SECURITY '
  'DEFINER RPC that commits a batch of <=50 scenario diffs in a single Postgres '
  'transaction. auth.uid() = p_allocator_id guard. Per-row ownership probe with '
  'asof + value_usd > 0 filter (mig 128 P1957). voluntary_modify uses single '
  'canonical percent_allocated encoding (mig 128 P1956). Idempotency-Key '
  'reservation lives in the same tx as the data inserts (mig 131). On success, '
  'emits one scenario.commit audit_log row attributed to the allocator (fail-soft).';

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_body   TEXT;
  v_exists BOOLEAN;
  v_count  INTEGER;
BEGIN
  -- H-0984: covering index present
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'allocator_holdings'
       AND indexname = 'allocator_holdings_ownership_probe_idx'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0984 verification failed: allocator_holdings_ownership_probe_idx missing';
  END IF;

  -- The 4-arg signature is the only commit_scenario_batch overload
  SELECT COUNT(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.proname = 'commit_scenario_batch';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'audit-2026-05-07: expected exactly 1 commit_scenario_batch overload, got %', v_count;
  END IF;

  -- Body shape: 50-cap + audit emission
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.proname = 'commit_scenario_batch';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07: commit_scenario_batch not installed';
  END IF;
  IF v_body NOT LIKE '%50-diff per-batch cap%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0976/H-0977 verification failed: 50-diff cap missing from body';
  END IF;
  -- audit-2026-05-07 PTA #1 / SFT #6 (Phase B): match the LITERAL
  -- 'scenario.commit' string only when it appears inside a PERFORM
  -- call to log_audit_event_service. The earlier substring probe
  -- matched both the live PERFORM and the comment block above it,
  -- so a refactor that commented out the PERFORM would pass.
  IF v_body !~* 'PERFORM\s+public\.log_audit_event_service[^;]*''scenario\.commit''' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0974 verification failed: scenario.commit audit emission not present as a live PERFORM log_audit_event_service call';
  END IF;
  -- Preservation gates — mig 128 / mig 131
  IF v_body NOT LIKE '%value_usd > 0%' THEN
    RAISE EXCEPTION 'audit-2026-05-07: commit_scenario_batch lost mig 128 P1957 value_usd guard';
  END IF;
  IF v_body LIKE '%new_weight%' THEN
    RAISE EXCEPTION 'audit-2026-05-07: commit_scenario_batch resurrected mig 128 P1956 legacy new_weight fallback';
  END IF;
  IF v_body NOT LIKE '%scenario_commit_idempotency%' THEN
    RAISE EXCEPTION 'audit-2026-05-07: commit_scenario_batch lost mig 131 idempotency reservation';
  END IF;
  -- audit-2026-05-07 R#3: re-assert PUBLIC EXECUTE absence on the 4-arg
  -- signature via the mig 134 / C-0284 helper. The REVOKE above strips
  -- any leak; this PERFORM raises insufficient_privilege if a future
  -- migration ever re-grants PUBLIC.
  PERFORM public._assert_no_public_execute(
    'public.commit_scenario_batch(uuid, jsonb, text, text)'
  );
END $$;

COMMIT;
