-- ==========================================================================
-- Phase 164.5.2.1 BRIDGERESIDUE (D-06): the per-strategy advisory lock INSIDE
-- `sync_strategy_analytics_status`, proven with TWO REAL BACKENDS.
--
-- WHAT IS UNDER TEST. Migration
-- 20261003120000_sync_status_bridge_residues.sql makes the bridge take the
-- same two-integer, transaction-scoped advisory lock the two terminal mark
-- RPCs take (namespace 'mark_compute_job_bridge', second key the strategy id),
-- as its first statement after the NULL-strategy guard and before every read.
-- A mark RPC already holds that lock when it calls the bridge, so the bridge
-- re-enters it. The caller that gains serialization is the DIRECT call, the
-- Python DEFERRED shape (`services/analytics_status.py`, one PostgREST RPC,
-- holding nothing when it calls). Before this migration a direct call on
-- strategy S ran its two READ COMMITTED compute_jobs reads while an
-- uncommitted mark on S was changing them.
--
-- HOW. Plain PL/pgSQL DO blocks, RAISE EXCEPTION on failure. pgTAP is NOT
-- installed (CLAUDE.md). No psql meta-commands. Under psql -v ON_ERROR_STOP=1
-- a failed assertion exits non-zero. Each arm opens two `dblink` sessions back
-- into the same throwaway cluster: session `a` opens a transaction and runs
-- the first call on the arm's strategy WITHOUT committing; session `b` sends
-- a DIRECT bridge call on the same strategy asynchronously; the gate's own
-- session then polls `pg_locks` (read live on every call, unlike
-- pg_stat_activity, which is snapshotted per transaction) until b's first
-- UNGRANTED lock appears, and asserts WHICH lock that is. Then `a` commits,
-- b's result is consumed, both sessions disconnect. The poll is bounded
-- (200 x 50 ms) and exits on the first ungranted row.
--
-- ⛔ THE OBSERVABLE IS "WHICH LOCK", NEVER "WHETHER B WAITS" (measured,
-- RESEARCH Q4). With the bridge's lock line deleted, b STILL blocks: on a
-- `transactionid` ShareLock, waiting for a's strategy_analytics row write,
-- AFTER b's own compute_jobs reads have already run. A gate that asserted only
-- "b waited" passes with the lock removed. Every arm asserts an ungranted row
-- with `locktype = 'advisory'`; `pg_locks.classid` is an OID, so a namespace
-- check compares it with `(hashtext(ns)::bigint & 4294967295)::oid`, never
-- with the signed int4, and a two-integer key reports objsubid 2.
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
-- SETUP identities (`Bn-SETUP`, folded into their arm by the runner) check
-- only prerequisites no twin touches: the seeded rows exist and are visible
-- from backend b, b waited on something at all, and after a commits both calls
-- actually completed. ⛔ No SETUP check inspects the function body for the
-- lock: a static check would redden BEFORE the concurrency observable ran and
-- make the RED of each twin vacuous.
--
-- ARMS (each carries a layered RED-UNDER-M twin beside it: the production edit
-- to the migration plus the matching self-verify anchor stood down with
-- `IF FALSE AND …`, or the migration's own DO block would abort the apply):
--   B1  a = uncommitted mark_compute_job_done on S, b = direct bridge call on
--       S: b waits on an ADVISORY lock. Twin: delete the bridge's lock line.
--       Measured: b then waits on `transactionid`.
--
-- WHY THIS FILE EXISTS INSTEAD OF EXTENDING THE 164.5.2 GATE. Adding this
-- migration to the setup of supabase/tests/test_mark_rpc_bridge_advisory_lock.sql
-- makes that gate's L1 and L2 twins stop biting: with the bridge holding the
-- same lock, deleting one mark RPC's lock line no longer changes what the
-- second mark waits on (measured `lockgate-L1twin-p3 rc=0`, RESEARCH Q4). That
-- gate therefore keeps proving the RPC locks against the 20260906120000 bridge,
-- and this one proves the bridge's own lock.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- `RED-UNDER-M` object that scripts/mutation-runner executes on every push: it
-- mutates COPIES on a throwaway pg-lane cluster, requires the FIRST failure
-- identity to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md.
--
-- ⚠️ Apply order: the 164.5.2 lock gate's apply list, then
-- 20261001120000_compute_job_fence_errcode_55006.sql (the newest definitions of
-- both mark RPCs, which still take the lock directly before their bridge call),
-- then this phase's migration LAST, because its CREATE OR REPLACE must be the
-- bridge the arms run against.
-- LANE-ONLY: {"object":"dblink","fixture":"scripts/pg-lane/fixtures/36-fixture-dblink.sql","job":"sql-mutation","reason":"Every arm drives two dblink sessions back into the database it runs in; that needs committed seed rows and a trust-auth superuser loopback connection, which the local Supabase stack behind sql-tests does not give without a password in a committed file, and the dblink extension is not in the schema of record. The arms execute and are mutation-checked twin-by-twin on the pg-lane under sql-mutation."}
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","scripts/pg-lane/fixtures/36-fixture-dblink.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql"]}

CREATE EXTENSION IF NOT EXISTS dblink;

CREATE TEMP TABLE bridge_residue_lock_seed (
  arm         TEXT NOT NULL,
  slot        INT  NOT NULL,
  strategy_id UUID NOT NULL,
  job_id      UUID NOT NULL,
  claim_token UUID NOT NULL,
  PRIMARY KEY (arm, slot)
);

-- ----- SEED (COMMITTED) ---------------------------------------------------
-- One strategy per arm with two RUNNING jobs of different kinds
-- (compute_jobs_one_inflight_per_kind_strategy forbids two in-flight rows of
-- one kind on one strategy). Slot 1 is the job session a marks; the running
-- jobs also make every bridge call on the strategy reach its branch-(a) write,
-- so a direct call takes the strategy_analytics row. Neutral labels only.
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
          'brl-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'brl', 'brl-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'brl mt5', 'x', TRUE) RETURNING id INTO k;

  FOREACH arm IN ARRAY ARRAY['B1'] LOOP
    INSERT INTO strategies (user_id, api_key_id, name)
    VALUES (uid, k, 'brl ' || arm) RETURNING id INTO s;

    tok := gen_random_uuid();
    INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
    VALUES (s, 'derive_broker_dailies', 'running', tok, 1, 3) RETURNING id INTO j;
    INSERT INTO bridge_residue_lock_seed VALUES (arm, 1, s, j, tok);

    tok := gen_random_uuid();
    INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
    VALUES (s, 'stitch_composite', 'running', tok, 1, 3) RETURNING id INTO j;
    INSERT INTO bridge_residue_lock_seed VALUES (arm, 2, s, j, tok);
  END LOOP;
