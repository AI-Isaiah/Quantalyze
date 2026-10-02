-- Test for migration 20260710120000_strategy_keys.sql — the strategy_keys
-- composite-membership RLS + owner-coherence trigger. Phase 85 (COMP-01).
--
-- This is the phase's load-bearing tenant-isolation test. strategy_keys links a
-- strategy to N api_keys, each carrying a half-open [window_start, window_end)
-- window and a seq ordinal, gated by RLS `owner_id = auth.uid()` and an
-- owner-coherence BEFORE trigger. RLS FAILS SILENTLY — a loosened USING ships
-- GREEN unless a test inspects the returned rows by CONTENT (count / owner_id).
-- A test that asserts "a row came back" is not proof, nor is checking that a
-- policy exists in pg_policy. This file asserts:
--   * tenant A sees exactly A's rows and NEVER any of B's (cross-tenant);
--   * tenant B sees exactly B's row and NEVER any of A's;
--   * anon sees 0 rows (TO authenticated only + REVOKE anon);
--   * the owner-coherence trigger rejects owner_id != api_keys.user_id
--     (the '%must match%' arm, pinned), a cross-tenant strategy/key attach,
--     and a dangling api_key reference;
--   * the window CHECK rejects an empty half-open interval (window_end = start);
--   * the (strategy_id, seq) unique index rejects a duplicate seq;
--   * the RLS WITH CHECK blocks writing a row owned by another tenant.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands (the
-- sql-tests preflight rejects shell-out / copy / output redirection). Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. Filename matches the
-- `test_*.sql` glob so the job auto-discovers it against the test project (with
-- migration 20260710120000 applied).
--
-- Hygiene: all fixture work runs inside an explicit transaction that ends in
-- ROLLBACK, so the shared test DB is never polluted (no committed fixture rows).
-- The exception-trapped arms use nested BEGIN ... EXCEPTION (an implicit
-- savepoint) so a deliberately-failing INSERT does not abort the outer block.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_strategy_keys_rls.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, VAC-01). Each prose RED-UNDER below
-- carries an adjacent `RED-UNDER-M` object that scripts/mutation-runner executes
-- on every push: it mutates COPIES, requires the FIRST `TEST FAILED (…)` to name
-- that arm, and restores GREEN. The schema is scripts/mutation-runner/GRAMMAR.md.
-- The line below declares what the lane applies before this gate. It was
-- DISCOVERED, not guessed — plan 164.4-05 iterated it over 2 lane runs to
-- `ALL PASS`, mean 0.97 s/lane over 3 timed GREEN runs.
-- ⚠️ 07-fixture-supabase-default-privileges.sql is NOT optional padding: without
-- Supabase's bootstrap default privileges, `anon` never held a grant on a table a
-- migration creates, so this migration's `REVOKE ALL … FROM anon` would be a no-op
-- and RLS 4 would pass for a reason unrelated to the migration.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20260710120000_strategy_keys.sql"]}

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- ON DELETE CASCADE chains auth.users -> profiles -> {strategies, api_keys}
-- -> strategy_keys, so deleting auth.users by email drops the whole subtree.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-skeys-rls-tenant-a@quantalyze.test',
    'test-skeys-rls-tenant-b@quantalyze.test'
  );

BEGIN;

DO $$
DECLARE
  uid_a    UUID := gen_random_uuid();
  uid_b    UUID := gen_random_uuid();
  key_a    UUID;
  key_b    UUID;
  strat_a  UUID;
  strat_b  UUID;
  row_cnt  INTEGER;
  raised   BOOLEAN;
  err_msg  TEXT;
