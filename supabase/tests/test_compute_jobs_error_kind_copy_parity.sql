-- Test: compute_jobs_error_kind_check and computation_error_copy's CASE do not
-- drift apart (Phase 162 review finding A-3).
--
-- Root cause it guards
-- --------------------
-- `computation_error_copy` (mig 20260826120000) is the ONLY value the status
-- bridge writes into strategy_analytics.computation_error, which renders
-- verbatim in the wizard failure envelope and on the portfolio dashboard's stale
-- warning. It is `LANGUAGE sql` and `IMMUTABLE`, so it CANNOT RAISE: an
-- error_kind it does not model is not an error, it silently falls to the ELSE
-- arm and becomes indistinguishable from NULL. There is no log line, no Sentry
-- event, and no failing query — the user just reads the cautious default.
--
-- That makes widening the CHECK a SILENT way to degrade user-facing copy. It has
-- already happened once in substance: the orphaned-running reaper wrote
-- error_kind = 'permanent' for jobs whose WORKER DIED (20260817120000), so those
-- users were told "retrying alone will not resolve it" — false, and not
-- self-healing, because the 20260819130500 readmit sweep is csv-only and is
-- additionally blocked once computation_status reads 'failed'. Mig
-- 20260826140000 fixes that by adding a FOURTH kind, 'orphaned', with
-- retry-positive copy. This test is what keeps the FIFTH kind from arriving
-- without one.
--
-- What it asserts, in both directions:
--   Part 1  every value compute_jobs_error_kind_check ADMITS gets its own
--           modelled sentence — i.e. none of them collapses onto the ELSE
--           default. Asserted BEHAVIOURALLY, by calling the function, so no
--           comment or regex can satisfy it.
--   Part 2  every literal the CASE branches on is a value the CHECK ADMITS — a
--           WHEN arm for an impossible kind is dead code, and dead code here
--           reads as coverage the surface does not have. Asserted on the
--           COMMENT-STRIPPED body, with a canary proving the stripper ran.
--   Part 3  the 'orphaned' arm specifically, and its DIRECTION. Parts 1-2 pin
--           that every kind is modelled; they cannot tell WHICH sentence went
--           where, so a swap of the 'orphaned' and 'permanent' bodies satisfies
--           both while re-committing the exact defect F-3 fixed.
--
-- pgTAP is not set up in this project (CLAUDE.md / Lane B), so assertions RAISE
-- EXCEPTION on failure; a clean run prints NOTICEs only. Run under
-- `psql -v ON_ERROR_STOP=1`. Run order: AFTER migrations 20260826120000 and
-- 20260826140000. Zero side effects — no seeding, no writes, safe on a shared
-- test project.
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4.1, PGCRON-LANE). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
--
-- ⚠️ THIS FILE WAS THE CORPUS'S LAST `pending:` FILE, and it was blocked only
-- through its APPLY LIST — never through its own text, which names pg_cron
-- nowhere. Migration 20260826140000 is the ONLY migration that widens
-- compute_jobs_error_kind_check to admit 'orphaned' (Parts 1 and 3 both depend
-- on that), and it hard-RAISEs `0A000 / feature_not_supported` at :206-209 when
-- `pg_extension` has no pg_cron — so the whole apply aborted before this gate
-- could run at all. That is why 20260513094906_enable_pg_cron.sql is listed
-- AHEAD of both 20260817120000 and 20260826140000: both RAISE on that same
-- condition, 20260817120000 first. MEASURED 2026-09-05 on the lane: with the
-- enabling migration in place neither RAISE fires and the baseline exits 0.
-- ⚠️ The other non-obvious entries, each with its MEASURED reason:
--   * 20260516104201 — without it 20260826140000:377 aborts with
--     `42P13 cannot change return type of existing function` on
--     get_user_compute_jobs. It is the migration that last re-based that
--     function's OUT columns, and 20260826140000 re-bases it again.
--   * 20260529180000 — 20260826140000's self-verify arm (c) calls
--     mark_compute_job_failed and asserts it still REFUSES 'orphaned'.
--   * 20260826120000 — defines computation_error_copy, which all three Parts
--     call; 20260826140000's arm (e) reads it too and names the ordering.
--   * 27-fixture-strategy-analytics-computation-error.sql — the stand-in for
--     strategy_analytics.computation_error that the 20260825150000 /
--     20260826120000 bridge re-base writes.
-- This file has NO conditional skip of its own, so there is no skip line to
-- silence: the count of skip lines carrying its own `psql:supabase/tests/…`
-- prefix is 0. (The 10 `does not exist, skipping` NOTICEs in the lane's
-- transcript are PostgreSQL's own DDL chatter from the apply phase.)
--
-- ⚠️ THREE sections, one per Part: `1/A-3`, `2/A-3`, `3/F-3`. Several raises
-- inside a Part all carry that Part's identity, so a Part is ONE arm with
-- several identities — the arm-unit rule, not an under-count.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260529180000_fix_mark_compute_job_failed_error_kind_column.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260817120000_retention_orphaned_running_terminalize.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260826140000_compute_jobs_error_kind_orphaned.sql"]}

-- ==========================================================================
-- Part 1 — CHECK ⊆ CASE. Every admitted kind has its own modelled sentence.
-- ==========================================================================
-- RED-UNDER: widen compute_jobs_error_kind_check in migration 20260826140000
--            with a FIFTH kind — `IN ('transient', 'permanent', 'unknown',
--            'orphaned', 'stalled')` — without adding a WHEN arm for it to
--            computation_error_copy. That is the exact carry-forward this Part
--            exists to refuse, and it is SILENT in the strongest sense the
--            codebase has: computation_error_copy is `LANGUAGE sql` and
--            `IMMUTABLE`, so it cannot RAISE; the unmodelled kind falls to the
--            ELSE arm and the user reads the cautious default — no log line, no
--            Sentry event, no failing query, and a sentence indistinguishable
--            from the one a NULL kind gets.
-- ⚠️ The mutated CHECK applies PERFECTLY CLEAN, which is the whole reason this
--    Part has to exist. That migration's own self-verify arm (a) round-trips
--    only the four kinds it knows (:498-506) and arm (b) only proves the
--    constraint still REJECTS `a_kind_added_after_20260826` (:508-515) — a
--    widened-by-one set satisfies both. Nothing between the constraint and the
--    user's screen looks at the pair.
-- RED-UNDER-M: {"arm":"1/A-3","apply":[{"kind":"edit","file":"supabase/migrations/20260826140000_compute_jobs_error_kind_orphaned.sql","find":"  CHECK (error_kind IN ('transient', 'permanent', 'unknown', 'orphaned'));","replace":"  CHECK (error_kind IN ('transient', 'permanent', 'unknown', 'orphaned', 'stalled'));","occurrences":1}]}
DO $$
DECLARE
  v_condef  TEXT;
  v_kinds   TEXT[];
  v_kind    TEXT;
  v_default TEXT;
  v_missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_condef
    FROM pg_constraint c
   WHERE c.conname = 'compute_jobs_error_kind_check'
     AND c.conrelid = 'public.compute_jobs'::regclass;

  IF v_condef IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1/A-3): no constraint named compute_jobs_error_kind_check on public.compute_jobs. Without it error_kind is an open TEXT column, this whole test degenerates to an empty loop that passes, and any value a writer invents reaches users as the cautious default sentence.';
  END IF;

  -- Literals out of the deployed constraint expression. pg_get_constraintdef
  -- renders the IN-list as `= ANY (ARRAY['transient'::text, ...])`.
  SELECT array_agg(m[1] ORDER BY m[1])
    INTO v_kinds
    FROM regexp_matches(v_condef, '''([^'']+)''::text', 'g') AS m;

  IF v_kinds IS NULL OR array_length(v_kinds, 1) IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1/A-3): extracted ZERO kind literals from compute_jobs_error_kind_check (definition: %). An empty extraction makes the loop below vacuous — it would pass over any function body at all. The constraint has changed shape (a compound or non-IN CHECK); update this extraction deliberately rather than letting it silently match nothing.', v_condef;
  END IF;

  -- The ELSE sentence, obtained by feeding a kind that is (asserted below) NOT
  -- in the constraint. This is the value a MODELLED kind must never equal.
  v_default := computation_error_copy('__unmodelled_kind_for_a3_probe__');
  IF v_default IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1/A-3): computation_error_copy returned NULL for an unrecognised kind. It must be TOTAL — branch (b-prime) of sync_strategy_analytics_status assigns its result unconditionally, having retired its COALESCE precisely because of that property, so a NULL blanks computation_error over a LIVE failure and the user sees an empty error on a failed sync.';
  END IF;
  IF '__unmodelled_kind_for_a3_probe__' = ANY (v_kinds) THEN
    RAISE EXCEPTION 'TEST FAILED (1/A-3): the probe kind used to sample the ELSE arm is itself admitted by the CHECK, so the comparison below is against a modelled sentence and every arm passes trivially. Change the probe literal.';
  END IF;

  FOREACH v_kind IN ARRAY v_kinds
  LOOP
    IF computation_error_copy(v_kind) = v_default THEN
      v_missing := v_missing || v_kind;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1/A-3): compute_jobs_error_kind_check admits % but computation_error_copy has NO arm for them — they fall through to the ELSE default, which is the same sentence a NULL kind gets. The CHECK was widened without widening the copy. That is SILENT: the function is IMMUTABLE/LANGUAGE sql and cannot RAISE, so an unmodelled kind produces no error anywhere — the only symptom is a user reading generic copy about a failure the system could have described. Add a WHEN arm (and say what is TRUE of that kind''s retryability, which is the only thing the copy is for), or narrow the CHECK back.', v_missing;
  END IF;

  RAISE NOTICE 'Part 1 OK: all % kinds admitted by compute_jobs_error_kind_check (%) have their own modelled sentence in computation_error_copy.',
    array_length(v_kinds, 1), array_to_string(v_kinds, ', ');
END $$;

-- ==========================================================================
-- Part 2 — CASE ⊆ CHECK. No arm branches on an impossible kind.
-- ==========================================================================
-- RED-UNDER: add a `WHEN 'stalled' THEN` arm to computation_error_copy in
--            migration 20260826120000 without adding 'stalled' to
--            compute_jobs_error_kind_check. The arm is then DEAD CODE, and
--            dead code here is worse than an absent arm: it reads as coverage
--            for a class the column can never hold, so the next person to widen
--            the CHECK sees a WHEN for their kind, assumes it is handled, and
--            ships — which lands them straight in the Part 1 defect.
-- ⚠️ Placed INSIDE the CASE, immediately after the 'orphaned' arm's sentence
--    and before the ELSE, via `insert-after` — the anchor is that sentence
--    line, which is where the CASE's last real arm ends. It is deliberately
--    written as code, not as a comment: Part 2 strips comments out of
--    pg_get_functiondef before matching, so a commented WHEN would prove
--    nothing about the extraction.
-- ⚠️ The mutated function applies clean. That migration's own arm (H5)
--    (:1338-1341) counts DISTINCT sentences over exactly {permanent,
--    transient, unknown, orphaned, NULL, a_kind_added_after_20260826} and
--    requires 4 — 'stalled' is in none of those, so the count is unchanged, and
--    no other arm of either migration enumerates the CASE's WHEN literals.
-- RED-UNDER-M: {"arm":"2/A-3","apply":[{"kind":"insert-after","file":"supabase/migrations/20260826120000_computation_error_curated_copy.sql","anchor":"      'Analytics stopped before it finished because the process running it went away. Nothing is wrong with this strategy — retry the sync.'","text":"\n    WHEN 'stalled' THEN\n      'Analytics stopped part-way through. Retry the sync.'","occurrences":1}]}
DO $$
DECLARE
  v_def     TEXT := pg_get_functiondef('computation_error_copy(text)'::regprocedure);
  v_bare    TEXT;
  v_condef  TEXT;
  v_kinds   TEXT[];
  v_arms    TEXT[];
  v_dead    TEXT[];
BEGIN
  -- ⛔ COMMENT-STRIPPED before any token match. pg_get_functiondef RETURNS
  -- COMMENTS, and this function's comments discuss every kind by name — so a
  -- match against the raw definition cannot tell an ARM from a SENTENCE ABOUT
  -- an arm.
  v_bare := regexp_replace(v_def, '--[^\n]*', '', 'g');

  -- The stripper actually ran. Both directions, mirroring the arm-D shape in
  -- test_create_wizard_strategy_for_key.sql: if the canary is absent from the
  -- RAW definition too, this arm cannot distinguish "the stripper worked" from
  -- "there was nothing to strip", and deleting the canary would silently disarm
  -- the extraction below (the F-5 finding, one migration over).
  IF position('CANARY_162_F3_PROSE_ONLY' IN v_bare) = 0
     AND position('CANARY_162_F3_PROSE_ONLY' IN v_def) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/A-3): the prose-only canary CANARY_162_F3_PROSE_ONLY is absent from the RAW definition of computation_error_copy, so this arm cannot tell "the comment stripper worked" from "there was nothing to strip" — and the arm extraction below loses its only evidence that it reads CODE rather than COMMENTARY. Restore the canary comment in the function body (migration 20260826120000).';
  END IF;
  IF position('CANARY_162_F3_PROSE_ONLY' IN v_bare) > 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/A-3): the comment stripper did not strip — the prose-only canary survived into the stripped body. Every WHEN literal matched below may now be COMMENTARY rather than a real arm. Fix the regexp_replace; do NOT weaken the extraction to compensate.';
  END IF;

  SELECT array_agg(DISTINCT m[1])
    INTO v_arms
    FROM regexp_matches(v_bare, 'WHEN\s+''([^'']+)''\s+THEN', 'g') AS m;

  IF v_arms IS NULL OR array_length(v_arms, 1) IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2/A-3): extracted ZERO WHEN arms from the stripped body of computation_error_copy. Either every arm has been deleted — in which case EVERY kind now reads the cautious default and the whole curated-copy surface is gone — or the CASE has been rewritten into a shape this extraction does not recognise. Both need a human; do not let this pass as "no arms, nothing to check".';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_condef
    FROM pg_constraint c
   WHERE c.conname = 'compute_jobs_error_kind_check'
     AND c.conrelid = 'public.compute_jobs'::regclass;

  SELECT array_agg(m[1])
    INTO v_kinds
    FROM regexp_matches(COALESCE(v_condef, ''), '''([^'']+)''::text', 'g') AS m;

  SELECT array_agg(a ORDER BY a) INTO v_dead
    FROM unnest(v_arms) AS a
   WHERE NOT (a = ANY (COALESCE(v_kinds, ARRAY[]::TEXT[])));

  IF array_length(v_dead, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2/A-3): computation_error_copy branches on % but compute_jobs_error_kind_check does NOT admit those values, so those arms are unreachable. Dead arms are worse than absent ones here: they read as coverage for a class the column can never hold, so the next person to widen the CHECK sees a WHEN for their kind, assumes it is handled, and ships. Either the CHECK was narrowed without pruning the CASE, or an arm was written for a kind that was never added to the CHECK.', v_dead;
  END IF;

  RAISE NOTICE 'Part 2 OK: every CASE arm in computation_error_copy (%) branches on a kind compute_jobs_error_kind_check admits.',
    array_to_string(v_arms, ', ');
END $$;

-- ==========================================================================
-- Part 3 — the 'orphaned' arm and its DIRECTION (F-3 proper).
-- ==========================================================================
-- Parts 1 and 2 are set-equality assertions: they pin that every kind is
-- modelled and no arm is dead. Neither can tell WHICH sentence landed on which
-- kind. Swapping the 'orphaned' and 'permanent' bodies leaves both green while
-- restoring the exact user-facing lie F-3 fixed, so the direction is asserted
-- directly.
-- RED-UNDER: strip the affirmative retry instruction off the 'orphaned' arm of
--            computation_error_copy in migration 20260826120000 — end the
--            sentence at "Nothing is wrong with this strategy." and drop the
--            "— retry the sync." clause. That is the HALF-swap: it adds no
--            false claim, so Parts 1 and 2 and the sibling `orphaned` ≠
--            `permanent` arm all stay green, and yet the user whose worker died
--            mid-claim is never told to do the one thing that computes their
--            strategy. Nothing readmits a reaped orphan on the live-API path
--            (the 20260819130500 sweep is csv-only and self-blocks once the
--            bridge writes computation_status = 'failed'), so silence here is
--            not neutral — it is the strategy staying uncomputed forever.
-- ⚠️ LAYERED (GRAMMAR Shape 3). MEASURED 2026-09-05: step 1 ALONE aborts the
--    apply — migration 20260826120000's own arm (H5b) at :1364-1366 asserts
--    `computation_error_copy('orphaned') NOT ILIKE '%retry the sync%'` and
--    RAISEs `HONEST-01/F-3 verification failed: … does not carry the
--    affirmative instruction to retry`, so the gate never runs and no arm can
--    be the first failure. Step 2 re-points that arm's needle at a phrase the
--    shortened sentence still contains, which is what a real author doing this
--    edit "properly" would do to their own guard. ⛔ The layering is not a way
--    around the migration's check — it is the measurement that this gate is the
--    SECOND line of defence for a claim the migration also makes, and the one
--    that survives a re-based guard.
-- RED-UNDER-M: {"arm":"3/F-3","apply":[{"kind":"edit","file":"supabase/migrations/20260826120000_computation_error_curated_copy.sql","find":"      'Analytics stopped before it finished because the process running it went away. Nothing is wrong with this strategy — retry the sync.'","replace":"      'Analytics stopped before it finished because the process running it went away. Nothing is wrong with this strategy.'","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260826120000_computation_error_curated_copy.sql","find":"IF computation_error_copy('orphaned') NOT ILIKE '%retry the sync%' THEN","replace":"IF computation_error_copy('orphaned') NOT ILIKE '%went away%' THEN","occurrences":1}]}
DO $$
DECLARE
  v_orphaned  TEXT := computation_error_copy('orphaned');
  v_permanent TEXT := computation_error_copy('permanent');
BEGIN
  IF v_orphaned = v_permanent THEN
    RAISE EXCEPTION 'TEST FAILED (3/F-3): computation_error_copy(''orphaned'') returns the SAME sentence as ''permanent''. An orphaned job is one whose WORKER DIED holding the claim (retention_compute_jobs_orphaned_running: arm A a claim past the 4h window, arm B a running row never claimed) — nothing about the strategy failed, so it is retryable BY DEFINITION. The permanent sentence tells the user that retrying alone will not resolve it, which for this class is affirmatively FALSE, and it does not self-heal: the 20260819130500 readmit sweep only covers strategies with csv_daily_returns rows, and once the bridge writes computation_status = ''failed'' its own NOT EXISTS conjunct blocks readmit permanently. The user retrying is the only remaining mechanism.';
  END IF;

  -- ⛔ THE NEGATIVE-RETRY CLAIM MUST NOT BE ON THE ORPHANED ARM. This is the
  -- assertion that actually encodes F-3, and it is deliberately NOT written as
  -- `v_orphaned NOT ILIKE '%retry%'`. MEASURED, 2026-08-26: that form PASSES on
  -- a body where the orphaned and permanent sentences have been SWAPPED,
  -- because "retrying alone will not resolve it" contains the substring
  -- "retry". A test for the word cannot tell an instruction to retry from a
  -- statement that retrying is pointless — which is the exact distinction this
  -- whole finding is about.
  IF v_orphaned ILIKE '%will not resolve%'
     OR v_orphaned ILIKE '%can''t retry%'
     OR v_orphaned ILIKE '%cannot retry%'
     OR v_orphaned ILIKE '%retrying alone%' THEN
    RAISE EXCEPTION 'TEST FAILED (3/F-3): the ''orphaned'' sentence carries a NEGATIVE-retry claim (got: %). A reaped orphan is a job whose worker died; retrying is the only thing that computes it. Telling that user retrying will not help is the defect F-3 closed.', v_orphaned;
  END IF;

  -- And it must carry the affirmative INSTRUCTION, not merely lack the denial.
  IF v_orphaned NOT ILIKE '%retry the sync%' AND v_orphaned NOT ILIKE '%try again%' THEN
    RAISE EXCEPTION 'TEST FAILED (3/F-3): computation_error_copy(''orphaned'') does not actually tell the user to retry (got: %). Retrying is the ONLY action that gets the work done for a reaped orphan — nothing readmits these jobs on the live-API path — so copy that merely avoids discouraging a retry still leaves the strategy uncomputed forever.', v_orphaned;
  END IF;

  -- ⛔ AND THE PERMANENT ARM MUST KEEP IT. Without this, a SWAP of the two
  -- bodies is only half-detected: the arm above catches the orphaned side, but
  -- an edit that strips the negative-retry claim from BOTH arms would satisfy
  -- everything else while silently telling users with genuinely unrecoverable
  -- failures to keep retrying. The claim has to live on exactly one arm, and
  -- this pins WHICH.
  IF v_permanent NOT ILIKE '%will not resolve%' THEN
    RAISE EXCEPTION 'TEST FAILED (3/F-3): the ''permanent'' sentence no longer states that retrying will not resolve the failure (got: %). That claim is TRUE for permanent — mark_compute_job_failed terminalises it on the FIRST failure, so no retry has happened and none is coming — and it must stay on this arm and only this arm. If it has moved to ''orphaned'', the two arm bodies have been swapped.', v_permanent;
  END IF;

  RAISE NOTICE 'Part 3 OK: the orphaned arm is distinct from the permanent arm and is retry-positive.';
END $$;

DO $$
BEGIN
  RAISE NOTICE 'test_compute_jobs_error_kind_copy_parity: ALL PARTS OK.';
END $$;
