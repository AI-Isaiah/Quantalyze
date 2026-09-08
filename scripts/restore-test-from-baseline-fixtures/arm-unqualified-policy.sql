-- ============================================================================
-- ARM OVERLAY 12 (B1) — a survivor whose STORED expression carries no `public.`
-- when it is rendered under the default search_path.
--
-- Applied ON TOP OF old-test.sql by the self-test's `fresh_db <name>`.
--
-- ⛔ WHY `SET search_path = public` HERE. The real policy this models is
-- `gdpr_exports_admin_read` on `storage.objects`
-- (supabase/migrations/20260417110538_sanitize_user.sql:232-236), and it spells
-- its function QUALIFIED — `public.current_user_has_app_role(ARRAY['admin'])`.
-- The sibling fixture reproduces it that way, as `qualified_ref`
-- (old-test.sql:87-89, `USING (public.fx_role('admin'))`).
--
-- This overlay authors the UNQUALIFIED twin DELIBERATELY, and the twin's point
-- is that THE SOURCE SPELLING IS IRRELEVANT. Postgres does not store the text:
-- it stores a PARSE TREE in which the function is already resolved to an oid,
-- and `pg_get_expr` re-renders that tree against the READER's search_path,
-- OMITTING the schema qualifier of anything already on it. So `qualified_ref`
-- and this `unqualified_ref` deparse IDENTICALLY — under psql's default
-- `"$user", public` both render as `fx_role('admin'::text)`, and a census that
-- substring-matches `public.` in `pg_policies.qual` SEES NEITHER.
-- `DROP SCHEMA public CASCADE` then removes them and a pre/post key-set
-- comparison agrees on a set that excludes them. The deparse case this arm
-- exercises is therefore one the QUALIFIED real policy hits too; writing the
-- twin unqualified only makes it legible in the fixture's own text.
--
-- `SET search_path = public` is what lets the unqualified `fx_role('admin')`
-- RESOLVE at parse time. It is NOT what makes the stored expression render bare
-- — the qualified twin renders bare as well.
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
