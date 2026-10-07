-- Migration: anon and authenticated no longer hold TRUNCATE on public relations —
-- Phase 164.9.7 TRUNCATEREVOKE (plan 01).
--
-- Why this migration exists
-- -------------------------
-- Row-level security never evaluates TRUNCATE. A policy can say who may read,
-- insert, update or delete a row; the TRUNCATE statement does not look at rows, so
-- no policy is consulted for it. The grant layer is the ONLY control, and it was
-- wide open: measured read-only on PROD on 2026-10-07, anon held TRUNCATE on 53 of
-- 63 base tables and authenticated on 56 (plus 3 of 4 views each, which is where
-- the earlier "56 and 59 relations" figures came from). Any SQL-capable path
-- running as one of those roles could empty a table whatever its policies said,
-- and TRUNCATE ... CASCADE reaches every table with a foreign key to it, provided
-- the role holds TRUNCATE on those too, which is why the breadth matters.
--
-- Where the privilege came from
-- -----------------------------
-- Not from this repo's migration chain. The Supabase platform bootstrap installs a
-- default ACL on schema public that grants ALL on every new table to postgres,
-- anon, authenticated and service_role, and ALL includes TRUNCATE. Every table this
-- repo ever created inherited it at creation, and earlier hardening migrations
-- removed it from single tables one at a time (system_settings, cron_runs,
-- strategy_shares, strategy_sync_cursors, compute_jobs). This migration is the
-- class fix: it removes the privilege from every existing relation and changes the
-- default so no table created later receives it.
--
-- Scope
-- -----
--   * Every relation in schema public of kind r (table), p (partitioned table),
--     v (view), m (materialised view) and f (foreign table). The three views that
--     carry TRUNCATE in their ACL on PROD are covered. TRUNCATE on a view is not
--     executable, so those entries are hygiene, but the REVOKE and the self-check
--     share ONE relation set, so a revoked-but-unchecked entry cannot exist.
--   * Roles anon and authenticated ONLY. service_role and postgres keep TRUNCATE
--     (the self-check below proves the service_role holder count does not move).
--   * The postgres default privilege for tables in schema public. It is written
--     FOR ROLE postgres explicitly: an unqualified ALTER DEFAULT PRIVILEGES targets
--     current_user, which is not guaranteed to be postgres when the apply connects
--     through a login role that is a member of it.
--
-- Caller impact
-- -------------
-- None. The reliance audit (phase RESEARCH) found no application, test or CI path
-- that issues TRUNCATE as anon or authenticated. The one executable TRUNCATE in
-- src runs as the scratch cluster's superuser; the restore script truncates the
-- migration ledger over its own admin connection. Every other verb anon and
-- authenticated hold is untouched, so every RLS-scoped read and write keeps working.
--
-- ⛔ THE REVOKE IS SILENT WHEN IT DOES NOTHING. REVOKE removes only grants made by
-- the current user or by a role it is a member of. On a grantor mismatch it prints
-- REVOKE, exits 0 and the privilege survives (MEASURED 2026-09-12 on PostgreSQL
-- 16.13, migration 20260911130000, superuser included). Today every TRUNCATE ACL
-- entry on PROD has grantor postgres, so this is a guard, not a live fault, but a
-- statement that cannot fail loudly is not a proof. So the REVOKE and its proof
-- live in ONE DO block: after the statements, a catalogue sweep asks
-- has_table_privilege (which also counts PUBLIC grants and role inheritance)
-- whether either role can still TRUNCATE anything, whether the postgres default
-- ACL still grants it, and whether the service_role holder count moved. Each of
-- those raises `migration 20261009130000 failed: ...` and aborts the apply. One
-- DO block is one statement, so it is atomic even under a lane that replays each
-- migration file in autocommit.
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
-- Accepted residual (orchestrator decision, provisional pending founder
-- confirmation at verify time): the platform admin role's own default-ACL row on
-- public still grants TRUNCATE to anon and authenticated on tables THAT ROLE
-- creates, and postgres cannot alter it. No such table exists today: all 67 public
-- relations are owned by postgres and none is extension-owned. This migration
-- records the residual and does not touch it.
--
-- Rollback: supabase/migrations/down/20261009130000-rollback.sql restores the exact
-- pre-migration holder set (plan 02). It is a manual file, off the auto-apply path.

-- --------------------------------------------------------------------------
-- STEP 1: revoke, default-privilege revoke and catalogue self-check, one DO
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_sr_before int;
  v_sr_after  int;
  v_held      text;
  v_default   text;
BEGIN
  SELECT count(*) INTO v_sr_before FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
     AND has_table_privilege('service_role', c.oid, 'TRUNCATE');

  REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
  ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
    REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

  -- Sweep: any relation on which either role can still TRUNCATE, however the
  -- privilege reaches it (direct grant, PUBLIC, inheritance).
  SELECT string_agg(c.relname || '/' || r.rolname, ', ' ORDER BY c.relname, r.rolname) INTO v_held
    FROM pg_class c CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(rolname)
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
     AND has_table_privilege(r.rolname, c.oid, 'TRUNCATE');
  IF v_held IS NOT NULL THEN
    RAISE EXCEPTION 'migration 20261009130000 failed: TRUNCATE still held (relation/role): %. REVOKE removes only grants made by the current user or a role it is a member of and prints nothing on a grantor mismatch (MEASURED, 20260911130000); find the grantor with aclexplode(relacl) and re-run the REVOKE under SET ROLE <grantor>', v_held;
  END IF;

  -- The default ACL the postgres role applies to every table it creates in public.
  SELECT string_agg(d.defaclrole::regrole::text || '->' || a.grantee::regrole::text, ', ') INTO v_default
    FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
   WHERE d.defaclnamespace = 'public'::regnamespace AND d.defaclobjtype = 'r'
     AND d.defaclrole = 'postgres'::regrole AND a.privilege_type = 'TRUNCATE'
     AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole);
  IF v_default IS NOT NULL THEN
    RAISE EXCEPTION 'migration 20261009130000 failed: the postgres default ACL on public tables still grants TRUNCATE (%)', v_default;
  END IF;

  -- The revoke removed exactly one verb from exactly two roles: service_role
  -- keeps TRUNCATE on every relation it held it on before.
  SELECT count(*) INTO v_sr_after FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
     AND has_table_privilege('service_role', c.oid, 'TRUNCATE');
  IF v_sr_after <> v_sr_before THEN
    RAISE EXCEPTION 'migration 20261009130000 failed: service_role TRUNCATE holders moved % -> %', v_sr_before, v_sr_after;
  END IF;
END
$verify$;
