-- Migration: CSV double-submit idempotency — re-scope the strategies wizard
-- session index to (user_id, wizard_session_id, source) and make
-- finalize_csv_strategy actually WRITE wizard_session_id.
--
-- Phase 140.4 / SEAMRIM-03 (end-of-milestone review finding C-2 — CRITICAL,
-- CONFIRMED, could not be refuted on any sub-claim).
--
-- Why this migration exists
-- -------------------------
-- A CSV double-submit currently returns 200 OK and writes a SECOND strategies
-- row plus a SECOND strategy_verifications row, silently, logged
-- `process_key.csv_finalize_ok`. Both of the guards that used to prevent it were
-- removed in adjacent commits, and neither removal was wrong on its own terms:
--
--   1. 20260726000225_strategy_verifications_tenant_scope_uniq.sql replaced the
--      platform-global UNIQUE(wizard_session_id) on strategy_verifications with
--      UNIQUE (strategy_id, wizard_session_id). That migration is CORRECT and is
--      NOT reverted here — it closes a real cross-tenant leak (C-08). But
--      finalize_csv_strategy mints a FRESH strategy_id (:304 `RETURNING id INTO
--      v_strategy_id`) and only THEN inserts the verification row, so a
--      composite containing that fresh surrogate key can never collide. By
--      construction, not by accident.
--
--   2. The Python `WIZARD_DUPLICATE` pre-check was moved below the csv-finalize
--      branch (correctly — it was a dead end on that path).
--
-- The remaining backstop cannot fire either. `strategies_user_wizard_session_uniq`
-- (20260602190000:52-54) is partial on `WHERE wizard_session_id IS NOT NULL`, and
-- finalize_csv_strategy's strategies INSERT (20260716130500:296-304) OMITS the
-- column, so every CSV row carries NULL and sits outside the index predicate.
--
-- >>> WHY THE INDEX GAINS `source` — READ THIS BEFORE "SIMPLIFYING" IT <<<
-- ------------------------------------------------------------------------
-- The obvious fix is "write wizard_session_id and let the already-live TWO-column
-- index bite." That fix BREAKS LEGITIMATE FIRST SUBMITS, PERMANENTLY. The trigger
-- is in the client and is measured at source:
--
--   src/lib/wizard/localStorage.ts:379-381 (deriveWizardResumeOverrides) restores
--   `wizardSessionId` UNCONDITIONALLY on `source`:
--
--       if (loaded.wizardSessionId) { out.wizardSessionId = loaded.wizardSessionId; }
--
--   The `source === "csv"` branch immediately below gates only `step`, and there
--   is ONE shared storage key for both wizards — STORAGE_KEY =
--   "quantalyze_wizard_state_v1" (localStorage.ts:51). clearWizardState fires on
--   submit / delete-draft / start-fresh only, so an ABANDONED API draft leaves
--   the payload intact.
--
-- Reachable trace: user opens the API-key wizard -> session S ->
-- create_wizard_strategy writes strategies(user_id, wizard_session_id = S,
-- source='wizard') -> user abandons -> user opens the CSV wizard ->
-- deriveWizardResumeOverrides restores S -> the CSV finalize collides on
-- (user_id, S) -> the RPC aborts -> the user's FIRST legitimate CSV submit fails,
-- and every retry reuses S, so it fails FOREVER. That converts a silent duplicate
-- into a loud, unescapable dead end on a legitimate first submit.
--
-- Adding `source` costs nothing and removes the collision entirely:
--   * every API-path writer sets source='wizard' — create_wizard_strategy
--     (schema/functions/create_wizard_strategy.sql:88-97) and
--     add_wizard_composite_key (:70-80), both verified at source — so uniqueness
--     WITHIN the API path is preserved EXACTLY;
--   * finalize_csv_strategy sets source='csv', so the CSV path gets its own
--     independent (user, session) uniqueness;
--   * strategies.source is `TEXT NOT NULL DEFAULT 'legacy'`
--     (20260411103316:36), so there is no NULL-column hole in the composite (a
--     nullable third column would make every such row mutually distinct and the
--     index inert); and no migration in the tree ever UPDATEs strategies.source,
--     so the value is immutable in practice and a row cannot migrate out of its
--     own uniqueness bucket after insert.
--
-- >>> user_id STAYS THE LEADING COLUMN <<<
-- wizard_session_id is CALLER-SUPPLIED (routers/process_key.py reads it out of
-- `body.context`). A unique index that does not lead with the tenant key makes a
-- caller-controlled value unique platform-wide and lets one tenant's id reject —
-- and then leak — another tenant's row. That is exactly the C-08 defect
-- 20260726000225 exists to close. Do not re-order these columns.
--
-- Transaction guarantee (verified at source, not assumed)
-- --------------------------------------------------------
-- finalize_csv_strategy is LANGUAGE plpgsql SECURITY DEFINER with NO `EXCEPTION`
-- block (full body read at 20260716130500:236-325). An unhandled 23505 therefore
-- aborts the function and the enclosing statement, so BOTH the strategies row and
-- the strategy_verifications row roll back. The function's own comment at
-- 20260716130500:311-315 states the companion fact: "both inserts run in the same
-- transaction (the SECURITY DEFINER function body is implicitly transactional).
-- The FK check happens at COMMIT, not at the second INSERT." That restores the
-- pre-regression behaviour: a duplicate submit writes nothing.
--
-- The API tier turns that 23505 into an idempotent 200 with the EXISTING
-- strategy id (routers/process_key.py, same phase). This migration owns the
-- guarantee; the router owns the answer shape. The guarantee does not depend on
-- the router, and the router cannot manufacture it.
--
-- Name: strategies_user_wizard_session_source_uniq. The old name is deliberately
-- NOT reused — `CREATE UNIQUE INDEX IF NOT EXISTS <old name>` would be a silent
-- no-op against the OLD two-column definition, reporting success while changing
-- nothing, and supabase/tests/test_wizard_session_idempotency.sql would then pass
-- on the stale object. STEP 4 asserts the actual indexed column LIST AND ORDER
-- from pg_index, so even a name collision cannot pass silently.
--
-- Form: TRANSACTIONAL, not CONCURRENTLY — same reasoning as 20260726000225:53-64.
-- CONCURRENTLY cannot run inside a transaction block (25001) and a failed build
-- leaves an INVALID index behind that enforces nothing while still costing every
-- write. `SET lock_timeout = '3s'` bounds the ACCESS EXCLUSIVE worst case.
--
-- Ordering: CREATE the new index BEFORE dropping the old one. Reversing that
-- opens a window with NO uniqueness at all, in which a double-submit storm writes
-- duplicate rows that then block the new index build. (20260726000225:66-68.)
--
-- Gate: supabase/tests/test_csv_finalize_double_submit.sql — an EXECUTABLE
-- receipt, including the cross-source control case. Note that
-- supabase/tests/test_strategy_verifications_wizard_session_tenant_scope.sql
-- would have passed, GREEN, on this regression: its A1 assertion REQUIRES the
-- composite behaviour that produces the defect. Do not expect it to catch this.
--
-- Manual rollback (no down/ file — only 26 of 230 migrations carry one):
--   BEGIN;
--     CREATE UNIQUE INDEX strategies_user_wizard_session_uniq
--       ON public.strategies (user_id, wizard_session_id)
--       WHERE wizard_session_id IS NOT NULL;
--     DROP INDEX IF EXISTS strategies_user_wizard_session_source_uniq;
--   COMMIT;
--   -- plus re-apply 20260716130500's finalize_csv_strategy body verbatim.
-- That reinstates BOTH the silent CSV double-submit AND the cross-source
-- first-submit break, and will turn
-- supabase/tests/test_csv_finalize_double_submit.sql RED (by design — that file
-- is the gate).

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 0 — PRE-FLIGHT: abort if a duplicate (user_id, wizard_session_id,
--          source) group already exists
-- ==========================================================================
-- Mirrors 20260726000225:104-118, retargeted at the three-column key. A
-- CREATE UNIQUE INDEX that fails inside BEGIN/COMMIT leaves a partially applied
-- migration, so this is the guard against drift between authoring and apply.
--
-- Honest note on what this can and cannot catch: the OUTGOING two-column index
-- already enforces the strictly STRONGER (user_id, wizard_session_id) rule, so
-- any row set that satisfies it trivially satisfies the three-column rule. This
-- block can therefore only fire if that index was dropped or invalidated out of
-- band between authoring and apply. It is kept precisely for that case — not as
-- ceremony.
DO $$
DECLARE
  v_dups INT;
