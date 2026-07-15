-- ==========================================================================
-- Phase 106 (v1.10 backbone unification), Stage B / D3: retire the
-- `compute_analytics` compute-job kind as an RPC ADMISSION GUARD.
--
-- WHY A GUARD, NOT A CHECK/REGISTRY DROP: 45 historical prod compute_jobs rows
-- FK-reference kind='compute_analytics'. Dropping the kind from the registry or
-- narrowing compute_jobs_kind_check / compute_jobs_kind_target_coherence would
-- FAIL mid-deploy (migrations auto-apply to prod on merge) and orphan those
-- rows. So the registry row + BOTH CHECK constraints STAY (they keep admitting
-- the kind); this migration only makes the SANCTIONED enqueue path — the
-- SECURITY DEFINER _enqueue_compute_job_internal RPC — REJECT the retired kind
-- fail-loud with ERRCODE invalid_parameter_value. After Stage B's deletions no
-- code enqueues this kind; any stray enqueue now fails at the RPC instead of
-- poisoning the queue. Reversible: re-run the prior bodies verbatim.
--
-- Residual (accepted, T-106-14): a direct service-role table INSERT of the
-- retired kind would still pass the CHECK, but the worker's unknown-kind
-- dispatch goes permanent-FAILED (job_worker.py:5870-5882) — fail-loud.
--
-- RE-BASE DISCIPLINE (project rule: re-base SQL fns on the LATEST def — grep ALL
-- migrations for any newer CREATE OR REPLACE of either overload before editing):
--   * 7-param overload  ← 20260510180226_compute_jobs_audit_2026_05_07_g10b.sql:164
--                         (uuid,uuid,text,text,uuid[],text,jsonb); p_kind NULL
--                         guard at :190-193 — the guard block is inserted
--                         immediately AFTER it.
--   * 10-param overload ← 20260420073003_allocator_holdings.sql:330
--                         (…,uuid,uuid,timestamptz); p_kind NULL guard at
--                         :365-368 — same block inserted after it.
--   Both bodies are copied VERBATIM from their re-base sources; the ONLY change
--   is the inserted retired-kind guard. SECURITY DEFINER + `SET search_path =
--   public, pg_catalog` are preserved exactly. Grants are NOT touched
--   (CREATE OR REPLACE preserves ACLs — 20260515130001 hardened them).
--   FUTURE EDITORS: if you extend either overload, re-base on THIS file (or a
--   newer one) and KEEP the retired-kind guard.
--
-- Transaction style: NO explicit BEGIN/COMMIT — Supabase wraps each migration in
-- an implicit transaction. SET LOCAL lock_timeout applies to that wrap. This
-- migration writes ZERO table data and validates no existing rows.
-- Every RAISE format string below is a SINGLE literal (Phase 85 invariant #21 —
-- no '||' concatenation inside a RAISE format slot).
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- 7-param overload — verbatim from 20260510180226:164 with ONLY the
-- retired-kind guard inserted after the p_kind NULL guard.
-- --------------------------------------------------------------------------
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
-- 10-param overload — verbatim from 20260420073003:330 with ONLY the
-- retired-kind guard inserted after the p_kind NULL guard.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _enqueue_compute_job_internal(
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
    next_attempt_at
  )
  VALUES (
    p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id,
    p_kind, COALESCE(p_parent_job_ids, '{}'::uuid[]), p_idempotency_key,
    p_exchange, p_metadata,
    COALESCE(p_run_at, now())
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN v_new_id;
  END IF;

  -- Lost the race — re-read the winner's row.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE portfolio_id = p_portfolio_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_allocator_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE allocator_id = p_allocator_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSE
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE api_key_id = p_api_key_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  END IF;

  RETURN v_new_id;
END;
$$;

-- --------------------------------------------------------------------------
-- Self-verifying DO block (mirrors 20260710130000:110-168). Fails the deploy
-- if EITHER overload's body lost the retired-kind reject, or if the
-- compute_jobs kind CHECK stopped admitting 'compute_analytics' (regression
-- guard against a "helpful" registry/CHECK drop — the 45 historical rows
-- FK-reference it). Every RAISE format string is a SINGLE literal.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_fn7          text;
  v_fn10         text;
  v_check_clause text;
  v_oid7         oid := to_regprocedure(
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb)'
  );
  v_oid10        oid := to_regprocedure(
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)'
  );
BEGIN
  -- Both overloads must resolve.
  IF v_oid7 IS NULL THEN
    RAISE EXCEPTION 'retire-compute_analytics: 7-param _enqueue_compute_job_internal overload not found';
  END IF;
  IF v_oid10 IS NULL THEN
    RAISE EXCEPTION 'retire-compute_analytics: 10-param _enqueue_compute_job_internal overload not found';
  END IF;

  v_fn7  := pg_get_functiondef(v_oid7);
  v_fn10 := pg_get_functiondef(v_oid10);

  -- (a) both bodies carry the retired-kind reject.
  IF position('compute_analytics is retired' IN v_fn7) = 0 THEN
    RAISE EXCEPTION 'retire-compute_analytics: 7-param overload is missing the retired-kind guard';
  END IF;
  IF position('compute_analytics is retired' IN v_fn10) = 0 THEN
    RAISE EXCEPTION 'retire-compute_analytics: 10-param overload is missing the retired-kind guard';
  END IF;

  -- (b) both reject with invalid_parameter_value + preserve SECDEF/search_path.
  IF v_fn7 !~* 'invalid_parameter_value' OR v_fn10 !~* 'invalid_parameter_value' THEN
    RAISE EXCEPTION 'retire-compute_analytics: an overload lost the invalid_parameter_value ERRCODE';
  END IF;
  IF v_fn7 !~* 'SECURITY DEFINER' OR v_fn10 !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'retire-compute_analytics: an overload lost SECURITY DEFINER';
  END IF;
  IF v_fn7 !~* 'search_path' OR v_fn10 !~* 'search_path' THEN
    RAISE EXCEPTION 'retire-compute_analytics: an overload lost SET search_path';
  END IF;

  -- (c) regression guard: the kind CHECK MUST STILL admit compute_analytics
  -- (45 historical prod rows FK-reference it — no CHECK/registry drop).
  SELECT pg_get_constraintdef(oid) INTO v_check_clause
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass
     AND conname = 'compute_jobs_kind_check';
  IF v_check_clause IS NULL OR position('compute_analytics' IN v_check_clause) = 0 THEN
    RAISE EXCEPTION 'retire-compute_analytics: compute_jobs_kind_check no longer admits compute_analytics (registry/CHECK must STAY — 45 historical rows FK-reference it)';
  END IF;

  RAISE NOTICE 'compute_analytics kind retired at the RPC in BOTH overloads; registry/CHECK still admit the historical kind.';
END
$$;
