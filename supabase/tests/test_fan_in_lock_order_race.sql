-- ==========================================================================
-- Phase 164.9.3.1 FANINGRAPH — the two fan-in LOCK defects, proven with
-- genuinely SEPARATE backends: the lost release (D-07, the routed 164.5.2
-- review item WR-02) and the diamond / transitive deadlock (D-06, SC-3).
--
-- WHAT IS UNDER TEST. The fan-in section of `mark_compute_job_done`, the
-- terminal path of `mark_compute_job_failed`, and the parent-lock statement of
-- the 10-argument `_enqueue_compute_job_internal`. Each of them takes row locks
-- on `compute_jobs` rows that sit in a parent / child relationship through
-- `parent_job_ids`, and the ORDER and the SNAPSHOT of those locks decide two
-- outcomes no single session can produce.
--
-- WHY TWO (OR THREE) REAL BACKENDS. A lock wait needs separate transactions,
-- and `run.sh --gate` runs a gate as ONE psql session. A single-client
-- `Promise.all`, or anything inside one backend, cannot race (CONTEXT D-07).
-- So every racing call below runs in its OWN `dblink` backend opened back into
-- the throwaway cluster. The gate's own session only seeds, observes
-- `pg_locks` / `dblink_is_busy` (both read live on every call), and raises.
--
-- ARMS (each carries a layered twin beside it; FL4 and FL5 were added by the
-- round-1 review fix of CR-01, FL6 and FL7 by the round-2 fix of WR-01 / WR-02, FL8
-- by the round-3 fix of SFH M2):
--   FL1  the lost release. Child C waits on two parents P1 and P2. Backend a
--        marks P1 done and stays in an OPEN transaction; backend b marks P2
--        done. Today neither sees the other's uncommitted `done`, so the
--        single set-based release statement of each matches no row, both
--        commit, and C stays `done_pending_children` with both parents `done`.
--        The observable is exactly-once release: after both finish, C reads
--        `pending` and a gate-installed transition log holds EXACTLY ONE
--        `done_pending_children -> pending` row for C. Counted, so BOTH
--        "never released" (0) and "released twice" (2) fail the arm.
--   FL2  the diamond. A `running`, B a waiting child of A with id(B) < id(A).
--        Backend m marks A done and is PARKED after its own row update by a
--        gate-installed trigger waiting on an advisory lock a blocker backend
--        holds. Backend e enqueues a child with parents [B, A]. Today the
--        enqueue takes B then waits for A, and m's fan-in needs B: a cycle,
--        and one side dies with SQLSTATE 40P01.
--   FL3  the transitive cascade against an enqueue. A `running`, D a waiting
--        child of A with id(D) < id(A). Backend m marks A failed_final
--        (parked the same way); backend e enqueues a child with parents
--        [D, A]. After the fix: no 40P01 on either side, e is refused with
--        SQLSTATE 22023 (a failed parent), and D reads `failed_final` naming A
--        in the first 60 characters of `last_error` (the admin table shows
--        `error_kind: last_error.slice(0, 60)`).
--   Both FL2 and FL3 fix the ids so the CHILD sorts BEFORE the parent, the
--   ordering a pure job-id lock order gets wrong. The tie-break case (equal
--   depth) is covered by FL1, whose two parents share depth 0.
--   FL4  (review CR-01, scenario B) a DEEP cascade against an enqueue. F has the
--        waiting graph A [F], B [A], D [F, B], so D is a direct child of F yet
--        deeper than B. A cascade that locks once per level holds D while it
--        waits for B; an enqueue naming [B, D] share-locks B and waits for D:
--        SQLSTATE 40P01. The cascade must lock its whole closure in ONE pass.
--   FL5  (review CR-01, scenario A) two cascades over the same graph (F1 and F2
--        fail together; A [F1], B [A, F2], D [F1, B]). Per-level locking has
--        cascade 1 hold {A, D} and want B while cascade 2 holds B and wants D.
--   FL4 and FL5 carry DIFFERENT twins on purpose: the runner scores a twin by the
--   FIRST failing arm, so a shared mutation would redden FL4 and score FL5
--   WRONG-ARM. Both reinstate the per-level lock order (the level UPDATE takes
--   whatever rows it updates, `WHERE TRUE`); FL4's also makes the closure read
--   non-recursive, FL5's follows single-parent children only, which FL4's
--   single-parent chain survives.
--   FL6  (round 2, WR-02) a child born DURING the cascade's lock wait. F is
--        `running`, A a waiting child of F. Backend e enqueues X [A] and is parked
--        after its INSERT holding A FOR SHARE; backend m marks F permanent and is
--        observed blocked by e. e commits X, m takes A and must find X: after the
--        cascade A and X read `failed_final`, X naming A. Its twin neuters ONLY the
--        re-read under the locks, so the cascade fails {A} and strands X.
--   FL7  (round 2, WR-01) the review's 40P01 on that late-born row, with the
--        graph A [F1], B [A], D [B, F2] and the late child X [A, F2]. Cascade 1
--        holds the deep row D when X appears; cascade 2, which read X after it
--        committed, holds X and waits for D. A blocker holds D so the order is
--        fixed by observation. Both cascades must complete, no 40P01. Its twin
--        reinstates the old order (lock the grown set on top of the rows held).
--   FL8  (round 3, SFH M2) the retry bound, behaviourally. The cascade's lock phase
--        is retried at most 10 times and then refused with SQLSTATE 55P03; until
--        this arm only a text anchor pinned that. A gate-installed wrapper around
--        `_fan_in_lock_rows` calls the REAL helper and then commits one new
--        waiting child of A through an autonomous dblink connection, so every
--        attempt sees the closure grow, with no timing. Exactly 10 children are
--        born, the mark raises 55P03 (not 55006), F still reads `running` with its
--        row byte-identical, and A and every late child are untouched. Its twin
--        removes the RAISE.
--
-- HOW A STALL IS MADE DETERMINISTIC. No sleep-then-assume anywhere. A
-- gate-installed AFTER UPDATE trigger bound by its WHEN clause to ONE job id
-- calls `pg_advisory_xact_lock(<key>)` while a blocker backend holds
-- `pg_advisory_lock(<key>)`: the marking backend is parked AFTER its own row
-- update (holding that row) and its place is observed in `pg_locks` before the
-- contender is started. The contender's wait is observed the same way. Only
-- then is the blocker released, so the interleaving is fixed by observation,
-- not by timing. Every poll is bounded (200 x 50 ms) and a missed wait raises
-- the SETUP identity instead of passing.
--
-- ⛔ NO BEGIN/ROLLBACK WRAPPER, by necessity: the dblink backends are separate
-- transactions and cannot see uncommitted seeds, so every seed (and the
-- stall trigger, which must be committed before the marking backend runs) is
-- COMMITTED. That is acceptable only because this file is LANE-ONLY (below)
-- and every lane leg boots a FRESH cluster, so committed rows never outlive
-- the run. Seed ids and the racing backends' results cross DO blocks through
-- session TEMP tables, because plpgsql variables do not.
--
-- ⛔ IDENTITIES ARE RAISED ONLY IN THIS SESSION'S DO BODIES. The dblink
-- sessions produce lock state and results; the gate session observes them and
-- raises. A raise inside a dblink session would score NO-IDENTITY under the
-- runner's source-location attribution (GRAMMAR rule 3c).
--
-- SETUP identities (`FLn-SETUP`, folded into their arm by the runner) check
-- only prerequisites no twin touches: the seed is visible from the racing
-- backend, the parked backend was OBSERVED waiting, and both racing calls
-- returned. ⛔ No SETUP check inspects a function body: a static check would
-- redden BEFORE the concurrency observable ran and make the RED of each twin
-- vacuous.
--
-- EVERY JOB SITS ON ITS OWN STRATEGY, so the 164.5.2 per-strategy bridge
-- advisory lock (taken after the fan-in) can never be what a backend waits on,
-- and the unique in-flight index never refuses a seed.
--
-- ⚠️ Apply order: the verified apply list for a gate that exercises the latest
-- mark and enqueue bodies (164.9.3.1 RESEARCH § Validation Architecture), with
-- fixture 36 (dblink) after the core fixtures. The 164.9.3.1 migration is
-- DELIBERATELY ABSENT: this file must be RED against today's bodies, and a
-- later plan appends the migration (and its stand-in fixture) once it exists.
-- LANE-ONLY: {"object":"dblink","fixture":"scripts/pg-lane/fixtures/36-fixture-dblink.sql","job":"sql-mutation","reason":"Every arm drives two or three dblink sessions back into the database it runs in (two marking backends, or a marking backend, an enqueueing backend and an advisory-lock blocker); that needs committed seed rows and a trust-auth superuser loopback connection, which the local Supabase stack behind sql-tests does not give without a password in a committed file, and the dblink extension is not in the schema of record. The arms execute on the pg-lane under sql-mutation."}
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","scripts/pg-lane/fixtures/36-fixture-dblink.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql","scripts/pg-lane/fixtures/40-fixture-match-decisions-bridge-outcomes.sql","supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql"]}

CREATE EXTENSION IF NOT EXISTS dblink;

-- Seed ids (one row per named job or strategy of an arm) and the racing
-- backends' observations, both read by later DO blocks of the same session.
CREATE TEMP TABLE fan_in_gate_seed (
  arm         TEXT NOT NULL,
  slot        TEXT NOT NULL,
  job_id      UUID,
  strategy_id UUID NOT NULL,
  claim_token UUID,
  PRIMARY KEY (arm, slot)
);

CREATE TEMP TABLE fan_in_gate_obs (
  arm TEXT NOT NULL,
  k   TEXT NOT NULL,
  v   TEXT,
  PRIMARY KEY (arm, k)
);

-- ----- GATE-INSTALLED OBJECTS (COMMITTED; dropped in the epilogue) ---------
-- The transition log: one row per status change of any compute_jobs row, so
-- an arm can COUNT releases instead of inferring them. Committed, so the rows
-- written by the racing backends are visible to the gate session.
CREATE SCHEMA fan_in_lock_gate;

CREATE TABLE fan_in_lock_gate.transitions (
  job_id     UUID,
  old_status TEXT,
  new_status TEXT
);

CREATE FUNCTION fan_in_lock_gate.log_transition() RETURNS trigger
  LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO fan_in_lock_gate.transitions (job_id, old_status, new_status)
  VALUES (NEW.id, OLD.status, NEW.status);
  RETURN NULL;
END $f$;

CREATE TRIGGER fan_in_lock_gate_log_transition
  AFTER UPDATE OF status ON public.compute_jobs
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fan_in_lock_gate.log_transition();

-- The stall: park the backend that ran the UPDATE on a transaction-scoped
-- advisory lock whose key is the trigger's argument. A per-arm trigger (created
-- in that arm's seed DO, so it is committed before the marking backend runs)
-- binds this function to ONE job id.
CREATE FUNCTION fan_in_lock_gate.stall() RETURNS trigger
  LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_advisory_xact_lock(TG_ARGV[0]::bigint);
  RETURN NULL;
END $f$;

-- >>> ARM FL1
-- ===== ARM FL1 — two parents finishing together release their child ONCE ====
-- SEED (COMMITTED): a manager user, three strategies, P1 and P2 running with
-- their own tokens, C waiting on both. Neutral labels only.
DO $$
DECLARE
  uid  UUID := gen_random_uuid();
  k    UUID;
  s1   UUID;
  s2   UUID;
  sc   UUID;
  p1   UUID;
  p2   UUID;
  c    UUID;
  t1   UUID := gen_random_uuid();
  t2   UUID := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fl1-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fl1', 'fl1-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fl1 mt5', 'x', TRUE) RETURNING id INTO k;

  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl1 P1') RETURNING id INTO s1;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl1 P2') RETURNING id INTO s2;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl1 C')  RETURNING id INTO sc;

  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s1, 'derive_broker_dailies', 'running', t1, 1, 3) RETURNING id INTO p1;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s2, 'derive_broker_dailies', 'running', t2, 1, 3) RETURNING id INTO p2;
  INSERT INTO compute_jobs (strategy_id, kind, status, parent_job_ids)
  VALUES (sc, 'derive_broker_dailies', 'done_pending_children', ARRAY[p1, p2]) RETURNING id INTO c;

  INSERT INTO fan_in_gate_seed VALUES ('FL1', 'P1', p1, s1, t1);
  INSERT INTO fan_in_gate_seed VALUES ('FL1', 'P2', p2, s2, t2);
  INSERT INTO fan_in_gate_seed VALUES ('FL1', 'C',  c,  sc, NULL);
END
$$;

-- RACE: a marks P1 in an OPEN transaction, b marks P2, a commits. Every result
-- is captured, never asserted here; the assertions are in the next DO block.
DO $$
DECLARE
  cs       TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                          current_setting('port'), current_database(), current_user);
  p1       UUID;
  t1       UUID;
  p2       UUID;
  t2       UUID;
  c        UUID;
  b_pid    INT;
  n_vis    INT;
  i        INT;
  busy     INT;
  b_waited BOOLEAN;
  a_state  TEXT;
  a_msg    TEXT;
  b_state  TEXT;
  b_msg    TEXT;
