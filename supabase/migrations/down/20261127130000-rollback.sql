-- ============================================================================
-- ROLLBACK for 20261127130000_cron_destinations_exact.sql
-- ============================================================================
-- Manual, off the auto-apply path. Run it as ONE transaction, so it either happens
-- whole or not at all (this file carries no transaction statements, like a migration):
--
--   psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
--
-- against the database the marker query in CLAUDE.md names. Run that query FIRST:
--
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
--
-- current_database() is `postgres` on BOTH projects and proves nothing; if the marker is
-- NULL, re-set it before running anything here. What this file undoes:
--   1. Replaces the system_settings_analytics_service_url_allowed CHECK with the suffix
--      pattern of 20260907120000 and restores that migration's COMMENT ON CONSTRAINT.
--   2. Re-issues the four key-posting functions, in the migration's order, with the bodies
--      the migration replaced: match_engine_cron_tick (20260911120000),
--      prod_prober_cadence_check (20260918120000), cron_sync_tick (20261010140000) and
--      ops_staleness_check (20261020120000), and restates each owner-alone REVOKE.
--
-- ⚠️ ROLLING BACK RE-OPENS BOTH DEFECTS: any Railway subdomain is a permitted analytics
-- destination again, and a Vault key of tabs, carriage returns or newlines passes the blank-key
-- guard again.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records version
-- 20261127130000 as applied while the objects carry the old definitions, and `supabase db push`
-- will not re-apply the migration. To re-apply it, delete that ledger row in the same change
-- (or mark it reverted with `supabase migration repair --status reverted 20261127130000`
-- against the intended database, after the marker query above names that database).
--
-- The precondition reads CATALOGUES ONLY and refuses, before anything changes, on a database
-- whose CHECK is not the exact two-origin one or on which any of the four functions does not
-- carry the exact two-origin body; the postcondition aborts the whole rollback unless the
-- previous suffix-rule CHECK and all four previous bodies are what is deployed.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
DECLARE
  v_con  text;
  v_name text;
  v_oid  oid;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_con
    FROM pg_constraint c
   WHERE c.conrelid = 'public.system_settings'::regclass
     AND c.conname  = 'system_settings_analytics_service_url_allowed';
  IF v_con IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261127130000 refused: the CHECK system_settings_analytics_service_url_allowed is not present. Nothing was changed. Run the marker query in this file''s header first.';
  END IF;
  IF position('= ANY' IN v_con) = 0 THEN
    RAISE EXCEPTION 'Rollback 20261127130000 refused: the deployed CHECK is not the exact two-origin one, so this database does not carry the migration being rolled back. Nothing was changed. It reads: %', v_con;
  END IF;
  FOREACH v_name IN ARRAY ARRAY['match_engine_cron_tick', 'prod_prober_cadence_check', 'cron_sync_tick', 'ops_staleness_check'] LOOP
    v_oid := to_regprocedure('public.' || v_name || '()');
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Rollback 20261127130000 refused: public.%() does not exist. Nothing was changed. Run the marker query in this file''s header first.', v_name;
    END IF;
    IF position('c_allowed_origins' IN pg_get_functiondef(v_oid)) = 0 THEN
      RAISE EXCEPTION 'Rollback 20261127130000 refused: public.%() does not carry the exact two-origin body, so this database does not carry the migration being rolled back. Nothing was changed.', v_name;
    END IF;
  END LOOP;
END
$precondition$;

-- ───────────── the 20260907120000 CHECK and its comment
ALTER TABLE public.system_settings
  DROP CONSTRAINT IF EXISTS system_settings_analytics_service_url_allowed,
  ADD CONSTRAINT system_settings_analytics_service_url_allowed
    CHECK (
      key <> 'analytics_service_url'
      OR value ~ '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$'
    );

