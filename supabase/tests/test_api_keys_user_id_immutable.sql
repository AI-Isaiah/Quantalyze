-- Test: api_keys.user_id is immutable for every role (Phase 243 DBBACKSTOP, plan 05,
-- DBACC-02). Migration 20261127120100, trigger api_keys_user_id_immutable.
--
-- WHY THIS FILE EXISTS. A service_role request carries no sub and BYPASSRLS, and the table
-- owner is bound by no policy, so an RLS policy cannot stop either from repointing a stored
-- credential at another tenant. The founder decided (2026-11-26) that a BEFORE UPDATE
-- trigger refuses any change of user_id from any role. This gate is what keeps that true.
--
-- THE ARMS (the roster is the sentinel at the foot of the file):
--   1a  structure: one trigger of that name, tgtype EQUAL to 19 (ROW + BEFORE + UPDATE),
--       enabled, WHEN clause present, NO column list (`UPDATE OF`), function not SECURITY
--       DEFINER, and anon and authenticated cannot EXECUTE the function.
--   1b  firing order: the trigger's name sorts after every other non-internal BEFORE UPDATE
--       ROW trigger on api_keys, so it judges the final row.
--   2a  the table owner (postgres) cannot repoint a key: SQLSTATE 42501, the trigger's
--       message, and the row image unchanged.
--   2b  service_role (BYPASSRLS) cannot repoint a key either.
--   3   non-repointing writes pass: a same-value assignment, a same-owner upsert and an
--       other-column update as service_role.
--   4   rewrite probe: a BEFORE UPDATE trigger that rewrites NEW.user_id cannot repoint a
--       key, because this trigger has no column list and fires last.
--
-- ⛔ NO SKIP-WHEN-UNAPPLIED BRANCH. Without the migration the repoint succeeds and arm 2a
-- fails: the right reading.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent RED-UNDER-M
-- object that scripts/mutation-runner executes (schema in scripts/mutation-runner/GRAMMAR.md).
-- The setup list matches test_insert_api_key_rpc.sql, with the migration LAST.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260813150106_wizard_rpcs_service_role_writer.sql","supabase/migrations/20260814120000_wizard_rpcs_revoke_authenticated.sql","supabase/migrations/20261123180000_api_keys_venue_server.sql","supabase/migrations/20261125132334_api_keys_venue_server_owner_read.sql","supabase/migrations/20261126140500_api_keys_venue_server_index.sql","scripts/pg-lane/fixtures/41-fixture-api-keys-user-id-fk.sql","supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql"]}
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_api_keys_user_id_immutable.sql

BEGIN;

DO $$
DECLARE
  v_owner     uuid := gen_random_uuid();
  v_other     uuid := gen_random_uuid();
  v_key       uuid := gen_random_uuid();
  v_img_before jsonb;
  v_img_after  jsonb;
  v_state     text;
  v_msg       text;
  v_state2    text;
  v_msg2      text;
  v_n         integer;
  v_trg       record;
  v_def       text;
  v_label     text;
  v_cur_owner uuid;
  v_problem   text;
