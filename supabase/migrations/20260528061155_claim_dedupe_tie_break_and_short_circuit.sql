-- Migration: claim_compute_jobs(+_with_priority) — H-1235 carve-out,
--            H-1238 deterministic tie-break, M-1133 EXISTS short-circuit
--
-- Why this migration exists
-- -------------------------
-- audit-2026-05-07 G21 surfaced three live correctness/perf gaps against
-- migration 090 (`claim_dedupe_partition_keys`) and migration 117 (`claim
-- token fencing`) that survived through the C39 done_pending_children
-- guard added by `20260526100000_claim_dedupe_done_pending_children_guard.sql`:
--
--   * H-1235 (data-migration, conf 9): the `strategy_id` rn_s check in the
--     `deduped` CTE has no carve-out for `compute_intro_snapshot`, even
--     though the partial unique index
--     `compute_jobs_one_inflight_per_kind_strategy` (mig 048) explicitly
--     excludes that kind via `kind <> 'compute_intro_snapshot'`. Multiple
--     pending/failed_retry intro_snapshot rows sharing a strategy_id are
--     legitimate (per-allocator scope) and CAN co-claim without violating
--     the inflight index. Today they are forced to drain one-per-batch.
--
--   * H-1238 (silent-failure-hunter, conf 8): every `row_number() OVER` in
--     both RPCs orders ONLY by `next_attempt_at` (and `priority` in the
--     priority RPC). Two `failed_retry` rows that share a partition AND
--     tie on `next_attempt_at` (entirely possible — same backoff schedule,
--     same tick) make `row_number()` arbitrary across pg restarts/vacuums.
--     The dedupe loser is silently dropped this tick; which one becomes
--     runnable is implementation-defined.
--
--   * M-1133 (performance, conf 8): the `claim_compute_jobs_with_priority`
--     throttle probe uses `SELECT count(*) INTO v_high_pending` on every
--     claim tick (~12/min) even though the decision only needs
--     `v_high_pending > 0`. Replacing with `EXISTS` lets PostgreSQL
--     short-circuit on the first matching index tuple.
--
-- What this migration does
-- ------------------------
-- 1. CREATE OR REPLACE `claim_compute_jobs` (latest body lives in the C39
--    migration `20260526100000_claim_dedupe_done_pending_children_guard.sql`)
--    with these additions, preserving every C39 / mig 117 guarantee:
--      (a) `, id` appended to every `row_number() OVER (... ORDER BY ...)`
--          for deterministic tie-break (H-1238).
--      (b) `strategy_id` rn_s clause widened to
--          `(strategy_id IS NULL OR kind = 'compute_intro_snapshot' OR rn_s = 1)`
--          so intro_snapshot jobs are not falsely deduped (H-1235).
--      (c) ALL other C39 semantics preserved verbatim: status filter
--          `('pending','failed_retry')`, NOT EXISTS done_pending_children /
--          running guards per partition column, `claim_token = gen_random_uuid()`
--          P97 fence, FOR UPDATE SKIP LOCKED, search_path hardening,
--          REVOKE FROM PUBLIC.
--
-- 2. CREATE OR REPLACE `claim_compute_jobs_with_priority` (latest body lives
--    in `20260515114555_compute_jobs_claim_token_fencing.sql` — mig C39 did
--    NOT modify this function) with these additions:
--      (a) Throttle probe converted from `SELECT count(*)` to a
--          `CASE WHEN EXISTS (...) THEN 1 ELSE 0 END` short-circuit
--          (M-1133 + L1). `v_high_pending` retains 0/1 semantics so all
--          `v_high_pending = 0` checks downstream work unchanged. The
--          CASE/EXISTS shape is NULL-free by construction (vs the
--          intermediate `SELECT 1 INTO + COALESCE` shape) — eliminates
--          the always-throttle hazard from a NULL-probe drift.
--      (b) `, id` appended to every `row_number() OVER (... ORDER BY ...)`
--          AND to the inner UPDATE ORDER BY clauses (H-1238 + F-2).
--      (c) `strategy_id` rn_s clause widened with the same intro_snapshot
--          carve-out (H-1235).
--      (d) ALL other mig 117 semantics preserved: status='pending' inner
--          scan, partition dedupe, claim_token stamp, Phase 19 metadata
--          COALESCE, FOR UPDATE SKIP LOCKED, search_path hardening,
--          REVOKE FROM PUBLIC.
--
-- 3. STEP 7-style self-verifying DO block (mirrors the C39 pattern) that
--    re-asserts the structural fingerprint after each CREATE OR REPLACE so
--    a future replace cannot silently drop these guards. Checks include:
--      * `, id` present in row_number() ORDER BY of both bodies (anchored
--        INSIDE row_number() OVER per red-team / mig-reviewer L2)
--      * `, cj.id` present in the inner UPDATE ORDER BY of both bodies (F-2)
--      * `kind = 'compute_intro_snapshot'` carve-out present in both bodies
--      * priority body's throttle probe uses `CASE WHEN EXISTS` (no count(*),
--        NULL-free by construction)
--      * mig 090 partition dedupe still present (row_number())
--      * mig 117 P97 stamp still present (claim_token = gen_random_uuid())
--      * mig C39 done_pending_children NOT EXISTS guard still present in
--        non-priority body
--      * search_path = public, pg_temp re-asserted on BOTH functions per
--        the C39 H-B hardening pattern (F-4)
--
-- Closes audit findings: H-1235, H-1238, M-1133 (G21 batch).