COMMENT ON CONSTRAINT system_settings_analytics_service_url_allowed
  ON public.system_settings IS
  'T-164.7-06: pins the analytics_service_url row to an https host under '
  '.up.railway.app (plus the loopback discard literal the gate uses), because '
  'system_settings_admin_all is FOR ALL TO authenticated and an app-admin can '
  'therefore PATCH that row through PostgREST — one tick later the Vault-held '
  'analytics service key arrives at whatever host it names. Requiring a '
  'migration to change WHERE a live secret is sent is the desired property, not '
  'a limitation: every hostname a real redeploy of this service can have is '
  'already inside the allow-list. public.match_engine_cron_tick() re-tests the '
  'SAME expression before posting, so dropping this constraint does not open '
  'the route.';

-- ───────────── the 20260911120000 body of match_engine_cron_tick
CREATE OR REPLACE FUNCTION public.match_engine_cron_tick()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $tick$
DECLARE
  v_key TEXT;
  -- ⛔ DECLAREd because plpgsql compiles the body WHOLE: a missing DECLARE does
  --    not weaken the one statement that uses it, it raises 42601 and the
  --    function does not compile at all (20260907130000:750-754).
  v_cnt INTEGER;
  v_url TEXT;
  v_req BIGINT;
  -- ⛔ THE DESTINATION ALLOW-LIST, layer (b). BYTE-IDENTICAL to the CHECK
  --    constraint's expression in STEP 1b, and STEP 3 check 7 asserts that the
  --    two really are the same string by reading pg_get_constraintdef and this
  --    body back out of the catalogue. Two copies of one rule is the point: the
  --    constraint is one ALTER TABLE away from gone, and this is what still
  --    refuses the POST when it is.
  c_url_allowed CONSTANT TEXT :=
    '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$';
BEGIN
  -- THE VAULT READ — ONE statement, count and value off the SAME scan.
  -- ⛔ Not `INTO STRICT`, and the choice is not a style preference. STRICT
  --    raises NO_DATA_FOUND on zero rows, which would REPLACE the by-name
  --    message the gate's arm V1 asserts with a generic P0002; recovering the
  --    name then needs `EXCEPTION WHEN NO_DATA_FOUND THEN RAISE …`, the shape
  --    20260907130000:243-245 keeps out of the source because lint rule R1
  --    flags it in the gate corpus. The count form refuses a duplicate BY NAME
  --    and leaves the absent-secret message byte-identical.
  --    count = 0 leaves v_key NULL and the existing guard fires.
  SELECT count(*), max(decrypted_secret) INTO v_cnt, v_key
    FROM vault.decrypted_secrets
   WHERE name = 'analytics_service_key';
  IF v_cnt > 1 THEN
    RAISE EXCEPTION 'analytics_service_key is not unique in vault (% rows) — refusing to pick one', v_cnt;
  END IF;
  -- ⚠️ btrim() with no character set trims SPACES ONLY. A key of tabs or
  --    newlines still passes this guard and still produces a header the
  --    analytics service answers 401 to. RECORDED, not closed: the criterion
  --    text is btrim(v_key) = '' and widening it to E' \t\r\n' is a decision
  --    with its own evidence, not a silent improvement here.
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'analytics_service_key missing from vault — refusing to send a null header';
  END IF;

  SELECT s.value INTO v_url
    FROM public.system_settings s
   WHERE s.key = 'analytics_service_url';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE EXCEPTION 'analytics_service_url missing from system_settings — refusing to post to a null url';
  END IF;

  -- ⛔ AND IT MUST BE A DESTINATION THIS FILE ALLOWS (T-164.7-06, layer (b)).
  -- The CHECK constraint in STEP 1b already refuses to STORE anything else; this
  -- re-test is what stands when that constraint has been dropped, and it is the
  -- last thing between an admin-writable row and a live service key in an
  -- outbound header.
  --
  -- ⚠️ THE MESSAGE DOES NOT ECHO THE OFFENDING URL, and that is not squeamishness
  -- about PII. RAISE text lands in the cron job-run row, in the Postgres log and
  -- in whatever ships those onward; echoing an attacker-chosen string there
  -- writes their collector's hostname into every downstream reader of this
  -- project's logs, and an operator who needs the value can SELECT it. Same rule
  -- as the two RAISEs above (T-161.1-10): name the SETTING, never its value.
  IF v_url !~ c_url_allowed THEN
    RAISE EXCEPTION 'analytics_service_url in system_settings is not an allowed destination — refusing to post the analytics service key. The offending value is deliberately NOT echoed here; read it with an admin session. Allowed: an https host under .up.railway.app';
  END IF;

  -- ⚠️ net.http_post is ASYNC. The BIGINT returned here is a REQUEST ID, not an
  -- HTTP status: a request that ends in a 401 or a timeout returns a perfectly
  -- ordinary id and leaves the caller looking successful. Whether the POST
  -- actually landed is read out of net._http_response, which is what the
  -- cron-obs prober arm does (TODOS CRON-OBS-01). Do not add a success message
  -- here — there is nothing at this point that knows whether it succeeded.
  SELECT net.http_post(
           url := v_url || '/api/match/cron-recompute',
           headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'X-Service-Key', v_key
                      ),
           body := '{}'::jsonb,
           timeout_milliseconds := 60000
         ) INTO v_req;
  RETURN v_req;
