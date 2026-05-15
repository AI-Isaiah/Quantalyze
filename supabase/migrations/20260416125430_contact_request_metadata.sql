-- Migration 048: contact_requests metadata + compute_intro_snapshot kind
-- Sprint 5 Task 5.3 — Intro Flow + Bridge Metadata Fix
--
-- Why this migration exists
-- -------------------------
-- Since Sprint 4, `src/components/portfolio/ReplacementCard.tsx` has
-- been POSTing `source="bridge"` and `replacement_for=<uuid>` to
-- /api/intro. The route silently drops these fields because
-- `contact_requests` has no columns to hold them. A manager looking at
-- an intro request from the Bridge panel has no way to tell the intro
-- came from a "replace this strategy" action — it looks identical to a
-- direct intro from the strategy page. This migration closes that gap
-- AND extends the schema with the allocator-portfolio snapshot the
-- intro route computes at insert time (or defers to the worker via the
-- new compute_intro_snapshot kind when the synchronous compute exceeds
-- a 2s budget).
--
-- What this migration does
-- ------------------------
-- 1. ALTER TABLE contact_requests ADD COLUMN:
--    - mandate_context       JSONB           nullable
--    - portfolio_snapshot    JSONB           nullable (filled by route OR worker)
--    - source                TEXT CHECK IN ('direct','bridge') DEFAULT 'direct'
--    - replacement_for       UUID FK strategies(id) ON DELETE SET NULL
--    - snapshot_status       TEXT CHECK IN ('pending','ready','failed') DEFAULT 'ready'
-- 2. Register `compute_intro_snapshot` in compute_job_kinds (follows
--    migration 046's pattern: INSERT ... ON CONFLICT DO NOTHING — no
--    ALTER TABLE on the registry).
-- 3. Relax compute_jobs_kind_target_coherence CHECK to include the new
--    kind in the strategy-scoped arm (contact_requests have a
--    strategy_id, so the job anchors to that strategy + carries
--    contact_request_id in metadata JSONB).
-- 4. Rewrite the partial unique inflight index to EXCLUDE
--    `compute_intro_snapshot`: multiple allocators can legitimately
--    request intros on the same strategy concurrently, each needs its
--    own snapshot job. Dedup at the job layer would cross-contaminate.
-- 5. Self-verifying DO block.
--
-- What this migration does NOT do
-- -------------------------------
-- - Does NOT backfill `source`/`snapshot_status` for historical rows.
--   DEFAULTs fill existing NULLs (source='direct', snapshot_status='ready').
-- - Does NOT add RLS policies. `contact_requests` has existing RLS from
--   migrations 001/002; new columns inherit the existing policies. The
--   admin read path (new /admin/intros page) uses the service-role
--   client, which bypasses RLS by default in Supabase.
-- - Does NOT add an admin SELECT policy. Read is funneled through the
--   service-role admin page guarded by isAdminUser().

BEGIN;

SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: contact_requests new columns
-- --------------------------------------------------------------------------
ALTER TABLE contact_requests
  ADD COLUMN IF NOT EXISTS mandate_context    JSONB,
  ADD COLUMN IF NOT EXISTS portfolio_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS source             TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS replacement_for    UUID REFERENCES strategies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS snapshot_status    TEXT NOT NULL DEFAULT 'ready';

