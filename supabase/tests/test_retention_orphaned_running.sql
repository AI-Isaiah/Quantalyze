-- Test: retention_compute_jobs_orphaned_running purge cron (WORKER-04).
--
-- Guards migration
-- 20260719120000_retention_orphaned_running_compute_jobs.sql — the recurring
-- pg_cron job that DELETEs orphaned `running` compute_jobs older than a 2-hour
-- window.
--
-- Why this cron exists (Rule 9 — the WHY, not just the WHAT)
-- ----------------------------------------------------------
-- The `derive-allocator-key-dailies` cron (mig 20260717233529) re-pollutes the
-- WORKERLESS test project daily with `running` compute_jobs (a workerless
-- project never advances them past claim). Those orphaned rows collide with
-- fence-test seeds via the claim RPC's partition-dedupe arms
-- (mig 20260719073701 lines 156-179: the NOT-EXISTS guards keyed on
-- `x.status IN ('running','done_pending_children')`), reddening the `python`
-- fence tests intermittently. The derive cron CANNOT be unscheduled
-- (`test_derive_allocator_keys_fanout.sql` assertion 6 requires it registered),
-- so the only root-cause fix is a retention purge.
--
-- DELETE, never reset-to-pending: a row reset to `pending` is simply re-claimed
-- to `running` by the next CI run and the collision returns. Only removal ends
-- the daily re-pollution.
--
-- The 2-hour window is SAFE on prod: the interactive worker's watchdog
-- (analytics-service/main_worker.py WATCHDOG_PER_KIND_OVERRIDES line 206) caps
-- the max per-kind stale threshold at process_key_long = 40 minutes, so a
-- `running` row older than 2h is definitively orphaned (worker down), never a
-- live in-flight job. The `retention_delete_guard` trigger (mig 121) backstops
-- the DELETE at a 100k-row ceiling.
--
-- Oracle discipline: the behavioral section EXECUTEs the REAL deployed
-- cron.job.command (not a re-typed copy of the predicate) so the test pins the
-- shipped body, not the test author's transcription of it.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION
-- on failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- Test-DB lag: assertions are gated on the cron job being present (NOTICE skip
-- otherwise — RESEARCH Pitfall 6). The migration is MCP-applied to the TEST
-- project in plan 125-03 (BLOCKING there) before this is required green.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_retention_orphaned_running.sql

BEGIN;

DO $$
DECLARE
  v_command    TEXT;
  v_cron_hour  INT;
  uid          UUID := gen_random_uuid();
  key_a        UUID;  -- orphaned running (3h old) — MUST be deleted
  key_b        UUID;  -- fresh running (now)       — MUST survive
  key_c        UUID;  -- non-running done (3h old) — MUST survive
  id_a         UUID;
  id_b         UUID;
  id_c         UUID;
  row_cnt      INTEGER;
