-- ==========================================================================
-- Phase 164.5.2 BRIDGELOCK — `161.1-D1` / DEC-4: the per-strategy advisory
-- lock in the two terminal mark RPCs, proven with TWO REAL BACKENDS.
--
-- WHAT IS UNDER TEST. Migration
-- 20260926120000_mark_compute_job_bridge_advisory_lock.sql makes
-- `mark_compute_job_done` and `mark_compute_job_failed` take a two-integer,
-- transaction-scoped advisory lock (namespace 'mark_compute_job_bridge', second
-- key the strategy id) directly before their UI bridge call. A second terminal
-- mark on the SAME strategy must therefore wait on THAT lock until the first
-- commits, and a mark on a DIFFERENT strategy must not wait at all.
--
-- HOW. Plain PL/pgSQL DO blocks, RAISE EXCEPTION on failure. pgTAP is NOT
-- installed (CLAUDE.md). No psql meta-commands. Under psql -v ON_ERROR_STOP=1
-- a failed assertion exits non-zero. Each arm opens two `dblink` sessions back
-- into the same throwaway cluster: session `a` opens a transaction and runs a
-- mark on job 1 of the arm's strategy WITHOUT committing; session `b` sends
-- the mark of job 2 asynchronously; the gate's own session then polls
-- `pg_locks` (read live on every call, unlike pg_stat_activity, which is
-- snapshotted per transaction) until b's first UNGRANTED lock appears, and
-- asserts WHICH lock that is. Then `a` commits, b's result is consumed, both
-- sessions disconnect. The poll is bounded (200 x 50 ms) and exits on the
-- first ungranted row, so it never sleeps longer than it must.
--
-- ⛔ THE OBSERVABLE IS "WHICH LOCK", NEVER "WHETHER B WAITS" (CONTEXT D-14,
-- CORRECTED by measurement, RESEARCH Q3). With the lock line deleted from the
-- migration, b STILL blocks — on a `transactionid` ShareLock, waiting for a's
-- strategy_analytics row write, AFTER b's own bridge reads have already run.
-- A gate that asserted only "b waited" passes with the lock removed. Every arm
-- below asserts an ungranted row with `locktype = 'advisory'`, and L3 pins its
-- namespace and two-integer form: `pg_locks.classid` is an OID, so it is
-- compared with `(hashtext(ns)::bigint & 4294967295)::oid`, never with the
-- signed int4 (RESEARCH Pitfall 1), and a two-integer key reports objsubid 2
-- where a single bigint key reports 1.
--
-- ⛔ NO BEGIN/ROLLBACK WRAPPER, by necessity: the dblink backends are separate
-- transactions and cannot see uncommitted seeds, so every seed below is
-- COMMITTED. That is acceptable only because this file is LANE-ONLY (below)
-- and every lane leg, baseline, arm and restore boots a FRESH cluster, so
-- committed rows never outlive the run. Seed ids cross DO blocks through a
-- session TEMP table, because plpgsql variables do not.
--
-- ⛔ IDENTITIES ARE RAISED ONLY IN THIS SESSION'S DO BODIES. The dblink
-- sessions produce lock state; the gate session observes it and raises. A
-- raise inside a dblink session would score NO-IDENTITY under the runner's
-- source-location attribution (GRAMMAR rule 3c).
--
-- INVARIANT (named, NOT counted): a strategy-less job (portfolio, allocator)
-- takes no lock and marks without error. No production mutation of this
-- behaviour is observable from a gate: the lock sits inside the existing
-- non-NULL strategy guard, and even unguarded `pg_advisory_xact_lock` is
-- STRICT, so `hashtext(NULL)` makes it a silent no-op. The placement is pinned
-- instead by the migration's own statement-shaped self-verify anchor.
--
-- SETUP identities (`Ln-SETUP`, folded into their arm by the runner) check
-- only prerequisites no twin touches: the seeded rows exist and are visible
-- from backend b, b waited on something at all, and after a commits both
-- marks actually completed. ⛔ No SETUP check inspects the function body for
-- the lock: a static check would redden BEFORE the concurrency observable ran
-- and make the RED of each twin vacuous.
--
-- ARMS (each carries a layered RED-UNDER-M twin beside it: the production edit
-- to the migration plus the matching self-verify anchor stood down with
-- `IF FALSE AND …`, or the migration's own DO block would abort the apply):
--   L1  done/done on one strategy: b waits on an ADVISORY lock.
--       Twin: delete the lock statement in mark_compute_job_done.
--   L2  failed/failed on one strategy: b waits on an ADVISORY lock.
--       Twin: delete the lock statement in mark_compute_job_failed. The SAME
--       RPC sits on both sides of every pair, so removing the lock from ONE
--       RPC reddens exactly one of L1 / L2.
--   L3  done/done: b's ungranted advisory row carries the namespace's masked
--       OID as classid and objsubid 2 (the two-integer form). Twin: rewrite
--       both locks to the single-key strategy hash that sync_trades and
--       positions_atomic_rebuild take (L1 and L2 still see an advisory wait,
--       objsubid 1, so they stay green and L3 is first).
--   L4  while a holds a done mark on strategy S, a done mark on a DIFFERENT
--       strategy S2 completes without waiting. Twin: replace the strategy key
--       of both locks with a constant, so every mark in the namespace
--       serializes (L3 still passes: namespace and form are intact).
--   The file order L1, L2, L3, L4 is what makes each twin's FIRST failure its
--   own arm: every twin leaves the arms above its own green.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- `RED-UNDER-M` object that scripts/mutation-runner executes on every push: it
-- mutates COPIES on a throwaway pg-lane cluster, requires the FIRST failure
-- identity to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md.
--
-- ⚠️ Apply order: the apply list of
-- supabase/tests/test_sync_status_curated_sentence_survives.sql (the core
-- fixtures, the compute_jobs queue and claim-token fencing, the strategy kinds,
-- and the bridge at 20260906120000), with fixture 36 (dblink) added after the
-- core fixtures and the lock migration LAST, because its CREATE OR REPLACEs
-- must be the definitions the arms run against. 20260603120000 is deliberately
-- ABSENT: it has never been applied on the lane, it redefines both claim RPCs
-- with an explicit BEGIN/COMMIT, and the lock migration re-bases the full mark
-- bodies, so the lane does not need it.
-- LANE-ONLY: {"object":"dblink","fixture":"scripts/pg-lane/fixtures/36-fixture-dblink.sql","job":"sql-mutation","reason":"Every arm drives two dblink sessions back into the database it runs in; that needs committed seed rows and a trust-auth superuser loopback connection, which the local Supabase stack behind sql-tests does not give without a password in a committed file, and the dblink extension is not in the schema of record. The arms execute and are mutation-checked twin-by-twin on the pg-lane under sql-mutation."}
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","scripts/pg-lane/fixtures/36-fixture-dblink.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql"]}

CREATE EXTENSION IF NOT EXISTS dblink;

CREATE TEMP TABLE bridge_lock_gate_seed (
  arm         TEXT NOT NULL,
  slot        INT  NOT NULL,
  strategy_id UUID NOT NULL,
  job_id      UUID NOT NULL,
  claim_token UUID NOT NULL,
  PRIMARY KEY (arm, slot)
);

-- ----- SEED (COMMITTED) ---------------------------------------------------
-- One strategy per arm, two RUNNING jobs on it. The two jobs are of DIFFERENT
-- kinds because compute_jobs_one_inflight_per_kind_strategy forbids two
-- in-flight rows of one kind on one strategy. Neutral labels only.
DO $$
DECLARE
  uid  UUID := gen_random_uuid();
  k    UUID;
  s    UUID;
  j    UUID;
  tok  UUID;
  arm  TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'blk-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'blk', 'blk-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'blk mt5', 'x', TRUE) RETURNING id INTO k;

  FOREACH arm IN ARRAY ARRAY['L1', 'L2', 'L3'] LOOP
    INSERT INTO strategies (user_id, api_key_id, name)
    VALUES (uid, k, 'blk ' || arm) RETURNING id INTO s;

    tok := gen_random_uuid();
    INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
    VALUES (s, 'derive_broker_dailies', 'running', tok, 1, 3) RETURNING id INTO j;
    INSERT INTO bridge_lock_gate_seed VALUES (arm, 1, s, j, tok);

    tok := gen_random_uuid();
    INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
    VALUES (s, 'stitch_composite', 'running', tok, 1, 3) RETURNING id INTO j;
    INSERT INTO bridge_lock_gate_seed VALUES (arm, 2, s, j, tok);
  END LOOP;

  -- L4: two DIFFERENT strategies, one running job each.
  INSERT INTO strategies (user_id, api_key_id, name)
  VALUES (uid, k, 'blk L4 S') RETURNING id INTO s;
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 1, 3) RETURNING id INTO j;
  INSERT INTO bridge_lock_gate_seed VALUES ('L4', 1, s, j, tok);

  INSERT INTO strategies (user_id, api_key_id, name)
  VALUES (uid, k, 'blk L4 S2') RETURNING id INTO s;
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 1, 3) RETURNING id INTO j;
  INSERT INTO bridge_lock_gate_seed VALUES ('L4', 2, s, j, tok);
