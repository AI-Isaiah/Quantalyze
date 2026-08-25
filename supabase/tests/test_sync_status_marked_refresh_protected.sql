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
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION
-- on failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- ⚠️ The presence gate below RETURNs with a NOTICE when migration 20260825150000
-- has not been applied here. A skipped gate is a VACUOUSLY GREEN gate. The final
-- 'ALL 9 ARMS EXECUTED' notice is what distinguishes a real pass from a skip —
-- read it in the run output, do not infer it from the exit code.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_sync_status_marked_refresh_protected.sql

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
  j          UUID;
  tok        UUID;
  v_status   TEXT;
  v_error    TEXT;
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
  IF COALESCE(
       obj_description('sync_strategy_analytics_status(uuid)'::regprocedure, 'pg_proc'),
       ''
     ) !~ '20260825150000' THEN
    RAISE NOTICE 'SKIP: migration 20260825150000 not yet applied here (sync_strategy_analytics_status does not carry its comment). Assertions enforce once the test DB catches up.';
    RETURN;
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
         -- Arm E: marked, but NOT published. The worker-side guard would have
         -- declined here too; the bridge must agree with it.
         (s_e, 'computing', TRUE, v_before);

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
  IF v_error IS DISTINCT FROM 'mt5 gateway IPC timeout (-10005)' THEN
    RAISE EXCEPTION 'ARM A FAILED: computation_error is % — a protected refresh failure must stay VISIBLE, not silent.', COALESCE(v_error, 'NULL');
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

  RAISE NOTICE 'ALL 9 ARMS EXECUTED: sync_strategy_analytics_status protects a MARKED ledger refresh (A single-key, B composite, G no branch-(c) fall-through) and stays LOUD everywhere else (C unmarked, D foreign source, E unpublished row, F unprotected sibling, H/H2 supersession, same-kind and cross-kind).';
END $$;

ROLLBACK;
