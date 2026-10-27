-- Migration: the single-key ledger-refresh fan-out re-admits a strategy whose
-- marks have paused once a WEEK instead of once a day.
-- Phase 174 MARKPAUSE / plan 01 (founder decision D-01, 2026-10-27).
--
-- ⚠️ OPS: merging supabase/migrations/** to main applies this file to shared
-- TEST FIRST (supabase-migrate.yml `apply-test`) and then AUTO-APPLIES it to
-- PROD once that TEST apply succeeds. There is NO human stop between the merge
-- and the PROD apply (founder decision 2026-09-23), so every review this file
-- needs happens BEFORE the merge. It redefines ONE live SECURITY DEFINER
-- function, scheduled hourly as `ledger_refresh_fanout`, so the new body runs on
-- the first tick after the apply.
--
-- ⛔ IT IS A FORWARD MIGRATION AND NOT AN EDIT TO AN APPLIED ONE.
-- 20260924120000_ledger_fanout_failure_count.sql (the live single-key body) is
-- applied on PROD and on shared TEST; its single-key body is RE-BASED here,
-- never rewritten there. An applied migration stays byte-identical.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE DECISION (D-01), quoted from the phase CONTEXT
-- ══════════════════════════════════════════════════════════════════════════
-- Founder 2026-10-27, "Re-admit weekly (Recommended)": the single-key fan-out
-- re-admits a strategy whose analytics carry the marks-paused flag once every 7
-- days instead of daily.
--
-- REFINED BY D-04 (founder 2026-10-27, review round 1, "Weekly only after 3
-- days paused"): one transient refusal stamps the flag, and a weekly window from
-- day one froze a deribit/sfox/mt5 strategy's public chart for up to 7 days
-- although marks resumed the next day. The 20-hour cooldown is kept while the
-- pause (the flag's own value, its first trailing day) is under 3 days old, and
-- the cooldown becomes 7 days once the pause is 3 or more days old. A missing or
-- malformed value keeps the 20 hours and never raises inside the tick.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY ONLY THE ATTEMPT COOLDOWN CHANGES — the measured cause
-- ══════════════════════════════════════════════════════════════════════════
-- The fan-out ticks hourly, but its candidate query keeps a per-strategy ATTEMPT
-- cooldown, and that cooldown is the binding bound: a stale strategy costs about
-- one derive a day, not 24. A strategy whose marks PAUSED stays stale for as long
-- as the pause lasts (its returns series stops advancing), so it is re-derived
-- about once a day, forever, each time at the cost of a full re-derive.
--
-- Throttling that to a week needs exactly one thing: a longer cooldown window for
-- a strategy carrying the marks-paused flag. This file therefore changes ONE
-- executable fragment, the window of the attempt cooldown, from a fixed
-- interval to a per-strategy choice between the unchanged short window and a
-- 7-day one.
--
--   * The window is keyed on the last ATTEMPT (a compute_jobs row of either chain
--     hop), never on the last success. Keyed on success, a paused strategy whose
--     derive fails every time would never have a success and would be retried
--     daily again, which is the cost this file removes.
--   * The pause THROTTLES and never EXCLUDES: a paused strategy with no attempt
--     in the last 7 days is admitted. Its derive either clears the flag (marks
--     resumed, so the strategy is back on the daily window) or stamps it again
--     (still paused, so the next attempt is a week away). That weekly derive is
--     also the only recurring path that clears the flag for the venues whose
--     marks resume outside the daily-PnL set, so excluding a paused strategy for
--     good would freeze its public factsheet.
--   * compute_jobs retention deletes finished rows after 30 days and failed rows
--     after 90 (scripts/prod-prober/cron-manifest.json), both longer than 7, so
--     the weekly window is never erased early by the sweeper.
--
-- ══════════════════════════════════════════════════════════════════════════
-- SCOPE BOUNDARY — the sites this file deliberately does NOT touch
-- ══════════════════════════════════════════════════════════════════════════
-- ⛔ The staleness view (public.ledger_refresh_staleness) is UNCHANGED. Its
--    verdict is built to fail toward stale and its static gate bans time columns
--    in that verdict; the pause test belongs to the CALLER's cooldown, not to the
--    view, because a pause test inside the view would fail open and leak into
--    the composite arm.
-- ⛔ The composite fan-out is UNCHANGED (it is pointed at by description, not by
--    identifier, because gate 10c of analytics-service/tests/
--    test_ledger_refresh_gates.py allows only the files DEFINING it to spell its
--    name) and is not re-created here: Phase 161.1 D-01 keeps composites on the
--    fan-out coverage they have. 20260924120000 stays its last definition, and
--    supabase/tests/test_ledger_refresh_composite_arm.sql keeps pointing at it.
-- ⛔ The failed-attempt cooldown, the in-flight guard, the per-venue cap, the
--    per-tick limit, the activation guard, the dormancy instrument, the failure
--    instrument, the lock keys and the return value are all byte-identical to
--    20260924120000. This file registers no schedule, activates nothing and runs
--    no fan-out.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — the PROD body this CREATE OR REPLACE overwrites
-- ══════════════════════════════════════════════════════════════════════════
-- ONE entry, because exactly one function body is replaced. The gate compares
-- the COMMITTED SNAPSHOT (supabase/schema/functions/) against PROD's live body;
-- on any function-changing migration PR the two necessarily disagree once the
-- snapshot carries the new body, and the pragma means "I read PROD's body and
-- intend to overwrite it".
--
-- MEASURED 2026-10-27 with the gate's own normalizer aimed at the committed
-- snapshot (which stands in for PROD):
--
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql \
--     supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql
--
-- The acked hash is the `live` column (the FIFTH field) of that output, never
-- `--hash` of a file:
--
-- prod-body-ack: 864283ec1007571f56f829bb8bebdc268e0af76151303954d26ae59fbe97b909
--
-- ⚠️ THE ACK IS OF THE COMMITTED SNAPSHOT, WHICH STANDS IN FOR PROD. It is EARNED
-- only if VAC-04 on the PR reports that SAME hash for PROD. If it differs, PROD
-- drifted OUT OF BAND: fold the difference into this migration and re-derive,
-- never edit the pragma to match a gate log.
--
-- ══════════════════════════════════════════════════════════════════════════
-- RE-BASE DISCIPLINE (DRIFT-02)
-- ══════════════════════════════════════════════════════════════════════════
-- The LEFT side of the re-base is the single-key body inside the first
-- dollar-quoted block of 20260924120000, cross-checked against the committed snapshot
-- supabase/schema/functions/enqueue_ledger_refresh_for_strategies.sql (whose
-- source migration is that same file). MEASURED 2026-10-27 before writing a line:
-- no migration newer than 20260924120000 defines the function.
--
-- EXACTLY ONE EXECUTABLE EDIT was made to that body: the attempt cooldown's fixed
-- window becomes a per-strategy choice, with the comment block above it. Every
-- other line is that body's, byte for byte, the dollar-quote TAG and the leading
-- whitespace of every burst literal included. Plus, outside the body: the
-- function COMMENT gains one sentence, and the REVOKE is re-issued.
--
-- ⚠️ Regenerating supabase/schema/functions/ (`npm run schema:functions`) is the
-- ship step's job: the snapshot is what VAC-04 and `npm run schema:functions:check`
-- read, and it is generated from the migrations, never edited by hand.
--
-- ══════════════════════════════════════════════════════════════════════════
-- DISJOINTNESS — what STEP 2 asserts vs. what the gate arms MUTATE
-- ══════════════════════════════════════════════════════════════════════════
-- A verification needle that a gate arm MUTATES aborts the apply: the gate then
-- never runs, no arm can be the first failure, and the mutation runner scores a
-- defect. WAIVED_CEILING in scripts/mutation-runner/run.mjs is 0 (read it BY
-- SYMBOL), so such an intersection is designed out here. scripts/mutation-runner/
-- GRAMMAR.md records a real instance under its rule 2.
--
-- The three twins this phase adds in supabase/tests/test_ledger_refresh_fanout.sql
-- each REWRITE a fragment but keep its original token inside the replacement (the
-- 7-day window as a prefix of an arithmetic expression, the flag key inside a
-- widened test). That is what lets STEP 2 needle both tokens and still have the
-- ARM, not the apply, be the first failure. Every needle carried forward from
-- 20260924120000 keeps the disjointness it measured there.
--
-- ⛔ NO GATE `find` STRING IS REPRODUCED ANYWHERE IN THIS FILE, deliberately. The
-- mutation runner counts `occurrences` over the RAW FILE TEXT, comments
-- included, so a verbatim paste of any arm's needle in this header would be one
-- more occurrence, the arm's measured count would be wrong, and the run would
-- report occurrence-mismatch: the mutation not applied, so the arm not tested.
-- The needles STEP 2 uses are ASSEMBLED BY CONCATENATION for the same reason.
--
-- ⛔ CATALOGUE READS ONLY in STEP 2, never a row count
-- ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]); see STEP 2's own note.
--
-- ══════════════════════════════════════════════════════════════════════════
-- BLAST RADIUS
-- ══════════════════════════════════════════════════════════════════════════
-- PROD effect today: none. MEASURED 2026-10-27 (counts only, read-only, marker
-- query first): of the strategy_analytics rows on PROD, none carries the
-- marks-paused flag. The change bounds the cost of the FIRST pause; it can only
-- REMOVE candidates from a tick (a paused strategy inside its week), never add
-- one, and every other strategy keeps the 20-hour cooldown it has today.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: the single-key fan-out, re-based with one edit
-- --------------------------------------------------------------------------
-- Re-based on the single-key body of 20260924120000 (its first dollar-quoted block),
-- which the committed snapshot supabase/schema/functions/
-- enqueue_ledger_refresh_for_strategies.sql carries. The ONE edit enumerated in
-- the RE-BASE DISCIPLINE section above and nothing else; every other line of the
-- body is that body's, byte for byte.
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
                   -- Phase 174 MARKPAUSE (D-01, "Re-admit weekly", refined by
                   -- D-04): a strategy whose marks have been paused for 3 days
                   -- or more keeps this cooldown for 7 days instead of 20
                   -- hours, so a long-paused series is re-derived once a week
                   -- and not once a day. The flag's value is the pause's first
                   -- trailing day (an ISO date string), shape-tested and compared as
                   -- TEXT so a malformed value can never raise inside the tick and
                   -- keeps the 20 hours. A younger
                   -- pause, or a missing value, keeps the 20 hours, so a one-day
                   -- refusal that clears the next day is not frozen for a week.
                   -- Still keyed on the ATTEMPT, never the success, and a
                   -- throttle, never an exclusion: with no attempt in 7 days it
                   -- is admitted again.
                   AND cj.created_at > now() - CASE
                         WHEN EXISTS (
                           SELECT 1
                             FROM public.strategy_analytics sa
                            WHERE sa.strategy_id = lrs.strategy_id
                              AND (sa.data_quality_flags ->> 'marks_trailing_since') ~ '^\d{4}-\d{2}-\d{2}$'
                              AND sa.data_quality_flags ->> 'marks_trailing_since' <= to_char(CURRENT_DATE - 3, 'YYYY-MM-DD')
                         ) THEN INTERVAL '7 days'
                         ELSE INTERVAL '20 hours'
                       END
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
  'jobs inserted. Phase 174: a strategy '
  'whose marks have been paused for 3 days or more keeps the attempt cooldown for '
  '7 days instead of 20 hours.';

-- service_role is REVOKEd alongside PUBLIC, anon and authenticated, and the
-- REVOKE is RE-ISSUED rather than trusted to survive CREATE OR REPLACE (the
-- precedent is 20260911130000, whose header records a service_role EXECUTE that
-- survived a green migration). STEP 2's check 11 asserts the outcome.
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
-- ⛔ THIS BLOCK MUST NEVER CALL THE FUNCTION. A smoke-test invocation at
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
-- ⚠️ This block is 20260924120000's, narrowed to the ONE function this file
-- re-creates (its loop over two functions is gone) and extended by check 12.
-- 20260911130000's check 10 (TRUNCATE on public.cron_runs) is NOT carried:
-- it verified a REVOKE that this file does not make, and carrying it would add
-- a way for this apply to refuse that has nothing to do with these bodies.
DO $verify$
DECLARE
  -- ⛔ Every variable is DECLAREd up front: plpgsql compiles a DO block WHOLE,
  --    so a missing DECLARE raises 42601 and NONE of the checks below run.
  --    Since migrations AUTO-APPLY to PROD on merge, that lands on production.
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
  --     the fan-out does not admit. MEASURED 2026-10-27 on the comment-stripped
  --     body: 0 occurrences of either quoted value.
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
  -- (13) ⭐ NEW in Phase 174: the marks-paused window. THREE needles, each the
  --      TOKEN a twin keeps inside its replacement, never the whole fragment a
  --      twin rewrites: the flag key (the paused-test twin widens the test around
  --      it), the seven-day interval (the window twins rewrite it as the
  --      prefix of an arithmetic expression) and the three-day cutoff (the age
  --      twin shifts it by arithmetic). So the apply survives each twin and
  --      the ARM, not the apply, is the first failure. ⛔ All three are CONCATENATED,
  --      for the reason given at the top of this list.
  v_pause_needle TEXT := 'marks_trailing_' || 'since';
  v_week_needle  TEXT := 'INTERVAL ''7 ' || 'days''';
  --      The three-day age test (D-04): the cutoff date expression, kept as a
  --      token by the age twin for the same reason.
  v_age_needle   TEXT := 'CURRENT_' || 'DATE - 3';
BEGIN
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
    RAISE EXCEPTION 'Migration 20261030120000: public.% resolves to % functions in schema public, expected exactly 1. The checks below read (schema, name) with no signature and SELECT INTO without STRICT silently takes the first of several, while the grantee check is narrowed to the zero-argument row and cannot see an overload at all', v_fn, v_overloads;
  END IF;

  SELECT p.pronargs, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
    INTO v_nargs, v_secdef, v_config, v_def_raw
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = v_fn;

  IF v_nargs IS NULL THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% is missing after its own CREATE OR REPLACE — the re-base did not land', v_fn;
  END IF;
  IF v_nargs <> 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% takes % argument(s), expected 0 — a caller-supplied threshold on a cross-tenant SECURITY DEFINER function IS the attack surface', v_fn, v_nargs;
  END IF;

  -- 2. SECURITY DEFINER with a pinned search_path, both preserved by the
  --    re-base. ⛔ THE VALUE, NOT THE PREFIX: a test that asks only whether
  --    SOME proconfig element BEGINS `search_path=` is satisfied by the EMPTY
  --    path and by a path led by a schema the caller can create objects in.
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% is not SECURITY DEFINER — the re-base dropped it, and the activation read then runs as the CALLER against an RLS-enabled table that admits no such role', v_fn;
  END IF;
  SELECT c INTO v_search_path
    FROM unnest(COALESCE(v_config, ARRAY[]::TEXT[])) AS c
   WHERE c LIKE 'search_path=%';
  IF v_search_path IS NULL THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% does not pin search_path at all (proconfig=%) — on a SECURITY DEFINER function an unpinned search_path is a privilege-escalation route: the CALLER then decides which schema every unqualified name in the body resolves to', v_fn, v_config;
  END IF;
  IF regexp_replace(v_search_path, '\s', '', 'g') <> 'search_path=public,pg_catalog' THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% pins search_path to "%", not to the "public, pg_catalog" its own declaration sets. A pin that merely EXISTS proves nothing, and this body runs as a role that is exempt from row security', v_fn, v_search_path;
  END IF;

  -- 3. the DEFINER role is exempt from row security: `rolsuper OR
  --    rolbypassrls`, NEVER rolbypassrls alone (a superuser bypasses row
  --    security with that flag still FALSE). public.compute_jobs carries
  --    FORCE ROW LEVEL SECURITY and the body reads it directly.
  SELECT r.rolname, r.rolbypassrls, r.rolsuper
    INTO v_owner, v_bypass, v_super
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public'
     AND p.proname = v_fn;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Migration 20261030120000: could not resolve the owner of public.% — pg_proc.proowner has no matching pg_roles row', v_fn;
  END IF;
  IF NOT (COALESCE(v_bypass, FALSE) OR COALESCE(v_super, FALSE)) THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% is owned by role "%" (rolsuper=%, rolbypassrls=%), which is exempt from row security by neither route. As SECURITY DEFINER it reads public.compute_jobs as that role, and that table carries FORCE ROW LEVEL SECURITY — the one clause under which OWNING the table is not an exemption either', v_fn, v_owner, v_super, v_bypass;
  END IF;

  -- 4. THE BODY ITSELF, asserted on the EXECUTABLE text. pg_get_functiondef
  --    returns the body WITH its comments, and the body carries long comments
  --    that name the very shapes asserted below, so comments are stripped
  --    FIRST (lint rule R2-functiondef-comment-strip's idiom).
  --    ⚠️ RESIDUAL, RECORDED not closed: `--[^\n]*` does not strip `/* … */`.
  --    MEASURED 2026-10-27 on this body: 0 block-comment openers, and 0 code
  --    lines carrying a trailing `--`.
  v_def := regexp_replace(v_def_raw, '--[^\n]*', '', 'g');

  IF v_def IS NULL OR length(v_def) < 500 THEN
    RAISE EXCEPTION 'Migration 20261030120000: the comment-stripped definition of public.% is % character(s) — the strip is broken, so every check below would pass over nothing', v_fn, COALESCE(length(v_def), 0);
  END IF;

  -- 5. the guard READS THE ACTIVATION TABLE.
  IF position(v_flag_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% does not read the activation flag from the settings table (looked for "%") — the fail-closed switch is gone and this function would fan out unconditionally', v_fn, v_flag_needle;
  END IF;

  -- 6. and compares it NULL-SAFELY.
  IF position(v_null_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% does not compare the activation flag with the NULL-safe form "%" — a NULL-unsafe comparison opens the flag on the read-failure and missing-row paths, which are the two paths this guard exists for', v_fn, v_null_needle;
  END IF;

  -- 7. BOTH cron_runs writes are still there: the dormancy instrument and the
  --    failure instrument. Counted, for the reason given at needle (3).
  v_instr_count := (length(v_def) - length(replace(v_def, v_instr_needle, ''))) / length(v_instr_needle);
  IF v_instr_count <> 2 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% writes public.cron_runs % time(s) in its executable text (looked for "%"), expected 2 — the dormancy instrument and the failure instrument. One of the two counted traces is gone, and the survivor would satisfy a presence test on its own', v_fn, v_instr_count, v_instr_needle;
  END IF;

  -- 7b. the count that DECIDES between the two invisible dormant causes is
  --     still TAKEN. With the NULL-safe cause branch, deleting it leaves every
  --     gate GREEN (measured in 20260911130000), so this apply-time check is
  --     the only layer that sees the deletion.
  IF position(v_diag_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% no longer takes the row count of the activation read (looked for "%"). v_found then stays NULL on a read that did NOT raise, the NULL-safe cause branch files an UNMEASURED read as flag_row_invisible_or_absent, and the two invisible causes stop being distinguishable while every gate stays GREEN', v_fn, v_diag_needle;
  END IF;

  -- 7c. the RETIRED app-namespace setting has NOT come back.
  IF position(v_guc_needle IN v_def) <> 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% still reads the RETIRED app-namespace database setting (found "%"). An operator on this platform is refused 42501 setting it, so that read can never be TRUE and the function would be permanently dormant for a reason no cron_runs cause names', v_fn, v_guc_needle;
  END IF;

  -- 8. the lifecycle conjunct is still there, bound to the column.
  IF position(v_life_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% no longer filters candidates on the strategy lifecycle column (looked for "%"). Without that conjunct the fan-out enqueues refreshes for every lifecycle state the staleness view surfaces, drafts and archives included', v_fn, v_life_needle;
  END IF;

  -- 9. and it still EXCLUDES the drafting state…
  IF position(v_draft_needle IN v_def) <> 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.%''s executable text now names the drafting lifecycle state. Neither fan-out admits it: a strategy in that state has no factsheet to refresh, so every job enqueued for one is worker time spent on nothing', v_fn;
  END IF;

  -- 10. …and the archived state.
  IF position(v_arch_needle IN v_def) <> 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.%''s executable text now names the archived lifecycle state. It is not a refresh candidate for either fan-out, and admitting it here would be an unmeasured widening riding along with an unrelated change', v_fn;
  END IF;

  -- 10b. ⭐ NEW: the failure instrument RECORDS WHICH CANDIDATE FAILED.
  IF position(v_fail_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% no longer records the failed-target list in its failure row (looked for "%"). A tick in which a candidate failed would again leave no readable record of WHICH candidate, and the per-candidate WARNING that remains carries no identifier by design and has no consumer', v_fn, v_fail_needle;
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
    RAISE EXCEPTION 'Migration 20261030120000: public.% has no failure-instrument block (looked for "%"), so a tick with failed candidates writes nothing', v_fn, v_block_needle;
  END IF;
  IF position(v_lock_needle IN substr(v_def, 1, v_fail_pos)) = 0
     OR position(v_lock_needle IN substr(v_def, v_fail_pos)) <> 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.%''s failure-instrument block ("%") is not after the LAST advisory unlock ("%"). Placed before it, a failing instrument write reaches the lock-holding block''s handler, which unlocks and re-raises, and the whole tick rolls back with every enqueue that succeeded — the outcome this migration''s D-10 exists to refuse', v_fn, v_block_needle, v_lock_needle;
  END IF;

  -- 10d. ⭐ NEW (164.6 review fix, HIGH-2): the candidate query still skips a
  --      candidate named in a recent failure row. Without it a candidate
  --      whose enqueue raises takes the same slot on every tick.
  IF position(v_cool_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% no longer reads the failure rows back as a cooldown (looked for "%"). A candidate whose enqueue raises then takes the same slot on every tick and starves the healthy candidates behind it', v_fn, v_cool_needle;
  END IF;

  -- 10e. ⭐ AMENDED (164.6 round-2 review fix): a tick that enqueued
  --      nothing and could not write its failure row still RAISES, and
  --      raises AFTER the last unlock, so the lock is never held across it.
  v_raise_pos := position(v_raise_needle IN v_def);
  IF v_raise_pos = 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% no longer re-raises a failure-row write that failed on a tick that enqueued nothing (looked for "%"). Such a tick then returns 0 with no row and a WARNING nothing reads, so both the prober and the failed-attempt cooldown lose it', v_fn, v_raise_needle;
  END IF;
  IF position(v_lock_needle IN substr(v_def, v_raise_pos)) <> 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.%''s failure-row re-raise ("%") is not after the LAST advisory unlock ("%"). Raised before it, the tick can end holding the lock', v_fn, v_raise_needle, v_lock_needle;
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
    RAISE EXCEPTION 'Migration 20261030120000: could not read the EXECUTE grantee set of public.% — the function is missing, or it carries no EXECUTE aclitem at all, and an empty answer here is indistinguishable from a locked-down one unless it is refused', v_fn;
  END IF;
  IF v_grantees IS DISTINCT FROM v_acl_owner THEN
    RAISE EXCEPTION 'Migration 20261030120000: EXECUTE on public.% is held by [%], expected exactly the owner [%]. A cross-tenant SECURITY DEFINER function that enqueues work for every tenant must be callable by the scheduler alone, and the scheduler IS the owner', v_fn, v_grantees, v_acl_owner;
  END IF;

  -- 12. ⭐ NEW in Phase 174: the attempt cooldown still has a marks-paused
  --     window, i.e. the executable text still reads the flag key AND still
  --     spells the seven-day interval. Presence of both is the most a text probe
  --     can honestly say about a CASE whose branches the gate's P1, P2 and P3
  --     arms measure BEHAVIOURALLY on real rows; the pair refuses a re-base that
  --     dropped the window and fell back to the daily cooldown, which is the cost
  --     this migration exists to remove. Neither needle is a fragment any twin
  --     deletes (see needle 13).
  IF position(v_pause_needle IN v_def) = 0 OR position(v_week_needle IN v_def) = 0 OR position(v_age_needle IN v_def) = 0 THEN
    RAISE EXCEPTION 'Migration 20261030120000: public.% no longer carries the marks-paused attempt window (looked for "%", "%" and "%"). A strategy whose marks paused would again be re-derived every 20 hours for as long as the pause lasts, or one whose pause is under 3 days old would be frozen for a week', v_fn, v_pause_needle, v_week_needle, v_age_needle;
  END IF;

  RAISE NOTICE 'Migration 20261030120000: the single-key ledger fan-out re-based — a strategy whose marks have been paused for 3 days or more is re-admitted after 7 days instead of 20 hours; every other stale strategy keeps the 20-hour cooldown; the composite fan-out, the staleness view and the return value are untouched. NOTHING scheduled, NOTHING activated';
END $verify$;
COMMIT;
