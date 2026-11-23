-- Test for migration 20261123180100 — Phase 225 ONEACCOUNTONCE, plan 04 (MT5D-08, Q1, D-25).
--
-- WHAT THE MIGRATION ADDS. public.swap_account_slot(p_new_key, p_old_holder,
-- p_venue_account_id, p_venue_server) is the ONE place that moves an account's holder
-- slot and writes the duplicate marker together, in one transaction. A working key of
-- the same owner takes the slot from a same-owner key that is not working (D-18):
-- the new key is stamped with the login and the normalised server, the old holder gives
-- up its login and is marked 'duplicate' against the new key, and every 'duplicate'
-- dependent of the old holder is re-pointed at the new key. Every other case is refused
-- by a stable token with nothing written.
--
-- WHAT THIS FILE PINS. The write ORDER the real marker trigger and the real unique index
-- force (each ordering arm lets the REAL trigger refuse when its step is removed), every
-- refusal token with an unchanged two-row fingerprint, the D-18 legs (is_active included),
-- the NULL-is-wildcard server rule, and the service-role-only ACL.
--
-- pgTAP is not set up in this project, so every assertion RAISEs `TEST FAILED (<arm>)` on
-- failure and a clean run prints NOTICEs only.
-- ⚠️ supabase/tests/test_*.sql is the ONLY DB assertion form that runs in CI.
--
-- ⭐ ORDER IS LOAD-BEARING. Each arm must be the FIRST failure under its own mutation
-- (scripts/mutation-runner), so every arm seeds its OWN keys (fresh logins), and no arm
-- leans on state another arm leaves behind.
--
-- The swap runs as the privileged role the lane connects as: the function checks no
-- auth.uid() (its guard is its ACL, pinned by SWAP-acl), so no claim is set.
-- Handlers only record SQLSTATE / message; every probe runs after the handler's END
-- (lint rule R1). Synthetic logins and servers only: this is a public repo.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_swap_account_slot.sql
--
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260422101911_api_keys_disconnected_at.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql","supabase/migrations/20260925120000_api_keys_account_identity.sql","supabase/migrations/20260927180000_working_holder_rule_d18.sql","supabase/migrations/20261123180000_api_keys_venue_server.sql","supabase/migrations/20261123180100_swap_account_slot.sql"]}

-- Reap fixtures orphaned by a crashed earlier run. Age-scoped so it can never
-- touch a concurrent run's users.
DELETE FROM auth.users
 WHERE email LIKE 'test-swap-slot-%@quantalyze.test'
   AND created_at < now() - INTERVAL '1 hour';

-- One api_keys row, all-synthetic. A NULL sync status is a key that has never synced.
CREATE FUNCTION pg_temp.sw_key(p_user uuid, p_login text, p_server text, p_sync text,
                               p_active boolean DEFAULT true,
                               p_disc timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE sql AS $f$
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active,
                        disconnected_at, sync_status, venue_account_id, venue_server)
  VALUES (p_user, 'mt5', 'swap slot', 'enc', p_active, p_disc, p_sync, p_login, p_server)
  RETURNING id
$f$;

-- A fingerprint of the columns a swap writes or a refusal must leave alone, for two rows.
CREATE FUNCTION pg_temp.sw_fp(p_a uuid, p_b uuid) RETURNS text
LANGUAGE sql AS $f$
  SELECT string_agg(format('%s|%s|%s|%s|%s',
           coalesce(venue_account_id, '~'),
           coalesce(venue_server, '~'),
           coalesce(account_shared_with_api_key_id::text, '~'),
           coalesce(account_share_kind, '~'),
           coalesce(disconnected_at::text, '~')), ';' ORDER BY id)
    FROM api_keys WHERE id IN (p_a, p_b)
$f$;

