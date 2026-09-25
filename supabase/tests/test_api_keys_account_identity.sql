-- Test for migration 20260925120000 — Phase 167.1.2 ACCOUNTTRUTH, plan 03.
--
-- WHAT THE MIGRATION FIXES. Nothing stopped two api keys that read the SAME
-- exchange account from both counting in an allocator's book. The migration
-- adds the database half of the answer:
--   * a duplicate MARKER (account_shared_with_api_key_id + account_share_kind,
--     D-11) the service-role identity stamper writes, both-or-neither, never
--     self-referencing, same owner only, and never an obstacle to deleting a
--     key;
--   * a departed-key history flag (history_inclusion) and its owner RPC
--     set_departed_key_history_inclusion (D-05, D-09);
--   * a NAMED refusal in reconnect_allocator_api_key when a live sibling already
--     holds the same (user, exchange, venue_account_id) (Pitfall 5).
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
  k_s1       uuid := gen_random_uuid();   -- user A, sanitiser-shape holder
  k_s2       uuid := gen_random_uuid();   -- user A, sanitiser-shape dependent
  v_err      text;
  v_msg      text;
  v_con      text;
  v_holder   uuid;
  v_kind     text;
  v_count    int;
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
  -- the wizard RPCs) is refused 42501 — no one can connect a key at all.
  -- RED-UNDER: narrow the trigger's NULL-holder short-circuit to UPDATE only in
  --            migration 20260925120000, so an INSERT with a NULL holder falls
  --            through to the holder lookup, finds no row, and is refused.
  -- RED-UNDER-M: {"arm":"ACCT-h","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF NEW.account_shared_with_api_key_id IS NULL THEN","replace":"  IF NEW.account_shared_with_api_key_id IS NULL AND TG_OP = 'UPDATE' THEN","occurrences":1}]}
  v_err := NULL;
  BEGIN
    INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
    VALUES (k_h,  uid_a, 'okx', 'acct holder',     'enc', true),
           (k_d,  uid_a, 'okx', 'acct dependent',  'enc', true),
           (k_x,  uid_b, 'okx', 'acct other user', 'enc', true),
           (k_s1, uid_a, 'okx', 'acct sanitiser holder',    'enc', true),
           (k_s2, uid_a, 'okx', 'acct sanitiser dependent', 'enc', true);
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
  -- RED-UNDER-M: {"arm":"ACCT-e","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF v_holder_owner IS NULL OR v_holder_owner IS DISTINCT FROM NEW.user_id THEN","replace":"  IF TRUE THEN","occurrences":1}]}
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
  --            the holder lookup and is refused 42501.
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
  v_err := NULL;
  BEGIN
    UPDATE api_keys
       SET account_shared_with_api_key_id = k_h, account_share_kind = 'duplicate'
     WHERE id = k_x;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
  END;
  SELECT account_shared_with_api_key_id INTO v_holder FROM api_keys WHERE id = k_x;
  IF v_err IS DISTINCT FROM '42501' OR v_holder IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-d): user B''s key was marked as sharing an account with user A''s key (SQLSTATE %, stored holder %). A cross-tenant holder must be refused 42501, or one tenant''s book is silently shaped by another''s key.', v_err, v_holder;
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
  -- The two keys name EACH OTHER. Whichever row the DELETE reaches first, the
  -- other is still undeleted, so the rejected design's sibling UPDATE always
  -- lands on a row the same statement deletes next. Deterministic, whatever
  -- order the executor visits the rows in.
  UPDATE api_keys
     SET account_shared_with_api_key_id = k_s1, account_share_kind = 'duplicate'
   WHERE id = k_s2;
  UPDATE api_keys
     SET account_shared_with_api_key_id = k_s2, account_share_kind = 'duplicate'
   WHERE id = k_s1;
  v_err := NULL;
  BEGIN
    DELETE FROM api_keys WHERE user_id = uid_a;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  SELECT count(*) INTO v_count FROM api_keys WHERE user_id = uid_a;
  IF v_err IS NOT NULL OR v_count <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (ACCT-s): one DELETE removing a holder and its dependent together failed (SQLSTATE %, %; % row(s) left). The account sanitiser deletes every key of a user in one statement, so a user with a marked key could not be deleted.', v_err, v_msg, v_count;
  END IF;

  RAISE NOTICE 'PASS (ACCT behavioural): ordinary insert admitted; same-owner mark and clear admitted; bad kind, half marker, self-reference refused 23514; cross-tenant holder refused 42501; a holder key hard-deleted through delete_allocator_api_key clears the dependent''s holder and kind; one-statement delete of holder + dependent succeeds.';

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
  IF v_err IS NOT NULL OR v_val IS DISTINCT FROM 'exclude' OR v_ret IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-writes): set_departed_key_history_inclusion(disconnected key, ''exclude'') did not store it (SQLSTATE %, %; stored %, returned %).', v_err, v_msg, v_val, v_ret;
  END IF;

  -- ----- HIST-enqueues: the call asks for the caller's curve to be recomposed --
  -- Exactly ONE derive_allocator_equity job for the caller, even after a second
  -- call (the allocator-scoped in-flight dedup).
  -- RED-UNDER: delete the enqueue_compute_job call from the RPC in migration
  --            20260925120000. The toggle would be stored and never shown.
  -- RED-UNDER-M: {"arm":"HIST-enqueues","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  PERFORM enqueue_compute_job(\n    p_strategy_id  := NULL,\n    p_kind         := 'derive_allocator_equity',\n    p_allocator_id := v_uid\n  );","replace":"  NULL;","occurrences":1}]}
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
  -- RED-UNDER: disable the departed test in migration 20260925120000 (IF FALSE).
  -- RED-UNDER-M: {"arm":"HIST-live","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF v_disconnected IS NULL AND v_sync_status IS DISTINCT FROM 'revoked' THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  v_err := NULL; v_msg := NULL;
  BEGIN
    v_ret := public.set_departed_key_history_inclusion(k_live, 'exclude');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  SELECT history_inclusion INTO v_val FROM api_keys WHERE id = k_live;
  IF v_err IS DISTINCT FROM '22023' OR v_msg IS DISTINCT FROM 'KEY_NOT_DEPARTED' OR v_val IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (HIST-live): a LIVE key was not refused with 22023 KEY_NOT_DEPARTED, or a value was written (SQLSTATE %, message %, stored %). A live key always counts.', v_err, v_msg, v_val;
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
  -- T-167.1.2-04.
  -- RED-UNDER: drop the `v_owner <> v_uid` leg of the RPC's ownership test in
  --            migration 20260925120000.
  -- RED-UNDER-M: {"arm":"HIST-owner","apply":[{"kind":"edit","file":"supabase/migrations/20260925120000_api_keys_account_identity.sql","find":"  IF v_owner IS NULL OR v_owner <> v_uid THEN\n    RAISE EXCEPTION 'set_departed_key_history_inclusion: caller","replace":"  IF v_owner IS NULL THEN\n    RAISE EXCEPTION 'set_departed_key_history_inclusion: caller","occurrences":1}]}
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

  RAISE NOTICE 'PASS (HIST behavioural): bad value refused by CHECK; exclude stored on a disconnected key with exactly one recompose job; NULL resets; revoked key accepted; live key refused 22023 KEY_NOT_DEPARTED; bad value refused 22023; cross-tenant refused 42501 with nothing written.';

  DELETE FROM compute_jobs WHERE allocator_id IN (uid_a, uid_b);
  DELETE FROM api_keys WHERE user_id IN (uid_a, uid_b);
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);
END $hist$;