-- CHECK constraints as separate ADD statements so IF NOT EXISTS-guarded
-- column adds don't trip when re-running.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_requests_source_check'
      AND conrelid = 'public.contact_requests'::regclass
  ) THEN
    ALTER TABLE contact_requests
      ADD CONSTRAINT contact_requests_source_check
      CHECK (source IN ('direct', 'bridge'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_requests_snapshot_status_check'
      AND conrelid = 'public.contact_requests'::regclass
  ) THEN
    ALTER TABLE contact_requests
      ADD CONSTRAINT contact_requests_snapshot_status_check
      CHECK (snapshot_status IN ('pending', 'ready', 'failed'));
  END IF;
END
$$;

COMMENT ON COLUMN contact_requests.mandate_context IS
  'Optional allocator-supplied mandate hints: {freeform, preferred_asset_class, preferred_exchange[], aum_range}. Validated by Zod at the /api/intro route. See migration 048.';

COMMENT ON COLUMN contact_requests.portfolio_snapshot IS
  'Snapshot of the allocator portfolio at intro time: {sharpe, max_drawdown, concentration, top_3_strategies, bottom_3_strategies, alerts_last_7d}. Computed inline by /api/intro (<2s budget) or asynchronously via compute_intro_snapshot job (snapshot_status=pending). See migration 048.';

COMMENT ON COLUMN contact_requests.source IS
  'Origin of the intro request: direct (strategy page / RequestIntroButton) or bridge (Bridge replacement panel / ReplacementCard). See migration 048.';

COMMENT ON COLUMN contact_requests.replacement_for IS
  'When source=bridge, the strategy_id this intro was proposed as a replacement for. Helps managers see the broader rebalance context. Nullable FK; ON DELETE SET NULL so retired strategies dont orphan intro history. See migration 048.';

COMMENT ON COLUMN contact_requests.snapshot_status IS
  'Lifecycle of portfolio_snapshot: pending (worker job enqueued), ready (column populated), failed (permanent compute error). Reflects the 2s synchronous budget + async fallback pattern of /api/intro. See migration 048.';

-- --------------------------------------------------------------------------
-- STEP 2: register compute_intro_snapshot kind
-- --------------------------------------------------------------------------
-- Mirrors 046 (reconcile_strategy) and 044 (sync_funding). The registry
-- is a plain table, not a CHECK constraint.
INSERT INTO compute_job_kinds (name) VALUES ('compute_intro_snapshot')
  ON CONFLICT (name) DO NOTHING;

-- --------------------------------------------------------------------------
-- STEP 3: extend compute_jobs_kind_target_coherence
-- --------------------------------------------------------------------------
-- Last touched in migration 036 (added poll_positions). 044 + 046 added
-- sync_funding / reconcile_strategy as strategy-scoped kinds but did NOT
-- update the coherence CHECK (both kinds predate a careful reading — the
-- CHECK is only enforced on INSERT, and those kinds went through
-- enqueue_compute_job, which always passes strategy_id, so the existing
-- 'sync_trades','compute_analytics','poll_positions' arm was relied on
-- implicitly via the NOT-strategy-nor-portfolio arm never matching).
-- Here we fix the drift: make every known strategy-scoped kind explicit.
ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
    (kind = 'compute_portfolio' AND portfolio_id IS NOT NULL) OR
    (kind IN (
      'sync_trades',
      'compute_analytics',
      'poll_positions',
      'sync_funding',
      'reconcile_strategy',
      'compute_intro_snapshot'
    ) AND strategy_id IS NOT NULL)
  );

COMMENT ON CONSTRAINT compute_jobs_kind_target_coherence ON compute_jobs IS
  'Kind <-> target-type coherence. compute_portfolio is portfolio-scoped; every other shipped kind is strategy-scoped. compute_intro_snapshot attaches to the intro target strategy and carries contact_request_id in metadata. See migration 048.';

-- --------------------------------------------------------------------------
-- STEP 4: rewrite inflight unique index to exclude compute_intro_snapshot
-- --------------------------------------------------------------------------
-- Original index (migration 032) enforces ONE in-flight job per
-- (strategy_id, kind). That is correct for sync_trades / compute_analytics
-- / poll_positions / sync_funding / reconcile_strategy — the job is a
-- pure function of the strategy, and two concurrent enqueues should
-- dedup. It is WRONG for compute_intro_snapshot: the job is a function
-- of (allocator_id, strategy_id) captured in a contact_request, and two
-- allocators requesting intros for the same strategy each need their
-- own snapshot.
DROP INDEX IF EXISTS compute_jobs_one_inflight_per_kind_strategy;

