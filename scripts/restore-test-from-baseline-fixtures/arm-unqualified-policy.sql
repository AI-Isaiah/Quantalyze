-- ============================================================================
-- ARM OVERLAY 12 (B1) — a survivor whose STORED expression carries no `public.`
-- when it is rendered under the default search_path.
--
-- Applied ON TOP OF old-test.sql by the self-test's `fresh_db <name>`.
--
-- ⛔ WHY `SET search_path = public` HERE. The policy is AUTHORED with public on
-- the path, exactly as the real `gdpr_exports_admin_read` is
-- (supabase/migrations/20260417110538_sanitize_user.sql:232-236 spells its
-- function unqualified). Postgres stores the parsed expression, and
-- `pg_get_expr` OMITS the schema qualifier of anything on the READER's
-- search_path. So under psql's default `"$user", public` this policy renders as
-- `fx_role('admin'::text)` — and a census that substring-matches `public.` in
-- `pg_policies.qual` NEVER SEES IT. `DROP SCHEMA public CASCADE` then removes
-- it and a pre/post key-set comparison agrees on a set that excludes it.
--
-- The census reads the catalogue under `SET search_path = pg_catalog`, so this
-- policy renders SCHEMA-QUALIFIED, is censused, and round-trips. That is the
-- whole of B1, in one object.
-- ============================================================================

SET search_path = public;

CREATE POLICY unqualified_ref ON storage.objects
    FOR SELECT TO authenticated
    USING (fx_role('admin'));

RESET search_path;