END
$$;

-- ===== ARM L1 — done/done on one strategy waits on the ADVISORY lock ========
-- RED-UNDER: delete the lock statement from mark_compute_job_done in
--            20260926120000. b then still blocks, but on a transactionid
--            ShareLock (a's strategy_analytics write), after its bridge reads.
--            ⚠️ LAYERED: that migration's own lock anchor would abort the
--            apply, so it is stood down in the same mutation.
-- RED-UNDER-M: {"arm":"L1","apply":[{"kind":"edit","file":"supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","find":"PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(v_strategy_id::text));","replace":"","occurrences":2,"nth":1},{"kind":"edit","file":"supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","find":"IF NOT v_done_lock_anchored THEN","replace":"IF FALSE AND NOT v_done_lock_anchored THEN","occurrences":1}]}
DO $$
DECLARE
  cs     TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                        current_setting('port'), current_database(), current_user);
  j1     UUID;
  t1     UUID;
  j2     UUID;
  t2     UUID;
  b_pid  INT;
  n_vis  INT;
  i      INT;
  st1    TEXT;
  st2    TEXT;
BEGIN
  SELECT job_id, claim_token INTO j1, t1 FROM bridge_lock_gate_seed WHERE arm = 'L1' AND slot = 1;
  SELECT job_id, claim_token INTO j2, t2 FROM bridge_lock_gate_seed WHERE arm = 'L1' AND slot = 2;
  IF j1 IS NULL OR j2 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (L1-SETUP): the committed seed for arm L1 is missing, so no mark below would run and every assertion would read nothing.';
  END IF;
  IF to_regprocedure('public.mark_compute_job_done(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (L1-SETUP): public.mark_compute_job_done(uuid, uuid) does not resolve on this lane, so the apply list did not produce the function under test.';
  END IF;

  PERFORM dblink_connect('lg_a', cs);
  PERFORM dblink_connect('lg_b', cs);

  SELECT n INTO n_vis
    FROM dblink('lg_b', format('SELECT count(*)::int FROM compute_jobs WHERE id IN (%L, %L) AND status = %L',
                               j1, j2, 'running')) AS x(n int);
  IF n_vis IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (L1-SETUP): backend b sees % of the 2 seeded running jobs, so the seed is not committed or not visible and b''s mark could not run.', COALESCE(n_vis, 0);
  END IF;

  PERFORM dblink_exec('lg_a', 'BEGIN');
  -- dblink_exec refuses a SELECT (2F003); dblink() with the void cast to text.
  PERFORM * FROM dblink('lg_a', format('SELECT mark_compute_job_done(%L, %L)::text', j1, t1)) AS x(v text);
  SELECT pid INTO b_pid FROM dblink('lg_b', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('lg_b', format('SELECT mark_compute_job_done(%L, %L)::text', j2, t2));

  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted);
    PERFORM pg_sleep(0.05);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted) THEN
    RAISE EXCEPTION 'TEST FAILED (L1-SETUP): backend b never waited on anything while a held an uncommitted done mark on the same strategy, so the two marks did not overlap and nothing below could be observed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted AND locktype = 'advisory') THEN
    RAISE EXCEPTION 'TEST FAILED (L1): a second mark_compute_job_done on the same strategy is waiting, but NOT on an advisory lock. Two concurrent terminal done marks on one strategy are not serialized before the bridge, so both bridge runs read compute_jobs at READ COMMITTED while the other is changing it (161.1-D1).';
  END IF;

  PERFORM dblink_exec('lg_a', 'COMMIT');
  PERFORM * FROM dblink_get_result('lg_b') AS x(v text);
  PERFORM dblink_disconnect('lg_a');
  PERFORM dblink_disconnect('lg_b');

  SELECT status INTO st1 FROM compute_jobs WHERE id = j1;
  SELECT status INTO st2 FROM compute_jobs WHERE id = j2;
  IF st1 IS DISTINCT FROM 'done' OR st2 IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (L1-SETUP): after a committed, the two marked jobs read % and %, not done and done, so the marks did not both complete and the lock observation above was not of two real terminal marks.', COALESCE(st1, 'NULL'), COALESCE(st2, 'NULL');
  END IF;
