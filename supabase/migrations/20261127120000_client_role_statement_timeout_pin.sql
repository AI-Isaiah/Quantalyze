-- Migration: pin the client roles' statement timeouts in the repo — anon at 3s,
-- authenticated at 8s — Phase 243 DBBACKSTOP (DBACC-03, plan 02).
--
-- Why this migration exists
-- -------------------------
-- DBACC-03 / TODOS TRIGGERREVOKE-LOCKHOLD-01: a holder of UPDATE or DELETE on a table
-- may `LOCK TABLE` it, and a role-level statement timeout is what bounds how long any
-- one client statement can hold such a lock. The bound is already there on both hosted
-- projects, set by the Supabase platform. What was missing is the bound being IN THE
-- REPO: nothing recorded it, and nothing would have noticed a change to it.
--
-- These values RESTATE the platform defaults
-- ------------------------------------------
-- 243-01-MEASUREMENT.md read the live `pg_db_role_setting` rows on TEST and on PROD
-- (marker query first): `anon` carries `statement_timeout=3s` and `authenticated`
-- carries `statement_timeout=8s`. Applying this file therefore changes nothing a client
-- sees. PostgREST applies an impersonated role's settings per request transaction;
-- the TEST REST measurement proved that for anon (a held statement was cut at 3.20s and
-- 3.87s, both SQLSTATE 57014). This file cannot prove it: it only writes the catalogue.
--
-- Two things the pin does NOT cover, both guarded by the gate
-- supabase/tests/test_client_role_timeouts.sql rather than by this file:
--   * A function-level `SET statement_timeout` is HOISTED by PostgREST over the role's
--     value. A function that anon or authenticated may execute and that carries one
--     would lift the bound for its own call. Gate arm 3 refuses it.
--   * A per-database row (`ALTER ROLE ... IN DATABASE ... SET`) silently shadows the
--     global row this file writes. The self-check below and gate arm 4 refuse it.
--
-- Role config is cluster-level and absent from supabase/schema/baseline.sql
-- ----------------------------------------------------------------------------
-- The schema-only baseline dump carries no `ALTER ROLE ... SET`, so this file and the
-- gate are the only repo-side record of the pin. ⛔ Nothing compares the LIVE role
-- config on TEST or PROD against it: a dashboard or platform `ALTER ROLE` there would
-- go unnoticed until someone reads pg_db_role_setting again (plan 02 SUMMARY, Known
-- limits).
--
-- idle_in_transaction_session_timeout is deliberately NOT pinned: 243-01 observed no
-- idle-in-transaction window, because PostgREST aborts at once on the cancellation.
--
-- ⛔ DELIBERATELY NO DATA-READING STEP. The self-check reads pg_db_role_setting,
-- pg_roles and pg_database and NOTHING else, so the schema-only shared TEST database
-- behaves exactly like PROD ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]).
--
-- Why the self-check asserts exact values: every RED-UNDER-M twin of the gate is a
-- `sql` step that runs AFTER this file on the throwaway lane. None edits this file, so
-- this block may assert the pinned values without aborting a mutated apply (the abort
-- the comment above the verify block of 20261123180000_api_keys_venue_server.sql warns
-- about).
--
-- Rollback: supabase/migrations/down/20261127120000-rollback.sql. It restates the
-- values and never RESETs a role: the platform default lives in the same
-- pg_db_role_setting row, so a RESET would leave anon with no timeout at all.

SET LOCAL lock_timeout = '3s';

ALTER ROLE anon SET statement_timeout = '3s';
ALTER ROLE authenticated SET statement_timeout = '8s';

NOTIFY pgrst, 'reload config';

-- --------------------------------------------------------------------------
-- Self-check: catalogue only, passes on an empty database.
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_dbid  oid;
  v_role  text;
  v_want  text;
  v_pairs text[][] := ARRAY[['anon', '3s'], ['authenticated', '8s']];
  i       integer;
BEGIN
  SELECT d.oid INTO v_dbid FROM pg_database d WHERE d.datname = current_database();

  FOR i IN 1 .. array_length(v_pairs, 1) LOOP
    v_role := v_pairs[i][1];
    v_want := v_pairs[i][2];

    -- (a) the global row (setdatabase = 0) carries exactly the pinned element.
    IF NOT EXISTS (
      SELECT 1
        FROM pg_db_role_setting s
        JOIN pg_roles r ON r.oid = s.setrole
       WHERE r.rolname = v_role
         AND s.setdatabase = 0
         AND ('statement_timeout=' || v_want) = ANY (s.setconfig)
    ) THEN
      RAISE EXCEPTION 'migration 20261127120000 failed: role % does not carry statement_timeout=% in its global pg_db_role_setting row after the ALTER ROLE', v_role, v_want;
    END IF;

    -- (b) no per-database row for this database sets a statement_timeout for the
    -- role: it would shadow the global value this file just wrote.
    IF EXISTS (
      SELECT 1
        FROM pg_db_role_setting s
        JOIN pg_roles r ON r.oid = s.setrole
        CROSS JOIN LATERAL unnest(s.setconfig) AS e(element)
       WHERE r.rolname = v_role
         AND s.setdatabase = v_dbid
         AND e.element LIKE 'statement_timeout=%'
    ) THEN
      RAISE EXCEPTION 'migration 20261127120000 failed: role % has a per-database statement_timeout row for % that shadows the global pin; remove it with ALTER ROLE % IN DATABASE % RESET statement_timeout', v_role, current_database(), v_role, current_database();
    END IF;
  END LOOP;
END
$verify$;
