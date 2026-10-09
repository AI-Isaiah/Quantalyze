-- Test: anon and authenticated hold no TRUNCATE, TRIGGER or MAINTAIN on any public
-- relation, now or on a table postgres creates later (Phase 164.9.7 TRUNCATEREVOKE
-- plan 01, extended in place by Phase 164.9.7.1 TRIGGERREVOKE plan 01).
--
-- WHY THIS FILE EXISTS. Row security never evaluates TRUNCATE, TRIGGER or
-- MAINTAIN, so no policy test in supabase/tests can see them. The grant layer is
-- the only control. The Supabase platform bootstrap grants ALL (TRUNCATE, TRIGGER
-- and, on PostgreSQL 17, MAINTAIN included) on every new public table to anon,
-- authenticated and service_role. Migration 20261009130000 removes TRUNCATE from
-- the first two on every existing relation and from the postgres default privilege
-- for tables; migration 20261009150000 does the same for TRIGGER and MAINTAIN. This
-- gate re-reads that state, so a later migration that re-grants any of the three,
-- or that creates a table under a default that grants it, goes RED here instead of
-- shipping. The filename keeps its original word because renaming the file would
-- move every per-file census row for no gain.
--
-- THE SIX TRUNCATE ARMS, and why each needs the others:
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
-- THE FIVE VERB ARMS (TRIGGER on every server, MAINTAIN on PostgreSQL 17 and later).
-- The verb list v_verbs is DATA, built once by the same CASE the migration uses, so
-- each arm below is one raise site that covers every verb the server has:
--   VERB 1   catalogue sweep: no public relation of kind r, p, v, m or f lets anon
--            or authenticated hold any verb in v_verbs (has_table_privilege, so
--            PUBLIC grants and role inheritance count). Its setup check pins to the
--            default-granted public.cron_runs: service_role must hold every verb
--            and authenticated must hold DELETE, so "no holders" cannot mean "the
--            sweep looked at nothing".
--   VERB 2   the probe table (created after the migration) grants neither client
--            role any verb in v_verbs (the default-privilege half of the fix).
--   VERB 3   the same probe grants service_role every verb in v_verbs.
--   VERB 4   authenticated still holds INSERT, UPDATE and DELETE on the EXISTING
--            public.cron_runs (the revoke removed exactly two verbs from exactly two
--            roles). An existing table on purpose: Supabase withdraws SELECT, INSERT,
--            UPDATE and DELETE from the new-table default on 2026-10-30, which would
--            change what a fresh probe inherits.
--   VERB 5   `CREATE TRIGGER ... ON public.profiles` as authenticated is refused
--            with SQLSTATE 42501 and leaves no trigger behind. On the local-stack
--            lane profiles held TRIGGER for authenticated before the migration (the
--            dump), so the refusal is the migration's doing. On the pg-lane profiles
--            predates fixture 07 and never held TRIGGER, so there the arm reads the
--            same with or without the migration; its twin still proves the raise
--            site bites.
--
-- ⛔ MAINTAIN IS EVALUATED ONLY WHERE THE SERVER HAS IT, AND NO MUTATION TWIN CAN
-- SHOW IT RED. The sql-mutation pg-lane runs PostgreSQL 16, which has no MAINTAIN:
-- GRANT, REVOKE and has_table_privilege all raise `unrecognized privilege type`.
-- So on the pg-lane v_verbs is {TRIGGER} and the notice below says so. On the
-- local-stack lane (image pinned to 17.6.1.113) v_verbs is {TRIGGER,MAINTAIN} and
-- the same raise sites read MAINTAIN too. The twins are TRIGGER-based and prove the
-- raise sites and query shapes bite; the MAINTAIN datum rides the same code. This is
-- founder decision D-07, and its compensating controls are: the migration's own
-- self-check on every PostgreSQL 17 apply (shared TEST, PROD, the local-stack lane),
-- one recorded manual RED of the MAINTAIN half on a PostgreSQL 17 database, a static
-- vitest pin that this verb list names MAINTAIN and that the lane image is major 17
-- or later, and the MAINTAIN-LANE-PG17-01 booking to move the pg-lane to 17. There
-- is deliberately no MAINTAIN-only section (a section with no twin is refused by the
-- inclusion pin while WAIVED_CEILING is 0) and no skip token anywhere.
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
-- sweep finds cron_runs holding the bootstrap grant and TRUNC 1 fails; if migration
-- 20261009150000 is absent VERB 1 fails the same way (the pg-lane's fixture 07 grants
-- ALL, which on PostgreSQL 16 includes TRIGGER). That is the right reading. A gate
-- that skipped when its migration was missing would pass on exactly the database it
-- exists to catch.
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
--   * migration 20261009130000, then migration 20261009150000, last.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","supabase/migrations/20260408113029_cron_heartbeat.sql","supabase/migrations/20261009130000_revoke_truncate_anon_authenticated.sql","supabase/migrations/20261009150000_revoke_trigger_maintain_anon_authenticated.sql"]}
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
  -- Same CASE as migration 20261009150000. The literal MAINTAIN is only ever a
  -- datum inside this array, and the array only holds it on PostgreSQL 17 and later.
  v_verbs    TEXT[] := CASE WHEN current_setting('server_version_num')::int >= 170000
                            THEN ARRAY['TRIGGER','MAINTAIN'] ELSE ARRAY['TRIGGER'] END;
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

  -- ===== ARM VERB 1 — no relation lets a client role hold TRIGGER/MAINTAIN =
  -- Plain notice, no skip token: the anti-skip step of the sql-tests lane fails a
  -- file that prints one, and a PostgreSQL 16 lane legitimately evaluates fewer verbs.
  RAISE NOTICE 'verbs evaluated: %', v_verbs;

  -- Anti-vacuity, pinned to the DEFAULT-GRANTED public.cron_runs (a table created
  -- after fixture 07, so it carries the bootstrap grant on the pg-lane and the dump's
  -- grants on the local-stack lane): service_role must hold every verb under test and
  -- authenticated must hold DELETE, or "no client holder" says nothing.
  IF NOT (SELECT bool_and(has_table_privilege('service_role', 'public.cron_runs'::regclass, vb.verb))
            FROM unnest(v_verbs) AS vb(verb))
     OR NOT has_table_privilege('authenticated', 'public.cron_runs'::regclass, 'DELETE') THEN
    RAISE EXCEPTION 'TEST FAILED (VERB 1-SETUP): public.cron_runs does not show service_role holding every verb in % and authenticated holding DELETE, so a sweep for client-role holders of those verbs would pass without having looked at a default-granted table. Check that fixture 07 and the cron_runs migration are in this gate''s apply list, in that order.', v_verbs;
  END IF;

  SELECT string_agg(c.relname || '/' || r.rolname || '/' || vb.verb, ', ' ORDER BY c.relname, r.rolname, vb.verb) INTO v_held
    FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname) CROSS JOIN unnest(v_verbs) AS vb(verb)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
     AND has_table_privilege(r.rolname, c.oid, vb.verb);

  -- RED-UNDER: re-grant TRIGGER on one existing table on the live lane —
  --            `GRANT TRIGGER ON public.profiles TO anon`. profiles predates
  --            fixture 07 and so never held the bootstrap grant; the grant is what
  --            a later hardening-undoing migration would look like, and the sweep
  --            must name it as the first failure.
  -- RED-UNDER-M: {"arm":"VERB 1","apply":[{"kind":"sql","stmt":"GRANT TRIGGER ON public.profiles TO anon"}]}
  IF v_held IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (VERB 1): anon or authenticated can still hold TRIGGER or MAINTAIN on public relation(s) (relation/role/verb): %. Row security never evaluates either verb: a TRIGGER holder can attach code that a BYPASSRLS writer then runs, and a MAINTAIN holder can VACUUM, CLUSTER, REINDEX or REFRESH the table. Fix it at the grant layer: REVOKE ... FROM anon, authenticated; if the REVOKE printed nothing and changed nothing, the grantor is another role, so find it with aclexplode(relacl) and re-run the REVOKE under SET ROLE <grantor>.', v_held;
  END IF;

  -- ----- probe: a table postgres creates AFTER the migration ---------------
  -- Created after TRUNC 1 and VERB 1 on purpose: a default-privilege twin changes
  -- what NEW tables inherit and is not retroactive, so it must not trip the sweeps
  -- above.
  CREATE TABLE public.truncate_revoke_probe_16497 (id INTEGER);
  p_anon_t := has_table_privilege('anon', 'public.truncate_revoke_probe_16497'::regclass, 'TRUNCATE');
  p_auth_t := has_table_privilege('authenticated', 'public.truncate_revoke_probe_16497'::regclass, 'TRUNCATE');
  p_sr_t   := has_table_privilege('service_role', 'public.truncate_revoke_probe_16497'::regclass, 'TRUNCATE');
  p_anon_s := has_table_privilege('anon', 'public.truncate_revoke_probe_16497'::regclass, 'SELECT');
  p_auth_s := has_table_privilege('authenticated', 'public.truncate_revoke_probe_16497'::regclass, 'SELECT');

  -- ===== ARM TRUNC 2 — a new table grants the client roles no TRUNCATE ====
  -- RED-UNDER: hand the privilege back through the DEFAULT, not through a table —
  --            `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT
  --            TRUNCATE ON TABLES TO authenticated`. That is the regression
  --            where a later migration or a platform change restores the
  --            bootstrap default, and every future table is born holding it.
  -- RED-UNDER-M: {"arm":"TRUNC 2","apply":[{"kind":"sql","stmt":"ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE ON TABLES TO authenticated"}]}
  IF p_anon_t OR p_auth_t THEN
    RAISE EXCEPTION 'TEST FAILED (TRUNC 2): a table postgres created in public after the migration grants TRUNCATE to anon=% authenticated=%. The postgres default privilege for tables still carries the verb, so every table a future migration creates will be born with it and the existing-table sweep (TRUNC 1) will only catch it after the fact.', p_anon_t, p_auth_t;
  END IF;

  -- ===== ARM TRUNC 3 — a new table still grants service_role TRUNCATE =====
  -- RED-UNDER: remove the verb from the default for the role that must keep it —
  --            `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  --            REVOKE TRUNCATE ON TABLES FROM service_role` — the realistic
  --            over-broad edit of the migration's own default-privilege line.
  -- RED-UNDER-M: {"arm":"TRUNC 3","apply":[{"kind":"sql","stmt":"ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM service_role"}]}
  IF NOT p_sr_t THEN
    RAISE EXCEPTION 'TEST FAILED (TRUNC 3): a table postgres created in public after the migration does NOT grant TRUNCATE to service_role. The default-privilege change removed the verb from a role that must keep it; the service path (maintenance and reset jobs) loses it on every new table. D-01 removes TRUNCATE from anon and authenticated and from nobody else.';
  END IF;

  -- ===== ARM TRUNC 4 — a new table still grants the client roles SELECT ===
  -- RED-UNDER: remove a DIFFERENT verb from the default —
  --            `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  --            REVOKE SELECT ON TABLES FROM authenticated`. This is "the REVOKE
  --            went too far": TRUNC 2 stays green, because a table nobody can
  --            use also holds no TRUNCATE.
  -- RED-UNDER-M: {"arm":"TRUNC 4","apply":[{"kind":"sql","stmt":"ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE SELECT ON TABLES FROM authenticated"}]}
  IF NOT (p_anon_s AND p_auth_s) THEN
    RAISE EXCEPTION 'TEST FAILED (TRUNC 4): a table postgres created in public after the migration does not grant SELECT to anon=% authenticated=%. The default-privilege change removed more than the one verb it was meant to remove, so TRUNC 2 above would read "no TRUNCATE" off a table nobody can use.', p_anon_s, p_auth_s;
  END IF;

  -- ===== ARM TRUNC 5 — service_role keeps TRUNCATE on an existing table ===
  v_sr_cron := has_table_privilege('service_role', 'public.cron_runs'::regclass, 'TRUNCATE');
  -- RED-UNDER: take the verb from service_role on the existing table —
  --            `REVOKE TRUNCATE ON public.cron_runs FROM service_role` — the
  --            shape of a REVOKE widened to a role it was not written for.
  -- RED-UNDER-M: {"arm":"TRUNC 5","apply":[{"kind":"sql","stmt":"REVOKE TRUNCATE ON public.cron_runs FROM service_role"}]}
  IF NOT v_sr_cron THEN
    RAISE EXCEPTION 'TEST FAILED (TRUNC 5): service_role no longer holds TRUNCATE on public.cron_runs. The revoke is meant to remove the verb from anon and authenticated only; the migration''s own holder-count check should have refused this apply.';
  END IF;

  -- ===== ARM TRUNC 6 — the grant layer refuses an authenticated TRUNCATE ===
  -- ⛔ The handler records state and the SQLSTATE and nothing else. The assertion
  -- is read AFTER RESET ROLE: probing inside an exception handler is lint rule
  -- R1, and a probe that runs as the denied role measures the wrong thing.
  SET LOCAL ROLE authenticated;
  v_state := NULL;
  v_sqlstate := NULL;
  v_msg := NULL;
  BEGIN
    TRUNCATE public.cron_runs;
  EXCEPTION WHEN OTHERS THEN
    v_state := 'denied';
    v_sqlstate := SQLSTATE;
    v_msg := SQLERRM;
  END;
  RESET ROLE;

  -- RED-UNDER: hand the verb back on the live lane —
  --            `GRANT TRUNCATE ON public.cron_runs TO authenticated`. TRUNC 1
  --            fires first on that grant, so this arm is observed with TRUNC 1
  --            neutered (GRAMMAR Shape 2): the statement then SUCCEEDS and the
  --            behavioural arm is what names it, which is what proves the
  --            catalogue sweep and the real statement agree.
  -- RED-UNDER-M: {"arm":"TRUNC 6","apply":[{"kind":"sql","stmt":"GRANT TRUNCATE ON public.cron_runs TO authenticated"}],"neuter":[{"arm":"TRUNC 1"}]}
  IF v_state IS DISTINCT FROM 'denied' OR v_sqlstate IS DISTINCT FROM '42501' OR v_msg NOT LIKE '%permission denied for table cron_runs%' THEN
    RAISE EXCEPTION 'TEST FAILED (TRUNC 6): an authenticated user''s TRUNCATE of public.cron_runs was % (SQLSTATE %, message %), expected a 42501 refusal naming the table. Row security was never consulted and could not have been: TRUNCATE is refused or allowed at the grant layer alone, so this is the statement an injected query or a pooled session running as the client role would issue.', COALESCE(v_state, 'permitted'), COALESCE(v_sqlstate, 'none'), COALESCE(v_msg, 'none');
  END IF;

  RAISE NOTICE 'TRUNCATE grants OK: no public relation lets anon or authenticated TRUNCATE (TRUNC 1), a new postgres-created table grants them none (TRUNC 2) while service_role keeps it (TRUNC 3) and the client roles keep SELECT (TRUNC 4), service_role still holds it on cron_runs (TRUNC 5), and authenticated is refused 42501 (TRUNC 6).';
END $$;

ROLLBACK;
