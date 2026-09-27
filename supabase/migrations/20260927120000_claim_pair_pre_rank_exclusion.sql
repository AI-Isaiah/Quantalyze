-- ==========================================================================
-- Phase 164.9.3 (CLAIMPAIR), [164.9.3-CLAIM-PAIR-23505], founder-ratified
-- decision D-08: a due `failed_retry` compute job and a `pending` twin of the
-- same (kind, partition key) no longer make a claim entry point raise 23505.
-- Entry points, by symbol AND arity:
--   * public.claim_compute_jobs(integer, text)
--   * public.claim_compute_jobs_with_priority(integer, text, boolean, text[], text[])  (5-arg)
--   * public.claim_compute_jobs_with_priority(integer, text)                          (2-arg)
--
-- WHAT IT CLOSES. `failed_retry` is outside the predicate of every
-- `compute_jobs_one_inflight_per_kind_*` partial unique index, so an enqueue
-- made while a retry is outstanding writes a `pending` twin beside it. Each
-- claim body then ranked the two rows in one partition and flipped the winner
-- to `running`; when the retry won, the batch UPDATE met the pending twin at
-- the unique index. Measured on a throwaway lane before this file existed:
-- 8 of 8 cells (4 partitions x {claim_compute_jobs, the 5-arg}) raised 23505,
-- the WHOLE batch aborted (an unrelated due job on another partition id was
-- not claimed either), and 4 consecutive ticks all raised: it never
-- self-clears. The red-first gate
-- supabase/tests/test_claim_compute_jobs_failed_retry_pending_pair.sql
-- recorded the same on the schema of record: 14 arms red, all with 23505.
-- After this file every claim body drops such a retry from its candidate set
-- BEFORE ranking, so the partition holds one candidate, the twin. The twin
-- runs (at once if due, else when due) and the retry runs after it finishes;
-- no work is lost. The 2-arg overload also receives the running /
-- done_pending_children (C39) guard the other two bodies already carry;
-- measured, the pre-rank clause alone still let its SECOND tick claim the
-- retry beside the now-running twin and raise 23505.
--
-- WHAT IT DOES NOT CLOSE (recorded, not fixed), after one CLOSED residual:
--   (i)   CLOSED in review round 1 (164.9.3-REVIEW.md WR-01; D-04 amended to
--         "no bytes outside the marked CLAIMPAIR blocks"). As first written,
--         the throttle probe of both priority overloads still counted a due
--         normal/high retry the pre-rank clause holds back. This header then
--         called that a bounded hold, and it was not: beside a `low` pending
--         twin, neither row was ever claimed and every due `low` job
--         queue-wide was throttled, with no error, on every tick (measured).
--         Each probe now carries a marked CLAIMPAIR PROBE EXCLUSION block that
--         drops such a retry from the count, on the same four partitions and
--         with the same intro carve-out as the pre-rank block. So neither the
--         far-future-twin hold nor the low-twin wedge remains; the gate arm
--         W-LOWTWIN pins it. What stays: C39 still counts a retry beside a
--         running row in the probe, a hold that ends when that row finishes.
--   (ii)  A retry waits for a not-yet-due twin to run first: delay, not loss.
--         It is inherent to one-in-flight-per-partition.
--   (iii) A claim racing a concurrent enqueue of the twin can still raise
--         23505 for one tick: its snapshot predates the committed twin, so it
--         flips the retry and meets the twin at the unique check. The next
--         tick sees the pair and excludes the retry. Reasoned, not measured
--         (it needs two backends); C39 has the same window today.
--   D-05: this migration edits NONE of defer_compute_job,
--   mark_compute_job_done, mark_compute_job_failed (Phase 164.9.3.2
--   DEFER40001 will change their errcode) and NONE of
--   _enqueue_compute_job_internal. There is no overlap with Phase 164.9.3.2
--   DEFER40001 or Phase 164.9.3.1 FANINGRAPH: if both are open this phase
--   lands first and 164.9.3.2 re-bases on whatever is latest. Only
--   migration-timestamp order at merge time couples them.
--   It also leaves set_departed_key_history_inclusion untouched (its
--   failed_retry reuse stays correct; the pairs it leaves beside an existing
--   pending row become harmless here).
--
-- WHY PRE-RANK. The guard sits in each body's `ranked` CTE WHERE, before
-- row_number(), never in `deduped`. The booked alternative (a), adding
-- 'pending' to the post-rank C39 status list, was measured as a SILENT
-- permanent wedge: the retry ranks first, the guard drops it, the twin was
-- already dropped by the rank filter, nothing re-ranks, and neither job is
-- ever claimed (8 of 8 cells); it also starved compute_intro_snapshot (0 of 3
-- claimed against 3 of 3 today). The enqueue-side alternative (b) would not
-- heal pairs that already exist, and folding a new request into an older job
-- can lose that request's payload. The class is closed at the one statement
-- every writer's rows meet: the claim.
-- The guard is one contiguous block per body, bracketed by a begin and an end
-- marker comment and byte-identical in all three bodies; the ported C39 block
-- in the 2-arg is bracketed the same way and is verbatim from
-- claim_compute_jobs. The probe exclusion in the two priority overloads is a
-- third kind of marked block (CLAIMPAIR PROBE EXCLUSION BEGIN/END), inside the
-- throttle probe's WHERE, with a different shape (one negated disjunction,
-- inner alias p) so it can never be mistaken for the pre-rank block.
-- Inside each pre-rank clause the inner table is aliased x and the
-- outer candidate is referenced as compute_jobs.<col>, which binds to the
-- unaliased FROM compute_jobs of the `ranked` CTE.
--
-- RE-BASE (D-04). Each CREATE OR REPLACE below is the LATEST definition,
-- byte-for-byte, plus the marked block(s): claim_compute_jobs from
-- 20260603120000 STEP 1a; the 5-arg claim_compute_jobs_with_priority from
-- 20260719073701 (its CREATE FUNCTION becomes CREATE OR REPLACE FUNCTION: the
-- signature is unchanged, so there is no drop); the 2-arg from 20260428190907
-- STEP 2 (re-based, NOT dropped: every call form of it raises 42725 today,
-- but a drop would make VAC-04 report SNAPSHOT_MISSING, which has no
-- acknowledgement path). Re-grepped across every migration at execution: no
-- later definition of any of the three arities and no ALTER FUNCTION exists.
-- Nothing else in the 2-arg changes: no claim token, no error clears, no
-- tie-break, and no throttle change beyond the marked probe block. Each REVOKE is re-issued with the full
-- argument signature (a bare claim_compute_jobs_with_priority raises 42725
-- where two overloads exist). No function comment is re-issued and no
-- function is dropped: CREATE OR REPLACE keeps the existing comment and ACL.
--
-- VAC-04 ACKNOWLEDGEMENT — the PROD bodies these CREATE OR REPLACEs overwrite
-- The gate compares the COMMITTED SNAPSHOT (supabase/schema/functions/) against
-- PROD's live body. On a function-changing migration PR the two necessarily
-- disagree: `snapshot-drift` requires the snapshot to carry the body the
-- MIGRATIONS produce (the new one), while VAC-04 requires it to match what PROD
-- has TODAY (the old one). The pragma means "I read PROD's body and intend to
-- overwrite it". This migration changes THREE function bodies, so it carries
-- THREE pragmas, one per function key; VAC-04 greps the changed files once per
-- drifting function, each matched by its own hash.
--
-- MEASURED 2026-09-27 UTC, reproduced LOCALLY with the gate's own normalizer,
-- aiming its `live` argument at origin/main's snapshot rather than at PROD
-- (origin/main = 8eafe105724e1700cf39b740558b5e1c16719362, whose two snapshot
-- files are byte-equal to this branch's pre-change copies), once per file:
--
--   git show origin/main:supabase/schema/functions/<fn>.sql > <scratch>
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/<fn>.sql <scratch>
--
-- ⭐ EACH ACKED HASH IS THE `live` COLUMN OF --diff-bodies FOR THAT FUNCTION'S
-- DRIFT ROW, NOT `--hash` OF THE SNAPSHOT FILE (a whole-file digest no gate
-- ever greps). claim_compute_jobs.sql reported one DRIFT row;
-- claim_compute_jobs_with_priority.sql holds BOTH overloads and reported two.
-- The differing lines are the marked pre-rank block (all three bodies), the
-- marked C39 port (2-arg only) and, since review round 1, the marked probe
-- exclusion block (both priority overloads). The acked hashes are the `live`
-- column, PROD's body, so that later block leaves them unchanged.
--
-- claim_compute_jobs (2 args), the DRIFT row's `live` column:
-- prod-body-ack: 8bdcac70bce0c9921d1e693209d3fb355c9018e6708699b1a029adb5d02edea1
--
-- claim_compute_jobs_with_priority (2 args), the DRIFT row's `live` column:
-- prod-body-ack: c95251fc049f24345a0cdf352b3adfff8120a3c29085da1626cc19e8ff203ae8
--
-- claim_compute_jobs_with_priority (5 args), the DRIFT row's `live` column:
-- prod-body-ack: 7e8cc4c1937f8274bcf1fca762576559dea0d371dc0be11b979e01e31d01a73a
--
-- ⚠️ EACH ACK IS OF origin/main, WHICH STANDS IN FOR PROD. It is EARNED only if
-- VAC-04 on the PR reports that SAME hash for PROD for that function. If it
-- reports a different one, PROD drifted OUT OF BAND and the correct action is
-- to FOLD the difference into this migration and re-derive — never to edit a
-- pragma to match a gate log. It is EARNED, not pasted.
-- Cross-check, read AFTER the local derivation: VAC-04 in Migration Drift
-- Check run 36322639565 (PR head 1ece52797, before the snapshots were
-- regenerated, so the committed snapshot still held origin/main's bodies)
-- reported MATCH against PROD for all three keys at exactly these hashes.
-- ⚠️ VAC-08 (repo-vs-TEST body pairing, the `test-db-drift` job) goes RED on
-- the PR by construction: one DRIFT row per function key
-- (claim_compute_jobs/2, claim_compute_jobs_with_priority/2 and
-- claim_compute_jobs_with_priority/5), whose TEST hash is the pre-change hash
-- above, until apply-on-merge brings TEST forward.
--
-- Transaction style: NO explicit BEGIN/COMMIT (Supabase wraps each migration
-- in an implicit transaction; SET LOCAL lock_timeout applies to that wrap).
-- This migration writes ZERO table data and validates no existing rows: its
-- DO block reads catalogs only ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]) and
-- never calls a claim RPC, which would claim real rows on apply. Every RAISE
-- format string below is a SINGLE literal (Phase 85 invariant #21, no '||'
-- concatenation inside a RAISE format slot).
--
-- Execution proof is NOT this file's DO block (a copy-and-placement check).
-- It is the behavioural gate named above, run on the local-stack lane that
-- replays this file on top of the committed dump.
-- ==========================================================================

SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- claim_compute_jobs(integer, text), re-based from 20260603120000 STEP 1a
-- --------------------------------------------------------------------------
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
      -- CLAIMPAIR PRE-RANK EXCLUSION BEGIN (D-08)
      -- Phase 164.9.3: a failed_retry row whose (kind, partition) already
      -- holds a pending row is not a candidate. Applied here, BEFORE
      -- row_number(), never in `deduped`: excluded after ranking, the retry
      -- would still rank first and take its pending twin down with it (a
      -- silent, permanent partition wedge). One clause per partition, each
      -- matching its compute_jobs_one_inflight_per_kind_* index predicate;
      -- that strategy index excludes compute_intro_snapshot, so this does too.
      AND (portfolio_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = compute_jobs.kind
           AND x.portfolio_id = compute_jobs.portfolio_id
           AND x.status       = 'pending'))
      AND (strategy_id IS NULL OR status <> 'failed_retry' OR kind = 'compute_intro_snapshot' OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind        = compute_jobs.kind
           AND x.strategy_id = compute_jobs.strategy_id
           AND x.status      = 'pending'))
      AND (allocator_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = compute_jobs.kind
           AND x.allocator_id = compute_jobs.allocator_id
           AND x.status       = 'pending'))
      AND (api_key_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind       = compute_jobs.kind
           AND x.api_key_id = compute_jobs.api_key_id
           AND x.status     = 'pending'))
      -- CLAIMPAIR PRE-RANK EXCLUSION END
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

