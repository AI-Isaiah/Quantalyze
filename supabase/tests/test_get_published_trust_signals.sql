-- Recurring CI regression gate for the Phase 126 / FACTSHEET-01 public
-- trust-signal primitive: 20260719140000_get_published_trust_signals.sql (mig 135).
--
-- Why this file exists
-- --------------------
-- The security boundary of the whole 126 badge-visibility fix is the
-- `get_published_trust_signals(uuid[])` SECURITY DEFINER function: its
-- published-gate (`WHERE s.status='published'`) and its column allow-list
-- (`RETURNS TABLE (strategy_id, trust_tier, status)`) are what let anon read the
-- PUBLIC trust signal without widening strategy_verifications RLS (that table
-- stays owner-locked). The migration proves this ONCE, at apply time, in a
-- self-verify DO block — but a migration DO block runs ONCE and never again. Per
-- reference_db_test_ci_wiring ("RLS/SQL gates MUST be supabase/tests/test_*.sql;
-- migration DO blocks run once"), a future `CREATE OR REPLACE` that drops the
-- published predicate or widens the RETURNS TABLE would be caught by NO recurring
-- gate. This file is that gate.
--
-- What this asserts, and why by CONTENT not by error
-- --------------------------------------------------
-- Every assertion is a count scoped to a SPECIFIC fixture id (never a global
-- count — the shared test DB carries other strategies), executed AS THE anon ROLE
-- (the real public path), so no assertion can pass vacuously and a loosened gate
-- ships RED:
--   1. published strategy's signal IS returned to anon (count 1) — positive
--      control + harness proof (the SECDEF is callable by anon and returns data);
--      without this, (2) could pass simply because the function returns nothing.
--   2. ⭐ UNPUBLISHED (private) strategy's signal is NOT returned (count 0) — THE
--      published-gate. Reddens the instant `WHERE s.status='published'` is dropped
--      or weakened. This is the leak the migration exists to prevent.
--   3. the returned trust_tier is the ACTUAL seeded value ('api_verified'), not a
--      null/blank — proves the join + projection carry the real signal.
--   4. COLUMN ALLOW-LIST: pg_get_function_result is exactly
--      `TABLE(strategy_id uuid, trust_tier text, status text)` — reddens if a
--      future edit widens RETURNS TABLE to leak a verification internal
--      (wizard_session_id / flow_type / source / metrics_snapshot / …).
--   5. anon holds EXECUTE (the public signal stays readable — the anon-EXECUTE
--      revoke footgun, reference_secdef_public_policy_needs_anon_execute).
--
-- The seed is ALSO the RED-guard on the migration: the SELECT ... FROM
-- get_published_trust_signals(...) throws undefined_function (42883) if mig 135 is
-- not applied — this test cannot pass on a DB missing the primitive.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with RAISE
-- EXCEPTION on failure / RAISE NOTICE on pass, mirroring the sibling
-- supabase/tests/test_*.sql files. No psql backslash meta-commands. Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. Filename matches the
-- `test_*.sql` glob so the job auto-discovers it against the test project.
--
-- Hygiene: all fixture work runs inside an explicit transaction that ends in
-- ROLLBACK, so the shared test DB is never polluted (no committed fixture rows).
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_get_published_trust_signals.sql
--
-- ⭐ RED-UNDER ANNOTATIONS (Phase 164.4). Each assertion below carries a prose
-- `RED-UNDER:` naming the smallest production change that makes it fail, and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE it reds on its own arm, then restores
-- GREEN. Schema: scripts/mutation-runner/GRAMMAR.md. The line below declares
-- what the lane applies before this gate.
-- ⚠️ THE OBJECT UNDER TEST IS THE REAL SECDEF. Every twin mutates mig 135's own
-- body — the published-gate predicate, the projection or the RETURNS TABLE
-- allow-list. 18-fixture-trust-signals.sql adds only
-- `strategy_verifications.created_at`, the recency axis of the function's
-- DISTINCT ON; the gate seeds one verification per strategy, so no arm here can
-- be decided by it.
-- ⚠️ ASSERTION 5 IS ORDERED FIRST, ahead of assertions 1-3, and the reason is
-- structural: it proves the anon EXECUTE grant that 1-3 depend on to call the
-- function at all. Behind them it was unmutatable — revoking the grant killed
-- assertion 1 with a raw 42501 that named no arm (measured 2026-09-04). Ahead
-- of them the same revoke reports as `TEST FAILED (5)`. The `(5)` label is
-- deliberately NOT renumbered; source order and identity are separate things
-- here, and the identities are the runner's addressing scheme.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/13-fixture-csv-finalize-fold.sql","scripts/pg-lane/fixtures/18-fixture-trust-signals.sql","supabase/migrations/20260719140000_get_published_trust_signals.sql"]}

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- ON DELETE CASCADE chains auth.users -> profiles -> strategies -> verifications.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email = 'test-mig135-trust-signals@quantalyze.test';

BEGIN;

DO $$
DECLARE
  uid            UUID := gen_random_uuid();
  strat_pub      UUID;  -- status='published'  (signal MUST be visible to anon)
  strat_priv     UUID;  -- status='private'    (signal MUST be gated out)
  signal_count   INTEGER;
  tier_val       TEXT;
  result_sig     TEXT;
  anon_can_exec  BOOLEAN;
BEGIN
  -- ----- SEED (service-role context — bypasses RLS) ------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'test-mig135-trust-signals@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'mig135 trust-signals owner', 'test-mig135-trust-signals@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO strategies (user_id, name, status, source, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid, 'mig135 published', 'published', 'csv', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_pub;

  INSERT INTO strategies (user_id, name, status, source, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid, 'mig135 private', 'private', 'csv', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_priv;

  -- Both strategies get an identical api_verified verification. The ONLY
  -- difference between them is strategies.status — so any difference in the
  -- function's output is attributable to the published-gate, nothing else.
  INSERT INTO strategy_verifications (strategy_id, wizard_session_id, status, trust_tier, flow_type, source)
  VALUES
    (strat_pub,  gen_random_uuid(), 'validated', 'api_verified', 'csv', 'csv'),
    (strat_priv, gen_random_uuid(), 'validated', 'api_verified', 'csv', 'csv');

  RAISE NOTICE 'Seed OK: uid=% published=% private=%', uid, strat_pub, strat_priv;

  -- (5) anon holds EXECUTE (the public signal stays readable)
  -- ⭐ THIS CHECK RUNS FIRST BECAUSE ASSERTIONS 1-3 DEPEND ON IT. It is a
  --    PRECONDITION, not a postscript: 1-3 call the function AS anon, so if
  --    anon has lost EXECUTE they die at assertion 1 with a raw
  --    `ERROR: 42501: permission denied for function …` that names no arm at
  --    all. Ordering the precondition ahead of its dependents is what makes
  --    the grant's loss report itself as `TEST FAILED (5)` — the identity of
  --    the thing that actually broke. The `(5)` label and the message text are
  --    UNCHANGED: arm identities are the mutation runner's addressing scheme
  --    and must stay stable across the sibling gate files.
  --    `has_function_privilege` takes the role as an argument, so this is
  --    correct without `SET ROLE` and needs no anon context of its own.
  -- RED-UNDER: revoke the public path's grant — `REVOKE EXECUTE ON FUNCTION
  --            public.get_published_trust_signals(uuid[]) FROM anon`. That is
  --            the anon-EXECUTE revoke footgun of
  --            reference_secdef_public_policy_needs_anon_execute: a SECDEF
  --            reachable only through a `{public}` policy silently returns
  --            zero rows to SSR (clean console, dark badge) the moment anon
  --            loses EXECUTE. A `sql` step, never a migration edit — mig 135's
  --            STEP 2 pins the grantee list exactly, so editing it there would
  --            change what the gate is asserting rather than break it.
  -- RED-UNDER-M: {"arm":"5","apply":[{"kind":"sql","stmt":"REVOKE EXECUTE ON FUNCTION public.get_published_trust_signals(uuid[]) FROM anon"}]}
  SELECT has_function_privilege('anon',
           'public.get_published_trust_signals(uuid[])', 'EXECUTE')
    INTO anon_can_exec;
  IF NOT anon_can_exec THEN
    RAISE EXCEPTION 'TEST FAILED (5): anon lacks EXECUTE on get_published_trust_signals — the public trust signal is unreadable (badge would vanish for anon)';
  END IF;

  -- ----- Assertions run AS anon (the real public path) ---------------------
  -- SECURITY DEFINER means the function body runs as its owner regardless, but
  -- calling AS anon proves the GRANT lets the public path in AND that the gate
  -- (not RLS on strategy_verifications, which anon cannot read) is what filters.
  SET LOCAL ROLE anon;

  -- (1) published strategy's signal IS returned (positive control + harness proof)
  -- RED-UNDER: point the published-gate at a status no row ever carries —
  --            `s.status = 'published'` becomes `'published_never'` in mig 135's
  --            body. The function then returns nothing at all and this positive
  --            control, which is what makes assertion 2's zero MEAN something,
  --            goes dark.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20260719140000_get_published_trust_signals.sql","find":"   WHERE s.status = 'published'\n     AND sv.strategy_id = ANY(p_strategy_ids)","replace":"   WHERE s.status = 'published_never'\n     AND sv.strategy_id = ANY(p_strategy_ids)","occurrences":1}]}
  SELECT count(*) INTO signal_count
    FROM get_published_trust_signals(ARRAY[strat_pub]);
  IF signal_count <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (1): anon got % signal rows for the PUBLISHED strategy, expected 1 — public signal unreadable or function broken', signal_count;
  END IF;

  -- (2) ⭐ published-gate: UNPUBLISHED strategy's signal is NOT returned
  -- RED-UNDER: delete the published-gate — drop `WHERE s.status = 'published'`
  --            from mig 135's body, leaving only the id filter. THE LEAK ITSELF:
  --            assertion 1 still passes (the published signal is still
  --            returned), so this arm is the only thing between a
  --            `CREATE OR REPLACE` and every unpublished trust signal going
  --            public.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20260719140000_get_published_trust_signals.sql","find":"   WHERE s.status = 'published'\n     AND sv.strategy_id = ANY(p_strategy_ids)","replace":"   WHERE sv.strategy_id = ANY(p_strategy_ids)","occurrences":1}]}
  SELECT count(*) INTO signal_count
    FROM get_published_trust_signals(ARRAY[strat_priv]);
  IF signal_count <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): PUBLISHED-GATE BREACH — anon got % signal rows for the PRIVATE (unpublished) strategy, expected 0. A non-published trust signal leaked.', signal_count;
  END IF;

  -- (3) the returned trust_tier is the actual seeded value, not null/blank
  -- RED-UNDER: blank the projection — `sv.trust_tier,` becomes `NULL::text,`
  --            in mig 135's SELECT list. Row counts are unchanged, so
  --            assertions 1 and 2 both still pass; only this arm notices that
  --            the signal carries no signal.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20260719140000_get_published_trust_signals.sql","find":"         sv.trust_tier,","replace":"         NULL::text,","occurrences":1}]}
  SELECT trust_tier INTO tier_val
    FROM get_published_trust_signals(ARRAY[strat_pub]);
  IF tier_val IS DISTINCT FROM 'api_verified' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (3): published signal trust_tier=% , expected api_verified — projection dropped the real value', tier_val;
  END IF;

  RESET ROLE;

  -- ----- Structural gates (as the test/service role) -----------------------
  -- (4) column allow-list: the result signature must stay exactly the 3-column
  -- shape. A widened RETURNS TABLE (leaking a verification internal) reddens here.
  -- RED-UNDER: widen the allow-list — add `flow_type text` to mig 135's RETURNS
  --            TABLE and `sv.flow_type` to its SELECT list. That is the shape of
  --            an internal leak: RETURNS TABLE is the only thing making
  --            verification internals structurally unreachable.
  --            LAYERED because a RETURNS TABLE and its body must agree — the
  --            second step is what makes the first one applicable, not a way
  --            around a self-verify.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20260719140000_get_published_trust_signals.sql","find":"RETURNS TABLE (strategy_id uuid, trust_tier text, status text)","replace":"RETURNS TABLE (strategy_id uuid, trust_tier text, status text, flow_type text)","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260719140000_get_published_trust_signals.sql","find":"         sv.status\n    FROM public.strategy_verifications sv","replace":"         sv.status,\n         sv.flow_type\n    FROM public.strategy_verifications sv","occurrences":1}]}
  SELECT pg_get_function_result(p.oid) INTO result_sig
    FROM pg_proc p
    WHERE p.proname = 'get_published_trust_signals'
      AND p.pronamespace = 'public'::regnamespace;
  IF result_sig IS DISTINCT FROM 'TABLE(strategy_id uuid, trust_tier text, status text)' THEN
    RAISE EXCEPTION 'TEST FAILED (4): get_published_trust_signals result signature is "%", expected "TABLE(strategy_id uuid, trust_tier text, status text)" — column allow-list widened (possible internal leak)', result_sig;
  END IF;

  RAISE NOTICE 'test_get_published_trust_signals: ALL PASS (published-gate holds, column allow-list intact, anon-readable).';
END
$$;

ROLLBACK;
