-- ============================================================================
-- Phase 243 DBBACKSTOP, plan 10 (DBACC-02, founder decision 2026-11-26, candidate 1,
-- part (ii)): the api_keys INSERT fence. PR-C of three; this one CLOSES the door.
--
-- WHAT: a BEFORE INSERT ROW trigger on public.api_keys that refuses every insert whose
-- current_user is not postgres or supabase_admin, with SQLSTATE 42501. Only the audited
-- postgres-owned SECURITY DEFINER writers (insert_api_key, create_wizard_strategy,
-- add_wizard_composite_key), migrations, SQL fixtures, the dashboard SQL editor
-- (postgres) and Supabase's own supabase_admin maintenance can then mint a row.
--
-- WHY: the Phase-160 RLS audit's finding that api_keys writes sit outside RLS (closed by
-- this phase): service_role is BYPASSRLS and carries no sub, so an admin-client route
-- could insert a key under any user_id. The founder accepted the
-- narrowing to "only the audited writer path can insert, and user_id can never be
-- repointed". Plan 05's api_keys_user_id_immutable trigger is the second half (no role
-- can repoint a key); this file is the first (no role can mint one outside a writer).
--
-- ⛔ MECHANISM: a current_user ALLOW-LIST, never a transaction-local GUC. Migration
-- 20260515114310 removed the GUC shape because any caller can set a custom GUC, so a
-- fence keyed on one is forgeable from a PostgREST request. current_user is the role
-- the statement really runs as and a request cannot set it.
--
-- ⛔ SECURITY INVOKER, ON PURPOSE. Inside a SECURITY DEFINER body current_user is the
-- function's OWNER, so a DEFINER fence would admit every caller and be a silent no-op
-- (the trap 20260811210000 documents for the attested_venue scrub trigger). As INVOKER,
-- current_user is the role of the statement that fired the trigger: service_role for a
-- direct admin-client insert (refused), and postgres for an insert made inside a
-- postgres-owned SECURITY DEFINER writer (admitted).
--
-- ⛔ AN ALLOW-LIST, DENY BY DEFAULT. A role created later is refused until someone edits
-- this fence; a deny-list of anon, authenticated and service_role would admit it.
--
-- INSERT ... ON CONFLICT is fenced too: a BEFORE INSERT trigger fires before conflict
-- resolution, so an upsert from a client role is refused as well. That is why PR-B
-- removed every upsert of api_keys before this file.
--
-- ⛔ DEPLOY ORDER. PR-B (the route, every seed and every live test calling
-- insert_api_key) must be merged AND its production deployment live BEFORE this applies.
-- The migration applies on the merge push in parallel with the Vercel build, so a fence
-- applied ahead of the route's RPC call would refuse every connect-a-key on PROD.
--
-- The trigger function is hardened: pinned search_path, EXECUTE revoked from PUBLIC, anon
-- and authenticated (a trigger function needs no caller EXECUTE to fire). The deletion
-- path exemption (quantalyze.sanitize_in_progress) does not apply: this is an
-- INSERT-only trigger and sanitize_user only deletes.
--
-- ⛔ THE FENCE IS NOT AN INSERTER. Its body and message must not carry the text of an
-- INSERT into the table: the writer-set arm of
-- supabase/tests/test_api_keys_insert_not_client_writable.sql pins the functions whose
-- comment-stripped body does, and a new inserter must not appear without a gate edit.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue and
-- none of its data, so the verify block below reads pg_catalog only. It deliberately does
-- not assert the function body: the gate's edit twins mutate that body, and a verify
-- block that checked it would abort the apply of a mutated copy, so the gate could never
-- go RED on the behaviour.
--
-- Transaction style: NO explicit transaction statements (migration-reviewer invariant
-- 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to that wrap.
--
-- Rollback (manual, off the auto-apply path):
-- supabase/migrations/down/20261127220100-rollback.sql. It reopens direct admin-client
-- inserts with a request-supplied user_id.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

CREATE FUNCTION public.enforce_api_keys_insert_writer_fence()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'api_keys: INSERT refused for role %: only the audited writer functions may insert (DBACC-02)', current_user
    USING ERRCODE = 'insufficient_privilege';
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_api_keys_insert_writer_fence() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.enforce_api_keys_insert_writer_fence() IS
  'Phase 243 DBACC-02. The api_keys insert fence: passes the row only when current_user IN (postgres, supabase_admin), otherwise raises 42501 naming the role. SECURITY INVOKER ON PURPOSE (inside a DEFINER body current_user is the owner and the fence would admit everyone). An ALLOW-LIST, deny by default. Never a GUC (20260515114310 removed that shape as forgeable). Not an inserter: its body writes no api_keys row.';

CREATE TRIGGER api_keys_insert_writer_fence
  BEFORE INSERT ON public.api_keys
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_api_keys_insert_writer_fence();

COMMENT ON TRIGGER api_keys_insert_writer_fence ON public.api_keys IS
  'Phase 243 DBACC-02 (founder decision 2026-11-26). Refuses an INSERT, ON CONFLICT included, from every role but postgres and supabase_admin. The audited writers (insert_api_key, create_wizard_strategy, add_wizard_composite_key) are postgres-owned SECURITY DEFINER functions, so their inserts pass; a direct service_role, authenticated or anon insert is refused 42501.';

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read. Asserted: exactly one trigger of that name on public.api_keys, a BEFORE
-- INSERT ROW trigger (tgtype 7), enabled, whose function is SECURITY INVOKER with a pinned
-- search_path and no EXECUTE for anon or authenticated. Deliberately NOT asserted: the
-- function body (see the header).
DO $verify$
DECLARE
  v_fn_oid oid;
  v_count  int;
  v_type   int;
  v_enab   text;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.api_keys'::regclass
     AND t.tgname = 'api_keys_insert_writer_fence'
     AND NOT t.tgisinternal;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'migration 20261127220100 failed: expected exactly 1 trigger api_keys_insert_writer_fence on public.api_keys, found %', v_count;
  END IF;

  SELECT t.tgtype::int, t.tgenabled::text INTO v_type, v_enab
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.api_keys'::regclass
     AND t.tgname = 'api_keys_insert_writer_fence'
     AND NOT t.tgisinternal;
  IF v_type <> 7 THEN
    RAISE EXCEPTION 'migration 20261127220100 failed: api_keys_insert_writer_fence tgtype is % (expected 7 = BEFORE INSERT ROW)', v_type;
  END IF;
  IF v_enab <> 'O' THEN
    RAISE EXCEPTION 'migration 20261127220100 failed: api_keys_insert_writer_fence tgenabled is % (expected O)', v_enab;
  END IF;

  v_fn_oid := to_regprocedure('public.enforce_api_keys_insert_writer_fence()');
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'migration 20261127220100 failed: public.enforce_api_keys_insert_writer_fence() is missing';
  END IF;
  IF COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn_oid), true) THEN
    RAISE EXCEPTION 'migration 20261127220100 failed: enforce_api_keys_insert_writer_fence is SECURITY DEFINER; it must be SECURITY INVOKER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) AS c(setting)
                  WHERE p.oid = v_fn_oid AND c.setting LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'migration 20261127220100 failed: enforce_api_keys_insert_writer_fence does not pin search_path';
  END IF;
  IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'migration 20261127220100 failed: anon holds EXECUTE on enforce_api_keys_insert_writer_fence';
  END IF;
  IF has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'migration 20261127220100 failed: authenticated holds EXECUTE on enforce_api_keys_insert_writer_fence';
  END IF;

  RAISE NOTICE 'migration 20261127220100: api_keys_insert_writer_fence is a BEFORE INSERT ROW trigger, enabled, over a SECURITY INVOKER function with a pinned search_path.';
END
$verify$;
