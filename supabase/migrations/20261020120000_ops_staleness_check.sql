-- Migration: public.ops_staleness_check() — the READER that turns the daily
-- trade-sync heartbeat and the backfill queue into a page. Phase 164.6.8
-- (OUTAGEALERT) / plan 02 / SC-1, D-10 and D-11.
--
-- WHAT THIS CLOSES. Two booked gaps share one reader:
--   * `[167.1.2.2.2-TRADESYNC-STALENESS-ALARM]` — `/api/cron-sync` writes ONE
--     closed `public.cron_runs` row per run under `cron_name = 'cron_sync'`
--     (routers/cron.py, `_cron_sync_heartbeat_row`), and nothing read it. This
--     is also item 4 of `[167.1.2.2.2-CRON-TICK-RESIDUALS]`: nothing read the run.
--   * `167.1.2.2-BACKFILL-STALENESS-ALARM` — the dedicated backfill worker has no
--     heartbeat writer, so its staleness is a `public.compute_jobs` QUEUE read.
-- Both gates say "reaches a human without one running a query". This function is
-- the reader; the page itself is delivered by the EXISTING route
-- `POST /api/prober-cadence-alert` (analytics-service/routers/cron.py), which
-- plan 01 of this phase wires to Sentry and the founder email.
--
-- WHAT THIS SHIPS AND WHAT IT DOES NOT.
-- It ships one SECURITY DEFINER function, a COMMENT, a REVOKE and a
-- catalogue-only self-verifying block. ⛔ It does NOT register anything: the
-- file never makes the pg_cron schedule call, and says so in this header only
-- by that description. Registration is a live PROD operation owned by plan 09
-- of this phase (marker query first), documented in the go-live runbook that
-- plan 05 writes. Until then nothing invokes this function.
--
-- THE TWO ARMS (D-10, D-11).
--   1. cron_sync. Pages when the newest closed `cron_sync` row is older than
--      `c_cron_sync_ceiling` (D-11; the same 2 days as D-05 of 167.1.2.2.2), when
--      no such row exists, or when the two newest closed rows are BOTH `error`.
--      Causes, first match wins in this order: `never_ran`, `heartbeat_stale`,
--      `two_consecutive_errors`. One `error` row is not a page; two in a row is.
--   2. backfill. Pages when eligible backfill-kind jobs wait unclaimed past the
--      derived ceiling (`backfill_queue_stalled`), or when a `running`
--      backfill-kind job outlives that ceiling plus one watchdog tick
--      (`backfill_running_stuck`).
--
-- ⛔ THE BACKFILL CONSTANTS ARE DERIVED, NOT CHOSEN, AND ARE PINNED.
--   * the kind list is `main_worker.BACKFILL_KINDS`;
--   * the ceiling is the LARGEST watchdog stall threshold over those kinds:
--     `WATCHDOG_PER_KIND_OVERRIDES['derive_broker_dailies']` is 30 minutes, and
--     `derive_allocator_equity` has no override so it takes the watchdog's
--     global default of 10 minutes. A live worker either finishes a job, fails
--     it, or has it reclaimed by the watchdog within that largest threshold, so
--     a queue that has shown no claim for longer is not a worker mid-crawl;
--   * the extra slack on a running job is the watchdog's own tick cadence, the
--     `interval` default of `main_worker.watchdog_loop` (60 seconds): a job past
--     its threshold is reclaimed on the NEXT tick, not instantly.
--   `analytics-service/tests/test_ops_staleness_parity.py` reads this file and
--   `main_worker` and fails when either side moves alone. A kind added to the
--   worker but not here would leave that kind's stall silent; a ceiling below the
--   watchdog's would page on a healthy long crawl.
--
-- NO "RECOVERED" NOTICE. D-06 is MT5-specific. This reader only pages; the
-- absence of a recovery message for these two sources is deliberate, not an
-- omission.
--
-- THE GUARD IS A COPY, NOT A FIX. The Vault read, the url read and the allow-list
-- re-test below are copied as they stand in `public.cron_sync_tick()`
-- (20261010140000_cron_sync_tick.sql), the NEWEST definition of that guard. The
-- known residuals of `[167.1.2.2.2-CRON-TICK-RESIDUALS]` items 1 to 3 (suffix
-- wildcard allow-list, a separate retry/RAISE concern, whitespace-only trimming)
-- ride a separate forward migration that fixes all the sibling functions
-- together; they are deliberately not re-fixed in one copy here.
--
-- THE OBSERVER ROW. Every call writes ONE `public.cron_runs` row under
-- `cron_name = 'ops_staleness_check'` (status `error` when either arm is stale,
-- else `ok`), BEFORE any outbound call, so this reader's own liveness is
-- readable the same way the heartbeats it watches are. Its text and metadata
-- carry cause NAMES and integer minutes only, never a url, a key or a setting
-- value. ⚠️ A RAISE after that INSERT rolls the row back with the rest of the
-- call; a tick that could not deliver leaves NO row, and that absence is itself
-- the next tick's evidence (the same trade the prober-cadence observer makes).
--
-- ⛔ FORWARD MIGRATION ONLY. Nothing here edits an applied migration file, and
-- nothing here runs `supabase db push`, `db reset`, `--project-ref` or
-- `--db-url`. This checkout's Supabase CLI is linked to PRODUCTION; this
-- migration reaches PROD only by merge, then apply-test, then the automatic PROD
-- apply. There is no human stop between the merge and the PROD apply, so every
-- review happens before the merge.
--
-- ⛔ CATALOGUE-ONLY VERIFY, BY DESIGN. The block at the foot never calls the
-- function (an apply-time call would fire a real HTTP POST the moment this
-- merges) and never counts rows. Shared TEST carries PROD's catalogue and EMPTY
-- tables, so a data-reading check that refuses on an empty table would block the
-- PROD apply ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]).

