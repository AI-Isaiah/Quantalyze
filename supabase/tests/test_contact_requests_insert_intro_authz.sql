-- Test for migration 20261110150000_intro_path_authz_hardening.sql: the database
-- side of the intro path matches /api/intro. Phase 204 INTROAUTH, plan 01 (D-07).
--
-- What this gate proves
-- ---------------------
-- (a) The six-argument public.send_intro_with_decision is callable by service_role
--     only: no PUBLIC, anon or authenticated EXECUTE, service_role keeps it, and an
--     authenticated call is refused at the privilege check.
-- (b) The INSERT policy on public.contact_requests admits exactly the callers the
--     route admits and refuses the rest. The route's order is: approval gate, then
--     the allocator-or-both role check, then the attestation, and the policy also
--     keeps the row's own allocator_id equal to the caller.
--       admitted: an approved attested allocator, an approved attested both account
--                 (both statuses verified), an attested admin with the allocator role
--       refused:  an unapproved allocator, a both account with one status verified, a
--                 verified manager, an admin with the manager role, an unattested
--                 allocator, a caller naming another allocator_id, and anon
-- Every refusal is told apart from a grant-layer refusal by its message text and by
-- an up-front check that the client roles hold the table INSERT grant, so a missing
-- GRANT cannot pass for a row-level-security refusal. The admit arms prove the caller
-- can read its own rows inside the policy.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with RAISE
-- EXCEPTION on failure and RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands. Under
-- `psql -v ON_ERROR_STOP=1` a failed assertion exits non-zero and fails the job.
-- The whole file runs inside one transaction that ends in ROLLBACK, so it leaves no
-- rows behind on any database it runs against.
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_contact_requests_insert_intro_authz.sql
--
-- Lanes. The mutation runner and the pg-lane apply the list below first. The
-- local-stack lane (CI sql-tests) runs this same file against the real dump with its
-- own replay of newer migrations and no setup list, so the seeding below uses only
-- columns the real tables also carry and one distinct strategy per insert.
--
-- MACHINE-EXECUTABLE TWINS. Each prose marker below an arm carries an adjacent
-- machine-readable twin that scripts/mutation-runner applies on a throwaway pg-lane
-- cluster to prove the arm reddens on its own as the FIRST failure, then restores
-- GREEN. Schema: scripts/mutation-runner/GRAMMAR.md. Every twin is a post-apply `sql`
-- step: an edit of the migration would trip the migration's own verification block
-- during the apply and the gate would never run. Each policy twin restates the
-- migration's whole check with exactly one change.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/28-fixture-profiles-privileged-columns.sql","scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","scripts/pg-lane/fixtures/43-fixture-intro-authz-stand-ins.sql","supabase/migrations/20260405061912_rls_policies.sql","supabase/migrations/20261110150000_intro_path_authz_hardening.sql"]}

BEGIN;

-- Seeds one auth user and its profile with the given role, statuses and admin flag
-- (profiles by ON CONFLICT, because an auth.users insert may already create the row;
-- the status and admin columns are set as the connecting superuser role before any
-- SET LOCAL ROLE), plus an attestation row when asked. pg_temp functions live and
-- die with this transaction and raise no arm.
CREATE FUNCTION pg_temp.ia_user(p_tag text, p_role text, p_alloc text, p_mgr text,
                                p_admin boolean, p_attested boolean) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_id, '00000000-0000-0000-0000-000000000000',
          'test-introauth-' || p_tag || '-' || v_id || '@quantalyze.test', now(), now());
  INSERT INTO public.profiles (id, display_name, email, role)
  VALUES (v_id, 'introauth ' || p_tag, 'test-introauth-' || p_tag || '-' || v_id || '@quantalyze.test', p_role)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
  UPDATE public.profiles
     SET allocator_status = p_alloc, manager_status = p_mgr, is_admin = p_admin
   WHERE id = v_id;
  IF p_attested THEN
    INSERT INTO public.investor_attestations (user_id, version) VALUES (v_id, 'introauth-test');
  END IF;
  RETURN v_id;
