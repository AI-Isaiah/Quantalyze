-- Test: public.insert_api_key, the audited api_keys writer (Phase 243 DBBACKSTOP,
-- plan 05, DBACC-02). Migration 20261127120100.
--
-- WHY THIS FILE EXISTS. Phase 243 makes insert_api_key the one sanctioned way for
-- service_role to insert an api_keys row: it stamps attested_venue from the exchange,
-- normalises the venue login and server, and is refused to every client role. PR-B moves
-- the validate-and-encrypt route and the seeds onto it; PR-C fences direct inserts. The
-- contract below is what those callers rely on, so each clause of it is an arm.
--
-- THE ARMS (the roster is the sentinel at the foot of the file):
--   R1  POSITIVE, ALWAYS ACTIVE: a service_role call lands a row owned by p_user_id with
--       attested_venue = exchange, and returns the new key's uuid.
--   R2  anon, authenticated and PUBLIC hold no EXECUTE on the function.
--   R3  the in-body gate refuses every JWT role but service_role (authenticated, no claims,
--       malformed claims) with 42501 even when the session is the owner.
--   R4  exactly one overload exists, SECURITY DEFINER, with the pinned search_path.
--   R5  normalisation: server trimmed and lower-cased, blank server and blank login stored
--       NULL, login trimmed, and a value already in the route's normal form stored unchanged.
--   R6  p_id given is the stored id; p_id omitted yields a fresh uuid.
--   R7  a NULL p_user_id is refused with 22023.
--   R8  a duplicate venue identity raises 23505 whose message names
--       api_keys_user_exchange_venue_account_uniq (the route maps that name).
--   R9  every parameter lands in its OWN column: a call with a distinct value per
--       parameter (a non-default p_kek_version included) reads back column for column,
--       the normalised venue login and server and the stamped attested_venue with them,
--       and an omitted p_kek_version stores 1.
--
-- WHICH LANE PROVES WHAT. The pg-lane bites (scripts/pg-lane/run.sh creates anon,
-- authenticated and service_role BARE on a vanilla cluster); the local-stack lane runs
-- the same file as a sanity check against the real Supabase image. Assertions are read
-- AFTER `RESET ROLE`, never inside an exception handler (lint rule R1).
--
-- ⛔ NO SKIP-WHEN-UNAPPLIED BRANCH. If the migration is absent the call is an undefined
-- function and the gate fails. A gate that skipped there would pass on exactly the
-- database it exists to catch.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent RED-UNDER-M
-- object that scripts/mutation-runner executes (schema in scripts/mutation-runner/GRAMMAR.md).
-- The setup list is what the lane applies before this gate, in order: the api_keys chain
-- test_api_keys_venue_identity_uniq.sql uses (so the scrub triggers, the venue columns and
-- the unique index exist), the profiles foreign key stand-in, then the migration LAST so
-- scripts/sql-gate-subset.mjs selects this gate on a push that changes it.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql","supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql","supabase/migrations/20261123180000_api_keys_venue_server.sql","supabase/migrations/20261125132334_api_keys_venue_server_owner_read.sql","supabase/migrations/20261126140500_api_keys_venue_server_index.sql","scripts/pg-lane/fixtures/41-fixture-api-keys-user-id-fk.sql","supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql"]}
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_insert_api_key_rpc.sql

BEGIN;

-- A caller that never raises: it returns 'OK|<id>' or '<SQLSTATE>|<message>', so an arm can
-- assert AFTER the role is reset instead of inside a handler (lint rule R1). It is a plain
-- invoker function, so the call it makes is made by whatever role the session holds.
CREATE FUNCTION pg_temp.iak_try(
  p_owner uuid, p_exchange text, p_login text, p_server text, p_id uuid DEFAULT NULL
) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
  v := public.insert_api_key(p_owner, p_exchange, 'iak-try', 'x', NULL, NULL, NULL, NULL, NULL, p_login, p_server, p_id);
  RETURN 'OK|' || v::text;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || '|' || SQLERRM;
