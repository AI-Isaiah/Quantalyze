-- Test for migration 20260925120000 — Phase 167.1.2 ACCOUNTTRUTH, plan 03.
--
-- WHAT THE MIGRATION FIXES. Nothing stopped two api keys that read the SAME
-- exchange account from both counting in an allocator's book. The migration
-- adds the database half of the answer:
--   * a duplicate MARKER (account_shared_with_api_key_id + account_share_kind,
--     D-11) the service-role identity stamper writes, both-or-neither, never
--     self-referencing, same owner only, and never an obstacle to deleting a
--     key;
--   * the marker's holder must exist, share the owner, be live and not be
--     marked itself, and a key that holds another cannot be marked (no chains,
--     no cycles);
--   * a departed-key history flag (history_inclusion) and its owner RPC
--     set_departed_key_history_inclusion (D-05, D-09), which refuses while the
--     caller's recompose is running rather than fold into it;
--   * a NAMED refusal in reconnect_allocator_api_key when a live sibling already
--     holds the same (user, exchange, venue_account_id) (Pitfall 5), and a
--     reset of history_inclusion on every successful reconnect.
--
-- pgTAP is not set up in this project, so every assertion RAISEs
-- `TEST FAILED (<arm>)` on failure and a clean run prints NOTICEs only.
-- ⚠️ supabase/tests/test_*.sql is the ONLY DB assertion form that runs in CI.
--
-- ⭐ ORDER IS LOAD-BEARING. Each arm below must be the FIRST failure under its
-- own mutation (scripts/mutation-runner). So:
--   * ACCT-h (an ordinary key INSERT is admitted) is the FIRST api_keys write in
--     the file: under its mutation every insert is refused, so the seeding IS
--     the arm;
--   * ACCT-e (a same-owner holder is ACCEPTED) runs before the refusal arms:
--     its mutation refuses every named holder, which would otherwise surface
--     first as a wrong SQLSTATE in ACCT-a;
--   * ACCT-d (the trigger dropped) runs before ACCT-l/m/n/o, whose refusals the
--     same trigger raises, so dropping it reddens ACCT-d first;
--   * RECON-tenant runs before the other-exchange key is inserted, so its
--     sibling mutation cannot trip on that key first;
--   * HIST-writes leaves the RPC's HISTORY_RECOMPOSE_NOT_QUEUED refusal to
--     HIST-enqueues, whose twin (no enqueue) makes the FIRST call raise it;
--   * every action whose success an arm asserts is captured, never left to
--     abort the file, so a mutation that breaks it reddens THAT arm by name
--     instead of producing an error with no identity.
-- Handlers only record SQLSTATE / message / constraint; every probe runs after
-- the handler's END (lint rule R1).
--
-- Callers are impersonated the way test_api_key_delete_atomicity.sql does it:
-- request.jwt.claims carries sub + role, and the SECURITY DEFINER RPCs read
-- auth.uid(). No SET ROLE, so no role can leak past an aborted arm.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_api_keys_account_identity.sql
--
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260422101911_api_keys_disconnected_at.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260925120000_api_keys_account_identity.sql"]}

-- Reap fixtures orphaned by a crashed earlier run. Age-scoped so it can never
-- touch a concurrent run's users.
DELETE FROM auth.users
 WHERE email LIKE 'test-acct-identity-%@quantalyze.test'
   AND created_at < now() - INTERVAL '1 hour';

