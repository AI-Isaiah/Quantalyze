-- Test: public.enqueue_ledger_refresh_for_strategies — the LEDGER-01/-02/-04
-- refresh fan-out. Guards migration
-- 20260825130000_ledger_refresh_fanout_dormant.sql (Phase 161.1 / D-01, D-07,
-- D-08, D-09) AS SUPERSEDED BY
-- 20260907130000_ledger_refresh_switch_to_system_flags.sql (Phase 164.7 / D-01)
-- AND, IN TURN, BY
-- 20260911130000_ledger_fanout_grantees_and_dormancy.sql (Phase 164.8.6 /
-- 164.7-WR02, WR-10) AND, IN TURN, BY
-- 20260917120000_ledger_fanout_admit_private.sql (Phase 164.5.1.1 /
-- FANOUT-COHORT-PRIVATE-01) AND, IN TURN, BY
-- 20260924120000_ledger_fanout_failure_count.sql (Phase 164.6 / OPS-08-F2).
--
-- ⛔ RE-POINTED A FOURTH TIME, 2026-09-24 (Phase 164.6 plan 03), AND THE TWO
-- PARAGRAPHS BELOW THAT NAME 20260917120000 AND "WHY `nth` IS GONE" ARE NOW
-- LINEAGE, kept as the record of the 164.5.1.1 re-point. The apply list ends with
-- 20260924120000, whose `CREATE OR REPLACE` of the single-key body is the one
-- every arm runs against, so ALL 20 edit-kind twins that named 20260917120000
-- were re-pointed to it IN THE SAME COMMIT as the apply-list entry (TRAP E /
-- C-02, a fourth time). That file re-creates BOTH fan-out bodies again,
-- single-key FIRST, so every `find` was re-counted with `grep -c -F` on its
-- final bytes: 11 needles now match TWICE and carry `occurrences: 2, nth: 1`,
-- the other 9 still match once and carry no `nth`. The composite gate was
-- re-pointed to the same file in the same commit (its twins keep `nth: 2`).
-- Arm N, the failure-count arm, is new in that phase.
-- ⭐ The phase's review fix (in place, same migration) added arms N2, N3, T,
-- U, V1, V2 and W, split out of or beside arm N, and amended arm R: see each
-- arm's own header. 19 arms -> 26; 24 twins -> 31.
-- ⭐ The ROUND-2 review fix (same migration, in place) REMOVED the
-- all-candidates-failed raise, so arm U now proves the opposite of what it
-- proved in round 1: an all-fail tick COMMITS its failure row and the next
-- tick's cooldown excludes those candidates. It also took 40P01 out of the
-- lost-race branch, so arm W now expects a deadlock to be NAMED, and the new
-- W/deadlock twin proves it. 26 arms (W/deadlock is W's sub-arm, like
-- H/inactive is H's); 31 twins -> 32.
--
-- ⛔ WHICH FILE THE ARMS ACTUALLY MEASURE (Phase 164.7 plan 04, TRAP E / C-02;
-- RE-POINTED ONE MIGRATION FURTHER BY Phase 164.8.6 plan 03, AND ONE FURTHER
-- AGAIN BY Phase 164.5.1.1 plan 01). This gate's apply list ends with
-- 20260917120000, so ITS `CREATE OR REPLACE` is the body running under every arm
-- below. A `CREATE OR REPLACE` does not alter the earlier migrations' text — so
-- a twin that still mutated 20260825130000, 20260907130000 or 20260911130000
-- would mutate a body that is overwritten before the first assertion runs, apply
-- cleanly, and report `no-red`: an arm that cannot fail, inside the machine built
-- to find arms that cannot fail. Every edit-kind twin in this file therefore
-- names 20260917120000. The precedent is
-- test_sync_status_curated_sentence_survives.sql (164.2 plan 07), which points
-- its twins at the superseding migration for the same reason.
--
-- ⭐ THE 164.5.1.1 RE-POINT WAS A FILE-PATH SWAP PLUS AN OCCURRENCE RECOUNT, and
-- both halves are MEASUREMENTS rather than conveniences. 20260917120000 re-bases
-- the SINGLE-KEY body from its committed snapshot and changes exactly one
-- executable line — the candidate CTE's lifecycle conjunct gains a third value —
-- which falls inside no `find` that existed before this phase. All 16 edit-kind
-- `find` strings were re-counted against the new file, programmatically, before
-- the swap.
--
-- ⚠️ AND THIS IS WHY `nth` IS GONE FROM THIS FILE. 20260911130000 held BOTH
-- fan-out bodies (single-key first, composite second), so needles like
-- `INTERVAL '20 hours'`, the key conjuncts and `WHERE lrs.is_stale` matched
-- TWICE there and eight twins carried `nth: 1` to select the single-key body.
-- 20260917120000 re-creates the SINGLE-KEY body ALONE, so every one of those
-- needles now matches EXACTLY ONCE: measured at 1 for all 16, `occurrences`
-- lowered to 1 and `nth` dropped. ⛔ That is not a simplification to be undone —
-- a stale `occurrences: 2` would make the runner report occurrence-mismatch (a
-- MEASURE_FAIL: the mutation not applied, so the arm not tested), and a
-- surviving `nth: 2` would find nothing at all.
--
-- ⛔ THE COMPOSITE GATE IS NOT RE-POINTED AND MUST NOT BE.
-- supabase/tests/test_ledger_refresh_composite_arm.sql keeps every twin on
-- 20260911130000 with `nth: 2`, because 20260917120000 does not re-create the
-- composite body: that function's own lifecycle conjunct is deliberately NOT
-- widened by this phase (it has no registered cron row, and widening it would
-- reverse a founder-locked exclusion). See the SCOPE BOUNDARY block in
-- 20260917120000 and plan 03 of Phase 164.5.1.1.
--
-- What makes this gate worth having: MATCHED PAIRS
-- ------------------------------------------------
-- A bound is only proven by two arms pulling in opposite directions. Without the
-- POSITIVE arm, a body that enqueues NOTHING passes every negative arm. Without
-- the NEGATIVE arms, a body that enqueues EVERYTHING passes the positive one.
-- Only the pair pins a bound that both exists and is not over-tight — the same
-- reasoning migration 20260819150000 gives for its own C5/C5b pair. Arm G goes
-- one step further and pins the TWO integers against EACH OTHER: with a per-tick
-- LIMIT of 4 and a per-venue cap of 2, only the cap can produce a count of 2, so
-- deleting the cap yields 4 and G1 reddens. That is why D-09 forbids lowering the
-- LIMIT to equal the cap.
--
-- Arms:
--   A  DORMANCY, MISSING ROW  — no public.system_flags row for the activation
--      (LEDGER-02)              key ⇒ returns 0, inserts 0. This is the arm that
--                              proves merging the migration changes no
--                              production behaviour, and it is ALSO 164.7 C-03's
--                              pinned REJECTION of the fail-OPEN missing-row
--                              branch in send-intro/route.ts.
--   K  DORMANCY, ROW FALSE    — the row exists and is FALSE ⇒ returns 0.
--   L  DORMANCY, READ RAISES  — the flag read itself fails ⇒ returns 0 AND does
--                              not propagate the error.
--
--   ⭐ WHY THREE ARMS AND NOT ONE. A, K and L are three different failure
--   surfaces of ONE guard, and no single mutation reddens all three — which is
--   the operational proof that they are not redundant. A's twin (`IS NOT NULL
--   AND …`) opens on NULL and leaves K green; K's twin (`IS NULL AND …`) opens
--   on FALSE and leaves A green; L's twin (the handler assigns TRUE instead of
--   NULL) leaves both A and K green. Three arms, three twins, each isolating one
--   defect: the runner's identity discipline applied to a truth table.
--   B  POSITIVE (LEDGER-01)  — same seed with the setting on ⇒ exactly one
--                              strategy-scoped derive_broker_dailies job whose
--                              metadata source EQUALS the refresh marker, and a
--                              return value of 1.
--   C  NEGATIVE CONTROL      — a FRESH single-key strategy is NOT enqueued.
--   D  COMPOSITE (D-01)      — a stale composite is NOT enqueued, and no
--                              stitch_composite row appears either.
--   E  DEDUPE                — a second call adds nothing while a job is in flight.
--   F  COOLDOWN (D-09)       — an attempt 2 h ago blocks; aged past 20 h, unblocks.
--   G  BOUNDS (D-09)         — G1 the per-venue cap, G2 the per-tick LIMIT.
--   H  KEY ELIGIBILITY       — inactive / revoked / disconnected keys are skipped.
--   I  ACL durability (F-1)  — anon/authenticated cannot EXECUTE the fan-out.
--                             Mirrors the apply-time DO block, which runs once
--                             and can be silently undone afterwards. That REVOKE
--                             is the SOLE bound: under `authenticated` both
--                             NOT EXISTS guards go vacuously TRUE.
--   J  OWNER durability      — proowner is exempt from RLS (rolsuper OR
--                             rolbypassrls). Same apply-time-only weakness as I,
--                             one property over. Fail-CLOSED, which is why it
--                             needs an arm: drift makes the fan-out return 0
--                             forever, indistinguishable from "nothing stale".
--
-- ⚠️ NOT IN THIS FILE, and NOT dropped: the D-15 proof that a FAILED refresh
-- leaves an already-published row intact — status, warned flag, by-basis metrics,
-- returns_series and both basis series rows untouched. It cannot live here: this
-- file cannot make a venue probe fail, because the worker handler is Python and
-- never runs under psql. It lives in
-- analytics-service/tests/test_ledger_refresh_nondestructive.py. If you came here
-- auditing "where is the non-destructive arm", that is where it is.
--
-- ⚠️ sfox is deliberately UNEXERCISED here. It has zero PROD strategies, so its
-- arm ships unexercised by construction; it stays in the refresh set because
-- criterion 4 pins the venue SET (plan 05 gate 1), and no arm in this file may
-- assert that it produces work.
--
-- SERIAL execution: the fan-out takes a SESSION advisory lock, so a concurrent
-- holder would make it skip and redden the positive arms for the wrong reason.
-- The repo already runs supabase/tests/*.sql one file at a time; keep it that way.
--
-- TABLE-SCOPED activation (164.7 D-01, replacing the session-scoped setting).
-- The fan-out no longer reads an `app.`-namespace database setting — an operator
-- on this platform is refused 42501 when setting one (MEASURED on PROD
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
-- failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- ⛔ AN ABSENT FUNCTION IS A HARD FAILURE, NEVER A SKIP (161.1-REVIEW WR-03)
-- --------------------------------------------------------------------------
-- This file used to open with `RAISE NOTICE 'SKIP: …'; RETURN;` when the fan-out
-- function was absent. MEASURED 2026-08-25 against an empty Postgres 16: that path
-- printed the notice and exited `EXITCODE=0` having executed ZERO of arms A-L. The
-- CI step (.github/workflows/ci.yml, `sql-tests` → "Run SQL self-tests against
-- test Supabase project") reads ONLY that exit code, so the skip was
-- byte-identical to a pass in the only channel anything mechanical looks at — and
-- it was GUARANTEED to fire on the one run that matters most: the PR that
-- introduces migration 20260825130000.
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
-- until the phase's migrations are applied to the TEST project. The fan-out is a
-- SECURITY DEFINER, cross-tenant enqueue function that auto-applies to PROD on
-- merge, and arms A-L are the ONLY executed coverage of its SELECT predicates —
-- every other gate in the phase is a static text scan over the migration source.
-- Arm A (dormancy) is what proves the merge changes no production behaviour; a
-- skip meant that proof had never been run anywhere but an executor's laptop.
--
-- ✅ MECHANICALLY CLOSED (161.1-REVIEW WR-03 option (b), landed in
-- .github/workflows/ci.yml): the `sql-tests` step now captures each file's output,
-- fails on a printed 'SKIP:', and reads the 'ALL 26 ARMS EXECUTED' sentinel back off
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
-- was DISCOVERED, not guessed — plan 164.4-04 started from the sibling composite
-- gate's proven 10-entry list and needed ONE more iteration: this gate enqueues
-- `derive_broker_dailies`, whose kind row and admission CHECK come from
-- 20260614120000, without which the seed trips compute_jobs_kind_fkey.
--
-- ⭐ PHASE 164.7 plan 04 added TWO entries, and the ORDER of both is load-bearing:
--   * `31-fixture-system-flags.sql` sits IMMEDIATELY BEFORE 20260825130000.
--     public.system_flags is created by 20260407164606_perfect_match.sql, which
--     cannot enter any apply list (it reads auth.users, FKs onto `strategies`
--     and creates four unrelated tables), so the lane needs the stand-in. It
--     must precede 20260907130000, whose STEP 1 INSERTs into that table; placing
--     it before 20260825130000 keeps the two ledger gates' lists identical in
--     shape. It carries NO seed row, which is what leaves arm A's missing-row
--     case testable. It is a stand-in, so no twin may target it (GRAMMAR rule 4).
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
--   * `20260911130000_ledger_fanout_grantees_and_dormancy.sql` was applied LAST,
--     for exactly the reason 20260907130000 used to be: its `CREATE OR REPLACE`
--     was the definition every edit-kind twin below named. Leaving those 14
--     twins pointed at 20260907130000 the moment this entry was appended would
--     have made all 14 mutate dead text and report `no-red` in one commit —
--     TRAP E / C-02 again, one migration later. That is why plan 03 exists.
--     ⚠️ IT IS NO LONGER LAST — see the 164.5.1.1 entry below. It stays in the
--     list because it is the last definition of the COMPOSITE body, which
--     20260917120000 does not re-create, and because arm 0's cause-(iv) probe
--     names it.
-- ⭐ PHASE 164.5.1.1 plan 01 added ONE MORE, and its position is load-bearing
--   for the same reason, one migration later again:
--   * `20260917120000_ledger_fanout_admit_private.sql` is applied LAST. It
--     re-creates the SINGLE-KEY body alone, widening that body's lifecycle
--     conjunct to admit the owner-only terminal status, so its
--     `CREATE OR REPLACE` is the definition every edit-kind twin below now
--     names. All 16 edit-kind twins were re-pointed to it IN THE SAME COMMIT as
--     the apply-list entry; leaving any one on 20260911130000 would have made it
--     mutate text that is overwritten before the first assertion runs — TRAP E /
--     C-02 a third time. No fixture was added: the new migration reads no table
--     this list does not already provide.
-- ⭐ PHASE 164.5.1.1 plan 02 added ONE MORE, and it is the only entry in this
--   list that exists to make a CATALOGUE READ possible rather than to define a
--   body an arm calls:
--   * `20260716130000_strategies_status_private.sql` sits between
--     `20260710130000_stitch_composite_kind.sql` and
--     `20260825120000_ledger_refresh_staleness_view.sql` — chronological
--     position in the migration chain, AFTER 01-fixture-core.sql creates
--     `strategies` and well BEFORE the last entry, which must stay last. It
--     only ALTERs; it creates no table, so it is safe anywhere after the core
--     fixture.
--     WHY IT IS HERE: arm Q below reads
--     `pg_get_constraintdef('strategies_status_check')` to learn the lifecycle
--     DOMAIN from the catalogue instead of from a hand-written list. The core
--     fixture declares `strategies.status` as a bare nullable TEXT with NO
--     constraint, so without this entry that read returns NULL on every lane
--     and the arm could only ever report COULD NOT MEASURE.
--     ⛔ AND WHY THE STAND-IN FIXTURE WAS NOT USED INSTEAD.
--     `scripts/pg-lane/fixtures/30-fixture-strategies-status-default.sql`
--     carries the same constraint and is used by another gate, but GRAMMAR
--     rule 4 refuses any twin whose `file` is under `scripts/pg-lane/fixtures/`
--     — and arm Q's twin must mutate exactly this constraint, because the only
--     mutation that proves the arm catches a FUTURE status is the ARRIVAL of a
--     sixth one. A stand-in cannot carry that twin; the real migration can.
--     Its pre-flight `DO` block reads `strategies` rows, which on a lane is a
--     no-op: the table is empty at apply time.
--     ⚠️ The entry puts a live CHECK on `strategies.status` for EVERY arm in
--     this file. Every fixture here inserts an explicit status and every value
--     used is inside the domain (`draft`, `published`, `private`), which is a
--     prediction the full-corpus run MEASURED. If an arm ever reddens with a
--     check violation, the cause is a fixture writing an out-of-domain status
--     and the fix is the FIXTURE — never a weakening of the constraint.
-- ⭐ PHASE 164.6 plan 03 added ONE MORE, and it must stay LAST:
--   * `20260924120000_ledger_fanout_failure_count.sql` re-creates BOTH fan-out
--     bodies with the failure instrument (a counted cron_runs row naming the
--     candidates whose enqueue failed), so its `CREATE OR REPLACE` is now the
--     single-key definition every arm runs against and every edit-kind twin
--     names. No fixture was added: the new row goes to public.cron_runs, which
--     `33-fixture-cron-runs.sql` already provides.
-- Proven on the 13-entry list this file carried through Phase 164.7 (LINEAGE,
-- not a live reading): the completion notice below printed with its full roster
-- A-L, and the runner reported `per-arm lane time: mean 1.1s` over three
-- separate diagnostic runs of this file (MEASURED 2026-09-07; the pre-164.7
-- reading was 1.06 s over the 11-entry list, so the two extra apply entries cost
-- nothing measurable).
-- ⭐ CURRENCY 2026-09-11 (Phase 164.8.6 plan 03) — the LIVE reading, taken over
--    the 15-entry list above at the final bytes of this file:
--    `scripts/pg-lane/run.sh` exited 0 with the completion notice printing its
--    full 15-arm roster and ZERO `TEST FAILED` lines anywhere in the stream, and
--    the narrowed mutation run reported `arms: 20/20/0`, `biting: 20`,
--    `lane-invocations: 20` (the two independent tallies AGREE), and a per-arm
--    lane time whose mean read 1.1-1.2 s across three narrowed runs of this
--    file — it fluctuated between those two readings run to run, so a single
--    pinned figure here would be false precision. Three more arms and two more
--    apply entries, and the per-arm cost did not measurably move off the 1.1 s
--    above.
-- ⚠️ The sentinel string itself is deliberately NOT repeated in this header:
-- this file's own verify pins it to exactly ONE occurrence, so that the roster
-- can only be edited where it is RAISED.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716130000_strategies_status_private.sql","supabase/migrations/20260825120000_ledger_refresh_staleness_view.sql","scripts/pg-lane/fixtures/31-fixture-system-flags.sql","supabase/migrations/20260825130000_ledger_refresh_fanout_dormant.sql","supabase/migrations/20260825140000_ledger_refresh_composite_arm.sql","supabase/migrations/20260907130000_ledger_refresh_switch_to_system_flags.sql","scripts/pg-lane/fixtures/33-fixture-cron-runs.sql","supabase/migrations/20260911130000_ledger_fanout_grantees_and_dormancy.sql","supabase/migrations/20260917120000_ledger_fanout_admit_private.sql","supabase/migrations/20260924120000_ledger_fanout_failure_count.sql"]}
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_ledger_refresh_fanout.sql

BEGIN;

DO $$
DECLARE
  uid          UUID := gen_random_uuid();
  k_led        UUID;  -- eligible, ledger-backed venue #1
  k_led2       UUID;  -- eligible, ledger-backed venue #2 (arm G2 needs two venues)
  k_led2b      UUID;  -- second key on venue #2, so the composite has two members
  k_inactive   UUID;
  k_revoked    UUID;
  k_disc       UUID;
  s_a          UUID;  -- arms A / B / E: maximally stale, eligible, single-key
  s_c          UUID;  -- arm C: FRESH single-key on the other ledger venue
  s_d          UUID;  -- arm D: stale COMPOSITE
  s_f          UUID;  -- arm F: stale, but attempted 2 h ago
  s_p          UUID;  -- arm P: stale, eligible, OWNER-ONLY TERMINAL lifecycle
  s_r1         UUID;  -- arm R: stale, eligible, DELIBERATELY POISONED
  s_r2         UUID;  -- arm R: the second poisoned candidate
  s_h_inact    UUID;
  s_h_revoked  UUID;
  s_h_disc     UUID;
  g1_v1        UUID[];  -- arm G1: 6 stale single-key on venue #1
  g2_v1        UUID[];  -- arm G2: 6 more on venue #1
  g2_v2        UUID[];  -- arm G2: 6 stale single-key on venue #2
  v_ret        INTEGER;
  v_cnt        INTEGER;
  v_cnt2       INTEGER;
  v_locks_pre  INTEGER;  -- arm R: advisory locks this backend holds BEFORE the tick
  v_locks_post INTEGER;  -- arm R: ...and after it. The DELTA is the assertion.
  v_strat      UUID;
  v_port       UUID;
  v_alloc      UUID;
  v_api        UUID;
  v_source     TEXT;
  v_foreign    INTEGER;
  -- ⛔ Arm J's three. plpgsql compiles this DO block WHOLE: an undeclared
  --    variable raises 42601 and NONE of arms A-L run — the failure would not
  --    be "arm J is broken", it would be "the file asserted nothing". Adding an
  --    arm means adding its DECLAREs here in the same edit.
  v_owner      TEXT;
  v_own_super  BOOLEAN;
  v_own_bypass BOOLEAN;
  -- ⛔ Arms K and L, and arm 0's applied-ness probe, add three more under the
  --    SAME rule as arm J's three above — a missing DECLARE is a 42601 that
  --    stops the WHOLE block compiling, so arms A-L would all vanish together
  --    and the file would assert nothing while exiting on a message that names
  --    no arm.
  v_flag       BOOLEAN;  -- the COMMITTED activation row, read by the precondition
  v_ret_l      INTEGER;  -- arm L: survives its subtransaction's rollback
  v_body       TEXT;     -- arm 0: the comment-stripped body of the fan-out
  -- ⛔ Arms M1, M2 and S1 (Phase 164.8.6 plan 03) add four more under the SAME
  --    rule as arm J's three above: a missing DECLARE is a 42601 that stops the
  --    WHOLE block compiling, so every arm would vanish together.
  v_cnt_m1     INTEGER;  -- arm M1: instrument rows naming the missing-row cause
  v_cnt_m2     INTEGER;  -- arm M2: … and the raising-read cause. Like v_ret_l it
                         --         survives arm L's P0164 rollback; the ROW it
                         --         counts does not, which is why it is read
                         --         inside that block and asserted after it.
  v_grantees   TEXT;     -- arm S1: the WHOLE EXECUTE grantee set, comma-joined
  v_owner_name TEXT;     -- arm S1: … and the owner name it must equal exactly
  -- ⛔ Arm Q (Phase 164.5.1.1 plan 02) adds five more under the SAME rule as
  --    arm J's three above: a missing DECLARE is a 42601 that stops the WHOLE
  --    block compiling, so every arm would vanish together and the file would
  --    exit on a message naming no arm.
  v_domain_def TEXT;     -- arm Q: pg_get_constraintdef of strategies_status_check
  v_fanout_def TEXT;     -- arm Q: the comment-stripped body, read for ITS OWN
                         --        raise. It is deliberately not arm 0's v_body:
                         --        arm Q's COULD-NOT-MEASURE diagnostics must be
                         --        raised by arm Q, and an arm that borrows
                         --        another arm's variable inherits that arm's
                         --        silence when the read is the thing that broke.
  v_admitted   TEXT;     -- arm Q: the parenthesised lifecycle list, extracted
  v_status     TEXT;     -- arm Q: loop variable over the catalogue's domain
  v_checked    INTEGER;  -- arm Q: how many statuses the loop actually asserted
  -- ⛔ Arm N (Phase 164.6 plan 03) adds six more under the SAME rule as arm J's
  --    three above: a missing DECLARE is a 42601 that stops the WHOLE block
  --    compiling, so every arm would vanish together.
  s_n1         UUID;     -- arm N: stale, eligible, DELIBERATELY POISONED
  s_n2         UUID;     -- arm N: stale, eligible, HEALTHY sibling
  v_cnt_n      INTEGER;  -- arm N: failure rows naming the poisoned candidate
  v_meta_n     JSONB;    -- arm N: … and that one row's metadata
  v_fail_pre   INTEGER;  -- arm N: this function's failure rows before the clean tick
  v_fail_post  INTEGER;  -- arm N: … and after it. Equal, or a clean tick wrote one.
  -- ⛔ The 164.6 review fix's arms (R's fresh wedge candidate, N's third
  --    candidate, and arms T, U, V1, V2, W) add these under the SAME rule as
  --    arm J's three above: a missing DECLARE is a 42601 that stops the WHOLE
  --    block compiling, so every arm would vanish together.
  s_r3         UUID;     -- arm R: a FRESH healthy candidate for the wedge check
  s_n3         UUID;     -- arm N: a second HEALTHY sibling, on the other venue
  s_t1         UUID;     -- arm T: healthy, competes for the failed one's slot
  s_t2         UUID;     -- arm T: … the less-stale one the cooldown must admit
  s_u1         UUID;     -- arm U: poisoned
  s_u2         UUID;     -- arm U: poisoned
  s_u3         UUID;     -- arm U: healthy, behind the poisoned pair on one venue
  v_meta_u     JSONB;    -- arm U: the all-fail tick's committed failure row
  s_v1         UUID;     -- arm V1: poisoned
  s_v2         UUID;     -- arm V1: healthy
  s_v3         UUID;     -- arm V2: poisoned
  s_v4         UUID;     -- arm V2: poisoned
  s_w1         UUID;     -- arm W: loses a race with 40001
  s_w2         UUID;     -- arm W: a deadlock victim (40P01), a FAILURE since round 2
  s_w3         UUID;     -- arm W: fails for real
  s_w4         UUID;     -- arm W: healthy
  v_err_state  TEXT;     -- arms R, U, V1, V2: the SQLSTATE that escaped, if any
  v_err_msg    TEXT;     -- arms R, U, V2: … and its message
  v_meta_w     JSONB;    -- arm W: the real failure's row
  v_cnt_w      INTEGER;  -- arm W: failure rows naming a lost-race candidate
BEGIN
  -- ----- applied-ness gate: ABSENCE IS A FAILURE, NOT A SKIP (WR-03) ------
  -- RED-UNDER: DROP the function on the live lane after the migrations have
  --            applied — cause (ii) of this arm's own message. It is a `sql`
  --            step rather than a migration edit because renaming the CREATE in
  --            20260825130000 aborts that migration's OWN verification block
  --            ("enqueue_ledger_refresh_for_strategies missing"), so the gate
  --            would never run and no arm could be the first failure.
  -- RED-UNDER-M: {"arm":"0","apply":[{"kind":"sql","stmt":"DROP FUNCTION public.enqueue_ledger_refresh_for_strategies()"}]}
  -- See the ⛔ block in this file's header for the measurement behind this.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'enqueue_ledger_refresh_for_strategies'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED (0): public.enqueue_ledger_refresh_for_strategies is not registered on this database, so NONE of arms A-L ran — including arm A, the dormancy proof that merging this migration changes no production behaviour. This is a FAILURE, not a skip. TWO causes fit and this assertion cannot distinguish them, so check both: (i) the TEST project has not received migration 20260825130000 — apply the phase''s migrations to it and re-run; expect this exactly once, on the PR that introduces them, because NO workflow applies migrations to TEST; (ii) the function was DROPPED or RENAMED after being applied, which is a real regression in a SECURITY DEFINER cross-tenant enqueue path. ⛔ Do NOT "fix" this by restoring the old RAISE NOTICE/RETURN skip: that made this file exit 0 having asserted nothing, on exactly the run where this function first reaches PROD.';
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
     AND p.proname = 'enqueue_ledger_refresh_for_strategies';
  IF v_body IS NULL OR v_body !~ 'FROM public\.system_flags' THEN
    RAISE EXCEPTION 'TEST FAILED (0): public.enqueue_ledger_refresh_for_strategies exists on this database but its executable body does not read the activation flag from public.system_flags, so it is the PRE-164.7 revision that reads the retired app-namespace database setting. Arms A, K and L below describe the table-backed fail-closed guard and would measure something else entirely. Cause (iii): migration 20260907130000_ledger_refresh_switch_to_system_flags.sql has not been applied to THIS database. Apply it and re-run. ⛔ Do NOT relax this check to match either body: the two guards fail closed for different reasons, and a gate that accepts both cannot tell an un-applied migration from a regression.';
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
    RAISE EXCEPTION 'TEST FAILED (0): public.enqueue_ledger_refresh_for_strategies reads the activation flag but its executable body never writes the dormancy instrument row, so it is the 164.7 revision whose dormant branch cannot distinguish "the row says FALSE, as designed" from "the row is absent or invisible to this definer while the platform believes itself live". Arms M1 and M2 below would then fail with a count of 0 and read as a broken instrument rather than as a missing apply. Cause (iv): migration 20260911130000_ledger_fanout_grantees_and_dormancy.sql has not been applied to THIS database. Apply it and re-run; expect this exactly once, on the PR that introduces it, because migrations reach TEST only on merge.';
  END IF;

  -- ----- and the body carries the FAILURE INSTRUMENT arm N reads -----------
  -- Cause (v), added by Phase 164.6 plan 03, in cause (iv)'s shape one
  -- migration later: the function exists and writes the dormancy instrument,
  -- but it is the pre-164.6 revision whose per-candidate handler swallows a
  -- failed enqueue into a WARNING and records nothing. Arm N would then fail on
  -- a count of 0 and read as a broken instrument rather than as a missing
  -- apply. Same v_body, same comment strip, no second read. The probe is the
  -- failed-target metadata KEY, which only the 164.6 body spells.
  IF v_body !~ 'failed_targets' THEN
    RAISE EXCEPTION 'TEST FAILED (0): public.enqueue_ledger_refresh_for_strategies writes the dormancy instrument but its executable body never records a failed candidate, so it is the pre-164.6 revision whose per-candidate handler swallows a failed enqueue into a WARNING nothing reads. Arm N below would then fail with a count of 0 and read as a broken instrument rather than as a missing apply. Cause (v): migration 20260924120000_ledger_fanout_failure_count.sql has not been applied to THIS database. Apply it and re-run; expect this exactly once, on the PR that introduces it, because migrations reach TEST only on merge.';
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
  --     length on a SHARED project, and would print "the ledger refresh fan-out
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
  -- Arms G1/G2 measure a GLOBAL bound — the per-tick LIMIT and the per-venue cap
  -- are global — so a pre-existing eligible strategy on this database would
  -- compete for those slots and make the counts wrong.
  --
  -- ⛔ It is NOT acceptable to solve that by parking those rows. supabase/tests
  -- run against ONE SHARED test project concurrently with other PRs, and an
  -- UPDATE touching rows this block did not seed writes across another PR's live
  -- fixture mid-run: the surrounding ROLLBACK hides that from the WRITER, not
  -- from a concurrent READER, and the failure then surfaces in a completely
  -- different file. That is the D-05 hazard
  -- (analytics-service/tests/test_sql_gate_scoped_updates.py) and this file will
  -- not create a second instance of it on a neighbouring table.
  --
  -- So: measure, and fail LOUD. A concurrent PR's fixtures are uncommitted and
  -- therefore invisible here, so a non-zero count means the test project carries
  -- COMMITTED ledger-backed strategies that are stale and live — a standing
  -- property of the project, not a race, and one a human should look at rather
  -- than one this file should silently paper over.
  -- ⛔ THIS LITERAL MOVES IN LOCKSTEP WITH THE PRODUCTION CONJUNCT IT MIRRORS,
  -- and it was widened here on 2026-09-17 with it (Phase 164.5.1.1 plan 01,
  -- FANOUT-COHORT-PRIVATE-01). The precondition's whole job is to count the rows
  -- that WOULD COMPETE with this file's fixtures for the global per-tick LIMIT
  -- and the per-venue cap that arms G1/G2 measure — so it has to admit exactly
  -- what the function under test admits. Left at two values it would be blind to
  -- a foreign, committed, stale strategy carrying the owner-only terminal status:
  -- a REAL candidate for the widened function, silently making G1/G2 measure the
  -- wrong global counts while the precondition reported all clear. Narrower than
  -- the function is a FALSE PASS here; wider would be a false abort.
  --
  -- ⛔ THE COMPOSITE GATE'S OWN PRECONDITION IS NOT WIDENED WITH THIS ONE.
  -- supabase/tests/test_ledger_refresh_composite_arm.sql guards a DIFFERENT
  -- function whose lifecycle conjunct this phase deliberately leaves at two
  -- values; widening its precondition would make it fail loud on a foreign
  -- candidate the composite function would in fact REFUSE — an over-strict
  -- precondition, i.e. a false abort. Same rule, opposite direction, because the
  -- two preconditions mirror two different functions.
  SELECT count(*) INTO v_foreign
    FROM public.ledger_refresh_staleness lrs
    JOIN public.strategies s ON s.id = lrs.strategy_id
   WHERE lrs.is_stale
     AND s.status IN ('published', 'pending_review', 'private');
  IF v_foreign <> 0 THEN
    RAISE EXCEPTION 'TEST PRECONDITION FAILED: % committed strategy/strategies on this database are already stale, live and ledger-backed. They would compete with this file''s fixtures for the global per-tick LIMIT and make arms G1/G2 measure the wrong thing. Park or clean them in the test project — do NOT make this file update rows it did not seed (D-05: shared project, concurrent PRs).', v_foreign;
  END IF;

  -- ----- SEED --------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'lrf-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'lrf', 'lrf-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  -- Venue literals appear in the FIXTURES only. The function under test declares
  -- none (D-05) — it reads the cohort from public.ledger_refresh_staleness, which
  -- is the single SQL home of the set. A fixture naming a venue is a fixture; a
  -- production predicate naming one is a second drift surface.
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'lrf v1', 'x', TRUE) RETURNING id INTO k_led;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'deribit', 'lrf v2 a', 'x', TRUE) RETURNING id INTO k_led2;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'deribit', 'lrf v2 b', 'x', TRUE) RETURNING id INTO k_led2b;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'lrf inactive', 'x', FALSE) RETURNING id INTO k_inactive;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, sync_status)
  VALUES (uid, 'mt5', 'lrf revoked', 'x', TRUE, 'revoked') RETURNING id INTO k_revoked;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, disconnected_at)
  VALUES (uid, 'mt5', 'lrf disconnected', 'x', TRUE, now()) RETURNING id INTO k_disc;

  -- Every fixture is seeded PARKED ('draft'), and each arm un-parks exactly the
  -- fixtures it is about.
  --
  -- ⚠️ AMENDED 2026-09-17 (Phase 164.5.1.1 plan 01), because the sentence that
  -- stood here justified the lever with a claim that is no longer true. It read:
  -- "Lifecycle is the parking lever precisely because no arm here tests it, so
  -- parking cannot mask the conjunct any arm is measuring." Arm P below DOES
  -- test the lifecycle conjunct. The lever is still SOUND, and for a reason that
  -- has to be stated rather than assumed: the parked value is `draft`, and
  -- `draft` is excluded by the conjunct in BOTH its pre- and post-widening
  -- forms — so parking is invisible to arm P's own mutation and cannot mask what
  -- arm P measures. ⛔ If a future phase ever admits `draft`, this lever stops
  -- working for EVERY arm in this file at once and a different parking mechanism
  -- is required; that is the one change this comment exists to stop being made
  -- silently.
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led,      'lrf A',  'draft') RETURNING id INTO s_a;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led2,     'lrf C',  'draft') RETURNING id INTO s_c;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led,      'lrf F',  'draft') RETURNING id INTO s_f;
  -- Arm P's fixture. Seeded PARKED like every other one; arm P promotes it to
  -- the owner-only terminal status rather than to the published one, which is
  -- the whole point of that arm.
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led,      'lrf P',  'draft') RETURNING id INTO s_p;
  -- Arm R's two fixtures. Named `lrf R%` ON PURPOSE: the poison trigger below
  -- selects by NAME, because a trigger function cannot see this block's
  -- PL/pgSQL variables. Seeded PARKED like every other fixture.
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led,      'lrf R1', 'draft') RETURNING id INTO s_r1;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led,      'lrf R2', 'draft') RETURNING id INTO s_r2;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_inactive, 'lrf H1', 'draft') RETURNING id INTO s_h_inact;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_revoked,  'lrf H2', 'draft') RETURNING id INTO s_h_revoked;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_disc,     'lrf H3', 'draft') RETURNING id INTO s_h_disc;

  -- Arm D's composite: api_key_id NULL (mutually exclusive with the single-key
  -- link), venue reachable only through strategy_keys.
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, NULL, 'lrf D', 'draft') RETURNING id INTO s_d;
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_d, k_led2,  uid, CURRENT_DATE - 400, 0);
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_d, k_led2b, uid, CURRENT_DATE - 200, 1);

  WITH ins AS (
    INSERT INTO strategies (user_id, api_key_id, name, status)
    SELECT uid, k_led, 'lrf G1 ' || g, 'draft' FROM generate_series(1, 6) g
    RETURNING id
  ) SELECT array_agg(id) INTO g1_v1 FROM ins;
  WITH ins AS (
    INSERT INTO strategies (user_id, api_key_id, name, status)
    SELECT uid, k_led, 'lrf G2v1 ' || g, 'draft' FROM generate_series(1, 6) g
    RETURNING id
  ) SELECT array_agg(id) INTO g2_v1 FROM ins;
  WITH ins AS (
    INSERT INTO strategies (user_id, api_key_id, name, status)
    SELECT uid, k_led2, 'lrf G2v2 ' || g, 'draft' FROM generate_series(1, 6) g
    RETURNING id
  ) SELECT array_agg(id) INTO g2_v2 FROM ins;

  -- Analytics rows. STALE = a returns_series whose newest date is far past the
  -- 4-day threshold; FRESH = yesterday. Both use the success status the whole
  -- live ledger cohort actually carries (D-04) — a fixture written as 'complete'
  -- would test a status no live ledger row has.
  --
  -- ISOLATION BY CONSTRUCTION, belt to the precondition's braces: the stale
  -- fixtures are dated a CENTURY back, so they outrank any plausible foreign row
  -- under the fan-out's `ORDER BY last_return_date ASC` and take the bounded
  -- slots first. Same idiom, and the same reason, as the reaper gate's
  -- century-old seeds (Phase 142.1 / D-05).
  --
  -- ⚠️ g2_v1 is dated a further century back than g2_v2, and that stagger is
  -- LOAD-BEARING: with the per-venue cap deleted, arm G2's four slots then fill
  -- entirely from one venue (4/0) instead of splitting by luck, so the cap's
  -- neutering reddens G2 deterministically rather than tie-break-dependently.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  SELECT sid, 'complete_with_warnings', now(),
         jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 36500, 'YYYY-MM-DD'), 'value', 0.001))
    FROM unnest(ARRAY[s_a, s_d, s_f, s_h_inact, s_h_revoked, s_h_disc]
                || g1_v1 || g2_v2) AS sid;
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  SELECT sid, 'complete_with_warnings', now(),
         jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 73000, 'YYYY-MM-DD'), 'value', 0.001))
    FROM unnest(g2_v1) AS sid;

  -- Arm P's fixture is stale but only MODERATELY so — 30 days past a 4-day
  -- threshold, not the century the arms above use.
  --
  -- ⛔ THE MODERATION IS LOAD-BEARING AND IS NOT A STYLE CHOICE. The fan-out
  -- orders candidates `ORDER BY last_return_date ASC` and hands out BOUNDED
  -- slots (the per-venue cap and the per-tick LIMIT). A fixture dated further
  -- back than the G1/G2 cohorts would outrank them and STEAL those slots, and
  -- the stagger between g2_v1 and g2_v2 that makes arm G2's cap-neutering
  -- deterministic is itself built out of that ordering. Arm P needs only to be
  -- stale enough to appear in the staleness view while it is the sole promoted
  -- fixture; it must never be the OLDEST row on the table.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  VALUES (s_p, 'complete_with_warnings', now(),
          jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 30, 'YYYY-MM-DD'), 'value', 0.002)));

  -- Arm R's fixtures, stale on the same footing as arm P's.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  VALUES (s_r1, 'complete_with_warnings', now(),
          jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 29, 'YYYY-MM-DD'), 'value', 0.002)));
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  VALUES (s_r2, 'complete_with_warnings', now(),
          jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 28, 'YYYY-MM-DD'), 'value', 0.002)));

  -- Arm C's negative control: genuinely fresh, so is_stale is FALSE.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  VALUES (s_c, 'complete_with_warnings', now(),
          jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 1, 'YYYY-MM-DD'), 'value', 0.004)));

  -- Arm F's prior ATTEMPT: terminal (so the in-flight conjunct is not what is
  -- being measured), created 2 hours ago (so the 20-hour cooldown is).
  INSERT INTO compute_jobs (strategy_id, kind, status, created_at)
  VALUES (s_f, 'derive_broker_dailies', 'done', now() - INTERVAL '2 hours');

  RAISE NOTICE 'Seed OK.';

  -- ======================================================================
  -- ARM A — DORMANCY, MISSING ROW (LEDGER-02 / 164.7 C-03). There is NO
  -- public.system_flags row for the activation key. A maximally stale, fully
  -- eligible strategy is on the table and the function must still do NOTHING.
  --
  -- This is the arm that says "merging this migration changes no production
  -- behaviour", and it is ALSO the pinned rejection of the fail-OPEN
  -- missing-row branch in src/app/api/admin/match/send-intro/route.ts. That
  -- route treats `flagRow === null` as ENABLED, which is right for a kill
  -- switch defaulting ON and WRONG here: this is a dormant-by-default
  -- activation switch, so its absent state must be its closed state. C-03
  -- required that rejection to be PINNED rather than argued; this arm is the pin.
  --
  -- The DELETE runs inside the surrounding transaction and unwinds with the
  -- closing ROLLBACK. It is deliberately a DELETE and not "just don't seed the
  -- row": migration 20260907130000 SEEDS the row at apply time, so on any
  -- database where that migration has run the row EXISTS, and the missing-row
  -- state has to be created to be tested.
  -- ======================================================================
  -- RED-UNDER: make the fail-closed activation guard in 20260924120000
  --            NULL-UNSAFE — `IF v_enabled IS NOT NULL AND v_enabled IS
  --            DISTINCT FROM TRUE THEN`. A missing row leaves v_enabled NULL,
  --            the IF is no longer taken, and the body falls THROUGH to the
  --            fan-out instead of returning 0.
  -- ⚠️ WHY NOT the crude `IS DISTINCT FROM TRUE` -> `= FALSE` swap. MEASURED
  --    (164.7-03 neuter N1(a)): that removes the token 20260924120000's OWN
  --    verification block checks for at apply time (its check 6; and
  --    20260924120000's and 20260911130000's check 6 before them, which is where
  --    this was measured), so
  --    the migration ABORTS, the gate never runs, and no arm can be the first
  --    failure. Keeping the token and adding the NULL guard passes the
  --    migration's text check and still opens the flag on exactly the path this
  --    arm exists for — the two-layer lesson from plan 03, applied here.
  -- ⚠️ This twin ALSO reddens arm L (a raising read leaves v_enabled NULL too,
  --    so it falls through identically). Arm A executes FIRST, so the file's
  --    first failure is A and the identity is correct. A future reorder that
  --    put L ahead of A would report `wrong-first-failure: L` on this twin —
  --    that is the runner working, not a bug, and the fix would be to restore
  --    the order rather than to widen the mutation.
  -- ⚠️ The needle spans the NOTICE line, which names THIS function, so it is
  --    unique in a file holding both fan-out bodies. No `nth` is needed or used.
  -- RED-UNDER-M: {"arm":"A","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"IF v_enabled IS DISTINCT FROM TRUE THEN\n    RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: dormant","replace":"IF v_enabled IS NOT NULL AND v_enabled IS DISTINCT FROM TRUE THEN\n    RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: dormant","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id = s_a;

  DELETE FROM public.system_flags WHERE key = 'ledger_refresh_enabled';

  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (A): the fan-out returned % with NO activation row at all, expected 0 — a MISSING flag row is opening the switch. That is the send-intro fail-OPEN branch, which 164.7 C-03 explicitly rejects for this switch: a dormant-by-default activation must treat its absent state as its closed state, and merging this migration would change production behaviour', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_a;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (A): the fan-out inserted % job(s) with NO activation row at all, expected 0', v_cnt;
  END IF;

  -- ======================================================================
  -- ARM M1 — THE MISSING-ROW DORMANCY LEAVES A COUNTED TRACE
  --          (WR-10 cause 3 / APPGUC-WARNING-UNINSTRUMENTED-01).
  --
  -- Arm A above proved the fan-out DECLINED. It cannot prove anyone would ever
  -- KNOW. The dormant branch raises one NOTICE whose text is BYTE-IDENTICAL for
  -- the healthy "row present and FALSE" case and for the pathological "row
  -- absent, or invisible to this definer, while the platform believes itself
  -- live" case, and pg_cron keeps no NOTICE output — so cause 3 has been
  -- reaching nothing at all, on a schedule. 20260911130000 writes ONE counted
  -- public.cron_runs row naming the cause; this arm is what makes that
  -- falsifiable rather than asserted.
  --
  -- ⚠️ IT REUSES ARM A'S STATE DELIBERATELY. The flag row is already deleted and
  --    the fan-out has already been called, so this arm adds an ASSERTION, not a
  --    second call. A second call would write a second row and the `= 1` below
  --    would be measuring this file instead of the function.
  --
  -- ⚠️ READING A ROW THIS TRANSACTION JUST WROTE IS FINE, and is not the thing
  --    20260911130000's own verification block is forbidden to do (criterion 7,
  --    catalogue-only). That prohibition is about an APPLY-TIME read of
  --    committed state; this is the gate's own uncommitted write, and it unwinds
  --    with the closing ROLLBACK like every other write in this file.
  --
  -- ⚠️ EXACTLY ONE, not "at least one": a duplicate would mean the dormant
  --    branch is reached twice per call, which is its own defect.
  -- ======================================================================
  -- RED-UNDER: stop naming the cause — `v_cause := NULL;` in place of
  --            `v_cause := 'flag_row_invisible_or_absent';` in the SINGLE-KEY
  --            body of 20260924120000. The `IF v_cause IS NOT NULL` gate then
  --            skips the INSERT entirely: the decline still happens and reaches
  --            no counted instrument. Arm A stays GREEN (still 0 returned, still
  --            0 jobs), so this arm reddens alone.
  -- ⚠️ The cause literal is deliberately NOT one of that migration's own
  --    verification needles — its needle is the CONCATENATED
  --    `INSERT INTO public.` || `cron_runs` — so this mutation does not abort
  --    the apply, and the arm rather than the migration is the first failure.
  -- ⚠️ nth 1: the literal is assigned ONCE PER BODY and that file holds both, so
  --    it matches TWICE. `nth: 1` is the single-key body, MEASURED (its CREATE
  --    OR REPLACE is first in the file); the composite body is left UNMUTATED,
  --    which is what keeps the sibling gate's M1 independent of this one.
  -- RED-UNDER-M: {"arm":"M1","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"v_cause := 'flag_row_invisible_or_absent';","replace":"v_cause := NULL;","occurrences":2,"nth":1}]}
  SELECT count(*) INTO v_cnt_m1
    FROM public.cron_runs
   WHERE cron_name = 'ledger_refresh_fanout'
     AND error = 'flag_row_invisible_or_absent'
     AND metadata->>'function' = 'enqueue_ledger_refresh_for_strategies';
  IF v_cnt_m1 <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (M1): the fan-out declined with NO activation row and wrote % instrument row(s) naming flag_row_invisible_or_absent, expected exactly 1 — the decline reached no counted instrument (WR-10 cause 3 / APPGUC-WARNING-UNINSTRUMENTED-01). The dormant branch raises one NOTICE whose text is byte-identical for "the row says FALSE, as designed" and for "the row is absent or invisible to this definer while the platform believes itself live", and pg_cron keeps no NOTICE output, so without this row the second state is indistinguishable from the first and from a healthy, fully-fresh estate', v_cnt_m1;
  END IF;

  -- ======================================================================
  -- ARM K — DORMANCY, ROW PRESENT AND FALSE. The state migration 20260907130000
  -- actually leaves behind: the row exists and is closed. Arm A cannot cover
  -- this — a guard that opens on FALSE while still closing on NULL passes arm A
  -- and ships an activation switch that is on the moment an operator writes the
  -- row at all.
  -- ======================================================================
  -- RED-UNDER: make the guard in 20260924120000 fire ONLY on NULL —
  --            `IF v_enabled IS NULL AND v_enabled IS DISTINCT FROM TRUE THEN`.
  --            A FALSE row no longer takes the IF and the fan-out proceeds.
  -- ⚠️ Deliberately the MIRROR of arm A's twin, and that is the proof the two
  --    arms are not redundant: under this mutation arm A stays GREEN (NULL is
  --    still dormant) and only K reddens, while under arm A's twin K stays
  --    green. Neither mutation can redden both. The token
  --    `IS DISTINCT FROM TRUE` is preserved for the same apply-time reason arm
  --    A's twin preserves it.
  -- RED-UNDER-M: {"arm":"K","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"IF v_enabled IS DISTINCT FROM TRUE THEN\n    RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: dormant","replace":"IF v_enabled IS NULL AND v_enabled IS DISTINCT FROM TRUE THEN\n    RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: dormant","occurrences":1}]}
  INSERT INTO public.system_flags (key, enabled)
  VALUES ('ledger_refresh_enabled', FALSE)
  ON CONFLICT (key) DO UPDATE SET enabled = FALSE;

  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (K): the fan-out returned % with the activation row present and FALSE, expected 0 — this is the exact state migration 20260907130000 leaves on PROD, so a non-zero here means merging it starts the fan-out', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_a;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (K): the fan-out inserted % job(s) with the activation row present and FALSE, expected 0', v_cnt;
  END IF;

  -- ======================================================================
  -- ARM L — DORMANCY WHEN THE READ ITSELF RAISES, AND WITHOUT PROPAGATING.
  -- The switch used to be `current_setting(…, TRUE)`, which CANNOT raise. A
  -- table read can: dropped table, revoked privilege, planner fault. 164.7 D-01
  -- makes that path fail CLOSED, and this arm is the only executed proof of it.
  -- TWO properties, and both matter: the fan-out must return 0, and it must NOT
  -- propagate the error — an hourly cron that starts erroring is a page, not a
  -- dormancy.
  --
  -- ⛔ NO SAVEPOINT, of any spelling. This gate is one dollar-quoted DO block
  --    (⚠️ the quote token is NOT written out here: a literal doubled dollar
  --    sign inside this comment CLOSES the block, and psql then reports a
  --    syntax error hundreds of lines away — MEASURED on the first lane run of
  --    this arm, `syntax error at or near "…"` reported against the file's LAST
  --    line)
  -- and PL/pgSQL cannot parse transaction-control statements (TODOS
  -- [REDUNDER-SAVEPOINT]; test_enqueue_compute_job_dedupe_non_terminal.sql's
  -- header records the same 42601). The substitute is the RAISE-TO-ROLLBACK
  -- idiom plan 164.7-03 established: a plpgsql EXCEPTION block IS an implicit
  -- subtransaction, so raising a private SQLSTATE and catching exactly that
  -- SQLSTATE unwinds the block's work.
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
  --
  -- ⚠️ A `TEST FAILED (L)` raised by the inner handler carries P0001, not P0164,
  -- so the outer P0164-only handler does not swallow it: an unexpectedly
  -- RAISING fan-out reddens this arm by name instead of vanishing.
  -- ======================================================================
  -- RED-UNDER: make the guard's own EXCEPTION handler in 20260924120000 open
  --            the flag instead of closing it — `v_enabled := TRUE;` in place
  --            of `v_enabled := NULL;`. The read still fails, the handler now
  --            reports the failure as "enabled", and the fan-out proceeds and
  --            enqueues for the still-published stale candidate.
  -- ⚠️ This twin reddens L and ONLY L: arms A and K never make the read fail,
  --    so their handler never runs. It is the third mutually exclusive mutation
  --    of the same guard, which is why three arms and not one.
  -- ⚠️ The needle spans the WARNING text, which names THIS function, so it is
  --    unique in a file holding both fan-out bodies. No `nth` is needed or used.
  -- RED-UNDER-M: {"arm":"L","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"'enqueue_ledger_refresh_for_strategies: activation flag read failed (SQLSTATE %); treating as dormant', SQLSTATE;\n    v_enabled := NULL;","replace":"'enqueue_ledger_refresh_for_strategies: activation flag read failed (SQLSTATE %); treating as dormant', SQLSTATE;\n    v_enabled := TRUE;","occurrences":1}]}
  SET LOCAL lock_timeout = '2s';
  BEGIN
    ALTER TABLE public.system_flags RENAME TO system_flags_arm_l;
    BEGIN
      v_ret_l := public.enqueue_ledger_refresh_for_strategies();
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'TEST FAILED (L): the fan-out RAISED (SQLSTATE %) when its activation-flag read failed, instead of treating the failure as dormant and returning 0. An hourly cron that starts erroring is an incident; the guard is required to swallow the error, WARN with the SQLSTATE, and stay closed', SQLSTATE;
    END;
    -- ================================================================
    -- ARM M2 (its READ) — THE RAISING-READ DORMANCY LEAVES A COUNTED TRACE
    --                     (WR-10 cause 1 / APPGUC-WARNING-UNINSTRUMENTED-01).
    --
    -- ⛔ THE READ MUST SIT HERE AND NOWHERE ELSE, for two independent reasons
    --    that point at the same three lines:
    --      (i) AFTER the unwind it reads nothing. The `RAISE … 'P0164'` on the
    --          next line IS a rollback: it discards every write made inside this
    --          block, including the cron_runs row the fan-out just made. v_ret_l
    --          survives because a plpgsql local assignment is not transactional;
    --          a TABLE row does not.
    --     (ii) INSIDE the handler it would be a lint R1 violation and a vacuous
    --          read at once (scripts/lint-sql-gates.mjs, R1-exception-handler-
    --          probe): a SELECT … INTO in an EXCEPTION handler reads the state
    --          its own subtransaction rollback just restored. This is the block
    --          BODY, which is not a handler.
    --
    -- ⛔ AND ITS ASSERTION SITS AFTER ARM L'S, NOT HERE. Under arm L's own twin
    --    the handler reports the failed read as "enabled", the fan-out is no
    --    longer dormant, and NO instrument row is written — so an assertion at
    --    this point would be the FIRST failure under L's twin and the runner
    --    would report `wrong-first-failure`. v_cnt_m2 is a plpgsql local and
    --    survives the rollback exactly as v_ret_l does, so splitting the read
    --    from the assertion costs nothing and keeps both identities correct.
    -- ================================================================
    -- ⭐ THE `sqlstate` KEY IS PART OF THIS ARM'S PREDICATE, and it is the key's
    --    ONLY reader anywhere. The migration writes the failing read's SQLSTATE
    --    into `metadata` so that 42P01 (the table was dropped), 42501 (the
    --    privilege was revoked) and a planner fault stop reporting as one
    --    undifferentiated cause — and check 7 of that migration asserts the
    --    INSERT's own STATEMENT SHAPE, which survives deleting the key pair
    --    intact. Without this conjunct a tidy-up of the jsonb_build_object call
    --    silently collapses the three causes back into one with every gate
    --    green. With it, the deletion makes this count 0 and THIS arm reddens by
    --    name.
    --
    -- ⛔ PRESENCE, NEVER A VALUE. An equality on a SQLSTATE would bind the arm to
    --    whichever failure the RENAME above happens to provoke, which is the
    --    mistake the migration refuses for `error`. IS NOT NULL is falsifiable by
    --    the deletion and by nothing else.
    --
    -- ⚠️ ARM M1's TWIN PREDICATE IS DELIBERATELY NOT NARROWED THE SAME WAY: on
    --    the invisible-or-absent path there was no exception, so there was no
    --    SQLSTATE to read and the key is NULL BY CONSTRUCTION. Asserting it there
    --    would be an assertion that cannot hold.
    SELECT count(*) INTO v_cnt_m2
      FROM public.cron_runs
     WHERE cron_name = 'ledger_refresh_fanout'
       AND error = 'flag_read_failed'
       AND metadata->>'function' = 'enqueue_ledger_refresh_for_strategies'
       AND metadata->>'sqlstate' IS NOT NULL;
    RAISE EXCEPTION USING ERRCODE = 'P0164', MESSAGE = 'arm L: unwinding the RENAME (not a failure)';
  EXCEPTION WHEN SQLSTATE 'P0164' THEN
    NULL;
  END;
  IF v_ret_l <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (L): the fan-out returned % when its activation-flag read RAISED, expected 0 — the handler is treating a FAILED read as an OPEN switch, which is the one direction a fail-closed guard may never fail in', v_ret_l;
  END IF;

  -- ======================================================================
  -- ARM M2 (its ASSERTION) — see the block above for why the read is inside the
  -- unwound block and this is out here, one line below arm L's own assertion.
  -- ======================================================================
  -- RED-UNDER: stop naming the cause — `v_cause := NULL;` in place of
  --            `v_cause := 'flag_read_failed';` in the SINGLE-KEY body of
  --            20260924120000. The read still raises, the guard still closes,
  --            arm L still sees 0 — and the failure reaches no counted row, so
  --            only this arm reddens.
  -- ⚠️ Not a migration needle (the needle is the concatenated
  --    `INSERT INTO public.` || `cron_runs`), so the apply survives and the arm
  --    is the first failure. `nth: 1` is the single-key body, MEASURED: the
  --    literal is assigned once per body and the file holds both.
  --
  -- ⭐ THIS ARM NOW HAS A SECOND FALSIFIER, AND IT IS DELIBERATELY NOT A SECOND
  --    ARM. Deleting the `sqlstate` key pair from the migration's
  --    jsonb_build_object call also makes this count 0 and reddens this arm by
  --    name — that is the whole reason the conjunct was added, since nothing
  --    else anywhere reads the key. It is recorded in prose rather than
  --    annotated because a second RED-UNDER-M step is a second ARM, and the
  --    corpus arm count is ratcheted in both directions
  --    (scripts/mutation-runner/run.mjs ARMS_FLOOR, read by symbol, plus the
  --    stale-low detector in src/__tests__/mutation-runner-floors.test.ts).
  --    Moving that count is a separate, deliberate change and not a side effect
  --    of adding a conjunct. ⭐ PROVEN BY HAND on a real pg-lane 2026-09-12,
  --    against a scratch COPY of the migration so no tracked file was mutated:
  --    drop the sqlstate key pair from this body's jsonb_build_object call,
  --    leaving every other line of it intact, and the APPLY SURVIVES (the
  --    deletion is not a migration needle) while this arm is the FIRST failure —
  --    `TEST FAILED (M2): … wrote 0 instrument row(s) …`, lane exit 3. Unmutated,
  --    the same lane prints ALL 26 ARMS EXECUTED and exits 0.
  -- ⛔ THE TWO PROSE MENTIONS ABOVE CARRY THE COUNT ON PURPOSE AND MUST MOVE
  -- WITH IT. The anti-skip gate reads this file's sentinel with a
  -- `grep -aoE "ALL [0-9]+ ARMS EXECUTED" | head -1`, so the FIRST match in
  -- the file wins — and both of those are comments, hundreds of lines above
  -- the RAISE NOTICE that actually prints. MEASURED 2026-09-17: leaving them
  -- at 15 while the NOTICE said 18 made the gate read 15, disagree with
  -- ci.yml's derivation, and fail — with no hint that a COMMENT was the
  -- source. Prose here is load-bearing, not decoration.
  -- RED-UNDER-M: {"arm":"M2","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"v_cause := 'flag_read_failed';","replace":"v_cause := NULL;","occurrences":2,"nth":1}]}
  IF v_cnt_m2 <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (M2): the flag read RAISED and the fan-out wrote % instrument row(s) naming flag_read_failed AND carrying a non-NULL metadata->>''sqlstate'', expected exactly 1. The guard swallows the error and WARNs, which is correct and is exactly what arm L proves — but a WARNING is not a trace pg_cron keeps, so without this row a fan-out that has been failing its activation read on every tick for weeks is indistinguishable from one that is dormant by design. This is the APPGUC-WARNING-UNINSTRUMENTED-01 half of WR-10. A count of 0 here is EITHER no row at all OR a row whose `sqlstate` key has gone: the key is what separates 42P01 from 42501 from a planner fault, check 7 of the migration cannot see its deletion (that check asserts the statement shape of the INSERT, which survives), and this arm is the only reader of the key.', v_cnt_m2;
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
  --            20260924120000. The job still lands, so the count and
  --            target-shape assertions stay green — what reddens is the
  --            byte-for-byte marker the non-destructive failure guard in
  --            job_worker.py reads back before it declines to downgrade a
  --            published row.
  -- RED-UNDER-M: {"arm":"B","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"'source', 'ledger-refresh',","replace":"'source', 'ledger-refresh-drifted',","occurrences":1}]}
  -- ARM B — POSITIVE (LEDGER-01). Same seed, switch on.
  -- ======================================================================
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (B): the fan-out returned % for one eligible stale strategy, expected 1 — this integer is the INSERTION count the go-live runbook has the founder read back, so a wrong value there is a wrong answer at activation', v_ret;
  END IF;

  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_a AND kind = 'derive_broker_dailies';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (B): the eligible stale strategy got % derive_broker_dailies job(s), expected exactly 1', v_cnt;
  END IF;

  -- Strategy-scoped, and ONLY strategy-scoped. enqueue_compute_job enforces
  -- exactly-one-of {strategy, allocator, api_key} and raises 22023 otherwise
  -- (measured on PROD during the A7 tracer), so a fan-out that also passed a key
  -- would not enqueue at all — this shape assertion is what names that failure.
  SELECT strategy_id, portfolio_id, allocator_id, api_key_id, metadata ->> 'source'
    INTO v_strat, v_port, v_alloc, v_api, v_source
    FROM compute_jobs
   WHERE strategy_id = s_a AND kind = 'derive_broker_dailies'
   LIMIT 1;
  IF v_strat IS DISTINCT FROM s_a OR v_port IS NOT NULL OR v_alloc IS NOT NULL OR v_api IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B): job target shape wrong (strategy set=% portfolio=% allocator=% api_key=%) — expected strategy-only', (v_strat IS NOT NULL), v_port, v_alloc, v_api;
  END IF;

  -- EXACT equality, never IS NOT NULL and never LIKE. The Python guard in
  -- analytics-service/services/job_worker.py compares this string byte-for-byte
  -- before it declines to downgrade a published row; if the two spellings drift
  -- the fan-out still enqueues and the guard still compiles, and the only symptom
  -- is that the next failed refresh silently un-publishes a funded account. A
  -- typo must be RED here, not in production.
  IF v_source IS DISTINCT FROM 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (B): job metadata source is %, expected the exact refresh marker — the non-destructive failure guard keys on this string', COALESCE(v_source, '<null>');
  END IF;

  -- ======================================================================
  -- RED-UNDER: remove all three things that make a second tick a no-op, in one
  --            LAYERED mutation of 20260924120000: the 20-hour attempt cooldown
  --            (interval -> 0), the non-terminal in-flight guard (status set ->
  --            a status nothing holds), and the INSERTIONS-not-CALLS counter
  --            (v_existing = 0 dropped). All three are needed: leave any one in
  --            place and the second tick still returns 0 for a different reason,
  --            which would make a green here prove the wrong conjunct.
  -- ⚠️ `occurrences: 2, nth: 1`, BY MEASUREMENT (2026-09-24, Phase 164.6 plan
  --    03). 20260924120000 re-creates BOTH fan-out bodies again, single-key
  --    FIRST, so this needle matches TWICE there and `nth: 1` selects the
  --    single-key body; re-counted with `grep -c -F` on that file's final
  --    bytes before the swap. While 20260917120000 held the single-key body
  --    ALONE (Phase 164.5.1.1 plan 01) the same needle matched once and carried
  --    `occurrences: 1` with no `nth`. ⛔ Do not revert either half: a stale
  --    `occurrences: 1` makes the runner report occurrence-mismatch (the
  --    mutation not applied, so the arm not tested), and `nth: 2` would mutate
  --    the COMPOSITE body, which no arm in this file calls.
  -- ⭐ RE-COUNTED in the 164.6 review fix: each body now also carries a
  --    failed-attempt cooldown with the same 20-hour window, placed AFTER
  --    its attempt cooldown, so the interval step reads `occurrences: 4`
  --    and `nth: 1` still selects THIS body's attempt cooldown.
  -- RED-UNDER-M: {"arm":"E","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"INTERVAL '20 hours'","replace":"INTERVAL '0 hours'","occurrences":4,"nth":1},{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"AND cj2.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')","replace":"AND cj2.status IN ('cancelled')","occurrences":2,"nth":1},{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"IF v_existing = 0 AND v_job_id IS NOT NULL THEN","replace":"IF v_job_id IS NOT NULL THEN","occurrences":2,"nth":1}]}
  -- ARM E — DEDUPE. A second tick while the job is in flight adds nothing.
  -- ======================================================================
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (E): the second consecutive tick returned %, expected 0 (the in-flight conjunct plus the RPC dedupe)', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_a AND kind = 'derive_broker_dailies';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (E): after a second tick the strategy has % derive_broker_dailies jobs, expected 1', v_cnt;
  END IF;

  UPDATE strategies SET status = 'draft' WHERE id = s_a;

  -- ======================================================================
  -- ARM P — THE OWNER-ONLY TERMINAL LIFECYCLE STATUS IS SELECTED
  -- (Phase 164.5.1.1 / FANOUT-COHORT-PRIVATE-01). A stale, otherwise-eligible
  -- single-key strategy carrying that status IS enqueued.
  --
  -- ⛔ WHY THIS ARM EXISTS AT ALL, and why its absence was not a gap on paper
  -- but an OUTAGE in production. Until 2026-09-17 this file held 44 RED-UNDER
  -- arms and NONE of them touched that status: every fixture here is created
  -- `draft` and promoted to `published`. The gate was fully green while the
  -- function was USELESS in production — on the first tick after activation
  -- (pg_cron runid 11159, jobid 40, 08:25Z, `succeeded`) it selected ZERO
  -- strategies out of six stale ones, because every production strategy carries
  -- the status no arm here had ever promoted a fixture to. A green suite is not
  -- evidence about a value the suite never uses.
  --
  -- ⭐ PLACEMENT IS LOAD-BEARING IN TWO DIRECTIONS.
  --   * It sits with the single-fixture POSITIVE arms and BEFORE G1, G2 and H,
  --     which measure GLOBAL bounds — its fixture is parked again immediately
  --     after the assertion so it cannot occupy one of their bounded slots.
  --   * It must come FIRST IN FILE ORDER relative to the cohort-agreement arm
  --     that plan 02 of this phase adds. That arm reddens under a RELATED
  --     mutation, and the runner attributes a mutation to the FIRST
  --     `TEST FAILED (…)` in the lane's output — so if the cohort arm ran first,
  --     this arm's own twin would be scored against the wrong name and the
  --     runner would report a wrong-first-failure. ⛔ Do not move either arm
  --     past the other.
  --
  -- ⚠️ THE PARK BACK TO `draft` IS PART OF THE ARM, not tidy-up: leaving this
  -- fixture live would add a seventh competitor to arm G1's six and a
  -- thirteenth to arm G2's twelve, and both of those arms assert EXACT counts.
  -- ======================================================================
  -- RED-UNDER: revert the widening — put the lifecycle conjunct in
  --            20260924120000's candidate CTE back to the two-value set it
  --            carried before Phase 164.5.1.1. That is EXACTLY the production
  --            change this arm exists to hold in place, and it is the state
  --            PROD was measured in: the fixture stays stale, key-eligible,
  --            non-composite, uncooled and not in flight, so every OTHER
  --            conjunct still admits it and only the lifecycle set can refuse
  --            it. The fan-out then returns 0 and lands no job, and this arm is
  --            the first failure in the lane.
  --
  -- ⛔ THE MIGRATION'S OWN APPLY-TIME BLOCK DOES NOT ASSERT THIS LITERAL, AND
  --    THAT IS WHY THIS MUTATION IS OBSERVABLE AT ALL. A `position()` needle on
  --    the three-value set in 20260917120000's DO $verify$ block would RAISE
  --    under this very mutation, abort the apply, and stop the lane before a
  --    single arm ran — `no-red` for a mutation that never reached a gate. The
  --    DISJOINTNESS section of that migration records the decision;
  --    scripts/mutation-runner/GRAMMAR.md rule 2 records a real instance of that
  --    abort. What the migration asserts instead is the conjunct's SHAPE, bound
  --    to the column, which this mutation preserves by construction.
  -- RED-UNDER-M: {"arm":"P","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"AND s.status IN ('published', 'pending_review', 'private')","replace":"AND s.status IN ('published', 'pending_review')","occurrences":1}]}
  UPDATE strategies SET status = 'private' WHERE id = s_p;

  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (P): a stale, otherwise-eligible strategy carrying the owner-only terminal lifecycle status produced % enqueue(s), expected exactly 1 — it was NOT ENQUEUED. Every other conjunct admits this fixture: it is stale, non-composite, its key is active, unrevoked and connected, it has no attempt inside the 20-hour cooldown and nothing of its own in flight. Only the lifecycle set can be refusing it. This is the PRODUCTION state measured on 2026-09-17: the fan-out ran, was not dormant, and selected zero of six stale strategies because every live strategy carries this status and the conjunct did not admit it', v_ret;
  END IF;

  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_p AND kind = 'derive_broker_dailies';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (P): the strategy carrying the owner-only terminal lifecycle status got % derive_broker_dailies job(s), expected exactly 1. The return value and the row count are asserted separately on purpose — a body that counted an enqueue it did not perform would satisfy the first and fail here', v_cnt;
  END IF;

  UPDATE strategies SET status = 'draft' WHERE id = s_p;

  -- ======================================================================
  -- ARM Q — COHORT AGREEMENT. THE STALENESS VIEW AND THE FAN-OUT MAY NOT
  -- DISAGREE ABOUT WHICH LIFECYCLE STATUSES ARE IN PLAY
  -- (Phase 164.5.1.1 plan 02 / CTX-06 / TODOS [FANOUT-COHORT-PRIVATE-01]).
  --
  -- ⭐ THE ONLY ARM IN THIS FILE THAT MEASURES A CLASS RATHER THAN AN INSTANCE,
  -- and the class is the defect this phase actually repairs. The owner-only
  -- terminal status shipped in July 2026, the fan-out shipped in September
  -- 2026, and NOTHING EVER COMPARED THE TWO. `ledger_refresh_staleness` carries
  -- no lifecycle predicate at all — MEASURED in 20260825120000, whose
  -- `strategy_venue` CTE selects FROM public.strategies with no WHERE — so it
  -- surfaces a strategy of ANY status as stale. The fan-out carries a
  -- hand-written literal, so it admits only what somebody remembered. Six stale
  -- rows, zero eligible. Arm P above holds the INSTANCE in place; this arm is
  -- what makes a SIXTH status impossible to ship silently.
  --
  -- ⛔ BOTH SETS COME FROM THE CATALOGUE AND NEITHER IS WRITTEN DOWN HERE. The
  -- domain comes from `pg_get_constraintdef('strategies_status_check')`; the
  -- admitted set from a comment-stripped `pg_get_functiondef` of the deployed
  -- fan-out. A hand-written list inside this arm would reproduce, INSIDE THE
  -- CONTROL, the exact defect the control exists to catch, and it would rot on
  -- precisely the day nobody remembers this arm is here. The ONLY statuses
  -- spelled out below are the two DELIBERATE EXCLUSIONS from CONTEXT.md —
  -- `draft` (a draft strategy has no factsheet to refresh) and `archived` (not
  -- a refresh candidate) — and they are skipped BY NAME, as exclusions, so that
  -- adding a third one has to be written down here where it is read.
  --
  -- ⛔ THE SEARCH IS SCOPED TO THE EXTRACTED CONJUNCT LIST, NEVER TO THE WHOLE
  -- BODY. A status name occurs in the body for reasons that have nothing to do
  -- with eligibility — the in-flight guard's `cj2.status IN (…)` set is four
  -- job statuses, and a comment could name any lifecycle value at all. Matching
  -- the whole body would pass for the wrong reason and could never fail.
  --
  -- ⛔ COULD NOT MEASURE IS NOT MEASURED ZERO, and this arm raises rather than
  -- passes in BOTH unmeasurable states: a NULL constraint definition (the
  -- domain migration has fallen out of the apply list) and a lifecycle conjunct
  -- it cannot locate (the predicate was re-spelled). A third guard counts the
  -- statuses the loop actually asserted, because an empty scan and a clean scan
  -- are identical to every numeric test — which is exactly how a broken gate
  -- passes behind a green board.
  --
  -- ⭐ PLACEMENT IS LOAD-BEARING AND IT IS NOT TIDINESS. This arm MUST stay
  -- AFTER arm P. Arm P's twin reverts the widening, which would redden BOTH
  -- arms — this one included, because the reverted body no longer admits a
  -- status the CHECK constraint still does. The runner attributes a mutation to
  -- the FIRST `TEST FAILED (…)` in the lane's output, so with this arm placed
  -- first, arm P's own twin would be scored against the name `Q` and the runner
  -- would report a wrong-first-failure for P. Placed after, P fails first under
  -- P's twin (correct) and this arm reddens alone under its own, whose mutation
  -- touches no function body at all. ⛔ Moving either arm past the other is a
  -- REAL CHANGE with a measurable consequence, not a reorder.
  -- ======================================================================
  -- RED-UNDER: the mutation that must redden this arm is the ARRIVAL OF A NEW
  --            STATUS, not the removal of the one this phase added — that
  --            latter one is arm P's, and it reddens arm P first by
  --            construction. So the twin adds a SIXTH value to the
  --            `ADD CONSTRAINT` literal list in 20260716130000 and touches the
  --            fan-out not at all: the catalogue then admits a status the
  --            deployed body does not name and is not one of the two
  --            exclusions, which is the class state itself. That is the only
  --            mutation that proves this arm catches a FUTURE status rather
  --            than the present one.
  --
  -- ⛔ THE NEEDLE IS THE `ADD CONSTRAINT` FORM AND NOT THE PRE-FLIGHT FORM.
  --    20260716130000 carries its five-value list TWICE — once in the
  --    pre-flight `WHERE status NOT IN (…)` guard and once in the
  --    `ADD CONSTRAINT … CHECK (status IN (…))`. Measured at these bytes: the
  --    bare parenthesised list occurs 2 times, the `CHECK (status IN (…));`
  --    form exactly 1. An ambiguous needle is an `occurrence-mismatch`
  --    MEASURE_FAIL, which means the arm was never tested at all — GRAMMAR
  --    rule 2.
  -- ⛔ AND THE MUTATION DOES NOT ABORT THAT MIGRATION'S OWN APPLY, which is
  --    why it is observable: 20260716130000's self-verifying DO block asserts
  --    that each of the five values is PRESENT in the constraint definition,
  --    and adding a sixth preserves all five. The same DISJOINTNESS reasoning
  --    arm P's block states one migration over.
  -- RED-UNDER-M: {"arm":"Q","apply":[{"kind":"edit","file":"supabase/migrations/20260716130000_strategies_status_private.sql","find":"CHECK (status IN ('draft', 'pending_review', 'published', 'archived', 'private'));","replace":"CHECK (status IN ('draft', 'pending_review', 'published', 'archived', 'private', 'quarantined'));","occurrences":1}]}
  SELECT pg_get_constraintdef(c.oid)
    INTO v_domain_def
    FROM pg_constraint c
   WHERE c.conname = 'strategies_status_check'
     AND c.conrelid = 'public.strategies'::regclass;
  IF v_domain_def IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Q): COULD NOT MEASURE — public.strategies carries no constraint named strategies_status_check on this database, so the lifecycle DOMAIN this arm compares the fan-out against does not exist and the comparison was never performed. This is NOT the same answer as "the sets agree": an absent domain and an empty disagreement are indistinguishable to every numeric test, which is how a gate that asserts nothing passes behind a green board. The likely cause is supabase/migrations/20260716130000_strategies_status_private.sql having fallen out of this file''s RED-UNDER-SETUP apply list — the pg-lane core fixture declares strategies.status as a bare TEXT with no constraint, so that entry is the only thing that puts the real domain on a lane.';
  END IF;

  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
    INTO v_fanout_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'enqueue_ledger_refresh_for_strategies'
     AND p.pronargs = 0;

  v_admitted := substring(v_fanout_def FROM 's\.status\s+IN\s+\(([^)]*)\)');
  IF v_admitted IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (Q): COULD NOT MEASURE — the comment-stripped body of public.enqueue_ledger_refresh_for_strategies carries no `s.status IN (…)` conjunct that this arm can locate, so the ADMITTED set could not be extracted and the cohort comparison was never performed. A re-spelled eligibility predicate must break this arm LOUDLY rather than silently widen it to "anything goes": with no extraction, every status would trivially appear in nothing and the loop below would report agreement it never measured. If the predicate was deliberately re-spelled, re-point this extraction at the new spelling in the same commit — do NOT relax it to a whole-body search, which matches a status name occurring in any other predicate or in prose and therefore passes for the wrong reason.';
  END IF;

  v_checked := 0;
  FOR v_status IN
    SELECT DISTINCT t.parts[1]
      FROM regexp_matches(v_domain_def, '''([^'']+)''', 'g') AS t(parts)
  LOOP
    -- The two DELIBERATE EXCLUSIONS (CONTEXT.md, CTX-06). They are the only
    -- lifecycle values this arm spells, and they are spelled as exclusions.
    IF v_status IN ('draft', 'archived') THEN
      CONTINUE;
    END IF;
    v_checked := v_checked + 1;
    IF position('''' || v_status || '''' IN v_admitted) = 0 THEN
      RAISE EXCEPTION 'TEST FAILED (Q): the lifecycle status % is admitted by public.strategies'' own CHECK constraint, so a live strategy can carry it; public.ledger_refresh_staleness applies NO lifecycle predicate, so it will surface such a strategy as stale; the deployed body of enqueue_ledger_refresh_for_strategies admits only [%], which does not name it; and it is not one of the two deliberate exclusions (draft has no factsheet to refresh, archived is not a refresh candidate). The view and the fan-out therefore DISAGREE ABOUT THE COHORT, and a production tick will enqueue nothing for every strategy carrying that status while the staleness census keeps reporting them stale — silently, with a succeeded cron row and a "1 row" return message. That is TODOS [FANOUT-COHORT-PRIVATE-01] exactly, which was measured on PROD as 6 stale rows and 0 eligible. Either admit the status in the fan-out''s conjunct, or add it to this arm''s named exclusions with the reason written down.', v_status, v_admitted;
    END IF;
  END LOOP;

  IF v_checked = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Q): COULD NOT MEASURE — zero lifecycle statuses were extracted from the constraint definition [%], so the loop above asserted NOTHING and its silence is not evidence. An empty scan and a clean scan are identical to every numeric test. The constraint exists but this arm could not read quoted literals out of it, which means the rendering of pg_get_constraintdef changed shape (an enum-backed domain, or a CHECK re-expressed without quoted literals) and the extraction must be re-pointed at the new shape.', v_domain_def;
  END IF;

  -- ======================================================================
  -- ARM C — NEGATIVE CONTROL. A FRESH single-key strategy is not enqueued.
  -- Without this arm, a body that enqueues everything passes arm B.
  -- ======================================================================
  -- RED-UNDER: make the staleness conjunct in 20260924120000's candidate CTE
  --            vacuous (`WHERE lrs.is_stale` -> `WHERE (lrs.is_stale OR TRUE)`).
  --            Only s_c is published at this point, so no earlier arm's cohort
  --            changes; the fresh strategy becomes a candidate and every ledger
  --            strategy would be refreshed on every tick.
  -- ⚠️ `occurrences: 2, nth: 1`, BY MEASUREMENT (2026-09-24, Phase 164.6 plan
  --    03). 20260924120000 re-creates BOTH fan-out bodies again, single-key
  --    FIRST, so this needle matches TWICE there and `nth: 1` selects the
  --    single-key body; re-counted with `grep -c -F` on that file's final
  --    bytes before the swap. While 20260917120000 held the single-key body
  --    ALONE (Phase 164.5.1.1 plan 01) the same needle matched once and carried
  --    `occurrences: 1` with no `nth`. ⛔ Do not revert either half: a stale
  --    `occurrences: 1` makes the runner report occurrence-mismatch (the
  --    mutation not applied, so the arm not tested), and `nth: 2` would mutate
  --    the COMPOSITE body, which no arm in this file calls.
  -- RED-UNDER-M: {"arm":"C","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"WHERE lrs.is_stale","replace":"WHERE (lrs.is_stale OR TRUE)","occurrences":2,"nth":1}]}
  UPDATE strategies SET status = 'published' WHERE id = s_c;
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (C): a FRESH strategy produced % enqueue(s), expected 0 — the staleness gate is not bounding the cohort and every ledger strategy would be refreshed on every tick', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_c;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (C): a FRESH strategy got % job(s), expected 0', v_cnt;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id = s_c;

  -- ======================================================================
  -- ARM D — COMPOSITE EXCLUSION (D-01). A stale composite gets NOTHING from
  -- this function: not a derive (it has no api_key_id for strategy-mode to
  -- resolve) and not a stitch either (this function owns only the single-key
  -- arm; the composite arm ships separately).
  --
  -- ⚠️ This arm is only meaningful if the composite REACHES the is_composite
  -- conjunct. The migration's api_keys join is LEFT and its key-eligibility
  -- conjuncts are NULL-tolerant precisely so it does. Before trusting a GREEN
  -- here, delete the is_composite conjunct and re-run: this arm MUST redden. If
  -- it stays green, the composite is being excluded by the join or by a key
  -- conjunct instead, the exclusion is unfalsifiable, and the predicate — not
  -- this arm — is what needs fixing.
  -- ======================================================================
  -- RED-UNDER: delete the composite exclusion in 20260924120000 —
  --            `AND lrs.is_composite = FALSE` -> `AND lrs.is_composite IS NOT NULL`.
  --            This is the re-run this arm's own ⚠️ note demands before any
  --            green here is trusted: the composite REACHES the conjunct (the
  --            api_keys join is LEFT and the key conjuncts are NULL-tolerant),
  --            so it is is_composite, and nothing else, that excludes it.
  -- RED-UNDER-M: {"arm":"D","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"AND lrs.is_composite = FALSE","replace":"AND lrs.is_composite IS NOT NULL","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id = s_d;
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D): a stale COMPOSITE produced % enqueue(s), expected 0 — strategy-mode derive resolves its key through strategies.api_key_id, which a composite has NULL, so it cannot serve one at all', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_d AND kind = 'derive_broker_dailies';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D): a stale COMPOSITE got % derive_broker_dailies job(s), expected 0', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_d AND kind = 'stitch_composite';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D): this function enqueued % stitch_composite job(s) — it owns the single-key arm only', v_cnt;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id = s_d;

  -- ======================================================================
  -- ARM F — ATTEMPT COOLDOWN (D-09). This is the BINDING bound: it is what
  -- stops a permanently-failing strategy being hammered every tick, and it is
  -- what caps the outstanding backlog at the cohort size regardless of tick
  -- rate. Both edges, so the interval cannot drift silently.
  -- ======================================================================
  -- RED-UNDER: narrow the ATTEMPT cooldown in 20260924120000 from 20 hours to
  --            1 hour. The fixture's prior attempt is 2 hours old, so the
  --            narrowed window no longer covers it and the strategy is
  --            re-enqueued — a permanently-failing strategy would get a job
  --            every tick. Arm E's second tick is unaffected: its job is created
  --            inside this transaction, so it is still inside a 1-hour window.
  -- ⚠️ `occurrences: 2, nth: 1`, BY MEASUREMENT (2026-09-24, Phase 164.6 plan
  --    03). 20260924120000 re-creates BOTH fan-out bodies again, single-key
  --    FIRST, so this needle matches TWICE there and `nth: 1` selects the
  --    single-key body; re-counted with `grep -c -F` on that file's final
  --    bytes before the swap. While 20260917120000 held the single-key body
  --    ALONE (Phase 164.5.1.1 plan 01) the same needle matched once and carried
  --    `occurrences: 1` with no `nth`. ⛔ Do not revert either half: a stale
  --    `occurrences: 1` makes the runner report occurrence-mismatch (the
  --    mutation not applied, so the arm not tested), and `nth: 2` would mutate
  --    the COMPOSITE body, which no arm in this file calls.
  -- ⭐ RE-COUNTED in the 164.6 review fix: each body now also carries a
  --    failed-attempt cooldown with the same 20-hour window, placed AFTER
  --    its attempt cooldown, so the interval step reads `occurrences: 4`
  --    and `nth: 1` still selects THIS body's attempt cooldown.
  -- RED-UNDER-M: {"arm":"F","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"INTERVAL '20 hours'","replace":"INTERVAL '1 hour'","occurrences":4,"nth":1}]}
  UPDATE strategies SET status = 'published' WHERE id = s_f;
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (F): a strategy attempted 2 hours ago produced % enqueue(s), expected 0 — without the cooldown a permanently-failing strategy gets a job every tick', v_ret;
  END IF;

  UPDATE compute_jobs SET created_at = now() - INTERVAL '21 hours'
   WHERE strategy_id = s_f AND kind = 'derive_broker_dailies';

  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (F): a strategy whose last attempt is 21 hours old produced % enqueue(s), expected 1 — the cooldown has been widened past its derivation and stale strategies would never be refreshed', v_ret;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id = s_f;

  -- ======================================================================
  -- ARM G1 — the PER-VENUE CAP (D-09). Six stale eligible strategies on ONE
  -- venue. With a per-tick LIMIT of 4 and a per-venue cap of 2, only the CAP
  -- can produce 2; delete the cap and this tick yields 4. That discrimination
  -- is the whole point, and it is why the LIMIT must stay strictly greater
  -- than the cap.
  --
  -- ⚠️ Counts, never a duration or a rate. This arm pins the SHAPE of the
  -- bound. The safety argument is arm F's cooldown, NOT this LIMIT — see D-09.
  -- ======================================================================
  -- RED-UNDER: widen the PER-VENUE cap in 20260924120000 from
  --            `venue_rank <= 2` to `venue_rank <= 4`. The per-tick LIMIT is 4
  --            and this cohort is 6 on ONE venue, so with the cap gone the
  --            global LIMIT bounds the tick at 4 instead — exactly the "a venue
  --            that serialises every job starves every other venue" result this
  --            arm names, and the discrimination the LIMIT-strictly-greater-
  --            than-cap rule exists to preserve.
  -- RED-UNDER-M: {"arm":"G1","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"WHERE c.venue_rank <= 2","replace":"WHERE c.venue_rank <= 4","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id = ANY(g1_v1);
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (G1): 6 stale strategies on ONE venue produced % enqueue(s), expected exactly 2 — the per-venue cap. A result of 4 means the cap is gone and the global LIMIT bound the tick instead; a venue that serialises every job on one shared terminal registry would then starve every other venue', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = ANY(g1_v1) AND kind = 'derive_broker_dailies';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (G1): % derive_broker_dailies rows landed for the single-venue cohort, expected exactly 2', v_cnt;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id = ANY(g1_v1);

  -- ======================================================================
  -- ARM G2 — the SPREAD, and the LIMIT's lower edge (D-09). Six stale on each
  -- of TWO venues: the tick spreads across venues (2 + 2) instead of exhausting
  -- the oldest one, and it stops at 4.
  --
  -- ⚠️ Stated precisely, because overclaiming here would be the same species of
  -- error as a wrong derivation. With two venues and a cap of 2, four is ALSO
  -- the ceiling the cap alone imposes, so this arm does not by itself prove the
  -- LIMIT is exactly 4. What it does pin: the 2/2 SPREAD (delete the cap and the
  -- older venue takes all four — the date stagger in the seed makes that
  -- deterministic), and the LIMIT's LOWER edge (drop it below 4 and this arm
  -- reddens). The UPPER edge is plan 05 gate 5, which asserts statically that the
  -- LIMIT is at most 4 and strictly greater than the cap. Neither half is
  -- sufficient alone; together they pin the integer.
  -- ======================================================================
  -- RED-UNDER: lower the per-tick LIMIT in 20260924120000 from 4 to 3. This is
  --            the LOWER edge this arm's own note says it pins (the UPPER edge
  --            is the static gate). The needle carries its indentation: the
  --            unindented `LIMIT 4` at :194 is PROSE, and mutating a comment
  --            would be a no-op reported as a non-biting arm.
  -- RED-UNDER-M: {"arm":"G2","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"       LIMIT 4","replace":"       LIMIT 3","occurrences":1}]}
  UPDATE strategies SET status = 'published' WHERE id = ANY(g2_v1) OR id = ANY(g2_v2);
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 4 THEN
    RAISE EXCEPTION 'TEST FAILED (G2): 6 stale strategies on each of two venues produced % enqueue(s), expected exactly 4 — the per-tick burst LIMIT has been lowered below its derivation', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = ANY(g2_v1) AND kind = 'derive_broker_dailies';
  SELECT count(*) INTO v_cnt2 FROM compute_jobs
   WHERE strategy_id = ANY(g2_v2) AND kind = 'derive_broker_dailies';
  IF v_cnt <> 2 OR v_cnt2 <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (G2): the tick landed %/% jobs across the two venues, expected 2/2 — a tick that exhausts one venue before touching the other is exactly the starvation the partition exists to prevent', v_cnt, v_cnt2;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id = ANY(g2_v1) OR id = ANY(g2_v2);

  -- ======================================================================
  -- ARM H — KEY ELIGIBILITY. Three sub-cases, each a stale strategy whose key
  -- is disqualified for a different reason. A revoked or soft-disconnected key
  -- keeps is_active = TRUE (rows persist for audit), so is_active alone does
  -- not cover the other two.
  -- ======================================================================
  -- RED-UNDER: point the REVOKED-key conjunct in 20260924120000 at a status no
  --            key ever holds, so a revoked key is admitted. The aggregate arm
  --            reads the RETURN value, so any one of the three sub-cases
  --            leaking is enough to redden it.
  -- ⚠️ `occurrences: 2, nth: 1`, BY MEASUREMENT (2026-09-24, Phase 164.6 plan
  --    03). 20260924120000 re-creates BOTH fan-out bodies again, single-key
  --    FIRST, so this needle matches TWICE there and `nth: 1` selects the
  --    single-key body; re-counted with `grep -c -F` on that file's final
  --    bytes before the swap. While 20260917120000 held the single-key body
  --    ALONE (Phase 164.5.1.1 plan 01) the same needle matched once and carried
  --    `occurrences: 1` with no `nth`. ⛔ Do not revert either half: a stale
  --    `occurrences: 1` makes the runner report occurrence-mismatch (the
  --    mutation not applied, so the arm not tested), and `nth: 2` would mutate
  --    the COMPOSITE body, which no arm in this file calls.
  -- RED-UNDER-M: {"arm":"H","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"AND ak.sync_status IS DISTINCT FROM 'revoked'","replace":"AND ak.sync_status IS DISTINCT FROM 'never-a-real-status'","occurrences":2,"nth":1}]}
  UPDATE strategies SET status = 'published' WHERE id IN (s_h_inact, s_h_revoked, s_h_disc);
  v_ret := public.enqueue_ledger_refresh_for_strategies();
  IF v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H): strategies whose keys are inactive / revoked / disconnected produced % enqueue(s), expected 0', v_ret;
  END IF;

  -- RED-UNDER: make the is_active conjunct in 20260924120000 vacuous, with the
  --            aggregate arm H NEUTERED — H reads the RETURN value and fires
  --            first on any leak at all, so it must be suppressed for the
  --            per-fixture row count to be the first failure. The other two
  --            sub-case fixtures stay excluded by their own conjuncts, so this
  --            names the INACTIVE case alone.
  -- ⚠️ `occurrences: 2, nth: 1`, BY MEASUREMENT (2026-09-24, Phase 164.6 plan
  --    03). 20260924120000 re-creates BOTH fan-out bodies again, single-key
  --    FIRST, so this needle matches TWICE there and `nth: 1` selects the
  --    single-key body; re-counted with `grep -c -F` on that file's final
  --    bytes before the swap. While 20260917120000 held the single-key body
  --    ALONE (Phase 164.5.1.1 plan 01) the same needle matched once and carried
  --    `occurrences: 1` with no `nth`. ⛔ Do not revert either half: a stale
  --    `occurrences: 1` makes the runner report occurrence-mismatch (the
  --    mutation not applied, so the arm not tested), and `nth: 2` would mutate
  --    the COMPOSITE body, which no arm in this file calls.
  -- RED-UNDER-M: {"arm":"H/inactive","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"AND COALESCE(ak.is_active, TRUE)","replace":"AND (COALESCE(ak.is_active, TRUE) OR TRUE)","occurrences":2,"nth":1}],"neuter":[{"arm":"H"}]}
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_h_inact;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H/inactive): an INACTIVE key produced % job(s), expected 0', v_cnt;
  END IF;
  -- RED-UNDER: as H, with arm H neutered so the per-fixture count is the first
  --            failure. A revoked key keeps is_active TRUE, so this sub-case is
  --            reachable ONLY through the sync_status conjunct — which is the
  --            claim the arm makes in its own message.
  -- ⚠️ `occurrences: 2, nth: 1`, BY MEASUREMENT (2026-09-24, Phase 164.6 plan
  --    03). 20260924120000 re-creates BOTH fan-out bodies again, single-key
  --    FIRST, so this needle matches TWICE there and `nth: 1` selects the
  --    single-key body; re-counted with `grep -c -F` on that file's final
  --    bytes before the swap. While 20260917120000 held the single-key body
  --    ALONE (Phase 164.5.1.1 plan 01) the same needle matched once and carried
  --    `occurrences: 1` with no `nth`. ⛔ Do not revert either half: a stale
  --    `occurrences: 1` makes the runner report occurrence-mismatch (the
  --    mutation not applied, so the arm not tested), and `nth: 2` would mutate
  --    the COMPOSITE body, which no arm in this file calls.
  -- RED-UNDER-M: {"arm":"H/revoked","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"AND ak.sync_status IS DISTINCT FROM 'revoked'","replace":"AND ak.sync_status IS DISTINCT FROM 'never-a-real-status'","occurrences":2,"nth":1}],"neuter":[{"arm":"H"}]}
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_h_revoked;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H/revoked): a REVOKED key produced % job(s), expected 0 — a revoked key keeps is_active TRUE, so the is_active conjunct alone does not cover this case', v_cnt;
  END IF;
  -- RED-UNDER: make the soft-disconnect conjunct in 20260924120000 vacuous,
  --            with arm H neutered. A soft-disconnected key also keeps
  --            is_active TRUE and a non-revoked sync_status, so only this
  --            conjunct can exclude it.
  -- ⚠️ `occurrences: 2, nth: 1`, BY MEASUREMENT (2026-09-24, Phase 164.6 plan
  --    03). 20260924120000 re-creates BOTH fan-out bodies again, single-key
  --    FIRST, so this needle matches TWICE there and `nth: 1` selects the
  --    single-key body; re-counted with `grep -c -F` on that file's final
  --    bytes before the swap. While 20260917120000 held the single-key body
  --    ALONE (Phase 164.5.1.1 plan 01) the same needle matched once and carried
  --    `occurrences: 1` with no `nth`. ⛔ Do not revert either half: a stale
  --    `occurrences: 1` makes the runner report occurrence-mismatch (the
  --    mutation not applied, so the arm not tested), and `nth: 2` would mutate
  --    the COMPOSITE body, which no arm in this file calls.
  -- RED-UNDER-M: {"arm":"H/disconnected","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"AND ak.disconnected_at IS NULL","replace":"AND (ak.disconnected_at IS NULL OR TRUE)","occurrences":2,"nth":1}],"neuter":[{"arm":"H"}]}
  SELECT count(*) INTO v_cnt FROM compute_jobs WHERE strategy_id = s_h_disc;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (H/disconnected): a DISCONNECTED key produced % job(s), expected 0 — a soft-disconnected key also keeps is_active TRUE', v_cnt;
  END IF;

  -- ======================================================================
  -- ARM I — THE EXECUTE ACL, RE-ASSERTED ON EVERY RUN (161.1-AUDIT F-1).
  --
  -- Migration 20260825130000's DO block already checks this — ONCE, at apply. A later
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
  --            rather than an edit to the REVOKE in 20260825130000 because that
  --            migration's own DO block asserts the same privilege and would
  --            ABORT THE APPLY, so the gate would never run. The lane's
  --            --post-apply hook exists for exactly this shape.
  -- RED-UNDER-M: {"arm":"I","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.enqueue_ledger_refresh_for_strategies() TO anon"}]}
  IF has_function_privilege('anon', 'public.enqueue_ledger_refresh_for_strategies()', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (I): role anon can EXECUTE enqueue_ledger_refresh_for_strategies. This is a cross-tenant SECURITY DEFINER enqueue path and the REVOKE at 20260825130000 is the only thing bounding it';
  END IF;
  IF has_function_privilege('authenticated', 'public.enqueue_ledger_refresh_for_strategies()', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (I): role authenticated can EXECUTE enqueue_ledger_refresh_for_strategies. Both NOT EXISTS guards in its body go vacuously TRUE for that role (strategies_read grants it its own rows; compute_jobs FORCE-RLS grants it none), so this is unbounded self-scoped enqueue every tick — the REVOKE at 20260825130000 is the only thing closing it';
  END IF;

  -- ======================================================================
  -- ARM J — THE DEFINER'S RLS EXEMPTION, RE-ASSERTED ON EVERY RUN
  --         (161.1-REVIEW, RLS audit).
  --
  -- Same weakness as arm I, one property over. Migration 20260825130000's DO
  -- block pins proowner's exemption ONCE, at apply. Ownership drifts for
  -- reasons that have nothing to do with this function: a restore-from-dump, an
  -- `ALTER FUNCTION … OWNER TO`, a platform role-template change, a REASSIGN
  -- OWNED. The ACL arms exist because an apply-time-only pin is not a durable
  -- pin; this arm says the same thing about ownership.
  --
  -- ⛔ WHY THIS IS THE WORST SILENT FAILURE IN THE PHASE. It leaks NOTHING — it
  -- is fail-CLOSED — and that is exactly what makes it dangerous. This function
  -- is SECURITY DEFINER, so every read in its body runs as the OWNER, and it
  -- reads ledger_refresh_staleness, a `security_invoker` view. Drift the owner
  -- to a role exempt from RLS by neither route and the owner-scoped policies on
  -- api_keys / strategy_keys resolve `exchanges` to the empty array; the
  -- terminal `&&` venue conjunct then drops EVERY candidate row and the fan-out
  -- returns 0 on every tick, forever. Zero enqueued, zero errors, green cron —
  -- byte-identical to a healthy, fully-fresh estate. Nothing downstream can
  -- tell the two apart, so if this is not asserted here it is not asserted
  -- anywhere the drift would actually be caught.
  --
  -- ⚠️ rolsuper OR rolbypassrls, matching the migration — NOT rolbypassrls
  -- alone. pg_roles.rolbypassrls reports only the EXPLICITLY GRANTED attribute;
  -- a superuser bypasses RLS unconditionally with the flag still FALSE. An arm
  -- pinning rolbypassrls alone would redden on an owner that can in fact see
  -- the whole cohort, and would contradict the predicate the migration applies.
  --
  -- ⚠️ NOT VACUOUS WHEN THE FUNCTION IS GONE. Unlike arm I, this arm cannot
  -- lean on has_function_privilege's 42883: a bare SELECT over pg_proc for an
  -- absent proname returns ZERO ROWS, leaves all three variables NULL, and
  -- `NOT (COALESCE(NULL,FALSE) OR COALESCE(NULL,FALSE))` would be TRUE — the
  -- arm would fire with a misleading message about a role called <NULL>. The
  -- explicit v_owner IS NULL guard below is what turns "nothing to check" into
  -- its own named failure rather than a passing or mis-diagnosed one.
  -- ======================================================================
  -- RED-UNDER: ownership drift on the live lane — `ALTER FUNCTION … OWNER TO` a
  --            role that is exempt from row security by NEITHER route. Editing
  --            20260825130000 cannot reach this arm: its own DO block asserts
  --            the same disjunction and would abort the apply.
  -- ⚠️ The FIVE RLS-enabled tables move with the function DELIBERATELY. Left
  --    behind, the new owner reads them under RLS and the fan-out returns 0 on
  --    every tick — which is precisely the failure this arm's prose describes,
  --    and it reddens arm B three hundred lines earlier instead. Moving them
  --    isolates the ONE property under test: the owner's exemption.
  -- ⭐ public.system_flags is the FOURTH, added by 164.7 D-01, and it was found
  --    by MEASUREMENT, not by reading: the first lane run of this file after the
  --    switch moved reported `WRONG-ARM(B)` on this twin. The new guard READS
  --    system_flags, the drift role is exempt from row security by neither
  --    route, the RLS-enabled stand-in admits it no rows, the flag reads NULL,
  --    the fan-out is dormant and arm B fails first. That is the same mechanism
  --    the three tables above were moved for — one more table, one more move.
  --    ⛔ A table OWNER is not subject to RLS (absent FORCE ROW LEVEL SECURITY,
  --    which neither the fixture nor 20260407164606 sets), which is what makes
  --    the move sufficient.
  -- ⭐ public.cron_runs is the FIFTH, added by 164.8.6 plan 03, and it too was
  --    found by MEASUREMENT: the first narrowed run of this file after the
  --    dormancy instrument landed reported this arm as `NO-IDENTITY` with
  --    `SIGHTINGS: none — the lane emitted no TEST FAILED (…) at all`. The cause
  --    is one privilege: 20260911130000's dormant branch now WRITES
  --    public.cron_runs, the drift role holds only SELECT on it and RLS is
  --    enabled with no policies, so arm A's very first call died on a raw 42501
  --    naming no arm at all — worse than the WRONG-ARM(B) the fourth table was
  --    added for, because a raw permission error attributes to nothing. Moving
  --    ownership is the same remedy for the same reason: it isolates the ONE
  --    property under test, the owner's RLS exemption, from every privilege the
  --    drift role incidentally lacks.
  -- RED-UNDER-M: {"arm":"J","apply":[{"kind":"sql","stmt":"CREATE ROLE lrf_owner_drift NOLOGIN"},{"kind":"sql","stmt":"GRANT USAGE ON SCHEMA public TO lrf_owner_drift"},{"kind":"sql","stmt":"GRANT SELECT ON ALL TABLES IN SCHEMA public TO lrf_owner_drift"},{"kind":"sql","stmt":"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO lrf_owner_drift"},{"kind":"sql","stmt":"ALTER TABLE public.strategies OWNER TO lrf_owner_drift"},{"kind":"sql","stmt":"ALTER TABLE public.strategy_keys OWNER TO lrf_owner_drift"},{"kind":"sql","stmt":"ALTER TABLE public.compute_jobs OWNER TO lrf_owner_drift"},{"kind":"sql","stmt":"ALTER TABLE public.system_flags OWNER TO lrf_owner_drift"},{"kind":"sql","stmt":"ALTER TABLE public.cron_runs OWNER TO lrf_owner_drift"},{"kind":"sql","stmt":"ALTER FUNCTION public.enqueue_ledger_refresh_for_strategies() OWNER TO lrf_owner_drift"}]}
  SELECT r.rolname, r.rolsuper, r.rolbypassrls
    INTO v_owner, v_own_super, v_own_bypass
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE n.nspname = 'public'
     AND p.proname = 'enqueue_ledger_refresh_for_strategies';
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (J): could not resolve the owner of enqueue_ledger_refresh_for_strategies — the pg_proc row is absent, or its proowner has no matching pg_roles row. Either way arm J checked NOTHING, which is why this is an exception and not a silent pass';
  END IF;
  IF NOT (COALESCE(v_own_bypass, FALSE) OR COALESCE(v_own_super, FALSE)) THEN
    RAISE EXCEPTION 'TEST FAILED (J): enqueue_ledger_refresh_for_strategies is owned by role "%" (rolsuper=%, rolbypassrls=%), which is exempt from RLS by neither route. As SECURITY DEFINER it reads the security_invoker view ledger_refresh_staleness as that role, so api_keys/strategy_keys RLS collapses `exchanges` to the empty array, the venue conjunct drops every row, and the fan-out returns 0 on every tick — indistinguishable from a healthy, fully-fresh estate. Migration 20260825130000 pins this at apply time only; ownership drift afterwards is what this arm exists to catch', v_owner, v_own_super, v_own_bypass;
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
  --            step and NOT an edit of any migration's REVOKE, because EVERY
  --            such file's own DO block asserts this same set — 20260911130000's
  --            check 9 and, since 2026-09-17, 20260917120000's check 11, and
  --            since 2026-09-24 20260924120000's check 11 — and an
  --            edit would ABORT THE APPLY, so the gate would never run and no arm
  --            could be the first failure. The lane's --post-apply hook exists
  --            for exactly this shape; it is arm I's reasoning, one property
  --            wider.
  -- ⛔ ORDER: THIS ARM MUST STAY AFTER ARM J. J's twin GRANTs EXECUTE ON ALL
  --    FUNCTIONS IN SCHEMA public to lrf_owner_drift and moves the ownership, so
  --    it drifts this grantee set too. Placed BEFORE J it would be the FIRST
  --    failure under J's twin and the runner would report `wrong-first-failure`.
  --    Placed after, J fails first under J's twin (correct) and this arm reddens
  --    alone under its own.
  -- RED-UNDER-M: {"arm":"S1","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.enqueue_ledger_refresh_for_strategies() TO service_role"}]}
  SELECT g.owner_name, string_agg(g.grantee_name, ',' ORDER BY g.grantee_name)
    INTO v_owner_name, v_grantees
    FROM (
      SELECT pg_get_userbyid(p.proowner) AS owner_name,
             CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee_name
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
       WHERE n.nspname = 'public'
         AND p.proname = 'enqueue_ledger_refresh_for_strategies'
         AND p.pronargs = 0
         AND a.privilege_type = 'EXECUTE'
    ) g
   GROUP BY g.owner_name;
  IF v_grantees IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (S1): could not read the EXECUTE grantee set of enqueue_ledger_refresh_for_strategies — the function is missing, or it carries no EXECUTE aclitem at all. An empty answer here is indistinguishable from a locked-down one unless it is REFUSED, which is why this is an exception and not a pass';
  END IF;
  IF v_grantees IS DISTINCT FROM v_owner_name THEN
    RAISE EXCEPTION 'TEST FAILED (S1): EXECUTE on enqueue_ledger_refresh_for_strategies is held by [%], expected exactly the owner [%]. This is a cross-tenant SECURITY DEFINER enqueue path that fans work out for every tenant; it must be callable by the scheduler alone, and the scheduler IS the owner. service_role''s grant survived Phase 164.7 precisely because only anon and authenticated were ever probed — arm I is that subset probe, and this arm is what makes the set complete', v_grantees, v_owner_name;
  END IF;

  -- ======================================================================
  -- ARM R — THE ALL-CANDIDATES-FAILED BRANCH, AND THE LOCK IT MUST RELEASE
  -- (Phase 164.5.1 threat model, T-164.5.1-09-07, Denial of Service).
  --
  -- ⛔ THE THREAT IS NOT "a candidate fails". It is that ONE POISONED ROW
  -- WEDGES EVERY FUTURE TICK. The fan-out takes a SESSION-level advisory lock
  -- (`pg_try_advisory_lock(hashtext('ledger_refresh_fanout'))`) and refuses to
  -- run when it cannot get it. If a failing candidate escapes the per-candidate
  -- handler, the lock is never released on that path and the NEXT tick — and
  -- every tick after it — takes the "already running" exit and does nothing.
  -- Ledger refreshes would stop silently while the cron row kept reporting
  -- `succeeded`. That is the same shape as the defect Phase 164.5.1.1 repaired.
  --
  -- ⚠️ THE OBVIOUS ASSERTION IS WRONG HERE, and this comment exists so the next
  -- reader does not "simplify" it back. Checking the lock by TAKING it —
  -- `IF NOT pg_try_advisory_lock(...) THEN fail` — MEASURES NOTHING: advisory
  -- locks are per SESSION and RE-ENTRANT, so this same backend re-acquires a
  -- lock it is already holding and the call succeeds either way. The assertion
  -- is therefore a DELTA over `pg_locks` for THIS backend: however many
  -- advisory locks were held before the tick, exactly that many after it.
  --
  -- ⚠️ The threat model says this branch is "exercised DELIBERATELY with the
  -- result recorded, rather than assumed to work". A one-off exercise satisfies
  -- that sentence once; an arm satisfies it every run. Measured 2026-09-17
  -- before writing this: NO gate in the whole corpus referenced
  -- `advisory_unlock`, and none carried the handler's warning text — the branch
  -- was entirely ungated.
  --
  -- ⭐ AMENDED in the 164.6 review fix (HIGH-1), and again in ROUND 2. Round 1
  -- made an all-candidates-failed tick RAISE; round 2 removed that raise, so
  -- this tick now returns 0 and keeps its failure row. This arm still
  -- TOLERATES exactly the removed raise's message, and on purpose: arm U's
  -- twin re-adds that raise, and if this arm refused it, this arm (earlier in
  -- the file) would be the first failure under U's twin instead of U. Whether
  -- an all-fail tick raises is arm U's property, not this one's. Any OTHER
  -- escape is still refused. The wedge check below proves the mechanism on a
  -- FRESH candidate, because the poisoned pair keeps its failure row and sits
  -- on the failed-attempt cooldown, which is correct and is not a wedge.
  -- ======================================================================
  -- RED-UNDER: make the per-candidate handler RE-RAISE instead of continuing.
  --            The first poisoned candidate then propagates out of the loop,
  --            the outer handler unlocks and re-raises, and the fan-out aborts
  --            on the HANDLER'S message, which is not the one message this arm
  --            tolerates — so the message read below fails in the lane. That mutation is EXACTLY the regression this arm
  --            exists to catch: it is the difference between "one bad row is
  --            skipped" and "one bad row kills the tick".
  --
  -- ⛔ DISJOINTNESS, checked rather than assumed: 20260917120000's apply-time
  --    `DO $verify$` block holds eight needles (system_flags, the NULL-safe
  --    flag read, the cron_runs instrument, the lifecycle set, 'draft',
  --    'archived', the GET DIAGNOSTICS read and the retired app-namespace GUC).
  --    ⭐ RE-CHECKED 2026-09-24 (Phase 164.6 plan 03) when this twin moved to
  --    20260924120000: that file's block carries the same eight plus three new
  --    ones (the failed-target metadata key, the failure row's count key and
  --    the advisory unlock call, the last two for its ordering check), and the
  --    review fix added two more (the failure-row re-raise message, which was
  --    the all-candidates-failed message until round 2, and the cooldown's
  --    heartbeat read). NONE of them matches the handler text
  --    mutated here, so the twin cannot abort the apply before the arms run
  --    and report a `no-red` that measured nothing — the trap GRAMMAR.md rule 2
  --    records.
  -- RED-UNDER-M: {"arm":"R","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"RAISE WARNING 'enqueue_ledger_refresh_for_strategies: one candidate failed to enqueue (SQLSTATE %); continuing', SQLSTATE;","replace":"RAISE EXCEPTION 'enqueue_ledger_refresh_for_strategies: one candidate failed to enqueue (SQLSTATE %); continuing', SQLSTATE;","occurrences":1}]}
  CREATE FUNCTION pg_temp.lrf_poison() RETURNS TRIGGER LANGUAGE plpgsql AS $poison$
  BEGIN
    IF EXISTS (SELECT 1 FROM strategies WHERE id = NEW.strategy_id AND name LIKE 'lrf R%') THEN
      RAISE EXCEPTION 'arm R: poisoned candidate refuses to enqueue';
    END IF;
    RETURN NEW;
  END $poison$;
  CREATE TRIGGER lrf_poison_trg BEFORE INSERT ON compute_jobs
    FOR EACH ROW EXECUTE FUNCTION pg_temp.lrf_poison();

  SELECT count(*) INTO v_locks_pre FROM pg_locks
   WHERE locktype = 'advisory' AND pid = pg_backend_pid();

  UPDATE strategies SET status = 'published' WHERE id IN (s_r1, s_r2);

  -- ⛔ THE CALL IS WRAPPED, AND THE WRAPPER IS THE ARM'S IDENTITY.
  -- MEASURED 2026-09-17: the naive form — a bare call followed by an IF — made
  -- this arm report `NO-IDENTITY` / `wrong-first-failure` under its own twin.
  -- With the per-candidate handler re-raising, the POISON TRIGGER'S message is
  -- what escapes, the lane goes red carrying a string this file never wrote,
  -- and the runner rightly refuses to count the arm as biting. A gate that goes
  -- red for someone else's reason has not measured itself. Converting any
  -- escape into this arm's own TEST FAILED (R) is what makes the red
  -- ATTRIBUTABLE — which is the property `biting` actually counts. The handler
  -- only RECORDS what escaped; the verdict is raised below, outside it.
  v_ret := NULL;
  v_err_state := NULL;
  v_err_msg := NULL;
  BEGIN
    v_ret := public.enqueue_ledger_refresh_for_strategies();
  EXCEPTION WHEN OTHERS THEN
    v_err_state := SQLSTATE;
    v_err_msg := SQLERRM;
  END;
  IF v_err_msg IS NOT NULL
     AND v_err_msg NOT LIKE 'enqueue_ledger_refresh_for_strategies: every candidate this tick failed to enqueue%' THEN
    RAISE EXCEPTION 'TEST FAILED (R): a poisoned candidate propagated OUT of the fan-out (SQLSTATE %) instead of being skipped: what escaped was not the tick''s own all-candidates-failed verdict. The per-candidate handler is the whole mitigation for T-164.5.1-09-07: one bad row must not kill the tick, because a tick that dies here leaves every later tick facing a lock it never released.', v_err_state;
  END IF;
  IF v_err_msg IS NULL AND v_ret <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (R): every candidate this tick was poisoned, so the fan-out must report 0 enqueued; it reported %. Either the poison trigger did not fire or a candidate was counted that never landed a row.', v_ret;
  END IF;

  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id IN (s_r1, s_r2) AND kind = 'derive_broker_dailies';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (R): the poisoned candidates landed % derive_broker_dailies row(s), expected 0 — the counter and the table disagree, which is the class where a green tick hides an empty one.', v_cnt;
  END IF;

  SELECT count(*) INTO v_locks_post FROM pg_locks
   WHERE locktype = 'advisory' AND pid = pg_backend_pid();
  IF v_locks_post <> v_locks_pre THEN
    RAISE EXCEPTION 'TEST FAILED (R): the fan-out held % advisory lock(s) before the all-candidates-failed tick and % after it. The lock LEAKED: the next tick takes the already-running exit and every tick after it does nothing, while cron keeps reporting succeeded.', v_locks_pre, v_locks_post;
  END IF;

  DROP TRIGGER lrf_poison_trg ON compute_jobs;

  -- THE WEDGE CHECK. The delta above says the books balance; this says the
  -- mechanism actually still works: a later tick enqueues a FRESH, healthy
  -- candidate on the other ledger venue, so the venue cap cannot be what
  -- decides it. Seeded here, by INSERT only, so no earlier arm sees it.
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led2, 'lrf R3', 'draft') RETURNING id INTO s_r3;
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  VALUES (s_r3, 'complete_with_warnings', now(),
          jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 25, 'YYYY-MM-DD'), 'value', 0.002)));
  UPDATE strategies SET status = 'published' WHERE id = s_r3;
  BEGIN
    v_ret := public.enqueue_ledger_refresh_for_strategies();
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (R): the tick AFTER the all-candidates-failed one raised (SQLSTATE %) instead of running. Same identity rule as the wrapper above.', SQLSTATE;
  END;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_r3 AND kind = 'derive_broker_dailies';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (R): after a tick in which every candidate failed, the NEXT tick left a fresh healthy candidate with % derive_broker_dailies row(s), expected 1 — the fan-out is wedged, which is precisely the denial of service T-164.5.1-09-07 names.', v_cnt;
  END IF;

  UPDATE strategies SET status = 'draft' WHERE id IN (s_r1, s_r2, s_r3);

  -- ======================================================================
  -- ARM N — ONE POISONED CANDIDATE BESIDE TWO HEALTHY ONES: THE FAILURE IS
  -- COUNTED AND NAMED (Phase 164.6 / OPS-08-F2, D-10 / D-11 / D-13).
  --
  -- Arm R proves one bad row cannot kill the tick. It cannot prove anybody
  -- would ever KNOW a row went bad in a tick that ALSO did useful work: that
  -- tick returns its enqueued count, pg_cron records `succeeded`, and until
  -- 20260924120000 the only trace was a WARNING nothing reads. This arm poisons
  -- exactly ONE of three candidates and asserts that the tick leaves ONE
  -- counted cron_runs row naming it, and that both healthy siblings still
  -- enqueue. Arms N2, T and N3 below read the same tick's row and the tick
  -- after it; each is its own arm because each has its own twin.
  --
  -- ⭐ THREE candidates, not two, since the 164.6 review fix (IN-02): with one
  -- poisoned beside ONE healthy the tick enqueued 1 and failed 1, so an
  -- enqueued count that carried the FAILED count read exactly right and arm
  -- N2's precision check could not see it. Two healthy siblings make the two
  -- counts differ. The third sits on the other ledger venue, so the per-venue
  -- cap of two cannot drop it.
  --
  -- ⛔ PLACED AFTER ARM R, deliberately. Under R's twin the per-candidate
  -- handler re-raises; placed BEFORE R, this arm's poisoned candidate would
  -- propagate first and steal R's first failure (`wrong-first-failure`). Under
  -- THIS arm's twin, R asserts nothing about cron_runs and stays green.
  --
  -- ⛔ NARROWED BY THIS ARM'S OWN TARGET. Other arms' ticks write failure rows
  -- too, so counting every 'candidate_enqueue_failed' row would count theirs.
  -- The row read below is keyed on the poisoned fixture's id inside
  -- failed_targets.
  --
  -- The fixtures are seeded HERE, by INSERT only, so no earlier arm can see
  -- them at all, and moderately stale like arms P and R so they could never
  -- outrank the G1/G2 cohorts even if they could. The poison keys on the NAME,
  -- for arm R's reason: a trigger function cannot see this block's variables.
  -- Its function has its own name because arm R's is created without OR
  -- REPLACE and is never dropped.
  -- ======================================================================
  -- RED-UNDER: stop COUNTING in the single-key body's per-candidate handler —
  --            the increment adds 0 instead of 1. The failed candidate is still
  --            appended to the list, but the count stays 0, the failure block
  --            is never taken and NO row is written, so the "exactly one row"
  --            read below fails. That is the regression this arm exists for: a
  --            tick in which a candidate failed, reporting nothing.
  -- ⚠️ `occurrences: 2, nth: 1`: both bodies in 20260924120000 carry the
  --    increment, single-key first. Not a migration needle: that file's
  --    apply-time block needles the failed-target KEY and the failure row's
  --    count KEY, and this mutation preserves both, so the apply survives and
  --    the ARM is the first failure.
  -- RED-UNDER-M: {"arm":"N","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"v_failed := v_failed + 1;","replace":"v_failed := v_failed + 0;","occurrences":2,"nth":1}]}
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led, 'lrf N1', 'draft') RETURNING id INTO s_n1;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led, 'lrf N2', 'draft') RETURNING id INTO s_n2;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led2, 'lrf N3', 'draft') RETURNING id INTO s_n3;
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  VALUES (s_n1, 'complete_with_warnings', now(),
          jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 27, 'YYYY-MM-DD'), 'value', 0.002)));
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  VALUES (s_n2, 'complete_with_warnings', now(),
          jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 26, 'YYYY-MM-DD'), 'value', 0.002)));
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  VALUES (s_n3, 'complete_with_warnings', now(),
          jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 26, 'YYYY-MM-DD'), 'value', 0.002)));

  CREATE FUNCTION pg_temp.lrf_poison_n() RETURNS TRIGGER LANGUAGE plpgsql AS $poison_n$
  BEGIN
    IF EXISTS (SELECT 1 FROM strategies WHERE id = NEW.strategy_id AND name LIKE 'lrf N1%') THEN
      RAISE EXCEPTION 'arm N: the poisoned candidate refuses to enqueue';
    END IF;
    RETURN NEW;
  END $poison_n$;
  CREATE TRIGGER lrf_poison_n_trg BEFORE INSERT ON compute_jobs
    FOR EACH ROW EXECUTE FUNCTION pg_temp.lrf_poison_n();

  UPDATE strategies SET status = 'published' WHERE id IN (s_n1, s_n2, s_n3);

  -- Wrapped for arm R's reason: any escape becomes THIS arm's identity.
  BEGIN
    v_ret := public.enqueue_ledger_refresh_for_strategies();
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (N): a tick with ONE poisoned candidate RAISED (SQLSTATE %) instead of skipping it and enqueueing its healthy siblings. Reporting a failure must never cost the tick.', SQLSTATE;
  END;

  DROP TRIGGER lrf_poison_n_trg ON compute_jobs;

  IF v_ret <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (N): one of three candidates was poisoned, so the fan-out must report 2 jobs INSERTED; it reported %. The return value means jobs inserted this tick (D-10), and a failure must be surfaced BESIDE it, never folded into it.', v_ret;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id IN (s_n2, s_n3) AND kind = 'derive_broker_dailies';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (N): the two HEALTHY siblings landed % derive_broker_dailies row(s), expected 2 — reporting one candidate''s failure took a good enqueue down with it.', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_n1 AND kind = 'derive_broker_dailies';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (N): the POISONED candidate landed % derive_broker_dailies row(s), expected 0 — the poison did not fire, so nothing below measures a failure.', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt_n
    FROM public.cron_runs
   WHERE cron_name = 'ledger_refresh_fanout'
     AND error = 'candidate_enqueue_failed'
     AND metadata->>'function' = 'enqueue_ledger_refresh_for_strategies'
     AND metadata->'failed_targets' @> jsonb_build_array(jsonb_build_object('strategy_id', s_n1));
  IF v_cnt_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (N): the tick in which one candidate failed wrote % failure row(s) naming it, expected exactly 1. With 0, a production tick with a failed candidate again reports a clean run and the only trace is a WARNING nothing reads — the defect OPS-08-F2 exists to close.', v_cnt_n;
  END IF;

  -- ======================================================================
  -- ARM N2 — THE FAILURE ROW'S COUNTS ARE EXACT (164.6 review fix, IN-02).
  -- The PRECISION edge of arm N's row, split out so its own twin can prove it:
  -- exact integers that agree with each other and with the tick's own return
  -- value, the healthy siblings NOT named, the cause and the failed
  -- candidate's SQLSTATE present, and no lost race counted in a tick that had
  -- none. Arm N's twin cannot reach here (it writes no row at all), and this
  -- arm's twin leaves arm N's count intact.
  -- ======================================================================
  -- RED-UNDER: write the FAILED count into the row's enqueued count in the
  --            single-key body — the copy-paste slip between two adjacent
  --            integers. The tick enqueued 2 and failed 1, so the row then
  --            says enqueued 1 against a tick that returned 2, and the
  --            agreement read below fails.
  -- ⚠️ `occurrences: 2, nth: 1`, single-key body first. Not a migration needle.
  -- RED-UNDER-M: {"arm":"N2","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"'enqueued_count', v_enqueued,","replace":"'enqueued_count', v_failed,","occurrences":2,"nth":1}]}
  SELECT metadata INTO v_meta_n
    FROM public.cron_runs
   WHERE cron_name = 'ledger_refresh_fanout'
     AND error = 'candidate_enqueue_failed'
     AND metadata->>'function' = 'enqueue_ledger_refresh_for_strategies'
     AND metadata->'failed_targets' @> jsonb_build_array(jsonb_build_object('strategy_id', s_n1));
  IF (v_meta_n->>'failed_count')::int IS DISTINCT FROM 1
     OR (v_meta_n->>'failed_count')::int IS DISTINCT FROM jsonb_array_length(v_meta_n->'failed_targets')
     OR (v_meta_n->>'enqueued_count')::int IS DISTINCT FROM v_ret
     OR (v_meta_n->>'lost_race_count')::int IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (N2): the failure row''s counts disagree — failed_count %, failed_targets holds %, enqueued_count % against a tick that returned %, lost_race_count %. Expected 1, 1, the return value and 0: a count that does not match its own list, or an enqueued count that does not match what the tick reported, is a number nobody can act on.', v_meta_n->>'failed_count', jsonb_array_length(v_meta_n->'failed_targets'), v_meta_n->>'enqueued_count', v_ret, v_meta_n->>'lost_race_count';
  END IF;
  IF v_meta_n->'failed_targets' @> jsonb_build_array(jsonb_build_object('strategy_id', s_n2))
     OR v_meta_n->'failed_targets' @> jsonb_build_array(jsonb_build_object('strategy_id', s_n3)) THEN
    RAISE EXCEPTION 'TEST FAILED (N2): the failure row names a HEALTHY sibling, which enqueued. A failure list that includes a candidate that succeeded sends the reader after the wrong strategy, and puts a healthy strategy on the failed-attempt cooldown.';
  END IF;
  IF v_meta_n->>'cause' IS DISTINCT FROM 'candidate_enqueue_failed'
     OR v_meta_n->'failed_targets'->0->>'sqlstate' IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (N2): the failure row''s metadata does not carry the cause (got %) and the failed candidate''s SQLSTATE (got %). The SQLSTATE is the one diagnostic the handler can capture, and only there.', v_meta_n->>'cause', v_meta_n->'failed_targets'->0->>'sqlstate';
  END IF;

  -- ======================================================================
  -- ARM T — A FAILED CANDIDATE IS NOT RE-SELECTED, AND A HEALTHY ONE TAKES ITS
  -- SLOT (164.6 review fix, HIGH-2).
  --
  -- A candidate whose enqueue RAISED inserted no compute_jobs row, so the
  -- 20-hour attempt cooldown never saw it and stalest-first ordering handed it
  -- the same slot on every tick. This arm makes that slot CONTESTED: on the
  -- poisoned candidate's venue, two fresh healthy candidates compete for the
  -- per-venue cap of two with the formerly poisoned one, which is the STALEST
  -- of the three. Without the failed-attempt cooldown the poisoned candidate
  -- takes one of the two slots and the less-stale healthy candidate gets
  -- nothing. With it, both healthy candidates enqueue and the poisoned one is
  -- left alone for 20 hours. The poison is DROPPED before this tick, so an
  -- enqueue of the poisoned candidate would SUCCEED here — the only thing that
  -- can keep it out is the cooldown.
  -- ======================================================================
  -- RED-UNDER: shrink the single-key body's FAILED-ATTEMPT cooldown window to
  --            zero. Arm N's failure row then no longer excludes its poisoned
  --            candidate, which is the stalest on its venue, so it takes a
  --            slot back and the less-stale healthy candidate below is left
  --            without a job.
  -- ⚠️ `occurrences: 4, nth: 2`: each body carries the 20-hour window twice,
  --    the attempt cooldown first and the failed-attempt cooldown second, and
  --    the single-key body comes first. Not a migration needle: that file's
  --    apply-time block needles the failed-attempt cooldown by its heartbeat
  --    read, which this mutation leaves intact.
  -- RED-UNDER-M: {"arm":"T","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"INTERVAL '20 hours'","replace":"INTERVAL '0 hours'","occurrences":4,"nth":2}]}
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led, 'lrf T1', 'draft') RETURNING id INTO s_t1;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led, 'lrf T2', 'draft') RETURNING id INTO s_t2;
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  VALUES (s_t1, 'complete_with_warnings', now(),
          jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 25, 'YYYY-MM-DD'), 'value', 0.002)));
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  VALUES (s_t2, 'complete_with_warnings', now(),
          jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 24, 'YYYY-MM-DD'), 'value', 0.002)));
  UPDATE strategies SET status = 'published' WHERE id IN (s_t1, s_t2);

  -- Arm N3's before-reading of this function's failure rows, taken before
  -- the tick it judges.
  SELECT count(*) INTO v_fail_pre
    FROM public.cron_runs
   WHERE cron_name = 'ledger_refresh_fanout'
     AND error = 'candidate_enqueue_failed'
     AND metadata->>'function' = 'enqueue_ledger_refresh_for_strategies';
  BEGIN
    v_ret := public.enqueue_ledger_refresh_for_strategies();
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (T): the tick AFTER the poisoned one raised (SQLSTATE %) instead of running. Same identity rule as arm R''s wrapper.', SQLSTATE;
  END;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_n1 AND kind = 'derive_broker_dailies';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (T): the candidate whose enqueue failed on the previous tick was selected AGAIN (% derive_broker_dailies row(s)), inside the failed-attempt cooldown. A poisoned candidate then holds its slot on every tick and starves the healthy candidates behind it.', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_t2 AND kind = 'derive_broker_dailies';
  IF v_cnt <> 1 OR v_ret <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (T): the healthy candidate that competes for the failed one''s slot holds % derive_broker_dailies row(s) (expected 1) and the tick enqueued % (expected 2). The slot a failed candidate leaves must go to a healthy one.', v_cnt, v_ret;
  END IF;

  -- ======================================================================
  -- ARM N3 — A TICK WITH NO FAILURE WRITES NOTHING (164.6 review fix, IN-02).
  -- The BOUNDARY edge, split out of arm N so its own twin can prove it: arm
  -- T's tick above had no failed candidate, so it must not have added a
  -- failure row. A row per healthy tick turns the failure signal into a
  -- heartbeat nobody can read as a failure, and a heartbeat with an empty
  -- target list would be read back by the cooldown on every tick.
  -- ======================================================================
  -- RED-UNDER: take the single-key body's failure block on a count of ZERO
  --            (`>` becomes `>=`), so every tick writes a failure row. Arm
  --            T's clean tick then adds one and the delta read below fails.
  -- ⚠️ `occurrences: 2, nth: 1`, single-key body first. ⛔ This needle was
  --    the apply-time block's ordering needle until this arm was added; that
  --    block now needles the failure row's count KEY instead, so the apply
  --    survives this mutation and the ARM is the first failure.
  -- RED-UNDER-M: {"arm":"N3","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"IF v_failed > 0 THEN","replace":"IF v_failed >= 0 THEN","occurrences":2,"nth":1}]}
  SELECT count(*) INTO v_fail_post
    FROM public.cron_runs
   WHERE cron_name = 'ledger_refresh_fanout'
     AND error = 'candidate_enqueue_failed'
     AND metadata->>'function' = 'enqueue_ledger_refresh_for_strategies';
  IF v_fail_post <> v_fail_pre THEN
    RAISE EXCEPTION 'TEST FAILED (N3): a tick in which NO candidate failed wrote % failure row(s). A healthy tick must write nothing, or the failure signal becomes a heartbeat nobody can read as a failure.', v_fail_post - v_fail_pre;
  END IF;

  UPDATE strategies SET status = 'draft' WHERE id IN (s_n1, s_n2, s_n3, s_t1, s_t2);

  -- ======================================================================
  -- ARM U — A TICK IN WHICH EVERY CANDIDATE FAILED KEEPS ITS FAILURE ROW, AND
  -- THE NEXT TICK'S COOLDOWN SKIPS THOSE CANDIDATES (164.6 round-2 review fix,
  -- 164.6-REVIEW-R2 WR-01 / 164.6-REVIEW-SFH-R2 N2).
  --
  -- ⛔ THIS ARM WAS INVERTED IN ROUND 2. In round 1 it asserted that such a
  -- tick RAISES. That raise rolled back the tick's own failure row, which is
  -- the row the failed-attempt cooldown reads, so on the exact scenario HIGH-2
  -- named the cooldown could never engage. This arm now builds THAT scenario:
  -- two poisoned candidates are the stalest on one venue and hold its cap of
  -- two, and a healthy third candidate on the same venue sits behind them.
  -- Tick 1 is all-fail by construction. It must return 0 without raising,
  -- commit ONE failure row naming both with their SQLSTATEs, and release the
  -- lock. Tick 2 runs with the poison gone, so an enqueue of either poisoned
  -- candidate would SUCCEED: only the cooldown can keep them out, and the
  -- healthy candidate must take a slot.
  --
  -- ⛔ PLACED AFTER ARM N, deliberately. Under arm N's twin the failure count
  -- never rises, so tick 1 here would write no row either; placed first, this
  -- arm would steal arm N's first failure.
  -- ======================================================================
  -- RED-UNDER: re-add the round-1 all-candidates-failed raise to the
  --            single-key body, just before its closing NOTICE. Tick 1 below
  --            then raises, its failure row rolls back with it, and the
  --            no-raise read below fails. That re-addition is exactly the
  --            regression this arm exists to refuse. Arm R, earlier in this
  --            file, tolerates that one message for this reason.
  -- ⚠️ The find is the single-key body's closing NOTICE, which occurs ONCE
  --    (the composite body's NOTICE names composite jobs). Not a migration
  --    needle, and the apply-time block deliberately does not assert the
  --    raise ABSENT, so the apply survives and the ARM is the first failure.
  -- RED-UNDER-M: {"arm":"U","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: enqueued %","replace":"IF v_enqueued = 0 AND v_failed > 0 THEN\n    RAISE EXCEPTION 'enqueue_ledger_refresh_for_strategies: every candidate this tick failed to enqueue (% failed, 0 enqueued)', v_failed;\n  END IF;\n  RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: enqueued %","occurrences":1}]}
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led, 'lrf U1', 'draft') RETURNING id INTO s_u1;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led, 'lrf U2', 'draft') RETURNING id INTO s_u2;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led, 'lrf U3', 'draft') RETURNING id INTO s_u3;
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  SELECT sid, 'complete_with_warnings', now(),
         jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 23, 'YYYY-MM-DD'), 'value', 0.002))
    FROM unnest(ARRAY[s_u1, s_u2]) AS sid;
  -- The healthy one is LESS stale, so stalest-first ordering puts it behind
  -- the poisoned pair and the per-venue cap of two cuts it from tick 1.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  VALUES (s_u3, 'complete_with_warnings', now(),
          jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 22, 'YYYY-MM-DD'), 'value', 0.002)));

  CREATE FUNCTION pg_temp.lrf_poison_u() RETURNS TRIGGER LANGUAGE plpgsql AS $poison_u$
  BEGIN
    IF EXISTS (SELECT 1 FROM strategies WHERE id = NEW.strategy_id AND name IN ('lrf U1', 'lrf U2')) THEN
      RAISE EXCEPTION 'arm U: the poisoned candidate refuses to enqueue';
    END IF;
    RETURN NEW;
  END $poison_u$;
  CREATE TRIGGER lrf_poison_u_trg BEFORE INSERT ON compute_jobs
    FOR EACH ROW EXECUTE FUNCTION pg_temp.lrf_poison_u();

  UPDATE strategies SET status = 'published' WHERE id IN (s_u1, s_u2, s_u3);
  SELECT count(*) INTO v_locks_pre FROM pg_locks
   WHERE locktype = 'advisory' AND pid = pg_backend_pid();
  v_ret := NULL;
  v_err_state := NULL;
  v_err_msg := NULL;
  BEGIN
    v_ret := public.enqueue_ledger_refresh_for_strategies();
  EXCEPTION WHEN OTHERS THEN
    v_err_state := SQLSTATE;
    v_err_msg := SQLERRM;
  END;
  DROP TRIGGER lrf_poison_u_trg ON compute_jobs;
  SELECT count(*) INTO v_locks_post FROM pg_locks
   WHERE locktype = 'advisory' AND pid = pg_backend_pid();

  IF v_err_msg IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (U): a tick in which every candidate failed RAISED (SQLSTATE %) instead of returning 0. The raise rolls back the tick''s own failure row, which is the row the failed-attempt cooldown reads, so the two poisoned candidates keep their venue''s slots on every tick and the healthy candidate behind them is never refreshed (164.6-REVIEW-R2 WR-01).', v_err_state;
  END IF;
  IF v_ret IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (U): every candidate this tick was poisoned, so the fan-out must report 0 enqueued; it reported %.', v_ret;
  END IF;
  IF v_locks_post <> v_locks_pre THEN
    RAISE EXCEPTION 'TEST FAILED (U): the fan-out held % advisory lock(s) before the all-fail tick and % after it. The lock leaked, so every later tick takes the already-running exit.', v_locks_pre, v_locks_post;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id IN (s_u1, s_u2, s_u3) AND kind = 'derive_broker_dailies';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (U): the all-fail tick left % derive_broker_dailies row(s) across its poisoned pair and the healthy candidate behind them, expected 0. Either the poison did not fire or the per-venue cap did not bind, and the scenario this arm needs was never built.', v_cnt;
  END IF;
  SELECT metadata INTO v_meta_u
    FROM public.cron_runs
   WHERE cron_name = 'ledger_refresh_fanout'
     AND error = 'candidate_enqueue_failed'
     AND metadata->>'function' = 'enqueue_ledger_refresh_for_strategies'
     AND metadata->'failed_targets' @> jsonb_build_array(jsonb_build_object('strategy_id', s_u1))
     AND metadata->'failed_targets' @> jsonb_build_array(jsonb_build_object('strategy_id', s_u2));
  IF v_meta_u IS NULL
     OR (v_meta_u->>'failed_count')::int IS DISTINCT FROM 2
     OR (v_meta_u->>'enqueued_count')::int IS DISTINCT FROM 0
     OR NOT (v_meta_u->'failed_targets' @> jsonb_build_array(jsonb_build_object('strategy_id', s_u1, 'sqlstate', 'P0001')))
     OR NOT (v_meta_u->'failed_targets' @> jsonb_build_array(jsonb_build_object('strategy_id', s_u2, 'sqlstate', 'P0001'))) THEN
    RAISE EXCEPTION 'TEST FAILED (U): the all-fail tick did not commit one failure row naming both poisoned candidates with their SQLSTATEs (failed_count %, enqueued_count %). That row is what the prod prober counts and what the next tick''s cooldown reads.', v_meta_u->>'failed_count', v_meta_u->>'enqueued_count';
  END IF;

  -- Tick 2, with the poison gone.
  BEGIN
    v_ret := public.enqueue_ledger_refresh_for_strategies();
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (U): the tick after the all-fail one raised (SQLSTATE %) instead of running. Same identity rule as arm R''s wrapper.', SQLSTATE;
  END;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id IN (s_u1, s_u2) AND kind = 'derive_broker_dailies';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (U): after an all-fail tick, the next tick selected the failed candidates AGAIN (% derive_broker_dailies row(s)) inside the failed-attempt cooldown.', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_u3 AND kind = 'derive_broker_dailies';
  IF v_cnt <> 1 OR v_ret IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (U): after an all-fail tick, the healthy candidate behind the failed pair holds % derive_broker_dailies row(s) (expected 1) and the tick enqueued % (expected 1). A venue whose two stalest candidates are poisoned must not starve.', v_cnt, v_ret;
  END IF;

  UPDATE strategies SET status = 'draft' WHERE id IN (s_u1, s_u2, s_u3);

  -- ======================================================================
  -- ARMS V1 / V2 — THE FAILURE ROW'S OWN WRITE FAILS (164.6 review fix,
  -- MEDIUM-1).
  --
  -- A trigger on the heartbeat table refuses the failure row with its own
  -- SQLSTATE, standing in for a revoked privilege or a constraint drift.
  --   V1: one candidate fails beside a healthy one. The tick enqueued
  --       something, so raising would roll a good enqueue back (D-10): the
  --       tick must SURVIVE, return its count and keep the healthy job.
  --   V2: every candidate fails. There is nothing to roll back, so the
  --       instrument's own failure must surface as the tick's error, with the
  --       instrument's SQLSTATE, rather than as a WARNING nothing reads.
  -- V2's check reads the SQLSTATE and the message so the verdict is the
  -- instrument's own re-raise and nothing else. Since the round-2 review fix
  -- an all-fail tick no longer raises by itself (arm U), so without the
  -- re-raise this tick would return 0 with no row, which V2 refuses.
  -- ======================================================================
  CREATE FUNCTION pg_temp.lrf_refuse_fail_row() RETURNS TRIGGER LANGUAGE plpgsql AS $refuse$
  BEGIN
    RAISE EXCEPTION 'arms V1/V2: the heartbeat table refuses the failure row' USING ERRCODE = 'LRFV0';
  END $refuse$;
  CREATE TRIGGER lrf_refuse_fail_row_trg BEFORE INSERT ON public.cron_runs
    FOR EACH ROW WHEN (NEW.error = 'candidate_enqueue_failed')
    EXECUTE FUNCTION pg_temp.lrf_refuse_fail_row();
  CREATE FUNCTION pg_temp.lrf_poison_v() RETURNS TRIGGER LANGUAGE plpgsql AS $poison_v$
  BEGIN
    IF EXISTS (SELECT 1 FROM strategies WHERE id = NEW.strategy_id AND name IN ('lrf V1', 'lrf V3', 'lrf V4')) THEN
      RAISE EXCEPTION 'arms V1/V2: the poisoned candidate refuses to enqueue';
    END IF;
    RETURN NEW;
  END $poison_v$;
  CREATE TRIGGER lrf_poison_v_trg BEFORE INSERT ON compute_jobs
    FOR EACH ROW EXECUTE FUNCTION pg_temp.lrf_poison_v();

  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led, 'lrf V1', 'draft') RETURNING id INTO s_v1;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led2, 'lrf V2', 'draft') RETURNING id INTO s_v2;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led, 'lrf V3', 'draft') RETURNING id INTO s_v3;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led, 'lrf V4', 'draft') RETURNING id INTO s_v4;
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  SELECT sid, 'complete_with_warnings', now(),
         jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 22, 'YYYY-MM-DD'), 'value', 0.002))
    FROM unnest(ARRAY[s_v1, s_v2, s_v3, s_v4]) AS sid;

  -- RED-UNDER: make the single-key body's instrument handler re-raise on
  --            EVERY tick (`v_enqueued = 0` becomes `v_enqueued >= 0`). The
  --            tick below enqueued its healthy candidate, so the re-raise rolls
  --            that good enqueue back and the call raises instead of returning.
  -- ⚠️ `occurrences: 2, nth: 1`, single-key body first. Not a migration needle.
  -- RED-UNDER-M: {"arm":"V1","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"IF v_enqueued = 0 THEN","replace":"IF v_enqueued >= 0 THEN","occurrences":2,"nth":1}]}
  UPDATE strategies SET status = 'published' WHERE id IN (s_v1, s_v2);
  v_ret := NULL;
  v_err_state := NULL;
  BEGIN
    v_ret := public.enqueue_ledger_refresh_for_strategies();
  EXCEPTION WHEN OTHERS THEN
    v_err_state := SQLSTATE;
  END;
  IF v_err_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (V1): a tick that ENQUEUED a healthy candidate raised (SQLSTATE %) because its failure row could not be written. That rolls the good enqueue back, turning a lost diagnostic into a lost tick (D-10).', v_err_state;
  END IF;
  SELECT count(*) INTO v_cnt FROM compute_jobs
   WHERE strategy_id = s_v2 AND kind = 'derive_broker_dailies';
  IF v_ret IS DISTINCT FROM 1 OR v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (V1): with the failure row refused, the tick returned % and its healthy candidate holds % derive_broker_dailies row(s), expected 1 and 1.', v_ret, v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM public.cron_runs
   WHERE cron_name = 'ledger_refresh_fanout'
     AND error = 'candidate_enqueue_failed'
     AND metadata->'failed_targets' @> jsonb_build_array(jsonb_build_object('strategy_id', s_v1));
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (V1): % failure row(s) name the refused candidate although the heartbeat table refused the write, so the refusal did not happen and this arm measured nothing.', v_cnt;
  END IF;
  UPDATE strategies SET status = 'draft' WHERE id IN (s_v1, s_v2);

  -- RED-UNDER: make the single-key body's instrument handler NEVER re-raise
  --            (`v_enqueued = 0` becomes `v_enqueued < 0`). On the
  --            all-failed tick below the refused write is then only a
  --            WARNING, and the tick returns 0 with no failure row at all:
  --            neither the prober nor the cooldown ever sees it.
  -- ⚠️ `occurrences: 2, nth: 1`, single-key body first. Not a migration needle.
  -- RED-UNDER-M: {"arm":"V2","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"IF v_enqueued = 0 THEN","replace":"IF v_enqueued < 0 THEN","occurrences":2,"nth":1}]}
  UPDATE strategies SET status = 'published' WHERE id IN (s_v3, s_v4);
  v_err_state := NULL;
  v_err_msg := NULL;
  BEGIN
    v_ret := public.enqueue_ledger_refresh_for_strategies();
  EXCEPTION WHEN OTHERS THEN
    v_err_state := SQLSTATE;
    v_err_msg := SQLERRM;
  END;
  IF v_err_state IS DISTINCT FROM 'LRFV0'
     OR v_err_msg NOT LIKE 'enqueue_ledger_refresh_for_strategies: failure instrument write failed%' THEN
    RAISE EXCEPTION 'TEST FAILED (V2): a tick that enqueued NOTHING and could not write its failure row ended with SQLSTATE %, expected the instrument''s own LRFV0 under a message naming the function. Otherwise the instrument''s failure is only a WARNING nothing reads.', v_err_state;
  END IF;
  DROP TRIGGER lrf_poison_v_trg ON compute_jobs;
  DROP TRIGGER lrf_refuse_fail_row_trg ON public.cron_runs;
  UPDATE strategies SET status = 'draft' WHERE id IN (s_v3, s_v4);

  -- ======================================================================
  -- ARM W — A LOST ENQUEUE RACE IS NOT A FAILURE, AND A DEADLOCK IS ONE
  -- (164.6 review fix MEDIUM-2; narrowed by the round-2 review fix, L3).
  --
  -- Four candidates, two per ledger venue: one loses a race with 40001, one
  -- is a deadlock victim (40P01), one fails for real, one is healthy. The
  -- lost race must be counted apart and never named. The deadlock and the
  -- real failure must BOTH be counted and named: a deadlock's other party can
  -- be any lock holder, so nothing says another enqueue is serving the
  -- candidate, and counting it as a lost race let a recurring deadlock retake
  -- its slot on every tick in silence (164.6-REVIEW-R2 IN-05, SFH-R2 L3). The
  -- healthy candidate must enqueue.
  -- ======================================================================
  -- RED-UNDER: route the single-key body's lost races to the catch-all by
  --            pointing their handler at a SQLSTATE nothing raises. The
  --            40001 candidate is then counted as a failure and named, and
  --            the lost-race name read below fails.
  -- ⚠️ `occurrences: 2, nth: 1`, single-key body first. Not a migration needle.
  -- RED-UNDER-M: {"arm":"W","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"WHEN serialization_failure THEN","replace":"WHEN SQLSTATE 'LRW00' THEN","occurrences":2,"nth":1}]}
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led, 'lrf W1', 'draft') RETURNING id INTO s_w1;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led, 'lrf W2', 'draft') RETURNING id INTO s_w2;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led2, 'lrf W3', 'draft') RETURNING id INTO s_w3;
  INSERT INTO strategies (user_id, api_key_id, name, status) VALUES (uid, k_led2, 'lrf W4', 'draft') RETURNING id INTO s_w4;
  INSERT INTO strategy_analytics (strategy_id, computation_status, computed_at, returns_series)
  SELECT sid, 'complete_with_warnings', now(),
         jsonb_build_array(jsonb_build_object('date', to_char(CURRENT_DATE - 21, 'YYYY-MM-DD'), 'value', 0.002))
    FROM unnest(ARRAY[s_w1, s_w2, s_w3, s_w4]) AS sid;

  CREATE FUNCTION pg_temp.lrf_race_w() RETURNS TRIGGER LANGUAGE plpgsql AS $race_w$
  DECLARE
    v_name TEXT;
  BEGIN
    SELECT name INTO v_name FROM strategies WHERE id = NEW.strategy_id;
    IF v_name = 'lrf W1' THEN
      RAISE EXCEPTION 'arm W: a lost enqueue race' USING ERRCODE = 'serialization_failure';
    ELSIF v_name = 'lrf W2' THEN
      RAISE EXCEPTION 'arm W: a deadlock victim' USING ERRCODE = 'deadlock_detected';
    ELSIF v_name = 'lrf W3' THEN
      RAISE EXCEPTION 'arm W: a real failure';
    END IF;
    RETURN NEW;
  END $race_w$;
  CREATE TRIGGER lrf_race_w_trg BEFORE INSERT ON compute_jobs
    FOR EACH ROW EXECUTE FUNCTION pg_temp.lrf_race_w();

  UPDATE strategies SET status = 'published' WHERE id IN (s_w1, s_w2, s_w3, s_w4);
  BEGIN
    v_ret := public.enqueue_ledger_refresh_for_strategies();
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'TEST FAILED (W): a tick with one lost race, one deadlock, one real failure and one healthy candidate RAISED (SQLSTATE %). It enqueued a job, so it must return its count.', SQLSTATE;
  END;
  DROP TRIGGER lrf_race_w_trg ON compute_jobs;

  SELECT count(*) INTO v_cnt_w
    FROM public.cron_runs
   WHERE cron_name = 'ledger_refresh_fanout'
     AND error = 'candidate_enqueue_failed'
     AND metadata->>'function' = 'enqueue_ledger_refresh_for_strategies'
     AND metadata->'failed_targets' @> jsonb_build_array(jsonb_build_object('strategy_id', s_w1));
  IF v_cnt_w <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (W): % failure row(s) name the candidate that only LOST A RACE (40001). A lost race is another writer serving the same strategy; naming it sends the reader after a healthy strategy and puts it on the failed-attempt cooldown for 20 hours.', v_cnt_w;
  END IF;

  -- RED-UNDER: put deadlock_detected back in the single-key body's lost-race
  --            branch, the round-1 shape. The 40P01 candidate is then counted
  --            as a lost race and never named, and the read below fails.
  -- ⚠️ `occurrences: 2, nth: 1`, single-key body first. Not a migration needle.
  --    A sub-arm of W, like H/inactive is of H: arm W's own assertion above
  --    still passes under this twin, so this read is the first failure.
  -- RED-UNDER-M: {"arm":"W/deadlock","apply":[{"kind":"edit","file":"supabase/migrations/20260924120000_ledger_fanout_failure_count.sql","find":"WHEN serialization_failure THEN","replace":"WHEN serialization_failure OR deadlock_detected THEN","occurrences":2,"nth":1}]}
  SELECT metadata INTO v_meta_w
    FROM public.cron_runs
   WHERE cron_name = 'ledger_refresh_fanout'
     AND error = 'candidate_enqueue_failed'
     AND metadata->>'function' = 'enqueue_ledger_refresh_for_strategies'
     AND metadata->'failed_targets' @> jsonb_build_array(jsonb_build_object('strategy_id', s_w3));
  IF v_meta_w IS NULL
     OR NOT (v_meta_w->'failed_targets' @> jsonb_build_array(jsonb_build_object('strategy_id', s_w2, 'sqlstate', '40P01')))
     OR (v_meta_w->>'failed_count')::int IS DISTINCT FROM 2
     OR (v_meta_w->>'lost_race_count')::int IS DISTINCT FROM 1
     OR v_ret IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (W/deadlock): the tick''s failure row reads failed_count % and lost_race_count %, the tick returned %, and the deadlock victim is named with 40P01: %. Expected 2, 1, 1 and true. A deadlock is not proof another enqueue serves the candidate, so it must be counted, named and cooled down like any failure, or a recurring deadlock retakes its slot every tick in silence.', v_meta_w->>'failed_count', v_meta_w->>'lost_race_count', v_ret, COALESCE(v_meta_w->'failed_targets' @> jsonb_build_array(jsonb_build_object('strategy_id', s_w2, 'sqlstate', '40P01')), FALSE);
  END IF;

  UPDATE strategies SET status = 'draft' WHERE id IN (s_w1, s_w2, s_w3, s_w4);

  RAISE NOTICE 'ALL 26 ARMS EXECUTED (A, B, C, D, E, F, G, H, I, J, K, L, M1, M2, N, N2, N3, P, Q, R, S1, T, U, V1, V2, W) and passed — the ledger refresh fan-out is dormant on a missing row, a FALSE row and a RAISING read, each of the two INVISIBLE dormant causes leaves exactly one counted instrument row, EXECUTE is held by the owner alone, the fan-out is bounded, a candidate that fails to enqueue is counted and named in one exact cron_runs row while its siblings still enqueue and is not re-selected inside the failed-attempt cooldown, a healthy tick writes no row, a tick in which every candidate failed returns 0 without raising, keeps its failure row and puts those candidates on the cooldown so a healthy candidate behind them is refreshed, a failure row that cannot be written costs the row and never a good enqueue, a lost enqueue race (40001) is counted apart from failures while a deadlock is counted and named as one, and every one of those claims is falsifiable.';
END $$;

ROLLBACK;
