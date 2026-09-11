-- Migration: both ledger-refresh fan-outs are re-based so their EXECUTE grantee
-- set is asserted WHOLE rather than probed two roles at a time, and so that a
-- dormant tick whose cause is invisible today writes ONE counted row naming it.
-- Phase 164.8.6 / plan 02 / ROADMAP criterion 4 (TODOS.md
-- 164.7-WR02-SERVICE-ROLE-EXECUTE, APPGUC-WARNING-UNINSTRUMENTED-01,
-- 164.7-DORMANCY-UNINSTRUMENTED). 2026-09-11.
--
-- ⚠️ OPS: merging supabase/migrations/** to main applies to shared TEST FIRST
-- (supabase-migrate.yml `apply-test`) and then AUTO-APPLIES to PROD behind the
-- Production environment's human reviewer gate. This file redefines TWO LIVE
-- SECURITY DEFINER functions, so both new bodies are live on the next merge with
-- no separate deploy step.
--
-- ⛔ IT IS A FORWARD MIGRATION AND NOT AN EDIT TO AN APPLIED ONE. 20260907130000
-- is applied on PROD; its REVOKEs and its verification block are widened HERE,
-- never by rewriting a file the migration ledger has already recorded.
--
-- ══════════════════════════════════════════════════════════════════════════
-- TWO FILES, ONE REPAIR — recorded rather than silently satisfied
-- ══════════════════════════════════════════════════════════════════════════
-- This is the LEDGER half. The TICK half is
-- 20260911120000_vault_tick_hardening.sql, and the two merge in ONE pull
-- request. The "one FILE" reading of the ROADMAP's "One forward migration" is
-- DISPROVEN by lane topology: the tick gate's lane applies fixtures
-- 01/02/07/12/15/32 plus 20260907120000 and NONE of the ledger stack, while the
-- two fan-out gates' lanes apply the ledger stack and no vault stand-in
-- (supabase/tests/test_ledger_refresh_fanout.sql:194,
-- supabase/tests/test_ledger_refresh_composite_arm.sql:206). One file that
-- CREATE OR REPLACEd all three SECURITY DEFINER bodies could not apply on either
-- lane — the verification block below RAISEs "is missing" for a function the
-- lane never created, which is the honest answer and an unusable one there. So:
-- "one shipped repair" holds; "one file" does not.
--
-- ⚠️ THIS FILE ADDS A LANE DEPENDENCY. Both fan-out bodies now write
-- public.cron_runs on the dormant path. The real creator of that table,
-- 20260408113029_cron_heartbeat.sql, cannot enter either fan-out apply list: its
-- two policies resolve profiles.is_admin and auth.role(), neither of which those
-- lists provide, and a policy declaration resolves them at DECLARATION time, so
-- the apply aborts on 42703 before any arm runs. The stand-in is
-- scripts/pg-lane/fixtures/33-fixture-cron-runs.sql, whose header carries the
-- full derivation; plan 03 inserts it immediately before this file in both
-- lists.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — the TWO PROD bodies these CREATE OR REPLACEs
-- overwrite. Both arms drift, and both are acknowledged SEPARATELY.
-- ══════════════════════════════════════════════════════════════════════════
-- The gate compares the COMMITTED SNAPSHOT (supabase/schema/functions/) against
-- PROD's live body. On any function-changing migration PR the two necessarily
-- disagree: `snapshot-drift` requires the snapshot to carry the body the
-- MIGRATIONS produce (the new one), while VAC-04 requires it to match what PROD
-- has TODAY (the old one). The pragma is the designed resolution, and it means
-- "I read PROD's body and intend to overwrite it".
--
-- The evidence block plan 04 of this phase fills in, in the shape
-- 20260907130000:21-34 established — ONE ENTRY PER ARM, never one for the pair:
--
--   MEASURED <date>, workflow run <id> at <sha>:
--     enqueue_ledger_refresh_for_strategies/0
--       PROD live sha256                          <measured in plan 04>
--       committed snapshot at HEAD                <measured in plan 04>
--     enqueue_ledger_composite_refresh/0
--       PROD live sha256                          <measured in plan 04>
--       committed snapshot at HEAD                <measured in plan 04>
--   and, reproduced LOCALLY with the gate's own normalizer, aiming its `live`
--   argument at origin/main's snapshot rather than at PROD:
--     node scripts/sql-body-normalize.mjs --diff-bodies \
--       supabase/schema/functions/<fn>.sql <origin/main's copy of the same file>
--     origin/main snapshot sha256                 <measured in plan 04>
--     HEAD snapshot sha256                        <measured in plan 04>
--     differing lines                             <measured in plan 04>
--
-- ⛔ THE TWO PRAGMA LINES ARE DELIBERATELY ABSENT FROM THIS FILE TODAY. The
-- pragma is the `prod-body-ack` token scripts/prod-body-drift-check.sh:1300
-- greps for as a FIXED STRING, followed by PROD's live body hash — and a
-- placeholder hash matches nothing while reading at a glance exactly like a real
-- acknowledgement. Absence is the honest state until the hashes are MEASURED.
-- Plan 04 of this phase measures them and adds the lines; nothing before that
-- may paste one.
--
-- ⛔ AND WHEN THEY ARE MEASURED: had an origin/main snapshot hash NOT equalled
-- PROD's live hash FOR THAT ARM, the correct action is to FOLD the difference
-- into this migration — never to record the pragma anyway. The ack is evidence
-- that PROD was read, not a way to silence the gate. It is EARNED, not pasted.
--
-- ══════════════════════════════════════════════════════════════════════════
-- RE-BASE DISCIPLINE (DRIFT-02)
-- ══════════════════════════════════════════════════════════════════════════
-- The LEFT side of BOTH re-bases is the COMMITTED SNAPSHOT under
-- supabase/schema/functions/ — the artifact the PROD-body gate compares against —
-- and NOT the 20260907130000 migration text. The two are identical today; the
-- snapshot is canonical, and using it is what makes "identical today" a
-- measurement rather than an assumption.
--
-- EXACTLY FOUR EDITS were made to each snapshot body, and every other line is
-- that snapshot's byte for byte — the advisory locks and their
-- unlock-before-re-raise arms, the candidate CTEs, the venue-rank cap, the
-- cooldown and burst literals with their leading whitespace, the per-candidate
-- handler, the insertions-not-calls counter, the closing NOTICEs, and each
-- body's dollar-quote TAG:
--
--   (a) three locals added to the DECLARE (a row count, a read-failed flag, and
--       the cause string);
--   (b) a row-count read added at the END of the flag read's BEGIN body, before
--       the EXCEPTION keyword;
--   (c) one ASSIGNMENT added to the handler, AFTER the line that nulls the
--       flag — an assignment is what the block's own rule and lint rule
--       R1-exception-handler-probe permit there; a probe or a read is not;
--   (d) the cause branch and the instrument INSERT added INSIDE the dormant
--       branch, AFTER its NOTICE and BEFORE its RETURN.
--
-- ⚠️ Regenerating supabase/schema/functions/ (`npm run schema:functions`) after
-- this file lands is a SEPARATE step of this phase, not an optional tidy: the
-- snapshot is what VAC-04 and src/__tests__/prod-prober-wiring.test.ts read.
--
-- ══════════════════════════════════════════════════════════════════════════
-- DISJOINTNESS — the needles this file ASSERTS vs. the strings the gates MUTATE
-- ══════════════════════════════════════════════════════════════════════════
-- A verification needle that a gate arm mutates ABORTS the apply: the gate then
-- never runs, no arm can be the first failure, and the runner scores a defect
-- that would need a waiver. WAIVED_CEILING is 0 (scripts/mutation-runner/run.mjs,
-- read it by SYMBOL) and stays 0, so an intersection here is NOT waivable — it
-- is fixed at the source. The two sets, enumerated:
--
--   MIGRATION NEEDLES (asserted by position(needle IN v_def) in STEP 3)
--     FROM public.system_flags        — the activation read's own statement shape
--     v_enabled IS DISTINCT FROM TRUE — the NULL-safe comparison, bound to the
--                                       guarded variable rather than floating
--     INSERT INTO public.cron_runs    — the dormancy instrument's own statement
--     the retired app-namespace setting call — asserted ABSENT, and assembled by
--                                       concatenation (see the DECLARE)
--
--   GATE `find` STRINGS (mutated by the twins in
--   supabase/tests/test_ledger_refresh_fanout.sql and
--   supabase/tests/test_ledger_refresh_composite_arm.sql)
--     A, K     the guard IF and its dormant NOTICE, as ONE two-line string ⟦…⟧
--     L        the handler's WARNING text and the line that nulls the flag ⟦…⟧
--     B        the job metadata's source value ⟦…⟧
--     C        the staleness predicate ⟦…⟧
--     D        the is-composite partitioning conjunct ⟦…⟧
--     E, F, G  the attempt-cooldown interval, the in-flight status set, the
--              insertions-not-calls test, the burst LIMIT ⟦…⟧
--     G1       the per-venue rank cap ⟦…⟧
--     H        the three key-eligibility conjuncts ⟦…⟧
--
-- ⛔ EVERY GATE `find` ABOVE IS NAMED IN PROSE AND NOT REPRODUCED, DELIBERATELY.
--    The mutation runner measures `occurrences` over the RAW FILE TEXT, comments
--    included (countOccurrences / applyFileStep in
--    scripts/mutation-runner/run.mjs): a verbatim paste of a find string in this
--    header would be a SECOND occurrence, the arm claims the count it measured
--    against the OLD file, and the run reports MEASURE_FAIL /
--    occurrence-mismatch — the mutation not applied, so the arm not tested.
--    Same class of trap as 20260907130000:776-783, and the reason two of the
--    four needles below are ASSEMBLED BY CONCATENATION.
--
-- ⛔ THE INSTRUMENT'S CAUSE STRINGS ARE GATE-MUTABLE AND ARE DELIBERATELY NOT
--    NEEDLES. Plan 03's instrument arms prove the row is written with the RIGHT
--    cause by mutating the cause literal and watching the gate redden. If this
--    block asserted a cause literal, that mutation would abort the apply
--    instead. What IS asserted is the INSERT's own statement shape, which every
--    cause mutation leaves intact by construction.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WR-10: THREE DORMANT CAUSES, ONE NOTICE — and which of them now leave a trace
-- ══════════════════════════════════════════════════════════════════════════
-- The guard 20260907130000 shipped is fail-closed on every path, which is
-- correct and is not what this file changes. What it cannot do is say WHY a tick
-- was dormant, and two of its three causes are indistinguishable in the log:
--
--   cause                        what happens today                writes a row
--   ---------------------------  --------------------------------  -----------
--   1 flag_read_failed           RAISE WARNING, then the NOTICE    YES
--   2 flag_false_by_design       the NOTICE                        no
--   3 flag_row_invisible_or_absent  the NOTICE, BYTE-IDENTICAL      YES
--                                to cause 2's
--
-- Cause 3 is the one that matters and the one nothing reports: the row exists and
-- says TRUE, but the DEFINER has lost its RLS exemption, so the read returns NO
-- ROW and the platform is dormant while its own switch says it is live. Cause 1
-- does raise a WARNING — and MEASURED at HEAD, nothing reads it: no prober arm
-- touches public.cron_runs and no consumer reads the server log, which is what
-- APPGUC-WARNING-UNINSTRUMENTED-01 records.
--
-- ⭐ THE DECISION, recorded rather than implied: causes 1 and 3 write one counted
-- row each; cause 2 writes NOTHING. Cause 2 is the healthy dormant state, it is
-- already legible from the flag row itself, and no purge of public.cron_runs
-- exists anywhere in this repo (MEASURED at HEAD) — two functions x 24 ticks a
-- day would accrue 48 rows a day for the whole pre-activation period to restate
-- a fact a single SELECT on the flag row already gives. Writing only the two
-- INVISIBLE causes closes WR-10 and the WARNING-uninstrumented entry with one
-- row shape and leaves the healthy platform silent.
--
-- ⚠️ RETENTION, recorded not closed: there is still no purge. Causes 1 and 3 are
-- both defect states, so a growing count IS the signal; but if either becomes
-- chronic, one row per function per tick accrues at the same 48/day. The
-- disposition if that happens is a retention policy on public.cron_runs, not a
-- quieter instrument.
--
-- ⚠️ AND THE INSTRUMENT IS NOT WRAPPED IN A HANDLER, deliberately. If
-- public.cron_runs is absent the dormant path RAISES instead of returning 0.
-- That is LOUD, and loud is the property this phase exists to restore — an
-- instrument that swallows its own failure is the shape being removed, not a
-- safety net. The table has existed on PROD since 20260408113029 applied, and
-- the pg-lane gets it from fixture 33.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: the single-key fan-out
-- --------------------------------------------------------------------------
-- Re-based on supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql
-- (source migration 20260907130000). The four edits enumerated in the RE-BASE
-- DISCIPLINE section above and nothing else; every other line of the body is
-- that snapshot's, byte for byte.
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
  -- ---- the dormancy instrument's locals (164.7 WR-10) --------------------
  -- Three, because the dormant branch below has THREE causes and the single
  -- NOTICE it raises cannot tell two of them apart. v_found is the row count of
  -- the activation read and stays NULL until that read has actually completed;
  -- v_read_failed is set by the handler after it has nulled the flag; v_cause is
  -- the string the instrument row carries. The cause table is in this file's
  -- header, under WR-10.
  v_found       INTEGER := NULL;
  v_read_failed BOOLEAN := FALSE;
  v_cause       TEXT;
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
    -- The row count of the read that just ran. It is the ONLY thing separating
    -- "there is no such row" from "the row is there and says FALSE" — both leave
    -- the flag with a value that is not TRUE, and both raise the same NOTICE
    -- below. Unreachable when the read RAISED, which is why the handler records
    -- its own cause instead of relying on this.
    GET DIAGNOSTICS v_found = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_ledger_refresh_for_strategies: activation flag read failed (SQLSTATE %); treating as dormant', SQLSTATE;
    v_enabled := NULL;
    -- ⚠️ The note above says NOTHING BUT THE ASSIGNMENT goes in this handler.
    -- This IS an assignment — the second of them — and it is deliberately not a
    -- probe, a read or a write: lint rule R1-exception-handler-probe forbids DML
    -- and SELECT INTO here, and an INSERT in a handler is exactly the shape that
    -- rule exists to keep out of the gate corpus. The cause is RECORDED here and
    -- WRITTEN below, on the dormant path, where a write is legal.
    v_read_failed := TRUE;
  END;
  IF v_enabled IS DISTINCT FROM TRUE THEN
    RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: dormant (system_flags.ledger_refresh_enabled is not TRUE); enqueued 0';
    -- ---- the dormancy instrument (WR-10, APPGUC-WARNING-UNINSTRUMENTED-01) --
    -- ⛔ IT GOES AFTER THE NOTICE AND NEVER BETWEEN THE GUARD AND IT. Those two
    -- lines are ADJACENT inside one gate-arm `find` string in both ledger gates;
    -- a statement inserted between them makes that find match ZERO times, and
    -- the mutation runner reports occurrence-mismatch — the mutation not
    -- applied, so the arm not tested.
    --
    -- The healthy dormant cause — the row is present and says FALSE — writes
    -- NOTHING, deliberately. It is already legible from the flag row itself, and
    -- no purge of the heartbeat table exists (MEASURED at HEAD), so a row per
    -- function per tick would accrue for the whole pre-activation period to
    -- restate a fact one SELECT already gives. The two causes below are the ones
    -- that are INVISIBLE today: a read that RAISED, and a row that is absent or
    -- unreadable by this definer while the platform believes itself live.
    IF v_read_failed THEN
      v_cause := 'flag_read_failed';
    ELSIF v_found = 0 THEN
      v_cause := 'flag_row_invisible_or_absent';
    ELSE
      v_cause := NULL;
    END IF;
    IF v_cause IS NOT NULL THEN
      INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
      VALUES ('ledger_refresh_fanout', 'error', now(), v_cause,
              jsonb_build_object('function', 'enqueue_ledger_refresh_for_strategies', 'cause', v_cause));
    END IF;
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
  'docs/runbooks/ledger-refresh-go-live.md. Phase 164.8.6: a dormant tick whose '
  'cause is a MISSING or INVISIBLE activation row, or a read that RAISED, also '
  'writes one counted public.cron_runs row (cron_name ''ledger_refresh_fanout'', '
  'status ''error'') naming that cause in `error` and in `metadata`; the healthy '
  'FALSE row writes nothing.';

-- service_role is REVOKEd alongside PUBLIC, anon and authenticated. The
-- precedent is 20260515205431:111-116, the only migration in this repo that
-- already names service_role for exactly this reason. 20260907130000:470-471
-- revoked three of the four, and service_role's EXECUTE survived Phase 164.7
-- precisely because the check beside it probed only anon and authenticated —
-- a subset check is satisfied by every role it does not name.
--
-- NO GRANT follows. The scheduler runs as `postgres`, which is the function's
-- OWNER (all 14 rows of scripts/prod-prober/cron-manifest.json are `postgres`),
-- and an owner needs no grant.
--
-- ⚠️ ASSUMPTION, stated rather than assumed away: no out-of-repo caller invokes
-- either fan-out as service_role. MEASURED at HEAD — a repo-wide grep for both
-- names finds only the migrations, the committed snapshots, the gates, the
-- dumper, the linters and the prober fixtures; there is no rpc(...) call site in
-- src/, analytics-service/ or scripts/. An Edge Function or a dashboard SQL
-- snippet calling one as service_role is outside what a grep of this repository
-- can see, and would begin failing on 42501 at this merge.
REVOKE ALL ON FUNCTION public.enqueue_ledger_refresh_for_strategies()
  FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 2: the composite arm
-- --------------------------------------------------------------------------
-- Re-based on supabase/schema/functions/enqueue_ledger_composite_refresh.sql
-- (source migration 20260907130000), with the SAME four edits. It reads the SAME
-- key, so one reset still kills BOTH arms on the next tick — and it now names
-- ITSELF in the instrument row's metadata, which is what lets one query tell the
-- two arms' dormancy apart.
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
  -- ---- the dormancy instrument's locals (164.7 WR-10) --------------------
  -- Three, because the dormant branch below has THREE causes and the single
  -- NOTICE it raises cannot tell two of them apart. v_found is the row count of
  -- the activation read and stays NULL until that read has actually completed;
  -- v_read_failed is set by the handler after it has nulled the flag; v_cause is
  -- the string the instrument row carries. The cause table is in this file's
  -- header, under WR-10.
  v_found       INTEGER := NULL;
  v_read_failed BOOLEAN := FALSE;
  v_cause       TEXT;
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
    -- The row count of the read that just ran. It is the ONLY thing separating
    -- "there is no such row" from "the row is there and says FALSE" — both leave
    -- the flag with a value that is not TRUE, and both raise the same NOTICE
    -- below. Unreachable when the read RAISED, which is why the handler records
    -- its own cause instead of relying on this.
    GET DIAGNOSTICS v_found = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_ledger_composite_refresh: activation flag read failed (SQLSTATE %); treating as dormant', SQLSTATE;
    v_enabled := NULL;
    -- ⚠️ The note above says NOTHING BUT THE ASSIGNMENT goes in this handler.
    -- This IS an assignment — the second of them — and it is deliberately not a
    -- probe, a read or a write: lint rule R1-exception-handler-probe forbids DML
    -- and SELECT INTO here, and an INSERT in a handler is exactly the shape that
    -- rule exists to keep out of the gate corpus. The cause is RECORDED here and
    -- WRITTEN below, on the dormant path, where a write is legal.
    v_read_failed := TRUE;
  END;
  IF v_enabled IS DISTINCT FROM TRUE THEN
    RAISE NOTICE 'enqueue_ledger_composite_refresh: dormant (system_flags.ledger_refresh_enabled is not TRUE); enqueued 0';
    -- ---- the dormancy instrument (WR-10, APPGUC-WARNING-UNINSTRUMENTED-01) --
    -- ⛔ IT GOES AFTER THE NOTICE AND NEVER BETWEEN THE GUARD AND IT. Those two
    -- lines are ADJACENT inside one gate-arm `find` string in both ledger gates;
    -- a statement inserted between them makes that find match ZERO times, and
    -- the mutation runner reports occurrence-mismatch — the mutation not
    -- applied, so the arm not tested.
    --
    -- The healthy dormant cause — the row is present and says FALSE — writes
    -- NOTHING, deliberately. It is already legible from the flag row itself, and
    -- no purge of the heartbeat table exists (MEASURED at HEAD), so a row per
    -- function per tick would accrue for the whole pre-activation period to
    -- restate a fact one SELECT already gives. The two causes below are the ones
    -- that are INVISIBLE today: a read that RAISED, and a row that is absent or
    -- unreadable by this definer while the platform believes itself live.
    IF v_read_failed THEN
      v_cause := 'flag_read_failed';
    ELSIF v_found = 0 THEN
      v_cause := 'flag_row_invisible_or_absent';
    ELSE
      v_cause := NULL;
    END IF;
    IF v_cause IS NOT NULL THEN
      INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
      VALUES ('ledger_refresh_fanout', 'error', now(), v_cause,
              jsonb_build_object('function', 'enqueue_ledger_composite_refresh', 'cause', v_cause));
    END IF;
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
  'docs/runbooks/ledger-refresh-go-live.md. Phase 164.8.6: a dormant tick whose '
  'cause is a MISSING or INVISIBLE activation row, or a read that RAISED, also '
  'writes one counted public.cron_runs row (cron_name ''ledger_refresh_fanout'', '
  'status ''error'') naming that cause in `error` and, with this function''s own '
  'name, in `metadata`; the healthy FALSE row writes nothing.';

-- The same widening, for the same reason, on the same evidence. See STEP 1.
REVOKE ALL ON FUNCTION public.enqueue_ledger_composite_refresh()
  FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip.
--
-- ⛔ THIS BLOCK MUST NEVER CALL EITHER FUNCTION. A smoke-test invocation at apply
-- time would enqueue real jobs on PROD the moment this migration merges — which
-- is precisely the "merging changes no production behaviour" property the whole
-- design exists to hold. Assert the SHAPE, never the behaviour; behaviour is
-- covered by the pg-lane tracer and by supabase/tests/test_ledger_refresh_*.sql.
--
-- ⛔ CATALOGUE READS ONLY — NEVER A ROW COUNT (criterion 7,
-- [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). Shared TEST carries PROD's CATALOGUE
-- and EMPTY tables. A DO block that reads DATA and RAISEs on an unexpected count
-- applies cleanly to PROD and REFUSES on TEST — and because a failed TEST apply
-- BLOCKS the PROD apply, that refusal blocks a production deploy. Two specific
-- reads are therefore NOT re-run here, by name:
--   * 20260907130000:926-933, the activation-row read (`v_seeded`). It is the
--     NAMED SPECIMEN of that escape class in TODOS.md. This file does not seed
--     the row, does not read it, and asserts the guard that reads it by NEEDLE
--     over the catalogue instead.
--   * any count over public.cron_runs. The instrument is asserted by the
--     presence of its INSERT in the body text, never by a row that a tick may or
--     may not have written yet. The row-level proof belongs to the gates, which
--     read rows their OWN transaction wrote.
-- The interim remedy for such a refusal is to REVERT THE MERGE; ⛔ never to edit
-- supabase-migrate.yml.
--
-- ⛔ AND IT MUST NEVER NAME public.cron_runs OR public.system_flags AS OBJECTS.
-- Every reference to them in this file lives INSIDE the plpgsql bodies above,
-- where it is resolved at CALL time — which is what lets this migration apply on
-- a cluster that has neither, and therefore appear in a gate's apply list at
-- all. The ONLY relations this block reads are pg_proc, pg_namespace and
-- pg_roles, plus the functions pg_get_functiondef, aclexplode, acldefault and
-- pg_get_userbyid.
DO $verify$
DECLARE
  -- ⛔ Every variable is DECLAREd up front: plpgsql compiles a DO block WHOLE,
  --    so a missing DECLARE raises 42601 and NONE of the checks below run — it
  --    does not weaken one check, it stops all of them. MEASURED on this repo
  --    2026-08-25, when the first revision of 20260825130000's check 5 omitted
  --    two DECLAREs and could not apply at all. Since migrations AUTO-APPLY to
  --    PROD on merge, that lands on production.
  v_fn                TEXT;
  v_nargs             SMALLINT;
  v_secdef            BOOLEAN;
  v_config            TEXT[];
  v_owner             TEXT;
  v_bypass            BOOLEAN;
  v_super             BOOLEAN;
  v_acl_owner         TEXT;
  v_grantees          TEXT;
  v_def_raw           TEXT;
  v_def               TEXT;
  -- THE FOUR NEEDLES, each BOUND TO A STATEMENT SHAPE and held in a variable so
  -- the loop states each one once and names it in its own failure message
  -- (the idiom at 20260907130000:765-775).
  --
  -- (1) the activation read. ⛔ ASSEMBLED BY CONCATENATION: written whole it
  --     would be a THIRD raw occurrence of the very statement shape it asserts
  --     occurs exactly once per body, and this file is read raw by the mutation
  --     runner's occurrence counter and by the repo-wide reader lint.
  v_flag_needle       TEXT := 'FROM public.' || 'system_flags';
  -- (2) the NULL-safe comparison. ⚠️ BOUND TO THE GUARDED VARIABLE, not
  --     floating: the bare operator would be satisfied by a null-safe comparison
  --     of any other variable in any other statement while the activation guard
  --     itself had been rewritten to the NULL-unsafe form. Written WHOLE, and
  --     that is safe by measurement — the two gates' A and K twins are designed
  --     to PRESERVE this token when they mutate the guard line, precisely so the
  --     apply survives and the arm, not the migration, is the first failure.
  v_null_needle       TEXT := 'v_enabled IS DISTINCT FROM TRUE';
  -- (3) the dormancy instrument. ⛔ CONCATENATED for the same reason as (1). It
  --     asserts the WRITE, not the cause literal: the cause literals are what
  --     plan 03's instrument twins mutate, so a needle on one of them would
  --     abort the apply and the gate would never run.
  v_instrument_needle TEXT := 'INSERT INTO public.' || 'cron_runs';
  -- (4) the retired app-namespace database-setting call, asserted ABSENT.
  --     ⛔ ASSEMBLED BY CONCATENATION, DELIBERATELY, and do NOT "tidy" it into
  --     one literal. Written whole, the needle would itself be an occurrence of
  --     that call's spelling inside a file that scripts/lint-app-guc.mjs scans
  --     RAW, comments and string literals included — the assertion would then be
  --     the very hit it exists to forbid, and a NEW file cannot be allowlisted.
  --     Copied verbatim from 20260907130000:783.
  v_guc_needle        TEXT := 'current_' || 'setting(''app.' || 'ledger_refresh_enabled''';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'enqueue_ledger_refresh_for_strategies',
    'enqueue_ledger_composite_refresh'
  ]
  LOOP
    -- 1. the function landed, and it takes ZERO arguments. A caller-supplied
    --    threshold on a cross-tenant SECURITY DEFINER function IS the attack
    --    surface (T-161.1-06/-15).
    SELECT p.pronargs, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
      INTO v_nargs, v_secdef, v_config, v_def_raw
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = v_fn;

    IF v_nargs IS NULL THEN
      RAISE EXCEPTION 'Migration 20260911130000: public.% is missing after its own CREATE OR REPLACE — the re-base did not land', v_fn;
    END IF;
    IF v_nargs <> 0 THEN
      RAISE EXCEPTION 'Migration 20260911130000: public.% takes % argument(s), expected 0 — a caller-supplied threshold on a cross-tenant SECURITY DEFINER function IS the attack surface', v_fn, v_nargs;
    END IF;

    -- 2. SECURITY DEFINER with a pinned search_path, both preserved by the
    --    re-base. These live in the CREATE FUNCTION declaration, OUTSIDE the
    --    dollar-quoted body, which is exactly the region a body-only copy loses.
    IF v_secdef IS NOT TRUE THEN
      RAISE EXCEPTION 'Migration 20260911130000: public.% is not SECURITY DEFINER — the re-base dropped it, and the activation read then runs as the CALLER against an RLS-enabled table that admits no such role', v_fn;
    END IF;
    IF v_config IS NULL OR NOT EXISTS (
      SELECT 1 FROM unnest(v_config) AS c WHERE c LIKE 'search_path=%'
    ) THEN
      RAISE EXCEPTION 'Migration 20260911130000: public.% does not pin search_path (proconfig=%) — the re-base dropped it, and on a SECURITY DEFINER function that is a privilege-escalation route', v_fn, v_config;
    END IF;

    -- 3. …and the DEFINER role can actually SEE what it reads (161.1-AUDIT F-2).
    --    The predicate is `rolsuper OR rolbypassrls`, NEVER rolbypassrls alone:
    --    pg_roles.rolbypassrls reports only the EXPLICITLY granted attribute
    --    while a SUPERUSER bypasses RLS implicitly with the flag still FALSE, so
    --    the narrow predicate is a FALSE NEGATIVE that aborts a correct apply —
    --    on the auto-apply-to-PROD route, mid-file, with no rollback step.
    --
    --    ⚠️ This check now guards THREE reads, not two. The cohort view, the
    --    RLS-enabled activation table, and — new in this file — the RLS-enabled
    --    heartbeat table the dormancy instrument WRITES. Lose the exemption and
    --    the first two degrade CLOSED and silent, which is the wedge this phase
    --    removes; the third degrades LOUD, which is the point of adding it.
    SELECT r.rolname, r.rolbypassrls, r.rolsuper
      INTO v_owner, v_bypass, v_super
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_roles r ON r.oid = p.proowner
     WHERE n.nspname = 'public'
       AND p.proname = v_fn;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'Migration 20260911130000: could not resolve the owner of public.% — pg_proc.proowner has no matching pg_roles row', v_fn;
    END IF;
    IF NOT (COALESCE(v_bypass, FALSE) OR COALESCE(v_super, FALSE)) THEN
      RAISE EXCEPTION 'Migration 20260911130000: public.% is owned by role "%" (rolsuper=%, rolbypassrls=%), which is exempt from row security by neither route. As SECURITY DEFINER it reads the cohort view AND the RLS-enabled activation table as that role, so the cohort collapses to empty and the flag reads NULL — both fail CLOSED, silently, which is byte-identical to "nothing was stale"', v_fn, v_owner, v_super, v_bypass;
    END IF;

    -- 4. THE BODY ITSELF, asserted on the EXECUTABLE text.
    --
    -- ⚠️ pg_get_functiondef returns the body WITH its comments, so a position()
    -- test over the raw definition is a test a COMMENT can satisfy. Comments are
    -- stripped first and every assertion below runs on what is left. Lint rule
    -- R2-functiondef-comment-strip mandates this idiom BY RULE for any regex or
    -- LIKE over a pg_get_functiondef result.
    --
    -- ⚠️ RESIDUAL, RECORDED not closed, carried over from 20260907130000:880-886:
    -- this idiom does not strip `/* … */`. A block comment quoting a needle would
    -- satisfy checks 5-7 with the code gone. MEASURED on both bodies in this
    -- file: 0 occurrences of a block-comment opener.
    --
    -- ⚠️ AND THE TWO DIRECTIONS ARE NOT THE SAME, which is why they are stated
    -- separately. For the PRESENCE checks 5, 6 and 7 a `--` inside a string
    -- literal makes the strip eat real code, which can only cause a FALSE
    -- FAILURE — loud, and safe. For the ABSENCE check 8 the same accident is a
    -- FALSE PASS: the strip could swallow the very call the check forbids.
    -- MEASURED on both bodies: 0 code lines carry a trailing `--`.
    v_def := regexp_replace(v_def_raw, '--[^\n]*', '', 'g');

    IF v_def IS NULL OR length(v_def) < 500 THEN
      RAISE EXCEPTION 'Migration 20260911130000: the comment-stripped definition of public.% is % character(s) — the strip is broken, so checks 5-8 below would pass over nothing', v_fn, COALESCE(length(v_def), 0);
    END IF;

    -- 5. the guard READS THE ACTIVATION TABLE.
    IF position(v_flag_needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 20260911130000: public.% does not read the activation flag from the settings table (looked for "%") — the fail-closed switch is gone and this function would fan out unconditionally', v_fn, v_flag_needle;
    END IF;

    -- 6. and compares it NULL-SAFELY. `<> TRUE` and `NOT v_enabled` both
    --    evaluate NULL when the read failed or the row is absent, so the IF is
    --    not taken and the body falls THROUGH — they open the flag on exactly
    --    the failure path the guard exists for.
    IF position(v_null_needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 20260911130000: public.% does not compare the activation flag with the NULL-safe form "%" — a NULL-unsafe comparison opens the flag on the read-failure and missing-row paths, which are the two paths this guard exists for', v_fn, v_null_needle;
    END IF;

    -- 7. and a dormant tick whose cause is INVISIBLE leaves a counted trace
    --    (WR-10; APPGUC-WARNING-UNINSTRUMENTED-01). Deleting the instrument
    --    removes this needle's only occurrence in the body.
    IF position(v_instrument_needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 20260911130000: public.% no longer writes the dormancy instrument row (looked for "%"). Two of the three dormant causes — a read that RAISED and a flag row that is absent or invisible to the definer — would again reach no counted row, and the second of those is a live platform reporting itself dormant with nothing to read', v_fn, v_instrument_needle;
    END IF;

    -- 8. and the retired app-namespace database-setting call is GONE from the
    --    executable text. See the DECLARE for why this needle is concatenated.
    IF position(v_guc_needle IN v_def) <> 0 THEN
      RAISE EXCEPTION 'Migration 20260911130000: public.% still reads the retired app-namespace database setting. An operator on this platform is refused 42501 when setting it (MEASURED on PROD 2026-09-05), so that read can never be TRUE and the function is permanently dormant for the wrong reason', v_fn;
    END IF;

    -- 9. THE WHOLE EXECUTE GRANTEE SET IS EXACTLY THE OWNER (criterion 4).
    --
    -- ⭐ THE SET, not a subset. 20260907130000's check 3 probed anon and
    --    authenticated with has_function_privilege and PASSED while service_role
    --    still held EXECUTE — a subset check is satisfied by every role it does
    --    not name, which is how 164.7-WR02 survived a green migration.
    --    aclexplode over proacl ENUMERATES the grantees instead of interrogating
    --    a guessed list, so a grantee nobody thought of is a FAILURE rather than
    --    a silence.
    --
    -- ⚠️ COMPARED TO THE OWNER'S NAME, NEVER TO THE LITERAL 'postgres'. The
    --    pg-lane boots as whatever role scripts/pg-lane/run.sh created, and a
    --    literal would make this check pass or fail for a reason unrelated to
    --    the file.
    --
    -- ⚠️ COALESCE(proacl, acldefault(…)) is what makes a NULL acl explicit: a
    --    function whose privileges were never touched carries NULL proacl, whose
    --    MEANING is the default ACL — and the default ACL for a function grants
    --    EXECUTE to PUBLIC. Reading NULL as "no grantees" would report the widest
    --    possible state as the tightest (20260515205431:86-90).
    --
    -- ⚠️ grantee = 0 is the PUBLIC pseudo-grantee and is mapped to the string
    --    here: pg_get_userbyid(0) is not a role name.
    --
    -- ⚠️ WHERE THIS CHECK IS LOAD-BEARING, AND WHERE IT IS NOT — measured, not
    --    assumed, because "the check passed" is the exact claim this phase exists
    --    to stop trusting.
    --
    --    ON PROD IT IS LIVE. service_role holds EXECUTE on both fan-outs TODAY
    --    (164.7-WR02: 20260907130000:470-471,735-736 revoked three of the four
    --    roles and the check beside them probed only two). Remove the REVOKEs
    --    above and this check reports [service_role,<owner>] and RAISES on the
    --    PROD apply.
    --
    --    ON THE FAN-OUT LANES IT IS NOT FALSIFIABLE BY DELETING THIS FILE'S
    --    REVOKEs, and saying so is the point. scripts/pg-lane/run.sh:406 creates
    --    anon, authenticated and service_role on every lane, so both REVOKEs
    --    parse anywhere — but nothing GRANTS them anything:
    --    scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql,
    --    which lays down the project-bootstrap `GRANT ALL ON FUNCTIONS` defaults
    --    and is what makes a `REVOKE … FROM anon` bite, is in the TICK gate's
    --    apply list and in NEITHER fan-out list (fanout:194, composite:206). And
    --    20260907130000's own earlier REVOKE has already materialised proacl as
    --    the owner alone, so this file's REVOKEs are no-ops THERE. What proves
    --    this check bites on those lanes is plan 03's `sql`-step arm, which
    --    GRANTs EXECUTE to service_role on the live lane AFTER the apply and
    --    watches the gate redden — the shape arm I of both gates already uses
    --    for exactly this reason.
    SELECT g.owner_name, string_agg(g.grantee_name, ',' ORDER BY g.grantee_name)
      INTO v_acl_owner, v_grantees
      FROM (
        SELECT pg_get_userbyid(p.proowner) AS owner_name,
               CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee_name
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
         WHERE n.nspname = 'public'
           AND p.proname = v_fn
           AND p.pronargs = 0
           AND a.privilege_type = 'EXECUTE'
      ) g
     GROUP BY g.owner_name;
    IF v_grantees IS NULL THEN
      RAISE EXCEPTION 'Migration 20260911130000: could not read the EXECUTE grantee set of public.% — the function is missing, or it carries no EXECUTE aclitem at all, and an empty answer here is indistinguishable from a locked-down one unless it is refused', v_fn;
    END IF;
    IF v_grantees IS DISTINCT FROM v_acl_owner THEN
      RAISE EXCEPTION 'Migration 20260911130000: EXECUTE on public.% is held by [%], expected exactly the owner [%]. service_role''s grant survived Phase 164.7 precisely because only anon and authenticated were probed; a cross-tenant SECURITY DEFINER function that enqueues work for every tenant must be callable by the scheduler alone, and the scheduler IS the owner', v_fn, v_grantees, v_acl_owner;
    END IF;
  END LOOP;

  RAISE NOTICE 'Migration 20260911130000: both ledger fan-outs re-based — EXECUTE held by the owner alone, and a dormant tick with an invisible cause now writes one counted row naming it. NOTHING scheduled, NOTHING activated';
END $verify$;

COMMIT;
