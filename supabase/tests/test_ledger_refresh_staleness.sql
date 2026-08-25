-- Test: public.ledger_refresh_staleness — the LEDGER-03 freshness verdict.
-- Guards migration 20260825120000_ledger_refresh_staleness_view.sql
-- (Phase 161.1 / D-03, D-04, D-05, D-06, T-161.1-04).
--
-- What makes this gate worth having
-- ---------------------------------
-- The defect this phase exists to fix hid for weeks behind timestamps that kept
-- moving while the analytics rotted. A staleness view is therefore only useful if
-- its verdict CANNOT be advanced by the things that lied. Arm A is that pin: it
-- advances BOTH rejected timestamps — strategy_analytics.computed_at and
-- api_keys.last_sync_at — inside the same transaction, without touching
-- returns_series, and asserts the verdict does not move. Arm B is the negative
-- control that stops a view hard-coding TRUE from passing Arm A.
--
-- Arms:
--   A  criterion-3 pin      — 21d-old mt5 series reads stale, and STAYS stale
--                             when computed_at + last_sync_at are advanced.
--   B  negative control     — a genuinely fresh deribit strategy reads FRESH.
--   C  D-04 status pair     — 'complete' AND 'complete_with_warnings' both count
--                             as success; 'failed' with an UNCHANGED fresh series
--                             reads stale (the fresh-but-failed row).
--   D  D-06 composite       — a deribit composite (api_key_id NULL, venue only
--                             reachable through strategy_keys) is VISIBLE.
--   E  T-161.1-04 malformed — a non-array series, a non-date element, and a
--                             regex-passing IMPOSSIBLE date (2026-02-31) each
--                             return a row without raising, and read stale.
--   F  threshold edges      — age 4 fresh / age 5 stale, pinning the constant on
--                             both sides so it cannot drift silently.
--   G  D-05 cohort scope    — a non-ledger (okx) strategy is ABSENT from the view.
--   H  ACL durability       — 161.1-AUDIT F-1: anon/authenticated cannot SELECT
--                             the view or EXECUTE the parser, and security_invoker
--                             is still on. Mirrors the apply-time DO block, which
--                             runs once and can be silently undone afterwards.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- ⛔ AN ABSENT VIEW IS A HARD FAILURE, NEVER A SKIP (161.1-REVIEW WR-03)
-- ----------------------------------------------------------------------
-- This file used to open with `RAISE NOTICE 'SKIP: …'; RETURN;` when the view was
-- absent. MEASURED 2026-08-25 against an empty Postgres 16: that path printed the
-- notice and exited `EXITCODE=0` having executed ZERO of arms A-H. The CI step
-- (.github/workflows/ci.yml, `sql-tests` → "Run SQL self-tests against test
-- Supabase project") reads ONLY that exit code, so the skip was byte-identical to
-- a pass in the only channel anything mechanical looks at — and it was GUARANTEED
-- to fire on the one run that matters most: the PR that introduces migration
-- 20260825120000.
--
-- Why the skip was removed rather than made louder. MEASURED, not assumed:
--   * the `sql-tests` job has NO migration-apply step. It checks out, installs
--     psql, runs the meta-command preflight, takes the shared-test-db mutex, and
--     `psql -f`s each file. Nothing puts supabase/migrations/** on the TEST
--     project first.
--   * .github/workflows/supabase-migrate.yml applies migrations to the PRODUCTION
--     project only (`vars.SUPABASE_PROJECT_REF`), on push to main. No workflow, npm
--     script or Makefile target applies them to the TEST project; TODOS.md records
--     TEST being migrated by hand (Supabase MCP `apply_migration`) instead.
--   So the old comment's promise — "assertions enforce once the test DB catches
--   up" — named a mechanism that DOES NOT EXIST. Nothing would ever have armed
--   this file on its own.
-- A NOTICE cannot reach CI's only channel; an exception can. The two outcomes are
-- now distinguishable where they are actually read.
--
-- The consequence is deliberate and IS the forcing function: this file is RED
-- until the phase's migrations are applied to the TEST project. These are
-- SECURITY DEFINER, cross-tenant objects that auto-apply to PROD on merge, and
-- arms A-H are their ONLY executed coverage — every other gate in the phase is a
-- static text scan over the migration source.
--
-- ✅ MECHANICALLY CLOSED (161.1-REVIEW WR-03 option (b), landed in
-- .github/workflows/ci.yml): the `sql-tests` step now captures each file's output,
-- fails on a printed 'SKIP:', and reads the 'ALL 8 ARMS EXECUTED' sentinel back off
-- THIS file's RAISE NOTICE line and requires the run to have printed it. So an
-- edit that neuters an arm in place — deleting the assertion, short-circuiting
-- early — fails CI even though psql exits 0. ⚠️ The count in that notice is read
-- from the file, not hard-coded: if you add or remove an arm you MUST update it,
-- or the pin silently measures the wrong number of arms.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_ledger_refresh_staleness.sql

BEGIN;

DO $$
DECLARE
  uid            UUID := gen_random_uuid();
  k_mt5          UUID;
  k_deribit      UUID;
  k_deribit_b    UUID;
  k_okx          UUID;
  s_a            UUID;  -- Arm A: mt5 single-key, 21d stale
  s_b            UUID;  -- Arm B: deribit single-key, fresh
  s_c_complete   UUID;  -- Arm C: fresh, status 'complete'
  s_c_failed     UUID;  -- Arm C: fresh series, status flipped to 'failed'
  s_d            UUID;  -- Arm D: deribit composite
  s_e_object     UUID;  -- Arm E: returns_series is a JSON object
  s_e_garbage    UUID;  -- Arm E: element date is not a date at all
  s_e_impossible UUID;  -- Arm E: element date passes the regex but is impossible
  s_f4           UUID;  -- Arm F: age exactly 4 (largest legitimate age)
  s_f5           UUID;  -- Arm F: age exactly 5 (first stale age)
  s_g            UUID;  -- Arm G: okx, must be out of cohort
  v_stale        BOOLEAN;
  v_stale2       BOOLEAN;
  v_reason       TEXT;
  v_reason2      TEXT;
  v_composite    BOOLEAN;
  v_exchanges    TEXT[];
  v_has_mt5      BOOLEAN;
  v_last         DATE;
  v_days         INTEGER;
  v_cnt          INTEGER;
  v_opts         TEXT[];
BEGIN
  -- ----- applied-ness gate: ABSENCE IS A FAILURE, NOT A SKIP (WR-03) ------
  -- See the ⛔ block in this file's header for the measurement behind this.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'public' AND table_name = 'ledger_refresh_staleness'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED (0): public.ledger_refresh_staleness does not exist on this database, so NONE of arms A-H ran. This is a FAILURE, not a skip. TWO causes fit and this assertion cannot distinguish them, so check both: (i) the TEST project has not received migration 20260825120000 — apply the phase''s migrations to it and re-run; expect this exactly once, on the PR that introduces them, because NO workflow applies migrations to TEST; (ii) the view was DROPPED or RENAMED after being applied, which is a real regression in the only surface that can observe ledger staleness. ⛔ Do NOT "fix" this by restoring the old RAISE NOTICE/RETURN skip: that made this file exit 0 having asserted nothing, on exactly the run where these SECURITY DEFINER objects first reach PROD.';
  END IF;

  -- ----- SEED ------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'lrs-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'lrs', 'lrs-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'lrs mt5', 'x', TRUE) RETURNING id INTO k_mt5;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'deribit', 'lrs deribit a', 'x', TRUE) RETURNING id INTO k_deribit;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'deribit', 'lrs deribit b', 'x', TRUE) RETURNING id INTO k_deribit_b;
  -- NOT ledger-backed. Arm G proves the cohort filter actually excludes it.
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'okx', 'lrs okx', 'x', TRUE) RETURNING id INTO k_okx;

  -- Single-key strategies link through strategies.api_key_id (D-06).
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5,     'lrs A')  RETURNING id INTO s_a;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_deribit, 'lrs B')  RETURNING id INTO s_b;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5,     'lrs C1') RETURNING id INTO s_c_complete;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5,     'lrs C2') RETURNING id INTO s_c_failed;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5,     'lrs E1') RETURNING id INTO s_e_object;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5,     'lrs E2') RETURNING id INTO s_e_garbage;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5,     'lrs E3') RETURNING id INTO s_e_impossible;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5,     'lrs F4') RETURNING id INTO s_f4;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5,     'lrs F5') RETURNING id INTO s_f5;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_okx,     'lrs G')  RETURNING id INTO s_g;

  -- Arm D: a COMPOSITE. api_key_id is NULL — mutually exclusive with the
  -- single-key link — so its venue is reachable ONLY through strategy_keys.
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, NULL, 'lrs D') RETURNING id INTO s_d;
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_d, k_deribit,   uid, CURRENT_DATE - 400, 0);
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_d, k_deribit_b, uid, CURRENT_DATE - 200, 1);

  -- Analytics rows. Series elements are ordered NEWEST-FIRST on purpose: an
  -- implementation that reads the array TAIL instead of taking max() over every
  -- element would read the OLDEST day and fail these arms.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series) VALUES
    (s_a, 'complete_with_warnings', now() - INTERVAL '21 days', jsonb_build_array(
        jsonb_build_object('date', to_char(CURRENT_DATE - 21, 'YYYY-MM-DD'), 'value', 0.004),
        jsonb_build_object('date', to_char(CURRENT_DATE - 22, 'YYYY-MM-DD'), 'value', 0.003),
        jsonb_build_object('date', to_char(CURRENT_DATE - 23, 'YYYY-MM-DD'), 'value', 0.002))),
    (s_b, 'complete_with_warnings', now(), jsonb_build_array(
        jsonb_build_object('date', to_char(CURRENT_DATE - 1, 'YYYY-MM-DD'), 'value', 0.004),
        jsonb_build_object('date', to_char(CURRENT_DATE - 2, 'YYYY-MM-DD'), 'value', 0.003))),
    (s_c_complete, 'complete', now(), jsonb_build_array(
        jsonb_build_object('date', to_char(CURRENT_DATE - 1, 'YYYY-MM-DD'), 'value', 0.004))),
    (s_c_failed, 'complete_with_warnings', now(), jsonb_build_array(
        jsonb_build_object('date', to_char(CURRENT_DATE - 1, 'YYYY-MM-DD'), 'value', 0.004))),
    -- E1: a JSON OBJECT where an array belongs. jsonb_array_elements on a scalar
    -- or object RAISES; the view must normalise it first.
    (s_e_object, 'complete_with_warnings', now(),
        jsonb_build_object('date', to_char(CURRENT_DATE - 1, 'YYYY-MM-DD'), 'value', 0.004)),
    -- E2: well-formed array, element date is not remotely a date.
    (s_e_garbage, 'complete_with_warnings', now(), jsonb_build_array(
        jsonb_build_object('date', 'not-a-date', 'value', 0.004))),
    -- E3: the case a regex-only guard does NOT cover. '2026-02-31' matches
    -- ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ and still raises 22008 on cast.
    (s_e_impossible, 'complete_with_warnings', now(), jsonb_build_array(
        jsonb_build_object('date', '2026-02-31', 'value', 0.004))),
    (s_f4, 'complete_with_warnings', now(), jsonb_build_array(
        jsonb_build_object('date', to_char(CURRENT_DATE - 4, 'YYYY-MM-DD'), 'value', 0.004))),
    (s_f5, 'complete_with_warnings', now(), jsonb_build_array(
        jsonb_build_object('date', to_char(CURRENT_DATE - 5, 'YYYY-MM-DD'), 'value', 0.004))),
    (s_d, 'complete_with_warnings', now(), jsonb_build_array(
        jsonb_build_object('date', to_char(CURRENT_DATE - 36, 'YYYY-MM-DD'), 'value', 0.004))),
    (s_g, 'complete_with_warnings', now(), jsonb_build_array(
        jsonb_build_object('date', to_char(CURRENT_DATE - 1, 'YYYY-MM-DD'), 'value', 0.004)));

  RAISE NOTICE 'Seed OK: uid=%', uid;

  -- ======================================================================
  -- ARM A — the criterion-3 pin. THIS is the arm the phase exists for.
  -- ======================================================================
  SELECT is_stale, stale_reason, last_return_date, days_since_last_return, has_mt5_member
    INTO v_stale, v_reason, v_last, v_days, v_has_mt5
    FROM public.ledger_refresh_staleness WHERE strategy_id = s_a;

  IF v_stale IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (A): 21-day-old mt5 series read is_stale=% (reason=%, last_return_date=%, days=%), expected TRUE', v_stale, v_reason, v_last, v_days;
  END IF;
  IF v_reason IS DISTINCT FROM 'series_behind' THEN
    RAISE EXCEPTION 'TEST FAILED (A): expected stale_reason=series_behind, got % (days=%)', v_reason, v_days;
  END IF;
  IF v_last IS DISTINCT FROM (CURRENT_DATE - 21) THEN
    RAISE EXCEPTION 'TEST FAILED (A): last_return_date=% but the newest element is %; max() over the array is not being taken', v_last, (CURRENT_DATE - 21);
  END IF;
  IF v_has_mt5 IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (A): has_mt5_member=% for an mt5 single-key strategy, expected TRUE', v_has_mt5;
  END IF;

  -- Advance BOTH rejected timestamps. returns_series is NOT touched: no new
  -- analytics data exists, so the verdict must not move by one bit.
  UPDATE strategy_analytics SET computed_at = now() WHERE strategy_id = s_a;
  UPDATE api_keys SET last_sync_at = now() WHERE id = k_mt5;

  SELECT is_stale, stale_reason INTO v_stale2, v_reason2
    FROM public.ledger_refresh_staleness WHERE strategy_id = s_a;

  IF v_stale2 IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (A): advancing strategy_analytics.computed_at and api_keys.last_sync_at flipped is_stale to % without any new analytics data — the verdict is keyed on a timestamp that lies (this is the whole defect)', v_stale2;
  END IF;
  IF v_reason2 IS DISTINCT FROM v_reason THEN
    RAISE EXCEPTION 'TEST FAILED (A): stale_reason moved from % to % after advancing the two rejected timestamps', v_reason, v_reason2;
  END IF;

  -- ======================================================================
  -- ARM B — negative control. Without it, `is_stale => TRUE` passes Arm A.
  -- ======================================================================
  SELECT is_stale, stale_reason INTO v_stale, v_reason
    FROM public.ledger_refresh_staleness WHERE strategy_id = s_b;
  IF v_stale IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (B): a deribit strategy whose newest return is yesterday read is_stale=% (reason=%), expected FALSE', v_stale, v_reason;
  END IF;
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B): a fresh strategy carries stale_reason=%, expected NULL', v_reason;
  END IF;

  -- ======================================================================
  -- ARM C — D-04: the success set is a PAIR, and status is CONJOINED.
  -- ======================================================================
  SELECT is_stale INTO v_stale FROM public.ledger_refresh_staleness WHERE strategy_id = s_c_complete;
  IF v_stale IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (C): fresh strategy at status=complete read is_stale=%, expected FALSE', v_stale;
  END IF;
  SELECT is_stale INTO v_stale FROM public.ledger_refresh_staleness WHERE strategy_id = s_c_failed;
  IF v_stale IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (C): fresh strategy at status=complete_with_warnings read is_stale=%, expected FALSE — a predicate written as status=''complete'' marks every healthy ledger strategy broken', v_stale;
  END IF;

  -- Flip ONLY the status. The series stays fresh and untouched: the fresh-but-failed row.
  UPDATE strategy_analytics SET computation_status = 'failed' WHERE strategy_id = s_c_failed;

  SELECT is_stale, stale_reason, last_return_date INTO v_stale, v_reason, v_last
    FROM public.ledger_refresh_staleness WHERE strategy_id = s_c_failed;
  IF v_stale IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (C): status=failed with a fresh series read is_stale=%, expected TRUE — computation_status is not conjoined into the verdict', v_stale;
  END IF;
  IF v_reason IS DISTINCT FROM 'status_not_success' THEN
    RAISE EXCEPTION 'TEST FAILED (C): expected stale_reason=status_not_success for a failed row, got %', v_reason;
  END IF;
  IF v_last IS DISTINCT FROM (CURRENT_DATE - 1) THEN
    RAISE EXCEPTION 'TEST FAILED (C): the failed row lost its series (last_return_date=%) — a terminal failure must not erase returns_series', v_last;
  END IF;

  -- ======================================================================
  -- ARM D — D-06: the composite is VISIBLE. This is the arm that fails if
  -- someone "simplifies" the view to a single-key join, which would make the
  -- ONLY live deribit strategy invisible in the surface built to observe it.
  -- ======================================================================
  SELECT count(*) INTO v_cnt FROM public.ledger_refresh_staleness WHERE strategy_id = s_d;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (D): the deribit composite returned % rows, expected 1 — a view resolving venue only through strategies.api_key_id is blind to every composite', v_cnt;
  END IF;

  SELECT is_composite, exchanges, is_stale, has_mt5_member
    INTO v_composite, v_exchanges, v_stale, v_has_mt5
    FROM public.ledger_refresh_staleness WHERE strategy_id = s_d;
  IF v_composite IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (D): is_composite=% for a strategy with two strategy_keys members, expected TRUE', v_composite;
  END IF;
  IF NOT ('deribit' = ANY (v_exchanges)) THEN
    RAISE EXCEPTION 'TEST FAILED (D): composite exchanges=% does not contain deribit', v_exchanges;
  END IF;
  IF v_has_mt5 IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (D): has_mt5_member=% for a deribit-only composite, expected FALSE', v_has_mt5;
  END IF;
  IF v_stale IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (D): the 36-day-behind composite read is_stale=%, expected TRUE', v_stale;
  END IF;

  -- ======================================================================
  -- ARM E — T-161.1-04: malformed JSONB must not raise, and must fail STALE.
  -- Reaching these assertions at all proves no exception was thrown: a raise
  -- inside the view would abort this block before the comparison.
  -- ======================================================================
  SELECT is_stale, stale_reason, last_return_date INTO v_stale, v_reason, v_last
    FROM public.ledger_refresh_staleness WHERE strategy_id = s_e_object;
  IF v_stale IS DISTINCT FROM TRUE OR v_last IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (E1): returns_series as a JSON object read is_stale=% last_return_date=% (reason=%), expected TRUE/NULL', v_stale, v_last, v_reason;
  END IF;
  IF v_reason IS DISTINCT FROM 'no_return_date' THEN
    RAISE EXCEPTION 'TEST FAILED (E1): expected stale_reason=no_return_date, got %', v_reason;
  END IF;

  SELECT is_stale, last_return_date INTO v_stale, v_last
    FROM public.ledger_refresh_staleness WHERE strategy_id = s_e_garbage;
  IF v_stale IS DISTINCT FROM TRUE OR v_last IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (E2): a non-date element read is_stale=% last_return_date=%, expected TRUE/NULL', v_stale, v_last;
  END IF;

  SELECT is_stale, last_return_date INTO v_stale, v_last
    FROM public.ledger_refresh_staleness WHERE strategy_id = s_e_impossible;
  IF v_stale IS DISTINCT FROM TRUE OR v_last IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (E3): the impossible date 2026-02-31 read is_stale=% last_return_date=%, expected TRUE/NULL. It matches the four-two-two digit pattern, so a regex-only guard lets it through to a cast that raises 22008', v_stale, v_last;
  END IF;

  -- ======================================================================
  -- ARM F — threshold edges. Pins the 4-day constant on BOTH sides so it
  -- cannot drift silently, in either direction, in either comparison.
  -- ======================================================================
  SELECT is_stale, days_since_last_return INTO v_stale, v_days
    FROM public.ledger_refresh_staleness WHERE strategy_id = s_f4;
  IF v_days IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'TEST FAILED (F): days_since_last_return=% for a 4-day-old series, expected 4', v_days;
  END IF;
  IF v_stale IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (F): a 4-day-old series read is_stale=%, expected FALSE — 4 days is the largest LEGITIMATE age (Friday bar read on the Tuesday after a holiday Monday), so alerting here false-alarms every holiday week', v_stale;
  END IF;

  SELECT is_stale, days_since_last_return INTO v_stale, v_days
    FROM public.ledger_refresh_staleness WHERE strategy_id = s_f5;
  IF v_days IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'TEST FAILED (F): days_since_last_return=% for a 5-day-old series, expected 5', v_days;
  END IF;
  IF v_stale IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (F): a 5-day-old series read is_stale=%, expected TRUE — the threshold has been widened past its derivation', v_stale;
  END IF;

  -- ======================================================================
  -- ARM G — D-05: the cohort is scoped to ledger-backed venues. Without this,
  -- dropping the venue filter entirely would still pass every arm above.
  -- ======================================================================
  SELECT count(*) INTO v_cnt FROM public.ledger_refresh_staleness WHERE strategy_id = s_g;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (G): an okx strategy appears in ledger_refresh_staleness (% rows) — the cohort must be scoped to the ledger-backed venue set', v_cnt;
  END IF;

  -- All ten seeded ledger strategies (everything except the okx one) are visible.
  SELECT count(*) INTO v_cnt FROM public.ledger_refresh_staleness
   WHERE strategy_id IN (s_a, s_b, s_c_complete, s_c_failed, s_d,
                         s_e_object, s_e_garbage, s_e_impossible, s_f4, s_f5);
  IF v_cnt <> 10 THEN
    RAISE EXCEPTION 'TEST FAILED (G): % of 10 seeded ledger-backed strategies are visible in the view', v_cnt;
  END IF;

  -- ======================================================================
  -- ARM H — THE ACL, RE-ASSERTED ON EVERY RUN (161.1-AUDIT F-1).
  --
  -- Every fact below is already checked by migration 20260825120000's STEP 3
  -- DO block. That block runs EXACTLY ONCE, at apply. A later migration, a GRANT
  -- sweep, a role-template change or a restore-from-dump can undo any of it and
  -- nothing would notice. That is not theoretical in this repo:
  -- 20260515130001_enqueue_compute_job_internal_acl_remediation.sql exists
  -- precisely because a REVOKE was lost. This arm is the durable copy — the one
  -- that runs on every CI tick rather than on the single apply.
  --
  -- ⚠️ NOT VACUOUS WHEN THE OBJECT IS GONE. has_table_privilege /
  -- has_function_privilege RAISE (42P01 / 42883) on a missing object rather than
  -- returning FALSE, so "the ACL is clean because there is nothing to grant on"
  -- reddens here instead of passing. MEASURED, not assumed — see the RED runs
  -- recorded for this arm.
  -- ======================================================================
  IF has_table_privilege('anon', 'public.ledger_refresh_staleness', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (H): role anon can SELECT ledger_refresh_staleness. This view joins strategies, api_keys and strategy_analytics across EVERY tenant, so a browser-reachable role holding SELECT is a cross-tenant disclosure (T-161.1-01)';
  END IF;
  IF has_table_privilege('authenticated', 'public.ledger_refresh_staleness', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (H): role authenticated can SELECT ledger_refresh_staleness (cross-tenant read, T-161.1-01)';
  END IF;

  -- security_invoker is the SECOND half of the same guarantee, not a separate
  -- nicety: with it off the view reads its base tables as the OWNER, so any role
  -- that does hold SELECT sees every tenant's rows regardless of the RLS on
  -- strategies / api_keys / strategy_analytics.
  SELECT c.reloptions INTO v_opts
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'ledger_refresh_staleness';
  IF v_opts IS NULL OR NOT ('security_invoker=true' = ANY(v_opts)) THEN
    RAISE EXCEPTION 'TEST FAILED (H): ledger_refresh_staleness is not security_invoker=true (reloptions=%) — it would resolve its base tables as the view OWNER, bypassing strategies/api_keys/strategy_analytics RLS for every role that can query it', v_opts;
  END IF;

  -- The parser carries its own EXECUTE ACL (20260825120000:173-175). Same
  -- once-at-apply problem, same durable copy. It is SECURITY INVOKER and touches
  -- no table, so this is defence in depth rather than a live hole — but an
  -- unasserted REVOKE is exactly the one that gets swept away unnoticed.
  IF has_function_privilege('anon', 'public.ledger_refresh_parse_series_date(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (H): role anon can EXECUTE ledger_refresh_parse_series_date — the REVOKE at 20260825120000:173 has been undone';
  END IF;
  IF has_function_privilege('authenticated', 'public.ledger_refresh_parse_series_date(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (H): role authenticated can EXECUTE ledger_refresh_parse_series_date — the REVOKE at 20260825120000:173 has been undone';
  END IF;

  RAISE NOTICE 'ALL 8 ARMS EXECUTED (A-H) and passed — ledger_refresh_staleness verdict is falsifiable.';
END $$;

ROLLBACK;
