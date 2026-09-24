-- Migration: both ledger-refresh fan-outs COUNT the candidates whose enqueue
-- failed, and record which ones, instead of reporting a clean tick over a
-- swallowed per-candidate failure.
-- Phase 164.6 / plan 03 (TODOS.md OPS-08-F2, ROADMAP Phase 164.6 criterion 3).
-- 2026-09-24.
--
-- ⚠️ OPS: merging supabase/migrations/** to main applies this file to shared
-- TEST FIRST (supabase-migrate.yml `apply-test`) and then AUTO-APPLIES it to
-- PROD once that TEST apply succeeds. There is NO human stop between the merge
-- and the PROD apply (founder decision 2026-09-23), so every review this file
-- needs happens BEFORE the merge. It redefines TWO SECURITY DEFINER functions;
-- the single-key one is LIVE on PROD (scheduled as `ledger_refresh_fanout`
-- since Phase 164.5.1), so its new body runs on the first tick after the merge.
--
-- ⛔ IT IS A FORWARD MIGRATION AND NOT AN EDIT TO AN APPLIED ONE.
-- 20260917120000_ledger_fanout_admit_private.sql (the live single-key body) and
-- 20260911130000_ledger_fanout_grantees_and_dormancy.sql (the live composite
-- body) are applied on PROD and on shared TEST. Both bodies are RE-BASED here,
-- never rewritten there. An applied migration stays byte-identical.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHAT WAS WRONG — the per-candidate handler swallowed and nobody counted
-- ══════════════════════════════════════════════════════════════════════════
-- Each fan-out loops over its candidates and wraps every enqueue in its own
-- EXCEPTION WHEN OTHERS handler, so one poisoned candidate cannot kill the tick.
-- That handler is right and stays. What it did with the failure was a WARNING,
-- and a WARNING from a pg_cron tick has NO CONSUMER: pg_cron keeps no WARNING
-- output and no prober arm reads the server log. The tick then returned the
-- number of jobs it DID insert and pg_cron recorded `succeeded`, so a candidate
-- that failed every hour was indistinguishable from one that was never stale.
--
-- WHAT CHANGES (decisions D-10, D-11 and D-12 of Phase 164.6):
--   * the handler COUNTS the failure and RECORDS the failed candidate's id and
--     SQLSTATE in two locals. Assignments only, the dormancy handler's rule.
--   * after the loop, and AFTER the advisory lock is released, a tick with at
--     least one failure writes ONE public.cron_runs row: cron_name
--     'ledger_refresh_fanout', status 'error', error 'candidate_enqueue_failed',
--     metadata {function, cause, failed_count, enqueued_count, failed_targets}.
--     A tick with no failure writes NOTHING, the dormancy instrument's
--     "healthy writes nothing" rule.
--   * the RETURN value is UNCHANGED and still means "jobs actually INSERTED
--     this tick" (the founder reads it back per
--     docs/runbooks/ledger-refresh-go-live.md). The failure count sits BESIDE
--     it, in the row and in the closing NOTICE, never instead of it.
--
-- ⛔ REJECTED, and why (D-10): changing the return type needs a DROP FUNCTION,
-- breaks the scheduled command and every gate that reads the integer. RAISING
-- at the end of a tick that had failures rolls back the enqueues that DID
-- succeed, turning one poisoned row back into a lost tick: the exact thing the
-- per-candidate handler exists to prevent. ⭐ The round-1 review fix raised
-- ONLY on a tick that enqueued NOTHING, where there is no good enqueue to
-- lose; the round-2 review fix removed that raise too (see the next section),
-- and the one raise left is a failure row that cannot itself be written on a
-- tick that enqueued nothing.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE 164.6 REVIEW FIX — four more behaviours, same file, before any apply
-- ══════════════════════════════════════════════════════════════════════════
-- This file was edited IN PLACE by the phase's own review fix, before it was
-- merged or applied anywhere; it is still one forward migration. The three
-- reviewers (164.6-MIGRATION-REVIEW.md) found four ways the instrument above
-- could still leave a failure unseen or self-perpetuating, and each is closed
-- in BOTH bodies:
--   * HIGH-1, the failure row now has a reader. ⛔ SUPERSEDED IN THE ROUND-2
--     REVIEW FIX (164.6-REVIEW-R2 WR-01, 164.6-REVIEW-SFH-R2 N2/N3): round 1
--     made a tick in which EVERY selected candidate failed RAISE at its end.
--     That raise rolled back the tick's own failure row, so on exactly the
--     tick HIGH-2 names (two poisoned candidates holding one venue's cap, or
--     the composite cohort's burst cap) the cooldown below could never
--     engage, and the healthy candidates behind them starved for good. The
--     raise is GONE from both bodies. Every tick with a failure commits its
--     row, all-fail included, and the prod prober's cron-obs arm
--     (scripts/prod-prober/arms/cron-obs.mjs) counts those rows directly by
--     `error` and `completed_at`, never reading `metadata`. That read also
--     sees a tick that failed only PARTLY, which the raise never did.
--   * HIGH-2 (and the migration-reviewer LOW), a candidate named in a failure
--     row written inside the last 20 hours is excluded from selection, the
--     same window the attempt cooldown uses. A poisoned candidate therefore
--     stops taking a slot every tick, and a healthy one takes it.
--   * MEDIUM-1, a failure-row write that itself fails on a tick that enqueued
--     nothing is re-raised with its own SQLSTATE under a message naming the
--     function, instead of leaving only a WARNING. On a tick that DID enqueue,
--     it stays a WARNING: raising there would roll the good enqueues back.
--   * MEDIUM-2, a lost enqueue race (serialization_failure, 40001) is caught
--     BEFORE the catch-all and counted apart as `lost_race_count`. It is not
--     a failure: it names nothing, writes no row by itself and puts nothing
--     on the cooldown. ⚠️ NARROWED IN THE ROUND-2 REVIEW FIX (L3 / IN-05): a
--     deadlock (40P01) was counted here too, but its other party can be any
--     lock holder, so nothing guarantees another enqueue is serving the
--     candidate. It now falls to the catch-all and is counted, named and
--     cooled down like any other failure.
-- Each has its own arm in both ledger gates (U; T; V1 and V2; W and
-- W/deadlock), and IN-02
-- split arm N's precision and boundary halves into arms N2 and N3 so each has
-- its own twin. The apply-time block gained two needles (checks 10d and 10e)
-- and check 7 now asserts the exact count of heartbeat writes.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — the TWO PROD bodies these CREATE OR REPLACEs overwrite
-- ══════════════════════════════════════════════════════════════════════════
-- TWO entries, because exactly two function bodies are replaced.
--
-- The gate compares the COMMITTED SNAPSHOT (supabase/schema/functions/) against
-- PROD's live body. On any function-changing migration PR the two necessarily
-- disagree: `snapshot-drift` requires the snapshot to carry the body the
-- MIGRATIONS produce (the new one), while VAC-04 requires it to match what PROD
-- has TODAY (the old one). The pragma is the designed resolution, and it means
-- "I read PROD's body and intend to overwrite it".
--
-- MEASURED 2026-09-24, reproduced LOCALLY with the gate's own normalizer,
-- aiming its `live` argument at origin/main's snapshot rather than at PROD:
--
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/<name>.sql <origin/main's copy of that file>
--
-- ⭐ THE ACKED HASH IS THE `live` COLUMN OF --diff-bodies (the FIFTH TSV field,
-- which scripts/prod-body-drift-check.sh reads into `live_hash` and greps for
-- as a fixed string), NEVER `--hash` OF A FILE: a whole-file digest would read
-- to a human exactly like an ack and be invisible to the gate. Both values
-- below were re-measured after the snapshots were regenerated from this file;
-- each is the normalized body origin/main carries today for that function.
--
--   enqueue_ledger_refresh_for_strategies/0
-- prod-body-ack: e7e990177dcfb202dce3e94f84499db57a8050bf34cee416c19c014168ce30c9
--   enqueue_ledger_composite_refresh/0
-- prod-body-ack: d1ca610205631993bdc49d6b9ff06672a6aa7d6259ac0fdd94d4e6a794b76152
--
-- ⚠️ EACH ACK IS OF origin/main, WHICH STANDS IN FOR PROD. It is EARNED only if
-- VAC-04 on the PR reports that SAME hash for PROD for that function. If either
-- differs, PROD drifted OUT OF BAND for it, and the correct action is to FOLD
-- the difference into this migration and RE-DERIVE, never to edit the pragma
-- to match a gate log.
--
-- ══════════════════════════════════════════════════════════════════════════
-- RE-BASE DISCIPLINE (DRIFT-02)
-- ══════════════════════════════════════════════════════════════════════════
-- The LEFT side of BOTH re-bases is the COMMITTED SNAPSHOT, the artifact the
-- PROD-body gate compares against, and NOT any migration's text:
--   * supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql
--     (source migration 20260917120000), and
--   * supabase/schema/functions/enqueue_ledger_composite_refresh.sql
--     (source migration 20260911130000).
-- MEASURED 2026-09-24 before writing a line: the newest migration in
-- supabase/migrations/ was 20260922120000, and no migration newer than those
-- two sources defines either function.
--
-- FOUR EXECUTABLE EDITS were made to EACH body, the same four in both, and
-- every other line is the snapshot's byte for byte: the activation guard and
-- its dormancy instrument, the advisory lock and its unlock-before-re-raise
-- arm, the candidate CTE, the burst literals with their leading whitespace, the
-- insertions-not-calls counter, and the dollar-quote TAG.
--   (a) DECLARE gains two locals: the failure count (INTEGER, starting at 0)
--       and the failed-target list (JSONB, starting as an empty array).
--   (b) the per-candidate EXCEPTION WHEN OTHERS handler gains two ASSIGNMENTS,
--       one bumping the count and one appending {strategy_id, sqlstate} to the
--       list. Its existing WARNING line is kept BYTE-IDENTICAL: the fan-out
--       gate's arm R mutates that exact line and docs/runbooks/match-engine.md
--       reads its text. No DML goes in the handler.
--   (c) after the SUCCESS-PATH unlock, and never inside the lock-holding
--       block, a best-effort-wrapped INSERT of the one failure row, taken only
--       when the count is above zero. Inside that block a failing INSERT would
--       reach its handler, which unlocks and RE-RAISES, and the whole tick
--       would roll back with the good enqueues in it. After the unlock the lock
--       is released on every path by construction, and a failed write costs
--       the row, never the tick.
--   (d) the closing NOTICE names the failure count beside the enqueued count.
--       Counts only, never an identifier (T-161.1-10).
-- A comment block introduces (b) and (c) in each body; it is part of the same
-- edits, not a fifth one.
-- ⭐ The review fix (section above) then added, to each body: a lost-race
-- local and a lost-race handler branch; a failed-attempt conjunct in the
-- candidate CTE; a lost-race key in the failure row; a re-raise in the failure
-- write's handler; and a lost-race count in the closing NOTICE. Round 1 also
-- added a closing all-candidates-failed raise, which round 2 removed again;
-- a comment block now stands where it was, saying why it must not return. The carried comment that cited a line number of
-- the committed dump for "no FORCE on cron_runs" now cites the statement.
-- Plus, outside the bodies: COMMENT ON FUNCTION re-issued for both with one
-- added sentence about the failure row, and the REVOKE re-issued for both.
--
-- ⚠️ Regenerating supabase/schema/functions/ (`npm run schema:functions`) is a
-- REQUIRED step in the SAME commit as this file: VAC-04,
-- `npm run schema:functions:check` and the gates that read the snapshots all
-- read it.
--
-- ══════════════════════════════════════════════════════════════════════════
-- DISJOINTNESS — the needles STEP 3 asserts vs. the strings the gates MUTATE
-- ══════════════════════════════════════════════════════════════════════════
-- A verification needle that a gate arm MUTATES aborts the apply: the gate then
-- never runs, no arm can be the first failure, and the mutation runner scores a
-- defect. WAIVED_CEILING in scripts/mutation-runner/run.mjs is 0 (read it BY
-- SYMBOL) and stays 0, so such an intersection is designed out here.
-- scripts/mutation-runner/GRAMMAR.md records a real instance under its rule 2.
--
-- Every needle carried forward from 20260917120000 and 20260911130000 keeps the
-- disjointness those files measured. The new needles are disjoint by
-- construction: the failure-instrument needle is the quoted metadata KEY of the
-- failed-target list; the ordering needles are the failure row's count KEY and
-- the unlock call; the review fix's two are the failure-row write's own
-- re-raise MESSAGE and the cooldown's heartbeat read, by its alias. ⚠️ The ordering needle was
-- the failure block's opening IF until the review fix gave that IF a gate twin
-- (arm N3); it moved to the count key so the twin cannot abort the apply. Every
-- gate twin against this file mutates an increment, a condition, an interval,
-- a handler condition or a metadata VALUE, never one of those needles, so
-- under each twin the apply survives and the ARM is the first failure.
--
-- ⛔ NO GATE `find` STRING IS REPRODUCED ANYWHERE IN THIS FILE, deliberately.
-- The mutation runner counts `occurrences` over the RAW FILE TEXT, comments
-- included, so a verbatim paste of any arm's needle in this header would be a
-- second occurrence, the arm's measured count would be wrong, and the run
-- would report occurrence-mismatch: the mutation not applied, so the arm not
-- tested. Every twin needle, the handler's new increment statement among them,
-- occurs only in executable body text. The needles STEP 3 uses are ASSEMBLED BY
-- CONCATENATION for the same reason.
--
-- ⛔ CATALOGUE READS ONLY in STEP 3, never a row count
-- ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]); see STEP 3's own note.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHO CAN READ THE FAILED TARGET IDS (D-12), quoted from baseline.sql
-- ══════════════════════════════════════════════════════════════════════════
-- A failed candidate's strategy id is written ONLY into cron_runs.metadata,
-- never into RAISE / NOTICE / WARNING text. What guards that column, as the
-- committed PROD dump records it (supabase/schema/baseline.sql):
--   * ALTER TABLE "public"."cron_runs" ENABLE ROW LEVEL SECURITY;  (no FORCE)
--   * policy "cron_runs_admin_read", FOR SELECT, USING an EXISTS over
--     public.profiles for auth.uid() with is_admin = true;
--   * policy "cron_runs_service_role", USING and WITH CHECK
--     auth.role() = 'service_role';
--   * anon and authenticated hold table GRANTs (SELECT, INSERT, DELETE,
--     MAINTAIN, UPDATE) but NO policy admits them, so they read ZERO rows and
--     write none; service_role holds GRANT ALL.
-- ⇒ the ids are readable by platform admins and by service_role only. The
-- definer writes the row by OWNERSHIP of the table (no FORCE), which is also
-- why FORCE ROW LEVEL SECURITY must never be added to cron_runs: it would
-- silence this instrument and the dormancy instrument together.
-- ⛔ Evidence erasure: TRUNCATE on cron_runs was REVOKEd from anon and
-- authenticated by 20260911130000 STEP 2b; this file does not revisit it.
--
-- ══════════════════════════════════════════════════════════════════════════
-- BLAST RADIUS
-- ══════════════════════════════════════════════════════════════════════════
-- The bounds (per-venue cap, per-tick burst limits, the 20-hour attempt
-- cooldown, the in-flight guard), the lock keys, the activation guard and the
-- return value are all unchanged. The new effects on PROD are three:
--   * AT MOST ONE extra cron_runs row per tick in which a candidate failed,
--     whose failed-target list is bounded by that function's per-tick limit
--     (4 for the single-key body, 2 for the composite);
--   * a candidate named in such a row is skipped for 20 hours, which can only
--     REMOVE candidates from a tick, never add one;
--   * a deadlock (40P01) on an enqueue is now counted as a failure instead of
--     a lost race, so it too is named and cooled down.
-- ⚠️ A tick ends in an ERROR on one new path only: every candidate failed AND
-- the failure row itself could not be written. pg_cron then records that run
-- as failed.
-- The composite fan-out has no schedule; this file registers none and runs
-- neither function.
--
-- ⚠️ A cron_runs row under this cron_name is no longer PROOF of dormancy. Any
-- "is it dormant?" reading must discriminate on `error` (or
-- metadata->>'cause'): the two dormancy causes and 'candidate_enqueue_failed'
-- now share the cron_name.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: the single-key fan-out, re-based with four edits
-- --------------------------------------------------------------------------
-- Re-based on supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql
-- (source migration 20260917120000). The four edits enumerated in the RE-BASE
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
  -- FOUR, for a dormant branch with THREE causes whose single NOTICE cannot tell
  -- two of them apart. v_found is the row count of the activation read and stays
  -- NULL until that read has actually COMPLETED — ⛔ NULL therefore means NEVER
  -- MEASURED, which is NOT the healthy row-present-and-FALSE case and must never
  -- be folded into it; the cause branch below is written NULL-safely for exactly
  -- that reason. v_read_failed is set by the handler after it has nulled the
  -- flag. v_sqlstate carries the failing read's SQLSTATE OUT of the handler,
  -- which is the only place it is defined — 42P01 (the table is gone), 42501
  -- (the privilege was revoked) and a planner fault are three causes with three
  -- different remediations, and the WARNING that already names it is read by
  -- nobody (APPGUC-WARNING-UNINSTRUMENTED-01, this file's own header). v_cause is
  -- the string the instrument row carries. The cause table is in this file's
  -- header, under WR-10.
  v_found       INTEGER := NULL;
  v_read_failed BOOLEAN := FALSE;
  v_sqlstate    TEXT;
  v_cause       TEXT;
  -- ---- the failure instrument's locals (164.6 OPS-08-F2) ---------------
  -- How many candidates failed to enqueue this tick, and which. Filled by
  -- the per-candidate handler (assignments only) and written ONCE, after
  -- the lock is released, by the failure instrument below.
  v_failed         INTEGER := 0;
  v_failed_targets JSONB   := '[]'::jsonb;
  -- ---- the lost-race count (164.6 review fix, MEDIUM-2) -----------------
  -- A candidate whose enqueue raised serialization_failure (40001) lost a
  -- race to another writer that is already serving it. It is counted HERE,
  -- beside the failure count and never in it, so it is never named in the
  -- failed-target list, never put on the failed-attempt cooldown, and never
  -- by itself writes a failure row. ⚠️ A deadlock (40P01) is NOT counted
  -- here since the 164.6 round-2 review fix: see the handler below.
  v_lost_race      INTEGER := 0;
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
    -- ⚠️ The note above says NOTHING BUT ASSIGNMENTS go in this handler. Both of
    -- these ARE assignments, and both are deliberately not a probe, a read or a
    -- write: lint rule R1-exception-handler-probe forbids DML and SELECT INTO
    -- here, and an INSERT in a handler is exactly the shape that rule exists to
    -- keep out of the gate corpus. The cause is RECORDED here and WRITTEN below,
    -- on the dormant path, where a write is legal.
    --
    -- ⛔ THE SQLSTATE IS CAPTURED HERE OR NOWHERE — it is defined only inside an
    -- exception handler. The WARNING above already formats it, and this file's
    -- header MEASURES that WARNING as having no consumer: pg_cron keeps no
    -- WARNING output and no prober arm reads the server log. Computing a value
    -- that separates "the table was dropped" from "the privilege was revoked"
    -- from "the planner faulted" and then discarding it leaves all three causes
    -- reporting the same thing, which is the shape this phase exists to remove.
    v_read_failed := TRUE;
    v_sqlstate    := SQLSTATE;
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
    -- ⛔ `IS DISTINCT FROM 1`, NEVER `= 0`. Control reaches here only when the
    -- read did NOT raise, so v_found holds the count that read produced — unless
    -- the count was never TAKEN, in which case it is still NULL. Under `= 0` a
    -- NULL makes the predicate NULL, the branch is not taken, control falls to
    -- the ELSE, the cause is nulled and NO ROW IS WRITTEN: an UNMEASURED read
    -- would be filed as the healthy row-present-and-FALSE case, silently. That
    -- is the named failure mode of the invariant this whole phase is restoring,
    -- and until check 7b was added the apply-time block COULD NOT catch it:
    -- check 7 asserts only that the instrument INSERT is PRESENT, so deleting
    -- the row-count read above yielded a migration that verified itself green on
    -- the auto-apply-to-PROD route. The NULL-safe form files an unmeasured read
    -- with the other INVISIBLE cause, where it is counted and loud, instead of
    -- with the silent one.
    --
    -- ⭐ AND THE DETECTOR IS BACK, at the apply rather than in the gate. The
    -- NULL-safe form is what made the deletion invisible to the GATES too — the
    -- row now writes under it, so arm M1 no longer reddens (see the A/B below,
    -- which measures exactly that). Check 7b holds a needle over the
    -- `GET DIAGNOSTICS` read ITSELF — named by its SHAPE, never by a needle
    -- number, because the numbering is local to whichever migration last
    -- re-based this body and a number that travels is a claim that rots —
    -- and REFUSES THE APPLY when the line is gone, which
    -- is the one layer the deletion cannot route around. The trade the M-3 fix
    -- made is therefore paid back rather than merely recorded.
    --
    -- ⭐ A/B MEASURED 2026-09-11 on real pg-lanes, because "it would be silent"
    -- is the kind of claim this repo does not take on argument. Delete the
    -- row-count read one line up and run test_ledger_refresh_fanout.sql: with
    -- this NULL-safe form the instrument still writes its row and the gate is
    -- GREEN at exit 0 (15/15 arms), while with `= 0` in its place the SAME
    -- deletion makes arm M1 report "wrote 0 instrument row(s) ... expected
    -- exactly 1" and the lane exits 3. The gate is therefore NOT blind to the
    -- deletion — it is the apply-time block that is — and the difference this
    -- line buys is that the DECLINE keeps reaching a counted row instead of
    -- going quiet the moment the count stops being taken.
    --
    -- ⚠️ RECORDED, not closed: the label then reads "invisible or absent"
    -- for a state that is really "never measured". Naming it separately would
    -- add a fourth cause no gate arm can reach, and an unfalsifiable branch is
    -- the worse trade — the `sqlstate` key below is NULL on this path and the
    -- row-count read is one line up, which is what tells the two apart on
    -- inspection.
    ELSIF v_found IS DISTINCT FROM 1 THEN
      v_cause := 'flag_row_invisible_or_absent';
    ELSE
      v_cause := NULL;
    END IF;
    IF v_cause IS NOT NULL THEN
      -- ⛔ THE SQLSTATE GOES IN `metadata`, NEVER IN `error`. Both ledger gates'
      -- M2 arms count rows whose `error` is EXACTLY the cause string; appending a
      -- diagnostic there breaks that equality and the arm reddens for a reason
      -- unrelated to what it tests. `metadata` carries NO EQUALITY assertion,
      -- which is what makes it the column a new diagnostic can join without
      -- renegotiating a gate. It is NULL on the invisible-or-absent path, by
      -- construction: there was no exception, so there was no SQLSTATE to read.
      --
      -- ⚠️ AMENDED 2026-09-12 — `metadata` now carries a PRESENCE assertion, and
      -- the distinction from an EQUALITY one is the whole reason it could be
      -- added without renegotiating anything. Both gates' M2 arms narrow their
      -- count to rows whose `metadata->>'sqlstate'` IS NOT NULL. Deleting the
      -- key pair below therefore makes M2 count 0 and redden by name, where
      -- before it was read by nothing: check 7's needle is the INSERT's own
      -- statement shape and SURVIVES the deletion intact, so a tidy-up of this
      -- jsonb_build_object call silently collapsed 42P01, 42501 and a planner
      -- fault back into one undifferentiated cause with every gate green. No
      -- VALUE is pinned — an equality on a SQLSTATE would make the arm depend on
      -- which failure the gate happens to provoke, which is the mistake the
      -- paragraph above refuses for `error`.
      --
      -- ⛔ THE WRITE IS BEST-EFFORT; THE DORMANT RETURN IS THE CONTRACT — a
      -- DECISION, recorded here because the file argues the handler's shape at
      -- length above and was silent at the one place the argument also applies.
      -- Control reaches the flag_read_failed branch BECAUSE a read raised
      -- (42P01, 42501 or a planner fault), and two of those three plausibly
      -- reach this INSERT as well. Unwrapped, the tick on which the instrument
      -- matters MOST is the tick on which this function RAISES: the row rolls
      -- back, the diagnostic is lost anyway, and a fail-closed dormant no-op on
      -- a function slated for a schedule becomes a hard error — an hourly cron
      -- that starts erroring is an incident, which is the exact thing arm L of
      -- both gates exists to refuse one layer up. So the write is wrapped and
      -- the dormancy survives it.
      --
      -- ⭐ A/B MEASURED 2026-09-12 on real pg-lanes, in the one state this whole
      -- decision is about: the activation read raising 42P01 (system_flags
      -- renamed away) AND the instrument's own table gone (cron_runs dropped).
      -- WITH the wrap the function emitted the WARNING below and RETURNED 0.
      -- With the wrap removed and nothing else changed, the SAME probe reported
      -- `the fan-out RAISED (SQLSTATE 42P01)`. The decision is therefore a
      -- measured difference in behaviour, not a preference.
      --
      -- ⚠️ THE WARNING IS NOT THE DETECTOR AND IS NOT CLAIMED AS ONE — this
      -- file's header MEASURES a WARNING as having no consumer. What detects a
      -- silently-failing instrument is both gates' M1/M2 arms, which count the
      -- row inside their own transaction and redden at 0.
      --
      -- ⚠️ R1-exception-handler-probe is not imported by this shape: that rule
      -- governs the GATE corpus (scripts/lint-sql-gates.mjs, CORPUS_DIR =
      -- supabase/tests) and not migration bodies, and this handler holds neither
      -- a probe nor a SELECT INTO — only the RAISE the rule exists to preserve.
      --
      -- ⛔ FORCE ROW LEVEL SECURITY on public.cron_runs IS THE CLAUSE THAT
      -- BREAKS THIS WRITE. The definer is exempt from row security on this table
      -- by OWNERSHIP ALONE (see check 3's derivation: the table's
      -- `ALTER TABLE "public"."cron_runs" ENABLE ROW LEVEL SECURITY` statement in
      -- supabase/schema/baseline.sql carries no FORCE clause, and neither policy
      -- admits this role), and
      -- FORCE is the one clause under which owning a table stops being an
      -- exemption. Add it at STEP 2b — which is where a future hardener will be
      -- standing — and every dormant-with-cause tick loses its row. Before the
      -- wrap below that was a RAISE; with it, it is a WARNING and a missing row,
      -- which both gates' M1/M2 arms report by name.
      BEGIN
        INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
        VALUES ('ledger_refresh_fanout', 'error', now(), v_cause,
                jsonb_build_object('function', 'enqueue_ledger_refresh_for_strategies',
                                   'cause', v_cause,
                                   'sqlstate', v_sqlstate));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'enqueue_ledger_refresh_for_strategies: dormancy instrument write failed (SQLSTATE %); the dormant cause was %', SQLSTATE, v_cause;
      END;
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
          -- Lifecycle. ⭐ WIDENED 2026-09-17 (Phase 164.5.1.1, TODOS
          -- FANOUT-COHORT-PRIVATE-01) from a two-value set to a three-value one,
          -- on a MEASUREMENT and not on a preference. On the FIRST tick after
          -- Phase 164.5.1 activated this fan-out — pg_cron runid 11159, jobid
          -- 40, 2026-09-17 08:25Z, reported `succeeded` — the job ran, was NOT
          -- dormant, reached candidate selection and selected ZERO strategies
          -- while the staleness view held six. Every production strategy
          -- carries the owner-only terminal status that
          -- 20260716130000_strategies_status_private.sql introduced (CONTRIB-02,
          -- Phase 110) and this conjunct never learned about it. The 20-hour
          -- attempt cooldown and the in-flight guard both counted 0 for all six,
          -- so nothing else excluded anything: this set was the single binding
          -- conjunct.
          --
          -- ⛔ TWO VALUES STAY EXCLUDED ON PURPOSE, and the set is deliberately
          -- NOT a mirror of ALLOWED_STRATEGY_STATUSES (routers/cron.py:148): a
          -- draft strategy has no factsheet to refresh, and an archived one is
          -- not a refresh candidate. Mirroring that constant would drag the
          -- first of those in.
          --
          -- ⚠️ THE SENTENCE THIS REPLACES IS RETIRED, NOT CARRIED. Until this
          -- edit the comment here said the set was the same pair
          -- enqueue_poll_positions_for_all_strategies uses
          -- (20260412094449:233-245), so that "the two recurring strategy
          -- fan-outs agree on what live enough to re-run means". That stopped
          -- being true at this line. The sibling fan-out is NOT widened in this
          -- phase, deliberately: it enqueues a different job kind, so widening
          -- it would arm a SECOND, UNMEASURED production behaviour in the same
          -- migration. It is booked and measured separately. Leaving the old
          -- sentence would report the two fan-outs as agreeing when they no
          -- longer do.
          AND s.status IN ('published', 'pending_review', 'private')
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
          -- Failed-attempt cooldown (164.6 review fix, HIGH-2). A candidate
          -- whose enqueue RAISED inserted no compute_jobs row, so the attempt
          -- cooldown above never sees it, and stalest-first ordering then hands
          -- it the same slot on every tick: two poisoned candidates would hold
          -- their share of the per-tick bound for good and starve the healthy
          -- candidates behind them. The failure instrument below names every
          -- such candidate in `failed_targets`, so a candidate named there
          -- inside the same 20-hour window is excluded exactly as a prior
          -- ATTEMPT is, and a healthy candidate takes its slot.
          -- ⭐ EVERY TICK WITH A FAILURE KEEPS ITS ROW, the tick in which
          -- every candidate failed included (164.6 round-2 review fix). The
          -- round-1 fix raised at the end of such a tick, and the raise rolled
          -- this very row back: two poisoned candidates on one venue, or two
          -- poisoned composites, then took the same slots on every tick and
          -- starved the healthy candidates behind them for good. That raise is
          -- gone, so this conjunct engages on every tick. The one path that
          -- still loses the row is the row's own write failing; see the
          -- failure instrument's write below.
          -- The read is bounded by cron_name and completed_at, the two columns
          -- the heartbeat table's own recent-run index is built on.
          AND NOT EXISTS (
                SELECT 1
                  FROM public.cron_runs cr
                 WHERE cr.cron_name = 'ledger_refresh_fanout'
                   AND cr.error = 'candidate_enqueue_failed'
                   AND cr.completed_at > now() - INTERVAL '20 hours'
                   AND cr.metadata->'failed_targets'
                       @> jsonb_build_array(jsonb_build_object('strategy_id', lrs.strategy_id))
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
      EXCEPTION WHEN serialization_failure THEN
        -- ---- a LOST RACE, not a failure (164.6 review fix, MEDIUM-2) -------
        -- 40001 is what the enqueue RPC raises when another writer's enqueue
        -- for this strategy won the in-flight race. It says nothing is wrong
        -- with the candidate: another enqueue is already serving it. Counting
        -- it as a failure would name a healthy strategy in the failed-target
        -- list and put it on the failed-attempt cooldown. ⛔ This branch sits
        -- BEFORE the catch-all below, which would otherwise take it.
        -- ⚠️ 40P01 (deadlock) is DELIBERATELY NOT HERE (164.6 round-2 review
        -- fix, L3 / IN-05). A deadlock victim's other party can be ANY lock
        -- holder, a worker updating the row among them, so nothing guarantees
        -- another enqueue is serving the candidate. Counted as a lost race, a
        -- recurring deadlock never named the candidate, never cooled it down
        -- and retook its slot on every tick in silence. It falls to the
        -- catch-all instead, where it is counted, named with its SQLSTATE and
        -- put on the failed-attempt cooldown.
        -- Assignment only, the rule every handler in this body follows.
        v_lost_race := v_lost_race + 1;
      WHEN OTHERS THEN
        -- ⛔ Deliberately NOT `WHEN unique_violation`: that condition cannot fire
        -- here (see the counter comment above), and an exception block that
        -- cannot fire is indistinguishable from one that is protecting
        -- something — the next reader preserves it and reasons from it.
        -- Catching OTHERS keeps one poisoned row from aborting the whole tick.
        -- The SQLSTATE is carried; no identifier is (T-161.1-10).
        RAISE WARNING 'enqueue_ledger_refresh_for_strategies: one candidate failed to enqueue (SQLSTATE %); continuing', SQLSTATE;
        -- ---- the failure instrument (164.6 OPS-08-F2, D-11) ---------------
        -- ASSIGNMENTS ONLY, the rule the activation handler above states:
        -- no read and no write in a handler. The failure is COUNTED and the
        -- candidate RECORDED here, and written once, after the unlock, below.
        -- SQLSTATE is defined only inside a handler, so it is captured here
        -- or nowhere. The id goes into the recorded list and NEVER into RAISE
        -- text (T-161.1-10): the WARNING above stays byte-identical.
        v_failed := v_failed + 1;
        v_failed_targets := v_failed_targets
          || jsonb_build_array(jsonb_build_object('strategy_id', v_row.strategy_id,
                                                  'sqlstate', SQLSTATE));
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Release before re-raising, or the session holds the lock until it ends and
    -- every later tick on that session skips. This arm is the part authors drop.
    PERFORM pg_advisory_unlock(hashtext('ledger_refresh_fanout'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('ledger_refresh_fanout'));

  -- ---- the failure instrument's write (164.6 OPS-08-F2, D-10 / D-11) ----
  -- ⛔ AFTER THE UNLOCK ABOVE, NEVER INSIDE THE LOCK-HOLDING BLOCK. There a
  -- failing INSERT would reach that block's handler, which unlocks and
  -- RE-RAISES, and the whole tick would roll back with every good enqueue in
  -- it. Here the lock is already released on every path, by construction.
  -- The migration's apply-time block refuses a body whose failure block
  -- precedes the last unlock.
  --
  -- ONE row per tick in which a candidate failed; a tick with no failure
  -- writes nothing, and a lost race alone is not a failure. Same cron_name as
  -- the dormancy rows, told apart by `error` and metadata->>'cause'. The list
  -- is bounded by the per-tick limit above. The strategy ids go ONLY into
  -- `metadata`, which row security lets platform admins and service_role
  -- read, never into RAISE text. The RETURN below is unchanged: it counts jobs
  -- INSERTED (D-10). The candidate CTE reads this row back as the
  -- failed-attempt cooldown.
  IF v_failed > 0 THEN
    BEGIN
      INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
      VALUES ('ledger_refresh_fanout', 'error', now(), 'candidate_enqueue_failed',
              jsonb_build_object('function', 'enqueue_ledger_refresh_for_strategies',
                                 'cause', 'candidate_enqueue_failed',
                                 'failed_count', v_failed,
                                 'enqueued_count', v_enqueued,
                                 'lost_race_count', v_lost_race,
                                 'failed_targets', v_failed_targets));
    EXCEPTION WHEN OTHERS THEN
      -- (164.6 review fix, MEDIUM-1) A failed write costs the row, and on a
      -- tick that ENQUEUED something that is the whole cost: raising here
      -- would roll the good enqueues back, which D-10 refuses. On a tick that
      -- enqueued NOTHING there is nothing to roll back, so the failure is
      -- re-raised with its own SQLSTATE and the scheduler records the run as
      -- failed, instead of a WARNING nothing reads being the only trace. The
      -- message names this function and carries counts only (T-161.1-10).
      -- ⭐ Since the 164.6 round-2 review fix this is the ONLY raise a tick
      -- with failed candidates can end in. The failure row is the signal:
      -- the prod prober counts it and the candidate CTE reads it back as the
      -- cooldown. So a row that cannot be written on a tick with nothing
      -- enqueued must still fail loudly.
      IF v_enqueued = 0 THEN
        RAISE EXCEPTION 'enqueue_ledger_refresh_for_strategies: failure instrument write failed (SQLSTATE %) on a tick that enqueued nothing; % candidate(s) failed', SQLSTATE, v_failed
          USING ERRCODE = SQLSTATE;
      END IF;
      RAISE WARNING 'enqueue_ledger_refresh_for_strategies: failure instrument write failed (SQLSTATE %); % candidate(s) failed this tick', SQLSTATE, v_failed;
    END;
  END IF;

  -- ---- NO all-candidates-failed raise (164.6 round-2 review fix) ---------
  -- The round-1 fix raised here when every candidate failed, so the scheduler
  -- would record a failed run. That raise rolled back the failure row written
  -- just above, which is the row the candidate CTE's failed-attempt cooldown
  -- reads: on exactly the tick HIGH-2 named (two poisoned candidates holding
  -- a venue's cap, or the composite cohort's burst cap) the cooldown could
  -- never engage and the healthy candidates starved. It is removed. The row
  -- now commits on every tick with a failure, and the prod prober's cron-obs
  -- arm counts those rows directly (scripts/prod-prober/arms/cron-obs.mjs,
  -- the prober half of this fix round), which also covers the tick that
  -- failed PARTLY and so never raised. ⛔ Do not re-add a raise here: its
  -- gate arm U (both ledger gates) reddens under exactly that re-addition.

  RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: enqueued % refresh job(s) this tick; % candidate(s) failed to enqueue; % lost an enqueue race', v_enqueued, v_failed, v_lost_race;
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
  'FALSE row writes nothing. Phase 164.6: a tick in which at least one candidate '
  'failed to enqueue writes one public.cron_runs row under the same cron_name with '
  'error ''candidate_enqueue_failed'' and the failed count, the enqueued count and '
  'the failed strategy ids in `metadata`; the return value still counts only the '
  'jobs inserted.';

-- service_role is REVOKEd alongside PUBLIC, anon and authenticated, and the
-- REVOKE is RE-ISSUED rather than trusted to survive CREATE OR REPLACE (the
-- precedent is 20260911130000, whose header records a service_role EXECUTE that
-- survived a green migration). STEP 3's check 11 asserts the outcome.
--
-- NO GRANT follows. The scheduler runs as `postgres`, which is this function's
-- OWNER, and an owner needs no grant.
REVOKE ALL ON FUNCTION public.enqueue_ledger_refresh_for_strategies()
  FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 2: the composite fan-out, re-based with the same four edits
-- --------------------------------------------------------------------------
-- Re-based on supabase/schema/functions/enqueue_ledger_composite_refresh.sql
-- (source migration 20260911130000). The same four edits as STEP 1 and nothing
-- else; every other line of the body is that snapshot's, byte for byte. It is
-- second in this file on purpose: the composite gate's twins select this body
-- as the SECOND match of each needle both bodies share.
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
  -- FOUR, for a dormant branch with THREE causes whose single NOTICE cannot tell
  -- two of them apart. v_found is the row count of the activation read and stays
  -- NULL until that read has actually COMPLETED — ⛔ NULL therefore means NEVER
  -- MEASURED, which is NOT the healthy row-present-and-FALSE case and must never
  -- be folded into it; the cause branch below is written NULL-safely for exactly
  -- that reason. v_read_failed is set by the handler after it has nulled the
  -- flag. v_sqlstate carries the failing read's SQLSTATE OUT of the handler,
  -- which is the only place it is defined — 42P01 (the table is gone), 42501
  -- (the privilege was revoked) and a planner fault are three causes with three
  -- different remediations, and the WARNING that already names it is read by
  -- nobody (APPGUC-WARNING-UNINSTRUMENTED-01, this file's own header). v_cause is
  -- the string the instrument row carries. The cause table is in this file's
  -- header, under WR-10.
  v_found       INTEGER := NULL;
  v_read_failed BOOLEAN := FALSE;
  v_sqlstate    TEXT;
  v_cause       TEXT;
  -- ---- the failure instrument's locals (164.6 OPS-08-F2) ---------------
  -- How many candidates failed to enqueue this tick, and which. Filled by
  -- the per-candidate handler (assignments only) and written ONCE, after
  -- the lock is released, by the failure instrument below.
  v_failed         INTEGER := 0;
  v_failed_targets JSONB   := '[]'::jsonb;
  -- ---- the lost-race count (164.6 review fix, MEDIUM-2) -----------------
  -- A candidate whose enqueue raised serialization_failure (40001) lost a
  -- race to another writer that is already serving it. It is counted HERE,
  -- beside the failure count and never in it, so it is never named in the
  -- failed-target list, never put on the failed-attempt cooldown, and never
  -- by itself writes a failure row. ⚠️ A deadlock (40P01) is NOT counted
  -- here since the 164.6 round-2 review fix: see the handler below.
  v_lost_race      INTEGER := 0;
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
    -- ⚠️ The note above says NOTHING BUT ASSIGNMENTS go in this handler. Both of
    -- these ARE assignments, and both are deliberately not a probe, a read or a
    -- write: lint rule R1-exception-handler-probe forbids DML and SELECT INTO
    -- here, and an INSERT in a handler is exactly the shape that rule exists to
    -- keep out of the gate corpus. The cause is RECORDED here and WRITTEN below,
    -- on the dormant path, where a write is legal.
    --
    -- ⛔ THE SQLSTATE IS CAPTURED HERE OR NOWHERE — it is defined only inside an
    -- exception handler. The WARNING above already formats it, and this file's
    -- header MEASURES that WARNING as having no consumer: pg_cron keeps no
    -- WARNING output and no prober arm reads the server log. Computing a value
    -- that separates "the table was dropped" from "the privilege was revoked"
    -- from "the planner faulted" and then discarding it leaves all three causes
    -- reporting the same thing, which is the shape this phase exists to remove.
    v_read_failed := TRUE;
    v_sqlstate    := SQLSTATE;
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
    -- ⛔ `IS DISTINCT FROM 1`, NEVER `= 0`. Control reaches here only when the
    -- read did NOT raise, so v_found holds the count that read produced — unless
    -- the count was never TAKEN, in which case it is still NULL. Under `= 0` a
    -- NULL makes the predicate NULL, the branch is not taken, control falls to
    -- the ELSE, the cause is nulled and NO ROW IS WRITTEN: an UNMEASURED read
    -- would be filed as the healthy row-present-and-FALSE case, silently. That
    -- is the named failure mode of the invariant this whole phase is restoring,
    -- and until check 7b was added the apply-time block COULD NOT catch it:
    -- check 7 asserts only that the instrument INSERT is PRESENT, so deleting
    -- the row-count read above yielded a migration that verified itself green on
    -- the auto-apply-to-PROD route. The NULL-safe form files an unmeasured read
    -- with the other INVISIBLE cause, where it is counted and loud, instead of
    -- with the silent one.
    --
    -- ⭐ AND THE DETECTOR IS BACK, at the apply rather than in the gate. The
    -- NULL-safe form is what made the deletion invisible to the GATES too — the
    -- row now writes under it, so arm M1 no longer reddens (see the A/B below,
    -- which measures exactly that). Check 7b holds needle (5) over the
    -- row-count read itself and REFUSES THE APPLY when the line is gone, which
    -- is the one layer the deletion cannot route around. The trade the M-3 fix
    -- made is therefore paid back rather than merely recorded.
    --
    -- ⭐ A/B MEASURED 2026-09-11 on real pg-lanes, because "it would be silent"
    -- is the kind of claim this repo does not take on argument. Delete the
    -- row-count read one line up and run test_ledger_refresh_fanout.sql: with
    -- this NULL-safe form the instrument still writes its row and the gate is
    -- GREEN at exit 0 (15/15 arms), while with `= 0` in its place the SAME
    -- deletion makes arm M1 report "wrote 0 instrument row(s) ... expected
    -- exactly 1" and the lane exits 3. The gate is therefore NOT blind to the
    -- deletion — it is the apply-time block that is — and the difference this
    -- line buys is that the DECLINE keeps reaching a counted row instead of
    -- going quiet the moment the count stops being taken.
    --
    -- ⚠️ RECORDED, not closed: the label then reads "invisible or absent"
    -- for a state that is really "never measured". Naming it separately would
    -- add a fourth cause no gate arm can reach, and an unfalsifiable branch is
    -- the worse trade — the `sqlstate` key below is NULL on this path and the
    -- row-count read is one line up, which is what tells the two apart on
    -- inspection.
    ELSIF v_found IS DISTINCT FROM 1 THEN
      v_cause := 'flag_row_invisible_or_absent';
    ELSE
      v_cause := NULL;
    END IF;
    IF v_cause IS NOT NULL THEN
      -- ⛔ THE SQLSTATE GOES IN `metadata`, NEVER IN `error`. Both ledger gates'
      -- M2 arms count rows whose `error` is EXACTLY the cause string; appending a
      -- diagnostic there breaks that equality and the arm reddens for a reason
      -- unrelated to what it tests. `metadata` carries NO EQUALITY assertion,
      -- which is what makes it the column a new diagnostic can join without
      -- renegotiating a gate. It is NULL on the invisible-or-absent path, by
      -- construction: there was no exception, so there was no SQLSTATE to read.
      --
      -- ⚠️ AMENDED 2026-09-12 — `metadata` now carries a PRESENCE assertion, and
      -- the distinction from an EQUALITY one is the whole reason it could be
      -- added without renegotiating anything. Both gates' M2 arms narrow their
      -- count to rows whose `metadata->>'sqlstate'` IS NOT NULL. Deleting the
      -- key pair below therefore makes M2 count 0 and redden by name, where
      -- before it was read by nothing: check 7's needle is the INSERT's own
      -- statement shape and SURVIVES the deletion intact, so a tidy-up of this
      -- jsonb_build_object call silently collapsed 42P01, 42501 and a planner
      -- fault back into one undifferentiated cause with every gate green. No
      -- VALUE is pinned — an equality on a SQLSTATE would make the arm depend on
      -- which failure the gate happens to provoke, which is the mistake the
      -- paragraph above refuses for `error`.
      --
      -- ⛔ THE WRITE IS BEST-EFFORT; THE DORMANT RETURN IS THE CONTRACT — a
      -- DECISION, recorded here because the file argues the handler's shape at
      -- length above and was silent at the one place the argument also applies.
      -- Control reaches the flag_read_failed branch BECAUSE a read raised
      -- (42P01, 42501 or a planner fault), and two of those three plausibly
      -- reach this INSERT as well. Unwrapped, the tick on which the instrument
      -- matters MOST is the tick on which this function RAISES: the row rolls
      -- back, the diagnostic is lost anyway, and a fail-closed dormant no-op on
      -- a function slated for a schedule becomes a hard error — an hourly cron
      -- that starts erroring is an incident, which is the exact thing arm L of
      -- both gates exists to refuse one layer up. So the write is wrapped and
      -- the dormancy survives it.
      --
      -- ⭐ A/B MEASURED 2026-09-12 on real pg-lanes, in the one state this whole
      -- decision is about: the activation read raising 42P01 (system_flags
      -- renamed away) AND the instrument's own table gone (cron_runs dropped).
      -- WITH the wrap the function emitted the WARNING below and RETURNED 0.
      -- With the wrap removed and nothing else changed, the SAME probe reported
      -- `the fan-out RAISED (SQLSTATE 42P01)`. The decision is therefore a
      -- measured difference in behaviour, not a preference.
      --
      -- ⚠️ THE WARNING IS NOT THE DETECTOR AND IS NOT CLAIMED AS ONE — this
      -- file's header MEASURES a WARNING as having no consumer. What detects a
      -- silently-failing instrument is both gates' M1/M2 arms, which count the
      -- row inside their own transaction and redden at 0.
      --
      -- ⚠️ R1-exception-handler-probe is not imported by this shape: that rule
      -- governs the GATE corpus (scripts/lint-sql-gates.mjs, CORPUS_DIR =
      -- supabase/tests) and not migration bodies, and this handler holds neither
      -- a probe nor a SELECT INTO — only the RAISE the rule exists to preserve.
      --
      -- ⛔ FORCE ROW LEVEL SECURITY on public.cron_runs IS THE CLAUSE THAT
      -- BREAKS THIS WRITE. The definer is exempt from row security on this table
      -- by OWNERSHIP ALONE (see check 3's derivation: the table's
      -- `ALTER TABLE "public"."cron_runs" ENABLE ROW LEVEL SECURITY` statement in
      -- supabase/schema/baseline.sql carries no FORCE clause, and neither policy
      -- admits this role), and
      -- FORCE is the one clause under which owning a table stops being an
      -- exemption. Add it at STEP 2b — which is where a future hardener will be
      -- standing — and every dormant-with-cause tick loses its row. Before the
      -- wrap below that was a RAISE; with it, it is a WARNING and a missing row,
      -- which both gates' M1/M2 arms report by name.
      BEGIN
        INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
        VALUES ('ledger_refresh_fanout', 'error', now(), v_cause,
                jsonb_build_object('function', 'enqueue_ledger_composite_refresh',
                                   'cause', v_cause,
                                   'sqlstate', v_sqlstate));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'enqueue_ledger_composite_refresh: dormancy instrument write failed (SQLSTATE %); the dormant cause was %', SQLSTATE, v_cause;
      END;
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
          -- Failed-attempt cooldown (164.6 review fix, HIGH-2). A candidate
          -- whose enqueue RAISED inserted no compute_jobs row, so the attempt
          -- cooldown above never sees it, and stalest-first ordering then hands
          -- it the same slot on every tick: two poisoned candidates would hold
          -- their share of the per-tick bound for good and starve the healthy
          -- candidates behind them. The failure instrument below names every
          -- such candidate in `failed_targets`, so a candidate named there
          -- inside the same 20-hour window is excluded exactly as a prior
          -- ATTEMPT is, and a healthy candidate takes its slot.
          -- ⭐ EVERY TICK WITH A FAILURE KEEPS ITS ROW, the tick in which
          -- every candidate failed included (164.6 round-2 review fix). The
          -- round-1 fix raised at the end of such a tick, and the raise rolled
          -- this very row back: two poisoned candidates on one venue, or two
          -- poisoned composites, then took the same slots on every tick and
          -- starved the healthy candidates behind them for good. That raise is
          -- gone, so this conjunct engages on every tick. The one path that
          -- still loses the row is the row's own write failing; see the
          -- failure instrument's write below.
          -- The read is bounded by cron_name and completed_at, the two columns
          -- the heartbeat table's own recent-run index is built on.
          AND NOT EXISTS (
                SELECT 1
                  FROM public.cron_runs cr
                 WHERE cr.cron_name = 'ledger_refresh_fanout'
                   AND cr.error = 'candidate_enqueue_failed'
                   AND cr.completed_at > now() - INTERVAL '20 hours'
                   AND cr.metadata->'failed_targets'
                       @> jsonb_build_array(jsonb_build_object('strategy_id', lrs.strategy_id))
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
      EXCEPTION WHEN serialization_failure THEN
        -- ---- a LOST RACE, not a failure (164.6 review fix, MEDIUM-2) -------
        -- 40001 is what the enqueue RPC raises when another writer's enqueue
        -- for this strategy won the in-flight race. It says nothing is wrong
        -- with the candidate: another enqueue is already serving it. Counting
        -- it as a failure would name a healthy strategy in the failed-target
        -- list and put it on the failed-attempt cooldown. ⛔ This branch sits
        -- BEFORE the catch-all below, which would otherwise take it.
        -- ⚠️ 40P01 (deadlock) is DELIBERATELY NOT HERE (164.6 round-2 review
        -- fix, L3 / IN-05). A deadlock victim's other party can be ANY lock
        -- holder, a worker updating the row among them, so nothing guarantees
        -- another enqueue is serving the candidate. Counted as a lost race, a
        -- recurring deadlock never named the candidate, never cooled it down
        -- and retook its slot on every tick in silence. It falls to the
        -- catch-all instead, where it is counted, named with its SQLSTATE and
        -- put on the failed-attempt cooldown.
        -- Assignment only, the rule every handler in this body follows.
        v_lost_race := v_lost_race + 1;
      WHEN OTHERS THEN
        -- ⛔ Deliberately NOT `WHEN unique_violation`: that condition cannot fire
        -- here (see the counter comment above), and an exception block that cannot
        -- fire is indistinguishable from one that is protecting something — the
        -- next reader preserves it and reasons from it. Catching OTHERS keeps one
        -- poisoned row from aborting the whole tick. The SQLSTATE is carried; no
        -- identifier is (T-161.1-19).
        RAISE WARNING 'enqueue_ledger_composite_refresh: one candidate failed to enqueue (SQLSTATE %); continuing', SQLSTATE;
        -- ---- the failure instrument (164.6 OPS-08-F2, D-11) ---------------
        -- ASSIGNMENTS ONLY, the rule the activation handler above states:
        -- no read and no write in a handler. The failure is COUNTED and the
        -- candidate RECORDED here, and written once, after the unlock, below.
        -- SQLSTATE is defined only inside a handler, so it is captured here
        -- or nowhere. The id goes into the recorded list and NEVER into RAISE
        -- text (T-161.1-19): the WARNING above stays byte-identical.
        v_failed := v_failed + 1;
        v_failed_targets := v_failed_targets
          || jsonb_build_array(jsonb_build_object('strategy_id', v_row.strategy_id,
                                                  'sqlstate', SQLSTATE));
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Release before re-raising, or the session holds the lock until it ends and
    -- every later tick on that session skips. This arm is the part authors drop.
    PERFORM pg_advisory_unlock(hashtext('ledger_refresh_composite_fanout'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('ledger_refresh_composite_fanout'));

  -- ---- the failure instrument's write (164.6 OPS-08-F2, D-10 / D-11) ----
  -- ⛔ AFTER THE UNLOCK ABOVE, NEVER INSIDE THE LOCK-HOLDING BLOCK. There a
  -- failing INSERT would reach that block's handler, which unlocks and
  -- RE-RAISES, and the whole tick would roll back with every good enqueue in
  -- it. Here the lock is already released on every path, by construction.
  -- The migration's apply-time block refuses a body whose failure block
  -- precedes the last unlock.
  --
  -- ONE row per tick in which a candidate failed; a tick with no failure
  -- writes nothing, and a lost race alone is not a failure. Same cron_name as
  -- the dormancy rows, told apart by `error` and metadata->>'cause'. The list
  -- is bounded by the per-tick limit above. The strategy ids go ONLY into
  -- `metadata`, which row security lets platform admins and service_role
  -- read, never into RAISE text. The RETURN below is unchanged: it counts jobs
  -- INSERTED (D-10). The candidate CTE reads this row back as the
  -- failed-attempt cooldown.
  IF v_failed > 0 THEN
    BEGIN
      INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
      VALUES ('ledger_refresh_fanout', 'error', now(), 'candidate_enqueue_failed',
              jsonb_build_object('function', 'enqueue_ledger_composite_refresh',
                                 'cause', 'candidate_enqueue_failed',
                                 'failed_count', v_failed,
                                 'enqueued_count', v_enqueued,
                                 'lost_race_count', v_lost_race,
                                 'failed_targets', v_failed_targets));
    EXCEPTION WHEN OTHERS THEN
      -- (164.6 review fix, MEDIUM-1) A failed write costs the row, and on a
      -- tick that ENQUEUED something that is the whole cost: raising here
      -- would roll the good enqueues back, which D-10 refuses. On a tick that
      -- enqueued NOTHING there is nothing to roll back, so the failure is
      -- re-raised with its own SQLSTATE and the scheduler records the run as
      -- failed, instead of a WARNING nothing reads being the only trace. The
      -- message names this function and carries counts only (T-161.1-10).
      -- ⭐ Since the 164.6 round-2 review fix this is the ONLY raise a tick
      -- with failed candidates can end in. The failure row is the signal:
      -- the prod prober counts it and the candidate CTE reads it back as the
      -- cooldown. So a row that cannot be written on a tick with nothing
      -- enqueued must still fail loudly.
      IF v_enqueued = 0 THEN
        RAISE EXCEPTION 'enqueue_ledger_composite_refresh: failure instrument write failed (SQLSTATE %) on a tick that enqueued nothing; % candidate(s) failed', SQLSTATE, v_failed
          USING ERRCODE = SQLSTATE;
      END IF;
      RAISE WARNING 'enqueue_ledger_composite_refresh: failure instrument write failed (SQLSTATE %); % candidate(s) failed this tick', SQLSTATE, v_failed;
    END;
  END IF;

  -- ---- NO all-candidates-failed raise (164.6 round-2 review fix) ---------
  -- The round-1 fix raised here when every candidate failed, so the scheduler
  -- would record a failed run. That raise rolled back the failure row written
  -- just above, which is the row the candidate CTE's failed-attempt cooldown
  -- reads: on exactly the tick HIGH-2 named (two poisoned candidates holding
  -- a venue's cap, or the composite cohort's burst cap) the cooldown could
  -- never engage and the healthy candidates starved. It is removed. The row
  -- now commits on every tick with a failure, and the prod prober's cron-obs
  -- arm counts those rows directly (scripts/prod-prober/arms/cron-obs.mjs,
  -- the prober half of this fix round), which also covers the tick that
  -- failed PARTLY and so never raised. ⛔ Do not re-add a raise here: its
  -- gate arm U (both ledger gates) reddens under exactly that re-addition.

  RAISE NOTICE 'enqueue_ledger_composite_refresh: enqueued % composite refresh job(s) this tick; % candidate(s) failed to enqueue; % lost an enqueue race', v_enqueued, v_failed, v_lost_race;
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
  'name, in `metadata`; the healthy FALSE row writes nothing. Phase 164.6: a tick '
  'in which at least one candidate failed to enqueue writes one public.cron_runs '
  'row under the same cron_name with error ''candidate_enqueue_failed'' and, with '
  'this function''s own name, the failed count, the enqueued count and the failed '
  'strategy ids in `metadata`; the return value still counts only the jobs '
  'inserted.';

-- The same re-issue, for the same reason. See STEP 1.
REVOKE ALL ON FUNCTION public.enqueue_ledger_composite_refresh()
  FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip.
--
-- ⛔ THIS BLOCK MUST NEVER CALL EITHER FUNCTION. A smoke-test invocation at
-- apply time would enqueue real jobs on PROD the moment this migration merges.
-- Assert the SHAPE, never the behaviour; behaviour belongs to the pg-lane gates
-- in supabase/tests/test_ledger_refresh_*.sql, whose arm N in each file forces
-- one candidate to fail and reads the row this file makes the body write.
--
-- ⛔ CATALOGUE READS ONLY — NEVER A ROW COUNT
-- ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). Shared TEST carries PROD's
-- CATALOGUE and not its DATA. A DO block that reads DATA and RAISEs on an
-- unexpected count applies cleanly to PROD and REFUSES on TEST, and because a
-- failed TEST apply BLOCKS the PROD apply, that refusal blocks a production
-- deploy. This block reads NO row of any application table, public.cron_runs
-- included. The interim remedy for such a refusal is to REVERT THE MERGE;
-- ⛔ never to edit supabase-migrate.yml.
--
-- The relations read below are pg_proc, pg_namespace and pg_roles, plus the
-- functions pg_get_functiondef, aclexplode, acldefault and pg_get_userbyid.
-- All of those are CATALOGUE. A body resolves its own table references at CALL
-- time, so the body checks stay correct on a cluster where none of the
-- application tables exist.
--
-- ⚠️ 20260911130000's check 10 (TRUNCATE on public.cron_runs) is NOT carried:
-- it verified a REVOKE that this file does not make, and carrying it would add
-- a way for this apply to refuse that has nothing to do with these bodies.
DO $verify$
DECLARE
  -- ⛔ Every variable is DECLAREd up front: plpgsql compiles a DO block WHOLE,
  --    so a missing DECLARE raises 42601 and NONE of the checks below run.
  --    Since migrations AUTO-APPLY to PROD on merge, that lands on production.
  v_fn          TEXT;
  v_overloads   INTEGER;
  v_nargs       SMALLINT;
  v_secdef      BOOLEAN;
  v_config      TEXT[];
  v_search_path TEXT;
  v_owner       TEXT;
  v_bypass      BOOLEAN;
  v_super       BOOLEAN;
  v_acl_owner   TEXT;
  v_grantees    TEXT;
  v_def_raw     TEXT;
  v_def         TEXT;
  v_instr_count INTEGER;
  v_fail_pos    INTEGER;
  v_raise_pos   INTEGER;
  -- THE NEEDLES, each BOUND TO A SHAPE and held in a variable so every check
  -- states it once and names it in its own failure message. ⛔ The ones that
  -- name a statement are ASSEMBLED BY CONCATENATION: written whole, each would
  -- be one more raw occurrence of that statement in a file the mutation runner
  -- and the repo-wide reader lint read RAW.
  --
  -- (1) the activation read.
  v_flag_needle  TEXT := 'FROM public.' || 'system_flags';
  -- (2) the NULL-safe comparison, BOUND TO THE GUARDED VARIABLE. Written WHOLE,
  --     and that is safe by measurement: both gates' A and K twins mutate the
  --     guard line in a way that PRESERVES this token, so the apply survives
  --     and the ARM is the first failure.
  v_null_needle  TEXT := 'v_enabled IS DISTINCT FROM TRUE';
  -- (3) the cron_runs write. ⭐ NOW COUNTED, not merely found: each body
  --     carries TWO writes after this file (the dormancy instrument and the
  --     failure instrument), so a bare presence test would pass with the
  --     dormancy write deleted and the failure write standing in for it.
  v_instr_needle TEXT := 'INSERT INTO public.' || 'cron_runs';
  -- (4) the lifecycle conjunct's own shape, BOUND TO THE COLUMN (never the
  --     value set, which arm P's twin rewrites in the fan-out gate).
  v_life_needle  TEXT := 'AND s.' || 'status IN (';
  -- (5) and (6), asserted ABSENT from executable text: the two lifecycle values
  --     neither function admits. MEASURED 2026-09-24 on both comment-stripped
  --     bodies: 0 occurrences of either quoted value.
  v_draft_needle TEXT := '''draft''';
  v_arch_needle  TEXT := '''archived''';
  -- (7) the row-count read that DECIDES between the two invisible dormant
  --     causes (20260911130000's check 7b). No twin in either ledger gate
  --     mutates it.
  v_diag_needle  TEXT := 'GET ' || 'DIAGNOSTICS v_found';
  -- (8) the RETIRED app-namespace database setting, asserted ABSENT.
  v_guc_needle   TEXT := 'current_' || 'setting(''app.' || 'ledger_refresh_enabled''';
  -- (9) ⭐ NEW: the failure instrument, needled on the quoted metadata KEY of
  --     the failed-target list. A body that stops recording WHICH candidate
  --     failed loses the one fact the per-candidate WARNING never carried.
  v_fail_needle  TEXT := '''failed_' || 'targets''';
  -- (10) ⭐ NEW: the ordering of the failure write against the advisory lock.
  --      The failure row's own count KEY, and the unlock call.
  --      ⚠️ AMENDED in the 164.6 review fix: this needle was the failure
  --      block's opening IF until IN-02 gave that IF a gate twin (the
  --      boundary edit that lets a clean tick write a row). A needle a twin
  --      mutates aborts the apply and the arm never runs, so the needle moved
  --      to the count key inside the same INSERT, which no twin touches.
  v_block_needle TEXT := '''failed_' || 'count''';
  v_lock_needle  TEXT := 'pg_advisory_' || 'unlock(';
  -- (11) ⭐ AMENDED in the 164.6 round-2 review fix: the re-raise of a
  --      failure row that could not be written on a tick that enqueued
  --      nothing, needled on its MESSAGE. It was the all-candidates-failed
  --      raise's message until round 2 removed that raise; this re-raise is
  --      now the only way such a tick can end loudly when its row is lost.
  --      Its gate twins (V1, V2) mutate the IF that guards it and leave this
  --      text intact, so the apply survives.
  --      ⛔ The removed raise is deliberately NOT asserted absent here: arm
  --      U's twin in both ledger gates re-adds it, and a needle that twin
  --      trips would abort the apply before arm U could be the first failure.
  v_raise_needle TEXT := 'on a tick that ' || 'enqueued nothing';
  -- (12) ⭐ NEW in the 164.6 review fix (HIGH-2): the failed-attempt
  --      cooldown's read of the heartbeat table, needled on its alias. Its
  --      gate twin mutates the interval and leaves this text intact.
  v_cool_needle  TEXT := 'FROM public.' || 'cron_runs cr';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'enqueue_ledger_refresh_for_strategies',
    'enqueue_ledger_composite_refresh'
  ]
  LOOP
    -- 1. the function landed, resolves to EXACTLY ONE function, and takes
    --    ZERO arguments. ⛔ The overload count is ASSERTED: every read below
    --    keys on (schema, name) with no signature, and `SELECT … INTO` WITHOUT
    --    STRICT takes the first of several rows in silence.
    SELECT count(*) INTO v_overloads
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = v_fn;
    IF v_overloads > 1 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% resolves to % functions in schema public, expected exactly 1. The checks below read (schema, name) with no signature and SELECT INTO without STRICT silently takes the first of several, while the grantee check is narrowed to the zero-argument row and cannot see an overload at all', v_fn, v_overloads;
    END IF;

    SELECT p.pronargs, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
      INTO v_nargs, v_secdef, v_config, v_def_raw
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = v_fn;

    IF v_nargs IS NULL THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% is missing after its own CREATE OR REPLACE — the re-base did not land', v_fn;
    END IF;
    IF v_nargs <> 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% takes % argument(s), expected 0 — a caller-supplied threshold on a cross-tenant SECURITY DEFINER function IS the attack surface', v_fn, v_nargs;
    END IF;

    -- 2. SECURITY DEFINER with a pinned search_path, both preserved by the
    --    re-base. ⛔ THE VALUE, NOT THE PREFIX: a test that asks only whether
    --    SOME proconfig element BEGINS `search_path=` is satisfied by the EMPTY
    --    path and by a path led by a schema the caller can create objects in.
    IF v_secdef IS NOT TRUE THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% is not SECURITY DEFINER — the re-base dropped it, and the activation read then runs as the CALLER against an RLS-enabled table that admits no such role', v_fn;
    END IF;
    SELECT c INTO v_search_path
      FROM unnest(COALESCE(v_config, ARRAY[]::TEXT[])) AS c
     WHERE c LIKE 'search_path=%';
    IF v_search_path IS NULL THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% does not pin search_path at all (proconfig=%) — on a SECURITY DEFINER function an unpinned search_path is a privilege-escalation route: the CALLER then decides which schema every unqualified name in the body resolves to', v_fn, v_config;
    END IF;
    IF regexp_replace(v_search_path, '\s', '', 'g') <> 'search_path=public,pg_catalog' THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% pins search_path to "%", not to the "public, pg_catalog" its own declaration sets. A pin that merely EXISTS proves nothing, and this body runs as a role that is exempt from row security', v_fn, v_search_path;
    END IF;

    -- 3. the DEFINER role is exempt from row security: `rolsuper OR
    --    rolbypassrls`, NEVER rolbypassrls alone (a superuser bypasses row
    --    security with that flag still FALSE). public.compute_jobs carries
    --    FORCE ROW LEVEL SECURITY and both bodies read it directly.
    SELECT r.rolname, r.rolbypassrls, r.rolsuper
      INTO v_owner, v_bypass, v_super
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_roles r ON r.oid = p.proowner
     WHERE n.nspname = 'public'
       AND p.proname = v_fn;
    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'Migration 20260924120000: could not resolve the owner of public.% — pg_proc.proowner has no matching pg_roles row', v_fn;
    END IF;
    IF NOT (COALESCE(v_bypass, FALSE) OR COALESCE(v_super, FALSE)) THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% is owned by role "%" (rolsuper=%, rolbypassrls=%), which is exempt from row security by neither route. As SECURITY DEFINER it reads public.compute_jobs as that role, and that table carries FORCE ROW LEVEL SECURITY — the one clause under which OWNING the table is not an exemption either', v_fn, v_owner, v_super, v_bypass;
    END IF;

    -- 4. THE BODY ITSELF, asserted on the EXECUTABLE text. pg_get_functiondef
    --    returns the body WITH its comments, and both bodies carry long comments
    --    that name the very shapes asserted below, so comments are stripped
    --    FIRST (lint rule R2-functiondef-comment-strip's idiom).
    --    ⚠️ RESIDUAL, RECORDED not closed: `--[^\n]*` does not strip `/* … */`.
    --    MEASURED 2026-09-24 on both bodies: 0 block-comment openers, and 0 code
    --    lines carrying a trailing `--`.
    v_def := regexp_replace(v_def_raw, '--[^\n]*', '', 'g');

    IF v_def IS NULL OR length(v_def) < 500 THEN
      RAISE EXCEPTION 'Migration 20260924120000: the comment-stripped definition of public.% is % character(s) — the strip is broken, so every check below would pass over nothing', v_fn, COALESCE(length(v_def), 0);
    END IF;

    -- 5. the guard READS THE ACTIVATION TABLE.
    IF position(v_flag_needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% does not read the activation flag from the settings table (looked for "%") — the fail-closed switch is gone and this function would fan out unconditionally', v_fn, v_flag_needle;
    END IF;

    -- 6. and compares it NULL-SAFELY.
    IF position(v_null_needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% does not compare the activation flag with the NULL-safe form "%" — a NULL-unsafe comparison opens the flag on the read-failure and missing-row paths, which are the two paths this guard exists for', v_fn, v_null_needle;
    END IF;

    -- 7. BOTH cron_runs writes are still there: the dormancy instrument and the
    --    failure instrument. Counted, for the reason given at needle (3).
    v_instr_count := (length(v_def) - length(replace(v_def, v_instr_needle, ''))) / length(v_instr_needle);
    IF v_instr_count <> 2 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% writes public.cron_runs % time(s) in its executable text (looked for "%"), expected 2 — the dormancy instrument and the failure instrument. One of the two counted traces is gone, and the survivor would satisfy a presence test on its own', v_fn, v_instr_count, v_instr_needle;
    END IF;

    -- 7b. the count that DECIDES between the two invisible dormant causes is
    --     still TAKEN. With the NULL-safe cause branch, deleting it leaves every
    --     gate GREEN (measured in 20260911130000), so this apply-time check is
    --     the only layer that sees the deletion.
    IF position(v_diag_needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% no longer takes the row count of the activation read (looked for "%"). v_found then stays NULL on a read that did NOT raise, the NULL-safe cause branch files an UNMEASURED read as flag_row_invisible_or_absent, and the two invisible causes stop being distinguishable while every gate stays GREEN', v_fn, v_diag_needle;
    END IF;

    -- 7c. the RETIRED app-namespace setting has NOT come back.
    IF position(v_guc_needle IN v_def) <> 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% still reads the RETIRED app-namespace database setting (found "%"). An operator on this platform is refused 42501 setting it, so that read can never be TRUE and the function would be permanently dormant for a reason no cron_runs cause names', v_fn, v_guc_needle;
    END IF;

    -- 8. the lifecycle conjunct is still there, bound to the column.
    IF position(v_life_needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% no longer filters candidates on the strategy lifecycle column (looked for "%"). Without that conjunct the fan-out enqueues refreshes for every lifecycle state the staleness view surfaces, drafts and archives included', v_fn, v_life_needle;
    END IF;

    -- 9. and it still EXCLUDES the drafting state…
    IF position(v_draft_needle IN v_def) <> 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.%''s executable text now names the drafting lifecycle state. Neither fan-out admits it: a strategy in that state has no factsheet to refresh, so every job enqueued for one is worker time spent on nothing', v_fn;
    END IF;

    -- 10. …and the archived state.
    IF position(v_arch_needle IN v_def) <> 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.%''s executable text now names the archived lifecycle state. It is not a refresh candidate for either fan-out, and admitting it here would be an unmeasured widening riding along with an unrelated change', v_fn;
    END IF;

    -- 10b. ⭐ NEW: the failure instrument RECORDS WHICH CANDIDATE FAILED.
    IF position(v_fail_needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% no longer records the failed-target list in its failure row (looked for "%"). A tick in which a candidate failed would again leave no readable record of WHICH candidate, and the per-candidate WARNING that remains carries no identifier by design and has no consumer', v_fn, v_fail_needle;
    END IF;

    -- 10c. ⭐ NEW: the failure write sits AFTER THE LAST ADVISORY UNLOCK, never
    --      inside the lock-holding block (T-164.6-11). Inside it, a failing
    --      INSERT reaches the block's handler, which unlocks and RE-RAISES, and
    --      the tick rolls back with every good enqueue in it. Asserted as three
    --      facts: the failure block is present; an unlock precedes it; and NO
    --      unlock follows it (so it is after the success-path unlock, the last
    --      one in the body).
    v_fail_pos := position(v_block_needle IN v_def);
    IF v_fail_pos = 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% has no failure-instrument block (looked for "%"), so a tick with failed candidates writes nothing', v_fn, v_block_needle;
    END IF;
    IF position(v_lock_needle IN substr(v_def, 1, v_fail_pos)) = 0
       OR position(v_lock_needle IN substr(v_def, v_fail_pos)) <> 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.%''s failure-instrument block ("%") is not after the LAST advisory unlock ("%"). Placed before it, a failing instrument write reaches the lock-holding block''s handler, which unlocks and re-raises, and the whole tick rolls back with every enqueue that succeeded — the outcome this migration''s D-10 exists to refuse', v_fn, v_block_needle, v_lock_needle;
    END IF;

    -- 10d. ⭐ NEW (164.6 review fix, HIGH-2): the candidate query still skips a
    --      candidate named in a recent failure row. Without it a candidate
    --      whose enqueue raises takes the same slot on every tick.
    IF position(v_cool_needle IN v_def) = 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% no longer reads the failure rows back as a cooldown (looked for "%"). A candidate whose enqueue raises then takes the same slot on every tick and starves the healthy candidates behind it', v_fn, v_cool_needle;
    END IF;

    -- 10e. ⭐ AMENDED (164.6 round-2 review fix): a tick that enqueued
    --      nothing and could not write its failure row still RAISES, and
    --      raises AFTER the last unlock, so the lock is never held across it.
    v_raise_pos := position(v_raise_needle IN v_def);
    IF v_raise_pos = 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.% no longer re-raises a failure-row write that failed on a tick that enqueued nothing (looked for "%"). Such a tick then returns 0 with no row and a WARNING nothing reads, so both the prober and the failed-attempt cooldown lose it', v_fn, v_raise_needle;
    END IF;
    IF position(v_lock_needle IN substr(v_def, v_raise_pos)) <> 0 THEN
      RAISE EXCEPTION 'Migration 20260924120000: public.%''s failure-row re-raise ("%") is not after the LAST advisory unlock ("%"). Raised before it, the tick can end holding the lock', v_fn, v_raise_needle, v_lock_needle;
    END IF;

    -- 11. THE WHOLE EXECUTE GRANTEE SET IS EXACTLY THE OWNER. aclexplode over
    --     COALESCE(proacl, acldefault(…)) ENUMERATES the grantees instead of
    --     probing a guessed list, and a NULL acl (whose MEANING is the default
    --     ACL, EXECUTE TO PUBLIC) is made explicit. Compared to the owner's
    --     NAME, never to a literal role.
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
      RAISE EXCEPTION 'Migration 20260924120000: could not read the EXECUTE grantee set of public.% — the function is missing, or it carries no EXECUTE aclitem at all, and an empty answer here is indistinguishable from a locked-down one unless it is refused', v_fn;
    END IF;
    IF v_grantees IS DISTINCT FROM v_acl_owner THEN
      RAISE EXCEPTION 'Migration 20260924120000: EXECUTE on public.% is held by [%], expected exactly the owner [%]. A cross-tenant SECURITY DEFINER function that enqueues work for every tenant must be callable by the scheduler alone, and the scheduler IS the owner', v_fn, v_grantees, v_acl_owner;
    END IF;
  END LOOP;

  RAISE NOTICE 'Migration 20260924120000: both ledger fan-outs re-based — a tick in which a candidate fails now writes one counted row naming the failed candidates, after the lock is released, and a candidate named there is skipped for 20 hours, on every such tick; a tick that cannot write that row and enqueued nothing raises; a lost enqueue race (40001) is counted apart and a deadlock is a failure; the return value is unchanged. NOTHING scheduled, NOTHING activated';
END $verify$;

COMMIT;
