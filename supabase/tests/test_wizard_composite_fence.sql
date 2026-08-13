-- Test for migration 20260710180000_wizard_composite.sql — the composite-draft
-- assembly RPC add_wizard_composite_key. Phase 88 (ONB-03).
--
-- add_wizard_composite_key lazily creates the ONE api_key_id=NULL composite
-- draft per (user, wizard_session_id) under a 'wizcomposite:' advisory-lock
-- fence, then ALWAYS inserts a fresh encrypted api_keys row and returns both
-- ids. It is the multi-key sibling of create_wizard_strategy (single-key, F6):
--   * the DRAFT is fenced per (user, session) — a double-click resolves to the
--     SAME draft, not two (the F6 double-submit dedup, ported to composites);
--   * but a real 2nd/3rd KEY add PROCEEDS (new api_keys row, same draft) — that
--     is ONB-03. Per-KEY idempotency is scoped on the member (Plan 88-02
--     set_wizard_composite_members wholesale write), NOT on the session draft.
--
-- This file asserts:
--   Part 1 — draft fence: two calls, same user + same session, different key
--            material → SAME strategy_id, the strategies row's api_key_id IS
--            NULL, and exactly ONE strategies row exists for that session.
--   Part 2 — ONB-03 proceed: those two calls minted TWO distinct api_keys rows
--            (the 2nd key proceeded, it did not replay/block).
--   Part 3 — auth guard: an auth.uid() mismatch RAISEs insufficient_privilege,
--            and anon has NO EXECUTE (has_function_privilege false).
--   Part 4 — single-key regression: create_wizard_strategy STILL creates a
--            strategies row WITH api_key_id set and STILL fences per (user,
--            session) — the single-key path is byte-unchanged (SC-4 canary).
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands (the
-- sql-tests preflight rejects shell-out / copy / output redirection). Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. Filename matches the
-- `test_*.sql` glob so the job auto-discovers it (with migration 20260710180000
-- applied). Pre-migration (RED): Part 1 fails (function absent) and
-- ON_ERROR_STOP aborts there.
--
-- Hygiene: all fixture work runs inside an explicit transaction that ends in
-- ROLLBACK, so the shared test DB is never polluted. All ids are
-- gen_random_uuid() and every auth.users email is derived from a fresh uuid, so
-- a concurrent CI run against the shared test project cannot collide and no
-- defensive pre-clean is needed. auth.uid() is driven by set_config on
-- request.jwt.claims (the Supabase JWT GUC the function reads); the outer block
-- stays in the service-role context so verification SELECTs bypass RLS.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_wizard_composite_fence.sql