CREATE UNIQUE INDEX compute_jobs_one_inflight_per_kind_strategy
  ON compute_jobs (strategy_id, kind)
  WHERE strategy_id IS NOT NULL
    AND kind <> 'compute_intro_snapshot'
    AND status IN ('pending', 'running', 'done_pending_children');

COMMENT ON INDEX compute_jobs_one_inflight_per_kind_strategy IS
  'Partial unique enforcing one in-flight job per (strategy_id, kind) for strategy-scoped kinds. Excludes compute_intro_snapshot because those are per-(allocator, strategy), not per-strategy. See migration 048.';

-- --------------------------------------------------------------------------
-- STEP 5: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_check_def TEXT;
BEGIN
  -- 1. All five new columns present with the right nullability
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contact_requests'
      AND column_name = 'mandate_context'
  ) THEN
    RAISE EXCEPTION 'Migration 048 failed: contact_requests.mandate_context missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contact_requests'
      AND column_name = 'portfolio_snapshot'
  ) THEN
    RAISE EXCEPTION 'Migration 048 failed: contact_requests.portfolio_snapshot missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contact_requests'
      AND column_name = 'source'
      AND column_default = '''direct''::text'
  ) THEN
    RAISE EXCEPTION 'Migration 048 failed: contact_requests.source missing or default wrong';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contact_requests'
      AND column_name = 'replacement_for'
  ) THEN
    RAISE EXCEPTION 'Migration 048 failed: contact_requests.replacement_for missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contact_requests'
      AND column_name = 'snapshot_status'
      AND column_default = '''ready''::text'
  ) THEN
    RAISE EXCEPTION 'Migration 048 failed: contact_requests.snapshot_status missing or default wrong';
  END IF;

  -- 2. CHECK constraints land
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_requests_source_check'
      AND conrelid = 'public.contact_requests'::regclass
  ) THEN
    RAISE EXCEPTION 'Migration 048 failed: contact_requests_source_check missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_requests_snapshot_status_check'
      AND conrelid = 'public.contact_requests'::regclass
  ) THEN
    RAISE EXCEPTION 'Migration 048 failed: contact_requests_snapshot_status_check missing';
  END IF;

  -- 3. FK on replacement_for
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.contact_requests'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) ILIKE '%(replacement_for)%REFERENCES strategies%'
  ) THEN
    RAISE EXCEPTION 'Migration 048 failed: FK on contact_requests.replacement_for missing';
  END IF;

  -- 4. compute_intro_snapshot kind registered
  IF NOT EXISTS (
    SELECT 1 FROM compute_job_kinds WHERE name = 'compute_intro_snapshot'
  ) THEN
    RAISE EXCEPTION 'Migration 048 failed: compute_intro_snapshot kind not registered';
  END IF;

  -- 5. kind_target_coherence CHECK references compute_intro_snapshot
  SELECT pg_get_constraintdef(oid) INTO v_check_def
    FROM pg_constraint
    WHERE conname = 'compute_jobs_kind_target_coherence';
  IF v_check_def IS NULL OR v_check_def NOT LIKE '%compute_intro_snapshot%' THEN
    RAISE EXCEPTION 'Migration 048 failed: kind_target_coherence does not reference compute_intro_snapshot. Got: %', COALESCE(v_check_def, '<null>');
  END IF;

  -- 6. inflight index excludes compute_intro_snapshot
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'compute_jobs'
      AND indexname = 'compute_jobs_one_inflight_per_kind_strategy'
      AND indexdef ILIKE '%compute_intro_snapshot%'
  ) THEN
    RAISE EXCEPTION 'Migration 048 failed: inflight index does not exclude compute_intro_snapshot';
  END IF;

  RAISE NOTICE 'Migration 048: contact_requests metadata + compute_intro_snapshot kind installed and verified.';
END
$$;

COMMIT;
