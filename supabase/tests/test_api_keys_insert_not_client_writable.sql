-- Test: api_keys INSERT is a SERVER verb, and only the audited writers can use it.
--
-- Phase 160 / RANK-03, plan 160-03. Sibling of
-- test_api_keys_exchange_not_user_writable.sql — same table, same discipline,
-- ONE VERB OVER. That file guards UPDATE (and, at 5c, asserts the client INSERT
-- path stays OPEN). This one guards INSERT, and its armed half asserts the
-- opposite of 5c on purpose. Read the collision note below before touching
-- either.
--
-- Background
-- ----------
-- `api_keys.exchange` decides how the whole downstream stack annualizes a
-- track record (√365 crypto vs √252 traditional) and whether finalize-wizard
-- runs the submit-time scope-broadening probe. Until Phase 160 that column was
-- written by the BROWSER: three separate components composed the INSERT
-- themselves (ApiKeyManager, StrategyForm, and — the one 160-CONTEXT.md missed
-- and RESEARCH found — AllocatorExchangeManager:591). A browser-composed row
-- can name any venue it likes.
--
-- Phase 160 moves the writer server-side: POST /api/keys/validate-and-encrypt
-- with `persist: true` stamps BOTH `exchange` and `attested_venue` from the one
-- venue binding it actually authenticated the credentials against, using a
-- `service_role` client. Plan 160-05 then WITHDRAWS the browser's INSERT grant.
--
-- ⛔ WHAT IS NOT CLAIMED, AND DO NOT UPGRADE IT. Not "the venue cannot be
-- forged". Any server route holding a service-role client can still pass any
-- uid and any venue string — the standing service_role trust boundary
-- (ADR-0001/ADR-0003), unchanged by this phase. What changes is exactly this:
-- "any browser session can forge an attestation" becomes "only our own server
-- code can". The stronger reading would license deleting the probe gate.
--
-- ⭐ PHASE 243 DBBACKSTOP, plan 10 (DBACC-02, founder decision 2026-11-26) NARROWED THAT
-- TRUST BOUNDARY. A BEFORE INSERT fence (migration 20261127220100) now refuses every
-- insert whose current_user is not postgres or supabase_admin, so a direct service_role
-- INSERT is REFUSED (42501) and the only writers left are the three postgres-owned
-- SECURITY DEFINER functions insert_api_key, create_wizard_strategy and
-- add_wizard_composite_key. The writer of the validate-and-encrypt route is
-- insert_api_key, which stamps attested_venue from the exchange. The former arm 2 (a
-- direct service_role INSERT retaining its attestation) described a door that is now
-- shut, so it is replaced by arms 2s, 2a, 2b, 2c and 2w below.
--
-- Asserted invariants
-- -------------------
--   1. POSITIVE (ALWAYS ACTIVE): the owner's authenticated session can still
--      SELECT its own row through the migration-027 column allowlist. This is
--      the anti-vacuity control for everything below — without it, a negative
--      assertion "passes" for a session that could not see the row at all.
--   2. (PHASE 243, plan 10, replaces the Phase 160 arm 2.) THE INSERT FENCE, in
--      seven arms, file order 1, 3, 2s, 2a, 2b, 2c, 2w, 2w-q, 2w-m, then the rest:
--        2s  STRUCTURAL CONTROL: exactly one trigger api_keys_insert_writer_fence,
--            tgtype EQUAL to 7 (BEFORE INSERT ROW), enabled, over a function that
--            is not SECURITY DEFINER. Asserted BEFORE 2a, which means nothing
--            without it.
--        2a  a direct INSERT under SET ROLE service_role is refused 42501, with
--            the fence's own message, and mints no row.
--        2b  2a's anti-vacuity positive: the audited writer insert_api_key still
--            inserts an attested row when a client role (service_role, the role
--            PostgREST runs the route as) calls it. "The door is shut" is
--            indistinguishable from "connect-a-key is broken" without it.
--        2c  DENY BY DEFAULT: a role the fence has never heard of is refused too.
--        2w  THE WRITER SET: the functions whose comment-stripped definition
--            (pg_get_functiondef, so BEGIN ATOMIC bodies are read) inserts into
--            api_keys are exactly {add_wizard_composite_key,
--            create_wizard_strategy, insert_api_key}. ⚠️ RECORDED LIMIT: the arm
--            cannot see dynamic SQL (EXECUTE format(...)) or an inserter written
--            in a language other than SQL or plpgsql. The fence refuses such a
--            function only unless postgres owns it, and every migration-created
--            function is postgres-owned, so a postgres-owned SECURITY DEFINER
--            function invisible to this arm PASSES the fence.
--        2w-q the same set read in every other spelling (quoted identifiers, ONLY,
--            MERGE INTO) must equal 2w's plain-spelling set.
--        2w-m THE WRITERS' MODE AND OWNER: each of those three functions is SECURITY
--            DEFINER and owned by postgres. That pair is what makes the fence admit
--            them (current_user inside a DEFINER body is the owner), so a writer
--            re-declared SECURITY INVOKER or re-owned outside the allow-list would
--            see current_user = service_role and refuse every wizard connect, and no
--            other arm calls create_wizard_strategy or add_wizard_composite_key as a
--            client role. Asserted as a (name, prosecdef, owner) set.
--   3. POSITIVE (ALWAYS ACTIVE): the scrub trigger is present, ENABLED, and
--      SECURITY INVOKER. The scrub trigger is now defence in depth behind the
--      fence: it still scrubs a client-supplied attestation on the one path a
--      client role can reach it (see test_api_keys_exchange_not_user_writable.sql
--      assertion 5c's scrub half). Re-declared SECURITY DEFINER it would be a
--      silent no-op because current_user becomes the function's owner
--      (20260811210000:499-506 documents that exact trap, and the identical
--      one that made prevent_profile_role_change inert).
--   4. POSITIVE (ALWAYS ACTIVE): the owner can still DELETE its own row. THE
--      CANARY for plan 160-05 (D-05): the REVOKE must be INSERT-only. DELETE is
--      a live client path in ApiKeyManager and AllocatorExchangeManager, and an
--      over-broad REVOKE breaks disconnect-a-key for every user. Green before
--      AND after the REVOKE, by design.
--   5. NEGATIVE (STATE-ADAPTIVE — see the gate): `authenticated` cannot INSERT.
--      Asserted TWO ways, because "an error was raised" is the weaker claim:
--      the statement must be refused with SQLSTATE 42501 EXACTLY (any other
--      sqlstate means it was blocked for the wrong reason and this assertion is
--      not testing the grant), AND the user's api_keys row count must be
--      unchanged.
--   6. NEGATIVE (STATE-ADAPTIVE): the ACL itself — neither `authenticated` nor
--      `anon` holds INSERT, while `authenticated` still holds DELETE. Since Phase 243
--      plan 10 the anti-vacuity positive that distinguishes "the browser's door is
--      shut" from "connect-a-key is broken for everybody" is arm 2b, which calls the
--      audited writer. A service_role INSERT grant is NOT asserted here: the fence
--      refuses every service_role INSERT and the writers' own INSERT is checked
--      against their owner (postgres), so that grant enables no path.
--
-- The gate, and why it is a comment marker
-- ----------------------------------------
-- Phase 160 deploys in TWO landings (D-06): PR-1 ships the TypeScript that
-- stops inserting, PR-2 ships the REVOKE. This file lands in PR-1, so its
-- negative half MUST be dormant until PR-2 applies — otherwise every open PR
-- reds `sql-tests` for a state the database is legitimately in (Pitfall 11).
--
-- The gate is the COLUMN COMMENT on `public.api_keys.exchange`, tested for the
-- marker substring `revoke_api_keys_insert`, which the plan-05 migration is
-- contractually bound to append. The choice follows the sibling file's MEASURED
-- reasoning, and the slug matters:
--
--   * NOT the privilege bit itself. A gate keyed on
--     has_table_privilege(...,'INSERT') would be DISARMED BY THE REGRESSION IT
--     GUARDS: re-granting INSERT would flip the gate to SKIP instead of to
--     FAILURE. A gate must not be disarmable by removing what it guards.
--   * A SLUG, not a timestamp. The migration's UTC filename is not known when
--     this file is written, and pinning a guessed one would leave the negatives
--     permanently un-armed and silently green.
--
-- ⭐ AND THE MARKER IS CROSS-CHECKED AGAINST THE ACL, in the direction that
-- bites. The marker is prose; the privilege is state. A database whose
-- `authenticated` role has LOST INSERT but whose comment lacks the marker would
-- SKIP assertions 5 and 6 with exit code 0 — green CI, zero coverage, and
-- nobody looking. That cross-check RAISES instead. Believe the ACL.
--
-- ⚠️ COLLISION TO RESOLVE IN PLAN 160-05 — MEASURED AT HEAD, NOT PREDICTED.
-- test_api_keys_exchange_not_user_writable.sql assertion 5c (:450-455) drives a
-- DELETE-then-re-INSERT as `authenticated` and RAISES if the re-INSERT is
-- refused ("153.6 D-02/D-03 keep this path open on purpose... A refusal here
-- means connect-a-key is broken"). That premise is exactly what plan 160-05
-- reverses. 5c will HARD-FAIL the moment the REVOKE lands, and it is NOT
-- fixable from this file. Plan 160-05 must make 5c state-adaptive on the SAME
-- marker in the SAME commit as the migration. This file deliberately does not
-- touch the sibling.
--
-- pgTAP is not set up in this project (CLAUDE.md / Lane B), so assertions RAISE
-- EXCEPTION on failure; a clean run prints NOTICEs only. Run with
-- `psql -v ON_ERROR_STOP=1`. CI auto-discovers supabase/tests/test_*.sql.
--
-- Run order: AFTER 20260811210000 (the attested_venue column + scrub trigger), and, since
-- Phase 243 plan 10, AFTER 20261127120100 (the audited writer insert_api_key) with the
-- fence migration 20261127220100 LAST in the apply list, so scripts/sql-gate-subset.mjs
-- selects this gate on a push that changes the fence.
-- The whole test rolls back.
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, REDUNDER-BACKFILL). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ THE APPLY LIST IS SIZED BY THE `SKIP (5,6)` NOTICE. It carries
-- 20260823120000, the REVOKE this file arms on, so nothing skips — MEASURED
-- 2026-09-04, the baseline prints zero SKIP lines and assertions 1, 3, 2, 5, 6
-- and 4 all run. That migration's pre-flight census refuses to apply on an
-- unidentified database, hence the seed stand-in
-- 25-fixture-api-keys-e2e-census-seed.sql just ahead of it.
-- ⚠️ 20260405061912 is in the list because assertions 1 and 4 are ROW-filter
-- claims: `api_keys_owner` is what can make the owner's own row unreachable
-- without raising. Withdrawing SELECT or DELETE instead aborts with a bare
-- `permission denied for table api_keys` — no `TEST FAILED (…)`, scored
-- NO-IDENTITY (and assertion 1 wraps that case in its own OUTAGE raise, which
-- is non-idiom too).
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","supabase/migrations/20260405061912_rls_policies.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260810120000_lock_api_keys_exchange_column.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql","supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql","scripts/pg-lane/fixtures/25-fixture-api-keys-e2e-census-seed.sql","supabase/migrations/20260823120000_revoke_api_keys_insert.sql","supabase/migrations/20261123180000_api_keys_venue_server.sql","supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql","supabase/migrations/20261127220100_api_keys_insert_fence.sql"]}

BEGIN;

DO $$
DECLARE
  v_uid          uuid := gen_random_uuid();
  v_key          uuid := gen_random_uuid();
  v_key_a1       uuid;
  v_key_probe    uuid := gen_random_uuid();
  v_fence_n      int;
  v_fence_type   int;
  v_fence_secdef boolean;
  v_writers      text;
  v_writers_want CONSTANT text := 'add_wizard_composite_key, create_wizard_strategy, insert_api_key';
  v_writers_any  text;
  v_writer_modes text;
  v_modes_want   CONSTANT text := 'add_wizard_composite_key:true:postgres, create_wizard_strategy:true:postgres, insert_api_key:true:postgres';
  v_user_id      uuid;
  v_exch         text;
  v_key_denied   uuid := gen_random_uuid();
  v_seen         text;
  v_attested     text;
  v_deleted      int;
  v_raised       boolean;
  v_sqlstate     text;
  v_err          text;
  v_rows_before  int;
  v_rows_after   int;
  -- The plan-05 arming marker. Spelled ONCE, here, and pinned in
  -- 160-03-PLAN.md's key_links so the migration that must stamp it and the
  -- gate that must read it cannot drift apart silently.
  v_marker    CONSTANT text := 'revoke_api_keys_insert';
  v_revoke_live  boolean;
  -- Read from the ACL, never from the comment. This is the marker's INDEPENDENT
  -- second source (see the header's cross-check note).
  v_insert_revoked boolean;
  -- text, not char: pg_trigger.tgenabled is the internal `"char"` type, which is
  -- NOT the same type as character(1). An explicit ::text keeps the assignment
  -- and the comparison below unambiguous.
  v_trigger_enabled text;
  v_trigger_secdef  boolean;
BEGIN
  -- ---- fixture (seeded as the migration/owner role, not as the client) ------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at, raw_user_meta_data)
  VALUES (v_uid, '00000000-0000-0000-0000-000000000000',
          'rank03-' || v_uid::text || '@quantalyze.test', now(), now(),
          '{"role":"manager"}'::jsonb);
  INSERT INTO public.profiles (id, display_name)
  VALUES (v_uid, 'rank03-owner') ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
  VALUES (v_key, v_uid, 'binance', 'rank03-key', 'x');

  -- Forge the JWT sub so auth.uid() = v_uid (the api_keys_owner row predicate
  -- passes), then act as the authenticated role — exactly what a browser
  -- session holding this user's own JWT can do through PostgREST.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
                     true);

  -- ---- (1) POSITIVE: the owner's session really can see its own row ---------
  -- Wrapped for a measured reason (the Phase 160 arm 2 had the same shape): an over-broad
  -- REVOKE that took SELECT as well kills this statement as a raw
  -- `permission denied`, with no diagnosis. The two failures are distinct —
  -- the grant is gone, versus the grant is intact but RLS hides the row — and
  -- RED-UNDER: narrow `api_keys_owner`'s USING clause in migration
  --            20260405061912 so the owner's own row stops matching. ⚠️ It has
  --            to be the ROW filter: this assertion's own OUTAGE branch catches
  --            a withdrawn SELECT grant first, and that branch is NOT in the
  --            `TEST FAILED (…)` idiom, so a grant-shaped mutation scores
  --            NO-IDENTITY (MEASURED 2026-09-04).
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20260405061912_rls_policies.sql","find":"CREATE POLICY api_keys_owner ON api_keys FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());","replace":"CREATE POLICY api_keys_owner ON api_keys FOR ALL USING (false) WITH CHECK (user_id = auth.uid());","occurrences":1}]}
  -- an operator needs to be told which.
  SET LOCAL ROLE authenticated;
  v_err := NULL;
  BEGIN
    SELECT exchange INTO v_seen FROM public.api_keys WHERE id = v_key;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION
      'OUTAGE (1): authenticated cannot SELECT public.api_keys at all (%). The plan-05 REVOKE was meant to be INSERT-ONLY (D-05) and it took the read grant with it — the key list, the sync pills and the disconnect flow are all broken for every user. REMEDY: re-issue the migration-027 column allowlist GRANT SELECT (...) ON public.api_keys TO authenticated;',
      v_err;
  END IF;
  IF v_seen IS DISTINCT FROM 'binance' THEN
    RAISE EXCEPTION
      'TEST FAILED (1): the owner''s authenticated session holds SELECT but cannot see its own api_keys row (got %) — the api_keys_owner RLS predicate no longer matches auth.uid(). Every assertion below would pass vacuously.',
      v_seen;
  END IF;
  RAISE NOTICE 'Assertion 1 OK: owner session reads its own api_keys row (anti-vacuity control).';

  -- ---- (3) STRUCTURAL CONTROL for the scrub trigger, asserted BEFORE the fence arms --
  -- Since Phase 243 plan 10 this is defence in depth behind the insert fence (2s to 2w
  -- below): the one client-role INSERT that still reaches the scrub trigger is the
  -- gated probe in test_api_keys_exchange_not_user_writable.sql 5c, and a scrub trigger
  -- that stopped scrubbing would pass every arm of this file. Deliberately ordered ahead
  -- of the fence arms, and a control that runs after the thing it controls invites the
  -- reader to treat it as an afterthought.
  -- RED-UNDER: flip `scrub_client_supplied_attested_venue` to SECURITY DEFINER
  --            in migration 20260811210000 — the exact trap that migration's
  --            own header documents at :519-524. Under DEFINER `current_user`
  --            is the function's owner, the privileged-caller branch always
  --            wins, and the trigger becomes a silent no-op that scrubs
  --            nothing for any client role.
  --            ⚠️ The needle spans the two lines above the modifier because the
  --            bare token `SECURITY INVOKER` occurs 7x in that migration.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20260811210000_api_keys_attested_venue.sql","find":"-- (20260810120000:110-116). Do not change this line.\nSECURITY INVOKER\nSET search_path = public, pg_catalog","replace":"-- (20260810120000:110-116). Do not change this line.\nSECURITY DEFINER\nSET search_path = public, pg_catalog","occurrences":1}]}
  SELECT t.tgenabled::text, p.prosecdef
    INTO v_trigger_enabled, v_trigger_secdef
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.api_keys'::regclass
     AND t.tgname  = 'api_keys_scrub_attested_venue'
     AND NOT t.tgisinternal;

  IF v_trigger_enabled IS NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (3): the api_keys_scrub_attested_venue BEFORE INSERT trigger is GONE. With nothing scrubbing anything, a client-supplied attested_venue persists for any client-role INSERT (the one reachable path is the 5c scrub half in test_api_keys_exchange_not_user_writable.sql). Restore the trigger from 20260811210000.';
  END IF;
  IF v_trigger_enabled <> 'O' THEN
    RAISE EXCEPTION
      'TEST FAILED (3): api_keys_scrub_attested_venue exists but tgenabled is % (expected O = enabled on origin). A DISABLED trigger scrubs nothing, so a client-supplied attested_venue would persist.',
      v_trigger_enabled;
  END IF;
  IF v_trigger_secdef THEN
    RAISE EXCEPTION
      'TEST FAILED (3): scrub_client_supplied_attested_venue is SECURITY DEFINER. Under DEFINER, current_user is the function''s OWNER, so its privileged-caller check ALWAYS passes and the trigger is a SILENT NO-OP — the exact trap 20260811210000:499-506 documents, and the one that made prevent_profile_role_change inert. It must be SECURITY INVOKER. Do not "fix" this by deleting the assertion.';
  END IF;
  RAISE NOTICE 'Assertion 3 OK: the scrub trigger is present, enabled, and SECURITY INVOKER (defence in depth behind the insert fence).';

  -- ---- (2s) STRUCTURAL CONTROL for the fence arms, asserted BEFORE them ---------
  -- Phase 243 DBBACKSTOP plan 10. Deliberately ordered ahead of 2a for the reason arm 3
  -- is ordered ahead of the old arm 2: a refused INSERT proves the fence only if the
  -- fence is the thing that exists, is enabled, and fires BEFORE INSERT FOR EACH ROW.
  -- tgtype is asserted EQUAL to 7 (ROW 1 + BEFORE 2 + INSERT 4), not tested with a mask:
  -- a trigger narrowed to a statement trigger or widened to other events changes the
  -- value, and an equality is the only form that misses neither (lint rule R4).
  -- RED-UNDER: disable the fence trigger (ALTER TABLE ... DISABLE TRIGGER). A disabled
  --            trigger fires for nobody, so 2a's refusal would not happen at all; this
  --            structural arm names the cause first.
  -- RED-UNDER-M: {"arm":"2s","apply":[{"kind":"sql","stmt":"ALTER TABLE public.api_keys DISABLE TRIGGER api_keys_insert_writer_fence"}]}
  SELECT count(*) INTO v_fence_n
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.api_keys'::regclass
     AND t.tgname  = 'api_keys_insert_writer_fence'
     AND NOT t.tgisinternal;
  IF v_fence_n <> 1 THEN
    RAISE EXCEPTION
      'TEST FAILED (2s): expected exactly one api_keys_insert_writer_fence trigger on public.api_keys, found %. Without the fence a direct service_role INSERT mints any row under any user_id (DBACC-02). Restore it from 20261127220100.',
      v_fence_n;
  END IF;
  SELECT t.tgtype::int, t.tgenabled::text, p.prosecdef
    INTO v_fence_type, v_trigger_enabled, v_fence_secdef
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.api_keys'::regclass
     AND t.tgname  = 'api_keys_insert_writer_fence'
     AND NOT t.tgisinternal;
  IF v_trigger_enabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION
      'TEST FAILED (2s): api_keys_insert_writer_fence exists but tgenabled is % (expected O = enabled on origin). A disabled fence refuses nobody.',
      v_trigger_enabled;
  END IF;
  IF v_fence_type <> 7 THEN
    RAISE EXCEPTION
      'TEST FAILED (2s): api_keys_insert_writer_fence has tgtype % (expected 7 = BEFORE INSERT FOR EACH ROW). A statement-level, AFTER or wider trigger does not fence every row before it lands.',
      v_fence_type;
  END IF;
  IF v_fence_secdef THEN
    RAISE EXCEPTION
      'TEST FAILED (2s): enforce_api_keys_insert_writer_fence is SECURITY DEFINER. Under DEFINER, current_user is the function''s OWNER, so its allow-list ALWAYS passes and the fence admits every caller, the same silent no-op trap arm 3 guards for the scrub trigger. It must be SECURITY INVOKER.';
  END IF;
  RAISE NOTICE 'Assertion 2s OK: the insert fence is present, enabled, BEFORE INSERT ROW (tgtype 7) and SECURITY INVOKER (structural control for 2a, 2b, 2c).';

  -- ---- (2a) NEGATIVE: a direct service_role INSERT is REFUSED ---------------
  -- This REPLACES the Phase 160 arm 2, which asserted the opposite on purpose (a direct
  -- service_role INSERT retained its attestation). DBACC-02 shut that door: the admin
  -- client can no longer mint an api_keys row under a request-supplied user_id. The
  -- handler records SQLSTATE and message only and every assertion runs after RESET ROLE
  -- (lint rule R1): a probe inside the handler would read the state its own rollback
  -- restored.
  -- RED-UNDER: widen the fence's allow-list test so it passes everyone
  --            (`IF TRUE OR current_user IN (...)`), as if the trigger body were
  --            neutered. 2s still passes (the trigger is intact), so 2a names it first.
  -- RED-UNDER-M: {"arm":"2a","apply":[{"kind":"edit","file":"supabase/migrations/20261127220100_api_keys_insert_fence.sql","find":"IF current_user IN ('postgres', 'supabase_admin') THEN","replace":"IF TRUE OR current_user IN ('postgres', 'supabase_admin') THEN","occurrences":1}]}
  SELECT count(*) INTO v_rows_before FROM public.api_keys WHERE user_id = v_uid;
  SET LOCAL ROLE service_role;
  v_raised := false;
  BEGIN
    INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted, attested_venue)
    VALUES (v_key_denied, v_uid, 'deribit', 'fence-2a', 'x', 'deribit');
  EXCEPTION WHEN OTHERS THEN
    v_raised   := true;
    v_sqlstate := SQLSTATE;
    v_err      := SQLERRM;
  END;
  RESET ROLE;
  SELECT count(*) INTO v_rows_after FROM public.api_keys WHERE user_id = v_uid;

  IF NOT v_raised THEN
    RAISE EXCEPTION
      'TEST FAILED (2a): a direct service_role INSERT into api_keys SUCCEEDED. The insert fence refused nobody, so any admin-client route can mint a key under a request-supplied user_id (DBACC-02). Only the audited writer functions may insert.';
  END IF;
  IF v_sqlstate <> '42501' THEN
    RAISE EXCEPTION
      'TEST FAILED (2a): the direct service_role INSERT was refused with SQLSTATE % (%) rather than 42501 insufficient_privilege, so it was blocked for another reason (a CHECK, a NOT NULL, a privilege) and 2a is not testing the fence.',
      v_sqlstate, v_err;
  END IF;
  IF v_err NOT LIKE 'api_keys: INSERT refused for role service_role%' THEN
    RAISE EXCEPTION
      'TEST FAILED (2a): the direct service_role INSERT was refused with 42501 but with "%" rather than the fence''s own message naming the role, so another layer refused it and the fence is not what is being tested.',
      v_err;
  END IF;
  IF v_rows_after <> v_rows_before THEN
    RAISE EXCEPTION
      'TEST FAILED (2a): the refused service_role INSERT still changed this user''s api_keys row count (% -> %). A row minted anyway is the actual harm.',
      v_rows_before, v_rows_after;
  END IF;
  RAISE NOTICE 'Assertion 2a OK: a direct service_role INSERT is refused 42501 by the fence and mints no row.';

  -- ---- (2b) POSITIVE, 2a's anti-vacuity: the audited writer STILL INSERTS ------
  -- The production shape: PostgREST runs the request as SET ROLE service_role and the
  -- route calls insert_api_key. The writer is a postgres-owned SECURITY DEFINER function,
  -- so inside it current_user is postgres and the fence admits the row. If the fence
  -- also refused the writer, every connect-a-key would be dead, and 2a would still pass.
  -- The claims carry role service_role the way test_insert_api_key_rpc.sql arm R1
  -- satisfies the RPC's auth.role() gate, and are put back to the owner's authenticated
  -- claims afterwards because arms 4 and 5 act as the owner.
  -- RED-UNDER: make the fence refuse the writer when a client role calls it (admit only
  --            sessions whose `role` setting is `none`). The file's own fixture inserts
  --            run with role `none` and still pass, so this cannot red the fixture
  --            before 2b. ⛔ Do not model this as "refuse postgres outright": the
  --            fixture seeds api_keys as postgres before any arm, so that twin dies
  --            unnamed.
  -- RED-UNDER-M: {"arm":"2b","apply":[{"kind":"edit","file":"supabase/migrations/20261127220100_api_keys_insert_fence.sql","find":"IF current_user IN ('postgres', 'supabase_admin') THEN","replace":"IF current_user IN ('postgres', 'supabase_admin') AND current_setting('role') = 'none' THEN","occurrences":1}]}
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  v_err := NULL;
  BEGIN
    v_key_a1 := public.insert_api_key(v_uid, 'deribit', 'fence-2b', 'x');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
                     true);

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION
      'TEST FAILED (2b): the audited writer insert_api_key was REFUSED under the fence when service_role called it (%). Every connect-a-key is broken for every user: the fence must admit an insert made inside a postgres-owned SECURITY DEFINER writer.',
      v_err;
  END IF;
  SELECT user_id, exchange, attested_venue INTO v_user_id, v_exch, v_attested
    FROM public.api_keys WHERE id = v_key_a1;
  IF v_user_id IS DISTINCT FROM v_uid OR v_exch IS DISTINCT FROM 'deribit' THEN
    RAISE EXCEPTION
      'TEST FAILED (2b): insert_api_key returned % but the stored row has user_id % and exchange % (expected the owner and deribit): the writer did not land the row it reported.',
      v_key_a1, v_user_id, v_exch;
  END IF;
  IF v_attested IS DISTINCT FROM v_exch THEN
    RAISE EXCEPTION
      'TEST FAILED (2b): the writer''s row carries attested_venue % instead of its exchange (%). Under the fence the writer must still be attested: its INSERT runs as postgres, so the scrub trigger admits the value it stamps.',
      v_attested, v_exch;
  END IF;
  RAISE NOTICE 'Assertion 2b OK: the audited writer inserts an attested row under the fence when service_role calls it (the production shape).';

  -- ---- (2c) DENY BY DEFAULT: a role the fence has never heard of is refused -----
  -- The probe role is created inside this rolled-back transaction, given exactly what a
  -- caller needs to reach the trigger (USAGE on the schema, INSERT on the table), and the
  -- current user is made a member so a non-superuser postgres (the local stack's image)
  -- may SET ROLE to it. ⛔ THE MEMBERSHIP IS GRANTED TO THE USER BY NAME (format %I), NEVER
  -- WITH THE `CURRENT_USER` KEYWORD: MEASURED 2026-11-27 on the local stack's
  -- PostgreSQL 17.6.1.113 image, `GRANT <role> TO CURRENT_USER` segfaults the backend
  -- (signal 11, component not isolated) and every later file of the corpus fails
  -- `psql exited 2` while the server recovers; the same GRANT to the role's name is fine.
  -- RLS's WITH CHECK runs AFTER the BEFORE triggers, and the owner's claims below would
  -- pass it, so a refusal carrying the fence's message names which layer refused.
  -- RED-UNDER: turn the allow-list into the deny-list form (`NOT IN (anon,
  --            authenticated, service_role)`), which admits any role created later. The
  --            three named roles are still refused, so 2a and 2b stay green and 2c is
  --            the first failure.
  -- RED-UNDER-M: {"arm":"2c","apply":[{"kind":"edit","file":"supabase/migrations/20261127220100_api_keys_insert_fence.sql","find":"IF current_user IN ('postgres', 'supabase_admin') THEN","replace":"IF current_user NOT IN ('anon', 'authenticated', 'service_role') THEN","occurrences":1}]}
  EXECUTE 'CREATE ROLE zz_dbbackstop_fence_probe NOLOGIN';
  EXECUTE 'GRANT USAGE ON SCHEMA public TO zz_dbbackstop_fence_probe';
  EXECUTE 'GRANT INSERT ON public.api_keys TO zz_dbbackstop_fence_probe';
  EXECUTE format('GRANT %I TO %I', 'zz_dbbackstop_fence_probe', current_user);
  SELECT count(*) INTO v_rows_before FROM public.api_keys WHERE user_id = v_uid;
  SET LOCAL ROLE zz_dbbackstop_fence_probe;
  v_raised := false;
  BEGIN
    INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_key_probe, v_uid, 'binance', 'fence-2c', 'x');
  EXCEPTION WHEN OTHERS THEN
    v_raised   := true;
    v_sqlstate := SQLSTATE;
    v_err      := SQLERRM;
  END;
  RESET ROLE;
  SELECT count(*) INTO v_rows_after FROM public.api_keys WHERE user_id = v_uid;

  IF NOT v_raised THEN
    RAISE EXCEPTION
      'TEST FAILED (2c): an INSERT by a role the fence has never heard of SUCCEEDED. The fence is a deny-list, not an allow-list, so any role created later can mint api_keys rows (DBACC-02).';
  END IF;
  IF v_sqlstate <> '42501' OR v_err NOT LIKE 'api_keys: INSERT refused for role zz_dbbackstop_fence_probe%' THEN
    RAISE EXCEPTION
      'TEST FAILED (2c): the unknown role''s INSERT was refused with % (%) rather than the fence''s 42501 message naming the role, so another layer refused it and deny-by-default is not what is being tested.',
      v_sqlstate, v_err;
  END IF;
  IF v_rows_after <> v_rows_before THEN
    RAISE EXCEPTION
      'TEST FAILED (2c): the refused INSERT still changed this user''s api_keys row count (% -> %).',
      v_rows_before, v_rows_after;
  END IF;
  RAISE NOTICE 'Assertion 2c OK: an unknown role is refused by the fence (deny by default), naming the role.';

  -- ---- (2w) THE WRITER SET is exactly the three audited functions -------------
  -- Across every schema but pg_catalog and information_schema, the functions whose
  -- comment-stripped definition inserts into api_keys. A new inserter must not appear
  -- without an edit to this gate. The text read is pg_get_functiondef, not prosrc: a
  -- BEGIN ATOMIC body is stored parsed (prosqlbody) and its prosrc is empty, while the
  -- deparsed definition carries every body form. Aggregates are skipped, since
  -- pg_get_functiondef refuses them.
  -- ⚠️ RECORDED LIMIT: dynamic SQL (EXECUTE format(...)) and an inserter in a language
  -- other than SQL or plpgsql are invisible to this arm. The fence still refuses such a
  -- function unless postgres owns it, and every migration-created function IS
  -- postgres-owned, so a postgres-owned SECURITY DEFINER function invisible to this arm
  -- PASSES the fence. The fence function's own body is not an inserter, which is why its
  -- text avoids the phrase these regexes match.
  -- Both comment forms are stripped (lint rule R2's idiom) so prose that names the
  -- statement cannot satisfy or fail the match. PostgreSQL's word boundary is \y.
  -- 2w reads the plain spelling `INSERT INTO [public.]api_keys`; 2w-q, directly below,
  -- reads every other spelling (quoted identifiers, ONLY, MERGE INTO) so each can be
  -- proven to bite on its own.
  -- RED-UNDER: create a plpgsql function that inserts into public.api_keys. It is not in
  --            the pinned set.
  -- RED-UNDER-M: {"arm":"2w","apply":[{"kind":"sql","stmt":"CREATE FUNCTION public.zz_dbbackstop_rogue_writer() RETURNS void LANGUAGE plpgsql AS 'BEGIN INSERT INTO public.api_keys (id) VALUES (gen_random_uuid()); END'"}]}
  SELECT string_agg(DISTINCT s.proname, ', ' ORDER BY s.proname)
           FILTER (WHERE s.body ~* 'insert\s+into\s+(public\.)?api_keys\y'),
         string_agg(DISTINCT s.proname, ', ' ORDER BY s.proname),
         string_agg(DISTINCT s.proname || ':' || s.prosecdef::text || ':' || s.owner,
                    ', ' ORDER BY s.proname || ':' || s.prosecdef::text || ':' || s.owner)
    INTO v_writers, v_writers_any, v_writer_modes
    FROM (SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner,
                 CASE WHEN p.prokind IN ('f', 'p')
                      THEN regexp_replace(regexp_replace(pg_get_functiondef(p.oid),
                             '--[^\n]*', '', 'g'), '/\*.*?\*/', '', 'g')
                 END AS body
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')) s
   WHERE s.body ~* '(insert|merge)\s+into\s+(only\s+)?("?public"?\s*\.\s*)?"?api_keys\y"?';
  IF v_writers IS DISTINCT FROM v_writers_want THEN
    RAISE EXCEPTION
      'TEST FAILED (2w): the functions whose comment-stripped definition inserts into api_keys are {%}, expected exactly {%}. A new inserter cannot appear without an edit to this gate (and a review of what it admits past the fence); a missing one means a writer was renamed or dropped.',
      COALESCE(v_writers, '<none>'), v_writers_want;
  END IF;
  RAISE NOTICE 'Assertion 2w OK: the writer set is exactly {%}.', v_writers;

  -- ---- (2w-q) NO OTHER SPELLING of an api_keys insert hides a fourth writer --------
  -- Quoted identifiers (`"public"."api_keys"`, `"api_keys"`), `INSERT INTO ONLY` and
  -- `MERGE INTO` name the same table and escape 2w's plain regex. The set found with all
  -- of them must equal the set found with the plain spelling.
  -- RED-UNDER: create a plpgsql function that inserts into "public"."api_keys" with both
  --            identifiers quoted. 2w's plain regex does not match it, so 2w still passes
  --            and 2w-q is the first failure.
  -- RED-UNDER-M: {"arm":"2w-q","apply":[{"kind":"sql","stmt":"CREATE FUNCTION public.zz_dbbackstop_rogue_quoted_writer() RETURNS void LANGUAGE plpgsql AS 'BEGIN INSERT INTO \"public\".\"api_keys\" (id) VALUES (gen_random_uuid()); END'"}]}
  IF v_writers_any IS DISTINCT FROM v_writers THEN
    RAISE EXCEPTION
      'TEST FAILED (2w-q): the functions that insert into or merge into api_keys in ANY spelling are {%} but the plain-spelling set is {%}. A function writes api_keys through a quoted identifier, ONLY or MERGE INTO that 2w cannot see; it cannot appear without an edit to this gate (and a review of what it admits past the fence).',
      COALESCE(v_writers_any, '<none>'), COALESCE(v_writers, '<none>');
  END IF;
  RAISE NOTICE 'Assertion 2w-q OK: no other spelling of an api_keys insert adds a writer.';

  -- ---- (2w-m) THE WRITERS' MODE AND OWNER: SECURITY DEFINER, owned by postgres ------
  -- Same set as 2w, read as (name:prosecdef:owner). The fence admits an insert only when
  -- current_user is postgres or supabase_admin, and inside a SECURITY DEFINER body
  -- current_user is the function's owner. Re-declared SECURITY INVOKER, or re-owned to a
  -- role outside the allow-list, a writer would run as service_role and be refused 42501
  -- on every call: the wizard connect and the composite add-key routes would break for
  -- every user while 2b (insert_api_key only) and every other arm stayed green.
  -- RED-UNDER: flip create_wizard_strategy to SECURITY INVOKER. Its name is unchanged, so
  --            2w still passes and 2w-m is the first failure. A sql step, not a migration
  --            edit, so the migration's own checks cannot abort the apply first.
  -- RED-UNDER-M: {"arm":"2w-m","apply":[{"kind":"sql","stmt":"ALTER FUNCTION public.create_wizard_strategy(uuid, text, text, text, text, text, text, text, integer, text, uuid, text, text) SECURITY INVOKER"}]}
  IF v_writer_modes IS DISTINCT FROM v_modes_want THEN
    RAISE EXCEPTION
      'TEST FAILED (2w-m): the audited writers as name:prosecdef:owner are {%}, expected exactly {%}. The insert fence admits an insert only when current_user is postgres or supabase_admin, and inside a function current_user is its owner only when it is SECURITY DEFINER, so a writer that is INVOKER or owned by another role is refused 42501 and every connect-a-key through it is broken.',
      COALESCE(v_writer_modes, '<none>'), v_modes_want;
  END IF;
  RAISE NOTICE 'Assertion 2w-m OK: the writers are SECURITY DEFINER and postgres-owned: {%}.', v_writer_modes;

  -- ---- the gate: is the plan-05 REVOKE live on THIS database? --------------
  SELECT COALESCE(
    col_description(
      'public.api_keys'::regclass,
      (SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.api_keys'::regclass
          AND attname = 'exchange'
          AND NOT attisdropped)
    ) LIKE '%' || v_marker || '%',
    false
  ) INTO v_revoke_live;

  -- The marker's INDEPENDENT second source. Read from the ACL, never from the
  -- comment — a cross-check with one source is not a cross-check.
  SELECT NOT has_table_privilege('authenticated', 'public.api_keys', 'INSERT')
    INTO v_insert_revoked;

  -- ---- THE SILENT-GREEN TRAP, closed in the direction that bites -----------
  -- ⛔ DELIBERATELY OUTSIDE the branch below, and that placement IS the
  -- assertion: inside the armed arm it would be unreachable, and the failure it
  -- exists to catch is precisely the arm where the block skips.
  IF v_insert_revoked AND NOT v_revoke_live THEN
    RAISE EXCEPTION
      'RANK-03 REGRESSION (gate): authenticated holds NO INSERT on api_keys — so the plan-05 REVOKE IS applied here — but api_keys.exchange carries no ''%'' marker in its column comment. Assertions 5 and 6 therefore SKIPPED with exit code 0 on exactly the database they were written to guard, and would keep reporting green through any later re-grant. A migration dropped or re-stamped that comment; restore the substring in whichever migration re-stamped it.',
      v_marker;
  END IF;

  IF v_revoke_live THEN
    SELECT count(*) INTO v_rows_before FROM public.api_keys WHERE user_id = v_uid;

    -- ---- (5) NEGATIVE: the browser's INSERT door is SHUT --------------------
    SET LOCAL ROLE authenticated;
    v_raised := false;
    BEGIN
      INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
      VALUES (v_key_denied, v_uid, 'mt5', 'rank03-denied', 'x');
    EXCEPTION WHEN OTHERS THEN
      v_raised   := true;
      v_sqlstate := SQLSTATE;
      v_err      := SQLERRM;
    END;
    RESET ROLE;

    IF NOT v_raised THEN
      RAISE EXCEPTION
        'RANK-03 REGRESSION (5): an authenticated browser session INSERTed a row into api_keys naming its own venue. The INSERT grant has been re-granted — most likely by an inherited GRANT ALL, or by a later migration that did not know this door was deliberately shut. A browser can once again choose the venue that decides its own annualization factor and its own probe exemption.';
    END IF;
    IF v_sqlstate <> '42501' THEN
      RAISE EXCEPTION
        'RANK-03 (5): the authenticated INSERT was refused with SQLSTATE % (%) rather than 42501 insufficient_privilege — it was blocked for the wrong reason (a CHECK, an RLS predicate, a NOT NULL), so this assertion is NOT testing the privilege revoke and would keep passing after a re-grant.',
        v_sqlstate, v_err;
    END IF;
    -- ⭐ PHASE 243 plan 10: the insert fence ALSO raises 42501, so after a re-grant to
    -- authenticated the fence would refuse the same statement with the same SQLSTATE and
    -- the check above would pass. The message tells the two layers apart: the privilege
    -- refusal reads `permission denied for table`, the fence's reads `api_keys: INSERT
    -- refused for role`. Arm 6's ACL check below is unchanged and also still bites.
    IF v_err NOT LIKE 'permission denied for table%' THEN
      RAISE EXCEPTION
        'RANK-03 (5): the authenticated INSERT was refused with 42501 but with "%" rather than the privilege refusal (permission denied for table). Another layer (the Phase 243 insert fence, an RLS predicate) refused it, so this assertion no longer sees a re-grant of INSERT to authenticated.',
        v_err;
    END IF;

    SELECT count(*) INTO v_rows_after FROM public.api_keys WHERE user_id = v_uid;
    IF v_rows_after <> v_rows_before THEN
      RAISE EXCEPTION
        'RANK-03 REGRESSION (5): the refused INSERT still changed this user''s api_keys row count (% -> %). "An error was raised" is the weaker claim; a row minted anyway is the actual harm.',
        v_rows_before, v_rows_after;
    END IF;
    RAISE NOTICE 'Assertion 5 OK: authenticated INSERT on api_keys is refused 42501 and mints no row.';

    -- ---- (6) NEGATIVE + its anti-vacuity positive: the ACL CLASS ------------
    -- The privilege bits themselves, so a regression is caught even if some
    -- future RLS predicate happened to refuse the statement above for an
    -- unrelated reason.
    IF has_table_privilege('authenticated', 'public.api_keys', 'INSERT') THEN
      RAISE EXCEPTION
        'RANK-03 REGRESSION (6): authenticated holds INSERT on api_keys.';
    END IF;
    IF has_table_privilege('anon', 'public.api_keys', 'INSERT') THEN
      RAISE EXCEPTION
        'RANK-03 REGRESSION (6): anon holds INSERT on api_keys — an UNAUTHENTICATED caller can POST a row to /rest/v1/api_keys. RLS still gates the row, but the grant is the wrong shape and anon was revoked alongside authenticated for that reason.';
    END IF;
    -- ⭐ The positive WITHOUT which "the door is shut" is indistinguishable from "the
    -- whole table is unreachable and every flow is broken" is arm 2b (the audited writer
    -- still inserts) for the INSERT side, and the DELETE check below for the DELETE side.
    -- Since Phase 243 plan 10 there is deliberately NO service_role INSERT-grant positive
    -- here: the fence refuses every service_role INSERT and the writers' INSERT runs as
    -- their owner postgres, so that grant enables no path and pinning it would fail CI
    -- on the correct hardening (REVOKE INSERT FROM service_role).
    IF NOT has_table_privilege('authenticated', 'public.api_keys', 'DELETE') THEN
      RAISE EXCEPTION
        'OUTAGE (6): authenticated lost DELETE on api_keys — the REVOKE was meant to be INSERT-ONLY (D-05). Disconnect-a-key is a live client path in ApiKeyManager and AllocatorExchangeManager and is now broken for every user. REMEDY: GRANT DELETE ON public.api_keys TO authenticated;';
    END IF;
    RAISE NOTICE 'Assertion 6 OK: the ACL class holds — neither authenticated nor anon holds INSERT, while authenticated keeps DELETE (the INSERT-side positive is arm 2b).';
  ELSE
    RAISE NOTICE 'SKIP (5,6): the plan-05 INSERT revoke is not applied here — api_keys.exchange carries no ''%'' marker in its column comment, and authenticated still holds INSERT (which is CORRECT during the PR-1 soak window, D-06). NOT SKIPPED, and enforcing right now: assertion 1 (owner SELECT), the fence arms 2s, 2a, 2b, 2c, 2w, 2w-q and 2w-m (Phase 243), assertion 3 (scrub trigger live + INVOKER) and assertion 4 (owner DELETE). The two skipped assertions arm themselves the moment the REVOKE migration stamps that marker.',
      v_marker;
  END IF;

  -- ---- (4) POSITIVE: the REVOKE is INSERT-ONLY — DELETE still works ---------
  -- Runs UNCONDITIONALLY and last, because it removes the fixture row: an
  -- over-broad REVOKE is caught whether or not the negatives above were gated
  -- out. This is D-05's canary and it must be green in BOTH states.
  -- RED-UNDER: narrow `api_keys_owner` from `FOR ALL` to `FOR SELECT` in
  --            migration 20260405061912, so the owner keeps its read while the
  --            row filter stops admitting its own DELETE and the
  --            disconnect-a-key flow breaks. ⚠️ The over-broad REVOKE this arm
  --            NAMES cannot be the mutation: a withdrawn DELETE privilege
  --            aborts with a bare `permission denied for table api_keys` and no
  --            identity (MEASURED 2026-09-04, NO-IDENTITY), and assertion 6's
  --            own `OUTAGE (6)` branch would claim it first anyway. Assertions
  --            5 and 6 are unaffected — INSERT is still revoked and the ACL
  --            class is unchanged — so this is the FIRST failure.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20260405061912_rls_policies.sql","find":"CREATE POLICY api_keys_owner ON api_keys FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());","replace":"CREATE POLICY api_keys_owner ON api_keys FOR SELECT USING (user_id = auth.uid());","occurrences":1}]}
  SET LOCAL ROLE authenticated;
  DELETE FROM public.api_keys WHERE id = v_key;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RESET ROLE;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION
      'TEST FAILED (4): authenticated could not DELETE its own api_keys row (% rows). The INSERT revoke was over-broad and the disconnect-a-key flow is broken for every user.',
      v_deleted;
  END IF;
  RAISE NOTICE 'Assertion 4 OK: owner can still DELETE its own api_keys row (the REVOKE stayed INSERT-only).';

  PERFORM set_config('request.jwt.claims', NULL, true);
END $$;

ROLLBACK;
