-- Test for Phase 140.1 / PYAPI-01 (finding C-08, the repair programme's only CRITICAL):
--   * supabase/migrations/<ts>_strategy_verifications_tenant_scope_uniq.sql
--     (composite UNIQUE (strategy_id, wizard_session_id); old single-column
--      strategy_verifications_wizard_session_id_unique_idx dropped)
--
-- What this asserts, and why by CONTENT not by shape
-- --------------------------------------------------
-- `strategy_verifications` carried a SINGLE-COLUMN unique index on
-- wizard_session_id (migration 20260510173005_process_key_long_idempotency_drain.sql:83-84).
-- wizard_session_id is CALLER-SUPPLIED (routers/process_key.py:720 reads it from
-- body.context), so the uniqueness namespace was GLOBAL ACROSS TENANTS. Two
-- consequences, one of which needs no attacker at all:
--
--   * availability/integrity (deterministic): tenant B submitting a
--     wizard_session_id that tenant A already used gets 23505, and the route's
--     23505 handler (process_key.py:889) then hands B tenant A's verification_id,
--     status and trust_tier as if they were B's own;
--   * confidentiality: an authenticated tenant who OBTAINS a foreign
--     wizard_session_id (screenshot, support ticket, shared URL, log line) reads
--     the victim's verification row on demand.
--
-- `strategy_verifications` has NO user_id column (columns per
-- 20260501055202_strategy_verifications.sql:77-98). Tenancy is derived through
-- strategy_id -> strategies.user_id, which is exactly what this table's own
-- owner RLS policy does (:118-124). The correct constraint is therefore
-- UNIQUE (strategy_id, wizard_session_id).
--
-- >>> The migration's OWN COMMENT argues the buggy shape is correct <<<
-- 20260510173005:72-73 reads: "wizard_session_id is UUID NOT NULL - plain UNIQUE
-- INDEX (no partial WHERE clause) is correct". That reasoning is the defect: it
-- reasoned about NULLability and forgot tenancy. This file exists so that
-- reverting toward that comment cannot ship green.
--
-- A constraint failure is SILENT in the same way an RLS failure is: a migration
-- that re-narrows the index reports success and every unit test still passes.
-- So assertion A1 below is an ECONOMIC oracle -- it states the business truth
-- ("two tenants running independent wizard sessions must not collide") and is
-- NOT derivable from the index definition. A4/A5 are drift-pins that catch the
-- shape; they are deliberately NOT allowed to stand in for A1.
--
-- This file asserts:
--   A1. ECONOMIC ORACLE: tenant A inserts a verification for A's strategy with
--       wizard_session_id W; tenant B then inserts a verification for B's
--       DIFFERENT strategy with the SAME W. BOTH MUST SUCCEED. On the old
--       single-column index the second insert raises 23505 -- this file is
--       RED-guarded on the migration.
--   A2. ISOLATION: tenant B's authenticated session sees ZERO rows for tenant
--       A's verification id.
--   A3. POSITIVE CONTROL: that same session sees exactly ONE row for B's OWN
--       verification id -- proves the session switch works, so A2's zero is
--       isolation and not a broken harness.
--   A4. DRIFT-PIN: exactly ONE unique index on strategy_verifications covers
--       wizard_session_id, and its column list is EXACTLY
--       ('strategy_id','wizard_session_id') -- compared against a LITERAL array,
--       never read back out of the index under test.
--   A5. DRIFT-PIN: the OLD index name
--       strategy_verifications_wizard_session_id_unique_idx is ABSENT. Catches
--       "created the new one, forgot to drop the old" -- with both present A1
--       still fails, because the old index still enforces global uniqueness.
--
-- Every fixture identifier below is a LITERAL UUID declared in this file, and
-- every count is scoped to one of those literals -- never a global count. The
-- shared test DB carries other verification rows, so a global count could pass
-- vacuously.
--
-- What this file CANNOT prove: that the Python duplicate pre-check
-- (process_key.py:722-728) and 23505 race re-fetch (:895-901) filter by
-- strategy_id. A1-A5 all pass with the query half unfixed. That half is
-- Plan 140.1-02 and is proven by pytest. Ship both or the class is not closed.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands. Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs at
-- :692-838) a failed assertion exits non-zero and fails the job. The filename
-- matches the `test_*.sql` glob so the job auto-discovers it against the test
-- project (with the tenant-scope migration applied).
--
-- Hygiene: all fixture work runs inside an explicit transaction that ends in
-- ROLLBACK, so the shared test DB is never polluted (no committed fixture rows).
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_strategy_verifications_wizard_session_tenant_scope.sql
--
-- ⭐ RED-UNDER ANNOTATIONS (Phase 164.4). Each assertion below carries a prose
-- `RED-UNDER:` naming the smallest production change that makes it fail, and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE it reds on its OWN arm, then restores
-- GREEN. Schema: scripts/mutation-runner/GRAMMAR.md. The line below declares
-- what the lane applies before this gate.
--
-- ⛔ TWO MIGRATIONS THIS FILE'S OWN HEADER NAMES ARE ABSENT FROM THE APPLY LIST,
-- and NOT by choice. Both die on a vanilla PostgreSQL 16 cluster before they
-- reach a single statement, because both put `SAVEPOINT` / `ROLLBACK TO
-- SAVEPOINT` inside a PL/pgSQL `DO $$ … $$;` body — a construct PL/pgSQL has no
-- grammar for, so the body fails to PARSE. MEASURED on the lane 2026-09-04:
--   20260417031851_user_app_roles.sql:433  ERROR 42601 syntax error at or near "TO"
--   20260510173005_process_key_long_idempotency_drain.sql:397   (same error)
-- They are the second and third members of the class plan 164.4-00 booked as
-- `[REDUNDER-SAVEPOINT]` (the first is 20260416201929_audit_log_hardening.sql).
-- Editing a migration to work around it is forbidden — a migration is
-- production — so the lane substitutes for what each provided:
--   * 20260417031851 defines `public.current_user_has_app_role(TEXT[])`, which
--     the strategy_verifications_admin_select policy at 20260501055202:128 calls.
--     20-fixture-app-role-helper.sql carries the real body, not a `RETURN FALSE`
--     stub, precisely so the admin policy stays falsifiable — see that file.
--   * 20260510173005 creates the OLD single-column index. Its absence is the one
--     honest weakening this list carries: STEP 2 of 20260726000225
--     (`DROP INDEX IF EXISTS strategy_verifications_wizard_session_id_unique_idx`)
--     no-ops on the lane, so A5's baseline zero is "never created" rather than
--     "created then dropped". A5's twin therefore CREATES an index under that
--     name rather than neutering the DROP, and the arm is proven falsifiable
--     either way. Recorded, not papered over.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","supabase/migrations/20260501055202_strategy_verifications.sql","supabase/migrations/20260501055213_strategy_verifications_rls_polish.sql","supabase/migrations/20260510172738_strategy_verifications_state_machine.sql","supabase/migrations/20260726000225_strategy_verifications_tenant_scope_uniq.sql"]}

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- ON DELETE CASCADE chains auth.users -> profiles -> strategies ->
-- strategy_verifications, so deleting auth.users by email drops the whole
-- subtree. The two literal-id deletes ahead of it are belt-and-braces: they can
-- only ever match this file's own fixtures.
-- --------------------------------------------------------------------------
DELETE FROM strategy_verifications
  WHERE id IN (
    'aaaa0000-0000-4000-8000-000000000021',
    'bbbb0000-0000-4000-8000-000000000022'
  );