-- --------------------------------------------------------------------------
-- STEP 1: public.ops_staleness_check()
-- --------------------------------------------------------------------------
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

COMMENT ON FUNCTION public.ops_staleness_check() IS
  'Phase 164.6.8 / plan 02 (OUTAGEALERT): the READER that pages on a stale '
  'cron_sync heartbeat (none ever, older than 2 days, or two consecutive error '
  'rows) and on a stalled backfill queue (eligible jobs unclaimed past the '
  'derived ceiling, or a running job outliving it plus one watchdog tick). '
  'Posts one alert per stale arm to /api/prober-cadence-alert on the analytics '
  'service with a cron_name and a cause, reads the service key from the Vault '
  'in ONE scan and re-tests the url against the destination allow-list without '
  'echoing it, and writes ONE observer row to public.cron_runs per call. '
  'Returns the number of posts queued (0 when healthy); that number is a count '
  'of REQUESTS and not of deliveries. EXECUTE is held by the owner alone. This '
  'function registers nothing: the pg_cron registration is a live PROD '
  'operation owned by the go-live runbook.';

-- --------------------------------------------------------------------------
-- STEP 2: grants
-- --------------------------------------------------------------------------
-- service_role is REVOKEd alongside PUBLIC, anon and authenticated: Supabase's
-- default ACL auto-grants EXECUTE to service_role on every new public function,
-- and this function reads a live service key out of the Vault as its DEFINER and
-- posts it in an outbound header. A grant would let any service_role holder
-- (every Next.js createAdminClient() route, the Python analytics service) force
-- a live, secret-bearing net.http_post on demand and write observer rows to mask
-- or spam the monitoring signal ([164.7-WR02-SERVICE-ROLE-EXECUTE], found and
-- fixed once for the sibling).
--
-- NO GRANT follows. The scheduler runs as the owner, and an owner needs no grant.
REVOKE ALL ON FUNCTION public.ops_staleness_check() FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block (catalogue only)
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip. Asserts SHAPE, never
-- behaviour and never data; behaviour is covered by
-- supabase/tests/test_ops_staleness_check.sql.
DO $verify$
DECLARE
  -- ⛔ Every variable is DECLAREd up front: plpgsql compiles a DO block WHOLE.
  v_overloads INTEGER;
  v_nargs     SMALLINT;
  v_secdef    BOOLEAN;
  v_config    TEXT[];
  v_srchpath  TEXT;
  v_owner     TEXT;
  v_defowner  TEXT;
  v_bypass    BOOLEAN;
  v_super     BOOLEAN;
  v_grantees  TEXT;
