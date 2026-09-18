-- Test: public.prod_prober_cadence_check() — Phase 164.1.1 (PROBERCADENCE)
-- plan 01, criteria 2 and 3. A STALE prod_prober contact reaches an OBSERVED
-- outbound alarm; a FRESH one produces none.
--
-- ⛔ WHICH FILE THE ARMS ACTUALLY MEASURE: both arms below measure
-- supabase/migrations/20260918120000_prod_prober_cadence.sql. Every edit-kind
-- RED-UNDER-M twin in this file names that migration — a `CREATE OR REPLACE`
-- anywhere else would mutate a body already overwritten before the first
-- assertion runs, and the arm would report `no-red`: an arm that cannot fail,
-- inside the machine built to find arms that cannot fail.
--
-- THE MATCHED-PAIR ARGUMENT, in this gate's own terms. An implementation that
-- posts on EVERY tick — `RETURN net.http_post(...)` with no staleness check at
-- all — passes ARM S1 alone (a stale contact does get a post) but not ARM G1,
-- which asserts ZERO posts on a fresh contact. An implementation that never
-- posts at all — `RETURN NULL` unconditionally — passes ARM G1 alone but not
-- ARM S1. Only the PAIR pins the bound this function exists to hold.
--
-- WHAT MAKES THIS GATE WORTH HAVING (criterion 3, the anti-vacuity criterion
-- this phase names explicitly). A staleness gate never observed RED has not
-- been met. Both arms below are proven RED by their own RED-UNDER-M twin,
-- executed by `node scripts/mutation-runner/run.mjs` on a disposable pg-lane —
-- not merely asserted in prose. ARM S1 additionally OBSERVES the post rather
-- than inferring it from a SQLSTATE: fixture 34 RECORDS every call `net.http_post`
-- received, so this gate can assert the actual url, path and header the
-- function built — including that `X-Service-Key` is non-NULL and non-blank,
-- which is the exact CRON-DRIFT-01 shape (seven days of silent 401s behind a
-- green cron history) that a predicate-only gate would leave open for this
-- function.
--
-- ⛔ THE OBSERVER'S OWN `error` ROW ON THE STALE BRANCH IS NOT ASSERTED IN THIS
-- FILE. On PROD both land (the observer row and the alert both survive a
-- successful post); on a lane the post succeeds against fixture 34's stand-in
-- so the row survives too — but an arm that depends on the stand-in's success
-- to observe the row would be asserting two things through one mechanism.
-- Plan 02 adds that assertion as its own arm with its own twin.
--
-- Arms:
--   G1  fresh ⇒ silent   — a contact row inside the ceiling produces NO post,
--                          NO raise, a NULL return, and exactly one
--                          self-observability row with status='ok'. Needs no
--                          Vault key at all — the fresh path returns before
--                          the function ever reads one — so it carries no
--                          setup of its own.
--   S1  stale ⇒ posts    — a contact row past the ceiling produces EXACTLY
--                          ONE post to the alert path, with a non-blank
--                          X-Service-Key header, a non-NULL bigint return, and
--                          no raise. Its own setup (S1-SETUP) seeds the Vault
--                          key and confirms the allow-listed destination row
--                          this arm alone depends on.
--
-- ⚠️ WHY EVERY IDENTITY CARRIES A DIGIT — `G1`/`S1`, not `G`/`S`.
-- `sectionOfIdentity` in scripts/mutation-runner/run.mjs is
-- `id.replace(/(\d)[a-z]*(-[A-Za-z]+)?$/, "$1")`: a trailing `-SUFFIX`
-- collapses into its parent SECTION only when a DIGIT precedes it. So
-- `S1-SETUP` is a SUB-ARM of section `S1` and is covered by that arm's own
-- twin. Spelled `S-SETUP` it would be its OWN section with no twin of its own,
-- and the corpus-wide "every SECTION a file raises for also carries a twin"
-- invariant (src/__tests__/mutation-annotation-parser.test.ts) would fail on
-- it by name — exactly the same rule
-- test_analytics_service_settings_and_vault_tick.sql's own header states for
-- its `V1`/`U1`/`U2`/`C1` family.
--
-- ⚠️ S1-SETUP IS DELIBERATELY NOT SEPARATELY TWINNED. It is a VACUITY guard —
-- "this fixture actually reached the state ARM S1 is about" — not a claim
-- about the migration, and a twin for it would have to break PRODUCTION in
-- order to break a FIXTURE, which inverts what a twin is for.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION
-- on failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- The final `ALL 2 ARMS EXECUTED (…)` notice at the foot of this file is the
-- sentinel CI's loop reads the arm count off. If you add or remove an arm,
-- update BOTH the integer and the roster on that line.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- `RED-UNDER-M` object that scripts/mutation-runner executes on every push: it
-- mutates COPIES on a throwaway pg-lane cluster, requires the FIRST
-- `TEST FAILED (…)` to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md.
--
-- ⚠️ Apply order, and why each entry is load-bearing: 01/02/07/12/15 are the
-- standard base (core schema, sanitize tables, Supabase bootstrap defaults,
-- profiles.is_admin, auth.role()) every gate in this corpus needs. 32 is the
-- Vault stand-in — without it the Vault read inside the function dies on a
-- raw 42P01 naming no arm. 33 is the cron_runs stand-in the function reads
-- and writes. 34 is THIS plan's new pg_net stand-in — without it the stale
-- arm's `net.http_post` call dies on a raw 3F000 (schema "net" does not
-- exist) naming no arm, which is exactly the gap this gate exists to close
-- (RESEARCH Finding 7). Then 20260907120000 and 20260911120000 seed
-- system_settings' allow-listed analytics_service_url and define
-- match_engine_cron_tick() (this file's function does not call it, but the
-- Vault-key allow-list regex it establishes is shared context for the
-- destination this gate asserts against). 20260918120000 is applied LAST,
-- because its CREATE OR REPLACE must be the definition the arms run against.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/32-fixture-vault-stand-in.sql","scripts/pg-lane/fixtures/33-fixture-cron-runs.sql","scripts/pg-lane/fixtures/34-fixture-pg-net-stand-in.sql","supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql","supabase/migrations/20260911120000_vault_tick_hardening.sql","supabase/migrations/20260918120000_prod_prober_cadence.sql"]}

