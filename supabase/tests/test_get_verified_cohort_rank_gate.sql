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
-- runs on the PR. So on a pre-migration database the test RAISE NOTICEs and
-- skips the two assertions that genuinely need the gate deployed: (1) the
-- occurrence count, which reads the gate out of the body, and (4) the
-- behavioural delta, which needs the gate to change the cohort.
--   ⭐ THE SKIP IS KEYED ON supabase_migrations.schema_migrations — an
--   applied-ness oracle INDEPENDENT of the function's text — never on the gate
--   predicate itself. Keying it on the predicate would key the skip on the very
--   thing assertion 1 asserts: a whitespace-only re-base would disarm 1 and 4
--   forever (CI stays green — psql does not fail on a NOTICE), and this file's
--   own #1 threat, a CREATE OR REPLACE that DROPS the gate, would take that same
--   skip and exit GREEN. Under the ledger key both of those fall THROUGH to
--   assertion 1 and RAISE. The full both-or-neither state table, and why the
--   ledger-missing/gate-present state is armed rather than skipped, are at the
--   skip block itself.
-- NOTHING ELSE is skipped:
--   * A MISSING FUNCTION is a hard failure (the RPC has existed since
--     20260626120000) — only the un-applied GATE is skippable.
--   * Assertions 2a / 2b / 3 (SECURITY DEFINER, pinned search_path, anon lacks
--     EXECUTE) run ABOVE the skip, unconditionally. 20260626120000 already
--     shipped all three (SECURITY DEFINER and SET search_path = public,
--     pg_catalog on the function, REVOKE ALL ... FROM PUBLIC, anon after it),
--     so they are TRUE on a pre-migration database and are ARMED on the very
--     first CI run of this PR. Keeping them above the skip is belt-and-braces:
--     they are independent of the gate, so nothing about the skip's key —
--     ledger row, predicate text, or a future third form — can reach them.
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
  v_applied     BOOLEAN;  -- migration ledger says 20260821120000 ran here
  v_gate_seen   BOOLEAN;  -- the deployed BODY carries the gate predicate

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

  -- The migration that introduces the gate. This is the INDEPENDENT
  -- applied-ness oracle the skip is keyed on — see the skip block below for
  -- why it is not keyed on v_gate_pred.
  v_migration   CONSTANT TEXT := '20260821120000';
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
  --   * Anything placed BELOW the skip stops asserting whenever the skip fires,
  --     and a skip is only ever as honest as its key. These three do not depend
  --     on that key at all, so they are placed where no future change to it —
  --     the original predicate-text form, today's migration-ledger form, or
  --     whatever replaces it — can silently take them out of service.
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
  --
  -- ⭐ THE SKIP IS KEYED ON THE MIGRATION LEDGER, NOT ON THE GATE PREDICATE.
  -- Keying it on `position(v_gate_pred IN v_def) = 0` — the obvious form, and
  -- the one this file shipped first — keys the skip on THE VERY THING
  -- ASSERTION 1 ASSERTS, and self-disarms in both directions:
  --   (a) a whitespace-only re-base (`IN ('complete','complete_with_warnings')`
  --       without the space, or the predicate wrapped across lines) makes the
  --       byte match fail on a database that HAS the gate → assertions 1 and 4
  --       skip forever, silently, and psql does not fail on a NOTICE;
  --   (b) THE FILE'S OWN #1 THREAT — a future CREATE OR REPLACE that DROPS the
  --       gate — is byte-indistinguishable from (a) and would exit GREEN
  --       through this same skip, which is the exact regression this file
  --       exists to catch.
  -- `supabase_migrations.schema_migrations` is independent of the function's
  -- text: it records that 20260821120000 was APPLIED, whatever its body now
  -- says. A database that HAS the migration but whose body LACKS the predicate
  -- therefore falls THROUGH to assertion 1 and RAISEs, in both (a) and (b).
  --
  -- BOTH OR NEITHER (the sibling coherence-check pattern —
  -- test_wizard_session_idempotency.sql §3f, test_api_keys_venue_identity_uniq.sql):
  -- the gate's PRESENCE is still read, but only to NARROW the skip, never to
  -- cause one. The four states:
  --     ledger ✓ / body ✓ → ARMED (the post-merge steady state)
  --     ledger ✓ / body ✗ → ARMED → assertion 1 RAISEs. The fix, cases (a)+(b).
  --     ledger ✗ / body ✗ → SKIP. The ONLY skippable state: the coherent
  --                          pre-migration database this PR's CI runs against.
  --     ledger ✗ / body ✓ → ARMED, deliberately NOT a skip and NOT an
  --                          exception. The gate is demonstrably deployed, so
  --                          both assertions are meaningful and are run; only
  --                          the ledger ROW is missing, which is what an
  --                          MCP `apply_migration` (it stamps now(), not the
  --                          filename prefix) leaves behind. Skipping there
  --                          would be a silent green; RAISEing there would red
  --                          CI for a database that is functionally correct.
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (0b): supabase_migrations.schema_migrations does not exist, so this file cannot tell a pre-migration database from one whose gate was dropped. That ledger is the skip''s independent applied-ness oracle; without it the only remaining key would be the gate predicate itself, which is what assertion 1 asserts. Run this file against the Supabase-managed TEST project (TEST_SUPABASE_DB_URL), never a bare Postgres.';
  END IF;
  v_applied := EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = v_migration
  );
  v_gate_seen := position(v_gate_pred IN v_def) > 0;

  IF NOT v_applied AND NOT v_gate_seen THEN
    RAISE NOTICE 'test_get_verified_cohort_rank_gate: PARTIAL — assertions 2a/2b/3 (SECURITY DEFINER, pinned search_path, anon lacks EXECUTE) ran ARMED and passed. Assertions 1 (gate occurrence count) and 4 (behavioural) are SKIPPED: migration % has no row in supabase_migrations.schema_migrations AND the deployed get_verified_cohort_rank does not carry the RANK-01 computed-analytics gate — the coherent pre-migration state, which is where the shared TEST project sits until this PR merges. This is NOT a full pass: neither gate assertion has been evaluated. Note the polarity — a database that HAS the migration but LOST the gate does NOT reach here; it falls through and assertion 1 fails.', v_migration;
    RETURN;
  END IF;

  -- ============ ARMED FROM HERE (gate-dependent assertions) ===============

  -- (1) ⭐ the gate is in BOTH cohort predicates, not just one
  v_gate_hits := (length(v_def) - length(replace(v_def, v_gate_pred, '')))
                 / length(v_gate_pred);
  IF v_gate_hits < 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1): the RANK-01 gate appears % time(s) in get_verified_cohort_rank, expected at least 2 (the count query AND the rank query). Gating only one predicate makes the min-N denominator diverge from the rank population — the defect class this gate exists to prevent. TWO causes produce a count of ZERO here and this assertion cannot distinguish them, so check both: (i) a CREATE OR REPLACE dropped the gate — the real regression; (ii) a re-base only REFORMATTED the predicate (a removed space, a line wrap), in which case the deployed body is correct and this file''s v_gate_pred constant must be re-cut to the new byte text IN THE SAME COMMIT. Before the skip was re-keyed on the migration ledger, BOTH of these silently skipped instead of failing.', v_gate_hits;
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
