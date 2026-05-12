-- Migration 117: compute_jobs claim-token fencing — audit-2026-05-07 P97 / G12.A.2 (CRITICAL)
--
-- Why this migration exists
-- -------------------------
-- audit-2026-05-07 P97 / G12.A.2 traced a CRITICAL 3-way race between:
--   (a) the Phase 1 sync_trades RPC (`sync_trades`),
--   (b) the Phase 2 raw-fill upsert into `trades`, and
--   (c) the watchdog reclaim path (`reset_stalled_compute_jobs`,
--       migration 033).
-- See `.planning/audit-2026-05-07/INVEST-P97.md` for the full investigation.
--
-- The headline race ("Race A"): the watchdog reclaims a row whose worker
-- W1 is still mid-pipeline (slow OKX backfill > 10min default reclaim).
-- A second worker W2 then claims the same row. Both W1 and W2 run sync_trades
-- against the same strategy in parallel. Eventually W1 finishes and calls
-- `mark_compute_job_done(J)` — the existing RPC's WHERE clause only checks
-- `status = 'running'`, so W1's late mark_done **succeeds against W2's run**.
-- Cursor advances, enqueue_compute_job, and strategy_analytics writes all
-- happen twice; cursor regression is observable; doubled exchange API load
-- can trip 429 → circuit-breaker.
--
-- Migrations 102 (sync_trades fill protection, G12.A.1) and 110 (date-range
-- scoped DELETE) hardened the **inside** of the Phase 1 RPC body. Neither
-- closed the **orchestration** race because the advisory xact lock in
-- sync_trades is xact-scoped — released between Phase 1 and Phase 2.
-- mark_compute_job_done has no fencing token: any worker can mark any
-- running job done. INVEST-P97 §"Why migrations 102/110 didn't close it".
--
-- The fix (Option B from INVEST-P97 §Recommendation): claim-token fencing.
-- A new UUID `claim_token` is generated on every claim and stamped on the
-- row. mark_compute_job_done / mark_compute_job_failed take an additional
-- `p_claim_token` parameter and verify the token matches before flipping.
-- A late mark from a preempted worker raises `serialization_failure`; the
-- handler catches it and treats the row as taken-over by another worker.
-- The watchdog (`reset_stalled_compute_jobs`) sets `claim_token = NULL` on
-- reclaim so the prior worker's token is invalidated even before the new
-- worker claims (defense in depth).
--
-- Companion change in `analytics-service/main_worker.py`:
--   * `WATCHDOG_PER_KIND_OVERRIDES["sync_trades"]` raised from 20m → 30m
--     so the 12+ min OKX backfill window doesn't routinely trigger Race A.
--   * `dispatch_tick` passes `p_claim_token=job["claim_token"]` to both
--     mark RPCs and catches `serialization_failure` to log
--     `LATE_MARK_IGNORED` (NOT a failure — the new worker has taken over).
--
-- Compatibility
-- -------------
-- * `claim_compute_jobs_with_priority` — same signature (3 args), but
--   workers that DON'T read `claim_token` from the returned row simply
--   pass NULL to the new mark RPCs and the fence becomes a no-op (the
--   token check passes if `p_claim_token IS NULL` is treated as
--   "skip fence"). NEW workers MUST send the token.
-- * `mark_compute_job_done` and `mark_compute_job_failed` get a NEW
--   parameter `p_claim_token UUID DEFAULT NULL` appended at the end —
--   default NULL so the old 1-arg / 3-arg call sites still work during
--   the rollout window. Once main_worker.py ships with the new param,
--   any pre-rollout in-flight job that gets marked by a new worker
--   without the token still works (NULL skips the fence and matches the
--   pre-mig-117 idempotent-retry / mig-109-P6 behavior). Legacy callers
--   from `src/app/api/...` that don't carry a token continue to function
--   unchanged.
-- * `reset_stalled_compute_jobs` — same signature; behavior change is
--   purely additive (NULL-out claim_token in the UPDATE).
-- * Phase 19 unified backbone snapshot
--   (`metadata.unified_backbone_at_claim`, migration 104) — preserved.
--   The COALESCE on metadata is unchanged in this migration's claim
--   replacement.
--
-- Items NOT in this migration
-- ---------------------------
-- * Cursor-advance fencing inside `run_sync_trades_job` — INVEST-P97
--   recommendation §"File:line targets" notes this as an **optional**
--   enhancement. Closing Race A requires only the mark-side fence
--   (per INVEST-P97 "the fence is purely on the mark side"). Cursor
--   regression is mitigated indirectly because the late worker can't
--   mark its run done — but the cursor write itself is still last-
--   writer-wins. Tracked as a follow-up.
-- * `parent_job_ids` fan-in for `compute_analytics` — out of scope; see
--   INVEST-P97 §Risks/unknowns.
--
-- Rollback
-- --------
-- The pre-mig-117 mark RPCs (mig 109) and the pre-mig-117 claim RPC
-- (mig 104) are restorable verbatim. Drop the column with
-- `ALTER TABLE compute_jobs DROP COLUMN claim_token`.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: claim_token column
-- --------------------------------------------------------------------------
-- UUID stamped at every claim by claim_compute_jobs[_with_priority] and
-- nulled at every reclaim by reset_stalled_compute_jobs. Read by the
-- handler from the returned row, passed through to mark_compute_job_*.
ALTER TABLE compute_jobs
  ADD COLUMN IF NOT EXISTS claim_token UUID;