BEGIN
  SELECT job_id, claim_token INTO p1, t1 FROM fan_in_gate_seed WHERE arm = 'FL1' AND slot = 'P1';
  SELECT job_id, claim_token INTO p2, t2 FROM fan_in_gate_seed WHERE arm = 'FL1' AND slot = 'P2';
  SELECT job_id INTO c FROM fan_in_gate_seed WHERE arm = 'FL1' AND slot = 'C';
  IF p1 IS NULL OR p2 IS NULL OR c IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL1-SETUP): the committed seed for arm FL1 is missing, so no mark below would run and every assertion would read nothing.';
  END IF;
  IF to_regprocedure('public.mark_compute_job_done(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL1-SETUP): public.mark_compute_job_done(uuid, uuid) does not resolve on this lane, so the apply list did not produce the function under test.';
  END IF;

  PERFORM dblink_connect('fl_a', cs);
  PERFORM dblink_connect('fl_b', cs);

  SELECT n INTO n_vis
    FROM dblink('fl_b', format('SELECT count(*)::int FROM compute_jobs WHERE id IN (%L, %L, %L) AND ((id = %L AND status = %L) OR (id <> %L AND status = %L))',
                               p1, p2, c, c, 'done_pending_children', c, 'running')) AS x(n int);
  IF n_vis IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'TEST FAILED (FL1-SETUP): backend b sees % of the 3 seeded rows (two running parents, one waiting child), so the seed is not committed or not visible and b''s mark could not run.', COALESCE(n_vis, 0);
  END IF;

  PERFORM dblink_exec('fl_a', 'BEGIN');
  -- dblink_exec refuses a SELECT (2F003); dblink() with the void cast to text.
  -- Capture-only: an error is recorded and the assertion DO decides.
  BEGIN
    PERFORM * FROM dblink('fl_a', format('SELECT mark_compute_job_done(%L, %L)::text', p1, t1)) AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    a_state := SQLSTATE;
    a_msg := SQLERRM;
  END;

  SELECT pid INTO b_pid FROM dblink('fl_b', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_b', format('SELECT mark_compute_job_done(%L, %L)::text', p2, t2));

  -- Bounded: exits as soon as b finishes, or as soon as b is seen waiting.
  FOR i IN 1..200 LOOP
    busy := dblink_is_busy('fl_b');
    EXIT WHEN busy = 0
           OR EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted);
    PERFORM pg_sleep(0.05);
  END LOOP;
  b_waited := EXISTS (SELECT 1 FROM pg_locks WHERE pid = b_pid AND NOT granted);

  PERFORM dblink_exec('fl_a', 'COMMIT');

  -- Capture b's result, then drain the connection.
  BEGIN
    PERFORM * FROM dblink_get_result('fl_b') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    b_state := SQLSTATE;
    b_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_b') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM dblink_disconnect('fl_a');
  PERFORM dblink_disconnect('fl_b');

  INSERT INTO fan_in_gate_obs VALUES ('FL1', 'a_state', a_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL1', 'a_msg', a_msg);
  INSERT INTO fan_in_gate_obs VALUES ('FL1', 'b_state', b_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL1', 'b_msg', b_msg);
  INSERT INTO fan_in_gate_obs VALUES ('FL1', 'b_waited', b_waited::text);
END
$$;

-- RED-UNDER: delete the child-lock statement from mark_compute_job_done in
--            20261024120000. The release UPDATE then runs on the statement-start
--            snapshot again, in which each parent sees the other as running, so
--            no parent releases the child: zero release transitions.
--            ⚠️ LAYERED: that migration's own `v_done_lock_anchored` anchor
--            would abort the apply, so it is stood down in the same mutation.
-- RED-UNDER-M: {"arm":"FL1","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"PERFORM public._fan_in_lock_rows(v_kids, TRUE);\n\n    UPDATE compute_jobs c\n       SET status          = 'pending',","replace":"-- mutation: the D-07 child lock is gone\n\n    UPDATE compute_jobs c\n       SET status          = 'pending',","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_done_lock_anchored THEN","replace":"IF FALSE AND NOT v_done_lock_anchored THEN","occurrences":1}]}
-- ASSERT: the child was released EXACTLY ONCE.
DO $$
DECLARE
  p1       UUID;
  p2       UUID;
  c        UUID;
  a_state  TEXT;
  a_msg    TEXT;
  b_state  TEXT;
  b_msg    TEXT;
  b_waited TEXT;
  st_p1    TEXT;
  st_p2    TEXT;
  st_c     TEXT;
  n_rel    BIGINT;
BEGIN
  SELECT job_id INTO p1 FROM fan_in_gate_seed WHERE arm = 'FL1' AND slot = 'P1';
  SELECT job_id INTO p2 FROM fan_in_gate_seed WHERE arm = 'FL1' AND slot = 'P2';
  SELECT job_id INTO c  FROM fan_in_gate_seed WHERE arm = 'FL1' AND slot = 'C';
  SELECT v INTO a_state  FROM fan_in_gate_obs WHERE arm = 'FL1' AND k = 'a_state';
  SELECT v INTO a_msg    FROM fan_in_gate_obs WHERE arm = 'FL1' AND k = 'a_msg';
  SELECT v INTO b_state  FROM fan_in_gate_obs WHERE arm = 'FL1' AND k = 'b_state';
  SELECT v INTO b_msg    FROM fan_in_gate_obs WHERE arm = 'FL1' AND k = 'b_msg';
  SELECT v INTO b_waited FROM fan_in_gate_obs WHERE arm = 'FL1' AND k = 'b_waited';

  SELECT status INTO st_p1 FROM compute_jobs WHERE id = p1;
  SELECT status INTO st_p2 FROM compute_jobs WHERE id = p2;
  IF a_state IS NOT NULL OR b_state IS NOT NULL
     OR st_p1 IS DISTINCT FROM 'done' OR st_p2 IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (FL1-SETUP): the two parent marks did not both complete (a raised % / %, b raised % / %, parents read % and %), so the release below was not observed from two real terminal marks.',
      COALESCE(a_state, 'nothing'), COALESCE(a_msg, ''), COALESCE(b_state, 'nothing'), COALESCE(b_msg, ''),
      COALESCE(st_p1, 'NULL'), COALESCE(st_p2, 'NULL');
  END IF;

  SELECT status INTO st_c FROM compute_jobs WHERE id = c;
  SELECT count(*) INTO n_rel
    FROM fan_in_lock_gate.transitions
   WHERE job_id = c AND old_status = 'done_pending_children' AND new_status = 'pending';
  IF st_c IS DISTINCT FROM 'pending' OR n_rel IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (FL1): both parents of the waiting child are done, but the child reads % and was released % time(s), not pending and exactly once (backend b waited on a lock while a was uncommitted: %). Each finishing parent decides the release in ONE statement on its own snapshot, so with two parents finishing together neither sees the other''s uncommitted done and the child is never released; releasing it twice would hand one job to two claimers (164.5.2 WR-02, 164.9.3.1 D-07).',
      COALESCE(st_c, 'NULL'), n_rel, COALESCE(b_waited, 'unknown');
  END IF;
END
$$;
-- <<< ARM FL1

-- >>> ARM FL2
-- ===== ARM FL2 — the diamond: a mark and an enqueue must not deadlock ========
-- A is `running`; B is a waiting child of A with id(B) < id(A). One advisory
-- key per arm, a literal no other file of the corpus uses.
-- SEED (COMMITTED), including the arm's stall trigger: it must be committed
-- before the marking backend runs, and it is bound by its WHEN clause to THIS
-- arm's A only.
DO $$
DECLARE
  uid  UUID := gen_random_uuid();
  k    UUID;
  sa   UUID;
  sb   UUID;
  sc   UUID;
  u1   UUID := gen_random_uuid();
  u2   UUID := gen_random_uuid();
  a    UUID;
  b    UUID;
  ta   UUID := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fl2-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fl2', 'fl2-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fl2 mt5', 'x', TRUE) RETURNING id INTO k;

  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl2 A') RETURNING id INTO sa;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl2 B') RETURNING id INTO sb;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl2 C') RETURNING id INTO sc;

  -- The smaller uuid is the CHILD: the ordering a pure job-id lock order gets wrong.
  b := LEAST(u1, u2);
  a := GREATEST(u1, u2);

  INSERT INTO compute_jobs (id, strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (a, sa, 'derive_broker_dailies', 'running', ta, 1, 3);
  INSERT INTO compute_jobs (id, strategy_id, kind, status, parent_job_ids)
  VALUES (b, sb, 'derive_broker_dailies', 'done_pending_children', ARRAY[a]);

  INSERT INTO fan_in_gate_seed VALUES ('FL2', 'A', a, sa, ta);
  INSERT INTO fan_in_gate_seed VALUES ('FL2', 'B', b, sb, NULL);
  INSERT INTO fan_in_gate_seed VALUES ('FL2', 'C', NULL, sc, NULL);

  EXECUTE format('CREATE TRIGGER fl2_stall AFTER UPDATE ON public.compute_jobs FOR EACH ROW WHEN (NEW.id = %L::uuid AND NEW.status = %L) EXECUTE FUNCTION fan_in_lock_gate.stall(%L)',
                 a, 'done', '9164931202');
END
$$;

-- RACE: k holds the advisory key; m marks A done and parks inside the stall
-- trigger holding A's row; e enqueues a child with parents [B, A] and waits;
-- k releases. Results are captured here and asserted in the next DO block.
DO $$
DECLARE
  cs      TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                         current_setting('port'), current_database(), current_user);
  c_key   CONSTANT TEXT := '9164931202';
  a       UUID;
  ta      UUID;
  b       UUID;
  sc      UUID;
  m_pid   INT;
  e_pid   INT;
  n_vis   INT;
  i       INT;
  m_state TEXT;
  m_msg   TEXT;
  e_state TEXT;
  e_msg   TEXT;
BEGIN
  SELECT job_id, claim_token INTO a, ta FROM fan_in_gate_seed WHERE arm = 'FL2' AND slot = 'A';
  SELECT job_id INTO b  FROM fan_in_gate_seed WHERE arm = 'FL2' AND slot = 'B';
  SELECT strategy_id INTO sc FROM fan_in_gate_seed WHERE arm = 'FL2' AND slot = 'C';
  IF a IS NULL OR b IS NULL OR sc IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL2-SETUP): the committed seed for arm FL2 is missing, so no call below would run and every assertion would read nothing.';
  END IF;
  IF NOT (b < a) THEN
    RAISE EXCEPTION 'TEST FAILED (FL2-SETUP): the seed does not give the child the SMALLER id (child %, parent %), so this arm would not exercise the ordering a pure job-id lock order gets wrong.', b, a;
  END IF;
  IF to_regprocedure('public.mark_compute_job_done(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL2-SETUP): public.mark_compute_job_done(uuid, uuid) does not resolve on this lane, so the apply list did not produce the function under test.';
  END IF;

  PERFORM dblink_connect('fl_k', cs);
  PERFORM dblink_connect('fl_m', cs);
  PERFORM dblink_connect('fl_e', cs);

  SELECT n INTO n_vis
    FROM dblink('fl_e', format('SELECT count(*)::int FROM compute_jobs WHERE (id = %L AND status = %L) OR (id = %L AND status = %L)',
                               a, 'running', b, 'done_pending_children')) AS x(n int);
  IF n_vis IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (FL2-SETUP): backend e sees % of the 2 seeded rows (the running parent and its waiting child), so the seed is not committed or not visible and e''s enqueue could not run.', COALESCE(n_vis, 0);
  END IF;

  -- The blocker takes the key; a session-level advisory lock outlives the call.
  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_lock(%s)::text', c_key)) AS x(v text);

  SELECT pid INTO m_pid FROM dblink('fl_m', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_m', format('SELECT mark_compute_job_done(%L, %L)::text', a, ta));
  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = m_pid AND NOT granted AND locktype = 'advisory');
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = m_pid AND NOT granted AND locktype = 'advisory') THEN
    RAISE EXCEPTION 'TEST FAILED (FL2-SETUP): backend m was never seen parked on the stall trigger''s advisory lock after marking A done, so the mark did not hold A while e started and the interleaving below was not set up.';
  END IF;

  SELECT pid INTO e_pid FROM dblink('fl_e', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_e', format('SELECT public._enqueue_compute_job_internal(p_strategy_id => %L, p_portfolio_id => NULL, p_kind => %L, p_idempotency_key => NULL, p_parent_job_ids => ARRAY[%L, %L]::uuid[], p_exchange => NULL, p_metadata => %L::jsonb, p_allocator_id => NULL, p_api_key_id => NULL, p_run_at => NULL)::text',
                                           sc, 'derive_broker_dailies', b, a, '{}'));
  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = e_pid AND NOT granted);
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = e_pid AND NOT granted) THEN
    RAISE EXCEPTION 'TEST FAILED (FL2-SETUP): backend e was never seen waiting while m held A, so the enqueue did not overlap the mark and nothing below could be observed.';
  END IF;

  -- Release the blocker: m resumes into its fan-in with e in the middle of its lock sequence.
  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_unlock(%s)::text', c_key)) AS x(v text);

  BEGIN
    PERFORM * FROM dblink_get_result('fl_m') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    m_state := SQLSTATE;
    m_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_m') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_e') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    e_state := SQLSTATE;
    e_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_e') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM dblink_disconnect('fl_k');
  PERFORM dblink_disconnect('fl_m');
  PERFORM dblink_disconnect('fl_e');

  INSERT INTO fan_in_gate_obs VALUES ('FL2', 'm_state', m_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL2', 'm_msg', m_msg);
  INSERT INTO fan_in_gate_obs VALUES ('FL2', 'e_state', e_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL2', 'e_msg', e_msg);
END
$$;

DROP TRIGGER IF EXISTS fl2_stall ON public.compute_jobs;

-- RED-UNDER: revert BOTH ORDER BY clauses of public._fan_in_lock_rows in
--            20261024120000 to a plain `ORDER BY j.id` (the FOR UPDATE and the
--            FOR SHARE branch). A job-id order cannot be deadlock-free: the mark
--            path holds the parent A and only then discovers its child B, which
--            has the SMALLER id, while the enqueue takes B first and then waits
--            for A. One backend dies with SQLSTATE 40P01 (D-06 clarification:
--            the key is (depth, id), not one global order by job id).
--            ⚠️ LAYERED: that migration's own `v_helper_order_anchored` anchor
--            would abort the apply, so it is stood down in the same mutation.
-- RED-UNDER-M: {"arm":"FL2","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"ORDER BY depth.d, j.id\n         FOR UPDATE OF j","replace":"ORDER BY j.id\n         FOR UPDATE OF j","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"ORDER BY depth.d, j.id\n         FOR SHARE OF j","replace":"ORDER BY j.id\n         FOR SHARE OF j","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_helper_order_anchored THEN","replace":"IF FALSE AND NOT v_helper_order_anchored THEN","occurrences":1}]}
-- ASSERT: neither side raised, and the new child exists waiting on [B, A].
DO $$
DECLARE
  b       UUID;
  sc      UUID;
  m_state TEXT;
  m_msg   TEXT;
  e_state TEXT;
  e_msg   TEXT;
  st_b    TEXT;
  st_c    TEXT;
