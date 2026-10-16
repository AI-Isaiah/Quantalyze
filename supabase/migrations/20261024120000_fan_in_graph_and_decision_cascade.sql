-- ==========================================================================
-- Phase 164.9.3.1 (FANINGRAPH): the fan-in graph can no longer strand a child,
-- deadlock on a diamond, or lose a release, and a decision delete can no longer
-- trip the outcome uniqueness index through the ON DELETE SET NULL cascade.
--
-- ONE MIGRATION FOR THE WHOLE PHASE (D-08). This file is built up across the
-- phase's plans, one section per plan, and every section below says which plan
-- fills it. A reader of an intermediate commit sees the sections that exist and
-- a one-sentence placeholder for each that does not yet.
--
-- WHAT IT CLOSES.
--   (1) The stranded child (D-01 to D-03). A fan-in child whose parent ends
--       `failed_final` stays `done_pending_children` forever, holds its
--       (target, kind) in-flight slot, and its strategy reads `computing`.
--       FILLED HERE: mark_compute_job_failed, only when the job it just ended is
--       `failed_final` (a `failed_retry` parent cascades nothing, it may still
--       succeed), fails the descendant closure in its own transaction (D-01,
--       D-02): the whole waiting closure is read first (a recursive CTE, no
--       locks), locked in ONE call to the ancestor-first lock helper (review
--       CR-01: a lock per level deadlocks on a deeper graph), re-read under those
--       locks and, if a child was committed during the lock wait, locked again
--       from scratch in one pass after releasing what was held (review round 2
--       WR-01), then failed level
--       by level with one UPDATE ... RETURNING per level. Each
--       child gets `failed_final`, inherits the NAMED parent's error_kind (the
--       lowest-uuid failed parent in the frontier, D-03), and a last_error that
--       reads `fan_in_parent_failed: <that parent's uuid> ended failed_final;
--       this job can never be released` (the uuid sits inside the 60 characters
--       the admin table shows; last_error is the operator surface, the user's
--       copy derives from error_kind alone). Every affected strategy, the failed
--       job's own and each failed descendant's, is then bridged through
--       sync_strategy_analytics_status so the child's strategy leaves
--       `computing`: per-strategy advisory locks in ONE sorted order, after all
--       row locks. No sweep, no cron, no 40001 / 40P01.
--   (2) The cascade 23505 (D-05). Deleting a match_decisions row nulls
--       bridge_outcomes.match_decision_id through ON DELETE SET NULL, and the
--       orphans collide on the md-NULL partial unique index, because the sync
--       trigger nulls original_holding_ref for them and every orphan keys as
--       (allocator, strategy, ''). A first-class admin delete therefore turns a
--       lawful state (two outcomes for one (allocator, strategy) under two
--       decisions, "allowed by design") into a forbidden one, for the cascade
--       population only. FILLED HERE (option Y): a nullable, FK-less
--       bridge_outcomes.former_match_decision_id remembers the decision an
--       orphan came from, and the SAME-named index is re-keyed with
--       COALESCE(former_match_decision_id, zero uuid) as a fourth key, so
--       orphans of different decisions never collide while two rows born with no
--       decision still do (the owner-insert duplicate guard survives; dropping
--       the index, option Z, would have removed it and rewritten the documented
--       invariant). The column is TRIGGER-OWNED, not client-writable in effect
--       (threat T-164.9.3.1-14): the sync trigger forces it NULL on INSERT and
--       whenever a decision is attached, copies OLD.match_decision_id when an
--       UPDATE removes the link AND that decision row no longer exists (the ON
--       DELETE SET NULL cascade; review WR-01), sets it NULL when the decision
--       still exists (a voluntary owner detach is a born-NULL row), keeps the OLD
--       value when an UPDATE leaves the link NULL, and fires on UPDATE OF the
--       column itself. The zero-uuid
--       sentinel is unreachable by a real decision id (gen_random_uuid() is v4).
--       No outcome row is deleted, merged or backfilled; no policy changes.
--       Round-2 RLS audit (a leak that predates this phase, in the same trigger):
--       the trigger is SECURITY DEFINER and copies the attached decision's
--       original_holding_ref into the outcome row, without asking whose decision
--       it is, so an allocator who knew another tenant's decision id could read
--       that tenant's holding ref through its own row. The trigger now refuses a
--       decision whose allocator_id differs from the outcome row's (SQLSTATE
--       42501, hint cross_allocator_decision) before copying anything.
--   (3) The diamond deadlock (D-06). An enqueue naming parents [B, A] and a
--       mark_compute_job_done on A, where B is a waiting child of A, lock the
--       same two rows in opposite orders. FILLED HERE: the lock helper and the
--       enqueue's lock swap.
--   (4) The lost release (D-07, the routed Phase 164.5.2 review item WR-02).
--       Two parents of one child finish in two transactions; each parent's
--       single set-based release statement judges "every parent done" on its
--       own statement-start snapshot, sees the other parent still running, and
--       both match no row. FILLED HERE: lock the children in one statement,
--       release in a later one.
--
-- THE LOCK ORDER (D-06, as clarified on 2026-10-15). D-06 asked for one global
-- order by job id. Executed on the lane, a pure id order STILL deadlocks, for
-- the diamond and for the transitive cascade. The cause is structural: a mark
-- path learns a job's children only AFTER it holds the job (a concurrent
-- enqueue naming the job holds its share lock until commit, and its child row
-- becomes visible only then), so the mark paths are forced to lock parent
-- before child whatever the ids are, and half of all random uuid pairs sort
-- the other way. D-06 is therefore carried out as ANCESTOR-FIRST with the job
-- id as the tie-break: the key is (longest-ancestor-chain depth, id). Every
-- path that takes fan-in row locks takes them in ascending key, through ONE
-- helper, public._fan_in_lock_rows, so the order cannot drift between paths. A
-- wait-for cycle needs two transactions that acquired a pair of rows in
-- opposite order; every path ascends the same key, so none exists. ONE call per
-- path is the rule that makes this true: the failure cascade (review CR-01)
-- therefore locks its whole closure in a single call, not once per level, since
-- two per-level calls can hold a deep row while waiting for a shallower one.
-- Rows born during the cascade's own lock wait (review round 2, WR-01). An
-- enqueue that holds a share lock on a closure row can commit a NEW child while
-- the cascade waits for that row, and once committed that child is visible to
-- EVERY transaction: another cascade has already read it and may hold it, an
-- enqueue naming it may hold a share lock on it. (An earlier version of this
-- paragraph said such rows are known only to their creator. That was wrong.)
-- Locking it on top of the rows already held would be the hold-deep, wait-
-- shallow order CR-01 removed, and it deadlocked (40P01, FL7 reproduces it). So
-- the cascade RE-READS its closure once the locks are held. If the closure
-- grew, it releases the row locks it took (its lock phase is a block with an
-- exception handler, and the rollback of that subtransaction releases them) and
-- locks the whole grown closure again in ONE ascending pass. The failed job's
-- own row stays held across the retry: every closure row is a strict descendant
-- of it, so it sorts before all of them. The retry is bounded (10 attempts) and
-- then fails loud with SQLSTATE 55P03, which aborts the whole RPC: the job stays
-- `running`, and the worker logs one ERROR with the original error_kind and does
-- NOT re-mark it (a re-mark would record error_kind='unknown'); the watchdog
-- reclaims it. The re-read is complete: a child of a locked row can only be
-- created by an enqueue that first share-locks that row, and that waits for this
-- transaction. SCOPE OF THE CLAIM: it covers the
-- compute_jobs fan-in row locks of the paths named here (exercised by FL2 to
-- FL7). It is not a statement about locks this file does not take: the per-
-- strategy bridge advisory locks come afterwards in one sorted order, and an
-- INSERT may wait on a unique-index conflict. Consequences that are rules, not
-- preferences:
--   * rows before advisory locks: the per-strategy bridge advisory lock is taken
--     strictly after every fan-in row lock;
--   * the claim, reclaim, reset and orphan-reaper paths are FOR UPDATE SKIP
--     LOCKED and never wait, so they are outside the order;
--   * there is NO 40P01 or 40001 retry anywhere. The deadlock is not inherent,
--     so the fallback of retrying a victim is not used, and this file raises no
--     new 40001 / 40P01 (Phase 164.9.3.2's rule; the fences stay SQLSTATE 55006).
--
-- WHAT IT DOES NOT CLOSE (named so nobody reads this file as closing them).
--   * The hourly orphan reaper (the inline pg_cron job named
--     retention_compute_jobs_orphaned_running, last registered by the migration
--     20260826140000) is a SECOND `failed_final` writer that does not go through
--     mark_compute_job_failed, so it can still strand a fan-in child of a reaped
--     parent. It is latent (no caller passes parents). Booked in TODOS as
--     164.9.3.1-REAPER-STRAND and left as an OPEN FOUNDER QUESTION: covering it
--     here would re-register the cron job, which gives it a fresh PROD jobid and
--     moves the retention gate's token counts, its mutation twins and the prober
--     cron manifest. This file does not touch the reaper and does not name any
--     scheduling call.
--   * The voluntary_remove 23514 through the same cascade: booked in TODOS
--     (164.9.3.1-VOLUNTARY-REMOVE-23514), routed, not fixed here.
--   * The outcome-route 42P10 (an upsert whose conflict target matches no unique
--     index) IS fixed in this phase, but in TypeScript and not in this file:
--     plan 11 points POST /api/bridge/outcome at the existing
--     (allocator_id, match_decision_id) unique (164.9.3.1-OUTCOME-ROUTE-42P10,
--     CONTEXT D-09). No migration change was needed for it.
--
-- D-04: NO DATA STATEMENT, NO ONE-TIME RELEASE. The read-only PROD census of
-- 2026-10-15 found 0 rows with parents and 0 `done_pending_children` among 2292
-- jobs. So no stranded child exists to release or fail, this file writes no
-- table data, and its DO block at the foot reads catalogs only, never
-- compute_jobs rows ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]: a data-reading
-- block that refuses on TEST's schema-only database would block the PROD apply).
--
-- ASSUMPTION A1: the database runs at READ COMMITTED. Lock-then-release (D-07)
-- relies on the release UPDATE starting a FRESH statement snapshot after the
-- lock wait; under REPEATABLE READ the second statement would still read the
-- transaction-start snapshot. PostgREST and the pg_cron callers use the default
-- level, and the helper and the two re-based functions stay VOLATILE.
--
-- RE-BASE (re-grepped on this tree and on origin/main when this file was
-- written; no later CREATE or ALTER of any of them exists):
--   * public._enqueue_compute_job_internal (10 arguments): 20260924230827
--     (fanin_initial_status_10param), copied byte-for-byte, with ONLY the
--     parent-lock statement replaced by a call to the helper. REVOKE and GRANT
--     restated exactly. The 7-argument overload is uncallable (42725 on any
--     7-argument call, the 20260924230827 header, D-27) and is NOT touched.
--   * public.mark_compute_job_done: 20261009120000 (sync_status_analytics_scope),
--     copied byte-for-byte, with ONLY the fan-in release section replaced
--     (D-07). REVOKE restated exactly.
--   * public.mark_compute_job_failed: 20261009120000 (sync_status_analytics_scope),
--     copied byte-for-byte, with ONLY the declarations, the failure cascade and
--     the multi-strategy bridge added (D-01 to D-03). REVOKE restated exactly.
--   * public.bridge_outcomes_sync_holding_ref: 20260421154029
--     (match_decisions_original_holding_ref), its only definition, copied
--     byte-for-byte with ONLY the former_match_decision_id assignments added
--     (D-05). The trigger is re-created on the wider column list, and the index
--     bridge_outcomes_legacy_per_strategy_holding_when_md_null (created by
--     20260426131721, no later definition) is dropped and re-created re-keyed.
--   * COMMENT ON FUNCTION re-issues for the three compute-job functions are
--     written beside each function below: the 10-argument enqueue (from
--     20260924230827, `Phase 163 OPS-08` kept verbatim, the parent-lock sentence
--     now naming the helper), mark_compute_job_done and mark_compute_job_failed
--     (from 20261001120000, one sentence each). The COMMENT of
--     bridge_outcomes_sync_holding_ref is written in the D-05 section.
--
-- ==========================================================================
-- VAC-04 ACKNOWLEDGEMENT -- the PROD bodies this migration overwrites
-- ==========================================================================
-- The gate compares the COMMITTED SNAPSHOT (supabase/schema/functions/) against
-- PROD's live body. This migration re-bases FOUR existing functions, so it
-- carries FOUR pragmas, one per function, each matched by its own hash. The new
-- helper public._fan_in_lock_rows has no PROD body and needs none.
--
-- MEASURED 2026-10-15 UTC, reproduced LOCALLY with the gate's own normalizer,
-- aiming its `live` argument at origin/main's snapshot rather than at PROD
-- (origin/main = 9014788bc3c4aedc7897a794b739977f6b1be887), once per function:
--
--   git show origin/main:supabase/schema/functions/<fn>.sql > <scratch>
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/<fn>.sql <scratch>
--
-- The DRIFT rows read: _enqueue_compute_job_internal (10 args) 6 differing
-- lines (the 7-argument overload is a MATCH, untouched), mark_compute_job_done 11,
-- mark_compute_job_failed 98, bridge_outcomes_sync_holding_ref 24 (the normalizer
-- counts lines of the function body only; the last two were re-measured after the
-- round-1 review fixes CR-01 and WR-01 and again after the round-2 fixes
-- (mark_compute_job_failed 78 -> 98 for WR-01, bridge_outcomes_sync_holding_ref
-- 12 -> 24 for the cross-allocator refusal), and the four acked `live` hashes
-- below did not move because they hash origin/main's bodies, which those fixes
-- do not touch).
--
-- ⭐ EACH ACKED HASH IS THE `live` COLUMN OF --diff-bodies FOR THAT FUNCTION'S
-- DRIFT ROW (the fifth tab-separated field), NOT `--hash` OF THE SNAPSHOT FILE (a
-- whole-file digest no gate ever greps).
--
-- _enqueue_compute_job_internal (10 args), the DRIFT row's `live` column:
-- prod-body-ack: df8e45648ec918ae583614e7cfda0c8e72580a73adca1cc4cd7b9878e0936d61
--
-- mark_compute_job_done (2 args), the DRIFT row's `live` column:
-- prod-body-ack: 08e322e41c15206cef41ebd63fcd922d631afda2e2d719ec7ab4aa3c0c1518bc
--
-- mark_compute_job_failed (4 args), the DRIFT row's `live` column:
-- prod-body-ack: 59a673d551f1d6cd48c93679611c86a1395f2ab614df3abf078b9ef38a99b701
--
-- bridge_outcomes_sync_holding_ref (0 args), the DRIFT row's `live` column:
-- prod-body-ack: 3f8131921bf3b3ad89abb4393c42bc18572f984ea8e0511e78f170461383acee
--
-- WARNING: EACH ACK IS OF origin/main, WHICH STANDS IN FOR PROD. It is EARNED only
-- if VAC-04 on the PR reports that SAME hash for PROD for that function. If it
-- reports a different one, PROD drifted OUT OF BAND and the correct action is
-- to FOLD the difference into this migration and re-derive, never to edit the
-- pragma to match a gate log. It is EARNED, not pasted.
-- WARNING: VAC-08 (repo-vs-TEST body pairing, in `test-db-drift`) goes RED on
-- the PR by construction, one DRIFT row per function above, until apply-on-merge
-- brings TEST forward; `baseline-content-drift` carries the same rows until the
-- post-apply baseline re-dump.
--
-- Transaction style: NO explicit BEGIN or COMMIT. The migration runner wraps the
-- file in its own transaction, and the pg-lane runs these statements outside
-- one, so nothing here depends on ON COMMIT behaviour. SET LOCAL below applies
-- to whichever transaction that is. Every RAISE format string in this file is a
-- SINGLE literal (Phase 85 invariant 21: no concatenation in a format slot).
--
-- Execution proof is NOT this file's DO block (a catalog copy-check). It is the
-- gates named for each section: supabase/tests/test_fan_in_lock_order_race.sql
-- (real separate backends, lane-only) and
-- supabase/tests/test_fan_in_failure_cascade.sql (single session).
-- ==========================================================================

SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- (3) the ancestor-first lock helper (D-06)
-- --------------------------------------------------------------------------
-- Locks the given compute_jobs rows in ascending (depth, id), where depth is
-- the length of the LONGEST chain of ancestors reached through parent_job_ids.
-- A parent therefore always sorts before its child. The rows are locked in
-- output order because the LockRows node sits above the Sort node; the
-- consumer loop only drives the query. FOR UPDATE OF j when p_for_update, FOR
-- SHARE OF j otherwise; the two branches are the same query.
--
-- Only the rows named by p_ids are locked. The ancestor walk reads the graph to
-- compute depth and takes no locks of its own. The walk is bounded at 64 levels
-- as a cycle guard against a corrupt graph; a chain deeper than 64 would tie-
-- break by id and lose the parent-first guarantee (accepted: PROD holds no
-- parented rows and no caller passes parents).
--
-- PRIVATE. Supabase's default-privilege event trigger grants EXECUTE on every
-- new public function to anon and authenticated, so the REVOKE below is
-- mandatory: a callable row-lock helper is a denial-of-service lever on the
-- whole queue. No service_role grant is needed; only definer functions call it.
CREATE OR REPLACE FUNCTION public._fan_in_lock_rows(p_ids uuid[], p_for_update boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  r record;
BEGIN
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN;
  END IF;

  IF p_for_update THEN
    FOR r IN
      WITH RECURSIVE walk(root, parents, lvl) AS (
        SELECT j.id, j.parent_job_ids, 0
          FROM compute_jobs j
         WHERE j.id = ANY(p_ids)
        UNION ALL
        SELECT w.root, a.parent_job_ids, w.lvl + 1
          FROM walk w
          JOIN compute_jobs a ON a.id = ANY(w.parents)
         WHERE w.lvl < 64
      ), depth AS (
        SELECT root AS id, max(lvl) AS d
          FROM walk
         GROUP BY root
      )
      SELECT j.id
        FROM compute_jobs j
        JOIN depth ON depth.id = j.id
       ORDER BY depth.d, j.id
         FOR UPDATE OF j
    LOOP
      NULL;
    END LOOP;
  ELSE
    FOR r IN
      WITH RECURSIVE walk(root, parents, lvl) AS (
        SELECT j.id, j.parent_job_ids, 0
          FROM compute_jobs j
         WHERE j.id = ANY(p_ids)
        UNION ALL
        SELECT w.root, a.parent_job_ids, w.lvl + 1
          FROM walk w
          JOIN compute_jobs a ON a.id = ANY(w.parents)
         WHERE w.lvl < 64
      ), depth AS (
        SELECT root AS id, max(lvl) AS d
          FROM walk
         GROUP BY root
      )
      SELECT j.id
        FROM compute_jobs j
        JOIN depth ON depth.id = j.id
       ORDER BY depth.d, j.id
         FOR SHARE OF j
    LOOP
      NULL;
    END LOOP;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._fan_in_lock_rows(uuid[], boolean) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._fan_in_lock_rows(uuid[], boolean) IS
  'Private lock helper for the compute_jobs fan-in graph (Phase 164.9.3.1 D-06). '
  'Locks the named rows in ascending (depth, id), depth being the longest chain '
  'of ancestors through parent_job_ids, so a parent always sorts before its '
  'child: FOR UPDATE OF j when p_for_update, FOR SHARE OF j otherwise. It is the '
  'only place a fan-in path takes fan-in row locks, so the order cannot drift. '
  'The ancestor walk stops at 64 levels; a deeper chain would tie-break by id. '
  'Private on purpose: a callable row-lock helper is a queue-wide '
  'denial-of-service lever, so EXECUTE is revoked from PUBLIC, anon and '
  'authenticated.';

-- --------------------------------------------------------------------------
-- (4) mark_compute_job_done: lock the children, then release (D-07)
-- --------------------------------------------------------------------------
-- The body is the LATEST definition (20261009120000), byte for byte, with ONE
-- change: the single set-based release UPDATE becomes a lock statement and a
-- LATER release statement. Its signature, COMMENT and ACL are unchanged
-- (CREATE OR REPLACE keeps the COMMENT; the REVOKE is restated exactly as
-- 20261009120000 issued it).

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
  v_kids             UUID[];
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
  -- Phase 164.9.3.1 D-07 (the routed 164.5.2 review item WR-02): the release is
  -- now TWO statements. Under READ COMMITTED a single UPDATE evaluates its
  -- NOT EXISTS on the statement-start snapshot, so two parents of one child
  -- finishing in two transactions each saw the other still running and both
  -- released nothing. The children are read first, locked in a statement of
  -- their own (through the ancestor-first helper, D-06), and only then released
  -- by a LATER statement: it starts after the lock wait, so it takes a fresh
  -- snapshot that sees the other parent's commit. The GIN-supported `@>`
  -- containment is kept on the read.
  SELECT COALESCE(array_agg(c.id), '{}'::uuid[])
    INTO v_kids
    FROM compute_jobs c
   WHERE c.status = 'done_pending_children'
     AND c.parent_job_ids @> ARRAY[p_job_id]::uuid[];

  IF cardinality(v_kids) > 0 THEN
    PERFORM public._fan_in_lock_rows(v_kids, TRUE);

    UPDATE compute_jobs c
       SET status          = 'pending',
           next_attempt_at = now()
     WHERE c.id = ANY(v_kids)
       AND c.status = 'done_pending_children'
       AND NOT EXISTS (
         SELECT 1
           FROM compute_jobs p
          WHERE p.id = ANY(c.parent_job_ids)
            AND p.status <> 'done'
       );
  END IF;

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(v_strategy_id::text));
    PERFORM sync_strategy_analytics_status(v_strategy_id, p_job_id);
  END IF;