DELETE FROM strategies
  WHERE id IN (
    '5a5a5a5a-0000-4000-8000-000000000011',
    '5b5b5b5b-0000-4000-8000-000000000012'
  );

DELETE FROM auth.users
  WHERE email IN (
    'test-pyapi01-tenant-a@quantalyze.test',
    'test-pyapi01-tenant-b@quantalyze.test'
  );

BEGIN;

DO $$
DECLARE
  -- Literal fixtures. A1's expected outcome is pinned to these, never read
  -- back out of pg_index / the constraint under test.
  uid_a      UUID := 'a1a1a1a1-0000-4000-8000-000000000001';
  uid_b      UUID := 'b1b1b1b1-0000-4000-8000-000000000002';
  strat_a    UUID := '5a5a5a5a-0000-4000-8000-000000000011';
  strat_b    UUID := '5b5b5b5b-0000-4000-8000-000000000012';
  sv_a       UUID := 'aaaa0000-0000-4000-8000-000000000021';
  sv_b       UUID := 'bbbb0000-0000-4000-8000-000000000022';
  -- THE shared wizard_session_id. One value, two tenants, two strategies.
  wsid_w     UUID := '77777777-0000-4000-8000-0000000000ff';

  row_cnt    INTEGER;
  uniq_cnt   INTEGER;
  idx_cols   TEXT[];
  idx_name   TEXT;
  err_msg    TEXT;
  err_state  TEXT;