BEGIN
  SELECT job_id INTO b FROM fan_in_gate_seed WHERE arm = 'FL2' AND slot = 'B';
  SELECT strategy_id INTO sc FROM fan_in_gate_seed WHERE arm = 'FL2' AND slot = 'C';
  SELECT v INTO m_state FROM fan_in_gate_obs WHERE arm = 'FL2' AND k = 'm_state';
  SELECT v INTO m_msg   FROM fan_in_gate_obs WHERE arm = 'FL2' AND k = 'm_msg';
  SELECT v INTO e_state FROM fan_in_gate_obs WHERE arm = 'FL2' AND k = 'e_state';
  SELECT v INTO e_msg   FROM fan_in_gate_obs WHERE arm = 'FL2' AND k = 'e_msg';

  IF m_state IS NOT NULL OR e_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL2): a mark_compute_job_done on A and an enqueue naming the parents [B, A] (B a waiting child of A, id(B) < id(A)) did not both complete. The mark raised % (%), the enqueue raised % (%); SQLSTATE 40P01 is the deadlock: the enqueue takes B and waits for A while the mark holds A and its fan-in needs B. The two paths take their row locks in opposite orders (164.9.3.1 D-06, SC-3).',
      COALESCE(m_state, 'nothing'), COALESCE(m_msg, ''), COALESCE(e_state, 'nothing'), COALESCE(e_msg, '');
  END IF;

  SELECT status INTO st_b FROM compute_jobs WHERE id = b;
  SELECT status INTO st_c FROM compute_jobs WHERE strategy_id = sc AND kind = 'derive_broker_dailies';
  IF st_c IS DISTINCT FROM 'done_pending_children' OR st_b IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'TEST FAILED (FL2): neither side raised, but the new child reads % (expected done_pending_children, still waiting on B) and B reads % (expected pending, released by A''s done).',
      COALESCE(st_c, 'NULL (no child was created)'), COALESCE(st_b, 'NULL');
  END IF;
END
$$;
-- <<< ARM FL2

-- >>> ARM FL3
-- ===== ARM FL3 — the transitive cascade: a failure mark against an enqueue ===
-- A is `running`; D is a waiting child of A with id(D) < id(A). The mark ends A
-- `failed_final`, which must fail D (the cascade) while an enqueue naming
-- [D, A] is in flight. SEED (COMMITTED) with the arm's stall trigger.
DO $$
DECLARE
  uid  UUID := gen_random_uuid();
  k    UUID;
  sa   UUID;
  sd   UUID;
  sc   UUID;
  u1   UUID := gen_random_uuid();
  u2   UUID := gen_random_uuid();
  a    UUID;
  d    UUID;
  ta   UUID := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fl3-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fl3', 'fl3-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fl3 mt5', 'x', TRUE) RETURNING id INTO k;

  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl3 A') RETURNING id INTO sa;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl3 D') RETURNING id INTO sd;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl3 C') RETURNING id INTO sc;

  d := LEAST(u1, u2);
  a := GREATEST(u1, u2);

  INSERT INTO compute_jobs (id, strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (a, sa, 'derive_broker_dailies', 'running', ta, 1, 3);
  INSERT INTO compute_jobs (id, strategy_id, kind, status, parent_job_ids)
  VALUES (d, sd, 'derive_broker_dailies', 'done_pending_children', ARRAY[a]);

  INSERT INTO fan_in_gate_seed VALUES ('FL3', 'A', a, sa, ta);
  INSERT INTO fan_in_gate_seed VALUES ('FL3', 'D', d, sd, NULL);
  INSERT INTO fan_in_gate_seed VALUES ('FL3', 'C', NULL, sc, NULL);

  EXECUTE format('CREATE TRIGGER fl3_stall AFTER UPDATE ON public.compute_jobs FOR EACH ROW WHEN (NEW.id = %L::uuid AND NEW.status = %L) EXECUTE FUNCTION fan_in_lock_gate.stall(%L)',
                 a, 'failed_final', '9164931203');
END
$$;

-- RACE: same choreography as FL2, with a permanent failure mark in place of
-- the done mark.
DO $$
DECLARE
  cs      TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                         current_setting('port'), current_database(), current_user);
  c_key   CONSTANT TEXT := '9164931203';
  a       UUID;
  ta      UUID;
  d       UUID;
  sc      UUID;
  m_pid   INT;
  e_pid   INT;
  n_vis   INT;
  i       INT;
  m_state TEXT;
  m_msg   TEXT;
  e_state TEXT;
  e_msg   TEXT;
BEGIN
  SELECT job_id, claim_token INTO a, ta FROM fan_in_gate_seed WHERE arm = 'FL3' AND slot = 'A';
  SELECT job_id INTO d  FROM fan_in_gate_seed WHERE arm = 'FL3' AND slot = 'D';
  SELECT strategy_id INTO sc FROM fan_in_gate_seed WHERE arm = 'FL3' AND slot = 'C';
  IF a IS NULL OR d IS NULL OR sc IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL3-SETUP): the committed seed for arm FL3 is missing, so no call below would run and every assertion would read nothing.';
  END IF;
  IF NOT (d < a) THEN
    RAISE EXCEPTION 'TEST FAILED (FL3-SETUP): the seed does not give the child the SMALLER id (child %, parent %), so this arm would not exercise the ordering a pure job-id lock order gets wrong.', d, a;
  END IF;
  IF to_regprocedure('public.mark_compute_job_failed(uuid, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL3-SETUP): public.mark_compute_job_failed(uuid, text, text, uuid) does not resolve on this lane, so the apply list did not produce the function under test.';
  END IF;

  PERFORM dblink_connect('fl_k', cs);
  PERFORM dblink_connect('fl_m', cs);
  PERFORM dblink_connect('fl_e', cs);

  SELECT n INTO n_vis
    FROM dblink('fl_e', format('SELECT count(*)::int FROM compute_jobs WHERE (id = %L AND status = %L) OR (id = %L AND status = %L)',
                               a, 'running', d, 'done_pending_children')) AS x(n int);
  IF n_vis IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (FL3-SETUP): backend e sees % of the 2 seeded rows (the running parent and its waiting child), so the seed is not committed or not visible and e''s enqueue could not run.', COALESCE(n_vis, 0);
  END IF;

  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_lock(%s)::text', c_key)) AS x(v text);

  SELECT pid INTO m_pid FROM dblink('fl_m', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_m', format('SELECT mark_compute_job_failed(%L, %L, %L, %L)::text', a, 'fl3 permanent failure', 'permanent', ta));
  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = m_pid AND NOT granted AND locktype = 'advisory');
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = m_pid AND NOT granted AND locktype = 'advisory') THEN
    RAISE EXCEPTION 'TEST FAILED (FL3-SETUP): backend m was never seen parked on the stall trigger''s advisory lock after marking A failed_final, so the mark did not hold A while e started and the interleaving below was not set up.';
  END IF;

  SELECT pid INTO e_pid FROM dblink('fl_e', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_e', format('SELECT public._enqueue_compute_job_internal(p_strategy_id => %L, p_portfolio_id => NULL, p_kind => %L, p_idempotency_key => NULL, p_parent_job_ids => ARRAY[%L, %L]::uuid[], p_exchange => NULL, p_metadata => %L::jsonb, p_allocator_id => NULL, p_api_key_id => NULL, p_run_at => NULL)::text',
                                           sc, 'derive_broker_dailies', d, a, '{}'));
  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = e_pid AND NOT granted);
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = e_pid AND NOT granted) THEN
    RAISE EXCEPTION 'TEST FAILED (FL3-SETUP): backend e was never seen waiting while m held A, so the enqueue did not overlap the mark and nothing below could be observed.';
  END IF;

  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_unlock(%s)::text', c_key)) AS x(v text);

  BEGIN
    PERFORM * FROM dblink_get_result('fl_m') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    m_state := SQLSTATE;
    m_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_m') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_e') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    e_state := SQLSTATE;
    e_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_e') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM dblink_disconnect('fl_k');
  PERFORM dblink_disconnect('fl_m');
  PERFORM dblink_disconnect('fl_e');

  INSERT INTO fan_in_gate_obs VALUES ('FL3', 'm_state', m_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL3', 'm_msg', m_msg);
  INSERT INTO fan_in_gate_obs VALUES ('FL3', 'e_state', e_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL3', 'e_msg', e_msg);
END
$$;

DROP TRIGGER IF EXISTS fl3_stall ON public.compute_jobs;

-- RED-UNDER: disable the failure cascade of mark_compute_job_failed in
--            20261024120000 by replacing its `IF v_new_status = 'failed_final'
--            THEN` guard with `IF FALSE THEN`. A failed_final A then strands
--            its waiting child D in done_pending_children forever; the enqueue
--            is still refused 22023, so the child-state check is what fires.
--            ⚠️ LAYERED: that migration's own `v_failed_cascade_anchored`
--            anchor would abort the apply, so it is stood down in the same
--            mutation.
-- RED-UNDER-M: {"arm":"FL3","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF v_new_status = 'failed_final' THEN","replace":"IF FALSE THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_failed_cascade_anchored THEN","replace":"IF FALSE AND NOT v_failed_cascade_anchored THEN","occurrences":1}]}
-- ASSERT: m completed, e was refused 22023 (a failed parent) and never saw a
-- deadlock, and D was failed by the cascade naming A.
DO $$
DECLARE
  a       UUID;
  d       UUID;
  m_state TEXT;
  m_msg   TEXT;
  e_state TEXT;
  e_msg   TEXT;
  st_d    TEXT;
  err_d   TEXT;
BEGIN
  SELECT job_id INTO a FROM fan_in_gate_seed WHERE arm = 'FL3' AND slot = 'A';
  SELECT job_id INTO d FROM fan_in_gate_seed WHERE arm = 'FL3' AND slot = 'D';
  SELECT v INTO m_state FROM fan_in_gate_obs WHERE arm = 'FL3' AND k = 'm_state';
  SELECT v INTO m_msg   FROM fan_in_gate_obs WHERE arm = 'FL3' AND k = 'm_msg';
  SELECT v INTO e_state FROM fan_in_gate_obs WHERE arm = 'FL3' AND k = 'e_state';
  SELECT v INTO e_msg   FROM fan_in_gate_obs WHERE arm = 'FL3' AND k = 'e_msg';
  SELECT status, last_error INTO st_d, err_d FROM compute_jobs WHERE id = d;

  IF m_state IS NOT NULL OR e_state = '40P01' THEN
    RAISE EXCEPTION 'TEST FAILED (FL3): a permanent failure mark on A and an enqueue naming the parents [D, A] (D a waiting child of A, id(D) < id(A)) deadlocked or the mark died. The mark raised % (%), the enqueue raised % (%). SQLSTATE 40P01 is the deadlock between the cascade''s row locks and the enqueue''s share locks (164.9.3.1 D-06, SC-3).',
      COALESCE(m_state, 'nothing'), COALESCE(m_msg, ''), COALESCE(e_state, 'nothing'), COALESCE(e_msg, '');
  END IF;
  IF e_state IS DISTINCT FROM '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (FL3): the enqueue naming a parent that ended failed_final raised % (%), expected SQLSTATE 22023 (invalid_parameter_value: a child of a failed parent could never be released).',
      COALESCE(e_state, 'nothing'), COALESCE(e_msg, '');
  END IF;
  IF st_d IS DISTINCT FROM 'failed_final'
     OR err_d IS NULL OR position(a::text IN left(err_d, 60)) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (FL3): the waiting child D of a parent that ended failed_final reads % with last_error % (expected failed_final naming A (%) in the first 60 characters the admin table shows). With no cascade the child stays done_pending_children forever, holding its strategy in "computing" (164.9.3.1 D-01..D-03).',
      COALESCE(st_d, 'NULL'), COALESCE(left(err_d, 60), 'NULL'), a;
  END IF;
END
$$;
-- <<< ARM FL3

