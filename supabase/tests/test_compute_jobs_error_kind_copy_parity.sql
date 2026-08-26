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

-- ==========================================================================
-- Part 1 — CHECK ⊆ CASE. Every admitted kind has its own modelled sentence.
-- ==========================================================================
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