-- SUPABASE: explicit-transaction
-- Same rationale as mig C39 / mig 117: STEP 1-2 (function replaces) and
-- STEP 3 (self-verifying DO block) must apply atomically. Pattern
-- consistent with every multi-step compute_jobs migration since mig 090.
BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: claim_compute_jobs — H-1235 carve-out + H-1238 tie-break
-- --------------------------------------------------------------------------
-- Body mirrors C39 (`20260526100000_claim_dedupe_done_pending_children_guard.sql`)
-- with the additions itemized in the header. Every other clause is
-- preserved verbatim from C39.
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
         claim_token = gen_random_uuid()    -- mig 117: P97 fence
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
  'next_attempt_at <= now()) for a worker. Migration 090 dedupes by partition keys; '
  'migration 117 adds claim_token = gen_random_uuid() (P97 fence); '
  'migration C39 (20260526100000) added the done_pending_children NOT EXISTS guard. '
  'This migration (H-1235/H-1238 + F-2): adds the compute_intro_snapshot carve-out '
  'to the strategy_id dedupe and `, id` as a row_number() AND inner-UPDATE ORDER BY '
  'tie-break for deterministic dedupe across pg restarts/vacuums. FOR UPDATE '
  'SKIP LOCKED concurrency preserved. See migrations 032, 089, 090, 117, C39, '
  'and the H-1235/H-1238/M-1133 closure.';

