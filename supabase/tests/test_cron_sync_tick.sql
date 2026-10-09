-- Test: public.cron_sync_tick() — Phase 167.1.2.2.2 (TRADESYNC) / plan 01.
-- The tick that asks the analytics service to run the daily trade sync posts
-- EXACTLY ONE request, to the sync route, carrying a usable service key, an
-- empty JSON body and a timeout inside the window the plan declares.
--
-- ⛔ WHICH FILE THE ARMS ACTUALLY MEASURE: every edit-kind RED-UNDER-M twin in
-- this file names supabase/migrations/20261010140000_cron_sync_tick.sql, the
-- only migration that defines the function. A twin naming any other file would
-- mutate text that is not the live definition and the arm would report
-- `no-red`.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because the
-- arms share one transaction and each leaves the Vault stand-in and the settings
-- table in a state the next one builds on):
--   0   applied-ness   — the zero-argument function exists; absence is an
--                        EXCEPTION, never a skip.
--   P1  post shape     — one post, to the settings url plus the sync route, a
--                        non-blank X-Service-Key, an empty JSON body, the request
--                        id returned, and a timeout equal to the one the function
--                        declares and inside (120000, 300000).
--   V1  no key         — refuses by name, posts nothing. Deletes the key.
--   V2  blank key      — a whitespace-only key refuses by the same name. Replaces
--                        the key with a blank one.
--   U1  no url         — own setup restores a usable key and deletes the url row;
--                        refuses naming the setting, posts nothing.
--   C2  foreign host   — own setup drops the CHECK constraint and stores a
--                        foreign host (the row U1 removed); refuses naming
--                        "not an allowed destination", posts nothing.
--   C3  no echo        — C2's message must not contain the refused value.
--   G1  grants         — catalogue read; runs last because it needs no state.
-- Every refusal arm also asserts ZERO new net._lane_posts rows, so a refusal that
-- still posts is caught.
--
-- ⚠️ WHY EVERY IDENTITY CARRIES A DIGIT — `P1`, never a bare letter.
-- `sectionOfIdentity` in scripts/mutation-runner/run.mjs collapses a trailing
-- `-SUFFIX` into its parent section only when a digit precedes it, so
-- `P1-SETUP` is a sub-arm of `P1` and is covered by P1's own twin (likewise
-- `V1-SETUP`, `V2-SETUP`, `U1-SETUP`, `C2-SETUP`). The setup guards are vacuity guards ("the fixture reached the state this arm is
-- about"), not claims about the migration, so they carry no twin of their own.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- The final `ALL 8 ARMS EXECUTED (…)` notice at the foot of this file is the
-- sentinel CI's loop reads the arm count off. If you add or remove an arm,
-- update BOTH the integer and the roster on that line.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- `RED-UNDER-M` object that scripts/mutation-runner executes on every push: it
-- mutates COPIES on a throwaway pg-lane cluster, requires the FIRST
-- `TEST FAILED (…)` to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md.
--
-- ⚠️ Apply order: 01/02/07/12/15 are the standard base (core schema, sanitize
-- tables, Supabase bootstrap defaults, profiles.is_admin, auth.role()). 32 is the
-- Vault stand-in and 34 the pg_net stand-in (without them the function dies on a
-- raw 42P01 / 3F000 naming no arm). 33 is the cron_runs stand-in; this function
-- does not touch that table, but 20260907120000 and 20260911120000 are applied
-- on the same list the sibling gates use, and they seed system_settings'
-- allow-listed analytics_service_url. The tick migration is applied LAST.
-- LANE-ONLY: {"object":"net._lane_posts","fixture":"scripts/pg-lane/fixtures/34-fixture-pg-net-stand-in.sql","job":"sql-mutation","reason":"Every arm in this file asserts against the pg-net stand-in that fixture 34's own header marks as never applied to TEST or PROD; shared TEST carries the real pg_net, so a version of this gate made to run there would issue genuine outbound HTTP from shared CI infrastructure on every run; this file's arms execute and are mutation-checked twin-by-twin on the pg-lane under sql-mutation."}
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/32-fixture-vault-stand-in.sql","scripts/pg-lane/fixtures/33-fixture-cron-runs.sql","scripts/pg-lane/fixtures/34-fixture-pg-net-stand-in.sql","supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql","supabase/migrations/20260911120000_vault_tick_hardening.sql","supabase/migrations/20261010140000_cron_sync_tick.sql"]}

BEGIN;

DO $$
DECLARE
  v_msg     TEXT;
  v_state   TEXT;
  v_setup   TEXT;
  v_raised  BOOLEAN;
  v_ret     BIGINT;
  v_cnt     INTEGER;
  v_url     TEXT;
  v_key     TEXT;
  v_body    JSONB;
  v_timeout INTEGER;
  v_post_id BIGINT;
  v_def     TEXT;
  v_want_ms INTEGER;
  -- Arm G1's whole-grantee-set read. Declared here with everything else:
  -- plpgsql compiles a DO block WHOLE, so a missing DECLARE raises 42601 and NO
  -- arm in this file runs.
  v_owner    TEXT;
  v_grantees TEXT;
BEGIN
  -- ===== ARM 0 — applied-ness. ABSENCE IS A FAILURE, NOT A SKIP ===========
  -- RED-UNDER: drop the function on the live lane AFTER the apply list has run,
  --            so the gate meets a database on which the tick migration is not
  --            in force. ⚠️ A `sql` step and NOT an `edit` that typos the CREATE:
  --            the migration's own verify block asserts the function exists and
  --            would RAISE, aborting the apply, so no arm could be the FIRST
  --            failure — the runner would score a defect, not a bite.
  -- RED-UNDER-M: {"arm":"0","apply":[{"kind":"sql","stmt":"DROP FUNCTION public.cron_sync_tick()"}]}
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                   JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'cron_sync_tick' AND p.pronargs = 0) THEN
    RAISE EXCEPTION 'TEST FAILED (0): this database has no zero-argument public.cron_sync_tick(), so every arm below would have died on a raw 42883 naming no arm — or been deleted by a future reader who read that error as "these arms are broken". Either the tick migration has not been applied to this database (apply it and re-run; expect this once on the PR that introduces it, because this repo applies migrations on MERGE and not on PR), or a later migration dropped it, which leaves the daily trade sync with no caller at all. ⛔ Do NOT turn this into a RAISE NOTICE skip.';
  END IF;

  -- ===== ARM P1 — the tick posts ONE request to the sync route ==============
  -- ----- P1-SETUP: a usable key, and a confirmed allow-listed destination ---
  v_setup := NULL;
  BEGIN
    PERFORM vault.create_secret('arm-fixture-key-not-real', 'analytics_service_key', 'phase 167.1.2.2.2 gate fixture');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (P1-SETUP): could not seed analytics_service_key in the vault stand-in (%), so ARM P1 below would be asking whether the function posts when it could never have resolved a key at all.', v_setup;
  END IF;

  -- The destination is seeded by 20260907120000 (an allow-listed .up.railway.app
  -- host). Confirmed rather than assumed: an absent row would make P1 measure
  -- the url guard instead of the post.
  SELECT s.value INTO v_url FROM public.system_settings s WHERE s.key = 'analytics_service_url';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE EXCEPTION 'TEST FAILED (P1-SETUP): public.system_settings has no analytics_service_url row — 20260907120000''s seed did not land, so ARM P1 below cannot reach net.http_post at all.';
  END IF;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.cron_sync_tick();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: lengthen the post path — `'/api/cron-sync'` becomes
  --            `'/api/cron-sync-x'`. The tick then calls a route the analytics
  --            service does not serve, the request is answered 404 and, because
  --            net.http_post is fire-and-forget, the scheduler records a green
  --            tick: the daily sync never runs and nothing says so. The verify
  --            block's path needle is a substring test and is deliberately NOT
  --            what catches this; this arm reads the recorded url whole.
  -- RED-UNDER-M: {"arm":"P1","apply":[{"kind":"edit","file":"supabase/migrations/20261010140000_cron_sync_tick.sql","find":"'/api/cron-sync'","replace":"'/api/cron-sync-x'","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (P1): cron_sync_tick() RAISED with a usable key and an allow-listed url: %. It should have posted and returned a request id, not raised.', COALESCE(v_msg, 'NULL');
  END IF;
  IF v_ret IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (P1): cron_sync_tick() returned NULL with a usable key and an allow-listed url — the BIGINT is the pg_net request id and a post that happened always yields one.';
  END IF;

  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (P1): one tick produced % outbound post(s) to net.http_post, expected EXACTLY 1 — a tick that posts twice syncs twice, and one that posts nothing is the outage this phase exists to end.', v_cnt;
  END IF;

  SELECT p.id, p.url, p.headers ->> 'X-Service-Key', p.body, p.timeout_milliseconds
    INTO v_post_id, v_url, v_key, v_body, v_timeout
    FROM net._lane_posts p ORDER BY p.id DESC LIMIT 1;

  -- The whole url, not a suffix: the host must be the settings row's and the
  -- path must be exactly the sync route.
  IF v_url IS DISTINCT FROM (SELECT s.value FROM public.system_settings s WHERE s.key = 'analytics_service_url') || '/api/cron-sync' THEN
    RAISE EXCEPTION 'TEST FAILED (P1): the recorded post''s url is %, expected the analytics_service_url setting followed by /api/cron-sync — a tick aimed at any other path runs green and syncs nothing.', COALESCE(v_url, 'NULL');
  END IF;
  -- ⛔ NOT DECORATION. A jsonb_build_object built over a NULL key is a header
  -- with a null value, the analytics service answers 401, and the fire-and-forget
  -- post lets the scheduler record the tick as succeeded (CRON-DRIFT-01).
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'TEST FAILED (P1): the recorded post''s X-Service-Key header is % — a blank or absent key produces a 401 the fire-and-forget post can never surface.', COALESCE(quote_literal(v_key), 'NULL');
  END IF;
  IF v_body IS DISTINCT FROM '{}'::jsonb THEN
    RAISE EXCEPTION 'TEST FAILED (P1): the recorded post''s body is %, expected an empty JSON object — the sync route takes no parameters and a caller-shaped body is an input this SECURITY DEFINER function must not grow.', COALESCE(v_body::text, 'NULL');
  END IF;
  IF v_ret IS DISTINCT FROM v_post_id THEN
    RAISE EXCEPTION 'TEST FAILED (P1): the function returned % but the recorded request id is % — the return value must be the pg_net request id, never an HTTP verdict.', v_ret, v_post_id;
  END IF;

  -- The timeout the post declares is read out of the function definition itself
  -- (comments stripped first: lint rule R2) so there is ONE source of truth, and
  -- the recorded value must equal it AND sit inside the window the plan sets
  -- (SC-5): above the 120 s filtered worst case of the sync run, below Railway's
  -- five-minute idle cut-off.
  v_def := regexp_replace(pg_get_functiondef('public.cron_sync_tick()'::regprocedure), '--[^\n]*', '', 'g');
  v_want_ms := (regexp_match(v_def, 'timeout_milliseconds\s*:=\s*([0-9]+)'))[1]::INTEGER;
  IF v_want_ms IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (P1): could not read a timeout_milliseconds literal out of the function definition, so the recorded timeout has nothing to be compared with.';
  END IF;
  IF v_timeout IS DISTINCT FROM v_want_ms THEN
    RAISE EXCEPTION 'TEST FAILED (P1): the recorded post carried timeout_milliseconds=% but the function declares %.', COALESCE(v_timeout::text, 'NULL'), v_want_ms;
  END IF;
  IF v_timeout <= 120000 OR v_timeout >= 300000 THEN
    RAISE EXCEPTION 'TEST FAILED (P1): timeout_milliseconds=% is outside the window (120000, 300000). At or below 120000 a filtered worst-case sync run is cut off by our own HTTP timeout; at or above 300000 Railway''s idle cut-off ends the request first.', v_timeout;
  END IF;

  -- ===== ARM V1 — no secret ⇒ the tick RAISES, naming the key, posting nothing
  -- The state has to be produced, not assumed: delete the secret INSIDE this
  -- transaction (the file ends in ROLLBACK, so nothing is lost).
  v_setup := NULL;
  BEGIN
    DELETE FROM vault.decrypted_secrets WHERE name = 'analytics_service_key';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (V1-SETUP): could not remove the analytics_service_key secret (%), so V1 below would be asking its question of a database that still holds the secret. Record what it says — do NOT weaken V1 to accommodate it.', v_setup;
  END IF;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    PERFORM public.cron_sync_tick();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: stand the key guard down — the `btrim(v_key)` guard line becomes
  --            `IF FALSE THEN`. The read still happens, v_key is still NULL and
  --            the function sails into net.http_post with a null X-Service-Key
  --            header: the CRON-DRIFT-01 outage, a green history over silent
  --            401s.
  -- RED-UNDER-M: {"arm":"V1","apply":[{"kind":"edit","file":"supabase/migrations/20261010140000_cron_sync_tick.sql","find":"IF v_key IS NULL OR btrim(v_key) = '' THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF NOT v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (V1): cron_sync_tick() RETURNED with no analytics_service_key in the vault. A header object built over a NULL key is a header with a null value, the analytics service answers 401, and because net.http_post is fire-and-forget the scheduler records the tick as succeeded.';
  END IF;
  IF v_msg !~ 'analytics_service_key missing from vault' THEN
    RAISE EXCEPTION 'TEST FAILED (V1): the tick did raise with no secret present, but its message does not name analytics_service_key — it reads: %. If this reads like a raw 42P01/42883, the vault stand-in or the function itself is missing rather than the guard working.', COALESCE(v_msg, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (V1): % outbound post(s) were recorded despite the missing key, expected ZERO — a refusal that still lets the request out is not a refusal.', v_cnt;
  END IF;

  -- ===== ARM V2 — a WHITESPACE secret ⇒ the tick RAISES, by the SAME name ===
  -- A secret of a single SPACE is neither absent nor empty, so a guard written
  -- `v_key = ''` lets it through and builds a useless header (CRON-DRIFT-01 with
  -- one character in the secret store instead of none).
  v_setup := NULL;
  BEGIN
    DELETE FROM vault.decrypted_secrets WHERE name = 'analytics_service_key';
    PERFORM vault.create_secret(' ', 'analytics_service_key', 'phase 167.1.2.2.2 gate fixture');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (V2-SETUP): could not store a single-space analytics_service_key (%), so V2 below would be asking its question of a database holding either no secret or the real one. Record what it says — do NOT weaken V2 to accommodate it.', v_setup;
  END IF;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    PERFORM public.cron_sync_tick();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: revert the key guard to the bare empty-string spelling — the
  --            btrim comparison becomes `v_key = ''`. A single space is then
  --            neither NULL nor empty and the tick carries a useless header
  --            onward.
  -- ⚠️ DELIBERATELY THE MIRROR OF ARM V1's TWIN: under this mutation V1 stays
  --    GREEN (a wholly absent secret is still NULL and still caught) and only V2
  --    reddens, while under V1's twin BOTH redden and V1, which runs first, is
  --    the first failure. Neither mutation can redden both, which is the proof
  --    the two arms are not redundant.
  -- RED-UNDER-M: {"arm":"V2","apply":[{"kind":"edit","file":"supabase/migrations/20261010140000_cron_sync_tick.sql","find":"IF v_key IS NULL OR btrim(v_key) = '' THEN","replace":"IF v_key IS NULL OR v_key = '' THEN","occurrences":1}]}
  IF NOT v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (V2): cron_sync_tick() RETURNED with a single-space analytics_service_key in the vault. A space is not absence and not the empty string, so a guard written `v_key = ''''` lets it through and what leaves is an X-Service-Key header the analytics service answers 401 to, asynchronously.';
  END IF;
  IF v_msg !~ 'analytics_service_key missing from vault' THEN
    RAISE EXCEPTION 'TEST FAILED (V2): the tick did raise with a single-space secret present, but its message does not name analytics_service_key — it reads: %. This arm shares V1''s RAISE text on purpose, so "the key is not usable" is ONE message an operator meets.', COALESCE(v_msg, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (V2): % outbound post(s) were recorded despite the blank key, expected ZERO.', v_cnt;
  END IF;

  -- ===== ARM U1 — no url ⇒ the tick RAISES, naming the setting ==============
  -- U1 is NOT implied by V1: separate IFs over separate variables. ----------
  -- ----- U1-SETUP: a usable key again (V2 left a blank one), url row removed -
  v_setup := NULL;
  BEGIN
    DELETE FROM vault.decrypted_secrets WHERE name = 'analytics_service_key';
    PERFORM vault.create_secret('arm-fixture-key-not-real', 'analytics_service_key', 'phase 167.1.2.2.2 gate fixture');
    DELETE FROM public.system_settings WHERE key = 'analytics_service_url';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (U1-SETUP): could not restore a usable key and remove the analytics_service_url row (%), so U1 below would be measuring the key guard instead of the url guard.', v_setup;
  END IF;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    PERFORM public.cron_sync_tick();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: stand the url guard down — `IF v_url IS NULL OR v_url = '' THEN`
  --            becomes `IF FALSE THEN`. v_url is then NULL, `v_url || '/api/…'`
  --            is NULL, and the tick posts to a null url instead of saying which
  --            setting is missing.
  -- RED-UNDER-M: {"arm":"U1","apply":[{"kind":"edit","file":"supabase/migrations/20261010140000_cron_sync_tick.sql","find":"IF v_url IS NULL OR v_url = '' THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF NOT v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (U1): cron_sync_tick() RETURNED with no analytics_service_url row in system_settings. A null url means the live service key is posted to nowhere anyone chose, with the same async, silently-successful shape as a missing key.';
  END IF;
  IF v_msg !~ 'analytics_service_url missing from system_settings' THEN
    RAISE EXCEPTION 'TEST FAILED (U1): the tick did raise with the url row deleted, but its message does not name analytics_service_url — it reads: %. Two very different faults raise here (an absent setting and an absent pg_net) and only the message tells an operator which.', COALESCE(v_msg, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (U1): % outbound post(s) were recorded despite the missing url, expected ZERO.', v_cnt;
  END IF;

  -- ===== ARMS C2/C3 — a FOREIGN url ⇒ the tick REFUSES, and does not name ===
  -- =====               the value it refused ================================
  -- The CHECK constraint on system_settings is one ALTER TABLE from gone and this
  -- arm performs exactly that ALTER TABLE; what is measured is the layer still
  -- standing afterwards, the in-body re-test of the SAME allow-list.
  -- ----- C2-SETUP: drop the constraint, store a foreign host ---------------
  v_setup := NULL;
  BEGIN
    ALTER TABLE public.system_settings
      DROP CONSTRAINT IF EXISTS system_settings_analytics_service_url_allowed;
    INSERT INTO public.system_settings (key, value)
    VALUES ('analytics_service_url', 'https://collector.attacker.example');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (C2-SETUP): could not drop the destination CHECK constraint and store a foreign host (%) — the arms below need the constraint gone to reach the in-body re-test at all. Record what it says — do NOT weaken the arm to accommodate it.', v_setup;
  END IF;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    PERFORM public.cron_sync_tick();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: stand the destination guard down — `IF v_url !~ c_url_allowed
  --            THEN` becomes `IF FALSE THEN`. With the constraint already gone
  --            the control is zero layers deep and the tick posts the live
  --            service key to the attacker's host. ⚠️ Deliberately NOT a `sql`
  --            step dropping the constraint: this arm has already dropped it.
  -- RED-UNDER-M: {"arm":"C2","apply":[{"kind":"edit","file":"supabase/migrations/20261010140000_cron_sync_tick.sql","find":"IF v_url !~ c_url_allowed THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF NOT v_raised OR v_msg !~ 'not an allowed destination' THEN
    RAISE EXCEPTION 'TEST FAILED (C2): with analytics_service_url set to a host outside the allow-list and the CHECK constraint dropped, cron_sync_tick() did not refuse by name — raised=%, message: %. net.http_post is fire-and-forget, so the Vault-held service key would leave in an X-Service-Key header and nothing downstream would ever report where it went.', v_raised, COALESCE(v_msg, 'NULL');
  END IF;
  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (C2): % outbound post(s) were recorded despite the destination guard, expected ZERO — a refusal that still lets the request out is not a refusal.', v_cnt;
  END IF;

  -- RED-UNDER: make the refusal ECHO the value — append `(%)', v_url` to the
  --            message. RAISE text lands in the cron job-run row and the
  --            Postgres log, so an attacker-chosen hostname would be written
  --            into every downstream reader of this project's logs by the guard
  --            that refused it (T-161.1-10). ⚠️ It leaves `not an allowed
  --            destination` in place, so C2 above stays GREEN and this arm is
  --            the first failure.
  -- RED-UNDER-M: {"arm":"C3","apply":[{"kind":"edit","file":"supabase/migrations/20261010140000_cron_sync_tick.sql","find":"read it with an admin session. Allowed: an https host under .up.railway.app';","replace":"read it with an admin session. Allowed: an https host under .up.railway.app (%)', v_url;","occurrences":1}]}
  IF v_msg ~ 'collector\.attacker\.example' THEN
    RAISE EXCEPTION 'TEST FAILED (C3): the destination refusal ECHOED the url it refused — it reads: %. The value in that row is attacker-controlled by construction, and RAISE text is not a private channel. Name the SETTING, never its value; an operator who needs the value can SELECT it.', v_msg;
  END IF;

  -- ===== ARM G1 — EXECUTE on the tick is held by the OWNER ALONE ============
  -- ⭐ THE WHOLE GRANTEE SET, NOT A SUBSET: aclexplode over proacl enumerates
  -- the grantees instead of interrogating a guessed list, so a grantee nobody
  -- thought of is a FAILURE here rather than a silence. Compared to the OWNER'S
  -- NAME, never the literal `postgres` (the pg-lane boots as whatever role it
  -- created). COALESCE(proacl, acldefault(…)) makes a NULL acl explicit: its
  -- MEANING is the default ACL, which grants EXECUTE to PUBLIC. Falsifiable on
  -- the lane only because fixture 07 grants the project-bootstrap defaults first.
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
         AND p.proname = 'cron_sync_tick'
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
  -- RED-UNDER-M: {"arm":"G1","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.cron_sync_tick() TO service_role"}]}
  IF v_grantees IS NULL OR v_grantees IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'TEST FAILED (G1): EXECUTE on cron_sync_tick is held by [%], expected exactly the owner [%]. The tick reads a live service key out of the Vault as its DEFINER and POSTs it in an outbound header, so every extra grantee is a principal who can force a live secret-bearing request on demand.', COALESCE(v_grantees, 'NULL'), COALESCE(v_owner, 'NULL');
  END IF;

  RAISE NOTICE 'ALL 8 ARMS EXECUTED (0,P1,V1,V2,U1,C2,C3,G1): public.cron_sync_tick() exists with no arguments (0); posts exactly one request to the analytics service''s /api/cron-sync route, carrying a non-blank X-Service-Key, an empty JSON body and a timeout inside the declared window, and returns the pg_net request id (P1); RAISES by name and posts nothing when the key is absent (V1), when the key is whitespace (V2), and when the url setting is absent (U1); refuses a destination outside the allow-list with the CHECK constraint dropped (C2) and never echoes the value it refused (C3); and EXECUTE is held by the owner alone (G1). Phase 167.1.2.2.2 / plan 01 / SC-1, SC-5, mig 20261010140000.';
END $$;

ROLLBACK;
