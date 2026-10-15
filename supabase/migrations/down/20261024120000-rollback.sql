-- ============================================================================
-- ROLLBACK for 20261024120000_fan_in_graph_and_decision_cascade.sql
-- Phase 164.9.3.1 FANINGRAPH, plan 07, decisions D-01..D-08.
-- ============================================================================
-- Manual, off the auto-apply path, applied by its own migration PR after a human
-- has read the hazard below. What it restores, VERBATIM from the source files
-- named here (every body is copied from its file, never from memory):
--   * public._enqueue_compute_job_internal (10 arguments), its ACL and its
--     COMMENT: from 20260924230827_fanin_initial_status_10param.sql (the parent
--     lock goes back to a FOR SHARE statement in job-id order). The 7-argument
--     overload was never touched and is not touched here.
--   * public.mark_compute_job_done(uuid, uuid) and
--     public.mark_compute_job_failed(uuid, text, text, uuid): bodies from
--     20261009120000_sync_status_analytics_scope.sql, REVOKEs as that file
--     issued them, COMMENTs from 20261001120000_compute_job_fence_errcode_55006.sql
--     (the latest COMMENT of each). The failure cascade and the lock-then-release
--     split are gone again.
--   * public.bridge_outcomes_sync_holding_ref() and its COMMENT: from
--     20260421154029_match_decisions_original_holding_ref.sql (the sync trigger
--     stops writing former_match_decision_id).
--   * the trigger bridge_outcomes_sync_holding_ref_trigger on its OLD column list
--     (BEFORE INSERT OR UPDATE OF match_decision_id), from the same file.
--   * the unique index bridge_outcomes_legacy_per_strategy_holding_when_md_null on
--     its OLD key (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
--     WHERE match_decision_id IS NULL, from 20260426131721, and its COMMENT; the
--     re-keyed index is dropped first.
--   * the COMMENTs of public.bridge_outcomes (table) and its original_holding_ref
--     column, from 20260925071300_bridge_outcomes_invariant_comments.sql.
--   * public._fan_in_lock_rows(uuid[], boolean) is dropped (nothing else uses it
--     once the two compute-job bodies and the enqueue are restored).
--
-- What it does NOT undo, by design:
--   * The column public.bridge_outcomes.former_match_decision_id STAYS, with its
--     values and its COMMENT (a nullable column nothing reads is harmless, and
--     dropping it would destroy the record of which decision an orphan came from).
--     No row is deleted, merged or rewritten.
--   * compute_jobs rows the failure cascade already failed stay failed_final
--     (each names its failed parent in last_error). Nothing re-opens them.
--   * The ledger row: this file does not touch supabase_migrations.schema_migrations,
--     so the ledger still records version 20261024120000 as applied while the
--     bodies are the old ones. To re-apply the migration, delete that ledger row in
--     the same change (or `supabase migration repair --status reverted
--     20261024120000` against the intended database, after the marker query in
--     CLAUDE.md names that database).
--
-- ⛔ DATA HAZARD, READ BEFORE RUNNING. Re-creating the old unique index FAILS with
-- SQLSTATE 23505 once two cascade-orphaned bridge_outcomes rows share
-- (allocator_id, strategy_id, ''): the old key has no room for the decision an
-- orphan came from, and keeping those rows apart is exactly what the forward
-- migration permits (a decision delete no longer raises 23505). The whole
-- rollback runs in one transaction, so that failure rolls EVERYTHING back and
-- leaves the forward state intact; it does not leave a half-restored schema. A
-- rollback after such deletes therefore needs a data decision first (which of the
-- colliding orphan rows to keep), made by a person; this file will not make it.
--
-- The DO block at the end is catalogue-only: it RAISEs, and so aborts the whole
-- rollback, if a restored body still names the helper or the cascade, if the old
-- index or trigger shape is not back, if the helper still exists, or if anon or
-- authenticated can EXECUTE a restored compute-job function (or service_role
-- cannot execute the enqueue).
-- ============================================================================

BEGIN;

SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '3s';

-- ---------------------------------------------------------------------------
-- public._enqueue_compute_job_internal (10 arguments), from 20260924230827
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._enqueue_compute_job_internal(
  p_strategy_id     UUID,
  p_portfolio_id    UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT,
  p_parent_job_ids  UUID[],
  p_exchange        TEXT,
  p_metadata        JSONB,
  p_allocator_id    UUID DEFAULT NULL,
  p_api_key_id      UUID DEFAULT NULL,
  p_run_at          TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing_id UUID;
  v_new_id UUID;
  v_target_count INT;
  v_initial_status TEXT;
  v_parents_found  INT;
  v_parents_failed INT;
  v_parents_open   INT;
BEGIN
  -- 4-way XOR guard (CHECK mirrors this; the function raises earlier with a
  -- clearer error message — defense in depth).
  v_target_count :=
    (CASE WHEN p_strategy_id  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_portfolio_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_allocator_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_api_key_id   IS NOT NULL THEN 1 ELSE 0 END);
  IF v_target_count <> 1 THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: exactly one of p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id must be non-null (got strategy=%, portfolio=%, allocator=%, api_key=%)',
      p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_kind IS NULL THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: p_kind is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Phase 106 D3: the compute_analytics kind is retired. The registry + CHECKs
  -- still admit it (45 historical rows FK-reference it); this is an RPC-level
  -- admission reject only — no enqueue path remains.
  IF p_kind = 'compute_analytics' THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: kind compute_analytics is retired (Phase 106) — no enqueue path remains'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Phase 164.9.1 (mig 109 P12 intent, mirrored from the 7-param overload in
  -- 20260716090000): rows with parents start as done_pending_children so the
  -- fan-in advance in mark_compute_job_done holds them until a parent
  -- completes. Leaf rows (no parents) start as pending.
  --
  -- Round-1 review (silent-failure-hunter HIGH-2): the fan-in advance releases
  -- a child only when a parent is marked done AND every listed parent is
  -- 'done'. A child whose parents cannot all reach 'done' through a later
  -- mark-done would sit in done_pending_children forever, holding its
  -- (target, kind) in-flight slot, and every later enqueue for that target
  -- and kind would be handed its id. So the parents are READ here:
  --   * a NULL element, or an id with no row   -> refused, loudly;
  --   * a parent that already ended failed_final -> refused, loudly;
  --   * every parent already 'done'           -> no mark-done will ever
  --     release the child, and nothing needs to hold it: it starts pending;
  --   * otherwise a parent is still open       -> done_pending_children.
  -- The parents are locked FOR SHARE, in id order, BEFORE they are counted.
  -- mark_compute_job_done flips its parent with an UPDATE, which waits on
  -- that lock, and runs its fan-in advance as a LATER statement, which sees
  -- this child once this transaction commits. Without the lock a parent could
  -- commit 'done' between this read and the INSERT below, and its fan-in
  -- advance would miss a child it never saw.
  IF p_parent_job_ids IS NOT NULL
     AND array_length(p_parent_job_ids, 1) IS NOT NULL
     AND array_length(p_parent_job_ids, 1) > 0 THEN
    IF array_position(p_parent_job_ids, NULL) IS NOT NULL THEN
      RAISE EXCEPTION '_enqueue_compute_job_internal: p_parent_job_ids contains a NULL element; a fan-in child must name real parent jobs'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    PERFORM 1
       FROM compute_jobs pj
      WHERE pj.id = ANY(p_parent_job_ids)
      ORDER BY pj.id
      FOR SHARE;

    SELECT count(*),
           count(*) FILTER (WHERE pj.status = 'failed_final'),
           count(*) FILTER (WHERE pj.status <> 'done')
      INTO v_parents_found, v_parents_failed, v_parents_open
      FROM compute_jobs pj
     WHERE pj.id = ANY(p_parent_job_ids);

    IF v_parents_found <> cardinality(ARRAY(SELECT DISTINCT unnest(p_parent_job_ids))) THEN
      RAISE EXCEPTION '_enqueue_compute_job_internal: p_parent_job_ids names % parent job(s) with no compute_jobs row; a child of a missing parent could never be released by the fan-in advance',
        cardinality(ARRAY(SELECT DISTINCT unnest(p_parent_job_ids))) - v_parents_found
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF v_parents_failed > 0 THEN
      RAISE EXCEPTION '_enqueue_compute_job_internal: % parent job(s) in p_parent_job_ids already ended failed_final; a child of a failed parent could never be released by the fan-in advance',
        v_parents_failed
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF v_parents_open > 0 THEN
      v_initial_status := 'done_pending_children';
    ELSE
      v_initial_status := 'pending';
    END IF;
  ELSE
    v_initial_status := 'pending';
  END IF;

  -- Optimistic look-up per target type.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE portfolio_id = p_portfolio_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_allocator_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE allocator_id = p_allocator_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE api_key_id = p_api_key_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- Race-safe INSERT — the partial unique index is the final arbiter.
  INSERT INTO compute_jobs (
    strategy_id, portfolio_id, allocator_id, api_key_id,
    kind, parent_job_ids, idempotency_key, exchange, metadata,
    next_attempt_at, status
  )
  VALUES (
    p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id,
    p_kind, COALESCE(p_parent_job_ids, '{}'::uuid[]), p_idempotency_key,
    p_exchange, p_metadata,
    COALESCE(p_run_at, now()), v_initial_status
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN v_new_id;
  END IF;

  -- Lost the race — re-read the winner's row. Plain SELECT INTO, because
  -- between the conflict and the re-read the winner may have advanced past
  -- the in-flight statuses (done / failed_*). That is a legitimate race
  -- outcome, but the strict re-read this replaced raised NO_DATA_FOUND with
  -- no domain-specific message and surfaced as an opaque 500 to the
  -- user-facing request. (Phase 163 OPS-08; the 7-param overload got the same
  -- treatment as mig 109 P3 — this is parity, not a new policy.)
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE portfolio_id = p_portfolio_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_allocator_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE allocator_id = p_allocator_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSE
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE api_key_id = p_api_key_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  END IF;

  IF v_new_id IS NULL THEN
    -- Winner already advanced past in-flight. Classify the outcome: ERRCODE
    -- serialization_failure (40001) is the canonical Postgres class for "MVCC
    -- race, retry safe", and the SQLSTATE is the WHOLE signal. A caller that
    -- wants to retry branches on the code, never on this string.
    --
    -- ⛔ THIS MESSAGE IS OPERATOR TEXT AND IT STILL REACHES A USER-VISIBLE
    -- COLUMN. An earlier version of this note said the remedy was to keep the
    -- message SHORT. That is the WRONG PROPERTY and the phase-163 review
    -- (WR-07) was right to say so: the property that matters is NOT OPERATOR
    -- JARGON, and shortness does not deliver it.
    --
    -- The path, re-measured at HEAD 2026-08-26 (the old note's :2012 was
    -- stale):
    --   src/app/api/strategies/csv-finalize/route.ts:2035 builds
    --     `compute job enqueue failed: ${enqueueErrMessage}`
    --   then writeFailedStrategyAnalyticsPlaceholder (:1868) writes it to
    --   strategy_analytics.computation_error (:1928), which renders VERBATIM
    --   to the strategy's OWNER in the wizard failure envelope.
    --
    -- ⚠️ AND THAT PREFIX IS BUILT ON THE TS SIDE, UNCONDITIONALLY, with no
    -- SQLSTATE branch in front of it. So NO message this function can raise
    -- keeps operator jargon out of that column: the user reads "compute job
    -- enqueue failed: ..." whatever follows the colon. SQL can choose WHICH
    -- jargon appears; it cannot remove jargon. Rewording this string into
    -- curated user copy would be cosmetic, and it would additionally push user
    -- copy into the operator log line for the allocator / portfolio / api_key
    -- callers, which are not user-facing at all. The fix is a TS change, and it
    -- HAS LANDED (2026-08-26): csv-finalize now branches on SQLSTATE 40001 and
    -- writes curated copy instead of prefixing this sentence. So this string
    -- stays operator-shaped ON PURPOSE and is now correct to do so — the user
    -- no longer reads it, while the allocator / portfolio / api_key callers
    -- still get the precise operator wording they need.
    --
    -- What the old note got RIGHT, and what therefore stays: naming the
    -- internal SECDEF function and the four internal UUIDs here would make the
    -- leak strictly worse, and nothing diagnostic is lost by omitting them —
    -- the caller already knows which target it asked for, and the server log's
    -- CONTEXT line still names this function for operators.
    RAISE EXCEPTION 'enqueue race lost: the winning job already advanced past the in-flight statuses'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) TO service_role;


COMMENT ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) IS
  'Private shared implementation of the idempotent enqueue pattern. Handles all '
  'four target scopes (strategy / portfolio / allocator / api_key) via 4-way XOR '
  'on the four id parameters. Extended in migration 066 for api_key scope + '
  'scheduled run_at. ACL re-asserted by migration 118. Rejects the retired '
  'compute_analytics kind with invalid_parameter_value (Phase 106 D3). '
  'Race-loser re-read uses a plain SELECT INTO on all four arms; if the winner '
  'already advanced past the in-flight statuses, raises serialization_failure so '
  'the caller can retry vs. surfacing a 500 (Phase 163 OPS-08, parity with the '
  '7-param overload''s mig 109 P3 fix). '
  'Computes the initial status and INSERTs it explicitly: done_pending_children '
  'while at least one listed parent is not yet done; a child whose parents are '
  'all done starts pending, as does a child with no parents (Phase 164.9.1). '
  'With parents, it locks and reads them first: a NULL element, a missing parent '
  'or a failed_final parent is refused with invalid_parameter_value, so no '
  'enqueue creates a child that no mark-done can release.';

