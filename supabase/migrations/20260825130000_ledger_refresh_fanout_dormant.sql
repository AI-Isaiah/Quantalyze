-- Migration: enqueue_ledger_refresh_for_strategies — the recurring, DORMANT,
-- bounded single-key refresh fan-out for ledger-backed venues.
-- Phase 161.1 / LEDGER-01, LEDGER-02, LEDGER-04. 2026-08-25.
--
-- ⛔ READ THIS FIRST: what this file does NOT do
-- ----------------------------------------------
-- It registers NO recurring database job. Not registered-but-inactive, not
-- commented out — none, anywhere in this file. `supabase/migrations/**`
-- AUTO-APPLIES to PROD on merge to main with no separate deploy step, and the
-- v1.11 recovery runbook (docs/runbooks/flipretry-derived-equity-go-live.md,
-- line 171) forbids registering a recurring job from a migration precisely
-- because auto-apply plus a silently-skipped worker deploy recreates that wedge
-- verbatim.
--
-- HOW THIS BODY EVER GETS INVOKED: docs/runbooks/ledger-refresh-go-live.md.
-- That runbook is the sole owner of activation and it is two ordered founder LIVE
-- ops. The invocation statement is deliberately NOT spelled out anywhere in this
-- file, comments included — prose must never satisfy or trip a mechanical gate,
-- and plan 05's dormancy gate scans this whole file's raw text.
--
-- Merging this migration changes ZERO production behaviour: the function's first
-- statement is a fail-closed activation check that returns 0 while the setting is
-- unset, and nothing calls the function.
--
--
-- D-08 — TWO independent locks, both with real readers
-- ----------------------------------------------------
-- Lock A: no schedule registration in this file (above). Activation is a founder
-- LIVE op, matching the SFOX_ENABLED / WORKER-03 precedent.
-- Lock B: the function's FIRST statement reads the `app.ledger_refresh_enabled`
-- database setting and returns 0 unless it is exactly the lowercase string
-- `true`. Fail-closed on unset, on empty, on `1`, on `on`, and on `TRUE ` with a
-- trailing space — a truthiness check would open the flag on all of them.
--
-- Lock B lives HERE, in SQL, and not as a Python helper, because the enqueue is
-- SQL: there is no Python code path that would read a Python flag. This repo has
-- already shipped two flags nothing read (`computation_status='stale'`, and the
-- inert `process_key_unified_backbone` row) — "a mechanism that looked like one"
-- is the exact failure this phase exists to eliminate, so the switch lives where
-- the mechanism lives.
--
-- The setting is also the incident-pressure kill switch: resetting it stops the
-- fan-out on the NEXT tick with no database schedule operation, no deploy and no
-- migration. That is rollback level 1 in the runbook.
--
--
-- D-07 — the recurring unit is the chain TAIL, never the chain head
-- -----------------------------------------------------------------
-- The function enqueues `derive_broker_dailies` in strategy-mode. Three
-- measurements fix that choice:
--
--   * `JOB_CHAIN_FOLLOW_ON["process_key_long"][0]` (job_worker.py:521-529) IS
--     `derive_broker_dailies` — this repo's canonical name for the strategy-keyed
--     chain's ledger-backed edge — and it auto-chains onward to
--     `compute_analytics_from_csv`, which is what stamps `strategy_analytics`.
--   * Enqueuing the chain HEAD (`process_key_long`) instead is a PROVABLE no-op:
--     long_fetch.py:154 returns DONE on `status == "published"` and :193 returns
--     DONE on the whole advanced-status set, and every onboarded strategy is
--     `published`. It would ship a green job, a fresh `compute_jobs` row, and an
--     UNTOUCHED `strategy_analytics` — the v1.11 wedge shape. The head also
--     decrypts and re-encrypts credentials and mints a `published` verification
--     row per cycle into a provenance table.
--   * The ccxt fill path is wrong for a settlement-ledger venue on its own terms
--     (its `stored > 0` predicate at routers/cron.py:471-472 is a fill-count
--     test), and adding these venues to `RECONCILABLE_EXCHANGES` is the BYB-02
--     corruption class that crashed every onboard in prod. Both are ROADMAP
--     scope fences.
--
-- Strategy-mode derive is also the documented arm that DOES stamp
-- `strategy_analytics` (job_worker.py:2384-2388 records key-mode as the arm that
-- does not). The whole path was proven end-to-end on PROD by the A7 tracer
-- (plan 01 SUMMARY): derive done in 35 s, auto-chained analytics done, the
-- strategy's last return date advanced by 4 real bars, publish state unchanged.
--
--
-- D-05 / D-16 — this file declares NO venue literal
-- -------------------------------------------------
-- The cohort comes entirely from `public.ledger_refresh_staleness`
-- (migration 20260825120000), which is the single SQL home of the venue set and
-- mirrors `_LEDGER_BACKED_SOURCES` in
-- analytics-service/services/ingestion/long_fetch.py:63. One staleness definition
-- is shared by detection and by repair.
--
-- The authority for single-sourcing is (1) the ROADMAP fence — that Python
-- constant is the sole authority and a mirrored implementation is out unless a
-- drift gate is explicitly accepted — and (2) the measured incident: a
-- hand-copied mirror drifted to one venue while Python held three, and cost a
-- funded account its publish path. ⛔ It is NOT
-- `src/lib/strategyGate.invariant.test.ts`; measured at HEAD, that file's
-- `BANNED_VENUE_LITERALS` is scoped to `src/lib/strategyGate.ts` alone (:64), so
-- it would not catch a venue set added elsewhere. A gate whose stated reason is
-- falsifiable-and-false teaches the next reader a rule they will correctly
-- discover is untrue, and then discard along with the real constraint.
--
--
-- D-01 — composites are excluded here, and the exclusion is DELIBERATE
-- --------------------------------------------------------------------
-- Founder call, 2026-08-25: "on mt5 no composites" / "for now we defer mt5
-- composites. In the future, there might be". The deferral is scoped to MT5 and
-- was never scoped to deribit — resolved as option (a), recorded in
-- 161.1-CONTEXT.md and in the plan-01 SUMMARY.
--
-- This function is the SINGLE-KEY arm and it excludes EVERY composite, because
-- strategy-mode `derive_broker_dailies` resolves its key through
-- `strategies.api_key_id`, which a composite has NULL, so it structurally cannot
-- serve one at all. The venue that has a live composite keeps real coverage
-- through the `stitch_composite` arm in plan 04, which selects from the same
-- view and likewise declares no venue of its own. A future MT5 composite is
-- therefore skipped by a NAMED, COMMENTED rule — CONTEXT D-01's requirement —
-- and never silently mishandled.
--
-- ⛔ The `is_composite = FALSE` conjunct is the ONLY thing excluding composites.
-- It is NOT redundant. Deleting it admits every composite into the single-key arm.
--
-- (An earlier revision of this comment claimed the conjunct was "otherwise
-- REDUNDANT because the key-eligibility conjuncts would drop a NULL-key row
-- anyway". That was FALSE, and it contradicted this same file at the
-- NULL-TOLERANCE note ~20 lines below. Corrected 2026-08-25. Do not restore it:
-- a comment inviting the deletion of the only load-bearing conjunct is worse
-- than no comment.)
--
-- Evaluate the predicate for a composite, where `ak.*` is all NULL under the
-- LEFT join — every key-eligibility conjunct is written NULL-TOLERANTLY, so
-- every one of them returns TRUE:
--     ak.sync_status IS DISTINCT FROM 'revoked'  ->  NULL IS DISTINCT FROM ...  -> TRUE
--     ak.disconnected_at IS NULL                 ->  TRUE
--     COALESCE(ak.is_active, TRUE)               ->  TRUE
-- A composite therefore reaches `is_composite = FALSE` and is excluded THERE,
-- and nowhere else.
--
-- That NULL-tolerance is deliberate and the two rules depend on each other: a
-- NULL-INTOLERANT conjunct would quietly become a SECOND exclusion mechanism,
-- and then deleting `is_composite = FALSE` would still pass its own regression
-- arm — the unfalsifiable-neutering defect (B-2) the plan-checker caught before
-- execution. Keep both properties or neither is provable.
--
-- It is also the named rule D-01 asks for: a future MT5 composite must be
-- skipped DELIBERATELY, never silently mishandled. The behavioural gate
-- (supabase/tests/test_ledger_refresh_fanout.sql, arm D) fails if it is removed.
--
--
-- Why the api_keys join is LEFT, and why that is load-bearing rather than taste
-- -----------------------------------------------------------------------------
-- A composite has `strategies.api_key_id = NULL` — the construction rule is
-- stated at src/app/api/strategies/finalize-wizard/route.ts:1388-1392 and
-- consumed that way at job_worker.py:797-799. Under an INNER join a composite is
-- dropped BY THE JOIN and never reaches the `is_composite` conjunct at all. Arm
-- D's mandated neutering — delete the conjunct, observe RED — would then observe
-- GREEN, and this migration would ship an exclusion that cannot be falsified.
--
-- For the same reason every key-eligibility conjunct below is written
-- NULL-TOLERANTLY. `sync_status IS DISTINCT FROM 'revoked'` and
-- `disconnected_at IS NULL` are already NULL-true; `is_active` is not, so it is
-- wrapped in COALESCE(…, TRUE). Key eligibility is a question ABOUT A KEY: a row
-- with no key is not answered by it, and is excluded one line above, by name, as
-- a composite. A NULL-intolerant conjunct here would quietly become a SECOND
-- composite-exclusion mechanism and re-create the unfalsifiability the LEFT join
-- was chosen to remove.
--
--
-- D-09 — the bound, DERIVED. ⚠️ CORRECTED: an earlier draft costed one hop and
-- named the per-tick LIMIT as the safety bound. Both were wrong. Do not restore
-- either sentence; the Phase-106 janitor was reverted for an underived number,
-- and a wrong derivation is worse than none because it survives review.
-- ------------------------------------------------------------------------------
-- THE COST. `TIMEOUT_PER_KIND` (job_worker.py:488-504) puts
-- `derive_broker_dailies` at 900 s and `compute_analytics_from_csv` at 600 s
-- (:490), and `JOB_CHAIN_FOLLOW_ON["derive_broker_dailies"]` (:526) makes the
-- second an automatic follow-on of the first on the SAME sequentially-dispatching
-- worker (it claims in batches of 5 but dispatches one at a time —
-- main_worker.py:606, :647, :742). ONE refreshed strategy therefore costs up to
-- 1500 s of worker time, not 900 s.
--
-- THE MODEL. "n × cost < one hourly tick" is the wrong model anyway: this
-- function only ENQUEUES, and the worker drains asynchronously, so a tick that
-- outruns the drain rate is not by itself a runaway. What actually stops the
-- queue growing without bound is the pair of re-selection conjuncts — a strategy
-- with a non-terminal job, or with an attempt inside the cooldown, is not
-- selected again. THE MAXIMUM OUTSTANDING REFRESH BACKLOG IS THEREFORE BOUNDED
-- BY THE COHORT SIZE, NOT BY THE TICK RATE: 5 strategies today (PROD census)
-- ⇒ at most ~7500 s of queued refresh work in existence at any instant, against
-- 86 400 s of worker day.
--
-- SO: THE BINDING CONSTRAINT IS THE 20-HOUR ATTEMPT COOLDOWN; THE PER-TICK LIMIT
-- IS A BURST / SMOOTHING CAP, NOT THE SAFETY BOUND.
--
-- The cooldown is 20 hours on the prior ATTEMPT, not the prior success. The data
-- granularity is daily, so one refresh per strategy per day is the correct steady
-- state; and keying on attempt also bounds a PERMANENTLY-FAILING strategy to
-- ~1 job/day instead of 24. `compute_jobs` terminal-row retention is 30 days
-- (20260515113853:198), comfortably longer than the cooldown, so the cooldown
-- cannot silently void by losing the row it reads.
--
-- THE TWO INTEGERS. Per-tick LIMIT 4, per-venue cap 2. The cap exists because one
-- of the ledger venues serialises every job on a SINGLE shared terminal registry
-- (analytics-service/services/mt5_concurrency.py); without the partition, a book
-- weighted toward that venue spends every tick on it and starves the others.
-- ⛔ The LIMIT must stay STRICTLY GREATER than the cap. At LIMIT = cap = 2 the
-- behavioural gate's arm G cannot tell "the per-venue cap bound this tick" from
-- "the global limit bound this tick", and deleting the cap would leave that arm
-- GREEN — lowering the LIMIT to the re-derived n ≤ 2 would make this migration's
-- own anti-vacuity proof vacuous.
--
-- Worst-case burst is 4 × 1500 s ≈ 100 min of work injected by one tick, which
-- deliberately exceeds an hourly tick: the next tick re-selects none of those
-- four (the in-flight conjunct), so a cold-start backlog drains over several
-- ticks instead of compounding. Do NOT copy the reconcile sweep's LIMIT 25
-- (20260819150000) — that sweep's follow-on is pure-DB.
--
-- ⚠️ Measured, and it is why these are shape rather than volume: the A7 PROD
-- tracer ran the whole chain for one strategy in 44 s wall-clock (derive 35 s,
-- auto-chained analytics to done) against the 1500 s ceiling — about 34×
-- conservative. The derivation stands as a CEILING, not an estimate. It is not a
-- reason to retune the integers downward, and the live cohort is 5 strategies.
--
--
-- D-10 — no FOR UPDATE SKIP LOCKED in the candidate CTE
-- ------------------------------------------------------
-- Postgres refuses FOR UPDATE alongside a window function, and the per-venue cap
-- needs `row_number() OVER (PARTITION BY …)`. Do not "restore" a lock clause
-- here: it cannot compile. Concurrency is already covered three ways — the
-- session advisory lock below, `enqueue_compute_job`'s own in-flight dedupe
-- (20260716090000:259-261), and the
-- `compute_jobs_one_inflight_per_kind_strategy` partial unique index.
--
--
-- T-161.1-06 — the function takes NO PARAMETERS
-- ----------------------------------------------
-- A caller-supplied interval or limit on a cross-tenant SECURITY DEFINER function
-- is the incident class migration 20260802120000 records verbatim: "the parameter
-- IS the attack surface". Every threshold is a literal in the body, pinned by the
-- behavioural gate and by plan 05's static gates. SET search_path, and REVOKE ALL
-- from PUBLIC/anon/authenticated, complete the hygiene triple.
--
--
-- T-161.1-10 — no identifiers leak
-- ---------------------------------
-- Every RAISE NOTICE below carries COUNTS only. The job metadata carries a source
-- token and a timestamp — no user id, no key id, nothing beyond the structural
-- `strategy_id` column `compute_jobs` already stores.
--
--
-- Convention: BEGIN/COMMIT with a session lock_timeout, matching the repo
-- majority and migration 20260825120000 (project Rule 11).

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: the fan-out
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_ledger_refresh_for_strategies()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fanout$
DECLARE
  v_enabled  TEXT;
  v_row      RECORD;
  v_job_id   UUID;
  v_existing INTEGER;
  v_enqueued INTEGER := 0;
