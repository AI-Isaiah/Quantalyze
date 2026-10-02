-- Test for Migration 044 (20260416081039_funding_fees.sql) — funding_fees RLS.
--
-- Closes G14-002 (audit-2026-05-20 fix-list.md): the migration's
-- self-verifying DO block only checks that the four RLS policies
-- (`funding_fees_read`, `_insert_deny`, `_update_deny`, `_delete_deny`)
-- EXIST by name. It does not assert their BEHAVIOR. A future RLS edit
-- that loosens the predicate (or drops a deny policy) would ship silently
-- because no integration test connects as user A and confirms they
-- cannot SELECT user B's funding_fees rows, or that authenticated
-- INSERT / UPDATE / DELETE all fail.
--
-- pgTAP is NOT installed in this project (see CLAUDE.md / Lane B audit),
-- so this file uses the same plain PL/pgSQL convention as the other
-- supabase/tests/test_*.sql files: `DO $$ ... $$` blocks with
-- `RAISE EXCEPTION` on failure and `RAISE NOTICE` on assertion pass.
-- Under `psql -v ON_ERROR_STOP=1` (which is what .github/workflows/ci.yml
-- `sql-tests` runs) a failed assertion exits non-zero and fails the job.
--
-- Filename: matches ci.yml's `test_*.sql` glob (lines 361, 411) so the
-- sql-tests job auto-discovers and runs it against the test project.
--
-- Usage (against a live Supabase project with Migration 044 applied):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_funding_fees_rls.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, REDUNDER-BACKFILL). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ 07-fixture-supabase-default-privileges.sql is in the list and is NOT
-- cosmetic here. It is applied BEFORE the migration creates `funding_fees`, so
-- the table arrives carrying production's bootstrap GRANT ALL for anon,
-- authenticated and service_role. Without it `authenticated` would hold no
-- INSERT/UPDATE/DELETE privilege at all and Assertions 3, 4 and 5 would be
-- refused by the GRANT layer with the same 42501 they read as proof that the
-- deny POLICY fired — three vacuous passes, which is the exact defect plan
-- 164.4-06 measured on test_strategies_private_owner_isolation.sql.
-- ⚠️ Nothing this file names is stood in for: `funding_fees`, its four
-- policies and `strategies.user_id` all come from the REAL migration, which is
-- also the LAST definition of every one of them, so every twin targets it.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/14-fixture-funding-fees.sql","supabase/migrations/20260416081039_funding_fees.sql"]}
--
-- The test seeds two synthetic tenants (A and B) end-to-end:
--   auth.users -> profiles -> api_keys -> strategies -> funding_fees,
-- then forges request.jwt.claims so auth.uid() resolves to each tenant
-- in turn, switches role to `authenticated`, and exercises every CRUD
-- verb against the funding_fees policy stack. All seed rows are torn
-- down at the end of the DO block (and again in a defensive cleanup
-- block in case an earlier assertion aborts).

-- --------------------------------------------------------------------------
-- Defensive pre-clean. If a prior run aborted between seed and teardown
-- the synthetic profile rows may still be hanging around. CASCADE on
-- auth.users -> profiles -> api_keys -> strategies -> funding_fees means
-- deleting the auth.users row by email also drops everything below.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-g14-002-tenant-a@quantalyze.test',
    'test-g14-002-tenant-b@quantalyze.test'
  );

DO $$
DECLARE
  -- Tenant A
  uid_a       UUID := gen_random_uuid();
  kid_a       UUID;
  sid_a       UUID;
  ff_a_id     UUID;
  -- Tenant B
  uid_b       UUID := gen_random_uuid();
  kid_b       UUID;
  sid_b       UUID;
  ff_b_id     UUID;
  -- Assertion scratch
  visible_cnt INTEGER;
  raised      BOOLEAN;
  err_state   TEXT;
  err_msg     TEXT;
  ts_anchor   TIMESTAMPTZ := now();