-- >>> ARM FL4
-- ===== ARM FL4 — a DEEP cascade against an enqueue: one lock pass, not one per level ===
-- Review CR-01 scenario B. F is `running`. The waiting graph below it is
--     A [F]   (depth 1)
--     B [A]   (depth 2)
--     D [F, B] (depth 3)
-- so D is a DIRECT child of F yet sits DEEPER than B, which is two levels down.
-- A cascade that locks level by level takes {A, D} at level 1 and only then wants
-- B at level 2: it holds the depth-3 row D while it waits on the depth-2 row B.
-- An enqueue naming the parents [B, D] share-locks B first (ascending depth) and
-- then waits on D, so each holds what the other wants: SQLSTATE 40P01.
-- The cascade must therefore take its WHOLE closure {A, B, D} in ONE ascending
-- pass before it updates a single row. SEED (COMMITTED) with the arm's stall
-- trigger, bound to D reaching `failed_final`: it fires at the end of the level-1
-- UPDATE, i.e. AFTER every lock the cascade took before its first write.
DO $$
DECLARE
  uid  UUID := gen_random_uuid();
  k    UUID;
  sf   UUID;
  sa   UUID;
  sb   UUID;
  sd   UUID;
  sc   UUID;
  f    UUID;
  a    UUID;
  b    UUID;
  d    UUID;
  tf   UUID := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fl4-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fl4', 'fl4-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fl4 mt5', 'x', TRUE) RETURNING id INTO k;

  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl4 F') RETURNING id INTO sf;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl4 A') RETURNING id INTO sa;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl4 B') RETURNING id INTO sb;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl4 D') RETURNING id INTO sd;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl4 C') RETURNING id INTO sc;

  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (sf, 'derive_broker_dailies', 'running', tf, 1, 3) RETURNING id INTO f;
  INSERT INTO compute_jobs (strategy_id, kind, status, parent_job_ids)
  VALUES (sa, 'derive_broker_dailies', 'done_pending_children', ARRAY[f]) RETURNING id INTO a;
  INSERT INTO compute_jobs (strategy_id, kind, status, parent_job_ids)
  VALUES (sb, 'derive_broker_dailies', 'done_pending_children', ARRAY[a]) RETURNING id INTO b;
  INSERT INTO compute_jobs (strategy_id, kind, status, parent_job_ids)
  VALUES (sd, 'derive_broker_dailies', 'done_pending_children', ARRAY[f, b]) RETURNING id INTO d;

  INSERT INTO fan_in_gate_seed VALUES ('FL4', 'F', f, sf, tf);
  INSERT INTO fan_in_gate_seed VALUES ('FL4', 'A', a, sa, NULL);
  INSERT INTO fan_in_gate_seed VALUES ('FL4', 'B', b, sb, NULL);
  INSERT INTO fan_in_gate_seed VALUES ('FL4', 'D', d, sd, NULL);
  INSERT INTO fan_in_gate_seed VALUES ('FL4', 'C', NULL, sc, NULL);

  EXECUTE format('CREATE TRIGGER fl4_stall AFTER UPDATE ON public.compute_jobs FOR EACH ROW WHEN (NEW.id = %L::uuid AND NEW.status = %L) EXECUTE FUNCTION fan_in_lock_gate.stall(%L)',
                 d, 'failed_final', '9164931204');
END
$$;

-- RACE: k holds the advisory key; m marks F failed_final and parks inside the
-- stall trigger (after its level-1 write, holding every row it locked so far); e
-- enqueues a child with parents [B, D] and waits; k releases. Results are
-- captured here and asserted in the next DO block.
DO $$
DECLARE
  cs      TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                         current_setting('port'), current_database(), current_user);
  c_key   CONSTANT TEXT := '9164931204';
  f       UUID;
  tf      UUID;
  b       UUID;
  d       UUID;
  sc      UUID;
  m_pid   INT;
  e_pid   INT;
  n_vis   INT;
  i       INT;
  m_state TEXT;
  m_msg   TEXT;
  e_state TEXT;
  e_msg   TEXT;
BEGIN
  SELECT job_id, claim_token INTO f, tf FROM fan_in_gate_seed WHERE arm = 'FL4' AND slot = 'F';
  SELECT job_id INTO b FROM fan_in_gate_seed WHERE arm = 'FL4' AND slot = 'B';
  SELECT job_id INTO d FROM fan_in_gate_seed WHERE arm = 'FL4' AND slot = 'D';
  SELECT strategy_id INTO sc FROM fan_in_gate_seed WHERE arm = 'FL4' AND slot = 'C';
  IF f IS NULL OR b IS NULL OR d IS NULL OR sc IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL4-SETUP): the committed seed for arm FL4 is missing, so no call below would run and every assertion would read nothing.';
  END IF;
  IF to_regprocedure('public.mark_compute_job_failed(uuid, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL4-SETUP): public.mark_compute_job_failed(uuid, text, text, uuid) does not resolve on this lane, so the apply list did not produce the function under test.';
  END IF;

  PERFORM dblink_connect('fl_k', cs);
  PERFORM dblink_connect('fl_m', cs);
  PERFORM dblink_connect('fl_e', cs);

  SELECT n INTO n_vis
    FROM dblink('fl_e', format('SELECT count(*)::int FROM compute_jobs WHERE (id = %L AND status = %L) OR (id IN (%L, %L) AND status = %L)',
                               f, 'running', b, d, 'done_pending_children')) AS x(n int);
  IF n_vis IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'TEST FAILED (FL4-SETUP): backend e sees % of the 3 seeded rows (the running root and the waiting B and D), so the seed is not committed or not visible and e''s enqueue could not run.', COALESCE(n_vis, 0);
  END IF;

  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_lock(%s)::text', c_key)) AS x(v text);

  SELECT pid INTO m_pid FROM dblink('fl_m', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_m', format('SELECT mark_compute_job_failed(%L, %L, %L, %L)::text', f, 'fl4 permanent failure', 'permanent', tf));
  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = m_pid AND NOT granted AND locktype = 'advisory');
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = m_pid AND NOT granted AND locktype = 'advisory') THEN
    RAISE EXCEPTION 'TEST FAILED (FL4-SETUP): backend m was never seen parked on the stall trigger''s advisory lock after its first cascade write, so the mark did not hold its rows while e started and the interleaving below was not set up.';
  END IF;

  -- e waits on a row lock either way: on D (held by a level-by-level cascade,
  -- after e share-locked B) or on B (held by a one-pass cascade, e's first row).
  SELECT pid INTO e_pid FROM dblink('fl_e', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_e', format('SELECT public._enqueue_compute_job_internal(p_strategy_id => %L, p_portfolio_id => NULL, p_kind => %L, p_idempotency_key => NULL, p_parent_job_ids => ARRAY[%L, %L]::uuid[], p_exchange => NULL, p_metadata => %L::jsonb, p_allocator_id => NULL, p_api_key_id => NULL, p_run_at => NULL)::text',
                                           sc, 'derive_broker_dailies', b, d, '{}'));
  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = e_pid AND NOT granted);
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = e_pid AND NOT granted) THEN
    RAISE EXCEPTION 'TEST FAILED (FL4-SETUP): backend e was never seen waiting while m held its rows, so the enqueue did not overlap the cascade and nothing below could be observed.';
  END IF;

  -- Release the blocker: m resumes into whatever comes after its first write.
  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_unlock(%s)::text', c_key)) AS x(v text);

  BEGIN
    PERFORM * FROM dblink_get_result('fl_m') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    m_state := SQLSTATE;
    m_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_m') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_e') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    e_state := SQLSTATE;
    e_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_e') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM dblink_disconnect('fl_k');
  PERFORM dblink_disconnect('fl_m');
  PERFORM dblink_disconnect('fl_e');

  INSERT INTO fan_in_gate_obs VALUES ('FL4', 'm_state', m_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL4', 'm_msg', m_msg);
  INSERT INTO fan_in_gate_obs VALUES ('FL4', 'e_state', e_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL4', 'e_msg', e_msg);
END
$$;

DROP TRIGGER IF EXISTS fl4_stall ON public.compute_jobs;

-- RED-UNDER: reinstate the per-level lock order in 20261024120000: make the
--            cascade's waiting-closure read non-recursive (the recursive branch
--            joins `ON FALSE`) AND let each level's UPDATE take whatever rows
--            it updates (`WHERE c.id = ANY(v_held)` becomes `WHERE TRUE`). The
--            one lock pass then covers only the root's direct children {A, D};
--            B is reached by the level-2 UPDATE, which locks it implicitly
--            while the cascade still holds the depth-3 row D, exactly the
--            per-level lock order. The enqueue holds a share lock on B and
--            waits for D: SQLSTATE 40P01.
--            ⚠️ LAYERED: that migration's own `v_failed_closure_anchored`
--            anchor would abort the apply, so it is stood down in the same
--            mutation. (With the closure alone made non-recursive the cascade
--            would simply never fail B; no deadlock, a different defect.)
-- RED-UNDER-M: {"arm":"FL4","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"JOIN clo ON c.parent_job_ids @> ARRAY[clo.id]","replace":"JOIN clo ON FALSE","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"WHERE c.id = ANY(v_held)","replace":"WHERE TRUE","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_failed_closure_anchored THEN","replace":"IF FALSE AND NOT v_failed_closure_anchored THEN","occurrences":1}]}
-- ASSERT: neither side raised a deadlock, the enqueue was refused 22023 (its
-- parents B and D both ended failed_final), and the cascade failed A, B and D,
-- each naming its OWN failed parent.
DO $$
DECLARE
  f       UUID;
  a       UUID;
  b       UUID;
  d       UUID;
  m_state TEXT;
  m_msg   TEXT;
  e_state TEXT;
  e_msg   TEXT;
  st_a    TEXT;
  st_b    TEXT;
  st_d    TEXT;
  err_a   TEXT;
  err_b   TEXT;
  err_d   TEXT;
BEGIN
  SELECT job_id INTO f FROM fan_in_gate_seed WHERE arm = 'FL4' AND slot = 'F';
  SELECT job_id INTO a FROM fan_in_gate_seed WHERE arm = 'FL4' AND slot = 'A';
  SELECT job_id INTO b FROM fan_in_gate_seed WHERE arm = 'FL4' AND slot = 'B';
  SELECT job_id INTO d FROM fan_in_gate_seed WHERE arm = 'FL4' AND slot = 'D';
  SELECT v INTO m_state FROM fan_in_gate_obs WHERE arm = 'FL4' AND k = 'm_state';
  SELECT v INTO m_msg   FROM fan_in_gate_obs WHERE arm = 'FL4' AND k = 'm_msg';
  SELECT v INTO e_state FROM fan_in_gate_obs WHERE arm = 'FL4' AND k = 'e_state';
  SELECT v INTO e_msg   FROM fan_in_gate_obs WHERE arm = 'FL4' AND k = 'e_msg';
  SELECT status, last_error INTO st_a, err_a FROM compute_jobs WHERE id = a;
  SELECT status, last_error INTO st_b, err_b FROM compute_jobs WHERE id = b;
  SELECT status, last_error INTO st_d, err_d FROM compute_jobs WHERE id = d;

  IF m_state IS NOT NULL OR e_state = '40P01' THEN
    RAISE EXCEPTION 'TEST FAILED (FL4): a permanent failure mark on F and an enqueue naming the parents [B, D] (A [F], B [A], D [F, B]: D is a direct child of F yet deeper than B) deadlocked or the mark died. The mark raised % (%), the enqueue raised % (%). SQLSTATE 40P01: a cascade that locks level by level holds the depth-3 row D while it waits for the depth-2 row B, and the enqueue holds B while it waits for D. The cascade must lock its whole closure in ONE ascending pass (164.9.3.1 D-06, SC-3, review CR-01).',
      COALESCE(m_state, 'nothing'), COALESCE(m_msg, ''), COALESCE(e_state, 'nothing'), COALESCE(e_msg, '');
  END IF;
  IF e_state IS DISTINCT FROM '22023' THEN
    RAISE EXCEPTION 'TEST FAILED (FL4): the enqueue naming parents that ended failed_final raised % (%), expected SQLSTATE 22023 (invalid_parameter_value: a child of a failed parent could never be released).',
      COALESCE(e_state, 'nothing'), COALESCE(e_msg, '');
  END IF;
  IF st_a IS DISTINCT FROM 'failed_final' OR st_b IS DISTINCT FROM 'failed_final' OR st_d IS DISTINCT FROM 'failed_final'
     OR err_a IS NULL OR position(f::text IN left(err_a, 60)) = 0
     OR err_b IS NULL OR position(a::text IN left(err_b, 60)) = 0
     OR err_d IS NULL OR position(f::text IN left(err_d, 60)) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (FL4): after the cascade A reads % (%), B reads % (%) and D reads % (%); expected all three failed_final, A and D naming F and B naming A inside the first 60 characters (D3: each child names its OWN failed parent).',
      COALESCE(st_a, 'NULL'), COALESCE(left(err_a, 60), 'NULL'), COALESCE(st_b, 'NULL'), COALESCE(left(err_b, 60), 'NULL'), COALESCE(st_d, 'NULL'), COALESCE(left(err_d, 60), 'NULL');
  END IF;
END
$$;
-- <<< ARM FL4

-- >>> ARM FL5
-- ===== ARM FL5 — two cascades that overlap on a deeper graph ==================
-- Review CR-01 scenario A. F1 and F2 are `running`; the waiting graph is
--     A [F1]        (depth 1)
--     B [A, F2]     (depth 2)
--     D [F1, B]     (depth 3)
-- Cascade 1 (F1 fails) and cascade 2 (F2 fails) both reach B and D. A level-by-
-- level cascade 1 locks {A, D} and then wants B; a level-by-level cascade 2
-- locks B and then wants D: each holds what the other waits for, SQLSTATE 40P01.
-- With one ascending pass over the whole closure, whichever cascade takes B first
-- also takes D, and the other waits at B holding nothing.
-- SEED (COMMITTED) with two stall triggers, one per cascade, so each cascade is
-- parked AFTER its first write: A reaching `failed_final` parks cascade 1, B
-- reaching `failed_final` parks cascade 2.
DO $$
DECLARE
  uid  UUID := gen_random_uuid();
  k    UUID;
  s1   UUID;
  s2   UUID;
  sa   UUID;
  sb   UUID;
  sd   UUID;
  f1   UUID;
  f2   UUID;
  a    UUID;
  b    UUID;
  d    UUID;
  t1   UUID := gen_random_uuid();
  t2   UUID := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fl5-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fl5', 'fl5-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fl5 mt5', 'x', TRUE) RETURNING id INTO k;

  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl5 F1') RETURNING id INTO s1;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl5 F2') RETURNING id INTO s2;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl5 A')  RETURNING id INTO sa;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl5 B')  RETURNING id INTO sb;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl5 D')  RETURNING id INTO sd;

  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s1, 'derive_broker_dailies', 'running', t1, 1, 3) RETURNING id INTO f1;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s2, 'derive_broker_dailies', 'running', t2, 1, 3) RETURNING id INTO f2;
  INSERT INTO compute_jobs (strategy_id, kind, status, parent_job_ids)
  VALUES (sa, 'derive_broker_dailies', 'done_pending_children', ARRAY[f1]) RETURNING id INTO a;
  INSERT INTO compute_jobs (strategy_id, kind, status, parent_job_ids)
  VALUES (sb, 'derive_broker_dailies', 'done_pending_children', ARRAY[a, f2]) RETURNING id INTO b;
  INSERT INTO compute_jobs (strategy_id, kind, status, parent_job_ids)
  VALUES (sd, 'derive_broker_dailies', 'done_pending_children', ARRAY[f1, b]) RETURNING id INTO d;

  INSERT INTO fan_in_gate_seed VALUES ('FL5', 'F1', f1, s1, t1);
  INSERT INTO fan_in_gate_seed VALUES ('FL5', 'F2', f2, s2, t2);
  INSERT INTO fan_in_gate_seed VALUES ('FL5', 'A', a, sa, NULL);
  INSERT INTO fan_in_gate_seed VALUES ('FL5', 'B', b, sb, NULL);
  INSERT INTO fan_in_gate_seed VALUES ('FL5', 'D', d, sd, NULL);

  EXECUTE format('CREATE TRIGGER fl5_stall_a AFTER UPDATE ON public.compute_jobs FOR EACH ROW WHEN (NEW.id = %L::uuid AND NEW.status = %L) EXECUTE FUNCTION fan_in_lock_gate.stall(%L)',
                 a, 'failed_final', '9164931205');
  EXECUTE format('CREATE TRIGGER fl5_stall_b AFTER UPDATE ON public.compute_jobs FOR EACH ROW WHEN (NEW.id = %L::uuid AND NEW.status = %L) EXECUTE FUNCTION fan_in_lock_gate.stall(%L)',
                 b, 'failed_final', '9164931206');