BEGIN
  -- ---- Lock B (D-08): the fail-closed activation switch ------------------
  -- FIRST statement in the body, deliberately. The missing-ok form of
  -- current_setting returns NULL when the setting was never set; COALESCE makes
  -- that an empty string, and the comparison is EXACT EQUALITY against the
  -- lowercase word. Anything else — unset, empty, '1', 'on', 'TRUE', 'true '
  -- with a trailing space — is dormant. A truthiness test would open the flag on
  -- half of that list.
  --
  -- Resetting this setting is the incident-pressure kill switch: the next tick
  -- returns 0 with no schedule operation, no deploy, no migration.
  v_enabled := COALESCE(current_setting('app.ledger_refresh_enabled', TRUE), '');
  IF v_enabled <> 'true' THEN
    RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: dormant (activation setting not exactly true); enqueued 0';
    RETURN 0;
  END IF;

  -- ---- concurrency: one fan-out at a time -------------------------------
  IF NOT pg_try_advisory_lock(hashtext('ledger_refresh_fanout')) THEN
    RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: another run holds the lock; skipping';
    RETURN 0;
  END IF;

  BEGIN
    FOR v_row IN
      WITH candidates AS (
        SELECT
          lrs.strategy_id,
          lrs.last_return_date,
          -- Per-venue partition for the cap. A non-composite row in this view
          -- has exactly one element in `exchanges` (its venue is reached only
          -- through strategies.api_key_id), and the view's WHERE clause makes an
          -- empty array impossible, so element 1 is the venue. No venue literal
          -- is declared here or anywhere else in this file (D-05).
          row_number() OVER (
            PARTITION BY lrs.exchanges[1]
            ORDER BY lrs.last_return_date ASC NULLS FIRST, lrs.strategy_id
          ) AS venue_rank
        FROM public.ledger_refresh_staleness lrs
        JOIN public.strategies s
          ON s.id = lrs.strategy_id
        -- ⛔ LEFT, not INNER, and this is load-bearing. See the header section
        -- "Why the api_keys join is LEFT": under INNER, a composite is dropped by
        -- the join and never reaches the exclusion conjunct below, which would
        -- make that conjunct unfalsifiable.
        LEFT JOIN public.api_keys ak
          ON ak.id = s.api_key_id
        WHERE lrs.is_stale
          -- D-01: composites are excluded, DELIBERATELY and by name. ⛔ This
          -- conjunct is the ONLY exclusion — it is NOT redundant. Every
          -- key-eligibility conjunct above is NULL-TOLERANT, so a composite
          -- (all-NULL `ak.*` under the LEFT join) passes all of them and is
          -- excluded HERE, nowhere else. Deleting it admits every composite.
          -- See the "D-01" section of this file's header. Do not tidy it away.
          AND lrs.is_composite = FALSE
          -- Lifecycle: mirrors ALLOWED_STRATEGY_STATUSES (routers/cron.py:148)
          -- MINUS 'draft'. A draft strategy has no factsheet to refresh, so the
          -- narrower pair is correct here; it is the same pair
          -- enqueue_poll_positions_for_all_strategies already uses
          -- (20260412094449:233-245), so the two recurring strategy fan-outs
          -- agree on what "live enough to re-run" means.
          AND s.status IN ('published', 'pending_review')
          -- Key eligibility — the role-agnostic eligible-key predicate, written
          -- NULL-TOLERANTLY on purpose (header: "Why the api_keys join is LEFT").
          -- These two are already NULL-true.
          AND ak.sync_status IS DISTINCT FROM 'revoked'
          AND ak.disconnected_at IS NULL
          -- This one is not, so it is coalesced. A row with no key at all is not
          -- excluded HERE — it is excluded above, by name, as a composite.
          AND COALESCE(ak.is_active, TRUE)
          -- Attempt cooldown (D-09) — the BINDING bound. Keyed on the prior
          -- ATTEMPT, not the prior success, so a permanently-failing strategy
          -- costs ~1 job/day instead of 24. Both chain hops count: the tail
          -- follows the head automatically, so an analytics job inside the window
          -- means this strategy was already refreshed inside the window.
          AND NOT EXISTS (
                SELECT 1
                  FROM public.compute_jobs cj
                 WHERE cj.strategy_id = lrs.strategy_id
                   AND cj.kind IN ('derive_broker_dailies', 'compute_analytics_from_csv')
                   AND cj.created_at > now() - INTERVAL '20 hours'
              )
          -- In-flight guard. Belt-and-braces over enqueue_compute_job's own
          -- optimistic in-flight lookup and over the partial unique index: this
          -- one also covers a strategy busy with a DIFFERENT kind, which the
          -- per-(strategy,kind) index does not.
          --
          -- ⚠️ 'failed_retry' is INCLUDED deliberately, and this set is therefore
          -- WIDER than the three-status set the RPC's dedupe (20260716090000:259-261)
          -- and the compute_jobs_one_inflight_per_kind_strategy index both use.
          -- `CLAIMABLE_STATUSES = ("pending", "failed_retry")` (job_worker.py:200)
          -- — a failed_retry row is scheduled to be claimed again, so it is
          -- in-flight in every sense that matters here. Neither the RPC nor the
          -- index would stop a second derive landing beside it, and two
          -- concurrent derives for one strategy is exactly what the venue that
          -- serialises on a single shared terminal registry cannot absorb.
          AND NOT EXISTS (
                SELECT 1
                  FROM public.compute_jobs cj2
                 WHERE cj2.strategy_id = lrs.strategy_id
                   AND cj2.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
              )
      )
      -- ---- the two integers (D-09, CORRECTED). Derivation, in order: ------
      --  (a) One refreshed strategy costs up to 1500 s of worker time, NOT
      --      900 s: derive_broker_dailies (900 s) auto-chains to
      --      compute_analytics_from_csv (600 s) on the same
      --      sequentially-dispatching worker (job_worker.py:488-504, :526).
      --  (b) ⛔ THE BINDING CONSTRAINT IS THE 20-HOUR ATTEMPT COOLDOWN ABOVE,
      --      NOT THIS LIMIT. The cooldown plus the in-flight conjunct cap the
      --      outstanding backlog at the COHORT SIZE, whatever the tick rate.
      --  (c) This LIMIT is a burst / smoothing cap only. It is not what keeps
      --      the worker from saturating; (b) is.
      --  (d) ⛔ The LIMIT must stay STRICTLY GREATER than the per-venue cap, or
      --      the behavioural gate's arm G stops discriminating the cap from the
      --      limit and the cap's own neutering goes green.
      -- Full narrative, including why "n × 900 s < 3600 s ⇒ n = 4" is retracted
      -- on BOTH the cost and the model, is in this file's D-09 header section.
      SELECT c.strategy_id
        FROM candidates c
       WHERE c.venue_rank <= 2
       ORDER BY c.last_return_date ASC NULLS FIRST, c.strategy_id
       LIMIT 4
    LOOP
      BEGIN
        -- ⛔ COUNT INSERTIONS, NOT CALLS. _enqueue_compute_job_internal
        -- (20260716090000:229-300) RETURNS the id of an existing in-flight job
        -- when it finds one (:259-261) and inserts ON CONFLICT DO NOTHING
        -- (:276) — so it never raises, a per-row `unique_violation` handler can
        -- never fire, and a naive `counter := counter + 1` per iteration would
        -- report the number of CALLS. The founder reads this integer back at
        -- activation (docs/runbooks/ledger-refresh-go-live.md), so it must mean
        -- what it says. Same idiom as enqueue_poll_positions_for_all_strategies
        -- (20260412094449:249-268).
        --
        -- ⚠️ [161.1-REVIEW IN-01] What this pre-count actually is, stated
        -- honestly so the next reader does not over-trust it: it is a
        -- RACE-WINDOW BACKSTOP, not the mechanism. The mechanism is the
        -- in-flight conjunct in the candidate CTE above, which excludes any
        -- strategy holding a job in ('pending','running','done_pending_children',
        -- 'failed_retry') for ANY kind — a strict superset of the three statuses
        -- and the one kind queried here. So on the normal path v_existing is 0
        -- for every candidate, and this SELECT changes nothing.
        --
        -- It is still not dead code. The advisory lock serialises fan-out TICKS,
        -- not the API: an externally-committed enqueue for this strategy can
        -- land between the CTE's snapshot and this iteration's fresh READ
        -- COMMITTED snapshot, and then the RPC returns that row's id rather than
        -- inserting. Only in that window does v_existing go non-zero. It can
        -- therefore only UNDERCOUNT, which is the fail-safe direction for a
        -- number a human reads back as "jobs created".
        --
        -- ⛔ No test drives this non-zero deterministically — the window needs a
        -- concurrent committed writer. Do not read a green suite as evidence
        -- that this branch has ever fired.
        SELECT count(*) INTO v_existing
          FROM public.compute_jobs
         WHERE strategy_id = v_row.strategy_id
           AND kind = 'derive_broker_dailies'
           AND status IN ('pending', 'running', 'done_pending_children');

        -- ⛔ p_strategy_id ALONE. enqueue_compute_job enforces exactly-one-of
        -- {p_strategy_id, p_allocator_id, p_api_key_id} and raises 22023
        -- otherwise (20260515210300:330-332; measured on PROD during the A7
        -- tracer). Strategy-mode is also the only mode that stamps
        -- strategy_analytics — see the D-07 header section.
        --
        -- ⚠️ The 'source' value is a CONTRACT, not a label: the non-destructive
        -- failure guard in analytics-service/services/job_worker.py reads it back
        -- off this job row and skips the publish-state downgrade when it matches.
        -- If the two spellings drift, the fan-out still enqueues and the guard
        -- still compiles, and the only symptom is that the next failed refresh
        -- silently un-publishes a funded account. Plan 05 gate 8 pins them.
        v_job_id := enqueue_compute_job(
          p_strategy_id := v_row.strategy_id,
          p_kind        := 'derive_broker_dailies',
          p_metadata    := jsonb_build_object(
                             'source', 'ledger-refresh',
                             'enqueued_at', now()
                           )
        );

        IF v_existing = 0 AND v_job_id IS NOT NULL THEN
          v_enqueued := v_enqueued + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- ⛔ Deliberately NOT `WHEN unique_violation`: that condition cannot fire
        -- here (see the counter comment above), and an exception block that
        -- cannot fire is indistinguishable from one that is protecting
        -- something — the next reader preserves it and reasons from it.
        -- Catching OTHERS keeps one poisoned row from aborting the whole tick.
        -- The SQLSTATE is carried; no identifier is (T-161.1-10).
        RAISE WARNING 'enqueue_ledger_refresh_for_strategies: one candidate failed to enqueue (SQLSTATE %); continuing', SQLSTATE;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Release before re-raising, or the session holds the lock until it ends and
    -- every later tick on that session skips. This arm is the part authors drop.
    PERFORM pg_advisory_unlock(hashtext('ledger_refresh_fanout'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('ledger_refresh_fanout'));

  RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: enqueued % refresh job(s) this tick', v_enqueued;
  RETURN v_enqueued;
END;
$fanout$;

COMMENT ON FUNCTION public.enqueue_ledger_refresh_for_strategies() IS
  'Phase 161.1 / LEDGER-01,-02,-04: the recurring single-key refresh fan-out for '
  'ledger-backed venues. Parameterless SECURITY DEFINER; returns the number of '
  'jobs ACTUALLY INSERTED this tick. DORMANT until the app.ledger_refresh_enabled '
  'database setting is exactly ''true'' (fail-closed). Selects stale, non-composite, '
  'key-eligible strategies from public.ledger_refresh_staleness — declaring no venue '
  'of its own — and enqueues derive_broker_dailies in strategy-mode (the chain TAIL, '
  'which auto-chains to compute_analytics_from_csv; the chain HEAD is a provable '
  'no-op on a published strategy). Bounded by a 20-hour ATTEMPT cooldown (the binding '
  'constraint), an in-flight conjunct, a per-venue rank cap and a per-tick burst LIMIT. '
  'Registers no schedule; activation is a founder LIVE op per '
  'docs/runbooks/ledger-refresh-go-live.md.';

REVOKE ALL ON FUNCTION public.enqueue_ledger_refresh_for_strategies()
  FROM PUBLIC, anon, authenticated;
-- pg_cron runs as superuser; no additional GRANT is required for activation.

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip.
--
-- ⛔ This block must NEVER call the function. A smoke-test invocation at apply
-- time would enqueue real jobs on PROD the moment this migration merges — which
-- is precisely the "merging changes no production behaviour" property the whole
-- design exists to hold. Assert the SHAPE, not the behaviour; behaviour is
-- covered by supabase/tests/test_ledger_refresh_fanout.sql.
DO $verify$
DECLARE
  v_secdef  BOOLEAN;
  v_config  TEXT[];
  v_nargs   SMALLINT;
BEGIN
  -- 1. the function landed, and it takes ZERO arguments (T-161.1-06)
  SELECT p.prosecdef, p.proconfig, p.pronargs
    INTO v_secdef, v_config, v_nargs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'enqueue_ledger_refresh_for_strategies';

  IF v_nargs IS NULL THEN
    RAISE EXCEPTION 'Migration 20260825130000: enqueue_ledger_refresh_for_strategies missing';
  END IF;
  IF v_nargs <> 0 THEN
    RAISE EXCEPTION 'Migration 20260825130000: enqueue_ledger_refresh_for_strategies takes % argument(s), expected 0 — a caller-supplied threshold on a cross-tenant SECURITY DEFINER function IS the attack surface (T-161.1-06)', v_nargs;
  END IF;

  -- 2. SECURITY DEFINER with a pinned search_path
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'Migration 20260825130000: enqueue_ledger_refresh_for_strategies is not SECURITY DEFINER';
  END IF;
  IF v_config IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest(v_config) AS c WHERE c LIKE 'search_path=%'
  ) THEN
    RAISE EXCEPTION 'Migration 20260825130000: enqueue_ledger_refresh_for_strategies does not pin search_path (proconfig=%)', v_config;
  END IF;

  -- 3. no EXECUTE for the browser-reachable roles. has_function_privilege
  --    resolves grants made to PUBLIC and via role inheritance, which is how a
  --    default privilege would leak in.
  IF has_function_privilege('anon', 'public.enqueue_ledger_refresh_for_strategies()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20260825130000: role anon can EXECUTE enqueue_ledger_refresh_for_strategies (cross-tenant enqueue)';
  END IF;
  IF has_function_privilege('authenticated', 'public.enqueue_ledger_refresh_for_strategies()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20260825130000: role authenticated can EXECUTE enqueue_ledger_refresh_for_strategies (cross-tenant enqueue)';
  END IF;

  -- 4. the cohort view this body depends on exists. Without it the function
  --    compiles (plpgsql resolves at run time) and fails on the first tick.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'public' AND table_name = 'ledger_refresh_staleness'
  ) THEN
    RAISE EXCEPTION 'Migration 20260825130000: public.ledger_refresh_staleness is missing — apply 20260825120000 first';
  END IF;

  -- 5. compute_jobs ADMITS the kind this arm enqueues, strategy-scoped.
  --
  --    Mirrors 20260825140000:498-512. Without it, a coherence re-base that
  --    drops the derive_broker_dailies strategy arm is UNDETECTABLE at apply
  --    time and produces the exact wedge shape this phase exists to remove:
  --    every tick raises 23514 per candidate row, the per-row
  --    `EXCEPTION WHEN OTHERS ... RAISE WARNING ... continue` swallows it, and
  --    the function returns 0 — byte-identical to "nothing was stale". Green
  --    cron, green return value, strategy_analytics never advancing.
  --
  --    That drift is not hypothetical here: 20260624120100 exists BECAUSE a
  --    coherence re-base had already dropped this exact arm in one environment,
  --    and 20260717233529:126 warns in capitals that copying an OLDER coherence
  --    def would SILENTLY DROP it. This arm covers 4 of the 5 live ledger
  --    strategies, so it is the one that least tolerates a silent no-op.
  SELECT pg_get_constraintdef(oid) INTO v_kind
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass
     AND conname = 'compute_jobs_kind_check';
  SELECT pg_get_constraintdef(oid) INTO v_coherence
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass
     AND conname = 'compute_jobs_kind_target_coherence';

  IF v_kind IS NULL OR position('derive_broker_dailies' IN v_kind) = 0 THEN
    RAISE EXCEPTION 'Migration 20260825130000: derive_broker_dailies is not admitted by compute_jobs_kind_check — this arm would enqueue nothing';
  END IF;
  IF v_coherence IS NULL OR position('derive_broker_dailies' IN v_coherence) = 0 THEN
    RAISE EXCEPTION 'Migration 20260825130000: derive_broker_dailies is not admitted by compute_jobs_kind_target_coherence — this arm would enqueue nothing';
  END IF;

  RAISE NOTICE 'Migration 20260825130000: enqueue_ledger_refresh_for_strategies applied DORMANT (no schedule registered, activation setting fail-closed)';
END $verify$;

COMMIT;
