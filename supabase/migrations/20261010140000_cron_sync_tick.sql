-- Migration: public.cron_sync_tick() — the CALLABLE that fires the daily trade
-- sync. Phase 167.1.2.2.2 (TRADESYNC) / plan 01 / SC-1 and SC-5.
--
-- ROOT CAUSE THIS EXISTS FOR (.planning/debug/cron-sync-unscheduled.md): the
-- analytics service has carried a `POST /api/cron-sync` route and the per-key
-- sync code behind it for a long time, and NOTHING has ever called it. No
-- pg_cron job, no workflow and no tick function points at that route, so live
-- strategy keys have not had their trades ingested on a schedule. This file
-- ships the tick. It does not ship the schedule.
--
-- WHAT THIS SHIPS AND WHAT IT DOES NOT.
-- It ships one SECURITY DEFINER function, a COMMENT, a REVOKE and a
-- catalogue-only self-verifying block. ⛔ It does NOT register anything: the
-- file never makes the pg_cron schedule call, and says so in this header only
-- by that description. Registration of the daily job is a separate, founder-gated
-- live operation owned by the go-live runbook after this merges (the Phase
-- 164.7 rule, repeated by 164.1.1 for the cadence check): a migration that
-- registers a job puts the job on PROD at merge with no rehearsal. Until the
-- runbook runs, nothing invokes this function.
--
-- The function is a copy of the re-based house shape, not a new design. Its
-- LEFT side is `public.match_engine_cron_tick()` as re-based in
-- `20260911120000_vault_tick_hardening.sql` (and its committed snapshot
-- `supabase/schema/functions/match_engine_cron_tick.sql`), re-read for this
-- file: the Vault read is ONE statement that counts and takes the value off the
-- same scan, a duplicate secret name is refused by name, a blank key is refused,
-- the URL comes from `public.system_settings` key `analytics_service_url` and is
-- re-tested against the destination allow-list inside the body (without echoing
-- it), and the post is one async `net.http_post`. Only three things differ from
-- the analog: the name, the path, and the HTTP timeout.
--
-- THE TIMEOUT (SC-5). `timeout_milliseconds` is declared once, in the post
-- below, at a value above the filtered worst case of the sync run and below
-- Railway's five-minute idle cut-off. It is a PLAN, not a measurement: the
-- go-live rehearsal runs this function once behind the database-marker guard and
-- reads the real duration out of the pg_net response table, and that reading
-- decides whether the number stands. The gate reads the value back out of the
-- function definition at run time rather than restating it, so there is one
-- source of truth.
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
-- merges), never names the Vault or pg_net relations as objects (neither exists
-- on the pg-lane's bare cluster and pg_net may be absent on a fresh project; the
-- references live inside the plpgsql body, resolved at CALL time), and never
-- counts rows (shared TEST carries PROD's catalogue and EMPTY tables, and a
-- data-reading check that refuses on an empty table would block the PROD apply:
-- [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]).
--
-- DISJOINTNESS: the needles this file ASSERTS versus the strings the gate
-- MUTATES. A verification needle that a gate arm mutates ABORTS the apply, so
-- the gate never runs and no arm can be the first failure; WAIVED_CEILING is 0
-- and stays 0. The needles below are assembled by CONCATENATION in the DECLARE
-- block, so each occurs once, as the body's own statement, and never as a second
-- raw copy. The gate's `find` strings (the key guard line, the url guard line,
-- the allow-list re-test line, the tail of the no-echo message, and the post
-- path) are NOT printed in this header, because the mutation runner counts
-- `occurrences` over the raw file text, comments included. The path needle is
-- the one deliberate overlap in spirit: the gate's path twin lengthens the path
-- by a suffix, which leaves the needle satisfied and is caught by the gate arm
-- that reads the recorded url; the needle exists to catch a path that is
-- shortened, renamed or deleted.

-- --------------------------------------------------------------------------
-- STEP 1: public.cron_sync_tick()
-- --------------------------------------------------------------------------
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

COMMENT ON FUNCTION public.cron_sync_tick() IS
  'Phase 167.1.2.2.2 / SC-1: the CALLABLE that asks the analytics service to '
  'run the daily trade sync. Reads the analytics service key from the Vault in '
  'ONE scan that counts and takes the value together, so a duplicate secret '
  'name is REFUSED BY NAME; reads the service url from public.system_settings; '
  'RAISES when either is absent, empty or (for the key) whitespace; RAISES when '
  'the url is not a destination the allow-list permits, without echoing it; and '
  'fires one ASYNC net.http_post of an empty JSON body to /api/cron-sync. The '
  'returned BIGINT is a pg_net REQUEST ID and NOT a delivery or an HTTP success: '
  'a 401 or a timeout returns an ordinary id. EXECUTE is held by the owner '
  'alone. This function registers nothing and is invoked by NOTHING until the '
  'go-live runbook registers the job cron-sync-trades at 30 4 * * * UTC after '
  'the rehearsal; until then no scheduler calls it.';

