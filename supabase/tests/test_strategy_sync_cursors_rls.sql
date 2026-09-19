-- Test for Migration 20260919120000_strategy_sync_cursors.sql —
-- strategy_sync_cursors RLS + grant posture. Phase 164.5.1.4 SYNCCURSOR (WR-05).
--
-- WHY THIS FILE EXISTS. The migration's self-verifying DO block is CATALOG-ONLY
-- and it runs ONCE, at apply. Nothing re-reads the table afterwards, so a later
-- DROP POLICY, an ENABLE -> DISABLE, or a re-GRANT lands with no error at all.
-- The migration says so about ITSELF, in the comment block above its arm 6: arms
-- 5 and 6 pin the policy's NAME and its COMMAND SCOPE, and its QUALIFIER is
-- "pinned by nothing here". This file is what pins the qualifier, and it pins it
-- BEHAVIOURALLY — `USING (false)` -> `USING (true)` passes every arm the
-- migration has, and is caught here by a session that reads a row it must not
-- see.
--
-- The table holds internal cron resume state with NO user-facing consumer
-- (COMMENT ON TABLE, and phase 164.5.1.4 CONTEXT Area 1), so the posture under
-- test is two layers that must BOTH hold: the deny-all policy, and the
-- `REVOKE ALL ... FROM PUBLIC, anon, authenticated` beneath it. They are
-- asserted in SEPARATELY NAMED arms, deliberately — see the vacuity block below.
--
-- pgTAP is NOT installed in this project (CLAUDE.md / Lane B audit), so this
-- uses the same plain PL/pgSQL convention as the other supabase/tests/
-- test_*.sql files: `DO $$ ... $$` blocks with `RAISE EXCEPTION` on failure and
-- `RAISE NOTICE` on assertion pass. No pgTAP, and no psql backslash
-- meta-commands (the sql-tests preflight rejects shell-out / copy / output
-- redirection meta-commands). Under `psql -v ON_ERROR_STOP=1` — what
-- .github/workflows/ci.yml `sql-tests` runs — a failed assertion exits non-zero
-- and fails the job. The filename matches that job's `test_*.sql` glob.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_strategy_sync_cursors_rls.sql
--
-- ==========================================================================
-- ⛔ THE VACUITY THIS FILE IS BUILT AROUND — and the ONE place it diverges
--    from its own precedents, deliberately and for a MEASURED reason.
-- ==========================================================================
-- A 42501 raised by the GRANT layer must NEVER be read as proof that the deny
-- POLICY fired. `test_funding_fees_rls.sql` carries the measured record: three
-- vacuous passes on `test_strategies_private_owner_isolation.sql`, each one a
-- 42501 from a grant the role had never held, read as an RLS verdict.
--
-- The repo's remedy is `scripts/pg-lane/fixtures/07-fixture-supabase-default-
-- privileges.sql`, which reproduces Supabase's bootstrap
-- `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated,
-- service_role` so a table a later migration creates arrives carrying the grants
-- it has in production, and the policy is what denies.
--
-- ⚠️ ON THIS TABLE THAT FIXTURE ALONE IS NOT ENOUGH, and the difference belongs
--    to the migration rather than to the fixture. `scenarios` and
--    `scenario_shares` REVOKE from `anon` and leave `authenticated` holding the
--    bootstrap grant, so their authenticated arms reach the policy. STEP 2 here
--    REVOKEs from PUBLIC, `anon` AND `authenticated`. After this migration
--    applies BOTH client roles hold nothing at all, so a behavioural arm written
--    in the precedents' shape would be refused at the grant layer every time —
--    42501, for a reason that says nothing whatever about `USING (false)`.
--    MEASURED on the disposable lane, 2026-09-19, with fixture 07 applied and
--    this gate's own restoring GRANT deleted: POLICY 1's first raise fires —
--    `the authenticated owner SELECT RAISED 42501 instead of returning rows`.
--    So the precedents' shape is not merely weaker here, it is REFUSED here,
--    and the refusal is the arm's own.
--
-- ⭐ SO THE TWO LAYERS ARE SPLIT, AND THE GATE HANDS THE GRANTS BACK ITSELF:
--    * `GRANT 1` reads the PRISTINE ACL first, through aclexplode(relacl), and
--      requires PUBLIC, anon and authenticated to hold NOTHING. That is the
--      grant layer asserted on the posture the migration actually ships, and it
--      is the ONLY control that reaches the RLS-EXEMPT verbs — TRUNCATE, TRIGGER
--      and REFERENCES are governed by no policy on any table, so an exact-set
--      pin is what covers them (the `SHAPE 3` idiom of
--      test_strategy_shares_rls.sql, adopted here for the same reason).
--    * The gate then restores SELECT/INSERT/UPDATE/DELETE to anon and
--      authenticated in the seeding (superuser) context, so through the POLICY
--      arms the policy is the ONLY thing that can deny. Each policy arm asserts
--      NO EXCEPTION WAS RAISED **before** it asserts its row count — that check
--      is the arm refusing to accept a grant-layer refusal as its own proof, and
--      it is what makes the arm honest rather than merely green.
--    * `RESTORE 1` takes the grants away again and re-reads the ACL.
--
-- ⛔ THE RESTORED GRANT IS NEVER VISIBLE TO ANOTHER SESSION, and that is what
--    makes this safe on SHARED TEST — which other people's CI uses, and where a
--    momentarily world-readable internal cursor table would be a real exposure.
--    A `DO $$ ... $$;` is ONE statement and therefore ONE transaction, and ACL
--    changes in PostgreSQL are transactional. The GRANT and its matching REVOKE
--    both sit inside this block, so the net effect at COMMIT is nothing; and on
--    ANY failure path the RAISE aborts the block, which rolls the GRANT back
--    with it. There is no ordering of events in which a concurrent session
--    observes anon or authenticated holding a privilege on this table.
--
-- ⭐ RED-UNDER ANNOTATIONS (Phase 164.4 grammar). Each assertion carries a prose
-- `RED-UNDER:` naming the smallest change that makes it fail FIRST, and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE it reds on its own arm, then restores
-- GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ 07-fixture-supabase-default-privileges.sql is LOAD-BEARING in the apply list
-- below and is not padding: `GRANT 1`'s twin deletes the migration's REVOKE, and
-- without the fixture the ACL would come back empty anyway, the arm would not
-- redden, and the runner would report `no-red` on a control that is in fact
-- enforced. The fixture is what makes the REVOKE falsifiable on the lane.
-- MEASURED 2026-09-19: the same twin, run with 07 dropped from the apply list,
-- leaves the lane GREEN and exits 0 — the `no-red` above, observed rather than
-- predicted.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20260919120000_strategy_sync_cursors.sql"]}
--
-- The test seeds ONE synthetic tenant end-to-end:
--   auth.users -> profiles -> strategies -> strategy_sync_cursors
-- ⚠️ ONE tenant, not two, and that is a decision rather than an omission. Every
-- other `*_rls.sql` file here seeds tenants A and B because its policy is an
-- OWNER predicate and the leak it hunts is cross-tenant. This policy has no
-- owner tier at all — `USING (false)` denies the row's OWN owner — so the
-- strongest available statement is that the strategy's owner, holding a valid
-- JWT and a full table grant, still sees nothing and writes nothing. A second
-- tenant would add rows and prove strictly less.

-- --------------------------------------------------------------------------
-- Defensive pre-clean. If a prior run aborted between seed and teardown the
-- synthetic rows may still be present. ON DELETE CASCADE chains
-- auth.users -> profiles -> strategies -> strategy_sync_cursors, so deleting
-- the auth.users row by email drops the whole subtree.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email = 'test-synccursor-rls-owner@quantalyze.test';

DO $$
DECLARE
  uid_owner   UUID := gen_random_uuid();
  sid_cursor  UUID;   -- the strategy that HAS a cursor row
  sid_free    UUID;   -- a strategy with NO cursor row (POLICY 4's insert target)
  v_marker    TIMESTAMPTZ := timestamptz '2020-01-02 03:04:05+00';
  v_privs     TEXT;
  v_rls       BOOLEAN;
  v_polcmd    "char";
  visible     INTEGER;
  affected    INTEGER;
  raised      BOOLEAN;
  err_state   TEXT;
  v_after     TIMESTAMPTZ;
BEGIN
  -- ----- APPLIED-NESS GUARD: skip ONLY on genuine test-DB lag -------------
  -- ⛔ WHY THIS EXISTS, and it is NOT a weakening of the gate.
  -- This repo applies migrations ON MERGE, not on PR (`supabase-migrate.yml`'s
  -- `apply-test` runs on the merge push). So on the PR that ADDS a migration,
  -- shared TEST does not yet carry its table and every gate with an
  -- applied-ness probe is RED BY CONSTRUCTION. That coupling is booked as
  -- [164.8-PUSH-RACE-VAC08] half (b) and routed to Phase 164.9; VAC-08 carries
  -- a ledger-frontier exemption for ITS OWN verdict and for nothing else, so
  -- this file needs its own guard or it reddens `sql-tests` — and with it the
  -- whole `frontend` aggregator — on exactly the PR that introduces it.
  --
  -- ⭐ THE SKIP IS GATED ON THE TABLE'S EXISTENCE, NEVER ON ANYTHING THIS
  -- FILE AUDITS. That distinction is the whole point, and this repo already
  -- learned it once (see test_anon_execute_current_user_has_app_role.sql: gate
  -- the skip on existence, not on the privilege being audited). If the table is
  -- THERE, then RLS being off, the policy being missing, the REVOKE having been
  -- undone or service_role having lost its GRANT are all REAL REGRESSIONS and
  -- must hard-fail below — never skip green. A guard that tested, say,
  -- `pg_policy` presence would silently convert the exact defect this gate
  -- exists to catch into a passing run.
  --
  -- ⚠️ A SKIP HERE COSTS NO COVERAGE, because this is not where the arms are
  -- proven. `sql-mutation` executes every RED-UNDER-M twin in this file on the
  -- disposable pg-lane cluster, where the migration IS applied, so all ten arms
  -- are mutation-checked on every run regardless of what shared TEST holds. The
  -- shared-TEST execution is the additional behavioural pass, and it resumes by
  -- itself the moment `apply-test` lands the table — no follow-up edit needed.
  IF to_regclass('public.strategy_sync_cursors') IS NULL THEN
    RAISE NOTICE 'SKIP: strategy_sync_cursors not applied here yet (migration 20260919120000 applies on merge, not on PR) — the arms still execute under sql-mutation on the pg-lane';
    RETURN;
  END IF;

  -- ----- SEED (service role / superuser context — bypasses RLS) ----------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_owner, '00000000-0000-0000-0000-000000000000',
          'test-synccursor-rls-owner@quantalyze.test', now(), now());

  -- On a real project the on_auth_user_created trigger has already created the
  -- profile row by the time the INSERT above returns, so this is an upsert
  -- rather than a plain insert (the idiom test_funding_fees_rls.sql uses).
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_owner, 'synccursor rls owner',
          'test-synccursor-rls-owner@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO strategies (user_id, name)
  VALUES (uid_owner, 'synccursor rls strategy (has cursor)')
  RETURNING id INTO sid_cursor;

  INSERT INTO strategies (user_id, name)
  VALUES (uid_owner, 'synccursor rls strategy (no cursor)')
  RETURNING id INTO sid_free;

  -- State (3) of the migration's three-state contract: row present, timestamp
  -- set. A fixed marker rather than now(), so POLICY 3's ground-truth read can
  -- assert the value is UNCHANGED by value and not merely by presence.
  INSERT INTO strategy_sync_cursors (strategy_id, last_sync_at, updated_at)
  VALUES (sid_cursor, v_marker, now());

  RAISE NOTICE 'Seed OK: owner=% strategy(with cursor)=% strategy(no cursor)=%',
    uid_owner, sid_cursor, sid_free;

  -- ======================================================================
  -- SEED 1: the seeding context sees exactly ONE cursor row for this strategy
  -- ======================================================================
  -- ⭐ THE ARM THAT MAKES EVERY ZERO-ROW ARM BELOW MEAN SOMETHING. POLICY 1 and
  -- POLICY 2 assert "this session sees 0 rows". Over a table with no row in it,
  -- that is true of any policy whatsoever, including no policy at all. This arm
  -- is the only one that can refuse that state, so it runs first.
  -- RED-UNDER: stop the cursor row landing — replace its seed INSERT with a
  --            `NULL;` no-op. POLICY 1, POLICY 2 and POLICY 3 all still pass
  --            over the empty table while proving nothing at all about the
  --            qualifier, which is exactly what this arm exists to refuse.
  --            (Seed-targeting twin, the shape test_scenarios_rls.sql uses for
  --            its own Assertion 1. No assertion, failure branch or identity is
  --            touched — GRAMMAR 3a/3b bind.)
  -- RED-UNDER-M: {"arm":"SEED 1","apply":[{"kind":"edit","file":"supabase/tests/test_strategy_sync_cursors_rls.sql","find":"  INSERT INTO strategy_sync_cursors (strategy_id, last_sync_at, updated_at)\n  VALUES (sid_cursor, v_marker, now());\n","replace":"  NULL;\n","occurrences":1}]}
  SELECT COUNT(*) INTO visible
    FROM strategy_sync_cursors WHERE strategy_id = sid_cursor;
  IF visible <> 1 THEN
    RAISE EXCEPTION
      'TEST FAILED (SEED 1): the seeding context sees % cursor row(s) for the seeded strategy, expected exactly 1. Every zero-row assertion below is a statement ABOUT THIS ROW; over an empty table they are satisfied by any policy, or by none.', visible;
  END IF;
  RAISE NOTICE 'SEED 1 OK: the seeding context sees exactly 1 cursor row for the seeded strategy.';

  -- ======================================================================
  -- GRANT 1: PUBLIC, anon and authenticated hold NO table privilege
  -- ======================================================================
  -- ⛔ THIS ARM IS THE ONLY CONTROL IN THIS FILE THAT REACHES THE RLS-EXEMPT
  -- VERBS. No policy on any table governs TRUNCATE, TRIGGER or REFERENCES —
  -- a single `TRUNCATE strategy_sync_cursors` from a client session would
  -- discard every strategy's resume cursor at once and no `USING (false)` would
  -- see it happen. The migration says the same thing in STEP 2's comment ("the
  -- only control reaching the RLS-EXEMPT verbs"); this is where the claim is
  -- checked rather than asserted.
  --
  -- The set is pinned as EMPTY rather than as "DELETE is absent", for the reason
  -- the `SHAPE 3` arm of test_strategy_shares_rls.sql records: an enumeration of
  -- forbidden privilege names cannot catch TRUNCATE, REFERENCES and TRIGGER
  -- together, and can never catch the next privilege PostgreSQL adds.
  --
  -- Read through aclexplode(pg_class.relacl), NOT
  -- information_schema.role_table_grants: that view is privilege-filtered and
  -- can under-report, which for an exact-set assertion makes a confusing false
  -- RED possible. PUBLIC is grantee 0 and has no pg_roles row, so it is picked
  -- up by the LEFT JOIN's grantee test rather than by name.
  --
  -- ⛔ MEASURED FIRST, BEFORE THE GATE RESTORES ANYTHING. Moving this read below
  -- the restoring GRANT would make it read the gate's own grant and pass or fail
  -- on this file rather than on the migration.
  -- RED-UNDER: delete `REVOKE ALL ON TABLE strategy_sync_cursors FROM PUBLIC,
  --            anon, authenticated;` from STEP 2 of migration 20260919120000 —
  --            the state an earlier draft of that file argued for and withdrew.
  -- ⚠️ This twin is ALSO what proves 07-fixture-supabase-default-privileges.sql
  --    is load-bearing here: the fixture is the only reason the table arrives
  --    carrying anything to revoke. Without it in the apply list, deleting the
  --    REVOKE leaves the ACL empty regardless and this arm scores `no-red`.
  -- RED-UNDER-M: {"arm":"GRANT 1","apply":[{"kind":"edit","file":"supabase/migrations/20260919120000_strategy_sync_cursors.sql","find":"REVOKE ALL ON TABLE strategy_sync_cursors FROM PUBLIC, anon, authenticated;\n","replace":"","occurrences":1}]}
  SELECT string_agg(DISTINCT COALESCE(r.rolname, 'PUBLIC') || ':' || acl.privilege_type,
                    ',' ORDER BY COALESCE(r.rolname, 'PUBLIC') || ':' || acl.privilege_type)
    INTO v_privs
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
    LEFT JOIN pg_roles r ON r.oid = acl.grantee
   WHERE c.oid = 'public.strategy_sync_cursors'::regclass
     AND (acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));
  IF v_privs IS NOT NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (GRANT 1): the client roles hold table-level privileges "%" on strategy_sync_cursors, expected NONE. Migration 20260919120000 STEP 2 REVOKEs ALL from PUBLIC, anon and authenticated, and that REVOKE is the ONLY control reaching the RLS-EXEMPT verbs: no policy governs TRUNCATE, TRIGGER or REFERENCES, so one TRUNCATE from a client session would discard every strategy resume cursor at once with the deny-all policy watching. service_role is untouched by this assertion: it is not in the revoked set, and it holds its own table GRANT from migration 20260919120000 STEP 2. (BYPASSRLS is a ROW-level exemption and confers no object privilege, so the GRANT is what lets the writer reach this table, not the role attribute.)', v_privs;
  END IF;
  RAISE NOTICE 'GRANT 1 OK: PUBLIC, anon and authenticated hold no table-level privilege on strategy_sync_cursors.';

  -- ======================================================================
  -- RLS 1: row level security is ENABLED on the relation
  -- ======================================================================
  -- The migration asserts this once, at apply. This file asserts it on every CI
  -- run, which is the difference that matters: `ALTER TABLE ... DISABLE ROW
  -- LEVEL SECURITY` in a later migration is silent, and with RLS off the policy
  -- below still EXISTS in pg_policy — so a presence check would keep passing.
  -- RED-UNDER: disable row level security on the live lane database. Expressed
  --            as a `sql` step rather than a migration edit because the drift
  --            being modelled is a LATER migration (or an unguarded developer
  --            CLI session on shared TEST) disabling it, not this migration
  --            changing — and editing STEP 2's ENABLE would abort the apply on
  --            the migration's own arm 4, so the gate would never run.
  -- RED-UNDER-M: {"arm":"RLS 1","apply":[{"kind":"sql","stmt":"ALTER TABLE public.strategy_sync_cursors DISABLE ROW LEVEL SECURITY"}]}
  SELECT relrowsecurity INTO v_rls
    FROM pg_class WHERE oid = 'public.strategy_sync_cursors'::regclass;
  IF NOT COALESCE(v_rls, FALSE) THEN
    RAISE EXCEPTION
      'TEST FAILED (RLS 1): row level security is NOT enabled on strategy_sync_cursors. The deny-all policy still exists in pg_policy and is not applied to anything, so a presence check would pass while internal sync state is readable by every granted role.';
  END IF;
  RAISE NOTICE 'RLS 1 OK: row level security is enabled on strategy_sync_cursors.';

  -- ======================================================================
  -- RLS 2: the named policy exists AND governs ALL commands
  -- ======================================================================
  -- `polcmd` is a catalog code point ('*' = FOR ALL), not deparsed text, so this
  -- cannot fail on a rendering difference between PostgreSQL majors. A policy
  -- carrying this name but created FOR SELECT leaves INSERT, UPDATE and DELETE
  -- ungoverned while satisfying every name-only check.
  -- RED-UNDER: re-create the policy FOR SELECT on the live lane database,
  --            keeping its name and its `USING (false)` qualifier.
  -- ⚠️ A `sql` step, not a migration edit, and that is forced rather than
  --    preferred: the migration's own arm 6 pins polcmd = '*' and ABORTS THE
  --    APPLY on any other value, so a migration edit means the gate never runs
  --    and no arm can be the first failure. The lane's --post-apply hook exists
  --    for exactly this shape (GRAMMAR Shape 2).
  -- RED-UNDER-M: {"arm":"RLS 2","apply":[{"kind":"sql","stmt":"DROP POLICY strategy_sync_cursors_deny_all ON public.strategy_sync_cursors; CREATE POLICY strategy_sync_cursors_deny_all ON public.strategy_sync_cursors FOR SELECT USING (false)"}]}
  SELECT p.polcmd INTO v_polcmd
    FROM pg_policy p
   WHERE p.polrelid = 'public.strategy_sync_cursors'::regclass
     AND p.polname = 'strategy_sync_cursors_deny_all';
  IF v_polcmd IS NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (RLS 2): policy strategy_sync_cursors_deny_all is missing from strategy_sync_cursors. With RLS enabled and no policy the table default-denies, so the behavioural arms below would still pass — the loss only surfaces the day a second, permissive policy is added.';
  END IF;
  IF v_polcmd <> '*' THEN
    RAISE EXCEPTION
      'TEST FAILED (RLS 2): policy strategy_sync_cursors_deny_all has polcmd %, expected * (FOR ALL). A deny policy scoped to one command leaves the other three ungoverned.', v_polcmd;
  END IF;
  RAISE NOTICE 'RLS 2 OK: strategy_sync_cursors_deny_all exists and governs ALL commands (polcmd = *).';

  -- ======================================================================
  -- ⭐ THE ANTI-VACUITY STEP. Read the block at the head of this file first.
  -- ======================================================================
  -- GRANT 1 has already measured and pinned the shipped ACL. From here to
  -- RESTORE 1 the client roles hold a full DML grant, so nothing below can be
  -- refused by the grant layer and every refusal is the POLICY's. Both
  -- statements live inside this one transaction, so their net effect at COMMIT
  -- is nothing and no other session can observe the grant.
  GRANT SELECT, INSERT, UPDATE, DELETE ON strategy_sync_cursors TO anon, authenticated;

  -- ======================================================================
  -- POLICY 1: the strategy's OWN OWNER, authenticated, sees ZERO rows
  -- ======================================================================
  -- ⭐ THIS IS THE ARM THE MIGRATION ASKS FOR BY NAME. Its arms 5 and 6 pin the
  -- policy's name and its command scope; its own comment says the QUALIFIER is
  -- "pinned by nothing here". `USING (false)` -> `USING (true)` leaves the name
  -- and the command scope untouched, so the migration commits green over a
  -- policy granting every row to every caller. This session is what notices.
  --
  -- The owner is the strongest available reader: this table has NO owner tier,
  -- so the row's own owner holding a valid JWT must still see nothing.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_owner::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;

  -- RED-UNDER: open the qualifier — `USING (false)` becomes `USING (true)` in
  --            migration 20260919120000's CREATE POLICY. Every catalog arm the
  --            migration has still passes; this one reads the row back.
  -- RED-UNDER-M: {"arm":"POLICY 1","apply":[{"kind":"edit","file":"supabase/migrations/20260919120000_strategy_sync_cursors.sql","find":"  USING (false)\n  WITH CHECK (false);","replace":"  USING (true)\n  WITH CHECK (false);","occurrences":1}]}
  raised := FALSE;
  visible := -1;
  BEGIN
    SELECT COUNT(*) INTO visible
      FROM strategy_sync_cursors WHERE strategy_id = sid_cursor;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;
  RESET ROLE;

  -- ⛔ THE VACUITY CHECK, AND IT COMES FIRST ON PURPOSE. If this SELECT raised at
  -- all, the grant layer refused it and the zero-row result below would be true
  -- for a reason that says nothing about the policy. That is the exact defect
  -- the `*_rls.sql` family warns about, so this arm refuses to accept it.
  IF raised THEN
    RAISE EXCEPTION
      'TEST FAILED (POLICY 1): the authenticated owner SELECT RAISED % instead of returning rows. This gate restores SELECT/INSERT/UPDATE/DELETE to anon and authenticated immediately above precisely so the POLICY is the binding constraint here; an error means the grant layer refused first, and a zero-row verdict taken from it would prove nothing about USING (false). Fix the gate, never the expectation.', err_state;
  END IF;
  IF visible <> 0 THEN
    RAISE EXCEPTION
      'TEST FAILED (POLICY 1): the strategy OWNER, authenticated and holding a full table grant, read % row(s) of strategy_sync_cursors, expected 0. The deny-all qualifier has been opened. This table has no owner tier by design: internal cron resume state must never reach a browser client, and USING (false) is pinned by NOTHING in the migration itself.', visible;
  END IF;
  RAISE NOTICE 'POLICY 1 OK: the authenticated owner reads 0 rows, and the read reached the policy rather than the grant layer.';

  -- ======================================================================
  -- POLICY 2: anon, with no JWT at all, sees ZERO rows
  -- ======================================================================
  -- The browser-client path. anon is the role an unauthenticated PostgREST
  -- request arrives as, and it is the one the table must never be reachable
  -- from. Same two halves, same order, same reason.
  PERFORM set_config('request.jwt.claims', NULL, true);
  SET LOCAL ROLE anon;

  -- RED-UNDER: open the qualifier — `USING (false)` becomes `USING (true)` in
  --            migration 20260919120000's CREATE POLICY.
  -- ⚠️ POLICY 1 reads the same state through a stronger role and fires first, so
  --    this arm was observed red with POLICY 1's two raises neutered — at which
  --    point POLICY 2 is the first failure and names the anon path it is about.
  --    It is defence in depth BEHIND POLICY 1 and the neuter is what lets it say
  --    so out loud rather than look unfalsifiable.
  -- RED-UNDER-M: {"arm":"POLICY 2","apply":[{"kind":"edit","file":"supabase/migrations/20260919120000_strategy_sync_cursors.sql","find":"  USING (false)\n  WITH CHECK (false);","replace":"  USING (true)\n  WITH CHECK (false);","occurrences":1}],"neuter":[{"arm":"POLICY 1"},{"arm":"POLICY 1"}]}
  raised := FALSE;
  visible := -1;
  BEGIN
    SELECT COUNT(*) INTO visible
      FROM strategy_sync_cursors WHERE strategy_id = sid_cursor;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;
  RESET ROLE;

  IF raised THEN
    RAISE EXCEPTION
      'TEST FAILED (POLICY 2): the anon SELECT RAISED % instead of returning rows. The grant layer refused before the policy was consulted, so a zero-row verdict taken from it would be vacuous. Fix the gate, never the expectation.', err_state;
  END IF;
  IF visible <> 0 THEN
    RAISE EXCEPTION
      'TEST FAILED (POLICY 2): anon, holding no JWT and a full table grant, read % row(s) of strategy_sync_cursors, expected 0. This is the unauthenticated browser path; internal cron resume state is one loosened qualifier away from being world-readable.', visible;
  END IF;
  RAISE NOTICE 'POLICY 2 OK: anon reads 0 rows, and the read reached the policy rather than the grant layer.';

  -- ======================================================================
  -- POLICY 3: the owner cannot DELETE or UPDATE the cursor row
  -- ======================================================================
  -- `USING (false)` filters the row out of the session's view entirely, so a
  -- DELETE or UPDATE targeting it affects 0 rows — RLS scopes writes silently,
  -- it does not raise. Assert 0 rows affected, then verify the row by VALUE from
  -- the seeding context.
  --
  -- ⭐ DELETE IS PROBED FIRST, AND THE ORDER IS A MEASUREMENT RATHER THAN A
  -- STYLE. DELETE is the verb not subject to WITH CHECK, so under the
  -- `USING (true)` mutation it lands as a row count this arm can name. An UPDATE
  -- probed first would be admitted for reading and then rejected by
  -- `WITH CHECK (false)`, raising a raw 42501 outside every arm — scored
  -- NO-IDENTITY on the lane, which proves nothing and names nobody.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_owner::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;

  -- RED-UNDER: open the qualifier — `USING (false)` becomes `USING (true)` in
  --            migration 20260919120000's CREATE POLICY, at which point the
  --            owner's DELETE reaches and destroys the cursor row.
  -- ⚠️ POLICY 1 and POLICY 2 read the same state and fire first, so this arm was
  --    observed red with both neutered (two raises each).
  -- ⚠️ WITH CHECK is deliberately LEFT INTACT: widening it as well would make
  --    POLICY 4 red too, and the two layers stay distinguishable this way.
  -- RED-UNDER-M: {"arm":"POLICY 3","apply":[{"kind":"edit","file":"supabase/migrations/20260919120000_strategy_sync_cursors.sql","find":"  USING (false)\n  WITH CHECK (false);","replace":"  USING (true)\n  WITH CHECK (false);","occurrences":1}],"neuter":[{"arm":"POLICY 1"},{"arm":"POLICY 1"},{"arm":"POLICY 2"},{"arm":"POLICY 2"}]}
  DELETE FROM strategy_sync_cursors WHERE strategy_id = sid_cursor;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (POLICY 3): the authenticated owner DELETE affected % cursor row(s), expected 0. A client that can delete a resume cursor re-drives that strategy from the start of history on the next tick — the over-fetch the fail-open branch is designed to produce, arriving for a reason nobody can see.', affected;
  END IF;

  UPDATE strategy_sync_cursors
     SET last_sync_at = now()
   WHERE strategy_id = sid_cursor;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (POLICY 3): the authenticated owner UPDATE affected % cursor row(s), expected 0. A client that can advance its own cursor can skip its own trades past a window that was never fetched — permanently, because no later tick revisits it.', affected;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Ground truth from the seeding context: the row is still there and still
  -- carries its seeded marker, asserted BY VALUE rather than by presence.
  SELECT last_sync_at INTO v_after
    FROM strategy_sync_cursors WHERE strategy_id = sid_cursor;
  IF v_after IS NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (POLICY 3): the cursor row is gone (or its last_sync_at was nulled) after the client write attempts. Row count 0 was reported and the row changed anyway.';
  END IF;
  IF v_after <> v_marker THEN
    RAISE EXCEPTION
      'TEST FAILED (POLICY 3): last_sync_at is % after the client write attempts, expected the seeded marker % unchanged.', v_after, v_marker;
  END IF;
  RAISE NOTICE 'POLICY 3 OK: owner DELETE and UPDATE each affected 0 rows; the cursor row is unchanged by value.';

  -- ======================================================================
  -- POLICY 4: the owner cannot INSERT a cursor row
  -- ======================================================================
  -- INSERT is governed by WITH CHECK alone, so this is the one arm that pins the
  -- OTHER half of the qualifier. `sid_free` is a strategy with no cursor row, so
  -- under a widened WITH CHECK the insert genuinely succeeds rather than being
  -- refused by the primary key for an unrelated reason.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_owner::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;

  -- RED-UNDER: open the write qualifier — `WITH CHECK (false)` becomes
  --            `WITH CHECK (true)` in migration 20260919120000's CREATE POLICY.
  -- ⚠️ USING is left intact, so POLICY 1, POLICY 2 and POLICY 3 all still pass
  --    (their reads and their row counts are decided by USING) and no neuter is
  --    needed. The two halves of the qualifier are pinned independently.
  -- RED-UNDER-M: {"arm":"POLICY 4","apply":[{"kind":"edit","file":"supabase/migrations/20260919120000_strategy_sync_cursors.sql","find":"  USING (false)\n  WITH CHECK (false);","replace":"  USING (false)\n  WITH CHECK (true);","occurrences":1}]}
  -- ⛔ POSITIVE CONTROL, AND THIS ARM IS LATENTLY VACUOUS WITHOUT IT. A refusal
  --    by the GRANT layer and a refusal by `WITH CHECK (false)` are the SAME
  --    SQLSTATE — 42501 — so the `err_state = '42501'` check below CANNOT tell
  --    them apart. If the restoring GRANT above were ever narrowed (INSERT
  --    dropped from it), POLICY 1/2/3 would keep passing and POLICY 4 would pass
  --    on a grant-layer refusal while measuring nothing about the policy. That is
  --    precisely the "a 42501 from the GRANT layer read as proof the POLICY
  --    fired" defect this file's header block exists to prevent, and it would be
  --    surviving in the ONE arm guarding the write half of the qualifier.
  -- ⭐ Asserted by catalog rather than by matching SQLERRM text, which is
  --    locale-dependent. This is the INSERT-side twin of POLICY 1/POLICY 2's
  --    `raised` check.
  --
  -- RED-UNDER: narrow the restoring GRANT above so `authenticated` no longer
  --            holds INSERT. POLICY 4's own INSERT probe then fails at the GRANT
  --            layer with the SAME 42501 it expects from WITH CHECK, so without
  --            this precondition the arm passes while measuring nothing.
  -- RED-UNDER-M: {"arm":"POLICY 4 precondition","apply":[{"kind":"edit","file":"supabase/tests/test_strategy_sync_cursors_rls.sql","find":"  -- is nothing and no other session can observe the grant.\n  GRANT SELECT, INSERT, UPDATE, DELETE ON strategy_sync_cursors TO anon, authenticated;","replace":"  -- is nothing and no other session can observe the grant.\n  GRANT SELECT, UPDATE, DELETE ON strategy_sync_cursors TO anon, authenticated;","occurrences":1}]}
  IF NOT has_table_privilege(
           'authenticated', 'public.strategy_sync_cursors', 'INSERT'
         ) THEN
    RAISE EXCEPTION
      'TEST FAILED (POLICY 4 precondition): authenticated does not hold INSERT on strategy_sync_cursors, so the probe below would be refused by the GRANT layer and its 42501 would say NOTHING about WITH CHECK. The restoring GRANT in the seeding context is what makes this arm measure the POLICY.';
  END IF;

  raised := FALSE;
  BEGIN
    INSERT INTO strategy_sync_cursors (strategy_id, last_sync_at, updated_at)
    VALUES (sid_free, now(), now());
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF NOT raised THEN
    RAISE EXCEPTION
      'TEST FAILED (POLICY 4): the authenticated owner INSERTED a strategy_sync_cursors row. WITH CHECK (false) is the only thing standing between a client and a forged resume cursor: a row present with a future timestamp makes the cron skip that strategy''s trades for good, and a row present with NULL re-fetches all of history. The migration distinguishes those two states by key MEMBERSHIP, so a client that can create the key controls both.';
  END IF;
  IF err_state <> '42501' THEN
    RAISE EXCEPTION
      'TEST FAILED (POLICY 4): the authenticated owner INSERT raised %, expected 42501 (RLS WITH CHECK violation). A different SQLSTATE means something other than the policy refused — a NOT NULL, a foreign key or the grant layer — and this arm would be reporting that instead.', err_state;
  END IF;
  RAISE NOTICE 'POLICY 4 OK: the authenticated owner INSERT was refused with ERRCODE 42501 (WITH CHECK).';

  -- ======================================================================
  -- RESTORE 1: the shipped grant posture is put back, and re-read
  -- ======================================================================
  -- ⛔ THIS IS A SAFETY ARM, NOT A TIDINESS ONE. `sql-tests` runs this file
  -- against SHARED TEST, which other people's CI uses. The grant above and this
  -- REVOKE are both inside this transaction so nothing outside it ever sees the
  -- grant — but that argument is only true while BOTH statements are here, and
  -- this arm is what keeps it true.
  REVOKE ALL ON TABLE strategy_sync_cursors FROM PUBLIC, anon, authenticated;

  -- RED-UNDER: delete the REVOKE immediately above from this gate file, which is
  --            the state in which this file would COMMIT a live grant of
  --            SELECT/INSERT/UPDATE/DELETE on an internal table to anon and
  --            authenticated on every database it is ever run against.
  -- RED-UNDER-M: {"arm":"RESTORE 1","apply":[{"kind":"edit","file":"supabase/tests/test_strategy_sync_cursors_rls.sql","find":"  REVOKE ALL ON TABLE strategy_sync_cursors FROM PUBLIC, anon, authenticated;\n","replace":"","occurrences":1}]}
  SELECT string_agg(DISTINCT COALESCE(r.rolname, 'PUBLIC') || ':' || acl.privilege_type,
                    ',' ORDER BY COALESCE(r.rolname, 'PUBLIC') || ':' || acl.privilege_type)
    INTO v_privs
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
    LEFT JOIN pg_roles r ON r.oid = acl.grantee
   WHERE c.oid = 'public.strategy_sync_cursors'::regclass
     AND (acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));
  IF v_privs IS NOT NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (RESTORE 1): this gate is about to COMMIT with the client roles holding "%" on strategy_sync_cursors. The grant it restores for its own policy arms must be taken away again in the same transaction; leaving it would publish internal cron resume state on every database this file runs against, shared TEST included.', v_privs;
  END IF;
  RAISE NOTICE 'RESTORE 1 OK: the shipped grant posture is restored — PUBLIC, anon and authenticated hold nothing.';

  -- ----- TEARDOWN -------------------------------------------------------
  -- ON DELETE CASCADE chains auth.users -> profiles -> strategies ->
  -- strategy_sync_cursors, so one delete clears the whole subtree.
  DELETE FROM auth.users WHERE id = uid_owner;

  RAISE NOTICE 'All strategy_sync_cursors RLS assertions passed (deny-all policy and REVOKE both intact).';
END
$$;

-- --------------------------------------------------------------------------
-- Defensive post-clean. If an assertion above aborted with RAISE EXCEPTION the
-- whole DO block — seed rows and the restored grant alike — is rolled back, so
-- this is belt and braces for an abort that happened between statements outside
-- it. It is cheap and it makes a re-run start clean either way.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email = 'test-synccursor-rls-owner@quantalyze.test';
