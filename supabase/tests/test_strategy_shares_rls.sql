-- Test for migration 20260827120000_strategy_shares_generation_model.sql —
-- the strategy_shares owner RLS, grant layering, and the generation-counter
-- state machine. Phase 164 / Plan 164-02 (SHARE-01, SHARE-03).
--
-- ⛔⛔ THIS FILE IS EXPECTED **RED** UNTIL THE MIGRATION IS HAND-APPLIED TO THE
-- TEST PROJECT. THAT IS THE DESIGN. DO NOT "FIX" IT.
-- ---------------------------------------------------------------------------
-- SKIP-01 (164-CONTEXT.md, and root TODOS.md): **nothing applies migrations to
-- the TEST database.** The `sql-tests` CI job has no apply step and every
-- migration-touching workflow targets PROD. So a self-check written with a
-- pre-apply tolerance arm — `IF to_regclass('public.strategy_shares') IS NULL
-- THEN RAISE NOTICE 'SKIP: not applied here'; RETURN; END IF;` — would take the
-- skip arm FOREVER, and "SKIP" is byte-indistinguishable from "PASS" in the
-- only channel anyone reads. The deployed body would then be tested nowhere,
-- which is exactly the defect SKIP-01 names.
--
-- Therefore this file has **NO tolerance arm at all**. Before the hand-apply it
-- fails at the first reference to `strategy_shares` with 42P01 (undefined_table)
-- and, under `psql -v ON_ERROR_STOP=1`, takes the whole job down. Its GREEN is
-- reachable ONLY through the hand-apply — which is precisely what stops the
-- gate from going dark. Sequence (the 164-02 blocking checkpoint owns it):
--   1. three reviewers over the migration — migration-reviewer,
--      rls-policy-auditor, silent-failure-hunter;
--   2. hand-apply BOTH migrations to the TEST project, IN ORDER:
--        20260827120000_strategy_shares_generation_model.sql          (table+RPCs)
--        20260827130000_sanitize_user_revoke_strategy_shares.sql      (GDPR arm)
--      ⛔ The second references the table the first creates; applying it alone
--      fails, and applying only the first leaves the SANITIZE block below RED —
--      correctly, because B1 would still be open.
--   3. this file goes green in `sql-tests`;
--   4. merge to main — at which point the Supabase Migrate workflow applies the
--      same migrations to PRODUCTION automatically.
--
-- ⚠️ ANTI-VACUITY DEMONSTRATIONS ARE OWED AT STEP 2, NOT BEFORE IT. The
-- neuter -> observe-RED -> restore ritual this repo requires cannot run against
-- a database where the objects do not exist, and nothing applies migrations to
-- TEST before the hand-apply. The arms below were instead demonstrated against
-- a THROWAWAY local PostgreSQL 16 replica of this schema (results recorded in
-- the fix commit message); re-run the same neuters against TEST once step 2
-- lands. Arms whose neuter must be re-observed there: TENANT 3, TENANT 5,
-- ANON 1b, SERVICE-ROLE 2, SANITIZE 1, SHAPE 3, SHAPE 5, TRIGGER 1, TRIGGER 2,
-- TRIGGER 3, TRIGGER 4, SERVICE-ROLE 0-acl, and the three `-grant` message arms
-- (ANON 1c-grant,
-- ANON 1d-grant, SERVICE-ROLE 1-grant).
--
-- WHAT THIS FILE ASSERTS (content-by-field; a 200 / a row count proves nothing)
-- ---------------------------------------------------------------------------
--   * SHAPE  — the column set is EXACTLY the six DDL columns, so no
--     token/token_hash/secret column has appeared at rest (D-02, T-164-07);
--     both RPCs are SECURITY INVOKER with no PUBLIC EXECUTE; `authenticated`
--     holds EXACTLY {INSERT, SELECT, UPDATE} (so DELETE **and TRUNCATE**, which
--     is exempt from RLS, are both closed); and both RPC bodies still carry the
--     `auth.uid() IS NULL` fail-loud plus revoke's own `created_by = auth.uid()`
--     predicate.
--   * ANON   — blocked at BOTH layers: the grant layer (42501 on select and on
--     RPC execute) AND, independently, the policy layer (0 rows even when
--     SELECT is temporarily granted inside this rolled-back transaction).
--   * SERVICE-ROLE — blocked at BOTH layers too, and this one matters because
--     service_role is BYPASSRLS and the recipient lane already reads this table
--     through `createAdminClient()`: no EXECUTE grant (layer 1), AND the body
--     raises `insufficient_privilege` even when EXECUTE is temporarily granted
--     (layer 2). Without layer 2 a single future `GRANT EXECUTE ... TO
--     service_role` would hand a BYPASSRLS caller the whole table.
--   * TENANT — the CR-01 owner-coherence WITH CHECK clause rejects an
--     authenticated user minting a share for ANOTHER tenant's strategy, via
--     the RPC and via a raw table INSERT; a forged `created_by` is rejected on
--     a strategy the caller DOES own (so only that half of WITH CHECK can do
--     the rejecting); and the `ON CONFLICT DO UPDATE` path is exercised
--     separately against a tenant's EXISTING row, because that path is gated by
--     the policy's USING clause rather than its WITH CHECK. A cross-tenant read
--     returns 0 rows and a cross-tenant revoke affects 0 rows without
--     disturbing the victim's counter.
--   * SANITIZE — a GDPR Art. 17 erasure REVOKES every live share row the
--     subject created (revoked_at stamped, generation advanced by exactly 1),
--     retains the row rather than deleting it, and leaves other tenants' rows
--     untouched. sanitize_user ANONYMIZES rather than deletes, so NEITHER
--     ON DELETE CASCADE FK fires and this arm is the only thing that kills the
--     subject's links (companion migration 20260827130000).
--   * REVOKE — one call stamps revoked_at AND advances generation by EXACTLY 1;
--     a second call affects 0 rows and does NOT inflate the counter further
--     (convergence, SHARE-03).
--   * REUSE  — a second mint while the share is live returns the SAME
--     generation and creates NO second row (SHARE-01: Copy Link is idempotent
--     and never breaks the recipient's url).
--   * REACTIVATION — minting on a revoked row clears revoked_at, returns the
--     ADVANCED generation (never rewinds to 1, so revoked links stay dead), and
--     leaves created_by / created_at untouched.
--   * MONOTONICITY — generation never decreases across the full
--     mint -> reuse -> revoke -> revoke -> re-mint -> revoke cycle.
--   * TRIGGER — and, separately, that the row-level invariants hold for RAW
--     TABLE WRITES and not merely for the two RPCs. ⛔ The MONOTONICITY arms
--     drive the cycle THROUGH the RPCs, which are the only writers that behave
--     monotonically by construction, so they stay GREEN with no trigger
--     installed at all. The owner holds a column-unrestricted UPDATE grant and
--     the FOR ALL policy admits their own row, so a raw PATCH rewinding
--     `generation` and clearing `revoked_at` was ACCEPTED (MEASURED,
--     PostgreSQL 16) — resurrecting every link they had revoked. TRIGGER 1
--     pins that a revocation must ADVANCE the counter; TRIGGER 2 pins that the
--     counter can never be rewound; TRIGGER 3 pins that the counter cannot be
--     RE-POINTED at another strategy the same owner holds, which reaches the
--     identical end state in TWO requests without writing the counter at all;
--     TRIGGER 4 pins that id/created_by/created_at cannot be rewritten, so the
--     provenance of a live capability grant is not forgeable; SHAPE 5 pins the
--     trigger's timing/level.
--   * NO HARD DELETE — `authenticated` has no DELETE grant, so a client cannot
--     discard the counter and resurrect already-revoked tokens.
--
-- Every arm above is a NEGATIVE or an EXACT-VALUE assertion, because both RLS
-- and a grant FAIL SILENTLY: a loosened USING, a dropped EXISTS clause, or a
-- revoke that forgets the increment all ship GREEN unless something inspects
-- the resulting CONTENT. Positive controls are included (the owner CAN mint,
-- CAN reuse, CAN revoke) so a policy that blocks every client write cannot pass
-- the negative arms vacuously.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands (the
-- sql-tests preflight rejects shell-out / copy / output redirection). Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. The filename matches the
-- `test_*.sql` glob so the job auto-discovers it.
--
-- Hygiene: all fixture work runs inside an explicit transaction that ends in
-- ROLLBACK, so the shared test DB is never polluted. The exception-trapped arms
-- use nested BEGIN ... EXCEPTION (an implicit savepoint) so a deliberately
-- failing statement does not abort the outer block. The GRANTs this file issues
-- (the layer-2 anon proof and the layer-2 service_role proof) are each
-- explicitly reverted, re-checked against the catalog afterwards, AND covered
-- by the ROLLBACK.
--
-- ⚠️ ORDERING IS LOAD-BEARING in three places, each marked at its site:
--   1. `strat_a2` must never be shared — ANON 1b needs a strategy_id with no
--      share row so UNIQUE(strategy_id) cannot pre-empt the privilege check.
--   2. TENANT 5 seeds tenant B's share row and must stay AFTER TENANT 1-4;
--      seeding it earlier pushes TENANT 1 onto the ON CONFLICT path and makes
--      it stop proving the CR-01 EXISTS clause.
--   3. SANITIZE 1 runs LAST — it anonymizes tenant A's profile and strategies
--      and bans the auth user, so every arm that needs A intact must precede
--      it.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_strategy_shares_rls.sql

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- ON DELETE CASCADE chains auth.users -> profiles -> strategies ->
-- strategy_shares, so deleting auth.users by email drops the whole subtree.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-strategy-shares-owner-a@quantalyze.test',
    'test-strategy-shares-owner-b@quantalyze.test'
  );

