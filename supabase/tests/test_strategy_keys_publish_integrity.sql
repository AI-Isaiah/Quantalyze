-- Test for migration 20260710160000_api_keys_published_composite_delete_guard.sql
-- — the M-3 publish-integrity BEFORE DELETE guard on api_keys. Phase 87 (PUB-01).
--
-- Root cause it guards: strategy_keys.api_key_id ... ON DELETE CASCADE
-- (20260710120000_strategy_keys.sql:33) means deleting an api_keys row SILENTLY
-- shrinks a PUBLISHED composite's membership — no tombstone, no analytics
-- invalidation, no audit. A published composite could be holed by any api_key
-- delete caller (route, RPC, service-role job, account deletion) below RLS
-- (BYPASSRLS skips RLS, NOT triggers). The guard RAISEs fail-loud when the key
-- is a strategy_keys member of a strategy with status='published'.
--
-- This test drives REAL `DELETE FROM public.api_keys` statements (event-driven —
-- it NEVER calls the trigger function directly; seeding rows and invoking the
-- function in isolation is a vacuum that stays green while production holes the
-- composite). Four parts:
--   * Part 1 — structural: the BEFORE DELETE ROW trigger exists on public.api_keys,
--     its function is SECURITY DEFINER with a baked search_path and the published
--     scope, and EXECUTE is not reachable by anon/authenticated. RED pre-migration.
--   * Part 2 — published-member delete BLOCKED: the DELETE RAISEs; the caught
--     message contains the 'published composite' arm AND does NOT leak the seeded
--     owner id (least-disclosure, ADR-0020); the api_keys row survives the abort.
--   * Part 3 — draft-member delete ALLOWED: an identical chain with status='draft'
--     — the DELETE succeeds and the strategy_keys member cascades away (the guard
--     is published-scoped; the Phase 88 wizard iterate-delete-retry loop is intact).
--   * Part 4 — SC-4 single-key delete ALLOWED: a PUBLISHED single-key strategy
--     linked via strategies.api_key_id ONLY (NO strategy_keys row) — the DELETE
--     succeeds and strategies.api_key_id is SET NULL by the existing FK. Proves the
--     guard never fires for single-key strategies even when published.
--   * Part 5 — GDPR sanitize exemption: sanitize_user DELETEs api_keys BEFORE it
--     archives strategies, so it deletes a member of a still-published composite.
--     With `quantalyze.sanitize_in_progress = 'on'` (the transaction-local session
--     var sanitize_user sets, exactly as reject_sentinel_writes reads it) the
--     published-member DELETE SUCCEEDS (account deletion is not aborted). The same
--     block then flips the flag off and re-deletes another published member →
--     the guard RAISEs again, proving the exemption is scoped to the flag (not a
--     blanket published-composite hole). Regression-locks the FK-violation bug the
--     RLS + migration reviewers flagged.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands. Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. Filename matches the
-- `test_*.sql` glob so the job auto-discovers it (with migration 20260710160000
-- applied). Pre-migration (RED): Part 1 fails (no trigger) and ON_ERROR_STOP
-- aborts there.
--
-- Hygiene: the integration parts run inside an explicit transaction that ends in
-- ROLLBACK, so the shared test DB is never polluted. All ids are gen_random_uuid()
-- and every auth.users email is derived from a fresh uuid, so a concurrent CI run
-- against the shared test project cannot collide and no defensive pre-clean is
-- needed. NOTE: the seed deliberately avoids allocator_holdings (its api_key_id FK
-- is ON DELETE RESTRICT, 20260420073003_allocator_holdings.sql:95 — seeding it
-- would block the delete for a reason unrelated to the guard under test).
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_strategy_keys_publish_integrity.sql

-- ==========================================================================
-- Part 1 — structural: the guard trigger + its SECDEF function are present and
-- hardened. Zero side effects; fails on any revert (RED pre-migration).
-- ==========================================================================
DO $$
DECLARE
  v_oid      OID;
  v_secdef   BOOLEAN;
  v_fn       TEXT;
  v_tgtype   INT2;
