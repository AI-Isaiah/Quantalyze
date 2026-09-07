-- Test: public.match_engine_cron_tick() REFUSES to fire with a missing service
-- key or a missing service URL, gets past both checks when they are present,
-- and public.system_settings is readable/writable by nobody a browser can be.
-- Guards migration 20260907120000_analytics_service_settings_and_vault_tick.sql
-- (Phase 164.7 / plan 02 / criterion 2, APPSETTINGS — SC-2 for
-- analytics_service_key and analytics_service_url).
--
-- What makes this gate worth having
-- ---------------------------------
-- The two RAISEs in that function are the whole of what separates "the secret
-- is gone" from "seven days of 401s behind a green job history". TODOS
-- CRON-DRIFT-01 is the incident: a `SELECT … INTO` without STRICT sets its
-- target to NULL rather than raising, jsonb_build_object('X-Service-Key', NULL)
-- sends a null header, the analytics service answers 401, and net.http_post is
-- ASYNC so the scheduler logs `succeeded` either way. Nothing downstream can
-- tell those apart. So the claim under test is not "the function works" — it is
-- "the function FAILS LOUDLY, by name, on each of the two absences", and the
-- only way to assert that is to call it on a real cluster with the value
-- actually removed. Every arm below does exactly that.
--
-- The RLS arms are the other half of SC-2. `analytics_service_url` is the host
-- the service key is posted to: whoever can UPDATE that row can redirect a live
-- secret to a host of their choosing (T-164.7-06). Two layers stand in the way
-- and both are asserted — the table-level REVOKE from anon and the two policies.
--
-- ⭐ AND WHO MAY WRITE IS NOT THE WHOLE CLAIM — WHAT MAY BE WRITTEN IS THE REST
-- OF IT. `system_settings_admin_all` is FOR ALL TO authenticated, so R1 and R2
-- say nothing whatsoever about an ADMIN: an app-admin PATCHes that row through
-- PostgREST, entirely within the policy, and the next tick hands the Vault-held
-- service key to their host. Three arms bound the value rather than the writer —
-- U2 (the CHECK constraint refuses a foreign destination), C2 (the callable
-- re-tests the same allow-list, which is the layer that survives one ALTER TABLE
-- dropping the constraint) and C3 (its refusal does not echo the attacker's
-- string into this project's logs).
--
-- ⭐ T1 IS THE STATEMENT RLS CANNOT SEE. TRUNCATE is not subject to row
-- security, and Supabase's bootstrap `GRANT ALL ON TABLES` includes it — so
-- until the migration revokes it, any logged-in user empties this table and
-- every later tick RAISES the missing-row message while the row's real cause of
-- death was a statement no policy evaluated. R1/R2/R3 are all blind to it by
-- construction; that is why it is its own arm and not a clause of R2.
--
-- ⛔ THE APPLIED-NESS GATE RAISES. IT DOES NOT SKIP (WR-03). Arm 0 keys on the
-- pg_proc/pg_class catalogue, not on anything inside the function body: a
-- presence gate that is a substring of the thing under test stops seeing it
-- exactly when the thing is neutered, prints a skip and exits 0.
--
-- ⚠️ ON SHARED TEST THIS IS EXPECTED TO FIRE, AND IT IS NOT A COUPLING
-- REGRESSION. CI's `sql-tests` runs every supabase/tests/test_*.sql against
-- TEST_SUPABASE_DB_URL and NO workflow applies migrations to TEST (TODOS
-- SKIP-01, CI-MIGRATE-01). From this PR's first CI run until someone
-- hand-applies 20260907120000_analytics_service_settings_and_vault_tick.sql to
-- TEST, arm 0 fires here. Apply the migration to TEST (which-database marker
-- first, `psql "$TEST_SUPABASE_DB_URL" -f …`, never `db push` — TEST is
-- SHARED and this is a founder action); do NOT convert this to a skip, and do
-- NOT reword it to a phrasing CI's SKIP grep cannot see.
--
-- ⚠️ A SECOND SHARED-TEST UNKNOWN, STATED RATHER THAN ASSUMED. On the pg-lane
-- `vault.decrypted_secrets` is a TABLE (stand-in fixture 32); on TEST it is the
-- real `supabase_vault` VIEW, and whether a DELETE against it is permitted —
-- and whether the CI role may read it at all — has never been measured. Arm V1
-- needs the key ABSENT for the duration of one transaction, so it deletes the
-- row inside the transaction that rolls back. If that DELETE cannot run, this
-- file says so by name (`TEST FAILED (V1-SETUP)`) instead of asserting nothing:
-- the failure mode of NOT guarding it is a V1 that passes because the callable
-- raised for a reason V1 never asked about.
--
-- ⚠️ ARM C1 CAUSES AN OUTBOUND POST WHEREVER pg_net EXISTS. Its fixture sets
-- analytics_service_url to `http://127.0.0.1:9` — the discard port, on loopback
-- — precisely so the request C1 provokes cannot leave the host and cannot reach
-- the real analytics service. Do not "improve" that fixture to a reachable URL:
-- net.http_post is fire-and-forget, so a reachable one would make every CI run
-- of this file trigger a production match-engine recompute. On the pg-lane
-- there is no pg_net at all and the call dies on 3F000 before any socket opens.
-- ⭐ That literal is inside the migration's destination allow-list FOR THIS
-- REASON, and the migration says so at its ⚠️ THE ONE NON-RAILWAY VALUE note:
-- the alternative — a fixture that had to be a real Railway hostname — is a
-- socket to the internet on every CI run, and permitting a value that cannot
-- leave the host costs nothing an attacker wants.
--
-- ⛔ THIS FILE DROPS THE CHECK CONSTRAINT AFTER ARM U2, ON PURPOSE, AND THE
-- ORDERING IS LOAD-BEARING — do not move the drop earlier and do not remove it.
-- U2 proves the constraint bites while it is still in force. From that point on
-- the arms need fixture values that are deliberately NOT valid destinations
-- (`r2-must-not-stick`, `r3-must-stick`, C2's foreign host), and leaving the
-- constraint in force would let it reject R2's UPDATE — so R2's twin, which adds
-- the permissive `TO authenticated` policy, would stop reddening and a real
-- policy regression would sit behind a CHECK constraint that happened to catch
-- it. R3 is worse: its write must STICK, and a constraint would refuse it
-- outright. The drop takes an ACCESS EXCLUSIVE lock held to this file's
-- ROLLBACK; that is acceptable here and nowhere near a general licence — nothing
-- else in the corpus writes public.system_settings and it has no application
-- reader at all (there is no admin route, by design).
--
-- ⭐ WHY EVERY IDENTITY CARRIES A DIGIT — `V1`, not `V`. `sectionOfIdentity` in
-- scripts/mutation-runner/run.mjs is `id.replace(/(\d)[a-z]*(-[A-Za-z]+)?$/, "$1")`:
-- a trailing `-SUFFIX` collapses into its parent SECTION only when a DIGIT
-- precedes it. So `V1-SETUP` and `R2-SETUP` are SUB-ARMS of sections `V1` and
-- `R2` and are covered by those arms' twins. Spelled `V-SETUP` each would be its
-- OWN section and the section-coverage invariant
-- (src/__tests__/mutation-annotation-parser.test.ts) would correctly demand a
-- twin for it. Arm `0` carries its digit for the same reason.
--
-- ⚠️ The SETUP guards are deliberately NOT separately twinned. They are VACUITY
-- guards — "this fixture actually reached the state this arm is about" — not
-- claims about the migration, and a twin for one of them would have to break
-- PRODUCTION in order to break a FIXTURE, which inverts what a twin is for.
--
-- Arms:
--   0   applied-ness           — the function and the table both exist. Absence
--                                is a FAILURE naming both causes it cannot
--                                distinguish.
--   V1  no secret ⇒ key RAISE  — the CRON-DRIFT-01 headline. With
--                                vault.decrypted_secrets carrying no
--                                `analytics_service_key`, the callable must
--                                raise a message naming that setting, not
--                                return and not raise about something else.
--   U1  no url ⇒ url RAISE     — the same claim for the setting that has no
--                                consumer anywhere yet. It is a SEPARATE check
--                                on a SEPARATE variable, so V1 does not imply
--                                it: deleting the url guard leaves V1 green.
--   U2  foreign url REFUSED    — the CHECK constraint will not STORE a
--                                destination outside the allow-list. Bounds
--                                WHAT may be written where R1/R2 bound WHO, and
--                                an ADMIN is inside every predicate they test.
--   C1  both present ⇒ PAST    — the discriminator. Without it a callable that
--                                raised UNCONDITIONALLY would pass V1 and U1
--                                and never post anything, which is the outage
--                                with the opposite sign.
--   C2  foreign url ⇒ RAISE    — the callable re-tests the allow-list itself.
--                                U2 is one ALTER TABLE from being gone; this is
--                                the layer that is still there afterwards, so
--                                it is not a duplicate of U2 but its survivor.
--   C3  refusal does not echo  — that RAISE names the SETTING, never the
--                                attacker-chosen value (T-161.1-10). RAISE text
--                                reaches the job-run row and the Postgres log,
--                                and writing a collector's hostname there hands
--                                it to every downstream reader of these logs.
--   R1  anon reads nothing     — two layers: `REVOKE ALL … FROM anon` and the
--                                absence of any anon-visible policy. system_flags
--                                carries a scoped anon-readable policy for its
--                                kill switch; this table deliberately has no
--                                such policy, and R1 is what says so.
--   R2  non-admin cannot write — the `profiles.is_admin` conjunct in
--                                system_settings_admin_all is load-bearing:
--                                without it any authenticated user redirects the
--                                service key's destination.
--   R3  service_role CAN write — the positive control. Without it, R1 and R2
--                                are both satisfied by a table nobody can write
--                                at all, i.e. by a broken operator surface.
--   T1  no TRUNCATE for authed — the statement row security does not see.
--                                Supabase's bootstrap GRANT ALL includes
--                                TRUNCATE; R1/R2/R3 are blind to it because no
--                                policy is consulted for it.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION
-- on failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- The final `ALL 11 ARMS EXECUTED (…)` notice at the foot of this file is the
-- sentinel CI's loop reads the arm count off. If you add or remove an arm,
-- update BOTH the integer and the roster on that line: `sql-tests` counts the
-- roster's entries and fails when they disagree with N, which is what makes
-- deleting an arm cost two edits in the same string instead of one silent
-- decrement.
-- ⚠️ The roster is deliberately NOT spelled out again here. It must occur
-- EXACTLY ONCE in this file: a header that quotes it verbatim is a second
-- occurrence that a count-based read-back cannot tell from the real one, and
-- the sentinel would then survive the deletion of the notice it names.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_analytics_service_settings_and_vault_tick.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- `RED-UNDER-M` object that scripts/mutation-runner executes on every push: it
-- mutates COPIES on a throwaway pg-lane cluster, requires the FIRST
-- `TEST FAILED (…)` to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ The apply list ends at fixture 32 and then the migration. 32 is the vault
-- stand-in without which NO arm of this file can run on the lane: plpgsql
-- resolves `vault.decrypted_secrets` at CALL time, so the migration applies
-- happily on a vault-less cluster and then every call dies on a raw 42P01
-- naming no arm. 07 is equally load-bearing and for the subtler reason its own
-- header gives — it grants Supabase's project-bootstrap defaults, so the
-- migration's `REVOKE ALL … FROM anon` has something to revoke and arm R1 can
-- fail. 12 supplies `profiles.is_admin` (default FALSE) for arm R2's
-- non-admin, and 15 supplies `auth.role()` without which
-- system_settings_service_all does not parse.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/32-fixture-vault-stand-in.sql","supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql"]}

BEGIN;

DO $$
DECLARE
  v_msg     TEXT;
  v_state   TEXT;
  v_setup   TEXT;
  v_raised  BOOLEAN;
  v_cnt     INTEGER;
  v_val     TEXT;
  v_uid     UUID;
  v_admin   BOOLEAN;
  v_seedurl TEXT := 'https://quantalyze-analytics-production.up.railway.app';
BEGIN
  -- ===== ARM 0 — applied-ness. ABSENCE IS A FAILURE, NOT A SKIP ===========
  -- RED-UNDER: drop the function on the live lane AFTER the apply list has run,
  --            so the gate meets a database on which 20260907120000 is not in
  --            force. ⚠️ A `sql` step and NOT an `edit` that typos the CREATE:
  --            the migration's own STEP 3 verify block asserts the function
  --            exists and would RAISE, aborting the apply, so no arm could be
  --            the FIRST failure — the runner would score a defect, not a bite.
  --            The lane's --post-apply hook exists for exactly this shape.
  -- RED-UNDER-M: {"arm":"0","apply":[{"kind":"sql","stmt":"DROP FUNCTION public.match_engine_cron_tick()"}]}
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                   JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'match_engine_cron_tick')
     OR NOT EXISTS (SELECT 1 FROM pg_class c
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'public' AND c.relname = 'system_settings') THEN
    RAISE EXCEPTION 'TEST FAILED (0): this database has no public.match_engine_cron_tick() and/or no public.system_settings, so arms V1, U1, C1, R1, R2 and R3 would have died on a raw 42883/42P01 naming no arm — or, worse, been deleted by a future reader who read that error as "these arms are broken". TWO causes fit and this assertion cannot distinguish them, so check both: (i) this database has not received 20260907120000_analytics_service_settings_and_vault_tick.sql — apply it and re-run; expect this exactly once on the PR that introduces it, because NO workflow applies migrations to TEST; (ii) a later migration dropped them, which reverts SC-2 outright and leaves the analytics service key with no described reader at all. ⛔ Do NOT "fix" this by turning it into a RAISE NOTICE skip, and do not reword it to any phrasing CI''s SKIP grep cannot see.';
  END IF;

  -- ===== ARM V1 — no secret ⇒ the callable RAISES, naming the key =========
  -- The state has to be produced, not assumed: on the pg-lane the stand-in
  -- starts empty, but on shared TEST a real secret of this name may well exist.
  -- Deleting it INSIDE this transaction is what makes the arm mean the same
  -- thing on both, and the whole file ends in ROLLBACK so nothing is lost.
  v_setup := NULL;
  BEGIN
    DELETE FROM vault.decrypted_secrets WHERE name = 'analytics_service_key';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (V1-SETUP): could not remove the analytics_service_key secret for the duration of this transaction (%), so V1 below would be asking its question of a database that still holds the secret and any raise it saw would be about something else entirely. On the pg-lane vault.decrypted_secrets is a stand-in TABLE; on shared TEST it is the real supabase_vault VIEW, and this is the first run that measures whether a DELETE against it is permitted for the CI role. Record what it says — do NOT weaken V1 to accommodate it.', v_setup;
  END IF;

  v_raised := false;
  BEGIN
    PERFORM public.match_engine_cron_tick();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: stand the key guard down — `IF v_key IS NULL OR v_key = '' THEN`
  --            becomes `IF FALSE THEN`, which is EXACTLY the pre-CRON-DRIFT-01
  --            shape: the read still happens, v_key is still NULL, and the
  --            function sails on into net.http_post with a null X-Service-Key
  --            header. No layering is needed — the migration's STEP 3 verify
  --            asserts the BODY still names vault.decrypted_secrets and
  --            analytics_service_url, and this edit changes neither.
  -- RED-UNDER-M: {"arm":"V1","apply":[{"kind":"edit","file":"supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql","find":"IF v_key IS NULL OR v_key = '' THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF NOT v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (V1): match_engine_cron_tick() RETURNED with no analytics_service_key in the vault. That is the CRON-DRIFT-01 outage exactly: jsonb_build_object(''X-Service-Key'', NULL) builds a header with a null value, the analytics service answers 401, and because net.http_post is ASYNC the scheduler records the run as succeeded. Seven days of silent 401s behind a green job history is what this RAISE exists to convert into one failed run row.';
  END IF;
  IF v_msg !~ 'analytics_service_key missing from vault' THEN
    RAISE EXCEPTION 'TEST FAILED (V1): the callable did raise with no secret present, but its message does not name analytics_service_key — it reads: %. A raise that does not say WHICH value is missing sends an operator to read the function body under incident pressure, and the message is also the string the cron-obs prober arm keys on. If this reads like a raw 42P01/42883, the vault stand-in or the function itself is missing rather than the guard working.', COALESCE(v_msg, 'NULL');
  END IF;

  -- ===== ARM U1 — no url ⇒ the callable RAISES, naming the url ============
  -- U1 is NOT implied by V1: they are separate IFs over separate variables, and
  -- deleting the url guard leaves V1 perfectly green.
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'analytics_service_key') THEN
    PERFORM vault.create_secret('arm-u1-not-a-real-key', 'analytics_service_key', 'phase 164.7 gate fixture');
  END IF;
  DELETE FROM public.system_settings WHERE key = 'analytics_service_url';

  v_raised := false;
  BEGIN
    PERFORM public.match_engine_cron_tick();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: stand the url guard down — `IF v_url IS NULL OR v_url = '' THEN`
  --            becomes `IF FALSE THEN`. v_url is then NULL, `v_url || '/api/…'`
  --            is NULL, and the function posts to a null url instead of saying
  --            which setting is missing.
  -- RED-UNDER-M: {"arm":"U1","apply":[{"kind":"edit","file":"supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql","find":"IF v_url IS NULL OR v_url = '' THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF NOT v_raised THEN
    RAISE EXCEPTION 'TEST FAILED (U1): match_engine_cron_tick() RETURNED with no analytics_service_url row in system_settings. `NULL || ''/api/match/cron-recompute''` is NULL, so this posts the live service key to a null url — the same async, silently-successful shape as V1, with the secret now going somewhere nobody chose.';
  END IF;
  IF v_msg !~ 'analytics_service_url missing from system_settings' THEN
    RAISE EXCEPTION 'TEST FAILED (U1): the callable did raise with the url row deleted, but its message does not name analytics_service_url — it reads: %. Two very different faults produce a raise here (an absent setting and an absent pg_net) and only the message tells an operator which one they are looking at.', COALESCE(v_msg, 'NULL');
  END IF;

  -- ===== ARM U2 — the CHECK constraint REFUSES a foreign destination ======
  -- The THIRD route to the service key, and the cheapest of the three. STEP 3
  -- of the migration closes a caller-supplied argument (check 1) and a shadowed
  -- schema (check 2); this is the one an attacker does not have to be clever
  -- for. `system_settings_admin_all` is FOR ALL TO authenticated with an
  -- is_admin conjunct, so an APP-ADMIN rewriting this row is acting entirely
  -- INSIDE the policy R2 asserts — R2 is not weakened, it simply never made a
  -- claim about admins. One tick later the Vault-held key is in a header sent to
  -- whatever host the row now names (T-164.7-06).
  --
  -- ⚠️ Attempted as the ORDINARY session role, deliberately. A CHECK constraint
  -- binds every writer — owner, service_role and admin alike — so proving it
  -- here proves it for the admin path without this arm depending on R1/R2/R3's
  -- grant and policy layers at all. The url row is ABSENT at this point (U1
  -- deleted it), so the write under test is an INSERT.
  v_state := NULL;
  BEGIN
    INSERT INTO public.system_settings (key, value)
    VALUES ('analytics_service_url', 'https://collector.attacker.example');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE;
  END;
  SELECT count(*) INTO v_cnt
    FROM public.system_settings WHERE key = 'analytics_service_url';

  -- RED-UNDER: drop the constraint on the live lane AFTER the apply list has
  --            run. That single ALTER TABLE is exactly the realistic
  --            regression — a hardening pass, a hand-repair or a restore that
  --            re-creates the table without it — and it needs no migration and
  --            no review. The foreign host is then stored and this arm is the
  --            FIRST failure. ⚠️ A `sql` step and NOT an edit removing the
  --            migration's ADD CONSTRAINT: STEP 3 check 7 asserts that
  --            constraint exists, so the edit would ABORT the apply and no arm
  --            could be the first failure — the runner would score a defect
  --            rather than a bite. The lane's --post-apply hook is for this.
  -- RED-UNDER-M: {"arm":"U2","apply":[{"kind":"sql","stmt":"ALTER TABLE public.system_settings DROP CONSTRAINT system_settings_analytics_service_url_allowed"}]}
  IF v_cnt <> 0 OR v_state IS DISTINCT FROM '23514' THEN
    RAISE EXCEPTION 'TEST FAILED (U2): public.system_settings STORED analytics_service_url pointing at a host this project does not deploy to — the row count for that key is now % and the write returned SQLSTATE % (23514 = the constraint refusing it, which is what should have happened). That row is the destination public.match_engine_cron_tick() POSTs the Vault-held analytics service key to, and system_settings_admin_all is FOR ALL TO authenticated: any app-admin reaches it with one PATCH through PostgREST, entirely inside the policy R2 asserts. R1 and R2 cannot see this — they bound WHO may write the row, and an admin is a legitimate writer. ⛔ Do NOT "fix" a red here by widening the allow-list to admit the value: changing where a live secret is sent is meant to cost a migration a human reads.', v_cnt, COALESCE(v_state, 'none — the write succeeded');
  END IF;

  -- ----- the constraint comes OFF for the remainder of this file -----------
  -- ⛔ ORDER IS LOAD-BEARING; see the ⛔ THIS FILE DROPS THE CHECK CONSTRAINT
  -- note in the header for the whole argument. In one line: U2 above has just
  -- proven the constraint bites, and every arm after this point needs a fixture
  -- value that is deliberately NOT a valid destination — leaving it in force
  -- would make it, not RLS, the thing that rejects R2's UPDATE, so R2's twin
  -- would stop reddening and a genuine policy regression would hide behind a
  -- CHECK constraint that happened to catch it.
  --
  -- ⚠️ Wrapped and named. If the CI role may not ALTER this table the statement
  -- fails with a bare 42501 carrying no arm identity, and every arm below would
  -- then die on a constraint violation naming nothing. Say so by name instead.
  v_setup := NULL;
  BEGIN
    ALTER TABLE public.system_settings
      DROP CONSTRAINT IF EXISTS system_settings_analytics_service_url_allowed;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    v_setup := v_state || ' ' || v_msg;
  END;
  IF v_setup IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (U2-SETUP): could not drop system_settings_analytics_service_url_allowed for the remainder of this transaction (%). Arms C1, C2, R2 and R3 all write fixture values that the allow-list correctly refuses, so with the constraint still in force each of them would fail on a 23514 that has nothing to do with the claim it makes — and R2 would report GREEN for the wrong reason, because a rejected UPDATE looks the same whether RLS or a CHECK rejected it. Record what this says; do NOT weaken the constraint to accommodate it.', v_setup;
  END IF;

  -- ===== ARM C1 — both present ⇒ the callable gets PAST both checks =======
  -- The discriminator, and it is not optional: a function whose body were
  -- `RAISE EXCEPTION ''analytics_service_key missing from vault …''` and nothing
  -- else would pass V1 and U1 and post NOTHING, forever, which is the same
  -- outage as CRON-DRIFT-01 with the sign reversed. C1 is what refuses it.
  -- ⚠️ 127.0.0.1:9 — see the header. This is the one arm that can open a socket.
  INSERT INTO public.system_settings (key, value)
  VALUES ('analytics_service_url', 'http://127.0.0.1:9')
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  v_raised := false;
  v_state  := NULL;
  BEGIN
    PERFORM public.match_engine_cron_tick();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
  END;

  -- RED-UNDER: point the SETTINGS lookup at a key that does not exist —
  --            `WHERE s.key = 'analytics_service_url'` becomes
  --            `… = 'analytics_service_url_never'`. v_url is then NULL for
  --            EVERY caller, so the url guard fires unconditionally and the
  --            callable can never post at all. ⚠️ Deliberately NOT the VAULT
  --            lookup, though that is the symmetric edit: renaming the vault
  --            key makes the key guard fire during ARM U1 as well, and U1 —
  --            which runs first — would be the FIRST failure. MEASURED, see
  --            .planning/phases/164.7-…/164.7-02-NEUTER.log. This needle leaves
  --            V1 and U1 green (both are ASKING for a raise) and reddens C1
  --            alone. It also survives the migration's own STEP 3 body check,
  --            because `analytics_service_url_never` still contains
  --            `analytics_service_url`.
  -- RED-UNDER-M: {"arm":"C1","apply":[{"kind":"edit","file":"supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql","find":"WHERE s.key = 'analytics_service_url'","replace":"WHERE s.key = 'analytics_service_url_never'","occurrences":1}]}
  IF v_raised AND v_msg ~ 'missing from' THEN
    RAISE EXCEPTION 'TEST FAILED (C1): with BOTH the vault secret and the analytics_service_url row present, match_engine_cron_tick() still refused with: %. One of the two lookups is not finding a value that is demonstrably there — a renamed key, a mis-scoped WHERE, a search_path that resolves system_settings somewhere else — and the effect is a match engine that never runs while both guards report themselves as working. V1 and U1 cannot see this: they are both ASKING for a refusal.', v_msg;
  END IF;
  IF v_raised AND v_state NOT IN ('42883', '3F000') THEN
    RAISE EXCEPTION 'TEST FAILED (C1): the callable got past both guards and then failed with SQLSTATE % — %. The only failure tolerated at this point is the absence of pg_net (42883 undefined_function / 3F000 invalid_schema_name), which is the expected state on the pg-lane. Anything else is a real fault in the post itself and is being reported nowhere: net.http_post is fire-and-forget, so nothing downstream would ever notice.', v_state, v_msg;
  END IF;

  -- ===== ARMS C2/C3 — a FOREIGN url ⇒ the callable REFUSES, and does not ==
  -- =====               name the value it refused ==========================
  -- C2 is NOT a duplicate of U2. U2 asserts the CHECK constraint, which one
  -- ALTER TABLE removes without a migration and without review — this file just
  -- removed it, four statements above, with no more privilege than the CI role
  -- already had. C2 asserts the layer that is still standing at that point: the
  -- callable re-tests the SAME allow-list on the value it just read, immediately
  -- before building the header. Delete it and the whole destination control is
  -- one statement deep.
  UPDATE public.system_settings
     SET value = 'https://collector.attacker.example'
   WHERE key = 'analytics_service_url';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (C2-SETUP): there is no analytics_service_url row to point at a foreign host, so C2 and C3 below would be measuring the MISSING-ROW guard instead of the destination guard — a raise either way, and the two are indistinguishable from the pass/fail outcome alone. C1 inserted that row immediately above, so its absence means C1''s fixture did not land.';
  END IF;

  v_raised := false;
  v_msg    := NULL;
  BEGIN
    PERFORM public.match_engine_cron_tick();
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;

  -- RED-UNDER: stand the destination guard down — `IF v_url !~ c_url_allowed
  --            THEN` becomes `IF FALSE THEN`, which is the state this file was
  --            in before the constraint existed: the read still happens, the
  --            value is still the attacker's host, and the function sails into
  --            net.http_post carrying the live X-Service-Key to it. No layering
  --            needed — the migration's STEP 3 check 7 asserts the allow-list
  --            LITERAL is still in the body, and that literal is the DECLARE
  --            line, which this edit does not touch, so the apply still
  --            succeeds. ⚠️ Deliberately NOT a `sql` step dropping the
  --            constraint: this file has already dropped it, so such a step
  --            would mutate nothing and the arm could not redden.
  -- RED-UNDER-M: {"arm":"C2","apply":[{"kind":"edit","file":"supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql","find":"IF v_url !~ c_url_allowed THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF NOT v_raised OR v_msg !~ 'not an allowed destination' THEN
    RAISE EXCEPTION 'TEST FAILED (C2): with analytics_service_url set to a host outside the allow-list and the CHECK constraint dropped, match_engine_cron_tick() did not refuse by name — raised=%, message: %. The constraint is one ALTER TABLE from gone and this re-test is what is supposed to be left, so a green U2 beside a red C2 means the destination control has exactly one layer and it is the removable one. What follows is not a configuration nuisance: net.http_post is fire-and-forget, so the Vault-held service key leaves in an X-Service-Key header and NOTHING downstream ever reports where it went.', v_raised, COALESCE(v_msg, 'NULL');
  END IF;

  -- RED-UNDER: make the refusal ECHO the value — append `(%)', v_url` to the
  --            message. That is the tempting "helpful" edit under incident
  --            pressure and it is the one T-161.1-10 forbids: RAISE text lands
  --            in the cron job-run row and the Postgres log, so an
  --            attacker-chosen hostname gets written into every downstream
  --            reader of this project's logs by the guard that refused it.
  --            ⚠️ It leaves `not an allowed destination` in place, so C2 above
  --            stays GREEN and this arm is the first failure.
  -- RED-UNDER-M: {"arm":"C3","apply":[{"kind":"edit","file":"supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql","find":"read it with an admin session. Allowed: an https host under .up.railway.app';","replace":"read it with an admin session. Allowed: an https host under .up.railway.app (%)', v_url;","occurrences":1}]}
  IF v_msg ~ 'collector\.attacker\.example' THEN
    RAISE EXCEPTION 'TEST FAILED (C3): the destination refusal ECHOED the url it refused — it reads: %. The value in that row is attacker-controlled by construction (that is the whole premise of U2/C2), and RAISE text is not a private channel: it becomes the cron job-run row''s error and a Postgres log line, so the guard that refused the destination is the thing that publishes it to every reader of these logs. Name the SETTING, never its value — the same rule the two absence raises above follow (T-161.1-10). An operator who needs the value can SELECT it.', v_msg;
  END IF;

  -- ===== ARM R1 — anon reads NOTHING out of system_settings ==============
  -- Two layers, and this arm is satisfied only when BOTH hold: the table-level
  -- REVOKE from anon (which is why fixture 07 is in the apply list — on a
  -- vanilla cluster anon never had the grant and the REVOKE would be a no-op
  -- passing for a reason unrelated to the migration), and the deliberate
  -- ABSENCE of the scoped anon-readable policy system_flags carries for its
  -- kill switch.
  -- ⚠️ The count is read INSIDE a wrap: a table-level denial arrives as a bare
  -- `permission denied for table system_settings`, which carries no
  -- `TEST FAILED (…)` and would score NO-IDENTITY rather than a pass.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  SET LOCAL ROLE anon;
  v_cnt := -1;
  BEGIN
    SELECT count(*) INTO v_cnt FROM public.system_settings;
  EXCEPTION WHEN OTHERS THEN
    v_cnt := 0;
  END;
  RESET ROLE;

  -- RED-UNDER: hand anon BOTH layers back on the live lane — the table GRANT
  --            and a permissive SELECT policy of the shape system_flags really
  --            does carry (`system_flags_match_engine_public_read`). Two `sql`
  --            steps because both are needed: with only the GRANT, RLS still
  --            returns zero rows; with only the policy, the grant layer still
  --            refuses. That is the arm's whole claim, made executable.
  -- RED-UNDER-M: {"arm":"R1","apply":[{"kind":"sql","stmt":"GRANT SELECT ON public.system_settings TO anon"},{"kind":"sql","stmt":"CREATE POLICY ss_arm_r1 ON public.system_settings FOR SELECT TO anon USING (true)"}]}
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'TEST FAILED (R1): anon read % row(s) out of public.system_settings. Everything in that table is operator configuration, and the row that is in it names the host a live service key is POSTed to — an unauthenticated reader learns the internal analytics endpoint and, more usefully to them, learns that changing it is worth attempting. Both layers must be gone for this to happen: the migration''s REVOKE and the absence of any anon-visible policy. ⛔ Do NOT "fix" a red here by cloning system_flags'' scoped public-read policy — that policy exists for a kill switch the browser genuinely reads, and this table has no browser reader at all.', v_cnt;
  END IF;

  -- ===== ARM R2 — an authenticated NON-ADMIN cannot write ================
  v_uid := gen_random_uuid();
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_uid, '00000000-0000-0000-0000-000000000000',
          'ss-' || v_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (v_uid, 'ss', 'ss-' || v_uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  SELECT p.is_admin INTO v_admin FROM public.profiles p WHERE p.id = v_uid;
  IF v_admin IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (R2-SETUP): the profile this arm acts as reads is_admin = %, not false, so the UPDATE below would be an ADMIN''s update and R2 would be asserting the opposite of what it claims. Either profiles.is_admin stopped defaulting to false or this seed picked up an existing admin row.', COALESCE(v_admin::text, 'NULL');
  END IF;

  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
                     true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.system_settings SET value = 'r2-must-not-stick' WHERE key = 'analytics_service_url';
  EXCEPTION WHEN OTHERS THEN
    v_state := 'denied';
  END;
  RESET ROLE;
  SELECT s.value INTO v_val FROM public.system_settings s WHERE s.key = 'analytics_service_url';

  -- RED-UNDER: add, on the live lane, the permissive `TO authenticated` policy
  --            that system_settings_admin_all deliberately is NOT — the exact
  --            shape a later migration reaches for when someone wants "logged-in
  --            users can read settings" and writes FOR ALL by accident. A `sql`
  --            step rather than an edit of the admin policy''s predicate,
  --            because that predicate appears TWICE (USING and WITH CHECK) and
  --            weakening only one of them leaves the UPDATE rejected by the
  --            other — i.e. it would not redden the arm and would look like a
  --            non-biting annotation rather than a policy that still holds.
  -- RED-UNDER-M: {"arm":"R2","apply":[{"kind":"sql","stmt":"CREATE POLICY ss_arm_r2 ON public.system_settings FOR ALL TO authenticated USING (true) WITH CHECK (true)"}]}
  IF v_val = 'r2-must-not-stick' THEN
    RAISE EXCEPTION 'TEST FAILED (R2): an authenticated NON-ADMIN rewrote analytics_service_url. That row is the host public.match_engine_cron_tick() POSTs the analytics service key to, so this is not a configuration nuisance — it is any logged-in user redirecting a live secret to a collector of their choosing on the next tick (T-164.7-06). The is_admin conjunct in system_settings_admin_all is what stands here, and it must appear in BOTH the USING and the WITH CHECK arm.';
  END IF;

  -- ===== ARM R3 — the service role CAN write (the positive control) ======
  -- Without R3, a table that NOBODY can write satisfies both R1 and R2 — an
  -- operator surface that is broken in the safe direction still reads green,
  -- and the first person to discover it is whoever needs to change the URL
  -- during an incident.
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.system_settings SET value = 'r3-must-stick' WHERE key = 'analytics_service_url';
  EXCEPTION WHEN OTHERS THEN
    v_state := 'denied';
  END;
  RESET ROLE;
  SELECT s.value INTO v_val FROM public.system_settings s WHERE s.key = 'analytics_service_url';

  -- RED-UNDER: over-broaden the migration''s own anon hardening —
  --            `REVOKE ALL ON TABLE public.system_settings FROM anon;` becomes
  --            `… FROM anon, service_role;`, which is the realistic regression
  --            (a later hardening pass widening a REVOKE it did not re-read).
  --            The service path then fails at the GRANT layer, before RLS is
  --            consulted at all. ⚠️ Deliberately NOT `DROP POLICY
  --            system_settings_service_all`: service_role is BYPASSRLS on the
  --            pg-lane and on Supabase, so dropping its policy changes NOTHING
  --            and the arm cannot redden. MEASURED — see
  --            .planning/phases/164.7-…/164.7-02-NEUTER.log. R1 and R2 stay
  --            green under this edit: anon is still revoked and authenticated is
  --            untouched.
  -- RED-UNDER-M: {"arm":"R3","apply":[{"kind":"edit","file":"supabase/migrations/20260907120000_analytics_service_settings_and_vault_tick.sql","find":"REVOKE ALL ON TABLE public.system_settings FROM anon;","replace":"REVOKE ALL ON TABLE public.system_settings FROM anon, service_role;","occurrences":1}]}
  IF v_val IS DISTINCT FROM 'r3-must-stick' THEN
    RAISE EXCEPTION 'TEST FAILED (R3): the service role could NOT write analytics_service_url — the row still reads %. R1 and R2 are both satisfied by a table nobody can write, so without this arm a settings table that is inert reads exactly like one that is correctly locked down. The operator path this breaks is the only way the URL is ever changed: there is no admin route for it by design (see the migration header).', COALESCE(v_val, 'NULL');
  END IF;

  -- ===== ARM T1 — an authenticated user cannot TRUNCATE the table ========
  -- ⛔ THE ONE STATEMENT ROW SECURITY NEVER SEES. TRUNCATE is not subject to
  -- RLS, so system_settings_admin_all is not consulted for it and R1/R2/R3 are
  -- blind to it BY CONSTRUCTION rather than by oversight. Supabase's project
  -- bootstrap grants ALL on new public tables to anon, authenticated and
  -- service_role, and ALL includes TRUNCATE — so without the migration's
  -- REVOKE any logged-in user empties this table, after which every tick RAISES
  -- 'analytics_service_url missing from system_settings' and an operator spends
  -- the incident looking for a deleted row while the cause was a statement no
  -- policy evaluated. anon is already covered by `REVOKE ALL … FROM anon`;
  -- authenticated is the role that keeps its four RLS-scoped privileges and had
  -- to lose the three that are not scoped.
  --
  -- ⚠️ Runs LAST of the RLS/grant arms because, under its own twin, the TRUNCATE
  -- SUCCEEDS and empties the table. Placed earlier it would pull the ground out
  -- from under every arm after it and the run would report a cascade instead of
  -- one named failure.
  SELECT count(*) INTO v_cnt FROM public.system_settings;
  IF v_cnt = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (T1-SETUP): public.system_settings is ALREADY empty before this arm truncates anything, so a denied TRUNCATE and a permitted one leave identical state and T1 below would pass without asking its question. R3 wrote a row three statements ago; if it is gone, something between here and there deleted it.';
  END IF;

  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
                     true);
  SET LOCAL ROLE authenticated;
  v_state := NULL;
  BEGIN
    TRUNCATE public.system_settings;
  EXCEPTION WHEN OTHERS THEN
    v_state := 'denied';
  END;
  RESET ROLE;
  SELECT count(*) INTO v_cnt FROM public.system_settings;

  -- RED-UNDER: hand the privilege back on the live lane. A `sql` step and NOT
  --            an edit of the migration's REVOKE line, because that REVOKE
  --            names three privileges in one statement and weakening it by text
  --            invites a needle that removes REFERENCES or TRIGGER instead —
  --            neither of which this arm measures, so the annotation would look
  --            non-biting rather than wrong. ⚠️ Also deliberately NOT `GRANT ALL
  --            … TO authenticated`: that would restore REFERENCES and TRIGGER
  --            too, and an arm that reddens under a three-privilege grant does
  --            not tell you which one it was reading.
  -- RED-UNDER-M: {"arm":"T1","apply":[{"kind":"sql","stmt":"GRANT TRUNCATE ON public.system_settings TO authenticated"}]}
  IF v_state IS DISTINCT FROM 'denied' OR v_cnt = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (T1): an authenticated NON-ADMIN TRUNCATEd public.system_settings — the statement was % and the table now holds % row(s). RLS did not fail here and could not have: TRUNCATE is not subject to row security, so system_settings_admin_all was never consulted and R1, R2 and R3 all stay green through this. The consequence is not a lost configuration row: match_engine_cron_tick() then RAISES the MISSING-ROW message on every tick, which sends an operator to re-seed a setting while the actual cause was a privilege no policy governs. ⛔ Fix it at the grant layer — `REVOKE TRUNCATE, REFERENCES, TRIGGER … FROM authenticated` — never by adding a policy, which would change nothing.', COALESCE(v_state, 'permitted'), v_cnt;
  END IF;

  -- Leave the row as the migration seeded it. Cosmetic — the ROLLBACK below is
  -- what actually protects shared TEST — but it keeps a psql session that is
  -- read mid-transaction from showing a value no migration ever wrote.
  UPDATE public.system_settings SET value = v_seedurl WHERE key = 'analytics_service_url';

  RAISE NOTICE 'ALL 11 ARMS EXECUTED (0,V1,U1,U2,C1,C2,C3,R1,R2,R3,T1): public.match_engine_cron_tick() RAISES by name when the analytics_service_key secret is absent from the vault (V1) and when the analytics_service_url row is absent from system_settings (U1) — each measured by removing that value inside this transaction and calling the real function, never by inspecting its body — and gets PAST both guards when both are present (C1), which is what stops a callable that refuses unconditionally from passing V1 and U1 while posting nothing forever. The DESTINATION is bounded in two independent layers: public.system_settings will not STORE a url outside the allow-list (U2), and with that CHECK constraint dropped — one ALTER TABLE, which this file performs on itself — the callable still REFUSES to post to one (C2) without naming the value it refused (C3). public.system_settings is unreadable by anon at both the grant layer and the policy layer (R1), unwritable by an authenticated non-admin (R2), writable by the service role (R3), and not TRUNCATABLE by an authenticated user (T1) — the one statement row security never sees. So the host a live service key is POSTed to cannot be read, redirected or erased by anyone a browser can be. Phase 164.7 / criterion 2 / SC-2, mig 20260907120000.';
END $$;

ROLLBACK;
