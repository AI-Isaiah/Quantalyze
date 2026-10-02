-- ============================================================================
-- ARM OVERLAY 10 — a survivor that is CENSUSED but cannot be RE-CREATED.
--
-- Applied ON TOP OF old-test.sql by the self-test's `fresh_db <name>`.
--
-- A second trigger on `auth.users` whose function `public.fx_absent()` exists on
-- the OLD database and is NOT in `baseline-fixture.sql`. The census sees it (it
-- is survivor class (a): a trigger outside public whose function is inside it),
-- the derived pg_depend closure forgives it (it IS a censused survivor), and
-- then the re-creation after the replay fails on a function that no longer
-- exists.
--
-- ⛔ THIS IS THE FAILURE MODE THAT MATTERS MOST. It is the one shape where the
-- census is RIGHT and the restore still cannot complete — so the only correct
-- outcome is an abort INSIDE the transaction and a rollback, never a commit
-- with the trigger silently missing.
-- ============================================================================

CREATE FUNCTION public.fx_absent() RETURNS trigger
    LANGUAGE plpgsql
    AS $fx$
BEGIN
  RETURN NEW;
END
$fx$;

CREATE TRIGGER on_auth_user_absent
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.fx_absent();