DO $recon$
DECLARE
  v_run      text := replace(gen_random_uuid()::text, '-', '');
  uid_a      uuid := gen_random_uuid();
  k_old      uuid := gen_random_uuid();   -- disconnected, account V
  k_new      uuid := gen_random_uuid();   -- live, same account V
  c_acct     CONSTANT text := 'acct-identity-v1';
  v_err      text;
  v_msg      text;
  v_ret      boolean;
  v_disc     timestamptz;
  v_status   text;
  v_sync_err text;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-acct-identity-r-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'recon A', 'test-acct-identity-r-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, venue_account_id, disconnected_at, sync_status)
  VALUES (k_old, uid_a, 'okx', 'recon old', 'enc', true, c_acct, now(), 'idle'),
         (k_new, uid_a, 'okx', 'recon new', 'enc', true, c_acct, NULL,  'idle');

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

  PERFORM set_config('request.jwt.claims', '', true);

  RAISE NOTICE 'PASS (RECON behavioural): reconnect into an occupied slot refused 23505 KEY_VENUE_ALREADY_CONNECTED and the key stays disconnected; with only a disconnected sibling the reconnect returns true and resets the key.';

  DELETE FROM api_keys WHERE user_id = uid_a;
  DELETE FROM auth.users WHERE id = uid_a;
END $recon$;
