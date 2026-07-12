-- Test: CLEAN-02 orphaned-api_key sweep — five safety cases + pre-cascade capture
-- + sanitize-unaffected. Phase 96 (draft-key-hygiene-onboarding-polish), Wave-0.
--
-- ⚠️ DATA-DELETION DANGER ZONE. CLEAN-02 has the sweep RPC DELETE `api_keys` rows,
--    and the migration that ships it auto-applies to PROD on the milestone merge. A
--    too-broad predicate silently destroys a live allocator's or a published
--    composite's key. This file is the RED repro-gate: each safety case FAILS
--    without the correct predicate, so a careless sweep cannot land green.
--
-- WHAT THIS FILE PINS
--   Structural (the sweep predicate must count BOTH ref axes + exclude RESTRICT):
--     - body has all three reference checks — NOT EXISTS strategies (single-key
--       `strategies.api_key_id`), NOT EXISTS strategy_keys (composite membership),
--       NOT EXISTS allocator_holdings (the ON DELETE RESTRICT abort-guard);
--     - body does NOT set `sanitize_in_progress` (GDPR account-deletion unaffected);
--     - body does NOT reuse `delete_api_key_if_unreferenced` (that RPC checks only
--       `strategies` and is INCOMPLETE for composites — 96-VALIDATION decision 4);
--     - the GDPR/guard exemptions are intact: `enforce_api_keys_published_composite_
--       integrity` still carries its `sanitize_in_progress` exemption.
--   Behavioral (ALL five cases seeded together, ONE sweep call — this simultaneously
--   proves no 23503 statement-abort):
--     A. orphan key on a doomed 8d draft, no other refs                → SWEPT
--     B. key on a doomed composite draft that is ALSO a strategy_keys
--        member of a SURVIVING strategy                                → SPARED
--     C. key on a doomed draft that is ALSO a member of a status=
--        'published' composite (guard-protected superset)             → SPARED
--     D. key on a doomed draft that is ALSO strategies.api_key_id of a
--        surviving published single-key strategy                       → SPARED
--     E. key on a doomed draft ALSO referenced by allocator_holdings
--        (ON DELETE RESTRICT)                                          → SPARED,
--        and Case A is STILL swept in the same call (no statement abort).
--     F. pre-cascade capture: a member key of a doomed composite with NO surviving
--        refs → SWEPT. Only passes if member ids are captured BEFORE the draft-delete
--        CASCADE destroys the strategy_keys rows (96-VALIDATION decision 3).
--   Behavioral, sanitize-unaffected (MANDATORY — plan-checker Warning-3): a normal
--   `sanitize_user` run STILL deletes the user's api_keys. The sanitize path is
--   historically critical — a stray guard here would abort GDPR account deletion.
--
-- RED-UNTIL-96-02: `cleanup_abandoned_wizard_drafts` does not exist yet (lands in
--    migration 20260713120000, Phase 96 Plan 02). Part 1's first assertion RAISEs
--    'cleanup_abandoned_wizard_drafts ... missing' and, under `psql -v
--    ON_ERROR_STOP=1`, aborts the run there. Intended repro-gate: FAILS without the
--    96-02 change. 96-02 turns it GREEN.
--
-- Note on the sweep call: the RPC's return SHAPE is not locked (it is authored in
--    96-02 to satisfy these tests). We therefore call it with `PERFORM` and assert
--    every outcome via table state — Case A/F keys GONE is the observable proof a key
--    was swept — rather than coupling to an unspecified `swept_keys` return column.
--
-- CONVENTIONS (models: test_api_key_delete_atomicity.sql, test_strategy_keys_
--    publish_integrity.sql, test_sanitize_user_hardening.sql): pgTAP is not installed
--    (CLAUDE.md / Lane B) — assertions RAISE EXCEPTION on failure; a clean run prints
--    NOTICEs only. NO psql backslash meta-commands. Wrapped in BEGIN/ROLLBACK; all
--    ids gen_random_uuid(); every assertion targets seeded ids ONLY. Run order:
--    AFTER migration 20260713120000.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_cleanup_orphaned_api_keys_sweep.sql

BEGIN;

