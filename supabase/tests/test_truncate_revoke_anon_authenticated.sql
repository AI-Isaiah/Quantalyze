-- Test: anon and authenticated hold no TRUNCATE on any public relation, now or on
-- a table postgres creates later (Phase 164.9.7 TRUNCATEREVOKE, plan 01).
--
-- WHY THIS FILE EXISTS. Row security never evaluates TRUNCATE, so no policy test
-- in supabase/tests can see it. The grant layer is the only control. The Supabase
-- platform bootstrap grants ALL, TRUNCATE included, on every new public table to
-- anon, authenticated and service_role, and migration 20261009130000 removes the
-- verb from the first two on every existing relation and from the postgres default
-- privilege for tables. This gate re-reads that state, so a later migration that
-- re-grants it, or that creates a table under a default that grants it, goes RED
-- here instead of shipping.
--
-- TRACER SLICE: only arm TRUNC 1 is present in this commit; the remaining arms follow.
-- THE SIX ARMS, and why each needs the others:
--   TRUNC 1  catalogue sweep: no public relation of kind r, p, v, m or f lets anon
--            or authenticated TRUNCATE (has_table_privilege, so PUBLIC grants and
--            role inheritance count). A setup check before it requires the sweep
--            to see at least one relation on which a client role still holds
--            SELECT, so "no TRUNCATE" cannot mean "no privileges at all".
--   TRUNC 2  a table postgres creates AFTER the migration grants neither client
--            role TRUNCATE (the default-privilege half of the fix).
--   TRUNC 3  the same new table grants service_role TRUNCATE (the revoke removed
--            nothing from the roles that keep it).
--   TRUNC 4  the same new table grants anon and authenticated SELECT (the revoke
--            removed exactly one verb, not "everything").
--   TRUNC 5  service_role holds TRUNCATE on the existing public.cron_runs.
--   TRUNC 6  `TRUNCATE public.cron_runs` as authenticated is refused with SQLSTATE
--            42501 by the GRANT layer (the refusal text names the table, so a
--            missing schema USAGE grant cannot pass for it).
-- TRUNC 2 to 4 share one probe table created inside this file's transaction and
-- rolled back with it, so nothing survives on any database this runs on.
--
-- ⛔ FIXTURE 07 IS LOAD-BEARING AND UNTOUCHED. ALTER DEFAULT PRIVILEGES is not
-- retroactive, so tables created before fixture 07 (profiles, strategies) never
-- held the bootstrap grant and a REVOKE on them is a no-op. Only a table created
-- AFTER 07 inherits ALL, TRUNCATE included, and makes the migration's REVOKE do
-- real work on the lane. That is why the apply list below carries cron_runs, which
-- migration 20260408113029 creates after 07. Without fixture 07 TRUNC 1 would pass
-- for a reason unrelated to the migration.
--
-- ⛔ NO SKIP-WHEN-UNAPPLIED BRANCH. If migration 20261009130000 is absent the
-- sweep finds cron_runs holding the bootstrap grant and TRUNC 1 fails, which is the
-- right reading. A gate that skipped when its migration was missing would pass on
-- exactly the database it exists to catch.
--
-- This file reads only the catalogue and the objects it creates itself, because the
-- three lanes that run it (the pg-lane, the local-stack lane with the full dump,
-- and shared TEST) carry different catalogues. It rolls back at the end.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER above an arm carries an
-- adjacent RED-UNDER-M object that scripts/mutation-runner executes (schema in
-- scripts/mutation-runner/GRAMMAR.md). Every twin is a `sql` step: a statement run
-- on the live lane after the migrations, so no migration file and no fixture is
-- edited. The list below is what the lane applies before this gate, in order:
--   * 01 core fixture: auth.users, profiles, auth.uid(), the client roles.
--   * 07 default privileges, BEFORE the tables that matter, so cron_runs carries
--     the grants a hosted project gives it.
--   * 12 profiles.is_admin and 15 auth.role(): objects the cron_runs policies
--     resolve at declaration time.
--   * the real cron_runs migration, never the stand-in fixture.
--   * migration 20261009130000, last.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","supabase/migrations/20260408113029_cron_heartbeat.sql","supabase/migrations/20261009130000_revoke_truncate_anon_authenticated.sql"]}
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_truncate_revoke_anon_authenticated.sql

BEGIN;

DO $$
DECLARE
  v_seen     INTEGER;
  v_held     TEXT;
  p_anon_t   BOOLEAN;
  p_auth_t   BOOLEAN;
  p_sr_t     BOOLEAN;
  p_anon_s   BOOLEAN;
  p_auth_s   BOOLEAN;
  v_sr_cron  BOOLEAN;
  v_state    TEXT;
  v_sqlstate TEXT;
  v_msg      TEXT;
BEGIN
  -- Table creation below must run as the role whose default ACL the migration
  -- changed. On every lane the session role is postgres already.
  IF current_user <> 'postgres' THEN
    SET LOCAL ROLE postgres;
  END IF;

  -- ===== ARM TRUNC 1 — no relation lets a client role TRUNCATE ============
  -- The sweep must be looking at something: at least one relation on which a
  -- client role still holds SELECT. Otherwise "zero TRUNCATE holders" reads the
  -- same as "the sweep saw nothing".
  SELECT count(*) INTO v_seen
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
     AND (has_table_privilege('anon', c.oid, 'SELECT')
          OR has_table_privilege('authenticated', c.oid, 'SELECT'));
  IF v_seen = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (TRUNC 1-SETUP): no public relation lets anon or authenticated SELECT, so a sweep for TRUNCATE holders would pass without having looked at any default-granted table. Check that fixture 07 and the table-creating migration are in this gate''s apply list, in that order.';
  END IF;

  SELECT string_agg(c.relname || '/' || r.rolname, ', ' ORDER BY c.relname, r.rolname) INTO v_held
    FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
     AND has_table_privilege(r.rolname, c.oid, 'TRUNCATE');

  -- RED-UNDER: re-grant the privilege on one existing table on the live lane —
  --            `GRANT TRUNCATE ON public.profiles TO anon`. profiles predates
  --            fixture 07 and so never held the bootstrap grant; the grant is
  --            what a later hardening-undoing migration would look like, and the
  --            sweep must name it as the first failure.
  -- RED-UNDER-M: {"arm":"TRUNC 1","apply":[{"kind":"sql","stmt":"GRANT TRUNCATE ON public.profiles TO anon"}]}
  IF v_held IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (TRUNC 1): anon or authenticated can still TRUNCATE public relation(s) (relation/role): %. Row security never evaluates TRUNCATE, so any holder can empty the table whatever its policies say. Fix it at the grant layer: REVOKE TRUNCATE ... FROM anon, authenticated; if the REVOKE printed nothing and changed nothing, the grantor is another role, so find it with aclexplode(relacl) and re-run the REVOKE under SET ROLE <grantor>.', v_held;
  END IF;

  RAISE NOTICE 'TRUNCATE grants OK: no public relation lets anon or authenticated TRUNCATE (TRUNC 1; tracer slice, arms TRUNC 2 to 6 follow).';
END $$;

ROLLBACK;
