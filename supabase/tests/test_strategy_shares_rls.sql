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
--   2. hand-apply 20260827120000 to the TEST project;
--   3. this file goes green in `sql-tests`;
--   4. merge to main — at which point the Supabase Migrate workflow applies the
--      same migration to PRODUCTION automatically.
--
-- WHAT THIS FILE ASSERTS (content-by-field; a 200 / a row count proves nothing)
-- ---------------------------------------------------------------------------
--   * SHAPE  — the column set is EXACTLY the six DDL columns, so no
--     token/token_hash/secret column has appeared at rest (D-02, T-164-07);
--     and both RPCs are SECURITY INVOKER with no PUBLIC EXECUTE.
--   * ANON   — blocked at BOTH layers: the grant layer (42501 on select and on
--     RPC execute) AND, independently, the policy layer (0 rows even when
--     SELECT is temporarily granted inside this rolled-back transaction).
--   * TENANT — the CR-01 owner-coherence WITH CHECK clause rejects an
--     authenticated user minting a share for ANOTHER tenant's strategy, via
--     the RPC and via a raw table INSERT; and a forged `created_by` is
--     rejected. A cross-tenant read returns 0 rows and a cross-tenant revoke
--     affects 0 rows without disturbing the victim's counter.
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
-- failing statement does not abort the outer block. The one GRANT this file
-- issues (layer-2 anon proof) is both explicitly reverted AND covered by the
-- ROLLBACK.
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

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-strategy-shares-owner-b@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'strategy-shares owner b', 'test-strategy-shares-owner-b@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_b, 'strategy-shares B strategy', 'private', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_b;

  RAISE NOTICE 'Seed OK: A uid=% strat=%, B uid=% strat=%', uid_a, strat_a, uid_b, strat_b;

  -- ======================================================================
  -- SHAPE 1: NO TOKEN AT REST (D-02 / T-164-07)
  -- ======================================================================
  -- The single most important property of this table is a NEGATIVE one: it
  -- holds no secret. Pin the column set EXACTLY — a future ALTER adding
  -- `token`, `token_hash`, `secret` or any sibling reintroduces precisely the
  -- disclosure surface D-02 rejected, and nothing else in the stack would
  -- notice. An `expected >= 6 columns` style assertion would NOT catch that;
  -- only an exact set does.
  SELECT string_agg(column_name, ',' ORDER BY column_name) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'strategy_shares';
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
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_shares (strategy_id, created_by) VALUES (strat_b, uid_b);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (TENANT 3): tenant A wrote a share row with created_by = tenant B — the `created_by = auth.uid()` half of WITH CHECK is missing';
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

  raised := FALSE;
  BEGIN
    INSERT INTO strategy_shares (strategy_id, created_by) VALUES (strat_a, uid_a);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (ANON 1b): anon INSERTed into strategy_shares';
  END IF;

  -- anon must not be able to invoke either RPC.
  raised := FALSE;
  BEGIN
    PERFORM public.create_strategy_share(strat_a);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (ANON 1c): anon holds EXECUTE on create_strategy_share — the REVOKE/GRANT block in migration 20260827120000 is missing or was overridden';
  END IF;

  raised := FALSE;
  BEGIN
    PERFORM public.revoke_strategy_share(strat_a);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (ANON 1d): anon holds EXECUTE on revoke_strategy_share';
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
  SELECT count(*) INTO row_cnt
    FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'strategy_shares' AND grantee = 'anon';
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (ANON 2b): % anon grant(s) remain on strategy_shares after the layer-2 probe — the REVOKE did not take (the transaction ROLLBACK is still the backstop, but this must not be relied on)', row_cnt;
  END IF;

  RAISE NOTICE 'test_strategy_shares_rls: ALL PASS (no token at rest, anon dead at both layers, CR-01 owner-coherence enforced, revoke atomic + convergent, reuse idempotent, generation monotonic, no client DELETE). Observed generation sequence: %', gen_seen;
END
$$;

ROLLBACK;
