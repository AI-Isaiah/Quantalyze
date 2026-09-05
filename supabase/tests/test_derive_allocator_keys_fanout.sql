-- Test: enqueue_derive_broker_dailies_for_allocator_keys fan-out eligibility +
-- derive_allocator_equity kind-CHECK admission + the api_key-coherence-arm
-- SURVIVAL regression. Guards migration
-- 20260717233529_allocator_equity_derived_surface.sql (Phase 115.1 / Q4 +
-- T-115.1-05).
--
-- Three load-bearing properties:
--   1. The recurring key-mode fan-out enqueues EXACTLY the eligible keys
--      (is_active AND sync_status IS DISTINCT FROM 'revoked' AND disconnected_at
--      IS NULL — the role-agnostic eligible_key_predicate / phase35 filter), as
--      api_key-scoped derive_broker_dailies jobs (api_key_id set, all other
--      targets NULL), and a second call does NOT duplicate (in-flight dedup).
--   2. compute_jobs admits derive_allocator_equity with an allocator_id target
--      and REJECTS it with a mis-scoped target (coherence).
--   3. RE-BASE REGRESSION: a derive_broker_dailies row with an api_key_id target
--      still INSERTs — proving the api_key coherence arm SURVIVED the CHECK
--      re-base. This is the exact silent-failure mode migration 20260710130000's
--      header warns about: copying an OLDER coherence def drops the api_key arm
--      and breaks every allocator key-mode derive.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- SERIAL execution: the fan-out uses a SESSION advisory lock; run the sql-tests
-- job serially (the repo already runs supabase/tests/*.sql one file at a time)
-- so a concurrent holder cannot make the fn skip and redden assertion 1.
--
-- Test-DB lag: assertions are gated on the fan-out function being present
-- (NOTICE skip otherwise); the migration is MCP-applied to the TEST project
-- before this runs, so the gate enforces there.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_derive_allocator_keys_fanout.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4.1, PGCRON-LANE). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
--
-- ⚠️ THE APPLY LIST BELOW IS SIZED BY THE TWO SKIPS, NOT BY THIS HEADER. A
-- section behind a still-firing skip is un-falsifiable, so the list carries
-- every file those two skips key on:
--   * `:56` (fan-out fn absent) keys on 20260717233529 — which needs the whole
--     compute_jobs chain beneath it: 20260411144407 (queue + kinds registry),
--     20260418194206 (compute_jobs.allocator_id), 20260420073003 (the api_key
--     target column, enqueue_compute_job's api_key mode and the in-flight
--     partial unique index) and 20260614120000. MEASURED 2026-09-05: without
--     that last one assertion 1's fan-out dies on compute_jobs_kind_fkey — the
--     derive_broker_dailies REGISTRY ROW, not the gate, is what is missing.
--   * `:169` (pg_cron absent) keys on 20260513094906_enable_pg_cron.sql, which
--     is listed AHEAD of every migration that probes `pg_extension` or calls
--     `cron.schedule` (20260420073003 STEP 8 and 20260717233529 STEP 5 both do).
--     The pg-lane PRELOADS the pg_cron library (phase 164.4.1 plan 01) but
--     never runs CREATE EXTENSION itself: a gate declares that need by listing
--     this migration, so what the lane installs is the repo's own DDL.
-- MEASURED 2026-09-05 on the lane: with this list the baseline exits 0 and this
-- gate prints ZERO `SKIP` / `skipping` lines of its own, so assertion 6 RUNS and
-- is falsified rather than withheld. ⚠️ Count the skip lines carrying THIS
-- file's `psql:supabase/tests/…` prefix, not every skip line in the transcript:
-- PostgreSQL emits its own `does not exist, skipping` DDL chatter during the
-- apply (28 lines here; the already-annotated reference file
-- test_metrics_by_basis_write.sql prints 15 on a GREEN baseline), and no gate
-- controls those.
--
-- ⚠️ ORACLE SCOPE for assertion 6 on a lane. `cron.job` holds whatever THIS
-- apply list just scheduled, so the lane proves the assertion is FALSIFIABLE.
-- It cannot prove anything about deployment drift on PROD, where that row is
-- the product of every migration ever applied. Stated here because assertion 6
-- reads a CATALOG rather than a constraint, which makes the scope easy to
-- overread in the other direction.
--
-- ⚠️ Assertions 1-7 are ALL sections: every one of them raises, so every one is
-- twinned. There is no positive-path-only arm in this file.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql"]}

BEGIN;

DO $$
DECLARE
  uid          UUID := gen_random_uuid();
  key_elig     UUID;
  key_mt5      UUID;
  key_revoked  UUID;
  key_disc     UUID;
  key_inact    UUID;
  row_cnt      INTEGER;
  raised       BOOLEAN;
  v_constraint TEXT;
  v_strat      UUID;  v_port UUID;  v_alloc UUID;  v_api UUID;
  v_cron_hour  INT;
BEGIN
  -- ----- presence gate (test-DB lag) -------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'enqueue_derive_broker_dailies_for_allocator_keys'
  ) THEN
    RAISE NOTICE 'SKIP: migration 20260717233529 not yet applied here (fan-out fn absent). Assertions enforce once the test DB catches up.';
    RETURN;
  END IF;

  -- ----- SEED: one allocator + four api_keys of differing eligibility -----
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'aed-fanout-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'aed-fanout', 'aed-fanout-' || uid::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  -- eligible: active, sync_status NULL, not disconnected
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'binance', 'aed eligible', 'x', TRUE) RETURNING id INTO key_elig;
  -- eligible, LEDGER-BACKED venue. Every other fixture key here is 'binance',
  -- so before this row the whole test stayed GREEN under an exchange filter that
  -- dropped mt5 — the same shape of drift that gates /api/cron/reconcile-strategies
  -- (RECONCILABLE_EXCHANGES = FUNDING_EXCHANGES = binance/okx/bybit). See assertion 7.
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'aed eligible mt5', 'x', TRUE) RETURNING id INTO key_mt5;
  -- revoked
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, sync_status)
  VALUES (uid, 'binance', 'aed revoked', 'x', TRUE, 'revoked') RETURNING id INTO key_revoked;
  -- disconnected
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, disconnected_at)
  VALUES (uid, 'binance', 'aed disconnected', 'x', TRUE, now()) RETURNING id INTO key_disc;
  -- inactive
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'binance', 'aed inactive', 'x', FALSE) RETURNING id INTO key_inact;

  RAISE NOTICE 'Seed OK: uid=% elig=% mt5=% revoked=% disc=% inact=%', uid, key_elig, key_mt5, key_revoked, key_disc, key_inact;

  -- ----- ASSERTION 1: fan-out reaches EXACTLY the eligible key ------------
  -- RED-UNDER: drop `AND ak.sync_status IS DISTINCT FROM 'revoked'` from the
  --            eligibility predicate of
  --            enqueue_derive_broker_dailies_for_allocator_keys in migration
  --            20260717233529. A credential-REVOKED key keeps is_active = TRUE
  --            (the rows persist for audit — the migration's own comment at
  --            :212-215 says so), so losing that one conjunct silently puts
  --            every revoked key back in the fan-out: one derive_broker_dailies
  --            job per revoked key per day, each of which the worker can only
  --            fail against a dead credential, and the D3 coverage gate is
  --            pinned to a series that can never advance. Nothing upstream
  --            notices, and that is the point of this arm: the migration's own
  --            STEP 6 self-verify (f) reads the deployed body for
  --            `p_api_key_id`, `derive_broker_dailies` and
  --            `disconnected_at IS NULL` only (:396-403). The revoked conjunct
  --            is not one of the three it names, so the narrowed body applies
  --            perfectly clean and the migration reports success.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","find":"\n        AND ak.sync_status IS DISTINCT FROM 'revoked'","replace":"","occurrences":1}]}
  PERFORM enqueue_derive_broker_dailies_for_allocator_keys();

  SELECT count(*) INTO row_cnt FROM compute_jobs
   WHERE api_key_id = key_elig AND kind = 'derive_broker_dailies' AND status = 'pending';
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (1): eligible key got % pending derive_broker_dailies jobs, expected 1', row_cnt;
  END IF;

  -- the eligible job is api_key-scoped: api_key_id set, all other targets NULL
  SELECT strategy_id, portfolio_id, allocator_id, api_key_id
    INTO v_strat, v_port, v_alloc, v_api
    FROM compute_jobs
   WHERE api_key_id = key_elig AND kind = 'derive_broker_dailies' AND status = 'pending'
   LIMIT 1;
  IF v_api IS DISTINCT FROM key_elig OR v_strat IS NOT NULL OR v_port IS NOT NULL OR v_alloc IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): eligible job target shape wrong (api_key=% strat=% port=% alloc=%) — expected api_key-only', v_api, v_strat, v_port, v_alloc;
  END IF;

  -- revoked / disconnected / inactive keys get NOTHING
  SELECT count(*) INTO row_cnt FROM compute_jobs
   WHERE api_key_id IN (key_revoked, key_disc, key_inact) AND kind = 'derive_broker_dailies';
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1): ineligible keys got % derive_broker_dailies jobs, expected 0', row_cnt;
  END IF;

  -- ----- ASSERTION 2: second call does NOT duplicate (in-flight dedup) ----
  -- RED-UNDER: break the in-flight dedup for api_key-scoped jobs in migration
  --            20260420073003. The 05:30 cron fires once a day, but any manual
  --            re-run, retry or a second scheduler instance would then enqueue
  --            a SECOND derive_broker_dailies job for the same key on the same
  --            day; two workers claim two jobs and derive the same key's
  --            dailies twice, writing the same rows through the same upsert
  --            from two transactions. Nothing above this line would notice —
  --            assertion 1 is satisfied by the FIRST call alone.
  -- ⚠️ LAYERED, and the layering IS the measured finding. Dedup here is
  --    defence in depth with TWO independent halves:
  --    `_enqueue_compute_job_internal`'s optimistic api_key look-up
  --    (20260420073003:392-398) and the partial unique index
  --    compute_jobs_one_inflight_per_kind_api_key (:288-291). MEASURED
  --    2026-09-05: removing EITHER half ALONE leaves this assertion GREEN —
  --    with only the look-up narrowed the INSERT still loses to the index and
  --    the function re-reads the winner's row; with only the index narrowed the
  --    look-up short-circuits before any INSERT is attempted. So a single-step
  --    mutation here is a `no-red`, not a falsifier, and only the pair is
  --    observable at this assertion. Step 2 needs `nth`: those three lines
  --    appear TWICE in that function (the optimistic look-up and the
  --    lost-the-race re-read) and only the first is the short-circuit.
  -- ⚠️ Step 1 is scoped with `kind <> 'derive_broker_dailies'` rather than by
  --    dropping 'pending' from the index predicate outright, because the
  --    migration's own Category-D probe (:1050-1057) requires a raw duplicate
  --    poll_allocator_positions INSERT to STILL trip this index. MEASURED: a
  --    blanket narrowing ABORTS THE APPLY there with `Migration 066 failed: raw
  --    duplicate INSERT should have hit …`, so this gate never runs and no arm
  --    can be the first failure.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20260420073003_allocator_holdings.sql","find":"  ON compute_jobs (api_key_id, kind)\n  WHERE api_key_id IS NOT NULL\n    AND status IN ('pending','running','done_pending_children');","replace":"  ON compute_jobs (api_key_id, kind)\n  WHERE api_key_id IS NOT NULL\n    AND kind <> 'derive_broker_dailies'\n    AND status IN ('pending','running','done_pending_children');","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260420073003_allocator_holdings.sql","find":"     WHERE api_key_id = p_api_key_id\n       AND kind = p_kind\n       AND status IN ('pending', 'running', 'done_pending_children')","replace":"     WHERE api_key_id = p_api_key_id\n       AND kind = p_kind\n       AND status IN ('running', 'done_pending_children')","occurrences":2,"nth":1}]}
  PERFORM enqueue_derive_broker_dailies_for_allocator_keys();
  SELECT count(*) INTO row_cnt FROM compute_jobs
   WHERE api_key_id = key_elig AND kind = 'derive_broker_dailies' AND status = 'pending';
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (2): after second fan-out eligible key has % jobs, expected 1 (dedup)', row_cnt;
  END IF;

  -- ----- ASSERTION 3: derive_allocator_equity admitted with allocator target
  -- ⚠️ The INSERT is wrapped in a nested BEGIN ... EXCEPTION (an implicit
  -- savepoint, so the outer block survives) for the MIRROR-IMAGE reason
  -- assertion 4's wrap exists: 4 needs the handler because the rejection is the
  -- PASS; 3 needs it because the rejection is the FAILURE — and an UNHANDLED
  -- 23514 here aborts psql with a raw driver error BEFORE this arm can name
  -- itself, so the one production change this assertion exists to refuse would
  -- be indistinguishable from any other crash. MEASURED in phase 164.4 on the
  -- sibling shape; the idiom is supabase/tests/test_resync_retry_single_job.sql
  -- :208-247. CONSTRAINT_NAME is pinned through GET STACKED DIAGNOSTICS so a
  -- rejection by the WRONG constraint says so instead of being read as this one.
  -- RED-UNDER: in migration 20260717233529's re-issued
  --            compute_jobs_kind_target_coherence, drop the NOT from the
  --            allocator-scoped arm — `(kind = 'derive_allocator_equity') AND
  --            (allocator_id IS NULL)`. Every other target in that arm is
  --            already required NULL, so the arm then admits a job with NO
  --            target at all and rejects the one shape the allocator compose
  --            actually enqueues: derive_allocator_equity is refused at write
  --            time, allocator_equity_derived silently stops being refreshed,
  --            and the allocator dashboards read the last good derivation
  --            forever with no error anywhere. The migration's own STEP 6 arm
  --            (e) only asks `position('derive_allocator_equity' IN
  --            v_coherence) > 0` (:381-383) — a PRESENCE test over the
  --            constraint text, which a negated conjunct satisfies exactly as
  --            well as the correct one — so the mutated definition applies
  --            clean and the migration reports the re-base regression clear.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","find":"  OR ((kind = 'derive_allocator_equity') AND (allocator_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (api_key_id IS NULL))","replace":"  OR ((kind = 'derive_allocator_equity') AND (allocator_id IS NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (api_key_id IS NULL))","occurrences":1}]}
  raised := FALSE; v_constraint := NULL;
  BEGIN
    INSERT INTO compute_jobs (allocator_id, kind) VALUES (uid, 'derive_allocator_equity');
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  END;
  IF raised THEN
    RAISE EXCEPTION 'TEST FAILED (3): derive_allocator_equity with an allocator_id target was REJECTED by constraint % — the allocator-scoped coherence arm no longer admits the shape the allocator compose enqueues, so every derive_allocator_equity job is refused at write time and allocator_equity_derived silently stops being refreshed', v_constraint;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM compute_jobs WHERE allocator_id = uid AND kind = 'derive_allocator_equity'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED (3): derive_allocator_equity with allocator_id target was not admitted';
  END IF;

  -- ----- ASSERTION 4: derive_allocator_equity REJECTED with mis-scoped target
  -- (api_key_id set → violates the allocator-scoped coherence arm). Using the
  -- inactive key (a valid FK, no in-flight dedup row) isolates the CHECK.
  -- RED-UNDER: widen the api_key-scoped arm of
  --            compute_jobs_kind_target_coherence in migration 20260717233529
  --            from `kind = 'derive_broker_dailies'` to
  --            `kind = ANY (ARRAY['derive_broker_dailies',
  --            'derive_allocator_equity'])`. That mints exactly the mis-scoped
  --            target this assertion refuses: a derive_allocator_equity job
  --            could be enqueued against a bare api_key, which the allocator
  --            compose cannot resolve to an allocator (it composes over the
  --            allocator's whole holdings set, not one key), so the job is
  --            claimed and fails every tick rather than being refused at write
  --            time. The migration's STEP 6 arm (e) checks only that
  --            v_coherence still matches
  --            `%derive_broker_dailies%api_key_id IS NOT NULL%` (:384-386),
  --            which the widened ARRAY form still satisfies, so the apply is
  --            clean and the migration reports the api_key arm intact.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","find":"  OR ((kind = 'derive_broker_dailies') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))","replace":"  OR ((kind = ANY (ARRAY['derive_broker_dailies', 'derive_allocator_equity'])) AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))","occurrences":1}]}
  raised := FALSE;
  BEGIN
    INSERT INTO compute_jobs (api_key_id, kind) VALUES (key_inact, 'derive_allocator_equity');
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (4): derive_allocator_equity with an api_key_id target was ACCEPTED — coherence arm missing/loosened';
  END IF;

  -- ----- ASSERTION 5: RE-BASE REGRESSION — api_key arm survived -----------
  -- A derive_broker_dailies row with an api_key_id target MUST still insert.
  -- Use the inactive key (fan-out skipped it → no in-flight dedup conflict) so
  -- a failure here can ONLY mean the api_key coherence arm was dropped.
  -- RED-UNDER: narrow the api_key-scoped derive_broker_dailies arm of
  --            compute_jobs_kind_target_coherence in migration 20260717233529
  --            with an extra `AND (idempotency_key IS NOT NULL)` conjunct. That
  --            is the re-base regression this assertion exists to catch,
  --            reached by tightening rather than by deleting: every path that
  --            goes through enqueue_compute_job supplies an idempotency key, so
  --            the recurring fan-out (assertions 1 and 2) keeps working and the
  --            arm LOOKS intact — while every other writer of an api_key-scoped
  --            derive_broker_dailies row, including the approval-gated
  --            scripts/phase35_backfill_enqueue path and any direct operator
  --            INSERT, is refused at write time with a check_violation that
  --            names a constraint nobody expects to be involved.
  -- ⚠️ Deleting the arm outright is NOT the falsifier and was rejected:
  --    MEASURED 2026-09-05 — the fan-out in assertion 1 runs FIRST and its own
  --    INSERT then dies on the same constraint, propagating out of
  --    `PERFORM enqueue_derive_broker_dailies_for_allocator_keys()` as an
  --    unhandled 23514 that aborts psql before assertion 5 is reached. The
  --    narrowed form keeps assertions 1-4 green and lands the failure exactly
  --    here, which is what first-failure identity requires.
  -- ⚠️ The migration's STEP 6 arm (e) matches
  --    `%derive_broker_dailies%api_key_id IS NOT NULL%` (:384-386) — a
  --    substring test that an extra trailing conjunct satisfies unchanged, so
  --    the mutated definition applies clean.
  -- RED-UNDER-M: {"arm":"5","apply":[{"kind":"edit","file":"supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","find":"  OR ((kind = 'derive_broker_dailies') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))","replace":"  OR ((kind = 'derive_broker_dailies') AND (api_key_id IS NOT NULL) AND (idempotency_key IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))","occurrences":1}]}
  raised := FALSE;
  BEGIN
    INSERT INTO compute_jobs (api_key_id, kind) VALUES (key_inact, 'derive_broker_dailies');
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
  END;
  IF raised THEN
    RAISE EXCEPTION 'TEST FAILED (5): a derive_broker_dailies row with an api_key_id target was REJECTED — the api_key coherence arm did NOT survive the CHECK re-base (the exact 20260710130000-warned silent failure)';
  END IF;

  -- ----- ASSERTION 6: cron job registered at a safe hour (1-22) -----------
  -- RED-UNDER: re-register derive-allocator-key-dailies on the LIVE database at
  --            00:30 UTC — `cron.schedule('derive-allocator-key-dailies',
  --            '30 0 * * *', …)`, which upserts by name. Hour 0 is outside the
  --            1-22 band the repo's cron self-checks demand, because midnight
  --            UTC is when the daily boundary rolls: the fan-out would enqueue
  --            against a date that is changing under it, and it would land in
  --            the same minute as every other midnight job. The band is the
  --            whole point of the assertion.
  -- ⚠️ A `sql` step, NOT a migration edit, and that is forced rather than
  --    preferred (GRAMMAR Shape 2's reason, measured here): migration
  --    20260717233529's own STEP 6 arm (g) pins
  --    `jobname = 'derive-allocator-key-dailies' AND schedule = '30 5 * * *'`
  --    EXACTLY and then re-checks the 1-22 band itself (:404-417), so editing
  --    STEP 5's schedule ABORTS THE APPLY and this gate never runs. The lane's
  --    --post-apply hook exists for exactly this shape: the schedule drifts
  --    AFTER the migration has verified itself, which is also how it drifts in
  --    production — an operator re-schedule, not a migration.
  -- ⚠️ ORACLE SCOPE: on a lane cron.job holds whatever this apply list just
  --    scheduled, so what is proven here is that the assertion is FALSIFIABLE,
  --    not that PROD's row is correct. See the file header.
  -- RED-UNDER-M: {"arm":"6","apply":[{"kind":"sql","stmt":"SELECT cron.schedule('derive-allocator-key-dailies', '30 0 * * *', 'SELECT enqueue_derive_broker_dailies_for_allocator_keys();')"}]}
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'derive-allocator-key-dailies') THEN
      RAISE EXCEPTION 'TEST FAILED (6): cron.job derive-allocator-key-dailies not registered';
    END IF;
    SELECT (split_part(schedule, ' ', 2))::INT INTO v_cron_hour
      FROM cron.job WHERE jobname = 'derive-allocator-key-dailies';
    IF v_cron_hour IS NULL OR v_cron_hour < 1 OR v_cron_hour > 22 THEN
      RAISE EXCEPTION 'TEST FAILED (6): derive-allocator-key-dailies cron hour must stay 1-22 (got %)', v_cron_hour;
    END IF;
  ELSE
    RAISE NOTICE 'pg_cron not present — skipping cron assertion (local dev)';
  END IF;

  -- ----- ASSERTION 7: fan-out reaches LEDGER-BACKED venues (mt5) ----------
  -- mt5 is ledger-backed (_LEDGER_BACKED_SOURCES in services/ingestion/long_fetch.py):
  -- its returns come from derive_broker_dailies, NEVER the ccxt fill path. So every
  -- ccxt-shaped exchange gate is wrong for it, and this fan-out must stay
  -- exchange-agnostic.
  --
  -- SCOPE — do not overread this pin. This fan-out is deliberately UNSCHEDULED on
  -- prod (v1.11 recovery; see docs/runbooks/flipretry-derived-equity-go-live.md),
  -- so it is NOT currently any venue's daily refresh. This assertion guards the
  -- function against acquiring a venue filter before it is ever re-enabled; it does
  -- NOT prove any venue is being refreshed. Assertions 1-6 cannot catch a venue
  -- filter at all: every other fixture key is 'binance'.
  -- RED-UNDER: give the fan-out's eligibility predicate in migration
  --            20260717233529 a venue filter —
  --            `WHERE ak.exchange = ANY (ARRAY['binance', 'okx', 'bybit'])` in
  --            front of the is_active conjunct. Those three are exactly
  --            RECONCILABLE_EXCHANGES / FUNDING_EXCHANGES, so this is the
  --            copy-paste an author reaches for when they assume every key is
  --            ccxt-shaped. It is wrong here: mt5, sfox and deribit are
  --            LEDGER-BACKED, their returns come from derive_broker_dailies and
  --            never from the ccxt fill path, so a venue filter on THIS fan-out
  --            strands precisely the venues that have no other source. Every
  --            assertion above stays green — the whole fixture set is 'binance'
  --            apart from the one mt5 key this assertion exists for — and the
  --            migration's STEP 6 arm (f) reads the body for `p_api_key_id`,
  --            `derive_broker_dailies` and `disconnected_at IS NULL` only
  --            (:396-403), all three of which survive, so the apply is clean.
  -- RED-UNDER-M: {"arm":"7","apply":[{"kind":"edit","file":"supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","find":"      WHERE ak.is_active = TRUE","replace":"      WHERE ak.exchange = ANY (ARRAY['binance', 'okx', 'bybit'])\n        AND ak.is_active = TRUE","occurrences":1}]}
  SELECT count(*) INTO row_cnt FROM compute_jobs
   WHERE api_key_id = key_mt5 AND kind = 'derive_broker_dailies' AND status = 'pending';
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (7): eligible LEDGER-BACKED (mt5) key got % pending derive_broker_dailies jobs, expected 1 — this fan-out must stay exchange-agnostic; a venue filter here would strand every ledger-backed venue (mt5/sfox/deribit) whenever the fan-out is re-enabled', row_cnt;
  END IF;

  RAISE NOTICE 'All derive_broker_dailies fan-out + derive_allocator_equity coherence + re-base regression + ledger-backed venue assertions passed.';

  -- ----- TEARDOWN (belt-and-suspenders; the outer ROLLBACK also discards) -
  DELETE FROM auth.users WHERE id = uid;
END
$$;

ROLLBACK;