DO $acct$
DECLARE
  v_run      text := replace(gen_random_uuid()::text, '-', '');
  uid_a      uuid := gen_random_uuid();   -- owner of every key below except k_x
  uid_b      uuid := gen_random_uuid();   -- a different tenant
  k_h        uuid := gen_random_uuid();   -- user A, live holder
  k_d        uuid := gen_random_uuid();   -- user A, live dependent (the marked key)
  k_x        uuid := gen_random_uuid();   -- user B, live
  k_c        uuid := gen_random_uuid();   -- user A, live, unmarked, holds nobody
  k_gone     uuid := gen_random_uuid();   -- user A, soft-disconnected
  k_s1       uuid := gen_random_uuid();   -- user A, sanitiser-shape holder
  k_s2       uuid := gen_random_uuid();   -- user A, sanitiser-shape dependent
  k_s3       uuid := gen_random_uuid();   -- user A, sanitiser-shape dependent
  v_err      text;
  v_msg      text;
  v_con      text;
  v_holder   uuid;
  v_kind     text;
  v_count    int;
  v_msg2     text;
  v_err2     text;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-acct-identity-a-' || v_run || '@quantalyze.test', now(), now()),
         (uid_b, '00000000-0000-0000-0000-000000000000', 'test-acct-identity-b-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'acct identity A', 'test-acct-identity-a-' || v_run || '@quantalyze.test'),
         (uid_b, 'acct identity B', 'test-acct-identity-b-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;

  -- ----- ACCT-h: an ordinary key INSERT (NULL holder, NULL kind) is ADMITTED
  -- The same-owner trigger's NULL-holder branch must short-circuit before any
  -- lookup. Without it, every key insert in the product (the connect route,
  -- the wizard RPCs) is refused — no one can connect a key at all.
  -- RED-UNDER: narrow the trigger's NULL-holder short-circuit to UPDATE only in
  --            migration 20260925120000, so an INSERT with a NULL holder falls
  --            through to the holder lookup, finds no row, and is refused.
  -- RED-UNDER-M: {"arm":"ACCT-h","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF NEW.account_shared_with_api_key_id IS NULL THEN","replace":"  IF NEW.account_shared_with_api_key_id IS NULL AND TG_OP = 'UPDATE' THEN","occurrences":1}]}
  v_err := NULL;
  BEGIN
    INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, disconnected_at)
    VALUES (k_h,    uid_a, 'okx', 'acct holder',       'enc', true, NULL),
           (k_d,    uid_a, 'okx', 'acct dependent',    'enc', true, NULL),
           (k_x,    uid_b, 'okx', 'acct other user',   'enc', true, NULL),
           (k_c,    uid_a, 'okx', 'acct unmarked',     'enc', true, NULL),
           (k_gone, uid_a, 'okx', 'acct disconnected', 'enc', true, now());
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
    v_msg := SQLERRM;
  END;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-h): an ordinary api_keys INSERT with a NULL holder and NULL kind was REFUSED (SQLSTATE %, %). The same-owner trigger must short-circuit on a NULL holder before any lookup, or no key can ever be connected.', v_err, v_msg;
  END IF;

  -- ----- ACCT-e: a SAME-OWNER holder is ACCEPTED -----------------------------
  -- The positive control for ACCT-d: the stamper's real write must pass.
  -- RED-UNDER: make the trigger refuse EVERY named holder (its owner condition
  --            replaced by TRUE) in migration 20260925120000. The stamper could
  --            then never record a duplicate at all.
  -- RED-UNDER-M: {"arm":"ACCT-e","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF v_holder_owner IS DISTINCT FROM NEW.user_id THEN","replace":"  IF TRUE THEN","occurrences":1}]}
  v_err := NULL;
  BEGIN
    UPDATE api_keys
       SET account_shared_with_api_key_id = k_h, account_share_kind = 'duplicate'
     WHERE id = k_d;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
    v_msg := SQLERRM;
  END;
  SELECT account_shared_with_api_key_id, account_share_kind INTO v_holder, v_kind
    FROM api_keys WHERE id = k_d;
  IF v_err IS NOT NULL OR v_holder IS DISTINCT FROM k_h OR v_kind IS DISTINCT FROM 'duplicate' THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-e): marking a key as a duplicate of a SAME-OWNER holder was not stored (SQLSTATE %, %; holder=%, kind=%). The stamper''s own write is refused.', v_err, v_msg, v_holder, v_kind;
  END IF;

  -- ----- ACCT-i: clearing a marked row's holder AND kind together is ADMITTED
  -- The stamper's marker-clearing UPDATE (plan 04) and the FK's SET NULL action
  -- both take the NULL-holder branch on UPDATE.
  -- RED-UNDER: narrow the trigger's NULL-holder short-circuit to INSERT only in
  --            migration 20260925120000, so a clearing UPDATE falls through to
  --            the holder lookup and is refused.
  -- RED-UNDER-M: {"arm":"ACCT-i","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF NEW.account_shared_with_api_key_id IS NULL THEN","replace":"  IF NEW.account_shared_with_api_key_id IS NULL AND TG_OP = 'INSERT' THEN","occurrences":1}]}
  v_err := NULL;
  BEGIN
    UPDATE api_keys
       SET account_shared_with_api_key_id = NULL, account_share_kind = NULL
     WHERE id = k_d;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
    v_msg := SQLERRM;
  END;
  SELECT account_shared_with_api_key_id, account_share_kind INTO v_holder, v_kind
    FROM api_keys WHERE id = k_d;
  IF v_err IS NOT NULL OR v_holder IS NOT NULL OR v_kind IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-i): clearing a marked key''s holder and kind was not stored (SQLSTATE %, %; holder=%, kind=%). A duplicate marker could never be removed once written.', v_err, v_msg, v_holder, v_kind;
  END IF;

  -- ----- ACCT-a: a kind outside ('duplicate','composite_member') is REFUSED
  -- RED-UNDER: drop api_keys_account_share_kind_valid on the LIVE database.
  -- RED-UNDER-M: {"arm":"ACCT-a","apply":[{"kind":"sql","stmt":"ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_account_share_kind_valid"}]}
  v_err := NULL; v_con := NULL;
  BEGIN
    UPDATE api_keys
       SET account_shared_with_api_key_id = k_h, account_share_kind = 'bogus'
     WHERE id = k_d;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
  END;
  IF v_err IS DISTINCT FROM '23514' OR v_con IS DISTINCT FROM 'api_keys_account_share_kind_valid' THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-a): account_share_kind = ''bogus'' was not refused by api_keys_account_share_kind_valid (SQLSTATE %, constraint %). Readers branch on the two known kinds; an unknown one is silently neither.', v_err, v_con;
  END IF;

  -- ----- ACCT-b: a holder without a kind, and a kind without a holder, are REFUSED
  -- RED-UNDER: drop api_keys_account_share_both_or_neither on the LIVE database.
  -- RED-UNDER-M: {"arm":"ACCT-b","apply":[{"kind":"sql","stmt":"ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_account_share_both_or_neither"}]}
  v_err := NULL; v_con := NULL;
  BEGIN
    UPDATE api_keys
       SET account_shared_with_api_key_id = k_h
     WHERE id = k_d;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
  END;
  IF v_err IS DISTINCT FROM '23514' OR v_con IS DISTINCT FROM 'api_keys_account_share_both_or_neither' THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-b): a holder with NO kind was not refused by api_keys_account_share_both_or_neither (SQLSTATE %, constraint %).', v_err, v_con;
  END IF;
  v_err := NULL; v_con := NULL;
  BEGIN
    INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, account_share_kind)
    VALUES (uid_a, 'okx', 'acct kind without holder', 'enc', true, 'duplicate');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
  END;
  IF v_err IS DISTINCT FROM '23514' OR v_con IS DISTINCT FROM 'api_keys_account_share_both_or_neither' THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-b): a kind with NO holder was not refused on INSERT by api_keys_account_share_both_or_neither (SQLSTATE %, constraint %).', v_err, v_con;
  END IF;

  -- ----- ACCT-c: a key naming ITSELF as holder is REFUSED ---------------------
  -- RED-UNDER: drop api_keys_account_share_not_self on the LIVE database.
  -- RED-UNDER-M: {"arm":"ACCT-c","apply":[{"kind":"sql","stmt":"ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_account_share_not_self"}]}
  v_err := NULL; v_con := NULL;
  BEGIN
    UPDATE api_keys
       SET account_shared_with_api_key_id = k_d, account_share_kind = 'duplicate'
     WHERE id = k_d;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
  END;
  IF v_err IS DISTINCT FROM '23514' OR v_con IS DISTINCT FROM 'api_keys_account_share_not_self' THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-c): a key marked as a duplicate of ITSELF was not refused by api_keys_account_share_not_self (SQLSTATE %, constraint %). The compose would drop the only key on that account.', v_err, v_con;
  END IF;

  -- ----- ACCT-d: a holder owned by ANOTHER user is REFUSED 42501 --------------
  -- T-167.1.2-05: enforced in the database, not only in the stamper.
  -- RED-UNDER: drop the api_keys_account_share_same_owner trigger on the LIVE
  --            database. The constraints all still pass, so only this arm sees it.
  -- RED-UNDER-M: {"arm":"ACCT-d","apply":[{"kind":"sql","stmt":"DROP TRIGGER api_keys_account_share_same_owner ON public.api_keys"}]}
  v_err := NULL; v_msg := NULL;
  BEGIN
    UPDATE api_keys
       SET account_shared_with_api_key_id = k_h, account_share_kind = 'duplicate'
     WHERE id = k_x;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  SELECT account_shared_with_api_key_id INTO v_holder FROM api_keys WHERE id = k_x;
  IF v_err IS DISTINCT FROM '42501' OR v_msg IS DISTINCT FROM 'ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER' OR v_holder IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-d): user B''s key was marked as sharing an account with user A''s key (SQLSTATE %, message %, stored holder %). A cross-tenant holder must be refused 42501 ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER, or one tenant''s book is silently shaped by another''s key.', v_err, v_msg, v_holder;
  END IF;

  -- Setup for the chain arms below: k_d is marked, k_h holds it. Every arm
  -- that follows needs a real, admitted marker to chain from or to.
  UPDATE api_keys
     SET account_shared_with_api_key_id = k_h, account_share_kind = 'duplicate'
   WHERE id = k_d;

  -- ----- ACCT-l: a holder id with NO api_keys row is REFUSED 23503 by name ----
  -- A missing holder is not a tenant question; a client that maps 42501 to
  -- "not yours" must not be told that about a key that does not exist.
  -- RED-UNDER: disable the trigger's not-found branch (IF FALSE) in migration
  --            20260925120000. The missing holder then falls to the owner test
  --            and is refused 42501 ACCOUNT_SHARE_HOLDER_NOT_SAME_OWNER.
  -- RED-UNDER-M: {"arm":"ACCT-l","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF NOT FOUND THEN\n    RAISE EXCEPTION 'ACCOUNT_SHARE_HOLDER_NOT_FOUND'","replace":"  IF FALSE THEN\n    RAISE EXCEPTION 'ACCOUNT_SHARE_HOLDER_NOT_FOUND'","occurrences":1}]}
  v_err := NULL; v_msg := NULL;
  BEGIN
    UPDATE api_keys
       SET account_shared_with_api_key_id = gen_random_uuid(), account_share_kind = 'duplicate'
     WHERE id = k_c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_err IS DISTINCT FROM '23503' OR v_msg IS DISTINCT FROM 'ACCOUNT_SHARE_HOLDER_NOT_FOUND' THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-l): a holder id naming no api_keys row was not refused with 23503 ACCOUNT_SHARE_HOLDER_NOT_FOUND (SQLSTATE %, message %).', v_err, v_msg;
  END IF;

  -- ----- ACCT-m: a holder that is ITSELF marked is REFUSED (chain, 2-cycle) ---
  -- The book counts a marked account once, through its holder. A chain would
  -- resolve an account through a key that is not counted, and a 2-cycle would
  -- leave the account counted by nobody.
  -- RED-UNDER: disable the holder-is-marked test (IF FALSE) in migration
  --            20260925120000. k_c -> k_d -> k_h is then stored.
  -- RED-UNDER-M: {"arm":"ACCT-m","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF v_holder_holder IS NOT NULL THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  v_err := NULL; v_msg := NULL;
  BEGIN
    UPDATE api_keys
       SET account_shared_with_api_key_id = k_d, account_share_kind = 'duplicate'
     WHERE id = k_c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  -- the 2-cycle: k_h (which holds k_d) names k_d, which already names k_h.
  v_err2 := NULL; v_msg2 := NULL;
  BEGIN
    UPDATE api_keys
       SET account_shared_with_api_key_id = k_d, account_share_kind = 'duplicate'
     WHERE id = k_h;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err2 = RETURNED_SQLSTATE, v_msg2 = MESSAGE_TEXT;
  END;
  SELECT count(*) INTO v_count
    FROM api_keys WHERE id IN (k_c, k_h) AND account_shared_with_api_key_id IS NOT NULL;
  IF v_err IS DISTINCT FROM '23000' OR v_msg IS DISTINCT FROM 'ACCOUNT_SHARE_HOLDER_IS_MARKED'
     OR v_err2 IS DISTINCT FROM '23000' OR v_msg2 IS DISTINCT FROM 'ACCOUNT_SHARE_HOLDER_IS_MARKED'
     OR v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-m): naming a MARKED key as holder was not refused with 23000 ACCOUNT_SHARE_HOLDER_IS_MARKED (chain: SQLSTATE %, %; 2-cycle: SQLSTATE %, %; marked rows written %).', v_err, v_msg, v_err2, v_msg2, v_count;
  END IF;

  -- ----- ACCT-n: a key that already HOLDS another cannot itself be marked -----
  -- The other direction of the same chain: k_d -> k_h -> k_c.
  -- RED-UNDER: disable the key-is-a-holder test (IF FALSE AND EXISTS) in
  --            migration 20260925120000.
  -- RED-UNDER-M: {"arm":"ACCT-n","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF EXISTS (\n    SELECT 1\n      FROM public.api_keys d","replace":"  IF FALSE AND EXISTS (\n    SELECT 1\n      FROM public.api_keys d","occurrences":1}]}
  v_err := NULL; v_msg := NULL;
  BEGIN
    UPDATE api_keys
       SET account_shared_with_api_key_id = k_c, account_share_kind = 'duplicate'
     WHERE id = k_h;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  SELECT account_shared_with_api_key_id INTO v_holder FROM api_keys WHERE id = k_h;
  IF v_err IS DISTINCT FROM '23000' OR v_msg IS DISTINCT FROM 'ACCOUNT_SHARE_KEY_IS_A_HOLDER' OR v_holder IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-n): a key another key names as holder was itself marked, or not refused with 23000 ACCOUNT_SHARE_KEY_IS_A_HOLDER (SQLSTATE %, message %, stored holder %).', v_err, v_msg, v_holder;
  END IF;

  -- ----- ACCT-o: a DEPARTED (disconnected) holder is REFUSED 55000 ------------
  -- The column says the holder is the LIVE key on that account; a departed key
  -- is counted only up to its end day, so it cannot stand in for a live one.
  -- RED-UNDER: disable the holder-is-live test (IF FALSE) in migration
  --            20260925120000.
  -- RED-UNDER-M: {"arm":"ACCT-o","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF v_holder_disc IS NOT NULL THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  v_err := NULL; v_msg := NULL;
  BEGIN
    UPDATE api_keys
       SET account_shared_with_api_key_id = k_gone, account_share_kind = 'duplicate'
     WHERE id = k_c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  SELECT account_shared_with_api_key_id INTO v_holder FROM api_keys WHERE id = k_c;
  IF v_err IS DISTINCT FROM '55000' OR v_msg IS DISTINCT FROM 'ACCOUNT_SHARE_HOLDER_NOT_LIVE' OR v_holder IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-o): a disconnected key was accepted as holder, or not refused with 55000 ACCOUNT_SHARE_HOLDER_NOT_LIVE (SQLSTATE %, message %, stored holder %).', v_err, v_msg, v_holder;
  END IF;

  -- ----- ACCT-p: clearing the holder while writing a DIFFERENT kind is REFUSED
  -- Only a write that leaves the kind alone (the FK action) has its kind
  -- cleared for it; a contradictory write must reach the CHECK, not be tidied.
  -- RED-UNDER: drop the kind-unchanged conjunct from the NULL-holder branch in
  --            migration 20260925120000, so every holder clear also clears the
  --            kind and the contradictory write is silently admitted.
  -- RED-UNDER-M: {"arm":"ACCT-p","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"      IF OLD.account_shared_with_api_key_id IS NOT NULL\n         AND NEW.account_share_kind IS NOT DISTINCT FROM OLD.account_share_kind THEN","replace":"      IF OLD.account_shared_with_api_key_id IS NOT NULL THEN","occurrences":1}]}
  v_err := NULL; v_con := NULL;
  BEGIN
    UPDATE api_keys
       SET account_shared_with_api_key_id = NULL, account_share_kind = 'composite_member'
     WHERE id = k_d;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
  END;
  SELECT account_shared_with_api_key_id, account_share_kind INTO v_holder, v_kind
    FROM api_keys WHERE id = k_d;
  IF v_err IS DISTINCT FROM '23514' OR v_con IS DISTINCT FROM 'api_keys_account_share_both_or_neither'
     OR v_holder IS DISTINCT FROM k_h OR v_kind IS DISTINCT FROM 'duplicate' THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-p): holder := NULL with kind := ''composite_member'' was not refused by api_keys_account_share_both_or_neither (SQLSTATE %, constraint %; stored holder %, kind %).', v_err, v_con, v_holder, v_kind;
  END IF;

  -- ----- ACCT-j: the owner can HARD-DELETE a HOLDER key -----------------------
  -- delete_allocator_api_key deletes the row; the FK's ON DELETE SET NULL action
  -- then nulls the dependent's holder, and the trigger must clear its kind in
  -- the same write, or api_keys_account_share_both_or_neither aborts the delete.
  -- RED-UNDER: delete the `NEW.account_share_kind := NULL` assignment from the
  --            trigger in migration 20260925120000, so the FK action leaves the
  --            kind behind and the both-or-neither CHECK aborts the delete.
  -- RED-UNDER-M: {"arm":"ACCT-j","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"        NEW.account_share_kind := NULL;","replace":"        NULL;","occurrences":1}]}
  UPDATE api_keys
     SET account_shared_with_api_key_id = k_h, account_share_kind = 'duplicate'
   WHERE id = k_d;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  v_err := NULL;
  BEGIN
    PERFORM public.delete_allocator_api_key(k_h, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_count FROM api_keys WHERE id = k_h;
  SELECT account_shared_with_api_key_id, account_share_kind INTO v_holder, v_kind
    FROM api_keys WHERE id = k_d;
  IF v_err IS NOT NULL OR v_count <> 0 OR v_holder IS NOT NULL OR v_kind IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-j): the owner could not hard-delete a key another key names as its holder (SQLSTATE %, %, constraint %; holder rows left %, dependent holder %, kind %). delete_allocator_api_key must succeed and leave the dependent with holder AND kind NULL.', v_err, v_msg, v_con, v_count, v_holder, v_kind;
  END IF;

  -- ----- ACCT-s: the sanitiser shape — ONE DELETE removing every key of the user
  -- The account sanitiser deletes all of a user's keys in one statement. A
  -- BEFORE DELETE trigger that updated sibling rows (the design this migration
  -- rejected) makes PostgreSQL refuse that statement.
  -- RED-UNDER: attach, on the LIVE database, the rejected BEFORE DELETE trigger
  --            that clears dependents' markers by updating sibling rows. The
  --            one-statement delete then fails with 27000.
  -- RED-UNDER-M: {"arm":"ACCT-s","apply":[{"kind":"sql","stmt":"CREATE FUNCTION public._acct_rejected_sibling_clear() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN UPDATE public.api_keys SET account_shared_with_api_key_id = NULL, account_share_kind = NULL WHERE account_shared_with_api_key_id = OLD.id; RETURN OLD; END $f$; CREATE TRIGGER api_keys_acct_rejected_sibling_clear BEFORE DELETE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION public._acct_rejected_sibling_clear()"}]}
  -- The rejected design only fails when the DELETE reaches the holder BEFORE a
  -- dependent (its sibling UPDATE then lands on a row the same statement
  -- deletes next). A cycle made that order-proof, but the trigger now refuses
  -- cycles, so the order is fixed instead: the holder is inserted FIRST, in its
  -- own statement, and its two dependents after it, already marked, so none of
  -- the three rows is ever updated and moved. Every plan for a user_id filter
  -- (seq scan, bitmap scan, or a btree whose equal keys are kept in heap order)
  -- visits rows in ctid order, and the precondition below checks that order
  -- rather than trusting it, so a layout that would make this arm vacuous
  -- fails loudly instead.
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_s1, uid_a, 'okx', 'acct sanitiser holder', 'enc', true);
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active,
                        account_shared_with_api_key_id, account_share_kind)
  VALUES (k_s2, uid_a, 'okx', 'acct sanitiser dependent 1', 'enc', true, k_s1, 'duplicate'),
         (k_s3, uid_a, 'okx', 'acct sanitiser dependent 2', 'enc', true, k_s1, 'duplicate');
  IF NOT ((SELECT ctid FROM api_keys WHERE id = k_s1) < (SELECT ctid FROM api_keys WHERE id = k_s2)
      AND (SELECT ctid FROM api_keys WHERE id = k_s1) < (SELECT ctid FROM api_keys WHERE id = k_s3)) THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-s): precondition — the sanitiser-shape holder does not sit before both dependents in heap order, so this arm could not tell the rejected design from the shipped one.';
  END IF;
  -- Pin the scan to heap order: a seq or bitmap scan visits rows by ctid, so
  -- the precondition above is the visit order. A future (user_id, <col>) index
  -- the planner picked would otherwise visit rows in <col> order, and with
  -- `label` the dependents sort before the holder, which would make this arm
  -- vacuous with every check still green. SET LOCAL ends with this DO block's
  -- transaction; only this arm's cleanup follows it.
  SET LOCAL enable_indexscan = off;
  SET LOCAL enable_indexonlyscan = off;
  v_err := NULL;
  BEGIN
    DELETE FROM api_keys WHERE user_id = uid_a;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  SELECT count(*) INTO v_count FROM api_keys WHERE user_id = uid_a;
  IF v_err IS NOT NULL OR v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-s): one DELETE removing a holder and its dependents together failed (SQLSTATE %, %; % row(s) left). The account sanitiser deletes every key of a user in one statement, so a user with a marked key could not be deleted.', v_err, v_msg, v_count;
  END IF;

  RAISE NOTICE 'PASS (ACCT behavioural): ordinary insert admitted; same-owner mark and clear admitted; bad kind, half marker, self-reference refused 23514; cross-tenant holder refused 42501; missing holder refused 23503; marked holder (chain and 2-cycle) and a key that already holds another refused 23000; departed holder refused 55000; a contradictory holder clear refused 23514; a holder key hard-deleted through delete_allocator_api_key clears the dependent''s holder and kind; one-statement delete of a holder and its dependents succeeds.';

  -- ----- cleanup: explicit, rather than relying on the profiles cascade -------
  DELETE FROM api_keys WHERE user_id IN (uid_a, uid_b);
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);
END $acct$;