-- --------------------------------------------------------------------------
-- STEP 2: grants
-- --------------------------------------------------------------------------
-- service_role is REVOKEd alongside PUBLIC, anon and authenticated: Supabase's
-- default ACL auto-grants EXECUTE to service_role on every new public function,
-- and this function reads a live service key out of the Vault as its DEFINER and
-- posts it in an outbound header. A grant would let any service_role holder
-- (every Next.js createAdminClient() route, the Python analytics service) force
-- a live, secret-bearing net.http_post on demand ([164.7-WR02-SERVICE-ROLE-
-- EXECUTE], found and fixed once for the sibling).
--
-- NO GRANT follows. The scheduler runs as the owner, and an owner needs no grant.
REVOKE ALL ON FUNCTION public.cron_sync_tick() FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block (catalogue only)
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip. Asserts SHAPE, never
-- behaviour; behaviour is covered by supabase/tests/test_cron_sync_tick.sql.
DO $verify$
DECLARE
  -- ⛔ Every variable is DECLAREd up front: plpgsql compiles a DO block WHOLE.
  v_overloads INTEGER;
  v_nargs     SMALLINT;
  v_secdef    BOOLEAN;
  v_config    TEXT[];
  v_srchpath  TEXT;
  v_owner     TEXT;
  v_bypass    BOOLEAN;
  v_super     BOOLEAN;
  v_grantees  TEXT;
  v_def_raw   TEXT;
  v_def       TEXT;
  -- THE NEEDLES, each bound to a statement shape and ASSEMBLED BY CONCATENATION
  -- so a needle is never a second raw occurrence of the shape it asserts is
  -- present (see the disjointness note in the header). Do NOT tidy them into
  -- single literals.
  v_vault_needle       TEXT := 'FROM vault.' || 'decrypted_secrets';
  v_settings_needle    TEXT := 'FROM public.' || 'system_settings';
  v_cardinality_needle TEXT := 'IF v_cnt ' || '> 1 THEN';
  v_path_needle        TEXT := '/api/' || 'cron-sync';