REVOKE ALL ON FUNCTION claim_compute_jobs(INTEGER, TEXT) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- claim_compute_jobs_with_priority, 5-arg, re-based from 20260719073701
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_compute_jobs_with_priority(
  p_batch_size INTEGER,
  p_worker_id  TEXT,
  p_unified_backbone_active BOOLEAN DEFAULT NULL,
  p_kind_include TEXT[] DEFAULT NULL,   -- FLIPRETRY-02: claim ONLY these kinds
  p_kind_exclude TEXT[] DEFAULT NULL    -- FLIPRETRY-02: never claim these kinds
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
  --
  -- FLIPRETRY-02: the SAME kind filter that scopes the claim SELECT is
  -- applied here so a filtered worker only throttles on kinds it can claim.
  v_high_pending := CASE WHEN EXISTS (
    SELECT 1
      FROM compute_jobs
     WHERE priority IN ('normal','high')
       AND status IN ('pending', 'failed_retry')
       -- CLAIMPAIR PROBE EXCLUSION BEGIN (D-08, D-04 amendment)
       -- Phase 164.9.3 review round 1 (WR-01): a failed_retry row that the
       -- pre-rank block below holds back (its (kind, partition) holds a
       -- pending row) is not claimable this tick, so it must not trip the
       -- throttle either. Counted, it held back a `low` pending twin and every
       -- other due `low` job while never being claimed itself: a silent,
       -- permanent wedge. Same four partitions and the same strategy carve-out
       -- as the pre-rank block, written as one negated disjunction.
       AND NOT (status = 'failed_retry' AND (
             (portfolio_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM compute_jobs p
                WHERE p.kind         = compute_jobs.kind
                  AND p.portfolio_id = compute_jobs.portfolio_id
                  AND p.status       = 'pending'))
          OR (strategy_id IS NOT NULL AND kind <> 'compute_intro_snapshot' AND EXISTS (
               SELECT 1 FROM compute_jobs p
                WHERE p.kind        = compute_jobs.kind
                  AND p.strategy_id = compute_jobs.strategy_id
                  AND p.status      = 'pending'))
          OR (allocator_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM compute_jobs p
                WHERE p.kind         = compute_jobs.kind
                  AND p.allocator_id = compute_jobs.allocator_id
                  AND p.status       = 'pending'))
          OR (api_key_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM compute_jobs p
                WHERE p.kind       = compute_jobs.kind
                  AND p.api_key_id = compute_jobs.api_key_id
                  AND p.status     = 'pending'))))
       -- CLAIMPAIR PROBE EXCLUSION END
       AND next_attempt_at <= now()
       AND (p_kind_include IS NULL OR kind = ANY(p_kind_include))
       AND (p_kind_exclude IS NULL OR NOT (kind = ANY(p_kind_exclude)))
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
      -- FLIPRETRY-02: kind filter. NULL/NULL => byte-identical to prod today.
      AND (p_kind_include IS NULL OR kind = ANY(p_kind_include))
      AND (p_kind_exclude IS NULL OR NOT (kind = ANY(p_kind_exclude)))
      -- CLAIMPAIR PRE-RANK EXCLUSION BEGIN (D-08)
      -- Phase 164.9.3: a failed_retry row whose (kind, partition) already
      -- holds a pending row is not a candidate. Applied here, BEFORE
      -- row_number(), never in `deduped`: excluded after ranking, the retry
      -- would still rank first and take its pending twin down with it (a
      -- silent, permanent partition wedge). One clause per partition, each
      -- matching its compute_jobs_one_inflight_per_kind_* index predicate;
      -- that strategy index excludes compute_intro_snapshot, so this does too.
      AND (portfolio_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = compute_jobs.kind
           AND x.portfolio_id = compute_jobs.portfolio_id
           AND x.status       = 'pending'))
      AND (strategy_id IS NULL OR status <> 'failed_retry' OR kind = 'compute_intro_snapshot' OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind        = compute_jobs.kind
           AND x.strategy_id = compute_jobs.strategy_id
           AND x.status      = 'pending'))
      AND (allocator_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = compute_jobs.kind
           AND x.allocator_id = compute_jobs.allocator_id
           AND x.status       = 'pending'))
      AND (api_key_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind       = compute_jobs.kind
           AND x.api_key_id = compute_jobs.api_key_id
           AND x.status     = 'pending'))
      -- CLAIMPAIR PRE-RANK EXCLUSION END
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

REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority(INTEGER, TEXT, BOOLEAN, TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- claim_compute_jobs_with_priority, 2-arg, re-based from 20260428190907 STEP 2
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_compute_jobs_with_priority(
  p_batch_size INTEGER,
  p_worker_id  TEXT
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

  -- Throttle probe: count normal/high jobs that are ready to claim.
  -- Includes failed_retry rows whose backoff has elapsed (per migration 089).
  SELECT count(*) INTO v_high_pending
    FROM compute_jobs
   WHERE priority IN ('normal','high')
     AND status IN ('pending', 'failed_retry')
     -- CLAIMPAIR PROBE EXCLUSION BEGIN (D-08, D-04 amendment)
     -- Phase 164.9.3 review round 1 (WR-01): a failed_retry row that the
     -- pre-rank block below holds back (its (kind, partition) holds a
     -- pending row) is not claimable this tick, so it must not trip the
     -- throttle either. Counted, it held back a `low` pending twin and every
     -- other due `low` job while never being claimed itself: a silent,
     -- permanent wedge. Same four partitions and the same strategy carve-out
     -- as the pre-rank block, written as one negated disjunction.
     AND NOT (status = 'failed_retry' AND (
           (portfolio_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM compute_jobs p
              WHERE p.kind         = compute_jobs.kind
                AND p.portfolio_id = compute_jobs.portfolio_id
                AND p.status       = 'pending'))
        OR (strategy_id IS NOT NULL AND kind <> 'compute_intro_snapshot' AND EXISTS (
             SELECT 1 FROM compute_jobs p
              WHERE p.kind        = compute_jobs.kind
                AND p.strategy_id = compute_jobs.strategy_id
                AND p.status      = 'pending'))
        OR (allocator_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM compute_jobs p
              WHERE p.kind         = compute_jobs.kind
                AND p.allocator_id = compute_jobs.allocator_id
                AND p.status       = 'pending'))
        OR (api_key_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM compute_jobs p
              WHERE p.kind       = compute_jobs.kind
                AND p.api_key_id = compute_jobs.api_key_id
                AND p.status     = 'pending'))))
     -- CLAIMPAIR PROBE EXCLUSION END
     AND next_attempt_at <= now();

  -- Atomic claim with priority precedence + throttle guard + partition dedupe.
  -- The CTE picks at most one winner per (kind, partition_id) tuple BEFORE
  -- the FOR UPDATE SKIP LOCKED scan, so the ensuing batch UPDATE cannot
  -- 23505 on the partial inflight indices.
  RETURN QUERY
  WITH ranked AS (
    SELECT id, kind, priority, portfolio_id, strategy_id, allocator_id, api_key_id,
           next_attempt_at,
           CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END AS pri_rank,
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
    WHERE status IN ('pending', 'failed_retry')
      AND next_attempt_at <= now()
      AND (v_high_pending = 0 OR priority IN ('normal','high'))
      -- CLAIMPAIR PRE-RANK EXCLUSION BEGIN (D-08)
      -- Phase 164.9.3: a failed_retry row whose (kind, partition) already
      -- holds a pending row is not a candidate. Applied here, BEFORE
      -- row_number(), never in `deduped`: excluded after ranking, the retry
      -- would still rank first and take its pending twin down with it (a
      -- silent, permanent partition wedge). One clause per partition, each
      -- matching its compute_jobs_one_inflight_per_kind_* index predicate;
      -- that strategy index excludes compute_intro_snapshot, so this does too.
      AND (portfolio_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = compute_jobs.kind
           AND x.portfolio_id = compute_jobs.portfolio_id
           AND x.status       = 'pending'))
      AND (strategy_id IS NULL OR status <> 'failed_retry' OR kind = 'compute_intro_snapshot' OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind        = compute_jobs.kind
           AND x.strategy_id = compute_jobs.strategy_id
           AND x.status      = 'pending'))
      AND (allocator_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = compute_jobs.kind
           AND x.allocator_id = compute_jobs.allocator_id
           AND x.status       = 'pending'))
      AND (api_key_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind       = compute_jobs.kind
           AND x.api_key_id = compute_jobs.api_key_id
           AND x.status     = 'pending'))
      -- CLAIMPAIR PRE-RANK EXCLUSION END
  ),
  deduped AS (
    SELECT id FROM ranked
    WHERE (portfolio_id IS NULL OR rn_p = 1)
      AND (strategy_id  IS NULL OR rn_s = 1)
      AND (allocator_id IS NULL OR rn_a = 1)
      AND (api_key_id   IS NULL OR rn_k = 1)
      -- CLAIMPAIR C39 PORT BEGIN (from claim_compute_jobs)
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
      -- CLAIMPAIR C39 PORT END
  )
  UPDATE compute_jobs
     SET status     = 'running',
         claimed_at = now(),
         claimed_by = p_worker_id,
         attempts   = attempts + 1
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

REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority(INTEGER, TEXT) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- Self-verify: catalog reads only (pg_proc, pg_get_functiondef, ACL
-- functions). It never calls a claim RPC and reads no compute_jobs row.
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_ccj_oid                 oid := to_regprocedure('public.claim_compute_jobs(integer, text)');
  v_ccj_fn                  text;
  v_ccj_body                text;
  v_ccj_cfg                 text[];
  v_ccj_secdef              boolean;
  v_ccj_portfolio_anchored  boolean;
  v_ccj_strategy_anchored   boolean;
  v_ccj_allocator_anchored  boolean;
  v_ccj_api_key_anchored    boolean;
  c_search_path             CONSTANT text := 'search_path=public, pg_temp';
  c_ccj_sig                 CONSTANT text := 'public.claim_compute_jobs(integer, text)';
  -- Each pre-rank clause must sit inside the `ranked` CTE, i.e. after its
  -- opening and before `deduped` opens. One regex per partition pins the
  -- partition column, the failed_retry status test, the pending-sibling
  -- subquery on the same (kind, column), and that placement together.
  c_ranked_open             CONSTANT text := 'WITH\s+ranked\s+AS\s*\(.*';
  c_ranked_close            CONSTANT text := '.*\mdeduped\s+AS\s*\(';
  c_pf_re                   CONSTANT text :=
    '\(\s*portfolio_id\s+IS\s+NULL\s+OR\s+status\s*<>\s*''failed_retry''\s+OR\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+x\s+WHERE\s+x\.kind\s*=\s*compute_jobs\.kind\s+AND\s+x\.portfolio_id\s*=\s*compute_jobs\.portfolio_id\s+AND\s+x\.status\s*=\s*''pending''\s*\)\s*\)';
  c_st_re                   CONSTANT text :=
    '\(\s*strategy_id\s+IS\s+NULL\s+OR\s+status\s*<>\s*''failed_retry''\s+OR\s+kind\s*=\s*''compute_intro_snapshot''\s+OR\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+x\s+WHERE\s+x\.kind\s*=\s*compute_jobs\.kind\s+AND\s+x\.strategy_id\s*=\s*compute_jobs\.strategy_id\s+AND\s+x\.status\s*=\s*''pending''\s*\)\s*\)';
  c_al_re                   CONSTANT text :=
    '\(\s*allocator_id\s+IS\s+NULL\s+OR\s+status\s*<>\s*''failed_retry''\s+OR\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+x\s+WHERE\s+x\.kind\s*=\s*compute_jobs\.kind\s+AND\s+x\.allocator_id\s*=\s*compute_jobs\.allocator_id\s+AND\s+x\.status\s*=\s*''pending''\s*\)\s*\)';
  c_key_re                  CONSTANT text :=
    '\(\s*api_key_id\s+IS\s+NULL\s+OR\s+status\s*<>\s*''failed_retry''\s+OR\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+x\s+WHERE\s+x\.kind\s*=\s*compute_jobs\.kind\s+AND\s+x\.api_key_id\s*=\s*compute_jobs\.api_key_id\s+AND\s+x\.status\s*=\s*''pending''\s*\)\s*\)';
  v_p5_oid                  oid := to_regprocedure('public.claim_compute_jobs_with_priority(integer, text, boolean, text[], text[])');
  v_p5_fn                   text;
  v_p5_body                 text;
  v_p5_cfg                  text[];
  v_p5_secdef               boolean;
  v_p5_portfolio_anchored   boolean;
  v_p5_strategy_anchored    boolean;
  v_p5_allocator_anchored   boolean;
  v_p5_api_key_anchored     boolean;
  v_p2_oid                  oid := to_regprocedure('public.claim_compute_jobs_with_priority(integer, text)');
  v_p2_fn                   text;
  v_p2_body                 text;
  v_p2_cfg                  text[];
  v_p2_secdef               boolean;
  v_p2_portfolio_anchored   boolean;
  v_p2_strategy_anchored    boolean;
  v_p2_allocator_anchored   boolean;
  v_p2_api_key_anchored     boolean;
  v_p2_c39_anchored         boolean;
  c_p5_sig                  CONSTANT text := 'public.claim_compute_jobs_with_priority(integer, text, boolean, text[], text[])';
  c_p2_sig                  CONSTANT text := 'public.claim_compute_jobs_with_priority(integer, text)';
  -- The C39 guard ported into the 2-arg: all four partition clauses, in
  -- order, inside its `deduped` CTE (after `deduped` opens and before the
  -- batch UPDATE).
  c_c39_pf_re               CONSTANT text :=
    'AND\s+\(\s*portfolio_id\s+IS\s+NULL\s+OR\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+x\s+WHERE\s+x\.kind\s*=\s*ranked\.kind\s+AND\s+x\.portfolio_id\s*=\s*ranked\.portfolio_id\s+AND\s+x\.status\s+IN\s*\(\s*''running''\s*,\s*''done_pending_children''\s*\)\s*\)\s*\)';
  c_c39_st_re               CONSTANT text :=
    'AND\s+\(\s*strategy_id\s+IS\s+NULL\s+OR\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+x\s+WHERE\s+x\.kind\s*=\s*ranked\.kind\s+AND\s+x\.strategy_id\s*=\s*ranked\.strategy_id\s+AND\s+x\.status\s+IN\s*\(\s*''running''\s*,\s*''done_pending_children''\s*\)\s*\)\s*\)';
  c_c39_al_re               CONSTANT text :=
    'AND\s+\(\s*allocator_id\s+IS\s+NULL\s+OR\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+x\s+WHERE\s+x\.kind\s*=\s*ranked\.kind\s+AND\s+x\.allocator_id\s*=\s*ranked\.allocator_id\s+AND\s+x\.status\s+IN\s*\(\s*''running''\s*,\s*''done_pending_children''\s*\)\s*\)\s*\)';
  c_c39_key_re              CONSTANT text :=
    'AND\s+\(\s*api_key_id\s+IS\s+NULL\s+OR\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+x\s+WHERE\s+x\.kind\s*=\s*ranked\.kind\s+AND\s+x\.api_key_id\s*=\s*ranked\.api_key_id\s+AND\s+x\.status\s+IN\s*\(\s*''running''\s*,\s*''done_pending_children''\s*\)\s*\)\s*\)';
  c_c39_re                  CONSTANT text :=
    'deduped\s+AS\s*\(.*' || c_c39_pf_re || '\s*' || c_c39_st_re || '\s*' || c_c39_al_re || '\s*' || c_c39_key_re || '.*\mUPDATE\s+compute_jobs\M';
  -- The probe exclusion (review round 1, WR-01) in both priority overloads:
  -- the whole negated disjunction, all four partitions in order with the
  -- strategy carve-out, inside the throttle probe statement (`[^;]*` keeps
  -- it within that one statement) and before `WITH ranked AS (` opens.
  v_p5_probe_anchored       boolean;
  v_p2_probe_anchored       boolean;
  c_probe_re                CONSTANT text :=
    'AND\s+NOT\s*\(\s*status\s*=\s*''failed_retry''\s+AND\s*\(\s*'
    || '\(\s*portfolio_id\s+IS\s+NOT\s+NULL\s+AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+p\s+WHERE\s+p\.kind\s*=\s*compute_jobs\.kind\s+AND\s+p\.portfolio_id\s*=\s*compute_jobs\.portfolio_id\s+AND\s+p\.status\s*=\s*''pending''\s*\)\s*\)\s*'
    || 'OR\s*\(\s*strategy_id\s+IS\s+NOT\s+NULL\s+AND\s+kind\s*<>\s*''compute_intro_snapshot''\s+AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+p\s+WHERE\s+p\.kind\s*=\s*compute_jobs\.kind\s+AND\s+p\.strategy_id\s*=\s*compute_jobs\.strategy_id\s+AND\s+p\.status\s*=\s*''pending''\s*\)\s*\)\s*'
    || 'OR\s*\(\s*allocator_id\s+IS\s+NOT\s+NULL\s+AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+p\s+WHERE\s+p\.kind\s*=\s*compute_jobs\.kind\s+AND\s+p\.allocator_id\s*=\s*compute_jobs\.allocator_id\s+AND\s+p\.status\s*=\s*''pending''\s*\)\s*\)\s*'
    || 'OR\s*\(\s*api_key_id\s+IS\s+NOT\s+NULL\s+AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+p\s+WHERE\s+p\.kind\s*=\s*compute_jobs\.kind\s+AND\s+p\.api_key_id\s*=\s*compute_jobs\.api_key_id\s+AND\s+p\.status\s*=\s*''pending''\s*\)\s*\)\s*\)\s*\)';
  c_p5_probe_re             CONSTANT text :=
    'v_high_pending\s*:=\s*CASE\s+WHEN\s+EXISTS\s*\([^;]*' || c_probe_re || '[^;]*\)\s*THEN\s+1\s+ELSE\s+0\s+END\s*;.*\mWITH\s+ranked\s+AS\s*\(';
  c_p2_probe_re             CONSTANT text :=
    'SELECT\s+count\s*\(\s*\*\s*\)\s+INTO\s+v_high_pending\s+FROM\s+compute_jobs\s+WHERE\s[^;]*' || c_probe_re || '[^;]*;.*\mWITH\s+ranked\s+AS\s*\(';
