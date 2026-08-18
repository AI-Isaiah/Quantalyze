-- Migration: fold finalize_csv_strategy + persist_csv_daily_returns into ONE
-- SECURITY DEFINER transaction — finalize_csv_strategy_with_returns — and DROP
-- both parents.
--
-- Phase 145 / JOB-06 / SC#2 (decision D-07; plan 145-03).
--
-- Why this migration exists
-- -------------------------
-- POST /api/strategies/csv-finalize runs a FIVE-hop sequence today: hop 0 HTTP
-- (Next -> Python, manager arm), hop 1 finalize_csv_strategy RPC (strategies +
-- strategy_verifications, one transaction), hop 2 metadata UPDATE, hop 3
-- stale-range probe, hop 4 persist_csv_daily_returns RPC (dailies, a SECOND
-- transaction), hop 5 after() enqueue. Because hops 1 and 4 are two separate
-- transactions separated by an HTTP boundary and two intermediate steps, three
-- failure windows exist in which a strategy row is committed while its dailies
-- are not:
--   window A — response lost after hop 4 committed (client never learns the id);
--   window B — hop 3's stale-probe read fails (503 "Nothing was changed." — a
--              lie: hops 1-2 already committed);
--   window C — hop 4 itself fails (500; strategy + verification committed,
--              zero dailies — the orphan class the PROD census measured: 18
--              rows, all from the 2026-05 incident era).
--
-- This migration DISSOLVES windows B and C rather than cleaning up after them:
-- with strategies + strategy_verifications + csv_daily_returns written by ONE
-- plpgsql SECURITY DEFINER body with no handler clause, an error at any point
-- rolls back all three writes. Window A downgrades to window D (a CONSISTENT
-- strategy+dailies+no-job state), which Phase 143's shipped sweep
-- (20260816140000_reconcile_dropped_enqueue_sweep.sql — cited here, NOT
-- modified, per decision D-10) already heals by re-enqueueing the compute job.
-- SC#2's "no orphan strategy row" becomes true by construction, prospectively.
--
-- RE-BASE ENUMERATION (house law, 20260728120000:186-195)
-- -------------------------------------------------------
-- Parent 1 — finalize_csv_strategy, LATEST body:
--   20260728120000_csv_finalize_double_submit_idempotency.sql:196-311 (the
--   5-arg form that writes wizard_session_id; 20260501055202 and 20260716130500
--   are superseded — re-basing on either would delete the terminal-status guard
--   or the wizard_session_id write).
-- Parent 2 — persist_csv_daily_returns, ONLY body:
--   20260522111839_csv_daily_returns.sql:111-186 (never redefined; the TABLE
--   under it was restructured by 20260624120000 — see the dailies-INSERT delta).
--
-- EXACT delta list from the two parent bodies:
--   1. Guards MERGED, in this order (finalize's order preserved, persist's
--      appended): p_terminal_status whitelist 22023 FIRST (D-08; before any
--      write, 20260728120000:212-219) -> auth NULL 42501 -> identity mismatch
--      42501 -> fmt whitelist 22023 -> name required 22023 -> name >80 22023 ->
--      rows typeof 22023 (20260522111839:153-155) -> rows >5000 cap 22023
--      (20260522111839:160-162, verbatim).
--   2. persist's auth pair (20260522111839:127-136) DROPPED as redundant — one
--      copy of the no-session + identity guards suffices in one body.
--   3. persist's probe-oracle ownership guard (20260522111839:145-149)
--      DISSOLVES — it existed to stop an authenticated caller enumerating
--      strategy UUIDs via a caller-supplied p_strategy_id. The fold CREATES the
--      strategy in the same transaction; there is no caller-supplied strategy
--      id to probe, so the guard has nothing to guard. Its ABSENCE here is by
--      construction, not a regression.
--   4. persist's empty-array raise (20260522111839:166-168) ADAPTED, not
--      copied: an EMPTY p_rows is the legitimate fmt='trades' no-series case
--      (today the route skips the persist call at route.ts:521 when
--      rows.length === 0). Inside the fold that skip becomes
--      `IF jsonb_array_length(p_rows) > 0 THEN <insert> END IF`. Copying the
--      raise verbatim would 22023 every trades finalize (RESEARCH Pitfall 2).
--   5. persist's ON CONFLICT upsert (20260522111839:179-181) REPLACED by a
--      plain INSERT: a freshly minted strategy id cannot conflict (no prior
--      rows can exist for an id created in this transaction), and duplicate
--      dates within one payload are a route-boundary 400 (route.ts:233-241).
--      ⚠️ THE RETRY STORY CHANGED WITH IT: the upsert was the OLD retry
--      mechanism (re-run persist onto an existing strategy). Under the fold a
--      failed submit commits NOTHING, so the instructed retry is a clean FIRST
--      submit; a 23505 can only mean a prior attempt FULLY committed (window
--      A). Do not cite an upsert as the retry mechanism — it is gone.
--   6. The dailies INSERT is written against the 20260624120000 table shape
--      (surrogate id PK, NULLABLE strategy_id, XOR CHECK
--      num_nonnulls(strategy_id, api_key_id) = 1, owner-coherence trigger
--      gated WHEN api_key_id IS NOT NULL): naming exactly (strategy_id, date,
--      daily_return) leaves api_key_id/allocator_id NULL, satisfying the XOR;
--      the owner-coherence trigger never fires for strategy-scoped rows.
--
-- >>> READ THIS BEFORE SIMPLIFYING <<<
-- ------------------------------------
-- The function body contains NO handler clause, ANYWHERE, and that absence is
-- THE mechanism of this migration. 20260728120000:80-87 states the two-write
-- version at length: an unhandled 23505 aborts the function and the enclosing
-- statement, so every write rolls back. This migration EXTENDS that guarantee
-- to THREE writes: a 23505 from strategies_user_wizard_session_source_uniq, a
-- 22007/22P02 from a malformed date element, a serialization failure — ANY
-- error — rolls back strategies + strategy_verifications + csv_daily_returns
-- together. Adding a handler clause "for robustness" around any of the three
-- INSERTs re-opens the orphan-strategy window this phase exists to close.
-- STEP 3 pins the absence with a comment-stripped regex; the behavioral gate
-- (supabase/tests/test_csv_finalize_atomic_fold.sql) executes a mid-body fault
-- and asserts zero rows in all three tables.
--
-- GRANT shape (and the tightening this migration performs)
-- --------------------------------------------------------
-- authenticated ONLY — never service_role. Narrowing callers to service_role
-- NULLs auth.uid() and 42501s every legitimate call (20260522111839:200-208,
-- the documented incident class). The dropped persist_csv_daily_returns
-- carried a service_role EXECUTE grant (20260522111839:210); that grant DIES
-- WITH THE DROP, deliberately — 145-PATTERNS.md Contradiction 1 picks the
-- finalize shape (authenticated only, more recent, and the Phase 145 arm-2
-- grep proved zero service-role callers exist). DROP FUNCTION loses ACLs
-- (20260601120000:32), so the fold's REVOKE/GRANT pair is (re)issued below
-- AFTER the DROPs, keeping the anon REVOKE auditable at this file.
--
-- ERRCODE map (canonical interface for downstream TS code — extends
-- 20260522111839:104-110)
-- ------------------------------------------------------------------
--   22023 — p_terminal_status not in ('pending_review','private'); invalid
--           fmt; strategy name missing or >80 chars; p_rows not a JSONB
--           array; p_rows > 5000 rows
--   42501 — caller not authenticated, or p_user_id does not match auth.uid()
--   23505 — strategies_user_wizard_session_source_uniq (double submit for the
--           same (user, wizard_session, source='csv')) — rolls back ALL THREE
--           writes; the caller's resolve arm maps it to an idempotent answer
--   22007 / 22P02 — malformed date / daily_return element in p_rows (bypassed
--           the route validator by calling the RPC directly) — rolls back ALL
--           THREE writes; nothing persists
--
-- ⚠️ PROD AUTO-APPLY: merging supabase/migrations/** to main auto-applies to
-- PROD. This file DROPs two DEPLOYED functions. It must be applied to TEST via
-- Supabase MCP (orchestrator session, Plan 06) and exercised there BEFORE the
-- merge. The route/Python callers are re-pointed by Plan 04 in the same PR —
-- merging this file alone would 42883 every csv-finalize.
--
-- Gates (all in this same commit — the 144-§8 rule):
--   supabase/tests/test_csv_finalize_atomic_fold.sql   (atomicity oracle,
--     'private' status, trades-empty, 5000 cap)
--   supabase/tests/test_csv_finalize_double_submit.sql (re-pointed; Part 3
--     rollback widened to three tables)
--   supabase/tests/test_csv_finalize_auth_guard.sql    (re-pointed; + both
--     old names gone from pg_proc)
--
-- Manual rollback (no down/ file — 26/230 migrations carry one):
--   BEGIN;
--     DROP FUNCTION IF EXISTS public.finalize_csv_strategy_with_returns(
--       UUID, UUID, TEXT, TEXT, JSONB, TEXT);
--     -- Recreate BOTH parents VERBATIM from their source migrations:
--     --   finalize_csv_strategy .... 20260728120000:196-315 (body + grants)
--     --   persist_csv_daily_returns 20260522111839:111-210 (body + COMMENT +
--     --                             grants, incl. its service_role EXECUTE)
--   COMMIT;
--   -- then revert the three gate files above to their pre-fold revisions in
--   -- the same commit (they call the fold by name and red otherwise — by
--   -- design), and revert the Plan 04 caller re-point.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 0 — PRE-FLIGHT (fail-loud): both parents exist at expected arity and
--          the dailies table carries the 20260624120000 shape
-- ==========================================================================
-- Honest note on what this can and cannot catch: it proves the two functions
-- this file DROPs exist at the expected arity and that csv_daily_returns was
-- restructured (surrogate id + XOR constraint present), so the dailies INSERT
-- below cannot land on the pre-20260624120000 shape. It canNOT prove the
-- parents' BODIES match the cited source lines (a drifted parent body still
-- passes), and it canNOT prove the route/Python callers were re-pointed —
-- that is Plan 04's TS/pytest gates' job.
DO $$
DECLARE
  v_cnt INT;
BEGIN
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'finalize_csv_strategy'
     AND p.pronargs = 5;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '145 FOLD ABORT (STEP 0): expected exactly one 5-arg public.finalize_csv_strategy to fold and DROP, found % - this database is not in the 20260728120000 state this migration was authored against; applying anyway would DROP nothing or the wrong overload and the fold would be a guess', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'persist_csv_daily_returns'
     AND p.pronargs = 3;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '145 FOLD ABORT (STEP 0): expected exactly one 3-arg public.persist_csv_daily_returns to fold and DROP, found % - this database is not in the 20260522111839 state this migration was authored against', v_cnt;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'csv_daily_returns'
       AND column_name = 'id'
  ) THEN
    RAISE EXCEPTION '145 FOLD ABORT (STEP 0): csv_daily_returns has no surrogate id column - the 20260624120000 restructure is not applied here, and the fold''s dailies INSERT was written against that shape (RESEARCH Pitfall 3)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'csv_daily_returns_source_xor'
       AND conrelid = 'public.csv_daily_returns'::regclass
  ) THEN
    RAISE EXCEPTION '145 FOLD ABORT (STEP 0): csv_daily_returns_source_xor CHECK is missing - the 20260624120000 per-key-axis shape is not applied here; the fold''s INSERT relies on strategy-scoped rows satisfying num_nonnulls(strategy_id, api_key_id) = 1';
  END IF;
END $$;

-- ==========================================================================
-- STEP 1 — the folded function
-- ==========================================================================
CREATE FUNCTION public.finalize_csv_strategy_with_returns(
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
  -- CONTRIB-02 guard (T-110-02, D-08): restrict the terminal status;
  -- 'published' is unreachable from any finalize caller. FIRST statement so it
  -- RAISEs before any write (parent: 20260728120000:215-219, verbatim; only
  -- the function name in the message changed).
  IF p_terminal_status NOT IN ('pending_review', 'private') THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_terminal_status % is not allowed (expected pending_review or private)',
      p_terminal_status
      USING ERRCODE = '22023';
  END IF;

  -- Caller-identity guards (parent: 20260728120000:225-234). The route layer
  -- calls with the authenticated user's id; we assert it matches the JWT so a
  -- SECURITY DEFINER RPC can't be abused via service_role to write rows under
  -- another user. persist's identical pair (20260522111839:127-136) is folded
  -- into this single copy. The message literal below is pinned by
  -- supabase/tests/test_csv_finalize_auth_guard.sql Part A — change both
  -- together or not at all.
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns called without an auth session'
      USING ERRCODE = '42501';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = '42501';
  END IF;

  -- Format whitelist (parent: 20260728120000:237-240, verbatim).
  IF p_fmt NOT IN ('daily_returns','daily_nav','trades') THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: invalid fmt %', p_fmt
      USING ERRCODE = '22023';
  END IF;

  -- Strategy-name guards (parent: 20260728120000:248-256, verbatim): 1-80
  -- chars, two raises with distinguishing substrings so tests can pin each
  -- separately from the fmt guard.
  IF p_strategy_name IS NULL OR length(p_strategy_name) = 0 THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_strategy_name is required'
      USING ERRCODE = '22023';
  END IF;

  IF length(p_strategy_name) > 80 THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_strategy_name exceeds 80 characters'
      USING ERRCODE = '22023';
  END IF;

  -- Rows type guard (parent: 20260522111839:153-155, verbatim): p_rows MUST
  -- be an array before jsonb_array_length is called on it.
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows must be a JSONB array, got %', jsonb_typeof(p_rows)
      USING ERRCODE = '22023';
  END IF;

  -- Row-count cap (parent: 20260522111839:160-162, verbatim): the route
  -- validator also enforces <=5000 upstream; this is defense-in-depth so a
  -- direct RPC caller cannot insert an unbounded series.
  IF jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows exceeds 5000 rows (got %)', jsonb_array_length(p_rows)
      USING ERRCODE = '22023';
  END IF;

  -- NOTE the parents' empty-array raise is deliberately ABSENT here: an empty
  -- array is the legitimate fmt='trades' no-series case (route.ts:521's skip,
  -- moved into this body as the length gate on the dailies INSERT below).

  -- Insert the strategies row (parent: 20260728120000:278-288, column list
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

  -- Insert the verification row (parent: 20260728120000:299-305, verbatim).
  -- FK ordering note preserved from the parent (:295-298): PostgreSQL allows
  -- the strategy_verifications.strategy_id FK to reference the just-inserted
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

  -- The dailies write (parent: 20260522111839:173-181, ADAPTED per the header
  -- delta list): length-gated (trades no-series case), plain INSERT (a fresh
  -- strategy id cannot conflict; duplicate dates are a route-boundary 400),
  -- and written against the 20260624120000 shape — naming exactly
  -- (strategy_id, date, daily_return) leaves api_key_id/allocator_id NULL,
  -- which satisfies the csv_daily_returns_source_xor CHECK; the
  -- owner-coherence trigger is gated WHEN api_key_id IS NOT NULL and never
  -- fires for these rows. A malformed element (date or daily_return cast
  -- failure) raises here and rolls back ALL THREE inserts — that rollback IS
  -- the SC#2 mechanism.
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
-- STEP 2 — DROP both parents (exact signatures), then (re)issue the fold's
--          grants. DROP FUNCTION loses ACLs (20260601120000:32); the dropped
--          persist's service_role grant dies with it — deliberately (header).
-- ==========================================================================
DROP FUNCTION public.finalize_csv_strategy(UUID, UUID, TEXT, TEXT, TEXT);
DROP FUNCTION public.persist_csv_daily_returns(UUID, UUID, JSONB);

REVOKE ALL ON FUNCTION public.finalize_csv_strategy_with_returns(UUID, UUID, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_csv_strategy_with_returns(UUID, UUID, TEXT, TEXT, JSONB, TEXT) TO authenticated;

COMMENT ON FUNCTION public.finalize_csv_strategy_with_returns(UUID, UUID, TEXT, TEXT, JSONB, TEXT) IS
  'Phase 145 / JOB-06 / SC#2 (D-07). Atomically creates the strategies row, the
   strategy_verifications row AND the csv_daily_returns series for a CSV-wizard
   finalize in ONE transaction. Folds finalize_csv_strategy (20260728120000,
   DROPped) and persist_csv_daily_returns (20260522111839, DROPped). The body
   deliberately carries NO handler clause: any error - the 23505 double-submit
   fence included - rolls back all three writes, which is the whole point; do
   not add one. Empty p_rows is the legitimate fmt=trades no-series case and
   succeeds with zero dailies. ERRCODE map: 22023 invalid terminal status /
   fmt / name / rows shape / >5000 rows; 42501 no session or identity
   mismatch; 23505 double submit (all three writes rolled back); 22007/22P02
   malformed row element (all three writes rolled back). Grants: authenticated
   ONLY - service_role would NULL auth.uid() and 42501 every call
   (20260522111839:200-208). Gates: test_csv_finalize_atomic_fold.sql,
   test_csv_finalize_double_submit.sql, test_csv_finalize_auth_guard.sql.';

-- ==========================================================================
-- STEP 3 — Self-verifying DO block (20260728120000 STEP 4 idiom; overload /
--          arity checks per 20260601120000:577-622)
-- ==========================================================================
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
  --     make PostgREST answer PGRST203 to every finalize call; prosecdef
  --     false would make every INSERT run as the caller and fail RLS.
  SELECT count(*), bool_and(p.prosecdef), min(p.pronargs)
    INTO v_cnt, v_secdef, v_nargs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'finalize_csv_strategy_with_returns';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '145 FOLD: expected exactly ONE finalize_csv_strategy_with_returns overload, found % - a second overload makes PostgREST answer PGRST203 to every csv-finalize call', v_cnt;
  END IF;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION '145 FOLD: finalize_csv_strategy_with_returns is not SECURITY DEFINER - every INSERT would run as the caller and fail RLS, breaking every finalize';
  END IF;
  IF v_nargs <> 6 THEN
    RAISE EXCEPTION '145 FOLD: finalize_csv_strategy_with_returns has % args, expected 6 - the callers re-pointed by Plan 04 pass 6 named arguments and would 42883', v_nargs;
  END IF;

  -- (b) grants: authenticated holds EXECUTE (without it EVERY finalize
  --     answers 42501 - the 20260522111839:200-208 outage class); anon does
  --     NOT (PostgREST exposes every public function at /rest/v1/rpc/<name>,
  --     so an anon EXECUTE is a standing unauthenticated door to a SECDEF
  --     writer - the raise inside is then the ONLY layer).
  IF NOT has_function_privilege('authenticated',
        'public.finalize_csv_strategy_with_returns(uuid,uuid,text,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '145 FOLD: authenticated holds no EXECUTE on finalize_csv_strategy_with_returns - every legitimate csv-finalize would answer 42501 (the 20260522111839:200-208 outage class); the GRANT was skipped or went to the wrong role';
  END IF;
  IF has_function_privilege('anon',
        'public.finalize_csv_strategy_with_returns(uuid,uuid,text,text,jsonb,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '145 FOLD: anon holds EXECUTE on finalize_csv_strategy_with_returns - an unauthenticated browser can POST /rest/v1/rpc/finalize_csv_strategy_with_returns directly; the REVOKE was skipped (DROP+CREATE re-grants via pg_default_acl - re-issue it)';
  END IF;

  SELECT pg_get_functiondef('public.finalize_csv_strategy_with_returns(uuid,uuid,text,text,jsonb,text)'::regprocedure)
    INTO v_fn_src;
  IF v_fn_src IS NULL THEN
    RAISE EXCEPTION '145 FOLD: finalize_csv_strategy_with_returns(uuid,uuid,text,text,jsonb,text) is missing';
  END IF;

  -- (c) the strategies INSERT writes wizard_session_id. Fragment-scoped on
  --     purpose (20260728120000:399-422): a whole-body ILIKE is satisfied by
  --     the parameter declaration alone and proves nothing. Without this
  --     write every CSV row sits OUTSIDE the partial unique index and the
  --     23505 idempotency story collapses (SEAMRIM-03 / review finding C-2).
  v_ins_start := strpos(v_fn_src, 'INSERT INTO strategies (');
  v_ins_end   := strpos(v_fn_src, 'RETURNING id INTO v_strategy_id');
  IF v_ins_start = 0 OR v_ins_end = 0 OR v_ins_end <= v_ins_start THEN
    RAISE EXCEPTION '145 FOLD: could not locate the strategies INSERT in finalize_csv_strategy_with_returns - the self-verify anchors have drifted; FIX THE ANCHORS rather than deleting this check';
  END IF;
  v_ins_frag := substr(v_fn_src, v_ins_start, v_ins_end - v_ins_start);
  IF v_ins_frag NOT LIKE '%wizard_session_id%' THEN
    RAISE EXCEPTION '145 FOLD: finalize_csv_strategy_with_returns does not write wizard_session_id in its strategies INSERT - every CSV row would carry NULL and sit OUTSIDE the partial double-submit index (SEAMRIM-03 review finding C-2)';
  END IF;
  IF v_ins_frag NOT LIKE '%p_wizard_session_id%' THEN
    RAISE EXCEPTION '145 FOLD: finalize_csv_strategy_with_returns names the wizard_session_id column but does not pass p_wizard_session_id as its value';
  END IF;

  -- (d) the 5000 cap survived (20260522111839:160-162). Without it a direct
  --     RPC caller can insert an unbounded series in one call. Bounded regex
  --     over the COMMENT-STRIPPED body, not a whole-body '%5000%' LIKE: the
  --     substring false-PASSes on a widened '50000' literal and on a deleted
  --     guard whose surviving comment also says 5000 — the substring-gate
  --     class the two cron migrations fixed with word-bounded regexes
  --     (v1.19 review 2026-08-18).
  v_code := regexp_replace(v_fn_src, '--[^\n]*', '', 'g');
  IF v_code !~ 'jsonb_array_length\(p_rows\)\s*>\s*5000\M' THEN
    RAISE EXCEPTION '145 FOLD: the guard statement "jsonb_array_length(p_rows) > 5000" is gone from finalize_csv_strategy_with_returns (deleted or widened) - a direct RPC caller can insert an unbounded series (the route validator is bypassable by construction)';
  END IF;

  -- (e) NO handler clause in the comment-stripped body (v_code, stripped in
  --     (d) above). Class-separated regex on purpose: a bare token match
  --     would false-hit every RAISE statement. A handler ANYWHERE in this
  --     body can commit a partial write set, which is the orphan-strategy
  --     class this migration exists to dissolve (D-07;
  --     20260728120000:80-87 extended to three writes).
  IF v_code ~ 'EXCEPTION[[:space:]]+WHEN' THEN
    RAISE EXCEPTION '145 FOLD: finalize_csv_strategy_with_returns contains a handler clause - a swallowed error can commit a strategies row without its dailies, which is EXACTLY the orphan class SC#2 dissolves; remove the handler, never "harden" this body with one';
  END IF;

  -- (f) both parents are GONE (any arity). A surviving parent is a second
  --     writer: a caller still pointed at it would re-open the two-transaction
  --     windows this migration closes.
  SELECT count(*) INTO v_cnt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('finalize_csv_strategy', 'persist_csv_daily_returns');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '145 FOLD: % old csv-finalize function(s) still present in pg_proc (finalize_csv_strategy / persist_csv_daily_returns) - a surviving parent is a second writer that re-opens the orphan windows; the DROPs did not take', v_cnt;
  END IF;

  -- (g) the dailies INSERT names exactly the three columns of the
  --     strategy-scoped shape. Naming api_key_id or allocator_id here would
  --     trip the XOR CHECK or the owner-coherence trigger; naming fewer
  --     columns would fail NOT NULL.
  v_dl_start := strpos(v_fn_src, 'INSERT INTO csv_daily_returns');
  IF v_dl_start = 0 THEN
    RAISE EXCEPTION '145 FOLD: could not locate the csv_daily_returns INSERT in finalize_csv_strategy_with_returns - the dailies write is gone and the fold is a two-write body, i.e. the persist half of the fold silently vanished';
  END IF;
  v_dl_end := strpos(substr(v_fn_src, v_dl_start), 'FROM jsonb_array_elements');
  IF v_dl_end = 0 THEN
    RAISE EXCEPTION '145 FOLD: the csv_daily_returns INSERT anchors have drifted (no jsonb_array_elements after the INSERT); FIX THE ANCHORS rather than deleting this check';
  END IF;
  v_dl_frag := substr(v_fn_src, v_dl_start, v_dl_end);
  IF v_dl_frag NOT LIKE '%(strategy_id, date, daily_return)%' THEN
    RAISE EXCEPTION '145 FOLD: the csv_daily_returns INSERT does not name exactly (strategy_id, date, daily_return) - the 20260624120000 shape requires api_key_id/allocator_id to stay NULL for strategy-scoped rows (XOR CHECK csv_daily_returns_source_xor)';
  END IF;

  RAISE NOTICE '145 FOLD: finalize_csv_strategy_with_returns is live (SECDEF, 6 args, authenticated-only, no handler clause, wizard_session_id written, 5000 cap present, three-column dailies INSERT); both parents DROPped.';
END $$;

COMMIT;
