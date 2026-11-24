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
-- Arms (LISTED in the order they were designed; EXECUTED in the order of the
-- sentinel at the foot of this file, which differs on purpose: H6b runs right
-- after H1b and H10a before H7, because under their twins those positive arms
-- would otherwise be the first failure and the identity would name the wrong arm):
--   H1   dropped first hop — a private strategy with an active connected key and
--        nothing else is observed (no job on the first call), and once
--        first_seen_at is 91 minutes old gets exactly ONE sync_trades job with
--        metadata source 'first-hop-sweep' and the observation stamped. (Tracer.)
--   H1b  the grace — the observation is not acted on inside the window: two calls
--        in a row enqueue nothing. Split out of H1 so the grace has a twin of its
--        own (H1's pre-grace asserts would otherwise fire first under it).
--   H2   named state — the re-enqueued job ends failed_final and there is no
--        analytics row: the next call writes status failed, the exact sentence,
--        NULL provenance markers, and stamps named_state_at.
--   H3   a 'pending' analytics row is admitted and becomes the named state.
--   H4   a retry the bridge already turned into its own failed row is KEPT.
--   H5   the retry still queued or running: no named state.
--   H6   once only — the retry job is gone and the strategy has the candidate
--        shape again: the sweep never inserts a second job.
--   H6b  the once-only observation row is never deleted by the sweep. Asserts the
--        ROW survives, and nothing about a second job (that is H6's question, and
--        asking it here would make H6's own twin fail H6b first).
--   H7   late first hop — the strategy's own sync_trades job appears: the
--        observation is deleted and nothing is enqueued.
--   H8   status look-alikes never observed: draft, pending_review, archived.
--   H9   no key on the strategy (its owner has an active key) never observed.
--   H10a a strategy-scoped job of another kind: never observed.
--   H10b a key-scoped job on the strategy's key that is IN FLIGHT (pending):
--        never observed.
--   H10c a poll_allocator_positions job on the strategy's key is NOT a first hop:
--        still observed and re-enqueued.
--   H10d a FINISHED (done) derive_broker_dailies job on the strategy's key is NOT
--        a first hop either: still observed and re-enqueued. The 00:40 UTC cron
--        `derive-allocator-key-dailies` leaves one on every active connected key.
--   H11  a deactivated key: never observed.
--   H12  a disconnected key: never observed.
--   H13a a trades row  H13b a csv_daily_returns row  H13c a strategy_keys row
--   H13d a 'complete' analytics row: each never observed.
--   H14  EXECUTE on the function is held by the owner alone.
--   H14b the table is SELECT-only for service_role, nothing for anon/authenticated.
--
-- Every arm asserts about the rows IT planted, never a global count: the sweep is
-- global, so earlier arms' strategies are still in the tables.
--
-- ⚠️ TIME: the whole file is one transaction, so now() is constant. Elapsed grace
-- is therefore simulated the only way a single transaction can: by back-dating
-- first_seen_at as the owner, never by waiting.
--
-- ⚠️ THE JOB-STATE UPDATES BELOW ARE FIXTURE STAGING, NOT A CLAIM ABOUT THE
-- WORKER: failed_final stands for "the retry ended without a result".
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure. No psql meta-commands. The whole test rolls back.
--
-- The final `ALL 23 ARMS EXECUTED (…)` notice at the foot of this file is the
-- sentinel CI's loop reads the arm count off. If you add or remove an arm, update
-- BOTH the integer and the roster on that line.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- `RED-UNDER-M` object that scripts/mutation-runner executes: it mutates COPIES on
-- a throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md. A twin that
-- removes a token the migration's own self-verify block requires ALSO neuters that
-- check, or the apply would abort and no arm could be the first failure.
--
-- ⚠️ Apply order: 01 is the destructive base, 30 restores strategies.status's
-- NOT NULL/DEFAULT/CHECK (five values, 'private' included), 02/03/07/11/12/15/20/
-- 21/24/27 are the standard stand-ins (api_keys and its columns, trades,
-- strategy_analytics with its computation_error column, profiles, the app-role
-- helpers), the compute_jobs chain follows (04, 29 and 37 patch what it creates;
-- 20260717233529 with its two prerequisites widens compute_jobs' target CHECK so
-- a key-scoped job can be planted), then the
-- csv_daily_returns and strategy_keys migrations the candidate predicate reads, the sync-status chain through
-- 20260906120000 (which adds the two provenance columns the named state writes),
-- and the migration under test LAST.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/30-fixture-strategies-status-default.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/29-fixture-compute-jobs-priority.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260522111839_csv_daily_returns.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql"]}

BEGIN;

-- pg_temp helpers live and die with this transaction and carry no arm.
-- hf_seed: one owner, one key (always created, so a strategy WITHOUT a key can
-- still have an owner who HAS one), one strategy.
CREATE FUNCTION pg_temp.hf_seed(p_status text, p_has_key boolean, p_active boolean, p_disconnected boolean,
                                OUT o_sid uuid, OUT o_key uuid, OUT o_uid uuid)
LANGUAGE plpgsql AS $f$
BEGIN
  o_uid := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (o_uid, '00000000-0000-0000-0000-000000000000',
          'first-hop-' || o_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (o_uid, 'first-hop', 'first-hop-' || o_uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, disconnected_at)
  VALUES (o_uid, 'binance', 'first hop key', 'x', p_active,
          CASE WHEN p_disconnected THEN now() ELSE NULL END)
  RETURNING id INTO o_key;
  INSERT INTO strategies (user_id, name, status, api_key_id)
  VALUES (o_uid, 'first-hop strategy', p_status, CASE WHEN p_has_key THEN o_key ELSE NULL END)
  RETURNING id INTO o_sid;
END
$f$;

-- hf_retry: run the sweep (observe), age the observation by 91 minutes, run it
-- again (re-enqueue), and return the sync_trades job id the sweep inserted
-- (NULL when it inserted none).
CREATE FUNCTION pg_temp.hf_retry(p_sid uuid) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_job uuid;
BEGIN
  PERFORM public.first_hop_enqueue_sweep();
  UPDATE public.first_hop_enqueue_retries
     SET first_seen_at = now() - interval '91 minutes'
   WHERE strategy_id = p_sid AND reenqueued_at IS NULL;
  PERFORM public.first_hop_enqueue_sweep();
  SELECT j.id INTO v_job FROM public.compute_jobs j
   WHERE j.strategy_id = p_sid AND j.kind = 'sync_trades'
     AND j.metadata ->> 'source' = 'first-hop-sweep'
   ORDER BY j.created_at DESC LIMIT 1;
  RETURN v_job;
END
$f$;

DO $$
DECLARE
  v_msg        TEXT;
  v_state      TEXT;
  v_setup      TEXT;
  v_uid        UUID;
  v_key        UUID;
  v_sid        UUID;
  v_job        UUID;
  v_job2       UUID;
  v_res        JSONB;
  v_cnt        INTEGER;
  v_jobs       INTEGER;
  v_obs        INTEGER;
  v_src        TEXT;
  v_re_at      TIMESTAMPTZ;
  v_re_job     UUID;
  v_named_at   TIMESTAMPTZ;
  v_an_status  TEXT;
  v_an_error   TEXT;
  v_an_source  TEXT;
  v_an_job     UUID;
  v_status     TEXT;
  v_owner      TEXT;
  v_grantees   TEXT;
  v_acl        TEXT;
  c_sentence   CONSTANT TEXT := 'Analytics has not started for this strategy: its first sync was never queued, and the automatic retry did not complete. Retry the sync, or contact support if this persists.';
  c_curated    CONSTANT TEXT := 'The exchange rejected the request for this key.';
BEGIN
  -- ===== ARM H1 — a dropped first hop is observed, waits, then is re-enqueued once
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H1-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
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
    RAISE EXCEPTION 'TEST FAILED (H1): the first call left % observation row(s) and % job(s) for a dropped-first-hop strategy (expected 1 and 0) — the sweep either cannot see the strategy or enqueued with no grace at all.', v_obs, v_jobs;
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
    INTO v_jobs, v_job, v_src
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
  IF v_re_at IS NULL OR v_re_job IS DISTINCT FROM v_job THEN
    RAISE EXCEPTION 'TEST FAILED (H1): the observation row reads reenqueued_at % and reenqueued_job_id % (expected set, and equal to job %) — without the stamp the once-only guard is empty and the strategy would be re-enqueued every hour.', COALESCE(v_re_at::text, 'NULL'), COALESCE(v_re_job::text, 'NULL'), v_job;
  END IF;
  IF (v_res ->> 'reenqueued')::int IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (H1): the sweep reported reenqueued % in its result (expected 1).', COALESCE(v_res ->> 'reenqueued', 'NULL');
  END IF;

  -- ===== ARM H1b — inside the grace nothing is enqueued ======================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H1b-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_res := public.first_hop_enqueue_sweep();
  v_res := public.first_hop_enqueue_sweep();
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid;

  -- RED-UNDER: collapse the grace — `interval '90 minutes'` becomes
  --            `interval '-10 minutes'`, so an observation counts as aged the
  --            moment it exists. A strategy whose finalize enqueue is merely slow
  --            is given a SECOND sync under the user, against the founder's
  --            ruling of a grace longer than one hour. The self-verify's own
  --            grace anchor is neutered in the same mutation, or the apply
  --            would abort.
  -- RED-UNDER-M: {"arm":"H1b","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"AND r.first_seen_at < now() - interval '90 minutes'","replace":"AND r.first_seen_at < now() - interval '-10 minutes'","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"IF position('interval ''90 minutes''' IN v_body) = 0 THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_obs <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (H1b): % observation row(s) for a dropped-first-hop strategy (expected 1) — the grace arm cannot be asked of a strategy the sweep does not see.', v_obs;
  END IF;
  IF v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H1b): three calls inside the grace window enqueued % job(s), expected 0 — a healthy new strategy whose finalize enqueue is merely slow would be given a second sync.', v_jobs;
  END IF;

  -- ===== ARM H6b — the once-only row is never deleted ==========================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H6b-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_job := pg_temp.hf_retry(v_sid);
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H6b-SETUP): the sweep did not re-enqueue the seeded strategy, so the arm cannot ask whether the observation survives it.';
  END IF;
  -- The strategy now HAS a job, so it no longer matches the candidate predicate:
  -- exactly the situation in which a sloppy clear would delete the row.
  v_res := public.first_hop_enqueue_sweep();
  SELECT r.reenqueued_at INTO v_re_at FROM public.first_hop_enqueue_retries r WHERE r.strategy_id = v_sid;
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;

  -- RED-UNDER: drop the restriction from the clear — its
  --            `WHERE r.reenqueued_at IS NULL` becomes `WHERE TRUE`. The moment
  --            the retry exists the strategy stops being a candidate, the clear
  --            deletes the stamped row, and the once-only guard is gone with it:
  --            a later empty shape is observed as new and re-enqueued again.
  -- RED-UNDER-M: {"arm":"H6b","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"     WHERE r.reenqueued_at IS NULL\n       AND NOT EXISTS (SELECT 1 FROM cand c","replace":"     WHERE TRUE\n       AND NOT EXISTS (SELECT 1 FROM cand c","occurrences":1}]}
  IF v_obs <> 1 OR v_re_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H6b): after a further sweep the stamped observation has % row(s) with reenqueued_at % (expected 1 and set) — the sweep deleted the once-only guard.', v_obs, COALESCE(v_re_at::text, 'NULL');
  END IF;

  -- ===== ARM H2 — the retry also failed, no analytics row ⇒ the named state ===
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H2-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_job := pg_temp.hf_retry(v_sid);
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H2-SETUP): the sweep did not re-enqueue the seeded strategy, so the arm cannot ask what happens when the retry fails.';
  END IF;
  UPDATE public.compute_jobs SET status = 'failed_final', last_error = 'first sync refused' WHERE id = v_job;
  v_res := public.first_hop_enqueue_sweep();
  SELECT a.computation_status, a.computation_error, a.computation_error_source, a.computation_error_job_id
    INTO v_an_status, v_an_error, v_an_source, v_an_job
    FROM public.strategy_analytics a WHERE a.strategy_id = v_sid;
  SELECT r.named_state_at INTO v_named_at FROM public.first_hop_enqueue_retries r WHERE r.strategy_id = v_sid;

  -- RED-UNDER: change the sentence — `the automatic retry did not complete`
  --            becomes `the automatic retry completed`. The user is then told,
  --            in the one place this state is ever shown, that a retry which
  --            failed had succeeded.
  -- RED-UNDER-M: {"arm":"H2","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"its first sync was never queued, and the automatic retry did not complete","replace":"its first sync was never queued, and the automatic retry completed","occurrences":1}]}
  IF v_an_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (H2): after the retry ended failed_final the strategy''s analytics status reads % (expected failed) — a strategy whose sync never ran would stay pending forever with no word to its owner.', COALESCE(v_an_status, 'NULL (no row)');
  END IF;
  IF v_an_error IS DISTINCT FROM c_sentence THEN
    RAISE EXCEPTION 'TEST FAILED (H2): the named state carries computation_error [%], expected the fixed sentence [%].', COALESCE(v_an_error, 'NULL'), c_sentence;
  END IF;
  IF v_an_source IS NOT NULL OR v_an_job IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H2): the named state carries provenance markers (source %, job %), expected NULL for both — a marker would claim a writer stamped a sentence only the sweep wrote.', COALESCE(v_an_source, 'NULL'), COALESCE(v_an_job::text, 'NULL');
  END IF;
  IF v_named_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H2): named_state_at is NULL after the named state was written, so the next hourly tick would write it again.';
  END IF;

  -- ===== ARM H3 — a pending analytics row is the named state ================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
    INSERT INTO public.strategy_analytics (strategy_id, computation_status) VALUES (v_sid, 'pending');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H3-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_job := pg_temp.hf_retry(v_sid);
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H3-SETUP): a strategy with a pending analytics row was not re-enqueued, so the arm cannot ask what happens when that retry fails.';
  END IF;
  UPDATE public.compute_jobs SET status = 'failed_final', last_error = 'first sync refused' WHERE id = v_job;
  v_res := public.first_hop_enqueue_sweep();
  SELECT a.computation_status, a.computation_error, a.computation_error_source, a.computation_error_job_id
    INTO v_an_status, v_an_error, v_an_source, v_an_job
    FROM public.strategy_analytics a WHERE a.strategy_id = v_sid;
  SELECT count(*) INTO v_cnt FROM public.strategy_analytics WHERE strategy_id = v_sid;

  -- RED-UNDER: stop admitting a pending row — the named-state admission test
  --            `san.computation_status <> 'pending'` becomes
  --            `san.computation_status IS NOT NULL`, so ANY row blocks it. The
  --            finalize that threw leaves exactly a pending row, so the strategy
  --            it describes is the one that never gets the named state.
  -- RED-UNDER-M: {"arm":"H3","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"AND san.computation_status <> 'pending'","replace":"AND san.computation_status IS NOT NULL","occurrences":1}]}
  IF v_an_status IS DISTINCT FROM 'failed' OR v_an_error IS DISTINCT FROM c_sentence THEN
    RAISE EXCEPTION 'TEST FAILED (H3): a pending analytics row reads status % and error [%] after the retry failed (expected failed and the fixed sentence) — the strategy a dropped finalize leaves behind is exactly this one.', COALESCE(v_an_status, 'NULL'), COALESCE(v_an_error, 'NULL');
  END IF;
  IF v_an_source IS NOT NULL OR v_an_job IS NOT NULL OR v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (H3): the named state left markers (source %, job %) or % analytics row(s) (expected NULL, NULL and exactly 1).', COALESCE(v_an_source, 'NULL'), COALESCE(v_an_job::text, 'NULL'), v_cnt;
  END IF;

  -- ===== ARM H4 — a bridge-written failed row is kept ========================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H4-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_job := pg_temp.hf_retry(v_sid);
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H4-SETUP): the sweep did not re-enqueue the seeded strategy, so the arm cannot ask what happens when the bridge already wrote a failed row.';
  END IF;
  UPDATE public.compute_jobs SET status = 'failed_final', last_error = 'first sync refused' WHERE id = v_job;
  INSERT INTO public.strategy_analytics (strategy_id, computation_status, computation_error)
  VALUES (v_sid, 'failed', c_curated);
  v_res := public.first_hop_enqueue_sweep();
  SELECT a.computation_status, a.computation_error INTO v_an_status, v_an_error
    FROM public.strategy_analytics a WHERE a.strategy_id = v_sid;
  SELECT r.named_state_at INTO v_named_at FROM public.first_hop_enqueue_retries r WHERE r.strategy_id = v_sid;

  -- RED-UNDER: remove BOTH layers that protect a failed row — the admission
  --            test `san.computation_status <> 'pending'` is made to block
  --            nothing, and the DO UPDATE's WHERE clause becomes `WHERE TRUE`.
  --            The two are redundant by design, so one alone shows nothing; with
  --            both gone the bridge's curated, per-kind sentence is overwritten
  --            by generic copy that names the wrong cause. The self-verify's
  --            pending-row anchor is neutered in the same mutation.
  -- RED-UNDER-M: {"arm":"H4","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"AND san.computation_status <> 'pending'","replace":"AND san.computation_status = 'zz-never'","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"     WHERE strategy_analytics.computation_status = 'pending'\n    RETURNING strategy_id","replace":"     WHERE TRUE\n    RETURNING strategy_id","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"IF position('computation_status = ''pending''' IN v_body) = 0 THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_an_status IS DISTINCT FROM 'failed' OR v_an_error IS DISTINCT FROM c_curated THEN
    RAISE EXCEPTION 'TEST FAILED (H4): the bridge''s failed row now reads status % and error [%] (expected failed and [%] untouched) — the sweep overwrote a curated cause with generic copy.', COALESCE(v_an_status, 'NULL'), COALESCE(v_an_error, 'NULL'), c_curated;
  END IF;
  IF v_named_at IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H4): named_state_at is set (%) although the sweep wrote nothing, so the observation claims a state the user never saw.', v_named_at;
  END IF;

  -- ===== ARM H5 — the retry is still in flight ⇒ no named state ================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H5-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_job := pg_temp.hf_retry(v_sid);
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H5-SETUP): the sweep did not re-enqueue the seeded strategy, so the arm cannot ask what happens while the retry is queued.';
  END IF;
  -- RED-UNDER: drop the in-flight test — `cjn.status <> 'failed_final'` is made
  --            to match nothing, so a strategy whose retry is merely queued or
  --            running reads as "the retry failed" the moment it has any
  --            failed_final job beside it. A healthy new strategy would be
  --            shown failed while its first sync is still on its way.
  --            (This arm's own job is queued, so the neutered guard needs a
  --            failed_final sibling to show it: the arm plants one.)
  -- RED-UNDER-M: {"arm":"H5","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"AND cjn.status <> 'failed_final'","replace":"AND cjn.status = 'zz-never'","occurrences":1}]}
  -- A failed_final job beside the queued retry is what makes the guard matter:
  -- without the in-flight test, "has a failed_final job" alone would name the
  -- state.
  INSERT INTO public.compute_jobs (strategy_id, kind, status, last_error)
  VALUES (v_sid, 'compute_analytics_from_csv', 'failed_final', 'an earlier unrelated failure');
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_cnt FROM public.strategy_analytics WHERE strategy_id = v_sid;
  SELECT r.named_state_at INTO v_named_at FROM public.first_hop_enqueue_retries r WHERE r.strategy_id = v_sid;
  IF v_cnt <> 0 OR v_named_at IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H5): while the re-enqueued job is still queued the strategy has % analytics row(s) and named_state_at % (expected 0 and NULL) — a healthy new strategy was shown failed while its first sync is still on its way.', v_cnt, COALESCE(v_named_at::text, 'NULL');
  END IF;
  -- And the running state, the other in-flight status.
  UPDATE public.compute_jobs SET status = 'running', claimed_at = now(), claimed_by = 'first-hop-gate' WHERE id = v_job;
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_cnt FROM public.strategy_analytics WHERE strategy_id = v_sid;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H5): while the re-enqueued job is running the strategy has % analytics row(s) (expected 0).', v_cnt;
  END IF;

  -- ===== ARM H6 — once only: no second job, ever ===============================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H6-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_job := pg_temp.hf_retry(v_sid);
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H6-SETUP): the sweep did not re-enqueue the seeded strategy, so the arm cannot ask whether it does so twice.';
  END IF;
  -- The retry ran and is gone (done, then pruned): the strategy has the
  -- candidate shape again.
  UPDATE public.compute_jobs SET status = 'done' WHERE id = v_job;
  DELETE FROM public.compute_jobs WHERE id = v_job;
  UPDATE public.first_hop_enqueue_retries SET first_seen_at = now() - interval '300 minutes' WHERE strategy_id = v_sid;
  v_res := public.first_hop_enqueue_sweep();
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid;

  -- RED-UNDER: drop the once-only test from the re-enqueue — its
  --            `WHERE r.reenqueued_at IS NULL` becomes `WHERE TRUE`. A strategy
  --            whose retry is gone but whose observation is stamped is then
  --            re-enqueued again on every tick, hammering one exchange key
  --            forever: the unbounded loop this ledger exists to prevent.
  -- RED-UNDER-M: {"arm":"H6","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"     WHERE r.reenqueued_at IS NULL\n       AND r.first_seen_at <","replace":"     WHERE TRUE\n       AND r.first_seen_at <","occurrences":1}]}
  IF v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H6): after its retry was removed the strategy has % job(s) from two further sweeps (expected 0) — a bad key would be tried against the exchange every hour.', v_jobs;
  END IF;

  -- ===== ARM H10a — a strategy-scoped job of another kind ====================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
    INSERT INTO public.compute_jobs (strategy_id, kind) VALUES (v_sid, 'compute_analytics_from_csv');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H10a-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid AND metadata ->> 'source' = 'first-hop-sweep';

  -- RED-UNDER: drop the strategy leg of the job test — `WHERE cj.strategy_id =
  --            s.id OR (cj.api_key_id = s.api_key_id AND ...)` becomes `WHERE
  --            FALSE OR (cj.api_key_id = ...)`. A strategy with ANY job of its own
  --            (a process_key_long first hop, a preview chain) is then a
  --            candidate and is given a sync_trades it never needed.
  -- RED-UNDER-M: {"arm":"H10a","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"WHERE cj.strategy_id = s.id","replace":"WHERE FALSE","occurrences":1}]}
  IF v_obs <> 0 OR v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H10a): a strategy that already has its own job was observed (% observation row(s), % sweep job(s), expected 0 and 0).', v_obs, v_jobs;
  END IF;

  -- ===== ARM H7 — a late first hop clears the observation ======================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H7-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
  IF v_obs <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (H7-SETUP): the strategy was not observed (% row(s)), so the arm cannot ask what happens when its first hop arrives late.', v_obs;
  END IF;
  -- The finalize route's own enqueue finally lands.
  INSERT INTO public.compute_jobs (strategy_id, kind, metadata)
  VALUES (v_sid, 'sync_trades', jsonb_build_object('source', 'finalize-wizard'));
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid;

  -- RED-UNDER: disable the clear — its `AND NOT EXISTS (SELECT 1 FROM cand ...)`
  --            becomes `AND FALSE`. The observation of a strategy that turned out
  --            healthy then sits in the ledger for good, a standing candidate
  --            for the day its job rows are pruned.
  -- RED-UNDER-M: {"arm":"H7","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"AND NOT EXISTS (SELECT 1 FROM cand c WHERE c.id = r.strategy_id)","replace":"AND FALSE","occurrences":1}]}
  IF v_obs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H7): the observation of a strategy whose own first sync arrived late is still in the ledger (% row(s), expected 0).', v_obs;
  END IF;
  IF v_jobs <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (H7): the strategy has % job(s) after its late first hop (expected exactly the 1 the finalize route enqueued) — the sweep enqueued a second sync.', v_jobs;
  END IF;

  -- ===== ARM H8 — status look-alikes are never observed =========================
  -- RED-UNDER: widen the status test — `s.status = 'private'` becomes
  --            `s.status IN ('private', 'draft')`. A wizard still in progress is
  --            then a candidate: the sweep would sync a strategy whose owner has
  --            not finished choosing what to submit.
  -- RED-UNDER-M: {"arm":"H8","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"s.status = 'private'","replace":"s.status IN ('private', 'draft')","occurrences":1}]}
  FOREACH v_status IN ARRAY ARRAY['draft', 'pending_review', 'archived'] LOOP
    v_setup := NULL;
    BEGIN
      SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed(v_status, true, true, false);
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
      v_setup := v_state || ' ' || v_msg;
    END;
    IF v_setup IS NOT NULL THEN
      RAISE EXCEPTION 'TEST FAILED (H8-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
    END IF;
    v_res := public.first_hop_enqueue_sweep();
    SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
    IF v_obs <> 0 THEN
      RAISE EXCEPTION 'TEST FAILED (H8): a strategy in status % was observed (% row(s), expected 0) — a draft is a wizard in progress, a pending_review strategy is first-hopped by process_key_long, and an archived one is retired; re-enqueueing sync_trades for any of them is wrong.', v_status, v_obs;
    END IF;
  END LOOP;

  -- ===== ARM H9 — no key on the strategy ====================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', false, true, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H9-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid AND metadata ->> 'source' = 'first-hop-sweep';

  -- RED-UNDER: join the key through the OWNER instead of the strategy —
  --            `WHERE ak.id = s.api_key_id` becomes `WHERE ak.user_id = s.user_id`.
  --            A strategy with no key of its own (a CSV strategy) whose owner
  --            happens to hold an active key is then a candidate, and the sweep
  --            enqueues an exchange sync that has no key to run against.
  -- RED-UNDER-M: {"arm":"H9","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"WHERE ak.id = s.api_key_id","replace":"WHERE ak.user_id = s.user_id","occurrences":1}]}
  IF v_obs <> 0 OR v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H9): a private strategy with no api_key_id of its own was observed (its owner holds an active key, which must not count) (% observation row(s), % sweep job(s), expected 0 and 0).', v_obs, v_jobs;
  END IF;

  -- ===== ARM H10b — a key-scoped job on the strategy's key ====================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
    INSERT INTO public.compute_jobs (api_key_id, kind) VALUES (v_key, 'derive_broker_dailies');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H10b-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid AND metadata ->> 'source' = 'first-hop-sweep';

  -- RED-UNDER: drop the key leg of the job test — `WHERE cj.strategy_id =
  --            s.id OR (cj.api_key_id = s.api_key_id AND ...)` becomes `WHERE
  --            cj.strategy_id = s.id OR (FALSE AND ...)`. A key whose own derive is already running
  --            (key-scoped, no strategy_id) is then ignored, and the sweep stacks
  --            a sync on a key that is mid-flight.
  -- RED-UNDER-M: {"arm":"H10b","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"OR (cj.api_key_id = s.api_key_id","replace":"OR (FALSE AND cj.api_key_id = s.api_key_id","occurrences":1}]}
  IF v_obs <> 0 OR v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H10b): a strategy whose key already has an in-flight key-scoped job was observed (% observation row(s), % sweep job(s), expected 0 and 0).', v_obs, v_jobs;
  END IF;

  -- ===== ARM H10c — an allocator-book job on the strategy's key is NOT a first hop
  -- cron `poll-allocator-positions` enqueues a key-scoped poll_allocator_positions
  -- job daily for every active connected key. Such a job is a holdings poll of the
  -- key, not a sync of the strategy, so the strategy must still be a candidate:
  -- observed, and re-enqueued once after the grace. Only poll_allocator_positions
  -- is planted: the lane's kind registry does not carry the other two allocator-book
  -- kinds, and the cron job enqueues this one.
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
    INSERT INTO public.compute_jobs (api_key_id, kind) VALUES (v_key, 'poll_allocator_positions');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H10c-SETUP): could not seed the arm''s strategy with a poll_allocator_positions job on its key (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_job := pg_temp.hf_retry(v_sid);
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;

  -- RED-UNDER: stop excluding the daily allocator poll from the key leg —
  --            the literal 'poll_allocator_positions' in the NOT IN list
  --            becomes 'zz-never'. Every key the 01:00 UTC fan-out has touched
  --            then hides its strategy from the sweep for good, which is the
  --            cohort HEAL-01 exists for.
  -- RED-UNDER-M: {"arm":"H10c","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"AND cj.kind NOT IN ('poll_allocator_positions',","replace":"AND cj.kind NOT IN ('zz-never',","occurrences":1}]}
  IF v_obs <> 1 OR v_job IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H10c): a strategy whose key carries a poll_allocator_positions job was not observed and re-enqueued (% observation row(s), retry job %, expected 1 and a job id) — an allocator-book job on the key hides the strategy from the first-hop sweep.', v_obs, v_job;
  END IF;

  -- ===== ARM H10d — a FINISHED key-scoped derive on the strategy's key is NOT a first hop
  -- cron `derive-allocator-key-dailies` (00:40 UTC) enqueues a key-scoped
  -- derive_broker_dailies job daily for every active connected key, and done rows
  -- live for 30 days. A finished derive is history of the key, not a sync of the
  -- strategy, so the strategy must still be a candidate: observed, and re-enqueued
  -- once after the grace. H10b keeps the other half: the same job while it is
  -- PENDING (in flight) still excludes. The job is staged `done` by an UPDATE, the
  -- way the arms above stage their terminal states (fixture staging, not a claim
  -- about the worker).
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
    INSERT INTO public.compute_jobs (api_key_id, kind) VALUES (v_key, 'derive_broker_dailies');
    UPDATE public.compute_jobs SET status = 'done' WHERE api_key_id = v_key AND kind = 'derive_broker_dailies';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H10d-SETUP): could not seed the arm''s strategy with a done derive_broker_dailies job on its key (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.compute_jobs WHERE api_key_id = v_key AND status = 'done';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (H10d-SETUP): % done job(s) on the arm''s key, expected exactly 1, so "a finished derive on the key" was not staged.', v_cnt;
  END IF;
  v_job := pg_temp.hf_retry(v_sid);
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;

  -- RED-UNDER: count a key-scoped job in ANY status again — the in-flight status
  --            conjunct `cj.status IN ('pending', 'running',
  --            'done_pending_children', 'failed_retry')` becomes `cj.status IS NOT
  --            NULL`. Every key the 00:40 UTC fan-out has touched then hides its
  --            strategy from the sweep for 30 days, and a tick inside a fresh
  --            key's grace clears its observation for good: the cohort HEAL-01
  --            exists for.
  -- RED-UNDER-M: {"arm":"H10d","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"AND cj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')","replace":"AND cj.status IS NOT NULL","occurrences":1}]}
  IF v_obs <> 1 OR v_job IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H10d): a strategy whose key carries only a FINISHED derive_broker_dailies job was not observed and re-enqueued (% observation row(s), retry job %, expected 1 and a job id) — the daily key-scoped derive fan-out hides the strategy from the first-hop sweep.', v_obs, v_job;
  END IF;

  -- ===== ARM H11 — a deactivated key ====================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, false, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H11-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid AND metadata ->> 'source' = 'first-hop-sweep';

  -- RED-UNDER: drop the active-key test — the `AND ak.is_active` conjunct is
  --            deleted (and the self-verify's matching anchor neutered). A key the
  --            user has turned off is then synced anyway, acting on a connection
  --            the user withdrew.
  -- RED-UNDER-M: {"arm":"H11","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"                AND ak.is_active\n                AND ak.disconnected_at","replace":"                AND ak.disconnected_at","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"IF position('is_active' IN v_body) = 0 THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_obs <> 0 OR v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H11): a strategy whose key is deactivated was observed (% observation row(s), % sweep job(s), expected 0 and 0).', v_obs, v_jobs;
  END IF;

  -- ===== ARM H12 — a disconnected key ====================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, true);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H12-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid AND metadata ->> 'source' = 'first-hop-sweep';

  -- RED-UNDER: drop the disconnected test — the `AND ak.disconnected_at IS NULL`
  --            conjunct is deleted (and the self-verify's matching anchor
  --            neutered). A key the user disconnected is then synced anyway: a
  --            revoked connection is the user withdrawing access, and the sweep
  --            would act against it.
  -- RED-UNDER-M: {"arm":"H12","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"                AND ak.is_active\n                AND ak.disconnected_at IS NULL\n","replace":"                AND ak.is_active\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"IF position('disconnected_at IS NULL' IN v_body) = 0 THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_obs <> 0 OR v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H12): a strategy whose key is disconnected was observed (% observation row(s), % sweep job(s), expected 0 and 0).', v_obs, v_jobs;
  END IF;

  -- ===== ARM H13a — a stored trades row ====================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
    -- The real trades table (local-stack lane) has NOT NULL exchange, symbol, side, price,
    -- quantity and timestamp; the pg-lane fixture table has none of them. plpgsql plans each
    -- statement only when it runs, so the branch not taken never touches a missing column.
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'trades' AND column_name = 'exchange') THEN
      INSERT INTO public.trades (strategy_id, exchange, symbol, side, price, quantity, "timestamp")
      VALUES (v_sid, 'binance', 'BTC/USDT', 'buy', 1, 1, now());
    ELSE
      INSERT INTO public.trades (strategy_id) VALUES (v_sid);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H13a-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid AND metadata ->> 'source' = 'first-hop-sweep';

  -- RED-UNDER: delete the trades conjunct. A strategy that already synced fills
  --            (and whose job rows were pruned) is then read as "never synced"
  --            and is synced again.
  -- RED-UNDER-M: {"arm":"H13a","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"       AND NOT EXISTS (SELECT 1 FROM public.trades t WHERE t.strategy_id = s.id)\n","replace":"","occurrences":1}]}
  IF v_obs <> 0 OR v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H13a): a strategy with a stored trades row was observed (% observation row(s), % sweep job(s), expected 0 and 0).', v_obs, v_jobs;
  END IF;

  -- ===== ARM H13b — a csv_daily_returns row ====================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
    INSERT INTO public.csv_daily_returns (strategy_id, date, daily_return) VALUES (v_sid, current_date, 0.01);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H13b-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid AND metadata ->> 'source' = 'first-hop-sweep';

  -- RED-UNDER: delete the csv_daily_returns conjunct. A strategy that carries a
  --            stored daily-return series is then read as "never synced".
  -- RED-UNDER-M: {"arm":"H13b","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"       AND NOT EXISTS (SELECT 1 FROM public.csv_daily_returns d WHERE d.strategy_id = s.id)\n","replace":"","occurrences":1}]}
  IF v_obs <> 0 OR v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H13b): a strategy with stored daily returns was observed (% observation row(s), % sweep job(s), expected 0 and 0).', v_obs, v_jobs;
  END IF;

  -- ===== ARM H13c — a strategy_keys member ====================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
    INSERT INTO public.strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq) VALUES (v_sid, v_key, v_uid, current_date - 30, 0);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H13c-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid AND metadata ->> 'source' = 'first-hop-sweep';

  -- RED-UNDER: delete the strategy_keys conjunct. A composite member (its keys
  --            live in strategy_keys) is then a candidate for a single-key sync.
  -- RED-UNDER-M: {"arm":"H13c","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"       AND NOT EXISTS (SELECT 1 FROM public.strategy_keys sk WHERE sk.strategy_id = s.id)\n","replace":"","occurrences":1}]}
  IF v_obs <> 0 OR v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H13c): a strategy with a strategy_keys member was observed (% observation row(s), % sweep job(s), expected 0 and 0).', v_obs, v_jobs;
  END IF;

  -- ===== ARM H13d — a complete analytics row ====================
  v_setup := NULL;
  BEGIN
    SELECT o_sid, o_key, o_uid INTO v_sid, v_key, v_uid FROM pg_temp.hf_seed('private', true, true, false);
    INSERT INTO public.strategy_analytics (strategy_id, computation_status) VALUES (v_sid, 'complete');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (H13d-SETUP): could not seed the arm''s strategy (%), so it would be asking its question of a strategy that never existed.', v_setup;
  END IF;
  v_res := public.first_hop_enqueue_sweep();
  SELECT count(*) INTO v_obs FROM public.first_hop_enqueue_retries WHERE strategy_id = v_sid;
  SELECT count(*) INTO v_jobs FROM public.compute_jobs WHERE strategy_id = v_sid AND metadata ->> 'source' = 'first-hop-sweep';

  -- RED-UNDER: stop a non-pending analytics row from blocking — the candidate's
  --            `sa.computation_status <> 'pending'` becomes
  --            `sa.computation_status = 'zz-never'`. A strategy whose analytics
  --            are already computed is then read as never synced and synced again.
  -- RED-UNDER-M: {"arm":"H13d","apply":[{"kind":"edit","file":"supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql","find":"AND sa.computation_status <> 'pending'","replace":"AND sa.computation_status = 'zz-never'","occurrences":1}]}
  IF v_obs <> 0 OR v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H13d): a strategy with a complete analytics row was observed (% observation row(s), % sweep job(s), expected 0 and 0).', v_obs, v_jobs;
  END IF;

  -- ===== ARM H14 — EXECUTE on the function is held by the owner alone ==========
  SELECT g.owner_name, string_agg(g.grantee_name, ',' ORDER BY g.grantee_name)
    INTO v_owner, v_grantees
    FROM (
      SELECT pg_get_userbyid(p.proowner) AS owner_name,
             CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee_name
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
       WHERE n.nspname = 'public'
         AND p.proname = 'first_hop_enqueue_sweep'
         AND p.pronargs = 0
         AND a.privilege_type = 'EXECUTE'
    ) g
   GROUP BY g.owner_name;

  -- RED-UNDER: hand the privilege back on the live lane. A `sql` step and NOT an
  --            edit of the migration's REVOKE line, because that file's own
  --            verify block asserts this very set: an edit weakening the REVOKE
  --            would ABORT the apply and no arm could be the first failure.
  --            service_role is the grantee the default ACL hands every new public
  --            function and the one a leaked project key becomes.
  -- RED-UNDER-M: {"arm":"H14","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.first_hop_enqueue_sweep() TO service_role"}]}
  IF v_grantees IS NULL OR v_grantees IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'TEST FAILED (H14): EXECUTE on first_hop_enqueue_sweep is held by [%], expected exactly the owner [%]. The sweep inserts compute jobs and writes a user-visible failed status as its DEFINER, so every extra grantee can force both on demand.', COALESCE(v_grantees, 'NULL'), COALESCE(v_owner, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'first_hop_enqueue_sweep' AND p.pronargs = 0
     AND p.prosecdef
     AND EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_catalog');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (H14): first_hop_enqueue_sweep is not SECURITY DEFINER with search_path pinned to public, pg_catalog — an unpinned path on a SECURITY DEFINER body is a privilege-escalation route.';
  END IF;

  -- ===== ARM H14b — the ledger is SELECT-only for service_role ==================
  SELECT string_agg(
           (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END) || ':' || a.privilege_type,
           ',' ORDER BY (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END), a.privilege_type)
    INTO v_acl
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
   WHERE c.oid = 'public.first_hop_enqueue_retries'::regclass
     AND (a.grantee = 0
          OR a.grantee IN (SELECT r.oid FROM pg_roles r WHERE r.rolname IN ('anon', 'authenticated', 'service_role')));

  -- RED-UNDER: grant a write privilege on the live lane — a `sql` step, for the
  --            same reason as H14 (the migration's own verify asserts this set).
  --            A role that can write the ledger can clear reenqueued_at and
  --            re-arm the re-enqueue against a key already tried once.
  -- RED-UNDER-M: {"arm":"H14b","apply":[{"kind":"sql","stmt":"GRANT INSERT ON public.first_hop_enqueue_retries TO service_role"}]}
  IF v_acl IS DISTINCT FROM 'service_role:SELECT' THEN
    RAISE EXCEPTION 'TEST FAILED (H14b): the ledger ACL for PUBLIC, anon, authenticated and service_role is [%], expected exactly [service_role:SELECT] — a writer beyond the owner can re-arm the once-only guard.', COALESCE(v_acl, 'none');
  END IF;
  SELECT count(*) INTO v_cnt FROM pg_policy p WHERE p.polrelid = 'public.first_hop_enqueue_retries'::regclass;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H14b): the ledger carries % row security policy(ies), expected none.', v_cnt;
  END IF;

  RAISE NOTICE 'ALL 23 ARMS EXECUTED (H1,H1b,H6b,H2,H3,H4,H5,H6,H10a,H7,H8,H9,H10b,H10c,H10d,H11,H12,H13a,H13b,H13c,H13d,H14,H14b): public.first_hop_enqueue_sweep() observes a private strategy with an active connected key and no job, trade, daily-return, member or non-pending analytics row (H1); waits out the 90-minute grace (H1b); writes the named failed state with the fixed sentence and NULL markers only when the retry ended failed_final with no analytics row (H2) or a pending one (H3), keeps a bridge-written failed row (H4), never names a state while the retry is queued or running (H5); re-enqueues once and never deletes the once-only observation (H6, H6b); forgets a strategy whose first hop arrived late (H7); never observes a draft, pending_review or archived strategy (H8), one with no key (H9), a job of its own (H10a), an in-flight key-scoped derive on its key (H10b), a deactivated key (H11), a disconnected key (H12), stored trades, daily returns, a strategy_keys member or a complete analytics row (H13a-d); still observes a strategy whose key carries only an allocator-book job (H10c) or only a finished derive (H10d); and EXECUTE and the ledger ACL are held as designed (H14, H14b). Phase 227 / plan 05 / HEAL-01, mig 20261124120400.';
END $$;

ROLLBACK;
