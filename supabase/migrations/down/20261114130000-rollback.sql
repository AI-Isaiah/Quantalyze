-- ============================================================================
-- ROLLBACK for 20261114130000_enqueue_dedup_record_retract.sql
-- Phase 211 SYNCJOBS, plan 03 (D11-1 to D11-13, founder option B 2026-11-14).
-- ============================================================================
-- Manual, off the auto-apply path: CI does not apply rollbacks, and nothing runs
-- this file unless a person does, after the marker query in CLAUDE.md has named
-- the database.
--
-- WHAT IT UNDOES. It restores BOTH overloads of public._enqueue_compute_job_internal
-- to the bodies the migration replaced, verbatim: the 10-argument one from section (3)
-- of 20261024120000_fan_in_graph_and_decision_cascade.sql (with that migration's
-- catalog COMMENT) and the 7-argument one from
-- 20260716090000_retire_compute_analytics_kind_rpc_guard.sql. It restates the REVOKE
-- and GRANT of each overload, then drops public._record_enqueue_dedup(uuid, text,
-- jsonb, uuid[]). The function drop comes last, after both bodies stopped calling it.
--
-- WHAT IT DELIBERATELY KEEPS. public.compute_job_dedup_events and every row in it
-- stay. They are the audit trail of every retraction the SQL made, the Python
-- backstop answers `no_marker` on those collisions and writes nothing, so this table
-- is the only place that says a marker was retracted. Dropping it is a separate
-- founder decision, not a side effect of a rollback. With the helper gone nothing
-- writes to it any more, and it still dies row by row with its job through the FK.
--
-- CALLERS FIRST. Nothing in Python or TypeScript calls public._record_enqueue_dedup
-- directly (the only callers are the two overload bodies this file replaces), so the
-- rollback stands alone and needs no caller change first.
--
-- WHAT ROLLING BACK COSTS. A dedup hit discards the caller's metadata again, so the
-- D-02 gap Phase 191 named reopens for the resync tail: a resync served by a
-- recurring refresh job inherits that job's protection marker until the Python
-- backstop (which stays in the code either way) retracts it. Markers already
-- retracted in PROD stay retracted. No data changes.
--
-- THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261114130000 as applied while the helper no longer exists. `supabase db
-- push` will therefore NOT re-apply the migration. To re-apply it, delete that ledger
-- row in the same change that re-applies it (or mark it reverted with `supabase
-- migration repair --status reverted 20261114130000` against the intended database,
-- after the marker query in CLAUDE.md names that database). Until then VAC-08's
-- ledger check reports the version as present, which is true of the ledger and false
-- of the helper. The migration's CREATE TABLE is not guarded, so a re-apply onto a
-- database that kept the table must drop or rename it first.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- 7-argument overload: verbatim from 20260716090000 (schema-qualified, as the
-- migration did, so it can never be read as a third overload).
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._enqueue_compute_job_internal(
  p_strategy_id     UUID,
  p_portfolio_id    UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT,
  p_parent_job_ids  UUID[],
  p_exchange        TEXT,
  p_metadata        JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing_id UUID;
  v_new_id      UUID;
  v_initial_status TEXT;
BEGIN
  IF (p_strategy_id IS NULL AND p_portfolio_id IS NULL)
     OR (p_strategy_id IS NOT NULL AND p_portfolio_id IS NOT NULL) THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: exactly one of p_strategy_id or p_portfolio_id must be non-null (got strategy=%, portfolio=%)',
      p_strategy_id, p_portfolio_id
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

  -- P12: rows with unfulfilled parents start as done_pending_children
  -- so the fan-in advancement loop in mark_compute_job_done picks them
  -- up. Leaf rows (no parents) start as pending per the column DEFAULT.
  IF p_parent_job_ids IS NOT NULL
     AND array_length(p_parent_job_ids, 1) IS NOT NULL
     AND array_length(p_parent_job_ids, 1) > 0 THEN
    v_initial_status := 'done_pending_children';
  ELSE
    v_initial_status := 'pending';
  END IF;

  -- Optimistic path: existing in-flight job for this (target, kind).
  -- The optimistic SELECT covers all three in-flight statuses; the
  -- partial unique index agrees on this set so a winner inserted with
  -- done_pending_children is also caught here.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
      WHERE strategy_id = p_strategy_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id
      FROM compute_jobs
      WHERE portfolio_id = p_portfolio_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- Race-safe insert. The partial unique index catches any concurrent
  -- INSERT with the same (target, kind) and leaves v_new_id NULL.
  INSERT INTO compute_jobs (
    strategy_id, portfolio_id, kind, parent_job_ids,
    idempotency_key, exchange, metadata, status
  )
  VALUES (
    p_strategy_id, p_portfolio_id, p_kind, p_parent_job_ids,
    p_idempotency_key, p_exchange, p_metadata, v_initial_status
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN v_new_id;
  END IF;

  -- Lost the race. Re-read the winner's row. Plain SELECT INTO (NOT
  -- STRICT) because between the conflict and the re-read the winner
  -- may have advanced past the in-flight statuses (done / failed_*).
  -- That's a legitimate race outcome — the original SELECT INTO STRICT
  -- raised NO_DATA_FOUND with no domain-specific message and surfaced
  -- as an opaque 500 to the user-facing request. (P3)
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
      WHERE strategy_id = p_strategy_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  ELSE
    SELECT id INTO v_new_id
      FROM compute_jobs
      WHERE portfolio_id = p_portfolio_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  END IF;

  IF v_new_id IS NULL THEN
    -- Winner already advanced past in-flight. Tell the caller this
    -- was a race loss with a recoverable error code so the app layer
    -- can retry the enqueue without surfacing a 500. ERRCODE
    -- 'serialization_failure' is the canonical Postgres class for
    -- "MVCC race, retry safe".
    RAISE EXCEPTION '_enqueue_compute_job_internal: enqueue race lost and winner already terminal (target strategy=%, portfolio=%, kind=%)',
      p_strategy_id, p_portfolio_id, p_kind
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN v_new_id;
END;
$$;
-- --------------------------------------------------------------------------
-- 10-argument overload: verbatim from section (3) of 20261024120000.
-- --------------------------------------------------------------------------
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

    -- Phase 164.9.3.1 D-06: the parents are locked through the ancestor-first
    -- helper (key: depth, then id), not by job id alone. The paragraph above
    -- that says "in id order" is the lineage this replaces: a pure id order
    -- deadlocks against mark_compute_job_done on a diamond.
    PERFORM public._fan_in_lock_rows(p_parent_job_ids, FALSE);

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

-- ACL restated with full argument lists (a Supabase default-grant event trigger can
-- re-open EXECUTE on a CREATE OR REPLACE).
REVOKE ALL ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) TO service_role;