-- ==========================================================================
-- Part 1 — structural: sweep predicate covers both ref axes + RESTRICT guard,
-- does not touch the sanitize GUC / the incomplete RPC, exemptions intact.
-- (RED lever: the missing-RPC assertion below runs first.)
-- ==========================================================================
DO $$
DECLARE
  v_src   text;
  v_san   text;
  v_guard text;
BEGIN
  -- (a) RED lever — the sweep RPC must exist.
  SELECT prosrc INTO v_src
    FROM pg_proc WHERE proname = 'cleanup_abandoned_wizard_drafts';
  IF v_src IS NULL THEN
    RAISE EXCEPTION
      'CLEAN-02: cleanup_abandoned_wizard_drafts() missing — apply migration 20260713120000 (RED until Phase 96 Plan 02)';
  END IF;

  -- (b) all three reference checks present.
  IF v_src NOT LIKE '%NOT EXISTS%' THEN
    RAISE EXCEPTION 'CLEAN-02: sweep predicate is not expressed as NOT EXISTS reference checks';
  END IF;
  IF v_src NOT LIKE '%strategies%' THEN
    RAISE EXCEPTION 'CLEAN-02: sweep does not check strategies.api_key_id (single-key link)';
  END IF;
  IF v_src NOT LIKE '%strategy_keys%' THEN
    RAISE EXCEPTION 'CLEAN-02: sweep does not check strategy_keys membership (composite drafts have NULL strategies.api_key_id — 96-VALIDATION decision 4)';
  END IF;
  IF v_src NOT LIKE '%allocator_holdings%' THEN
    RAISE EXCEPTION 'CLEAN-02: sweep does not exclude allocator_holdings keys — a set DELETE would abort 23503 on the ON DELETE RESTRICT FK';
  END IF;

  -- (c) must NOT reuse the INCOMPLETE delete_api_key_if_unreferenced RPC (it checks
  --     only strategies, missing the strategy_keys axis — 96-VALIDATION decision 4).
  IF v_src LIKE '%delete_api_key_if_unreferenced%' THEN
    RAISE EXCEPTION 'CLEAN-02: sweep reuses delete_api_key_if_unreferenced — that RPC is composite-blind (INCOMPLETE); the sweep must check strategy_keys itself';
  END IF;

  -- (d) must NOT set the sanitize GUC (GDPR account-deletion path unaffected).
  IF v_src LIKE '%sanitize_in_progress%' THEN
    RAISE EXCEPTION 'CLEAN-02: sweep sets/reads sanitize_in_progress — it must not touch the GDPR sanitize GUC';
  END IF;

  -- (e) exemption intact: the published-composite delete guard still exempts the
  --     sanitize GUC (a new guard that aborted sanitize is exactly the failure mode
  --     the reference note warns about).
  SELECT prosrc INTO v_guard
    FROM pg_proc WHERE proname = 'enforce_api_keys_published_composite_integrity';
  IF v_guard IS NULL THEN
    RAISE EXCEPTION 'CLEAN-02: enforce_api_keys_published_composite_integrity missing (published-composite guard gone)';
  END IF;
  IF v_guard NOT LIKE '%sanitize_in_progress%' THEN
    RAISE EXCEPTION 'CLEAN-02: published-composite guard lost its sanitize_in_progress exemption — GDPR account deletion would abort';
  END IF;

  -- (f) sanitize_user still carries its own sanitize GUC set_config. Tolerant NOTICE
  --     rather than a hard fail: the shared test project may lag prod on the
  --     sanitize_user re-sync (documented in test_sanitize_user_hardening.sql), and
  --     the MANDATORY behavioral proof lives in Part 3 below.
  SELECT prosrc INTO v_san FROM pg_proc WHERE proname = 'sanitize_user';
  IF v_san IS NULL THEN
    RAISE EXCEPTION 'CLEAN-02: sanitize_user missing — cannot reason about the GDPR account-deletion path';
  END IF;
  IF v_san NOT LIKE '%sanitize_in_progress%' THEN
    RAISE NOTICE 'CLEAN-02 NOTE: sanitize_user body does not reference sanitize_in_progress (test DB may pre-date the GUC re-sync); Part 3 behaviorally proves account deletion still deletes keys.';
  END IF;

  RAISE NOTICE 'CLEAN-02 Part 1 OK: sweep checks strategies + strategy_keys + allocator_holdings, no sanitize GUC, no incomplete-RPC reuse; published-composite guard exemption intact.';