END
$f$;

DO $$
DECLARE
  v_owner     uuid := gen_random_uuid();
  v_id        uuid;
  v_row       record;
  v_out       text;
  v_out2      text;
  v_out3      text;
  v_oid       oid;
  v_n         integer;
  v_cfg       boolean;
  v_pub       boolean;
  v_given     uuid := gen_random_uuid();
  v_id2       uuid;
BEGIN
  -- ---- fixture, seeded as the migration/owner role ---------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at, raw_user_meta_data)
  VALUES (v_owner, '00000000-0000-0000-0000-000000000000',
          'iak-' || v_owner::text || '@quantalyze.test', now(), now(), '{"role":"manager"}'::jsonb);
  INSERT INTO public.profiles (id, display_name) VALUES (v_owner, 'iak-owner')
  ON CONFLICT (id) DO NOTHING;

  -- ===== ARM R1 - POSITIVE, ALWAYS ACTIVE: service_role lands an attested row ==============
  -- A JWT role is simulated the way the other api_keys gates do: set request.jwt.claims,
  -- then switch role. The function is SECURITY DEFINER, so the INSERT itself runs as its
  -- owner and passes the api_keys scrub triggers; only the in-body gate reads the claim.
  -- RED-UNDER: replace the attested_venue VALUE in the INSERT of migration 20261127120100
  --            with NULL. The row still lands (the CHECK admits NULL), so only reading the
  --            stored attested_venue back catches a writer that stopped attesting.
  -- RED-UNDER-M: {"arm":"R1","apply":[{"kind":"edit","file":"supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql","find":"p_exchange, NULLIF(btrim(p_venue_account_id,","replace":"NULL, NULLIF(btrim(p_venue_account_id,","occurrences":1}]}
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  v_id := public.insert_api_key(v_owner, 'deribit', 'iak-r1', 'x');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R1): insert_api_key returned NULL, expected the new key''s uuid';
  END IF;
  SELECT k.user_id, k.exchange, k.attested_venue, k.label INTO v_row
    FROM public.api_keys k WHERE k.id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (R1): insert_api_key returned % but no api_keys row has that id', v_id;
  END IF;
  IF v_row.user_id IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'TEST FAILED (R1): the stored user_id is %, expected the owner passed in (%)', v_row.user_id, v_owner;
  END IF;
  IF v_row.exchange IS DISTINCT FROM 'deribit' OR v_row.attested_venue IS DISTINCT FROM v_row.exchange THEN
    RAISE EXCEPTION 'TEST FAILED (R1): stored exchange % and attested_venue %, expected both deribit (the writer attests the exchange)', v_row.exchange, COALESCE(v_row.attested_venue, 'NULL');
  END IF;

  v_oid := to_regprocedure('public.insert_api_key(uuid,text,text,text,text,text,text,text,integer,text,text,uuid)');

  -- ===== ARM R2 - anon, authenticated and PUBLIC hold no EXECUTE ===========================
  -- RED-UNDER: GRANT EXECUTE on insert_api_key to authenticated on the live lane, the
  --            pg_default_acl re-grant a DROP + CREATE without the REVOKE would leave behind.
  --            A browser role could then mint an attested key.
  -- RED-UNDER-M: {"arm":"R2","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.insert_api_key(uuid, text, text, text, text, text, text, text, integer, text, text, uuid) TO authenticated"}]}
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (R2): anon may EXECUTE insert_api_key, expected it revoked';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (R2): authenticated may EXECUTE insert_api_key, expected it revoked';
  END IF;
  SELECT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                  WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') INTO v_pub;
  IF v_pub THEN
    RAISE EXCEPTION 'TEST FAILED (R2): PUBLIC holds EXECUTE on insert_api_key, expected it revoked';
  END IF;

  -- ===== ARM R3 - the in-body gate refuses every JWT role but service_role =================
  -- The session role stays postgres, which holds EXECUTE by ownership, so only the in-body
  -- gate can refuse. Three claim shapes: authenticated, none at all, and malformed.
  -- RED-UNDER: make the in-body role comparison in migration 20261127120100 admit any role
  --            (`IF false THEN`). The REVOKE still keeps clients out through PostgREST, but
  --            a role that reaches the body (a future GRANT, a SECDEF caller) is admitted.
  -- RED-UNDER-M: {"arm":"R3","apply":[{"kind":"edit","file":"supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql","find":"IF v_jwt_role IS DISTINCT FROM 'service_role' THEN","replace":"IF false THEN","occurrences":1}]}
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  v_out := pg_temp.iak_try(v_owner, 'binance', NULL, NULL);
  PERFORM set_config('request.jwt.claims', NULL, true);
  v_out2 := pg_temp.iak_try(v_owner, 'binance', NULL, NULL);
  PERFORM set_config('request.jwt.claims', 'not json', true);
  v_out3 := pg_temp.iak_try(v_owner, 'binance', NULL, NULL);
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF v_out NOT LIKE '42501|insert_api_key: caller role (authenticated)%' THEN
    RAISE EXCEPTION 'TEST FAILED (R3): an authenticated-claims call answered %, expected 42501 insert_api_key: caller role (authenticated)', v_out;
  END IF;
  IF v_out2 NOT LIKE '42501|insert_api_key: caller role (<none>)%' THEN
    RAISE EXCEPTION 'TEST FAILED (R3): a call with no claims answered %, expected 42501 insert_api_key: caller role (<none>)', v_out2;
  END IF;
  IF v_out3 NOT LIKE '42501|insert_api_key: caller role (<none>)%' THEN
    RAISE EXCEPTION 'TEST FAILED (R3): a call with malformed claims answered %, expected the fail-closed 42501 refusal', v_out3;
  END IF;

  -- ===== ARM R4 - exactly one overload, SECURITY DEFINER, pinned search_path ===============
  -- RED-UNDER: mint a SECOND insert_api_key overload on the live lane. PostgREST resolves
  --            rpc() by named parameters and answers PGRST203 to every caller.
  -- RED-UNDER-M: {"arm":"R4","apply":[{"kind":"sql","stmt":"CREATE FUNCTION public.insert_api_key(p_user_id uuid) RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid'"}]}
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'insert_api_key';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (R4): % insert_api_key overload(s) in public, expected exactly 1', v_n;
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid) THEN
    RAISE EXCEPTION 'TEST FAILED (R4): insert_api_key is not SECURITY DEFINER';
  END IF;
  SELECT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) AS c(setting)
                  WHERE p.oid = v_oid AND c.setting = 'search_path=public, pg_catalog') INTO v_cfg;
  IF NOT v_cfg THEN
    RAISE EXCEPTION 'TEST FAILED (R4): insert_api_key does not pin search_path to public, pg_catalog';
  END IF;

  -- ===== ARM R5 - normalisation of the venue login and server ==============================
  -- RED-UNDER: remove the lower() from the server expression in migration 20261127120100.
  --            A mixed-case server is then stored as typed, so the same broker server reads
  --            as two accounts against the lower-cased values every other writer stores.
  -- RED-UNDER-M: {"arm":"R5","apply":[{"kind":"edit","file":"supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql","find":"NULLIF(lower(btrim(p_venue_server,","replace":"NULLIF((btrim(p_venue_server,","occurrences":1}]}
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.iak_try(v_owner, 'mt5', E' \t1001 ', E'  \tMyBroker-Live \t ');
  v_out2 := pg_temp.iak_try(v_owner, 'mt5', '1002', E' \t ');
  v_id := NULL;
  RESET ROLE;
  IF v_out NOT LIKE 'OK|%' OR v_out2 NOT LIKE 'OK|%' THEN
    RAISE EXCEPTION 'TEST FAILED (R5): a normalisation call was refused (% / %), expected both accepted', v_out, v_out2;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_keys
   WHERE user_id = v_owner AND venue_account_id = '1001' AND venue_server = 'mybroker-live';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (R5): login with edge spaces and a mixed-case padded server did not store as 1001 / mybroker-live (% matching rows)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_keys
   WHERE user_id = v_owner AND venue_account_id = '1002' AND venue_server IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (R5): a blank server did not store as NULL (% matching rows)', v_n;
  END IF;
  SET LOCAL ROLE service_role;
  v_out := pg_temp.iak_try(v_owner, 'mt5', E' \t ', 'srv-blank-login');
  v_out2 := pg_temp.iak_try(v_owner, 'mt5', '5551234', 'icmarkets-live05');
  RESET ROLE;
  IF v_out NOT LIKE 'OK|%' OR v_out2 NOT LIKE 'OK|%' THEN
    RAISE EXCEPTION 'TEST FAILED (R5): a blank-login or normal-form call was refused (% / %), expected both accepted', v_out, v_out2;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_keys
   WHERE user_id = v_owner AND venue_account_id IS NULL AND venue_server = 'srv-blank-login';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (R5): a blank login did not store as NULL (% matching rows)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_keys
   WHERE user_id = v_owner AND venue_account_id = '5551234' AND venue_server = 'icmarkets-live05';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (R5): a value already in the route''s normal form was altered (% matching rows)', v_n;
  END IF;

  -- ===== ARM R6 - p_id is the stored id when given, fresh when omitted =====================
  -- RED-UNDER: replace the COALESCE(p_id, gen_random_uuid()) row id in migration
  --            20261127120100 with gen_random_uuid(). Seeds that key later rows on a
  --            caller-chosen id then point at rows that do not exist.
  -- RED-UNDER-M: {"arm":"R6","apply":[{"kind":"edit","file":"supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql","find":"COALESCE(p_id, gen_random_uuid())","replace":"gen_random_uuid()","occurrences":1}]}
  SET LOCAL ROLE service_role;
  v_out := pg_temp.iak_try(v_owner, 'okx', NULL, NULL, v_given);
  v_out2 := pg_temp.iak_try(v_owner, 'okx', NULL, NULL);
  RESET ROLE;
  IF v_out IS DISTINCT FROM 'OK|' || v_given::text THEN
    RAISE EXCEPTION 'TEST FAILED (R6): a call with p_id % answered %, expected that id back', v_given, v_out;
  END IF;
  IF v_out2 NOT LIKE 'OK|%' OR v_out2 = v_out THEN
    RAISE EXCEPTION 'TEST FAILED (R6): a call without p_id answered %, expected a fresh uuid', v_out2;
  END IF;

  -- ===== ARM R7 - a NULL p_user_id is refused with 22023 ===================================
  -- RED-UNDER: make the NULL check in migration 20261127120100 unreachable (`IF false THEN`).
  --            The INSERT then trips a raw not-null violation (23502) with no diagnosis.
  -- RED-UNDER-M: {"arm":"R7","apply":[{"kind":"edit","file":"supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql","find":"IF p_user_id IS NULL THEN","replace":"IF false THEN","occurrences":1}]}
  SET LOCAL ROLE service_role;
  v_out := pg_temp.iak_try(NULL, 'okx', NULL, NULL);
  RESET ROLE;
  IF v_out NOT LIKE '22023|insert_api_key: p_user_id must not be NULL%' THEN
    RAISE EXCEPTION 'TEST FAILED (R7): a NULL owner answered %, expected 22023 insert_api_key: p_user_id must not be NULL', v_out;
  END IF;

  -- ===== ARM R8 - a duplicate venue identity names its constraint in a 23505 ===============
  -- RED-UNDER: add a handler after the RETURN in migration 20261127120100 that re-raises
  --            a unique violation with a message that drops the constraint name. The route
  --            maps that name to KEY_VENUE_ALREADY_CONNECTED, so a rewrap mislabels it.
  -- RED-UNDER-M: {"arm":"R8","apply":[{"kind":"insert-after","file":"supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql","anchor":"RETURN v_id;","text":"\nEXCEPTION WHEN unique_violation THEN\n  RAISE EXCEPTION 'duplicate key' USING ERRCODE = 'unique_violation';","occurrences":1}]}
  SET LOCAL ROLE service_role;
  v_out := pg_temp.iak_try(v_owner, 'mt5', '7771234', 'dup-server');
  v_out2 := pg_temp.iak_try(v_owner, 'mt5', '7771234', 'dup-server');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF v_out NOT LIKE 'OK|%' THEN
    RAISE EXCEPTION 'TEST FAILED (R8): the first insert of a venue identity was refused (%), expected it accepted', v_out;
  END IF;
  IF v_out2 NOT LIKE '23505|%api_keys_user_exchange_venue_account_uniq%' THEN
    RAISE EXCEPTION 'TEST FAILED (R8): the duplicate venue identity answered %, expected 23505 naming api_keys_user_exchange_venue_account_uniq', v_out2;
  END IF;

  -- ===== ARM R9 - every parameter lands in its own column ==================================
  -- Every other arm passes 'x' or NULL for the credential parameters, so a positional swap in
  -- the INSERT's VALUES list (api_secret with passphrase, dek with nonce, label with
  -- api_key_encrypted) passes R1 to R8 and stores keys that cannot be decrypted. Each
  -- parameter here carries a value no other parameter carries, and the row is read back
  -- after RESET ROLE, column for column.
  -- RED-UNDER: swap p_api_secret_encrypted and p_passphrase_encrypted in the VALUES list of
  --            the INSERT in migration 20261127120100. Both columns are text and R1 to R8
  --            never read either, so only a distinct value per parameter catches it.
  -- RED-UNDER-M: {"arm":"R9","apply":[{"kind":"edit","file":"supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql","find":"p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,","replace":"p_api_key_encrypted, p_passphrase_encrypted, p_api_secret_encrypted,","occurrences":1}]}
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  v_id := public.insert_api_key(v_owner, 'okx', 'lbl-r9', 'k-r9', 's-r9', 'p-r9', 'd-r9', 'n-r9', 7,
                                E' \t acct-r9 ', E'  \tR9-Broker-Live \t ', gen_random_uuid());
  v_id2 := public.insert_api_key(p_user_id => v_owner, p_exchange => 'bybit', p_label => 'lbl-r9b',
                                 p_api_key_encrypted => 'k-r9b');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  SELECT k.user_id, k.exchange, k.label, k.api_key_encrypted, k.api_secret_encrypted,
         k.passphrase_encrypted, k.dek_encrypted, k.nonce, k.kek_version,
         k.attested_venue, k.venue_account_id, k.venue_server INTO v_row
    FROM public.api_keys k WHERE k.id = v_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (R9): insert_api_key returned % but no api_keys row has that id', v_id;
  END IF;
  IF v_row.user_id IS DISTINCT FROM v_owner OR v_row.exchange IS DISTINCT FROM 'okx'
     OR v_row.attested_venue IS DISTINCT FROM 'okx' THEN
    RAISE EXCEPTION 'TEST FAILED (R9): stored user_id %, exchange %, attested_venue %, expected the owner, okx and okx',
      v_row.user_id, v_row.exchange, COALESCE(v_row.attested_venue, 'NULL');
  END IF;
  IF v_row.label IS DISTINCT FROM 'lbl-r9' THEN
    RAISE EXCEPTION 'TEST FAILED (R9): stored label %, expected lbl-r9 (p_label lands in label)', COALESCE(v_row.label, 'NULL');
  END IF;
  IF v_row.api_key_encrypted IS DISTINCT FROM 'k-r9'
     OR v_row.api_secret_encrypted IS DISTINCT FROM 's-r9'
     OR v_row.passphrase_encrypted IS DISTINCT FROM 'p-r9' THEN
    RAISE EXCEPTION 'TEST FAILED (R9): stored api_key_encrypted %, api_secret_encrypted %, passphrase_encrypted %, expected k-r9, s-r9, p-r9 (each credential parameter lands in its own column)',
      COALESCE(v_row.api_key_encrypted, 'NULL'), COALESCE(v_row.api_secret_encrypted, 'NULL'), COALESCE(v_row.passphrase_encrypted, 'NULL');
  END IF;
  IF v_row.dek_encrypted IS DISTINCT FROM 'd-r9' OR v_row.nonce IS DISTINCT FROM 'n-r9' THEN
    RAISE EXCEPTION 'TEST FAILED (R9): stored dek_encrypted %, nonce %, expected d-r9, n-r9 (the envelope parameters land in their own columns)',
      COALESCE(v_row.dek_encrypted, 'NULL'), COALESCE(v_row.nonce, 'NULL');
  END IF;
  IF v_row.kek_version IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'TEST FAILED (R9): stored kek_version %, expected the 7 passed in', COALESCE(v_row.kek_version::text, 'NULL');
  END IF;
  IF v_row.venue_account_id IS DISTINCT FROM 'acct-r9' OR v_row.venue_server IS DISTINCT FROM 'r9-broker-live' THEN
    RAISE EXCEPTION 'TEST FAILED (R9): stored venue_account_id %, venue_server %, expected the trimmed acct-r9 and the trimmed lower-cased r9-broker-live',
      COALESCE(v_row.venue_account_id, 'NULL'), COALESCE(v_row.venue_server, 'NULL');
  END IF;
  SELECT k.api_key_encrypted, k.api_secret_encrypted, k.passphrase_encrypted, k.dek_encrypted,
         k.nonce, k.kek_version, k.venue_account_id, k.venue_server INTO v_row
    FROM public.api_keys k WHERE k.id = v_id2;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (R9): insert_api_key returned % for the minimal call but no api_keys row has that id', v_id2;
  END IF;
  IF v_row.kek_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (R9): a call with p_kek_version omitted stored kek_version %, expected the default 1', COALESCE(v_row.kek_version::text, 'NULL');
  END IF;
  IF v_row.api_key_encrypted IS DISTINCT FROM 'k-r9b' OR v_row.api_secret_encrypted IS NOT NULL
     OR v_row.passphrase_encrypted IS NOT NULL OR v_row.dek_encrypted IS NOT NULL
     OR v_row.nonce IS NOT NULL OR v_row.venue_account_id IS NOT NULL OR v_row.venue_server IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R9): the minimal call stored api_key_encrypted %, and an omitted parameter did not store NULL', COALESCE(v_row.api_key_encrypted, 'NULL');
  END IF;

  RAISE NOTICE 'ALL 9 ARMS EXECUTED (R1, R2, R3, R4, R5, R6, R7, R8, R9): service_role lands an attested row (R1), anon, authenticated and PUBLIC cannot EXECUTE it (R2), the in-body gate refuses every other JWT role even for the owner session (R3), exactly one SECURITY DEFINER overload with a pinned search_path exists (R4), login and server are normalised and a normal-form value is unchanged (R5), p_id is honoured and defaults fresh (R6), a NULL owner is refused with 22023 (R7), a duplicate venue identity raises 23505 naming its constraint (R8), and every parameter lands in its own column with an omitted p_kek_version stored as 1 (R9).';
  RAISE NOTICE 'insert_api_key OK: the writer contract holds.';
END $$;

ROLLBACK;
