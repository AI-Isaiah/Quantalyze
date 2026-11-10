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
-- ⛔ AN UNDEPLOYED GATE IS A HARD FAILURE, NEVER A SKIP (F8, 2026-08-25)
-- ----------------------------------------------------------------------
-- This file used to be STATE-ADAPTIVE. On a database where migration
-- 20260821120000 had no ledger row AND the deployed body carried no gate, it
-- printed a RAISE NOTICE and RETURNed, withholding assertion 1 (the gate
-- occurrence count) and assertion 4 (the behavioural delta) — that is, BOTH
-- assertions the file was written to make. That bail-out is removed. MEASURED,
-- not assumed:
--   * It exited 0. The CI step (.github/workflows/ci.yml, `sql-tests`) reads
--     psql's exit code, so a run that proved nothing about the RANK-01 gate was
--     byte-identical to one that proved it, in the only channel anything
--     mechanical reads.
--   * Its notice read '... are SKIPPED:', NOT the `SKIP:` label. The anti-skip
--     grep in that same step is `grep -aE 'NOTICE: +SKIP:'`, which does NOT
--     match that string; neither does the narrow-partial-skip pattern beside
--     it. The one mechanism built to catch this exact shape was blind to it.
--   * The file declared no 'ALL N ARMS EXECUTED' sentinel, so CI's sentinel
--     loop passed over it entirely. An operator reading "no whole-file skips,
--     N completion sentinel(s) verified" concluded the ranking gate was
--     enforced. It was not, and had never once run.
--   * The skip could not re-arm itself. The `sql-tests` job has NO
--     migration-apply step, and supabase-migrate.yml applies migrations to the
--     PRODUCTION project only. Nothing puts supabase/migrations/** on the TEST
--     project, so "the assertions arm once TEST catches up" named a mechanism
--     that DOES NOT EXIST.
-- The consequence is deliberate and IS the forcing function: this file is RED
-- until 20260821120000 is applied to the TEST project. get_verified_cohort_rank
-- is a SECURITY DEFINER cross-tenant read over the entire published universe,
-- and assertions 1 and 4 are its only recurring executed coverage.
--
-- NOTHING is skipped now. All eighteen assertions (1, 2a, 2b, 3, 4a, 4b, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18)
-- execute on every run (arms 7-14 are the Phase 194 D-15 cohort record gate and arms 12 and 15-18 its
-- Phase 194.2 D-01 unreadable-date rule, see below),
-- and the file ends in an 'ALL 18 ARMS EXECUTED (1, 2a, 2b, 3, 4a, 4b, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18)'
-- sentinel so that an arm neutered in place — deleted, renumbered or
-- short-circuited — cannot exit 0 unnoticed. Keep the roster in that notice: as
-- of 2026-08-25 `sql-tests` in .github/workflows/ci.yml counts its entries and
-- fails the job when they disagree with N, so dropping an assertion costs two
-- edits in one string rather than one silent decrement. (The three 0/0b/0c
-- precondition assertions are deliberately NOT arms and are not in the roster —
-- they establish that the arms below can be evaluated at all.)
--   * A MISSING FUNCTION is a hard failure (assertion 0): the RPC has existed
--     since 20260626120000.
--   * An UNDEPLOYED GATE is a hard failure (assertion 0c), which is where the
--     skip used to be. The migration ledger is still read there, but only to
--     name the likelier cause in the failure message.
--   ⚠️ Honest phrasing: until the first CI run AFTER 20260821120000 reaches
--   TEST, assertions 1 and 4 have never been observed ARMED and green. For
--   those two say "would have caught", never "did catch". Assertions 2a/2b/3
--   carry no such caveat — they execute every run.
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
-- ⭐ ARMS 7-12 — THE D-15 COHORT RECORD GATE (Phase 194 FIGURETRUTH, plan 20)
-- 20261107140000 leaves out of the peer cohort every strategy whose TOTAL record
-- determinably fails D-15's minimum, in the count query AND the rank query. Without arms,
-- that predicate could be deleted from either query and nothing would go red. 7: the count
-- query leaves out a crypto 60-day row. 8: the crypto boundary (90 daily returns stay, 89 leave).
-- 9: the rank query leaves out short rows (a hand-computed decile over the kept rows only).
-- 10: the non-crypto boundary (60 observations stays, 59 leaves, the stored count deciding
-- over the span). 11: the A-194-D15-02 fallback (no stored count -> the span decides).
-- 12: an impossible calendar date (2026-02-31) in any of the three record dates must not
-- fail the RPC, and (Phase 194.2 D-01, 20261110120000) the row LEAVES the annualised cohort,
-- because a present date that is not a real day is unreadable, as it is in TS figureRecord.
-- Each arm carries a RED-UNDER that the runner proved bites its own arm.
-- ⭐ ARMS 15-18 — THE D-01 UNREADABLE-DATE RULE (Phase 194.2 FIGURERESIDUALS, plan 03)
-- 20261110120000 adds one leading arm to the record predicate: a first returns_series date, a last
-- one or data_quality_flags.headline_since that is PRESENT but not a real calendar day leaves the
-- annualised cohort (an ABSENT date keeps the null rule: the row stays). 15: a malformed FIRST date.
-- 16: a malformed LAST date. 17: a malformed headline_since. 18: the arm precedes the observation
-- arm, so a non-crypto row whose stored count clears is still out when a record date is unreadable
-- (TS withholds such a record too). Each carries an anti-vacuity flip (repair only the date and the
-- row joins). 15 and 16 also hold an ABSENT-date contrast (NULL and empty text stay in).
-- D-18 (FOUNDER-DECIDED 2026-11-07, review WR-02): a short record leaves the annualised peer sets
-- (Sharpe, Sortino) ONLY and stays in the Max DD set. Arm 9's oracle is Sharpe and Sortino over the
-- kept rows and Max DD over every row. 13: the min-N floor applies per rank (a Max DD set of 20 ranks
-- while the annualised set of 10 does not), cohort_n being the annualised cohort. 14: the Max DD decile
-- counts the short rows. 7, 8, 10, 11 and 12 read cohort_n, the annualised cohort, and stand.
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
--
-- ⭐ RED-UNDER ANNOTATIONS (Phase 164.4). Each assertion below carries a prose
-- `RED-UNDER:` naming the smallest production change that makes it fail, and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE it reds on its own arm, then restores
-- GREEN. Schema: scripts/mutation-runner/GRAMMAR.md. The line below declares
-- what the lane applies before this gate.
-- ⚠️ THE OBJECT UNDER TEST IS THE REAL SECDEF, in its NEWEST definition: the lane
-- applies 20260821120000, then 20261107140000 (the Phase 194 D-15 re-base) and then
-- 20261110120000 (the Phase 194.2 D-01 re-base, which replaces the whole body), so every
-- mutation below targets 20261110120000. A mutation of an older file alone would be
-- overwritten by the later CREATE OR REPLACE and could never bite. Arm 0 renames a
-- parameter, which CREATE OR REPLACE refuses over an existing definition (42P13), so it
-- renames in all three files. The newest migration SELF-VERIFIES its
-- own identity args, its SECDEF flag, its gate occurrence count and its record-predicate
-- count at apply time. Several twins are therefore LAYERED: the second step removes the
-- migration's own verification term so the GATE reds rather than the apply — never to
-- widen the mutation, only to let it reach the gate.
-- 20260825120000 is in the list because the record predicate calls
-- public.ledger_refresh_parse_series_date (defined there); without it the first RPC call
-- fails 42883. Its own dependencies (compute_jobs queue, strategy_keys, stitch composite)
-- precede it, in the order test_ledger_refresh_staleness.sql applies them.
-- Fixtures 27 (strategy_analytics.metrics_json) and 42 (strategies.asset_class) declare the
-- columns the record predicate reads.
-- 19-fixture-cohort-rank-metrics.sql adds only sharpe/sortino/max_drawdown,
-- whose values come entirely from this file's own seeds.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/09-fixture-migration-ledger.sql","scripts/pg-lane/fixtures/13-fixture-csv-finalize-fold.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/19-fixture-cohort-rank-metrics.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","scripts/pg-lane/fixtures/42-fixture-strategies-asset-class.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql","supabase/migrations/20260821120000_get_verified_cohort_rank_computed_gate.sql","supabase/migrations/20261107140000_get_verified_cohort_rank_span_gate.sql","supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql"]}

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- ON DELETE CASCADE chains auth.users -> profiles -> strategies -> analytics.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email = 'test-mig159-cohort-gate@quantalyze.test';

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;

-- Seeding helpers for arms 7-12 (Phase 194 plan 20). pg_temp, so nothing outlives the session and
-- nothing is visible to another one. They write only rows this file creates, and cr_retire is
-- bound to the ids it is handed.
--
-- cr_series: a two-element returns_series where only the FIRST and LAST dates matter to the
-- cohort predicate; `return` is a placeholder.
CREATE FUNCTION pg_temp.cr_series(p_first TEXT, p_last TEXT) RETURNS JSONB
  LANGUAGE sql IMMUTABLE AS $f$
    SELECT jsonb_build_array(jsonb_build_object('date', p_first, 'return', 0.01),
                             jsonb_build_object('date', p_last,  'return', 0.01))
  $f$;

-- cr_seed: one published strategy with a published verification and a COMPLETE analytics row,
-- so every cohort predicate except the D-15 record one is satisfied. asset_class is always
-- explicit. p_headline lands in data_quality_flags.headline_since; p_obs lands in
-- metrics_json.record_observations. NULL for either leaves the key out entirely.
CREATE FUNCTION pg_temp.cr_seed(p_uid UUID, p_tag TEXT, p_class TEXT, p_first TEXT, p_last TEXT,
                                p_headline TEXT, p_obs INT, p_sharpe DOUBLE PRECISION,
                                p_sortino DOUBLE PRECISION DEFAULT 2.0,
                                p_dd DOUBLE PRECISION DEFAULT -0.10) RETURNS UUID
  LANGUAGE plpgsql AS $f$
DECLARE
  v_id      UUID;
  v_flags   JSONB;
  v_metrics JSONB;
BEGIN
  IF p_headline IS NOT NULL THEN
    v_flags := jsonb_build_object('headline_since', p_headline);
  END IF;
  IF p_obs IS NOT NULL THEN
    v_metrics := jsonb_build_object('record_observations', p_obs);
  END IF;

  INSERT INTO strategies (user_id, name, status, source, strategy_types, subtypes, markets,
                          supported_exchanges, asset_class)
  VALUES (p_uid, 'mig194 cohort record ' || p_tag, 'published', 'csv', '{}', '{}', '{}',
          ARRAY['binance'], p_class)
  RETURNING id INTO v_id;

  INSERT INTO strategy_verifications (strategy_id, wizard_session_id, status, trust_tier, flow_type, source)
  VALUES (v_id, gen_random_uuid(), 'published', 'api_verified', 'csv', 'csv');

  INSERT INTO strategy_analytics (strategy_id, computation_status, sharpe, sortino, max_drawdown,
                                  returns_series, data_quality_flags, metrics_json)
  VALUES (v_id, 'complete', p_sharpe, p_sortino, p_dd,
          pg_temp.cr_series(p_first, p_last), v_flags, v_metrics);
  RETURN v_id;
END
$f$;

-- cr_retire: take the given strategies out of the cohort by failing their analytics row. Bound
-- to the ids passed in, never table-wide (shared-TEST discipline).
CREATE FUNCTION pg_temp.cr_retire(p_ids UUID[]) RETURNS VOID
  LANGUAGE plpgsql AS $f$
BEGIN
  UPDATE strategy_analytics
     SET computation_status = 'failed'
   WHERE strategy_id = ANY (p_ids);
END
$f$;

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

  -- Arms 7-12 (Phase 194 plan 20).
  v_d0          CONSTANT DATE := DATE '2026-01-01';  -- fixed, so every seeded date is reproducible
  v_seeded      UUID[] := '{}';  -- the rows the current arm seeded; retired by id, never table-wide
  v_short       UUID[] := '{}';  -- arm 13/14: the short-record rows among them
  v_id          UUID;
  v_id2         UUID;
  n_base        INT;
  n_a           INT;
  n_b           INT;
  n_c           INT;
  r             RECORD;
  i             INT;

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
  -- RED-UNDER: rename the third parameter — `p_max_dd` becomes `p_maxdd` in
  --            20260821120000's CREATE (and at its one use in the max_dd
  --            percentile filter). PostgREST callers pass this RPC's arguments
  --            BY NAME, so a rename is a live break, and this probe pins the
  --            identity args rather than the bare name for exactly that reason.
  --            LAYERED: the migration's own post-verify (a) compares the same
  --            identity-args string, so the third step re-cuts THAT string and
  --            nothing else.
  -- RED-UNDER-M: {"arm":"0","apply":[{"kind":"edit","file":"supabase/migrations/20260821120000_get_verified_cohort_rank_computed_gate.sql","find":"  p_max_dd   DOUBLE PRECISION   -- the MAGNITUDE (abs) of the blend's max_dd","replace":"  p_maxdd    DOUBLE PRECISION   -- the MAGNITUDE (abs) of the blend's max_dd","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260821120000_get_verified_cohort_rank_computed_gate.sql","find":"abs(a.max_drawdown) <= p_max_dd)","replace":"abs(a.max_drawdown) <= p_maxdd)","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260821120000_get_verified_cohort_rank_computed_gate.sql","find":"          'p_sharpe double precision, p_sortino double precision, p_max_dd double precision';","replace":"          'p_sharpe double precision, p_sortino double precision, p_maxdd double precision';","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261107140000_get_verified_cohort_rank_span_gate.sql","find":"  p_max_dd   DOUBLE PRECISION   -- the MAGNITUDE (abs) of the blend's max_dd","replace":"  p_maxdd    DOUBLE PRECISION   -- the MAGNITUDE (abs) of the blend's max_dd","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"  p_max_dd   DOUBLE PRECISION   -- the MAGNITUDE (abs) of the blend's max_dd","replace":"  p_maxdd    DOUBLE PRECISION   -- the MAGNITUDE (abs) of the blend's max_dd","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261107140000_get_verified_cohort_rank_span_gate.sql","find":"abs(a.max_drawdown) <= p_max_dd)","replace":"abs(a.max_drawdown) <= p_maxdd)","occurrences":2},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"abs(a.max_drawdown) <= p_max_dd)","replace":"abs(a.max_drawdown) <= p_maxdd)","occurrences":2},{"kind":"edit","file":"supabase/migrations/20261107140000_get_verified_cohort_rank_span_gate.sql","find":"abs(a.max_drawdown) <= p_max_dd)","replace":"abs(a.max_drawdown) <= p_maxdd)","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"abs(a.max_drawdown) <= p_max_dd)","replace":"abs(a.max_drawdown) <= p_maxdd)","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261107140000_get_verified_cohort_rank_span_gate.sql","find":"          'p_sharpe double precision, p_sortino double precision, p_max_dd double precision';","replace":"          'p_sharpe double precision, p_sortino double precision, p_maxdd double precision';","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"          'p_sharpe double precision, p_sortino double precision, p_max_dd double precision';","replace":"          'p_sharpe double precision, p_sortino double precision, p_maxdd double precision';","occurrences":1}]}
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
  -- are deliberately FIRST, above the applied-ness assertion (0c):
  --   * They do not depend on the RANK-01 gate. Migration 20260626120000 — the
  --     ONLY prior definition of this function — already declared SECURITY
  --     DEFINER and SET search_path = public, pg_catalog, and REVOKEd ALL from
  --     PUBLIC, anon; its own DO block asserted the SECDEF flag and the anon
  --     revoke at apply time. So all three invariants hold on a database that
  --     has not yet received 20260821120000.
  --   * Ordering them first means they are evaluated even on the runs where 0c
  --     RAISEs, and no future change to 0c's applied-ness key can move them out
  --     of service.
  -- The assertion NUMBERS are kept as-is (2a, 2b and 3 execute before 1 and 4):
  -- the number is part of each failure message's identity, which CI logs carry
  -- and reviewers grep for. Execution order changed; the labels did not.

  -- (2) SECURITY DEFINER + pinned search_path are intact
  -- RED-UNDER: drop `SECURITY DEFINER` from 20260821120000's CREATE. Without
  --            it the cross-tenant verified read runs as the CALLER, so
  --            strategy_verifications RLS silently narrows the cohort to the
  --            caller's own strategies — a wrong ranking, not an error.
  --            LAYERED: the migration's post-verify (b) asserts the flag, so the
  --            second step removes THAT term only.
  -- RED-UNDER-M: {"arm":"2a","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"LANGUAGE plpgsql\nSECURITY DEFINER\nSET search_path = public, pg_catalog","replace":"LANGUAGE plpgsql\nSET search_path = public, pg_catalog","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"  IF NOT COALESCE(v_secdef, false) THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  SELECT prosecdef, proconfig INTO v_secdef, v_config
    FROM pg_proc WHERE oid = v_fn_oid;
  IF NOT COALESCE(v_secdef, false) THEN
    RAISE EXCEPTION 'TEST FAILED (2a): get_verified_cohort_rank is no longer SECURITY DEFINER — the cross-tenant verified read it exists to perform would now fail under RLS, or worse, silently return a caller-scoped cohort.';
  END IF;
  IF v_config IS NULL OR NOT (v_config @> ARRAY['search_path=public, pg_catalog']) THEN
    RAISE EXCEPTION 'TEST FAILED (2b): get_verified_cohort_rank lost its pinned search_path (proconfig=%). A SECURITY DEFINER function without one is a search-path hijack surface (T-42-03).', v_config;
  END IF;

  -- (3) anon must NOT hold EXECUTE (probe-oracle containment, T-42-02)
  -- RED-UNDER: grant anon EXECUTE back. Expressed as a live `sql` step rather
  --            than an edit BECAUSE 20260821120000 pins the posture exactly (its
  --            post-verify (c)/(d) assert the PUBLIC and anon revokes), so
  --            editing the migration's REVOKE would abort the apply and prove
  --            nothing about the gate. This is the drift that re-opens the
  --            percentile probe oracle to unauthenticated callers.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.get_verified_cohort_rank(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO anon"}]}
  v_anon_exec := has_function_privilege('anon', v_fn_oid, 'EXECUTE');
  IF v_anon_exec THEN
    RAISE EXCEPTION 'TEST FAILED (3): anon holds EXECUTE on get_verified_cohort_rank. This SECDEF bypasses RLS over the whole verified universe; anon access re-opens the percentile probe oracle the min-N floor and decile quantization exist to contain.';
  END IF;

  v_def := pg_get_functiondef(v_fn_oid);

  -- ----- (0c) APPLIED-NESS: AN UNDEPLOYED GATE IS A FAILURE, NOT A SKIP ---
  -- Assertions 1 and 4 below genuinely need the RANK-01 gate deployed: 1 reads
  -- it out of the deployed body, 4 needs it to be what changes the cohort. When
  -- it is absent this file RAISEs. It does NOT skip — see the ⛔ block in the
  -- header for the measurement behind that.
  --
  -- The migration ledger is still read, as an applied-ness oracle INDEPENDENT of
  -- the function's text, but ONLY so the failure message can name the likelier
  -- cause. It never decides whether the assertions run. The four states:
  --     ledger ✓ / body ✓ → ARMED (the post-merge steady state)
  --     ledger ✓ / body ✗ → ARMED → assertion 1 RAISEs. Either the gate was
  --                          dropped, or the predicate was reformatted and this
  --                          file's v_gate_pred constant is stale.
  --     ledger ✗ / body ✗ → RAISEs HERE, at 0c. This is the state that used to
  --                          print a notice and RETURN, withholding BOTH gate
  --                          assertions while exiting 0.
  --     ledger ✗ / body ✓ → ARMED, and NOT a failure. The gate is demonstrably
  --                          deployed; only the ledger ROW is missing, which is
  --                          exactly what an MCP `apply_migration` (it stamps
  --                          now(), not the filename prefix) leaves behind.
  IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (0b): supabase_migrations.schema_migrations does not exist, so this file cannot tell a database that never received migration % from one whose gate was dropped after it applied. That ledger is 0c''s independent applied-ness oracle, and it is what lets the failure below name a cause; without it the only remaining signal is the gate predicate itself, which is what assertion 1 asserts. Run this file against the Supabase-managed TEST project (TEST_SUPABASE_DB_URL), never a bare Postgres.', v_migration;
  END IF;
  v_applied := EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = v_migration
  );
  v_gate_seen := position(v_gate_pred IN v_def) > 0;

  IF NOT v_applied AND NOT v_gate_seen THEN
    RAISE EXCEPTION 'TEST FAILED (0c): the RANK-01 computed-analytics cohort gate (%) is ABSENT from the deployed body of public.get_verified_cohort_rank, and migration % has no row in supabase_migrations.schema_migrations. Assertions 1 (gate occurrence count) and 4 (behavioural delta) therefore could not be evaluated — the two assertions this file exists to make. THIS IS A FAILURE, NOT A SKIP. TWO causes fit and this assertion cannot distinguish them, so check both: (i) the TEST project has not received migration % — apply the phase''s migrations to it and re-run; expect this exactly once, on the PR that introduces the migration, because NO workflow applies migrations to TEST (the sql-tests job has no apply step, and supabase-migrate.yml targets the PRODUCTION project only); (ii) the migration IS deployed but the deployed predicate no longer matches this file''s v_gate_pred constant byte-for-byte — either a re-base merely REFORMATTED it (a removed space, a line wrap), in which case re-cut v_gate_pred to the new text IN THE SAME COMMIT, or a CREATE OR REPLACE DROPPED the gate, which is a live public-ranking-integrity regression in which the min-N denominator diverges from the rank population and dead KPIs rank against live ones. ⛔ Do NOT "fix" this by restoring the RAISE NOTICE/RETURN skip that used to sit here: it exited 0 having asserted nothing about the gate, its notice was not labelled SKIP: so CI''s anti-skip grep could not see it, and nothing applies migrations to TEST so it could never re-arm itself.', v_gate_pred, v_migration, v_migration;
  END IF;

  -- ============ ARMED FROM HERE (gate-dependent assertions) ===============

  -- (1) ⭐ the gate is in BOTH cohort predicates, not just one
  -- RED-UNDER: delete the RANK-01 gate from the RANK query only, leaving the
  --            COUNT query's copy in place — the asymmetric drift, which is the
  --            whole reason this arm counts OCCURRENCES instead of checking
  --            presence. min-N would then count rows the percentiles do not.
  --            LAYERED: the migration's post-verify (e) makes the same count, so
  --            the second step removes THAT term only.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"  WHERE s.status = 'published'\n    AND a.computation_status IN ('complete', 'complete_with_warnings')\n","replace":"  WHERE s.status = 'published'\n","occurrences":2,"nth":2},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"  IF v_gate_hits < 2 THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  v_gate_hits := (length(v_def) - length(replace(v_def, v_gate_pred, '')))
                 / length(v_gate_pred);
  IF v_gate_hits < 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1): the RANK-01 gate appears % time(s) in get_verified_cohort_rank, expected at least 2 (the count query AND the rank query). Gating only one predicate makes the min-N denominator diverge from the rank population — the defect class this gate exists to prevent. TWO causes produce a count of ZERO here and this assertion cannot distinguish them, so check both: (i) a CREATE OR REPLACE dropped the gate — the real regression; (ii) a re-base only REFORMATTED the predicate (a removed space, a line wrap), in which case the deployed body is correct and this file''s v_gate_pred constant must be re-cut to the new byte text IN THE SAME COMMIT. Until F8 this file could take a whole-file skip on the gate-absent state and exit 0 without evaluating this assertion at all; it no longer can — the gate-absent-and-unapplied state RAISEs at 0c, and every other state reaches here.', v_gate_hits;
  END IF;

  -- ----- (4) BEHAVIOURAL: seed a synthetic cohort --------------------------
  -- RED-UNDER: re-point the VERIFIED half of the cohort at a status no
  --            verification row reaches — `v.status = 'published'` becomes
  --            `'verified'` in BOTH cohort predicates of 20260821120000. The
  --            RANK-01 gate text is untouched, so assertion 1 still passes and
  --            only the behavioural delta notices that the cohort went empty.
  --            The header records why that spelling is load-bearing: an earlier
  --            draft keyed on trust_tier IS NOT NULL, a tautology.
  -- RED-UNDER-M: {"arm":"4a","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"      WHERE v.strategy_id = s.id AND v.status = 'published'","replace":"      WHERE v.strategy_id = s.id AND v.status = 'verified'","occurrences":2}]}
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

  -- ======================================================================
  -- Phase 194 FIGURETRUTH plan 20 - ARMS 7-12: the D-15 cohort record gate
  -- (20261107140000_get_verified_cohort_rank_span_gate.sql).
  --
  -- D-11 as superseded by D-15: a strategy whose TOTAL record determinably fails the minimum is
  -- left out of the peer cohort, in the count query AND the rank query. The record is judged
  -- per row: non-crypto with a stored integer record_observations -> under 60 observations;
  -- every other strategy (crypto, or non-crypto without the count: the A-194-D15-02 fallback)
  -- -> a span under 90 days, measured from the later of the first returns_series date and
  -- data_quality_flags.headline_since. D-20 (founder 2026-11-08, "Count returns"): the span
  -- counts the days the returns COVER, both ends included, so last date - first date + 1.
  -- A record that cannot be determined stays in.
  --
  -- Every arm below seeds rows through pg_temp.cr_seed (one published, verified, computed row
  -- with an explicit asset_class) and measures cohort_n as a DELTA against a base read just
  -- before it seeds, so rows other sessions committed cannot move it. Arm 9 is the one
  -- exception: percentiles cannot be a delta, so its oracle is hand-computed and it first
  -- asserts the cohort is empty (0d). Every arm retires its own rows by id before the next one
  -- reads its base, so no arm's seeds reach another's count.
  -- ======================================================================

  -- Take the two arm-4 rows out of the cohort (scoped to their ids) and read the base.
  PERFORM pg_temp.cr_retire(ARRAY[strat_warned, strat_fossil]);

  -- ----- (7) the COUNT query leaves out a crypto row with a 60-day record -----
  -- RED-UNDER: neutralise the D-15 record predicate (the rec_ok flag) in the COUNT query only,
  --            leaving the rank query's copy in place. The annualised cohort (v_n, which is
  --            cohort_n and the Sharpe/Sortino min-N denominator) then counts a crypto strategy
  --            whose whole record is 60 days, so cohort_n rises by one where it must not.
  --            LAYERED: the migration's post-verify (h) demands exactly two copies of the
  --            predicate, so the second step removes THAT term only; it never widens the
  --            mutation.
  -- RED-UNDER-M: {"arm":"7","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"  CROSS JOIN LATERAL (SELECT NOT COALESCE(","replace":"  CROSS JOIN LATERAL (SELECT NOT COALESCE(FALSE AND ","occurrences":2,"nth":1},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"  IF v_rec_hits <> 2 THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  SELECT cohort_n INTO n_base FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  v_id := pg_temp.cr_seed(uid, 'a7-crypto-60d', 'crypto', v_d0::text, (v_d0 + 60)::text, NULL, NULL, 1.0);
  v_seeded := v_seeded || v_id;
  SELECT cohort_n INTO n_a FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_a - n_base) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (7): cohort_n went % -> % after seeding ONE published, verified, computed crypto strategy whose whole record is 60 days; expected no change. The count query (the min-N denominator) is counting a strategy whose TOTAL record fails D-15 minimum of 90 days, so the denominator no longer matches the cohort the percentiles are computed over.', n_base, n_a;
  END IF;
  -- ANTI-VACUITY: the row was left out BY ITS RECORD and nothing else. Lengthen only its
  -- returns_series and it must join; otherwise 7 passed because the row was malformed.
  UPDATE strategy_analytics
     SET returns_series = pg_temp.cr_series(v_d0::text, (v_d0 + 400)::text)
   WHERE strategy_id = v_id;
  SELECT cohort_n INTO n_b FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_b - n_base) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (7): after lengthening ONLY the returns_series of the 60-day crypto row to 400 days, cohort_n went % -> % (expected +1). The row is excluded by something other than its record, so the first half of arm 7 proved nothing about the predicate.', n_base, n_b;
  END IF;

  -- ----- (8) the crypto boundary: 90 daily returns stay, 89 leave -------------
  -- D-20: 90 daily returns run from v_d0 to v_d0 + 89 and cover 90 days; 89 returns end at v_d0 + 88.
  -- RED-UNDER: make the span bound inclusive, `< v_min_span_days` becomes `<= v_min_span_days`
  --            in both queries and in the migration's own v_rec_pred copy. A crypto record of
  --            exactly 90 days then leaves the cohort. D-15 says a record is long enough AT 90.
  --            (Dropping the D-20 `+ 1` from the span bites this arm too: 90 daily returns would
  --            then read 89 days and leave.)
  -- RED-UNDER-M: {"arm":"8","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":" < v_min_span_days END, false)","replace":" <= v_min_span_days END, false)","occurrences":3},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":" < v_min_span_days END, false)","replace":" <= v_min_span_days END, false)","occurrences":2},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":" < v_min_span_days END, false)","replace":" <= v_min_span_days END, false)","occurrences":1}]}
  PERFORM pg_temp.cr_retire(v_seeded);
  v_seeded := '{}';
  SELECT cohort_n INTO n_base FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  v_id := pg_temp.cr_seed(uid, 'a8-crypto-90d', 'crypto', v_d0::text, (v_d0 + 89)::text, NULL, NULL, 1.0);
  v_seeded := v_seeded || v_id;
  SELECT cohort_n INTO n_a FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_a - n_base) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (8): cohort_n went % -> % after seeding a crypto strategy with a record of EXACTLY 90 days; expected +1. D-15 withholds a figure only UNDER 90 days, so a 90-day record belongs in the cohort and the span bound has become inclusive.', n_base, n_a;
  END IF;
  v_id2 := pg_temp.cr_seed(uid, 'a8-crypto-89d', 'crypto', v_d0::text, (v_d0 + 88)::text, NULL, NULL, 1.0);
  v_seeded := v_seeded || v_id2;
  SELECT cohort_n INTO n_b FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_b - n_base) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (8): cohort_n is % after also seeding a crypto strategy with an 89-day record (base %, expected base + 1: the 90-day row only). A record one day short of D-15 minimum joined the cohort.', n_b, n_base;
  END IF;
  -- ANTI-VACUITY: the 89-day row was left out by its span alone.
  UPDATE strategy_analytics
     SET returns_series = pg_temp.cr_series(v_d0::text, (v_d0 + 400)::text)
   WHERE strategy_id = v_id2;
  SELECT cohort_n INTO n_c FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_c - n_base) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (8): after lengthening ONLY the 89-day row to 400 days, cohort_n went % -> % (expected +2 in total). The row is excluded by something other than its span.', n_base, n_c;
  END IF;

  -- ----- (9) the RANK query leaves short rows out of Sharpe and Sortino ONLY (D-18) -
  -- ORACLE, computed by hand and independent of the predicate. 20 kept crypto rows, i = 1..20:
  --   sharpe_i  = 0.5 + 0.1 i   (0.6 .. 2.5)      probe 1.55  -> i <= 10 qualify (1.5 <= 1.55) -> 10 of 20 = 50% -> decile 50
  --   sortino_i = 1.0 + 0.2 i   (1.2 .. 5.0)      probe 3.9   -> i <= 14 qualify (3.8 <= 3.9)  -> 14 of 20 = 70% -> decile 70
  -- No probe lands on a value, so no tie decides it. Ten short crypto rows (30-day record) sit
  -- beside them with sharpe 0.1, sortino 0.2 and max_dd -0.01, each at or under all three
  -- probes. D-18: they leave the annualised peer sets, so Sharpe and Sortino are ranked over the
  -- 20 kept rows and cohort_n (the annualised cohort) is 20. Left in the Sharpe/Sortino numerators
  -- they would count as hits against the same 20-row denominator: sharpe 20 of 20 -> 100, sortino
  -- 24 of 20 -> 120. The Max DD decile, where the short rows STAY, is arm 14's, on its own rows;
  -- it is not asserted here so that each arm's mutation reds its own arm first.
  -- RED-UNDER: neutralise the D-15 record predicate in the RANK query only, leaving the count
  --            query's copy in place. cohort_n stays 20 (the denominator), the short rows join
  --            the Sharpe and Sortino numerators, and both deciles move. The migration's (h)
  --            check is removed by a second step, as in arm 7.
  -- RED-UNDER-M: {"arm":"9","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"  CROSS JOIN LATERAL (SELECT NOT COALESCE(","replace":"  CROSS JOIN LATERAL (SELECT NOT COALESCE(FALSE AND ","occurrences":2,"nth":2},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"  IF v_rec_hits <> 2 THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  PERFORM pg_temp.cr_retire(v_seeded);
  v_seeded := '{}';
  SELECT cohort_n INTO n_base FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF n_base <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (0d): the cohort already holds % strategies that are not this file''s. Arm 9 compares a percentile against a decile computed by hand over this file''s rows only, which a non-empty cohort breaks. The SQL corpus runs on a database private to its runner (scripts/pg-lane, scripts/local-stack); do not point this file at a shared database that carries published, verified, computed strategies.', n_base;
  END IF;
  FOR i IN 1..20 LOOP
    v_seeded := v_seeded || pg_temp.cr_seed(uid, 'a9-kept-' || i, 'crypto', v_d0::text, (v_d0 + 120)::text, NULL, NULL,
                                            (0.5 + 0.1 * i)::float8, (1.0 + 0.2 * i)::float8, (-(0.05 + 0.01 * i))::float8);
  END LOOP;
  FOR i IN 1..10 LOOP
    v_seeded := v_seeded || pg_temp.cr_seed(uid, 'a9-short-' || i, 'crypto', v_d0::text, (v_d0 + 30)::text, NULL, NULL,
                                            0.1, 0.2, -0.01);
  END LOOP;
  SELECT * INTO r FROM public.get_verified_cohort_rank(1.55, 3.9, 0.095);
  IF r.cohort_n IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'TEST FAILED (9): cohort_n is % with 20 kept and 10 short crypto strategies seeded into an empty cohort; expected 20. The count query is not leaving the short rows out.', r.cohort_n;
  END IF;
  IF r.sharpe_pct IS DISTINCT FROM 50 OR r.sortino_pct IS DISTINCT FROM 70 THEN
    RAISE EXCEPTION 'TEST FAILED (9): the deciles are sharpe=% sortino=%, expected 50 / 70 computed by hand over the 20 kept rows only. Ten short-record rows (30 days, each at or under both probes) are being ranked: the rank query no longer leaves out of Sharpe and Sortino a strategy whose total record fails D-15 minimum, so the denominator and the numerator describe different cohorts.', r.sharpe_pct, r.sortino_pct;
  END IF;

  -- ----- (10) the non-crypto boundary: 60 observations stays, 59 leaves --------
  -- RED-UNDER: make the observation bound inclusive, `::int < v_min_obs` becomes
  --            `::int <= v_min_obs` in both queries and in the migration's v_rec_pred copy. A
  --            traditional strategy with exactly 60 observations then leaves the cohort.
  -- RED-UNDER-M: {"arm":"10","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"(a.metrics_json->>'record_observations')::int < v_min_obs","replace":"(a.metrics_json->>'record_observations')::int <= v_min_obs","occurrences":3},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"(a.metrics_json->>'record_observations')::int < v_min_obs","replace":"(a.metrics_json->>'record_observations')::int <= v_min_obs","occurrences":2},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"(a.metrics_json->>'record_observations')::int < v_min_obs","replace":"(a.metrics_json->>'record_observations')::int <= v_min_obs","occurrences":1}]}
  PERFORM pg_temp.cr_retire(v_seeded);
  v_seeded := '{}';
  SELECT cohort_n INTO n_base FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  -- 60 observations over only 84 days: the span (84) is under 90 and the count (60) is not
  -- under 60, so the strategy stays ONLY if the stored count, not the span, decides for a
  -- non-crypto row.
  v_id := pg_temp.cr_seed(uid, 'a10-trad-60obs', 'traditional', v_d0::text, (v_d0 + 84)::text, NULL, 60, 1.0);
  v_seeded := v_seeded || v_id;
  SELECT cohort_n INTO n_a FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_a - n_base) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (10): cohort_n went % -> % after seeding a traditional strategy with record_observations = 60 spanning 84 days; expected +1. D-15 withholds a non-crypto figure only UNDER 60 observations, and a stored count decides over the span, so this row belongs in the cohort.', n_base, n_a;
  END IF;
  -- 59 observations over 400 days: the span is plenty and the count is one short, so it leaves
  -- ONLY if the stored count decides.
  v_id2 := pg_temp.cr_seed(uid, 'a10-trad-59obs', 'traditional', v_d0::text, (v_d0 + 400)::text, NULL, 59, 1.0);
  v_seeded := v_seeded || v_id2;
  SELECT cohort_n INTO n_b FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_b - n_base) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (10): cohort_n is % after also seeding a traditional strategy with record_observations = 59 spanning 400 days (base %, expected base + 1: the 60-observation row only). One observation short of D-15 minimum joined the cohort.', n_b, n_base;
  END IF;
  -- ANTI-VACUITY: the 59-observation row was left out by its count alone.
  UPDATE strategy_analytics
     SET metrics_json = jsonb_build_object('record_observations', 60)
   WHERE strategy_id = v_id2;
  SELECT cohort_n INTO n_c FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_c - n_base) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (10): after raising ONLY the stored count of the 59-observation row to 60, cohort_n went % -> % (expected +2 in total). The row is excluded by something other than its observation count.', n_base, n_c;
  END IF;

  -- ----- (11) the interim fallback (A-194-D15-02): no count -> the span decides -
  -- D-20: 90 daily returns run from v_d0 to v_d0 + 89, 89 returns end at v_d0 + 88.
  -- RED-UNDER: restrict the span arm to crypto rows, the span arm's opening `WHEN (first date) ~ ...
  --            AND (last date) ~` becomes `WHEN s.asset_class = 'crypto' AND (first date) ~ ...`
  --            in both queries and in the migration's v_rec_pred copy (the match runs on the span
  --            arm's two-date opening, which the unreadable arm does not contain). A non-crypto row without a
  --            stored count is then never decided, and a traditional 89-day record stays in.
  -- RED-UNDER-M: {"arm":"11","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"WHEN (a.returns_series->0->>'date') ~ '^\\d{4}-\\d{2}-\\d{2}$' AND (a.returns_series->-1->>'date') ~","replace":"WHEN s.asset_class = 'crypto' AND (a.returns_series->0->>'date') ~ '^\\d{4}-\\d{2}-\\d{2}$' AND (a.returns_series->-1->>'date') ~","occurrences":3},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"WHEN (a.returns_series->0->>'date') ~ '^\\d{4}-\\d{2}-\\d{2}$' AND (a.returns_series->-1->>'date') ~","replace":"WHEN s.asset_class = 'crypto' AND (a.returns_series->0->>'date') ~ '^\\d{4}-\\d{2}-\\d{2}$' AND (a.returns_series->-1->>'date') ~","occurrences":2},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"WHEN (a.returns_series->0->>'date') ~ '^\\d{4}-\\d{2}-\\d{2}$' AND (a.returns_series->-1->>'date') ~","replace":"WHEN s.asset_class = 'crypto' AND (a.returns_series->0->>'date') ~ '^\\d{4}-\\d{2}-\\d{2}$' AND (a.returns_series->-1->>'date') ~","occurrences":1}]}
  PERFORM pg_temp.cr_retire(v_seeded);
  v_seeded := '{}';
  SELECT cohort_n INTO n_base FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  v_id := pg_temp.cr_seed(uid, 'a11-trad-90d', 'traditional', v_d0::text, (v_d0 + 89)::text, NULL, NULL, 1.0);
  v_seeded := v_seeded || v_id;
  SELECT cohort_n INTO n_a FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_a - n_base) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (11): cohort_n went % -> % after seeding a traditional strategy with no stored record_observations and a 90-day span; expected +1. The fallback measures such a row by its span, and 90 days is long enough.', n_base, n_a;
  END IF;
  v_id2 := pg_temp.cr_seed(uid, 'a11-trad-89d', 'traditional', v_d0::text, (v_d0 + 88)::text, NULL, NULL, 1.0);
  v_seeded := v_seeded || v_id2;
  SELECT cohort_n INTO n_b FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_b - n_base) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (11): cohort_n is % after also seeding a traditional strategy with no stored record_observations and an 89-day span (base %, expected base + 1: the 90-day row only). A non-crypto row without a count is not being decided by the span fallback (A-194-D15-02).', n_b, n_base;
  END IF;
  -- ANTI-VACUITY: the 89-day row was left out by its span alone.
  UPDATE strategy_analytics
     SET returns_series = pg_temp.cr_series(v_d0::text, (v_d0 + 400)::text)
   WHERE strategy_id = v_id2;
  SELECT cohort_n INTO n_c FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_c - n_base) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (11): after lengthening ONLY the 89-day traditional row to 400 days, cohort_n went % -> % (expected +2 in total). The row is excluded by something other than its span.', n_base, n_c;
  END IF;

  -- ----- (12) an impossible calendar date cannot fail the RPC, and the row leaves the cohort ---
  -- The record dates are parsed with public.ledger_refresh_parse_series_date, which returns
  -- NULL for 2026-02-31 where a bare ::date raises 22008. Phase 194.2 D-01 (20261110120000):
  -- a PRESENT date that is not a real day is UNREADABLE (TS figureRecord and Python _read_day
  -- say the same), so the row leaves the annualised cohort instead of staying in on the null
  -- rule; it must still never raise. Three rows, one impossible date each, so that restoring
  -- ANY ONE of the three casts fails the arm:
  --   A  the FIRST returns_series date      B  the LAST returns_series date
  --   C  data_quality_flags.headline_since  (A and B also carry a valid 200-day partner)
  -- The date is shape-valid, so the migration's regex pre-filter lets it through to the parser.
  -- The cohort-count half (delta 0, then +3 once the dates are repaired) is pinned by the
  -- anti-vacuity flip below; the runner mutation exercises the no-RAISE half.
  -- RED-UNDER: restore the bare casts into the unreadable arm (`(x)::date IS NULL` in place of
  --            the parser call, for each of the three record dates) in both queries and in the
  --            migration's v_rec_pred copy. The RPC then raises 22008 for every caller the
  --            moment one analytics row holds such a date.
  -- RED-UNDER-M: {"arm":"12","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"public.ledger_refresh_parse_series_date(a.returns_series->-1->>'date') IS NULL","replace":"(a.returns_series->-1->>'date')::date IS NULL","occurrences":3},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"public.ledger_refresh_parse_series_date(a.returns_series->-1->>'date') IS NULL","replace":"(a.returns_series->-1->>'date')::date IS NULL","occurrences":2},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"public.ledger_refresh_parse_series_date(a.returns_series->-1->>'date') IS NULL","replace":"(a.returns_series->-1->>'date')::date IS NULL","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"public.ledger_refresh_parse_series_date(a.returns_series->0->>'date') IS NULL","replace":"(a.returns_series->0->>'date')::date IS NULL","occurrences":3},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"public.ledger_refresh_parse_series_date(a.returns_series->0->>'date') IS NULL","replace":"(a.returns_series->0->>'date')::date IS NULL","occurrences":2},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"public.ledger_refresh_parse_series_date(a.returns_series->0->>'date') IS NULL","replace":"(a.returns_series->0->>'date')::date IS NULL","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"public.ledger_refresh_parse_series_date(a.data_quality_flags->>'headline_since') IS NULL","replace":"(a.data_quality_flags->>'headline_since')::date IS NULL","occurrences":3},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"public.ledger_refresh_parse_series_date(a.data_quality_flags->>'headline_since') IS NULL","replace":"(a.data_quality_flags->>'headline_since')::date IS NULL","occurrences":2},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"public.ledger_refresh_parse_series_date(a.data_quality_flags->>'headline_since') IS NULL","replace":"(a.data_quality_flags->>'headline_since')::date IS NULL","occurrences":1}]}
  PERFORM pg_temp.cr_retire(v_seeded);
  v_seeded := '{}';
  SELECT cohort_n INTO n_base FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  v_seeded := v_seeded || pg_temp.cr_seed(uid, 'a12-bad-first', 'crypto', '2026-02-31', (v_d0 + 200)::text, NULL, NULL, 1.0);
  v_seeded := v_seeded || pg_temp.cr_seed(uid, 'a12-bad-last', 'crypto', v_d0::text, '2026-02-31', NULL, NULL, 1.0);
  v_seeded := v_seeded || pg_temp.cr_seed(uid, 'a12-bad-headline', 'crypto', v_d0::text, (v_d0 + 200)::text, '2026-02-31', NULL, 1.0);
  BEGIN
    SELECT cohort_n INTO n_a FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (12): get_verified_cohort_rank RAISED (SQLSTATE %, %) with an impossible calendar date (2026-02-31) in a returns_series date or in headline_since. One bad analytics row must never fail the cohort RPC for every authenticated caller; the record dates are no longer parsed through ledger_refresh_parse_series_date.', SQLSTATE, SQLERRM;
  END;
  IF (n_a - n_base) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (12): cohort_n went % -> % after seeding three crypto strategies that each carry one impossible calendar date (2026-02-31); expected no change. A record date that is present but not a real day is UNREADABLE (D-01: TS figureRecord and Python _read_day withhold it), so none of the three may join the annualised cohort. A +3 means the null rule is still keeping them in.', n_base, n_a;
  END IF;
  -- ANTI-VACUITY: each of the three rows was left out BY ITS DATE and nothing else. Repair ONLY the
  -- dates (a valid 200-day series, no headline_since) and all three must join. Scoped to the ids this
  -- arm seeded, never table-wide.
  UPDATE strategy_analytics
     SET returns_series = pg_temp.cr_series(v_d0::text, (v_d0 + 200)::text),
         data_quality_flags = NULL
   WHERE strategy_id = ANY (v_seeded);
  SELECT cohort_n INTO n_b FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_b - n_base) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'TEST FAILED (12): after repairing ONLY the impossible dates of the three crypto rows, cohort_n went % -> % (expected +3 in total). The rows are excluded by something other than their date, so the first half of arm 12 proved nothing about the unreadable rule.', n_base, n_b;
  END IF;

  -- ----- (13) the min-N floor applies PER RANK, and a short record is still a Max DD peer (D-18) -----
  -- D-18: a record under the D-15 minimum leaves the annualised peer sets (Sharpe, Sortino) and
  -- stays in the Max DD set. The floor of 20 therefore applies to each rank's OWN population.
  -- Ten kept crypto rows (120 days) and ten short ones (30 days) give an annualised cohort of 10
  -- and a Max DD cohort of 20, so Sharpe and Sortino are suppressed (NULL) while Max DD ranks.
  -- cohort_n is the annualised cohort, 10: the smallest population any rank in the row uses.
  -- This arm asserts the SHAPE (which ranks are NULL); arm 14 asserts the Max DD decile.
  -- RED-UNDER: take the early min-N return off the Max DD population, `IF v_n_all < v_min_n`
  --            becomes `IF v_n < v_min_n`. The Max DD rank is then suppressed by the annualised
  --            cohort of 10 and reads NULL, where a short record in the Max DD set must carry it
  --            to 20.
  -- RED-UNDER-M: {"arm":"13","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"  IF v_n_all < v_min_n THEN","replace":"  IF v_n < v_min_n THEN","occurrences":1}]}
  PERFORM pg_temp.cr_retire(v_seeded);
  v_seeded := '{}';
  SELECT cohort_n INTO n_base FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF n_base <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (0e): the cohort already holds % strategies that are not this file''s. Arms 13 and 14 compare a percentile against a decile computed by hand over this file''s rows only, which a non-empty cohort breaks. The SQL corpus runs on a database private to its runner (scripts/pg-lane, scripts/local-stack); do not point this file at a shared database that carries published, verified, computed strategies.', n_base;
  END IF;
  FOR i IN 1..10 LOOP
    v_seeded := v_seeded || pg_temp.cr_seed(uid, 'a13-kept-' || i, 'crypto', v_d0::text, (v_d0 + 120)::text, NULL, NULL,
                                            (0.5 + 0.1 * i)::float8, (1.0 + 0.2 * i)::float8, (-(0.05 + 0.01 * i))::float8);
  END LOOP;
  FOR i IN 1..10 LOOP
    v_id := pg_temp.cr_seed(uid, 'a13-short-' || i, 'crypto', v_d0::text, (v_d0 + 30)::text, NULL, NULL,
                            0.1, 0.2, -0.01);
    v_seeded := v_seeded || v_id;
    v_short := v_short || v_id;
  END LOOP;
  SELECT * INTO r FROM public.get_verified_cohort_rank(1.55, 3.9, 0.095);
  IF r.cohort_n IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'TEST FAILED (13): cohort_n is % with 10 kept and 10 short crypto strategies seeded into an empty cohort; expected 10 (the annualised cohort: the short rows leave it).', r.cohort_n;
  END IF;
  IF r.sharpe_pct IS NOT NULL OR r.sortino_pct IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (13): sharpe_pct=% sortino_pct=% with an annualised cohort of 10, expected both NULL. Sharpe and Sortino are ranked below the min-N floor of 20.', r.sharpe_pct, r.sortino_pct;
  END IF;
  IF r.max_dd_pct IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (13): max_dd_pct is NULL with a Max DD cohort of 20 (10 kept and 10 short rows). D-18: a short record stays in the Max DD set, so that rank clears the min-N floor on its own population and must not be suppressed by the annualised cohort of 10.';
  END IF;

  -- ----- (14) the Max DD decile is over the WHOLE cohort, short rows included (D-18) -----
  -- ORACLE by hand, on the arm 13 rows. Max DD over all 20: kept i = 1..10 have abs 0.06 .. 0.15
  -- (-(0.05 + 0.01 i)), probe 0.095 -> i <= 4 qualify (0.09 <= 0.095) -> 4 hits; the ten short rows
  -- (abs 0.01) all qualify -> 10 hits. 14 of 20 = 70% -> 100-70 = 30 -> decile 30. A Max DD that
  -- dropped the short rows would be below the floor (NULL, caught by 13) or, over the kept rows
  -- alone against a denominator of 10, 4 of 10 = 40% -> 60 -> decile 60.
  -- RED-UNDER: add the record flag to the Max DD numerator, `FILTER (WHERE abs(a.max_drawdown)`
  --            becomes `FILTER (WHERE r.rec_ok AND abs(a.max_drawdown)`. The short rows stop
  --            counting as hits against the whole-cohort denominator: 4 of 20 = 20% -> 80, not 30.
  --            LAYERED: the migration's (j) check reads the deployed body for the unflagged
  --            form, so the second step removes THAT term only.
  -- RED-UNDER-M: {"arm":"14","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"FILTER (WHERE abs(a.max_drawdown) <= p_max_dd) / v_n_all)","replace":"FILTER (WHERE r.rec_ok AND abs(a.max_drawdown) <= p_max_dd) / v_n_all)","occurrences":2,"nth":1},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"  IF position('FILTER (WHERE abs(a.max_drawdown) <= p_max_dd) / v_n_all)' IN v_def) = 0 THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  IF r.max_dd_pct IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'TEST FAILED (14): max_dd_pct is %, expected 30 computed by hand over all 20 rows (4 kept hits + 10 short hits = 14 of 20 = 70%%, inverted). A short-record strategy must stay in the Max DD set (D-18); an 80 means the ten short rows no longer count as Max DD hits.', r.max_dd_pct;
  END IF;
  -- ANTI-VACUITY: the short rows were out of Sharpe and Sortino BY THEIR RECORD and nothing else.
  -- Lengthen only their returns_series and the annualised cohort must become 20 with both ranks
  -- present, while the Max DD decile does not move (the Max DD set was already the whole cohort).
  UPDATE strategy_analytics
     SET returns_series = pg_temp.cr_series(v_d0::text, (v_d0 + 400)::text)
   WHERE strategy_id = ANY (v_short);
  SELECT * INTO r FROM public.get_verified_cohort_rank(1.55, 3.9, 0.095);
  IF r.cohort_n IS DISTINCT FROM 20 OR r.sharpe_pct IS NULL OR r.sortino_pct IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (14): after lengthening ONLY the returns_series of the ten short rows to 400 days, cohort_n=% sharpe_pct=% sortino_pct=%, expected cohort_n 20 and both ranks present. The rows were excluded from Sharpe and Sortino by something other than their record, so arms 13 and 14 proved nothing about the predicate.', r.cohort_n, r.sharpe_pct, r.sortino_pct;
  END IF;
  IF r.max_dd_pct IS DISTINCT FROM 30 THEN
    RAISE EXCEPTION 'TEST FAILED (14): max_dd_pct moved to % after the short rows reached the minimum record, expected 30 unchanged. The Max DD set must be the same whole cohort whatever the record length.', r.max_dd_pct;
  END IF;

  -- ----- (15) a malformed FIRST returns_series date leaves the annualised cohort (D-01) -----
  -- A crypto row with a 200-day record would clear D-15 on its span, so only its unreadable first date
  -- can leave it out. 'not-a-date' fails the YYYY-MM-DD shape. An ABSENT first date (NULL, or empty
  -- text) is not malformed and keeps the null rule: the row stays in.
  -- RED-UNDER: neutralise the NOT-A-DAY branch of the first-date term in both queries and in the
  --            migration's v_rec_pred copy (`ELSE (first date) <> ''` becomes `ELSE false`). The
  --            impossible-day branch stays, so arm 12 still passes and this arm is the first to red.
  --            The garbage first date then falls through the span arm to NULL, the null rule keeps
  --            the row in, and cohort_n rises by one where it must not.
-- RED-UNDER-M: {"arm":"15","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"ELSE (a.returns_series->0->>'date') <> '' END)","replace":"ELSE false END)","occurrences":3},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"ELSE (a.returns_series->0->>'date') <> '' END)","replace":"ELSE false END)","occurrences":2},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"ELSE (a.returns_series->0->>'date') <> '' END)","replace":"ELSE false END)","occurrences":1}]}
  PERFORM pg_temp.cr_retire(v_seeded);
  v_seeded := '{}';
  SELECT cohort_n INTO n_base FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  v_id := pg_temp.cr_seed(uid, 'a15-bad-first', 'crypto', 'not-a-date', (v_d0 + 200)::text, NULL, NULL, 1.0);
  v_seeded := v_seeded || v_id;
  SELECT cohort_n INTO n_a FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_a - n_base) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (15): cohort_n went % -> % after seeding a crypto strategy with a 200-day record whose FIRST returns_series date is not a date; expected no change. A present malformed date is unreadable (D-01), so the row must leave the annualised cohort the way TS figureRecord withholds its figures.', n_base, n_a;
  END IF;
  -- ANTI-VACUITY: the row was left out BY ITS FIRST DATE and nothing else. Repair only that date.
  UPDATE strategy_analytics
     SET returns_series = pg_temp.cr_series(v_d0::text, (v_d0 + 200)::text)
   WHERE strategy_id = v_id;
  SELECT cohort_n INTO n_b FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_b - n_base) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (15): after repairing ONLY the first date of the 200-day crypto row, cohort_n went % -> % (expected +1). The row is excluded by something other than its first date, so the first half of arm 15 proved nothing about the unreadable rule.', n_base, n_b;
  END IF;
  -- ABSENT CONTRAST: a NULL first date and an empty one are absent, not malformed. Both rows keep the
  -- null rule and stay in (the span arm cannot decide, so nothing leaves them out).
  v_seeded := v_seeded || pg_temp.cr_seed(uid, 'a15-null-first', 'crypto', NULL, (v_d0 + 200)::text, NULL, NULL, 1.0);
  v_seeded := v_seeded || pg_temp.cr_seed(uid, 'a15-empty-first', 'crypto', '', (v_d0 + 200)::text, NULL, NULL, 1.0);
  SELECT cohort_n INTO n_c FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_c - n_base) IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'TEST FAILED (15): cohort_n went % -> % after also seeding two crypto strategies whose first date is ABSENT (NULL, and empty text); expected +3 in total. An absent date is unknown, not malformed, and keeps the null rule: it must not be read as unreadable.', n_base, n_c;
  END IF;

  -- ----- (16) a malformed LAST returns_series date leaves the annualised cohort (D-01) -----
  -- RED-UNDER: neutralise the NOT-A-DAY branch of the last-date term in both queries and in the
  --            migration's v_rec_pred copy (`ELSE (last date) <> ''` becomes `ELSE false`; the
  --            impossible-day branch stays, so arm 12 still passes). The garbage last date then
  --            falls through the span arm to NULL and the row stays in.
  -- RED-UNDER-M: {"arm":"16","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"ELSE (a.returns_series->-1->>'date') <> '' END)","replace":"ELSE false END)","occurrences":3},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"ELSE (a.returns_series->-1->>'date') <> '' END)","replace":"ELSE false END)","occurrences":2},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"ELSE (a.returns_series->-1->>'date') <> '' END)","replace":"ELSE false END)","occurrences":1}]}
  PERFORM pg_temp.cr_retire(v_seeded);
  v_seeded := '{}';
  SELECT cohort_n INTO n_base FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  v_id := pg_temp.cr_seed(uid, 'a16-bad-last', 'crypto', v_d0::text, 'not-a-date', NULL, NULL, 1.0);
  v_seeded := v_seeded || v_id;
  SELECT cohort_n INTO n_a FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_a - n_base) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (16): cohort_n went % -> % after seeding a crypto strategy whose LAST returns_series date is not a date; expected no change. A present malformed date is unreadable (D-01), so the row must leave the annualised cohort.', n_base, n_a;
  END IF;
  -- ANTI-VACUITY: the row was left out BY ITS LAST DATE and nothing else. Repair only that date.
  UPDATE strategy_analytics
     SET returns_series = pg_temp.cr_series(v_d0::text, (v_d0 + 200)::text)
   WHERE strategy_id = v_id;
  SELECT cohort_n INTO n_b FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_b - n_base) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (16): after repairing ONLY the last date of the crypto row, cohort_n went % -> % (expected +1). The row is excluded by something other than its last date, so the first half of arm 16 proved nothing about the unreadable rule.', n_base, n_b;
  END IF;
  -- A date shaped like a day whose month is 13 (2026-13-45) is not a day either: it reaches the parser,
  -- which reads it as NULL. The row stays out, and the RPC does not raise.
  v_seeded := v_seeded || pg_temp.cr_seed(uid, 'a16-month-13', 'crypto', v_d0::text, '2026-13-45', NULL, NULL, 1.0);
  SELECT cohort_n INTO n_c FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_c - n_base) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (16): cohort_n is % after also seeding a crypto strategy whose last date is shaped like a day but has month 13 (base %, expected base + 1: the repaired row only). A date the parser cannot read is not a real day and must leave the annualised cohort.', n_c, n_base;
  END IF;
  -- A trailing-garbage date (a real day followed by x) is not a day either: the shape test is anchored at both ends.
  v_id2 := pg_temp.cr_seed(uid, 'a16-trailing-garbage', 'crypto', v_d0::text, (v_d0 + 200)::text || 'x', NULL, NULL, 1.0);
  v_seeded := v_seeded || v_id2;
  SELECT cohort_n INTO n_c FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_c - n_base) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (16): cohort_n is % after also seeding a crypto strategy whose last date carries trailing text (a real day followed by x) (base %, expected base + 1: the repaired row only). A date with trailing text is not a real day, so the shape test must be anchored at both ends.', n_c, n_base;
  END IF;
  -- ABSENT CONTRAST: a NULL last date is absent, not malformed; the row stays in.
  v_seeded := v_seeded || pg_temp.cr_seed(uid, 'a16-null-last', 'crypto', v_d0::text, NULL, NULL, NULL, 1.0);
  SELECT cohort_n INTO n_c FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_c - n_base) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (16): cohort_n went % -> % after also seeding a crypto strategy whose last date is ABSENT (NULL); expected +2 in total (the repaired row and this one). An absent date keeps the null rule and must not be read as unreadable.', n_base, n_c;
  END IF;

  -- ----- (17) a malformed data_quality_flags.headline_since leaves the annualised cohort (D-01) -----
  -- headline_since decides a chain-broken row's record start, so a present but unparsable one is as
  -- unreadable as a malformed series end (an absent one is unknown). 'garbage' is not shaped like a day
  -- at all: before D-01 the span arm ignored it and measured the record from the first date.
  -- RED-UNDER: neutralise the NOT-A-DAY branch of the headline_since term in both queries and in the
  --            migration's v_rec_pred copy (`ELSE (headline_since) <> ''` becomes `ELSE false`; the
  --            impossible-day branch stays, so arm 12 still passes). The span arm then ignores the
  --            garbage headline and measures 201 days from the first date, so the row stays in.
  -- RED-UNDER-M: {"arm":"17","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"ELSE (a.data_quality_flags->>'headline_since') <> '' END)","replace":"ELSE false END)","occurrences":3},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"ELSE (a.data_quality_flags->>'headline_since') <> '' END)","replace":"ELSE false END)","occurrences":2},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"ELSE (a.data_quality_flags->>'headline_since') <> '' END)","replace":"ELSE false END)","occurrences":1}]}
  PERFORM pg_temp.cr_retire(v_seeded);
  v_seeded := '{}';
  SELECT cohort_n INTO n_base FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  v_id := pg_temp.cr_seed(uid, 'a17-bad-headline', 'crypto', v_d0::text, (v_d0 + 200)::text, 'garbage', NULL, 1.0);
  v_seeded := v_seeded || v_id;
  SELECT cohort_n INTO n_a FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_a - n_base) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (17): cohort_n went % -> % after seeding a crypto strategy with a 201-day record and a headline_since that is not a date; expected no change. A present malformed headline_since is unreadable (D-01), so the row must leave the annualised cohort.', n_base, n_a;
  END IF;
  -- ANTI-VACUITY: the row was left out BY ITS HEADLINE and nothing else. Repair only that field.
  UPDATE strategy_analytics
     SET data_quality_flags = jsonb_build_object('headline_since', v_d0::text)
   WHERE strategy_id = v_id;
  SELECT cohort_n INTO n_b FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_b - n_base) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (17): after repairing ONLY the headline_since of the crypto row, cohort_n went % -> % (expected +1). The row is excluded by something other than its headline_since, so the first half of arm 17 proved nothing about the unreadable rule.', n_base, n_b;
  END IF;

  -- ----- (18) the unreadable arm PRECEDES the observation arm (D-01) -----
  -- A non-crypto row with a stored count of 100 (above the 60 minimum) is decided by that count under
  -- D-15, so it stays in. When one of its record dates is unreadable, TS figureRecord withholds it
  -- whatever the count (a non-crypto record with a stored count that clears is still withheld), so the
  -- cohort must leave it out: the unreadable arm has to run BEFORE the observation arm.
  -- RED-UNDER: restrict the unreadable arm to crypto rows, so the observation arm decides a non-crypto
  --            row with a clearing count before any date is judged (`CASE WHEN ((` becomes
  --            `CASE WHEN s.asset_class = 'crypto' AND ((` in both queries and in the migration's
  --            v_rec_pred copy). The traditional row with 100 observations then stays in.
  -- RED-UNDER-M: {"arm":"18","apply":[{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"NOT COALESCE(CASE WHEN ((","replace":"NOT COALESCE(CASE WHEN s.asset_class = 'crypto' AND ((","occurrences":3},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"NOT COALESCE(CASE WHEN ((","replace":"NOT COALESCE(CASE WHEN s.asset_class = 'crypto' AND ((","occurrences":2},{"kind":"edit","file":"supabase/migrations/20261110120000_get_verified_cohort_rank_unreadable_dates.sql","find":"NOT COALESCE(CASE WHEN ((","replace":"NOT COALESCE(CASE WHEN s.asset_class = 'crypto' AND ((","occurrences":1}]}
  PERFORM pg_temp.cr_retire(v_seeded);
  v_seeded := '{}';
  SELECT cohort_n INTO n_base FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  v_id := pg_temp.cr_seed(uid, 'a18-trad-count-clears-bad-last', 'traditional', v_d0::text, 'garbage', NULL, 100, 1.0);
  v_seeded := v_seeded || v_id;
  SELECT cohort_n INTO n_a FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_a - n_base) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (18): cohort_n went % -> % after seeding a traditional strategy with record_observations = 100 (clears the 60 minimum) and an unreadable last date; expected no change. An unreadable record is withheld whatever its stored count (D-01), so the unreadable arm must precede the observation arm.', n_base, n_a;
  END IF;
  -- ANTI-VACUITY: the row was left out BY ITS LAST DATE and nothing else. Repair only that date and the
  -- clearing count decides: it joins.
  UPDATE strategy_analytics
     SET returns_series = pg_temp.cr_series(v_d0::text, (v_d0 + 30)::text)
   WHERE strategy_id = v_id;
  SELECT cohort_n INTO n_b FROM public.get_verified_cohort_rank(1.0, 1.0, 0.1);
  IF (n_b - n_base) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (18): after repairing ONLY the last date of the traditional row (record_observations = 100, a 31-day span), cohort_n went % -> % (expected +1: the stored count decides over the span). The row is excluded by something other than its last date, so the first half of arm 18 proved nothing about the ordering.', n_base, n_b;
  END IF;

  PERFORM pg_temp.cr_retire(v_seeded);

  RAISE NOTICE 'ALL 18 ARMS EXECUTED (1, 2a, 2b, 3, 4a, 4b, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18) and passed — the RANK-01 gate appears in % cohort predicates, SECURITY DEFINER + search_path pinned, anon lacks EXECUTE, complete_with_warnings joins the cohort and a failed-with-KPIs row does not (proven causal by the status flip); the D-15 record gate leaves a crypto 60-day row out of both queries, keeps crypto at 90 days and drops it at 89, keeps a traditional strategy at 60 observations and drops it at 59, decides a traditional strategy without a count by its span, ranks only the kept rows, and survives an impossible calendar date in any of the three record dates without raising; D-01: a record date that is present but not a real day (a malformed first date, last date or headline_since, an impossible calendar day, or trailing text) leaves the annualised cohort while an absent date stays in, and the unreadable rule precedes the observation arm so a non-crypto row whose stored count clears is still out; D-18: a short record leaves the Sharpe and Sortino peer sets and stays in the Max DD set, the min-N floor applies to each rank on its own population, and cohort_n is the annualised cohort.', v_gate_hits;
END
$$;

ROLLBACK;