BEGIN
  -- 0. THE NAME RESOLVES TO EXACTLY ONE FUNCTION, asserted first because every
  --    check after it reads (schema, name) and `SELECT … INTO` without STRICT
  --    takes the first of several rows in silence. A SECURITY DEFINER overload
  --    created without an explicit REVOKE carries the default ACL, which grants
  --    EXECUTE to PUBLIC.
  SELECT count(*) INTO v_overloads
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cron_sync_tick';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'Migration 20261010140000: public.cron_sync_tick resolves to % functions in schema public, expected exactly 1. The checks below read (schema, name) with no signature, so an overload carrying the default ACL (EXECUTE TO PUBLIC on a SECURITY DEFINER body that posts the analytics service key) could sit in the catalogue with every check reporting green', v_overloads;
  END IF;

  -- 1. Exists and takes NO arguments. A caller-supplied url or key on a
  --    SECURITY DEFINER function is the attack surface (T-161.1-10).
  SELECT p.pronargs, p.prosecdef, p.proconfig
    INTO v_nargs, v_secdef, v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'cron_sync_tick';
  IF v_nargs <> 0 THEN
    RAISE EXCEPTION 'Migration 20261010140000: cron_sync_tick takes % argument(s), expected 0 — a caller-supplied url or key on a SECURITY DEFINER function lets any caller who can EXECUTE it aim the service key at a host of their choosing', v_nargs;
  END IF;

  -- 2. SECURITY DEFINER with a pinned search_path, compared BY VALUE (a prefix
  --    test is satisfied by an empty path or one led by a schema a caller can
  --    create objects in).
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Migration 20261010140000: cron_sync_tick is not SECURITY DEFINER, so it reads the secret store as the CALLER and the Vault read fails for every role that is not the owner';
  END IF;
  SELECT c INTO v_srchpath
    FROM unnest(COALESCE(v_config, ARRAY[]::TEXT[])) AS c
   WHERE c LIKE 'search_path=%';
  IF v_srchpath IS NULL THEN
    RAISE EXCEPTION 'Migration 20261010140000: cron_sync_tick does not pin search_path at all (proconfig=%). On a SECURITY DEFINER function that is a privilege-escalation route', v_config;
  END IF;
  IF regexp_replace(v_srchpath, '\s', '', 'g') <> 'search_path=public,pg_catalog' THEN
    RAISE EXCEPTION 'Migration 20261010140000: cron_sync_tick pins search_path to "%", not to the "public, pg_catalog" its own declaration sets', v_srchpath;
  END IF;

  -- 2b. The DEFINER role can SEE the row it reads. `rolsuper OR rolbypassrls`,
  --     never rolbypassrls alone: a SUPERUSER bypasses RLS implicitly with the
  --     flag still FALSE.
  SELECT r.rolname, r.rolbypassrls, r.rolsuper
    INTO v_owner, v_bypass, v_super
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public' AND p.proname = 'cron_sync_tick';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Migration 20261010140000: could not resolve the owner of public.cron_sync_tick — pg_proc.proowner has no matching pg_roles row';
  END IF;
  IF NOT (COALESCE(v_bypass, FALSE) OR COALESCE(v_super, FALSE)) THEN
    RAISE EXCEPTION 'Migration 20261010140000: cron_sync_tick is owned by role "%" (rolsuper=%, rolbypassrls=%), which is exempt from row security by neither route, so its read of the RLS-enabled settings table returns no row and the function would report a missing-row error while the row is present', v_owner, v_super, v_bypass;
  END IF;

  -- 3-6. THE BODY ITSELF, asserted on the EXECUTABLE text. pg_get_functiondef
  --      returns the body WITH its comments, so a position() over the raw
  --      definition is a test a COMMENT can satisfy; comments are stripped first
  --      (lint rule R2-functiondef-comment-strip mandates this idiom).
  SELECT pg_get_functiondef('public.cron_sync_tick()'::regprocedure)
    INTO v_def_raw;
  v_def := regexp_replace(v_def_raw, '--[^\n]*', '', 'g');

  IF v_def IS NULL OR length(v_def) < 500 THEN
    RAISE EXCEPTION 'Migration 20261010140000: the comment-stripped definition of public.cron_sync_tick is % character(s) — the strip is broken, so the body checks below would pass over nothing', COALESCE(length(v_def), 0);
  END IF;

  -- 3. the key comes from the VAULT, by a read.
  IF position(v_vault_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20261010140000: cron_sync_tick does not read the secret store (looked for "%"). The key would then come from somewhere else — a literal baked into the body, a table, or nothing at all', v_vault_needle;
  END IF;

  -- 4. the url comes from the SETTINGS TABLE, by a read.
  IF position(v_settings_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20261010140000: cron_sync_tick does not read the service url from the settings table (looked for "%"). A hardcoded URL means an operator would have to ship a migration to change a hostname', v_settings_needle;
  END IF;

  -- 5. the Vault read is CARDINALITY-GUARDED.
  IF position(v_cardinality_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20261010140000: cron_sync_tick does not refuse an ambiguous secret (looked for "%"). Without it a duplicate secret name makes the read pick an arbitrary row, and the wrong key is sent in a header nothing downstream reports on', v_cardinality_needle;
  END IF;

  -- 6. the post targets the sync route.
  IF position(v_path_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20261010140000: cron_sync_tick does not post to the sync route (looked for "%"). A tick aimed at any other path runs green and syncs nothing', v_path_needle;
  END IF;

  -- 7. THE WHOLE EXECUTE GRANTEE SET IS EXACTLY THE OWNER. aclexplode over
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
         AND p.proname = 'cron_sync_tick'
         AND p.pronargs = 0
         AND a.privilege_type = 'EXECUTE'
    ) g
   GROUP BY g.owner_name;
  IF v_grantees IS NULL THEN
    RAISE EXCEPTION 'Migration 20261010140000: could not read the EXECUTE grantee set of public.cron_sync_tick — the function is missing, or it carries no EXECUTE aclitem at all, and an empty answer here is indistinguishable from a locked-down one unless it is refused';
  END IF;
  IF v_grantees IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Migration 20261010140000: EXECUTE on public.cron_sync_tick is held by [%], expected exactly the owner [%]. This function reads a live service key out of the Vault as its DEFINER and posts it in an outbound header; a grantee beyond the owner (the scheduler runs as the owner) can force a live secret-bearing net.http_post on demand', v_grantees, v_owner;
  END IF;

  RAISE NOTICE 'Migration 20261010140000: cron_sync_tick() verified — SECURITY DEFINER, search_path pinned, one cardinality-guarded Vault read, posts to the sync route, EXECUTE held by the owner alone';
END
$verify$;