BEGIN
  -- (a) the BEFORE DELETE guard trigger exists on public.api_keys (non-internal).
  SELECT tgtype INTO v_tgtype
    FROM pg_trigger
   WHERE tgrelid = 'public.api_keys'::regclass
     AND NOT tgisinternal
     AND tgname = 'api_keys_published_composite_delete_guard';
  IF v_tgtype IS NULL THEN
    RAISE EXCEPTION 'publish-integrity: BEFORE DELETE guard trigger missing on public.api_keys';
  END IF;
  -- tgtype bits (Postgres catalog): ROW=1, BEFORE=2, DELETE=8. Must be all three
  -- (a BEFORE UPDATE or an AFTER trigger would not close M-3).
  IF (v_tgtype & 1) = 0 THEN
    RAISE EXCEPTION 'publish-integrity: guard trigger is not FOR EACH ROW';
  END IF;
  IF (v_tgtype & 2) = 0 THEN
    RAISE EXCEPTION 'publish-integrity: guard trigger is not BEFORE (an AFTER trigger cannot veto the delete)';
  END IF;
  IF (v_tgtype & 8) = 0 THEN
    RAISE EXCEPTION 'publish-integrity: guard trigger does not fire on DELETE';
  END IF;

  -- (b) the trigger function is SECURITY DEFINER with a baked search_path.
  SELECT p.oid, p.prosecdef, pg_get_functiondef(p.oid)
    INTO v_oid, v_secdef, v_fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'enforce_api_keys_published_composite_integrity';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'publish-integrity: guard function enforce_api_keys_published_composite_integrity missing';
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'publish-integrity: guard function is not SECURITY DEFINER';
  END IF;
  IF v_fn !~* 'search_path' THEN
    RAISE EXCEPTION 'publish-integrity: guard function has no baked SET search_path';
  END IF;

  -- (c) the guard is scoped to published composites (a draft/archived member must
  -- never be blocked). The body must reference status = 'published'.
  IF v_fn !~* 'status\s*=\s*''published''' THEN
    RAISE EXCEPTION 'publish-integrity: guard body is not scoped to status = published';
  END IF;

  -- (d) least-privilege: EXECUTE is not reachable by the API roles (REVOKE ...
  -- FROM PUBLIC, anon, authenticated — clears the SECDEF-executable advisor).
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'publish-integrity: anon can EXECUTE the guard function (REVOKE missing)';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'publish-integrity: authenticated can EXECUTE the guard function (REVOKE missing)';
  END IF;

  RAISE NOTICE 'Part 1 OK: BEFORE DELETE ROW guard present, SECDEF + baked search_path + published scope, EXECUTE revoked from anon/authenticated.';
END $$;

-- ==========================================================================
-- Parts 2-4 — integration: real DELETE FROM public.api_keys drives the trigger.
-- Isolated in a transaction that always rolls back; all ids gen_random_uuid().
-- ==========================================================================
BEGIN;

DO $$
DECLARE
  uid_pub     UUID := gen_random_uuid();
  uid_draft   UUID := gen_random_uuid();
  uid_single  UUID := gen_random_uuid();
  key_pub     UUID;
  key_draft   UUID;
  key_single  UUID;
  strat_pub   UUID;
  strat_draft UUID;
  strat_single UUID;
  row_cnt     INTEGER;
  raised      BOOLEAN;
  err_msg     TEXT;
  linked_key  UUID;
