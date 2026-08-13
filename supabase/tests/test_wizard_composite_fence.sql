-- Test for migration 20260710180000_wizard_composite.sql — the composite-draft
-- assembly RPC add_wizard_composite_key. Phase 88 (ONB-03).
--
-- add_wizard_composite_key lazily creates the ONE api_key_id=NULL composite
-- draft per (user, wizard_session_id) under a 'wizcomposite:' advisory-lock
-- fence, then ALWAYS inserts a fresh encrypted api_keys row and returns both
-- ids. It is the multi-key sibling of create_wizard_strategy (single-key, F6):
--   * the DRAFT is fenced per (user, session) — a double-click resolves to the
--     SAME draft, not two (the F6 double-submit dedup, ported to composites);
--   * but a real 2nd/3rd KEY add PROCEEDS (new api_keys row, same draft) — that
--     is ONB-03. Per-KEY idempotency is scoped on the member (Plan 88-02
--     set_wizard_composite_members wholesale write), NOT on the session draft.
--
-- This file asserts:
--   Part 1 — draft fence: two calls, same user + same session, different key
--            material → SAME strategy_id, the strategies row's api_key_id IS
--            NULL, and exactly ONE strategies row exists for that session.
--   Part 2 — ONB-03 proceed: those two calls minted TWO distinct api_keys rows
--            (the 2nd key proceeded, it did not replay/block).
--   Part 3 — the Phase 156 role gate. 3a: neither anon nor authenticated holds
--            EXECUTE and service_role does. 3b/3c: an `authenticated` caller is
--            REFUSED (42501) whatever identity it presents — composite and
--            single-key respectively. 3d: the service_role arm actually works,
--            stamps intact. 3e: every other role, and a connection presenting no
--            claims at all, fail CLOSED.
--            ⛔ The pre-156 `auth.uid() <> p_user_id` cross-user guard is GONE
--            FROM THE DATABASE (migration 20260814120000 deletes it, it is not
--            relaxed). Part 3b records where that control moved and which unit
--            tests now carry it. Do not read 3b/3c as ownership tests.
--   Part 4 — single-key regression: create_wizard_strategy STILL creates a
--            strategies row WITH api_key_id set and STILL fences per (user,
--            session) — the single-key path is byte-unchanged (SC-4 canary).
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands (the
-- sql-tests preflight rejects shell-out / copy / output redirection). Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. Filename matches the
-- `test_*.sql` glob so the job auto-discovers it (with migration 20260710180000
-- applied). Pre-migration (RED): Part 1 fails (function absent) and
-- ON_ERROR_STOP aborts there.
--
-- Hygiene: all fixture work runs inside an explicit transaction that ends in
-- ROLLBACK, so the shared test DB is never polluted. All ids are
-- gen_random_uuid() and every auth.users email is derived from a fresh uuid, so
-- a concurrent CI run against the shared test project cannot collide and no
-- defensive pre-clean is needed. The CALLER ROLE the RPC bodies gate on is
-- driven by set_config on request.jwt.claims (the Supabase JWT GUC auth.role()
-- reads); the outer block stays in the service-role context so verification
-- SELECTs bypass RLS.
-- ⚠️ THAT GUC IS NOT THE DATABASE ROLE. `set_config` cannot grant EXECUTE, so a
-- connection lacking it is not rescued by any claim shape below — which is what
-- Part 3a-0 diagnoses in one line, instead of every call site below failing
-- separately for a reason none of them names.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_wizard_composite_fence.sql

-- ==========================================================================
-- Part 3a — structural: NEITHER anon NOR authenticated may hold EXECUTE on the
-- composite RPC; service_role must. Zero side effects; RED pre-migration
-- (function absent → regprocedure errors, which under ON_ERROR_STOP aborts —
-- the intended pre-migration failure).
-- ==========================================================================
DO $$
DECLARE
  -- ⚠️ Spelled once here and used ONLY by the Phase-156 additions below. The
  -- pre-existing assertions keep their inline signature literals: re-pointing
  -- them at these constants would be a whole-file diff for no behavioural gain,
  -- and every one of those literals is load-bearing verbatim (the text form of
  -- has_function_privilege matches the DECLARED argument list EXACTLY). The
  -- constants must stay byte-identical to them, and to 20260814120000 §3.
  c_sig CONSTANT TEXT :=
    'public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)';
  k_sig CONSTANT TEXT :=
    'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)';
  v_b_live   BOOLEAN;   -- 20260814120000 narrowed the SINGLE-KEY body
  v_b_live_k BOOLEAN;   -- 20260814120000 narrowed the COMPOSITE body
  v_auth_c   BOOLEAN;   -- authenticated holds EXECUTE on the single-key RPC
  v_auth_k   BOOLEAN;   -- authenticated holds EXECUTE on the composite RPC
