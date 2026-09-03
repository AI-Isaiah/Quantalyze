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
-- ⭐ PER-ARM RED-UNDER (standing requirement, founder-adopted 2026-08-27).
-- Every arm added by the nonce change carries an adjacent
-- `-- RED-UNDER: <the exact mutation that reddens THIS arm>` comment, and each
-- of those mutations was performed individually on the throwaway cluster with
-- that arm observed as the FIRST failure — not merely the batch observed red,
-- which is how six structurally-unfailable arms entered this file across two
-- earlier fix rounds. Where an arm could NOT be made the first failure, that is
-- recorded at the arm instead of papered over (see SHAPE 1's note on a deleted
-- `nonce`, and NONCE 5c).
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.3, VAC-01). Each prose RED-UNDER above
-- an arm now carries an adjacent `RED-UNDER-M` object that scripts/mutation-runner
-- executes on every push: it mutates COPIES, requires the FIRST `TEST FAILED (…)`
-- to name that arm, and restores GREEN. The schema is scripts/mutation-runner/
-- GRAMMAR.md. The line below declares what the lane applies before this gate.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","supabase/migrations/20260827120000_strategy_shares_generation_model.sql","supabase/migrations/20260827130000_sanitize_user_revoke_strategy_shares.sql"]}
--
-- WHAT THIS FILE ASSERTS (content-by-field; a 200 / a row count proves nothing)
-- ---------------------------------------------------------------------------
--   * SHAPE  — the column set is EXACTLY the seven DDL columns, so no
--     token/token_hash/secret column has appeared at rest (D-02, T-164-07);
--     `nonce` is uuid NOT NULL DEFAULT gen_random_uuid() (server-generated, so
--     no client ever supplies it) and `generation` is BIGINT; both RPCs are
--     SECURITY INVOKER with no PUBLIC EXECUTE; `authenticated` holds EXACTLY
--     {SELECT} at TABLE level and EXACTLY
--     {INSERT(strategy_id, created_by), UPDATE(revoked_at, generation)} at
--     COLUMN level (so DELETE **and TRUNCATE**, which is exempt from RLS, are
--     both closed, AND `nonce` is unwritable); create_strategy_share NEVER
--     names `nonce` as a write target but DOES return it; and both RPC bodies
--     still carry the `auth.uid() IS NULL` fail-loud plus revoke's own
--     `created_by = auth.uid()` predicate.
--   * NONCE  — the founder ruling of 2026-08-27. The MAC pre-image gained an
--     immutable per-row nonce, and the arms prove BOTH halves of it, because
--     either alone closes nothing: the owner can neither UPDATE nor INSERT a
--     nonce of their choosing (GRANT layer, message-pinned to `permission
--     denied` so trigger rule (0c) cannot mask it), service_role — which
--     bypasses grants AND RLS — is refused by rule (0c) instead, and, the
--     positive property everything rests on, a row DESTROYED by the
--     `strategies` ON DELETE CASCADE and re-created at the SAME uuid comes back
--     with a DIFFERENT nonce, so its tokens are disjoint from every token ever
--     issued. Reuse and reactivation return the SAME nonce (SHARE-01 would
--     otherwise break through a column that did not exist when OWNER 2a was
--     written).
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
--   4. `strat_a3` is SACRIFICIAL and belongs to NONCE 4 alone. That arm DELETEs
--      it and re-creates it at the same uuid to reproduce the cascade-rebirth
--      for real, so no other arm may use it or assume its share row survives.
--
-- ⚠️ TWO ARMS CHANGED WHICH LAYER THEY MEASURE at the 2026-08-27 nonce ruling,
-- and the change is recorded here because a reader who remembers the old file
-- will otherwise think they were weakened. `strategy_id` and `created_at` are
-- absent from the column-scoped UPDATE grant, so for an ordinary
-- `authenticated` caller the re-point (TRIGGER 3) and the provenance rewrite
-- (TRIGGER 4) are now refused at the GRANT layer and never reach trigger rules
-- (0a)/(0b). Those arms therefore pin `permission denied` now — a real and
-- strictly earlier defence — and the trigger rules are pinned behaviourally
-- against `service_role` by the new TRIGGER 3d / TRIGGER 4c, which is the one
-- caller no grant binds. Neither arm subsumes the other, and dropping either
-- would leave a rule unproven.
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
  -- ⚠️ BIGINT, matching the widened column (SHAPE 1c). Declaring these INTEGER
  -- would re-impose the 2^31 ceiling inside the test harness itself, so a
  -- future overflow arm would fail on the VARIABLE rather than on the column.
  gen_mint     BIGINT;
  gen_reuse    BIGINT;
  gen_revoked  BIGINT;
  gen_remint   BIGINT;
  gen_final    BIGINT;
  gen_seen     BIGINT[] := '{}';
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
  gen_b        BIGINT;
  gen_b_after  BIGINT;
  b_revoked    TIMESTAMPTZ;
  -- TENANT 5's pre-attempt snapshot of tenant B's tombstone. Separate from
  -- `b_revoked` on purpose: the end-state arm has to compare the AFTER value
  -- against a BEFORE value it captured itself, or it cannot tell "the attack
  -- was refused" from "the setup never revoked anything".
  b_revoked_pre TIMESTAMPTZ;
  gen_pre_san  BIGINT;
  san_ok       BOOLEAN;
  gen_probe    BIGINT;
  i            INTEGER;
  -- Nonce / width introspection and the behavioural nonce arms.
  nonce_notnull  BOOLEAN;
  nonce_type     TEXT;
  nonce_default  TEXT;
  gen_type       TEXT;
  v_colgrants    TEXT;
  nonce_mint     UUID;
  nonce_reuse    UUID;
  nonce_after    UUID;
  nonce_a3_pre   UUID;
  nonce_a3_post  UUID;
  strat_a3       UUID;
  v_create_res   TEXT;
  v_trigfn_s     TEXT;
  -- N1 (164-06): the bounded-increment arms and the INSERT pin.
  strat_a4       UUID;
  gen_a4         BIGINT;
  gen_a4_pre     BIGINT;
  -- N1 2b (2026-08-28): the forced-nonce-on-INSERT pin needs its own strategy,
  -- because strat_a4 already carries the row N1 2a inserted.
  strat_a5       UUID;
  nonce_a5       UUID;
  -- SERVICE-ROLE 2f (2026-08-28): tenant A's pre-attempt state, snapshotted so
  -- the spoofed-claims arm compares against a value it captured rather than
  -- against an assumption about where the file has left strat_a.
  sr_rev_pre     TIMESTAMPTZ;
  sr_gen_pre     BIGINT;
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

  -- A THIRD A-owned strategy, used by NONCE 4 alone. It is deliberately
  -- SACRIFICIAL: that arm DELETEs it and re-creates it at the same uuid to
  -- reproduce the cascade-rebirth attack for real. Nothing else may depend on
  -- its share row surviving, and no other arm may share it — a re-created
  -- strategy is exactly the state the rest of this file does not expect.
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'strategy-shares A cascade-rebirth strategy', 'private', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a3;

  -- A FOURTH A-owned strategy, reserved for the N1 arms (164-06). It needs its
  -- own row for two reasons and both are load-bearing:
  --   * N1 2a INSERTs the share row itself, as service_role, naming
  --     `generation` — so the target must have NO existing row or
  --     UNIQUE(strategy_id) raises 23505 before the trigger is ever consulted
  --     and the arm passes on the wrong error (the defect ANON 1b records).
  --     ⛔ strat_a2 cannot be used: it is the never-shared strategy ANON 1b
  --     depends on, and minting here would re-open that same defect there.
  --   * N1 1c ACCEPTS a +1 and therefore MOVES a counter. Doing that on strat_a
  --     would shift `gen_seen`, whose observed sequence {1,1,2,2,2,3} is the
  --     end-to-end state machine this file reports. A dedicated row keeps the
  --     bound arms and the sequence independent.
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'strategy-shares A bounded-increment strategy', 'private', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a4;

  -- A FIFTH A-owned strategy, reserved for N1 2b (the forced-nonce-on-INSERT
  -- pin, 2026-08-28). It cannot share strat_a4: that row already exists by the
  -- time N1 2b runs — N1 2a inserted it — so UNIQUE(strategy_id) would raise
  -- 23505 before the trigger was consulted and the arm would pass on the wrong
  -- error, the exact defect ANON 1b and NONCE 2 both record. It cannot use
  -- strat_a2 either, for the reason given above. And it must NOT be strat_a3,
  -- which NONCE 4 destroys and re-creates.
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'strategy-shares A forced-nonce strategy', 'private', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a5;

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
  --
  -- ⚠️ `nonce` IS IN THIS SET AND IS NOT A TOKEN. D-02's line is between a
  -- value that ON ITS OWN reproduces or verifies a working link (a token, raw
  -- or hashed — forbidden) and a MAC *input* that derives nothing without
  -- SHARE_TOKEN_SECRET, which is not in this database. A leak of this table
  -- still yields only uuids, an integer and timestamps.
  -- RED-UNDER: add a `token_hash TEXT` column to the STEP 1 CREATE TABLE in
  --            migration 20260827120000.
  -- RED-UNDER-M: {"arm":"SHAPE 1","apply":[{"kind":"insert-after","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","anchor":"  generation  BIGINT      NOT NULL DEFAULT 1 CHECK (generation >= 1),","text":"\n  token_hash  TEXT,","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"'created_at,created_by,generation,id,nonce,revoked_at,strategy_id'","replace":"'created_at,created_by,generation,id,nonce,revoked_at,strategy_id,token_hash'","occurrences":1}]}
  IF v_cols IS DISTINCT FROM 'created_at,created_by,generation,id,nonce,revoked_at,strategy_id' THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 1): strategy_shares columns are "%", expected exactly "created_at,created_by,generation,id,nonce,revoked_at,strategy_id". ⛔ D-02: this table must NEVER hold a token, raw or hashed — a leak must yield only uuids, an int and timestamps.', v_cols;
  END IF;

  -- ======================================================================
  -- SHAPE 1b: the nonce column is NOT NULL with a SERVER-SIDE default
  -- ======================================================================
  -- SHAPE 1 proves the column EXISTS. It says nothing about whether the value
  -- is server-generated, and that is the whole property: a nullable nonce, or
  -- one without a DEFAULT, would have to be supplied BY THE CLIENT — which is
  -- precisely the write the column grants exist to forbid, arriving through the
  -- front door. The two failures are indistinguishable to SHAPE 1.
  -- RED-UNDER: drop `DEFAULT gen_random_uuid()` from the nonce column in the
  --            STEP 1 CREATE TABLE.
  -- RED-UNDER-M: {"arm":"SHAPE 1b","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  nonce       UUID        NOT NULL DEFAULT gen_random_uuid(),","replace":"  nonce       UUID        NOT NULL,","occurrences":1}]}
  SELECT a.attnotnull, format_type(a.atttypid, a.atttypmod),
         COALESCE(pg_get_expr(d.adbin, d.adrelid), '(none)')
    INTO nonce_notnull, nonce_type, nonce_default
    FROM pg_attribute a
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.strategy_shares'::regclass AND a.attname = 'nonce';
  IF nonce_type IS DISTINCT FROM 'uuid'
     OR nonce_notnull IS NOT TRUE
     OR nonce_default <> 'gen_random_uuid()' THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 1b): strategy_shares.nonce is (type=%, notnull=%, default=%), expected (uuid, true, gen_random_uuid()). The nonce must be SERVER-generated and mandatory: without the DEFAULT the value has to come from the client on every INSERT, which is the exact write `GRANT INSERT (strategy_id, created_by)` refuses — so mint would break for every owner, and the "fix" would be to grant INSERT(nonce), reopening the delete-and-recreate resurrection family. Without NOT NULL a row can carry a NULL witness, and every such row shares one degenerate token space.',
      nonce_type, nonce_notnull, nonce_default;
  END IF;

  -- ======================================================================
  -- SHAPE 1c: generation is BIGINT — HEADROOM, and NOT the N1 fix
  -- ======================================================================
  -- ⛔ Read the failure message before concluding anything from a green here.
  -- Widening the counter buys DISTANCE to the overflow ceiling, nothing else. A
  -- client that can WRITE `generation` reaches 2^63-1 as easily as 2^31-1, and
  -- the wedge that follows is identical and still unrecoverable without DDL.
  -- The INSERT half of that write access is closed (SHAPE 3b: `generation` is
  -- absent from the INSERT grant); the UPDATE half — a bounded-increment rule —
  -- is DEFERRED and is a merge gate for plan 164-03.
  -- RED-UNDER: change `generation BIGINT` back to `generation INTEGER` in the
  --            STEP 1 CREATE TABLE.
  -- RED-UNDER-M: {"arm":"SHAPE 1c","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  generation  BIGINT","replace":"  generation  INTEGER","occurrences":1}]}
  SELECT format_type(a.atttypid, a.atttypmod) INTO gen_type
    FROM pg_attribute a
   WHERE a.attrelid = 'public.strategy_shares'::regclass AND a.attname = 'generation';
  IF gen_type IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 1c): strategy_shares.generation is %, expected bigint. The widen is instant on an empty table and a full table REWRITE once rows exist, which is why it was pulled forward; reverting it re-introduces an INT4 ceiling that a single `PATCH {"generation": 2147483647}` can reach, after which revoke_strategy_share errors `out of range` — and the GDPR Art. 17 arm in migration 20260827130000 is the SAME statement, so the entire erasure aborts with no operator remedy.', gen_type;
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
  -- SHAPE 3: `authenticated` holds EXACTLY {SELECT} at TABLE level
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
  -- ⭐ THE EXPECTED SET NARROWED TO {SELECT} AT THE FOUNDER RULING OF
  -- 2026-08-27, and the reason is the nonce. A TABLE-level INSERT or UPDATE
  -- grant covers EVERY column, present and future — including `nonce`, whose
  -- unwritability is the entire second half of the fix. MEASURED (PostgreSQL
  -- 16) with a table-wide INSERT grant: an owner SELECTs their own nonce under
  -- RLS, DELETEs their `strategies` row so the CASCADE takes the share row,
  -- re-INSERTs the strategy at the same client-suppliable uuid, and re-inserts
  -- the share row VERBATIM — the nonce came back bit-identical and the revoked
  -- token derives again. The write grants are therefore COLUMN-scoped, pinned
  -- separately by SHAPE 3b, and this arm is what stops a table-level grant from
  -- silently re-covering everything.
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
  -- RED-UNDER: restore `GRANT SELECT, INSERT, UPDATE ON strategy_shares TO
  --            authenticated` in migration 20260827120000 STEP 2.
  -- RED-UNDER-M: {"arm":"SHAPE 3","apply":[{"kind":"sql","stmt":"GRANT SELECT, INSERT, UPDATE ON strategy_shares TO authenticated"}]}
  IF v_privs IS DISTINCT FROM ARRAY['SELECT']::TEXT[] THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 3): `authenticated` holds TABLE-level privilege set % on strategy_shares, expected exactly {SELECT}. A table-level INSERT or UPDATE covers EVERY column including `nonce` — MEASURED: with it, an owner re-inserts a recorded nonce verbatim after cascading the row away and the revoked token derives again. DELETE lets one tenant discard their counter; TRUNCATE — EXEMPT FROM RLS — does it for EVERY tenant at once. Migration 20260827120000 STEP 2 must REVOKE ALL then GRANT SELECT at table level and the writes per COLUMN.', COALESCE(v_privs::TEXT, '(none)');
  END IF;

  -- ======================================================================
  -- SHAPE 3b: the COLUMN-level write grants are EXACTLY the four allowed
  -- ======================================================================
  -- ⛔ SHAPE 3 CANNOT SEE THIS AND IS NOT A SUBSTITUTE. Table grants live in
  -- `pg_class.relacl`; COLUMN grants live in `pg_attribute.attacl` and are
  -- INVISIBLE to relacl. A single `GRANT INSERT (nonce) ON strategy_shares TO
  -- authenticated` leaves SHAPE 3 reading a serene `{SELECT}` while the entire
  -- fix is undone. That grant is also the exact edit a future engineer reaches
  -- for the moment `create_strategy_share` starts failing 42501 because someone
  -- named `nonce` in its INSERT — which is why SHAPE 4d pins the other side of
  -- the same coupling.
  --
  -- ⚠️ THE RATIONALE BELOW WAS RESTATED 2026-08-28. It used to argue that these
  -- grants are the SOLE control on a fresh row because "the trigger is BEFORE
  -- UPDATE only, so a fresh row is seen by no rule at all". That was true when
  -- it was written and has been FALSE since 164-06 widened the trigger to
  -- BEFORE INSERT OR UPDATE. Two layers now cover a fresh row, and saying so
  -- matters in both directions: a reader who believes the grant is the only
  -- control over-weights it, and a reader who learns the trigger covers INSERT
  -- may conclude the grant is redundant. It is not — see below.
  --
  -- The set is asserted EXACTLY, in both directions:
  --   * `nonce` must be ABSENT — its unwritability is the `authenticated`-side
  --     layer of what makes a destroyed-and-recreated row land in a disjoint
  --     token space. The trigger's INSERT branch re-rolls the nonce and is the
  --     layer that covers the roles a grant cannot bind (N1 2b);
  --   * `generation` and `revoked_at` must be absent from the INSERT half. The
  --     trigger's INSERT branch FORCES generation to 1, so a widened grant no
  --     longer plants a chosen starting counter — but `revoked_at` is covered by
  --     NO rule on the INSERT path at all (rule (2) fires only on the
  --     NULL -> NOT NULL transition of an UPDATE), so a client holding
  --     `INSERT (revoked_at)` could still pre-stamp a tombstone on a fresh row.
  --     For `generation` the grant is now the CHEAP detector rather than the
  --     only one, and it is kept for defence in depth and because a grant is
  --     the only control that automatically covers columns added in future;
  --   * `strategy_id` and `created_by` must be PRESENT on INSERT, and
  --     `revoked_at`/`generation` on UPDATE, or both SECURITY INVOKER RPCs stop
  --     working for every owner (mint, reuse and revoke all write as the
  --     caller). This arm is the positive control for its own negative.
  -- RED-UNDER: add `GRANT INSERT (nonce) ON strategy_shares TO authenticated`
  --            to migration 20260827120000 STEP 2.
  -- RED-UNDER-M: {"arm":"SHAPE 3b","apply":[{"kind":"sql","stmt":"GRANT INSERT (nonce) ON strategy_shares TO authenticated"}]}
  SELECT string_agg(a.attname || ':' || acl.privilege_type, ',' ORDER BY a.attname, acl.privilege_type)
    INTO v_colgrants
    FROM pg_attribute a
    CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
   WHERE a.attrelid = 'public.strategy_shares'::regclass
     AND a.attnum > 0 AND NOT a.attisdropped
     AND r.rolname = 'authenticated';
  IF v_colgrants IS DISTINCT FROM 'created_by:INSERT,generation:UPDATE,revoked_at:UPDATE,strategy_id:INSERT' THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 3b): `authenticated` holds COLUMN-level grants "%" on strategy_shares, expected exactly "created_by:INSERT,generation:UPDATE,revoked_at:UPDATE,strategy_id:INSERT". ⛔ A grant naming `nonce` re-opens the `authenticated` side of the delete-and-recreate resurrection family: the owner reads their nonce under RLS, cascades the row away via `strategies`, and re-inserts it verbatim (MEASURED — accepted, bit-identical, before the trigger gained its INSERT branch). ⛔ An INSERT grant naming `revoked_at` re-opens R3''s INSERT half outright — NO trigger rule covers a tombstone on a fresh row, because rule (2) fires only on the NULL to NOT NULL transition of an UPDATE. ⚠️ An INSERT grant naming `generation` or `nonce` is now caught a second time by the trigger''s INSERT branch, which FORCES both (N1 2a, N1 2b); that makes this arm the cheap detector rather than the last line for those two columns, and it is kept because a grant is the only control that automatically covers columns added to this table in future. ⚠️ And a MISSING grant is equally fatal in the other direction — both RPCs are SECURITY INVOKER and write as the caller, so mint or revoke would 42501 for every owner.', COALESCE(v_colgrants, '(none)');
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
  -- SHAPE 4d: create_strategy_share NEVER NAMES `nonce` as a write target
  -- ======================================================================
  -- ⭐ THIS IS THE OTHER HALF OF SHAPE 3b, AND THE PAIR IS THE POINT. SHAPE 3b
  -- proves the PRIVILEGE on `nonce` is absent; this proves the STATEMENT does
  -- not need it. They fail on opposite edits, and the failure mode they jointly
  -- prevent is a two-step one that neither catches alone: someone adds `nonce`
  -- to the INSERT column list (harmless-looking, "be explicit"), every owner's
  -- mint starts returning 42501 because PostgreSQL checks column privilege
  -- against the columns a statement NAMES, and the obvious remedy is to widen
  -- the grant — at which point the resurrection family is back and SHAPE 3b is
  -- the only thing left objecting.
  --
  -- Comment-stripped, like every body probe here: STEP 3's body discusses the
  -- nonce at length in prose, and an unstripped regex would fire on the
  -- COMMENT rather than on code.
  -- RED-UNDER: change STEP 3's INSERT to
  --            `INSERT INTO public.strategy_shares (strategy_id, created_by, nonce)`.
  -- RED-UNDER-M: {"arm":"SHAPE 4d","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"INSERT INTO public.strategy_shares (strategy_id, created_by)","replace":"INSERT INTO public.strategy_shares (strategy_id, created_by, nonce)","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_create_s ~* 'INSERT\\s+INTO\\s+public\\.strategy_shares\\s*\\([^)]*\\mnonce\\M'\n     OR v_create_s ~* 'SET[^;]*\\mnonce\\s*=' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  IF v_create_s ~* 'INSERT\s+INTO\s+public\.strategy_shares\s*\([^)]*\mnonce\M'
     OR v_create_s ~* 'SET[^;]*\mnonce\s*=' THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 4d): create_strategy_share NAMES `nonce` as a write target. It is DEFAULT-populated and read back through RETURNING precisely so the column grant can exclude it; naming it makes this SECURITY INVOKER function fail 42501 for every owner, and the natural "fix" (GRANT INSERT (nonce)) restores the delete-and-recreate resurrection the nonce exists to close.';
  END IF;

  -- ======================================================================
  -- SHAPE 4e: ...but it MUST hand the nonce back
  -- ======================================================================
  -- Catalog-based rather than a text probe, because the OUT shape is the
  -- contract the Node caller is typed against: a body that read the nonce into
  -- a local and dropped it would satisfy any regex over the text while the mint
  -- route received nothing to derive from.
  --
  -- ⚠️ It ALSO detects a conversion to OUT parameters, which is not cosmetic:
  -- MEASURED (PostgreSQL 16), OUT parameters change
  -- `pg_get_function_identity_arguments` to
  -- `p_strategy_id uuid, OUT generation bigint, OUT nonce uuid`, and every
  -- lookup in this file and in the migration that matches `= 'p_strategy_id
  -- uuid'` then silently returns ZERO ROWS — SHAPE 4a is what would catch it,
  -- but only because 4a asserts non-NULL. `RETURNS TABLE` leaves identity
  -- arguments byte-unchanged, which is why it is the shape that shipped.
  -- RED-UNDER: change STEP 3's signature to `RETURNS TABLE (generation BIGINT)`
  --            (and drop the matching RETURNING/INTO targets).
  -- RED-UNDER-M: {"arm":"SHAPE 4e","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"RETURNS TABLE (generation BIGINT, nonce UUID)","replace":"RETURNS TABLE (generation BIGINT)","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  RETURNING strategy_shares.generation, strategy_shares.nonce\n       INTO create_strategy_share.generation, create_strategy_share.nonce;\n","replace":"  RETURNING strategy_shares.generation\n       INTO create_strategy_share.generation;\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_create_res IS NULL\n     OR v_create_res !~* 'TABLE\\s*\\([^)]*\\mnonce\\s+uuid\\M'\n     OR v_create_res !~* 'TABLE\\s*\\([^)]*\\mgeneration\\s+bigint\\M' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  SELECT pg_get_function_result(p.oid) INTO v_create_res
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_strategy_share'
     AND pg_get_function_identity_arguments(p.oid) = 'p_strategy_id uuid';
  IF v_create_res IS NULL
     OR v_create_res !~* 'TABLE\s*\([^)]*\mnonce\s+uuid\M'
     OR v_create_res !~* 'TABLE\s*\([^)]*\mgeneration\s+bigint\M' THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 4e): create_strategy_share does not declare `TABLE(generation bigint, nonce uuid)` — its declared result is "%". The token is HMAC(secret, over the tag "qz.strategy-share.v1" then strategy_id then nonce then generation — spelled without pipes because a RAISE format slot must be ONE literal and src/__tests__/raise-exception-concat-grammar.test.ts cannot tell prose from a real concat); with no nonce coming back the mint route cannot derive a link at all, and the tempting repair is to drop the nonce from the pre-image, which silently restores the pre-fix resurrection behaviour. ⛔ A bare `record` means someone converted the signature to OUT parameters, which ALSO voids every `= ''p_strategy_id uuid''` lookup in this file.', COALESCE(v_create_res, '(function not found)');
  END IF;

  -- ======================================================================
  -- SHAPE 5: the trigger exists, BEFORE **INSERT OR UPDATE**, FOR EACH ROW
  -- ======================================================================
  -- Structural companion to the behavioural TRIGGER 1 / TRIGGER 2 arms below.
  -- It is not redundant with them: those two also go RED if the trigger is
  -- merely DROPPED, but they cannot distinguish a correct trigger from one
  -- re-created with the wrong timing, level or EVENT SET, and every such
  -- miscreation silently stops guarding:
  --   * AFTER instead of BEFORE — it still raises, but any AFTER trigger
  --     ordered ahead of it has already observed the rewound row;
  --   * STATEMENT instead of ROW — OLD/NEW do not exist, so the body becomes a
  --     runtime error on EVERY update rather than a guard on the bad ones;
  --   * UPDATE only, without INSERT — the R3 INSERT pin (forced generation,
  --     forced nonce) is silently retired for every role a column grant does
  --     not bind.
  -- ⛔⛔ THE INSERT BIT IS ASSERTED SEPARATELY AND THAT WAS A REAL GAP, not a
  -- tidy-up. 164-06 widened the trigger to BEFORE INSERT OR UPDATE and taught
  -- migration 20260827120000's STEP 6 arm (v) to test bit 2; THIS arm — the
  -- DURABLE pin, the one that re-runs on every CI push, against the live
  -- catalog — never received the same fix and still tested bits 1, 2 and 16
  -- only. `&` masking means a trigger narrowed back to `BEFORE UPDATE`
  -- satisfies every one of those terms. MEASURED 2026-08-28: with the trigger
  -- changed to `BEFORE UPDATE ON strategy_shares` (and migration arm (v)'s
  -- INSERT term removed so the apply survived), SHAPE 5 PASSED and the file ran
  -- on for sixteen more arms before N1 2a caught it BEHAVIOURALLY — "a
  -- service_role INSERT naming generation = 987654321 landed at 987654321".
  -- A structural pin that a behavioural arm has to rescue is not a pin.
  -- Each event the guard claims to cover needs its own bit test.
  -- tgtype bit 0 = ROW, bit 1 = BEFORE, bit 2 = INSERT, bit 4 = UPDATE.
  -- RED-UNDER: change the CREATE TRIGGER in migration 20260827120000 STEP 1b to
  --            `BEFORE UPDATE ON strategy_shares`.
  -- ⚠️ LAYERED: migration arm (v) tests the same bit and ABORTS THE APPLY, so
  --    its `AND (t.tgtype & 4) = 4` term must be removed in the same mutation
  --    or this file never runs. With both gone SHAPE 5 is the first failure
  --    (MEASURED) — where before the fix it was silent and N1 2a was.
  -- RED-UNDER-M: {"arm":"SHAPE 5","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  BEFORE INSERT OR UPDATE ON strategy_shares","replace":"  BEFORE UPDATE ON strategy_shares","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"     AND (t.tgtype & 4) = 4\n","replace":"","occurrences":1}]}
  SELECT count(*) INTO row_cnt
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.strategy_shares'::regclass
     AND NOT t.tgisinternal
     AND t.tgname = 'strategy_shares_monotonic_generation'
     AND (t.tgtype & 1) = 1
     AND (t.tgtype & 2) = 2
     AND (t.tgtype & 4) = 4
     AND (t.tgtype & 16) = 16;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 5): expected exactly 1 BEFORE INSERT OR UPDATE FOR EACH ROW trigger named strategy_shares_monotonic_generation on strategy_shares, found %. Without its UPDATE half the owner''s UPDATE grant on (revoked_at, generation) plus the FOR ALL policy let a raw PATCH rewind the counter — MEASURED (PostgreSQL 16): generation went 2 -> 1 and revoked_at was cleared in ONE request, resurrecting every link the owner had revoked. Without its INSERT half a role that bypasses grants lands a fresh row at a starting generation AND a nonce of its own choosing, which no column grant reaches — that is the whole delete-and-recreate resurrection family, and it is what N1 2a and N1 2b prove behaviourally. ⛔ A trigger is also the ONLY control on this table that binds service_role, which BYPASSRLS exempts from every policy here and which GRANT ALL exempts from every column grant.', row_cnt;
  END IF;

  -- ======================================================================
  -- SHAPE 5b: ...and the trigger function still carries rule (0c)
  -- ======================================================================
  -- SHAPE 5 proves a trigger of the right TIMING and LEVEL exists; it says
  -- nothing about what the function behind it compares, so a CREATE OR REPLACE
  -- that quietly drops one rule passes it unchanged. Rule (0c) is the one most
  -- likely to be dropped by accident and least likely to be missed by anything
  -- else, because STEP 2's column grant already denies the same write to
  -- `authenticated` — so its ONLY observable caller is service_role, and every
  -- client-role arm in this file stays green without it. NONCE 5 is the
  -- behavioural pin; this is the structural one, and it fires even if a future
  -- edit removes the service_role fixture NONCE 5 depends on.
  -- Comment-stripped for the usual reason: the trigger body labels its rules in
  -- prose, so a raw-text probe could be satisfied by the label.
  -- RED-UNDER: delete the `IF NEW.nonce IS DISTINCT FROM OLD.nonce` block from
  --            strategy_shares_enforce_monotonic_generation() (STEP 1b).
  -- RED-UNDER-M: {"arm":"SHAPE 5b","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF NEW.nonce IS DISTINCT FROM OLD.nonce THEN\n    RAISE EXCEPTION 'strategy_shares: nonce is immutable — refusing to rewrite the MAC witness on strategy %. The nonce is what makes a destroyed-and-recreated row land in a token space DISJOINT from every token ever issued; letting it be written back restores a recorded value and resurrects those tokens. STEP 2''s column grant already denies this to `authenticated`, so a write that reaches this rule came from a role that BYPASSES grants — service_role, which holds GRANT ALL and is on this feature''s hot path. A trigger is the only control on this table that binds it.',\n      OLD.strategy_id\n      USING ERRCODE = 'check_violation';\n  END IF;\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_trigfn_s !~* 'NEW\\.nonce\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.nonce' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') INTO v_trigfn_s
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'strategy_shares_enforce_monotonic_generation';
  IF v_trigfn_s IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 5b-pre): the trigger function body could not be read, so the rule probe below would be VACUOUSLY true on NULL';
  END IF;
  IF v_trigfn_s !~* 'NEW\.nonce\s+IS\s+DISTINCT\s+FROM\s+OLD\.nonce' THEN
    RAISE EXCEPTION 'TEST FAILED (SHAPE 5b): the monotonicity trigger lost rule (0c) — the nonce is no longer immutable. STEP 2''s column grant hides this from every `authenticated` arm in this file, so the loss is INVISIBLE except through service_role: MEASURED, `SET ROLE service_role; UPDATE strategy_shares SET nonce = <recorded value>` was ACCEPTED with the rule absent, restoring a nonce and re-deriving every token that row ever issued.';
  END IF;

  -- ======================================================================
  -- OWNER 1: positive control — the owner CAN mint, and the first mint is gen 1
  -- ======================================================================
  -- Without a positive control, a policy of `WITH CHECK (false)` would satisfy
  -- every negative arm below while breaking the entire feature.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- ⚠️ CALL SHAPE CHANGED. create_strategy_share now returns
  -- `TABLE(generation bigint, nonce uuid)` — the recipient lane needs BOTH to
  -- derive the token — so every call site is a `SELECT ... FROM fn(...)`, not a
  -- scalar `SELECT fn(...)`. The alias `c` keeps `c.generation` unambiguous
  -- against the plpgsql variables of the same name.
  SELECT c.generation, c.nonce INTO gen_mint, nonce_mint
    FROM public.create_strategy_share(strat_a) c;
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
  -- OWNER 1c: the mint hands back a real, server-generated nonce
  -- ======================================================================
  -- SHAPE 4e pins the DECLARED result type; this pins that a value actually
  -- arrives. A signature can promise `nonce uuid` and return NULL for it — from
  -- a RETURNING that lost the column, or a RETURN NEXT reached before the
  -- assignment — and every downstream arm comparing two nonces would then be
  -- comparing NULL to NULL. `IS DISTINCT FROM` (which those arms use, correctly,
  -- so a NULL cannot masquerade as equality) would report them as the same, and
  -- OWNER 2d's "reuse returns the same nonce" would pass VACUOUSLY.
  -- RED-UNDER: drop `strategy_shares.nonce` from STEP 3's RETURNING/INTO lists
  --            while leaving the RETURNS TABLE signature intact.
  -- RED-UNDER-M: {"arm":"OWNER 1c","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  RETURNING strategy_shares.generation, strategy_shares.nonce\n       INTO create_strategy_share.generation, create_strategy_share.nonce;\n","replace":"  RETURNING strategy_shares.generation\n       INTO create_strategy_share.generation;\n","occurrences":1}]}
  IF nonce_mint IS NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (OWNER 1c): create_strategy_share returned a NULL nonce. The token derives from it, so the mint route would HMAC over the string "null" for every strategy — one shared token space, and a single leaked link would verify against every other strategy at the same generation. It also makes every nonce-comparison arm below vacuous.';
  END IF;

  -- ======================================================================
  -- OWNER 2: REUSE (SHARE-01) — minting again while live is idempotent
  -- ======================================================================
  -- This is the requirement the whole generation model exists to satisfy. A
  -- verbatim port of the scenario spine (hash-at-rest + unconditional
  -- pre-revoke on mint) would return a DIFFERENT value here and silently kill
  -- the recipient's existing link — the founder-hit defect.
  SELECT c.generation, c.nonce INTO gen_reuse, nonce_reuse
    FROM public.create_strategy_share(strat_a) c;
  IF gen_reuse <> gen_mint THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (OWNER 2a): re-minting a LIVE share returned generation % but the first mint returned % — Copy Link would hand out a different url and break the recipient''s existing link (SHARE-01 reuse)', gen_reuse, gen_mint;
  END IF;
  gen_seen := gen_seen || gen_reuse;

  -- ⭐ OWNER 2d: reuse must return the SAME NONCE, not merely the same
  -- generation. The nonce joined the MAC pre-image, so it is now a second way
  -- to break SHARE-01 that OWNER 2a cannot see at all: a mint path that
  -- re-rolled the nonce (an `ON CONFLICT DO UPDATE SET nonce =
  -- gen_random_uuid()`, or an INSERT that lost its conflict target and landed a
  -- second row) would hold the counter steady and STILL hand out a different
  -- URL on every click — which is precisely the founder-hit defect this phase
  -- exists to remove, now reachable through a column that did not exist when
  -- OWNER 2a was written.
  -- RED-UNDER: add `, nonce = gen_random_uuid()` to STEP 3's DO UPDATE SET list.
  -- ⚠️ THIS ARM IS THE FOURTH LINE, NOT THE FIRST, and saying so is the point.
  -- "The mint writes the nonce" is refused by THREE earlier controls, each of
  -- which had to be removed before this arm could be observed red (MEASURED,
  -- 2026-08-27): the column grant (SHAPE 3b), the body-text pin (SHAPE 4d), and
  -- trigger rule (0c) at RUNTIME (SHAPE 5b / NONCE 5) — the trigger refuses the
  -- UPDATE even with the grant widened AND the body edited. With all three
  -- gone, this arm is the first failure. It is kept because it is the only one
  -- that states the CONSEQUENCE in the language the requirement is written in
  -- — Copy Link stops returning the same URL — and because a future engineer
  -- rewriting the catalog pins would otherwise take the whole defence with them.
  -- RED-UNDER-M: {"arm":"OWNER 2d","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"    SET revoked_at = NULL","replace":"    SET revoked_at = NULL, nonce = gen_random_uuid()","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_create_s ~* 'INSERT\\s+INTO\\s+public\\.strategy_shares\\s*\\([^)]*\\mnonce\\M'\n     OR v_create_s ~* 'SET[^;]*\\mnonce\\s*=' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF NEW.nonce IS DISTINCT FROM OLD.nonce THEN\n    RAISE EXCEPTION 'strategy_shares: nonce is immutable — refusing to rewrite the MAC witness on strategy %. The nonce is what makes a destroyed-and-recreated row land in a token space DISJOINT from every token ever issued; letting it be written back restores a recorded value and resurrects those tokens. STEP 2''s column grant already denies this to `authenticated`, so a write that reaches this rule came from a role that BYPASSES grants — service_role, which holds GRANT ALL and is on this feature''s hot path. A trigger is the only control on this table that binds it.',\n      OLD.strategy_id\n      USING ERRCODE = 'check_violation';\n  END IF;\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_trigfn_s !~* 'NEW\\.nonce\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.nonce' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1},{"kind":"sql","stmt":"GRANT UPDATE (nonce) ON strategy_shares TO authenticated"}],"neuter":[{"arm":"SHAPE 3b"},{"arm":"SHAPE 4d"},{"arm":"SHAPE 5b"}]}
  IF nonce_reuse IS DISTINCT FROM nonce_mint THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (OWNER 2d): re-minting a LIVE share returned nonce % but the first mint returned % — the generation held steady, so OWNER 2a passed, yet the derived token CHANGED. Copy Link hands out a new url and silently breaks the recipient''s existing link: the founder-hit defect, wearing the nonce as its new hat.', nonce_reuse, nonce_mint;
  END IF;

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
  -- N1 2a: a service_role INSERT that NAMES generation still lands at 1
  -- ======================================================================
  -- ⛔ THE COLUMN GRANT CANNOT BE WHAT PROVES THIS, which is the whole point of
  -- running the probe as service_role. STEP 2 omits `generation` from
  -- authenticated's INSERT grant, so an owner naming it gets 42501 and never
  -- reaches the table — a green there measures the GRANT. `service_role` holds
  -- GRANT ALL and BYPASSRLS, so for it the grant layer does not exist and the
  -- only thing left is the trigger's `TG_OP = 'INSERT'` branch. That role is not
  -- hypothetical here: migration 20260827120000 STEP 2 records that this
  -- feature's recipient lane already reads this table through
  -- `createAdminClient()`.
  --
  -- WHY IT MATTERS. A row minted at a chosen starting counter is a token
  -- forgery primitive: land generation at a value some already-revoked token was
  -- issued under and that token derives again, as anonymous access to an
  -- unpublished factsheet. FORCING the value (rather than rejecting a wrong one)
  -- is what makes the starting counter inexpressible instead of merely guarded.
  --
  -- RED-UNDER: delete the `NEW.generation := 1;` assignment from the
  --            `IF TG_OP = 'INSERT'` branch of
  --            strategy_shares_enforce_monotonic_generation() (STEP 1b),
  --            keeping the guard and its RETURN.
  -- ⛔ NOT "delete the whole branch", and the difference is not pedantry: on an
  -- INSERT `OLD` is unassigned, so with the early return gone the next rule
  -- raises `record old is not assigned yet` and this file dies on a PL/pgSQL
  -- error rather than on this arm. The assignment is the part that carries the
  -- security property, so the assignment is what the mutation removes.
  -- ⚠️ LAYERED, and said plainly rather than implied: migration 20260827120000's
  -- own STEP 6 arm (v-d) greps for `NEW.generation := 1` and ABORTS THE APPLY
  -- without it, so (v-d) must be removed in the same mutation or this file never
  -- runs. Same shape as SHAPE 5b vs (v-c), and as OWNER 2d's three earlier
  -- layers. With both gone this arm is the first failure (MEASURED).
  -- RED-UNDER-M: {"arm":"N1 2a","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"    NEW.generation := 1;\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_trigfn_s !~* 'TG_OP\\s*=\\s*''INSERT'''\n     OR v_trigfn_s !~* 'NEW\\.generation\\s*:=\\s*1' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  SET LOCAL ROLE service_role;
  INSERT INTO strategy_shares (strategy_id, created_by, generation)
  VALUES (strat_a4, uid_a, 987654321);
  SET LOCAL ROLE authenticated;

  SELECT generation INTO gen_a4 FROM strategy_shares WHERE strategy_id = strat_a4;
  IF gen_a4 IS DISTINCT FROM 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (N1 2a): a service_role INSERT naming generation = 987654321 landed at %, expected 1. The trigger no longer FORCES the starting counter on INSERT, and no column grant binds this caller — service_role holds GRANT ALL and BYPASSRLS and is what createAdminClient() connects as. A row minted at a counter some already-revoked token was issued under re-derives that token: anonymous access to an unpublished factsheet, from a value the writer chose.', gen_a4;
  END IF;

  -- ======================================================================
  -- N1 2b: ...and a service_role INSERT that NAMES a RECORDED nonce gets a
  --        FRESH one — the other half of the same forgery primitive
  -- ======================================================================
  -- ⛔ N1 2a DOES NOT COVER THIS AND THE PAIR IS THE POINT. `generation` and
  -- `nonce` are the two MAC inputs; forcing one while the other stays
  -- caller-suppliable closes nothing, because the token is derived from BOTH.
  -- Before the 2026-08-28 fix the trigger forced only `generation`, and that
  -- made the hole WORSE rather than better — the clamp back to 1 is what
  -- reconstructed the ORIGINAL counter. MEASURED end-to-end on a throwaway
  -- PostgreSQL 16 cluster:
  --   1. owner mints                    -> generation 1, nonce N
  --   2. owner revokes                  -> generation 2; the token over (N, 1)
  --                                        is now DEAD
  --   3. `SET ROLE service_role; DELETE FROM strategy_shares WHERE ...`
  --   4. `SET ROLE service_role; INSERT INTO strategy_shares
  --       (strategy_id, created_by, nonce) VALUES (..., N)`
  --   -> stored row: generation 1, nonce N, revoked_at NULL. Byte-identical to
  --      the pre-revoke triple, so the REVOKED url resolves again — and steps
  --      3+4 also fully reverse a completed Art. 17 erasure, restoring links the
  --      regulation required to be killed.
  --
  -- ⛔ RUN AS service_role, exactly like N1 2a and for the same reason: STEP 2
  -- omits `nonce` from authenticated's INSERT grant, so an owner naming it gets
  -- 42501 and never reaches the table (that is NONCE 2a, and it measures the
  -- GRANT). This arm measures the TRIGGER, against the one role no grant binds.
  -- The recorded value is `nonce_mint` — tenant A's real, live nonce — so a
  -- green here is not an accident of using an unrelated uuid.
  -- RED-UNDER: delete the `NEW.nonce := gen_random_uuid();` assignment from the
  --            `IF TG_OP = 'INSERT'` branch of
  --            strategy_shares_enforce_monotonic_generation() (STEP 1b).
  -- ⚠️ LAYERED: migration 20260827120000's STEP 6 arm (v-d2) greps for
  --    `NEW.nonce :=` and ABORTS THE APPLY without it, so (v-d2) must be removed
  --    in the same mutation or this file never runs. With both gone this arm is
  --    the first failure (MEASURED).
  -- RED-UNDER-M: {"arm":"N1 2b","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"    NEW.nonce := gen_random_uuid();\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_trigfn_s !~* 'NEW\\.nonce\\s*:=' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  SET LOCAL ROLE service_role;
  INSERT INTO strategy_shares (strategy_id, created_by, nonce)
  VALUES (strat_a5, uid_a, nonce_mint);
  SET LOCAL ROLE authenticated;

  SELECT nonce INTO nonce_a5 FROM strategy_shares WHERE strategy_id = strat_a5;
  IF nonce_a5 IS NULL OR nonce_a5 = nonce_mint THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (N1 2b): a service_role INSERT naming nonce = % stored %, expected a DIFFERENT, server-generated value. The trigger no longer FORCES the nonce on INSERT, and the column DEFAULT does not cover this — a DEFAULT applies only when the statement does not NAME the column, and no grant binds this caller. Combined with the forced `generation := 1` that N1 2a pins, an admin transport can DELETE a revoked row and re-insert it with the recorded nonce to rebuild the exact pre-revoke (nonce, generation, live) triple: every token that row ever issued derives again, and a completed GDPR Art. 17 erasure is reversed.', nonce_mint, COALESCE(nonce_a5::TEXT, '(no row)');
  END IF;

  -- ======================================================================
  -- N1 1a: the CEILING JUMP is refused (the whole of N1)
  -- ======================================================================
  -- MEASURED at HEAD before this fix (EXECUTION-EVIDENCE.md §5): the owner holds
  -- the STEP 2 `UPDATE (revoked_at, generation)` column grant, the FOR ALL
  -- policy admits their own-row write, and rule (1) forbids only a DECREASE — so
  -- `PATCH {"generation": 9223372036854775807}` was ACCEPTED. After it,
  -- revoke_strategy_share WEDGED on 22003 and sanitize_user ABORTED THE ENTIRE
  -- GDPR ART. 17 ERASURE on the same `generation + 1` statement. A data subject
  -- could wedge their own erasure with one request.
  -- ⚠️ BIGINT did not close this and this arm is why the file says so out loud:
  -- 2^63-1 is one PATCH away from any value, exactly like 2^31-1.
  -- RED-UNDER: delete the `IF NEW.generation > OLD.generation + 1` block from
  --            strategy_shares_enforce_monotonic_generation() (STEP 1b).
  -- ⚠️ LAYERED: migration 20260827120000 STEP 6 arm (v-e) greps for that block
  --            and aborts the apply without it, so remove (v-e) too. With both
  --            gone this arm is the first failure in the file (MEASURED).
  -- RED-UNDER-M: {"arm":"N1 1a","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF NEW.generation > OLD.generation + 1 THEN\n    RAISE EXCEPTION 'strategy_shares: generation may advance by AT MOST ONE per statement — refusing to move it from % to % on strategy %. An unbounded jump does not merely skip numbers: it drives the counter to the BIGINT ceiling in ONE request from an ordinary owner token (they hold the STEP 2 UPDATE(generation) column grant, and rule (1) forbids only a DECREASE). After that, revoke_strategy_share and the GDPR Art. 17 erasure arm in migration 20260827130000 are the SAME generation + 1 statement, so both raise 22003 numeric_value_out_of_range and the data subject has WEDGED THEIR OWN ERASURE with one PATCH (MEASURED 2026-08-27). Bounding every advance to +1 is what makes that overflow unreachable by construction.',\n      OLD.generation, NEW.generation, OLD.strategy_id\n      USING ERRCODE = 'check_violation';\n  END IF;\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_trigfn_s !~* 'NEW\\.generation\\s*>\\s*OLD\\.generation\\s*\\+\\s*1' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  raised := FALSE; err_msg := NULL;
  BEGIN
    UPDATE strategy_shares SET generation = 9223372036854775807 WHERE strategy_id = strat_a4;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  -- Message-pinned as well as `raised`, for the reason TRIGGER 1b records: all
  -- of this trigger's rules share `check_violation`, so a rejection by rule (1)
  -- or (2) — or by a lost grant — would otherwise be read as the bound biting.
  IF NOT raised OR err_msg NOT LIKE '%AT MOST ONE%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (N1 1a): the owner drove generation to the BIGINT ceiling with a raw UPDATE and the bounded-increment rule did not stop it (raised=%, error=%). revoke_strategy_share and the GDPR Art. 17 arm in migration 20260827130000 are the SAME generation + 1 statement, so both then raise 22003 and the data subject has WEDGED THEIR OWN ERASURE using a column the product grants them.', raised, COALESCE(err_msg, '(none)');
  END IF;

  -- ======================================================================
  -- N1 1b: +2 is refused as well — the off-by-one neighbour
  -- ======================================================================
  -- ⭐ WITHOUT THIS ARM, N1 1a CANNOT TELL `+ 1` FROM `+ 2`. A rule written
  -- `NEW.generation > OLD.generation + 2` still refuses 2^63-1, so 1a stays
  -- green while the counter may jump two at a time — and a two-step advance
  -- skips a generation that no token was ever issued under, which is harmless,
  -- but the rule it proves is no longer the rule the file claims. This arm is
  -- what pins the constant, and it is the difference between "bounded" and
  -- "bounded by ONE".
  -- RED-UNDER: change `OLD.generation + 1` to `OLD.generation + 2` in rule (6).
  --            No other arm in this file or in the migration moves.
  -- RED-UNDER-M: {"arm":"N1 1b","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF NEW.generation > OLD.generation + 1 THEN","replace":"  IF NEW.generation > OLD.generation + 2 THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_trigfn_s !~* 'NEW\\.generation\\s*>\\s*OLD\\.generation\\s*\\+\\s*1' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  raised := FALSE; err_msg := NULL;
  BEGIN
    UPDATE strategy_shares SET generation = generation + 2 WHERE strategy_id = strat_a4;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised OR err_msg NOT LIKE '%AT MOST ONE%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (N1 1b): the owner advanced generation by TWO in one raw UPDATE and the rule did not stop it (raised=%, error=%). The bound is not "advance by at most one" but something looser, so N1 1a above is proving a weaker property than its name claims — and whatever the real constant is, nothing in this file pins it.', raised, COALESCE(err_msg, '(none)');
  END IF;

  -- ======================================================================
  -- N1 1c: ...and +1 is still ACCEPTED — the bound did not brick the writers
  -- ======================================================================
  -- ⛔ THE COUNTER-ARM TO 1a AND 1b, and the reason it exists is that the
  -- cheapest way to make both of those pass is to refuse EVERY increase — which
  -- would disarm revocation entirely (revoke_strategy_share and the Art. 17
  -- erasure arm are both `generation = generation + 1`) while leaving this
  -- file's rejection arms green. A guard that refuses the intended writers is
  -- not a guard, it is an outage.
  -- RED-UNDER: change rule (6) to `NEW.generation >= OLD.generation + 1`, i.e.
  --            refuse any increase at all.
  -- ⚠️ LAYERED, and this note was MISSING while its two siblings carried one —
  --    N1 1a and N1 3a both record it, so its absence here read as "this
  --    mutation stands alone", which it does not. Migration 20260827120000's
  --    STEP 6 arm (v-e) greps for the literal `NEW.generation > OLD.generation
  --    + 1`; the `>=` form does not match that regex, so the arm ABORTS THE
  --    APPLY and this file never runs at all. (v-e) must be removed in the same
  --    mutation. With both gone this arm is the first failure.
  -- ⚠️ POSITION IS LOAD-BEARING. This arm sits BEFORE the first
  --    revoke_strategy_share call (REVOKE 1a below), because that call performs
  --    the identical `+ 1` and would abort the file first under the same
  --    mutation — leaving this arm structurally unobservable. Moving it after
  --    REVOKE 1 silently retires it. MEASURED red in this position.
  -- RED-UNDER-M: {"arm":"N1 1c","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF NEW.generation > OLD.generation + 1 THEN","replace":"  IF NEW.generation >= OLD.generation + 1 THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_trigfn_s !~* 'NEW\\.generation\\s*>\\s*OLD\\.generation\\s*\\+\\s*1' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  gen_a4_pre := gen_a4;
  raised := FALSE; err_msg := NULL;
  BEGIN
    UPDATE strategy_shares SET generation = generation + 1 WHERE strategy_id = strat_a4;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  SELECT generation INTO gen_a4 FROM strategy_shares WHERE strategy_id = strat_a4;
  -- Subtract rather than add, for the reason N1 3a records at the end of this
  -- file: `gen_a4_pre + 1` overflows in precisely the states where this arm is
  -- interesting, and an arm that aborts on its own arithmetic reports nothing.
  IF raised OR (gen_a4 - gen_a4_pre) IS DISTINCT FROM 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (N1 1c): a lawful +1 advance was refused or did not land (raised=%, error=%, generation % -> %, expected exactly one more). The bounded-increment rule is rejecting the increment it exists to permit, which disarms BOTH intended writers: revoke_strategy_share and the GDPR Art. 17 arm in migration 20260827130000 are the same `generation = generation + 1` statement, so revocation stops working entirely and every previously-copied link stays alive.', raised, COALESCE(err_msg, '(none)'), gen_a4_pre, gen_a4;
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
  -- RED-UNDER: `GRANT DELETE ON strategy_shares TO authenticated` on the live
  --            database. ⚠️ SHAPE 3's exact-set pin reads the TABLE-level ACL and
  --            fires first on ANY table-level grant drift, so this arm was
  --            observed red with SHAPE 3 neutered — at which point NO-DELETE 1 is
  --            the FIRST failure and correctly names the absent DELETE grant as
  --            the only layer that refused (the policy is FOR ALL, so RLS lets
  --            the owner delete their own row).
  -- RED-UNDER-M: {"arm":"NO-DELETE 1","apply":[{"kind":"sql","stmt":"GRANT DELETE ON strategy_shares TO authenticated"}],"neuter":[{"arm":"SHAPE 3"}]}
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
  -- ⛔ SUBTRACT, NEVER `gen_mint + 1` — the shape N1 1c and N1 3a were rewritten
  -- to. Rule (6) makes the BIGINT ceiling unattainable today, so this arm cannot
  -- currently reach a state where `gen_mint + 1` overflows; it is written this
  -- way anyway because the file must state ONE rule for this comparison. The
  -- reason N1 3a records is that an arm whose own arithmetic (and whose
  -- `expected %` slot) overflows exactly when it fires reports `bigint out of
  -- range ... at RAISE` instead of its diagnosis — a test that cannot speak,
  -- which is barely better than one that cannot fail. The difference is always
  -- small and never overflows.
  IF (gen_revoked - gen_mint) IS DISTINCT FROM 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (REVOKE 1c): generation is % after one revoke, up from % — expected exactly one more. If it is UNCHANGED the revoke is COSMETIC — revoked_at is set but the token still derives from the same counter, so every previously-copied link KEEPS WORKING (SHARE-03 defeated).', gen_revoked, gen_mint;
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
  SELECT c.generation, c.nonce INTO gen_remint, nonce_after
    FROM public.create_strategy_share(strat_a) c;
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

  -- REACTIVATE 1g: the nonce SURVIVES a revoke-then-reshare, unchanged.
  -- ⛔ This is the arm that proves the nonce did NOT quietly take over
  -- `generation`'s job, and it is deliberately the OPPOSITE assertion to
  -- NONCE 2 below. Within the life of ONE row the nonce is a CONSTANT in the
  -- MAC pre-image: revocation is still driven entirely by the counter, and the
  -- nonce contributes nothing to it. Re-rolling the nonce here would look like
  -- extra security and would in fact be a bug — it would make reactivation
  -- non-deterministic while leaving rules (1) and (2) as the only real
  -- protection, and it would break Copy Link reuse across a re-share.
  -- REACTIVATE 1b already pins the counter's half of the same statement.
  -- RED-UNDER: re-roll the nonce ONLY on the revoked -> live transition —
  --   `SET revoked_at = NULL, nonce = CASE WHEN strategy_shares.revoked_at IS
  --    NOT NULL THEN gen_random_uuid() ELSE strategy_shares.nonce END`
  -- — which leaves OWNER 2d (live reuse) GREEN and makes this arm the only
  -- failure. MEASURED red that way, with the same three earlier layers removed
  -- as for OWNER 2d (column grant, body-text pin, trigger rule (0c)); an
  -- unconditional re-roll would be caught by OWNER 2d first.
  -- RED-UNDER-M: {"arm":"REACTIVATE 1g","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"    SET revoked_at = NULL","replace":"    SET revoked_at = NULL, nonce = CASE WHEN strategy_shares.revoked_at IS NOT NULL THEN gen_random_uuid() ELSE strategy_shares.nonce END","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_create_s ~* 'INSERT\\s+INTO\\s+public\\.strategy_shares\\s*\\([^)]*\\mnonce\\M'\n     OR v_create_s ~* 'SET[^;]*\\mnonce\\s*=' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF NEW.nonce IS DISTINCT FROM OLD.nonce THEN\n    RAISE EXCEPTION 'strategy_shares: nonce is immutable — refusing to rewrite the MAC witness on strategy %. The nonce is what makes a destroyed-and-recreated row land in a token space DISJOINT from every token ever issued; letting it be written back restores a recorded value and resurrects those tokens. STEP 2''s column grant already denies this to `authenticated`, so a write that reaches this rule came from a role that BYPASSES grants — service_role, which holds GRANT ALL and is on this feature''s hot path. A trigger is the only control on this table that binds it.',\n      OLD.strategy_id\n      USING ERRCODE = 'check_violation';\n  END IF;\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_trigfn_s !~* 'NEW\\.nonce\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.nonce' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1},{"kind":"sql","stmt":"GRANT UPDATE (nonce) ON strategy_shares TO authenticated"}],"neuter":[{"arm":"SHAPE 3b"},{"arm":"SHAPE 4d"},{"arm":"SHAPE 5b"}]}
  IF nonce_after IS DISTINCT FROM nonce_mint THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (REACTIVATE 1g): the nonce changed from % to % across revoke -> re-share. The nonce is the row''s IDENTITY witness, not a second revocation counter: within one row''s life it must be constant, and rules (1)+(2) of the monotonicity trigger are what keep revoked links dead. A re-rolled nonce makes reactivation non-deterministic and would break SHARE-01 reuse for any recipient who reloads across a re-share.', nonce_mint, nonce_after;
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

  -- ⛔ NO "did the rejected UPDATE still write?" ARM HERE — one existed, was
  -- counted, and was DELETED (round-3 review, 2026-08-27) for exactly the reason
  -- the TENANT 5 block below records: it could not fail. (This sentence used to
  -- point at a "TENANT 5h", which was the name of an arm deleted BEFORE that
  -- roster was written down and has never appeared in the file — a dangling
  -- pointer into the file's own history. The TENANT 5 block is the live record.)
  -- Two independent mechanisms make it unreachable, and either alone is fatal:
  --   * the statement above sits inside a nested BEGIN ... EXCEPTION, which
  --     PL/pgSQL executes as an implicit SUBTRANSACTION. Catching the error
  --     rolls back every database change the block made, so the tuple is
  --     untouched in EVERY configuration — not because the guard is a BEFORE
  --     trigger, but because the handler undid the write. The arm was reading
  --     its own rollback and calling it a security property.
  --   * in the one configuration where a write could survive — the rule
  --     deleted, so nothing raises at all — TRIGGER 1a fires first and the
  --     probe never runs.
  -- The no-partial-write property is therefore STRUCTURAL, and it is recorded
  -- here rather than asserted. An arm that cannot fail is worse than no arm:
  -- it inflates the corpus-wide floors in .github/workflows/ci.yml while
  -- proving nothing, and it reads to the next person like coverage.

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

  -- ⛔ AND NO post-rejection mutation probe here either, for the identical
  -- reason recorded at TRIGGER 1 above: the subtransaction rollback makes it
  -- unreachable, and TRIGGER 2a fires first in the only configuration where a
  -- write could survive. TRIGGER 3 below is how this file DOES assert an
  -- end-state consequence — by issuing the attack's second request for real,
  -- OUTSIDE the exception block, so the assertion sits downstream of nothing
  -- that was rolled back.

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
  SELECT c.generation INTO gen_probe FROM public.create_strategy_share(strat_a) c;

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
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 3b): the cross-strategy re-point did not RAISE — it was accepted, or it silently matched 0 rows. Two independent layers should refuse it (the column grant, then the trigger), so no rejection at all means BOTH are gone. If it merely matched 0 rows then TRIGGER 3a above passed on an accident of the policy rather than on the rule under test.';
  END IF;
  -- ⚠️ THE REJECTING LAYER CHANGED AT THE 2026-08-27 FOUNDER RULING, and the
  -- message pin changed with it rather than being loosened. `strategy_id` is
  -- absent from `GRANT UPDATE (revoked_at, generation)`, so for an ordinary
  -- `authenticated` caller the re-point is now dead ONE LAYER EARLIER, at the
  -- grant (MEASURED: `permission denied for table strategy_shares`). It never
  -- reaches trigger rule (0a). That is strictly better security and strictly
  -- worse evidence: this arm can no longer prove rule (0a) exists, and pinning
  -- it to the trigger's old message would simply have gone RED forever.
  -- ⛔ So this arm now pins the GRANT layer — which is a real property, and the
  -- first one to fail if someone widens the UPDATE grant back to the table —
  -- and rule (0a) is proven behaviourally by TRIGGER 3d below, against the one
  -- role no grant binds. Neither arm subsumes the other.
  -- RED-UNDER: `GRANT UPDATE (strategy_id) ON strategy_shares TO authenticated`
  --            on the live database, SHAPE 3b neutered. First failure —
  --            MEASURED 2026-08-27.
  -- RED-UNDER-M: {"arm":"TRIGGER 3c","apply":[{"kind":"sql","stmt":"GRANT UPDATE (strategy_id) ON strategy_shares TO authenticated"}],"neuter":[{"arm":"SHAPE 3b"}]}
  IF err_msg NOT LIKE '%permission denied%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 3c): the re-point was rejected, but NOT by the GRANT layer (got: %). `strategy_id` must not appear in any UPDATE grant to `authenticated`: with the column-scoped grant in force this statement cannot execute at all, which is a stronger guarantee than a trigger veto because it also covers columns added to this table in future. If this message is "strategy_id is immutable" then the grant was widened and only the trigger is left.', err_msg;
  END IF;

  -- ======================================================================
  -- TRIGGER 3d: rule (0a) still bites the role GRANTS cannot bind
  -- ======================================================================
  -- TRIGGER 3c above proves the grant layer, and the grant layer does not exist
  -- for `service_role` — GRANT ALL plus BYPASSRLS, and this feature's recipient
  -- lane already reads the table through `createAdminClient()`. For that caller
  -- rule (0a) is the only control, exactly as rule (0c) is the only control on
  -- the nonce (NONCE 5). Without this arm, deleting rule (0a) would go entirely
  -- unnoticed by every behavioural arm in this file.
  -- RED-UNDER: delete the `IF NEW.strategy_id IS DISTINCT FROM OLD.strategy_id`
  --            block from strategy_shares_enforce_monotonic_generation().
  -- RED-UNDER-M: {"arm":"TRIGGER 3d-i","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF NEW.strategy_id IS DISTINCT FROM OLD.strategy_id THEN\n    RAISE EXCEPTION 'strategy_shares: strategy_id is immutable — refusing to re-point the share row for strategy % at strategy %. The generation counter is only meaningful RELATIVE to the strategy it counts for. Moving it leaves the original strategy with NO share row, so the very next create_strategy_share() inserts a fresh one at generation 1 and re-issues every token that strategy ever had at generation 1 — including the ones that were explicitly REVOKED. Two requests, both legitimate for the row owner, same end state as rewinding the counter.',\n      OLD.strategy_id, NEW.strategy_id\n      USING ERRCODE = 'check_violation';\n  END IF;\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_trigfn_s !~* 'NEW\\.strategy_id\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.strategy_id' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  RESET ROLE;
  SET LOCAL ROLE service_role;
  raised := FALSE;
  BEGIN
    UPDATE strategy_shares SET strategy_id = strat_a2 WHERE strategy_id = strat_a;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 3d-i): service_role re-pointed a share row at another strategy. That role bypasses both the column grant and RLS, so trigger rule (0a) is the only thing that could have refused it and it is missing. The counter walks away with the second strategy, the original is left with NO share row, and the very next create_strategy_share() on it inserts at generation 1 — re-issuing every token that strategy revoked at generation 1.';
  END IF;
  IF err_msg NOT LIKE '%strategy_id is immutable%' THEN
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 3d-ii): the service_role re-point was rejected by something OTHER than rule (0a) (got: %). All five trigger rules share an errcode, and UNIQUE(strategy_id) would also reject a collision, so only the message distinguishes the rule under test from an accident.', err_msg;
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
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 4a): the owner backdated created_at on their own share row with a raw UPDATE. Two layers should refuse it — `created_at` is absent from `GRANT UPDATE (revoked_at, generation)`, and trigger rule (0b) vetoes it for anyone the grant does not bind — so no rejection at all means both are gone, and the provenance STEP 3 promises is forgeable: who minted a live anonymous capability link, and when, both become whatever the owner types.';
  END IF;
  -- Same layer shift as TRIGGER 3c, same reasoning, recorded rather than
  -- silently absorbed: `created_at` is not in the column-scoped UPDATE grant,
  -- so for `authenticated` this is now a grant rejection and rule (0b) is never
  -- reached. Rule (0b) is proven against service_role by TRIGGER 4c below.
  -- RED-UNDER: `GRANT UPDATE (created_at) ON strategy_shares TO authenticated`
  --            on the live database, SHAPE 3b neutered. First failure —
  --            MEASURED 2026-08-27.
  -- RED-UNDER-M: {"arm":"TRIGGER 4b","apply":[{"kind":"sql","stmt":"GRANT UPDATE (created_at) ON strategy_shares TO authenticated"}],"neuter":[{"arm":"SHAPE 3b"}]}
  IF err_msg NOT LIKE '%permission denied%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 4b): the provenance rewrite was rejected, but NOT by the GRANT layer (got: %). No provenance column may appear in an UPDATE grant to `authenticated`; if this message is "identity and provenance are immutable" then the grant was widened and the trigger is the last line.', err_msg;
  END IF;

  -- ======================================================================
  -- TRIGGER 4c: rule (0b) still bites service_role
  -- ======================================================================
  -- `created_at` is the probe of the three columns rule (0b) pins (id,
  -- created_by, created_at) for the reason the original arm gave and which
  -- still holds: rewriting `created_by` ALSO trips the `created_by = auth.uid()`
  -- half of WITH CHECK, so an arm there could pass on the policy while the rule
  -- was gone. For service_role there is no policy at all, which makes the
  -- choice even cleaner — only the trigger can refuse.
  -- RED-UNDER: delete the `NEW.created_at IS DISTINCT FROM OLD.created_at`
  --            clause from rule (0b).
  -- RED-UNDER-M: {"arm":"TRIGGER 4c-i","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"\n     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN","replace":" THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"\n     OR v_trigfn_s !~* 'NEW\\.created_at\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.created_at'","replace":"","occurrences":1}]}
  RESET ROLE;
  SET LOCAL ROLE service_role;
  raised := FALSE;
  BEGIN
    UPDATE strategy_shares
       SET created_at = created_at - INTERVAL '1 year'
     WHERE strategy_id = strat_a;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 4c-i): service_role backdated created_at on a share row. It bypasses the column grant and RLS alike, so rule (0b) is the only control and it is missing.';
  END IF;
  IF err_msg NOT LIKE '%identity and provenance are immutable%' THEN
    RAISE EXCEPTION 'TEST FAILED (TRIGGER 4c-ii): the service_role provenance rewrite was rejected by something OTHER than rule (0b) (got: %)', err_msg;
  END IF;

  -- ======================================================================
  -- NONCE 1: the owner cannot WRITE the nonce — GRANT layer, not RLS
  -- ======================================================================
  -- ⛔ THE LAYER IS THE ASSERTION. The owner holds UPDATE on this table and
  -- their own row satisfies both halves of strategy_shares_owner, so RLS lets
  -- this through; and the trigger's rule (0c) would ALSO reject it, with a
  -- different message. Three layers could each be the one that fired, and the
  -- one that MUST fire is the grant — because it is the layer that REFUSES the
  -- statement outright rather than correcting it, and it is the one this arm
  -- names. ⚠️ RESTATED 2026-08-28: this used to say the grant is "the only one
  -- that also stops the INSERT form of the same attack (NONCE 2), where no
  -- BEFORE UPDATE trigger exists to help". Since 164-06 the trigger is BEFORE
  -- INSERT OR UPDATE, and since the F-3 fix its INSERT branch re-rolls the
  -- nonce, so the INSERT form is covered twice — by the grant for
  -- `authenticated` (NONCE 2) and by the trigger for the roles a grant cannot
  -- bind (N1 2b). The two are still not interchangeable: the grant makes the
  -- write IMPOSSIBLE (42501), the trigger makes it INEFFECTIVE (a fresh nonce
  -- is stored), and only the first tells the caller they got it wrong.
  -- Pin `permission denied`, not a bare `raised`:
  -- rule (0c) raises `check_violation` with the text "nonce is immutable", and
  -- a bare arm would report the grant as absent-and-safe while it was in fact
  -- present-and-masked.
  -- RED-UNDER: `GRANT UPDATE (nonce) ON strategy_shares TO authenticated` on
  --            the live database. ⚠️ SHAPE 3b's exact-set pin fires first on
  --            ANY grant drift, so this arm was observed red with SHAPE 3b
  --            neutered — at which point NONCE 1b is the first failure and
  --            correctly names rule (0c) as the layer that refused.
  --
  -- ⛔ `WHEN OTHERS`, DELIBERATELY, AND THE NARROW HANDLER WAS A MEASURED BUG.
  -- Written as `WHEN insufficient_privilege` — matching every sibling grant arm
  -- in this file — NONCE 1b could NEVER FIRE. Under its own RED-UNDER mutation
  -- the grant admits the statement, trigger rule (0c) raises `check_violation`,
  -- the narrow handler does not catch it, and the exception escapes the whole
  -- DO block: the file still goes red (fail-loud, correct) but with the
  -- trigger's message and NONCE 1b's diagnostic — the one sentence that says
  -- WHICH layer refused — never prints. MEASURED 2026-08-27: the run aborted
  -- with "strategy_shares: nonce is immutable", not with NONCE 1b.
  -- `WHEN OTHERS` plus the message pin below is what makes the arm reportable.
  -- RED-UNDER-M: {"arm":"NONCE 1b","apply":[{"kind":"sql","stmt":"GRANT UPDATE (nonce) ON strategy_shares TO authenticated"}],"neuter":[{"arm":"SHAPE 3b"}]}
  raised := FALSE;
  BEGIN
    UPDATE strategy_shares SET nonce = gen_random_uuid() WHERE strategy_id = strat_a;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (NONCE 1a): the owner UPDATEd `nonce` on their own share row without a privilege error. The column-scoped write grant (migration 20260827120000 STEP 2: GRANT UPDATE (revoked_at, generation)) is missing or was widened. With the nonce writable, an owner can hold a recorded value and put it back after the row is destroyed and re-created — which re-derives every token that row ever issued.';
  END IF;
  IF err_msg NOT LIKE '%permission denied%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (NONCE 1b): the nonce write was rejected, but NOT by the GRANT layer (got: %). If this is trigger rule (0c) — "nonce is immutable", errcode check_violation — then `authenticated` still HOLDS UPDATE(nonce) and this arm proved nothing about the grant. The distinction matters: rule (0c) is an UPDATE-side rule, so it never sees the INSERT form of the same attack — that form is closed by the grant (NONCE 2) and, for the roles a grant cannot bind, by the trigger''s separate INSERT branch (N1 2b). A green here that came from rule (0c) means the `authenticated` half of that pair is gone.', err_msg;
  END IF;

  -- ======================================================================
  -- NONCE 2: ...and cannot supply one on INSERT either — THE R2b CLOSURE
  -- ======================================================================
  -- ⛔ NONCE 1 DOES NOT COVER THIS. Rule (0c) is an UPDATE-side rule, so it
  -- never sees an INSERT; the layer this arm measures is the GRANT.
  -- ⚠️ RESTATED 2026-08-28. This block used to say "the trigger is BEFORE
  -- UPDATE only, so an INSERT is seen by NO rule at all; the grant is the sole
  -- control". Since 164-06 the trigger is BEFORE INSERT OR UPDATE, and since the
  -- F-3 fix its INSERT branch re-rolls the nonce — so the grant is no longer
  -- SOLE, it is the `authenticated`-side layer of a pair, and N1 2b is the
  -- other. Keeping the old sentence would have been the more dangerous error of
  -- the two: it invites a future reader to conclude that widening this grant is
  -- catastrophic-and-therefore-unthinkable, when in fact the honest reason to
  -- keep it narrow is that the grant REFUSES the statement (42501, the caller
  -- learns) while the trigger merely NEUTRALISES it (a fresh nonce is stored,
  -- silently).
  -- The full attack, MEASURED end-to-end on a
  -- throwaway PostgreSQL 16 cluster (2026-08-27), against the pre-164-06
  -- trigger:
  --   1. the owner SELECTs their own nonce — RLS permits it, and it must, since
  --      create_strategy_share RETURNs it as the caller;
  --   2. the owner DELETEs their `strategies` row. ON DELETE CASCADE takes the
  --      share row with it. ⚠️ No control on THIS table can observe that — not
  --      the trigger (nothing UPDATEs), not the missing DELETE grant (the
  --      cascade is a referential action and does not consult privileges), not
  --      RLS;
  --   3. the owner re-INSERTs the strategy with the SAME client-suppliable
  --      uuid, and re-inserts the share row VERBATIM, nonce included.
  -- With a table-wide INSERT grant that final statement was ACCEPTED and the
  -- nonce came back BIT-IDENTICAL. With the column grant it is 42501. That one
  -- statement is the difference between the nonce closing the resurrection
  -- family and the nonce being decoration.
  --
  -- Target strat_a2 — never shared, per this file's ordering constraint 1 — so
  -- UNIQUE(strategy_id) cannot raise 23505 before the privilege check and give
  -- this arm a false pass on the wrong error.
  -- RED-UNDER: `GRANT INSERT (nonce) ON strategy_shares TO authenticated` on
  --            the live database, with SHAPE 3b neutered (its exact-set pin
  --            fires first on any grant drift). NONCE 2a is then the first
  --            failure — MEASURED 2026-08-27. ⚠️ Under that mutation the INSERT
  --            SUCCEEDS — which is what makes `raised = FALSE` the detection —
  --            but since the F-3 fix the row it lands carries a FRESH nonce,
  --            not the chosen one: the trigger's INSERT branch overwrote it.
  --            So the failure this arm reports is now "the privilege wall is
  --            gone", not "the token was resurrected"; N1 2b is what would go
  --            red if the resurrection itself were reachable again.
  -- RED-UNDER-M: {"arm":"NONCE 2a","apply":[{"kind":"sql","stmt":"GRANT INSERT (nonce) ON strategy_shares TO authenticated"}],"neuter":[{"arm":"SHAPE 3b"}]}
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_shares (strategy_id, created_by, nonce)
    VALUES (strat_a2, uid_a, nonce_mint);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (NONCE 2a): the owner INSERTed a share row NAMING `nonce`, with no privilege error. That statement is the last step of the delete-and-recreate resurrection: read your nonce, cascade the row away through `strategies` (which no control on this table can see), re-create the strategy at the same client-suppliable uuid, and re-insert the row verbatim. `GRANT INSERT (strategy_id, created_by)` is the wall that must refuse it and it is missing or was widened. ⚠️ Read the scope exactly: since 164-06 the trigger also covers INSERT and its branch re-rolls the nonce, so the row this statement landed most likely carries a FRESH value and the token is NOT resurrected — that second layer is pinned by N1 2b, against the roles a grant cannot bind. What THIS arm reports is that the privilege wall is gone, which is a real regression on its own: the grant REFUSES the write and tells the caller, where the trigger silently corrects it.';
  END IF;
  IF err_msg NOT LIKE '%permission denied%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (NONCE 2b): the chosen-nonce INSERT was rejected by something OTHER than the grant layer (got: %) — most likely RLS or a constraint, either of which blocks today by accident and stops blocking on the next unrelated change. Only an absent INSERT(nonce) privilege closes this durably.', err_msg;
  END IF;

  -- ======================================================================
  -- NONCE 3: R3''s INSERT half — a client cannot CHOOSE a starting generation
  -- ======================================================================
  -- Same mechanism, different column, kept as its own arm because it pins a
  -- different grant term.
  -- ⚠️ WHAT THIS ARM PROVES WAS RESTATED 2026-08-28, because the consequence it
  -- used to name is NO LONGER REACHABLE and an arm that threatens an impossible
  -- outcome teaches the next reader the wrong model. The old text said the
  -- trigger is BEFORE UPDATE, so a fresh row's `generation` is "wholly
  -- unguarded", and that `INSERT ... (strategy_id, created_by, generation)` with
  -- 2^63-1 pre-wedges the overflow — wedging revoke_strategy_share and, on the
  -- same `generation + 1` statement, the data subject's own GDPR Art. 17
  -- erasure. That was true before 164-06. It is false now: the trigger's INSERT
  -- branch FORCES `generation := 1`, so even with the grant widened the planted
  -- value never reaches the table. The ceiling wedge survives ONLY through the
  -- UPDATE path, which is rule (6)'s job and is pinned by N1 1a/1b/1c.
  -- ⭐ So this arm's standing value is the GRANT, not the wedge: `generation`
  -- must not appear in any INSERT grant to `authenticated`, because a widened
  -- grant means the column is reachable and the trigger's INSERT branch is the
  -- only thing correcting it — two layers to one, silently. SHAPE 3b is the
  -- exact-set structural pin; this is the behavioural one.
  -- RED-UNDER: `GRANT INSERT (generation) ON strategy_shares TO authenticated`
  --            on the live database, SHAPE 3b neutered. First failure —
  --            MEASURED 2026-08-27. ⚠️ Under that mutation the INSERT now
  --            SUCCEEDS and lands at generation 1, not at 2^63-1 — the arm
  --            still fires on `NOT raised`, which is the privilege wall it
  --            actually measures.
  -- RED-UNDER-M: {"arm":"NONCE 3","apply":[{"kind":"sql","stmt":"GRANT INSERT (generation) ON strategy_shares TO authenticated"}],"neuter":[{"arm":"SHAPE 3b"}]}
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_shares (strategy_id, created_by, generation)
    VALUES (strat_a2, uid_a, 9223372036854775807);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (NONCE 3): the owner INSERTed a share row NAMING `generation`, with no privilege error — `generation` has appeared in an INSERT grant to `authenticated`. ⚠️ The row itself most likely landed at 1: since 164-06 the trigger also fires BEFORE INSERT and FORCES the starting counter, so the planted 2^63-1 never reaches the table and the availability wedge this arm once named is no longer reachable through INSERT (it survives only through UPDATE, which is rule (6) and N1 1a/1b/1c). What is gone is the PRIVILEGE wall: the column is now reachable and the trigger''s INSERT branch is the only thing correcting it, two layers reduced to one, silently. Restore the column-scoped grant.';
  END IF;

  -- ======================================================================
  -- NONCE 4: THE CASCADE-REBIRTH END STATE — a re-created row is a NEW row
  -- ======================================================================
  -- ⛔ EVERY ARM ABOVE ASSERTS THAT AN ATTACK IS REFUSED. This one asserts the
  -- POSITIVE PROPERTY the whole design rests on, and it is the only arm in this
  -- file that does: even when the row IS destroyed and re-created — which no
  -- control on this table can prevent, because the delete happens on
  -- `strategies` and rides a referential action that consults no privilege and
  -- fires no trigger here — the rebuilt row lands in a token space DISJOINT
  -- from the old one. That is the difference between "we enumerated the paths"
  -- (which this phase attempted three times and missed one each time) and
  -- "the property holds down every path, including ones nobody has thought of".
  --
  -- The attack is run FOR REAL rather than probed: delete, re-create at the
  -- SAME client-suppliable uuid, re-mint. There is no exception block, so
  -- nothing here can be reading its own subtransaction rollback.
  --
  -- ⚠️ Note what this arm does NOT claim. The re-minted generation is 1 again —
  -- the counter genuinely was discarded, and that is unfixable by any
  -- generation-based scheme. The nonce is what makes generation 1 on the NEW
  -- row a different token from generation 1 on the OLD one.
  -- RED-UNDER: make the nonce reproducible instead of random — e.g. add a
  --            BEFORE INSERT trigger setting `NEW.nonce =
  --            md5(NEW.strategy_id::text)::uuid`. SHAPE 1b stays GREEN (the
  --            column DEFAULT is untouched), and this arm is the only failure.
  -- RED-UNDER-M: {"arm":"NONCE 4c","apply":[{"kind":"sql","stmt":"CREATE OR REPLACE FUNCTION public.zz_reproducible_nonce() RETURNS TRIGGER LANGUAGE plpgsql AS $zz$ BEGIN NEW.nonce := md5(NEW.strategy_id::text)::uuid; RETURN NEW; END; $zz$"},{"kind":"sql","stmt":"CREATE TRIGGER zz_reproducible_nonce BEFORE INSERT ON strategy_shares FOR EACH ROW EXECUTE FUNCTION public.zz_reproducible_nonce()"}]}
  SELECT c.nonce INTO nonce_a3_pre FROM public.create_strategy_share(strat_a3) c;
  IF nonce_a3_pre IS NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (NONCE 4a): the pre-rebirth mint returned a NULL nonce, so the comparison below would be NULL-vs-NULL and could not fail';
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- The cascade, and the re-creation at the SAME uuid. Run in the seeding
  -- context: the point under test is the END STATE of `strategy_shares`, and
  -- routing it through `strategies`'s own RLS would make this arm depend on a
  -- policy in another migration that this file does not own.
  DELETE FROM strategies WHERE id = strat_a3;
  SELECT count(*) INTO row_cnt FROM strategy_shares WHERE strategy_id = strat_a3;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (NONCE 4b): deleting the parent strategy left % share row(s) behind — the ON DELETE CASCADE this arm models is gone, so the resurrection path it reproduces is no longer the real one and the arm is measuring a fiction', row_cnt;
  END IF;
  INSERT INTO strategies (id, user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (strat_a3, uid_a, 'strategy-shares A cascade-rebirth strategy', 'private', '{}', '{}', '{}', ARRAY['binance']);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT c.nonce INTO nonce_a3_post FROM public.create_strategy_share(strat_a3) c;
  IF nonce_a3_post IS NULL OR nonce_a3_post IS NOT DISTINCT FROM nonce_a3_pre THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (NONCE 4c): after the parent strategy was DELETEd (cascading the share row away) and re-created at the SAME uuid, the re-minted share carries nonce % — the pre-cascade value was %. Identical (or NULL) means the token pre-image is fully reproducible from client-controlled inputs, so the MAC over (tag, strategy_id, nonce, 1) re-derives BIT-IDENTICALLY and every link that strategy ever REVOKED at generation 1 resolves again as anonymous access to an unpublished factsheet. No trigger, grant or policy on strategy_shares can see this delete — it happens on `strategies` and rides a referential action. The unguessable per-row nonce is the ONLY thing that closes it.', nonce_a3_post, nonce_a3_pre;
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
  -- ⛔ Consequence for honesty: the arms below go RED on the SAME neuter that
  -- reddens TENANT 1 (dropping the EXISTS half) — they are NOT an independent
  -- pin of the USING clause. **TENANT 4a is the USING pin** — see the note
  -- below, which records why the obvious raw cross-tenant UPDATE arm here was
  -- written, measured and then DELETED as unfailable. (An earlier version of
  -- this sentence named a "TENANT 5h" that has never appeared in the file: 5h
  -- WAS that deleted arm. The TRIGGER 1 note above carried the same dangling
  -- name until 2026-08-28; both now point here instead.)
  --
  -- ⛔⛔ THE 2026-08-28 RESTRUCTURE, AND WHY THE OLD SHAPE PROVED NOTHING. This
  -- block used to run the conflict-write inside a nested `BEGIN … EXCEPTION`,
  -- assert `raised`, and THEN read tenant B's row through four arms (5d-5g:
  -- generation, tombstone, provenance, row count) that claimed to prove "the
  -- rejection was TOTAL — no partial write". They proved the opposite of a
  -- security property: they were reading THEIR OWN SUBTRANSACTION ROLLBACK.
  -- PL/pgSQL executes a nested BEGIN … EXCEPTION as an implicit subtransaction,
  -- so catching the error rolls back every database change the block made — in
  -- EVERY configuration, whether or not any wall exists.
  -- MEASURED (PostgreSQL 16 throwaway cluster, 2026-08-28): a GENUINE
  -- cross-tenant write placed inside that block —
  --   `SET LOCAL ROLE service_role;
  --    UPDATE strategy_shares SET revoked_at = now(), generation = generation + 1
  --      WHERE strategy_id = strat_b;`
  -- — moved B's counter 1 -> 2 and stamped B's tombstone, and THE WHOLE FILE
  -- STILL WENT GREEN: psql exit 0, and the completion notice reported every one
  -- of that day's 106 arms as executed. The identical statement moved OUTSIDE
  -- the block was caught immediately ("TENANT 5d: tenant A's rejected
  -- conflict-write moved tenant B's generation from 1 to 2"). The handler, not
  -- the guard, was doing all the work.
  -- ⛔ AND DO NOT QUOTE THIS FILE'S COMPLETION NOTICE VERBATIM IN A COMMENT.
  -- The sentinel check in .github/workflows/ci.yml — and the psql stub in
  -- src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts — both take the
  -- FIRST match of that notice's text in the file, so a prose copy sitting
  -- ABOVE the real notice shadows it and the gate reports the sentinel as never
  -- printed while psql exits 0. MEASURED 2026-08-28, on this very paragraph.
  --
  -- ⭐ THE FIX IS TRIGGER 3'S PRECEDENT: assert the attack's END STATE, from
  -- outside the handler, on a row where a successful write would LEAVE A MARK.
  -- `create_strategy_share`'s conflict path is `SET revoked_at = NULL` and
  -- nothing else, so against a LIVE victim row a successful cross-tenant write
  -- is invisible — which is why this block now REVOKES B's share first. Then:
  --   * walls present -> the statement raises, the subtransaction discards it,
  --     B's row is still revoked;
  --   * both walls gone -> the statement SUCCEEDS, no exception is raised, the
  --     subtransaction COMMITS, and B's revoked link is LIVE AGAIN. TENANT 5b
  --     is the first failure, on the end state rather than on an error string.
  --
  -- ⚠️ THE ROSTER IS NOW 5a AND 5b, AND THE OLD 5b/5c COLLAPSED INTO ONE ARM
  -- rather than being kept as three. This was measured, not preferred. The
  -- conflict-write either RAISES (and the subtransaction discards it) or
  -- SUCCEEDS (and the tombstone clears); there is no third world, so "it was
  -- rejected" and "B's row survived" can never both be first, and whichever is
  -- written second is unfailable. The end state is the one kept, because it is
  -- the property that matters and it survives a future change in which the RPC
  -- stops raising but still fails to write.
  -- ⛔ AND THE MESSAGE PIN CANNOT BE AN ARM OF ITS OWN EITHER — MEASURED, after
  -- three attempts to redden it. For a rejection to arrive from something other
  -- than RLS while the tombstone survives, the mint RPC's conflict clause or the
  -- INSERT column grant has to change; and BOTH of those abort the file far
  -- earlier on an UNWRAPPED call, not on an arm. `ON CONFLICT ... DO NOTHING`
  -- surfaced OWNER 2d ("re-minting a LIVE share returned nonce <NULL>");
  -- dropping the ON CONFLICT clause outright, or revoking
  -- `INSERT (strategy_id)`, kills OWNER 1a / OWNER 2a, whose
  -- `SELECT ... FROM create_strategy_share(...)` calls carry no exception block
  -- at all, so psql dies on a raw 23505/42501 instead. There is no configuration
  -- in which a standalone message arm is the first failure, so the message test
  -- lives INSIDE 5b as one more disjunct — it costs nothing there and inflates
  -- no floor.
  --
  -- ⛔ THE OLD 5d, 5f AND 5g ARE DELETED, and none of them can be restored by
  -- putting them after the end-state read, because the conflict path cannot
  -- touch what they measured even when it fully succeeds:
  --   * 5d (generation) — `DO UPDATE SET revoked_at = NULL` never writes the
  --     counter. Adding a bump to that SET list would redden REACTIVATE 1b in
  --     the owner's OWN lane, with no policy mutation at all;
  --   * 5f (created_by) — likewise absent from the SET list, and rewriting it
  --     on an existing row is trigger rule (0b), pinned behaviourally against
  --     the one role grants cannot bind by TRIGGER 4c;
  --   * 5g (row count) — `UNIQUE(strategy_id)` makes a second row unreachable,
  --     and dropping that index makes `ON CONFLICT (strategy_id)` itself an
  --     error, which raises and rolls back. Unfailable in every configuration.
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
  SELECT c.generation INTO gen_b FROM public.create_strategy_share(strat_b) c;
  IF gen_b IS NULL OR gen_b <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 5a): tenant B''s first mint on their own strategy returned %, expected 1', gen_b;
  END IF;

  -- ⭐ REVOKE B'S SHARE — this is what gives the end-state arm something to
  -- observe. `create_strategy_share`'s conflict path writes exactly one column,
  -- `revoked_at = NULL`, so against a live row a fully successful cross-tenant
  -- write leaves the table byte-identical and NO end-state arm can exist. B's
  -- row is put back LIVE a few lines below, before anything downstream reads it.
  SELECT public.revoke_strategy_share(strat_b) INTO affected;
  SELECT revoked_at INTO b_revoked_pre FROM strategy_shares WHERE strategy_id = strat_b;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  raised := FALSE; err_msg := NULL;
  BEGIN
    PERFORM public.create_strategy_share(strat_b);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ======================================================================
  -- TENANT 5b: THE END STATE — B's REVOKED link is still dead
  -- ======================================================================
  -- ⛔ READ FROM OUTSIDE THE HANDLER, WHICH IS THE ENTIRE POINT (see the
  -- restructure note above). This is the arm the deleted 5d-5g pretended to be:
  -- when both policy walls are gone the conflict-write does not raise, so the
  -- subtransaction COMMITS and `revoked_at = NULL` really does land on a row
  -- tenant A does not own. B's revoked capability url resolves again.
  --
  -- `b_revoked_pre` is checked in the SAME arm rather than as a separate "-pre"
  -- vacuity guard, deliberately: a standalone pre-arm could never be the first
  -- failure (REVOKE 1b already fires for any breakage of the tombstone stamp),
  -- so it would be decoration. Folded in, it costs nothing and stops this arm
  -- from passing on a world where the setup revoke silently did nothing.
  -- RED-UNDER: replace the strategy_shares_owner policy's clauses with
  --            `USING (true) WITH CHECK (true)` on the live database.
  -- ⚠️ LAYERED NINE DEEP, and the depth was MEASURED, not predicted — the
  --    mutation unblocks every cross-tenant probe in the file:
  --      1-7. neuter the ASSERTIONS of TENANT 1a, 1b, 2a, 2b, 3a, 3b and 4a,
  --           all of which fire earlier;
  --      8-9. neuter TENANT 1's and TENANT 2's WRITE STATEMENTS as well, not
  --           just their assertions. Left to run they SUCCEED under the loose
  --           policy and plant a tenant-A-owned share row on strat_b, after
  --           which tenant B's own revoke (`created_by = auth.uid()`) matches
  --           zero rows and THIS arm fires on its vacuity half instead —
  --           reporting `revoked_at was (null) before the attempt`, which is a
  --           true statement about a setup that never ran, not the attack.
  --    Step 8-9 is the OWNER 2d / N1 3a precedent applied honestly. With all
  --    nine applied TENANT 5b is the FIRST failure, on the attack half —
  --    MEASURED 2026-08-28: `revoked_at was 2026-08-28 00:50:47.415812+02
  --    before the attempt, (null) after; raised=f`. That is tenant A clearing
  --    tenant B's tombstone, surviving the subtransaction because nothing
  --    raised, and being caught from outside it.
  -- RED-UNDER-M: {"arm":"TENANT 5b","apply":[{"kind":"sql","stmt":"ALTER POLICY strategy_shares_owner ON strategy_shares USING (true) WITH CHECK (true)"},{"kind":"edit","file":"supabase/tests/test_strategy_shares_rls.sql","find":"    PERFORM public.create_strategy_share(strat_b);\n","replace":"    NULL;\n","occurrences":2,"nth":1},{"kind":"edit","file":"supabase/tests/test_strategy_shares_rls.sql","find":"    INSERT INTO strategy_shares (strategy_id, created_by) VALUES (strat_b, uid_a);\n","replace":"    NULL;\n","occurrences":1}],"neuter":[{"arm":"TENANT 1a"},{"arm":"TENANT 1b"},{"arm":"TENANT 2a"},{"arm":"TENANT 2b"},{"arm":"TENANT 3a"},{"arm":"TENANT 3b"},{"arm":"TENANT 4a"}]}
  SELECT revoked_at INTO b_revoked FROM strategy_shares WHERE strategy_id = strat_b;
  IF b_revoked_pre IS NULL
     OR b_revoked IS NULL
     OR NOT raised
     OR err_msg NOT LIKE '%row-level security%' THEN
    RAISE EXCEPTION 'TEST FAILED (TENANT 5b): tenant B''s REVOKED share row did not survive tenant A''s cross-tenant conflict-write (revoked_at was % before the attempt, % after; raised=%, error=%). If the AFTER value is NULL, `INSERT ... ON CONFLICT DO UPDATE SET revoked_at = NULL` reached a row tenant A does not own: BOTH policy walls are gone — the CR-01 EXISTS half of WITH CHECK, which normally rejects the proposed tuple before the conflict handler runs at all, AND the USING clause that path otherwise falls through to. Every link tenant B revoked resolves again, as anonymous access to an unpublished factsheet. If the BEFORE value is NULL the setup revoke did not take and this arm would have passed vacuously. If the error is not an RLS one the write was blocked by an accident — UNIQUE(strategy_id) raising 23505, or a missing grant — which stops blocking on the next unrelated change.', COALESCE(b_revoked_pre::TEXT, '(null)'), COALESCE(b_revoked::TEXT, '(null)'), raised, COALESCE(err_msg, '(none)');
  END IF;

  -- ⭐ PUT B'S SHARE BACK LIVE, at the ADVANCED counter, and refresh `gen_b`.
  -- (5b above is the last arm of this block; what follows is state restoration.)
  -- Not cleanup for its own sake: SANITIZE 1f below proves that erasing tenant A
  -- does NOT revoke tenant B, which requires B to be live and `gen_b` to hold
  -- B's current counter; and N1 3a's erasure arm needs a LIVE row, because the
  -- Art. 17 statement carries `revoked_at IS NULL` and would otherwise match
  -- zero rows and report a clean erasure that never happened.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT c.generation INTO gen_b FROM public.create_strategy_share(strat_b) c;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

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
    RAISE EXCEPTION 'TEST FAILED (SERVICE-ROLE 0-acl): service_role holds % standing EXECUTE grant(s) on the share RPCs, expected 0. That role is BYPASSRLS and is what createAdminClient() connects as, so this deletes the ONLY wall that binds it. ⛔ The auth.uid() fail-loud guard in the body is NOT a fallback and must not be read as one: auth.uid() reads the caller-settable request.jwt.claims GUC, and SERVICE-ROLE 2f below MEASURES that a service_role caller who sets that GUC first revokes ANOTHER TENANT''S live share and is told it succeeded. ⛔ Read as a REGRESSION of the REVOKE, which pg_default_acl re-applies on any DROP+CREATE of these functions.', row_cnt;
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
  IF NOT raised THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.revoke_strategy_share(UUID) FROM service_role';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.create_strategy_share(UUID) FROM service_role';
    RAISE EXCEPTION 'TEST FAILED (SERVICE-ROLE 2c): with EXECUTE granted, service_role ran create_strategy_share to completion. It must refuse: for that role auth.uid() is NULL and RLS does not apply, so the ON CONFLICT DO UPDATE path would set revoked_at = NULL on an EXISTING row with no policy in the way. Today the NOT NULL on created_by raises 23502 first and blocks that INCIDENTALLY — completing successfully means even that accident is gone.';
  END IF;
  IF err_msg NOT LIKE '%not callable by a service-role%' THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.revoke_strategy_share(UUID) FROM service_role';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.create_strategy_share(UUID) FROM service_role';
    RAISE EXCEPTION 'TEST FAILED (SERVICE-ROLE 2d): service_role''s mint failed, but NOT on the fail-loud guard (got: %)', err_msg;
  END IF;

  -- ======================================================================
  -- SERVICE-ROLE 2f: SPOOFED CLAIMS — what actually bounds a service_role
  --                  caller once it has EXECUTE
  -- ======================================================================
  -- ⛔⛔ 2a AND 2c CERTIFY A STRICTLY WEAKER PROPERTY THAN THEIR NAMES SUGGEST,
  -- and this arm exists to stop the file overclaiming. Both call with
  -- `request.jwt.claims` set to NULL, so `auth.uid()` is NULL and the fail-loud
  -- guard fires. But `auth.uid()` READS THAT GUC, and a caller that can reach
  -- the function can set it first. MEASURED (throwaway PostgreSQL 16,
  -- 2026-08-28) with EXECUTE granted exactly as it is here:
  --     SET LOCAL ROLE service_role;
  --     PERFORM set_config('request.jwt.claims', '{"sub":"<victim>"}', true);
  --     SELECT public.revoke_strategy_share('<victim strategy>');
  --   -> rows=1, revoked_at stamped, generation 1 -> 2 on ANOTHER TENANT'S live
  --      share, reported to the caller as SUCCESS.
  -- So the body guard is NOT a second wall against this role. STEP 5's EXECUTE
  -- revoke is the only one, and SERVICE-ROLE 0-acl is what pins it durably.
  --
  -- ⭐ WHAT THIS ARM THEREFORE ASSERTS is the property that IS true and IS
  -- load-bearing: once claims are spoofed, the caller is bounded by
  -- `created_by = auth.uid()` in revoke's UPDATE and by NOTHING ELSE. RLS does
  -- not apply to a BYPASSRLS role, so for this caller that predicate is the
  -- whole of tenancy. Drop it and a spoofed service_role call becomes an
  -- unbounded cross-tenant kill switch: spoof ANY sub, name ANY strategy.
  -- ⛔ NOT the same arm as TENANT 4b, which routes the same predicate through an
  -- `authenticated` caller — there RLS ALSO scopes the UPDATE, so 4b stays green
  -- with the predicate deleted. This is the only arm in the file that isolates
  -- it, and it needs the spoof to do so.
  --
  -- `NOT raised` is asserted too, and it is the anti-vacuity half: if the
  -- set_config did not take, auth.uid() would be NULL, the fail-loud guard would
  -- refuse, `affected` would never be assigned, and the arm would "pass" while
  -- measuring the guard from 2a all over again.
  -- RED-UNDER: delete the `AND created_by = auth.uid()` predicate from
  --            revoke_strategy_share's UPDATE (migration 20260827120000 STEP 4).
  -- ⚠️ LAYERED: SHAPE 4c greps the body for that predicate and fires first, and
  --    migration 20260827120000's STEP 6 arm (ii-c) greps for it too and ABORTS
  --    THE APPLY — so both must go in the same mutation. With both gone this arm
  --    is the first failure (MEASURED).
  -- RED-UNDER-M: {"arm":"SERVICE-ROLE 2f","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"\n     AND created_by = auth.uid()","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_revoke_s !~* 'created_by\\s*=\\s*auth\\.uid\\s*\\(\\s*\\)' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}],"neuter":[{"arm":"SHAPE 4c"}]}
  SELECT revoked_at, generation INTO sr_rev_pre, sr_gen_pre
    FROM strategy_shares WHERE strategy_id = strat_a;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE service_role;
  raised := FALSE; err_msg := NULL; affected := NULL;
  BEGIN
    SELECT public.revoke_strategy_share(strat_a) INTO affected;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT revoked_at, generation INTO now_revoked, gen_probe
    FROM strategy_shares WHERE strategy_id = strat_a;
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.revoke_strategy_share(UUID) FROM service_role';
  EXECUTE 'REVOKE EXECUTE ON FUNCTION public.create_strategy_share(UUID) FROM service_role';
  IF raised
     OR affected IS DISTINCT FROM 0
     OR now_revoked IS DISTINCT FROM sr_rev_pre
     OR gen_probe IS DISTINCT FROM sr_gen_pre THEN
    RAISE EXCEPTION 'TEST FAILED (SERVICE-ROLE 2f): a service_role caller SPOOFING tenant B''s claims reached tenant A''s share row (raised=%, error=%, rows=%, revoked_at % -> %, generation % -> %). Expected: no error — auth.uid() reads the caller-settable request.jwt.claims GUC, so the fail-loud guard does NOT bind a caller who sets it, and an arm that expected a refusal here would be certifying a wall that does not exist — and 0 rows, because `created_by = auth.uid()` in revoke_strategy_share''s UPDATE is the ONLY thing scoping this caller. RLS does not apply to a BYPASSRLS role. Without that predicate a spoofed admin-client call is an unbounded cross-tenant kill switch: any sub, any strategy, returning success. ⛔ If raised=t instead, the spoof did not take and this arm measured the guard from SERVICE-ROLE 2a rather than the predicate.', raised, COALESCE(err_msg, '(none)'), COALESCE(affected::TEXT, '(unset)'), COALESCE(sr_rev_pre::TEXT, '(null)'), COALESCE(now_revoked::TEXT, '(null)'), sr_gen_pre, gen_probe;
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
  -- NONCE 5: rule (0c) binds service_role — the role GRANTS cannot bind
  -- ======================================================================
  -- ⛔ NONCE 1 AND NONCE 2 PROVE THE GRANT LAYER, AND THE GRANT LAYER DOES NOT
  -- EXIST FOR THIS CALLER. `service_role` holds GRANT ALL on this table and is
  -- BYPASSRLS, and migration 20260827120000 STEP 2 records that this feature's
  -- recipient lane ALREADY reads strategy_shares through `createAdminClient()`
  -- — so it is on the hot path, not hypothetical. For that caller a trigger is
  -- the only control on this table at all, which makes rule (0c) the sole thing
  -- standing between an admin transport and a RESTORED nonce.
  --
  -- MEASURED (PostgreSQL 16, throwaway cluster, 2026-08-27) with rule (0c)
  -- absent: `SET ROLE service_role; UPDATE strategy_shares SET nonce = <a value
  -- recorded before the row was destroyed>` was ACCEPTED, raised=f. That is
  -- SYNTHESIS §3's R2g residual in its cheapest form.
  --
  -- ⚠️ WHAT THIS DOES **NOT** BUY, so nobody reads a green here as more than it
  -- is: an operator who can read `SHARE_TOKEN_SECRET` can mint any token from
  -- scratch, and no in-database control binds that. The residual is inherent
  -- and is accepted in writing (SYNTHESIS §7). Rule (0c) removes the form of it
  -- that needs nothing but a table write.
  --
  -- Message-pinned, and pinned to (0c) SPECIFICALLY rather than to any
  -- trigger error: rules (0a)/(0b)/(1)/(2) all raise `check_violation` from the
  -- same function, and this statement touches only `nonce`, so a bare `raised`
  -- would be satisfied by a rule that has nothing to do with the nonce.
  -- RED-UNDER: delete the `IF NEW.nonce IS DISTINCT FROM OLD.nonce` block from
  --            strategy_shares_enforce_monotonic_generation() (STEP 1b).
  -- RED-UNDER-M: {"arm":"NONCE 5a","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF NEW.nonce IS DISTINCT FROM OLD.nonce THEN\n    RAISE EXCEPTION 'strategy_shares: nonce is immutable — refusing to rewrite the MAC witness on strategy %. The nonce is what makes a destroyed-and-recreated row land in a token space DISJOINT from every token ever issued; letting it be written back restores a recorded value and resurrects those tokens. STEP 2''s column grant already denies this to `authenticated`, so a write that reaches this rule came from a role that BYPASSES grants — service_role, which holds GRANT ALL and is on this feature''s hot path. A trigger is the only control on this table that binds it.',\n      OLD.strategy_id\n      USING ERRCODE = 'check_violation';\n  END IF;\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_trigfn_s !~* 'NEW\\.nonce\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.nonce' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}],"neuter":[{"arm":"SHAPE 5b"}]}
  SET LOCAL ROLE service_role;
  raised := FALSE;
  BEGIN
    UPDATE strategy_shares SET nonce = nonce_mint WHERE strategy_id = strat_b;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  RESET ROLE;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (NONCE 5a): service_role rewrote `nonce` on a share row. That role holds GRANT ALL and BYPASSRLS, so neither the column grant (NONCE 1/2) nor the owner policy applies to it — trigger rule (0c) is the ONLY control on this table that reaches it, and it is missing. An admin transport can then record a nonce, let the row be destroyed and re-created, and put the old value back, re-deriving every token that row ever issued.';
  END IF;
  IF err_msg NOT LIKE '%nonce is immutable%' THEN
    RAISE EXCEPTION 'TEST FAILED (NONCE 5b): the service_role nonce rewrite was rejected by something OTHER than rule (0c) (got: %). All five trigger rules raise check_violation from the same function, and this statement touches only `nonce`, so a rejection carrying any other message means rule (0c) is gone and some unrelated rule fired — or that a grant/policy blocked it, which for a BYPASSRLS role with GRANT ALL would itself be the surprise worth investigating.', err_msg;
  END IF;

  -- ...and the victim row is byte-untouched. Unlike the rejected-write probes
  -- this file DELETED as unfailable, this one is NOT reading its own
  -- subtransaction rollback: with rule (0c) absent the UPDATE SUCCEEDS and
  -- COMMITS inside the block, no exception is raised, `raised` stays FALSE, and
  -- the nonce really is the rewritten value — NONCE 5a fires first in that
  -- world, so this arm is a consistency check on the trigger's BEFORE timing
  -- rather than an independent pin. It is kept because it costs nothing and
  -- would catch an AFTER-trigger miscreation that SHAPE 5 somehow admitted.
  SELECT nonce INTO nonce_after FROM strategy_shares WHERE strategy_id = strat_b;
  IF nonce_after = nonce_mint THEN
    RAISE EXCEPTION 'TEST FAILED (NONCE 5c): the rejected nonce rewrite still landed — tenant B''s row now carries tenant A''s nonce. A BEFORE trigger that raises must leave the tuple untouched; if this fires, the guard was installed AFTER the write.';
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
  SELECT c.generation INTO gen_pre_san FROM public.create_strategy_share(strat_a) c;
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

  -- ⛔⛔ THE ROW-COUNT ARM MUST COME FIRST, AND THE ORDER IS A CORRECTNESS
  -- PROPERTY, NOT A STYLE ONE. It used to sit LAST, after the revoked_at and
  -- generation arms, and that made it unreachable AND made the arm above it lie:
  -- `SELECT revoked_at, generation INTO ...` matches ZERO ROWS when the row was
  -- DELETEd, which leaves `now_revoked` NULL — the exact condition SANITIZE 1c
  -- reads as "still live". `UNIQUE(strategy_id)` means the count can never be
  -- anything but 0 or 1, so there was no configuration in which 1e fired first.
  -- MEASURED 2026-08-28, with sanitize_user's arm changed to
  -- `DELETE FROM strategy_shares WHERE created_by = p_user_id AND revoked_at IS
  -- NULL` (and migration 20260827130000's two apply-time greps neutered so the
  -- apply survived): the file reported
  --   "SANITIZE 1c: after sanitize_user the data subject's share row is STILL
  --    LIVE ... its `UPDATE strategy_shares` arm was dropped"
  -- for an erasure that had DELETED the row — the precise inverse of what
  -- happened, sending the operator to look for a statement that is present.
  -- With the count read first, the same mutation reports SANITIZE 1e instead.
  -- RED-UNDER: change sanitize_user's `UPDATE strategy_shares SET revoked_at =
  --            now(), generation = generation + 1 ...` to a `DELETE FROM
  --            strategy_shares ...` with the same WHERE clause.
  -- ⚠️ LAYERED: migration 20260827130000's STEP 2 greps for that UPDATE and
  --    separately rejects any `DELETE FROM strategy_shares`, and either arm
  --    aborts the apply — so both must be neutered in the same mutation or this
  --    file never runs. With both gone SANITIZE 1e is the first failure
  --    (MEASURED: "share row count is 0 after erasure, expected 1").
  -- RED-UNDER-M: {"arm":"SANITIZE 1e","apply":[{"kind":"edit","file":"supabase/migrations/20260827130000_sanitize_user_revoke_strategy_shares.sql","find":"  UPDATE strategy_shares\n     SET revoked_at = now(),\n         generation = generation + 1\n   WHERE created_by = p_user_id\n     AND revoked_at IS NULL;\n","replace":"  DELETE FROM strategy_shares\n   WHERE created_by = p_user_id\n     AND revoked_at IS NULL;\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827130000_sanitize_user_revoke_strategy_shares.sql","find":"  IF v_body_stripped !~* 'UPDATE\\s+(?:public\\.)?strategy_shares\\s+SET\\s+revoked_at\\s*=\\s*now\\s*\\(\\s*\\)\\s*,\\s*generation\\s*=\\s*generation\\s*\\+\\s*1\\s+WHERE\\s+created_by\\s*=\\s*p_user_id\\s+AND\\s+revoked_at\\s+IS\\s+NULL' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827130000_sanitize_user_revoke_strategy_shares.sql","find":"  IF v_body_stripped ~* '\\mDELETE\\s+FROM\\s+(?:public\\.)?strategy_shares\\M' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  SELECT count(*) INTO row_cnt FROM strategy_shares WHERE strategy_id = strat_a;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (SANITIZE 1e): the subject''s share row count is % after erasure, expected 1. sanitize_user must SOFT-revoke: deleting the row discards the generation counter, and the next create_strategy_share() would restart at generation 1 — resurrecting every already-revoked token. ⛔ Read this BEFORE SANITIZE 1c below: when the row is gone, 1c''s `SELECT revoked_at INTO` matches nothing, leaves the variable NULL and would report the erasure as having left the row LIVE — the exact opposite of a hard delete. That is why this arm is ordered first.', row_cnt;
  END IF;

  SELECT revoked_at, generation INTO now_revoked, gen_final
    FROM strategy_shares WHERE strategy_id = strat_a;
  IF now_revoked IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (SANITIZE 1c): after sanitize_user the data subject''s share row is STILL LIVE. Every link they ever copied still resolves to their unpublished factsheet — returns curve, metrics and trade analytics all survive the anonymize — and banned_until = infinity means they can never log in to revoke it. Companion migration 20260827130000 is missing or its `UPDATE strategy_shares` arm was dropped. (SANITIZE 1e above has already proved the row EXISTS, so this really is a live row and not a missing one.)';
  END IF;
  -- ⛔ SUBTRACT, NEVER `gen_pre_san + 1` — same rule as REVOKE 1c above and N1
  -- 1c / N1 3a below, and it is least dispensable HERE of all four: N1 3a is the
  -- arm that drives this same counter toward the ceiling on purpose, and it was
  -- written as `+ 1` first and MEASURED aborting on its own arithmetic.
  IF (gen_final - gen_pre_san) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (SANITIZE 1d): generation is % after erasure, up from % — expected exactly one more. If it is UNCHANGED the erasure is COSMETIC: revoked_at is stamped but the token still derives from the same counter, so every previously-copied link KEEPS WORKING.', gen_final, gen_pre_san;
  END IF;

  -- ...and the erasure is scoped to the subject. `created_by = p_user_id` is
  -- the ONLY scope this statement has (sanitize_user is SECURITY DEFINER, so
  -- RLS is not applied to it), which makes a cross-tenant control mandatory.
  SELECT generation, revoked_at INTO gen_b_after, b_revoked
    FROM strategy_shares WHERE strategy_id = strat_b;
  IF b_revoked IS NOT NULL OR gen_b_after IS DISTINCT FROM gen_b THEN
    RAISE EXCEPTION 'TEST FAILED (SANITIZE 1f): erasing tenant A also revoked tenant B''s share (revoked_at=%, generation % -> %) — the `created_by = p_user_id` predicate is missing from the sanitize arm, so ONE user''s Art. 17 request kills EVERY user''s share links', b_revoked, gen_b, gen_b_after;
  END IF;

  -- ======================================================================
  -- N1 3a: the ART. 17 ERASURE IS NON-ABORTABLE — the arm that would have
  --        caught N1
  -- ======================================================================
  -- ⛔ THIS IS THE CONSEQUENCE ARM. SANITIZE 1c/1d prove the erasure REVOKES;
  -- this proves it CANNOT BE STOPPED by the data subject, which is a different
  -- property and was the actual severity of N1. Reproduced verbatim from
  -- EXECUTION-EVIDENCE.md §5 against the live schema:
  --   step 2  the subject PATCHes generation = 9223372036854775807
  --   step 4  sanitize_user(uid)   ⛔ Art. 17 ERASURE ABORTED, 22003
  -- The erasure arm runs the same `generation + 1` as revoke, so overflowing the
  -- counter aborts the WHOLE anonymize — with `banned_until = 'infinity'` the
  -- subject cannot log back in to undo it, and an operator must DELETE the row
  -- by hand before the erasure can run at all. One PATCH, using a column the
  -- product grants every user.
  --
  -- ⭐ RUN ON TENANT B, AND ONLY HERE. B's row must still be live and untouched
  -- for SANITIZE 1f directly above (which proves A's erasure did not reach it),
  -- so this is the first point in the file where B may be erased. Moving it
  -- earlier makes SANITIZE 1f fail; moving it into the A block makes it a second
  -- sanitize_user call on an already-sanitized user, which returns FALSE.
  --
  -- ⚠️ THE CEILING JUMP HERE IS A PRECONDITION, NOT AN ASSERTION — 1a already
  -- pins the rejection, and asserting it twice would make this arm a duplicate
  -- of that one rather than a test of the erasure. What is asserted is only that
  -- the erasure COMPLETED and advanced by exactly one. The `+1` is deliberately
  -- performed FIRST so that under the mutation below the swallowed jump leaves
  -- the counter at the ceiling and it is sanitize_user, not this file's own
  -- setup, that raises.
  -- RED-UNDER: delete the `IF NEW.generation > OLD.generation + 1` block from
  --            strategy_shares_enforce_monotonic_generation() (STEP 1b).
  -- ⚠️ LAYERED FOUR DEEP, and the depth was MEASURED rather than predicted —
  --    the first two attempts at this mutation both surfaced a different arm
  --    (the OWNER 2d precedent, applied honestly). To observe THIS arm red:
  --      1. remove migration 20260827120000's STEP 6 arm (v-e), which greps for
  --         rule (6) and aborts the apply without it;
  --      2. neuter N1 1a's ASSERTION — it detects the same defect and fires
  --         first, which is intended: 1a is the cheap detector;
  --      3. neuter 1a's UPDATE STATEMENT too, not just its assertion. Left to
  --         run, the jump parks strat_a4 at 2^63-1 and then N1 1b overflows and
  --         fires instead (measured);
  --      4. and 1b's statement likewise — otherwise sanitize_user(uid_a) in the
  --         SANITIZE block hits that same ceilinged A-owned row and aborts
  --         there, so tenant A's erasure wedges before tenant B's is reached.
  --    Step 4 is itself a demonstration of the defect: with rule (6) gone the
  --    Art. 17 erasure aborts on ANY of the subject's rows, not just the one the
  --    attacker aimed at. With all four applied this arm goes red on
  --    `raised=t, error=bigint out of range` (MEASURED). Its standing value is
  --    to state the consequence in the language the regulation is written in,
  --    and to fail if the erasure ever becomes abortable by a route rule (6)
  --    does not cover.
  -- RED-UNDER-M: {"arm":"N1 3a","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF NEW.generation > OLD.generation + 1 THEN\n    RAISE EXCEPTION 'strategy_shares: generation may advance by AT MOST ONE per statement — refusing to move it from % to % on strategy %. An unbounded jump does not merely skip numbers: it drives the counter to the BIGINT ceiling in ONE request from an ordinary owner token (they hold the STEP 2 UPDATE(generation) column grant, and rule (1) forbids only a DECREASE). After that, revoke_strategy_share and the GDPR Art. 17 erasure arm in migration 20260827130000 are the SAME generation + 1 statement, so both raise 22003 numeric_value_out_of_range and the data subject has WEDGED THEIR OWN ERASURE with one PATCH (MEASURED 2026-08-27). Bounding every advance to +1 is what makes that overflow unreachable by construction.',\n      OLD.generation, NEW.generation, OLD.strategy_id\n      USING ERRCODE = 'check_violation';\n  END IF;\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"  IF v_trigfn_s !~* 'NEW\\.generation\\s*>\\s*OLD\\.generation\\s*\\+\\s*1' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1},{"kind":"edit","file":"supabase/tests/test_strategy_shares_rls.sql","find":"    UPDATE strategy_shares SET generation = 9223372036854775807 WHERE strategy_id = strat_a4;\n","replace":"    NULL;\n","occurrences":1},{"kind":"edit","file":"supabase/tests/test_strategy_shares_rls.sql","find":"    UPDATE strategy_shares SET generation = generation + 2 WHERE strategy_id = strat_a4;\n","replace":"    NULL;\n","occurrences":1}],"neuter":[{"arm":"N1 1a"},{"arm":"N1 1b"}]}
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  -- Drive the counter as high as the rules NOW permit: exactly one step.
  UPDATE strategy_shares SET generation = generation + 1 WHERE strategy_id = strat_b;
  BEGIN
    UPDATE strategy_shares SET generation = 9223372036854775807 WHERE strategy_id = strat_b;
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- refused by rule (6): the post-fix path, pinned by N1 1a, not here
  END;
  SELECT generation INTO gen_pre_san FROM strategy_shares WHERE strategy_id = strat_b;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  raised := FALSE; err_msg := NULL; san_ok := NULL;
  BEGIN
    SELECT public.sanitize_user(uid_b) INTO san_ok;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  SELECT revoked_at, generation INTO b_revoked, gen_b_after
    FROM strategy_shares WHERE strategy_id = strat_b;
  -- ⛔ SUBTRACT, NEVER `gen_pre_san + 1`. MEASURED while observing this arm red:
  -- written as `gen_b_after IS DISTINCT FROM gen_pre_san + 1` the arm ABORTED
  -- ON ITS OWN ARITHMETIC — in the failure case the counter is sitting at
  -- 2^63-1, so both the comparison and the message's `expected %` slot overflow
  -- and psql reports a bare `bigint out of range ... at RAISE` instead of this
  -- diagnosis. PL/pgSQL gives no short-circuit guarantee, so guarding it behind
  -- `raised` would not have helped. An arm whose report overflows exactly when
  -- it fires is a test that cannot speak, which is barely better than one that
  -- cannot fail. The difference is always small and never overflows.
  IF raised
     OR san_ok IS NOT TRUE
     OR b_revoked IS NULL
     OR (gen_b_after - gen_pre_san) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (N1 3a): the GDPR Art. 17 erasure did not complete cleanly for a subject who had just attempted the ceiling jump (raised=%, error=%, returned=%, revoked_at=%, generation % -> %, expected exactly one more than the pre-erasure value). If the error is 22003 bigint out of range, the bounded-increment rule is gone and the data subject WEDGED THEIR OWN ERASURE with one PATCH — the whole anonymize aborts, banned_until = infinity means they can never log in to undo it, and an operator must hand-DELETE the share row before Art. 17 can be honoured at all.',
      raised, COALESCE(err_msg, '(none)'), COALESCE(san_ok::TEXT, '(null)'), b_revoked, gen_pre_san, gen_b_after;
  END IF;

  RAISE NOTICE 'test_strategy_shares_rls: ALL 103 ARMS EXECUTED (SHAPE 1, SHAPE 1b, SHAPE 1c, SHAPE 2a, SHAPE 2b, SHAPE 3, SHAPE 3b, SHAPE 4a, SHAPE 4b, SHAPE 4c, SHAPE 4d, SHAPE 4e, SHAPE 5, SHAPE 5b-pre, SHAPE 5b, OWNER 1a, OWNER 1b, OWNER 1c, OWNER 2a, OWNER 2b, OWNER 2c, OWNER 2d, TENANT 1a, TENANT 1b, TENANT 2a, TENANT 2b, TENANT 3a, TENANT 3b, N1 2a, N1 2b, N1 1a, N1 1b, N1 1c, NO-DELETE 1, REVOKE 1a, REVOKE 1b, REVOKE 1c, REVOKE 2a, REVOKE 2b, REACTIVATE 1a, REACTIVATE 1b, REACTIVATE 1c, REACTIVATE 1d, REACTIVATE 1e, REACTIVATE 1f, REACTIVATE 1g, TRIGGER 1a, TRIGGER 1b, MONOTONIC 1a, MONOTONIC 1b, MONOTONIC 1c, TRIGGER 2a, TRIGGER 2b, TRIGGER 3a, TRIGGER 3b, TRIGGER 3c, TRIGGER 3d-i, TRIGGER 3d-ii, TRIGGER 4a, TRIGGER 4b, TRIGGER 4c-i, TRIGGER 4c-ii, NONCE 1a, NONCE 1b, NONCE 2a, NONCE 2b, NONCE 3, NONCE 4a, NONCE 4b, NONCE 4c, TENANT 4a, TENANT 4b, TENANT 4c, TENANT 5a, TENANT 5b, ANON 1a, ANON 1b, ANON 1b-grant, ANON 1c, ANON 1c-grant, ANON 1d, ANON 1d-grant, ANON 2, ANON 2b, SERVICE-ROLE 0-acl, SERVICE-ROLE 1, SERVICE-ROLE 1-grant, SERVICE-ROLE 2a, SERVICE-ROLE 2b, SERVICE-ROLE 2c, SERVICE-ROLE 2d, SERVICE-ROLE 2f, SERVICE-ROLE 2e, NONCE 5a, NONCE 5b, NONCE 5c, SANITIZE 1a, SANITIZE 1b, SANITIZE 1c, SANITIZE 1d, SANITIZE 1e, SANITIZE 1f, N1 3a). Observed generation sequence: %', gen_seen;
END
$$;

ROLLBACK;
