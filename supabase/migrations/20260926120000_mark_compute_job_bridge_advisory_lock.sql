-- ==========================================================================
-- Phase 164.5.2 (BRIDGELOCK), `161.1-D1` / founder decision DEC-4: a
-- per-strategy, transaction-scoped advisory lock in the two terminal mark RPCs,
-- `public.mark_compute_job_done(uuid, uuid)` and
-- `public.mark_compute_job_failed(uuid, text, text, uuid)`.
--
-- WHAT IT CLOSES. Both RPCs end by calling the UI bridge
-- `sync_strategy_analytics_status(strategy_id)`, which reads `compute_jobs`
-- twice at READ COMMITTED and then writes ONE branch of `strategy_analytics`.
-- Two terminal marks on ONE strategy, committing concurrently, interleave
-- inside those reads today: each can decide its branch from a job set the
-- other is about to change. With this lock the second mark on the same
-- strategy waits, before its bridge call, until the first commits, so the two
-- bridge runs are serialized per strategy. Terminal-mark versus terminal-mark
-- is exactly what `161.1-D1` asked for and what this file changes.
--
-- WHAT IT DOES NOT CLOSE (routed to Phase 164.5.2.1 BRIDGERESIDUE). The lock
-- lives in the two mark RPCs, not in the bridge, so every OTHER caller of the
-- bridge, and every other writer of the rows it reads, stays unserialized:
--   * the Python DEFERRED direct bridge call in the job worker;
--   * both claim RPCs (pending / failed_retry -> running);
--   * `reset_stalled_compute_jobs`;
--   * the orphan terminalizer (running -> failed_final);
--   * enqueue INSERTs;
--   * the fan-in release of a child of strategy S triggered by a parent of a
--     DIFFERENT strategy (that mark locks the parent's strategy, not S);
--   * the refresh-marker retraction (a PostgREST UPDATE of the job metadata).
-- The bridge's read-ORDER pins therefore stay load-bearing; this lock does not
-- make them removable.
--
-- THE KEY (D-02). The TWO-integer form of `pg_advisory_xact_lock`: the first
-- key is `hashtext` of the namespace string 'mark_compute_job_bridge', the
-- second is `hashtext` of the job's strategy id as text. In `pg_locks` a
-- two-integer key reports objsubid 2 and a single-bigint key reports objsubid
-- 1, so this key space is disjoint from the single-key strategy hash,
-- `hashtext(p_strategy_id::text)`, that `sync_trades` (20260406065011,
-- 20260510172558, 20260510180535) and `positions_atomic_rebuild`
-- (20260510181748) take on the SAME strategy. A mark therefore never queues
-- behind a long trade sync, and never blocks one. Within the two-integer space
-- the only other namespace in any migration is `hashtext('admin_role_mutate')`
-- (20260530120000); the DO block below recomputes the inequality of the two
-- namespace hashes at apply time rather than trusting a number written here.
--
-- WHERE THE LOCK SITS (D-03 / D-24). It is the FIRST statement inside each
-- RPC's existing strategy guard (the `IF` on a non-NULL strategy id), directly
-- before the bridge call. A strategy-less job (portfolio, allocator) takes no
-- lock. Unguarded, `hashtext(NULL)` is NULL and the STRICT lock function would
-- silently return without locking anything, so the guard, not the lock, is
-- what decides; the placement is pinned by the DO block's statement-shaped
-- anchor over the comment-stripped body.
--
-- LOCK ORDER, BOTH PATHS (D-04), with the new lock marked ADV:
--   mark_compute_job_done:   row lock on the job (the running -> done UPDATE)
--                            -> row locks on each released fan-in child
--                            -> ADV(namespace, strategy)
--                            -> the strategy_analytics row (INSERT ... ON
--                               CONFLICT DO UPDATE; on the insert arm, an FK
--                               key-share on the strategies row)
--   mark_compute_job_failed: row lock on the job (SELECT ... FOR UPDATE, then
--                            the UPDATE of the same row)
--                            -> ADV(namespace, strategy)
--                            -> the strategy_analytics row
-- The bridge's own `compute_jobs` reads are plain SELECTs and lock no row.
-- WHY NO NEW DEADLOCK CYCLE: ADV is taken LAST. A holder of ADV has finished
-- taking job and child row locks, so it can wait only on the strategy_analytics
-- row or the strategies key-share. A cycle would need a third party holding
-- that row and waiting on a job row an ADV waiter holds; the reaper (SA rows
-- only, SKIP LOCKED), the orphan terminalizer and `reset_stalled_compute_jobs`
-- (job rows only, SKIP LOCKED), both claim RPCs (SKIP LOCKED), and
-- `defer_compute_job` (its own job row, no SA write) cannot close it, and any
-- transaction that could would already deadlock against a single mark today,
-- because every mark takes the job row before the SA row. The lock can
-- lengthen an existing wait chain; it adds no cycle class.
-- THE 164.9.1 FOR SHARE DIAMOND (D-12 item 3, recorded in 20260924230827) is
-- NOT made worse: that cycle is built entirely from `compute_jobs` row locks
-- (the enqueue holds a parent FOR SHARE and waits on another; the done mark
-- holds one parent and waits on a child in its fan-in UPDATE). The enqueue
-- never takes ADV, and ADV is taken after the fan-in, so it is never held while
-- waiting on a child. The diamond stays the latent 40P01 owned by D-12.
--
-- RE-BASE (D-05). Each CREATE OR REPLACE below is the LATEST definition,
-- byte-for-byte, plus the one lock statement: `mark_compute_job_done` from
-- 20260603120000 STEP 2, `mark_compute_job_failed` from 20260529180000
-- (re-grepped across every migration at execution; no later definition and no
-- ALTER FUNCTION exists). Each REVOKE is re-issued verbatim. COMMENT ON
-- FUNCTION is NOT re-issued: CREATE OR REPLACE keeps the existing comment, and
-- not touching it keeps the per-function diff to the lock line alone.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — the PROD bodies these CREATE OR REPLACEs overwrite
-- ══════════════════════════════════════════════════════════════════════════
-- (The two `-- prod-body-ack:` lines, one per changed function, are written
-- here by Phase 164.5.2 plan 02, from the `live` column of
-- `node scripts/sql-body-normalize.mjs --diff-bodies`, EARNED and not pasted.)
--
-- Transaction style: NO explicit BEGIN/COMMIT — Supabase wraps each migration
-- in an implicit transaction. SET LOCAL lock_timeout applies to that wrap. This
-- migration writes ZERO table data and validates no existing rows; its DO block
-- reads catalogs and runs random-uuid behavioural probes only
-- ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). Every RAISE format string below is
-- a SINGLE literal (Phase 85 invariant #21 — no '||' concatenation inside a
-- RAISE format slot).
--
-- Execution proof is NOT this file's DO block (a copy-and-placement check). It
-- is the LANE-ONLY two-backend gate
-- supabase/tests/test_mark_rpc_bridge_advisory_lock.sql, which observes WHICH
-- lock a second same-strategy mark waits on.
-- ==========================================================================

SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- mark_compute_job_done
-- --------------------------------------------------------------------------
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
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(v_strategy_id::text));
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION mark_compute_job_done(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- mark_compute_job_failed
-- --------------------------------------------------------------------------
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

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(v_strategy_id::text));
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;

  RETURN v_next_attempt;
END;
$$;

REVOKE ALL ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- Self-verify: catalog reads only. Every body check runs on the
-- COMMENT-STRIPPED `pg_get_functiondef`, so prose can neither satisfy a
-- positive anchor over a deleted statement nor trip a negative one.
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_done_oid            oid := to_regprocedure('public.mark_compute_job_done(uuid, uuid)');
  v_done_fn             text;
  v_done_body           text;
  v_done_cfg            text[];
  v_done_secdef         boolean;
  v_done_lock_anchored  boolean;
  v_failed_oid          oid := to_regprocedure('public.mark_compute_job_failed(uuid, text, text, uuid)');
  v_failed_fn           text;
  v_failed_body         text;
  v_failed_cfg          text[];
  v_failed_secdef       boolean;
  v_failed_lock_anchored boolean;
  v_raised_null_token   boolean := false;
  v_raised_bad_kind     boolean := false;
  v_raised_not_found    boolean := false;
  c_search_path         CONSTANT text := 'search_path=public, pg_catalog';
  c_done_sig            CONSTANT text := 'public.mark_compute_job_done(uuid, uuid)';
  c_failed_sig          CONSTANT text := 'public.mark_compute_job_failed(uuid, text, text, uuid)';
  -- The guard, then the lock (two-integer form, this namespace, the strategy
  -- id as the second key), then the bridge call, as consecutive STATEMENTS.
  -- One regex pins presence, form, namespace, guard and placement together.
  c_lock_re             CONSTANT text :=
    'IF\s+v_strategy_id\s+IS\s+NOT\s+NULL\s+THEN\s+PERFORM\s+pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*''mark_compute_job_bridge''\s*\)\s*,\s*hashtext\s*\(\s*v_strategy_id::text\s*\)\s*\)\s*;\s*PERFORM\s+sync_strategy_analytics_status\s*\(\s*v_strategy_id\s*\)';