END
$tick$;

REVOKE ALL ON FUNCTION public.match_engine_cron_tick() FROM PUBLIC, anon, authenticated, service_role;

-- ───────────── the 20260918120000 body of prod_prober_cadence_check
CREATE OR REPLACE FUNCTION public.prod_prober_cadence_check()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $cadence$
DECLARE
  -- ══════════════════════════════════════════════════════════════════════
  -- c_contact_ceiling (D-04) — DERIVED, dated, and named rather than chosen.
  -- ══════════════════════════════════════════════════════════════════════
  -- SAMPLE: 273.4 hours ending 2026-09-18, measured TWICE independently with
  -- identical figures. GitHub delivered 75 of 273 expected hourly ticks — a
  -- 27% delivery rate. Median gap 3.28h, maximum gap 7.13h, two gaps exceeded
  -- six hours.
  --
  -- CEILING = observed MAXIMUM gap + observed MEDIAN gap = 7.13h + 3.28h =
  -- 10.41h, rounded UP to the whole minute: 10 hours 25 minutes.
  --
  -- WHY THIS RULE AND NOT ANOTHER, both halves: below the observed maximum the
  -- alarm would fire on behaviour already measured as ordinary and would be
  -- muted within a week; above maximum-plus-one-typical-interval, a total
  -- stoppage would go unnamed for longer than any gap the sample contains.
  --
  -- ⛔ THIS NUMBER IS DECLARED ONCE, HERE. This repository carries a named,
  -- recurring citation-drift defect class ([164.7-CITATION-DRIFT-01]) for a
  -- number restated in prose that then drifts out of sync with the constant.
  -- Every other reference to this ceiling anywhere in this tree is by the
  -- SYMBOL `c_contact_ceiling`, never by restating "10h25m" or "10.41h".
  c_contact_ceiling CONSTANT INTERVAL := '10 hours 25 minutes';

  v_last        TIMESTAMPTZ;
  v_stale       BOOLEAN;
  v_gap_minutes BIGINT;

  -- The Vault + system_settings + pg_net read, byte-identical in shape to
  -- match_engine_cron_tick() — see that function for the full rationale behind
  -- each guard.
  v_key TEXT;
  v_cnt INTEGER;
  v_url TEXT;
  v_req BIGINT;
  c_url_allowed CONSTANT TEXT :=
    '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$';
