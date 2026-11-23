-- ==========================================================================
-- Phase 227 JOBLEDGER, plan 02 (HEAL-04 and MT5D-01, the reset half): a watchdog
-- reset leaves a record that reads as a reset, and the strategy's analytics status
-- follows the reset through the existing bridge.
--
-- THE DEFECT, TWO PARTS.
--   (1) HEAL-04 (TODOS [164.2-RECLAIM-PROVENANCE]). reset_stalled_compute_jobs (the live
--       watchdog; the worker's watchdog_tick calls it) and reclaim_stuck_compute_jobs
--       flip a `running` row back to `pending` and never call the status bridge. The
--       attempt that stalled may already have stamped its curated sentence S1 and the
--       markers ('writer', J) on strategy_analytics. After the reset the row still
--       reads status 'failed', S1 and the markers. Attempt 2 of the SAME job J then
--       writes a DIFFERENT curated sentence S2 restating ('writer', J). The BEFORE UPDATE
--       trigger strategy_analytics_drop_stale_error_provenance sees the sentence change
--       while both markers keep their current values, and NULLs the markers, so S2 is
--       left with no provenance and the next bridge run replaces it with the per-kind
--       generic. The curated sentence the writer worked to produce is lost. The bridge's
--       branch (a) already clears the sentence and both markers for a strategy that has a
--       non-terminal job (the reset leaves one: the job is pending), so calling the
--       bridge after a reset puts the row back to 'computing' with NULL markers, and the
--       attempt-2 re-stamp then changes the markers too and survives the trigger.
--   (2) MT5D-01. A reset erases nothing from the failed-attempt ledger (plan 01 added
--       public.compute_job_attempt_failures) but also adds nothing: a stall looks like no
--       failure at all. The founder ruling separates "a real error vs a stall reset vs a
--       watchdog reset", so every row either function resets leaves one ledger row naming
--       the cause.
--
-- DECISIONS THIS PLAN RECORDS (planner, inside CONTEXT "Claude's Discretion").
--   DEC-02-A  Which function. BOTH. reset_stalled_compute_jobs is the live path (the
--             worker's watchdog_tick; RESEARCH census (d): reclaim_stuck_compute_jobs has no
--             caller on PROD). reclaim_stuck_compute_jobs gets the same treatment so it can
--             never become a second silent path if someone wires it up. Fixing only reclaim
--             would close nothing in production.
--   DEC-02-B  One bridge call per distinct (strategy_id, kind). The trigger job id passed is
--             the lowest reset job id in that group. Per kind, not per strategy, so a
--             strategy with a reset side-kind job AND a reset main-kind job still bounces:
--             the bridge's own v_side_kinds early return decides each call, and this
--             migration never respells that list. Calls run in the order
--             hashtext(strategy_id::text), strategy_id, kind, which is the order every other
--             bridge caller locks in (mark_compute_job_failed's sorted loop).
--   DEC-02-C  Lock order. The row locks (the SKIP LOCKED selection of each pass) are taken
--             first, then the bridge advisory lock, the same order as
--             mark_compute_job_failed. A reset row is `running`, while the fan-in cascade
--             locks only `done_pending_children` rows, so no cycle was found (RESEARCH
--             Pattern 3). There is no lock_timeout on this path. Plan 10's lane run measures
--             a 500-row reset (RESEARCH pitfall 6); the duration is measured there, not
--             assumed here.
--   DEC-02-D  The bridge's comment. sync_strategy_analytics_status's body comment lists
--             reset_stalled_compute_jobs among the NON-caller writers. That sentence is now
--             wrong. The bridge is NOT re-issued to fix a comment (it would be a third
--             re-basing of the most-edited function in the repo for prose); this header is
--             the correction.
--   DEC-02-E  Reclaim keeps its token. reclaim_stuck_compute_jobs does not NULL claim_token
--             today. Changing that is out of scope. Its ledger row carries the token the
--             row held, and its attempt is the PRE-decrement count.
--
-- THE DELTA against 20260516104201 (the latest definition of both functions, re-grepped on
-- this tree: no later CREATE of either), in full, for each function:
--   * every UPDATE becomes one statement built from data-modifying CTEs. An `old` CTE
--     selects id, claim_token, attempts and claimed_by under the pass's EXACT existing WHERE,
--     ORDER BY claimed_at, LIMIT 500, FOR UPDATE SKIP LOCKED. An `upd` CTE runs the existing
--     UPDATE joined on old.id (same SET list, byte for byte as to columns and values) and
--     RETURNS the columns the ledger copies plus the OLD token, attempts and worker. An
--     `ins` CTE inserts one ledger row per updated row, ON CONFLICT (job_id, claim_token,
--     cause_class) DO NOTHING. The outer SELECT counts the updated rows (what
--     GET DIAGNOSTICS ROW_COUNT returned) and collects their ids.
--   * after the passes, ONE loop over the distinct (strategy_id, kind) of the reset rows
--     takes the bridge advisory lock and PERFORMs sync_strategy_analytics_status.
--   * unchanged: RETURNS INTEGER (the count of reset rows), SECURITY DEFINER, the pinned
--     search_path, the non-positive-threshold RAISE, the per-kind pass then the default
--     pass, LIMIT 500 and FOR UPDATE SKIP LOCKED per pass, last_error 'worker_stalled',
--     claim_token NULL (mig 117 P97 fence), and for reclaim the attempts decrement and the
--     reclaim_count bump. CREATE OR REPLACE keeps the existing ACL and COMMENT; the REVOKE
--     below restates the ACL (a no-op where 20260516104201 already ran), so the self-verify
--     claim about it holds on any database that reaches this file.
--
-- VAC-04 ACKNOWLEDGEMENTS. Two existing bodies change, so there are two pragmas below. Each
-- is the `live` column of the DRIFT row of
--
--   git show origin/main:supabase/schema/functions/<fn>.sql > <scratch>
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/<fn>.sql <scratch>
--
-- derived LOCALLY with the gate's own normalizer, aiming `live` at the committed snapshot
-- this branch started from (its pre-change copy), NOT --hash of a snapshot file.
-- ⚠️ IT IS ORIGIN/MAIN'S BODY STANDING IN FOR PROD. Each ack is EARNED only if VAC-04 on the
-- PR reports that SAME hash for PROD. If it reports another, PROD drifted out of band and the
-- correct action is to FOLD the difference into this migration and re-derive, never to edit a
-- pragma to match a gate log.
-- ⚠️ VAC-08 (repo-vs-TEST body pairing, the test-db-drift job) is RED on the PR by
-- construction until apply-on-merge brings TEST forward.
-- The first pragma is for reset_stalled_compute_jobs, the second for reclaim_stuck_compute_jobs.
--
-- prod-body-ack: 3923ef09a61533f01897502dc83085e496d1da13d96b17f1add28df855dd93c2
-- prod-body-ack: acf51c222c4581b1241bb8402ec054d77d3b177241926779bd151336a6217f76
--
-- Rollback: supabase/migrations/down/20261124120100-rollback.sql (manual, never auto-applied).
-- It restores both functions to their 20260516104201 bodies and leaves the ledger rows in
-- place (plan 01's rollback owns the table).
--
-- SELF-VERIFY (the last DO block) reads catalogues only (pg_proc, pg_get_functiondef,
-- has_function_privilege), never a table row, so scripts/lint-migration-data-dependence.mjs
-- passes and the apply cannot refuse on a database whose tables are empty. Every RAISE is
-- one literal naming the consequence.
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: reset_stalled_compute_jobs, re-based on 20260516104201
-- ==========================================================================
CREATE OR REPLACE FUNCTION reset_stalled_compute_jobs(
  p_stale_threshold    INTERVAL DEFAULT interval '10 minutes',
  p_per_kind_overrides JSONB    DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reset     INTEGER := 0;
  v_partial   INTEGER;
  v_kind      TEXT;
  v_threshold INTERVAL;
  -- HEAL-04 / MT5D-01 (phase 227): the ids this call reset, for the bridge loop below.
  v_ids       UUID[] := '{}';
  v_pass_ids  UUID[];
  r_b         RECORD;
BEGIN
  IF p_stale_threshold IS NULL OR p_stale_threshold <= interval '0' THEN
    RAISE EXCEPTION 'reset_stalled_compute_jobs: p_stale_threshold must be > 0, got %', p_stale_threshold
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Per-kind overrides: one bounded UPDATE per kind with its threshold.
  IF p_per_kind_overrides IS NOT NULL THEN
    FOR v_kind IN SELECT jsonb_object_keys(p_per_kind_overrides) LOOP
      v_threshold := (p_per_kind_overrides ->> v_kind)::INTERVAL;

      -- HEAL-04 / MT5D-01 (phase 227): the same bounded UPDATE, now in one statement with
      -- its ledger rows. `old` takes the row locks (SKIP LOCKED) and remembers the token,
      -- attempts and worker the row held BEFORE the reset; `upd` is the existing UPDATE;
      -- `ins` writes one watchdog_reset record per reset row.
      WITH old AS (
        SELECT id,
               claim_token AS old_claim_token,
               attempts    AS old_attempts,
               claimed_by  AS old_claimed_by
          FROM compute_jobs
         WHERE status = 'running'
           AND kind = v_kind
           AND claimed_at IS NOT NULL
           AND claimed_at < (now() - v_threshold)
         ORDER BY claimed_at
         LIMIT 500
         FOR UPDATE SKIP LOCKED
      ), upd AS (
        UPDATE compute_jobs cj
           SET status          = 'pending',
               claimed_at      = NULL,
               claimed_by      = NULL,
               next_attempt_at = now(),
               last_error      = 'worker_stalled',
               claim_token     = NULL    -- mig 117: P97 fence invalidation
          FROM old
         WHERE cj.id = old.id
        RETURNING cj.id, cj.kind, cj.strategy_id, cj.api_key_id, cj.exchange, cj.created_at,
                  old.old_claim_token, old.old_attempts, old.old_claimed_by
      ), ins AS (
        INSERT INTO public.compute_job_attempt_failures
               (job_id, kind, strategy_id, api_key_id, exchange, job_created_at,
                attempt, claim_token, cause_class, error_kind, error_text, worker_id)
        SELECT u.id, u.kind, u.strategy_id, u.api_key_id, u.exchange, u.created_at,
               u.old_attempts, u.old_claim_token, 'watchdog_reset', NULL, 'worker_stalled', u.old_claimed_by
          FROM upd u
        ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING
      )
      SELECT count(*), COALESCE(array_agg(upd.id), '{}'::uuid[])
        INTO v_partial, v_pass_ids
        FROM upd;

      v_reset := v_reset + v_partial;
      v_ids   := v_ids || v_pass_ids;
    END LOOP;
  END IF;

  -- Default threshold pass: kinds NOT in the override map.
  WITH old AS (
    SELECT id,
           claim_token AS old_claim_token,
           attempts    AS old_attempts,
           claimed_by  AS old_claimed_by
      FROM compute_jobs
     WHERE status = 'running'
       AND claimed_at IS NOT NULL
       AND claimed_at < (now() - p_stale_threshold)
       AND (
         p_per_kind_overrides IS NULL
         OR NOT (p_per_kind_overrides ? kind)
       )
     ORDER BY claimed_at
     LIMIT 500
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE compute_jobs cj
       SET status          = 'pending',
           claimed_at      = NULL,
           claimed_by      = NULL,
           next_attempt_at = now(),
           last_error      = 'worker_stalled',
           claim_token     = NULL    -- mig 117: P97 fence invalidation
      FROM old
     WHERE cj.id = old.id
    RETURNING cj.id, cj.kind, cj.strategy_id, cj.api_key_id, cj.exchange, cj.created_at,
              old.old_claim_token, old.old_attempts, old.old_claimed_by
  ), ins AS (
    INSERT INTO public.compute_job_attempt_failures
           (job_id, kind, strategy_id, api_key_id, exchange, job_created_at,
            attempt, claim_token, cause_class, error_kind, error_text, worker_id)
    SELECT u.id, u.kind, u.strategy_id, u.api_key_id, u.exchange, u.created_at,
           u.old_attempts, u.old_claim_token, 'watchdog_reset', NULL, 'worker_stalled', u.old_claimed_by
      FROM upd u
    ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING
  )
  SELECT count(*), COALESCE(array_agg(upd.id), '{}'::uuid[])
    INTO v_partial, v_pass_ids
    FROM upd;

  v_reset := v_reset + v_partial;
  v_ids   := v_ids || v_pass_ids;

  -- HEAL-04 / MT5D-01 (phase 227): re-derive the status of every strategy a reset row
  -- belongs to, once per distinct (strategy_id, kind), through the existing bridge.
  -- Every row lock is already held (the SKIP LOCKED selections above); the per-strategy
  -- advisory locks come AFTER them, in ONE sorted order (hashtext of the strategy id, the
  -- id, the kind) so two callers that bridge overlapping strategy sets cannot take them in
  -- opposite orders. The bridge itself decides whether a side-kind job bounces the status
  -- (its own early return); this loop spells no kind list. A key-mode row has a NULL
  -- strategy_id and makes no call.
  FOR r_b IN
    SELECT cj.strategy_id, cj.kind, min(cj.id::text)::uuid AS job_id
      FROM compute_jobs cj
     WHERE cj.id = ANY (v_ids)
       AND cj.strategy_id IS NOT NULL
     GROUP BY cj.strategy_id, cj.kind
     ORDER BY hashtext(cj.strategy_id::text), cj.strategy_id, cj.kind
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(r_b.strategy_id::text));
    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);
  END LOOP;

  RETURN v_reset;
END;
$$;

REVOKE ALL ON FUNCTION reset_stalled_compute_jobs(interval, jsonb) FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- STEP 2: reclaim_stuck_compute_jobs, re-based on 20260516104201
-- ==========================================================================
-- Same shape as STEP 1 (DEC-02-A: no caller on PROD today, fixed so it cannot become a
-- second silent path). The ledger row is cause_class stall_reclaim, error_text NULL, the
-- PRE-decrement attempt count and the claim token the row holds (DEC-02-E: reclaim does not
-- NULL it). The attempts decrement (mig 109 P2) and the reclaim_count bump stay.
CREATE OR REPLACE FUNCTION reclaim_stuck_compute_jobs(
  p_older_than INTERVAL DEFAULT interval '10 minutes'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reclaimed INTEGER;
  -- HEAL-04 / MT5D-01 (phase 227): the ids this call reclaimed, for the bridge loop below.
  v_ids       UUID[];
  r_b         RECORD;
BEGIN
  -- HEAL-04 / MT5D-01 (phase 227): the same bounded UPDATE, in one statement with its
  -- ledger rows. `old` takes the row locks (SKIP LOCKED) and remembers the token, attempts
  -- and worker the row held BEFORE the reclaim; `ins` writes one stall_reclaim record per
  -- reclaimed row with that PRE-decrement attempt count.
  WITH old AS (
    SELECT id,
           claim_token AS old_claim_token,
           attempts    AS old_attempts,
           claimed_by  AS old_claimed_by
      FROM compute_jobs
     WHERE status = 'running'
       AND claimed_at IS NOT NULL
       AND claimed_at < (now() - p_older_than)
     ORDER BY claimed_at
     LIMIT 500
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE compute_jobs cj
       SET status          = 'pending',
           claimed_at      = NULL,
           claimed_by      = NULL,
           next_attempt_at = now(),
           attempts        = GREATEST(cj.attempts - 1, 0),
           reclaim_count   = cj.reclaim_count + 1
      FROM old
     WHERE cj.id = old.id
    RETURNING cj.id, cj.kind, cj.strategy_id, cj.api_key_id, cj.exchange, cj.created_at,
              old.old_claim_token, old.old_attempts, old.old_claimed_by
  ), ins AS (
    INSERT INTO public.compute_job_attempt_failures
           (job_id, kind, strategy_id, api_key_id, exchange, job_created_at,
            attempt, claim_token, cause_class, error_kind, error_text, worker_id)
    SELECT u.id, u.kind, u.strategy_id, u.api_key_id, u.exchange, u.created_at,
           u.old_attempts, u.old_claim_token, 'stall_reclaim', NULL, NULL, u.old_claimed_by
      FROM upd u
    ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING
  )
  SELECT count(*), COALESCE(array_agg(upd.id), '{}'::uuid[])
    INTO v_reclaimed, v_ids
    FROM upd;

  -- HEAL-04 / MT5D-01 (phase 227): the same sorted bridge loop as reset_stalled_compute_jobs
  -- (DEC-02-B, DEC-02-C). The bridge decides whether a side-kind job bounces the status.
  FOR r_b IN
    SELECT cj.strategy_id, cj.kind, min(cj.id::text)::uuid AS job_id
      FROM compute_jobs cj
     WHERE cj.id = ANY (v_ids)
       AND cj.strategy_id IS NOT NULL
     GROUP BY cj.strategy_id, cj.kind
     ORDER BY hashtext(cj.strategy_id::text), cj.strategy_id, cj.kind
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(r_b.strategy_id::text));
    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);
  END LOOP;

  RETURN v_reclaimed;
END;
$$;

REVOKE ALL ON FUNCTION reclaim_stuck_compute_jobs(interval) FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- STEP 3: self-verify, CATALOGUE ONLY (reads no table row)
-- ==========================================================================
-- Each condition is computed into a named boolean and tested in its own IF, so a mutation
-- twin of the gates (supabase/tests/test_reset_stalled_bridge_provenance.sql and
-- test_compute_job_attempt_failures.sql) can stand one IF down and let the arm's OWN
-- observable go red. Every RAISE is one literal. Bodies are read comment-stripped, so a
-- comment can never satisfy a clause. Counts, not presence: reset has TWO passes, so a clause
-- that one pass satisfies would hide the other pass losing it.
DO $verify$
DECLARE
  v_rs_oid         oid := to_regprocedure('public.reset_stalled_compute_jobs(interval, jsonb)');
  v_rc_oid         oid := to_regprocedure('public.reclaim_stuck_compute_jobs(interval)');
  v_rs_body        text;
  v_rc_body        text;
  v_cfg            text[];
  v_ret            oid;
  v_rs_pin_ok      boolean;
  v_rs_ret_ok      boolean;
  v_rs_ledger_ok   boolean;
  v_rs_bound_ok    boolean;
  v_rs_bridge_ok   boolean;
  v_rs_group_ok    boolean;
  v_rs_keyless_ok  boolean;
  v_rs_contract_ok boolean;
  v_rs_count_ok    boolean;
  v_rs_excl_ok     boolean;
  v_rs_nokinds_ok  boolean;
  v_rs_acl_ok      boolean;
  v_rc_pin_ok      boolean;
  v_rc_ret_ok      boolean;
  v_rc_ledger_ok   boolean;
  v_rc_bound_ok    boolean;
  v_rc_bridge_ok   boolean;
  v_rc_group_ok    boolean;
  v_rc_keyless_ok  boolean;
  v_rc_contract_ok boolean;
  v_rc_nokinds_ok  boolean;
  v_rc_acl_ok      boolean;
BEGIN
  -- ----- reset_stalled_compute_jobs
  IF v_rs_oid IS NULL THEN
    RAISE EXCEPTION 'jobledger: reset_stalled_compute_jobs(interval, jsonb) does not exist, so no stalled job is ever reset';
  END IF;
  v_rs_body := regexp_replace(pg_get_functiondef(v_rs_oid), '--[^\n]*', '', 'g');

  SELECT p.proconfig, p.prorettype INTO v_cfg, v_ret FROM pg_proc p WHERE p.oid = v_rs_oid;
  v_rs_pin_ok := COALESCE(v_cfg, ARRAY[]::text[]) @> ARRAY['search_path=public, pg_catalog'];
  IF NOT v_rs_pin_ok THEN
    RAISE EXCEPTION 'jobledger: reset_stalled_compute_jobs must pin search_path=public, pg_catalog, otherwise a SECURITY DEFINER function resolves names through the caller''s path';
  END IF;
  v_rs_ret_ok := v_ret = 'integer'::regtype;
  IF NOT v_rs_ret_ok THEN
    RAISE EXCEPTION 'jobledger: reset_stalled_compute_jobs must still RETURN integer, otherwise the worker''s watchdog_tick reads the reset count from the wrong type';
  END IF;

  v_rs_ledger_ok :=
        (SELECT count(*) FROM regexp_matches(v_rs_body, 'INSERT INTO public\.compute_job_attempt_failures', 'g')) = 2
    AND (SELECT count(*) FROM regexp_matches(v_rs_body, 'u\.old_attempts,\s*u\.old_claim_token,\s*''watchdog_reset'',\s*NULL,\s*''worker_stalled'',\s*u\.old_claimed_by', 'g')) = 2;
  IF NOT v_rs_ledger_ok THEN
    RAISE EXCEPTION 'jobledger: both passes of reset_stalled_compute_jobs must write a watchdog_reset ledger row carrying the attempt count and claim token held BEFORE the reset, otherwise a stall reads like a real error or names the wrong attempt';
  END IF;

  v_rs_bound_ok :=
        (SELECT count(*) FROM regexp_matches(v_rs_body, 'LIMIT 500', 'g')) = 2
    AND (SELECT count(*) FROM regexp_matches(v_rs_body, 'FOR UPDATE SKIP LOCKED', 'g')) = 2;
  IF NOT v_rs_bound_ok THEN
    RAISE EXCEPTION 'jobledger: both passes of reset_stalled_compute_jobs must keep LIMIT 500 and FOR UPDATE SKIP LOCKED (M-0781), otherwise one watchdog tick locks an unbounded backlog and blocks every concurrent claim';
  END IF;

  v_rs_bridge_ok :=
        (SELECT count(*) FROM regexp_matches(v_rs_body, 'pg_advisory_xact_lock\(hashtext\(''mark_compute_job_bridge''\),\s*hashtext\(r_b\.strategy_id::text\)\)', 'g')) = 1
    AND (SELECT count(*) FROM regexp_matches(v_rs_body, 'PERFORM sync_strategy_analytics_status\(r_b\.strategy_id,\s*r_b\.job_id\)', 'g')) = 1;
  IF NOT v_rs_bridge_ok THEN
    RAISE EXCEPTION 'jobledger: reset_stalled_compute_jobs must take the mark_compute_job_bridge advisory lock and call sync_strategy_analytics_status with the reset job id as trigger, otherwise a reset strategy keeps its stale status and curated sentence, or a side-kind reset bounces a published status';
  END IF;

  v_rs_group_ok := (SELECT count(*) FROM regexp_matches(v_rs_body, 'GROUP BY cj\.strategy_id,\s*cj\.kind', 'g')) = 1;
  IF NOT v_rs_group_ok THEN
    RAISE EXCEPTION 'jobledger: reset_stalled_compute_jobs must make one bridge call per distinct strategy AND kind, otherwise the bridge cannot judge each reset job''s kind itself';
  END IF;

  v_rs_keyless_ok := (SELECT count(*) FROM regexp_matches(v_rs_body, 'cj\.strategy_id IS NOT NULL', 'g')) = 1;
  IF NOT v_rs_keyless_ok THEN
    RAISE EXCEPTION 'jobledger: reset_stalled_compute_jobs must skip rows with a NULL strategy_id in its bridge loop, otherwise one stalled key-mode job makes the bridge raise and aborts the whole watchdog tick';
  END IF;

  v_rs_contract_ok :=
        (SELECT count(*) FROM regexp_matches(v_rs_body, 'last_error\s*=\s*''worker_stalled''', 'g')) = 2
    AND (SELECT count(*) FROM regexp_matches(v_rs_body, 'claim_token\s*=\s*NULL', 'g')) = 2;
  IF NOT v_rs_contract_ok THEN
    RAISE EXCEPTION 'jobledger: both passes of reset_stalled_compute_jobs must still set last_error to worker_stalled and NULL the claim_token (mig 117 P97 fence), otherwise a stalled worker''s late mark is accepted';
  END IF;

  v_rs_count_ok := (SELECT count(*) FROM regexp_matches(v_rs_body, 'v_reset := v_reset \+ v_partial', 'g')) = 2;
  IF NOT v_rs_count_ok THEN
    RAISE EXCEPTION 'jobledger: both passes of reset_stalled_compute_jobs must add their row count to the returned total, otherwise the worker logs and alerts on a wrong number of reset rows';
  END IF;

  v_rs_excl_ok := strpos(v_rs_body, 'NOT (p_per_kind_overrides ? kind)') > 0;
  IF NOT v_rs_excl_ok THEN
    RAISE EXCEPTION 'jobledger: the default pass of reset_stalled_compute_jobs must exclude kinds named in p_per_kind_overrides, otherwise a job inside its own kind''s window is reset under the shorter default';
  END IF;

  v_rs_nokinds_ok := strpos(v_rs_body, 'v_side_kinds') = 0;
  IF NOT v_rs_nokinds_ok THEN
    RAISE EXCEPTION 'jobledger: reset_stalled_compute_jobs must not spell the bridge''s side-kind list (v_side_kinds), otherwise two copies of that list drift apart';
  END IF;

  v_rs_acl_ok := NOT has_function_privilege('public', v_rs_oid, 'EXECUTE')
             AND NOT has_function_privilege('anon', v_rs_oid, 'EXECUTE')
             AND NOT has_function_privilege('authenticated', v_rs_oid, 'EXECUTE');
  IF NOT v_rs_acl_ok THEN
    RAISE EXCEPTION 'jobledger: reset_stalled_compute_jobs must not be executable by PUBLIC, anon or authenticated, otherwise any caller can reset running jobs';
  END IF;

  -- ----- reclaim_stuck_compute_jobs
  IF v_rc_oid IS NULL THEN
    RAISE EXCEPTION 'jobledger: reclaim_stuck_compute_jobs(interval) does not exist, so no stuck job is ever reclaimed';
  END IF;
  v_rc_body := regexp_replace(pg_get_functiondef(v_rc_oid), '--[^\n]*', '', 'g');

  SELECT p.proconfig, p.prorettype INTO v_cfg, v_ret FROM pg_proc p WHERE p.oid = v_rc_oid;
  v_rc_pin_ok := COALESCE(v_cfg, ARRAY[]::text[]) @> ARRAY['search_path=public, pg_catalog'];
  IF NOT v_rc_pin_ok THEN
    RAISE EXCEPTION 'jobledger: reclaim_stuck_compute_jobs must pin search_path=public, pg_catalog, otherwise a SECURITY DEFINER function resolves names through the caller''s path';
  END IF;
  v_rc_ret_ok := v_ret = 'integer'::regtype;
  IF NOT v_rc_ret_ok THEN
    RAISE EXCEPTION 'jobledger: reclaim_stuck_compute_jobs must still RETURN integer, otherwise its caller reads the reclaim count from the wrong type';
  END IF;

  v_rc_ledger_ok :=
        (SELECT count(*) FROM regexp_matches(v_rc_body, 'INSERT INTO public\.compute_job_attempt_failures', 'g')) = 1
    AND (SELECT count(*) FROM regexp_matches(v_rc_body, 'u\.old_attempts,\s*u\.old_claim_token,\s*''stall_reclaim'',\s*NULL,\s*NULL,\s*u\.old_claimed_by', 'g')) = 1;
  IF NOT v_rc_ledger_ok THEN
    RAISE EXCEPTION 'jobledger: reclaim_stuck_compute_jobs must write a stall_reclaim ledger row carrying the PRE-decrement attempt count and the held claim token, otherwise the record names an attempt that never stalled';
  END IF;

  v_rc_bound_ok :=
        (SELECT count(*) FROM regexp_matches(v_rc_body, 'LIMIT 500', 'g')) = 1
    AND (SELECT count(*) FROM regexp_matches(v_rc_body, 'FOR UPDATE SKIP LOCKED', 'g')) = 1;
  IF NOT v_rc_bound_ok THEN
    RAISE EXCEPTION 'jobledger: reclaim_stuck_compute_jobs must keep LIMIT 500 and FOR UPDATE SKIP LOCKED (M-0781), otherwise one call locks an unbounded backlog and blocks every concurrent claim';
  END IF;

  v_rc_bridge_ok :=
        (SELECT count(*) FROM regexp_matches(v_rc_body, 'pg_advisory_xact_lock\(hashtext\(''mark_compute_job_bridge''\),\s*hashtext\(r_b\.strategy_id::text\)\)', 'g')) = 1
    AND (SELECT count(*) FROM regexp_matches(v_rc_body, 'PERFORM sync_strategy_analytics_status\(r_b\.strategy_id,\s*r_b\.job_id\)', 'g')) = 1;
  IF NOT v_rc_bridge_ok THEN
    RAISE EXCEPTION 'jobledger: reclaim_stuck_compute_jobs must take the mark_compute_job_bridge advisory lock and call sync_strategy_analytics_status with the reclaimed job id as trigger, otherwise a reclaimed strategy keeps its stale status and curated sentence';
  END IF;

  v_rc_group_ok := (SELECT count(*) FROM regexp_matches(v_rc_body, 'GROUP BY cj\.strategy_id,\s*cj\.kind', 'g')) = 1;
  IF NOT v_rc_group_ok THEN
    RAISE EXCEPTION 'jobledger: reclaim_stuck_compute_jobs must make one bridge call per distinct strategy AND kind, otherwise the bridge cannot judge each reclaimed job''s kind itself';
  END IF;

  v_rc_keyless_ok := (SELECT count(*) FROM regexp_matches(v_rc_body, 'cj\.strategy_id IS NOT NULL', 'g')) = 1;
  IF NOT v_rc_keyless_ok THEN
    RAISE EXCEPTION 'jobledger: reclaim_stuck_compute_jobs must skip rows with a NULL strategy_id in its bridge loop, otherwise one stuck key-mode job makes the bridge raise and aborts the whole call';
  END IF;

  v_rc_contract_ok :=
        (SELECT count(*) FROM regexp_matches(v_rc_body, 'attempts\s*=\s*GREATEST\(cj\.attempts\s*-\s*1,\s*0\)', 'g')) = 1
    AND (SELECT count(*) FROM regexp_matches(v_rc_body, 'reclaim_count\s*=\s*cj\.reclaim_count\s*\+\s*1', 'g')) = 1;
  IF NOT v_rc_contract_ok THEN
    RAISE EXCEPTION 'jobledger: reclaim_stuck_compute_jobs must still decrement attempts (mig 109 P2) and bump reclaim_count, otherwise a reclaimed job burns an attempt it never ran or loses its reclaim audit trail';
  END IF;

  v_rc_nokinds_ok := strpos(v_rc_body, 'v_side_kinds') = 0;
  IF NOT v_rc_nokinds_ok THEN
    RAISE EXCEPTION 'jobledger: reclaim_stuck_compute_jobs must not spell the bridge''s side-kind list (v_side_kinds), otherwise two copies of that list drift apart';
  END IF;

  v_rc_acl_ok := NOT has_function_privilege('public', v_rc_oid, 'EXECUTE')
             AND NOT has_function_privilege('anon', v_rc_oid, 'EXECUTE')
             AND NOT has_function_privilege('authenticated', v_rc_oid, 'EXECUTE');
  IF NOT v_rc_acl_ok THEN
    RAISE EXCEPTION 'jobledger: reclaim_stuck_compute_jobs must not be executable by PUBLIC, anon or authenticated, otherwise any caller can reclaim running jobs';
  END IF;

  RAISE NOTICE 'jobledger: reset_stalled_compute_jobs and reclaim_stuck_compute_jobs verified (pinned search_path, integer result, ledger row per pass, LIMIT 500 and SKIP LOCKED kept, one sorted bridge call per strategy and kind, key-mode rows skipped, the 20260516104201 contract kept, no side-kind list, no anon or authenticated EXECUTE).';
END
$verify$;
