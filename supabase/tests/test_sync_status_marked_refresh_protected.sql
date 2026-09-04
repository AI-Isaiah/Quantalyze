-- Test: sync_strategy_analytics_status — a MARKED ledger refresh may not
-- un-publish a funded account through the SQL status bridge.
-- Guards migration 20260825150000_sync_status_protect_marked_refresh.sql
-- (Phase 161.1 / CR-01 from 161.1-REVIEW.md).
--
-- What makes this gate worth having
-- ---------------------------------
-- Every D-15 test that existed before this one mocked Supabase and stopped at
-- the Python upsert payload — they proved the worker SKIPPED its stamp and
-- nothing more. The publish state is not decided there. It is decided one
-- statement later, inside mark_compute_job_failed's
-- `PERFORM sync_strategy_analytics_status(...)`, whose branch (b) fired on ANY
-- non-superseded failed_final. So the guard was green in 23 tests while the
-- bug it was written to stop still happened in production (161.1-04-SUMMARY.md
-- recorded the PROD tracer flipping a live composite to `failed` with its
-- series rows intact — the bridge's signature, not the Python path's).
--
-- This gate therefore does the ONE thing those could not: it drives the REAL
-- RPC. Every arm calls `mark_compute_job_failed(...)` and then reads
-- `strategy_analytics.computation_status` back. Nothing here asserts on an
-- intermediate payload.
--
-- Arms:
--   A  PROTECTED single-key   — a healthy complete_with_warnings row + a
--                               'ledger-refresh'-marked derive failing PERMANENT
--                               keeps its status, keeps computed_at, and gains
--                               the error. Also asserts the job itself really
--                               reached failed_final (or the arm proves nothing).
--   B  PROTECTED composite    — same for the 'ledger-refresh-composite' marker,
--                               which is a SEPARATE literal with its own drift
--                               risk.
--   C  LOUD, unmarked         — byte-identical seed with NO metadata flips to
--                               'failed'. THE DISCRIMINATOR: without arm C, a
--                               bridge that never flipped anything would pass A.
--   D  LOUD, foreign source   — metadata->>'source' = 'wizard' flips to 'failed'.
--                               A user-initiated job must keep its terminal gate.
--   E  LOUD, unhealthy row    — marked job, but the row reads 'computing' (the
--                               worker-side guard declined, or never ran). The
--                               health conjunct must refuse to protect it.
--   F  LOUD wins the tie      — a PROTECTED failure alongside an UNPROTECTED
--                               non-superseded failed_final of another kind
--                               still flips to 'failed'. Pins branch ordering.
--   G  no fall-through to (c) — a protected failure must NOT reach branch (c),
--                               which would clear computation_error and stamp
--                               computed_at = now(), reporting a FAILED refresh
--                               as a fresh successful computation.
--   H  supersession retained  — a protected failed_final SUPERSEDED by a later
--                               same-kind 'done' resolves through branch (c) to
--                               complete_with_warnings (F-3 / PUB-02 intact).
--   H2 per-kind scope        — a later done of a DIFFERENT kind must NOT mask a
--                               real failure. H alone cannot see `d.kind = f.kind`;
--                               this arm is what makes that conjunct falsifiable.
--   I  IDEMPOTENT across      — the CR-01 regression (161.1 migration re-review,
--      bridge calls              MEDIUM). Protection is granted on a PLAIN
--                               'complete' row; branch (a) then bounces that row
--                               to 'computing' on a sibling job; the NEXT bridge
--                               call re-derives health from that bounced status
--                               and poisons the row it had already protected.
--                               Three bridge calls, one still-live marked job,
--                               and the row must survive all three.
--   I2 branch (a) still works — the discriminator for arm I. A published row with
--                               a non-terminal job and NO protected failure MUST
--                               still read 'computing'. Without this arm, deleting
--                               branch (a) outright passes arm I.
--   I3 the hold is SCOPED     — the CR-01 follow-up review finding. The first cut
--                               of v_protect_hold was per-STRATEGY: one live
--                               protected failure stood branch (a) down for EVERY
--                               later bridge call, so a user-initiated resync
--                               never advertised 'computing' and
--                               useStrategySyncPoller read a TERMINAL SUCCESS
--                               over a job that was still running. With a
--                               same-kind UNMARKED resync in flight the row must
--                               read 'computing' again — and when that resync
--                               SUCCEEDS it must supersede the protected failure
--                               and resolve through branch (c), clearing the
--                               error and ADVANCING computed_at.
--   I4 marked retry still held — the safety half of I3, and its discriminator in
--                               the other direction. A MARKED same-kind
--                               successor is the recurring arm re-attempting
--                               against a still-wedged venue; it must NOT release
--                               the hold. Drop the marker test from the successor
--                               predicate and CR-01 reopens through its own
--                               retry — and I3 alone would not notice.
--   J  kind-scoped marker     — the marker is read out of `metadata->>'source'`, a
--                               namespace shared with request-derived venue tokens
--                               (routers/process_key.py writes `body.source` into
--                               a 'process_key_long' enqueue). A marked job of a
--                               kind NO refresh arm can enqueue must stay LOUD.
--   J2 chain-hop kind kept    — the retention half of J: 'compute_analytics_from_csv'
--                               is the propagated hop (JOB_CHAIN_FOLLOW_ON) and
--                               MUST stay protected. Goes RED if the kind list is
--                               narrowed to the two fan-out kinds.
--   K  the EXECUTE ACL        — anon and authenticated must not be able to call
--                               the bridge at all. The migration's REVOKE is
--                               checked ONCE at apply; this re-asserts it on
--                               every run, because a later migration, a GRANT
--                               sweep or a restore-from-dump can undo it and
--                               nothing else would notice.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION
-- on failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- ⛔ THE APPLIED-NESS GATE RAISES. IT DOES NOT SKIP (WR-03, corrected 2026-08-25).
-- It used to `RAISE NOTICE 'SKIP: …'; RETURN;` when migration 20260825150000 was
-- absent. Measured, that meant: run this file the way the Usage line below
-- documents, against a database that has not received the migration, and it
-- executes 0 of the arms and exits 0 — a SILENT PASS on the gate for CR-01,
-- precisely on the runs where the protection is new and least proven. Inside
-- CI's `sql-tests` step a printed `NOTICE: SKIP:` is fatal, so it failed there —
-- but by accident of that grep, not because this file asserted anything, and a
-- fifth skip shape found live on main printed `… are SKIPPED:` and slipped the
-- grep entirely. Absence is now a FAILURE that names the object and both causes.
--
-- The gate stays CONDITIONAL, which is what separates it from a blanket abort:
-- with the migration applied it falls through and the arms decide the verdict.
-- The final 'ALL 16 ARMS EXECUTED (A, B, C, …, K)' notice is the sentinel CI's
-- loop reads the arm count off — if you add or remove an arm, update BOTH N and
-- the roster on that line. The roster is not decoration: `sql-tests` in
-- .github/workflows/ci.yml counts its entries and fails the job when they
-- disagree with N, which is what makes deleting an arm cost two edits in the
-- same string instead of one silent decrement. Until 2026-08-25 this file
-- carried the count WITHOUT a roster, and that check — which recognised only
-- the letter-range form the ledger tests use — skipped this file entirely: all
-- 16 arms, the whole of the CR-01 coverage, had no expectation on them beyond
-- an integer anyone could edit. The roster is spelled out rather than written
-- `(A-K)` because the sub-arms H2/I2/I3/I4/J2 are real arms that name WHICH
-- mechanism they discriminate, so this file's arms are 16 across 11 letters.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_sync_status_marked_refresh_protected.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, REDUNDER-BACKFILL). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ ONLY THE TWO APPLIED-NESS GATES USE THE `TEST FAILED (…)` IDIOM. All 16
-- arms below say `ARM x FAILED` / `ARM x SETUP BROKEN`, so they are invisible to
-- the runner's identity regex: a mutation that reddens an arm scores
-- NO-IDENTITY, not RED. The single twinned section is therefore `0`, and its
-- claim is the one the arms all rest on — that this file is running against a
-- database carrying the protection at all.
-- ⚠️ RE-BASE. The twin targets 20260826120000, NOT the 20260825150000 the arm
-- names: that COMMENT is re-stamped by five prior migrations and last by
-- 20260826120000:907, so a mutation of the earlier stamp is overwritten later in
-- the same apply list and proves nothing. Both `20260825150000` occurrences
-- inside the LAST stamp have to go, which is why the twin is two ordered steps.
-- The comment is not returned by pg_get_functiondef, so that migration's own
-- body post-verifies are untouched by it.
-- ⚠️ 20260510173005 is deliberately ABSENT: it is one of the three booked
-- [REDUNDER-SAVEPOINT] migrations and aborts any lane. Nothing is lost —
-- 20260510175507 is the repair migration and registers `process_key_long` on
-- its own.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql"]}