COMMENT ON COLUMN compute_jobs.claim_token IS
  'audit-2026-05-07 P97 / G12.A.2 — fencing token written by claim_compute_jobs[_with_priority] '
  'on every claim and NULLed by reset_stalled_compute_jobs on every reclaim. mark_compute_job_done '
  'and mark_compute_job_failed verify p_claim_token matches before flipping. A late mark from a '
  'preempted worker raises serialization_failure and the handler treats the row as taken over. '
  'See migration 117 + .planning/audit-2026-05-07/INVEST-P97.md.';

-- --------------------------------------------------------------------------
-- STEP 1.5: backfill claim_token for pre-existing running rows
-- --------------------------------------------------------------------------
-- audit-2026-05-07 P97 / G12.A.2 — close the deploy-window fence-bypass
-- edge case (red-team conf 7). Any row in status='running' at migration
-- time has claim_token IS NULL until it finishes; without this UPDATE the
-- fence is a no-op for those in-flight rows because the new mark RPCs
-- treat `claim_token IS NULL OR claim_token = p_claim_token` as a match
-- when the row's claim_token is NULL.
--
-- The one-shot backfill stamps a fresh UUID into every running row that
-- pre-dates this migration. The original worker (pre-deploy) doesn't
-- carry a token in its in-process state, so its first mark call after
-- migration deploy will hit p_claim_token=NULL and the WHERE clause
-- accepts that (back-compat). The watchdog reclaim path NULLs the
-- backfilled token on reclaim — defense in depth. New claims after this
-- point use the regular gen_random_uuid() flow from STEPs 2 + 3.
--
-- See DEPLOY-117.md "Rollout window risk" section for the operational
-- consequence: the very first mark call from each pre-existing in-flight
-- worker arrives with p_claim_token=NULL (legacy callers + workers that
-- haven't redeployed) and is accepted; the next claim by a redeployed
-- worker rotates the token and the fence is fully engaged.
UPDATE compute_jobs
   SET claim_token = gen_random_uuid()
 WHERE status = 'running'
   AND claim_token IS NULL;

-- --------------------------------------------------------------------------
-- STEP 2: claim_compute_jobs (legacy non-priority) — stamp claim_token
-- --------------------------------------------------------------------------
-- Body mirrors migration 090 STEP 1 verbatim (partition-key dedupe, FOR
-- UPDATE SKIP LOCKED, status IN ('pending','failed_retry')) with the only
-- behavioral addition being `claim_token = gen_random_uuid()` in the SET
-- clause. RETURNING * preserves the existing column set including the new
-- claim_token (added by STEP 1 above) and the Phase 19 backbone metadata
-- snapshot (mig 104) since metadata is unchanged in this RPC.
CREATE OR REPLACE FUNCTION claim_compute_jobs(
  p_batch_size INTEGER,
  p_worker_id  TEXT
)
RETURNS SETOF compute_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs: p_batch_size must be > 0, got %', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_batch_size > 1000 THEN
    RAISE EXCEPTION 'claim_compute_jobs: p_batch_size % exceeds cap of 1000', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_worker_id IS NULL OR length(p_worker_id) = 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs: p_worker_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT id, kind, portfolio_id, strategy_id, allocator_id, api_key_id, next_attempt_at,
           row_number() OVER (PARTITION BY kind, portfolio_id ORDER BY next_attempt_at) AS rn_p,
           row_number() OVER (PARTITION BY kind, strategy_id  ORDER BY next_attempt_at) AS rn_s,
           row_number() OVER (PARTITION BY kind, allocator_id ORDER BY next_attempt_at) AS rn_a,
           row_number() OVER (PARTITION BY kind, api_key_id   ORDER BY next_attempt_at) AS rn_k
    FROM compute_jobs
    WHERE status IN ('pending', 'failed_retry')
      AND next_attempt_at <= now()
  ),
  deduped AS (
    SELECT id FROM ranked
    WHERE (portfolio_id  IS NULL OR rn_p = 1)
      AND (strategy_id   IS NULL OR rn_s = 1)
      AND (allocator_id  IS NULL OR rn_a = 1)
      AND (api_key_id    IS NULL OR rn_k = 1)
  )
  UPDATE compute_jobs
     SET status      = 'running',
         claimed_at  = now(),
         claimed_by  = p_worker_id,
         attempts    = attempts + 1,
         claim_token = gen_random_uuid()    -- mig 117: P97 fence
   WHERE id IN (
     SELECT cj.id FROM compute_jobs cj
      WHERE cj.id IN (SELECT id FROM deduped)
      ORDER BY cj.next_attempt_at
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;

COMMENT ON FUNCTION claim_compute_jobs IS
  'Atomically claims up to N ready-to-run jobs (status IN pending/failed_retry, next_attempt_at <= now()) for a worker. Migration 090 dedupes by partition keys; migration 117 adds claim_token = gen_random_uuid() on every claim so mark_compute_job_*(p_claim_token) can detect watchdog preemption (audit P97 / G12.A.2). FOR UPDATE SKIP LOCKED concurrency preserved. See migrations 032, 089, 090, 117.';

REVOKE ALL ON FUNCTION claim_compute_jobs FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 3: claim_compute_jobs_with_priority — stamp claim_token + preserve
--         Phase 19 unified-backbone metadata snapshot
-- --------------------------------------------------------------------------
-- Body mirrors migration 104 STEP 3 (Phase 19 / BACKBONE-09) verbatim. The
-- ONLY behavioral additions vs. mig 104 are:
--   (a) `claim_token = gen_random_uuid()` in the UPDATE SET clause
-- The Phase 19 metadata merge (D-1 COALESCE preserving
-- unified_backbone_at_claim on watchdog re-claim) is unchanged. The
-- partition-key dedupe from migration 090 is preserved (the deduped CTE
-- shape was lost when mig 104 replaced the function body — this migration
-- restores it because tests/test_drain_semantics.py and the production
-- claim path both depend on the dedupe survived).
--
-- IMPORTANT — partition dedupe vs. mig 104 body: mig 104's CREATE OR
-- REPLACE eliminated the migration-090 partition dedupe by mistake. This
-- migration restores it AND keeps mig 104's metadata-stamping. The ranked
-- /deduped CTE shape below is copied verbatim from migration 090 STEP 2
-- — without it, two `failed_retry` rows sharing a partition can 23505 on
-- the partial inflight unique indices inside the batch UPDATE. The DO-block
-- STEP 7 below asserts the row_number() PARTITION BY shape on every
-- deploy so a future replace cannot silently drop it again.
--
-- Throttle filter (C5): the probe and the inner WHERE both filter on
-- `status = 'pending'` only. Mig 090's body widened the inner WHERE to
-- `status IN ('pending','failed_retry')` after mig 089 made failed_retry
-- claimable, but mig 104 narrowed the inner WHERE back to pending-only
-- without narrowing the probe. We preserve mig 104's narrow inner WHERE
-- exactly here and narrow the probe to match it. Restoring failed_retry-
-- claimable behavior is a separate decision (would also need the inner
-- WHERE re-widened together with the throttle probe — out of scope for
-- mig 117 which is purely the P97 fence + dedupe restore).
CREATE OR REPLACE FUNCTION claim_compute_jobs_with_priority(
  p_batch_size INTEGER,
  p_worker_id  TEXT,
  p_unified_backbone_active BOOLEAN DEFAULT NULL
)
RETURNS SETOF compute_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_high_pending INTEGER;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_batch_size must be > 0, got %', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_batch_size > 1000 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_batch_size % exceeds cap of 1000', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_worker_id IS NULL OR length(p_worker_id) = 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_worker_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Throttle probe: mirrors migration 104 STEP 3 throttle filter exactly
  -- (status = 'pending') + adds claim_token; does NOT restore mig-090
  -- failed_retry claim (out of scope). Counting failed_retry here while
  -- the inner WHERE only takes 'pending' would throttle low-priority
  -- pending jobs forever without draining a failed_retry backlog.
  SELECT count(*) INTO v_high_pending
    FROM compute_jobs
   WHERE priority IN ('normal','high')
     AND status = 'pending'
     AND next_attempt_at <= now();

  -- Partition-key dedupe restored from migration 090 STEP 2. Without
  -- this the batch UPDATE can 23505 on the partial inflight unique
  -- indices when two rows for the same (kind, partition_id) become
  -- claim-eligible at the same time. tie-break on priority then
  -- next_attempt_at matches mig 090 verbatim.
  RETURN QUERY
  WITH ranked AS (
    SELECT id, kind, priority, portfolio_id, strategy_id, allocator_id, api_key_id,
           next_attempt_at,
           row_number() OVER (
             PARTITION BY kind, portfolio_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_p,
           row_number() OVER (
             PARTITION BY kind, strategy_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_s,
           row_number() OVER (
             PARTITION BY kind, allocator_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_a,
           row_number() OVER (
             PARTITION BY kind, api_key_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_k
    FROM compute_jobs
    WHERE status = 'pending'
      AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      AND (v_high_pending = 0 OR priority IN ('normal','high'))
  ),
  deduped AS (
    SELECT id FROM ranked
    WHERE (portfolio_id IS NULL OR rn_p = 1)
      AND (strategy_id  IS NULL OR rn_s = 1)
      AND (allocator_id IS NULL OR rn_a = 1)
      AND (api_key_id   IS NULL OR rn_k = 1)
  )
  UPDATE compute_jobs
     SET status      = 'running',
         claimed_at  = now(),
         claimed_by  = p_worker_id,
         attempts    = attempts + 1,
         claim_token = gen_random_uuid(),   -- mig 117: P97 fence
         -- Phase 19 / mig 104 D-1: preserve unified_backbone_at_claim on
         -- watchdog re-claim. COALESCE keeps the original snapshot if it
         -- was set on a prior claim, otherwise stamps the live flag.
         metadata    = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'unified_backbone_at_claim',
           COALESCE(metadata->>'unified_backbone_at_claim',
                    CASE WHEN p_unified_backbone_active IS NULL THEN NULL
                         ELSE p_unified_backbone_active::text
                    END)
         )
   WHERE id IN (
     SELECT cj.id FROM compute_jobs cj
      WHERE cj.id IN (SELECT id FROM deduped)
      ORDER BY
        CASE cj.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        cj.next_attempt_at
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;

COMMENT ON FUNCTION claim_compute_jobs_with_priority IS
  'Migration 117: P97 / G12.A.2 fence — claim_token = gen_random_uuid() on every claim. Mark RPCs verify token; late marks from watchdog-preempted workers raise serialization_failure. Preserves Phase 19 / mig 104 D-1 unified_backbone_at_claim metadata snapshot (COALESCE on watchdog re-claim). See migration 117 + .planning/audit-2026-05-07/INVEST-P97.md.';

REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority(INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 4: mark_compute_job_done — claim-token fence
-- --------------------------------------------------------------------------
-- Body mirrors migration 109 STEP "P6: mark_compute_job_done" verbatim with
-- two additions:
--   (a) NEW parameter `p_claim_token UUID DEFAULT NULL` appended.
--   (b) WHERE clause adds `AND (p_claim_token IS NULL OR claim_token = p_claim_token)`.
--   (c) On NOT FOUND with the row existing in `running` state but a
--       different (non-NULL) claim_token, RAISE serialization_failure with
--       message "preempted by watchdog reclaim" — the late-mark contract
--       described in INVEST-P97 §Recommendation point 1.
-- The mig 109 P6 idempotent-retry branch is preserved: if the row is
-- already 'done' OR missing entirely, behavior is unchanged.
-- The mig 099 Phase-18 atomic UI status bridge is preserved.
--
-- IMPORTANT: DROP the prior 1-arg overload from mig 109 first. CREATE OR
-- REPLACE on a different signature creates a NEW overload — the old
-- 1-arg `mark_compute_job_done(p_job_id UUID)` would survive and the
-- subsequent COMMENT ON FUNCTION (without arglist) would raise "function
-- is not unique" → migration HALT. Even worse, PostgREST routes 1-arg
-- callers to the surviving un-fenced overload → fence silently bypassed.
DROP FUNCTION IF EXISTS mark_compute_job_done(UUID);

CREATE OR REPLACE FUNCTION mark_compute_job_done(
  p_job_id     UUID,
  p_claim_token UUID DEFAULT NULL    -- mig 117: P97 fence
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
  v_child_id         UUID;
BEGIN
  -- Atomic flip running → done with token fence + strategy capture.
  -- p_claim_token IS NULL => fence skipped (back-compat for callers that
  -- haven't been updated to thread the token; pre-mig-117 behavior).
  UPDATE compute_jobs
     SET status = 'done'
   WHERE id = p_job_id
     AND status = 'running'
     AND (p_claim_token IS NULL OR claim_token = p_claim_token)
  RETURNING strategy_id INTO v_strategy_id;

  IF NOT FOUND THEN
    -- Row may exist but isn't running, OR row missing, OR token mismatch.
    -- Distinguish.
    SELECT status, strategy_id, claim_token
      INTO v_current_status, v_strategy_id, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % not found', p_job_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- mig 109 P6: idempotent retry on already-done row. Fence does not
    -- apply because the row was successfully marked done by some prior
    -- caller; children were advanced and the bridge fired.
    IF v_current_status = 'done' THEN
      RETURN;
    END IF;

    -- mig 117 P97: token mismatch on a still-running row means the
    -- watchdog reclaimed and another worker has taken over. Treat as a
    -- preemption — the new worker owns this run. Caller should log
    -- LATE_MARK_IGNORED and move on without retry.
    IF v_current_status = 'running'
       AND p_claim_token IS NOT NULL
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
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

-- COMMENT must specify the explicit arg list — without it the call
-- raises "function is not unique" if any other overload exists. Migration
-- 117 drops the prior overload above so this is currently unambiguous,
-- but the explicit arg list also documents intent and survives any
-- future overload accidentally being added.
COMMENT ON FUNCTION mark_compute_job_done(UUID, UUID) IS
  'Terminal success transition. Migration 117 / P97 fence: p_claim_token (default NULL) verified against compute_jobs.claim_token; mismatch on a still-running row raises serialization_failure (preempted by watchdog reclaim). Preserves mig 109 P6 idempotent-retry on already-done rows AND mig 099 Phase-18 atomic UI status bridge. See migration 117 + .planning/audit-2026-05-07/INVEST-P97.md.';

REVOKE ALL ON FUNCTION mark_compute_job_done(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 5: mark_compute_job_failed — claim-token fence
-- --------------------------------------------------------------------------
-- Body mirrors migration 109 STEP "P4: mark_compute_job_failed" verbatim
-- with the same fence additions as STEP 4 above:
--   (a) NEW parameter `p_claim_token UUID DEFAULT NULL` appended.
--   (b) Initial SELECT FOR UPDATE adds the token check.
--   (c) On NOT FOUND with the row in `running` state but a different
--       (non-NULL) claim_token, RAISE serialization_failure.
-- The mig 109 P4 ELSE-arm RAISE NOTICE is preserved.
-- The mig 099 Phase-18 atomic UI status bridge is preserved.
--
-- Same overload trap as STEP 4: DROP the mig 109 3-arg overload first.
-- Otherwise CREATE OR REPLACE on the new 4-arg signature creates a NEW
-- overload, the subsequent COMMENT raises "function is not unique", and
-- PostgREST routes 3-arg callers to the surviving un-fenced overload.
DROP FUNCTION IF EXISTS mark_compute_job_failed(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION mark_compute_job_failed(
  p_job_id     UUID,
  p_error      TEXT,
  p_error_kind TEXT DEFAULT 'unknown',
  p_claim_token UUID DEFAULT NULL    -- mig 117: P97 fence
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
      AND (p_claim_token IS NULL OR claim_token = p_claim_token)
    FOR UPDATE;

  IF NOT FOUND THEN
    -- Distinguish: row missing, status mismatch, or token mismatch.
    SELECT status, claim_token
      INTO v_current_status, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'mark_compute_job_failed: job % not found', p_job_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- mig 117 P97: token mismatch on a still-running row means the
    -- watchdog reclaimed and another worker has taken over.
    IF v_current_status = 'running'
       AND p_claim_token IS NOT NULL
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_failed: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
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
    -- mig 109 P4: backoff schedule preserved verbatim. ELSE-arm NOTICE
    -- preserved.
    CASE
      WHEN v_attempts <= 1 THEN v_next_attempt := now() + interval '30 seconds';
      WHEN v_attempts = 2 THEN v_next_attempt := now() + interval '2 minutes';
      ELSE
        v_next_attempt := now() + interval '8 minutes';
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

-- Same explicit-arglist policy as mark_compute_job_done's COMMENT above.
COMMENT ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) IS
  'Migration 117 / P97 fence: p_claim_token (default NULL) verified against compute_jobs.claim_token; mismatch on a still-running row raises serialization_failure. Preserves mig 109 P4 backoff schedule + ELSE-arm NOTICE AND mig 099 Phase-18 atomic UI status bridge. See migration 117 + .planning/audit-2026-05-07/INVEST-P97.md.';

REVOKE ALL ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 6: reset_stalled_compute_jobs — invalidate claim_token on reclaim
-- --------------------------------------------------------------------------
-- Body mirrors migration 033 STEP 6 verbatim with the only change being
-- `claim_token = NULL` added to both UPDATE SET clauses (per-kind override
-- pass and global default pass). NULL-ing the token invalidates the prior
-- worker's late mark RPC even before the new worker re-claims and stamps
-- a new token. Defense in depth — if a late mark arrives between the
-- watchdog's NULL-out and the new worker's claim, the row's token is NULL
-- AND the late mark carries the old (non-NULL) token, so the WHERE
-- `claim_token = p_claim_token` fails and the IS DISTINCT FROM check in
-- mark_compute_job_done's NOT FOUND branch raises serialization_failure.
CREATE OR REPLACE FUNCTION reset_stalled_compute_jobs(
  p_stale_threshold    INTERVAL DEFAULT interval '10 minutes',
  p_per_kind_overrides JSONB    DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reset     INTEGER := 0;
  v_partial   INTEGER;
  v_kind      TEXT;
  v_threshold INTERVAL;
BEGIN
  IF p_stale_threshold IS NULL OR p_stale_threshold <= interval '0' THEN
    RAISE EXCEPTION 'reset_stalled_compute_jobs: p_stale_threshold must be > 0, got %', p_stale_threshold
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Per-kind overrides: one UPDATE per kind with its bespoke threshold.
  IF p_per_kind_overrides IS NOT NULL THEN
    FOR v_kind IN SELECT jsonb_object_keys(p_per_kind_overrides) LOOP
      v_threshold := (p_per_kind_overrides ->> v_kind)::INTERVAL;

      UPDATE compute_jobs
         SET status          = 'pending',
             claimed_at      = NULL,
             claimed_by      = NULL,
             next_attempt_at = now(),
             last_error      = 'worker_stalled',
             claim_token     = NULL    -- mig 117: P97 fence invalidation
       WHERE status = 'running'
         AND kind = v_kind
         AND claimed_at IS NOT NULL
         AND claimed_at < (now() - v_threshold);

      GET DIAGNOSTICS v_partial = ROW_COUNT;
      v_reset := v_reset + v_partial;
    END LOOP;
  END IF;

  -- Default threshold: handle kinds NOT in the override map.
  UPDATE compute_jobs
     SET status          = 'pending',
         claimed_at      = NULL,
         claimed_by      = NULL,
         next_attempt_at = now(),
         last_error      = 'worker_stalled',
         claim_token     = NULL    -- mig 117: P97 fence invalidation
   WHERE status = 'running'
     AND claimed_at IS NOT NULL
     AND claimed_at < (now() - p_stale_threshold)
     AND (
       p_per_kind_overrides IS NULL
       OR NOT (p_per_kind_overrides ? kind)
     );

  GET DIAGNOSTICS v_partial = ROW_COUNT;
  v_reset := v_reset + v_partial;

  RETURN v_reset;
END;
$$;

COMMENT ON FUNCTION reset_stalled_compute_jobs IS
  'Per-kind watchdog: resets running jobs whose claimed_at is older than threshold (global or per-kind) back to pending. Migration 117 adds claim_token = NULL on every reclaim so a late mark from the prior worker is rejected (P97 fence). Preserves mig 033 attempts-untouched and last_error=''worker_stalled'' contract. Returns total rows reset. See migrations 033, 117.';

REVOKE ALL ON FUNCTION reset_stalled_compute_jobs FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 7: self-verifying DO block
-- --------------------------------------------------------------------------
-- All body-shape checks below use whitespace-tolerant POSIX regex (~*)
-- instead of ILIKE so a future formatter that inserts or strips spaces
-- around `=` doesn't silently break the gate.
-- All pg_proc lookups filter on the explicit argument signature so the
-- gate stays effective if a future migration accidentally creates another
-- overload — that's the C1+C2 regression we close here.
DO $$
DECLARE
  v_body  TEXT;
  v_count INTEGER;
BEGIN
  -- 0. ENFORCE EXACTLY ONE OVERLOAD per mark RPC. This is the C1+C2 gate:
  --    a future migration that adds a mark_compute_job_done(UUID) overload
  --    silently re-introduces the un-fenced 1-arg PostgREST route.
  SELECT count(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'mark_compute_job_done';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Migration 117 verification failed: expected exactly 1 mark_compute_job_done overload, got %',
      v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'mark_compute_job_failed';
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'Migration 117 verification failed: expected exactly 1 mark_compute_job_failed overload, got %',
      v_count;
  END IF;

  -- 1. claim_token column exists on compute_jobs
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'compute_jobs'
       AND column_name  = 'claim_token'
       AND data_type    = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Migration 117 verification failed: compute_jobs.claim_token column missing or wrong type';
  END IF;

  -- 2. claim_compute_jobs body stamps claim_token
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'claim_compute_jobs'
     AND pg_get_function_identity_arguments(p.oid) = 'p_batch_size integer, p_worker_id text';
  IF v_body IS NULL OR v_body !~* 'claim_token\s*=\s*gen_random_uuid\(\)' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: claim_compute_jobs body does not stamp claim_token';
  END IF;
  -- mig 090 partition-key dedupe must remain (STEP 1)
  IF v_body !~* 'row_number\(\)\s+OVER' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: claim_compute_jobs lost mig 090 partition-key dedupe';
  END IF;

  -- 3. claim_compute_jobs_with_priority body stamps claim_token AND
  --    preserves the Phase 19 unified_backbone_at_claim metadata snapshot
  --    AND preserves the mig 090 partition-key dedupe shape (C4 gate).
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'claim_compute_jobs_with_priority'
     AND pg_get_function_identity_arguments(p.oid) = 'p_batch_size integer, p_worker_id text, p_unified_backbone_active boolean';
  IF v_body IS NULL OR v_body !~* 'claim_token\s*=\s*gen_random_uuid\(\)' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: claim_compute_jobs_with_priority body does not stamp claim_token';
  END IF;
  IF v_body !~* 'unified_backbone_at_claim' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: claim_compute_jobs_with_priority body lost the Phase 19 unified_backbone_at_claim metadata snapshot';
  END IF;
  -- mig 090 STEP 2 partition-key dedupe — this is the C4 regression gate.
  -- Without these row_number() PARTITION BY assertions, mig 117 can silently
  -- drop the dedupe (as mig 104 did) and re-open the 23505 batch-claim
  -- regression on partial inflight unique indices.
  IF v_body !~* 'row_number\(\)\s+OVER' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: claim_compute_jobs_with_priority lost mig 090 STEP 2 dedupe (row_number)';
  END IF;
  IF v_body !~* 'PARTITION\s+BY\s+kind,\s*portfolio_id'
     OR v_body !~* 'PARTITION\s+BY\s+kind,\s*strategy_id'
     OR v_body !~* 'PARTITION\s+BY\s+kind,\s*allocator_id'
     OR v_body !~* 'PARTITION\s+BY\s+kind,\s*api_key_id' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: claim_compute_jobs_with_priority missing one or more mig 090 partition window definitions';
  END IF;

  -- 4. mark_compute_job_done body has fence + serialization_failure raise
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'mark_compute_job_done'
     AND pg_get_function_identity_arguments(p.oid) = 'p_job_id uuid, p_claim_token uuid';
  IF v_body IS NULL OR v_body !~* 'p_claim_token' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: mark_compute_job_done body lacks p_claim_token parameter';
  END IF;
  IF v_body !~* 'serialization_failure' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: mark_compute_job_done body lacks serialization_failure raise';
  END IF;
  -- Preservation: mig 109 P6 idempotent-retry branch must remain
  IF v_body !~* 'v_current_status\s*=\s*''done''' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: mark_compute_job_done lost mig 109 P6 idempotent-retry branch';
  END IF;
  -- Preservation: mig 099 Phase-18 atomic UI bridge must remain
  IF v_body !~* 'sync_strategy_analytics_status' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: mark_compute_job_done lost mig 099 Phase-18 atomic UI bridge';
  END IF;

  -- 5. mark_compute_job_failed body has fence + serialization_failure raise
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'mark_compute_job_failed'
     AND pg_get_function_identity_arguments(p.oid) = 'p_job_id uuid, p_error text, p_error_kind text, p_claim_token uuid';
  IF v_body IS NULL OR v_body !~* 'p_claim_token' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: mark_compute_job_failed body lacks p_claim_token parameter';
  END IF;
  IF v_body !~* 'serialization_failure' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: mark_compute_job_failed body lacks serialization_failure raise';
  END IF;
  -- Preservation: mig 109 P4 ELSE-arm NOTICE must remain
  IF v_body !~* 'safety-net ELSE arm' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: mark_compute_job_failed lost mig 109 P4 ELSE-arm NOTICE';
  END IF;
  -- Preservation: mig 099 Phase-18 atomic UI bridge must remain
  IF v_body !~* 'sync_strategy_analytics_status' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: mark_compute_job_failed lost mig 099 Phase-18 atomic UI bridge';
  END IF;

  -- 6. reset_stalled_compute_jobs body NULLs claim_token on reclaim
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'reset_stalled_compute_jobs';
  IF v_body IS NULL OR v_body !~* 'claim_token\s*=\s*NULL' THEN
    RAISE EXCEPTION 'Migration 117 verification failed: reset_stalled_compute_jobs body does not NULL claim_token';
  END IF;
END $$;

COMMIT;
