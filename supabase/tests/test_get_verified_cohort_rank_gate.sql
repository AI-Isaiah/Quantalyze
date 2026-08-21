-- Recurring CI regression gate for the Phase 159 / RANK-01 computed-analytics
-- cohort gate on get_verified_cohort_rank
-- (20260821120000_get_verified_cohort_rank_computed_gate.sql).
--
-- Why this file exists
-- --------------------
-- get_verified_cohort_rank has had ZERO CI-executed tests since it shipped in
-- phase 42. Its only coverage is src/__tests__/verified-cohort-rank-rls.test.ts,
-- a HAS_LIVE_DB vitest that NEVER runs in CI (reference_db_test_ci_wiring:
-- "*_live.py + skipIf vitest NEVER run in CI"), and the self-verify DO blocks in
-- its two migrations — and a migration DO block runs ONCE, at apply time, never
-- again. So a future CREATE OR REPLACE that dropped the cohort gate, the
-- SECURITY DEFINER flag, the search_path pin or the anon REVOKE would be caught
-- by NO recurring gate. This file is that gate, and it is the RPC's first.
--
-- WHAT IS PINNED
--   1. ⭐ The RANK-01 gate appears in the deployed body at least TWICE — the
--      count query (min-N denominator) AND the rank query (numerator). An
--      occurrence COUNT, not a presence check: a re-base gating only the count
--      query keeps a presence check green while reintroducing the exact
--      denominator/numerator divergence the gate exists to prevent.
--   2. SECURITY DEFINER survives, and search_path is still pinned (a SECDEF
--      function without a pinned search_path is a hijack surface, T-42-03).
--   3. anon does NOT hold EXECUTE (T-42-02 probe-oracle containment). Note this
--      is the OPPOSITE polarity from the public trust-signal SECDEF, which
--      REQUIRES anon EXECUTE — this one is authenticated-only by design.
--   4. BEHAVIOURAL: a complete_with_warnings row JOINS the cohort and a
--      failed-with-KPIs row does NOT — the fossil class 159-CENSUS.md measured
--      in PROD (17 of 18 published strategies carried a `failed` analytics row
--      that still held sharpe and cagr).
--
-- ANTI-VACUITY on assertion 4 — the load-bearing part. Asserting only "the
-- failed row is excluded" would pass even if it were excluded for some
-- UNRELATED reason (a missing verification row, a null metric, a typo'd
-- strategy id). So the test flips that SAME row's computation_status to
-- 'complete' and asserts the cohort count then rises by one more. The row is
-- proven cohort-eligible in every respect EXCEPT its status, which makes the
-- status the only possible cause of its exclusion. Without that second arm the
-- assertion would be a coincidence dressed as a control.
--
-- STATE-ADAPTIVE (Phase 156 precedent) — BUT AS NARROWLY AS POSSIBLE. The shared
-- TEST database receives this migration only AFTER the PR merges, but this test
-- runs on the PR. So the test reads pg_get_functiondef and, on a pre-migration
-- database, RAISE NOTICEs and skips the two assertions that genuinely need the
-- gate deployed: (1) the occurrence count, which reads the gate out of the body,
-- and (4) the behavioural delta, which needs the gate to change the cohort.
-- NOTHING ELSE is skipped:
--   * A MISSING FUNCTION is a hard failure (the RPC has existed since
--     20260626120000) — only the un-applied GATE is skippable.
--   * Assertions 2a / 2b / 3 (SECURITY DEFINER, pinned search_path, anon lacks
--     EXECUTE) run ABOVE the skip, unconditionally. 20260626120000 already
--     shipped all three (SECURITY DEFINER and SET search_path = public,
--     pg_catalog on the function, REVOKE ALL ... FROM PUBLIC, anon after it),
--     so they are TRUE on a pre-migration database and are ARMED on the very
--     first CI run of this PR. The reason is structural, not stylistic: the skip
--     is keyed on the gate predicate's EXACT text, so a formatting-only re-base
--     of the migration (a line-wrap, a space after the comma) trips the skip —
--     and anything sitting below it would then stop asserting SILENTLY, which
--     is strictly worse than having no assertion at all.
--   ⚠️ Consequence, stated honestly: until the first CI run AFTER this migration
--   reaches TEST, assertions 1 and 4 have never been observed ARMED and green.
--   For those two the correct phrasing is "would have caught", never "did
--   catch". Assertions 2a/2b/3 carry no such caveat — they execute every run.
--
-- SHARED-TEST DISCIPLINE. Every write is scoped to rows this file itself seeds
-- under a unique email, and the whole run is wrapped in a transaction that ends
-- in ROLLBACK — no committed fixture rows, no table-wide UPDATEs. The
-- transaction is REPEATABLE READ on purpose: assertion 4 compares a cohort
-- count BEFORE and AFTER seeding, and under READ COMMITTED a concurrent CI run
-- committing a published+verified strategy between the two reads would flake the
-- delta. A REPEATABLE READ snapshot makes the delta attributable to this test's
-- own writes and nothing else.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block with RAISE
-- EXCEPTION on failure / RAISE NOTICE on pass, mirroring the sibling
-- supabase/tests/test_*.sql files. No psql backslash meta-commands. Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_get_verified_cohort_rank_gate.sql

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- ON DELETE CASCADE chains auth.users -> profiles -> strategies -> analytics.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email = 'test-mig159-cohort-gate@quantalyze.test';

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;

