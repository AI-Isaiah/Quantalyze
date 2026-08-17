-- 144-throwaway-harness.sql — LOCAL PROOF HARNESS for the WR-02 orphaned-running
-- terminalizer (JOB-05, Phase 144)
-- =============================================================================
--
-- ⚠️ THIS IS NOT A MIGRATION AND NOT A CI GATE. It never runs against TEST or
-- PROD. It exists so that `supabase/migrations/20260817120000_retention_orphaned_
-- running_terminalize.sql` can be APPLIED and its deployed cron body EXECUTED
-- against real rows on a THROWAWAY local Postgres cluster, because the D-19
-- lesson is that a grep-only gate passes over a body whose bound does not exist
-- (20260803130000:35-37). Only executing the body against real rows falsifies it.
--
-- Adapted from .planning/phases/143-job-dropped-enqueue-reconciliation-sweep/
-- 143-throwaway-harness.sql. Same stub-cron mechanism; a DIFFERENT table set,
-- because 144's body reads and writes public.compute_jobs ONLY.
--
-- FIDELITY LIMITS — read these before trusting any result obtained here:
--   * NO row-level security. The real compute_jobs carries FORCE ROW LEVEL
--     SECURITY + a deny-all policy (20260516104201:209, 20260411144407:233-239).
--     This harness reproduces neither, so it CANNOT answer whether the pg_cron
--     job role writes compute_jobs through FORCE RLS. Nothing observed here may
--     be read as evidence about that. Phase 143 already discharged that question
--     by a REAL live tick (20260816140000:367-383, 143-CENSUS.md part B §(10)-(11));
--     144 inherits that result and does not re-litigate it. Plan 03's live TEST
--     tick re-observes it for this job.
--   * NO real pg_cron. The `cron` schema below is a STUB: cron.job is a plain
--     table and cron.schedule/cron.unschedule are plain functions that upsert and
--     delete rows in it. Nothing is ever executed on a schedule. What the stub
--     DOES give us is the thing that matters for the gates: the migration's
--     deployed command text is stored and read back exactly as pg_cron would
--     store it, so the self-verify block and the arm harness both run against the
--     DEPLOYED body rather than a retyped copy.
--   * NO triggers. In particular compute_jobs_set_updated_at_trigger
--     (20260411144407:265-268) is NOT reproduced, so `updated_at` does not move
--     here. The migration relies on that trigger for a free terminalization
--     timestamp in production; this harness cannot observe it. Nothing here
--     asserts on updated_at.
--   * NO retention crons, no claim RPC, no worker, no audit log.
--   * Table shapes are MINIMAL — only the columns the terminalizer body reads or
--     writes, plus every CHECK and index the seeds must satisfy. They are NOT
--     full replicas.
--
-- The real-schema proofs live elsewhere and are not replaced by this file:
--   * supabase/tests/test_retention_orphaned_running.sql (Plan 01 Task 2) — the
--     CI-visible SQL gate, run by the `sql-tests` job against the real TEST
--     schema with real RLS, real triggers and real constraints.
--   * Plan 03 — apply to TEST, then inspect one live tick in cron.job_run_details
--     against the ~396 real stuck arm-A rows.
--
-- CONSTRAINTS COPIED VERBATIM FROM THE REAL SCHEMA (do not "tidy" these — a
-- weakened copy silently makes a seed or an UPDATE pass here and fail in
-- production):
--   * compute_jobs status CHECK ........... 20260411144407:112-120 (6 values)
--   * compute_jobs error_kind CHECK ....... 20260411144407:127 (3 values)
--   * compute_jobs exchange CHECK ......... 20260411144407:132
--   * compute_jobs priority CHECK/default . 20260428120836:53-55
--   * compute_jobs_target_xor ............. 20260420073003:247-252 (LATEST, 4-way)
--   * compute_jobs_kind_target_coherence .. 20260717233529:167-180 (LATEST of 14)
--   * compute_jobs_claimed_by_safe ........ 20260515210000:245-253
--   * compute_jobs_metadata_size_bounded .. 20260515210000:143-148
--   * compute_jobs_one_inflight_per_kind_api_key .. 20260420073003:288-291
--       (⚠️ THE one that makes the bound proof need 101 DISTINCT api_keys: it is
--        UNIQUE on (api_key_id, kind) WHERE status IN ('pending','running',
--        'done_pending_children'), so 101 `running` rows on one key is impossible.)
--   * compute_jobs_one_inflight_per_kind_strategy .. 20260416125430:156-160
--       (the CURRENT definition. The original at 20260411144407:179 was DROPped
--        at 20260416125430:154 and must NOT be copied.)
--   * profiles / api_keys column shape .... 20260405061911:2-31
--
-- WHY THE SEEDS ARE api_key-SCOPED. Every directional seed below and in the SQL
-- gate targets an api_key (kind = derive_broker_dailies), which is exactly the
-- shape of the 396 real arm-A rows measured on TEST (144-CONTEXT.md census,
-- 2026-08-17). The 6 real arm-B rows are `poll_positions` (strategy-scoped)
-- instead, and that difference is DELIBERATELY not reproduced: arm B is
-- kind-agnostic and target-agnostic by design (144-RESEARCH.md §4 "Kind-agnostic",
-- Open Question 3), so seeding it on the same FK chain tests the same predicate
-- with one fewer stub table. If a future edit ever kind-scopes or target-scopes
-- either arm, this simplification stops being sound and the harness must grow a
-- strategies stub.
--
-- USAGE (the pg_extension fake is DELIBERATELY NOT in this file — see below):
--
--   PGBIN=/opt/homebrew/opt/postgresql@16/bin
--   SOCK="${TMPDIR:-/tmp}/144-tracer"
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d q144 -v ON_ERROR_STOP=1 -f \
--     .planning/phases/144-job-wr-02-orphaned-running/144-throwaway-harness.sql
--
--   -- (1) FAIL-LOUD PROOF: run the migration NOW, before faking pg_cron.
--   --     It MUST raise feature_not_supported and MUST NOT silently skip.
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d q144 -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/20260817120000_retention_orphaned_running_terminalize.sql   # expect: ERROR
--
--   -- (2) Fake the extension row (THROWAWAY CLUSTER ONLY — superuser catalog write).
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d q144 -v ON_ERROR_STOP=1 -c \
--     "SET allow_system_table_mods = on; INSERT INTO pg_catalog.pg_extension \
--      (oid, extname, extowner, extnamespace, extrelocatable, extversion) \
--      VALUES (99999, 'pg_cron', 10, 11, false, '1.6');"
--
--   -- (3) Now the migration applies and its STEP 2 self-verify runs.
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d q144 -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/20260817120000_retention_orphaned_running_terminalize.sql   # expect: exit 0
--
-- Why the pg_extension fake is NOT in this file: putting it here would make the
-- fail-loud gate unobservable, and an unobserved gate is exactly what the
-- standing founder rule forbids ("a test that CANNOT FAIL is worse than none").
-- Keeping it a separate step is what lets step (1) above be a real RED.
--
-- ⚠️ NEVER run this file against a Supabase project. It creates a `cron` schema
-- whose TABLE would collide with pg_cron's own catalog, and it fabricates
-- auth.users rows.
--
-- Reused by: 144-01 Task 1 (tracer: fail-loud, directional arms, the executed
-- bound proof), Task 2 (running the rewritten CI gate locally before it can be
-- run against TEST) and Task 3 (the neuter-RED matrix, which re-deploys VARIANT
-- bodies through the cron stub and never edits a repo file). Plans 02/03 may
-- reuse it for local iteration.

