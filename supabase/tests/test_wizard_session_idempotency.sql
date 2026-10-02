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
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, REDUNDER-BACKFILL). The prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ ONE SECTION. Fifteen of this file's sixteen raises are `TEST FAILED:` or
-- `TEST BLOCKED (0)` — no parenthesised arm, or an arm the identity regex does
-- not read as one — so `3f` is the only identity here and the only section.
-- ⚠️ THE APPLY LIST CLEARS THE `:274` SKIP: it carries 20260814120000, so the
-- baseline prints `Section 4 OK` and `PASS: … ALL assertions armed`, never the
-- one-skip variant (MEASURED 2026-09-04).
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/13-fixture-csv-finalize-fold.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260728120000_csv_finalize_double_submit_idempotency.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql","supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql"]}

DO $$
DECLARE
  v_col_type   TEXT;
  v_idx_def    TEXT;
  v_idx_cols   TEXT[];
  v_fn_src     TEXT;
  -- ⛔ COMMENT-STRIPPED COPY. Used ONLY by the Migration-B detector in section
  -- 3e; section 3's canaries deliberately keep reading the RAW definition, which
  -- is correct for them (they assert PRESENCE, and a comment cannot fake the
  -- absence they would report). See 3e for why the strip is mandatory here.
  v_fn_code    TEXT;
  v_b_live     BOOLEAN;   -- migration 20260814120000 is applied to THIS database
  v_auth_exec  BOOLEAN;   -- authenticated currently holds EXECUTE
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

  -- ----- 3e. IS MIGRATION B LIVE ON *THIS* DATABASE? ------------------------
  -- ⭐ WHY THIS EXISTS AT ALL — THE MERGE-ORDER PROBLEM, STATED ONCE FOR THE
  -- WHOLE PHASE. Migration 20260814120000 (Migration B) CANNOT be applied to the
  -- shared TEST database ahead of the merge: `origin/main`'s copies of these same
  -- gate files still require `authenticated` to HOLD EXECUTE, so an early apply
  -- would red `sql-tests` for main and for every concurrent PR sharing that
  -- database. Section 4 below therefore asserts a state TEST does not yet have,
  -- and asserting it unconditionally reds THIS PR instead. The resolution is not
  -- to weaken section 4 — it is to arm it from the state of the database it is
  -- actually running against.
  --
  -- ⛔ THE DETECTOR READS LIVE STATE, NEVER A COMMENT MARKER, and never the thing
  -- it is arming. Three candidates were MEASURED on a local PG16 fixture carrying
  -- each state, and two of them are wrong:
  --
  --   * `auth.role()` — present in the Migration A body AND the Migration B body.
  --     It discriminates NOTHING; an assertion armed on it is armed always, which
  --     is the failure this whole exercise exists to avoid, inverted.
  --   * `has_function_privilege('authenticated', …)` — this is the very thing
  --     section 4 asserts. Arming on it makes that assertion VACUOUS: it would
  --     only run in the case where the ACL is already what we want.
  --   * ⛔⛔ THE **RAW** `pg_get_functiondef` — WRONG, AND MEASURED WRONG, NOT
  --     REASONED ABOUT. `pg_get_functiondef` reconstructs the body from `prosrc`,
  --     which stores the source VERBATIM INCLUDING COMMENTS, and Migration B's
  --     Trap B comment block discusses `v_auth_uid` and `auth.uid()` at length
  --     while explaining why they are absent. On a PG16 fixture carrying
  --     Migration B, `pg_get_functiondef(create_wizard_strategy) LIKE
  --     '%v_auth_uid%'` reads **TRUE**. A raw-matched detector would therefore
  --     read "Migration B is not live" on precisely the database it exists to
  --     guard, leaving section 4 PERMANENTLY UN-ARMED and silently green. Worse,
  --     the composite twin's raw definition reads FALSE in the same state (its
  --     comments do not mention the identifier), so a raw detector would arm on
  --     one twin and not the other — the instance-not-class shape again.
  --     ⚠️ This trap has now been hit THREE times independently: by migration
  --     20260814120000's own post-verify (e2), by plan 156-08's assertion 5h, and
  --     here. Do not "simplify" the strip away.
  --
  -- The surviving signal is the identifier `v_auth_uid` in the COMMENT-STRIPPED
  -- body. Migration A declares and compares it as CODE (`v_auth_uid UUID :=
  -- auth.uid();`, `IF v_auth_uid <> p_user_id`) because its `authenticated` arm
  -- needs it; Migration B deletes both, keeping the name only in prose.
  -- ⚠️ v_fn_src is fetched by proname above, so it is one arbitrary row if a
  -- second overload ever appears. That is not re-checked here on purpose — the
  -- overload count is pinned once for the suite at
  -- test_api_keys_venue_identity_uniq.sql section 3, and duplicating it here
  -- would be a second place to forget to update.
  v_fn_code := regexp_replace(v_fn_src, '--[^\n]*', '', 'g');
  v_b_live  := v_fn_code NOT LIKE '%v_auth_uid%';

  v_auth_exec := has_function_privilege('authenticated',
    'create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)', 'EXECUTE');

  -- ----- 3f. BOTH OR NEITHER — the half-state must RED, not skip -------------
  -- ⭐ THIS IS WHAT STOPS SECTION 4'S SKIP BEING A HOLE. A skip is honest only
  -- while the database is in one of the two states this file recognises. There
  -- are two INCOHERENT states, and NEITHER may reach the skip:
  --
  --   (i) BODY NARROWED, GRANT STILL STANDING — the strictly worst state this
  --       file can observe, because Migration B DELETES the auth.uid() ownership
  --       comparison rather than relaxing it, on the express premise that only
  --       service_role can reach the function at all. Body-without-REVOKE means
  --       any browser session can POST /rest/v1/rpc/create_wizard_strategy
  --       against a body that no longer checks ownership AT ALL and mint a draft
  --       owned by ANY p_user_id it names — a cross-tenant write.
  --       ⛔ IT IS NOT CHECKED HERE, AND THAT IS DELIBERATE. `v_b_live AND
  --       v_auth_exec` is EXACTLY the condition under which section 4's own
  --       assertion fires, and section 4 is armed on v_b_live, so it is REACHABLE
  --       in precisely that state. A check here would be PROVABLY DEAD CODE — and
  --       in the phase whose entire subject is controls that look like controls
  --       and assert nothing, shipping an unreachable assertion would be the
  --       worst possible thing to add. Section 4 also carries the pg_default_acl
  --       REMEDY text an operator needs. One statement, in one place, alive.
  --  (ii) GRANT REVOKED, BODY STILL MIGRATION A. This one has NO other home. It
  --       is the state in which section 4 would SKIP — v_b_live is false — while
  --       the database is demonstrably not in the Migration-A state that skip
  --       claims. Left unchecked it is a silent green: something applied §3 of
  --       Migration B without §1/§2, or a later migration re-based the body onto
  --       a stale source, and the file reports a clean skip either way.
  -- RED-UNDER: put migration 20260814120000's create_wizard_strategy back into
  --            the incoherent half-state (ii) this arm exists for — §3's REVOKE
  --            applied, but the body re-based onto Migration A's DECLARE block —
  --            by re-declaring `v_auth_uid` as CODE in that body.
  --            ⚠️ LAYERED, and it has to be: that same migration's post-verify
  --            (e2) greps its own comment-STRIPPED body for the identifier with
  --            the identical `regexp_replace(…, '--[^\n]*', '')` this file uses,
  --            so step 1 alone aborts the apply and the arm never reaches a lane
  --            (MEASURED 2026-09-04). Step 2 stands (e2) down, and only (e2):
  --            (e)'s `auth.uid()` check, the ACL checks and the SECURITY DEFINER
  --            checks all still run, so the state the lane reaches is the real
  --            half-state and not a migration with its verification switched off.
  -- RED-UNDER-M: {"arm":"3f","apply":[{"kind":"edit","file":"supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql","find":"DECLARE\n  v_jwt_role TEXT;\n  v_key_id UUID;\n  v_strategy_id UUID;\nBEGIN\n  -- ⭐ FINAL GATE (Phase 156 Migration B). Migration A's `authenticated` arm is","replace":"DECLARE\n  v_jwt_role TEXT;\n  v_auth_uid UUID;\n  v_key_id UUID;\n  v_strategy_id UUID;\nBEGIN\n  -- ⭐ FINAL GATE (Phase 156 Migration B). Migration A's `authenticated` arm is","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql","find":"  IF strpos(v_create_code, 'v_auth_uid') > 0 THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  IF v_auth_exec IS FALSE AND NOT v_b_live THEN
    RAISE EXCEPTION 'TEST FAILED (3f): INCOHERENT HALF-STATE. `authenticated` holds no EXECUTE on create_wizard_strategy — so migration 20260814120000 §3 ran here — but the body still declares v_auth_uid, i.e. it is still the Migration A (20260813150106) two-arm body. Either §1/§2 of that migration did not apply, or a later migration re-based the body onto a stale source. This is not a state any deployment should be in, and it must not be reported as a skip.';
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
  --
  -- ⚠️ ARMED ON v_b_live (section 3e), because on a database carrying Migration A
  -- ALONE `authenticated` HOLDING EXECUTE is the CORRECT state — Migration A
  -- deliberately does not revoke it, so that the two migrations can merge in
  -- sequence without a window in which connect-a-key is broken. Asserting the
  -- post-B state there would red CI for a database that is exactly where it is
  -- supposed to be. The skip below is therefore a statement about the DATABASE,
  -- never about this claim's validity.
  -- ⛔ THE SKIP IS NARROW ON PURPOSE: it covers this ONE assertion. The `anon`
  -- negative and the `service_role` positive below stay UNCONDITIONAL, because
  -- both are true under Migration A and Migration B alike, so this file can never
  -- go entirely inert. Section 3f above has already made every INCOHERENT state
  -- red rather than reach this branch at all.
  IF v_b_live THEN
    IF v_auth_exec THEN
      RAISE EXCEPTION 'TEST FAILED: authenticated HOLDS EXECUTE on create_wizard_strategy — Phase 156 / CONNECT-01 withdrew it (migration 20260814120000). A re-GRANT re-opens the direct PostgREST door: any browser session holding an authenticated JWT can POST /rest/v1/rpc/create_wizard_strategy and mint an attested_venue of its choosing. If no migration did this deliberately, a DROP + CREATE re-granted it silently via pg_default_acl — re-issue the REVOKE in that same migration.';
    END IF;
    RAISE NOTICE 'Section 4 OK: migration 20260814120000 is live here (create_wizard_strategy''s code carries no v_auth_uid) and `authenticated` holds NO EXECUTE on it.';
  ELSE
    RAISE NOTICE 'SKIP (section 4, the `authenticated` negative ONLY): migration 20260814120000 (Phase 156 Migration B) is NOT applied to this database — create_wizard_strategy''s comment-stripped body still declares v_auth_uid, i.e. it is the Migration A (20260813150106) two-arm body, under which `authenticated` HOLDING EXECUTE is the CORRECT and intended state. EXACTLY ONE assertion was skipped: "authenticated must NOT hold EXECUTE on create_wizard_strategy". Everything else in this file RAN — the column, the partial-unique index, all four body canaries, the anon negative, the service_role positive, and the section 3f both-or-neither coherence checks. This assertion arms itself the moment Migration B lands; nothing needs editing to re-enable it.';
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

  -- ⛔ THE SUMMARY LINE IS STATE-AWARE, AND THAT IS NOT COSMETIC. A fixed
  -- "service_role-only grants" PASS printed on a run that SKIPPED the
  -- `authenticated` negative is a green report of coverage the run did not have
  -- — the exact silent-green shape this phase exists to stop shipping. Say what
  -- actually ran.
  IF v_b_live THEN
    RAISE NOTICE 'PASS: F6 wizard-session idempotency invariants intact (column + partial-unique + advisory-lock fence + service_role-only grants, ALL assertions armed — Migration B is live here).';
  ELSE
    RAISE NOTICE 'PASS WITH 1 SKIP: F6 wizard-session idempotency invariants intact (column + partial-unique + advisory-lock fence + anon shut out + service_role holds EXECUTE). ⚠️ NOT asserted on this run: that `authenticated` holds no EXECUTE — Migration B (20260814120000) is not applied to this database. See the SKIP notice above.';
  END IF;
END $$;
