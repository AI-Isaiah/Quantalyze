-- ============================================================================
-- FIXTURE: the "old TEST" the restore meets.
--
-- Loaded into a THROWAWAY lane database by
-- `bash scripts/restore-test-from-baseline.sh --self-test`. It never touches TEST
-- or PROD, and nothing in this file is applied to any real database.
--
-- ⚠️ IT IS A STAND-IN, NOT A COPY OF TEST. It carries only the SHAPES the restore
-- must handle, one per shape, so that a self-test arm can name which shape broke:
--
--   * a stray public table (`e2e_leftover`) the baseline dump does NOT re-create —
--     it must be GONE after a restore, and STILL THERE after a preflight;
--   * a public table (`fx_keep`) the baseline dump DOES re-create, so the realtime
--     publication row can point at a table that comes back (W3);
--   * SURVIVOR CLASS (a): a trigger on a table OUTSIDE public whose function is
--     INSIDE it. The real one is `on_auth_user_created` on `auth.users`
--     (supabase/migrations/20260405061912_rls_policies.sql:81-83); `DROP SCHEMA
--     public CASCADE` removes it and the dump, which is --schema public, does not
--     put it back;
--   * SURVIVOR CLASS (b): a policy on a table OUTSIDE public referencing a public
--     function. The real one is `gdpr_exports_admin_read` on `storage.objects`
--     (supabase/migrations/20260417110538_sanitize_user.sql:232-236). It is spelled
--     QUALIFIED here on purpose — Plan 02's arm 12 adds the UNQUALIFIED twin on top
--     of this fixture, so arm 9's survivor count must stay 3/3;
--   * SURVIVOR CLASS (c): a realtime publication row for a public table;
--   * an extension in a NON-public schema, mirroring the real dump's WITH SCHEMA
--     shape (supabase/schema/baseline.sql:41). An extension IN public would be a
--     pg_depend dependent of the namespace and is exactly what the derived census
--     must name — keeping the real shape here keeps the GREEN path realistic;
--   * a ledger holding the DEFECT this whole phase exists to remove: a row whose
--     `version` is the APPLY timestamp and whose `name` is the FILENAME, plus a row
--     no repo file carries at all;
--   * a database identity marker, so `--run`'s marker refusal has something to pass.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS "auth";
CREATE SCHEMA IF NOT EXISTS "storage";
CREATE SCHEMA IF NOT EXISTS "extensions";
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

-- ── public ──────────────────────────────────────────────────────────────────
-- The stray. Nothing in the baseline dump re-creates it.
CREATE TABLE public.e2e_leftover (
    id integer PRIMARY KEY,
    note text
);

-- Also in the baseline dump, so the publication row survives re-ADD (W3).
CREATE TABLE public.fx_keep (
    id integer PRIMARY KEY,
    label text
);

CREATE FUNCTION public.fx_survivor() RETURNS trigger
    LANGUAGE plpgsql
    AS $fx$
BEGIN
  RETURN NEW;
END
$fx$;

CREATE FUNCTION public.fx_role(p_role text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $fx$
  SELECT p_role IS NOT NULL;
$fx$;

-- ── survivor class (a): a trigger on auth.users calling a public function ───
CREATE TABLE auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text
);

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.fx_survivor();

-- ── survivor class (b): a storage policy calling a public function, QUALIFIED ─
CREATE TABLE storage.objects (
    id uuid PRIMARY KEY,
    name text,
    owner uuid
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY qualified_ref ON storage.objects
    FOR SELECT TO authenticated
    USING (public.fx_role('admin'));

-- ── survivor class (c): a realtime publication row for a public table ───────
CREATE PUBLICATION supabase_realtime FOR TABLE public.fx_keep;

-- ── the ledger, carrying the defect ─────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text NOT NULL PRIMARY KEY, statements text[], name text);

INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES
  ('20260101000000', 'fixture_a', ARRAY['-- applied with the FILENAME timestamp: the shape supabase db push understands']),
  ('20260102000000', 'fixture_b', ARRAY['-- applied with the FILENAME timestamp']),
  ('20260117093312', '20260102000000_fixture_b', ARRAY['-- RE-STAMPED: version is the APPLY timestamp and name is the FILENAME. db push compares version ONLY, so this row is an ErrMissingLocal hard error raised before --include-all is consulted.']),
  ('20259901000000', 'ghost_migration', ARRAY['-- no repo file carries this version']);

-- ── the identity marker ─────────────────────────────────────────────────────
-- CLAUDE.md § "Which database am I on?": current_database() is `postgres` on BOTH
-- real projects and proves nothing; the hand-set COMMENT is the only thing that
-- names the project. Written through format() so this fixture does not hard-code
-- the lane's database name.
DO $fx$
BEGIN
  EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), 'quantalyze TEST fixture');
END
$fx$;
