-- Test: public.first_hop_enqueue_sweep() — Phase 227 (JOBLEDGER) / plan 05 / HEAL-01.
-- A private strategy whose first sync_trades enqueue dropped is observed by the
-- sweep, waits out a grace of more than 90 minutes, and is then re-enqueued ONCE.
-- A healthy new strategy is never caught, and the named failed state appears only
-- when that retry also ends without a result.
--
-- ⛔ WHICH FILE THE ARMS ACTUALLY MEASURE: every edit-kind RED-UNDER-M twin in this
-- file names supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql, the
-- only migration that defines the function. A twin naming another file would
-- mutate text that is not the live definition and the arm would report `no-red`.
--
-- Arms (LISTED and EXECUTED in this order):
--   H1  dropped first hop — a private strategy with an active connected key and
--       nothing else is observed (no job), still not enqueued after a second call
--       inside the grace, then, once first_seen_at is 91 minutes old, gets exactly
--       ONE sync_trades job with metadata source 'first-hop-sweep' and the
--       observation row stamped. (The tracer arm.)
--
-- Every arm asserts about the rows IT planted, never a global count.
--
-- ⚠️ TIME: the whole file is one transaction, so now() is constant. Elapsed grace
-- is therefore simulated the only way a single transaction can: by back-dating
-- first_seen_at as the owner, never by waiting.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure. No psql meta-commands. The whole test rolls back.
--
-- The final `ALL 1 ARMS EXECUTED (…)` notice at the foot of this file is the
-- sentinel CI's loop reads the arm count off. If you add or remove an arm, update
-- BOTH the integer and the roster on that line.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- `RED-UNDER-M` object that scripts/mutation-runner executes: it mutates COPIES on
-- a throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
--
-- ⚠️ Apply order: 01 is the destructive base, 30 restores strategies.status's
-- NOT NULL/DEFAULT/CHECK (five values, 'private' included), 02/03/12 are the
-- standard stand-in tables (api_keys, trades, strategy_analytics, profiles), the
-- compute_jobs chain follows (with 04 and 29 patching what it creates), then the
-- csv_daily_returns and strategy_keys migrations the candidate predicate reads,
-- then the migration under test LAST.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/30-fixture-strategies-status-default.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/29-fixture-compute-jobs-priority.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260522111839_csv_daily_returns.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql"]}

BEGIN;

DO $$
DECLARE
  v_msg        TEXT;
  v_state      TEXT;
  v_setup      TEXT;
  v_uid        UUID;
  v_key        UUID;
  v_sid        UUID;
  v_res        JSONB;
  v_cnt        INTEGER;
  v_jobs       INTEGER;
  v_obs        INTEGER;
  v_src        TEXT;
  v_re_at      TIMESTAMPTZ;
  v_re_job     UUID;
  v_job_id     UUID;
BEGIN
  -- ===== ARM H1 — a dropped first hop is observed, waits, then is re-enqueued once
  -- ----- H1-SETUP: an owner, an active connected key and a private strategy --
  v_setup := NULL;
  BEGIN
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
    VALUES (v_uid, '00000000-0000-0000-0000-000000000000',
            'first-hop-' || v_uid::text || '@quantalyze.test', now(), now());
    INSERT INTO profiles (id, display_name, email, role)
    VALUES (v_uid, 'first-hop', 'first-hop-' || v_uid::text || '@quantalyze.test', 'manager')
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
    VALUES (v_uid, 'binance', 'first hop key', 'x', TRUE) RETURNING id INTO v_key;
    INSERT INTO strategies (user_id, name, status, api_key_id)
    VALUES (v_uid, 'first-hop H1', 'private', v_key) RETURNING id INTO v_sid;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H1-SETUP): could not seed the owner, the key and the private strategy (%), so the arm would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  -- Confirmed rather than assumed: the arm is about a strategy with NOTHING.
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid OR api_key_id = v_key;
  IF v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H1-SETUP): % compute_jobs row(s) already exist for the seeded strategy, so "the first hop dropped" cannot be asked.', v_jobs;
  END IF;

  -- First call: the strategy is OBSERVED and nothing is enqueued.
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid;
  IF v_obs <> 1 OR v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H1): the first call left % observation row(s) and % job(s) for a dropped-first-hop strategy (expected 1 and 0) — the sweep either cannot see the strategy or enqueued with no grace at all, so a strategy still inside its finalize window would be re-enqueued under the user.', v_obs, v_jobs;
  END IF;
  -- Second call inside the grace: still nothing.
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid;
  IF v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H1): a second call inside the grace window enqueued % job(s), expected 0 — a healthy new strategy whose finalize enqueue is merely slow would be given a second sync.', v_jobs;
  END IF;

  -- Elapse the grace: back-date the observation by 91 minutes, as the owner.
  UPDATE public.first_hop_enqueue_retries
     SET first_seen_at = now() - interval '91 minutes'
   WHERE strategy_id = v_sid;
  v_res := public.first_hop_enqueue_sweep();

  -- RED-UNDER: neuter the re-enqueue's source — `FROM due d` becomes
  --            `FROM due d WHERE FALSE`, so the job INSERT never receives a row.
  --            The observation still ages past the grace, nothing is enqueued
  --            and a first sync that dropped at finalize strands the strategy
  --            forever: it stays `pending` with no job and no one is told.
  -- RED-UNDER-M: {"arm":"H1","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"      FROM due d\n","replace":"      FROM due d WHERE FALSE\n","occurrences":1}]}
  SELECT count(*), max(j.id::text)::uuid, max(j.metadata ->> 'source')
    INTO v_jobs, v_job_id, v_src
    FROM public.compute_jobs j
   WHERE j.strategy_id = v_sid AND j.kind = 'sync_trades';
  IF v_jobs <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (H1): after the grace the sweep left % sync_trades job(s) for the dropped strategy (expected exactly 1) — a dropped first hop strands the strategy forever.', v_jobs;
  END IF;
  IF v_src IS DISTINCT FROM 'first-hop-sweep' THEN
    RAISE EXCEPTION 'TEST FAILED (H1): the re-enqueued job carries metadata source % (expected first-hop-sweep), so the sweep''s work cannot be told from the finalize route''s.', COALESCE(v_src, 'NULL');
  END IF;
  SELECT r.reenqueued_at, r.reenqueued_job_id INTO v_re_at, v_re_job
    FROM public.first_hop_enqueue_retries r WHERE r.strategy_id = v_sid;
  IF v_re_at IS NULL OR v_re_job IS DISTINCT FROM v_job_id THEN
    RAISE EXCEPTION 'TEST FAILED (H1): the observation row reads reenqueued_at % and reenqueued_job_id % (expected set, and equal to job %) — without the stamp the once-only guard is empty and the strategy would be re-enqueued every hour.', COALESCE(v_re_at::text, 'NULL'), COALESCE(v_re_job::text, 'NULL'), v_job_id;
  END IF;
  IF (v_res ->> 'reenqueued')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (H1): the sweep reported reenqueued % in its result (expected 1).', COALESCE(v_res ->> 'reenqueued', 'NULL');
  END IF;

  RAISE NOTICE 'ALL 1 ARMS EXECUTED (H1): public.first_hop_enqueue_sweep() observes a private strategy with an active connected key and no job, waits out the 90-minute grace, then enqueues exactly one sync_trades job marked first-hop-sweep and stamps the observation. Phase 227 / plan 05 / HEAL-01, mig 20261124120400.';
END $$;

ROLLBACK;
