-- Migration: commit_scenario_batch fingerprint recompute reads the holdings set
--            the client fingerprinted (Phase 167.1.2 review C4 SFH-R2-01)
--
-- Why this migration exists
-- -------------------------
-- The B11 / NEW-C18-10 precondition (20260601120000) compares the draft's
-- holdings fingerprint with a server recompute of the CURRENT holdings token
-- set. The two must be built from the same rows, or the check refuses a draft
-- that is not stale.
--
-- Phase 167.1.2 D-16 changed which rows the client reads. `holdingsSummary`
-- now comes from fetchLatestHoldingsPerKey (src/lib/latest-holdings-per-key.ts):
-- each key's rows at that key's own latest asof, one reading per exchange
-- account (review C4 SFH-C4-01), and nothing from a key whose newest clean poll
-- read it after its rows (SFH-C4-02). The server kept the newest row per
-- (venue, symbol, holding_type) over EVERY date. persist only upserts, so a
-- position closed on an earlier day keeps its last row forever: it stayed in
-- the server set and left the client's. Every book-mode commit of an allocator
-- with one closed position returned portfolio_fingerprint_stale, the route
-- turned it into a 409 "Refresh to load the latest holdings", and a refresh
-- rebuilt the same client set. SFH-R2-01, the 151 CR-01 class ("a remedy copy
-- no refresh can satisfy") in book mode.
--
-- The fix is on the SERVER side: step (3b) now computes the reader's set. The
-- client fingerprint cannot move to the server's old rule. That rule needs
-- the all-dates read D-16 removed, and it cannot see a close.
-- A route-side recompute was also rejected. It would run before the RPC's
-- idempotency step, so a replay of an already-committed batch would 409 after
-- a poll. It would also move the check out of the transaction. See the
-- step (3b) comment for the rule, step by step.
--
-- What changes for a real holdings change: the check now also refuses a draft
-- listing a position that has CLOSED since (the old all-dates set never lost a
-- triple, so it could only see an open). Nothing else in the function changes:
-- (1) the auth.uid() guard, (2) the idempotency reservation, (3) the 50-diff
-- cap, the per-diff ownership probes, the published-strategy gates, the
-- inserts and the audit emission are the 20260601120000 body verbatim.
--
-- Signature and ACL
-- -----------------
-- Same 5-arg signature, so CREATE OR REPLACE (no DROP): the function keeps its
-- OID and its ACL (EXECUTE to authenticated and service_role, none to PUBLIC or
-- anon). The REVOKE / GRANT pair of 20260601120000 is re-issued anyway so the
-- ACL is stated where the body is, and the self-check re-asserts no PUBLIC
-- EXECUTE through _assert_no_public_execute.
--
-- TEST safety
-- -----------
-- The DO block reads only the catalog (the function's body and overload
-- count), never table data, so it applies the same way on PROD and on the
-- empty TEST database.
--
-- Rollback
-- --------
-- supabase/migrations/down/20260929120000-rollback.sql restores the
-- 20260601120000 body (all-dates recompute).

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: re-install the 5-arg body with the reader-set recompute in (3b)
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
  -- Phase 167.1.2 review C4 SFH-R2-01: "current holdings" is the set the
  -- client fingerprinted, which is `holdingsSummary` as
  -- fetchLatestHoldingsPerKey (src/lib/latest-holdings-per-key.ts) reads it.
  -- The server used to take the newest row per triple over EVERY date, so a
  -- position closed on an earlier day stayed in its set and was missing from
  -- the client's, and every book-mode commit of such an allocator returned
  -- portfolio_fingerprint_stale, which no refresh cleared. The CTE below is
  -- that reader's rule, step for step:
  --   1. the owner's keys, departed ones included;
  --   2. per key, its latest asof, and its newest audit event
  --      'allocator.holdings.sync_completed' with final_status 'complete'
  --      (newest by created_at DESC, NULLs first, as PostgREST orders). That
  --      event is evidence only when row_count is a non-negative whole number
  --      and asof is a YYYY-MM-DD string (cleanPollDay). When its day is
  --      STRICTLY after the key's latest rows, the key's reading is that day
  --      with no rows (SFH-C4-02); otherwise it is the latest asof with rows;
  --   3. keys grouped by exchange account (accountIdentityTokens, the D-09
  --      identity: a shared non-blank venue_account_id on one exchange, or an
  --      account_shared_with_api_key_id marker of a shared kind, joined
  --      transitively). A key with neither is its own account. Only the keys
  --      whose reading is the account's newest, and have rows on it,
  --      contribute (SFH-C4-01);
  --   4. the contributing keys' rows at their reading day, one token per
  --      (venue, symbol, holding_type).
  -- Days are compared as 'YYYY-MM-DD' text under COLLATE "C", as the reader
  -- compares strings. They are never cast to date, so a malformed day in an
  -- audit event can never raise here. Everything is scoped to p_allocator_id,
  -- which (1) proved equals auth.uid().
  --
  -- ⚠️ TWIN. This is the third copy of the rule (TypeScript reader, this, and
  -- the grain rule in plan 10's Python helper). A change to
  -- latest-holdings-per-key.ts or to accountIdentityTokens that is not made
  -- here re-opens SFH-R2-01. The gate is
  -- supabase/tests/test_commit_scenario_batch_fingerprint_precondition.sql
  -- tests 10-14.
  --
  -- The token format MIRRORS computeHoldingsFingerprint (scenario-state.ts):
  -- symbol-first "symbol:venue:holding_type", and NO value_usd filter (the
  -- client fingerprint includes value_usd<=0 rows; the ownership probe's
  -- value_usd>0 is WRONG here). We do NOT reproduce the client's JS
  -- localeCompare sort (no Postgres collation is byte-identical to it):
  -- instead we compare the order-invariant token SET, sorting BOTH sides with
  -- the SAME COLLATE "C" so equality is set equality, collation-independent.
  -- Runs on the fresh path only (a cached replay short-circuits at (2) before
  -- here, so a network retry of an already-committed batch is not re-checked
  -- against now-changed holdings).
  IF p_portfolio_fingerprint IS NOT NULL THEN
    WITH RECURSIVE
    owner_keys AS (
      SELECT k.id,
             lower(btrim(k.exchange)) AS exchange_norm,
             NULLIF(btrim(k.venue_account_id), '') AS venue_norm,
             k.account_share_kind,
             k.account_shared_with_api_key_id
        FROM api_keys k
       WHERE k.user_id = p_allocator_id
    ),
    account_edges AS (
      -- one exchange account id on one exchange
      SELECT a.id AS a, b.id AS b
        FROM owner_keys a
        JOIN owner_keys b
          ON b.exchange_norm = a.exchange_norm
         AND b.venue_norm    = a.venue_norm
         AND b.id           <> a.id
      UNION
      -- a shared-account marker naming another key of this owner, both ways
      SELECT m.id, m.account_shared_with_api_key_id
        FROM owner_keys m
       WHERE m.account_share_kind IN ('duplicate', 'composite_member')
         AND m.account_shared_with_api_key_id <> m.id
         AND m.account_shared_with_api_key_id IN (SELECT id FROM owner_keys)
      UNION
      SELECT m.account_shared_with_api_key_id, m.id
        FROM owner_keys m
       WHERE m.account_share_kind IN ('duplicate', 'composite_member')
         AND m.account_shared_with_api_key_id <> m.id
         AND m.account_shared_with_api_key_id IN (SELECT id FROM owner_keys)
    ),
    known_account AS (
      SELECT id FROM owner_keys WHERE venue_norm IS NOT NULL
      UNION
      SELECT a FROM account_edges
    ),
    reach (root, node) AS (
      SELECT id, id FROM known_account
      UNION
      SELECT r.root, e.b
        FROM reach r
        JOIN account_edges e ON e.a = r.node
    ),
    key_account AS (
      SELECT k.id,
             COALESCE(
               (SELECT 'account:' || min(r.root::text COLLATE "C")
                  FROM reach r
                 WHERE r.node = k.id),
               'key:' || k.id::text
             ) AS account
        FROM owner_keys k
    ),
    key_evidence AS (
      SELECT k.id,
             (SELECT max(h.asof)
                FROM allocator_holdings h
               WHERE h.allocator_id = p_allocator_id
                 AND h.api_key_id   = k.id) AS latest_asof,
             (SELECT al.metadata
                FROM audit_log al
               WHERE al.user_id     = p_allocator_id
                 AND al.action      = 'allocator.holdings.sync_completed'
                 AND al.entity_type = 'api_key'
                 AND al.entity_id   = k.id
                 AND al.metadata->>'final_status' = 'complete'
               ORDER BY al.created_at DESC
               LIMIT 1) AS poll_meta
        FROM owner_keys k
    ),
    key_poll AS (
      SELECT e.id,
             e.latest_asof,
             to_char(e.latest_asof, 'YYYY-MM-DD') AS latest_day,
             -- cleanPollDay. CASE arms run in order, so the numeric cast only
             -- ever sees a JSON number.
             CASE
               WHEN e.poll_meta IS NULL THEN NULL
               WHEN jsonb_typeof(e.poll_meta) <> 'object' THEN NULL
               WHEN jsonb_typeof(e.poll_meta->'row_count') IS DISTINCT FROM 'number' THEN NULL
               WHEN (e.poll_meta->>'row_count')::numeric < 0 THEN NULL
               WHEN (e.poll_meta->>'row_count')::numeric
                    <> trunc((e.poll_meta->>'row_count')::numeric) THEN NULL
               WHEN jsonb_typeof(e.poll_meta->'asof') IS DISTINCT FROM 'string' THEN NULL
               WHEN (e.poll_meta->>'asof') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN NULL
               ELSE e.poll_meta->>'asof'
             END AS poll_day
        FROM key_evidence e
    ),
    key_reading AS (
      SELECT p.id,
             p.latest_asof,
             (p.poll_day IS NOT NULL
              AND (p.latest_day IS NULL
                   OR p.poll_day COLLATE "C" > p.latest_day COLLATE "C")) AS polled_after_rows
        FROM key_poll p
    ),
    key_day AS (
      SELECT r.id,
             r.latest_asof,
             NOT r.polled_after_rows AS has_rows,
             CASE WHEN r.polled_after_rows THEN p.poll_day ELSE p.latest_day END AS day
        FROM key_reading r
        JOIN key_poll p ON p.id = r.id
    ),
    account_newest AS (
      SELECT a.account, max(d.day COLLATE "C") AS day
        FROM key_day d
        JOIN key_account a ON a.id = d.id
       WHERE d.day IS NOT NULL
       GROUP BY a.account
    ),
    contributing AS (
      SELECT d.id, d.latest_asof
        FROM key_day d
        JOIN key_account a    ON a.id = d.id
        JOIN account_newest n ON n.account = a.account
                             AND n.day COLLATE "C" = d.day COLLATE "C"
       WHERE d.has_rows
    )
    SELECT COALESCE(array_agg(latest.tok ORDER BY latest.tok COLLATE "C"), ARRAY[]::text[])
      INTO v_server_fp_tokens
      FROM (
        SELECT DISTINCT ON (ah.venue, ah.symbol, ah.holding_type)
               ah.symbol || ':' || ah.venue || ':' || ah.holding_type AS tok
          FROM allocator_holdings ah
          JOIN contributing c
            ON c.id = ah.api_key_id
           AND ah.asof = c.latest_asof
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

-- ACL: identical to 20260601120000 (CREATE OR REPLACE keeps it; re-stated here).
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
  'is supplied, the CURRENT holdings token set is recompared against it '
  '(order-invariant, COLLATE "C", no value_usd filter) and a divergence returns '
  'ok:false code=portfolio_fingerprint_stale (route -> 409). Since 20260929120000 '
  '(Phase 167.1.2 SFH-R2-01) the current set is the one the My Allocation reader '
  'shows (fetchLatestHoldingsPerKey): each key''s rows at its own latest reading, '
  'one reading per exchange account, and no rows from a key whose newer clean poll '
  'read nothing. On success, emits one scenario.commit audit_log row attributed '
  'to the allocator (fail-soft).';

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block (catalog reads only)
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_body            TEXT;
  v_body_stripped   TEXT;
  v_exists          BOOLEAN;
  v_count           INTEGER;
  v_nargs           INTEGER;
BEGIN
  -- H-0984: covering index present (the per-diff ownership probes use it).
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'allocator_holdings'
       AND indexname = 'allocator_holdings_ownership_probe_idx'
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0984 verification failed: allocator_holdings_ownership_probe_idx missing';
  END IF;

  -- The 5-arg signature is still the only commit_scenario_batch overload
  -- (20260601120000 DROPped the 4-arg form; CREATE OR REPLACE on the same
  -- signature must not have added a second one).
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
  -- Phase 167.1.2 SFH-R2-01: the recompute reads the reader's set. Each of
  -- the rule's three inputs must be live code, not a comment: the clean-poll
  -- event, the account marker, and the per-key latest asof.
  IF v_body_stripped NOT LIKE '%allocator.holdings.sync_completed%' THEN
    RAISE EXCEPTION 'Phase 167.1.2 SFH-R2-01 verification failed: fingerprint recompute does not read the clean-poll event';
  END IF;
  IF v_body_stripped NOT LIKE '%account_shared_with_api_key_id%' THEN
    RAISE EXCEPTION 'Phase 167.1.2 SFH-R2-01 verification failed: fingerprint recompute does not group keys by account';
  END IF;
  IF v_body_stripped NOT LIKE '%AND ah.asof = c.latest_asof%' THEN
    RAISE EXCEPTION 'Phase 167.1.2 SFH-R2-01 verification failed: fingerprint recompute does not read each key at its own latest asof';
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
