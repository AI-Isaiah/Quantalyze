-- Migration: the daily positions poll enqueues only strategies on a venue the poll can serve.
-- Fix for a PROD regression from Phase 227 JOBLEDGER (20261124120500_poll_positions_cohort.sql).
--
-- ⚠️ OPS: merging supabase/migrations/** to main applies this file to shared TEST FIRST
-- (supabase-migrate.yml `apply-test`) and then AUTO-APPLIES it to PROD once that TEST apply
-- succeeds. There is NO human stop between the merge and the PROD apply (founder decision
-- 2026-09-23), so every review this file needs happens BEFORE the merge. It redefines ONE
-- SECURITY DEFINER function, called by the Railway worker's 24 hour enqueue loop.
--
-- ⛔ A FORWARD MIGRATION, NOT AN EDIT TO AN APPLIED ONE. The body re-based here is the one in
-- 20261124120500_poll_positions_cohort.sql (applied on PROD and shared TEST). MEASURED before
-- writing a line: no migration newer than 20261124120500 defines
-- enqueue_poll_positions_for_all_strategies, the committed snapshot
-- supabase/schema/functions/enqueue_poll_positions_for_all_strategies.sql names that file as its
-- source, and PROD's pg_get_functiondef read on 2026-11-25 is that body.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE DEFECT (measured on PROD 2026-11-25)
-- ══════════════════════════════════════════════════════════════════════════
-- Three poll_positions jobs, all for MT5 strategies, ended failed_final after 3 attempts with
-- "'Mt5Session' object has no attribute 'fetch_positions'". Before 2026-11-25 PROD had never
-- enqueued an MT5 poll_positions job. All three strategies are PRIVATE and were admitted by the
-- done-sync_trades side of the cohort (none has a fresh strategy_sync_cursors row).
--
-- Root cause: no version of this cohort has ever filtered by venue. The pre-227 body polled
-- only published and pending_review strategies, and every MT5 strategy on PROD is private, so
-- the missing filter never showed. 20261124120500 added 'private' to the status list, which let
-- MT5 strategies through the job side. Its DEC-06-C argued the widening "adds no strategy the
-- poll cannot serve" for the CURSOR side only (the cursor is written for okx, binance and bybit)
-- and missed that the status widening reaches the job side too.
--
-- run_poll_positions_job (analytics-service/services/job_worker.py) calls
-- services.positions.fetch_positions(exchange_name, ctx.exchange), which calls the ccxt method
-- exchange.fetch_positions() (Bybit adds a raw ccxt endpoint fallback, Deribit has its own
-- normaliser). ctx.exchange comes from _make_exchange_client: an SfoxClient for sfox, an
-- Mt5Session for mt5, and create_exchange (a ccxt class from EXCHANGE_CLASSES in
-- services/exchange.py) for everything else. The handler then upserts the rows through
-- persist_position_snapshots into position_snapshots, whose position_snapshots_exchange_check
-- admits only binance, okx and bybit (read on PROD 2026-11-26). A Deribit row is stamped
-- exchange 'deribit' by _normalize_deribit_position, so a Deribit account holding a position
-- fails that CHECK (23514) and its job ends failed_final the same way the MT5 jobs did. So the
-- venues the poll can serve END TO END are EXCHANGE_CLASSES intersected with that CHECK:
-- binance, bybit and okx. api_keys_exchange_check admits those three plus deribit, sfox and
-- mt5, which are the three this gate shuts out.
--
-- Deribit is left out on purpose, and it is not a lost feature: PROD has no Deribit strategy
-- and has never run a Deribit poll_positions job (read 2026-11-26), and the position_snapshots
-- CHECK is pinned at three venues by src/__tests__/contracts/check-zod-db-check-parity.test.ts
-- until Deribit positions are supported. Admitting Deribit is a forward migration that widens
-- that CHECK and this gate together. analytics-service/tests/test_poll_positions_cohort_venues.py
-- pins this gate to EXCHANGE_CLASSES intersected with that CHECK, so a drift in either fails there.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE DELTA against 20261124120500 (the whole of it)
-- ══════════════════════════════════════════════════════════════════════════
--   1. One top-level cohort conjunct, `ak.exchange IN ('binance', 'bybit', 'okx')`,
--      beside the key-liveness conjuncts, with a comment above it. It sits at the top level and
--      not inside the cursor side of the OR, because the PROD failures came through the job side.
--   2. The function COMMENT names the venue gate.
--   3. The catalogue-only verify block carries this migration's id and one more check (the venue
--      gate is present in the executable text).
--   Every other line is the 20261124120500 body, byte for byte, the dollar-quote tag included,
--   and the REVOKE is restated exactly as there. The ACL on PROD is unchanged
--   ({postgres=X/postgres,service_role=X/postgres}); CREATE OR REPLACE keeps it and grants nothing.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 / DRIFT-02
-- ══════════════════════════════════════════════════════════════════════════
-- One existing body changes, so VAC-04 requires an acknowledgement of PROD's current body.
-- MEASURED 2026-11-25 with the gate's own normalizer aimed at the committed snapshot BEFORE it
-- was regenerated for this file (the snapshot then carried the 20261124120500 body, which is
-- PROD's body as read on 2026-11-25):
--
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/enqueue_poll_positions_for_all_strategies.sql <that snapshot>
--
-- The acked hash is the `live` column (the FIFTH field) of that output:
--
-- prod-body-ack: 0be4c891a557e7ab61c8578244d65c15196e9b0c6ea02723efc72d4223828029
--
-- ⚠️ It is EARNED only if VAC-04 on the PR reports that SAME hash for PROD. If it differs, PROD
-- drifted out of band: fold the difference into this migration, never edit the pragma to match.
--
-- ⛔ Self-verify posture. The block at the foot reads CATALOGUES ONLY. It reads no row and counts
-- nothing, so it cannot pass PROD and refuse on shared TEST, which holds PROD's catalogue and
-- never its data.
--
-- The three failed_final MT5 jobs on PROD are left as they are: a terminal side-kind job does
-- not move strategy_analytics, nothing re-pends a failed_final poll_positions job, and they are
-- the record of this defect.

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
        -- Venue gate (20261126180000): only the venues run_poll_positions_job can serve. That
        -- handler calls the ccxt-style fetch_positions on the client _make_exchange_client
        -- builds, which is a ccxt exchange only for EXCHANGE_CLASSES in
        -- analytics-service/services/exchange.py (mt5 and sfox get non-ccxt clients), and
        -- writes position_snapshots, whose exchange CHECK admits no deribit row.
        AND ak.exchange IN ('binance', 'bybit', 'okx')
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
  'Daily fanout: enqueues a poll_positions job per qualifying strategy. Cohort (phase 227 HEAL-05): published, pending_review or private, through an active and connected key, with a done sync_trades job OR a strategy_sync_cursors row advanced in the last 30 days, on a venue the poll serves end to end (binance, bybit, okx; never deribit, mt5 or sfox). Idempotent via enqueue_compute_job partial unique index. Returns count of newly-enqueued jobs. Called by worker daily loop under advisory lock to prevent multi-replica duplication. See migration 033, 20261124120500 and 20261126180000.';

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
    RAISE EXCEPTION 'Migration 20261126180000: enqueue_poll_positions_for_all_strategies resolves to % functions in schema public, expected exactly 1', v_overloads;
  END IF;

  v_fn := to_regprocedure('public.enqueue_poll_positions_for_all_strategies()');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Migration 20261126180000: public.enqueue_poll_positions_for_all_strategies() takes arguments or is missing';
  END IF;

  SELECT p.prosecdef, p.proconfig, pg_get_function_result(p.oid)
    INTO v_secdef, v_config, v_rettype
    FROM pg_proc p WHERE p.oid = v_fn;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Migration 20261126180000: enqueue_poll_positions_for_all_strategies is not SECURITY DEFINER, so it would read the queue as the caller';
  END IF;
  IF v_rettype IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION 'Migration 20261126180000: enqueue_poll_positions_for_all_strategies returns % but the worker reads an integer count', v_rettype;
  END IF;
  SELECT c INTO v_srchpath
    FROM unnest(COALESCE(v_config, ARRAY[]::text[])) AS c
   WHERE c LIKE 'search_path=%';
  IF v_srchpath IS NULL OR regexp_replace(v_srchpath, '\s', '', 'g') <> 'search_path=public,pg_catalog' THEN
    RAISE EXCEPTION 'Migration 20261126180000: enqueue_poll_positions_for_all_strategies must pin search_path to public, pg_catalog (found %)', v_srchpath;
  END IF;

  -- The EXECUTABLE text, comments stripped, so prose describing a rule cannot satisfy it.
  v_body := regexp_replace(regexp_replace(pg_get_functiondef(v_fn), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  IF v_body NOT LIKE '%''private''%' THEN
    RAISE EXCEPTION 'Migration 20261126180000: the cohort lost the private status, so private strategies never get position snapshots';
  END IF;
  IF v_body LIKE '%''draft''%' THEN
    RAISE EXCEPTION 'Migration 20261126180000: the cohort names the draft status, so unfinished strategies would be polled';
  END IF;
  IF v_body NOT LIKE '%strategy_sync_cursors%' THEN
    RAISE EXCEPTION 'Migration 20261126180000: the cohort no longer reads strategy_sync_cursors, so a strategy kept current by the cron sync alone is never polled';
  END IF;
  IF v_body NOT LIKE '%disconnected_at IS NULL%' THEN
    RAISE EXCEPTION 'Migration 20261126180000: the cohort lost the disconnected key filter, so a revoked connection would still be read daily';
  END IF;
  IF v_body NOT LIKE '%ak.is_active%' THEN
    RAISE EXCEPTION 'Migration 20261126180000: the cohort lost the active key filter, so a deactivated key would still be read daily';
  END IF;
  IF v_body NOT LIKE '%ak.exchange IN (''binance'', ''bybit'', ''okx'')%' THEN
    RAISE EXCEPTION 'Migration 20261126180000: the cohort lost its venue gate, so an mt5, sfox or deribit strategy is enqueued for a poll it cannot complete';
  END IF;
  v_needle := 'interval ''30 days''';
  IF (length(v_body) - length(replace(v_body, v_needle, ''))) / length(v_needle) <> 2 THEN
    RAISE EXCEPTION 'Migration 20261126180000: the cohort does not carry its 30 day window on both sides of the OR (the job side and the cursor side)';
  END IF;
  IF v_body NOT LIKE '%''poll_positions''%' THEN
    RAISE EXCEPTION 'Migration 20261126180000: the body no longer enqueues the poll_positions kind';
  END IF;
  IF v_body NOT LIKE '%''daily-poll-''%' THEN
    RAISE EXCEPTION 'Migration 20261126180000: the body lost the daily idempotency key prefix, so the same day could enqueue a second poll per strategy';
  END IF;

  -- ----- the privilege matrix ---------------------------------------------------
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261126180000: anon or authenticated holds EXECUTE on enqueue_poll_positions_for_all_strategies';
  END IF;
  IF EXISTS (SELECT 1
               FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261126180000: PUBLIC holds EXECUTE on enqueue_poll_positions_for_all_strategies';
  END IF;

  RAISE NOTICE 'Migration 20261126180000: enqueue_poll_positions_for_all_strategies verified from the catalogues';
END
$verify$;

COMMIT;
