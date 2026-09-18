-- Test: public.prod_prober_cadence_check() — Phase 164.1.1 (PROBERCADENCE)
-- plan 01 (criteria 2 and 3, arms G1/S1) and plan 02 (criterion 3's five
-- expansion arms, O1/A1/N1/U1/V1). A STALE prod_prober contact reaches an
-- OBSERVED outbound alarm; a FRESH one produces none — and neither of those
-- two states can be true for the wrong reason: an ABSENT contact, a contact
-- read that is not narrowed by cron_name, an observer whose own liveness row
-- never lands, a destination control one ALTER TABLE deep, and a post built
-- over a NULL key are the five ways plan 01's pair can stay green while the
-- alarm is still worthless.
--
-- ⛔ WHICH FILE THE ARMS ACTUALLY MEASURE: all seven arms below measure
-- supabase/migrations/20260918120000_prod_prober_cadence.sql. Every edit-kind
-- RED-UNDER-M twin in this file names that migration — a `CREATE OR REPLACE`
-- anywhere else would mutate a body already overwritten before the first
-- assertion runs, and the arm would report `no-red`: an arm that cannot fail,
-- inside the machine built to find arms that cannot fail.
--
-- ⚠️ EXECUTION ORDER IS G1, S1, O1, A1, U1, V1, N1 — NOT the alphabetic/plan
-- listing order — and it is LOAD-BEARING, not cosmetic. G1 and S1 (plan 01)
-- MUST stay the first two arms, because their own RED-UNDER-M twins mutate the
-- SHARED staleness comparison every later call in the file also uses; if any
-- other arm ran before them, that arm's own scenario — not G1's or S1's —
-- would redden first whenever G1's or S1's twin is under test (MEASURED, this
-- plan, when an early draft placed N1 first: G1's inverted-comparison twin and
-- S1's widened-ceiling twin both made N1 the first failure instead of
-- themselves, because both mutations corrupt every arm's staleness read, not
-- only their own). N1 is placed LAST, after every arm whose twin touches that
-- shared math, and for a SECOND, independent reason: `now()` inside this whole
-- DO block is TRANSACTION START time — one fixed value shared by every row any
-- arm writes — so G1's own self-observability row (STEP 4, written
-- unconditionally on G1's very first tick) is exactly as "fresh" as an
-- mt5_session_episode fixture would be. An UNFILTERED contact-read mutation
-- (`WHERE TRUE`) is therefore never safe to test after G1 has run once,
-- REGARDLESS of where the arm using it sits — MEASURED, this plan: with that
-- mutation and N1 anywhere after G1/S1, S1's own call (which always runs after
-- G1) picked up G1's self-row as "more recent" and S1 became the first
-- failure. N1's mutation below is narrowed to name a SECOND REAL PRODUCER
-- (`mt5_session_episode`) rather than dropping the predicate outright, which
-- keeps it immune to every arm's own self-observability row (never named
-- `prod_prober_cadence_check`) and lets N1 run safely last, needing its own
-- N1-SETUP to restore the Vault key (V1 removed it) and the destination (U1
-- pointed it at a foreign host). O1 runs directly after S1, while the Vault
-- key and destination are both still exactly as S1-SETUP left them — ARM U1
-- later drops the CHECK constraint and points the url at a foreign host, and
-- ARM V1 removes the key, so O1 must be done with both before either of those
-- runs.
--
-- THE MATCHED-PAIR ARGUMENT, in this gate's own terms — one sentence per pair,
-- naming which implementation each refuses.
--   G1 / S1  An implementation that posts on EVERY tick — `RETURN
--            net.http_post(...)` with no staleness check at all — passes S1
--            alone (a stale contact does get a post) but not G1, which
--            asserts ZERO posts on a fresh contact; one that never posts at
--            all — `RETURN NULL` unconditionally — passes G1 alone but not
--            S1. Only the PAIR pins the bound this function exists to hold.
--   A1       Refuses an implementation that treats a bare `now() - NULL >
--            interval` (which evaluates NULL, read as false) as healthy — the
--            one state G1/S1 cannot produce between them, because both need a
--            REAL prod_prober row and this is the state where there is none.
--   O1       Refuses an implementation whose self-observability row is wrong
--            on the STALE branch specifically. G1 already asserts the FRESH
--            branch's row (status=ok) on its own tick, so O1 does not repeat
--            that half — its mutation targets the STALE branch's status value
--            alone, which no arm but O1 reads; S1 never reads this table at
--            all, so it cannot see this class of defect either.
--   U1       Refuses an implementation whose destination control is ONLY the
--            CHECK constraint — S1 never removes that constraint, so it
--            cannot see a dropped in-body re-test; U1 drops the constraint
--            itself, inside its own transaction, and is the only arm that
--            measures the layer left standing afterwards.
--   V1       Refuses an implementation that lets a NULL/blank vault secret
--            through to net.http_post — S1 always seeds a real key via
--            S1-SETUP, so it cannot see a relaxed key guard; V1 removes the
--            key itself and is the only arm that measures that guard.
--   N1       Refuses an implementation whose contact read admits a SECOND real
--            producer — a read widened to also count `mt5_session_episode`
--            would still pass G1/S1/O1/A1/U1/V1 (none of them ever writes that
--            cron_name); N1 is the one arm that puts a second, more-recent
--            producer beside a stale prod_prober row and asserts the alarm
--            still fires. Runs LAST — see the ordering note above.
--
-- WHAT MAKES THIS GATE WORTH HAVING (criterion 3, the anti-vacuity criterion
-- this phase names explicitly). A staleness gate never observed RED has not
-- been met. All seven arms below are proven RED by their own RED-UNDER-M
-- twin, executed by `node scripts/mutation-runner/run.mjs` on a disposable
-- pg-lane — not merely asserted in prose. Arms N1, S1, A1 and U1 additionally
-- OBSERVE the post (or its absence) rather than inferring it from a SQLSTATE:
-- fixture 34 RECORDS every call `net.http_post` received, so this gate can
-- assert the actual url, path and header the function built — including that
-- `X-Service-Key` is non-NULL and non-blank, which is the exact CRON-DRIFT-01
-- shape (seven days of silent 401s behind a green cron history) that a
-- predicate-only gate would leave open for this function.
--
-- Arms (LISTED in file/plan order; EXECUTED in the G1/S1/O1/A1/U1/V1/N1 order
-- above — N1 LAST):
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
--   O1  self-row, both   — runs right after S1, while the Vault key and
--       branches            destination are both still valid. One FRESH tick
--                          then one STALE tick, asserting the observer's own
--                          cron_runs row on EACH: status=ok/error IS NULL on
--                          the fresh one, status=error/error naming the gap
--                          on the stale one, with metadata carrying ONLY
--                          gap_minutes/ceiling/contact_cron_name — never a
--                          url, a key, or a setting value.
--   A1  absent ⇒ stale    — no prod_prober row AT ALL is read as the LOUDEST
--                          possible stale signal, never a silent one: a
--                          non-NULL return, exactly one post, and a
--                          self-observability row with status=error.
--   U1  destination, two  — with the CHECK constraint dropped inside this
--       layers                arm's own transaction and analytics_service_url
--                          pointed at a foreign host, the callable still
--                          REFUSES by name and does not echo the value.
--   V1  no key ⇒ refusal,  — with analytics_service_key absent from the Vault
--       never a null header   stand-in, the callable RAISES naming the
--                          setting and net._lane_posts stays EMPTY — never a
--                          header built over a NULL key.
--   N1  narrowed by       — runs LAST (own N1-SETUP restores the key and
--       cron_name            destination). A stale prod_prober row beside a
--                          FRESH row under a different real cron_name
--                          (mt5_session_episode) still alarms — the contact
--                          read must not report the most recent of every
--                          producer it admits.
--
-- ⚠️ WHY EVERY IDENTITY CARRIES A DIGIT — `G1`/`S1`/`O1`/`A1`/`N1`/`U1`/`V1`,
-- never a bare letter. `sectionOfIdentity` in scripts/mutation-runner/run.mjs
-- is `id.replace(/(\d)[a-z]*(-[A-Za-z]+)?$/, "$1")`: a trailing `-SUFFIX`
-- collapses into its parent SECTION only when a DIGIT precedes it. So
-- `N1-SETUP`, `S1-SETUP`, `A1-SETUP`, `U1-SETUP` and `V1-SETUP` are SUB-ARMS
-- of their digit-suffixed parents and are covered by those arms' own twins.
-- Spelled without the digit each would be its OWN section with no twin of its
-- own, and the corpus-wide "every SECTION a file raises for also carries a
-- twin" invariant (src/__tests__/mutation-annotation-parser.test.ts) would
-- fail on it by name — exactly the same rule
-- test_analytics_service_settings_and_vault_tick.sql's own header states for
-- its `V1`/`U1`/`U2`/`C1` family.
--
-- ⚠️ N1-SETUP, S1-SETUP, A1-SETUP, U1-SETUP and V1-SETUP ARE DELIBERATELY NOT
-- SEPARATELY TWINNED. Each is a VACUITY guard — "this fixture actually
-- reached the state this arm is about" — not a claim about the migration, and
-- a twin for one of them would have to break PRODUCTION in order to break a
-- FIXTURE, which inverts what a twin is for.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION
-- on failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- The final `ALL 7 ARMS EXECUTED (…)` notice at the foot of this file is the
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
  -- ⛔ Arms O1, A1, N1, U1 and V1 (plan 02) add two more under the SAME rule
  --    G1/S1's own header states for their nine: plpgsql compiles this DO
  --    block WHOLE, so a missing DECLARE is a 42601 that stops the WHOLE
  --    block compiling and NEITHER arm runs.
  v_meta   JSONB;
  -- ARM O1's tie-break. `now()` inside this DO block is TRANSACTION start
  -- time (not clock_timestamp()), so both of O1's ticks write the SAME
  -- started_at — `ORDER BY started_at DESC LIMIT 1` cannot tell them apart
  -- and is not falsifiable that way. Capturing the FIRST tick's id and then
  -- reading the row whose id is NOT that one is deterministic regardless of
  -- the tie, because O1 never has more than two rows for this cron_name.
  v_row_id UUID;
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

  -- ===== ARM O1 — the observer's own liveness row, on BOTH branches (D-06) ==
  -- No -SETUP of its own: the UPSERT below cannot fail short of a constraint
  -- violation, which is not a state this arm's own fixture can produce. Runs
  -- immediately after S1, before ARM A1 below, because O1's stale tick needs
  -- the Vault key and the allow-listed url exactly as S1-SETUP left them —
  -- ARM U1 later drops the constraint and points the url at a foreign host,
  -- and ARM V1 removes the key, so O1 has to be done with both before either
  -- of those runs.
  DELETE FROM public.cron_runs WHERE cron_name = 'prod_prober_cadence_check';
  DELETE FROM net._lane_posts;
  UPDATE public.cron_runs SET completed_at = now() WHERE cron_name = 'prod_prober';
  IF NOT FOUND THEN
    INSERT INTO public.cron_runs (cron_name, status, completed_at) VALUES ('prod_prober', 'ok', now());
  END IF;

  -- ----- tick 1: FRESH ---------------------------------------------------
  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.prod_prober_cadence_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (O1): prod_prober_cadence_check() RAISED on the fresh first tick: %. This arm needs both ticks to succeed so it can compare their self-observability rows; a raise here means the fixture, not the observer-row contract, broke.', COALESCE(v_msg, 'NULL');
  END IF;

  SELECT count(*) INTO v_cnt FROM public.cron_runs WHERE cron_name = 'prod_prober_cadence_check';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (O1): expected exactly ONE self-observability row after the fresh tick, got % — the observer''s own liveness (D-06) must be written on EVERY tick, not only the alarming ones, or the observer going dark would be invisible on exactly the tick where everything else looks fine.', v_cnt;
  END IF;

  -- Capture this row's id: `now()` inside this DO block is TRANSACTION start
  -- time, so the fresh and stale ticks below write the SAME started_at, and
  -- `ORDER BY started_at DESC LIMIT 1` cannot distinguish them once a second
  -- row exists. Excluding this id below is deterministic regardless.
  SELECT id, status, error INTO v_row_id, v_state, v_msg
    FROM public.cron_runs WHERE cron_name = 'prod_prober_cadence_check'
   ORDER BY started_at DESC LIMIT 1;
  IF v_state IS DISTINCT FROM 'ok' OR v_msg IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (O1): the fresh-tick self-observability row reads status=%, error=%, expected status=ok and error IS NULL — a fresh tick that writes anything else makes the observer''s own healthy state unreadable.', COALESCE(v_state, 'NULL'), COALESCE(v_msg, 'NULL');
  END IF;

  -- ----- tick 2: STALE ---------------------------------------------------
  UPDATE public.cron_runs SET completed_at = now() - INTERVAL '20 hours' WHERE cron_name = 'prod_prober';

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.prod_prober_cadence_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (O1): prod_prober_cadence_check() RAISED on the stale second tick: %. The Vault key and destination were both left valid by S1-SETUP above, so a raise here means the fixture broke, not the row contract.', COALESCE(v_msg, 'NULL');
  END IF;

  -- RED-UNDER: hardcode the self-row's status column to always 'ok' —
  --            `CASE WHEN v_stale THEN 'error' ELSE 'ok' END,` becomes
  --            `'ok',`. ⚠️ Deliberately NOT deleting the whole INSERT: that
  --            mutation also breaks the FRESH branch's row (status='ok' with
  --            no row at all), and ARM G1 above already asserts exactly that
  --            on ITS OWN fresh tick (D-06, plan 01) — so a whole-INSERT
  --            deletion makes G1 the first failure, not O1 (MEASURED, this
  --            plan). Narrowing the mutation to the status value alone leaves
  --            every FRESH-branch row correct (it already reads 'ok') and
  --            wrong only on the STALE branch, which no arm but O1 reads.
  -- RED-UNDER-M: {"arm":"O1","apply":[{"kind":"edit","file":"supabase/migrations/20260918120000_prod_prober_cadence.sql","find":"    CASE WHEN v_stale THEN 'error' ELSE 'ok' END,","replace":"    'ok',","occurrences":1}]}
  SELECT count(*) INTO v_cnt FROM public.cron_runs WHERE cron_name = 'prod_prober_cadence_check';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (O1): expected exactly TWO self-observability rows (one per tick) after the stale second tick, got % — a tick that leaves no counted trace is the observer going silent about its OWN health, which arms G1/S1/A1/N1 cannot see because none of them reads this table.', v_cnt;
  END IF;

  -- The SECOND row is the one whose id is NOT the fresh tick's captured id —
  -- deterministic under the started_at tie described above, because this arm
  -- never carries more than two rows for this cron_name.
  SELECT status, error, metadata INTO v_state, v_msg, v_meta
    FROM public.cron_runs
   WHERE cron_name = 'prod_prober_cadence_check' AND id <> v_row_id;
  IF v_state IS DISTINCT FROM 'error' OR v_msg IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (O1): the stale-tick self-observability row reads status=%, error=%, expected status=error with a non-NULL error naming the gap — a stale tick whose own row still reads ok/NULL hides the alarm from the one place this repo can read the observer''s liveness the same way it reads the prober''s.', COALESCE(v_state, 'NULL'), COALESCE(v_msg, 'NULL');
  END IF;

  IF v_meta IS NULL
     OR NOT (v_meta ? 'gap_minutes') OR NOT (v_meta ? 'ceiling') OR NOT (v_meta ? 'contact_cron_name')
     OR (SELECT count(*) FROM jsonb_object_keys(v_meta)) <> 3
  THEN
    RAISE EXCEPTION 'TEST FAILED (O1): the stale-tick self-observability row''s metadata is % — expected EXACTLY the three keys gap_minutes, ceiling and contact_cron_name and no others. A fourth key here is exactly the leak T-161.1-10 forbids in a RAISE, applied to a written row instead: this row is readable by anyone with cron_runs SELECT access, so a url or a key value landing in it would be a second, quieter copy of the same disclosure this repo refuses in its log lines.', COALESCE(v_meta::text, 'NULL');
  END IF;
  IF jsonb_typeof(v_meta -> 'gap_minutes') <> 'number' THEN
    RAISE EXCEPTION 'TEST FAILED (O1): metadata.gap_minutes is % (jsonb type %), expected a JSON number — the gap this row records must be an integer count of minutes, not a string or a null, so a downstream reader can compare it without parsing it first.', v_meta -> 'gap_minutes', jsonb_typeof(v_meta -> 'gap_minutes');
  END IF;

  -- ===== ARM A1 — no contact row at all is STALE, never healthy ============
  -- ----- A1-SETUP: the deletion must remove a REAL row, not a fixture that -
  -- -----           never had one -------------------------------------------
  DELETE FROM public.cron_runs WHERE cron_name = 'prod_prober_cadence_check';
  DELETE FROM net._lane_posts;
  DELETE FROM public.cron_runs WHERE cron_name = 'prod_prober';
  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  IF v_cnt < 1 THEN
    RAISE EXCEPTION 'TEST FAILED (A1-SETUP): the DELETE above removed % row(s) under cron_name=prod_prober, expected at least one — this arm''s whole claim is that an ABSENT contact row alarms, and it cannot prove that against a fixture that was already absent before this arm ran.', v_cnt;
  END IF;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.prod_prober_cadence_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: remove the explicit NULL leg from the staleness decision —
  --            `IF v_last IS NULL THEN v_stale := TRUE; ELSE v_stale :=
  --            (now() - v_last > c_contact_ceiling); END IF;` collapses to
  --            the bare `v_stale := (now() - v_last > c_contact_ceiling);`.
  --            With v_last NULL that comparison is NULL, and the
  --            self-observability row this arm reads is written from `CASE
  --            WHEN v_stale THEN 'error' ELSE 'ok' END` — a NULL condition
  --            takes the ELSE branch, so the row this arm reads says 'ok'
  --            about a prober that has never made contact at all.
  -- RED-UNDER-M: {"arm":"A1","apply":[{"kind":"edit","file":"supabase/migrations/20260918120000_prod_prober_cadence.sql","find":"  IF v_last IS NULL THEN\n    v_stale := TRUE;\n  ELSE\n    v_stale := (now() - v_last > c_contact_ceiling);\n  END IF;","replace":"  v_stale := (now() - v_last > c_contact_ceiling);","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (A1): prod_prober_cadence_check() RAISED with NO prod_prober contact row at all: %. The Vault key and destination were both left valid by S1-SETUP above, so an absent contact must reach the SAME post path a stale one does, not raise about something unrelated.', COALESCE(v_msg, 'NULL');
  END IF;
  IF v_ret IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (A1): prod_prober_cadence_check() returned NULL with NO prod_prober contact row at all — a NULL return means "no alarm was raised on this tick", and an absent contact is the LOUDEST possible stale signal, never a silent one.';
  END IF;

  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (A1): an ABSENT prod_prober contact row produced % outbound post(s), expected EXACTLY 1 — the row-count analogue of arm S1''s claim, over the one contact state S1 does not cover: nobody ever ran the prober at all.', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM public.cron_runs
   WHERE cron_name = 'prod_prober_cadence_check' AND status = 'error' AND error IS NOT NULL;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (A1): expected exactly ONE self-observability row (status=error, error naming the gap) after a tick with NO prod_prober contact row, got % — an observer that reads an absent contact as healthy is silent precisely when the prober has never run at all, which is strictly worse than having no observer: a green reading is load-bearing where an absent one would at least be visibly unknown.', v_cnt;
  END IF;

  -- ===== ARM U1 — the destination has a SECOND layer ========================
  -- ----- U1-SETUP: drop the CHECK constraint, then point the row at a ------
  -- -----           foreign host --------------------------------------------
  v_setup := NULL;
  BEGIN
    ALTER TABLE public.system_settings
      DROP CONSTRAINT IF EXISTS system_settings_analytics_service_url_allowed;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (U1-SETUP): could not drop system_settings_analytics_service_url_allowed for this arm (%) — ARM U1 below needs the CHECK constraint gone to reach the in-body re-test at all, the same ordering test_analytics_service_settings_and_vault_tick.sql''s arm U2/C2 pair depends on. Record what it says — do NOT weaken the arm to accommodate it.', v_setup;
  END IF;

  UPDATE public.system_settings SET value = 'https://collector.attacker.example' WHERE key = 'analytics_service_url';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (U1-SETUP): no analytics_service_url row to point at a foreign host — 20260907120000''s seed did not land, so ARM U1 below cannot reach net.http_post''s guard at all.';
  END IF;

  UPDATE public.cron_runs SET completed_at = now() - INTERVAL '20 hours' WHERE cron_name = 'prod_prober';
  IF NOT FOUND THEN
    INSERT INTO public.cron_runs (cron_name, status, completed_at) VALUES ('prod_prober', 'ok', now() - INTERVAL '20 hours');
  END IF;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.prod_prober_cadence_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: delete the in-body regex re-test (STEP 6's LAYER (b)) from the
  --            migration — `IF v_url !~ c_url_allowed THEN RAISE EXCEPTION
  --            ...; END IF;` removed entirely. With the CHECK constraint
  --            already dropped by U1-SETUP above, the destination control is
  --            then zero layers deep and the function sails into
  --            net.http_post carrying the live analytics_service_key to
  --            collector.attacker.example.
  -- RED-UNDER-M: {"arm":"U1","apply":[{"kind":"edit","file":"supabase/migrations/20260918120000_prod_prober_cadence.sql","find":"  IF v_url !~ c_url_allowed THEN\n    RAISE EXCEPTION 'analytics_service_url in system_settings is not an allowed destination — refusing to post the analytics service key. The offending value is deliberately NOT echoed here; read it with an admin session. Allowed: an https host under .up.railway.app';\n  END IF;","replace":"","occurrences":1}]}
  IF NOT v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (U1): prod_prober_cadence_check() RETURNED with analytics_service_url pointing at collector.attacker.example and its CHECK constraint dropped — the destination control is one ALTER TABLE from gone (this arm just performed that ALTER TABLE), and if the in-body re-test is also absent the whole thing is zero layers deep. What leaves in an X-Service-Key header then goes wherever this row names, and nothing downstream ever reports it.';
  END IF;
  IF v_msg !~ 'analytics_service_url' OR v_msg !~ 'not an allowed destination' THEN
    RAISE EXCEPTION 'TEST FAILED (U1): the callable raised with the CHECK constraint dropped and a foreign url in place, but its message does not name analytics_service_url / "not an allowed destination" — it reads: %. If this reads like a raw net.http_post SQLSTATE instead, the in-body re-test is absent and the function got further than it should have.', COALESCE(v_msg, 'NULL');
  END IF;
  IF v_msg ~ 'collector\.attacker\.example' THEN
    RAISE EXCEPTION 'TEST FAILED (U1): the destination refusal ECHOED the url it refused — it reads: %. RAISE text lands in cron.job_run_details and the Postgres log, and this repo is public; the guard that refuses a destination must never publish the one it refused (T-161.1-10).', v_msg;
  END IF;

  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (U1): % outbound post(s) were recorded despite the destination guard, expected ZERO — a refusal that still lets the request out is not a refusal at all.', v_cnt;
  END IF;

  -- ===== ARM V1 — no usable key means no post, not a null header ===========
  -- ----- V1-SETUP: restore an allow-listed url, then remove the key --------
  UPDATE public.system_settings SET value = 'https://quantalyze-analytics-production.up.railway.app' WHERE key = 'analytics_service_url';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (V1-SETUP): no analytics_service_url row to restore to an allow-listed destination — ARM U1 above left it pointing at a foreign host, and without a valid destination this arm would be measuring the url guard instead of the key guard.';
  END IF;

  v_setup := NULL;
  BEGIN
    DELETE FROM vault.decrypted_secrets WHERE name = 'analytics_service_key';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (V1-SETUP): could not remove analytics_service_key from the vault stand-in for this arm (%) — record what it says, do NOT weaken V1 to accommodate it.', v_setup;
  END IF;

  UPDATE public.cron_runs SET completed_at = now() - INTERVAL '20 hours' WHERE cron_name = 'prod_prober';
  IF NOT FOUND THEN
    INSERT INTO public.cron_runs (cron_name, status, completed_at) VALUES ('prod_prober', 'ok', now() - INTERVAL '20 hours');
  END IF;
  DELETE FROM net._lane_posts;

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.prod_prober_cadence_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: relax the key guard so a NULL or blank secret proceeds to the
  --            post — `IF v_key IS NULL OR btrim(v_key) = '' THEN RAISE
  --            EXCEPTION 'analytics_service_key missing from vault ...'; END
  --            IF;` becomes `IF FALSE THEN`. v_key stays NULL, and
  --            jsonb_build_object('X-Service-Key', NULL) builds a header
  --            with a null value: the analytics service answers 401, and
  --            because the post is fire-and-forget the scheduler records the
  --            tick as succeeded — the CRON-DRIFT-01 outage, seven days of
  --            silent 401s behind a green history, and it has already
  --            happened once in this system.
  -- RED-UNDER-M: {"arm":"V1","apply":[{"kind":"edit","file":"supabase/migrations/20260918120000_prod_prober_cadence.sql","find":"  IF v_key IS NULL OR btrim(v_key) = '' THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  IF NOT v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (V1): prod_prober_cadence_check() RETURNED with no analytics_service_key in the vault. A header object built over a NULL key is a header with a null value, the analytics service answers 401, and because net.http_post is fire-and-forget the scheduler records the tick as succeeded — exactly the outage this arm exists to refuse.';
  END IF;
  IF v_msg !~ 'analytics_service_key' THEN
    RAISE EXCEPTION 'TEST FAILED (V1): the callable did raise with no key present, but its message does not name analytics_service_key — it reads: %.', COALESCE(v_msg, 'NULL');
  END IF;

  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (V1): % outbound post(s) were recorded despite the missing key, expected ZERO — arm S1 stays green under this mutant whenever the key IS present, so V1 is the only arm that measures the guard itself.', v_cnt;
  END IF;

  -- ===== ARM N1 — the freshness read is NARROWED by cron_name ==============
  -- ----- N1-SETUP: RESTORE a usable key and an allow-listed destination — ---
  -- -----           V1 above deleted the key, U1 pointed the url at a -------
  -- -----           foreign host ---------------------------------------------
  -- ⚠️ RUNS LAST, after every other arm, and that ordering is LOAD-BEARING.
  -- `now()` inside this whole DO block is TRANSACTION START time — one fixed
  -- value shared by every row any arm writes — so G1's own self-observability
  -- row (STEP 4, written unconditionally on G1's very first tick) is exactly
  -- as "fresh" as this arm's own mt5_session_episode fixture would be. An
  -- earlier version of this arm mutated the contact read down to an
  -- UNFILTERED `WHERE TRUE` and ran FIRST (before G1/S1) to dodge that; MEASURED
  -- on this plan's own biting run, that made G1's and S1's OWN pre-existing
  -- (plan 01) mutations redden THIS arm instead of themselves, because their
  -- mutations corrupt the SAME staleness comparison every arm shares, and
  -- G1/S1 must stay the first two arms in the file for their own twins to
  -- remain self-attributed. The fix is a NARROWER mutation below that matches
  -- ONLY `prod_prober` and `mt5_session_episode` — never
  -- `prod_prober_cadence_check` — so it is immune to every arm's own
  -- self-observability row regardless of how many have already run, and N1 can
  -- safely run last, after every arm whose mutation touches the shared
  -- staleness math.
  UPDATE public.system_settings SET value = 'https://quantalyze-analytics-production.up.railway.app' WHERE key = 'analytics_service_url';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (N1-SETUP): no analytics_service_url row to restore to an allow-listed destination — ARM U1 above left it pointing at a foreign host, and without a valid destination this arm would be measuring the url guard instead of the narrowing bug.';
  END IF;

  v_setup := NULL;
  BEGIN
    PERFORM vault.create_secret('arm-fixture-key-not-real', 'analytics_service_key', 'phase 164.1.1 gate fixture');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (N1-SETUP): could not re-seed analytics_service_key in the vault stand-in (%) — ARM V1 above removed it, so ARM N1 below needs it re-seeded to reach the contact read at all.', v_setup;
  END IF;

  DELETE FROM public.cron_runs WHERE cron_name IN ('prod_prober', 'mt5_session_episode');
  DELETE FROM net._lane_posts;
  INSERT INTO public.cron_runs (cron_name, status, completed_at) VALUES ('prod_prober', 'ok', now() - INTERVAL '20 hours');
  INSERT INTO public.cron_runs (cron_name, status, completed_at) VALUES ('mt5_session_episode', 'ok', now());

  v_raised := false;
  v_msg := NULL;
  BEGIN
    v_ret := public.prod_prober_cadence_check();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: widen the contact read's predicate to also admit a second REAL
  --            producer — `WHERE cron_name = 'prod_prober';` becomes `WHERE
  --            cron_name IN ('prod_prober', 'mt5_session_episode');` — the
  --            realistic shape of this bug: a maintainer widens the read to
  --            "also count MT5 session activity as evidence of liveness"
  --            without noticing the read is supposed to name ONE producer,
  --            never the observer's own bookkeeping name, so this mutation
  --            stays immune to every arm's self-observability row while still
  --            reddening on a second genuine producer.
  -- RED-UNDER-M: {"arm":"N1","apply":[{"kind":"edit","file":"supabase/migrations/20260918120000_prod_prober_cadence.sql","find":"   WHERE cron_name = 'prod_prober';","replace":"   WHERE cron_name IN ('prod_prober', 'mt5_session_episode');","occurrences":1}]}
  IF v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (N1): prod_prober_cadence_check() RAISED with a stale prod_prober row and a fresh mt5_session_episode row beside it: %. N1-SETUP restored the Vault key and destination above, so an unrelated raise here means the fixture broke, not the contact read.', COALESCE(v_msg, 'NULL');
  END IF;
  IF v_ret IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (N1): prod_prober_cadence_check() returned NULL with a stale prod_prober row 20 hours past the ceiling — this table has multiple independent producers (D-01), and a read that is not narrowed to ONE of them reports the MOST RECENT of the ones it does admit, so a fresh mt5_session_episode row masked the prober''s own silence.';
  END IF;

  SELECT count(*) INTO v_cnt FROM net._lane_posts;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (N1): a stale prod_prober row beside a fresh mt5_session_episode row produced % outbound post(s), expected EXACTLY 1 — the row-count analogue of the return-value assertion above, over the same coupling.', v_cnt;
  END IF;

  RAISE NOTICE 'ALL 7 ARMS EXECUTED (G1,S1,O1,A1,U1,V1,N1): public.prod_prober_cadence_check() returns NULL and posts NOTHING on a fresh prod_prober contact row (G1), writing exactly one self-observability row with status=ok — and posts EXACTLY ONE alert to /api/prober-cadence-alert, carrying a non-blank X-Service-Key header, on a stale one (S1), returning a non-NULL request id. The observer''s own row lands on BOTH branches with the right status, and its metadata carries only gap_minutes/ceiling/contact_cron_name (O1). An ABSENT contact row is read as STALE, never healthy (A1) — the loudest signal this function can give, not a silent one. The destination survives its CHECK constraint being dropped, because the callable re-tests the same allow-list itself before it ever builds a header (U1). A missing key produces a REFUSAL, never a header with a null value (V1). A fresh row under a DIFFERENT cron_name does not mask the prober''s own silence (N1) — the contact read is narrowed to ONE producer, never a scan admitting every producer this table has. Phase 164.1.1 / plan 02 / criterion 3, mig 20260918120000.';
END $$;

ROLLBACK;