BEGIN
  -- ===== claim_compute_jobs(integer, text) =====
  IF v_ccj_oid IS NULL THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: public.claim_compute_jobs(integer, text) does not resolve after its CREATE OR REPLACE';
  END IF;

  v_ccj_fn := pg_get_functiondef(v_ccj_oid);
  -- Strip BOTH plpgsql comment syntaxes, block first (T-163-16). The guard's
  -- own comment prose names failed_retry and pending, so no regex below may
  -- run on the unstripped text.
  v_ccj_body := regexp_replace(regexp_replace(v_ccj_fn, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW.
  IF v_ccj_body IS NULL THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the comment-stripped claim_compute_jobs body came back NULL, so every regex arm below would pass without reading anything. Refusing to report compliance on an unread body.';
  END IF;

  -- (1) the four pre-rank clauses, each inside the ranked CTE.
  v_ccj_portfolio_anchored := v_ccj_body ~ (c_ranked_open || c_pf_re || c_ranked_close);
  IF NOT v_ccj_portfolio_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: claim_compute_jobs does not drop, before ranking, a failed_retry candidate whose (kind, portfolio_id) holds a pending row. The pairing raises 23505 and aborts the whole batch again.';
  END IF;
  v_ccj_strategy_anchored := v_ccj_body ~ (c_ranked_open || c_st_re || c_ranked_close);
  IF NOT v_ccj_strategy_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: claim_compute_jobs does not drop, before ranking, a failed_retry candidate whose (kind, strategy_id) holds a pending row, with the compute_intro_snapshot carve-out of its index. The pairing raises 23505 and aborts the whole batch again.';
  END IF;
  v_ccj_allocator_anchored := v_ccj_body ~ (c_ranked_open || c_al_re || c_ranked_close);
  IF NOT v_ccj_allocator_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: claim_compute_jobs does not drop, before ranking, a failed_retry candidate whose (kind, allocator_id) holds a pending row. The pairing raises 23505 and aborts the whole batch again.';
  END IF;
  v_ccj_api_key_anchored := v_ccj_body ~ (c_ranked_open || c_key_re || c_ranked_close);
  IF NOT v_ccj_api_key_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: claim_compute_jobs does not drop, before ranking, a failed_retry candidate whose (kind, api_key_id) holds a pending row. The pairing raises 23505 and aborts the whole batch again.';
  END IF;

  -- (2) carried forward from 20260603120000 STEP 3, so this full-body re-base
  -- cannot silently revert what that migration pinned. The intro carve-out
  -- is pinned in its `deduped` form: the bare word now also occurs in the
  -- new strategy clause, which would make a word-only check vacuous.
  IF v_ccj_body !~* 'last_error\s*=\s*NULL' OR v_ccj_body !~* 'error_kind\s*=\s*NULL' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: claim_compute_jobs does not clear last_error/error_kind on re-claim (M-1137/M-1138)';
  END IF;
  IF v_ccj_body !~* 'status\s+IN\s*\(\s*''pending''\s*,\s*''failed_retry''\s*\)' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: claim_compute_jobs lost status IN (pending, failed_retry) candidacy';
  END IF;
  -- The C39 guard at full strength (review round 1, WR-03): all four
  -- partition clauses, in order, inside `deduped`. The word alone survived
  -- the deletion of three of the four clauses.
  IF v_ccj_body !~ c_c39_re THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: claim_compute_jobs lost the C39 running / done_pending_children guard on at least one of its four partitions (all four, in order, inside its dedupe)';
  END IF;
  IF v_ccj_body !~* 'claim_token\s*=\s*gen_random_uuid' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: claim_compute_jobs lost the claim_token = gen_random_uuid() P97 fence';
  END IF;
  IF v_ccj_body !~* 'kind\s*=\s*''compute_intro_snapshot''\s+OR\s+rn_s\s*=\s*1' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: claim_compute_jobs lost the compute_intro_snapshot carve-out in its dedupe (H-1235)';
  END IF;
  IF v_ccj_body !~* 'next_attempt_at\s*,\s*id' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: claim_compute_jobs lost the `, id` tie-break (H-1238/F-2)';
  END IF;

  -- (3) SECURITY DEFINER, and the search_path pin is the VALUE, not the word.
  SELECT p.prosecdef, p.proconfig INTO v_ccj_secdef, v_ccj_cfg
    FROM pg_proc p WHERE p.oid = v_ccj_oid;
  IF v_ccj_secdef IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: claim_compute_jobs is no longer SECURITY DEFINER, so the worker (service_role) could not reach compute_jobs through it';
  END IF;
  IF v_ccj_cfg IS NULL OR NOT (c_search_path = ANY(v_ccj_cfg)) THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: claim_compute_jobs does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty or reordered is search-path-hijackable.', v_ccj_cfg;
  END IF;

  -- (4) ACL: the REVOKE above re-converged.
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: one of the roles anon / authenticated / service_role does not exist on this database, so the ACL arm cannot be evaluated. These are Supabase-standard roles; their absence means this migration is running somewhere it was not written for.';
  END IF;
  -- The PUBLIC probe runs first so a PUBLIC leak is named as a PUBLIC leak.
  PERFORM public._assert_no_public_execute(c_ccj_sig);
  IF has_function_privilege('anon', v_ccj_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_ccj_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: anon or authenticated holds EXECUTE on the SECURITY DEFINER claim_compute_jobs — ACL drifted open. The PUBLIC probe above already passed, so this is a grant held by the named role directly.';
  END IF;
  -- The worker's role must still HOLD it (review round 1, WR-03): a REVOKE
  -- that over-reached would pass every closed-ACL probe above.
  IF NOT has_function_privilege('service_role', v_ccj_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: service_role does not hold EXECUTE on claim_compute_jobs, so the worker cannot claim through it';
  END IF;

  -- ===== claim_compute_jobs_with_priority, 5-arg (the worker's path) =====
  IF v_p5_oid IS NULL THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: public.claim_compute_jobs_with_priority(integer, text, boolean, text[], text[]) does not resolve after its CREATE OR REPLACE';
  END IF;

  v_p5_fn := pg_get_functiondef(v_p5_oid);
  v_p5_body := regexp_replace(regexp_replace(v_p5_fn, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW.
  IF v_p5_body IS NULL THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the comment-stripped 5-arg claim_compute_jobs_with_priority body came back NULL, so every regex arm below would pass without reading anything. Refusing to report compliance on an unread body.';
  END IF;

  -- (5) the four pre-rank clauses, each inside the ranked CTE.
  v_p5_portfolio_anchored := v_p5_body ~ (c_ranked_open || c_pf_re || c_ranked_close);
  IF NOT v_p5_portfolio_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority does not drop, before ranking, a failed_retry candidate whose (kind, portfolio_id) holds a pending row. The pairing raises 23505 and aborts the whole batch again.';
  END IF;
  v_p5_strategy_anchored := v_p5_body ~ (c_ranked_open || c_st_re || c_ranked_close);
  IF NOT v_p5_strategy_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority does not drop, before ranking, a failed_retry candidate whose (kind, strategy_id) holds a pending row, with the compute_intro_snapshot carve-out of its index. The pairing raises 23505 and aborts the whole batch again.';
  END IF;
  v_p5_allocator_anchored := v_p5_body ~ (c_ranked_open || c_al_re || c_ranked_close);
  IF NOT v_p5_allocator_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority does not drop, before ranking, a failed_retry candidate whose (kind, allocator_id) holds a pending row. The pairing raises 23505 and aborts the whole batch again.';
  END IF;
  v_p5_api_key_anchored := v_p5_body ~ (c_ranked_open || c_key_re || c_ranked_close);
  IF NOT v_p5_api_key_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority does not drop, before ranking, a failed_retry candidate whose (kind, api_key_id) holds a pending row. The pairing raises 23505 and aborts the whole batch again.';
  END IF;

  -- (5b) the probe exclusion, inside the throttle probe, before ranking.
  v_p5_probe_anchored := v_p5_body ~ c_p5_probe_re;
  IF NOT v_p5_probe_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority throttle probe still counts a failed_retry row the pre-rank clause holds back (its (kind, partition) holds a pending row). A normal/high retry beside a low pending twin then claims neither row and throttles every due low job, silently and permanently.';
  END IF;

  -- (6) carried forward from 20260603120000 STEP 3 (the priority RPC arms)
  -- and from 20260719073701 (the kind filter), 5-arg only.
  IF v_p5_body !~* 'last_error\s*=\s*NULL' OR v_p5_body !~* 'error_kind\s*=\s*NULL' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority does not clear last_error/error_kind on re-claim (M-1137/M-1138)';
  END IF;
  IF v_p5_body !~* 'status\s+IN\s*\(\s*''pending''\s*,\s*''failed_retry''\s*\)' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority lost status IN (pending, failed_retry) candidacy';
  END IF;
  IF v_p5_body !~* 'cj\.status\s+IN\s*\(\s*''pending''\s*,\s*''failed_retry''\s*\)' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority lost the inner cj.status re-check';
  END IF;
  IF v_p5_body !~ c_c39_re THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority lost the C39 running / done_pending_children guard on at least one of its four partitions (all four, in order, inside its dedupe)';
  END IF;
  IF v_p5_body !~* 'v_high_pending\s*:=\s*CASE\s+WHEN\s+EXISTS' OR v_p5_body ~* '\mcount\s*\(' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority throttle is not the CASE WHEN EXISTS short-circuit (M-1133)';
  END IF;
  IF v_p5_body !~* 'kind\s*=\s*''compute_intro_snapshot''\s+OR\s+rn_s\s*=\s*1' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority lost the compute_intro_snapshot carve-out in its dedupe (H-1235)';
  END IF;
  IF v_p5_body !~* 'claim_token\s*=\s*gen_random_uuid' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority lost the claim_token = gen_random_uuid() P97 fence';
  END IF;
  IF v_p5_body !~* 'unified_backbone_at_claim' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority lost the unified_backbone_at_claim metadata snapshot';
  END IF;
  IF v_p5_body !~* 'next_attempt_at\s*,\s*id' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority lost the `, id` row_number tie-break (H-1238)';
  END IF;
  IF v_p5_body !~* 'p_kind_include\s+IS\s+NULL\s+OR\s+kind\s*=\s*ANY\s*\(\s*p_kind_include\s*\)'
     OR v_p5_body !~* 'p_kind_exclude\s+IS\s+NULL\s+OR\s+NOT\s*\(\s*kind\s*=\s*ANY\s*\(\s*p_kind_exclude\s*\)\s*\)' THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority lost a FLIPRETRY-02 kind-filter predicate';
  END IF;

  -- (7) SECURITY DEFINER, and the search_path pin is the VALUE.
  SELECT p.prosecdef, p.proconfig INTO v_p5_secdef, v_p5_cfg
    FROM pg_proc p WHERE p.oid = v_p5_oid;
  IF v_p5_secdef IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority is no longer SECURITY DEFINER, so the worker (service_role) could not reach compute_jobs through it';
  END IF;
  IF v_p5_cfg IS NULL OR NOT (c_search_path = ANY(v_p5_cfg)) THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 5-arg claim_compute_jobs_with_priority does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty or reordered is search-path-hijackable.', v_p5_cfg;
  END IF;

  -- (8) ACL re-convergence (the role-existence guard above already ran).
  PERFORM public._assert_no_public_execute(c_p5_sig);
  IF has_function_privilege('anon', v_p5_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_p5_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: anon or authenticated holds EXECUTE on the SECURITY DEFINER 5-arg claim_compute_jobs_with_priority — ACL drifted open. The PUBLIC probe above already passed, so this is a grant held by the named role directly.';
  END IF;
  IF NOT has_function_privilege('service_role', v_p5_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: service_role does not hold EXECUTE on the 5-arg claim_compute_jobs_with_priority, so the worker cannot claim through it';
  END IF;

  -- ===== claim_compute_jobs_with_priority, 2-arg =====
  -- Only the new guards and the security posture are asserted here. None of
  -- the 5-arg invariants apply: this body throttles with a count, has no claim
  -- token, no error clears and no id tie-break, and D-04 keeps it that way.
  IF v_p2_oid IS NULL THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: public.claim_compute_jobs_with_priority(integer, text) does not resolve after its CREATE OR REPLACE';
  END IF;

  v_p2_fn := pg_get_functiondef(v_p2_oid);
  v_p2_body := regexp_replace(regexp_replace(v_p2_fn, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW.
  IF v_p2_body IS NULL THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the comment-stripped 2-arg claim_compute_jobs_with_priority body came back NULL, so every regex arm below would pass without reading anything. Refusing to report compliance on an unread body.';
  END IF;

  -- (9) the four pre-rank clauses, each inside the ranked CTE.
  v_p2_portfolio_anchored := v_p2_body ~ (c_ranked_open || c_pf_re || c_ranked_close);
  IF NOT v_p2_portfolio_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 2-arg claim_compute_jobs_with_priority does not drop, before ranking, a failed_retry candidate whose (kind, portfolio_id) holds a pending row. The pairing raises 23505 and aborts the whole batch again.';
  END IF;
  v_p2_strategy_anchored := v_p2_body ~ (c_ranked_open || c_st_re || c_ranked_close);
  IF NOT v_p2_strategy_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 2-arg claim_compute_jobs_with_priority does not drop, before ranking, a failed_retry candidate whose (kind, strategy_id) holds a pending row, with the compute_intro_snapshot carve-out of its index. The pairing raises 23505 and aborts the whole batch again.';
  END IF;
  v_p2_allocator_anchored := v_p2_body ~ (c_ranked_open || c_al_re || c_ranked_close);
  IF NOT v_p2_allocator_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 2-arg claim_compute_jobs_with_priority does not drop, before ranking, a failed_retry candidate whose (kind, allocator_id) holds a pending row. The pairing raises 23505 and aborts the whole batch again.';
  END IF;
  v_p2_api_key_anchored := v_p2_body ~ (c_ranked_open || c_key_re || c_ranked_close);
  IF NOT v_p2_api_key_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 2-arg claim_compute_jobs_with_priority does not drop, before ranking, a failed_retry candidate whose (kind, api_key_id) holds a pending row. The pairing raises 23505 and aborts the whole batch again.';
  END IF;

  -- (10) the ported C39 guard: all four partitions, inside `deduped`.
  v_p2_c39_anchored := v_p2_body ~ c_c39_re;
  IF NOT v_p2_c39_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 2-arg claim_compute_jobs_with_priority does not carry, in its dedupe, the running / done_pending_children guard on all four partitions. Its second tick claims a retry beside a now-running twin and raises 23505.';
  END IF;

  -- (10b) the probe exclusion, inside the throttle count, before ranking.
  v_p2_probe_anchored := v_p2_body ~ c_p2_probe_re;
  IF NOT v_p2_probe_anchored THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 2-arg claim_compute_jobs_with_priority throttle count still counts a failed_retry row the pre-rank clause holds back (its (kind, partition) holds a pending row). A normal/high retry beside a low pending twin then claims neither row and throttles every due low job, silently and permanently.';
  END IF;

  -- (11) SECURITY DEFINER, and the search_path pin is the VALUE.
  SELECT p.prosecdef, p.proconfig INTO v_p2_secdef, v_p2_cfg
    FROM pg_proc p WHERE p.oid = v_p2_oid;
  IF v_p2_secdef IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 2-arg claim_compute_jobs_with_priority is no longer SECURITY DEFINER';
  END IF;
  IF v_p2_cfg IS NULL OR NOT (c_search_path = ANY(v_p2_cfg)) THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: the 2-arg claim_compute_jobs_with_priority does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty or reordered is search-path-hijackable.', v_p2_cfg;
  END IF;

  -- (12) ACL re-convergence.
  PERFORM public._assert_no_public_execute(c_p2_sig);
  IF has_function_privilege('anon', v_p2_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_p2_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: anon or authenticated holds EXECUTE on the SECURITY DEFINER 2-arg claim_compute_jobs_with_priority — ACL drifted open. The PUBLIC probe above already passed, so this is a grant held by the named role directly.';
  END IF;
  IF NOT has_function_privilege('service_role', v_p2_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'claim-pair-pre-rank: service_role does not hold EXECUTE on the 2-arg claim_compute_jobs_with_priority';
  END IF;

  RAISE NOTICE 'claim-pair-pre-rank: claim_compute_jobs and both claim_compute_jobs_with_priority overloads drop, before ranking, a failed_retry candidate beside a pending twin on all four partitions (strategy with the intro carve-out); the throttle probe of neither priority overload counts a retry held back that way; the 2-arg carries the C39 guard on all four partitions; carried-forward invariants (5-arg and claim_compute_jobs), SECURITY DEFINER, the exact search_path pin, the closed ACL and the service_role grant intact for all three.';
END
$verify$;