END
$$;

-- RACE: k holds both keys; m1 marks F1 failed_final and parks at A's trigger; m2
-- marks F2 failed_final and either parks at B's trigger (a level-by-level
-- cascade took B before cascade 1) or waits for B's row lock (a one-pass cascade
-- 1 already holds it); k releases both. Results are captured here and asserted in
-- the next DO block.
DO $$
DECLARE
  cs       TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                          current_setting('port'), current_database(), current_user);
  c_key_a  CONSTANT TEXT := '9164931205';
  c_key_b  CONSTANT TEXT := '9164931206';
  f1       UUID;
  t1       UUID;
  f2       UUID;
  t2       UUID;
  m1_pid   INT;
  m2_pid   INT;
  n_vis    INT;
  i        INT;
  m1_state TEXT;
  m1_msg   TEXT;
  m2_state TEXT;
  m2_msg   TEXT;
BEGIN
  SELECT job_id, claim_token INTO f1, t1 FROM fan_in_gate_seed WHERE arm = 'FL5' AND slot = 'F1';
  SELECT job_id, claim_token INTO f2, t2 FROM fan_in_gate_seed WHERE arm = 'FL5' AND slot = 'F2';
  IF f1 IS NULL OR f2 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL5-SETUP): the committed seed for arm FL5 is missing, so no call below would run and every assertion would read nothing.';
  END IF;
  IF to_regprocedure('public.mark_compute_job_failed(uuid, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL5-SETUP): public.mark_compute_job_failed(uuid, text, text, uuid) does not resolve on this lane, so the apply list did not produce the function under test.';
  END IF;

  PERFORM dblink_connect('fl_k', cs);
  PERFORM dblink_connect('fl_m', cs);
  PERFORM dblink_connect('fl_e', cs);

  SELECT n INTO n_vis
    FROM dblink('fl_e', format('SELECT count(*)::int FROM compute_jobs WHERE id IN (%L, %L) AND status = %L',
                               f1, f2, 'running')) AS x(n int);
  IF n_vis IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (FL5-SETUP): backend e sees % of the 2 seeded running roots, so the seed is not committed or not visible and the marks could not run.', COALESCE(n_vis, 0);
  END IF;

  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_lock(%s)::text', c_key_a)) AS x(v text);
  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_lock(%s)::text', c_key_b)) AS x(v text);

  -- Cascade 1 first, parked after its first write holding what it locked so far.
  SELECT pid INTO m1_pid FROM dblink('fl_m', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_m', format('SELECT mark_compute_job_failed(%L, %L, %L, %L)::text', f1, 'fl5 permanent failure one', 'permanent', t1));
  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = m1_pid AND NOT granted AND locktype = 'advisory');
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = m1_pid AND NOT granted AND locktype = 'advisory') THEN
    RAISE EXCEPTION 'TEST FAILED (FL5-SETUP): backend m1 was never seen parked on the stall trigger''s advisory lock after cascade 1''s first write, so cascade 1 did not hold its rows while cascade 2 started and the interleaving below was not set up.';
  END IF;

  -- Cascade 2: parked on its own stall (level-by-level) or waiting on B's row lock (one pass).
  SELECT pid INTO m2_pid FROM dblink('fl_e', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_e', format('SELECT mark_compute_job_failed(%L, %L, %L, %L)::text', f2, 'fl5 permanent failure two', 'permanent', t2));
  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = m2_pid AND NOT granted);
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = m2_pid AND NOT granted) THEN
    RAISE EXCEPTION 'TEST FAILED (FL5-SETUP): backend m2 was never seen waiting while cascade 1 held its rows, so the two cascades did not overlap and nothing below could be observed.';
  END IF;

  -- Release both stalls: each cascade resumes into whatever comes after its first write.
  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_unlock(%s)::text', c_key_a)) AS x(v text);
  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_unlock(%s)::text', c_key_b)) AS x(v text);

  BEGIN
    PERFORM * FROM dblink_get_result('fl_m') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    m1_state := SQLSTATE;
    m1_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_m') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_e') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    m2_state := SQLSTATE;
    m2_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_e') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM dblink_disconnect('fl_k');
  PERFORM dblink_disconnect('fl_m');
  PERFORM dblink_disconnect('fl_e');

  INSERT INTO fan_in_gate_obs VALUES ('FL5', 'm1_state', m1_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL5', 'm1_msg', m1_msg);
  INSERT INTO fan_in_gate_obs VALUES ('FL5', 'm2_state', m2_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL5', 'm2_msg', m2_msg);
END
$$;

DROP TRIGGER IF EXISTS fl5_stall_a ON public.compute_jobs;
DROP TRIGGER IF EXISTS fl5_stall_b ON public.compute_jobs;

-- RED-UNDER: reinstate the per-level lock order in 20261024120000 for MULTI-parent
--            children only: the cascade's closure walk follows only SINGLE-parent
--            children (the recursive step joins `parent_job_ids = ARRAY[clo.id]`
--            instead of `@>`) AND each level's UPDATE takes whatever rows it
--            updates (`WHERE c.id = ANY(v_held)` becomes `WHERE TRUE`). FL4's graph
--            is a chain of single parents below its root, so its closure is
--            still complete and FL4 still passes; here B has two parents
--            [A, F2] and D has [F1, B]. Cascade 1 then locks {A, D} up front and
--            cascade 2 only {B}; each reaches the other's row from a later
--            level while holding its own, and one dies with SQLSTATE 40P01. A
--            twin that made the closure read non-recursive would redden FL4
--            first and score WRONG-ARM here.
--            ⚠️ LAYERED: that migration's own `v_failed_closure_anchored`
--            anchor would abort the apply, so it is stood down in the same
--            mutation.
-- RED-UNDER-M: {"arm":"FL5","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"JOIN clo ON c.parent_job_ids @> ARRAY[clo.id]","replace":"JOIN clo ON c.parent_job_ids = ARRAY[clo.id]","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"WHERE c.id = ANY(v_held)","replace":"WHERE TRUE","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_failed_closure_anchored THEN","replace":"IF FALSE AND NOT v_failed_closure_anchored THEN","occurrences":1}]}
-- ASSERT: neither cascade died, both roots ended failed_final, and A, B and D
-- were all failed by the cascades (whichever took the closure first).
DO $$
DECLARE
  f1       UUID;
  f2       UUID;
  a        UUID;
  b        UUID;
  d        UUID;
  m1_state TEXT;
  m1_msg   TEXT;
  m2_state TEXT;
  m2_msg   TEXT;
  st_f1    TEXT;
  st_f2    TEXT;
  st_a     TEXT;
  st_b     TEXT;
  st_d     TEXT;
  err_a    TEXT;
  err_b    TEXT;
  err_d    TEXT;
BEGIN
  SELECT job_id INTO f1 FROM fan_in_gate_seed WHERE arm = 'FL5' AND slot = 'F1';
  SELECT job_id INTO f2 FROM fan_in_gate_seed WHERE arm = 'FL5' AND slot = 'F2';
  SELECT job_id INTO a  FROM fan_in_gate_seed WHERE arm = 'FL5' AND slot = 'A';
  SELECT job_id INTO b  FROM fan_in_gate_seed WHERE arm = 'FL5' AND slot = 'B';
  SELECT job_id INTO d  FROM fan_in_gate_seed WHERE arm = 'FL5' AND slot = 'D';
  SELECT v INTO m1_state FROM fan_in_gate_obs WHERE arm = 'FL5' AND k = 'm1_state';
  SELECT v INTO m1_msg   FROM fan_in_gate_obs WHERE arm = 'FL5' AND k = 'm1_msg';
  SELECT v INTO m2_state FROM fan_in_gate_obs WHERE arm = 'FL5' AND k = 'm2_state';
  SELECT v INTO m2_msg   FROM fan_in_gate_obs WHERE arm = 'FL5' AND k = 'm2_msg';
  SELECT status INTO st_f1 FROM compute_jobs WHERE id = f1;
  SELECT status INTO st_f2 FROM compute_jobs WHERE id = f2;
  SELECT status, last_error INTO st_a, err_a FROM compute_jobs WHERE id = a;
  SELECT status, last_error INTO st_b, err_b FROM compute_jobs WHERE id = b;
  SELECT status, last_error INTO st_d, err_d FROM compute_jobs WHERE id = d;

  IF m1_state IS NOT NULL OR m2_state IS NOT NULL
     OR st_f1 IS DISTINCT FROM 'failed_final' OR st_f2 IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (FL5): two permanent failure marks on F1 and F2 (A [F1], B [A, F2], D [F1, B]) did not both complete. Cascade 1 raised % (%), cascade 2 raised % (%), the roots read % and %. SQLSTATE 40P01: a level-by-level cascade 1 holds {A, D} and wants B while cascade 2 holds B and wants D. Each cascade must lock its whole closure in ONE ascending pass (164.9.3.1 D-06, SC-3, review CR-01).',
      COALESCE(m1_state, 'nothing'), COALESCE(m1_msg, ''), COALESCE(m2_state, 'nothing'), COALESCE(m2_msg, ''),
      COALESCE(st_f1, 'NULL'), COALESCE(st_f2, 'NULL');
  END IF;
  IF st_a IS DISTINCT FROM 'failed_final' OR st_b IS DISTINCT FROM 'failed_final' OR st_d IS DISTINCT FROM 'failed_final'
     OR left(err_a, 22) IS DISTINCT FROM 'fan_in_parent_failed: '
     OR left(err_b, 22) IS DISTINCT FROM 'fan_in_parent_failed: '
     OR left(err_d, 22) IS DISTINCT FROM 'fan_in_parent_failed: ' THEN
    RAISE EXCEPTION 'TEST FAILED (FL5): both roots ended failed_final without an error, but A reads %, B reads % and D reads % (expected all three failed_final naming a failed parent: a descendant left done_pending_children is stranded for good).',
      COALESCE(st_a, 'NULL'), COALESCE(st_b, 'NULL'), COALESCE(st_d, 'NULL');
  END IF;
END
$$;
-- <<< ARM FL5

-- >>> ARM FL6
-- ===== ARM FL6 — a child born DURING the cascade's lock wait is failed too ===
-- Review round 2, WR-02. F is `running`; A is a waiting child of F (A [F]). An
-- enqueue e names A as the parent of a new child X. It share-locks A, INSERTs X
-- and is PARKED by a gate-installed AFTER INSERT trigger bound to X's strategy,
-- so it holds A and X is not yet committed. The mark m ends F `failed_final`: its
-- cascade reads the closure {A} (X is invisible), asks for A FOR UPDATE and WAITS
-- on e. e then commits X as `done_pending_children`. X names a failed_final
-- ancestor (A, once the cascade fails it), so unless the cascade finds X after
-- the wait it can never be released and its strategy reads `computing` forever:
-- the stranding D-01 exists to end, reached through a row the first read could
-- not see. After the fix: no SQLSTATE on either side, A and X read
-- `failed_final`, X naming A in the first 60 characters of `last_error`.
-- SEED (COMMITTED), including the arm's stall trigger on X's strategy.
DO $$
DECLARE
  uid  UUID := gen_random_uuid();
  k    UUID;
  sf   UUID;
  sa   UUID;
  sx   UUID;
  f    UUID;
  a    UUID;
  tf   UUID := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fl6-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fl6', 'fl6-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fl6 mt5', 'x', TRUE) RETURNING id INTO k;

  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl6 F') RETURNING id INTO sf;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl6 A') RETURNING id INTO sa;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl6 X') RETURNING id INTO sx;

  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (sf, 'derive_broker_dailies', 'running', tf, 1, 3) RETURNING id INTO f;
  INSERT INTO compute_jobs (strategy_id, kind, status, parent_job_ids)
  VALUES (sa, 'derive_broker_dailies', 'done_pending_children', ARRAY[f]) RETURNING id INTO a;

  INSERT INTO fan_in_gate_seed VALUES ('FL6', 'F', f, sf, tf);
  INSERT INTO fan_in_gate_seed VALUES ('FL6', 'A', a, sa, NULL);
  INSERT INTO fan_in_gate_seed VALUES ('FL6', 'X', NULL, sx, NULL);

  EXECUTE format('CREATE TRIGGER fl6_stall AFTER INSERT ON public.compute_jobs FOR EACH ROW WHEN (NEW.strategy_id = %L::uuid) EXECUTE FUNCTION fan_in_lock_gate.stall(%L)',
                 sx, '9164931207');
