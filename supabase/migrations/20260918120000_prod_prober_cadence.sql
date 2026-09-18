-- Migration: public.prod_prober_cadence_check() — the PROD-side observer of the
-- prod-prober's contact cadence. Phase 164.1.1 (PROBERCADENCE) / plan 01 /
-- requirement PROBER-CADENCE-UNDELIVERED-01.
--
-- WHAT THIS SHIPS AND WHAT IT DOES NOT.
-- The prober (`.github/workflows/prod-prober.yml`, driven by GitHub Actions'
-- best-effort scheduler — measured 27% hourly delivery) writes ONE
-- `public.cron_runs` row under `cron_name = 'prod_prober'` at the end of every
-- run (D-02). PROD's OWN `pg_cron` — a scheduler that actually fires, unlike
-- GitHub's — is the only place that can watch for that row going stale without
-- sharing the exact failure mode it exists to catch. This migration ships the
-- CALLABLE that watch calls. ⛔ It does NOT call `cron.schedule(...)`: this
-- repo's settled convention (Phase 164.5.1 CRONREPOINT and the ledger-refresh
-- activation before it) treats live PROD `cron.job` registration as a separate,
-- founder-gated live op run against the linked-to-PROD Supabase CLI, documented
-- in a runbook — never inside a migration. Registration is owned by plans 05/06
-- of this phase.
--
-- The function is modelled on `public.match_engine_cron_tick()`
-- (`supabase/schema/functions/match_engine_cron_tick.sql`, canonical body in
-- `supabase/migrations/20260911120000_vault_tick_hardening.sql`) and reuses its
-- destination and its Vault key: `vault.decrypted_secrets` name
-- `analytics_service_key`, `system_settings` key `analytics_service_url`, and
-- the SAME two-layer allow-list regex. This migration adds no credential and
-- widens no allow-list (D-08).
--
-- Per D-01, the `prod_prober` contact rows this function READS need no schema
-- change. Four facts, VERIFIED rather than assumed (the same four the D-5
-- precedent in `analytics-service/services/mt5_session_episodes.py` names for
-- its own new `cron_name`):
--   * `cron_runs_service_role` is `FOR ALL` with a matching `WITH CHECK`, so a
--     service-role writer (the prober) can insert under this new name with no
--     policy change;
--   * `idx_cron_runs_name_recent (cron_name, completed_at DESC NULLS LAST)`
--     already serves `SELECT max(completed_at) … WHERE cron_name = …`;
--   * `latest_cron_success(p_cron_name)` takes a NAME and does not enumerate
--     them, so a new name raises no false stale alert against it;
--   * every existing SQL gate over `cron_runs` is narrowed by `cron_name`, so a
--     new name cannot perturb one.
--
-- ⛔ FORWARD MIGRATION ONLY. Nothing here edits an applied migration file, and
-- nothing here runs `supabase db push`, `db reset`, `--project-ref` or
-- `--db-url` — this checkout's Supabase CLI is linked to PRODUCTION, and this
-- migration reaches PROD only by merge → apply-test → the Production
-- human-reviewer gate.

-- --------------------------------------------------------------------------
-- STEP 1: public.prod_prober_cadence_check()
-- --------------------------------------------------------------------------
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

