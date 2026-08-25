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
-- ⚠️ The presence gate below RETURNs with a NOTICE when the function is absent,
-- for test-DB lag. A skipped gate is a VACUOUSLY GREEN gate. The final
-- 'ALL 8 ARMS EXECUTED' notice is what distinguishes a real pass from a skip —
-- read it in the run output, do not infer it from the exit code.
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
BEGIN
  -- ----- presence gate (test-DB lag) -------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'enqueue_ledger_refresh_for_strategies'
  ) THEN
    RAISE NOTICE 'SKIP: migration 20260825130000 not yet applied here (fan-out fn absent). Assertions enforce once the test DB catches up.';
    RETURN;
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
  UPDATE strategies SET status = 'published' WHERE id IN (s_h_inact, s_h_revoked, s_h_disc);
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H): strategies whose keys are inactive / revoked / disconnected produced % enqueue(s), expected 0', v_ret;
  END IF;

  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_h_inact;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H/inactive): an INACTIVE key produced % job(s), expected 0', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_h_revoked;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H/revoked): a REVOKED key produced % job(s), expected 0 — a revoked key keeps is_active TRUE, so the is_active conjunct alone does not cover this case', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_h_disc;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H/disconnected): a DISCONNECTED key produced % job(s), expected 0 — a soft-disconnected key also keeps is_active TRUE', v_cnt;
  END IF;

  RAISE NOTICE 'ALL 8 ARMS EXECUTED (A-H) and passed — the ledger refresh fan-out is dormant, bounded, and its bounds are falsifiable.';
END $$;

ROLLBACK;
