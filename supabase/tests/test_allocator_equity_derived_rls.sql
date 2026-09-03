-- Test: allocator_equity_derived RLS — owner SELECT / cross-tenant deny / anon
-- deny / authenticated write deny / service-role atomic replace. Guards
-- migration 20260717233529_allocator_equity_derived_surface.sql (Phase 115.1 /
-- BACKBONE-02, T-115.1-04).
--
-- allocator_equity_derived holds derived per-key flow USD magnitudes + the
-- derived $-curve — money data. RLS is the ONLY gate on it for the SSR read
-- (the authenticated owner client, queries.ts:2505-2510 sequential auth assert).
-- RLS FAILS SILENTLY — a loosened predicate ships GREEN unless a test inspects
-- the returned rows by CONTENT. A test that asserts "a row came back" is not
-- proof. This file asserts, by content:
--   * owner A sees A's own row, NEVER B's (cross-tenant deny);
--   * owner B sees B's own row, NEVER A's;
--   * anon sees 0 rows (no anon policy);
--   * authenticated cannot INSERT/UPDATE/DELETE (worker is sole writer via
--     service_role) — verified by the table state being UNCHANGED afterwards,
--     robust to whether the denial surfaces as 42501 or a 0-row no-op;
--   * a service-role (RLS-bypass) upsert on (allocator_id, kind) conflict is a
--     single-row atomic REPLACE (the strategy_analytics_series atomicity
--     precedent), not a second row.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block with RAISE
-- EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands (the
-- sql-tests preflight rejects shell-out / copy / output redirection). Under
-- psql -v ON_ERROR_STOP=1 (what .github/workflows/ci.yml sql-tests runs) a
-- failed assertion exits non-zero and fails the job. The whole test rolls back.
--
-- Test-DB lag: the shared test DB tracks prod but lags main, so on a PR branch
-- the migration may not be applied yet. The assertions are gated on the table
-- being present (NOTICE skip otherwise) so this becomes a hard regression guard
-- once the test DB catches up (the migration is MCP-applied to the TEST project
-- before this runs) without red-failing pre-apply.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_allocator_equity_derived_rls.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, REDUNDER-BACKFILL). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ THE PRESENCE GATE ABOVE IS INERT ON THIS LANE, AND THAT IS PROVEN, NOT
-- ASSUMED: 20260717233529 is IN the apply list, so `allocator_equity_derived`
-- exists, the baseline prints ZERO `SKIP` notices, and the file's own closing
-- NOTICE ('All allocator_equity_derived RLS + atomicity assertions passed') is
-- reached — a run that took the skip would print neither. An arm behind a
-- firing skip is unfalsifiable and annotating it would be the vacuity this
-- phase exists to remove (T-164.4-05).
-- ⚠️ 07-fixture-supabase-default-privileges.sql precedes the migration so the
-- table arrives with production's bootstrap GRANT ALL for anon, authenticated
-- and service_role. Assertion 4 accepts EITHER 0 rows or a 42501, so without
-- that grant it would pass on the missing privilege rather than on the absent
-- anon POLICY — and no mutation of the policy could ever redden it.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql"]}

BEGIN;

DO $$
DECLARE
  uid_a    UUID := gen_random_uuid();
  uid_b    UUID := gen_random_uuid();
  row_cnt  INTEGER;
  raised   BOOLEAN;
  v_payload JSONB;
