-- Migration 076: per-api_key reconstruction idempotency gate.
--
-- Bug context (see /investigate report 2026-04-22)
-- -------------------------------------------------
-- Migration 070's request_allocator_holdings_sync RPC short-circuits
-- the reconstruct_allocator_history enqueue with an ALLOCATOR-SCOPED
-- snapshot count: `IF v_snapshot_count = 0 THEN enqueue`. The handler
-- run_reconstruct_allocator_history_job mirrors the same gate against
-- snapshot count. Once ANY snapshot exists for the allocator, NO future
-- api_key ever gets reconstructed — including:
--   1. The original key's real backfill, if seed/test rows were planted.
--   2. Every additional exchange the user adds after their first one.
--
-- Fix
-- ---
-- Replace the snapshot-count gate with a per-api_key lookup against
-- compute_jobs. The new gate skips ONLY when this exact api_key_id has
-- already produced a reconstruct_allocator_history job that's done OR is
-- currently in-flight (pending/running/done_pending_children — those are
-- already protected by the partial unique index from migration 070, but
-- we check anyway so the user-facing RPC doesn't even attempt the insert
-- and trigger an unique_violation log line for a benign duplicate).
--
-- The companion handler patch (analytics-service/services/equity_reconstruction.py)
-- replaces _existing_snapshot_count(allocator_id) with a status='done'
-- compute_jobs lookup keyed on api_key_id.
--
-- Why compute_jobs is the right source of truth
-- ---------------------------------------------
-- * allocator_equity_snapshots is keyed (allocator_id, asof) and
--   intentionally aggregates across keys at UPSERT time (migration 070
--   STEP 1 design + threat T-07-V5b mitigation). It cannot answer
--   "did THIS key's reconstruct ever complete".
-- * compute_jobs already records every reconstruct attempt with
--   api_key_id + status, including terminal `done`. The partial unique
--   index `compute_jobs_one_inflight_reconstruct_per_api_key` already
--   enforces the in-flight invariant; this migration leans on the same
--   table for the historical "ever completed" check.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: Replace request_allocator_holdings_sync with per-api_key gate
-- ==========================================================================
CREATE OR REPLACE FUNCTION request_allocator_holdings_sync(p_api_key_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid                UUID := auth.uid();
  v_owner              UUID;
  v_job_id             UUID;
  v_next_attempt       TIMESTAMPTZ;
  v_prior_reconstruct  BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_owner
    FROM api_keys
    WHERE id = p_api_key_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'api_key_not_found_or_not_owned'
      USING ERRCODE = '42501';
  END IF;

  -- Existing poll enqueue (preserve semantics exactly — Phase 06 / D-14).
  BEGIN
    v_job_id := enqueue_compute_job(
      p_strategy_id := NULL,
      p_kind        := 'poll_allocator_positions',
      p_api_key_id  := p_api_key_id
    );
  EXCEPTION WHEN unique_violation THEN
    -- f8: surface next_attempt_at so the UI can render deferred-cooldown
    -- state on a per-exchange rate-limit contagion event.
    SELECT next_attempt_at INTO v_next_attempt
      FROM compute_jobs
      WHERE api_key_id = p_api_key_id
        AND kind = 'poll_allocator_positions'
        AND status IN ('pending','running','done_pending_children')
      ORDER BY next_attempt_at DESC
      LIMIT 1;
    RETURN jsonb_build_object(
      'already_inflight', true,
      'next_attempt_at', v_next_attempt
    );
  END;

  -- Per-api_key reconstruction gate (replaces migration 070's allocator-
  -- scoped snapshot-count check). Skip enqueue ONLY if THIS key has
  -- previously completed a reconstruct OR is currently in-flight.
  SELECT EXISTS (
    SELECT 1 FROM compute_jobs
    WHERE api_key_id = p_api_key_id
      AND kind = 'reconstruct_allocator_history'
      AND status IN ('done','pending','running','done_pending_children')
  ) INTO v_prior_reconstruct;

  IF NOT v_prior_reconstruct THEN
    BEGIN
      PERFORM enqueue_compute_job(
        p_strategy_id     := NULL,
        p_kind            := 'reconstruct_allocator_history',
        p_idempotency_key := 'reconstruct-alloc-' || p_api_key_id::text || '-initial',
        p_api_key_id      := p_api_key_id
      );
    EXCEPTION WHEN unique_violation THEN
      NULL; -- racing first-connect call landed first; benign
    END;
  END IF;

  UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
END;
$$;

COMMENT ON FUNCTION request_allocator_holdings_sync IS
  'Authenticated wrapper. Enqueues poll_allocator_positions; for any api_key with no prior reconstruct_allocator_history job (done or in-flight) also enqueues that. Phase 07 / Migration 076 — replaces 070''s allocator-scoped snapshot-count gate which prevented adding a second exchange.';

REVOKE ALL ON FUNCTION request_allocator_holdings_sync(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION request_allocator_holdings_sync(uuid) TO authenticated;

-- ==========================================================================
-- STEP 2: Self-verifying DO block
-- ==========================================================================
DO $$
DECLARE
  v_rpc_src TEXT;
BEGIN
  SELECT prosrc INTO v_rpc_src
    FROM pg_proc
    WHERE proname = 'request_allocator_holdings_sync' AND pronargs = 1;

  IF v_rpc_src IS NULL THEN
    RAISE EXCEPTION 'Migration 076 failed: request_allocator_holdings_sync function missing';
  END IF;

  -- Body must reference compute_jobs (new gate source) AND api_key_id
  -- (per-key scope) AND must NOT depend on allocator_equity_snapshots count
  -- for the reconstruct branch. We assert positively on the new gate.
  IF v_rpc_src NOT LIKE '%compute_jobs%'
     OR v_rpc_src NOT LIKE '%v_prior_reconstruct%'
     OR v_rpc_src NOT LIKE '%api_key_id = p_api_key_id%' THEN
    RAISE EXCEPTION 'Migration 076 failed: per-api_key gate not present in request_allocator_holdings_sync. Got: %',
      left(v_rpc_src, 400);
  END IF;

  -- The OLD snapshot-count gate was `v_snapshot_count` against
  -- allocator_equity_snapshots — that variable name MUST be gone.
  IF v_rpc_src LIKE '%v_snapshot_count%' THEN
    RAISE EXCEPTION 'Migration 076 failed: legacy v_snapshot_count gate still present in request_allocator_holdings_sync';
  END IF;

  RAISE NOTICE 'Migration 076: per-api_key reconstruction gate verified.';
END$$;

COMMIT;