END $$;

-- ==========================================================================
-- Part 2 — five safety cases + pre-cascade capture, ONE sweep call.
-- ==========================================================================
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  -- keys
  v_key_a  uuid := gen_random_uuid();  -- orphan → SWEPT
  v_key_b  uuid := gen_random_uuid();  -- also member of a surviving strategy → SPARED
  v_key_c  uuid := gen_random_uuid();  -- also member of a published composite → SPARED
  v_key_d  uuid := gen_random_uuid();  -- also single-key of a surviving strategy → SPARED
  v_key_e  uuid := gen_random_uuid();  -- also referenced by allocator_holdings → SPARED
  v_key_f  uuid := gen_random_uuid();  -- composite member, no other refs → SWEPT (capture)
  -- doomed 8d wizard drafts
  v_da     uuid := gen_random_uuid();
  v_db     uuid := gen_random_uuid();
  v_dc     uuid := gen_random_uuid();
  v_dd     uuid := gen_random_uuid();
  v_de     uuid := gen_random_uuid();
  v_df     uuid := gen_random_uuid();
  -- surviving (non-doomed) strategies
  v_sb     uuid := gen_random_uuid();  -- surviving composite for key_b
  v_sc     uuid := gen_random_uuid();  -- published composite for key_c
  v_sd     uuid := gen_random_uuid();  -- published single-key for key_d
  v_cnt    integer;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'clean02-' || v_user || '@quantalyze.test', now(), now());
  INSERT INTO public.profiles (id, display_name, email, role)
  VALUES (v_user, 'clean02 sweep', 'clean02-' || v_user || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted) VALUES
    (v_key_a, v_user, 'binance', 'clean02-a', 'x'),
    (v_key_b, v_user, 'binance', 'clean02-b', 'x'),
    (v_key_c, v_user, 'binance', 'clean02-c', 'x'),
    (v_key_d, v_user, 'binance', 'clean02-d', 'x'),
    (v_key_e, v_user, 'binance', 'clean02-e', 'x'),
    (v_key_f, v_user, 'binance', 'clean02-f', 'x');

  -- ---- doomed 8-day wizard drafts (source=wizard, status=draft, review_note NULL) --
  -- A: single-key doomed draft linking key_a.
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES (v_da, v_user, v_key_a, 'clean02 A', 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days');
  -- B, C, F: composite doomed drafts (api_key_id NULL, membership via strategy_keys).
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES
    (v_db, v_user, NULL, 'clean02 B', 'draft', 'wizard', '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days'),
    (v_dc, v_user, NULL, 'clean02 C', 'draft', 'wizard', '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days'),
    (v_df, v_user, NULL, 'clean02 F', 'draft', 'wizard', '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days');
  -- D: single-key doomed draft linking key_d (also linked by a survivor below).
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES (v_dd, v_user, v_key_d, 'clean02 D', 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days');
  -- E: single-key doomed draft linking key_e (also in allocator_holdings below).
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES (v_de, v_user, v_key_e, 'clean02 E', 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days');

  INSERT INTO public.strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq) VALUES
    (v_db, v_key_b, v_user, DATE '2025-08-01', 0),
    (v_dc, v_key_c, v_user, DATE '2025-08-01', 0),
    (v_df, v_key_f, v_user, DATE '2025-08-01', 0);

  -- ---- surviving (non-doomed) strategies that keep B/C/D referenced ----------------
  -- B survivor: a published composite that also carries key_b.
  INSERT INTO public.strategies (id, user_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges)
  VALUES (v_sb, v_user, 'clean02 B survivor', 'published', 'wizard',
    '{}', '{}', '{}', ARRAY['binance']);
  INSERT INTO public.strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (v_sb, v_key_b, v_user, DATE '2025-08-01', 0);
  -- C survivor: a published composite that also carries key_c (guard-protected set).
  INSERT INTO public.strategies (id, user_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges)
  VALUES (v_sc, v_user, 'clean02 C survivor', 'published', 'wizard',
    '{}', '{}', '{}', ARRAY['binance']);
  INSERT INTO public.strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (v_sc, v_key_c, v_user, DATE '2025-08-01', 0);
  -- D survivor: a published single-key strategy linking key_d via strategies.api_key_id.
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges)
  VALUES (v_sd, v_user, v_key_d, 'clean02 D survivor', 'published', 'wizard',
    '{}', '{}', '{}', ARRAY['binance']);

  -- E: allocator_holdings row referencing key_e (ON DELETE RESTRICT). All NOT NULL
  -- columns satisfied; allocator_id = the key's user_id (owner-coherence trigger).
  INSERT INTO public.allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side,
    quantity, value_usd, mark_price)
  VALUES (v_user, v_key_e, 'binance', 'BTCUSDT', DATE '2026-01-01', 'derivative', 'long',
    1, 50000, 50000);

  -- ---- ONE sweep call: deletes the doomed drafts + sweeps their orphaned keys -----
  PERFORM public.cleanup_abandoned_wizard_drafts();

  -- All six doomed drafts must be gone (CLEAN-01 arm ran).
  SELECT count(*) INTO v_cnt FROM public.strategies
    WHERE id IN (v_da, v_db, v_dc, v_dd, v_de, v_df);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'CLEAN-02 Part 2: not all doomed drafts were swept (remaining=%)', v_cnt;
  END IF;

  -- Case A: orphan → SWEPT.
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key_a;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'CLEAN-02 Case A: orphan key was NOT swept (count=%)', v_cnt;
  END IF;

  -- Case B: still a member of a surviving strategy → SPARED.
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key_b;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'CLEAN-02 Case B: key of a surviving composite member was swept (count=%)', v_cnt;
  END IF;

  -- Case C: member of a published composite → SPARED.
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key_c;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'CLEAN-02 Case C: published-composite member key was swept (guard superset breached, count=%)', v_cnt;
  END IF;

  -- Case D: single-key of a surviving published strategy → SPARED.
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key_d;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'CLEAN-02 Case D: key still linked via strategies.api_key_id was swept (count=%)', v_cnt;
  END IF;

  -- Case E: referenced by allocator_holdings (RESTRICT) → SPARED, no 23503 abort.
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key_e;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'CLEAN-02 Case E: allocator_holdings-referenced key was swept (count=%)', v_cnt;
  END IF;

  -- Case F: composite member with no surviving refs → SWEPT (proves pre-cascade
  -- capture — key_f is reachable ONLY if member ids were captured before the
  -- draft-delete CASCADE removed the strategy_keys row).
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key_f;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'CLEAN-02 Case F: doomed-composite member with no surviving refs was NOT swept — pre-cascade capture missing (count=%)', v_cnt;
  END IF;

  RAISE NOTICE 'CLEAN-02 Part 2 OK: A/F swept, B/C/D/E spared, no 23503 abort, pre-cascade capture proven.';