BEGIN
  -- 0. THE NAME RESOLVES TO EXACTLY ONE FUNCTION, asserted first because every
  --    check after it reads (schema, name) and `SELECT … INTO` without STRICT
  --    takes the first of several rows in silence. A SECURITY DEFINER overload
  --    created without an explicit REVOKE carries the default ACL, which grants
  --    EXECUTE to PUBLIC.
  SELECT count(*) INTO v_overloads
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ops_staleness_check';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'Migration 20261020120000: public.ops_staleness_check resolves to % functions in schema public, expected exactly 1. The checks below read (schema, name) with no signature, so an overload carrying the default ACL could sit in the catalogue with every check reporting green', v_overloads;
  END IF;

  -- 1. Exists and takes NO arguments. A caller-supplied url or key on a
  --    SECURITY DEFINER function is the attack surface (T-161.1-10).
  SELECT p.pronargs, p.prosecdef, p.proconfig
    INTO v_nargs, v_secdef, v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ops_staleness_check';
  IF v_nargs <> 0 THEN
    RAISE EXCEPTION 'Migration 20261020120000: ops_staleness_check takes % argument(s), expected 0 — a caller-supplied url or key on a SECURITY DEFINER function lets any caller who can EXECUTE it aim the service key at a host of their choosing', v_nargs;
  END IF;

  -- 2. SECURITY DEFINER with a pinned search_path, compared BY VALUE (a prefix
  --    test is satisfied by an empty path or one led by a schema a caller can
  --    create objects in).
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Migration 20261020120000: ops_staleness_check is not SECURITY DEFINER, so it reads the secret store and the heartbeat table as the CALLER and the reads fail for every role that is not the owner';
  END IF;
  SELECT c INTO v_srchpath
    FROM unnest(COALESCE(v_config, ARRAY[]::TEXT[])) AS c
   WHERE c LIKE 'search_path=%';
  IF v_srchpath IS NULL THEN
    RAISE EXCEPTION 'Migration 20261020120000: ops_staleness_check does not pin search_path at all (proconfig=%). On a SECURITY DEFINER function that is a privilege-escalation route', v_config;
  END IF;
  IF regexp_replace(v_srchpath, '\s', '', 'g') <> 'search_path=public,pg_catalog' THEN
    RAISE EXCEPTION 'Migration 20261020120000: ops_staleness_check pins search_path to "%", not to the "public, pg_catalog" its own declaration sets', v_srchpath;
  END IF;

  -- 2b. THE DEFINER ROLE IS EXEMPT FROM ROW SECURITY: `rolsuper OR rolbypassrls`,
  --     NEVER rolbypassrls alone (a superuser bypasses row security with that
  --     flag still FALSE). public.compute_jobs carries FORCE ROW LEVEL SECURITY
  --     plus a deny-all policy, and the backfill arm reads it as the DEFINER.
  --     FORCE is the one clause under which OWNING the table is not an
  --     exemption, so a non-exempt owner reads zero rows and the backfill arm
  --     reports healthy forever. Same assertion as 20260924120000 check 3.
  SELECT r.rolname, r.rolbypassrls, r.rolsuper
    INTO v_defowner, v_bypass, v_super
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public' AND p.proname = 'ops_staleness_check';
  IF v_defowner IS NULL THEN
    RAISE EXCEPTION 'Migration 20261020120000: could not resolve the owner of public.ops_staleness_check — pg_proc.proowner has no matching pg_roles row';
  END IF;
  IF NOT (COALESCE(v_bypass, FALSE) OR COALESCE(v_super, FALSE)) THEN
    RAISE EXCEPTION 'Migration 20261020120000: public.ops_staleness_check is owned by role "%" (rolsuper=%, rolbypassrls=%), which is exempt from row security by neither route. As SECURITY DEFINER it reads public.compute_jobs as that role, and that table carries FORCE ROW LEVEL SECURITY, so the backfill arm would read zero rows and report healthy forever', v_defowner, v_super, v_bypass;
  END IF;

  -- 3. THE WHOLE EXECUTE GRANTEE SET IS EXACTLY THE OWNER. aclexplode over
  --    proacl enumerates the grantees instead of interrogating a guessed list,
  --    so a grantee nobody thought of is a FAILURE rather than a silence.
  --    Compared to the owner's NAME, never the literal 'postgres' (the pg-lane
  --    boots as whatever role it created). COALESCE(proacl, acldefault(…)) makes
  --    a NULL acl explicit: its MEANING is the default ACL, which grants EXECUTE
  --    to PUBLIC.
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
  IF v_grantees IS NULL THEN
    RAISE EXCEPTION 'Migration 20261020120000: could not read the EXECUTE grantee set of public.ops_staleness_check — the function is missing, or it carries no EXECUTE aclitem at all, and an empty answer here is indistinguishable from a locked-down one unless it is refused';
  END IF;
  IF v_grantees IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Migration 20261020120000: EXECUTE on public.ops_staleness_check is held by [%], expected exactly the owner [%]. This function reads a live service key out of the Vault as its DEFINER and posts it in an outbound header; a grantee beyond the owner (the scheduler runs as the owner) can force a live secret-bearing net.http_post on demand', v_grantees, v_owner;
  END IF;

  RAISE NOTICE 'Migration 20261020120000: ops_staleness_check() verified — SECURITY DEFINER, search_path pinned, owner exempt from row security, EXECUTE held by the owner alone';
END
$verify$;