BEGIN
  -- 1. Read the contact. Narrowed by cron_name — never an unfiltered scan over
  --    public.cron_runs.
  SELECT max(completed_at) INTO v_last
    FROM public.cron_runs
   WHERE cron_name = 'prod_prober';

  -- 2. Decide. ⛔ THE NULL LEG IS WRITTEN FIRST AND EXPLICITLY. An absent
  --    contact row is the LOUDEST possible signal (the prober has never run,
  --    or its rows were removed) — and a bare interval comparison against NULL
  --    (`now() - NULL > c_contact_ceiling`) yields NULL, which every IF in
  --    plpgsql treats as FALSE, i.e. reports healthy. That silent-healthy shape
  --    is the exact defect class this whole phase exists to remove, so it is
  --    refused at the one place it could enter.
  IF v_last IS NULL THEN
    v_stale := TRUE;
  ELSE
    v_stale := (now() - v_last > c_contact_ceiling);
  END IF;

  -- 3. A DURATION, not a value read from configuration — safe to record in the
  --    observer's own row and in the alert body below.
  v_gap_minutes := CASE
                      WHEN v_last IS NULL THEN NULL
                      ELSE floor(extract(epoch FROM (now() - v_last)) / 60)::BIGINT
                    END;

  -- 4. THE OBSERVER'S OWN ROW (D-06), unconditionally, BEFORE any outbound
  --    call, so this function's own liveness is readable the same way the
  --    prober's is. 24 rows/day, accepted and unpruned — the same growth
  --    precedent the mt5_session_episode writer already established for this
  --    table (analytics-service/services/mt5_session_episodes.py).
  --    `error` and `metadata` never carry a URL, a key, or a system_settings
  --    VALUE — only names and integers, per this repo's RAISE-message
  --    discipline (T-161.1-10) applied to a written row instead of a RAISE.
  INSERT INTO public.cron_runs (cron_name, started_at, completed_at, status, error, metadata)
  VALUES (
    'prod_prober_cadence_check',
    now(),
    now(),
    CASE WHEN v_stale THEN 'error' ELSE 'ok' END,
    CASE
      WHEN v_stale THEN format('prod_prober contact gap exceeded the ceiling: %s minute(s) since last contact (never, if none)', COALESCE(v_gap_minutes::TEXT, 'never'))
      ELSE NULL
    END,
    jsonb_build_object(
      'gap_minutes', v_gap_minutes,
      'ceiling', c_contact_ceiling::TEXT,
      'contact_cron_name', 'prod_prober'
    )
  );

  -- 5. Not stale: no alarm was raised on this tick. The gate's fresh arm reads
  --    exactly this NULL.
  IF NOT v_stale THEN
    RETURN NULL;
  END IF;

  -- 6. Stale: resolve the key and the destination, in the SAME order and with
  --    the SAME guards as match_engine_cron_tick().
  SELECT count(*), max(decrypted_secret) INTO v_cnt, v_key
    FROM vault.decrypted_secrets
   WHERE name = 'analytics_service_key';
  IF v_cnt > 1 THEN
    RAISE EXCEPTION 'analytics_service_key is not unique in vault (% rows) — refusing to pick one', v_cnt;
  END IF;
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'analytics_service_key missing from vault — refusing to send a null header';
  END IF;

  SELECT s.value INTO v_url
    FROM public.system_settings s
   WHERE s.key = 'analytics_service_url';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE EXCEPTION 'analytics_service_url missing from system_settings — refusing to post to a null url';
  END IF;

  -- ⛔ LAYER (b) of the destination allow-list, re-tested inside this body even
  -- though STEP 1b of 20260907120000 already refuses to STORE anything else —
  -- this is what still refuses the POST when that constraint has been dropped.
  -- The message deliberately does not echo the offending url (T-161.1-10):
  -- RAISE text lands in cron.job_run_details, the Postgres log, and downstream
  -- shippers, and this repo is public.
  IF v_url !~ c_url_allowed THEN
    RAISE EXCEPTION 'analytics_service_url in system_settings is not an allowed destination — refusing to post the analytics service key. The offending value is deliberately NOT echoed here; read it with an admin session. Allowed: an https host under .up.railway.app';
  END IF;

  -- ⛔ NOTHING BELOW IS WRAPPED IN AN EXCEPTION HANDLER THAT SWALLOWS. If
  -- net.http_post is absent or errors, this function RAISES and the tick is
  -- red. An alarm that catches its own delivery failure and returns normally
  -- is an alarm that reports success for a message nobody received — this
  -- phase's subject, one layer down. The honest cost: a raise here rolls back
  -- the observer row written in step 4, so a tick that could not deliver
  -- leaves NO row, and that absence is itself the next tick's evidence.
  SELECT net.http_post(
           url := v_url || '/api/prober-cadence-alert',
           headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'X-Service-Key', v_key
                      ),
           body := jsonb_build_object(
                     'cron_name', 'prod_prober',
                     'gap_minutes', v_gap_minutes,
                     'ceiling', c_contact_ceiling::text,
                     'detected_at', now()
                   ),
           timeout_milliseconds := 60000
         ) INTO v_req;
  RETURN v_req;
