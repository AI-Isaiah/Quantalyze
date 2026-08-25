-- Migration: enqueue_ledger_composite_refresh — the recurring, DORMANT, bounded
-- COMPOSITE refresh arm for ledger-backed venues.
-- Phase 161.1 / LEDGER-01. 2026-08-25.
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
-- HOW THIS BODY EVER GETS INVOKED: docs/runbooks/ledger-refresh-go-live.md. The
-- invocation statement is deliberately NOT spelled out anywhere in this file,
-- comments included — prose must never satisfy or trip a mechanical gate, and
-- the static dormancy gate scans this whole file's raw text.
--
-- Merging this migration changes ZERO production behaviour: the function's first
-- statement is a fail-closed activation check that returns 0 while the setting is
-- unset, and nothing calls the function.
--
--
-- Why a SECOND function instead of a branch inside the single-key arm (D-11)
-- --------------------------------------------------------------------------
-- Three reasons, each measured at HEAD, not stylistic:
--
--   * THE KINDS DIFFER. This arm enqueues `stitch_composite`; the single-key arm
--     (migration 20260825130000) enqueues `derive_broker_dailies`.
--   * THE CHAIN SHAPES DIFFER, not merely the ceilings.
--     `JOB_CHAIN_FOLLOW_ON["stitch_composite"] = ()` (job_worker.py:528) — this
--     kind is CHAIN-TERMINAL, so one enqueue costs exactly one 1200 s handler
--     ceiling (`TIMEOUT_PER_KIND["stitch_composite"] = 20 * 60`, :502) and
--     nothing more. The single-key arm's `derive_broker_dailies` (900 s, :501)
--     auto-chains a `compute_analytics_from_csv` hop after it (600 s, :490; the
--     edge is at :526). The two arms' bounds are therefore NOT one formula with a
--     different constant, and copying that file's integer would import a
--     derivation that does not apply here.
--   * SEPARATE FUNCTIONS MEAN SEPARATE OPERATIONS. The founder can schedule,
--     bound and roll back one arm without touching the other — which matters
--     because this path carries per-member exchange crawls and was the subject of
--     the stitch-composite crawl-bounding incident.
--
-- ⚠️ ONE KILL SWITCH, TWO SCHEDULES. This function reads the SAME activation
-- setting as the single-key arm, so a single reset stops BOTH arms on the next
-- tick. It takes its OWN advisory lock key, so the two functions never block each
-- other, and it is registered under its own schedule so unscheduling one leaves
-- the other running. Kill switch: shared. Scheduling: independent.
--
--
-- D-12 — `stitch_composite` is the right unit, and it already exists
-- ------------------------------------------------------------------
-- It is a registered strategy-scoped kind (migration 20260710130000), admitted by
-- BOTH compute_jobs CHECKs, it fans over `strategy_keys` members by seq, and it
-- writes the headline `strategy_analytics` row DIRECTLY in one atomic upsert
-- (job_worker.py:5350, :7177) rather than chaining. So it reaches
-- `strategy_analytics`, which is what a refresh has to do to be a refresh.
--
-- Strategy-mode `derive_broker_dailies` structurally CANNOT serve a composite: it
-- resolves its key through `strategies.api_key_id`, which a composite has NULL
-- (src/app/api/strategies/finalize-wizard/route.ts:1177, 1388-1392). That is why
-- the single-key arm excludes composites and why this arm exists at all.
--
--
-- D-14 — this handler DOES write `strategy_analytics.returns_series`
-- ------------------------------------------------------------------
-- The whole premise of this arm is that a `stitch_composite` run can move
-- `last_return_date`, which migration 20260825120000 keys its freshness verdict
-- on. Traced at HEAD, hop by hop:
--
--   | 1 | job_worker.py:6450  | cash_metrics_json = dict(_cash_basis_result.metrics_json)
--   | 2 | basis_series.py:296 | BasisSeriesResult(metrics_json=metrics.metrics_json, …) — it IS the MetricsResult dict, unchanged
--   | 3 | metrics.py:265-269  | that dict is documented to carry the above-the-fold series, returns_series named first
--   | 4 | job_worker.py:7083  | headline_payload.update(cash_metrics_json) spreads it into the headline payload
--   | 5 | job_worker.py:7177  | one strategy_analytics upsert on strategy_id persists that payload
--
-- ⚠️ The in-file comment at job_worker.py:7071-7072 says that spread carries
-- "metric SCALARS only". That claim is true only for the narrow thing it was
-- written to defend — the spread cannot clobber the sibling `series_completeness`
-- key — and it is FALSE as a description of what is spread. Do not quote it as
-- evidence that this path leaves `returns_series` alone.
--
--
-- D-01 / D-13 — the MT5 exclusion is on MEMBERSHIP, and it is DELIBERATE
-- ----------------------------------------------------------------------
-- Founder call, 2026-08-25: "on mt5 no composites" / "for now we defer mt5
-- composites. In the future, there might be". The deferral is scoped to the MT5
-- path and was never scoped to the other ledger venues — resolved as option (a),
-- recorded in 161.1-CONTEXT.md and in the plan-01 SUMMARY.
--
-- So the exclusion is written on MEMBERSHIP, not on a strategy's headline venue: a
-- composite with ANY member on that venue is skipped, because a mixed composite
-- would drag that venue's single shared terminal registry into the composite
-- crawl. The staleness view exposes a has-member flag for exactly this (plan 01,
-- D-06), so this file re-declares no venue of its own.
--
-- ⚠️ THE COUNT IS ZERO TODAY AND THE CONJUNCT STILL SHIPS. CONTEXT D-01 states
-- outright that this is a CURRENT FACT, not a structural invariant, and that the
-- founder expects such composites may exist later. A future one must land here as
-- a VISIBLE, NAMED skip — never as silent mishandling. Do not tidy this conjunct
-- away on the grounds that nothing matches it.
--
--
-- ⛔ WHAT PARTITIONS THIS ARM'S COHORT FROM THE SINGLE-KEY ARM'S — read before
-- editing any conjunct below
-- ------------------------------------------------------------------------------
-- `is_composite = TRUE` is the SOLE conjunct that partitions this arm's cohort
-- from migration 20260825130000's, and it must stay sole. Every other conjunct is
-- written so that it CANNOT, by itself, exclude a single-key strategy.
--
-- The reason is mechanical, not stylistic. `is_composite` is TRUE iff the strategy
-- has at least one `strategy_keys` row (plan 01, D-06), and a single-key strategy
-- has ZERO such rows — 161.1-CONTEXT.md states it outright ("single-key strategies
-- link directly; only composites use `strategy_keys`"). So ANY conjunct spelled as
-- a bare `EXISTS (SELECT 1 FROM strategy_keys …)` silently performs the partition a
-- SECOND time. The moment two conjuncts both exclude single-key rows, deleting
-- either one changes nothing, the SINGLE-KEY EXCLUSION arm of
-- supabase/tests/test_ledger_refresh_composite_arm.sql cannot go RED under the
-- mandated is-composite neutering, and the partition ends up pinned by no test at
-- all. That is the same unfalsifiability shape migration 20260825130000 chose a
-- LEFT join to avoid, arriving from the opposite direction.
--
-- ONE partitioning conjunct, tested. Everything else vacuous on the rows it does
-- not apply to. The member-health conjunct below is written
-- vacuously-true-when-member-less for precisely this reason, and its comment says
-- so at the point of use.
--
--
-- THE BOUND — derived here, NOT copied from the single-key arm
-- ------------------------------------------------------------
-- ⛔ Do NOT derive it as "n × the handler ceiling fits inside one tick". That
-- formula is false here in two ways, both measured:
--
--   (a) It assumes this arm owns the tick. It does not. Dispatch is sequential on
--       a SHARED worker (main_worker.py:606, :647, :742) that is simultaneously
--       draining the single-key arm's `derive_broker_dailies` enqueues (900 s,
--       job_worker.py:501) whose chain is NOT terminal and adds a
--       `compute_analytics_from_csv` hop after each one (600 s, :490; edge at
--       :526) — plus every unrelated kind already in the queue.
--   (b) At n = 3 the arithmetic lands 3 × 1200 = 3600 s, EQUAL to an hourly tick,
--       with zero headroom. An equality is not a bound.
--
-- SO, THE SPLIT, EXPLICITLY: **the 20-hour attempt cooldown is the BINDING
-- constraint on recurrence; the per-tick LIMIT is a BURST CAP.** The cap bounds
-- how many composite jobs ONE TICK may add to a SHARED queue. It is not a
-- throughput guarantee and it is not a claim that the enqueued jobs finish inside
-- the tick — overhang past the tick is EXPECTED, and absorbing it is exactly what
-- the non-terminal in-flight guard and the cooldown are for. A reader who thinks
-- the LIMIT is the safety mechanism will raise it; it is not, and it must not be
-- raised on that reasoning.
--
-- THE BURST CAP, AS BLAST RADIUS. `stitch_composite` is chain-terminal
-- (`JOB_CHAIN_FOLLOW_ON["stitch_composite"] = ()`, job_worker.py:528), so one
-- enqueue costs exactly one 1200 s handler ceiling
-- (`TIMEOUT_PER_KIND["stitch_composite"] = 20 * 60`, :502) with NO follow-on hop —
-- the one respect in which this arm is genuinely cheaper than the single-key one,
-- and the honest per-strategy chain cost. The measured live composite cohort is
-- exactly 1 (the census in 161.1-CONTEXT.md; cited by document, not by venue,
-- because the static gate scans this function's body for venue literals). The cap
-- is set to 2: strictly above the measured cohort, so it never binds today, and
-- low enough that a mis-measured or grown cohort adds at most 2400 s of composite
-- work to a shared hourly tick instead of consuming the whole of it.
--
-- ⛔ If the cohort ever exceeds 2, the correct response is RE-DERIVING this integer
-- against a re-measured census — not raising it reflexively.
--
-- NO PER-VENUE PARTITION, and that is a decision rather than an omission: the live
-- composite cohort is a single strategy, so a partition would rank a set of one
-- and pin nothing. Ordering is oldest-first so that a future larger cohort cannot
-- starve a tail while the cap binds.
--
--
-- T-161.1-15 — the function takes NO PARAMETERS
-- ----------------------------------------------
-- A caller-supplied interval or limit on a cross-tenant SECURITY DEFINER function
-- is the incident class migration 20260802120000 records verbatim: "the parameter
-- IS the attack surface". Every threshold is a literal in the body. SET
-- search_path, and REVOKE ALL from PUBLIC/anon/authenticated, complete the hygiene
-- triple; the DO block at the end asserts all three at apply time.
--
--
-- T-161.1-19 — no identifiers leak
-- ---------------------------------
-- Every RAISE NOTICE below carries COUNTS only. The job metadata carries a source
-- token and a timestamp — no user id, no key id, nothing beyond the structural
-- `strategy_id` column `compute_jobs` already stores.
--
--
-- Convention: BEGIN/COMMIT with a session lock_timeout, matching the repo majority
-- and migrations 20260825120000 / 20260825130000 (project Rule 11).

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: the composite fan-out
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_ledger_composite_refresh()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $composite$
DECLARE
  v_enabled  TEXT;
  v_row      RECORD;
  v_job_id   UUID;
  v_existing INTEGER;
  v_enqueued INTEGER := 0;
BEGIN
  -- ---- the fail-closed activation switch --------------------------------
  -- FIRST statement in the body, deliberately, and it reads the SAME setting the
  -- single-key arm reads so ONE reset kills BOTH arms on the next tick. The
  -- missing-ok form of current_setting returns NULL when the setting was never
  -- set; COALESCE makes that an empty string, and the comparison is EXACT
  -- EQUALITY against the lowercase word. Anything else — unset, empty, '1', 'on',
  -- 'TRUE', or 'true ' with a trailing space — is dormant. A truthiness test or a
  -- boolean cast would open the flag on every one of them.
  v_enabled := COALESCE(current_setting('app.ledger_refresh_enabled', TRUE), '');
  IF v_enabled <> 'true' THEN
    RAISE NOTICE 'enqueue_ledger_composite_refresh: dormant (activation setting not exactly true); enqueued 0';
    RETURN 0;
  END IF;

  -- ---- concurrency: one composite fan-out at a time ----------------------
  -- ⛔ Its OWN key, distinct from the single-key arm's. Sharing a key would make
  -- either arm's tick silently skip whenever the other held it, which reads in
  -- the logs exactly like "there was nothing to do".
  IF NOT pg_try_advisory_lock(hashtext('ledger_refresh_composite_fanout')) THEN
    RAISE NOTICE 'enqueue_ledger_composite_refresh: another run holds the lock; skipping';
    RETURN 0;
  END IF;

  BEGIN
    FOR v_row IN
      WITH candidates AS (
        SELECT
          lrs.strategy_id,
          lrs.last_return_date
        FROM public.ledger_refresh_staleness lrs
        JOIN public.strategies s
          ON s.id = lrs.strategy_id
        WHERE lrs.is_stale
          -- ⛔ THE PARTITIONING CONJUNCT, BY NAME. This single line is what
          -- separates this arm's cohort from the single-key arm's, and it is the
          -- only line in this predicate that is allowed to do so. See the header
          -- section "WHAT PARTITIONS THIS ARM'S COHORT" before touching anything
          -- below it: a second conjunct that also excludes single-key rows makes
          -- this one impossible to falsify.
          AND lrs.is_composite = TRUE
          -- D-01 / D-13, the membership-level deferral. The full founder quote,
          -- its scope, and why this conjunct ships even though nothing matches it
          -- today are in the "D-01 / D-13" section of this file's header (the
          -- venue cannot be named here — the static gate scans this body). This
          -- conjunct is SAFE to write directly: the flag is FALSE for a single-key
          -- strategy on any other ledger venue, so it does not partition.
          AND lrs.has_mt5_member = FALSE
          -- Lifecycle: the same pair the single-key arm uses — ALLOWED_STRATEGY_
          -- STATUSES (routers/cron.py:148) MINUS 'draft'. A draft strategy has no
          -- factsheet to refresh. Cannot partition: a single-key strategy can hold
          -- either of these values.
          AND s.status IN ('published', 'pending_review')
          -- ---- MEMBER HEALTH, written so it CANNOT partition ----------------
          -- ⛔ The obvious spelling — a bare `EXISTS (SELECT 1 FROM strategy_keys
          -- sk … WHERE <eligible>)` — is FORBIDDEN here. A single-key strategy has
          -- ZERO strategy_keys rows, so that spelling would be a SECOND
          -- is-composite test, and the is-composite neutering the matched-pair
          -- gate mandates could then not redden. Written instead as two halves,
          -- the first of which is vacuously TRUE on a member-less row:
          AND (
                -- half 1: a member-less row PASSES here. It is excluded by
                -- `is_composite` one screen up, by name — never by this conjunct.
                NOT EXISTS (
                  SELECT 1
                    FROM public.strategy_keys sk
                   WHERE sk.strategy_id = lrs.strategy_id
                )
                -- half 2: ANY eligible member is enough, deliberately, and not
                -- "all members eligible". A composite whose members are PARTLY
                -- disconnected is still refreshable over its remaining declared
                -- windows; an all-members-eligible rule would silently drop a live
                -- composite the day ONE member is revoked, which is a
                -- fail-toward-silence this phase exists to remove. The three key
                -- predicates are the same role-agnostic eligible-key set the
                -- single-key arm uses.
                OR EXISTS (
                  SELECT 1
                    FROM public.strategy_keys sk2
                    JOIN public.api_keys ak ON ak.id = sk2.api_key_id
                   WHERE sk2.strategy_id = lrs.strategy_id
                     AND COALESCE(ak.is_active, TRUE)
                     AND ak.sync_status IS DISTINCT FROM 'revoked'
                     AND ak.disconnected_at IS NULL
                )
              )
          -- Attempt cooldown — THE BINDING BOUND on recurrence (see the header).
          -- Keyed on the prior ATTEMPT, not the prior success, so a permanently
          -- failing composite costs ~1 job/day instead of 24. Only this kind is
          -- counted: unlike the single-key arm there is no follow-on hop to also
          -- look for, because this kind is chain-terminal. `compute_jobs` terminal
          -- retention is 30 days (20260515113853:198), comfortably longer than the
          -- cooldown, so the cooldown cannot silently void by losing the row it
          -- reads. Cannot partition: a single-key strategy with no recent attempt
          -- passes this too.
          AND NOT EXISTS (
                SELECT 1
                  FROM public.compute_jobs cj
                 WHERE cj.strategy_id = lrs.strategy_id
                   AND cj.kind = 'stitch_composite'
                   AND cj.created_at > now() - INTERVAL '20 hours'
              )
          -- Non-terminal in-flight guard, the same shape and the same widened
          -- status set as the single-key arm. 'failed_retry' is INCLUDED
          -- deliberately: `CLAIMABLE_STATUSES = ("pending", "failed_retry")`
          -- (job_worker.py:200), so such a row is scheduled to be claimed again and
          -- is in-flight in every sense that matters here. Any kind counts, not
          -- just this one — a composite already busy with another kind must not
          -- also be stitched. Cannot partition.
          AND NOT EXISTS (
                SELECT 1
                  FROM public.compute_jobs cj2
                 WHERE cj2.strategy_id = lrs.strategy_id
                   AND cj2.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
              )
      )
      -- ---- THE ONE INTEGER: a BURST CAP, not a safety bound ---------------
      --  (a) One enqueue costs exactly ONE 1200 s handler ceiling. This kind is
      --      CHAIN-TERMINAL (job_worker.py:528), so there is no follow-on hop to
      --      add — the honest per-strategy chain cost, and the one respect in
      --      which this arm is cheaper than the single-key one.
      --  (b) ⛔ THE BINDING CONSTRAINT IS THE 20-HOUR ATTEMPT COOLDOWN ABOVE, NOT
      --      THIS LIMIT. This LIMIT bounds what ONE TICK adds to a SHARED queue.
      --      Overhang past the tick is EXPECTED; the in-flight guard and the
      --      cooldown are what absorb it.
      --  (c) ⛔ Do NOT re-derive this from "n × 1200 s fits in an hourly tick".
      --      That formula assumes this arm owns the tick (it does not — the same
      --      worker is draining the single-key arm's 1500 s chains) and at n = 3 it
      --      lands on an EQUALITY, which is not a bound. Full derivation, as blast
      --      radius against a measured cohort of one, is in this file's header.
      SELECT c.strategy_id
        FROM candidates c
       ORDER BY c.last_return_date ASC NULLS FIRST, c.strategy_id
       LIMIT 2
    LOOP
      BEGIN
        -- ⛔ COUNT INSERTIONS, NOT CALLS. _enqueue_compute_job_internal
        -- (20260716090000:229-300) RETURNS the id of an existing in-flight job
        -- when it finds one (:259-261) and inserts ON CONFLICT DO NOTHING (:276) —
        -- so it never raises, a per-row `unique_violation` handler can never fire,
        -- and a naive `counter := counter + 1` per iteration would report the
        -- number of CALLS. The founder reads this integer back at activation
        -- (docs/runbooks/ledger-refresh-go-live.md), so it must mean what it says.
        -- REACHABILITY (IN-01, ported from 20260825130000): this pre-count is a
        -- race-window backstop, NOT the in-flight guard. The guard is the
        -- in-flight conjunct in the candidate CTE above; this re-reads because the
        -- advisory lock serialises fan-out TICKS, not the API — an externally
        -- committed enqueue can land between the CTE's snapshot and this loop's
        -- fresh READ COMMITTED snapshot. It can therefore only UNDERCOUNT, never
        -- over-report.
        --
        -- ⚠️ NO TEST DRIVES THIS NON-ZERO. A green suite is not evidence it fired.
        -- The one other path that would — the same strategy iterated twice in one
        -- tick — is ruled out structurally: strategy_analytics.strategy_id is
        -- UNIQUE and strategy_analytics_series is PRIMARY KEY (strategy_id, kind),
        -- so the view emits exactly one row per strategy.
        SELECT count(*) INTO v_existing
          FROM public.compute_jobs
         WHERE strategy_id = v_row.strategy_id
           AND kind = 'stitch_composite'
           AND status IN ('pending', 'running', 'done_pending_children');

        -- ⛔ p_strategy_id ALONE. enqueue_compute_job enforces exactly-one-of
        -- {p_strategy_id, p_allocator_id, p_api_key_id} and raises 22023 otherwise
        -- (20260515210300:330-332; measured on PROD during the A7 tracer). This
        -- kind is registered strategy-scoped in BOTH compute_jobs CHECKs
        -- (20260710130000), so strategy-only is also the only target shape the
        -- coherence CHECK admits.
        --
        -- ⚠️ The 'source' value is DISTINCT from the single-key arm's on purpose,
        -- so the two mechanisms are told apart in the queue — and it is a CONTRACT
        -- rather than a label: the non-destructive failure guard in
        -- analytics-service/services/job_worker.py reads it back off this job row
        -- and declines to un-publish a live composite when it matches. If the two
        -- spellings drift, this still enqueues and the guard still compiles, and
        -- the only symptom is that the next failed refresh silently un-publishes a
        -- funded account. The static gate pins the pair.
        v_job_id := enqueue_compute_job(
          p_strategy_id := v_row.strategy_id,
          p_kind        := 'stitch_composite',
          p_metadata    := jsonb_build_object(
                             'source', 'ledger-refresh-composite',
                             'enqueued_at', now()
                           )
        );

        IF v_existing = 0 AND v_job_id IS NOT NULL THEN
          v_enqueued := v_enqueued + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- ⛔ Deliberately NOT `WHEN unique_violation`: that condition cannot fire
        -- here (see the counter comment above), and an exception block that cannot
        -- fire is indistinguishable from one that is protecting something — the
        -- next reader preserves it and reasons from it. Catching OTHERS keeps one
        -- poisoned row from aborting the whole tick. The SQLSTATE is carried; no
        -- identifier is (T-161.1-19).
        RAISE WARNING 'enqueue_ledger_composite_refresh: one candidate failed to enqueue (SQLSTATE %); continuing', SQLSTATE;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Release before re-raising, or the session holds the lock until it ends and
    -- every later tick on that session skips. This arm is the part authors drop.
    PERFORM pg_advisory_unlock(hashtext('ledger_refresh_composite_fanout'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('ledger_refresh_composite_fanout'));

  RAISE NOTICE 'enqueue_ledger_composite_refresh: enqueued % composite refresh job(s) this tick', v_enqueued;
  RETURN v_enqueued;
END;
$composite$;

COMMENT ON FUNCTION public.enqueue_ledger_composite_refresh() IS
  'Phase 161.1 / LEDGER-01: the recurring COMPOSITE refresh arm for ledger-backed '
  'venues. Parameterless SECURITY DEFINER; returns the number of jobs ACTUALLY '
  'INSERTED this tick. DORMANT until the app.ledger_refresh_enabled database '
  'setting is exactly ''true'' (fail-closed) — the SAME switch the single-key arm '
  'reads, so one reset kills both. Selects stale COMPOSITE strategies from '
  'public.ledger_refresh_staleness — declaring no venue of its own — excludes any '
  'composite with a member on the deferred venue (D-01/D-13), and enqueues '
  'stitch_composite, which is chain-terminal and writes the headline '
  'strategy_analytics row directly. Bounded by a 20-hour ATTEMPT cooldown (the '
  'binding constraint), a non-terminal in-flight guard, and a per-tick BURST cap. '
  'Registers no schedule; activation is a founder LIVE op per '
  'docs/runbooks/ledger-refresh-go-live.md.';

REVOKE ALL ON FUNCTION public.enqueue_ledger_composite_refresh()
  FROM PUBLIC, anon, authenticated;
-- pg_cron runs as superuser; no additional GRANT is required for activation.

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip.
--
-- ⛔ This block must NEVER call the function. A smoke-test invocation at apply
-- time would enqueue real jobs on PROD the moment this migration merges — which is
-- precisely the "merging changes no production behaviour" property the whole
-- design exists to hold. Assert the SHAPE, not the behaviour; behaviour is covered
-- by supabase/tests/test_ledger_refresh_composite_arm.sql.
DO $verify$
DECLARE
  v_secdef     BOOLEAN;
  v_config     TEXT[];
  v_nargs      SMALLINT;
  v_kind       TEXT;
  v_coherence  TEXT;
  v_owner      TEXT;
  v_bypassrls  BOOLEAN;
BEGIN
  -- 1. the function landed, and it takes ZERO arguments (T-161.1-15)
  SELECT p.prosecdef, p.proconfig, p.pronargs
    INTO v_secdef, v_config, v_nargs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'enqueue_ledger_composite_refresh';

  IF v_nargs IS NULL THEN
    RAISE EXCEPTION 'Migration 20260825140000: enqueue_ledger_composite_refresh missing';
  END IF;
  IF v_nargs <> 0 THEN
    RAISE EXCEPTION 'Migration 20260825140000: enqueue_ledger_composite_refresh takes % argument(s), expected 0 — a caller-supplied threshold on a cross-tenant SECURITY DEFINER function IS the attack surface (T-161.1-15)', v_nargs;
  END IF;

  -- 2. SECURITY DEFINER with a pinned search_path
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'Migration 20260825140000: enqueue_ledger_composite_refresh is not SECURITY DEFINER';
  END IF;
  IF v_config IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest(v_config) AS c WHERE c LIKE 'search_path=%'
  ) THEN
    RAISE EXCEPTION 'Migration 20260825140000: enqueue_ledger_composite_refresh does not pin search_path (proconfig=%)', v_config;
  END IF;

  -- 2b. …and the DEFINER role can actually SEE the cohort (161.1-AUDIT F-2).
  --     This function is SECURITY DEFINER, so the effective role for every read
  --     in its body is the OWNER — NOT cron.job.username, which only decides who
  --     may call it. proowner is therefore the single attribute the entire
  --     bounding story rests on, and checks 1-3 above never looked at it.
  --
  --     ⚠️ The degraded mode is fail-CLOSED, not fail-open. Without BYPASSRLS the
  --     owner-scoped RLS on api_keys / strategy_keys makes ledger_refresh_staleness
  --     resolve `exchanges` to {} under cron, the terminal && conjunct drops every
  --     row, and the cohort comes back empty. Nothing is over-enqueued. But a
  --     silently-zero fan-out is BYTE-IDENTICAL to "nothing was stale" — which is
  --     precisely the wedge shape this phase exists to remove. A refresh mechanism
  --     that cannot distinguish "healthy" from "blind" reproduces the defect it was
  --     built to fix, so this is an OBSERVABILITY hole rather than a security one,
  --     and it is worth failing the apply over.
  --     Assertion shape follows 20260806130000 (JOIN pg_roles r ON r.oid = p.proowner).
  SELECT r.rolname, r.rolbypassrls
    INTO v_owner, v_bypassrls
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public'
     AND p.proname = 'enqueue_ledger_composite_refresh';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Migration 20260825140000: could not resolve the owner of enqueue_ledger_composite_refresh — pg_proc.proowner has no matching pg_roles row';
  END IF;
  IF v_bypassrls IS NOT TRUE THEN
    RAISE EXCEPTION 'Migration 20260825140000: enqueue_ledger_composite_refresh is owned by role "%", which lacks BYPASSRLS. As SECURITY DEFINER it reads ledger_refresh_staleness as that role, so api_keys/strategy_keys RLS collapses `exchanges` to the empty array, the venue conjunct drops every row and the fan-out returns 0 on every tick — indistinguishable from a healthy, fully-fresh estate', v_owner;
  END IF;

  -- 3. no EXECUTE for the browser-reachable roles. has_function_privilege resolves
  --    grants made to PUBLIC and via role inheritance, which is how a default
  --    privilege would leak in.
  IF has_function_privilege('anon', 'public.enqueue_ledger_composite_refresh()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20260825140000: role anon can EXECUTE enqueue_ledger_composite_refresh (cross-tenant enqueue)';
  END IF;
  IF has_function_privilege('authenticated', 'public.enqueue_ledger_composite_refresh()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20260825140000: role authenticated can EXECUTE enqueue_ledger_composite_refresh (cross-tenant enqueue)';
  END IF;

  -- 4. the cohort view this body depends on exists. Without it the function
  --    compiles (plpgsql resolves at run time) and fails on the first tick.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'public' AND table_name = 'ledger_refresh_staleness'
  ) THEN
    RAISE EXCEPTION 'Migration 20260825140000: public.ledger_refresh_staleness is missing — apply 20260825120000 first';
  END IF;

  -- 5. the composite kind is STILL admitted by BOTH compute_jobs CHECKs. Assertion
  --    shape copied from the kind-registration migration 20260710130000: a CHECK
  --    re-base that silently drops a kind is a recorded failure mode in this repo
  --    (that migration's own header documents copying an older coherence template
  --    and losing an arm). If either CHECK stopped admitting this kind, every tick
  --    of this function would raise 23514 per row and be swallowed by the per-row
  --    WARNING handler above — a fan-out that logs and enqueues nothing.
  SELECT pg_get_constraintdef(oid) INTO v_kind
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass
     AND conname = 'compute_jobs_kind_check';
  SELECT pg_get_constraintdef(oid) INTO v_coherence
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass
     AND conname = 'compute_jobs_kind_target_coherence';

  IF v_kind IS NULL OR position('stitch_composite' IN v_kind) = 0 THEN
    RAISE EXCEPTION 'Migration 20260825140000: stitch_composite is not admitted by compute_jobs_kind_check — this arm would enqueue nothing';
  END IF;
  IF v_coherence IS NULL OR position('stitch_composite' IN v_coherence) = 0 THEN
    RAISE EXCEPTION 'Migration 20260825140000: stitch_composite is not admitted by compute_jobs_kind_target_coherence — this arm would enqueue nothing';
  END IF;

  RAISE NOTICE 'Migration 20260825140000: enqueue_ledger_composite_refresh applied DORMANT (no schedule registered, activation setting fail-closed)';
END $verify$;

COMMIT;
