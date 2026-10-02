-- Test: api_keys INSERT is a SERVER verb, and the server's attestation survives.
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
-- Asserted invariants
-- -------------------
--   1. POSITIVE (ALWAYS ACTIVE): the owner's authenticated session can still
--      SELECT its own row through the migration-027 column allowlist. This is
--      the anti-vacuity control for everything below — without it, a negative
--      assertion "passes" for a session that could not see the row at all.
--   2. POSITIVE (ALWAYS ACTIVE): a `service_role` INSERT that supplies
--      attested_venue = exchange RETAINS it. This is RESEARCH assumption A1,
--      discharged here as an ENFORCED FACT rather than left as an assumption:
--      the whole persist arm is built on the scrub trigger admitting
--      `service_role` by name (20260811210000:534). If that allowlist entry is
--      ever edited out, every key our own server writes silently becomes
--      unattested — no error, no log, just a probe gate that reads NULL
--      forever. Armable TODAY, so it is enforced TODAY, not gated behind 160-05.
--   3. POSITIVE (ALWAYS ACTIVE): the scrub trigger is present, ENABLED, and
--      SECURITY INVOKER. Assertion 2's own anti-vacuity control: with the
--      trigger dropped — or re-declared SECURITY DEFINER, which makes it a
--      silent no-op because current_user becomes the function's owner
--      (20260811210000:499-506 documents that exact trap, and the identical
--      one that made prevent_profile_role_change inert) — assertion 2 would
--      pass while asserting nothing whatsoever.
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
--      `anon` holds INSERT, while `service_role` still does and `authenticated`
--      still holds DELETE. The service_role half is not decoration: it is the
--      anti-vacuity positive that distinguishes "the browser's door is shut"
--      from "connect-a-key is broken for everybody".
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
-- Run order: AFTER 20260811210000 (the attested_venue column + scrub trigger).
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
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","supabase/migrations/20260405061912_rls_policies.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260810120000_lock_api_keys_exchange_column.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql","supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql","scripts/pg-lane/fixtures/25-fixture-api-keys-e2e-census-seed.sql","supabase/migrations/20260823120000_revoke_api_keys_insert.sql"]}

BEGIN;