END
$cadence$;

REVOKE ALL ON FUNCTION public.prod_prober_cadence_check() FROM PUBLIC, anon, authenticated, service_role;

-- ───────────── the 20261010140000 body of cron_sync_tick
CREATE OR REPLACE FUNCTION public.cron_sync_tick()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $tick$
DECLARE
  v_key TEXT;
  -- ⛔ DECLAREd because plpgsql compiles the body WHOLE: a missing DECLARE does
  --    not weaken the one statement that uses it, it raises 42601 and the
  --    function does not compile at all.
  v_cnt INTEGER;
  v_url TEXT;
  v_req BIGINT;
  -- ⛔ THE DESTINATION ALLOW-LIST, layer (b). BYTE-IDENTICAL to the CHECK
  --    constraint's expression on system_settings and to the constant in
  --    match_engine_cron_tick(). The constraint is one ALTER TABLE away from
  --    gone, and this is what still refuses the POST when it is.
  c_url_allowed CONSTANT TEXT :=
    '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$';
BEGIN
  -- THE VAULT READ — ONE statement, count and value off the SAME scan.
  -- Not `INTO STRICT`: STRICT would replace the by-name absent-key message with
  -- a generic P0002. The count form refuses a duplicate BY NAME and leaves the
  -- absent-secret message intact. count = 0 leaves v_key NULL and the guard
  -- below fires.
  SELECT count(*), max(decrypted_secret) INTO v_cnt, v_key
    FROM vault.decrypted_secrets
   WHERE name = 'analytics_service_key';
  IF v_cnt > 1 THEN
    RAISE EXCEPTION 'analytics_service_key is not unique in vault (% rows) — refusing to pick one', v_cnt;
  END IF;
  -- btrim() with no character set trims SPACES ONLY. A key of tabs or newlines
  -- still passes and still produces a header the analytics service answers 401
  -- to. Recorded, not closed: widening it is a decision with its own evidence.
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'analytics_service_key missing from vault — refusing to send a null header';
  END IF;

  SELECT s.value INTO v_url
    FROM public.system_settings s
   WHERE s.key = 'analytics_service_url';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE EXCEPTION 'analytics_service_url missing from system_settings — refusing to post to a null url';
  END IF;

  -- ⛔ AND IT MUST BE A DESTINATION THE ALLOW-LIST PERMITS (T-164.7-06, layer
  -- (b)). This re-test is the last thing between an admin-writable row and a
  -- live service key in an outbound header.
  --
  -- ⚠️ THE MESSAGE DOES NOT ECHO THE OFFENDING URL. RAISE text lands in the cron
  -- job-run row, the Postgres log and whatever ships those onward; echoing an
  -- attacker-chosen string writes their collector's hostname into every
  -- downstream reader. Name the SETTING, never its value (T-161.1-10).
  IF v_url !~ c_url_allowed THEN
    RAISE EXCEPTION 'analytics_service_url in system_settings is not an allowed destination — refusing to post the analytics service key. The offending value is deliberately NOT echoed here; read it with an admin session. Allowed: an https host under .up.railway.app';
  END IF;

  -- ⚠️ net.http_post is ASYNC. The BIGINT returned here is a REQUEST ID, not an
  -- HTTP status: a request that ends in a 401 or a timeout returns a perfectly
  -- ordinary id and leaves the caller looking successful. Whether the POST
  -- landed is read out of net._http_response. NOTHING below is wrapped in an
  -- exception handler that swallows: if net.http_post is absent or errors, this
  -- function RAISES and the tick is red. Do not add a success message here —
  -- nothing at this point knows whether it succeeded.
  SELECT net.http_post(
           url := v_url || '/api/cron-sync',
           headers := jsonb_build_object(
                        'Content-Type', 'application/json',
                        'X-Service-Key', v_key
                      ),
           body := '{}'::jsonb,
           timeout_milliseconds := 180000
         ) INTO v_req;
  RETURN v_req;
