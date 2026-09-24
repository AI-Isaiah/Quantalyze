-- The local-stack lane's function-denial probe (Phase 164.4.2 plan 08 checkpoint RED).
-- Run by scripts/local-stack/run.sh `probe_function_denial_survives`, as the loading
-- role `postgres`, right after the stack starts and before anything loads.
--
-- WHY. supabase/postgres images 17.6.1.104 through .112 ship supautils 3.2.0, whose
-- ExecutorStart hint hook kills the backend (SIGSEGV) when a `postgres` session that
-- SET ROLE to a supautils.hint_roles role is refused EXECUTE on a function. MEASURED
-- in CI run 35914559318 attempt 2: `sql-tests` died that way mid-corpus. The corpus
-- proves REVOKEs in exactly this shape, so an image that crashes here would crash
-- there. This file is that shape and nothing more.
--
-- It must be able to FAIL both ways: psql loses its connection on a crashing image,
-- and a call that is NOT refused raises rather than passing. Only 42501 is caught.
-- Everything, the function included, is rolled back.
\set ON_ERROR_STOP 1
BEGIN;
CREATE FUNCTION public.lane_function_denial_probe() RETURNS integer
  LANGUAGE sql AS 'SELECT 1';
REVOKE ALL ON FUNCTION public.lane_function_denial_probe() FROM PUBLIC, anon, authenticated;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.lane_function_denial_probe();
  RAISE EXCEPTION 'function-denial-probe: authenticated EXECUTED a function it holds no grant on, so the probe measured nothing';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'function-denial-probe: EXECUTE refused (42501) and the backend survived';
END
$$;
ROLLBACK;
