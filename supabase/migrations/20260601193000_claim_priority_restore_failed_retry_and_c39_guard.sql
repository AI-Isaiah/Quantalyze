-- Migration: claim_compute_jobs_with_priority — restore failed_retry
--            claimability + port the C39 done_pending_children guard
--
-- Why this migration exists (root cause, found 2026-06-01)
-- -------------------------------------------------------
-- The prod worker dispatch loop (`main_worker.py:387-395`) ALWAYS calls
-- the 3-arg overload
--   claim_compute_jobs_with_priority(p_batch_size, p_worker_id,
--                                    p_unified_backbone_active)
-- because it unconditionally passes `p_unified_backbone_active`
-- (the unified-backbone flag flipped ON 2026-05-25). That 3-arg overload
-- — last defined in `20260528061155_claim_dedupe_tie_break_and_short_circuit.sql`
-- STEP 2 — filters `WHERE status = 'pending'` ONLY, in BOTH the throttle
-- probe and the `ranked` candidate CTE, and carries NO C39
-- done_pending_children NOT-EXISTS guard and NO inner status re-check.
--
-- That is a SILENT REGRESSION relative to:
--   * `claim_compute_jobs` (the base RPC): claims
--     `status IN ('pending','failed_retry')`, carries the full C39 guard
--     (added by `20260526100000_claim_dedupe_done_pending_children_guard.sql`),
--     and re-checks status inside the UPDATE.
--   * the 2-arg `claim_compute_jobs_with_priority(int,text)` overload,
--     which also still claims `('pending','failed_retry')`.
-- mig 20260428155809 ("claim_failed_retry") established failed_retry
-- claimability as the intended contract for ALL claim RPCs; the 3-arg
-- rewrite dropped it. The STEP-2 verification block in that migration
-- only asserted the CASE/EXISTS throttle shape, so the missing
-- failed_retry + guard sailed through.
--
-- IMPACT (measured on prod khslejtfbuezsmvmtsdn 2026-06-01):
-- 49 jobs were stranded in `failed_retry` and NEVER re-claimed by the
-- worker — 45 poll_allocator_positions (oldest due 2026-05-10, ~3 weeks),
-- 2 poll_positions, 1 rescore_allocator, 1 compute_analytics. Because
-- `sync_strategy_analytics_status` classifies failed_retry as
-- non-terminal ("computing"), any strategy with an orphaned failed_retry
-- sibling job was pinned at computation_status='computing' forever and
-- its dashboard never refreshed — even after its compute_analytics
-- succeeded. The whole allocator polling subsystem was silently starved.
--
-- WHAT THIS MIGRATION DOES
-- ------------------------
-- CREATE OR REPLACE the 3-arg overload with FOUR surgical changes,
-- preserving every other guarantee verbatim (M-1133 CASE/EXISTS throttle,
-- H-1238 `, id` tie-break, H-1235 compute_intro_snapshot carve-out,
-- mig-117 P97 claim_token fence, Phase-19 unified_backbone_at_claim
-- metadata snapshot, F-2 deterministic LIMIT ordering):
--   1. Throttle probe: status = 'pending' -> IN ('pending','failed_retry').
--   2. ranked CTE WHERE: status = 'pending' -> IN ('pending','failed_retry').
--   3. deduped CTE: add the C39 done_pending_children NOT-EXISTS guard on
--      all four partition columns (verbatim from `claim_compute_jobs`).
--      REQUIRED now that failed_retry is claimable: the partial unique
--      index `compute_jobs_one_inflight_per_kind_*` covers
--      ('pending','running','done_pending_children') but NOT failed_retry,
--      so a failed_retry row can legitimately coexist with a running /
--      done_pending_children sibling; flipping it to 'running' without the
--      guard would violate that index (SQLSTATE 23505).
--   4. inner UPDATE WHERE: re-check `status IN ('pending','failed_retry')`
--      after the CTE snapshot+lock (H-1/M-1) to guard against concurrent
--      status transitions between candidate selection and the FOR UPDATE.
--
-- The 2-arg overload is left untouched: it already includes failed_retry
-- and the prod worker never calls it (it always supplies the 3rd arg, so
-- PostgREST resolves to the 3-arg overload). It is effectively vestigial
-- and is flagged for a separate cleanup, not forked here.
--
-- SAFETY / PROD AUTO-APPLY
-- ------------------------
-- CREATE OR REPLACE FUNCTION: no table lock, no data migration, ACL and
-- ownership preserved (service_role keeps EXECUTE). Merging to main
-- auto-applies to prod (supabase-migrate). The COMMENT and REVOKE use the
-- explicit (INTEGER, TEXT, BOOLEAN) arg list — a bare name 42725's
-- ("function name is not unique") on prod's multiple overloads and rolls
-- back the whole single-transaction migration (see the 2026-05-28 prod
-- recovery note in 20260528061155).
--
-- ROLLBACK
-- Restoring the prior 3-arg body re-introduces the orphaning bug; safe but
-- not desirable. No schema/data is changed, so rollback is a pure function
-- redefinition.

