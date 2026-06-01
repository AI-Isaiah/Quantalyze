-- Migration: commit_scenario_batch portfolio-fingerprint precondition
--            (audit-2026-05-07 B11 / NEW-C18-10 — optimistic concurrency)
--
-- Why this migration exists
-- -------------------------
-- NEW-C18-10 (red-team): a scenario commit submits a STALE client diff
-- snapshot with NO portfolio-version/fingerprint binding. `commitDiffs`
-- is frozen when the drawer opens and POSTed minutes later — after the
-- position cron refreshed `allocator_holdings`, or another tab/device
-- edited. The composer already computes a `fingerprintMismatch` flag
-- (scenario-state.ts computeHoldingsFingerprint) and now disables the
-- Commit button while it is true, but that gate is CLIENT-ONLY: dismissing
-- the banner re-enables the button, and a direct `supabase.rpc()` call
-- bypasses the UI entirely. The result is a lost-update — outcomes written
-- against a portfolio shape the system itself flagged as changed.
--
-- The fix is the SERVER-SIDE fence the finding prescribes: the client sends
-- the draft's holdings fingerprint; the RPC recomputes the CURRENT holdings
-- fingerprint and rejects (409) on divergence. This closes the dismiss-then-
-- commit residual AND the direct-RPC-caller path at the trust boundary.
--
-- Why a 5th parameter requires DROP + CREATE (not bare CREATE OR REPLACE)
-- ----------------------------------------------------------------------
-- A bare CREATE OR REPLACE with the new (uuid, jsonb, text, text, text)
-- signature creates a SECOND overload alongside the existing
-- (uuid, jsonb, text, text). Both have all-DEFAULT-NULL tails after
-- (uuid, jsonb), so a 2-/3-/4-arg call becomes ambiguous (42725), breaking
-- both the route's 4-named-key supabase.rpc() call and the 2-arg positional
-- PERFORMs in the SQL self-tests; and the prior migration's "exactly 1
-- overload" self-check would RAISE "got 2". This mirrors migration 131,
-- which DROPped the 2-arg form before installing the 4-arg. We DROP the
-- 4-arg and CREATE the 5-arg, then re-issue REVOKE/GRANT (DROP loses ACLs).
-- The body is the migration-20260515210400 (HIGH hardening) body verbatim
-- — its 50-diff cap, per-success scenario.commit audit emission (fail-soft),
-- mig-128 P1956/P1957 preservation, and mig-131 idempotency reservation are
-- all retained — with ONE addition: the fingerprint precondition (STEP 2b).
--
-- Collation-robust fingerprint comparison
-- ---------------------------------------
-- The client fingerprint is `sort_localeCompare({symbol}:{venue}:{holding_type})
-- .join("|")` over the latest-asof-per-(venue,symbol,holding_type) holdings,
-- WITH NO value_usd filter (computeHoldingsFingerprint never reads value_usd;
-- the ownership probe's `value_usd > 0` is correct for ownership but WRONG
-- here — copying it would false-reject sold-down holdings). JS localeCompare
-- equals NO single Postgres ORDER BY collation, so we do NOT re-derive the
-- sorted string. Instead we compare the token SET (the fingerprint is order-
-- invariant by construction): build the server token set, split the client
-- fingerprint on '|', sort BOTH with the SAME COLLATE "C", and compare arrays.
-- Equality holds iff the SETS are equal, independent of the client's
-- localeCompare order. Tokens are unique per triple on both sides (client
-- dedups by holdingScopeKey; server uses DISTINCT ON), so set == multiset.
-- The only surviving reject is the genuine OCC case (the holdings set really
-- changed) — which is the intended 409.
--
-- Idempotency
-- -----------
-- * DROP FUNCTION IF EXISTS — re-apply is a no-op once the 5-arg form is live.
-- * The fingerprint divergence path RETURNs an ok:false envelope (route maps
--   to 409) and DELETEs the fresh in-flight reservation it just inserted, so
--   a retry with the same Idempotency-Key is not wedged 'in_flight'. We do
--   NOT RAISE 23514: that code is already used by the non-published-strategy
--   gate, so a route-level 23514->409 mapping would mis-map that error.
-- * NULL p_portfolio_fingerprint => precondition skipped (backward compatible
--   with the 4-arg-era contract and the 2-arg positional self-tests).
--
-- Rollback
-- --------
-- supabase/migrations/down/20260601120000-rollback.sql DROPs the 5-arg form
-- and restores the migration-20260515210400 4-arg body.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: drop the 4-arg overload so the 5-arg form is the only one.
-- --------------------------------------------------------------------------
-- The existing covering index allocator_holdings_ownership_probe_idx
-- (allocator_id, venue, symbol, holding_type, asof DESC) from migration
-- 20260515210400 also serves the new fingerprint DISTINCT ON — no new index.
DROP FUNCTION IF EXISTS public.commit_scenario_batch(uuid, jsonb, text, text);

