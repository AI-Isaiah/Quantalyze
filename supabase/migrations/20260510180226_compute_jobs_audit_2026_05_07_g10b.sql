-- Migration 109: compute_jobs queue hardening — audit-2026-05-07 G10.B batch 3
--
-- Why this migration exists
-- -------------------------
-- audit-2026-05-07 G10.B (compute_jobs schema + RLS + indexes, score=593,
-- 33 active items) flagged 4 CRITICAL + 13 HIGH defects in the queue
-- substrate (PR #49, mig 032; subsequently amended by 086, 089, 099).
-- Earlier audit hardening batches landed:
--   - mig 102 (sync_trades fill protection — G12.A.1)
--   - mig 099 (Phase-18 atomic UI bridge — pre-audit, but supersedes mig
--     032's mark_compute_job_done / mark_compute_job_failed verbatim)
-- Neither batch closed the queue-correctness items below. PR #133 (Phase
-- 19 unified ingestion backbone) added migrations 103-108 but did not
-- touch the queue functions.
--
-- This migration closes the SQL-only queue-correctness items in surface
-- G10.B that fit within a single function-replacement migration.
-- sync_trades natural-key UPSERT (P1 / G10.B.1) lives in a separate
-- migration; user_message column + rate-limit-grief defenses (P11 / P16)
-- live in 111.
--
-- Items addressed by this migration
-- ---------------------------------
-- * P2 (G10.B.3, CRITICAL): reclaim_stuck_compute_jobs no longer eats
--   retry budget. The watchdog now decrements `attempts` when it reclaims
--   a row whose worker died before mark_done/mark_failed could fire.
--   Without this, three back-to-back worker crashes burn a row's full
--   3-attempt budget without executing the job once.
-- * P3 (G10.B.2, CRITICAL): _enqueue_compute_job_internal no longer
--   raises NO_DATA_FOUND with a cryptic Postgres errcode when the race
--   loser re-reads after the winner has already advanced past the
--   in-flight statuses. The re-read uses plain SELECT INTO; if v_new_id
--   is still NULL, we raise a domain-specific 'enqueue race lost'
--   exception with ERRCODE=`serialization_failure` so callers can
--   distinguish race-loss from real DB errors.
-- * P4 (G10.B.4, CRITICAL): mark_compute_job_failed RAISES NOTICE when
--   the safety-net ELSE arm of the backoff CASE fires (v_attempts >= 3
--   under a misconfigured max_attempts > 3). Today this silently retries
--   every 8min forever with no Sentry signal. NOTICE does NOT roll back
--   the surrounding UPDATE, so the row still advances per the original
--   "keep moving" contract — but the operator now has a guaranteed log
--   line to alert on.
-- * P6 (G10.B.8, HIGH): mark_compute_job_done is now idempotent. A
--   worker that completes its work but crashes before its HTTP response
--   reaches Railway will retry on next claim. The retry calls mark_done
--   on a row whose status is already 'done'; today this RAISES
--   NO_DATA_FOUND, which the Python runner then retries via mark_failed,
--   which itself NOT-FOUND-RAISES, producing cascading false-failure
--   alerts. The new behaviour: detect already-done as a no-op and return
--   silently (still safe — the row's children were already advanced on
--   the original mark_done call).
-- * P12 (G10.B.12, HIGH): _enqueue_compute_job_internal now sets
--   status='done_pending_children' when parent_job_ids is non-empty.
--   Today no code path ever produces a done_pending_children row, so
--   the entire fan-in machinery (mark_compute_job_done's loop +
--   check_fan_in_ready) is unreachable as shipped. After this fix, any
--   enqueue with parents starts in done_pending_children and gets
--   advanced to pending by mark_compute_job_done's fan-in loop when
--   all parents reach done.
-- * P14 (G10.B.11, HIGH): idempotency_key gets a CHECK constraint:
--   length <= 128 AND safe charset (^[A-Za-z0-9_:.-]+$). Caller-supplied
--   correlation key is logged via console.log throughout sync routes
--   (sync/route.ts:110) — without a CHECK an attacker (or buggy admin
--   client) can poison the Vercel log stream with control chars or DoS
--   the heap with megabyte keys. The constraint is added with
--   `NOT VALID` then `VALIDATE`d after a defensive backfill pass so the
--   migration does not block on legacy rows that may have been written
--   directly via service-role.
-- * P17 (G10.B.17, HIGH): check_fan_in_ready RAISES NOTICE when the
--   child row is missing (vs. the silent 'parents not all done'
--   return-false). Today both conditions return false, so an orphan
--   parent_job_ids reference accumulates without any operator signal.
--   NOTICE is non-rolling-back diagnostic, so the existing semantics
--   (return false → caller skips advance) are preserved.
--
-- Items NOT in this migration
-- ---------------------------
-- * P1 (G10.B.1, CRITICAL): sync_trades natural-key DELETE scoping —
--   handled by mig 110 in this PR.
-- * P5/P7/P8/P10/P13/P15: live-DB Vitest regression tests — handled by
--   src/__tests__/compute-jobs-* in this PR.
-- * P9 (G10.B.7, HIGH): the audit reports check_fan_in_ready treats
--   done_pending_children as not-done and stalls 3-level chains. Tracing
--   the state machine shows chains DO propagate: P1.done →
--   mark_compute_job_done(P1) advances P2 (done_pending_children →
--   pending) → P2 runs → mark_compute_job_done(P2) advances P3, etc.
--   The audit description is misleading; the actual gap is P12 (no row
--   ever STARTS as done_pending_children) which is fixed here. Multi-
--   level fan-in is covered by the new test in P15.
-- * P11 (G10.B.15, HIGH): get_user_compute_jobs user_message column —
--   handled by mig 111.
-- * P16 (G10.B.16, HIGH): update_api_key_rate_limit grief defenses —
--   handled by mig 111.
--
-- Rollback
-- --------
-- Restoring mig 099's mark_compute_job_done / mark_compute_job_failed
-- and mig 032's _enqueue_compute_job_internal / check_fan_in_ready /
-- reclaim_stuck_compute_jobs is safe — the prior behavior was the
-- production status quo for the entire pre-audit window. Drop the
-- idempotency_key CHECK with `ALTER TABLE compute_jobs DROP CONSTRAINT
-- compute_jobs_idempotency_key_safe`.
--
-- Compatibility
-- -------------
-- All function signatures, parameter defaults, and RETURNS types are
-- preserved. Callers in analytics-service/services/job_worker.py,
-- analytics-service/main_worker.py, src/app/api/keys/sync/route.ts,
-- and src/lib/queries.ts continue to work unchanged.

BEGIN;

-- --------------------------------------------------------------------
-- P14: idempotency_key bounded length + safe charset
-- --------------------------------------------------------------------
-- Defense in depth. Backfill any pre-existing legacy rows that may
-- carry control chars or oversized keys (none expected — only the
-- sync routes write to this column today, and they use ULID-shaped
-- ids — but the constraint must apply unconditionally). Any row that
-- fails the safety predicate gets its idempotency_key set NULL so
-- VALIDATE CONSTRAINT below succeeds.
UPDATE compute_jobs
   SET idempotency_key = NULL
 WHERE idempotency_key IS NOT NULL
   AND (length(idempotency_key) > 128
        OR idempotency_key !~ '^[A-Za-z0-9_:.-]+$');

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_idempotency_key_safe
  CHECK (
    idempotency_key IS NULL
    OR (length(idempotency_key) <= 128
        AND idempotency_key ~ '^[A-Za-z0-9_:.-]+$')
  )
  NOT VALID;

ALTER TABLE compute_jobs
  VALIDATE CONSTRAINT compute_jobs_idempotency_key_safe;

COMMENT ON CONSTRAINT compute_jobs_idempotency_key_safe ON compute_jobs IS
  'audit-2026-05-07 P14 / G10.B.11: bound caller-supplied idempotency_key '
  'to <=128 chars and a safe charset so the column cannot be used to DoS '
  'the heap or poison log streams with control characters.';

-- --------------------------------------------------------------------
-- P3 + P12: _enqueue_compute_job_internal
-- --------------------------------------------------------------------
-- Two changes:
--   1. (P3) Race-loser re-read no longer uses INTO STRICT. NULL means
--      "the winner has already advanced past in-flight statuses" — a
--      legitimate condition under sustained load. We raise a domain-
--      specific error with ERRCODE='serialization_failure' so the
--      caller (Postgres-level retry harness or app-layer error
--      handler) can distinguish race-loss from a real DB error.
--   2. (P12) When parent_job_ids is non-empty, the new row is inserted
--      with status='done_pending_children' instead of the default
--      'pending'. This wires up the fan-in substrate: rows with
--      unfulfilled parents wait for mark_compute_job_done(parent) to
--      flip them to pending via the check_fan_in_ready loop. Without
--      this, no row was ever in done_pending_children and the fan-in
--      machinery was unreachable.
--
-- Function signature, params, return type all preserved.
CREATE OR REPLACE FUNCTION _enqueue_compute_job_internal(
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

-- NOTE: explicit arg-list qualification is REQUIRED here because migration 066
-- (allocator_holdings) extended this function via DROP+CREATE to a 10-param
-- signature. After mig 109's CREATE OR REPLACE adds back the original 7-param
-- variant, two overloads coexist in pg_proc and any unqualified COMMENT/REVOKE
-- would fail with SQLSTATE 42725 (ambiguous_function) and silently break the
-- migration under `supabase db push`. See migration 118 for the retroactive
-- remediation that closes the gap on databases where 109 already landed with
-- this defect (production prior to 2026-05-12).
COMMENT ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb
) IS
  'Private shared idempotent enqueue. Inserts new rows with status='
  '''done_pending_children'' when parent_job_ids is non-empty (mig 109 P12), '
  'else status=''pending''. Race-loser re-read uses plain SELECT INTO; if the '
  'winner already advanced past in-flight statuses, raises serialization_failure '
  'so the caller can retry vs. surfacing a 500 (mig 109 P3). See mig 109.';

REVOKE ALL ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb
) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- P17: check_fan_in_ready — RAISE NOTICE on missing child
-- --------------------------------------------------------------------
-- Distinguish "child row missing" (orphan parent_job_ids reference)
-- from "parents not all done" (legitimate not-ready). Both still
-- return false to preserve the caller contract — NOTICE is non-rolling-
-- back diagnostic only — but the operator now sees a log line for the
-- orphan case rather than silent accumulation.
CREATE OR REPLACE FUNCTION check_fan_in_ready(
  p_child_job_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_parent_ids    UUID[];
  v_unready_count INTEGER;
  v_row_found     BOOLEAN;
BEGIN
  SELECT parent_job_ids, true
    INTO v_parent_ids, v_row_found
    FROM compute_jobs
    WHERE id = p_child_job_id;

  IF NOT FOUND THEN
    -- Orphan reference. Surface a NOTICE so operators can detect
    -- accumulating drift without changing the legacy return value
    -- (false). (mig 109 P17 / G10.B.17)
    RAISE NOTICE 'check_fan_in_ready: child job % missing — possible orphan parent_job_ids reference', p_child_job_id;
    RETURN false;
  END IF;

  IF v_parent_ids IS NULL THEN
    RETURN false;
  END IF;

  IF array_length(v_parent_ids, 1) IS NULL OR array_length(v_parent_ids, 1) = 0 THEN
    -- No parents -> always ready (leaf job).
    RETURN true;
  END IF;

  SELECT count(*) INTO v_unready_count
    FROM compute_jobs
    WHERE id = ANY(v_parent_ids)
      AND status <> 'done';

  RETURN v_unready_count = 0;
END;
$$;

COMMENT ON FUNCTION check_fan_in_ready IS
  'Returns true when every parent job of the child is status=done. Raises NOTICE '
  '(non-rolling-back diagnostic) when the child row itself is missing so orphan '
  'parent_job_ids references are visible to operators (mig 109 P17). See migration 109.';

REVOKE ALL ON FUNCTION check_fan_in_ready FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- P6: mark_compute_job_done — idempotent on retry
-- --------------------------------------------------------------------
-- Preserves the mig 099 (Phase 18) atomic UI bridge. New behaviour: if
-- the row is ALREADY done, return silently — children were advanced
-- and the bridge fired on the original mark_done call, so re-running
-- is a no-op. Today this raises NO_DATA_FOUND, which the Python
-- runner classifies as a transient error and follows up with
-- mark_compute_job_failed against an already-done row, producing
-- cascading false-failure alerts.
--
-- The original "row truly missing" branch still raises so genuine
-- bookkeeping bugs surface loudly.
CREATE OR REPLACE FUNCTION mark_compute_job_done(
  p_job_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_strategy_id      UUID;
  v_current_status   TEXT;
  v_child_id         UUID;
BEGIN
  -- Atomic flip running → done with strategy capture for the bridge.
  UPDATE compute_jobs
     SET status = 'done'
   WHERE id = p_job_id
     AND status = 'running'
  RETURNING strategy_id INTO v_strategy_id;

  IF NOT FOUND THEN
    -- Row exists but isn't running, OR row is missing. Distinguish.
    SELECT status, strategy_id
      INTO v_current_status, v_strategy_id
      FROM compute_jobs
      WHERE id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % not found', p_job_id
        USING ERRCODE = 'no_data_found';
    END IF;

    IF v_current_status = 'done' THEN
      -- (P6) Idempotent retry. Children were advanced and the bridge
      -- fired on the original mark_done call. No-op.
      RETURN;
    END IF;

    -- Row in some other state (failed_retry, failed_final, pending,
    -- done_pending_children). The runner's belief that the job is
    -- complete contradicts the row; surface the mismatch loudly.
    RAISE EXCEPTION 'mark_compute_job_done: job % in unexpected status % (expected running)',
      p_job_id, v_current_status
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Advance any children that are now fully ready.
  FOR v_child_id IN
    SELECT id FROM compute_jobs
      WHERE p_job_id = ANY(parent_job_ids)
        AND status = 'done_pending_children'
  LOOP
    IF check_fan_in_ready(v_child_id) THEN
      UPDATE compute_jobs
         SET status = 'pending',
             next_attempt_at = now()
       WHERE id = v_child_id
         AND status = 'done_pending_children';
    END IF;
  END LOOP;

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;
END;
$$;

COMMENT ON FUNCTION mark_compute_job_done IS
  'Terminal success transition. Idempotent on retry: returns silently if the row '
  'is already ''done'' (mig 109 P6 / G10.B.8). Preserves mig 099 Phase-18 atomic UI '
  'status bridge. Advances done_pending_children children whose parents are now '
  'all complete. See migration 109.';

REVOKE ALL ON FUNCTION mark_compute_job_done FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- P4: mark_compute_job_failed — RAISE NOTICE on misconfigured retry
-- --------------------------------------------------------------------
-- Preserves the mig 099 (Phase 18) atomic UI bridge and the entire
-- backoff schedule verbatim. New behaviour: if the safety-net ELSE arm
-- of the inner CASE fires (v_attempts >= 3 under a misconfigured
-- max_attempts > 3), RAISE NOTICE so operators have a guaranteed log
-- line to alert on. NOTICE does NOT roll back the surrounding UPDATE;
-- the row still advances per the original "keep moving" contract.
CREATE OR REPLACE FUNCTION mark_compute_job_failed(
  p_job_id     UUID,
  p_error      TEXT,
  p_error_kind TEXT DEFAULT 'unknown'
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_attempts     INTEGER;
  v_max_attempts INTEGER;
  v_next_attempt TIMESTAMPTZ;
  v_new_status   TEXT;
  v_strategy_id  UUID;
BEGIN
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
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_compute_job_failed: job % not found or not running', p_job_id
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
    -- Original schedule (preserved): attempt 1 → +30s, 2 → +2min,
    -- ELSE → +8min. The ELSE arm is the safety net for misconfigured
    -- max_attempts > 3 paths described in the mig 032 STEP 13 comment.
    CASE
      WHEN v_attempts <= 1 THEN v_next_attempt := now() + interval '30 seconds';
      WHEN v_attempts = 2 THEN v_next_attempt := now() + interval '2 minutes';
      ELSE
        v_next_attempt := now() + interval '8 minutes';
        -- (mig 109 P4 / G10.B.4) Surface a NOTICE so operators get a
        -- guaranteed log line when the safety-net ELSE arm fires. Today
        -- this is silent and the Sentry "attempts>3" alert the original
        -- comment promised was never wired up.
        RAISE NOTICE 'mark_compute_job_failed: job % hit safety-net ELSE arm of CASE schedule (attempts=%, max_attempts=%, scheduled +8min). This indicates a misconfigured max_attempts. Investigate.',
          p_job_id, v_attempts, v_max_attempts;
    END CASE;
  END IF;

  UPDATE compute_jobs
     SET status          = v_new_status,
         last_error      = p_error,
         error_kind      = COALESCE(p_error_kind, 'unknown'),
         next_attempt_at = v_next_attempt,
         claimed_at      = NULL,
         claimed_by      = NULL
   WHERE id = p_job_id;

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;

  RETURN v_next_attempt;
END;
$$;

COMMENT ON FUNCTION mark_compute_job_failed IS
  'Transitions a running job to failed_retry or failed_final. Backoff: 1→+30s, '
  '2→+2min, ELSE→+8min. ELSE arm RAISES NOTICE so operators have a guaranteed log '
  'line for misconfigured max_attempts (mig 109 P4 / G10.B.4). Preserves mig 099 '
  'Phase-18 atomic UI status bridge. See migration 109.';

REVOKE ALL ON FUNCTION mark_compute_job_failed FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- P2: reclaim_stuck_compute_jobs — undo the failed claim's increment
-- --------------------------------------------------------------------
-- Today claim_compute_jobs[_with_priority] increments `attempts` at
-- claim time. If a worker dies before mark_done/mark_failed fires, the
-- watchdog reclaims the row but leaves `attempts` incremented. Three
-- back-to-back worker crashes (cold-start OOM, container kill, network
-- drop) burn the row's full 3-attempt budget without executing the job
-- once. The row then sits at attempts=3, and the next mark_failed
-- arrival jumps to failed_final having executed zero times.
--
-- Fix: when reclaiming, decrement attempts so the retry budget reflects
-- actual execution attempts. We also bump a new reclaim_count column
-- (added below) so observability can distinguish "zero-execution
-- failure" from "three real failures" in the failed_final population.
ALTER TABLE compute_jobs
  ADD COLUMN IF NOT EXISTS reclaim_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN compute_jobs.reclaim_count IS
  'Number of times reclaim_stuck_compute_jobs has reset this row from running '
  'back to pending. Lets operators distinguish zero-execution failures (high '
  'reclaim_count, low attempts) from real failures (low reclaim_count). '
  'See migration 109 P2 / G10.B.3.';

CREATE OR REPLACE FUNCTION reclaim_stuck_compute_jobs(
  p_older_than INTERVAL DEFAULT interval '10 minutes'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reclaimed INTEGER;
BEGIN
  -- Decrement attempts (with a floor of 0) and bump reclaim_count so
  -- the failed-claim doesn't eat the row's retry budget. (mig 109 P2)
  UPDATE compute_jobs
     SET status          = 'pending',
         claimed_at      = NULL,
         claimed_by      = NULL,
         next_attempt_at = now(),
         attempts        = GREATEST(attempts - 1, 0),
         reclaim_count   = reclaim_count + 1
   WHERE status = 'running'
     AND claimed_at IS NOT NULL
     AND claimed_at < (now() - p_older_than);

  GET DIAGNOSTICS v_reclaimed = ROW_COUNT;

  RETURN v_reclaimed;
END;
$$;

COMMENT ON FUNCTION reclaim_stuck_compute_jobs IS
  'Watchdog: resets running jobs whose claimed_at is older than p_older_than '
  'back to pending, decrementing attempts (floor 0) and incrementing '
  'reclaim_count so a failed claim does not eat the row''s retry budget '
  '(mig 109 P2 / G10.B.3). Returns the reclaim count. See migration 109.';

REVOKE ALL ON FUNCTION reclaim_stuck_compute_jobs FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- Self-verifying assertions
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_body TEXT;
BEGIN
  -- P14: CHECK constraint exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'compute_jobs_idempotency_key_safe'
       AND conrelid = 'public.compute_jobs'::regclass
  ) THEN
    RAISE EXCEPTION 'Migration 109 verification failed: compute_jobs_idempotency_key_safe constraint missing';
  END IF;

  -- P2: reclaim_count column exists, NOT NULL, defaults to 0. We assert
  -- the COLUMN existence + NOT NULL via information_schema, then verify
  -- the DEFAULT *behaviorally* by reading any row's value (after the
  -- ADD COLUMN ran in this same txn, every existing row was backfilled
  -- to 0 by Postgres). This avoids the brittle `column_default = '0'`
  -- string match which can drift to '0::integer' across pg_dump
  -- roundtrips or future PG versions.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'compute_jobs'
       AND column_name  = 'reclaim_count'
       AND is_nullable  = 'NO'
  ) THEN
    RAISE EXCEPTION 'Migration 109 verification failed: compute_jobs.reclaim_count column missing or not NOT NULL';
  END IF;
  -- Behavioral default check: any row that existed before the ADD COLUMN
  -- must have been backfilled to 0. (If the table was empty pre-migration,
  -- this is vacuously true and the assertion still passes.)
  PERFORM 1
    FROM compute_jobs
   WHERE reclaim_count <> 0
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Migration 109 verification failed: compute_jobs.reclaim_count has a non-zero pre-existing row, indicating the ADD COLUMN DEFAULT was not 0';
  END IF;

  -- P12: _enqueue_compute_job_internal body sets done_pending_children
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = '_enqueue_compute_job_internal';
  IF v_body IS NULL OR v_body NOT ILIKE '%done_pending_children%' THEN
    RAISE EXCEPTION 'Migration 109 verification failed: _enqueue_compute_job_internal body does not include done_pending_children initial-status branch';
  END IF;
  -- P3: _enqueue body uses serialization_failure (race-loss path)
  IF v_body NOT ILIKE '%serialization_failure%' THEN
    RAISE EXCEPTION 'Migration 109 verification failed: _enqueue_compute_job_internal body does not raise serialization_failure on race loss';
  END IF;

  -- P6: mark_compute_job_done body has the idempotent branch
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'mark_compute_job_done';
  IF v_body IS NULL OR v_body NOT ILIKE '%P6%idempotent%' THEN
    RAISE EXCEPTION 'Migration 109 verification failed: mark_compute_job_done body lacks the idempotent-retry branch';
  END IF;

  -- P4: mark_compute_job_failed RAISE NOTICE on ELSE arm
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'mark_compute_job_failed';
  IF v_body IS NULL OR v_body NOT ILIKE '%safety-net ELSE arm%' THEN
    RAISE EXCEPTION 'Migration 109 verification failed: mark_compute_job_failed body lacks the safety-net ELSE NOTICE';
  END IF;

  -- P2: reclaim_stuck_compute_jobs decrements attempts
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'reclaim_stuck_compute_jobs';
  IF v_body IS NULL OR v_body NOT ILIKE '%GREATEST(attempts - 1, 0)%' THEN
    RAISE EXCEPTION 'Migration 109 verification failed: reclaim_stuck_compute_jobs body does not decrement attempts';
  END IF;

  -- P17: check_fan_in_ready RAISES NOTICE on missing child
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'check_fan_in_ready';
  IF v_body IS NULL OR v_body NOT ILIKE '%orphan parent_job_ids%' THEN
    RAISE EXCEPTION 'Migration 109 verification failed: check_fan_in_ready body lacks the orphan-NOTICE branch';
  END IF;
END $$;

COMMIT;
