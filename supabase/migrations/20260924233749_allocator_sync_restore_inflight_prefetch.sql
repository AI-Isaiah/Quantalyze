-- ==========================================================================
-- Phase 164.9.1 (JOBRPCTRUTH), [164.9-LIVEDB-RESIDUE-RPC-AND-INTENT] item a:
-- `public.request_allocator_holdings_sync(uuid)` again tells an in-flight
-- collision apart from a fresh enqueue, and again refuses a soft-disconnected
-- key. Both behaviours were written by earlier migrations and then lost by a
-- later re-base onto an older body.
--
-- LINEAGE, MEASURED FROM THE FILES:
--   067 (20260420103104_allocator_sync_queued_prefetch) added a pre-enqueue
--       SELECT for a live poll_allocator_positions job and returned
--       {already_inflight, next_attempt_at} before calling enqueue_compute_job.
--       It REMOVED the `EXCEPTION WHEN unique_violation` handler around the
--       poll enqueue, because that handler can never fire:
--       `_enqueue_compute_job_internal` answers a duplicate with its optimistic
--       look-up and `ON CONFLICT DO NOTHING`, and neither raises 23505.
--   070 (20260420213754_allocator_equity_snapshots), written the same day, was
--       re-based on a body OLDER than 067. It put the dead handler back and lost
--       the prefetch, so the RPC returned {ok, job_id} for every call again.
--   075 (20260422101911_api_keys_disconnected_at, STEP 5) re-based on 070 and
--       added the refusal: after the ownership check,
--       `RAISE EXCEPTION 'api_key_disconnected' USING ERRCODE = 'P0001'` when
--       the key's disconnected_at is set.
--   076 (20260422122720_reconstruct_per_api_key_gate) replaced 070's
--       snapshot-count reconstruct gate with a per-api_key gate. It was
--       re-based on 070, NOT on 075, so the disconnected-key refusal was lost.
--       Its body is the one PROD runs today (the committed dump agrees).
--       ⚠️ 20260812083206's header lists this RPC among the paths that skip
--       disconnected keys. From 076 until this file, that claim was false.
--   THIS FILE re-bases on 076 and puts back 075's refusal and 067's prefetch.
--
-- RE-BASE DISCIPLINE, re-measured at execution, 2026-09-24 UTC:
--   grep -n -iE "create (or replace )?function[[:space:]]+(public\.)?request_allocator_holdings_sync" \
--     supabase/migrations/*.sql
-- returned FIVE CREATE statements: 20260420073003 (066), 20260420103104 (067),
-- 20260420213754 (070), 20260422101911 (075) and 20260422122720 (076). The
-- newest is 076, which is the body re-based here. Two later files name the
-- function, 20260515210300 and 20260812083206, and both do so in a comment
-- only. FUTURE EDITORS: re-base on THIS file (or a newer one), and keep the
-- refusal, the prefetch and the per-api_key reconstruct gate.
--
-- THE BODY IS 076's, VERBATIM, WITH EXACTLY THESE EDITS:
--   (1) D-23: DECLARE gains `v_disconnected TIMESTAMPTZ`. The ownership SELECT
--       also reads `disconnected_at` into it. Right after the ownership RAISE
--       comes 075's refusal, with the same message and SQLSTATE. It sits AFTER
--       the ownership check, so a non-owner gets 42501 and learns nothing about
--       the key's state. It sits BEFORE the prefetch, so a disconnected key is
--       never reported as queued.
--   (2) D-09: 076's `BEGIN … EXCEPTION WHEN unique_violation` block around the
--       poll enqueue is REPLACED by 067's prefetch. If a poll_allocator_positions
--       job for this key is pending, running or done_pending_children, the RPC
--       returns {already_inflight: true, next_attempt_at} (the newest such
--       next_attempt_at). Otherwise it assigns v_job_id from the poll enqueue,
--       as 067 did. The early return skips the sync_status UPDATE and the
--       reconstruct gate, which is what 067 did and what 076's handler would
--       have done had it ever fired.
--   (3) D-12: 076's reconstruct gate, its benign
--       `EXCEPTION WHEN unique_violation THEN NULL` handler, the
--       `sync_status = 'syncing'` UPDATE and the {ok, job_id} RETURN are
--       unchanged. That handler is unreachable for the same reason as the
--       removed one, but it swallows nothing that can fire, so it stays.
-- The signature, RETURNS JSONB, SECURITY DEFINER and
-- `SET search_path = public, pg_catalog` are 076's. The CREATE is now
-- schema-qualified (see the note above it).
--
-- D-10: `_enqueue_compute_job_internal`'s idempotent return-the-existing-id
-- contract is NOT changed. This user-facing RPC owns the response shape.
--
-- ⚠️ D-11, AN ACCEPTED RACE, IN 067's WORDS: "Race window is tolerated: if two
-- concurrent calls pass the pre-check, _enqueue_compute_job_internal's partial
-- unique index + ON CONFLICT DO NOTHING + race-lost re-read still collapse both
-- calls onto the same row." Consequence: the losing call receives
-- {ok: true, job_id} naming the WINNER's job, and it also flips sync_status to
-- 'syncing' (which the winner does too). The prefetch is an optimisation for
-- the common case, not a correctness boundary. The race is not closed here, and
-- no test is taught to accept the {ok, job_id} return for a live job.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — the PROD body this CREATE OR REPLACE overwrites
-- ══════════════════════════════════════════════════════════════════════════
-- MEASURED 2026-09-24 UTC, LOCALLY, with the gate's own normalizer, aiming its
-- `live` argument at origin/main's snapshot in place of PROD
-- (origin/main = f8a3096e3f984f96e7ff0a442e44d2c46f78f9bd):
--
--   git show origin/main:supabase/schema/functions/request_allocator_holdings_sync.sql > <scratch>
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/request_allocator_holdings_sync.sql <scratch>
--
-- ⭐ THE ACKED HASH IS THE `live` COLUMN OF --diff-bodies, NOT `--hash` OF THE
-- SNAPSHOT FILE (a whole-file digest no gate ever greps). It equals the value
-- research recorded, and it also matches the committed PROD dump.
--
-- prod-body-ack: 1a5a19591878d67b863614ca68839258255b235825b725f5223abcee368ff137
--
-- ⚠️ THE ACK IS OF origin/main, WHICH STANDS IN FOR PROD (assumption A1). It is
-- EARNED only if VAC-04 on the PR reports that SAME hash for PROD. If it
-- reports a different one, PROD drifted OUT OF BAND: FOLD the difference into
-- this migration and re-derive. Never edit the pragma to match a gate log.
--
-- GRANTS ARE RE-CONVERGED, NOT ASSUMED: 076's ACL pair is re-issued below,
-- schema-qualified with the full signature, and then asserted. The reason is
-- the default-grant event trigger recorded in 20260515130001 (mig 118).
-- service_role is not revoked (PROD grants it, and nothing here needs it gone).
--
-- REVERSIBLE: re-run 076's body. No schema change: this migration replaces one
-- function body, refreshes one COMMENT and re-issues two grants.
--
-- Transaction style: NO explicit BEGIN/COMMIT. Supabase wraps each migration in
-- an implicit transaction, and SET LOCAL lock_timeout applies to that wrap.
-- This migration writes ZERO table data. Its DO block reads catalogs only
-- (D-07, [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). 067's STEP 3 "functional
-- probe" is deliberately NOT carried: it wrote and read table data. Every RAISE
-- format string below is a SINGLE literal (Phase 85 invariant #21).
--
-- Execution proof is NOT this file's DO block (a copy-check, see below). It is
-- the live-DB arms of src/__tests__/request-allocator-holdings-sync-queued.test.ts,
-- run against a database with this migration applied.
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- 076's body, verbatim, plus 075's disconnected-key refusal and 067's
-- in-flight prefetch (see the header for the exact edits). Returns one of:
--   {already_inflight: true, next_attempt_at}  a live poll job exists;
--   {ok: true, job_id}                         a poll job was enqueued (or a
--                                              concurrent caller's was reused);
--   raises 42501 not_authenticated / api_key_not_found_or_not_owned, or
--   raises P0001 api_key_disconnected for a soft-disconnected key.
--
-- ⚠️ SCHEMA-QUALIFIED DELIBERATELY. An unqualified CREATE OR REPLACE resolves
-- against the SESSION search_path. Under a search_path that does not put public
-- first, it CREATES a second function in another schema, and a new function
-- arrives with default privileges (see the mig 118 note in the header).
-- --------------------------------------------------------------------------
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
  -- scoped snapshot-count check). Skip enqueue ONLY if THIS key has
  -- previously completed a reconstruct OR is currently in-flight.
  SELECT EXISTS (
    SELECT 1 FROM compute_jobs
    WHERE api_key_id = p_api_key_id
      AND kind = 'reconstruct_allocator_history'
      AND status IN ('done','pending','running','done_pending_children')
  ) INTO v_prior_reconstruct;

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
  'Authenticated wrapper for a holdings sync request. Returns {already_inflight: true, next_attempt_at} when a poll_allocator_positions job for the key is already pending, running or done_pending_children; otherwise enqueues one and returns {ok: true, job_id}, and for an api_key with no prior reconstruct_allocator_history job (done or in-flight) also enqueues that. Raises 42501 for an unauthenticated caller or a key the caller does not own, and P0001 api_key_disconnected for a soft-disconnected key. Phase 164.9.1: restores migration 067''s in-flight look-up and migration 075''s disconnected-key refusal on migration 076''s per-api_key reconstruct gate.';

-- --------------------------------------------------------------------------
-- Self-verify. CATALOG-ONLY (D-07): pg_get_functiondef, pg_proc.proconfig,
-- has_function_privilege, to_regprocedure and to_regrole. No table data.
--
-- These arms are COPY-CHECKS: they prove the body the server stored carries
-- the statements the header lists, in the order it lists them. They cannot
-- catch a logic error that was faithfully transcribed. Execution proof is the
-- live-DB Queued arms named in the header.
--
-- Every arm matches a COMMENT-STRIPPED body (both plpgsql comment syntaxes),
-- so a comment that quotes a statement cannot satisfy an arm (T-163-16).
-- --------------------------------------------------------------------------
DO $$
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
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: public.request_allocator_holdings_sync(uuid) not found';
  END IF;

  v_fn   := pg_get_functiondef(v_oid);
  v_body := regexp_replace(regexp_replace(v_fn, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- ⛔ NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW.
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the comment-stripped function body came back NULL, so every arm below would pass without reading anything. Refusing to report compliance on an unread body.';
  END IF;

  -- (a) SECURITY DEFINER, and the search_path pin is the exact VALUE.
  IF v_body !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: request_allocator_holdings_sync lost SECURITY DEFINER';
  END IF;
  SELECT p.proconfig INTO v_cfg FROM pg_proc p WHERE p.oid = v_oid;
  IF v_cfg IS NULL OR NOT (c_search_path = ANY(v_cfg)) THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: request_allocator_holdings_sync does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty or reordered is search-path-hijackable.', v_cfg;
  END IF;

  -- (b) D-23: the ownership check reads disconnected_at, and the refusal
  -- follows the ownership RAISE and precedes the prefetch.
  v_pos_owner := regexp_instr(v_body, c_owner_re);
  v_pos_disc  := regexp_instr(v_body, c_disc_re);
  v_pos_pre   := regexp_instr(v_body, c_pre_re);
  IF v_body !~ c_disc_read_re THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the ownership SELECT no longer reads disconnected_at into v_disconnected, so the disconnected-key refusal has nothing to test';
  END IF;
  IF v_pos_disc = 0 THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the body has no api_key_disconnected refusal (RAISE with ERRCODE P0001 when v_disconnected is set) — a soft-disconnected key could be re-synced (migration 075 regressed again)';
  END IF;
  IF v_pos_owner = 0 OR v_pos_disc < v_pos_owner THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the api_key_disconnected refusal is not placed after the ownership check, so a non-owner could learn whether a key is disconnected';
  END IF;

  -- (c) D-09: the prefetch exists, returns already_inflight early, and runs
  -- BEFORE the poll enqueue; the refusal runs before the prefetch.
  IF v_pos_pre = 0 THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the body has no in-flight look-up for a poll_allocator_positions job in pending/running/done_pending_children — the RPC cannot return already_inflight (migration 067 regressed again)';
  END IF;
  IF v_pos_disc > v_pos_pre THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the api_key_disconnected refusal runs after the in-flight look-up, so a disconnected key with a live job would be reported as queued';
  END IF;
  v_pos_ret := regexp_instr(v_body, c_ret_re);
  v_pos_enq := regexp_instr(v_body, c_enq_re);
  IF v_pos_ret = 0 THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the in-flight look-up is not followed by an early RETURN of already_inflight, so its result never reaches the caller';
  END IF;
  IF v_pos_enq = 0 THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the body no longer assigns v_job_id from the poll_allocator_positions enqueue';
  END IF;
  IF NOT (v_pos_pre < v_pos_ret AND v_pos_ret < v_pos_enq) THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the order is not look-up, then early RETURN, then poll enqueue (positions %, %, %) — a look-up after the enqueue always finds the job it just created', v_pos_pre, v_pos_ret, v_pos_enq;
  END IF;

  -- (d) D-12: EXACTLY ONE unique_violation handler remains, and it is the
  -- reconstruct one. Never assert zero: the kept handler is intended.
  SELECT count(*) INTO v_n FROM regexp_matches(v_body, c_uv_re, 'g');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the body carries % unique_violation handler(s), expected exactly 1 (the benign reconstruct one). A second one around the poll enqueue is the dead handler that migration 070 re-introduced.', v_n;
  END IF;
  v_pos_recon := regexp_instr(v_body, c_recon_re);
  v_pos_uv    := regexp_instr(v_body, c_uv_re);
  IF v_pos_recon = 0 OR v_pos_uv < v_pos_recon THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the one remaining unique_violation handler is not the one after the reconstruct_allocator_history enqueue';
  END IF;

  -- (e) 076's per-api_key reconstruct gate is intact: the SELECT EXISTS that
  -- fills v_prior_reconstruct for this key, and the IF that reads it.
  IF v_body !~ c_gate_re
     OR v_body !~ c_gate_if_re THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the per-api_key reconstruct gate from migration 076 is not intact in request_allocator_holdings_sync';
  END IF;
  IF v_body ~ 'v_snapshot_count' THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the legacy v_snapshot_count gate from migration 070 is back in request_allocator_holdings_sync';
  END IF;

  -- (f) ACL: the REVOKE/GRANT above actually converged. PUBLIC first, so a
  -- PUBLIC leak is named as a PUBLIC leak.
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: the anon or authenticated role does not exist on this database, so the ACL arm cannot be evaluated. These are Supabase-standard roles; their absence means this migration is running somewhere it was not written for.';
  END IF;
  PERFORM public._assert_no_public_execute(c_sig);
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: anon holds EXECUTE on request_allocator_holdings_sync — an unauthenticated caller must be refused by the grant, not only by the body';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'allocator-sync-prefetch: authenticated lost EXECUTE on request_allocator_holdings_sync — every holdings sync request from the app would fail';
  END IF;

  RAISE NOTICE 'allocator-sync-prefetch: request_allocator_holdings_sync refuses a disconnected key after the ownership check, returns already_inflight from an in-flight look-up placed before the poll enqueue, keeps exactly one (reconstruct) unique_violation handler and the per-api_key reconstruct gate; SECDEF, the exact search_path pin and the ACL (PUBLIC, anon, authenticated) intact.';
END
$$;
