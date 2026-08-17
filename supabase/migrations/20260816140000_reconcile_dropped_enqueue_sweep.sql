-- Migration: reconciliation sweep for dropped compute-job enqueues
-- (JOB-04, Phase 143, v1.19, 2026-08-16)
-- =============================================================================
--
-- Why this migration exists
-- -------------------------
-- A CSV strategy can be left with persisted daily-returns rows, ZERO
-- compute_jobs rows of any kind or status, and NO strategy_analytics row at all
-- -- forever. POST /api/strategies/csv-finalize runs finalize_csv_strategy and
-- persist_csv_daily_returns SYNCHRONOUSLY in the request and commits them, then
-- schedules the compute_analytics_from_csv enqueue via after() at
-- src/app/api/strategies/csv-finalize/route.ts line 813. If the serverless
-- instance is torn down before that callback runs, the enqueue never happens.
--
-- The condition is ARCHITECTURALLY INVISIBLE from inside that route: the
-- enqueue-error branch's captureToSentry (:833-837), the catch branch's
-- (:846-850) and the writeFailedStrategyAnalyticsPlaceholder call (:858-863)
-- all live LEXICALLY INSIDE the closure that never ran. No in-request guard can
-- observe its own non-execution. The only way to see this state is to look for
-- it from OUTSIDE the request, BY ABSENCE, on a schedule. That is this file.
--
-- Phase 142's reaper (20260802120000) does NOT cover it. That reaper
-- terminalizes rows stranded at computation_status='computing'; here there is
-- no strategy_analytics row at all, so there is nothing for it to terminalize.
-- Its header said so explicitly: "Re-enqueue is JOB-04, Phase 143."
--
-- WHERE THE VALUE LANDS (do not overclaim). The healed strategy gets a pending
-- compute_analytics_from_csv job, the worker computes analytics, and the
-- strategy renders on the PAGE-REFRESH / RETURN-LATER path and on the factsheet
-- surface. It is NOT a live-wizard rescue: SyncPreviewStep.tsx sets
-- RETRY_THRESHOLD_MS = 900_000, so an open wizard session already self-escalates
-- a frozen status after 15 minutes -- long before this sweep's grace window
-- elapses, let alone its cadence. Nothing in this file should be read as
-- claiming it shortens a spinner.
--
-- CADENCE HONESTY. The '35 * * * *' schedule is POST-THRESHOLD DETECTION
-- LATENCY: an orphaned strategy is healed within ~1 hour of CROSSING the grace
-- window, so the worst case end-to-end is ~= grace + 1 h (about 2 hours), plus
-- the worker's own claim-and-compute time. The cadence does NOT bound
-- user-visible wait and this file makes no such claim.
--
-- Minute 35 is deliberate, not arbitrary. Registered slots across all migrations
-- are :00, :10, :15, :20 and :30, and 142's reaper runs '*/15 * * * *' (so it
-- occupies :00/:15/:30/:45 of every hour). '0 * * * *' would coincide with the
-- reaper every single hour and with audit_log_hot_to_cold at '0 3 * * *'. Minute
-- 35 is clear of every registered slot and off the quarter-hour grid, which
-- keeps the pg_cron slot uncontended and the run log readable. The two
-- mechanisms are non-racing by construction anyway (see SAFETY vs DEBOUNCE), so
-- this is legibility and slot hygiene, not a correctness fix.
--
-- Threshold rationale
-- -------------------
-- GRACE WINDOW = 1 hour, derived rather than guessed.
--
-- The legitimate gap this must clear is exactly one thing: route-commit ->
-- after() enqueue-commit. In the happy path that is SUB-SECOND, and it is
-- bounded above by the serverless request lifetime. One hour is roughly three
-- orders of magnitude over the legitimate gap and comfortably absorbs
-- worker-host vs Postgres clock skew, which is NTP-bounded at the seconds scale.
--
-- It is explicitly NOT the 16-hour figure from 20260802120000. That number
-- bounds how long a strategy_analytics row may legitimately sit 'computing'
-- WITH A CHAIN IN FLIGHT, derived over the worst simple path through
-- JOB_CHAIN_FOLLOW_ON. This predicate requires ZERO compute_jobs rows, so no
-- chain can be in flight by construction; importing 16 h here would delay every
-- heal by 15 hours for no safety gain. It is also NOT the 4-hour
-- orphaned-running window from 20260720120000: that bounds how long ONE CLAIMED
-- JOB may sit 'running', a different mechanism on a different table.
--
-- A bare number with no derivation is what Phase 106's janitor was REVERTED
-- for. This paragraph is the derivation.
--
-- SAFETY vs DEBOUNCE. ⚠️ READ THIS BEFORE EDITING THE PREDICATE. The safety is
-- carried by the TERMINAL-strategy_analytics CONJUNCT, not by the interval and
-- not by the zero-jobs conjunct. The reason is retention:
-- retention_compute_jobs_done DELETEs 'done' rows at 30 days (current deployed
-- body 20260515113853:192-200 -- NOT the stale header table at
-- 20260417110539:88) and retention_compute_jobs_failed DELETEs failed rows at 90
-- days (20260515210200:250-259). Nothing sweeps stale 'pending' at all (JOB-08).
-- Therefore EVERY perfectly healthy 31-day-old strategy matches "dailies
-- present AND zero compute_jobs rows". The terminal-analytics conjunct is the
-- ONLY thing that keeps this sweep from re-enqueueing the entire historical
-- corpus on its first tick.
--
-- This is measured, not argued. See CENSUS below: on PROD, 4 of the 4
-- strategies that carry dailies with zero compute_jobs rows are excluded SOLELY
-- by that conjunct. Deleting or weakening it converts a 0-row first tick into a
-- 4-row mass re-enqueue TODAY, and the number grows monotonically as the corpus
-- ages past 30 days. Any future edit that weakens, reorders or kind-scopes it
-- re-opens a mass-re-enqueue incident. STEP 2's gate and the Plan-03 SQL gate
-- both fail with a message that names this incident rather than the missing
-- token.
--
-- The four excluded statuses are ENUMERATED ('computing', 'complete',
-- 'complete_with_warnings', 'failed') rather than expressed as "not 'pending'".
-- That is deliberate: the full vocabulary is exactly five values
-- (20260602120000:46), and enumerating the excluded four means a future SIXTH
-- CHECK value defaults to EXCLUDED -- the safe direction. A "not pending"
-- formulation would default a new status to INCLUDED, i.e. to being re-enqueued.
--
-- 'computing' is in the excluded list for a second, independent reason: it is
-- 142's reaper's row. The split by computation_status is what keeps the two
-- mechanisms from racing the same row -- absent/'pending' belong to this sweep,
-- 'computing' belongs to the reaper, and the three terminal values belong to
-- nobody. If the reaper terminalizes a stranded row to 'failed' at :00, this
-- sweep sees a terminal row at :35 and correctly skips it. The two compose in
-- the right direction.
--
-- CLOCK SKEW. The grace anchor is csv_daily_returns.created_at, which is
-- DB-side (NOT NULL DEFAULT now(), 20260522111839:40) -- it is stamped by the
-- same Postgres clock this cron body compares against, so for the common path
-- there is no skew at all. Where a writer supplies the column explicitly the
-- skew is worker-host vs Postgres, NTP-bounded at seconds, and dwarfed by an
-- hour-scale grace window. It cannot pull a healthy row into scope.
--
-- Grace anchor rationale (the Phase 106 lesson)
-- ---------------------------------------------
-- The anchor is the per-candidate MAX(csv_daily_returns.created_at). Phase 106's
-- janitor was REVERTED for keying on the wrong timestamp column, so each
-- alternative is named here with HOW it is wrong, not merely that it is:
--
--   * csv_daily_returns.updated_at -- REJECTED. persist_csv_daily_returns
--     upserts and derive_broker_dailies re-upserts a reconcile span
--     (job_worker.py:4720,4742), so this column ADVANCES on every refresh. A
--     writer that re-stamps the key is the Phase 106 shape reproduced in a new
--     column: a strategy whose dailies are periodically refreshed would never
--     become eligible, and the hole would stay open precisely for the
--     longest-lived strategies.
--
--   * strategies.created_at -- REJECTED, and wrong in the DANGEROUS direction.
--     It bears no relation to when the dailies landed. A strategy created a year
--     ago whose CSV was uploaded ten minutes ago is instantly past grace, so the
--     sweep would RACE the live after() enqueue it exists to backstop and insert
--     a duplicate job attempt in the normal path.
--
--   * strategy_analytics.computed_at -- REJECTED. This is the literal Phase 106
--     revert cause: the SQL status bridge re-stamps it on every job transition,
--     and the Python runner's entry upsert omits it so a merge-duplicates write
--     leaves the PRIOR run's value. Wrong in BOTH directions. It is also ABSENT
--     by construction in this sweep's main arm, where no strategy_analytics row
--     exists at all.
--
--   * compute_jobs.created_at -- IMPOSSIBLE. The predicate requires zero
--     compute_jobs rows, so there is no row to read a timestamp from.
--
-- csv_daily_returns.created_at is the surviving candidate on the merits, not by
-- elimination: it is stamped exactly when the dailies landed, which is precisely
-- the event after which an enqueue should have followed; it is NOT NULL DEFAULT
-- now() so it always exists; no writer re-stamps it (the persist and derive
-- upserts touch updated_at); and it is DIRECTLY INSERT-WRITABLE, which is what
-- lets a test backdate a seed instead of sleeping.
--
-- ⚠️ NO NEW INDEX IS ADDED for it. csv_daily_returns has no index on created_at
-- and will not get one here: that table's own DDL records a redundant secondary
-- index being DROPPED in PR #272 because it "would double write I/O for zero
-- planner benefit" (20260522111839:31-34). Instead the query DRIVES FROM
-- strategies with the cheap, index-served EXISTS / NOT EXISTS conjuncts first
-- and evaluates the correlated MAX grace conjunct LAST, on survivors only. At
-- the measured scale below (PROD: 8 strategies carry dailies at all) this is a
-- handful of PK-prefix scans per tick.
--
-- ORDER BY the same anchor ASC is load-bearing for the LIMIT, not decoration:
-- it makes the bounded batch DETERMINISTIC (oldest-orphaned first), which both
-- guarantees forward progress across ticks and lets a gate seed a century-old
-- candidate and know it wins the budget on a shared project.
--
-- CENSUS AT AUTHORING TIME (read-only, 2026-08-16, via service-role PostgREST)
-- ---------------------------------------------------------------------------
-- Full method, evidence and anti-vacuity decomposition:
-- .planning/phases/143-job-dropped-enqueue-reconciliation-sweep/143-CENSUS.md
-- The Supabase MCP was not available in the authoring session, so this is the
-- PostgREST substitution 142-04 established, recorded here rather than implied.
--
--   TEST (qmnijlgmdhviwzwfyzlc): 0 candidates.
--     8,091 strategies / 8,073 strategy_analytics rows. Exactly 1 strategy
--     carries csv_daily_returns rows; it has zero compute_jobs rows and is
--     excluded SOLELY by the terminal-analytics conjunct.
--   PROD (khslejtfbuezsmvmtsdn): 0 candidates.
--     46 strategies / 42 strategy_analytics rows. 8 strategies carry dailies; 4
--     of those have zero compute_jobs rows; ALL 4 are excluded SOLELY by the
--     terminal-analytics conjunct. That is the mass-re-enqueue exposure,
--     measured on the live corpus.
--   Composite exposure among candidates: 0 on both. PROD does carry 1 composite
--     with dailies -- currently protected by a terminal analytics row, i.e. one
--     failed terminal write away from being the false positive the strategy_keys
--     conjunct exists to stop. That conjunct guards a real row.
--   strategies.status among the dailies-bearing population: 'pending_review' and
--     'private' only. ZERO 'archived' and ZERO 'draft' rows anywhere in it.
--
-- ⚠️ The first tick after merge therefore enqueues ZERO jobs on PROD. That is
-- the safe outcome, but it also means the merge produces NO positive evidence
-- that the mechanism works. Proof of function comes from the offline arm harness
-- (143-02), the CI SQL gate (143-03) and the live TEST tick (143-04) -- never
-- from PROD quietness. Re-run the census before merge; the numbers above are a
-- snapshot, not a guarantee.
--
-- ⚠️ TEST-SPECIFIC NOTE. TEST has no worker, so a job this sweep inserts there
-- is never drained, and nothing sweeps stale 'pending' (JOB-08). The
-- contribution is bounded by construction -- a compute_jobs row of ANY status
-- excludes the strategy from the predicate forever after, so the ceiling is ONE
-- row per candidate ever -- and is measurably zero today.
--
-- Scope discipline
-- ----------------
-- This migration registers ONE cron job and does NOTHING else. No DDL, no
-- column, no index, no constraint, no function, no view, no trigger, no policy,
-- no GRANT and no REVOKE. It does NOT touch: compute_jobs DDL or RLS, the claim
-- RPC, mark_compute_job_done / mark_compute_job_failed, enqueue_compute_job, the
-- computation_status CHECK, the retention crons, retention_compute_jobs_orphaned_running
-- (Phase 144 owns that), or 142's reaper.
--
-- It creates NO new callable SQL surface -- the sweep is an INLINE cron body,
-- not a function, so there is no SECURITY DEFINER surface, no EXECUTE grant, and
-- no caller-suppliable grace interval. That is deliberate: a caller-supplied
-- INTERVAL on a cross-tenant SECDEF job is the 20260516170100 incident class
-- (any caller passes interval '1 second' and the mechanism fires on every
-- tenant's healthy rows). The parameter IS the attack surface.
--
-- ⚠️ THE BODY MUST NOT CALL enqueue_compute_job, and STEP 2 asserts it does not.
-- That RPC delegates to _enqueue_compute_job_internal, whose race-loss arm
-- RAISEs serialization_failure (20260716090000:162-171) -- the 10-param overload
-- raises NO_DATA_FOUND on the same race. A RAISE from inside a pg_cron body
-- ABORTS THE WHOLE TICK: the healed count is lost, the RAISE NOTICE never runs,
-- and every remaining candidate in the batch is skipped. This sweep runs
-- concurrently with the live enqueue path it backstops, so that race is a real
-- outcome, not a theoretical one. A direct INSERT with ON CONFLICT DO NOTHING
-- has no such arm.
--
-- TWO KNOWN NON-COVERAGES, both deliberate. Neither is a bug and neither may be
-- papered over by success-criteria prose. Both are filed to .planning/TODOS.md.
--
--   (1) THE WIZARD FIRST-HOP DROP. A finalize-wizard strategy whose sync_trades
--       enqueue dropped has NO DAILIES AT ALL, and "no dailies AND no jobs" is
--       byte-identical to a brand-new strategy that has not synced yet and to a
--       key whose first sync legitimately returned nothing. No predicate catches
--       the drop without also catching those. Closing it needs a different
--       signal with its own false-positive profile -- a separate mechanism, not
--       a second predicate bolted in here.
--
--   (2) COMPOSITES ARE EXCLUDED, and the exclusion is a MONEY-SAFETY measure,
--       not an optimization. run_stitch_composite_job writes csv_daily_returns
--       itself (job_worker.py:6786-6803) and JOB_CHAIN_FOLLOW_ON["stitch_composite"]
--       is the empty tuple (job_worker.py:527), so a composite is chain-terminal
--       and legitimately NEVER gets a compute_analytics_from_csv job. Enqueueing
--       one would hand the composite headline to the SINGLE-KEY computation its
--       own handler deliberately abandoned -- a sqrt(252)-vs-sqrt(365)
--       annualization divergence plus a 0.0 gap-fill that "fabricated flat
--       performance" (job_worker.py:6808-6822). That is silent corruption of a
--       CORRECT row on a money surface, strictly worse than the un-healed hole
--       this file exists to close. A composite needs stitch_composite re-run,
--       which is a different mechanism with a different predicate.
--
--       The discriminator is EXISTENCE OF A public.strategy_keys MEMBER ROW. It
--       is pinned at both ends: the finalize-wizard route enqueues
--       stitch_composite for any strategy with >= 1 strategy_keys member
--       (route.ts:1363-1372), and run_stitch_composite_job loads its members
--       from strategy_keys and FAILS on zero members (job_worker.py:5472-5485),
--       so composite and single-key are mutually exclusive by construction.
--       ⛔ strategies.api_key_id IS NULL is NOT a valid discriminator -- CSV
--       single-key strategies also have it NULL, so it would over-exclude the
--       exact population this sweep exists to heal. The chosen conjunct errs
--       SAFE: a mis-tagged row is left un-healed, which is visible and
--       recoverable, never money-corrupted.
--
-- STATUS GATE. 'archived' is excluded; every other status -- including 'draft'
-- -- is INCLUDED, and the absence of a broader gate is a decision, not an
-- oversight. Excluding 'archived' is hygiene: re-enqueueing analytics for an
-- archived strategy wastes a worker slot and corrupts nothing. Excluding 'draft'
-- was REJECTED because a drop victim may sit at a pre-terminal status PRECISELY
-- BECAUSE nothing advanced it -- a draft filter could excise the exact
-- population being healed. ⚠️ Honest limitation: the census could not adjudicate
-- this, because the candidate population is empty and its status breakdown is
-- therefore vacuous. What the census DOES show is that the dailies-bearing
-- population contains zero 'archived' and zero 'draft' rows on either project,
-- so both halves of this decision are free today. The 'draft' inclusion rests on
-- the reasoning above, not on evidence.
--
-- ⚠️ NO IN-REPO PRECEDENT FOR THE INSERT ARM -- extra review weight warranted.
-- No pg_cron body in this repository INSERTs into compute_jobs directly. The
-- three compute_jobs janitors are DELETEs (20260515113853:192-200,
-- 20260515210200:250-259, 20260719120000:98-104); the only INSERTs inside any
-- dollar-quoted cron body anywhere target audit_log_cold and
-- notification_dispatches; and
-- the fan-out crons write compute_jobs INDIRECTLY through a SECURITY DEFINER
-- function calling enqueue_compute_job in a per-row loop (20260717233529:243-251)
-- -- a shape rejected here for the three reasons above and below (it RAISEs on
-- the race, it is unbounded, and it is a callable surface). This INSERT arm is
-- therefore written FROM FIRST PRINCIPLES and deserves extra review weight, in
-- the same register 20260802120000:485-487 used for its own bounded UPDATE.
--
-- ⚠️ Nor can any gate that runs as the psql user prove this INSERT lands in
-- production. compute_jobs carries FORCE ROW LEVEL SECURITY with a deny-all
-- policy (20260516104201:209, 20260411144407:233-239); FORCE exists specifically
-- to close the table-owner bypass. Whether the pg_cron job role writes through
-- it is a property of THAT ROLE, and every CI gate connects as a different one.
-- The empirical precedent is strong but is inference, not measurement:
-- retention_compute_jobs_orphaned_running DELETEs from compute_jobs on a
-- schedule and is recorded as having deleted real PROD rows, which could not
-- happen if RLS blocked the cron role. The measurement is one real tick on TEST
-- inspected in cron.job_run_details, and it is a BLOCKING pre-merge item. Until
-- it is done, treat the write path as unproven and this paragraph as the
-- statement of that gap.
--
-- Idempotency
-- -----------
-- TWO distinct idempotency properties, do not conflate them.
--
--   RE-APPLY of this migration: cron.unschedule-then-cron.schedule is the
--   canonical repo pattern (20260802120000:447-450, 20260719120000:79-82,
--   20260515210200:164-167). cron.schedule upserts by name, so re-applying this
--   whole file replaces the body rather than adding a second job; STEP 2 asserts
--   exactly ONE row carries this jobname.
--
--   RE-RUN of the sweep (SC#2): running the body twice must be a provable no-op.
--   ⚠️ CORRECTED BY MEASUREMENT 2026-08-16. It is natural to say this "rides the
--   partial unique index", and the phase's own planning documents say so -- but
--   that is not what the mechanism turns out to be, and the distinction matters
--   for anyone editing the predicate later:
--     * SEQUENTIAL re-run is a no-op because of the ZERO-JOBS CONJUNCT. Tick 1
--       inserts a job row, which immediately removes the strategy from the
--       predicate, so tick 2's batch is empty and the INSERT is never reached.
--       Observed: with ON CONFLICT DO NOTHING deleted from the deployed body, a
--       second sequential tick STILL raises nothing -- there is no conflict to
--       have. Any gate that claims to prove ON CONFLICT by running the body twice
--       in one session is therefore VACUOUS.
--     * CONCURRENT races are handled first by FOR UPDATE SKIP LOCKED (an INSERT
--       into compute_jobs key-share-locks its parent strategies row, so the sweep
--       skips a strategy the live enqueue path is mid-insert on) and second by
--       ON CONFLICT DO NOTHING. Removing BOTH is what produces 23505 and kills
--       the tick; that is the only combination under which the RED was observed.
--   Either way NO new index is created; the arbiter when it is reached is:
--     compute_jobs_one_inflight_per_kind_strategy
--       ON compute_jobs (strategy_id, kind)
--       WHERE strategy_id IS NOT NULL
--         AND kind <> 'compute_intro_snapshot'
--         AND status IN ('pending', 'running', 'done_pending_children')
--   ⚠️ RE-BASE NOTE: that is the CURRENT definition, at
--   20260416125430:156-160. The original at 20260411144407:179 was DROPped at
--   20260416125430:154 and must not be used as the reference. Re-derived by
--   grepping ALL migrations on 2026-08-16; no later redefinition exists.
--
--   ON CONFLICT carries NO conflict target, deliberately. A targeted
--   ON CONFLICT (strategy_id, kind) cannot name a PARTIAL unique index without
--   repeating its predicate, and a repeated predicate is a second copy that can
--   drift from the index. The untargeted form matches every constraint and index
--   on the table, which is what is wanted here.
--
--   Note also that the index does NOT cover 'done' / 'failed_final' /
--   'failed_retry', so it would not block a re-insert for a strategy whose only
--   job row is terminal. That is moot -- such a strategy fails the zero-jobs
--   conjunct long before the INSERT is attempted -- and is written down so that
--   nobody weakens the predicate believing the index backstops it.
--
-- Convention deviation (pre-documented so review does not re-litigate)
-- -------------------------------------------------------------------
-- .claude/agents/migration-reviewer.md invariant #14 forbids BEGIN/COMMIT in a
-- migration and rates session-level SET as HIGH. This file uses BOTH
-- deliberately: the overwhelming majority of migrations in this repo use
-- BEGIN/COMMIT, including both pg_cron janitor analogs (20260719120000,
-- 20260720120000) and the direct template for this file (20260802120000:209-210),
-- and those analogs set lock_timeout = '5s' at session level. Per project Rule 11
-- (conformance over taste inside the codebase) and Rule 7 (pick one side, never
-- blend), the repo convention wins and the reviewer doc is stale. That staleness
-- is a backlog item, not fixed here. This is the ONLY sanctioned deviation.
--
-- Every other invariant was checked. APPLICABLE and satisfied:
--   #1  timestamp filename -- 14-digit prefix, strictly greater than the repo
--       tip 20260814120000 (verified 2026-08-16), so #2's backdated-migration
--       guard passes without an allowlist entry.
--   #11 no applied migration is edited -- this is a new file.
--   #15 JSONB -- the only JSONB written is built by jsonb_build_object from two
--       fixed literals and now(). There is no caller input to validate and no
--       untrusted value can reach it.
--   #16 template-artifact scan -- no placeholder, no unfinished-work marker, no
--       angle-bracket substitution token, no lorem text anywhere in this file.
--   #21 every RAISE format string is a SINGLE LITERAL with no concatenation in
--       the format slot; values are passed as arguments.
--
-- VACUOUSLY satisfied, and said out loud rather than left for the reviewer to
-- infer -- this migration creates no function, no policy, no view, no index and
-- no column:
--   #3  SECDEF search_path .............. no function is created
--   #4  BYPASSRLS-aware policy design ... no policy is created or altered
--   #5  CONCURRENTLY-in-transaction ..... no index is created
--   #6  23502 timebomb .................. no column is added
--   #7  NUMERIC vs INTEGER .............. no column is added
--   #8  column-shape drift .............. no column is added
--   #9  RLS recursion ................... no policy is created or altered
--   #10 check_function_bodies ........... no function is created
--   #12 RLS policy completeness ......... no policy is created or altered
--   #13 security_invoker views .......... no view is created
--   #17 trigger-on-SECDEF-helper REVOKE .. no function and no trigger
--   #18 DROP+CONCURRENTLY rebuild ....... no index is dropped or rebuilt
--   #19 SECDEF EXECUTE-to-authenticated .. no function, so no grant to leak
--   #20 ACL drift ....................... no GRANT and no REVOKE in this file
--
-- Operator observability
-- ----------------------
-- There is NO cron -> Sentry bridge in this repo and this migration does not
-- build one; claiming an alert that does not exist is the defect class this
-- milestone has spent two phases closing. Two honest surfaces exist instead.
--
-- (1) THE ALERT is worker-side, on claim. This body stamps
--     metadata = {"source": "reconcile-sweep", "detected_at": timestamptz now()},
--     and analytics-service/main_worker.py emits one warning-level Sentry event
--     when it claims a job carrying that marker (Phase 143 Plan 01). ⚠️ The two
--     key names and the marker value are a CROSS-LANGUAGE CONTRACT: drift in
--     either half silently kills the alert while both halves' own tests stay
--     green. Honest latency: sweep tick -> next worker claim; a fully-down
--     worker means no alert at all, which is independently alarmed by healthz.
--     ⚠️ Also unproven until Plan 04: the alert only reaches Sentry if SENTRY_DSN
--     is set on the WORKER's Railway service, which is a different service from
--     the FastAPI app. init_sentry() early-returns without it.
--
-- (2) THE RUN LOG is the secondary surface, and it is WEAKER than this file
--     originally claimed. To inspect sweep activity:
--
--       SELECT d.start_time, d.status, d.return_message
--         FROM cron.job_run_details d
--         JOIN cron.job j ON j.jobid = d.jobid
--        WHERE j.jobname = 'reconcile_dropped_enqueue_sweep'
--        ORDER BY d.start_time DESC
--        LIMIT 50;
--
--     ⛔ CORRECTED 2026-08-17 BY DIRECT OBSERVATION (Plan 04's live TEST tick).
--     The authoring-time draft of this paragraph said the body "RAISE NOTICEs the
--     healed count, which pg_cron records in return_message", flagged UNVERIFIED.
--     It has now been observed and it is FALSE on this Supabase build. The first
--     real tick returned:
--
--       start_time  2026-08-17 09:35:00.061575+00
--       end_time    2026-08-17 09:35:00.186637+00
--       status      succeeded
--       return_message  'DO'          <-- the COMMAND TAG, not the NOTICE text
--
--     pg_cron stores the command tag of the last statement, not the session's
--     NOTICE stream. So return_message tells you the tick RAN and whether it
--     SUCCEEDED -- it does NOT tell you how many rows were healed. The RAISE
--     NOTICE is still worth keeping (it reaches the Postgres server log, where
--     it is retrievable), but do NOT build an operator process on reading the
--     count out of return_message: it is not there.
--
--     ⇒ To count what a tick actually healed, query the rows, not the log:
--         SELECT count(*) FROM public.compute_jobs
--          WHERE metadata->>'source' = 'reconcile-sweep'
--            AND created_at >= <tick start_time>;
--       That is also the shape the worker-side Sentry alert keys on, so the two
--       observability surfaces agree by construction.
--
--     Whatever DOES surface carries no strategy id, no user id and no row data.
--     cron.job_run_details is operator-visible and this repository is public.
--
-- PROD-AUTO-APPLY WARNING
-- -----------------------
-- ⛔ Merging supabase/migrations/** to main AUTO-APPLIES to PROD
-- (khslejtfbuezsmvmtsdn). There is no separate deploy step and no confirmation
-- prompt. Apply to TEST (qmnijlgmdhviwzwfyzlc) FIRST, run
-- supabase/tests/test_reconcile_dropped_enqueue_sweep.sql, and inspect ONE REAL
-- TICK in cron.job_run_details before merge -- that tick is the only evidence
-- that the cron role can write compute_jobs through FORCE RLS. The founder call
-- of 2026-08-14 ("land them unattended", recorded in ROADMAP v1.19) authorizes
-- the merge, not the skipping of that check.
--
-- Prose hygiene
-- -------------
-- This header DISCUSSES rejected anchor columns by name, while STEP 2 asserts
-- their ABSENCE. Those two facts coexist only because every mechanical gate in
-- this phase scopes itself to the cron body -- read back out of cron.job for
-- the self-verify, extracted by a dollar-tag-delimited regex for the file-text
-- gates -- never to the whole file. Keep every rejected-column token OUT of the
-- cron-body literal, and keep every gate scoped to the body. Prose must neither
-- satisfy nor trip a mechanical gate.
--
-- ⚠️ AND THAT CUTS BOTH WAYS -- this paragraph is why the dollar tag is spelled
-- out nowhere above. An earlier draft of this header wrote the literal opening
-- tag three times in prose. The file-text gates extract the body with a
-- non-greedy regex between the FIRST and SECOND occurrence of that tag, so the
-- prose pair matched first and the "extracted body" was a span of COMMENTS
-- containing no INSERT at all -- under which every negative assertion would
-- have passed vacuously. It was caught only because the extraction helper
-- carries an anti-vacuity guard asserting the extracted text contains the
-- INSERT. Keep that guard in every gate that extracts this body, and never
-- write the opening dollar tag in a comment in this file.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: JOB-04 -- schedule the dropped-enqueue reconciliation sweep
-- --------------------------------------------------------------------------
-- Fail loud if pg_cron is absent (never a silent skip -- a migration RAISEs).
-- ⚠️ Do NOT copy the ELSE arm at 20260717233529:288, which RAISE NOTICEs and
-- carries on. That is the older, silent-skip convention: it would let this
-- migration report success while scheduling nothing, and the hole would stay
-- open with a green apply. Project Rule 12 is fail loud; 142 chose the same.
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'JOB-04: pg_cron extension is NOT installed. The dropped-enqueue reconciliation sweep cannot be scheduled and the JOB-04 hole would stay open behind a green apply. Install pg_cron via Supabase Dashboard -> Database -> Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Idempotent unschedule-then-schedule. cron.schedule upserts by name, so the
  -- unschedule is belt-and-braces; STEP 2 asserts exactly one row survives.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep') THEN
    PERFORM cron.unschedule('reconcile_dropped_enqueue_sweep');
  END IF;

  -- The body is an INLINE FIXED LITERAL: no function, no interpolation, no
  -- EXECUTE format(), no dynamic SQL, and every table schema-qualified to
  -- public.* so resolution is independent of the cron session's search_path. No
  -- function means no SECURITY DEFINER surface, no EXECUTE grant to revoke, and
  -- no caller-suppliable grace interval.
  --
  -- CLAUSE BY CLAUSE. Every conjunct below is load-bearing; none is decoration.
  --
  --   s.status <> 'archived'
  --       Hygiene only -- see STATUS GATE in the header. 'draft' is DELIBERATELY
  --       included; a drop victim may sit pre-terminal because nothing advanced
  --       it, so a draft filter could excise the healed population itself.
  --
  --   EXISTS (dailies for s.id)
  --       D-01. csv_daily_returns is the SINGLE canonical dailies store despite
  --       its name -- derive_broker_dailies upserts into it for API-source
  --       strategies too (job_worker.py:4720,4742), which is what the v1.10
  --       backbone unification delivered. So the predicate is SOURCE-AGNOSTIC
  --       and needs no join to strategies.source. Index-served by
  --       csv_daily_returns_strategy_date_key; per-key rows carry a NULL
  --       strategy_id and drop out of the equality for free.
  --
  --   NOT EXISTS (ANY compute_jobs row for s.id)
  --       ⚠️ ANY kind AND ANY status. This is load-bearing, not pedantry.
  --       Scoping it to kind = 'compute_analytics_from_csv' would match a
  --       strategy legitimately MID-CHAIN: derive_broker_dailies upserts the
  --       dailies and only THEN enqueues its follow-on, both inside the still-
  --       running parent job (job_worker.py:4742 then :5201-5209). There is a
  --       real window with dailies present, a running parent, and no analytics
  --       job yet. Kind-scoping would re-enqueue that healthy in-flight chain.
  --
  --   NOT EXISTS (strategy_analytics at one of FOUR statuses)
  --       ⚠️ THE SAFETY CONJUNCT. See SAFETY vs DEBOUNCE in the header for why
  --       weakening it is a mass-re-enqueue incident and for the measured
  --       exposure. Absent and 'pending' both PASS with this one clause;
  --       'computing' is excluded because it is 142's reaper's row.
  --
  --   NOT EXISTS (strategy_keys member for s.id)
  --       Composite exclusion. MONEY SAFETY, not optimization -- enqueueing the
  --       csv kind on a composite overwrites a correct headline with the
  --       single-key math its own handler abandoned. See non-coverage (2).
  --
  --   MAX(dailies.created_at) < now() - interval '1 hour'
  --       The grace window, evaluated LAST so it only runs on survivors of the
  --       four cheap index-served conjuncts (there is no index on created_at and
  --       none is added -- see the header's anchor rationale).
  --
  -- Bounded run (NO IN-REPO PRECEDENT for a pg_cron body INSERTing into
  -- compute_jobs -- see the header; this shape is written from first principles
  -- and deserves extra review weight):
  --   AS MATERIALIZED     -- Explicit optimization fence, kept DELIBERATELY and
  --                          not to be "simplified" away. ⚠️ BUT DO NOT BELIEVE
  --                          IT IS WHAT CREATES THE BOUND HERE -- that was
  --                          MEASURED and is false for this shape. Removing the
  --                          keyword from the deployed body and re-running the
  --                          26-candidate arm still heals 25 of 26, and EXPLAIN
  --                          output is BYTE-IDENTICAL either way: this CTE
  --                          carries a locking clause (FOR UPDATE), and Postgres
  --                          does not inline a CTE that locks rows, so the fence
  --                          is already implicit. The keyword is retained because
  --                          explicit beats implicit and because it survives a
  --                          future edit that drops FOR UPDATE -- at which point
  --                          the CTE WOULD become inlinable.
  --                          D-19's measured 26-of-26 was a DIFFERENT shape: a
  --                          correlated WHERE ... IN (SELECT ... LIMIT n) whose
  --                          subplan is re-executed per outer row. This body
  --                          feeds INSERT ... SELECT FROM batch, which scans the
  --                          CTE exactly once. Still: do NOT rewrite to the
  --                          IN-subquery form and do NOT push the batch onto the
  --                          inner side of a nested loop.
  --                          ⇒ The bound is proven by EXECUTING the body against
  --                          LIMIT+1 real rows, never by grepping for this token.
  --   ORDER BY the anchor ASC -- deterministic, oldest-orphaned first.
  --   LIMIT 25              -- drains 25/hour. Matches 142's per-tick bound. The
  --                            census puts the standing population at 0 on both
  --                            projects, so this is a blast-radius cap, not a
  --                            throughput target.
  --   FOR UPDATE SKIP LOCKED -- never block a live writer holding the row; skip
  --                            and take it next tick. ⚠️ It does MORE than that,
  --                            measured: an INSERT into compute_jobs takes an FK
  --                            KEY SHARE lock on its parent STRATEGIES row, which
  --                            conflicts with this FOR UPDATE. So a strategy the
  --                            live enqueue path is mid-insert on is SKIPPED by
  --                            the sweep entirely -- this is the FIRST line of
  --                            race defense, not merely a bound helper.
  --                            ON CONFLICT DO NOTHING is the SECOND line, and it
  --                            is load-bearing: with SKIP LOCKED removed the
  --                            sweep BLOCKS on that FK lock, meets the committed
  --                            row on release, and ON CONFLICT absorbs it; remove
  --                            BOTH and the tick dies on 23505. All three cases
  --                            were observed at READ COMMITTED (pg_cron default).
  --                            ⚠️ Neither clause is what makes a SEQUENTIAL
  --                            re-run a no-op -- the zero-jobs conjunct is. Once
  --                            a job row exists the strategy leaves the predicate,
  --                            so a second tick never reaches the INSERT at all.
  --       The batch CTE is a plain SELECT FROM strategies with EXISTS/NOT EXISTS
  --       subqueries and one correlated scalar MAX. It must stay that way: FOR
  --       UPDATE is illegal on the nullable side of an outer join and with
  --       aggregates at the same query level, so the MAX must remain a scalar
  --       subquery and must not be turned into a join or a GROUP BY.
  --
  -- The body NEVER references computed_at or updated_at (both are wrong grace
  -- keys -- see the header) and NEVER calls enqueue_compute_job (its race-loss
  -- arm RAISEs and would abort the tick). STEP 2 asserts all three absences.
  PERFORM cron.schedule(
    'reconcile_dropped_enqueue_sweep',
    '35 * * * *',
    $cron$
    DO $sweep$
    DECLARE
      v_healed INTEGER;
    BEGIN
      WITH batch AS MATERIALIZED (
        SELECT s.id
          FROM public.strategies s
         WHERE s.status <> 'archived'
           AND EXISTS (
                 SELECT 1
                   FROM public.csv_daily_returns d
                  WHERE d.strategy_id = s.id
               )
           AND NOT EXISTS (
                 SELECT 1
                   FROM public.compute_jobs cj
                  WHERE cj.strategy_id = s.id
               )
           AND NOT EXISTS (
                 SELECT 1
                   FROM public.strategy_analytics sa
                  WHERE sa.strategy_id = s.id
                    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings', 'failed')
               )
           AND NOT EXISTS (
                 SELECT 1
                   FROM public.strategy_keys sk
                  WHERE sk.strategy_id = s.id
               )
           AND (
                 SELECT max(dg.created_at)
                   FROM public.csv_daily_returns dg
                  WHERE dg.strategy_id = s.id
               ) < now() - interval '1 hour'
         ORDER BY (
                 SELECT max(dg.created_at)
                   FROM public.csv_daily_returns dg
                  WHERE dg.strategy_id = s.id
               ) ASC
         LIMIT 25
         FOR UPDATE SKIP LOCKED
      )
      INSERT INTO public.compute_jobs (strategy_id, kind, metadata)
      SELECT b.id,
             'compute_analytics_from_csv',
             jsonb_build_object('source', 'reconcile-sweep', 'detected_at', now())
        FROM batch b
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS v_healed = ROW_COUNT;

      RAISE NOTICE 'JOB-04 reconcile_dropped_enqueue_sweep: healed % dropped-enqueue strategies this tick.', v_healed;
    END
    $sweep$;
    $cron$
  );

  RAISE NOTICE 'JOB-04: reconcile_dropped_enqueue_sweep scheduled (hourly at minute 35, 1-hour grace window, LIMIT 25 per tick).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: self-verify -- the DEPLOYED cron body (JOB-04)
-- --------------------------------------------------------------------------
-- Read back out of cron.job, never re-typed. Every failure message NAMES THE
-- CONSEQUENCE, not merely the missing token: a gate whose message says "token
-- absent" teaches the next reader nothing about why they must not do it again.
DO $$
DECLARE
  v_command  TEXT;
  v_schedule TEXT;
  v_count    INTEGER;
  v_mat      INTEGER;
  v_anchor   INTEGER;
BEGIN
  SELECT count(*) INTO v_count
    FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'JOB-04 verification failed: expected exactly ONE cron job named reconcile_dropped_enqueue_sweep, found %. Two rows would run the sweep twice per hour and double the per-tick blast radius the LIMIT exists to cap.', v_count;
  END IF;

  SELECT command, schedule
    INTO v_command, v_schedule
    FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep';

  IF v_command IS NULL THEN
    RAISE EXCEPTION 'JOB-04 verification failed: reconcile_dropped_enqueue_sweep cron job missing after schedule; the JOB-04 hole is still open and the apply would otherwise report success.';
  END IF;

  -- STRING equality, never a ::INT cast on a schedule field: four of the five
  -- fields here are '*' and casting one would error.
  IF v_schedule IS DISTINCT FROM '35 * * * *' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: sweep cron schedule is not the expected 35 * * * * cadence; minute 35 is what keeps this off 142 reaper quarter-hour grid and off every other registered slot.';
  END IF;

  -- ----- POSITIVE anchors on the DEPLOYED body -----
  IF v_command NOT ILIKE '%public.strategies%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: sweep body does not drive from a schema-qualified public.strategies; an unqualified name resolves through the cron session search_path and could bind to another schema.';
  END IF;
  IF v_command NOT ILIKE '%public.csv_daily_returns%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: sweep body does not read public.csv_daily_returns, so it has no dailies conjunct at all and would enqueue analytics for strategies that have no data to compute from.';
  END IF;
  IF v_command NOT ILIKE '%public.compute_jobs%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: sweep body does not reference public.compute_jobs; without the zero-jobs conjunct it would re-enqueue every strategy with a healthy in-flight chain.';
  END IF;
  IF v_command NOT ILIKE '%public.strategy_analytics%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: sweep body does not reference public.strategy_analytics. That conjunct is the ONLY protection for healthy retention-aged strategies (done job rows are deleted at 30 days), so its absence is a mass re-enqueue of the historical corpus on the next tick.';
  END IF;
  IF v_command NOT ILIKE '%complete_with_warnings%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: the terminal-analytics exclusion list is incomplete (complete_with_warnings is missing). Every strategy holding that terminal status would be re-enqueued and its correct headline recomputed -- the mass-re-enqueue incident, partial edition.';
  END IF;
  IF v_command NOT ILIKE '%public.strategy_keys%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: sweep body does not exclude composites via public.strategy_keys. Enqueueing compute_analytics_from_csv on a composite overwrites a correct composite headline with the divergent single-key computation its own handler abandoned -- silent money-math corruption.';
  END IF;
  IF v_command NOT ILIKE '%compute_analytics_from_csv%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: sweep body does not enqueue the compute_analytics_from_csv kind, so nothing it inserts would ever be dispatched to the analytics handler.';
  END IF;
  IF v_command NOT ILIKE '%reconcile-sweep%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: sweep body does not stamp the reconcile-sweep metadata marker. The worker reads that exact value to fire the Sentry alert, so without it a dropped enqueue is healed SILENTLY and SC#1 alert half is false.';
  END IF;
  IF v_command NOT ILIKE '%detected_at%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: sweep body does not stamp detected_at. That key is the other half of the cross-language marker contract main_worker.py reads; drift in either key kills the alert while both halves own tests stay green.';
  END IF;
  IF v_command NOT ILIKE '%ON CONFLICT DO NOTHING%' THEN
    RAISE EXCEPTION 'JOB-04/SC#2 verification failed: sweep body lost ON CONFLICT DO NOTHING. A bare INSERT racing the live enqueue path raises unique_violation against compute_jobs_one_inflight_per_kind_strategy, which aborts the whole tick and skips every remaining candidate.';
  END IF;
  IF v_command NOT ILIKE '%FOR UPDATE SKIP LOCKED%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: sweep body dropped FOR UPDATE SKIP LOCKED; the batch would block on any row a live writer holds instead of skipping it and taking it next tick.';
  END IF;
  IF v_command NOT ILIKE '%interval ''1 hour''%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: sweep body does not carry the 1-hour grace literal. Without a grace window the sweep RACES the live after() enqueue it exists to backstop and inserts duplicate work in the normal path.';
  END IF;
  IF v_command NOT ILIKE '%archived%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: sweep body lost the archived-status exclusion, so archived strategies would consume worker slots for analytics nobody reads.';
  END IF;

  -- The grace anchor, pinned POSITIVELY. Both the WHERE conjunct and the
  -- ORDER BY must read the dailies MAX -- the ORDER BY is what makes the LIMIT
  -- deterministic and forward-progressing, so losing it is a real defect, not a
  -- style change. Pinning the anchor positively (rather than negatively
  -- forbidding s.created_at) is deliberate: "created_at" is a substring of the
  -- legitimate dailies reference, so a negative token gate on it would be a
  -- collision hazard. ⚠️ A legitimate rewrite of the anchor (e.g. to a LATERAL)
  -- must move this gate in the SAME commit -- a drift gate left behind guards a
  -- superseded body while staying green.
  v_anchor := (length(upper(v_command)) - length(replace(upper(v_command), 'MAX(DG.CREATED_AT)', ''))) / length('MAX(DG.CREATED_AT)');
  IF v_anchor <> 2 THEN
    RAISE EXCEPTION 'JOB-04 verification failed: the deployed body reads the dailies MAX grace anchor % times, expected 2 (one in the WHERE conjunct, one in the ORDER BY). Zero means the grace window or the anchor is gone; one usually means the ORDER BY was dropped, which removes the determinism the bounded batch depends on for forward progress.', v_anchor;
  END IF;

  -- The D-19 fence. Exactly ONE arm here, so exactly one MATERIALIZED.
  -- ⚠️ SHAPE gate, NOT a proof of the bound. Measured 2026-08-16: removing this
  -- keyword changes neither the plan nor the result, because the CTE carries a
  -- locking clause and Postgres does not inline a locking CTE. The bound is
  -- proven ONLY by executing the body against LIMIT+1 real rows. Keep this gate
  -- as shape enforcement and never let a green here be read as a bound proof --
  -- every gate in phases 142/142.1 passed over a body whose bound did not exist.
  v_mat := (length(upper(v_command)) - length(replace(upper(v_command), 'AS MATERIALIZED', ''))) / length('AS MATERIALIZED');
  IF v_mat <> 1 THEN
    RAISE EXCEPTION 'JOB-04/D-19 verification failed: the deployed body carries % MATERIALIZED batch CTEs, expected exactly 1. The explicit fence is what keeps the bound safe against a future edit that drops FOR UPDATE and makes the CTE inlinable -- at which point the LIMIT would be re-applied per outer row and the per-tick blast radius would silently become unbounded.', v_mat;
  END IF;

  -- ----- NEGATIVE anchors on the DEPLOYED body -----
  IF v_command ~* 'IN\s*\(\s*SELECT[^)]*LIMIT' THEN
    RAISE EXCEPTION 'JOB-04/D-19 verification failed: the deployed body binds its bounded batch through an IN (SELECT ... LIMIT ...) subquery. That is the exact un-hashable-subplan shape whose LIMIT is re-applied per outer row, so the per-tick bound silently does not exist.';
  END IF;
  IF v_command ILIKE '%computed_at%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: the deployed body references computed_at. The status bridge re-stamps it on every job transition and the Python entry upsert omits it, so it is wrong in BOTH directions -- this is the exact column Phase 106 janitor was REVERTED for.';
  END IF;
  IF v_command ILIKE '%updated_at%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: the deployed body references updated_at. Both the CSV persist and the broker-dailies derive re-stamp that column on every refresh, so a grace window keyed on it would never elapse for an actively-refreshed strategy and the hole would stay open for exactly the longest-lived strategies.';
  END IF;
  IF v_command ILIKE '%enqueue_compute_job%' THEN
    RAISE EXCEPTION 'JOB-04 verification failed: the deployed body calls the enqueue RPC. Its race-loss arm RAISEs serialization_failure, and a RAISE inside a cron body aborts the ENTIRE tick -- the healed count is lost, the NOTICE never runs, and every remaining candidate is skipped. A direct INSERT with ON CONFLICT DO NOTHING has no such arm.';
  END IF;

  RAISE NOTICE 'JOB-04: reconcile_dropped_enqueue_sweep self-verify passed (single job, 35 * * * * cadence, 1 MATERIALIZED batch, no IN-subquery LIMIT, five predicate conjuncts anchored, marker keys pinned, rejected anchor columns and the enqueue RPC absent).';
END $$;

COMMIT;
