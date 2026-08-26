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
--            the EXACT pre-fix state (all FOUR arms strict AND no classified
--            raise). Any mixture RAISEs — see "WHY THIS IS ONE ARM AND NOT TWO"
--            below. ⭐ "EXACT" IS LOAD-BEARING: a count of 1..3 is a half-done
--            re-base, not a pre-apply database, and it is the one shape in
--            which the enqueue returns a NULL job id silently. It RAISEs.
--            ⭐ AND THE PRE-FIX STATE IS TOLERATED ONLY ON A DATABASE THAT HAS
--            NEVER RECEIVED 20260826150000, decided by this overload's CATALOG
--            COMMENT rather than by its body — see "THE REVERT DISCRIMINATOR".
--            ⭐ The marker is required PRESENT on a post-fix body too, so the
--            discriminator cannot go dark unnoticed.
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
--            the search_path pin survive in BOTH bodies. A CREATE OR REPLACE
--            that re-bases on a STALE definition silently drops these; the
--            source migration's own DO block pins them at deploy time and this
--            is the recurring half of that pin. ⭐ The search_path arm asserts
--            the VALUE from pg_proc.proconfig, not the token — `SET search_path
--            = ''` passes a token check and is the classic hijack.
--   Part 6 — the ACL on BOTH overloads: no PUBLIC / anon / authenticated
--            EXECUTE, service_role retains it. 20260826150000 argues that every
--            CREATE OR REPLACE of this family is an opportunity for Supabase's
--            default-grant event trigger to re-open EXECUTE — observed on this
--            family, remediated by mig 118 — and then asserted that RECURRING
--            risk exactly once, at its own apply time. This is the recurring
--            half. Ordered LAST on purpose: see the note above the arm.
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
-- unpoliced partial skip): the two halves of the OPS-08 fix must AGREE. ALL
-- FOUR strict re-reads with NO classified raise is the pre-fix definition
-- exactly — coherent, recognised, and this file says so out loud and withholds
-- Part 3 by name. Zero strict re-reads with NO classified raise is a body that
-- returns NULL silently on a lost race. Strict re-reads WITH the classified
-- raise is a half-applied or hand-edited body. Both mixtures RAISE. Asserting
-- the two halves separately would have made the second arm unfalsifiable once
-- the first constrained the pair, so they are ONE arm — a test that cannot fail
-- is worse than no test, and two arms here would have been exactly that.
--
-- ⛔ "ALL FOUR" WAS "AT LEAST ONE" UNTIL THE PHASE-163 RE-AUDIT, AND THAT WAS A
-- FAIL-OPEN HOLE, NOT LOOSE WORDING. The tolerance is for the PRE-FIX
-- DEFINITION, which has exactly four strict re-reads — one per target scope,
-- the same four Part 2 counts. A count of 1..3 is a half-finished re-base, and
-- the `IF v_new_id IS NULL THEN RAISE ... serialization_failure` guard is lost
-- along with whichever arms moved forward, so every arm still on the plain form
-- returns NULL to the caller on a lost race: the enqueue no-ops and the caller
-- receives a NULL job id. That is the precise silent failure this file exists
-- to prevent, and the shipped predicate reported it as a harmless pre-apply
-- SKIP and exited 0. It now RAISEs. See D2 in the demonstration block below.
--
-- ⛔ THE REVERT DISCRIMINATOR — WHAT THE COHERENCE SHAPE ALONE COULD NOT SAY
-- (phase-163 review, WR-04). Tolerating the pre-fix pair bought back the ~40
-- files this one would otherwise have suppressed, but as first shipped it paid
-- for that with a hole: "never applied" and "applied, then REVERTED by a stale
-- re-base" produce a BYTE-IDENTICAL body — four strict re-reads, no classified
-- raise. Read on the body alone they are the same observation, so the SKIP arm
-- answered exit 0 to both. The concrete scenario is not hypothetical, it is how
-- the 10-param body acquired the defect in the first place: someone extends the
-- function, grabs 20260716090000 as the base (the newest ancestor that carries
-- a FULL BODY, which is what the project's re-base rule tells them to take),
-- and lands it. PROD returns to P0002 on every lost race and opaque 500s on the
-- request path, and this gate prints SKIP and passes. Part 4 does not fire —
-- the 7-param body was never touched.
--
-- The database carries the evidence the body does not. 20260826150000 REWRITES
-- this overload's catalog COMMENT. ⛔ THE ARGUMENT FOR WHY THAT IS A SOUND
-- ONE-WAY MARKER WAS WRONG ON TWO COUNTS AS FIRST SHIPPED, and both are
-- corrected here — the earlier version claimed THREE files carry a
-- `COMMENT ON FUNCTION` for this family and did not mention DROP at all.
-- RE-MEASURED with an UNQUALIFIED grep across supabase/migrations/ at HEAD,
-- 2026-08-26 (the old count came from a `public.`-qualified grep whose
-- conclusion was then stated unqualified, so three argument-less statements
-- were invisible to it):
--   1. SIX files contain a `COMMENT ON FUNCTION ... _enqueue_compute_job_
--      internal` statement, not three — 20260411144407, 20260418194206,
--      20260420073003, 20260510180226, 20260515130001 and 20260826150000.
--      This does not break the marker: the last COMMENT to run wins, the five
--      pre-existing ones all predate 20260826150000, and none contains the
--      marker phrase (the pre-apply text is mig 118's, verbatim from mig 066).
--      The correction matters because the old number understated how routine
--      re-commenting this function is, and the marker's whole soundness rests
--      on nobody re-commenting it without the phrase.
--   2. 20260716090000 — the definition a stale re-base copies — contains NO
--      `COMMENT ON FUNCTION` statement AT ALL. So re-basing on it replaces the
--      body and leaves the comment untouched.
--   3. CREATE OR REPLACE FUNCTION does not clear a comment either.
-- Therefore the pair (strict re-reads PRESENT, marker PRESENT) is not reachable
-- by the CREATE-OR-REPLACE route — it means the fix arrived and was then lost.
-- That arm RAISEs. The SKIP arm requires the marker to be ABSENT, which is the
-- property WR-04 asked for.
--
-- ⛔ THE RESIDUAL IS WIDER THAN THE ORIGINAL NOTE ADMITTED, BECAUSE IT OMITTED
-- `DROP FUNCTION`. A DROP DESTROYS the catalog comment outright; the re-created
-- function has none, and this gate falls back to SKIP with nothing anywhere
-- reporting that its discriminator is gone. That is not a theoretical route for
-- this family — it has been DROPped TWICE already (20260418194206:168, the
-- 7-param; 20260420073003:327, the 8-param) — and a DROP is the FORCED idiom
-- for a parameter rename or a return-type change, neither of which CREATE OR
-- REPLACE permits. So the next signature change to this function will destroy
-- the marker unless its author re-issues the COMMENT. FAIL DIRECTION: OPEN.
-- The same is true of a future migration that re-bases the body on
-- 20260716090000 AND issues its own `COMMENT ON FUNCTION` without the phrase.
-- ⭐ WHAT NOW MITIGATES BOTH, partially: Part 1+3's marker-dark arm. On a
-- POST-FIX body a missing marker is no longer silent — it RAISEs. So a DROP or
-- a re-comment that lands while the fix is still in the body is caught on the
-- next CI run, before a later stale re-base can exploit the disarmed gate. The
-- hole that remains is a DROP and a body revert in the SAME change, which
-- presents identically to a never-applied database. Nothing readable from the
-- catalog distinguishes those, and the ACL cannot serve as a second marker
-- because 20260826150000's REVOKE/GRANT are byte-identical to mig 118's and are
-- therefore the SAME before and after.
-- The opposite direction is fail-CLOSED and loud: hand-writing the phrase into
-- the comment of a never-applied database makes the revert arm fire, which is
-- the correct answer to a catalog that claims a fix the body does not carry.
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
-- ⚠️ THIS FILE DOES NOT HOLD THE MIGRATION'S SELF-EXCLUSION PROPERTY, AND DOES
-- NOT NEED TO. 20260826150000 keeps its own text free of any contiguous
-- occurrence of the construct c_strict_re hunts for, so a repo-level scan of the
-- migration cannot be satisfied by the assertion policing it. This file breaks
-- that rule deliberately in two places — the PROD 7-param note below and D2 in
-- the demonstration block — because naming the exact bytes was the only way to
-- state those measurements. It is safe for one reason, and only that reason:
-- EVERY arm here reads pg_get_functiondef and pg_proc from the CATALOG, never
-- repo text, so nothing this file says about itself can satisfy any arm. There
-- is also no repo-level scanner for the construct (verified at HEAD: nothing in
-- src/, .github/ or scripts/ greps for it, and nothing references this file by
-- name). ⛔ If a future change makes any arm read repo text, this exemption
-- dies with it — re-establish self-exclusion first.
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
-- ⛔ AND THE STRIP IS ALREADY LOAD-BEARING ON PROD WHILE BEING VACUOUS HERE —
-- which means a regression to it is INVISIBLE TO THIS FILE AND FATAL AT DEPLOY
-- TIME. The deployed 7-param body carries the construct inside a LINE COMMENT
-- it inherited from 20260716090000:143 ("the original SELECT INTO STRICT ...").
-- MEASURED on the live projects 2026-08-26 by the phase-163 re-audit: the PROD
-- 7-param body contains ONE raw occurrence, comment-stripped ZERO; the TEST
-- 7-param body contains none even before stripping. So:
--   * On PROD the strip is the SOLE layer making a zero-strict assertion pass
--     on that overload. Narrow it — to the line syntax only, or by letting a
--     new string literal truncate it — and 20260826150000's own arm (c) matches
--     that comment and ABORTS THE PROD DEPLOY.
--   * Here it changes no result at all on the 7-param body. Part 4 counts zero
--     either way. A CI run cannot tell you the strip still works.
-- Do not "simplify" the strip on the evidence of a green sql-tests run. And do
-- not read the convention layer ("phrase comments as 'the strict form', never
-- the two keywords in sequence") as covering this: that convention governs the
-- 10-param body 20260826150000 writes, and cannot reach a body it does not
-- author.
--
-- ⚠️ THE TRUNCATION FAILURE DIRECTION IS NOT UNIFORM, and which arm you are
-- reading decides it. The strip assumes no string literal in either body
-- contains a comment-opening sequence (verified at HEAD: every em-dash in these
-- messages is U+2014, not two hyphens). If a future message introduces one,
-- that literal's tail is truncated before matching. For the PRESENCE arms —
-- Part 2's arm count, Part 4's classified raise, Part 5's branch / SECDEF token,
-- where FINDING the needle is the pass condition — that can only cause a FALSE
-- FAILURE, which is fail-closed and loud. For the ABSENCE arms — the
-- zero-strict half of Part 1+3, and Part 4's zero-strict count, where finding
-- NOTHING is the pass condition — truncation is a FALSE PASS, which is NOT
-- tolerable. The earlier version of this header claimed the safe direction for
-- the whole file; it held only for the presence arms.
--   ⭐ THREE ARMS ADDED BY THE PHASE-163 RE-AUDIT ARE OUTSIDE THIS HAZARD
--   ENTIRELY, and it is worth knowing which, because they are the ones that do
--   not need the strip to be correct:
--     * Part 1+3's hybrid arm is an EQUALITY on a count (`<> 4`), so truncation
--       lowers the count and fails CLOSED in both directions.
--     * Part 1+3's marker-dark arm and the revert arm read the CATALOG COMMENT
--       via obj_description, which is not part of pg_get_functiondef output —
--       the strip can neither reach it nor truncate it.
--     * Part 5's search_path VALUE arm and all of Part 6 read pg_proc columns
--       (proconfig, proacl) rather than definition text. Same immunity.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands (the
-- sql-tests preflight rejects shell-out / copy / output redirection). ⛔ NO
-- WHOLE-FILE SKIP PATH: the anti-SKIP gate makes a file that prints a
-- whole-file skip and exits 0 FAIL the job, and rightly — an absent object here
-- means the migration did not land, which is the single thing this file exists
-- to detect. An absent overload RAISEs. The one narrow, self-named partial skip
-- is Part 3's, and it does NOT end the DO block: Parts 2, 4, 5 and 6 run after
-- it.
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
-- ============================================================================
-- ⛔⛔ EVERYTHING BELOW THIS LINE IS **TEXT-LEVEL DEMONSTRATION ONLY**.
-- NO DATABASE OF ANY KIND WAS CONTACTED. These are not observed runs, they are
-- predicates evaluated by hand on inputs reconstructed from source files, and
-- an unrun check must never be read as a passing one. The arms in this section
-- were added after the scratch cluster was destroyed — the revert arm in the
-- WR-04 fix pass, the rest in the phase-163 three-reviewer re-audit — by agents
-- with no database reachable. NOBODY HAS OBSERVED ANY OF THEM FIRE.
-- ============================================================================
--
--   D1. THE REVERT ARM (WR-04). Predicate: `v_strict10 > 0 AND v_applied10`,
--   where v_applied10 is `strpos(<catalog comment>, 'Phase 163 OPS-08') > 0`.
--   Both possible values of that comment were reconstructed from the migration
--   sources by concatenating the adjacent SQL literals:
--     A  never-applied     body=20260716090000  comment=mig 118 (279 chars)
--                          v_strict10=4  marker=FALSE -> falls through to SKIP
--     B  reverted-after-apply
--                          body=20260716090000  comment=20260826150000 (633)
--                          v_strict10=4  marker=TRUE  -> RED, the arm RAISEs
--     C  post-apply        body=20260826150000  comment=20260826150000
--                          v_strict10=0  marker=TRUE  -> not this arm; Part 1+3
--                                                        OK arm
--   A and B have IDENTICAL bodies. The comment is the ONLY thing that separates
--   them, which is the whole point of the arm — and the demonstration exhibits
--   both inputs rather than asserting the difference.
--
--   D2. THE HYBRID ARM (phase-163 re-audit, F1). Predicate:
--   `v_strict10 > 0 AND v_strict10 <> c_expected_arms`, reached only when the
--   raise is ABSENT and the marker is ABSENT. The strict count of the pre-fix
--   body was counted in the source being policed, NOT in this file:
--   `grep -n 'INTO STRICT' 20260716090000_...sql` returns five lines — :143
--   (a LINE COMMENT in the 7-param body) and :285, :292, :299, :306, the four
--   10-param statements. Comment-stripped, the 10-param body therefore yields
--   exactly 4 and the 7-param exactly 0. Two concrete inputs:
--     D2-a  true pre-apply   body=20260716090000 verbatim
--           v_strict10=4  =>  4 <> 4 is FALSE  -> arm does NOT fire, SKIP as
--           before. This is the input that proves the arm did not break the
--           tolerance the file was restructured to provide.
--     D2-b  half re-based    arms 1-2 taken from 20260826150000 (plain), arms
--           3-4 left at 20260716090000 (strict), the `IF v_new_id IS NULL ...
--           serialization_failure` guard absent because it arrived with the
--           half that did not move
--           v_strict10=2  =>  2 <> 4 is TRUE   -> RED, the arm RAISEs.
--           Under the SHIPPED predicate (`v_strict10 > 0`) this same input
--           reached the SKIP arm and exited 0, while arms 1-2 of that body
--           return NULL to the caller on every lost race.
--   Note the failure direction: this is a strict EQUALITY on a count, so both
--   truncation of the body and duplication of the construct fail CLOSED.
--
--   D3. THE MARKER-DARK ARM (phase-163 re-audit, F4). Predicate:
--   `NOT v_applied10`, reached only when v_strict10 = 0 AND v_serfail10 — i.e.
--   the body carries the fix. Two concrete inputs:
--     D3-a  post-apply, intact   comment=20260826150000's literal
--           v_applied10=TRUE  -> NOT TRUE = FALSE  -> arm does NOT fire, OK.
--     D3-b  post-apply, comment re-issued by a later migration WITHOUT the
--           phrase (or DROPped and re-created, which leaves no comment)
--           v_comment10='' or a marker-free text; v_applied10=FALSE
--           -> NOT FALSE = TRUE -> RED, the arm RAISEs.
--           Before this arm, D3-b fell through to the OK notice: the marker was
--           consulted ONLY inside `v_strict10 > 0`, so no post-fix body ever
--           looked at it. The discriminator could go dark on PROD in total
--           silence, and the NEXT stale re-base would then be waved through.
--   ⚠️ D3-b is also where the `coalesce` on obj_description stops being
--   decorative: without it the no-comment case gives v_applied10=NULL, `NOT
--   NULL` is NULL, `IF NULL THEN` does not fire, and D3-b fails OPEN.
--
--   D4. THE search_path VALUE ARM (phase-163 re-audit, F7). Predicate:
--   `v_cfg IS NULL OR NOT ('search_path=public, pg_catalog' = ANY(v_cfg))`.
--   The declarations being policed are 20260716090000:61 and :196 and
--   20260826150000's own, all three `SET search_path = public, pg_catalog`.
--     D4-a  intact      proconfig={"search_path=public, pg_catalog"}
--           = ANY -> TRUE -> NOT TRUE = FALSE -> arm does NOT fire.
--     D4-b  hijackable  proconfig={"search_path="}   (`SET search_path = ''`)
--           = ANY -> FALSE -> NOT FALSE = TRUE -> RED, the arm RAISEs.
--           The TOKEN arm kept above it evaluates `v_body ~* 'search_path'` on
--           the SAME input and finds the word -> PASSES. That divergence is the
--           entire reason this arm exists: the old check proved the word was
--           present, never that the pin was safe.
--     D4-c  absent      proconfig=NULL -> the IS NULL disjunct fires -> RED.
--
--   D5. PART 6, THE ACL ARM (phase-163 re-audit, F6). No predicate arithmetic
--   to show — has_function_privilege is a catalog read this agent cannot
--   perform. ⚠️ ITS VALUE ON THE TEST PROJECT IS THE ONE THING IN THIS FILE
--   THAT WAS NOT MEASURED AT ALL, and it is stated rather than glossed because
--   a red arm here costs the ~40 sql-tests files sorting after this one. What
--   IS established, from source:
--     * mig 118 (20260515130001:110-163) contains a DO block that RAISEs if
--       anon or authenticated holds EXECUTE on EITHER overload. It is a
--       migration, so it aborts its own apply on failure.
--     * TEST has 20260716090000 applied (its retired-kind branch is present in
--       both deployed bodies, measured). 20260716090000 sorts AFTER mig 118, and
--       `supabase db push --include-all` applies in order, so mig 118 ran on
--       TEST and its assertion passed.
--     * 20260716090000 is a pure CREATE OR REPLACE of two ALREADY-EXISTING
--       overloads. Per mig 118's own account (:5-29) the default-grant event
--       trigger fired on mig 109 because that statement CREATED a second
--       overload — a new function object — while the pre-existing 10-param one
--       kept its mig 066 REVOKE. A replace of an existing function preserves
--       its ACL.
--   The inference is therefore that anon/authenticated hold no EXECUTE on TEST
--   and service_role holds it, matching what WAS measured on PROD for the
--   10-param overload. THAT IS AN INFERENCE FROM MIGRATION SOURCES, NOT A
--   READING OF THE TEST CATALOG. If it is wrong, this arm reddens sql-tests on
--   its first run — which is the correct outcome for a genuine leak, but it
--   should be confirmed with one query before merge:
--     select has_function_privilege('anon', oid, 'EXECUTE'),
--            has_function_privilege('authenticated', oid, 'EXECUTE'),
--            has_function_privilege('service_role', oid, 'EXECUTE'),
--            pg_get_function_identity_arguments(oid)
--       from pg_proc
--      where proname = '_enqueue_compute_job_internal'
--        and pronamespace = 'public'::regnamespace;
--
-- What NONE of D1-D5 establishes, said plainly so nobody mistakes the scope:
-- that `obj_description`, `pg_proc.proconfig` or `has_function_privilege`
-- return what this reasoning assumes on a live catalog, that the plpgsql
-- parses, or that the arm ordering behaves as intended at runtime. The FIRST
-- person with a scratch cluster should re-prove D1-D4 the way R2 / R3 / R4
-- above were proved — build each evading body as a REAL function, leave the
-- relevant COMMENT / proconfig in place, and observe the ERROR — and then
-- replace this block with the verbatim output.
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
  v_comment10 text;    -- the CATALOG comment, NOT part of pg_get_functiondef
  v_applied10 boolean; -- ...does it record the OPS-08 fix? (revert discriminator)
  v_pre_apply boolean := false;
  v_cfg7      text[];  -- pg_proc.proconfig — the VALUE of the search_path pin
  v_cfg10     text[];
  -- Signature text for public._assert_no_public_execute in Part 6, which takes
  -- a signature rather than an oid. ⚠️ These MUST stay byte-identical to the
  -- to_regprocedure literals immediately below — they are spelled out twice
  -- rather than shared, because a DECLARE default that reads an earlier
  -- CONSTANT is a construct this file's author could not execute to verify, and
  -- a parse error here reddens sql-tests for the whole suite. If they ever
  -- diverge, Part 6's PUBLIC probe and its named-role checks would silently be
  -- inspecting different functions.
  c_sig7  CONSTANT text :=
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb)';
  c_sig10 CONSTANT text :=
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)';
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
  -- ⭐ THE REVERT MARKER. Derived FROM THE MIGRATION, not from this file: it is
  -- the phrase 20260826150000 writes into the 10-param overload's catalog
  -- COMMENT (that file's COMMENT ON FUNCTION, in the literal '... (Phase 163
  -- OPS-08, parity with the 7-param overload''s mig 109 P3 fix).'). Choosing a
  -- token by reading the file it is supposed to police would prove nothing; the
  -- direction here is the other one, and the pre-apply comment mig 118 leaves
  -- behind does not contain it. See "THE REVERT DISCRIMINATOR" in the header.
  c_applied_marker CONSTANT text := 'Phase 163 OPS-08';
  -- Part 5's search_path VALUE, exactly as Postgres stores a `SET search_path =
  -- public, pg_catalog` declaration in pg_proc.proconfig. Derived from the
  -- DECLARATIONS being policed (20260716090000:61 for the 7-param, :196 for the
  -- 10-param, and 20260826150000's own), never from reading a catalog back.
  -- The stored spelling is not guessed: 20260516170000:212 asserts this exact
  -- literal against proconfig and that migration is applied, so it has already
  -- survived a real deploy.
  c_search_path CONSTANT text := 'search_path=public, pg_catalog';
  -- One arm per target scope in the 10-param overload's XOR: strategy,
  -- portfolio, allocator, api_key. Spelled as a constant so Part 2's
  -- expectation is a number a reader can re-derive from the signature.
  -- ⭐ It carries a SECOND meaning as of the phase-163 re-audit: it is also the
  -- number of STRICT re-reads the pre-fix definition has, because the pre-fix
  -- state is "every one of these four arms is strict". Part 1+3's hybrid arm
  -- uses it for that, rather than a second literal 4 that could drift from this
  -- one. Counted on the definition being policed: 20260716090000:285, :292,
  -- :299, :306.
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

  -- The revert discriminator (WR-04). Read from the CATALOG, deliberately: a
  -- comment attached with COMMENT ON FUNCTION is NOT part of pg_get_functiondef
  -- output, so this is independent of v_body10 and the strip above can neither
  -- reach it nor truncate it. `strpos` rather than LIKE or `~` because the
  -- marker is a fixed substring — a plain substring search has no metacharacter
  -- to mis-escape and no pattern to get subtly wrong.
  --
  -- ⚠️ WHAT THE `coalesce` ACTUALLY BUYS, corrected. Its comment used to claim
  -- it closed a fail-open "exactly as the NULL guard above describes". That was
  -- FALSE when written, and a decorative guard that reads as a real one is worse
  -- than none — the next reviewer scanning for unhandled NULLs sees a green tick
  -- over a hole. obj_description returns NULL for an uncommented function;
  -- strpos(NULL, x) is NULL and NULL > 0 is NULL, so v_applied10 would have been
  -- NULL. Trace both routes through the arms as they then stood: NULL made
  -- `v_strict10 > 0 AND v_applied10` evaluate to NULL, so the revert arm did not
  -- fire and control fell to SKIP; '' made it FALSE, so the revert arm did not
  -- fire and control fell to SKIP. Same destination. The coalesce changed no
  -- failure direction.
  --
  -- It is load-bearing NOW, and only because of the marker-dark arm added below
  -- (the post-fix `ELSIF NOT v_applied10`). That arm negates the value, which
  -- reverses the two routes: `NOT NULL` is NULL, the arm does not fire, and a
  -- post-fix body with NO comment at all sails into the OK notice — fail OPEN.
  -- `NOT FALSE` is TRUE and the arm RAISEs — fail CLOSED. So the coalesce is
  -- what makes the new arm fail in the safe direction on an uncommented
  -- function. Do not remove it as decorative on the strength of the old note.
  v_comment10 := coalesce(obj_description(v_oid10, 'pg_proc'), '');
  v_applied10 := strpos(v_comment10, c_applied_marker) > 0;

  -- ⚠️ THE TWO INCOHERENT ARMS DIFFER ONLY IN THE REMEDY THEY PRESCRIBE, and
  -- splitting them was a correctness fix, not tidiness. A single arm here used
  -- to advise "either finish the de-strict or revert to the pre-fix
  -- definition" — and it was evaluated BEFORE the revert arm, so it shadowed
  -- it. On a MARKED database (one that received 20260826150000 and was then
  -- partly re-stricted) that advice tells the operator to produce exactly the
  -- state the revert arm exists to reject: pre-fix body + marker present. The
  -- remedy would have manufactured the defect. On a marked database there is
  -- only ONE correct direction — forward. RAISE's format string must be a
  -- single literal, so the two messages are two arms rather than one branch.
  IF v_strict10 > 0 AND v_serfail10 AND v_applied10 THEN
    RAISE EXCEPTION 'OPS-08 Part 1+3 FAILED: the deployed 10-param body is INCOHERENT — it carries % strict lost-race re-read(s) AND a serialization_failure raise — and this overload''s catalog COMMENT records the OPS-08 fix, so this database DID receive 20260826150000 and has since been partly re-stricted. A lost race in a re-stricted arm dies on NO_DATA_FOUND inside the strict re-read and never reaches the classified raise. FINISH THE DE-STRICT — go forward. Do NOT "revert to the pre-fix definition": on a marked database that produces pre-fix body + marker present, which is the REVERT state this file rejects one arm below.', v_strict10;
  ELSIF v_strict10 > 0 AND v_serfail10 THEN
    RAISE EXCEPTION 'OPS-08 Part 1+3 FAILED: the deployed 10-param body is INCOHERENT — it carries % strict lost-race re-read(s) AND a serialization_failure raise. Those are the two halves of a fix that was only partly made: a lost race still dies on NO_DATA_FOUND inside the strict re-read and never reaches the classified raise. This overload''s catalog COMMENT does NOT record the OPS-08 fix, so either finish the de-strict or restore the pre-fix definition whole; do not ship the mixture.', v_strict10;
  ELSIF v_strict10 = 0 AND NOT v_serfail10 THEN
    RAISE EXCEPTION 'OPS-08 Part 1+3 FAILED: the deployed 10-param body has NO strict lost-race re-read and NO serialization_failure raise. A lost race whose winner already advanced past the in-flight statuses therefore returns NULL to the caller SILENTLY — strictly worse than the opaque 500 this requirement removes, because nothing surfaces at all. Restore the classified raise after the IF-chain.';
  ELSIF v_strict10 > 0 AND v_applied10 THEN
    RAISE EXCEPTION 'OPS-08 Part 1+3 FAILED: this is a REVERT, not a pre-apply database. The deployed 10-param body carries % strict lost-race re-read(s) and no classified raise — the PRE-FIX definition exactly — but this overload''s CATALOG COMMENT records the OPS-08 fix, and only 20260826150000 writes that phrase. A comment is not part of the function body: CREATE OR REPLACE does not clear it, and 20260716090000 (the newest ancestor carrying a full body, hence the one a re-base copies) issues no COMMENT ON FUNCTION at all. So this database RECEIVED the fix and then LOST it, which the coherence arm below would otherwise have reported as a harmless pre-apply SKIP and passed. PROD is back to raising P0002 NO_DATA_FOUND on every lost race and surfacing an opaque 500. Re-base on 20260826150000 or newer and keep BOTH halves: the plain re-read and the serialization_failure raise.', v_strict10;
  -- ⛔ THE PRE-APPLY TOLERANCE IS FOR THE PRE-FIX DEFINITION, NOT FOR "SOME
  -- STRICT RE-READS". This arm keyed on `v_strict10 > 0` until the phase-163
  -- re-audit, and that was a FAIL-OPEN hole with a silent-failure outcome, not
  -- a cosmetic looseness. The pre-fix body has EXACTLY FOUR strict re-reads —
  -- one per target scope, the same four Part 2 counts — so any count of 1..3 is
  -- a HYBRID: half the arms re-based forward onto 20260826150000 and half left
  -- behind, which also means the `IF v_new_id IS NULL THEN RAISE ...
  -- serialization_failure` guard was lost with the half that moved. On the
  -- PLAIN arms of such a body a lost race returns NULL, the enqueue no-ops, and
  -- the caller receives a NULL job id — the exact silent failure this whole file
  -- exists to prevent — and the old arm answered SKIP and exited 0 on it.
  -- The expectation is c_expected_arms, not a separate literal, because the two
  -- are the same fact: the pre-fix state is "every one of the four lost-race
  -- arms is strict". Counted on the definition being policed, NOT on this file:
  -- 20260716090000:285, :292, :299 and :306. A count ABOVE four is caught by the
  -- same `<>` — it means the construct appears somewhere there is no arm for it.
  ELSIF v_strict10 > 0 AND v_strict10 <> c_expected_arms THEN
    RAISE EXCEPTION 'OPS-08 Part 1+3 FAILED: the deployed 10-param body carries % strict lost-race re-read(s) and no classified raise. That is neither the post-fix state nor the pre-fix one — the pre-fix definition has exactly % of them, one per target scope. This is a HYBRID: some arms were re-based forward and some were not, and the serialization_failure raise went with the ones that moved. Every arm still on the plain form now returns NULL to the caller on a lost race instead of the winner id, and the enqueue silently no-ops. This is NOT a pre-apply database and must not be reported as one. Re-base the whole body on 20260826150000.', v_strict10, c_expected_arms;
  ELSIF v_strict10 > 0 THEN
    v_pre_apply := true;
    RAISE NOTICE 'SKIP (Part 3): this database still runs the pre-fix 20260716090000 definition — % strict lost-race re-read(s), the exact pre-fix count, and no classified raise — and this overload''s catalog COMMENT does NOT record the OPS-08 fix, so it has never received 20260826150000 rather than having received it and lost it (that pair RAISEs two arms above). The pre-fix pair is COHERENT, so this file does not fail on it: it sorts 30th of ~70 in the sql-tests glob and the runner exits on first failure, so failing here would suppress every file after it. WITHHELD: Part 3, the serialization_failure raise. STILL ASSERTED below: Parts 2, 4, 5 and 6, and the revert and hybrid arms above. Hand-apply 20260826150000 to this project to arm Part 3.', v_strict10;
  -- ⛔ AND THE DISCRIMINATOR MUST NOT GO DARK ON A POST-FIX BODY. Reaching here
  -- means zero strict re-reads AND the classified raise: the fix is in the body.
  -- But every consultation of the marker above sits inside a `v_strict10 > 0`
  -- branch, so before this arm a post-fix body fell straight through to the OK
  -- notice whether the catalog comment carried the phrase or not. The marker
  -- could therefore vanish from PROD — a migration that re-issues COMMENT ON
  -- FUNCTION without it, or a DROP + re-create, both of which this family has
  -- seen — and NOTHING would report it. The revert arm would then be permanently
  -- disarmed: a later stale re-base would restore the pre-fix body, find no
  -- marker, and be waved through as a harmless pre-apply SKIP.
  -- The remedy the migration prescribes is to carry the phrase forward, and it
  -- says so in the ⛔ note above its COMMENT ON FUNCTION. This arm makes
  -- ignoring that instruction loud instead of silent.
  ELSIF NOT v_applied10 THEN
    RAISE EXCEPTION 'OPS-08 Part 1+3 FAILED: the deployed 10-param body carries the OPS-08 fix — no strict lost-race re-read, and the serialization_failure raise is present — but this overload''s catalog COMMENT does NOT contain the marker phrase 20260826150000 writes. The body and the catalog disagree. This is not a body defect: it is the REVERT DISCRIMINATOR going dark, and it disarms the arm above that tells a stale re-base apart from a never-applied database. Once the marker is gone, a future re-base onto 20260716090000 would restore the pre-fix body and be reported here as a harmless pre-apply SKIP, exit 0, while PROD raises P0002 on every lost race. Something rewrote or dropped this comment without carrying the phrase forward — re-issue the COMMENT ON FUNCTION from 20260826150000, or supersede this marker deliberately in the same change.';
  ELSE
    RAISE NOTICE 'OPS-08 Part 1+3 OK: the deployed 10-param body carries no strict lost-race re-read, does raise serialization_failure on an exhausted one, and its catalog COMMENT still carries the revert-discriminator marker.';
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

  -- ⛔ ...AND THE PIN IS A VALUE, NOT A WORD. The arm above matches the TOKEN
  -- `search_path` anywhere in the definition TEXT. It passes on
  -- `SET search_path = ''`, which is the classic hijack — an unqualified
  -- reference inside a SECURITY DEFINER body then resolves against the CALLER's
  -- path — and it passes on `public, pg_temp, evil`, and on a body that merely
  -- mentions the word in a literal. It proved the word was present, never that
  -- the pin was safe. Read the VALUE from pg_proc.proconfig, which is also where
  -- a GUC set by any route other than the CREATE statement would appear. The
  -- token arm is kept above as a cheap pre-check that names the blunter failure
  -- first. The expected string is derived from the DECLARATIONS being policed
  -- (20260716090000:61 and :196, and 20260826150000's own), not from reading a
  -- catalog back; 20260516170000:212 already asserts this exact literal against
  -- proconfig and is applied, so the stored spelling has survived a real deploy.
  SELECT p.proconfig INTO v_cfg7  FROM pg_proc p WHERE p.oid = v_oid7;
  SELECT p.proconfig INTO v_cfg10 FROM pg_proc p WHERE p.oid = v_oid10;
  IF v_cfg7 IS NULL OR NOT (c_search_path = ANY(v_cfg7)) THEN
    RAISE EXCEPTION 'OPS-08 Part 5 FAILED: the 7-param overload does not pin search_path to the exact declared value public, pg_catalog (pg_proc.proconfig=%). An empty or reordered pin on a SECURITY DEFINER function is search-path-hijackable, and the token arm above cannot see the difference.', v_cfg7;
  END IF;
  IF v_cfg10 IS NULL OR NOT (c_search_path = ANY(v_cfg10)) THEN
    RAISE EXCEPTION 'OPS-08 Part 5 FAILED: the 10-param overload does not pin search_path to the exact declared value public, pg_catalog (pg_proc.proconfig=%). An empty or reordered pin on a SECURITY DEFINER function is search-path-hijackable, and the token arm above cannot see the difference.', v_cfg10;
  END IF;
  RAISE NOTICE 'OPS-08 Part 5 OK: retired-kind admission branch, SECURITY DEFINER and the exact search_path pin intact on both overloads.';

  -- ----- Part 6 — the ACL, on BOTH overloads, on EVERY run ------------------
  -- ⭐ WHY THIS EXISTS AT ALL. 20260826150000 argues at length that every
  -- CREATE OR REPLACE of this family is an opportunity for Supabase's
  -- default-grant event trigger to re-open EXECUTE to anon + authenticated —
  -- observed on this exact family, on the TEST project, and remediated by
  -- 20260515130001 (mig 118). Then it asserted that RECURRING risk exactly
  -- ONCE, in its own apply-time DO block. A drift arriving from any later
  -- CREATE OR REPLACE, or from a hand-run GRANT, had nothing watching it.
  --
  -- LEAK SCOPE, so the severity is not guessed at: these are `public.*`
  -- functions, so PostgREST exposes them; they are SECURITY DEFINER, so the
  -- body runs as the owner; and the body performs NO ownership check of any
  -- kind — it takes a strategy_id / portfolio_id / allocator_id / api_key_id
  -- and enqueues against it. A re-opened `authenticated` grant therefore makes
  -- this a cross-tenant enqueue primitive callable by any logged-in user
  -- against ANY tenant's ids. That is a data-integrity hole, not a hygiene one.
  --
  -- ⚠️ ORDERED LAST DELIBERATELY. A RAISE here aborts the DO block, and this
  -- file sorts 30th of ~70 in the sql-tests glob with the runner exiting on
  -- first failure. Running Part 6 after Parts 1+3 / 2 / 4 / 5 means their
  -- NOTICEs have already been emitted when it fires, so an ACL drift costs the
  -- ~40 files after this one but does NOT also blind this file's own arms.
  --
  -- ⚠️ The role-existence check is not ceremony: has_function_privilege on an
  -- absent role raises `role "anon" does not exist`, which reads as a mystery.
  -- These three are Supabase-standard; their absence means this gate is pointed
  -- at a database it was not written for — say THAT.
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'OPS-08 Part 6 FAILED: one of the roles anon / authenticated / service_role does not exist on this database, so the ACL arm cannot be evaluated. These are Supabase-standard roles; their absence means this gate is pointed at a database it was not written for.';
  END IF;

  -- The canonical PUBLIC probe first, for ATTRIBUTION rather than detection —
  -- the named-role checks below would already catch a PUBLIC grant (anon and
  -- authenticated inherit it), but they would name the wrong grantee and send
  -- the operator to REVOKE from roles that do not hold it. Guarded on existence
  -- because, unlike the migration's copy of this arm, this file may run against
  -- a database that never received 20260515205431.
  IF to_regprocedure('public._assert_no_public_execute(text)') IS NOT NULL THEN
    PERFORM public._assert_no_public_execute(c_sig7);
    PERFORM public._assert_no_public_execute(c_sig10);
  END IF;

  IF has_function_privilege('anon', v_oid7, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid7, 'EXECUTE') THEN
    RAISE EXCEPTION 'OPS-08 Part 6 FAILED: anon or authenticated holds EXECUTE on the 7-param SECURITY DEFINER overload. Migration 118 revoked exactly this after Supabase''s default-grant event trigger re-opened it on mig 109. The body performs no ownership check, so a PostgREST-reachable grant makes it a cross-tenant enqueue primitive. Re-run 20260515130001''s REVOKE for this signature and find what re-granted it.';
  END IF;
  IF has_function_privilege('anon', v_oid10, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid10, 'EXECUTE') THEN
    RAISE EXCEPTION 'OPS-08 Part 6 FAILED: anon or authenticated holds EXECUTE on the 10-param SECURITY DEFINER overload. Migration 118 and 20260826150000 both revoke exactly this. The body performs no ownership check, so a PostgREST-reachable grant makes it a cross-tenant enqueue primitive against any tenant''s strategy / portfolio / allocator / api_key id.';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid7, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid10, 'EXECUTE') THEN
    RAISE EXCEPTION 'OPS-08 Part 6 FAILED: service_role lost EXECUTE on an _enqueue_compute_job_internal overload — every sanctioned enqueue path runs through these, so this breaks the queue rather than securing it.';
  END IF;
  RAISE NOTICE 'OPS-08 Part 6 OK: neither overload is EXECUTE-reachable by PUBLIC, anon or authenticated, and service_role holds EXECUTE on both.';

  IF v_pre_apply THEN
    RAISE NOTICE 'test_enqueue_internal_destrict: parts 1+3 (pre-apply arm), 2, 4, 5 and 6 executed.';
  ELSE
    RAISE NOTICE 'test_enqueue_internal_destrict: parts 1+3, 2, 4, 5 and 6 executed.';
  END IF;
END
$$;

ROLLBACK;
