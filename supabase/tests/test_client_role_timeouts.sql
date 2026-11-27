-- Test: the client roles anon and authenticated carry a role-level statement_timeout
-- at or below their pinned ceiling, and nothing shadows or overrides it (Phase 243
-- DBBACKSTOP, plan 02, DBACC-03).
--
-- WHY THIS FILE EXISTS. A holder of UPDATE or DELETE may `LOCK TABLE`; a role-level
-- statement timeout is what bounds how long any client statement can hold the lock.
-- Migration 20261127120000 restates the platform's own values in the repo (anon 3s,
-- authenticated 8s, measured live in 243-01-MEASUREMENT.md). Its own DO block proves
-- the catalogue once, at apply. This gate re-reads it on every run, so a later migration
-- that raises, removes or shadows the bound goes RED here instead of shipping.
--
-- THE ARMS (the roster is the sentinel at the foot of the file):
--   1a  anon carries a global statement_timeout element.
--   1b  anon's EFFECTIVE value is at most 3000 ms. A value of 0 disables the timeout and
--       counts as unbounded, so it fails; an unparseable value fails too.
--   2a  authenticated carries a global statement_timeout element.
--   2b  authenticated's EFFECTIVE value is at most 8000 ms (same 0 and unparseable rule).
--   3   no function PostgREST can expose, that anon or authenticated may EXECUTE, carries
--       its own `statement_timeout` setting. PostgREST HOISTS a function-level setting
--       over the role's value, so one such function lifts the bound for its own call.
--       Only an exposed function can be called through /rest/v1/rpc, which is why the
--       scan is limited to the schemas in `[api].schemas` of supabase/config.toml
--       (`public` and `graphql_public`): Supabase's own auth, extensions and vault
--       functions are not reachable by a client and must not turn the local-stack run
--       red for a reason no client can hit. On the pg-lane the population is 1 function
--       (measured 2026-11-27), so arm 3 carries an anti-vacuity guard, `3-SETUP`, that
--       fails when the population is 0 (no twin: it is a guard, not a claim).
--   4   no per-database pg_db_role_setting row for this database carries a
--       statement_timeout for either role. A per-database row silently SHADOWS the
--       global row the pin migration writes, so the effective value would be whatever
--       that row says while arms 1a and 2a still read the global row and stay green.
--
-- WHICH LANE PROVES WHAT. The pg-lane is where this gate bites: scripts/pg-lane/run.sh
-- creates anon, authenticated and service_role BARE on a vanilla `initdb` cluster, so
-- without the pin migration the roles carry no timeout and arm 1a fails. On the
-- local-stack lane the image's own defaults may already satisfy the arms, so there they
-- are a sanity check, not proof the migration did anything.
--
-- ⛔ A GREEN READ OF THE ROLE CATALOGUE PROVES THE CATALOGUE, NOT THAT POSTGREST APPLIES
-- IT. The PostgREST proof is 243-01-MEASUREMENT.md.
--
-- ⛔ NO SKIP-WHEN-UNAPPLIED BRANCH. If the pin migration is absent the roles carry no
-- timeout and arm 1a fails. That is the right reading: a gate that skipped when its
-- migration was missing would pass on exactly the database it exists to catch.
--
-- ⛔ THIS FILE NEVER RUNS `SET` OR `SET LOCAL statement_timeout`. That would bound its
-- own statements and make a timeout look present. It reads pg_db_role_setting and
-- converts the value to milliseconds with a pure CASE over the unit suffix.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- RED-UNDER-M object that scripts/mutation-runner executes (schema in
-- scripts/mutation-runner/GRAMMAR.md). Every twin is a `sql` step on the live lane after
-- the setup list, so no file is edited. The setup list is what the lane applies before
-- this gate, in order: the core fixture, the Supabase default-privileges fixture, then
-- the migration LAST, so scripts/sql-gate-subset.mjs selects this gate on a push that
-- changes the migration.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20261127120000_client_role_statement_timeout_pin.sql"]}
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_client_role_timeouts.sql

BEGIN;

DO $$
DECLARE
  v_dbid          oid;
  v_anon_has      boolean;
  v_anon_val      text;
  v_anon_ms       numeric;
  v_auth_has      boolean;
  v_auth_val      text;
  v_auth_ms       numeric;
  v_population    integer;
  v_hoisting      text;
  v_shadow        text;
