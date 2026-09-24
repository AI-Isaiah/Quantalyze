-- The lane's side of the ACL-fidelity gate (scripts/local-stack/acl-fidelity.mjs).
-- One `|`-separated row per fact; the gate refuses any line it does not recognise.
--
-- search_path is EMPTY so format_type() schema-qualifies every non-pg_catalog type,
-- the same way the dump (which runs with search_path '') spells a function's
-- signature. Extension members are excluded and COUNTED: the dump does not declare
-- their ACLs.
SET search_path = '';

SELECT 'excluded-extension-members', count(*)
  FROM pg_depend d
 WHERE d.deptype = 'e'
   AND ((d.classid = 'pg_class'::regclass
         AND d.objid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace))
     OR (d.classid = 'pg_proc'::regclass
         AND d.objid IN (SELECT oid FROM pg_proc WHERE pronamespace = 'public'::regnamespace)));

WITH rel AS (
  SELECT c.oid, c.relkind, c.relname, c.relowner, c.relacl
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
)
SELECT 'obj', 'rel', relkind::text, relname::text, relowner::regrole::text FROM rel
UNION ALL
SELECT 'acl', 'rel', r.relname::text,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,
       a.privilege_type || ':' || a.is_grantable::text
  FROM rel r
 CROSS JOIN LATERAL aclexplode(coalesce(r.relacl,
            acldefault((CASE WHEN r.relkind = 'S' THEN 's' ELSE 'r' END)::"char", r.relowner))) a;

WITH fn AS (
  SELECT p.oid, p.proowner, p.proacl,
         'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS key
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
)
SELECT 'obj', 'fn', '-', key, proowner::regrole::text FROM fn
UNION ALL
SELECT 'acl', 'fn', f.key,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,
       a.privilege_type || ':' || a.is_grantable::text
  FROM fn f
 CROSS JOIN LATERAL aclexplode(coalesce(f.proacl, acldefault('f'::"char", f.proowner))) a;

SELECT 'defacl', d.defaclrole::regrole::text, d.defaclobjtype::text,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END,
       a.privilege_type || ':' || a.is_grantable::text
  FROM pg_default_acl d
 CROSS JOIN LATERAL aclexplode(d.defaclacl) a
 WHERE d.defaclnamespace = 'public'::regnamespace;