END
$$;

-- ===== ARM L2 — failed/failed on one strategy waits on the ADVISORY lock =====
-- RED-UNDER: delete the lock statement from mark_compute_job_failed in
--            20260926120000 (its SECOND occurrence in the file; the first is
--            mark_compute_job_done's, which L1 owns). ⚠️ LAYERED: that
--            migration's failed-lock anchor is stood down in the same mutation.
-- RED-UNDER-M: {"arm":"L2","apply":[{"kind":"edit","file":"supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","find":"PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(v_strategy_id::text));","replace":"","occurrences":2,"nth":2},{"kind":"edit","file":"supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","find":"IF NOT v_failed_lock_anchored THEN","replace":"IF FALSE AND NOT v_failed_lock_anchored THEN","occurrences":1}]}
DO $$
DECLARE
  cs     TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                        current_setting('port'), current_database(), current_user);
  v_ns   OID  := (hashtext('mark_compute_job_bridge')::bigint & 4294967295)::oid;
  j1     UUID;
  t1     UUID;
  j2     UUID;
  t2     UUID;
  b_pid  INT;
  n_vis  INT;
  i      INT;
  st1    TEXT;
  st2    TEXT;
BEGIN
  SELECT job_id, claim_token INTO j1, t1 FROM bridge_lock_gate_seed WHERE arm = 'L2' AND slot = 1;
  SELECT job_id, claim_token INTO j2, t2 FROM bridge_lock_gate_seed WHERE arm = 'L2' AND slot = 2;
  IF j1 IS NULL OR j2 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (L2-SETUP): the committed seed for arm L2 is missing, so no mark below would run and every assertion would read nothing.';
  END IF;
  IF to_regprocedure('public.mark_compute_job_failed(uuid, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (L2-SETUP): public.mark_compute_job_failed(uuid, text, text, uuid) does not resolve on this lane, so the apply list did not produce the function under test.';
  END IF;

  PERFORM dblink_connect('lg_a', cs);
  PERFORM dblink_connect('lg_b', cs);

  SELECT n INTO n_vis
    FROM dblink('lg_b', format('SELECT count(*)::int FROM compute_jobs WHERE id IN (%L, %L) AND status = %L',
                               j1, j2, 'running')) AS x(n int);
  IF n_vis IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (L2-SETUP): backend b sees % of the 2 seeded running jobs, so the seed is not committed or not visible and b''s mark could not run.', COALESCE(n_vis, 0);
  END IF;

  PERFORM dblink_exec('lg_a', 'BEGIN');
  PERFORM * FROM dblink('lg_a', format('SELECT mark_compute_job_failed(%L, %L, %L, %L)::text', j1, 'blk probe failure', 'transient', t1)) AS x(v text);
  SELECT pid INTO b_pid FROM dblink('lg_b', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('lg_b', format('SELECT mark_compute_job_failed(%L, %L, %L, %L)::text', j2, 'blk probe failure', 'transient', t2));

  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted);
    PERFORM pg_sleep(0.05);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted) THEN
    RAISE EXCEPTION 'TEST FAILED (L2-SETUP): backend b never waited on anything while a held an uncommitted mark on the same strategy, so the two marks did not overlap and nothing below could be observed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted AND locktype = 'advisory') THEN
    RAISE EXCEPTION 'TEST FAILED (L2): a second mark_compute_job_failed on the same strategy is waiting, but NOT on an advisory lock. Two concurrent terminal failure marks on one strategy are not serialized before the bridge, so both bridge runs read compute_jobs at READ COMMITTED while the other is changing it, and the failure path is the one that decides whether the user sees failed or computing (161.1-D1).';
  END IF;
  PERFORM dblink_exec('lg_a', 'COMMIT');
  PERFORM * FROM dblink_get_result('lg_b') AS x(v text);
  PERFORM dblink_disconnect('lg_a');
  PERFORM dblink_disconnect('lg_b');

  SELECT status INTO st1 FROM compute_jobs WHERE id = j1;
  SELECT status INTO st2 FROM compute_jobs WHERE id = j2;
  IF st1 IS NULL OR st1 = 'running' OR st2 IS NULL OR st2 = 'running' THEN
    RAISE EXCEPTION 'TEST FAILED (L2-SETUP): after a committed, the two marked jobs read % and %, still running or gone, so the marks did not both complete and the lock observation above was not of two real terminal marks.', COALESCE(st1, 'NULL'), COALESCE(st2, 'NULL');
  END IF;
