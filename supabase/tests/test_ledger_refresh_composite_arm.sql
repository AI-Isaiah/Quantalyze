-- Test: public.enqueue_ledger_composite_refresh — the LEDGER-01 COMPOSITE refresh
-- arm. Guards migration 20260825140000_ledger_refresh_composite_arm.sql
-- (Phase 161.1 / D-01, D-11, D-12, D-13) AS SUPERSEDED BY
-- 20260907130000_ledger_refresh_switch_to_system_flags.sql (Phase 164.7 / D-01)
-- AND, IN TURN, BY
-- 20260911130000_ledger_fanout_grantees_and_dormancy.sql (Phase 164.8.6 /
-- 164.7-WR02, WR-10).
--
-- ⛔ WHICH FILE THE ARMS ACTUALLY MEASURE (Phase 164.7 plan 04, TRAP E / C-02;
-- RE-POINTED ONE MIGRATION FURTHER BY Phase 164.8.6 plan 03). This gate's apply
-- list ends with 20260911130000, so ITS `CREATE OR REPLACE` is the body running
-- under every arm below. A `CREATE OR REPLACE` does not alter the earlier
-- migrations' text — so a twin that still mutated 20260825140000, or
-- 20260907130000, would mutate a body that is overwritten before the first
-- assertion runs, apply cleanly, and report `no-red`: an arm that cannot fail,
-- inside the machine built to find arms that cannot fail. Every edit-kind twin
-- naming a fan-out BODY therefore names 20260911130000. The precedent is
-- test_sync_status_curated_sentence_survives.sql (164.2 plan 07).
--
-- ⭐ THE 164.8.6 RE-POINT WAS A FILE-PATH SWAP AND NOTHING ELSE, and that is a
-- MEASUREMENT, not a convenience. 20260911130000 re-bases both bodies from their
-- committed snapshots and changes four things per body — three DECLAREs, a
-- GET DIAGNOSTICS row-count read, one assignment inside the flag read's handler,
-- and the cause branch plus the instrument INSERT inside the dormant branch —
-- none of which falls inside any `find` below. All 12 `find` strings were
-- re-counted against the new file before the swap and every occurrence count
-- held. No `occurrences` or `nth` value moved.
--
-- ⚠️ EXACTLY TWO edit steps still name 20260825120000_ledger_refresh_staleness_
-- view.sql, and that is CORRECT, not an oversight: the D/precondition and
-- E1/precondition twins mutate the staleness VIEW, which neither 20260907130000
-- nor 20260911130000 redefines. A view that is not superseded is not dead text.
--
-- ⚠️ AND WHY SEVERAL TWINS CARRY `"occurrences":2,"nth":2`. 20260911130000, like
-- 20260907130000 before it, holds BOTH fan-out bodies (single-key first,
-- composite second), so needles that were unique in the 20260825140000 file —
-- `INTERVAL '20 hours'`, `WHERE lrs.is_stale` — match TWICE. `nth: 2` is the
-- COMPOSITE body, measured: the single-key `CREATE OR REPLACE` precedes the
-- composite one in that file. If the two are ever reordered, `nth: 2` mutates
-- the single-key body, this gate does not redden and the runner reports
-- `no-red` — loudly. The three activation-guard twins (A, K, L) do NOT use
-- `nth`: their needles span a line naming this function, so they are unique by
-- construction. The two instrument twins (M1, M2) DO use `nth`, for the same
-- reason and with the same measurement: their cause literal is assigned once per
-- body, so it occurs twice in the file and `nth: 2` is the composite body.
--
-- What makes this gate worth having: MATCHED PAIRS
-- ------------------------------------------------
-- A bound is only proven by two arms pulling in opposite directions. Without the
-- POSITIVE arm, a body that enqueues NOTHING passes every negative arm here — and
-- five of the eight arms below ARE negatives. Without the NEGATIVE arms, a body
-- that enqueues EVERY composite passes the positive one. Only the pair pins a
-- predicate that both exists and is not over-tight.
--
-- ⛔ THE ARM THIS FILE EXISTS FOR IS ARM D. `is_composite = TRUE` is the SOLE
-- conjunct partitioning this arm's cohort from the single-key arm's
-- (20260825130000), and arm D is the only thing that pins it. It is meaningful
-- ONLY if the single-key fixture it seeds clears EVERY OTHER conjunct — so arm D
-- asserts those facts about its own fixture BEFORE it asserts the exclusion. An
-- arm that is green because the row was stale-but-lifecycle-dead proves nothing,
-- and the mandated is-composite neutering would not fire against it.
--
-- Arms:
--   A  DORMANCY, MISSING ROW   — no public.system_flags row for the activation
--      (LEDGER-02)               key ⇒ returns 0, inserts 0. The arm that says
--                                merging changes no production behaviour, and
--                                164.7 C-03's pinned REJECTION of the fail-OPEN
--                                missing-row branch in send-intro/route.ts.
--   K  DORMANCY, ROW FALSE     — the row exists and is FALSE ⇒ returns 0.
--   L  DORMANCY, READ RAISES   — the flag read itself fails ⇒ returns 0 AND does
--                                not propagate the error.
--
--   ⭐ WHY THREE ARMS AND NOT ONE. A, K and L are three different failure
--   surfaces of ONE guard, and no single mutation reddens all three — which is
--   the operational proof that they are not redundant. A's twin (`IS NOT NULL
--   AND …`) opens on NULL and leaves K green; K's twin (`IS NULL AND …`) opens
--   on FALSE and leaves A green; L's twin (the handler assigns TRUE instead of
--   NULL) leaves both A and K green.
--
--   ⚠️ The key is the SAME one the single-key arm reads, so these three arms and
--   their siblings in test_ledger_refresh_fanout.sql are proving the property
--   that ONE reset kills BOTH arms — measured twice, once per function, because
--   a guard is per-body and a shared key does not make a shared body.
--   B  POSITIVE (LEDGER-01)    — setting on ⇒ exactly one strategy-scoped
--                                stitch_composite job, every other target NULL,
--                                metadata source EQUAL to the composite marker,
--                                return value 1.
--   C  NEGATIVE CONTROL        — a FRESH composite is NOT enqueued. Without this
--                                arm a body that enqueues every composite passes B.
--   D  SINGLE-KEY EXCLUSION    — a stale single-key strategy that clears every
--                                OTHER conjunct is NOT enqueued. With arm D of
--                                test_ledger_refresh_fanout.sql this pins that the
--                                two functions PARTITION the cohort rather than
--                                overlapping it.
--   E  MEMBER-VENUE EXCLUSION  — D-01/D-13, two sub-cases: a MIXED composite (one
--                                member on the deferred venue, one not) and an
--                                ALL-deferred composite. Both are the founder's
--                                deferral made testable.
--   F  DEDUPE                  — a second tick adds nothing while a job is in flight.
--   G  COOLDOWN                — an attempt 2 h ago blocks; aged past 20 h, unblocks.
--                                Both edges, so the interval cannot drift silently.
--   H  BURST CAP               — 5 stale eligible composites, one tick, bounded.
--   I  ACL durability (F-1)  — anon/authenticated cannot EXECUTE the composite
--                             arm. Mirrors the apply-time DO block, which runs
--                             once and can be silently undone afterwards. That
--                             REVOKE is the SOLE bound: under `authenticated`
--                             both NOT EXISTS guards go vacuously TRUE.
--   J  OWNER durability (F-2) — the SECURITY DEFINER owner is still exempt from
--                             row security. Same run-once weakness as I, one
--                             property over: ownership drift makes every tick
--                             enqueue ZERO, which no other arm can see because
--                             each of them seeds its own fixtures.
--
-- ⚠️ sfox is deliberately UNEXERCISED here, as everywhere in this phase: it has
-- ZERO strategies in PROD, so its arm ships unexercised by construction. It stays
-- in the refresh set because criterion 4 pins the venue SET, and no arm in this
-- file may assert that it produces work.
--
-- ⚠️ Venue literals appear in the FIXTURES only. The function under test declares
-- none — it reads its cohort from public.ledger_refresh_staleness, the single SQL
-- home of the set (D-05). A fixture naming a venue is a fixture; a production
-- predicate naming one is a second drift surface.
--
-- SERIAL execution: the function takes a SESSION advisory lock, so a concurrent
-- holder would make it skip and redden the positive arms for the wrong reason. The
-- repo already runs supabase/tests/*.sql one file at a time; keep it that way.
--
-- TABLE-SCOPED activation (164.7 D-01, replacing the session-scoped setting).
-- The function no longer reads an `app.`-namespace database setting — an
-- operator on this platform is refused 42501 when setting one (MEASURED on PROD
-- 2026-09-05) — it reads public.system_flags. So this ONE file exercises the
-- dormant and the active arms by WRITING that table inside the surrounding
-- transaction: arm A deletes the row, arm K sets it FALSE, arm L renames the
-- table out from under the read, and the activation before arm B upserts TRUE.
-- Every one of those writes rolls back with the file's closing ROLLBACK.
--
-- ⚠️ On the SHARED test project that is a write to a COMMITTED row, and the D-05
-- caution in this file applies to it: the row is locked until ROLLBACK, so a
-- concurrent session UPDATING the same key blocks for the length of this file. It
-- is one global config row, not another PR's fixture, and MVCC leaves concurrent
-- READERS on the pre-transaction value — but it is a write, so it is written down
-- here rather than left to be discovered. What this file must NEVER do is COMMIT
-- one: the precondition below ABORTS on a committed TRUE row instead of flipping
-- it.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed assertion
-- exits non-zero. The whole test rolls back.
--
-- ⛔ AN ABSENT FUNCTION IS A HARD FAILURE, NEVER A SKIP (161.1-REVIEW WR-03)
-- --------------------------------------------------------------------------
-- This file used to open with `RAISE NOTICE 'SKIP: …'; RETURN;` when the composite
-- function was absent. MEASURED 2026-08-25 against an empty Postgres 16: that path
-- printed the notice and exited `EXITCODE=0` having executed ZERO of arms A-I. The
-- CI step (.github/workflows/ci.yml, `sql-tests` → "Run SQL self-tests against
-- test Supabase project") reads ONLY that exit code, so the skip was
-- byte-identical to a pass in the only channel anything mechanical looks at — and
-- it was GUARANTEED to fire on the one run that matters most: the PR that
-- introduces migration 20260825140000.
--
-- Why the skip was removed rather than made louder. MEASURED, not assumed:
--   * the `sql-tests` job has NO migration-apply step. It checks out, installs
--     psql, runs the meta-command preflight, takes the shared-test-db mutex, and
--     `psql -f`s each file. Nothing puts supabase/migrations/** on the TEST
--     project first.
--   * .github/workflows/supabase-migrate.yml applies migrations to the PRODUCTION
--     project only (`vars.SUPABASE_PROJECT_REF`), on push to main. No workflow, npm
--     script or Makefile target applies them to the TEST project; TODOS.md records
--     TEST being migrated by hand (Supabase MCP `apply_migration`) instead.
--   So the old comment's promise — "assertions enforce once the test DB catches
--   up" — named a mechanism that DOES NOT EXIST. Nothing would ever have armed
--   this file on its own.
-- A NOTICE cannot reach CI's only channel; an exception can. The two outcomes are
-- now distinguishable where they are actually read.
--
-- The consequence is deliberate and IS the forcing function: this file is RED
-- until the phase's migrations are applied to the TEST project. Arms D and E are
-- the ONLY executed proof of the two exclusions this arm exists for — the
-- single-key partition and the deferred-venue exclusion (D-01/D-13) — and the
-- `is_composite = FALSE` conjunct in the SINGLE-KEY function is falsifiable only
-- by arm D of the sibling fan-out gate. A skip meant both exclusions reached PROD
-- with their predicates never executed anywhere but an executor's laptop.
--
-- ✅ MECHANICALLY CLOSED (161.1-REVIEW WR-03 option (b), landed in
-- .github/workflows/ci.yml): the `sql-tests` step now captures each file's output,
-- fails on a printed 'SKIP:', and reads the 'ALL 15 ARMS EXECUTED' sentinel back off
-- THIS file's RAISE NOTICE line and requires the run to have printed it. So an
-- edit that neuters an arm in place — deleting the assertion, short-circuiting
-- early — fails CI even though psql exits 0. ⚠️ The count in that notice is read
-- from the file, not hard-coded: if you add or remove an arm you MUST update it,
-- or the pin silently measures the wrong number of arms.
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4). Each prose RED-UNDER above an arm
-- below carries an adjacent `RED-UNDER-M` object that scripts/mutation-runner
-- executes on every push: it mutates COPIES, requires the FIRST `TEST FAILED (…)`
-- to name that arm, and restores GREEN. The schema is scripts/mutation-runner/
-- GRAMMAR.md. The line below declares what the lane applies before this gate. It
-- was DISCOVERED, not guessed — plan 164.4-00 iterated it 8 times on a throwaway
-- pg-lane cluster. ⚠️ 04-fixture-compute-jobs-targets.sql sits BETWEEN two
-- migrations on purpose: it patches compute_jobs, which 20260411144407 creates.
--
-- ⭐ PHASE 164.7 plan 04 added TWO entries, and the ORDER of both is load-bearing:
--   * `31-fixture-system-flags.sql` sits IMMEDIATELY BEFORE 20260825130000.
--     public.system_flags is created by 20260407164606_perfect_match.sql, which
--     cannot enter any apply list (it reads auth.users, FKs onto `strategies`
--     and creates four unrelated tables), so the lane needs the stand-in. It
--     must precede 20260907130000, whose STEP 1 INSERTs into that table; the
--     placement mirrors the sibling fan-out gate's list exactly. It carries NO
--     seed row, which is what leaves arm A's missing-row case testable. It is a
--     stand-in, so no twin may target it (GRAMMAR rule 4).
--   * `20260907130000_ledger_refresh_switch_to_system_flags.sql` was applied
--     LAST, because its `CREATE OR REPLACE` had to be the definition the arms
--     run against. ⚠️ IT NO LONGER IS — see the 164.8.6 entries below. It stays
--     in the list because it SEEDS the activation row at apply time, which is
--     the state arms A and K describe.
-- ⭐ PHASE 164.8.6 plan 03 added TWO MORE, and the ORDER of both is load-bearing:
--   * `33-fixture-cron-runs.sql` sits IMMEDIATELY BEFORE the new migration, the
--     way 31-fixture-system-flags.sql sits before its reader above. Both bodies
--     in 20260911130000 WRITE public.cron_runs on the dormant-with-an-INVISIBLE-
--     cause path, and the real creator, 20260408113029_cron_heartbeat.sql,
--     cannot enter this list: its cron_runs_admin_read policy resolves
--     profiles.is_admin (fixture 12) and its cron_runs_service_role policy
--     resolves auth.role() (fixture 15), and NEITHER fixture is in this list, so
--     CREATE POLICY — which resolves its columns and functions at declaration
--     time — aborts the apply on 42703 before any arm runs. The fixture is a
--     stand-in, so no twin may target it (GRAMMAR rule 4).
--   * `20260911130000_ledger_fanout_grantees_and_dormancy.sql` is applied LAST,
--     for exactly the reason 20260907130000 used to be: its `CREATE OR REPLACE`
--     is the definition every edit-kind twin below now names. Leaving those 12
--     twins pointed at 20260907130000 the moment this entry was appended would
--     have made all 12 mutate dead text and report `no-red` in one commit —
--     TRAP E / C-02 again, one migration later. That is why plan 03 exists.
-- Proven on the 12-entry list this file carried through Phase 164.7 (LINEAGE,
-- not a live reading): the completion notice below printed with its full roster
-- A-L, and the runner reported `per-arm lane time: mean 1.1s` over three
-- separate diagnostic runs of this file (MEASURED 2026-09-07; the pre-164.7
-- reading was 1.01 s over the 10-entry list, so the two extra apply entries cost
-- nothing measurable).
-- ⚠️ The sentinel string itself is deliberately NOT repeated in this header:
-- this file's own verify pins it to exactly ONE occurrence, so that the roster
-- can only be edited where it is RAISED.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql","scripts/pg-lane/fixtures/31-fixture-system-flags.sql","supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","supabase/migrations/20260825140000_ledger_refresh_composite_arm.sql","supabase/migrations/20260907130000_ledger_refresh_switch_to_system_flags.sql","scripts/pg-lane/fixtures/33-fixture-cron-runs.sql","supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql"]}
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_ledger_refresh_composite_arm.sql

BEGIN;

DO $$
DECLARE
  uid          UUID := gen_random_uuid();
  k_led        UUID;  -- eligible key, ledger venue that is NOT the deferred one
  k_led_b      UUID;  -- second key on the same venue (composites need >= 2 members)
  k_defer      UUID;  -- eligible key on the DEFERRED venue (arm E)
  k_defer_b    UUID;
  k_revoked    UUID;  -- ineligible member key (arm B's partial-disconnect probe)
  s_b          UUID;  -- arms A / B / F: maximally stale, eligible COMPOSITE
  s_c          UUID;  -- arm C: FRESH composite
  s_d          UUID;  -- arm D: stale SINGLE-KEY, clears every conjunct but is_composite
  s_e_mixed    UUID;  -- arm E1: one deferred-venue member + one not
  s_e_all      UUID;  -- arm E2: every member on the deferred venue
  s_g          UUID;  -- arm G: stale composite attempted 2 h ago
  h_set        UUID[];-- arm H: 5 stale eligible composites
  v_ret        INTEGER;
  v_cnt        INTEGER;
  v_strat      UUID;
  v_port       UUID;
  v_alloc      UUID;
  v_api        UUID;
  v_source     TEXT;
  v_foreign    INTEGER;
  v_stale      BOOLEAN;
  v_comp       BOOLEAN;
  v_defer      BOOLEAN;
  v_status     TEXT;
  v_own_role   TEXT;     -- arm J: proowner of the fan-out …
  v_own_bypass BOOLEAN;  -- arm J: … and the two independent routes by which
  v_own_super  BOOLEAN;  -- arm J: … that role may be exempt from row security
  sid          UUID;
  -- ⛔ Arms K and L, and arm 0's applied-ness probe, add three more. plpgsql
  --    compiles this DO block WHOLE: a missing DECLARE raises 42601 and NONE of
  --    arms A-L run, so the file would assert nothing while failing on a message
  --    that names no arm. Adding an arm means adding its DECLAREs in the same edit.
  v_flag       BOOLEAN;  -- the COMMITTED activation row, read by the precondition
  v_ret_l      INTEGER;  -- arm L: survives its subtransaction's rollback
  v_body       TEXT;     -- arm 0: the comment-stripped body of the composite arm
  -- ⛔ Arms M1, M2 and S1 (Phase 164.8.6 plan 03) add four more under the SAME
  --    rule: a missing DECLARE is a 42601 that stops the WHOLE block compiling,
  --    so every arm would vanish together.
  v_cnt_m1     INTEGER;  -- arm M1: instrument rows naming the missing-row cause
  v_cnt_m2     INTEGER;  -- arm M2: … and the raising-read cause. Like v_ret_l it
                         --         survives arm L's P0164 rollback; the ROW it
                         --         counts does not, which is why it is read
                         --         inside that block and asserted after it.
  v_grantees   TEXT;     -- arm S1: the WHOLE EXECUTE grantee set, comma-joined
  v_owner_name TEXT;     -- arm S1: … and the owner name it must equal exactly
BEGIN
  -- ----- applied-ness gate: ABSENCE IS A FAILURE, NOT A SKIP (WR-03) ------
  -- See the ⛔ block in this file's header for the measurement behind this.
  -- RED-UNDER: DROP the function on the live lane after the migrations have
  --            applied — cause (ii) of this arm's own message. It is a `sql`
  --            step rather than a migration edit because renaming the CREATE in
  --            20260825140000 aborts that migration's OWN verification block
  --            ("enqueue_ledger_composite_refresh missing"), so the gate would
  --            never run and no arm could be the first failure.
  -- RED-UNDER-M: {"arm":"0","apply":[{"kind":"sql","stmt":"DROP FUNCTION public.enqueue_ledger_composite_refresh()"}]}
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'enqueue_ledger_composite_refresh'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED (0): public.enqueue_ledger_composite_refresh is not registered on this database, so NONE of arms A-L ran — including arms D and E, the only executed proof of the single-key partition and the deferred-venue exclusion (D-01/D-13). This is a FAILURE, not a skip. TWO causes fit and this assertion cannot distinguish them, so check both: (i) the TEST project has not received migration 20260825140000 — apply the phase''s migrations to it and re-run; expect this exactly once, on the PR that introduces them, because NO workflow applies migrations to TEST; (ii) the function was DROPPED or RENAMED after being applied, which is a real regression in a SECURITY DEFINER cross-tenant enqueue path. ⛔ Do NOT "fix" this by restoring the old RAISE NOTICE/RETURN skip: that made this file exit 0 having asserted nothing, on exactly the run where this function first reaches PROD.';
  END IF;

  -- ----- and the body running here is the ONE THE ARMS DESCRIBE ------------
  -- Cause (iii): the function exists, but it is the PRE-164.7 body that reads
  -- the retired `app.`-namespace database setting. Every arm below would then be
  -- measuring a body that no longer exists in the repo — arms A/K/L would fail
  -- for reasons that have nothing to do with the guard they name, and a shared
  -- TEST project would report them as coupling regressions instead of as a
  -- missing apply. This check names the un-applied migration precisely.
  --
  -- ⚠️ Comment-stripped, and not optionally — for the two reasons that are TRUE
  -- rather than the tidier one that is not. It would read well to say
  -- 20260907130000's body prose would satisfy an unstripped match; that claim is
  -- FALSE and was MEASURED false in both bodies — `FROM public.system_flags`
  -- occurs exactly ONCE, in CODE, and ZERO times in any comment. The reasons
  -- that hold:
  --   (i)  lint rule R2-functiondef-comment-strip mandates the idiom BY RULE for
  --        any regex over a pg_get_functiondef result. The rule was written
  --        against a divergence measured on a DIFFERENT body — PROD's 7-param
  --        `_enqueue_compute_job_internal` — not against this one;
  --   (ii) the property must keep holding under FUTURE comment edits that nobody
  --        re-measures. One sentence added to that body's Lock B block quoting
  --        the needle would make this probe unfalsifiable, silently.
  --
  -- ⚠️ RESIDUAL neither this site nor its sibling used to state, and it is the
  -- FALSE-PASS direction: `--[^\n]*` does not strip `/* … */`. A block comment
  -- quoting the needle satisfies this probe with the read gone. Neither body
  -- uses one today (measured: 0 occurrences of `/*`). The opposite direction is
  -- safe by construction — a `--` inside a string literal makes the strip eat
  -- real code, which can only cause a FALSE FAILURE, and a false failure is loud.
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
    INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'enqueue_ledger_composite_refresh';
  IF v_body IS NULL OR v_body !~ 'FROM public\.system_flags' THEN
    RAISE EXCEPTION 'TEST FAILED (0): public.enqueue_ledger_composite_refresh exists on this database but its executable body does not read the activation flag from public.system_flags, so it is the PRE-164.7 revision that reads the retired app-namespace database setting. Arms A, K and L below describe the table-backed fail-closed guard and would measure something else entirely. Cause (iii): migration 20260907130000_ledger_refresh_switch_to_system_flags.sql has not been applied to THIS database. Apply it and re-run. ⛔ Do NOT relax this check to match either body: the two guards fail closed for different reasons, and a gate that accepts both cannot tell an un-applied migration from a regression.';
  END IF;

  -- ----- and the body carries the DORMANCY INSTRUMENT the M arms read -------
  -- Cause (iv), added by Phase 164.8.6 plan 03. The function exists and reads
  -- the activation table, but it is the 164.7 revision whose dormant branch
  -- raises a NOTICE and writes NOTHING. Arms M1 and M2 below count instrument
  -- rows, so without this check their `expected exactly 1` reads as "the
  -- instrument is broken" on exactly the run where the truth is "20260911130000
  -- has not reached this database yet" — the same mis-diagnosis cause (iii)
  -- exists to prevent, one migration later. Same v_body, same comment strip,
  -- same R2 reasoning as the check above; no second pg_get_functiondef read.
  IF v_body !~ 'INSERT INTO public\.cron_runs' THEN
    RAISE EXCEPTION 'TEST FAILED (0): public.enqueue_ledger_composite_refresh reads the activation flag but its executable body never writes the dormancy instrument row, so it is the 164.7 revision whose dormant branch cannot distinguish "the row says FALSE, as designed" from "the row is absent or invisible to this definer while the platform believes itself live". Arms M1 and M2 below would then fail with a count of 0 and read as a broken instrument rather than as a missing apply. Cause (iv): migration 20260911130000_ledger_fanout_grantees_and_dormancy.sql has not been applied to THIS database. Apply it and re-run; expect this exactly once, on the PR that introduces it, because migrations reach TEST only on merge.';
  END IF;

  -- ----- precondition: the switch must not be COMMITTED OPEN here -----------
  -- ⚠️ STATED PRECISELY, because the imprecise version is the tempting one.
  -- This is NOT an anti-vacuity guard for arm A. MEASURED (this plan's neuter
  -- N3): with a committed TRUE row and this check downgraded to a NOTICE, the
  -- file still runs and every arm still passes — because arm A DELETEs the row
  -- and arm K UPSERTs it FALSE, so each dormant arm now builds the state it
  -- measures. The pre-164.7 arm A did not: it read a SESSION setting it never
  -- set, so a session that already had the setting on made it vacuous, and this
  -- check was that arm's anti-vacuity guard. The rewrite moved the state into
  -- the arm and the guard's job changed with it. Do not restore the old claim.
  --
  -- What it DOES guard, and why it is still here:
  --   * a COMMITTED TRUE row means an operator has opened the ledger refresh on
  --     this database. This file would then DELETE and re-UPSERT that live row
  --     inside its transaction, holding a row lock on it for the file's whole
  --     length on a SHARED project, and would print "the composite refresh arm
  --     is dormant" about a database where it is LIVE. Both are things a human
  --     must be told, not things a test should quietly work around.
  --   * ⛔ AND IT MUST NOT WRITE ITS WAY OUT. Silently forcing the row back to
  --     FALSE would undo a live activation; doing so inside a rolled-back
  --     transaction would leave the operator's row untouched while this file
  --     reported a dormancy it had manufactured. Abort, and make a human read it.
  --
  -- `TEST ABORTED` is deliberately NOT a `TEST FAILED (…)` identity: no arm
  -- claims this, and the mutation runner must not be able to attribute it.
  SELECT enabled INTO v_flag
    FROM public.system_flags
   WHERE key = 'ledger_refresh_enabled';
  IF v_flag IS TRUE THEN
    RAISE EXCEPTION 'TEST ABORTED: the COMMITTED public.system_flags row for ledger_refresh_enabled is TRUE on this database, so the ledger refresh is LIVE here. This file writes that row (arm A deletes it, arm K sets it FALSE, the activation sets it TRUE) inside its transaction, so running it would hold a lock on an operator''s live row for the length of the file on a SHARED project, and would print a dormancy notice about a database that is not dormant. Never UPDATE a committed row from a test on a shared project — find out why the switch is open before running this file. If this is the TEST project and the activation was accidental, close it deliberately in its own session.';
  END IF;

  -- ----- FOREIGN-CANDIDATE PRECONDITION (read-only) -----------------------
  -- Arm H measures a GLOBAL bound — the per-tick burst cap is global — so a
  -- pre-existing eligible COMPOSITE on this database would compete for those slots
  -- and make the count wrong.
  --
  -- ⛔ It is NOT acceptable to solve that by parking those rows. supabase/tests run
  -- against ONE SHARED test project concurrently with other PRs, and an UPDATE
  -- touching rows this block did not seed writes across another PR's live fixture
  -- mid-run: the surrounding ROLLBACK hides that from the WRITER, not from a
  -- concurrent READER, and the failure then surfaces in a completely different
  -- file. That is the D-05 hazard
  -- (analytics-service/tests/test_sql_gate_scoped_updates.py) and this file will
  -- not create a second instance of it on a neighbouring table.
  --
  -- So: measure, and fail LOUD. A concurrent PR's fixtures are uncommitted and
  -- therefore invisible here, so a non-zero count means the test project carries
  -- COMMITTED ledger-backed composites that are stale and live — a standing
  -- property of the project that a human should look at.
  SELECT count(*) INTO v_foreign
    FROM public.ledger_refresh_staleness lrs
    JOIN public.strategies s ON s.id = lrs.strategy_id
   WHERE lrs.is_stale
     AND lrs.is_composite
     AND NOT lrs.has_mt5_member
     AND s.status IN ('published', 'pending_review');
  IF v_foreign <> 0 THEN
    RAISE EXCEPTION 'TEST PRECONDITION FAILED: % committed composite(s) on this database are already stale, live and ledger-backed. They would compete with this file''s fixtures for the global per-tick burst cap and make arm H measure the wrong thing. Park or clean them in the test project — do NOT make this file update rows it did not seed (D-05: shared project, concurrent PRs).', v_foreign;
  END IF;

  -- ----- SEED --------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'lrc-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'lrc', 'lrc-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'deribit', 'lrc a', 'x', TRUE) RETURNING id INTO k_led;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'deribit', 'lrc b', 'x', TRUE) RETURNING id INTO k_led_b;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'lrc deferred a', 'x', TRUE) RETURNING id INTO k_defer;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'lrc deferred b', 'x', TRUE) RETURNING id INTO k_defer_b;
  -- A REVOKED member key. Used only inside arm B's composite, to prove the
  -- member-health conjunct requires ANY eligible member rather than ALL of them —
  -- see the assertion at the end of arm B.
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, sync_status)
  VALUES (uid, 'deribit', 'lrc revoked', 'x', TRUE, 'revoked') RETURNING id INTO k_revoked;

  -- Every fixture is seeded PARKED ('draft'), and each arm un-parks exactly the
  -- fixtures it is about. Lifecycle is the parking lever precisely because no arm
  -- here tests it, so parking cannot mask the conjunct any arm is measuring.
  --
  -- ⚠️ A COMPOSITE has api_key_id NULL and reaches its venue only through
  -- strategy_keys — the two links are mutually exclusive
  -- (finalize-wizard/route.ts:1177, 1388-1392). A composite fixture written with
  -- api_key_id set would not be a composite.
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, NULL, 'lrc B', 'draft') RETURNING id INTO s_b;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, NULL, 'lrc C', 'draft') RETURNING id INTO s_c;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, NULL, 'lrc E1', 'draft') RETURNING id INTO s_e_mixed;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, NULL, 'lrc E2', 'draft') RETURNING id INTO s_e_all;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, NULL, 'lrc G', 'draft') RETURNING id INTO s_g;

  -- ⛔ Arm D's fixture: a SINGLE-KEY strategy — api_key_id SET, and ZERO
  -- strategy_keys rows. It is seeded on the same NON-deferred ledger venue and
  -- given the same century-old series as every other fixture, so it clears the
  -- staleness, member-venue, lifecycle, cooldown and in-flight conjuncts and
  -- passes the member-health conjunct VACUOUSLY (that conjunct's first half is
  -- true for a member-less row, by design). `is_composite` is the only thing
  -- standing between it and the enqueue. Arm D re-measures those facts before it
  -- asserts anything.
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led, 'lrc D', 'draft') RETURNING id INTO s_d;

  -- Arm B's composite: TWO members, one eligible and one REVOKED. That mix is
  -- deliberate — see arm B's closing assertion.
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_b, k_led,     uid, CURRENT_DATE - 400, 0);
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_b, k_revoked, uid, CURRENT_DATE - 200, 1);

  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_c, k_led,   uid, CURRENT_DATE - 400, 0);
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_c, k_led_b, uid, CURRENT_DATE - 200, 1);

  -- Arm E1 — MIXED: one member on the deferred venue, one not. The composite is
  -- otherwise fully eligible, so only the membership conjunct can exclude it.
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_e_mixed, k_led,   uid, CURRENT_DATE - 400, 0);
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_e_mixed, k_defer, uid, CURRENT_DATE - 200, 1);

  -- Arm E2 — ALL members on the deferred venue.
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_e_all, k_defer,   uid, CURRENT_DATE - 400, 0);
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_e_all, k_defer_b, uid, CURRENT_DATE - 200, 1);

  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_g, k_led,   uid, CURRENT_DATE - 400, 0);
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_g, k_led_b, uid, CURRENT_DATE - 200, 1);

  -- Arm H: 5 stale eligible composites, each with one eligible member.
  WITH ins AS (
    INSERT INTO strategies (user_id, api_key_id, name, status)
    SELECT uid, NULL, 'lrc H ' || g, 'draft' FROM generate_series(1, 5) g
    RETURNING id
  ) SELECT array_agg(id) INTO h_set FROM ins;
  FOREACH sid IN ARRAY h_set LOOP
    INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
    VALUES (sid, k_led, uid, CURRENT_DATE - 400, 0);
  END LOOP;

  -- Analytics rows. STALE = a returns_series whose newest date is far past the
  -- 4-day threshold; FRESH = yesterday. Both use the success status the whole live
  -- ledger cohort actually carries (D-04) — a fixture written as 'complete' would
  -- test a status no live ledger row has.
  --
  -- ISOLATION BY CONSTRUCTION, belt to the precondition's braces: the stale
  -- fixtures are dated a CENTURY back, so they outrank any plausible foreign row
  -- under the function's ORDER BY last_return_date ASC and take the bounded slots
  -- first. Same idiom, and the same reason, as the reaper gate's century-old seeds
  -- (Phase 142.1 / D-05).
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  SELECT s, 'complete_with_warnings', now(),
         jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 36500, 'YYYY-MM-DD'), 'value', 0.001))
    FROM unnest(ARRAY[s_b, s_d, s_e_mixed, s_e_all, s_g] || h_set) AS s;

  -- Arm C's negative control: genuinely fresh, so is_stale is FALSE.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  VALUES (s_c, 'complete_with_warnings', now(),
          jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 1, 'YYYY-MM-DD'), 'value', 0.004)));

  -- Arm G's prior ATTEMPT: terminal (so the in-flight conjunct is not what is being
  -- measured), created 2 hours ago (so the 20-hour cooldown is).
  INSERT INTO compute_jobs (strategy_id, kind, status, created_at)
  VALUES (s_g, 'stitch_composite', 'done', now() - INTERVAL '2 hours');

  RAISE NOTICE 'Seed OK.';

  -- ======================================================================
  -- ARM A — DORMANCY, MISSING ROW (LEDGER-02 / 164.7 C-03). There is NO
  -- public.system_flags row for the activation key. A maximally stale, fully
  -- eligible composite is on the table and the function must still do NOTHING.
  --
  -- This is the arm that says "merging this migration changes no production
  -- behaviour", and it is ALSO the pinned rejection of the fail-OPEN
  -- missing-row branch in src/app/api/admin/match/send-intro/route.ts. That
  -- route treats `flagRow === null` as ENABLED, which is right for a kill
  -- switch defaulting ON and WRONG here: this is a dormant-by-default
  -- activation switch, so its absent state must be its closed state.
  --
  -- The DELETE runs inside the surrounding transaction and unwinds with the
  -- closing ROLLBACK. It is deliberately a DELETE and not "just don't seed the
  -- row": migration 20260907130000 SEEDS the row at apply time, so on any
  -- database where that migration has run the row EXISTS, and the missing-row
  -- state has to be created to be tested.
  -- ======================================================================
  -- RED-UNDER: make the fail-closed activation guard in 20260911130000's
  --            COMPOSITE body NULL-UNSAFE — `IF v_enabled IS NOT NULL AND
  --            v_enabled IS DISTINCT FROM TRUE THEN`. A missing row leaves
  --            v_enabled NULL, the IF is no longer taken, and the body falls
  --            THROUGH to the fan-out instead of returning 0.
  -- ⚠️ WHY NOT the crude `IS DISTINCT FROM TRUE` -> `= FALSE` swap. MEASURED
  --    (164.7-03 neuter N1(a)): that removes the token 20260911130000's OWN
  --    verification block checks for at apply time — check 6, which LOOPS over
  --    both function names, so the composite body is checked exactly as the
  --    single-key one is. The migration would ABORT, the gate would never run,
  --    and no arm could be the first failure.
  -- ⚠️ This twin ALSO reddens arm L (a raising read leaves v_enabled NULL too).
  --    Arm A executes FIRST, so the file's first failure is A and the identity
  --    is correct. A reorder putting L ahead of A would report
  --    `wrong-first-failure: L` — the runner working, not a bug.
  -- ⚠️ The needle spans the NOTICE line, which names THIS function, so it is
  --    unique in a file holding both fan-out bodies. No `nth` is needed or used.
  -- RED-UNDER-M: {"arm":"A","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"IF v_enabled IS DISTINCT FROM TRUE THEN\n    RAISE NOTICE 'enqueue_ledger_composite_refresh: dormant","replace":"IF v_enabled IS NOT NULL AND v_enabled IS DISTINCT FROM TRUE THEN\n    RAISE NOTICE 'enqueue_ledger_composite_refresh: dormant","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id = s_b;

  DELETE FROM public.system_flags WHERE key = 'ledger_refresh_enabled';

  v_ret := public.enqueue_ledger_composite_refresh();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (A): the composite arm returned % with NO activation row at all, expected 0 — a MISSING flag row is opening the switch. That is the send-intro fail-OPEN branch, which 164.7 C-03 explicitly rejects for this switch: a dormant-by-default activation must treat its absent state as its closed state, and merging this migration would change production behaviour', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_b;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (A): the composite arm inserted % job(s) with NO activation row at all, expected 0', v_cnt;
  END IF;

  -- ======================================================================
  -- ARM M1 — THE MISSING-ROW DORMANCY LEAVES A COUNTED TRACE
  --          (WR-10 cause 3 / APPGUC-WARNING-UNINSTRUMENTED-01).
  --
  -- Arm A above proved the composite arm DECLINED. It cannot prove anyone would
  -- ever KNOW. The dormant branch raises one NOTICE whose text is BYTE-IDENTICAL
  -- for the healthy "row present and FALSE" case and for the pathological "row
  -- absent, or invisible to this definer, while the platform believes itself
  -- live" case, and pg_cron keeps no NOTICE output — so cause 3 has been
  -- reaching nothing at all, on a schedule. 20260911130000 writes ONE counted
  -- public.cron_runs row naming the cause; this arm is what makes that
  -- falsifiable rather than asserted.
  --
  -- ⚠️ IT REUSES ARM A'S STATE DELIBERATELY. The flag row is already deleted and
  --    the composite arm has already been called, so this arm adds an ASSERTION,
  --    not a second call. A second call would write a second row and the `= 1`
  --    below would be measuring this file instead of the function.
  --
  -- ⚠️ metadata->>'function' IS THE DISCRIMINATOR, not cron_name. Both bodies
  --    write cron_name = 'ledger_refresh_fanout' — one scheduled fan-out, two
  --    arms — so filtering on cron_name alone would count the SINGLE-KEY arm's
  --    row as well and this arm would pass on the sibling's evidence.
  --
  -- ⚠️ READING A ROW THIS TRANSACTION JUST WROTE IS FINE, and is not the thing
  --    20260911130000's own verification block is forbidden to do (criterion 7,
  --    catalogue-only). That prohibition is about an APPLY-TIME read of
  --    committed state; this is the gate's own uncommitted write, and it unwinds
  --    with the closing ROLLBACK like every other write in this file.
  -- ======================================================================
  -- RED-UNDER: stop naming the cause — `v_cause := NULL;` in place of
  --            `v_cause := 'flag_row_invisible_or_absent';` in the COMPOSITE
  --            body of 20260911130000. The `IF v_cause IS NOT NULL` gate then
  --            skips the INSERT entirely: the decline still happens and reaches
  --            no counted instrument. Arm A stays GREEN (still 0 returned, still
  --            0 jobs), so this arm reddens alone.
  -- ⚠️ The cause literal is deliberately NOT one of that migration's own
  --    verification needles — its needle is the CONCATENATED
  --    `INSERT INTO public.` || `cron_runs` — so this mutation does not abort
  --    the apply, and the arm rather than the migration is the first failure.
  -- ⚠️ nth 2: the literal is assigned ONCE PER BODY and that file holds both, so
  --    it matches TWICE. `nth: 2` is the COMPOSITE body, MEASURED (the
  --    single-key CREATE OR REPLACE is first in the file); the single-key body
  --    is left UNMUTATED, which is what keeps the sibling gate's M1 independent
  --    of this one.
  -- RED-UNDER-M: {"arm":"M1","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"v_cause := 'flag_row_invisible_or_absent';","replace":"v_cause := NULL;","occurrences":2,"nth":2}]}
  SELECT count(*) INTO v_cnt_m1
    FROM public.cron_runs
   WHERE cron_name = 'ledger_refresh_fanout'
     AND error = 'flag_row_invisible_or_absent'
     AND metadata->>'function' = 'enqueue_ledger_composite_refresh';
  IF v_cnt_m1 <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (M1): the composite arm declined with NO activation row and wrote % instrument row(s) naming flag_row_invisible_or_absent, expected exactly 1 — the decline reached no counted instrument (WR-10 cause 3 / APPGUC-WARNING-UNINSTRUMENTED-01). The dormant branch raises one NOTICE whose text is byte-identical for "the row says FALSE, as designed" and for "the row is absent or invisible to this definer while the platform believes itself live", and pg_cron keeps no NOTICE output, so without this row the second state is indistinguishable from the first and from a healthy, fully-fresh estate', v_cnt_m1;
  END IF;

  -- ======================================================================
  -- ARM K — DORMANCY, ROW PRESENT AND FALSE. The state migration 20260907130000
  -- actually leaves behind: the row exists and is closed. Arm A cannot cover
  -- this — a guard that opens on FALSE while still closing on NULL passes arm A
  -- and ships an activation switch that is on the moment an operator writes the
  -- row at all.
  -- ======================================================================
  -- RED-UNDER: make the COMPOSITE guard in 20260911130000 fire ONLY on NULL —
  --            `IF v_enabled IS NULL AND v_enabled IS DISTINCT FROM TRUE THEN`.
  --            A FALSE row no longer takes the IF and the fan-out proceeds.
  -- ⚠️ Deliberately the MIRROR of arm A's twin, and that is the proof the two
  --    arms are not redundant: under this mutation arm A stays GREEN (NULL is
  --    still dormant) and only K reddens, while under arm A's twin K stays
  --    green. Neither mutation can redden both. The token
  --    `IS DISTINCT FROM TRUE` is preserved for the same apply-time reason.
  -- RED-UNDER-M: {"arm":"K","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"IF v_enabled IS DISTINCT FROM TRUE THEN\n    RAISE NOTICE 'enqueue_ledger_composite_refresh: dormant","replace":"IF v_enabled IS NULL AND v_enabled IS DISTINCT FROM TRUE THEN\n    RAISE NOTICE 'enqueue_ledger_composite_refresh: dormant","occurrences":1}]}
  INSERT INTO public.system_flags (key, enabled)
  VALUES ('ledger_refresh_enabled', FALSE)
  ON CONFLICT (key) DO UPDATE SET enabled = FALSE;

  v_ret := public.enqueue_ledger_composite_refresh();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (K): the composite arm returned % with the activation row present and FALSE, expected 0 — this is the exact state migration 20260907130000 leaves on PROD, so a non-zero here means merging it starts the composite fan-out', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_b;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (K): the composite arm inserted % job(s) with the activation row present and FALSE, expected 0', v_cnt;
  END IF;

  -- ======================================================================
  -- ARM L — DORMANCY WHEN THE READ ITSELF RAISES, AND WITHOUT PROPAGATING.
  -- The switch used to be `current_setting(…, TRUE)`, which CANNOT raise. A
  -- table read can: dropped table, revoked privilege, planner fault. 164.7 D-01
  -- makes that path fail CLOSED, and this arm is the only executed proof of it
  -- for the composite body. TWO properties, and both matter: the function must
  -- return 0, and it must NOT propagate the error — an hourly cron that starts
  -- erroring is a page, not a dormancy.
  --
  -- ⛔ NO SAVEPOINT, of any spelling. This gate is one dollar-quoted DO block
  --    (⚠️ the quote token is NOT written out here: a literal doubled dollar
  --    sign inside this comment CLOSES the block, and psql then reports a
  --    syntax error hundreds of lines away — MEASURED on the sibling fan-out
  --    gate's first lane run of this arm) and PL/pgSQL cannot parse
  --    transaction-control statements (TODOS [REDUNDER-SAVEPOINT];
  --    test_enqueue_compute_job_dedupe_non_terminal.sql's header records the
  --    same 42601). The substitute is the RAISE-TO-ROLLBACK idiom plan 164.7-03
  --    established: a plpgsql EXCEPTION block IS an implicit subtransaction, so
  --    raising a private SQLSTATE and catching exactly that SQLSTATE unwinds the
  --    block's work.
  --
  -- ⚠️ WHY THE RAISE AND NOT AN EXPLICIT RENAME-BACK. The RENAME takes ACCESS
  -- EXCLUSIVE on public.system_flags. An explicit rename-back would hold that
  -- lock until the transaction ended — the whole rest of this file — which on
  -- the SHARED test project blocks every other session touching the table.
  -- Unwinding by exception releases it the instant the handler runs. `SET LOCAL
  -- lock_timeout` makes a wait fail LOUD rather than wedge.
  --
  -- ⚠️ v_ret_l survives the rollback: plpgsql local-variable assignments are not
  -- transactional. The assertion is deliberately placed AFTER the block's END —
  -- a probe inside an EXCEPTION handler reads state the subtransaction has
  -- already rolled back (lint rule R1).
  -- ======================================================================
  -- RED-UNDER: make the COMPOSITE guard's own EXCEPTION handler in
  --            20260911130000 open the flag instead of closing it —
  --            `v_enabled := TRUE;` in place of `v_enabled := NULL;`. The read
  --            still fails, the handler now reports the failure as "enabled",
  --            and the fan-out proceeds and enqueues for the still-published
  --            stale composite.
  -- ⚠️ This twin reddens L and ONLY L: arms A and K never make the read fail,
  --    so their handler never runs.
  -- ⚠️ The needle spans the WARNING text, which names THIS function, so it is
  --    unique in a file holding both fan-out bodies. No `nth` is needed or used.
  -- RED-UNDER-M: {"arm":"L","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"'enqueue_ledger_composite_refresh: activation flag read failed (SQLSTATE %); treating as dormant', SQLSTATE;\n    v_enabled := NULL;","replace":"'enqueue_ledger_composite_refresh: activation flag read failed (SQLSTATE %); treating as dormant', SQLSTATE;\n    v_enabled := TRUE;","occurrences":1}]}
  SET LOCAL lock_timeout = '2s';
  BEGIN
    ALTER TABLE public.system_flags RENAME TO system_flags_arm_l;
    BEGIN
      v_ret_l := public.enqueue_ledger_composite_refresh();
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'TEST FAILED (L): the composite arm RAISED (SQLSTATE %) when its activation-flag read failed, instead of treating the failure as dormant and returning 0. An hourly cron that starts erroring is an incident; the guard is required to swallow the error, WARN with the SQLSTATE, and stay closed', SQLSTATE;
    END;
    -- ================================================================
    -- ARM M2 (its READ) — THE RAISING-READ DORMANCY LEAVES A COUNTED TRACE
    --                     (WR-10 cause 1 / APPGUC-WARNING-UNINSTRUMENTED-01).
    --
    -- ⛔ THE READ MUST SIT HERE AND NOWHERE ELSE, for two independent reasons
    --    that point at the same three lines:
    --      (i) AFTER the unwind it reads nothing. The `RAISE … 'P0164'` on the
    --          next line IS a rollback: it discards every write made inside this
    --          block, including the cron_runs row the composite arm just made.
    --          v_ret_l survives because a plpgsql local assignment is not
    --          transactional; a TABLE row does not.
    --     (ii) INSIDE the handler it would be a lint R1 violation and a vacuous
    --          read at once (scripts/lint-sql-gates.mjs, R1-exception-handler-
    --          probe): a SELECT … INTO in an EXCEPTION handler reads the state
    --          its own subtransaction rollback just restored. This is the block
    --          BODY, which is not a handler.
    --
    -- ⛔ AND ITS ASSERTION SITS AFTER ARM L'S, NOT HERE. Under arm L's own twin
    --    the handler reports the failed read as "enabled", the composite arm is
    --    no longer dormant, and NO instrument row is written — so an assertion at
    --    this point would be the FIRST failure under L's twin and the runner
    --    would report `wrong-first-failure`. v_cnt_m2 is a plpgsql local and
    --    survives the rollback exactly as v_ret_l does, so splitting the read
    --    from the assertion costs nothing and keeps both identities correct.
    -- ================================================================
    SELECT count(*) INTO v_cnt_m2
      FROM public.cron_runs
     WHERE cron_name = 'ledger_refresh_fanout'
       AND error = 'flag_read_failed'
       AND metadata->>'function' = 'enqueue_ledger_composite_refresh';
    RAISE EXCEPTION USING ERRCODE = 'P0164', MESSAGE = 'arm L: unwinding the RENAME (not a failure)';
  EXCEPTION WHEN SQLSTATE 'P0164' THEN
    NULL;
  END;
  IF v_ret_l <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (L): the composite arm returned % when its activation-flag read RAISED, expected 0 — the handler is treating a FAILED read as an OPEN switch, which is the one direction a fail-closed guard may never fail in', v_ret_l;
  END IF;

  -- ======================================================================
  -- ARM M2 (its ASSERTION) — see the block above for why the read is inside the
  -- unwound block and this is out here, one line below arm L's own assertion.
  -- ======================================================================
  -- RED-UNDER: stop naming the cause — `v_cause := NULL;` in place of
  --            `v_cause := 'flag_read_failed';` in the COMPOSITE body of
  --            20260911130000. The read still raises, the guard still closes,
  --            arm L still sees 0 — and the failure reaches no counted row, so
  --            only this arm reddens.
  -- ⚠️ Not a migration needle (the needle is the concatenated
  --    `INSERT INTO public.` || `cron_runs`), so the apply survives and the arm
  --    is the first failure. `nth: 2` is the composite body, MEASURED: the
  --    literal is assigned once per body and the file holds both.
  -- RED-UNDER-M: {"arm":"M2","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"v_cause := 'flag_read_failed';","replace":"v_cause := NULL;","occurrences":2,"nth":2}]}
  IF v_cnt_m2 <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (M2): the flag read RAISED and the composite arm wrote % instrument row(s) naming flag_read_failed, expected exactly 1. The guard swallows the error and WARNs, which is correct and is exactly what arm L proves — but a WARNING is not a trace pg_cron keeps, so without this row a composite arm that has been failing its activation read on every tick for weeks is indistinguishable from one that is dormant by design. This is the APPGUC-WARNING-UNINSTRUMENTED-01 half of WR-10', v_cnt_m2;
  END IF;

  -- Everything below runs with the switch ON. The row is written inside this
  -- transaction and unwinds with the closing ROLLBACK — never a committed write
  -- on a shared project. ON CONFLICT DO UPDATE because arm K has just written
  -- the row FALSE.
  INSERT INTO public.system_flags (key, enabled)
  VALUES ('ledger_refresh_enabled', TRUE)
  ON CONFLICT (key) DO UPDATE SET enabled = TRUE;

  -- ======================================================================
  -- RED-UNDER: change the enqueued job's metadata `source` marker in
  --            20260911130000 from the composite string to the SINGLE-KEY
  --            arm's. The job still lands, so the count and target-shape
  --            assertions stay green — what reddens is the byte-for-byte
  --            marker the non-destructive failure guard in job_worker.py reads
  --            back before it declines to un-publish a live composite.
  -- RED-UNDER-M: {"arm":"B","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"'ledger-refresh-composite'","replace":"'ledger-refresh'","occurrences":1}]}
  -- ARM B — POSITIVE (LEDGER-01). Same seed, switch on.
  -- ======================================================================
  v_ret := public.enqueue_ledger_composite_refresh();
  IF v_ret <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (B): the composite arm returned % for one eligible stale composite, expected 1 — this integer is the INSERTION count the go-live runbook has the founder read back, so a wrong value there is a wrong answer at activation', v_ret;
  END IF;

  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_b AND kind = 'stitch_composite';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (B): the eligible stale composite got % stitch_composite job(s), expected exactly 1', v_cnt;
  END IF;

  -- Strategy-scoped, and ONLY strategy-scoped. enqueue_compute_job enforces
  -- exactly-one-of {strategy, allocator, api_key} and raises 22023 otherwise
  -- (measured on PROD during the A7 tracer), and compute_jobs_kind_target_coherence
  -- (20260710130000) admits this kind only with strategy_id NOT NULL and every
  -- other target NULL. A fan-out that also passed a key would not enqueue at all —
  -- this shape assertion is what names that failure.
  SELECT strategy_id, portfolio_id, allocator_id, api_key_id, metadata ->> 'source'
    INTO v_strat, v_port, v_alloc, v_api, v_source
    FROM compute_jobs
   WHERE strategy_id = s_b AND kind = 'stitch_composite'
   LIMIT 1;
  IF v_strat IS DISTINCT FROM s_b OR v_port IS NOT NULL OR v_alloc IS NOT NULL OR v_api IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B): job target shape wrong (strategy set=% portfolio=% allocator=% api_key=%) — expected strategy-only', (v_strat IS NOT NULL), v_port, v_alloc, v_api;
  END IF;

  -- EXACT equality, never IS NOT NULL and never LIKE. Two separate contracts ride
  -- on this string: the non-destructive failure guard in
  -- analytics-service/services/job_worker.py compares it byte-for-byte before it
  -- declines to un-publish a live composite, and it must NOT collide with the
  -- single-key arm's marker or the two mechanisms stop being distinguishable in
  -- the queue. A typo must be RED here, not in production.
  IF v_source IS DISTINCT FROM 'ledger-refresh-composite' THEN
    RAISE EXCEPTION 'TEST FAILED (B): job metadata source is %, expected the exact composite refresh marker — the non-destructive failure guard keys on this string', COALESCE(v_source, '<null>');
  END IF;
  IF v_source = 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (B): the composite arm writes the SINGLE-KEY arm''s marker. The two must differ, or neither the queue nor the failure guard can tell the mechanisms apart';
  END IF;

  -- ⚠️ ARM B ALSO PINS THE "ANY ELIGIBLE MEMBER" RULE. s_b's two members are one
  -- eligible key and one REVOKED key. A member-health conjunct written as "ALL
  -- members eligible" would have produced 0 here, silently dropping a live
  -- composite the day one member is revoked. That this arm returned 1 with a
  -- revoked member present IS the measurement.
  SELECT count(*) INTO v_cnt
    FROM strategy_keys sk JOIN api_keys ak ON ak.id = sk.api_key_id
   WHERE sk.strategy_id = s_b AND ak.sync_status = 'revoked';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (B): the positive fixture was expected to carry exactly 1 REVOKED member so the ANY-eligible-member rule is what arm B measured; it carries %. Without that member this arm no longer distinguishes ANY from ALL', v_cnt;
  END IF;

  -- ======================================================================
  -- RED-UNDER: remove all three things that make a second tick a no-op, in one
  --            LAYERED mutation of 20260911130000: the 20-hour attempt cooldown
  --            (interval -> 0), the non-terminal in-flight guard (status set ->
  --            a status nothing holds), and the INSERTIONS-not-CALLS counter
  --            (v_existing = 0 dropped). All three are needed: leave any one in
  --            place and the second tick still returns 0 for a different reason,
  --            which would make a green here prove the wrong conjunct.
  -- ⚠️ nth 2: this needle now matches TWICE in 20260911130000 — that one file
  --    holds BOTH fan-out bodies. `nth: 2` selects the composite body,
  --    MEASURED (its CREATE OR REPLACE is second in the file). The composite
  --    body is left UNMUTATED, so this arm reddens on the body it names and
  --    nothing else. A reorder of the two bodies makes this mutate the wrong
  --    one and the runner reports `no-red` — loud, not silent.
  -- RED-UNDER-M: {"arm":"F","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"INTERVAL '20 hours'","replace":"INTERVAL '0 hours'","occurrences":2,"nth":2},{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"AND cj2.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')","replace":"AND cj2.status IN ('cancelled')","occurrences":2,"nth":2},{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"IF v_existing = 0 AND v_job_id IS NOT NULL THEN","replace":"IF v_job_id IS NOT NULL THEN","occurrences":2,"nth":2}]}
  -- ARM F — DEDUPE. A second tick while the job is in flight adds nothing.
  -- ======================================================================
  v_ret := public.enqueue_ledger_composite_refresh();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (F): the second consecutive tick returned %, expected 0 (the in-flight conjunct plus the RPC dedupe)', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_b AND kind = 'stitch_composite';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (F): after a second tick the composite has % stitch_composite jobs, expected 1', v_cnt;
  END IF;

  UPDATE strategies SET status = 'draft' WHERE id = s_b;

  -- ======================================================================
  -- ARM C — NEGATIVE CONTROL. A FRESH composite is not enqueued. Without this arm
  -- a body that enqueues every composite passes arm B.
  -- ======================================================================
  -- RED-UNDER: make the staleness conjunct in 20260911130000's candidate CTE
  --            vacuous (`WHERE lrs.is_stale` -> `WHERE (lrs.is_stale OR TRUE)`).
  --            Only s_c is published at this point, so no earlier arm's cohort
  --            changes; the fresh composite becomes a candidate and every
  --            composite would be stitched on every tick.
  -- ⚠️ nth 2: this needle now matches TWICE in 20260911130000 — that one file
  --    holds BOTH fan-out bodies. `nth: 2` selects the composite body,
  --    MEASURED (its CREATE OR REPLACE is second in the file). The composite
  --    body is left UNMUTATED, so this arm reddens on the body it names and
  --    nothing else. A reorder of the two bodies makes this mutate the wrong
  --    one and the runner reports `no-red` — loud, not silent.
  -- RED-UNDER-M: {"arm":"C","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"WHERE lrs.is_stale","replace":"WHERE (lrs.is_stale OR TRUE)","occurrences":2,"nth":2}]}
  UPDATE strategies SET status = 'published' WHERE id = s_c;
  v_ret := public.enqueue_ledger_composite_refresh();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (C): a FRESH composite produced % enqueue(s), expected 0 — the staleness gate is not bounding the cohort and every composite would be stitched on every tick', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_c;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (C): a FRESH composite got % job(s), expected 0', v_cnt;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id = s_c;

  -- ======================================================================
  -- ARM D — SINGLE-KEY EXCLUSION. ⛔ THE ARM THIS FILE EXISTS FOR.
  --
  -- `is_composite = TRUE` is the SOLE conjunct partitioning this function's cohort
  -- from the single-key arm's (20260825130000). This arm is the only thing that
  -- pins it, and it can only do that if its fixture clears EVERY OTHER conjunct —
  -- otherwise a green here means "something else excluded it", the mandated
  -- is-composite neutering does not redden, and the partition is pinned by nothing.
  --
  -- So the fixture's eligibility is MEASURED FIRST, from the view and from the
  -- tables, not assumed from the seed. These are the predicate's INPUTS, not a
  -- re-implementation of the predicate.
  -- ======================================================================
  -- RED-UNDER: make `is_composite` in the VIEW (20260825120000) unconditionally
  --            true — drop the strategy_keys correlation from its EXISTS. The
  --            precondition then reads is_composite=true for a member-less
  --            single-key fixture, which is exactly the "the view or the seed
  --            changed" case it exists to catch. The view's own STEP-3 drift
  --            assertions cover deferred_venues and has_mt5_member, not this
  --            expression, so the apply still succeeds.
  -- RED-UNDER-M: {"arm":"D/precondition","apply":[{"kind":"edit","file":"supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql","find":"SELECT 1 FROM public.strategy_keys sk WHERE sk.strategy_id = s.id","replace":"SELECT 1","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id = s_d;

  SELECT lrs.is_stale, lrs.is_composite, lrs.has_mt5_member
    INTO v_stale, v_comp, v_defer
    FROM public.ledger_refresh_staleness lrs
   WHERE lrs.strategy_id = s_d;
  SELECT s.status INTO v_status FROM strategies s WHERE s.id = s_d;

  IF v_stale IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (D/precondition): the single-key fixture reads is_stale=%, expected true. A green exclusion below would then be the STALENESS gate talking, not is_composite, and the mandated neutering could not fire', COALESCE(v_stale::text, '<null>');
  END IF;
  IF v_comp IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (D/precondition): the single-key fixture reads is_composite=%, expected false — it was seeded with api_key_id set and ZERO strategy_keys rows, so if this is true the view or the seed changed', COALESCE(v_comp::text, '<null>');
  END IF;
  IF v_defer IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (D/precondition): the single-key fixture reads has_mt5_member=%, expected false. A green exclusion below would then be the MEMBER-VENUE conjunct talking, not is_composite', COALESCE(v_defer::text, '<null>');
  END IF;
  IF v_status NOT IN ('published', 'pending_review') THEN
    RAISE EXCEPTION 'TEST FAILED (D/precondition): the single-key fixture is status=%, so a green exclusion below would be the LIFECYCLE conjunct talking, not is_composite', v_status;
  END IF;
  SELECT count(*) INTO v_cnt FROM strategy_keys WHERE strategy_id = s_d;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D/precondition): the single-key fixture has % strategy_keys row(s), expected 0. The member-health conjunct must pass VACUOUSLY on it (that is why it is written NOT EXISTS(...) OR EXISTS(...)); with members present a green exclusion could be member health talking', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_d;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D/precondition): the single-key fixture already has % compute_jobs row(s), so a green exclusion below could be the COOLDOWN or the IN-FLIGHT conjunct talking, not is_composite', v_cnt;
  END IF;

  -- RED-UNDER: neuter THE partitioning conjunct in 20260911130000 —
  --            `AND lrs.is_composite = TRUE` -> `AND lrs.is_composite IS NOT NULL`.
  --            The precondition above still measures the fixture as single-key,
  --            so what this proves is that is_composite, and nothing else, is
  --            what excludes it. This is the mandated is-composite neutering the
  --            file's header requires to be able to fire.
  -- RED-UNDER-M: {"arm":"D","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"AND lrs.is_composite = TRUE","replace":"AND lrs.is_composite IS NOT NULL","occurrences":1}]}
  -- Every other conjunct measured clear. Now the exclusion itself.
  v_ret := public.enqueue_ledger_composite_refresh();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D): a stale SINGLE-KEY strategy produced % enqueue(s) from the COMPOSITE arm, expected 0 — the two functions must PARTITION the cohort. A single-key strategy belongs to 20260825130000, which enqueues derive_broker_dailies; stitching it here would run a composite handler over a strategy with no members', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_d AND kind = 'stitch_composite';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D): a stale SINGLE-KEY strategy got % stitch_composite job(s), expected 0', v_cnt;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id = s_d;

  -- ======================================================================
  -- ARM E — MEMBER-VENUE EXCLUSION (D-01 / D-13). The founder's deferral, made
  -- testable. It is scoped to MEMBERSHIP, not to a headline venue: a composite
  -- with ANY member on the deferred venue is skipped, because a mixed composite
  -- would drag that venue's single shared terminal registry into the composite
  -- crawl.
  --
  -- ⚠️ The count of such composites in PROD is ZERO today. That is exactly why
  -- these two arms exist: CONTEXT D-01 records the founder expecting them later,
  -- and requires that a future one be a VISIBLE, NAMED skip rather than silent
  -- mishandling. An untested conjunct guarding a case that does not exist yet is
  -- an untested conjunct on the day the case arrives.
  -- ======================================================================
  UPDATE strategies SET status = 'published' WHERE id IN (s_e_mixed, s_e_all);

  -- RED-UNDER: point the VIEW's `deferred_venues` at a DIFFERENT ledger venue
  --            (20260825120000). It stays inside the venue set and still reads
  --            lv.deferred_venues, so both of that migration's own drift
  --            assertions still pass and the apply succeeds — and yet
  --            has_mt5_member reads FALSE for the mixed fixture, which is the
  --            silent-stop-excluding drift the migration's comment describes.
  -- RED-UNDER-M: {"arm":"E1/precondition","apply":[{"kind":"edit","file":"supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql","find":"ARRAY['mt5']::TEXT[]                    AS deferred_venues","replace":"ARRAY['sfox']::TEXT[]                   AS deferred_venues","occurrences":1}]}
  -- E-precondition: both fixtures must be otherwise eligible, or the exclusion
  -- below is being performed by something else.
  SELECT lrs.is_stale, lrs.is_composite, lrs.has_mt5_member
    INTO v_stale, v_comp, v_defer
    FROM public.ledger_refresh_staleness lrs
   WHERE lrs.strategy_id = s_e_mixed;
  IF v_stale IS NOT TRUE OR v_comp IS NOT TRUE OR v_defer IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (E1/precondition): the MIXED fixture reads is_stale=% is_composite=% has_mt5_member=%, expected true/true/true. Anything else and the exclusion below is not the membership conjunct', COALESCE(v_stale::text, '<null>'), COALESCE(v_comp::text, '<null>'), COALESCE(v_defer::text, '<null>');
  END IF;

  -- RED-UNDER: make the membership deferral vacuous in 20260911130000 —
  --            `AND lrs.has_mt5_member = FALSE` -> `AND lrs.has_mt5_member IS NOT NULL`.
  --            The view is untouched, so the precondition above still reads
  --            true/true/true and the exclusion below is the membership
  --            conjunct talking. Both E fixtures are published here, so the
  --            tick returns 2.
  -- RED-UNDER-M: {"arm":"E","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"AND lrs.has_mt5_member = FALSE","replace":"AND lrs.has_mt5_member IS NOT NULL","occurrences":1}]}
  v_ret := public.enqueue_ledger_composite_refresh();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (E): composites with a member on the DEFERRED venue produced % enqueue(s), expected 0 — the founder deferral is scoped to that venue''s path and a mixed composite would drag its single shared terminal registry into the composite crawl (D-01 / D-13)', v_ret;
  END IF;
  -- RED-UNDER: the same vacuous membership conjunct as arm E, with arm E's own
  --            raise NEUTERED — arm E reads the RETURN value and fires first on
  --            any enqueue at all, so it must be suppressed for the per-fixture
  --            row count to be the first failure. The mixed composite (ONE
  --            member on the deferred venue) then carries a job it must not have.
  -- RED-UNDER-M: {"arm":"E1/mixed","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"AND lrs.has_mt5_member = FALSE","replace":"AND lrs.has_mt5_member IS NOT NULL","occurrences":1}],"neuter":[{"arm":"E"}]}
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_e_mixed;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (E1/mixed): a composite with ONE member on the deferred venue got % job(s), expected 0. Membership, not headline venue, is the rule', v_cnt;
  END IF;
  -- RED-UNDER: as E1/mixed, with arm E and arm E1/mixed both neutered — they
  --            read the return value and the sibling fixture's row count and
  --            each fires earlier. The ALL-deferred composite then carries a job
  --            it must not have, which is the headline-venue reading of the rule
  --            this arm refuses.
  -- RED-UNDER-M: {"arm":"E2/all","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"AND lrs.has_mt5_member = FALSE","replace":"AND lrs.has_mt5_member IS NOT NULL","occurrences":1}],"neuter":[{"arm":"E"},{"arm":"E1/mixed"}]}
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_e_all;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (E2/all): a composite whose members are ALL on the deferred venue got % job(s), expected 0', v_cnt;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id IN (s_e_mixed, s_e_all);

  -- ======================================================================
  -- ARM G — ATTEMPT COOLDOWN. This is the BINDING bound: it is what stops a
  -- permanently-failing composite being hammered every tick, and it is what caps
  -- the outstanding backlog at the cohort size regardless of tick rate. Both
  -- edges, so the interval cannot drift silently.
  -- ======================================================================
  -- RED-UNDER: narrow the ATTEMPT cooldown in 20260911130000 from 20 hours to
  --            1 hour. The fixture's prior attempt is 2 hours old, so the
  --            narrowed window no longer covers it and the composite is
  --            re-enqueued — a permanently-failing composite would get a
  --            20-minute job every tick. Arm F's second tick is unaffected: its
  --            job is created inside this transaction, so it is still inside a
  --            1-hour window.
  -- ⚠️ nth 2: this needle now matches TWICE in 20260911130000 — that one file
  --    holds BOTH fan-out bodies. `nth: 2` selects the composite body,
  --    MEASURED (its CREATE OR REPLACE is second in the file). The composite
  --    body is left UNMUTATED, so this arm reddens on the body it names and
  --    nothing else. A reorder of the two bodies makes this mutate the wrong
  --    one and the runner reports `no-red` — loud, not silent.
  -- RED-UNDER-M: {"arm":"G","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"INTERVAL '20 hours'","replace":"INTERVAL '1 hour'","occurrences":2,"nth":2}]}
  UPDATE strategies SET status = 'published' WHERE id = s_g;
  v_ret := public.enqueue_ledger_composite_refresh();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (G): a composite attempted 2 hours ago produced % enqueue(s), expected 0 — without the cooldown a permanently-failing composite gets a 20-minute job every tick', v_ret;
  END IF;

  UPDATE compute_jobs SET created_at = now() - INTERVAL '21 hours'
   WHERE strategy_id = s_g AND kind = 'stitch_composite';

  v_ret := public.enqueue_ledger_composite_refresh();
  IF v_ret <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (G): a composite whose last attempt is 21 hours old produced % enqueue(s), expected 1 — the cooldown has been widened past its derivation and stale composites would never be refreshed', v_ret;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id = s_g;

  -- ======================================================================
  -- ARM H — THE BURST CAP. Five stale eligible composites, one tick.
  --
  -- ⚠️ Counts, never a duration or a rate. This arm pins the SHAPE of the bound.
  -- The safety argument is arm G's cooldown, NOT this cap — the cap bounds what
  -- ONE tick adds to a SHARED queue, and overhang past the tick is expected.
  -- Reading this arm as a throughput claim is what leads a future editor to raise
  -- the integer.
  -- ======================================================================
  -- RED-UNDER: raise the per-tick burst cap in 20260911130000 from
  --            `LIMIT 2` to `LIMIT 5`. Every earlier arm publishes at most two
  --            fixtures at a time, so the cap is invisible to them; this cohort
  --            of five is the only place the integer is measurable at all.
  -- RED-UNDER-M: {"arm":"H","apply":[{"kind":"edit","file":"supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","find":"LIMIT 2","replace":"LIMIT 5","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id = ANY(h_set);
  v_ret := public.enqueue_ledger_composite_refresh();
  IF v_ret <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (H): 5 stale eligible composites produced % enqueue(s) in one tick, expected exactly 2 — the per-tick burst cap. A result of 5 means the cap is gone and one tick can add 6000 s of composite work to a queue a second arm is already filling', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = ANY(h_set) AND kind = 'stitch_composite';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (H): % stitch_composite rows landed for the 5-composite cohort, expected exactly 2', v_cnt;
  END IF;

  -- ======================================================================
  -- ARM I — THE EXECUTE ACL, RE-ASSERTED ON EVERY RUN (161.1-AUDIT F-1).
  --
  -- Migration 20260825140000's DO block already checks this — ONCE, at apply. A later
  -- migration, a GRANT sweep, a role-template change or a restore-from-dump can
  -- undo it and nothing would notice. Not theoretical here:
  -- 20260515130001_enqueue_compute_job_internal_acl_remediation.sql exists
  -- precisely because a REVOKE on an enqueue path was lost.
  --
  -- ⛔ WHY THIS ONE REVOKE CARRIES THE WHOLE BOUND. If EXECUTE ever regressed to
  -- `authenticated`, the two NOT EXISTS guards this function relies on go
  -- VACUOUSLY TRUE for that caller: `strategies_read` shows an authenticated role
  -- its own published+owned strategies, while compute_jobs' FORCE-RLS deny-all
  -- returns it zero rows — so "no job already in flight" and "no recent attempt"
  -- are both trivially satisfied, every tick, forever. The result is unbounded
  -- self-scoped enqueue at the per-tick cap. Nothing downstream closes that path;
  -- the REVOKE is the only thing that does, and this arm is what keeps it closed.
  --
  -- ⚠️ NOT VACUOUS WHEN THE FUNCTION IS GONE: has_function_privilege raises 42883
  -- on a missing function rather than returning FALSE, so "no grants because there
  -- is nothing to grant on" reddens here instead of passing.
  -- ======================================================================
  -- RED-UNDER: `GRANT EXECUTE … TO anon` on the live lane. It is a `sql` step
  --            rather than an edit to the REVOKE in 20260825140000 because that
  --            migration's own DO block asserts the same privilege and would
  --            ABORT THE APPLY, so the gate would never run. The lane's
  --            --post-apply hook exists for exactly this shape.
  -- RED-UNDER-M: {"arm":"I","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.enqueue_ledger_composite_refresh() TO anon"}]}
  IF has_function_privilege('anon', 'public.enqueue_ledger_composite_refresh()', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (I): role anon can EXECUTE enqueue_ledger_composite_refresh. This is a cross-tenant SECURITY DEFINER enqueue path and the REVOKE at 20260825140000 is the only thing bounding it';
  END IF;
  IF has_function_privilege('authenticated', 'public.enqueue_ledger_composite_refresh()', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (I): role authenticated can EXECUTE enqueue_ledger_composite_refresh. Both NOT EXISTS guards in its body go vacuously TRUE for that role (strategies_read grants it its own rows; compute_jobs FORCE-RLS grants it none), so this is unbounded self-scoped enqueue every tick — the REVOKE at 20260825140000 is the only thing closing it';
  END IF;

  -- ======================================================================
  -- ARM J — THE DEFINER'S RLS EXEMPTION, RE-ASSERTED ON EVERY RUN
  --         (161.1-AUDIT F-2 durability).
  --
  -- Migration 20260825140000's DO block pins proowner's exemption — ONCE, at
  -- apply. That is the identical run-once weakness arm I exists to close, one
  -- property over, and ownership drifts by routes as ordinary as the ACL's:
  -- REASSIGN OWNED, a restore-from-dump performed by a different role, an
  -- `ALTER FUNCTION … OWNER TO` in a later migration.
  --
  -- ⛔ WHY A ZERO FAN-OUT IS THE WORST SHAPE THIS ARM COULD FAIL IN. The function
  -- is SECURITY DEFINER, so every read in its body runs as the OWNER, and its
  -- cohort comes from public.ledger_refresh_staleness — a `security_invoker`
  -- view (20260825120000), which is exactly what makes the owner's own row
  -- security apply to it. An owner with no exemption reads api_keys /
  -- strategy_keys under RLS, `exchanges` collapses to the empty array, the
  -- terminal && venue conjunct drops every row, and every tick enqueues nothing.
  -- Fail-CLOSED — nothing leaks, nothing is over-enqueued — and THAT is the
  -- problem: a silently-zero fan-out is byte-identical to "the whole estate is
  -- fresh". No other arm here can see it, because every one of them proves its
  -- claim against fixtures it seeded itself inside this transaction.
  --
  -- ⚠️ PINNING rolbypassrls ALONE WOULD CONTRADICT THE MIGRATION. A superuser
  -- bypasses row security implicitly and does NOT thereby carry rolbypassrls, so
  -- the single-flag form is a false negative against a superuser owner. This arm
  -- asserts the SAME disjunction 20260825140000 asserts, so no estate can be red
  -- in one place and green in the other.
  --
  -- ⚠️ ABSENCE MUST BE RED — AND THE IDIOMATIC SHAPE FOR THIS CHECK IS NOT.
  -- Arm I gets absence-safety for free: has_function_privilege raises 42883 on a
  -- missing function. Nothing here does. The shape this repo already uses for the
  -- same property — `IF EXISTS (SELECT … JOIN pg_roles … AND NOT r.rolbypassrls)`
  -- in supabase/tests/test_weight_snapshot_seed_secdef.sql arm 4 — matches ZERO
  -- ROWS when the function is gone, so EXISTS is FALSE and the arm passes having
  -- verified nothing. MEASURED on a throwaway PG16 cluster 2026-08-25: that form
  -- exits 0 against a DROPped function. This arm therefore borrows the reference's
  -- join (JOIN pg_roles r ON r.oid = p.proowner) but not its EXISTS framing.
  -- The COALESCE predicate below does raise on all-NULL targets, so absence is red
  -- either way — but it would name the owner as "<NULL>" and blame ownership drift
  -- for what is really an unapplied migration. The explicit NULL-owner guard is
  -- what makes the failure say the true thing. The applied-ness gate at the top of
  -- this file also reddens on absence; this guard exists so the arm does not lean
  -- on a check 400 lines away that a later edit could relax.
  -- ======================================================================
  -- RED-UNDER: ownership drift on the live lane — `ALTER FUNCTION … OWNER TO` a
  --            role that is exempt from row security by NEITHER route. Editing
  --            20260825140000 cannot reach this arm: its own DO block asserts
  --            the same disjunction and would abort the apply.
  -- ⚠️ The FIVE RLS-enabled tables move with the function DELIBERATELY. Left
  --    behind, the new owner reads them under RLS and the fan-out returns 0 on
  --    every tick — which is precisely the failure this arm's prose describes,
  --    and it reddens arm B four hundred lines earlier instead. Moving them
  --    isolates the ONE property under test: the owner's exemption.
  -- ⭐ public.system_flags is the FOURTH, added by 164.7 D-01, and it was found
  --    by MEASUREMENT, not by reading: the first lane run of this file after the
  --    switch moved reported `WRONG-ARM(B)` on this twin. The new guard READS
  --    system_flags, the drift role is exempt from row security by neither
  --    route, the RLS-enabled stand-in admits it no rows, the flag reads NULL,
  --    the composite arm is dormant and arm B fails first. Same mechanism as the
  --    three tables above — one more table, one more move.
  --    ⛔ A table OWNER is not subject to RLS (absent FORCE ROW LEVEL SECURITY,
  --    which neither the fixture nor 20260407164606 sets), which is what makes
  --    the move sufficient.
  -- ⭐ public.cron_runs is the FIFTH, added by 164.8.6 plan 03, and it too was
  --    found by MEASUREMENT on the sibling fan-out gate: the first narrowed run
  --    after the dormancy instrument landed reported that file's arm J as
  --    `NO-IDENTITY` with `SIGHTINGS: none — the lane emitted no TEST FAILED (…)
  --    at all`. The cause is one privilege: 20260911130000's dormant branch now
  --    WRITES public.cron_runs, the drift role holds only SELECT on it and RLS
  --    is enabled with no policies, so arm A's very first call died on a raw
  --    42501 naming no arm at all — worse than the WRONG-ARM(B) the fourth table
  --    was added for, because a raw permission error attributes to nothing.
  --    Moving ownership is the same remedy for the same reason: it isolates the
  --    ONE property under test from every privilege the drift role incidentally
  --    lacks.
  -- RED-UNDER-M: {"arm":"J","apply":[{"kind":"sql","stmt":"CREATE ROLE lrc_owner_drift NOLOGIN"},{"kind":"sql","stmt":"GRANT USAGE ON SCHEMA public TO lrc_owner_drift"},{"kind":"sql","stmt":"GRANT SELECT ON ALL TABLES IN SCHEMA public TO lrc_owner_drift"},{"kind":"sql","stmt":"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO lrc_owner_drift"},{"kind":"sql","stmt":"ALTER TABLE public.strategies OWNER TO lrc_owner_drift"},{"kind":"sql","stmt":"ALTER TABLE public.strategy_keys OWNER TO lrc_owner_drift"},{"kind":"sql","stmt":"ALTER TABLE public.compute_jobs OWNER TO lrc_owner_drift"},{"kind":"sql","stmt":"ALTER TABLE public.system_flags OWNER TO lrc_owner_drift"},{"kind":"sql","stmt":"ALTER TABLE public.cron_runs OWNER TO lrc_owner_drift"},{"kind":"sql","stmt":"ALTER FUNCTION public.enqueue_ledger_composite_refresh() OWNER TO lrc_owner_drift"}]}
  SELECT r.rolname, r.rolbypassrls, r.rolsuper
    INTO v_own_role, v_own_bypass, v_own_super
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public'
     AND p.proname = 'enqueue_ledger_composite_refresh';
  IF v_own_role IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (J): could not resolve the owner of public.enqueue_ledger_composite_refresh from pg_proc/pg_roles. Zero rows here is NOT "nothing wrong found" — it is the function being absent (or its proowner carrying no pg_roles row), and a NULL-tolerant exemption check would have read that as a pass';
  END IF;
  IF NOT (COALESCE(v_own_bypass, FALSE) OR COALESCE(v_own_super, FALSE)) THEN
    RAISE EXCEPTION 'TEST FAILED (J): public.enqueue_ledger_composite_refresh is owned by role "%", which is exempt from row security by neither route (rolbypassrls=%, rolsuper=%). As SECURITY DEFINER it reads the security_invoker view ledger_refresh_staleness as that role, so api_keys/strategy_keys RLS empties `exchanges`, the venue conjunct drops every row, and the fan-out returns 0 on every tick — indistinguishable from a healthy, fully-fresh estate. Migration 20260825140000 asserts this at apply time; ownership can drift afterwards and this arm is what notices', v_own_role, v_own_bypass, v_own_super;
  END IF;

  -- ======================================================================
  -- ARM S1 — THE WHOLE EXECUTE GRANTEE SET IS EXACTLY THE OWNER
  --          (164.7-WR02-SERVICE-ROLE-EXECUTE, ROADMAP criterion 4).
  --
  -- ⭐ THE SET, NOT A SUBSET, and that distinction IS the finding. Arm I above
  -- probes anon and authenticated BY NAME with has_function_privilege, and
  -- 20260907130000's own apply-time check probed the same two — and PASSED while
  -- service_role held EXECUTE on this function, because a subset probe is
  -- satisfied by every role it does not name. aclexplode ENUMERATES the grantees
  -- instead of interrogating a guessed list, so a grantee nobody thought of is a
  -- FAILURE here rather than a silence. Arm I is not redundant with this one: it
  -- names the two roles whose RLS makes this function's NOT EXISTS guards go
  -- vacuously true, and says WHY those two are catastrophic.
  --
  -- ⚠️ COMPARED TO THE OWNER'S NAME, NEVER TO THE LITERAL 'postgres'. The pg-lane
  -- boots as whatever role scripts/pg-lane/run.sh created, and a literal would
  -- make this arm pass or fail for a reason unrelated to the estate.
  --
  -- ⚠️ COALESCE(proacl, acldefault(…)) is what makes a NULL acl EXPLICIT: a NULL
  -- proacl MEANS the default ACL, and the default ACL for a function grants
  -- EXECUTE to PUBLIC. Reading NULL as "no grantees" would report the widest
  -- possible state as the tightest.
  --
  -- ⚠️ grantee = 0 is the PUBLIC pseudo-grantee and is mapped to a string here:
  -- pg_get_userbyid(0) is not a role name.
  --
  -- ⚠️ PRE-MERGE ON SHARED TEST THIS ARM IS RED BY CONSTRUCTION, and that is not
  -- a defect to route around: service_role still holds EXECUTE there until
  -- 20260911130000 applies, and migrations reach TEST only on merge. Same
  -- coupling as causes (iii) and (iv) in arm 0 (CLAUDE.md,
  -- [164.8-PUSH-RACE-VAC08] (b)).
  --
  -- ⛔ AND IT IS THIS ARM, NOT THE MIGRATION'S OWN CHECK 9, THAT PROVES THE
  -- GRANTEE SET IS GUARDED ON THIS LANE. MEASURED in plan 02: neither fan-out
  -- apply list contains 07-fixture-supabase-default-privileges.sql, so nothing
  -- ever GRANTS the bootstrap defaults here, and 20260907130000's earlier REVOKE
  -- has already materialised proacl as the owner alone — which makes
  -- 20260911130000's REVOKEs no-ops on this lane and its check 9 unfalsifiable
  -- by deleting them. On PROD check 9 IS live. Here, this arm is the proof.
  -- ======================================================================
  -- RED-UNDER: hand the privilege back on the live lane —
  --            `GRANT EXECUTE … TO service_role` after the apply. It is a `sql`
  --            step and NOT an edit of 20260911130000's REVOKE, because that
  --            file's own DO block (check 9) asserts this same set and an edit
  --            would ABORT THE APPLY, so the gate would never run and no arm
  --            could be the first failure. The lane's --post-apply hook exists
  --            for exactly this shape; it is arm I's reasoning, one property
  --            wider.
  -- ⛔ ORDER: THIS ARM MUST STAY AFTER ARM J. J's twin GRANTs EXECUTE ON ALL
  --    FUNCTIONS IN SCHEMA public to lrc_owner_drift and moves the ownership, so
  --    it drifts this grantee set too. Placed BEFORE J it would be the FIRST
  --    failure under J's twin and the runner would report `wrong-first-failure`.
  --    Placed after, J fails first under J's twin (correct) and this arm reddens
  --    alone under its own.
  -- RED-UNDER-M: {"arm":"S1","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.enqueue_ledger_composite_refresh() TO service_role"}]}
  SELECT g.owner_name, string_agg(g.grantee_name, ',' ORDER BY g.grantee_name)
    INTO v_owner_name, v_grantees
    FROM (
      SELECT pg_get_userbyid(p.proowner) AS owner_name,
             CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee_name
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
       WHERE n.nspname = 'public'
         AND p.proname = 'enqueue_ledger_composite_refresh'
         AND p.pronargs = 0
         AND a.privilege_type = 'EXECUTE'
    ) g
   GROUP BY g.owner_name;
  IF v_grantees IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (S1): could not read the EXECUTE grantee set of enqueue_ledger_composite_refresh — the function is missing, or it carries no EXECUTE aclitem at all. An empty answer here is indistinguishable from a locked-down one unless it is REFUSED, which is why this is an exception and not a pass';
  END IF;
  IF v_grantees IS DISTINCT FROM v_owner_name THEN
    RAISE EXCEPTION 'TEST FAILED (S1): EXECUTE on enqueue_ledger_composite_refresh is held by [%], expected exactly the owner [%]. This is a cross-tenant SECURITY DEFINER enqueue path that fans work out for every tenant; it must be callable by the scheduler alone, and the scheduler IS the owner. service_role''s grant survived Phase 164.7 precisely because only anon and authenticated were ever probed — arm I is that subset probe, and this arm is what makes the set complete', v_grantees, v_owner_name;
  END IF;

  RAISE NOTICE 'ALL 15 ARMS EXECUTED (A, B, C, D, E, F, G, H, I, J, K, L, M1, M2, S1) and passed — the composite refresh arm is dormant on a missing row, a FALSE row and a RAISING read, each of the two INVISIBLE dormant causes leaves exactly one counted instrument row naming this function, partitioned from the single-key arm, bounded, its exclusions are falsifiable, and its EXECUTE grantee set and DEFINER exemption both still hold.';
END $$;

ROLLBACK;
