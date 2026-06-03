-- audit-2026-05-07 compute_jobs SECDEF-RPC corrections (G21/G23 residual).
--
-- Two forward CREATE OR REPLACE corrections to compute_jobs queue RPCs,
-- re-based byte-for-byte on the LATEST live definitions (so no dedupe / C39 /
-- throttle / strict-token invariant is dropped) with only the surgical change
-- per finding. A self-verifying DO block at the end asserts BOTH the new fixes
-- AND the pre-existing invariants are present in the live bodies, so a future
-- full-body rewrite cannot silently revert them again (which is exactly how
-- G23-187-mig-01/03 below regressed).
--
-- STEP 1  M-1137 / M-1138  (claim_compute_jobs + claim_compute_jobs_with_priority)
--   On a failed_retry -> running re-claim, the claim UPDATE set status/claimed_*/
--   attempts/claim_token (+ metadata for the priority variant) but did NOT clear
--   last_error / error_kind. So a re-claimed (now status='running') row kept the
--   PRIOR attempt's error string, which get_admin_compute_jobs surfaces
--   un-redacted -- an admin-observability lie + a needlessly extended exposure
--   window for any residual sensitive substring in last_error. Fix: add
--   `last_error = NULL, error_kind = NULL` to both UPDATE SET clauses. Safe +
--   self-healing: mark_compute_job_failed (20260529180000) unconditionally
--   re-writes both on the next failure; no code reads a running row's last_error
--   to drive behavior (sole reader is admin observability).
--   Latest bases: 20260528061155 (claim_compute_jobs),
--                 20260601193000 (claim_compute_jobs_with_priority).
--
-- STEP 2  G23-187-mig-01 / mig-03  (mark_compute_job_done)
--   The B5 strict-token rewrite (20260528183100) copied a pre-20260516131500
--   body and silently reverted the fan-in advance from the GIN-supported,
--   set-based `parent_job_ids @> ARRAY[p_job_id]::uuid[]` UPDATE back to a
--   per-child `= ANY(parent_job_ids)` FOR-loop that the planner cannot push to
--   the GIN index compute_jobs_parent_lookup -- re-introducing the exact
--   seq-scan + N+1 check_fan_in_ready overhead H-0864 had closed. Functionally
--   correct, purely a perf regression. Fix: re-apply the set-based @> form
--   (live in prod 2026-05-16..2026-05-28) on top of the LATEST strict-token gate
--   verbatim. This finding pair regressed because NOTHING pinned the @> form --
--   the STEP 3 self-verify now does.
--
-- Production impact: worker is the sole caller of all three RPCs; no signature
-- change; STEP 1 is a hygiene no-op for the worker path; STEP 2 only changes the
-- query PLAN of fan-in advance (same result set).

BEGIN;