END
$tick$;

REVOKE ALL ON FUNCTION public.cron_sync_tick() FROM PUBLIC, anon, authenticated, service_role;

-- ───────────── the 20261020120000 body of ops_staleness_check
CREATE OR REPLACE FUNCTION public.ops_staleness_check()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $ops$
DECLARE
  -- ══════════════════════════════════════════════════════════════════════
  -- THE CONSTANTS. Each is declared ONCE, here. Every other reference in this
  -- tree is by SYMBOL, never by a restated value ([164.7-CITATION-DRIFT-01]).
  -- ══════════════════════════════════════════════════════════════════════
  -- D-11: the TODOS gate value, and the same ceiling as D-05 of 167.1.2.2.2.
  c_cron_sync_ceiling CONSTANT INTERVAL := '2 days';
  -- Pinned to main_worker.BACKFILL_KINDS by the parity test.
  c_backfill_kinds CONSTANT TEXT[] := ARRAY['derive_broker_dailies','derive_allocator_equity'];
  -- The largest watchdog threshold over c_backfill_kinds (see the header).
  c_backfill_ceiling CONSTANT INTERVAL := '30 minutes';
  -- Source: the `interval` default of main_worker.watchdog_loop (60.0 seconds).
  c_watchdog_interval CONSTANT INTERVAL := '60 seconds';

  v_cs_last       TIMESTAMPTZ;
  v_cs_errs       INTEGER;
  v_cs_cause      TEXT;
  v_cs_gap        BIGINT;
  v_bf_last_claim TIMESTAMPTZ;
  v_bf_waiting    BOOLEAN;
  v_bf_stuck      BOOLEAN;
  v_bf_cause      TEXT;
  v_bf_gap        BIGINT;
  v_posts         BIGINT := 0;

  -- The Vault + system_settings + pg_net read, copied from cron_sync_tick().
  v_key TEXT;
  v_cnt INTEGER;
  v_url TEXT;
  v_req BIGINT;
  -- ⛔ THE DESTINATION ALLOW-LIST, layer (b). BYTE-IDENTICAL to the CHECK
  --    constraint's expression on system_settings and to the constant in
  --    cron_sync_tick() and match_engine_cron_tick().
  c_url_allowed CONSTANT TEXT :=
    '^(https://[a-z0-9][a-z0-9.-]*\.up\.railway\.app|http://127\.0\.0\.1:9)$';