BEGIN;

DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k_mt5      UUID;
  s_a        UUID;  -- Arm A / G: protected single-key
  s_b        UUID;  -- Arm B: protected composite
  s_c        UUID;  -- Arm C: unmarked control
  s_d        UUID;  -- Arm D: foreign source
  s_e        UUID;  -- Arm E: marked but not published
  s_f        UUID;  -- Arm F: protected + unprotected together
  s_h        UUID;  -- Arm H: protected failure, superseded
  s_h2       UUID;  -- Arm H2: cross-kind supersession must NOT mask
  s_i        UUID;  -- Arm I: protection must survive a branch-(a) bounce
  s_i2       UUID;  -- Arm I2: branch (a) must still fire without a protection
  s_i3       UUID;  -- Arm I3: the hold is scoped to the jobs it is about
  s_i4       UUID;  -- Arm I4: a MARKED successor must NOT release the hold
  s_j        UUID;  -- Arm J: marked, but a kind no refresh arm enqueues
  s_j2       UUID;  -- Arm J2: the propagated chain-hop kind stays protected
  j          UUID;
  j_sib      UUID;
  tok        UUID;
  v_status   TEXT;
  v_error    TEXT;
  -- Phase 162 / HONEST-01: the OPERATOR-side read. The arms below no longer
  -- assert that the raw diagnostic reached strategy_analytics.computation_error
  -- (that WAS the defect); they assert it is absent from there and present
  -- here. Both halves matter — curating the user surface must not become
  -- curating every surface, which would blind the engineer instead.
  v_raw      TEXT;
  v_computed TIMESTAMPTZ;
  v_before   TIMESTAMPTZ;
  v_anchor   TIMESTAMPTZ;
  v_jobstat  TEXT;