-- ==========================================================================
-- STEP 1a: claim_compute_jobs (non-priority fallback path) -- clear stale error
-- ==========================================================================
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
           -- H-1238: append `, id` to every row_number() ORDER BY for a
           -- deterministic tie-break when two rows share next_attempt_at.
           row_number() OVER (PARTITION BY kind, portfolio_id ORDER BY next_attempt_at, id) AS rn_p,
           row_number() OVER (PARTITION BY kind, strategy_id  ORDER BY next_attempt_at, id) AS rn_s,
           row_number() OVER (PARTITION BY kind, allocator_id ORDER BY next_attempt_at, id) AS rn_a,
           row_number() OVER (PARTITION BY kind, api_key_id   ORDER BY next_attempt_at, id) AS rn_k
    FROM compute_jobs
    WHERE status IN ('pending', 'failed_retry')
      AND next_attempt_at <= now()
  ),
  deduped AS (
    SELECT id FROM ranked
    WHERE (portfolio_id  IS NULL OR rn_p = 1)
      -- H-1235: carve-out for compute_intro_snapshot. The partial unique
      -- index `compute_jobs_one_inflight_per_kind_strategy` (mig 048)
      -- excludes this kind via `kind <> 'compute_intro_snapshot'`, so
      -- multiple intro_snapshot rows sharing a strategy_id (different
      -- allocators) can legitimately coexist. Without this carve-out the
      -- dedupe forces sequential drain — slowing the queue with no
      -- 23505 risk to prevent.
      AND (strategy_id   IS NULL OR kind = 'compute_intro_snapshot' OR rn_s = 1)
      AND (allocator_id  IS NULL OR rn_a = 1)
      AND (api_key_id    IS NULL OR rn_k = 1)
      -- C39 / NEW-C39-01 (preserved verbatim from
      -- 20260526100000_claim_dedupe_done_pending_children_guard.sql):
      -- exclude candidates whose partition already has an inflight (running
      -- or done_pending_children) row. Without this guard a failed_retry
      -- row can coexist with a done_pending_children row for the same
      -- (kind, partition_col) and the batch UPDATE that flips failed_retry
      -- → running violates the partial unique index (23505). Per-partition
      -- column; NULL partition columns are skipped.
      AND (portfolio_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = ranked.kind
           AND x.portfolio_id = ranked.portfolio_id
           AND x.status IN ('running', 'done_pending_children')
      ))
      AND (strategy_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind        = ranked.kind
           AND x.strategy_id = ranked.strategy_id
           AND x.status IN ('running', 'done_pending_children')
      ))
      AND (allocator_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = ranked.kind
           AND x.allocator_id = ranked.allocator_id
           AND x.status IN ('running', 'done_pending_children')
      ))
      AND (api_key_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind       = ranked.kind
           AND x.api_key_id = ranked.api_key_id
           AND x.status IN ('running', 'done_pending_children')
      ))
  )
  UPDATE compute_jobs
     SET status      = 'running',
         claimed_at  = now(),
         claimed_by  = p_worker_id,
         attempts    = attempts + 1,
         claim_token = gen_random_uuid(),   -- mig 117: P97 fence
         last_error  = NULL,                -- M-1137/M-1138: clear the prior attempt's
         error_kind  = NULL                 -- error on a failed_retry -> running re-claim
   WHERE id IN (
     SELECT cj.id FROM compute_jobs cj
      WHERE cj.id IN (SELECT id FROM deduped)
        AND cj.status IN ('pending', 'failed_retry')  -- H-1/M-1: re-check status after CTE snapshot+lock to guard against concurrent status transitions
      -- F-2: append `, cj.id` so the inner ordering is fully deterministic
      -- at the LIMIT boundary. The row_number() windows above already
      -- tie-break on id (H-1238); without this clause two candidates that
      -- tie on next_attempt_at could swap which one survives the
      -- LIMIT p_batch_size cut across pg restarts/vacuums.
      ORDER BY cj.next_attempt_at, cj.id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;

COMMENT ON FUNCTION claim_compute_jobs IS
  'Atomically claims up to N ready-to-run jobs (status IN pending/failed_retry, '
  'next_attempt_at <= now()) for a worker. Migration 090 dedupes by partition '
  'keys; migration 117 adds claim_token = gen_random_uuid() (P97 fence); C39 '
  '(20260526100000) added the done_pending_children NOT-EXISTS guard; '
  'H-1235/H-1238 + F-2 added the compute_intro_snapshot carve-out and the `, id` '
  'tie-break. THIS migration (M-1137/M-1138): clears last_error/error_kind on a '
  'failed_retry -> running re-claim so a re-claimed row no longer carries the '
  'prior attempt error. See migrations 032, 089, 090, 117, C39.';

REVOKE ALL ON FUNCTION claim_compute_jobs FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- STEP 1b: claim_compute_jobs_with_priority (live prod path) -- clear stale error
-- ==========================================================================
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

  -- M-1133: throttle probe as a `CASE WHEN EXISTS (...) THEN 1 ELSE 0 END`
  -- short-circuit (EXISTS returns boolean, never NULL, so the 0/1 semantics
  -- for `v_high_pending = 0` are preserved by construction). 2026-06-01:
  -- the status set now mirrors the base RPC — a high/normal-priority job
  -- sitting in `failed_retry` (due) is still pending work and MUST trip the
  -- throttle, otherwise the throttle under-counts the priority backlog and
  -- lets low-priority backfill through while priority retries wait.
  v_high_pending := CASE WHEN EXISTS (
    SELECT 1
      FROM compute_jobs
     WHERE priority IN ('normal','high')
       AND status IN ('pending', 'failed_retry')
       AND next_attempt_at <= now()
  ) THEN 1 ELSE 0 END;

  -- Partition-key dedupe preserved from mig 117 (which restored mig 090's
  -- shape after mig 104 silently dropped it). H-1238: every row_number()
  -- ORDER BY now ends with `, id` for a deterministic tie-break when
  -- priority + next_attempt_at both tie.
  RETURN QUERY
  WITH ranked AS (
    SELECT id, kind, priority, portfolio_id, strategy_id, allocator_id, api_key_id,
           next_attempt_at,
           row_number() OVER (
             PARTITION BY kind, portfolio_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at,
                      id
           ) AS rn_p,
           row_number() OVER (
             PARTITION BY kind, strategy_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at,
                      id
           ) AS rn_s,
           row_number() OVER (
             PARTITION BY kind, allocator_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at,
                      id
           ) AS rn_a,
           row_number() OVER (
             PARTITION BY kind, api_key_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at,
                      id
           ) AS rn_k
    FROM compute_jobs
    -- 2026-06-01: restore failed_retry candidacy (regressed by mig
    -- 20260528061155 STEP 2; base claim_compute_jobs always had it).
    WHERE status IN ('pending', 'failed_retry')
      AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      AND (v_high_pending = 0 OR priority IN ('normal','high'))
  ),
  deduped AS (
    SELECT id FROM ranked
    WHERE (portfolio_id IS NULL OR rn_p = 1)
      -- H-1235: compute_intro_snapshot carve-out — the partial unique index
      -- `compute_jobs_one_inflight_per_kind_strategy` (mig 048) excludes
      -- that kind, so per-allocator intro_snapshot rows sharing a strategy
      -- can co-claim without violating the inflight index.
      AND (strategy_id  IS NULL OR kind = 'compute_intro_snapshot' OR rn_s = 1)
      AND (allocator_id IS NULL OR rn_a = 1)
      AND (api_key_id   IS NULL OR rn_k = 1)
      -- C39 / NEW-C39-01 (ported verbatim from `claim_compute_jobs`, which
      -- inherited it from 20260526100000_claim_dedupe_done_pending_children_guard.sql):
      -- exclude candidates whose partition already has an inflight (running
      -- or done_pending_children) row. Now that failed_retry is claimable
      -- again (above), without this guard a failed_retry row can coexist
      -- with a done_pending_children / running row for the same
      -- (kind, partition_col) and the batch UPDATE that flips failed_retry
      -- -> running violates the partial unique index (23505). Per-partition
      -- column; NULL partition columns are skipped.
      AND (portfolio_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = ranked.kind
           AND x.portfolio_id = ranked.portfolio_id
           AND x.status IN ('running', 'done_pending_children')
      ))
      AND (strategy_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind        = ranked.kind
           AND x.strategy_id = ranked.strategy_id
           AND x.status IN ('running', 'done_pending_children')
      ))
      AND (allocator_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = ranked.kind
           AND x.allocator_id = ranked.allocator_id
           AND x.status IN ('running', 'done_pending_children')
      ))
      AND (api_key_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind       = ranked.kind
           AND x.api_key_id = ranked.api_key_id
           AND x.status IN ('running', 'done_pending_children')
      ))
  )
  UPDATE compute_jobs
     SET status      = 'running',
         claimed_at  = now(),
         claimed_by  = p_worker_id,
         attempts    = attempts + 1,
         claim_token = gen_random_uuid(),   -- mig 117: P97 fence
         last_error  = NULL,                -- M-1137/M-1138: clear the prior attempt's
         error_kind  = NULL,                -- error on a failed_retry -> running re-claim
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
        -- H-1/M-1: re-check status after CTE snapshot+lock to guard against
        -- concurrent status transitions between candidate selection and the
        -- FOR UPDATE (ported from claim_compute_jobs).
        AND cj.status IN ('pending', 'failed_retry')
      -- F-2: append `, cj.id` so the inner ordering is fully deterministic
      -- at the LIMIT boundary (matches the row_number() OVER tie-break above).
      ORDER BY
        CASE cj.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        cj.next_attempt_at,
        cj.id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;