REVOKE ALL ON FUNCTION claim_compute_jobs FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 2: claim_compute_jobs_with_priority — H-1235 carve-out + H-1238
--         tie-break + M-1133 EXISTS short-circuit
-- --------------------------------------------------------------------------
-- Body mirrors mig 117 STEP 3 (latest authoritative version; C39 did NOT
-- modify this function) with the additions itemized in the header.
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

  -- M-1133: throttle probe converted from `SELECT count(*)` to a
  -- `CASE WHEN EXISTS (...) THEN 1 ELSE 0 END` short-circuit. The
  -- downstream decision only needs `v_high_pending = 0` vs `> 0`;
  -- counting the full backlog every tick wastes CPU at Phase-12 backfill
  -- scale. CASE/EXISTS eliminates the NULL gap entirely (vs the prior
  -- SELECT 1 INTO + COALESCE shape — L1 / mig-reviewer): `EXISTS`
  -- returns boolean (never NULL), so the 0/1 semantics for
  -- `v_high_pending = 0` are preserved by construction with no probe
  -- for downstream code to drift past.
  v_high_pending := CASE WHEN EXISTS (
    SELECT 1
      FROM compute_jobs
     WHERE priority IN ('normal','high')
       AND status = 'pending'
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
    WHERE status = 'pending'
      AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      AND (v_high_pending = 0 OR priority IN ('normal','high'))
  ),
  deduped AS (
    SELECT id FROM ranked
    WHERE (portfolio_id IS NULL OR rn_p = 1)
      -- H-1235: same compute_intro_snapshot carve-out as
      -- `claim_compute_jobs` above. Index predicate justification is
      -- identical (mig 048's `compute_jobs_one_inflight_per_kind_strategy`
      -- excludes intro_snapshot).
      AND (strategy_id  IS NULL OR kind = 'compute_intro_snapshot' OR rn_s = 1)
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

COMMENT ON FUNCTION claim_compute_jobs_with_priority IS
  'Migration 117: P97 / G12.A.2 fence — claim_token = gen_random_uuid() on every claim. '
  'Mark RPCs verify token; late marks from watchdog-preempted workers raise '
  'serialization_failure. Preserves Phase 19 / mig 104 D-1 unified_backbone_at_claim '
  'metadata snapshot (COALESCE on watchdog re-claim). '
  'This migration (H-1235/H-1238/M-1133 + F-2/F-4/L1): adds the compute_intro_snapshot '
  'carve-out to the strategy_id dedupe, `, id` as a row_number() AND inner-UPDATE '
  'ORDER BY tie-break, and converts the throttle probe to a CASE WHEN EXISTS '
  'short-circuit (NULL-free by construction). See migration 117 + '
  '.planning/audit-2026-05-07/INVEST-P97.md and H-1235/H-1238/M-1133 closure.';

REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority(INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block (mirrors mig C39 STEP 2 pattern)
-- --------------------------------------------------------------------------
-- Re-assert the structural fingerprint of BOTH RPC bodies AFTER the
-- CREATE OR REPLACE so a subsequent silent replace cannot drop these
-- guards. Same standing pattern used by migs 090, 117, and C39.
DO $$
DECLARE
  v_body_legacy   TEXT;
  v_body_priority TEXT;
BEGIN
  -- ----------------------------------------------------------------------
  -- F-4: re-assert search_path / REVOKE hardening on BOTH functions per
  -- C39 pattern (20260526100000_*.sql:208-222). proconfig LIKE-match is
  -- robust across GUC-serialization variations (quoting, spacing differ
  -- across pg minor versions); checking key + values rather than an
  -- exact string match avoids false-fails after a routine pg upgrade.
  -- ----------------------------------------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'claim_compute_jobs'
       AND pg_get_function_identity_arguments(p.oid) = 'p_batch_size integer, p_worker_id text'
       AND EXISTS (
         SELECT 1 FROM unnest(p.proconfig) AS cfg
          WHERE cfg LIKE 'search_path=%'
            AND cfg LIKE '%public%'
            AND cfg LIKE '%pg_temp%'
       )
  ) THEN
    RAISE EXCEPTION 'H-B: search_path hardening regressed on claim_compute_jobs';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'claim_compute_jobs_with_priority'
       AND pg_get_function_identity_arguments(p.oid) = 'p_batch_size integer, p_worker_id text, p_unified_backbone_active boolean'
       AND EXISTS (
         SELECT 1 FROM unnest(p.proconfig) AS cfg
          WHERE cfg LIKE 'search_path=%'
            AND cfg LIKE '%public%'
            AND cfg LIKE '%pg_temp%'
       )
  ) THEN
    RAISE EXCEPTION 'H-B: search_path hardening regressed on claim_compute_jobs_with_priority';
  END IF;

  -- ----------------------------------------------------------------------
  -- 1) claim_compute_jobs body
  -- ----------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_body_legacy
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'claim_compute_jobs'
     AND pg_get_function_identity_arguments(p.oid) = 'p_batch_size integer, p_worker_id text';

  IF v_body_legacy IS NULL THEN
    RAISE EXCEPTION 'H-1235/H-1238 migration verification failed: claim_compute_jobs body not retrievable';
  END IF;

  -- H-1238: every row_number() OVER ORDER BY must end with `, id` — assert
  -- the four expected occurrences in claim_compute_jobs (4 windows).
  -- Red-team #1 / mig-reviewer L2 tightening (round-3): anchor on the
  -- CLOSING paren of `OVER(...)` to guarantee the match is inside a real
  -- window clause. The earlier `OVER[^)]*ORDER BY...next_attempt_at, id`
  -- shape could (in theory) match a substring that exits the OVER() via
  -- an unrelated `)` later in the body — anchoring on `\s*\)` after the
  -- tie-break tokens removes that ambiguity.
  IF (
    SELECT count(*) FROM regexp_matches(
      v_body_legacy,
      'row_number\(\)\s+OVER\s*\([^)]*ORDER\s+BY\s+next_attempt_at,\s*id\s*\)',
      'gi'
    )
  ) < 4 THEN
    RAISE EXCEPTION 'H-1238 migration verification failed: claim_compute_jobs missing `, id` tie-break in row_number() ORDER BY (expected 4 occurrences)';
  END IF;

  -- F-2: inner UPDATE ORDER BY must also tie-break on `cj.id` — without
  -- this the LIMIT p_batch_size cut at the boundary could swap candidates
  -- across pg restarts/vacuums even though the dedupe CTE is deterministic.
  IF v_body_legacy !~* 'ORDER\s+BY\s+cj\.next_attempt_at,\s*cj\.id' THEN
    RAISE EXCEPTION 'F-2 migration verification failed: claim_compute_jobs inner UPDATE ORDER BY missing cj.id tie-break';
  END IF;

  -- H-1235: the strategy_id rn_s clause must carve out compute_intro_snapshot.
  IF v_body_legacy !~* 'strategy_id\s+IS\s+NULL\s+OR\s+kind\s*=\s*''compute_intro_snapshot''\s+OR\s+rn_s\s*=\s*1' THEN
    RAISE EXCEPTION 'H-1235 migration verification failed: claim_compute_jobs missing compute_intro_snapshot carve-out in strategy_id dedupe';
  END IF;

  -- Preserve mig 090 partition-key dedupe.
  IF v_body_legacy !~* 'row_number\(\)\s+OVER' THEN
    RAISE EXCEPTION 'Regression: claim_compute_jobs lost mig 090 partition-key dedupe (row_number)';
  END IF;

  -- Preserve mig 117 P97 claim_token stamp.
  IF v_body_legacy !~* 'claim_token\s*=\s*gen_random_uuid\(\)' THEN
    RAISE EXCEPTION 'Regression: claim_compute_jobs lost mig 117 P97 claim_token stamp';
  END IF;

  -- Preserve mig C39 done_pending_children NOT EXISTS guard.
  IF v_body_legacy !~* 'done_pending_children' THEN
    RAISE EXCEPTION 'Regression: claim_compute_jobs lost mig C39 done_pending_children guard';
  END IF;

  -- ----------------------------------------------------------------------
  -- 2) claim_compute_jobs_with_priority body
  -- ----------------------------------------------------------------------
  SELECT pg_get_functiondef(p.oid) INTO v_body_priority
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'claim_compute_jobs_with_priority'
     AND pg_get_function_identity_arguments(p.oid) = 'p_batch_size integer, p_worker_id text, p_unified_backbone_active boolean';

  IF v_body_priority IS NULL THEN
    RAISE EXCEPTION 'H-1235/H-1238/M-1133 migration verification failed: claim_compute_jobs_with_priority body not retrievable';
  END IF;

  -- H-1238 (red-team #1 / mig-reviewer L2 tightening, round-3): anchor
  -- the `, id` tie-break INSIDE the row_number() OVER window AND on the
  -- closing `)` of the OVER clause. The priority body windows span
  -- multiple lines (PARTITION BY <newline> ORDER BY CASE... priority...,
  -- next_attempt_at, id <newline> )), so [^)]* across the whole window
  -- is correct here for the OVER body, and `\s*\)` anchors the
  -- match-end to the OVER close paren. Forces 4 separate row_number()
  -- windows to carry the tie-break.
  IF (
    SELECT count(*) FROM regexp_matches(
      v_body_priority,
      'row_number\(\)\s+OVER\s*\([^)]*ORDER\s+BY[^)]*next_attempt_at,\s*id\s*\)',
      'gi'
    )
  ) < 4 THEN
    RAISE EXCEPTION 'H-1238 migration verification failed: claim_compute_jobs_with_priority missing `, id` tie-break in row_number() ORDER BY (expected 4 windows)';
  END IF;

  -- F-2: inner UPDATE ORDER BY must end with `cj.id` after the priority
  -- and next_attempt_at columns (mirrors the legacy body's F-2 check).
  IF v_body_priority !~* 'ORDER\s+BY\s+CASE\s+cj\.priority[\s\S]*?cj\.next_attempt_at,\s*cj\.id' THEN
    RAISE EXCEPTION 'F-2 migration verification failed: claim_compute_jobs_with_priority inner UPDATE ORDER BY missing cj.id tie-break';
  END IF;

  -- H-1235: strategy_id rn_s clause must carve out compute_intro_snapshot.
  IF v_body_priority !~* 'strategy_id\s+IS\s+NULL\s+OR\s+kind\s*=\s*''compute_intro_snapshot''\s+OR\s+rn_s\s*=\s*1' THEN
    RAISE EXCEPTION 'H-1235 migration verification failed: claim_compute_jobs_with_priority missing compute_intro_snapshot carve-out in strategy_id dedupe';
  END IF;

  -- M-1133 (L1 refactored shape): throttle probe must use the
  -- `CASE WHEN EXISTS (...) THEN 1 ELSE 0 END` short-circuit. Assert
  -- no `SELECT count(` (the rejected pre-M-1133 shape) AND the new
  -- EXISTS pattern is present near v_high_pending. CASE/EXISTS is
  -- NULL-free by construction — the legacy `SELECT 1 INTO + COALESCE`
  -- shape (F-3) is gone, so the NULL-probe always-throttle hazard
  -- is unreachable.
  IF v_body_priority ~* 'select\s+count\s*\(' THEN
    RAISE EXCEPTION 'M-1133 migration verification failed: claim_compute_jobs_with_priority still uses SELECT count(*) in throttle probe';
  END IF;

  IF v_body_priority !~* 'v_high_pending\s*:=\s*CASE\s+WHEN\s+EXISTS' THEN
    RAISE EXCEPTION 'M-1133 / L1 migration verification failed: claim_compute_jobs_with_priority throttle probe must use CASE WHEN EXISTS short-circuit';
  END IF;

  -- Preserve mig 090 partition-key dedupe.
  IF v_body_priority !~* 'row_number\(\)\s+OVER' THEN
    RAISE EXCEPTION 'Regression: claim_compute_jobs_with_priority lost mig 090 partition-key dedupe (row_number)';
  END IF;

  -- Preserve mig 117 P97 claim_token stamp.
  IF v_body_priority !~* 'claim_token\s*=\s*gen_random_uuid\(\)' THEN
    RAISE EXCEPTION 'Regression: claim_compute_jobs_with_priority lost mig 117 P97 claim_token stamp';
  END IF;

  -- Preserve mig 104 D-1 metadata COALESCE.
  IF v_body_priority !~* 'unified_backbone_at_claim' THEN
    RAISE EXCEPTION 'Regression: claim_compute_jobs_with_priority lost Phase 19 / mig 104 D-1 metadata snapshot';
  END IF;

  RAISE NOTICE 'H-1235 / H-1238 / M-1133 / F-2 / F-4 / L1: claim RPCs hardened (intro_snapshot carve-out, id tie-break inner+window, EXISTS short-circuit, search_path re-asserted) and verified.';
END $$;

COMMIT;
