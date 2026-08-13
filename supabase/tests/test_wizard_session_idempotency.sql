-- Test for migration 20260602190000 — F6 wizard/key submission idempotency
-- (audit-2026-05-07: H-0304 / H-0311 / H-0186).
--
-- ROOT CAUSE the migration fixes: POST /api/strategies/create-with-key passed a
-- stable wizard_session_id and had a `23505 -> DRAFT_ALREADY_EXISTS` catch, but
-- NOTHING enforced uniqueness (no constraint/index on strategies or api_keys
-- beyond the PK) and create_wizard_strategy never stored or checked the session
-- id — so the catch was dead code and a double-submit minted two drafts + two
-- encrypted-secret rows + two Railway validate/encrypt charges.
--
-- This file pins the structural invariants of the fix. pgTAP is not set up in
-- this project (CLAUDE.md / Lane B audit), so assertions RAISE EXCEPTION on
-- failure — a clean run prints NOTICEs; a failed assertion aborts with a clear
-- message. The functional behavior (replay dedups to one draft; distinct
-- sessions are isolated) is exercised by create_wizard_strategy's own
-- self-verify block, the live probe run at authoring time, and the route-level
-- vitest suite (create-with-key/route.test.ts — idempotency fence).
--
-- Usage:
--   psql "$DATABASE_URL" -f supabase/tests/test_wizard_session_idempotency.sql

DO $$
DECLARE
  v_col_type   TEXT;
  v_idx_def    TEXT;
  v_idx_cols   TEXT[];
  v_fn_src     TEXT;