BEGIN
  SELECT count(*) INTO v_dups FROM (
    SELECT user_id, wizard_session_id, source
      FROM public.strategies
     WHERE wizard_session_id IS NOT NULL
     GROUP BY user_id, wizard_session_id, source
    HAVING count(*) > 1
  ) AS d;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'SEAMRIM-03 ABORT: % duplicate (user_id, wizard_session_id, source) groups present in strategies; resolve manually before applying the composite UNIQUE INDEX', v_dups
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

-- ==========================================================================
-- STEP 1 — CREATE the source-scoped composite unique index (before any drop)
-- ==========================================================================
CREATE UNIQUE INDEX IF NOT EXISTS strategies_user_wizard_session_source_uniq
  ON public.strategies (user_id, wizard_session_id, source)
  WHERE wizard_session_id IS NOT NULL;

COMMENT ON INDEX public.strategies_user_wizard_session_source_uniq IS
  'Phase 140.4 / SEAMRIM-03 (review finding C-2). At most one strategies row per (user, wizard_session_id, source) — the double-submit fence for BOTH wizard paths. GUARANTEES: a repeat POST /api/strategies/csv-finalize for the same wizard session raises 23505 and rolls back both the strategies row and the strategy_verifications row (finalize_csv_strategy has no EXCEPTION block), and the pre-existing API-path guarantee is preserved EXACTLY because every API writer sets source=''wizard'' (create_wizard_strategy, add_wizard_composite_key). WHY `source` IS IN THE KEY: src/lib/wizard/localStorage.ts:379-381 restores wizardSessionId UNCONDITIONALLY on source from ONE shared storage key (STORAGE_KEY quantalyze_wizard_state_v1, :51), so an ABANDONED API draft carrying session S is later replayed into the CSV wizard; a two-column (user_id, wizard_session_id) key would make that user''s FIRST legitimate CSV submit collide and — because every retry reuses S — fail PERMANENTLY. Scoping by source removes the cross-source collision at zero cost to the API guarantee. Do NOT "simplify" this back to two columns; strategies.source is NOT NULL so there is no NULL-distinctness hole. user_id LEADS deliberately: wizard_session_id is caller-supplied and a non-tenant-leading unique index is the C-08 cross-tenant leak (see 20260726000225). SUPERSEDES strategies_user_wizard_session_uniq (20260602190000:52-54). Gate: supabase/tests/test_csv_finalize_double_submit.sql.';