BEGIN
  -- ----- Part 3a-0 — A3: the CONNECTION ROLE, diagnosed rather than assumed --
  -- ⭐ THIS FILE INVOKES THE WIZARD RPCs DIRECTLY, MANY TIMES OVER — Parts 1, 2,
  -- 3b, 3c, 3d, 3e and 4 all call one or both.
  -- EXECUTE is checked against the CONNECTING database role, and
  -- `set_config('request.jwt.claims', …)` — which every Part below uses — sets a
  -- GUC, NOT that role. So the claim shapes further down cannot rescue a
  -- connection that lacks the grant. `156-MEASUREMENTS.md` § A3 measured the
  -- `sql-tests` connection as `postgres` or `supabase_admin`; both hold EXECUTE
  -- by OWNERSHIP or SUPERUSER respectively, which Migration B's
  -- `REVOKE … FROM authenticated` (20260814120000) does not touch. If that ever
  -- ceases to be true, THIS is the line that says so — one message naming the
  -- role — instead of a dozen `insufficient_privilege` failures below that read
  -- exactly like a broken migration.
  --
  -- ⛔ NO fixture GRANT and NO `SET LOCAL ROLE postgres` remedy is applied, and
  -- that is a DECISION: `156-09-PLAN.md` Task 1 directs that a superuser-or-owner
  -- § A3 reading takes NO remedy arm, since an unnecessary fixture grant weakens
  -- the very pins below. A fixture grant to `authenticated` would be worse still
  -- — it would re-open the door Migration B shuts and green Part 3a's inverted
  -- pin for the wrong reason. If this RAISE fires, read that plan's three
  -- ordered arms rather than improvising one here.
  IF NOT has_function_privilege(current_user,
       'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)',
       'EXECUTE')
     OR NOT has_function_privilege(current_user,
       'public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'TEST BLOCKED (Part 3a-0): the connection role % holds no EXECUTE on one or both wizard RPCs, so NONE of this file''s direct wizard-RPC call sites can run. This failure is ENVIRONMENTAL, not a regression — it reports the lane''s database connection, not the schema or the migration. See 156-MEASUREMENTS.md A3.', current_user;
  END IF;

  IF has_function_privilege('anon',
       'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3a): anon can EXECUTE add_wizard_composite_key — REVOKE missing';
  END IF;
  IF has_function_privilege('anon',
       'public.set_wizard_composite_members(uuid,uuid,jsonb)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3a): anon can EXECUTE set_wizard_composite_members — REVOKE missing';
  END IF;
  -- ⭐ POLARITY INVERTED BY PHASE 156 / CONNECT-01 (migration 20260814120000,
  -- Migration B). This assertion used to read `IF NOT … THEN RAISE` — it pinned
  -- `authenticated` as HAVING EXECUTE, because the browser called this RPC
  -- directly. It no longer does. PostgREST publishes every public function at
  -- /rest/v1/rpc/<name>, so while `authenticated` held EXECUTE any browser
  -- session could POST this SECURITY DEFINER writer itself. The grant is
  -- withdrawn, and THIS LINE IS THE DURABLE GUARD: a re-GRANT — deliberate, or
  -- silently re-applied by Supabase's pg_default_acl on any future
  -- DROP + CREATE (`156-MEASUREMENTS.md` § A4; it already bit 20260812083206 for
  -- `anon`) — re-opens that door and must red CI, not reach production.
  --
  -- ----- Part 3a-1 — IS MIGRATION B LIVE ON *THIS* DATABASE? ----------------
  -- ⭐ THE MERGE-ORDER PROBLEM. Migration 20260814120000 (Migration B) cannot be
  -- applied to the shared TEST database ahead of the merge: `origin/main`'s
  -- copies of these gate files still require `authenticated` to HOLD EXECUTE, so
  -- an early apply would red `sql-tests` for main and for every concurrent PR
  -- sharing that database. The assertion below therefore describes a state TEST
  -- does not yet have. The answer is not to weaken it — it is to arm it from the
  -- state of the database it is actually running against.
  --
  -- ⛔ THE DETECTOR IS LIVE STATE, NEVER A COMMENT MARKER, AND NEVER THE ACL IT
  -- ARMS. `has_function_privilege('authenticated', …)` is the very thing being
  -- asserted here, so arming on it would make the assertion vacuous. `auth.role()`
  -- is present in the Migration A body AND the Migration B body and discriminates
  -- nothing. The signal is the identifier `v_auth_uid` in the COMMENT-STRIPPED
  -- body: Migration A declares and compares it as CODE, Migration B deletes both
  -- and keeps the name only in prose.
  --
  -- ⛔⛔ THE STRIP IS MANDATORY AND WAS MEASURED, NOT ASSUMED. `pg_get_functiondef`
  -- reconstructs from `prosrc`, which stores the source VERBATIM INCLUDING
  -- COMMENTS, and Migration B's Trap B block discusses `v_auth_uid` at length
  -- while explaining its absence. On a PG16 fixture carrying Migration B the RAW
  -- definition of create_wizard_strategy matches '%v_auth_uid%' — TRUE — so a raw
  -- detector reads "not live" on exactly the database it guards and leaves the
  -- assertion permanently un-armed and silently green. ⚠️ MEASURED IN THE SAME
  -- RUN: the COMPOSITE twin's raw definition reads FALSE in that same state,
  -- because its comments do not name the identifier. A raw detector would
  -- therefore arm on one twin and not the other — the instance-not-class shape
  -- Phase 153.6 was convened to end, reproduced inside its own remedy.
  SELECT regexp_replace(pg_get_functiondef(to_regprocedure(c_sig)), '--[^\n]*', '', 'g')
           NOT LIKE '%v_auth_uid%',
         regexp_replace(pg_get_functiondef(to_regprocedure(k_sig)), '--[^\n]*', '', 'g')
           NOT LIKE '%v_auth_uid%'
    INTO v_b_live, v_b_live_k;
  v_auth_c := has_function_privilege('authenticated', c_sig, 'EXECUTE');
  v_auth_k := has_function_privilege('authenticated', k_sig, 'EXECUTE');

  -- ----- Part 3a-2 — BOTH OR NEITHER: an incoherent state REDS, never skips --
  -- ⭐ THIS IS WHAT KEEPS THE SKIP BELOW HONEST. A skip is only truthful while
  -- the database is in one of the two states this file recognises. Every
  -- half-state must fail loudly instead, and there are three distinguishable
  -- ones:
  --
  --  (a) ONE TWIN NARROWED, THE OTHER NOT. Migration B rewrites both bodies in
  --      one file; they cannot legitimately disagree. This is the defect class
  --      Phase 153.6 exists to end, caught in the schema rather than the diff.
  --  (b) BODY NARROWED, GRANT STILL STANDING — the worst state available.
  --      Migration B DELETES the auth.uid() ownership comparison rather than
  --      relaxing it, on the express premise that only service_role can reach
  --      the function. Body-without-REVOKE means `authenticated` can POST
  --      /rest/v1/rpc/<name> against a body that no longer checks ownership at
  --      all, and mint a draft owned by ANY p_user_id it names — a cross-tenant
  --      write, strictly worse than either migration alone.
  --  (c) GRANT REVOKED, BODY STILL MIGRATION A. A partial apply, or a later
  --      migration re-based a body onto a stale source.
  IF v_b_live <> v_b_live_k THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3a-2a): THE TWO WIZARD RPCs ARE IN DIFFERENT STATES. create_wizard_strategy narrowed=%, add_wizard_composite_key narrowed=% (read from each comment-stripped body''s v_auth_uid). Migration 20260814120000 rewrites BOTH bodies in one file, so they cannot legitimately disagree: a migration landed on one twin and not the other. That asymmetry is the instance-not-class defect Phase 153.6 was convened to end — the composite door standing open while the single-key door is shut is not a lesser bug, it is the same bug on the path nobody looked at. Change one, change both, in the same migration.', v_b_live, v_b_live_k;
  END IF;
  -- ⛔ SCOPED TO THE **SINGLE-KEY** GRANT, AND THE SCOPE IS THE POINT. The
  -- composite half of this state — bodies narrowed AND `authenticated` holding
  -- EXECUTE on add_wizard_composite_key — is EXACTLY the condition under which
  -- Part 3a's own armed assertion below fires, and that assertion is armed on
  -- v_b_live_k, so it is REACHABLE there. Repeating it here would be PROVABLY
  -- DEAD CODE, which in the phase whose subject is decorative controls is the
  -- worst thing to add. What Part 3a's assertion CANNOT see is create_wizard_
  -- strategy's grant: this file asserts the single-key ACL only for `anon` and
  -- `service_role`, never for `authenticated`. That gap is what this covers.
  IF v_b_live AND v_auth_c THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3a-2b): INCOHERENT HALF-STATE, AND IT IS THE WORST ONE. Both wizard RPC bodies carry NO v_auth_uid, so migration 20260814120000 narrowed them — but `authenticated` STILL HOLDS EXECUTE on create_wizard_strategy. Migration B DELETES the auth.uid() ownership comparison rather than relaxing it, on the premise that only service_role can reach these functions. With the body narrowed and the grant standing, any browser session can POST /rest/v1/rpc/create_wizard_strategy and mint a draft owned by ANY p_user_id it names — a cross-tenant write, strictly worse than either migration alone. ⚠️ This file pins the single-key ACL for anon and service_role only, so this line is the ONLY place it watches `authenticated` on that twin; the composite twin is covered by Part 3a''s own assertion below. Re-issue REVOKE ALL ON FUNCTION public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text) FROM PUBLIC, anon, authenticated; in a migration NOW.';
  END IF;
  IF NOT v_b_live AND NOT (v_auth_c AND v_auth_k) THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3a-2c): INCOHERENT HALF-STATE. `authenticated` has lost EXECUTE on at least one wizard RPC (create_wizard_strategy=%, add_wizard_composite_key=%) — so 20260814120000 §3 ran here — but the bodies still declare v_auth_uid, i.e. they are still the Migration A (20260813150106) two-arm bodies. Either §1/§2 of that migration did not apply, or a later migration re-based the bodies onto a stale source. This must not be reported as a skip.', v_auth_c, v_auth_k;
  END IF;

  -- ⚠️ ARMED ON v_b_live_k. On a database carrying Migration A ALONE,
  -- `authenticated` HOLDING EXECUTE is the CORRECT state — Migration A
  -- deliberately does not revoke it, so the two migrations can merge in sequence
  -- with no window in which connect-a-key is broken. Asserting the post-B state
  -- there would red CI for a database that is exactly where it belongs.
  -- ⛔ THE SKIP IS NARROW: it covers this ONE assertion. Both `anon` negatives
  -- above and both `service_role` positives below stay UNCONDITIONAL — they hold
  -- under Migration A and Migration B alike — so Part 3a can never go inert, and
  -- Part 3a-2 has already reddened every incoherent state before this point.
  IF v_b_live_k THEN
    IF v_auth_k THEN
      RAISE EXCEPTION 'TEST FAILED (Part 3a): authenticated HOLDS EXECUTE on add_wizard_composite_key — Phase 156 / CONNECT-01 withdrew it (migration 20260814120000). A re-GRANT re-opens the direct PostgREST door: any browser session holding an authenticated JWT can POST /rest/v1/rpc/add_wizard_composite_key and mint an attested_venue of its choosing. If no migration did this deliberately, a DROP + CREATE re-granted it silently via pg_default_acl — re-issue the REVOKE in that same migration.';
    END IF;
  ELSE
    RAISE NOTICE 'SKIP (Part 3a, the `authenticated` negative ONLY): migration 20260814120000 (Phase 156 Migration B) is NOT applied to this database — both wizard RPC bodies still declare v_auth_uid, i.e. they are the Migration A (20260813150106) two-arm bodies, under which `authenticated` HOLDING EXECUTE is the CORRECT and intended state. EXACTLY ONE assertion was skipped here: "authenticated must NOT hold EXECUTE on add_wizard_composite_key". Still RUN in this block: the Part 3a-0 connection-role diagnosis, BOTH anon negatives, BOTH service_role positives, and all three Part 3a-2 both-or-neither coherence checks. ⚠️ Parts 3b-ii and 3c-ii below are skipped by the SAME condition and emit their own notices — no other assertion in this file is affected.';
  END IF;

  -- ⛔ THE OUTAGE GUARD — and NOT the "a dropped function would green the
  -- negatives" argument, which is FALSE here and was MEASURED false on
  -- PostgreSQL 16: with the TEXT form of the signature used throughout this file,
  -- has_function_privilege RAISES undefined_function (42883) for a function that
  -- does not exist, it does not return FALSE. Under `psql -v ON_ERROR_STOP=1`
  -- that aborts the file, so a dropped RPC is already caught loudly by the
  -- negatives above.
  --
  -- ⭐ WHAT THE NEGATIVES GENUINELY CANNOT SEE is a REVOKE that went ONE ROLE TOO
  -- FAR: `service_role` losing EXECUTE while anon and authenticated stay
  -- correctly shut out. Every assertion above then reads exactly as intended
  -- while EVERY connect-a-key is broken, because since Phase 156 service_role is
  -- the only role permitted to write a wizard draft and the only role our two
  -- Next routes hold. These POSITIVES are the only things in this file that fail
  -- in that state, which is why their messages name the OUTAGE, not the
  -- privilege.
  IF NOT has_function_privilege('service_role',
       'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3a): CONNECT-A-KEY IS BROKEN — service_role holds no EXECUTE on add_wizard_composite_key. Since 20260814120000 it is the only role that may write one, so every COMPOSITE key add answers 42501. A REVOKE went one role too far, or the function was dropped. Re-GRANT; do not retry.';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)',
       'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3a): CONNECT-A-KEY IS BROKEN — service_role holds no EXECUTE on create_wizard_strategy. Since 20260814120000 it is the only role that may write one, so every SINGLE-KEY connect answers 42501. A REVOKE went one role too far, or the function was dropped. Re-GRANT; do not retry.';
  END IF;

  -- ⛔ STATE-AWARE, AND NOT COSMETICALLY. A fixed "neither anon nor
  -- authenticated holds EXECUTE" printed on a run that SKIPPED the authenticated
  -- negative is a green report of coverage the run did not have — the precise
  -- silent-green shape this phase exists to stop shipping. Say what actually ran.
  IF v_b_live_k THEN
    RAISE NOTICE 'Part 3a OK: neither anon nor authenticated holds EXECUTE on the wizard RPCs, and service_role holds it on both (ALL assertions armed — Migration B is live here).';
  ELSE
    RAISE NOTICE 'Part 3a PASS WITH 1 SKIP: anon holds no EXECUTE on either RPC, service_role holds it on both, and the bodies and grants agree with each other. ⚠️ NOT asserted on this run: that `authenticated` holds no EXECUTE — Migration B (20260814120000) is not applied to this database. See the SKIP notice above.';
  END IF;