BEGIN
  -- ⛔ Every arm seeds its job as status='running' with a claim_token, because
  -- mark_compute_job_failed refuses anything else (the mig-117 / P97 strict
  -- fence). Finality is forced with p_error_kind = 'permanent' — what the worker
  -- actually sends on this path — never by exhausting max_attempts.
  -- ----- presence gate (test-DB lag) -------------------------------------
  -- The function has existed since migration 038, so "does it exist" is not the
  -- question — "is THIS migration applied" is.
  --
  -- ⛔ Keyed on the function's COMMENT, deliberately, and this was MEASURED.
  -- The first draft keyed on the deployed BODY containing 'ledger-refresh'.
  -- That made the presence gate a substring of the exact text every neutering
  -- removes: neuter the protection predicate and the gate stops seeing the
  -- marker, prints SKIP, and exits 0. The headline falsification — "revert to
  -- the pre-fix bridge and watch arms A/B/G go RED" — came back GREEN. A
  -- presence gate must be independent of the thing under test. The comment is
  -- written by the same migration but is not part of any branch, so neutering
  -- the body leaves it intact and the arms actually run.
  --
  -- ----- applied-ness gate: ABSENCE IS A FAILURE, NOT A SKIP (WR-03) ------
  -- This file previously did `RAISE NOTICE 'SKIP: …'; RETURN;` here. Run the way
  -- the Usage line above documents, that exits 0 having executed 0 of the arms
  -- below — a silent pass on the gate for CR-01, on exactly the runs where the
  -- migration is new. The three sibling ledger gates were converted for this
  -- reason; this fourth one was missed. It is now a FAILURE, and it is still
  -- CONDITIONAL: a deployed function carrying the comment falls straight
  -- through to the arms.
  -- RED-UNDER: strip the `20260825150000` id out of the function COMMENT that
  --            migration 20260826120000 stamps — cause (ii) in the message
  --            below, a later migration re-defining the bridge and dropping the
  --            marker. ⚠️ LAYERED, and it must be: the id appears TWICE in that
  --            one comment (the PROTECTED MARKED REFRESH heading and the
  --            trailing `See migrations …` roll-call), and this gate's regex is
  --            a substring test, so removing either alone leaves it satisfied
  --            and the arm GREEN. ⚠️ And it targets 20260826120000, not the
  --            20260825150000 the message names: six migrations stamp this
  --            comment and that one is the LAST, so a mutation of the earlier
  --            stamp is overwritten inside the same apply list (the re-base
  --            hazard, MEASURED across this phase).
  -- RED-UNDER-M: {"arm":"0a","apply":[{"kind":"edit","file":"supabase/migrations/20260826120000_computation_error_curated_copy.sql","find":"PROTECTED MARKED REFRESH (mig 20260825150000, Phase 161.1 CR-01)","replace":"PROTECTED MARKED REFRESH (Phase 161.1 CR-01)","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260826120000_computation_error_curated_copy.sql","find":"+ 20260802120000 + 20260825150000 + 20260826120000.';","replace":"+ 20260802120000 + 20260826120000.';","occurrences":1}]}
  IF COALESCE(
       obj_description('sync_strategy_analytics_status(uuid)'::regprocedure, 'pg_proc'),
       ''
     ) !~ '20260825150000' THEN
    RAISE EXCEPTION 'TEST FAILED (0a): public.sync_strategy_analytics_status(uuid) does not carry the migration 20260825150000 comment on this database, so NONE of arms A-K ran. This is a FAILURE, not a skip. TWO causes fit and this assertion cannot distinguish them, so check both: (i) the TEST project has not received migration 20260825150000_sync_status_protect_marked_refresh.sql — apply it and re-run; expect this exactly once, on the PR that introduces or re-applies it, because NO workflow applies migrations to TEST; (ii) the function was REDEFINED by a later migration that dropped this comment, which silently reverts the CR-01 protection and un-publishes a funded account on its next failed maintenance refresh. ⛔ Do NOT "fix" this by restoring the old RAISE NOTICE/RETURN skip, and do NOT reword it to any phrasing CI''s SKIP grep cannot see: that is what made this file assert nothing while reading green.';
  END IF;

  -- ----- SECOND applied-ness gate: mig 20260826120000 (Phase 162 / HONEST-01)
  -- Arms A and I assert the CURATED sentence in computation_error. On a database
  -- that has 20260825150000 but not 20260826120000 the bridge still copies the
  -- job's raw diagnostic there, so those arms would fail with a copy MISMATCH —
  -- a message that reads like "the copy is wrong" when the real cause is "the
  -- migration is missing". Same shape as the gate above, same COMMENT key, and
  -- the same rule: absence is a FAILURE that names the cause, never a skip.
  IF COALESCE(
       obj_description('sync_strategy_analytics_status(uuid)'::regprocedure, 'pg_proc'),
       ''
     ) !~ '20260826120000' THEN
    RAISE EXCEPTION 'TEST FAILED (0b): public.sync_strategy_analytics_status(uuid) does not carry the migration 20260826120000 comment on this database, so arms A and I would report a copy mismatch for the wrong reason. TWO causes fit: (i) the TEST project has not received 20260826120000_computation_error_curated_copy.sql — apply it and re-run; NO workflow applies migrations to TEST; (ii) the function was REDEFINED by a later migration that dropped this comment, which silently reverts HONEST-01 and puts raw Python exception strings back in front of users in the wizard failure envelope.';
  END IF;

  -- ----- SEED ------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'ssr-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'ssr', 'ssr-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'ssr mt5', 'x', TRUE) RETURNING id INTO k_mt5;

  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr A') RETURNING id INTO s_a;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr B') RETURNING id INTO s_b;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr C') RETURNING id INTO s_c;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr D') RETURNING id INTO s_d;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr E') RETURNING id INTO s_e;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr F') RETURNING id INTO s_f;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr H') RETURNING id INTO s_h;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr H2') RETURNING id INTO s_h2;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr I') RETURNING id INTO s_i;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr I2') RETURNING id INTO s_i2;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr I3') RETURNING id INTO s_i3;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr I4') RETURNING id INTO s_i4;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr J') RETURNING id INTO s_j;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ssr J2') RETURNING id INTO s_j2;

  -- The four PUBLISHED rows are seeded identically on purpose: arms A, B, C and
  -- D differ ONLY in the job's metadata. Anything else that differed would be a
  -- second explanation for a divergent outcome.
  v_before := now() - INTERVAL '3 days';
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s_a, 'complete_with_warnings', TRUE, v_before),
         (s_b, 'complete_with_warnings', TRUE, v_before),
         (s_c, 'complete_with_warnings', TRUE, v_before),
         (s_d, 'complete_with_warnings', TRUE, v_before),
         (s_f, 'complete_with_warnings', TRUE, v_before),
         (s_h, 'complete_with_warnings', TRUE, v_before),
         (s_h2, 'complete_with_warnings', TRUE, v_before),
         -- Arms J / J2 keep that identical seed on purpose: they differ from arm
         -- A ONLY in the job's `kind`, so a divergent outcome has exactly one
         -- explanation.
         (s_j, 'complete_with_warnings', TRUE, v_before),
         (s_j2, 'complete_with_warnings', TRUE, v_before),
         -- Arm E: marked, but NOT published. The worker-side guard would have
         -- declined here too; the bridge must agree with it.
         (s_e, 'computing', TRUE, v_before);

  -- ⛔ Arms I / I2 / I3 / I4 seed a PLAIN 'complete' with computation_warned =
  -- FALSE, and that is the whole point of the arms rather than an incidental
  -- difference.
  -- Branch (a) PRESERVES 'complete_with_warnings' (and any warned row), so the
  -- seven rows above are structurally immune to the bounce arm I drives. Only a
  -- cleanly recomputed row — plain 'complete', warning cleared — can be bounced
  -- to 'computing', and that is the shape every successful refresh leaves
  -- behind. Seed these two as complete_with_warnings and arm I passes against
  -- the unfixed bridge.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s_i,  'complete', FALSE, v_before),
         (s_i2, 'complete', FALSE, v_before),
         (s_i3, 'complete', FALSE, v_before),
         (s_i4, 'complete', FALSE, v_before);

  -- ===== ARM A — protected single-key refresh ============================
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s_a, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'mt5 gateway IPC timeout (-10005)', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'ARM A SETUP BROKEN: the job is % , not failed_final. Nothing was ever asked of the bridge, so the status assertion below would pass vacuously.', v_jobstat;
  END IF;

  SELECT computation_status, computation_error, computed_at, computing_started_at
    INTO v_status, v_error, v_computed, v_anchor
    FROM strategy_analytics WHERE strategy_id = s_a;

  IF v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'ARM A FAILED (CR-01): a MARKED ledger refresh failing PERMANENT flipped a published row to %. src/lib/strategyGate.ts maps failed -> ANALYTICS_FAILED, so that is a funded account going dark on a maintenance tick.', v_status;
  END IF;
  -- ⚠️ REWRITTEN 2026-08-26 (Phase 162 / HONEST-01, mig 20260826120000). This
  -- used to assert `v_error = 'mt5 gateway IPC timeout (-10005)'` — i.e. it
  -- pinned the raw operator diagnostic INTO a column that renders verbatim to
  -- the user, which is the defect that phase closes. The INTENT it was
  -- protecting ("a protected refresh failure must stay VISIBLE, not silent") is
  -- unchanged and is asserted below; only the shape of the visible thing moved.
  -- Three parts, the same three the standing api_keys.sync_error invariant
  -- holds (analytics-service/tests/test_allocator_positions.py):
  SELECT last_error INTO v_raw FROM compute_jobs WHERE id = j;
  --   (1) the raw text is ABSENT from the user-visible column.
  IF v_error LIKE '%IPC timeout%' OR v_error LIKE '%-10005%' THEN
    RAISE EXCEPTION 'ARM A FAILED (HONEST-01): raw operator text reached strategy_analytics.computation_error (%). That column renders verbatim in the wizard failure envelope and the portfolio stale warning; branches (b)/(b-prime) must derive their copy from error_kind, never from the job''s own diagnostic.', v_error;
  END IF;
  --   (2) what IS there is the copy constant for this failure's kind. Spelled
  --       LITERALLY on purpose — asserting `= computation_error_copy('permanent')`
  --       would pass against a copy function that leaks its argument, i.e. it
  --       would be an assertion that cannot fail for the reason we care about.
  IF v_error IS DISTINCT FROM 'Analytics could not complete for this strategy, and retrying alone will not resolve it. Contact support if you need this strategy computed.' THEN
    RAISE EXCEPTION 'ARM A FAILED: computation_error is % — a protected refresh failure must stay VISIBLE (the curated sentence for a permanent failure), not silent and not raw.', COALESCE(v_error, 'NULL');
  END IF;
  --   (3) the DIAGNOSIS is not lost — it survives on the operator surface.
  IF v_raw IS DISTINCT FROM 'mt5 gateway IPC timeout (-10005)' THEN
    RAISE EXCEPTION 'ARM A FAILED (HONEST-01): compute_jobs.last_error is % — curating the USER surface must not curate the OPERATOR surface too. An engineer reads this column to find out what actually happened; blanking or rewriting it trades one dishonest screen for a blind one.', COALESCE(v_raw, 'NULL');
  END IF;
  IF v_anchor IS NOT NULL THEN
    RAISE EXCEPTION 'ARM A FAILED (JOB-01): computing_started_at survived a terminal transition; the stuck-computing reaper would re-fire on a stale stamp.';
  END IF;

  -- ===== ARM G — no fall-through to branch (c) ===========================
  -- Same row as arm A, read for the two things branch (c) would have done.
  IF v_computed IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ARM G FAILED: computed_at moved from % to % on a FAILED refresh. That is branch (c) reporting a failure as a fresh successful computation.', v_before, v_computed;
  END IF;
  -- (the computation_error assertion in arm A is the other half: branch (c)
  -- clears it to NULL.)

  -- ===== ARM B — protected composite refresh =============================
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s_b, 'stitch_composite', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh-composite', 'enqueued_at', now()))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'composite unstitchable: breach_ratio 436', 'permanent', tok);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s_b;
  IF v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'ARM B FAILED (CR-01): the COMPOSITE marker is not protected — a published composite flipped to %. The composite arm re-attempts every 20h on a permanently unstitchable book, so this is a PERMANENT outage, not a transient one.', v_status;
  END IF;

  -- ===== ARM C — the discriminator: unmarked still poisons ===============
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_c, 'derive_broker_dailies', 'running', tok, 1, 3)
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'user resync failed', 'permanent', tok);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s_c;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'ARM C FAILED: an UNMARKED permanent failure left the row at %. The exemption has leaked past the refresh markers — every user-initiated derive now fails SILENTLY and the wizard poller spins forever. (This arm is also what stops arms A/B passing against a bridge that flips nothing at all.)', v_status;
  END IF;

  -- ===== ARM D — a foreign source is not a refresh marker ================
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s_d, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'wizard'))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'wizard-initiated derive failed', 'permanent', tok);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s_d;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'ARM D FAILED: a job carrying metadata->>source = ''wizard'' was protected (row reads %). The predicate is testing for the PRESENCE of a source rather than for the two refresh markers.', v_status;
  END IF;

  -- ===== ARM E — marked, but the row is not published ====================
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s_e, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh'))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'refresh failed on a non-published row', 'permanent', tok);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s_e;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'ARM E FAILED: a marked refresh protected a row that reads % rather than a published status. Nothing else would move that row, so the strategy parks there until the 16-hour reaper — and a genuinely broken strategy reads healthy in the meantime.', v_status;
  END IF;

  -- ===== ARM F — an unprotected failure still wins =======================
  -- Order matters: seed the UNPROTECTED failure FIRST as a plain failed_final of
  -- a different kind (no RPC needed — the bridge reads the aggregate), then let
  -- the protected marked job transition. If branch (b-prime) were placed before
  -- branch (b), the real failure would be swallowed.
  INSERT INTO compute_jobs (strategy_id, kind, status, last_error, attempts, max_attempts)
  VALUES (s_f, 'sync_trades', 'failed_final', 'venue rejected the credential', 1, 3);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s_f, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh'))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'refresh failed too', 'permanent', tok);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s_f;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'ARM F FAILED: a REAL non-superseded failed_final (kind sync_trades) was masked by a protected refresh failure; the row reads %. Branch (b-prime) must be strictly AFTER branch (b).', v_status;
  END IF;

  -- ===== ARM H — supersession is retained ================================
  -- A protected failed_final that a strictly-later same-kind 'done' supersedes
  -- must drop out of BOTH classes, leaving branch (c) to resolve the row. This
  -- is the F-3 / PUB-02 anchor the re-base must not have reverted, exercised
  -- through the new partition rather than asserted on the function text.
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata, created_at)
  VALUES (s_h, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh'), now() - INTERVAL '2 hours')
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'yesterday''s refresh failed', 'permanent', tok);

  INSERT INTO compute_jobs (strategy_id, kind, status, created_at)
  VALUES (s_h, 'derive_broker_dailies', 'done', now());
  PERFORM sync_strategy_analytics_status(s_h);

  SELECT computation_status, computation_error INTO v_status, v_error
    FROM strategy_analytics WHERE strategy_id = s_h;
  IF v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'ARM H FAILED (F-3/PUB-02): a SUPERSEDED protected failure did not resolve through branch (c); the row reads %. The re-base lost the supersession scope, or branch (b-prime) is swallowing superseded rows.', v_status;
  END IF;
  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION 'ARM H FAILED: branch (c) did not clear the stale computation_error (%) after a superseding success.', v_error;
  END IF;

  -- H2 — the PER-KIND half. H alone cannot see `d.kind = f.kind`: its failure
  -- and its superseding success are the same kind either way. Here the later
  -- 'done' is a DIFFERENT kind, so it must NOT mask the failure. Without the
  -- per-kind scope this row resolves to a published status and a real permanent
  -- failure disappears behind an unrelated success (the cross-kind-blind defect
  -- that killed held PR 229d80fa).
  INSERT INTO compute_jobs (strategy_id, kind, status, last_error, created_at)
  VALUES (s_h2, 'sync_trades', 'failed_final', 'venue rejected the credential',
          now() - INTERVAL '2 hours');
  INSERT INTO compute_jobs (strategy_id, kind, status, created_at)
  VALUES (s_h2, 'derive_broker_dailies', 'done', now());
  PERFORM sync_strategy_analytics_status(s_h2);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s_h2;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'ARM H2 FAILED (F-3/PUB-02): a later done of a DIFFERENT kind masked a real permanent failure; the row reads %. The re-base dropped `d.kind = f.kind` from the supersession subquery.', v_status;
  END IF;

  -- ===== ARM I — the protection must be IDEMPOTENT across bridge calls =====
  -- The regression the 161.1 migration re-review found (MEDIUM). b-prime grants
  -- protection by LEAVING the published status alone — and the health conjunct
  -- is then re-derived from that same status on the NEXT call. Branch (a)
  -- transiently overwrites it with 'computing' whenever any sibling job is in
  -- flight, so the second call reads the row as unhealthy and the SAME
  -- still-live protected job routes to the loud branch, poisoning the row it
  -- had already protected. The bridge is called THREE times here against ONE
  -- marked failure; the row must survive all three.
  --
  -- ⛔ THE EXPLICIT EARLIER created_at IS WHAT MAKES THIS ARM DISCRIMINATE, and
  -- it was added by MEASUREMENT, not symmetry (CR-01 follow-up review). The
  -- branch-(a) hold is released only for a strictly-LATER, SAME-KIND, UNMARKED
  -- successor; this arm's sibling is unmarked and later, and differs from the
  -- failure ONLY in kind, so it is the falsification for the same-kind conjunct.
  -- Without the offset it is not "later" at all: `now()` is the TRANSACTION
  -- timestamp, so every row this DO block inserts shares one value and the
  -- STRICT `r.created_at > f.created_at` alone kept the successor invisible.
  -- Measured, that made the arm pass with `r.kind = f.kind` DELETED from the
  -- successor predicate — i.e. it went green over a bridge that lets any
  -- unrelated poller release the hold, bounce the row and poison it three calls
  -- later. With the offset, deleting that conjunct turns this arm RED.
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata, created_at)
  VALUES (s_i, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()),
          now() - INTERVAL '2 hours')
  RETURNING id INTO j;

  -- call 1 — grants the protection.
  PERFORM mark_compute_job_failed(j, 'mt5 gateway IPC timeout (-10005)', 'permanent', tok);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s_i;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'ARM I SETUP BROKEN: call 1 left the row at % rather than the protected ''complete''. The idempotence assertions below would be measuring a protection that was never granted.', v_status;
  END IF;

  -- call 2 — a SIBLING job of another kind goes non-terminal, so branch (a)
  -- fires. Kind is deliberately different from the failed job's, so it can never
  -- supersede it: the marked failure stays live for call 3.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts)
  VALUES (s_i, 'sync_trades', 'pending', 0, 3)
  RETURNING id INTO j_sib;

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j_sib;
  IF v_jobstat NOT IN ('pending', 'running', 'done_pending_children', 'failed_retry') THEN
    RAISE EXCEPTION 'ARM I SETUP BROKEN: the sibling job is %, which branch (a) does not count as non-terminal, so branch (a) is never reached and this arm proves nothing.', v_jobstat;
  END IF;

  PERFORM sync_strategy_analytics_status(s_i);

  -- ⛔ No assertion on the row here, deliberately. Whether the bounce is
  -- suppressed at branch (a) or absorbed elsewhere is an implementation choice;
  -- pinning the intermediate status would pin ONE remedy and go RED against the
  -- other. The seed check above is what makes the arm non-vacuous — it proves
  -- branch (a)'s precondition was actually met. Arm I2 proves branch (a) is
  -- still alive.

  -- call 3 — the sibling terminalizes (a DIFFERENT kind, so F-3/PUB-02
  -- supersession does not clear the marked failure) and the bridge re-derives
  -- with the same still-live protected job.
  UPDATE compute_jobs SET status = 'done' WHERE id = j_sib;
  PERFORM sync_strategy_analytics_status(s_i);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'ARM I SETUP BROKEN: the marked job is % at call 3, not failed_final — nothing was still being asked of the protection.', v_jobstat;
  END IF;

  SELECT computation_status, computation_error, computed_at, computing_started_at
    INTO v_status, v_error, v_computed, v_anchor
    FROM strategy_analytics WHERE strategy_id = s_i;

  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'ARM I FAILED (CR-01 idempotence): the row reads % after a third bridge call over ONE still-live protected failure. The protection is re-derived from a status branch (a) transiently overwrites, so a sibling job is all it takes to un-publish the funded account the first call protected.', v_status;
  END IF;
  -- Same rewrite as arm A (Phase 162 / HONEST-01): visibility is still the
  -- property under test, but the visible thing is now the curated sentence and
  -- the raw diagnostic must be on the job row instead.
  SELECT last_error INTO v_raw FROM compute_jobs WHERE id = j;
  IF v_error LIKE '%IPC timeout%' OR v_error LIKE '%-10005%' THEN
    RAISE EXCEPTION 'ARM I FAILED (HONEST-01): raw operator text reached strategy_analytics.computation_error (%) across the bounce.', v_error;
  END IF;
  IF v_error IS DISTINCT FROM 'Analytics could not complete for this strategy, and retrying alone will not resolve it. Contact support if you need this strategy computed.' THEN
    RAISE EXCEPTION 'ARM I FAILED: computation_error is % after the bounce — the protected failure stopped being VISIBLE, which is half of what b-prime promises.', COALESCE(v_error, 'NULL');
  END IF;
  IF v_raw IS DISTINCT FROM 'mt5 gateway IPC timeout (-10005)' THEN
    RAISE EXCEPTION 'ARM I FAILED (HONEST-01): compute_jobs.last_error is % after the bounce — the diagnosis must survive on the operator surface.', COALESCE(v_raw, 'NULL');
  END IF;
  IF v_computed IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'ARM I FAILED: computed_at moved from % to % across the bounce. A FAILED refresh must never read as freshly computed, whichever branch does the writing.', v_before, v_computed;
  END IF;
  IF v_anchor IS NOT NULL THEN
    RAISE EXCEPTION 'ARM I FAILED (JOB-01): computing_started_at survived; the row is not computing, so the reaper key must be clear.';
  END IF;

  -- ===== ARM I2 — branch (a) still fires when nothing is protected ==========
  -- THE DISCRIMINATOR for arm I. Arm I is passed trivially by a bridge that
  -- deleted branch (a) altogether, or that never writes 'computing' on any row.
  -- Identical seed to arm I (plain 'complete', warned FALSE) and an identical
  -- non-terminal job — the ONLY difference is that no protected failure exists.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts)
  VALUES (s_i2, 'sync_trades', 'pending', 0, 3);
  PERFORM sync_strategy_analytics_status(s_i2);

  SELECT computation_status, computing_started_at INTO v_status, v_anchor
    FROM strategy_analytics WHERE strategy_id = s_i2;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'ARM I2 FAILED: a published row with an in-flight job and NO protected failure reads % instead of ''computing''. Branch (a) has been disabled rather than exempted, so every in-flight job is now invisible to the wizard poller.', v_status;
  END IF;
  IF v_anchor IS NULL THEN
    RAISE EXCEPTION 'ARM I2 FAILED (JOB-01): the transition INTO computing did not stamp computing_started_at, so the stuck-computing reaper can never fire on this row.';
  END IF;

  -- ===== ARM I3 — the hold is SCOPED to the jobs it is about ================
  -- The CR-01 follow-up review finding. Arm I pins that the protection SURVIVES
  -- an unrelated sibling; it says nothing about what that costs. The first cut
  -- of `v_protect_hold` paid for it per-STRATEGY: one live protected failure
  -- stood branch (a) down for EVERY later bridge call on that strategy until a
  -- same-kind 'done' superseded it. MEASURED consequence on a plain-'complete'
  -- row — a user-initiated resync never advertised 'computing', and
  -- `useStrategySyncPoller` treats the row as TERMINAL on
  -- `nextStatus === 'failed' || isComputedAnalytics(nextStatus)`, so the poller
  -- exited on a stale success while the job it kicked off was still running and
  -- SyncPreviewStep materialised the PRE-resync factsheet.
  --
  -- ⛔ The failure is seeded with an EXPLICIT earlier created_at, and that is
  -- load-bearing rather than decorative. `now()` is the TRANSACTION timestamp,
  -- so every row this DO block inserts shares one value; both the successor test
  -- (`r.created_at > f.created_at`) and F-3/PUB-02 supersession
  -- (`d.created_at > f.created_at`) are STRICT, so without the offset neither
  -- fires and the arm would silently measure the un-scoped path instead. Arm H
  -- carries the same offset for the same reason.
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata, created_at)
  VALUES (s_i3, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh'), now() - INTERVAL '2 hours')
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'mt5 gateway IPC timeout (-10005)', 'permanent', tok);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s_i3;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'ARM I3 SETUP BROKEN: the protection was never granted (row reads %), so the scope assertions below would be measuring nothing.', v_status;
  END IF;

  -- The user resyncs: an UNMARKED job of the FAILURE'S OWN KIND, enqueued after
  -- it. That is the one shape of in-flight job whose terminal outcome decides
  -- the protected failure on its own, so branch (a) may safely advertise it.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts)
  VALUES (s_i3, 'derive_broker_dailies', 'running', 1, 3)
  RETURNING id INTO j_sib;
  PERFORM sync_strategy_analytics_status(s_i3);

  SELECT computation_status, computing_started_at INTO v_status, v_anchor
    FROM strategy_analytics WHERE strategy_id = s_i3;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'ARM I3 FAILED: a user-initiated resync of the protected failure''s OWN KIND is in flight and the row still reads % rather than ''computing''. The branch-(a) hold is per-STRATEGY again, so src/hooks/useStrategySyncPoller.ts reads a TERMINAL SUCCESS over a running job and SyncPreviewStep hands the user the pre-resync factsheet.', v_status;
  END IF;
  IF v_anchor IS NULL THEN
    RAISE EXCEPTION 'ARM I3 FAILED (JOB-01): the released hold let branch (a) resolve to ''computing'' without stamping computing_started_at, so the stuck-computing reaper can never fire on this row.';
  END IF;

  -- …and the release is SOUND because that successor's outcome DOMINATES: its
  -- 'done' is a strictly-later same-kind success, which SUPERSEDES the protected
  -- failure outright (F-3/PUB-02), so the row resolves through branch (c) even
  -- though branch (a) has already overwritten the status the health conjunct
  -- reads. That is the whole argument for why branch (a) may be let loose here,
  -- and this is where it is exercised end to end: an unsound release lands the
  -- strategy at 'failed' after a resync that WORKED.
  --
  -- ⛔ WHAT THESE THREE ASSERTIONS DO AND DO NOT PIN, measured rather than
  -- assumed. They pin the LANDING — a clean success, no stale error, no frozen
  -- vintage — and they redden on an unsound release. They do NOT pin branch (c)
  -- itself: branch (a) already wrote computation_error = NULL and computed_at =
  -- now() at call 2, and `now()` is the TRANSACTION timestamp, so inside one
  -- transaction a later branch-(c) stamp is indistinguishable from branch (a)'s.
  -- MEASURED: delete `computed_at = now()` from branch (c) and this arm stays
  -- GREEN. Branch (c)'s own stamp and error-clear are pinned by arm H, which
  -- reaches (c) without ever passing through (a). Recorded here so the next
  -- reader does not mistake these three for a second, independent pin on it.
  UPDATE compute_jobs SET status = 'done' WHERE id = j_sib;
  PERFORM sync_strategy_analytics_status(s_i3);

  SELECT computation_status, computation_error, computed_at
    INTO v_status, v_error, v_computed
    FROM strategy_analytics WHERE strategy_id = s_i3;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'ARM I3 FAILED: after the resync SUCCEEDED the row reads % rather than ''complete''. Releasing the hold is only sound because a strictly-later same-kind ''done'' supersedes the protected failure; if it does not, branch (a) has already destroyed the health conjunct and the strategy goes dark on a resync that WORKED.', v_status;
  END IF;
  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION 'ARM I3 FAILED: the row still carries % after a superseding success. A resync that WORKED must not keep advertising the refresh failure it replaced.', v_error;
  END IF;
  IF v_computed <= v_before THEN
    RAISE EXCEPTION 'ARM I3 FAILED: computed_at is still the pre-resync % after a SUCCESSFUL resync. Nothing outside this bridge writes strategy_analytics.computed_at — the analytics runner never touches that column — so a value frozen here renders the factsheet FreshnessChip and the portfolio PDF vintage as permanently stale on a strategy that was just recomputed.', v_before;
  END IF;

  -- ===== ARM I4 — a MARKED successor must NOT release the hold =============
  -- The safety half of I3, and its discriminator in the other direction. I3 is
  -- passed by a successor predicate that admits ANY strictly-later same-kind
  -- job; this arm is what forces the UNMARKED conjunct. The successor here is
  -- the recurring arm's OWN next tick against a still-wedged venue — the CR-01
  -- scenario-1 case. Admit it and the hold is released, branch (a) bounces the
  -- published row to 'computing', the tick fails again, the health conjunct now
  -- reads 'computing' and branch (b) writes 'failed': CR-01 reopened by the very
  -- retry that was supposed to heal it. Differs from I3 ONLY in the successor's
  -- metadata.
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata, created_at)
  VALUES (s_i4, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh'), now() - INTERVAL '2 hours')
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'mt5 gateway IPC timeout (-10005)', 'permanent', tok);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, metadata)
  VALUES (s_i4, 'derive_broker_dailies', 'running', 1, 3,
          jsonb_build_object('source', 'ledger-refresh'));
  PERFORM sync_strategy_analytics_status(s_i4);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s_i4;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'ARM I4 FAILED: a MARKED same-kind retry released the branch-(a) hold and the row reads %. That successor is the recurring refresh arm re-attempting against a still-wedged venue — it will fail again, and the health conjunct it just bounced to ''computing'' sends the SAME failure to branch (b). The successor predicate must exclude marked jobs.', v_status;
  END IF;

  -- ===== ARM J — the marker is KIND-SCOPED =================================
  -- `metadata->>'source'` is not a private namespace. The one request-derived
  -- writer of compute_jobs.metadata is routers/process_key.py, which puts
  -- `body.source` (a Pydantic venue Literal) into a 'process_key_long' enqueue.
  -- Today those values cannot collide with the refresh markers, so this arm is
  -- NOT a live exploit — it pins the second, structural half of the containment,
  -- the half that survives someone widening that Literal. Differs from arm A
  -- ONLY in `kind`.
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s_j, 'process_key_long', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'long fetch failed', 'permanent', tok);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s_j;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'ARM J FAILED: a ''process_key_long'' job carrying a refresh marker was PROTECTED (row reads %). No refresh arm enqueues that kind — the fan-outs enqueue derive_broker_dailies and stitch_composite, and the chain hop propagates only into compute_analytics_from_csv — so the predicate is trusting a metadata key it shares with request-derived venue tokens.', v_status;
  END IF;

  -- ===== ARM J2 — the propagated chain-hop kind stays protected ============
  -- The retention half of J. 'compute_analytics_from_csv' is not enqueued by
  -- either fan-out: it is the JOB_CHAIN_FOLLOW_ON hop out of
  -- derive_broker_dailies, and services/job_worker.py forwards the marker onto
  -- it. It compiles the factsheet, so it is precisely the hop whose failure
  -- would un-publish. Narrow the kind list to the two fan-out kinds and this
  -- arm goes RED.
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s_j2, 'compute_analytics_from_csv', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh', 'chained_from', 'derive_broker_dailies'))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'factsheet compile failed', 'permanent', tok);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s_j2;
  IF v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'ARM J2 FAILED: the chained ''compute_analytics_from_csv'' hop is NOT protected (row reads %). The marker is forwarded onto that hop by services/job_worker.py, and it is the hop that compiles the factsheet — dropping it from the kind scope re-opens CR-01 on the single-key arm one hop later.', v_status;
  END IF;

  -- ===== ARM K — the EXECUTE ACL, RE-ASSERTED ON EVERY RUN =================
  -- 161.1 re-review (rls-policy-auditor, HIGH — classified a PIN GAP, not an
  -- open hole: the REVOKE is correct as written, it was simply the one ACL in
  -- this phase that nothing checked twice).
  --
  -- Migration 20260825150000's DO block now checks this too, but ONCE, at apply.
  -- A later migration, a GRANT sweep, a role-template change or a
  -- restore-from-dump can undo it afterwards and nothing would notice —
  -- 20260515130001_enqueue_compute_job_internal_acl_remediation.sql exists
  -- precisely because a REVOKE on an enqueue path was lost that way. A
  -- CREATE OR REPLACE also PRESERVES the existing ACL, so a re-apply carries any
  -- drift forward silently rather than healing it.
  --
  -- ⛔ WHY THIS PARTICULAR REVOKE MATTERS MORE THAN MOST. Every other object in
  -- this phase is a reader. This one is a cross-tenant SECURITY DEFINER WRITER:
  -- it upserts strategy_analytics for whatever strategy_id it is handed, with no
  -- ownership predicate anywhere in its body, because its only legitimate
  -- callers are service-role RPCs that established authority before calling it.
  -- Reachable by `authenticated`, it becomes a publish-state write primitive
  -- over other tenants' funded accounts — park any strategy at 'computing' by
  -- id, or drive it to 'failed' via branch (b). RLS on strategy_analytics does
  -- not bound it; SECURITY DEFINER is exactly the thing that bypasses RLS.
  --
  -- ⚠️ THE EXISTENCE ASSERTION IS NOT DECORATION. It comes FIRST so that an
  -- ABSENT function reddens by NAME rather than by a bare 42883 from
  -- has_function_privilege three lines later — "no grants because there is
  -- nothing to grant on" must never be spelled the same way as "the REVOKE
  -- held". (has_function_privilege does raise 42883 rather than returning FALSE
  -- — MEASURED on PG 16.13, not assumed — so the arm is non-vacuous either way;
  -- this makes the failure legible instead of merely loud.)
  IF to_regprocedure('public.sync_strategy_analytics_status(uuid)') IS NULL THEN
    RAISE EXCEPTION 'ARM K FAILED: public.sync_strategy_analytics_status(uuid) does not exist on this database, so the two ACL assertions below would have reddened on a missing OBJECT rather than on a missing REVOKE. Fix the object first; the ACL verdict for this run is UNKNOWN, not green.';
  END IF;
  IF has_function_privilege('anon', 'public.sync_strategy_analytics_status(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ARM K FAILED: role anon can EXECUTE sync_strategy_analytics_status. That is a SECURITY DEFINER writer with no ownership check in its body — an unauthenticated caller could drive any tenant''s strategy_analytics publish state by strategy_id. The REVOKE in migration 20260825150000 is the only thing bounding it.';
  END IF;
  IF has_function_privilege('authenticated', 'public.sync_strategy_analytics_status(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ARM K FAILED: role authenticated can EXECUTE sync_strategy_analytics_status. That is a SECURITY DEFINER writer with no ownership check in its body — any signed-in user could drive ANOTHER tenant''s funded account to ''computing'' or ''failed'' by strategy_id. The REVOKE in migration 20260825150000 is the only thing bounding it.';
  END IF;

  RAISE NOTICE 'ALL 16 ARMS EXECUTED (A, B, C, D, E, F, G, H, H2, I, I2, I3, I4, J, J2, K): sync_strategy_analytics_status protects a MARKED ledger refresh (A single-key, B composite, G no branch-(c) fall-through) IDEMPOTENT across a branch-(a) bounce (I, discriminated by I2) with the branch-(a) hold SCOPED to the jobs it is about (I3 releases it for a same-kind unmarked resync and lands that resync on branch (c); I4 refuses to release it for the recurring arm''s own marked retry) and KIND-SCOPED (J2 keeps the chain hop) — and stays LOUD everywhere else (C unmarked, D foreign source, E unpublished row, F unprotected sibling, H/H2 supersession same-kind and cross-kind, J foreign kind) — and is UNREACHABLE by anon/authenticated (K).';
END $$;

ROLLBACK;
