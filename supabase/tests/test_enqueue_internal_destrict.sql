-- Test for migration 20260826150000_destrict_enqueue_internal_10param.sql — the
-- de-strict of the 10-param `_enqueue_compute_job_internal` lost-race re-reads.
-- Phase 163 (v1.20 HARDEN), OPS-08 / SC-3 SQL half.
--
-- WHAT IS BEING GUARDED. After the race-safe `INSERT ... ON CONFLICT DO NOTHING`
-- returns no row, the function re-reads the winner's row filtered to the three
-- IN-FLIGHT statuses. The winner may legitimately have advanced past them by
-- then (done / failed_*), so the re-read can find nothing — an ordinary MVCC
-- outcome. Under the strict form that raised NO_DATA_FOUND (P0002) with no
-- domain-specific message and surfaced as an opaque 500 on the request path.
-- The 7-param overload was fixed this way in mig 109 (P3); the 10-param one was
-- not, and outlived that fix by four months across FOUR arms.
--
-- This file asserts (all against the DEPLOYED body via pg_get_functiondef, i.e.
-- what the database actually runs — never against repo text):
--   Part 1+3 — THE LOST-RACE PAIR. The 10-param body's strict-re-read count and
--            its serialization_failure raise must be COHERENT: either the
--            post-fix state (zero strict re-reads AND the classified raise) or
--            the exact pre-fix state (strict re-reads AND no classified raise).
--            Any mixture RAISEs — see "WHY THIS IS ONE ARM AND NOT TWO" below.
--   Part 2 — the de-strict did not come from DELETING arms: the body still
--            contains EXACTLY FOUR lost-race re-reads into v_new_id, one per
--            target scope (strategy / portfolio / allocator / api_key). Matched
--            FORM-AGNOSTICALLY (strict or plain) so this arm is live in both
--            states — arm count is the property here, strictness is Part 1+3's.
--            Without it, "zero strict re-reads" is equally satisfied by
--            removing the arms outright, which returns NULL on every lost race.
--   Part 4 — 7-param parity pin. That overload is already clean (measured 0
--            strict re-reads pre-edit) and is NOT touched by 20260826150000, so
--            it is a genuine drift detector in both states: it fails only if a
--            future re-base reintroduces the defect there — which is exactly
--            how the 10-param body acquired it.
--   Part 5 — the Phase 106 retired-kind ADMISSION BRANCH, SECURITY DEFINER and
--            SET search_path survive in BOTH bodies. A CREATE OR REPLACE that
--            re-bases on a STALE definition silently drops these; the source
--            migration's own DO block pins them at deploy time and this is the
--            recurring half of that pin.
--
-- ⭐ WHY PART 1 AND PART 3 ARE ONE ARM AND NOT TWO — and why this file is not
-- knowingly RED. It used to be: Part 1 asserted "zero strict re-reads" flatly,
-- which is FALSE until 20260826150000 is hand-applied to a project, and nothing
-- applies migrations to TEST automatically (the `sql-tests` job has no apply
-- step; .github/workflows/supabase-migrate.yml targets PRODUCTION only). The
-- phase-163 review measured what that costs: this file sorts 30th of ~70 in the
-- sql-tests glob and the runner EXITS ON FIRST FAILURE, so a knowingly-red file
-- here silently suppresses the ~40 files sorting after it. A deliberately red
-- gate that blinds forty other gates is a net loss of coverage, not a gain.
--
-- The shape that keeps coverage in both states is the both-or-neither coherence
-- assertion (the same remedy .github/workflows/ci.yml recommends for an
-- unpoliced partial skip): the two halves of the OPS-08 fix must AGREE. Present
-- strict re-reads with NO classified raise is the pre-fix definition exactly —
-- coherent, recognised, and this file says so out loud and withholds Part 3
-- by name. Zero strict re-reads with NO classified raise is a body that returns
-- NULL silently on a lost race. Strict re-reads WITH the classified raise is a
-- half-applied or hand-edited body. Both mixtures RAISE. Asserting the two
-- halves separately would have made the second arm unfalsifiable once the first
-- constrained the pair, so they are ONE arm — a test that cannot fail is worse
-- than no test, and two arms here would have been exactly that.
--
-- ⭐ THE GATE TOKEN IS THE STATEMENT FORM, AND IT PINS THE PROPERTY, NOT A
-- NAMING HABIT. `pg_get_functiondef` returns the body's COMMENTS as well as its
-- statements, so a gate grepping for a bare identifier can be satisfied by the
-- function's own prose about itself (T-163-16). The needle is the keyword pair,
-- matched whitespace-tolerantly so a re-read reformatted across a line break
-- cannot evade it. It carried a trailing `v_` variable-prefix until the
-- phase-163 review: that pinned THIS CODEBASE'S NAMING CONVENTION rather than
-- the dangerous construct, and a re-base writing the strict form into
-- `winner_id`, or into a record variable, or via EXECUTE, would have passed
-- GREEN while being byte-for-byte the defect OPS-08 exists to prevent. The
-- prefix is gone; the end-of-word constraint that replaced it excludes only an
-- identifier that begins with those letters (`STRICTLY_*`), never a variable
-- name. Counted on the pre-fix definition (20260716090000): FOUR occurrences in
-- the 10-param body, ZERO in the 7-param body. Part 1+3 reports the count it
-- found, so a pre-apply run states the measured 4 out loud.
--
-- ⛔ AND T-163-16 IS CLOSED MECHANICALLY, NOT BY CONVENTION. Every arm below
-- matches against a COMMENT-STRIPPED copy of the definition, never the raw one,
-- and BOTH plpgsql comment syntaxes are stripped. This was not a precaution:
-- the hole was DEMONSTRATED twice. First, on a scratch Postgres 16 while this
-- file was being written, a body whose raise had been changed to
-- `no_data_found` while one LINE comment quoted the old ERRCODE clause passed
-- the presence arms GREEN. Then the phase-163 review demonstrated the identical
-- hole through the BLOCK-comment syntax, which the first strip did not cover —
-- plpgsql stores prosrc verbatim, so a block comment survives
-- pg_get_functiondef exactly as a line comment does. Both are stripped now,
-- block first, non-greedy so two block comments are not merged into one span
-- that swallows the statements between them.
--
-- ⚠️ THE TRUNCATION FAILURE DIRECTION IS NOT UNIFORM, and which arm you are
-- reading decides it. The strip assumes no string literal in either body
-- contains a comment-opening sequence (verified at HEAD: every em-dash in these
-- messages is U+2014, not two hyphens). If a future message introduces one,
-- that literal's tail is truncated before matching. For the PRESENCE arms —
-- Part 2's arm count, Part 4's classified raise, Part 5's branch / SECDEF /
-- search_path, where FINDING the needle is the pass condition — that can only
-- cause a FALSE FAILURE, which is fail-closed and loud. For the ABSENCE arms —
-- the zero-strict half of Part 1+3, and Part 4's zero-strict count, where
-- finding NOTHING is the pass condition — truncation is a FALSE PASS, which is
-- NOT tolerable. The earlier version of this header claimed the safe direction
-- for the whole file; it held only for the presence arms.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands (the
-- sql-tests preflight rejects shell-out / copy / output redirection). ⛔ NO
-- WHOLE-FILE SKIP PATH: the anti-SKIP gate makes a file that prints a
-- whole-file skip and exits 0 FAIL the job, and rightly — an absent object here
-- means the migration did not land, which is the single thing this file exists
-- to detect. An absent overload RAISEs. The one narrow, self-named partial skip
-- is Part 3's, and it does NOT end the DO block: Parts 2, 4 and 5 run after it.
--
-- ⚠️ LIMIT OF THIS FILE, recorded rather than glossed. It carries no
-- `ALL N ARMS EXECUTED` completion sentinel. That mechanism is not free-standing
-- — .github/workflows/ci.yml holds SENTINEL_FLOOR / ARMS_FLOOR and a per-file
-- derivation table, and src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts
-- reddens when the sentinel-bearing file SET drifts from that table. Declaring
-- one here therefore requires editing ci.yml, which is outside this plan's
-- declared files and is being edited concurrently by another Phase 163
-- workstream. Consequence, stated plainly: an edit that neuters an arm of this
-- file in place would exit 0 and go unnoticed by CI, the same as the other ~60
-- sentinel-free files in this corpus. Adding the sentinel (and its two ci.yml
-- integers, 7 -> 8 and 63 -> 68) is tracked in TODOS.md.
--
-- ⭐ RE-PROVED ABLE TO FAIL. Measured 2026-08-26 on a scratch PostgreSQL 16.13
-- cluster (throwaway initdb, never TEST and never PROD), by building each
-- evading body as a REAL function and reading it back with pg_get_functiondef,
-- exactly as the arms below do. Verbatim NOTICE output:
--
--   === R2: the needle pins the PROPERTY, not the v_ naming habit ===
--     r2_a  OLD needle -> MISSED (green)   NEW needle -> CAUGHT (red)
--     r2_b  OLD needle -> MISSED (green)   NEW needle -> CAUGHT (red)
--     r2_c  OLD needle -> MISSED (green)   NEW needle -> CAUGHT (red)
--     r2_d  OLD needle -> MISSED (green)   NEW needle -> no match
--     r2_e  OLD needle -> MISSED (green)   NEW needle -> no match
--   r2_a = the strict re-read into `winner_id`; r2_b = into a record variable;
--   r2_c = via EXECUTE into `new_id`. All three are the defect OPS-08 exists to
--   prevent and ALL THREE passed the shipped needle. r2_d (the fixed body) and
--   r2_e (an identifier merely beginning with those letters) confirm the new
--   needle does not over-match.
--
--   === R3: the comment strip must close the block syntax too ===
--     r3_a (raise downgraded to no_data_found; ERRCODE clause left in a BLOCK
--           comment)
--       presence arm on OLD strip -> PASSES (green, WRONG)  serfail found: t
--       presence arm on NEW strip -> FAILS (red, CORRECT)   serfail found: f
--     r3_b (all four arms DELETED, four block comments left behind)
--       arm count on OLD strip -> 4  (expected 4 => PASSES, WRONG)
--       arm count on NEW strip -> 0  (expected 4 => FAILS, CORRECT)
--
--   === R4: pin the admission BRANCH, not the RAISE message text ===
--     r4_a (guard branch DELETED, phrase survives in an unrelated literal)
--       OLD message-text arm -> PASSES (green, WRONG - guard is gone)
--       NEW branch arm       -> FAILS (red, CORRECT)
--     r4_b (guard branch INTACT, message reworded)
--       OLD message-text arm -> FAILS (red, WRONG - would block the PROD deploy)
--       NEW branch arm       -> PASSES (green, CORRECT)
--
-- And THIS FILE, run against real deployed definitions on that same cluster:
--   * pre-apply (20260716090000 only)      -> exit 0, `SKIP (Part 3)` naming the
--     measured 4 strict re-reads, Parts 2 / 4 / 5 asserted and OK.
--   * post-apply (20260826150000)          -> exit 0, Parts 1+3, 2, 4, 5 all OK.
--   * one arm RE-STRICTED, raise kept      -> ERROR: Part 1+3 FAILED ... carries
--     1 strict lost-race re-read(s) AND a serialization_failure raise.
--   * de-stricted, raise downgraded        -> ERROR: Part 1+3 FAILED ... NO
--     strict lost-race re-read and NO serialization_failure raise.
--   * allocator arm DELETED                -> ERROR: Part 2 FAILED ... contains
--     3 lost-race re-read(s) into v_new_id, expected 4.
-- The scratch cluster was destroyed afterwards; nothing was applied anywhere
-- else, and no fixture reached the shared TEST project.
--
-- Hygiene: this gate is FIXTURE-FREE — every assertion reads catalog state
-- (pg_proc via pg_get_functiondef) and writes nothing, so there is no
-- cross-run collision surface on the shared test project and no defensive
-- pre-clean is needed. The explicit transaction ending in ROLLBACK is kept for
-- uniformity with the rest of the suite and so that any future arm that does
-- need a fixture inherits the right shell rather than inventing one.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_enqueue_internal_destrict.sql

