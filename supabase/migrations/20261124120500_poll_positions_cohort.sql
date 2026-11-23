-- Migration: the daily positions poll covers private strategies, and a revoked key
-- stops being polled.
-- Phase 227 JOBLEDGER / plan 06 (requirement HEAL-05, ROADMAP SC-5).
--
-- ⚠️ OPS: merging supabase/migrations/** to main applies this file to shared TEST FIRST
-- (supabase-migrate.yml `apply-test`) and then AUTO-APPLIES it to PROD once that TEST apply
-- succeeds. There is NO human stop between the merge and the PROD apply (founder decision
-- 2026-09-23), so every review this file needs happens BEFORE the merge. It redefines ONE
-- SECURITY DEFINER function, called by the Railway worker's 24 hour enqueue loop, so the new
-- cohort is what the next daily tick enqueues.
--
-- ⛔ IT IS A FORWARD MIGRATION AND NOT AN EDIT TO AN APPLIED ONE. The body being re-based
-- lives in 20260412094449_compute_jobs_admin_and_defer.sql (STEP 4), applied on PROD and on
-- shared TEST, and it stays byte-identical there. MEASURED before writing a line: no
-- migration newer than 20260412094449 defines enqueue_poll_positions_for_all_strategies, and
-- the committed snapshot supabase/schema/functions/enqueue_poll_positions_for_all_strategies.sql
-- names that file as its source.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY THE COHORT CHANGES (RESEARCH Summary point 4 and census (b))
-- ══════════════════════════════════════════════════════════════════════════
-- TODOS FANOUT-COHORT-SIBLING-POLL-01 asked to decide both conjuncts of the cohort together,
-- with a fresh measurement. The status list is the visible exclusion (private is missing),
-- but it is not the real one. The real one is the second conjunct: "has a done sync_trades
-- compute job in the last 30 days". The cron sync path (/cron-sync) stores daily P&L through
-- the sync_trades SQL RPC and then enqueues a strategy-mode derive_broker_dailies job; it
-- never writes a sync_trades COMPUTE JOB. A strategy kept current by /cron-sync alone
-- therefore never satisfies the job conjunct, so widening the status list alone would have
-- enqueued almost nothing. PROD census (b) counted 5 sync_trades jobs in 30 days.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE DECISIONS (plan 06, DEC-06-A to DEC-06-D)
-- ══════════════════════════════════════════════════════════════════════════
-- DEC-06-A  Both conjuncts, decided together.
--   * Status: published, pending_review AND private (a draft or archived strategy stays out).
--   * Key health: a done sync_trades job in the last 30 days, OR a strategy_sync_cursors row
--     for the strategy whose last_sync_at is inside the last 30 days. The noun is "a
--     successful sync of this strategy's key in the last 30 days". The cursor advances only on
--     a non-degraded fetch (analytics-service/routers/cron.py), so it means the key worked.
--   * ADD-ALONGSIDE, NOT A REPLACEMENT. The user triggered sync path still writes a compute
--     job and not the cursor, so replacing the job side would drop strategies that path keeps
--     current. ACCEPTED DEBT: promote the cohort to the cursor alone once every sync path
--     writes it.
-- DEC-06-B  Key liveness. The cohort now requires the key to be active and not disconnected.
--   Today's cohort polls a disconnected key that synced inside the window. The new cohort is a
--   superset of today's except for those keys, which a revoked connection must stop reading.
-- DEC-06-C  Venues. The cursor is written only for the venues /cron-sync syncs (DAILY_PNL_VENUES
--   in analytics-service/services/exchange.py: okx, binance, bybit), which are exactly the
--   venues fetch_positions supports (analytics-service/services/positions.py). The widening
--   adds no strategy the poll cannot serve. The job side keeps its old reach unchanged.
-- DEC-06-D  Nothing else moves. The loop body, the in-flight pre-count, the enqueue call, its
--   idempotency key and metadata, the return value and the worker's argument-less call are
--   all unchanged, which is what keeps the enqueue live.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE DELTA against 20260412094449 (the whole of it)
-- ══════════════════════════════════════════════════════════════════════════
--   1. The status list gains the owner-only contribution status.
--   2. Two key-liveness conjuncts are added (active, not disconnected).
--   3. The done-job EXISTS becomes one side of an OR whose other side reads the per-strategy
--      sync cursor.
--   4. A comment fence around that change, and this header.
--   5. Outside the body: the function COMMENT is rewritten to describe the new cohort, the
--      ACL is restated as a REVOKE (a no-op on PROD, where it already holds; the lane has no
--      earlier definition to carry it), and a catalogue-only block verifies the result.
--   Every other line is the old body, byte for byte, the dollar-quote tag included.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 / DRIFT-02
-- ══════════════════════════════════════════════════════════════════════════
-- One existing body changes, so VAC-04 requires an acknowledgement of PROD's current body.
-- MEASURED 2026-11-24 with the gate's own normalizer aimed at the committed snapshot BEFORE it
-- was regenerated for this file (the snapshot then carried the 20260412094449 body and stands
-- in for PROD):
--
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/enqueue_poll_positions_for_all_strategies.sql <that snapshot>
--
-- The acked hash is the `live` column (the FIFTH field) of that output, never `--hash` of a
-- file:
--
-- prod-body-ack: afed2d9685797bd77864e2078497de45b2c61b55361e93742bfba7ac6b678b73
--
-- ⚠️ THE ACK IS OF THE COMMITTED SNAPSHOT, WHICH STANDS IN FOR PROD. It is EARNED only if
-- VAC-04 on the PR reports that SAME hash for PROD. If it differs, PROD drifted out of band:
-- fold the difference into this migration and re-derive, never edit the pragma to match a
-- gate log.
--
-- ⛔ Self-verify posture. Everything in the block at the foot reads CATALOGUES ONLY. It reads
-- no row and counts nothing. Shared TEST holds PROD's catalogue and never its data, and a
-- refused TEST apply blocks the PROD apply, so a data-dependent assertion could pass PROD and
-- refuse TEST.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: the function
-- ==========================================================================
CREATE OR REPLACE FUNCTION enqueue_poll_positions_for_all_strategies()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_strategy_id UUID;
  v_exchange TEXT;
  v_enqueued INTEGER := 0;
  v_job_id UUID;
  v_existing_count INTEGER;
BEGIN
  FOR v_strategy_id, v_exchange IN
    SELECT DISTINCT s.id, ak.exchange
      FROM strategies s
      JOIN api_keys ak ON ak.id = s.api_key_id
      WHERE s.api_key_id IS NOT NULL
        -- HEAL-05 (phase 227): the cohort. Private strategies are polled too, through a live
        -- key only, and "the key still works" is read from either sync path: a done
        -- sync_trades job (the user triggered path) or the per-strategy cursor the cron
        -- path writes. See the migration header, DEC-06-A and DEC-06-B.
        AND s.status IN ('published', 'pending_review', 'private')
        AND ak.is_active
        AND ak.disconnected_at IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM compute_jobs cj
              WHERE cj.strategy_id = s.id
                AND cj.kind = 'sync_trades'
                AND cj.status = 'done'
                AND cj.updated_at > (now() - interval '30 days')
          )
          OR EXISTS (
            SELECT 1 FROM strategy_sync_cursors ssc
              WHERE ssc.strategy_id = s.id
                AND ssc.last_sync_at > (now() - interval '30 days')
          )
        )
  LOOP
    -- Count pre-existing in-flight poll_positions jobs for this strategy
    -- BEFORE the enqueue call, so we can detect whether enqueue_compute_job
    -- returned an existing id (no new row) vs created a new one.
    SELECT count(*) INTO v_existing_count
      FROM compute_jobs
      WHERE strategy_id = v_strategy_id
        AND kind = 'poll_positions'
        AND status IN ('pending', 'running', 'done_pending_children');

    v_job_id := enqueue_compute_job(
      v_strategy_id,
      'poll_positions',
      'daily-poll-' || to_char(now(), 'YYYY-MM-DD') || '-' || v_strategy_id::text,
      '{}'::UUID[],
      v_exchange,
      jsonb_build_object('enqueued_by', 'daily_loop', 'enqueued_at', now())
    );

    IF v_existing_count = 0 AND v_job_id IS NOT NULL THEN
      v_enqueued := v_enqueued + 1;
    END IF;
  END LOOP;

  RETURN v_enqueued;
END;
$$;

COMMENT ON FUNCTION enqueue_poll_positions_for_all_strategies IS
  'Daily fanout: enqueues a poll_positions job per qualifying strategy. Cohort (phase 227 HEAL-05): published, pending_review or private, through an active and connected key, with a done sync_trades job OR a strategy_sync_cursors row advanced in the last 30 days. Idempotent via enqueue_compute_job partial unique index. Returns count of newly-enqueued jobs. Called by worker daily loop under advisory lock to prevent multi-replica duplication. See migration 033 and 20261124120500.';

-- ==========================================================================
-- STEP 2: ACL, restated
-- ==========================================================================
-- CREATE OR REPLACE keeps the ACL a function already carries, and on PROD and shared TEST this
-- REVOKE is a no-op because 20260412094449 issued it. It is restated because Supabase's default
-- privileges grant EXECUTE on a new function to anon and authenticated, so a database that had
-- no earlier definition would otherwise end up with the daily fan-out callable by a browser
-- role. Nothing is granted here.
REVOKE ALL ON FUNCTION enqueue_poll_positions_for_all_strategies FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- STEP 3: self-verifying DO block (catalogue only)
-- ==========================================================================
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip. Asserts SHAPE, never behaviour and
-- never data; behaviour is covered by supabase/tests/test_enqueue_poll_positions_cohort.sql.
DO $verify$
DECLARE
  -- Every variable is DECLAREd up front: plpgsql compiles a DO block whole.
  v_overloads integer;
  v_fn        oid;
  v_secdef    boolean;
  v_config    text[];
  v_srchpath  text;
  v_rettype   text;
  v_body      text;
  v_needle    text;
BEGIN
  SELECT count(*) INTO v_overloads
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enqueue_poll_positions_for_all_strategies';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'Migration 20261124120500: enqueue_poll_positions_for_all_strategies resolves to % functions in schema public, expected exactly 1', v_overloads;
  END IF;

  v_fn := to_regprocedure('public.enqueue_poll_positions_for_all_strategies()');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Migration 20261124120500: public.enqueue_poll_positions_for_all_strategies() takes arguments or is missing';
  END IF;

  SELECT p.prosecdef, p.proconfig, pg_get_function_result(p.oid)
    INTO v_secdef, v_config, v_rettype
    FROM pg_proc p WHERE p.oid = v_fn;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Migration 20261124120500: enqueue_poll_positions_for_all_strategies is not SECURITY DEFINER, so it would read the queue as the caller';
  END IF;
  IF v_rettype IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION 'Migration 20261124120500: enqueue_poll_positions_for_all_strategies returns % but the worker reads an integer count', v_rettype;
  END IF;
  SELECT c INTO v_srchpath
    FROM unnest(COALESCE(v_config, ARRAY[]::text[])) AS c
   WHERE c LIKE 'search_path=%';
  IF v_srchpath IS NULL OR regexp_replace(v_srchpath, '\s', '', 'g') <> 'search_path=public,pg_catalog' THEN
    RAISE EXCEPTION 'Migration 20261124120500: enqueue_poll_positions_for_all_strategies must pin search_path to public, pg_catalog (found %)', v_srchpath;
  END IF;

  -- The EXECUTABLE text, comments stripped, so prose describing a rule cannot satisfy it.
  v_body := regexp_replace(regexp_replace(pg_get_functiondef(v_fn), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  IF v_body NOT LIKE '%''private''%' THEN
    RAISE EXCEPTION 'Migration 20261124120500: the cohort lost the private status, so private strategies never get position snapshots';
  END IF;
  IF v_body LIKE '%''draft''%' THEN
    RAISE EXCEPTION 'Migration 20261124120500: the cohort names the draft status, so unfinished strategies would be polled';
  END IF;
  IF v_body NOT LIKE '%strategy_sync_cursors%' THEN
    RAISE EXCEPTION 'Migration 20261124120500: the cohort no longer reads strategy_sync_cursors, so a strategy kept current by the cron sync alone is never polled';
  END IF;
  IF v_body NOT LIKE '%disconnected_at IS NULL%' THEN
    RAISE EXCEPTION 'Migration 20261124120500: the cohort lost the disconnected key filter, so a revoked connection would still be read daily';
  END IF;
  IF v_body NOT LIKE '%ak.is_active%' THEN
    RAISE EXCEPTION 'Migration 20261124120500: the cohort lost the active key filter, so a deactivated key would still be read daily';
  END IF;
  v_needle := 'interval ''30 days''';
  IF (length(v_body) - length(replace(v_body, v_needle, ''))) / length(v_needle) <> 2 THEN
    RAISE EXCEPTION 'Migration 20261124120500: the cohort does not carry its 30 day window on both sides of the OR (the job side and the cursor side)';
  END IF;
  IF v_body NOT LIKE '%''poll_positions''%' THEN
    RAISE EXCEPTION 'Migration 20261124120500: the body no longer enqueues the poll_positions kind';
  END IF;
  IF v_body NOT LIKE '%''daily-poll-''%' THEN
    RAISE EXCEPTION 'Migration 20261124120500: the body lost the daily idempotency key prefix, so the same day could enqueue a second poll per strategy';
  END IF;

  -- ----- the privilege matrix ---------------------------------------------------
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261124120500: anon or authenticated holds EXECUTE on enqueue_poll_positions_for_all_strategies';
  END IF;
  IF EXISTS (SELECT 1
               FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261124120500: PUBLIC holds EXECUTE on enqueue_poll_positions_for_all_strategies';
  END IF;

  RAISE NOTICE 'Migration 20261124120500: enqueue_poll_positions_for_all_strategies verified from the catalogues';
END
$verify$;

COMMIT;