END $$;

-- ==========================================================================
-- Parts 1, 2, 3b, 4 — integration: real add_wizard_composite_key /
-- create_wizard_strategy calls. Isolated in a transaction that always rolls
-- back; all ids gen_random_uuid().
-- ==========================================================================
BEGIN;

DO $$
DECLARE
  uid_a       UUID := gen_random_uuid();  -- composite fence tenant
  uid_wrong   UUID := gen_random_uuid();  -- auth-guard mismatch identity
  uid_c       UUID := gen_random_uuid();  -- single-key regression tenant
  uid_d       UUID := gen_random_uuid();  -- 156: service_role-arm tenant
  session_a   UUID := gen_random_uuid();
  session_c   UUID := gen_random_uuid();
  session_d   UUID := gen_random_uuid();  -- 156: service_role single-key session
  session_d2  UUID := gen_random_uuid();  -- 156: service_role composite session
  session_spoof UUID := gen_random_uuid(); -- 156: refused-call session (never minted)
  v_strat_sr  UUID;
  v_key_sr    UUID;
  v_attested  TEXT;
  v_strat1    UUID;
  v_key1      UUID;
  v_strat2    UUID;
  v_key2      UUID;
  v_strat_sk1 UUID;
  v_key_sk1   UUID;
  v_strat_sk2 UUID;
  v_key_sk2   UUID;
  v_api_key   UUID;
  row_cnt     INTEGER;
  row_cnt_before INTEGER;
  raised      BOOLEAN;
  err_msg     TEXT;
  -- Recomputed here rather than carried from the Part 3a block: that is a
  -- SEPARATE `DO` statement, so no variable survives into this one. Part 3a's
  -- both-or-neither checks have already reddened every incoherent state before
  -- this block runs (ON_ERROR_STOP aborts the file), so these two are read here
  -- purely to decide which calls are legal to make.
  c_sig CONSTANT TEXT :=
    'public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text)';
  k_sig CONSTANT TEXT :=
    'public.add_wizard_composite_key(uuid,text,text,text,text,text,text,text,integer,text,uuid)';
  v_b_live    BOOLEAN;
  v_b_live_k  BOOLEAN;
