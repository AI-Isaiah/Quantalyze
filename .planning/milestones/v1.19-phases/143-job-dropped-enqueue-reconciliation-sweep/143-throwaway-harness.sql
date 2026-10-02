-- 143-throwaway-harness.sql — LOCAL PROOF HARNESS for the JOB-04 reconciliation sweep
-- =============================================================================
--
-- ⚠️ THIS IS NOT A MIGRATION AND NOT A CI GATE. It never runs against TEST or
-- PROD. It exists so that `supabase/migrations/20260816140000_reconcile_dropped_
-- enqueue_sweep.sql` can be APPLIED and its deployed cron body EXECUTED against
-- real rows on a THROWAWAY local Postgres cluster, because the D-19 lesson is
-- that a grep-only gate passes over a body whose bound does not exist
-- (20260803130000:35-37). Only executing the body against real rows falsifies it.
--
-- FIDELITY LIMITS — read these before trusting any result obtained here:
--   * NO row-level security. The real compute_jobs carries FORCE ROW LEVEL
--     SECURITY + a deny-all policy (20260516104201:209, 20260411144407:233-239).
--     This harness reproduces neither, so it CANNOT answer landmine L-2 (does the
--     pg_cron job role bypass RLS on compute_jobs?). Nothing observed here may be
--     read as evidence about that. Plan 04's REAL tick on TEST, inspected in
--     cron.job_run_details, is the only proof.
--   * NO real pg_cron. The `cron` schema below is a STUB: cron.job is a plain
--     table and cron.schedule/cron.unschedule are plain functions that upsert and
--     delete rows in it. Nothing is ever executed on a schedule. What the stub
--     DOES give us is the thing that matters for the gates: the migration's
--     deployed command text is stored and read back exactly as pg_cron would
--     store it, so the self-verify blocks and the arm harness both run against
--     the DEPLOYED body rather than a retyped copy.
--   * NO triggers (compute_jobs_set_updated_at_trigger), no audit log, no
--     retention crons, no worker.
--   * Table shapes are MINIMAL — only the columns the sweep predicate reads plus
--     every CHECK/index the INSERT must satisfy. They are NOT full replicas.
--
-- The real-schema proofs live elsewhere and are not replaced by this file:
--   * supabase/tests/test_reconcile_dropped_enqueue_sweep.sql (Plan 03) — the
--     CI-visible SQL gate, run by the `sql-tests` job against the real TEST
--     schema with real RLS and real constraints.
--   * Plan 04 — apply to TEST, then inspect one live tick in cron.job_run_details.
--
-- CONSTRAINTS COPIED VERBATIM FROM THE REAL SCHEMA (do not "tidy" these — a
-- weakened copy silently makes the INSERT arm pass here and fail in production):
--   * compute_jobs status CHECK ........... 20260411144407:112-120
--   * compute_jobs priority CHECK/default . 20260428120836:53-55
--   * compute_jobs_target_xor ............. 20260420073003:247-252 (LATEST, 4-way)
--   * compute_jobs_kind_target_coherence .. 20260717233529:168-181 (LATEST of 14)
--   * compute_jobs_one_inflight_per_kind_strategy .. 20260416125430:156-160
--       (⚠️ the CURRENT definition. The original at 20260411144407:179 was
--        DROPped at 20260416125430:154 and must NOT be copied.)
--   * strategy_analytics computation_status CHECK .. 20260602120000:46 (5 values)
--   * strategies.status CHECK ............. 20260716130000:57-61 (5 values)
--   * csv_daily_returns source xor ........ 20260624120000:44-45
--   * csv_daily_returns.created_at ........ 20260522111839:40 (NOT NULL DEFAULT now())
--       — the grace anchor. It MUST stay directly INSERT-writable so an arm can
--         backdate a seed instead of sleeping.
--
-- USAGE (the pg_extension fake is DELIBERATELY NOT in this file — see below):
--
--   PGBIN=/opt/homebrew/opt/postgresql@16/bin
--   SOCK="${TMPDIR:-/tmp}/143-tracer"
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d q143 -v ON_ERROR_STOP=1 -f 143-throwaway-harness.sql
--
--   -- (1) FAIL-LOUD PROOF: run the migration NOW, before faking pg_cron.
--   --     It MUST raise feature_not_supported and MUST NOT silently skip.
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d q143 -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql   # expect: ERROR
--
--   -- (2) Fake the extension row (THROWAWAY CLUSTER ONLY — superuser catalog write).
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d q143 -v ON_ERROR_STOP=1 -c \
--     "SET allow_system_table_mods = on; INSERT INTO pg_catalog.pg_extension \
--      (oid, extname, extowner, extnamespace, extrelocatable, extversion) \
--      VALUES (99999, 'pg_cron', 10, 11, false, '1.6');"
--
--   -- (3) Now the migration applies and every self-verify block runs.
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d q143 -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql   # expect: exit 0
--
-- Why the pg_extension fake is NOT in this file: putting it here would make the
-- fail-loud gate unobservable, and an unobserved gate is exactly what the
-- standing founder rule forbids ("a test that CANNOT FAIL is worse than none").
-- Keeping it a separate step is what lets step (1) above be a real RED.
--
-- ⚠️ NEVER run this file against a Supabase project. It creates a `cron` schema
-- whose functions would shadow nothing real but whose TABLE would collide with
-- pg_cron's own catalog, and it fabricates auth.users rows.
--
-- Reused by: 143-02 Task 2 (tracer happy path) and Task 3 (all directional arms,
-- idempotency, the LIMIT bound, and the three body-neuter previews). Plan 03 may
-- reuse it for local iteration before the CI gate is written.

