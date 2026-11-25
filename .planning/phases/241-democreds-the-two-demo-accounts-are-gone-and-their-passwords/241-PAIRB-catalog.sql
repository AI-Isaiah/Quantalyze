-- Phase 241 plan 03 - read-only preflight catalog, ONE row, comparable lane against PROD.
-- Walks pg_constraint (contype f) down from auth.users and public.profiles and lists every
-- foreign key into a reached table, plus the non-internal triggers on every reached table.
-- Canonical lines hold names and codes only, never an OID:
--   fk|<schema.table>|<constraint>|<schema.referenced table>|<confdeltype>|<condeferrable>
--   trigger|<schema.table>|<trigger name>|<timing and events decoded from tgtype>
-- AUTH set = lines whose table is in the auth schema (GoTrue's own, version dependent).
-- STRICT set = every other line. Equal strict_md5 on the lane and on PROD is the comparison.
WITH RECURSIVE walk(oid_) AS (
  SELECT 'auth.users'::regclass::oid
  UNION
  SELECT 'public.profiles'::regclass::oid
  UNION
  SELECT c.conrelid
    FROM pg_constraint c
    JOIN walk w ON c.confrelid = w.oid_
   WHERE c.contype = 'f'
),
fks AS (
  SELECT 'fk|' || n.nspname || '.' || r.relname
         || '|' || c.conname
         || '|' || fn.nspname || '.' || fr.relname
         || '|' || c.confdeltype::text
         || '|' || c.condeferrable::text AS line,
         n.nspname::text AS sch
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    JOIN pg_class fr ON fr.oid = c.confrelid
    JOIN pg_namespace fn ON fn.oid = fr.relnamespace
   WHERE c.contype = 'f'
     AND c.confrelid IN (SELECT oid_ FROM walk)
),
trgs AS (
  SELECT 'trigger|' || n.nspname || '.' || r.relname
         || '|' || t.tgname
         || '|' || CASE WHEN t.tgtype & 2 <> 0 THEN 'BEFORE'
                        WHEN t.tgtype & 64 <> 0 THEN 'INSTEAD OF'
                        ELSE 'AFTER' END
         || ' ' || concat_ws(' OR ',
                    CASE WHEN t.tgtype & 4 <> 0 THEN 'INSERT' END,
                    CASE WHEN t.tgtype & 8 <> 0 THEN 'DELETE' END,
                    CASE WHEN t.tgtype & 16 <> 0 THEN 'UPDATE' END,
                    CASE WHEN t.tgtype & 32 <> 0 THEN 'TRUNCATE' END)
         || ' ' || CASE WHEN t.tgtype & 1 <> 0 THEN 'ROW' ELSE 'STATEMENT' END AS line,
         n.nspname::text AS sch
    FROM pg_trigger t
    JOIN pg_class r ON r.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
   WHERE NOT t.tgisinternal
     AND t.tgrelid IN (SELECT oid_ FROM walk)
),
lines AS (
  SELECT line, sch FROM fks
  UNION
  SELECT line, sch FROM trgs
)
SELECT count(*) FILTER (WHERE sch <> 'auth') AS strict_rows,
       md5(coalesce(string_agg(line, E'\n' ORDER BY line COLLATE "C") FILTER (WHERE sch <> 'auth'), '')) AS strict_md5,
       coalesce(string_agg(line, E'\n' ORDER BY line COLLATE "C") FILTER (WHERE sch <> 'auth'), '') AS strict_lines,
       count(*) FILTER (WHERE sch = 'auth') AS auth_rows,
       md5(coalesce(string_agg(line, E'\n' ORDER BY line COLLATE "C") FILTER (WHERE sch = 'auth'), '')) AS auth_md5,
       coalesce(string_agg(line, E'\n' ORDER BY line COLLATE "C") FILTER (WHERE sch = 'auth'), '') AS auth_lines
  FROM lines;