END
$$;

-- ===== ARM B1 — a direct bridge call waits on the ADVISORY lock behind a mark =
-- RED-UNDER: delete the lock statement from sync_strategy_analytics_status in
--            20261003120000. b then still blocks, but on a transactionid
--            ShareLock (a's strategy_analytics write), after its own reads.
--            ⚠️ LAYERED: that migration's lock placement anchor would abort
--            the apply, so it is stood down in the same mutation.
-- RED-UNDER-M: {"arm":"B1","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(p_strategy_id::text));","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_bridge_lock_anchored THEN","replace":"IF FALSE AND NOT v_bridge_lock_anchored THEN","occurrences":1}]}
DO $$
DECLARE
  cs     TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                        current_setting('port'), current_database(), current_user);
  s      UUID;
  j1     UUID;
  t1     UUID;
  b_pid  INT;
  n_vis  INT;
  i      INT;
  st1    TEXT;
  sa_st  TEXT;
BEGIN
  SELECT strategy_id, job_id, claim_token INTO s, j1, t1 FROM bridge_residue_lock_seed WHERE arm = 'B1' AND slot = 1;
  IF s IS NULL OR j1 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B1-SETUP): the committed seed for arm B1 is missing, so no call below would run and every assertion would read nothing.';
  END IF;
  IF to_regprocedure('public.mark_compute_job_done(uuid, uuid)') IS NULL
     OR to_regprocedure('public.sync_strategy_analytics_status(uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B1-SETUP): mark_compute_job_done(uuid, uuid) or sync_strategy_analytics_status(uuid) does not resolve on this lane, so the apply list did not produce the functions under test.';
  END IF;

  PERFORM dblink_connect('brl_a', cs);
  PERFORM dblink_connect('brl_b', cs);

  SELECT n INTO n_vis
    FROM dblink('brl_b', format('SELECT count(*)::int FROM compute_jobs WHERE strategy_id = %L AND status = %L',
                                s, 'running')) AS x(n int);
  IF n_vis IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (B1-SETUP): backend b sees % of the 2 seeded running jobs, so the seed is not committed or not visible and b''s bridge call would not reach its write.', COALESCE(n_vis, 0);
  END IF;

  PERFORM dblink_exec('brl_a', 'BEGIN');
  -- dblink_exec refuses a SELECT (2F003); dblink() with the void cast to text.
  PERFORM * FROM dblink('brl_a', format('SELECT mark_compute_job_done(%L, %L)::text', j1, t1)) AS x(v text);
  SELECT pid INTO b_pid FROM dblink('brl_b', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('brl_b', format('SELECT sync_strategy_analytics_status(%L)::text', s));

  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted);
    PERFORM pg_sleep(0.05);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted) THEN
    RAISE EXCEPTION 'TEST FAILED (B1-SETUP): backend b''s direct bridge call never waited on anything while a held an uncommitted done mark on the same strategy, so the two did not overlap and nothing below could be observed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted AND locktype = 'advisory') THEN
    RAISE EXCEPTION 'TEST FAILED (B1): a direct sync_strategy_analytics_status call on a strategy with an uncommitted done mark is waiting, but NOT on an advisory lock. The direct caller (the Python DEFERRED path) is not serialized against the mark before the bridge reads compute_jobs, so it reads the job set at READ COMMITTED while the mark is changing it and can publish a verdict computed from a half-moved set. b waits on: %.', (SELECT string_agg(DISTINCT locktype, ', ') FROM pg_locks WHERE pid = b_pid AND NOT granted);
  END IF;

  PERFORM dblink_exec('brl_a', 'COMMIT');
  PERFORM * FROM dblink_get_result('brl_b') AS x(v text);
  PERFORM dblink_disconnect('brl_a');
  PERFORM dblink_disconnect('brl_b');

  SELECT status INTO st1 FROM compute_jobs WHERE id = j1;
  SELECT computation_status INTO sa_st FROM strategy_analytics WHERE strategy_id = s;
  IF st1 IS DISTINCT FROM 'done' OR sa_st IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B1-SETUP): after a committed, the marked job reads % and the strategy_analytics status reads %, so the mark and the direct call did not both complete and the lock observation above was not of two real bridge runs.', COALESCE(st1, 'NULL'), COALESCE(sa_st, 'NULL');
  END IF;
END
$$;