BEGIN
  -- ----- presence gate (test-DB lag) -------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'allocator_equity_derived'
  ) THEN
    RAISE NOTICE 'SKIP: migration 20260717233529 not yet applied here (allocator_equity_derived absent). Assertions enforce once the test DB catches up.';
    RETURN;
  END IF;

  -- ----- SEED (service-role / RLS-bypass connection context) -------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'aed-rls-a-' || uid_a::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'aed-rls a', 'aed-rls-a-' || uid_a::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'aed-rls-b-' || uid_b::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'aed-rls b', 'aed-rls-b-' || uid_b::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO allocator_equity_derived (allocator_id, kind, payload)
  VALUES (uid_a, 'equity_curve',
          '{"curve": [{"date":"2026-01-01","equity_usd":100.0}], "is_trustworthy": true}'::jsonb);
  INSERT INTO allocator_equity_derived (allocator_id, kind, payload)
  VALUES (uid_b, 'equity_curve',
          '{"curve": [{"date":"2026-01-01","equity_usd":200.0}], "is_trustworthy": true}'::jsonb);

  RAISE NOTICE 'Seed OK: A=% B=%', uid_a, uid_b;

  -- RED-UNDER: re-scope allocator_equity_derived_owner_select from
  --            `TO authenticated` to `TO service_role` on the live database
  --            after the migration has applied. The policy still exists under
  --            its own name, while the SSR owner client — which reads with the
  --            AUTHENTICATED key, not the service key — silently sees an empty
  --            dashboard. ⚠️ MEASURED: as a migration EDIT this scores
  --            NO-IDENTITY, because 20260717233529's own STEP 6(c) asserts
  --            `'authenticated' = ANY(roles)` and aborts the apply before the
  --            gate runs. The drift this arm exists to catch is a LATER one, and
  --            a post-apply `sql` step is exactly that.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"sql","stmt":"ALTER POLICY allocator_equity_derived_owner_select ON public.allocator_equity_derived TO service_role"}]}
  -- ----- ASSERTION 1: A sees A's own row ---------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM allocator_equity_derived WHERE allocator_id = uid_a;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (1): owner A sees % of its own rows, expected 1', row_cnt;
  END IF;

  -- RED-UNDER: replace the owner predicate with `true` in migration
  --            20260717233529. Assertion 1 still passes — A does see its own
  --            row — which is exactly why a test that only asserts `a row came
  --            back` is not proof, and why this arm reads the rows by CONTENT.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","find":"  USING (allocator_id = auth.uid());","replace":"  USING (true);","occurrences":1}]}
  -- ----- ASSERTION 2: A does NOT see B's row (cross-tenant) ---------------
  SELECT count(*) INTO row_cnt FROM allocator_equity_derived WHERE allocator_id = uid_b;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): owner A sees % of owner B''s rows, expected 0 — CROSS-TENANT LEAK', row_cnt;
  END IF;
  RESET ROLE;

  -- RED-UNDER: the same `USING (true)` leak as Assertion 2, with Assertion 2
  --            neutered. Assertions 2 and 3b read the SAME property from
  --            opposite tenants, so ONE predicate can only ever be observed by
  --            whichever runs first; the second takes the first as a `neuter`
  --            (the 164.4-06 rule). The mirror arm is not redundant: it is what
  --            catches a predicate that leaks in one direction only.
  -- RED-UNDER-M: {"arm":"3b","apply":[{"kind":"edit","file":"supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","find":"  USING (allocator_id = auth.uid());","replace":"  USING (true);","occurrences":1}],"neuter":[{"arm":"2"}]}
  -- ----- ASSERTION 3: B sees B's own row, never A's ----------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM allocator_equity_derived WHERE allocator_id = uid_b;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (3a): owner B sees % of its own rows, expected 1', row_cnt;
  END IF;
  SELECT count(*) INTO row_cnt FROM allocator_equity_derived WHERE allocator_id = uid_a;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (3b): owner B sees % of owner A''s rows, expected 0 — CROSS-TENANT LEAK', row_cnt;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- RED-UNDER: add an anon SELECT policy to the live database after the
  --            migration has applied — the drift this arm's own prose names
  --            ('anon sees 0 rows (no anon policy)'). Nothing else moves: the
  --            authenticated arms above keep their own policy and stay green, so
  --            this arm is the first failure and its RED is also the proof that
  --            anon HOLDS the table grant here, i.e. that a green Assertion 4 is
  --            RLS and not a missing privilege. ⚠️ MEASURED: as a migration edit
  --            this scores NO-IDENTITY — STEP 6(c) refuses ANY policy naming
  --            anon and aborts the apply, which is the structural half of the
  --            same claim; this arm is the behavioural half.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"sql","stmt":"CREATE POLICY allocator_equity_derived_anon_select ON public.allocator_equity_derived FOR SELECT TO anon USING (true)"}]}
  -- ----- ASSERTION 4: anon sees 0 rows -----------------------------------
  -- No anon policy exists; anon either lacks the grant (42501) or RLS returns
  -- 0. Either way anon must not read derived money data. Treat 42501 as 0.
  SET LOCAL ROLE anon;
  raised := FALSE;
  BEGIN
    SELECT count(*) INTO row_cnt FROM allocator_equity_derived
     WHERE allocator_id IN (uid_a, uid_b);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; row_cnt := 0;
  END;
  RESET ROLE;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (4): anon sees % rows, expected 0', row_cnt;
  END IF;

  -- RED-UNDER: add an owner-write policy for `authenticated` to migration
  --            20260717233529, i.e. let the reader of derived money data also
  --            produce it. The INSERT then succeeds and 5a — the silent-accept
  --            arm — is the first failure. The added policy is FOR ALL with the
  --            owner predicate, so it changes nothing Assertions 1-4 observe.
  -- RED-UNDER-M: {"arm":"5a","apply":[{"kind":"insert-after","file":"supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","anchor":"CREATE POLICY allocator_equity_derived_owner_select ON allocator_equity_derived\n  FOR SELECT\n  TO authenticated\n  USING (allocator_id = auth.uid());","text":"\n\nCREATE POLICY allocator_equity_derived_owner_write ON allocator_equity_derived\n  FOR ALL\n  TO authenticated\n  USING (allocator_id = auth.uid())\n  WITH CHECK (allocator_id = auth.uid());","occurrences":1}]}
  -- ----- ASSERTION 5: authenticated CANNOT write (worker is sole writer) --
  -- Content-based: attempt INSERT/UPDATE/DELETE as authenticated A, swallow any
  -- error, then verify (as the bypass role) that A's table state is UNCHANGED.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 5a INSERT a new kind row — MUST be denied (a success would be a write leak).
  raised := FALSE;
  BEGIN
    INSERT INTO allocator_equity_derived (allocator_id, kind, payload)
    VALUES (uid_a, 'key_inputs:leak', '{"leak": true}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    -- The INSERT did not raise; the row (if any) is caught by the content check
    -- below, but a silent-accept here is already a policy failure to surface.
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (5a): authenticated INSERT was NOT denied — owner write policy leaked';
  END IF;

  -- 5b UPDATE own row — no UPDATE policy → 0 rows or error; either is fine.
  BEGIN
    UPDATE allocator_equity_derived
       SET payload = '{"tampered": true}'::jsonb
     WHERE allocator_id = uid_a AND kind = 'equity_curve';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 5c DELETE own row — no DELETE policy → 0 rows or error; either is fine.
  BEGIN
    DELETE FROM allocator_equity_derived
     WHERE allocator_id = uid_a AND kind = 'equity_curve';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Content verification (bypass role): A still has exactly its original row.
  SELECT count(*) INTO row_cnt FROM allocator_equity_derived WHERE allocator_id = uid_a;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (5): after authenticated writes, A has % rows, expected 1 (unchanged)', row_cnt;
  END IF;
  SELECT payload INTO v_payload FROM allocator_equity_derived
   WHERE allocator_id = uid_a AND kind = 'equity_curve';
  IF v_payload IS NULL OR (v_payload ? 'tampered') THEN
    RAISE EXCEPTION 'TEST FAILED (5): A''s row was tampered by an authenticated UPDATE — write policy leaked';
  END IF;
  IF EXISTS (SELECT 1 FROM allocator_equity_derived WHERE allocator_id = uid_a AND kind = 'key_inputs:leak') THEN
    RAISE EXCEPTION 'TEST FAILED (5): an authenticated INSERT row persisted — write policy leaked';
  END IF;

  -- RED-UNDER: attach a BEFORE UPDATE trigger to allocator_equity_derived on
  --            the live database that returns NULL, so the upsert's DO UPDATE
  --            leg is silently discarded and the stale payload survives. This
  --            statement is an UNWRAPPED positive control in the bypass
  --            context, so a drift that RAISES would abort outside every arm
  --            and score NO-IDENTITY; the SILENT form is the one it can
  --            observe (the 164.4-05 measured rule). Row count stays 1, so the
  --            arm's payload branch is what bites — which is the branch that
  --            distinguishes a REPLACE from a no-op.
  -- RED-UNDER-M: {"arm":"6","apply":[{"kind":"sql","stmt":"CREATE FUNCTION public._drift_aed_swallow_update() RETURNS TRIGGER LANGUAGE plpgsql AS $q$ BEGIN RETURN NULL; END $q$; CREATE TRIGGER _drift_aed_swallow_update BEFORE UPDATE ON public.allocator_equity_derived FOR EACH ROW EXECUTE FUNCTION public._drift_aed_swallow_update()"}]}
  -- ----- ASSERTION 6: service-role upsert is atomic single-row replace ----
  -- Back in the bypass (service/superuser) context. A second upsert on the SAME
  -- (allocator_id, kind) REPLACES the row in place — never a second row.
  INSERT INTO allocator_equity_derived (allocator_id, kind, payload)
  VALUES (uid_a, 'equity_curve', '{"curve": [], "is_trustworthy": false, "v": 2}'::jsonb)
  ON CONFLICT (allocator_id, kind) DO UPDATE
    SET payload = EXCLUDED.payload, computed_at = now();

  SELECT count(*) INTO row_cnt FROM allocator_equity_derived
   WHERE allocator_id = uid_a AND kind = 'equity_curve';
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (6): upsert produced % rows for (A, equity_curve), expected 1 (atomic replace)', row_cnt;
  END IF;
  SELECT payload INTO v_payload FROM allocator_equity_derived
   WHERE allocator_id = uid_a AND kind = 'equity_curve';
  IF (v_payload ->> 'v') IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'TEST FAILED (6): upsert did not replace the payload (got v=%)', COALESCE(v_payload ->> 'v', '<null>');
  END IF;

  RAISE NOTICE 'All allocator_equity_derived RLS + atomicity assertions passed (tenant isolation + write-lockout intact).';

  -- ----- TEARDOWN (belt-and-suspenders; the outer ROLLBACK also discards) -
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);
END
$$;

ROLLBACK;