DO $grants$
BEGIN
  -- ----- ACCT-f: authenticated can SELECT both marker columns ----------------
  -- RED-UNDER: REVOKE SELECT (account_share_kind) ON api_keys FROM authenticated
  --            on the LIVE database. The key card could not read the marker.
  -- RED-UNDER-M: {"arm":"ACCT-f","apply":[{"kind":"sql","stmt":"REVOKE SELECT (account_share_kind) ON public.api_keys FROM authenticated"}]}
  IF NOT has_column_privilege('authenticated', 'public.api_keys', 'account_shared_with_api_key_id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.api_keys', 'account_share_kind', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-f): authenticated lacks SELECT on a marker column, so the key card cannot show which key is a duplicate.';
  END IF;

  -- ----- ACCT-f2: authenticated can NOT write either marker column ------------
  -- Only the service-role stamper writes the marker (T-167.1.2-05).
  -- RED-UNDER: GRANT UPDATE (account_shared_with_api_key_id) ON api_keys TO
  --            authenticated on the LIVE database.
  -- RED-UNDER-M: {"arm":"ACCT-f2","apply":[{"kind":"sql","stmt":"GRANT UPDATE (account_shared_with_api_key_id) ON public.api_keys TO authenticated"}]}
  IF has_column_privilege('authenticated', 'public.api_keys', 'account_shared_with_api_key_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_share_kind', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_shared_with_api_key_id', 'INSERT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_share_kind', 'INSERT') THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-f2): authenticated can INSERT or UPDATE a marker column. A browser session could clear its own duplicate marker and count one account twice again.';
  END IF;

  -- ----- ACCT-g: anon can NOT read any new column ------------------------------
  -- RED-UNDER: GRANT SELECT (account_shared_with_api_key_id) ON api_keys TO anon
  --            on the LIVE database.
  -- RED-UNDER-M: {"arm":"ACCT-g","apply":[{"kind":"sql","stmt":"GRANT SELECT (account_shared_with_api_key_id) ON public.api_keys TO anon"}]}
  IF has_column_privilege('anon', 'public.api_keys', 'account_shared_with_api_key_id', 'SELECT')
     OR has_column_privilege('anon', 'public.api_keys', 'account_share_kind', 'SELECT')
     OR has_column_privilege('anon', 'public.api_keys', 'history_inclusion', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-g): anon holds SELECT on a new api_keys column (T-167.1.2-06).';
  END IF;

  -- ----- HIST-grant: authenticated can SELECT history_inclusion, not write it --
  -- RED-UNDER: REVOKE SELECT (history_inclusion) ON api_keys FROM authenticated
  --            on the LIVE database. The departed-keys overview could not show
  --            the owner's choice.
  -- RED-UNDER-M: {"arm":"HIST-grant","apply":[{"kind":"sql","stmt":"REVOKE SELECT (history_inclusion) ON public.api_keys FROM authenticated"}]}
  IF NOT has_column_privilege('authenticated', 'public.api_keys', 'history_inclusion', 'SELECT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'history_inclusion', 'UPDATE') THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-grant): authenticated must SELECT api_keys.history_inclusion and must not UPDATE it (the owner RPC is the only writer).';
  END IF;

  -- ----- HIST-acl: EXECUTE on the owner RPC is authenticated-only -------------
  -- RED-UNDER: GRANT EXECUTE ON set_departed_key_history_inclusion TO anon on the
  --            LIVE database.
  -- RED-UNDER-M: {"arm":"HIST-acl","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.set_departed_key_history_inclusion(uuid, text) TO anon"}]}
  IF NOT has_function_privilege('authenticated', 'public.set_departed_key_history_inclusion(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.set_departed_key_history_inclusion(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-acl): set_departed_key_history_inclusion must be EXECUTE-able by authenticated and by nobody anonymous.';
  END IF;

  RAISE NOTICE 'PASS (ACCT/HIST grants): marker columns and history_inclusion readable by authenticated only, writable by no client role; the owner RPC is authenticated-only.';
END $grants$;


DO $hist$
DECLARE
  v_run      text := replace(gen_random_uuid()::text, '-', '');
  uid_a      uuid := gen_random_uuid();
  uid_b      uuid := gen_random_uuid();
  k_live     uuid := gen_random_uuid();   -- user A, live
  k_gone     uuid := gen_random_uuid();   -- user A, soft-disconnected
  k_rev      uuid := gen_random_uuid();   -- user A, revoked, never disconnected
  v_err      text;
  v_msg      text;
  v_con      text;
  v_ret      boolean;
  v_val      text;
  v_jobs     int;
  v_retry_id uuid;                        -- user A's failed_retry recompose
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-acct-identity-ha-' || v_run || '@quantalyze.test', now(), now()),
         (uid_b, '00000000-0000-0000-0000-000000000000', 'test-acct-identity-hb-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'hist A', 'test-acct-identity-ha-' || v_run || '@quantalyze.test'),
         (uid_b, 'hist B', 'test-acct-identity-hb-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, disconnected_at, sync_status)
  VALUES (k_live, uid_a, 'okx',     'hist live',    'enc', true, NULL,  'idle'),
         (k_gone, uid_a, 'bybit',   'hist gone',    'enc', true, now(), 'idle'),
         (k_rev,  uid_a, 'binance', 'hist revoked', 'enc', true, NULL,  'revoked');

  -- ----- HIST-check: history_inclusion outside the set is REFUSED -------------
  -- RED-UNDER: drop api_keys_history_inclusion_valid on the LIVE database.
  -- RED-UNDER-M: {"arm":"HIST-check","apply":[{"kind":"sql","stmt":"ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_history_inclusion_valid"}]}
  v_err := NULL; v_con := NULL;
  BEGIN
    UPDATE api_keys SET history_inclusion = 'maybe' WHERE id = k_gone;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
  END;
  IF v_err IS DISTINCT FROM '23514' OR v_con IS DISTINCT FROM 'api_keys_history_inclusion_valid' THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-check): history_inclusion = ''maybe'' was not refused by api_keys_history_inclusion_valid (SQLSTATE %, constraint %).', v_err, v_con;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  -- ----- HIST-writes: 'exclude' on the caller's disconnected key is STORED -----
  -- RED-UNDER: make the RPC's UPDATE write the column back to itself in
  --            migration 20260925120000, so the owner's choice is dropped.
  -- RED-UNDER-M: {"arm":"HIST-writes","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"     SET history_inclusion = p_inclusion","replace":"     SET history_inclusion = history_inclusion","occurrences":1}]}
  v_err := NULL;
  BEGIN
    v_ret := public.set_departed_key_history_inclusion(k_gone, 'exclude');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
    v_msg := SQLERRM;
  END;
  SELECT history_inclusion INTO v_val FROM api_keys WHERE id = k_gone;
  -- Whether a job was queued at all is HIST-enqueues' question: under its twin
  -- the RPC refuses by name (HISTORY_RECOMPOSE_NOT_QUEUED) rather than report
  -- success with no job, and that refusal rolls this write back. That one
  -- refusal is left to HIST-enqueues, which fails on the next call's error.
  IF (v_err IS NOT NULL AND v_msg IS DISTINCT FROM 'HISTORY_RECOMPOSE_NOT_QUEUED')
     OR (v_err IS NULL AND (v_val IS DISTINCT FROM 'exclude' OR v_ret IS NOT TRUE)) THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-writes): set_departed_key_history_inclusion(disconnected key, ''exclude'') did not store it (SQLSTATE %, %; stored %, returned %).', v_err, v_msg, v_val, v_ret;
  END IF;

  -- ----- HIST-lock: the recompose job the RPC hands back is LOCKED by it -----
  -- The RPC's step 3 takes the job enqueue_compute_job returned FOR UPDATE, so
  -- no worker (the claim functions take rows FOR UPDATE SKIP LOCKED) can start
  -- it before the new value commits. This file runs one session, so it cannot
  -- watch a claimer being skipped; it reads the row's xmax instead. The job was
  -- inserted by the call above and nothing else has updated it, so a non-zero
  -- xmax is the RPC's lock-only mark. This proves the RPC locked the row, NOT
  -- the SKIP LOCKED behaviour, which rests on the claim functions. The call
  -- above found no job at step 1, so step 3 is the only lock taken.
  -- RED-UNDER: drop FOR UPDATE from the RPC's step 3 SELECT in migration
  --            20260925120000. The job the RPC hands back is then no longer
  --            locked by it (xmax stays 0). That is all this arm proves: the
  --            lock on the returned row. The row here is the RPC's own
  --            uncommitted insert, which no claimer can see either way, so the
  --            window the lock closes (a row another backend committed) is
  --            reasoned, not shown; step 1's FOR UPDATE is reasoned too.
  -- RED-UNDER-M: {"arm":"HIST-lock","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"     WHERE id = v_job\n       FOR UPDATE;","replace":"     WHERE id = v_job;","occurrences":1}]}
  -- Whether a job exists at all is HIST-enqueues' question (its twin deletes
  -- the enqueue, leaving no row), so this arm judges only a row that exists.
  SELECT count(*), max(xmax::text) INTO v_jobs, v_val
    FROM compute_jobs
   WHERE allocator_id = uid_a AND kind = 'derive_allocator_equity';
  IF v_jobs = 1 AND (v_val IS NULL OR v_val = '0') THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-lock): the caller''s recompose job is not locked by set_departed_key_history_inclusion (jobs %, xmax %). A worker could claim it and read the old value before the toggle commits.', v_jobs, v_val;
  END IF;

  -- ----- HIST-enqueues: the call asks for the caller's curve to be recomposed --
  -- Exactly ONE derive_allocator_equity job for the caller, even after a second
  -- call (the allocator-scoped in-flight dedup).
  -- RED-UNDER: delete the enqueue_compute_job call from the RPC in migration
  --            20260925120000. The toggle would be stored and never shown;
  --            the RPC now refuses a NULL job id by name, so this arm sees
  --            that refusal on its call.
  -- RED-UNDER-M: {"arm":"HIST-enqueues","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"      v_job := enqueue_compute_job(\n        p_strategy_id  := NULL,\n        p_kind         := 'derive_allocator_equity',\n        p_allocator_id := v_uid\n      );","replace":"      v_job := NULL;","occurrences":1}]}
  v_err := NULL;
  BEGIN
    v_ret := public.set_departed_key_history_inclusion(k_gone, 'exclude');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
    v_msg := SQLERRM;
  END;
  SELECT count(*) INTO v_jobs
    FROM compute_jobs
   WHERE allocator_id = uid_a AND kind = 'derive_allocator_equity';
  IF v_err IS NOT NULL OR v_jobs <> 1 OR v_ret IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-enqueues): after two calls the caller has % derive_allocator_equity job(s), expected exactly 1 (SQLSTATE %, %; second call returned %, expected false because nothing changed).', v_jobs, v_err, v_msg, v_ret;
  END IF;

  -- ----- HIST-reset: NULL resets to the default rule ---------------------------
  -- RED-UNDER: make the RPC's UPDATE ignore a NULL (COALESCE onto the stored
  --            value) in migration 20260925120000. The owner could never go back
  --            to the default rule.
  -- RED-UNDER-M: {"arm":"HIST-reset","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"     SET history_inclusion = p_inclusion","replace":"     SET history_inclusion = COALESCE(p_inclusion, history_inclusion)","occurrences":1}]}
  v_err := NULL;
  BEGIN
    v_ret := public.set_departed_key_history_inclusion(k_gone, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
    v_msg := SQLERRM;
  END;
  SELECT history_inclusion INTO v_val FROM api_keys WHERE id = k_gone;
  IF v_err IS NOT NULL OR v_val IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-reset): set_departed_key_history_inclusion(key, NULL) did not reset the column to NULL (SQLSTATE %, %; stored %).', v_err, v_msg, v_val;
  END IF;

  -- ----- HIST-revoked: a REVOKED (never disconnected) key is departed too ----
  -- RED-UNDER: drop the revoked leg from the RPC's departed test in migration
  --            20260925120000, so only a disconnected key counts as departed.
  -- RED-UNDER-M: {"arm":"HIST-revoked","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF v_disconnected IS NULL AND v_sync_status IS DISTINCT FROM 'revoked' THEN","replace":"  IF v_disconnected IS NULL THEN","occurrences":1}]}
  v_err := NULL;
  BEGIN
    v_ret := public.set_departed_key_history_inclusion(k_rev, 'include');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
    v_msg := SQLERRM;
  END;
  SELECT history_inclusion INTO v_val FROM api_keys WHERE id = k_rev;
  IF v_err IS NOT NULL OR v_val IS DISTINCT FROM 'include' THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-revoked): a credential-revoked key was not accepted as departed (SQLSTATE %, %; stored %). D-09: revoked keys get the toggle too.', v_err, v_msg, v_val;
  END IF;

  -- ----- HIST-live: a LIVE, non-revoked key is REFUSED by name, nothing written
  -- 55000 (object_not_in_prerequisite_state), DISTINCT from the 22023 of
  -- HIST-value, so the client maps the two refusals by code.
  -- RED-UNDER: disable the departed test in migration 20260925120000 (IF FALSE).
  -- RED-UNDER-M: {"arm":"HIST-live","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF v_disconnected IS NULL AND v_sync_status IS DISTINCT FROM 'revoked' THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  v_err := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.set_departed_key_history_inclusion(k_live, 'exclude');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  SELECT history_inclusion INTO v_val FROM api_keys WHERE id = k_live;
  IF v_err IS DISTINCT FROM '55000' OR v_msg IS DISTINCT FROM 'KEY_NOT_DEPARTED' OR v_val IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-live): a LIVE key was not refused with 55000 KEY_NOT_DEPARTED, or a value was written (SQLSTATE %, message %, stored %). A live key always counts.', v_err, v_msg, v_val;
  END IF;

  -- ----- HIST-value: a value outside include / exclude / NULL is REFUSED 22023 -
  -- RED-UNDER: disable the RPC's value test in migration 20260925120000
  --            (IF FALSE); the table CHECK then answers 23514 instead of the
  --            named 22023 the client maps.
  -- RED-UNDER-M: {"arm":"HIST-value","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF p_inclusion IS NOT NULL AND p_inclusion NOT IN ('include', 'exclude') THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  v_err := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.set_departed_key_history_inclusion(k_gone, 'maybe');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_err IS DISTINCT FROM '22023' OR v_msg IS DISTINCT FROM 'HISTORY_INCLUSION_INVALID' THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-value): p_inclusion = ''maybe'' was not refused with 22023 HISTORY_INCLUSION_INVALID (SQLSTATE %, message %).', v_err, v_msg;
  END IF;

  -- ----- HIST-owner: another user's key is REFUSED 42501, nothing written -----
  -- T-167.1.2-04. Two layers: the row lookup is scoped to the caller (so a
  -- foreign row is never even locked) AND the owner test refuses a mismatch.
  -- RED-UNDER: remove BOTH layers in migration 20260925120000 — the lookup's
  --            `AND user_id = v_uid` scope and the `v_owner <> v_uid` leg.
  -- RED-UNDER-M: {"arm":"HIST-owner","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"   WHERE id = p_api_key_id\n     AND user_id = v_uid\n     FOR UPDATE;","replace":"   WHERE id = p_api_key_id\n     FOR UPDATE;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF v_owner IS NULL OR v_owner <> v_uid THEN\n    RAISE EXCEPTION 'set_departed_key_history_inclusion: caller","replace":"  IF v_owner IS NULL THEN\n    RAISE EXCEPTION 'set_departed_key_history_inclusion: caller","occurrences":1}]}
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text, true);
  v_err := NULL;
  BEGIN
    v_ret := public.set_departed_key_history_inclusion(k_gone, 'include');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT history_inclusion INTO v_val FROM api_keys WHERE id = k_gone;
  SELECT count(*) INTO v_jobs
    FROM compute_jobs
   WHERE allocator_id = uid_b AND kind = 'derive_allocator_equity';
  IF v_err IS DISTINCT FROM '42501' OR v_val IS NOT NULL OR v_jobs <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-owner): user B''s call on user A''s key was not refused 42501, or it wrote or enqueued (SQLSTATE %, stored %, B''s jobs %).', v_err, v_val, v_jobs;
  END IF;

  -- ----- HIST-running: a toggle while the recompose is RUNNING is REFUSED ----
  -- A running derive_allocator_equity job may already have read the old value,
  -- and no second job can queue behind it (the in-flight dedup and the partial
  -- unique index both cover running). Folding the toggle into it would return
  -- success over a stale curve, so the RPC refuses by name, writes nothing and
  -- queues nothing; the owner retries once it ends.
  -- The RPC tests for a running job twice: before its write (step 2) and on
  -- the job its enqueue returns (step 3). In this single-session shape each
  -- test alone refuses, so a mutation of one is masked by the other (MEASURED
  -- 2026-09-26: either one-step mutation left this arm NO-RED). The twin
  -- therefore disables both.
  -- RED-UNDER: disable BOTH running refusals (IF FALSE) in migration
  --            20260925120000. The toggle is then stored and silently folded
  --            into the job that already read the old value.
  -- RED-UNDER-M: {"arm":"HIST-running","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF v_job_status = 'running' THEN","replace":"  IF FALSE THEN","occurrences":2,"nth":1},{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF v_job_status = 'running' THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  -- A worker claims the caller's pending recompose (the claim's own transition).
  UPDATE compute_jobs
     SET status = 'running', claimed_at = now(), claimed_by = 'acct-identity-test'
   WHERE allocator_id = uid_a AND kind = 'derive_allocator_equity' AND status = 'pending';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  v_err := NULL; v_msg := NULL; v_ret := NULL;
  BEGIN
    v_ret := public.set_departed_key_history_inclusion(k_gone, 'include');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT history_inclusion INTO v_val FROM api_keys WHERE id = k_gone;
  SELECT count(*) INTO v_jobs
    FROM compute_jobs
   WHERE allocator_id = uid_a AND kind = 'derive_allocator_equity';
  IF v_err IS DISTINCT FROM '55006' OR v_msg IS DISTINCT FROM 'HISTORY_RECOMPOSE_IN_PROGRESS'
     OR v_val IS NOT NULL OR v_jobs <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-running): a toggle while the caller''s recompose is RUNNING was not refused with 55006 HISTORY_RECOMPOSE_IN_PROGRESS, or it wrote or queued (SQLSTATE %, message %, returned %, stored %, jobs %). The running job already read the old value, so success here is a stale curve.', v_err, v_msg, v_ret, v_val, v_jobs;
  END IF;

  -- ----- HIST-retry: a toggle beside a failed_retry recompose REUSES it ------
  -- enqueue_compute_job's dedup and compute_jobs_one_inflight_per_kind_allocator
  -- both ignore failed_retry, so an enqueue here would insert a pending TWIN of
  -- the caller's failed_retry row. MEASURED on the pg-lane 2026-09-26: that
  -- pairing, once the failed_retry row is due, makes every claim entry point
  -- raise 23505 (the worker-spin class). The RPC must instead reuse the
  -- failed_retry row and put it back to pending, due now, the state the stall
  -- watchdog writes. Pending, not failed_retry moved forward: a pending row is
  -- inside that unique index and the enqueue's dedup, so a later epilogue
  -- enqueue folds onto it instead of building the same 23505 pairing. The id
  -- leg proves the ORIGINAL row was reused, not a fresh insert; the
  -- next_attempt_at leg proves it was moved.
  -- RED-UNDER: make the RPC's failed_retry lookup find nothing (AND FALSE) in
  --            migration 20260925120000. The enqueue then queues a pending
  --            twin beside the failed_retry row.
  -- RED-UNDER-M: {"arm":"HIST-retry","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"     AND cj.status = 'failed_retry'","replace":"     AND FALSE","occurrences":1}]}
  -- The worker's attempt failed and backed off (mark_compute_job_failed's move).
  UPDATE compute_jobs
     SET status = 'failed_retry', claimed_at = NULL, claimed_by = NULL,
         attempts = 1, next_attempt_at = now() + interval '10 minutes'
   WHERE allocator_id = uid_a AND kind = 'derive_allocator_equity' AND status = 'running'
  RETURNING id INTO v_retry_id;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  v_err := NULL; v_msg := NULL; v_ret := NULL;
  BEGIN
    v_ret := public.set_departed_key_history_inclusion(k_gone, 'exclude');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  PERFORM set_config('request.jwt.claims', '', true);

  SELECT history_inclusion INTO v_val FROM api_keys WHERE id = k_gone;
  SELECT count(*) INTO v_jobs
    FROM compute_jobs
   WHERE allocator_id = uid_a AND kind = 'derive_allocator_equity'
     AND status IN ('pending', 'failed_retry', 'running', 'done_pending_children');
  IF v_err IS NOT NULL OR v_val IS DISTINCT FROM 'exclude' OR v_jobs <> 1
     OR v_retry_id IS NULL
     OR EXISTS (SELECT 1 FROM compute_jobs
                 WHERE allocator_id = uid_a AND kind = 'derive_allocator_equity'
                   AND status = 'failed_retry')
     OR NOT EXISTS (SELECT 1 FROM compute_jobs
                     WHERE id = v_retry_id
                       AND status = 'pending' AND next_attempt_at <= now()) THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-retry): a toggle beside the caller''s failed_retry recompose did not reuse it (SQLSTATE %, %; stored %, in-flight-or-retry rows %, expected exactly 1: the original row %, back to pending and due now, with no failed_retry row and no twin).', v_err, v_msg, v_val, v_jobs, v_retry_id;
  END IF;

  RAISE NOTICE 'PASS (HIST behavioural): bad value refused by CHECK; exclude stored on a disconnected key with exactly one recompose job; NULL resets; revoked key accepted; live key refused 55000 KEY_NOT_DEPARTED; bad value refused 22023; cross-tenant refused 42501 with nothing written; a toggle while the recompose runs refused 55006 with nothing written or queued; a toggle beside a failed_retry recompose puts that same row back to pending, due now, with no twin.';

  DELETE FROM compute_jobs WHERE allocator_id IN (uid_a, uid_b);
  DELETE FROM api_keys WHERE user_id IN (uid_a, uid_b);
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);
END $hist$;