END
$$;

-- ===== ARM L3 — the lock is two-integer and in its own namespace =====
-- RED-UNDER: rewrite BOTH lock statements in 20260926120000 to the single-key
--            strategy hash sync_trades takes. b still waits on an advisory
--            lock (objsubid 1), so L1 and L2 stay green and L3 is first.
--            ⚠️ LAYERED: both lock anchors are stood down in the same mutation.
-- RED-UNDER-M: {"arm":"L3","apply":[{"kind":"edit","file":"supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","find":"PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(v_strategy_id::text));","replace":"PERFORM pg_advisory_xact_lock(hashtext(v_strategy_id::text));","occurrences":2,"nth":1},{"kind":"edit","file":"supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","find":"PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(v_strategy_id::text));","replace":"PERFORM pg_advisory_xact_lock(hashtext(v_strategy_id::text));","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","find":"IF NOT v_done_lock_anchored THEN","replace":"IF FALSE AND NOT v_done_lock_anchored THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","find":"IF NOT v_failed_lock_anchored THEN","replace":"IF FALSE AND NOT v_failed_lock_anchored THEN","occurrences":1}]}
DO $$
DECLARE
  cs     TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                        current_setting('port'), current_database(), current_user);
  v_ns   OID  := (hashtext('mark_compute_job_bridge')::bigint & 4294967295)::oid;
  j1     UUID;
  t1     UUID;
  j2     UUID;
  t2     UUID;
  b_pid  INT;
  n_vis  INT;
  i      INT;
  st1    TEXT;
  st2    TEXT;