BEGIN
  -- ----- SEED (seeding/service-role context — bypasses RLS, fires trigger) --
  -- Tenant A: two member keys with distinct seq (0 closed window, 1 open-ended).
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-skeys-rls-tenant-a@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'skeys-rls tenant a', 'test-skeys-rls-tenant-a@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_a, 'binance', 'skeys-rls A key', 'x') RETURNING id INTO key_a;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'skeys-rls A strategy', 'published', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a;

  -- seq 0: closed half-open window [2025-08-01, 2025-10-01)
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
  VALUES (strat_a, key_a, uid_a, '2025-08-01', '2025-10-01', 0);
  -- seq 1: open-ended window [2025-10-01, ) — window_end NULL (still active)
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
  VALUES (strat_a, key_a, uid_a, '2025-10-01', NULL, 1);

  -- Tenant B: one member key.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-skeys-rls-tenant-b@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'skeys-rls tenant b', 'test-skeys-rls-tenant-b@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_b, 'binance', 'skeys-rls B key', 'x') RETURNING id INTO key_b;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_b, 'skeys-rls B strategy', 'published', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_b;

  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
  VALUES (strat_b, key_b, uid_b, '2025-08-01', NULL, 0);

  RAISE NOTICE 'Seed OK: A uid=% key=% strat=%, B uid=% key=% strat=%',
    uid_a, key_a, strat_a, uid_b, key_b, strat_b;

  -- ----- TRIGGER ARM 1: owner_id != api_keys.user_id → '%must match%' -------
  -- key_a is owned by A; owner_id=B is incoherent. FK is valid, so only the
  -- owner-mismatch arm can fire — the message must be pinned.
  -- RED-UNDER: short-circuit the owner-mismatch branch of
  --            enforce_strategy_keys_owner_coherence() in migration 20260710120000
  --            to `IF FALSE THEN`, so an incoherent owner_id is accepted.
  -- RED-UNDER-M: {"arm":"Arm 1","apply":[{"kind":"edit","file":"supabase/migrations/20260710120000_strategy_keys.sql","find":"  IF NEW.owner_id IS DISTINCT FROM v_key_owner THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_a, key_a, uid_b, '2026-01-01', NULL, 9);
  EXCEPTION WHEN raise_exception THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 1): a row with owner_id != api_keys.user_id was ACCEPTED — owner-coherence trigger missing or loosened';
  END IF;
  IF err_msg NOT LIKE '%must match%' THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 1): trigger raised the WRONG arm (expected owner-mismatch, got: %)', err_msg;
  END IF;

  -- ----- TRIGGER ARM 2: cross-tenant attach (strategy owner != key owner) ---
  -- owner_id=B coheres with key_b (owned B), but strat_a is owned by A.
  -- RED-UNDER: short-circuit the cross-tenant branch of
  --            enforce_strategy_keys_owner_coherence() in migration 20260710120000
  --            to `IF FALSE THEN`. Arm 1's owner-mismatch branch stays live, so
  --            this is the first arm the mutation reaches.
  -- RED-UNDER-M: {"arm":"Arm 2","apply":[{"kind":"edit","file":"supabase/migrations/20260710120000_strategy_keys.sql","find":"  IF v_strategy_owner IS DISTINCT FROM v_key_owner THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_a, key_b, uid_b, '2026-02-01', NULL, 8);
  EXCEPTION WHEN raise_exception THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 2): a cross-tenant strategy/key attach was ACCEPTED — owner-coherence trigger missing or loosened';
  END IF;
  IF err_msg NOT LIKE '%cross-tenant%' THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 2): trigger raised the WRONG arm (expected cross-tenant, got: %)', err_msg;
  END IF;

  -- ----- TRIGGER ARM 3: dangling api_key reference -------------------------
  -- A random api_key_id has no api_keys row; the BEFORE trigger resolves NULL
  -- owner and raises before the FK constraint is evaluated.
  -- WHEN raise_exception (NOT WHEN OTHERS): the trigger's dangling guard raises
  -- P0001 '%does not reference%'. Catching WHEN OTHERS would let the FK's
  -- foreign_key_violation (23503) satisfy this arm even if the trigger guard were
  -- deleted — a masked arm. Pinning the message proves the TRIGGER caught it.
  -- RED-UNDER: short-circuit the dangling-api_key branch of
  --            enforce_strategy_keys_owner_coherence() in migration 20260710120000
  --            to `IF FALSE THEN`.
  -- ⚠️ It is the arm's SECOND raise that fires, not its first: with the NULL guard
  --    gone the next branch compares owner_id against a NULL key owner and raises
  --    '%must match%', so the INSERT is still refused but by the WRONG guard —
  --    which is precisely what this arm's message-pinning half exists to catch.
  -- RED-UNDER-M: {"arm":"Arm 3","apply":[{"kind":"edit","file":"supabase/migrations/20260710120000_strategy_keys.sql","find":"  IF v_key_owner IS NULL THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_a, gen_random_uuid(), uid_a, '2026-03-01', NULL, 7);
  EXCEPTION WHEN raise_exception THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 3): a row with a dangling api_key_id was ACCEPTED — dangling-reference guard missing';
  END IF;
  IF err_msg NOT LIKE '%does not reference%' THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 3): dangling api_key raised the WRONG guard (expected trigger dangling-reference, got: %)', err_msg;
  END IF;

  -- ----- CONSTRAINT ARM 4: empty half-open interval (window_end = start) ----
  -- RED-UNDER: loosen strategy_keys_window_order in migration 20260710120000 from
  --            `window_end > window_start` to `>=` — the off-by-one the constraint
  --            comment names as the landmine.
  -- RED-UNDER-M: {"arm":"Arm 4","apply":[{"kind":"edit","file":"supabase/migrations/20260710120000_strategy_keys.sql","find":"CHECK (window_end IS NULL OR window_end > window_start)","replace":"CHECK (window_end IS NULL OR window_end >= window_start)","occurrences":1}]}
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_a, key_a, uid_a, '2025-08-01', '2025-08-01', 6);
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 4): window_end = window_start (empty half-open interval) was ACCEPTED — strategy_keys_window_order CHECK missing or loosened to >=';
  END IF;

  -- ----- CONSTRAINT ARM 5: duplicate (strategy_id, seq) -------------------
  -- RED-UNDER: drop UNIQUE from strategy_keys_strategy_seq_key in migration
  --            20260710120000, so a duplicate (strategy_id, seq) is accepted.
  -- ⚠️ LAYERED: the migration's own self-check (c) requires `indisunique`, so the
  --    second step removes that term or the apply aborts and the gate never runs.
  -- RED-UNDER-M: {"arm":"Arm 5","apply":[{"kind":"edit","file":"supabase/migrations/20260710120000_strategy_keys.sql","find":"CREATE UNIQUE INDEX strategy_keys_strategy_seq_key ON public.strategy_keys (strategy_id, seq);","replace":"CREATE INDEX strategy_keys_strategy_seq_key ON public.strategy_keys (strategy_id, seq);","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260710120000_strategy_keys.sql","find":" AND i.indisunique","replace":"","occurrences":1}]}
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_a, key_a, uid_a, '2026-04-01', NULL, 0);  -- seq 0 already used by A
  EXCEPTION WHEN unique_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 5): a duplicate (strategy_id, seq) was ACCEPTED — strategy_keys_strategy_seq_key unique index missing';
  END IF;

  -- ----- RLS 1: tenant A sees exactly A's 2 rows, 0 of B's ---------------
  -- RED-UNDER: widen the strategy_keys_owner policy's USING clause in migration
  --            20260710120000 to `USING (true)`, so every authenticated tenant
  --            reads the whole membership table.
  -- RED-UNDER-M: {"arm":"RLS 1a","apply":[{"kind":"edit","file":"supabase/migrations/20260710120000_strategy_keys.sql","find":"  USING (owner_id = auth.uid())","replace":"  USING (true)","occurrences":1}]}
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM strategy_keys;
  IF row_cnt <> 2 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 1a): tenant A sees % strategy_keys rows, expected 2 (its own)', row_cnt;
  END IF;
  SELECT count(*) INTO row_cnt FROM strategy_keys WHERE owner_id = uid_b;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 1b): tenant A sees % of tenant B''s rows, expected 0 — CROSS-TENANT LEAK', row_cnt;
  END IF;
  RESET ROLE;

  -- ----- RLS 2: tenant B sees exactly B's 1 row, 0 of A's ---------------
  -- RED-UNDER: the SAME `USING (true)` widening as RLS 1a, with BOTH of RLS 1's
  --            raises neutered so tenant B's over-read is the first failure.
  -- ⚠️ SHADOWED BY DESIGN: a policy is one object, so any USING widening is seen
  --    by tenant A four assertions earlier. Both RLS 1a and RLS 1b must be named —
  --    a `neuter` suppresses ONE raise per arm, and RLS 1 raises twice under two
  --    distinct identities. Their abort-path `RESET ROLE;` is absorbed with them.
  -- RED-UNDER-M: {"arm":"RLS 2a","apply":[{"kind":"edit","file":"supabase/migrations/20260710120000_strategy_keys.sql","find":"  USING (owner_id = auth.uid())","replace":"  USING (true)","occurrences":1}],"neuter":[{"arm":"RLS 1a"},{"arm":"RLS 1b"}]}
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO row_cnt FROM strategy_keys;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 2a): tenant B sees % strategy_keys rows, expected 1 (its own)', row_cnt;
  END IF;
  SELECT count(*) INTO row_cnt FROM strategy_keys WHERE owner_id = uid_a;
  IF row_cnt <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 2b): tenant B sees % of tenant A''s rows, expected 0 — CROSS-TENANT LEAK', row_cnt;
  END IF;

  -- ----- RLS 2c: POSITIVE CONTROL — a tenant CAN write its own coherent row --
  -- Without this, a policy that blocks ALL client writes (WITH CHECK false, or an
  -- INSERT-less FOR SELECT policy → default-deny) would pass every negative arm
  -- while breaking every legitimate write. Still authenticated as tenant B: a
  -- fully coherent B-owned member (owner_id=B, key_b, strat_b) MUST succeed.
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_b, key_b, uid_b, '2026-07-01', NULL, 3);
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 2c): tenant B could NOT write its own coherent row — policy blocks all client writes (got: %)', SQLERRM;
  END;

  -- ----- RLS 3: WITH CHECK blocks writing another tenant's row ----------
  -- Still authenticated as tenant B. A coherent row (owner_id=B, key_b, strat_b)
  -- passes the trigger, but owner_id=A would violate WITH CHECK. Here we prove B
  -- cannot write a row owned by A (owner_id=A) — the trigger fires first on the
  -- owner-mismatch, or WITH CHECK blocks it; either way it MUST fail.
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_b, key_b, uid_a, '2026-05-01', NULL, 1);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 3): tenant B wrote a row with owner_id = tenant A — WITH CHECK / trigger not enforcing owner';
  END IF;

  -- ----- RLS 3b: WITH CHECK in ISOLATION (trigger must NOT be what blocks) ---
  -- Still authenticated as tenant B. A FULLY COHERENT tenant-A triple
  -- (owner_id=A, key_a owned by A, strat_a owned by A) PASSES the owner-coherence
  -- trigger (all three equal A), so the ONLY thing that can reject it is the RLS
  -- WITH CHECK (owner_id = auth.uid() = B). This pins WITH CHECK independently of
  -- the trigger — Arm RLS 3 above is masked by the trigger's '%must match%' arm.
  -- RED-UNDER: widen the strategy_keys_owner policy's WITH CHECK clause in
  --            migration 20260710120000 to `WITH CHECK (true)`, leaving USING and
  --            the owner-coherence trigger untouched.
  -- ⚠️ The twin names RLS 3b, not RLS 3: RLS 3's own write is blocked by the
  --    trigger's '%must match%' arm even with WITH CHECK gone — which is the
  --    masking this sub-arm exists to defeat, and why the coherent A-triple is the
  --    only write that isolates WITH CHECK.
  -- RED-UNDER-M: {"arm":"RLS 3b","apply":[{"kind":"edit","file":"supabase/migrations/20260710120000_strategy_keys.sql","find":"  WITH CHECK (owner_id = auth.uid())","replace":"  WITH CHECK (true)","occurrences":1}]}
  raised := FALSE;
  BEGIN
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
    VALUES (strat_a, key_a, uid_a, '2026-06-01', NULL, 5);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 3b): tenant B inserted a coherent tenant-A row — RLS WITH CHECK missing or asymmetric with USING';
  END IF;
  IF err_msg LIKE '%must match%' OR err_msg LIKE '%cross-tenant%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 3b): coherent A-triple was blocked by the owner-coherence TRIGGER (%), not WITH CHECK — WITH CHECK is not independently proven', err_msg;
  END IF;
  -- Positively confirm the block is the RLS WITH CHECK, not some unrelated error.
  IF err_msg NOT LIKE '%row-level security%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (RLS 3b): coherent A-triple was blocked by neither the trigger nor WITH CHECK (got: %)', err_msg;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ----- RLS 4: anon sees 0 rows ---------------------------------------
  -- Policy is TO authenticated + REVOKE anon; anon either lacks the grant
  -- (42501) or RLS returns 0. Either way anon must not read membership.
  -- RED-UNDER: on the live lane database, hand `anon` back both layers the
  --            migration takes away — the table grant it REVOKEs and a permissive
  --            SELECT policy (the real one is `TO authenticated`).
  -- ⚠️ A `sql` step, not a migration edit, and BOTH halves are required: the grant
  --    alone still yields 0 rows under the authenticated-only policy, and the
  --    policy alone still yields 42501. That is the arm's own claim — anon is
  --    blocked at two layers — expressed as the mutation that removes both.
  -- RED-UNDER-M: {"arm":"RLS 4","apply":[{"kind":"sql","stmt":"GRANT SELECT ON public.strategy_keys TO anon"},{"kind":"sql","stmt":"CREATE POLICY strategy_keys_anon_drift ON public.strategy_keys FOR SELECT TO anon USING (true)"}]}
  SET LOCAL ROLE anon;
  raised := FALSE;
  BEGIN
    SELECT count(*) INTO row_cnt FROM strategy_keys;
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; row_cnt := 0;
  END;
  RESET ROLE;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (RLS 4): anon sees % strategy_keys rows, expected 0', row_cnt;
  END IF;

  RAISE NOTICE 'test_strategy_keys_rls: ALL PASS (tenant isolation + owner coherence intact).';
END
$$;

ROLLBACK;