COMMENT ON FUNCTION claim_compute_jobs_with_priority(INTEGER, TEXT, BOOLEAN) IS
  'Migration 117 P97 fence + Phase-19 metadata snapshot + H-1235 carve-out + '
  'H-1238 `, id` tie-break + M-1133 CASE/EXISTS throttle + 2026-06-01 restored '
  'failed_retry candidacy and C39 done_pending_children guard. THIS migration '
  '(M-1137/M-1138): clears last_error/error_kind on a failed_retry -> running '
  're-claim. All pre-existing guarantees asserted present in STEP 3.';

REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority(INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- STEP 2: mark_compute_job_done -- restore the GIN-supported set-based fan-in
-- ==========================================================================
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
        USING ERRCODE = 'serialization_failure';
    END IF;

    -- mig 117 P97: token mismatch on a still-running row.
    IF v_current_status = 'running'
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
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
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;
END;
$$;

COMMENT ON FUNCTION mark_compute_job_done(UUID, UUID) IS
  'Terminal success transition. Migration 117 P97 fence + B5 strict-token gate '
  '(20260528183100): p_claim_token MUST be non-NULL (NULL raises 22023); '
  'mismatch raises serialization_failure. THIS migration (G23-187-mig-01/03): '
  're-applies the GIN-supported set-based `parent_job_ids @> ARRAY[p_job_id]` '
  'fan-in advance (the strict-token rewrite had reverted it to a `= ANY(...)` '
  'FOR-loop). Preserves the mig 099 Phase-18 atomic UI status bridge.';

REVOKE ALL ON FUNCTION mark_compute_job_done(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- STEP 3: self-verifying assertions. Pin BOTH this migration's fixes AND the
-- pre-existing invariants of each rewritten body so a future full-body
-- CREATE OR REPLACE cannot silently revert them (G23-187-mig-01/03 regressed
-- precisely because nothing pinned the @> fan-in form).
-- ==========================================================================
DO $verify$
DECLARE
  v_claim   TEXT := pg_get_functiondef('claim_compute_jobs(integer,text)'::regprocedure);
  v_claimp  TEXT := pg_get_functiondef('claim_compute_jobs_with_priority(integer,text,boolean)'::regprocedure);
  v_done    TEXT := pg_get_functiondef('mark_compute_job_done(uuid,uuid)'::regprocedure);
BEGIN
  -- STEP 1 fix: last_error/error_kind cleared on re-claim in BOTH claim RPCs.
  IF v_claim !~* 'last_error\s*=\s*NULL' OR v_claim !~* 'error_kind\s*=\s*NULL' THEN
    RAISE EXCEPTION 'invariant: claim_compute_jobs does not clear last_error/error_kind on re-claim (M-1137/M-1138)';
  END IF;
  IF v_claimp !~* 'last_error\s*=\s*NULL' OR v_claimp !~* 'error_kind\s*=\s*NULL' THEN
    RAISE EXCEPTION 'invariant: claim_compute_jobs_with_priority does not clear last_error/error_kind on re-claim (M-1137/M-1138)';
  END IF;

  -- claim_compute_jobs_with_priority pre-existing invariants (carried from 20260601193000).
  IF v_claimp !~* 'status\s+IN\s*\(\s*''pending''\s*,\s*''failed_retry''\s*\)' THEN
    RAISE EXCEPTION 'invariant: priority RPC lost status IN (pending, failed_retry) candidacy';
  END IF;
  IF v_claimp !~* 'cj\.status\s+IN\s*\(\s*''pending''\s*,\s*''failed_retry''\s*\)' THEN
    RAISE EXCEPTION 'invariant: priority RPC lost the inner cj.status re-check';
  END IF;
  IF v_claimp !~* 'done_pending_children' THEN
    RAISE EXCEPTION 'invariant: priority RPC lost the C39 done_pending_children NOT-EXISTS guard';
  END IF;
  IF v_claimp !~* 'v_high_pending\s*:=\s*CASE\s+WHEN\s+EXISTS' OR v_claimp ~* '\mcount\s*\(' THEN
    RAISE EXCEPTION 'invariant: priority RPC throttle is not the CASE WHEN EXISTS short-circuit (M-1133)';
  END IF;
  IF v_claimp !~* 'compute_intro_snapshot' THEN
    RAISE EXCEPTION 'invariant: priority RPC lost the compute_intro_snapshot carve-out (H-1235)';
  END IF;
  IF v_claimp !~* 'claim_token\s*=\s*gen_random_uuid' THEN
    RAISE EXCEPTION 'invariant: priority RPC lost the claim_token = gen_random_uuid() P97 fence';
  END IF;
  IF v_claimp !~* 'unified_backbone_at_claim' THEN
    RAISE EXCEPTION 'invariant: priority RPC lost the unified_backbone_at_claim metadata snapshot';
  END IF;
  IF v_claimp !~* 'next_attempt_at\s*,\s*id' THEN
    RAISE EXCEPTION 'invariant: priority RPC lost the `, id` row_number tie-break (H-1238)';
  END IF;

  -- claim_compute_jobs (non-priority) pre-existing invariants — pinned
  -- symmetrically with the priority RPC (red-team B) so a future full-body
  -- revert of either body fails this guard.
  IF v_claim !~* 'status\s+IN\s*\(\s*''pending''\s*,\s*''failed_retry''\s*\)' THEN
    RAISE EXCEPTION 'invariant: base claim RPC lost status IN (pending, failed_retry) candidacy';
  END IF;
  IF v_claim !~* 'done_pending_children' THEN
    RAISE EXCEPTION 'invariant: base claim RPC lost the C39 done_pending_children guard';
  END IF;
  IF v_claim !~* 'claim_token\s*=\s*gen_random_uuid' THEN
    RAISE EXCEPTION 'invariant: base claim RPC lost the claim_token = gen_random_uuid() P97 fence';
  END IF;
  IF v_claim !~* 'compute_intro_snapshot' THEN
    RAISE EXCEPTION 'invariant: base claim RPC lost the compute_intro_snapshot carve-out (H-1235)';
  END IF;
  IF v_claim !~* 'next_attempt_at\s*,\s*id' THEN
    RAISE EXCEPTION 'invariant: base claim RPC lost the `, id` tie-break (H-1238/F-2)';
  END IF;

  -- STEP 2 fix: mark_compute_job_done uses the GIN @> fan-in, NOT the FOR-loop.
  IF v_done !~* 'parent_job_ids\s*@>\s*ARRAY\[\s*p_job_id' THEN
    RAISE EXCEPTION 'invariant: mark_compute_job_done lost the GIN @> set-based fan-in (G23-187-mig-01/03)';
  END IF;
  IF v_done ~* 'FOR\s+v_child_id\s+IN' THEN
    RAISE EXCEPTION 'invariant: mark_compute_job_done still has the regressed per-child FOR-loop fan-in';
  END IF;
  -- mark_compute_job_done pre-existing B5 strict-token gate + Phase-18 bridge.
  IF v_done !~* 'p_claim_token IS NULL' OR v_done !~* 'invalid_parameter_value' THEN
    RAISE EXCEPTION 'invariant: mark_compute_job_done lost the B5 strict-token NULL gate (20260528183100)';
  END IF;
  IF v_done !~* 'sync_strategy_analytics_status' THEN
    RAISE EXCEPTION 'invariant: mark_compute_job_done lost the Phase-18 atomic UI status bridge';
  END IF;

  RAISE NOTICE 'compute_jobs RPC corrections applied: last_error/error_kind cleared on re-claim (M-1137/M-1138); GIN @> fan-in restored (G23-187-mig-01/03); all pre-existing invariants asserted present.';
END;
$verify$;

COMMIT;