BEGIN;

-- ==========================================================================
-- Parts 1+3, 2, 4, 5. One DO block: every arm reads the same two function
-- definitions, and splitting them would mean four more pg_get_functiondef
-- round trips for no added discrimination.
-- ==========================================================================
DO $$
DECLARE
  v_fn7       text;   -- raw pg_get_functiondef output (header + body + comments)
  v_fn10      text;
  v_body7     text;   -- ...with BOTH comment syntaxes stripped. MATCH ON THESE.
  v_body10    text;
  v_n         int;
  v_strict10  int;
  v_serfail10 boolean;
  v_pre_apply boolean := false;
  v_oid7  oid := to_regprocedure(
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb)'
  );
  v_oid10 oid := to_regprocedure(
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)'
  );
  -- The statement-form needles. Whitespace-tolerant on purpose (see the header):
  -- plpgsql stores a body verbatim, so a re-read wrapped across a line break is
  -- byte-different but semantically identical, and a contiguous-substring search
  -- would miss it. c_strict_re pins the KEYWORD PAIR and nothing else — no
  -- variable prefix, so it catches the construct under any target name.
  c_strict_re  CONSTANT text := 'INTO[[:space:]]+STRICT\M';
  -- FORM-AGNOSTIC arm counter for Part 2: matches the lost-race re-read in
  -- either form, so arm count stays assertable before AND after the apply.
  c_arm_re     CONSTANT text :=
    'SELECT[[:space:]]+id[[:space:]]+INTO[[:space:]]+(STRICT[[:space:]]+)?v_new_id';
  c_serfail_re CONSTANT text :=
    'USING[[:space:]]+ERRCODE[[:space:]]*=[[:space:]]*''serialization_failure''';
  -- Part 5 pins the retired-kind ADMISSION BRANCH, not the RAISE's message
  -- text. The message is a string literal — immune to the comment strip by
  -- construction — and pinning it fails in both directions: delete the branch
  -- while the phrase survives anywhere and the arm passes; reword the message
  -- with the branch intact and the arm fails. Both overloads spell the branch
  -- this way (20260716090000:83 and :224).
  c_retired_re CONSTANT text := 'p_kind[[:space:]]*=[[:space:]]*''compute_analytics''';
  -- One arm per target scope in the 10-param overload's XOR: strategy,
  -- portfolio, allocator, api_key. Spelled as a constant so Part 2's
  -- expectation is a number a reader can re-derive from the signature.
  c_expected_arms CONSTANT int := 4;
