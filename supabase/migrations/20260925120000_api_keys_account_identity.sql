-- ============================================================================
-- api_keys account identity: the duplicate marker, the departed-history flag,
-- the reconnect named refusal, and COMMENTs that tell the truth about ccxt
-- (2026-09-25, Phase 167.1.2 ACCOUNTTRUTH, plan 03, PR B)
-- ============================================================================
--
-- ⛔⛔ DEPLOY ORDER — READ BEFORE MERGING. THIS MIGRATION SHIPS ALONE, AS PR B,
-- AND MUST BE APPLIED ON PROD BEFORE ANY TYPESCRIPT READS ITS COLUMNS.
--
-- Merging supabase/migrations/** to `main` applies to shared TEST (`apply-test`)
-- and then to PROD (`apply`) with NO human stop in between, while the Vercel
-- promotion starts on the same push and finishes in minutes. A key-list SELECT
-- that names a column PROD does not have yet answers PostgREST 42703/42501 and
-- takes the Exchanges page down for every allocator (RESEARCH Pitfall 1 of the
-- phase; the same hazard the DEPLOY ORDER header of 20260920120000 documents).
-- So this PR carries the DDL and NOTHING that reads it: no constants.ts, no
-- types.ts projection, no component, no route, no worker. Every reader ships in
-- PR C, which starts only after this migration's PROD `apply` job concluded
-- success on this PR's merge commit (plan 03 Task 4, D-12, prints
-- D12_ORDER_OK). src/lib/database.types.ts is regenerated here, but a generated
-- type reads nothing at runtime.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION, and no DO block here reads a
-- row. Shared TEST holds PROD's catalogue and none of its data, and a failed
-- TEST apply blocks the PROD apply, so a data-reading DO block that RAISEs on
-- an unexpected count would block a production deploy on an empty database.
-- Every check below is DDL or catalogue-only. The read-only PROD census of
-- existing duplicates is plan 08's script, never this file.
--
-- ⛔ The composite key-add wizard RPC is not touched here (D-04): not dropped,
-- not replaced, not altered. Its REVOKE/GRANT re-issue hazard (20260814120000)
-- therefore does not arise.
--
-- What this migration does, in order
-- ----------------------------------
--   1. api_keys.account_shared_with_api_key_id + account_share_kind (D-11): the
--      MARKER a service-role identity stamper (plan 04) writes when a second
--      live key reads an exchange account another live key of the same owner
--      already holds. Both-or-neither, never self-referencing, and when it is
--      written the holder must exist, belong to the same owner, be live and not
--      itself be marked (no chains, no cycles). Nothing is ever auto-disconnected or deleted
--      (D-01): the marker is shown on the key card beside the owner's own
--      Disconnect and Delete controls.
--   2. api_keys.history_inclusion (D-05, D-09): the owner's include/exclude
--      choice for a departed (disconnected or revoked) key's history.
--   3. set_departed_key_history_inclusion(uuid, text): the owner RPC that
--      writes (2) and asks for the allocator curve to be recomposed, reusing
--      the caller's recompose row where one exists (a failed_retry row goes
--      back to pending, never given a pending twin; see the RPC body).
--   4. reconnect_allocator_api_key: refuses by name when a live sibling already
--      holds the same (user, exchange, venue_account_id) (Pitfall 5). Once ccxt
--      keys carry an account id (plan 02, PR C) a reconnect into an occupied
--      slot stops being MT5-only, so the refusal ships BEFORE the stamping.
--   5. COMMENT ON COLUMN api_keys.venue_account_id and COMMENT ON INDEX
--      api_keys_user_exchange_venue_account_uniq re-stated: they said every ccxt
--      venue is NULL, which this phase makes false for OKX, Bybit, Binance and
--      Deribit. sFOX stays NULL, and that is UNKNOWABLE, not pending (D-10).
--   6. Catalogue-only post-verify.
--
-- Why the FK is ON DELETE SET NULL and the trigger clears the kind
-- ----------------------------------------------------------------
-- delete_allocator_api_key HARD-deletes a key row (20260602183000). If another
-- key names the deleted row as its holder, the FK's SET NULL action issues an
-- UPDATE that nulls ONLY the holder column, and api_keys_account_share_both_or_
-- neither would then abort the DELETE: a key the owner cannot delete. The
-- action's UPDATE names the holder column, so the BEFORE UPDATE OF trigger
-- below fires on it, and its NULL-holder branch clears the kind in the same
-- row write. A BEFORE DELETE trigger that updated sibling rows was rejected:
-- the account sanitiser deletes all of a user's keys in ONE statement, and a
-- sibling UPDATE from inside that statement makes PostgreSQL refuse the delete
-- ("tuple to be deleted was already modified by an operation triggered by the
-- current command").
--
-- VAC-04 (PROD body drift) — ONE function body is replaced
-- --------------------------------------------------------
-- reconnect_allocator_api_key is re-based on its LATEST definition. MEASURED
-- 2026-09-25 with grep over supabase/migrations/*.sql: exactly one migration
-- defines it, 20260422101911_api_keys_disconnected_at.sql, and its body is
-- byte-identical to supabase/schema/baseline.sql's and to the committed
-- snapshot supabase/schema/functions/reconnect_allocator_api_key.sql. The
-- edits are: the ownership SELECT also reads exchange and venue_account_id,
-- one refusal block sits between the idempotency check and the UPDATE, and the
-- UPDATE also resets history_inclusion to NULL (a choice made for a PAST
-- departure must not silently apply to a later one). Every other line is the
-- snapshot's.
--
-- The hash below is the `live` column (fifth TSV field) of
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/reconnect_allocator_api_key.sql \
--     <origin/main's copy of that file>
-- i.e. the normalized body origin/main carries today, standing in for PROD.
-- It is EARNED only if VAC-04 on the PR reports the SAME hash for PROD. If it
-- differs, PROD drifted out of band: fold the difference in and re-derive,
-- never edit the pragma to match a gate log.
--   reconnect_allocator_api_key/1
-- prod-body-ack: 3fbe5e570b1b239ac3d90ce5ab8cb0e0474a14c2d2bc3dbff666083464198382
--
-- ROLLBACK: supabase/migrations/down/20260925120000-rollback.sql. Roll the
-- PR C readers back FIRST; dropping these columns under a deployed reader is
-- the same outage as the deploy-order hazard above, in reverse.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ───────────────────────────── 1. the duplicate marker (D-11)
ALTER TABLE public.api_keys
  ADD COLUMN account_shared_with_api_key_id uuid NULL,
  ADD COLUMN account_share_kind text NULL;

ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_account_shared_with_api_key_id_fkey
    FOREIGN KEY (account_shared_with_api_key_id)
    REFERENCES public.api_keys (id)
    ON DELETE SET NULL;

ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_account_share_kind_valid
    CHECK (account_share_kind IS NULL
           OR account_share_kind IN ('duplicate', 'composite_member'));

ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_account_share_both_or_neither
    CHECK ((account_shared_with_api_key_id IS NULL) = (account_share_kind IS NULL));

ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_account_share_not_self
    CHECK (account_shared_with_api_key_id IS NULL
           OR account_shared_with_api_key_id <> id);

-- The FK's SET NULL action looks the referencing rows up on every api_keys
-- DELETE. Partial, because almost every row carries NULL here.
CREATE INDEX api_keys_account_shared_with_idx
  ON public.api_keys (account_shared_with_api_key_id)
  WHERE account_shared_with_api_key_id IS NOT NULL;

COMMENT ON COLUMN public.api_keys.account_shared_with_api_key_id IS
  'Phase 167.1.2 D-11. The LIVE key of the same owner that already holds the '
  'exchange account this key reads, or NULL. Written only by the service-role '
  'identity stamper; no client INSERT or UPDATE path exists. Always set '
  'together with account_share_kind (api_keys_account_share_both_or_neither), '
  'never this row itself (api_keys_account_share_not_self), and, when written, '
  'the holder must exist, belong to the same user_id, be live (disconnected_at '
  'NULL) and be unmarked itself, and this row must not be anyone''s holder '
  '(trigger api_keys_account_share_same_owner). A holder that is disconnected '
  'LATER keeps this value until the stamper re-evaluates it. '
  'ON DELETE SET NULL: hard-deleting the holder clears this column AND '
  'account_share_kind together, so the delete never aborts. Nothing is ever '
  'auto-disconnected or deleted because of this marker (D-01): the owner '
  'decides, from the key card.';

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

-- ─────────── 1b. the same-owner trigger, with the NULL-holder short-circuit
CREATE FUNCTION public.enforce_api_keys_account_share_same_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $$
DECLARE
  v_holder_owner  uuid;
  v_holder_disc   timestamptz;
  v_holder_holder uuid;
BEGIN
  -- (1) NULL holder: no lookup, never a refusal. Every ordinary key INSERT, the
  -- stamper's marker-clearing UPDATE and the FK's ON DELETE SET NULL action
  -- take this branch.
  IF NEW.account_shared_with_api_key_id IS NULL THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.account_shared_with_api_key_id IS NOT NULL
         AND NEW.account_share_kind IS NOT DISTINCT FROM OLD.account_share_kind THEN
        -- The holder is being cleared and the writer left the kind alone (the
        -- FK action after the holder was hard-deleted names ONLY the holder
        -- column). Clear the kind in the same row write, or
        -- api_keys_account_share_both_or_neither aborts the statement, and
        -- with it the owner's delete of the holder key. A writer that sets the
        -- holder to NULL AND writes a DIFFERENT non-NULL kind is contradicting
        -- itself; its kind is kept, so the CHECK refuses it by name.
        NEW.account_share_kind := NULL;
      END IF;
    END IF;
    -- On INSERT the kind is left as supplied, so a kind without a holder is
    -- still refused by the CHECK.
    RETURN NEW;
  END IF;

  -- (2) a holder is named. SECURITY DEFINER so the lookup reads the holder row
  -- whatever the caller's RLS view is; the only thing it returns is a refusal.
  -- FOR SHARE serialises this write against a concurrent write that marks the
  -- holder itself, so two racing writers cannot build a chain between them.
  SELECT user_id, disconnected_at, account_shared_with_api_key_id
    INTO v_holder_owner, v_holder_disc, v_holder_holder
    FROM public.api_keys
   WHERE id = NEW.account_shared_with_api_key_id
     FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_SHARE_HOLDER_NOT_FOUND'
      USING ERRCODE = '23503',
            DETAIL  = 'api_keys.account_shared_with_api_key_id names no api_keys row.';
  END IF;

  IF v_holder_owner IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER'
      USING ERRCODE = '42501',
            DETAIL  = 'api_keys.account_shared_with_api_key_id must name a key of the same user_id.';
  END IF;

  -- The holder must be LIVE in the sense api_keys_user_exchange_venue_account_uniq
  -- uses: disconnected_at IS NULL. A revoked key is still live here, exactly as
  -- it is for that index (it is recovered in place by a reconnect).
  IF v_holder_disc IS NOT NULL THEN
    RAISE EXCEPTION 'ACCOUNT_SHARE_HOLDER_NOT_LIVE'
      USING ERRCODE = '55000',
            DETAIL  = 'api_keys.account_shared_with_api_key_id must name a key whose disconnected_at is NULL.';
  END IF;

  -- No chains and no cycles: the book counts a marked account once, through
  -- its holder, so a holder that is itself marked would leave the account
  -- counted by nobody (a 2-cycle) or resolved through a key that is not
  -- counted (a chain). Both directions are refused.
  IF v_holder_holder IS NOT NULL THEN
    RAISE EXCEPTION 'ACCOUNT_SHARE_HOLDER_IS_MARKED'
      USING ERRCODE = '23000',
            DETAIL  = 'The named holder is itself marked as sharing another key''s account; name that key instead.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.api_keys d
     WHERE d.account_shared_with_api_key_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_SHARE_KEY_IS_A_HOLDER'
      USING ERRCODE = '23000',
            DETAIL  = 'Another key already names this key as its holder, so this key cannot itself be marked.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_api_keys_account_share_same_owner()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enforce_api_keys_account_share_same_owner() IS
  'Phase 167.1.2 D-11. BEFORE INSERT OR UPDATE OF account_shared_with_api_key_id '
  'on api_keys. A NULL holder short-circuits with no lookup (so no ordinary '
  'insert pays for it or can be refused by it), and on an UPDATE that clears a '
  'holder while leaving the kind as it was, it clears account_share_kind too, '
  'so the FK''s ON DELETE SET NULL action never trips '
  'api_keys_account_share_both_or_neither (a write that clears the holder but '
  'sets a different kind keeps that kind and is refused by the CHECK). A '
  'non-NULL holder is refused: 23503 ACCOUNT_SHARE_HOLDER_NOT_FOUND when no '
  'such row exists; 42501 ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER when it belongs '
  'to another user_id; 55000 ACCOUNT_SHARE_HOLDER_NOT_LIVE when its '
  'disconnected_at is set; 23000 ACCOUNT_SHARE_HOLDER_IS_MARKED when the holder '
  'is itself marked, and 23000 ACCOUNT_SHARE_KEY_IS_A_HOLDER when another key '
  'already names this row as its holder (no chains, no cycles). Enforced in '
  'the database AT THE MOMENT THE MARKER IS WRITTEN, not only in the stamper, '
  'so no writer can point a key at another tenant''s key, at a departed key, '
  'or into a chain. A holder that departs LATER keeps its dependents'' markers '
  'until the stamper re-evaluates them; this trigger does not fire on a '
  'disconnect.';

CREATE TRIGGER api_keys_account_share_same_owner
BEFORE INSERT OR UPDATE OF account_shared_with_api_key_id
ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.enforce_api_keys_account_share_same_owner();

COMMENT ON TRIGGER api_keys_account_share_same_owner ON public.api_keys IS
  'Phase 167.1.2 D-11. Fires only when account_shared_with_api_key_id is written, '
  'so ordinary worker writes (sync_status, last_sync_at, cursors) never hit it.';

-- ───────────── 2. the departed-history flag (D-05, D-09)
ALTER TABLE public.api_keys
  ADD COLUMN history_inclusion text NULL;

ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_history_inclusion_valid
    CHECK (history_inclusion IS NULL
           OR history_inclusion IN ('include', 'exclude'));

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

-- ─────── 3. the owner RPC for (2). Shape mirrors disconnect_allocator_api_key.
CREATE FUNCTION public.set_departed_key_history_inclusion(
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
  -- REUSED: it goes back to status 'pending' with next_attempt_at = now(), the
  -- state reset_stalled_compute_jobs already writes for a reclaimed job. A
  -- pending row sits inside that unique index and inside the enqueue's dedup,
  -- so a later enqueue for the caller (a derive_broker_dailies epilogue among
  -- them) folds onto it instead of inserting a twin, which merely moving
  -- next_attempt_at forward would not prevent: the failed_retry row would rank
  -- first in its claim partition beside the epilogue's pending row, the same
  -- 23505. attempts is left alone, so the toggle grants no retry budget: a row
  -- one attempt short of max_attempts ends failed_final if it fails again, and
  -- the next toggle then enqueues a fresh job. The claim functions clear
  -- last_error and error_kind themselves. The job reads history_inclusion when
  -- it runs, so it picks up the new value.
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
  -- REASONED, NOT MEASURED: steps 1 and 3, the 23505 handler and the second
  -- pass close races between TWO backends, and the SQL gate corpus runs one
  -- session, so none of those windows has been exercised. Step 3's running
  -- refusal is gated (arm HIST-running) only in the single-session shape where
  -- the job is already running.
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
               next_attempt_at = now()
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
      v_job := enqueue_compute_job(
        p_strategy_id  := NULL,
        p_kind         := 'derive_allocator_equity',
        p_allocator_id := v_uid
      );
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
  'back to status pending with next_attempt_at = now() (the state the stall '
  'watchdog writes; attempts untouched), so a later enqueue folds onto it, '
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
  'one; if that one has finished too, 55006 HISTORY_RECOMPOSE_RACED (retry). '
  'A NULL job id raises XX000 HISTORY_RECOMPOSE_NOT_QUEUED, never success. '
  'Every pending, failed_retry, '
  'running or done_pending_children recompose row of the caller is locked '
  'until commit, so no worker can claim one before the new value is visible. '
  'Those two-backend orderings are reasoned from the claim functions (FOR '
  'UPDATE SKIP LOCKED), not measured. Returns true iff the stored value '
  'changed; the recompose is requested either way. EXECUTE: authenticated '
  'only.';

-- ───── 4. reconnect_allocator_api_key — re-based on 20260422101911, +1 refusal
CREATE OR REPLACE FUNCTION public.reconnect_allocator_api_key(
  p_api_key_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner        UUID;
  v_already_disc TIMESTAMPTZ;
  v_exchange     TEXT;
  v_venue_acct   TEXT;
  v_uid          UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, disconnected_at, exchange, venue_account_id
    INTO v_owner, v_already_disc, v_exchange, v_venue_acct
    FROM api_keys WHERE id = p_api_key_id;

  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'reconnect_allocator_api_key: caller does not own api_key %', p_api_key_id
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- Idempotent: not disconnected → NO-OP.
  IF v_already_disc IS NULL THEN
    RETURN false;
  END IF;

  -- Phase 167.1.2 Pitfall 5: a LIVE sibling already holds this account. Refuse
  -- by name before the UPDATE reaches api_keys_user_exchange_venue_account_uniq.
  -- A concurrent race past this check still hits the index and raises the SAME
  -- SQLSTATE, so one client mapping covers both.
  IF v_venue_acct IS NOT NULL AND EXISTS (
    SELECT 1
      FROM api_keys s
     WHERE s.user_id = v_uid
       AND s.exchange = v_exchange
       AND s.venue_account_id = v_venue_acct
       AND s.disconnected_at IS NULL
       AND s.id <> p_api_key_id
  ) THEN
    RAISE EXCEPTION 'KEY_VENUE_ALREADY_CONNECTED'
      USING ERRCODE = 'unique_violation',
            DETAIL  = 'Another connected key of this user already reads the same exchange account.';
  END IF;

  UPDATE api_keys
    SET disconnected_at = NULL,
        sync_error      = NULL,
        sync_status     = 'idle',
        history_inclusion = NULL
    WHERE id = p_api_key_id
      AND user_id = v_uid
      AND disconnected_at IS NOT NULL;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.reconnect_allocator_api_key IS
  'Migration 075: reverse of disconnect_allocator_api_key. Clears disconnected_at + resets sync_error and sync_status=idle so the next cron tick picks the key up fresh. Returns false if the key was not disconnected. Phase 167.1.2: refuses with SQLSTATE 23505 and message KEY_VENUE_ALREADY_CONNECTED, leaving the key disconnected, when a LIVE key of the same user, exchange and venue_account_id exists; a race that reaches api_keys_user_exchange_venue_account_uniq raises the same SQLSTATE. A successful reconnect also resets history_inclusion to NULL, so an include/exclude choice made for a past departure never applies to a later one.';

REVOKE ALL ON FUNCTION public.reconnect_allocator_api_key(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconnect_allocator_api_key(uuid)
  TO authenticated;

-- ───────────── 5. column grants: SELECT to authenticated only, nothing to anon
GRANT SELECT (account_shared_with_api_key_id, account_share_kind, history_inclusion)
  ON public.api_keys TO authenticated;

-- ───────────── 6. the COMMENTs that said every ccxt venue is NULL (D-10)
-- The column COMMENT re-stamps 20260920120000's text (byte-identical to PROD's,
-- MEASURED against supabase/schema/baseline.sql 2026-09-25). The index COMMENT
-- is re-stated from 20260812083206's longer wording, which is NOT what PROD
-- carries: PROD holds a shorter text no migration here produces. Every
-- sentence of PROD's shorter text is kept in substance below. The rollback
-- restores PROD's text, not the file's.
COMMENT ON COLUMN public.api_keys.venue_account_id IS
  'Phase 154/WIZCONT-02, RE-STAMPED by 164.5.3/MT5CREDS (founder decision '
  'D-01-PRIME, 2026-09-20; full reasoning in 164.5.3-CONTEXT.md AMENDMENT '
  'section, not restated here), and by Phase 167.1.2/ACCOUNTTRUTH (D-10). '
  'NON-SECRET account identity for the credential in this row: the MT5 broker '
  'login, which analytics-service/services/mt5_probe.py asserts against the '
  'gateway at validation time, and since Phase 167.1.2 the venue''s own account '
  'id for OKX, Bybit, Binance and Deribit, read at connect validation or stamped '
  'by the service-role poll-time identity stamper. It is an ACCOUNT NUMBER, not '
  'a credential. The secret half lives in api_key_encrypted and never comes near '
  'this column. '
  'TRUST BOUNDARY, STATED HONESTLY: DO NOT CALL THIS VALUE '
  'VENUE-CONFIRMED. What is enforced, by FOUR independent fences (see the '
  'header of migration 20260920120000 for the full argument): a direct client '
  'INSERT is scrubbed to NULL by the scrub_client_supplied_venue_account_id '
  'trigger (20260812083206); direct client INSERT and UPDATE on api_keys '
  'are both fully revoked (20260823120000, 20260810120000 respectively); '
  'and authenticated holds NO EXECUTE on either wizard RPC (20260814120000), '
  'though that REVOKE is NOT durable across a future DROP+CREATE of either '
  'RPC unless the REVOKE/GRANT pair is re-issued in the same change (see '
  'the header of that migration). What is NOT enforced: the value has no '
  'in-database oracle. The real guarantee is an account the server has '
  'authenticated credentials for. The value is persisted only after the '
  'credentials it is derived from authenticated read-only against the live '
  'venue, at connect time or by decrypting the stored ciphertext already on '
  'this same row, never accepted as a fresh caller-supplied string with no '
  'server-side step behind it. A caller can choose which of their own working '
  'accounts to connect; they cannot mint one they do not hold. Treat the value '
  'as what the server derived, not what the venue confirmed: the CR-01 '
  'provenance residual (164.5.3-CONTEXT.md AMENDMENT, D-01-PRIME) stays OPEN. '
  'NULL means no server-derived account id is recorded for this row. For sFOX '
  'it is PERMANENT: no stable non-secret account id is known in its balance '
  'response, so its identity is UNKNOWABLE, not pending (Phase 167.1.2 D-10), '
  'and api_keys_user_exchange_venue_account_uniq cannot fence an sFOX '
  'duplicate. For any other venue it means neither the connect validation nor '
  'the identity stamper has recorded one for this row yet. '
  'api_keys_user_exchange_venue_account_uniq is PARTIAL so that it governs only '
  'rows that carry a real identity. '
  'api_keys_venue_account_id_nonblank forbids blank and whitespace-only '
  'values, because a blank string is non-NULL and would otherwise be '
  'governed by that index as if it were a real identity, collapsing two '
  'DIFFERENT accounts onto one row. '
  'OVERRIDE, RECORDED HONESTLY (164.5.3/MT5CREDS, founder decision '
  'D-01-PRIME, 2026-09-20): the prior form of this comment said never to '
  'echo this value to the browser, and said it was not readable by anon or '
  'authenticated anyway. BOTH ARE NOW FALSE BY DESIGN. Migration '
  '20260920120000 GRANTs authenticated SELECT on this column so the key card '
  'can display it. That is a bounded confidentiality delta under the threat '
  'model migration 027 states: a compromised user account or an XSS-captured '
  'JWT can now also read this identifier, not just exchange/label. It is '
  'accepted because the founder demonstrably needs the identifier to tell '
  'same-venue cards apart, and because publishing discloses nothing '
  'ACROSS a tenant boundary, since RLS still scopes every row to its own '
  'owner. anon still has NO grant on this column: migration 20260410225608 '
  'REVOKE-then-allowlist governs it and anon is not on the allowlist.';

COMMENT ON INDEX public.api_keys_user_exchange_venue_account_uniq IS
  'Phase 154 / WIZCONT-02: at most one LIVE api_keys row per (user, venue, '
  'account id). The DB half of "one fence, two keys" — the app '
  'fence in /api/strategies/create-with-key keys on wizard_session_id, this one '
  'keys on the credential identity, so a re-connect from a context that LOST the '
  'session token still dedups. CONTRACT: it FAILS TOWARD THE EXISTING ROW — the '
  'duplicate INSERT raises 23505 and the route resolves to the row already '
  'there. It must never be "resolved" by overwriting: the existing api_keys row '
  'carries strategy_keys membership and synced history other strategies depend '
  'on. ⭐ SCOPED TO LIVE ROWS (disconnected_at IS NULL): api_keys rows are '
  'RETAINED on soft-disconnect (20260422101911), so without that conjunct a DEAD '
  'row squats the slot forever and the contract above hands a re-connecting user '
  'a key every cron dispatcher skips — a strategy that silently never syncs, '
  'which is worse than the duplicate this index prevents. sync_status = ''revoked'' '
  'is deliberately NOT in the predicate (the worker rewrites sync_status on every '
  'tick, and revoked is recovered in place by reconnect_allocator_api_key); see '
  'the migration header. Since Phase 167.1.2, reconnect_allocator_api_key refuses '
  'a reconnect into an occupied slot BY NAME before reaching this index '
  '(KEY_VENUE_ALREADY_CONNECTED, SQLSTATE 23505), and a race that gets past that '
  'check is refused here with the same SQLSTATE. PARTIAL because NULL means no '
  'server-derived account id is recorded for the row: always for sFOX, whose '
  'identity is UNKNOWABLE (Phase 167.1.2 D-10), so this index cannot fence an '
  'sFOX duplicate; for OKX, Bybit, Binance and Deribit only until the connect '
  'validation or the poll-time identity stamper records one (Phase 167.1.2). '
  'api_keys_venue_account_id_nonblank keeps '''' out, since '''' is non-NULL and '
  'would otherwise let two DIFFERENT accounts collide onto one row. user_id LEADS '
  'deliberately — a non-tenant-leading unique index is the C-08 cross-tenant '
  'leak (see 20260726000225 and 20260728120000). ⛔ The uniqueness target is the '
  'PLAINTEXT identity, never api_key_encrypted: that column carries a per-row '
  'dek_encrypted + nonce, so two encryptions of one secret differ and an index '
  'over it would dedup nothing. Gate: '
  'supabase/tests/test_api_keys_venue_identity_uniq.sql.';

-- ───────────── 7. post-verify — CATALOGUE ONLY, passes on an empty database
DO $verify$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['account_shared_with_api_key_id', 'account_share_kind', 'history_inclusion']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = c
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20260925120000 failed: api_keys lacks column(s) %', v_missing;
  END IF;

  SELECT string_agg(n, ', ') INTO v_missing
    FROM unnest(ARRAY[
      'api_keys_account_shared_with_api_key_id_fkey',
      'api_keys_account_share_kind_valid',
      'api_keys_account_share_both_or_neither',
      'api_keys_account_share_not_self',
      'api_keys_history_inclusion_valid'
    ]) AS n
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.api_keys'::regclass AND conname = n AND convalidated
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20260925120000 failed: missing or unvalidated constraint(s) %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.api_keys'::regclass
       AND conname = 'api_keys_account_shared_with_api_key_id_fkey'
       AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'Migration 20260925120000 failed: the holder FK is not ON DELETE SET NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.api_keys'::regclass
       AND tgname = 'api_keys_account_share_same_owner'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Migration 20260925120000 failed: trigger api_keys_account_share_same_owner is not attached';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.api_keys', 'account_shared_with_api_key_id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.api_keys', 'account_share_kind', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.api_keys', 'history_inclusion', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20260925120000 failed: authenticated lacks SELECT on a new api_keys column';
  END IF;
  IF has_column_privilege('anon', 'public.api_keys', 'account_shared_with_api_key_id', 'SELECT')
     OR has_column_privilege('anon', 'public.api_keys', 'account_share_kind', 'SELECT')
     OR has_column_privilege('anon', 'public.api_keys', 'history_inclusion', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20260925120000 failed: anon unexpectedly holds SELECT on a new api_keys column';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.set_departed_key_history_inclusion(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20260925120000 failed: authenticated lacks EXECUTE on set_departed_key_history_inclusion';
  END IF;
  IF has_function_privilege('anon', 'public.set_departed_key_history_inclusion(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20260925120000 failed: anon unexpectedly holds EXECUTE on set_departed_key_history_inclusion';
  END IF;

  -- The trigger must be BEFORE, ROW, INSERT OR UPDATE (no DELETE, no
  -- TRUNCATE): tgtype 1 (ROW) + 2 (BEFORE) + 4 (INSERT) + 16 (UPDATE) = 23, and
  -- its UPDATE OF list must be exactly the holder column (int2vector is compared
  -- through its text form: a direct cast keeps its zero lower bound, and an
  -- array with a different lower bound never equals ARRAY[...]). A trigger that fired
  -- on every UPDATE would put the holder lookup on every worker write.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.api_keys'::regclass
       AND t.tgname = 'api_keys_account_share_same_owner'
       AND t.tgtype = 23
       AND string_to_array(t.tgattr::text, ' ')::int2[] = ARRAY[(
         SELECT a.attnum FROM pg_attribute a
          WHERE a.attrelid = 'public.api_keys'::regclass
            AND a.attname = 'account_shared_with_api_key_id'
       )]::int2[]
       AND t.tgfoid = 'public.enforce_api_keys_account_share_same_owner()'::regprocedure
  ) THEN
    RAISE EXCEPTION 'Migration 20260925120000 failed: api_keys_account_share_same_owner is not BEFORE INSERT OR UPDATE OF account_shared_with_api_key_id FOR EACH ROW on the enforce function';
  END IF;

  -- The partial holder index the FK's SET NULL action looks rows up through.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'public.api_keys'::regclass
       AND i.indexrelid = to_regclass('public.api_keys_account_shared_with_idx')
       AND i.indpred IS NOT NULL
       AND string_to_array(i.indkey::text, ' ')::int2[] = ARRAY[(
         SELECT a.attnum FROM pg_attribute a
          WHERE a.attrelid = 'public.api_keys'::regclass
            AND a.attname = 'account_shared_with_api_key_id'
       )]::int2[]
  ) THEN
    RAISE EXCEPTION 'Migration 20260925120000 failed: the partial holder index api_keys_account_shared_with_idx is missing or not on account_shared_with_api_key_id';
  END IF;

  -- The reconnect body carries the named refusal. (Its history_inclusion reset
  -- is a behaviour, gated by arm RECON-hist in the test file, not here.)
  IF position('KEY_VENUE_ALREADY_CONNECTED' IN (
       SELECT prosrc FROM pg_proc WHERE oid = 'public.reconnect_allocator_api_key(uuid)'::regprocedure
     )) = 0 THEN
    RAISE EXCEPTION 'Migration 20260925120000 failed: reconnect_allocator_api_key lacks the KEY_VENUE_ALREADY_CONNECTED refusal';
  END IF;

  RAISE NOTICE 'Migration 20260925120000: marker columns and constraints, the same-owner trigger (BEFORE INSERT OR UPDATE OF the holder column) and the partial holder index, history_inclusion, the owner RPC, the reconnect refusal, and column grants in place.';
END
$verify$;

COMMIT;
