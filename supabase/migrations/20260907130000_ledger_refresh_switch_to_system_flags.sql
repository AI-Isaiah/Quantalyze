-- Migration: the ledger-refresh activation switch moves off a database setting
-- no operator on this platform can set, and onto the EXISTING public.system_flags
-- table — fail-CLOSED, in both fan-out bodies.
-- Phase 164.7 / plan 03 / criterion 2 (APPSETTINGS). 2026-09-07.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — the TWO PROD bodies these CREATE OR REPLACEs
-- overwrite. Both arms drift, and both are acknowledged separately.
--
-- prod-body-ack: 88e6af8472e4e48175a62b1ee189f7411407b14827d948c81aa015f511ae6e36
-- prod-body-ack: 7c3d33e96f1cbe5a864750ff083670e23ab4c586b8529d48da005006b4d81ac4
--
-- The gate compares the COMMITTED SNAPSHOT (supabase/schema/functions/) against
-- PROD's live body. On any function-changing migration PR the two necessarily
-- disagree: `snapshot-drift` requires the snapshot to carry the body the
-- MIGRATIONS produce (the new one), while VAC-04 requires it to match what PROD
-- has TODAY (the old one). The pragma is the designed resolution, and it means
-- "I read PROD's body and intend to overwrite it" — so it was EARNED, not
-- pasted:
--
--   MEASURED 2026-09-07, workflow run 34138679709 at 51f576ef:
--     enqueue_ledger_refresh_for_strategies/0
--       PROD live sha256            88e6af84...ae6e36   (15 differing lines)
--       committed snapshot at HEAD  adeb6d16...53705f
--     enqueue_ledger_composite_refresh/0
--       PROD live sha256            7c3d33e9...4d81ac4   (15 differing lines)
--       committed snapshot at HEAD  15e3ba96...2996b5
--
--   and, reproduced LOCALLY with the gate's own normalizer, aiming its `live`
--   argument at origin/main's snapshot rather than at PROD:
--     node scripts/sql-body-normalize.mjs --diff-bodies \
--       supabase/schema/functions/<fn>.sql <origin/main's copy of the same file>
--   returned, for BOTH functions, the SAME two hashes and the SAME 15 differing
--   lines the gate reported against PROD.
--
-- ⭐ PROD's live bodies are therefore EXACTLY the repository's last-known
-- committed snapshots on main, for BOTH arms. There is NO out-of-band patch —
-- DRIFT-02's shape is ABSENT. The 15 lines in each are this phase's Lock B
-- replacement and nothing else: the activation read moves from the `app.`
-- namespace database setting to public.system_flags, and every other line of
-- both bodies is the 20260825130000 / 20260825140000 snapshot byte for byte.
--
-- ⚠️ The local reproduction is what makes this an ACK rather than a hash
-- transcribed off a log. Copying the two `prod-body-ack:` lines from CI output
-- would satisfy the grep while proving nothing about what is being overwritten;
-- deriving the same hashes from origin/main is what identifies PROD's body.
--
-- ⚠️ OPS: merging supabase/migrations/** to main AUTO-APPLIES to PROD. This file
-- redefines two live SECURITY DEFINER functions, so the new bodies are live on
-- the next merge with no separate deploy step.
--
-- ⛔ READ THIS FIRST: what this file does NOT do
-- ----------------------------------------------
-- It registers NO recurring database job. Not registered-but-inactive, not
-- commented out — none, anywhere in this file, and this file carries no token of
-- that kind even in prose (the phase's static dormancy gate scans it RAW, with
-- comments included, once its timestamp enters the gate's selection). Activation
-- stays exactly where 161.1 put it: two ordered founder LIVE ops owned by
-- docs/runbooks/ledger-refresh-go-live.md. Criterion 3 is a founder op, not an
-- executor step.
--
-- It re-points nothing else. The two 20260825 migrations are UNTOUCHED — they
-- remain the record of what was applied to PROD in August, and this file is a
-- forward CREATE OR REPLACE re-based on their committed snapshots.
--
-- Merging this file still changes ZERO production behaviour: STEP 1 seeds the
-- new flag FALSE, and the first statement of each redefined body returns 0 while
-- it is anything other than TRUE.
--
--
-- D-01 — WHY THE EXISTING TABLE, AND WHY THIS MOVE AT ALL
-- --------------------------------------------------------
-- The activation switch these two bodies read was a database setting in the
-- `app.` namespace. MEASURED on PROD 2026-09-05: an operator attempting to set
-- it is refused with 42501. So the switch the runbook tells a founder to throw
-- cannot be thrown by the founder — the mechanism looked like one and was not,
-- which is the exact failure class this phase exists to eliminate.
--
-- public.system_flags (20260407164606_perfect_match.sql:44-49) is the mechanism
-- this repo already answered that question with in April: `key TEXT PRIMARY KEY,
-- enabled BOOLEAN NOT NULL, updated_at, updated_by`, RLS-enabled, three policies,
-- a working admin flip route (src/app/api/admin/match/kill-switch/route.ts) and a
-- fail-closed consumer with a red-team test. Rule 7 (surface conflicts, do not
-- average them) says pick the one that is more tested, so this migration adds no
-- second settings table.
--
-- ⚠️ THE COST OF THE MOVE, STATED: the old read could not raise. A table read
-- can — missing table, permission denied, planner fault. So the replacement must
-- return 0 on ANY failure, not merely on `enabled = false`, and it must stay the
-- FIRST statement of the body (161.1's own comment calls that placement
-- deliberate). That is what the guard below is, and it is why the read is wrapped
-- rather than written bare.
--
-- ⚠️ Exact-equality semantics SURVIVE the move and are strictly improved. The
-- original comment enumerated `'1'`, `'on'`, `'TRUE'` and `'true '` with a
-- trailing space as four ways to open the flag by accident. A BOOLEAN NOT NULL
-- column makes that whole class UNREPRESENTABLE rather than merely rejected:
-- there is no string to normalise and no cast to get wrong.
--
--
-- C-03 — THE ONE BRANCH OF THE send-intro MODEL THAT IS REJECTED HERE
-- --------------------------------------------------------------------
-- src/app/api/admin/match/send-intro/route.ts reads system_flags in three
-- documented branches:
--   (1) read error            -> fail CLOSED (503).  ADOPTED here.
--   (3) row present, FALSE    -> fail CLOSED (503).  ADOPTED here.
--   (2) row MISSING           -> treat as ENABLED.   ⛔ REJECTED here.
-- Branch (2) is deliberate and correct THERE: match_engine_enabled is a kill
-- switch that defaults ON, so a brand-new project with no row must still work.
-- ledger_refresh_enabled is the INVERSE — a dormant-by-default activation switch
-- whose entire design property is that merging changes no production behaviour.
-- A missing row must therefore mean DORMANT. Copying send-intro wholesale would
-- have opened the flag on exactly the state a fresh apply produces.
--
-- STEP 1 seeds the row FALSE so that a missing row is never the normal state
-- either; the rejection above is what happens when it is not the normal state.
--
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — to be EARNED on the PR (plan 06)
--
-- This migration CREATE OR REPLACEs two function bodies that are live on PROD,
-- so the repo-vs-PROD body gate will report DRIFT for exactly these two names on
-- this PR: `snapshot-drift` requires supabase/schema/functions/ to carry the body
-- the MIGRATIONS produce (the new one), while the PROD-body gate requires it to
-- match what PROD has TODAY (the old one). The acknowledgement pragma is the
-- designed resolution of that pair, and it means "I read PROD's body and intend
-- to overwrite it".
--
-- The evidence block plan 06 fills in, in the shape 20260906120000 established:
--
--   MEASURED <date>, workflow run <id> at <sha>:
--     PROD live sha256 (enqueue_ledger_refresh_for_strategies)  <measured in plan 06>
--     PROD live sha256 (enqueue_ledger_composite_refresh)       <measured in plan 06>
--     committed snapshot at HEAD                                <measured in plan 06>
--   and, reproduced LOCALLY with the gate's own normalizer,
--   `node scripts/sql-body-normalize.mjs --diff-bodies <origin/main snapshot> <HEAD snapshot>`:
--     origin/main snapshot sha256                               <measured in plan 06>
--     HEAD snapshot sha256                                      <measured in plan 06>
--   differing lines                                             <measured in plan 06>
--
-- ⛔ The pragma line itself (the `prod-body-ack` token followed by PROD's live
-- body hash, which scripts/prod-body-drift-check.sh greps for as a FIXED STRING)
-- is DELIBERATELY ABSENT from this file today. A placeholder hash matches
-- nothing, and an unmatched placeholder reads at a glance exactly like a real
-- acknowledgement. Absence is the honest state until the hashes are measured.
--
-- ⛔ AND WHEN THEY ARE MEASURED: had the origin/main snapshot hash NOT equalled
-- PROD's live hash, the correct action is to FOLD the difference into this
-- migration — never to record the pragma anyway. The ack is evidence that PROD
-- was read, not a way to silence the gate. It is EARNED, not pasted.
-- ══════════════════════════════════════════════════════════════════════════
--
--
-- RE-BASE DISCIPLINE (DRIFT-02)
-- ------------------------------
-- The LEFT side of both re-bases is the COMMITTED SNAPSHOT under
-- supabase/schema/functions/ — the artifact the PROD-body gate compares against —
-- not the 20260825 migration text. The two are identical today; the snapshot is
-- canonical, and using it is what makes "identical today" a measurement rather
-- than an assumption. Everything outside the guard is copied VERBATIM: the
-- advisory locks and their unlock-before-re-raise arms, the candidate CTEs, the
-- LIMIT / venue-rank / 20-hour cooldown literals, the per-candidate handler, the
-- insertions-not-calls counter, the closing NOTICEs. Each body's dollar-quote
-- TAG is kept exactly as the snapshot spells it: the phase's static gates locate
-- each body by its own tag, and a renamed tag silently empties the region every
-- one of those gates asserts over.
--
-- Convention: BEGIN/COMMIT with a session lock_timeout, matching the repo
-- majority and the two migrations this file re-bases (project Rule 11).

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: seed the flag, DORMANT
-- --------------------------------------------------------------------------
-- ⛔ This file does NOT create public.system_flags. 20260407164606 does, and a
-- second CREATE TABLE IF NOT EXISTS here would be a second definition of one
-- object with nothing keeping the two in step (and, on the pg-lane, a stand-in
-- shadowing the real thing — lint rule R5). This migration only INSERTs.
--
-- ON CONFLICT DO NOTHING, deliberately: a re-apply (fresh project, disaster
-- recovery, the mutation lane) must never flip a switch an operator has set. And
-- seeding FALSE rather than TRUE is what keeps "merging this migration changes
-- ZERO production behaviour" literally true — the row exists so that the flip is
-- an UPDATE, and it is closed so that the flip is the only thing that opens it.
INSERT INTO public.system_flags (key, enabled)
VALUES ('ledger_refresh_enabled', FALSE)
ON CONFLICT (key) DO NOTHING;

-- --------------------------------------------------------------------------
-- STEP 2: the single-key fan-out
-- --------------------------------------------------------------------------
-- Re-based on supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql
-- (source migration 20260825130000), Lock B replaced. Every other line of the
-- body is that snapshot's, byte for byte.
CREATE OR REPLACE FUNCTION public.enqueue_ledger_refresh_for_strategies()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fanout$
DECLARE
  v_enabled  BOOLEAN;
  v_row      RECORD;
  v_job_id   UUID;
  v_existing INTEGER;
  v_enqueued INTEGER := 0;
BEGIN
  -- ---- Lock B (D-08, 164.7 D-01): the fail-closed activation switch ------
  -- FIRST statement in the body, deliberately — unchanged from the form this
  -- replaces, and the placement is the point: nothing this function does can
  -- happen before the switch has been read.
  --
  -- WHAT CHANGED. The switch was a database setting in the `app.` namespace;
  -- an operator on this platform is refused 42501 when setting one (MEASURED on
  -- PROD 2026-09-05), so the runbook's activation step could not be performed.
  -- It now reads public.system_flags, which this project has been operating
  -- since April. The column is BOOLEAN NOT NULL, so the old comment's list of
  -- near-misses — '1', 'on', 'TRUE', 'true ' with a trailing space — is no longer
  -- a class that must be REJECTED by an exact comparison; it is a class that
  -- cannot be REPRESENTED. That is the improvement, and it is why no normaliser
  -- and no cast appears anywhere below.
  --
  -- FAIL-CLOSED ON EVERY PATH, which is what the wrapping buys:
  --   * read raises (table dropped, permission denied, planner fault) -> the
  --     handler leaves v_enabled NULL -> dormant;
  --   * NO ROW for this key -> SELECT INTO without STRICT assigns NULL ->
  --     dormant. ⛔ This is the DELIBERATE INVERSE of the missing-row branch in
  --     src/app/api/admin/match/send-intro/route.ts, which treats a missing row
  --     as ENABLED. That is right for a kill switch defaulting ON and wrong
  --     here: this is a dormant-by-default activation switch, so its absent
  --     state must be its closed state. Only that route's error branch and its
  --     enabled=false branch transfer.
  --   * row present and FALSE -> dormant.
  --
  -- ⛔ THE COMPARISON IS NULL-SAFE AND MUST STAY SO. With v_enabled NULL both
  -- `v_enabled <> TRUE` and `NOT v_enabled` evaluate to NULL, the IF is not
  -- taken, and the body falls THROUGH to the fan-out — i.e. those two spellings
  -- open the flag on precisely the failure path this guard exists for.
  --
  -- ⚠️ NOTHING but the assignment goes in the handler. A probe or a second read
  -- inside an EXCEPTION block is the shape lint rule R1 flags in the gate corpus;
  -- keeping it clean at the source is what stops a gate copying the bad shape.
  --
  -- Resetting the row is still the incident-pressure kill switch: the next tick
  -- returns 0 with no schedule operation, no deploy and no migration. It is an
  -- UPDATE an admin session or the service role can already make.
  BEGIN
    SELECT sf.enabled INTO v_enabled
      FROM public.system_flags sf
     WHERE sf.key = 'ledger_refresh_enabled';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_ledger_refresh_for_strategies: activation flag read failed (SQLSTATE %); treating as dormant', SQLSTATE;
    v_enabled := NULL;
  END;
  IF v_enabled IS DISTINCT FROM TRUE THEN
    RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: dormant (system_flags.ledger_refresh_enabled is not TRUE); enqueued 0';
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
  'jobs ACTUALLY INSERTED this tick. DORMANT unless public.system_flags holds the '
  'key ''ledger_refresh_enabled'' with enabled = TRUE (Phase 164.7 / D-01; the '
  'read is fail-CLOSED — a missing row, a FALSE row and a failing read are all '
  'dormant). Selects stale, non-composite, key-eligible strategies from '
  'public.ledger_refresh_staleness — declaring no venue of its own — and enqueues '
  'derive_broker_dailies in strategy-mode (the chain TAIL, which auto-chains to '
  'compute_analytics_from_csv; the chain HEAD is a provable no-op on a published '
  'strategy). Bounded by a 20-hour ATTEMPT cooldown (the binding constraint), an '
  'in-flight conjunct, a per-venue rank cap and a per-tick burst LIMIT. Registers '
  'no schedule; activation is a founder LIVE op per '
  'docs/runbooks/ledger-refresh-go-live.md.';

REVOKE ALL ON FUNCTION public.enqueue_ledger_refresh_for_strategies()
  FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 3: the composite arm
-- --------------------------------------------------------------------------
-- Re-based on supabase/schema/functions/enqueue_ledger_composite_refresh.sql
-- (source migration 20260825140000), Lock B replaced with the SAME guard. It
-- reads the SAME key, so one reset still kills BOTH arms on the next tick.
CREATE OR REPLACE FUNCTION public.enqueue_ledger_composite_refresh()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $composite$
DECLARE
  v_enabled  BOOLEAN;
  v_row      RECORD;
  v_job_id   UUID;
  v_existing INTEGER;
  v_enqueued INTEGER := 0;
BEGIN
  -- ---- the fail-closed activation switch (164.7 D-01) --------------------
  -- FIRST statement in the body, deliberately, and it reads the SAME key the
  -- single-key arm reads so ONE reset kills BOTH arms on the next tick.
  --
  -- The reasoning is the single-key arm's, and it is not repeated in full here
  -- on purpose — two copies of one argument drift. In brief: the switch moved
  -- off a database setting an operator is refused 42501 when setting (MEASURED
  -- on PROD 2026-09-05) and onto public.system_flags; the BOOLEAN NOT NULL
  -- column makes the old '1' / 'on' / 'TRUE' / 'true ' class unrepresentable
  -- rather than merely rejected; a read that RAISES leaves v_enabled NULL and a
  -- MISSING ROW leaves it NULL too, both of which are DORMANT — the deliberate
  -- inverse of send-intro/route.ts, whose missing-row branch is fail-OPEN
  -- because its switch defaults ON and this one does not.
  --
  -- ⛔ The comparison is NULL-safe and must stay so: `<> TRUE` and `NOT
  -- v_enabled` both evaluate NULL when the read failed, so the IF falls through
  -- and the flag opens on exactly the failure path.
  BEGIN
    SELECT sf.enabled INTO v_enabled
      FROM public.system_flags sf
     WHERE sf.key = 'ledger_refresh_enabled';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_ledger_composite_refresh: activation flag read failed (SQLSTATE %); treating as dormant', SQLSTATE;
    v_enabled := NULL;
  END;
  IF v_enabled IS DISTINCT FROM TRUE THEN
    RAISE NOTICE 'enqueue_ledger_composite_refresh: dormant (system_flags.ledger_refresh_enabled is not TRUE); enqueued 0';
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
  'INSERTED this tick. DORMANT unless public.system_flags holds the key '
  '''ledger_refresh_enabled'' with enabled = TRUE (Phase 164.7 / D-01) — the SAME '
  'row the single-key arm reads, so one reset kills both, and the read is '
  'fail-CLOSED on a missing row, a FALSE row and a failing read alike. Selects '
  'stale COMPOSITE strategies from public.ledger_refresh_staleness — declaring no '
  'venue of its own — excludes any composite with a member on the deferred venue '
  '(D-01/D-13), and enqueues stitch_composite, which is chain-terminal and writes '
  'the headline strategy_analytics row directly. Bounded by a 20-hour ATTEMPT '
  'cooldown (the binding constraint), a non-terminal in-flight guard, and a '
  'per-tick BURST cap. Registers no schedule; activation is a founder LIVE op per '
  'docs/runbooks/ledger-refresh-go-live.md.';

REVOKE ALL ON FUNCTION public.enqueue_ledger_composite_refresh()
  FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip.
--
-- ⛔ This block must NEVER call either function. A smoke-test invocation at apply
-- time would enqueue real jobs on PROD the moment this migration merges — which
-- is precisely the "merging changes no production behaviour" property the whole
-- design exists to hold. Assert the SHAPE, not the behaviour; behaviour is
-- covered by the pg-lane tracer and by supabase/tests/test_ledger_refresh_*.sql.
DO $verify$
DECLARE
  -- ⛔ plpgsql compiles a DO block WHOLE: a missing DECLARE raises 42601 and NONE
  --    of the checks below run — it does not weaken one check, it stops all of
  --    them. MEASURED on this repo 2026-08-25, when the first revision of
  --    20260825130000's check 5 omitted two DECLAREs and could not apply at all.
  --    Since migrations AUTO-APPLY to PROD on merge, that lands on production.
  v_fn          TEXT;
  v_secdef      BOOLEAN;
  v_config      TEXT[];
  v_nargs       SMALLINT;
  v_owner       TEXT;
  v_bypassrls   BOOLEAN;
  v_super       BOOLEAN;
  v_def_raw     TEXT;
  v_def         TEXT;
  v_seeded      BOOLEAN;
  -- The two positive needles, held in variables so the loop states each one once.
  v_flag_needle TEXT := 'FROM public.system_flags';
  -- ⚠️ BOUND TO THE GUARDED VARIABLE, not floating. `IS DISTINCT FROM TRUE`
  -- alone asserts only that the token appears SOMEWHERE in the stripped body —
  -- it is satisfied by a null-safe comparison of any other variable, in any
  -- other statement, while the activation guard itself has been rewritten to
  -- `NOT v_enabled`. Naming the variable is what makes check 5 an assertion
  -- about the flag. Measured before tightening: `v_enabled IS DISTINCT FROM
  -- TRUE` occurs exactly ONCE per body (and nowhere else in this file), so the
  -- widened needle costs nothing today and refuses the drift tomorrow.
  v_null_needle TEXT := 'v_enabled IS DISTINCT FROM TRUE';
  -- ⛔ ASSEMBLED BY CONCATENATION, DELIBERATELY, and do NOT "tidy" it into one
  --    literal. Check (6) asserts that the retired app-namespace database-setting
  --    call appears NOWHERE in the executable body. Written whole, the needle
  --    would itself be an occurrence of that call's spelling inside this file —
  --    and this file is scanned RAW, comments included, both by the phase's
  --    dormancy gate and by the new repo-wide reader lint. The assertion would
  --    then be the very hit it exists to forbid.
  v_guc_needle  TEXT := 'current_' || 'setting(''app.' || 'ledger_refresh_enabled''';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'enqueue_ledger_refresh_for_strategies',
    'enqueue_ledger_composite_refresh'
  ]
  LOOP
    -- 1. the function landed, and it takes ZERO arguments (T-161.1-06/-15).
    SELECT p.prosecdef, p.proconfig, p.pronargs, pg_get_functiondef(p.oid)
      INTO v_secdef, v_config, v_nargs, v_def_raw
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = v_fn;

    IF v_nargs IS NULL THEN
      RAISE EXCEPTION 'Migration 20260907130000: public.% is missing after its own CREATE OR REPLACE — the re-base did not land', v_fn;
    END IF;
    IF v_nargs <> 0 THEN
      RAISE EXCEPTION 'Migration 20260907130000: public.% takes % argument(s), expected 0 — a caller-supplied threshold on a cross-tenant SECURITY DEFINER function IS the attack surface', v_fn, v_nargs;
    END IF;

    -- 2. SECURITY DEFINER with a pinned search_path, both preserved by the
    --    re-base. These live in the CREATE FUNCTION declaration, OUTSIDE the
    --    dollar-quoted body, which is exactly the region a body-only copy loses.
    IF v_secdef IS NOT TRUE THEN
      RAISE EXCEPTION 'Migration 20260907130000: public.% is not SECURITY DEFINER — the re-base dropped it', v_fn;
    END IF;
    IF v_config IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(v_config) AS c WHERE c LIKE 'search_path=%'
    ) THEN
      RAISE EXCEPTION 'Migration 20260907130000: public.% does not pin search_path (proconfig=%) — the re-base dropped it', v_fn, v_config;
    END IF;

    -- 2b. …and the DEFINER role can actually SEE the cohort (161.1-AUDIT F-2).
    --     Copied from 20260825130000 WITH ITS CORRECTION: the predicate is
    --     `rolsuper OR rolbypassrls`, never rolbypassrls alone. pg_roles
    --     .rolbypassrls reports only the EXPLICITLY granted attribute, while a
    --     SUPERUSER bypasses RLS implicitly with the flag still FALSE — so the
    --     narrow predicate is a FALSE NEGATIVE that aborts a correct apply, and
    --     this file is on the auto-apply-to-PROD route where an abort lands
    --     mid-file with no rollback step.
    --
    --     ⚠️ This check now guards a SECOND read as well as the cohort. The
    --     activation guard reads public.system_flags, which is RLS-enabled with
    --     no policy admitting this role; it resolves because the DEFINER owner is
    --     RLS-exempt. Lose the exemption and BOTH reads degrade — and both
    --     degrade CLOSED (empty cohort, NULL flag), which is safe and silent,
    --     i.e. indistinguishable from "nothing was stale". That is the wedge
    --     shape this phase removes, so it is worth failing the apply over.
    SELECT r.rolname, r.rolbypassrls, r.rolsuper
      INTO v_owner, v_bypassrls, v_super
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_roles r ON r.oid = p.proowner
     WHERE n.nspname = 'public'
       AND p.proname = v_fn;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'Migration 20260907130000: could not resolve the owner of public.% — pg_proc.proowner has no matching pg_roles row', v_fn;
    END IF;
    IF NOT (COALESCE(v_bypassrls, FALSE) OR COALESCE(v_super, FALSE)) THEN
      RAISE EXCEPTION 'Migration 20260907130000: public.% is owned by role "%" (rolsuper=%, rolbypassrls=%), which is exempt from row security by neither route. As SECURITY DEFINER it reads ledger_refresh_staleness AND the RLS-enabled public.system_flags as that role, so the cohort collapses to empty and the activation flag reads NULL — both fail CLOSED, silently, which is byte-identical to "nothing was stale"', v_fn, v_owner, v_super, v_bypassrls;
    END IF;

    -- 3. no EXECUTE for the browser-reachable roles. has_function_privilege
    --    resolves grants made to PUBLIC and via role inheritance, which is how a
    --    default privilege would leak in. CREATE OR REPLACE preserves existing
    --    grants, so this is checking that the REVOKEs above still hold rather
    --    than that they were needed.
    IF has_function_privilege('anon', format('public.%I()', v_fn), 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20260907130000: role anon can EXECUTE public.% (cross-tenant enqueue)', v_fn;
    END IF;
    IF has_function_privilege('authenticated', format('public.%I()', v_fn), 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20260907130000: role authenticated can EXECUTE public.% (cross-tenant enqueue)', v_fn;
    END IF;

    -- 4/5/6. THE GUARD ITSELF, asserted on the EXECUTABLE text.
    --
    -- ⚠️ D-05: pg_get_functiondef returns the body WITH its comments, so a
    -- position() test over the raw definition is a test a COMMENT can satisfy.
    -- Comments are stripped first and the assertions run on what is left.
    --
    -- ⭐ WHY THE STRIP IS HERE, STATED AS THE TWO REASONS THAT ARE TRUE RATHER
    -- THAN THE ONE THAT IS NOT. It would be tidy to say "this body's own prose
    -- would satisfy the raw match", and that claim is FALSE: MEASURED on both
    -- bodies in this file, `FROM public.system_flags` and
    -- `IS DISTINCT FROM TRUE` each occur exactly ONCE, in CODE, and ZERO times
    -- in any comment. The two reasons that hold:
    --   (i) lint rule R2-functiondef-comment-strip mandates the idiom BY RULE
    --       for any regex/LIKE over a pg_get_functiondef result — the rule was
    --       written against a divergence measured on a DIFFERENT body (PROD's
    --       7-param _enqueue_compute_job_internal), not against this one;
    --   (ii) the property has to hold under FUTURE comment edits that nobody
    --       re-measures. A sentence added to the Lock B block next year that
    --       happens to quote `IS DISTINCT FROM TRUE` would silently make check 5
    --       unfalsifiable, and nothing would report it.
    --
    -- ⚠️ RESIDUAL, RECORDED not closed, and it is the FALSE-PASS direction: this
    -- idiom does not strip `/* … */`. A block comment quoting a needle satisfies
    -- these checks with the code gone. Neither body uses one today (measured: 0
    -- occurrences of `/*` in both). The other direction is safe by construction —
    -- a `--` inside a string literal makes the strip eat real code, which can
    -- only cause a FALSE FAILURE, and a false failure is loud.
    --
    -- ⚠️ THE REGEXP FORM, matching this repo's R2 idiom and the sibling gates'.
    -- The line-based form this replaces (`btrim(src_line) NOT LIKE '--%'`) left
    -- TRAILING comments intact, which is the false-PASS direction. Measured
    -- equivalent on today's bodies — 0 code lines in either carry a trailing
    -- `--` — so this is a consistency fix that closes the file's own recorded
    -- residual rather than a behaviour change.
    v_def := regexp_replace(v_def_raw, '--[^\n]*', '', 'g');

    IF v_def IS NULL OR length(v_def) < 500 THEN
      RAISE EXCEPTION 'Migration 20260907130000: the comment-stripped definition of public.% is % character(s) — the strip is broken, so checks (4)-(6) below would pass over nothing', v_fn, COALESCE(length(v_def), 0);
    END IF;

    -- 4. the guard READS THE TABLE.
    IF position(v_flag_needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 20260907130000: public.% does not read the activation flag from the settings table (looked for "%") — the fail-closed switch is gone and this function would fan out unconditionally', v_fn, v_flag_needle;
    END IF;

    -- 5. and compares it NULL-SAFELY. `<> TRUE` and `NOT v_enabled` both
    --    evaluate NULL when the read failed or the row is absent, so the IF is
    --    not taken and the body falls THROUGH — they open the flag on exactly
    --    the failure path the guard exists for.
    IF position(v_null_needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 20260907130000: public.% does not compare the activation flag with the NULL-safe form "%" — a NULL-unsafe comparison opens the flag on the read-failure and missing-row paths, which are the two paths this guard exists for', v_fn, v_null_needle;
    END IF;

    -- 6. and the retired app-namespace database-setting call is GONE from the
    --    executable text. See the DECLARE for why this needle is concatenated.
    IF position(v_guc_needle IN v_def) <> 0 THEN
      RAISE EXCEPTION 'Migration 20260907130000: public.% still reads the retired app-namespace database setting. An operator on this platform is refused 42501 when setting it (MEASURED on PROD 2026-09-05), so that read can never be TRUE and the function is permanently dormant for the wrong reason', v_fn;
    END IF;
  END LOOP;

  -- 7. the seed landed AND Lock B is still CLOSED after the merge.
  --
  -- ⛔ If this row is already TRUE at apply time, an operator flipped the switch
  -- before this migration reached the database. That is a state to STOP and read,
  -- never to overwrite: silently forcing it back to FALSE would undo a live
  -- activation, and silently accepting it would make "merging changes ZERO
  -- production behaviour" false on the very apply that claims it.
  SELECT enabled INTO v_seeded
    FROM public.system_flags
   WHERE key = 'ledger_refresh_enabled';
  IF v_seeded IS NULL THEN
    RAISE EXCEPTION 'Migration 20260907130000: the ledger_refresh_enabled row is absent after STEP 1 seeded it — the INSERT did not land, and both fan-outs would now be dormant because their flag is MISSING rather than because it is closed';
  END IF;
  IF v_seeded THEN
    RAISE EXCEPTION 'Migration 20260907130000: the ledger_refresh_enabled flag is already TRUE at apply time. STEP 1 cannot have set it (it seeds FALSE and DOES NOTHING on conflict), so an operator opened it before this migration applied. STOP and read: this apply has just replaced both fan-out bodies under a LIVE switch. Confirm the activation was intended, then re-run';
  END IF;

  RAISE NOTICE 'Migration 20260907130000: applied DORMANT (system_flags.ledger_refresh_enabled = false; NOTHING scheduled)';
END $verify$;

COMMIT;