END;
$$;


REVOKE ALL ON FUNCTION mark_compute_job_done(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Catalog text, re-issued from 20261001120000 (the latest COMMENT of this
-- function; nothing newer exists) plus ONE sentence for D-07. Written here and
-- not left to CREATE OR REPLACE's kept pg_description row, so the catalog says
-- what the shipped body does.
COMMENT ON FUNCTION mark_compute_job_done(UUID, UUID) IS 'Terminal success transition. Migration 117 P97 fence + B5 strict-token gate (20260528183100): p_claim_token MUST be non-NULL (NULL raises 22023); mismatch raises SQLSTATE 55006 (object_in_use), which PostgREST answers once. THIS migration (G23-187-mig-01/03): re-applies the GIN-supported set-based `parent_job_ids @> ARRAY[p_job_id]` fan-in advance (the strict-token rewrite had reverted it to a `= ANY(...)` FOR-loop). Preserves the mig 099 Phase-18 atomic UI status bridge. Phase 164.9.3.1 D-07: the waiting children are locked in one statement through public._fan_in_lock_rows and released in the next, so two parents of one child that finish concurrently release it exactly once.';

-- --------------------------------------------------------------------------
-- (3) _enqueue_compute_job_internal (10 arguments): the parent lock goes through
--     the helper (D-06)
-- --------------------------------------------------------------------------
-- The body is the LATEST definition (20260924230827, Phase 164.9.1), byte for
-- byte, with ONE change: the statement that locked the parents FOR SHARE in
-- job-id order is replaced by a call to public._fan_in_lock_rows. Schema-
-- qualified deliberately, as in the source: an unqualified CREATE OR REPLACE
-- resolves against the SESSION search_path and could create a second function in
-- another schema. The 7-argument overload is uncallable and is not touched.
-- Its COMMENT is re-issued right after its ACL below (the phrase the
-- revert-discriminator gate reads stays in place).
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


-- ACL re-converged, restated exactly as 20260924230827 issued it: a Supabase
-- default-grant event trigger can re-open EXECUTE on this function family on
-- every CREATE OR REPLACE (migration 20260515130001 records it).
REVOKE ALL ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) TO service_role;

-- Catalog text, re-issued from 20260924230827 (the latest COMMENT of the
-- 10-argument overload; nothing newer exists). Every sentence is the source's
-- except the parent-lock one, which now names the helper. `Phase 163 OPS-08` is
-- kept verbatim: test_enqueue_internal_destrict.sql greps the catalog for it as
-- its revert discriminator, and verify arm (h) below asserts it.
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

-- --------------------------------------------------------------------------
-- (1) mark_compute_job_failed: the failure cascade (D-01 to D-03)
-- --------------------------------------------------------------------------
-- The body is the LATEST definition (20261009120000, sync_status_analytics_scope;
-- re-grepped on this tree and on origin/main, no later CREATE or ALTER of it),
-- byte for byte, with ONLY the declarations and the cascade block added (and, in
-- the same file, the multi-strategy bridge that replaces the single-strategy one;
-- see the bridge comment in the body). The fences stay SQLSTATE 55006; the
-- cascade raises nothing.
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
  -- Phase 164.9.3.1 D-01..D-03: the failure cascade's working set.
  v_kids          UUID[];
  v_held          UUID[];
  v_frontier      UUID[];
  v_fail_set      UUID[];
  v_attempt       INTEGER;
  v_retry         BOOLEAN;
  v_casc_jobs     UUID[] := '{}';
  v_casc_strats   UUID[] := '{}';
  r_b             RECORD;
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

  -- Phase 164.9.3.1 D-01 to D-03: a parent that ENDS failed_final can never
  -- release a waiting fan-in child (release needs every parent `done`), so the
  -- child would hold its (target, kind) in-flight slot forever and its strategy
  -- would read `computing`. Fail the descendant closure now, in this
  -- transaction:
  --   * ONE ascending lock pass (review CR-01). The whole waiting closure below
  --     the failed job is READ first (a recursive CTE, no locks), then locked in
  --     a single call to _fan_in_lock_rows, and only then written. A lock taken
  --     once per level would hold a deep row (a direct child of the failed job
  --     that also hangs under a longer chain) while it waited for a shallower
  --     one, the opposite of the order every other fan-in path ascends, and that
  --     deadlocks (40P01) against an enqueue or a second cascade. The CTE only
  --     picks WHICH rows to lock; it never writes.
  --   * RE-READ UNDER THE LOCKS (review round 2, WR-01). An enqueue that holds a
  --     share lock on a closure row can commit a NEW child while this
  --     transaction waits for that row. That child is visible to every
  --     transaction from its commit on, so another cascade or an enqueue may
  --     already hold it, and locking it on top of the rows held here would be
  --     the hold-deep, wait-shallow order CR-01 removed (FL7 reproduces the
  --     40P01). The earlier note that only the creator knows such a row was
  --     wrong. So the lock phase is a block with an exception handler, which is
  --     a subtransaction: after the helper call the closure is read AGAIN, and
  --     if it holds a row the locked set does not (the first read has an empty
  --     v_held, so the first pass always locks), the block raises the private
  --     SQLSTATE FI001. The handler's rollback RELEASES every row lock the block
  --     took, and the next attempt reads the grown closure afresh and locks all
  --     of it in ONE ascending pass. The failed job's own row is taken before
  --     the block and stays held: every closure row is a strict descendant of
  --     it, so it sorts first. The loop ends when a re-read under the locks
  --     finds nothing new. That read is complete: a child of a locked row can
  --     only be created by an enqueue that first share-locks that row, and that
  --     waits for this transaction; one committed before the lock was granted is
  --     visible to the re-read, which starts after it. A row that LEFT the
  --     closure meanwhile (failed by another cascade) only shrinks the re-read,
  --     which is still contained in the locked set.
  --   * the retry is bounded at 10 attempts and then fails loud, SQLSTATE 55P03
  --     (never 55006, which the worker swallows as a watchdog preemption, and
  --     never 40001 / 40P01). Each retry needs a concurrent enqueue to have
  --     committed a new descendant inside the window, so the bound is a
  --     tripwire, not a path. The RAISE aborts the whole RPC, so the job's own
  --     row is untouched and stays `running`. The worker (main_worker.py,
  --     dispatch_tick's FAILED branch) matches SQLSTATE 55P03, logs ONE ERROR
  --     carrying the original error_kind and error, and does NOT re-mark the job:
  --     its catch-all fallback would mark it error_kind='unknown' and lose a
  --     permanent failure. The watchdog reclaims the stalled `running` row.
  --   * the writes stay level by level, over the locked set (v_held), one
  --     UPDATE ... RETURNING per level, so each child names its OWN failed parent
  --     (D-03). The UPDATE re-checks `done_pending_children` after the lock, so a
  --     child a concurrent mark_compute_job_done released meanwhile is left alone.
  --   * the child inherits the NAMED parent's error_kind (the lowest-uuid parent
  --     in the frontier, picked by ORDER BY ... LIMIT 1, not an aggregate) and
  --     last_error names that parent inside the 60 characters the admin table
  --     shows. last_error is the OPERATOR surface; the user's copy still derives
  --     from error_kind alone.
  --   * a failed_retry parent cascades nothing: it may still succeed.
  --   * each level only touches done_pending_children rows and turns them
  --     terminal, so a row is processed at most once and the level loop ends
  --     when a level fails nothing.
  IF v_new_status = 'failed_final' THEN
    v_fail_set := ARRAY[p_job_id];
    v_attempt  := 0;
    LOOP
      v_attempt := v_attempt + 1;
      IF v_attempt > 10 THEN
        RAISE EXCEPTION 'mark_compute_job_failed: the waiting closure of job % kept growing across % lock attempts, refusing to fail it half-locked', p_job_id, v_attempt - 1
          USING ERRCODE = '55P03';
      END IF;
      v_held  := '{}'::uuid[];
      v_retry := FALSE;
      BEGIN
        LOOP
          WITH RECURSIVE clo(id) AS (
            SELECT c.id
              FROM compute_jobs c
             WHERE c.status = 'done_pending_children'
               AND c.parent_job_ids && v_fail_set
               AND NOT (c.id = ANY(v_fail_set))
            UNION
            SELECT c.id
              FROM compute_jobs c
              JOIN clo ON c.parent_job_ids @> ARRAY[clo.id]
             WHERE c.status = 'done_pending_children'
          )
          SELECT COALESCE(array_agg(clo.id), '{}'::uuid[])
            INTO v_kids
            FROM clo;
          EXIT WHEN v_kids <@ v_held;
          IF cardinality(v_held) > 0 THEN
            RAISE EXCEPTION 'mark_compute_job_failed: the waiting closure of job % grew while its rows were being locked', p_job_id
              USING ERRCODE = 'FI001';
          END IF;
          PERFORM public._fan_in_lock_rows(v_kids, TRUE);
          v_held := v_kids;
        END LOOP;
      EXCEPTION WHEN SQLSTATE 'FI001' THEN
        v_retry := TRUE;
      END;
      EXIT WHEN NOT v_retry;
    END LOOP;

    IF cardinality(v_held) <> 0 THEN
      v_frontier := v_fail_set;
      LOOP
        WITH failed_kids AS (
          UPDATE compute_jobs c
             SET status          = 'failed_final',
                 error_kind      = fp.error_kind,
                 last_error      = 'fan_in_parent_failed: ' || fp.id::text
                                   || ' ended failed_final; this job can never be released',
                 next_attempt_at = now()
            FROM compute_jobs fp
           WHERE c.id = ANY(v_held)
             AND c.status = 'done_pending_children'
             AND c.parent_job_ids && v_frontier
             AND fp.id = (SELECT x
                            FROM unnest(c.parent_job_ids) AS x
                           WHERE x = ANY(v_frontier)
                           ORDER BY x
                           LIMIT 1)
          RETURNING c.id AS kid_id, c.strategy_id AS kid_strategy_id
        )
        SELECT COALESCE(array_agg(fk.kid_id), '{}'::uuid[]),
               v_casc_jobs
                 || COALESCE(array_agg(fk.kid_id) FILTER (WHERE fk.kid_strategy_id IS NOT NULL), '{}'::uuid[]),
               v_casc_strats
                 || COALESCE(array_agg(fk.kid_strategy_id) FILTER (WHERE fk.kid_strategy_id IS NOT NULL), '{}'::uuid[])
          INTO v_frontier, v_casc_jobs, v_casc_strats
          FROM failed_kids fk;
        EXIT WHEN cardinality(v_frontier) = 0;
      END LOOP;
    END IF;
  END IF;

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  -- Phase 164.9.3.1 D-01: the bridge now covers EVERY affected strategy, this
  -- job's own and each failed descendant's, de-duplicated (one row per
  -- strategy: the own job when the strategy is the job's own, else the lowest
  -- failed job id on it, so the trigger job is deterministic). Without it the
  -- child's strategy keeps reading `computing` although its job is terminal.
  -- Lock order (rules, not preferences): every fan-in row lock above is already
  -- held; the per-strategy advisory locks come AFTER them, taken in ONE sorted
  -- order (hashtext of the strategy id, then the id) so two cascades that
  -- bridge overlapping strategy sets cannot take them in opposite orders. Two
  -- strategies whose hashes collide share one advisory key, which
  -- pg_advisory_xact_lock re-enters in the same transaction (no self-deadlock).
  FOR r_b IN
    SELECT d.strategy_id, d.job_id
      FROM (SELECT DISTINCT ON (u.strategy_id) u.strategy_id, u.job_id
              FROM (SELECT v_strategy_id AS strategy_id, p_job_id AS job_id, 0 AS ord
                    UNION ALL
                    SELECT t.strategy_id, t.job_id, 1
                      FROM unnest(v_casc_strats, v_casc_jobs) AS t(strategy_id, job_id)) u
             WHERE u.strategy_id IS NOT NULL
             ORDER BY u.strategy_id, u.ord, u.job_id) d
     ORDER BY hashtext(d.strategy_id::text), d.strategy_id
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(r_b.strategy_id::text));
    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);
  END LOOP;

  RETURN v_next_attempt;