BEGIN
  -- ----- PRESENCE GATE 1: pg_cron extension (local dev) ------------------
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'SKIP: pg_cron extension not installed here (local dev). Assertions enforce where pg_cron is present.';
    RETURN;
  END IF;

  -- ----- PRESENCE GATE 2: cron job registered (test-DB lag) --------------
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running'
  ) THEN
    RAISE NOTICE 'SKIP: migration 20260719120000 not yet applied here (retention_compute_jobs_orphaned_running cron absent). Assertions enforce once the test DB catches up.';
    RETURN;
  END IF;

  -- ----- ASSERTION 1: registration + predicate shape --------------------
  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): retention_compute_jobs_orphaned_running cron command is NULL';
  END IF;
  IF v_command NOT ILIKE '%status = ''running''%' THEN
    RAISE EXCEPTION 'TEST FAILED (1): cron body does not scope to status = ''running''. command was: %', v_command;
  END IF;
  IF v_command NOT ILIKE '%interval ''2 hours''%' THEN
    RAISE EXCEPTION 'TEST FAILED (1): cron body does not use the 2-hour window (interval ''2 hours''). command was: %', v_command;
  END IF;
  IF v_command NOT ILIKE '%claimed_at%' THEN
    RAISE EXCEPTION 'TEST FAILED (1): cron body does not reference claimed_at. command was: %', v_command;
  END IF;
  IF v_command NOT ILIKE '%public.compute_jobs%' THEN
    RAISE EXCEPTION 'TEST FAILED (1): cron body is not schema-qualified to public.compute_jobs. command was: %', v_command;
  END IF;

  -- ----- ASSERTION 2: schedule hour in the safe 1-22 band ---------------
  -- Mirrors test_derive_allocator_keys_fanout.sql assertion 6: the minute is
  -- field 1, the hour is field 2 of the cron schedule.
  SELECT (split_part(schedule, ' ', 2))::INT INTO v_cron_hour
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';
  IF v_cron_hour IS NULL OR v_cron_hour < 1 OR v_cron_hour > 22 THEN
    RAISE EXCEPTION 'TEST FAILED (2): purge cron hour must stay in the safe 1-22 band (got %)', v_cron_hour;
  END IF;

  -- ----- SEED: one allocator + three api_keys (distinct keys avoid the ---
  -- compute_jobs_one_inflight_per_kind_api_key partial-unique collision on
  -- the two `running` rows).
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'orphan-purge-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'orphan-purge', 'orphan-purge-' || uid::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'binance', 'orphan a', 'x', TRUE) RETURNING id INTO key_a;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'binance', 'fresh b', 'x', TRUE) RETURNING id INTO key_b;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'binance', 'done c', 'x', TRUE) RETURNING id INTO key_c;

  -- (a) orphaned running, claimed 3h ago → MUST be deleted
  INSERT INTO compute_jobs (api_key_id, kind, status, claimed_at)
  VALUES (key_a, 'derive_broker_dailies', 'running', now() - interval '3 hours')
  RETURNING id INTO id_a;
  -- (b) fresh running, claimed now → MUST survive
  INSERT INTO compute_jobs (api_key_id, kind, status, claimed_at)
  VALUES (key_b, 'derive_broker_dailies', 'running', now())
  RETURNING id INTO id_b;
  -- (c) non-running (done), aged 3h → MUST survive (predicate is status-scoped)
  INSERT INTO compute_jobs (api_key_id, kind, status, created_at, claimed_at)
  VALUES (key_c, 'derive_broker_dailies', 'done', now() - interval '3 hours', now() - interval '3 hours')
  RETURNING id INTO id_c;

  RAISE NOTICE 'Seed OK: orphan_running=% fresh_running=% aged_done=%', id_a, id_b, id_c;

  -- ----- ASSERTION 3: EXECUTE the DEPLOYED cron body (the oracle) --------
  -- Run the REAL stored command, not a re-typed predicate.
  EXECUTE v_command;

  -- (a) orphaned running row is GONE
  SELECT count(*) INTO row_cnt FROM compute_jobs WHERE id = id_a;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (3): orphaned >2h running row survived the purge (count=%), expected 0', row_cnt;
  END IF;
  -- (b) fresh running row SURVIVES (younger than the 2h window)
  SELECT count(*) INTO row_cnt FROM compute_jobs WHERE id = id_b;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (3): fresh running row was deleted (count=%), expected 1 — window too aggressive', row_cnt;
  END IF;
  -- (c) aged non-running row SURVIVES (predicate scoped to status=''running'')
  SELECT count(*) INTO row_cnt FROM compute_jobs WHERE id = id_c;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (3): aged non-running (done) row was deleted (count=%), expected 1 — status scope broken', row_cnt;
  END IF;

  RAISE NOTICE 'All retention_compute_jobs_orphaned_running assertions passed (registration + predicate + safe-hour + DELETE behavior).';

  -- ----- TEARDOWN (belt-and-suspenders; the outer ROLLBACK also discards) -
  DELETE FROM auth.users WHERE id = uid;
END
$$;

ROLLBACK;