BEGIN
  -- ----- SEED (seeding/service-role context - bypasses RLS) ----------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-pyapi01-tenant-a@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'pyapi01 tenant a', 'test-pyapi01-tenant-a@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-pyapi01-tenant-b@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'pyapi01 tenant b', 'test-pyapi01-tenant-b@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  -- Two DIFFERENT strategies under two DIFFERENT owners. This is the tenancy
  -- axis: strategy_verifications has no user_id, so strategy_id IS the tenant
  -- key (strategies.user_id is what the owner RLS policy dereferences).
  INSERT INTO strategies (id, user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (strat_a, uid_a, 'pyapi01 tenant A strategy', 'draft', '{}', '{}', '{}', ARRAY['binance']);

  INSERT INTO strategies (id, user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (strat_b, uid_b, 'pyapi01 tenant B strategy', 'draft', '{}', '{}', '{}', ARRAY['binance']);

  RAISE NOTICE 'Seed OK: A uid=% strat=% | B uid=% strat=% | shared wizard_session_id=%',
    uid_a, strat_a, uid_b, strat_b, wsid_w;

  -- ======================================================================
  -- A1 - ECONOMIC ORACLE. Two tenants, two strategies, ONE wizard_session_id.
  -- Both inserts must succeed.
  -- ======================================================================
  -- Written as the production write path does it: the /process-key route
  -- inserts these rows through the SERVICE-ROLE client (services/db.py:71-76),
  -- which bypasses RLS. Uniqueness is enforced by an INDEX, not by RLS, so the
  -- role cannot mask or manufacture the result either way - it is set here only
  -- so the test mirrors the real caller.
  -- RED-UNDER: re-narrow STEP 1 of migration 20260726000225 to the single
  --            column it superseded — `ON strategy_verifications
  --            (wizard_session_id)`. That is literally the pre-PYAPI-01 shape,
  --            and it makes tenant B's insert raise 23505 on a value B never
  --            chose. LAYERED: the migration's own STEP 3(a) pins the column
  --            list against a literal array and would ABORT THE APPLY before
  --            the gate ran, so the second edit re-baselines that pin. It is
  --            the honest layering — a migration that shipped the narrow index
  --            would have shipped the matching assertion too.
  -- RED-UNDER-M: {"arm":"A1","apply":[{"kind":"edit","file":"supabase/migrations/20260726000225_strategy_verifications_tenant_scope_uniq.sql","find":"  ON strategy_verifications (strategy_id, wizard_session_id);","replace":"  ON strategy_verifications (wizard_session_id);","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260726000225_strategy_verifications_tenant_scope_uniq.sql","find":"ARRAY['strategy_id', 'wizard_session_id']::TEXT[]","replace":"ARRAY['wizard_session_id']::TEXT[]","occurrences":1}]}
  SET LOCAL ROLE service_role;

  INSERT INTO strategy_verifications
    (id, strategy_id, wizard_session_id, status, trust_tier, flow_type, source)
  VALUES
    (sv_a, strat_a, wsid_w, 'draft', 'api_verified', 'onboard', 'binance');

  BEGIN
    INSERT INTO strategy_verifications
      (id, strategy_id, wizard_session_id, status, trust_tier, flow_type, source)
    VALUES
      (sv_b, strat_b, wsid_w, 'draft', 'api_verified', 'onboard', 'binance');
  EXCEPTION WHEN OTHERS THEN
    err_msg := SQLERRM; err_state := SQLSTATE;
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (A1): tenant B could NOT create a verification for its OWN strategy % using wizard_session_id % because tenant A already used that id on strategy % (SQLSTATE %, %). The uniqueness constraint is NOT tenant-scoped - a caller-supplied wizard_session_id collides ACROSS tenants, which both rejects a legitimate insert AND makes the route hand tenant A''s verification row to tenant B (PYAPI-01 / C-08).',
      strat_b, wsid_w, strat_a, err_state, err_msg;
  END;

  RESET ROLE;

  -- Both rows must actually be there, each scoped to its literal fixture id.
  SELECT count(*) INTO row_cnt FROM strategy_verifications WHERE id = sv_a;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (A1): expected exactly 1 verification row for tenant A''s fixture id %, found %', sv_a, row_cnt;
  END IF;
  SELECT count(*) INTO row_cnt FROM strategy_verifications WHERE id = sv_b;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (A1): expected exactly 1 verification row for tenant B''s fixture id %, found %', sv_b, row_cnt;
  END IF;

  RAISE NOTICE 'A1 PASS: both tenants hold a verification row under the SAME wizard_session_id.';

  -- ======================================================================
  -- A2 - ISOLATION. Tenant B's authenticated session must not see tenant A's
  -- verification row. (Passes on the old schema too - the owner RLS policy was
  -- always correct. It is here because the leak has TWO layers and this file
  -- must pin the one that is right, or a future policy edit could open it.)
  -- ======================================================================
  -- RED-UNDER: drop the JOIN PREDICATE from strategy_verifications_owner_select
  --            in migration 20260501055213 — `WHERE s.id =
  --            strategy_verifications.strategy_id AND s.user_id = auth.uid()`
  --            becomes `WHERE s.user_id = auth.uid()`. The policy still LOOKS
  --            tenant-scoped and still mentions auth.uid(); it has simply
  --            stopped correlating the strategy to the row, so it evaluates
  --            TRUE for EVERY verification as soon as the reader owns any
  --            strategy at all. This is the exact brittleness the migration's
  --            own header worries about, and it is SILENT: no error, no log.
  --            The migration's STEP 3 self-check only COUNTS the policy by
  --            name, so it does not abort — no layering needed.
  -- RED-UNDER-M: {"arm":"A2","apply":[{"kind":"edit","file":"supabase/migrations/20260501055213_strategy_verifications_rls_polish.sql","find":"      WHERE s.id = strategy_verifications.strategy_id\n        AND s.user_id = auth.uid()","replace":"      WHERE s.user_id = auth.uid()","occurrences":1}]}
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO row_cnt FROM strategy_verifications WHERE id = sv_a;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (A2): tenant B sees % rows for tenant A''s verification id %, expected 0 - CROSS-TENANT LEAK', row_cnt, sv_a;
  END IF;

  -- ======================================================================
  -- A3 - POSITIVE CONTROL. Same session, B's OWN row must be visible. Without
  -- this, A2's zero could simply mean the session switch is broken and B sees
  -- nothing at all.
  -- ======================================================================
  -- RED-UNDER: point strategy_verifications_owner_select at a user id nobody
  --            holds — `AND s.user_id = auth.uid()` becomes `AND s.user_id =
  --            '00000000-0000-0000-0000-000000000000'::uuid` in migration
  --            20260501055213. The policy then matches NOTHING, so B sees zero
  --            of its own rows. ⚠️ Note which arm this reddens and which it
  --            does not: A2 above still passes (its expected value IS zero), so
  --            a total owner-read outage is invisible to A2 and this positive
  --            control is the ONLY arm that catches it. That asymmetry is
  --            exactly why A3 exists, and the mutation proves it rather than
  --            asserting it.
  -- RED-UNDER-M: {"arm":"A3","apply":[{"kind":"edit","file":"supabase/migrations/20260501055213_strategy_verifications_rls_polish.sql","find":"        AND s.user_id = auth.uid()","replace":"        AND s.user_id = '00000000-0000-0000-0000-000000000000'::uuid","occurrences":1}]}
  SELECT count(*) INTO row_cnt FROM strategy_verifications WHERE id = sv_b;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (A3): tenant B sees % rows for its OWN verification id %, expected 1 - session switch broken or owner-read regressed, so A2''s zero proves nothing', row_cnt, sv_b;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'A2/A3 PASS: tenant B sees 0 of A''s verification rows and 1 of its own.';

  -- ======================================================================
  -- A4 - DRIFT-PIN on the index SHAPE. Read the actual indexed columns from
  -- the catalog and compare against a LITERAL array.
  --
  -- The lookup is qualified to unique indexes that COVER wizard_session_id.
  -- strategy_verifications carries a SECOND unique index
  -- (strategy_verifications_public_token_unique_idx, migration
  -- 20260510172738:66-68), so an unqualified "the unique index on this table"
  -- query returns more than one row and a PL/pgSQL SELECT INTO would silently
  -- read whichever came first.
  -- ======================================================================
  -- RED-UNDER: SWAP the composite index's column order in STEP 1 of migration
  --            20260726000225 — `(strategy_id, wizard_session_id)` becomes
  --            `(wizard_session_id, strategy_id)`. Chosen deliberately over
  --            re-narrowing the index: a swap leaves uniqueness tenant-scoped,
  --            so A1 still PASSES and this drift-pin is the first failure,
  --            which is what proves A4 is not merely riding on A1. LAYERED for
  --            the same reason A1 is — STEP 3(a) pins the same list against a
  --            literal and would abort the apply.
  -- RED-UNDER-M: {"arm":"A4","apply":[{"kind":"edit","file":"supabase/migrations/20260726000225_strategy_verifications_tenant_scope_uniq.sql","find":"  ON strategy_verifications (strategy_id, wizard_session_id);","replace":"  ON strategy_verifications (wizard_session_id, strategy_id);","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260726000225_strategy_verifications_tenant_scope_uniq.sql","find":"ARRAY['strategy_id', 'wizard_session_id']::TEXT[]","replace":"ARRAY['wizard_session_id', 'strategy_id']::TEXT[]","occurrences":1}]}
  SELECT count(*) INTO uniq_cnt
    FROM pg_index i
    JOIN pg_class c  ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'strategy_verifications'
     AND i.indisunique
     AND EXISTS (
       SELECT 1 FROM unnest(i.indkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
       WHERE a.attname = 'wizard_session_id'
     );

  IF uniq_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (A4): expected exactly 1 unique index covering wizard_session_id on strategy_verifications, found %. More than one means the old single-column index was left in place alongside the new composite one - the old one still enforces GLOBAL uniqueness, so the tenant-scope fix is inert.', uniq_cnt;
  END IF;

  SELECT i.indexrelid::regclass::text,
         array_agg(a.attname ORDER BY k.ord)
    INTO idx_name, idx_cols
    FROM pg_index i
    JOIN pg_class c  ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE n.nspname = 'public'
     AND c.relname = 'strategy_verifications'
     AND i.indisunique
   GROUP BY i.indexrelid
  HAVING 'wizard_session_id' = ANY (array_agg(a.attname));

  IF idx_cols IS DISTINCT FROM ARRAY['strategy_id', 'wizard_session_id']::TEXT[] THEN
    RAISE EXCEPTION 'TEST FAILED (A4): the wizard-session unique index (%) covers columns %, expected exactly {strategy_id,wizard_session_id}. A single-column (wizard_session_id) index makes a caller-supplied id globally unique across tenants (PYAPI-01 / C-08); it supersedes the reasoning at migration 20260510173005:72-73.', idx_name, idx_cols;
  END IF;

  -- ======================================================================
  -- A5 - DRIFT-PIN on the OLD index NAME. Belt to A4's braces: catches a
  -- migration that creates the composite index but forgets to drop the old
  -- one under a name A4's column check would not distinguish.
  -- ======================================================================
  -- RED-UNDER: bring an index back under the old NAME on the live database —
  --            `CREATE INDEX strategy_verifications_wizard_session_id_unique_idx
  --            ON public.strategy_verifications (wizard_session_id)`.
  --            ⚠️ Read why this is a `sql` step and NOT "neuter STEP 2's DROP".
  --            Neutering the DROP requires the old index to exist, which on the
  --            pg-lane it never does: the migration that creates it,
  --            20260510173005, cannot apply here at all (see the header's
  --            [REDUNDER-SAVEPOINT] note), so STEP 2's `DROP INDEX IF EXISTS`
  --            no-ops. And the FAITHFUL old index — UNIQUE on
  --            (wizard_session_id) — would redden A1 with 23505 long before
  --            reaching here, so it could never be A5's own first failure. A
  --            NON-unique index under the old name is precisely what A5
  --            asserts about and nothing more: A1 sees no collision, A4's two
  --            queries both filter on `i.indisunique` and still count 1, and
  --            A5's pg_indexes NAME lookup is the first thing that fails.
  -- RED-UNDER-M: {"arm":"A5","apply":[{"kind":"sql","stmt":"CREATE INDEX strategy_verifications_wizard_session_id_unique_idx ON public.strategy_verifications (wizard_session_id)"}]}
  SELECT count(*) INTO row_cnt FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename  = 'strategy_verifications'
     AND indexname  = 'strategy_verifications_wizard_session_id_unique_idx';
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (A5): the old single-column index strategy_verifications_wizard_session_id_unique_idx is STILL PRESENT (% rows in pg_indexes). It enforces global uniqueness on wizard_session_id regardless of the new composite index, so the cross-tenant collision is unfixed.', row_cnt;
  END IF;

  RAISE NOTICE 'A4/A5 PASS: index is % over {strategy_id,wizard_session_id}; old single-column index absent.', idx_name;

  RAISE NOTICE 'test_strategy_verifications_wizard_session_tenant_scope: ALL PASS (tenant-scoped wizard_session_id uniqueness + cross-tenant read isolation intact).';
END
$$;

ROLLBACK;