-- Call the swap. Returns 'SUCCEEDED', or the raised message (the token), with
-- ' [ROWS CHANGED]' appended when a refused call left either row different.
CREATE FUNCTION pg_temp.sw_try(p_new uuid, p_old uuid, p_login text, p_server text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE
  v_before text := pg_temp.sw_fp(p_new, p_old);
  v_msg    text;
  v_err    text;
BEGIN
  BEGIN
    PERFORM public.swap_account_slot(p_new, p_old, p_login, p_server);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
    v_msg := SQLERRM;
  END;
  IF v_err IS NULL THEN
    RETURN 'SUCCEEDED';
  END IF;
  IF pg_temp.sw_fp(p_new, p_old) IS DISTINCT FROM v_before THEN
    RETURN v_msg || ' [ROWS CHANGED]';
  END IF;
  RETURN v_msg;
END
$f$;

DO $swap$
DECLARE
  v_run     text := replace(gen_random_uuid()::text, '-', '');
  uid_a     uuid := gen_random_uuid();   -- owner of every key below
  uid_b     uuid := gen_random_uuid();   -- a different tenant
  k_h       uuid;                        -- the old holder
  k_n       uuid;                        -- the new key
  k_d       uuid;                        -- a dependent of the old holder
  v_res     text;
  v_login   text;
  v_server  text;
  v_holder  uuid;
  v_kind    text;
  v_n       int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-swap-slot-a-' || v_run || '@quantalyze.test', now(), now()),
         (uid_b, '00000000-0000-0000-0000-000000000000', 'test-swap-slot-b-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'swap slot A', 'test-swap-slot-a-' || v_run || '@quantalyze.test'),
         (uid_b, 'swap slot B', 'test-swap-slot-b-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;

  -- ----- SWAP-ok. a failing holder gives the slot to a working key ----------------
  -- H holds the login and is sign_in_failed; N is live, never synced, unstamped. The
  -- server is passed in mixed case with spaces and must be stored trimmed lower-case.
  -- The call itself is asserted first, so a later NULL cannot be a refused call.
  -- RED-UNDER: replace the stamp of the new key's venue_account_id in the migration's last
  --            UPDATE with a bare NULL: the old holder lets go and is marked, but nobody
  --            holds the account, so the book counts it by no key.
  -- RED-UNDER-M: {"arm":"SWAP-ok","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"SET venue_account_id = v_login,","replace":"SET venue_account_id = NULL,","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-ok', 'synthetic-broker-live', 'sign_in_failed');
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-ok', '  Synthetic-Broker-LIVE  ');
  IF v_res IS DISTINCT FROM 'SUCCEEDED' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-ok): the swap of a failing holder for a working key was refused or errored (%). The slot cannot move at all.', v_res;
  END IF;
  SELECT venue_account_id, venue_server INTO v_login, v_server FROM api_keys WHERE id = k_n;
  IF v_login IS DISTINCT FROM 'swap225-ok' OR v_server IS DISTINCT FROM 'synthetic-broker-live' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-ok): the new key holds login % and server % — expected the passed login and the trimmed lower-case server. A NULL means nobody holds the account after the swap.', v_login, v_server;
  END IF;
  SELECT venue_account_id, account_shared_with_api_key_id, account_share_kind
    INTO v_login, v_holder, v_kind FROM api_keys WHERE id = k_h;
  IF v_login IS NOT NULL OR v_holder IS DISTINCT FROM k_n OR v_kind IS DISTINCT FROM 'duplicate' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-ok): the old holder has venue_account_id %, holder %, kind % — expected NULL, the new key and ''duplicate''.', v_login, v_holder, v_kind;
  END IF;

  -- ----- SWAP-acl. only service_role may call it ------------------------------------
  -- The function is SECURITY DEFINER and moves another row's slot. Supabase's default ACL
  -- would grant it to anon and authenticated; the migration revokes that, and a signed-in
  -- browser must never reach it (cross-tenant takeover).
  -- RED-UNDER: grant EXECUTE on the function to authenticated: any signed-in browser can
  --            then call it through PostgREST.
  -- RED-UNDER-M: {"arm":"SWAP-acl","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.swap_account_slot(uuid, uuid, text, text) TO authenticated"}]}
  IF NOT has_function_privilege('service_role', 'public.swap_account_slot(uuid, uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-acl): service_role cannot EXECUTE swap_account_slot, so the connect routes and the stamper cannot call it';
  END IF;
  IF has_function_privilege('authenticated', 'public.swap_account_slot(uuid, uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-acl): authenticated can EXECUTE swap_account_slot — a browser could move another tenant''s account slot';
  END IF;
  IF has_function_privilege('anon', 'public.swap_account_slot(uuid, uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-acl): anon can EXECUTE swap_account_slot';
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
   WHERE p.oid = 'public.swap_account_slot(uuid, uuid, text, text)'::regprocedure
     AND a.grantee = 0 AND a.privilege_type = 'EXECUTE';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-acl): PUBLIC holds EXECUTE on swap_account_slot';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.swap_account_slot(uuid, uuid, text, text)'::regprocedure) THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-acl): swap_account_slot is not SECURITY DEFINER';
  END IF;

  -- ===== Ordering and refusal arms. Each seeds its own keys. ======================
  -- Every refusal arm asserts the raised MESSAGE equals the token AND that neither row
  -- changed (pg_temp.sw_try appends ' [ROWS CHANGED]' to the message otherwise).
  -- Where an arm's twin removes a check, the call falls through to a LATER step and
  -- succeeds or is refused by the real trigger under a different message, so the arm
  -- reddens by name. Servers stay equal-or-both-NULL in every arm but SWAP-server-*, so
  -- the wildcard twin below cannot trip an earlier arm.

  -- ----- SWAP-repoint. duplicate dependents of the old holder follow the slot ---------
  -- D is marked duplicate against H. If D still pointed at H after H is marked against N,
  -- H would be a holder AND marked: the marker trigger's no-chain rule refuses it.
  -- RED-UNDER: neuter the dependents re-point UPDATE in the migration (its WHERE gains
  --            AND false), so the real marker trigger raises ACCOUNT_SHARE_KEY_IS_A_HOLDER
  --            on the old holder's own marking and the swap fails.
  -- RED-UNDER-M: {"arm":"SWAP-repoint","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"     AND id <> p_new_key;","replace":"     AND false;","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-repoint', 'syn-srv-repoint', 'error');
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  k_d := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  UPDATE api_keys SET account_shared_with_api_key_id = k_h, account_share_kind = 'duplicate' WHERE id = k_d;
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-repoint', 'syn-srv-repoint');
  IF v_res IS DISTINCT FROM 'SUCCEEDED' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-repoint): a swap with a duplicate dependent on the old holder did not succeed (%)', v_res;
  END IF;
  SELECT account_shared_with_api_key_id INTO v_holder FROM api_keys WHERE id = k_d;
  IF v_holder IS DISTINCT FROM k_n THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-repoint): the dependent now points at % — expected the new key %. It is left on the old holder.', v_holder, k_n;
  END IF;

  -- ----- SWAP-marked-new. a new key already marked against the old holder (heal case) --
  -- The stamper marks a working sibling against the failing holder. The swap must unmark
  -- it in the same call, or the trigger refuses to name a MARKED key as the holder.
  -- RED-UNDER: neuter the marker-clear UPDATE of the new key in the migration (its guard
  --            becomes IF false), so the real marker trigger raises
  --            ACCOUNT_SHARE_HOLDER_IS_MARKED when the old holder is pointed at it.
  -- RED-UNDER-M: {"arm":"SWAP-marked-new","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"  IF v_new_holder IS NOT NULL THEN","replace":"  IF false THEN","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-marked-new', NULL, 'error');
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  UPDATE api_keys SET account_shared_with_api_key_id = k_h, account_share_kind = 'duplicate' WHERE id = k_n;
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-marked-new', NULL);
  IF v_res IS DISTINCT FROM 'SUCCEEDED' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-marked-new): the heal case (new key already marked against the old holder) did not succeed (%)', v_res;
  END IF;
  SELECT venue_account_id, account_shared_with_api_key_id, account_share_kind
    INTO v_login, v_holder, v_kind FROM api_keys WHERE id = k_n;
  IF v_login IS DISTINCT FROM 'swap225-marked-new' OR v_holder IS NOT NULL OR v_kind IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-marked-new): the new key has login %, holder %, kind % — expected it stamped and unmarked', v_login, v_holder, v_kind;
  END IF;
  SELECT account_shared_with_api_key_id INTO v_holder FROM api_keys WHERE id = k_h;
  IF v_holder IS DISTINCT FROM k_n THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-marked-new): the old holder points at %, expected the new key %', v_holder, k_n;
  END IF;

  -- ----- SWAP-owner. another tenant's key is never swapped --------------------------
  -- RED-UNDER: remove the same-owner check from the migration (IF false). The old holder
  --            of another tenant is then reached and the marker trigger's own refusal
  --            surfaces under a different token, so cross-tenant takeover rests on the
  --            trigger alone.
  -- RED-UNDER-M: {"arm":"SWAP-owner","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"IF v_new_owner IS DISTINCT FROM v_old_owner THEN","replace":"IF false THEN","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_b, 'swap225-owner', 'syn-srv-owner', 'error');
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-owner', 'syn-srv-owner');
  IF v_res IS DISTINCT FROM 'ACCOUNT_SLOT_NOT_SAME_OWNER' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-owner): a swap across two owners answered % — expected ACCOUNT_SLOT_NOT_SAME_OWNER with both rows unchanged', v_res;
  END IF;

  -- ----- SWAP-holder-working. a working holder keeps the account --------------------
  -- RED-UNDER: remove the working-holder refusal from the migration (IF false): the swap
  --            then takes the account from a key that works.
  -- RED-UNDER-M: {"arm":"SWAP-holder-working","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"IF v_old_working THEN","replace":"IF false THEN","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-holder-working', 'syn-srv-hw', NULL);
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-holder-working', 'syn-srv-hw');
  IF v_res IS DISTINCT FROM 'ACCOUNT_SLOT_HOLDER_WORKING' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-holder-working): a swap against a WORKING holder answered % — expected ACCOUNT_SLOT_HOLDER_WORKING with both rows unchanged', v_res;
  END IF;

  -- ----- SWAP-inactive-holder. an inactive holder is NOT working (the is_active leg) ---
  -- D-18: a key is working only while it is ACTIVE. sync_status NULL alone would pass.
  -- RED-UNDER: drop the `v_is_active AND` leg of the D-18 expression in the migration, so
  --            an inactive key with a NULL status is read as working and the swap is
  --            refused ACCOUNT_SLOT_HOLDER_WORKING.
  -- RED-UNDER-M: {"arm":"SWAP-inactive-holder","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"IF v_is_active AND v_disconnected IS NULL AND (","replace":"IF v_disconnected IS NULL AND (","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-inactive-holder', 'syn-srv-ih', NULL, false);
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-inactive-holder', 'syn-srv-ih');
  IF v_res IS DISTINCT FROM 'SUCCEEDED' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-inactive-holder): an INACTIVE holder with a NULL sync status was treated as working (%) — the is_active leg of D-18 is missing', v_res;
  END IF;
  SELECT venue_account_id INTO v_login FROM api_keys WHERE id = k_n;
  IF v_login IS DISTINCT FROM 'swap225-inactive-holder' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-inactive-holder): the new key holds login % after the swap', v_login;
  END IF;

  -- ----- SWAP-new-failing. a failing new key cannot take the account -----------------
  -- RED-UNDER: remove the new-key-not-working refusal from the migration (IF false): a key
  --            that itself fails would take the slot from another failing key.
  -- RED-UNDER-M: {"arm":"SWAP-new-failing","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"IF NOT v_new_working THEN","replace":"IF false THEN","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-new-failing', 'syn-srv-nf', 'sign_in_failed');
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, 'error');
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-new-failing', 'syn-srv-nf');
  IF v_res IS DISTINCT FROM 'ACCOUNT_SLOT_NEW_KEY_NOT_WORKING' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-new-failing): a swap by a failing new key answered % — expected ACCOUNT_SLOT_NEW_KEY_NOT_WORKING with both rows unchanged', v_res;
  END IF;

  -- ----- SWAP-not-live. a departed key on either side is refused ----------------------
  -- RED-UNDER: remove the liveness refusal from the migration (IF false): a disconnected
  --            old holder is read as not working and its slot is moved anyway.
  -- RED-UNDER-M: {"arm":"SWAP-not-live","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"IF v_new_disc IS NOT NULL OR v_old_disc IS NOT NULL THEN","replace":"IF false THEN","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-not-live', 'syn-srv-nl', 'error', true, now());
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-not-live', 'syn-srv-nl');
  IF v_res IS DISTINCT FROM 'ACCOUNT_SLOT_NOT_LIVE' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-not-live): a swap with a DISCONNECTED old holder answered % — expected ACCOUNT_SLOT_NOT_LIVE with both rows unchanged', v_res;
  END IF;
  k_h := pg_temp.sw_key(uid_a, 'swap225-not-live-2', 'syn-srv-nl2', 'error');
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL, true, now());
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-not-live-2', 'syn-srv-nl2');
  IF v_res IS DISTINCT FROM 'ACCOUNT_SLOT_NOT_LIVE' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-not-live): a swap with a DISCONNECTED new key answered % — expected ACCOUNT_SLOT_NOT_LIVE with both rows unchanged', v_res;
  END IF;

  -- ----- SWAP-login. the caller must name the login the old holder holds --------------
  -- RED-UNDER: remove the login comparison from the migration (IF false): the call would
  --            stamp the new key with a login the old holder never held.
  -- RED-UNDER-M: {"arm":"SWAP-login","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"IF v_old_login IS DISTINCT FROM v_login THEN","replace":"IF false THEN","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-login-held', 'syn-srv-login', 'error');
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-login-other', 'syn-srv-login');
  IF v_res IS DISTINCT FROM 'ACCOUNT_SLOT_IDENTITY_MISMATCH' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-login): a swap naming a login the old holder does not hold answered % — expected ACCOUNT_SLOT_IDENTITY_MISMATCH with both rows unchanged', v_res;
  END IF;

  -- ----- SWAP-server-conflict. two different broker servers are two accounts ----------
  -- RED-UNDER: remove the server comparison from the migration (IF false): login 1001 on
  --            one broker would be swapped for login 1001 on another.
  -- RED-UNDER-M: {"arm":"SWAP-server-conflict","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"IF v_old_server IS NOT NULL AND v_server IS NOT NULL AND v_old_server <> v_server THEN","replace":"IF false THEN","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-server-conflict', 'syn-srv-a', 'error');
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-server-conflict', 'syn-srv-b');
  IF v_res IS DISTINCT FROM 'ACCOUNT_SLOT_IDENTITY_MISMATCH' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-server-conflict): a swap across two different broker servers answered % — expected ACCOUNT_SLOT_IDENTITY_MISMATCH with both rows unchanged', v_res;
  END IF;

  -- ----- SWAP-composite. a composite_member dependent keeps the slot where it is -------
  -- RED-UNDER: drop the composite_member filter from the dependents check in the migration
  --            (AND false): the check no longer sees the dependent, the swap proceeds, and
  --            the real marker trigger raises ACCOUNT_SHARE_KEY_IS_A_HOLDER on the old
  --            holder, a different token.
  -- RED-UNDER-M: {"arm":"SWAP-composite","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"AND d.account_share_kind = 'composite_member'","replace":"AND false","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-composite', 'syn-srv-comp', 'error');
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  k_d := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  UPDATE api_keys SET account_shared_with_api_key_id = k_h, account_share_kind = 'composite_member' WHERE id = k_d;
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-composite', 'syn-srv-comp');
  IF v_res IS DISTINCT FROM 'ACCOUNT_SLOT_COMPOSITE_DEPENDENT' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-composite): a swap with a composite_member dependent on the old holder answered % — expected ACCOUNT_SLOT_COMPOSITE_DEPENDENT with both rows unchanged', v_res;
  END IF;

  -- ----- SWAP-server-wildcard. a server not captured yet matches any ------------------
  -- NULL on the old holder's side is the wildcard (Q2 / F-3): the swap succeeds and the new
  -- key stores the passed server, trimmed and lower-cased.
  -- RED-UNDER: make a NULL server on the old holder an ordinary value in the migration's
  --            server comparison (IS DISTINCT FROM), so NULL against a named server is a
  --            conflict and the swap is refused ACCOUNT_SLOT_IDENTITY_MISMATCH.
  -- RED-UNDER-M: {"arm":"SWAP-server-wildcard","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"IF v_old_server IS NOT NULL AND v_server IS NOT NULL AND v_old_server <> v_server THEN","replace":"IF v_old_server IS DISTINCT FROM v_server THEN","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-wildcard', NULL, 'error');
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-wildcard', '  Syn-Srv-Wild  ');
  IF v_res IS DISTINCT FROM 'SUCCEEDED' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-server-wildcard): a swap whose old holder has no server captured yet was refused or errored (%) — NULL must be the wildcard', v_res;
  END IF;
  SELECT venue_server INTO v_server FROM api_keys WHERE id = k_n;
  IF v_server IS DISTINCT FROM 'syn-srv-wild' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-server-wildcard): the new key stored server % — expected the passed server, trimmed and lower-case', v_server;
  END IF;

  -- ----- SWAP-server-inherit. a NULL caller server never erases a captured one ----------
  -- NULL is a wildcard (Q2), never a value that overwrites. The old holder carries a server
  -- and the caller names none: the new key must end with the holder's server.
  -- RED-UNDER: write the caller's server alone in the migration's new-key stamp (drop the
  --            COALESCE with the old holder's server): the new key's server becomes NULL.
  -- RED-UNDER-M: {"arm":"SWAP-server-inherit","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"venue_server     = COALESCE(v_server, v_old_server)","replace":"venue_server     = v_server","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-inherit', 'syn-srv-i', 'error');
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-inherit', NULL);
  IF v_res IS DISTINCT FROM 'SUCCEEDED' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-server-inherit): a swap with a NULL caller server against a holder that has a server was refused or errored (%)', v_res;
  END IF;
  SELECT venue_server INTO v_server FROM api_keys WHERE id = k_n;
  IF v_server IS DISTINCT FROM 'syn-srv-i' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-server-inherit): the new key stored server % — expected the old holder''s captured server ''syn-srv-i''. A NULL caller server erased a known one', v_server;
  END IF;

  -- ----- SWAP-demoted-server-clear. the demoted holder gives its server up with its login -
  -- A server left on a row whose login is NULL is an identity fragment on a key that holds
  -- no account.
  -- RED-UNDER: drop the server clear from the migration's old-holder UPDATE (the column is
  --            set to itself): the demoted holder keeps its server beside a NULL login.
  -- RED-UNDER-M: {"arm":"SWAP-demoted-server-clear","apply":[{"kind":"edit","file":"supabase/migrations/20261123180100_swap_account_slot.sql","find":"venue_server                   = NULL,","replace":"venue_server                   = venue_server,","occurrences":1}]}
  k_h := pg_temp.sw_key(uid_a, 'swap225-dsc', 'syn-srv-dsc', 'error');
  k_n := pg_temp.sw_key(uid_a, NULL, NULL, NULL);
  v_res := pg_temp.sw_try(k_n, k_h, 'swap225-dsc', 'syn-srv-dsc');
  IF v_res IS DISTINCT FROM 'SUCCEEDED' THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-demoted-server-clear): the swap was refused or errored (%)', v_res;
  END IF;
  SELECT venue_server INTO v_server FROM api_keys WHERE id = k_h;
  IF v_server IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (SWAP-demoted-server-clear): the demoted holder still carries server % beside a NULL login', v_server;
  END IF;

  -- Explicit, in FK order, rather than relying on the profiles -> api_keys cascade.
  DELETE FROM api_keys WHERE user_id IN (uid_a, uid_b);
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);

  RAISE NOTICE 'PASS (swap_account_slot): a failing or inactive holder gives its slot to a working key and is marked duplicate against it, dependents follow, a marked new key is healed, the server wildcard holds; every refusal (owner, working holder, failing new key, departed key, login, server, composite dependent) leaves both rows unchanged; the function is service-role only and SECURITY DEFINER.';
END $swap$;