END;
$$;


REVOKE ALL ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- Catalog text, re-issued from 20261001120000 (the latest COMMENT of this
-- function; nothing newer exists) plus ONE sentence for D-01 to D-03.
COMMENT ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) IS 'Terminal failure transition. Mig 117 / P97 fence + B5 strict-token follow-up: p_claim_token MUST be non-NULL (NULL raises 22023 invalid_parameter_value); mismatch raises SQLSTATE 55006 (object_in_use), which PostgREST answers once. Backoff schedule preserved verbatim from mig 109 P4. HOTFIX 20260529180000: writes error_kind (not the non-existent last_error_kind that mig 20260528183100 typo-introduced, which 42703-errored every failed mark). Phase 164.9.3.1 D-01 to D-03: when the job ends failed_final it locks its whole waiting closure in one ascending pass through public._fan_in_lock_rows and then fails the waiting descendants level by level in the same transaction, each naming its own failed parent in last_error and inheriting that parent''s error_kind, and bridges every affected strategy through sync_strategy_analytics_status. The closure is re-read under the locks: a child committed during the lock wait makes it release the locks it took and lock the grown closure again in one ascending pass (bounded, SQLSTATE 55P03 past ten attempts).';

-- --------------------------------------------------------------------------
-- (2) the cascade 23505 (D-05, option Y): remember the decision an orphaned
--     outcome came from, and key the md-NULL index on it
-- --------------------------------------------------------------------------
-- WHY. bridge_outcomes.match_decision_id is a foreign key with ON DELETE SET
-- NULL, and the sync trigger writes NULL to original_holding_ref for every row
-- whose match_decision_id is NULL. The md-NULL partial unique index therefore
-- keyed every such row as (allocator, strategy, ''), so two outcomes that were
-- lawful under two different decisions (the table's documented invariant:
-- "allowed by design") collided the moment BOTH decisions were deleted: the
-- cascade nulled both links and the second UPDATE raised 23505. Deleting a
-- decision is a first-class admin action, so a lawful state became forbidden
-- for exactly the population the cascade creates.
--
-- THE FIX (option Y). A new nullable column, former_match_decision_id, holds the
-- decision an orphaned row was recorded under, and the SAME-named index is
-- re-keyed with COALESCE(former_match_decision_id, zero uuid) as its fourth key.
-- Orphans of different decisions then never share a key, while two rows BORN with
-- no decision (no former id) still share (allocator, strategy, holding, zero
-- uuid) and still collide: the owner-insert duplicate guard is kept. Option Z
-- (drop the index) was rejected because it removes that guard and rewrites the
-- documented two-part invariant. No outcome row is deleted, merged or backfilled.
--
-- NO FOREIGN KEY on the new column, by design: the decision it names is deleted
-- by the very event that fills it.
--
-- THE COLUMN IS TRIGGER-OWNED (threat T-164.9.3.1-14). bridge_outcomes_insert_own
-- and the owner UPDATE policy let an allocator write the row directly, and the
-- table-level grants make column-level REVOKE ineffective, so a client could
-- forge a former id on a born-NULL row and so slip past the duplicate guard.
-- Neither can a client reach it by attaching a decision and detaching it again
-- (review WR-01): the trigger records a former id only when the decision row is
-- really gone. The sync trigger therefore decides the value on every write it sees:
--   * match_decision_id NOT NULL          -> former := NULL
--   * match_decision_id NULL, INSERT      -> former := NULL (a supplied value is ignored)
--   * match_decision_id NULL, UPDATE that removed the link, decision row gone
--     (the ON DELETE SET NULL cascade)    -> former := OLD.match_decision_id
--   * match_decision_id NULL, UPDATE that removed the link, decision row STILL
--     THERE (a voluntary owner detach)    -> former := NULL (review WR-01: a born-NULL
--                                            key, so the duplicate guard applies)
--   * match_decision_id NULL, UPDATE that kept it NULL
--                                         -> former := OLD.former_match_decision_id
-- and the trigger fires on UPDATE OF former_match_decision_id as well as on
-- match_decision_id, so a direct write of the new column cannot skip it.
--
-- THE ZERO-UUID SENTINEL in the index key: gen_random_uuid() is version 4 and
-- never yields the all-zero value, so a NULL former id and a real one cannot
-- collide.
--
-- RE-BASE: bridge_outcomes_sync_holding_ref() has exactly one definition,
-- 20260421154029 (match_decisions_original_holding_ref); the body below is that
-- body with the former_match_decision_id assignments added and, in the round-2
-- fix, the cross-allocator refusal (the holding ref now goes through a variable
-- so nothing is copied into NEW before the ownership test passes). Its
-- original_holding_ref handling, and the direct-update bypass of it (booked as
-- 164.9.3.1-HOLDING-REF-DIRECT-UPDATE), are unchanged. The index was created by
-- 20260426131721 (commit_scenario_batch_race_fix) and not touched since. No
-- policy is created, altered or dropped: RLS on bridge_outcomes is unchanged and
-- the trigger, not a policy, is what write-protects the new column. The table is
-- small, and SET LOCAL lock_timeout at the file head makes a blocked ADD COLUMN
-- or index swap fail fast instead of hanging the apply.

ALTER TABLE public.bridge_outcomes
  ADD COLUMN IF NOT EXISTS former_match_decision_id uuid;

CREATE OR REPLACE FUNCTION public.bridge_outcomes_sync_holding_ref()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_ref                TEXT;
  v_decision_allocator UUID;
BEGIN
  IF NEW.match_decision_id IS NOT NULL THEN
    SELECT original_holding_ref, allocator_id
      INTO v_ref, v_decision_allocator
      FROM match_decisions
     WHERE id = NEW.match_decision_id;
    -- Round-2 RLS audit. This function is SECURITY DEFINER and copies the
    -- decision's original_holding_ref into the outcome row, which the row's owner
    -- can read. Without this test an allocator who knows ANOTHER tenant's
    -- decision id attaches it (INSERT, or UPDATE SET match_decision_id) and reads
    -- that tenant's holding ref through its own row. A decision that does not
    -- exist is left to the foreign key, as before. The message names no id.
    IF FOUND AND v_decision_allocator IS DISTINCT FROM NEW.allocator_id THEN
      RAISE EXCEPTION 'bridge_outcomes: match_decision_id names a decision that belongs to another allocator'
        USING ERRCODE = '42501', HINT = 'cross_allocator_decision';
    END IF;
    NEW.original_holding_ref := v_ref;
    NEW.former_match_decision_id := NULL;
  ELSE
    NEW.original_holding_ref := NULL;
    IF TG_OP = 'INSERT' THEN
      NEW.former_match_decision_id := NULL;
    ELSIF OLD.match_decision_id IS NOT NULL THEN
      -- Review WR-01. Only the ON DELETE SET NULL cascade may record the old
      -- decision: its UPDATE runs after the decision row is deleted, so the row
      -- is gone here. A decision that still exists means an owner detached the
      -- link on purpose, which is a born-NULL row (no former id) that meets the
      -- duplicate guard; recording the live id would let an owner attach any
      -- decision id and detach it to escape that guard.
      IF EXISTS (SELECT 1 FROM match_decisions WHERE id = OLD.match_decision_id) THEN
        NEW.former_match_decision_id := NULL;
      ELSE
        NEW.former_match_decision_id := OLD.match_decision_id;
      END IF;
    ELSE
      NEW.former_match_decision_id := OLD.former_match_decision_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER bridge_outcomes_sync_holding_ref_trigger
  BEFORE INSERT OR UPDATE OF match_decision_id, former_match_decision_id
  ON public.bridge_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION public.bridge_outcomes_sync_holding_ref();