-- --------------------------------------------------------------------------
-- Extensions the stub schema needs
-- --------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- --------------------------------------------------------------------------
-- auth.users — the FK root of the seed chain
-- --------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT
);

-- --------------------------------------------------------------------------
-- public.profiles
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT
);

-- --------------------------------------------------------------------------
-- public.api_keys — minimal; only needed as an FK target for strategy_keys
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_keys (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE
);

-- --------------------------------------------------------------------------
-- public.strategies — status CHECK verbatim from 20260716130000:57-61
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strategies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'pending_review', 'published', 'archived', 'private')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- public.csv_daily_returns — the dailies anchor (D-01) and the grace anchor (DX-04)
-- Shape after the per-key widening (20260624120000): strategy_id NULLABLE,
-- api_key_id/allocator_id added, source xor, surrogate PK, (strategy_id, date)
-- unique index. created_at is NOT NULL DEFAULT now() and directly writable.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.csv_daily_returns (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  strategy_id  UUID REFERENCES public.strategies(id) ON DELETE CASCADE,
  api_key_id   UUID REFERENCES public.api_keys(id)   ON DELETE CASCADE,
  allocator_id UUID REFERENCES auth.users(id)        ON DELETE CASCADE,
  date         DATE             NOT NULL,
  daily_return DOUBLE PRECISION NOT NULL,
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  CONSTRAINT csv_daily_returns_source_xor
    CHECK (num_nonnulls(strategy_id, api_key_id) = 1),
  CONSTRAINT csv_daily_returns_per_key_allocator
    CHECK (api_key_id IS NULL OR allocator_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS csv_daily_returns_strategy_date_key
  ON public.csv_daily_returns (strategy_id, date);

-- --------------------------------------------------------------------------
-- public.strategy_analytics — the D-03 / D-04 conjunct's table.
-- computation_status CHECK verbatim from 20260602120000:46 (all FIVE values).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strategy_analytics (
  strategy_id          UUID PRIMARY KEY REFERENCES public.strategies(id) ON DELETE CASCADE,
  computation_status   TEXT NOT NULL DEFAULT 'pending'
    CHECK (computation_status IN ('pending', 'computing', 'complete', 'complete_with_warnings', 'failed')),
  computation_warned   BOOLEAN NOT NULL DEFAULT FALSE,
  computation_error    TEXT,
  computing_started_at TIMESTAMPTZ,
  computed_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- public.strategy_keys — the composite discriminator (DX-05).
-- A strategy with >= 1 member row here is a COMPOSITE and must never be
-- enqueued compute_analytics_from_csv (route.ts:1363-1372; job_worker.py:5472-5485).
-- Minimal: no window columns, no owner FK gymnastics — the predicate only ever
-- asks "does a row exist for this strategy_id".
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strategy_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
  api_key_id  UUID NOT NULL REFERENCES public.api_keys(id)   ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  CONSTRAINT strategy_keys_seq_nonneg CHECK (seq >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS strategy_keys_strategy_seq_key
  ON public.strategy_keys (strategy_id, seq);

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
-- public.compute_jobs — the INSERT target. Every constraint the sweep's INSERT
-- must satisfy is reproduced VERBATIM (see the citation list in this header).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compute_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id     UUID REFERENCES public.strategies(id) ON DELETE CASCADE,
  portfolio_id    UUID,
  allocator_id    UUID,
  api_key_id      UUID,
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

  -- Verbatim from 20260717233529:168-181 (the LATEST of 14 definitions).
  -- The arm the sweep's INSERT rides is the strategy-scoped ARRAY arm.
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
  )
);

-- ⭐ THE SC#2 ARBITER. Verbatim from 20260416125430:156-160 — the CURRENT
-- definition. Note the predicate: it covers only ('pending','running',
-- 'done_pending_children'), so a strategy whose only job row is 'done' or
-- 'failed_final' is NOT blocked by this index. That is moot for the sweep
-- (its predicate demands ZERO job rows of ANY status, so such a strategy never
-- reaches the INSERT) and is recorded here so nobody weakens the predicate in
-- the belief that the index backstops it.
CREATE UNIQUE INDEX IF NOT EXISTS compute_jobs_one_inflight_per_kind_strategy
  ON public.compute_jobs (strategy_id, kind)
  WHERE strategy_id IS NOT NULL
    AND kind <> 'compute_intro_snapshot'
    AND status IN ('pending', 'running', 'done_pending_children');

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
-- REPLACES the body rather than adding a second row. The migration's
-- self-verify asserts exactly one row with this name, which is only a
-- meaningful assertion if the stub upserts the way pg_cron does.
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
  RAISE NOTICE '143 harness: stub schema created (auth.users, profiles, api_keys, strategies, csv_daily_returns, strategy_analytics, strategy_keys, compute_job_kinds, compute_jobs, cron stub). NO RLS, NO triggers, NO real pg_cron — see this file header for the fidelity limits.';
END
$harness$;
