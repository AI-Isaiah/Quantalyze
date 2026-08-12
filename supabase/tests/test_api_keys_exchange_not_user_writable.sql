-- Test: api_keys.exchange is NOT writable by the row's own owner.
--
-- Phase 153.2 code review CR-01. Guards migration
-- 20260810120000_lock_api_keys_exchange_column.sql.
--
-- Background
-- ----------
-- `api_keys` is exposed to PostgREST. `api_keys_owner` (20260405061912) is a
-- `FOR ALL` policy that constrains the ROW (user_id = auth.uid()), not the
-- COLUMNS, and migration 027 (20260410225608) revoked/re-granted SELECT only —
-- so the inherited `GRANT ALL ON api_keys TO anon, authenticated` left UPDATE
-- intact. `finalize-wizard` reads this column to decide whether to run the
-- submit-time scope-broadening probe (the ASVS V4 defence against a key
-- broadened to trade/withdraw between Connect and Submit) and to stamp
-- `strategies.asset_class` (√365 crypto vs √252 traditional). A key owner could
-- therefore PATCH their own row to a probe-exempt venue, submit with the probe
-- skipped, and PATCH it back.
--
-- Asserted invariants
-- -------------------
--   1. POSITIVE (always active): acting as `authenticated` with the row owner's
--      forged JWT, the owner can still SELECT their own key's `exchange`. This
--      is the anti-vacuity control — without it, assertion 2 would "pass" for a
--      session that simply could not see the row at all.
--   2. NEGATIVE (gated on the fix being present): the same session cannot
--      change `exchange`. Asserted TWO ways, because "an error was raised" is
--      the weaker claim: the statement must be REFUSED, and the stored value
--      read back by the owner must be UNCHANGED.
--   3. NEGATIVE (gated): the same session cannot change any other column
--      either. The migration re-grants NOTHING, because the 2026-08-10 call-site
--      audit found zero user-scoped UPDATEs on this table. If a legitimate
--      user-editable column is ever introduced, this row is the one that must
--      be revisited deliberately — with a column GRANT in a migration, not by
--      deleting the assertion.
--   4. POSITIVE (always active): the owner can still DELETE their own key.
--      Catches an over-broad REVOKE — the migration deliberately touches
--      UPDATE only, and DELETE is a live client path (ApiKeyManager).
--   5. THE ROUND TRIP (Phase 153.6 / D-05, gated on 20260811210000). Assertions
--      2-4 together showed that the in-place rewrite is refused while DELETE and
--      INSERT both survive — which is precisely the shape of the bypass 2 was
--      meant to close: DELETE the row, re-INSERT it under a forged venue. This
--      assertion drives that round trip and asserts the outcome that makes it
--      harmless: the re-INSERT SUCCEEDS (D-02/D-03 — the client INSERT path
--      stays open on purpose) AND the stored `attested_venue` reads back NULL,
--      because the BEFORE INSERT trigger scrubbed the client's value. It is
--      preceded by a privileged-path positive control, without which "the value
--      was scrubbed" would be indistinguishable from "the column never stores
--      anything".
--
--   5d/5e. THE SECOND DOOR (Phase 153.6 code review CR-01). Assertions 2-5c all
--      exercise the CLIENT INSERT path. The other writer is the wizard RPC
--      itself — SECURITY DEFINER, EXECUTE-able by `authenticated`, reachable
--      directly over PostgREST — and it does NOT validate the venue it is
--      handed. 5d calls it as the row's own owner with a forged p_exchange and
--      asserts the outcome that is actually true: the call SUCCEEDS, and both
--      `exchange` and `attested_venue` come back carrying the forged value.
--      That is the guarantee — the forgery cannot be SELECTIVE, so a probe skip
--      always costs a routing label the key cannot sync under. 5e then asserts
--      the coupling is a CHECK constraint rather than a property of today's two
--      function bodies, because "the current writers happen to agree" is the
--      shape of claim this phase exists to stop shipping as a control.
--
--      ⚠️ WHAT THIS FILE CANNOT PROVE (D-05's honest limit). SQL can assert that
--      the probe's INPUT is unforgeable. It cannot invoke the probe, so it
--      cannot assert the probe's OUTCOME — that a row with exchange='mt5' and a
--      NULL/foreign attested_venue is actually PROBED. That half lives in
--      src/app/api/strategies/finalize-wizard/route.test.ts. NEITHER HALF ALONE
--      DISCHARGES D-05; a reviewer who sees only one of them is looking at half
--      a guard.
--
-- Test DB lag: the shared test DB tracks prod but lags main, so on a PR branch
-- the migration may not be applied yet (the exploit is still live there). The
-- negative assertions are therefore gated on the fix being present, and the
-- CHOICE OF GATE is load-bearing — it was measured, not assumed:
--
--   * NOT a column-privilege bit. test_profiles_privileged_columns_locked.sql
--     records why: `authenticated` holds a table-level UPDATE grant, so a
--     per-column privilege bit does not flip until the table REVOKE runs, and
--     keying on it risks never enforcing.
--   * NOT the `api_keys_lock_exchange` trigger either, even though that is the
--     precedent's gate. Measured on a local PG16 fixture: with the trigger
--     dropped and the REVOKE left in place, a trigger-keyed gate SKIPS — so
--     deleting one of the two protections silently disarms the assertions that
--     guard it. A gate must not be disarmable by removing what it guards.
--   * The gate is the COLUMN COMMENT the migration stamps on
--     `api_keys.exchange`, which names the migration id. It is a marker, not a
--     control: dropping the trigger or re-granting UPDATE leaves it intact, so
--     either regression RE-ARMS as a failure instead of a skip.
--
-- The gate emits a loud NOTICE skip and becomes a hard regression guard once the
-- test DB catches up. The POSITIVE controls (1 and 4) run unconditionally, so
-- this file can never be entirely inert.
--
-- pgTAP is not set up in this project (CLAUDE.md / Lane B), so assertions RAISE
-- EXCEPTION on failure; a clean run prints NOTICEs only. Run with
-- `psql -v ON_ERROR_STOP=1`. CI auto-discovers supabase/tests/test_*.sql.
--
-- Run order: AFTER 20260810120000. The whole test rolls back.

BEGIN;

DO $$
DECLARE
  v_uid        uuid := gen_random_uuid();
  v_key        uuid := gen_random_uuid();
  v_key5       uuid := gen_random_uuid();
  v_key_rpc    uuid;
  v_session    uuid := gen_random_uuid();
  v_fix_live   boolean;
  v_attest_live boolean;
  v_seen       text;
  v_after      text;
  v_attested   text;
  v_raised     boolean;
  v_sqlstate   text;
  v_deleted    int;
  v_ins_err    text;
BEGIN
  -- ---- fixture (seeded as the migration/owner role, not as the client) ------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at, raw_user_meta_data)
  VALUES (v_uid, '00000000-0000-0000-0000-000000000000',
          'cr01-' || v_uid::text || '@quantalyze.test', now(), now(),
          '{"role":"manager"}'::jsonb);
  INSERT INTO public.profiles (id, display_name)
  VALUES (v_uid, 'cr01-owner') ON CONFLICT (id) DO NOTHING;

  -- A key whose TRUE venue answers the scope probe. The forgery under test is
  -- rewriting this to a probe-exempt venue.
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
  VALUES (v_key, v_uid, 'binance', 'cr01-key', 'x');

  -- Forge the JWT sub so auth.uid() = v_uid (the api_keys_owner row predicate
  -- passes), then act as the authenticated role — i.e. exactly what a browser
  -- session holding this user's own JWT can do through PostgREST.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
                     true);

  -- ---- (1) POSITIVE: the owner's session really can see its own row ---------
  SET LOCAL ROLE authenticated;
  SELECT exchange INTO v_seen FROM public.api_keys WHERE id = v_key;
  RESET ROLE;
  IF v_seen IS DISTINCT FROM 'binance' THEN
    RAISE EXCEPTION
      'TEST FAILED (1): the owner''s authenticated session cannot read its own api_keys row (got %). Every negative assertion below would pass vacuously.',
      v_seen;
  END IF;
  RAISE NOTICE 'Assertion 1 OK: owner session reads its own api_keys.exchange (anti-vacuity control).';

  -- ---- gate the negatives on the fix being live on THIS database -----------
  -- Keyed on the migration's column-comment MARKER, deliberately not on either
  -- protection it installs (see the header). Removing the trigger or re-granting
  -- UPDATE leaves this marker in place, so the negatives below stay armed and
  -- report a regression rather than skipping past it.
  SELECT COALESCE(
    col_description(
      'public.api_keys'::regclass,
      (SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.api_keys'::regclass
          AND attname = 'exchange'
          AND NOT attisdropped)
    ) LIKE '%20260810120000%',
    false
  ) INTO v_fix_live;

  IF v_fix_live THEN
    SET LOCAL ROLE authenticated;

    -- ---- (2) NEGATIVE: the venue cannot be rewritten -----------------------
    v_raised := false;
    BEGIN
      UPDATE public.api_keys SET exchange = 'mt5' WHERE id = v_key;
    EXCEPTION WHEN OTHERS THEN
      v_raised := true;
      v_sqlstate := SQLSTATE;
    END;
    RESET ROLE;

    IF NOT v_raised THEN
      RAISE EXCEPTION
        'CR-01 REGRESSION (2): authenticated rewrote api_keys.exchange on its own row — the submit-time scope-broadening probe can be switched off by the key''s owner.';
    END IF;
    IF v_sqlstate <> '42501' THEN
      RAISE EXCEPTION
        'CR-01 (2): the UPDATE was refused with SQLSTATE % rather than 42501 insufficient_privilege — it was blocked for the wrong reason, so this assertion is not testing the privilege lock.',
        v_sqlstate;
    END IF;

    -- The stronger half of the same claim: refused AND unchanged. A raise alone
    -- would still pass if some later arm had already committed the rewrite.
    SELECT exchange INTO v_after FROM public.api_keys WHERE id = v_key;
    IF v_after IS DISTINCT FROM 'binance' THEN
      RAISE EXCEPTION
        'CR-01 REGRESSION (2): api_keys.exchange is now % despite the UPDATE being refused.',
        v_after;
    END IF;
    RAISE NOTICE 'Assertion 2 OK: authenticated cannot rewrite api_keys.exchange (refused 42501, value unchanged).';

    -- ---- (3) NEGATIVE: no column is client-updatable ------------------------
    SET LOCAL ROLE authenticated;
    v_raised := false;
    BEGIN
      UPDATE public.api_keys SET label = 'cr01-relabelled' WHERE id = v_key;
    EXCEPTION WHEN OTHERS THEN
      v_raised := true;
    END;
    RESET ROLE;
    IF NOT v_raised THEN
      RAISE EXCEPTION
        'CR-01 (3): authenticated still holds UPDATE on api_keys (label succeeded). Migration 20260810120000 re-grants NOTHING by design — if a user-editable column was added, grant it explicitly in a migration and update this assertion; do not delete it.';
    END IF;
    RAISE NOTICE 'Assertion 3 OK: no api_keys column is client-updatable.';
  ELSE
    RAISE NOTICE 'SKIP (2,3): migration 20260810120000 not yet applied here (api_keys.exchange carries no migration marker comment). Negative assertions enforce once the test DB catches up.';
  END IF;

  -- ---- (4) POSITIVE: the REVOKE was surgical — DELETE still works -----------
  -- Runs unconditionally and AFTER the gated negatives (it removes the fixture
  -- row), so an over-broad REVOKE is caught whether or not those were gated out.
  -- Assertion 5 below runs later still, but on its OWN row and behind its own
  -- gate, so it cannot make this canary conditional.
  SET LOCAL ROLE authenticated;
  DELETE FROM public.api_keys WHERE id = v_key;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RESET ROLE;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION
      'TEST FAILED (4): authenticated could not DELETE its own api_keys row (% rows) — the UPDATE revoke was over-broad and the delete-a-key flow is broken.',
      v_deleted;
  END IF;
  RAISE NOTICE 'Assertion 4 OK: owner can still DELETE its own api_keys row.';

  -- ---- (5) THE ROUND TRIP: DELETE + re-INSERT under a forged attestation ----
  -- Phase 153.6 / D-05. Its OWN gate, keyed on the NEWER migration's marker —
  -- the same column-comment idiom and for the same measured reason as the gate
  -- above (see the header), just pointed at 20260811210000's column. The test DB
  -- lags main, so on a branch where that migration has not applied this skips
  -- LOUDLY rather than erroring on a column that does not exist yet. plpgsql
  -- prepares a statement the first time it RUNS, so the attested_venue
  -- statements inside this branch are never parsed on a database without the
  -- column.
  SELECT COALESCE(
    col_description(
      'public.api_keys'::regclass,
      (SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.api_keys'::regclass
          AND attname = 'attested_venue'
          AND NOT attisdropped)
    ) LIKE '%20260811210000%',
    false
  ) INTO v_attest_live;

  IF v_attest_live THEN
    -- (5a) MARKER-PRESENT POSITIVE CONTROL for the gate above (153.6 P4).
    -- 20260811210000 re-stamps the `exchange` comment, and is required to
    -- preserve the 20260810120000 substring. Since it sorts AFTER
    -- 20260810120000, a database carrying its marker must carry the older one
    -- too. Asserting that here is what turns "the re-stamp dropped the marker"
    -- into a FAILURE instead of assertions 2 and 3 quietly skipping forever —
    -- and a skip is the worse outcome, because it looks green.
    IF NOT v_fix_live THEN
      RAISE EXCEPTION
        'CR-01/153.6 REGRESSION (5a): api_keys.attested_venue carries the 20260811210000 marker but api_keys.exchange no longer names 20260810120000. A comment re-stamp dropped the gate marker, so assertions 2 and 3 above SKIPPED rather than ran. Restore the substring in whichever migration re-stamped that comment.';
    END IF;
    RAISE NOTICE 'Assertion 5a OK: the 20260810120000 gate marker survived the re-stamp, so assertions 2 and 3 really ran.';

    -- (5b) POSITIVE CONTROL on the PRIVILEGED path, before any negative.
    -- Seeded as the migration/owner role, so the trigger's privileged-caller
    -- branch applies and the value must survive. Without this, "the client's
    -- value was scrubbed" is indistinguishable from "this column never stores
    -- anything", and 5c would pass vacuously.
    INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted, attested_venue)
    VALUES (v_key5, v_uid, 'binance', 'cr01-roundtrip', 'x', 'binance');

    SELECT attested_venue INTO v_attested FROM public.api_keys WHERE id = v_key5;
    IF v_attested IS DISTINCT FROM 'binance' THEN
      RAISE EXCEPTION
        'TEST FAILED (5b): a privileged INSERT did not persist attested_venue (got %). The scrub trigger is firing for the owner role too, so the wizard RPCs cannot attest anything and every key would be probed — and assertion 5c below would pass for the wrong reason.',
        v_attested;
    END IF;
    RAISE NOTICE 'Assertion 5b OK: the privileged path still stores an attestation (anti-vacuity control for 5c).';

    -- (5c) THE ROUND TRIP as the row's own owner: DELETE, then re-INSERT with a
    -- forged venue AND a forged attestation. Both halves of the double are
    -- asserted, because "the INSERT was refused" and "the value was stored"
    -- are each the weaker claim on their own:
    --   * the re-INSERT SUCCEEDS — D-02/D-03 keep the client INSERT path open
    --     deliberately, and a refusal here would mean connect-a-key is broken;
    --   * the stored attested_venue is NULL — the trigger scrubbed it, so the
    --     probe gate sees "unattested" and probes.
    SET LOCAL ROLE authenticated;
    DELETE FROM public.api_keys WHERE id = v_key5;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    v_ins_err := NULL;
    BEGIN
      INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted, attested_venue)
      VALUES (v_key5, v_uid, 'mt5', 'cr01-roundtrip', 'x', 'mt5');
    EXCEPTION WHEN OTHERS THEN
      v_ins_err := SQLSTATE || ' ' || SQLERRM;
    END;
    RESET ROLE;

    IF v_deleted <> 1 THEN
      RAISE EXCEPTION
        'TEST FAILED (5c): authenticated could not DELETE its own api_keys row (% rows) — the round trip cannot be exercised at all.',
        v_deleted;
    END IF;
    IF v_ins_err IS NOT NULL THEN
      RAISE EXCEPTION
        'TEST FAILED (5c): the client re-INSERT was REFUSED (%). 153.6 D-02/D-03 keep this path open on purpose — the fix is the trigger scrubbing the value, not a privilege change. A refusal here means connect-a-key is broken.',
        v_ins_err;
    END IF;

    SELECT exchange, attested_venue INTO v_after, v_attested
      FROM public.api_keys WHERE id = v_key5;
    IF v_after IS DISTINCT FROM 'mt5' THEN
      RAISE EXCEPTION
        'TEST FAILED (5c): the re-INSERTed row does not carry the forged exchange (got %) — the round trip did not actually happen, so the scrub assertion below proves nothing.',
        v_after;
    END IF;
    IF v_attested IS NOT NULL THEN
      RAISE EXCEPTION
        'CR-01/153.6 REGRESSION (5c): a client-supplied attested_venue PERSISTED as % after DELETE + re-INSERT. The api_keys_scrub_attested_venue BEFORE INSERT trigger is not firing for the authenticated role, so a key owner can once again hand the finalize-wizard scope-broadening probe a venue of their choosing and have the ASVS V4 check skipped on their own key.',
        v_attested;
    END IF;
    RAISE NOTICE 'Assertion 5c OK: DELETE + re-INSERT with a forged attested_venue SUCCEEDS and stores NULL — the probe gate''s input is unforgeable from the client.';

    -- ---- (5d) THE OTHER DOOR: the RPC, called directly as `authenticated` ----
    -- Phase 153.6 code review CR-01. Assertions 2-5c all exercise the CLIENT
    -- INSERT door. They say nothing about the SECOND writer, and it is the one
    -- the design actually leans on: `create_wizard_strategy` is SECURITY
    -- DEFINER, holds EXECUTE for `authenticated`, and Supabase exposes
    -- public-schema functions over PostgREST — so a browser holding its own
    -- server-minted ciphertext (which /api/keys/validate-and-encrypt hands back)
    -- can issue the RPC itself with ANY p_exchange it likes. The RPC does NOT
    -- validate that parameter; it writes it.
    --
    -- ⛔ SO THE CLAIM UNDER TEST IS NOT "the RPC refuses a forged venue" — it
    -- does not, and asserting that would pin a guarantee this system does not
    -- provide. The claim is that the forgery cannot be SELECTIVE: `exchange` and
    -- `attested_venue` are written from ONE parameter, so buying a probe skip
    -- also stamps the routing label that sends the key to an adapter it cannot
    -- sync under. 5e then pins the constraint that keeps that true for every
    -- future writer.
    SET LOCAL ROLE authenticated;
    v_ins_err := NULL;
    BEGIN
      SELECT api_key_id INTO v_key_rpc
        FROM public.create_wizard_strategy(
          v_uid,
          'mt5',              -- the forged, probe-exempt venue
          'cr01-rpc-door', 'ct', 'ct', NULL, 'dek', 'nonce', 1,
          'cr01-rpc-draft', v_session
        );
    EXCEPTION WHEN OTHERS THEN
      v_ins_err := SQLSTATE || ' ' || SQLERRM;
    END;
    RESET ROLE;

    IF v_ins_err IS NOT NULL THEN
      RAISE EXCEPTION
        'TEST FAILED (5d): create_wizard_strategy could not be called by the row owner (%). This is the wizard''s own connect path — a refusal here means connect-a-key is broken, and it also means 5d proves nothing about the RPC door.',
        v_ins_err;
    END IF;
    IF v_key_rpc IS NULL THEN
      RAISE EXCEPTION
        'TEST FAILED (5d): create_wizard_strategy returned no api_key_id, so no row was minted and the assertions below would pass vacuously.';
    END IF;

    SELECT exchange, attested_venue INTO v_after, v_attested
      FROM public.api_keys WHERE id = v_key_rpc;

    -- The DEFINER body must actually out-run the scrub trigger, or every
    -- wizard-minted key is unattested and every MT5 finalize is permanently
    -- KEY_SCOPE_CHECK_UNAVAILABLE. (Distinct from 5b: that seeded as the test
    -- session''s own role; this is the REAL writer, running as its owner.)
    IF v_attested IS NULL THEN
      RAISE EXCEPTION
        'CR-01/153.6 REGRESSION (5d): a wizard RPC minted a key with attested_venue NULL — the scrub trigger is firing for the RPC''s owner too. Every wizard key would be probed, and for MT5 that is a permanent KEY_SCOPE_CHECK_UNAVAILABLE with no remedy.';
    END IF;
    IF v_after IS DISTINCT FROM v_attested THEN
      RAISE EXCEPTION
        'CR-01/153.6 REGRESSION (5d): the RPC minted exchange=% with attested_venue=%. The two columns MUST move together — a row where they differ is a probe skip bought without the routing label that pays for it, i.e. a genuinely free forgery.',
        v_after, v_attested;
    END IF;
    RAISE NOTICE 'Assertion 5d OK: the RPC door accepts a forged venue (it validates nothing) but cannot forge SELECTIVELY — exchange and attested_venue both read back %.', v_attested;

    -- ---- (5e) the coupling is a CONSTRAINT, not a coincidence --------------
    -- 5d shows today''s two writers happen to keep the columns equal. That is
    -- an argument about the current bodies, and CR-01''s finding was precisely
    -- that such an argument had been written down as a security property. This
    -- asserts the invariant is ENFORCED, so a future writer (a distinct
    -- p_attested_venue, a service_role route, one column normalised and not the
    -- other) FAILS instead of quietly minting a forgeable attestation.
    --
    -- ⚠️ RUN AS THE PRIVILEGED ROLE, and that is anti-vacuity, not convenience.
    -- As `authenticated` the BEFORE INSERT trigger NULLs attested_venue first,
    -- so the CHECK is never reached and a "refused" result would be the
    -- trigger''s doing, not the constraint''s.
    v_ins_err := NULL;
    BEGIN
      INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted, attested_venue)
      VALUES (v_uid, 'binance', 'cr01-divergent', 'x', 'mt5');
    EXCEPTION WHEN OTHERS THEN
      v_ins_err := SQLSTATE;
    END;

    IF v_ins_err IS NULL THEN
      RAISE EXCEPTION
        'CR-01/153.6 REGRESSION (5e): a privileged writer persisted exchange=binance with attested_venue=mt5. The api_keys_attested_venue_matches_exchange CHECK is missing, so an attestation can be forged WITHOUT forging the routing label — the coupling 5d relies on is back to being an accident.';
    END IF;
    IF v_ins_err <> '23514' THEN
      RAISE EXCEPTION
        'CR-01/153.6 (5e): the divergent INSERT was refused with SQLSTATE % rather than 23514 check_violation — it was blocked for the wrong reason, so this assertion is not testing the coupling constraint.',
        v_ins_err;
    END IF;
    RAISE NOTICE 'Assertion 5e OK: a privileged writer CANNOT persist attested_venue <> exchange (refused 23514) — the coupling is enforced, not incidental.';
  ELSE
    RAISE NOTICE 'SKIP (5): migration 20260811210000 not yet applied here (api_keys.attested_venue carries no migration marker comment). The round-trip assertions enforce once the test DB catches up.';
  END IF;
END $$;

ROLLBACK;
