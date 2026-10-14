-- ============================================================================
-- Phase 167.1.2.1 RECONMARKER, plan 01 (PR 1 of 2), decisions D-04, D-05, D-12,
-- D-15. A durable, per-key "this key's equity history was reconstructed" marker.
-- ============================================================================
--
-- THE DEFECT
-- ----------
-- "Has this API key been reconstructed?" is inferred today from evidence that is
-- neither durable nor per key: a `done` compute_jobs row (which
-- `retention_compute_jobs_done` reaps at 30 days), a job in flight, or whether
-- the ALLOCATOR has any allocator_equity_snapshots row at all. So a key whose
-- first sync collided is never backfilled, and a key older than 30 days looks
-- like it was never reconstructed. This migration gives the key itself the
-- state.
--
-- WHAT IT ADDS
-- ------------
--   * public.api_keys.history_reconstructed_at timestamptz NULL. NULL means the
--     key still OWES its reconstruct. Written only by the analytics worker and
--     the daily fan-out, under service_role (PR 2). Never client-writable.
--   * public.api_keys.history_reconstruct_attempts, an integer that is NOT NULL,
--     defaults to 0 and is CHECKed >= 0. Counts fan-out reconstruct enqueues;
--     PR 2 caps it at 5 (D-09, D-17). Written only by the fan-out SQL.
--   * public.backfill_api_keys_history_reconstructed_at() RETURNS integer. One
--     UPDATE that seeds the marker from the evidence that survives retention,
--     called once below and callable again by PR 2's migration (one call).
--   * public.request_allocator_holdings_sync(uuid), RE-BASED (SC-5, D-13, D-04):
--     its reconstruct gate now counts a job awaiting its retry and a set marker, and
--     no longer counts a retained done job on its own (O-2).
--     See "THE RPC RE-BASE" below.
--
-- THE EVIDENCE ORDER OF THE BACKFILL, IN PLAIN WORDS
-- --------------------------------------------------
--   1. D-12. Look at the key's NEWEST retained reconstruct OUTCOME audit event
--      (audit_log, entity_type 'api_key', entity_id = the key id). The worker
--      writes these through `_emit_audit`; they live in audit_log for 2 years,
--      long past the 30-day job retention. If that newest event is a success
--      (`allocator.equity.reconstruct_complete`, `..._partial_unsupported`,
--      `..._no_data`) the key is marked with that event's created_at.
--   2. D-15. If the newest outcome event is `allocator.equity.reconstruct_unexpected_noop`
--      (a sole-key job that finished DONE after writing 0 rows from a non-empty
--      payload) the key is NOT marked and stays owed, even when a `done` job for
--      it is still retained. That outcome is an anomaly, not a reconstruct.
--   3. REVISION 1, B1. A `reconstruct_complete` row whose metadata reason is
--      `already_reconstructed_for_api_key` is NOT an outcome event. It is the
--      worker's short-circuit echo of an EARLIER decision, and under the
--      pre-PR-2 worker that decision rested on a `done` job which a no-op also
--      leaves. Those rows are excluded BEFORE the newest event is picked, so an
--      echo can never launder a no-op into a success.
--   3b. SFH-2. Two more rows are dropped before the newest event is picked,
--      because they are transient failures and not outcomes: a
--      `reconstruct_no_data` with metadata snapshot_lookup_failed = true, and a
--      `reconstruct_complete` with metadata sibling_check_failed = true.
--   3c. WR-01. An audit row counts only when it is not older than the later of the
--      two 2026-04-24 heal migrations (`created_at >= 2026-04-24 03:12:38+00`),
--      which deleted the snapshots and `done` jobs those rows described.
--   3d. WR-02. An audit row counts only when its metadata carries `days_written`,
--      which every genuine worker outcome row has. That makes a row forged through
--      log_audit_event before D-18 shipped, with empty or foreign metadata, no
--      evidence. See the comment inside the function.
--   4. D-05. Only when the key has NO outcome event at all: the newest
--      `updated_at` of its `done` reconstruct_allocator_history jobs
--      (compute_jobs.updated_at is stamped by a BEFORE UPDATE trigger, so it is
--      the completion time).
--   5. An already-set marker is never overwritten.
--   6. FORGEABLE EVIDENCE. An audit row counts only when its user_id is the key's
--      owner (see the guard inside the function). That stops one user marking or
--      un-marking ANOTHER user's key through public.log_audit_event, which any
--      signed-in user can call with any action and entity_id. A user forging a row
--      about their OWN key, which this guard cannot tell from the worker's, is
--      closed at the source by D-18 (founder, 20261014120100, the same PR):
--      public.log_audit_event refuses the worker-only actions to every caller that
--      is not service_role. Rows written before D-18 applied are not cleaned; item
--      3d (WR-02) narrows them.
--
-- THE RPC RE-BASE
-- ---------------
-- RE-BASE DISCIPLINE, re-measured at execution, 2026-10-13 UTC:
--   grep -l -iE "function[[:space:]]+(public\.)?request_allocator_holdings_sync" \
--     supabase/migrations/*.sql | sort | tail -1
-- returned 20260924233749_allocator_sync_restore_inflight_prefetch.sql, on this
-- branch and on origin/main. That body is the one re-based here. FUTURE EDITORS:
-- re-base on THIS file (or a newer one), and keep the refusal, the poll prefetch,
-- the per-api_key reconstruct gate and exactly one unique_violation handler.
--
-- THE BODY IS 20260924233749's, VERBATIM, WITH EXACTLY THESE EDITS:
--   (1) SC-5 / D-13: 'failed_retry' is added to the RECONSTRUCT gate's status
--       list ONLY. The in-flight partial unique index on compute_jobs omits
--       failed_retry, so a reconstruct awaiting its retry did not stop a second
--       pending row being inserted, and the claim path would then run both.
--   (2) D-04: the key's history_reconstructed_at is read in a second SELECT, and
--       a set marker is folded into v_prior_reconstruct BEFORE the IF, so the IF
--       text the copy-check pins is unchanged. The marker outlives the 30-day
--       retention of the `done` job the gate used to rely on.
--   (3) O-2 (orchestrator, PR 1 review round): the marker is AUTHORITATIVE, so
--       'done' is DROPPED from the reconstruct gate's status list. A retained
--       `done` job alone no longer suppresses a reconstruct: a key whose newest
--       outcome was reconstruct_unexpected_noop (D-15) keeps a `done` job for up
--       to 30 days and stays owed, and with 'done' in the list "Sync now" would
--       skip it for that long. The in-flight statuses stay (pending, running,
--       done_pending_children, failed_retry). CONSEQUENCE, stated: this edit can
--       make the RPC enqueue MORE than before, for a key with a retained done job
--       and a NULL marker. Until PR 2 ships the worker's marker writer, that is
--       every key reconstructed after the backfill ran, and the worker's job-based
--       short-circuit (`_api_key_already_reconstructed`) still turns each such job
--       into a no-op that emits the echo row the backfill already excludes (B7).
--   (4) NOTHING ELSE. The poll prefetch list, the already_inflight early return,
--       the disconnected refusal and its order, the ownership 42501, the single
--       unique_violation handler and the -initial label are byte-identical.
--   WHY failed_retry IS NOT IN THE POLL PREFETCH (D-13): adding it there would
--   make "Sync now" answer already_inflight for up to an hour while a poll backs
--   off, a user-visible regression. The copy-check's c_pre_re keeps pinning it.
-- GRANTS ARE RE-CONVERGED, NOT ASSUMED: 20260924233749's ACL pair is re-issued
-- below, schema-qualified, then asserted (the default-grant event trigger of
-- 20260515130001, mig 118). service_role is not revoked.
--
-- VAC-04 ACKNOWLEDGEMENT. MEASURED 2026-10-13 UTC with the gate's own normalizer
-- against origin/main's snapshot (origin/main = the commit the branch was cut
-- from, standing in for PROD, assumption A1):
--   git show origin/main:supabase/schema/functions/request_allocator_holdings_sync.sql > <scratch>
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/request_allocator_holdings_sync.sql <scratch>
-- The acked hash is the `live` column of --diff-bodies. It is the body of
-- 20260924233749, which this CREATE OR REPLACE overwrites.
--
-- prod-body-ack: 47a7d156a401227d2f2762d261280489b6abc40a880c4bcd21cc5128ab7b2b35
--
-- ⚠️ THE ACK IS EARNED only if VAC-04 on the PR reports that SAME hash for PROD.
-- If it reports a different one, PROD drifted OUT OF BAND: FOLD the difference
-- into this migration and re-derive. Never edit the pragma to match a gate log.
-- The new backfill function has no PROD counterpart and needs no ack.
--
-- DEPLOY ORDER
-- ------------
-- This migration adds columns and one function. NO Python or TypeScript reads or
-- writes the new columns until PR 2 (research A5, D-17), so PR 1 is safe in
-- every deploy order. The SELECT grant on the two columns to `authenticated`
-- lands here and the `API_KEY_USER_COLUMNS_ARR` roster change lands later in the
-- code PR (the src/lib/constants.ts precedent: grant first, roster after, never
-- the reverse, or every user-scoped api_keys SELECT answers 42501).
--
-- LOCK AND MERGE WINDOW
-- ---------------------
-- ALTER TABLE takes a brief ACCESS EXCLUSIVE lock on api_keys, a table the
-- 04:00 UTC positions poll writes (sync_status, last_429_at). `lock_timeout` is
-- 3s, so a collision FAILS the apply instead of queueing behind the poll, and a
-- failed TEST apply blocks the PROD apply. MERGE OUTSIDE 04:00-05:45 UTC
-- (docs/runbooks/cron-sync-go-live.md P6 holds merges 04:15-05:45).
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's
-- catalogue and none of its data ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). The
-- backfill matches zero rows on an empty database and cannot raise. Of the three
-- DO blocks below, two read catalogues only; the third (the backfill call) counts
-- rows to REPORT them with RAISE NOTICE and never raises on a count
-- (scripts/lint-migration-data-dependence.mjs).
--
-- Rollback (manual, off the auto-apply path; marker values are lost with the
-- columns): supabase/migrations/down/20261014120000-rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ───────────────────────────── 1. the two columns and the CHECK
ALTER TABLE public.api_keys
  ADD COLUMN history_reconstructed_at timestamptz NULL,
  ADD COLUMN history_reconstruct_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_history_reconstruct_attempts_nonneg
  CHECK (history_reconstruct_attempts >= 0);

-- ───────────────────────────── 2. column GRANT (read only, authenticated only)
-- The D-14 reader (plan 06) reads both under the api_keys_owner row policy.
-- anon gets nothing. NO INSERT or UPDATE privilege is issued to anyone: the
-- columns are born un-writable by clients (20260810120000 and 20260823120000
-- revoked UPDATE and INSERT on api_keys from anon and authenticated).
GRANT SELECT (history_reconstructed_at, history_reconstruct_attempts)
  ON public.api_keys TO authenticated;

-- ───────────────────────────── 3. COMMENTs
COMMENT ON COLUMN public.api_keys.history_reconstructed_at IS
  'Phase 167.1.2.1 D-04. When this key''s equity-history reconstruct was '
  'recorded as done. NULL means the key still OWES its reconstruct. Written '
  'only by the analytics worker and the daily fan-out under service_role; no '
  'client INSERT or UPDATE path exists. Seeded by '
  'backfill_api_keys_history_reconstructed_at() from audit_log outcome events '
  '(D-12) and retained done jobs (D-05); a reconstruct_unexpected_noop outcome '
  'leaves it NULL (D-15). READABLE BY authenticated (column GRANT), scoped by '
  'the owner RLS on api_keys. anon has NO grant.';

COMMENT ON COLUMN public.api_keys.history_reconstruct_attempts IS
  'Phase 167.1.2.1 D-04. How many times the daily fan-out has enqueued a '
  'reconstruct for this key. Incremented only by the fan-out SQL, in the same '
  'transaction as the enqueue (D-17), and capped at 5 by PR 2 (D-09). Not reset '
  'on reconnect (D-16). Written only under service_role; no client INSERT or '
  'UPDATE path exists. READABLE BY authenticated (column GRANT), scoped by the '
  'owner RLS on api_keys. anon has NO grant.';

-- ───────────────────────────── 4. the backfill function
-- A function rather than an inline UPDATE so the SQL gate can exercise the exact
-- statement this migration runs, and PR 2's migration can re-run it with one
-- call. SECURITY INVOKER: it is called by the migration owner and by
-- service_role, both of which already hold the privileges it needs.
CREATE OR REPLACE FUNCTION public.backfill_api_keys_history_reconstructed_at()
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $fn$
  WITH newest_outcome AS (
    SELECT DISTINCT ON (a.entity_id)
           a.entity_id,
           a.action,
           a.created_at
      FROM public.audit_log a
      JOIN public.api_keys ak ON ak.id = a.entity_id
     WHERE a.entity_type = 'api_key'
       -- FORGEABLE-EVIDENCE GUARD. public.log_audit_event(...) is SECURITY
       -- DEFINER, granted to `authenticated`, and takes any action, entity_type
       -- and entity_id from the caller (user_id = auth.uid()), so a signed-in
       -- user can write an outcome-shaped row about ANY key id. The worker writes
       -- through log_audit_event_service with user_id = the key's owner. Requiring
       -- the two to match closes the CROSS-TENANT forgery. A user forging a row
       -- about their OWN key is refused at the source from 20261014120100 (D-18):
       -- log_audit_event denies the worker-only actions to every caller that is
       -- not service_role. A row written before D-18 applied is not cleaned; the
       -- days_written predicate below narrows it.
       AND a.user_id = ak.user_id
       AND a.action IN (
             'allocator.equity.reconstruct_complete',
             'allocator.equity.reconstruct_partial_unsupported',
             'allocator.equity.reconstruct_no_data',
             'allocator.equity.reconstruct_unexpected_noop')
       AND a.created_at IS NOT NULL
       -- WR-02. A GENUINE outcome row carries `days_written`: every one of the four
       -- actions is emitted from the single audit_metadata dict at the end of
       -- run_reconstruct_allocator_history (equity_reconstruction.py), which always
       -- includes it, and only the short-circuit echo (excluded below) lacks it.
       -- A row a user forged about their OWN key through public.log_audit_event
       -- before D-18 (20261014120100) shipped carries whatever metadata the caller
       -- sent, `{}` in the common case. Requiring the key does not make a forgery
       -- impossible, only no longer free. MEASURED on PROD 2026-10-13 (read-only,
       -- counts only): every outcome row dated after the WR-01 bound below carries
       -- it (22 of 22); the 3 rows that lack it all predate the bound.
       AND a.metadata ? 'days_written'
       -- WR-01. Migrations 20260424012820 and 20260424031238 deleted every
       -- allocator_equity_snapshots row and every `done` reconstruct job (to un-mark
       -- every key) but left audit_log alone, which keeps its rows 2 years. An
       -- outcome older than the LATER heal describes a series that heal deleted, so
       -- it is no evidence that the key has history now. The ledger stores no
       -- applied-at (supabase_migrations.schema_migrations: version, statements,
       -- name, created_by, idempotency_key, rollback; commit timestamps are not
       -- tracked), so the bound is the later migration's own version timestamp, read
       -- as UTC. MEASURED on PROD 2026-10-13 (read-only): the first post-heal
       -- reconstruct_started is 11 s after that timestamp and no outcome row exists
       -- between the previous heal's last one and it, so any bound inside that
       -- window sorts every PROD row identically.
       AND a.created_at >= TIMESTAMPTZ '2026-04-24 03:12:38+00'
       -- IS NOT DISTINCT FROM, not `=`: a real crawl completion carries no
       -- `reason`, so `->>` is NULL, and `NULL = 'x'` would make the NOT NULL and
       -- drop every ordinary reconstruct_complete row from the evidence.
       AND NOT (a.action = 'allocator.equity.reconstruct_complete'
                AND a.metadata ->> 'reason' IS NOT DISTINCT FROM 'already_reconstructed_for_api_key')
       -- SFH-2. Two rows the worker writes are TRANSIENT FAILURES, not outcomes, and
       -- like the echo above they are dropped BEFORE the newest event is picked:
       -- a reconstruct_no_data whose sole-key purge was refused because the snapshot
       -- lookup failed (snapshot_lookup_failed), and a reconstruct_complete written
       -- while the sibling lookup failed so the purge was skipped fail-safe
       -- (sibling_check_failed). Neither says the key's history was rebuilt; the
       -- next run of the worker may. IS NOT DISTINCT FROM for the same reason as
       -- above: a row without the key must stay IN the evidence.
       AND NOT (a.action = 'allocator.equity.reconstruct_no_data'
                AND a.metadata ->> 'snapshot_lookup_failed' IS NOT DISTINCT FROM 'true')
       AND NOT (a.action = 'allocator.equity.reconstruct_complete'
                AND a.metadata ->> 'sibling_check_failed' IS NOT DISTINCT FROM 'true')
     ORDER BY a.entity_id, a.created_at DESC
  ),
  done_job AS (
    SELECT cj.api_key_id,
           max(cj.updated_at) AS done_at
      FROM public.compute_jobs cj
     WHERE cj.kind = 'reconstruct_allocator_history'
       AND cj.status = 'done'
       AND cj.api_key_id IS NOT NULL
     GROUP BY cj.api_key_id
  ),
  evidence AS (
    SELECT k.id,
           CASE
             WHEN o.entity_id IS NOT NULL THEN
               CASE
                 WHEN o.action <> 'allocator.equity.reconstruct_unexpected_noop'
                   THEN o.created_at
               END
             ELSE d.done_at
           END AS marker_at
      FROM public.api_keys k
      LEFT JOIN newest_outcome o ON o.entity_id = k.id
      LEFT JOIN done_job d ON d.api_key_id = k.id
  ),
  marked AS (
    UPDATE public.api_keys k
       SET history_reconstructed_at = e.marker_at
      FROM evidence e
     WHERE k.id = e.id
       AND e.marker_at IS NOT NULL
       AND k.history_reconstructed_at IS NULL
    RETURNING k.id
  )
  SELECT count(*)::integer FROM marked;
$fn$;

REVOKE ALL ON FUNCTION public.backfill_api_keys_history_reconstructed_at()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_api_keys_history_reconstructed_at()
  TO service_role;

COMMENT ON FUNCTION public.backfill_api_keys_history_reconstructed_at() IS
  'Phase 167.1.2.1. Seeds api_keys.history_reconstructed_at for keys whose marker is NULL and returns the number of keys it marked. Evidence order: D-12, the key''s newest retained allocator.equity.reconstruct_* OUTCOME audit event, success marks the key with that event''s created_at; D-15, a newest event of reconstruct_unexpected_noop leaves the key owed even when a done job is retained; a reconstruct_complete echo with metadata reason already_reconstructed_for_api_key is not an outcome event, and neither is a reconstruct_no_data with snapshot_lookup_failed = true or a reconstruct_complete with sibling_check_failed = true (transient failures, SFH-2); an audit row older than 2026-04-24 03:12:38+00, the later heal migration that deleted the snapshots and done jobs it described, is not evidence (WR-01), and neither is one whose metadata lacks days_written, which every genuine worker outcome row carries (WR-02); D-05, only a key with no outcome event at all falls back to the newest updated_at of its done reconstruct_allocator_history jobs. Never overwrites a set marker. SECURITY INVOKER; service_role only.';

-- The one call. On an empty database (shared TEST) it matches zero rows and cannot
-- raise. It runs inside a DO block ONLY so the result is not thrown away: a bare
-- `SELECT f();` hands its count to a client that discards it, so the apply log of
-- a migration that auto-applies to PROD would say nothing about how many keys it
-- marked. The block reports three counts and NEVER raises on any of them
-- (scripts/lint-migration-data-dependence.mjs; TEST holds no rows, so a count
-- that raised would withhold a PROD deploy).
DO $backfill$
DECLARE
  v_owed_before integer;
  v_marked      integer;
  v_owed_after  integer;
BEGIN
  SELECT count(*)::integer INTO v_owed_before
    FROM public.api_keys WHERE history_reconstructed_at IS NULL;
  v_marked := public.backfill_api_keys_history_reconstructed_at();
  SELECT count(*)::integer INTO v_owed_after
    FROM public.api_keys WHERE history_reconstructed_at IS NULL;
  RAISE NOTICE 'Migration 20261014120000 backfill: % key(s) owed before the call, % marked by it, % still owed after (the daily fan-out of PR 2 retries those)',
    v_owed_before, v_marked, v_owed_after;
END
$backfill$;

-- ───────────────────────────── 5. request_allocator_holdings_sync, RE-BASED
-- Schema-qualified deliberately: an unqualified CREATE OR REPLACE resolves
-- against the SESSION search_path, and under one that does not put public first
-- it CREATES a second function elsewhere, which arrives with default privileges.
-- The edits are listed in the header ("THE RPC RE-BASE").
CREATE OR REPLACE FUNCTION public.request_allocator_holdings_sync(p_api_key_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid                UUID := auth.uid();
  v_owner              UUID;
  v_disconnected       TIMESTAMPTZ;
  v_job_id             UUID;
  v_next_attempt       TIMESTAMPTZ;
  v_prior_reconstruct  BOOLEAN;
  v_reconstructed_at   TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, disconnected_at INTO v_owner, v_disconnected
    FROM api_keys
    WHERE id = p_api_key_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'api_key_not_found_or_not_owned'
      USING ERRCODE = '42501';
  END IF;

  -- Migration 075: reject sync on soft-disconnected keys. Checked after
  -- ownership, so a non-owner never learns the key's state, and before the
  -- in-flight look-up, so a disconnected key is never reported as queued.
  IF v_disconnected IS NOT NULL THEN
    RAISE EXCEPTION 'api_key_disconnected'
      USING ERRCODE = 'P0001';
  END IF;

  -- Migration 067: look for a live poll job BEFORE enqueuing. The enqueue
  -- helper answers a duplicate by returning the existing id, and raises
  -- nothing, so this look-up is the only way the caller can learn that its
  -- request collapsed onto a job that was already queued.
  SELECT next_attempt_at INTO v_next_attempt
    FROM compute_jobs
    WHERE api_key_id = p_api_key_id
      AND kind = 'poll_allocator_positions'
      AND status IN ('pending', 'running', 'done_pending_children')
    ORDER BY next_attempt_at DESC
    LIMIT 1;

  IF v_next_attempt IS NOT NULL THEN
    -- f8: surface queued state to the UI, which renders the exchange-cooldown
    -- helper from next_attempt_at.
    RETURN jsonb_build_object(
      'already_inflight', true,
      'next_attempt_at', v_next_attempt
    );
  END IF;

  -- No live job, so enqueue a fresh one. Two concurrent calls that both got
  -- past the look-up collapse onto one row inside the enqueue helper, and the
  -- loser receives the winner's id (the accepted race, see the file header).
  v_job_id := enqueue_compute_job(
    p_strategy_id := NULL,
    p_kind        := 'poll_allocator_positions',
    p_api_key_id  := p_api_key_id
  );

  -- Per-api_key reconstruction gate (replaces migration 070's allocator-
  -- scoped snapshot-count check). Skip enqueue ONLY if THIS key's marker says it
  -- was reconstructed (below) OR a reconstruct for it is currently in flight.
  -- Phase 167.1.2.1 SC-5 / D-13: a job awaiting its retry (failed_retry) IS in
  -- flight. The in-flight unique index omits it, so without it here a second
  -- pending row would be inserted and a 30-minute crawl would run twice.
  -- O-2: a finished (`done`) job is NOT listed. The marker is authoritative, and
  -- a retained `done` job alone must not suppress a reconstruct (a D-15 key
  -- keeps one for up to 30 days and is still owed).
  SELECT EXISTS (
    SELECT 1 FROM compute_jobs
    WHERE api_key_id = p_api_key_id
      AND kind = 'reconstruct_allocator_history'
      AND status IN ('pending','running','done_pending_children','failed_retry')
  ) INTO v_prior_reconstruct;

  -- Phase 167.1.2.1 D-04 / O-2: the per-key marker is the decider. It outlives the
  -- 30-day job retention, and a set marker counts as a prior reconstruct.
  SELECT history_reconstructed_at INTO v_reconstructed_at
    FROM api_keys
    WHERE id = p_api_key_id;
  v_prior_reconstruct := v_prior_reconstruct OR v_reconstructed_at IS NOT NULL;

  IF NOT v_prior_reconstruct THEN
    BEGIN
      PERFORM enqueue_compute_job(
        p_strategy_id     := NULL,
        p_kind            := 'reconstruct_allocator_history',
        p_idempotency_key := 'reconstruct-alloc-' || p_api_key_id::text || '-initial',
        p_api_key_id      := p_api_key_id
      );
    EXCEPTION WHEN unique_violation THEN
      NULL; -- racing first-connect call landed first; benign
    END;
  END IF;

  UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
END;
$$;

REVOKE ALL ON FUNCTION public.request_allocator_holdings_sync(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_allocator_holdings_sync(uuid) TO authenticated;

COMMENT ON FUNCTION public.request_allocator_holdings_sync(uuid) IS
  'Authenticated wrapper for a holdings sync request. Returns {already_inflight: true, next_attempt_at} when a poll_allocator_positions job for the key is already pending, running or done_pending_children; otherwise enqueues one and returns {ok: true, job_id}, and for an api_key whose history_reconstructed_at marker is NULL and with no reconstruct_allocator_history job in flight (pending, running, done_pending_children) or awaiting retry (failed_retry) also enqueues that; a finished (done) job alone does not suppress it, the marker is authoritative (O-2). Raises 42501 for an unauthenticated caller or a key the caller does not own, and P0001 api_key_disconnected for a soft-disconnected key. Phase 164.9.1: restores migration 067''s in-flight look-up and migration 075''s disconnected-key refusal on migration 076''s per-api_key reconstruct gate. Phase 167.1.2.1: the reconstruct gate counts failed_retry (SC-5, D-13) and a set marker (D-04) and no longer counts a done job (O-2); the poll look-up is unchanged.';

-- ───────────── 6. self-verify (columns, grants, backfill) — CATALOGUE ONLY, passes on an empty database
DO $verify$
BEGIN
  IF (SELECT c.data_type || '/' || c.is_nullable
        FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'api_keys'
         AND c.column_name = 'history_reconstructed_at')
     IS DISTINCT FROM 'timestamp with time zone/YES' THEN
    RAISE EXCEPTION 'Migration 20261014120000 failed: api_keys.history_reconstructed_at is missing or is not a nullable timestamptz';
  END IF;

  IF (SELECT c.data_type || '/' || c.is_nullable || '/' || coalesce(c.column_default, '<none>')
        FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'api_keys'
         AND c.column_name = 'history_reconstruct_attempts')
     IS DISTINCT FROM 'integer/NO/0' THEN
    RAISE EXCEPTION 'Migration 20261014120000 failed: api_keys.history_reconstruct_attempts is missing or is not integer NOT NULL DEFAULT 0';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.api_keys'::regclass
       AND conname = 'api_keys_history_reconstruct_attempts_nonneg'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'Migration 20261014120000 failed: constraint api_keys_history_reconstruct_attempts_nonneg is missing or not validated';
  END IF;

  -- Tamper-proofing (T-167.1.2.1-01): a client that could write either column
  -- could forge "reconstructed" and suppress its own backfill.
  IF has_column_privilege('authenticated', 'public.api_keys', 'history_reconstructed_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.api_keys', 'history_reconstructed_at', 'INSERT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'history_reconstruct_attempts', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.api_keys', 'history_reconstruct_attempts', 'INSERT')
     OR has_column_privilege('anon', 'public.api_keys', 'history_reconstructed_at', 'UPDATE')
     OR has_column_privilege('anon', 'public.api_keys', 'history_reconstructed_at', 'INSERT')
     OR has_column_privilege('anon', 'public.api_keys', 'history_reconstruct_attempts', 'UPDATE')
     OR has_column_privilege('anon', 'public.api_keys', 'history_reconstruct_attempts', 'INSERT') THEN
    RAISE EXCEPTION 'Migration 20261014120000 failed: anon or authenticated unexpectedly holds INSERT or UPDATE on a history_reconstruct column';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.api_keys', 'history_reconstructed_at', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.api_keys', 'history_reconstruct_attempts', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261014120000 failed: authenticated lacks SELECT on a history_reconstruct column';
  END IF;

  IF has_column_privilege('anon', 'public.api_keys', 'history_reconstructed_at', 'SELECT')
     OR has_column_privilege('anon', 'public.api_keys', 'history_reconstruct_attempts', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261014120000 failed: anon unexpectedly holds SELECT on a history_reconstruct column';
  END IF;

  IF to_regprocedure('public.backfill_api_keys_history_reconstructed_at()') IS NULL THEN
    RAISE EXCEPTION 'Migration 20261014120000 failed: public.backfill_api_keys_history_reconstructed_at() is missing';
  END IF;
  IF has_function_privilege('anon', 'public.backfill_api_keys_history_reconstructed_at()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.backfill_api_keys_history_reconstructed_at()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261014120000 failed: anon or authenticated can EXECUTE the backfill function';
  END IF;

  RAISE NOTICE 'Migration 20261014120000: history_reconstructed_at and history_reconstruct_attempts present with the declared types and CHECK; authenticated can SELECT both and write neither; anon holds nothing; the backfill function is service_role only.';
END
$verify$;

-- ───────────── 7. self-verify (the RPC) — CATALOGUE ONLY, pg_get_functiondef
-- and friends, no table data. Copy-checks, not execution proof: the execution
-- proof is arms R1-R4 of supabase/tests/test_api_keys_history_reconstruct_marker.sql
-- and src/__tests__/request-allocator-holdings-sync-queued.test.ts. Every arm
-- matches a COMMENT-STRIPPED body, so a comment cannot satisfy an arm.
DO $verify_rpc$
DECLARE
  v_oid        oid := to_regprocedure('public.request_allocator_holdings_sync(uuid)');
  v_fn         text;   -- raw pg_get_functiondef (header + body + comments)
  v_body       text;   -- ...with both comment syntaxes stripped. MATCH ON THIS.
  v_cfg        text[];
  v_n          int;
  v_pos_owner  int;
  v_pos_disc   int;
  v_pos_pre    int;
  v_pos_ret    int;
  v_pos_enq    int;
  v_pos_recon  int;
  v_pos_uv     int;
  v_pos_gate   int;
  v_pos_mark   int;
  v_pos_fold   int;
  v_pos_if     int;
  c_sig        CONSTANT text := 'public.request_allocator_holdings_sync(uuid)';
  c_search_path CONSTANT text := 'search_path=public, pg_catalog';
  c_owner_re   CONSTANT text := '''api_key_not_found_or_not_owned''';
  c_disc_re    CONSTANT text :=
    'IF[[:space:]]+v_disconnected[[:space:]]+IS[[:space:]]+NOT[[:space:]]+NULL[[:space:]]+THEN[[:space:]]+RAISE[[:space:]]+EXCEPTION[[:space:]]+''api_key_disconnected''[[:space:]]+USING[[:space:]]+ERRCODE[[:space:]]*=[[:space:]]*''P0001''';
  c_disc_read_re CONSTANT text :=
    'SELECT[[:space:]]+user_id[[:space:]]*,[[:space:]]*disconnected_at[[:space:]]+INTO[[:space:]]+v_owner[[:space:]]*,[[:space:]]*v_disconnected';
  -- The prefetch: a SELECT of next_attempt_at from compute_jobs for this key's
  -- live poll job. \mkind cannot match inside p_kind (one word).
  c_pre_re     CONSTANT text :=
    'SELECT[[:space:]]+next_attempt_at[[:space:]]+INTO[[:space:]]+v_next_attempt[[:space:]]+FROM[[:space:]]+compute_jobs[[:space:]]+WHERE[[:space:]]+api_key_id[[:space:]]*=[[:space:]]*p_api_key_id[[:space:]]+AND[[:space:]]+\mkind[[:space:]]*=[[:space:]]*''poll_allocator_positions''[[:space:]]+AND[[:space:]]+status[[:space:]]+IN[[:space:]]*\([[:space:]]*''pending''[[:space:]]*,[[:space:]]*''running''[[:space:]]*,[[:space:]]*''done_pending_children''[[:space:]]*\)';
  -- The early return that makes the prefetch observable to the caller.
  c_ret_re     CONSTANT text :=
    'IF[[:space:]]+v_next_attempt[[:space:]]+IS[[:space:]]+NOT[[:space:]]+NULL[[:space:]]+THEN[[:space:]]+RETURN[[:space:]]+jsonb_build_object[[:space:]]*\([[:space:]]*''already_inflight''[[:space:]]*,[[:space:]]*true';
  c_enq_re     CONSTANT text :=
    'v_job_id[[:space:]]*:=[[:space:]]*enqueue_compute_job[[:space:]]*\([[:space:]]*p_strategy_id[[:space:]]*:=[[:space:]]*NULL[[:space:]]*,[[:space:]]*p_kind[[:space:]]*:=[[:space:]]*''poll_allocator_positions''';
  c_recon_re   CONSTANT text :=
    'p_kind[[:space:]]*:=[[:space:]]*''reconstruct_allocator_history''';
  c_uv_re      CONSTANT text := 'EXCEPTION[[:space:]]+WHEN[[:space:]]+unique_violation';
  -- Arm (e), tightened in the round-1 review (migration-reviewer INFO): the
  -- gate is the SELECT EXISTS that fills v_prior_reconstruct from THIS key's
  -- reconstruct jobs, and the IF that reads it. Word probes alone survived the
  -- SELECT being deleted, which turns the IF into `IF NULL` and silently stops
  -- every first-connect reconstruct. [^;]* keeps each match inside one statement.
  c_gate_re    CONSTANT text :=
    'SELECT[[:space:]]+EXISTS[^;]*api_key_id[[:space:]]*=[[:space:]]*p_api_key_id[^;]*''reconstruct_allocator_history''[^;]*INTO[[:space:]]+v_prior_reconstruct';
  c_gate_if_re CONSTANT text :=
    'IF[[:space:]]+NOT[[:space:]]+v_prior_reconstruct[[:space:]]+THEN';
  -- Phase 167.1.2.1 needles. SC-5 / D-13: the reconstruct gate's status list
  -- names failed_retry (the poll prefetch does not; c_pre_re above pins that).
  c_gate_fr_re CONSTANT text :=
    '''reconstruct_allocator_history''[^;]*''failed_retry''[^;]*INTO[[:space:]]+v_prior_reconstruct';
  -- O-2: the marker is authoritative, so the reconstruct gate's status list must
  -- NOT name 'done' (the quotes make it not match 'done_pending_children').
  c_gate_done_re CONSTANT text :=
    '''reconstruct_allocator_history''[^;]*''done''[^;]*INTO[[:space:]]+v_prior_reconstruct';
  -- D-04: the key's marker is read and folded into v_prior_reconstruct.
  c_marker_read_re CONSTANT text :=
    'SELECT[[:space:]]+history_reconstructed_at[[:space:]]+INTO[[:space:]]+v_reconstructed_at[[:space:]]+FROM[[:space:]]+api_keys';
  c_fold_re    CONSTANT text :=
    'v_prior_reconstruct[[:space:]]*:=[[:space:]]*v_prior_reconstruct[[:space:]]+OR[[:space:]]+v_reconstructed_at[[:space:]]+IS[[:space:]]+NOT[[:space:]]+NULL';
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'allocator-sync-marker: public.request_allocator_holdings_sync(uuid) not found';
  END IF;

  v_fn   := pg_get_functiondef(v_oid);
  v_body := regexp_replace(regexp_replace(v_fn, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- ⛔ NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW.
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'allocator-sync-marker: the comment-stripped function body came back NULL, so every arm below would pass without reading anything. Refusing to report compliance on an unread body.';
  END IF;

  -- (a) SECURITY DEFINER, and the search_path pin is the exact VALUE.
  IF v_body !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'allocator-sync-marker: request_allocator_holdings_sync lost SECURITY DEFINER';
  END IF;
  SELECT p.proconfig INTO v_cfg FROM pg_proc p WHERE p.oid = v_oid;
  IF v_cfg IS NULL OR NOT (c_search_path = ANY(v_cfg)) THEN
    RAISE EXCEPTION 'allocator-sync-marker: request_allocator_holdings_sync does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty or reordered is search-path-hijackable.', v_cfg;
  END IF;

  -- (b) D-23: the ownership check reads disconnected_at, and the refusal
  -- follows the ownership RAISE and precedes the prefetch.
  v_pos_owner := regexp_instr(v_body, c_owner_re);
  v_pos_disc  := regexp_instr(v_body, c_disc_re);
  v_pos_pre   := regexp_instr(v_body, c_pre_re);
  IF v_body !~ c_disc_read_re THEN
    RAISE EXCEPTION 'allocator-sync-marker: the ownership SELECT no longer reads disconnected_at into v_disconnected, so the disconnected-key refusal has nothing to test';
  END IF;
  IF v_pos_disc = 0 THEN
    RAISE EXCEPTION 'allocator-sync-marker: the body has no api_key_disconnected refusal (RAISE with ERRCODE P0001 when v_disconnected is set) — a soft-disconnected key could be re-synced (migration 075 regressed again)';
  END IF;
  IF v_pos_owner = 0 OR v_pos_disc < v_pos_owner THEN
    RAISE EXCEPTION 'allocator-sync-marker: the api_key_disconnected refusal is not placed after the ownership check, so a non-owner could learn whether a key is disconnected';
  END IF;

  -- (c) D-09: the prefetch exists, returns already_inflight early, and runs
  -- BEFORE the poll enqueue; the refusal runs before the prefetch.
  IF v_pos_pre = 0 THEN
    RAISE EXCEPTION 'allocator-sync-marker: the body has no in-flight look-up for a poll_allocator_positions job in pending/running/done_pending_children — the RPC cannot return already_inflight (migration 067 regressed again)';
  END IF;
  IF v_pos_disc > v_pos_pre THEN
    RAISE EXCEPTION 'allocator-sync-marker: the api_key_disconnected refusal runs after the in-flight look-up, so a disconnected key with a live job would be reported as queued';
  END IF;
  v_pos_ret := regexp_instr(v_body, c_ret_re);
  v_pos_enq := regexp_instr(v_body, c_enq_re);
  IF v_pos_ret = 0 THEN
    RAISE EXCEPTION 'allocator-sync-marker: the in-flight look-up is not followed by an early RETURN of already_inflight, so its result never reaches the caller';
  END IF;
  IF v_pos_enq = 0 THEN
    RAISE EXCEPTION 'allocator-sync-marker: the body no longer assigns v_job_id from the poll_allocator_positions enqueue';
  END IF;
  IF NOT (v_pos_pre < v_pos_ret AND v_pos_ret < v_pos_enq) THEN
    RAISE EXCEPTION 'allocator-sync-marker: the order is not look-up, then early RETURN, then poll enqueue (positions %, %, %) — a look-up after the enqueue always finds the job it just created', v_pos_pre, v_pos_ret, v_pos_enq;
  END IF;

  -- (d) D-12: EXACTLY ONE unique_violation handler remains, and it is the
  -- reconstruct one. Never assert zero: the kept handler is intended.
  SELECT count(*) INTO v_n FROM regexp_matches(v_body, c_uv_re, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'allocator-sync-marker: the body carries % unique_violation handler(s), expected exactly 1 (the benign reconstruct one). A second one around the poll enqueue is the dead handler that migration 070 re-introduced.', v_n;
  END IF;
  v_pos_recon := regexp_instr(v_body, c_recon_re);
  v_pos_uv    := regexp_instr(v_body, c_uv_re);
  IF v_pos_recon = 0 OR v_pos_uv < v_pos_recon THEN
    RAISE EXCEPTION 'allocator-sync-marker: the one remaining unique_violation handler is not the one after the reconstruct_allocator_history enqueue';
  END IF;

  -- (e) 076's per-api_key reconstruct gate is intact: the SELECT EXISTS that
  -- fills v_prior_reconstruct for this key, and the IF that reads it.
  IF v_body !~ c_gate_re
     OR v_body !~ c_gate_if_re THEN
    RAISE EXCEPTION 'allocator-sync-marker: the per-api_key reconstruct gate from migration 076 is not intact in request_allocator_holdings_sync';
  END IF;
  IF v_body !~ c_gate_fr_re THEN
    RAISE EXCEPTION 'allocator-sync-marker: the reconstruct gate no longer counts a failed_retry job as in flight, so a key whose reconstruct awaits its retry would be enqueued a second one (SC-5)';
  END IF;
  IF v_body ~ c_gate_done_re THEN
    RAISE EXCEPTION 'allocator-sync-marker: the reconstruct gate counts a finished (done) job again, so a retained done job alone suppresses a reconstruct for a key whose marker is NULL (O-2: the marker is authoritative)';
  END IF;
  v_pos_gate := regexp_instr(v_body, c_gate_re);
  v_pos_mark := regexp_instr(v_body, c_marker_read_re);
  v_pos_fold := regexp_instr(v_body, c_fold_re);
  v_pos_if   := regexp_instr(v_body, c_gate_if_re);
  IF v_pos_mark = 0 OR v_pos_fold = 0 THEN
    RAISE EXCEPTION 'allocator-sync-marker: the body does not read api_keys.history_reconstructed_at and fold a set marker into v_prior_reconstruct (D-04)';
  END IF;
  IF NOT (v_pos_gate < v_pos_mark AND v_pos_mark < v_pos_fold AND v_pos_fold < v_pos_if) THEN
    RAISE EXCEPTION 'allocator-sync-marker: the order is not reconstruct gate, then marker read, then marker fold, then the IF that reads v_prior_reconstruct (positions %, %, %, %)', v_pos_gate, v_pos_mark, v_pos_fold, v_pos_if;
  END IF;
  IF v_body ~ 'v_snapshot_count' THEN
    RAISE EXCEPTION 'allocator-sync-marker: the legacy v_snapshot_count gate from migration 070 is back in request_allocator_holdings_sync';
  END IF;

  -- (f) ACL: the REVOKE/GRANT above actually converged. PUBLIC first, so a
  -- PUBLIC leak is named as a PUBLIC leak.
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'allocator-sync-marker: the anon or authenticated role does not exist on this database, so the ACL arm cannot be evaluated. These are Supabase-standard roles; their absence means this migration is running somewhere it was not written for.';
  END IF;
  PERFORM public._assert_no_public_execute(c_sig);
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'allocator-sync-marker: anon holds EXECUTE on request_allocator_holdings_sync — an unauthenticated caller must be refused by the grant, not only by the body';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'allocator-sync-marker: authenticated lost EXECUTE on request_allocator_holdings_sync — every holdings sync request from the app would fail';
  END IF;

  RAISE NOTICE 'allocator-sync-marker: request_allocator_holdings_sync refuses a disconnected key after the ownership check, returns already_inflight from an in-flight look-up placed before the poll enqueue (failed_retry NOT in it), keeps exactly one (reconstruct) unique_violation handler, counts failed_retry and a set marker (and no longer a done job) in the per-api_key reconstruct gate; SECDEF, the exact search_path pin and the ACL (PUBLIC, anon, authenticated) intact.';
END
$verify_rpc$;

COMMIT;