END
$$;

-- RACE: k holds the advisory key; e enqueues X [A] and parks after its INSERT
-- holding A FOR SHARE; m marks F permanent and is OBSERVED blocked by e (its
-- FOR UPDATE on A waits for e's share lock); k releases, so e commits X and m
-- resumes. Results are captured here and asserted in the next DO block.
DO $$
DECLARE
  cs      TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                         current_setting('port'), current_database(), current_user);
  c_key   CONSTANT TEXT := '9164931207';
  f       UUID;
  tf      UUID;
  a       UUID;
  sx      UUID;
  m_pid   INT;
  e_pid   INT;
  n_vis   INT;
  i       INT;
  m_state TEXT;
  m_msg   TEXT;
  e_state TEXT;
  e_msg   TEXT;
BEGIN
  SELECT job_id, claim_token INTO f, tf FROM fan_in_gate_seed WHERE arm = 'FL6' AND slot = 'F';
  SELECT job_id INTO a FROM fan_in_gate_seed WHERE arm = 'FL6' AND slot = 'A';
  SELECT strategy_id INTO sx FROM fan_in_gate_seed WHERE arm = 'FL6' AND slot = 'X';
  IF f IS NULL OR a IS NULL OR sx IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL6-SETUP): the committed seed for arm FL6 is missing, so no call below would run and every assertion would read nothing.';
  END IF;
  IF to_regprocedure('public.mark_compute_job_failed(uuid, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL6-SETUP): public.mark_compute_job_failed(uuid, text, text, uuid) does not resolve on this lane, so the apply list did not produce the function under test.';
  END IF;

  PERFORM dblink_connect('fl_k', cs);
  PERFORM dblink_connect('fl_m', cs);
  PERFORM dblink_connect('fl_e', cs);

  SELECT n INTO n_vis
    FROM dblink('fl_e', format('SELECT count(*)::int FROM compute_jobs WHERE (id = %L AND status = %L) OR (id = %L AND status = %L)',
                               f, 'running', a, 'done_pending_children')) AS x(n int);
  IF n_vis IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (FL6-SETUP): backend e sees % of the 2 seeded rows (the running root and its waiting child A), so the seed is not committed or not visible and e''s enqueue could not run.', COALESCE(n_vis, 0);
  END IF;

  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_lock(%s)::text', c_key)) AS x(v text);

  SELECT pid INTO e_pid FROM dblink('fl_e', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_e', format('SELECT public._enqueue_compute_job_internal(p_strategy_id => %L, p_portfolio_id => NULL, p_kind => %L, p_idempotency_key => NULL, p_parent_job_ids => ARRAY[%L]::uuid[], p_exchange => NULL, p_metadata => %L::jsonb, p_allocator_id => NULL, p_api_key_id => NULL, p_run_at => NULL)::text',
                                           sx, 'derive_broker_dailies', a, '{}'));
  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = e_pid AND NOT granted AND locktype = 'advisory');
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = e_pid AND NOT granted AND locktype = 'advisory') THEN
    RAISE EXCEPTION 'TEST FAILED (FL6-SETUP): backend e was never seen parked on the stall trigger''s advisory lock after inserting X, so it did not hold A while m started and the interleaving below was not set up.';
  END IF;

  SELECT pid INTO m_pid FROM dblink('fl_m', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_m', format('SELECT mark_compute_job_failed(%L, %L, %L, %L)::text', f, 'fl6 permanent failure', 'permanent', tf));
  FOR i IN 1..200 LOOP
    EXIT WHEN e_pid = ANY (pg_blocking_pids(m_pid));
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT (e_pid = ANY (pg_blocking_pids(m_pid))) THEN
    RAISE EXCEPTION 'TEST FAILED (FL6-SETUP): backend m was never seen blocked by backend e, so the cascade did not wait on e''s share lock on A before X existed and the late-born child below was not produced.';
  END IF;

  -- Release the blocker: e commits X, then m takes A and must find X.
  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_unlock(%s)::text', c_key)) AS x(v text);

  BEGIN
    PERFORM * FROM dblink_get_result('fl_m') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    m_state := SQLSTATE;
    m_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_m') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_e') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    e_state := SQLSTATE;
    e_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_e') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM dblink_disconnect('fl_k');
  PERFORM dblink_disconnect('fl_m');
  PERFORM dblink_disconnect('fl_e');

  INSERT INTO fan_in_gate_obs VALUES ('FL6', 'm_state', m_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL6', 'm_msg', m_msg);
  INSERT INTO fan_in_gate_obs VALUES ('FL6', 'e_state', e_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL6', 'e_msg', e_msg);
END
$$;

DROP TRIGGER IF EXISTS fl6_stall ON public.compute_jobs;

-- RED-UNDER: stop the cascade re-reading its closure under the locks in 20261024120000
--            (`EXIT WHEN v_kids <@ v_held;` becomes `EXIT WHEN cardinality(v_held) > 0 OR v_kids <@ v_held;`, so the
--            second read exits unchecked). The locked set is then the FIRST read, {A}; X, committed by e during the
--            lock wait, is never failed and keeps a failed_final parent. The arm reads X as done_pending_children.
--            ⚠️ LAYERED: that migration's own `v_failed_reread_anchored` anchor reads the stability test and would
--            abort the apply, so it is stood down in the same mutation.
-- RED-UNDER-M: {"arm":"FL6","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"EXIT WHEN v_kids <@ v_held;","replace":"EXIT WHEN cardinality(v_held) > 0 OR v_kids <@ v_held;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_failed_reread_anchored THEN","replace":"IF FALSE AND NOT v_failed_reread_anchored THEN","occurrences":1}]}
-- ASSERT: neither side raised, F, A and the late-born X are all failed_final, A naming F and X naming A.
DO $$
DECLARE
  f       UUID;
  a       UUID;
  sx      UUID;
  m_state TEXT;
  m_msg   TEXT;
  e_state TEXT;
  e_msg   TEXT;
  st_f    TEXT;
  st_a    TEXT;
  err_a   TEXT;
  st_x    TEXT;
  err_x   TEXT;
BEGIN
  SELECT job_id INTO f FROM fan_in_gate_seed WHERE arm = 'FL6' AND slot = 'F';
  SELECT job_id INTO a FROM fan_in_gate_seed WHERE arm = 'FL6' AND slot = 'A';
  SELECT strategy_id INTO sx FROM fan_in_gate_seed WHERE arm = 'FL6' AND slot = 'X';
  SELECT v INTO m_state FROM fan_in_gate_obs WHERE arm = 'FL6' AND k = 'm_state';
  SELECT v INTO m_msg   FROM fan_in_gate_obs WHERE arm = 'FL6' AND k = 'm_msg';
  SELECT v INTO e_state FROM fan_in_gate_obs WHERE arm = 'FL6' AND k = 'e_state';
  SELECT v INTO e_msg   FROM fan_in_gate_obs WHERE arm = 'FL6' AND k = 'e_msg';
  SELECT status INTO st_f FROM compute_jobs WHERE id = f;
  SELECT status, last_error INTO st_a, err_a FROM compute_jobs WHERE id = a;
  SELECT status, last_error INTO st_x, err_x FROM compute_jobs WHERE strategy_id = sx AND kind = 'derive_broker_dailies';

  IF m_state IS NOT NULL OR e_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL6): a permanent failure mark on F and an enqueue of a child X naming the waiting child A as its parent did not both complete. The mark raised % (%), the enqueue raised % (%).',
      COALESCE(m_state, 'nothing'), COALESCE(m_msg, ''), COALESCE(e_state, 'nothing'), COALESCE(e_msg, '');
  END IF;
  IF st_f IS DISTINCT FROM 'failed_final'
     OR st_a IS DISTINCT FROM 'failed_final'
     OR err_a IS NULL OR position(f::text IN left(err_a, 60)) = 0
     OR st_x IS DISTINCT FROM 'failed_final'
     OR err_x IS NULL OR position(a::text IN left(err_x, 60)) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (FL6): F reads %, A reads % (%) and the child X committed while the cascade waited reads % (%); expected all three failed_final, A naming F and X naming A in the first 60 characters. A child born during the cascade''s lock wait that is missed keeps a failed_final parent and can never be released, so its strategy reads computing forever (164.9.3.1 D-01, review round 2 WR-02).',
      COALESCE(st_f, 'NULL'), COALESCE(st_a, 'NULL'), COALESCE(left(err_a, 60), 'NULL'),
      COALESCE(st_x, 'NULL (no child was created)'), COALESCE(left(err_x, 60), 'NULL');
  END IF;
END
$$;
-- <<< ARM FL6

-- >>> ARM FL7
-- ===== ARM FL7 — a late-born shallow child must not deadlock a deeper cascade ====
-- Review round 2, WR-01, the review's own graph reduced to the depth difference
-- that matters. F1 and F2 are `running`; the waiting graph is
--     A [F1]        (depth 1)
--     B [A]         (depth 2)
--     D [B, F2]     (depth 3)
-- and a late child X [A, F2] (depth 2) is born while cascade 1 (F1 fails) waits
-- for the share lock an enqueue holds on A. Cascade 1 then holds the DEEP row D
-- and, in the order the review found, asks for the SHALLOW late row X. Cascade 2
-- (F2 fails) reads the closure {X, D} after X committed, takes X FIRST (depth 2)
-- and waits for D: each holds what the other wants, SQLSTATE 40P01.
-- The interleaving is fixed by observation. A blocker backend holds D FOR UPDATE,
-- so cascade 1 holds A and B and waits on D (never on X) after the enqueue
-- commits; cascade 2 then locks X and queues on D behind cascade 1. Releasing the
-- blocker hands D to cascade 1, which re-reads its closure under the locks.
-- After the fix the grown closure is detected BEFORE any write, cascade 1 releases
-- its locks (a rolled-back subtransaction) and takes the whole grown closure in
-- one ascending pass: both cascades complete, with no 40P01 on either side.
-- SEED (COMMITTED), including the arm's stall trigger on X's strategy.
DO $$
DECLARE
  uid  UUID := gen_random_uuid();
  k    UUID;
  s1   UUID;
  s2   UUID;
  sa   UUID;
  sb   UUID;
  sd   UUID;
  sx   UUID;
  f1   UUID;
  f2   UUID;
  a    UUID;
  b    UUID;
  d    UUID;
  t1   UUID := gen_random_uuid();
  t2   UUID := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fl7-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fl7', 'fl7-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fl7 mt5', 'x', TRUE) RETURNING id INTO k;

  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl7 F1') RETURNING id INTO s1;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl7 F2') RETURNING id INTO s2;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl7 A')  RETURNING id INTO sa;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl7 B')  RETURNING id INTO sb;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl7 D')  RETURNING id INTO sd;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl7 X')  RETURNING id INTO sx;

  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s1, 'derive_broker_dailies', 'running', t1, 1, 3) RETURNING id INTO f1;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s2, 'derive_broker_dailies', 'running', t2, 1, 3) RETURNING id INTO f2;
  INSERT INTO compute_jobs (strategy_id, kind, status, parent_job_ids)
  VALUES (sa, 'derive_broker_dailies', 'done_pending_children', ARRAY[f1]) RETURNING id INTO a;
  INSERT INTO compute_jobs (strategy_id, kind, status, parent_job_ids)
  VALUES (sb, 'derive_broker_dailies', 'done_pending_children', ARRAY[a]) RETURNING id INTO b;
  INSERT INTO compute_jobs (strategy_id, kind, status, parent_job_ids)
  VALUES (sd, 'derive_broker_dailies', 'done_pending_children', ARRAY[b, f2]) RETURNING id INTO d;

  INSERT INTO fan_in_gate_seed VALUES ('FL7', 'F1', f1, s1, t1);
  INSERT INTO fan_in_gate_seed VALUES ('FL7', 'F2', f2, s2, t2);
  INSERT INTO fan_in_gate_seed VALUES ('FL7', 'A', a, sa, NULL);
  INSERT INTO fan_in_gate_seed VALUES ('FL7', 'B', b, sb, NULL);
  INSERT INTO fan_in_gate_seed VALUES ('FL7', 'D', d, sd, NULL);
  INSERT INTO fan_in_gate_seed VALUES ('FL7', 'X', NULL, sx, NULL);

  EXECUTE format('CREATE TRIGGER fl7_stall AFTER INSERT ON public.compute_jobs FOR EACH ROW WHEN (NEW.strategy_id = %L::uuid) EXECUTE FUNCTION fan_in_lock_gate.stall(%L)',
                 sx, '9164931208');
END
$$;

-- RACE: k holds the advisory key and d holds D FOR UPDATE in an open transaction;
-- e enqueues X [A, F2] and parks after its INSERT holding A and F2 FOR SHARE; m1
-- marks F1 permanent and is OBSERVED blocked by e; k releases, e commits X, and
-- m1 is OBSERVED blocked by d (it holds A and B, and waits on D); m2 marks F2
-- permanent and is OBSERVED queued; d commits. Results are captured here and
-- asserted in the next DO block.
DO $$
DECLARE
  cs       TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                          current_setting('port'), current_database(), current_user);
  c_key    CONSTANT TEXT := '9164931208';
  f1       UUID;
  t1       UUID;
  f2       UUID;
  t2       UUID;
  a        UUID;
  b        UUID;
  d        UUID;
  sx       UUID;
  d_pid    INT;
  e_pid    INT;
  m1_pid   INT;
  m2_pid   INT;
  n_vis    INT;
  i        INT;
  e_state  TEXT;
  e_msg    TEXT;
  m1_state TEXT;
  m1_msg   TEXT;
  m2_state TEXT;
  m2_msg   TEXT;