BEGIN
  SELECT job_id, claim_token INTO j1, t1 FROM bridge_lock_gate_seed WHERE arm = 'L3' AND slot = 1;
  SELECT job_id, claim_token INTO j2, t2 FROM bridge_lock_gate_seed WHERE arm = 'L3' AND slot = 2;
  IF j1 IS NULL OR j2 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (L3-SETUP): the committed seed for arm L3 is missing, so no mark below would run and every assertion would read nothing.';
  END IF;
  IF to_regprocedure('public.mark_compute_job_done(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (L3-SETUP): public.mark_compute_job_done(uuid, uuid) does not resolve on this lane, so the apply list did not produce the function under test.';
  END IF;

  PERFORM dblink_connect('lg_a', cs);
  PERFORM dblink_connect('lg_b', cs);

  SELECT n INTO n_vis
    FROM dblink('lg_b', format('SELECT count(*)::int FROM compute_jobs WHERE id IN (%L, %L) AND status = %L',
                               j1, j2, 'running')) AS x(n int);
  IF n_vis IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (L3-SETUP): backend b sees % of the 2 seeded running jobs, so the seed is not committed or not visible and b''s mark could not run.', COALESCE(n_vis, 0);
  END IF;

  PERFORM dblink_exec('lg_a', 'BEGIN');
  PERFORM * FROM dblink('lg_a', format('SELECT mark_compute_job_done(%L, %L)::text', j1, t1)) AS x(v text);
  SELECT pid INTO b_pid FROM dblink('lg_b', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('lg_b', format('SELECT mark_compute_job_done(%L, %L)::text', j2, t2));

  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted);
    PERFORM pg_sleep(0.05);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted) THEN
    RAISE EXCEPTION 'TEST FAILED (L3-SETUP): backend b never waited on anything while a held an uncommitted mark on the same strategy, so the two marks did not overlap and nothing below could be observed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_locks
                  WHERE pid = b_pid AND NOT granted AND locktype = 'advisory'
                    AND classid = v_ns AND objsubid = 2) THEN
    RAISE EXCEPTION 'TEST FAILED (L3): the second same-strategy done mark is not waiting on a TWO-INTEGER advisory lock in the mark_compute_job_bridge namespace (classid = the namespace''s masked OID, objsubid = 2). A single-key lock on the strategy hash shares its key space with sync_trades and positions_atomic_rebuild, so every terminal mark would queue behind a long trade sync on the same strategy and block it in turn.';
  END IF;
  PERFORM dblink_exec('lg_a', 'COMMIT');
  PERFORM * FROM dblink_get_result('lg_b') AS x(v text);
  PERFORM dblink_disconnect('lg_a');
  PERFORM dblink_disconnect('lg_b');

  SELECT status INTO st1 FROM compute_jobs WHERE id = j1;
  SELECT status INTO st2 FROM compute_jobs WHERE id = j2;
  IF st1 IS NULL OR st1 = 'running' OR st2 IS NULL OR st2 = 'running' THEN
    RAISE EXCEPTION 'TEST FAILED (L3-SETUP): after a committed, the two marked jobs read % and %, still running or gone, so the marks did not both complete and the lock observation above was not of two real terminal marks.', COALESCE(st1, 'NULL'), COALESCE(st2, 'NULL');
  END IF;