BEGIN
  SELECT d.oid INTO v_dbid FROM pg_database d WHERE d.datname = current_database();

  -- Does the global row (setdatabase = 0) for each role carry a statement_timeout element?
  SELECT bool_or(r.rolname = 'anon'), bool_or(r.rolname = 'authenticated')
    INTO v_anon_has, v_auth_has
    FROM pg_db_role_setting s
    JOIN pg_roles r ON r.oid = s.setrole
    CROSS JOIN LATERAL unnest(s.setconfig) AS e(element)
   WHERE r.rolname IN ('anon', 'authenticated') AND s.setdatabase = 0
     AND e.element LIKE 'statement_timeout=%';
  v_anon_has := COALESCE(v_anon_has, false);
  v_auth_has := COALESCE(v_auth_has, false);

  -- The EFFECTIVE value: the per-database row's element if one exists, else the global
  -- row's. ms is NULL when the value does not parse; 0 means the timeout is disabled.
  WITH raw AS (
    SELECT DISTINCT ON (r.rolname)
           r.rolname,
           regexp_replace(substr(e.element, length('statement_timeout=') + 1), '\s', '', 'g') AS val
      FROM pg_db_role_setting s
      JOIN pg_roles r ON r.oid = s.setrole
      CROSS JOIN LATERAL unnest(s.setconfig) AS e(element)
     WHERE r.rolname IN ('anon', 'authenticated') AND s.setdatabase IN (0, v_dbid)
       AND e.element LIKE 'statement_timeout=%'
     ORDER BY r.rolname, s.setdatabase DESC
  ), eff AS (
    SELECT raw.rolname, raw.val,
           CASE WHEN raw.val ~ '^[0-9]+(\.[0-9]+)?(us|ms|s|min|h|d)?$'
                THEN substring(raw.val from '^[0-9]+(?:\.[0-9]+)?')::numeric
                     * CASE COALESCE(substring(raw.val from '[a-z]+$'), 'ms')
                         WHEN 'us' THEN 0.001 WHEN 'ms' THEN 1 WHEN 's' THEN 1000
                         WHEN 'min' THEN 60000 WHEN 'h' THEN 3600000 WHEN 'd' THEN 86400000
                       END
           END AS ms
      FROM raw
  )
  SELECT max(eff.val) FILTER (WHERE eff.rolname = 'anon'),
         max(eff.ms)  FILTER (WHERE eff.rolname = 'anon'),
         max(eff.val) FILTER (WHERE eff.rolname = 'authenticated'),
         max(eff.ms)  FILTER (WHERE eff.rolname = 'authenticated')
    INTO v_anon_val, v_anon_ms, v_auth_val, v_auth_ms
    FROM eff;

  -- ===== ARM 1a — anon carries a global statement_timeout element =======
  -- RED-UNDER: take the timeout away from anon on the live lane —
  --            `ALTER ROLE anon RESET statement_timeout`. That is what a migration
  --            that resets the role, or a platform that stops setting it, looks like.
  -- RED-UNDER-M: {"arm":"1a","apply":[{"kind":"sql","stmt":"ALTER ROLE anon RESET statement_timeout"}]}
  IF NOT v_anon_has THEN
    RAISE EXCEPTION 'TEST FAILED (1a): anon has no role-level statement_timeout. Without one a client statement can hold a table lock for as long as it likes. Migration 20261127120000 pins it at 3s.';
  END IF;

  -- ===== ARM 1b — anon's effective value is at most 3000 ms ============
  -- RED-UNDER: raise the value on the live lane —
  --            `ALTER ROLE anon SET statement_timeout = '60s'`. The element is still
  --            present, so 1a passes and this arm is what names it.
  -- RED-UNDER-M: {"arm":"1b","apply":[{"kind":"sql","stmt":"ALTER ROLE anon SET statement_timeout = '60s'"}]}
  IF v_anon_ms IS NULL OR v_anon_ms = 0 OR v_anon_ms > 3000 THEN
    RAISE EXCEPTION 'TEST FAILED (1b): anon statement_timeout % ms is above the 3000 ms ceiling (raw value %; 0 means disabled and NULL means unparseable)', COALESCE(v_anon_ms::text, 'NULL'), COALESCE(v_anon_val, 'none');
  END IF;

  -- ===== ARM 2a — authenticated carries a global statement_timeout element
  -- RED-UNDER: take the timeout away from authenticated on the live lane —
  --            `ALTER ROLE authenticated RESET statement_timeout`.
  -- RED-UNDER-M: {"arm":"2a","apply":[{"kind":"sql","stmt":"ALTER ROLE authenticated RESET statement_timeout"}]}
  IF NOT v_auth_has THEN
    RAISE EXCEPTION 'TEST FAILED (2a): authenticated has no role-level statement_timeout. Without one a signed-in client statement can hold a table lock for as long as it likes. Migration 20261127120000 pins it at 8s.';
  END IF;

  -- ===== ARM 2b — authenticated's effective value is at most 8000 ms ===
  -- RED-UNDER: raise the value on the live lane —
  --            `ALTER ROLE authenticated SET statement_timeout = '60s'`. The element
  --            is still present, so 2a passes and this arm is what names it.
  -- RED-UNDER-M: {"arm":"2b","apply":[{"kind":"sql","stmt":"ALTER ROLE authenticated SET statement_timeout = '60s'"}]}
  IF v_auth_ms IS NULL OR v_auth_ms = 0 OR v_auth_ms > 8000 THEN
    RAISE EXCEPTION 'TEST FAILED (2b): authenticated statement_timeout % ms is above the 8000 ms ceiling (raw value %; 0 means disabled and NULL means unparseable)', COALESCE(v_auth_ms::text, 'NULL'), COALESCE(v_auth_val, 'none');
  END IF;

  -- ===== ARM 3 — no client-executable exposed function overrides the timeout
  SELECT count(*) INTO v_population
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'graphql_public')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF v_population = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (3-SETUP): no function in public or graphql_public is executable by anon or authenticated, so the sweep for a statement_timeout override would pass without having looked at any function. Check this gate''s apply list.';
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_hoisting
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'graphql_public')
     AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     AND EXISTS (
       SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS c(element)
        WHERE c.element LIKE 'statement_timeout=%'
     );
  -- RED-UNDER: add a client-executable function that carries its own setting —
  --            `CREATE FUNCTION public.zz_gate_hoist() ... SET statement_timeout =
  --            '1h'`. PUBLIC holds EXECUTE on a new function by default, so anon and
  --            authenticated both may call it, and PostgREST would apply the hour
  --            instead of the role's 3s or 8s.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"sql","stmt":"CREATE FUNCTION public.zz_gate_hoist() RETURNS int LANGUAGE sql SET statement_timeout = '1h' AS 'SELECT 1'"}]}
  IF v_hoisting IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3): function(s) % may be executed by anon or authenticated and carry their own statement_timeout. PostgREST hoists a function-level setting over the role value, so each lifts the bound for its own call. Drop the SET statement_timeout from the function (the role value is the bound).', v_hoisting;
  END IF;

  -- ===== ARM 4 — no per-database row shadows the global pin ============
  SELECT string_agg(r.rolname || ' (' || e.element || ')', ', ' ORDER BY r.rolname) INTO v_shadow
    FROM pg_db_role_setting s
    JOIN pg_roles r ON r.oid = s.setrole
    CROSS JOIN LATERAL unnest(s.setconfig) AS e(element)
   WHERE r.rolname IN ('anon', 'authenticated') AND s.setdatabase = v_dbid
     AND e.element LIKE 'statement_timeout=%';
  -- RED-UNDER: write a per-database row for anon —
  --            `ALTER ROLE anon IN DATABASE <this database> SET statement_timeout =
  --            '3s'`. The value equals the pin, so 1a and 1b stay green: the arm names
  --            the SHADOWING row itself, which would carry whatever value someone sets
  --            next and win over the global one.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"sql","stmt":"DO $t$ BEGIN EXECUTE format('ALTER ROLE anon IN DATABASE %I SET statement_timeout = ''3s''', current_database()); END $t$"}]}
  IF v_shadow IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (4): a per-database pg_db_role_setting row for % carries a statement_timeout: %. It shadows the global row the pin migration writes, so the effective timeout is whatever that row says. Remove it with ALTER ROLE <role> IN DATABASE <db> RESET statement_timeout.', current_database(), v_shadow;
  END IF;

  RAISE NOTICE 'ALL 6 ARMS EXECUTED (1a, 1b, 2a, 2b, 3, 4): anon carries a role-level statement_timeout (1a) at or below 3000 ms (1b), authenticated carries one (2a) at or below 8000 ms (2b), no function that anon or authenticated may execute in public or graphql_public carries its own statement_timeout (3), and no per-database row shadows the global pin (4).';
  RAISE NOTICE 'client role timeouts OK: the catalogue the migrations produce holds the pin; this proves the CATALOGUE, not that PostgREST applies it (243-01-MEASUREMENT.md does).';
END $$;

ROLLBACK;