BEGIN
  SELECT job_id, claim_token INTO f1, t1 FROM fan_in_gate_seed WHERE arm = 'FL7' AND slot = 'F1';
  SELECT job_id, claim_token INTO f2, t2 FROM fan_in_gate_seed WHERE arm = 'FL7' AND slot = 'F2';
  SELECT job_id INTO a FROM fan_in_gate_seed WHERE arm = 'FL7' AND slot = 'A';
  SELECT job_id INTO b FROM fan_in_gate_seed WHERE arm = 'FL7' AND slot = 'B';
  SELECT job_id INTO d FROM fan_in_gate_seed WHERE arm = 'FL7' AND slot = 'D';
  SELECT strategy_id INTO sx FROM fan_in_gate_seed WHERE arm = 'FL7' AND slot = 'X';
  IF f1 IS NULL OR f2 IS NULL OR a IS NULL OR b IS NULL OR d IS NULL OR sx IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL7-SETUP): the committed seed for arm FL7 is missing, so no call below would run and every assertion would read nothing.';
  END IF;
  IF to_regprocedure('public.mark_compute_job_failed(uuid, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL7-SETUP): public.mark_compute_job_failed(uuid, text, text, uuid) does not resolve on this lane, so the apply list did not produce the function under test.';
  END IF;

  PERFORM dblink_connect('fl_k', cs);
  PERFORM dblink_connect('fl_d', cs);
  PERFORM dblink_connect('fl_e', cs);
  PERFORM dblink_connect('fl_m1', cs);
  PERFORM dblink_connect('fl_m2', cs);

  SELECT n INTO n_vis
    FROM dblink('fl_e', format('SELECT count(*)::int FROM compute_jobs WHERE (id IN (%L, %L) AND status = %L) OR (id IN (%L, %L, %L) AND status = %L)',
                               f1, f2, 'running', a, b, d, 'done_pending_children')) AS x(n int);
  IF n_vis IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'TEST FAILED (FL7-SETUP): backend e sees % of the 5 seeded rows (two running roots and the waiting A, B and D), so the seed is not committed or not visible and the calls below could not run.', COALESCE(n_vis, 0);
  END IF;

  -- The two blockers: the advisory key that parks e, and the row lock on D.
  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_lock(%s)::text', c_key)) AS x(v text);
  SELECT pid INTO d_pid FROM dblink('fl_d', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_exec('fl_d', 'BEGIN');
  PERFORM * FROM dblink('fl_d', format('SELECT id::text FROM compute_jobs WHERE id = %L FOR UPDATE', d)) AS x(v text);

  -- e: enqueue X [A, F2]; parked after its INSERT, holding A and F2 FOR SHARE.
  SELECT pid INTO e_pid FROM dblink('fl_e', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_e', format('SELECT public._enqueue_compute_job_internal(p_strategy_id => %L, p_portfolio_id => NULL, p_kind => %L, p_idempotency_key => NULL, p_parent_job_ids => ARRAY[%L, %L]::uuid[], p_exchange => NULL, p_metadata => %L::jsonb, p_allocator_id => NULL, p_api_key_id => NULL, p_run_at => NULL)::text',
                                           sx, 'derive_broker_dailies', a, f2, '{}'));
  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = e_pid AND NOT granted AND locktype = 'advisory');
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = e_pid AND NOT granted AND locktype = 'advisory') THEN
    RAISE EXCEPTION 'TEST FAILED (FL7-SETUP): backend e was never seen parked on the stall trigger''s advisory lock after inserting X, so it did not hold A while cascade 1 started and the late-born child below was not produced.';
  END IF;

  -- m1: cascade 1, blocked by e's share lock on A before X exists.
  SELECT pid INTO m1_pid FROM dblink('fl_m1', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_m1', format('SELECT mark_compute_job_failed(%L, %L, %L, %L)::text', f1, 'fl7 permanent failure one', 'permanent', t1));
  FOR i IN 1..200 LOOP
    EXIT WHEN e_pid = ANY (pg_blocking_pids(m1_pid));
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT (e_pid = ANY (pg_blocking_pids(m1_pid))) THEN
    RAISE EXCEPTION 'TEST FAILED (FL7-SETUP): cascade 1 was never seen blocked by backend e, so it did not wait for A before X existed.';
  END IF;

  -- Release e: it commits X. Cascade 1 takes A and B and then waits on D (held by d).
  PERFORM * FROM dblink('fl_k', format('SELECT pg_advisory_unlock(%s)::text', c_key)) AS x(v text);
  BEGIN
    PERFORM * FROM dblink_get_result('fl_e') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    e_state := SQLSTATE;
    e_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_e') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  FOR i IN 1..200 LOOP
    EXIT WHEN d_pid = ANY (pg_blocking_pids(m1_pid));
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT (d_pid = ANY (pg_blocking_pids(m1_pid))) THEN
    RAISE EXCEPTION 'TEST FAILED (FL7-SETUP): cascade 1 was never seen blocked by the row lock on D after X was committed, so it did not hold A and B while waiting on the deepest row.';
  END IF;

  -- m2: cascade 2 reads {X, D} (X is committed now), locks X and queues on D.
  SELECT pid INTO m2_pid FROM dblink('fl_m2', 'SELECT pg_backend_pid()') AS x(pid int);
  PERFORM dblink_send_query('fl_m2', format('SELECT mark_compute_job_failed(%L, %L, %L, %L)::text', f2, 'fl7 permanent failure two', 'permanent', t2));
  FOR i IN 1..200 LOOP
    EXIT WHEN EXISTS (SELECT 1 FROM pg_locks WHERE pid = m2_pid AND NOT granted);
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid = m2_pid AND NOT granted) THEN
    RAISE EXCEPTION 'TEST FAILED (FL7-SETUP): cascade 2 was never seen waiting while cascade 1 waited on D, so the two cascades did not overlap and nothing below could be observed.';
  END IF;

  -- Release D: cascade 1 takes it and re-reads its closure under the locks.
  PERFORM dblink_exec('fl_d', 'COMMIT');

  BEGIN
    PERFORM * FROM dblink_get_result('fl_m1') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    m1_state := SQLSTATE;
    m1_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_m1') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_m2') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    m2_state := SQLSTATE;
    m2_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_m2') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM dblink_disconnect('fl_k');
  PERFORM dblink_disconnect('fl_d');
  PERFORM dblink_disconnect('fl_e');
  PERFORM dblink_disconnect('fl_m1');
  PERFORM dblink_disconnect('fl_m2');

  INSERT INTO fan_in_gate_obs VALUES ('FL7', 'e_state', e_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL7', 'e_msg', e_msg);
  INSERT INTO fan_in_gate_obs VALUES ('FL7', 'm1_state', m1_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL7', 'm1_msg', m1_msg);
  INSERT INTO fan_in_gate_obs VALUES ('FL7', 'm2_state', m2_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL7', 'm2_msg', m2_msg);
END
$$;

DROP TRIGGER IF EXISTS fl7_stall ON public.compute_jobs;

-- RED-UNDER: reinstate the old second-pass order in 20261024120000: when the closure read under the locks has GROWN
--            (`IF cardinality(v_held) > 0 THEN` becomes `IF FALSE THEN`), the cascade no longer releases its locks and
--            retries, it locks the grown set ON TOP of the rows it already holds. Cascade 1 then holds D and waits for
--            the shallower late row X while cascade 2 holds X and waits for D: SQLSTATE 40P01 on one side.
--            ⚠️ LAYERED: that migration's own `v_failed_reread_anchored` anchor reads the retry guard and would
--            abort the apply, so it is stood down in the same mutation.
-- RED-UNDER-M: {"arm":"FL7","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF cardinality(v_held) > 0 THEN","replace":"IF FALSE THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_failed_reread_anchored THEN","replace":"IF FALSE AND NOT v_failed_reread_anchored THEN","occurrences":1}]}
-- ASSERT: no side raised (40P01 is the deadlock), both roots are failed_final, and A, B, D and the late-born X
-- were all failed by the cascades (whichever took each row), each naming a failed parent.
DO $$
DECLARE
  f1       UUID;
  f2       UUID;
  a        UUID;
  b        UUID;
  d        UUID;
  sx       UUID;
  e_state  TEXT;
  e_msg    TEXT;
  m1_state TEXT;
  m1_msg   TEXT;
  m2_state TEXT;
  m2_msg   TEXT;
  st_f1    TEXT;
  st_f2    TEXT;
  st_a     TEXT;
  st_b     TEXT;
  st_d     TEXT;
  st_x     TEXT;
  err_a    TEXT;
  err_b    TEXT;
  err_d    TEXT;
  err_x    TEXT;
BEGIN
  SELECT job_id INTO f1 FROM fan_in_gate_seed WHERE arm = 'FL7' AND slot = 'F1';
  SELECT job_id INTO f2 FROM fan_in_gate_seed WHERE arm = 'FL7' AND slot = 'F2';
  SELECT job_id INTO a  FROM fan_in_gate_seed WHERE arm = 'FL7' AND slot = 'A';
  SELECT job_id INTO b  FROM fan_in_gate_seed WHERE arm = 'FL7' AND slot = 'B';
  SELECT job_id INTO d  FROM fan_in_gate_seed WHERE arm = 'FL7' AND slot = 'D';
  SELECT strategy_id INTO sx FROM fan_in_gate_seed WHERE arm = 'FL7' AND slot = 'X';
  SELECT v INTO e_state  FROM fan_in_gate_obs WHERE arm = 'FL7' AND k = 'e_state';
  SELECT v INTO e_msg    FROM fan_in_gate_obs WHERE arm = 'FL7' AND k = 'e_msg';
  SELECT v INTO m1_state FROM fan_in_gate_obs WHERE arm = 'FL7' AND k = 'm1_state';
  SELECT v INTO m1_msg   FROM fan_in_gate_obs WHERE arm = 'FL7' AND k = 'm1_msg';
  SELECT v INTO m2_state FROM fan_in_gate_obs WHERE arm = 'FL7' AND k = 'm2_state';
  SELECT v INTO m2_msg   FROM fan_in_gate_obs WHERE arm = 'FL7' AND k = 'm2_msg';
  SELECT status INTO st_f1 FROM compute_jobs WHERE id = f1;
  SELECT status INTO st_f2 FROM compute_jobs WHERE id = f2;
  SELECT status, last_error INTO st_a, err_a FROM compute_jobs WHERE id = a;
  SELECT status, last_error INTO st_b, err_b FROM compute_jobs WHERE id = b;
  SELECT status, last_error INTO st_d, err_d FROM compute_jobs WHERE id = d;
  SELECT status, last_error INTO st_x, err_x FROM compute_jobs WHERE strategy_id = sx AND kind = 'derive_broker_dailies';

  IF e_state IS NOT NULL OR m1_state IS NOT NULL OR m2_state IS NOT NULL
     OR st_f1 IS DISTINCT FROM 'failed_final' OR st_f2 IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (FL7): two permanent failure marks on F1 and F2 (A [F1], B [A], D [B, F2], and a child X [A, F2] committed while cascade 1 waited) did not both complete. The enqueue raised % (%), cascade 1 raised % (%), cascade 2 raised % (%), the roots read % and %. SQLSTATE 40P01: cascade 1 holds the deep row D and waits for the shallower late row X while cascade 2 holds X and waits for D. A closure that grew during the lock wait must be re-locked in ONE ascending pass, after releasing the rows already held (164.9.3.1 D-06, review round 2 WR-01).',
      COALESCE(e_state, 'nothing'), COALESCE(e_msg, ''), COALESCE(m1_state, 'nothing'), COALESCE(m1_msg, ''),
      COALESCE(m2_state, 'nothing'), COALESCE(m2_msg, ''), COALESCE(st_f1, 'NULL'), COALESCE(st_f2, 'NULL');
  END IF;
  IF st_a IS DISTINCT FROM 'failed_final' OR st_b IS DISTINCT FROM 'failed_final'
     OR st_d IS DISTINCT FROM 'failed_final' OR st_x IS DISTINCT FROM 'failed_final'
     OR left(err_a, 22) IS DISTINCT FROM 'fan_in_parent_failed: '
     OR left(err_b, 22) IS DISTINCT FROM 'fan_in_parent_failed: '
     OR left(err_d, 22) IS DISTINCT FROM 'fan_in_parent_failed: '
     OR left(err_x, 22) IS DISTINCT FROM 'fan_in_parent_failed: ' THEN
    RAISE EXCEPTION 'TEST FAILED (FL7): both roots ended failed_final without an error, but A reads %, B reads %, D reads % and the late-born X reads % (expected all four failed_final naming a failed parent: a descendant left done_pending_children is stranded for good).',
      COALESCE(st_a, 'NULL'), COALESCE(st_b, 'NULL'), COALESCE(st_d, 'NULL'), COALESCE(st_x, 'NULL (no child was created)');
  END IF;
END
$$;
-- <<< ARM FL7

-- >>> ARM FL8
-- ===== ARM FL8 — the retry bound refuses with 55P03 and leaves every row untouched ====
-- Review round 3, SFH M2. The migration bounds the cascade's lock-phase retry at
-- 10 attempts and then raises SQLSTATE 55P03, but until this arm only a TEXT anchor
-- (`v_failed_bound_anchored`) pinned the bound: nothing ever ran 11 attempts. Each
-- retry needs a descendant to have COMMITTED between the first read of the closure
-- and the re-read under the locks, and a real enqueue cannot be timed to do that
-- ten times in a row. So the growth is driven, not raced, and there is no sleep and
-- no timing anywhere in this arm.
-- THE SEAM. The gate renames the real `_fan_in_lock_rows` to `_fan_in_lock_rows_real`
-- and installs a wrapper under the old name. The wrapper calls the REAL helper
-- first, unchanged, then (for the FOR UPDATE call the cascade makes) commits ONE new
-- waiting child of A through an autonomous `dblink` connection and returns. That is
-- exactly what an enqueue that committed inside the lock wait looks like to the
-- cascade, the re-read under the locks finds a row the locked set lacks, and the
-- cascade must retry. The seam is restored at the end of the arm. The statement
-- under test, `mark_compute_job_failed`, is the migration's own body, not a copy.
-- THE GRAPH. F is `running`; A is a waiting child of F. Twelve spare strategies are
-- seeded for the late children (one each, so the in-flight unique index never
-- refuses one). Attempt k of the cascade locks the closure {A, X1 .. X(k-1)}, the
-- wrapper commits Xk, the re-read finds it and raises FI001; attempt 11 is refused
-- by the bound. So exactly 10 children are born, then SQLSTATE 55P03 (never 55006,
-- which the worker swallows as a watchdog preemption). The RAISE aborts the whole
-- RPC: F reads `running` with its row byte-identical, A and every late child read
-- `done_pending_children` and no status transition of any of them was committed.
-- SEED (COMMITTED), including the growth table and the seam.
CREATE TABLE fan_in_lock_gate.growth (
  n            INT  PRIMARY KEY,
  strategy_id  UUID NOT NULL,
  parent_job_id UUID NOT NULL
);

DO $$
DECLARE
  uid  UUID := gen_random_uuid();
  k    UUID;
  sf   UUID;
  sa   UUID;
  sg   UUID;
  f    UUID;
  a    UUID;
  tf   UUID := gen_random_uuid();
  i    INT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fl8-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fl8', 'fl8-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fl8 mt5', 'x', TRUE) RETURNING id INTO k;

  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl8 F') RETURNING id INTO sf;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl8 A') RETURNING id INTO sa;

  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (sf, 'derive_broker_dailies', 'running', tf, 1, 3) RETURNING id INTO f;
  INSERT INTO compute_jobs (strategy_id, kind, status, parent_job_ids)
  VALUES (sa, 'derive_broker_dailies', 'done_pending_children', ARRAY[f]) RETURNING id INTO a;

  FOR i IN 1..12 LOOP
    INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fl8 G' || i) RETURNING id INTO sg;
    INSERT INTO fan_in_lock_gate.growth VALUES (i, sg, a);
  END LOOP;

  INSERT INTO fan_in_gate_seed VALUES ('FL8', 'F', f, sf, tf);
  INSERT INTO fan_in_gate_seed VALUES ('FL8', 'A', a, sa, NULL);

  -- Row images before the race, to prove after it that nothing was written.
  INSERT INTO fan_in_gate_obs
  SELECT 'FL8', 'f_before', md5(to_jsonb(c)::text) FROM compute_jobs c WHERE c.id = f;
  INSERT INTO fan_in_gate_obs
  SELECT 'FL8', 'a_before', md5(to_jsonb(c)::text) FROM compute_jobs c WHERE c.id = a;