-- ==========================================================================
-- STEP 2 — DROP the two-column index
-- ==========================================================================
-- Must happen AFTER step 1. While it exists it enforces the two-column rule
-- regardless of the new index — which is the rule that breaks a legitimate first
-- CSV submit — so leaving it in place would make the whole migration inert.
-- (20260726000225:132-134 states the same reasoning for its own drop.)
DROP INDEX IF EXISTS public.strategies_user_wizard_session_uniq;

-- ==========================================================================
-- STEP 3 — finalize_csv_strategy WRITES wizard_session_id
-- ==========================================================================
-- Re-based on the LATEST definition: 20260716130500_finalize_terminal_status_param.sql:225-328
-- (the 5-argument form with p_terminal_status, created after that migration
-- DROPped the 4-argument signature from 20260501055202:185). Re-basing on the
-- older 4-arg body would silently delete the CONTRIB-02 terminal-status guard.
--
-- EXACTLY ONE change from that body: `wizard_session_id` is added to the
-- strategies INSERT column list and `p_wizard_session_id` to its VALUES.
-- Unchanged: the terminal-status guard, both auth-identity guards, the fmt
-- whitelist, the strategy-name guards, the strategy_verifications INSERT, and
-- the grants (restated verbatim below).
CREATE OR REPLACE FUNCTION public.finalize_csv_strategy(
  p_user_id            UUID,
  p_wizard_session_id  UUID,
  p_fmt                TEXT,
  p_strategy_name      TEXT,
  p_terminal_status    TEXT DEFAULT 'pending_review'
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
  -- CONTRIB-02 guard (T-110-02): restrict the terminal status; 'published' is
  -- unreachable from any finalize caller. FIRST statement so it RAISEs before
  -- the strategies INSERT.
  IF p_terminal_status NOT IN ('pending_review', 'private') THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_terminal_status % is not allowed (expected pending_review or private)',
      p_terminal_status
      USING ERRCODE = '22023';
  END IF;

  -- Caller-identity guard (mirrors create_wizard_strategy:140-153):
  -- the route layer calls with the authenticated user's id; we assert
  -- it matches the JWT so a SECURITY DEFINER RPC can't be abused via
  -- service_role to write rows under another user.
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_csv_strategy called without an auth session'
      USING ERRCODE = '42501';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = '42501';
  END IF;

  -- Format whitelist (mirrors the analytics service envelope contract).
  IF p_fmt NOT IN ('daily_returns','daily_nav','trades') THEN
    RAISE EXCEPTION 'finalize_csv_strategy: invalid fmt %', p_fmt
      USING ERRCODE = '22023';
  END IF;

  -- Strategy-name guard — the user typed it on the Upload step. We
  -- enforce 1–80 chars matching the UI-SPEC contract; the route layer
  -- also validates, but defense-in-depth lives here so a service-role
  -- caller cannot bypass the limit. Empty / oversize / NULL all reject
  -- under SQLSTATE 22023 with a distinguishing message substring so
  -- plan 15-06 tests can pin the guard separately from the fmt guard.
  IF p_strategy_name IS NULL OR length(p_strategy_name) = 0 THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_strategy_name is required'
      USING ERRCODE = '22023';
  END IF;

  IF length(p_strategy_name) > 80 THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_strategy_name exceeds 80 characters'
      USING ERRCODE = '22023';
  END IF;

  -- Insert the strategies row. source='csv' marks the row's ingestion
  -- path; status=p_terminal_status ('pending_review' for the manager flow,
  -- 'private' for the CONTRIB-02 contribution flow) matches
  -- finalize_wizard_strategy's post-promotion state so downstream queries
  -- (strategy_grid, /strategies/[id]) treat CSV strategies the same as API
  -- strategies once they reach this terminal state. supported_exchanges is
  -- empty because CSV strategies have no broker linkage. strategy_types /
  -- subtypes / markets default empty per Phase 15 v0; Phase 17 metadata
  -- step (deferred) will populate.
  --
  -- Phase 140.4 / SEAMRIM-03: wizard_session_id is WRITTEN here. This single
  -- column write is what makes the partial index
  -- strategies_user_wizard_session_source_uniq bite — the index predicate is
  -- `WHERE wizard_session_id IS NOT NULL`, so omitting the column (the
  -- pre-140.4 body) left every CSV row outside it and a double-submit minted a
  -- second strategy + a second verification row, silently, at 200 OK. The
  -- function deliberately has NO `EXCEPTION` block: the resulting 23505 aborts
  -- the function and rolls BOTH inserts back, and routers/process_key.py's
  -- csv-finalize arm turns that into an idempotent 200 carrying the EXISTING
  -- strategy id.
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

  -- Insert the verification row at status='validated', trust_tier='csv_uploaded'.
  -- CONTRIB-02 note: KEPT on both terminal statuses — trust_tier is an
  -- owner-facing data-quality label, not a publish signal (the admin queue keys
  -- on strategies.status='pending_review').
  -- Phase 16 / OBSERV-06 will populate correlation_id; we leave NULL.
  -- FK ordering note: PostgreSQL allows the strategy_verifications.strategy_id
  -- FK to reference the just-inserted strategy because both inserts run in
  -- the same transaction (the SECURITY DEFINER function body is implicitly
  -- transactional). The FK check happens at COMMIT, not at the second INSERT.
  INSERT INTO strategy_verifications (
    strategy_id, wizard_session_id, status, trust_tier, flow_type, source,
    errors, correlation_id
  ) VALUES (
    v_strategy_id, p_wizard_session_id, 'validated', 'csv_uploaded', 'csv', 'csv',
    NULL, NULL
  );

  RETURN v_strategy_id;
END;
$$;

-- Grants restated verbatim from 20260716130500:327-328. CREATE OR REPLACE
-- preserves existing ACLs, but restating them makes the migration
-- self-contained and keeps the anon REVOKE auditable at this file.
REVOKE ALL ON FUNCTION public.finalize_csv_strategy(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_csv_strategy(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;

-- The column comment must stop claiming CSV strategies carry NULL — writing the
-- column on the CSV path CHANGES the documented semantics of the column, and the
-- old text (20260602190000:47, "NULL for legacy/admin/CSV strategies") would
-- otherwise read as license to drop the write again.
COMMENT ON COLUMN public.strategies.wizard_session_id IS
  'Per-submission idempotency token (client localStorage, stable across retries) for the onboarding wizards. Written by create_wizard_strategy and add_wizard_composite_key (source=''wizard'') AND, since Phase 140.4 / SEAMRIM-03, by finalize_csv_strategy (source=''csv''). NULL for legacy/admin strategies ONLY — a CSV strategy created through the wizard now carries its session id, and that is load-bearing: the partial index strategies_user_wizard_session_source_uniq is predicated on `wizard_session_id IS NOT NULL`, so a NULL here silently removes the row from the double-submit fence (that omission WAS review finding C-2). Partial-unique with user_id AND source so a double-submit of POST /api/strategies/create-with-key or POST /api/strategies/csv-finalize dedups to one row instead of minting duplicate strategies + api_keys + Railway validate/encrypt charges (audit H-0304/H-0311/H-0186; review C-2).';

-- ==========================================================================
-- STEP 4 — Self-verifying DO block (mirrors 20260726000225 STEP 3)
-- ==========================================================================
DO $$
DECLARE
  v_cols      TEXT[];
  v_valid     BOOLEAN;
  v_idx_def   TEXT;
  v_old_cnt   INT;
  v_uniq      INT;
  v_fn_src    TEXT;
  v_ins_start INT;
  v_ins_end   INT;
  v_ins_frag  TEXT;
BEGIN
  -- (a) the new index exists, is UNIQUE, is VALID, and covers EXACTLY the three
  --     columns IN ORDER. Asserting the column LIST rather than just the name is
  --     what makes the `IF NOT EXISTS` no-op trap unable to pass, and it is the
  --     assertion that would redden if someone dropped `source` back out.
  SELECT array_agg(a.attname ORDER BY k.ord), bool_and(i.indisvalid AND i.indisunique)
    INTO v_cols, v_valid
    FROM pg_index i
    JOIN pg_class c     ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE n.nspname = 'public'
     AND c.relname = 'strategies_user_wizard_session_source_uniq';

  IF v_cols IS DISTINCT FROM ARRAY['user_id', 'wizard_session_id', 'source']::TEXT[] THEN
    RAISE EXCEPTION 'SEAMRIM-03: strategies_user_wizard_session_source_uniq covers %, expected {user_id,wizard_session_id,source} in that order', v_cols;
  END IF;
  IF v_valid IS NOT TRUE THEN
    RAISE EXCEPTION 'SEAMRIM-03: strategies_user_wizard_session_source_uniq is not a VALID UNIQUE index';
  END IF;

  -- (a2) still PARTIAL on the same predicate. A full index would collide every
  --      legacy/admin row that carries a NULL session id under no source scope.
  SELECT indexdef INTO v_idx_def
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename  = 'strategies'
     AND indexname  = 'strategies_user_wizard_session_source_uniq';
  IF v_idx_def IS NULL OR v_idx_def NOT ILIKE '%wizard_session_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'SEAMRIM-03: index must remain partial (WHERE wizard_session_id IS NOT NULL): %', v_idx_def;
  END IF;

  -- (b) the two-column index is gone. While it exists the migration is inert AND
  --     the cross-source first-submit break is still live.
  SELECT count(*) INTO v_old_cnt FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename  = 'strategies'
     AND indexname  = 'strategies_user_wizard_session_uniq';
  IF v_old_cnt <> 0 THEN
    RAISE EXCEPTION 'SEAMRIM-03: old strategies_user_wizard_session_uniq still present - the two-column rule still applies and this migration is inert';
  END IF;

  -- (b2) exactly ONE unique index on strategies now covers wizard_session_id, so
  --      a differently-named copy of the two-column shape cannot hide behind (b).
  SELECT count(*) INTO v_uniq
    FROM pg_index i
    JOIN pg_class c     ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'strategies'
     AND i.indisunique
     AND EXISTS (
       SELECT 1 FROM unnest(i.indkey) AS k(attnum)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
       WHERE a.attname = 'wizard_session_id'
     );
  IF v_uniq <> 1 THEN
    RAISE EXCEPTION 'SEAMRIM-03: expected exactly 1 unique index on strategies covering wizard_session_id, found %', v_uniq;
  END IF;

  -- (c) the function writes wizard_session_id INSIDE the strategies INSERT.
  --     Scoped to the INSERT fragment on purpose: a whole-body ILIKE would be
  --     satisfied by the parameter declaration and by the strategy_verifications
  --     INSERT, both of which were already there before this migration — i.e. the
  --     loose check passes on the UNFIXED body and proves nothing.
  SELECT pg_get_functiondef('public.finalize_csv_strategy(uuid,uuid,text,text,text)'::regprocedure)
    INTO v_fn_src;
  IF v_fn_src IS NULL THEN
    RAISE EXCEPTION 'SEAMRIM-03: finalize_csv_strategy(uuid,uuid,text,text,text) is missing';
  END IF;

  v_ins_start := strpos(v_fn_src, 'INSERT INTO strategies (');
  v_ins_end   := strpos(v_fn_src, 'RETURNING id INTO v_strategy_id');
  IF v_ins_start = 0 OR v_ins_end = 0 OR v_ins_end <= v_ins_start THEN
    RAISE EXCEPTION 'SEAMRIM-03: could not locate the strategies INSERT in finalize_csv_strategy - the self-verify anchors have drifted, FIX THE ANCHORS rather than deleting this check';
  END IF;
  v_ins_frag := substr(v_fn_src, v_ins_start, v_ins_end - v_ins_start);

  IF v_ins_frag NOT LIKE '%wizard_session_id%' THEN
    RAISE EXCEPTION 'SEAMRIM-03: finalize_csv_strategy does not write wizard_session_id in its strategies INSERT - every CSV row would carry NULL and sit OUTSIDE the partial index (review finding C-2)';
  END IF;
  IF v_ins_frag NOT LIKE '%p_wizard_session_id%' THEN
    RAISE EXCEPTION 'SEAMRIM-03: finalize_csv_strategy names the wizard_session_id column but does not pass p_wizard_session_id as its value';
  END IF;

  RAISE NOTICE 'SEAMRIM-03: strategies double-submit fence is now (user_id, wizard_session_id, source); two-column index dropped; finalize_csv_strategy writes wizard_session_id.';
END $$;

COMMIT;
