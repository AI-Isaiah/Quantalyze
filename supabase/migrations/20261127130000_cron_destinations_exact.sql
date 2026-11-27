-- Migration: the analytics destination is exactly two origins, and the blank-key guard names
-- all four whitespace characters. Phase 242 (SECRETSHYGIENE) / plan 02 / requirement SECR-04.
--
-- ⚠️ OPS: merging supabase/migrations/** to main applies this file to shared TEST FIRST
-- (supabase-migrate.yml `apply-test`) and then AUTO-APPLIES it to PROD once that TEST apply
-- succeeds. There is NO human stop between the merge and the PROD apply (founder decision
-- 2026-09-23), so every review this file needs happens BEFORE the merge. It swaps one CHECK
-- constraint and redefines FOUR SECURITY DEFINER functions, each of which posts the Vault
-- service key to the analytics service.
--
-- ⛔ A FORWARD MIGRATION, NOT AN EDIT TO AN APPLIED ONE. Each body re-based here is the latest
-- definition across all migrations. MEASURED 2026-11-27 after fetching origin/main, with
-- grep -alE over supabase/migrations for each function name:
--   match_engine_cron_tick     last defined by 20260911120000_vault_tick_hardening.sql
--   prod_prober_cadence_check  last defined by 20260918120000_prod_prober_cadence.sql
--   cron_sync_tick             last defined by 20261010140000_cron_sync_tick.sql
--   ops_staleness_check        last defined by 20261020120000_ops_staleness_check.sql
-- and the CHECK by 20260907120000_analytics_service_settings_and_vault_tick.sql alone. Each
-- committed snapshot under supabase/schema/functions/ names that same source migration, and
-- --diff-bodies reads MATCH between each snapshot and supabase/schema/baseline.sql (PROD's
-- dump) before this file existed.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE DEFECT
-- ══════════════════════════════════════════════════════════════════════════
-- 1. The destination rule was a SUFFIX WILDCARD: any https host under the Railway app domain.
--    system_settings_admin_all is FOR ALL TO authenticated, so an app-admin can PATCH the
--    analytics_service_url row through PostgREST, and any service_role holder can write it
--    directly. Pointing it at another Railway subdomain passed both layers (the CHECK that
--    refuses to STORE the value and the in-body re-test that refuses to POST to it), and the
--    next tick posted the live analytics_service_key in an X-Service-Key header to whoever
--    registered that subdomain (T-164.7-06). The wildcard bought nothing: the one host the
--    service really has is the production origin below.
-- 2. The blank-key guard trimmed SPACES ONLY. A Vault secret of tabs, carriage returns or
--    newlines passed it, produced a useless header, and was answered 401 asynchronously by
--    the analytics service behind a green tick (net.http_post is fire-and-forget).
-- Closes items 1 and 3 of [167.1.2.2.2-CRON-TICK-RESIDUALS]. Item 2 (the gate never compared
-- the posted header with the Vault secret) is closed in supabase/tests/test_cron_sync_tick.sql.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE DELTA (the whole of it, applied to every body)
-- ══════════════════════════════════════════════════════════════════════════
--   1. The pattern constant becomes c_allowed_origins, a TEXT[] of exactly two origins: the
--      production origin https://quantalyze-analytics-production.up.railway.app and the
--      loopback discard literal http://127.0.0.1:9 the test lanes use.
--   2. The destination guard compares by EQUALITY against that array, never by pattern.
--   3. The blank-key guard trims an explicit character set: space, tab, carriage return and
--      newline.
--   4. The refusal keeps its "not an allowed destination" wording and its rule of never echoing
--      the stored value, and its tail now names the two exact origins from the same constant
--      the guard reads.
--   The CHECK on system_settings is replaced by the same two-origin equality (one ALTER TABLE
--   statement), with a COMMENT ON CONSTRAINT saying why. Every other line of every body is the
--   source migration's text, byte for byte, the dollar-quote tag included. The only other
--   changes are the comment sentences that described the old trim or the old suffix rule.
--   There is NO helper function (DISC-HELPER): a function called from a CHECK needs EXECUTE for
--   every role that writes system_settings, so a writer without it would fail with
--   permission denied even on an unrelated key, and a PUBLIC grant would expose an RPC and break
--   the owner-alone EXECUTE posture of the four ticks. Five spellings of one set (the CHECK
--   and four bodies) are cross-checked by the verify block at the foot instead.
--
--   Moving the analytics service to another host now needs a forward migration FIRST. That is
--   the intended cost of the control, not a limitation of it.
--
-- ══════════════════════════════════════════════════════════════════════════
-- FUNCTION ORDER (pinned)
-- ══════════════════════════════════════════════════════════════════════════
--   match_engine_cron_tick, prod_prober_cadence_check, cron_sync_tick, ops_staleness_check.
--   The gates' machine-executable twins address a body inside this file by `nth` match, so a
--   reorder here moves every `nth` in every gate that names this file.
--
-- ══════════════════════════════════════════════════════════════════════════
-- GATES THAT MEASURE THIS FILE
-- ══════════════════════════════════════════════════════════════════════════
-- The verify block at the foot asserts only SHAPE (one overload, SECURITY DEFINER, pinned
-- search_path, owner-alone EXECUTE, both origins present in each comment-stripped body and in
-- the CHECK, the old pattern fragment absent from the CHECK). It deliberately asserts neither
-- the guard line, the key-guard line, the refusal tail nor the post lines: the gates' twins edit
-- exactly those, and an assertion over them would abort the mutated apply, which the mutation
-- runner scores as a defect instead of a bite. Behaviour lives in the supabase/tests gates.
-- The verify needles are assembled by concatenation so that none is a second raw copy of a
-- string a twin counts.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 / DRIFT-02
-- ══════════════════════════════════════════════════════════════════════════
-- Four existing bodies change, so VAC-04 requires one acknowledgement per function of PROD's
-- current body. MEASURED 2026-11-27 with the gate's own normalizer, per function, after
-- regenerating the snapshots for this file:
--
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/<fn>.sql supabase/schema/baseline.sql
--
-- Each row reads DRIFT, and the acked hash is the `live` column (the FIFTH tab-separated
-- field), not a whole-file digest. Each equals the function's snapshot hash before this file,
-- because the baseline was dumped from PROD and the snapshots matched it.
--
-- ⚠️ EACH ACK IS EARNED only if VAC-04 on the PR reports that SAME hash for PROD. If it reports
-- a different one, PROD drifted out of band: fold the difference into this migration and
-- re-derive, never edit a pragma to match a log.
--
-- match_engine_cron_tick, the DRIFT row's `live` column:
-- prod-body-ack: 277f02d6d0cfdffab2269fb3a146e9dc78cb47f47c7217101748fd47d5a65bd6
--
-- prod_prober_cadence_check, the DRIFT row's `live` column:
-- prod-body-ack: 7555dbdeabf467c199fa48dba1a24344ebe7597e605d8574df06eafa3100fccc
--
-- cron_sync_tick, the DRIFT row's `live` column:
-- prod-body-ack: 2816b95cff1895d8201da70bf7dcd8ee5833dc0b8d94593a7369899da60d167e
--
-- ops_staleness_check, the DRIFT row's `live` column:
-- prod-body-ack: bc790f0c9ba9382247555ece7cc484bddf861ff778c6c5cb06060093b4925abb
--
-- ⚠️ EXPECTED PR REDS, NOT DEFECTS: baseline-content-drift-check reads four DRIFT rows (the four
-- functions) until the post-apply bot re-dump merges, and no allowlist row is added; test-db-drift
-- (VAC-08) may read red for this file's ledger row until apply-test runs on merge.
--
-- ⛔ Self-verify posture. The block at the foot reads CATALOGUES ONLY. It reads no row and counts
-- nothing and never calls a function (an apply-time call would fire a real HTTP POST), so it
-- cannot pass PROD and refuse on shared TEST, which holds PROD's catalogue and never its data.
-- ADD CONSTRAINT validates the existing rows: the seed row, PROD and TEST all hold a member of
-- the set. If it ever aborts an apply, the cause is a row set out of band to another origin,
-- which is a state to STOP and read, not to admit with NOT VALID.
--
-- The rollback is manual and off the auto-apply path:
-- supabase/migrations/down/20261127130000-rollback.sql.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: the CHECK, exactly two origins
-- ==========================================================================
-- ADD CONSTRAINT takes an ACCESS EXCLUSIVE lock on system_settings for a validation over a
-- handful of rows. On a lock wait the apply fails loud and is re-run.
ALTER TABLE public.system_settings
  DROP CONSTRAINT IF EXISTS system_settings_analytics_service_url_allowed,
  ADD CONSTRAINT system_settings_analytics_service_url_allowed
    CHECK (key <> 'analytics_service_url' OR value = ANY (ARRAY['https://quantalyze-analytics-production.up.railway.app', 'http://127.0.0.1:9']));

COMMENT ON CONSTRAINT system_settings_analytics_service_url_allowed
  ON public.system_settings IS
  'T-164.7-06 / Phase 242: pins the analytics_service_url row to EXACTLY two origins, the '
  'production analytics origin and the loopback discard literal, compared by equality and never '
  'by pattern. system_settings_admin_all is FOR ALL TO authenticated, so an app-admin can PATCH '
  'that row through PostgREST, and one tick later the Vault-held analytics service key arrives at '
  'whatever origin it names. A suffix wildcard let another Railway subdomain through. Moving the '
  'analytics host now needs a forward migration that edits this constraint and the four bodies '
  'that re-test it (match_engine_cron_tick, prod_prober_cadence_check, cron_sync_tick, '
  'ops_staleness_check) first, which is the intended cost.';

-- ==========================================================================
-- STEP 2a: public.match_engine_cron_tick()
-- ==========================================================================
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
  -- ⛔ THE DESTINATION ALLOW-LIST, layer (b): exactly two origins, compared by
  --    EQUALITY and never by pattern, the same two the CHECK constraint on
  --    system_settings admits. The Phase 242 migration's verify block reads the
  --    constraint and every body that posts the key back out of the catalogue
  --    and asserts both origins are present in each. Two copies of one rule is
  --    the point: the constraint is one ALTER TABLE away from gone, and this is
  --    what still refuses the POST when it is.
  c_allowed_origins CONSTANT TEXT[] := ARRAY['https://quantalyze-analytics-production.up.railway.app', 'http://127.0.0.1:9'];
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
  -- The trim names its character set: space, tab, carriage return and newline.
  -- btrim() with no set trims spaces only, so a key of tabs or newlines would
  -- pass and produce a header the analytics service answers 401 to behind a
  -- green tick. Widened in Phase 242 (SECR-04).
  IF v_key IS NULL OR btrim(v_key, E' \t\r\n') = '' THEN
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
  IF NOT (v_url = ANY (c_allowed_origins)) THEN
    RAISE EXCEPTION 'analytics_service_url in system_settings is not an allowed destination — refusing to post the analytics service key. The offending value is deliberately NOT echoed here; read it with an admin session. Allowed: exactly %', array_to_string(c_allowed_origins, ' or ');
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

-- The owner-alone ACL, restated. Nothing is granted.
REVOKE ALL ON FUNCTION public.match_engine_cron_tick() FROM PUBLIC, anon, authenticated, service_role;

-- ==========================================================================
-- STEP 2b: public.prod_prober_cadence_check()
-- ==========================================================================
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
  c_allowed_origins CONSTANT TEXT[] := ARRAY['https://quantalyze-analytics-production.up.railway.app', 'http://127.0.0.1:9'];
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
  IF v_key IS NULL OR btrim(v_key, E' \t\r\n') = '' THEN
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
  IF NOT (v_url = ANY (c_allowed_origins)) THEN
    RAISE EXCEPTION 'analytics_service_url in system_settings is not an allowed destination — refusing to post the analytics service key. The offending value is deliberately NOT echoed here; read it with an admin session. Allowed: exactly %', array_to_string(c_allowed_origins, ' or ');
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

-- The owner-alone ACL, restated. Nothing is granted.
REVOKE ALL ON FUNCTION public.prod_prober_cadence_check() FROM PUBLIC, anon, authenticated, service_role;

-- ==========================================================================
-- STEP 2c: public.cron_sync_tick()
-- ==========================================================================
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
  -- ⛔ THE DESTINATION ALLOW-LIST, layer (b): exactly two origins, compared by
  --    EQUALITY and never by pattern, the same two the CHECK constraint on
  --    system_settings admits and the same two the three sibling ticks carry.
  --    The constraint is one ALTER TABLE away from gone, and this is what
  --    still refuses the POST when it is.
  c_allowed_origins CONSTANT TEXT[] := ARRAY['https://quantalyze-analytics-production.up.railway.app', 'http://127.0.0.1:9'];
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
  -- The trim names its character set: space, tab, carriage return and newline.
  -- btrim() with no set trims spaces only, so a key of tabs or newlines would
  -- pass and produce a header the analytics service answers 401 to behind a
  -- green tick. Widened in Phase 242 (SECR-04).
  IF v_key IS NULL OR btrim(v_key, E' \t\r\n') = '' THEN
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
  IF NOT (v_url = ANY (c_allowed_origins)) THEN
    RAISE EXCEPTION 'analytics_service_url in system_settings is not an allowed destination — refusing to post the analytics service key. The offending value is deliberately NOT echoed here; read it with an admin session. Allowed: exactly %', array_to_string(c_allowed_origins, ' or ');
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

-- The owner-alone ACL, restated. Nothing is granted.
REVOKE ALL ON FUNCTION public.cron_sync_tick() FROM PUBLIC, anon, authenticated, service_role;

-- ==========================================================================
-- STEP 2d: public.ops_staleness_check()
-- ==========================================================================
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
  -- ⛔ THE DESTINATION ALLOW-LIST, layer (b): exactly two origins, compared by
  --    EQUALITY and never by pattern, the same two the CHECK constraint on
  --    system_settings admits and the same two the other three ticks carry.
  c_allowed_origins CONSTANT TEXT[] := ARRAY['https://quantalyze-analytics-production.up.railway.app', 'http://127.0.0.1:9'];
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
  IF v_key IS NULL OR btrim(v_key, E' \t\r\n') = '' THEN
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
  IF NOT (v_url = ANY (c_allowed_origins)) THEN
    RAISE EXCEPTION 'analytics_service_url in system_settings is not an allowed destination — refusing to post the analytics service key. The offending value is deliberately NOT echoed here; read it with an admin session. Allowed: exactly %', array_to_string(c_allowed_origins, ' or ');
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

-- The owner-alone ACL, restated. Nothing is granted.
REVOKE ALL ON FUNCTION public.ops_staleness_check() FROM PUBLIC, anon, authenticated, service_role;

-- ==========================================================================
-- STEP 3: self-verifying DO block (catalogue only)
-- ==========================================================================
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip. Asserts SHAPE, never behaviour and
-- never data, and nothing a gate twin mutates (see "GATES THAT MEASURE THIS FILE" above).
DO $verify$
DECLARE
  -- Every variable is DECLAREd up front: plpgsql compiles a DO block whole.
  v_names        TEXT[] := ARRAY['match_engine_cron_tick', 'prod_prober_cadence_check', 'cron_sync_tick', 'ops_staleness_check'];
  v_name         TEXT;
  v_overloads    INTEGER;
  v_fn           OID;
  v_secdef       BOOLEAN;
  v_config       TEXT[];
  v_srchpath     TEXT;
  v_extra        INTEGER;
  v_body         TEXT;
  v_con          TEXT;
  -- THE NEEDLES, assembled by CONCATENATION so that no needle is a second raw copy of the text it
  -- asserts is present. Do NOT tidy them into single literals. Each carries its own quotes, so a
  -- longer host that merely starts with the origin cannot satisfy it.
  v_prod_needle  TEXT := '''https://quantalyze-analytics-' || 'production.up.railway.app''';
  v_loop_needle  TEXT := '''http://127.0.0.' || '1:9''';
  v_old_fragment TEXT := '[a-z0-9' || '.-]*';
BEGIN
  FOREACH v_name IN ARRAY v_names LOOP
    -- 0. The name resolves to EXACTLY ONE function. Asserted first because every check after it
    --    reads (schema, name), and a SECURITY DEFINER overload created without an explicit
    --    REVOKE carries the default ACL, which grants EXECUTE to PUBLIC.
    SELECT count(*) INTO v_overloads
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;
    IF v_overloads <> 1 THEN
      RAISE EXCEPTION 'Migration 20261127130000: public.% resolves to % functions in schema public, expected exactly 1', v_name, v_overloads;
    END IF;

    -- 1. It takes NO arguments: a caller-supplied url or key on a SECURITY DEFINER function is the
    --    attack surface.
    v_fn := to_regprocedure('public.' || v_name || '()');
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'Migration 20261127130000: public.%() takes arguments or is missing', v_name;
    END IF;

    -- 2. SECURITY DEFINER with a pinned search_path, compared BY VALUE.
    SELECT p.prosecdef, p.proconfig INTO v_secdef, v_config FROM pg_proc p WHERE p.oid = v_fn;
    IF NOT v_secdef THEN
      RAISE EXCEPTION 'Migration 20261127130000: % is not SECURITY DEFINER, so it reads the secret store as the caller', v_name;
    END IF;
    SELECT c INTO v_srchpath
      FROM unnest(COALESCE(v_config, ARRAY[]::TEXT[])) AS c
     WHERE c LIKE 'search_path=%';
    IF v_srchpath IS NULL OR regexp_replace(v_srchpath, '\s', '', 'g') <> 'search_path=public,pg_catalog' THEN
      RAISE EXCEPTION 'Migration 20261127130000: % must pin search_path to public, pg_catalog (found %)', v_name, v_srchpath;
    END IF;

    -- 3. EXECUTE is held by the OWNER ALONE. aclexplode over proacl enumerates the grantees instead
    --    of interrogating a guessed list; COALESCE(proacl, acldefault(...)) makes a NULL acl
    --    explicit, because its MEANING is the default ACL, which grants EXECUTE to PUBLIC.
    SELECT count(*) INTO v_extra
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_fn AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner;
    IF v_extra <> 0 THEN
      RAISE EXCEPTION 'Migration 20261127130000: % grants EXECUTE to % role(s) besides its owner. It reads a live service key out of the Vault as its DEFINER and posts it in an outbound header, so every extra grantee can force a live secret-bearing request on demand', v_name, v_extra;
    END IF;
    IF has_function_privilege('anon', v_fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20261127130000: anon, authenticated or service_role holds EXECUTE on %', v_name;
    END IF;

    -- 4. The EXECUTABLE text, comments stripped so prose describing a rule cannot satisfy it,
    --    carries both origins. position(), not a pattern match: the claim is byte presence.
    v_body := regexp_replace(regexp_replace(pg_get_functiondef(v_fn), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
    IF v_body IS NULL OR length(v_body) < 500 THEN
      RAISE EXCEPTION 'Migration 20261127130000: the comment-stripped definition of % is % character(s), so the checks below would pass over nothing', v_name, COALESCE(length(v_body), 0);
    END IF;
    IF position(v_prod_needle IN v_body) = 0 OR position(v_loop_needle IN v_body) = 0 THEN
      RAISE EXCEPTION 'Migration 20261127130000: the body of % does not carry both allowed origins as quoted literals, so its re-test is not the exact two-origin rule', v_name;
    END IF;
  END LOOP;

  -- 5. THE CHECK carries both origins and no longer carries the old pattern's character class.
  --    Negative assertion on the CHECK only: a gate twin puts the old pattern back into a BODY.
  SELECT pg_get_constraintdef(c.oid) INTO v_con
    FROM pg_constraint c
   WHERE c.conrelid = 'public.system_settings'::regclass
     AND c.conname  = 'system_settings_analytics_service_url_allowed';
  IF v_con IS NULL THEN
    RAISE EXCEPTION 'Migration 20261127130000: the CHECK system_settings_analytics_service_url_allowed is not on public.system_settings, so an app-admin could PATCH the analytics_service_url row to any host';
  END IF;
  IF position(v_prod_needle IN v_con) = 0 OR position(v_loop_needle IN v_con) = 0 THEN
    RAISE EXCEPTION 'Migration 20261127130000: the CHECK does not carry both allowed origins as quoted literals; it reads: %', v_con;
  END IF;
  IF position(v_old_fragment IN v_con) <> 0 THEN
    RAISE EXCEPTION 'Migration 20261127130000: the CHECK still carries the old suffix pattern; it reads: %', v_con;
  END IF;

  RAISE NOTICE 'Migration 20261127130000: applied (analytics destination pinned to exactly two origins in the CHECK and in 4 key-posting function(s), blank-key guard widened, verified from the catalogues)';
END
$verify$;

COMMIT;