BEGIN
  -- ----- SEED: three independent tenants (seeding/service-role context —
  -- bypasses RLS, fires the owner-coherence + delete-guard triggers) -----------

  -- Tenant PUB: a PUBLISHED composite with one member key.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_pub, '00000000-0000-0000-0000-000000000000',
          'test-pub-integ-' || uid_pub || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_pub, 'pub-integ published', 'test-pub-integ-' || uid_pub || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_pub, 'binance', 'pub-integ published key', 'x') RETURNING id INTO key_pub;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_pub, 'pub-integ published composite', 'published', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_pub;
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
  VALUES (strat_pub, key_pub, uid_pub, '2025-08-01', NULL, 0);

  -- Tenant DRAFT: a DRAFT composite with one member key.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_draft, '00000000-0000-0000-0000-000000000000',
          'test-pub-integ-' || uid_draft || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_draft, 'pub-integ draft', 'test-pub-integ-' || uid_draft || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_draft, 'binance', 'pub-integ draft key', 'x') RETURNING id INTO key_draft;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_draft, 'pub-integ draft composite', 'draft', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_draft;
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
  VALUES (strat_draft, key_draft, uid_draft, '2025-08-01', NULL, 0);

  -- Tenant SINGLE: a PUBLISHED SINGLE-KEY strategy linked via strategies.api_key_id
  -- ONLY (SC-4 — NO strategy_keys row). Deliberately NO allocator_holdings (its FK
  -- is ON DELETE RESTRICT and would block the delete unrelated to the guard).
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_single, '00000000-0000-0000-0000-000000000000',
          'test-pub-integ-' || uid_single || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_single, 'pub-integ single', 'test-pub-integ-' || uid_single || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_single, 'binance', 'pub-integ single key', 'x') RETURNING id INTO key_single;
  INSERT INTO strategies (user_id, name, status, api_key_id, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_single, 'pub-integ published single-key', 'published', key_single, '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_single;

  RAISE NOTICE 'Seed OK: PUB key=% strat=%, DRAFT key=% strat=%, SINGLE key=% strat=%',
    key_pub, strat_pub, key_draft, strat_draft, key_single, strat_single;

  -- ----- Part 2: published-member delete BLOCKED (fail-loud) -----------------
  -- A REAL DELETE FROM public.api_keys (event-driven). Pre-migration the ON DELETE
  -- CASCADE would silently remove the strategy_keys member and the api_key with no
  -- exception → raised stays FALSE → this arm reddens.
  raised := FALSE;
  BEGIN
    DELETE FROM public.api_keys WHERE id = key_pub;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2): deleting a PUBLISHED composite member key was ACCEPTED — the composite was silently holed (guard missing)';
  END IF;
  -- Correct arm: the message must name the published-composite guard.
  IF err_msg NOT LIKE '%published composite%' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2): delete raised the WRONG error (expected the published-composite guard, got: %)', err_msg;
  END IF;
  -- Least-disclosure (ADR-0020): the message must NOT echo the owner id — a SECDEF
  -- guard reading past RLS must not become a per-tenant ownership/existence oracle.
  IF err_msg LIKE '%' || uid_pub::text || '%' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2): guard error leaked the owner id — least-disclosure violated';
  END IF;
  -- The delete must have been ABORTED — the api_keys row (and its member) survive.
  SELECT count(*) INTO row_cnt FROM public.api_keys WHERE id = key_pub;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2): the api_keys row did not survive the aborted delete (count=%)', row_cnt;
  END IF;
  SELECT count(*) INTO row_cnt FROM public.strategy_keys WHERE api_key_id = key_pub;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2): the published composite member was removed despite the abort (count=%)', row_cnt;
  END IF;

  -- ----- Part 3: draft-member delete ALLOWED (published-scoped guard) ---------
  -- Identical chain, status='draft'. The DELETE succeeds; the member cascades away.
  raised := FALSE;
  BEGIN
    DELETE FROM public.api_keys WHERE id = key_draft;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3): deleting a DRAFT composite member key was BLOCKED — guard is not published-scoped (got: %)', err_msg;
  END IF;
  SELECT count(*) INTO row_cnt FROM public.api_keys WHERE id = key_draft;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3): the draft-member api_keys row was not deleted (count=%)', row_cnt;
  END IF;
  SELECT count(*) INTO row_cnt FROM public.strategy_keys WHERE api_key_id = key_draft;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3): the draft composite member did not cascade away (count=%)', row_cnt;
  END IF;

  -- ----- Part 4: SC-4 single-key delete ALLOWED (strategies.api_key_id link) --
  -- A PUBLISHED single-key strategy links via strategies.api_key_id ONLY (no
  -- strategy_keys row), so the guard's EXISTS never matches. The DELETE succeeds
  -- and the existing ON DELETE SET NULL FK nulls strategies.api_key_id.
  raised := FALSE;
  BEGIN
    DELETE FROM public.api_keys WHERE id = key_single;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4): deleting a PUBLISHED single-key strategy''s key was BLOCKED — the guard fired for a non-strategy_keys link (SC-4 broken, got: %)', err_msg;
  END IF;
  SELECT count(*) INTO row_cnt FROM public.api_keys WHERE id = key_single;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4): the single-key api_keys row was not deleted (count=%)', row_cnt;
  END IF;
  SELECT api_key_id INTO linked_key FROM public.strategies WHERE id = strat_single;
  IF linked_key IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4): strategies.api_key_id was not SET NULL after the single-key delete (still %)', linked_key;
  END IF;

  RAISE NOTICE 'test_strategy_keys_publish_integrity: ALL PASS (published member blocked, draft member allowed, single-key SET NULL preserved).';