BEGIN;

DO $$
DECLARE
  v_msg    TEXT;
  v_state  TEXT;
  v_setup  TEXT;
  v_raised BOOLEAN;
  v_ret    BIGINT;
  v_cnt    INTEGER;
  v_url    TEXT;
  v_key    TEXT;
BEGIN
  -- ===== ARM G1 — fresh ⇒ silent =============================================
  -- No setup of its own: the fresh path never reads the Vault or the url.
  DELETE FROM public.cron_runs WHERE cron_name IN ('prod_prober', 'prod_prober_cadence_check');
  DELETE FROM net._lane_posts;
  INSERT INTO public.cron_runs (cron_name, status, completed_at) VALUES ('prod_prober', 'ok', now());

  v_raised := false;
  BEGIN
    v_ret := public.prod_prober_cadence_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: invert the staleness comparison — `v_stale := (now() - v_last >
  --            c_contact_ceiling);` becomes `v_stale := (now() - v_last <=
  --            c_contact_ceiling);`. A FRESH row (a small gap) is then judged
  --            stale, and a truly stale row would be judged fresh — a full
  --            inversion of the predicate this arm exists to pin.
  -- RED-UNDER-M: {"arm":"G1","apply":[{"kind":"edit","file":"supabase/migrations/20260918120000_prod_prober_cadence.sql","find":"v_stale := (now() - v_last > c_contact_ceiling);","replace":"v_stale := (now() - v_last <= c_contact_ceiling);","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (G1): prod_prober_cadence_check() RAISED on a FRESH contact row: %. A fresh row must return NULL, not raise — an alarm that cannot tell fresh from stale is not an alarm.', COALESCE(v_msg, 'NULL');
  END IF;
  IF v_ret IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (G1): prod_prober_cadence_check() returned % on a FRESH contact row, expected NULL — a NULL return means "no alarm was raised on this tick", and a fresh row must never provoke one.', v_ret;
  END IF;

  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (G1): a FRESH contact row produced % outbound post(s) to net.http_post, expected 0 — an alarm that fires on every tick is muted within a week and is then indistinguishable from no alarm at all.', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM public.cron_runs
   WHERE cron_name = 'prod_prober_cadence_check' AND status = 'ok' AND error IS NULL;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (G1): expected exactly ONE self-observability row (cron_name=prod_prober_cadence_check, status=ok, error IS NULL) after a fresh tick, got % — the observer''s own liveness (D-06) must be readable the same way the prober''s is, on every tick, not only the alarming ones.', v_cnt;
  END IF;

  -- ===== ARM S1 — stale ⇒ posts, with a usable key, at the right path =======
  -- ----- S1-SETUP: a usable key, and a confirmed allow-listed destination ---
  v_setup := NULL;
  BEGIN
    PERFORM vault.create_secret('arm-fixture-key-not-real', 'analytics_service_key', 'phase 164.1.1 gate fixture');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (S1-SETUP): could not seed analytics_service_key in the vault stand-in (%), so ARM S1 below would be asking whether the function posts when it could never have resolved a key at all.', v_setup;
  END IF;

  -- The destination is already seeded by 20260907120000 (ON CONFLICT DO
  -- NOTHING) and is an allow-listed .up.railway.app host. Confirmed rather
  -- than assumed: an absent or foreign row here would make ARM S1 measure the
  -- url guard instead of the post.
  SELECT s.value INTO v_url FROM public.system_settings s WHERE s.key = 'analytics_service_url';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE EXCEPTION 'TEST FAILED (S1-SETUP): public.system_settings has no analytics_service_url row — 20260907120000''s seed did not land, so ARM S1 below cannot reach net.http_post at all.';
  END IF;

  UPDATE public.cron_runs SET completed_at = now() - INTERVAL '20 hours' WHERE cron_name = 'prod_prober';
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.prod_prober_cadence_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: widen the ceiling so a stale row is judged fresh and the post
  --            never happens — `c_contact_ceiling CONSTANT INTERVAL := '10
  --            hours 25 minutes';` becomes `c_contact_ceiling CONSTANT
  --            INTERVAL := '10000 hours';`, well past the 20-hour age ARM S1
  --            gives the row above.
  -- RED-UNDER-M: {"arm":"S1","apply":[{"kind":"edit","file":"supabase/migrations/20260918120000_prod_prober_cadence.sql","find":"c_contact_ceiling CONSTANT INTERVAL := '10 hours 25 minutes';","replace":"c_contact_ceiling CONSTANT INTERVAL := '10000 hours';","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (S1): prod_prober_cadence_check() RAISED on a STALE contact row with a usable key and an allow-listed url: %. It should have posted and returned a request id, not raised.', COALESCE(v_msg, 'NULL');
  END IF;
  IF v_ret IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (S1): prod_prober_cadence_check() returned NULL on a STALE contact row — a NULL return means "no alarm was raised on this tick", and a row 20 hours past a ~10h25m ceiling must raise one.';
  END IF;

  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (S1): a STALE contact row produced % outbound post(s) to net.http_post, expected EXACTLY 1 — a function whose body were `RAISE EXCEPTION ...` and nothing else would pass ARM G1 and post nothing forever, which is the same outage as CRON-DRIFT-01 with the sign reversed.', v_cnt;
  END IF;

  SELECT p.url, p.headers ->> 'X-Service-Key' INTO v_url, v_key FROM net._lane_posts p ORDER BY p.id DESC LIMIT 1;
  IF v_url IS NULL OR right(v_url, length('/api/prober-cadence-alert')) <> '/api/prober-cadence-alert' THEN
    RAISE EXCEPTION 'TEST FAILED (S1): the recorded post''s url is %, expected it to end with /api/prober-cadence-alert — the alert did not reach the path plan 04 owns.', COALESCE(v_url, 'NULL');
  END IF;
  -- ⛔ NOT DECORATION. A jsonb_build_object built over a NULL key produces a
  -- header with a null value, the analytics service answers 401, and because
  -- the post is fire-and-forget the scheduler records the tick as succeeded —
  -- the CRON-DRIFT-01 outage exactly, and this arm is the only place in the
  -- tree that would catch it for THIS function.
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'TEST FAILED (S1): the recorded post''s X-Service-Key header is % — a blank or absent key produces a 401 the fire-and-forget post can never surface, and a green cron history hides it for as long as CRON-DRIFT-01 did.', COALESCE(quote_literal(v_key), 'NULL');
  END IF;

  RAISE NOTICE 'ALL 2 ARMS EXECUTED (G1,S1): public.prod_prober_cadence_check() returns NULL and posts NOTHING on a fresh prod_prober contact row (G1), writing exactly one self-observability row with status=ok — and posts EXACTLY ONE alert to /api/prober-cadence-alert, carrying a non-blank X-Service-Key header, on a stale one (S1), returning a non-NULL request id. Phase 164.1.1 / plan 01 / criteria 2 and 3, mig 20260918120000.';
END $$;

ROLLBACK;