-- --------------------------------------------------------------------------
-- STEP 2: install the 5-arg body (20260515210400 body + STEP 2b precondition)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_scenario_batch(
  p_allocator_id uuid,
  p_diffs jsonb,
  p_idempotency_key text DEFAULT NULL,
  p_request_hash text DEFAULT NULL,
  p_portfolio_fingerprint text DEFAULT NULL
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
  -- B11 / NEW-C18-10: server- and client-side holdings fingerprint token sets.
  v_server_fp_tokens  text[];
  v_client_fp_tokens  text[];
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

  -- (3b) audit-2026-05-07 B11 / NEW-C18-10 — optimistic-concurrency
  -- precondition. When the caller supplies p_portfolio_fingerprint (the
  -- init_holdings_fingerprint the client built the scenario draft against),
  -- recompute the CURRENT holdings fingerprint server-side and reject if the
  -- SET of holding tokens diverges — the portfolio changed under the draft
  -- (position cron refreshed a snapshot, another tab/device edited) → the
  -- frozen diffs would write outcomes against a stale shape (lost-update).
  --
  -- The token format MIRRORS computeHoldingsFingerprint (scenario-state.ts):
  -- symbol-first "symbol:venue:holding_type", latest-asof-per-(venue,symbol,
  -- holding_type) to match the client dedup, and NO value_usd filter (the
  -- client fingerprint includes value_usd<=0 latest rows; the ownership
  -- probe's value_usd>0 is WRONG here). We do NOT reproduce the client's JS
  -- localeCompare sort (no Postgres collation is byte-identical to it):
  -- instead we compare the order-invariant token SET, sorting BOTH sides with
  -- the SAME COLLATE "C" so equality is set equality, collation-independent.
  -- Runs on the fresh path only (a cached replay short-circuits at (2) before
  -- here, so a network retry of an already-committed batch is not re-checked
  -- against now-changed holdings).
  IF p_portfolio_fingerprint IS NOT NULL THEN
    SELECT COALESCE(array_agg(tok ORDER BY tok COLLATE "C"), ARRAY[]::text[])
      INTO v_server_fp_tokens
      FROM (
        SELECT DISTINCT ON (ah.venue, ah.symbol, ah.holding_type)
               ah.symbol || ':' || ah.venue || ':' || ah.holding_type AS tok
          FROM allocator_holdings ah
         WHERE ah.allocator_id = p_allocator_id
         ORDER BY ah.venue, ah.symbol, ah.holding_type, ah.asof DESC
      ) latest;

    v_client_fp_tokens := COALESCE(
      (SELECT array_agg(t ORDER BY t COLLATE "C")
         FROM unnest(string_to_array(p_portfolio_fingerprint, '|')) AS t
        WHERE t <> ''),
      ARRAY[]::text[]
    );

    IF v_server_fp_tokens IS DISTINCT FROM v_client_fp_tokens THEN
      -- Roll back the fresh in-flight reservation (if any) so a retry with
      -- the same Idempotency-Key isn't wedged 'in_flight'; the commit never
      -- happened. Return an ok:false envelope the route maps to 409 (reload),
      -- mirroring the IDEM_CODES contract.
      IF p_idempotency_key IS NOT NULL THEN
        DELETE FROM scenario_commit_idempotency
         WHERE allocator_id    = p_allocator_id
           AND idempotency_key = p_idempotency_key;
      END IF;
      RETURN jsonb_build_object(
        'ok', false,
        'errors', jsonb_build_array(jsonb_build_object(
          'index', -1,
          'error', 'Portfolio holdings changed since this scenario draft was created',
          'code', 'portfolio_fingerprint_stale'
        ))
      );
    END IF;
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

  -- (5) mig 131 idempotency-cache UPDATE — replace placeholder with
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

REVOKE ALL ON FUNCTION public.commit_scenario_batch(uuid, jsonb, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_scenario_batch(uuid, jsonb, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.commit_scenario_batch IS
  'audit-2026-05-07 H-0974 / H-0976 / H-0977 + mig 131 idempotency dedup + B11 '
  'NEW-C18-10 portfolio-fingerprint precondition. SECURITY DEFINER RPC that '
  'commits a batch of <=50 scenario diffs in a single Postgres transaction. '
  'auth.uid() = p_allocator_id guard. Per-row ownership probe with asof + '
  'value_usd > 0 filter (mig 128 P1957). voluntary_modify uses single canonical '
  'percent_allocated encoding (mig 128 P1956). Idempotency-Key reservation '
  'lives in the same tx as the data inserts (mig 131). When p_portfolio_fingerprint '
  'is supplied, the CURRENT latest-asof holdings token set is recompared against it '
  '(order-invariant, COLLATE "C", no value_usd filter) and a divergence returns '
  'ok:false code=portfolio_fingerprint_stale (route -> 409). On success, emits one '
  'scenario.commit audit_log row attributed to the allocator (fail-soft).';

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_body            TEXT;
  v_body_stripped   TEXT;
  v_exists          BOOLEAN;
  v_count           INTEGER;
  v_nargs           INTEGER;
BEGIN
  -- H-0984: covering index present (reused by the fingerprint DISTINCT ON).
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'allocator_holdings'
       AND indexname = 'allocator_holdings_ownership_probe_idx'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0984 verification failed: allocator_holdings_ownership_probe_idx missing';
  END IF;

  -- The 5-arg signature is the only commit_scenario_batch overload (the
  -- 4-arg form was DROPped above so supabase-js / regprocedure resolve
  -- unambiguously).
  SELECT COUNT(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.proname = 'commit_scenario_batch';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'audit-2026-05-07 B11: expected exactly 1 commit_scenario_batch overload, got %', v_count;
  END IF;

  -- The single overload takes 5 args (uuid, jsonb, text, text, text).
  SELECT p.pronargs INTO v_nargs
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.proname = 'commit_scenario_batch';
  IF v_nargs <> 5 THEN
    RAISE EXCEPTION 'audit-2026-05-07 B11: commit_scenario_batch must take 5 args (got %)', v_nargs;
  END IF;

  -- Body shape: 50-cap + audit emission + fingerprint precondition.
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public'
     AND p.proname = 'commit_scenario_batch';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07: commit_scenario_batch not installed';
  END IF;
  -- audit-2026-05-07 Phase C red-team #7: strip SQL line-comments
  -- from the body before regex-probing for live calls.
  v_body_stripped := regexp_replace(v_body, '--[^\n]*', '', 'g');

  IF v_body_stripped NOT LIKE '%50-diff per-batch cap%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0976/H-0977 verification failed: 50-diff cap missing from body';
  END IF;
  IF v_body_stripped !~* 'PERFORM\s+public\.log_audit_event_service[^;]*''scenario\.commit''' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0974 verification failed: scenario.commit audit emission not present as a live PERFORM log_audit_event_service call';
  END IF;
  -- B11 / NEW-C18-10: the fingerprint precondition must be present as a live
  -- (non-commented) path that can emit the portfolio_fingerprint_stale code.
  IF v_body_stripped NOT LIKE '%portfolio_fingerprint_stale%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 B11 / NEW-C18-10 verification failed: portfolio_fingerprint_stale precondition missing from body';
  END IF;
  IF v_body_stripped NOT LIKE '%p_portfolio_fingerprint IS NOT NULL%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 B11 / NEW-C18-10 verification failed: p_portfolio_fingerprint guard missing from body';
  END IF;
  -- Preservation gates — mig 128 / mig 131.
  IF v_body_stripped NOT LIKE '%value_usd > 0%' THEN
    RAISE EXCEPTION 'audit-2026-05-07: commit_scenario_batch lost mig 128 P1957 value_usd guard';
  END IF;
  IF v_body LIKE '%new_weight%' THEN
    RAISE EXCEPTION 'audit-2026-05-07: commit_scenario_batch resurrected mig 128 P1956 legacy new_weight fallback';
  END IF;
  IF v_body_stripped NOT LIKE '%scenario_commit_idempotency%' THEN
    RAISE EXCEPTION 'audit-2026-05-07: commit_scenario_batch lost mig 131 idempotency reservation';
  END IF;
  -- audit-2026-05-07 R#3: re-assert PUBLIC EXECUTE absence on the 5-arg
  -- signature via the mig 134 / C-0284 helper. The REVOKE above strips
  -- any leak; this PERFORM raises insufficient_privilege if a future
  -- migration ever re-grants PUBLIC.
  PERFORM public._assert_no_public_execute(
    'public.commit_scenario_batch(uuid, jsonb, text, text, text)'
  );
END $$;

COMMIT;
