-- Test: public.enqueue_ledger_refresh_for_strategies — the LEDGER-01/-02/-04
-- refresh fan-out. Guards migration
-- 20260825130000_ledger_refresh_fanout_dormant.sql (Phase 161.1 / D-01, D-07,
-- D-08, D-09).
--
-- What makes this gate worth having: MATCHED PAIRS
-- ------------------------------------------------
-- A bound is only proven by two arms pulling in opposite directions. Without the
-- POSITIVE arm, a body that enqueues NOTHING passes every negative arm. Without
-- the NEGATIVE arms, a body that enqueues EVERYTHING passes the positive one.
-- Only the pair pins a bound that both exists and is not over-tight — the same
-- reasoning migration 20260819150000 gives for its own C5/C5b pair. Arm G goes
-- one step further and pins the TWO integers against EACH OTHER: with a per-tick
-- LIMIT of 4 and a per-venue cap of 2, only the cap can produce a count of 2, so
-- deleting the cap yields 4 and G1 reddens. That is why D-09 forbids lowering the
-- LIMIT to equal the cap.
--
-- Arms:
--   A  DORMANCY (LEDGER-02)  — activation setting unset ⇒ returns 0, inserts 0.
--                              This is the arm that proves merging the migration
--                              changes no production behaviour.
--   B  POSITIVE (LEDGER-01)  — same seed with the setting on ⇒ exactly one
--                              strategy-scoped derive_broker_dailies job whose
--                              metadata source EQUALS the refresh marker, and a
--                              return value of 1.
--   C  NEGATIVE CONTROL      — a FRESH single-key strategy is NOT enqueued.
--   D  COMPOSITE (D-01)      — a stale composite is NOT enqueued, and no
--                              stitch_composite row appears either.
--   E  DEDUPE                — a second call adds nothing while a job is in flight.
--   F  COOLDOWN (D-09)       — an attempt 2 h ago blocks; aged past 20 h, unblocks.
--   G  BOUNDS (D-09)         — G1 the per-venue cap, G2 the per-tick LIMIT.
--   H  KEY ELIGIBILITY       — inactive / revoked / disconnected keys are skipped.
--   I  ACL durability (F-1)  — anon/authenticated cannot EXECUTE the fan-out.
--                             Mirrors the apply-time DO block, which runs once
--                             and can be silently undone afterwards. That REVOKE
--                             is the SOLE bound: under `authenticated` both
--                             NOT EXISTS guards go vacuously TRUE.
--   J  OWNER durability      — proowner is exempt from RLS (rolsuper OR
--                             rolbypassrls). Same apply-time-only weakness as I,
--                             one property over. Fail-CLOSED, which is why it
--                             needs an arm: drift makes the fan-out return 0
--                             forever, indistinguishable from "nothing stale".
--
-- ⚠️ NOT IN THIS FILE, and NOT dropped: the D-15 proof that a FAILED refresh
-- leaves an already-published row intact — status, warned flag, by-basis metrics,
-- returns_series and both basis series rows untouched. It cannot live here: this
-- file cannot make a venue probe fail, because the worker handler is Python and
-- never runs under psql. It lives in
-- analytics-service/tests/test_ledger_refresh_nondestructive.py. If you came here
-- auditing "where is the non-destructive arm", that is where it is.
--
-- ⚠️ sfox is deliberately UNEXERCISED here. It has zero PROD strategies, so its
-- arm ships unexercised by construction; it stays in the refresh set because
-- criterion 4 pins the venue SET (plan 05 gate 1), and no arm in this file may
-- assert that it produces work.
--
-- SERIAL execution: the fan-out takes a SESSION advisory lock, so a concurrent
-- holder would make it skip and redden the positive arms for the wrong reason.
-- The repo already runs supabase/tests/*.sql one file at a time; keep it that way.
--
-- Session-scoped activation: the fan-out reads its activation setting per
-- session, so this ONE file can exercise BOTH the dormant and the active arms —
-- arm A first with the setting untouched, then set_config(..., is_local => true)
-- for the rest, which unwinds with the transaction.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- ⛔ AN ABSENT FUNCTION IS A HARD FAILURE, NEVER A SKIP (161.1-REVIEW WR-03)
-- --------------------------------------------------------------------------
-- This file used to open with `RAISE NOTICE 'SKIP: …'; RETURN;` when the fan-out
-- function was absent. MEASURED 2026-08-25 against an empty Postgres 16: that path
-- printed the notice and exited `EXITCODE=0` having executed ZERO of arms A-J. The
-- CI step (.github/workflows/ci.yml, `sql-tests` → "Run SQL self-tests against
-- test Supabase project") reads ONLY that exit code, so the skip was
-- byte-identical to a pass in the only channel anything mechanical looks at — and
-- it was GUARANTEED to fire on the one run that matters most: the PR that
-- introduces migration 20260825130000.
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
-- until the phase's migrations are applied to the TEST project. The fan-out is a
-- SECURITY DEFINER, cross-tenant enqueue function that auto-applies to PROD on
-- merge, and arms A-J are the ONLY executed coverage of its SELECT predicates —
-- every other gate in the phase is a static text scan over the migration source.
-- Arm A (dormancy) is what proves the merge changes no production behaviour; a
-- skip meant that proof had never been run anywhere but an executor's laptop.
--
-- ✅ MECHANICALLY CLOSED (161.1-REVIEW WR-03 option (b), landed in
-- .github/workflows/ci.yml): the `sql-tests` step now captures each file's output,
-- fails on a printed 'SKIP:', and reads the 'ALL 10 ARMS EXECUTED' sentinel back off
-- THIS file's RAISE NOTICE line and requires the run to have printed it. So an
-- edit that neuters an arm in place — deleting the assertion, short-circuiting
-- early — fails CI even though psql exits 0. ⚠️ The count in that notice is read
-- from the file, not hard-coded: if you add or remove an arm you MUST update it,
-- or the pin silently measures the wrong number of arms.
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4). Each prose RED-UNDER above an arm
-- below carries an adjacent `RED-UNDER-M` object that scripts/mutation-runner
-- executes on every push: it mutates COPIES, requires the FIRST `TEST FAILED (…)`
-- to name that arm, and restores GREEN. The schema is scripts/mutation-runner/
-- GRAMMAR.md. The line below declares what the lane applies before this gate. It
-- was DISCOVERED, not guessed — plan 164.4-04 started from the sibling composite
-- gate's proven 10-entry list and needed ONE more iteration: this gate enqueues
-- `derive_broker_dailies`, whose kind row and admission CHECK come from
-- 20260614120000, without which the seed trips compute_jobs_kind_fkey. Proven
-- `ALL 10 ARMS EXECUTED (A-J)`, mean 1.06 s/lane over 3 timed runs.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql","supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","supabase/migrations/20260825140000_ledger_refresh_composite_arm.sql"]}
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_ledger_refresh_fanout.sql

BEGIN;

DO $$
DECLARE
  uid          UUID := gen_random_uuid();
  k_led        UUID;  -- eligible, ledger-backed venue #1
  k_led2       UUID;  -- eligible, ledger-backed venue #2 (arm G2 needs two venues)
  k_led2b      UUID;  -- second key on venue #2, so the composite has two members
  k_inactive   UUID;
  k_revoked    UUID;
  k_disc       UUID;
  s_a          UUID;  -- arms A / B / E: maximally stale, eligible, single-key
  s_c          UUID;  -- arm C: FRESH single-key on the other ledger venue
  s_d          UUID;  -- arm D: stale COMPOSITE
  s_f          UUID;  -- arm F: stale, but attempted 2 h ago
  s_h_inact    UUID;
  s_h_revoked  UUID;
  s_h_disc     UUID;
  g1_v1        UUID[];  -- arm G1: 6 stale single-key on venue #1
  g2_v1        UUID[];  -- arm G2: 6 more on venue #1
  g2_v2        UUID[];  -- arm G2: 6 stale single-key on venue #2
  v_ret        INTEGER;
  v_cnt        INTEGER;
  v_cnt2       INTEGER;
  v_strat      UUID;
  v_port       UUID;
  v_alloc      UUID;
  v_api        UUID;
  v_source     TEXT;
  v_foreign    INTEGER;
  -- ⛔ Arm J's three. plpgsql compiles this DO block WHOLE: an undeclared
  --    variable raises 42601 and NONE of arms A-J run — the failure would not
  --    be "arm J is broken", it would be "the file asserted nothing". Adding an
  --    arm means adding its DECLAREs here in the same edit.
  v_owner      TEXT;
  v_own_super  BOOLEAN;
  v_own_bypass BOOLEAN;
BEGIN
  -- ----- applied-ness gate: ABSENCE IS A FAILURE, NOT A SKIP (WR-03) ------
  -- RED-UNDER: DROP the function on the live lane after the migrations have
  --            applied — cause (ii) of this arm's own message. It is a `sql`
  --            step rather than a migration edit because renaming the CREATE in
  --            20260825130000 aborts that migration's OWN verification block
  --            ("enqueue_ledger_refresh_for_strategies missing"), so the gate
  --            would never run and no arm could be the first failure.
  -- RED-UNDER-M: {"arm":"0","apply":[{"kind":"sql","stmt":"DROP FUNCTION public.enqueue_ledger_refresh_for_strategies()"}]}
  -- See the ⛔ block in this file's header for the measurement behind this.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'enqueue_ledger_refresh_for_strategies'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED (0): public.enqueue_ledger_refresh_for_strategies is not registered on this database, so NONE of arms A-J ran — including arm A, the dormancy proof that merging this migration changes no production behaviour. This is a FAILURE, not a skip. TWO causes fit and this assertion cannot distinguish them, so check both: (i) the TEST project has not received migration 20260825130000 — apply the phase''s migrations to it and re-run; expect this exactly once, on the PR that introduces them, because NO workflow applies migrations to TEST; (ii) the function was DROPPED or RENAMED after being applied, which is a real regression in a SECURITY DEFINER cross-tenant enqueue path. ⛔ Do NOT "fix" this by restoring the old RAISE NOTICE/RETURN skip: that made this file exit 0 having asserted nothing, on exactly the run where this function first reaches PROD.';
  END IF;

  -- ----- anti-vacuity precondition on arm A -------------------------------
  -- Arm A is meaningless if this session already has the activation setting on.
  -- Detect that rather than paper over it: silently forcing the setting off here
  -- would turn "the flag is fail-closed" into "the test set it to off", which
  -- proves nothing about the unset case.
  IF COALESCE(current_setting('app.ledger_refresh_enabled', TRUE), '') = 'true' THEN
    RAISE EXCEPTION 'TEST ABORTED: the activation setting is already true in this session, so arm A cannot test the DORMANT case. Run this file in a clean session.';
  END IF;

  -- ----- FOREIGN-CANDIDATE PRECONDITION (read-only) -----------------------
  -- Arms G1/G2 measure a GLOBAL bound — the per-tick LIMIT and the per-venue cap
  -- are global — so a pre-existing eligible strategy on this database would
  -- compete for those slots and make the counts wrong.
  --
  -- ⛔ It is NOT acceptable to solve that by parking those rows. supabase/tests
  -- run against ONE SHARED test project concurrently with other PRs, and an
  -- UPDATE touching rows this block did not seed writes across another PR's live
  -- fixture mid-run: the surrounding ROLLBACK hides that from the WRITER, not
  -- from a concurrent READER, and the failure then surfaces in a completely
  -- different file. That is the D-05 hazard
  -- (analytics-service/tests/test_sql_gate_scoped_updates.py) and this file will
  -- not create a second instance of it on a neighbouring table.
  --
  -- So: measure, and fail LOUD. A concurrent PR's fixtures are uncommitted and
  -- therefore invisible here, so a non-zero count means the test project carries
  -- COMMITTED ledger-backed strategies that are stale and live — a standing
  -- property of the project, not a race, and one a human should look at rather
  -- than one this file should silently paper over.
  SELECT count(*) INTO v_foreign
    FROM public.ledger_refresh_staleness lrs
    JOIN public.strategies s ON s.id = lrs.strategy_id
   WHERE lrs.is_stale
     AND s.status IN ('published', 'pending_review');
  IF v_foreign <> 0 THEN
    RAISE EXCEPTION 'TEST PRECONDITION FAILED: % committed strategy/strategies on this database are already stale, live and ledger-backed. They would compete with this file''s fixtures for the global per-tick LIMIT and make arms G1/G2 measure the wrong thing. Park or clean them in the test project — do NOT make this file update rows it did not seed (D-05: shared project, concurrent PRs).', v_foreign;
  END IF;

  -- ----- SEED --------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'lrf-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'lrf', 'lrf-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  -- Venue literals appear in the FIXTURES only. The function under test declares
  -- none (D-05) — it reads the cohort from public.ledger_refresh_staleness, which
  -- is the single SQL home of the set. A fixture naming a venue is a fixture; a
  -- production predicate naming one is a second drift surface.
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'lrf v1', 'x', TRUE) RETURNING id INTO k_led;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'deribit', 'lrf v2 a', 'x', TRUE) RETURNING id INTO k_led2;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'deribit', 'lrf v2 b', 'x', TRUE) RETURNING id INTO k_led2b;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'lrf inactive', 'x', FALSE) RETURNING id INTO k_inactive;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, sync_status)
  VALUES (uid, 'mt5', 'lrf revoked', 'x', TRUE, 'revoked') RETURNING id INTO k_revoked;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, disconnected_at)
  VALUES (uid, 'mt5', 'lrf disconnected', 'x', TRUE, now()) RETURNING id INTO k_disc;

  -- Every fixture is seeded PARKED ('draft'), and each arm un-parks exactly the
  -- fixtures it is about. Lifecycle is the parking lever precisely because no arm
  -- here tests it, so parking cannot mask the conjunct any arm is measuring.
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led,      'lrf A',  'draft') RETURNING id INTO s_a;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led2,     'lrf C',  'draft') RETURNING id INTO s_c;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led,      'lrf F',  'draft') RETURNING id INTO s_f;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_inactive, 'lrf H1', 'draft') RETURNING id INTO s_h_inact;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_revoked,  'lrf H2', 'draft') RETURNING id INTO s_h_revoked;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_disc,     'lrf H3', 'draft') RETURNING id INTO s_h_disc;

  -- Arm D's composite: api_key_id NULL (mutually exclusive with the single-key
  -- link), venue reachable only through strategy_keys.
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, NULL, 'lrf D', 'draft') RETURNING id INTO s_d;
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_d, k_led2,  uid, CURRENT_DATE - 400, 0);
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_d, k_led2b, uid, CURRENT_DATE - 200, 1);

  WITH ins AS (
    INSERT INTO strategies (user_id, api_key_id, name, status)
    SELECT uid, k_led, 'lrf G1 ' || g, 'draft' FROM generate_series(1, 6) g
    RETURNING id
  ) SELECT array_agg(id) INTO g1_v1 FROM ins;
  WITH ins AS (
    INSERT INTO strategies (user_id, api_key_id, name, status)
    SELECT uid, k_led, 'lrf G2v1 ' || g, 'draft' FROM generate_series(1, 6) g
    RETURNING id
  ) SELECT array_agg(id) INTO g2_v1 FROM ins;
  WITH ins AS (
    INSERT INTO strategies (user_id, api_key_id, name, status)
    SELECT uid, k_led2, 'lrf G2v2 ' || g, 'draft' FROM generate_series(1, 6) g
    RETURNING id
  ) SELECT array_agg(id) INTO g2_v2 FROM ins;

  -- Analytics rows. STALE = a returns_series whose newest date is far past the
  -- 4-day threshold; FRESH = yesterday. Both use the success status the whole
  -- live ledger cohort actually carries (D-04) — a fixture written as 'complete'
  -- would test a status no live ledger row has.
  --
  -- ISOLATION BY CONSTRUCTION, belt to the precondition's braces: the stale
  -- fixtures are dated a CENTURY back, so they outrank any plausible foreign row
  -- under the fan-out's `ORDER BY last_return_date ASC` and take the bounded
  -- slots first. Same idiom, and the same reason, as the reaper gate's
  -- century-old seeds (Phase 142.1 / D-05).
  --
  -- ⚠️ g2_v1 is dated a further century back than g2_v2, and that stagger is
  -- LOAD-BEARING: with the per-venue cap deleted, arm G2's four slots then fill
  -- entirely from one venue (4/0) instead of splitting by luck, so the cap's
  -- neutering reddens G2 deterministically rather than tie-break-dependently.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  SELECT sid, 'complete_with_warnings', now(),
         jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 36500, 'YYYY-MM-DD'), 'value', 0.001))
    FROM unnest(ARRAY[s_a, s_d, s_f, s_h_inact, s_h_revoked, s_h_disc]
                || g1_v1 || g2_v2) AS sid;
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  SELECT sid, 'complete_with_warnings', now(),
         jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 73000, 'YYYY-MM-DD'), 'value', 0.001))
    FROM unnest(g2_v1) AS sid;

  -- Arm C's negative control: genuinely fresh, so is_stale is FALSE.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  VALUES (s_c, 'complete_with_warnings', now(),
          jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 1, 'YYYY-MM-DD'), 'value', 0.004)));

  -- Arm F's prior ATTEMPT: terminal (so the in-flight conjunct is not what is
  -- being measured), created 2 hours ago (so the 20-hour cooldown is).
  INSERT INTO compute_jobs (strategy_id, kind, status, created_at)
  VALUES (s_f, 'derive_broker_dailies', 'done', now() - INTERVAL '2 hours');

  RAISE NOTICE 'Seed OK.';

  -- ======================================================================
  -- ARM A — DORMANCY (LEDGER-02). The activation setting is untouched, so it
  -- is unset. A maximally stale, fully eligible strategy is on the table and
  -- the function must still do NOTHING. This is the arm that says "merging
  -- this migration changes no production behaviour".
  -- ======================================================================
  -- RED-UNDER: neuter the fail-closed activation switch in 20260825130000 —
  --            compare v_enabled against a word no setting ever holds, so the
  --            unset case falls THROUGH to the fan-out instead of returning 0.
  --            The dormancy claim is the whole "merging changes no production
  --            behaviour" property, so this is the mutation that proves arm A
  --            is what holds it.
  -- RED-UNDER-M: {"arm":"A","apply":[{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"IF v_enabled <> 'true' THEN","replace":"IF v_enabled = 'never-a-real-setting' THEN","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id = s_a;

  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (A): the fan-out returned % with the activation setting UNSET, expected 0 — the dormancy lock is open and merging this migration would change production behaviour', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_a;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (A): the fan-out inserted % job(s) with the activation setting UNSET, expected 0', v_cnt;
  END IF;

  -- Everything below runs with the switch ON. is_local => true, so it unwinds
  -- with the transaction and cannot leak into a later file on this session.
  PERFORM set_config('app.ledger_refresh_enabled', 'true', TRUE);

  -- ======================================================================
  -- RED-UNDER: change the enqueued job's metadata `source` marker in
  --            20260825130000. The job still lands, so the count and
  --            target-shape assertions stay green — what reddens is the
  --            byte-for-byte marker the non-destructive failure guard in
  --            job_worker.py reads back before it declines to downgrade a
  --            published row.
  -- RED-UNDER-M: {"arm":"B","apply":[{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"'source', 'ledger-refresh',","replace":"'source', 'ledger-refresh-drifted',","occurrences":1}]}
  -- ARM B — POSITIVE (LEDGER-01). Same seed, switch on.
  -- ======================================================================
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (B): the fan-out returned % for one eligible stale strategy, expected 1 — this integer is the INSERTION count the go-live runbook has the founder read back, so a wrong value there is a wrong answer at activation', v_ret;
  END IF;

  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_a AND kind = 'derive_broker_dailies';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (B): the eligible stale strategy got % derive_broker_dailies job(s), expected exactly 1', v_cnt;
  END IF;

  -- Strategy-scoped, and ONLY strategy-scoped. enqueue_compute_job enforces
  -- exactly-one-of {strategy, allocator, api_key} and raises 22023 otherwise
  -- (measured on PROD during the A7 tracer), so a fan-out that also passed a key
  -- would not enqueue at all — this shape assertion is what names that failure.
  SELECT strategy_id, portfolio_id, allocator_id, api_key_id, metadata ->> 'source'
    INTO v_strat, v_port, v_alloc, v_api, v_source
    FROM compute_jobs
   WHERE strategy_id = s_a AND kind = 'derive_broker_dailies'
   LIMIT 1;
  IF v_strat IS DISTINCT FROM s_a OR v_port IS NOT NULL OR v_alloc IS NOT NULL OR v_api IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B): job target shape wrong (strategy set=% portfolio=% allocator=% api_key=%) — expected strategy-only', (v_strat IS NOT NULL), v_port, v_alloc, v_api;
  END IF;

  -- EXACT equality, never IS NOT NULL and never LIKE. The Python guard in
  -- analytics-service/services/job_worker.py compares this string byte-for-byte
  -- before it declines to downgrade a published row; if the two spellings drift
  -- the fan-out still enqueues and the guard still compiles, and the only symptom
  -- is that the next failed refresh silently un-publishes a funded account. A
  -- typo must be RED here, not in production.
  IF v_source IS DISTINCT FROM 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (B): job metadata source is %, expected the exact refresh marker — the non-destructive failure guard keys on this string', COALESCE(v_source, '<null>');
  END IF;

  -- ======================================================================
  -- RED-UNDER: remove all three things that make a second tick a no-op, in one
  --            LAYERED mutation of 20260825130000: the 20-hour attempt cooldown
  --            (interval -> 0), the non-terminal in-flight guard (status set ->
  --            a status nothing holds), and the INSERTIONS-not-CALLS counter
  --            (v_existing = 0 dropped). All three are needed: leave any one in
  --            place and the second tick still returns 0 for a different reason,
  --            which would make a green here prove the wrong conjunct.
  -- RED-UNDER-M: {"arm":"E","apply":[{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"INTERVAL '20 hours'","replace":"INTERVAL '0 hours'","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"AND cj2.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')","replace":"AND cj2.status IN ('cancelled')","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"IF v_existing = 0 AND v_job_id IS NOT NULL THEN","replace":"IF v_job_id IS NOT NULL THEN","occurrences":1}]}
  -- ARM E — DEDUPE. A second tick while the job is in flight adds nothing.
  -- ======================================================================
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (E): the second consecutive tick returned %, expected 0 (the in-flight conjunct plus the RPC dedupe)', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_a AND kind = 'derive_broker_dailies';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (E): after a second tick the strategy has % derive_broker_dailies jobs, expected 1', v_cnt;
  END IF;

  UPDATE strategies SET status = 'draft' WHERE id = s_a;

  -- ======================================================================
  -- ARM C — NEGATIVE CONTROL. A FRESH single-key strategy is not enqueued.
  -- Without this arm, a body that enqueues everything passes arm B.
  -- ======================================================================
  -- RED-UNDER: make the staleness conjunct in 20260825130000's candidate CTE
  --            vacuous (`WHERE lrs.is_stale` -> `WHERE (lrs.is_stale OR TRUE)`).
  --            Only s_c is published at this point, so no earlier arm's cohort
  --            changes; the fresh strategy becomes a candidate and every ledger
  --            strategy would be refreshed on every tick.
  -- RED-UNDER-M: {"arm":"C","apply":[{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"WHERE lrs.is_stale","replace":"WHERE (lrs.is_stale OR TRUE)","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id = s_c;
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (C): a FRESH strategy produced % enqueue(s), expected 0 — the staleness gate is not bounding the cohort and every ledger strategy would be refreshed on every tick', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_c;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (C): a FRESH strategy got % job(s), expected 0', v_cnt;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id = s_c;

  -- ======================================================================
  -- ARM D — COMPOSITE EXCLUSION (D-01). A stale composite gets NOTHING from
  -- this function: not a derive (it has no api_key_id for strategy-mode to
  -- resolve) and not a stitch either (this function owns only the single-key
  -- arm; the composite arm ships separately).
  --
  -- ⚠️ This arm is only meaningful if the composite REACHES the is_composite
  -- conjunct. The migration's api_keys join is LEFT and its key-eligibility
  -- conjuncts are NULL-tolerant precisely so it does. Before trusting a GREEN
  -- here, delete the is_composite conjunct and re-run: this arm MUST redden. If
  -- it stays green, the composite is being excluded by the join or by a key
  -- conjunct instead, the exclusion is unfalsifiable, and the predicate — not
  -- this arm — is what needs fixing.
  -- ======================================================================
  -- RED-UNDER: delete the composite exclusion in 20260825130000 —
  --            `AND lrs.is_composite = FALSE` -> `AND lrs.is_composite IS NOT NULL`.
  --            This is the re-run this arm's own ⚠️ note demands before any
  --            green here is trusted: the composite REACHES the conjunct (the
  --            api_keys join is LEFT and the key conjuncts are NULL-tolerant),
  --            so it is is_composite, and nothing else, that excludes it.
  -- RED-UNDER-M: {"arm":"D","apply":[{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"AND lrs.is_composite = FALSE","replace":"AND lrs.is_composite IS NOT NULL","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id = s_d;
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D): a stale COMPOSITE produced % enqueue(s), expected 0 — strategy-mode derive resolves its key through strategies.api_key_id, which a composite has NULL, so it cannot serve one at all', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_d AND kind = 'derive_broker_dailies';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D): a stale COMPOSITE got % derive_broker_dailies job(s), expected 0', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_d AND kind = 'stitch_composite';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D): this function enqueued % stitch_composite job(s) — it owns the single-key arm only', v_cnt;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id = s_d;

  -- ======================================================================
  -- ARM F — ATTEMPT COOLDOWN (D-09). This is the BINDING bound: it is what
  -- stops a permanently-failing strategy being hammered every tick, and it is
  -- what caps the outstanding backlog at the cohort size regardless of tick
  -- rate. Both edges, so the interval cannot drift silently.
  -- ======================================================================
  -- RED-UNDER: narrow the ATTEMPT cooldown in 20260825130000 from 20 hours to
  --            1 hour. The fixture's prior attempt is 2 hours old, so the
  --            narrowed window no longer covers it and the strategy is
  --            re-enqueued — a permanently-failing strategy would get a job
  --            every tick. Arm E's second tick is unaffected: its job is created
  --            inside this transaction, so it is still inside a 1-hour window.
  -- RED-UNDER-M: {"arm":"F","apply":[{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"INTERVAL '20 hours'","replace":"INTERVAL '1 hour'","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id = s_f;
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (F): a strategy attempted 2 hours ago produced % enqueue(s), expected 0 — without the cooldown a permanently-failing strategy gets a job every tick', v_ret;
  END IF;

  UPDATE compute_jobs SET created_at = now() - INTERVAL '21 hours'
   WHERE strategy_id = s_f AND kind = 'derive_broker_dailies';

  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (F): a strategy whose last attempt is 21 hours old produced % enqueue(s), expected 1 — the cooldown has been widened past its derivation and stale strategies would never be refreshed', v_ret;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id = s_f;

  -- ======================================================================
  -- ARM G1 — the PER-VENUE CAP (D-09). Six stale eligible strategies on ONE
  -- venue. With a per-tick LIMIT of 4 and a per-venue cap of 2, only the CAP
  -- can produce 2; delete the cap and this tick yields 4. That discrimination
  -- is the whole point, and it is why the LIMIT must stay strictly greater
  -- than the cap.
  --
  -- ⚠️ Counts, never a duration or a rate. This arm pins the SHAPE of the
  -- bound. The safety argument is arm F's cooldown, NOT this LIMIT — see D-09.
  -- ======================================================================
  -- RED-UNDER: widen the PER-VENUE cap in 20260825130000 from
  --            `venue_rank <= 2` to `venue_rank <= 4`. The per-tick LIMIT is 4
  --            and this cohort is 6 on ONE venue, so with the cap gone the
  --            global LIMIT bounds the tick at 4 instead — exactly the "a venue
  --            that serialises every job starves every other venue" result this
  --            arm names, and the discrimination the LIMIT-strictly-greater-
  --            than-cap rule exists to preserve.
  -- RED-UNDER-M: {"arm":"G1","apply":[{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"WHERE c.venue_rank <= 2","replace":"WHERE c.venue_rank <= 4","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id = ANY(g1_v1);
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (G1): 6 stale strategies on ONE venue produced % enqueue(s), expected exactly 2 — the per-venue cap. A result of 4 means the cap is gone and the global LIMIT bound the tick instead; a venue that serialises every job on one shared terminal registry would then starve every other venue', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = ANY(g1_v1) AND kind = 'derive_broker_dailies';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (G1): % derive_broker_dailies rows landed for the single-venue cohort, expected exactly 2', v_cnt;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id = ANY(g1_v1);

  -- ======================================================================
  -- ARM G2 — the SPREAD, and the LIMIT's lower edge (D-09). Six stale on each
  -- of TWO venues: the tick spreads across venues (2 + 2) instead of exhausting
  -- the oldest one, and it stops at 4.
  --
  -- ⚠️ Stated precisely, because overclaiming here would be the same species of
  -- error as a wrong derivation. With two venues and a cap of 2, four is ALSO
  -- the ceiling the cap alone imposes, so this arm does not by itself prove the
  -- LIMIT is exactly 4. What it does pin: the 2/2 SPREAD (delete the cap and the
  -- older venue takes all four — the date stagger in the seed makes that
  -- deterministic), and the LIMIT's LOWER edge (drop it below 4 and this arm
  -- reddens). The UPPER edge is plan 05 gate 5, which asserts statically that the
  -- LIMIT is at most 4 and strictly greater than the cap. Neither half is
  -- sufficient alone; together they pin the integer.
  -- ======================================================================
  -- RED-UNDER: lower the per-tick LIMIT in 20260825130000 from 4 to 3. This is
  --            the LOWER edge this arm's own note says it pins (the UPPER edge
  --            is the static gate). The needle carries its indentation: the
  --            unindented `LIMIT 4` at :194 is PROSE, and mutating a comment
  --            would be a no-op reported as a non-biting arm.
  -- RED-UNDER-M: {"arm":"G2","apply":[{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"       LIMIT 4","replace":"       LIMIT 3","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id = ANY(g2_v1) OR id = ANY(g2_v2);
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 4 THEN
    RAISE EXCEPTION 'TEST FAILED (G2): 6 stale strategies on each of two venues produced % enqueue(s), expected exactly 4 — the per-tick burst LIMIT has been lowered below its derivation', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = ANY(g2_v1) AND kind = 'derive_broker_dailies';
  SELECT count(*) INTO v_cnt2 FROM compute_jobs
   WHERE strategy_id = ANY(g2_v2) AND kind = 'derive_broker_dailies';
  IF v_cnt <> 2 OR v_cnt2 <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (G2): the tick landed %/% jobs across the two venues, expected 2/2 — a tick that exhausts one venue before touching the other is exactly the starvation the partition exists to prevent', v_cnt, v_cnt2;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id = ANY(g2_v1) OR id = ANY(g2_v2);

  -- ======================================================================
  -- ARM H — KEY ELIGIBILITY. Three sub-cases, each a stale strategy whose key
  -- is disqualified for a different reason. A revoked or soft-disconnected key
  -- keeps is_active = TRUE (rows persist for audit), so is_active alone does
  -- not cover the other two.
  -- ======================================================================
  -- RED-UNDER: point the REVOKED-key conjunct in 20260825130000 at a status no
  --            key ever holds, so a revoked key is admitted. The aggregate arm
  --            reads the RETURN value, so any one of the three sub-cases
  --            leaking is enough to redden it.
  -- RED-UNDER-M: {"arm":"H","apply":[{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"AND ak.sync_status IS DISTINCT FROM 'revoked'","replace":"AND ak.sync_status IS DISTINCT FROM 'never-a-real-status'","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id IN (s_h_inact, s_h_revoked, s_h_disc);
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H): strategies whose keys are inactive / revoked / disconnected produced % enqueue(s), expected 0', v_ret;
  END IF;

  -- RED-UNDER: make the is_active conjunct in 20260825130000 vacuous, with the
  --            aggregate arm H NEUTERED — H reads the RETURN value and fires
  --            first on any leak at all, so it must be suppressed for the
  --            per-fixture row count to be the first failure. The other two
  --            sub-case fixtures stay excluded by their own conjuncts, so this
  --            names the INACTIVE case alone.
  -- RED-UNDER-M: {"arm":"H/inactive","apply":[{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"AND COALESCE(ak.is_active, TRUE)","replace":"AND (COALESCE(ak.is_active, TRUE) OR TRUE)","occurrences":1}],"neuter":[{"arm":"H"}]}
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_h_inact;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H/inactive): an INACTIVE key produced % job(s), expected 0', v_cnt;
  END IF;
  -- RED-UNDER: as H, with arm H neutered so the per-fixture count is the first
  --            failure. A revoked key keeps is_active TRUE, so this sub-case is
  --            reachable ONLY through the sync_status conjunct — which is the
  --            claim the arm makes in its own message.
  -- RED-UNDER-M: {"arm":"H/revoked","apply":[{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"AND ak.sync_status IS DISTINCT FROM 'revoked'","replace":"AND ak.sync_status IS DISTINCT FROM 'never-a-real-status'","occurrences":1}],"neuter":[{"arm":"H"}]}
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_h_revoked;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H/revoked): a REVOKED key produced % job(s), expected 0 — a revoked key keeps is_active TRUE, so the is_active conjunct alone does not cover this case', v_cnt;
  END IF;
  -- RED-UNDER: make the soft-disconnect conjunct in 20260825130000 vacuous,
  --            with arm H neutered. A soft-disconnected key also keeps
  --            is_active TRUE and a non-revoked sync_status, so only this
  --            conjunct can exclude it.
  -- RED-UNDER-M: {"arm":"H/disconnected","apply":[{"kind":"edit","file":"supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","find":"AND ak.disconnected_at IS NULL","replace":"AND (ak.disconnected_at IS NULL OR TRUE)","occurrences":1}],"neuter":[{"arm":"H"}]}
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_h_disc;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H/disconnected): a DISCONNECTED key produced % job(s), expected 0 — a soft-disconnected key also keeps is_active TRUE', v_cnt;
  END IF;

  -- ======================================================================
  -- ARM I — THE EXECUTE ACL, RE-ASSERTED ON EVERY RUN (161.1-AUDIT F-1).
  --
  -- Migration 20260825130000's DO block already checks this — ONCE, at apply. A later
  -- migration, a GRANT sweep, a role-template change or a restore-from-dump can
  -- undo it and nothing would notice. Not theoretical here:
  -- 20260515130001_enqueue_compute_job_internal_acl_remediation.sql exists
  -- precisely because a REVOKE on an enqueue path was lost.
  --
  -- ⛔ WHY THIS ONE REVOKE CARRIES THE WHOLE BOUND. If EXECUTE ever regressed to
  -- `authenticated`, the two NOT EXISTS guards this function relies on go
  -- VACUOUSLY TRUE for that caller: `strategies_read` shows an authenticated role
  -- its own published+owned strategies, while compute_jobs' FORCE-RLS deny-all
  -- returns it zero rows — so "no job already in flight" and "no recent attempt"
  -- are both trivially satisfied, every tick, forever. The result is unbounded
  -- self-scoped enqueue at the per-tick cap. Nothing downstream closes that path;
  -- the REVOKE is the only thing that does, and this arm is what keeps it closed.
  --
  -- ⚠️ NOT VACUOUS WHEN THE FUNCTION IS GONE: has_function_privilege raises 42883
  -- on a missing function rather than returning FALSE, so "no grants because there
  -- is nothing to grant on" reddens here instead of passing.
  -- ======================================================================
  -- RED-UNDER: `GRANT EXECUTE … TO anon` on the live lane. It is a `sql` step
  --            rather than an edit to the REVOKE in 20260825130000 because that
  --            migration's own DO block asserts the same privilege and would
  --            ABORT THE APPLY, so the gate would never run. The lane's
  --            --post-apply hook exists for exactly this shape.
  -- RED-UNDER-M: {"arm":"I","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.enqueue_ledger_refresh_for_strategies() TO anon"}]}
  IF has_function_privilege('anon', 'public.enqueue_ledger_refresh_for_strategies()', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (I): role anon can EXECUTE enqueue_ledger_refresh_for_strategies. This is a cross-tenant SECURITY DEFINER enqueue path and the REVOKE at 20260825130000 is the only thing bounding it';
  END IF;
  IF has_function_privilege('authenticated', 'public.enqueue_ledger_refresh_for_strategies()', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (I): role authenticated can EXECUTE enqueue_ledger_refresh_for_strategies. Both NOT EXISTS guards in its body go vacuously TRUE for that role (strategies_read grants it its own rows; compute_jobs FORCE-RLS grants it none), so this is unbounded self-scoped enqueue every tick — the REVOKE at 20260825130000 is the only thing closing it';
  END IF;

  -- ======================================================================
  -- ARM J — THE DEFINER'S RLS EXEMPTION, RE-ASSERTED ON EVERY RUN
  --         (161.1-REVIEW, RLS audit).
  --
  -- Same weakness as arm I, one property over. Migration 20260825130000's DO
  -- block pins proowner's exemption ONCE, at apply. Ownership drifts for
  -- reasons that have nothing to do with this function: a restore-from-dump, an
  -- `ALTER FUNCTION … OWNER TO`, a platform role-template change, a REASSIGN
  -- OWNED. The ACL arms exist because an apply-time-only pin is not a durable
  -- pin; this arm says the same thing about ownership.
  --
  -- ⛔ WHY THIS IS THE WORST SILENT FAILURE IN THE PHASE. It leaks NOTHING — it
  -- is fail-CLOSED — and that is exactly what makes it dangerous. This function
  -- is SECURITY DEFINER, so every read in its body runs as the OWNER, and it
  -- reads ledger_refresh_staleness, a `security_invoker` view. Drift the owner
  -- to a role exempt from RLS by neither route and the owner-scoped policies on
  -- api_keys / strategy_keys resolve `exchanges` to the empty array; the
  -- terminal `&&` venue conjunct then drops EVERY candidate row and the fan-out
  -- returns 0 on every tick, forever. Zero enqueued, zero errors, green cron —
  -- byte-identical to a healthy, fully-fresh estate. Nothing downstream can
  -- tell the two apart, so if this is not asserted here it is not asserted
  -- anywhere the drift would actually be caught.
  --
  -- ⚠️ rolsuper OR rolbypassrls, matching the migration — NOT rolbypassrls
  -- alone. pg_roles.rolbypassrls reports only the EXPLICITLY GRANTED attribute;
  -- a superuser bypasses RLS unconditionally with the flag still FALSE. An arm
  -- pinning rolbypassrls alone would redden on an owner that can in fact see
  -- the whole cohort, and would contradict the predicate the migration applies.
  --
  -- ⚠️ NOT VACUOUS WHEN THE FUNCTION IS GONE. Unlike arm I, this arm cannot
  -- lean on has_function_privilege's 42883: a bare SELECT over pg_proc for an
  -- absent proname returns ZERO ROWS, leaves all three variables NULL, and
  -- `NOT (COALESCE(NULL,FALSE) OR COALESCE(NULL,FALSE))` would be TRUE — the
  -- arm would fire with a misleading message about a role called <NULL>. The
  -- explicit v_owner IS NULL guard below is what turns "nothing to check" into
  -- its own named failure rather than a passing or mis-diagnosed one.
  -- ======================================================================
  -- RED-UNDER: ownership drift on the live lane — `ALTER FUNCTION … OWNER TO` a
  --            role that is exempt from row security by NEITHER route. Editing
  --            20260825130000 cannot reach this arm: its own DO block asserts
  --            the same disjunction and would abort the apply.
  -- ⚠️ The three RLS-enabled tables move with the function DELIBERATELY. Left
  --    behind, the new owner reads them under RLS and the fan-out returns 0 on
  --    every tick — which is precisely the failure this arm's prose describes,
  --    and it reddens arm B three hundred lines earlier instead. Moving them
  --    isolates the ONE property under test: the owner's exemption.
  -- RED-UNDER-M: {"arm":"J","apply":[{"kind":"sql","stmt":"CREATE ROLE lrf_owner_drift NOLOGIN"},{"kind":"sql","stmt":"GRANT USAGE ON SCHEMA public TO lrf_owner_drift"},{"kind":"sql","stmt":"GRANT SELECT ON ALL TABLES IN SCHEMA public TO lrf_owner_drift"},{"kind":"sql","stmt":"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO lrf_owner_drift"},{"kind":"sql","stmt":"ALTER TABLE public.strategies OWNER TO lrf_owner_drift"},{"kind":"sql","stmt":"ALTER TABLE public.strategy_keys OWNER TO lrf_owner_drift"},{"kind":"sql","stmt":"ALTER TABLE public.compute_jobs OWNER TO lrf_owner_drift"},{"kind":"sql","stmt":"ALTER FUNCTION public.enqueue_ledger_refresh_for_strategies() OWNER TO lrf_owner_drift"}]}
  SELECT r.rolname, r.rolsuper, r.rolbypassrls
    INTO v_owner, v_own_super, v_own_bypass
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public'
     AND p.proname = 'enqueue_ledger_refresh_for_strategies';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (J): could not resolve the owner of enqueue_ledger_refresh_for_strategies — the pg_proc row is absent, or its proowner has no matching pg_roles row. Either way arm J checked NOTHING, which is why this is an exception and not a silent pass';
  END IF;
  IF NOT (COALESCE(v_own_bypass, FALSE) OR COALESCE(v_own_super, FALSE)) THEN
    RAISE EXCEPTION 'TEST FAILED (J): enqueue_ledger_refresh_for_strategies is owned by role "%" (rolsuper=%, rolbypassrls=%), which is exempt from RLS by neither route. As SECURITY DEFINER it reads the security_invoker view ledger_refresh_staleness as that role, so api_keys/strategy_keys RLS collapses `exchanges` to the empty array, the venue conjunct drops every row, and the fan-out returns 0 on every tick — indistinguishable from a healthy, fully-fresh estate. Migration 20260825130000 pins this at apply time only; ownership drift afterwards is what this arm exists to catch', v_owner, v_own_super, v_own_bypass;
  END IF;

  RAISE NOTICE 'ALL 10 ARMS EXECUTED (A-J) and passed — the ledger refresh fan-out is dormant, bounded, and its bounds are falsifiable.';
END $$;

ROLLBACK;
