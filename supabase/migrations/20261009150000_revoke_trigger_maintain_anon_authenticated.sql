-- Migration: anon and authenticated no longer hold TRIGGER or MAINTAIN on public
-- relations — Phase 164.9.7.1 TRIGGERREVOKE (plan 01).
--
-- Why this migration exists
-- -------------------------
-- Row-level security never evaluates TRIGGER or MAINTAIN. A policy can say who may
-- read, insert, update or delete a row; neither verb looks at rows, so no policy is
-- consulted for them. The grant layer is the ONLY control, and it was wide open:
-- measured read-only on PROD on 2026-10-08, anon held TRIGGER on 56 public
-- relations (53 base tables + 3 views) and authenticated on 59 (56 + 3); MAINTAIN
-- on 57 (54 + 3) and 61 (58 + 3).
--   * TRIGGER lets a client role run CREATE TRIGGER on the table. The trigger body
--     is then executed by whichever role later writes the table, and the service
--     path writes with BYPASSRLS. That is code of the client's choosing running as
--     a role that RLS does not constrain.
--   * MAINTAIN (PostgreSQL 17 and later) lets a client role run VACUUM (FULL),
--     ANALYZE, CLUSTER, REINDEX and REFRESH MATERIALIZED VIEW on the table, each of
--     which takes a long, table-wide lock.
--
-- Where the privilege came from
-- -----------------------------
-- Not from this repo's migration chain. The Supabase platform bootstrap installs a
-- default ACL on schema public that grants arwdDxtm (INSERT, SELECT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) on every new table to postgres, anon,
-- authenticated and service_role. Every table this repo ever created inherited it.
-- Migration 20261009130000 (164.9.7) removed D (TRUNCATE) from the client roles;
-- this migration removes t (TRIGGER) and m (MAINTAIN). Earlier hardening migrations
-- had already removed TRIGGER, one table at a time, from cron_runs and
-- system_settings, which is why the two verbs have different holder sets today.
--
-- Scope
-- -----
--   * Every relation in schema public of kind r (table), p (partitioned table),
--     v (view), m (materialised view) and f (foreign table). The REVOKE and the
--     self-check share ONE relation set, so a revoked-but-unchecked entry cannot
--     exist.
--   * Roles anon and authenticated ONLY. service_role and postgres keep both verbs
--     (the self-check below proves the service_role holder count does not move).
--   * The postgres default privilege for tables in schema public, written FOR ROLE
--     postgres explicitly: an unqualified ALTER DEFAULT PRIVILEGES targets
--     current_user, which is not guaranteed to be postgres when the apply connects
--     through a login role that is a member of it.
--
-- Caller impact
-- -------------
-- None. The reliance audit (phase RESEARCH, re-run at execution) found no
-- application, test or CI path that issues CREATE TRIGGER, VACUUM, CLUSTER, REINDEX,
-- REFRESH MATERIALIZED VIEW or LOCK TABLE as anon or authenticated. Existing
-- triggers keep firing: trigger firing does not consult the table-level TRIGGER
-- privilege (MEASURED on PostgreSQL 17.6: a SECURITY DEFINER AFTER INSERT trigger
-- still fired for an authenticated INSERT while authenticated held no TRIGGER on
-- the table). Every other verb anon and authenticated hold is untouched, so every
-- RLS-scoped read and write keeps working.
--
-- What revoking MAINTAIN does and does not close
-- ----------------------------------------------
-- Revoking MAINTAIN closes VACUUM, CLUSTER, REINDEX and REFRESH MATERIALIZED VIEW
-- for the client roles, and revoking TRIGGER closes the TRIGGER attach vector. It
-- does NOT close the table-wide lock. PostgreSQL 17 permits LOCK TABLE in any mode
-- to a holder of MAINTAIN, UPDATE, DELETE or TRUNCATE, and the client roles keep
-- UPDATE and DELETE by design, behind RLS.
-- The ACCESS EXCLUSIVE lock-hold stays reachable through UPDATE and DELETE
-- (MEASURED on PostgreSQL 17.6: authenticated, holding UPDATE and DELETE and no
-- MAINTAIN, took ACCESS EXCLUSIVE). That residual is booked separately as
-- TRIGGERREVOKE-LOCKHOLD-01 and is not closed here.
--
-- ⛔ MAINTAIN EXISTS ONLY ON POSTGRESQL 17 AND LATER, and every MAINTAIN statement
-- below sits behind current_setting('server_version_num')::int >= 170000. On
-- PostgreSQL 16, REVOKE ... MAINTAIN, ALTER DEFAULT PRIVILEGES ... REVOKE MAINTAIN
-- and has_table_privilege(..., 'MAINTAIN') all raise `unrecognized privilege type`.
-- The SQL gate's setup list applies THIS FILE on the PostgreSQL 16 mutation
-- pg-lane, so an unguarded MAINTAIN statement would fail that apply and report
-- every gate arm as a baseline defect. The MAINTAIN statements are STATIC statements
-- inside an IF whose untaken branch is parsed and never run on 16 (no EXECUTE, no
-- format()), and TRIGGER and MAINTAIN are always separate statements: a combined
-- `REVOKE TRIGGER, MAINTAIN` would fail whole on 16. Production, shared TEST and
-- the local-stack lane run PostgreSQL 17, so the MAINTAIN half is applied and
-- proven there.
--
-- ⛔ THE REVOKE IS SILENT WHEN IT DOES NOTHING. REVOKE removes only grants made by
-- the current user or by a role it is a member of. On a grantor mismatch it prints
-- REVOKE, exits 0 and the privilege survives (MEASURED 2026-09-12 on PostgreSQL
-- 16.13, migration 20260911130000, superuser included). Today every TRIGGER and
-- MAINTAIN ACL entry on PROD has grantor postgres and none is granted to PUBLIC, so
-- this is a guard, not a live fault, but a statement that cannot fail loudly is not
-- a proof. So the REVOKE and its proof live in ONE DO block: after the statements,
-- a catalogue sweep asks has_table_privilege (which also counts PUBLIC grants and
-- role inheritance) whether either role can still hold either verb on anything,
-- whether the postgres default ACL still grants it, and whether the service_role
-- holder count moved. Each of those raises `migration 20261009150000 failed: ...`
-- and aborts the apply. One DO block is one statement, so it is atomic even under a
-- lane that replays each migration file in autocommit.
--
-- ⛔ DELIBERATELY NO DATA-READING STEP. The self-check reads pg_class,
-- pg_default_acl, aclexplode and has_table_privilege and NOTHING else. No row of
-- any public table is read, so the schema-only shared TEST database behaves
-- exactly like PROD. A guard that counted rows could refuse on an empty TEST and
-- thereby block the PROD apply ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]).
--
-- ⛔ NO SECOND DEFAULT-PRIVILEGE OWNER. Do not add a FOR ROLE statement for the
-- platform admin role. postgres is not a member of it, so PostgreSQL refuses with
-- `permission denied to change default privileges` and the apply aborts on TEST and
-- on PROD.
--
-- Accepted residual (founder decision D-09, 2026-10-08, the same acceptance 164.9.7
-- recorded for TRUNCATE): TRIGGER and MAINTAIN on the storage.* and net.* relations
-- are platform-owned and are not touched. The platform admin role's own default-ACL
-- row on public still grants TRIGGER and MAINTAIN (and TRUNCATE) to anon and
-- authenticated on tables THAT ROLE creates (measured on PROD 2026-10-08), and
-- postgres cannot alter it. No such table exists today: all 67 public relations are
-- owned by postgres and none is extension-owned. This migration records the
-- residual and does not touch it. The read-only detector that would watch it is
-- TRUNCREVOKE-ADMIN-DETECTOR-01, booked in TODOS and not built here.
--
-- Rollback: supabase/migrations/down/20261009150000-rollback.sql restores the exact
-- pre-migration holder sets, one list per verb (plan 02). It is a manual file, off
-- the auto-apply path. It does not restore TRUNCATE: 164.9.7 owns that.