BEGIN
  -- ----- 0. A3: the CONNECTION ROLE, diagnosed rather than assumed ----------
  -- ⭐ WHY THIS IS THE FIRST THING THE FILE DOES. Phase 156 Migration B
  -- (20260814120000) REVOKEs `authenticated` EXECUTE on both wizard RPCs. The
  -- `sql-tests` lane's connecting role is NOT `authenticated` — it holds EXECUTE
  -- by OWNERSHIP or SUPERUSER, which no REVOKE touches — and
  -- `156-MEASUREMENTS.md` § A3 measured it as `postgres` or `supabase_admin`,
  -- both of which survive that REVOKE. This line is what says so OUT LOUD if
  -- that ever stops being true, instead of letting the suite's RPC-invoking
  -- gates (test_wizard_composite_fence.sql, test_csv_finalize_double_submit.sql,
  -- test_api_keys_exchange_not_user_writable.sql) fail with a spray of confusing
  -- `insufficient_privilege` assertions that read like a code regression.
  --
  -- ⛔ NO fixture GRANT and NO `SET LOCAL ROLE` remedy is applied here, and that
  -- is a DECISION, not an omission: `156-09-PLAN.md` Task 1 directs that when
  -- § A3 records a superuser-or-owner role — which it does — no remedy arm is
  -- taken, because an unnecessary fixture grant weakens this gate. A grant to
  -- `authenticated` in particular would silently re-open the very door
  -- Migration B shuts and would green section 4's inverted pin for the wrong
  -- reason. If this RAISE ever fires, read that plan's ordered arms; do not
  -- improvise one here.
  IF NOT has_function_privilege(current_user,
        'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST BLOCKED (0): the connection role % holds no EXECUTE on create_wizard_strategy, so this suite''s direct wizard-RPC call sites cannot run at all. This failure is ENVIRONMENTAL, not a regression — nothing about the schema or the migration is being reported here. See 156-MEASUREMENTS.md A3.', current_user;
  END IF;

  -- ----- 1. strategies.wizard_session_id column exists and is uuid ----------
  SELECT data_type INTO v_col_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'strategies'
     AND column_name = 'wizard_session_id';
  IF v_col_type IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: strategies.wizard_session_id column is missing';
  END IF;
  IF v_col_type <> 'uuid' THEN
    RAISE EXCEPTION 'TEST FAILED: strategies.wizard_session_id must be uuid, got %', v_col_type;
  END IF;

  -- ----- 2. partial-UNIQUE index on (user_id, wizard_session_id, source) ----
  -- Phase 140.4 / SEAMRIM-03 re-scoped this index by `source` (migration
  -- 20260728120000). WHY THE THIRD COLUMN: finalize_csv_strategy now writes
  -- wizard_session_id too, and src/lib/wizard/localStorage.ts:379-381 restores
  -- that id ACROSS the CSV/API boundary from one shared storage key — so under a
  -- two-column key an abandoned API draft would make the same user's FIRST
  -- legitimate CSV submit collide, permanently (every retry reuses the id).
  -- Scoping by source preserves the API-path guarantee exactly (all API writers
  -- set source='wizard') and removes the cross-source collision. The behavioural
  -- receipt, including that cross-source control case, is
  -- supabase/tests/test_csv_finalize_double_submit.sql.
  SELECT indexdef INTO v_idx_def
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'strategies'
     AND indexname = 'strategies_user_wizard_session_source_uniq';
  IF v_idx_def IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: strategies_user_wizard_session_source_uniq index is missing';
  END IF;
  IF v_idx_def NOT ILIKE '%UNIQUE%' THEN
    RAISE EXCEPTION 'TEST FAILED: strategies_user_wizard_session_source_uniq must be UNIQUE: %', v_idx_def;
  END IF;
  -- Assert the indexed column LIST AND ORDER from pg_index rather than
  -- substring-matching indexdef: an ILIKE for '%source%' also matches the index
  -- NAME inside its own definition text, so it would report agreement even if the
  -- column were dropped. user_id must LEAD — wizard_session_id is caller-supplied
  -- and a non-tenant-leading unique index over it is the C-08 cross-tenant leak.
  SELECT array_agg(a.attname ORDER BY k.ord) INTO v_idx_cols
    FROM pg_index i
    JOIN pg_class c     ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE n.nspname = 'public'
     AND c.relname = 'strategies_user_wizard_session_source_uniq';
  IF v_idx_cols IS DISTINCT FROM ARRAY['user_id', 'wizard_session_id', 'source']::TEXT[] THEN
    RAISE EXCEPTION 'TEST FAILED: index must cover exactly (user_id, wizard_session_id, source) in that order, got %', v_idx_cols;
  END IF;
  -- Must be PARTIAL (WHERE wizard_session_id IS NOT NULL) so legacy/admin rows
  -- (NULL session id) are excluded — otherwise every NULL collides.
  IF v_idx_def NOT ILIKE '%wizard_session_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'TEST FAILED: index must be partial (WHERE wizard_session_id IS NOT NULL): %', v_idx_def;
  END IF;

  -- ----- 3. create_wizard_strategy carries the idempotency fence ------------
  SELECT pg_get_functiondef(p.oid) INTO v_fn_src
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'create_wizard_strategy';
  IF v_fn_src IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED: create_wizard_strategy function is missing';
  END IF;
  -- (a) per-(user, session) advisory lock serializes concurrent double-submits
  IF v_fn_src NOT ILIKE '%pg_advisory_xact_lock%' OR v_fn_src NOT ILIKE '%wizdraft:%' THEN
    RAISE EXCEPTION 'TEST FAILED: create_wizard_strategy is missing the per-(user, session) advisory lock';
  END IF;
  -- (b) select-existing fence returns the prior draft instead of inserting
  IF v_fn_src NOT ILIKE '%s.wizard_session_id = p_wizard_session_id%' THEN
    RAISE EXCEPTION 'TEST FAILED: create_wizard_strategy is missing the select-existing fence';
  END IF;
  -- (c) the INSERT now stores the session id (so the fence + index can see it)
  IF v_fn_src NOT ILIKE '%wizard_session_id%' THEN
    RAISE EXCEPTION 'TEST FAILED: create_wizard_strategy does not store wizard_session_id';
  END IF;
  -- (d) still SECURITY DEFINER (the wizard write rides the current_user shift)
  IF v_fn_src NOT ILIKE '%SECURITY DEFINER%' THEN
    RAISE EXCEPTION 'TEST FAILED: create_wizard_strategy must remain SECURITY DEFINER';
  END IF;

  -- ----- 4. grants: ONLY service_role EXECUTEs; anon and authenticated do NOT
  -- ⭐ THE POLARITY ON `authenticated` IS INVERTED AS OF PHASE 156 / CONNECT-01
  -- (migration 20260814120000, Migration B). Until then this file asserted that
  -- `authenticated` HELD EXECUTE, because the browser called the RPC directly.
  -- It no longer does: PostgREST exposes every public function at
  -- /rest/v1/rpc/<name>, so while `authenticated` held EXECUTE any browser
  -- session could POST this SECURITY DEFINER writer itself and mint an
  -- attestation. The GRANT layer is the one door a browser cannot walk around,
  -- so the grant is withdrawn and THIS ASSERTION IS THE DURABLE GUARD:
  -- a re-GRANT — deliberate, or silently re-applied by Supabase's
  -- pg_default_acl on any future DROP + CREATE of this function
  -- (`156-MEASUREMENTS.md` § A4; it already bit 20260812083206 for `anon`) —
  -- re-opens that door, and must red CI rather than reach production.
  -- ⚠️ THE SIGNATURE GAINED A 12th TYPE (trailing `text`) IN MIGRATION
  -- 20260812083206 (Phase 154 / WIZCONT-02: p_venue_account_id text DEFAULT
  -- NULL). has_function_privilege's text form matches the DECLARED argument
  -- list EXACTLY and ignores defaults, so the old 11-type string does not
  -- resolve to a 12-parameter function — it raises undefined_function and this
  -- gate fails with a confusing "function does not exist" rather than a grant
  -- verdict. Re-cut here in the same commit as that migration. The RPC's
  -- POSITIONAL callers elsewhere in supabase/tests/ are unaffected: an omitted
  -- trailing defaulted parameter still resolves.
  --
  -- ⛔ That migration uses DROP + CREATE, not CREATE OR REPLACE, because a
  -- signature change via CREATE OR REPLACE would mint a SECOND overload and
  -- PostgREST would answer PGRST203 to every connect-a-key call. DROP destroys
  -- the ACL, so these assertions stopped being a formality: they are now the
  -- external check that the migration's re-issued REVOKE/GRANT statements took,
  -- and in particular that neither `anon` nor `authenticated` inherited the
  -- PUBLIC-EXECUTE default a freshly created function carries.
  IF has_function_privilege('authenticated',
        'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: authenticated HOLDS EXECUTE on create_wizard_strategy — Phase 156 / CONNECT-01 withdrew it (migration 20260814120000). A re-GRANT re-opens the direct PostgREST door: any browser session holding an authenticated JWT can POST /rest/v1/rpc/create_wizard_strategy and mint an attested_venue of its choosing. If no migration did this deliberately, a DROP + CREATE re-granted it silently via pg_default_acl — re-issue the REVOKE in that same migration.';
  END IF;
  IF has_function_privilege('anon',
        'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: anon must NOT have EXECUTE on create_wizard_strategy';
  END IF;

  -- ⛔ WHY A POSITIVE IS NEEDED ALONGSIDE THE NEGATIVES — AND NOT FOR THE REASON
  -- USUALLY GIVEN. The familiar argument is that a negative
  -- (`has_function_privilege(...) = FALSE`) also passes on a database where the
  -- function was DROPPED, so the pair cannot tell "the door is shut" from "the
  -- building is gone".
  -- ⚠️ THAT PREMISE IS FALSE FOR THE TEXT FORM OF THE SIGNATURE USED HERE, and it
  -- was MEASURED false on PostgreSQL 16 rather than reasoned about:
  -- `has_function_privilege('authenticated', '<signature text>', 'EXECUTE')`
  -- does NOT return FALSE for a function that does not exist — it RAISES
  -- undefined_function (42883), which under `psql -v ON_ERROR_STOP=1` aborts the
  -- file and fails the job. A dropped function is therefore already caught,
  -- loudly, by the negatives themselves. Do not re-introduce the folk version of
  -- this comment; it would justify the right assertion with the wrong reason.
  --
  -- ⭐ THE REAL GAP THIS POSITIVE CLOSES is the one mistake Migration B could
  -- actually make on its own terms: a REVOKE that goes ONE ROLE TOO FAR. If
  -- `service_role` loses EXECUTE while anon and authenticated stay correctly shut
  -- out, every negative above reads EXACTLY as intended and connect-a-key is
  -- nonetheless totally broken. No negative can see that. This line can — which
  -- is why its message names the OUTAGE rather than the privilege.
  IF NOT has_function_privilege('service_role',
        'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: CONNECT-A-KEY IS BROKEN — service_role holds no EXECUTE on create_wizard_strategy. Since Phase 156 (20260814120000) it is the ONLY role that may write a wizard draft, so every single-key connect answers 42501. A REVOKE went one role too far, or the function was dropped. The fix is to re-GRANT, not to retry.';
  END IF;

  RAISE NOTICE 'PASS: F6 wizard-session idempotency invariants intact (column + partial-unique + advisory-lock fence + service_role-only grants).';
END $$;