BEGIN
  -- (0) the namespace cannot collide with the only other two-integer
  -- namespace in any migration. Recomputed here, never trusted from prose.
  IF hashtext('mark_compute_job_bridge') = hashtext('admin_role_mutate') THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: hashtext(mark_compute_job_bridge) equals hashtext(admin_role_mutate) on this server, so a terminal mark and an admin role mutation on colliding ids would serialize against each other. Choose a different namespace string.';
  END IF;

  IF v_done_oid IS NULL THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: public.mark_compute_job_done(uuid, uuid) does not resolve after its CREATE OR REPLACE';
  END IF;

  v_done_fn := pg_get_functiondef(v_done_oid);
  -- Strip BOTH plpgsql comment syntaxes, block first (T-163-16).
  v_done_body := regexp_replace(regexp_replace(v_done_fn, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- ⛔ NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW.
  IF v_done_body IS NULL THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: the comment-stripped mark_compute_job_done body came back NULL, so every regex arm below would pass without reading anything. Refusing to report compliance on an unread body.';
  END IF;

  -- (1) the lock, statement-shaped, first inside the strategy guard.
  v_done_lock_anchored := v_done_body ~ c_lock_re;
  IF NOT v_done_lock_anchored THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done does not take the two-integer mark_compute_job_bridge advisory lock on the strategy id as the first statement inside its non-NULL strategy guard, directly before the bridge call. Two concurrent terminal marks on one strategy would interleave inside the bridge again (161.1-D1).';
  END IF;

  -- (2) carried forward from 20260603120000 STEP 3, so this full-body re-base
  -- cannot silently revert the fixes that migration pinned.
  IF v_done_body !~* 'parent_job_ids\s*@>\s*ARRAY\[\s*p_job_id' THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done lost the GIN @> set-based fan-in (G23-187-mig-01/03)';
  END IF;
  IF v_done_body ~* 'FOR\s+v_child_id\s+IN' THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done carries the regressed per-child FOR-loop fan-in';
  END IF;
  IF v_done_body !~* 'p_claim_token IS NULL' OR v_done_body !~* 'invalid_parameter_value' THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done lost the B5 strict-token NULL gate (20260528183100)';
  END IF;
  IF v_done_body !~* 'sync_strategy_analytics_status' THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done lost the Phase-18 atomic UI status bridge';
  END IF;

  -- (3) SECURITY DEFINER, and the search_path pin is the VALUE, not the word.
  SELECT p.prosecdef, p.proconfig INTO v_done_secdef, v_done_cfg
    FROM pg_proc p WHERE p.oid = v_done_oid;
  IF v_done_secdef IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done is no longer SECURITY DEFINER, so the worker (service_role) could not reach compute_jobs through it';
  END IF;
  IF v_done_cfg IS NULL OR NOT (c_search_path = ANY(v_done_cfg)) THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty or reordered is search-path-hijackable.', v_done_cfg;
  END IF;

  -- (4) ACL: the REVOKE above re-converged.
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: one of the roles anon / authenticated / service_role does not exist on this database, so the ACL arm cannot be evaluated. These are Supabase-standard roles; their absence means this migration is running somewhere it was not written for.';
  END IF;
  -- The PUBLIC probe runs first so a PUBLIC leak is named as a PUBLIC leak.
  PERFORM public._assert_no_public_execute(c_done_sig);
  IF has_function_privilege('anon', v_done_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_done_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: anon or authenticated holds EXECUTE on the SECURITY DEFINER mark_compute_job_done — ACL drifted open. The PUBLIC probe above already passed, so this is a grant held by the named role directly.';
  END IF;

  -- ===== mark_compute_job_failed =====
  IF v_failed_oid IS NULL THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: public.mark_compute_job_failed(uuid, text, text, uuid) does not resolve after its CREATE OR REPLACE';
  END IF;

  v_failed_fn := pg_get_functiondef(v_failed_oid);
  v_failed_body := regexp_replace(regexp_replace(v_failed_fn, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- ⛔ NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW.
  IF v_failed_body IS NULL THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: the comment-stripped mark_compute_job_failed body came back NULL, so every regex arm below would pass without reading anything. Refusing to report compliance on an unread body.';
  END IF;

  -- (5) the lock, statement-shaped, first inside the strategy guard. Both
  -- RPCs must carry it: a half-applied lock discipline reads as protection
  -- while providing none (D-01).
  v_failed_lock_anchored := v_failed_body ~ c_lock_re;
  IF NOT v_failed_lock_anchored THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_failed does not take the two-integer mark_compute_job_bridge advisory lock on the strategy id as the first statement inside its non-NULL strategy guard, directly before the bridge call. A failure mark and a second terminal mark on one strategy would interleave inside the bridge again (161.1-D1).';
  END IF;

  -- (6) carried forward from 20260529180000: behavioural probes on RANDOM
  -- uuids. They seed nothing and read no row content.
  BEGIN
    PERFORM mark_compute_job_failed(gen_random_uuid(), 'probe', 'permanent', NULL);
  EXCEPTION WHEN invalid_parameter_value THEN v_raised_null_token := true;
  END;
  IF NOT v_raised_null_token THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_failed with a NULL claim token did not raise invalid_parameter_value (the B5 strict fence regressed)';
  END IF;
  BEGIN
    PERFORM mark_compute_job_failed(gen_random_uuid(), 'probe', 'bogus_kind', gen_random_uuid());
  EXCEPTION WHEN invalid_parameter_value THEN v_raised_bad_kind := true;
  END;
  IF NOT v_raised_bad_kind THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_failed with an out-of-vocabulary error_kind did not raise invalid_parameter_value';
  END IF;
  BEGIN
    PERFORM mark_compute_job_failed(gen_random_uuid(), 'probe', 'permanent', gen_random_uuid());
  EXCEPTION WHEN no_data_found THEN v_raised_not_found := true;
  END;
  IF NOT v_raised_not_found THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_failed on an unknown job did not raise no_data_found';
  END IF;

  -- (7) SECURITY DEFINER, and the search_path pin is the VALUE.
  SELECT p.prosecdef, p.proconfig INTO v_failed_secdef, v_failed_cfg
    FROM pg_proc p WHERE p.oid = v_failed_oid;
  IF v_failed_secdef IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_failed is no longer SECURITY DEFINER, so the worker (service_role) could not reach compute_jobs through it';
  END IF;
  IF v_failed_cfg IS NULL OR NOT (c_search_path = ANY(v_failed_cfg)) THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_failed does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty or reordered is search-path-hijackable.', v_failed_cfg;
  END IF;

  -- (8) ACL re-convergence (the role-existence guard above already ran).
  PERFORM public._assert_no_public_execute(c_failed_sig);
  IF has_function_privilege('anon', v_failed_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_failed_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: anon or authenticated holds EXECUTE on the SECURITY DEFINER mark_compute_job_failed — ACL drifted open. The PUBLIC probe above already passed, so this is a grant held by the named role directly.';
  END IF;

  RAISE NOTICE 'mark-compute-job-bridge-lock: mark_compute_job_done and mark_compute_job_failed both take the per-strategy two-integer advisory lock inside their strategy guard before the bridge; namespace distinct from admin_role_mutate; carried-forward anchors and probes, SECURITY DEFINER, the exact search_path pin and the ACL all intact for both.';
END
$verify$;
