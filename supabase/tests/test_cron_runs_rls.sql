-- Test: public.cron_runs row security — who can READ a heartbeat row, and in
-- particular the ledger fan-outs' failure row (Phase 164.6 review fix, the
-- rls-policy-auditor's below-threshold note (a)).
--
-- WHY THIS FILE EXISTS. Since migration 20260924120000 both ledger fan-outs
-- write a cron_runs row whose `metadata->'failed_targets'` names the strategies
-- whose refresh enqueue failed — possibly PRIVATE strategies. What keeps those
-- ids away from other tenants is the table's row security, declared once in
-- supabase/migrations/20260408113029_cron_heartbeat.sql:
--   * `cron_runs_admin_read` — SELECT, for a caller whose OWN profiles row has
--     is_admin = true;
--   * `cron_runs_service_role` — every command, for auth.role() = 'service_role'.
-- anon and authenticated hold TABLE grants on cron_runs (the committed dump
-- records SELECT for both), so the policies are the ONLY thing between a
-- browser client and those ids. Until this file, nothing in supabase/tests read
-- the table back as anon or as a non-admin user: the review found the claim
-- "they read zero rows" true by inspection and pinned by nothing.
--
-- THE THREE ARMS, and why each needs the others:
--   ADMIN 1  a platform admin, authenticated, READS the seeded rows. This is the
--            anti-vacuity control: without it, the two zero-row verdicts below
--            could be true because the rows were never there, or because a
--            broken policy hides every row from everyone.
--   ANON 1   anon, carrying an anon JWT, reads ZERO of the seeded rows.
--   USER 1   an authenticated NON-admin user reads ZERO of the seeded rows.
-- Each read counts only rows THIS file seeded (by id), never the whole table:
-- on a shared or long-lived database a global count measures other people's
-- rows too.
--
-- ⛔ A READ THAT RAISES IS NOT A ZERO. Each read is wrapped, and a raise is its
-- own failure: if the grant layer refused the read, "0 rows" would say nothing
-- about the policy. The transaction GRANTs SELECT on the two tables the reads
-- touch to both client roles first, so the POLICY is always the binding
-- constraint. Both GRANTs roll back with the file.
--
-- ⛔ WHICH FILE THE ARMS MEASURE: every edit-kind twin below names
-- 20260408113029, the only migration that declares either policy (MEASURED
-- 2026-09-24: no other migration creates, alters or drops a policy on
-- cron_runs, and the committed dump carries exactly these two).
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER above an arm carries an
-- adjacent `RED-UNDER-M` object that scripts/mutation-runner executes: it
-- mutates COPIES, requires the FIRST `TEST FAILED (…)` to name that arm, and
-- restores GREEN. The schema is scripts/mutation-runner/GRAMMAR.md. The list
-- below is what the lane applies before this gate, in order:
--   * 01 core fixture: auth.users, profiles, auth.uid(), the client roles.
--   * 07 default privileges, BEFORE the migration, so the table the migration
--     creates carries the client-role grants a hosted project gives it.
--   * 12 profiles.is_admin and 15 auth.role(): the two objects the policies
--     resolve at DECLARATION time. Without them CREATE POLICY aborts the apply
--     on 42703 / 42883 before any arm runs.
--   * the real migration, never the stand-in 33-fixture-cron-runs.sql, which
--     deliberately carries NO policies and so could only prove the opposite.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","supabase/migrations/20260408113029_cron_heartbeat.sql"]}
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_cron_runs_rls.sql

BEGIN;

DO $$
DECLARE
  uid_admin   UUID := gen_random_uuid();
  uid_user    UUID := gen_random_uuid();
  run_a       UUID;   -- a failure row shaped like the fan-out's, naming a strategy id
  run_b       UUID;   -- an ordinary heartbeat row
  visible     INTEGER;
  raised      BOOLEAN;
  err_state   TEXT;