BEGIN
  -- ----- ARM 1: the cron_sync heartbeat --------------------------------
  -- Narrowed by cron_name, and by a CLOSED row: a heartbeat is a completed run.
  SELECT max(r.completed_at) INTO v_cs_last
    FROM public.cron_runs r
   WHERE r.cron_name = 'cron_sync'
     AND r.completed_at IS NOT NULL;

  -- How many of the TWO newest closed rows are `error`. Zero rows counts 0.
  SELECT count(*) FILTER (WHERE t.status = 'error') INTO v_cs_errs
    FROM (
      SELECT r.status
        FROM public.cron_runs r
       WHERE r.cron_name = 'cron_sync'
         AND r.completed_at IS NOT NULL
       ORDER BY r.completed_at DESC
       LIMIT 2
    ) t;

  -- ⛔ THE NULL LEG IS WRITTEN FIRST AND EXPLICITLY. An absent heartbeat is the
  -- LOUDEST signal (the sync has never run), and a bare interval comparison
  -- against NULL yields NULL, which every IF in plpgsql treats as FALSE, i.e.
  -- reports healthy. That silent-healthy shape is the defect class this phase
  -- exists to remove.
  IF v_cs_last IS NULL THEN
    v_cs_cause := 'never_ran';
  ELSIF v_cs_last < now() - c_cron_sync_ceiling THEN
    v_cs_cause := 'heartbeat_stale';
  ELSIF v_cs_errs >= 2 THEN
    v_cs_cause := 'two_consecutive_errors';
  END IF;

  -- A DURATION in whole minutes, null when the sync never ran.
  v_cs_gap := CASE
                WHEN v_cs_last IS NULL THEN NULL
                ELSE floor(extract(epoch FROM (now() - v_cs_last)) / 60)::BIGINT
              END;

  -- ----- ARM 2: the backfill queue -------------------------------------
  -- The newest claim over the backfill kinds, any status: a claim is the proof
  -- a worker is alive. Null when none was ever claimed.
  SELECT max(j.claimed_at) INTO v_bf_last_claim
    FROM public.compute_jobs j
   WHERE j.kind = ANY (c_backfill_kinds);

  -- An ELIGIBLE job is one the worker could claim now and has not, for longer
  -- than the ceiling. `done_pending_children` is waiting on a parent, not on a
  -- worker, so it is not eligible.
  SELECT EXISTS (
           SELECT 1
             FROM public.compute_jobs j
            WHERE j.kind = ANY (c_backfill_kinds)
              AND j.status IN ('pending', 'failed_retry')
              AND j.next_attempt_at <= now() - c_backfill_ceiling
         ) INTO v_bf_waiting;

  -- A running job past the ceiling PLUS one watchdog tick: the watchdog should
  -- already have reclaimed it.
  SELECT EXISTS (
           SELECT 1
             FROM public.compute_jobs j
            WHERE j.kind = ANY (c_backfill_kinds)
              AND j.status = 'running'
              AND j.claimed_at < now() - (c_backfill_ceiling + c_watchdog_interval)
         ) INTO v_bf_stuck;

  IF v_bf_waiting
     AND (v_bf_last_claim IS NULL OR v_bf_last_claim < now() - c_backfill_ceiling) THEN
    v_bf_cause := 'backfill_queue_stalled';
  ELSIF v_bf_stuck THEN
    v_bf_cause := 'backfill_running_stuck';
  END IF;

  v_bf_gap := CASE
                WHEN v_bf_last_claim IS NULL THEN NULL
                ELSE floor(extract(epoch FROM (now() - v_bf_last_claim)) / 60)::BIGINT
              END;

  -- ----- THE OBSERVER'S OWN ROW, BEFORE any outbound call --------------
  INSERT INTO public.cron_runs (cron_name, started_at, completed_at, status, error, metadata)
  VALUES (
    'ops_staleness_check',
    now(),
    now(),
    CASE WHEN v_cs_cause IS NOT NULL OR v_bf_cause IS NOT NULL THEN 'error' ELSE 'ok' END,
    CASE
      WHEN v_cs_cause IS NOT NULL OR v_bf_cause IS NOT NULL
        THEN format('ops_staleness_check: cron_sync=%s backfill=%s',
                    COALESCE(v_cs_cause, 'ok'), COALESCE(v_bf_cause, 'ok'))
      ELSE NULL
    END,
    jsonb_build_object(
      'cron_sync_cause', v_cs_cause,
      'cron_sync_gap_minutes', v_cs_gap,
      'backfill_cause', v_bf_cause,
      'backfill_gap_minutes', v_bf_gap
    )
  );

  -- Healthy on both arms: nothing to page.
  IF v_cs_cause IS NULL AND v_bf_cause IS NULL THEN
    RETURN 0;
  END IF;

  -- ----- A page is due: resolve the key and the destination ------------
  -- THE VAULT READ — ONE statement, count and value off the SAME scan. Not
  -- `INTO STRICT`: STRICT would replace the by-name absent-key message with a
  -- generic P0002.
  SELECT count(*), max(decrypted_secret) INTO v_cnt, v_key
    FROM vault.decrypted_secrets
   WHERE name = 'analytics_service_key';
  IF v_cnt > 1 THEN
    RAISE EXCEPTION 'analytics_service_key is not unique in vault (% rows) — refusing to pick one', v_cnt;
  END IF;
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'analytics_service_key missing from vault — refusing to send a null header';
  END IF;

  SELECT s.value INTO v_url
    FROM public.system_settings s
   WHERE s.key = 'analytics_service_url';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE EXCEPTION 'analytics_service_url missing from system_settings — refusing to post to a null url';
  END IF;

  -- ⛔ AND IT MUST BE A DESTINATION THE ALLOW-LIST PERMITS (T-164.7-06, layer
  -- (b)). This re-test is the last thing between an admin-writable row and a
  -- live service key in an outbound header.
  --
  -- ⚠️ THE MESSAGE DOES NOT ECHO THE OFFENDING URL. RAISE text lands in the cron
  -- job-run row, the Postgres log and whatever ships those onward; echoing an
  -- attacker-chosen string writes their collector's hostname into every
  -- downstream reader. Name the SETTING, never its value (T-161.1-10).
  IF v_url !~ c_url_allowed THEN
    RAISE EXCEPTION 'analytics_service_url in system_settings is not an allowed destination — refusing to post the analytics service key. The offending value is deliberately NOT echoed here; read it with an admin session. Allowed: an https host under .up.railway.app';
  END IF;

  -- ⚠️ net.http_post is ASYNC. The BIGINT it returns is a REQUEST ID, not an HTTP
  -- status. NOTHING below is wrapped in an exception handler that swallows: if
  -- net.http_post is absent or errors, this function RAISES and the tick is red.
  -- An alarm that catches its own delivery failure and returns normally reports
  -- success for a message nobody received.
  IF v_cs_cause IS NOT NULL THEN
    SELECT net.http_post(
             url := v_url || '/api/prober-cadence-alert',
             headers := jsonb_build_object(
                          'Content-Type', 'application/json',
                          'X-Service-Key', v_key
                        ),
             body := jsonb_build_object(
                       'cron_name', 'cron_sync',
                       'gap_minutes', v_cs_gap,
                       'ceiling', c_cron_sync_ceiling::text,
                       'detected_at', now(),
                       'cause', v_cs_cause
                     ),
             timeout_milliseconds := 60000
           ) INTO v_req;
    v_posts := v_posts + 1;
  END IF;

  IF v_bf_cause IS NOT NULL THEN
    SELECT net.http_post(
             url := v_url || '/api/prober-cadence-alert',
             headers := jsonb_build_object(
                          'Content-Type', 'application/json',
                          'X-Service-Key', v_key
                        ),
             body := jsonb_build_object(
                       'cron_name', 'backfill',
                       'gap_minutes', v_bf_gap,
                       'ceiling', c_backfill_ceiling::text,
                       'detected_at', now(),
                       'cause', v_bf_cause
                     ),
             timeout_milliseconds := 60000
           ) INTO v_req;
    v_posts := v_posts + 1;
  END IF;

  RETURN v_posts;
