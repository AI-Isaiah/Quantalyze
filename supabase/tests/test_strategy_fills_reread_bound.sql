-- Test for Migration 20261126150000_strategy_fills_reread_bound.sql —
-- the per-strategy re-read bound and its fenced writer. Phase 253 BINANCECURSOR.
--
-- WHY THIS FILE EXISTS. The migration's self-verifying DO block is CATALOGUE-ONLY and
-- runs once, at apply: it proves the table, the policy and the ACL exist, and it never
-- calls the function. Every RULE of `set_strategy_fills_reread_bound` (the fence, the
-- LEAST, the cover-advance, the clear, the re-point) is behaviour, so it is pinned here,
-- one named arm per case id of the phase's shared case table (C0 to C10), and each arm
-- goes RED under its own twin. Instants: E = 2026-06-01 09:00, B = 2026-06-02 09:00,
-- L = 2026-06-03 09:00, CV = 2026-06-02 08:00 (covers B), NC = 2026-06-02 10:00 (does not
-- cover B), all UTC. Keys K1 and K2. `p_covers_from = -infinity` means the walk started at
-- the venue reach.
--
-- Arms, in run order: 0 (applied-ness), SEED 1, GRANT 1, EXEC 1, SECDEF 1, C0 to C10,
-- FENCE 1, FENCE 2, NULL-ID, POLICY 1, POLICY 2 precondition, POLICY 2, RESTORE 1, CASCADE 1.
--
-- pgTAP is NOT installed in this project, so this uses the plain PL/pgSQL convention of
-- the other supabase/tests/test_*.sql files: DO blocks with RAISE EXCEPTION on failure
-- and RAISE NOTICE on a pass. No pgTAP and no psql backslash meta-commands. Under
-- `psql -v ON_ERROR_STOP=1` a failed assertion exits non-zero. There is deliberately NO
-- all-arms-executed sentinel line: the precedent gate has none, so ci.yml's sentinel
-- census does not move.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_strategy_fills_reread_bound.sql
--
-- ==========================================================================
-- THE VACUITY THIS FILE IS BUILT AROUND (the per-strategy cursor gate's lesson)
-- ==========================================================================
-- A 42501 raised by the GRANT layer must NEVER be read as proof that the deny POLICY
-- fired. After the migration both client roles hold nothing on the table, so a behavioural
-- arm in the usual shape would be refused at the grant layer every time. So the two layers
-- are split: GRANT 1 reads the PRISTINE ACL first; the gate then restores DML to
-- `authenticated` inside the seeding context so the policy is the only thing that can deny;
-- each policy arm asserts NO EXCEPTION was raised before it asserts a row count; RESTORE 1
-- takes the grant away and re-reads the ACL. A DO block is one transaction and ACL changes
-- are transactional, so the restored grant is never visible to another session.
--
-- RED-UNDER ANNOTATIONS (Phase 164.4 grammar, scripts/mutation-runner/GRAMMAR.md). Each
-- arm carries a prose `RED-UNDER:` and a machine-readable `RED-UNDER-M:` twin the mutation
-- runner applies on a throwaway pg-lane cluster to prove the arm reds FIRST, then restores.
-- 07-fixture-supabase-default-privileges.sql is LOAD-BEARING in the apply list: GRANT 1's
-- twin deletes the migration's table REVOKE, and without the fixture the ACL would come
-- back empty anyway and the arm would score no-red on a control that is in fact enforced.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","supabase/migrations/20261126150000_strategy_fills_reread_bound.sql"]}

-- --------------------------------------------------------------------------
-- Defensive pre-clean. ON DELETE CASCADE chains auth.users -> profiles ->
-- strategies -> the bound row and compute_jobs, so one delete drops the subtree.
-- --------------------------------------------------------------------------
DELETE FROM auth.users WHERE email = 'test-253-reread-bound@quantalyze.test';

-- Helpers. pg_temp, so nothing outlives the session on a shared database.
-- rb_state: the strategy's stored bound as `<key>|<instant>`, or `none`.
-- rb_set: reset the strategy's bound to exactly the given row (NULL key = no row).
-- rb_call: call the RPC and report `RET <bool>|<state after>` or `RAISED <sqlstate>`, so an
--          arm compares ONE string and a raised call is data rather than an abort.
CREATE FUNCTION pg_temp.rb_state(p_sid uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT COALESCE(
    (SELECT b.api_key_id::text || '|' || b.unread_from::text
       FROM public.strategy_fills_reread_bounds b WHERE b.strategy_id = p_sid),
    'none')
$f$;

CREATE FUNCTION pg_temp.rb_set(p_sid uuid, p_key uuid, p_from timestamptz) RETURNS void LANGUAGE sql AS $f$
  DELETE FROM public.strategy_fills_reread_bounds WHERE strategy_id = p_sid;
  INSERT INTO public.strategy_fills_reread_bounds (strategy_id, api_key_id, unread_from)
    SELECT p_sid, p_key, p_from WHERE p_key IS NOT NULL;
$f$;

CREATE FUNCTION pg_temp.rb_call(p_sid uuid, p_key uuid, p_job uuid, p_token uuid,
                                p_unread timestamptz, p_covers timestamptz) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE
  v_ret BOOLEAN;
BEGIN
  v_ret := public.set_strategy_fills_reread_bound(p_sid, p_key, p_job, p_token, p_unread, p_covers);
  RETURN 'RET ' || COALESCE(v_ret::text, 'NULL') || '|' || pg_temp.rb_state(p_sid);
EXCEPTION WHEN OTHERS THEN
  RETURN 'RAISED ' || SQLSTATE;
END
$f$;

DO $$
DECLARE
  uid_owner UUID := gen_random_uuid();
  sid       UUID;
  k1        UUID;
  k2        UUID;
  job_run   UUID := gen_random_uuid();
  job_done  UUID := gen_random_uuid();
  tok       UUID := gen_random_uuid();
  tok2      UUID := gen_random_uuid();
  v_e       TIMESTAMPTZ := timestamptz '2026-06-01 09:00:00+00';
  v_b       TIMESTAMPTZ := timestamptz '2026-06-02 09:00:00+00';
  v_l       TIMESTAMPTZ := timestamptz '2026-06-03 09:00:00+00';
  v_cv      TIMESTAMPTZ := timestamptz '2026-06-02 08:00:00+00';
  v_nc      TIMESTAMPTZ := timestamptz '2026-06-02 10:00:00+00';
  v_ninf    TIMESTAMPTZ := '-infinity'::timestamptz;
  v_got     TEXT;
  v_privs   TEXT;
  v_sig     TEXT := 'public.set_strategy_fills_reread_bound(uuid,uuid,uuid,uuid,timestamptz,timestamptz)';
  v_secdef  BOOLEAN;
  v_config  TEXT[];
  v_cnt     INTEGER;
  v_priv    TEXT;
  visible   INTEGER;
  raised    BOOLEAN;
  err_state TEXT;
BEGIN
  -- ----- applied-ness gate: ABSENCE IS A FAILURE, NEVER A SKIP -----------
  -- RED-UNDER: DROP the function on the live lane after the migration has applied. A `sql`
  --            step and not a migration edit, because the migration carries its own
  --            catalogue self-verify (it asserts the function exists), so renaming the
  --            CREATE would abort the apply and the gate would never run.
  -- RED-UNDER-M: {"arm":"0","apply":[{"kind":"sql","stmt":"DROP FUNCTION public.set_strategy_fills_reread_bound(uuid,uuid,uuid,uuid,timestamptz,timestamptz)"}]}
  IF to_regclass('public.strategy_fills_reread_bounds') IS NULL
     OR to_regprocedure('public.set_strategy_fills_reread_bound(uuid,uuid,uuid,uuid,timestamptz,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (0): the table public.strategy_fills_reread_bounds or the function public.set_strategy_fills_reread_bound does not exist on this database, so NONE of the arms ran. This is a FAILURE, not a skip. Either this database has not received migration 20261126150000 (expect that once, on the PR that introduces it), or the objects were dropped or renamed after being applied, which would silently return a stopped Binance read to the per key cursor that strands its span. Do NOT turn this into a skip.';
  END IF;

  -- ----- SEED (owner context, bypasses RLS) -------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_owner, '00000000-0000-0000-0000-000000000000',
          'test-253-reread-bound@quantalyze.test', now(), now());

  -- On a real project the on_auth_user_created trigger has already created the profile
  -- row, so this is an upsert (the idiom the per-strategy cursor gate uses).
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_owner, 'reread bound owner', 'test-253-reread-bound@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO strategies (user_id, name)
  VALUES (uid_owner, 'reread bound strategy')
  RETURNING id INTO sid;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_owner, 'okx', 'reread bound K1', 'enc')
  RETURNING id INTO k1;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_owner, 'okx', 'reread bound K2', 'enc')
  RETURNING id INTO k2;

  -- A running job under `tok` (the fence's owner) and a finished job (the fence's
  -- not-running case). The finished one is outside the one-in-flight index.
  INSERT INTO public.compute_jobs (id, kind, strategy_id, status, claim_token, claimed_at)
  VALUES (job_run, 'sync_trades', sid, 'running', tok, now());
  INSERT INTO public.compute_jobs (id, kind, strategy_id, status, claim_token, claimed_at)
  VALUES (job_done, 'sync_trades', sid, 'done', tok2, now());

  RAISE NOTICE 'Seed OK: owner=% strategy=% K1=% K2=%', uid_owner, sid, k1, k2;

  -- ======================================================================
  -- SEED 1: the seeded rows exist, so every zero-row arm below is not vacuous
  -- ======================================================================
  -- Every "stored row after = none" arm (C0, C5, C7, C9, C10) is a statement about a row
  -- that was there a moment earlier. Over a strategy or key that does not exist, or a
  -- seeding helper that stores nothing, those arms are satisfied by any function at all.
  -- RED-UNDER: stop the bound row landing: replace the seeding call below with a `NULL;`
  --            no-op. Every clear arm would still pass over the empty table while proving
  --            nothing about the clear, which is what this arm exists to refuse.
  --            (Seed-targeting twin; no assertion, failure branch or identity is touched,
  --            GRAMMAR 3a/3b.)
  -- RED-UNDER-M: {"arm":"SEED 1","apply":[{"kind":"edit","file":"supabase/tests/test_strategy_fills_reread_bound.sql","find":"PERFORM pg_temp.rb_set(sid, k1, v_b); -- SEED 1 seed\n","replace":"NULL; -- SEED 1 seed\n","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- SEED 1 seed
  SELECT (SELECT count(*) FROM strategies WHERE id = sid)::int
       + (SELECT count(*) FROM api_keys WHERE id IN (k1, k2))::int
    INTO v_cnt;
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (SEED 1): the seeded tenant has % of its 3 strategy and key rows (1 strategy plus K1 and K2), so the zero-row arms below would measure nothing.', v_cnt;
  END IF;
  IF pg_temp.rb_state(sid) IS DISTINCT FROM k1::text || '|' || v_b::text THEN
    RAISE EXCEPTION 'TEST FAILED (SEED 1): the seeded bound row is %, expected (K1, B). Every clear arm below is a statement about this row; over an empty table it is satisfied by any function.', pg_temp.rb_state(sid);
  END IF;
  RAISE NOTICE 'SEED 1 OK: the seeded strategy, both keys and the seeded bound row are present.';

  -- ======================================================================
  -- GRANT 1: PUBLIC, anon and authenticated hold NO table privilege; service_role holds DML
  -- ======================================================================
  -- The ONLY control reaching the RLS-EXEMPT verbs: no policy governs TRUNCATE, TRIGGER or
  -- REFERENCES, so one TRUNCATE from a client session would discard every strategy's bound
  -- with the deny-all policy watching. Read through aclexplode(relacl), the pristine ACL,
  -- BEFORE the gate restores anything below.
  -- RED-UNDER: delete the table REVOKE from STEP 2 of migration 20261126150000. With the
  --            Supabase default-privileges fixture applied the table then arrives holding
  --            the bootstrap grants to anon and authenticated.
  -- RED-UNDER-M: {"arm":"GRANT 1","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"REVOKE ALL ON TABLE strategy_fills_reread_bounds FROM PUBLIC, anon, authenticated;","replace":"","occurrences":1}]}
  SELECT string_agg(DISTINCT COALESCE(r.rolname, 'PUBLIC') || ':' || acl.privilege_type,
                    ',' ORDER BY COALESCE(r.rolname, 'PUBLIC') || ':' || acl.privilege_type)
    INTO v_privs
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
    LEFT JOIN pg_roles r ON r.oid = acl.grantee
   WHERE c.oid = 'public.strategy_fills_reread_bounds'::regclass
     AND (acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));
  IF v_privs IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 1): the client roles hold table-level privileges "%" on strategy_fills_reread_bounds, expected NONE. The migration REVOKEs ALL from PUBLIC, anon and authenticated, and that REVOKE is the only control reaching TRUNCATE, TRIGGER and REFERENCES.', v_privs;
  END IF;
  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT has_table_privilege('service_role', 'public.strategy_fills_reread_bounds', v_priv) THEN
      RAISE EXCEPTION 'TEST FAILED (GRANT 1): service_role lacks % on strategy_fills_reread_bounds. BYPASSRLS is a row level exemption and confers no object privilege, so without the table GRANT the worker write 42501s.', v_priv;
    END IF;
  END LOOP;
  RAISE NOTICE 'GRANT 1 OK: PUBLIC, anon and authenticated hold nothing; service_role holds SELECT, INSERT, UPDATE and DELETE.';

  -- ======================================================================
  -- EXEC 1: anon, authenticated and PUBLIC have no EXECUTE on the function; service_role has it
  -- ======================================================================
  -- RED-UNDER: GRANT EXECUTE on the function to anon on the live lane. A `sql` step and not
  --            a migration edit: the migration's own catalogue verify pins the same ACL and
  --            would abort the apply, so the gate would never run.
  -- RED-UNDER-M: {"arm":"EXEC 1","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.set_strategy_fills_reread_bound(uuid,uuid,uuid,uuid,timestamptz,timestamptz) TO anon"}]}
  SELECT string_agg(DISTINCT COALESCE(r.rolname, 'PUBLIC'), ',' ORDER BY COALESCE(r.rolname, 'PUBLIC'))
    INTO v_privs
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    LEFT JOIN pg_roles r ON r.oid = acl.grantee
   WHERE p.oid = to_regprocedure(v_sig)
     AND acl.privilege_type = 'EXECUTE'
     AND (acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));
  IF v_privs IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (EXEC 1): % can EXECUTE set_strategy_fills_reread_bound, expected no client role. A client that can call it writes any strategy bound, and can clear one so the next run seeds past an unread span.', v_privs;
  END IF;
  IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (EXEC 1): service_role cannot EXECUTE set_strategy_fills_reread_bound, so the worker write is refused and a stopped read is never bounded.';
  END IF;
  RAISE NOTICE 'EXEC 1 OK: no client role can EXECUTE the function; service_role can.';

  -- ======================================================================
  -- SECDEF 1: SECURITY DEFINER with search_path pinned to public, pg_catalog
  -- ======================================================================
  -- RED-UNDER: ALTER FUNCTION ... SECURITY INVOKER on the live lane. A `sql` step: the
  --            migration's catalogue verify pins prosecdef and would abort the apply.
  -- RED-UNDER-M: {"arm":"SECDEF 1","apply":[{"kind":"sql","stmt":"ALTER FUNCTION public.set_strategy_fills_reread_bound(uuid,uuid,uuid,uuid,timestamptz,timestamptz) SECURITY INVOKER"}]}
  SELECT prosecdef, proconfig INTO v_secdef, v_config
    FROM pg_proc WHERE oid = to_regprocedure(v_sig);
  IF NOT COALESCE(v_secdef, FALSE) THEN
    RAISE EXCEPTION 'TEST FAILED (SECDEF 1): set_strategy_fills_reread_bound is not SECURITY DEFINER. It would then run as its caller and need the table privilege the client roles are denied.';
  END IF;
  IF NOT ('search_path=public, pg_catalog' = ANY (COALESCE(v_config, ARRAY[]::TEXT[]))) THEN
    RAISE EXCEPTION 'TEST FAILED (SECDEF 1): the function proconfig is %, expected search_path=public, pg_catalog. A SECURITY DEFINER function without a pinned search_path resolves names through the caller schema.', v_config;
  END IF;
  RAISE NOTICE 'SECDEF 1 OK: SECURITY DEFINER with search_path pinned.';

  -- ======================================================================
  -- C0: no stored row, NULL, covers -infinity  =>  no row
  -- ======================================================================
  -- RED-UNDER: make the no-row branch insert even when the caller passed NULL: the guard in
  --            front of the INSERT in migration 20261126150000 becomes `IF TRUE`. The
  --            INSERT then violates NOT NULL, the call raises, and this arm reports it.
  -- RED-UNDER-M: {"arm":"C0","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"IF p_unread_from IS NOT NULL THEN\n      -- R1.","replace":"IF TRUE THEN\n      -- R1.","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, NULL, NULL); -- C0 seed
  v_got := pg_temp.rb_call(sid, k1, NULL, NULL, NULL, v_ninf);
  IF v_got IS DISTINCT FROM 'RET true|none' THEN
    RAISE EXCEPTION 'TEST FAILED (C0): with no stored row and a complete read, the call must return TRUE and leave no row; got %. A row created from nothing is a phantom bound that makes the next run re-read for no reason.', v_got;
  END IF;
  RAISE NOTICE 'C0 OK: no row plus NULL leaves no row.';

  -- ======================================================================
  -- C1: no stored row, a value, covers -infinity  =>  the row (K1, B)
  -- ======================================================================
  -- RED-UNDER: make the insert write a LATER instant than the caller gave: the INSERT in
  --            migration 20261126150000 stores `p_unread_from + interval '1 day'`. The call
  --            still returns TRUE and a row exists, so only the stored VALUE gives it away.
  -- RED-UNDER-M: {"arm":"C1","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"VALUES (p_strategy_id, p_api_key_id, p_unread_from, now())","replace":"VALUES (p_strategy_id, p_api_key_id, p_unread_from + interval '1 day', now())","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, NULL, NULL); -- C1 seed
  v_got := pg_temp.rb_call(sid, k1, NULL, NULL, v_b, v_ninf);
  IF v_got IS DISTINCT FROM 'RET true|' || k1::text || '|' || v_b::text THEN
    RAISE EXCEPTION 'TEST FAILED (C1): with no stored row, a stop at B must store exactly (K1, B); got %. A bound stored LATER than the run is complete through is a span that is never re-read (D-03).', v_got;
  END IF;
  RAISE NOTICE 'C1 OK: no row plus a value inserts exactly (K1, B).';

  -- ======================================================================
  -- C2: stored (K1, B), a later value L, covers NC (does not cover B)  =>  (K1, B)
  -- ======================================================================
  -- RED-UNDER: take the new instant on the not-covers branch instead of the earlier of the
  --            two: `SET unread_from = LEAST(v_existing_from, p_unread_from)` in migration
  --            20261126150000 becomes `SET unread_from = p_unread_from`.
  -- RED-UNDER-M: {"arm":"C2","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"SET unread_from = LEAST(v_existing_from, p_unread_from)","replace":"SET unread_from = p_unread_from","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- C2 seed
  v_got := pg_temp.rb_call(sid, k1, NULL, NULL, v_l, v_nc);
  IF v_got IS DISTINCT FROM 'RET true|' || k1::text || '|' || v_b::text THEN
    RAISE EXCEPTION 'TEST FAILED (C2): a run that did not cover the stored bound B and stopped later at L must leave (K1, B); got %. Moving the bound forward over an unread span strands it.', v_got;
  END IF;
  RAISE NOTICE 'C2 OK: a not-covering later stop leaves the bound at B.';

  -- ======================================================================
  -- C3: stored (K1, B), an earlier value E, covers NC  =>  (K1, E)
  -- ======================================================================
  -- RED-UNDER: keep the stored instant on the not-covers branch: `SET unread_from =
  --            LEAST(v_existing_from, p_unread_from)` becomes `SET unread_from =
  --            v_existing_from`. C2 still passes (B stays B); only the move EARLIER fails.
  -- RED-UNDER-M: {"arm":"C3","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"SET unread_from = LEAST(v_existing_from, p_unread_from)","replace":"SET unread_from = v_existing_from","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- C3 seed
  v_got := pg_temp.rb_call(sid, k1, NULL, NULL, v_e, v_nc);
  IF v_got IS DISTINCT FROM 'RET true|' || k1::text || '|' || v_e::text THEN
    RAISE EXCEPTION 'TEST FAILED (C3): a run that stopped EARLIER than the stored bound must move it to E; got %. The bound has to follow the earliest unread instant down.', v_got;
  END IF;
  RAISE NOTICE 'C3 OK: an earlier stop lowers the bound to E.';

  -- ======================================================================
  -- C4: stored (K1, B), a later value L, covers CV (covers B)  =>  (K1, L)
  -- ======================================================================
  -- RED-UNDER: use LEAST on the covered branch too: `SET unread_from = p_unread_from,
  --            updated_at = now()` in migration 20261126150000 becomes
  --            `SET unread_from = LEAST(v_existing_from, p_unread_from), updated_at = now()`.
  --            C2 and C3 still pass; only the cover-advance fails.
  -- RED-UNDER-M: {"arm":"C4","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"SET unread_from = p_unread_from, updated_at = now()","replace":"SET unread_from = LEAST(v_existing_from, p_unread_from), updated_at = now()","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- C4 seed
  v_got := pg_temp.rb_call(sid, k1, NULL, NULL, v_l, v_cv);
  IF v_got IS DISTINCT FROM 'RET true|' || k1::text || '|' || v_l::text THEN
    RAISE EXCEPTION 'TEST FAILED (C4): a run that covered the stored bound B and stopped later at L must move it forward to L; got %. With LEAST here a repeated stop re-reads the same span for ever and never advances (the stall).', v_got;
  END IF;
  RAISE NOTICE 'C4 OK: a covering later stop advances the bound to L.';

  -- ======================================================================
  -- C5: stored (K1, B), NULL, covers CV  =>  no row
  -- ======================================================================
  -- RED-UNDER: turn the covered-clear DELETE into a no-op: the DELETE guarded by
  --            `AND api_key_id = p_api_key_id` in migration 20261126150000 becomes `NULL;`.
  -- RED-UNDER-M: {"arm":"C5","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"DELETE FROM public.strategy_fills_reread_bounds\n     WHERE strategy_id = p_strategy_id AND api_key_id = p_api_key_id;","replace":"NULL;","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- C5 seed
  v_got := pg_temp.rb_call(sid, k1, NULL, NULL, NULL, v_cv);
  IF v_got IS DISTINCT FROM 'RET true|none' THEN
    RAISE EXCEPTION 'TEST FAILED (C5): a complete run that covered the stored bound must clear it; got %. A bound that is never cleared re-reads from B on every later run.', v_got;
  END IF;
  RAISE NOTICE 'C5 OK: a complete covering run clears the bound.';

  -- ======================================================================
  -- C6: stored (K1, B), NULL, covers NC (does not cover B)  =>  (K1, B)
  -- ======================================================================
  -- RED-UNDER: make the keep branch delete: the neutral statement under the R7 comment in
  --            migration 20261126150000 becomes a DELETE of the strategy row.
  -- RED-UNDER-M: {"arm":"C6","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"-- R7: a complete run that did not reach the bound proves nothing about it.\n    NULL;","replace":"-- R7 neutered\n    DELETE FROM public.strategy_fills_reread_bounds WHERE strategy_id = p_strategy_id;","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- C6 seed
  v_got := pg_temp.rb_call(sid, k1, NULL, NULL, NULL, v_nc);
  IF v_got IS DISTINCT FROM 'RET true|' || k1::text || '|' || v_b::text THEN
    RAISE EXCEPTION 'TEST FAILED (C6): a complete run that did NOT reach the stored bound must keep it; got %. Clearing it would let the next run seed past the span that run never read.', v_got;
  END IF;
  RAISE NOTICE 'C6 OK: a complete non-covering run keeps the bound.';

  -- ======================================================================
  -- C7: stored (K1, B), NULL, covers -infinity  =>  no row
  -- ======================================================================
  -- RED-UNDER: stop -infinity counting as covering: the covers expression in migration
  --            20261126150000 gains `AND p_covers_from > '-infinity'::timestamptz`. C4, C5
  --            and C10 still pass; a walk that started at the venue reach no longer clears.
  -- RED-UNDER-M: {"arm":"C7","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"v_covers := p_covers_from IS NOT NULL AND p_covers_from <= v_existing_from;","replace":"v_covers := p_covers_from IS NOT NULL AND p_covers_from > '-infinity'::timestamptz AND p_covers_from <= v_existing_from;","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- C7 seed
  v_got := pg_temp.rb_call(sid, k1, NULL, NULL, NULL, v_ninf);
  IF v_got IS DISTINCT FROM 'RET true|none' THEN
    RAISE EXCEPTION 'TEST FAILED (C7): a complete run whose walk started at the venue reach (-infinity) covered every reachable instant and must clear the bound; got %.', v_got;
  END IF;
  RAISE NOTICE 'C7 OK: a complete run from the venue reach clears the bound.';

  -- ======================================================================
  -- C8: stored (K1, B), key K2, a value L, covers NC  =>  (K2, L)
  -- ======================================================================
  -- RED-UNDER: take LEAST on a key re-point: `SET api_key_id = p_api_key_id, unread_from =
  --            p_unread_from` in migration 20261126150000 takes the earlier of the old and
  --            new instants, so the new key inherits a bound naming the OLD key's history.
  -- RED-UNDER-M: {"arm":"C8","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"SET api_key_id = p_api_key_id, unread_from = p_unread_from","replace":"SET api_key_id = p_api_key_id, unread_from = LEAST(v_existing_from, p_unread_from)","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- C8 seed
  v_got := pg_temp.rb_call(sid, k2, NULL, NULL, v_l, v_nc);
  IF v_got IS DISTINCT FROM 'RET true|' || k2::text || '|' || v_l::text THEN
    RAISE EXCEPTION 'TEST FAILED (C8): a re-point to K2 must replace key and instant with (K2, L); got %. The old key''s instant says nothing about K2''s history.', v_got;
  END IF;
  RAISE NOTICE 'C8 OK: a re-point replaces key and instant.';

  -- ======================================================================
  -- C9: stored (K1, B), key K2, NULL, covers NC  =>  no row
  -- ======================================================================
  -- RED-UNDER: turn the other-key delete into a no-op: the DELETE guarded by
  --            `AND api_key_id = v_existing_key` in migration 20261126150000 becomes `NULL;`.
  -- RED-UNDER-M: {"arm":"C9","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"DELETE FROM public.strategy_fills_reread_bounds\n       WHERE strategy_id = p_strategy_id AND api_key_id = v_existing_key;","replace":"NULL;","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- C9 seed
  v_got := pg_temp.rb_call(sid, k2, NULL, NULL, NULL, v_nc);
  IF v_got IS DISTINCT FROM 'RET true|none' THEN
    RAISE EXCEPTION 'TEST FAILED (C9): a complete run on K2 must delete a bound that names K1; got %. A K1 bound left behind makes the strategy re-read K1''s window on K2.', v_got;
  END IF;
  RAISE NOTICE 'C9 OK: a complete run on another key deletes the old key''s bound.';

  -- ======================================================================
  -- C10: stored (K1, B), NULL, covers exactly B  =>  no row (the comparison is inclusive)
  -- ======================================================================
  -- RED-UNDER: make the covers comparison strict: `p_covers_from <= v_existing_from` in
  --            migration 20261126150000 becomes `p_covers_from < v_existing_from`. A walk
  --            that started exactly at the bound no longer clears it.
  -- RED-UNDER-M: {"arm":"C10","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"p_covers_from <= v_existing_from","replace":"p_covers_from < v_existing_from","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- C10 seed
  v_got := pg_temp.rb_call(sid, k1, NULL, NULL, NULL, v_b);
  IF v_got IS DISTINCT FROM 'RET true|none' THEN
    RAISE EXCEPTION 'TEST FAILED (C10): a complete run whose walk started exactly at the stored bound B read from B and must clear it; got %. The next walk starts at or below the bound, so an exclusive comparison keeps a bound that was already read.', v_got;
  END IF;
  RAISE NOTICE 'C10 OK: a walk that started exactly at the bound clears it.';

  -- ======================================================================
  -- FENCE 1: an orphan token returns FALSE and writes nothing
  -- ======================================================================
  -- RED-UNDER: delete the fence's early return: the `RETURN FALSE;` in migration
  --            20261126150000 becomes `NULL;`. An orphaned worker then writes.
  -- RED-UNDER-M: {"arm":"FENCE 1","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"RETURN FALSE;","replace":"NULL;","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- FENCE 1 seed
  v_got := pg_temp.rb_call(sid, k1, job_run, tok, v_e, v_nc);
  IF v_got IS DISTINCT FROM 'RET true|' || k1::text || '|' || v_e::text THEN
    RAISE EXCEPTION 'TEST FAILED (FENCE 1): the owner of the running job under its own token must write; got %.', v_got;
  END IF;
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- FENCE 1 reseed
  v_got := pg_temp.rb_call(sid, k1, job_run, gen_random_uuid(), v_e, v_nc);
  IF v_got IS DISTINCT FROM 'RET false|' || k1::text || '|' || v_b::text THEN
    RAISE EXCEPTION 'TEST FAILED (FENCE 1): a call carrying a token that is not the running job''s must return FALSE and leave (K1, B); got %. An orphaned worker that writes lowers or clears a live bound.', v_got;
  END IF;
  v_got := pg_temp.rb_call(sid, k1, job_done, tok2, v_e, v_nc);
  IF v_got IS DISTINCT FROM 'RET false|' || k1::text || '|' || v_b::text THEN
    RAISE EXCEPTION 'TEST FAILED (FENCE 1): a call for a job whose status is not running must return FALSE and leave (K1, B); got %.', v_got;
  END IF;
  RAISE NOTICE 'FENCE 1 OK: the owner writes; a wrong token and a not-running job return FALSE and write nothing.';

  -- ======================================================================
  -- FENCE 2: a token with no job id is refused
  -- ======================================================================
  -- RED-UNDER: stand the p_job_id NULL guard down: `IF p_job_id IS NULL THEN` in migration
  --            20261126150000 becomes `IF FALSE THEN`. The call then returns FALSE quietly.
  -- RED-UNDER-M: {"arm":"FENCE 2","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"IF p_job_id IS NULL THEN","replace":"IF FALSE THEN","occurrences":1}]}
  v_got := pg_temp.rb_call(sid, k1, NULL, tok, v_e, v_nc);
  IF v_got IS DISTINCT FROM 'RAISED 22023' THEN
    RAISE EXCEPTION 'TEST FAILED (FENCE 2): a non-NULL claim token with a NULL job id must raise 22023; got %. Returning FALSE here would hide a caller that dropped its job id.', v_got;
  END IF;
  RAISE NOTICE 'FENCE 2 OK: a token without a job id raises 22023.';

  -- ======================================================================
  -- NULL-ID: a NULL strategy id or a NULL key id is refused
  -- ======================================================================
  -- RED-UNDER: stand the NULL-id guard down: `IF p_strategy_id IS NULL OR p_api_key_id IS NULL
  --            THEN` in migration 20261126150000 becomes `IF FALSE THEN`. The call then fails
  --            on a NOT NULL violation (23502) instead of the named 22023.
  -- RED-UNDER-M: {"arm":"NULL-ID","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"IF p_strategy_id IS NULL OR p_api_key_id IS NULL THEN","replace":"IF FALSE THEN","occurrences":1}]}
  v_got := pg_temp.rb_call(NULL, k1, NULL, NULL, v_b, NULL);
  IF v_got IS DISTINCT FROM 'RAISED 22023' THEN
    RAISE EXCEPTION 'TEST FAILED (NULL-ID): a NULL p_strategy_id must raise 22023; got %.', v_got;
  END IF;
  v_got := pg_temp.rb_call(sid, NULL, NULL, NULL, v_b, NULL);
  IF v_got IS DISTINCT FROM 'RAISED 22023' THEN
    RAISE EXCEPTION 'TEST FAILED (NULL-ID): a NULL p_api_key_id must raise 22023; got %.', v_got;
  END IF;
  RAISE NOTICE 'NULL-ID OK: a NULL strategy id or key id raises 22023.';

  -- ======================================================================
  -- THE ANTI-VACUITY STEP. Read the block at the head of this file first.
  -- ======================================================================
  -- GRANT 1 has measured and pinned the shipped ACL. From here to RESTORE 1 the
  -- authenticated role holds a full DML grant, so every refusal below is the POLICY's.
  -- Both statements sit in this one transaction, so no other session observes the grant.
  GRANT SELECT, INSERT, UPDATE, DELETE ON strategy_fills_reread_bounds TO authenticated;

  -- ======================================================================
  -- POLICY 1: the strategy's OWN OWNER, authenticated, sees ZERO rows
  -- ======================================================================
  -- RED-UNDER: open the read qualifier: `USING (false)` becomes `USING (true)` in the
  --            CREATE POLICY of migration 20261126150000. Every catalogue arm the migration
  --            has still passes; this one reads the row back.
  -- RED-UNDER-M: {"arm":"POLICY 1","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"  USING (false)\n  WITH CHECK (false);","replace":"  USING (true)\n  WITH CHECK (false);","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- POLICY 1 seed
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_owner::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  raised := FALSE;
  visible := -1;
  BEGIN
    SELECT COUNT(*) INTO visible
      FROM public.strategy_fills_reread_bounds WHERE strategy_id = sid;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  -- The vacuity check comes first on purpose: a raised SELECT means the grant layer refused
  -- and the zero-row result below would say nothing about the policy.
  IF raised THEN
    RAISE EXCEPTION 'TEST FAILED (POLICY 1): the authenticated owner SELECT RAISED % instead of returning rows. This gate restores DML to authenticated immediately above so the POLICY is the binding constraint; an error means the grant layer refused first. Fix the gate, never the expectation.', err_state;
  END IF;
  IF visible <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (POLICY 1): the strategy owner, authenticated and holding a full table grant, read % row(s) of strategy_fills_reread_bounds, expected 0. This table has no owner tier by design.', visible;
  END IF;
  RAISE NOTICE 'POLICY 1 OK: the authenticated owner reads 0 rows, and the read reached the policy rather than the grant layer.';

  -- ======================================================================
  -- POLICY 2: the owner cannot INSERT a bound row (the WITH CHECK half)
  -- ======================================================================
  -- A refusal by the GRANT layer and one by WITH CHECK (false) are the SAME SQLSTATE
  -- (42501), so the precondition below asserts by catalogue that the grant is present,
  -- before the probe, rather than trusting the SQLSTATE to tell them apart.
  -- RED-UNDER: narrow the restoring GRANT above so authenticated no longer holds INSERT.
  --            The INSERT probe would then fail at the grant layer with the SAME 42501 it
  --            expects from WITH CHECK, and the arm would pass while measuring nothing.
  -- RED-UNDER-M: {"arm":"POLICY 2 precondition","apply":[{"kind":"edit","file":"supabase/tests/test_strategy_fills_reread_bound.sql","find":"observes the grant.\n  GRANT SELECT, INSERT, UPDATE, DELETE ON strategy_fills_reread_bounds TO authenticated;","replace":"observes the grant.\n  GRANT SELECT, UPDATE, DELETE ON strategy_fills_reread_bounds TO authenticated;","occurrences":1}]}
  IF NOT has_table_privilege('authenticated', 'public.strategy_fills_reread_bounds', 'INSERT') THEN
    RAISE EXCEPTION 'TEST FAILED (POLICY 2 precondition): authenticated does not hold INSERT on strategy_fills_reread_bounds, so the probe below would be refused by the GRANT layer and its 42501 would say nothing about WITH CHECK.';
  END IF;

  -- RED-UNDER: open the write qualifier: `WITH CHECK (false)` becomes `WITH CHECK (true)` in
  --            the CREATE POLICY of migration 20261126150000. USING stays intact, so POLICY 1
  --            still passes and the two halves of the qualifier are pinned independently.
  -- RED-UNDER-M: {"arm":"POLICY 2","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"  USING (false)\n  WITH CHECK (false);","replace":"  USING (false)\n  WITH CHECK (true);","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, NULL, NULL); -- POLICY 2 seed
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_owner::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  raised := FALSE;
  BEGIN
    INSERT INTO public.strategy_fills_reread_bounds (strategy_id, api_key_id, unread_from)
    VALUES (sid, k1, v_b);
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (POLICY 2): the authenticated owner INSERTED a strategy_fills_reread_bounds row. WITH CHECK (false) is the only thing between a client and a forged bound.';
  END IF;
  IF err_state <> '42501' THEN
    RAISE EXCEPTION 'TEST FAILED (POLICY 2): the authenticated owner INSERT raised %, expected 42501 (RLS WITH CHECK violation). Another SQLSTATE means something other than the policy refused.', err_state;
  END IF;
  RAISE NOTICE 'POLICY 2 OK: the authenticated owner INSERT was refused with 42501 (WITH CHECK).';

  -- ======================================================================
  -- RESTORE 1: the shipped grant posture is put back, and re-read
  -- ======================================================================
  -- A safety arm: this file runs against shared databases. The grant above and this REVOKE
  -- are both inside this transaction, and this arm keeps that true.
  REVOKE ALL ON TABLE strategy_fills_reread_bounds FROM PUBLIC, anon, authenticated;

  -- RED-UNDER: delete the REVOKE immediately above from this gate file, the state in which
  --            this file would COMMIT a live DML grant on an internal table to authenticated
  --            on every database it is ever run against.
  -- RED-UNDER-M: {"arm":"RESTORE 1","apply":[{"kind":"edit","file":"supabase/tests/test_strategy_fills_reread_bound.sql","find":"keeps that true.\n  REVOKE ALL ON TABLE strategy_fills_reread_bounds FROM PUBLIC, anon, authenticated;\n","replace":"keeps that true.\n","occurrences":1}]}
  SELECT string_agg(DISTINCT COALESCE(r.rolname, 'PUBLIC') || ':' || acl.privilege_type,
                    ',' ORDER BY COALESCE(r.rolname, 'PUBLIC') || ':' || acl.privilege_type)
    INTO v_privs
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
    LEFT JOIN pg_roles r ON r.oid = acl.grantee
   WHERE c.oid = 'public.strategy_fills_reread_bounds'::regclass
     AND (acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated'));
  IF v_privs IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (RESTORE 1): this gate is about to COMMIT with the client roles holding "%" on strategy_fills_reread_bounds. The grant it restores for its own policy arms must be taken away again in the same transaction.', v_privs;
  END IF;
  RAISE NOTICE 'RESTORE 1 OK: the shipped grant posture is restored.';

  -- ======================================================================
  -- CASCADE 1: deleting the api key deletes its bound row
  -- ======================================================================
  -- sanitize_user erases a user's keys with a DELETE on api_keys, so the cascade is what
  -- erases the bound. A NO ACTION foreign key would refuse that DELETE and block the erasure.
  -- RED-UNDER: make the key foreign key refuse the delete: `ON DELETE CASCADE` on the
  --            api_key_id column of migration 20261126150000 becomes `ON DELETE NO ACTION`.
  -- RED-UNDER-M: {"arm":"CASCADE 1","apply":[{"kind":"edit","file":"supabase/migrations/20261126150000_strategy_fills_reread_bound.sql","find":"REFERENCES api_keys(id) ON DELETE CASCADE","replace":"REFERENCES api_keys(id) ON DELETE NO ACTION","occurrences":1}]}
  PERFORM pg_temp.rb_set(sid, k1, v_b); -- CASCADE 1 seed
  raised := FALSE;
  BEGIN
    DELETE FROM api_keys WHERE id = k1;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;
  IF raised THEN
    RAISE EXCEPTION 'TEST FAILED (CASCADE 1): deleting the api key raised %, so a user erasure that deletes keys is blocked by the bound row.', err_state;
  END IF;
  IF pg_temp.rb_state(sid) IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'TEST FAILED (CASCADE 1): the bound row survived the deletion of its api key (%); a bound for a deleted key is an orphan the sanitizer never erases.', pg_temp.rb_state(sid);
  END IF;
  RAISE NOTICE 'CASCADE 1 OK: deleting the api key deletes its bound row.';

  -- ----- TEARDOWN ---------------------------------------------------------
  DELETE FROM auth.users WHERE id = uid_owner;
  DELETE FROM api_keys WHERE id IN (k1, k2);

  RAISE NOTICE 'All strategy_fills_reread_bounds assertions passed.';
END
$$;

-- Defensive post-clean (belt and braces; an abort rolls the whole DO block back).
DELETE FROM auth.users WHERE email = 'test-253-reread-bound@quantalyze.test';