DO $$
DECLARE
  v_fn_oid      OID;
  v_def         TEXT;
  v_gate_hits   INT;
  v_secdef      BOOLEAN;
  v_config      TEXT[];
  v_anon_exec   BOOLEAN;

  uid           UUID := gen_random_uuid();
  strat_warned  UUID;  -- complete_with_warnings  → MUST join the cohort
  strat_fossil  UUID;  -- failed, but HOLDS KPIs  → MUST NOT join the cohort
  n_before      INT;
  n_after       INT;
  n_unfossiled  INT;

  -- The gate predicate exactly as the migration writes it. Dollar-quoted so the
  -- single quotes need no escaping. Deliberately the FULL predicate rather than
  -- the bare status word: a loose match would also count this file's own prose
  -- and the function's body comments, inflating the occurrence count into a
  -- vacuous pass.
  v_gate_pred   CONSTANT TEXT :=
    $pred$a.computation_status IN ('complete', 'complete_with_warnings')$pred$;
BEGIN
  -- ----- Resolve the function (absence = hard failure, not a skip) ----------
  SELECT p.oid INTO v_fn_oid
    FROM pg_proc p
    WHERE p.proname = 'get_verified_cohort_rank'
      AND p.pronamespace = 'public'::regnamespace
      AND pg_get_function_identity_arguments(p.oid) =
          'p_sharpe double precision, p_sortino double precision, p_max_dd double precision';
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (0): get_verified_cohort_rank(double precision, double precision, double precision) is not registered. This RPC has existed since migration 20260626120000 — its absence is a real regression, never a skippable state.';
  END IF;

  -- ================== UNCONDITIONAL ASSERTIONS (2a, 2b, 3) =================
  -- These three run on EVERY execution, pre-migration database included, and
  -- are deliberately ABOVE the state-adaptive skip:
  --   * They do not depend on the RANK-01 gate. Migration 20260626120000 — the
  --     ONLY prior definition of this function — already declared SECURITY
  --     DEFINER and SET search_path = public, pg_catalog, and REVOKEd ALL from
  --     PUBLIC, anon; its own DO block asserted the SECDEF flag and the anon
  --     revoke at apply time. So all three invariants hold on a database that
  --     has not yet received 20260821120000.
  --   * The skip below is keyed on the gate predicate's EXACT text. Anything
  --     placed after it stops asserting SILENTLY the moment a formatting-only
  --     re-base changes that text — a test that quietly stops testing. These
  --     three have no reason to be exposed to that, so they are not.
  -- The assertion NUMBERS are kept as-is (2a, 2b and 3 now execute before 1 and
  -- 4): the number is part of each failure message's identity, which CI logs
  -- carry and reviewers grep for. Execution order changed; the labels did not.

  -- (2) SECURITY DEFINER + pinned search_path are intact
  SELECT prosecdef, proconfig INTO v_secdef, v_config
    FROM pg_proc WHERE oid = v_fn_oid;
  IF NOT COALESCE(v_secdef, false) THEN
    RAISE EXCEPTION 'TEST FAILED (2a): get_verified_cohort_rank is no longer SECURITY DEFINER — the cross-tenant verified read it exists to perform would now fail under RLS, or worse, silently return a caller-scoped cohort.';
  END IF;
  IF v_config IS NULL OR NOT (v_config @> ARRAY['search_path=public, pg_catalog']) THEN
    RAISE EXCEPTION 'TEST FAILED (2b): get_verified_cohort_rank lost its pinned search_path (proconfig=%). A SECURITY DEFINER function without one is a search-path hijack surface (T-42-03).', v_config;
  END IF;

  -- (3) anon must NOT hold EXECUTE (probe-oracle containment, T-42-02)
  v_anon_exec := has_function_privilege('anon', v_fn_oid, 'EXECUTE');
  IF v_anon_exec THEN
    RAISE EXCEPTION 'TEST FAILED (3): anon holds EXECUTE on get_verified_cohort_rank. This SECDEF bypasses RLS over the whole verified universe; anon access re-opens the percentile probe oracle the min-N floor and decile quantization exist to contain.';
  END IF;

  v_def := pg_get_functiondef(v_fn_oid);

  -- ----- STATE ADAPTATION: pre-migration database → skip, by design ---------
  -- Only assertions 1 and 4 sit below this line, and both genuinely require the
  -- migration to be deployed: 1 reads the gate out of the deployed body, 4
  -- needs the gate to be what changes the cohort.
  IF position(v_gate_pred IN v_def) = 0 THEN
    RAISE NOTICE 'test_get_verified_cohort_rank_gate: PARTIAL — assertions 2a/2b/3 (SECURITY DEFINER, pinned search_path, anon lacks EXECUTE) ran ARMED and passed. Assertions 1 (gate occurrence count) and 4 (behavioural) are SKIPPED: the deployed get_verified_cohort_rank does not yet carry the RANK-01 computed-analytics gate. This database predates migration 20260821120000; the shared TEST project receives it only after merge. This is the designed pre-migration state, NOT a full pass: neither gate assertion has been evaluated.';
    RETURN;
  END IF;

  -- ============ ARMED FROM HERE (gate-dependent assertions) ===============

  -- (1) ⭐ the gate is in BOTH cohort predicates, not just one
  v_gate_hits := (length(v_def) - length(replace(v_def, v_gate_pred, '')))
                 / length(v_gate_pred);
  IF v_gate_hits < 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1): the RANK-01 gate appears % time(s) in get_verified_cohort_rank, expected at least 2 (the count query AND the rank query). Gating only one predicate makes the min-N denominator diverge from the rank population — the defect class this gate exists to prevent.', v_gate_hits;
  END IF;

  -- ----- (4) BEHAVIOURAL: seed a synthetic cohort --------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'test-mig159-cohort-gate@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'mig159 cohort-gate owner', 'test-mig159-cohort-gate@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO strategies (user_id, name, status, source, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid, 'mig159 warned', 'published', 'csv', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_warned;

  INSERT INTO strategies (user_id, name, status, source, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid, 'mig159 fossil', 'published', 'csv', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_fossil;

  -- Both are verified at the TERMINAL published state, so "verified" is held
  -- constant across the pair.
  INSERT INTO strategy_verifications (strategy_id, wizard_session_id, status, trust_tier, flow_type, source)
  VALUES
    (strat_warned, gen_random_uuid(), 'published', 'api_verified', 'csv', 'csv'),
    (strat_fossil, gen_random_uuid(), 'published', 'api_verified', 'csv', 'csv');

  -- Authenticate as the seeded owner: the RPC's in-function guard rejects
  -- auth.uid() IS NULL, so an unauthenticated psql session cannot call it.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', uid::text, 'role', 'authenticated')::text,
                     true);

  -- Baseline BEFORE any analytics row exists. Under REPEATABLE READ this
  -- snapshot is stable, so every later delta is attributable to our own writes.
  SELECT cohort_n INTO n_before
    FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);

  -- The two analytics rows are IDENTICAL except for computation_status. Every
  -- other cohort predicate (published, verified, three non-null metrics) is
  -- satisfied by BOTH, so status is the only variable in the experiment.
  INSERT INTO strategy_analytics (strategy_id, computation_status, sharpe, sortino, max_drawdown)
  VALUES
    (strat_warned, 'complete_with_warnings', 1.5, 2.0, -0.10),
    (strat_fossil, 'failed',                 1.5, 2.0, -0.10);

  SELECT cohort_n INTO n_after
    FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);

  -- (4a) exactly ONE of the two joined: the warned row in, the fossil out.
  IF n_after <> n_before + 1 THEN
    RAISE EXCEPTION 'TEST FAILED (4a): cohort_n went % -> % after seeding one complete_with_warnings row and one failed-with-KPIs row; expected exactly +1. Either the terminal-success gate wrongly dropped complete_with_warnings (a warned-but-valid strategy would vanish from public ranking), or it admitted the failed row (dead KPIs ranking against live ones — the RANK-01 defect).', n_before, n_after;
  END IF;

  -- (4b) ⭐ ANTI-VACUITY: the fossil row was excluded BY ITS STATUS and nothing
  -- else. Flip only that column and it must join. If (4a) passed because the
  -- row was malformed in some unrelated way, this arm fails and the coincidence
  -- is exposed. Scoped to one seeded id — never a table-wide UPDATE.
  UPDATE strategy_analytics
     SET computation_status = 'complete'
   WHERE strategy_id = strat_fossil;

  SELECT cohort_n INTO n_unfossiled
    FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);

  IF n_unfossiled <> n_before + 2 THEN
    RAISE EXCEPTION 'TEST FAILED (4b): after flipping ONLY computation_status failed -> complete on the fossil row, cohort_n is % (expected % = baseline + 2). The row is therefore excluded by something OTHER than its computation status, which means assertion 4a proved nothing about the gate.', n_unfossiled, n_before + 2;
  END IF;

  RAISE NOTICE 'test_get_verified_cohort_rank_gate: ALL PASS (ARMED) — gate present in % cohort predicates, SECURITY DEFINER + search_path pinned, anon lacks EXECUTE, complete_with_warnings joins the cohort and a failed-with-KPIs row does not (proven causal by the status flip).', v_gate_hits;
END
$$;

ROLLBACK;