-- --------------------------------------------------------------------------
-- STEP 1: revoke, default-privilege revoke and catalogue self-check, one DO
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_maint     boolean := current_setting('server_version_num')::int >= 170000;
  v_verbs     text[];
  v_sr_before int;
  v_sr_after  int;
  v_held      text;
  v_default   text;
BEGIN
  v_verbs := CASE WHEN v_maint THEN ARRAY['TRIGGER','MAINTAIN'] ELSE ARRAY['TRIGGER'] END;

  SELECT count(*) INTO v_sr_before
    FROM pg_class c CROSS JOIN unnest(v_verbs) AS v(verb)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
     AND has_table_privilege('service_role', c.oid, v.verb);

  REVOKE TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE TRIGGER ON TABLES FROM anon, authenticated;

  IF v_maint THEN
    REVOKE MAINTAIN ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE MAINTAIN ON TABLES FROM anon, authenticated;
  END IF;

  -- Sweep: any relation on which either role can still hold either verb, however
  -- the privilege reaches it (direct grant, PUBLIC, inheritance).
  SELECT string_agg(c.relname || '/' || r.rolname || '/' || v.verb, ', ' ORDER BY c.relname, r.rolname, v.verb) INTO v_held
    FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname) CROSS JOIN unnest(v_verbs) AS v(verb)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
     AND has_table_privilege(r.rolname, c.oid, v.verb);
  IF v_held IS NOT NULL THEN
    RAISE EXCEPTION 'migration 20261009150000 failed: TRIGGER/MAINTAIN still held (relation/role/verb): %. REVOKE removes only grants made by the current user or a role it is a member of and prints nothing on a grantor mismatch (MEASURED, 20260911130000); find the grantor with aclexplode(relacl) and re-run the REVOKE under SET ROLE <grantor>', v_held;
  END IF;

  -- The default ACL the postgres role applies to every table it creates in public.
  SELECT string_agg(d.defaclrole::regrole::text || '->' || a.grantee::regrole::text || '/' || a.privilege_type, ', ') INTO v_default
    FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
     AND d.defaclrole = 'postgres'::regrole AND a.privilege_type = ANY (v_verbs)
     AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole);
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'migration 20261009150000 failed: the postgres default ACL on public tables still grants (%)', v_default;
  END IF;

  -- The revoke removed these verbs from exactly two roles: service_role keeps both
  -- verbs on every relation it held them on before.
  SELECT count(*) INTO v_sr_after
    FROM pg_class c CROSS JOIN unnest(v_verbs) AS v(verb)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
     AND has_table_privilege('service_role', c.oid, v.verb);
  IF v_sr_after <> v_sr_before THEN
    RAISE EXCEPTION 'migration 20261009150000 failed: service_role TRIGGER/MAINTAIN holders moved % -> %', v_sr_before, v_sr_after;
  END IF;
END
$verify$;
