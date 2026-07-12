-- Test: CLEAN-01 abandoned-wizard-draft cleanup race semantics + structural pins.
-- Phase 96 (draft-key-hygiene-onboarding-polish), Wave-0 safety net.
--
-- WHAT THIS FILE PINS
--   1. Structural: the (not-yet-existing) SECURITY DEFINER RPC
--      `cleanup_abandoned_wizard_drafts` deletes ONLY abandoned wizard drafts —
--      its body scopes to source='wizard', status='draft', review_note IS NULL and
--      a **7-day** `created_at` window, does NOT reference the sanitize GUC, bakes a
--      search_path, and is EXECUTE-able by service_role only (anon/authenticated
--      denied).
--   2. Structural (T-96-01): `finalize_wizard_strategy` is a committed guarded
--      UPDATE — its body still contains `FOR UPDATE` and a `<> 'draft'` guard. This
--      pins the OTHER half of the EPQ race proof so a future finalize rewrite that
--      turned the promotion into a delete+insert (breaking OQ3) reddens THIS file.
--   3. Behavioral, finalize-first ordering: a promoted (pending_review) draft is
--      SPARED by the sweep and its api_key survives.
--   4. Behavioral, cron-first ordering: the sweep deletes the stale draft + cascades
--      its strategy_keys members, and a subsequent real finalize of that id fails
--      LOUD with SQLSTATE P0002 (no_data_found / GATE_DRAFT_GONE) — clean, no torn
--      state.
--   5. Window pins: an 8-day-old draft WITH a review_note is SPARED (M-0255), and a
--      1-day-old draft is SPARED (proves the 7d window, NOT 24h).
--
-- ⚠️ LOCKED REQUIREMENT-DEVIATION (96-VALIDATION.md decision 1): CLEAN-01's ROADMAP
--    text said a 24h window. `strategies` has NO `updated_at` column, so a 24h cutoff
--    on `created_at` would delete drafts a user resumes on day 2 — colliding with the
--    Phase-94 wizard resumability this milestone shipped. The LOCKED window is
--    `created_at < now() - interval '7 days'`. Every window assertion below pins
--    '7 days' and asserts the body does NOT contain '24 hours'. Do NOT re-litigate.
--
-- RED-UNTIL-96-02: `cleanup_abandoned_wizard_drafts` does not exist yet (it lands in
--    migration 20260713120000, Phase 96 Plan 02). Part 1's first assertion RAISEs
--    'cleanup_abandoned_wizard_drafts ... missing' and, under `psql -v
--    ON_ERROR_STOP=1`, aborts the run there. That is the intended repro-gate: this
--    file FAILS without the 96-02 change, by construction. 96-02 turns it GREEN.
--
-- CONVENTIONS (models: test_api_key_delete_atomicity.sql, test_strategy_keys_
--    publish_integrity.sql, test_guard_wizard_draft_updates_auth_uid.sql):
--    pgTAP is not installed (CLAUDE.md / Lane B) — assertions RAISE EXCEPTION on
--    failure; a clean run prints NOTICEs only. NO psql backslash meta-commands (the
--    CI sql-tests preflight rejects `^\`). Wrapped in BEGIN/ROLLBACK; all ids are
--    gen_random_uuid() and every assertion targets seeded ids ONLY — the RPC also
--    sweeps any real stale rows inside the txn, so global counts are meaningless and
--    are never asserted. Run order: AFTER migration 20260713120000.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_cleanup_wizard_drafts_race.sql

BEGIN;

-- ==========================================================================
-- Part 1 — structural: the sweep RPC scope + finalize's guarded-UPDATE shape.
-- (RED lever: the missing-RPC assertion below is the first thing that runs.)
-- ==========================================================================
DO $$
DECLARE
  v_src  text;
  v_cfg  text[];
  v_fin  text;
BEGIN
  -- (a) RED lever — the sweep RPC must exist. Until 96-02 ships migration
  --     20260713120000 this RAISEs and ON_ERROR_STOP aborts the whole file.
  SELECT prosrc, proconfig INTO v_src, v_cfg
    FROM pg_proc WHERE proname = 'cleanup_abandoned_wizard_drafts';
  IF v_src IS NULL THEN
    RAISE EXCEPTION
      'CLEAN-01: cleanup_abandoned_wizard_drafts() missing — apply migration 20260713120000 (RED until Phase 96 Plan 02)';
  END IF;

  -- (b) scope: wizard drafts only, review_note-guarded, 7-day window.
  IF v_src NOT LIKE '%wizard%' THEN
    RAISE EXCEPTION 'CLEAN-01: sweep body does not scope to source=wizard';
  END IF;
  IF v_src NOT LIKE '%draft%' THEN
    RAISE EXCEPTION 'CLEAN-01: sweep body does not scope to status=draft';
  END IF;
  IF v_src NOT LIKE '%review_note%' THEN
    RAISE EXCEPTION 'CLEAN-01: sweep body does not spare drafts with a review_note (M-0255)';
  END IF;
  -- LOCKED 7d window (96-VALIDATION decision 1). Both directions pinned.
  IF v_src NOT LIKE '%7 days%' THEN
    RAISE EXCEPTION 'CLEAN-01: sweep window is not 7 days (locked reconciliation with Phase-94 resumability)';
  END IF;
  IF v_src LIKE '%24 hours%' THEN
    RAISE EXCEPTION 'CLEAN-01: sweep window regressed to 24 hours — collides with wizard resumability (96-VALIDATION decision 1)';
  END IF;

  -- (c) the sweep must NOT set the sanitize GUC (account-deletion path unaffected).
  IF v_src LIKE '%sanitize_in_progress%' THEN
    RAISE EXCEPTION 'CLEAN-01: sweep body references sanitize_in_progress — it must not touch the GDPR sanitize GUC';
  END IF;

  -- (d) hardening: baked search_path.
  IF v_cfg IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest(v_cfg) c WHERE c LIKE 'search_path=%'
  ) THEN
    RAISE EXCEPTION 'CLEAN-01: sweep has no baked search_path; proconfig=%',
      COALESCE(array_to_string(v_cfg, ','), '<null>');
  END IF;

  -- (e) least-privilege: service_role EXECUTE allowed; anon + authenticated denied.
  IF NOT has_function_privilege('service_role',
       'public.cleanup_abandoned_wizard_drafts()', 'EXECUTE') THEN
    RAISE EXCEPTION 'CLEAN-01: service_role lacks EXECUTE on cleanup_abandoned_wizard_drafts';
  END IF;
  IF has_function_privilege('anon',
       'public.cleanup_abandoned_wizard_drafts()', 'EXECUTE') THEN
    RAISE EXCEPTION 'CLEAN-01: anon has EXECUTE on cleanup_abandoned_wizard_drafts';
  END IF;
  IF has_function_privilege('authenticated',
       'public.cleanup_abandoned_wizard_drafts()', 'EXECUTE') THEN
    RAISE EXCEPTION 'CLEAN-01: authenticated has EXECUTE on cleanup_abandoned_wizard_drafts';
  END IF;

  -- (f) T-96-01: finalize is a committed guarded UPDATE (OQ3 precondition). A
  --     rewrite to delete+insert, or dropping the FOR UPDATE lock / the draft
  --     guard, invalidates the EvalPlanQual race proof — redden here.
  SELECT prosrc INTO v_fin FROM pg_proc WHERE proname = 'finalize_wizard_strategy';
  IF v_fin IS NULL THEN
    RAISE EXCEPTION 'CLEAN-01: finalize_wizard_strategy missing — cannot verify the race precondition';
  END IF;
  IF v_fin NOT LIKE '%FOR UPDATE%' THEN
    RAISE EXCEPTION 'CLEAN-01: finalize_wizard_strategy lost its SELECT ... FOR UPDATE row lock (OQ3 / EPQ race proof invalid)';
  END IF;
  IF v_fin NOT LIKE '%<> ''draft''%' THEN
    RAISE EXCEPTION 'CLEAN-01: finalize_wizard_strategy lost its status <> ''draft'' guard (OQ3 / EPQ race proof invalid)';
  END IF;
  IF v_fin LIKE '%DELETE FROM strategies%' THEN
    RAISE EXCEPTION 'CLEAN-01: finalize_wizard_strategy contains DELETE FROM strategies — promotion must be a committed UPDATE, not delete+insert (OQ3 violated)';
  END IF;

  RAISE NOTICE 'CLEAN-01 Part 1 OK: sweep scope (wizard/draft/review_note/7d, no sanitize GUC, search_path, service_role-only) + finalize guarded-UPDATE shape pinned.';
END $$;

-- ==========================================================================
-- Part 2 — finalize-first ordering: promoted draft is SPARED, api_key survives.
-- ==========================================================================
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_key   uuid := gen_random_uuid();
  v_sid   uuid := gen_random_uuid();
  v_status text;
  v_cnt   integer;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'clean01-ff-' || v_user || '@quantalyze.test', now(), now());
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (v_user, 'clean01 finalize-first', 'clean01-ff-' || v_user || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
  VALUES (v_key, v_user, 'binance', 'clean01-ff', 'x');
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES (v_sid, v_user, v_key, 'clean01 ff draft', 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days');

  -- Finalize WINS the race first: the committed guarded-UPDATE shape promotes the
  -- draft. Runs as the service/migration role (current_user <> 'authenticated'),
  -- so guard_wizard_draft_updates() lets the promotion through.
  UPDATE public.strategies SET status = 'pending_review' WHERE id = v_sid;

  -- Cron then runs. The row is no longer a draft → the sweep skips it.
  PERFORM public.cleanup_abandoned_wizard_drafts();

  SELECT status INTO v_status FROM public.strategies WHERE id = v_sid;
  IF v_status IS DISTINCT FROM 'pending_review' THEN
    RAISE EXCEPTION 'CLEAN-01 Part 2: finalized draft did not survive as pending_review (status=%)',
      COALESCE(v_status, '<deleted>');
  END IF;
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'CLEAN-01 Part 2: the finalized strategy''s api_key was swept (count=%)', v_cnt;
  END IF;

  RAISE NOTICE 'CLEAN-01 Part 2 OK: finalize-first — promoted draft spared, api_key intact.';
END $$;

-- ==========================================================================
-- Part 3 — cron-first ordering: sweep deletes the draft + cascades members;
-- the subsequent real finalize fails LOUD with P0002 (no torn state).
-- ==========================================================================
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_key    uuid := gen_random_uuid();
  v_sid    uuid := gen_random_uuid();
  v_cnt    integer;
  v_raised boolean := false;
  v_state  text;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'clean01-cf-' || v_user || '@quantalyze.test', now(), now());
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (v_user, 'clean01 cron-first', 'clean01-cf-' || v_user || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
  VALUES (v_key, v_user, 'binance', 'clean01-cf', 'x');
  -- Composite draft (api_key_id NULL, membership via strategy_keys) so we can prove
  -- the member row cascades away when the draft is swept.
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES (v_sid, v_user, NULL, 'clean01 cf draft', 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days');
  INSERT INTO public.strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (v_sid, v_key, v_user, DATE '2025-08-01', 0);

  -- Cron WINS: the sweep deletes the stale draft; the strategy_keys member cascades.
  PERFORM public.cleanup_abandoned_wizard_drafts();

  SELECT count(*) INTO v_cnt FROM public.strategies WHERE id = v_sid;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'CLEAN-01 Part 3: stale draft was not swept (count=%)', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.strategy_keys WHERE strategy_id = v_sid;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'CLEAN-01 Part 3: strategy_keys members did not cascade on draft delete (count=%)', v_cnt;
  END IF;

  -- Finalize now loses the race. Emulate the authed session so auth.uid() =
  -- p_user_id (finalize is SECURITY DEFINER, GRANTed to authenticated), then call
  -- the REAL RPC on the now-deleted id. It must fail LOUD with P0002
  -- (no_data_found / GATE_DRAFT_GONE) — the clean, recoverable residual outcome.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.finalize_wizard_strategy(
      v_sid, v_user, 'clean01 cf', NULL, NULL,
      '{}'::text[], '{}'::text[], '{}'::text[], '{}'::text[], NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    v_state  := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF NOT v_raised THEN
    RAISE EXCEPTION 'CLEAN-01 Part 3: finalize of a swept draft did not raise — the race left torn state';
  END IF;
  IF v_state <> 'P0002' THEN
    RAISE EXCEPTION 'CLEAN-01 Part 3: finalize raised the WRONG SQLSTATE (expected P0002 no_data_found / GATE_DRAFT_GONE, got %)', v_state;
  END IF;

  RAISE NOTICE 'CLEAN-01 Part 3 OK: cron-first — draft swept + members cascaded, finalize fails loud with P0002.';
END $$;

-- ==========================================================================
-- Part 4 — window pins: review_note draft spared (M-0255); 1-day draft spared (7d).
-- ==========================================================================
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  v_key1  uuid := gen_random_uuid();
  v_key2  uuid := gen_random_uuid();
  v_note  uuid := gen_random_uuid();  -- 8-day draft WITH review_note
  v_fresh uuid := gen_random_uuid();  -- 1-day draft, review_note NULL
  v_cnt   integer;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'clean01-win-' || v_user || '@quantalyze.test', now(), now());
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (v_user, 'clean01 window', 'clean01-win-' || v_user || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
  VALUES (v_key1, v_user, 'binance', 'clean01-win-note', 'x'),
         (v_key2, v_user, 'binance', 'clean01-win-fresh', 'x');

  -- 8-day-old draft WITH a review_note → SPARED (a returned-for-changes draft the
  -- user is expected to resume; M-0255).
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    review_note, strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES (v_note, v_user, v_key1, 'clean01 note draft', 'draft', 'wizard',
    'please add a longer track record', '{}', '{}', '{}', ARRAY['binance'],
    now() - interval '8 days');

  -- 1-day-old draft, no review_note → SPARED (inside the 7d window, NOT 24h).
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES (v_fresh, v_user, v_key2, 'clean01 fresh draft', 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY['binance'], now() - interval '1 day');

  PERFORM public.cleanup_abandoned_wizard_drafts();

  SELECT count(*) INTO v_cnt FROM public.strategies WHERE id = v_note;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'CLEAN-01 Part 4: an 8-day draft WITH a review_note was swept (M-0255 violated, count=%)', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.strategies WHERE id = v_fresh;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'CLEAN-01 Part 4: a 1-day-old draft was swept — window is 24h, not the locked 7 days (count=%)', v_cnt;
  END IF;

  RAISE NOTICE 'CLEAN-01 Part 4 OK: review_note draft + 1-day draft both spared (7d window, M-0255).';
END $$;

ROLLBACK;
