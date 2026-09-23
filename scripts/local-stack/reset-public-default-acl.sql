-- Local-stack lane: give schema `public` PROD's starting state before the dump loads.
--
-- WHY (Phase 164.4.2, checkpoint RED of plan 08, CI run 35886515179). The Supabase
-- image creates `public` with DEFAULT ACLs that grant ALL on TABLES, SEQUENCES and
-- FUNCTIONS to anon, authenticated and service_role. `supabase/schema/baseline.sql`
-- sets its own `ALTER DEFAULT PRIVILEGES ... IN SCHEMA "public"` lines LAST, after
-- every CREATE, and its GRANT lines only ADD. So on the lane every object the dump
-- created inherited ALL from the image and kept it, and every ACL was WIDER than
-- PROD's: `authenticated` could TRUNCATE public.system_settings, which PROD does not
-- grant. On the TEST restore path (`scripts/restore-test-from-baseline.sh`) the
-- `DROP SCHEMA public CASCADE` removes these rows, so objects get exactly the dump's
-- GRANTs there.
--
-- WHAT. Every pg_default_acl row on schema `public`, for EVERY grantor role and EVERY
-- object type present, is revoked until the row disappears. The roles, types and
-- grantees are READ from the catalogue, not listed here. The dump's own trailing
-- ALTER DEFAULT PRIVILEGES lines are then the only source of default privileges,
-- exactly as on the restore path.
--
-- ⛔ Must run as a role that may alter every grantor's defaults (the lane's
-- superuser). A row that survives is an EXCEPTION, never a warning.
DO $reset$
DECLARE
  r        record;
  g        record;
  v_kind   text;
  v_rows   int := 0;
  v_roles  text;
  v_left   int;
BEGIN
  SELECT count(*), string_agg(DISTINCT d.defaclrole::regrole::text, ',')
    INTO v_rows, v_roles
    FROM pg_default_acl d
   WHERE d.defaclnamespace = 'public'::regnamespace;

  FOR r IN
    SELECT d.defaclrole, d.defaclobjtype, d.defaclacl
      FROM pg_default_acl d
     WHERE d.defaclnamespace = 'public'::regnamespace
  LOOP
    v_kind := CASE r.defaclobjtype
                WHEN 'r' THEN 'TABLES'
                WHEN 'S' THEN 'SEQUENCES'
                WHEN 'f' THEN 'FUNCTIONS'
                WHEN 'T' THEN 'TYPES'
                ELSE NULL
              END;
    IF v_kind IS NULL THEN
      RAISE EXCEPTION 'acl-reset: pg_default_acl row for role % on schema public has object type %, which this reset does not know how to revoke',
        r.defaclrole::regrole, r.defaclobjtype;
    END IF;
    FOR g IN SELECT DISTINCT a.grantee FROM aclexplode(r.defaclacl) a LOOP
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON %s FROM %s CASCADE',
        r.defaclrole::regrole::text,
        v_kind,
        CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(g.grantee::regrole::text) END);
    END LOOP;
  END LOOP;

  SELECT count(*) INTO v_left
    FROM pg_default_acl
   WHERE defaclnamespace = 'public'::regnamespace;
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'acl-reset: % default-ACL row(s) on schema public survived the reset', v_left;
  END IF;

  RAISE NOTICE 'acl-reset: removed % default-ACL row(s) on schema public (grantor roles: %); 0 remain',
    v_rows, coalesce(v_roles, '(none)');
END
$reset$;
