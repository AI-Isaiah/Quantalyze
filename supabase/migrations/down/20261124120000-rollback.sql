-- ============================================================================
-- ROLLBACK for 20261124120000_jobledger_attempt_failures.sql
-- Phase 227 JOBLEDGER, plan 01 (MT5D-01).
-- ============================================================================
-- Manual, off the auto-apply path. Run it as ONE transaction, so it either happens
-- whole or not at all (this file carries no transaction statements, like a migration):
--
--   psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
--
-- against the database the marker query in CLAUDE.md names. Run that query FIRST:
--
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
--
-- current_database() is `postgres` on BOTH projects and proves nothing; if the marker is
-- NULL, re-set it before running anything here. What this file undoes:
--   1. Withdraws every table privilege from every role, service_role included, so
--      nothing but the table owner can read or write the kept rows.
--   2. RENAMES the table and every constraint it owns aside (the table to
--      compute_job_attempt_failures_rolled_back_20261124, each constraint and the index
--      behind the unique constraint to a *_rb_20261124 name, because several of the
--      originals would pass PostgreSQL's 63-character identifier limit with the longer
--      suffix and would be silently truncated). The renames are what let the migration be
--      applied again afterwards without a name collision. Nothing is dropped.
--   3. DROPS public.record_compute_job_attempt_error(uuid, uuid, text, text).
--   4. RESTORES mark_compute_job_failed(uuid, text, text, uuid) to the 20261024120000 body
--      (the body without the ledger INSERT). Its ACL and comment are kept by CREATE OR
--      REPLACE.
--
-- Run it only AFTER the analytics worker from plan 08 that calls
-- record_compute_job_attempt_error has been rolled back. Otherwise every 55P03 or late-55006
-- path fails its call on a missing function until the worker or the function is back.
-- Plans 02 and 07 add further dependants of the same table (the 0100 watchdog bodies, the
-- 0600 orphan trigger and the 0700 sanitize_user re-base, whose erasure DELETEs from it); roll
-- those back first as well (0700, 0600 and 0100, in any order, then this file). The precondition below
-- REFUSES, from the catalogue alone, while any of the three still touches the table (review
-- WR-04, WR-05): renaming the table out from under a live dependant would raise 42P01 on every
-- watchdog tick, abort every orphan-terminalizer UPDATE and abort every account erasure.
--
-- ⚠️ DATA IS KEPT (the keep-data rule). This file never removes the table. The rows are
-- the evidence a follow-up session compares, and their removal is a founder decision and no
-- part of this file. They stay in public.compute_job_attempt_failures_rolled_back_20261124
-- (table owner access only).
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records version
-- 20261124120000 as applied while the schema no longer carries it, and `supabase db push`
-- will not re-apply the migration. To re-apply it, delete that ledger row in the same change
-- (or mark it reverted with `supabase migration repair --status reverted 20261124120000`
-- against the intended database, after the marker query above names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that does not carry the migration and on one where an
-- earlier rollback already set the table aside. The DO block after the change is
-- catalogue-only too and aborts the whole rollback if the table still resolves under its
-- own name, the renamed table or its constraints are missing, the RPC still resolves, or
-- the restored mark_compute_job_failed still writes the ledger. Neither reads a row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regclass('public.compute_job_attempt_failures') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120000 refused: public.compute_job_attempt_failures is not present, so this database does not carry 20261124120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
  IF to_regclass('public.compute_job_attempt_failures_rolled_back_20261124') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120000 refused: public.compute_job_attempt_failures_rolled_back_20261124 already exists, so an earlier rollback already set the table aside. Nothing was changed. Decide what to do with the kept rows first.';
  END IF;
  -- Dependants that still write the table. plpgsql binds late, so the rename below would
  -- succeed and then break them: refuse instead, catalogue only (no row is read).
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = 'public.compute_jobs'::regclass
                AND t.tgname = 'compute_jobs_record_orphan_reaped_attempt'
                AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'Rollback 20261124120000 refused: roll back 20261124120600 first, its trigger compute_jobs_record_orphan_reaped_attempt still writes this table and every orphan-terminalizer UPDATE would abort. Nothing was changed.';
  END IF;
  IF COALESCE(pg_get_functiondef(to_regprocedure('public.reset_stalled_compute_jobs(interval, jsonb)')) LIKE '%compute_job_attempt_failures%', FALSE)
     OR COALESCE(pg_get_functiondef(to_regprocedure('public.reclaim_stuck_compute_jobs(interval)')) LIKE '%compute_job_attempt_failures%', FALSE) THEN
    RAISE EXCEPTION 'Rollback 20261124120000 refused: roll back 20261124120100 first, the watchdog functions reset_stalled_compute_jobs and reclaim_stuck_compute_jobs still write this table and every watchdog tick would raise 42P01. Nothing was changed.';
  END IF;
  IF COALESCE(pg_get_functiondef(to_regprocedure('public.sanitize_user(uuid)')) LIKE '%compute_job_attempt_failures%', FALSE) THEN
    RAISE EXCEPTION 'Rollback 20261124120000 refused: roll back 20261124120700 first, sanitize_user still deletes from this table and every account erasure would raise 42P01. Nothing was changed.';
  END IF;
END
$precondition$;

-- 1. Access: no role but the table owner can touch the kept rows.
REVOKE ALL ON TABLE public.compute_job_attempt_failures FROM PUBLIC, anon, authenticated, service_role;

-- 2. Set the table and every name it owns aside. Renaming a constraint renames the index
--    behind a unique or primary key constraint. Nothing is dropped.
ALTER TABLE public.compute_job_attempt_failures
  RENAME TO compute_job_attempt_failures_rolled_back_20261124;

ALTER TABLE public.compute_job_attempt_failures_rolled_back_20261124
  RENAME CONSTRAINT compute_job_attempt_failures_pkey TO compute_job_attempt_failures_pkey_rb_20261124;
ALTER TABLE public.compute_job_attempt_failures_rolled_back_20261124
  RENAME CONSTRAINT compute_job_attempt_failures_strategy_id_fkey TO compute_job_attempt_failures_strategy_id_fkey_rb_20261124;
ALTER TABLE public.compute_job_attempt_failures_rolled_back_20261124
  RENAME CONSTRAINT compute_job_attempt_failures_api_key_id_fkey TO compute_job_attempt_failures_api_key_id_fkey_rb_20261124;
ALTER TABLE public.compute_job_attempt_failures_rolled_back_20261124
  RENAME CONSTRAINT compute_job_attempt_failures_portfolio_id_fkey TO compute_job_attempt_failures_portfolio_id_fkey_rb_20261124;
ALTER TABLE public.compute_job_attempt_failures_rolled_back_20261124
  RENAME CONSTRAINT compute_job_attempt_failures_allocator_id_fkey TO compute_job_attempt_failures_allocator_id_fkey_rb_20261124;
ALTER TABLE public.compute_job_attempt_failures_rolled_back_20261124
  RENAME CONSTRAINT compute_job_attempt_failures_attempt_chk TO compute_job_attempt_failures_attempt_chk_rb_20261124;
ALTER TABLE public.compute_job_attempt_failures_rolled_back_20261124
  RENAME CONSTRAINT compute_job_attempt_failures_cause_class_chk TO compute_job_attempt_failures_cause_class_chk_rb_20261124;
ALTER TABLE public.compute_job_attempt_failures_rolled_back_20261124
  RENAME CONSTRAINT compute_job_attempt_failures_attempt_cause_uq TO compute_job_attempt_failures_attempt_cause_uq_rb_20261124;

-- 3. The worker-lost RPC goes (it has no rows of its own).
DROP FUNCTION public.record_compute_job_attempt_error(uuid, uuid, text, text);

-- 4. mark_compute_job_failed back to the 20261024120000 body, byte for byte (the body
--    without the MT5D-01 INSERT). CREATE OR REPLACE keeps its ACL and COMMENT.
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

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
DECLARE
  v_def text := pg_get_functiondef(to_regprocedure('public.mark_compute_job_failed(uuid, text, text, uuid)'));
BEGIN
  IF to_regclass('public.compute_job_attempt_failures') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120000 failed: public.compute_job_attempt_failures still resolves';
  END IF;
  IF to_regclass('public.compute_job_attempt_failures_rolled_back_20261124') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120000 failed: public.compute_job_attempt_failures_rolled_back_20261124 is missing, so the kept rows are not where this file says they are';
  END IF;
  IF (SELECT count(*) FROM pg_constraint k
       WHERE k.conrelid = 'public.compute_job_attempt_failures_rolled_back_20261124'::regclass
         AND k.conname LIKE '%\_rb\_20261124') <> 8 THEN
    RAISE EXCEPTION 'Rollback 20261124120000 failed: the kept table does not carry all eight renamed constraints';
  END IF;
  IF to_regprocedure('public.record_compute_job_attempt_error(uuid, uuid, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120000 failed: public.record_compute_job_attempt_error(uuid, uuid, text, text) still resolves';
  END IF;
  IF v_def IS NULL OR position('compute_job_attempt_failures' IN v_def) > 0 THEN
    RAISE EXCEPTION 'Rollback 20261124120000 failed: mark_compute_job_failed still writes the attempt ledger or no longer exists';
  END IF;

  RAISE NOTICE 'Rollback 20261124120000: compute_job_attempt_failures is set aside as compute_job_attempt_failures_rolled_back_20261124 with every stored row kept and access withdrawn from every role; record_compute_job_attempt_error is dropped; mark_compute_job_failed is restored to the 20261024120000 body. The migration ledger row is left in place (see the header).';
END
$verify$;