-- --------------------------------------------------------------------------
-- STEP 2: the comment correction (D-05)
-- --------------------------------------------------------------------------
-- Replaces the sentence at 20260408113029_cron_heartbeat.sql:48-50 ("Heartbeat
-- rows written by cron jobs at start + completion. Monitored by
-- latest_cron_success() for the 36h stale alert.") — measured 2026-09-18
-- (RESEARCH.md Finding 2) to describe a mechanism nothing ever wired:
-- `latest_cron_success` has zero programmatic callers anywhere in this tree.
--
-- The replacement says what is true, measured 2026-09-18: heartbeat rows are
-- written by several independent producers, each under its own cron_name; the
-- AUTOMATED monitor is public.prod_prober_cadence_check(), watching
-- cron_name = 'prod_prober' and posting an alert when the gap crosses
-- c_contact_ceiling; public.latest_cron_success(p_cron_name) is an ADMIN-ONLY
-- point query with no programmatic caller, used by hand from
-- docs/demos/pre-flight-checklist.md, and it raises no alert of its own.
--
-- ⛔ latest_cron_success() is NOT dropped: it has a real manual reader and an
-- existing REVOKE/GRANT posture, and dropping a SECURITY DEFINER function with
-- grants is a wider act than this phase needs.
COMMENT ON TABLE public.cron_runs IS
  'Heartbeat/episode rows written by several independent producers, each under '
  'its own cron_name (measured 2026-09-18): the FastAPI match-engine cron, the '
  'prod-prober (cron_name=prod_prober), MT5 session episodes, the ledger '
  'refresh fan-out, and this table''s own observer. The AUTOMATED monitor is '
  'public.prod_prober_cadence_check(), which watches cron_name=prod_prober and '
  'posts an alert via net.http_post when the gap since the last contact crosses '
  'c_contact_ceiling (declared inside that function). '
  'public.latest_cron_success(p_cron_name) is an ADMIN-ONLY point query with no '
  'programmatic caller anywhere in this tree — used by hand from '
  'docs/demos/pre-flight-checklist.md — and it raises no alert of its own.';

-- ⚠️ GUARDED, DELIBERATELY. `COMMENT ON FUNCTION public.latest_cron_success(TEXT)`
-- is a STATIC statement — it resolves the target signature at PARSE time, not
-- at call time the way a plpgsql body does — so it would abort this migration
-- on any database where that function does not exist. On PROD and on shared
-- TEST it always exists (20260408113029_cron_heartbeat.sql creates it and no
-- migration drops it). On the pg-lane the gate's own apply list uses the
-- lighter `33-fixture-cron-runs.sql` stand-in for `cron_runs` — the real
-- heartbeat migration cannot enter that list for the same reason
-- `scripts/pg-lane/fixtures/33-fixture-cron-runs.sql`'s own header gives for
-- the ledger fan-out gates — and that stand-in deliberately does not also
-- model `latest_cron_success`, so the function is absent there. The comment is
-- therefore applied conditionally: present everywhere this migration is
-- reviewed to matter, a harmless no-op on the reduced lane.
DO $latest_cron_success_comment$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'latest_cron_success'
  ) THEN
    COMMENT ON FUNCTION public.latest_cron_success(TEXT) IS
      'ADMIN-ONLY point query: returns the most recent status=''ok'' completion for '
      'a given cron_name, or NULL. It has NO programmatic caller anywhere in this '
      'tree (measured 2026-09-18) and raises no alert of its own — its one reader '
      'is a human running docs/demos/pre-flight-checklist.md by hand. The AUTOMATED '
      'monitor for public.cron_runs is public.prod_prober_cadence_check(), which '
      'watches cron_name=prod_prober and posts an alert on its own schedule.';
  END IF;
END
$latest_cron_success_comment$;

-- --------------------------------------------------------------------------
-- STEP 3: grants
-- --------------------------------------------------------------------------
-- Matching 20260911120000_vault_tick_hardening.sql's STEP 2 (check 6) in
-- shape — NOT 20260409133655_function_execute_hardening.sql, which governs
-- send_intro_with_decision, sync_trades and latest_cron_success, a different
-- family from the cron-tick one this function belongs to.
--
-- NO GRANT follows the REVOKE. The scheduler runs as `postgres` — MEASURED,
-- all 15 rows of scripts/prod-prober/cron-manifest.json carry
-- `username: postgres` — and `postgres` is this function's OWNER, so the
-- owner needs no grant; EXECUTE reaches it through owner privilege, not the
-- ACL.
--
-- ⛔ service_role IS REVOKEd here, explicitly, alongside PUBLIC, anon and
-- authenticated — because Supabase's default ACL auto-grants EXECUTE to
-- service_role on every new public function, and leaving that default in
-- place is the exact defect [164.7-WR02-SERVICE-ROLE-EXECUTE] already found
-- and fixed once for the sibling match_engine_cron_tick() (RESOLVED
-- 2026-09-12, applied to PROD — that entry records the original text had
-- this backwards, "service_role was to be GRANTED explicitly", and that it
-- was corrected during the phase). This function reads a live service key
-- out of vault.decrypted_secrets as its DEFINER; a GRANT here would let any
-- service_role holder (every Next.js createAdminClient() route, the Python
-- analytics-service) invoke it on demand, write arbitrary cron_runs rows
-- under cron_name='prod_prober_cadence_check' to mask or spam the monitoring
-- signal, and force a live secret-bearing net.http_post.
REVOKE ALL ON FUNCTION public.prod_prober_cadence_check() FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip. Asserts the SHAPE
-- only — never invokes the function, which would fire a real HTTP POST (when
-- stale) the moment this migration merges. Behaviour is covered by
-- supabase/tests/test_prod_prober_cadence.sql.
DO $verify$
DECLARE
  v_exists  BOOLEAN;
  v_secdef  BOOLEAN;
  v_config  TEXT[];
  v_srchpath TEXT;
  v_grantees TEXT;
  v_owner    TEXT;