DROP INDEX IF EXISTS public.bridge_outcomes_legacy_per_strategy_holding_when_md_null;
CREATE UNIQUE INDEX bridge_outcomes_legacy_per_strategy_holding_when_md_null
  ON public.bridge_outcomes USING btree (
    allocator_id,
    strategy_id,
    COALESCE(original_holding_ref, ''::text),
    COALESCE(former_match_decision_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE (match_decision_id IS NULL);

-- The catalog text for the objects above. DROP INDEX removed the index's own
-- COMMENT, and the table COMMENT of 20260925071300 describes the pre-D-05 key,
-- so all of them are written again here. The table COMMENT keeps every object
-- name the Phase 164.9.1 written answer used and its sentence "allowed by
-- design".
COMMENT ON TABLE public.bridge_outcomes IS
  'Allocator self-reported post-intro outcome for a Bridge-recommended strategy, '
  'or for a voluntary scenario decision (Phase 10). '
  'Uniqueness is two-part. (i) bridge_outcomes_allocator_match_decision_unique, '
  'UNIQUE (allocator_id, match_decision_id): one outcome per decision (migration 081). '
  '(ii) bridge_outcomes_legacy_per_strategy_holding_when_md_null, a partial UNIQUE on '
  '(allocator_id, strategy_id, COALESCE(original_holding_ref, ''''), '
  'COALESCE(former_match_decision_id, zero uuid)) WHERE match_decision_id IS NULL '
  '(migration 083, re-keyed by Phase 164.9.3.1 D-05), for rows whose decision is gone. '
  'A row orphaned by the ON DELETE SET NULL cascade keeps the decision it came from in '
  'former_match_decision_id (written by the sync trigger, never by a client, no foreign key), '
  'so orphans of different decisions never collide; a row born with no decision has a NULL '
  'former_match_decision_id, so those keep one outcome per (allocator, strategy, holding). '
  'The sync trigger writes NULL to original_holding_ref for every md-NULL row it touches, so '
  'the holding part of that key is empty for them. '
  'Two outcomes for the same (allocator, strategy) under two different decisions are allowed by design. '
  'Outcomes are editable by owner (D-17) and append-only from an audit perspective '
  '(no DELETE policy; corrective edits via UPSERT). '
  'Scope: D-08 through D-19, OUTCOME-01 through OUTCOME-08.';

COMMENT ON COLUMN public.bridge_outcomes.former_match_decision_id IS
  'Phase 164.9.3.1 D-05. The match_decisions row this outcome was recorded under, kept after '
  'that decision was deleted and the ON DELETE SET NULL cascade nulled match_decision_id. '
  'Written only by bridge_outcomes_sync_holding_ref_trigger: NULL whenever match_decision_id is set, '
  'NULL on INSERT, the old match_decision_id when an UPDATE removes the link and that decision row no '
  'longer exists (the cascade), NULL when an UPDATE removes the link of a decision that still exists '
  '(a voluntary detach), unchanged when an UPDATE leaves it NULL. No foreign key by design (the decision it names is deleted by the event that fills it). '
  'Keys the md-NULL partial unique index, so cascade orphans of different decisions never collide.';

COMMENT ON COLUMN public.bridge_outcomes.original_holding_ref IS
  'Phase 09 / finding f4. Denormalized mirror of match_decisions.original_holding_ref, '
  'populated by bridge_outcomes_sync_holding_ref_trigger on INSERT/UPDATE OF match_decision_id, '
  'only from a decision of the outcome row''s own allocator (another allocator''s decision is refused). '
  'NULL for strategy-sourced rows (original_strategy_id path). '
  'NULL when match_decision_id IS NULL (the trigger writes NULL for those rows). '
  'The md-NULL partial index bridge_outcomes_legacy_per_strategy_holding_when_md_null (migration 083) '
  'keys on COALESCE(original_holding_ref, ''''), then on COALESCE(former_match_decision_id, zero uuid) '
  '(Phase 164.9.3.1 D-05), but because the trigger nulls this column for md-NULL rows, '
  'that index is in effect per (allocator, strategy, former decision); a non-empty holding reaches it only through a direct '
  'UPDATE of this column that leaves match_decision_id unchanged. '
  'Rows with a decision are keyed by bridge_outcomes_allocator_match_decision_unique '
  '(migration 081), which does not read this column.';

COMMENT ON INDEX public.bridge_outcomes_legacy_per_strategy_holding_when_md_null IS
  'Phase 10 / migration 083 (P2), re-keyed by Phase 164.9.3.1 D-05. Partial UNIQUE on '
  '(allocator_id, strategy_id, COALESCE(original_holding_ref, ''''), '
  'COALESCE(former_match_decision_id, zero uuid)) WHERE match_decision_id IS NULL. '
  'Guards two populations of rows with no live decision. Rows born with no decision have a NULL '
  'former_match_decision_id and the sync trigger keeps original_holding_ref NULL, so they share one key '
  'per (allocator, strategy) and a second one raises 23505 (the owner-insert duplicate guard). '
  'Rows orphaned by the ON DELETE SET NULL cascade carry the decision they came from in '
  'former_match_decision_id, so orphans of different decisions never collide. '
  'Rows with a real match_decision_id use bridge_outcomes_allocator_match_decision_unique.';

COMMENT ON FUNCTION public.bridge_outcomes_sync_holding_ref() IS
  'Phase 09 / finding f4, extended by Phase 164.9.3.1 D-05. BEFORE INSERT OR UPDATE OF '
  'match_decision_id, former_match_decision_id trigger function that denormalizes '
  'match_decisions.original_holding_ref into bridge_outcomes (NULL when match_decision_id IS NULL) '
  'and owns former_match_decision_id: NULL when a decision is attached or on INSERT, '
  'OLD.match_decision_id when an UPDATE removes the link and that decision row is already gone (the '
  'ON DELETE SET NULL cascade), NULL when an UPDATE removes the link of a decision that still exists '
  '(a voluntary detach, which is a born-NULL row), OLD.former_match_decision_id when an UPDATE '
  'leaves it NULL, so a client cannot forge it. '
  'It refuses (SQLSTATE 42501, hint cross_allocator_decision) a decision that belongs to another '
  'allocator than the outcome row, before any holding ref is copied. '
  'SECURITY DEFINER + locked search_path; reads match_decisions by PK only (parameterized).';

-- --------------------------------------------------------------------------
-- self-verify (catalog-only copy-check; execution proof is the gates named in
-- the header)
-- --------------------------------------------------------------------------
-- Reads pg_proc, pg_get_functiondef and has_function_privilege only. It never
-- selects from compute_jobs, so it cannot refuse on the schema-only shared TEST
-- database (D-04, [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). Every anchor runs on
-- a COMMENT-STRIPPED copy of the body (block comments first, then line
-- comments), so no prose can satisfy one, and each positive anchor has its own
-- boolean tested by exactly ONE `IF NOT v_<name> THEN` line, so a mutation twin
-- stands it down with a one-token edit.
--
-- ANCHOR CARRY (every anchor of the two source verify blocks that reads one of
-- the three bodies this file re-bases).
--   from 20261009120000 (reads mark_compute_job_done):
--     trigger call sync_strategy_analytics_status(v_strategy_id, p_job_id)  carried
--     per-strategy bridge advisory lock                                     carried
--     55006 fence errcode                                                   carried
--     SECURITY DEFINER + pinned search_path                                 carried
--     no EXECUTE for anon or authenticated                                  carried
--   from 20261009120000 (reads mark_compute_job_failed):
--     trigger call sync_strategy_analytics_status(v_strategy_id, p_job_id)  re-expressed
--     per-strategy bridge advisory lock on v_strategy_id::text              re-expressed
--         (both as v_failed_bridge_anchored: the single bridge call became a
--         loop over r_b, same lock key shape, same trigger function)
--     55006 fence errcode                                                   carried
--     SECURITY DEFINER + pinned search_path                                 carried
--     no EXECUTE for anon or authenticated                                  carried
--   from 20260924230827 (reads the 10-argument enqueue):
--     (a) retired-kind branch                       carried
--     (b) invalid_parameter_value, SECURITY DEFINER, search_path   carried
--     (g) search_path pinned by VALUE (proconfig)   carried
--     (c) no strict lost-race re-read               carried
--     (c2) exactly four plain lost-race re-reads    carried
--     (d) serialization_failure raise               carried
--     (e) ACL: PUBLIC probe, anon and authenticated denied, service_role kept   carried
--     (h) COMMENT keeps the revert-discriminator phrase   carried
--     (i)-(k) initial-status assignments, parents-non-empty predicate, INSERT
--             names status and ends with v_initial_status   carried
--     (m) FOR SHARE parent lock in id order          re-expressed as
--         v_enqueue_lock_anchored (the lock is now the helper call, FOR SHARE
--         is the helper's business and must NOT appear in the body)
--     (m) failed_final parent count, missing-parent and dead-parent refusals   carried
--     (f) compute_jobs_kind_check admits compute_analytics   dropped: it reads a
--         table constraint, not either body, and this file does not touch it
--     (a),(b),(c),(d),(g) 7-argument halves and (l) the 7-argument parity pin
--         dropped: they read the 7-argument overload, which this file does not
--         write (it is uncallable and stays byte-unchanged)
DO $verify$
DECLARE
  -- raw and comment-stripped bodies
  v_helper_raw   TEXT := pg_get_functiondef('public._fan_in_lock_rows(uuid[], boolean)'::regprocedure);
  v_helper       TEXT;
  v_done_raw     TEXT := pg_get_functiondef('public.mark_compute_job_done(uuid, uuid)'::regprocedure);
  v_done         TEXT;
  v_failed_raw   TEXT := pg_get_functiondef('public.mark_compute_job_failed(uuid, text, text, uuid)'::regprocedure);
  v_failed       TEXT;
  v_cfg_helper   TEXT[];
  v_cfg_done     TEXT[];
  -- this phase's anchors (one boolean, one IF each)
  v_helper_order_anchored  BOOLEAN;
  v_helper_acl_anchored    BOOLEAN;
  v_done_lock_anchored     BOOLEAN;
  v_done_gin_anchored      BOOLEAN;
  v_pos_lock               INTEGER;
  v_pos_release            INTEGER;
  v_enqueue_lock_anchored  BOOLEAN;
  v_failed_cascade_anchored BOOLEAN;
  v_failed_closure_anchored BOOLEAN;
  v_failed_reread_anchored  BOOLEAN;
  v_failed_bound_anchored   BOOLEAN;
  v_pos_reread              INTEGER;
  v_failed_level_anchored   BOOLEAN;
  v_failed_locks_anchored   BOOLEAN;
  v_failed_text_anchored    BOOLEAN;
  v_failed_bridge_anchored  BOOLEAN;
  v_pos_self_update         INTEGER;
  v_pos_lock_failed         INTEGER;
  v_pos_level_update        INTEGER;
  v_pos_closure             INTEGER;
  -- (2) the cascade 23505 (D-05): the sync trigger function (raw, stripped) and its anchors
  v_sync_raw                TEXT := pg_get_functiondef('public.bridge_outcomes_sync_holding_ref()'::regprocedure);
  v_sync                    TEXT;
  v_column_anchored         BOOLEAN;
  v_sync_former_anchored    BOOLEAN;
  v_sync_owned_anchored     BOOLEAN;
  v_sync_detach_anchored    BOOLEAN;
  v_sync_owner_anchored     BOOLEAN;
  v_trigger_cols_anchored   BOOLEAN;
  v_index_key_anchored      BOOLEAN;
  v_idx_def                 TEXT;
  -- the 10-argument enqueue (raw, stripped) and its carried-anchor inputs
  v_oid10        OID := to_regprocedure('public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)');
  v_enq          TEXT;
  v_cfg10        TEXT[];
  v_n            INTEGER;
  v_comment10    TEXT;
  c_sig10        CONSTANT TEXT := 'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)';
  c_search_path  CONSTANT TEXT := 'search_path=public, pg_catalog';
  c_applied_marker CONSTANT TEXT := 'Phase 163 OPS-08';
  c_strict_re    CONSTANT TEXT := 'INTO[[:space:]]+STRICT\M';
  c_plain_re     CONSTANT TEXT := 'SELECT[[:space:]]+id[[:space:]]+INTO[[:space:]]+v_new_id';
  c_serfail_re   CONSTANT TEXT := 'USING[[:space:]]+ERRCODE[[:space:]]*=[[:space:]]*''serialization_failure''';
  c_retired_re   CONSTANT TEXT := 'p_kind[[:space:]]*=[[:space:]]*''compute_analytics''';
  c_dpc_assign_re     CONSTANT TEXT := 'v_initial_status[[:space:]]*:=[[:space:]]*''done_pending_children''';
  c_pending_assign_re CONSTANT TEXT := 'v_initial_status[[:space:]]*:=[[:space:]]*''pending''';
  c_parents_re        CONSTANT TEXT := 'array_length[[:space:]]*\([[:space:]]*p_parent_job_ids[[:space:]]*,[[:space:]]*1[[:space:]]*\)[[:space:]]*>[[:space:]]*0';
  c_insert_cols_re    CONSTANT TEXT := 'INSERT[[:space:]]+INTO[[:space:]]+compute_jobs[[:space:]]*\([^)]*\mstatus\M[^)]*\)';
  c_insert_vals_re    CONSTANT TEXT := 'v_initial_status[[:space:]]*\)[[:space:]]*ON[[:space:]]+CONFLICT[[:space:]]+DO[[:space:]]+NOTHING';
  c_parent_failed_re  CONSTANT TEXT := 'FILTER[[:space:]]*\([[:space:]]*WHERE[[:space:]]+pj\.status[[:space:]]*=[[:space:]]*''failed_final''[[:space:]]*\)';
  c_parent_missing_re CONSTANT TEXT := 'RAISE[[:space:]]+EXCEPTION[[:space:]]+''_enqueue_compute_job_internal: p_parent_job_ids names % parent job\(s\) with no compute_jobs row';
  c_parent_dead_re    CONSTANT TEXT := 'RAISE[[:space:]]+EXCEPTION[[:space:]]+''_enqueue_compute_job_internal: % parent job\(s\) in p_parent_job_ids already ended failed_final';
BEGIN
  v_helper := regexp_replace(regexp_replace(v_helper_raw, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  v_done   := regexp_replace(regexp_replace(v_done_raw,   '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  v_failed := regexp_replace(regexp_replace(v_failed_raw, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  v_sync   := regexp_replace(regexp_replace(v_sync_raw,   '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW (a NULL `!~` is NULL, and IF
  -- NULL does not raise).
  IF v_helper IS NULL OR v_done IS NULL OR v_failed IS NULL OR v_sync IS NULL THEN
    RAISE EXCEPTION 'fan-in-graph: a comment-stripped function body came back NULL, so every anchor below would pass on nothing. Refusing to report compliance on an unread body.';
  END IF;
  IF v_oid10 IS NULL THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument _enqueue_compute_job_internal overload was not found.';
  END IF;
  v_enq := regexp_replace(regexp_replace(pg_get_functiondef(v_oid10), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_enq IS NULL THEN
    RAISE EXCEPTION 'fan-in-graph: the comment-stripped 10-argument enqueue body came back NULL, so every anchor below would pass on nothing. Refusing to report compliance on an unread body.';
  END IF;

  -- ======================================================================
  -- (3) the lock helper
  -- ======================================================================
  -- Both lock branches walk the same key: exactly two ORDER BY depth.d, j.id,
  -- one under FOR UPDATE OF j and one under FOR SHARE OF j. A plain `ORDER BY
  -- j.id` is the refuted order (it still deadlocks).
  v_helper_order_anchored := COALESCE(
    (SELECT count(*) FROM regexp_matches(v_helper, 'ORDER\s+BY\s+depth\.d\s*,\s*j\.id', 'g')) = 2
    AND v_helper ~ 'FOR\s+UPDATE\s+OF\s+j'
    AND v_helper ~ 'FOR\s+SHARE\s+OF\s+j',
    FALSE);
  IF NOT v_helper_order_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: _fan_in_lock_rows does not lock in ascending (depth, id) under both FOR UPDATE OF j and FOR SHARE OF j. A plain job-id order still deadlocks on a diamond (Phase 164.9.3.1 D-06).';
  END IF;

  -- Private, definer, pinned, and callable by neither client role.
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'fan-in-graph: the role anon or authenticated does not exist on this database, so the helper ACL anchor cannot be evaluated. These are Supabase-standard roles; their absence means this migration is running somewhere it was not written for.';
  END IF;
  PERFORM public._assert_no_public_execute('public._fan_in_lock_rows(uuid[], boolean)');
  SELECT p.proconfig INTO v_cfg_helper
    FROM pg_proc p
   WHERE p.oid = 'public._fan_in_lock_rows(uuid[], boolean)'::regprocedure;
  v_helper_acl_anchored := COALESCE(
    (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public._fan_in_lock_rows(uuid[], boolean)'::regprocedure)
    AND v_cfg_helper IS NOT NULL
    AND 'search_path=public, pg_catalog' = ANY(v_cfg_helper)
    AND NOT has_function_privilege('anon', 'public._fan_in_lock_rows(uuid[], boolean)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public._fan_in_lock_rows(uuid[], boolean)', 'EXECUTE'),
    FALSE);
  IF NOT v_helper_acl_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: _fan_in_lock_rows is not SECURITY DEFINER with search_path pinned to public, pg_catalog, or anon or authenticated can EXECUTE it. A callable row-lock helper is a queue-wide denial-of-service lever.';
  END IF;

  -- ======================================================================
  -- (4) mark_compute_job_done
  -- ======================================================================
  -- The children are locked through the helper in a statement of their own,
  -- and the release UPDATE comes AFTER it in the body (D-07). Position, not
  -- mere presence: a release written before the lock is the lost release.
  v_pos_lock    := length((regexp_split_to_array(v_done, '_fan_in_lock_rows\s*\(\s*v_kids\s*,\s*TRUE\s*\)'))[1]);
  v_pos_release := length((regexp_split_to_array(v_done, 'SET\s+status\s*=\s*''pending'''))[1]);
  v_done_lock_anchored := COALESCE(
    v_done ~ '_fan_in_lock_rows\s*\(\s*v_kids\s*,\s*TRUE\s*\)'
    AND v_done ~ 'SET\s+status\s*=\s*''pending'''
    AND v_pos_lock < v_pos_release,
    FALSE);
  IF NOT v_done_lock_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_done does not lock its done_pending_children children through _fan_in_lock_rows(v_kids, TRUE) BEFORE the release UPDATE. A release decided on the statement-start snapshot loses a release when two parents finish together (Phase 164.9.3.1 D-07).';
  END IF;

  -- The GIN-supported containment read is kept, and the regressed per-child
  -- FOR-loop stays gone (supabase/tests/test_compute_jobs_rpc_error_clear_and_fanin.sql
  -- pins both on the final body). The loop variable's name is spelled with a
  -- bracket class below so the literal token appears nowhere in this file.
  v_done_gin_anchored := COALESCE(
    v_done ~ 'parent_job_ids\s*@>\s*ARRAY\[\s*p_job_id'
    AND v_done !~ 'FOR\s+v_chil[d]_id\s+IN',
    FALSE);
  IF NOT v_done_gin_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_done lost the GIN-supported parent_job_ids @> ARRAY[p_job_id] containment read, or regained the per-child FOR-loop (audit-2026-05-07 G23-187-mig-01/03).';
  END IF;

  -- CARRIED from 20261009120000: the mark RPC passes the job it just
  -- terminalised to the bridge, still takes the per-strategy bridge advisory
  -- lock, and still carries the 55006 fence errcode.
  IF v_done !~ 'PERFORM\s+sync_strategy_analytics_status\s*\(\s*v_strategy_id\s*,\s*p_job_id\s*\)\s*;' THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_done does not call sync_strategy_analytics_status(v_strategy_id, p_job_id). Without the trigger the bridge cannot tell a side-kind failure from a counting success (carried from 20261009120000).';
  END IF;
  IF v_done !~ 'pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*''mark_compute_job_bridge''\s*\)\s*,\s*hashtext\s*\(\s*v_strategy_id::text\s*\)\s*\)'
     OR v_done !~ '55006' THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_done lost the per-strategy bridge lock or the 55006 fence errcode in the re-base (both carried from 20261009120000).';
  END IF;

  -- CARRIED: SECURITY DEFINER, pinned search_path, and no EXECUTE for anon or
  -- authenticated (CREATE OR REPLACE keeps the ACL; this proves it did).
  SELECT p.proconfig INTO v_cfg_done
    FROM pg_proc p
   WHERE p.oid = 'public.mark_compute_job_done(uuid, uuid)'::regprocedure;
  IF NOT COALESCE(
       (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.mark_compute_job_done(uuid, uuid)'::regprocedure)
       AND v_cfg_done IS NOT NULL
       AND array_to_string(v_cfg_done, ',') LIKE '%search_path=public%',
       FALSE) THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_done lost SECURITY DEFINER or its pinned search_path in the re-base.';
  END IF;
  IF has_function_privilege('anon', 'public.mark_compute_job_done(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_compute_job_done(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fan-in-graph: anon or authenticated can EXECUTE mark_compute_job_done. It is a SECURITY DEFINER writer keyed on a job id with no ownership check; the REVOKE above did not take.';
  END IF;

  -- ======================================================================
  -- (1) mark_compute_job_failed: the failure cascade
  -- ======================================================================
  -- The cascade is gated on the job it just ended being failed_final, and it sits
  -- AFTER the job's own row UPDATE (the cascade reads the parent's committed-in-
  -- transaction state, and a failed_retry parent must cascade nothing).
  v_pos_self_update := length((regexp_split_to_array(v_failed, 'SET\s+status\s*=\s*v_new_status'))[1]);
  v_pos_lock_failed := length((regexp_split_to_array(v_failed, '_fan_in_lock_rows\s*\(\s*v_kids\s*,\s*TRUE\s*\)'))[1]);
  v_pos_level_update := length((regexp_split_to_array(v_failed, 'SET\s+status\s*=\s*''failed_final'''))[1]);
  v_pos_closure := length((regexp_split_to_array(v_failed, 'WITH\s+RECURSIVE\s+clo\M'))[1]);

  v_failed_cascade_anchored := COALESCE(
    v_failed ~ 'IF\s+v_new_status\s*=\s*''failed_final''\s+THEN'
    AND v_failed ~ 'SET\s+status\s*=\s*v_new_status'
    AND v_failed ~ 'SET\s+status\s*=\s*''failed_final'''
    AND v_pos_self_update < v_pos_level_update,
    FALSE);
  IF NOT v_failed_cascade_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_failed has no failure cascade gated on v_new_status = failed_final after its own row UPDATE. A failed_final parent would strand its done_pending_children descendants forever (Phase 164.9.3.1 D-01).';
  END IF;

  -- One level at a time: each level's UPDATE takes only the locked children
  -- whose parents overlap the frontier (parent_job_ids && v_frontier), never a
  -- recursive-CTE closure UPDATE.
  v_failed_level_anchored := COALESCE(
    v_failed ~ 'parent_job_ids\s*&&\s*v_frontier',
    FALSE);
  IF NOT v_failed_level_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_failed does not restrict each cascade level to children whose parents overlap the frontier (parent_job_ids && v_frontier). A recursive-CTE closure UPDATE takes its snapshot before the locks (Phase 164.9.3.1 D-02).';
  END IF;

  -- ONE ascending lock pass over the whole waiting closure (review CR-01): the
  -- closure is READ by a recursive CTE (seeded from the failed job, walking
  -- children by the GIN-supported @> containment), locked by exactly ONE
  -- helper call that precedes the first write, and the level UPDATEs touch only
  -- the locked set (v_held). A second helper call (a lock per level) is the
  -- refuted order: it holds a deep row while it waits for a shallower one.
  v_failed_closure_anchored := COALESCE(
    v_failed ~ 'WITH\s+RECURSIVE\s+clo\s*\(\s*id\s*\)\s+AS'
    AND v_failed ~ 'JOIN\s+clo\s+ON\s+c\.parent_job_ids\s*@>\s*ARRAY\s*\[\s*clo\.id\s*\]'
    AND v_failed ~ 'c\.parent_job_ids\s*&&\s*v_fail_set'
    AND v_failed ~ 'c\.id\s*=\s*ANY\s*\(\s*v_held\s*\)'
    AND (SELECT count(*) FROM regexp_matches(v_failed, '_fan_in_lock_rows\s*\(', 'g')) = 1
    AND v_pos_closure < v_pos_lock_failed,
    FALSE);
  IF NOT v_failed_closure_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_failed does not lock the whole waiting closure of a failed_final job in ONE _fan_in_lock_rows call after a recursive read of it. A lock per cascade level holds a deep row while it waits for a shallower one and deadlocks against an enqueue or a second cascade (Phase 164.9.3.1 D-06, review CR-01).';
  END IF;

  -- The closure is locked through the helper BEFORE the first level UPDATE
  -- (position, not mere presence), so the cascade ascends the same key as every
  -- other fan-in path.
  v_failed_locks_anchored := COALESCE(
    v_failed ~ '_fan_in_lock_rows\s*\(\s*v_kids\s*,\s*TRUE\s*\)'
    AND v_failed ~ 'SET\s+status\s*=\s*''failed_final'''
    AND v_pos_lock_failed < v_pos_level_update,
    FALSE);
  IF NOT v_failed_locks_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_failed does not lock the cascade closure through _fan_in_lock_rows(v_kids, TRUE) BEFORE its first UPDATE. A lock order of its own deadlocks against a concurrent enqueue (Phase 164.9.3.1 D-06).';
  END IF;

  -- RE-READ UNDER THE LOCKS (review round 2, WR-01). After the helper call the
  -- loop reads the closure again: it ends only when that read is contained in
  -- the locked set (EXIT WHEN v_kids <@ v_held), a read that holds a row the
  -- locked set lacks raises the private SQLSTATE FI001 once rows are held, and
  -- a handler for exactly that SQLSTATE turns it into a retry of the whole lock
  -- phase, so the subtransaction's rollback releases the rows taken. Without the
  -- retry a child committed during the lock wait would either be missed
  -- (stranded) or be locked on top of the deeper rows already held (40P01).
  -- Position, not mere presence: the stability test sits BEFORE the helper call
  -- in the loop body, which is what makes the second iteration a re-read.
  v_pos_reread := length((regexp_split_to_array(v_failed, 'EXIT\s+WHEN\s+v_kids\s*<@\s*v_held'))[1]);
  v_failed_reread_anchored := COALESCE(
    v_failed ~ 'EXIT\s+WHEN\s+v_kids\s*<@\s*v_held\s*;'
    AND v_failed ~ 'IF\s+cardinality\s*\(\s*v_held\s*\)\s*>\s*0\s+THEN\s+RAISE\s+EXCEPTION[^;]*USING\s+ERRCODE\s*=\s*''FI001'''
    AND v_failed ~ 'EXCEPTION\s+WHEN\s+SQLSTATE\s+''FI001''\s+THEN'
    AND v_failed ~ 'v_held\s*:=\s*v_kids\s*;'
    AND v_pos_closure < v_pos_reread
    AND v_pos_reread < v_pos_lock_failed,
    FALSE);
  IF NOT v_failed_reread_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_failed does not re-read its waiting closure under the row locks and retry the whole lock phase (releasing what it holds) when the closure grew. A child committed during the lock wait would be missed and stranded, or locked on top of deeper rows held and deadlock (Phase 164.9.3.1 D-06, review round 2 WR-01).';
  END IF;

  -- The retry is bounded and fails loud with a SQLSTATE the worker does not
  -- swallow (55P03; 55006 is the watchdog-preemption fence and would be).
  v_failed_bound_anchored := COALESCE(
    v_failed ~ 'IF\s+v_attempt\s*>\s*10\s+THEN\s+RAISE\s+EXCEPTION[^;]*USING\s+ERRCODE\s*=\s*''55P03'''
    AND v_failed ~ 'v_attempt\s*:=\s*v_attempt\s*\+\s*1',
    FALSE);
  IF NOT v_failed_bound_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_failed has no bounded, fail-loud (SQLSTATE 55P03) retry of the cascade lock phase. An unbounded retry could spin under a stream of enqueues; a silent bound would fail half-locked (Phase 164.9.3.1 D-06, review round 2 WR-01).';
  END IF;

  -- The child names its failed parent and inherits that parent's kind (the
  -- parent row is joined as fp), so the strategy's curated copy derives from a
  -- real error_kind.
  v_failed_text_anchored := COALESCE(
    v_failed ~ '''fan_in_parent_failed: '''
    AND v_failed ~ 'fp\.error_kind',
    FALSE);
  IF NOT v_failed_text_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_failed does not write the fan_in_parent_failed last_error naming the failed parent, or does not inherit fp.error_kind (Phase 164.9.3.1 D-03).';
  END IF;

  -- RE-EXPRESSED from 20261009120000 (its subject changed deliberately): the
  -- source anchored ONE bridge call and ONE advisory lock keyed on
  -- v_strategy_id. The bridge is now a loop over r_b, fed by the failed job's
  -- own (strategy, job) pair UNION ALL the cascade's unnest(v_casc_strats,
  -- v_casc_jobs), taking the same per-strategy advisory lock and calling the same
  -- trigger function with the pair the loop row carries, in a sorted order.
  v_failed_bridge_anchored := COALESCE(
    v_failed ~ 'SELECT\s+v_strategy_id\s+AS\s+strategy_id\s*,\s*p_job_id\s+AS\s+job_id'
    AND v_failed ~ 'unnest\s*\(\s*v_casc_strats\s*,\s*v_casc_jobs\s*\)'
    AND v_failed ~ 'ORDER\s+BY\s+hashtext\s*\(\s*d\.strategy_id::text\s*\)\s*,\s*d\.strategy_id'
    AND v_failed ~ 'pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*''mark_compute_job_bridge''\s*\)\s*,\s*hashtext\s*\(\s*r_b\.strategy_id::text\s*\)\s*\)'
    AND v_failed ~ 'PERFORM\s+sync_strategy_analytics_status\s*\(\s*r_b\.strategy_id\s*,\s*r_b\.job_id\s*\)\s*;',
    FALSE);
  IF NOT v_failed_bridge_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_failed does not bridge every affected strategy (its own and each failed descendant''s) through sync_strategy_analytics_status under a per-strategy advisory lock taken in sorted order. A child strategy left unbridged keeps reading computing although its job is terminal (Phase 164.9.3.1 D-01).';
  END IF;

  -- CARRIED from 20261009120000: the 55006 fence errcode, SECURITY DEFINER with
  -- a pinned search_path, and no EXECUTE for anon or authenticated.
  IF v_failed !~ '55006' THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_failed lost the 55006 fence errcode in the re-base (carried from 20261009120000).';
  END IF;
  IF NOT COALESCE(
       (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.mark_compute_job_failed(uuid, text, text, uuid)'::regprocedure)
       AND array_to_string((SELECT p.proconfig FROM pg_proc p WHERE p.oid = 'public.mark_compute_job_failed(uuid, text, text, uuid)'::regprocedure), ',') LIKE '%search_path=public%',
       FALSE) THEN
    RAISE EXCEPTION 'fan-in-graph: mark_compute_job_failed lost SECURITY DEFINER or its pinned search_path in the re-base.';
  END IF;
  IF has_function_privilege('anon', 'public.mark_compute_job_failed(uuid, text, text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_compute_job_failed(uuid, text, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'fan-in-graph: anon or authenticated can EXECUTE mark_compute_job_failed. It is a SECURITY DEFINER writer keyed on a job id with no ownership check; the REVOKE above did not take.';
  END IF;

  -- ======================================================================
  -- (3) the 10-argument enqueue
  -- ======================================================================
  -- The parent lock is the helper call (shared mode) and nothing else: no
  -- FOR SHARE of its own. Re-expresses the source anchor (m), which required a
  -- share lock taken in plain job-id order, the refuted order.
  v_enqueue_lock_anchored := COALESCE(
    v_enq ~ '_fan_in_lock_rows\s*\(\s*p_parent_job_ids\s*,\s*FALSE\s*\)'
    AND v_enq !~ 'FOR\s+SHARE',
    FALSE);
  IF NOT v_enqueue_lock_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue does not lock its parents through _fan_in_lock_rows(p_parent_job_ids, FALSE), or still carries a FOR SHARE of its own. A job-id order of its own deadlocks against mark_compute_job_done on a diamond (Phase 164.9.3.1 D-06).';
  END IF;

  -- CARRIED from 20260924230827, 10-argument half. (a) retired kind.
  IF v_enq !~ c_retired_re THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue is missing the retired-kind admission branch (p_kind = compute_analytics); Phase 106 D3 regressed.';
  END IF;
  -- (b) error code and SECURITY DEFINER and search_path.
  IF v_enq !~* 'invalid_parameter_value' THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue lost the invalid_parameter_value ERRCODE.';
  END IF;
  IF v_enq !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue lost SECURITY DEFINER.';
  END IF;
  IF v_enq !~* 'search_path' THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue lost SET search_path.';
  END IF;
  -- (g) the pin is the VALUE, not the word.
  SELECT p.proconfig INTO v_cfg10 FROM pg_proc p WHERE p.oid = v_oid10;
  IF v_cfg10 IS NULL OR NOT (c_search_path = ANY(v_cfg10)) THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty, or reordered is search-path-hijackable.', v_cfg10;
  END IF;
  -- (c) no strict re-read; (c2) exactly four plain re-reads, one per target scope.
  IF v_enq ~ c_strict_re THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue carries a strict lost-race re-read; a lost race whose winner advanced past the in-flight statuses would raise NO_DATA_FOUND (Phase 163 OPS-08 regressed).';
  END IF;
  SELECT count(*) INTO v_n FROM regexp_matches(v_enq, c_plain_re, 'g');
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue carries % plain lost-race re-read(s), expected exactly 4 (one per target scope). Deleting the arms also removes the strict form and returns NULL on every lost race, a silent failure.', v_n;
  END IF;
  -- (d) the classified race-loss raise.
  IF v_enq !~ c_serfail_re THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue has no serialization_failure raise; a lost race whose winner already advanced would return NULL silently.';
  END IF;
  -- (e) ACL, the PUBLIC probe first so a PUBLIC leak is named as one.
  IF to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'fan-in-graph: the role service_role does not exist on this database, so the enqueue ACL anchor cannot be evaluated.';
  END IF;
  PERFORM public._assert_no_public_execute(c_sig10);
  IF has_function_privilege('anon', v_oid10, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid10, 'EXECUTE') THEN
    RAISE EXCEPTION 'fan-in-graph: anon or authenticated holds EXECUTE on the 10-argument SECURITY DEFINER enqueue; the ACL drifted open.';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid10, 'EXECUTE') THEN
    RAISE EXCEPTION 'fan-in-graph: service_role lost EXECUTE on the 10-argument enqueue; every sanctioned enqueue path would break.';
  END IF;
  -- (h) the revert discriminator the recurring gate rests on. coalesce is
  -- load-bearing: strpos(NULL, x) = 0 is NULL, not TRUE.
  v_comment10 := coalesce(obj_description(v_oid10, 'pg_proc'), '');
  IF strpos(v_comment10, c_applied_marker) = 0 THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue catalog COMMENT lost the revert-discriminator phrase that supabase/tests/test_enqueue_internal_destrict.sql greps for; that gate would answer SKIP on a real regression. Comment read back: %', v_comment10;
  END IF;
  -- (i)-(k) initial status assignments, the parents predicate, the INSERT.
  IF v_enq !~ c_dpc_assign_re OR v_enq !~ c_pending_assign_re THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue does not assign both done_pending_children and pending to v_initial_status.';
  END IF;
  IF v_enq !~ c_parents_re THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue lost the parents-non-empty predicate on p_parent_job_ids.';
  END IF;
  IF v_enq !~ c_insert_cols_re OR v_enq !~ c_insert_vals_re THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue INSERT does not name status in its column list with v_initial_status as its last VALUES item; the computed status would never reach the row.';
  END IF;
  -- (m) the failed_final parent count and the two parent refusals.
  IF v_enq !~ c_parent_failed_re THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue no longer counts failed_final parents, so a child of a dead parent would be enqueued into a state nothing can release.';
  END IF;
  IF v_enq !~ c_parent_missing_re OR v_enq !~ c_parent_dead_re THEN
    RAISE EXCEPTION 'fan-in-graph: the 10-argument enqueue lost a parent refusal (missing parent or failed_final parent); a child no mark-done can release would be enqueued silently.';
  END IF;

  -- ======================================================================
  -- (2) the cascade 23505 (D-05, option Y): catalog reads only
  -- ======================================================================
  -- The column: a live, nullable uuid, and NO foreign key names it (the decision
  -- it records is deleted by the event that fills it).
  v_column_anchored := COALESCE(
    EXISTS (SELECT 1
              FROM pg_catalog.pg_attribute a
             WHERE a.attrelid = 'public.bridge_outcomes'::regclass
               AND a.attname = 'former_match_decision_id'
               AND a.atttypid = 'uuid'::regtype
               AND NOT a.attnotnull
               AND NOT a.attisdropped
               AND a.attnum > 0)
    AND NOT EXISTS (SELECT 1
                      FROM pg_catalog.pg_constraint c
                      JOIN pg_catalog.pg_attribute a
                        ON a.attrelid = c.conrelid
                       AND a.attnum = ANY (c.conkey)
                     WHERE c.conrelid = 'public.bridge_outcomes'::regclass
                       AND c.contype = 'f'
                       AND a.attname = 'former_match_decision_id'),
    FALSE);
  IF NOT v_column_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: public.bridge_outcomes.former_match_decision_id is missing, not a nullable uuid, or carries a foreign key. The decision it records is deleted by the event that fills it, so it must have none (Phase 164.9.3.1 D-05).';
  END IF;

  -- The cascade branch: an UPDATE that removes the link records the decision.
  v_sync_former_anchored := COALESCE(
    v_sync ~ 'NEW\.former_match_decision_id\s*:=\s*OLD\.match_decision_id', FALSE);
  IF NOT v_sync_former_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: bridge_outcomes_sync_holding_ref no longer stores OLD.match_decision_id in NEW.former_match_decision_id, so a cascade-orphaned outcome forgets its decision and the md-NULL index collides again (Phase 164.9.3.1 D-05).';
  END IF;

  -- Review WR-01: the OLD decision is recorded only when its row is really gone.
  -- A voluntary detach (the decision still exists) falls to the NULL branch. The
  -- existence test must come BEFORE the OLD.match_decision_id copy.
  v_sync_detach_anchored := COALESCE(
    v_sync ~ 'IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+match_decisions\s+WHERE\s+id\s*=\s*OLD\.match_decision_id\s*\)\s+THEN'
    AND length((regexp_split_to_array(v_sync, 'EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+match_decisions'))[1])
        < length((regexp_split_to_array(v_sync, 'NEW\.former_match_decision_id\s*:=\s*OLD\.match_decision_id'))[1]),
    FALSE);
  IF NOT v_sync_detach_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: bridge_outcomes_sync_holding_ref records OLD.match_decision_id as the former decision without first checking that the decision row is gone. An owner could attach any decision id and detach it to escape the born-NULL duplicate guard (review WR-01, threat T-164.9.3.1-14).';
  END IF;

  -- Round-2 RLS audit: the decision being attached must belong to the outcome's
  -- own allocator, and that test sits BEFORE the holding ref is copied into NEW
  -- (position, not mere presence: a copy before the test would still be rolled
  -- back by the raise, but the order is the contract a reader relies on).
  v_sync_owner_anchored := COALESCE(
    v_sync ~ 'SELECT\s+original_holding_ref\s*,\s*allocator_id\s+INTO\s+v_ref\s*,\s*v_decision_allocator'
    AND v_sync ~ 'IF\s+FOUND\s+AND\s+v_decision_allocator\s+IS\s+DISTINCT\s+FROM\s+NEW\.allocator_id\s+THEN\s+RAISE\s+EXCEPTION[^;]*USING\s+ERRCODE\s*=\s*''42501''\s*,\s*HINT\s*=\s*''cross_allocator_decision'''
    AND length((regexp_split_to_array(v_sync, 'IF\s+FOUND\s+AND\s+v_decision_allocator'))[1])
        < length((regexp_split_to_array(v_sync, 'NEW\.original_holding_ref\s*:=\s*v_ref'))[1]),
    FALSE);
  IF NOT v_sync_owner_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: bridge_outcomes_sync_holding_ref does not refuse (SQLSTATE 42501, hint cross_allocator_decision) a decision that belongs to another allocator BEFORE copying its holding ref. An allocator who knows another tenant''s decision id would read that tenant''s holding ref through its own outcome row (round-2 RLS audit).';
  END IF;

  -- Trigger-owned: INSERT stores NULL, an UPDATE that keeps the link NULL keeps the OLD value.
  v_sync_owned_anchored := COALESCE(
    v_sync ~ 'TG_OP\s*=\s*''INSERT'''
    AND v_sync ~ 'NEW\.former_match_decision_id\s*:=\s*OLD\.former_match_decision_id',
    FALSE);
  IF NOT v_sync_owned_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: bridge_outcomes_sync_holding_ref no longer owns former_match_decision_id (INSERT must store NULL, a NULL-to-NULL UPDATE must keep OLD). An owner could forge the column and defeat the md-NULL duplicate guard (threat T-164.9.3.1-14).';
  END IF;

  -- The trigger fires on both columns and is BEFORE + ROW + INSERT + UPDATE
  -- (tgtype bits: ROW 1, BEFORE 2, INSERT 4, UPDATE 16 = 23 exactly).
  v_trigger_cols_anchored := COALESCE(
    (SELECT t.tgtype = 23
            AND (SELECT a.attnum FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = t.tgrelid AND a.attname = 'match_decision_id'
                    AND NOT a.attisdropped) = ANY (t.tgattr::int2[])
            AND (SELECT a.attnum FROM pg_catalog.pg_attribute a
                  WHERE a.attrelid = t.tgrelid AND a.attname = 'former_match_decision_id'
                    AND NOT a.attisdropped) = ANY (t.tgattr::int2[])
       FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid = 'public.bridge_outcomes'::regclass
        AND t.tgname = 'bridge_outcomes_sync_holding_ref_trigger'
        AND NOT t.tgisinternal),
    FALSE);
  IF NOT v_trigger_cols_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: bridge_outcomes_sync_holding_ref_trigger is missing, or is not BEFORE INSERT OR UPDATE OF match_decision_id, former_match_decision_id FOR EACH ROW. A direct write of the new column could skip the trigger (threat T-164.9.3.1-14).';
  END IF;

  -- The re-keyed index: still unique, still partial on the md-NULL population,
  -- and now keyed on the former decision as well.
  SELECT pg_catalog.pg_get_indexdef(i.indexrelid)
    INTO v_idx_def
    FROM pg_catalog.pg_index i
   WHERE i.indexrelid = to_regclass('public.bridge_outcomes_legacy_per_strategy_holding_when_md_null')
     AND i.indisunique;
  v_index_key_anchored := COALESCE(
    v_idx_def LIKE '%former\_match\_decision\_id%'
    AND v_idx_def LIKE '%original\_holding\_ref%'
    AND v_idx_def LIKE '%WHERE (match\_decision\_id IS NULL)%',
    FALSE);
  IF NOT v_index_key_anchored THEN
    RAISE EXCEPTION 'fan-in-graph: bridge_outcomes_legacy_per_strategy_holding_when_md_null is missing, not unique, or not keyed on former_match_decision_id and original_holding_ref WHERE match_decision_id IS NULL. Two cascade orphans would collide again, or the born-NULL duplicate guard is gone (Phase 164.9.3.1 D-05).';
  END IF;

  -- The table COMMENT must describe the re-keyed invariant.
  IF strpos(coalesce(obj_description('public.bridge_outcomes'::regclass, 'pg_class'), ''), 'former_match_decision_id') = 0 THEN
    RAISE EXCEPTION 'fan-in-graph: the public.bridge_outcomes table comment does not mention former_match_decision_id, so the catalog still describes the pre-D-05 index key.';
  END IF;

  -- The three compute-job COMMENTs must describe the shipped behaviour (the
  -- enqueue's `Phase 163 OPS-08` phrase is asserted by arm (h) above).
  IF strpos(v_comment10, '_fan_in_lock_rows') = 0
     OR strpos(coalesce(obj_description('public.mark_compute_job_done(uuid, uuid)'::regprocedure, 'pg_proc'), ''), 'released in the next') = 0
     OR strpos(coalesce(obj_description('public.mark_compute_job_failed(uuid, text, text, uuid)'::regprocedure, 'pg_proc'), ''), 'level by level') = 0 THEN
    RAISE EXCEPTION 'fan-in-graph: a compute-job catalog COMMENT (10-argument enqueue, mark_compute_job_done or mark_compute_job_failed) does not describe the Phase 164.9.3.1 behaviour it ships.';
  END IF;

  RAISE NOTICE 'fan-in-graph: the ancestor-first lock helper is private and anchored, mark_compute_job_done locks its children before it releases them, mark_compute_job_failed locks a failed_final parent''s whole waiting closure in one helper pass (re-read under the locks, re-locked from scratch if it grew), fails the descendants level by level and bridges every affected strategy, and the 10-argument enqueue locks its parents through the helper; the bridge_outcomes sync trigger owns the nullable, FK-less former_match_decision_id (recorded only when the decision row is gone) and the md-NULL index is re-keyed on it; every carried anchor passed on the comment-stripped bodies.';
END $verify$;
