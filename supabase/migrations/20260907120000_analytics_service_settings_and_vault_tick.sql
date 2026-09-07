-- Migration: public.system_settings — the TEXT-valued operator-config sibling of
-- system_flags — and public.match_engine_cron_tick(), the CALLABLE half of the
-- mechanism PROD's match_engine_cron job ALREADY runs.
-- Phase 164.7 / plan 02 / criterion 2 (APPSETTINGS), SC-2 for
-- analytics_service_key and analytics_service_url. 2026-09-07.
--
-- ⚠️ OPS: merging supabase/migrations/** to main AUTO-APPLIES to PROD. This file
-- creates a table, seeds one non-secret row and defines one function, live on
-- the next merge with no separate deploy step and no flag in front of it.
--
-- ══════════════════════════════════════════════════════════════════════════
-- ⛔ WHAT THIS FILE DOES NOT DO
-- ══════════════════════════════════════════════════════════════════════════
-- 1. It REGISTERS NO SCHEDULE and REMOVES NONE. It contains zero tokens of
--    either verb, comments included, and the verification block below never
--    touches the job catalogue. Repointing the LIVE job row is Phase 164.5
--    item (7), which owns the one production row; this phase owns what the
--    MIGRATIONS describe. A migration that schedules is a scope violation, and
--    the runbook rule it would break is stated in
--    docs/runbooks/ledger-refresh-go-live.md: the registration statement lives
--    THERE and never in a migration.
-- 2. It CREATES, ROTATES AND READS NO SECRET at apply time. The secret named
--    `analytics_service_key` has existed in PROD's Vault since 2026-08-25
--    (TODOS CRON-DRIFT-01, where the hand-repair is recorded); this file only
--    describes how to READ it, inside a function body, at call time.
-- 3. It ADDS NO ADMIN ROUTE. Flipping an operator value is a founder SQL-editor
--    UPDATE behind the which-database marker (CLAUDE.md), not a new CSRF +
--    rate-limiter + audit surface for a statement thrown a handful of times a
--    year. Recorded so it is not re-litigated; a later phase may add one
--    modelled on src/app/api/admin/match/kill-switch/route.ts.
--
-- ══════════════════════════════════════════════════════════════════════════
-- DRIFT-02: this file makes the REPO describe what PROD RUNS
-- ══════════════════════════════════════════════════════════════════════════
-- The live command was captured verbatim from production by Phase 164.1 plan 06
-- into scripts/prod-prober/cron-manifest.json (jobid 1, jobname
-- match_engine_cron, schedule "0 * * * *", username postgres, active true). Its
-- `command` reads the analytics service key out of vault.decrypted_secrets,
-- RAISEs when that secret is absent or empty, and POSTs to a HARDCODED Railway
-- URL literal. Nothing in supabase/migrations/** described any of that: the two
-- April files (20260408113029, superseded by 20260408215026) are one-shot
-- anonymous blocks that wrote a job row reading four settings this platform
-- does not let a migration set. So the repository held a mechanism production
-- had already stopped using — DRIFT-02's shape — and closing it is this file's
-- entire purpose.
--
-- ⚠️ THE TWO SETTINGS ARE DISPOSITIONED DIFFERENTLY, ON PURPOSE (CONTEXT D-02,
-- D-03, as corrected by the manifest reading):
--   * analytics_service_key  — a SECRET. It is ALREADY on Vault in the live
--     command; this file reuses that read idiom byte-for-byte so the repo and
--     production speak one vocabulary.
--   * analytics_service_url  — NOT a secret, and it has NO consumer anywhere:
--     the live command inlines the literal. Putting it behind Vault would make
--     an operator need secret-management privileges to change a hostname, so it
--     goes in a table an admin can UPDATE. The literal seeded below is copied
--     from the committed manifest, which is already public in this repository,
--     so committing it here leaks nothing new.
--
-- ⚠️ A NOTE ON THE FRESH-APPLY DEFECT THIS DOES **NOT** YET CLOSE. The two April
-- files still contain the settings-reading text, so a FRESH apply (a new
-- project, disaster recovery, the pg-lane) would still write the old broken job
-- row. That is a latent-on-rebuild defect, not an ongoing outage — no
-- app-GUC read is executing on PROD at all today. Their lineage headers are
-- plan 05's, not this file's.
--
-- ⚠️ WHY THE RAISEs ARE LOAD-BEARING AND MUST NOT BECOME NOTICEs. A plpgsql
-- `SELECT … INTO` without STRICT sets its target to NULL when the query returns
-- no rows and does NOT raise. Without the explicit checks below,
-- jsonb_build_object('X-Service-Key', NULL) sends a null header, the analytics
-- service answers 401, and the job still logs `succeeded` because net.http_post
-- is ASYNC. That is exactly the seven-day silent outage TODOS CRON-DRIFT-01
-- documents. The RAISE converts an absent value into a FAILED job-run row,
-- which the cron-obs prober arm can see.
--
-- ⚠️ NO IDENTIFIER AND NO SECRET APPEARS IN ANY RAISE TEXT (T-161.1-10). The
-- messages name the SETTING, never its value.
--
-- Convention: BEGIN/COMMIT with a session lock_timeout, matching the repo
-- majority and migration 20260825130000 (project Rule 11).

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: public.system_settings — non-secret operator configuration
-- --------------------------------------------------------------------------
-- Shape cloned from 20260407164606_perfect_match.sql's system_flags (same four
-- columns, same updated_by FK), with `value TEXT NOT NULL` where that table has
-- `enabled BOOLEAN NOT NULL`. A SIBLING rather than a widening of system_flags:
-- adding a nullable `value` column there would make every existing row's
-- contract ambiguous — is this row a flag or a setting? (CONTEXT D-03.)
CREATE TABLE IF NOT EXISTS public.system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES public.profiles(id)
);

COMMENT ON TABLE public.system_settings IS
  'Phase 164.7 / SC-2: NON-SECRET operator configuration, keyed by name, '
  'readable and writable by admins and the service role only. The TEXT-valued '
  'sibling of system_flags (which stays BOOLEAN-only). ⛔ SECRETS GO TO VAULT, '
  'NEVER HERE: every row is plaintext, is dumped by pg_dump and is visible to '
  'anyone who can read the table. See vault.create_secret / '
  'vault.decrypted_secrets, which is where public.match_engine_cron_tick() '
  'reads the analytics service key from.';

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Defense in depth, following the 20260621120000_scenarios_table_and_rls.sql
-- precedent: a fresh table inherits Supabase's project-bootstrap
-- `GRANT ALL ON TABLES TO anon, authenticated, service_role`, so anon keeps
-- table-level privileges even though no policy below admits it. There is no
-- browser-side reader of an operator setting — deliberately NOT the scoped
-- anon-visible policy system_flags carries for its kill switch — so drop anon's
-- grants entirely and block anon at BOTH the grant layer and the RLS layer.
-- `authenticated` keeps its default grants; the admin policy scopes its rows.
REVOKE ALL ON TABLE public.system_settings FROM anon;

-- Two policies, cloned from system_flags' admin/service pair. ⚠️ The admin
-- predicate is `profiles.is_admin`, NEVER current_user_has_app_role(): that
-- helper needs anon EXECUTE to be usable from a policy, which is the
-- anon-EXECUTE trap PATTERNS §2 CONFLICT 1 records.
--
-- Guarded by a catalogue probe rather than written bare, because CREATE POLICY
-- has no IF NOT EXISTS and a re-apply of this file must not abort on 42710.
DO $policies$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'system_settings'
          AND policyname = 'system_settings_admin_all'
     ) THEN
    CREATE POLICY system_settings_admin_all ON public.system_settings
      FOR ALL
      TO authenticated
      USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true))
      WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true));
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'system_settings'
          AND policyname = 'system_settings_service_all'
     ) THEN
    CREATE POLICY system_settings_service_all ON public.system_settings
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$policies$;

-- The seed. The literal is VERBATIM from scripts/prod-prober/cron-manifest.json,
-- jobid 1's command, where it is inlined in the live job row.
-- ⚠️ ON CONFLICT DO NOTHING is deliberate: a re-apply must never overwrite a
-- value an operator set out of band.
INSERT INTO public.system_settings (key, value)
VALUES ('analytics_service_url', 'https://quantalyze-analytics-production.up.railway.app')
ON CONFLICT (key) DO NOTHING;

-- --------------------------------------------------------------------------
-- STEP 2: public.match_engine_cron_tick() — the callable half of the mechanism
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_engine_cron_tick()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $tick$
DECLARE
  v_key TEXT;
  v_url TEXT;
  v_req BIGINT;
BEGIN
  -- The Vault read, byte-for-byte the idiom the live job row already runs.
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'analytics_service_key';
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'analytics_service_key missing from vault — refusing to send a null header';
  END IF;

  SELECT s.value INTO v_url
    FROM public.system_settings s
   WHERE s.key = 'analytics_service_url';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE EXCEPTION 'analytics_service_url missing from system_settings — refusing to post to a null url';
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

COMMENT ON FUNCTION public.match_engine_cron_tick() IS
  'Phase 164.7 / SC-2 / DRIFT-02: the CALLABLE half of the mechanism the live '
  'match_engine_cron job already runs. Reads the analytics service key from '
  'vault.decrypted_secrets and the service URL from public.system_settings, '
  'RAISES when either is absent or empty rather than sending a null header, '
  'and fires one ASYNC net.http_post whose returned BIGINT is a request id and '
  'NOT an HTTP success. Registers nothing and is invoked by nothing in this '
  'repository yet: repointing the live job row at it is Phase 164.5 item (7), '
  'which must also settle the manifest hygiene rule requiring the literal '
  'vault.decrypted_secrets to appear in that row''s own command text '
  '(164.7-RESEARCH Open Question 2).';

REVOKE ALL ON FUNCTION public.match_engine_cron_tick() FROM PUBLIC, anon, authenticated;
-- The scheduler runs as superuser; no additional GRANT is required.

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip.
--
-- ⛔ THIS BLOCK MUST NEVER CALL match_engine_cron_tick(). An apply-time
-- invocation would fire a real HTTP POST at the analytics service the moment
-- this migration merges. Assert the SHAPE, never the behaviour; behaviour is
-- covered by supabase/tests/test_analytics_service_settings_and_vault_tick.sql.
--
-- ⛔ AND IT MUST NEVER NAME vault.* OR net.* AS OBJECTS. Neither exists on the
-- pg-lane, and pg_net is an extension a fresh project may not have yet. Every
-- reference to them in this file lives INSIDE the plpgsql body above, where it
-- is resolved at CALL time — which is what lets this migration apply on a
-- vanilla cluster and therefore appear in a gate's apply list at all. A
-- catalogue probe here would make the file unusable in every apply list.
DO $verify$
DECLARE
  -- ⛔ Every variable is DECLAREd up front. plpgsql compiles a DO block WHOLE:
  --    a missing DECLARE does not weaken the one check that uses it, it raises
  --    42601 and NONE of the checks run (measured on 20260825130000, whose own
  --    note this copies).
  v_nargs    SMALLINT;
  v_secdef   BOOLEAN;
  v_config   TEXT[];
  v_anon     BOOLEAN;
  v_auth     BOOLEAN;
  v_rls      BOOLEAN;
  v_policies INTEGER;
  v_seed     TEXT;
  v_fn       TEXT;
BEGIN
  -- 1. The function exists and takes no arguments.
  SELECT p.pronargs, p.prosecdef, p.proconfig
    INTO v_nargs, v_secdef, v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'match_engine_cron_tick';
  IF v_nargs IS NULL THEN
    RAISE EXCEPTION 'Migration 20260907120000: public.match_engine_cron_tick was not created — STEP 2 did not run, or ran under a different schema';
  END IF;
  IF v_nargs <> 0 THEN
    RAISE EXCEPTION 'Migration 20260907120000: match_engine_cron_tick takes % argument(s), expected 0 — a caller-supplied url or key on a SECURITY DEFINER function IS the attack surface (T-161.1-10): it lets any caller who can EXECUTE it aim the service key at a host of their choosing', v_nargs;
  END IF;

  -- 2. SECURITY DEFINER with a pinned search_path. Both halves matter: the
  --    function reads Vault as its owner, and an unpinned search_path lets a
  --    caller-controlled schema shadow `system_settings` and feed it a url.
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Migration 20260907120000: match_engine_cron_tick is not SECURITY DEFINER, so it reads vault.decrypted_secrets as the CALLER and the Vault read fails for every role that is not the owner';
  END IF;
  IF v_config IS NULL OR NOT EXISTS (
       SELECT 1 FROM unnest(v_config) c WHERE c LIKE 'search_path=%'
     ) THEN
    RAISE EXCEPTION 'Migration 20260907120000: match_engine_cron_tick has no pinned search_path. On a SECURITY DEFINER function that is a privilege-escalation route — a caller-created public.system_settings earlier in the path would supply the url the service key is posted to';
  END IF;

  -- 3. Neither browser-facing role may EXECUTE it. ⚠️ Falsifiable on the
  --    pg-lane only because 07-fixture-supabase-default-privileges.sql grants
  --    the project-bootstrap defaults first; on a vanilla cluster the REVOKE is
  --    a no-op and this check would pass for a reason unrelated to the file.
  SELECT has_function_privilege('anon', 'public.match_engine_cron_tick()'::regprocedure, 'EXECUTE'),
         has_function_privilege('authenticated', 'public.match_engine_cron_tick()'::regprocedure, 'EXECUTE')
    INTO v_anon, v_auth;
  IF v_anon OR v_auth THEN
    RAISE EXCEPTION 'Migration 20260907120000: EXECUTE on match_engine_cron_tick is reachable (anon=%, authenticated=%). A browser-reachable SECURITY DEFINER function that posts the analytics service key is an unauthenticated trigger for the whole match engine', v_anon, v_auth;
  END IF;

  -- 4. The table exists, RLS is ON, and both policies are present.
  SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'system_settings';
  IF v_rls IS NULL THEN
    RAISE EXCEPTION 'Migration 20260907120000: public.system_settings was not created — STEP 1 did not run';
  END IF;
  IF NOT v_rls THEN
    RAISE EXCEPTION 'Migration 20260907120000: RLS is not enabled on public.system_settings, so the two policies below are inert and every authenticated user can rewrite the analytics service URL';
  END IF;
  SELECT count(*) INTO v_policies
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'system_settings'
     AND policyname IN ('system_settings_admin_all', 'system_settings_service_all');
  IF v_policies <> 2 THEN
    RAISE EXCEPTION 'Migration 20260907120000: expected exactly the two policies system_settings_admin_all and system_settings_service_all on public.system_settings, found % of them', v_policies;
  END IF;

  -- 5. The seed row is there.
  SELECT value INTO v_seed FROM public.system_settings WHERE key = 'analytics_service_url';
  IF v_seed IS NULL OR v_seed = '' THEN
    RAISE EXCEPTION 'Migration 20260907120000: the analytics_service_url seed row is absent or empty, so match_engine_cron_tick would RAISE on every call';
  END IF;

  -- 6. The body reads BOTH mechanisms. ⚠️ Comments are stripped before the
  --    match: a raw pg_get_functiondef probe is satisfiable by prose that
  --    documents the very rule it claims to check (the lint corpus' R2 rule
  --    records PROD's 7-param _enqueue_compute_job_internal doing exactly that).
  --    A text check is honest here only because this file OWNS the body it just
  --    wrote — it is asserting that STEP 2 was not edited to drop one of the two
  --    reads, not making a claim about behaviour.
  SELECT regexp_replace(pg_get_functiondef('public.match_engine_cron_tick()'::regprocedure),
                        '--[^\n]*', '', 'g')
    INTO v_fn;
  IF v_fn !~ 'vault\.decrypted_secrets' THEN
    RAISE EXCEPTION 'Migration 20260907120000: match_engine_cron_tick does not read vault.decrypted_secrets. The key would then come from somewhere else — a literal baked into the body, a table, or nothing at all — and the first two put the secret where pg_dump and every reader of the catalogue can see it';
  END IF;
  IF v_fn !~ 'analytics_service_url' THEN
    RAISE EXCEPTION 'Migration 20260907120000: match_engine_cron_tick does not read analytics_service_url. A hardcoded URL is what this file exists to replace — an operator would have to ship a migration to change a hostname';
  END IF;

  RAISE NOTICE 'Migration 20260907120000: applied (system_settings seeded, match_engine_cron_tick defined, NOTHING scheduled)';
END $verify$;

COMMIT;