END $$;

-- ==========================================================================
-- Part 3 — sanitize-unaffected (MANDATORY, plan-checker Warning-3): a normal
-- sanitize_user run STILL deletes the user's api_keys (GDPR account deletion is
-- not blocked by the CLEAN-02 sweep machinery).
-- ==========================================================================
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_key   uuid := gen_random_uuid();
  v_cnt   integer;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'clean02-san-' || v_user || '@quantalyze.test', now(), now());
  INSERT INTO public.profiles (id, display_name, email, role)
  VALUES (v_user, 'clean02 sanitize', 'clean02-san-' || v_user || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
  VALUES (v_key, v_user, 'binance', 'clean02-san', 'x');

  -- The account-deletion path deletes api_keys before archiving strategies. If a
  -- CLEAN-02 change had (wrongly) added a blocking guard without the sanitize
  -- exemption, this DELETE would abort — the assertion below would catch it.
  PERFORM public.sanitize_user(v_user);

  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'CLEAN-02 Part 3: sanitize_user did NOT delete the user''s api_key — account deletion regressed (count=%)', v_cnt;
  END IF;

  RAISE NOTICE 'CLEAN-02 Part 3 OK: sanitize_user still deletes api_keys (GDPR account deletion unaffected by the sweep).';
END $$;

ROLLBACK;