BEGIN;

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
  'Migration 117: P97 / G12.A.2 fence — claim_token = gen_random_uuid() on every claim. '
  'Preserves Phase 19 / mig 104 D-1 unified_backbone_at_claim metadata snapshot '
  '(COALESCE on watchdog re-claim), H-1235 compute_intro_snapshot carve-out, '
  'H-1238 `, id` tie-break, M-1133 CASE WHEN EXISTS throttle. '
  '2026-06-01: restored failed_retry candidacy (throttle probe + ranked CTE + inner '
  're-check) and ported the C39 done_pending_children NOT-EXISTS guard from '
  'claim_compute_jobs — both were silently dropped by the 20260528061155 rewrite, '
  'orphaning 49 failed_retry jobs (oldest 2026-05-10). See migration header.';

REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority(INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- Self-verifying assertions — these invariants must hold after the
-- migration so the regression class cannot recur silently.
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_body TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'claim_compute_jobs_with_priority'
       AND pg_get_function_identity_arguments(p.oid)
           = 'p_batch_size integer, p_worker_id text, p_unified_backbone_active boolean'
  ) THEN
    RAISE EXCEPTION 'Migration invariant: 3-arg claim_compute_jobs_with_priority(int,text,boolean) not found';
  END IF;

  SELECT pg_get_functiondef(
           'claim_compute_jobs_with_priority(integer,text,boolean)'::regprocedure
         ) INTO v_body;

  -- THE fix (this migration):
  -- (1) failed_retry restored as a claim candidate (throttle probe + ranked
  --     CTE; the inner re-check is asserted separately at (2)).
  IF v_body !~* 'status\s+IN\s*\(\s*''pending''\s*,\s*''failed_retry''\s*\)' THEN
    RAISE EXCEPTION 'Migration invariant violated: priority RPC body lacks status IN (pending, failed_retry) — failed_retry orphaning regression';
  END IF;

  -- (2) inner UPDATE re-check after the CTE snapshot+lock (guards a
  --     concurrent status transition between candidate selection and FOR UPDATE).
  IF v_body !~* 'cj\.status\s+IN\s*\(\s*''pending''\s*,\s*''failed_retry''\s*\)' THEN
    RAISE EXCEPTION 'Migration invariant violated: priority RPC lacks the inner cj.status IN (pending, failed_retry) re-check';
  END IF;

  -- (3) C39 done_pending_children NOT-EXISTS guard (23505 protection for the
  --     failed_retry -> running flip; the inflight index excludes failed_retry).
  IF v_body !~* 'done_pending_children' THEN
    RAISE EXCEPTION 'Migration invariant violated: priority RPC body lacks the done_pending_children NOT-EXISTS guard';
  END IF;

  -- Pre-existing guarantees this full-body CREATE OR REPLACE MUST NOT silently
  -- drop. The regression that motivated this migration was exactly a guarantee
  -- lost in a body rewrite that the then-self-verify did not catch — so assert
  -- the whole fingerprint, not just the lines this PR changed.
  -- (4) M-1133 CASE/EXISTS throttle, never count(*).
  IF v_body !~* 'v_high_pending\s*:=\s*CASE\s+WHEN\s+EXISTS' OR v_body ~* 'count\s*\(' THEN
    RAISE EXCEPTION 'Migration invariant violated: priority RPC throttle is not the CASE WHEN EXISTS short-circuit (M-1133 regression)';
  END IF;
  -- (5) H-1235 compute_intro_snapshot carve-out in the strategy dedupe.
  IF v_body !~* 'compute_intro_snapshot' THEN
    RAISE EXCEPTION 'Migration invariant violated: priority RPC lost the compute_intro_snapshot carve-out (H-1235)';
  END IF;
  -- (6) mig 117 P97 claim_token fence.
  IF v_body !~* 'claim_token\s*=\s*gen_random_uuid' THEN
    RAISE EXCEPTION 'Migration invariant violated: priority RPC lost the claim_token = gen_random_uuid() P97 fence (mig 117)';
  END IF;
  -- (7) Phase 19 / mig 104 D-1 unified_backbone_at_claim metadata snapshot.
  IF v_body !~* 'unified_backbone_at_claim' THEN
    RAISE EXCEPTION 'Migration invariant violated: priority RPC lost the unified_backbone_at_claim metadata snapshot (Phase 19)';
  END IF;
  -- (8) H-1238 deterministic `, id` tie-break on the row_number() ORDER BY.
  IF v_body !~* 'next_attempt_at\s*,\s*id' THEN
    RAISE EXCEPTION 'Migration invariant violated: priority RPC lost the `, id` row_number tie-break (H-1238)';
  END IF;

  RAISE NOTICE 'Migration applied: claim_compute_jobs_with_priority(int,text,boolean) restored failed_retry candidacy + C39 guard + inner re-check; all pre-existing guarantees (M-1133/H-1235/H-1238/mig117/Phase19) asserted present.';
END;
$$;

COMMIT;
