-- Migration: the two remaining NULL-unsafe guards on
-- finalize_csv_strategy_with_returns become NULL-safe — GUARD 1 (the
-- p_terminal_status whitelist) and GUARD 2 (the caller-identity comparison).
-- The function is REPLACED in place; it is NOT dropped and its signature does
-- not move.
--
-- Phase 146.2 / v1.19 review-of-146.1 finding R5, plus finding 1 of the
-- migration review of this very file (closed here, before it was applied
-- anywhere — the filename still says guard1 because renaming an in-flight
-- migration file is a worse trade than a filename that under-describes it).
--
-- Why this migration exists
-- -------------------------
-- 20260819130000 is the anti-NULL migration: it made the fmt whitelist
-- (GUARD 4) and the name guards (GUARD 5) NULL-explicit precisely because
-- `x NOT IN (...)` evaluates to NULL for a NULL x and plpgsql then takes the
-- ELSE branch. GUARD 1 — the terminal-status whitelist, the FIRST statement in
-- the body — was left in the unsafe shape inside that same file
-- (20260819130000:243):
--
--     IF p_terminal_status NOT IN ('pending_review', 'private') THEN
--
-- so `p_terminal_status := NULL` walks past it. Nothing else refuses the value
-- either: it flows into the strategies INSERT and surfaces as a 23502 NOT NULL
-- violation from strategies.status — an error that names a COLUMN, not the
-- offending input, and that the route's classifier has no arm for. Meanwhile
-- the COMMENT ON FUNCTION ERRCODE map re-issued by that same migration
-- (20260819130000:446-455) promises 22023 for an invalid terminal status. The
-- map is therefore a documented promise the deployed body does not keep, and
-- THAT is what this file closes — by making the promise true, not by softening
-- the promise.
--
-- ⚠️ SCOPE HONESTY, in the register 20260819130000 set: this is NOT reachable
-- through the route. src/app/api/strategies/csv-finalize/route.ts validates
-- entry_context and passes STRING LITERALS for p_terminal_status, so the route
-- cannot send NULL. R5 is the AUTHENTICATED DIRECT-RPC boundary class — the
-- same class as A1 — and the in-body auth.uid() = p_user_id guard confines any
-- damage to the caller's own strategy. This is BOUNDARY HARDENING / ERRCODE-map
-- truthfulness, not the repair of a live user-facing break, and no reader
-- should re-file it as one.
--
-- RE-BASE ENUMERATION (house law, 20260728120000:186-195)
-- -------------------------------------------------------
-- Enumeration re-measured in this checkout on 2026-08-19, output pasted
-- verbatim (a citation nobody re-ran is a claim, not a fact):
--
--   $ grep -rln "finalize_csv_strategy_with_returns" supabase/migrations/
--   supabase/migrations/20260819120000_csv_finalize_atomic_fold.sql
--   supabase/migrations/20260819130000_csv_finalize_fold_input_guards.sql
--
--   $ grep -rn "finalize_csv_strategy" supabase/migrations/ | grep -iE \
--       "create (or replace )?function|drop function|alter function"
--   20260819120000_csv_finalize_atomic_fold.sql:204:CREATE FUNCTION public.finalize_csv_strategy_with_returns(
--   20260819130000_csv_finalize_fold_input_guards.sql:222:CREATE OR REPLACE FUNCTION public.finalize_csv_strategy_with_returns(
--
-- TWO migrations define this function; 20260819130000 is the LATER of the two
-- and therefore carries the LATEST body — 20260819130000:222-421, which is
-- byte-identical to the canonical replay at
-- supabase/schema/functions/finalize_csv_strategy_with_returns.sql:6-209
-- (diff run in-session, empty). That snapshot's own provenance header names
-- 20260819130000 as its source migration. The body below was extracted from
-- 20260819130000 with sed, NOT re-typed — G23-187 is the shipped regression
-- that came from re-typing a body from memory, and it is why the house rule
-- says re-base mechanically or not at all.
--
-- EXACT delta list against 20260819130000:218-703
-- -----------------------------------------------
--   1. GUARD 1 adopts GUARD 4's NULL-safe shape:
--        IF p_terminal_status IS NULL OR p_terminal_status NOT IN (...)
--      The RAISE, its format string, its argument and ERRCODE '22023' are
--      UNCHANGED, so the distinguishing substring every gate anchors on
--      ("p_terminal_status % is not allowed") does not move. GUARD 1's
--      explanatory comment gains the reason for the new arm.
--   2. GUARD 2's caller-identity comparison adopts `IS DISTINCT FROM`
--      (146.2 review-of-05 finding 1 — added to this file BEFORE it was
--      applied anywhere):
--        IF v_auth_uid IS DISTINCT FROM p_user_id THEN
--      p_user_id is caller-controlled with no DEFAULT, so a direct-RPC caller
--      can pass explicit null; `<>` was then NULL, plpgsql took the ELSE
--      branch and the identity guard passed silently, surfacing downstream as
--      a 23502 from strategies.user_id — the SAME pathology as R5, in the
--      SAME file, one guard below it. The RAISE, its format string, both
--      arguments and ERRCODE '42501' are UNCHANGED, so the substring
--      test_csv_finalize_auth_guard.sql Part B anchors on ("does not match
--      auth.uid") does not move. GUARD 2's explanatory comment gains the
--      reason and the shape rule.
--   3. STEP 4 gains checks (h2) and (h3): the GUARD 1 IS NULL arm and the
--      GUARD 2 IS DISTINCT FROM spelling must both be present in the deployed
--      body. Check (h) — the NOT IN whitelist itself — is UNCHANGED and still
--      matches the second half of GUARD 1's new condition; NO pre-existing
--      check covered GUARD 2 at all.
--   4. STEP 3's COMMENT ERRCODE map moves "(incl. NULL)" so it reads on the
--      terminal status as well as the fmt. Both are now true; before this
--      migration only the fmt half was.
--   5. STEP 0's pre-flight message names 20260819130000 as the state this file
--      was authored against (it named 20260819120000 in the parent).
--   EVERYTHING ELSE — the signature line and all 6 argument names/types/order
--   and the p_terminal_status DEFAULT, SECURITY DEFINER, the pinned
--   `SET search_path = public, pg_catalog`, the ABSENCE of STRICT, GUARDS
--   3-10 verbatim, all three INSERTs verbatim, the STEP 2 grant/REVOKE trio,
--   and every other STEP 4 check (a)-(g) and (i)-(p) — is byte-preserved from
--   20260819130000. ⚠️ The absence of STRICT is load-bearing and is NOT a
--   stylistic omission: a STRICT plpgsql function returns NULL for a NULL
--   argument WITHOUT ENTERING THE BODY, which would make every NULL guard in
--   this file unreachable and turn all of them into silence.
--
-- >>> READ THIS BEFORE SIMPLIFYING <<<
-- ------------------------------------
-- (i) The body still contains NO handler clause, ANYWHERE, and that absence is
--     the mechanism of the grandparent migration (20260819120000:80-96). Every
--     guard below RAISEs; none of them catches. As of Phase 146.2 this is no
--     longer pinned only at apply time by STEP 4(e): the RECURRING gate
--     supabase/tests/test_csv_finalize_atomic_fold.sql Part 1 now carries a
--     comment-stripped prosrc assertion, so a future CREATE OR REPLACE that
--     "hardens" this body with a handler reddens CI on every run, not only on
--     the one apply nobody re-runs (finding W3).
-- (ii) The ORDERING is load-bearing and unchanged: GUARD 1 stays FIRST so it
--     RAISEs before any write (D-08), and the empty-array refusal stays AFTER
--     the fmt whitelist so a bogus fmt still reports "invalid fmt".
-- (iii) GUARD 1's new arm is spelled `IS NULL OR`, matching GUARD 4 and
--     GUARD 5 exactly, rather than `IS DISTINCT FROM` or `coalesce()`. One
--     spelling for one job: a reader who has learned the shape at GUARD 4
--     must not have to re-learn it at GUARD 1, and STEP 4's regexes are
--     written against that one shape. GUARD 2 is spelled `IS DISTINCT FROM`
--     instead, and that is NOT drift — it is the OTHER half of one rule:
--     `x IS NULL OR x NOT IN (...)` for a WHITELIST, `a IS DISTINCT FROM b`
--     for a BINARY comparison (GUARD 8 already carries the second half and
--     states it as law). A whitelist cannot be written as IS DISTINCT FROM,
--     and writing GUARD 2 as `p_user_id IS NULL OR v_auth_uid <> p_user_id`
--     is the identical predicate with a redundant arm bolted on.
--
-- ERRCODE map: unchanged from 20260819130000:119-141 except that "invalid
-- terminal status" is now honestly reported as 22023 for a NULL as well as for
-- an out-of-whitelist value. The full map is re-issued as the COMMENT in
-- STEP 3 below, which supersedes 20260819130000:446-469.
--
-- ⚠️ PROD AUTO-APPLY: merging supabase/migrations/** to main auto-applies to
-- PROD with no deploy step and no prompt. This file REPLACES a DEPLOYED
-- function that every csv-finalize call goes through. It must be applied to
-- TEST and its gates executed there BEFORE the merge — that rehearsal is a
-- blocking gate owned by the phase's migration-gate plan. The plan that wrote
-- this file has NO database access to TEST or PROD; it verified the new body
-- and its gates by EXECUTION on a throwaway postgres:16 over a miniature
-- schema (three named REDs recorded in the plan SUMMARY), and STATICALLY
-- against this repo everywhere else.
--
-- Convention deviation (pre-documented so review does not re-litigate)
-- -------------------------------------------------------------------
-- .claude/agents/migration-reviewer.md invariant #14 forbids BEGIN/COMMIT in a
-- migration and rates session-level SET as HIGH. This file uses BOTH, inherited
-- verbatim from its direct parent 20260819130000:160-169, which sets out the
-- reasoning in full: the overwhelming majority of migrations in this repo use
-- BEGIN/COMMIT and the parent sets lock_timeout at session level in the same
-- shape. Per project Rule 11 (conformance over taste inside the codebase) and
-- Rule 7 (pick one side, never blend), the repo convention wins. This is the
-- ONLY sanctioned deviation.
--
-- Manual rollback (no down/ file — 26/230 migrations carry one):
--   BEGIN;
--     -- Re-issue 20260819130000:222-421 VERBATIM as a replace — never as a
--     -- drop, which would discard the ACLs restated in STEP 2 — and re-issue
--     -- the COMMENT from 20260819130000:446-469.
--   COMMIT;
--   -- and revert supabase/tests/test_csv_finalize_atomic_fold.sql to its
--   -- pre-146.2 revision in the same commit: Part 3e calls a guard arm that
--   -- would no longer exist and would red by design.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 0 — PRE-FLIGHT (fail-loud): the function this file replaces exists at
--          the expected arity and is SECURITY DEFINER
-- ==========================================================================
-- Honest note on what this can and cannot catch: it proves that exactly one
-- 6-arg finalize_csv_strategy_with_returns exists here and is SECURITY
-- DEFINER, so the replace below cannot silently mint a second overload
-- (PostgREST answers PGRST203 while two are visible) and cannot land on a
-- database that never received 20260819120000/20260819130000. It canNOT prove that the
-- existing BODY matches the lines this migration re-based on — a drifted body
-- still passes this check, and the STEP 4 self-verify at the end is what
-- catches an invariant that went missing in the replace itself.
DO $$
DECLARE
  v_cnt    INT;
  v_secdef BOOLEAN;
BEGIN
  SELECT count(*), bool_and(p.prosecdef)
    INTO v_cnt, v_secdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'finalize_csv_strategy_with_returns'
     AND p.pronargs = 6;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '146.2 R5 ABORT (STEP 0): expected exactly one 6-arg public.finalize_csv_strategy_with_returns to replace, found % - this database is not in the 20260819130000 state this migration was authored against; replacing anyway would either mint a second overload (PostgREST answers PGRST203 to every csv-finalize call) or add the NULL arm to a body nobody calls', v_cnt;
  END IF;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION '146.2 R5 ABORT (STEP 0): the deployed finalize_csv_strategy_with_returns is not SECURITY DEFINER - this database is in a state this migration was not authored against, and the guards below are being added to a body whose INSERTs already fail RLS';
  END IF;
END $$;

-- ==========================================================================
-- STEP 1 — the replaced function (CREATE OR REPLACE; the function is NOT
--          dropped, so its ACLs and its OID survive)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.finalize_csv_strategy_with_returns(
  p_user_id           UUID,
  p_wizard_session_id UUID,
  p_fmt               TEXT,
  p_strategy_name     TEXT,
  p_rows              JSONB,
  p_terminal_status   TEXT DEFAULT 'pending_review'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid     UUID := auth.uid();
  v_strategy_id  UUID;
BEGIN
  -- GUARD 1 — CONTRIB-02 guard (T-110-02, D-08): restrict the terminal status;
  -- 'published' is unreachable from any finalize caller. FIRST statement so it
  -- RAISEs before any write (parent: 20260819120000:225-231).
  -- Gated behaviorally by test_csv_finalize_atomic_fold.sql Part 3d.
  --
  -- CHANGED here (146.2 review R5) to be NULL-explicit, in the SAME shape
  -- GUARD 4 and GUARD 5 already use. p_terminal_status NOT IN (...) evaluates
  -- to NULL for a NULL argument and plpgsql takes the ELSE branch on a NULL IF
  -- condition, so a NULL terminal status used to walk past this whitelist
  -- entirely — and past everything else, because nothing below refuses it
  -- either. It surfaced as a 23502 NOT NULL violation from strategies.status:
  -- an error naming a COLUMN rather than the offending input, and one the
  -- route's classifier has no arm for, while the COMMENT ERRCODE map below
  -- promised 22023 for an invalid terminal status. The message literal, its
  -- argument and ERRCODE '22023' are UNCHANGED so no existing gate anchor
  -- moves; a NULL renders as <NULL> in the "% is not allowed" slot.
  IF p_terminal_status IS NULL OR p_terminal_status NOT IN ('pending_review', 'private') THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_terminal_status % is not allowed (expected pending_review or private)',
      p_terminal_status
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 2 — Caller-identity guards (parent: 20260819120000:233-251). The
  -- route layer calls with the authenticated user's id; we assert it matches
  -- the JWT so a SECURITY DEFINER RPC can't be abused via service_role to
  -- write rows under another user. This pair is also what confines finding
  -- A1's blast radius to the caller's OWN tenant. The message literals below
  -- are pinned by supabase/tests/test_csv_finalize_auth_guard.sql Parts A and
  -- B — change both together or not at all.
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns called without an auth session'
      USING ERRCODE = '42501';
  END IF;

  -- CHANGED here (146.2 review-of-05) to be NULL-safe. This was the SOLE
  -- remaining violator of the law this same file states at GUARD 8: ⛔ IS
  -- DISTINCT FROM, never <>. p_user_id is caller-controlled and carries no
  -- DEFAULT, so an authenticated direct-RPC caller can pass an explicit JSON
  -- null; `v_auth_uid <> p_user_id` then evaluated to NULL, plpgsql took the
  -- ELSE branch on a NULL IF condition, and the identity guard SILENTLY
  -- PASSED. Nothing below refused it either — GUARDS 3-10 touch only
  -- p_rows / p_fmt / p_strategy_name — so it reached the strategies INSERT
  -- and surfaced as a 23502 NOT NULL violation from strategies.user_id. That
  -- is R5's pathology verbatim: an error naming a COLUMN instead of the
  -- offending input, while this function's own COMMENT ERRCODE map (STEP 3)
  -- promises 42501 for "no session or identity mismatch" — and a NULL
  -- p_user_id IS an identity mismatch. The message literal, both its
  -- arguments and ERRCODE '42501' are UNCHANGED so no existing gate anchor
  -- moves; a NULL renders as <NULL> in the "p_user_id (%)" slot.
  -- ⚠️ THE SHAPE RULE, so the two spellings in this file do not read as
  -- drift: an `x NOT IN (...)` whitelist takes `x IS NULL OR ...`
  -- (GUARDS 1, 4, 5); a BINARY comparison takes IS DISTINCT FROM
  -- (GUARDS 2 and 8). Both are NULL-safe; neither is usable at the other's
  -- site — `IS DISTINCT FROM` cannot express a set membership, and
  -- `p_user_id IS NULL OR v_auth_uid <> p_user_id` is the same predicate
  -- spelled with a redundant arm.
  IF v_auth_uid IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = '42501';
  END IF;

  -- GUARD 3 — (new, v1.19 review A1) p_rows NULL. Every rows guard below this
  -- point is a three-valued-logic comparison that a NULL argument PASSES:
  -- jsonb_typeof(NULL) is NULL, NULL <> 'array' is NULL, and plpgsql takes the
  -- ELSE branch on a NULL IF condition. MEASURED on a throwaway
  -- postgres:16-alpine (146.1-RESEARCH.md §1.2): before this guard,
  -- p_rows := NULL returned a UUID for a strategy with zero dailies that the
  -- Phase 143 sweep cannot heal. This guard sits ABOVE the jsonb_typeof guard
  -- so the NULL case gets its own distinguishing message.
  IF p_rows IS NULL THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows is required (got NULL)'
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 4 — Format whitelist (parent: 20260819120000:254-257), CHANGED to be
  -- NULL-explicit: p_fmt NOT IN (...) is NULL when p_fmt is NULL, and plpgsql
  -- then takes the ELSE branch, so a NULL fmt used to pass the whitelist
  -- entirely. The 'invalid fmt' distinguishing substring is preserved verbatim
  -- so no existing gate moves.
  IF p_fmt IS NULL OR p_fmt NOT IN ('daily_returns','daily_nav','trades') THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: invalid fmt %', p_fmt
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 5 — Strategy-name guards (parent: 20260819120000:262-272, verbatim):
  -- 1-80 chars, two raises with distinguishing substrings so tests can pin each
  -- separately from the fmt guard.
  IF p_strategy_name IS NULL OR length(p_strategy_name) = 0 THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_strategy_name is required'
      USING ERRCODE = '22023';
  END IF;

  IF length(p_strategy_name) > 80 THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_strategy_name exceeds 80 characters'
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 6 — Rows type guard (parent: 20260819120000:275-278, verbatim):
  -- p_rows MUST be an array before jsonb_array_length is called on it.
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows must be a JSONB array, got %', jsonb_typeof(p_rows)
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 7 — Row-count cap (parent: 20260819120000:283-286, verbatim): the
  -- route validator also enforces <=5000 upstream; this is defense-in-depth so
  -- a direct RPC caller cannot insert an unbounded series. ⛔ The spelling of
  -- this line is pinned by a word-bounded regex in STEP 4 below and in the
  -- parent's STEP 3(d) — a widened literal is the exact false-PASS class this
  -- phase exists to close.
  IF jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows exceeds 5000 rows (got %)', jsonb_array_length(p_rows)
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 8 — (new, v1.19 review A1) empty array, NARROWED to fmt='trades'.
  -- 20260819120000:288-290 recorded that the parents' empty-array raise is
  -- deliberately ABSENT because an empty array is the legitimate fmt='trades'
  -- no-series case. That reasoning is preserved, not reverted: 'trades' still
  -- finalizes with zero dailies (pinned unwrapped by Part 4 of the fold gate).
  -- Every OTHER fmt asking to persist a daily series with no rows in it is
  -- refused. ⛔ IS DISTINCT FROM, never <>: p_fmt <> 'trades' is NULL when
  -- p_fmt is NULL and the guard would not fire (MEASURED). Today GUARD 4
  -- already refuses a NULL fmt, so this is defense in depth behind it — it
  -- exists so a future edit to GUARD 4 cannot silently re-open the hole.
  -- Placed AFTER GUARD 4 so a bogus fmt still reports 'invalid fmt'.
  IF jsonb_array_length(p_rows) = 0 AND p_fmt IS DISTINCT FROM 'trades' THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows is empty and fmt % accepts no empty series (only fmt=trades finalizes with zero dailies)',
      p_fmt
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 9 — (new, v1.19 review A1) the value scan, evaluated BEFORE the
  -- strategies INSERT so a poisoned element costs the caller an error, never a
  -- committed row. See "READ THIS BEFORE SIMPLIFYING" (iii) and (iv) in the
  -- header for why this is ONE BETWEEN rather than three predicates, and why
  -- the date fence is spelled in explicit UTC.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_rows) elem
     WHERE elem->>'daily_return' IS NULL
        OR elem->>'date' IS NULL
        OR NOT ((elem->>'daily_return')::DOUBLE PRECISION BETWEEN -10 AND 10)
        OR (elem->>'date')::DATE > (now() AT TIME ZONE 'UTC')::date
        OR (elem->>'date')::DATE < DATE '1900-01-01'
  ) THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows contains an unusable element (a missing date or daily_return, a daily_return that is NaN/Infinity or outside +/-10, or a date in the future or before 1900) - refused before any write'
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 10 — (new, v1.19 review A1) duplicate dates within one payload. See
  -- "READ THIS BEFORE SIMPLIFYING" (v): without this the dailies INSERT raises
  -- 23505 on csv_daily_returns_strategy_date_key, which the route's resolve arm
  -- mistakes for the double-submit fence.
  IF (SELECT count(*) <> count(DISTINCT elem->>'date')
        FROM jsonb_array_elements(p_rows) elem) THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows contains duplicate dates - a track record cannot carry two returns for one day, and persisting it would raise 23505 from the dailies unique index instead of a legible input error'
      USING ERRCODE = '22023';
  END IF;

  -- Insert the strategies row (parent: 20260819120000:299-310, column list
  -- EXACT). source='csv' marks the ingestion path; status=p_terminal_status
  -- ('pending_review' manager flow, 'private' CONTRIB-02 contribution flow).
  -- wizard_session_id is WRITTEN here (Phase 140.4 / SEAMRIM-03): this single
  -- column write is what makes the partial index
  -- strategies_user_wizard_session_source_uniq bite. A double submit raises
  -- 23505 on this INSERT, and because this body has no handler clause the
  -- raise aborts the function: NOTHING below (or above) survives.
  INSERT INTO strategies (
    user_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges,
    wizard_session_id
  )
  VALUES (
    p_user_id, p_strategy_name, p_terminal_status, 'csv',
    '{}', '{}', '{}', '{}'::text[],
    p_wizard_session_id
  )
  RETURNING id INTO v_strategy_id;

  -- Insert the verification row (parent: 20260819120000:317-324, verbatim).
  -- FK ordering note preserved from the parent: PostgreSQL allows the
  -- strategy_verifications.strategy_id FK to reference the just-inserted
  -- strategy because both inserts run in the same transaction (the SECURITY
  -- DEFINER function body is implicitly transactional). The FK check happens
  -- at COMMIT, not at the second INSERT.
  INSERT INTO strategy_verifications (
    strategy_id, wizard_session_id, status, trust_tier, flow_type, source,
    errors, correlation_id
  ) VALUES (
    v_strategy_id, p_wizard_session_id, 'validated', 'csv_uploaded', 'csv', 'csv',
    NULL, NULL
  );

  -- The dailies write (parent: 20260819120000:335-343, verbatim):
  -- length-gated (trades no-series case), plain INSERT (a fresh strategy id
  -- cannot conflict; duplicate dates are now refused by GUARD 10 above and at
  -- the route boundary), and written against the 20260624120000 shape — naming
  -- exactly (strategy_id, date, daily_return) leaves api_key_id/allocator_id
  -- NULL, which satisfies the csv_daily_returns_source_xor CHECK; the
  -- owner-coherence trigger is gated WHEN api_key_id IS NOT NULL and never
  -- fires for these rows. A malformed element that survived GUARD 9 (a
  -- non-numeric daily_return string, say) raises here and rolls back ALL THREE
  -- inserts — that rollback IS the SC#2 mechanism.
  IF jsonb_array_length(p_rows) > 0 THEN
    INSERT INTO csv_daily_returns (strategy_id, date, daily_return)
    SELECT
      v_strategy_id,
      (elem->>'date')::DATE,
      (elem->>'daily_return')::DOUBLE PRECISION
    FROM jsonb_array_elements(p_rows) elem;
  END IF;

  RETURN v_strategy_id;
END;
$$;

-- ==========================================================================
-- STEP 2 — grants. CREATE OR REPLACE PRESERVES the existing ACLs (unlike
--          DROP + CREATE, 20260601120000:32), so nothing below is required to
--          keep the function callable. They are restated so the complete grant
--          shape is auditable at the NEWEST file that defines this function
--          rather than only at its predecessor.
-- ==========================================================================
REVOKE ALL ON FUNCTION public.finalize_csv_strategy_with_returns(UUID, UUID, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_csv_strategy_with_returns(UUID, UUID, TEXT, TEXT, JSONB, TEXT) TO authenticated;

-- Finding C4 (inherited from 20260819130000, restated so the newest file that
-- defines this function carries the whole grant story) — the service_role ACL
-- claim. 20260819120000:365-366's COMMENT
-- claims "Grants: authenticated ONLY", but its STEP 3(b) only asserted that
-- authenticated HAS execute and anon does NOT; it never asserted anything about
-- service_role. This REVOKE and its matching assertion in STEP 4 close that gap
-- the honest way — by making the claim true and checkable rather than by
-- softening the claim. ⚠️ This is HYGIENE, not the closure of a live hole: a
-- service-role call NULLs auth.uid() and is already refused with 42501 by
-- GUARD 2 before it can write anything.
REVOKE ALL ON FUNCTION public.finalize_csv_strategy_with_returns(UUID, UUID, TEXT, TEXT, JSONB, TEXT) FROM service_role;

-- ==========================================================================
-- STEP 3 — re-issue COMMENT ON FUNCTION, superseding 20260819130000:446-469
--          (which in turn superseded 20260819120000:355-369)
-- ==========================================================================
-- ⚠️ The ONLY wording change against the superseded text is where "(incl.
-- NULL)" sits: it now qualifies the TERMINAL STATUS as well as the fmt,
-- because as of this migration both are true. Before it, the map promised
-- 22023 for an invalid terminal status while a NULL one raised 23502 from
-- strategies.status — a documented interface that the deployed body did not
-- honour, which is finding R5.
COMMENT ON FUNCTION public.finalize_csv_strategy_with_returns(UUID, UUID, TEXT, TEXT, JSONB, TEXT) IS
  'Phase 145 / JOB-06 / SC#2 (D-07), input guards hardened by Phase 146.1 (v1.19
   review A1/C4). Atomically creates the strategies row, the
   strategy_verifications row AND the csv_daily_returns series for a CSV-wizard
   finalize in ONE transaction. The body deliberately carries NO handler clause:
   any error - the 23505 double-submit fence included - rolls back all three
   writes, which is the whole point; do not add one. Empty p_rows is the
   legitimate fmt=trades no-series case and succeeds with zero dailies; for
   every other fmt an empty p_rows is refused. ERRCODE map: 22023 invalid
   terminal status (incl. NULL) / fmt (incl. NULL) / name / rows shape / NULL rows / >5000
   rows / empty rows for a non-trades fmt / an element with a missing date or
   daily_return, a daily_return that is NaN, +/-Infinity or outside +/-10, a
   date after today (UTC) or before 1900, or two elements sharing a date; 42501
   no session or identity mismatch; 23505 double submit (all three writes rolled
   back) - note this code has TWO possible sources,
   strategies_user_wizard_session_source_uniq AND
   csv_daily_returns_strategy_date_key (20260624120000:55-56), correcting the
   sole attribution in the superseded comment; the dailies one is unreachable
   from a conforming payload since the duplicate-date guard; 22007/22P02
   malformed row element (all three writes rolled back). Grants: authenticated
   ONLY - anon and service_role are REVOKEd and asserted so; service_role would
   NULL auth.uid() and 42501 every call (20260522111839:200-208). Gates:
   test_csv_finalize_atomic_fold.sql (Parts 1-7 incl. 3d and 3e; Part 1 also
   carries the STANDING comment-stripped prosrc no-handler pin and the
   service_role EXECUTE pin added by 146.2 W3, so a future CREATE OR REPLACE
   that adds a handler clause or re-grants service_role reddens CI on every
   run rather than only at apply time), test_csv_finalize_double_submit.sql,
   test_csv_finalize_auth_guard.sql.';

-- ==========================================================================
-- STEP 4 — Self-verifying DO block. Checks (a)-(p) are replicated VERBATIM
--          from 20260819130000:489-703 (which itself replicated (a)-(g) from
--          20260819120000:373-495); check (h2) is the only addition and is
--          what this migration puts under assertion.
-- ==========================================================================
-- ⚠️ WHY THE FULL SET IS REPLICATED HERE RATHER THAN CITED: every parent's
-- self-verify lives in an already-applied file and will NEVER run again.
-- A CREATE OR REPLACE that silently dropped SECURITY DEFINER, the search_path,
-- the wizard_session_id write, the 5000 cap or the handler-clause absence would
-- otherwise apply completely green. Deleting any check below re-opens that.
--
-- ⛔ EVERY match below runs against the COMMENT-STRIPPED body and is word- or
-- fragment-bounded. Never match an unbounded substring over the whole body:
-- that class has produced THREE measured false-PASSes in this repo ('%5000%'
-- satisfied by 50000; '%LIMIT 25%' satisfied by LIMIT 2500; a bare
-- '%public.compute_jobs%' satisfied by the INSERT target alone). Every RAISE
-- names the CONSEQUENCE of the missing token, not the token
-- (20260816140000:778-780 states this as law).
DO $$
DECLARE
  v_cnt        INT;
  v_secdef     BOOLEAN;
  v_nargs      INT;
  v_fn_src     TEXT;
  v_code       TEXT;
  v_ins_start  INT;
  v_ins_end    INT;
  v_ins_frag   TEXT;
  v_dl_start   INT;
  v_dl_end     INT;
  v_dl_frag    TEXT;
BEGIN
  -- (a) exactly ONE overload, 6 args, SECURITY DEFINER. Two overloads would
  --     make PostgREST answer PGRST203 to every finalize call; prosecdef false
  --     would make every INSERT run as the caller and fail RLS.
  SELECT count(*), bool_and(p.prosecdef), min(p.pronargs)
    INTO v_cnt, v_secdef, v_nargs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'finalize_csv_strategy_with_returns';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '146.1 A1: expected exactly ONE finalize_csv_strategy_with_returns overload, found % - a second overload makes PostgREST answer PGRST203 to every csv-finalize call', v_cnt;
  END IF;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION '146.1 A1: finalize_csv_strategy_with_returns is not SECURITY DEFINER - every INSERT would run as the caller and fail RLS, breaking every finalize';
  END IF;
  IF v_nargs <> 6 THEN
    RAISE EXCEPTION '146.1 A1: finalize_csv_strategy_with_returns has % args, expected 6 - the route caller passes 6 named arguments and would 42883', v_nargs;
  END IF;

  -- (b) grants: authenticated holds EXECUTE; anon does NOT; service_role does
  --     NOT (finding C4 — the superseded COMMENT claimed authenticated-only
  --     while nothing ever checked service_role).
  IF NOT has_function_privilege('authenticated',
        'public.finalize_csv_strategy_with_returns(uuid,uuid,text,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '146.1 A1: authenticated holds no EXECUTE on finalize_csv_strategy_with_returns - every legitimate csv-finalize would answer 42501 (the 20260522111839:200-208 outage class); the GRANT was skipped or went to the wrong role';
  END IF;
  IF has_function_privilege('anon',
        'public.finalize_csv_strategy_with_returns(uuid,uuid,text,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '146.1 A1: anon holds EXECUTE on finalize_csv_strategy_with_returns - an unauthenticated browser can POST /rest/v1/rpc/finalize_csv_strategy_with_returns directly, and the raise inside the body is then the ONLY layer';
  END IF;
  IF has_function_privilege('service_role',
        'public.finalize_csv_strategy_with_returns(uuid,uuid,text,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '146.1 A1/C4: service_role holds EXECUTE on finalize_csv_strategy_with_returns - the function COMMENT claims authenticated ONLY, and a documented grant shape that is false is how the next reader reasons from a wrong premise; the REVOKE in STEP 2 was skipped or a later default ACL re-granted it';
  END IF;

  SELECT pg_get_functiondef('public.finalize_csv_strategy_with_returns(uuid,uuid,text,text,jsonb,text)'::regprocedure)
    INTO v_fn_src;
  IF v_fn_src IS NULL THEN
    RAISE EXCEPTION '146.1 A1: finalize_csv_strategy_with_returns(uuid,uuid,text,text,jsonb,text) is missing';
  END IF;

  -- Comment-strip ONCE; every check below reads v_code, never v_fn_src. A
  -- deleted guard whose explanatory comment survives passes a raw-body match
  -- and is exactly how a self-verify starts lying.
  v_code := regexp_replace(v_fn_src, '--[^\n]*', '', 'g');

  -- (b2) the search_path pin. Without it a SECURITY DEFINER body resolves
  --      unqualified names through the CALLER's search_path, and every table
  --      named below can be shadowed by an attacker-owned schema.
  --      ⚠️ Read from pg_proc.proconfig, NOT from the text above:
  --      pg_get_functiondef RE-RENDERS a function's SET clause in its own
  --      normalized form, so a text match on the spelling used in this file
  --      would raise on a database where the pin is present and correct. A
  --      self-verify that fails on a healthy database is worse than none —
  --      it teaches the next author to delete the check.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'finalize_csv_strategy_with_returns'
       AND p.pronargs = 6
       AND EXISTS (
         SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
          WHERE cfg ~ '^search_path='
            AND cfg ~ '\mpublic\M'
            AND cfg ~ '\mpg_catalog\M'
       )
  ) THEN
    RAISE EXCEPTION '146.1 A1: finalize_csv_strategy_with_returns lost its search_path pin - a SECURITY DEFINER body without one resolves strategies/strategy_verifications/csv_daily_returns through the caller''s search_path and can be pointed at attacker-owned shadow tables';
  END IF;

  -- (c) the strategies INSERT writes wizard_session_id. Fragment-scoped on
  --     purpose (20260728120000:399-422): a whole-body match is satisfied by
  --     the parameter declaration alone and proves nothing. Without this write
  --     every CSV row sits OUTSIDE the partial unique index and the 23505
  --     idempotency story collapses (SEAMRIM-03 / review finding C-2).
  v_ins_start := strpos(v_code, 'INSERT INTO strategies (');
  v_ins_end   := strpos(v_code, 'RETURNING id INTO v_strategy_id');
  IF v_ins_start = 0 OR v_ins_end = 0 OR v_ins_end <= v_ins_start THEN
    RAISE EXCEPTION '146.1 A1: could not locate the strategies INSERT in finalize_csv_strategy_with_returns - the self-verify anchors have drifted; FIX THE ANCHORS rather than deleting this check';
  END IF;
  v_ins_frag := substr(v_code, v_ins_start, v_ins_end - v_ins_start);
  -- \m/\M word bounds are what separate the COLUMN wizard_session_id from the
  -- PARAMETER p_wizard_session_id; an unbounded match cannot tell them apart
  -- and would pass on a body that names neither correctly.
  IF v_ins_frag !~ '\mwizard_session_id\M' THEN
    RAISE EXCEPTION '146.1 A1: finalize_csv_strategy_with_returns does not write wizard_session_id in its strategies INSERT - every CSV row would carry NULL and sit OUTSIDE the partial double-submit index, so a double submit would create a SECOND strategy instead of raising 23505 (SEAMRIM-03 review finding C-2)';
  END IF;
  IF v_ins_frag !~ '\mp_wizard_session_id\M' THEN
    RAISE EXCEPTION '146.1 A1: finalize_csv_strategy_with_returns names the wizard_session_id column but does not pass p_wizard_session_id as its value - the column would be written from something other than the caller''s session and the double-submit index would key on the wrong thing';
  END IF;

  -- (d) the 5000 cap survived (20260522111839:160-162). Bounded regex: the
  --     substring form false-PASSes on a widened 50000 literal.
  IF v_code !~ 'jsonb_array_length\(p_rows\)\s*>\s*5000\M' THEN
    RAISE EXCEPTION '146.1 A1: the guard statement "jsonb_array_length(p_rows) > 5000" is gone from finalize_csv_strategy_with_returns (deleted or widened) - a direct RPC caller can insert an unbounded series (the route validator is bypassable by construction)';
  END IF;

  -- (e) NO handler clause anywhere in the comment-stripped body.
  IF v_code ~ 'EXCEPTION[[:space:]]+WHEN' THEN
    RAISE EXCEPTION '146.1 A1: finalize_csv_strategy_with_returns contains a handler clause - a swallowed error can commit a strategies row without its dailies, which is EXACTLY the orphan class SC#2 dissolves; remove the handler, never "harden" this body with one';
  END IF;

  -- (f) neither pre-fold parent came back. A surviving parent is a second
  --     writer that re-opens the two-transaction orphan windows.
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('finalize_csv_strategy', 'persist_csv_daily_returns');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '146.1 A1: % old csv-finalize function(s) are present in pg_proc (finalize_csv_strategy / persist_csv_daily_returns) - a re-created parent is a second writer with NONE of the guards below it, so every guard this migration adds is bypassable by calling the other name', v_cnt;
  END IF;

  -- (g) the dailies INSERT names exactly the three columns of the
  --     strategy-scoped shape. Naming api_key_id or allocator_id would trip the
  --     XOR CHECK or the owner-coherence trigger; naming fewer would fail NOT
  --     NULL.
  v_dl_start := strpos(v_code, 'INSERT INTO csv_daily_returns');
  IF v_dl_start = 0 THEN
    RAISE EXCEPTION '146.1 A1: could not locate the csv_daily_returns INSERT in finalize_csv_strategy_with_returns - the dailies write is gone and the fold is a two-write body, i.e. every finalize now commits a strategy with no track record at all';
  END IF;
  v_dl_end := strpos(substr(v_code, v_dl_start), 'FROM jsonb_array_elements');
  IF v_dl_end = 0 THEN
    RAISE EXCEPTION '146.1 A1: the csv_daily_returns INSERT anchors have drifted (no jsonb_array_elements after the INSERT); FIX THE ANCHORS rather than deleting this check';
  END IF;
  v_dl_frag := substr(v_code, v_dl_start, v_dl_end);
  IF v_dl_frag !~ '\(strategy_id, date, daily_return\)' THEN
    RAISE EXCEPTION '146.1 A1: the csv_daily_returns INSERT does not name exactly (strategy_id, date, daily_return) - the 20260624120000 shape requires api_key_id/allocator_id to stay NULL for strategy-scoped rows (XOR CHECK csv_daily_returns_source_xor), so the write would be rejected for every finalize';
  END IF;

  -- (h) GUARD 1 — the terminal-status whitelist (finding C4 / Part 3d).
  IF v_code !~ 'p_terminal_status[[:space:]]+NOT[[:space:]]+IN' THEN
    RAISE EXCEPTION '146.1 A1: the p_terminal_status whitelist is gone - a direct-RPC caller could finalize straight into ''published'' and put an unreviewed CSV strategy on the public surface without ever entering the admin review queue';
  END IF;

  -- (h2) GUARD 1 — the terminal-status whitelist is NULL-EXPLICIT (146.2 R5).
  --      Check (h) above proves the whitelist exists; it CANNOT prove the
  --      whitelist is reachable for a NULL argument, because
  --      `p_terminal_status NOT IN (...)` matches (h) in BOTH the safe and the
  --      unsafe spelling. That is exactly how the unsafe shape survived inside
  --      the anti-NULL migration itself. This check is the discriminator.
  IF v_code !~ 'p_terminal_status[[:space:]]+IS[[:space:]]+NULL[[:space:]]+OR[[:space:]]+p_terminal_status[[:space:]]+NOT[[:space:]]+IN' THEN
    RAISE EXCEPTION '146.2 R5: the terminal-status whitelist is no longer NULL-explicit - p_terminal_status NOT IN (...) evaluates to NULL for a NULL argument and plpgsql takes the ELSE branch, so a direct-RPC caller passing NULL walks past the whitelist and past every guard below it, and the failure surfaces as a 23502 from strategies.status naming a column instead of the input, while this function''s own COMMENT promises 22023';
  END IF;

  -- (h3) GUARD 2 — the identity comparison is NULL-SAFE (146.2
  --      review-of-05). Nothing in the (a)-(p) set pinned GUARD 2 at all, and
  --      no shape here can be inferred from the grant checks in (b): those
  --      assert WHO may call, never what the body does with the id it is
  --      handed. `v_auth_uid <> p_user_id` and `v_auth_uid IS DISTINCT FROM
  --      p_user_id` are indistinguishable to every other check in this block,
  --      which is exactly how the unsafe spelling survived inside the
  --      anti-NULL migration itself — twice now, at GUARD 1 and here. This
  --      line is the discriminator, and it reads the COMMENT-STRIPPED body so
  --      a comment quoting the safe spelling cannot false-PASS it.
  IF v_code !~ 'v_auth_uid[[:space:]]+IS[[:space:]]+DISTINCT[[:space:]]+FROM' THEN
    RAISE EXCEPTION '146.2 review-of-05: the caller-identity comparison is no longer NULL-safe - v_auth_uid <> p_user_id evaluates to NULL when a direct-RPC caller passes an explicit null p_user_id and plpgsql takes the ELSE branch, so the identity guard silently passes and the call reaches the strategies INSERT, where it surfaces as a 23502 from strategies.user_id naming a column instead of the offending input, while this function''s COMMENT promises 42501 for an identity mismatch';
  END IF;

  -- (i) GUARD 3 — the NULL p_rows refusal.
  IF v_code !~ 'IF[[:space:]]+p_rows[[:space:]]+IS[[:space:]]+NULL[[:space:]]+THEN' THEN
    RAISE EXCEPTION '146.1 A1: the NULL p_rows guard is gone - every rows guard below it is a three-valued-logic comparison a NULL argument passes, so a direct-RPC caller gets a committed strategy with ZERO dailies that the Phase 143 sweep structurally cannot heal (its EXISTS(csv_daily_returns) conjunct excludes it)';
  END IF;

  -- (j) GUARD 4 — the fmt whitelist is NULL-explicit.
  IF v_code !~ 'p_fmt[[:space:]]+IS[[:space:]]+NULL[[:space:]]+OR[[:space:]]+p_fmt[[:space:]]+NOT[[:space:]]+IN' THEN
    RAISE EXCEPTION '146.1 A1: the fmt whitelist is no longer NULL-explicit - p_fmt NOT IN (...) evaluates to NULL for a NULL fmt and plpgsql takes the ELSE branch, so an unformatted call walks straight past the whitelist';
  END IF;

  -- (k) GUARD 8 — the empty-array refusal, and its NULL-safe scoping.
  IF v_code !~ 'jsonb_array_length\(p_rows\)\s*=\s*0\M' THEN
    RAISE EXCEPTION '146.1 A1: the empty-rows guard is gone - a daily_returns or daily_nav finalize with no rows in it commits a strategy whose track record is empty, which is the zero-dailies class this migration exists to refuse';
  END IF;
  IF v_code !~ 'p_fmt[[:space:]]+IS[[:space:]]+DISTINCT[[:space:]]+FROM[[:space:]]+''trades''' THEN
    RAISE EXCEPTION '146.1 A1: the empty-rows guard no longer scopes itself with IS DISTINCT FROM - the <> form is NULL for a NULL fmt and the guard silently stops firing for exactly the caller who supplied no fmt at all';
  END IF;

  -- (l) GUARD 9 — the magnitude bound, pinned EXACTLY. \M is what stops this
  --     check passing on a body widened to BETWEEN -10 AND 100: without the
  --     word bound, '-10 AND 100' satisfies the pattern as a prefix, and the
  --     NaN and 1e300 probes in the behavioral gate both still raise under the
  --     wider bound, so NOTHING else would notice.
  IF v_code !~ 'BETWEEN[[:space:]]+-10[[:space:]]+AND[[:space:]]+10\M' THEN
    RAISE EXCEPTION '146.1 A1: the daily_return magnitude bound is gone or widened - a NaN, an Infinity or a 1e300 return persists as a track record whose Sharpe is undefined for every downstream consumer and which can never be recomputed to a number; the bound must remain +/-10, mirroring MAX_DAILY_RETURN at route.ts:198-200';
  END IF;

  -- (m) GUARD 9 — the NULL-value arms. The BETWEEN cannot catch these: NOT
  --     (NULL BETWEEN ...) is NULL, so without them the failure surfaces as a
  --     23502 from a table constraint naming no input.
  IF v_code !~ '->>''daily_return''[[:space:]]+IS[[:space:]]+NULL' THEN
    RAISE EXCEPTION '146.1 A1: the missing-daily_return arm of the value scan is gone - an element with no daily_return now fails as a 23502 NOT NULL violation from csv_daily_returns, an error that names a column instead of the offending input and that the route maps to no useful arm';
  END IF;
  IF v_code !~ '->>''date''[[:space:]]+IS[[:space:]]+NULL' THEN
    RAISE EXCEPTION '146.1 A1: the missing-date arm of the value scan is gone - an element with no date now fails as a 23502 NOT NULL violation from csv_daily_returns rather than a legible input error';
  END IF;

  -- (n) GUARD 9 — the date fence, in explicit UTC.
  IF v_code !~ 'now\(\)[[:space:]]+AT[[:space:]]+TIME[[:space:]]+ZONE[[:space:]]+''UTC''' THEN
    RAISE EXCEPTION '146.1 A1: the future-date fence no longer computes today in UTC - a server-timezone date disagrees with the route''s own UTC fence (route.ts:227-236) by up to a day, so a payload accepted at the route is refused here for a reason no error message explains';
  END IF;
  -- The identifier below is assembled from two literals on purpose: the static
  -- file gate for this migration greps its own text for that token and fails
  -- closed, so spelling it contiguously here would red the file gate while
  -- changing nothing about what is asserted.
  IF v_code ~ ('CURRENT' || '_DATE') THEN
    RAISE EXCEPTION '146.1 A1: the date fence uses the session-date keyword instead of the explicit UTC form - it is server-timezone-dependent and silently disagrees with the route fence it is supposed to mirror';
  END IF;
  IF v_code !~ '''1900-01-01''' THEN
    RAISE EXCEPTION '146.1 A1: the lower date fence is gone - a calendar-absurd date such as 0001-01-01 persists into the track record, where every window/annualization calculation downstream reads it as a real observation';
  END IF;

  -- (o) GUARD 10 — the duplicate-date scan.
  IF v_code !~ 'count\(DISTINCT' THEN
    RAISE EXCEPTION '146.1 A1: the duplicate-date guard is gone - a payload with two returns for one day raises 23505 from csv_daily_returns_strategy_date_key, and the route''s resolve arm reads ANY 23505 as the double-submit fence and answers a permanent defect with a 503 retry invitation';
  END IF;

  -- (p) the value scan runs BEFORE the strategies INSERT. Position, not
  --     presence: a guard that runs after the write is not a guard, it is a
  --     rollback, and the whole claim of these Parts is "zero rows".
  IF strpos(v_code, 'jsonb_array_elements(p_rows) elem') = 0
     OR strpos(v_code, 'jsonb_array_elements(p_rows) elem') > v_ins_start THEN
    RAISE EXCEPTION '146.1 A1: the value/duplicate scan no longer sits above the strategies INSERT - the guards would run after rows had already been written, so the zero-rows guarantee the behavioral gate asserts would hold only by rollback and any future handler clause would leak a committed strategy';
  END IF;

  RAISE NOTICE '146.2 R5: finalize_csv_strategy_with_returns is live with a NULL-EXPLICIT terminal-status whitelist alongside the NULL-safe rows/fmt guards, a +/-10 finite magnitude bound, UTC-explicit and 1900 date fences, a duplicate-date scan, and anon + service_role both shut out. These are STRUCTURAL checks; the behavioral proof is supabase/tests/test_csv_finalize_atomic_fold.sql Parts 3d, 3e, 6 and 7.';
END $$;

COMMIT;