BEGIN
  -- ---- fixture, seeded as the migration/owner role ---------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at, raw_user_meta_data)
  VALUES (v_owner, '00000000-0000-0000-0000-000000000000',
          'imm-a-' || v_owner::text || '@quantalyze.test', now(), now(), '{"role":"manager"}'::jsonb),
         (v_other, '00000000-0000-0000-0000-000000000000',
          'imm-b-' || v_other::text || '@quantalyze.test', now(), now(), '{"role":"manager"}'::jsonb);
  INSERT INTO public.profiles (id, display_name)
  VALUES (v_owner, 'imm-owner'), (v_other, 'imm-other')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
  VALUES (v_key, v_owner, 'binance', 'imm-key', 'x');
  -- Supabase's default privileges give service_role ALL on every public table. The lane's
  -- api_keys is a stub created before the default-privileges stand-in, so restate the grant
  -- (a no-op on the real stack). Without it arms 2b and 3 would meet a bare privilege error.
  GRANT ALL ON public.api_keys TO service_role;
  SELECT to_jsonb(k) INTO v_img_before FROM public.api_keys k WHERE k.id = v_key;

  -- ===== ARM 1a - structure: the trigger is present, enabled, has no column list ==========
  -- tgtype is compared for EQUALITY with 19 = ROW (1) + BEFORE (2) + UPDATE (16), so a trigger
  -- that gained INSERT or DELETE, became AFTER or statement-level, all fail it.
  -- RED-UNDER: DISABLE the trigger on the live lane. The behaviour arms would also redden, but
  --            only the catalogue names a trigger that exists and does nothing.
  -- RED-UNDER-M: {"arm":"1a","apply":[{"kind":"sql","stmt":"ALTER TABLE public.api_keys DISABLE TRIGGER api_keys_user_id_immutable"}]}
  -- One RAISE for the whole arm on purpose: the runner's neuter replaces a single RAISE per
  -- arm, and arms 3 and 4 neuter this one. The first problem found is the message.
  SELECT count(*) INTO v_n FROM pg_trigger t
   WHERE t.tgrelid = 'public.api_keys'::regclass AND t.tgname = 'api_keys_user_id_immutable' AND NOT t.tgisinternal;
  SELECT t.tgtype, t.tgenabled, p.prosecdef, t.tgfoid, pg_get_triggerdef(t.oid) AS def INTO v_trg
    FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.api_keys'::regclass AND t.tgname = 'api_keys_user_id_immutable';
  v_problem := CASE
    WHEN v_n <> 1 THEN format('%s trigger(s) named api_keys_user_id_immutable on api_keys, expected exactly 1', v_n)
    WHEN v_trg.tgtype IS DISTINCT FROM 19 THEN format('the trigger has tgtype %s, expected 19 (BEFORE UPDATE, FOR EACH ROW)', v_trg.tgtype)
    WHEN v_trg.tgenabled::text IS DISTINCT FROM 'O' THEN format('the trigger is not enabled (tgenabled %s)', v_trg.tgenabled)
    WHEN position('WHEN ((old.user_id IS DISTINCT FROM new.user_id))' IN v_trg.def) = 0 THEN format('the trigger definition lacks the WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id) clause: %s', v_trg.def)
    WHEN position('UPDATE OF' IN v_trg.def) > 0 THEN format('the trigger carries a column list (UPDATE OF), which is checked against the SET list only and would miss a rewritten NEW.user_id: %s', v_trg.def)
    WHEN v_trg.prosecdef THEN 'enforce_api_keys_user_id_immutable is SECURITY DEFINER, expected SECURITY INVOKER'
    WHEN has_function_privilege('anon', v_trg.tgfoid, 'EXECUTE') THEN 'anon may EXECUTE enforce_api_keys_user_id_immutable, expected it revoked'
    WHEN has_function_privilege('authenticated', v_trg.tgfoid, 'EXECUTE') THEN 'authenticated may EXECUTE enforce_api_keys_user_id_immutable, expected it revoked'
  END;
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1a): %', v_problem;
  END IF;

  -- ===== ARM 1b - firing order: this trigger is last among the BEFORE UPDATE ROW triggers ==
  -- Triggers of one kind fire in name order (C collation). Sorting last is what lets this one
  -- judge the row after every other BEFORE trigger has had its say.
  -- RED-UNDER: create a BEFORE UPDATE ROW trigger named api_keys_zz_order_probe on the live
  --            lane. It sorts after api_keys_user_id_immutable and fires after it.
  -- RED-UNDER-M: {"arm":"1b","apply":[{"kind":"sql","stmt":"CREATE TRIGGER api_keys_zz_order_probe BEFORE UPDATE ON public.api_keys FOR EACH ROW EXECUTE FUNCTION public.enforce_api_keys_user_id_immutable()"}]}
  SELECT count(*) INTO v_n FROM pg_trigger t
   WHERE t.tgrelid = 'public.api_keys'::regclass AND NOT t.tgisinternal
     AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16
     AND t.tgname COLLATE "C" > 'api_keys_user_id_immutable' COLLATE "C";
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1b): % BEFORE UPDATE ROW trigger(s) on api_keys sort after api_keys_user_id_immutable and fire after it, expected none', v_n;
  END IF;

  -- ===== ARM 2a - the table OWNER cannot repoint a key =====================================
  -- The session role is the table owner (a superuser on the lane): no grant and no policy
  -- binds it, so only the trigger can refuse.
  -- RED-UNDER: replace the RAISE of enforce_api_keys_user_id_immutable in migration
  --            20261127120100 with a plain RETURN NEW, the "the trigger is only a backstop"
  --            drift. The trigger still fires on the repoint but no longer refuses it.
  -- RED-UNDER-M: {"arm":"2a","apply":[{"kind":"edit","file":"supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql","find":"  RAISE EXCEPTION 'api_keys.user_id is immutable: a key never changes owner'\n    USING ERRCODE = 'insufficient_privilege';","replace":"  RETURN NEW;","occurrences":1}]}
  v_state := NULL; v_msg := NULL;
  BEGIN
    UPDATE public.api_keys SET user_id = v_other WHERE id = v_key;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  SELECT to_jsonb(k) INTO v_img_after FROM public.api_keys k WHERE k.id = v_key;
  IF v_state IS DISTINCT FROM '42501' OR v_msg NOT LIKE 'api_keys.user_id is immutable%'
     OR v_img_before IS DISTINCT FROM v_img_after THEN
    RAISE EXCEPTION 'TEST FAILED (2a): an owner UPDATE of api_keys.user_id answered % (%), expected the trigger''s 42501 refusal with the row unchanged (row image changed: %)', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the repoint ran'), (v_img_before IS DISTINCT FROM v_img_after);
  END IF;

  -- ===== ARM 2b - service_role (BYPASSRLS) cannot repoint a key either =====================
  -- A refusal by the table privilege would also answer 42501, so the message is pinned to the
  -- trigger's own text.
  -- RED-UNDER: the same RETURN NEW edit as arm 2a, with arm 2a neutered so this arm is the
  --            first failure.
  -- RED-UNDER-M: {"arm":"2b","apply":[{"kind":"edit","file":"supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql","find":"  RAISE EXCEPTION 'api_keys.user_id is immutable: a key never changes owner'\n    USING ERRCODE = 'insufficient_privilege';","replace":"  RETURN NEW;","occurrences":1}],"neuter":[{"arm":"2a"}]}
  v_state := NULL; v_msg := NULL;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.api_keys SET user_id = v_other WHERE id = v_key;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF v_state IS DISTINCT FROM '42501' OR v_msg NOT LIKE 'api_keys.user_id is immutable%' THEN
    RAISE EXCEPTION 'TEST FAILED (2b): a service_role UPDATE of api_keys.user_id answered % (%), expected the trigger''s 42501 refusal', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the repoint ran');
  END IF;
  SELECT to_jsonb(k) INTO v_img_after FROM public.api_keys k WHERE k.id = v_key;
  IF v_img_before IS DISTINCT FROM v_img_after THEN
    RAISE EXCEPTION 'TEST FAILED (2b): the stored row changed although the service_role repoint was refused';
  END IF;

  -- ===== ARM 3 - writes that do not repoint pass ===========================================
  -- (i) a same-value assignment as the owner, (ii) an upsert re-asserting the same owner as the
  -- owner, (iii) an other-column update as service_role. Each must succeed and read back.
  -- RED-UNDER: replace the trigger's WHEN clause in migration 20261127120100 with WHEN (true).
  --            Arm 1a, which pins the WHEN text, is neutered so this arm is the first failure:
  --            the trigger then refuses every update, including these.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql","find":"WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)","replace":"WHEN (true)","occurrences":1}],"neuter":[{"arm":"1a"}]}
  v_state := NULL; v_msg := NULL; v_state2 := NULL; v_msg2 := NULL;
  BEGIN
    UPDATE public.api_keys SET user_id = user_id WHERE id = v_key;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3): a same-value assignment of user_id was refused (% %), expected it to pass', v_state, v_msg;
  END IF;
  BEGIN
    INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_key, v_owner, 'binance', 'imm-upsert', 'x')
    ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, label = EXCLUDED.label;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3): a same-owner upsert was refused (% %), expected it to pass', v_state, v_msg;
  END IF;
  SELECT label INTO v_label FROM public.api_keys WHERE id = v_key;
  IF v_label IS DISTINCT FROM 'imm-upsert' THEN
    RAISE EXCEPTION 'TEST FAILED (3): the same-owner upsert did not write its label (read back %)', COALESCE(v_label, 'NULL');
  END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.api_keys SET label = 'relabel' WHERE id = v_key;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state2 = RETURNED_SQLSTATE, v_msg2 = MESSAGE_TEXT;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF v_state2 IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3): a service_role other-column update was refused (% %), expected it to pass', v_state2, v_msg2;
  END IF;
  SELECT label INTO v_label FROM public.api_keys WHERE id = v_key;
  IF v_label IS DISTINCT FROM 'relabel' THEN
    RAISE EXCEPTION 'TEST FAILED (3): the service_role relabel did not write (read back %)', COALESCE(v_label, 'NULL');
  END IF;

  -- ===== ARM 4 - a BEFORE UPDATE trigger that rewrites NEW.user_id cannot repoint a key =====
  -- The probe trigger sorts first and rewrites NEW.user_id while the statement sets only label.
  -- A column-list trigger would never see the rewrite; this one judges the final row.
  -- RED-UNDER: turn the trigger's `BEFORE UPDATE ON public.api_keys` in migration
  --            20261127120100 into `BEFORE UPDATE OF user_id ON public.api_keys`. Arm 1a,
  --            which pins the absence of a column list, is neutered so this arm is the first
  --            failure: the probe's rewrite then slips past the trigger.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20261127120100_insert_api_key_rpc_and_user_id_immutable.sql","find":"BEFORE UPDATE ON public.api_keys","replace":"BEFORE UPDATE OF user_id ON public.api_keys","occurrences":1}],"neuter":[{"arm":"1a"}]}
  PERFORM set_config('imm.second', v_other::text, true);
  CREATE FUNCTION public.imm_rewrite_probe() RETURNS trigger LANGUAGE plpgsql AS $f$
  BEGIN
    NEW.user_id := current_setting('imm.second')::uuid;
    RETURN NEW;
  END
  $f$;
  CREATE TRIGGER api_keys_aaa_rewrite_probe BEFORE UPDATE ON public.api_keys
    FOR EACH ROW EXECUTE FUNCTION public.imm_rewrite_probe();
  v_state := NULL; v_msg := NULL;
  BEGIN
    UPDATE public.api_keys SET label = 'probe' WHERE id = v_key;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '42501' OR v_msg NOT LIKE 'api_keys.user_id is immutable%' THEN
    RAISE EXCEPTION 'TEST FAILED (4): an UPDATE whose BEFORE trigger rewrote NEW.user_id answered % (%), expected the immutability trigger''s 42501 refusal', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the rewrite landed');
  END IF;
  SELECT user_id INTO v_cur_owner FROM public.api_keys WHERE id = v_key;
  IF v_cur_owner IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'TEST FAILED (4): the key was repointed to % by a rewriting trigger', v_cur_owner;
  END IF;

  RAISE NOTICE 'ALL 6 ARMS EXECUTED (1a, 1b, 2a, 2b, 3, 4): the trigger is BEFORE UPDATE FOR EACH ROW with a WHEN clause and no column list and its function is not executable by clients (1a), it fires last among the BEFORE UPDATE triggers (1b), the table owner (2a) and service_role (2b) cannot repoint a key, same-value, same-owner upsert and other-column writes pass (3), and a trigger that rewrites NEW.user_id cannot repoint a key (4).';
  RAISE NOTICE 'api_keys user_id immutable OK: no role can change a key''s owner.';
END $$;

ROLLBACK;
