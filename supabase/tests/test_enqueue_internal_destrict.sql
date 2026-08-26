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
--   Part 1 — the 10-param overload resolves, and its body contains ZERO strict
--            lost-race re-reads. This is the OPS-08 property.
--   Part 2 — that de-strict did not come from DELETING arms: the body still
--            contains EXACTLY FOUR plain `SELECT id INTO v_new_id` re-reads,
--            one per target scope (strategy / portfolio / allocator / api_key).
--            Part 1 alone is satisfiable by removing the arms outright, which
--            would be a far worse regression than the one being fixed.
--   Part 3 — the other half of the fix is present: the body raises with ERRCODE
--            serialization_failure. Without it a lost race whose winner already
--            advanced returns NULL to the caller SILENTLY, which is worse than
--            the 500 being removed.
--   Part 4 — 7-param parity pin. That overload is already clean (measured 0
--            strict re-reads pre-edit), so this arm can only fail if a future
--            re-base reintroduces the defect there — which is exactly how the
--            10-param body acquired it.
--   Part 5 — the Phase 106 retired-kind reject, SECURITY DEFINER and SET
--            search_path survive in BOTH bodies. A CREATE OR REPLACE that
--            re-bases on a STALE definition silently drops these; the source
--            migration's own DO block pins them at deploy time and this is the
--            recurring half of that pin.
--
-- ⭐ THE GATE TOKEN IS THE STATEMENT FORM, AND IT WAS COUNTED PRE-EDIT.
-- `pg_get_functiondef` returns the body's COMMENTS as well as its statements,
-- so a gate grepping for a bare identifier can be satisfied by the function's
-- own prose about itself (T-163-16). The needle here is the keyword pair plus
-- the target variable's prefix, matched whitespace-tolerantly so a re-read
-- reformatted across a line break cannot evade it. Counted on the CURRENT
-- deployed definition (20260716090000) BEFORE any edit: FOUR occurrences in the
-- 10-param body, ZERO in the 7-param body. Part 1's failure message reports the
-- count it found, so a pre-apply run states the measured 4 out loud rather than
-- asserting an unfalsifiable 0.
--
-- ⛔ AND T-163-16 IS CLOSED MECHANICALLY, NOT BY CONVENTION. Every arm below
-- matches against a COMMENT-STRIPPED copy of the definition, never the raw one.
-- This was not a precaution: the hole was DEMONSTRATED on a scratch Postgres
-- 16 while this file was being written. A body whose raise had been changed to
-- `no_data_found`, carrying one comment line reading "historically this was
-- USING ERRCODE = 'serialization_failure';", passed Parts 3 and 5 GREEN — a
-- function that no longer classifies a lost race, reported as compliant on the
-- strength of prose about itself. Stripping `--` line comments first makes the
-- presence checks read STATEMENTS only, so no comment can vouch for a
-- behaviour the body does not have.
-- ⚠️ The strip assumes no string literal in either body contains a `--`
-- sequence (verified at HEAD: every em-dash in these messages is U+2014, not
-- two hyphens). If a future message introduces one, that literal's tail is
-- truncated before matching — which can only cause a FALSE FAILURE, never a
-- false pass, so the failure direction is safe.
--
-- ⚠️ Pre-apply (RED), and this is EXPECTED, not a defect: Part 1 fails because
-- the deployed 10-param body still carries the four strict re-reads, and
-- ON_ERROR_STOP aborts there — Parts 2-5 never run. Nothing applies migrations
-- to the TEST project automatically (the `sql-tests` job has no apply step, and
-- .github/workflows/supabase-migrate.yml targets PRODUCTION only), so this file
-- stays RED in CI until 20260826150000 is hand-applied to TEST. That observed
-- RED → GREEN flip IS this gate's anti-vacuity demonstration: it is a test that
-- has been seen to fail, on the real property, for the real reason.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands (the
-- sql-tests preflight rejects shell-out / copy / output redirection). ⛔ NO SKIP
-- PATH: the anti-SKIP gate makes a file that prints a whole-file skip and exits
-- 0 FAIL the job, and rightly — an absent object here means the migration did
-- not land, which is the single thing this file exists to detect. An absent
-- overload RAISEs.
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
-- integers) is tracked as follow-up.
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
-- Parts 1-5. One DO block: every arm reads the same two function definitions,
-- and splitting them would mean four more pg_get_functiondef round trips for
-- no added discrimination.
-- ==========================================================================
DO $$
DECLARE
  v_fn7    text;   -- raw pg_get_functiondef output (header + body + comments)
  v_fn10   text;
  v_body7  text;   -- ...with `--` line comments stripped. MATCH ON THESE.
  v_body10 text;
  v_n      int;
  v_oid7  oid := to_regprocedure(
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb)'
  );
  v_oid10 oid := to_regprocedure(
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)'
  );
  -- The statement-form needles. Whitespace-tolerant on purpose (see the header):
  -- plpgsql stores a body verbatim, so a re-read wrapped across a line break is
  -- byte-different but semantically identical, and a contiguous-substring search
  -- would miss it.
  c_strict_re  CONSTANT text := 'INTO[[:space:]]+STRICT[[:space:]]+v_';
  c_plain_re   CONSTANT text := 'SELECT[[:space:]]+id[[:space:]]+INTO[[:space:]]+v_new_id';
  c_serfail_re CONSTANT text :=
    'USING[[:space:]]+ERRCODE[[:space:]]*=[[:space:]]*''serialization_failure''';
  -- One arm per target scope in the 10-param overload's XOR: strategy,
  -- portfolio, allocator, api_key. Spelled as a constant so Part 2's
  -- expectation is a number a reader can re-derive from the signature.
  c_expected_arms CONSTANT int := 4;