BEGIN
  SELECT TRUE, p.prosecdef, p.proconfig
    INTO v_exists, v_secdef, v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'prod_prober_cadence_check' AND p.pronargs = 0;

  IF v_exists IS NOT TRUE THEN
    RAISE EXCEPTION 'Migration 20260918120000: public.prod_prober_cadence_check() was not created — STEP 1 did not run, or ran under a different schema/signature';
  END IF;

  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Migration 20260918120000: prod_prober_cadence_check is not SECURITY DEFINER, so it cannot read vault.decrypted_secrets or bypass RLS on public.cron_runs as its owner';
  END IF;

  SELECT c INTO v_srchpath
    FROM unnest(COALESCE(v_config, ARRAY[]::TEXT[])) AS c
   WHERE c LIKE 'search_path=%';
  IF v_srchpath IS NULL THEN
    RAISE EXCEPTION 'Migration 20260918120000: prod_prober_cadence_check does not pin search_path at all — on a SECURITY DEFINER function that is a privilege-escalation route';
  END IF;

  -- 4. THE WHOLE EXECUTE GRANTEE SET IS EXACTLY THE OWNER — matching
  --    20260911120000_vault_tick_hardening.sql's check 6 in shape.
  --
  --    ⭐ THE SET, not a subset. The check this replaces probed only
  --    PUBLIC/anon/authenticated and passed with service_role still holding
  --    EXECUTE — the exact shape of defect [164.7-WR02-SERVICE-ROLE-EXECUTE],
  --    already found and fixed once for the sibling match_engine_cron_tick()
  --    and reproduced here until now. aclexplode over proacl enumerates the
  --    actual grantees instead of interrogating a guessed list, so a grantee
  --    nobody thought of is a FAILURE rather than a silence.
  --
  --    ⚠️ COMPARED TO THE OWNER'S NAME, NEVER TO THE LITERAL 'postgres' — the
  --    pg-lane boots as whatever role scripts/pg-lane/run.sh created.
  --
  --    ⚠️ COALESCE(proacl, acldefault(…)) makes a NULL acl explicit: a
  --    function whose privileges were never touched carries NULL proacl,
  --    whose MEANING is the default ACL — and the default ACL for a function
  --    grants EXECUTE to PUBLIC. Reading NULL as "no grantees" would report
  --    the widest possible state as the tightest.
  SELECT g.owner_name, string_agg(g.grantee_name, ',' ORDER BY g.grantee_name)
    INTO v_owner, v_grantees
    FROM (
      SELECT pg_get_userbyid(p.proowner) AS owner_name,
             CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee_name
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
       WHERE n.nspname = 'public'
         AND p.proname = 'prod_prober_cadence_check'
         AND p.pronargs = 0
         AND a.privilege_type = 'EXECUTE'
    ) g
   GROUP BY g.owner_name;
  IF v_grantees IS NULL THEN
    RAISE EXCEPTION 'Migration 20260918120000: could not read the EXECUTE grantee set of public.prod_prober_cadence_check — the function is missing, or it carries no EXECUTE aclitem at all, and an empty answer here is indistinguishable from a locked-down one unless it is refused';
  END IF;
  IF v_grantees IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Migration 20260918120000: EXECUTE on public.prod_prober_cadence_check is held by [%], expected exactly the owner [%]. This function reads a live service key out of the vault as its DEFINER and posts it in an outbound header — a grantee beyond the owner (the scheduler, which runs as postgres and IS the owner) can invoke it on demand to mask/spam the monitoring signal or force a live secret-bearing net.http_post', v_grantees, v_owner;
  END IF;

  RAISE NOTICE 'Migration 20260918120000: prod_prober_cadence_check() verified — SECURITY DEFINER, search_path pinned, EXECUTE held by the owner alone';
END
$verify$;