BEGIN
  -- ----- applied-ness gate: ABSENCE IS A FAILURE, NEVER A SKIP -----------
  IF to_regclass('public.cron_runs') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (ADMIN 1): public.cron_runs does not exist on this database, so none of this file''s arms ran. This is a FAILURE, not a skip: the table whose row security keeps the fan-outs'' failed-strategy ids away from other tenants was never measured.';
  END IF;

  -- ----- SEED (as the table owner, which row security does not bind) -----
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_admin, '00000000-0000-0000-0000-000000000000',
          'crr-admin-' || uid_admin::text || '@quantalyze.test', now(), now()),
         (uid_user, '00000000-0000-0000-0000-000000000000',
          'crr-user-' || uid_user::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role, is_admin)
  VALUES (uid_admin, 'crr admin', 'crr-admin-' || uid_admin::text || '@quantalyze.test', 'manager', TRUE),
         (uid_user, 'crr user', 'crr-user-' || uid_user::text || '@quantalyze.test', 'manager', FALSE)
  ON CONFLICT (id) DO UPDATE SET is_admin = EXCLUDED.is_admin;

  INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
  VALUES ('ledger_refresh_fanout', 'error', now(), 'candidate_enqueue_failed',
          jsonb_build_object('function', 'enqueue_ledger_refresh_for_strategies',
                             'cause', 'candidate_enqueue_failed',
                             'failed_count', 1,
                             'failed_targets', jsonb_build_array(
                               jsonb_build_object('strategy_id', gen_random_uuid(), 'sqlstate', 'P0001'))))
  RETURNING id INTO run_a;
  INSERT INTO public.cron_runs (cron_name, status, completed_at)
  VALUES ('crr_heartbeat_probe', 'ok', now())
  RETURNING id INTO run_b;

  -- The client roles' read path is made to depend on the POLICY alone: the
  -- table grant and the grant on the table the admin policy's EXISTS reads.
  GRANT SELECT ON public.cron_runs TO anon, authenticated;
  GRANT SELECT ON public.profiles TO anon, authenticated;

  -- ======================================================================
  -- ADMIN 1 — a platform admin READS the seeded rows (the anti-vacuity control)
  -- ======================================================================
  -- RED-UNDER: make the admin policy admit nobody — its is_admin test becomes
  --            `p.is_admin IS NULL`, which a NOT NULL column never satisfies.
  --            The admin then reads 0 rows and this control fails, which is
  --            what proves the two zero-row verdicts below are not vacuous.
  -- RED-UNDER-M: {"arm":"ADMIN 1","apply":[{"kind":"edit","file":"supabase/migrations/20260408113029_cron_heartbeat.sql","find":"SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true","replace":"SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin IS NULL","occurrences":1}]}
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_admin::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  raised := FALSE;
  visible := -1;
  BEGIN
    SELECT count(*) INTO visible FROM public.cron_runs WHERE id IN (run_a, run_b);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF raised THEN
    RAISE EXCEPTION 'TEST FAILED (ADMIN 1): the platform admin''s read of cron_runs RAISED % instead of returning rows. The grant layer refused before the policy was consulted, so every verdict below would be vacuous. Fix the gate, never the expectation.', err_state;
  END IF;
  IF visible <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (ADMIN 1): a platform admin read % of the 2 seeded cron_runs rows, expected 2. With the admin policy admitting nobody, the zero-row verdicts for anon and for a non-admin user below would hold for the wrong reason.', visible;
  END IF;

  -- ======================================================================
  -- ANON 1 — anon reads ZERO of the seeded rows
  -- ======================================================================
  -- RED-UNDER: widen the service-role policy to admit anon —
  --            `auth.role() = 'service_role'` becomes
  --            `auth.role() IN ('service_role', 'anon')` in its USING clause.
  --            anon then reads the failure row and the ids in it.
  -- RED-UNDER-M: {"arm":"ANON 1","apply":[{"kind":"edit","file":"supabase/migrations/20260408113029_cron_heartbeat.sql","find":"FOR ALL USING (auth.role() = 'service_role')","replace":"FOR ALL USING (auth.role() IN ('service_role', 'anon'))","occurrences":1}]}
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  raised := FALSE;
  visible := -1;
  BEGIN
    SELECT count(*) INTO visible FROM public.cron_runs WHERE id IN (run_a, run_b);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF raised THEN
    RAISE EXCEPTION 'TEST FAILED (ANON 1): the anon read of cron_runs RAISED % instead of returning rows. The grant layer refused before the policy was consulted, so a zero-row verdict taken from it would prove nothing. Fix the gate, never the expectation.', err_state;
  END IF;
  IF visible <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (ANON 1): anon read % of the seeded cron_runs rows, expected 0. The ledger fan-outs write failed strategy ids, private ones included, into this table''s metadata; an unauthenticated browser client must never read them.', visible;
  END IF;

  -- ======================================================================
  -- USER 1 — an authenticated NON-admin user reads ZERO of the seeded rows
  -- ======================================================================
  -- RED-UNDER: make the admin policy's is_admin test vacuous —
  --            `p.is_admin = true` becomes `(p.is_admin = true OR TRUE)`. Any
  --            authenticated caller with a profile row then reads every row.
  --            The admin control above still passes and anon still reads 0
  --            (anon has no auth.uid(), so no profile matches), so this arm is
  --            the first failure.
  -- RED-UNDER-M: {"arm":"USER 1","apply":[{"kind":"edit","file":"supabase/migrations/20260408113029_cron_heartbeat.sql","find":"SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true","replace":"SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND (p.is_admin = true OR TRUE)","occurrences":1}]}
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_user::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  raised := FALSE;
  visible := -1;
  BEGIN
    SELECT count(*) INTO visible FROM public.cron_runs WHERE id IN (run_a, run_b);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF raised THEN
    RAISE EXCEPTION 'TEST FAILED (USER 1): the non-admin user''s read of cron_runs RAISED % instead of returning rows. The grant layer refused before the policy was consulted, so a zero-row verdict taken from it would prove nothing. Fix the gate, never the expectation.', err_state;
  END IF;
  IF visible <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (USER 1): an authenticated NON-admin user read % of the seeded cron_runs rows, expected 0. Any tenant could then read which strategies, private ones included, the ledger fan-outs failed to refresh.', visible;
  END IF;

  RAISE NOTICE 'cron_runs row security OK: a platform admin reads the seeded rows (ADMIN 1), anon reads none (ANON 1) and an authenticated non-admin user reads none (USER 1).';
END $$;

ROLLBACK;