-- Catalog text of the 10-argument overload, back to the 20261024120000 wording
-- (`Phase 163 OPS-08` stays in it: test_enqueue_internal_destrict.sql reads it).
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
  'With parents, it locks them first through public._fan_in_lock_rows in '
  'ancestor-first (depth, id) order (Phase 164.9.3.1 D-06) and reads them: a NULL '
  'element, a missing parent or a failed_final parent is refused with '
  'invalid_parameter_value, so no enqueue creates a child that no mark-done can '
  'release.';

-- Neither overload calls the helper any more, so it can go. The table stays.
DROP FUNCTION IF EXISTS public._record_enqueue_dedup(uuid, text, jsonb, uuid[]);

-- Catalogue-only check: the helper is gone, both overloads exist, the table is kept.
DO $$
BEGIN
  IF to_regprocedure('public._record_enqueue_dedup(uuid, text, jsonb, uuid[])') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261114130000: the helper still exists after the DROP';
  END IF;
  IF to_regprocedure('public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb)') IS NULL
     OR to_regprocedure('public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261114130000: an _enqueue_compute_job_internal overload is missing after the restore';
  END IF;
  RAISE NOTICE 'Rollback 20261114130000: both overload bodies restored and the helper dropped; compute_job_dedup_events kept.';
END $$;

COMMIT;