BEGIN;

DO $$
DECLARE
  uid_a        UUID := gen_random_uuid();
  uid_b        UUID := gen_random_uuid();
  strat_a      UUID;
  strat_a2     UUID;
  strat_b      UUID;
  gen_mint     INTEGER;
  gen_reuse    INTEGER;
  gen_revoked  INTEGER;
  gen_remint   INTEGER;
  gen_final    INTEGER;
  gen_seen     INTEGER[] := '{}';
  affected     INTEGER;
  row_cnt      INTEGER;
  raised       BOOLEAN;
  err_msg      TEXT;
  seed_by      UUID;
  seed_at      TIMESTAMPTZ;
  now_by       UUID;
  now_at       TIMESTAMPTZ;
  now_revoked  TIMESTAMPTZ;
  v_cols       TEXT;
  v_secdef     BOOLEAN;
  v_privs      TEXT[];
  v_create_s   TEXT;
  v_revoke_s   TEXT;
  gen_b        INTEGER;
  gen_b_after  INTEGER;
  b_by         UUID;
  b_revoked    TIMESTAMPTZ;
  gen_pre_san  INTEGER;
  san_ok       BOOLEAN;
  gen_probe    INTEGER;
  i            INTEGER;
BEGIN
  -- ----- SEED (seeding/service-role context — bypasses RLS) ---------------
  -- Both strategies are status='private': an unpublished strategy is the ONLY
  -- case this token lane exists for (a published one keeps /factsheet/<id>
  -- ?share=1 and needs no capability token — D-09).
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-strategy-shares-owner-a@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'strategy-shares owner a', 'test-strategy-shares-owner-a@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'strategy-shares A strategy', 'private', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a;

  -- A SECOND strategy owned by A that is NEVER shared. Required by ANON 1b: an
  -- anon INSERT probe must target a strategy_id with NO existing share row, or
  -- the UNIQUE(strategy_id) constraint can raise 23505 BEFORE the privilege
  -- check is ever reached and the arm passes on the wrong error. ⛔ Nothing
  -- below may mint a share for this strategy.
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'strategy-shares A never-shared strategy', 'private', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a2;

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-strategy-shares-owner-b@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'strategy-shares owner b', 'test-strategy-shares-owner-b@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_b, 'strategy-shares B strategy', 'private', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_b;

  RAISE NOTICE 'Seed OK: A uid=% strat=% (never-shared %), B uid=% strat=%',
    uid_a, strat_a, strat_a2, uid_b, strat_b;

  -- ======================================================================
  -- SHAPE 1: NO TOKEN AT REST (D-02 / T-164-07)
  -- ======================================================================
  -- The single most important property of this table is a NEGATIVE one: it
  -- holds no secret. Pin the column set EXACTLY — a future ALTER adding
  -- `token`, `token_hash`, `secret` or any sibling reintroduces precisely the
  -- disclosure surface D-02 rejected, and nothing else in the stack would
  -- notice. An `expected >= 6 columns` style assertion would NOT catch that;
  -- only an exact set does.
  --
  -- Read from pg_attribute, NOT information_schema.columns: that view is
  -- PRIVILEGE-FILTERED (it lists only columns the current role holds some
  -- privilege on), so under a less-privileged session it silently returns a
  -- SHORT list and this arm would report "a column vanished" when the truth is
  -- "you cannot see it". pg_attribute is the authoritative catalog and is not
  -- filtered — the assertion then measures the SCHEMA, not the session.
  SELECT string_agg(a.attname, ',' ORDER BY a.attname) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.strategy_shares'::regclass
     AND a.attnum > 0
     AND NOT a.attisdropped;
  IF v_cols IS DISTINCT FROM 'created_at,created_by,generation,id,revoked_at,strategy_id' THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 1): strategy_shares columns are "%", expected exactly "created_at,created_by,generation,id,revoked_at,strategy_id". ⛔ D-02: this table must NEVER hold a token, raw or hashed — a leak must yield only a uuid, an int and timestamps.', v_cols;
  END IF;

  -- ======================================================================
  -- SHAPE 2: both RPCs are SECURITY INVOKER, and PUBLIC has no EXECUTE
  -- ======================================================================
  -- INVOKER is load-bearing: RLS is the ONLY cross-tenant wall on this surface
  -- (there is no SECURITY DEFINER reader in this design), so a DEFINER body
  -- would bypass the CR-01 owner-coherence WITH CHECK entirely.
  FOR v_secdef IN
    SELECT p.prosecdef
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('create_strategy_share', 'revoke_strategy_share')
  LOOP
    IF v_secdef THEN
      RAISE EXCEPTION 'TEST FAILED (SHAPE 2a): a strategy-share RPC is SECURITY DEFINER — it would bypass strategy_shares_owner, the only cross-tenant wall on this surface';
    END IF;
  END LOOP;

  SELECT count(*) INTO row_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('create_strategy_share', 'revoke_strategy_share');
  IF row_cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 2b): expected 2 strategy-share RPCs in public, found % — the SECURITY INVOKER loop above would be VACUOUS with 0', row_cnt;
  END IF;

  -- Grant-drift detector: a later manual GRANT to PUBLIC on either RPC is
  -- caught here, not only at the migration's own apply-time self-verify.
  PERFORM public._assert_no_public_execute('public.create_strategy_share(uuid)');
  PERFORM public._assert_no_public_execute('public.revoke_strategy_share(uuid)');

  -- ======================================================================
  -- SHAPE 3: `authenticated` holds EXACTLY {INSERT, SELECT, UPDATE}
  -- ======================================================================
  -- ⛔ The posture must be POSITIVE-ONLY. Revoking DELETE by name (the original
  -- migration's approach) leaves the rest of Supabase's inherited GRANT ALL
  -- standing — including TRUNCATE, which is **EXEMPT FROM RLS**. One
  -- `TRUNCATE strategy_shares` from any authenticated session would discard
  -- EVERY tenant's counter at once, and every revoked link in the system would
  -- come back to life at generation 1. No policy on this table can stop a
  -- TRUNCATE, so only the absent grant can.
  --
  -- Asserting the EXACT set (rather than "DELETE is absent") is what makes the
  -- arm complete: it catches TRUNCATE, REFERENCES and TRIGGER, and it catches
  -- the next privilege Postgres adds, none of which an enumeration of
  -- forbidden names ever would.
  --
  -- Read via aclexplode(pg_class.relacl), NOT information_schema.role_table_grants:
  -- that view is privilege-filtered and can under-report, which for an
  -- EXACT-SET assertion means a false GREEN direction is impossible but a
  -- confusing false RED is — and relacl removes the ambiguity entirely. Every
  -- ACL arm in this file now reads relacl/proacl for that reason (SHAPE 3,
  -- ANON 2b, SERVICE-ROLE 0-acl, SERVICE-ROLE 2e).
  SELECT array_agg(DISTINCT acl.privilege_type ORDER BY acl.privilege_type)
    INTO v_privs
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
   WHERE c.oid = 'public.strategy_shares'::regclass
     AND r.rolname = 'authenticated';
  IF v_privs IS DISTINCT FROM ARRAY['INSERT', 'SELECT', 'UPDATE']::TEXT[] THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 3): `authenticated` holds privilege set % on strategy_shares, expected exactly {INSERT,SELECT,UPDATE}. DELETE lets one tenant discard their counter and resurrect their own revoked tokens; TRUNCATE — EXEMPT FROM RLS — does it for EVERY tenant at once. Migration 20260827120000 STEP 2 must REVOKE ALL then GRANT the positive set.', COALESCE(v_privs::TEXT, '(none)');
  END IF;

  -- ======================================================================
  -- SHAPE 4: both RPCs refuse an unauthenticated caller, and revoke carries
  --          its own ownership predicate
  -- ======================================================================
  -- These two properties are the ONLY thing standing between a BYPASSRLS role
  -- and this table, and neither is reachable behaviourally while the other
  -- holds — so they are pinned STRUCTURALLY here and BEHAVIOURALLY in the
  -- SERVICE-ROLE block below. `revoke_strategy_share` without
  -- `created_by = auth.uid()` is an unauthenticated cross-tenant kill switch
  -- that returns 1 and reads as success.
  --
  -- ⛔ Probe the COMMENT-STRIPPED body. pg_get_functiondef returns in-body
  -- comments verbatim, and both bodies discuss these guards at length in prose
  -- — an unstripped regex would be satisfied by the COMMENT ALONE and would
  -- stay green with the statement deleted.
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') INTO v_create_s
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_strategy_share'
     AND pg_get_function_identity_arguments(p.oid) = 'p_strategy_id uuid';
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') INTO v_revoke_s
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'revoke_strategy_share'
     AND pg_get_function_identity_arguments(p.oid) = 'p_strategy_id uuid';
  IF v_create_s IS NULL OR v_revoke_s IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 4a): a share RPC body could not be read (create: %, revoke: %) — the two regex arms below would be VACUOUSLY true on NULL', (v_create_s IS NOT NULL), (v_revoke_s IS NOT NULL);
  END IF;
  IF v_create_s !~* 'auth\.uid\s*\(\s*\)\s+IS\s+NULL'
     OR v_revoke_s !~* 'auth\.uid\s*\(\s*\)\s+IS\s+NULL' THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 4b): a strategy-share RPC lost its `auth.uid() IS NULL` fail-loud guard. RLS does not apply to a BYPASSRLS role, and this feature''s recipient lane already reads this table through createAdminClient() (service_role) — so for that caller this guard is the FIRST wall, not a redundant one. MEASURED without it: revoke revokes ANOTHER TENANT''S live share and returns 1; create degrades to an opaque 23502 on created_by, whose NOT NULL is the only (incidental) thing stopping an ON CONFLICT reactivation of someone else''s revoked share.';
  END IF;
  IF v_revoke_s !~* 'created_by\s*=\s*auth\.uid\s*\(\s*\)' THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 4c): revoke_strategy_share lost the `created_by = auth.uid()` predicate on its UPDATE — for any BYPASSRLS caller the statement would revoke ANY tenant''s share and report success';
  END IF;

  -- ======================================================================
  -- SHAPE 5: the monotonicity trigger exists, BEFORE UPDATE, FOR EACH ROW
  -- ======================================================================
  -- Structural companion to the behavioural TRIGGER 1 / TRIGGER 2 arms below.
  -- It is not redundant with them: those two also go RED if the trigger is
  -- merely DROPPED, but they cannot distinguish a correct trigger from one
  -- re-created with the wrong timing or level, and both miscreations silently
  -- stop guarding:
  --   * AFTER instead of BEFORE — it still raises, but any AFTER trigger
  --     ordered ahead of it has already observed the rewound row;
  --   * STATEMENT instead of ROW — OLD/NEW do not exist, so the body becomes a
  --     runtime error on EVERY update rather than a guard on the bad ones.
  -- tgtype bit 0 = ROW, bit 1 = BEFORE, bit 4 = UPDATE.
  SELECT count(*) INTO row_cnt
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.strategy_shares'::regclass
     AND NOT t.tgisinternal
     AND t.tgname = 'strategy_shares_monotonic_generation'
     AND (t.tgtype & 1) = 1
     AND (t.tgtype & 2) = 2
     AND (t.tgtype & 16) = 16;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 5): expected exactly 1 BEFORE UPDATE FOR EACH ROW trigger named strategy_shares_monotonic_generation on strategy_shares, found %. Without it the owner''s column-unrestricted UPDATE grant plus the FOR ALL policy let a raw PATCH rewind the counter — MEASURED (PostgreSQL 16): generation went 2 -> 1 and revoked_at was cleared in ONE request, resurrecting every link the owner had revoked. ⛔ A trigger is also the ONLY control on this table that binds service_role, which BYPASSRLS exempts from every policy here.', row_cnt;
  END IF;

  -- ======================================================================
  -- OWNER 1: positive control — the owner CAN mint, and the first mint is gen 1
  -- ======================================================================
  -- Without a positive control, a policy of `WITH CHECK (false)` would satisfy
  -- every negative arm below while breaking the entire feature.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT public.create_strategy_share(strat_a) INTO gen_mint;
  IF gen_mint IS NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (OWNER 1a): create_strategy_share returned NULL — the owner could not mint their own share';
  END IF;
  IF gen_mint <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (OWNER 1b): first mint returned generation %, expected 1 (the DEFAULT)', gen_mint;
  END IF;
  gen_seen := gen_seen || gen_mint;

  -- ======================================================================
  -- OWNER 2: REUSE (SHARE-01) — minting again while live is idempotent
  -- ======================================================================
  -- This is the requirement the whole generation model exists to satisfy. A
  -- verbatim port of the scenario spine (hash-at-rest + unconditional
  -- pre-revoke on mint) would return a DIFFERENT value here and silently kill
  -- the recipient's existing link — the founder-hit defect.
  SELECT public.create_strategy_share(strat_a) INTO gen_reuse;
  IF gen_reuse <> gen_mint THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (OWNER 2a): re-minting a LIVE share returned generation % but the first mint returned % — Copy Link would hand out a different url and break the recipient''s existing link (SHARE-01 reuse)', gen_reuse, gen_mint;
  END IF;
  gen_seen := gen_seen || gen_reuse;

  SELECT count(*) INTO row_cnt FROM strategy_shares WHERE strategy_id = strat_a;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (OWNER 2b): % share rows exist for one strategy, expected exactly 1 — the FULL UNIQUE(strategy_id) is missing or was weakened to a partial index', row_cnt;
  END IF;

  SELECT created_by, created_at INTO seed_by, seed_at
    FROM strategy_shares WHERE strategy_id = strat_a;
  IF seed_by <> uid_a THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (OWNER 2c): created_by is % but the caller was % — created_by must come from auth.uid() inside the RPC, never a parameter', seed_by, uid_a;
  END IF;

  -- ======================================================================
  -- TENANT 1: CR-01 owner-coherence — via the RPC
  -- ======================================================================
  -- A (authenticated) tries to mint a share for B's strategy. created_by =
  -- auth.uid() holds, so ONLY the EXISTS clause can reject it. If that clause
  -- is ever dropped, this succeeds and A owns a working capability URL to B's
  -- private factsheet.
  raised := FALSE;
  BEGIN
    PERFORM public.create_strategy_share(strat_b);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 1a): tenant A minted a share for tenant B''s strategy — the CR-01 owner-coherence EXISTS clause in strategy_shares_owner WITH CHECK is MISSING or LOOSENED. This is a working share link to another tenant''s private factsheet.';
  END IF;
  IF err_msg NOT LIKE '%row-level security%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 1b): the cross-tenant mint was blocked by something OTHER than RLS (got: %) — the WITH CHECK clause is not independently proven', err_msg;
  END IF;

  -- ======================================================================
  -- TENANT 2: CR-01 owner-coherence — via a RAW table INSERT
  -- ======================================================================
  -- Same rejection without the RPC in the way, so the arm pins the POLICY and
  -- not the function body. A future route that upserts the table directly
  -- (instead of calling the RPC) is covered by this arm and by nothing else.
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_shares (strategy_id, created_by) VALUES (strat_b, uid_a);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 2a): a raw INSERT bound tenant B''s strategy to a tenant-A-owned share row — the CR-01 EXISTS clause is missing from WITH CHECK';
  END IF;
  IF err_msg NOT LIKE '%row-level security%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 2b): the raw cross-tenant INSERT was blocked by something other than RLS (got: %)', err_msg;
  END IF;

  -- ======================================================================
  -- TENANT 3: forged created_by is rejected
  -- ======================================================================
  -- ⛔ THE STRATEGY ID MUST BE **A's**, NOT B's. This arm previously inserted
  -- (strat_b, uid_b), which BOTH halves of WITH CHECK reject — the EXISTS half
  -- because A does not own strat_b, and the created_by half because uid_b is
  -- not auth.uid(). It therefore stayed GREEN with the `created_by = auth.uid()`
  -- half — the very clause its failure message names — DELETED. Using strat_a
  -- (which A DOES own) satisfies the EXISTS half, so only the created_by half
  -- can do the rejecting and the arm finally measures what it claims.
  --
  -- The `row-level security` message assertion is what keeps it honest even
  -- though strat_a already HAS a share row: with the created_by half deleted
  -- the INSERT would get as far as the UNIQUE(strategy_id) index and raise
  -- 23505, and a bare `raised := TRUE` would swallow that as a pass. Postgres
  -- evaluates RLS WITH CHECK (ExecWithCheckOptions) BEFORE index insertion, so
  -- while the clause is present the error is RLS and this arm is exact.
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_shares (strategy_id, created_by) VALUES (strat_a, uid_b);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 3a): tenant A wrote a share row with created_by = tenant B — the `created_by = auth.uid()` half of WITH CHECK is missing';
  END IF;
  IF err_msg NOT LIKE '%row-level security%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 3b): the forged-created_by INSERT was blocked by something OTHER than RLS (got: %) — most likely the UNIQUE(strategy_id) index raising 23505, which means the `created_by = auth.uid()` half of WITH CHECK is NOT independently proven', err_msg;
  END IF;

  -- ======================================================================
  -- NO-DELETE 1: authenticated has no DELETE grant (token-resurrection guard)
  -- ======================================================================
  -- The policy is FOR ALL, so RLS itself would happily let the owner delete
  -- their OWN row. Only the missing grant stops it, so this arm must pin
  -- `insufficient_privilege` (42501) specifically: a DELETE matching 0 rows
  -- raises nothing at all, and catching WHEN OTHERS would let an unrelated
  -- error satisfy the arm. Why it matters: a delete discards the counter, the
  -- next mint inserts a fresh row at generation 1, and every token the owner
  -- explicitly REVOKED at generation 1 starts working again.
  raised := FALSE;
  BEGIN
    DELETE FROM strategy_shares WHERE strategy_id = strat_a;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (NO-DELETE 1): `authenticated` could DELETE a share row — the counter can be discarded and re-minted at generation 1, RESURRECTING every revoked link. The `REVOKE DELETE ON strategy_shares FROM authenticated` in migration 20260827120000 is missing or was re-granted.';
  END IF;

  -- ======================================================================
  -- REVOKE 1: immediacy — revoked_at stamped AND generation +1, atomically
  -- ======================================================================
  SELECT public.revoke_strategy_share(strat_a) INTO affected;
  IF affected <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (REVOKE 1a): revoke_strategy_share affected % rows, expected 1 (a live share existed)', affected;
  END IF;

  SELECT revoked_at, generation INTO now_revoked, gen_revoked
    FROM strategy_shares WHERE strategy_id = strat_a;
  IF now_revoked IS NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (REVOKE 1b): revoked_at is still NULL after revoke — the tombstone was not stamped';
  END IF;
  IF gen_revoked <> gen_mint + 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (REVOKE 1c): generation is % after one revoke, expected % (exactly +1). If it is UNCHANGED the revoke is COSMETIC — revoked_at is set but the token still derives from the same counter, so every previously-copied link KEEPS WORKING (SHARE-03 defeated).', gen_revoked, gen_mint + 1;
  END IF;
  gen_seen := gen_seen || gen_revoked;

  -- ======================================================================
  -- REVOKE 2: convergence — a second revoke affects 0 rows and does NOT bump
  -- ======================================================================
  -- 0 rows is SUCCESS, not failure: the caller's intent ("this link must be
  -- dead") is already satisfied. The route maps it to a 404 so it is not an
  -- existence oracle. And the counter must NOT keep inflating, or a retry loop
  -- would silently burn generations.
  SELECT public.revoke_strategy_share(strat_a) INTO affected;
  IF affected <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (REVOKE 2a): a second revoke affected % rows, expected 0 — the `revoked_at IS NULL` predicate is missing, so double-revoke does not converge', affected;
  END IF;
  SELECT generation INTO gen_final FROM strategy_shares WHERE strategy_id = strat_a;
  IF gen_final <> gen_revoked THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (REVOKE 2b): a no-op revoke moved generation from % to % — the UPDATE is not restricted to live rows', gen_revoked, gen_final;
  END IF;
  gen_seen := gen_seen || gen_final;

  -- ======================================================================
  -- REACTIVATE 1: re-share returns the ADVANCED generation (old links stay dead)
  -- ======================================================================
  SELECT public.create_strategy_share(strat_a) INTO gen_remint;
  IF gen_remint = gen_mint THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (REACTIVATE 1a): re-sharing returned generation % — the SAME value as the pre-revoke mint. The counter was REWOUND, so every link the owner revoked is live again.', gen_remint;
  END IF;
  IF gen_remint <> gen_revoked THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (REACTIVATE 1b): re-sharing returned generation %, expected % (the already-advanced value). Reactivation must reuse the counter, never reset or double-bump it.', gen_remint, gen_revoked;
  END IF;
  gen_seen := gen_seen || gen_remint;

  SELECT created_by, created_at, revoked_at INTO now_by, now_at, now_revoked
    FROM strategy_shares WHERE strategy_id = strat_a;
  IF now_revoked IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (REACTIVATE 1c): revoked_at is still set after re-sharing — the share is not live and the recipient would get a 410';
  END IF;
  IF now_by <> seed_by THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (REACTIVATE 1d): created_by changed from % to % on reactivation — provenance must be preserved (ON CONFLICT DO UPDATE must not touch it)', seed_by, now_by;
  END IF;
  IF now_at <> seed_at THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (REACTIVATE 1e): created_at changed from % to % on reactivation — provenance must be preserved (ON CONFLICT DO UPDATE must not touch it)', seed_at, now_at;
  END IF;

  SELECT count(*) INTO row_cnt FROM strategy_shares WHERE strategy_id = strat_a;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (REACTIVATE 1f): reactivation produced % rows for one strategy, expected 1 (in-place UPDATE, not a second row)', row_cnt;
  END IF;

  -- ======================================================================
  -- TRIGGER 1: a revocation that does NOT advance the counter is refused
  -- ======================================================================
  -- ⛔ Run against a LIVE row — this is the only window in the file where
  -- strat_a is live (reactivated above, revoked again by MONOTONIC 1a below),
  -- and the rule under test only fires on the revoked_at NULL -> NOT NULL
  -- transition. Moving this block loses the arm silently.
  --
  -- WHY THE RULE EXISTS. Stamping revoked_at alone LOOKS fail-safe: the row
  -- drops out of the recipient lane's active scan and the link 410s. But the
  -- counter never moved, so the next create_strategy_share() clears the
  -- tombstone at the SAME generation and the "revoked" token resolves again.
  -- Making every revocation advance the counter is what lets reactivation stay
  -- unconstrained — it guarantees no revoked row can ever be returned to a
  -- generation that was live before it.
  raised := FALSE;
  BEGIN
    UPDATE strategy_shares SET revoked_at = now() WHERE strategy_id = strat_a;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 1a): the owner stamped revoked_at by raw UPDATE without advancing generation. That revocation is COSMETIC — the link only disappears from the active scan, and the next create_strategy_share() clears the tombstone at the same generation and brings the supposedly-revoked token back to life. The strategy_shares_monotonic_generation trigger is missing its revocation-must-advance rule.';
  END IF;
  -- Message-pinned, not just `raised`: an ordinary owner holds UPDATE on this
  -- table and this row passes both halves of WITH CHECK, so with the rule gone
  -- the statement SUCCEEDS rather than failing differently — but if some future
  -- change makes it fail for an unrelated reason (a lost grant, a policy
  -- rewrite) a bare `raised` would report the guard as present when it is not.
  IF err_msg NOT LIKE '%revocation must ADVANCE generation%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 1b): the no-bump revocation was rejected by something OTHER than the monotonicity trigger (got: %) — this arm proves nothing about the trigger unless the rejection came FROM it', err_msg;
  END IF;

  -- A rejection that still wrote is a successful attack wearing an error.
  SELECT generation, revoked_at INTO gen_probe, now_revoked
    FROM strategy_shares WHERE strategy_id = strat_a;
  IF gen_probe <> gen_remint OR now_revoked IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 1c): the rejected no-bump revocation still mutated the row (generation % -> %, revoked_at now %) — a BEFORE trigger that raises must leave the tuple untouched', gen_remint, gen_probe, now_revoked;
  END IF;

  -- ======================================================================
  -- MONOTONICITY: generation never decreases across the whole cycle
  -- ======================================================================
  SELECT public.revoke_strategy_share(strat_a) INTO affected;
  IF affected <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (MONOTONIC 1a): revoking the reactivated share affected % rows, expected 1', affected;
  END IF;
  SELECT generation INTO gen_final FROM strategy_shares WHERE strategy_id = strat_a;
  gen_seen := gen_seen || gen_final;

  -- Observed sequence must be mint, reuse, revoke, no-op revoke, re-mint,
  -- revoke = 1,1,2,2,2,3 — but assert the INVARIANT (non-decreasing) rather
  -- than the literal list, so an extra legitimate step cannot be "fixed" by
  -- editing an expected array.
  FOR i IN 2 .. array_length(gen_seen, 1) LOOP
    IF gen_seen[i] < gen_seen[i - 1] THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (MONOTONIC 1b): generation DECREASED at step % (% -> %) across the mint/revoke cycle %. A decrease means a previously revoked token became valid again.', i, gen_seen[i - 1], gen_seen[i], gen_seen;
    END IF;
  END LOOP;
  IF gen_seen[array_length(gen_seen, 1)] <= gen_seen[1] THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (MONOTONIC 1c): the counter ended at % having started at % — two revokes must have advanced it. A never-advancing counter would make the monotonicity loop above vacuously true. Sequence: %', gen_seen[array_length(gen_seen, 1)], gen_seen[1], gen_seen;
  END IF;

  -- ======================================================================
  -- TRIGGER 2: THE OWNER SELF-REWIND — a raw PATCH cannot resurrect links
  -- ======================================================================
  -- ⛔ MONOTONIC 1 ABOVE DOES NOT COVER THIS, and reading it as if it did is the
  -- mistake this arm exists to prevent. Every step of that cycle goes through
  -- the two RPCs, which are the only writers that BEHAVE monotonically — so
  -- MONOTONIC 1 stays GREEN with no trigger installed at all. It measures the
  -- RPCs; this measures the TABLE.
  --
  -- The attack needs no privilege the product does not already hand every user:
  --   * STEP 2 grants `authenticated` a column-UNRESTRICTED UPDATE (it must —
  --     revoke_strategy_share is SECURITY INVOKER and writes generation AS THE
  --     CALLER, so revoking UPDATE(generation) would disarm the RPC);
  --   * strategy_shares_owner is FOR ALL, and an owner's own-row UPDATE
  --     satisfies USING and WITH CHECK alike while created_by is unchanged.
  -- MEASURED on a PostgreSQL 16 replica of this schema before the fix: a single
  -- `PATCH /rest/v1/strategy_shares?strategy_id=eq.<own>` with
  -- `{"generation": 1, "revoked_at": null}` moved generation 2 -> 1 and cleared
  -- the tombstone. Every recipient still holding a revoked link regained
  -- anonymous access to that owner's UNPUBLISHED factsheet, and the Art. 17
  -- erasure arm in companion migration 20260827130000 became reversible by the
  -- very user it had just been applied to.
  --
  -- ⚠️ The row is REVOKED at this point (MONOTONIC 1a), which is what makes the
  -- probe faithful: it is the state a revoked-link resurrection starts from.
  raised := FALSE;
  BEGIN
    UPDATE strategy_shares
       SET generation = 1, revoked_at = NULL
     WHERE strategy_id = strat_a;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 2a): the owner rewound generation to 1 and cleared revoked_at with a raw UPDATE. Every share token they ever REVOKED at generation 1 is live again as anonymous access to their unpublished factsheet. Neither the grant layer nor RLS can stop this — the owner legitimately holds UPDATE and the FOR ALL policy admits their own row — so the strategy_shares_monotonic_generation trigger (migration 20260827120000 STEP 1b) is the ONLY control, and it is missing.';
  END IF;
  IF err_msg NOT LIKE '%generation is monotonic%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 2b): the self-rewind was rejected by something OTHER than the monotonicity trigger (got: %). The owner holds UPDATE on this table and passes the policy, so a rejection from any other layer means the trigger is unproven and this arm is measuring an accident.', err_msg;
  END IF;

  SELECT generation, revoked_at INTO gen_probe, now_revoked
    FROM strategy_shares WHERE strategy_id = strat_a;
  IF gen_probe <> gen_final OR now_revoked IS NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 2c): the rejected self-rewind still mutated the row (generation % -> %, revoked_at now %) — a partial write here is the full attack, because clearing the tombstone alone already re-publishes the link', gen_final, gen_probe, now_revoked;
  END IF;

  -- ======================================================================
  -- TRIGGER 3: THE TWO-REQUEST RE-POINT — the counter cannot walk away and
  --            leave generation 1 unclaimed behind it
  -- ======================================================================
  -- ⛔ TRIGGER 2 ABOVE DOES NOT COVER THIS. It pins the VALUE of `generation`;
  -- this pins WHICH STRATEGY that value counts for. The same end state — a
  -- REVOKED token resolving again — is reachable without ever writing the
  -- counter, in two requests, both of which an ordinary owner is entitled to
  -- make:
  --   1. `PATCH /rest/v1/strategy_shares?strategy_id=eq.<A>`
  --      `{"strategy_id": "<A2>"}`, where A2 is a second strategy the SAME user
  --      owns and has never shared. USING passes (created_by is unchanged), the
  --      CR-01 WITH CHECK EXISTS passes (they really do own A2),
  --      UNIQUE(strategy_id) is free because A2 has no row, and `generation`
  --      and `revoked_at` are both untouched so neither pre-existing trigger
  --      rule looks at anything. Strategy A is left with NO share row.
  --   2. `create_strategy_share(A)` then takes the INSERT path and lands a
  --      fresh row at `generation` DEFAULT 1. HMAC(secret, A || 1) is
  --      byte-identical to the token A handed out and REVOKED at generation 1,
  --      findShareMatch() scans it as ACTIVE, and every recipient still holding
  --      that dead url is back inside the unpublished factsheet.
  --
  -- ⭐ HOW THIS ARM IS BUILT, and why request 2 runs UNCONDITIONALLY. The
  -- obvious shape — assert request 1 raised, then probe whether the row moved —
  -- is the shape this file has recorded as unfailable: request 1 is wrapped in
  -- a nested BEGIN ... EXCEPTION, which is an implicit subtransaction, so
  -- catching the error rolls its writes back and the "did it move?" probe is
  -- unreachable in every configuration. So the ARM here is the attack's END
  -- STATE, not request 1's error. Request 2 is issued whether or not request 1
  -- raised, and TRIGGER 3a asks the only question that separates the two
  -- worlds: with the rule present, A still owns its advanced counter and the
  -- mint reuses it; with the rule gone, request 1 succeeded, A has no row, and
  -- the mint returns 1. TRIGGER 3a is therefore the FIRST failure when rule
  -- (0a) is deleted, which is what makes it an arm rather than decoration.
  --
  -- ⚠️ strat_a2 IS NEVER SHARED BY THIS BLOCK, and must not be — ordering
  -- constraint 1 in this file's header (ANON 1b needs a strategy_id with no
  -- share row so UNIQUE(strategy_id) cannot pre-empt the privilege check). The
  -- re-point is REJECTED, and the rejection is a subtransaction rollback, so no
  -- row for strat_a2 can survive it. That invariant is structural, not
  -- asserted: an "expected 0 rows for strat_a2" probe would sit downstream of
  -- the same rollback and could never fail.
  raised := FALSE;
  BEGIN
    UPDATE strategy_shares SET strategy_id = strat_a2 WHERE strategy_id = strat_a;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;

  -- REQUEST 2 of the attack, run for real.
  SELECT public.create_strategy_share(strat_a) INTO gen_probe;

  IF gen_probe IS NULL OR gen_probe = 1 OR gen_probe < gen_final THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 3a): after the owner re-pointed their share row at a second strategy they own, create_strategy_share() on the ORIGINAL strategy returned generation % — the counter stood at % before the attempt. A fresh generation-1 row means every token that strategy REVOKED at generation 1 derives again and resolves as anonymous access to an unpublished factsheet. The counter is only meaningful relative to the strategy it counts for, so strategy_shares_monotonic_generation must refuse ANY change to strategy_id (migration 20260827120000 STEP 1b, rule 0a) — and it did not.', gen_probe, gen_final;
  END IF;

  -- Message-pinned in two steps, for the same reason TRIGGER 1b/2b are: the
  -- end-state arm above passes just as happily if request 1 was a silent no-op
  -- (a policy that filtered the owner's own row out of the UPDATE scan would do
  -- exactly that) as if it was REJECTED. A no-op blocks today's attack by
  -- accident and would stop blocking it the moment the policy is retuned, so an
  -- arm that cannot tell the two apart is measuring luck.
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 3b): the cross-strategy re-point did not RAISE — it was accepted, or it silently matched 0 rows. The owner holds a column-unrestricted UPDATE grant and their own row satisfies both halves of strategy_shares_owner, so the only layer entitled to reject this is the trigger. If it merely matched 0 rows then TRIGGER 3a above passed on an accident of the policy rather than on the rule under test.';
  END IF;
  IF err_msg NOT LIKE '%strategy_id is immutable%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 3c): the re-point was rejected by something OTHER than the strategy_id-immutability rule (got: %). A rejection from the grant layer, a policy rewrite or an FK blocks today and stops blocking on the next unrelated change, so this arm proves nothing about the trigger unless the rejection came FROM it.', err_msg;
  END IF;

  -- ⚠️ STATE CHANGE, and it is deliberate: request 2 above REACTIVATED strat_a
  -- (revoked_at cleared, generation unchanged at gen_final). Everything
  -- downstream that reads A's row must expect it LIVE. This STRENGTHENS TENANT
  -- 4b below, which until now revoked an ALREADY-REVOKED row and so returned 0
  -- through the `revoked_at IS NULL` predicate no matter what RLS did.

  -- ======================================================================
  -- TRIGGER 4: provenance on a live capability grant is not forgeable
  -- ======================================================================
  -- STEP 3 of migration 20260827120000 tells every future reader that
  -- reactivation never rewrites `created_by` or `created_at`. That was a claim
  -- about ONE code path, read as a property of the ROW — and a raw PATCH
  -- falsified it, because the owner's UPDATE grant is column-unrestricted and
  -- their own row passes the policy. REACTIVATE 1d/1e pin the RPC; this pins
  -- the TABLE, the same split TRIGGER 2 draws against MONOTONIC 1.
  --
  -- `created_at` is the probe of the three pinned columns (id, created_by,
  -- created_at) because it is the only one NO other layer guards: rewriting
  -- `created_by` also trips the `created_by = auth.uid()` half of WITH CHECK,
  -- so an arm there could pass on the policy while rule (0b) was gone. A
  -- rejection here can only have come from the trigger.
  raised := FALSE;
  BEGIN
    UPDATE strategy_shares
       SET created_at = created_at - INTERVAL '1 year'
     WHERE strategy_id = strat_a;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 4a): the owner backdated created_at on their own share row with a raw UPDATE. Nothing but the trigger guards that column — the grant is column-unrestricted and the row passes both halves of strategy_shares_owner — so rule (0b) of strategy_shares_monotonic_generation (migration 20260827120000 STEP 1b) is missing, and the provenance STEP 3 promises is forgeable: who minted a live anonymous capability link, and when, both become whatever the owner types.';
  END IF;
  IF err_msg NOT LIKE '%identity and provenance are immutable%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 4b): the provenance rewrite was rejected by something OTHER than the identity/provenance rule (got: %) — this arm proves nothing about the trigger unless the rejection came FROM it', err_msg;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ======================================================================
  -- TENANT 4: B cannot SEE or REVOKE A's share
  -- ======================================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO row_cnt FROM strategy_shares;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 4a): tenant B sees % strategy_shares rows, expected 0 — CROSS-TENANT LEAK through the USING clause', row_cnt;
  END IF;

  -- A cross-tenant revoke must be a silent 0, not an error: an error would tell
  -- B that a share exists for that strategy id (an existence oracle).
  SELECT public.revoke_strategy_share(strat_a) INTO affected;
  IF affected <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 4b): tenant B revoked % of tenant A''s share rows, expected 0 — the USING clause does not scope the UPDATE', affected;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ...and A's counter is untouched by B's attempt.
  SELECT generation INTO gen_remint FROM strategy_shares WHERE strategy_id = strat_a;
  IF gen_remint <> gen_final THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 4c): tenant B''s revoke moved tenant A''s generation from % to %', gen_final, gen_remint;
  END IF;

  -- ======================================================================
  -- TENANT 5: cross-tenant mint against a strategy that ALREADY HAS a row
  -- ======================================================================
  -- Every cross-tenant probe above targets strat_b, for which NO share row
  -- existed, so all of them exercise the plain INSERT path against an empty
  -- slot. This block seeds tenant B's row first, so the same attack runs
  -- against a REAL victim row — the case where a partial write would actually
  -- have something to damage.
  --
  -- ⚠️ WALL ORDERING, MEASURED (PostgreSQL 16) rather than assumed — the
  -- obvious reading of this arm is WRONG and the next reader deserves the
  -- facts:
  --   * With the CR-01 EXISTS half present, `INSERT ... ON CONFLICT DO UPDATE`
  --     is rejected at WCO_RLS_INSERT_CHECK on the PROPOSED tuple — message
  --     "new row violates row-level security policy" — BEFORE the conflict
  --     handler runs at all. So the DO UPDATE path is not merely unexercised
  --     cross-tenant, it is UNREACHABLE cross-tenant. That is the correct
  --     defense-in-depth outcome, not a gap.
  --   * Drop that EXISTS half and execution DOES reach ExecOnConflictUpdate,
  --     where the policy's USING clause is evaluated against the EXISTING row
  --     and rejects with the DISTINCT message "new row violates row-level
  --     security policy (USING expression)". That is the second wall.
  -- ⛔ Consequence for honesty: 5b/5c below go RED on the SAME neuter that
  -- reddens TENANT 1 (dropping the EXISTS half) — they are NOT an independent
  -- pin of the USING clause. **TENANT 4a is the USING pin** — see the note
  -- immediately after 5c, which records why the obvious raw cross-tenant UPDATE
  -- arm here was written, measured and then DELETED as unfailable. (An earlier
  -- version of this sentence named a "TENANT 5h" that has never existed: the
  -- roster is 5a-5g, and 5h WAS that deleted arm. The two passages now agree.)
  -- What 5b-5g uniquely prove is that the rejection is TOTAL when a victim row
  -- exists: no partial write, no revoked_at clearing, no provenance rewrite, no
  -- second row.
  --
  -- ⚠️ Deliberately placed AFTER the TENANT 1-4 family. Seeding B's row EARLIER
  -- (the obvious placement) would push TENANT 1's mint against a strategy that
  -- now has a row — and TENANT 1 would still pass, on the same first wall, so
  -- nothing would be lost there; but TENANT 2's RAW INSERT would then hit
  -- UNIQUE(strategy_id) and fail on 23505 instead of on RLS, breaking a
  -- currently-exact arm. Ordering this last keeps TENANT 1/2 clean.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Positive control: B can mint on their OWN strategy (so the negative arm
  -- below cannot pass because minting is broken for everyone).
  SELECT public.create_strategy_share(strat_b) INTO gen_b;
  IF gen_b IS NULL OR gen_b <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 5a): tenant B''s first mint on their own strategy returned %, expected 1', gen_b;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  raised := FALSE;
  BEGIN
    PERFORM public.create_strategy_share(strat_b);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 5b): tenant A minted against tenant B''s EXISTING share row without error. Both policy walls are gone: the CR-01 EXISTS half of WITH CHECK (which normally rejects the proposed tuple first) AND the USING clause the ON CONFLICT DO UPDATE path falls through to. `SET revoked_at = NULL` on that path RESURRECTS another tenant''s revoked link.';
  END IF;
  IF err_msg NOT LIKE '%row-level security%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 5c): the cross-tenant conflict write was blocked by something OTHER than RLS (got: %) — most likely UNIQUE(strategy_id) raising 23505, which would mean neither policy wall was proven', err_msg;
  END IF;

  -- ⚠️ WHERE THE `USING` CLAUSE IS ACTUALLY PINNED — read this before adding an
  -- arm here. A raw cross-tenant `UPDATE strategy_shares ... WHERE strategy_id
  -- = strat_b` looks like the obvious independent pin on USING, and it was
  -- written, measured and then DELETED, because it cannot fail:
  --   * shipped policy            -> 0 rows, no exception (correct);
  --   * FOR ALL `USING (true)`    -> TENANT 4a fires FIRST (B can suddenly SEE
  --                                  A's row), so the raw arm never runs;
  --   * policy split per-command with only the UPDATE arm loosened -> the
  --     SELECT policy still filters the UPDATE's own scan, so the raw arm sees
  --     0 rows and passes — CORRECTLY, because the loosening is not
  --     exploitable while SELECT stays scoped.
  -- There is no configuration in which it is the first failure, and an arm that
  -- cannot fail is worse than no arm. **TENANT 4a is the USING pin.**
  -- ⛔ And note what is NO LONGER one: TENANT 4b routes through
  -- revoke_strategy_share, which now carries its own `created_by = auth.uid()`
  -- predicate (B2 fix), so it returns 0 even with RLS wide open. Do not read
  -- 4b as an RLS proof any more — it is a proof of the RPC's predicate.

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ...and B's row is byte-untouched by A's attempt. A rejection that still
  -- moved the counter, cleared the tombstone or rewrote provenance would be a
  -- successful attack wearing an error message.
  SELECT generation, revoked_at, created_by INTO gen_b_after, b_revoked, b_by
    FROM strategy_shares WHERE strategy_id = strat_b;
  IF gen_b_after IS DISTINCT FROM gen_b THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 5d): tenant A''s rejected conflict-write moved tenant B''s generation from % to %', gen_b, gen_b_after;
  END IF;
  IF b_revoked IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 5e): tenant B''s share is revoked after tenant A''s rejected attempt — the conflict path wrote to a row it must not touch';
  END IF;
  IF b_by IS DISTINCT FROM uid_b THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 5f): tenant B''s created_by changed from % to % — tenant A''s rejected attempt rewrote provenance', uid_b, b_by;
  END IF;

  SELECT count(*) INTO row_cnt FROM strategy_shares WHERE strategy_id = strat_b;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 5g): % share rows exist for tenant B''s strategy, expected exactly 1', row_cnt;
  END IF;

  -- ======================================================================
  -- ANON 1: blocked at the GRANT layer (42501)
  -- ======================================================================
  SET LOCAL ROLE anon;
  raised := FALSE;
  BEGIN
    SELECT count(*) INTO row_cnt FROM strategy_shares;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (ANON 1a): anon holds a SELECT grant on strategy_shares (no 42501) — `REVOKE ALL ON strategy_shares FROM PUBLIC, anon` is missing or was re-granted';
  END IF;

  -- ⛔ TWO defects fixed here, both of which made this arm unable to fail.
  --   (1) It caught `WHEN OTHERS` while every sibling arm (1a, 1c, 1d) catches
  --       `insufficient_privilege`.
  --   (2) It targeted strat_a, which ALREADY HAS a share row — and
  --       strategy_id is NOT NULL UNIQUE. Had anon held full INSERT rights the
  --       statement would have raised 23505 (unique_violation), `WHEN OTHERS`
  --       would have caught it, and the arm would have reported that anon is
  --       blocked while anon could in fact write to the table.
  -- Fix: narrow the handler, and target strat_a2 — an A-owned strategy that is
  -- deliberately NEVER shared, so no constraint error can pre-empt the
  -- privilege check.
  --
  -- The `permission denied` message assertion pins the GRANT layer
  -- specifically. Both an absent grant AND an RLS rejection raise 42501, so
  -- SQLSTATE alone cannot tell them apart; the message can. Postgres checks
  -- table privileges at executor start, BEFORE any per-row RLS evaluation, so
  -- while the REVOKE holds this is exactly the error anon gets. If a future
  -- `GRANT INSERT ... TO anon` lands and only RLS saves us, this arm goes RED —
  -- which is the point: ANON 2 below proves the policy layer, and this one must
  -- keep proving the grant layer independently.
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_shares (strategy_id, created_by) VALUES (strat_a2, uid_a);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (ANON 1b): anon INSERTed into strategy_shares — `REVOKE ALL ON strategy_shares FROM PUBLIC, anon, authenticated` is missing or anon was re-granted INSERT';
  END IF;
  IF err_msg NOT LIKE '%permission denied%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (ANON 1b-grant): anon''s INSERT was rejected by something other than the GRANT layer (got: %). A 42501 from RLS would satisfy a naive arm while anon still held an INSERT grant; this arm must prove the grant is ABSENT, because ANON 2 already proves the policy independently.', err_msg;
  END IF;

  -- anon must not be able to invoke either RPC.
  --
  -- ⛔ THE MESSAGE ASSERTIONS BELOW ARE NOT DECORATION — same defect, same fix,
  -- as ANON 1b-grant above. `insufficient_privilege` (42501) is raised by BOTH
  -- walls on this surface: the absent EXECUTE grant, AND the `auth.uid() IS
  -- NULL` fail-loud guard inside both bodies (auth.uid() is NULL for anon here,
  -- the claims having been cleared before this block). SQLSTATE alone therefore
  -- cannot tell "anon cannot reach the function" from "anon reached it and the
  -- body threw her out".
  -- MEASURED (PostgreSQL 16 replica) with `GRANT EXECUTE ... TO anon` in force:
  -- both arms below, written to catch bare `insufficient_privilege`, reported
  -- PASS while anon demonstrably held EXECUTE — the swallowed SQLERRM was
  -- "create_strategy_share: no authenticated user — not callable by a
  -- service-role/admin client". Pinning `permission denied for function` is
  -- what makes them measure the GRANT layer, which is their only job: the body
  -- guard is proven independently and behaviourally by SERVICE-ROLE 2.
  raised := FALSE;
  BEGIN
    PERFORM public.create_strategy_share(strat_a);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (ANON 1c): anon holds EXECUTE on create_strategy_share — the REVOKE/GRANT block in migration 20260827120000 is missing or was overridden';
  END IF;
  IF err_msg NOT LIKE '%permission denied for function%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (ANON 1c-grant): anon''s create_strategy_share call was rejected by something other than the GRANT layer (got: %). The body''s `auth.uid() IS NULL` guard raises the SAME 42501, so this arm passes on the wrong wall unless the message is pinned — MEASURED: with EXECUTE granted to anon the bare-SQLSTATE version reported PASS.', err_msg;
  END IF;

  raised := FALSE;
  BEGIN
    PERFORM public.revoke_strategy_share(strat_a);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (ANON 1d): anon holds EXECUTE on revoke_strategy_share';
  END IF;
  IF err_msg NOT LIKE '%permission denied for function%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (ANON 1d-grant): anon''s revoke_strategy_share call was rejected by something other than the GRANT layer (got: %) — see ANON 1c-grant; the body guard raises the same errcode and would satisfy a bare-SQLSTATE arm', err_msg;
  END IF;

  RESET ROLE;

  -- ======================================================================
  -- ANON 2: blocked INDEPENDENTLY at the POLICY layer
  -- ======================================================================
  -- ANON 1 proves the grant layer bites — but it MASKS the policy layer: with
  -- no grant at all, a policy of `USING (true)` would go undetected, and a
  -- single future `GRANT SELECT ... TO anon` (the pattern used elsewhere in
  -- this repo for SECDEF-backed public reads) would then expose every share
  -- row. Grant SELECT temporarily and prove the policy ALSO returns 0 rows,
  -- because strategy_shares_owner is `TO authenticated` and there is no anon
  -- policy at all (default deny). The grant is reverted immediately below and
  -- the file's closing ROLLBACK is the backstop.
  EXECUTE 'GRANT SELECT ON public.strategy_shares TO anon';
  SET LOCAL ROLE anon;
  SELECT count(*) INTO row_cnt FROM strategy_shares;
  RESET ROLE;
  EXECUTE 'REVOKE SELECT ON public.strategy_shares FROM anon';

  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (ANON 2): with SELECT granted, anon reads % strategy_shares rows, expected 0 — the policy layer does NOT block anon on its own, so the table is one stray GRANT away from full disclosure. strategy_shares_owner must stay `TO authenticated` with no anon policy.', row_cnt;
  END IF;

  -- Belt-and-braces: the temporary grant really is gone.
  -- ⛔ Read via aclexplode(pg_class.relacl), matching SHAPE 3 above and
  -- SERVICE-ROLE 2e below. This arm previously read
  -- `information_schema.role_table_grants`, which is PRIVILEGE-FILTERED — it
  -- surfaces only grants whose grantor or grantee the current role is, or is a
  -- member of. For SHAPE 3's exact-set question that filtering can only produce
  -- a confusing false RED, but this arm asks a COUNT-IS-ZERO question, where
  -- under-reporting yields a false GREEN: a genuinely leaked anon grant that
  -- the applying role happens not to see reads as "no grants remain". relacl is
  -- the authoritative store and is not filtered.
  SELECT count(*) INTO row_cnt
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
   WHERE c.oid = 'public.strategy_shares'::regclass
     AND r.rolname = 'anon';
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (ANON 2b): % anon grant(s) remain on strategy_shares after the layer-2 probe — the REVOKE did not take (the transaction ROLLBACK is still the backstop, but this must not be relied on)', row_cnt;
  END IF;

  -- ======================================================================
  -- SERVICE-ROLE 1: no EXECUTE on either RPC (grant layer)
  -- ======================================================================
  -- `service_role` is BYPASSRLS. It is also what `createAdminClient()` connects
  -- as, and migration 20260827120000 STEP 2 records that this feature's
  -- recipient lane ALREADY reads strategy_shares through an admin client — so
  -- an admin client is inside the blast radius by design, not hypothetically.
  -- Neither RPC is meant for it. Prove the grant layer first.
  --
  -- ======================================================================
  -- SERVICE-ROLE 0-acl: the STANDING ACL grants service_role no EXECUTE
  -- ======================================================================
  -- ⛔ THIS MUST RUN BEFORE THE TEMPORARY GRANTS BELOW, and it is the only arm
  -- in the file that can answer the standing-ACL question. SERVICE-ROLE 2e
  -- looks like it does, but it runs AFTER the layer-2 probe has already REVOKEd
  -- what it granted, so it measures "the revoke took", not "the migration
  -- shipped no grant".
  --
  -- ⚠️ AND IT IS THE DURABLE CONTROL, not the REVOKE in the migration. This
  -- repo has MEASURED that `REVOKE` does not survive — Supabase's
  -- `pg_default_acl` re-grants on any DROP+CREATE, "and that is a CLASS"
  -- (ROADMAP.md:1534; it bit mig 20260812083206 for anon). A migration's own
  -- apply-time check runs ONCE; this one re-runs on every CI push, and it reads
  -- the LIVE catalog rather than a marker comment.
  --
  -- MEASURED before the fix (PostgreSQL 16 replica carrying Supabase's default
  -- ACLs): with the migration revoking only `FROM PUBLIC, anon`, this query
  -- returned 2 — service_role held EXECUTE on BOTH RPCs, because revoking
  -- PUBLIC does not touch a grant made to a NAMED role.
  SELECT count(*) INTO row_cnt
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('create_strategy_share', 'revoke_strategy_share')
     AND r.rolname = 'service_role'
     AND acl.privilege_type = 'EXECUTE';
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (SERVICE-ROLE 0-acl): service_role holds % standing EXECUTE grant(s) on the share RPCs, expected 0. That role is BYPASSRLS and is what createAdminClient() connects as, so this deletes the grant-layer wall and leaves ONLY the auth.uid() fail-loud guard in the body — the two-wall posture STEP 3/4 of migration 20260827120000 claims collapses to one. ⛔ Read as a REGRESSION of the REVOKE, which pg_default_acl re-applies on any DROP+CREATE of these functions.', row_cnt;
  END IF;

  SET LOCAL ROLE service_role;
  raised := FALSE;
  BEGIN
    PERFORM public.revoke_strategy_share(strat_a);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  RESET ROLE;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (SERVICE-ROLE 1): service_role executed revoke_strategy_share — it holds neither an explicit GRANT nor the PUBLIC default the migration revokes. A BYPASSRLS caller on this RPC is an unauthenticated cross-tenant kill switch.';
  END IF;
  -- ⛔ Same defect and same fix as ANON 1b-grant / 1c-grant / 1d-grant. The
  -- `auth.uid() IS NULL` guard in the body raises `insufficient_privilege` too
  -- — and for service_role auth.uid() is ALWAYS NULL, so the body ALWAYS
  -- refuses. A bare-SQLSTATE arm here is therefore satisfied by the body
  -- whether or not the grant exists, which is precisely the wall it claims to
  -- prove. MEASURED (PostgreSQL 16 replica): with `GRANT EXECUTE ... TO
  -- service_role` in force, the bare version reported PASS while swallowing
  -- "revoke_strategy_share: no authenticated user — not callable by a
  -- service-role/admin client".
  -- ⚠️ SERVICE-ROLE 0-acl above is the primary detector for that drift and
  -- fires earlier; this message pin keeps THIS arm honest about which layer it
  -- measured, so the two cannot both go dark on the same regression.
  IF err_msg NOT LIKE '%permission denied for function%' THEN
    RAISE EXCEPTION 'TEST FAILED (SERVICE-ROLE 1-grant): service_role''s revoke_strategy_share call was rejected by something other than the GRANT layer (got: %). If this is the fail-loud body guard, service_role HOLDS EXECUTE and this arm proved nothing — the grant-layer wall it names is gone.', err_msg;
  END IF;

  -- ======================================================================
  -- SERVICE-ROLE 2: the BODY guard bites even WITH execute granted
  -- ======================================================================
  -- ⛔ SERVICE-ROLE 1 alone is VACUOUS with respect to the fail-loud guard: the
  -- EXECUTE privilege is checked BEFORE the body ever runs, so that arm stays
  -- green whether or not the `auth.uid() IS NULL` guard exists. A single future
  -- `GRANT EXECUTE ... TO service_role` — the obvious "fix" someone reaches for
  -- when an admin-client call 404s — would then hand a BYPASSRLS caller the
  -- whole table with nothing left to stop it.
  --
  -- So grant EXECUTE temporarily inside this rolled-back transaction and prove
  -- the BODY refuses independently. Same layer-1/layer-2 shape as ANON 1 vs
  -- ANON 2 above. The grant is reverted immediately and the closing ROLLBACK is
  -- the backstop.
  --
  -- The message assertion is load-bearing: with the guard deleted the call
  -- would SUCCEED (revoking tenant A's share, cross-tenant, with RLS bypassed),
  -- and `raised` would be FALSE — but if the temporary GRANT ever failed to
  -- take, the error would be `permission denied for function` and a bare
  -- `raised := TRUE` would call that a pass. Pinning the text keeps the arm
  -- measuring the guard rather than the grant.
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.revoke_strategy_share(UUID) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_strategy_share(UUID) TO service_role';
  PERFORM set_config('request.jwt.claims', NULL, true);

  SET LOCAL ROLE service_role;
  raised := FALSE;
  BEGIN
    PERFORM public.revoke_strategy_share(strat_a);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  RESET ROLE;
  IF NOT raised THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.revoke_strategy_share(UUID) FROM service_role';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.create_strategy_share(UUID) FROM service_role';
    RAISE EXCEPTION 'TEST FAILED (SERVICE-ROLE 2a): with EXECUTE granted, service_role ran revoke_strategy_share to completion. auth.uid() is NULL for that role and RLS does not apply to it, so the UPDATE reached ANOTHER TENANT''S row and the caller got a success back. The `IF auth.uid() IS NULL THEN RAISE` guard in migration 20260827120000 is missing.';
  END IF;
  IF err_msg NOT LIKE '%not callable by a service-role%' THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.revoke_strategy_share(UUID) FROM service_role';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.create_strategy_share(UUID) FROM service_role';
    RAISE EXCEPTION 'TEST FAILED (SERVICE-ROLE 2b): service_role''s revoke failed, but NOT on the fail-loud guard (got: %). If this says "permission denied for function" the temporary GRANT did not take and this arm proved nothing about the body.', err_msg;
  END IF;

  SET LOCAL ROLE service_role;
  raised := FALSE;
  BEGIN
    PERFORM public.create_strategy_share(strat_a);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  RESET ROLE;
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.revoke_strategy_share(UUID) FROM service_role';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.create_strategy_share(UUID) FROM service_role';
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (SERVICE-ROLE 2c): with EXECUTE granted, service_role ran create_strategy_share to completion. It must refuse: for that role auth.uid() is NULL and RLS does not apply, so the ON CONFLICT DO UPDATE path would set revoked_at = NULL on an EXISTING row with no policy in the way. Today the NOT NULL on created_by raises 23502 first and blocks that INCIDENTALLY — completing successfully means even that accident is gone.';
  END IF;
  IF err_msg NOT LIKE '%not callable by a service-role%' THEN
    RAISE EXCEPTION 'TEST FAILED (SERVICE-ROLE 2d): service_role''s mint failed, but NOT on the fail-loud guard (got: %)', err_msg;
  END IF;

  -- Belt-and-braces: the temporary EXECUTE grants really are gone.
  -- ⛔ THIS ARM CANNOT ANSWER "did the migration ship a service_role grant?" and
  -- must not be read as if it did: lines above REVOKE the standing grant along
  -- with the temporary one, so by the time this counts, a shipped grant and no
  -- shipped grant are indistinguishable. That question is owned by
  -- SERVICE-ROLE 0-acl, which snapshots the LIVE ACL BEFORE the temporary GRANT
  -- is issued. What this arm uniquely proves is that the probe CLEANED UP —
  -- worth keeping, because the file's other backstop is the closing ROLLBACK
  -- and a leaked EXECUTE grant on a shared test database would silently
  -- pre-satisfy SERVICE-ROLE 0-acl's failure condition on the NEXT run.
  SELECT count(*) INTO row_cnt
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('create_strategy_share', 'revoke_strategy_share')
     AND r.rolname = 'service_role';
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (SERVICE-ROLE 2e): % service_role EXECUTE grant(s) remain on the share RPCs after the layer-2 probe — the REVOKE did not take (the ROLLBACK is still the backstop, but must not be relied on)', row_cnt;
  END IF;

  -- ======================================================================
  -- SANITIZE 1: GDPR Art. 17 erasure KILLS the subject's share links (B1)
  -- ======================================================================
  -- ⛔ `sanitize_user` ANONYMIZES; it deletes neither `profiles` nor
  -- `auth.users`, so NEITHER of strategy_shares' ON DELETE CASCADE FKs ever
  -- fires. Without the explicit arm added in companion migration
  -- 20260827130000, every capability URL the data subject minted keeps
  -- resolving to their unpublished factsheet forever after their erasure — and
  -- the same function sets `banned_until = 'infinity'` and purges their
  -- sessions, so they can never log back in to revoke it themselves.
  --
  -- The migration's own DO block cannot pin this: it runs ONCE, at apply. This
  -- is the durable pin, and it exercises the REAL function end-to-end rather
  -- than grepping its text.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT public.create_strategy_share(strat_a) INTO gen_pre_san;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Precondition: A's share is LIVE, or the arm below would be vacuous (an
  -- already-revoked row is skipped by the `revoked_at IS NULL` predicate and
  -- would "pass" without the erasure arm existing at all).
  SELECT revoked_at INTO now_revoked FROM strategy_shares WHERE strategy_id = strat_a;
  IF now_revoked IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (SANITIZE 1a): tenant A''s share is not live before sanitize_user — the assertions below would pass VACUOUSLY';
  END IF;

  SELECT public.sanitize_user(uid_a) INTO san_ok;
  IF san_ok IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (SANITIZE 1b): sanitize_user(uid_a) returned % — expected TRUE for a not-yet-sanitized user. The erasure assertions below cannot be trusted if the erasure did not run.', san_ok;
  END IF;

  SELECT revoked_at, generation INTO now_revoked, gen_final
    FROM strategy_shares WHERE strategy_id = strat_a;
  IF now_revoked IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (SANITIZE 1c): after sanitize_user the data subject''s share row is STILL LIVE. Every link they ever copied still resolves to their unpublished factsheet — returns curve, metrics and trade analytics all survive the anonymize — and banned_until = infinity means they can never log in to revoke it. Companion migration 20260827130000 is missing or its `UPDATE strategy_shares` arm was dropped.';
  END IF;
  IF gen_final <> gen_pre_san + 1 THEN
    RAISE EXCEPTION 'TEST FAILED (SANITIZE 1d): generation is % after erasure, expected % (exactly +1). If it is UNCHANGED the erasure is COSMETIC: revoked_at is stamped but the token still derives from the same counter, so every previously-copied link KEEPS WORKING.', gen_final, gen_pre_san + 1;
  END IF;

  -- REVOKE, never DELETE. A delete rewinds the counter, so the next mint would
  -- restart at generation 1 and resurrect every token minted at generation 1.
  SELECT count(*) INTO row_cnt FROM strategy_shares WHERE strategy_id = strat_a;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (SANITIZE 1e): the subject''s share row count is % after erasure, expected 1. sanitize_user must SOFT-revoke: deleting the row discards the generation counter, and the next create_strategy_share() would restart at generation 1 — resurrecting every already-revoked token.', row_cnt;
  END IF;

  -- ...and the erasure is scoped to the subject. `created_by = p_user_id` is
  -- the ONLY scope this statement has (sanitize_user is SECURITY DEFINER, so
  -- RLS is not applied to it), which makes a cross-tenant control mandatory.
  SELECT generation, revoked_at INTO gen_b_after, b_revoked
    FROM strategy_shares WHERE strategy_id = strat_b;
  IF b_revoked IS NOT NULL OR gen_b_after IS DISTINCT FROM gen_b THEN
    RAISE EXCEPTION 'TEST FAILED (SANITIZE 1f): erasing tenant A also revoked tenant B''s share (revoked_at=%, generation % -> %) — the `created_by = p_user_id` predicate is missing from the sanitize arm, so ONE user''s Art. 17 request kills EVERY user''s share links', b_revoked, gen_b, gen_b_after;
  END IF;

  RAISE NOTICE 'test_strategy_shares_rls: ALL 78 ARMS EXECUTED (SHAPE 1, SHAPE 2a, SHAPE 2b, SHAPE 3, SHAPE 4a, SHAPE 4b, SHAPE 4c, SHAPE 5, OWNER 1a, OWNER 1b, OWNER 2a, OWNER 2b, OWNER 2c, TENANT 1a, TENANT 1b, TENANT 2a, TENANT 2b, TENANT 3a, TENANT 3b, NO-DELETE 1, REVOKE 1a, REVOKE 1b, REVOKE 1c, REVOKE 2a, REVOKE 2b, REACTIVATE 1a, REACTIVATE 1b, REACTIVATE 1c, REACTIVATE 1d, REACTIVATE 1e, REACTIVATE 1f, TRIGGER 1a, TRIGGER 1b, TRIGGER 1c, MONOTONIC 1a, MONOTONIC 1b, MONOTONIC 1c, TRIGGER 2a, TRIGGER 2b, TRIGGER 2c, TRIGGER 3a, TRIGGER 3b, TRIGGER 3c, TRIGGER 4a, TRIGGER 4b, TENANT 4a, TENANT 4b, TENANT 4c, TENANT 5a, TENANT 5b, TENANT 5c, TENANT 5d, TENANT 5e, TENANT 5f, TENANT 5g, ANON 1a, ANON 1b, ANON 1b-grant, ANON 1c, ANON 1c-grant, ANON 1d, ANON 1d-grant, ANON 2, ANON 2b, SERVICE-ROLE 0-acl, SERVICE-ROLE 1, SERVICE-ROLE 1-grant, SERVICE-ROLE 2a, SERVICE-ROLE 2b, SERVICE-ROLE 2c, SERVICE-ROLE 2d, SERVICE-ROLE 2e, SANITIZE 1a, SANITIZE 1b, SANITIZE 1c, SANITIZE 1d, SANITIZE 1e, SANITIZE 1f). Observed generation sequence: %', gen_seen;
END
$$;

ROLLBACK;
