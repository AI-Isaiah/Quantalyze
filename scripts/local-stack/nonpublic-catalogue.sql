-- The lane's NON-PUBLIC objects, as rows for scripts/local-stack/nonpublic-objects.mjs --check
-- (Phase 164.4.2 DECISION G, plan 11).
--
-- ⛔ Read through the stack SUPERUSER DSN (run.sh check_nonpublic_fidelity). The gate
-- REQUIRES the meta|superuser row to say `t`: pg_cron's row-level security on cron.job
-- shows a non-superuser only its own jobs, so a non-superuser read could not see a row
-- registered under another role.
--
-- This file READS EVERYTHING and judges nothing. It names no trigger and no job: which
-- ones the lane must carry is derived by the module from supabase/migrations, so a
-- name listed here could never drift from the migrations it would have to track.
--
-- psql -X -q -At -F '|' -f scripts/local-stack/nonpublic-catalogue.sql
SET search_path TO pg_catalog; -- so regprocedure prints schema-qualified

SELECT 'meta|superuser|' || CASE WHEN r.rolsuper THEN 't' ELSE 'f' END
  FROM pg_roles r
 WHERE r.rolname = current_user;

SELECT 'meta|database|' || current_database();

-- Every NON-internal trigger on auth.users (internal ones are the FK/constraint
-- machinery PostgreSQL creates itself; no migration declares them).
SELECT 'trigger|' || c.relname || '|' || t.tgname || '|' || t.tgtype::text || '|' || t.tgenabled::text
       || '|' || t.tgfoid::regprocedure::text
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'auth'
   AND c.relname = 'users'
   AND NOT t.tgisinternal
 ORDER BY t.tgname;