DO $$
DECLARE
  v_uid          uuid := gen_random_uuid();
  v_key          uuid := gen_random_uuid();
  v_key_a1       uuid := gen_random_uuid();
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
  -- Wrapped for the same measured reason as assertion 2 below: an over-broad
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

  -- ---- (3) STRUCTURAL CONTROL for assertion 2, asserted BEFORE it ----------
  -- Deliberately ordered ahead of the A1 positive: it is the control that makes
  -- assertion 2 mean something, and a control that runs after the thing it
  -- controls invites the reader to treat it as an afterthought.
  -- RED-UNDER: flip `scrub_client_supplied_attested_venue` to SECURITY DEFINER
  --            in migration 20260811210000 — the exact trap that migration's
  --            own header documents at :519-524. Under DEFINER `current_user`
  --            is the function's owner, the privileged-caller branch always
  --            wins, and the trigger becomes a silent no-op that leaves
  --            assertion 2 passing for every writer including the browser.
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
      'TEST FAILED (3): the api_keys_scrub_attested_venue BEFORE INSERT trigger is GONE. Assertion 2 below would pass trivially — with nothing scrubbing anything, "service_role retained its attestation" is true of every writer including the browser, which is the entire property this file exists to distinguish. Restore the trigger from 20260811210000.';
  END IF;
  IF v_trigger_enabled <> 'O' THEN
    RAISE EXCEPTION
      'TEST FAILED (3): api_keys_scrub_attested_venue exists but tgenabled is % (expected O = enabled on origin). A DISABLED trigger scrubs nothing, so a client-supplied attested_venue would persist and assertion 2 would still pass.',
      v_trigger_enabled;
  END IF;
  IF v_trigger_secdef THEN
    RAISE EXCEPTION
      'TEST FAILED (3): scrub_client_supplied_attested_venue is SECURITY DEFINER. Under DEFINER, current_user is the function''s OWNER, so its privileged-caller check ALWAYS passes and the trigger is a SILENT NO-OP — the exact trap 20260811210000:499-506 documents, and the one that made prevent_profile_role_change inert. It must be SECURITY INVOKER. Do not "fix" this by deleting the assertion.';
  END IF;
  RAISE NOTICE 'Assertion 3 OK: the scrub trigger is present, enabled, and SECURITY INVOKER (anti-vacuity control for assertion 2).';

  -- ---- (2) A1 RETENTION POSITIVE — UNCONDITIONAL ---------------------------
  -- RESEARCH assumption A1, discharged. `service_role` is the role the persist
  -- arm's createAdminClient() connects as, and the scrub trigger admits it BY
  -- NAME (20260811210000:534, `current_user IN ('postgres','service_role',
  -- 'supabase_admin')`).
  --
  -- ⛔ SET LOCAL ROLE service_role IS LOAD-BEARING — do not "simplify" this to
  -- an owner-role INSERT (the sibling file's 5b shape). The trigger keys on
  -- current_user, so seeding as the test's own owner role would pass even if
  -- 'service_role' were edited out of that allowlist tomorrow. This assertion
  -- must exercise the LITERAL role our server code uses, or it is not testing
  -- A1 at all.
  --
  -- ⚠️ The INSERT is wrapped, and the wrapper is not defensive noise — it was
  -- added because a neuter revealed the bare form's failure mode. With
  -- `REVOKE INSERT ON api_keys FROM service_role` applied, the unwrapped
  -- statement died as a raw `ERROR: permission denied for table api_keys`:
  -- correctly RED, but with no diagnosis and no remedy, and BEFORE assertion 6's
  -- curated OUTAGE line could ever be reached. The two failures mean opposite
  -- things — "our server cannot write at all" vs "our server writes but is not
  -- believed" — so they get distinct messages.
  SET LOCAL ROLE service_role;
  v_err := NULL;
  BEGIN
    INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted, attested_venue)
    VALUES (v_key_a1, v_uid, 'deribit', 'rank03-a1', 'x', 'deribit');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE || ' ' || SQLERRM;
  END;
  RESET ROLE;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION
      'OUTAGE (2): a service_role INSERT into api_keys was REFUSED (%). Since Phase 160 the persist arm of /api/keys/validate-and-encrypt is the ONLY writer of this table, so EVERY connect-a-key is broken for every user — this is not an attestation problem, it is a total outage. Most likely a REVOKE went one role too far. REMEDY: GRANT INSERT ON public.api_keys TO service_role;',
      v_err;
  END IF;

  SELECT attested_venue INTO v_attested FROM public.api_keys WHERE id = v_key_a1;
  IF v_attested IS DISTINCT FROM 'deribit' THEN
    RAISE EXCEPTION
      'RANK-03 REGRESSION (2): a service_role INSERT supplying attested_venue = exchange read back % instead of ''deribit''. The scrub trigger no longer admits service_role, so POST /api/keys/validate-and-encrypt (persist mode) is minting UNATTESTED keys — silently, with no error and no log. Every key connected since that change reads NULL at the finalize-wizard probe gate. REMEDY: restore ''service_role'' to the allowlist in scrub_client_supplied_attested_venue (20260811210000:534).',
      v_attested;
  END IF;
  -- The coupling (attested_venue IS NULL OR attested_venue = exchange) is a
  -- CHECK constraint, api_keys_attested_venue_matches_exchange (20260811210000
  -- :294). It is asserted as a constraint — not as a property of today's
  -- writers — by test_api_keys_exchange_not_user_writable.sql assertion 5e.
  -- Cited, deliberately not duplicated.
  RAISE NOTICE 'Assertion 2 OK: a service_role INSERT RETAINS its attestation (assumption A1 discharged as an enforced fact).';

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
    -- ⭐ The two positives WITHOUT which "the door is shut" is indistinguishable
    -- from "the whole table is unreachable and every flow is broken".
    IF NOT has_table_privilege('service_role', 'public.api_keys', 'INSERT') THEN
      RAISE EXCEPTION
        'OUTAGE (6): service_role lacks INSERT on api_keys — the REVOKE went one role too far and EVERY connect-a-key is broken for every user, because the persist arm of /api/keys/validate-and-encrypt is now the ONLY writer. REMEDY: GRANT INSERT ON public.api_keys TO service_role;';
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.api_keys', 'DELETE') THEN
      RAISE EXCEPTION
        'OUTAGE (6): authenticated lost DELETE on api_keys — the REVOKE was meant to be INSERT-ONLY (D-05). Disconnect-a-key is a live client path in ApiKeyManager and AllocatorExchangeManager and is now broken for every user. REMEDY: GRANT DELETE ON public.api_keys TO authenticated;';
    END IF;
    RAISE NOTICE 'Assertion 6 OK: the ACL class holds — neither authenticated nor anon holds INSERT, while service_role keeps INSERT and authenticated keeps DELETE.';
  ELSE
    RAISE NOTICE 'SKIP (5,6): the plan-05 INSERT revoke is not applied here — api_keys.exchange carries no ''%'' marker in its column comment, and authenticated still holds INSERT (which is CORRECT during the PR-1 soak window, D-06). NOT SKIPPED, and enforcing right now: assertion 1 (owner SELECT), assertion 2 (service_role attestation retention / A1), assertion 3 (scrub trigger live + INVOKER) and assertion 4 (owner DELETE). The two skipped assertions arm themselves the moment the REVOKE migration stamps that marker.',
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
