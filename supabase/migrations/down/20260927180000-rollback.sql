-- ============================================================================
-- ROLLBACK for 20260927180000_working_holder_rule_d18.sql
-- Phase 167.1.2 ACCOUNTTRUTH, plan 16 (PR C1), D-18.
-- ============================================================================
-- Manual, off the auto-apply path (supabase/migrations/down/ is never pushed).
-- What it restores, VERBATIM from 20260925120000_api_keys_account_identity.sql:
--   * set_departed_key_history_inclusion(uuid, text)'s body, so KEY_NOT_DEPARTED
--     again refuses every key that is neither disconnected nor revoked;
--   * the REVOKE/GRANT pair (EXECUTE for authenticated only);
--   * COMMENT ON COLUMN api_keys.account_share_kind, COMMENT ON COLUMN
--     api_keys.history_inclusion and COMMENT ON FUNCTION
--     set_departed_key_history_inclusion.
-- Roll the TypeScript reader (src/lib/account-share-note.ts, isWorkingHolder)
-- back in the same change: the COMMENT restored here says the reader's
-- working-holder rule and the KEY_NOT_DEPARTED test move together.
--
-- DATA: nothing is dropped and no row is written. Choices owners stored on a
-- connected key that is inactive, sign_in_failed or error stay stored; after
-- this runs, a further call for such a key is simply refused KEY_NOT_DEPARTED.
--
-- THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20260927180000 as applied while the function no longer
-- carries it. `supabase db push` will therefore NOT re-apply the migration.
-- To re-apply it, delete that ledger row in the same change that re-applies
-- it (or mark it reverted with `supabase migration repair --status reverted
-- 20260927180000` against the intended database, after the marker query in
-- CLAUDE.md names that database).
--
-- The DO block at the top is a catalogue-only PRECONDITION: it RAISEs, before
-- anything is replaced, unless the function exists. The DO block at the end is
-- catalogue-only: it RAISEs, and so aborts the whole rollback, if the restored
-- body still carries the D-18 failing status sign_in_failed, or if EXECUTE is
-- not authenticated-only.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.set_departed_key_history_inclusion(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20260927180000 refused: public.set_departed_key_history_inclusion(uuid, text) does not exist, so this is not a database 20260927180000 was applied to';
  END IF;
END
$precondition$;

-- ───────────── the function, verbatim from 20260925120000
CREATE OR REPLACE FUNCTION public.set_departed_key_history_inclusion(
  p_api_key_id uuid,
  p_inclusion  text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_owner        uuid;
  v_disconnected timestamptz;
  v_sync_status  text;
  v_previous     text;
  v_job          uuid;
  v_job_status   text;
  v_claimed_at   timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  -- Scoped to the caller, so another user's row is never even locked.
  SELECT user_id, disconnected_at, sync_status, history_inclusion
    INTO v_owner, v_disconnected, v_sync_status, v_previous
    FROM public.api_keys
   WHERE id = p_api_key_id
     AND user_id = v_uid
     FOR UPDATE;

  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'set_departed_key_history_inclusion: caller does not own api_key %', p_api_key_id
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- NULL resets to the default rule; anything else outside the two choices is
  -- refused rather than stored.
  IF p_inclusion IS NOT NULL AND p_inclusion NOT IN ('include', 'exclude') THEN
    RAISE EXCEPTION 'HISTORY_INCLUSION_INVALID'
      USING ERRCODE = '22023',
            DETAIL  = 'p_inclusion must be ''include'', ''exclude'' or NULL (the default rule).';
  END IF;

  -- Only a departed key has an end day, so only a departed key has a choice.
  IF v_disconnected IS NULL AND v_sync_status IS DISTINCT FROM 'revoked' THEN
    RAISE EXCEPTION 'KEY_NOT_DEPARTED'
      USING ERRCODE = '55000',
            DETAIL  = 'Only a disconnected or revoked key''s history can be included or excluded; a live key always counts.';
  END IF;

  -- A recompose that is already RUNNING has read (or may have read) the old
  -- value, and enqueue_compute_job would fold this request into it: its
  -- in-flight dedup AND the partial unique index
  -- compute_jobs_one_inflight_per_kind_allocator both cover pending, running
  -- and done_pending_children, so no second job for (allocator, kind) can be
  -- queued behind a running one. MEASURED 2026-09-26 over the 9-arg
  -- enqueue_compute_job (20260515210300) and the 10-arg
  -- _enqueue_compute_job_internal (20260924230827): p_idempotency_key is not
  -- part of the dedup, p_run_at only sets next_attempt_at, and a fan-in child
  -- (p_parent_job_ids) starts done_pending_children, which the same index
  -- covers. Refusing by name, with nothing written, is therefore the option
  -- that stays inside that contract for every other caller; the owner retries
  -- once the running compose ends.
  --
  -- Step 1. Lock EVERY claimable or in-flight row for the caller's recompose.
  -- Both claim functions take candidates with status IN ('pending',
  -- 'failed_retry') through FOR UPDATE SKIP LOCKED, so a row locked here cannot
  -- be claimed (and so cannot read the old value) before this transaction
  -- commits. PERFORM, not SELECT INTO: a failed_retry row lies outside the
  -- partial unique index and can coexist with a pending one, and a SELECT INTO
  -- stops at the first row, locking only that one.
  PERFORM 1
     FROM public.compute_jobs
    WHERE allocator_id = v_uid
      AND kind = 'derive_allocator_equity'
      AND status IN ('pending', 'failed_retry', 'running', 'done_pending_children')
      FOR UPDATE;

  -- Step 2. A running recompose is refused before anything is written. The
  -- DETAIL carries how long it has run, so a busy recompose can be told from a
  -- stuck one. The reclaim wording tracks analytics-service/main_worker.py:
  -- watchdog_tick passes p_stale_threshold '10 minutes' to
  -- reset_stalled_compute_jobs, which measures claimed_at, and
  -- WATCHDOG_PER_KIND_OVERRIDES has no derive_allocator_equity entry. The
  -- watchdog runs inside the worker process, so the reclaim happens only while
  -- a worker is up. Change the HINT if either constant moves.
  SELECT status, claimed_at INTO v_job_status, v_claimed_at
    FROM public.compute_jobs
   WHERE allocator_id = v_uid
     AND kind = 'derive_allocator_equity'
     AND status = 'running'
   LIMIT 1;

  IF v_job_status = 'running' THEN
    RAISE EXCEPTION 'HISTORY_RECOMPOSE_IN_PROGRESS'
      USING ERRCODE = '55006',
            DETAIL  = format('A recompose of your equity history has been running for %s. Try again when it finishes; nothing was changed.',
                             CASE WHEN v_claimed_at IS NULL THEN 'an unknown time'
                                  ELSE floor(extract(epoch FROM now() - v_claimed_at) / 60)::int || ' minute(s)' END),
            HINT    = 'If it does not finish, a running worker reclaims a recompose that has run for more than 10 minutes and queues it again. Retry after that.';
  END IF;

  UPDATE public.api_keys
     SET history_inclusion = p_inclusion
   WHERE id = p_api_key_id
     AND user_id = v_uid;

  -- Recompose the caller's curve, never by queuing a pending TWIN of a
  -- failed_retry recompose. enqueue_compute_job's in-flight dedup and the
  -- partial unique index compute_jobs_one_inflight_per_kind_allocator both
  -- ignore failed_retry, so an enqueue beside a failed_retry row inserts a
  -- second, pending row for the same allocator. MEASURED on the pg-lane
  -- 2026-09-26: a due failed_retry derive_allocator_equity row beside a pending
  -- one makes claim_compute_jobs and both claim_compute_jobs_with_priority
  -- overloads raise 23505 on that index (the worker-spin class of 2026-04-28).
  -- So when a failed_retry row is the caller's ONLY recompose row, it is
  -- REUSED: it goes back to status 'pending' with next_attempt_at = now() and
  -- claimed_at, claimed_by and claim_token all NULL, the claim state
  -- reset_stalled_compute_jobs writes for a reclaimed job (its claim_token =
  -- NULL is the mig-117 fence invalidation). A
  -- pending row sits inside that unique index and inside the enqueue's dedup,
  -- so a later enqueue for the caller (a derive_broker_dailies epilogue among
  -- them) folds onto it instead of inserting a twin, which merely moving
  -- next_attempt_at forward would not prevent: the failed_retry row would rank
  -- first in its claim partition beside the epilogue's pending row, the same
  -- 23505. attempts is left alone, so the toggle grants no retry budget: a row
  -- one attempt short of max_attempts ends failed_final if it fails again, and
  -- the next toggle then enqueues a fresh job. last_error and error_kind are
  -- left alone, unlike the watchdog, which writes last_error =
  -- 'worker_stalled': the failed attempt's own error stays visible until the
  -- next claim, and both claim functions (claim_compute_jobs and
  -- claim_compute_jobs_with_priority) set last_error and error_kind to NULL
  -- when they take the row. The job reads history_inclusion when it runs, so
  -- it picks up the new value.
  -- The NOT EXISTS narrowing is still needed. The flip is a write into that
  -- unique index, so beside a visible pending or done_pending_children row it
  -- would raise 23505 every time and refuse a toggle that can succeed: without
  -- the flip, the enqueue's dedup hands that in-flight row back and the toggle
  -- takes effect on it. The failed_retry row is then left where it is (a
  -- pairing this RPC did not create). The narrowing covers 'running' too. Step
  -- 2 refused every running row visible to it, so a running row seen here was
  -- claimed after step 2. Flipping beside it would collide on the same index,
  -- and the 23505 handler would answer "retry now" for a job that is RUNNING.
  -- Skipping the flip instead lets the enqueue's dedup hand that running row
  -- back, and step 3 refuses it with the running DETAIL (wait for it to end).
  -- The flip's WHERE repeats status = 'failed_retry'. A failed_retry row that
  -- appeared after step 1 is not locked by it, and if a claimer takes that row
  -- first, the repeated predicate fails on the re-read, nothing is written, and
  -- the enqueue below hands back the running row for step 3 to refuse; a flip
  -- keyed on the id alone would put a running job back to pending.
  -- The 23505 handler covers the one sibling the NOT EXISTS cannot see: an
  -- in-flight row another transaction inserts after that lookup, which the
  -- flip's unique check waits on and then collides with once it commits. That
  -- row may be pending or already claimed, so its refusal has its own name,
  -- HISTORY_RECOMPOSE_REQUEUED (retry now: the retry either folds into it or
  -- meets the running refusal), distinct from HISTORY_RECOMPOSE_IN_PROGRESS
  -- (a job is running: wait for it to end).
  --
  -- Step 3. Lock and re-check the job the reuse or the enqueue returned.
  -- Step 1 cannot see a job that another transaction enqueued, and a worker
  -- claimed, after step 1 ran; the enqueue's dedup (a plain read, no lock)
  -- would then hand back that RUNNING job, which read the old value. The row
  -- is locked here, so if a claimer holds it this waits, re-reads it as READ
  -- COMMITTED does, and judges what it finds. Only 'pending' or
  -- 'done_pending_children' passes (a reused row is 'pending' by now): such a
  -- job has not run, and every claimer skips it until the new value commits.
  -- 'running' is refused, and the refusal rolls the UPDATE above back. A job
  -- that FINISHED between the dedup and this lock (done, failed_retry,
  -- failed_final, or a row that is gone) read the old value too, and
  -- refusing it would be wrong because nothing is in flight any more: the
  -- right outcome is one fresh job that reads the new value, so the reuse or
  -- the enqueue runs once more. The second pass sees an in-flight set without
  -- that row (a failed_retry result is reused rather than given a twin, and
  -- this transaction holds its lock). If that pass also hands back a finished
  -- job, two recomposes started and ended inside this one call; that is too
  -- close to call, so it is refused by name, 55006
  -- HISTORY_RECOMPOSE_RACED, rather than retried without bound.
  -- A NULL job id is refused outright (HISTORY_RECOMPOSE_NOT_QUEUED): no path
  -- in enqueue_compute_job returns one today, and a toggle that queues nothing
  -- must not report success.
  -- REASONED, NOT MEASURED: steps 1 and 3, the second pass and the
  -- serialization_failure wrapper around the enqueue close races between TWO
  -- backends, and the SQL gate corpus runs one session, so none of those
  -- windows has been exercised. Step 3's running refusal is gated (arm
  -- HIST-running) only in the single-session shape where the job is already
  -- running. The 23505 handler is gated (arm HIST-requeued) in a
  -- single-session stand-in: a test-local trigger inserts the pending twin
  -- under the flip, so the collision and the REQUEUED answer are measured.
  -- What stays reasoned there is a real second backend, whose row the flip's
  -- unique check waits on before it collides.
  FOR v_attempt IN 1..2 LOOP
    SELECT cj.id INTO v_job
      FROM public.compute_jobs cj
     WHERE cj.allocator_id = v_uid
       AND cj.kind = 'derive_allocator_equity'
       AND cj.status = 'failed_retry'
       AND NOT EXISTS (
             SELECT 1
               FROM public.compute_jobs o
              WHERE o.allocator_id = v_uid
                AND o.kind = 'derive_allocator_equity'
                AND o.status IN ('pending', 'running', 'done_pending_children'))
     ORDER BY cj.next_attempt_at, cj.id
     LIMIT 1;

    IF v_job IS NOT NULL THEN
      BEGIN
        UPDATE public.compute_jobs
           SET status = 'pending',
               next_attempt_at = now(),
               claimed_at = NULL,
               claimed_by = NULL,
               claim_token = NULL
         WHERE id = v_job
           AND status = 'failed_retry'
        RETURNING id INTO v_job;
      EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'HISTORY_RECOMPOSE_REQUEUED'
          USING ERRCODE = '55006',
                DETAIL  = 'Another recompose of your equity history was queued or started while this change was being saved. Try again; nothing was changed.',
                HINT    = 'Retry now. A retry folds your change into the queued recompose, or reports the one that has started.';
      END;
    END IF;

    IF v_job IS NULL THEN
      -- Allocator-scoped, so enqueue_compute_job's own gate requires
      -- p_allocator_id = auth.uid(), and its in-flight dedup hands back the
      -- pending job locked above, so a burst of toggles is one job.
      -- _enqueue_compute_job_internal raises serialization_failure (40001)
      -- when it loses the insert race to another transaction and the winning
      -- job has already left the in-flight statuses. That is the same finished-
      -- in-between shape as the second pass below, so it gets the same name,
      -- 55006 HISTORY_RECOMPOSE_RACED (retry now), instead of reaching the
      -- client as a raw 40001 its SQLSTATE map does not list. REASONED, NOT
      -- MEASURED: the lost race needs a second backend.
      BEGIN
        v_job := enqueue_compute_job(
          p_strategy_id  := NULL,
          p_kind         := 'derive_allocator_equity',
          p_allocator_id := v_uid
        );
      EXCEPTION WHEN serialization_failure THEN
        RAISE EXCEPTION 'HISTORY_RECOMPOSE_RACED'
          USING ERRCODE = '55006',
                DETAIL  = 'Another recompose of your equity history was queued and finished while this change was being saved. Try again; nothing was changed.',
                HINT    = 'Retry now. The next attempt either queues a recompose that reads your change or reports the one that is running.';
      END;
    END IF;

    IF v_job IS NULL THEN
      RAISE EXCEPTION 'HISTORY_RECOMPOSE_NOT_QUEUED'
        USING ERRCODE = 'XX000',
              DETAIL  = 'enqueue_compute_job returned no job id for the caller''s recompose; nothing was changed.';
    END IF;

    SELECT status, claimed_at INTO v_job_status, v_claimed_at
      FROM public.compute_jobs
     WHERE id = v_job
       FOR UPDATE;

    IF v_job_status = 'running' THEN
      RAISE EXCEPTION 'HISTORY_RECOMPOSE_IN_PROGRESS'
        USING ERRCODE = '55006',
              DETAIL  = format('A recompose of your equity history has been running for %s. Try again when it finishes; nothing was changed.',
                               CASE WHEN v_claimed_at IS NULL THEN 'an unknown time'
                                    ELSE floor(extract(epoch FROM now() - v_claimed_at) / 60)::int || ' minute(s)' END),
              HINT    = 'If it does not finish, a running worker reclaims a recompose that has run for more than 10 minutes and queues it again. Retry after that.';
    END IF;

    EXIT WHEN v_job_status IN ('pending', 'done_pending_children');

    IF v_attempt = 2 THEN
      RAISE EXCEPTION 'HISTORY_RECOMPOSE_RACED'
        USING ERRCODE = '55006',
              DETAIL  = format('A recompose of your equity history finished (%s) while this change was being saved, and so did the one queued after it. Try again; nothing was changed.',
                               COALESCE(v_job_status, 'removed')),
              HINT    = 'Retry now. The next attempt either queues a recompose that reads your change or reports the one that is running.';
    END IF;
  END LOOP;

  RAISE NOTICE 'set_departed_key_history_inclusion: recompose job % queued for the caller', v_job;

  RETURN v_previous IS DISTINCT FROM p_inclusion;
END;
$$;

REVOKE ALL ON FUNCTION public.set_departed_key_history_inclusion(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_departed_key_history_inclusion(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.set_departed_key_history_inclusion(uuid, text) IS
  'Phase 167.1.2 D-05. The founder: "do not delete the data when a key is '
  'disconnected. Leave it in an overview of disconnected accounts that can be '
  'toggled on or off, to be included or excluded. They would be included only '
  'till the day that the key was deleted." Writes api_keys.history_inclusion '
  'for the CALLER''s departed key (disconnected or revoked) and enqueues '
  'derive_allocator_equity for the caller (the job id is RAISEd as a NOTICE). '
  'It never queues a pending twin of a failed_retry recompose: when a '
  'failed_retry row is the caller''s only recompose row it is reused, put '
  'back to status pending with next_attempt_at = now() and claimed_at, '
  'claimed_by and claim_token NULL (the claim state the stall watchdog '
  'reset_stalled_compute_jobs writes; attempts untouched; last_error and '
  'error_kind left as the failed attempt wrote them, where the watchdog '
  'writes worker_stalled, and cleared by the next claim), so a later '
  'enqueue folds onto it, '
  'and its id is the one RAISEd; a pending or done_pending_children row is '
  'reused through the enqueue''s own dedup. '
  'Clients map by SQLSTATE: 42501 when unauthenticated or not the owner; '
  '22023 HISTORY_INCLUSION_INVALID on a value other than include / exclude / '
  'NULL (NULL resets to the default rule); 55000 KEY_NOT_DEPARTED on a live, '
  'non-revoked key; 55006 HISTORY_RECOMPOSE_IN_PROGRESS when a recompose for '
  'the caller is already RUNNING, because it may have read the old value and '
  'no second job can queue behind it (retry once it ends; nothing is written; '
  'DETAIL says how long it has been running, HINT says a running worker '
  'reclaims one that has run for more than 10 minutes). 55006 '
  'HISTORY_RECOMPOSE_REQUEUED answers a recompose another request queued or '
  'started while the reused row was being put back to pending (retry now: '
  'the retry folds into it or reports it running). Within 55006 clients '
  'branch on MESSAGE_TEXT: IN_PROGRESS = wait for the running recompose to '
  'end; REQUEUED and RACED = retry now. The job is judged twice: before the '
  'write, and again on the job the reuse or the enqueue returns, which is '
  'locked FOR UPDATE and passes only while pending or done_pending_children. '
  'A job enqueued and claimed by another transaction in between is refused '
  'as running; a job that also FINISHED in between read the old value, so '
  'the reuse or the enqueue runs once more and the fresh job reads the new '
  'one; if that one has finished too, 55006 HISTORY_RECOMPOSE_RACED (retry '
  'now). The same 55006 HISTORY_RECOMPOSE_RACED, with a different DETAIL, '
  'replaces the serialization_failure (40001) enqueue_compute_job raises when '
  'it loses the insert race to a job that has already finished, so no raw '
  '40001 reaches the client. '
  'A NULL job id raises XX000 HISTORY_RECOMPOSE_NOT_QUEUED, never success. '
  'Every pending, failed_retry, '
  'running or done_pending_children recompose row of the caller is locked '
  'until commit, so no worker can claim one before the new value is visible. '
  'Those two-backend orderings are reasoned from the claim functions (FOR '
  'UPDATE SKIP LOCKED), not measured. Returns true iff the stored value '
  'changed; the recompose is requested either way. EXECUTE: authenticated '
  'only.';

-- ───────────── the column COMMENTs, verbatim from 20260925120000
COMMENT ON COLUMN public.api_keys.account_share_kind IS
  'Phase 167.1.2 D-11. Why account_shared_with_api_key_id is set, or NULL. '
  'Written only by the service-role identity stamper. '
  '''duplicate'' = a second live key on an exchange account another live key '
  'of the same owner already holds; the allocator book counts that account '
  'once, through the holder. '
  '''composite_member'' = the D-04 exemption: both keys are members of one '
  'composite strategy with disjoint declared windows (a key rotation inside a '
  'composite), so the pair is legitimate and is not a duplicate. '
  'READER CONTRACT: a marked key is counted THROUGH its holder only while that '
  'holder is working, i.e. its disconnected_at IS NULL AND its sync_status <> '
  '''revoked''. Once the holder is disconnected or revoked, the marked key '
  'counts on its own, as if unmarked. The marker is not cleared when the '
  'holder departs (the same-owner trigger fires only when the holder column '
  'is written, and admits a revoked holder), so a reader that resolved '
  'through a departed holder would count the account up to that holder''s '
  'end day only, or not at all if the owner excluded its history, while a '
  'live key still reads the account. '
  'That definition of a working holder (not disconnected, not revoked) is '
  'PROVISIONAL: a holder stuck in sync_status sign_in_failed or error still '
  'counts as working, so its dependents stay marked and are not counted on '
  'their own. It is the same definition as the KEY_NOT_DEPARTED test in '
  'set_departed_key_history_inclusion, and Phase 167.1.2 PR C plan 04 '
  'decides it with the founder; the two move together. '
  'Nothing is ever auto-disconnected or deleted because of this value.';

COMMENT ON COLUMN public.api_keys.history_inclusion IS
  'Phase 167.1.2 D-05 / D-09. Whether a DEPARTED key''s history counts in the '
  'allocator''s rebuilt equity series. Departed means soft-disconnected '
  '(disconnected_at set) or credential-revoked (sync_status = ''revoked''). '
  'The history runs up to the key''s END DAY, never past it: the UTC day of '
  'disconnected_at, or for a revoked key its last returns day. '
  'NULL = the default rule: included up to the end day, UNLESS the key''s '
  'account identity is unknown (venue_account_id NULL), in which case it is '
  'excluded by default, because an unknown account could be one a counted key '
  'already reads and would be summed twice (founder-confirmed 2026-09-25). '
  '''include'' / ''exclude'' = the owner''s explicit choice; ''include'' '
  'overrides only the unknown-identity default and never re-opens days on '
  'which another counted key holds the same known account. Written only by '
  'set_departed_key_history_inclusion, and RESET to NULL by '
  'reconnect_allocator_api_key: a choice made for one departure never carries '
  'over to a later one. That contract binds EVERY path that returns a departed '
  'key to live, not only the reconnect RPC. A REVOKED key (disconnected_at '
  'NULL) comes back through the rotate-secret route''s service-role update '
  '(sync_status back to idle), which must reset this column to NULL in the '
  'same write. Adding that reset to the route is owned by Phase 167.1.2 PR C; '
  'until it lands, a choice made while a key was revoked carries over to its '
  'next revocation.';

-- ───────────── post-check — CATALOGUE ONLY, reads no row
DO $postcheck$
DECLARE
  v_fn regprocedure := to_regprocedure('public.set_departed_key_history_inclusion(uuid, text)');
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Rollback 20260927180000 failed: set_departed_key_history_inclusion is missing after the restore';
  END IF;
  IF position('sign_in_failed' IN (SELECT prosrc FROM pg_proc WHERE oid = v_fn)) > 0 THEN
    RAISE EXCEPTION 'Rollback 20260927180000 failed: the restored body still carries the D-18 failing status sign_in_failed';
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20260927180000 failed: EXECUTE on set_departed_key_history_inclusion is not authenticated-only';
  END IF;
  RAISE NOTICE 'Rollback 20260927180000: set_departed_key_history_inclusion, its grants and the three COMMENTs restored from 20260925120000.';
END
$postcheck$;

COMMIT;