BEGIN
  -- ⛔ COMMENT-STRIPPED, for the reason set out at length in Part 3a-1: the RAW
  -- pg_get_functiondef of create_wizard_strategy MATCHES '%v_auth_uid%' on a
  -- database that carries Migration B, because Migration B's own Trap B comment
  -- explains why the identifier is absent and thereby contains it.
  SELECT regexp_replace(pg_get_functiondef(to_regprocedure(c_sig)), '--[^\n]*', '', 'g')
           NOT LIKE '%v_auth_uid%',
         regexp_replace(pg_get_functiondef(to_regprocedure(k_sig)), '--[^\n]*', '', 'g')
           NOT LIKE '%v_auth_uid%'
    INTO v_b_live, v_b_live_k;

  -- ----- SEED users/profiles (service-role context) -------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-wizcomp-fence-' || uid_a || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'wizcomp fence a', 'test-wizcomp-fence-' || uid_a || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_c, '00000000-0000-0000-0000-000000000000',
          'test-wizcomp-fence-' || uid_c || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_c, 'wizcomp fence c', 'test-wizcomp-fence-' || uid_c || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  -- 156: the service_role-arm tenant. Seeded like the others because the
  -- service_role path still writes REAL rows subject to the same FKs — the arm
  -- skips the ownership CHECK, not the ownership COLUMN.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_d, '00000000-0000-0000-0000-000000000000',
          'test-wizcomp-fence-' || uid_d || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_d, 'wizcomp fence d', 'test-wizcomp-fence-' || uid_d || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  -- ======================================================================
  -- Part 1 — draft fence + Part 2 — ONB-03 proceed
  -- ======================================================================
  -- Service-role-shaped call. (Covers BOTH Part 1 and Part 2 — one claim, two
  -- add_wizard_composite_key calls.)
  --
  -- ⭐ WHY THIS CHANGED IN PHASE 156. This claim used to read
  -- `'role', 'authenticated'`, which drove auth.uid() = uid_a for the body's
  -- ownership comparison. Migration B (20260814120000) gates both RPC bodies on
  -- `auth.role() IS DISTINCT FROM 'service_role'` and no longer reads auth.uid()
  -- at all, so under the old claim these two calls would raise 42501 and Parts 1
  -- and 2 would red for a reason that has nothing to do with the draft fence or
  -- ONB-03 — the behaviours they exist to assert. This is now the way the SERVER
  -- calls: both Next routes hold a service-role client.
  --
  -- ⚠️ `sub` IS RETAINED WHILE PART 3d DELIBERATELY OMITS IT, AND THE TWO ARE NOT
  -- IN CONFLICT — they are asserting different things, so read both before
  -- "harmonising" either. Part 3d presents the EXACT claim shape production
  -- sends (role only; `156-MEASUREMENTS.md` § A2 measured auth.uid() IS NULL for
  -- a real service-role client). This site keeps `sub` so that the pair forms a
  -- control: a service_role caller is admitted WITH a sub here and WITHOUT one
  -- in 3d, which is the positive half of the statement Parts 3b/3c make
  -- negatively — after Phase 156 the gate is decided by the ROLE claim ALONE and
  -- is indifferent to the identity presented alongside it. `sub` is therefore
  -- decorative to the body and load-bearing to the fixture's honesty.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'service_role')::text, true);

  SELECT strategy_id, api_key_id INTO v_strat1, v_key1
    FROM public.add_wizard_composite_key(
      uid_a, 'binance', 'wizcomp key 1',
      'enc1', 'sec1', 'pass1', 'dek1', 'nonce1', 1, 'Composite draft A', session_a);

  SELECT strategy_id, api_key_id INTO v_strat2, v_key2
    FROM public.add_wizard_composite_key(
      uid_a, 'bybit', 'wizcomp key 2',
      'enc2', 'sec2', 'pass2', 'dek2', 'nonce2', 1, 'Composite draft A', session_a);

  -- Part 1a: SAME draft returned for both calls in the session (the fence).
  IF v_strat1 IS NULL OR v_strat1 <> v_strat2 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1a): the two composite adds returned DIFFERENT strategy ids (% vs %) — the (user, session) draft fence is broken', v_strat1, v_strat2;
  END IF;

  -- Part 1b: the composite draft carries a NULL api_key_id (single-key link
  -- never set for a composite — the composite-detection invariant).
  SELECT api_key_id INTO v_api_key FROM public.strategies WHERE id = v_strat1;
  IF v_api_key IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1b): the composite draft strategies.api_key_id is NOT NULL (%) — a composite draft must keep it NULL', v_api_key;
  END IF;

  -- Part 1c: exactly ONE strategies row for this (user, session).
  SELECT count(*) INTO row_cnt
    FROM public.strategies
   WHERE user_id = uid_a AND wizard_session_id = session_a;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1c): % strategies rows for (uid_a, session_a), expected exactly 1', row_cnt;
  END IF;

  -- Part 2a: two DISTINCT api_keys rows — the 2nd KEY proceeded (ONB-03).
  IF v_key1 IS NULL OR v_key2 IS NULL OR v_key1 = v_key2 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2a): the 2nd composite add did NOT mint a distinct api_keys row (% vs %) — ONB-03 per-key add regressed', v_key1, v_key2;
  END IF;

  -- Part 2b: exactly TWO api_keys rows for this user (one per add).
  SELECT count(*) INTO row_cnt FROM public.api_keys WHERE user_id = uid_a;
  IF row_cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2b): % api_keys rows for uid_a, expected 2 (one per composite key add)', row_cnt;
  END IF;

  RAISE NOTICE 'Parts 1-2 OK: draft fenced per (user, session), api_key_id NULL, per-key add proceeds (ONB-03).';

  -- ======================================================================
  -- Part 3b — Phase 156: an `authenticated` caller is REFUSED, whatever
  --           identity it presents
  -- ======================================================================
  -- ⛔⛔ READ THIS BEFORE CHANGING ANYTHING HERE. THIS BLOCK WAS RE-CUT BECAUSE
  -- IT WAS ABOUT TO BECOME A GREEN TEST PINNING A CONTROL THAT NO LONGER EXISTS.
  --
  -- WHAT IT USED TO ASSERT: it presented a DIFFERENT `sub` than `p_user_id` and
  -- required `insufficient_privilege`, naming *cross-user elevation (T-88-03)*.
  -- The thing doing the refusing was the body's `auth.uid() <> p_user_id`
  -- comparison.
  --
  -- WHAT CHANGED: Phase 156 Migration B (20260814120000) DELETES that comparison
  -- from the database. Not relaxes — deletes. `156-MEASUREMENTS.md` § A2 measured
  -- auth.uid() IS NULL for a service-role client, so a comparison kept "for
  -- safety" would be a PERMANENT SILENT NO-OP, which is the `_assert_owner`
  -- shape (20260411144407:300-302) this phase exists to stop reproducing.
  --
  -- ⛔ WHY THE OLD ASSERTION COULD NOT SIMPLY BE LEFT ALONE. It would have kept
  -- PASSING — the new ROLE gate refuses the call before any ownership question
  -- is reached — while the guarantee its message NAMED was gone from the
  -- database. A green test reporting coverage it no longer provides is worse
  -- than a deleted one, because a deleted test is visible and this is not. Making
  -- it pass was never the job; making it still discriminate the thing it names
  -- was, and where that is impossible the honest move is to change what it
  -- names. It is renamed accordingly: this block is no longer a cross-user
  -- elevation test and does not claim to be one.
  --
  -- ⭐ WHERE THE OWNERSHIP BINDING WENT: ENTIRELY TO THE ROUTE. `p_user_id` is
  -- `withAuth`'s getUser()-verified `user.id` (ADR-0022 layer 2), and the GRANT
  -- layer is what makes trusting it sound — only our own server can invoke this
  -- at all now. T-88-03 is therefore FORMERLY ENFORCED HERE; NOW ENFORCED AT THE
  -- ROUTE, and the surviving controls are unit tests, not SQL gates:
  --   * src/app/api/strategies/composite/add-key/route.test.ts —
  --     "156 — p_user_id is withAuth's user.id, and NO request-body field can
  --      reach it"  (the composite twin; Part 3c names the single-key one)
  --   * src/__tests__/phase-156-wizard-rpc-writer-guard.test.ts — CONNECT-02b,
  --     reds if any wizard-RPC call site is bound from a user-scoped client.
  -- ⛔ If either is deleted, NOTHING enforces caller-supplied ownership anywhere.
  --
  -- ⭐ WHAT THIS BLOCK ASSERTS NOW, AND WHY IT IS NOT VACUOUS IN ITS TURN: an
  -- `authenticated` caller is refused (42501) for BOTH a mismatched `sub` AND the
  -- MATCHING one. The matching-sub case (ii) is the discriminating half — it
  -- SUCCEEDED under Migration A (20260813150106), whose `authenticated` arm
  -- admitted exactly a caller whose auth.uid() equalled p_user_id. So unlike the
  -- assertion it replaces, this one distinguishes the post-156 body from the body
  -- shipped one migration earlier, and it fails on a database where the REVOKE
  -- was rolled back or a DROP + CREATE silently re-granted `authenticated`.
  -- Stating it over two `sub` values is also what stops the block being MISREAD,
  -- later, as evidence that cross-user elevation is still checked here.
  SELECT count(*) INTO row_cnt_before FROM public.api_keys WHERE user_id = uid_a;

  -- (i) a MISMATCHED identity. ⛔ This claim KEEPS `'role', 'authenticated'` —
  -- it is a REFUSAL assertion, and re-shaping it to service_role would assert
  -- that the server's own writer is refused, which is the opposite of true.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_wrong::text, 'role', 'authenticated')::text, true);
  raised := FALSE;
  BEGIN
    PERFORM public.add_wizard_composite_key(
      uid_a, 'binance', 'spoofed', 'e', 's', 'p', 'd', 'n', 1, 'spoof', session_a);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3b-i): add_wizard_composite_key ACCEPTED an authenticated caller — the browser tier can POST /rest/v1/rpc/add_wizard_composite_key directly and mint an attested_venue of its choosing. Migration 20260814120000 must refuse every role but service_role.';
  END IF;

  -- (ii) the MATCHING identity — the half that actually discriminates.
  --
  -- ⛔⛔ ARMED, AND THE ARMING SKIPS THE **CALL**, NOT MERELY THE ASSERTION. This
  -- is the one place in this file where that distinction is load-bearing. Under
  -- Migration A this exact call SUCCEEDS — that is what makes it the
  -- discriminating half — so on a Migration-A database it would MINT AN api_keys
  -- ROW, and the zero-row-delta assertion immediately below would then fail too,
  -- reporting "the raise landed after the write" about a call that was never
  -- supposed to have been made. Skipping only the `IF NOT raised` would turn one
  -- honest skip into a spurious second failure.
  -- ⚠️ The delta assertion below stays UNCONDITIONAL and remains meaningful in
  -- both states: with (ii) skipped it still proves (i) minted nothing.
  IF v_b_live_k THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
    raised := FALSE;
    BEGIN
      PERFORM public.add_wizard_composite_key(
        uid_a, 'binance', 'own identity, authenticated', 'e', 's', 'p', 'd', 'n', 1, 'spoof', session_a);
    EXCEPTION WHEN insufficient_privilege THEN
      raised := TRUE; err_msg := SQLERRM;
    END;
    IF NOT raised THEN
      RAISE EXCEPTION 'TEST FAILED (Part 3b-ii): add_wizard_composite_key ACCEPTED an authenticated caller presenting its OWN identity (sub = p_user_id). That is the Migration A (20260813150106) body, whose authenticated arm admitted exactly this call — Migration B (20260814120000) is not applied to this database, or its REVOKE and in-body gate were reverted. Until it is, any browser session can still mint its own attestation.';
    END IF;
  ELSE
    RAISE NOTICE 'SKIP (Part 3b-ii ONLY): migration 20260814120000 is not applied to this database — add_wizard_composite_key still carries the Migration A (20260813150106) two-arm body, whose `authenticated` arm ADMITS a caller whose auth.uid() equals p_user_id. That call is therefore EXPECTED to succeed here, so ONE assertion was skipped: "an authenticated caller presenting its OWN identity is refused". ⛔ The CALL was skipped too, not just the assertion — under Migration A it would mint an api_keys row and make the zero-row-delta check below fail for a second, spurious reason. Part 3b-i (the MISMATCHED identity) RAN and is refused under BOTH bodies, and the row-delta check below RAN over it.';
  END IF;

  -- ⭐ "An error was raised" is the WEAKER claim: a body that raised AFTER its
  -- INSERT satisfies it while a row already exists. Assert the row delta is ZERO
  -- across every refused call actually made above (both, or just 3b-i when
  -- Migration B is not live here).
  SELECT count(*) INTO row_cnt FROM public.api_keys WHERE user_id = uid_a;
  IF row_cnt <> row_cnt_before THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3b): the REFUSED authenticated calls still minted % api_keys row(s) for uid_a — the raise landed after the write', row_cnt - row_cnt_before;
  END IF;

  -- ======================================================================
  -- Part 3c — Phase 156: the SINGLE-KEY twin of Part 3b
  -- ======================================================================
  -- ⭐ WHY THIS EXISTS. Part 3b has guarded add_wizard_composite_key's refusal
  -- since it was written; create_wizard_strategy's IDENTICAL guard had NO
  -- behavioural test anywhere in supabase/tests. Phase 156 restructures that
  -- guard on BOTH functions, so the untested one was about to be edited with no
  -- net under it. That is the one-path-only pattern Phase 153.6 was convened to
  -- end — here applied to the tests rather than the code.
  --
  -- ⛔ RE-CUT WITH PART 3b, IN THE SAME COMMIT, FOR THE SAME REASON. As minted in
  -- PR A this block asserted the `auth.uid() <> p_user_id` refusal and named
  -- *cross-user elevation (T-88-03)*. Migration B (20260814120000) deletes that
  -- comparison, so the assertion would have kept passing via the ROLE gate while
  -- the control it named no longer existed. Leaving it while re-cutting only 3b
  -- would have left PR B a SECOND vacuous green test pinning a deleted control —
  -- the precise instance-not-class defect this phase exists to end, committed by
  -- the plan that names it. Read Part 3b's block above for the full reasoning;
  -- it is not repeated here.
  --
  -- ⭐ T-88-03 IS FORMERLY ENFORCED HERE; NOW ENFORCED AT THE ROUTE. The
  -- surviving single-key control is
  -- src/app/api/strategies/create-with-key/route.test.ts —
  -- "156 — p_user_id is withAuth's user.id, and NO request-body field can reach
  -- it" — plus src/__tests__/phase-156-wizard-rpc-writer-guard.test.ts
  -- (CONNECT-02b). Part 3b names the composite twin of the first.
  --
  -- ⛔ This asserts BEHAVIOUR, not text. Migration B's post-verify (e) greps
  -- pg_get_functiondef, but a post-verify only runs in the migration that
  -- carries it; it does not protect the function from the NEXT migration. This
  -- case runs in the sql-tests CI job on every PR forever.
  -- ⚠️ ELEVEN positional args against the 12-arg signature is LEGAL —
  -- p_venue_account_id defaults NULL, and Part 4a already calls it this way. Do
  -- not "fix" it into an arity mismatch; the 12-arg pin lives at
  -- test_api_keys_venue_identity_uniq.sql:41.
  SELECT count(*) INTO row_cnt_before FROM public.api_keys WHERE user_id = uid_c;

  -- (i) a MISMATCHED identity. ⛔ Keeps `'role', 'authenticated'` — a refusal
  -- assertion, so re-shaping it to service_role would assert the server's own
  -- writer is refused.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_wrong::text, 'role', 'authenticated')::text, true);
  raised := FALSE;
  BEGIN
    PERFORM public.create_wizard_strategy(
      uid_c, 'binance', 'spoofed single', 'e', 's', 'p', 'd', 'n', 1,
      'spoof single', session_spoof);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3c-i): create_wizard_strategy ACCEPTED an authenticated caller — the browser tier can POST /rest/v1/rpc/create_wizard_strategy directly and mint an attested_venue of its choosing. Migration 20260814120000 must refuse every role but service_role. This is the single-key twin of Part 3b-i.';
  END IF;

  -- (ii) the MATCHING identity — the half that actually discriminates, because
  -- Migration A's authenticated arm ADMITTED exactly this call.
  --
  -- ⛔ ARMED, AND THE ARMING SKIPS THE **CALL** — the single-key twin of the
  -- reasoning at Part 3b-ii, and it matters here for one more reason besides.
  -- Under Migration A this call not only mints an api_keys row (breaking the
  -- delta check below), it also creates a strategies draft for
  -- (uid_c, session_spoof); Part 3c-i left none, because it was refused. Making
  -- the call under a body that admits it would leave this file asserting a state
  -- its own fixture manufactured.
  IF v_b_live THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', uid_c::text, 'role', 'authenticated')::text, true);
    raised := FALSE;
    BEGIN
      PERFORM public.create_wizard_strategy(
        uid_c, 'binance', 'own identity, authenticated', 'e', 's', 'p', 'd', 'n', 1,
        'spoof single', session_spoof);
    EXCEPTION WHEN insufficient_privilege THEN
      raised := TRUE; err_msg := SQLERRM;
    END;
    IF NOT raised THEN
      RAISE EXCEPTION 'TEST FAILED (Part 3c-ii): create_wizard_strategy ACCEPTED an authenticated caller presenting its OWN identity (sub = p_user_id). That is the Migration A (20260813150106) body, whose authenticated arm admitted exactly this call — Migration B (20260814120000) is not applied to this database, or its REVOKE and in-body gate were reverted. This is the single-key twin of Part 3b-ii.';
    END IF;
  ELSE
    RAISE NOTICE 'SKIP (Part 3c-ii ONLY): migration 20260814120000 is not applied to this database — create_wizard_strategy still carries the Migration A (20260813150106) two-arm body, whose `authenticated` arm ADMITS a caller whose auth.uid() equals p_user_id. ONE assertion was skipped: "an authenticated caller presenting its OWN identity is refused", the single-key twin of Part 3b-ii. ⛔ The CALL was skipped too — under Migration A it would mint an api_keys row AND a strategies draft for (uid_c, session_spoof), making the row-delta check below fail for a spurious second reason. Part 3c-i (the MISMATCHED identity) RAN and is refused under BOTH bodies.';
  END IF;

  -- ⭐ "An error was raised" is the WEAKER claim. A body that raised AFTER the
  -- INSERT, or that raised from some later statement entirely, satisfies it
  -- while a row already exists. Assert the row delta is ZERO across every
  -- refused call actually made above (both, or just 3c-i when Migration B is not
  -- live here).
  SELECT count(*) INTO row_cnt FROM public.api_keys WHERE user_id = uid_c;
  IF row_cnt <> row_cnt_before THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3c): the REFUSED create_wizard_strategy calls still minted % api_keys row(s) for uid_c — the raise landed after the write', row_cnt - row_cnt_before;
  END IF;

  -- ======================================================================
  -- Part 3d — Phase 156: the service_role arm ACTUALLY WORKS
  -- ======================================================================
  -- ⛔ THE MOST LOAD-BEARING CASE IN THIS FILE, and the one whose absence is
  -- most dangerous. Migration A's post-verify (a) asserts service_role HOLDS
  -- EXECUTE — but `156-MEASUREMENTS.md` § A4 measured that it already did,
  -- inherited from pg_default_acl, so (a) reads TRUE on a database where the
  -- GRANT was never written AND where the in-body arm does not work at all.
  -- Nothing else invokes the function as service_role.
  --
  -- The follow-up migration DELETES the authenticated arm. If the service_role
  -- arm were broken, that migration would break EVERY connect-a-key with no
  -- test having failed. This case is the only thing standing between that and
  -- production.
  --
  -- No 'sub' claim is presented — deliberately. `156-MEASUREMENTS.md` § A2
  -- measured auth.uid() IS NULL for a real service-role client, so a test that
  -- supplied a sub would be testing a shape production never sends.
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);

  -- ⚠️ The refusal is caught and RE-RAISED with this file's own message. Without
  -- the catch, a body lacking the service_role arm raises its OWN
  -- "called without an auth session" (auth.uid() IS NULL under a service-role
  -- caller) and the gate reports the symptom instead of the cause.
  BEGIN
    SELECT strategy_id, api_key_id INTO v_strat_sr, v_key_sr
      FROM public.create_wizard_strategy(
        uid_d, 'binance', 'service-role single', 'enc', 'sec', 'pass', 'dek',
        'nonce', 1, 'SR draft D', session_d);
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3d): create_wizard_strategy REFUSED a service_role caller (%) — the Phase 156 writer arm is absent or broken. The follow-up migration withdraws authenticated EXECUTE, so shipping this would break EVERY connect-a-key.', SQLERRM;
  END;

  IF v_strat_sr IS NULL OR v_key_sr IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3d): create_wizard_strategy returned NULL ids under a service_role caller — the Phase 156 writer arm does not work, and the follow-up migration would break every connect';
  END IF;

  -- The row is owned by p_user_id, which is the ONLY carrier of identity in
  -- this arm (auth.uid() is NULL here). If this ever reads NULL or someone
  -- else's id, the route-bound ownership contract is broken.
  SELECT user_id::text INTO err_msg FROM public.api_keys WHERE id = v_key_sr;
  IF err_msg IS DISTINCT FROM uid_d::text THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3d): the service-role-written api_keys row is owned by %, expected p_user_id % — ownership is route-bound and must be carried verbatim', err_msg, uid_d;
  END IF;

  -- The stamps must survive. They survive because the body runs as its OWNER
  -- (SECURITY DEFINER), NOT because the caller is service_role — if this ever
  -- reads NULL, the scrub trigger is seeing a non-owner writer.
  SELECT attested_venue INTO v_attested FROM public.api_keys WHERE id = v_key_sr;
  IF v_attested IS DISTINCT FROM 'binance' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3d): attested_venue is % under the service_role arm, expected binance — the SECDEF stamp did not survive the scrub trigger', COALESCE(v_attested, '<null>');
  END IF;

  -- The composite twin must accept the same caller. One contract, two entry
  -- points — 153.6 exists because a change landed on only one of them.
  SELECT strategy_id, api_key_id INTO v_strat_sr, v_key_sr
    FROM public.add_wizard_composite_key(
      uid_d, 'bybit', 'service-role composite', 'enc', 'sec', 'pass', 'dek',
      'nonce', 1, 'SR composite D', session_d2);
  IF v_strat_sr IS NULL OR v_key_sr IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3d): add_wizard_composite_key returned NULL ids under a service_role caller — the writer arm landed on only ONE of the two RPCs';
  END IF;

  -- ======================================================================
  -- Part 3e — Phase 156: every OTHER role is REFUSED (the ELSE arm)
  -- ======================================================================
  -- The gate has three outcomes and the third had no test. A gate that admits
  -- everything it does not recognise is not a gate.
  --
  -- (i) A recognised-but-unprivileged role.
  PERFORM set_config('request.jwt.claims',
    json_build_object('role', 'authenticator')::text, true);
  raised := FALSE;
  BEGIN
    PERFORM public.create_wizard_strategy(
      uid_d, 'binance', 'authenticator', 'e', 's', 'p', 'd', 'n', 1,
      'authenticator', session_spoof);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3e-i): create_wizard_strategy accepted a caller whose role is neither authenticated nor service_role — the ELSE arm does not refuse';
  END IF;

  -- (ii) NO claims at all — a direct libpq caller (pg_cron, the Python worker).
  -- auth.role() returns NULL, which matches neither arm and MUST fall to ELSE.
  -- ⭐ This is the fail-CLOSED property. If the gate ever defaulted a NULL role
  -- to "proceed", every unauthenticated database connection would become a
  -- wizard writer.
  PERFORM set_config('request.jwt.claims', NULL, true);
  raised := FALSE;
  BEGIN
    PERFORM public.add_wizard_composite_key(
      uid_d, 'binance', 'no claims', 'e', 's', 'p', 'd', 'n', 1,
      'no claims', session_spoof);
  EXCEPTION WHEN insufficient_privilege THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3e-ii): add_wizard_composite_key accepted a caller presenting NO jwt claims — the gate does not fail closed';
  END IF;

  RAISE NOTICE 'Parts 3c-3e OK (156): single-key cross-user guard fires, the service_role writer arm works on BOTH RPCs with stamps intact, and every other role is refused.';

  -- ======================================================================
  -- Part 4 — single-key regression: create_wizard_strategy UNCHANGED
  -- ======================================================================
  -- The single-key F6 path must still (a) set strategies.api_key_id and (b)
  -- fence per (user, session). This is the SC-4 behavioral canary — the
  -- composite migration must not have altered create_wizard_strategy.
  --
  -- Service-role-shaped call. (Covers BOTH Part 4a and Part 4b — one claim, two
  -- create_wizard_strategy calls.) Changed from `'role', 'authenticated'` for
  -- the same reason as the Parts 1+2 claim above: after Phase 156 Migration B
  -- (20260814120000) the body gates on `auth.role() = 'service_role'` and never
  -- reads auth.uid(), so the old claim would raise 42501 and this SC-4 canary
  -- would red for an authorization reason instead of reporting on the F6 fence
  -- it exists to watch. `sub` is retained — see the Parts 1+2 claim for why the
  -- retention here and Part 3d's deliberate omission are complementary rather
  -- than contradictory.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_c::text, 'role', 'service_role')::text, true);

  SELECT strategy_id, api_key_id INTO v_strat_sk1, v_key_sk1
    FROM public.create_wizard_strategy(
      uid_c, 'binance', 'single key', 'enc', 'sec', 'pass', 'dek', 'nonce', 1,
      'Single draft C', session_c);

  IF v_key_sk1 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4a): create_wizard_strategy returned a NULL api_key_id — single-key path broken';
  END IF;
  SELECT api_key_id INTO v_api_key FROM public.strategies WHERE id = v_strat_sk1;
  IF v_api_key IS NULL OR v_api_key <> v_key_sk1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4a): the single-key strategies.api_key_id is not set to the created key (% vs %) — SC-4 broken', v_api_key, v_key_sk1;
  END IF;

  -- Re-call same (user, session): the F6 fence must replay the SAME draft.
  SELECT strategy_id, api_key_id INTO v_strat_sk2, v_key_sk2
    FROM public.create_wizard_strategy(
      uid_c, 'binance', 'single key retry', 'enc', 'sec', 'pass', 'dek', 'nonce', 1,
      'Single draft C', session_c);
  IF v_strat_sk2 <> v_strat_sk1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4b): create_wizard_strategy no longer fences per (user, session) (% vs %) — F6 idempotency regressed', v_strat_sk1, v_strat_sk2;
  END IF;
  SELECT count(*) INTO row_cnt
    FROM public.strategies
   WHERE user_id = uid_c AND wizard_session_id = session_c;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4b): % single-key strategies rows for (uid_c, session_c), expected exactly 1 — F6 fence regressed', row_cnt;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  -- ⛔ STATE-AWARE. The unconditional wording claims the gate "refuses
  -- authenticated for BOTH matching and mismatched identities" — which is FALSE
  -- of a run in which the matching-identity halves were skipped. A summary line
  -- that overstates a skipped run is the silent-green failure this phase exists
  -- to end, printed by the file's own last statement.
  IF v_b_live AND v_b_live_k THEN
    RAISE NOTICE 'test_wizard_composite_fence: ALL PASS (composite draft fenced, per-key add proceeds, the service_role-only role gate refuses authenticated for BOTH matching and mismatched identities and fails closed for every other role, and the single-key path is unchanged).';
  ELSE
    RAISE NOTICE 'test_wizard_composite_fence: PASS WITH 3 SKIPS (composite draft fenced, per-key add proceeds, the role gate refuses MISMATCHED authenticated identities on both RPCs and fails closed for every other role, the service_role writer arm works on both RPCs with stamps intact, and the single-key path is unchanged). ⚠️ NOT asserted on this run: Part 3a''s `authenticated`-holds-no-EXECUTE negative, Part 3b-ii and Part 3c-ii (the MATCHING-identity refusals) — migration 20260814120000 is not applied to this database, and under the Migration A body those calls are ADMITTED by design. See the three SKIP notices above.';
  END IF;
END
$$;

ROLLBACK;
