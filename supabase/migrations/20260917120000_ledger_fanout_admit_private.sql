-- Migration: the ledger-refresh single-key fan-out's lifecycle conjunct admits
-- the owner-only terminal status, so the cohort it selects is the cohort that
-- actually exists in production.
-- Phase 164.5.1.1 / plan 01 (TODOS.md FANOUT-COHORT-PRIVATE-01). 2026-09-17.
--
-- ⚠️ OPS: merging supabase/migrations/** to main applies to shared TEST FIRST
-- (supabase-migrate.yml `apply-test`) and then AUTO-APPLIES to PROD behind the
-- Production environment's human reviewer gate. This file redefines ONE LIVE
-- SECURITY DEFINER function, so the new body is live on the next merge with no
-- separate deploy step.
--
-- ⛔ IT IS A FORWARD MIGRATION AND NOT AN EDIT TO AN APPLIED ONE.
-- 20260911130000_ledger_fanout_grantees_and_dormancy.sql is applied on PROD and
-- on shared TEST; its body is RE-BASED here, never rewritten there. An applied
-- migration stays byte-identical.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE MEASURED CAUSE — this file carries its own evidence
-- ══════════════════════════════════════════════════════════════════════════
-- On the FIRST tick after Phase 164.5.1 activated this fan-out (pg_cron
-- `cron.job_run_details` runid 11159, jobid 40, 2026-09-17 08:25:00.371Z,
-- status `succeeded`) the job RAN, was NOT dormant, reached candidate selection
-- and selected ZERO strategies:
--
--   * the activation flag was TRUE and zero rows carried the fan-out's dormant
--     cron_name, so the dormant branch's own instrument agrees it was not taken;
--   * public.compute_jobs gained no derive_broker_dailies row;
--   * public.ledger_refresh_staleness stayed byte-identical to the BEFORE
--     census — 6 strategies, min 23 / avg 52.50 / max 141 days stale;
--   * the 20-hour attempt cooldown counted 0 and the in-flight guard counted 0
--     for all six, so neither of those excluded anything.
--
-- The single binding conjunct was the lifecycle set. Every production strategy
-- carries the owner-only terminal status introduced by
-- 20260716130000_strategies_status_private.sql (CONTRIB-02, Phase 110) in July
-- 2026; this fan-out shipped in September and nothing ever compared the two.
--
-- ⛔ Every strategy identifier in this file is truncated to 8 characters and no
-- account number, broker server name or absolute path appears anywhere: this
-- repository is PUBLIC.
--
-- ══════════════════════════════════════════════════════════════════════════
-- SCOPE BOUNDARY — the site this file deliberately does NOT touch
-- ══════════════════════════════════════════════════════════════════════════
-- ⛔ THE IDENTICAL LIFECYCLE LITERAL EXISTS A SECOND TIME in
-- 20260911130000_ledger_fanout_grantees_and_dormancy.sql, inside the composite
-- arm's enqueue function (its STEP 2 -- that file defines it, and gate 10c in
-- analytics-service/tests/test_ledger_refresh_gates.py asserts that ONLY the
-- files DEFINING that function may spell its name, which is why this block
-- points at it by file and step rather than by identifier). MEASURED 2026-09-17 with
-- `grep -n` over that file: the two-value form appears at TWO line numbers, one
-- per function body. It is left alone here, on purpose, and this block is what
-- stops a future reader "completing" the change:
--
--   1. That function has NO REGISTERED CRON ROW AT ALL. Widening it would arm a
--      SECOND, UNMEASURED production behaviour in the same migration — the
--      opposite of what a measured one-line repair is for.
--   2. It would make the 141-day-stale deribit composite a candidate the moment
--      a schedule were ever registered, silently REVERSING the composite
--      exclusion the founder locked (D-01 in this repo's vocabulary — the
--      composite/membership deferral, NOT a decision id from this phase's
--      CONTEXT.md, which numbers its own decisions CTX-nn precisely because
--      D-01 was already taken).
--   3. The composite arm's own blindness to this status is a REAL and SEPARATE
--      finding. It is booked in plan 03 of this phase
--      (.planning/phases/164.5.1.1-fanoutcohort-…/164.5.1.1-03-PLAN.md) and is
--      NOT reported as fixed by this file.
--
-- ⚠️ RESEARCH.md and PATTERNS.md for this phase both state that the composite
-- function "has no status conjunct at all". They are WRONG, and the correction
-- is recorded here as well as in VALIDATION.md and the ROADMAP, because this is
-- the file a future reader reaches first.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — the PROD body this CREATE OR REPLACE overwrites
-- ══════════════════════════════════════════════════════════════════════════
-- ONE entry, because exactly ONE function body is replaced.
--
-- The gate compares the COMMITTED SNAPSHOT (supabase/schema/functions/) against
-- PROD's live body. On any function-changing migration PR the two necessarily
-- disagree: `snapshot-drift` requires the snapshot to carry the body the
-- MIGRATIONS produce (the new one), while VAC-04 requires it to match what PROD
-- has TODAY (the old one). The pragma is the designed resolution, and it means
-- "I read PROD's body and intend to overwrite it".
--
-- MEASURED 2026-09-17, reproduced LOCALLY with the gate's own normalizer, aiming
-- its `live` argument at origin/main's snapshot rather than at PROD:
--
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql \
--     <origin/main's copy of that same file>
--
--     enqueue_ledger_refresh_for_strategies/0
--       HEAD snapshot sha256      e7e990177dcfb202dce3e94f84499db57a8050bf34cee416c19c014168ce30c9
--       origin/main body sha256   9d08957172d399d489c88981305d31c3f4587dc04863f3ad48238b9936d762ca
--       differing lines           2
--
-- ⭐ THE ACKED HASH IS THE `live` COLUMN OF --diff-bodies, NOT `--hash` OF THE
-- SNAPSHOT FILE. scripts/prod-body-drift-check.sh reads the FIFTH TSV field of
-- --diff-bodies into `live_hash` and greps for that token as a FIXED STRING,
-- under its own comment "the ack must carry the hash of the NORMALIZED PROD
-- body". `--hash <file>` returns a whole-FILE digest no gate ever greps — it
-- would read to a human exactly like an ack and be INVISIBLE to the gate.
--
-- ⭐ AND THE RECIPE IS CALIBRATED AGAINST A KNOWN-GOOD ACK FOR THIS SAME ARM,
-- rather than merely being self-consistent. Re-run on Phase 164.7's own inputs —
-- --diff-bodies of commit 14b3b6c3's snapshot of this function against its
-- parent's — it returns snap adeb6d16…53705f / live 88e6af84…ae6e36 / 15 lines,
-- REPRODUCING BOTH published values verbatim. The `live` value there is
-- 20260907130000's own pragma, which was earned against REAL PROD in workflow
-- run 34138679709. So the chain is: PROD's body at that merge became the
-- snapshot this file overwrites, and the command above is measured against PROD
-- once removed.
--
-- ⚠️ AND ONE PUBLISHED FIGURE DOES NOT RE-MEASURE — recorded because an ack is
-- evidence and evidence that disagrees with the record must be reconciled, not
-- quietly preferred. 20260911130000's VAC-04 block states a `HEAD snapshot`
-- hash of 1faf8e9e…0066bc for this arm. Re-measured 2026-09-17, the body
-- origin/main actually carries normalizes to the value acked below. The
-- calibration paragraph above shows the NORMALIZER is unchanged (it reproduces
-- that file's other two published values exactly), so the explanation is that
-- 1faf8e9e… was measured on a revision of that migration which did not survive
-- to the merge. ⛔ The ack below is the value MEASURED at origin/main today; it
-- is NOT the restated one, and a future reader must not "correct" it back.
--
-- prod-body-ack: 9d08957172d399d489c88981305d31c3f4587dc04863f3ad48238b9936d762ca
--
-- ⚠️ THE ACK IS OF origin/main, WHICH STANDS IN FOR PROD. It is EARNED only if
-- VAC-04 on the PR reports that SAME hash for PROD. If it differs, PROD drifted
-- OUT OF BAND and the correct action is to FOLD the difference into this
-- migration and RE-DERIVE — never to edit the pragma to match a gate log. The
-- ack is evidence that PROD was READ, not a way to silence the gate.
--
-- ══════════════════════════════════════════════════════════════════════════
-- RE-BASE DISCIPLINE (DRIFT-02)
-- ══════════════════════════════════════════════════════════════════════════
-- The LEFT side of the re-base is the COMMITTED SNAPSHOT
-- supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql — the
-- artifact the PROD-body gate compares against — and NOT any migration's text.
-- MEASURED 2026-09-17 before writing a line: the newest migration in
-- supabase/migrations/ is 20260911130000 and it is the LAST definition of this
-- function, so the snapshot and that file agree; using the snapshot is what
-- makes "they agree" a measurement rather than an assumption.
--
-- EXACTLY ONE EXECUTABLE EDIT was made to that body, and every other line is
-- the snapshot's byte for byte — the advisory lock and its
-- unlock-before-re-raise arm, the whole activation guard and its dormancy
-- instrument, the candidate CTE's other conjuncts, the venue-rank cap, the
-- cooldown and burst literals with their leading whitespace, the per-candidate
-- handler, the insertions-not-calls counter, the closing NOTICEs, and the
-- dollar-quote TAG:
--
--   (a) the candidate CTE's lifecycle conjunct gains a THIRD value.
--
-- The comment block immediately above that conjunct is rewritten with it, and
-- that is part of the same edit rather than a second one: the sentence standing
-- there claimed this set was the same pair the sibling poll-positions fan-out
-- uses, and that sentence STOPS BEING TRUE at this edit. Shipping it unchanged
-- would leave a false statement in a live production body.
--
-- ⚠️ Regenerating supabase/schema/functions/ (`npm run schema:functions`) after
-- this file lands is a SEPARATE, REQUIRED step of this phase and NOT an
-- optional tidy: the snapshot is what VAC-04, `npm run schema:functions:check`
-- and src/__tests__/prod-prober-wiring.test.ts read. Skipping it turns VAC-04
-- red against PROD.
--
-- ══════════════════════════════════════════════════════════════════════════
-- DISJOINTNESS — what STEP 2 asserts vs. what the gate arms MUTATE
-- ══════════════════════════════════════════════════════════════════════════
-- A verification needle that a gate arm MUTATES aborts the apply: the gate then
-- never runs, no arm can be the first failure, and the mutation runner scores a
-- defect. WAIVED_CEILING in scripts/mutation-runner/run.mjs is 0 (read it BY
-- SYMBOL) and stays 0, so such an intersection is not waivable — it is designed
-- out here. scripts/mutation-runner/GRAMMAR.md records a real instance of this
-- exact abort under its rule 2.
--
-- ⛔ THIS FILE THEREFORE DOES NOT ASSERT THE WIDENED LITERAL ITSELF, AND THAT
-- OMISSION IS A DECISION rather than an oversight. The new gate arm added by
-- this phase (supabase/tests/test_ledger_refresh_fanout.sql, the
-- private-admits arm) exists precisely to REVERT this widening and watch the
-- gate redden. Its twin mutates THIS file. A `position()` needle on the
-- three-value set would therefore RAISE at apply time under that arm's own
-- mutation, the lane would abort before a single arm ran, and the arm this
-- phase exists to add could never be observed biting. The widening is proven by
-- that arm — behaviourally, on real rows — which is a stronger proof than a
-- text probe, and it is proven at apply time only to the extent a needle can
-- survive the arm.
--
-- ⭐ WHAT IS ASSERTED INSTEAD IS BOUND TO THE COLUMN AND SURVIVES BY DESIGN:
-- check 8 holds the lifecycle conjunct's own shape (the column and the
-- membership test), which every form of the set preserves, and check 9 holds
-- the two values that must NEVER be admitted. Together they refuse a re-base
-- that drops the conjunct entirely and a "tidy" that mirrors
-- ALLOWED_STRATEGY_STATUSES. This is the same treatment 20260911130000 gives
-- its NULL-safe-comparison needle, whose comment records that the A and K twins
-- are designed to PRESERVE that token so the apply survives and the ARM, not
-- the migration, is the first failure.
--
-- ⛔ NO GATE `find` STRING IS REPRODUCED ANYWHERE IN THIS FILE, deliberately.
-- The mutation runner counts `occurrences` over the RAW FILE TEXT, comments
-- included, so a verbatim paste of any arm's needle in this header would be a
-- second occurrence, the arm's measured count would be wrong, and the run would
-- report occurrence-mismatch — the mutation not applied, so the arm not tested.
-- The needles this file's own STEP 2 uses are ASSEMBLED BY CONCATENATION for
-- the same reason.
--
-- ══════════════════════════════════════════════════════════════════════════
-- BLAST RADIUS — what widening the cohort can and cannot do
-- ══════════════════════════════════════════════════════════════════════════
-- Every bound on this function is INDEPENDENT of lifecycle status and NONE of
-- them is touched here: the per-venue rank window, the per-tick burst limit,
-- the 20-hour attempt cooldown (the binding constraint) and the in-flight
-- guard. The projected PROD effect is a small, bounded number of jobs per tick,
-- and plan 04 of this phase MEASURES the real number against the BEFORE census
-- on the natural tick rather than assuming it.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: the single-key fan-out, re-based with one edit
-- --------------------------------------------------------------------------
-- Re-based on supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql
-- (source migration 20260911130000). The ONE edit enumerated in the RE-BASE
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
      -- by OWNERSHIP ALONE (see check 3's derivation: the table carries no FORCE
      -- clause at baseline.sql:9864, and neither policy admits this role), and
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

-- service_role is REVOKEd alongside PUBLIC, anon and authenticated, and the
-- REVOKE is RE-ISSUED rather than trusted to survive CREATE OR REPLACE. The
-- precedent is 20260911130000, whose own header records that 20260907130000
-- revoked THREE of the four roles while the check beside it probed only TWO —
-- so service_role's EXECUTE survived a green migration. A grant that survives
-- silently is exactly the state check 10 below refuses to assume away.
--
-- NO GRANT follows. The scheduler runs as `postgres`, which is this function's
-- OWNER, and an owner needs no grant.
REVOKE ALL ON FUNCTION public.enqueue_ledger_refresh_for_strategies()
  FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
-- House style: RAISE EXCEPTION, never a silent NOTICE-skip.
--
-- ⛔ THIS BLOCK MUST NEVER CALL THE FUNCTION. A smoke-test invocation at apply
-- time would enqueue real jobs on PROD the moment this migration merges.
-- Assert the SHAPE, never the behaviour; behaviour belongs to the pg-lane gates
-- in supabase/tests/test_ledger_refresh_*.sql.
--
-- ⛔ CATALOGUE READS ONLY — NEVER A ROW COUNT
-- ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). Shared TEST carries PROD's
-- CATALOGUE and EMPTY tables. A DO block that reads DATA and RAISEs on an
-- unexpected count applies cleanly to PROD and REFUSES on TEST — and because a
-- failed TEST apply BLOCKS the PROD apply, that refusal blocks a production
-- deploy. ⛔ In particular this block reads NO ROW of public.strategies,
-- public.api_keys or public.compute_jobs, and asserting that the widened cohort
-- actually selects anything is NOT attempted here for exactly that reason: on
-- shared TEST those tables are empty by construction, so such a check would
-- either false-fail or pass vacuously. The row-level proof belongs to the gate
-- corpus, which builds its own fixtures on a throwaway pg-lane. The interim
-- remedy for such a refusal is to REVERT THE MERGE; ⛔ never to edit
-- supabase-migrate.yml.
--
-- The relations read below are pg_proc, pg_namespace and pg_roles, plus the
-- functions pg_get_functiondef, aclexplode, acldefault and pg_get_userbyid. All
-- of those are CATALOGUE. A body resolves its own table references at CALL
-- time, so the body checks stay correct on a cluster where none of the
-- application tables exist.
DO $verify$
DECLARE
  -- ⛔ Every variable is DECLAREd up front: plpgsql compiles a DO block WHOLE,
  --    so a missing DECLARE raises 42601 and NONE of the checks below run — it
  --    does not weaken one check, it stops all of them. Since migrations
  --    AUTO-APPLY to PROD on merge, that lands on production.
  v_fn          TEXT := 'enqueue_ledger_refresh_for_strategies';
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
  -- THE NEEDLES, each BOUND TO A SHAPE and held in a variable so every check
  -- states it once and names it in its own failure message.
  --
  -- (1) the activation read. ⛔ ASSEMBLED BY CONCATENATION: written whole it
  --     would be a SECOND raw occurrence of the very statement shape it asserts
  --     occurs once, in a file the mutation runner reads RAW.
  v_flag_needle  TEXT := 'FROM public.' || 'system_flags';
  -- (2) the NULL-safe comparison, BOUND TO THE GUARDED VARIABLE rather than
  --     floating — the bare operator would be satisfied by a null-safe
  --     comparison of any other variable anywhere in the body. Written WHOLE,
  --     and that is safe BY MEASUREMENT: the two gates' A and K twins mutate
  --     the guard line in a way that PRESERVES this token, precisely so the
  --     apply survives and the ARM is the first failure.
  v_null_needle  TEXT := 'v_enabled IS DISTINCT FROM TRUE';
  -- (3) the dormancy instrument's own statement. ⛔ CONCATENATED for the same
  --     reason as (1). It asserts the WRITE, never a cause literal: the cause
  --     literals are what the M1/M2 twins mutate, so a needle on one of them
  --     would abort the apply and the gate would never run.
  v_instr_needle TEXT := 'INSERT INTO public.' || 'cron_runs';
  -- (4) the lifecycle conjunct's own shape, BOUND TO THE COLUMN. ⛔ CONCATENATED,
  --     and ⛔ DELIBERATELY NOT THE WIDENED SET — see the DISJOINTNESS section
  --     of this file's header. The private-admits arm's twin REVERTS the
  --     widening in this very file; a needle on the three-value set would RAISE
  --     here under that arm's own mutation, abort the lane before any arm ran,
  --     and make the arm unobservable. This form is preserved by every spelling
  --     of the set, so it refuses the one thing a text probe can honestly refuse
  --     at apply time: a re-base that dropped the conjunct altogether, which
  --     would admit every lifecycle state including drafts and archives.
  v_life_needle  TEXT := 'AND s.' || 'status IN (';
  -- (5) and (6), asserted ABSENT: the two lifecycle values that must NEVER be
  --     admitted. This is the boundary this phase's own decision record fixes —
  --     admit the owner-only terminal status AND NOTHING ELSE, and do not
  --     mirror ALLOWED_STRATEGY_STATUSES, which would drag the first of these
  --     in. Neither value appears in the executable text today (MEASURED), so a
  --     hit here means the set was widened past its decision.
  v_draft_needle TEXT := '''draft''';
  v_arch_needle  TEXT := '''archived''';
  -- (7) the row-count read that DECIDES between the two invisible causes.
  --     ⛔ CARRIED FORWARD FROM 20260911130000's check 7b, and re-adding it is
  --     NOT optional: this file's own function body (see the ⭐ paragraph in the
  --     dormancy branch) tells the next reader that the apply-time block refuses
  --     when this line is gone. A re-base that drops the check while shipping
  --     that sentence puts a FALSE claim live on PROD — the shape this phase
  --     exists to delete, one layer down. ⛔ CONCATENATED for the same reason as
  --     (1) and (3). Safe by measurement: NO `RED-UNDER-M` twin in either ledger
  --     gate mutates `GET DIAGNOSTICS`, so this needle cannot abort a lane the
  --     way a needle on the widened set would.
  v_diag_needle  TEXT := 'GET ' || 'DIAGNOSTICS v_found';
  -- (8) the RETIRED app-namespace database setting, asserted ABSENT. ⛔ ALSO
  --     CARRIED FORWARD FROM 20260911130000 (its check 8) and also dropped by
  --     this file's re-base. The reason it must exist: an operator on this
  --     platform is refused 42501 when setting an `app.*` database setting, so
  --     a body that reads it can NEVER see TRUE — the function would be
  --     PERMANENTLY DORMANT FOR THE WRONG REASON, and every dormancy row it
  --     wrote would name a cause that is not the cause. Check 5 asserts the
  --     system_flags read is PRESENT; a body carrying BOTH reads passes check 5
  --     and fails nothing else. ⛔ CONCATENATED for the same reason as (1).
  v_guc_needle   TEXT := 'current_' || 'setting(''app.' || 'ledger_refresh_enabled''';
BEGIN
  -- 1. the function landed, it resolves to EXACTLY ONE function, and it takes
  --    ZERO arguments.
  --
  -- ⛔ THE OVERLOAD COUNT IS ASSERTED AND NOT ASSUMED. Every read below keys on
  --    (nspname, proname) with no signature, and `SELECT … INTO` WITHOUT STRICT
  --    takes the first of several rows IN SILENCE. A SECURITY DEFINER overload
  --    created without an explicit REVOKE carries the DEFAULT ACL, which grants
  --    EXECUTE TO PUBLIC — so a callable cross-tenant function could sit in the
  --    catalogue with every check below reporting green.
  SELECT count(*) INTO v_overloads
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = v_fn;
  IF v_overloads > 1 THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.% resolves to % functions in schema public, expected exactly 1. The checks below read (schema, name) with no signature and SELECT INTO without STRICT silently takes the first of several, while the grantee check is narrowed to the zero-argument row and cannot see an overload at all', v_fn, v_overloads;
  END IF;

  SELECT p.pronargs, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
    INTO v_nargs, v_secdef, v_config, v_def_raw
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = v_fn;

  IF v_nargs IS NULL THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.% is missing after its own CREATE OR REPLACE — the re-base did not land', v_fn;
  END IF;
  IF v_nargs <> 0 THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.% takes % argument(s), expected 0 — a caller-supplied threshold on a cross-tenant SECURITY DEFINER function IS the attack surface', v_fn, v_nargs;
  END IF;

  -- 2. SECURITY DEFINER with a pinned search_path, both preserved by the
  --    re-base. These live in the CREATE FUNCTION declaration, OUTSIDE the
  --    dollar-quoted body — exactly the region a body-only copy loses.
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.% is not SECURITY DEFINER — the re-base dropped it, and the activation read then runs as the CALLER against an RLS-enabled table that admits no such role', v_fn;
  END IF;
  --
  -- ⛔ THE VALUE, NOT THE PREFIX. A test that asks only whether SOME proconfig
  --    element BEGINS `search_path=` is satisfied by the EMPTY path and by a
  --    path whose FIRST element is a schema the caller can create objects in.
  --    Whitespace is removed so the comparison survives the server's own
  --    rendering of the SET clause instead of pinning a spacing convention.
  SELECT c INTO v_search_path
    FROM unnest(COALESCE(v_config, ARRAY[]::TEXT[])) AS c
   WHERE c LIKE 'search_path=%';
  IF v_search_path IS NULL THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.% does not pin search_path at all (proconfig=%) — on a SECURITY DEFINER function an unpinned search_path is a privilege-escalation route: the CALLER then decides which schema every unqualified name in the body resolves to', v_fn, v_config;
  END IF;
  IF regexp_replace(v_search_path, '\s', '', 'g') <> 'search_path=public,pg_catalog' THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.% pins search_path to "%", not to the "public, pg_catalog" its own declaration sets. A pin that merely EXISTS proves nothing, and this body runs as a role that is exempt from row security', v_fn, v_search_path;
  END IF;

  -- 3. …and the DEFINER role can actually SEE what it reads. The predicate is
  --    `rolsuper OR rolbypassrls`, NEVER rolbypassrls alone: a SUPERUSER
  --    bypasses row security implicitly with that flag still FALSE, so the
  --    narrow predicate is a FALSE NEGATIVE that aborts a correct apply — on
  --    the auto-apply-to-PROD route, mid-file, with no rollback step.
  --    public.compute_jobs carries FORCE ROW LEVEL SECURITY and this body reads
  --    it directly in the in-flight conjunct, so losing the pair degrades that
  --    read CLOSED and SILENT — byte-identical to "nothing was stale", which is
  --    the exact symptom this phase exists to remove.
  SELECT r.rolname, r.rolbypassrls, r.rolsuper
    INTO v_owner, v_bypass, v_super
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public'
     AND p.proname = v_fn;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Migration 20260917120000: could not resolve the owner of public.% — pg_proc.proowner has no matching pg_roles row', v_fn;
  END IF;
  IF NOT (COALESCE(v_bypass, FALSE) OR COALESCE(v_super, FALSE)) THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.% is owned by role "%" (rolsuper=%, rolbypassrls=%), which is exempt from row security by neither route. As SECURITY DEFINER it reads public.compute_jobs as that role, and that table carries FORCE ROW LEVEL SECURITY — the one clause under which OWNING the table is not an exemption either', v_fn, v_owner, v_super, v_bypass;
  END IF;

  -- 4. THE BODY ITSELF, asserted on the EXECUTABLE text.
  --
  -- ⚠️ pg_get_functiondef returns the body WITH its comments, so a position()
  -- test over the raw definition is a test a COMMENT can satisfy — and this
  -- file's own body carries a long dated comment naming the newly admitted
  -- status AND the two excluded ones. An unstripped probe would be answered by
  -- that prose in BOTH directions: the presence checks would pass on the
  -- comment with the code gone, and the absence checks 9 and 10 would FAIL on
  -- the comment with the code correct. Comments are stripped FIRST and every
  -- assertion below runs on what is left. Lint rule R2-functiondef-comment-strip
  -- mandates this idiom BY RULE for any regex or LIKE over a
  -- pg_get_functiondef result; it is applied here to the position() forms too,
  -- which that rule does not reach.
  --
  -- ⚠️ RESIDUAL, RECORDED not closed: this idiom does not strip `/* … */`.
  -- MEASURED on this body 2026-09-17: 0 occurrences of a block-comment opener.
  --
  -- ⚠️ AND THE TWO DIRECTIONS ARE NOT THE SAME. For the PRESENCE checks a `--`
  -- inside a string literal makes the strip eat real code, which can only cause
  -- a FALSE FAILURE — loud, and safe. For the ABSENCE checks the same accident
  -- is a FALSE PASS: the strip could swallow the very literal they forbid.
  -- MEASURED on this body 2026-09-17: 0 code lines carry a trailing `--`.
  v_def := regexp_replace(v_def_raw, '--[^\n]*', '', 'g');

  IF v_def IS NULL OR length(v_def) < 500 THEN
    RAISE EXCEPTION 'Migration 20260917120000: the comment-stripped definition of public.% is % character(s) — the strip is broken, so every check below would pass over nothing', v_fn, COALESCE(length(v_def), 0);
  END IF;

  -- 5. the guard READS THE ACTIVATION TABLE.
  IF position(v_flag_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.% does not read the activation flag from the settings table (looked for "%") — the fail-closed switch is gone and this function would fan out unconditionally', v_fn, v_flag_needle;
  END IF;

  -- 6. and compares it NULL-SAFELY. `<> TRUE` and `NOT v_enabled` both evaluate
  --    NULL when the read failed or the row is absent, so the IF is not taken
  --    and the body falls THROUGH — they open the flag on exactly the failure
  --    path the guard exists for.
  IF position(v_null_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.% does not compare the activation flag with the NULL-safe form "%" — a NULL-unsafe comparison opens the flag on the read-failure and missing-row paths, which are the two paths this guard exists for', v_fn, v_null_needle;
  END IF;

  -- 7. and a dormant tick whose cause is INVISIBLE still leaves a counted trace.
  IF position(v_instr_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.% no longer writes the dormancy instrument row (looked for "%") — a read that RAISED and a flag row that is absent or invisible to the definer would again reach no counted row, and the second of those is a live platform reporting itself dormant with nothing to read', v_fn, v_instr_needle;
  END IF;

  -- 7b. and the count that DECIDES between the two invisible causes is still
  --     TAKEN. ⛔ CHECK 7 IS NOT ENOUGH, and that is MEASURED rather than
  --     argued: with the NULL-safe `v_enabled IS DISTINCT FROM TRUE` cause
  --     branch, deleting the row-count read leaves EVERY GATE ARM GREEN — the
  --     instrument still writes its row, so arm M1 does not redden and the
  --     corpus exits 0 (the A/B recorded at 20260911130000:465-478 measures
  --     exactly that). This check is therefore the ONLY layer that sees the
  --     deletion, and the one it cannot route around, because it runs at APPLY
  --     rather than in a gate the deletion has already neutralised.
  --
  --     ⛔ RESTORED 2026-09-17, after a pre-apply review found it dropped by
  --     this file's re-base while the function body it ships still told the
  --     reader it existed. A guard removed under prose that claims it is
  --     present is worse than one that was never there: the next reader stops
  --     looking.
  IF position(v_diag_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.% no longer takes the row count of the activation read (looked for "%"). v_found then stays NULL on a read that did NOT raise, the NULL-safe cause branch files an UNMEASURED read as flag_row_invisible_or_absent, and the two invisible causes stop being distinguishable — the instrument still writes its row, so every gate stays GREEN and nothing below this line notices', v_fn, v_diag_needle;
  END IF;

  -- 7c. and the RETIRED app-namespace setting has NOT come back. An `app.*`
  --     database setting cannot be set by an operator on this platform (42501),
  --     so a body that reads it is permanently dormant for a reason no dormancy
  --     row would name. Asserted ABSENT over the comment-stripped text, so a
  --     paragraph describing the retirement does not trip it.
  --
  --     ⛔ RESTORED 2026-09-17 with 7b, same re-base, same review.
  IF position(v_guc_needle IN v_def) <> 0 THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.% still reads the RETIRED app-namespace database setting (found "%"). An operator on this platform is refused 42501 setting it, so that read can never be TRUE and the function would be permanently dormant for a reason no cron_runs cause names', v_fn, v_guc_needle;
  END IF;

  -- 8. THE LIFECYCLE CONJUNCT IS STILL THERE, bound to the column. See needle
  --    (4) and the DISJOINTNESS section for why this is the conjunct's SHAPE
  --    and not the widened SET.
  IF position(v_life_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.% no longer filters candidates on the strategy lifecycle column (looked for "%"). Without that conjunct the fan-out enqueues refreshes for every lifecycle state the staleness view surfaces — drafts that have no factsheet to refresh and archives that are not refresh candidates — which is a WIDER regression than the narrow cohort this migration exists to fix', v_fn, v_life_needle;
  END IF;

  -- 9. and it still EXCLUDES the drafting state.
  IF position(v_draft_needle IN v_def) <> 0 THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.%''s executable text now names the drafting lifecycle state. This phase''s decision record admits the owner-only terminal status AND NOTHING ELSE; mirroring ALLOWED_STRATEGY_STATUSES (analytics-service/routers/cron.py) drags this one in, and a strategy in that state has no factsheet to refresh — every job enqueued for one is worker time spent on nothing', v_fn;
  END IF;

  -- 10. and the archived state.
  IF position(v_arch_needle IN v_def) <> 0 THEN
    RAISE EXCEPTION 'Migration 20260917120000: public.%''s executable text now names the archived lifecycle state. It is not a refresh candidate, it was excluded before this migration and it is excluded by this migration''s own decision record — admitting it here would be an unmeasured widening riding along with a measured one', v_fn;
  END IF;

  -- 11. THE WHOLE EXECUTE GRANTEE SET IS EXACTLY THE OWNER.
  --
  -- ⭐ THE SET, not a subset. 20260907130000's check probed anon and
  --    authenticated with has_function_privilege and PASSED while service_role
  --    still held EXECUTE — a subset check is satisfied by every role it does
  --    NOT name. aclexplode over proacl ENUMERATES the grantees instead of
  --    interrogating a guessed list, so a grantee nobody thought of is a
  --    FAILURE rather than a silence.
  --
  -- ⚠️ COMPARED TO THE OWNER'S NAME, NEVER TO THE LITERAL 'postgres': the
  --    pg-lane boots as whatever role scripts/pg-lane/run.sh created, and a
  --    literal would make this check pass or fail for a reason unrelated to
  --    this file.
  --
  -- ⚠️ COALESCE(proacl, acldefault(…)) is what makes a NULL acl explicit: a
  --    function whose privileges were never touched carries NULL proacl, whose
  --    MEANING is the default ACL — and the default ACL for a function grants
  --    EXECUTE to PUBLIC. Reading NULL as "no grantees" would report the widest
  --    possible state as the tightest.
  --
  -- ⚠️ grantee = 0 is the PUBLIC pseudo-grantee and is mapped to a string here:
  --    pg_get_userbyid(0) is not a role name.
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
    RAISE EXCEPTION 'Migration 20260917120000: could not read the EXECUTE grantee set of public.% — the function is missing, or it carries no EXECUTE aclitem at all, and an empty answer here is indistinguishable from a locked-down one unless it is refused', v_fn;
  END IF;
  IF v_grantees IS DISTINCT FROM v_acl_owner THEN
    RAISE EXCEPTION 'Migration 20260917120000: EXECUTE on public.% is held by [%], expected exactly the owner [%]. A cross-tenant SECURITY DEFINER function that enqueues work for every tenant must be callable by the scheduler alone, and the scheduler IS the owner', v_fn, v_grantees, v_acl_owner;
  END IF;
END $verify$;

COMMIT;
