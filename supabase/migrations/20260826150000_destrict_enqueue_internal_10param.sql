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
-- THE FIX IS PARITY, NOT INVENTION. The 7-param overload in the SAME source
-- migration (20260716090000:139-176) was fixed this way already (mig 109 P3):
-- a PLAIN re-read, then an explicit `IF v_new_id IS NULL THEN RAISE ... USING
-- ERRCODE = 'serialization_failure'` — the canonical Postgres class for "MVCC
-- race, retry safe", which the app layer can retry instead of 500-ing. This
-- migration replicates exactly that across the 10-param overload's FOUR
-- lost-race arms (strategy / portfolio / allocator / api_key). Measured
-- pre-edit: 4 strict re-reads in the 10-param body, 0 in the 7-param body.
--
-- BEHAVIOUR DELTA, stated narrowly. The ONLY paths whose behaviour changes are
-- the four lost-race re-reads, and only when they find NO row:
--   before → P0002 NO_DATA_FOUND, no message, opaque 500.
--   after  → 40001 serialization_failure with the four target ids + kind named.
-- A re-read that FINDS a row is byte-identical (the strict form's multi-row
-- arm was already unreachable: every arm carries `LIMIT 1`, so TOO_MANY_ROWS
-- could never fire, and the strict form's only live effect was the empty-set
-- raise this migration replaces). No row is written, read, or deleted by this
-- migration; it replaces one function body.
--
-- RE-BASE DISCIPLINE (project rule: re-base SQL fns on the LATEST def — grep
-- ALL migrations for any newer CREATE OR REPLACE of either overload before
-- editing). RE-VERIFIED AT HEAD, 2026-08-26:
--   `grep -rn "_enqueue_compute_job_internal" supabase/migrations/` → 105 hits
--   across 14 files; only SIX are a CREATE OR REPLACE of either overload, and
--   the newest by timestamp is
--   20260716090000_retire_compute_analytics_kind_rpc_guard.sql (7-param at
--   :49, 10-param at :181). Every later reference (20260816140000,
--   20260825130000/140000/150000) is prose in a comment. 20260515130001 is
--   ACL-only (REVOKE / GRANT / COMMENT), no body.
--   ⛔ 20260716090000 is APPLIED. It is NOT edited here — this is a NEW
--   forward-only migration, which is the only sanctioned shape.
--
-- WHAT IS BYTE-UNCHANGED vs WHAT IS NOT. The 10-param body below is verbatim
-- from 20260716090000:181-313 — signature, DECLARE block, 4-way XOR guard,
-- p_kind NULL guard, the Phase 106 retired-kind reject, the optimistic
-- per-target look-up, and the race-safe INSERT — with exactly TWO changes,
-- both confined to the lost-race section:
--   (1) the four `SELECT id INTO STRICT` re-reads become plain `SELECT id INTO`
--       (same query, same LIMIT 1, same status filter);
--   (2) a single `IF v_new_id IS NULL THEN RAISE ... serialization_failure`
--       follows the IF-chain, copied in structure from the 7-param's
--       20260716090000:163-172. The message names all FOUR targets because
--       this overload has four arms (the 7-param names two).
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
-- body via pg_get_functiondef. It is EXPECTED RED in CI until this migration is
-- hand-applied to the TEST project — nothing applies migrations to TEST
-- automatically (supabase-migrate.yml targets PRODUCTION only). That RED→GREEN
-- flip is the gate's anti-vacuity demonstration; see the test file's header.
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- 10-param overload — verbatim from 20260716090000:181 with ONLY the four
-- lost-race re-reads de-strict-ed and the serialization_failure raise added.
--
-- ⚠️ GATE-TOKEN HYGIENE (T-163-16). `pg_get_functiondef` returns the body's
-- COMMENTS as well as its statements, so a gate grepping for a bare identifier
-- can be satisfied by prose the function carries about itself. Two layers close
-- that here, and the second is the load-bearing one:
--   1. CONVENTION — the comments inside this body are phrased as "the strict
--      re-read" rather than as the statement form. Belt.
--   2. MECHANISM — the DO block at the end of this file, and the recurring gate
--      in supabase/tests/, both match against a COMMENT-STRIPPED copy of the
--      definition. Braces, and the only layer that survives an editor who has
--      not read layer 1. It was added because the hole was DEMONSTRATED, not
--      hypothesised: on a scratch Postgres 16, a body whose raise had been
--      changed to `no_data_found` while one comment quoted the old ERRCODE
--      clause passed the presence arms GREEN.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _enqueue_compute_job_internal(
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
    -- Winner already advanced past in-flight. Tell the caller this was a race
    -- loss with a recoverable error code so the app layer can retry the
    -- enqueue without surfacing a 500. ERRCODE serialization_failure (40001)
    -- is the canonical Postgres class for "MVCC race, retry safe". All four
    -- targets are named because this overload has four arms; exactly one of
    -- them is non-null by the XOR guard above, so the message identifies the
    -- contended target without the caller having to guess which arm ran.
    RAISE EXCEPTION '_enqueue_compute_job_internal: enqueue race lost and winner already terminal (target strategy=%, portfolio=%, allocator=%, api_key=%, kind=%)',
      p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id, p_kind
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
-- body. Idempotent: COMMENT overwrites. Comments are NOT part of
-- pg_get_functiondef output, so this cannot interact with the gate token.
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
--   (d) the 10-param body lost the serialization_failure raise (the other half
--       of the fix — without it a lost race would return NULL silently, which
--       is a WORSE failure than the 500 this migration removes);
--   (e) the 10-param ACL drifted open on a SECURITY DEFINER function;
--   (f) compute_jobs_kind_check stopped admitting 'compute_analytics'
--       (regression guard against a "helpful" registry/CHECK drop — 45
--       historical rows FK-reference it).
-- Every RAISE format string is a SINGLE literal.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_fn7          text;   -- raw pg_get_functiondef (header + body + comments)
  v_fn10         text;
  v_body7        text;   -- ...with `--` line comments stripped. MATCH ON THESE.
  v_body10       text;
  v_check_clause text;
  v_oid7         oid := to_regprocedure(
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb)'
  );
  v_oid10        oid := to_regprocedure(
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)'
  );
  -- ⚠️ Whitespace-tolerant STATEMENT-form patterns, spelled as regexes rather
  -- than as literal substrings for TWO reasons, both load-bearing:
  --   1. Robustness — plpgsql does not normalise whitespace when it stores a
  --      body, so a re-read reformatted across a line break would evade a
  --      contiguous-substring search while remaining exactly the defect.
  --   2. Self-exclusion — written this way, THIS FILE contains zero contiguous
  --      occurrences of the token it hunts for, so a repo-level scan of the
  --      migration cannot be satisfied by the assertion that polices it.
  c_strict_re    CONSTANT text := 'INTO[[:space:]]+STRICT[[:space:]]+v_';
  c_serfail_re   CONSTANT text :=
    'USING[[:space:]]+ERRCODE[[:space:]]*=[[:space:]]*''serialization_failure''';
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

  -- T-163-16: strip `--` line comments so every arm below reads STATEMENTS, not
  -- the function's prose about itself. MEASURED on a scratch Postgres 16 while
  -- this migration was being written: a body whose raise had been changed to
  -- `no_data_found`, carrying one comment line quoting the old ERRCODE clause,
  -- passed the presence arms GREEN. Convention alone ("do not spell the token in
  -- a comment") does not survive the next editor; this does. The 'n' flag is what
  -- makes `.` newline-INsensitive — without it Postgres' `.` matches newlines and
  -- the first comment eats the rest of the definition.
  v_body7  := regexp_replace(v_fn7,  '--.*', '', 'gn');
  v_body10 := regexp_replace(v_fn10, '--.*', '', 'gn');

  -- (a) both bodies keep the Phase 106 retired-kind reject.
  IF position('compute_analytics is retired' IN v_body7) = 0 THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: 7-param overload is missing the retired-kind guard';
  END IF;
  IF position('compute_analytics is retired' IN v_body10) = 0 THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: 10-param overload is missing the retired-kind guard (this migration must not regress Phase 106 D3)';
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
  IF has_function_privilege('anon', v_oid10, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid10, 'EXECUTE') THEN
    RAISE EXCEPTION 'destrict-enqueue-10param: anon or authenticated holds EXECUTE on the 10-param SECURITY DEFINER overload — ACL drifted open (migration 118 revoked it)';
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

  RAISE NOTICE 'OPS-08: both _enqueue_compute_job_internal overloads re-read the lost race without the strict form and raise serialization_failure; retired-kind reject, SECDEF/search_path, ACL and the historical kind CHECK all intact.';
END
$$;