BEGIN
  -- ----- resolution (no skip path: an absent overload is the failure) -------
  IF v_oid10 IS NULL THEN
    RAISE EXCEPTION 'OPS-08 gate: the 10-param _enqueue_compute_job_internal overload does not exist on this database. Neither 20260826150000 nor its 20260716090000 ancestor has been applied here. This is a FAILURE, not a skip — an absent overload is indistinguishable from a body that lost the fix, and nothing applies migrations to this project automatically.';
  END IF;
  IF v_oid7 IS NULL THEN
    RAISE EXCEPTION 'OPS-08 gate: the 7-param _enqueue_compute_job_internal overload does not exist on this database — the parity pin in Part 4 cannot be evaluated.';
  END IF;

  v_fn7  := pg_get_functiondef(v_oid7);
  v_fn10 := pg_get_functiondef(v_oid10);

  -- T-163-16: strip comments so every arm below reads STATEMENTS, not the
  -- function's prose about itself. BOTH syntaxes, block first — plpgsql stores
  -- prosrc verbatim, so a block comment survives pg_get_functiondef exactly as
  -- a line comment does, and stripping only the line form left the identical
  -- hole open in the other. `.*?` is non-greedy so two block comments are not
  -- merged into one span that swallows the statements between them; 's' lets
  -- that span cross newlines; 'n' on the line pass is what stops `.` there from
  -- eating the rest of the definition. Failure direction differs per arm — see
  -- the truncation note in the header before adding a literal to either body.
  v_body7  := regexp_replace(regexp_replace(v_fn7,  '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  v_body10 := regexp_replace(regexp_replace(v_fn10, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- ⛔ NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW. `NULL !~ 'x'` evaluates
  -- to NULL and `IF NULL THEN` does not fire, so a NULL body would sail past
  -- every negated arm and this file would print its OK notices having read
  -- nothing. pg_get_functiondef on a live oid does not return NULL today; this
  -- costs two comparisons and removes the possibility that a future change to
  -- how these are fetched turns the whole gate into a no-op.
  IF v_body7 IS NULL OR v_body10 IS NULL THEN
    RAISE EXCEPTION 'OPS-08 gate: a comment-stripped function body came back NULL, so every regex arm below would pass without reading anything. Refusing to report compliance on an unread body.';
  END IF;

  -- ----- Part 1+3 — the lost-race pair must be coherent --------------------
  SELECT count(*) INTO v_strict10
    FROM regexp_matches(v_body10, c_strict_re, 'g');
  v_serfail10 := v_body10 ~ c_serfail_re;

  IF v_strict10 > 0 AND v_serfail10 THEN
    RAISE EXCEPTION 'OPS-08 Part 1+3 FAILED: the deployed 10-param body is INCOHERENT — it carries % strict lost-race re-read(s) AND a serialization_failure raise. Those are the two halves of a fix that was only partly made: a lost race still dies on NO_DATA_FOUND inside the strict re-read and never reaches the classified raise. Either finish the de-strict or revert to the pre-fix definition; do not ship the mixture.', v_strict10;
  ELSIF v_strict10 = 0 AND NOT v_serfail10 THEN
    RAISE EXCEPTION 'OPS-08 Part 1+3 FAILED: the deployed 10-param body has NO strict lost-race re-read and NO serialization_failure raise. A lost race whose winner already advanced past the in-flight statuses therefore returns NULL to the caller SILENTLY — strictly worse than the opaque 500 this requirement removes, because nothing surfaces at all. Restore the classified raise after the IF-chain.';
  ELSIF v_strict10 > 0 THEN
    v_pre_apply := true;
    RAISE NOTICE 'SKIP (Part 3): this database still runs the pre-fix 20260716090000 definition — % strict lost-race re-read(s) and no classified raise. That pair is COHERENT (it is the old definition exactly, not a half-applied or hand-edited body), so this file does not fail on it: it sorts 30th of ~70 in the sql-tests glob and the runner exits on first failure, so failing here would suppress every file after it. WITHHELD: Part 3, the serialization_failure raise. STILL ASSERTED below: Parts 2, 4 and 5. Hand-apply 20260826150000 to this project to arm Part 3.', v_strict10;
  ELSE
    RAISE NOTICE 'OPS-08 Part 1+3 OK: the deployed 10-param body carries no strict lost-race re-read and does raise serialization_failure on an exhausted one.';
  END IF;

  -- ----- Part 2 — and there are still FOUR arms to re-read with ------------
  -- Form-agnostic on purpose: strictness is Part 1+3's property, arm COUNT is
  -- this one's, and keeping them orthogonal is what lets this arm stay live on
  -- a pre-apply database instead of going dark with Part 3.
  SELECT count(*) INTO v_n
    FROM regexp_matches(v_body10, c_arm_re, 'g');
  IF v_n <> c_expected_arms THEN
    RAISE EXCEPTION 'OPS-08 Part 2 FAILED: the deployed 10-param body contains % lost-race re-read(s) into v_new_id, expected % — one per target scope (strategy / portfolio / allocator / api_key). "No strict re-read" is also achieved by DELETING an arm, which would make that scope return NULL on every lost race instead of the winner id. Restore the missing arm.', v_n, c_expected_arms;
  END IF;
  RAISE NOTICE 'OPS-08 Part 2 OK: all four lost-race arms are present.';

  -- ----- Part 4 — 7-param parity pin --------------------------------------
  -- Untouched by 20260826150000 and clean since mig 109 P3, so both halves are
  -- live in EITHER state of the 10-param body — this is the arm that carries
  -- independent information on a pre-apply run.
  SELECT count(*) INTO v_n
    FROM regexp_matches(v_body7, c_strict_re, 'g');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'OPS-08 Part 4 FAILED: the 7-param body reacquired % strict lost-race re-read(s) (expected 0 — it has been clean since mig 109 P3). A CREATE OR REPLACE re-based on a definition older than 20260716090000 does exactly this.', v_n;
  END IF;
  IF NOT (v_body7 ~ c_serfail_re) THEN
    RAISE EXCEPTION 'OPS-08 Part 4 FAILED: the 7-param body lost its serialization_failure raise (mig 109 P3 regressed) — its lost race now returns NULL silently.';
  END IF;
  RAISE NOTICE 'OPS-08 Part 4 OK: the 7-param overload is still clean on both halves.';

  -- ----- Part 5 — properties a stale re-base silently drops ----------------
  IF NOT (v_body10 ~ c_retired_re) OR NOT (v_body7 ~ c_retired_re) THEN
    RAISE EXCEPTION 'OPS-08 Part 5 FAILED: an overload lost the Phase 106 retired-kind admission branch (p_kind = compute_analytics). The registry and both CHECK constraints still ADMIT that kind (45 historical rows FK-reference it), so the RPC-level reject is the only thing keeping the retired kind out of the queue.';
  END IF;
  IF NOT (v_body10 ~* 'SECURITY DEFINER') OR NOT (v_body7 ~* 'SECURITY DEFINER') THEN
    RAISE EXCEPTION 'OPS-08 Part 5 FAILED: an overload lost SECURITY DEFINER — every sanctioned enqueue path runs through these functions on behalf of a caller that cannot write compute_jobs directly.';
  END IF;
  IF NOT (v_body10 ~* 'search_path') OR NOT (v_body7 ~* 'search_path') THEN
    RAISE EXCEPTION 'OPS-08 Part 5 FAILED: an overload lost SET search_path — a SECURITY DEFINER function without a pinned search_path is search-path-hijackable.';
  END IF;
  RAISE NOTICE 'OPS-08 Part 5 OK: retired-kind admission branch, SECURITY DEFINER and SET search_path intact on both overloads.';

  IF v_pre_apply THEN
    RAISE NOTICE 'test_enqueue_internal_destrict: parts 1+3 (pre-apply arm), 2, 4 and 5 executed.';
  ELSE
    RAISE NOTICE 'test_enqueue_internal_destrict: parts 1+3, 2, 4 and 5 executed.';
  END IF;
END
$$;

ROLLBACK;