END
$$;

ALTER FUNCTION public._fan_in_lock_rows(uuid[], boolean) RENAME TO _fan_in_lock_rows_real;

CREATE FUNCTION public._fan_in_lock_rows(p_ids uuid[], p_for_update boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $f$
DECLARE
  cs TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                    current_setting('port'), current_database(), current_user);
  g  RECORD;
BEGIN
  PERFORM public._fan_in_lock_rows_real(p_ids, p_for_update);
  IF NOT p_for_update THEN
    RETURN;
  END IF;
  -- The next spare strategy that has no job yet: its late child is born now,
  -- in its OWN committed transaction (an autonomous connection), exactly as a
  -- concurrent enqueue would have committed it.
  SELECT gr.n, gr.strategy_id, gr.parent_job_id INTO g
    FROM fan_in_lock_gate.growth gr
   WHERE NOT EXISTS (SELECT 1 FROM public.compute_jobs c WHERE c.strategy_id = gr.strategy_id)
   ORDER BY gr.n
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  PERFORM dblink_connect('fl8_grow', cs);
  PERFORM dblink_exec('fl8_grow', format('INSERT INTO public.compute_jobs (strategy_id, kind, status, parent_job_ids) VALUES (%L, %L, %L, ARRAY[%L]::uuid[])',
                                         g.strategy_id, 'derive_broker_dailies', 'done_pending_children', g.parent_job_id));
  PERFORM dblink_disconnect('fl8_grow');
END
$f$;

-- RACE: ONE backend marks F permanent. No blocker, no second backend, no wait:
-- every retry is driven by the seam above. Results are captured here and asserted
-- in the next DO block.
DO $$
DECLARE
  cs      TEXT := format('host=127.0.0.1 port=%s dbname=%s user=%s',
                         current_setting('port'), current_database(), current_user);
  f       UUID;
  tf      UUID;
  a       UUID;
  n_vis   INT;
  m_state TEXT;
  m_msg   TEXT;
BEGIN
  SELECT job_id, claim_token INTO f, tf FROM fan_in_gate_seed WHERE arm = 'FL8' AND slot = 'F';
  SELECT job_id INTO a FROM fan_in_gate_seed WHERE arm = 'FL8' AND slot = 'A';
  IF f IS NULL OR a IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL8-SETUP): the committed seed for arm FL8 is missing, so no call below would run and every assertion would read nothing.';
  END IF;
  IF to_regprocedure('public.mark_compute_job_failed(uuid, text, text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL8-SETUP): public.mark_compute_job_failed(uuid, text, text, uuid) does not resolve on this lane, so the apply list did not produce the function under test.';
  END IF;
  IF to_regprocedure('public._fan_in_lock_rows_real(uuid[], boolean)') IS NULL
     OR to_regprocedure('public._fan_in_lock_rows(uuid[], boolean)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL8-SETUP): the lock-helper seam is not in place (the real helper renamed to _fan_in_lock_rows_real and the wrapper installed under the old name), so no retry could be driven.';
  END IF;

  PERFORM dblink_connect('fl_m', cs);
  SELECT n INTO n_vis
    FROM dblink('fl_m', format('SELECT count(*)::int FROM compute_jobs WHERE (id = %L AND status = %L) OR (id = %L AND status = %L)',
                               f, 'running', a, 'done_pending_children')) AS x(n int);
  IF n_vis IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'TEST FAILED (FL8-SETUP): the marking backend sees % of the 2 seeded rows (the running root and its waiting child A), so the seed is not committed or not visible and the mark could not run.', COALESCE(n_vis, 0);
  END IF;

  PERFORM dblink_send_query('fl_m', format('SELECT mark_compute_job_failed(%L, %L, %L, %L)::text', f, 'fl8 permanent failure', 'permanent', tf));
  BEGIN
    PERFORM * FROM dblink_get_result('fl_m') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    m_state := SQLSTATE;
    m_msg := SQLERRM;
  END;
  BEGIN
    PERFORM * FROM dblink_get_result('fl_m') AS x(v text);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM dblink_disconnect('fl_m');

  INSERT INTO fan_in_gate_obs VALUES ('FL8', 'm_state', m_state);
  INSERT INTO fan_in_gate_obs VALUES ('FL8', 'm_msg', m_msg);
END
$$;

-- Restore the real helper: drop the wrapper, give the real function its name back.
DO $$
BEGIN
  DROP FUNCTION public._fan_in_lock_rows(uuid[], boolean);
  ALTER FUNCTION public._fan_in_lock_rows_real(uuid[], boolean) RENAME TO _fan_in_lock_rows;
  IF to_regprocedure('public._fan_in_lock_rows(uuid[], boolean)') IS NULL
     OR to_regprocedure('public._fan_in_lock_rows_real(uuid[], boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FL8-SETUP): the lock-helper seam was not restored, so the real _fan_in_lock_rows is not back under its own name.';
  END IF;
END
$$;

-- RED-UNDER: remove the bound's RAISE in 20261024120000 (`IF v_attempt > 10 THEN` becomes `IF FALSE THEN`, so the retry
--            has no limit). The seam commits a late child on each of the 12 spare strategies and then stops, so the
--            unbounded cascade finally finds a stable closure, completes, and fails F and every descendant instead of
--            refusing. The arm reads no SQLSTATE and F `failed_final`, not 55P03 and `running`.
--            ⚠️ LAYERED: that migration's own `v_failed_bound_anchored` anchor reads the bound and would abort the
--            apply, so it is stood down in the same mutation.
-- RED-UNDER-M: {"arm":"FL8","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF v_attempt > 10 THEN","replace":"IF FALSE THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_failed_bound_anchored THEN","replace":"IF FALSE AND NOT v_failed_bound_anchored THEN","occurrences":1}]}
-- ASSERT: the mark was refused with 55P03 after exactly 10 late children, F is `running` and byte-identical, A and every late child are still waiting, and no status transition was committed.
DO $$
DECLARE
  f        UUID;
  a        UUID;
  m_state  TEXT;
  m_msg    TEXT;
  st_f     TEXT;
  n_born   INT;
  n_waiting INT;
  n_dirty  INT;
  n_trans  INT;
  f_before TEXT;
  a_before TEXT;
  f_after  TEXT;
  a_after  TEXT;
BEGIN
  SELECT job_id INTO f FROM fan_in_gate_seed WHERE arm = 'FL8' AND slot = 'F';
  SELECT job_id INTO a FROM fan_in_gate_seed WHERE arm = 'FL8' AND slot = 'A';
  SELECT v INTO m_state  FROM fan_in_gate_obs WHERE arm = 'FL8' AND k = 'm_state';
  SELECT v INTO m_msg    FROM fan_in_gate_obs WHERE arm = 'FL8' AND k = 'm_msg';
  SELECT v INTO f_before FROM fan_in_gate_obs WHERE arm = 'FL8' AND k = 'f_before';
  SELECT v INTO a_before FROM fan_in_gate_obs WHERE arm = 'FL8' AND k = 'a_before';
  SELECT status, md5(to_jsonb(c)::text) INTO st_f, f_after FROM compute_jobs c WHERE c.id = f;
  SELECT md5(to_jsonb(c)::text) INTO a_after FROM compute_jobs c WHERE c.id = a;
  -- The closure rows the cascade was locking: A and every late child born under it.
  SELECT count(*) INTO n_born FROM compute_jobs WHERE parent_job_ids = ARRAY[a];
  SELECT count(*) INTO n_waiting FROM compute_jobs
   WHERE (id = a OR parent_job_ids = ARRAY[a])
     AND status = 'done_pending_children' AND last_error IS NULL AND error_kind IS NULL
     AND updated_at = created_at;
  SELECT count(*) INTO n_dirty FROM compute_jobs
   WHERE (id = a OR parent_job_ids = ARRAY[a] OR id = f) AND status IN ('failed_final', 'failed_retry');
  SELECT count(*) INTO n_trans FROM fan_in_lock_gate.transitions
   WHERE job_id = f OR job_id = a OR job_id IN (SELECT id FROM compute_jobs WHERE parent_job_ids = ARRAY[a]);

  IF m_state IS DISTINCT FROM '55P03' THEN
    RAISE EXCEPTION 'TEST FAILED (FL8): a permanent failure mark on F whose waiting closure grew on every lock attempt (the seam had 12 late children on offer) did not refuse with SQLSTATE 55P03: it raised % (%). The retry bound is the tripwire that keeps the cascade from spinning under a stream of enqueues, and it must be 55P03 and not 55006 (the worker swallows 55006 as a watchdog preemption). F reads %.',
      COALESCE(m_state, 'nothing'), COALESCE(m_msg, ''), COALESCE(st_f, 'NULL');
  END IF;
  IF n_born IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION 'TEST FAILED (FL8): the cascade was refused after % late children were born, expected exactly 10: the bound is 10 attempts, each of which the seam answers with one new committed child, so the refusal must come on the 11th attempt.', n_born;
  END IF;
  IF st_f IS DISTINCT FROM 'running' OR f_after IS DISTINCT FROM f_before OR a_after IS DISTINCT FROM a_before THEN
    RAISE EXCEPTION 'TEST FAILED (FL8): the refused mark changed rows. F reads % (row image before %, after %) and A has image % before and % after. A refusal at the bound aborts the whole RPC: F stays running for the watchdog and no closure row is touched.',
      COALESCE(st_f, 'NULL'), COALESCE(f_before, 'NULL'), COALESCE(f_after, 'NULL'), COALESCE(a_before, 'NULL'), COALESCE(a_after, 'NULL');
  END IF;
  IF n_waiting IS DISTINCT FROM 11 OR n_dirty IS DISTINCT FROM 0 OR n_trans IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (FL8): of the 11 closure rows (A and its 10 late children) % still read done_pending_children with no error and an untouched updated_at, % row(s) of the closure or F read failed, and % status transition(s) were committed. Expected 11, 0 and 0: the refused mark must leave every closure row exactly as it found it.',
      n_waiting, n_dirty, n_trans;
  END IF;
END
$$;
-- <<< ARM FL8

-- ----- EPILOGUE ------------------------------------------------------------
-- Drop every gate-installed object; the transition-log trigger on compute_jobs
-- depends on a function in the schema, so the CASCADE takes it too. The per-arm
-- stall triggers were dropped inside their own arms.
DROP SCHEMA IF EXISTS fan_in_lock_gate CASCADE;

DO $$
BEGIN
  RAISE NOTICE 'ALL 8 ARMS EXECUTED (FL1, FL2, FL3, FL4, FL5, FL6, FL7, FL8) and passed — two parents finishing together release their waiting child exactly once (FL1), and a mark racing an enqueue of a child with the parents [B, A] neither deadlocks on the diamond (FL2) nor on the transitive failure cascade, which fails the waiting child naming its failed parent (FL3); a DEEP cascade takes its whole closure in one ascending pass, so it neither deadlocks against an enqueue naming a shallow and a deep row of that closure (FL4) nor against a second cascade over the same graph (FL5); a child committed during the cascade''s own lock wait is found by a re-read under the locks and failed too (FL6), and the closure that grew is re-locked from scratch in one ascending pass, so it neither strands nor deadlocks against a second cascade that already holds the new row (FL7); and the retry is bounded, so a closure that grows on every attempt is refused with SQLSTATE 55P03 on the 11th, after exactly 10 late children, leaving the failed job running and every closure row untouched (FL8).';
END
$$;