END
$$;

-- ===== ARM L4 — a DIFFERENT strategy does not wait =====
-- RED-UNDER: replace the strategy key of BOTH lock statements in
--            20260926120000 with a constant, so every terminal mark takes the
--            same lock. L1, L2 and L3 still pass (an advisory wait, in the
--            namespace, two-integer); the S2 mark now blocks behind S.
--            ⚠️ LAYERED: both lock anchors are stood down in the same mutation.
-- RED-UNDER-M: {"arm":"L4","apply":[{"kind":"edit","file":"supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","find":"hashtext(v_strategy_id::text))","replace":"0)","occurrences":2,"nth":1},{"kind":"edit","file":"supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","find":"hashtext(v_strategy_id::text))","replace":"0)","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","find":"IF NOT v_done_lock_anchored THEN","replace":"IF FALSE AND NOT v_done_lock_anchored THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","find":"IF NOT v_failed_lock_anchored THEN","replace":"IF FALSE AND NOT v_failed_lock_anchored THEN","occurrences":1}]}
DO $$
DECLARE
  cs     TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                        current_setting('port'), current_database(), current_user);
  j1     UUID;
  t1     UUID;
  j2     UUID;
  t2     UUID;
  s1     UUID;
  s2     UUID;
  b_pid  INT;
  n_vis  INT;
  i      INT;
  busy   INT;
  st1    TEXT;
  st2    TEXT;