DO $recon$
DECLARE
  v_run      text := replace(gen_random_uuid()::text, '-', '');
  uid_a      uuid := gen_random_uuid();
  uid_b      uuid := gen_random_uuid();   -- another tenant
  k_old      uuid := gen_random_uuid();   -- disconnected, account V
  k_new      uuid := gen_random_uuid();   -- live, same account V
  k_b        uuid := gen_random_uuid();   -- user B, live, okx, same account id V
  k_other    uuid := gen_random_uuid();   -- user A, live, bybit, same account id V
  c_acct     CONSTANT text := 'acct-identity-v1';
  v_err      text;
  v_msg      text;
  v_ret      boolean;
  v_disc     timestamptz;
  v_status   text;
  v_sync_err text;
  v_hist     text;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-acct-identity-r-' || v_run || '@quantalyze.test', now(), now()),
         (uid_b, '00000000-0000-0000-0000-000000000000', 'test-acct-identity-rb-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'recon A', 'test-acct-identity-r-' || v_run || '@quantalyze.test'),
         (uid_b, 'recon B', 'test-acct-identity-rb-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  -- k_old carries an owner's 'exclude' from its PAST departure (RECON-hist).
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, venue_account_id, disconnected_at, sync_status, history_inclusion)
  VALUES (k_old, uid_a, 'okx', 'recon old', 'enc', true, c_acct, now(), 'idle', 'exclude'),
         (k_new, uid_a, 'okx', 'recon new', 'enc', true, c_acct, NULL,  'idle', NULL);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  -- ----- RECON-twin: reconnect into an occupied slot is REFUSED BY NAME -------
  -- Pitfall 5: once ccxt keys carry an account id, this is reachable for OKX,
  -- Bybit, Binance and Deribit, not only MT5.
  -- RED-UNDER: disable the refusal block in reconnect_allocator_api_key in
  --            migration 20260925120000 (IF FALSE). The UPDATE then reaches the
  --            unique index and fails 23505 with the INDEX's message, which the
  --            client cannot map to the named copy.
  -- RED-UNDER-M: {"arm":"RECON-twin","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF v_venue_acct IS NOT NULL AND EXISTS (","replace":"  IF FALSE AND EXISTS (","occurrences":1}]}
  v_err := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.reconnect_allocator_api_key(k_old);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  SELECT disconnected_at INTO v_disc FROM api_keys WHERE id = k_old;
  IF v_err IS DISTINCT FROM '23505' OR v_msg IS DISTINCT FROM 'KEY_VENUE_ALREADY_CONNECTED' OR v_disc IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (RECON-twin): reconnecting a key whose account a LIVE sibling already holds was not refused with 23505 KEY_VENUE_ALREADY_CONNECTED, or the key came back live (SQLSTATE %, message %, disconnected_at %).', v_err, v_msg, v_disc;
  END IF;

  -- ----- RECON-ok: with NO live twin, reconnect behaves exactly as before -----
  -- RED-UNDER: drop the `s.disconnected_at IS NULL` conjunct from the refusal's
  --            sibling test in migration 20260925120000, so a DISCONNECTED
  --            sibling also blocks a reconnect — the predicate no longer tracks
  --            the unique index's live-rows predicate.
  -- RED-UNDER-M: {"arm":"RECON-ok","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"       AND s.disconnected_at IS NULL\n       AND s.id <> p_api_key_id","replace":"       AND s.id <> p_api_key_id","occurrences":1}]}
  UPDATE api_keys SET disconnected_at = now() WHERE id = k_new;
  UPDATE api_keys SET sync_error = 'acct identity test', sync_status = 'error' WHERE id = k_old;
  v_err := NULL; v_ret := NULL;
  BEGIN
    v_ret := public.reconnect_allocator_api_key(k_old);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
    v_msg := SQLERRM;
  END;
  SELECT disconnected_at, sync_status, sync_error INTO v_disc, v_status, v_sync_err
    FROM api_keys WHERE id = k_old;
  IF v_err IS NOT NULL OR v_ret IS NOT TRUE OR v_disc IS NOT NULL
     OR v_status IS DISTINCT FROM 'idle' OR v_sync_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (RECON-ok): with no LIVE twin, reconnect did not return true and reset the key (SQLSTATE %, %; returned %, disconnected_at %, sync_status %, sync_error %).', v_err, v_msg, v_ret, v_disc, v_status, v_sync_err;
  END IF;

  -- ----- RECON-hist: a reconnect RESETS the departed-history choice to NULL ---
  -- An include/exclude chosen for a PAST departure must not silently apply to
  -- the next one: once the key is live again the choice has nothing to govern,
  -- and a later disconnect starts from the default rule.
  -- RED-UNDER: drop `history_inclusion = NULL` from the reconnect UPDATE in
  --            migration 20260925120000.
  -- RED-UNDER-M: {"arm":"RECON-hist","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"        sync_status     = 'idle',\n        history_inclusion = NULL","replace":"        sync_status     = 'idle'","occurrences":1}]}
  SELECT history_inclusion INTO v_hist FROM api_keys WHERE id = k_old;
  IF v_hist IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (RECON-hist): after a reconnect the key still carries history_inclusion = % from its past departure; a later disconnect would silently inherit that choice.', v_hist;
  END IF;

  -- ----- RECON-tenant: ANOTHER user's live key on the same account id is NOT a twin
  -- api_keys_user_exchange_venue_account_uniq leads with user_id; the refusal
  -- must track it, or one tenant's key blocks another tenant's reconnect.
  -- RED-UNDER: drop the `s.user_id = v_uid` conjunct from the refusal's
  --            sibling test in migration 20260925120000.
  -- RED-UNDER-M: {"arm":"RECON-tenant","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"     WHERE s.user_id = v_uid\n       AND s.exchange = v_exchange","replace":"     WHERE s.exchange = v_exchange","occurrences":1}]}
  UPDATE api_keys SET disconnected_at = now() WHERE id = k_old;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, venue_account_id, disconnected_at, sync_status)
  VALUES (k_b, uid_b, 'okx', 'recon other tenant', 'enc', true, c_acct, NULL, 'idle');
  v_err := NULL; v_msg := NULL; v_ret := NULL;
  BEGIN
    v_ret := public.reconnect_allocator_api_key(k_old);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  SELECT disconnected_at INTO v_disc FROM api_keys WHERE id = k_old;
  IF v_err IS NOT NULL OR v_ret IS NOT TRUE OR v_disc IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (RECON-tenant): another user''s live key on the same exchange and account id blocked this user''s reconnect (SQLSTATE %, message %; returned %, disconnected_at %).', v_err, v_msg, v_ret, v_disc;
  END IF;

  -- ----- RECON-other-exchange: the same account id on ANOTHER exchange is NOT a twin
  -- RED-UNDER: drop the `s.exchange = v_exchange` conjunct from the refusal's
  --            sibling test in migration 20260925120000.
  -- RED-UNDER-M: {"arm":"RECON-other-exchange","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"       AND s.exchange = v_exchange\n","replace":"\n","occurrences":1}]}
  UPDATE api_keys SET disconnected_at = now() WHERE id = k_old;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, venue_account_id, disconnected_at, sync_status)
  VALUES (k_other, uid_a, 'bybit', 'recon other exchange', 'enc', true, c_acct, NULL, 'idle');
  v_err := NULL; v_msg := NULL; v_ret := NULL;
  BEGIN
    v_ret := public.reconnect_allocator_api_key(k_old);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  SELECT disconnected_at INTO v_disc FROM api_keys WHERE id = k_old;
  IF v_err IS NOT NULL OR v_ret IS NOT TRUE OR v_disc IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (RECON-other-exchange): a live key of this user on ANOTHER exchange with the same account id blocked the reconnect (SQLSTATE %, message %; returned %, disconnected_at %).', v_err, v_msg, v_ret, v_disc;
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);

  RAISE NOTICE 'PASS (RECON behavioural): reconnect into an occupied slot refused 23505 KEY_VENUE_ALREADY_CONNECTED and the key stays disconnected; with only a disconnected sibling the reconnect returns true, resets the key and clears its history_inclusion; another tenant''s key and another exchange''s key on the same account id do not block it.';

  DELETE FROM api_keys WHERE user_id IN (uid_a, uid_b);
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);
END $recon$;