END
$f$;

-- One published strategy owned by the given user. The real contact_requests table
-- holds UNIQUE (allocator_id, strategy_id), so every insert attempt gets its own.
CREATE FUNCTION pg_temp.ia_strategy(p_owner uuid) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (p_owner, 'introauth strategy', 'published', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO v_id;
  RETURN v_id;
END
$f$;

-- One insert attempt into public.contact_requests as the given client role. p_sub is
-- the caller's id for the JWT claims (NULL clears them, which is anon). The handler
-- only assigns state, SQLSTATE and message text (lint rule R1): the row count is read
-- after the block, as the connecting role, once the role and the claims are reset.
-- Returns {state, sqlstate, message, rows} where state is 'admitted' or 'denied'. It
-- raises no arm, so the caller's DO block holds every TEST FAILED raise directly.
CREATE FUNCTION pg_temp.ia_insert_as(p_role text, p_sub uuid, p_alloc uuid, p_strategy uuid)
RETURNS text[]
LANGUAGE plpgsql AS $f$
DECLARE
  v_state    text;
  v_sqlstate text;
  v_msg      text;
  v_n        integer;
BEGIN
  IF p_sub IS NULL THEN
    PERFORM set_config('request.jwt.claims', NULL, true);
  ELSE
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', p_sub::text, 'role', p_role)::text, true);
  END IF;
  EXECUTE format('SET LOCAL ROLE %I', p_role);
  BEGIN
    INSERT INTO public.contact_requests (allocator_id, strategy_id) VALUES (p_alloc, p_strategy);
    v_state := 'admitted';
  EXCEPTION WHEN OTHERS THEN
    v_state := 'denied';
    v_sqlstate := SQLSTATE;
    v_msg := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT count(*) INTO v_n FROM public.contact_requests
   WHERE allocator_id = p_alloc AND strategy_id = p_strategy;
  RETURN ARRAY[v_state, COALESCE(v_sqlstate, 'none'), COALESCE(v_msg, 'none'), v_n::text];
END
$f$;

DO $$
DECLARE
  u_owner        uuid;
  u_alloc        uuid;
  u_both         uuid;
  u_admin        uuid;
  u_unapproved   uuid;
  u_both_half    uuid;
  u_manager      uuid;
  u_admin_mgr    uuid;
  u_unattested   uuid;
  s_admit        uuid;
  s_both         uuid;
  s_admin        uuid;
  s_unapproved   uuid;
  s_both_half    uuid;
  s_manager      uuid;
  s_admin_mgr    uuid;
  s_unattested   uuid;
  s_owner        uuid;
  s_anon         uuid;
  v_oid          oid;
  v_r            text[];
  v_state        text;
  v_sqlstate     text;
  v_msg          text;
BEGIN
  -- ----- SEED (connecting superuser role: bypasses RLS) ---------------------
  u_owner      := pg_temp.ia_user('owner',      'manager',   'verified', 'verified', false, true);
  u_alloc      := pg_temp.ia_user('alloc',      'allocator', 'verified', 'newbie',   false, true);
  u_both       := pg_temp.ia_user('both',       'both',      'verified', 'verified', false, true);
  u_admin      := pg_temp.ia_user('admin',      'allocator', 'newbie',   'newbie',   true,  true);
  u_unapproved := pg_temp.ia_user('unapproved', 'allocator', 'pending',  'newbie',   false, true);
  u_both_half  := pg_temp.ia_user('bothhalf',   'both',      'verified', 'pending',  false, true);
  u_manager    := pg_temp.ia_user('manager',    'manager',   'verified', 'verified', false, true);
  u_admin_mgr  := pg_temp.ia_user('adminmgr',   'manager',   'newbie',   'newbie',   true,  true);
  u_unattested := pg_temp.ia_user('unattested', 'allocator', 'verified', 'newbie',   false, false);
  s_admit      := pg_temp.ia_strategy(u_owner);
  s_both       := pg_temp.ia_strategy(u_owner);
  s_admin      := pg_temp.ia_strategy(u_owner);
  s_unapproved := pg_temp.ia_strategy(u_owner);
  s_both_half  := pg_temp.ia_strategy(u_owner);
  s_manager    := pg_temp.ia_strategy(u_owner);
  s_admin_mgr  := pg_temp.ia_strategy(u_owner);
  s_unattested := pg_temp.ia_strategy(u_owner);
  s_owner      := pg_temp.ia_strategy(u_owner);
  s_anon       := pg_temp.ia_strategy(u_owner);

  -- ----- SETUP CHECKS (untwinned controls, never a skip) ---------------------
  v_oid := to_regprocedure('public.send_intro_with_decision(uuid,uuid,uuid,uuid,text,uuid)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'ARM 0 FAILED (control): public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid) does not exist - this gate has nothing to test and must not skip';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.contact_requests', 'INSERT')
     OR NOT has_table_privilege('anon', 'public.contact_requests', 'INSERT') THEN
    RAISE EXCEPTION 'ARM 0 FAILED (control): anon or authenticated lacks INSERT on public.contact_requests, so a refusal below would come from the grant layer and not from the policy';
  END IF;
  IF NOT COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.contact_requests'::regclass), false) THEN
    RAISE EXCEPTION 'ARM 0 FAILED (control): row level security is not enabled on public.contact_requests';
  END IF;

  -- ===== ARM ACL-PUBLIC - PUBLIC holds no EXECUTE on the six-argument function ====
  -- RED-UNDER: on the live database, after the migration (and its own catalogue verification) has
  --            applied, GRANT EXECUTE on the six-argument function TO PUBLIC. A post-apply `sql`
  --            step, because an edit widening the grant would trip the migration's own verification
  --            block during the apply. Placed first of the ACL arms: a grant to PUBLIC is inherited
  --            by anon and authenticated, so it must be named here and not by the next two arms.
  -- RED-UNDER-M: {"arm":"ACL-PUBLIC","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.send_intro_with_decision(uuid,uuid,uuid,uuid,text,uuid) TO PUBLIC"}]}
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (ACL-PUBLIC): PUBLIC holds EXECUTE on public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid), only service_role may call it';
  END IF;

  -- ===== ARM ACL-ANON - anon holds no EXECUTE on the six-argument function ========
  -- RED-UNDER: on the live database, GRANT EXECUTE on the six-argument function TO anon. ACL-PUBLIC
  --            stays green, because the grant names the role and not PUBLIC.
  -- RED-UNDER-M: {"arm":"ACL-ANON","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.send_intro_with_decision(uuid,uuid,uuid,uuid,text,uuid) TO anon"}]}
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (ACL-ANON): anon holds EXECUTE on public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid), only service_role may call it';
  END IF;

  -- ===== ARM ACL-AUTH - authenticated holds no EXECUTE on the six-argument function ===
  -- RED-UNDER: on the live database, GRANT EXECUTE on the six-argument function TO authenticated.
  -- RED-UNDER-M: {"arm":"ACL-AUTH","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.send_intro_with_decision(uuid,uuid,uuid,uuid,text,uuid) TO authenticated"}]}
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (ACL-AUTH): authenticated holds EXECUTE on public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid), only service_role may call it';
  END IF;

  -- ===== ARM ACL-SVC - service_role keeps EXECUTE on the six-argument function ====
  -- RED-UNDER: on the live database, REVOKE EXECUTE on the six-argument function FROM service_role:
  --            the admin match path, which calls it through the service-role client, would lose it.
  -- RED-UNDER-M: {"arm":"ACL-SVC","apply":[{"kind":"sql","stmt":"REVOKE EXECUTE ON FUNCTION public.send_intro_with_decision(uuid,uuid,uuid,uuid,text,uuid) FROM service_role"}]}
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (ACL-SVC): service_role lacks EXECUTE on public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid), the admin match path cannot call it';
  END IF;

  -- ===== ARM ACL-CALL - an authenticated call is refused at the privilege check ===
  -- RED-UNDER: on the live database, GRANT EXECUTE on the six-argument function TO authenticated.
  --            ACL-AUTH names that grant first, so this arm is observed with ACL-AUTH neutered: the
  --            call then succeeds and the behavioural arm is what names it, which shows the catalogue
  --            check and the real call agree.
  -- RED-UNDER-M: {"arm":"ACL-CALL","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.send_intro_with_decision(uuid,uuid,uuid,uuid,text,uuid) TO authenticated"}],"neuter":[{"arm":"ACL-AUTH"}]}
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', u_alloc::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_state := NULL; v_sqlstate := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.send_intro_with_decision(gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), NULL::text, gen_random_uuid());
    v_state := 'permitted';
  EXCEPTION WHEN OTHERS THEN
    v_state := 'denied';
    v_sqlstate := SQLSTATE;
    v_msg := SQLERRM;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF v_state IS DISTINCT FROM 'denied' OR v_sqlstate IS DISTINCT FROM '42501'
     OR v_msg NOT LIKE '%permission denied for function%' THEN
    RAISE EXCEPTION 'TEST FAILED (ACL-CALL): an authenticated call of the six-argument function was % (SQLSTATE %, message %), expected a 42501 refusal at the privilege check',
      COALESCE(v_state, 'unknown'), COALESCE(v_sqlstate, 'none'), COALESCE(v_msg, 'none');
  END IF;

  -- ===== ARM POL-ADMIT - an approved attested allocator's insert is admitted ======
  -- RED-UNDER: replace the policy's check with `false` on the live database. An approved, attested
  --            allocator is then refused, which is the policy being stricter than /api/intro.
  -- RED-UNDER-M: {"arm":"POL-ADMIT","apply":[{"kind":"sql","stmt":"ALTER POLICY contact_requests_insert ON public.contact_requests WITH CHECK (false)"}]}
  v_r := pg_temp.ia_insert_as('authenticated', u_alloc, u_alloc, s_admit);
  IF v_r[1] IS DISTINCT FROM 'admitted' OR v_r[4]::integer <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (POL-ADMIT): an approved attested allocator''s insert is admitted - the insert was % (SQLSTATE %, message %), rows after: %, the route admits this caller',
      v_r[1], v_r[2], v_r[3], v_r[4];
  END IF;

  -- ===== ARM POL-BOTH - an approved attested both account's insert is admitted ====
  -- RED-UNDER: narrow the role list in the policy's check to allocator only. A both account with
  --            both statuses verified is then refused, again stricter than the route.
  -- RED-UNDER-M: {"arm":"POL-BOTH","apply":[{"kind":"sql","stmt":"ALTER POLICY contact_requests_insert ON public.contact_requests WITH CHECK (allocator_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('allocator') AND (p.is_admin OR (p.role = 'allocator' AND p.allocator_status = 'verified') OR (p.role = 'both' AND p.allocator_status = 'verified' AND p.manager_status = 'verified'))) AND EXISTS (SELECT 1 FROM public.investor_attestations a WHERE a.user_id = auth.uid() AND a.attested_at IS NOT NULL))"}]}
  v_r := pg_temp.ia_insert_as('authenticated', u_both, u_both, s_both);
  IF v_r[1] IS DISTINCT FROM 'admitted' OR v_r[4]::integer <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (POL-BOTH): an approved attested both account''s insert is admitted - the insert was % (SQLSTATE %, message %), rows after: %, the route admits this caller',
      v_r[1], v_r[2], v_r[3], v_r[4];
  END IF;

  -- ===== ARM POL-ADMIN - an attested admin with the allocator role is admitted ====
  -- RED-UNDER: remove the is_admin disjunct from the policy's approval check. An admin whose
  --            statuses are both newbie is then refused, while the route admits an admin.
  -- RED-UNDER-M: {"arm":"POL-ADMIN","apply":[{"kind":"sql","stmt":"ALTER POLICY contact_requests_insert ON public.contact_requests WITH CHECK (allocator_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('allocator', 'both') AND ((p.role = 'allocator' AND p.allocator_status = 'verified') OR (p.role = 'both' AND p.allocator_status = 'verified' AND p.manager_status = 'verified'))) AND EXISTS (SELECT 1 FROM public.investor_attestations a WHERE a.user_id = auth.uid() AND a.attested_at IS NOT NULL))"}]}
  v_r := pg_temp.ia_insert_as('authenticated', u_admin, u_admin, s_admin);
  IF v_r[1] IS DISTINCT FROM 'admitted' OR v_r[4]::integer <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (POL-ADMIN): an attested admin with the allocator role is admitted - the insert was % (SQLSTATE %, message %), rows after: %, the route admits this caller',
      v_r[1], v_r[2], v_r[3], v_r[4];
  END IF;

  -- ===== ARM POL-UNAPPROVED - an unapproved allocator's insert is refused =========
  -- RED-UNDER: remove the approval disjunction from the policy's check, keeping the owner, role and
  --            attestation conjuncts. The allocator with a pending status is then admitted.
  -- RED-UNDER-M: {"arm":"POL-UNAPPROVED","apply":[{"kind":"sql","stmt":"ALTER POLICY contact_requests_insert ON public.contact_requests WITH CHECK (allocator_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('allocator', 'both') AND true) AND EXISTS (SELECT 1 FROM public.investor_attestations a WHERE a.user_id = auth.uid() AND a.attested_at IS NOT NULL))"}]}
  v_r := pg_temp.ia_insert_as('authenticated', u_unapproved, u_unapproved, s_unapproved);
  IF v_r[1] IS DISTINCT FROM 'denied' OR v_r[2] IS DISTINCT FROM '42501'
     OR v_r[3] NOT LIKE '%row-level security%' OR v_r[4]::integer <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (POL-UNAPPROVED): an unapproved allocator''s insert is refused - the insert was % (SQLSTATE %, message %), rows after: %, the route refuses this caller',
      v_r[1], v_r[2], v_r[3], v_r[4];
  END IF;

  -- ===== ARM POL-BOTH-HALF - a both account with one status verified is refused ===
  -- RED-UNDER: relax the both branch of the approval check to require the allocator status only.
  --            The both account whose manager status is pending is then admitted.
  -- RED-UNDER-M: {"arm":"POL-BOTH-HALF","apply":[{"kind":"sql","stmt":"ALTER POLICY contact_requests_insert ON public.contact_requests WITH CHECK (allocator_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('allocator', 'both') AND (p.is_admin OR (p.role = 'allocator' AND p.allocator_status = 'verified') OR (p.role = 'both' AND p.allocator_status = 'verified'))) AND EXISTS (SELECT 1 FROM public.investor_attestations a WHERE a.user_id = auth.uid() AND a.attested_at IS NOT NULL))"}]}
  v_r := pg_temp.ia_insert_as('authenticated', u_both_half, u_both_half, s_both_half);
  IF v_r[1] IS DISTINCT FROM 'denied' OR v_r[2] IS DISTINCT FROM '42501'
     OR v_r[3] NOT LIKE '%row-level security%' OR v_r[4]::integer <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (POL-BOTH-HALF): a both account with one status verified is refused - the insert was % (SQLSTATE %, message %), rows after: %, the route refuses this caller',
      v_r[1], v_r[2], v_r[3], v_r[4];
  END IF;

  -- ===== ARM POL-MANAGER - a verified manager's insert is refused =================
  -- RED-UNDER: add a verified-manager approval branch to the policy's check and drop its role
  --            conjunct. The manager is then admitted.
  -- RED-UNDER-M: {"arm":"POL-MANAGER","apply":[{"kind":"sql","stmt":"ALTER POLICY contact_requests_insert ON public.contact_requests WITH CHECK (allocator_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND true AND (p.is_admin OR (p.role = 'allocator' AND p.allocator_status = 'verified') OR (p.role = 'both' AND p.allocator_status = 'verified' AND p.manager_status = 'verified') OR (p.role = 'manager' AND p.manager_status = 'verified'))) AND EXISTS (SELECT 1 FROM public.investor_attestations a WHERE a.user_id = auth.uid() AND a.attested_at IS NOT NULL))"}]}
  v_r := pg_temp.ia_insert_as('authenticated', u_manager, u_manager, s_manager);
  IF v_r[1] IS DISTINCT FROM 'denied' OR v_r[2] IS DISTINCT FROM '42501'
     OR v_r[3] NOT LIKE '%row-level security%' OR v_r[4]::integer <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (POL-MANAGER): a verified manager''s insert is refused - the insert was % (SQLSTATE %, message %), rows after: %, the route refuses this caller',
      v_r[1], v_r[2], v_r[3], v_r[4];
  END IF;

  -- ===== ARM POL-ADMIN-MANAGER - an admin with the manager role is refused ========
  -- RED-UNDER: drop the role conjunct from the policy's check, leaving the approval branches as
  --            they are. The admin whose role is manager is then admitted, because the route runs
  --            its role check after the approval gate and applies it to admins too.
  -- RED-UNDER-M: {"arm":"POL-ADMIN-MANAGER","apply":[{"kind":"sql","stmt":"ALTER POLICY contact_requests_insert ON public.contact_requests WITH CHECK (allocator_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND true AND (p.is_admin OR (p.role = 'allocator' AND p.allocator_status = 'verified') OR (p.role = 'both' AND p.allocator_status = 'verified' AND p.manager_status = 'verified'))) AND EXISTS (SELECT 1 FROM public.investor_attestations a WHERE a.user_id = auth.uid() AND a.attested_at IS NOT NULL))"}]}
  v_r := pg_temp.ia_insert_as('authenticated', u_admin_mgr, u_admin_mgr, s_admin_mgr);
  IF v_r[1] IS DISTINCT FROM 'denied' OR v_r[2] IS DISTINCT FROM '42501'
     OR v_r[3] NOT LIKE '%row-level security%' OR v_r[4]::integer <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (POL-ADMIN-MANAGER): an admin with the manager role is refused - the insert was % (SQLSTATE %, message %), rows after: %, the route refuses this caller',
      v_r[1], v_r[2], v_r[3], v_r[4];
  END IF;

  -- ===== ARM POL-UNATTESTED - an allocator with no attestation row is refused =====
  -- RED-UNDER: remove the attestation EXISTS from the policy's check. The approved allocator with
  --            no investor_attestations row is then admitted.
  -- RED-UNDER-M: {"arm":"POL-UNATTESTED","apply":[{"kind":"sql","stmt":"ALTER POLICY contact_requests_insert ON public.contact_requests WITH CHECK (allocator_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('allocator', 'both') AND (p.is_admin OR (p.role = 'allocator' AND p.allocator_status = 'verified') OR (p.role = 'both' AND p.allocator_status = 'verified' AND p.manager_status = 'verified'))) AND true)"}]}
  v_r := pg_temp.ia_insert_as('authenticated', u_unattested, u_unattested, s_unattested);
  IF v_r[1] IS DISTINCT FROM 'denied' OR v_r[2] IS DISTINCT FROM '42501'
     OR v_r[3] NOT LIKE '%row-level security%' OR v_r[4]::integer <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (POL-UNATTESTED): an allocator with no attestation row is refused - the insert was % (SQLSTATE %, message %), rows after: %, the route refuses this caller',
      v_r[1], v_r[2], v_r[3], v_r[4];
  END IF;

  -- ===== ARM POL-OWNER - a caller naming another allocator_id is refused ==========
  -- RED-UNDER: remove the allocator_id = auth.uid() conjunct from the policy's check. The approved,
  --            attested allocator naming another account's id is then admitted.
  -- RED-UNDER-M: {"arm":"POL-OWNER","apply":[{"kind":"sql","stmt":"ALTER POLICY contact_requests_insert ON public.contact_requests WITH CHECK (true AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('allocator', 'both') AND (p.is_admin OR (p.role = 'allocator' AND p.allocator_status = 'verified') OR (p.role = 'both' AND p.allocator_status = 'verified' AND p.manager_status = 'verified'))) AND EXISTS (SELECT 1 FROM public.investor_attestations a WHERE a.user_id = auth.uid() AND a.attested_at IS NOT NULL))"}]}
  v_r := pg_temp.ia_insert_as('authenticated', u_alloc, u_both, s_owner);
  IF v_r[1] IS DISTINCT FROM 'denied' OR v_r[2] IS DISTINCT FROM '42501'
     OR v_r[3] NOT LIKE '%row-level security%' OR v_r[4]::integer <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (POL-OWNER): a caller naming another allocator_id is refused - the insert was % (SQLSTATE %, message %), rows after: %, the route refuses this caller',
      v_r[1], v_r[2], v_r[3], v_r[4];
  END IF;

  -- ===== ARM POL-ANON - anon naming an allocator_id is refused ====================
  -- RED-UNDER: let the policy's check pass when auth.uid() is NULL (the full check is kept as the
  --            other disjunct). The anon session, whose claims are cleared, is then admitted.
  -- RED-UNDER-M: {"arm":"POL-ANON","apply":[{"kind":"sql","stmt":"ALTER POLICY contact_requests_insert ON public.contact_requests WITH CHECK ((auth.uid() IS NULL) OR (allocator_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('allocator', 'both') AND (p.is_admin OR (p.role = 'allocator' AND p.allocator_status = 'verified') OR (p.role = 'both' AND p.allocator_status = 'verified' AND p.manager_status = 'verified'))) AND EXISTS (SELECT 1 FROM public.investor_attestations a WHERE a.user_id = auth.uid() AND a.attested_at IS NOT NULL)))"}]}
  v_r := pg_temp.ia_insert_as('anon', NULL::uuid, u_alloc, s_anon);
  IF v_r[1] IS DISTINCT FROM 'denied' OR v_r[2] IS DISTINCT FROM '42501'
     OR v_r[3] NOT LIKE '%row-level security%' OR v_r[4]::integer <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (POL-ANON): anon naming an allocator_id is refused - the insert was % (SQLSTATE %, message %), rows after: %, the route refuses this caller',
      v_r[1], v_r[2], v_r[3], v_r[4];
  END IF;

  RAISE NOTICE 'ALL 15 ARMS EXECUTED (ACL-PUBLIC, ACL-ANON, ACL-AUTH, ACL-SVC, ACL-CALL, POL-ADMIT, POL-BOTH, POL-ADMIN, POL-UNAPPROVED, POL-BOTH-HALF, POL-MANAGER, POL-ADMIN-MANAGER, POL-UNATTESTED, POL-OWNER, POL-ANON): the six-argument function is callable by service_role only (ACL-PUBLIC, ACL-ANON, ACL-AUTH, ACL-SVC) and an authenticated call is refused at the privilege check (ACL-CALL), the policy admits an approved attested allocator, both account and admin (POL-ADMIT, POL-BOTH, POL-ADMIN) and refuses an unapproved allocator, a half-approved both account, a manager, an admin with the manager role, an unattested allocator, another allocator_id and anon (POL-UNAPPROVED, POL-BOTH-HALF, POL-MANAGER, POL-ADMIN-MANAGER, POL-UNATTESTED, POL-OWNER, POL-ANON).';
END $$;

ROLLBACK;