BEGIN
  -- ----- SEED (service role / superuser context — bypasses RLS) ----------

  -- Tenant A: auth.users row, profile, api_key, strategy, one funding_fees row.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-g14-002-tenant-a@quantalyze.test', now(), now());

  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'g14-002 tenant a', 'test-g14-002-tenant-a@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO api_keys (
    user_id, exchange, label, api_key_encrypted, is_active
  ) VALUES (
    uid_a, 'binance', 'g14-002-a', 'encrypted-blob-a', TRUE
  ) RETURNING id INTO kid_a;

  INSERT INTO strategies (
    user_id, api_key_id, name, status, supported_exchanges
  ) VALUES (
    uid_a, kid_a, 'g14-002 tenant a strategy', 'draft', ARRAY['binance']
  ) RETURNING id INTO sid_a;

  INSERT INTO funding_fees (
    strategy_id, exchange, symbol, amount, currency, timestamp, match_key
  ) VALUES (
    sid_a, 'binance', 'BTCUSDT', -1.23, 'USDT', ts_anchor,
    sid_a::text || ':binance:BTCUSDT:' || ts_anchor::text || ':a'
  ) RETURNING id INTO ff_a_id;

  -- Tenant B: same shape, separate tenant.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-g14-002-tenant-b@quantalyze.test', now(), now());

  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_b, 'g14-002 tenant b', 'test-g14-002-tenant-b@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO api_keys (
    user_id, exchange, label, api_key_encrypted, is_active
  ) VALUES (
    uid_b, 'binance', 'g14-002-b', 'encrypted-blob-b', TRUE
  ) RETURNING id INTO kid_b;

  INSERT INTO strategies (
    user_id, api_key_id, name, status, supported_exchanges
  ) VALUES (
    uid_b, kid_b, 'g14-002 tenant b strategy', 'draft', ARRAY['binance']
  ) RETURNING id INTO sid_b;

  INSERT INTO funding_fees (
    strategy_id, exchange, symbol, amount, currency, timestamp, match_key
  ) VALUES (
    sid_b, 'binance', 'BTCUSDT', 4.56, 'USDT', ts_anchor,
    sid_b::text || ':binance:BTCUSDT:' || ts_anchor::text || ':b'
  ) RETURNING id INTO ff_b_id;

  RAISE NOTICE 'Seed OK: tenant A=% strat=% ff=%, tenant B=% strat=% ff=%',
    uid_a, sid_a, ff_a_id, uid_b, sid_b, ff_b_id;

  -- RED-UNDER: attach a BEFORE INSERT trigger to funding_fees on the live
  --            database that returns NULL for a POSITIVE amount, silently
  --            dropping tenant B's +4.56 seed row. This arm is a plain
  --            superuser count with no handler around the seed above it, so
  --            a drift that RAISES would abort the file outside every arm and
  --            score NO-IDENTITY (the wave-6 lesson); the SILENT form is the
  --            only one it can observe. Scoped to the sign so the tenant A
  --            row still lands and this arm is the FIRST failure.
  -- RED-UNDER-M: {"arm":"sanity","apply":[{"kind":"sql","stmt":"CREATE FUNCTION public._drift_ff_drop_positive() RETURNS TRIGGER LANGUAGE plpgsql AS $q$ BEGIN IF NEW.amount > 0 THEN RETURN NULL; END IF; RETURN NEW; END $q$; CREATE TRIGGER _drift_ff_drop_positive BEFORE INSERT ON public.funding_fees FOR EACH ROW EXECUTE FUNCTION public._drift_ff_drop_positive()"}]}
  -- ----- ASSERTION 1: service role / superuser sees BOTH rows -----------
  -- Sanity check that we actually seeded what we think we seeded (and
  -- that the RLS scaffold is admin-bypass-compatible — `postgres` /
  -- service-role keys bypass RLS, the only thing standing between the
  -- worker and the rows is the deny INSERT WITH CHECK predicate, which
  -- service role evaluates differently).
  SELECT COUNT(*) INTO visible_cnt FROM funding_fees
    WHERE id IN (ff_a_id, ff_b_id);
  IF visible_cnt <> 2 THEN
    RAISE EXCEPTION
      'TEST FAILED (sanity): service-role SELECT returned % rows, expected 2', visible_cnt;
  END IF;
  RAISE NOTICE 'Assertion 1 OK: service-role sees both seeded funding_fees rows.';

  -- RED-UNDER: replace funding_fees_read's whole USING predicate with `true`
  --            in migration 20260416081039. The policy still EXISTS by name —
  --            which is all the migration's own self-verify checks, and
  --            precisely the gap G14-002 opened this file to close — so it
  --            applies clean and every tenant reads every tenant's funding rows.
  --            ⚠️ MEASURED, and it is why the surgical form does NOT work here:
  --            dropping only the `AND s.user_id = auth.uid()` conjunct scores
  --            NO-RED, because the policy's sub-select on `strategies` is itself
  --            subject to `strategies`' OWN RLS, which already hides tenant B's
  --            DRAFT strategy from tenant A. The conjunct is the binding
  --            constraint only for a PUBLISHED strategy, and this gate seeds
  --            none — booked as a coverage gap in the phase's deferred-items.md.
  -- RED-UNDER-M: {"arm":"Assertion 2","apply":[{"kind":"edit","file":"supabase/migrations/20260416081039_funding_fees.sql","find":"CREATE POLICY funding_fees_read ON funding_fees FOR SELECT USING (\n  EXISTS (\n    SELECT 1 FROM strategies s\n    WHERE s.id = funding_fees.strategy_id\n      AND s.user_id = auth.uid()\n  )\n);","replace":"CREATE POLICY funding_fees_read ON funding_fees FOR SELECT USING (\n  true\n);","occurrences":1}]}
  -- ----- ASSERTION 2: tenant A SELECT returns own row only --------------
  -- Forge the JWT sub claim so auth.uid() resolves to uid_a for this
  -- transaction (same technique as test_guard_wizard_draft_updates).
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;

  -- Tenant A should see exactly 1 row (their own), not 2.
  SELECT COUNT(*) INTO visible_cnt FROM funding_fees
    WHERE id IN (ff_a_id, ff_b_id);

  IF visible_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (Assertion 2): tenant A SELECT returned % rows over seeded set, expected 1 (cross-tenant leak)', visible_cnt;
  END IF;

  -- And specifically: it must be A's row, not B's.
  IF NOT EXISTS (SELECT 1 FROM funding_fees WHERE id = ff_a_id) THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (Assertion 2): tenant A cannot see own funding_fees row — read policy regressed';
  END IF;
  IF EXISTS (SELECT 1 FROM funding_fees WHERE id = ff_b_id) THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (Assertion 2): tenant A can see tenant B funding_fees row — CROSS-TENANT LEAK';
  END IF;

  RAISE NOTICE 'Assertion 2 OK: tenant A sees own row, cannot see tenant B row.';

  -- RED-UNDER: flip funding_fees_insert_deny's WITH CHECK from false to true
  --            in migration 20260416081039. The INSERT then succeeds and a
  --            manager can forge their own funding history — the write path
  --            the worker is supposed to own exclusively.
  -- RED-UNDER-M: {"arm":"Assertion 3","apply":[{"kind":"edit","file":"supabase/migrations/20260416081039_funding_fees.sql","find":"CREATE POLICY funding_fees_insert_deny ON funding_fees FOR INSERT\n  WITH CHECK (false);","replace":"CREATE POLICY funding_fees_insert_deny ON funding_fees FOR INSERT\n  WITH CHECK (true);","occurrences":1}]}
  -- ----- ASSERTION 3: authenticated INSERT is rejected ------------------
  -- The funding_fees_insert_deny policy has WITH CHECK (false) — any
  -- INSERT from the authenticated role must raise ERRCODE 42501.
  raised := FALSE;
  BEGIN
    INSERT INTO funding_fees (
      strategy_id, exchange, symbol, amount, currency, timestamp, match_key
    ) VALUES (
      sid_a, 'binance', 'ETHUSDT', 99.99, 'USDT', ts_anchor,
      sid_a::text || ':binance:ETHUSDT:' || ts_anchor::text || ':forged'
    );
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
    err_msg := SQLERRM;
  END;

  IF NOT raised THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (Assertion 3): authenticated INSERT into funding_fees succeeded — deny policy regressed';
  END IF;
  IF err_state <> '42501' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (Assertion 3): authenticated INSERT raised %, expected 42501 (insufficient_privilege). msg=%', err_state, err_msg;
  END IF;
  RAISE NOTICE 'Assertion 3 OK: authenticated INSERT rejected with ERRCODE 42501.';

  -- RED-UNDER: flip funding_fees_update_deny's USING from false to true in
  --            migration 20260416081039. Tenant A's UPDATE of its OWN row
  --            then lands and amount becomes 0, which is the `silently
  --            mutated` branch — the one that distinguishes a real deny from
  --            a row RLS merely filtered out of view.
  -- RED-UNDER-M: {"arm":"Assertion 4","apply":[{"kind":"edit","file":"supabase/migrations/20260416081039_funding_fees.sql","find":"CREATE POLICY funding_fees_update_deny ON funding_fees FOR UPDATE\n  USING (false);","replace":"CREATE POLICY funding_fees_update_deny ON funding_fees FOR UPDATE\n  USING (true);","occurrences":1}]}
  -- ----- ASSERTION 4: authenticated UPDATE is rejected ------------------
  -- The funding_fees_update_deny policy has USING (false). Under RLS
  -- semantics, a deny-USING UPDATE on a row the role can SELECT
  -- raises ERRCODE 42501. A deny-USING UPDATE on a row the role
  -- cannot SELECT silently returns 0 rows (no error) — so we target
  -- tenant A's OWN row from tenant A's session, which the read policy
  -- DOES admit, forcing the UPDATE deny to be the binding constraint.
  raised := FALSE;
  BEGIN
    UPDATE funding_fees SET amount = 0 WHERE id = ff_a_id;
    -- If we reach here without an error, RLS silently swallowed the
    -- write — check by reading back and asserting the amount didn't
    -- change. Either an exception OR an unchanged row is acceptable;
    -- a CHANGED row is the regression.
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;

  -- Drop back to service role to verify ground truth.
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF NOT raised THEN
    -- No exception was raised. RLS may have silently filtered the
    -- UPDATE to zero rows — verify the amount is still the seeded
    -- value (-1.23) and not 0.
    DECLARE
      current_amount NUMERIC;
    BEGIN
      SELECT amount INTO current_amount FROM funding_fees WHERE id = ff_a_id;
      IF current_amount = 0 THEN
        RAISE EXCEPTION
          'TEST FAILED (Assertion 4): authenticated UPDATE silently mutated funding_fees.amount to 0 — deny policy regressed';
      END IF;
      IF current_amount <> -1.23 THEN
        RAISE EXCEPTION
          'TEST FAILED (Assertion 4): funding_fees.amount=% (expected -1.23 unchanged) — unexpected mutation', current_amount;
      END IF;
      RAISE NOTICE 'Assertion 4 OK: authenticated UPDATE filtered to 0 rows; amount unchanged at -1.23.';
    END;
  ELSE
    IF err_state <> '42501' THEN
      RAISE EXCEPTION
        'TEST FAILED (Assertion 4): authenticated UPDATE raised %, expected 42501 or zero-row silent reject', err_state;
    END IF;
    RAISE NOTICE 'Assertion 4 OK: authenticated UPDATE rejected with ERRCODE 42501.';
  END IF;

  -- RED-UNDER: flip funding_fees_delete_deny's USING from false to true in
  --            migration 20260416081039. Tenant A's own funding row is then
  --            deletable from a browser session, i.e. a manager can erase the
  --            costs that make their published returns look worse.
  -- RED-UNDER-M: {"arm":"Assertion 5","apply":[{"kind":"edit","file":"supabase/migrations/20260416081039_funding_fees.sql","find":"CREATE POLICY funding_fees_delete_deny ON funding_fees FOR DELETE\n  USING (false);","replace":"CREATE POLICY funding_fees_delete_deny ON funding_fees FOR DELETE\n  USING (true);","occurrences":1}]}
  -- ----- ASSERTION 5: authenticated DELETE is rejected ------------------
  -- Re-impersonate tenant A and try to delete their own row. Like
  -- UPDATE above, USING (false) means the row either errors out or
  -- silently filters to zero — check both shapes.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;

  raised := FALSE;
  BEGIN
    DELETE FROM funding_fees WHERE id = ff_a_id;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF NOT raised THEN
    -- Verify the row still exists.
    IF NOT EXISTS (SELECT 1 FROM funding_fees WHERE id = ff_a_id) THEN
      RAISE EXCEPTION
        'TEST FAILED (Assertion 5): authenticated DELETE removed funding_fees row — deny policy regressed';
    END IF;
    RAISE NOTICE 'Assertion 5 OK: authenticated DELETE filtered to 0 rows; row still present.';
  ELSE
    IF err_state <> '42501' THEN
      RAISE EXCEPTION
        'TEST FAILED (Assertion 5): authenticated DELETE raised %, expected 42501 or zero-row silent reject', err_state;
    END IF;
    RAISE NOTICE 'Assertion 5 OK: authenticated DELETE rejected with ERRCODE 42501.';
  END IF;

  -- RED-UNDER: attach a BEFORE INSERT trigger to funding_fees on the live
  --            database that returns NULL for the SOLUSDT sentinel, so the
  --            worker's write is silently discarded and RETURNING yields no
  --            id. Like Assertion 1 this is an UNWRAPPED positive control, so
  --            it needs the silent form; scoping to the sentinel symbol keeps
  --            the BTCUSDT seeds intact so Assertions 1-5 still pass and this
  --            arm is the FIRST failure.
  -- RED-UNDER-M: {"arm":"Assertion 6","apply":[{"kind":"sql","stmt":"CREATE FUNCTION public._drift_ff_drop_sentinel() RETURNS TRIGGER LANGUAGE plpgsql AS $q$ BEGIN IF NEW.symbol = 'SOLUSDT' THEN RETURN NULL; END IF; RETURN NEW; END $q$; CREATE TRIGGER _drift_ff_drop_sentinel BEFORE INSERT ON public.funding_fees FOR EACH ROW EXECUTE FUNCTION public._drift_ff_drop_sentinel()"}]}
  -- ----- ASSERTION 6: service role can read/write all -------------------
  -- The migration header (funding_fees.sql:134-136) explicitly relies on
  -- service-role bypass for the worker UPSERT path. Pin this: a fresh
  -- INSERT from superuser context (no role switch) must succeed, and
  -- both tenants' rows must be visible.
  DECLARE
    sentinel_match_key TEXT :=
      sid_a::text || ':binance:SOLUSDT:' || ts_anchor::text || ':sentinel';
    sentinel_id UUID;
  BEGIN
    INSERT INTO funding_fees (
      strategy_id, exchange, symbol, amount, currency, timestamp, match_key
    ) VALUES (
      sid_a, 'binance', 'SOLUSDT', 7.77, 'USDT', ts_anchor, sentinel_match_key
    ) RETURNING id INTO sentinel_id;

    IF sentinel_id IS NULL THEN
      RAISE EXCEPTION
        'TEST FAILED (Assertion 6): service-role INSERT returned NULL id — bypass regressed';
    END IF;

    UPDATE funding_fees SET amount = 8.88 WHERE id = sentinel_id;
    IF NOT EXISTS (
      SELECT 1 FROM funding_fees WHERE id = sentinel_id AND amount = 8.88
    ) THEN
      RAISE EXCEPTION
        'TEST FAILED (Assertion 6): service-role UPDATE did not persist';
    END IF;

    DELETE FROM funding_fees WHERE id = sentinel_id;
    IF EXISTS (SELECT 1 FROM funding_fees WHERE id = sentinel_id) THEN
      RAISE EXCEPTION
        'TEST FAILED (Assertion 6): service-role DELETE did not remove row';
    END IF;
  END;

  SELECT COUNT(*) INTO visible_cnt FROM funding_fees
    WHERE id IN (ff_a_id, ff_b_id);
  IF visible_cnt <> 2 THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 6): service-role sees % seeded rows, expected 2', visible_cnt;
  END IF;
  RAISE NOTICE 'Assertion 6 OK: service-role INSERT/UPDATE/DELETE all succeed; both tenant rows still visible.';

  -- RED-UNDER: re-route funding_fees_read's join through the api_key owner
  --            instead of the strategy owner in migration 20260416081039 —
  --            the denormalising refactor this arm's own comment names. Every
  --            earlier arm still passes because tenant A owns both its key and
  --            its strategy; only the REASSIGNMENT tells the two predicates
  --            apart, and after it tenant B — who now owns the strategy but not
  --            the key it was opened with — sees ONE seeded row instead of two.
  -- RED-UNDER-M: {"arm":"Assertion 7","apply":[{"kind":"edit","file":"supabase/migrations/20260416081039_funding_fees.sql","find":"    SELECT 1 FROM strategies s\n    WHERE s.id = funding_fees.strategy_id\n      AND s.user_id = auth.uid()","replace":"    SELECT 1 FROM strategies s\n    JOIN api_keys k ON k.id = s.api_key_id\n    WHERE s.id = funding_fees.strategy_id\n      AND k.user_id = auth.uid()","occurrences":1}]}
  -- ----- ASSERTION 7: strategy reassignment retargets RLS visibility ----
  -- The funding_fees_read policy joins through strategies.user_id =
  -- auth.uid(). If a strategy is reassigned from tenant A to tenant B
  -- (e.g. admin tooling), the historic funding_fees rows for that
  -- strategy must follow — tenant A should no longer see them, tenant
  -- B should. This pins the JOIN-through-strategies behavior so a
  -- future refactor (e.g. denormalizing strategy.user_id into
  -- funding_fees.user_id) cannot silently drift the predicate.
  UPDATE strategies SET user_id = uid_b WHERE id = sid_a;

  -- Tenant A's session: A's old strategy now belongs to B, so A should
  -- see ZERO rows out of the seeded set.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO visible_cnt FROM funding_fees
    WHERE id IN (ff_a_id, ff_b_id);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF visible_cnt <> 0 THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 7): after reassign, tenant A sees % seeded rows, expected 0 — join did not retarget', visible_cnt;
  END IF;

  -- Tenant B's session: B now owns BOTH strategies (their original sid_b
  -- and the reassigned sid_a), so B should see BOTH funding_fees rows.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', uid_b::text, 'role', 'authenticated')::text,
    true
  );
  SET LOCAL ROLE authenticated;
  SELECT COUNT(*) INTO visible_cnt FROM funding_fees
    WHERE id IN (ff_a_id, ff_b_id);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF visible_cnt <> 2 THEN
    RAISE EXCEPTION
      'TEST FAILED (Assertion 7): after reassign, tenant B sees % seeded rows, expected 2 — join did not retarget', visible_cnt;
  END IF;

  RAISE NOTICE 'Assertion 7 OK: strategy reassignment retargets funding_fees visibility (join through strategies.user_id is live).';

  -- ----- TEARDOWN -------------------------------------------------------
  -- ON DELETE CASCADE chains: auth.users -> profiles -> api_keys ->
  -- strategies -> funding_fees. One delete per tenant cleans the
  -- whole subtree.
  DELETE FROM auth.users WHERE id IN (uid_a, uid_b);

  RAISE NOTICE 'All G14-002 funding_fees RLS assertions passed (Migration 044 policy stack intact).';
END
$$;

-- --------------------------------------------------------------------------
-- Defensive post-clean. If an assertion above aborted with RAISE EXCEPTION
-- the seed rows would survive (the DO block runs in its own implicit
-- transaction, but psql ROLLBACK on error drops the DELETE too). Run
-- one more cleanup outside the DO block so subsequent runs start clean.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email IN (
    'test-g14-002-tenant-a@quantalyze.test',
    'test-g14-002-tenant-b@quantalyze.test'
  );