-- --------------------------------------------------------------------------
-- Extensions the stub schema needs
-- --------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- --------------------------------------------------------------------------
-- auth.users — the FK root of the seed chain. Column set matches what
-- supabase/tests/test_retention_orphaned_running.sql inserts (that shape is
-- already proven against the real TEST project by the shipped gate).
-- --------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID,
  email       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- public.profiles — 20260405061911:2-16, minimal. role CHECK kept verbatim
-- because the gate seeds 'allocator' and a weakened copy would hide a typo.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email        TEXT,
  role         TEXT NOT NULL DEFAULT 'manager'
                 CHECK (role IN ('manager', 'allocator', 'both')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- public.api_keys — 20260405061911:19-31, minimal. user_id references PROFILES
-- (not auth.users) in the real schema; kept, because the gate's seed order
-- depends on it.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_keys (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  exchange          TEXT NOT NULL CHECK (exchange IN ('binance', 'okx', 'bybit')),
  label             TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- public.compute_job_kinds — compute_jobs.kind FK target
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compute_job_kinds (
  name TEXT PRIMARY KEY
);

INSERT INTO public.compute_job_kinds (name) VALUES
  ('sync_trades'), ('compute_analytics'), ('compute_portfolio'), ('poll_positions'),
  ('sync_funding'), ('reconcile_strategy'), ('compute_intro_snapshot'),
  ('compute_analytics_from_csv'), ('derive_broker_dailies'), ('stitch_composite'),
  ('rescore_allocator'), ('poll_allocator_positions'), ('reconstruct_allocator_history'),
  ('refresh_allocator_equity_daily'), ('process_key_long'), ('derive_allocator_equity')
ON CONFLICT (name) DO NOTHING;

-- --------------------------------------------------------------------------
-- public.compute_jobs — the ONLY table the terminalizer body touches. Every
-- constraint a seed or the UPDATE must satisfy is reproduced VERBATIM (see the
-- citation list in this header).
--
-- ⭐ next_attempt_at is NOT NULL DEFAULT now() and DIRECTLY INSERT-WRITABLE.
-- That is load-bearing for the B3 assertion: the gate seeds it a century back so
-- "the janitor advanced it" is an observable that CAN fail. A harness that let
-- it default would make that assertion vacuous (the frozen-clock rule).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compute_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id     UUID,
  portfolio_id    UUID,
  allocator_id    UUID,
  api_key_id      UUID REFERENCES public.api_keys(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL REFERENCES public.compute_job_kinds(name),
  parent_job_ids  UUID[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                      'pending', 'running', 'done', 'done_pending_children',
                      'failed_retry', 'failed_final'
                    )),
  priority        TEXT NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low', 'normal', 'high')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at      TIMESTAMPTZ,
  claim_token     UUID,
  claimed_by      TEXT,
  last_error      TEXT,
  error_kind      TEXT CHECK (error_kind IN ('transient', 'permanent', 'unknown')),
  exchange        TEXT CHECK (exchange IS NULL OR exchange IN ('binance', 'okx', 'bybit')),
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB,

  -- 4-way XOR — verbatim from 20260420073003:247-252 (the LATEST definition).
  CONSTRAINT compute_jobs_target_xor CHECK (
    (strategy_id IS NOT NULL AND portfolio_id IS NULL     AND allocator_id IS NULL     AND api_key_id IS NULL) OR
    (strategy_id IS NULL     AND portfolio_id IS NOT NULL AND allocator_id IS NULL     AND api_key_id IS NULL) OR
    (strategy_id IS NULL     AND portfolio_id IS NULL     AND allocator_id IS NOT NULL AND api_key_id IS NULL) OR
    (strategy_id IS NULL     AND portfolio_id IS NULL     AND allocator_id IS NULL     AND api_key_id IS NOT NULL)
  ),

  -- Verbatim from 20260717233529:167-180 (the LATEST of 14 definitions). The arm
  -- every seed here rides is the api_key-scoped derive_broker_dailies arm.
  CONSTRAINT compute_jobs_kind_target_coherence CHECK (
    ((kind = 'compute_portfolio') AND (portfolio_id IS NOT NULL) AND (strategy_id IS NULL) AND (allocator_id IS NULL))
    OR ((kind = 'rescore_allocator') AND (allocator_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL))
    OR ((kind = ANY (ARRAY['sync_trades', 'compute_analytics', 'poll_positions', 'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot', 'compute_analytics_from_csv', 'derive_broker_dailies', 'stitch_composite'])) AND (strategy_id IS NOT NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
    OR ((kind = 'poll_allocator_positions') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
    OR ((kind = 'reconstruct_allocator_history') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
    OR ((kind = 'refresh_allocator_equity_daily') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
    OR ((kind = 'derive_broker_dailies') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))
    OR ((kind = 'process_key_long') AND (strategy_id IS NOT NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL) AND (api_key_id IS NULL))
    OR ((kind = 'derive_allocator_equity') AND (allocator_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (api_key_id IS NULL))
  ),

  -- Verbatim from 20260515210000:248-253. The terminalizer PRESERVES claimed_by
  -- (forensics), so this constraint is never exercised by the UPDATE — it is here
  -- so a seed that fabricates a worker id cannot use a charset production rejects.
  CONSTRAINT compute_jobs_claimed_by_safe CHECK (
    claimed_by IS NULL
    OR (length(claimed_by) <= 128
        AND claimed_by ~ '^[A-Za-z0-9_:./-]+$')
  ),

  -- Verbatim from 20260515210000:146-148. The terminalizer writes NO metadata at
  -- all (144-RESEARCH.md Pitfall 8: a violation inside a pg_cron DO block aborts
  -- the whole tick), so this too is seed-side protection only.
  CONSTRAINT compute_jobs_metadata_size_bounded CHECK (
    metadata IS NULL OR octet_length(metadata::text) <= 8192
  )
);

-- ⭐ THE INDEX THAT SHAPES THE BOUND PROOF. Verbatim from 20260420073003:288-291.
-- UNIQUE on (api_key_id, kind) while the row is in flight, so 101 `running`
-- derive_broker_dailies rows require 101 DISTINCT api_keys. Any bound proof that
-- tries to seed them on one key fails here, not in the assertion.
CREATE UNIQUE INDEX IF NOT EXISTS compute_jobs_one_inflight_per_kind_api_key
  ON public.compute_jobs (api_key_id, kind)
  WHERE api_key_id IS NOT NULL
    AND status IN ('pending', 'running', 'done_pending_children');

-- Verbatim from 20260416125430:156-160 — the CURRENT definition. No seed here is
-- strategy-scoped today; it is reproduced anyway so that a future arm that does
-- become strategy-scoped meets the same wall production would give it.
CREATE UNIQUE INDEX IF NOT EXISTS compute_jobs_one_inflight_per_kind_strategy
  ON public.compute_jobs (strategy_id, kind)
  WHERE strategy_id IS NOT NULL
    AND kind <> 'compute_intro_snapshot'
    AND status IN ('pending', 'running', 'done_pending_children');

-- The watchdog index the arm-A predicate seeks on (20260411144407:195-197).
-- NULL-claim rows ARE in it (the predicate is status-only) but with a NULL key,
-- which is why arm B cannot seek on it and why its bound rests on principle
-- rather than on scale (144-RESEARCH.md §4 "Index note").
CREATE INDEX IF NOT EXISTS compute_jobs_stuck_running
  ON public.compute_jobs (claimed_at)
  WHERE status = 'running';

-- --------------------------------------------------------------------------
-- cron — STUB. Stores the deployed command text so every gate reads the
-- DEPLOYED body rather than a retyped copy. Nothing here ever fires on a clock.
-- --------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS cron;

CREATE TABLE IF NOT EXISTS cron.job (
  jobid    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jobname  TEXT UNIQUE,
  schedule TEXT NOT NULL,
  command  TEXT NOT NULL,
  nodename TEXT NOT NULL DEFAULT 'localhost',
  nodeport INTEGER NOT NULL DEFAULT 5432,
  database TEXT NOT NULL DEFAULT current_database(),
  username TEXT NOT NULL DEFAULT current_user,
  active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- Mirrors pg_cron's upsert-by-name semantics: scheduling an existing jobname
-- REPLACES the body rather than adding a second row. The migration's self-verify
-- asserts exactly one row with this name, which is only a meaningful assertion if
-- the stub upserts the way pg_cron does. It is ALSO what lets Task 3's neuter
-- matrix deploy a VARIANT body without editing a single repo file.
CREATE OR REPLACE FUNCTION cron.schedule(p_jobname TEXT, p_schedule TEXT, p_command TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_jobid BIGINT;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command)
  VALUES (p_jobname, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE
    SET schedule = EXCLUDED.schedule,
        command  = EXCLUDED.command
  RETURNING jobid INTO v_jobid;
  RETURN v_jobid;
END
$fn$;

CREATE OR REPLACE FUNCTION cron.unschedule(p_jobname TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $fn$
BEGIN
  DELETE FROM cron.job WHERE jobname = p_jobname;
  RETURN FOUND;
END
$fn$;

DO $harness$
BEGIN
  RAISE NOTICE '144 harness: stub schema created (auth.users, profiles, api_keys, compute_job_kinds, compute_jobs with the 4-way XOR / kind-coherence / claimed_by / metadata CHECKs and both in-flight partial unique indexes, cron stub). NO RLS, NO triggers, NO real pg_cron — see this file header for the fidelity limits.';
END
$harness$;