-- ---------------------------------------------------------------------------
-- public.mark_compute_job_done, from 20261009120000
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_compute_job_done(
  p_job_id     UUID,
  p_claim_token UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_strategy_id      UUID;
  v_current_status   TEXT;
  v_current_token    UUID;
BEGIN
  -- audit-2026-05-07 B5: token is now mandatory. NULL was a documented
  -- pre-mig-117 back-compat path; the only production caller (main_worker)
  -- threads the token uniformly post-PR-#347.
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'mark_compute_job_done: p_claim_token is required (post-mig-117 strict fence)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Atomic flip running → done with token fence + strategy capture.
  UPDATE compute_jobs
     SET status = 'done'
   WHERE id = p_job_id
     AND status = 'running'
     AND claim_token = p_claim_token
  RETURNING strategy_id INTO v_strategy_id;

  IF NOT FOUND THEN
    -- Row may exist but isn't running, OR row missing, OR token mismatch.
    SELECT status, strategy_id, claim_token
      INTO v_current_status, v_strategy_id, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % not found', p_job_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- mig 109 P6 / mig 117 second-pass fix #2: idempotent retry on
    -- already-done row ONLY when the caller's token matches the recorded
    -- one. The pre-B5 path also accepted NULL — removed now that NULL is
    -- rejected at the entrypoint above.
    IF v_current_status = 'done' THEN
      IF v_current_token IS NOT DISTINCT FROM p_claim_token THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (late mark on already-done row, caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = '55006';
    END IF;

    -- mig 117 P97: token mismatch on a still-running row.
    IF v_current_status = 'running'
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = '55006';
    END IF;

    -- Row in some other state (failed_retry, failed_final, pending,
    -- done_pending_children). Surface loudly.
    RAISE EXCEPTION 'mark_compute_job_done: job % in unexpected status % (expected running)',
      p_job_id, v_current_status
      USING ERRCODE = 'no_data_found';
  END IF;

  -- audit-2026-05-07 G23-187-mig-01/03 RE-APPLY: set-based fan-in advance
  -- with the GIN-supported containment predicate. The strict-token rewrite
  -- (20260528183100) had copied a pre-20260516131500 body and silently
  -- reverted this to a per-child `p_job_id = ANY(parent_job_ids)` FOR-loop,
  -- which the planner CANNOT push to the GIN index compute_jobs_parent_lookup
  -- (only `@>` containment is GIN-supported) -- re-introducing the H-0864
  -- seq-scan + N+1 check_fan_in_ready overhead. The NOT EXISTS sub-query
  -- enforces "all parents done" identically to check_fan_in_ready
  -- (count(parents WHERE status <> 'done') = 0). This form was live in prod
  -- 2026-05-16..2026-05-28 (mig 20260516131500) before the silent revert.
  UPDATE compute_jobs c
     SET status          = 'pending',
         next_attempt_at = now()
   WHERE c.status = 'done_pending_children'
     AND c.parent_job_ids @> ARRAY[p_job_id]::uuid[]
     AND NOT EXISTS (
       SELECT 1
         FROM compute_jobs p
        WHERE p.id = ANY(c.parent_job_ids)
          AND p.status <> 'done'
     );

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(v_strategy_id::text));
    PERFORM sync_strategy_analytics_status(v_strategy_id, p_job_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION mark_compute_job_done(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- COMMENT from 20261001120000 (the latest COMMENT of this function)
COMMENT ON FUNCTION mark_compute_job_done(UUID, UUID) IS 'Terminal success transition. Migration 117 P97 fence + B5 strict-token gate (20260528183100): p_claim_token MUST be non-NULL (NULL raises 22023); mismatch raises SQLSTATE 55006 (object_in_use), which PostgREST answers once. THIS migration (G23-187-mig-01/03): re-applies the GIN-supported set-based `parent_job_ids @> ARRAY[p_job_id]` fan-in advance (the strict-token rewrite had reverted it to a `= ANY(...)` FOR-loop). Preserves the mig 099 Phase-18 atomic UI status bridge.';

-- ---------------------------------------------------------------------------
-- public.mark_compute_job_failed, from 20261009120000
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_compute_job_failed(
  p_job_id      UUID,
  p_error       TEXT,
  p_error_kind  TEXT DEFAULT 'unknown',
  p_claim_token UUID DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_attempts      INTEGER;
  v_max_attempts  INTEGER;
  v_next_attempt  TIMESTAMPTZ;
  v_new_status    TEXT;
  v_strategy_id   UUID;
  v_current_token UUID;
  v_current_status TEXT;
BEGIN
  -- audit-2026-05-07 B5: token mandatory (see mark_compute_job_done above).
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'mark_compute_job_failed: p_claim_token is required (post-mig-117 strict fence)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_error_kind IS NOT NULL
     AND p_error_kind NOT IN ('transient', 'permanent', 'unknown') THEN
    RAISE EXCEPTION 'mark_compute_job_failed: p_error_kind must be transient/permanent/unknown, got %', p_error_kind
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT attempts, max_attempts, strategy_id
    INTO v_attempts, v_max_attempts, v_strategy_id
    FROM compute_jobs
    WHERE id = p_job_id
      AND status = 'running'
      AND claim_token = p_claim_token
    FOR UPDATE;

  IF NOT FOUND THEN
    SELECT status, claim_token
      INTO v_current_status, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'mark_compute_job_failed: job % not found', p_job_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- mig 117 P97: token mismatch on a still-running row.
    IF v_current_status = 'running'
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_failed: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = '55006';
    END IF;

    RAISE EXCEPTION 'mark_compute_job_failed: job % not running (status=%)', p_job_id, v_current_status
      USING ERRCODE = 'no_data_found';
  END IF;

  IF p_error_kind = 'permanent' THEN
    v_new_status := 'failed_final';
    v_next_attempt := now();
  ELSIF v_attempts >= v_max_attempts THEN
    v_new_status := 'failed_final';
    v_next_attempt := now();
  ELSE
    v_new_status := 'failed_retry';
    CASE
      WHEN v_attempts <= 1 THEN v_next_attempt := now() + interval '30 seconds';
      WHEN v_attempts = 2 THEN v_next_attempt := now() + interval '2 minutes';
      WHEN v_attempts = 3 THEN v_next_attempt := now() + interval '10 minutes';
      WHEN v_attempts = 4 THEN v_next_attempt := now() + interval '1 hour';
      ELSE                     v_next_attempt := now() + interval '6 hours';
    END CASE;
  END IF;

  -- HOTFIX 2026-05-29: write `error_kind` (the real column + CHECK target),
  -- NOT the non-existent `last_error_kind` that mig 20260528183100 introduced.
  UPDATE compute_jobs
     SET status = v_new_status,
         last_error = p_error,
         error_kind = p_error_kind,
         next_attempt_at = v_next_attempt
   WHERE id = p_job_id;

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(v_strategy_id::text));
    PERFORM sync_strategy_analytics_status(v_strategy_id, p_job_id);
  END IF;

  RETURN v_next_attempt;
END;
$$;

REVOKE ALL ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- COMMENT from 20261001120000 (the latest COMMENT of this function)
COMMENT ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) IS 'Terminal failure transition. Mig 117 / P97 fence + B5 strict-token follow-up: p_claim_token MUST be non-NULL (NULL raises 22023 invalid_parameter_value); mismatch raises SQLSTATE 55006 (object_in_use), which PostgREST answers once. Backoff schedule preserved verbatim from mig 109 P4. HOTFIX 20260529180000: writes error_kind (not the non-existent last_error_kind that mig 20260528183100 typo-introduced, which 42703-errored every failed mark).';

-- ---------------------------------------------------------------------------
-- bridge_outcomes: the sync trigger function, the trigger on its OLD column
-- list, the OLD index key and the prior COMMENTs. From 20260421154029,
-- 20260426131721 and 20260925071300. former_match_decision_id STAYS (header).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION bridge_outcomes_sync_holding_ref()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.match_decision_id IS NOT NULL THEN
    SELECT original_holding_ref
      INTO NEW.original_holding_ref
      FROM match_decisions
     WHERE id = NEW.match_decision_id;
  ELSE
    NEW.original_holding_ref := NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION bridge_outcomes_sync_holding_ref IS
  'Phase 09 / finding f4. BEFORE INSERT OR UPDATE OF match_decision_id trigger function '
  'that denormalizes match_decisions.original_holding_ref into bridge_outcomes. '
  'SECURITY DEFINER + locked search_path; reads match_decisions by PK only (parameterized). '
  'Returns NEW with original_holding_ref populated or NULL when match_decision_id is NULL.';

DROP TRIGGER IF EXISTS bridge_outcomes_sync_holding_ref_trigger ON bridge_outcomes;
CREATE TRIGGER bridge_outcomes_sync_holding_ref_trigger
  BEFORE INSERT OR UPDATE OF match_decision_id ON bridge_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION bridge_outcomes_sync_holding_ref();

DROP INDEX IF EXISTS public.bridge_outcomes_legacy_per_strategy_holding_when_md_null;
CREATE UNIQUE INDEX IF NOT EXISTS bridge_outcomes_legacy_per_strategy_holding_when_md_null
  ON bridge_outcomes (
    allocator_id,
    strategy_id,
    COALESCE(original_holding_ref, '')
  )
  WHERE match_decision_id IS NULL;

COMMENT ON INDEX bridge_outcomes_legacy_per_strategy_holding_when_md_null IS
  'Phase 10 / migration 083 (P2). Partial UNIQUE that restores the migration-072 '
  '(allocator_id, strategy_id, original_holding_ref) per-strategy invariant for any '
  'bridge_outcomes row whose match_decision_id was nulled out (e.g., via the '
  'ON DELETE SET NULL cascade when a match_decision is deleted). Migration 081 '
  'replaced 072''s unconditional unique with (allocator_id, match_decision_id), '
  'which over Postgres''s NULL-distinct semantics no longer blocks duplicate '
  'legacy-shape rows. This partial index restores that block strictly for the '
  'NULL-md case; rows with a real match_decision_id continue to use the '
  'bridge_outcomes_allocator_match_decision_unique constraint.';

COMMENT ON TABLE public.bridge_outcomes IS
  'Allocator self-reported post-intro outcome for a Bridge-recommended strategy, '
  'or for a voluntary scenario decision (Phase 10). '
  'Uniqueness is two-part. (i) bridge_outcomes_allocator_match_decision_unique, '
  'UNIQUE (allocator_id, match_decision_id): one outcome per decision (migration 081). '
  '(ii) bridge_outcomes_legacy_per_strategy_holding_when_md_null, a partial UNIQUE on '
  '(allocator_id, strategy_id, COALESCE(original_holding_ref, '''')) WHERE match_decision_id IS NULL '
  '(migration 083), for rows whose decision was nulled out. The sync trigger writes NULL to original_holding_ref '
  'for every such row it touches, so that index is in effect one outcome per (allocator, strategy) among them. '
  'Two outcomes for the same (allocator, strategy) under two different decisions are allowed by design. '
  'Outcomes are editable by owner (D-17) and append-only from an audit perspective '
  '(no DELETE policy; corrective edits via UPSERT). '
  'Scope: D-08 through D-19, OUTCOME-01 through OUTCOME-08.';

COMMENT ON COLUMN public.bridge_outcomes.original_holding_ref IS
  'Phase 09 / finding f4. Denormalized mirror of match_decisions.original_holding_ref, '
  'populated by bridge_outcomes_sync_holding_ref_trigger on INSERT/UPDATE OF match_decision_id. '
  'NULL for strategy-sourced rows (original_strategy_id path). '
  'NULL when match_decision_id IS NULL (the trigger writes NULL for those rows). '
  'The md-NULL partial index bridge_outcomes_legacy_per_strategy_holding_when_md_null (migration 083) '
  'keys on COALESCE(original_holding_ref, ''''), but because the trigger nulls this column for md-NULL rows, '
  'that index is in effect per (allocator, strategy); a non-empty holding reaches it only through a direct '
  'UPDATE of this column that leaves match_decision_id unchanged. '
  'Rows with a decision are keyed by bridge_outcomes_allocator_match_decision_unique '
  '(migration 081), which does not read this column.';


-- ---------------------------------------------------------------------------
-- the OLD ladder is complete: the helper has no caller left, so drop it
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public._fan_in_lock_rows(uuid[], boolean);

-- ───────────── post-verify — CATALOGUE ONLY, reads no row
DO $postverify$
DECLARE
  v_enq_oid    oid := to_regprocedure('public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)');
  v_done_oid   oid := to_regprocedure('public.mark_compute_job_done(uuid, uuid)');
  v_failed_oid oid := to_regprocedure('public.mark_compute_job_failed(uuid, text, text, uuid)');
  v_sync_oid   oid := to_regprocedure('public.bridge_outcomes_sync_holding_ref()');
  v_body       text;
  v_def        text;
BEGIN
  IF v_enq_oid IS NULL OR v_done_oid IS NULL OR v_failed_oid IS NULL OR v_sync_oid IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261024120000: a restored function is missing after the restore';
  END IF;
  -- the helper is gone
  IF to_regprocedure('public._fan_in_lock_rows(uuid[], boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261024120000: public._fan_in_lock_rows still exists after the drop';
  END IF;
  -- the enqueue: FOR SHARE parent lock back, no helper call
  v_body := regexp_replace(regexp_replace(pg_get_functiondef(v_enq_oid), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_body IS NULL OR v_body !~ 'FOR[[:space:]]+SHARE' THEN
    RAISE EXCEPTION 'Rollback 20261024120000: the restored 10-argument enqueue has no FOR SHARE parent lock, so 20260924230827''s body was not restored';
  END IF;
  IF position('_fan_in_lock_rows' in v_body) > 0 THEN
    RAISE EXCEPTION 'Rollback 20261024120000: the restored 10-argument enqueue still calls the lock helper';
  END IF;
  -- mark_compute_job_done: no helper call
  v_body := regexp_replace(regexp_replace(pg_get_functiondef(v_done_oid), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_body IS NULL OR position('_fan_in_lock_rows' in v_body) > 0 THEN
    RAISE EXCEPTION 'Rollback 20261024120000: the restored mark_compute_job_done is unreadable or still calls the lock helper';
  END IF;
  -- mark_compute_job_failed: no cascade
  v_body := regexp_replace(regexp_replace(pg_get_functiondef(v_failed_oid), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_body IS NULL OR position('_fan_in_lock_rows' in v_body) > 0 OR position('fan_in_parent_failed' in v_body) > 0 THEN
    RAISE EXCEPTION 'Rollback 20261024120000: the restored mark_compute_job_failed is unreadable or still carries the failure cascade';
  END IF;
  -- the sync trigger function: no former-id assignment
  v_body := regexp_replace(regexp_replace(pg_get_functiondef(v_sync_oid), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_body IS NULL OR position('former_match_decision_id' in v_body) > 0 THEN
    RAISE EXCEPTION 'Rollback 20261024120000: the restored sync trigger function is unreadable or still writes former_match_decision_id';
  END IF;
  -- the trigger is back on its OLD column list
  SELECT pg_get_triggerdef(t.oid) INTO v_def
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.bridge_outcomes'::regclass
     AND t.tgname = 'bridge_outcomes_sync_holding_ref_trigger'
     AND NOT t.tgisinternal;
  IF v_def IS NULL OR position('former_match_decision_id' in v_def) > 0 OR position('UPDATE OF match_decision_id ON' in v_def) = 0 THEN
    RAISE EXCEPTION 'Rollback 20261024120000: the sync trigger is missing or not back on UPDATE OF match_decision_id alone. Read back: %', coalesce(v_def, '<missing>');
  END IF;
  -- the index is back on its OLD key
  SELECT pg_get_indexdef(i.indexrelid) INTO v_def
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'bridge_outcomes_legacy_per_strategy_holding_when_md_null'
     AND c.relnamespace = 'public'::regnamespace
     AND i.indisunique;
  IF v_def IS NULL OR position('former_match_decision_id' in v_def) > 0 OR position('original_holding_ref' in v_def) = 0 THEN
    RAISE EXCEPTION 'Rollback 20261024120000: the md-NULL unique index is missing or still keyed on former_match_decision_id. Read back: %', coalesce(v_def, '<missing>');
  END IF;
  -- ACLs
  IF has_function_privilege('anon', v_enq_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_enq_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_done_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_done_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_failed_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_failed_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261024120000: anon or authenticated can EXECUTE a restored compute-job function';
  END IF;
  IF NOT has_function_privilege('service_role', v_enq_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261024120000: service_role lost EXECUTE on the 10-argument enqueue after the restore';
  END IF;
  RAISE NOTICE 'Rollback 20261024120000: the four prior function bodies, the old trigger column list and the old index key are restored, and the lock helper is dropped.';
END
$postverify$;

COMMIT;