-- ==========================================================================
-- Part 3a — structural: anon must NOT hold EXECUTE on either composite RPC.
-- Zero side effects; RED pre-migration (function absent → regprocedure errors,
-- which under ON_ERROR_STOP aborts — the intended pre-migration failure).
-- ==========================================================================
DO $$
BEGIN
  IF has_function_privilege('anon',
       'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3a): anon can EXECUTE add_wizard_composite_key — REVOKE missing';
  END IF;
  IF has_function_privilege('anon',
       'public.set_wizard_composite_members(uuid,uuid,jsonb)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3a): anon can EXECUTE set_wizard_composite_members — REVOKE missing';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3a): authenticated LOST EXECUTE on add_wizard_composite_key — GRANT missing';
  END IF;
  RAISE NOTICE 'Part 3a OK: anon has no EXECUTE, authenticated retains EXECUTE on the composite RPCs.';
END $$;

-- ==========================================================================
-- Parts 1, 2, 3b, 4 — integration: real add_wizard_composite_key /
-- create_wizard_strategy calls. Isolated in a transaction that always rolls
-- back; all ids gen_random_uuid().
-- ==========================================================================
BEGIN;

DO $$
DECLARE
  uid_a       UUID := gen_random_uuid();  -- composite fence tenant
  uid_wrong   UUID := gen_random_uuid();  -- auth-guard mismatch identity
  uid_c       UUID := gen_random_uuid();  -- single-key regression tenant
  uid_d       UUID := gen_random_uuid();  -- 156: service_role-arm tenant
  session_a   UUID := gen_random_uuid();
  session_c   UUID := gen_random_uuid();
  session_d   UUID := gen_random_uuid();  -- 156: service_role single-key session
  session_d2  UUID := gen_random_uuid();  -- 156: service_role composite session
  session_spoof UUID := gen_random_uuid(); -- 156: refused-call session (never minted)
  v_strat_sr  UUID;
  v_key_sr    UUID;
  v_attested  TEXT;
  v_strat1    UUID;
  v_key1      UUID;
  v_strat2    UUID;
  v_key2      UUID;
  v_strat_sk1 UUID;
  v_key_sk1   UUID;
  v_strat_sk2 UUID;
  v_key_sk2   UUID;
  v_api_key   UUID;
  row_cnt     INTEGER;
  row_cnt_before INTEGER;
  raised      BOOLEAN;
  err_msg     TEXT;
BEGIN
  -- ----- SEED users/profiles (service-role context) -------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-wizcomp-fence-' || uid_a || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'wizcomp fence a', 'test-wizcomp-fence-' || uid_a || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_c, '00000000-0000-0000-0000-000000000000',
          'test-wizcomp-fence-' || uid_c || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_c, 'wizcomp fence c', 'test-wizcomp-fence-' || uid_c || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  -- 156: the service_role-arm tenant. Seeded like the others because the
  -- service_role path still writes REAL rows subject to the same FKs — the arm
  -- skips the ownership CHECK, not the ownership COLUMN.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_d, '00000000-0000-0000-0000-000000000000',
          'test-wizcomp-fence-' || uid_d || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_d, 'wizcomp fence d', 'test-wizcomp-fence-' || uid_d || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  -- ======================================================================
  -- Part 1 — draft fence + Part 2 — ONB-03 proceed
  -- ======================================================================
  -- Drive auth.uid() = uid_a (the JWT GUC the SECDEF fn reads). Stay in the
  -- service-role role so verification SELECTs below bypass RLS.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  SELECT strategy_id, api_key_id INTO v_strat1, v_key1
    FROM public.add_wizard_composite_key(
      uid_a, 'binance', 'wizcomp key 1',
      'enc1', 'sec1', 'pass1', 'dek1', 'nonce1', 1, 'Composite draft A', session_a);

  SELECT strategy_id, api_key_id INTO v_strat2, v_key2
    FROM public.add_wizard_composite_key(
      uid_a, 'bybit', 'wizcomp key 2',
      'enc2', 'sec2', 'pass2', 'dek2', 'nonce2', 1, 'Composite draft A', session_a);

  -- Part 1a: SAME draft returned for both calls in the session (the fence).
  IF v_strat1 IS NULL OR v_strat1 <> v_strat2 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1a): the two composite adds returned DIFFERENT strategy ids (% vs %) — the (user, session) draft fence is broken', v_strat1, v_strat2;
  END IF;

  -- Part 1b: the composite draft carries a NULL api_key_id (single-key link
  -- never set for a composite — the composite-detection invariant).
  SELECT api_key_id INTO v_api_key FROM public.strategies WHERE id = v_strat1;
  IF v_api_key IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1b): the composite draft strategies.api_key_id is NOT NULL (%) — a composite draft must keep it NULL', v_api_key;
  END IF;

  -- Part 1c: exactly ONE strategies row for this (user, session).
  SELECT count(*) INTO row_cnt
    FROM public.strategies
   WHERE user_id = uid_a AND wizard_session_id = session_a;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1c): % strategies rows for (uid_a, session_a), expected exactly 1', row_cnt;
  END IF;

  -- Part 2a: two DISTINCT api_keys rows — the 2nd KEY proceeded (ONB-03).
  IF v_key1 IS NULL OR v_key2 IS NULL OR v_key1 = v_key2 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2a): the 2nd composite add did NOT mint a distinct api_keys row (% vs %) — ONB-03 per-key add regressed', v_key1, v_key2;
  END IF;

  -- Part 2b: exactly TWO api_keys rows for this user (one per add).
  SELECT count(*) INTO row_cnt FROM public.api_keys WHERE user_id = uid_a;
  IF row_cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2b): % api_keys rows for uid_a, expected 2 (one per composite key add)', row_cnt;
  END IF;

  RAISE NOTICE 'Parts 1-2 OK: draft fenced per (user, session), api_key_id NULL, per-key add proceeds (ONB-03).';

  -- ======================================================================
  -- Part 3b — auth guard: auth.uid() mismatch RAISEs insufficient_privilege
  -- ======================================================================
  -- Present a DIFFERENT identity in the JWT than p_user_id. The fn's F6-style
  -- guard (auth.uid() <> p_user_id) must reject.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_wrong::text, 'role', 'authenticated')::text, true);
  raised := FALSE;
  BEGIN
    PERFORM public.add_wizard_composite_key(
      uid_a, 'binance', 'spoofed', 'e', 's', 'p', 'd', 'n', 1, 'spoof', session_a);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3b): add_wizard_composite_key accepted a call whose p_user_id <> auth.uid() — cross-user elevation (T-88-03)';
  END IF;

  -- ======================================================================
  -- Part 3c — Phase 156: the SINGLE-KEY twin of Part 3b
  -- ======================================================================
  -- ⭐ WHY THIS EXISTS. Part 3b has guarded add_wizard_composite_key's
  -- cross-user raise since it was written; create_wizard_strategy's IDENTICAL
  -- guard had NO behavioural test anywhere in supabase/tests. Phase 156
  -- restructures that guard on BOTH functions, so the untested one was about to
  -- be edited with no net under it. That is the one-path-only pattern Phase
  -- 153.6 was convened to end — here applied to the tests rather than the code.
  --
  -- ⛔ This asserts BEHAVIOUR, not text. Migration A's post-verify (e2) greps
  -- pg_get_functiondef for the comparison, but a post-verify only runs in the
  -- migration that carries it; it does not protect the function from the NEXT
  -- migration. This case runs in the sql-tests CI job on every PR forever.
  -- ⚠️ ELEVEN positional args against the 12-arg signature is LEGAL —
  -- p_venue_account_id defaults NULL, and Part 4a already calls it this way. Do
  -- not "fix" it into an arity mismatch; the 12-arg pin lives at
  -- test_api_keys_venue_identity_uniq.sql:41.
  SELECT count(*) INTO row_cnt_before FROM public.api_keys WHERE user_id = uid_c;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_wrong::text, 'role', 'authenticated')::text, true);
  raised := FALSE;
  BEGIN
    PERFORM public.create_wizard_strategy(
      uid_c, 'binance', 'spoofed single', 'e', 's', 'p', 'd', 'n', 1,
      'spoof single', session_spoof);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3c): create_wizard_strategy accepted a call whose p_user_id <> auth.uid() — cross-user elevation (T-88-03), the single-key twin of Part 3b';
  END IF;

  -- ⭐ "An error was raised" is the WEAKER claim. A body that raised AFTER the
  -- INSERT, or that raised from some later statement entirely, satisfies it
  -- while a row already exists. Assert the row delta is ZERO.
  SELECT count(*) INTO row_cnt FROM public.api_keys WHERE user_id = uid_c;
  IF row_cnt <> row_cnt_before THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3c): the REFUSED create_wizard_strategy call still minted % api_keys row(s) for uid_c — the raise landed after the write (T-88-03)', row_cnt - row_cnt_before;
  END IF;

  -- ======================================================================
  -- Part 3d — Phase 156: the service_role arm ACTUALLY WORKS
  -- ======================================================================
  -- ⛔ THE MOST LOAD-BEARING CASE IN THIS FILE, and the one whose absence is
  -- most dangerous. Migration A's post-verify (a) asserts service_role HOLDS
  -- EXECUTE — but `156-MEASUREMENTS.md` § A4 measured that it already did,
  -- inherited from pg_default_acl, so (a) reads TRUE on a database where the
  -- GRANT was never written AND where the in-body arm does not work at all.
  -- Nothing else invokes the function as service_role.
  --
  -- The follow-up migration DELETES the authenticated arm. If the service_role
  -- arm were broken, that migration would break EVERY connect-a-key with no
  -- test having failed. This case is the only thing standing between that and
  -- production.
  --
  -- No 'sub' claim is presented — deliberately. `156-MEASUREMENTS.md` § A2
  -- measured auth.uid() IS NULL for a real service-role client, so a test that
  -- supplied a sub would be testing a shape production never sends.
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);

  -- ⚠️ The refusal is caught and RE-RAISED with this file's own message. Without
  -- the catch, a body lacking the service_role arm raises its OWN
  -- "called without an auth session" (auth.uid() IS NULL under a service-role
  -- caller) and the gate reports the symptom instead of the cause.
  BEGIN
    SELECT strategy_id, api_key_id INTO v_strat_sr, v_key_sr
      FROM public.create_wizard_strategy(
        uid_d, 'binance', 'service-role single', 'enc', 'sec', 'pass', 'dek',
        'nonce', 1, 'SR draft D', session_d);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3d): create_wizard_strategy REFUSED a service_role caller (%) — the Phase 156 writer arm is absent or broken. The follow-up migration withdraws authenticated EXECUTE, so shipping this would break EVERY connect-a-key.', SQLERRM;
  END;

  IF v_strat_sr IS NULL OR v_key_sr IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3d): create_wizard_strategy returned NULL ids under a service_role caller — the Phase 156 writer arm does not work, and the follow-up migration would break every connect';
  END IF;

  -- The row is owned by p_user_id, which is the ONLY carrier of identity in
  -- this arm (auth.uid() is NULL here). If this ever reads NULL or someone
  -- else's id, the route-bound ownership contract is broken.
  SELECT user_id::text INTO err_msg FROM public.api_keys WHERE id = v_key_sr;
  IF err_msg IS DISTINCT FROM uid_d::text THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3d): the service-role-written api_keys row is owned by %, expected p_user_id % — ownership is route-bound and must be carried verbatim', err_msg, uid_d;
  END IF;

  -- The stamps must survive. They survive because the body runs as its OWNER
  -- (SECURITY DEFINER), NOT because the caller is service_role — if this ever
  -- reads NULL, the scrub trigger is seeing a non-owner writer.
  SELECT attested_venue INTO v_attested FROM public.api_keys WHERE id = v_key_sr;
  IF v_attested IS DISTINCT FROM 'binance' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3d): attested_venue is % under the service_role arm, expected binance — the SECDEF stamp did not survive the scrub trigger', COALESCE(v_attested, '<null>');
  END IF;

  -- The composite twin must accept the same caller. One contract, two entry
  -- points — 153.6 exists because a change landed on only one of them.
  SELECT strategy_id, api_key_id INTO v_strat_sr, v_key_sr
    FROM public.add_wizard_composite_key(
      uid_d, 'bybit', 'service-role composite', 'enc', 'sec', 'pass', 'dek',
      'nonce', 1, 'SR composite D', session_d2);
  IF v_strat_sr IS NULL OR v_key_sr IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3d): add_wizard_composite_key returned NULL ids under a service_role caller — the writer arm landed on only ONE of the two RPCs';
  END IF;

  -- ======================================================================
  -- Part 3e — Phase 156: every OTHER role is REFUSED (the ELSE arm)
  -- ======================================================================
  -- The gate has three outcomes and the third had no test. A gate that admits
  -- everything it does not recognise is not a gate.
  --
  -- (i) A recognised-but-unprivileged role.
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', 'authenticator')::text, true);
  raised := FALSE;
  BEGIN
    PERFORM public.create_wizard_strategy(
      uid_d, 'binance', 'authenticator', 'e', 's', 'p', 'd', 'n', 1,
      'authenticator', session_spoof);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3e-i): create_wizard_strategy accepted a caller whose role is neither authenticated nor service_role — the ELSE arm does not refuse';
  END IF;

  -- (ii) NO claims at all — a direct libpq caller (pg_cron, the Python worker).
  -- auth.role() returns NULL, which matches neither arm and MUST fall to ELSE.
  -- ⭐ This is the fail-CLOSED property. If the gate ever defaulted a NULL role
  -- to "proceed", every unauthenticated database connection would become a
  -- wizard writer.
  PERFORM set_config('request.jwt.claims', NULL, true);
  raised := FALSE;
  BEGIN
    PERFORM public.add_wizard_composite_key(
      uid_d, 'binance', 'no claims', 'e', 's', 'p', 'd', 'n', 1,
      'no claims', session_spoof);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3e-ii): add_wizard_composite_key accepted a caller presenting NO jwt claims — the gate does not fail closed';
  END IF;

  RAISE NOTICE 'Parts 3c-3e OK (156): single-key cross-user guard fires, the service_role writer arm works on BOTH RPCs with stamps intact, and every other role is refused.';

  -- ======================================================================
  -- Part 4 — single-key regression: create_wizard_strategy UNCHANGED
  -- ======================================================================
  -- The single-key F6 path must still (a) set strategies.api_key_id and (b)
  -- fence per (user, session). This is the SC-4 behavioral canary — the
  -- composite migration must not have altered create_wizard_strategy.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_c::text, 'role', 'authenticated')::text, true);

  SELECT strategy_id, api_key_id INTO v_strat_sk1, v_key_sk1
    FROM public.create_wizard_strategy(
      uid_c, 'binance', 'single key', 'enc', 'sec', 'pass', 'dek', 'nonce', 1,
      'Single draft C', session_c);

  IF v_key_sk1 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4a): create_wizard_strategy returned a NULL api_key_id — single-key path broken';
  END IF;
  SELECT api_key_id INTO v_api_key FROM public.strategies WHERE id = v_strat_sk1;
  IF v_api_key IS NULL OR v_api_key <> v_key_sk1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4a): the single-key strategies.api_key_id is not set to the created key (% vs %) — SC-4 broken', v_api_key, v_key_sk1;
  END IF;

  -- Re-call same (user, session): the F6 fence must replay the SAME draft.
  SELECT strategy_id, api_key_id INTO v_strat_sk2, v_key_sk2
    FROM public.create_wizard_strategy(
      uid_c, 'binance', 'single key retry', 'enc', 'sec', 'pass', 'dek', 'nonce', 1,
      'Single draft C', session_c);
  IF v_strat_sk2 <> v_strat_sk1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4b): create_wizard_strategy no longer fences per (user, session) (% vs %) — F6 idempotency regressed', v_strat_sk1, v_strat_sk2;
  END IF;
  SELECT count(*) INTO row_cnt
    FROM public.strategies
   WHERE user_id = uid_c AND wizard_session_id = session_c;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4b): % single-key strategies rows for (uid_c, session_c), expected exactly 1 — F6 fence regressed', row_cnt;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'test_wizard_composite_fence: ALL PASS (composite draft fenced, per-key add proceeds, auth guard, single-key path unchanged).';
END
$$;

ROLLBACK;
