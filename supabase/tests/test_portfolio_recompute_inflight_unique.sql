-- Test: PI-07 portfolio recompute in-flight UNIQUE fence
-- (partial UNIQUE index portfolio_analytics_one_computing_per_portfolio).
--
--   PI-07 — the SELECT-then-INSERT in-flight guard in portfolio.py / cron.py
--     is TOCTOU across processes and the asyncio.Semaphore(3) is process-local,
--     so two workers can each observe "no computing row" and both INSERT a
--     `computing` snapshot for the SAME portfolio. Only the DB can fence this
--     cross-process. Migration 20260714090000 replaces the non-unique
--     idx_portfolio_analytics_computing with a partial UNIQUE index
--     `portfolio_analytics_one_computing_per_portfolio ON portfolio_analytics
--     (portfolio_id) WHERE computation_status = 'computing'`. The second
--     concurrent INSERT then violates that index (SQLSTATE 23505), DB-enforced.
--
-- The Python-side in-flight guard cannot observe this server-side invariant
-- (it never opens two racing transactions), and a structural grep of the
-- migration only proves the DDL text exists. This file exercises the LIVE
-- index against the test project so the fence is verified by BEHAVIOR (a real
-- 23505 on the racing INSERT), not by string-matching a migration body.
--
-- pgTAP is not set up in this project (CLAUDE.md / Lane B), so assertions
-- RAISE EXCEPTION on failure; a clean run prints NOTICEs only. Run under
-- `psql -v ON_ERROR_STOP=1`. Run order: AFTER migration 20260714090000.
--
-- Part 2 seeds gen_random_uuid() ids inside an explicit BEGIN/ROLLBACK so a
-- concurrent CI run against the shared test project cannot collide and no row
-- is left behind even on assertion failure. Every count assertion is scoped
-- to the seeded portfolio_id so committed rows from a concurrent run cannot
-- perturb it (red-team A, the same pattern the sibling
-- test_claim_compute_jobs_dedupe_partition.sql uses).

-- ==========================================================================
-- Part 1 — structural: the partial UNIQUE fence index exists on
-- portfolio_analytics, is UNIQUE, and scopes to the 'computing' partition.
-- Zero side effects; this is the RED signal pre-migration (the index does
-- not yet exist) and the exact object Part 2's 23505 depends on.
-- ==========================================================================
DO $$
DECLARE
  v_indexdef TEXT;
BEGIN
  SELECT indexdef INTO v_indexdef
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename  = 'portfolio_analytics'
     AND indexname  = 'portfolio_analytics_one_computing_per_portfolio';

  IF v_indexdef IS NULL THEN
    RAISE EXCEPTION 'PI-07: fence index portfolio_analytics_one_computing_per_portfolio is absent on public.portfolio_analytics';
  END IF;

  -- Must be a UNIQUE index (a plain index would not raise 23505).
  IF v_indexdef !~* 'CREATE\s+UNIQUE\s+INDEX' THEN
    RAISE EXCEPTION 'PI-07: fence index exists but is NOT UNIQUE (indexdef: %)', v_indexdef;
  END IF;

  -- Must be scoped to the 'computing' partition (predicate) so that
  -- complete/failed/pending rows are unaffected.
  IF v_indexdef !~* 'computation_status\s*=\s*''computing''' THEN
    RAISE EXCEPTION 'PI-07: fence index is not partial on computation_status = ''computing'' (indexdef: %)', v_indexdef;
  END IF;

  RAISE NOTICE 'Part 1 OK: portfolio_analytics_one_computing_per_portfolio present, UNIQUE, scoped to computing.';
END $$;

-- ==========================================================================
-- Part 2 — functional: a second `computing` INSERT for the same portfolio
-- raises 23505, while a `complete` row for the same portfolio and a
-- `computing` row for a DIFFERENT portfolio both succeed (predicate + per-
-- portfolio partition scoping). Isolated in a transaction that always rolls
-- back.
-- ==========================================================================
BEGIN;
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_pf1    uuid;
  v_pf2    uuid;
  v_raised boolean := false;
  v_computing int;
BEGIN
  -- FK chain: portfolio_analytics.portfolio_id -> portfolios.id ->
  -- profiles.id -> auth.users.id. handle_new_user auto-creates the profile
  -- on the auth.users insert; absorb it with ON CONFLICT DO NOTHING.
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'pi07-sql-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'pi07-test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.portfolios (user_id, name)
    VALUES (v_user, 'pi07-portfolio-1') RETURNING id INTO v_pf1;
  -- pf2 is a SECOND portfolio for the SAME user, needed only to prove the
  -- computing fence is per-portfolio (control 4). The partial unique index
  -- portfolios_one_real_per_user (mig 20260409202756) allows at most one
  -- is_test=false portfolio per user, so pf2 must be is_test=true; the PI-07
  -- fence is on portfolio_analytics.portfolio_id and is is_test-agnostic.
  INSERT INTO public.portfolios (user_id, name, is_test)
    VALUES (v_user, 'pi07-portfolio-2', true) RETURNING id INTO v_pf2;

  -- (1) First `computing` row for portfolio 1 — must succeed.
  INSERT INTO public.portfolio_analytics (portfolio_id, computation_status)
    VALUES (v_pf1, 'computing');

  -- (2) Second `computing` row for the SAME portfolio — must raise 23505.
  -- Nested block so the unique_violation is caught and the outer tx survives
  -- to run the remaining negative controls; the failed INSERT is rolled back
  -- to the subblock savepoint so the computing count stays 1.
  BEGIN
    INSERT INTO public.portfolio_analytics (portfolio_id, computation_status)
      VALUES (v_pf1, 'computing');
  EXCEPTION
    WHEN unique_violation THEN
      v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'PI-07: second computing INSERT did not raise 23505';
  END IF;

  -- (3) A `complete` row for the SAME portfolio — must NOT raise (the fence
  -- only covers the 'computing' partition).
  INSERT INTO public.portfolio_analytics (portfolio_id, computation_status)
    VALUES (v_pf1, 'complete');

  -- (4) A `computing` row for a SECOND portfolio — must NOT raise (the fence
  -- is per-portfolio, not global).
  INSERT INTO public.portfolio_analytics (portfolio_id, computation_status)
    VALUES (v_pf2, 'computing');

  -- (5) Exactly ONE `computing` row survives for portfolio 1. Scoped to the
  -- seeded portfolio_id so a concurrent committed run cannot inflate it.
  SELECT count(*) INTO v_computing
    FROM public.portfolio_analytics
   WHERE portfolio_id = v_pf1 AND computation_status = 'computing';
  IF v_computing <> 1 THEN
    RAISE EXCEPTION 'PI-07: expected exactly 1 computing row for portfolio %, got %', v_pf1, v_computing;
  END IF;

  RAISE NOTICE 'PI-07 OK: racing computing INSERT raised 23505; complete + other-portfolio computing unaffected.';
END $$;
ROLLBACK;
