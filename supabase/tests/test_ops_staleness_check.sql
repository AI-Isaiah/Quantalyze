-- Test: public.ops_staleness_check() — Phase 164.6.8 (OUTAGEALERT) / plan 02.
-- The reader that pages on a stale cron_sync heartbeat and on a stalled backfill
-- queue, through the existing /api/prober-cadence-alert route. It posts when a
-- source is stale, stays silent when both are healthy, and writes ONE observer
-- row per call either way.
--
-- ⛔ WHICH FILE THE ARMS ACTUALLY MEASURE: every edit-kind RED-UNDER-M twin in
-- this file names supabase/migrations/20261020120000_ops_staleness_check.sql,
-- the only migration that defines the function. A twin naming any other file
-- would mutate text that is not the live definition and the arm would report
-- `no-red`.
--
-- Arms (LISTED and EXECUTED in this order; every arm resets the seed rows it
-- planted before it plants its own, by id, so the order is for the reader, not
-- a dependency — EXCEPT that S1 plants the Vault key, the allocator and the api
-- keys every later arm uses, and that S10 re-points the settings url and puts it
-- back before S11 needs it):
--   S1  never ran       — no cron_sync row at all: ONE post, cause never_ran,
--                         gap_minutes null, observer row `error`.
--   S2  heartbeat stale — the newest cron_sync row is 2 days + 1 minute old: ONE
--                         post to the settings url plus the alert route, with a
--                         non-blank X-Service-Key, cron_name cron_sync, cause
--                         heartbeat_stale, gap 2881. (The tracer arm.)
--   S3  healthy         — newest row 1 day old, status ok: ZERO posts, return 0,
--                         observer row `ok` with null causes.
--   S4  two errors      — the two newest rows are both `error`, the newest FRESH:
--                         ONE post, cause two_consecutive_errors (D-11).
--   S5  one error       — newest `error`, previous `ok` (an older `error` behind
--                         it): ZERO posts. One error is not two (D-11).
--   S6  queue stalled   — an eligible pending backfill job waited past the
--                         ceiling and nothing was ever claimed: ONE post, cron_name
--                         backfill, cause backfill_queue_stalled, gap null.
--   S7  alive worker    — the same queue but another backfill job was claimed 5
--                         minutes ago: ZERO posts.
--   S8  running stuck   — a running backfill job claimed 32 minutes ago (past the
--                         ceiling plus one watchdog tick): ONE post, cause
--                         backfill_running_stuck.
--   S12 within the tick — a running backfill job claimed 30 minutes 30 seconds
--                         ago (past the ceiling, inside the extra watchdog tick):
--                         ZERO posts. The watchdog has not had its tick yet.
--   S9  other kinds     — a poll_allocator_positions job waiting for hours: ZERO
--                         posts. The backfill arm reads backfill kinds only.
--   S10 foreign url     — with the destination CHECK constraint dropped and a
--                         foreign host stored, a stale arm REFUSES by name,
--                         posts nothing and leaves no observer row (the RAISE
--                         rolled the INSERT back). Restores the url afterwards.
--   S13 no echo         — S10's refusal message must not contain the stored url.
--   S11 both stale      — both arms stale at once: TWO posts (cron_sync and
--                         backfill), return value 2.
--   G1  grants          — catalogue read: SECURITY DEFINER, search_path pinned,
--                         EXECUTE held by the owner alone. Runs last.
-- (The plan listed S1-S11 and G1; S12 and S13 are additions, so the arm count is
-- 14, not 12. S12 pins the watchdog-tick slack on a running job, which no other
-- arm could, and S13 keeps the no-echo property from sharing S10's identity.)
--
-- Every refusal arm also asserts ZERO new net._lane_posts rows, so a refusal that
-- still posts is caught. Every arm asserts about the rows IT planted and the
-- observer row IT caused (rows not in the pre-call id snapshot), never a global
-- count.
--
-- ⚠️ WHY EVERY IDENTITY CARRIES A DIGIT — `S2`, never a bare letter.
-- `sectionOfIdentity` in scripts/mutation-runner/run.mjs collapses a trailing
-- `-SUFFIX` into its parent section only when a digit precedes it, so
-- `S1-SETUP` is a sub-arm of `S1` and is covered by S1's own twin (likewise
-- `S6-SETUP`, `S10-SETUP`). The setup guards are vacuity guards ("the fixture
-- reached the state this arm is about"), not claims about the migration, so they
-- carry no twin of their own.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- The final `ALL 14 ARMS EXECUTED (…)` notice at the foot of this file is the
-- sentinel CI's loop reads the arm count off. If you add or remove an arm,
-- update BOTH the integer and the roster on that line.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- `RED-UNDER-M` object that scripts/mutation-runner executes on every push: it
-- mutates COPIES on a throwaway pg-lane cluster, requires the FIRST
-- `TEST FAILED (…)` to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md. Every twin is a single mutation of the
-- function body that no EARLIER arm can see, so the arm it names is the first
-- failure.
--
-- ⚠️ Apply order: 01/02/07/12/15 are the standard base (core schema, sanitize
-- tables, Supabase bootstrap defaults, profiles.is_admin, auth.role()). 03/11/20/
-- 21/24 plus the compute_jobs migration chain (and fixture 04, which PATCHES the
-- table that chain creates, so it follows it) are the list the allocator
-- fan-out gates use to get a real `compute_jobs` with every kind the backfill
-- reader names. 32 is the Vault stand-in and 34 the pg_net stand-in (without
-- them the function dies on a raw 42P01 / 3F000 naming no arm). 33 is the
-- cron_runs stand-in. 20260907120000 and 20260911120000 seed system_settings'
-- allow-listed analytics_service_url. The reader migration is applied LAST.
-- LANE-ONLY: {"object":"net._lane_posts","fixture":"scripts/pg-lane/fixtures/34-fixture-pg-net-stand-in.sql","job":"sql-mutation","reason":"Every arm in this file asserts against the pg-net stand-in that fixture 34's own header marks as never applied to TEST or PROD; shared TEST carries the real pg_net, so a version of this gate made to run there would issue genuine outbound HTTP from shared CI infrastructure on every run; this file's arms execute and are mutation-checked twin-by-twin on the pg-lane under sql-mutation."}
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/32-fixture-vault-stand-in.sql","scripts/pg-lane/fixtures/33-fixture-cron-runs.sql","scripts/pg-lane/fixtures/34-fixture-pg-net-stand-in.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql","supabase/migrations/20260911120000_vault_tick_hardening.sql","supabase/migrations/20261020120000_ops_staleness_check.sql"]}

BEGIN;

DO $$
DECLARE
  v_msg        TEXT;
  v_state      TEXT;
  v_setup      TEXT;
  v_raised     BOOLEAN;
  v_ret        BIGINT;
  v_cnt        INTEGER;
  v_url        TEXT;
  v_orig_url   TEXT;
  v_key        TEXT;
  v_body       JSONB;
  v_names      TEXT[];
  v_id         UUID;
  -- The allocator and the api keys the backfill-kind jobs hang off (planted
  -- once, in S1). A derive_broker_dailies job is api_key-scoped, a
  -- derive_allocator_equity job is allocator-scoped, and a
  -- poll_allocator_positions job is api_key-scoped: one in-flight job per
  -- (target, kind), so every arm below deletes its jobs before the next plants.
  v_uid        UUID;
  v_key_a      UUID;
  v_key_b      UUID;
  -- The rows each arm planted, deleted by id at the start of the next arm.
  v_seed_cr    UUID[] := ARRAY[]::UUID[];
  v_seed_cj    UUID[] := ARRAY[]::UUID[];
  -- The observer-row read: the ids that existed BEFORE the call, so the arm
  -- asserts about the row ITS call wrote.
  v_obs_before UUID[];
  v_obs_n      INTEGER;
  v_obs_status TEXT;
  v_obs_error  TEXT;
  v_obs_meta   JSONB;
  -- Arm G1's whole-grantee-set read. Declared here with everything else:
  -- plpgsql compiles a DO block WHOLE, so a missing DECLARE raises 42601 and NO
  -- arm in this file runs.
  v_owner      TEXT;
  v_grantees   TEXT;
BEGIN
  -- ===== ARM S1 — NO cron_sync row ever ⇒ ONE post, never_ran ===============
  -- ----- S1-SETUP: a usable key, an allocator and two api keys --------------
  v_setup := NULL;
  BEGIN
    PERFORM vault.create_secret('arm-fixture-key-not-real', 'analytics_service_key', 'phase 164.6.8 gate fixture');
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
    VALUES (v_uid, '00000000-0000-0000-0000-000000000000',
            'ops-stale-' || v_uid::text || '@quantalyze.test', now(), now());
    INSERT INTO profiles (id, display_name, email, role)
    VALUES (v_uid, 'ops-stale', 'ops-stale-' || v_uid::text || '@quantalyze.test', 'allocator')
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
    VALUES (v_uid, 'binance', 'ops stale a', 'x', TRUE) RETURNING id INTO v_key_a;
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
    VALUES (v_uid, 'binance', 'ops stale b', 'x', TRUE) RETURNING id INTO v_key_b;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (S1-SETUP): could not seed the Vault key, the allocator and the api keys (%), so every arm below would be asking its question of a database that could never have resolved a key or planted a job.', v_setup;
  END IF;

  -- The destination is seeded by 20260907120000 (an allow-listed .up.railway.app
  -- host). Confirmed rather than assumed: an absent row would make every arm
  -- measure the url guard instead of the post.
  SELECT s.value INTO v_url FROM public.system_settings s WHERE s.key = 'analytics_service_url';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE EXCEPTION 'TEST FAILED (S1-SETUP): public.system_settings has no analytics_service_url row — 20260907120000''s seed did not land, so every arm below cannot reach net.http_post at all.';
  END IF;

  -- Nothing planted: the lane is private to this run, so no cron_sync row and
  -- no compute_jobs row exists. Confirmed, because "never ran" is a claim about
  -- an EMPTY heartbeat table and a leftover row would turn S1 into S2.
  SELECT count(*) INTO v_cnt FROM public.cron_runs WHERE cron_name = 'cron_sync';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (S1-SETUP): % cron_sync row(s) exist before the first arm planted anything, so "the sync never ran" cannot be asked.', v_cnt;
  END IF;
  DELETE FROM net._lane_posts;
  SELECT COALESCE(array_agg(r.id), ARRAY[]::UUID[]) INTO v_obs_before
    FROM public.cron_runs r WHERE r.cron_name = 'ops_staleness_check';

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.ops_staleness_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: drop the never-ran leg — `IF v_cs_last IS NULL THEN` becomes
  --            `IF FALSE THEN`. With no row, `v_cs_last` is NULL, the staleness
  --            comparison against NULL yields NULL (treated as FALSE by every
  --            plpgsql IF) and the reader reports a sync that has NEVER run as
  --            healthy: the loudest possible signal read as the quietest.
  -- RED-UNDER-M: {"arm":"S1","apply":[{"kind":"edit","file":"supabase/migrations/20261020120000_ops_staleness_check.sql","find":"IF v_cs_last IS NULL THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (S1): ops_staleness_check() RAISED with a usable key and an allow-listed url: %. It should have posted, not raised.', COALESCE(v_msg, 'NULL');
  END IF;
  IF v_ret IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (S1): with no cron_sync row at all ops_staleness_check() returned % (expected exactly 1 post queued) — a daily sync that has never run reached no human.', COALESCE(v_ret::text, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (S1): % outbound post(s) were recorded, expected EXACTLY 1.', v_cnt;
  END IF;
  SELECT p.body INTO v_body FROM net._lane_posts p ORDER BY p.id DESC LIMIT 1;
  IF v_body ->> 'cron_name' IS DISTINCT FROM 'cron_sync' OR v_body ->> 'cause' IS DISTINCT FROM 'never_ran' THEN
    RAISE EXCEPTION 'TEST FAILED (S1): the recorded post''s body is %, expected cron_name cron_sync and cause never_ran.', COALESCE(v_body::text, 'NULL');
  END IF;
  IF jsonb_typeof(v_body -> 'gap_minutes') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'TEST FAILED (S1): the recorded post''s gap_minutes is %, expected JSON null (a sync that never ran has no gap to report; inventing a number would read as a measurement).', COALESCE((v_body -> 'gap_minutes')::text, 'NULL');
  END IF;
  SELECT count(*) INTO v_obs_n FROM public.cron_runs r
   WHERE r.cron_name = 'ops_staleness_check' AND r.id <> ALL (v_obs_before);
  SELECT r.status, r.error, r.metadata INTO v_obs_status, v_obs_error, v_obs_meta
    FROM public.cron_runs r
   WHERE r.cron_name = 'ops_staleness_check' AND r.id <> ALL (v_obs_before) LIMIT 1;
  IF v_obs_n <> 1 OR v_obs_status IS DISTINCT FROM 'error' OR v_obs_meta ->> 'cron_sync_cause' IS DISTINCT FROM 'never_ran' THEN
    RAISE EXCEPTION 'TEST FAILED (S1): the call wrote % observer row(s) with status % and cron_sync_cause %, expected exactly 1 with status error and cause never_ran.', v_obs_n, COALESCE(v_obs_status, 'NULL'), COALESCE(v_obs_meta ->> 'cron_sync_cause', 'NULL');
  END IF;

  -- ===== ARM S2 — a heartbeat older than 2 days ⇒ ONE post, heartbeat_stale ==
  DELETE FROM public.compute_jobs WHERE id = ANY (v_seed_cj);
  DELETE FROM public.cron_runs WHERE id = ANY (v_seed_cr);
  v_seed_cj := ARRAY[]::UUID[];
  v_seed_cr := ARRAY[]::UUID[];
  -- One cron_sync heartbeat, 2 days and 1 minute old, status ok. Backfill side:
  -- no compute_jobs row is planted, so that arm is healthy by construction.
  INSERT INTO public.cron_runs (cron_name, started_at, completed_at, status)
  VALUES ('cron_sync', now() - interval '2 days 1 minute', now() - interval '2 days 1 minute', 'ok')
  RETURNING id INTO v_id;
  v_seed_cr := v_seed_cr || v_id;
  DELETE FROM net._lane_posts;
  SELECT COALESCE(array_agg(r.id), ARRAY[]::UUID[]) INTO v_obs_before
    FROM public.cron_runs r WHERE r.cron_name = 'ops_staleness_check';

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.ops_staleness_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: widen the cron_sync ceiling — the constant `2 days` becomes
  --            `20 days`. A heartbeat 2 days and a minute old is then "fresh",
  --            the reader returns 0 and posts nothing, and the daily trade sync
  --            can sit dead for 20 days with every other signal green — the
  --            outage this phase exists to end.
  -- RED-UNDER-M: {"arm":"S2","apply":[{"kind":"edit","file":"supabase/migrations/20261020120000_ops_staleness_check.sql","find":"c_cron_sync_ceiling CONSTANT INTERVAL := '2 days';","replace":"c_cron_sync_ceiling CONSTANT INTERVAL := '20 days';","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (S2): ops_staleness_check() RAISED with a usable key, an allow-listed url and a stale heartbeat: %. It should have posted, not raised.', COALESCE(v_msg, 'NULL');
  END IF;
  IF v_ret IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (S2): a heartbeat 2 days and 1 minute old made ops_staleness_check() return % (expected exactly 1 post queued) — a sync that has not run for longer than its ceiling reached no human.', COALESCE(v_ret::text, 'NULL');
  END IF;

  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (S2): one stale heartbeat produced % outbound post(s) to net.http_post, expected EXACTLY 1.', v_cnt;
  END IF;

  SELECT p.url, p.headers ->> 'X-Service-Key', p.body
    INTO v_url, v_key, v_body
    FROM net._lane_posts p ORDER BY p.id DESC LIMIT 1;

  -- The whole url, not a suffix: the host must be the settings row's and the
  -- path must be exactly the existing alert route.
  IF v_url IS DISTINCT FROM (SELECT s.value FROM public.system_settings s WHERE s.key = 'analytics_service_url') || '/api/prober-cadence-alert' THEN
    RAISE EXCEPTION 'TEST FAILED (S2): the recorded post''s url is %, expected the analytics_service_url setting followed by /api/prober-cadence-alert — an alert aimed at any other path is answered 404 and nobody is told.', COALESCE(v_url, 'NULL');
  END IF;
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'TEST FAILED (S2): the recorded post''s X-Service-Key header is % — a blank or absent key produces a 401 the fire-and-forget post can never surface.', COALESCE(quote_literal(v_key), 'NULL');
  END IF;
  IF v_body ->> 'cron_name' IS DISTINCT FROM 'cron_sync' OR v_body ->> 'cause' IS DISTINCT FROM 'heartbeat_stale' THEN
    RAISE EXCEPTION 'TEST FAILED (S2): the recorded post''s body is %, expected cron_name cron_sync and cause heartbeat_stale — the page must name WHICH source went quiet and WHY.', COALESCE(v_body::text, 'NULL');
  END IF;
  IF (v_body ->> 'gap_minutes')::BIGINT IS DISTINCT FROM 2881 THEN
    RAISE EXCEPTION 'TEST FAILED (S2): the recorded post''s gap_minutes is %, expected 2881 (2 days and 1 minute).', COALESCE(v_body ->> 'gap_minutes', 'NULL');
  END IF;
  IF v_body ->> 'ceiling' IS DISTINCT FROM '2 days' OR v_body ->> 'detected_at' IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (S2): the recorded post''s body is %, expected a ceiling of "2 days" and a detected_at timestamp (the route''s required fields).', COALESCE(v_body::text, 'NULL');
  END IF;

  -- ===== ARM S3 — a fresh ok heartbeat ⇒ ZERO posts, observer row ok ========
  DELETE FROM public.compute_jobs WHERE id = ANY (v_seed_cj);
  DELETE FROM public.cron_runs WHERE id = ANY (v_seed_cr);
  v_seed_cj := ARRAY[]::UUID[];
  v_seed_cr := ARRAY[]::UUID[];
  INSERT INTO public.cron_runs (cron_name, started_at, completed_at, status)
  VALUES ('cron_sync', now() - interval '1 day', now() - interval '1 day', 'ok')
  RETURNING id INTO v_id;
  v_seed_cr := v_seed_cr || v_id;
  DELETE FROM net._lane_posts;
  SELECT COALESCE(array_agg(r.id), ARRAY[]::UUID[]) INTO v_obs_before
    FROM public.cron_runs r WHERE r.cron_name = 'ops_staleness_check';

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.ops_staleness_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: shrink the age comparison — `v_cs_last < now() -
  --            c_cron_sync_ceiling` compares against `12 hours` instead. A
  --            heartbeat one day old is then "stale", so a HEALTHY daily sync
  --            pages the founder every tick. An alarm that cries wolf is muted
  --            within a week, which is the same as having no alarm. ⚠️ The
  --            constant itself is left alone, so S1 and S2 (which read the
  --            ceiling text out of the post) stay GREEN and S3 is the first
  --            failure.
  -- RED-UNDER-M: {"arm":"S3","apply":[{"kind":"edit","file":"supabase/migrations/20261020120000_ops_staleness_check.sql","find":"ELSIF v_cs_last < now() - c_cron_sync_ceiling THEN","replace":"ELSIF v_cs_last < now() - INTERVAL '12 hours' THEN","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (S3): ops_staleness_check() RAISED on a healthy heartbeat: %. A healthy tick must not touch the Vault or the url at all.', COALESCE(v_msg, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 0 OR v_ret IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (S3): a heartbeat one day old (inside the 2 day ceiling) produced % post(s) and return value %, expected ZERO posts and 0 — a healthy sync must not page.', v_cnt, COALESCE(v_ret::text, 'NULL');
  END IF;
  SELECT count(*) INTO v_obs_n FROM public.cron_runs r
   WHERE r.cron_name = 'ops_staleness_check' AND r.id <> ALL (v_obs_before);
  SELECT r.status, r.error, r.metadata INTO v_obs_status, v_obs_error, v_obs_meta
    FROM public.cron_runs r
   WHERE r.cron_name = 'ops_staleness_check' AND r.id <> ALL (v_obs_before) LIMIT 1;
  IF v_obs_n <> 1 OR v_obs_status IS DISTINCT FROM 'ok' OR v_obs_error IS NOT NULL
     OR jsonb_typeof(v_obs_meta -> 'cron_sync_cause') IS DISTINCT FROM 'null'
     OR jsonb_typeof(v_obs_meta -> 'backfill_cause') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'TEST FAILED (S3): the healthy call wrote % observer row(s) with status %, error % and metadata %, expected exactly 1 with status ok, no error and null causes — the observer row is how this reader''s own liveness is read.', v_obs_n, COALESCE(v_obs_status, 'NULL'), COALESCE(v_obs_error, 'NULL'), COALESCE(v_obs_meta::text, 'NULL');
  END IF;

  -- ===== ARM S4 — the two newest rows both `error` ⇒ ONE post ==============
  -- The newest is FRESH (5 minutes old), so only the two-error leg can fire.
  DELETE FROM public.compute_jobs WHERE id = ANY (v_seed_cj);
  DELETE FROM public.cron_runs WHERE id = ANY (v_seed_cr);
  v_seed_cj := ARRAY[]::UUID[];
  v_seed_cr := ARRAY[]::UUID[];
  INSERT INTO public.cron_runs (cron_name, started_at, completed_at, status)
  VALUES ('cron_sync', now() - interval '5 minutes', now() - interval '5 minutes', 'error')
  RETURNING id INTO v_id;
  v_seed_cr := v_seed_cr || v_id;
  INSERT INTO public.cron_runs (cron_name, started_at, completed_at, status)
  VALUES ('cron_sync', now() - interval '2 hours', now() - interval '2 hours', 'error')
  RETURNING id INTO v_id;
  v_seed_cr := v_seed_cr || v_id;
  INSERT INTO public.cron_runs (cron_name, started_at, completed_at, status)
  VALUES ('cron_sync', now() - interval '1 day', now() - interval '1 day', 'ok')
  RETURNING id INTO v_id;
  v_seed_cr := v_seed_cr || v_id;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.ops_staleness_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: demand THREE errors — `v_cs_errs >= 2` becomes `v_cs_errs >= 3`.
  --            The count is taken over the two newest rows, so it can never
  --            reach 3 and the leg is dead: a sync that fails every day while
  --            still writing its heartbeat (fresh, so the age leg never fires)
  --            reaches no one.
  -- RED-UNDER-M: {"arm":"S4","apply":[{"kind":"edit","file":"supabase/migrations/20261020120000_ops_staleness_check.sql","find":"v_cs_errs >= 2","replace":"v_cs_errs >= 3","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (S4): ops_staleness_check() RAISED: %. It should have posted, not raised.', COALESCE(v_msg, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 1 OR v_ret IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (S4): two consecutive error heartbeats (the newest only 5 minutes old) produced % post(s) and return value %, expected EXACTLY 1 and 1 — a sync that fails every run while still writing its heartbeat reached no human.', v_cnt, COALESCE(v_ret::text, 'NULL');
  END IF;
  SELECT p.body INTO v_body FROM net._lane_posts p ORDER BY p.id DESC LIMIT 1;
  IF v_body ->> 'cron_name' IS DISTINCT FROM 'cron_sync' OR v_body ->> 'cause' IS DISTINCT FROM 'two_consecutive_errors' THEN
    RAISE EXCEPTION 'TEST FAILED (S4): the recorded post''s body is %, expected cron_name cron_sync and cause two_consecutive_errors.', COALESCE(v_body::text, 'NULL');
  END IF;

  -- ===== ARM S5 — ONE error then an ok ⇒ ZERO posts =========================
  -- Newest `error`, the one before it `ok`, an OLDER `error` behind that: three
  -- rows holding two errors, but not two CONSECUTIVE ones.
  DELETE FROM public.compute_jobs WHERE id = ANY (v_seed_cj);
  DELETE FROM public.cron_runs WHERE id = ANY (v_seed_cr);
  v_seed_cj := ARRAY[]::UUID[];
  v_seed_cr := ARRAY[]::UUID[];
  INSERT INTO public.cron_runs (cron_name, started_at, completed_at, status)
  VALUES ('cron_sync', now() - interval '5 minutes', now() - interval '5 minutes', 'error')
  RETURNING id INTO v_id;
  v_seed_cr := v_seed_cr || v_id;
  INSERT INTO public.cron_runs (cron_name, started_at, completed_at, status)
  VALUES ('cron_sync', now() - interval '2 hours', now() - interval '2 hours', 'ok')
  RETURNING id INTO v_id;
  v_seed_cr := v_seed_cr || v_id;
  INSERT INTO public.cron_runs (cron_name, started_at, completed_at, status)
  VALUES ('cron_sync', now() - interval '3 hours', now() - interval '3 hours', 'error')
  RETURNING id INTO v_id;
  v_seed_cr := v_seed_cr || v_id;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.ops_staleness_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: demand ONE error — `v_cs_errs >= 2` becomes `v_cs_errs >= 1`. A
  --            single failed run (a transient broker blip) then pages, the page
  --            is muted within a week, and the genuine two-in-a-row page rides
  --            the same muted channel. ⚠️ S4 stays GREEN under this mutation
  --            (two errors satisfy `>= 1` too), so S5 is the first failure.
  -- RED-UNDER-M: {"arm":"S5","apply":[{"kind":"edit","file":"supabase/migrations/20261020120000_ops_staleness_check.sql","find":"v_cs_errs >= 2","replace":"v_cs_errs >= 1","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (S5): ops_staleness_check() RAISED on a heartbeat that is not stale: %.', COALESCE(v_msg, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 0 OR v_ret IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (S5): a newest-error / previous-ok pair produced % post(s) and return value %, expected ZERO and 0 — one failed run is not two consecutive ones (D-11), and an older error behind an ok does not count.', v_cnt, COALESCE(v_ret::text, 'NULL');
  END IF;

  -- ===== ARM S6 — an eligible job unclaimed past the ceiling ⇒ ONE post =====
  -- ----- S6-SETUP: a healthy heartbeat, one eligible pending backfill job ----
  DELETE FROM public.compute_jobs WHERE id = ANY (v_seed_cj);
  DELETE FROM public.cron_runs WHERE id = ANY (v_seed_cr);
  v_seed_cj := ARRAY[]::UUID[];
  v_seed_cr := ARRAY[]::UUID[];
  INSERT INTO public.cron_runs (cron_name, started_at, completed_at, status)
  VALUES ('cron_sync', now() - interval '1 hour', now() - interval '1 hour', 'ok')
  RETURNING id INTO v_id;
  v_seed_cr := v_seed_cr || v_id;
  v_setup := NULL;
  BEGIN
    INSERT INTO public.compute_jobs (kind, api_key_id, status, next_attempt_at)
    VALUES ('derive_broker_dailies', v_key_a, 'pending', now() - interval '2 hours')
    RETURNING id INTO v_id;
    v_seed_cj := v_seed_cj || v_id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (S6-SETUP): could not plant a pending derive_broker_dailies job (%), so S6 below would be asking its question of an empty queue.', v_setup;
  END IF;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.ops_staleness_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: flip the waiting comparison — `next_attempt_at <= now() - …`
  --            becomes `>=`. A job that has waited two hours is then NOT counted
  --            as waiting (and one that became eligible a moment ago is), so a
  --            queue stuck behind a dead backfill worker is read as idle.
  -- RED-UNDER-M: {"arm":"S6","apply":[{"kind":"edit","file":"supabase/migrations/20261020120000_ops_staleness_check.sql","find":"AND j.next_attempt_at <= now() - c_backfill_ceiling","replace":"AND j.next_attempt_at >= now() - c_backfill_ceiling","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (S6): ops_staleness_check() RAISED: %. It should have posted, not raised.', COALESCE(v_msg, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 1 OR v_ret IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (S6): an eligible backfill job that waited 2 hours with no claim ever produced % post(s) and return value %, expected EXACTLY 1 and 1 — the backfill worker is dead and nobody was told.', v_cnt, COALESCE(v_ret::text, 'NULL');
  END IF;
  SELECT p.body INTO v_body FROM net._lane_posts p ORDER BY p.id DESC LIMIT 1;
  IF v_body ->> 'cron_name' IS DISTINCT FROM 'backfill' OR v_body ->> 'cause' IS DISTINCT FROM 'backfill_queue_stalled' THEN
    RAISE EXCEPTION 'TEST FAILED (S6): the recorded post''s body is %, expected cron_name backfill and cause backfill_queue_stalled.', COALESCE(v_body::text, 'NULL');
  END IF;
  IF jsonb_typeof(v_body -> 'gap_minutes') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'TEST FAILED (S6): the recorded post''s gap_minutes is %, expected JSON null (no backfill job was ever claimed, so there is no claim gap to report).', COALESCE((v_body -> 'gap_minutes')::text, 'NULL');
  END IF;

  -- ===== ARM S7 — the same queue but a claim 5 minutes ago ⇒ ZERO posts =====
  -- A running derive_allocator_equity job claimed 5 minutes ago is the proof a
  -- worker is alive; the waiting job is simply next in line.
  DELETE FROM public.compute_jobs WHERE id = ANY (v_seed_cj);
  v_seed_cj := ARRAY[]::UUID[];
  INSERT INTO public.compute_jobs (kind, api_key_id, status, next_attempt_at)
  VALUES ('derive_broker_dailies', v_key_a, 'pending', now() - interval '2 hours')
  RETURNING id INTO v_id;
  v_seed_cj := v_seed_cj || v_id;
  INSERT INTO public.compute_jobs (kind, allocator_id, status, next_attempt_at, claimed_at)
  VALUES ('derive_allocator_equity', v_uid, 'running', now() - interval '1 hour', now() - interval '5 minutes')
  RETURNING id INTO v_id;
  v_seed_cj := v_seed_cj || v_id;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.ops_staleness_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: drop the claim-recency clause — the
  --            `(v_bf_last_claim IS NULL OR … )` conjunct is deleted. Every
  --            waiting job then pages, including the second job of a healthy
  --            crawl queue behind a worker that claimed 5 minutes ago. ⚠️ S6
  --            stays GREEN (it has no claim at all).
  -- RED-UNDER-M: {"arm":"S7","apply":[{"kind":"edit","file":"supabase/migrations/20261020120000_ops_staleness_check.sql","find":"\n     AND (v_bf_last_claim IS NULL OR v_bf_last_claim < now() - c_backfill_ceiling)","replace":"","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (S7): ops_staleness_check() RAISED: %.', COALESCE(v_msg, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 0 OR v_ret IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (S7): a waiting backfill job beside a claim made 5 minutes ago produced % post(s) and return value %, expected ZERO and 0 — a worker that claimed 5 minutes ago is alive, and paging on its queue pages on every healthy crawl.', v_cnt, COALESCE(v_ret::text, 'NULL');
  END IF;

  -- ===== ARM S8 — a running job past ceiling + one tick ⇒ ONE post ==========
  DELETE FROM public.compute_jobs WHERE id = ANY (v_seed_cj);
  v_seed_cj := ARRAY[]::UUID[];
  INSERT INTO public.compute_jobs (kind, api_key_id, status, next_attempt_at, claimed_at)
  VALUES ('derive_broker_dailies', v_key_a, 'running', now() - interval '1 hour', now() - interval '32 minutes')
  RETURNING id INTO v_id;
  v_seed_cj := v_seed_cj || v_id;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.ops_staleness_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: stand the running-job leg down — the claimed_at comparison
  --            becomes `AND FALSE`. A job the watchdog should have reclaimed
  --            half an hour ago but did not (the watchdog itself is down) is
  --            then invisible, and only the QUEUE leg watches the backfill.
  -- RED-UNDER-M: {"arm":"S8","apply":[{"kind":"edit","file":"supabase/migrations/20261020120000_ops_staleness_check.sql","find":"AND j.claimed_at < now() - (c_backfill_ceiling + c_watchdog_interval)","replace":"AND FALSE","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (S8): ops_staleness_check() RAISED: %.', COALESCE(v_msg, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 1 OR v_ret IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (S8): a running backfill job claimed 32 minutes ago (past the ceiling plus one watchdog tick) produced % post(s) and return value %, expected EXACTLY 1 and 1 — a wedged crawl the watchdog never reclaimed reached no human.', v_cnt, COALESCE(v_ret::text, 'NULL');
  END IF;
  SELECT p.body INTO v_body FROM net._lane_posts p ORDER BY p.id DESC LIMIT 1;
  IF v_body ->> 'cron_name' IS DISTINCT FROM 'backfill' OR v_body ->> 'cause' IS DISTINCT FROM 'backfill_running_stuck' THEN
    RAISE EXCEPTION 'TEST FAILED (S8): the recorded post''s body is %, expected cron_name backfill and cause backfill_running_stuck.', COALESCE(v_body::text, 'NULL');
  END IF;

  -- ===== ARM S12 — a running job still inside the extra tick ⇒ ZERO posts ===
  -- 30 minutes 30 seconds: past the 30 minute ceiling, inside ceiling + 60
  -- seconds. The watchdog reclaims on its NEXT tick, so it has not failed yet.
  DELETE FROM public.compute_jobs WHERE id = ANY (v_seed_cj);
  v_seed_cj := ARRAY[]::UUID[];
  INSERT INTO public.compute_jobs (kind, api_key_id, status, next_attempt_at, claimed_at)
  VALUES ('derive_broker_dailies', v_key_a, 'running', now() - interval '1 hour', now() - interval '30 minutes 30 seconds')
  RETURNING id INTO v_id;
  v_seed_cj := v_seed_cj || v_id;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.ops_staleness_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: drop the watchdog-tick slack — `(c_backfill_ceiling +
  --            c_watchdog_interval)` becomes `c_backfill_ceiling`. A job one
  --            tick past its threshold, which the watchdog is about to reclaim
  --            on its own, then pages. ⚠️ S8 stays GREEN (32 minutes is past
  --            both bounds).
  -- RED-UNDER-M: {"arm":"S12","apply":[{"kind":"edit","file":"supabase/migrations/20261020120000_ops_staleness_check.sql","find":"now() - (c_backfill_ceiling + c_watchdog_interval)","replace":"now() - c_backfill_ceiling","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (S12): ops_staleness_check() RAISED: %.', COALESCE(v_msg, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 0 OR v_ret IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (S12): a running backfill job claimed 30 minutes 30 seconds ago (inside the ceiling plus one watchdog tick) produced % post(s) and return value %, expected ZERO and 0 — the watchdog has not had its next tick, and paging before it does pages on a recovery already in progress.', v_cnt, COALESCE(v_ret::text, 'NULL');
  END IF;

  -- ===== ARM S9 — a NON-backfill kind waiting for hours ⇒ ZERO posts =======
  -- poll_allocator_positions is api_key-scoped, in the kind registry, and not a
  -- backfill kind. The reader's backfill arm reads backfill kinds only.
  DELETE FROM public.compute_jobs WHERE id = ANY (v_seed_cj);
  v_seed_cj := ARRAY[]::UUID[];
  v_setup := NULL;
  BEGIN
    INSERT INTO public.compute_jobs (kind, api_key_id, status, next_attempt_at)
    VALUES ('poll_allocator_positions', v_key_b, 'pending', now() - interval '3 hours')
    RETURNING id INTO v_id;
    v_seed_cj := v_seed_cj || v_id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (S9-SETUP): could not plant a pending poll_allocator_positions job (%), so S9 below would be asking its question of an empty queue.', v_setup;
  END IF;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.ops_staleness_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: widen the kind list — `poll_allocator_positions` joins the
  --            backfill kinds. The backfill arm then pages on a kind whose
  --            worker is a different process with a different ceiling, and the
  --            parity test (which pins the list to main_worker.BACKFILL_KINDS)
  --            is the only other thing that would notice.
  -- RED-UNDER-M: {"arm":"S9","apply":[{"kind":"edit","file":"supabase/migrations/20261020120000_ops_staleness_check.sql","find":"ARRAY['derive_broker_dailies','derive_allocator_equity']","replace":"ARRAY['derive_broker_dailies','derive_allocator_equity','poll_allocator_positions']","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (S9): ops_staleness_check() RAISED: %.', COALESCE(v_msg, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 0 OR v_ret IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (S9): a poll_allocator_positions job waiting 3 hours produced % post(s) and return value %, expected ZERO and 0 — the backfill arm reads the backfill kinds only.', v_cnt, COALESCE(v_ret::text, 'NULL');
  END IF;

  -- ===== ARMS S10/S13 — a FOREIGN url ⇒ the reader REFUSES, and does not ====
  -- =====                name the value it refused ===========================
  -- The CHECK constraint on system_settings is one ALTER TABLE from gone and this
  -- arm performs exactly that ALTER TABLE; what is measured is the layer still
  -- standing afterwards, the in-body re-test of the SAME allow-list. A stale
  -- heartbeat makes the reader reach the guard.
  -- ----- S10-SETUP: a stale arm, the constraint dropped, a foreign host ------
  DELETE FROM public.compute_jobs WHERE id = ANY (v_seed_cj);
  DELETE FROM public.cron_runs WHERE id = ANY (v_seed_cr);
  v_seed_cj := ARRAY[]::UUID[];
  v_seed_cr := ARRAY[]::UUID[];
  INSERT INTO public.cron_runs (cron_name, started_at, completed_at, status)
  VALUES ('cron_sync', now() - interval '3 days', now() - interval '3 days', 'ok')
  RETURNING id INTO v_id;
  v_seed_cr := v_seed_cr || v_id;
  SELECT s.value INTO v_orig_url FROM public.system_settings s WHERE s.key = 'analytics_service_url';
  v_setup := NULL;
  BEGIN
    ALTER TABLE public.system_settings
      DROP CONSTRAINT IF EXISTS system_settings_analytics_service_url_allowed;
    UPDATE public.system_settings
       SET value = 'https://collector.attacker.example'
     WHERE key = 'analytics_service_url';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (S10-SETUP): could not drop the destination CHECK constraint and store a foreign host (%) — the arms below need the constraint gone to reach the in-body re-test at all. Record what it says — do NOT weaken the arm to accommodate it.', v_setup;
  END IF;
  DELETE FROM net._lane_posts;
  SELECT COALESCE(array_agg(r.id), ARRAY[]::UUID[]) INTO v_obs_before
    FROM public.cron_runs r WHERE r.cron_name = 'ops_staleness_check';

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.ops_staleness_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: stand the destination guard down — `IF v_url !~ c_url_allowed
  --            THEN` becomes `IF FALSE THEN`. With the constraint already gone
  --            the control is zero layers deep and the reader posts the live
  --            service key to the attacker's host. ⚠️ Deliberately NOT a `sql`
  --            step dropping the constraint: this arm has already dropped it.
  -- RED-UNDER-M: {"arm":"S10","apply":[{"kind":"edit","file":"supabase/migrations/20261020120000_ops_staleness_check.sql","find":"IF v_url !~ c_url_allowed THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF NOT v_raised OR v_msg !~ 'not an allowed destination' THEN
    RAISE EXCEPTION 'TEST FAILED (S10): with analytics_service_url set to a host outside the allow-list and the CHECK constraint dropped, ops_staleness_check() did not refuse by name — raised=%, message: %. net.http_post is fire-and-forget, so the Vault-held service key would leave in an X-Service-Key header and nothing downstream would ever report where it went.', v_raised, COALESCE(v_msg, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (S10): % outbound post(s) were recorded despite the destination guard, expected ZERO — a refusal that still lets the request out is not a refusal.', v_cnt;
  END IF;
  SELECT count(*) INTO v_obs_n FROM public.cron_runs r
   WHERE r.cron_name = 'ops_staleness_check' AND r.id <> ALL (v_obs_before);
  IF v_obs_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (S10): a refused call left % observer row(s) behind, expected ZERO — the RAISE must roll the observer INSERT back with the rest of the call, so a tick that could not deliver leaves no row and the absence is the next tick''s evidence.', v_obs_n;
  END IF;

  -- RED-UNDER: make the refusal ECHO the value — append `(%)', v_url` to the
  --            message. RAISE text lands in the cron job-run row and the
  --            Postgres log, so an attacker-chosen hostname would be written
  --            into every downstream reader of this project's logs by the guard
  --            that refused it (T-161.1-10). ⚠️ It leaves `not an allowed
  --            destination` in place, so S10 above stays GREEN and this arm is
  --            the first failure.
  -- RED-UNDER-M: {"arm":"S13","apply":[{"kind":"edit","file":"supabase/migrations/20261020120000_ops_staleness_check.sql","find":"read it with an admin session. Allowed: an https host under .up.railway.app';","replace":"read it with an admin session. Allowed: an https host under .up.railway.app (%)', v_url;","occurrences":1}]}
  IF v_msg ~ 'collector\.attacker\.example' THEN
    RAISE EXCEPTION 'TEST FAILED (S13): the destination refusal ECHOED the url it refused — it reads: %. The value in that row is attacker-controlled by construction, and RAISE text is not a private channel. Name the SETTING, never its value; an operator who needs the value can SELECT it.', v_msg;
  END IF;

  -- Put the allow-listed url back for the arm below (the constraint stays gone;
  -- the whole test rolls back).
  UPDATE public.system_settings SET value = v_orig_url WHERE key = 'analytics_service_url';

  -- ===== ARM S11 — BOTH arms stale ⇒ TWO posts, return value 2 =============
  DELETE FROM public.compute_jobs WHERE id = ANY (v_seed_cj);
  DELETE FROM public.cron_runs WHERE id = ANY (v_seed_cr);
  v_seed_cj := ARRAY[]::UUID[];
  v_seed_cr := ARRAY[]::UUID[];
  INSERT INTO public.cron_runs (cron_name, started_at, completed_at, status)
  VALUES ('cron_sync', now() - interval '3 days', now() - interval '3 days', 'ok')
  RETURNING id INTO v_id;
  v_seed_cr := v_seed_cr || v_id;
  INSERT INTO public.compute_jobs (kind, api_key_id, status, next_attempt_at)
  VALUES ('derive_broker_dailies', v_key_a, 'pending', now() - interval '2 hours')
  RETURNING id INTO v_id;
  v_seed_cj := v_seed_cj || v_id;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.ops_staleness_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: make the arms mutually exclusive — the backfill post guard
  --            `IF v_bf_cause IS NOT NULL THEN` gains `AND v_cs_cause IS NULL`.
  --            Each arm still pages on its own (S1-S9 stay GREEN), but a tick
  --            where the sync is dead AND the backfill worker is dead pages
  --            once, naming only the first, and the second outage waits for the
  --            first to be fixed.
  -- RED-UNDER-M: {"arm":"S11","apply":[{"kind":"edit","file":"supabase/migrations/20261020120000_ops_staleness_check.sql","find":"IF v_bf_cause IS NOT NULL THEN","replace":"IF v_bf_cause IS NOT NULL AND v_cs_cause IS NULL THEN","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (S11): ops_staleness_check() RAISED: %.', COALESCE(v_msg, 'NULL');
  END IF;
  SELECT array_agg(p.body ->> 'cron_name' ORDER BY p.body ->> 'cron_name') INTO v_names FROM net._lane_posts p;
  IF v_ret IS DISTINCT FROM 2 OR v_names IS DISTINCT FROM ARRAY['backfill', 'cron_sync']::TEXT[] THEN
    RAISE EXCEPTION 'TEST FAILED (S11): a dead sync AND a dead backfill worker produced return value % and posts for [%], expected 2 and [backfill,cron_sync] — one outage must not hide the other.', COALESCE(v_ret::text, 'NULL'), COALESCE(array_to_string(v_names, ','), 'NULL');
  END IF;

  -- ===== ARM G1 — EXECUTE on the reader is held by the OWNER ALONE ==========
  -- ⭐ THE WHOLE GRANTEE SET, NOT A SUBSET: aclexplode over proacl enumerates
  -- the grantees instead of interrogating a guessed list, so a grantee nobody
  -- thought of is a FAILURE here rather than a silence. Compared to the OWNER'S
  -- NAME, never the literal `postgres` (the pg-lane boots as whatever role it
  -- created). COALESCE(proacl, acldefault(…)) makes a NULL acl explicit: its
  -- MEANING is the default ACL, which grants EXECUTE to PUBLIC. Falsifiable on
  -- the lane only because fixture 07 grants the project-bootstrap defaults first.
  -- The SECURITY DEFINER and search_path legs of the same threat (T-164.6.8-08,
  -- T-164.6.8-10) are read in the same arm.
  v_owner    := NULL;
  v_grantees := NULL;
  SELECT g.owner_name, string_agg(g.grantee_name, ',' ORDER BY g.grantee_name)
    INTO v_owner, v_grantees
    FROM (
      SELECT pg_get_userbyid(p.proowner) AS owner_name,
             CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee_name
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
       WHERE n.nspname = 'public'
         AND p.proname = 'ops_staleness_check'
         AND p.pronargs = 0
         AND a.privilege_type = 'EXECUTE'
    ) g
   GROUP BY g.owner_name;

  -- RED-UNDER: hand the privilege back on the live lane. A `sql` step and NOT an
  --            edit of the migration's REVOKE line, because that file's own
  --            verify block asserts this very set: an edit weakening the REVOKE
  --            would ABORT the apply and no arm could be the first failure.
  --            service_role is the grantee the default ACL hands every new
  --            public function and the one a leaked project key becomes.
  -- RED-UNDER-M: {"arm":"G1","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.ops_staleness_check() TO service_role"}]}
  IF v_grantees IS NULL OR v_grantees IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'TEST FAILED (G1): EXECUTE on ops_staleness_check is held by [%], expected exactly the owner [%]. The reader reads a live service key out of the Vault as its DEFINER and POSTs it in an outbound header, so every extra grantee is a principal who can force a live secret-bearing request on demand.', COALESCE(v_grantees, 'NULL'), COALESCE(v_owner, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ops_staleness_check' AND p.pronargs = 0
     AND p.prosecdef
     AND EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::TEXT[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_catalog');
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (G1): ops_staleness_check is not SECURITY DEFINER with search_path pinned to public, pg_catalog — an unpinned path on a SECURITY DEFINER body is a privilege-escalation route.';
  END IF;

  RAISE NOTICE 'ALL 14 ARMS EXECUTED (S1,S2,S3,S4,S5,S6,S7,S8,S12,S9,S10,S13,S11,G1): public.ops_staleness_check() posts one alert to the analytics service''s /api/prober-cadence-alert route, cron_name cron_sync, when no heartbeat ever ran (S1), when the newest is older than 2 days (S2: gap, key, body fields) and when the two newest rows are both error (S4); stays silent on a fresh ok heartbeat with an ok observer row (S3) and on one error beside an ok (S5); posts cron_name backfill when an eligible job waits unclaimed past the ceiling (S6) or a running job outlives the ceiling plus one watchdog tick (S8); stays silent beside a recent claim (S7), inside the extra tick (S12) and for a non-backfill kind (S9); refuses a destination outside the allow-list without echoing it and leaves no observer row (S10, S13); posts for both arms at once and returns 2 (S11); and EXECUTE is held by the owner alone on a SECURITY DEFINER body with a pinned search_path (G1). Phase 164.6.8 / plan 02 / D-10, D-11, mig 20261020120000.';
END $$;

ROLLBACK;