BEGIN
  -- ----- resolution (no skip path: an absent overload is the failure) -------
  IF v_oid10 IS NULL THEN
    RAISE EXCEPTION 'OPS-08 gate: the 10-param _enqueue_compute_job_internal overload does not exist on this database. Migration 20260826150000 (and its 20260716090000 ancestor) has not been applied here. This is a FAILURE, not a skip — an absent overload is indistinguishable from a body that lost the fix, and nothing applies migrations to this project automatically.';
  END IF;
  IF v_oid7 IS NULL THEN
    RAISE EXCEPTION 'OPS-08 gate: the 7-param _enqueue_compute_job_internal overload does not exist on this database — the parity pin in Part 4 cannot be evaluated.';
  END IF;

  v_fn7  := pg_get_functiondef(v_oid7);
  v_fn10 := pg_get_functiondef(v_oid10);

  -- T-163-16: strip `--` line comments so every arm below reads STATEMENTS,
  -- not the function's prose about itself. The 'n' flag is what makes `.`
  -- newline-INsensitive here; without it Postgres' `.` matches newlines and
  -- the first comment would eat the rest of the definition.
  v_body7  := regexp_replace(v_fn7,  '--.*', '', 'gn');
  v_body10 := regexp_replace(v_fn10, '--.*', '', 'gn');

  -- ----- Part 1 — zero strict lost-race re-reads in the 10-param body ------
  SELECT count(*) INTO v_n
    FROM regexp_matches(v_body10, c_strict_re, 'g');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'OPS-08 Part 1 FAILED: the deployed 10-param body still carries % strict lost-race re-read(s) (expected 0; the pre-fix definition 20260716090000 carries exactly 4, one per target scope). A lost race whose winner advanced past the in-flight statuses raises NO_DATA_FOUND there and surfaces as an opaque 500. If this is a pre-apply run, that is the EXPECTED RED — hand-apply 20260826150000 to this project.', v_n;
  END IF;
  RAISE NOTICE 'OPS-08 Part 1 OK: the deployed 10-param body carries no strict lost-race re-read.';

  -- ----- Part 2 — and it got there by de-stricting, not by deleting arms ---
  SELECT count(*) INTO v_n
    FROM regexp_matches(v_body10, c_plain_re, 'g');
  IF v_n <> c_expected_arms THEN
    RAISE EXCEPTION 'OPS-08 Part 2 FAILED: the deployed 10-param body contains % plain lost-race re-read(s), expected % — one per target scope (strategy / portfolio / allocator / api_key). Part 1 is also satisfied by DELETING an arm, which would make that scope return NULL on every lost race instead of the winner id. Restore the missing arm.', v_n, c_expected_arms;
  END IF;
  RAISE NOTICE 'OPS-08 Part 2 OK: all four lost-race arms are present as plain re-reads.';

  -- ----- Part 3 — the classified, retry-safe raise -------------------------
  IF v_body10 !~ c_serfail_re THEN
    RAISE EXCEPTION 'OPS-08 Part 3 FAILED: the deployed 10-param body has no serialization_failure raise. Without it a lost race whose winner already advanced past the in-flight statuses returns NULL to the caller silently — a worse failure than the opaque 500 this requirement removes, because nothing surfaces at all.';
  END IF;
  RAISE NOTICE 'OPS-08 Part 3 OK: the 10-param body raises serialization_failure on an exhausted lost-race re-read.';

  -- ----- Part 4 — 7-param parity pin --------------------------------------
  SELECT count(*) INTO v_n
    FROM regexp_matches(v_body7, c_strict_re, 'g');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'OPS-08 Part 4 FAILED: the 7-param body reacquired % strict lost-race re-read(s) (expected 0 — it has been clean since mig 109 P3). A CREATE OR REPLACE re-based on a definition older than 20260716090000 does exactly this.', v_n;
  END IF;
  IF v_body7 !~ c_serfail_re THEN
    RAISE EXCEPTION 'OPS-08 Part 4 FAILED: the 7-param body lost its serialization_failure raise (mig 109 P3 regressed).';
  END IF;
  RAISE NOTICE 'OPS-08 Part 4 OK: the 7-param overload is still clean — the two overloads are at parity.';

  -- ----- Part 5 — properties a stale re-base silently drops ----------------
  IF position('compute_analytics is retired' IN v_body10) = 0
     OR position('compute_analytics is retired' IN v_body7) = 0 THEN
    RAISE EXCEPTION 'OPS-08 Part 5 FAILED: an overload lost the Phase 106 retired-kind reject. The registry and both CHECK constraints still ADMIT compute_analytics (45 historical rows FK-reference it), so the RPC-level reject is the only thing keeping the retired kind out of the queue.';
  END IF;
  IF v_body10 !~* 'SECURITY DEFINER' OR v_body7 !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'OPS-08 Part 5 FAILED: an overload lost SECURITY DEFINER — every sanctioned enqueue path runs through these functions on behalf of a caller that cannot write compute_jobs directly.';
  END IF;
  IF v_body10 !~* 'search_path' OR v_body7 !~* 'search_path' THEN
    RAISE EXCEPTION 'OPS-08 Part 5 FAILED: an overload lost SET search_path — a SECURITY DEFINER function without a pinned search_path is search-path-hijackable.';
  END IF;
  RAISE NOTICE 'OPS-08 Part 5 OK: retired-kind reject, SECURITY DEFINER and SET search_path intact on both overloads.';

  RAISE NOTICE 'test_enqueue_internal_destrict: parts 1, 2, 3, 4 and 5 executed.';
END
$$;

ROLLBACK;