END
$$;

ROLLBACK;

-- ==========================================================================
-- Part 5 — GDPR sanitize exemption: a published-composite member delete is
-- ALLOWED when quantalyze.sanitize_in_progress = 'on' (sanitize_user's path),
-- and STILL BLOCKED once the flag is off. Isolated txn, always rolls back.
-- ==========================================================================
BEGIN;

DO $$
DECLARE
  uid_san     UUID := gen_random_uuid();
  uid_san2    UUID := gen_random_uuid();
  key_san     UUID;
  key_san2    UUID;
  strat_san   UUID;
  strat_san2  UUID;
  row_cnt     INTEGER;
  raised      BOOLEAN;
  err_msg     TEXT;
BEGIN
  -- ----- SEED: two PUBLISHED composites, each with one member key -------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_san, '00000000-0000-0000-0000-000000000000',
          'test-pub-san-' || uid_san || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_san, 'pub-san sanitize', 'test-pub-san-' || uid_san || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_san, 'binance', 'pub-san sanitize key', 'x') RETURNING id INTO key_san;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_san, 'pub-san published composite', 'published', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_san;
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
  VALUES (strat_san, key_san, uid_san, '2025-08-01', NULL, 0);

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_san2, '00000000-0000-0000-0000-000000000000',
          'test-pub-san-' || uid_san2 || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_san2, 'pub-san flag-off', 'test-pub-san-' || uid_san2 || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_san2, 'binance', 'pub-san flag-off key', 'x') RETURNING id INTO key_san2;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_san2, 'pub-san flag-off composite', 'published', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_san2;
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
  VALUES (strat_san2, key_san2, uid_san2, '2025-08-01', NULL, 0);

  -- ----- Part 5a: sanitize path ALLOWED --------------------------------------
  -- Signal the sanitize path exactly as sanitize_user does (SET LOCAL, txn-local).
  PERFORM set_config('quantalyze.sanitize_in_progress', 'on', true);
  raised := FALSE;
  BEGIN
    DELETE FROM public.api_keys WHERE id = key_san;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 5a): deleting a PUBLISHED composite member during sanitize was BLOCKED — GDPR account deletion would abort (got: %)', err_msg;
  END IF;
  SELECT count(*) INTO row_cnt FROM public.api_keys WHERE id = key_san;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 5a): the sanitize-path api_keys row was not deleted (count=%)', row_cnt;
  END IF;

  -- ----- Part 5b: flag off → STILL BLOCKED (exemption is flag-scoped) ---------
  -- Reset the session var; the identical published-member delete must RAISE
  -- again, proving Part 5a's success came from the flag, not a blanket hole.
  PERFORM set_config('quantalyze.sanitize_in_progress', 'off', true);
  raised := FALSE;
  BEGIN
    DELETE FROM public.api_keys WHERE id = key_san2;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 5b): published-member delete was ACCEPTED with the sanitize flag OFF — the exemption is a blanket hole, not flag-scoped';
  END IF;
  IF err_msg NOT LIKE '%published composite%' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 5b): delete raised the WRONG error (expected the published-composite guard, got: %)', err_msg;
  END IF;
  SELECT count(*) INTO row_cnt FROM public.api_keys WHERE id = key_san2;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 5b): the api_keys row did not survive the aborted flag-off delete (count=%)', row_cnt;
  END IF;

  RAISE NOTICE 'Part 5 OK: sanitize-flag delete allowed (GDPR account deletion intact), flag-off delete still blocked (exemption is flag-scoped).';
END
$$;

ROLLBACK;
