-- ==========================================================================
-- Phase 163 (v1.20 HARDEN), OPS-08 / SC-3 SQL half: de-strict the 10-param
-- `_enqueue_compute_job_internal` lost-race re-reads.
--
-- THE DEFECT. After the race-safe `INSERT ... ON CONFLICT DO NOTHING` returns
-- no row, the function re-reads the winner's row filtered to the three
-- IN-FLIGHT statuses ('pending', 'running', 'done_pending_children'). Between
-- the conflict and the re-read the winner may LEGITIMATELY have advanced past
-- those statuses (done / failed_*), so the re-read finds nothing. The strict
-- form of that re-read raises NO_DATA_FOUND (SQLSTATE P0002) with no
-- domain-specific message, and the user-facing request surfaces it as an
-- opaque 500 on what is an ordinary, retry-safe MVCC outcome.
--
-- THE FIX FOLLOWS THE 7-PARAM'S LOST-RACE PATH, AND ONLY THAT PATH. The
-- 7-param overload in the SAME source migration (20260716090000:139-176) was
-- fixed this way already (mig 109 P3): a PLAIN re-read, then an explicit
-- `IF v_new_id IS NULL THEN RAISE ... USING ERRCODE = 'serialization_failure'`
-- — the canonical Postgres class for "MVCC race, retry safe". This migration
-- replicates that lost-race handling across the 10-param overload's FOUR arms
-- (strategy / portfolio / allocator / api_key). Measured pre-edit: 4 strict
-- re-reads in the 10-param body, 0 in the 7-param body.
--
-- ⚠️ READ "PARITY" NARROWLY — IT IS THE LOST-RACE PATH, NOT THE TWO BODIES.
-- They are NOT interchangeable, and a future editor re-basing on the belief
-- that they are will get it wrong: the 7-param computes `v_initial_status`
-- ('done_pending_children' when p_parent_job_ids is non-empty) and INSERTs it
-- explicitly, while the 10-param omits `status` from its INSERT and takes the
-- column default. That divergence predates this migration, is not introduced
-- or corrected here, and is deliberately left alone — it is a behavioural
-- difference in the INSERT, outside OPS-08's scope.
--
-- ⛔ WHAT THIS DOES NOT BUY, SAID BEFORE ANYONE RELIES ON IT. It buys a
-- CORRECT, DISAMBIGUATED SQLSTATE (40001) in the server log and in the error
-- the caller receives, in place of a bare P0002 that is indistinguishable from
-- any other empty strict SELECT. That is a PREREQUISITE for retrying a lost
-- race; it is NOT a retry, and nothing in this repo retries a 40001 raised by
-- an ENQUEUE. That conclusion stands, but the evidence for it was previously a
-- `src/`-only grep, which never reached the caller most likely to grow such a
-- branch. RE-MEASURED ACROSS BOTH HALVES OF THE REPO AT HEAD, 2026-08-26:
--   * TypeScript — `grep -rn serialization_failure src/` returns TWO hits, both
--     in test files (src/__tests__/compute-jobs-audit-2026-05-07-g10b.test.ts:18
--     and src/__tests__/reconcile-dropped-enqueue-sweep.test.ts:496); '40001'
--     has ZERO non-test hits. src/app/api/allocator/holdings/sync/route.ts:73-87
--     still answers a blanket 500 for every SQLSTATE except 42501.
--   * PYTHON — and here the old grep was BLIND. analytics-service DOES classify
--     40001, in TWO places, and NEITHER is on an enqueue path:
--       - main_worker.py:392 `_is_serialization_failure` — ONE production call
--         site, main_worker.py:583, inside `_safe_mark`, which wraps only the
--         three MARK RPCs (_mark_done :935, _mark_failed :961,
--         _mark_failed_fallback :1007). It SWALLOWS the 40001 and logs
--         LATE_MARK_IGNORED; it does not retry.
--       - services/job_worker.py:880 `_defer_lost_ownership` — ONE call site,
--         :995, wrapping defer_compute_job. It YIELDS the job as DEFERRED; it
--         does not retry either.
--     Both exist because migration 117 fenced the mark/defer RPCs on
--     claim_token, so a watchdog reclaim surfaces as 40001 there. An enqueue
--     40001 reaches neither classifier.
-- So until a caller branches on 40001 the USER-VISIBLE outcome of a lost race is
-- UNCHANGED by this migration — only the operator's diagnosis improves. The TS
-- half is recorded as owed work in TODOS.md and is out of this migration's
-- scope.
--
-- ⛔ OWED: WR-07 — THE RAISE MESSAGE REACHES A USER-VISIBLE COLUMN, AND THAT
-- CANNOT BE CLOSED IN SQL. Recorded here rather than patched, deliberately:
-- the honest answer is "not fixable in this file", and a reworded string would
-- have looked like a fix while changing nothing that matters.
--
-- THE PATH (measured at HEAD, 2026-08-26):
--   src/app/api/strategies/csv-finalize/route.ts:2035 builds
--     `compute job enqueue failed: ${enqueueErrMessage}`
--   -> writeFailedStrategyAnalyticsPlaceholder (:1868)
--   -> strategy_analytics.computation_error (:1928), a USER-VISIBLE column that
--      renders verbatim in the wizard failure envelope.
--
-- WHY SQL CANNOT CLOSE IT. That prefix is added on the TS side and is
-- UNCONDITIONAL — no SQLSTATE branch stands in front of it. Whatever this
-- migration raises, the strategy's owner reads a sentence BEGINNING with
-- "compute job enqueue failed:". SQL picks which jargon follows the colon; it
-- cannot remove the jargon. Nor does moving the operator sentence into
-- USING DETAIL help: the sink reads PostgREST's `.message`, never `.details`.
--
-- WHAT IT NEEDS — a TS change in that file, outside this migration's scope:
--   1. Branch at the sink on the PostgREST error code, `enqueueErr.code ===
--      '40001'`. MEASURED: zero quoted occurrences of '40001' anywhere in
--      src/**/*.ts{,x} at HEAD, so no such branch exists yet.
--   2. On that branch DROP the "compute job enqueue failed: " prefix — it is
--      half the defect — instead of interpolating into it.
--   3. The curated sentence does not need inventing. computation_error_copy(TEXT)
--      (mig 20260826120000, Phase 162 HONEST-01) is IMMUTABLE, TOTAL and
--      service_role-EXECUTEable, and its ELSE arm is already right for a lost
--      enqueue race: "Analytics could not complete for this strategy. Retry the
--      sync, or contact support if this persists." It claims nothing about
--      automatic retries, which is precisely what makes it true here.
--   ⚠️ The BRIDGE is not the route, though the helper is. sync_strategy_
--   analytics_status derives the copy from compute_jobs.error_kind, and a
--   FAILED ENQUEUE leaves no compute_jobs row to carry a kind — so this path
--   never reaches the bridge. Call the helper directly.
--
-- ⛔ AND DO NOT SHIP THE COPY THE REVIEW SUGGESTED. WR-07 proposed "Your
-- analytics run collided with another job and will retry automatically." That
-- is FALSE at HEAD — see the ⛔ block above: nothing in this repo retries a
-- 40001. It would trade operator jargon for a false promise, which is the
-- HONEST-01 class over again, one layer down.
--
-- BEHAVIOUR DELTA, stated narrowly. The ONLY paths whose behaviour changes are
-- the four lost-race re-reads, and only when they find NO row:
--   before → P0002 NO_DATA_FOUND, no message, opaque 500.
--   after  → 40001 serialization_failure, short message, no ids. The SQLSTATE
--             is the signal; see the ⛔ note on the RAISE itself for why the
--             message deliberately carries neither the function name nor the
--             id tuple (that text reaches a USER-VISIBLE column).
-- A re-read that FINDS a row is byte-identical (the strict form's multi-row
-- arm was already unreachable: every arm carries `LIMIT 1`, so TOO_MANY_ROWS
-- could never fire, and the strict form's only live effect was the empty-set
-- raise this migration replaces). No row is written, read, or deleted by this
-- migration; it replaces one function body.
--
-- RE-BASE DISCIPLINE (project rule: re-base SQL fns on the LATEST def — grep
-- ALL migrations for any newer CREATE OR REPLACE of either overload before
-- editing). RE-MEASURED AT HEAD **WITH THIS FILE PRESENT**, 2026-08-26 — the
-- previous version of this note was stale in exactly the way the rule warns
-- about, because adding this file changed the answer it recorded:
--   `grep -rn "_enqueue_compute_job_internal" supabase/migrations/` → 119 hits
--   across 15 files (14 of the hits are in THIS file). SEVEN of them are a
--   `CREATE OR REPLACE FUNCTION` of one of the two overloads, spread over six
--   files: 20260411144407:345, 20260418194206:175, 20260420073003:330,
--   20260510180226:164, 20260716090000:49 (7-param) and :181 (10-param), and
--   THIS FILE at :189 — which is now the NEWEST by timestamp, so a future
--   re-base must take ITS body, not 20260716090000's.
--   Excluding this file: six CREATE OR REPLACE statements across five files,
--   newest ancestor 20260716090000_retire_compute_analytics_kind_rpc_guard.sql
--   (7-param at :49, 10-param at :181) — which is the definition this file's
--   10-param body is re-based on. 20260515130001 is ACL-only (REVOKE / GRANT /
--   COMMENT), no body; every other later reference is prose in a comment.
--   ⚠️ AND THE FAMILY HAS BEEN `DROP FUNCTION`ed TWICE, which a CREATE-OR-
--   REPLACE-only survey misses: 20260418194206:168 (7-param) and
--   20260420073003:327 (8-param). A DROP is the FORCED idiom for a parameter
--   rename or a return-type change, and it destroys the catalog COMMENT — see
--   the ⛔ note above COMMENT ON FUNCTION below, which now depends on that
--   comment surviving.
--   ⛔ 20260716090000 is APPLIED. It is NOT edited here — this is a NEW
--   forward-only migration, which is the only sanctioned shape.
--
-- WHAT IS BYTE-UNCHANGED vs WHAT IS NOT. The 10-param body below is verbatim
-- from 20260716090000:181-313 — signature, DECLARE block, 4-way XOR guard,
-- p_kind NULL guard, the Phase 106 retired-kind reject, the optimistic
-- per-target look-up, and the race-safe INSERT — with exactly TWO changes,
-- both confined to the lost-race section:
--   (1) the four strict-form re-reads become plain `SELECT id INTO`
--       (same query, same LIMIT 1, same status filter);
--   (2) a single `IF v_new_id IS NULL THEN RAISE ... serialization_failure`
--       follows the IF-chain, copied in STRUCTURE from the 7-param's
--       20260716090000:163-172 but NOT in message text: this one names no
--       function and no ids, because a message raised here is rendered to the
--       strategy's owner (see the ⛔ note on the RAISE).
-- SECURITY DEFINER and `SET search_path = public, pg_catalog` are preserved
-- exactly. The Phase 106 retired-kind reject is preserved exactly — the
-- self-verifying DO block below asserts it on BOTH overloads and the deploy
-- fails (correctly) without it.
-- FUTURE EDITORS: if you extend either overload, re-base on THIS file (or a
-- newer one) and KEEP both the retired-kind guard and the plain re-read.
--
-- GRANTS ARE RE-CONVERGED, NOT ASSUMED. CREATE OR REPLACE preserves ACLs, but
-- 20260515130001 (mig 118) records a Supabase default-grant EVENT TRIGGER that
-- re-opened EXECUTE to anon + authenticated on exactly this function family the
-- last time it was CREATE OR REPLACE'd. So this migration re-issues mig 118's
-- REVOKE/GRANT for the 10-param signature (idempotent) and THEN asserts the end
-- state in the DO block. See the ⛔ note above those statements for why
-- assert-only would have been the wrong call.
--
-- REVERSIBLE: re-run 20260716090000's 10-param body verbatim. There is no
-- schema change to undo — this migration replaces one function body, refreshes
-- one COMMENT, and re-issues two grants that were already the intended state.
--
-- Transaction style: NO explicit BEGIN/COMMIT — Supabase wraps each migration
-- in an implicit transaction. SET LOCAL lock_timeout applies to that wrap. This
-- migration writes ZERO table data and validates no existing rows.
-- Every RAISE format string below is a SINGLE literal (Phase 85 invariant #21 —
-- no '||' concatenation inside a RAISE format slot).
--
-- Gate: supabase/tests/test_enqueue_internal_destrict.sql asserts the DEPLOYED
-- body via pg_get_functiondef. Nothing applies migrations to the TEST project
-- automatically (supabase-migrate.yml targets PRODUCTION only), so that gate is
-- written to be MEANINGFUL IN BOTH STATES rather than knowingly red in one: it
-- asserts a both-or-neither coherence property that holds on the pre-fix
-- definition and on this one, and RAISEs on any mixture. See its header for
-- why a knowingly-RED file was the wrong shape — it sorts 30th of ~70 in the
-- sql-tests glob and the runner exits on first failure, so leaving it red
-- would have suppressed every file sorting after it.
-- ⛔ AND IT NO LONGER TOLERATES THE PRE-FIX PAIR UNCONDITIONALLY (phase-163
-- review, WR-04): coherence alone could not tell "never applied" from "applied,
-- then reverted by a stale re-base", because those two produce an IDENTICAL
-- body. The gate now decides that on the CATALOG COMMENT this migration writes
-- — see the ⛔ note above the COMMENT ON FUNCTION statement below, which is why
-- the phrase "Phase 163 OPS-08" in it must not be dropped.
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- 10-param overload — verbatim from 20260716090000:181 with ONLY the four
-- lost-race re-reads de-strict-ed and the serialization_failure raise added.
--
-- ⚠️ GATE-TOKEN HYGIENE (T-163-16). `pg_get_functiondef` returns the body's
-- COMMENTS as well as its statements, so a gate grepping for a bare identifier
-- can be satisfied by prose the function carries about itself. Two layers close
-- that here — but they do NOT both cover both overloads, and the difference is
-- the point:
--   1. CONVENTION — the comments inside the body BELOW are phrased as "the
--      strict re-read" rather than as the statement form. Belt, and it governs
--      ONLY the 10-param body, because that is the only body this file writes.
--   2. MECHANISM — the DO block at the end of this file, and the recurring gate
--      in supabase/tests/, both match against a COMMENT-STRIPPED copy of the
--      definition, stripping BOTH plpgsql comment syntaxes (line and block).
--      It was added because the hole was DEMONSTRATED, not hypothesised: on a
--      scratch Postgres 16, a body whose raise had been changed to
--      `no_data_found` while one comment quoted the old ERRCODE clause passed
--      the presence arms GREEN. The phase-163 review then demonstrated the SAME
--      hole a second time through the block-comment syntax, which the first
--      strip did not cover — hence both.
--
-- ⛔ AND FOR THE 7-PARAM OVERLOAD LAYER 2 IS NOT "BRACES" — IT IS THE ONLY
-- LAYER, AND IT IS LOAD-BEARING ON PROD ALONE. Layer 1 cannot apply there: that
-- body is 20260716090000's and this file does not write it, and it carries the
-- construct in a LINE COMMENT at 20260716090000:143 ("the original SELECT INTO
-- STRICT ..."), which plpgsql stores in prosrc verbatim. MEASURED on the live
-- projects 2026-08-26 by the phase-163 re-audit: the PROD 7-param body contains
-- ONE raw occurrence, comment-stripped ZERO; the TEST 7-param body contains
-- none even before stripping.
-- The consequence is asymmetric and must not be mistaken for redundancy:
--   * On PROD the strip is the SOLE reason arm (c)'s 7-param check passes.
--     Regress the strip — or narrow it to the line syntax only, or let a string
--     literal truncate it — and arm (c) matches that comment and RAISEs, which
--     ABORTS THE PROD DEPLOY of whatever migration is being applied.
--   * On TEST there is nothing to strip in that body, so removing the strip
--     changes no result the recurring gate reports. CI would stay GREEN.
-- A change to the strip is therefore INVISIBLE to CI and FATAL at deploy time.
-- Do not "simplify" it on the evidence of a green CI run.
-- --------------------------------------------------------------------------
-- ⚠️ SCHEMA-QUALIFIED DELIBERATELY, unlike 20260716090000:181 and every other
-- ancestor. Every other statement in this file names public. explicitly; this
-- one did not, and it is the single statement where that matters. An unqualified
-- CREATE OR REPLACE resolves against the SESSION search_path, so if a migration
-- ever runs with a search_path that does not put public first, it does not
-- "replace" — it CREATES a second function in another schema, leaving the real
-- one un-fixed. And a create, unlike a replace, arrives with default privileges:
-- on a Supabase project that is where the default-grant event trigger recorded
-- in 20260515130001 hands EXECUTE to anon and authenticated, on a function that
-- is SECURITY DEFINER and performs no ownership check.
CREATE OR REPLACE FUNCTION public._enqueue_compute_job_internal(
  p_strategy_id     UUID,
  p_portfolio_id    UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT,
  p_parent_job_ids  UUID[],
  p_exchange        TEXT,
  p_metadata        JSONB,
  p_allocator_id    UUID DEFAULT NULL,
  p_api_key_id      UUID DEFAULT NULL,
  p_run_at          TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing_id UUID;
  v_new_id UUID;
  v_target_count INT;
BEGIN
  -- 4-way XOR guard (CHECK mirrors this; the function raises earlier with a
  -- clearer error message — defense in depth).
  v_target_count :=
    (CASE WHEN p_strategy_id  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_portfolio_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_allocator_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_api_key_id   IS NOT NULL THEN 1 ELSE 0 END);
  IF v_target_count <> 1 THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: exactly one of p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id must be non-null (got strategy=%, portfolio=%, allocator=%, api_key=%)',
      p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_kind IS NULL THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: p_kind is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Phase 106 D3: the compute_analytics kind is retired. The registry + CHECKs
  -- still admit it (45 historical rows FK-reference it); this is an RPC-level
  -- admission reject only — no enqueue path remains.
  IF p_kind = 'compute_analytics' THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: kind compute_analytics is retired (Phase 106) — no enqueue path remains'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Optimistic look-up per target type.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE portfolio_id = p_portfolio_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_allocator_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE allocator_id = p_allocator_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE api_key_id = p_api_key_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- Race-safe INSERT — the partial unique index is the final arbiter.
  INSERT INTO compute_jobs (
    strategy_id, portfolio_id, allocator_id, api_key_id,
    kind, parent_job_ids, idempotency_key, exchange, metadata,
    next_attempt_at
  )
  VALUES (
    p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id,
    p_kind, COALESCE(p_parent_job_ids, '{}'::uuid[]), p_idempotency_key,
    p_exchange, p_metadata,
    COALESCE(p_run_at, now())
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN v_new_id;
  END IF;

  -- Lost the race — re-read the winner's row. Plain SELECT INTO, because
  -- between the conflict and the re-read the winner may have advanced past
  -- the in-flight statuses (done / failed_*). That is a legitimate race
  -- outcome, but the strict re-read this replaced raised NO_DATA_FOUND with
  -- no domain-specific message and surfaced as an opaque 500 to the
  -- user-facing request. (Phase 163 OPS-08; the 7-param overload got the same
  -- treatment as mig 109 P3 — this is parity, not a new policy.)
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE portfolio_id = p_portfolio_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_allocator_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE allocator_id = p_allocator_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSE
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE api_key_id = p_api_key_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  END IF;

  IF v_new_id IS NULL THEN
    -- Winner already advanced past in-flight. Classify the outcome: ERRCODE
    -- serialization_failure (40001) is the canonical Postgres class for "MVCC
    -- race, retry safe", and the SQLSTATE is the WHOLE signal. A caller that
    -- wants to retry branches on the code, never on this string.
    --
    -- ⛔ THIS MESSAGE IS OPERATOR TEXT AND IT STILL REACHES A USER-VISIBLE
    -- COLUMN. An earlier version of this note said the remedy was to keep the
    -- message SHORT. That is the WRONG PROPERTY and the phase-163 review
    -- (WR-07) was right to say so: the property that matters is NOT OPERATOR
    -- JARGON, and shortness does not deliver it.
    --
    -- The path, re-measured at HEAD 2026-08-26 (the old note's :2012 was
    -- stale):
    --   src/app/api/strategies/csv-finalize/route.ts:2035 builds
    --     `compute job enqueue failed: ${enqueueErrMessage}`
    --   then writeFailedStrategyAnalyticsPlaceholder (:1868) writes it to
    --   strategy_analytics.computation_error (:1928), which renders VERBATIM
    --   to the strategy's OWNER in the wizard failure envelope.
    --
    -- ⚠️ AND THAT PREFIX IS BUILT ON THE TS SIDE, UNCONDITIONALLY, with no
    -- SQLSTATE branch in front of it. So NO message this function can raise
    -- keeps operator jargon out of that column: the user reads "compute job
    -- enqueue failed: ..." whatever follows the colon. SQL can choose WHICH
    -- jargon appears; it cannot remove jargon. Rewording this string into
    -- curated user copy would be cosmetic, and it would additionally push user
    -- copy into the operator log line for the allocator / portfolio / api_key
    -- callers, which are not user-facing at all. The fix is a TS change, and
    -- it is recorded as owed work in this file's header ("⛔ OWED: WR-07").
    -- Until that lands, this string stays operator-shaped and HONEST rather
    -- than dressed up as user copy it cannot become.
    --
    -- What the old note got RIGHT, and what therefore stays: naming the
    -- internal SECDEF function and the four internal UUIDs here would make the
    -- leak strictly worse, and nothing diagnostic is lost by omitting them —
    -- the caller already knows which target it asked for, and the server log's
    -- CONTEXT line still names this function for operators.
    RAISE EXCEPTION 'enqueue race lost: the winning job already advanced past the in-flight statuses'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN v_new_id;
END;
$$;

-- --------------------------------------------------------------------------
-- ⛔ RE-CONVERGE THE ACL. Do NOT delete this as redundant-because-CREATE-OR-
-- REPLACE-preserves-grants. It is preserved by the REPLACE itself, but that is
-- not the only actor: 20260515130001 (mig 118) records, from a real project,
-- that Supabase carries a default `GRANT EXECUTE ... TO anon, authenticated`
-- EVENT TRIGGER which fired on mig 109's CREATE and left the 7-param overload
-- EXECUTE-grantable to anon and authenticated on the test project — an ACL
-- hardening gap on a SECURITY DEFINER queue-internals function. Every
-- CREATE OR REPLACE of these overloads is therefore an opportunity for that
-- trigger to re-open the grant, and this migration is one.
--
-- Asserting the end state (DO block arm (e) below) would only turn that into a
-- FAILED PROD DEPLOY on merge — loud, but it blocks the OPS-08 fix on an
-- unrelated condition and leaves the security gap open either way. Converging
-- first and asserting second gives both: the grant is correct whether or not
-- the trigger fired, and the assertion still fails the deploy if something
-- ELSE re-opens it afterwards.
--
-- Idempotent, and byte-identical to mig 118's statements for the 10-param
-- signature: REVOKE always converges on "no PUBLIC/anon/authenticated EXECUTE";
-- the GRANT is additive and redundant when service_role already holds it.
-- --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) TO service_role;

-- --------------------------------------------------------------------------
-- COMMENT refresh for the 10-param overload. 20260515130001 (mig 118) gave the
-- 7-param overload a comment that DOCUMENTS its plain re-read + retry code; the
-- 10-param's comment predates that fix and said nothing about the race-loser
-- path. Bring it to parity so the catalog description does not contradict the
-- body. Idempotent: COMMENT overwrites.
--
-- ⛔ THIS COMMENT IS LOAD-BEARING NOW — DO NOT DROP THE PHRASE "Phase 163
-- OPS-08" FROM IT. It is no longer only documentation. Comments are not part of
-- pg_get_functiondef output, so this text cannot interact with the STATEMENT-
-- FORM gate token (that much of the old note here was true, and still is) — but
-- supabase/tests/test_enqueue_internal_destrict.sql reads it separately, via
-- obj_description(oid, 'pg_proc'), as its REVERT DISCRIMINATOR (phase-163
-- review, WR-04).
--
-- The reason it can serve that purpose: a database that never received this
-- migration and one that received it and then lost it to a CREATE OR REPLACE
-- re-based on 20260716090000 have a BYTE-IDENTICAL body. The comment is the
-- only thing that differs, because 20260716090000 issues no COMMENT ON FUNCTION
-- at all and CREATE OR REPLACE does not clear one. Strip the phrase from the
-- literal below and that gate silently falls back to answering SKIP — exit 0 —
-- on a genuine regression, which is precisely the hole WR-04 closed. The DO
-- block at the end of this file now RAISEs if this literal stops carrying the
-- phrase, so the failure direction for THAT mistake is a loud aborted deploy
-- rather than a quietly disarmed gate.
--
-- ⛔ TWO WAYS TO DESTROY THIS MARKER, AND ONLY THE FIRST IS GUARDED.
--   1. Rewriting this COMMENT without the phrase. A future migration that does
--      so MUST carry the phrase forward (or supersede the gate's marker in the
--      same change, deliberately, and say so).
--   2. `DROP FUNCTION` + re-create. A DROP destroys the catalog comment
--      outright, and NOTHING in either file can notice: the re-created function
--      has no comment, so the recurring gate falls back to SKIP. This is not
--      hypothetical for this family — it has been DROPped twice already
--      (20260418194206:168, 20260420073003:327) — and a DROP is the FORCED
--      idiom for a parameter rename or a return-type change, neither of which
--      CREATE OR REPLACE permits. FAIL DIRECTION: OPEN. If you must DROP this
--      overload, re-issue this COMMENT in the same migration.
-- --------------------------------------------------------------------------
COMMENT ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) IS
  'Private shared implementation of the idempotent enqueue pattern. Handles all '
  'four target scopes (strategy / portfolio / allocator / api_key) via 4-way XOR '
  'on the four id parameters. Extended in migration 066 for api_key scope + '
  'scheduled run_at. ACL re-asserted by migration 118. Rejects the retired '
  'compute_analytics kind with invalid_parameter_value (Phase 106 D3). '
  'Race-loser re-read uses a plain SELECT INTO on all four arms; if the winner '
  'already advanced past the in-flight statuses, raises serialization_failure so '
  'the caller can retry vs. surfacing a 500 (Phase 163 OPS-08, parity with the '
  '7-param overload''s mig 109 P3 fix).';

-- --------------------------------------------------------------------------
-- Self-verifying DO block (mirrors 20260716090000:318-345, extended). Fails the
-- DEPLOY — on TEST and on PROD alike — if:
--   (a) either overload lost the Phase 106 retired-kind reject;
--   (b) either overload lost SECURITY DEFINER or SET search_path;
--   (c) the 10-param body still carries a strict re-read (the OPS-08 fix);
--  (c2) the 10-param body does NOT carry exactly four plain lost-race re-reads
--       — (c) is equally satisfied by DELETING the arms, which would return
--       NULL on every lost race (a silent failure, strictly worse than the
--       500 being removed);
--   (d) the 10-param body lost the serialization_failure raise (the other half
--       of the fix — without it a lost race would return NULL silently, which
--       is a WORSE failure than the 500 this migration removes);
--   (e) the 10-param ACL drifted open on a SECURITY DEFINER function;
--   (f) compute_jobs_kind_check stopped admitting 'compute_analytics'
--       (regression guard against a "helpful" registry/CHECK drop — 45
--       historical rows FK-reference it);
--   (g) either overload's pinned search_path stopped being the exact VALUE it
--       declares. The older arm matched the TOKEN 'search_path' anywhere in the
--       definition, which passes on `SET search_path = ''` and on any other
--       hijackable value — it proved the words were there, not that the pin
--       was safe;
--   (h) the catalog COMMENT written ~150 lines above stopped carrying the
--       phrase the recurring gate uses as its revert discriminator. Without
--       this arm, dropping that phrase disarms the recurring gate SILENTLY —
--       the note above COMMENT ON FUNCTION says so, and then guarded nothing.
-- Every RAISE format string is a SINGLE literal.
--
-- ⚠️ WHAT THESE ARMS ACTUALLY PROVE — stated so the strength is not overstated.
-- For the 10-PARAM overload, arms (a)-(d) read back a body this same file
-- CREATE OR REPLACE'd ~150 lines above, inside the SAME implicit transaction.
-- They are a COPY-CHECK — "the text I just wrote is the text I meant to write,
-- and the server stored it" — NOT a runtime check, and NOT evidence that a lost
-- race behaves correctly. They catch a stale re-base, a truncated paste, or a
-- body edited in this file without its assertion updated; they cannot catch a
-- logic error that was faithfully transcribed. The arms carrying INDEPENDENT
-- information are the 7-param ones (a different function, untouched here — a
-- genuine drift detector), (e) the ACL (server state this file only nudges
-- toward the intended end state), (f) the CHECK constraint (a different object
-- entirely), and the 7-param half of (g) (pg_proc.proconfig on a function this
-- file does not write). (h) is a copy-check like (a)-(d) — it reads back the
-- COMMENT this file issues — and its own note says so rather than implying
-- otherwise.
--
-- ⛔ AND NOTHING ELSE EVER RE-READS THE POST-FIX 10-PARAM BODY. An earlier
-- version of this note ended "the recurring gate in supabase/tests/ is where the
-- 10-param body is read on a run that did not just write it." That is FALSE in
-- the deployed topology, and it is the sentence a reader uses to decide the
-- copy-check is acceptable, so it must not overstate. MEASURED AT HEAD:
--   * supabase/tests/ runs in the `sql-tests` CI job, which connects to
--     `secrets.TEST_SUPABASE_DB_URL` (.github/workflows/ci.yml:1105) — the
--     shared TEST project, and only that project.
--   * NOTHING applies migrations to TEST. .github/workflows/supabase-migrate.yml
--     is the only workflow that runs `supabase db push`, and it links
--     `vars.SUPABASE_PROJECT_REF` (:184, :243), which is PRODUCTION.
--   * TEST therefore still runs 20260716090000's 10-param body, so the recurring
--     gate's Part 1+3 lands on its pre-apply SKIP arm on every automated run and
--     Part 3 is permanently WITHHELD there.
-- What the recurring gate DOES contribute on every run is real but is about
-- OTHER things: the 7-param parity pin, the 10-param ARM COUNT (form-agnostic,
-- live in both states), the retired-kind / SECDEF / search_path properties on
-- both bodies, the ACL, and the revert discriminator. The post-fix 10-param body
-- itself is read exactly once, here, inside the transaction that wrote it —
-- unless a human hand-applies this migration to TEST, which is what the SKIP
-- arm's message asks for. Treat that as a real gap, not a formality.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_fn7          text;   -- raw pg_get_functiondef (header + body + comments)
  v_fn10         text;
  v_body7        text;   -- ...with BOTH comment syntaxes stripped. MATCH ON THESE.
  v_body10       text;
  v_check_clause text;
  v_n            int;
  v_cfg7         text[];  -- pg_proc.proconfig — the VALUE of the pin, arm (g)
  v_cfg10        text[];
  v_comment10    text;    -- the CATALOG comment, NOT part of pg_get_functiondef
  v_oid7         oid := to_regprocedure(
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb)'
  );
  v_oid10        oid := to_regprocedure(
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)'
  );
  -- ⚠️ Whitespace-tolerant STATEMENT-form patterns, spelled as regexes rather
  -- than as literal substrings for THREE reasons, all load-bearing:
  --   1. Robustness — plpgsql does not normalise whitespace when it stores a
  --      body, so a re-read reformatted across a line break would evade a
  --      contiguous-substring search while remaining exactly the defect.
  --   2. Property, NOT CONVENTION. c_strict_re carried a trailing `v_`
  --      variable-prefix until the phase-163 review caught it. That pinned this
  --      codebase's NAMING HABIT rather than the dangerous construct: a re-base
  --      writing the strict form into `winner_id`, or into a record variable,
  --      is byte-for-byte the defect OPS-08 exists to prevent and would have
  --      passed GREEN. The property is the keyword pair alone. `\M`
  --      (end-of-word) is present only so an identifier beginning STRICT... —
  --      `STRICTLY_ORDERED`, say — cannot match; it admits every variable name.
  --   3. Self-exclusion — written this way, no line of this file contains a
  --      contiguous occurrence of the construct c_strict_re hunts for (verified
  --      at HEAD; the prose above says "strict form", never the two keywords in
  --      sequence), so a repo-level scan of the migration cannot be satisfied
  --      by the assertion that polices it. If you reword these comments, keep
  --      that true.
  --      ⛔ AND DO NOT MISREAD REASON 3 AS COVERING THE ARMS. It is a property
  --      of THIS FILE'S TEXT, and the arms do not read this file's text — they
  --      read pg_get_functiondef output from the catalog. For the 10-param body
  --      the two coincide, because this file writes it. For the 7-PARAM body
  --      they do not: that body is 20260716090000's, this file does not author
  --      it, and it CARRIES the construct in a line comment at
  --      20260716090000:143 which plpgsql stores in prosrc verbatim. MEASURED
  --      on PROD 2026-08-26: one raw occurrence, comment-stripped zero. So for
  --      the 7-param overload the comment strip is not "braces" behind a
  --      convention "belt" — it is the ONLY layer, and arm (c) below RAISEs and
  --      ABORTS THIS DEPLOY the moment that strip stops working. See the ⛔
  --      note on layers 1 and 2 near the top of this file.
  c_strict_re    CONSTANT text := 'INTO[[:space:]]+STRICT\M';
  c_plain_re     CONSTANT text := 'SELECT[[:space:]]+id[[:space:]]+INTO[[:space:]]+v_new_id';
  c_serfail_re   CONSTANT text :=
    'USING[[:space:]]+ERRCODE[[:space:]]*=[[:space:]]*''serialization_failure''';
  -- The retired-kind ADMISSION BRANCH, not its message. See arm (a).
  c_retired_re   CONSTANT text := 'p_kind[[:space:]]*=[[:space:]]*''compute_analytics''';
  -- Arm (g): the EXACT pinned search_path VALUE, as Postgres stores it in
  -- pg_proc.proconfig. Derived from the DECLARATIONS being policed — this
  -- file's own `SET search_path = public, pg_catalog` above, and its two
  -- ancestors at 20260716090000:61 (7-param) and :196 (10-param) — not from
  -- reading a catalog back. The exact stored spelling is this project's
  -- established idiom for this exact declaration: 20260516170000:212 asserts
  -- `'search_path=public, pg_catalog' = ANY(p.proconfig)` and is applied, so
  -- the literal has already survived a real deploy.
  c_search_path  CONSTANT text := 'search_path=public, pg_catalog';
  -- Arm (h): the revert-discriminator phrase. ⚠️ THE DIRECTION HERE IS THE
  -- OPPOSITE OF THE USUAL GATE-TOKEN RULE, on purpose. A token chosen by reading
  -- the file it polices proves nothing — but this arm does not police this
  -- file's COMMENT for its own sake. It polices whether this file still
  -- satisfies its CONSUMER, and the consumer holds the authoritative copy:
  -- supabase/tests/test_enqueue_internal_destrict.sql declares
  -- `c_applied_marker CONSTANT text := 'Phase 163 OPS-08'` and reads it via
  -- obj_description. This constant is that string, copied FROM the gate. If the
  -- two ever disagree, the recurring gate goes silently back to SKIP; this arm
  -- turns that into an aborted deploy instead.
  c_applied_marker CONSTANT text := 'Phase 163 OPS-08';
  -- The 10-param signature text, for the canonical PUBLIC-EXECUTE probe in (e).
  c_sig10        CONSTANT text :=
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)';
BEGIN
  -- Both overloads must resolve.
  IF v_oid7 IS NULL THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: 7-param _enqueue_compute_job_internal overload not found';
  END IF;
  IF v_oid10 IS NULL THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: 10-param _enqueue_compute_job_internal overload not found';
  END IF;

  v_fn7  := pg_get_functiondef(v_oid7);
  v_fn10 := pg_get_functiondef(v_oid10);

  -- T-163-16: strip comments so every arm below reads STATEMENTS, not the
  -- function's prose about itself. MEASURED on a scratch Postgres 16 while this
  -- migration was being written: a body whose raise had been changed to
  -- `no_data_found`, carrying one comment line quoting the old ERRCODE clause,
  -- passed the presence arms GREEN. Convention alone ("do not spell the token in
  -- a comment") does not survive the next editor; this does.
  --
  -- BOTH plpgsql comment syntaxes are stripped, block first. plpgsql stores
  -- prosrc VERBATIM, so a BLOCK comment survives pg_get_functiondef exactly as a
  -- line comment does — stripping only the line form left the identical hole
  -- open in the other syntax, and the phase-163 review demonstrated it: a body
  -- raising `no_data_found` while carrying the serialization_failure ERRCODE
  -- clause inside a slash-star comment passed arm (d) GREEN. `.*?` is
  -- non-greedy so two block comments are not merged into one span that eats the
  -- statements between them; the 's' flag lets a span cross newlines; the 'n'
  -- flag on the line pass is what stops `.` there from eating the rest of the
  -- definition.
  --
  -- ⚠️ THE FAILURE DIRECTION IS NOT UNIFORM ACROSS THE ARMS BELOW, and the
  -- difference is the whole reason this is spelled out. A string literal that
  -- contained a comment-opening sequence would have its tail truncated before
  -- matching. For a PRESENCE arm — (a), (d), and the SECDEF / search_path arms,
  -- where FINDING the needle is the pass condition — truncation can only cause
  -- a FALSE FAILURE: fail-closed, and a failed deploy is loud. For an ABSENCE
  -- arm — (c), where finding NOTHING is the pass condition — truncation is a
  -- FALSE PASS, which is not tolerable. Verified at HEAD: no literal in either
  -- body contains either sequence (every em-dash in these messages is U+2014,
  -- not two hyphens). Keep it that way, and keep (c) in mind if you add one.
  v_body7  := regexp_replace(regexp_replace(v_fn7,  '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  v_body10 := regexp_replace(regexp_replace(v_fn10, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- ⛔ NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW. `NULL !~ 'x'` evaluates to
  -- NULL, and `IF NULL THEN` does not fire — so a NULL body would sail past (b),
  -- (c) and (d) and this block would RAISE NOTICE compliance on a definition it
  -- never read. pg_get_functiondef on a live oid does not return NULL today;
  -- this costs two comparisons and removes the possibility that a future change
  -- to how these are fetched silently turns the whole block into a no-op.
  IF v_body7 IS NULL OR v_body10 IS NULL THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: a comment-stripped function body came back NULL, so every regex arm below would pass without reading anything. Refusing to report compliance on an unread body.';
  END IF;

  -- (a) both bodies keep the Phase 106 retired-kind reject.
  -- ⚠️ PIN THE BRANCH, NOT THE MESSAGE. This arm matched the RAISE's message
  -- text ('compute_analytics is retired') until the phase-163 review. That is a
  -- STRING LITERAL — immune to the comment strip above by construction — and it
  -- fails in BOTH directions: delete the guard branch while any literal or
  -- prose elsewhere in the body still carries the phrase and the arm passes,
  -- while REWORDING the message with the guard perfectly intact FAILS THE PROD
  -- DEPLOY. `p_kind = 'compute_analytics'` is the admission test itself; both
  -- overloads spell it that way (20260716090000:83 and :224).
  IF v_body7 !~ c_retired_re THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: 7-param overload is missing the retired-kind admission branch (p_kind = compute_analytics)';
  END IF;
  IF v_body10 !~ c_retired_re THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: 10-param overload is missing the retired-kind admission branch (p_kind = compute_analytics) — this migration must not regress Phase 106 D3';
  END IF;

  -- (b) both keep the invalid_parameter_value reject code + SECDEF/search_path.
  IF v_body7 !~* 'invalid_parameter_value' OR v_body10 !~* 'invalid_parameter_value' THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: an overload lost the invalid_parameter_value ERRCODE';
  END IF;
  IF v_body7 !~* 'SECURITY DEFINER' OR v_body10 !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: an overload lost SECURITY DEFINER';
  END IF;
  IF v_body7 !~* 'search_path' OR v_body10 !~* 'search_path' THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: an overload lost SET search_path';
  END IF;

  -- (g) ...AND THE PIN IS THE VALUE, NOT THE WORD. The arm above matches the
  -- TOKEN `search_path` anywhere in the definition text. That is a presence
  -- check on a NAME: it passes on `SET search_path = ''`, on `SET search_path =
  -- public, pg_temp, evil`, and on a body that merely mentions search_path in a
  -- string literal. None of those is a safe pin, and the empty one is the
  -- classic hijack — an unqualified reference inside a SECURITY DEFINER body
  -- then resolves against the CALLER's path. Read the VALUE from the catalog
  -- instead, which is also where a GUC set by any other route would show up.
  -- The token arm above is kept as a cheap pre-check that names the simpler
  -- failure ("lost SET search_path") before this one names the subtler one.
  SELECT p.proconfig INTO v_cfg7  FROM pg_proc p WHERE p.oid = v_oid7;
  SELECT p.proconfig INTO v_cfg10 FROM pg_proc p WHERE p.oid = v_oid10;
  IF v_cfg7 IS NULL OR NOT (c_search_path = ANY(v_cfg7)) THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: the 7-param overload does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty, or reordered is search-path-hijackable — the word being present in the definition text is not the property.', v_cfg7;
  END IF;
  IF v_cfg10 IS NULL OR NOT (c_search_path = ANY(v_cfg10)) THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: the 10-param overload does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty, or reordered is search-path-hijackable — the word being present in the definition text is not the property.', v_cfg10;
  END IF;

  -- (c) THE OPS-08 PROPERTY: no strict re-read survives in EITHER overload.
  -- The 7-param arm is a parity pin, not redundancy: it is already clean
  -- (measured 0 pre-edit), so this arm fails only if some future re-base
  -- reintroduces the defect there — which is exactly how the 10-param one
  -- outlived the 7-param fix by four months.
  IF v_body10 ~ c_strict_re THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: the 10-param body still carries a strict lost-race re-read — a lost race whose winner advanced past the in-flight statuses would raise NO_DATA_FOUND and surface as an opaque 500';
  END IF;
  IF v_body7 ~ c_strict_re THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: the 7-param body reacquired a strict lost-race re-read (mig 109 P3 regressed)';
  END IF;

  -- (c2) ...AND IT GOT THERE BY DE-STRICTING, NOT BY DELETING ARMS. This is the
  -- PROD-side counterpart of the recurring gate's Part 2, and it was missing:
  -- arm (c) alone is satisfied by removing the lost-race section outright, so a
  -- re-base that dropped the whole section while keeping the RAISE passed this
  -- file's own self-verification. Four arms, one per target scope in the 4-way
  -- XOR (strategy / portfolio / allocator / api_key).
  SELECT count(*) INTO v_n
    FROM regexp_matches(v_body10, c_plain_re, 'g');
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: the 10-param body carries % plain lost-race re-read(s), expected exactly 4 (one per target scope). Absence of the strict form is ALSO achieved by deleting the arms, which returns NULL on every lost race — a silent failure, worse than the 500 this migration removes.', v_n;
  END IF;

  -- (d) and the classified raise is PRESENT in both — the other half of the
  -- fix. Without it a lost race returns NULL to the caller silently, which is
  -- a worse failure than the 500 being removed.
  IF v_body10 !~ c_serfail_re THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: the 10-param body has no serialization_failure raise — a lost race whose winner already advanced would return NULL silently instead of a retry-safe classified error';
  END IF;
  IF v_body7 !~ c_serfail_re THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: the 7-param body lost its serialization_failure raise (mig 109 P3 regressed)';
  END IF;

  -- (e) ACL: verify the REVOKE/GRANT above actually converged. Expected end
  -- state is mig 118's: no PUBLIC / anon / authenticated EXECUTE on this
  -- SECURITY DEFINER queue-internals function; service_role holds it.
  -- The role-existence check first is not ceremony: has_function_privilege on
  -- an absent role raises `role "anon" does not exist`, which on a failed PROD
  -- deploy reads as a mystery. These three roles are Supabase-standard and
  -- their absence means this is not a Supabase database — say THAT.
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: one of the roles anon / authenticated / service_role does not exist on this database, so the ACL arm cannot be evaluated. These are Supabase-standard roles; their absence means this migration is running somewhere it was not written for.';
  END IF;
  -- ⚠️ THE PUBLIC PROBE RUNS FIRST, AND IT IS ABOUT ATTRIBUTION, NOT DETECTION.
  -- The named-role checks below already DETECT a PUBLIC leak — anon and
  -- authenticated are real roles, and has_function_privilege accounts for
  -- privileges they hold via PUBLIC. What they get WRONG is the diagnosis: they
  -- would report "anon or authenticated holds EXECUTE ... migration 118 revoked
  -- it", sending the operator to `REVOKE ... FROM anon, authenticated`, which
  -- does not remove a grant held by PUBLIC. The operator revokes, re-runs, and
  -- sees the same failure. public._assert_no_public_execute (installed by
  -- 20260515205431) reads pg_proc.proacl through aclexplode and matches
  -- grantee = 0 specifically, so a PUBLIC grant is named as a PUBLIC grant.
  -- It RAISEs on leak with ERRCODE insufficient_privilege; running it first
  -- means the more specific message wins. Its absence would abort this deploy
  -- with undefined_function — loud and fail-closed, which is the right
  -- direction, and it cannot be absent on a database that has 20260716090000.
  PERFORM public._assert_no_public_execute(c_sig10);

  IF has_function_privilege('anon', v_oid10, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid10, 'EXECUTE') THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: anon or authenticated holds EXECUTE on the 10-param SECURITY DEFINER overload — ACL drifted open (migration 118 revoked it). The PUBLIC probe above already passed, so this is a grant held by the named role directly, not one inherited from PUBLIC.';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid10, 'EXECUTE') THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: service_role lost EXECUTE on the 10-param overload — every sanctioned enqueue path would break';
  END IF;

  -- (f) regression guard: the kind CHECK MUST STILL admit compute_analytics
  -- (45 historical prod rows FK-reference it — no CHECK/registry drop).
  SELECT pg_get_constraintdef(oid) INTO v_check_clause
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass
     AND conname = 'compute_jobs_kind_check';
  IF v_check_clause IS NULL OR position('compute_analytics' IN v_check_clause) = 0 THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: compute_jobs_kind_check no longer admits compute_analytics (registry/CHECK must STAY — 45 historical rows FK-reference it)';
  END IF;

  -- (h) THE REVERT DISCRIMINATOR THE RECURRING GATE RESTS ON IS ACTUALLY THERE.
  -- The note above COMMENT ON FUNCTION states that stripping the phrase makes
  -- supabase/tests/test_enqueue_internal_destrict.sql "silently fall back to
  -- answering SKIP — exit 0 — on a genuine regression", and then guarded
  -- nothing: an editor who reworded that literal broke the recurring gate with
  -- no signal anywhere. A prose warning is not a mechanism. This arm is.
  --
  -- Scope, so the strength is not overstated: like (a)-(d) this is a COPY-CHECK
  -- of something this same file wrote ~150 lines above, in the same implicit
  -- transaction. It cannot detect a LATER migration that rewrites or DROPs the
  -- comment — see the two-ways-to-destroy note above COMMENT ON FUNCTION, where
  -- the second way is unguarded and fails OPEN. What it does close is the
  -- mistake that is actually likely: editing the COMMENT literal in THIS file
  -- while the gate's marker stays as it is.
  --
  -- coalesce because obj_description returns NULL for an uncommented function,
  -- and `strpos(NULL, x) = 0` is NULL, not TRUE — the IF would not fire and this
  -- arm would pass on a function carrying no comment at all. Here the coalesce
  -- is load-bearing in the fail-closed direction, unlike the decorative one it
  -- resembles.
  v_comment10 := coalesce(obj_description(v_oid10, 'pg_proc'), '');
  IF strpos(v_comment10, c_applied_marker) = 0 THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: the 10-param catalog COMMENT this migration just wrote does not contain the revert-discriminator phrase that supabase/tests/test_enqueue_internal_destrict.sql greps for. That gate uses this phrase to tell "never applied" from "applied then reverted by a stale re-base" — two states with a BYTE-IDENTICAL body. Without it the gate answers SKIP and exits 0 on a real regression. Restore the phrase in the COMMENT ON FUNCTION literal above, or supersede the gate marker in the same change. Comment read back: %', v_comment10;
  END IF;

  RAISE NOTICE 'OPS-08: both _enqueue_compute_job_internal overloads re-read the lost race without the strict form and raise serialization_failure; retired-kind reject, SECDEF, the exact search_path pin, the ACL (PUBLIC + named roles), the revert-discriminator comment and the historical kind CHECK all intact.';
END
$$;
