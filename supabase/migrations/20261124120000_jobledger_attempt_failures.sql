-- ==========================================================================
-- Phase 227 JOBLEDGER, plan 01 (MT5D-01): a failed compute-job attempt keeps its cause.
--
-- THE FOUNDER RULING (CONTEXT, 2026-11-23, MT5D-01): "New append-only table, one row
-- per failed attempt: job id, attempt number, cause class, error text. Written before
-- the M-1137 last_error clear on re-claim, which stays and stays pinned. Survives
-- job-row pruning, because 230 MT5NIGHTLY reads real nights of these records."
-- Reversibility one-way, ruled by the founder, so this plan carries no checkpoint.
--
-- THE DEFECT. claim_compute_jobs_with_priority clears compute_jobs.last_error and
-- error_kind on every failed_retry -> running re-claim (M-1137/M-1138). That clear is
-- correct for the live row (a running job must not show its previous attempt's error),
-- but it is also the ONLY place the cause of attempt 1 was stored, so once attempt 2
-- is claimed the cause is gone for good, and once attempt 2 ends `done` nothing anywhere
-- says attempt 1 ever failed. The retention prunes (done rows at 30 days, failed rows at
-- 90) then erase even the row itself.
--
-- WHAT THIS MIGRATION DOES, in order.
--   STEP 1  public.compute_job_attempt_failures, the append-only ledger.
--   STEP 2  RLS on with no policy, every grant revoked, SELECT restated for service_role.
--   STEP 3  mark_compute_job_failed, re-based on the LATEST body, with ONE added
--           statement: the ledger INSERT, in the same transaction as the status flip.
--   STEP 4  public.record_compute_job_attempt_error, for the two paths where the worker
--           holds the real error but mark_compute_job_failed could not land (SQLSTATE
--           55P03 closure bound, SQLSTATE 55006 late mark after the watchdog took the
--           claim). Plan 08 wires the worker to it.
--   STEP 5  a catalogue-only self-verify.
--
-- DECISIONS THIS PLAN RECORDS (planner, inside CONTEXT "Claude's Discretion").
--   DEC-01-A  cause vocabulary. cause_class admits exactly four values: `error` (a real
--             failure; written here), `watchdog_reset` and `stall_reclaim` (written by plan 02
--             in reset_stalled_compute_jobs and reclaim_stuck_compute_jobs) and
--             `orphan_reaped` (written by plan 07 through a narrow trigger on the orphan
--             terminalizer's running -> failed_final transition, because that cron body
--             cannot be re-registered by a migration under the Phase 164.7 runbook rule).
--             The founder named three (a real error vs a stall reset vs a watchdog reset);
--             the code has four attempt-ending paths and MT5D-01 says "every failed
--             attempt", so all four are recorded.
--   DEC-01-B  write point. The record is written at the failure source, in the failing
--             transaction, so it commits before any later claim can run. The claim pair in
--             20260927120000 is NOT re-issued: its M-1137 clear stays exactly as pinned, and
--             STEP 5 re-reads that pin from the catalogue (carried forward), because the
--             correctness of this ledger depends on that clear being the only place a cause
--             is erased.
--   DEC-01-C  attempt identity. UNIQUE (job_id, claim_token, cause_class), not (job_id,
--             attempts): reclaim_stuck_compute_jobs DECREMENTS attempts, so a count can
--             repeat, while every claim mints a fresh claim_token. The third column lets one
--             attempt carry both a reset row and the worker's real-error row, which is the
--             honest record when both happened. A NULL token (legacy rows) never
--             deduplicates, so no record is ever dropped for it.
--   DEC-01-D  lifecycle. NO foreign key to compute_jobs: the 30/90-day retention prunes must
--             not delete the records Phase 230 reads (precedent
--             strategy_analytics.computation_error_job_id). All FOUR owner columns of
--             compute_jobs are copied and carry the same ON DELETE CASCADE compute_jobs'
--             own FKs carry: strategy_id to strategies, api_key_id to api_keys, portfolio_id
--             to portfolios, allocator_id to auth.users. compute_jobs_target_xor makes
--             derive_allocator_equity and rescore_allocator allocator_id-only and
--             compute_portfolio portfolio_id-only, so for those kinds strategy_id and
--             api_key_id are both NULL and only the last two columns can cascade the
--             record with its owner (review WR-02, an earlier revision of this note
--             wrongly said api_key_id covers them). Error text that can name a broker
--             account is therefore deleted with its owner, and an erasure request can
--             still reach it after the job row is pruned. The allocator_id FK to
--             auth.users enrols the table in scripts/check-gdpr-export-coverage.ts, so
--             src/lib/gdpr-export-manifest.ts carries a direct entry on allocator_id. The
--             cascades alone do NOT erase on the Art. 17 path (sanitize_user anonymizes
--             strategies, portfolios and auth.users and never deletes them), so migration
--             20261124120700 adds an explicit DELETE to sanitize_user. No retention cron in this phase; the table comment says so. Retention is
--             routed to /gsd-secure-phase.
--   DEC-01-E  Phase 230 columns. kind, exchange, api_key_id and job_created_at are copied
--             from the job row because Phase 230 reads MT5 derive_broker_dailies nights, and
--             those jobs can be keyed by api_key_id with a NULL strategy_id (TODOS
--             [175-NIGHTLY-MT5-DERIVE-CHECK]).
--   DEC-01-F  RLS shape. RLS enabled with NO policy (the mt5_server_clock_readings shape),
--             ENABLE without FORCE so the SECURITY DEFINER owner writes are not RLS-subject;
--             SELECT only, to service_role. compute_job_dedup_events' foreign key and its
--             deny-all policy are deliberately NOT copied (its FK to compute_jobs would
--             delete these records under the prunes).
--
-- THE DELTA against the latest mark_compute_job_failed (20261024120000, re-grepped on this
-- tree: no later CREATE or ALTER of it) is ONE statement, in full:
--   an `INSERT INTO public.compute_job_attempt_failures (...) SELECT ... FROM compute_jobs
--   cj WHERE cj.id = p_job_id ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING`,
--   placed immediately after the UPDATE that sets status, last_error, error_kind and
--   next_attempt_at, fenced by a `-- MT5D-01 (phase 227):` comment block. Everything else is
--   byte for byte: the NULL-token RAISE, the error_kind validation, the 55006 preemption
--   RAISE, the 55P03 closure bound, the FI001 retry loop, the fan-in cascade UPDATE (its
--   children get NO record: they never ran), and the sorted bridge loop. CREATE OR REPLACE
--   keeps the existing ACL and COMMENT, so no GRANT is re-issued for it.
--
-- VAC-04 ACKNOWLEDGEMENT. This migration changes ONE existing function body
-- (mark_compute_job_failed); the new function needs no ack. The pragma below is the
-- `live` column of the DRIFT row of
--
--   git show origin/main:supabase/schema/functions/mark_compute_job_failed.sql > <scratch>
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/mark_compute_job_failed.sql <scratch>
--
-- derived LOCALLY with the gate's own normalizer, aiming `live` at the committed snapshot
-- this branch started from (its pre-change copy), NOT --hash of a snapshot file.
-- ⚠️ IT IS ORIGIN/MAIN'S BODY STANDING IN FOR PROD. The ack is EARNED only if VAC-04 on the
-- PR reports that SAME hash for PROD. If it reports another, PROD drifted out of band and the
-- correct action is to FOLD the difference into this migration and re-derive, never to edit a
-- pragma to match a gate log.
-- ⚠️ VAC-08 (repo-vs-TEST body pairing, the test-db-drift job) is RED on the PR by
-- construction: one DRIFT row for mark_compute_job_failed, until apply-on-merge brings TEST
-- forward.
--
-- prod-body-ack: 48d8bb60bf9d76f8adc504d6597ea44bd1ee4a07e16b450b48a31eb4a1dc7a13
--
-- Rollback: supabase/migrations/down/20261124120000-rollback.sql (manual, never auto-applied).
-- Roll the plan-08 worker back FIRST. It keeps the table and its rows.
--
-- SELF-VERIFY (STEP 5) reads catalogues only (pg_class, pg_attribute, pg_constraint,
-- pg_policy, pg_proc, has_*_privilege), never a table row, so
-- scripts/lint-migration-data-dependence.mjs passes and the apply cannot refuse on a
-- database whose tables are empty. Every RAISE is one literal naming the consequence.
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: public.compute_job_attempt_failures, the ledger
-- ==========================================================================
-- Plain CREATE TABLE, not IF NOT EXISTS: the name is new, so a collision must fail loud.
CREATE TABLE public.compute_job_attempt_failures (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No foreign key to compute_jobs (DEC-01-D): the retention prunes must not delete these rows.
  job_id          uuid        NOT NULL,
  kind            text        NOT NULL,
  strategy_id     uuid        NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
  api_key_id      uuid        NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  portfolio_id    uuid        NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  allocator_id    uuid        NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange        text        NULL,
  job_created_at  timestamptz NOT NULL,
  attempt         integer     NOT NULL,
  claim_token     uuid        NULL,
  cause_class     text        NOT NULL,
  error_kind      text        NULL,
  error_text      text        NULL,
  worker_id       text        NULL,
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compute_job_attempt_failures_attempt_chk
    CHECK (attempt >= 0),
  CONSTRAINT compute_job_attempt_failures_cause_class_chk
    CHECK (cause_class IN ('error', 'watchdog_reset', 'stall_reclaim', 'orphan_reaped')),
  CONSTRAINT compute_job_attempt_failures_attempt_cause_uq
    UNIQUE (job_id, claim_token, cause_class)
);

COMMENT ON TABLE public.compute_job_attempt_failures IS
  'Phase 227 MT5D-01 (migration 20261124120000): append-only, one row per failed compute-job attempt and cause. Written ONLY by SECURITY DEFINER functions (mark_compute_job_failed and record_compute_job_attempt_error write cause_class error; plan 02 writes watchdog_reset and stall_reclaim; plan 07 writes orphan_reaped). Outlives the compute_jobs rows: there is NO foreign key to compute_jobs, so the 30/90-day retention prunes never delete a record. Read order for one job: attempt, then recorded_at, then id. strategy_id, api_key_id, portfolio_id and allocator_id cascade (mirroring compute_jobs), so error text that can name a broker account is deleted with its strategy, api key, portfolio or allocator. allocator_id is exported by the GDPR manifest. No retention cron in this phase; retention is routed to /gsd-secure-phase. service_role holds SELECT only.';
COMMENT ON COLUMN public.compute_job_attempt_failures.id IS
  'Row id, generated. The last tie-break of the documented read order (attempt, recorded_at, id).';
COMMENT ON COLUMN public.compute_job_attempt_failures.job_id IS
  'The compute_jobs.id of the failed attempt. NOT a foreign key: the record outlives the job row.';
COMMENT ON COLUMN public.compute_job_attempt_failures.kind IS
  'compute_jobs.kind of the job, copied at failure time (Phase 230 reads derive_broker_dailies nights).';
COMMENT ON COLUMN public.compute_job_attempt_failures.strategy_id IS
  'compute_jobs.strategy_id, copied. NULL for a job keyed by api_key_id. ON DELETE CASCADE: the record dies with its strategy.';
COMMENT ON COLUMN public.compute_job_attempt_failures.api_key_id IS
  'compute_jobs.api_key_id, copied. Phase 230 reads MT5 derive jobs keyed by it with a NULL strategy_id. ON DELETE CASCADE: the record dies with its api key.';
COMMENT ON COLUMN public.compute_job_attempt_failures.portfolio_id IS
  'compute_jobs.portfolio_id, copied. Set for compute_portfolio jobs, whose strategy_id and api_key_id are NULL. ON DELETE CASCADE: the record dies with its portfolio.';
COMMENT ON COLUMN public.compute_job_attempt_failures.allocator_id IS
  'compute_jobs.allocator_id, copied. Set for derive_allocator_equity and rescore_allocator jobs, whose strategy_id and api_key_id are NULL. ON DELETE CASCADE from auth.users: the record dies with its allocator, and the GDPR export reads it by this column.';
COMMENT ON COLUMN public.compute_job_attempt_failures.exchange IS
  'compute_jobs.exchange, copied. NULL when the job carries none.';
COMMENT ON COLUMN public.compute_job_attempt_failures.job_created_at IS
  'compute_jobs.created_at of the job, copied, so a reader can place the record in the job''s life after the job row is pruned.';
COMMENT ON COLUMN public.compute_job_attempt_failures.attempt IS
  'The attempt number that failed: compute_jobs.attempts at the moment it ended. Not an identity (reclaim_stuck_compute_jobs decrements attempts); the identity is (job_id, claim_token, cause_class).';
COMMENT ON COLUMN public.compute_job_attempt_failures.claim_token IS
  'The claim_token the failed attempt held. Every claim mints a fresh one, so it separates attempts of one job. NULL (a legacy row) never deduplicates.';
COMMENT ON COLUMN public.compute_job_attempt_failures.cause_class IS
  'Why the attempt ended: error (a real failure, written by mark_compute_job_failed or record_compute_job_attempt_error), watchdog_reset (reset_stalled_compute_jobs, plan 02), stall_reclaim (reclaim_stuck_compute_jobs, plan 02), orphan_reaped (the orphan terminalizer trigger, plan 07). One attempt can carry an error row AND a reset row; both happened.';
COMMENT ON COLUMN public.compute_job_attempt_failures.error_kind IS
  'transient, permanent or unknown, as the worker classified a real error. NULL on a reset or reap record.';
COMMENT ON COLUMN public.compute_job_attempt_failures.error_text IS
  'The error text the worker reported. NULL when the worker reported none; a NULL is never replaced by a made-up string. May name a broker account, which is why the owner cascade exists.';
COMMENT ON COLUMN public.compute_job_attempt_failures.worker_id IS
  'compute_jobs.claimed_by of the failed attempt (the worker that held the claim). NULL when none was recorded.';
COMMENT ON COLUMN public.compute_job_attempt_failures.recorded_at IS
  'When the record was written. Second key of the documented read order (attempt, recorded_at, id).';

-- ==========================================================================
-- STEP 2: RLS and grants
-- ==========================================================================
-- RLS ENABLE, deliberately WITHOUT FORCE and with NO policy (DEC-01-F). Every non-owner
-- role is refused by default, and the SECURITY DEFINER writers run as the table owner,
-- which bypasses RLS because the table is ENABLEd and not FORCEd. FORCE would subject the
-- owner to the (empty) policy set and turn every writer's INSERT into a refusal that
-- aborts the failure mark itself.
ALTER TABLE public.compute_job_attempt_failures ENABLE ROW LEVEL SECURITY;

-- Supabase default privileges hand new tables to anon, authenticated and service_role, so
-- everything is revoked first and the one positive grant is restated. service_role keeps
-- SELECT only (operators and Phase 230); no role holds INSERT, so rows arrive only through
-- the SECURITY DEFINER writers and a direct writer fails loud with 42501.
REVOKE ALL ON TABLE public.compute_job_attempt_failures FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.compute_job_attempt_failures TO service_role;

-- ==========================================================================
-- STEP 3: mark_compute_job_failed, re-based on 20261024120000 with ONE added statement
-- ==========================================================================
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

  -- MT5D-01 (phase 227): keep this attempt's cause. The record is written in the SAME
  -- transaction that flips the job to failed, so a committed failure always has its
  -- record and a rolled-back one has none. It must come before any later claim, because
  -- claim_compute_jobs_with_priority clears last_error and error_kind on re-claim
  -- (M-1137/M-1138), which stays. claim_token and attempts are still the failed
  -- attempt's own (the UPDATE above does not touch them). ON CONFLICT: the same cause
  -- for one attempt collapses into one row. The fan-in cascade below records NOTHING
  -- for its children: they never ran.
  INSERT INTO public.compute_job_attempt_failures
         (job_id, kind, strategy_id, api_key_id, portfolio_id, allocator_id, exchange, job_created_at,
          attempt, claim_token, cause_class, error_kind, error_text, worker_id)
  SELECT cj.id, cj.kind, cj.strategy_id, cj.api_key_id, cj.portfolio_id, cj.allocator_id, cj.exchange, cj.created_at,
         cj.attempts, p_claim_token, 'error', p_error_kind, p_error, cj.claimed_by
    FROM compute_jobs cj
   WHERE cj.id = p_job_id
  ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING;

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

-- ==========================================================================
-- STEP 4: public.record_compute_job_attempt_error, the worker-lost real error
-- ==========================================================================
-- Plain CREATE FUNCTION, not OR REPLACE: the name is new, so a collision fails loud.
--
-- WHY IT EXISTS. mark_compute_job_failed is the normal writer of an `error` record. Two
-- paths leave the worker holding the REAL error with no record written: SQLSTATE 55P03
-- (the fan-in closure lock bound; the RAISE aborts the whole RPC, so the INSERT above rolls
-- back with it and the row stays `running`) and SQLSTATE 55006 (a LATE mark: the watchdog
-- already took the claim, so the RPC refuses before it writes). Without this function that
-- real error would read as a reset only, which is the confusion MT5D-01 forbids. Plan 08
-- wires the worker to it.
--
-- THE TOKEN MUST BE ATTESTED, and the attestation decides where the other columns come from:
--   (a) by the JOB ROW: status 'running' AND claim_token = p_claim_token (the 55P03
--       shape). kind, strategy_id, api_key_id, exchange, created_at, attempts and
--       claimed_by come from the job row.
--   (b) by an existing LEDGER ROW with the same job_id and claim_token whose cause_class
--       is watchdog_reset, stall_reclaim or orphan_reaped (the late-mark shape: the
--       watchdog took the claim, or the orphan terminalizer reaped the attempt). kind,
--       strategy_id, api_key_id, portfolio_id, allocator_id, exchange, job_created_at,
--       attempt and worker_id come from THAT ledger
--       row, never from the job row: by then the job may be re-claimed by another worker,
--       so its attempts and claimed_by belong to the NEXT attempt. A late error is filed
--       under the attempt that raised it.
-- With neither attestation it inserts nothing and returns false (a forged token, or a job
-- id that does not exist, writes nothing). It returns whether a row was inserted, so a
-- repeat of the same call returns false.
-- There is NO exception handler: a failure here is a defect, and a swallowed one would be
-- silent.
CREATE FUNCTION public.record_compute_job_attempt_error(
  p_job_id      uuid,
  p_claim_token uuid,
  p_error       text,
  p_error_kind  text DEFAULT 'unknown'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'record_compute_job_attempt_error: p_claim_token is required, an unattested error would be recorded against no attempt'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_error_kind IS NOT NULL
     AND p_error_kind NOT IN ('transient', 'permanent', 'unknown') THEN
    RAISE EXCEPTION 'record_compute_job_attempt_error: p_error_kind must be transient/permanent/unknown, got %', p_error_kind
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (a) attested by the job row (the 55P03 shape).
  INSERT INTO public.compute_job_attempt_failures
         (job_id, kind, strategy_id, api_key_id, portfolio_id, allocator_id, exchange, job_created_at,
          attempt, claim_token, cause_class, error_kind, error_text, worker_id)
  SELECT cj.id, cj.kind, cj.strategy_id, cj.api_key_id, cj.portfolio_id, cj.allocator_id, cj.exchange, cj.created_at,
         cj.attempts, p_claim_token, 'error', p_error_kind, p_error, cj.claimed_by
    FROM compute_jobs cj
   WHERE cj.id = p_job_id
     AND cj.status = 'running'
     AND cj.claim_token = p_claim_token
  ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    RETURN TRUE;
  END IF;

  -- The job row attests this token and its error is already on file: nothing to add.
  IF EXISTS (SELECT 1 FROM compute_jobs cj
              WHERE cj.id = p_job_id
                AND cj.status = 'running'
                AND cj.claim_token = p_claim_token) THEN
    RETURN FALSE;
  END IF;

  -- (b) attested by an existing reset or reclaim record of the same attempt (the late-55006
  -- shape). The columns are copied from THAT record, never from the job row.
  INSERT INTO public.compute_job_attempt_failures
         (job_id, kind, strategy_id, api_key_id, portfolio_id, allocator_id, exchange, job_created_at,
          attempt, claim_token, cause_class, error_kind, error_text, worker_id)
  SELECT f.job_id, f.kind, f.strategy_id, f.api_key_id, f.portfolio_id, f.allocator_id, f.exchange, f.job_created_at,
         f.attempt, p_claim_token, 'error', p_error_kind, p_error, f.worker_id
    FROM public.compute_job_attempt_failures f
   WHERE f.job_id = p_job_id
     AND f.claim_token = p_claim_token
     AND f.cause_class IN ('watchdog_reset', 'stall_reclaim', 'orphan_reaped')
   ORDER BY f.recorded_at, f.id
   LIMIT 1
  ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- Every statement carries the full argument list (a bare name raises 42725 where two
-- overloads exist, and a Supabase default-grant event trigger can re-open EXECUTE).
REVOKE ALL ON FUNCTION public.record_compute_job_attempt_error(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_compute_job_attempt_error(uuid, uuid, text, text)
  TO service_role;

COMMENT ON FUNCTION public.record_compute_job_attempt_error(uuid, uuid, text, text) IS
  'Phase 227 MT5D-01 (migration 20261124120000): files a REAL worker error as a cause_class error record in compute_job_attempt_failures when mark_compute_job_failed could not land (SQLSTATE 55P03 closure bound, or a 55006 late mark after the watchdog took the claim). The claim token must be attested by the running job row or by an existing watchdog_reset / stall_reclaim / orphan_reaped record of the same job; otherwise nothing is written and it returns false. Returns whether a row was inserted. service_role only.';

-- ==========================================================================
-- STEP 5: self-verify, CATALOGUE ONLY (reads no table row)
-- ==========================================================================
-- Each condition is computed into a named boolean and tested in its own IF, so a mutation
-- twin of the gate (supabase/tests/test_compute_job_attempt_failures.sql) can stand one IF
-- down and let the arm's OWN observable go red. Every RAISE is one literal.
DO $verify$
DECLARE
  v_tbl            oid := to_regclass('public.compute_job_attempt_failures');
  v_rls            boolean;
  v_policies       integer;
  v_lits           text[];
  v_uq_def         text;
  v_fk_compute     boolean;
  v_fk_strat_ok    boolean;
  v_fk_key_ok      boolean;
  v_fk_port_ok     boolean;
  v_fk_alloc_ok    boolean;
  v_priv_anon      boolean;
  v_priv_auth      boolean;
  v_priv_svc_sel   boolean;
  v_priv_svc_write boolean;
  v_mark_oid       oid := to_regprocedure('public.mark_compute_job_failed(uuid, text, text, uuid)');
  v_mark_body      text;
  v_pos_upd        integer;
  v_pos_ins        integer;
  v_rec_oid        oid := to_regprocedure('public.record_compute_job_attempt_error(uuid, uuid, text, text)');
  v_rec_cfg        text[];
  v_p5_oid         oid := to_regprocedure('public.claim_compute_jobs_with_priority(integer, text, boolean, text[], text[])');
  v_p5_body        text;
  v_table_ok       boolean;
  v_rls_ok         boolean;
  v_cause_ok       boolean;
  v_uq_ok          boolean;
  v_no_fk_ok       boolean;
  v_cascade_ok     boolean;
  v_acl_ok         boolean;
  v_svc_ok         boolean;
  v_ins_after_ok   boolean;
  v_fences_ok      boolean;
  v_rec_pin_ok     boolean;
  v_rec_acl_ok     boolean;
  v_clear_ok       boolean;
BEGIN
  v_table_ok := v_tbl IS NOT NULL;
  IF NOT v_table_ok THEN
    RAISE EXCEPTION 'jobledger: public.compute_job_attempt_failures does not exist, so a failed attempt keeps no cause';
  END IF;

  SELECT c.relrowsecurity INTO v_rls FROM pg_class c WHERE c.oid = v_tbl;
  SELECT count(*) INTO v_policies FROM pg_policy p WHERE p.polrelid = v_tbl;
  v_rls_ok := v_rls IS TRUE AND v_policies = 0;
  IF NOT v_rls_ok THEN
    RAISE EXCEPTION 'jobledger: compute_job_attempt_failures must have row level security enabled and no policy, otherwise a non-owner role can read or write broker-naming error text';
  END IF;

  SELECT array_agg(m[1] ORDER BY m[1]) INTO v_lits
    FROM pg_constraint k,
         LATERAL regexp_matches(pg_get_constraintdef(k.oid), '''([a-z_]+)''', 'g') AS m
   WHERE k.conrelid = v_tbl
     AND k.conname = 'compute_job_attempt_failures_cause_class_chk';
  v_cause_ok := v_lits IS NOT DISTINCT FROM ARRAY['error', 'orphan_reaped', 'stall_reclaim', 'watchdog_reset'];
  IF NOT v_cause_ok THEN
    RAISE EXCEPTION 'jobledger: the cause_class CHECK must admit exactly error, watchdog_reset, stall_reclaim and orphan_reaped, otherwise a later plan''s record is refused or an unknown cause is stored';
  END IF;

  SELECT pg_get_constraintdef(k.oid) INTO v_uq_def
    FROM pg_constraint k
   WHERE k.conrelid = v_tbl
     AND k.conname = 'compute_job_attempt_failures_attempt_cause_uq'
     AND k.contype = 'u';
  v_uq_ok := v_uq_def = 'UNIQUE (job_id, claim_token, cause_class)';
  IF NOT v_uq_ok THEN
    RAISE EXCEPTION 'jobledger: UNIQUE (job_id, claim_token, cause_class) is missing, so one attempt''s cause can be recorded twice';
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = v_tbl AND k.contype = 'f'
                    AND k.confrelid = to_regclass('public.compute_jobs'))
    INTO v_fk_compute;
  v_no_fk_ok := NOT v_fk_compute;
  IF NOT v_no_fk_ok THEN
    RAISE EXCEPTION 'jobledger: compute_job_attempt_failures must not reference compute_jobs by foreign key, otherwise the retention prunes delete the records Phase 230 reads';
  END IF;

  SELECT EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = v_tbl AND k.contype = 'f'
                    AND k.confrelid = to_regclass('public.strategies')
                    AND k.confdeltype = 'c'
                    AND (SELECT a.attname FROM pg_attribute a
                          WHERE a.attrelid = v_tbl AND a.attnum = k.conkey[1]) = 'strategy_id')
    INTO v_fk_strat_ok;
  SELECT EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = v_tbl AND k.contype = 'f'
                    AND k.confrelid = to_regclass('public.api_keys')
                    AND k.confdeltype = 'c'
                    AND (SELECT a.attname FROM pg_attribute a
                          WHERE a.attrelid = v_tbl AND a.attnum = k.conkey[1]) = 'api_key_id')
    INTO v_fk_key_ok;
  SELECT EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = v_tbl AND k.contype = 'f'
                    AND k.confrelid = to_regclass('public.portfolios')
                    AND k.confdeltype = 'c'
                    AND (SELECT a.attname FROM pg_attribute a
                          WHERE a.attrelid = v_tbl AND a.attnum = k.conkey[1]) = 'portfolio_id')
    INTO v_fk_port_ok;
  SELECT EXISTS (SELECT 1 FROM pg_constraint k
                  WHERE k.conrelid = v_tbl AND k.contype = 'f'
                    AND k.confrelid = to_regclass('auth.users')
                    AND k.confdeltype = 'c'
                    AND (SELECT a.attname FROM pg_attribute a
                          WHERE a.attrelid = v_tbl AND a.attnum = k.conkey[1]) = 'allocator_id')
    INTO v_fk_alloc_ok;
  v_cascade_ok := v_fk_strat_ok AND v_fk_key_ok AND v_fk_port_ok AND v_fk_alloc_ok;
  IF NOT v_cascade_ok THEN
    RAISE EXCEPTION 'jobledger: strategy_id, api_key_id, portfolio_id and allocator_id must cascade on delete to strategies, api_keys, portfolios and auth.users, otherwise error text naming a broker account outlives its owner';
  END IF;

  v_priv_anon := has_table_privilege('anon', v_tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  v_priv_auth := has_table_privilege('authenticated', v_tbl, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  v_acl_ok := NOT v_priv_anon AND NOT v_priv_auth;
  IF NOT v_acl_ok THEN
    RAISE EXCEPTION 'jobledger: anon and authenticated must hold no privilege on compute_job_attempt_failures, otherwise broker-naming error text is readable or writable by them';
  END IF;

  v_priv_svc_sel   := has_table_privilege('service_role', v_tbl, 'SELECT');
  v_priv_svc_write := has_table_privilege('service_role', v_tbl, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
  v_svc_ok := v_priv_svc_sel AND NOT v_priv_svc_write;
  IF NOT v_svc_ok THEN
    RAISE EXCEPTION 'jobledger: service_role must hold SELECT and no write privilege on compute_job_attempt_failures, otherwise Phase 230 cannot read it or a direct writer bypasses the SECURITY DEFINER functions';
  END IF;

  -- mark_compute_job_failed: the ledger INSERT sits AFTER the status UPDATE, and the
  -- fences this migration promised not to touch are still in the body. Comment-stripped
  -- before any position test (a fence comment must not satisfy an anchor).
  IF v_mark_oid IS NULL THEN
    RAISE EXCEPTION 'jobledger: mark_compute_job_failed(uuid, text, text, uuid) does not exist, so no failure is marked at all';
  END IF;
  v_mark_body := regexp_replace(pg_get_functiondef(v_mark_oid), '--[^\n]*', '', 'g');
  v_pos_upd := strpos(v_mark_body, 'last_error = p_error');
  v_pos_ins := strpos(v_mark_body, 'INSERT INTO public.compute_job_attempt_failures');
  v_ins_after_ok := v_pos_upd > 0 AND v_pos_ins > v_pos_upd;
  IF NOT v_ins_after_ok THEN
    RAISE EXCEPTION 'jobledger: mark_compute_job_failed must write the compute_job_attempt_failures record after the UPDATE that sets last_error, in the same transaction, otherwise a failed attempt keeps no cause';
  END IF;
  v_fences_ok := v_mark_body LIKE '%ERRCODE = ''55006''%'
             AND v_mark_body LIKE '%ERRCODE = ''55P03''%'
             AND v_mark_body LIKE '%mark_compute_job_bridge%';
  IF NOT v_fences_ok THEN
    RAISE EXCEPTION 'jobledger: mark_compute_job_failed lost its 55006 preemption fence, its 55P03 closure bound or the mark_compute_job_bridge advisory lock, which this migration promised not to touch';
  END IF;

  -- record_compute_job_attempt_error: pinned search_path, ACL.
  IF v_rec_oid IS NULL THEN
    RAISE EXCEPTION 'jobledger: record_compute_job_attempt_error(uuid, uuid, text, text) does not exist, so a worker-lost real error cannot be recorded';
  END IF;
  SELECT p.proconfig INTO v_rec_cfg FROM pg_proc p WHERE p.oid = v_rec_oid;
  v_rec_pin_ok := COALESCE(v_rec_cfg, ARRAY[]::text[]) @> ARRAY['search_path=public, pg_catalog'];
  IF NOT v_rec_pin_ok THEN
    RAISE EXCEPTION 'jobledger: record_compute_job_attempt_error must pin search_path=public, pg_catalog, otherwise a SECURITY DEFINER function resolves names through the caller''s path';
  END IF;
  v_rec_acl_ok := NOT has_function_privilege('public', v_rec_oid, 'EXECUTE')
              AND NOT has_function_privilege('anon', v_rec_oid, 'EXECUTE')
              AND NOT has_function_privilege('authenticated', v_rec_oid, 'EXECUTE')
              AND has_function_privilege('service_role', v_rec_oid, 'EXECUTE');
  IF NOT v_rec_acl_ok THEN
    RAISE EXCEPTION 'jobledger: record_compute_job_attempt_error must be executable by service_role only, otherwise any role can forge a failure record';
  END IF;

  -- CARRIED FORWARD from 20260927120000 self-verify item (6): the claim still clears the
  -- previous attempt's error on re-claim. This ledger is correct only because that clear is
  -- the one place a cause is erased, and the cause was written first.
  IF v_p5_oid IS NULL THEN
    RAISE EXCEPTION 'jobledger: claim_compute_jobs_with_priority(integer, text, boolean, text[], text[]) does not exist, so the M-1137 clear this ledger depends on cannot be checked';
  END IF;
  v_p5_body := pg_get_functiondef(v_p5_oid);
  v_clear_ok := v_p5_body ~* 'last_error\s*=\s*NULL' AND v_p5_body ~* 'error_kind\s*=\s*NULL';
  IF NOT v_clear_ok THEN
    RAISE EXCEPTION 'jobledger: the 5-arg claim_compute_jobs_with_priority no longer clears last_error/error_kind on re-claim (M-1137/M-1138), which the attempt ledger is written ahead of';
  END IF;

  RAISE NOTICE 'jobledger: compute_job_attempt_failures verified (RLS on, no policy, four causes, unique attempt identity, no FK to compute_jobs, four owner cascades, service_role SELECT only); mark_compute_job_failed writes the record after its status UPDATE; record_compute_job_attempt_error pinned and service_role only; the M-1137 clear is intact.';
END
$verify$;
