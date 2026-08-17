-- Migration: orphaned-`running` compute_jobs are TERMINALIZED, never removed
-- (JOB-05, Phase 144, v1.19, 2026-08-17)
-- =============================================================================
--
-- Why this migration exists
-- -------------------------
-- The shipped janitor (20260719120000, window-corrected by 20260720120000)
-- REMOVES an orphaned `running` compute_jobs row outright. That closes the
-- re-pollution flake it was written for, and it costs three things it should not:
--
--   (1) THE POLLER NEVER BREAKS OUT. /api/strategies/[id]/sync-progress projects
--       `status` and nothing else (route.ts:284,294), and the wizard treats every
--       status outside FINISHED_JOB_STATUSES as in-flight
--       (SyncPreviewStep.tsx:207-214). A row sitting at `running` forever keeps
--       isJobInFlight() permanently true. A row that VANISHES is no better: the
--       route reports no job at all, which is the same non-answer wearing a
--       different hat.
--   (2) THE AUDIT TRAIL IS GONE. A removed row cannot be read after the fact, so
--       the one artifact that says a worker was down past its claim window is
--       destroyed by the mechanism that detected it.
--   (3) PHASE 142's REAPER STAYS BLOCKED. Its clock-start and reap arms both
--       carry NOT EXISTS (cj.status IN ('pending','running','done_pending_children',
--       'failed_retry')) (20260803130000:118-121 and :139-142). While the orphan
--       is `running` the strategy is excluded, and the user-facing analytics
--       string 142 exists to write is never written.
--
-- This migration replaces the body with a TERMINAL UPDATE to `failed_final`.
-- That is the resolution of the founder-deferred WR-02 DELETE-vs-reset call, and
-- it is neither of the two options that call was framed around:
--
--   * TEST needed the row GONE, because a row reset to `pending` is re-claimed to
--     `running` by the next fence-test run and the partition-dedupe collision
--     returns. `failed_final` satisfies that need WITHOUT removal: it leaves both
--     the claim RPC's partition-dedupe predicate (20260719073701:159-179, keyed on
--     x.status IN ('running','done_pending_children')) and the claimable set
--     (:204, status IN ('pending','failed_retry')). The row can never be
--     re-claimed, so the daily re-pollution ends exactly as removal ended it.
--   * PROD needed the work RECOVERABLE and the evidence KEPT. A surviving
--     terminal row gives the poller an exit, gives an operator the forensics, and
--     — because `failed_final` is the ONLY terminal-failure value outside 142's
--     exclusion set — hands the user-facing message to the mechanism that already
--     knows how to write it.
--
-- Reset-to-`pending` remains REJECTED for both, and this file must not be read as
-- a softened version of it: `pending` is claimable, so it re-opens the TEST flake
-- and, on PROD, silently re-runs a job that may be orphaned precisely because it
-- killed the worker.
--
-- WHERE THE VALUE LANDS (do not overclaim). Two limits, both real:
--   * A NON-STRATEGY-SCOPED orphan is invisible to the wizard poller.
--     get_user_compute_jobs filters on COALESCE(s.user_id, p.user_id) = auth uid
--     (20260516104201:805), so an api_key-scoped or allocator-scoped job — every
--     derive_broker_dailies row, which is the bulk of the measured population — is
--     not projected to any user surface at all. This file terminalizes it for the
--     audit trail and for 142; it does not claim a poller sees it.
--   * A CHAIN-MID orphan is recovered by nobody. Phase 143's sweep requires
--     NOT EXISTS (ANY compute_jobs row for the strategy) (20260816140000:728-732),
--     so a terminalized orphan excludes its strategy from reconciliation forever.
--     That residual is NAMED here and filed to .planning/TODOS.md; it is not fixed
--     in this migration, because widening 143's shipped predicate is a change with
--     its own safety analysis (its header at :73-83 argues the safety is carried
--     by the terminal-analytics conjunct, so the widening may be tractable — as a
--     separate phase, not as a rider here).
--
-- CADENCE HONESTY
-- ---------------
-- The '50 * * * *' schedule is POST-THRESHOLD DETECTION LATENCY. An orphan is
-- terminalized within ~1 hour of CROSSING its window, so the worst case for the
-- JOB ROW is about 4 h (threshold) + 1 h (cadence) = ~5 h. For the downstream
-- strategy_analytics surface add Phase 142's own 16-hour reap threshold
-- (20260803130000:137), i.e. ~21 h before a user sees "Analytics was interrupted
-- before it could finish and did not recover." The cadence does NOT bound
-- user-visible wait and this file makes no such claim: SyncPreviewStep.tsx
-- self-escalates a frozen status at RETRY_THRESHOLD_MS = 900_000 (15 minutes),
-- long before either window elapses. Tightening daily -> hourly buys detection
-- latency, nothing else.
--
-- Minute 50 is deliberate, not arbitrary. The occupied minute-of-hour set across
-- all migrations at HEAD is {0, 5, 10, 15, 20, 30, 35, 45}:
--   :00 every hour  match_engine_cron            (20260408215026:65-67)
--   :00/:15/:30/:45 reap_strategy_analytics_...  (20260803130000:107-109, */15)
--   :35 every hour  reconcile_dropped_enqueue_sweep (20260816140000:711-713)
--   :00 03  audit_log_hot_to_cold                (20260515210200:167-169)
--   :00 03  compute_bridge_outcome_deltas        (20260418074935:240-242)
--   :05 03  audit_log_cold_purge                 (20260515113853:166-168)
--   :10 03  retention_notification_dispatches    (20260515210200:210-212)
--   :15 03  resend_message_correlation_retention (20260515113637:61-63)
--   :20 03  retention_compute_jobs_done          (20260515113853:192-194)
--   :30 03  retention_compute_jobs_failed        (20260515210200:251-253)
--   :00 04  api_key_rotation_reminder            (20260417110539:333-335)
--   :00 04  poll-allocator-positions             (20260420073003:692)
--   :15 04  THIS JOB, before this migration      (20260720120000:64-66)
--   :00 05  refresh-allocator-equity             (20260420213754:379-381)
--   :30 05  derive-allocator-key-dailies         (20260717233529:280-282)
-- Free minutes are {25, 40, 50, 55} and any unlisted one. :50 sits 5 minutes
-- after the light, bounded */15 reaper and 10 minutes before :00, the busiest
-- slot of the hour (match_engine_cron stacked with that reaper). :25 was the
-- runner-up and is the fallback if a hand-registered job ever occupies :50, but
-- it sits 5 minutes after retention_compute_jobs_done's unbounded 30-day DELETE
-- on THIS VERY TABLE, which is the worst neighbour available to this janitor.
--
-- ⚠️ The list above is derived from migrations, not from a live catalog read. A
-- job registered by hand outside supabase/migrations/** would not appear in it.
-- Plan 03 re-runs SELECT jobid, jobname, schedule FROM cron.job on BOTH projects
-- immediately before applying, and falls back to :25 on a collision.
--
-- Threshold rationale
-- -------------------
-- TWO arms, TWO thresholds, and they are not interchangeable.
--
-- ARM A — claimed orphans: 4 HOURS, UNCHANGED, on claimed_at.
-- This is the RT-01-corrected window and it is deliberately NOT touched. The
-- WORKER-04 lesson is explicit: the THRESHOLD, not the frequency, is what
-- protects a live job. main_worker claims a BATCH of 5 (p_batch_size=5,
-- main_worker.py:556,597) and stamps claimed_at at CLAIM time for the whole
-- batch, dispatch is SEQUENTIAL, and the longest per-kind timeout is 30 minutes
-- (job_worker.py TIMEOUT_PER_KIND) — so job #5 of a full batch on a HEALTHY
-- worker can legitimately carry a claim stamp 5 x 30 min = 2.5 h old. The
-- 4-hour window clears that ceiling with 1.5 h of margin and does not depend on
-- the watchdog firing, whose failure mode is silent. Tightening the cadence while
-- shrinking this window would re-open exactly the bug 20260720120000 fixed.
--
-- ARM B — never-stamped claims: 48 HOURS, DERIVED, on created_at.
-- created_at is not a claim time, so the 4-hour figure does not transfer and is
-- not copied. The derivation, from three quantities that are all read from source:
--
--   max queue wait before the next fan-out supersedes the row  = 24 h
--       poll_positions enqueue cadence — main_worker.py:1089,
--       `async def daily_enqueue_loop(interval: float = 86400.0)`. 24 h is the
--       LONGEST enqueue cadence in the system; every other cron-fanned kind is
--       also daily (04:00, 05:00, 05:30), so a threshold derived from it dominates
--       for every kind. Chain follow-on kinds have no cadence at all and for them
--       this is pure margin.
--   + max batch wall-clock once claimed                        =  2.5 h
--       the same 5 x 30 min ceiling arm A is built on, already codified in
--       20260720120000:24-30.
--                                                              = 26.5 h ceiling
--
-- 48 h is the smallest whole multiple of the 24-hour enqueue cadence that
-- strictly dominates that ceiling (1.81x), and it carries an independent
-- operational reading: a row still `running` after TWO full daily fan-outs has
-- been superseded twice over. Rounding to a cadence multiple rather than to 27 h
-- or 30 h is the same discipline 20260803130000:550-551 uses for its own bound.
--
-- Each foreign number is named with WHY it does not transfer:
--   * NOT 4 h  (20260720120000) — that bounds how long ONE CLAIMED job may sit
--     `running`. Arm B's rows were never claimed; there is no claim to age.
--   * NOT 16 h (20260803130000) — that bounds a strategy_analytics row with a
--     CHAIN IN FLIGHT, over the worst simple path through JOB_CHAIN_FOLLOW_ON.
--     Different table, different mechanism.
--   * NOT 1 h  (20260816140000) — that bounds a route-commit -> after() enqueue
--     gap, which is sub-second in the happy path. Three orders of magnitude too
--     small for a queue-cadence question.
-- A bare number with no derivation is what Phase 106's janitor was REVERTED for.
-- The paragraph above is the derivation.
--
-- ⚠️ HONESTY, and do not let the symmetry of the two arms imply otherwise: ARM B's
-- THRESHOLD IS NOT A LIVE-JOB GUARD THE WAY ARM A's IS. Every claim writer at
-- HEAD stamps status and claimed_at in ONE statement (latest:
-- 20260719073701:181-184), so there is no window — not even one transaction — in
-- which a legitimately-claimed row lacks claimed_at. Arm B therefore protects
-- nothing that exists today. It is margin against a hypothetical future
-- two-statement writer, plus legibility. Claiming it guards live work would be
-- the same overclaim that got Phase 106 reverted.
--
-- ⚠️ DIVERGENCE FROM PHASE 142, ARGUED RATHER THAN BLENDED
-- --------------------------------------------------------
-- 20260802120000:475-476 states a rule in the opposite direction: "a NULL stamp
-- is a WRITER bug, not a stranded job. SKIP it; never reap it." Arm B REVERSES
-- that call for THIS table. Both cannot be universal, so here is why this one
-- wins here rather than a blend of the two:
--
--   * 142's NULL-stamp row has NO KEY TO AGE FROM. Its predicate is anchored on
--     computing_started_at, and a row with that column NULL offers the reaper no
--     timestamp at all — skipping is the only safe move available to it.
--     compute_jobs.created_at, by contrast, is NOT NULL DEFAULT now()
--     (20260411144407:134). Arm B has a real, derivable anchor that 142's row
--     simply does not have.
--   * 142's RULE IS PRECISELY WHAT KEPT THE MEASURED ROWS IMMORTAL. The shipped
--     janitor's `claimed_at IS NOT NULL` conjunct (20260720120000:70) excludes
--     NULL-claim rows BY NAME, and `NULL < x` is NULL — never TRUE — even without
--     it. The 6 such rows measured on TEST on 2026-08-17 had been stuck up to 14
--     days, structurally invisible to the janitor built to clear them.
--   ⛔ The blend — "skip them but log them" — is REJECTED. That is a description
--     of the current state, which accumulated silently for two weeks.
--
-- THE NULL-CLAIM WRITER IS TRACED, AND IT IS TEST RESIDUE
-- ------------------------------------------------------
-- Shipping arm B without tracing the writer would be treating a symptom. The
-- trace was done and its result is recorded here with its evidence, because the
-- honest conclusion is that there is NO PRODUCTION WRITER TO FIX and shipping a
-- speculative "writer fix" would be inventing a defect:
--
--   * EXCLUSION. Every SQL site that writes status = 'running' is a redefinition
--     of the claim RPC, and every one of the twelve stamps claimed_at = now() in
--     the SAME SET list of the SAME statement (20260411144407:562-563 through
--     20260719073701:181-184, the latest). Symmetrically, every writer that sets
--     claimed_at = NULL simultaneously moves status OUT of `running`
--     (20260516104201:592-596, :656-660; 20260529170000:142-149). There are ZERO
--     Python and ZERO TypeScript writers of that status. No INSERT in any
--     migration inserts status = 'running'.
--   * ATTRIBUTION. The only in-repo producer of the exact row shape is a live-DB
--     TEST FIXTURE: analytics-service/tests/test_compute_jobs_fencing.py:1138-1152
--     and :1191-1205 drive a row to `running` by direct table UPDATE, deliberately
--     (its docstring at :1132-1136 explains why), and clean it up in a `finally:`
--     that does not run if the process is killed. It matches the census on five
--     independent attributes — status, claimed_at NULL, attempts = 1, kind
--     poll_positions, TEST-only by construction — and on the date window (the
--     file's most recent commit is 2026-08-11, inside it).
--   * CONFIRMATION. PROD holds ZERO such rows, which is what an escaped test
--     fixture predicts and a production writer bug does not. Plan 03 runs the
--     confirming query live before apply; its kill criteria are recorded in
--     144-RESEARCH.md §3.
--   * DISPOSITION. Fixture hygiene is filed to .planning/TODOS.md, not fixed here.
--     Arm B ships anyway as defence in depth against the CLASS — any future
--     direct-UPDATE writer, migration or manual repair — which is a different
--     claim from "the invariant is closed", and this file does not make that one.
--
-- Arm B anchor rationale (the Phase 106 lesson)
-- ---------------------------------------------
-- The anchor is compute_jobs.created_at. Each alternative is named with HOW it is
-- wrong, not merely that it is:
--
--   * claimed_at — IMPOSSIBLE by construction. Arm B's whole predicate is that
--     this column is NULL, so there is no timestamp in it to compare.
--   * updated_at — REJECTED, and it is the Phase 106 shape reproduced on this very
--     table. compute_jobs carries a BEFORE UPDATE trigger,
--     compute_jobs_set_updated_at_trigger (20260411144407:265-268), which
--     re-stamps that column on EVERY write. A threshold keyed on it would never
--     elapse for any row anything touches, and the hole would stay open longest
--     for the rows most written to.
--   * next_attempt_at — REJECTED twice over. It is a SCHEDULING column, set at
--     enqueue and moved by the backoff path, so it says nothing about when the row
--     was created; and it is the column this migration REPURPOSES as the retention
--     clock (see B3 below), so keying the detector on the same column the detector
--     writes would be self-referential.
--
-- created_at survives on the merits, not by elimination: it is NOT NULL DEFAULT
-- now(), no writer re-stamps it, and it is DIRECTLY INSERT-WRITABLE, which is what
-- lets a gate backdate a seed instead of sleeping.
--
-- ⭐ B3 — WHY next_attempt_at IS IN BOTH SET LISTS (this is not a nicety)
-- ----------------------------------------------------------------------
-- retention_compute_jobs_failed (jobid 8) deletes on a key most readers do not
-- expect. Its deployed body, 20260515210200:255-259:
--     ... status IN ('failed_final','failed_retry')
--     AND COALESCE(next_attempt_at, created_at) < now() - interval '90 days'
-- The cutoff is next_attempt_at, NOT created_at — and the claim RPC never
-- advances next_attempt_at (20260719073701:181-190 sets status, claimed_at,
-- claimed_by, attempts, claim_token, last_error, error_kind, metadata and leaves
-- it alone). An orphan's next_attempt_at is therefore frozen at roughly its
-- ENQUEUE time.
--
-- ⇒ A status-only flip would make an orphan whose next_attempt_at is already past
-- 90 days eligible for removal on the VERY NEXT 03:30 tick: terminalized at
-- 04:50, gone by 03:30 the following morning. The row that "survives for audit
-- until retention collects it at 90 days" would survive for eleven hours. Setting
-- next_attempt_at = now() restarts that clock at terminalization, which is
-- precisely the convention the retention migration's own header records at
-- 20260515210200:242-245 ("mig 109 P4 sets next_attempt_at=now() for failed_final
-- transitions, so failed_final rows always hit the 90d wall on schedule").
-- Note the asymmetry that makes this easy to miss: retention_compute_jobs_done
-- (jobid 4) DOES key on created_at (20260515113853:195-199).
--
-- The SET list, column by column
-- ------------------------------
-- Exactly FOUR columns are written, and every other column is preserved
-- DELIBERATELY:
--   status          -- 'failed_final'. The only field the poller reads, the only
--                      terminal-failure value outside 142's exclusion set, and
--                      outside the claimable set so the row can never be
--                      re-claimed. ⛔ NOT 'failed_retry': that value is claimable
--                      (20260719073701:204) AND inside 142's exclusion set
--                      (20260803130000:141), so it would move the row without
--                      moving the outcome and would leave 142 blocked forever.
--   next_attempt_at -- now(). B3 above. Omit it and the audit trail this phase
--                      promises can be 89 days shorter than advertised.
--   error_kind      -- 'permanent'. get_user_compute_jobs synthesises its
--                      user_message from (status, error_kind)
--                      (20260516104201:784-797); 'permanent' selects the accurate
--                      "we can't retry this automatically" arm, and it matches the
--                      column's documented meaning at 20260411144407:159-160.
--                      ⚠️ There is NO user_message COLUMN on this table to write —
--                      it is a computed member of that RPC's RETURNS TABLE, and
--                      the sync-progress route explicitly refuses to project it
--                      (route.ts:246-247). A migration written against such a
--                      column would fail to apply.
--   last_error      -- a FIXED literal per arm. No identifier, no row data, no
--                      upstream error text, no re-attribution of fault. This is an
--                      OPERATOR channel: the RPC hard-redacts it to NULL
--                      (20260516104201:780) and the zod contract pins that
--                      redaction (analytics-schemas.ts:195), so nothing written
--                      here reaches a user.
-- PRESERVED, each for a reason:
--   claimed_at / claim_token -- the forensic record of the claim that leaked, and
--                      for arm A the very value the predicate matched on.
--   claimed_by      -- which worker last held the row. Precedent: audit M-0779
--                      deliberately stopped mark_compute_job_failed from clearing
--                      it (20260516104201:917-928).
--   attempts        -- this is not a real attempt outcome; fabricating one would
--                      corrupt the retry accounting.
--   metadata        -- untouched. compute_jobs_metadata_size_bounded caps it at
--                      8192 bytes (20260515210000:145-148) and a CHECK violation
--                      inside a pg_cron block ABORTS THE WHOLE TICK. There is no
--                      marker worth that risk here; the operator surface is a row
--                      query, not a log line (see Operator observability).
--   updated_at      -- written for free by compute_jobs_set_updated_at_trigger
--                      (20260411144407:265-268), the ONLY trigger on this table.
--                      That gives terminalization a timestamp at no cost. Note
--                      also what it does NOT do: there is no status-bridge trigger
--                      on compute_jobs, so terminalizing a row does not cascade
--                      into strategy_analytics. 142's reaper does that, on its own
--                      schedule, once this unblocks it.
--
-- ⛔ NO RE-ENQUEUE ARM, AND THE BODY NEVER CALLS THE ENQUEUE RPC
-- --------------------------------------------------------------
-- It is tempting to re-queue the lost work. It is wrong here, for four reasons,
-- and the first one inverts the intuition:
--   (1) THE ORPHAN IS THE THING SUPPRESSING ITS OWN REPLACEMENT. The in-flight
--       partial unique index (20260416125430:156-161) and the enqueue RPC's
--       in-flight probe (20260716090000:108,115,151,158) both key on
--       status IN ('pending','running','done_pending_children') — a set that
--       EXCLUDES failed_final. The daily fan-out probes exactly that set before
--       enqueueing (20260412094449:249-253). So terminalizing RELEASES the slot,
--       and the next fan-out (<= 24 h) enqueues a fresh job by itself. For every
--       cron-fanned kind, terminalization IS the recovery.
--   (2) DUPLICATE + 23505. For those same kinds a janitor INSERT races the
--       fan-out and collides on the in-flight index. A RAISE inside a pg_cron
--       block aborts the WHOLE tick, taking the terminalization with it.
--   (3) POISON-JOB AMPLIFICATION. A job may be orphaned precisely because it
--       killed the worker. Blind re-enqueue turns a one-shot poison job into an
--       infinite loop across restarts, outside the attempts/max_attempts channel.
--   (4) BLAST RADIUS. supabase/migrations/** auto-applies to PROD. A janitor that
--       INSERTs can create production work with no human in the loop; one that
--       only UPDATEs a status is bounded by construction.
-- For user-initiated one-shot kinds the exit is the user's own Retry CTA, which
-- `failed_final` un-suppresses (SyncPreviewStep.tsx:207-214, and isAutoRetrying at
-- :2524 is gated on failed_retry, so it stays false).
--
-- The per-tick BOUND, and why 100
-- -------------------------------
-- The bound is sized to PER-TICK STATEMENT COST, not to any observed population.
-- ⚠️ An earlier draft justified it as "strictly dominates the measured 402". That
-- framing is DELETED, not softened: a bound justified by being bigger than
-- today's backlog becomes FALSE the moment the backlog grows, which is the Phase
-- 106 lineage in a new costume.
--
-- Cost first. A 100-row UPDATE on public.compute_jobs fires
-- compute_jobs_set_updated_at_trigger once per row and is single-digit-millisecond
-- work. Both arms take FOR UPDATE SKIP LOCKED, so a live writer is never blocked,
-- and the only rows locked are by-predicate orphans that nothing legitimate holds.
-- Postgres would tolerate an order of magnitude more. ⇒ SAFETY DOES NOT
-- DISCRIMINATE between the candidate bounds, so the tie is broken on EVIDENCE.
--
-- 100 is chosen DELIBERATELY BELOW the measured live TEST population (396 arm-A
-- rows, census 2026-08-17) so that the bound's LIVE behaviour is OBSERVABLE before
-- merge. Plan 03 watches successive real ticks move exactly 100 rows, oldest
-- first, and then progress — bounded AND progressing, against real stuck data,
-- under the real cron role, with the real trigger and real RLS. That is the
-- evidence class Phase 143 established when it watched "healed 25" become
-- "healed 1", and the offline harness structurally cannot reproduce it (no RLS, no
-- real pg_cron). A bound at or above the population would drain everything in one
-- tick and make that observation impossible.
-- Drain cost of the choice: at hourly cadence a day-scale backlog still clears
-- inside a working day (the measured 396 clears in four ticks).
--
-- ⚠️ AS MATERIALIZED is SHAPE ENFORCEMENT, NEVER A BOUND PROOF. Measured in Phase
-- 143 (20260816140000:657-669): removing the keyword from a LOCKING CTE changes
-- neither the plan nor the result, because Postgres does not inline a CTE that
-- locks rows. It is retained because explicit beats implicit and because it
-- survives a future edit that drops FOR UPDATE, at which point the CTE WOULD
-- become inlinable. The bound is proven ONLY by executing the deployed body
-- against 101 real rows — done offline in 144-01 and again live in 144-03.
-- ⛔ Do NOT rewrite either batch as WHERE id IN (SELECT ... LIMIT n): that is the
-- D-19 shape whose subplan is re-executed per outer row, so the LIMIT is not a
-- bound at all. STEP 2 forbids it by pattern.
--
-- Scope discipline
-- ----------------
-- This migration re-registers ONE cron job and does NOTHING else. No DDL, no
-- column, no index, no constraint, no function, no view, no trigger, no policy, no
-- GRANT and no REVOKE. It does NOT touch: compute_jobs DDL or RLS, the claim RPC,
-- mark_compute_job_done / mark_compute_job_failed, enqueue_compute_job,
-- retention_compute_jobs_done (jobid 4), retention_compute_jobs_failed (jobid 8),
-- the derive fan-out (jobid 9 — ⛔ NAMED TRAP: never unschedule it,
-- test_derive_allocator_keys_fanout.sql assertion 6 requires it registered),
-- 142's reaper, or 143's sweep.
--
-- It also does NOT edit 20260719120000 or 20260720120000. Those files are applied
-- and are never touched; this is a NEW file layered on top of them, which is what
-- the requirement asks for and what the backdated-migration guard requires.
--
-- It creates NO new callable SQL surface — the body is an INLINE dollar-quoted
-- literal, not a function, so there is no SECURITY DEFINER surface, no EXECUTE
-- grant, and no caller-suppliable interval. That is deliberate: a caller-supplied
-- INTERVAL on a cross-tenant job is the 20260516170100 incident class (any caller
-- passes one second and the mechanism fires on every tenant's healthy rows). The
-- parameter IS the attack surface.
--
-- Idempotency
-- -----------
-- TWO distinct properties, do not conflate them.
--   RE-APPLY of this migration: unschedule-if-exists then schedule is the
--   canonical repo pattern (20260720120000:58-60, 20260802120000:447-450,
--   20260816140000:603-605). cron.schedule upserts by name, so re-applying this
--   whole file replaces the body rather than adding a second job, and STEP 2
--   asserts exactly ONE row carries this jobname.
--   RE-RUN of the body: terminalization is idempotent by predicate. Tick 1 moves
--   the row out of `running`, so tick 2's batch cannot see it — both the batch
--   predicate and the compare-and-set fence exclude it independently. Running the
--   body twice against the same row writes it exactly once. That is a property of
--   the predicate, not of any conflict clause, and there is no conflict clause
--   here to credit for it.
--
-- ⭐ THE JOBNAME IS UNCHANGED, ON PURPOSE. retention_compute_jobs_orphaned_running
-- keeps the SAME NAME, and supabase/tests/test_retention_orphaned_running.sql keeps
-- guarding that name. Renaming would strand both: the old job would keep running the
-- removal body under its old name while the gate followed the new one.
--
-- ⚠️ CORRECTED 2026-08-17 BY MEASUREMENT (this comment previously claimed the job
-- "keeps its deployed jobid on both projects" — that is FALSE and is recorded rather
-- than quietly deleted). `cron.unschedule` + `cron.schedule` DROPS the old row and
-- INSERTS a new one, so pg_cron assigns a FRESH jobid. Observed on TEST at apply
-- time: jobid 11 -> 19. PROD will likewise move off its current jobid 29 when this
-- merges.
--
-- Two things follow, and neither breaks anything:
--   1. The **jobname is the stable identifier**, not the jobid. That is exactly why
--      the SQL gate anchors on jobname and never on a numeric id — verified: there
--      is no `jobid` reference anywhere in test_retention_orphaned_running.sql.
--   2. Any prose elsewhere calling this "jobid 11" is now stale for TEST and was
--      NEVER true of PROD (which has always been jobid 29). ROADMAP.md and
--      REQUIREMENTS.md carry that phrasing under JOB-08; it is descriptive there,
--      not load-bearing, and is corrected in the same commit as this note.
--
-- Convention deviation (pre-documented so review does not re-litigate)
-- -------------------------------------------------------------------
-- .claude/agents/migration-reviewer.md invariant #14 forbids BEGIN/COMMIT in a
-- migration and rates session-level SET as HIGH. This file uses BOTH deliberately:
-- the overwhelming majority of migrations in this repo use BEGIN/COMMIT, including
-- both pg_cron janitor analogs (20260719120000, 20260720120000) and the two direct
-- templates for this file (20260802120000:209-210, 20260816140000:577-578), and
-- those analogs set lock_timeout = '5s' at session level. Per project Rule 11
-- (conformance over taste inside the codebase) and Rule 7 (pick one side, never
-- blend), the repo convention wins and the reviewer doc is stale. That staleness is
-- a backlog item, not fixed here. This is the ONLY sanctioned deviation.
--
-- Every other invariant was checked. APPLICABLE and satisfied:
--   #1  timestamp filename -- 14-digit prefix 20260817120000, strictly greater
--       than the repo tip 20260816140000 (verified 2026-08-17), so #2's
--       backdated-migration guard passes without an allowlist entry.
--   #11 no applied migration is edited -- this is a new file.
--   #15 JSONB -- no JSONB is written at all (metadata is untouched).
--   #16 template-artifact scan -- no placeholder, no unfinished-work marker, no
--       angle-bracket substitution token, no lorem text anywhere in this file.
--   #21 every RAISE format string is a SINGLE LITERAL with no concatenation in the
--       format slot; values are passed as arguments.
--
-- VACUOUSLY satisfied, and said out loud rather than left for a reviewer to infer
-- -- this migration creates no function, no policy, no view, no index and no
-- column:
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
-- There is NO cron -> Sentry bridge in this repo and this migration does not build
-- one. And the run log is WEAKER than it looks:
--
--     SELECT d.start_time, d.status, d.return_message
--       FROM cron.job_run_details d
--       JOIN cron.job j ON j.jobid = d.jobid
--      WHERE j.jobname = 'retention_compute_jobs_orphaned_running'
--      ORDER BY d.start_time DESC
--      LIMIT 50;
--
-- ⛔ return_message carries the COMMAND TAG, not RAISE NOTICE text. Measured by
-- direct observation on 2026-08-17 (Phase 143's first live tick returned the bare
-- tag; recorded at 20260816140000:517-533). pg_cron stores the command tag of the
-- last statement, not the session's NOTICE stream. So the run log tells you a tick
-- RAN and whether it SUCCEEDED; it does not tell you how many rows moved. This
-- body therefore raises no count NOTICE at all — building an operator process on
-- reading a number out of that column would be building on a falsified premise.
--
-- ⇒ To count what a tick actually terminalized, query the ROWS:
--     SELECT count(*) FROM public.compute_jobs
--      WHERE status = 'failed_final'
--        AND last_error LIKE 'orphaned_running_reaped:%'
--        AND updated_at >= <tick start_time>;
--   Whatever surfaces in the run log carries no strategy id, no user id and no row
--   data. cron.job_run_details is operator-visible and this repository is public.
--
-- PROD-AUTO-APPLY WARNING
-- -----------------------
-- ⛔ Merging supabase/migrations/** to main AUTO-APPLIES to PROD
-- (khslejtfbuezsmvmtsdn). There is no separate deploy step and no confirmation
-- prompt. Apply to TEST (qmnijlgmdhviwzwfyzlc) FIRST, run
-- supabase/tests/test_retention_orphaned_running.sql, and inspect at least ONE
-- REAL TICK in cron.job_run_details before merge. On TEST that tick runs against
-- ~396 genuinely stuck rows, so it is also the live proof of the per-tick bound
-- that no offline harness can give. PROD's `running` population was measured at
-- ZERO on 2026-08-17, so the first PROD tick will move nothing — that is the safe
-- outcome, and it is also why PROD quietness is NOT evidence that the mechanism
-- works. Re-run the census before merge; a dated census is a claim, not a fact.
--
-- Prose hygiene
-- -------------
-- This header DISCUSSES, by name, tokens that STEP 2 asserts are ABSENT from the
-- deployed body — the removal keyword, the claimable terminal status, the enqueue
-- RPC, the preserved worker-id column. Those two facts coexist only because every
-- mechanical gate in this phase scopes itself to the cron BODY: read back out of
-- cron.job for the self-verify and for the SQL gate, extracted by a
-- dollar-tag-delimited regex for the file-text gate. Keep every forbidden token
-- OUT of the body literal (comments inside it included), and keep every gate
-- scoped to the body. Prose must neither satisfy nor trip a mechanical gate.
--
-- ⚠️ AND THAT CUTS BOTH WAYS — which is why the body's dollar tag is spelled out
-- nowhere in this header. The file-text gates extract the body with a non-greedy
-- regex between the FIRST and SECOND occurrence of that tag, so a prose pair would
-- match first and the "extracted body" would be a span of COMMENTS containing no
-- statement at all, under which every negative assertion passes vacuously. Phase
-- 143 hit exactly that and caught it only via an anti-vacuity guard. Never write
-- the opening tag in a comment in this file.
--
-- ⚠️ THE COUNTS IN STEP 2 ARE SIBLINGS. supabase/tests/test_retention_orphaned_
-- running.sql Part 1 makes the same counts, and Phase 144 Plan 02 adds a third
-- copy in src/__tests__. If a future edit legitimately changes how many times the
-- body names a token, ALL of them move in the SAME commit. A one-file scope
-- amendment leaves a gate guarding a superseded body while staying green.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: JOB-05 -- re-register the orphaned-running janitor as a TERMINALIZER
-- --------------------------------------------------------------------------
-- Fail loud if pg_cron is absent (never a silent skip -- a migration RAISEs).
-- ⚠️ Do NOT copy the ELSE arm at 20260717233529:288, which RAISE NOTICEs and
-- carries on. That is the older, silent-skip convention: it would let this
-- migration report success while scheduling nothing, leaving the REMOVAL body of
-- 20260720120000 deployed behind a green apply. Project Rule 12 is fail loud.
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'JOB-05/WR-02: pg_cron extension is NOT installed. The orphaned-running terminalizer cannot be registered, so orphaned running compute_jobs would stay running forever: every poller on them spins indefinitely, the audit trail is never written, and Phase 142 reaper stays blocked from writing the user-facing analytics failure. Install pg_cron via Supabase Dashboard -> Database -> Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Idempotent unschedule-then-schedule against the EXISTING jobname (see the
  -- header: keeping the NAME is what keeps the shipped SQL gate continuous).
  -- ⚠️ It does NOT keep the jobid — measured 2026-08-17, TEST went 11 -> 19 across
  -- this apply, because unschedule DROPs the row and schedule INSERTs a new one.
  -- Nothing depends on the id: the gate anchors on jobname.
  -- cron.schedule upserts by name, so the unschedule is belt-and-braces;
  -- STEP 2 asserts exactly one row survives.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running') THEN
    PERFORM cron.unschedule('retention_compute_jobs_orphaned_running');
  END IF;

  -- The body is an INLINE FIXED LITERAL: no function, no interpolation, no
  -- EXECUTE format(), no dynamic SQL, and every table schema-qualified to public.*
  -- so resolution is independent of the cron session's search_path.
  --
  -- TWO ARMS, TWO STATEMENTS, ONE BLOCK. Each arm is a MATERIALIZED batch CTE
  -- feeding a terminal UPDATE:
  --   ARM A -- claimed orphans, keyed on claimed_at past the UNCHANGED 4-hour
  --            window (RT-01; the threshold, not the frequency, is what protects a
  --            live batch-tail job). ORDER BY claimed_at ASC makes the bounded
  --            batch deterministic (oldest-orphaned first), which is what
  --            guarantees forward progress across ticks and lets a gate seed a
  --            century-old row and know it wins the budget on a shared project.
  --   ARM B -- never-stamped claims, keyed on created_at past the DERIVED 48-hour
  --            window (see the header derivation and its honesty note).
  -- Both arms:
  --   FOR UPDATE SKIP LOCKED -- never block a live writer; skip and take it next
  --                             tick.
  --   the trailing AND cj.status = 'running' -- a COMPARE-AND-SET FENCE. If a real
  --                             writer terminalizes the row between the batch
  --                             subselect and the UPDATE, this janitor writes
  --                             nothing (142's pattern, 20260802120000:494-496).
  -- ⚠️ status = 'running' is written with SINGLE SPACES in all four places and must
  -- stay that way: the shipped gate anchors on that exact spelling, and TEST and
  -- PROD md5s already differ today purely because of whitespace.
  PERFORM cron.schedule(
    'retention_compute_jobs_orphaned_running',
    '50 * * * *',
    $cron$
    DO $sweep$
    BEGIN
      WITH batch AS MATERIALIZED (
        SELECT id
          FROM public.compute_jobs
         WHERE status = 'running'
           AND claimed_at IS NOT NULL
           AND claimed_at < now() - interval '4 hours'
         ORDER BY claimed_at ASC
         LIMIT 100
         FOR UPDATE SKIP LOCKED
      )
      UPDATE public.compute_jobs cj
         SET status          = 'failed_final',
             next_attempt_at = now(),
             error_kind      = 'permanent',
             last_error      = 'orphaned_running_reaped: no worker completed this job within the 4h claim window'
        FROM batch b
       WHERE cj.id = b.id
         AND cj.status = 'running';

      WITH batch AS MATERIALIZED (
        SELECT id
          FROM public.compute_jobs
         WHERE status = 'running'
           AND claimed_at IS NULL
           AND created_at < now() - interval '48 hours'
         ORDER BY created_at ASC
         LIMIT 100
         FOR UPDATE SKIP LOCKED
      )
      UPDATE public.compute_jobs cj
         SET status          = 'failed_final',
             next_attempt_at = now(),
             error_kind      = 'permanent',
             last_error      = 'orphaned_running_reaped: running with no claim stamp (invariant violation) older than 48h'
        FROM batch b
       WHERE cj.id = b.id
         AND cj.status = 'running';
    END
    $sweep$;
    $cron$
  );

  RAISE NOTICE 'JOB-05/WR-02: retention_compute_jobs_orphaned_running re-registered as a TERMINALIZER (hourly at minute 50; arm A claimed_at past 4h, arm B NULL-claim created_at past 48h; LIMIT 100 per arm per tick; rows survive as failed_final).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: self-verify -- the DEPLOYED cron body (JOB-05)
-- --------------------------------------------------------------------------
-- Read back out of cron.job, never re-typed. Every failure message NAMES THE
-- CONSEQUENCE, not merely the missing token: a gate whose message says "token
-- absent" teaches the next reader nothing about why they must not do it again.
--
-- ⚠️ Every occurrence COUNT below is calibrated to a TWO-ARM body. Phase 143's
-- siblings were calibrated to a one-arm body and their numbers are NOT
-- transferable. Each count states which occurrence is which, so a future edit can
-- see immediately whether a changed number is legitimate.
DO $$
DECLARE
  v_command  TEXT;
  v_schedule TEXT;
  v_count    INTEGER;
  v_jobs     INTEGER;
  v_running  INTEGER;
  v_terminal INTEGER;
  v_next     INTEGER;
  v_reason   INTEGER;
  v_win_a    INTEGER;
  v_win_b    INTEGER;
  v_mat      INTEGER;
  v_order    INTEGER;
  v_limit    INTEGER;
BEGIN
  SELECT count(*) INTO v_count
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'JOB-05 verification failed: expected exactly ONE cron job named retention_compute_jobs_orphaned_running, found %. Two rows would run the janitor twice an hour and double the per-tick blast radius the LIMIT exists to cap; zero means the orphaned-running population is unattended entirely.', v_count;
  END IF;

  SELECT command, schedule
    INTO v_command, v_schedule
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';

  IF v_command IS NULL THEN
    RAISE EXCEPTION 'JOB-05 verification failed: the retention_compute_jobs_orphaned_running job row carries a NULL command. pg_cron would fire an empty tick every hour and the run log would look healthy while every orphan stayed running forever.';
  END IF;

  -- STRING equality, never a ::INT cast on a schedule field. Four of the five
  -- fields are now '*', and casting one of them raises 22P02 -- an opaque hard
  -- error instead of a named assertion. That exact break is why the shipped gate's
  -- hour-band check had to be replaced in the same commit as this migration.
  IF v_schedule IS DISTINCT FROM '50 * * * *' THEN
    RAISE EXCEPTION 'JOB-05 verification failed: the deployed cadence is % and not the expected 50 * * * *. Minute 50 is what keeps this janitor off 142 reaper quarter-hour grid, off 143 sweep at :35, and 10 minutes clear of the :00 stack; a daily cadence would also put post-threshold detection latency back at ~24h.', v_schedule;
  END IF;

  -- ----- POSITIVE anchors and occurrence COUNTS on the DEPLOYED body -----
  -- 4 = arm A batch CTE + arm A UPDATE target + arm B batch CTE + arm B UPDATE
  -- target. A bare presence test could not fail here: any ONE surviving reference
  -- satisfies it, so deleting an entire arm would pass unnoticed.
  v_jobs := (length(upper(v_command)) - length(replace(upper(v_command), 'PUBLIC.COMPUTE_JOBS', ''))) / length('PUBLIC.COMPUTE_JOBS');
  IF v_jobs <> 4 THEN
    RAISE EXCEPTION 'JOB-05 verification failed: the deployed body names public.compute_jobs % times, expected 4 (arm A batch + arm A UPDATE target + arm B batch + arm B UPDATE target). Two usually means a WHOLE ARM IS GONE -- if it is arm B, NULL-claim running rows become immortal again exactly as they were for 14 days on TEST; if it is arm A, no claimed orphan is ever terminalized and the poller spins forever. Zero means the janitor no longer touches the table at all.', v_jobs;
  END IF;

  -- 4 = two batch predicates + two compare-and-set fences. Single-spaced, because
  -- the shipped SQL gate anchors on that exact spelling.
  v_running := (length(upper(v_command)) - length(replace(upper(v_command), 'STATUS = ''RUNNING''', ''))) / length('STATUS = ''RUNNING''');
  IF v_running <> 4 THEN
    RAISE EXCEPTION 'JOB-05 verification failed: the deployed body scopes to status = ''running'' % times, expected 4 (one predicate and one compare-and-set fence per arm). Losing a PREDICATE widens the janitor to every status -- it would terminalize done and pending rows. Losing a FENCE removes the protection against a real writer that terminalizes the row between the batch subselect and the UPDATE, so this janitor would overwrite a genuine outcome with a fabricated one.', v_running;
  END IF;

  -- 2 = one terminal status per arm.
  v_terminal := (length(upper(v_command)) - length(replace(upper(v_command), '''FAILED_FINAL''', ''))) / length('''FAILED_FINAL''');
  IF v_terminal <> 2 THEN
    RAISE EXCEPTION 'JOB-05 verification failed: the deployed body writes ''failed_final'' % times, expected 2 (one per arm). failed_final is the ONLY terminal-failure value that is both outside the claimable set (so the row can never be re-claimed) and outside Phase 142 reaper exclusion set (so terminalizing UNBLOCKS the user-facing analytics message). Any other value moves the row without moving the outcome.', v_terminal;
  END IF;

  -- 2 = B3, one per SET list. This is the assertion that keeps the audit trail
  -- from being 89 days shorter than this phase promises.
  v_next := (length(upper(v_command)) - length(replace(upper(v_command), 'NEXT_ATTEMPT_AT', ''))) / length('NEXT_ATTEMPT_AT');
  IF v_next <> 2 THEN
    RAISE EXCEPTION 'JOB-05/B3 verification failed: the deployed body writes next_attempt_at % times, expected 2 (one per SET list). retention_compute_jobs_failed deletes on COALESCE(next_attempt_at, created_at) older than 90 days (20260515210200:255-259) and the claim RPC never advances that column, so a status-only flip lets an old orphan be collected on the very NEXT 03:30 tick -- terminalized at 04:50, gone by 03:30, and the audit trail this phase exists to preserve lasts eleven hours instead of ninety days.', v_next;
  END IF;

  IF v_command NOT ILIKE '%error_kind%' THEN
    RAISE EXCEPTION 'JOB-05 verification failed: the deployed body does not set error_kind. get_user_compute_jobs synthesises its user-facing message from (status, error_kind), so a terminalized row with a NULL error_kind renders the vaguer "tried multiple times without success" arm rather than the accurate permanent-failure one.';
  END IF;
  IF v_command NOT ILIKE '%''permanent''%' THEN
    RAISE EXCEPTION 'JOB-05 verification failed: the deployed body does not classify the failure as permanent. permanent is the documented value for "skip retries, go directly to failed_final" (20260411144407:159-160); anything else misdescribes an orphan as retryable on the one surface that reads the pair.';
  END IF;

  -- 2 = one fixed audit literal per arm.
  v_reason := (length(upper(v_command)) - length(replace(upper(v_command), 'ORPHANED_RUNNING_REAPED', ''))) / length('ORPHANED_RUNNING_REAPED');
  IF v_reason <> 2 THEN
    RAISE EXCEPTION 'JOB-05 verification failed: the deployed body stamps the orphaned_running_reaped audit reason % times, expected 2 (one fixed literal per arm). last_error is the ONLY operator-visible record of why a row was terminalized -- it is hard-redacted from users at the RPC and zod layers -- so without it an operator cannot tell a reaped orphan from a genuine handler failure.', v_reason;
  END IF;

  -- 1 = arm A only. SC#2: the RT-01 window is UNCHANGED by this migration.
  v_win_a := (length(upper(v_command)) - length(replace(upper(v_command), 'INTERVAL ''4 HOURS''', ''))) / length('INTERVAL ''4 HOURS''');
  IF v_win_a <> 1 THEN
    RAISE EXCEPTION 'JOB-05/SC#2 verification failed: the deployed body carries the 4-hour claim window % times, expected exactly 1 (arm A). Zero means the RT-01-corrected threshold is gone: a full batch of 5 jobs shares one claim stamp and dispatches sequentially at up to 30 min each, so a HEALTHY worker legitimately holds a 2.5h-old claim and a narrower window would terminalize a live in-flight job out from under it. More than one means a second arm has imported a threshold that was derived for a different mechanism.', v_win_a;
  END IF;

  -- 1 = arm B only, and it must NOT equal arm A's number.
  v_win_b := (length(upper(v_command)) - length(replace(upper(v_command), 'INTERVAL ''48 HOURS''', ''))) / length('INTERVAL ''48 HOURS''');
  IF v_win_b <> 1 THEN
    RAISE EXCEPTION 'JOB-05/D-08 verification failed: the deployed body carries the derived 48-hour NULL-claim window % times, expected exactly 1 (arm B). Zero means arm B is gone or has copied arm A 4-hour figure -- and 4h is a CLAIM-age bound that says nothing about a row that was never claimed. The 48h figure is 24h enqueue cadence plus 2.5h max batch wall-clock, rounded up to the next whole cadence multiple.', v_win_b;
  END IF;

  IF v_command ILIKE '%interval ''2 hours''%' THEN
    RAISE EXCEPTION 'JOB-05/RT-01 verification failed: the deployed body carries the OLD 2-hour window that migration 20260720120000 corrected away. Under it a healthy worker batch-tail job -- legitimately in flight with a 2.5h-old claim stamp -- is terminalized while it is still running, so its side effects land against a row that has left the in-flight set and a duplicate job can be enqueued alongside it.';
  END IF;

  IF v_command NOT ILIKE '%claimed_at IS NULL%' THEN
    RAISE EXCEPTION 'JOB-05/D-08 verification failed: the deployed body has no claimed_at IS NULL arm. Those rows are invisible to a claimed_at threshold in BOTH directions -- the shipped body excluded them by name and NULL < x is never TRUE anyway -- so without this arm the running rows that have been stuck longest are precisely the ones nothing can ever clear.';
  END IF;

  -- 2 = one deterministic ordering per arm. The ORDER BY is what makes the bounded
  -- batch drain oldest-first and therefore progress across ticks; losing it is a
  -- real defect, not a style change.
  v_order := (length(upper(v_command)) - length(replace(upper(v_command), 'ORDER BY', ''))) / length('ORDER BY');
  IF v_order <> 2 THEN
    RAISE EXCEPTION 'JOB-05 verification failed: the deployed body orders its bounded batches % times, expected 2 (arm A by claimed_at ASC, arm B by created_at ASC). Without a deterministic ordering the LIMIT selects an ARBITRARY subset each tick, so the oldest orphans can be skipped indefinitely while the batch stays full -- bounded but never progressing.', v_order;
  END IF;

  -- ⚠️ SHAPE gate, NOT a bound proof. Measured in Phase 143: removing this keyword
  -- from a LOCKING CTE changes neither plan nor result. It is retained because it
  -- survives a future edit that drops FOR UPDATE, at which point the CTE would
  -- become inlinable. The BOUND is proven only by executing the body against 101
  -- real rows (144-01 offline, 144-03 live) -- never by this counter.
  v_mat := (length(upper(v_command)) - length(replace(upper(v_command), 'AS MATERIALIZED', ''))) / length('AS MATERIALIZED');
  IF v_mat <> 2 THEN
    RAISE EXCEPTION 'JOB-05/D-19 verification failed: the deployed body carries % MATERIALIZED batch CTEs, expected exactly 2 (one per arm). The explicit fence is what keeps each bound safe against a future edit that drops FOR UPDATE and makes the CTE inlinable -- at which point the LIMIT would be re-applied per outer row and the per-tick blast radius would silently become unbounded. This is shape enforcement; the executed 101-row proof is the bound proof.', v_mat;
  END IF;

  IF v_command NOT ILIKE '%FOR UPDATE SKIP LOCKED%' THEN
    RAISE EXCEPTION 'JOB-05 verification failed: the deployed body dropped FOR UPDATE SKIP LOCKED, so a batch would BLOCK on any row a live writer holds instead of skipping it and taking it next tick. Under the 5s lock_timeout this turns a contended tick into a failed tick.';
  END IF;

  -- The per-tick BOUND itself, WORD-BOUNDED and COUNTED.
  -- ⚠️ The word-bounding is not decoration: '... LIMIT 1000 ...' ILIKE
  -- '%LIMIT 100%' is TRUE, so a substring test would pass over a 10x widening of
  -- the blast radius. That defect was MEASURED in Phase 143 against LIMIT 25 /
  -- LIMIT 2500 and fixed in all three of its gates. The trailing ([^0-9]|$)
  -- alternation is required, not decorative: without the `|$` arm a body ending
  -- exactly at the limit would false-RED.
  -- The COUNT is the second half: the `!~` test alone is satisfied by ONE
  -- word-bounded match, so widening only ONE arm would slip past it.
  IF v_command !~ 'LIMIT[[:space:]]+100([^0-9]|$)' THEN
    RAISE EXCEPTION 'JOB-05/D-19 verification failed: the deployed body carries no word-bounded LIMIT 100. Either the per-arm bound is gone entirely -- one tick would then terminalize the WHOLE orphan population in a single statement, holding row locks and firing the updated_at trigger across every row at once -- or it has been widened to LIMIT 100<digits>, which multiplies the per-tick blast radius while still containing the literal substring a naive substring gate tests for.';
  END IF;
  SELECT count(*) INTO v_limit
    FROM regexp_matches(v_command, 'LIMIT[[:space:]]+100([^0-9]|$)', 'g');
  IF v_limit <> 2 THEN
    RAISE EXCEPTION 'JOB-05/D-19 verification failed: the deployed body carries % word-bounded LIMIT 100 clauses, expected exactly 2 (one per arm). One means a single arm has been widened or unbounded while the other still satisfies the pattern test -- the per-arm cap is the whole bound, so half a bound is no bound for the arm that lost it.', v_limit;
  END IF;

  -- ----- NEGATIVE anchors on the DEPLOYED body -----
  -- ⭐ THE assertion that makes "never remove a row" mechanically checkable at the
  -- deployed body. Everything else in this phase is prose and intent; this is the
  -- line that fails if the removal body is ever re-deployed under this jobname.
  IF v_command ILIKE '%DELETE%' THEN
    RAISE EXCEPTION 'JOB-05/WR-02 verification failed: the deployed body contains a row-removal statement. This janitor must TERMINALIZE and never remove: a removed row gives the wizard poller no outcome to break out on, destroys the only audit record that a worker was down past its claim window, and on PROD discards a genuine in-flight one-shot job that nothing will re-enqueue. That is the shipped behaviour this migration exists to replace.';
  END IF;
  -- ⚠️ The window between SELECT and LIMIT is '[^;]*', not '[^)]*'. MEASURED in
  -- Phase 143: no realistic predicate can be written without a closing paren
  -- before its LIMIT, so the '[^)]*' form matched nothing and the gate could not
  -- fail. '[^;]*' still bounds the match to a SINGLE statement so it cannot smear
  -- across the two arms and false-RED.
  IF v_command ~* '\mIN\M[[:space:]]*\([[:space:]]*SELECT[^;]*LIMIT' THEN
    RAISE EXCEPTION 'JOB-05/D-19 verification failed: the deployed body binds a bounded batch through an IN (SELECT ... LIMIT ...) subquery. That is the exact un-hashable-subplan shape whose LIMIT is re-applied per outer row, so the per-tick bound silently does not exist -- the defect 20260803130000 was written to fix.';
  END IF;
  IF v_command ILIKE '%failed_retry%' THEN
    RAISE EXCEPTION 'JOB-05 verification failed: the deployed body references failed_retry. That value is CLAIMABLE (20260719073701:204), so the orphan would simply be re-claimed to running on the next worker tick, and it is INSIDE Phase 142 reaper exclusion set (20260803130000:141), so the user-facing analytics message would stay blocked forever. It is the one terminal-looking value that terminalizes nothing.';
  END IF;
  IF v_command ILIKE '%enqueue_compute_job%' THEN
    RAISE EXCEPTION 'JOB-05 verification failed: the deployed body calls the enqueue RPC. This janitor must never create work: for cron-fanned kinds the daily fan-out re-enqueues by itself once terminalization frees the in-flight slot, so a janitor INSERT races it and can collide on the in-flight unique index -- and a RAISE inside a pg_cron block aborts the WHOLE tick, losing the terminalization too. For one-shot kinds a blind re-enqueue turns a poison job that killed the worker into an infinite loop.';
  END IF;
  IF v_command ILIKE '%claimed_by%' THEN
    RAISE EXCEPTION 'JOB-05 verification failed: the deployed body references claimed_by. That column must be PRESERVED, not written: it records which worker last held the row and is the forensic starting point for any orphan investigation. Audit M-0779 deliberately stopped mark_compute_job_failed from clearing it (20260516104201:917-928); a janitor that clears it re-opens that finding.';
  END IF;

  RAISE NOTICE 'JOB-05: retention_compute_jobs_orphaned_running self-verify passed (single job, 50 * * * * cadence, 4 public.compute_jobs references, 4 running-status anchors, 2 failed_final writes, 2 next_attempt_at writes, 2 audit reasons, 1x 4-hour + 1x 48-hour window, 2 ORDER BY, 2 MATERIALIZED batches, 2 word-bounded LIMIT 100, SKIP LOCKED present, and no removal statement, IN-subquery LIMIT, failed_retry, enqueue RPC or claimed_by write).';
END $$;

COMMIT;
