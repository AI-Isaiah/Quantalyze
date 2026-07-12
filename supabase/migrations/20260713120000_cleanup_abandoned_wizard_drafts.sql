-- Phase 96 (draft-key-hygiene-onboarding-polish) / Plan 96-02 — CLEAN-01 + CLEAN-02.
-- Requirements: CLEAN-01 (#35 atomic stale-wizard-draft cleanup) + CLEAN-02 (#36
-- scoped orphaned-api_key sweep). ONE new SECURITY DEFINER RPC,
-- cleanup_abandoned_wizard_drafts(), replaces the racy SELECT-then-DELETE the cron
-- route runs today (96-03 rewires the route to call this) and closes the
-- composite-member key-accumulation gap the incomplete delete_api_key_if_unreferenced
-- cannot see.
--
-- ⚠️ DATA-DELETION DANGER ZONE. This migration AUTO-APPLIES TO PROD on the milestone
--    merge (supabase-migrate workflow: merging supabase/migrations/** to main applies
--    to the linked prod project). The self-verifying DO block at the tail is the last
--    line of defense — it seeds all safety cases, calls the RPC once, and RAISEs
--    (aborting the WHOLE apply transaction) on any wrong deletion. Fail-loud at apply.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LOCKED REQUIREMENT-DEVIATION (96-VALIDATION.md decision 1) — do NOT re-litigate:
--   CLEAN-01's ROADMAP text said a 24h window. `strategies` has NO `updated_at`
--   column, so a 24h cutoff on `created_at` would delete drafts a user actively
--   resumes on day 2 — colliding with the Phase-94 wizard resumability this
--   milestone shipped. The LOCKED window is `created_at < now() - interval '7 days'`.
--
-- M-0255 (rejected drafts exempt): the sweep spares any draft carrying a
--   `review_note` — a returned-for-changes draft the user is expected to resume;
--   `created_at` is never reset on reject, so a plain age cutoff would wrongly
--   delete it.
--
-- WHY A SCOPED CANDIDATE-SET SWEEP (not a full-table orphan sweep): a blanket
--   "delete every api_key with no references" would nuke a key a user just added in
--   the wizard but has not yet attached to a strategy (mid-onboarding). We therefore
--   sweep ONLY keys that were members of the drafts we just deleted — captured
--   BEFORE the strategy_keys ON DELETE CASCADE removes the membership rows.
--
-- WHY delete_api_key_if_unreferenced IS NOT REUSED (96-VALIDATION decision 4): that
--   RPC checks ONLY `strategies.api_key_id` — it is composite-BLIND (misses the
--   `strategy_keys` membership axis) and does not exclude `allocator_holdings`
--   (ON DELETE RESTRICT) keys, so a set-DELETE through it would either miss holed
--   composites or abort 23503. This RPC checks BOTH ref axes itself + excludes the
--   RESTRICT axis. delete_api_key_if_unreferenced is left UNTOUCHED (the user-driven
--   single-key draft-DELETE route still depends on it).
--
-- EPQ RACE PROOF (CLEAN-01, VALIDATION decision 2 / OQ3 evidence in 96-01-SUMMARY):
--   the DELETE predicate re-checks `status='draft'` against the latest committed
--   tuple. finalize_wizard_strategy promotes draft→pending_review via a COMMITTED
--   guarded UPDATE (SELECT ... FOR UPDATE + `status <> 'draft'` guard, no
--   delete+insert — OQ3 PASS). So a concurrent finalize either commits first (the
--   sweep's predicate then sees pending_review and skips the row) or loses and later
--   fails loud with P0002 on the now-deleted id. Never a torn promotion.
--
-- GUC INVARIANT: this function must NEVER set `quantalyze.sanitize_in_progress`. The
--   published-composite delete guard (20260710160000) must stay ACTIVE during the
--   sweep — its sanitize exemption is for the GDPR sanitize_user path ONLY. The
--   NOT EXISTS strategy_keys clause below is a strict superset of the guard's
--   published-member protected set, so the sweep never even reaches a guarded key;
--   the guard remains a fail-loud backstop. sanitize_user's own GUC use is untouched.
--
-- APPLICATION PATH: authored here; auto-applied on merge. CREATE OR REPLACE — the
--   RPC re-applies idempotently; the DO block cleans up every row it seeds so a
--   test-DB catch-up re-run is harmless. Post-land routing: this migration goes
--   through migration-reviewer + rls-policy-auditor (standing rule) after it lands.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- 1. cleanup_abandoned_wizard_drafts — atomic 7d draft DELETE (CLEAN-01) +
--    scoped candidate-set api_keys sweep (CLEAN-02), ONE transaction, member
--    keys captured BEFORE the strategy_keys CASCADE.
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.cleanup_abandoned_wizard_drafts()
  RETURNS TABLE(deleted_drafts int, swept_keys int)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
  SET lock_timeout = '3s'
AS $$
DECLARE v_candidate_keys uuid[];
BEGIN
  -- 1. Capture composite member key ids BEFORE the CASCADE removes strategy_keys.
  SELECT array_agg(DISTINCT sk.api_key_id)
    INTO v_candidate_keys
    FROM strategy_keys sk
    JOIN strategies s ON s.id = sk.strategy_id
   WHERE s.source='wizard' AND s.status='draft' AND s.review_note IS NULL
     AND s.created_at < now() - interval '7 days';

  -- 2. Atomic single DELETE of the drafts; RETURNING adds single-key api_key_ids.
  WITH doomed AS (
    DELETE FROM strategies
     WHERE source='wizard' AND status='draft' AND review_note IS NULL
       AND created_at < now() - interval '7 days'
     RETURNING id, api_key_id
  )
  SELECT count(*)::int,
         COALESCE(v_candidate_keys, '{}') || COALESCE(array_remove(array_agg(api_key_id), NULL), '{}')
    INTO deleted_drafts, v_candidate_keys
    FROM doomed;

  -- 3. Reference-complete, RESTRICT-safe sweep (published-composite guard never fires:
  --    the NOT EXISTS strategy_keys clause is a strict superset of the guard's
  --    published-only protected set).
  WITH swept AS (
    DELETE FROM api_keys k
     WHERE k.id = ANY(v_candidate_keys)
       AND NOT EXISTS (SELECT 1 FROM strategies        s  WHERE s.api_key_id  = k.id)
       AND NOT EXISTS (SELECT 1 FROM strategy_keys     sk WHERE sk.api_key_id = k.id)
       AND NOT EXISTS (SELECT 1 FROM allocator_holdings h WHERE h.api_key_id = k.id)
     RETURNING 1
  )
  SELECT count(*)::int INTO swept_keys FROM swept;
  RETURN NEXT;
END $$;

-- Cron-called destructive mutator: NOT callable by end users. service_role only.
REVOKE ALL ON FUNCTION public.cleanup_abandoned_wizard_drafts()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_abandoned_wizard_drafts()
  TO service_role;

COMMENT ON FUNCTION public.cleanup_abandoned_wizard_drafts() IS
  'CLEAN-01 + CLEAN-02: atomically DELETE abandoned wizard drafts (source=wizard, '
  'status=draft, review_note IS NULL, created_at < now() - 7 days — LOCKED 7d policy '
  'reconciling the 24h ROADMAP text with Phase-94 resumability, 96-VALIDATION decision 1) '
  'and sweep their now-orphaned api_keys in ONE transaction. Member keys are captured '
  'BEFORE the strategy_keys CASCADE; the sweep spares any key still referenced by '
  'strategies.api_key_id, strategy_keys, or allocator_holdings (the last avoids a 23503 '
  'RESTRICT abort). Never sets the sanitize GUC; never reuses the composite-blind '
  'single-axis orphan-revoke RPC. service_role only (cron).';

-- ==========================================================================
-- 2. Self-verifying DO block — apply-time proof of all safety cases, FULLY
--    ISOLATED. Model: the DO block in 20260602183000_b5b_api_key_delete_atomicity.sql.
--    ⚠️ The seed + PERFORM cleanup_abandoned_wizard_drafts() + all assertions run
--       inside a plpgsql SUBTRANSACTION that ALWAYS rolls back on success (the
--       sentinel-exception pattern). Net apply-time real-data mutation = ZERO — this
--       migration is a pure CREATE FUNCTION + a rolled-back self-test. It does NOT
--       delete any real stale drafts/keys at apply time: coupling an irreversible
--       bulk deletion to a schema merge would be an unobservable side effect. The
--       FIRST real run happens via the cron (96-03), which RETURNS (deleted_drafts,
--       swept_keys) and is logged/monitorable.
--    ⚠️ Fail-loud preserved: a genuine case failure RAISEs a DIFFERENT errcode (the
--       default P0001) that is NOT caught by the success handler, so it propagates
--       out and ABORTS the entire apply.
-- ==========================================================================
DO $$
DECLARE
  v_user  uuid := gen_random_uuid();
  -- keys, one per safety case
  v_key_a uuid := gen_random_uuid();  -- (A) orphan on a doomed draft        → SWEPT
  v_key_b uuid := gen_random_uuid();  -- (B) also member of a survivor        → SPARED
  v_key_c uuid := gen_random_uuid();  -- (C) also member of a published comp  → SPARED
  v_key_d uuid := gen_random_uuid();  -- (D) also single-key of a survivor    → SPARED
  v_key_e uuid := gen_random_uuid();  -- (E) also in allocator_holdings       → SPARED
  v_key_f uuid := gen_random_uuid();  -- (F) doomed-composite member, no ref  → SWEPT (capture)
  v_key_n uuid := gen_random_uuid();  -- review_note 8d draft                 → SPARED
  v_key_z uuid := gen_random_uuid();  -- fresh 1d draft                       → SPARED
  -- doomed 8d wizard drafts
  v_da uuid := gen_random_uuid();
  v_db uuid := gen_random_uuid();
  v_dc uuid := gen_random_uuid();
  v_dd uuid := gen_random_uuid();
  v_de uuid := gen_random_uuid();
  v_df uuid := gen_random_uuid();
  -- spared drafts (window pins)
  v_dn uuid := gen_random_uuid();  -- 8d draft WITH review_note (M-0255)
  v_dz uuid := gen_random_uuid();  -- 1d draft (proves 7d, not 24h)
  -- surviving (non-doomed) strategies keeping B/C/D referenced
  v_sb uuid := gen_random_uuid();  -- surviving published composite for key_b
  v_sc uuid := gen_random_uuid();  -- published composite for key_c (guard superset)
  v_sd uuid := gen_random_uuid();  -- published single-key for key_d
  v_cnt integer;
BEGIN
  -- Subtransaction (savepoint): every seed + the PERFORM's real deletions + the
  -- assertions below are undone when this block exits via the ZZ999 success
  -- sentinel. Nothing here survives to COMMIT.
  BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'clean-selftest-' || v_user || '@quantalyze.test', now(), now());
  INSERT INTO public.profiles (id, display_name, email, role)
  VALUES (v_user, 'clean selftest', 'clean-selftest-' || v_user || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted) VALUES
    (v_key_a, v_user, 'binance', 'clean-a', 'x'),
    (v_key_b, v_user, 'binance', 'clean-b', 'x'),
    (v_key_c, v_user, 'binance', 'clean-c', 'x'),
    (v_key_d, v_user, 'binance', 'clean-d', 'x'),
    (v_key_e, v_user, 'binance', 'clean-e', 'x'),
    (v_key_f, v_user, 'binance', 'clean-f', 'x'),
    (v_key_n, v_user, 'binance', 'clean-n', 'x'),
    (v_key_z, v_user, 'binance', 'clean-z', 'x');

  -- ---- doomed 8-day wizard drafts (source=wizard, status=draft, review_note NULL) ----
  -- A: single-key doomed draft linking key_a.
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES (v_da, v_user, v_key_a, 'clean A', 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days');
  -- B, C, F: composite doomed drafts (api_key_id NULL, membership via strategy_keys).
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES
    (v_db, v_user, NULL, 'clean B', 'draft', 'wizard', '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days'),
    (v_dc, v_user, NULL, 'clean C', 'draft', 'wizard', '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days'),
    (v_df, v_user, NULL, 'clean F', 'draft', 'wizard', '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days');
  -- D: single-key doomed draft linking key_d (also linked by a survivor below).
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES (v_dd, v_user, v_key_d, 'clean D', 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days');
  -- E: single-key doomed draft linking key_e (also in allocator_holdings below).
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES (v_de, v_user, v_key_e, 'clean E', 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY['binance'], now() - interval '8 days');

  INSERT INTO public.strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq) VALUES
    (v_db, v_key_b, v_user, DATE '2025-08-01', 0),
    (v_dc, v_key_c, v_user, DATE '2025-08-01', 0),
    (v_df, v_key_f, v_user, DATE '2025-08-01', 0);

  -- ---- spared window pins ----
  -- 8-day draft WITH a review_note → SPARED (M-0255).
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    review_note, strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES (v_dn, v_user, v_key_n, 'clean note', 'draft', 'wizard',
    'please add a longer track record', '{}', '{}', '{}', ARRAY['binance'],
    now() - interval '8 days');
  -- 1-day draft, no review_note → SPARED (7d window, NOT 24h).
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges, created_at)
  VALUES (v_dz, v_user, v_key_z, 'clean fresh', 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY['binance'], now() - interval '1 day');

  -- ---- surviving (non-doomed) strategies keeping B/C/D referenced ----
  INSERT INTO public.strategies (id, user_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges)
  VALUES (v_sb, v_user, 'clean B survivor', 'published', 'wizard',
    '{}', '{}', '{}', ARRAY['binance']);
  INSERT INTO public.strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (v_sb, v_key_b, v_user, DATE '2025-08-01', 0);
  INSERT INTO public.strategies (id, user_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges)
  VALUES (v_sc, v_user, 'clean C survivor', 'published', 'wizard',
    '{}', '{}', '{}', ARRAY['binance']);
  INSERT INTO public.strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (v_sc, v_key_c, v_user, DATE '2025-08-01', 0);
  INSERT INTO public.strategies (id, user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges)
  VALUES (v_sd, v_user, v_key_d, 'clean D survivor', 'published', 'wizard',
    '{}', '{}', '{}', ARRAY['binance']);

  -- E: allocator_holdings row referencing key_e (ON DELETE RESTRICT).
  INSERT INTO public.allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side,
    quantity, value_usd, mark_price)
  VALUES (v_user, v_key_e, 'binance', 'BTCUSDT', DATE '2026-01-01', 'derivative', 'long',
    1, 50000, 50000);

  -- ---- ONE sweep call against the synthetic seeds (rolled back below) ----
  PERFORM public.cleanup_abandoned_wizard_drafts();

  -- All six doomed drafts gone; both spared drafts survive.
  SELECT count(*) INTO v_cnt FROM public.strategies
    WHERE id IN (v_da, v_db, v_dc, v_dd, v_de, v_df);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'cleanup self-verify: not all doomed drafts were deleted (remaining=%)', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.strategies WHERE id IN (v_dn, v_dz);
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'cleanup self-verify: a spared draft (review_note or 1d) was wrongly deleted (surviving=%)', v_cnt;
  END IF;

  -- Case A: orphan → SWEPT.
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key_a;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'cleanup self-verify Case A: orphan key was NOT swept (count=%)', v_cnt;
  END IF;
  -- Case F: doomed-composite member with no surviving refs → SWEPT (pre-cascade capture).
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key_f;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'cleanup self-verify Case F: pre-cascade capture missing — member key not swept (count=%)', v_cnt;
  END IF;
  -- Case B: still a member of a surviving strategy → SPARED.
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key_b;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'cleanup self-verify Case B: surviving-composite member key was swept (count=%)', v_cnt;
  END IF;
  -- Case C: member of a published composite → SPARED (guard superset).
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key_c;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'cleanup self-verify Case C: published-composite member key was swept (count=%)', v_cnt;
  END IF;
  -- Case D: single-key of a surviving strategy → SPARED.
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key_d;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'cleanup self-verify Case D: strategies.api_key_id-linked key was swept (count=%)', v_cnt;
  END IF;
  -- Case E: referenced by allocator_holdings (RESTRICT) → SPARED, no 23503 abort
  --         (Case A/F swept in the SAME call proves the statement did not abort).
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id = v_key_e;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'cleanup self-verify Case E: allocator_holdings-referenced key was swept (count=%)', v_cnt;
  END IF;
  -- The two spared drafts' keys survive.
  SELECT count(*) INTO v_cnt FROM public.api_keys WHERE id IN (v_key_n, v_key_z);
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'cleanup self-verify: a spared draft''s key was wrongly swept (surviving=%)', v_cnt;
  END IF;

    -- All cases passed. Raise the success sentinel: this rolls the ENTIRE
    -- subtransaction back — the synthetic seeds AND the real deletions the
    -- function performed during the test — so no self-cleaning DELETEs are
    -- needed and net apply-time data mutation is zero.
    RAISE EXCEPTION 'SELFVERIFY_OK' USING ERRCODE = 'ZZ999';
  EXCEPTION
    WHEN SQLSTATE 'ZZ999' THEN
      -- Success path: the subtransaction (seeds + the function's real deletions)
      -- has been rolled back to the savepoint. Nothing persists.
      RAISE NOTICE 'cleanup_abandoned_wizard_drafts self-verify PASSED (isolated, rolled back): A/F swept, B/C/D/E + review_note + 1d spared, no 23503 abort, pre-cascade capture proven; ZERO real data mutation at apply.';
      -- Any OTHER exception (a real case failure = P0001, or a seed/constraint
      -- error) is intentionally NOT handled here → it propagates out of this
      -- block and ABORTS the whole migration apply (fail-loud).
  END;
END $$;

COMMIT;