BEGIN
  SELECT job_id, claim_token, strategy_id INTO j1, t1, s1 FROM bridge_lock_gate_seed WHERE arm = 'L4' AND slot = 1;
  SELECT job_id, claim_token, strategy_id INTO j2, t2, s2 FROM bridge_lock_gate_seed WHERE arm = 'L4' AND slot = 2;
  IF j1 IS NULL OR j2 IS NULL OR s1 IS NOT DISTINCT FROM s2 THEN
    RAISE EXCEPTION 'TEST FAILED (L4-SETUP): the committed L4 seed is missing or does not name two DIFFERENT strategies, so this arm could not show that an unrelated strategy is not blocked.';
  END IF;

  PERFORM dblink_connect('lg_a', cs);
  PERFORM dblink_connect('lg_b', cs);

  SELECT n INTO n_vis
    FROM dblink('lg_b', format('SELECT count(*)::int FROM compute_jobs WHERE id IN (%L, %L) AND status = %L',
                               j1, j2, 'running')) AS x(n int);
  IF n_vis IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (L4-SETUP): backend b sees % of the 2 seeded running jobs, so the seed is not committed or not visible and b''s mark could not run.', COALESCE(n_vis, 0);
  END IF;

  PERFORM dblink_exec('lg_a', 'BEGIN');
  PERFORM * FROM dblink('lg_a', format('SELECT mark_compute_job_done(%L, %L)::text', j1, t1)) AS x(v text);
  SELECT pid INTO b_pid FROM dblink('lg_b', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('lg_b', format('SELECT mark_compute_job_done(%L, %L)::text', j2, t2));

  -- Bounded: exits as soon as b finishes, or as soon as b is seen waiting.
  FOR i IN 1..200 LOOP
    busy := dblink_is_busy('lg_b');
    EXIT WHEN busy = 0
           OR EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted);
    PERFORM pg_sleep(0.05);
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted) THEN
    RAISE EXCEPTION 'TEST FAILED (L4): a done mark on a DIFFERENT strategy is waiting while another strategy''s mark is uncommitted. The lock is keyed too coarsely, so every terminal mark in the system serializes behind every other and one slow bridge stalls the whole job queue.';
  END IF;
  IF dblink_is_busy('lg_b') <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (L4-SETUP): the mark on the second strategy neither finished nor waited on a lock within the poll bound, so this arm observed nothing.';
  END IF;

  PERFORM * FROM dblink_get_result('lg_b') AS x(v text);
  PERFORM dblink_exec('lg_a', 'COMMIT');
  PERFORM dblink_disconnect('lg_a');
  PERFORM dblink_disconnect('lg_b');

  SELECT status INTO st1 FROM compute_jobs WHERE id = j1;
  SELECT status INTO st2 FROM compute_jobs WHERE id = j2;
  IF st1 IS DISTINCT FROM 'done' OR st2 IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (L4-SETUP): after both marks, the jobs read % and %, not done and done, so the observation above was not of two real terminal marks.', COALESCE(st1, 'NULL'), COALESCE(st2, 'NULL');
  END IF;
END
$$;