END
$ops$;

REVOKE ALL ON FUNCTION public.ops_staleness_check() FROM PUBLIC, anon, authenticated, service_role;

-- ───────────── postcondition — CATALOGUE ONLY
DO $postcondition$
DECLARE
  v_con  text;
  v_name text;
  v_body text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_con
    FROM pg_constraint c
   WHERE c.conrelid = 'public.system_settings'::regclass
     AND c.conname  = 'system_settings_analytics_service_url_allowed';
  IF v_con IS NULL OR position('= ANY' IN v_con) <> 0 OR position('[a-z0-9][a-z0-9.-]*' IN v_con) = 0 THEN
    RAISE EXCEPTION 'Rollback 20261127130000 aborted: the CHECK is not the previous suffix rule; it reads: %', v_con;
  END IF;
  FOREACH v_name IN ARRAY ARRAY['match_engine_cron_tick', 'prod_prober_cadence_check', 'cron_sync_tick', 'ops_staleness_check'] LOOP
    v_body := pg_get_functiondef(to_regprocedure('public.' || v_name || '()'));
    IF position('c_url_allowed' IN v_body) = 0 OR position('c_allowed_origins' IN v_body) <> 0 THEN
      RAISE EXCEPTION 'Rollback 20261127130000 aborted: % does not carry the previous suffix-rule body', v_name;
    END IF;
  END LOOP;
END
$postcondition$;
