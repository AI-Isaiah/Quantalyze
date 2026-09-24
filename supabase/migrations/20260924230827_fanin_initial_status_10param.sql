-- ==========================================================================
-- Phase 164.9.1 (JOBRPCTRUTH), [164.9-FANIN-STATUS-NEVER-SET]: the TEN-arg
-- `public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text,
-- jsonb, uuid, uuid, timestamptz)` computes the initial status and INSERTs it.
--
-- THE DEFECT. `public.enqueue_compute_job` routes every one of its modes to the
-- TEN-arg overload, and that overload's INSERT omitted `status`, so every row
-- took the column DEFAULT ('pending'). Mig 109 P12's intent — a row enqueued
-- WITH parents starts as 'done_pending_children', so the fan-in advance in
-- `mark_compute_job_done` holds it until a parent completes — lived ONLY in the
-- SEVEN-arg overload, which nothing reaches (see D-27 below). MEASURED on the
-- local lane before this file existed (Phase 164.9.1 plan 01, arm P12-harm of
-- src/__tests__/compute-jobs-audit-2026-05-07-g10b.test.ts):
--   HARM-PROBE verdict: child_status_at_enqueue=pending
--     claimed_while_parent_running=true parent_mark_done_ok=true
--     child_status_after_parent_done=running
-- i.e. a parented child was handed to a worker while its parent was still
-- running, and the parent's mark-done never engaged the fan-in for it.
-- ⚠️ PRODUCTION HARM IS LATENT: `grep -rn parent_job_ids analytics-service
-- --include='*.py'` (excluding .venv) returns 0, and every SQL call site in the
-- PROD dump passes no parents or '{}' (D-02). This fixes a mechanism before a
-- caller can reach it; it repairs no production row, and it writes none.
--
-- THE FIX, AND ONLY THE FIX (D-04). The body below is the ten-arg body of
-- 20260826150000_destrict_enqueue_internal_10param.sql, VERBATIM, with exactly
-- THREE edits, all about the initial status:
--   (1) DECLARE gains `v_initial_status TEXT`;
--   (2) before the optimistic look-up, it is set to 'done_pending_children' when
--       p_parent_job_ids is non-NULL with at least one element, else 'pending' —
--       the SEVEN-arg's predicate from 20260716090000, mirrored exactly;
--   (3) the INSERT names `status` last in its column list and `v_initial_status`
--       last in its VALUES.
-- Everything else is byte-identical to the source body: the signature (DEFAULT
-- NULL on the last three parameters), SECURITY DEFINER, `SET search_path =
-- public, pg_catalog`, the schema-qualified name, the 4-way XOR guard, the
-- p_kind NULL guard, the Phase 106 retired-kind reject (message literal
-- unchanged), the optimistic look-up (strategy arm included, indent and all),
-- `ON CONFLICT DO NOTHING`, the four PLAIN lost-race re-reads into v_new_id and
-- the serialization_failure raise with its operator-shaped message (WR-07).
-- D-10: the idempotent return-the-existing-id contract is UNCHANGED — no new
-- raise, no return-type change, no DROP FUNCTION (a DROP would destroy the
-- catalog COMMENT the recurring gate reads; see the note on COMMENT below).
-- The SEVEN-arg overload is NOT touched by this file.
--
-- RE-BASE DISCIPLINE (D-05), re-measured at execution, 2026-09-24 UTC:
--   grep -n -iE "create (or replace )?function[[:space:]]+(public\.)?_enqueue_compute_job_internal" \
--     supabase/migrations/*.sql
-- returned SEVEN CREATE statements over six files — 20260411144407,
-- 20260418194206, 20260420073003, 20260510180226, 20260716090000 (7-arg and
-- 10-arg) and 20260826150000 (10-arg). The newest ten-arg CREATE by timestamp
-- is 20260826150000's, which is the body re-based here. Every later file that
-- names the function (20260825140000, 20260825150000, 20260907120000,
-- 20260907130000, 20260911130000, 20260917120000, 20260924120000) does so in a
-- comment only. FUTURE EDITORS: re-base on THIS file (or a newer one), and keep
-- the status computation, the retired-kind guard and the plain re-reads.
--
-- ⛔ D-27 — THE SEVEN-ARG OVERLOAD CANNOT BE CALLED, SO NOTHING EXECUTES IT.
-- With the ten-arg carrying DEFAULT NULL on its last three parameters, a
-- SEVEN-argument call matches both overloads and fails to resolve: MEASURED on
-- a throwaway loopback cluster (scripts/pg-lane/run.sh, PostgreSQL 16) with the
-- real parameter types — positional-7 direct, positional-7 via plpgsql and
-- named-7 all raise 42725 "function ... is not unique"; positional-8 and
-- positional-10 resolve to the ten-arg. Consequence:
-- `public.enqueue_compute_portfolio_job`, the seven-arg's ONLY caller, passes
-- seven arguments and therefore RAISES 42725 ON EVERY CALL. It has no caller
-- (its only non-SQL mention is the generated type in src/lib/database.types.ts),
-- so it is broken but latent. It is NOT fixed here. Do not "route" a caller to
-- the seven-arg on the belief that it holds the fan-in logic — this file is
-- where that logic now runs.
--
-- ⚠️ KNOWN LIMIT, PRE-EXISTING IN THE SEVEN-ARG DESIGN AND INHERITED BY PARITY —
-- A STRANDED FAN-IN CHILD. A 'done_pending_children' row is released only by a
-- parent's `mark_compute_job_done`. A child whose parents are ALL already
-- 'done' at enqueue time, or whose parent ends 'failed_final', or whose parent
-- id does not exist, therefore never leaves 'done_pending_children'
-- (`mark_compute_job_failed` does not cascade). While stranded it also holds
-- its (target, kind) in-flight slot, and the optimistic look-up keeps returning
-- it. The optimistic look-up ignores p_parent_job_ids when an in-flight job
-- already exists, exactly as the seven-arg does. Latent for the same reason as
-- the harm: no caller passes parents (D-02). Recorded, not widened.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — the PROD body this CREATE OR REPLACE overwrites
-- ══════════════════════════════════════════════════════════════════════════
-- The gate compares the COMMITTED SNAPSHOT (supabase/schema/functions/) against
-- PROD's live body. On a function-changing migration PR the two necessarily
-- disagree: `snapshot-drift` requires the snapshot to carry the body the
-- MIGRATIONS produce (the new one), while VAC-04 requires it to match what PROD
-- has TODAY (the old one). The pragma means "I read PROD's body and intend to
-- overwrite it".
--
-- MEASURED 2026-09-24 UTC, reproduced LOCALLY with the gate's own normalizer,
-- aiming its `live` argument at origin/main's snapshot rather than at PROD
-- (origin/main = f8a3096e3f984f96e7ff0a442e44d2c46f78f9bd):
--
--   git show origin/main:supabase/schema/functions/_enqueue_compute_job_internal.sql > <scratch>
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/_enqueue_compute_job_internal.sql <scratch>
--
-- ⭐ THE ACKED HASH IS THE `live` COLUMN OF --diff-bodies FOR THE TEN-ARG ROW,
-- NOT `--hash` OF THE SNAPSHOT FILE (a whole-file digest no gate ever greps).
-- The seven-arg row is MATCH and needs no ack.
--
-- prod-body-ack: ef92e4160b7ef27348c5a38ee362242b3ee7c8f879f745d606cb9968e7dceed7
--
-- ⚠️ THE ACK IS OF origin/main, WHICH STANDS IN FOR PROD (assumption A1). It is
-- EARNED only if VAC-04 on the PR reports that SAME hash for PROD. If it reports
-- a different one, PROD drifted OUT OF BAND and the correct action is to FOLD
-- the difference into this migration and re-derive — never to edit the pragma
-- to match a gate log. It is EARNED, not pasted.
-- ⚠️ VAC-08 (repo-vs-TEST body pairing) goes RED on the PR by construction:
-- exactly one `_enqueue_compute_job_internal/10 DRIFT` row, whose TEST hash is
-- the pre-change hash above, until apply-on-merge brings TEST forward.
--
-- GRANTS ARE RE-CONVERGED, NOT ASSUMED (D-06): the ACL pair of 20260826150000
-- is re-issued verbatim below and then asserted, for the same default-grant
-- event-trigger reason recorded in 20260515130001 (mig 118).
--
-- REVERSIBLE: re-run 20260826150000's ten-arg body verbatim. No schema change;
-- this migration replaces one function body, refreshes one COMMENT, and
-- re-issues two grants that were already the intended state.
--
-- Transaction style: NO explicit BEGIN/COMMIT — Supabase wraps each migration
-- in an implicit transaction. SET LOCAL lock_timeout applies to that wrap. This
-- migration writes ZERO table data and validates no existing rows; its DO block
-- reads catalogs only (D-07, [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]).
-- Every RAISE format string below is a SINGLE literal (Phase 85 invariant #21 —
-- no '||' concatenation inside a RAISE format slot).
--
-- Execution proof is NOT this file's DO block (a copy-check, see below). It is
-- arm P12 and arm P12-harm of src/__tests__/compute-jobs-audit-2026-05-07-g10b.test.ts,
-- run against a database with this migration applied.
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- 10-param overload — verbatim from 20260826150000's ten-arg CREATE, with ONLY
-- the three initial-status edits listed in the header.
--
-- ⚠️ GATE-TOKEN HYGIENE (T-163-16), carried forward from 20260826150000.
-- `pg_get_functiondef` returns a body's COMMENTS as well as its statements, so
-- every arm of the DO block below matches a COMMENT-STRIPPED copy, stripping
-- BOTH plpgsql comment syntaxes. The comments inside the body below say "the
-- strict re-read", never the statement form, and name the initial status in
-- prose only. ⛔ For the 7-PARAM overload the strip is the ONLY layer and it is
-- load-bearing on PROD alone: PROD's 7-param body quotes the strict construct
-- in a line comment (20260716090000's lost-race note), so regressing the strip
-- makes arm (c) match that comment and ABORT THE PROD DEPLOY, while on TEST
-- there is nothing to strip and CI stays GREEN. Do not "simplify" the strip on
-- the evidence of a green CI run.
--
-- ⚠️ SCHEMA-QUALIFIED DELIBERATELY, as in 20260826150000. An unqualified
-- CREATE OR REPLACE resolves against the SESSION search_path, so under a
-- search_path that does not put public first it CREATES a second function in
-- another schema — and a create arrives with default privileges, which on a
-- Supabase project is where the default-grant event trigger recorded in
-- 20260515130001 hands EXECUTE to anon and authenticated.
-- --------------------------------------------------------------------------
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
  v_initial_status TEXT;
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

  -- Phase 164.9.1 (mig 109 P12 intent, mirrored from the 7-param overload in
  -- 20260716090000): rows with parents start as done_pending_children so the
  -- fan-in advance in mark_compute_job_done holds them until a parent
  -- completes. Leaf rows (no parents) start as pending.
  IF p_parent_job_ids IS NOT NULL
     AND array_length(p_parent_job_ids, 1) IS NOT NULL
     AND array_length(p_parent_job_ids, 1) > 0 THEN
    v_initial_status := 'done_pending_children';
  ELSE
    v_initial_status := 'pending';
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
    next_attempt_at, status
  )
  VALUES (
    p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id,
    p_kind, COALESCE(p_parent_job_ids, '{}'::uuid[]), p_idempotency_key,
    p_exchange, p_metadata,
    COALESCE(p_run_at, now()), v_initial_status
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
    -- callers, which are not user-facing at all. The fix is a TS change, and it
    -- HAS LANDED (2026-08-26): csv-finalize now branches on SQLSTATE 40001 and
    -- writes curated copy instead of prefixing this sentence. So this string
    -- stays operator-shaped ON PURPOSE and is now correct to do so — the user
    -- no longer reads it, while the allocator / portfolio / api_key callers
    -- still get the precise operator wording they need.
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
-- ⛔ RE-CONVERGE THE ACL (D-06). Do NOT delete this as redundant-because-CREATE-
-- OR-REPLACE-preserves-grants: 20260515130001 (mig 118) records a Supabase
-- default `GRANT EXECUTE ... TO anon, authenticated` EVENT TRIGGER that
-- re-opened EXECUTE on exactly this function family the last time it was
-- CREATE OR REPLACE'd, and every CREATE OR REPLACE is another chance for it to
-- fire. Converge first, assert second (DO block arm (e)). Idempotent, and
-- byte-identical to 20260826150000's statements for the 10-param signature.
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
-- COMMENT refresh for the 10-param overload: 20260826150000's text carried
-- forward VERBATIM, plus one sentence recording the initial status.
--
-- ⛔ THIS COMMENT IS LOAD-BEARING — DO NOT DROP THE PHRASE "Phase 163 OPS-08".
-- supabase/tests/test_enqueue_internal_destrict.sql reads it via
-- obj_description(oid, 'pg_proc') as its REVERT DISCRIMINATOR
-- (`c_applied_marker`): without it that gate answers SKIP and exits 0 on a
-- genuine regression. DO block arm (h) below aborts the deploy if the phrase is
-- missing. A DROP FUNCTION would destroy the comment outright and nothing could
-- notice (see 20260826150000's note on the two ways to destroy this marker).
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
  '7-param overload''s mig 109 P3 fix). '
  'Computes the initial status and INSERTs it explicitly: done_pending_children '
  'when p_parent_job_ids has at least one element, else pending (Phase 164.9.1, '
  'parity with the 7-param overload''s mig 109 P12 branch).';

-- --------------------------------------------------------------------------
-- Self-verifying DO block. Arms (a)-(h) are 20260826150000's, code verbatim,
-- with the RAISE prefix renamed to this migration's tag; read that file for the
-- full rationale behind each (the comment strip, the NULL guard, pinning the
-- retired-kind BRANCH rather than its message, the search_path VALUE, the
-- PUBLIC-first ACL probe). Fails the DEPLOY — on TEST and on PROD alike — if:
--   (a) either overload lost the Phase 106 retired-kind reject;
--   (b) either overload lost the invalid_parameter_value code, SECURITY
--       DEFINER or SET search_path;
--   (c) either body carries a strict lost-race re-read;
--  (c2) the 10-param body does not carry exactly four plain lost-race re-reads;
--   (d) either body lost the serialization_failure raise;
--   (e) the 10-param ACL drifted open, or service_role lost EXECUTE;
--   (f) compute_jobs_kind_check stopped admitting 'compute_analytics';
--   (g) either overload's pinned search_path is not the exact declared value;
--   (h) the 10-param catalog COMMENT lost the revert-discriminator phrase;
-- and, NEW in this migration:
--   (i) the 10-param body does not assign 'done_pending_children' AND 'pending'
--       to v_initial_status;
--   (j) the 10-param body lost the parents-non-empty predicate;
--   (k) the 10-param INSERT does not name `status` in its column list, or does
--       not end its VALUES with v_initial_status;
--   (l) the 7-param body lost its own done_pending_children assignment — a
--       parity pin on a function this file does NOT write, so it carries
--       independent information (D-04: the seven-arg stays byte-unchanged).
-- Every RAISE format string is a SINGLE literal. Reads catalogs only
-- (pg_proc, pg_constraint, pg_get_functiondef, obj_description,
-- has_function_privilege, to_regprocedure, to_regrole) — never table data.
--
-- ⚠️ WHAT (i)-(k) ACTUALLY PROVE — stated so the strength is not overstated.
-- Like (a)-(d) and (h) for the 10-param overload, they read back a body this
-- same file CREATE OR REPLACE'd above, inside the SAME implicit transaction.
-- They are COPY-CHECKS — "the text I just wrote is the text I meant to write,
-- and the server stored it" — NOT a runtime check. They catch a stale re-base,
-- a truncated paste, or a body edited here without its assertion updated; they
-- cannot catch a logic error that was faithfully transcribed. EXECUTION proof
-- that a parented child lands done_pending_children and is held until its
-- parent completes is arm P12 and arm P12-harm of
-- src/__tests__/compute-jobs-audit-2026-05-07-g10b.test.ts.
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
  c_strict_re    CONSTANT text := 'INTO[[:space:]]+STRICT\M';
  c_plain_re     CONSTANT text := 'SELECT[[:space:]]+id[[:space:]]+INTO[[:space:]]+v_new_id';
  c_serfail_re   CONSTANT text :=
    'USING[[:space:]]+ERRCODE[[:space:]]*=[[:space:]]*''serialization_failure''';
  c_retired_re   CONSTANT text := 'p_kind[[:space:]]*=[[:space:]]*''compute_analytics''';
  c_search_path  CONSTANT text := 'search_path=public, pg_catalog';
  -- Copied FROM supabase/tests/test_enqueue_internal_destrict.sql
  -- `c_applied_marker`, the consumer that holds the authoritative copy.
  c_applied_marker CONSTANT text := 'Phase 163 OPS-08';
  c_sig10        CONSTANT text :=
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)';
  -- Arms (i)-(l): whitespace-tolerant STATEMENT-form patterns, matched against
  -- the COMMENT-STRIPPED bodies, so prose about the status cannot satisfy them.
  c_dpc_assign_re     CONSTANT text :=
    'v_initial_status[[:space:]]*:=[[:space:]]*''done_pending_children''';
  c_pending_assign_re CONSTANT text :=
    'v_initial_status[[:space:]]*:=[[:space:]]*''pending''';
  c_parents_re        CONSTANT text :=
    'array_length[[:space:]]*\([[:space:]]*p_parent_job_ids[[:space:]]*,[[:space:]]*1[[:space:]]*\)[[:space:]]*>[[:space:]]*0';
  -- The INSERT column list holds no parenthesis, so [^)]* stays inside it.
  c_insert_cols_re    CONSTANT text :=
    'INSERT[[:space:]]+INTO[[:space:]]+compute_jobs[[:space:]]*\([^)]*\mstatus\M[^)]*\)';
  -- v_initial_status is the LAST VALUES item, immediately before ON CONFLICT.
  c_insert_vals_re    CONSTANT text :=
    'v_initial_status[[:space:]]*\)[[:space:]]*ON[[:space:]]+CONFLICT[[:space:]]+DO[[:space:]]+NOTHING';
BEGIN
  -- Both overloads must resolve.
  IF v_oid7 IS NULL THEN
    RAISE EXCEPTION 'fanin-status-10param: 7-param _enqueue_compute_job_internal overload not found';
  END IF;
  IF v_oid10 IS NULL THEN
    RAISE EXCEPTION 'fanin-status-10param: 10-param _enqueue_compute_job_internal overload not found';
  END IF;

  v_fn7  := pg_get_functiondef(v_oid7);
  v_fn10 := pg_get_functiondef(v_oid10);

  -- Strip BOTH plpgsql comment syntaxes, block first (T-163-16; see
  -- 20260826150000 for why each half of the strip is load-bearing).
  v_body7  := regexp_replace(regexp_replace(v_fn7,  '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  v_body10 := regexp_replace(regexp_replace(v_fn10, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- ⛔ NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW.
  IF v_body7 IS NULL OR v_body10 IS NULL THEN
    RAISE EXCEPTION 'fanin-status-10param: a comment-stripped function body came back NULL, so every regex arm below would pass without reading anything. Refusing to report compliance on an unread body.';
  END IF;

  -- (a) both bodies keep the Phase 106 retired-kind admission BRANCH.
  IF v_body7 !~ c_retired_re THEN
    RAISE EXCEPTION 'fanin-status-10param: 7-param overload is missing the retired-kind admission branch (p_kind = compute_analytics)';
  END IF;
  IF v_body10 !~ c_retired_re THEN
    RAISE EXCEPTION 'fanin-status-10param: 10-param overload is missing the retired-kind admission branch (p_kind = compute_analytics) — this migration must not regress Phase 106 D3';
  END IF;

  -- (b) both keep the invalid_parameter_value reject code + SECDEF/search_path.
  IF v_body7 !~* 'invalid_parameter_value' OR v_body10 !~* 'invalid_parameter_value' THEN
    RAISE EXCEPTION 'fanin-status-10param: an overload lost the invalid_parameter_value ERRCODE';
  END IF;
  IF v_body7 !~* 'SECURITY DEFINER' OR v_body10 !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'fanin-status-10param: an overload lost SECURITY DEFINER';
  END IF;
  IF v_body7 !~* 'search_path' OR v_body10 !~* 'search_path' THEN
    RAISE EXCEPTION 'fanin-status-10param: an overload lost SET search_path';
  END IF;

  -- (g) ...AND THE PIN IS THE VALUE, NOT THE WORD.
  SELECT p.proconfig INTO v_cfg7  FROM pg_proc p WHERE p.oid = v_oid7;
  SELECT p.proconfig INTO v_cfg10 FROM pg_proc p WHERE p.oid = v_oid10;
  IF v_cfg7 IS NULL OR NOT (c_search_path = ANY(v_cfg7)) THEN
    RAISE EXCEPTION 'fanin-status-10param: the 7-param overload does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty, or reordered is search-path-hijackable — the word being present in the definition text is not the property.', v_cfg7;
  END IF;
  IF v_cfg10 IS NULL OR NOT (c_search_path = ANY(v_cfg10)) THEN
    RAISE EXCEPTION 'fanin-status-10param: the 10-param overload does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty, or reordered is search-path-hijackable — the word being present in the definition text is not the property.', v_cfg10;
  END IF;

  -- (c) no strict re-read survives in EITHER overload (the OPS-08 property).
  IF v_body10 ~ c_strict_re THEN
    RAISE EXCEPTION 'fanin-status-10param: the 10-param body carries a strict lost-race re-read — a lost race whose winner advanced past the in-flight statuses would raise NO_DATA_FOUND and surface as an opaque 500 (Phase 163 OPS-08 regressed)';
  END IF;
  IF v_body7 ~ c_strict_re THEN
    RAISE EXCEPTION 'fanin-status-10param: the 7-param body reacquired a strict lost-race re-read (mig 109 P3 regressed)';
  END IF;

  -- (c2) ...and exactly four PLAIN re-reads, one per target scope.
  SELECT count(*) INTO v_n
    FROM regexp_matches(v_body10, c_plain_re, 'g');
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'fanin-status-10param: the 10-param body carries % plain lost-race re-read(s), expected exactly 4 (one per target scope). Absence of the strict form is ALSO achieved by deleting the arms, which returns NULL on every lost race — a silent failure.', v_n;
  END IF;

  -- (d) the classified raise is PRESENT in both.
  IF v_body10 !~ c_serfail_re THEN
    RAISE EXCEPTION 'fanin-status-10param: the 10-param body has no serialization_failure raise — a lost race whose winner already advanced would return NULL silently instead of a retry-safe classified error';
  END IF;
  IF v_body7 !~ c_serfail_re THEN
    RAISE EXCEPTION 'fanin-status-10param: the 7-param body lost its serialization_failure raise (mig 109 P3 regressed)';
  END IF;

  -- (e) ACL: verify the REVOKE/GRANT above actually converged.
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'fanin-status-10param: one of the roles anon / authenticated / service_role does not exist on this database, so the ACL arm cannot be evaluated. These are Supabase-standard roles; their absence means this migration is running somewhere it was not written for.';
  END IF;
  -- The PUBLIC probe runs first so a PUBLIC leak is named as a PUBLIC leak.
  PERFORM public._assert_no_public_execute(c_sig10);

  IF has_function_privilege('anon', v_oid10, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid10, 'EXECUTE') THEN
    RAISE EXCEPTION 'fanin-status-10param: anon or authenticated holds EXECUTE on the 10-param SECURITY DEFINER overload — ACL drifted open (migration 118 revoked it). The PUBLIC probe above already passed, so this is a grant held by the named role directly, not one inherited from PUBLIC.';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid10, 'EXECUTE') THEN
    RAISE EXCEPTION 'fanin-status-10param: service_role lost EXECUTE on the 10-param overload — every sanctioned enqueue path would break';
  END IF;

  -- (f) the kind CHECK MUST STILL admit compute_analytics (catalog read).
  SELECT pg_get_constraintdef(oid) INTO v_check_clause
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass
     AND conname = 'compute_jobs_kind_check';
  IF v_check_clause IS NULL OR position('compute_analytics' IN v_check_clause) = 0 THEN
    RAISE EXCEPTION 'fanin-status-10param: compute_jobs_kind_check no longer admits compute_analytics (registry/CHECK must STAY — historical rows FK-reference it)';
  END IF;

  -- (h) the revert discriminator the recurring gate rests on is there.
  -- coalesce is load-bearing: strpos(NULL, x) = 0 is NULL, not TRUE.
  v_comment10 := coalesce(obj_description(v_oid10, 'pg_proc'), '');
  IF strpos(v_comment10, c_applied_marker) = 0 THEN
    RAISE EXCEPTION 'fanin-status-10param: the 10-param catalog COMMENT this migration just wrote does not contain the revert-discriminator phrase that supabase/tests/test_enqueue_internal_destrict.sql greps for. Without it that gate answers SKIP and exits 0 on a real regression. Restore the phrase in the COMMENT ON FUNCTION literal above. Comment read back: %', v_comment10;
  END IF;

  -- (i) COPY-CHECK: both initial-status assignments are in the 10-param body.
  IF v_body10 !~ c_dpc_assign_re OR v_body10 !~ c_pending_assign_re THEN
    RAISE EXCEPTION 'fanin-status-10param: the 10-param body does not assign both done_pending_children and pending to v_initial_status — a parented job enqueued through enqueue_compute_job would skip the fan-in state again';
  END IF;

  -- (j) COPY-CHECK: the parents-non-empty predicate that selects the fan-in state.
  IF v_body10 !~ c_parents_re THEN
    RAISE EXCEPTION 'fanin-status-10param: the 10-param body lost the parents-non-empty predicate on p_parent_job_ids, so the initial status no longer depends on whether the job has parents';
  END IF;

  -- (k) COPY-CHECK: the INSERT writes the computed status. Without this the
  -- assignment above is dead code and the column DEFAULT (pending) wins, which
  -- is exactly the defect this migration exists to remove.
  IF v_body10 !~ c_insert_cols_re OR v_body10 !~ c_insert_vals_re THEN
    RAISE EXCEPTION 'fanin-status-10param: the 10-param INSERT does not name status in its column list with v_initial_status as its last VALUES item — the computed status would never reach the row and the column DEFAULT would win';
  END IF;

  -- (l) PARITY PIN on the 7-param body, which this file does not write.
  IF v_body7 !~ c_dpc_assign_re THEN
    RAISE EXCEPTION 'fanin-status-10param: the 7-param body lost its done_pending_children assignment (mig 109 P12 regressed) — this migration was written on the premise that the two overloads compute the initial status the same way';
  END IF;

  RAISE NOTICE 'fanin-status-10param: the 10-param _enqueue_compute_job_internal computes and INSERTs the initial status (done_pending_children with parents, else pending), in parity with the 7-param overload; OPS-08 re-reads, retired-kind reject, SECDEF, the exact search_path pin, the ACL (PUBLIC + named roles), the revert-discriminator comment and the historical kind CHECK all intact.';
END
$$;
