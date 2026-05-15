-- Migration 032: compute_jobs queue + kinds registry + api_keys.last_429_at
-- Sprint 2 Task 2.9: Ingestion Control Plane (omnibus)
--
-- Why this migration exists
-- -------------------------
-- Today's compute pipeline (src/app/api/keys/sync/route.ts) uses Next.js
-- `after()` to run fetchTrades + computeAnalytics in a Vercel background
-- context. Five known failure modes are uncovered:
--
--   1. Vercel function dies mid-after() -> strategy_analytics stuck at
--      'computing' forever. No watchdog.
--   2. Railway cold start -> transient 5xx, no retry.
--   3. Double-submit race -> last writer wins on strategy_analytics.
--      No idempotency.
--   4. Partial success (fetchTrades ok, computeAnalytics fails) -> trades
--      persist, analytics are stale, silent.
--   5. /api/cron-sync fetches trades but does not recompute -> daily staleness.
--
-- This migration ships the durable queue substrate: a compute_jobs table
-- with fan-out/fan-in (parent_job_ids UUID[]), retry with backoff,
-- per-exchange circuit breaker support (api_keys.last_429_at), SKIP LOCKED
-- claim semantics, a watchdog reclaim function, and strict RLS (service
-- role only). Three kinds are seeded: sync_trades, compute_analytics,
-- compute_portfolio. All logic in PL/pgSQL (backoff schedule lives here
-- only per the DRY decision from /plan-eng-review).
--
-- What this migration does
-- ------------------------
-- 1. compute_job_kinds reference table + seed (sync_trades, compute_analytics,
--    compute_portfolio). Using a FK reference table instead of CHECK so
--    adding future kinds is INSERT not ALTER TABLE.
-- 2. compute_jobs table with target XOR (strategy_id OR portfolio_id),
--    parent_job_ids UUID[] for fan-in, status state machine, retry state,
--    idempotency_key, error_kind classification, observability columns.
-- 3. Partial unique indexes enforcing "one in-flight per (target, kind)".
-- 4. Claim index on next_attempt_at WHERE status='pending'.
-- 5. Watchdog index on claimed_at WHERE status='running'.
-- 6. GIN index on parent_job_ids for fan-in child lookups.
-- 7. Exchange observability index on (exchange, status).
-- 8. api_keys.last_429_at column for per-exchange circuit breaker.
-- 9. RLS: ENABLE then CREATE POLICY deny-all. Service role bypasses RLS
--    by default in Supabase, so the admin compute-jobs helpers (which
--    use the service-role client) still work. Direct user reads are
--    funneled through get_user_compute_jobs() SECURITY DEFINER.
-- 10. SECURITY DEFINER RPCs owned by the table owner:
--       - enqueue_compute_job(...): inserts or returns existing in-flight id
--       - enqueue_compute_portfolio_job(...): portfolio-scoped idempotent enqueue
--       - claim_compute_jobs(batch, worker_id): SELECT FOR UPDATE SKIP LOCKED
--       - mark_compute_job_done(id): transitions running->done + fires
--         check_fan_in_ready on children
--       - mark_compute_job_failed(id, error, kind): computes backoff and
--         transitions to failed_retry or failed_final. Backoff schedule
--         lives HERE only.
--       - reclaim_stuck_compute_jobs(older_than): watchdog reclaim
--       - check_fan_in_ready(child_id): returns true if all parents done
--       - update_api_key_rate_limit(api_key_id): sets last_429_at
--       - get_user_compute_jobs(): user-scoped read path
-- 11. Self-verifying DO block asserting every table, index, constraint,
--     function, and policy is in place with the expected attributes.
--
-- What this migration does NOT do
-- -------------------------------
-- - Does NOT wire pg_cron. Migration 033 schedules the compute_jobs_tick
--   endpoint that hits Railway's /api/jobs/tick worker. This migration
--   stays pure DDL so the queue exists ready-to-use but dormant until 033.
-- - Does NOT add a CHECK constraint on compute_jobs.kind. The FK to
--   compute_job_kinds is stronger and avoids ALTER TABLE when adding kinds.
-- - Does NOT define claim concurrency limits beyond SKIP LOCKED. The
--   Railway tick endpoint controls batch size via claim_compute_jobs(n).
-- - Does NOT populate historical data. Existing strategies get their first
--   jobs enqueued on the next /api/keys/sync user action or on the next
--   cron-sync rewrite tick (shipped in Round 2+ of this omnibus).
-- - Does NOT introduce the warning semantic color directly. DESIGN.md and
--   src/app/globals.css land that token in the same PR as this migration
--   (Sprint 2 Task 2.9 Round 1). The two must ship together for the admin
--   UI failed_retry color to render. Don't cherry-pick one without the other.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: compute_job_kinds reference table
-- --------------------------------------------------------------------------
-- Reference table rather than CHECK constraint. Future kinds (e.g.
-- stress_test, pdf_generation, optimizer_run) land as INSERT, not ALTER
-- TABLE with lock.
CREATE TABLE IF NOT EXISTS compute_job_kinds (
  name TEXT PRIMARY KEY
);

INSERT INTO compute_job_kinds (name) VALUES
  ('sync_trades'),
  ('compute_analytics'),
  ('compute_portfolio')
  ON CONFLICT (name) DO NOTHING;

COMMENT ON TABLE compute_job_kinds IS
  'Registry of valid compute_jobs.kind values. Referenced by compute_jobs.kind via FK. Add new kinds via INSERT; no ALTER TABLE needed. See migration 032.';

-- --------------------------------------------------------------------------
-- STEP 2: compute_jobs main table
-- --------------------------------------------------------------------------
-- Durable queue. One row per pending/running/completed/failed job. Every
-- job targets EXACTLY ONE of (strategy_id, portfolio_id). Fan-in via
-- parent_job_ids: a child compute_analytics job can list multiple parent
-- sync_trades jobs (one per exchange for multi-exchange strategies).
CREATE TABLE IF NOT EXISTS compute_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id     UUID REFERENCES strategies(id) ON DELETE CASCADE,
  portfolio_id    UUID REFERENCES portfolios(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL REFERENCES compute_job_kinds(name),
  parent_job_ids  UUID[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN (
                      'pending',
                      'running',
                      'done',
                      'done_pending_children',
                      'failed_retry',
                      'failed_final'
                    )),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at      TIMESTAMPTZ,
  claimed_by      TEXT,
  last_error      TEXT,
  error_kind      TEXT CHECK (error_kind IN ('transient', 'permanent', 'unknown')),
  idempotency_key TEXT,
  -- exchange mirrors the ApiKey.exchange CHECK in migration 001:46. Defense
  -- in depth: prevents a service-role insert of an unknown exchange that
  -- would fail the TS `ComputeJob.exchange` union at parse time.
  exchange        TEXT CHECK (exchange IS NULL OR exchange IN ('binance', 'okx', 'bybit')),
  trade_count     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB,

  CONSTRAINT compute_jobs_target_xor CHECK (
    (strategy_id IS NOT NULL AND portfolio_id IS NULL) OR
    (strategy_id IS NULL AND portfolio_id IS NOT NULL)
  ),
  -- Kind <-> target-type coherence: compute_portfolio is portfolio-scoped;
  -- sync_trades and compute_analytics are strategy-scoped. Rejects a
  -- compute_portfolio job that forgets to set portfolio_id, and rejects a
  -- sync_trades/compute_analytics job that gets routed to a portfolio by
  -- mistake. Defense against miswired callers in Round 2+.
  CONSTRAINT compute_jobs_kind_target_coherence CHECK (
    (kind = 'compute_portfolio' AND portfolio_id IS NOT NULL) OR
    (kind IN ('sync_trades', 'compute_analytics') AND strategy_id IS NOT NULL)
  )
);

COMMENT ON TABLE compute_jobs IS
  'Durable compute job queue. Shared across sync_trades, compute_analytics, compute_portfolio kinds. Fan-in via parent_job_ids. Service-role only (RLS deny-all + SECURITY DEFINER helpers). See migration 032.';

COMMENT ON COLUMN compute_jobs.parent_job_ids IS
  'UUIDs of parent jobs this child waits on. Empty for leaf jobs (e.g. a single sync_trades for a single-exchange strategy). Populated for compute_analytics children waiting on multiple sync_trades parents in multi-exchange strategies. See check_fan_in_ready().';

COMMENT ON COLUMN compute_jobs.error_kind IS
  'Classification used by mark_compute_job_failed to decide retry vs final. transient = retry per backoff schedule. permanent = skip retries, go directly to failed_final. unknown = retry (default for uncategorized errors).';

COMMENT ON COLUMN compute_jobs.idempotency_key IS
  'Optional caller-supplied correlation key (e.g. wizard-submit-<ulid>). NOT enforced at the DB level at all. Real idempotency is provided by the partial unique indexes on (strategy_id, kind) and (portfolio_id, kind), which guarantee only one in-flight row per target+kind. idempotency_key is purely for client-side correlation and appears in logs and admin UI.';

COMMENT ON COLUMN compute_jobs.exchange IS
  'Exchange name for sync_trades kind (binance/okx/bybit). NULL for compute_analytics and compute_portfolio. Used by observability queries and the per-exchange circuit breaker. Value space is enforced by the CHECK constraint on the column.';

COMMENT ON COLUMN compute_jobs.trade_count IS
  'Populated by sync_trades workers after a successful fetch. NULL for pending/running jobs and for non-sync_trades kinds. Observability only — not referenced by any state-machine logic.';

-- --------------------------------------------------------------------------
-- STEP 3: indexes
-- --------------------------------------------------------------------------
-- Partial unique index per target type: at most one in-flight (pending,
-- running, or waiting-for-children) job per (target, kind). Provides
-- idempotency at enqueue time. Separate indexes for strategy-scoped vs
-- portfolio-scoped jobs because partial unique can't span NULL columns
-- cleanly in one index.
CREATE UNIQUE INDEX IF NOT EXISTS compute_jobs_one_inflight_per_kind_strategy
  ON compute_jobs (strategy_id, kind)
  WHERE strategy_id IS NOT NULL
    AND status IN ('pending', 'running', 'done_pending_children');

CREATE UNIQUE INDEX IF NOT EXISTS compute_jobs_one_inflight_per_kind_portfolio
  ON compute_jobs (portfolio_id, kind)
  WHERE portfolio_id IS NOT NULL
    AND status IN ('pending', 'running', 'done_pending_children');

-- Claim index: find ready-to-run jobs fast.
CREATE INDEX IF NOT EXISTS compute_jobs_claim_ready
  ON compute_jobs (next_attempt_at)
  WHERE status = 'pending';

-- Watchdog index: find stuck running jobs fast.
CREATE INDEX IF NOT EXISTS compute_jobs_stuck_running
  ON compute_jobs (claimed_at)
  WHERE status = 'running';

-- Fan-in lookup: find children waiting on a specific parent job id.
CREATE INDEX IF NOT EXISTS compute_jobs_parent_lookup
  ON compute_jobs USING GIN (parent_job_ids);

-- Exchange observability: per-exchange status aggregation queries.
CREATE INDEX IF NOT EXISTS compute_jobs_exchange_status
  ON compute_jobs (exchange, status)
  WHERE exchange IS NOT NULL;

-- --------------------------------------------------------------------------
-- STEP 4: api_keys.last_429_at column (per-exchange circuit breaker)
-- --------------------------------------------------------------------------
-- Populated by update_api_key_rate_limit() when a job runner classifies an
-- exception as "rate limited". Read by run_sync_trades_job in Python to
-- decide whether to skip retry within the per-exchange cooldown window
-- (Bybit 10min, Binance 2min, OKX 5min). Cooldown windows live in Python,
-- the timestamp lives here.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS last_429_at TIMESTAMPTZ;

COMMENT ON COLUMN api_keys.last_429_at IS
  'Timestamp of the most recent 429 (rate limit) response from the exchange for this key. Populated by update_api_key_rate_limit(). Read by the Python job runner to skip retries within the per-exchange cooldown window. See migration 032.';

-- --------------------------------------------------------------------------
-- STEP 5: RLS — service-role only
-- --------------------------------------------------------------------------
-- compute_jobs is operational infrastructure, not user-facing data. Direct
-- reads from the user-scoped supabase client are denied. Admin helpers use
-- the service-role client which bypasses RLS by default. User-scoped reads
-- (e.g. for the wizard SyncPreviewStep showing the user their own jobs)
-- go through get_user_compute_jobs() SECURITY DEFINER which filters by
-- strategy ownership.
ALTER TABLE compute_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compute_jobs_deny_all ON compute_jobs;
CREATE POLICY compute_jobs_deny_all ON compute_jobs
  FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY compute_jobs_deny_all ON compute_jobs IS
  'Service-role-only. Non-service callers get zero rows. User-scoped reads go through get_user_compute_jobs() SECURITY DEFINER. See migration 032.';

-- compute_job_kinds is a small reference table. Reads are fine; writes
-- gated by service role default grants.
ALTER TABLE compute_job_kinds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compute_job_kinds_read ON compute_job_kinds;
CREATE POLICY compute_job_kinds_read ON compute_job_kinds
  FOR SELECT
  USING (true);

-- --------------------------------------------------------------------------
-- STEP 6: touch-updated_at trigger
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_jobs_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS compute_jobs_set_updated_at_trigger ON compute_jobs;
CREATE TRIGGER compute_jobs_set_updated_at_trigger
  BEFORE UPDATE ON compute_jobs
  FOR EACH ROW
  EXECUTE FUNCTION compute_jobs_set_updated_at();

-- --------------------------------------------------------------------------
-- STEP 6.5: _assert_owner (private defense-in-depth helper)
-- --------------------------------------------------------------------------
-- Shared ownership check used by enqueue_compute_job,
-- enqueue_compute_portfolio_job, and update_api_key_rate_limit. If there
-- is an auth session (i.e. NOT a service-role call), verify the caller
-- owns the row in question. Service-role calls bypass. Three RPCs used
-- to repeat this 10-line block verbatim.
--
-- Takes a regclass instead of a text table name so callers can pass
-- schema-qualified identifiers without stringly-typed SQL construction,
-- and so the function fails at parse time (not runtime) if the table
-- name is wrong. Uses format() + EXECUTE because a regclass in a dynamic
-- query needs explicit quoting.
CREATE OR REPLACE FUNCTION _assert_owner(
  p_table   REGCLASS,
  p_row_id  UUID,
  p_context TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_owner UUID;
BEGIN
  IF v_auth_uid IS NULL THEN
    RETURN;  -- service-role path, skip the check
  END IF;

  EXECUTE format('SELECT user_id FROM %s WHERE id = $1', p_table)
    INTO v_owner
    USING p_row_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION '%: row % not found in %', p_context, p_row_id, p_table
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_owner <> v_auth_uid THEN
    RAISE EXCEPTION '%: row % not owned by auth.uid()', p_context, p_row_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

COMMENT ON FUNCTION _assert_owner IS
  'Private shared ownership check. If auth.uid() is set, verifies the target row is owned by the caller. Service-role calls (auth.uid() NULL) bypass. Raises no_data_found if the row is missing, insufficient_privilege if owned by another user. See migration 032.';

REVOKE ALL ON FUNCTION _assert_owner FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 7: _enqueue_compute_job_internal (private shared helper)
-- --------------------------------------------------------------------------
-- Internal implementation of the idempotent enqueue pattern, shared by the
-- two public wrappers enqueue_compute_job and enqueue_compute_portfolio_job.
-- Handles both strategy-scoped and portfolio-scoped targets. Exactly one of
-- p_strategy_id / p_portfolio_id must be non-null; the XOR is enforced by
-- both this function and the compute_jobs_target_xor CHECK constraint on
-- the table.
--
-- Separated into a private helper for DRY — the two public wrappers used
-- to be ~80 line near-duplicates of each other. Now the shared SELECT +
-- race-safe INSERT lives in one place. The public wrappers are thin
-- pre-check + dispatch.
--
-- Security posture: SECURITY DEFINER. Does NOT run any auth.uid()
-- ownership check — the public wrappers are responsible for that, so
-- this helper can be called by the wrappers without the auth check
-- running twice. Access to this helper is REVOKEd from all roles so only
-- the table owner (via the wrappers' SECURITY DEFINER chain) can call it.
CREATE OR REPLACE FUNCTION _enqueue_compute_job_internal(
  p_strategy_id     UUID,
  p_portfolio_id    UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT,
  p_parent_job_ids  UUID[],
  p_exchange        TEXT,
  p_metadata        JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing_id UUID;
  v_new_id UUID;
BEGIN
  -- XOR guard. Matches compute_jobs_target_xor CHECK but fails earlier
  -- with a clearer error message.
  IF (p_strategy_id IS NULL AND p_portfolio_id IS NULL)
     OR (p_strategy_id IS NOT NULL AND p_portfolio_id IS NOT NULL) THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: exactly one of p_strategy_id or p_portfolio_id must be non-null (got strategy=%, portfolio=%)',
      p_strategy_id, p_portfolio_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_kind IS NULL THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: p_kind is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Optimistic path: look for an existing in-flight job first. Separate
  -- branches because the partial unique indexes are per-target-type.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
      WHERE strategy_id = p_strategy_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id
      FROM compute_jobs
      WHERE portfolio_id = p_portfolio_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- Race-safe insert. Two concurrent callers with the same (target, kind)
  -- can both clear the optimistic SELECT, then both try to INSERT. The
  -- partial unique index catches the second one via ON CONFLICT DO NOTHING,
  -- which leaves v_new_id NULL instead of raising. We then re-read the
  -- row the winner inserted so the loser returns the same id. Matches
  -- migration 011's `send_intro_with_decision` canonical idempotent shape.
  INSERT INTO compute_jobs (
    strategy_id, portfolio_id, kind, parent_job_ids,
    idempotency_key, exchange, metadata
  )
  VALUES (
    p_strategy_id, p_portfolio_id, p_kind, p_parent_job_ids,
    p_idempotency_key, p_exchange, p_metadata
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN v_new_id;
  END IF;

  -- Lost the race. Re-read the winner's row. Under PostgreSQL MVCC + the
  -- partial unique index semantics, a concurrent in-flight row is always
  -- visible to the losing transaction after ON CONFLICT DO NOTHING.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
      WHERE strategy_id = p_strategy_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  ELSE
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
      WHERE portfolio_id = p_portfolio_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  END IF;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION _enqueue_compute_job_internal IS
  'Private shared implementation of the idempotent enqueue pattern. Called by enqueue_compute_job and enqueue_compute_portfolio_job wrappers. Handles both strategy-scoped and portfolio-scoped targets via XOR on the two id parameters. Does NOT perform auth.uid() ownership checks — wrappers do that before calling. See migration 032.';

REVOKE ALL ON FUNCTION _enqueue_compute_job_internal FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 8: enqueue_compute_job RPC (public wrapper)
-- --------------------------------------------------------------------------
-- Thin public wrapper over _enqueue_compute_job_internal for strategy-
-- scoped jobs. Runs a defense-in-depth auth.uid() ownership check before
-- delegating. Service-role callers have auth.uid() = NULL and skip the
-- check (the REVOKE + no-GRANT declarations are still the primary gate).
CREATE OR REPLACE FUNCTION enqueue_compute_job(
  p_strategy_id     UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_parent_job_ids  UUID[] DEFAULT '{}',
  p_exchange        TEXT DEFAULT NULL,
  p_metadata        JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_strategy_id IS NULL THEN
    RAISE EXCEPTION 'enqueue_compute_job: p_strategy_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _assert_owner('strategies'::regclass, p_strategy_id, 'enqueue_compute_job');

  RETURN _enqueue_compute_job_internal(
    p_strategy_id, NULL, p_kind, p_idempotency_key,
    p_parent_job_ids, p_exchange, p_metadata
  );
END;
$$;

COMMENT ON FUNCTION enqueue_compute_job IS
  'Idempotent enqueue of a strategy-scoped compute job. Delegates to _enqueue_compute_job_internal after a defense-in-depth ownership check via _assert_owner. Service-role calls bypass the auth check. See migration 032.';

REVOKE ALL ON FUNCTION enqueue_compute_job FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 9a: enqueue_compute_portfolio_job RPC (public wrapper)
-- --------------------------------------------------------------------------
-- Thin public wrapper over _enqueue_compute_job_internal for portfolio-
-- scoped jobs. Same defense-in-depth auth pattern as enqueue_compute_job.
CREATE OR REPLACE FUNCTION enqueue_compute_portfolio_job(
  p_portfolio_id    UUID,
  p_idempotency_key TEXT DEFAULT NULL,
  p_parent_job_ids  UUID[] DEFAULT '{}',
  p_metadata        JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_portfolio_id IS NULL THEN
    RAISE EXCEPTION 'enqueue_compute_portfolio_job: p_portfolio_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _assert_owner('portfolios'::regclass, p_portfolio_id, 'enqueue_compute_portfolio_job');

  RETURN _enqueue_compute_job_internal(
    NULL, p_portfolio_id, 'compute_portfolio', p_idempotency_key,
    p_parent_job_ids, NULL, p_metadata
  );
END;
$$;

COMMENT ON FUNCTION enqueue_compute_portfolio_job IS
  'Idempotent enqueue of a portfolio-scoped compute job. Defense-in-depth ownership check via _assert_owner. Service-role calls bypass the check. See migration 032.';

REVOKE ALL ON FUNCTION enqueue_compute_portfolio_job FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 10: claim_compute_jobs RPC (SKIP LOCKED)
-- --------------------------------------------------------------------------
-- Claims up to p_batch_size ready-to-run jobs for a worker. Uses
-- SELECT ... FOR UPDATE SKIP LOCKED so two concurrent workers get
-- disjoint result sets with no blocking. Marks each claimed row as
-- running + records claimed_at + claimed_by.
CREATE OR REPLACE FUNCTION claim_compute_jobs(
  p_batch_size INTEGER,
  p_worker_id  TEXT
)
RETURNS SETOF compute_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs: p_batch_size must be > 0, got %', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Cap at 1000 to prevent a misconfigured worker from DoS-ing the DB
  -- via a giant UPDATE that holds row locks on a huge slice of the queue.
  -- Normal workers use batch_size=5 (see runbook); 1000 is a generous
  -- safety limit.
  IF p_batch_size > 1000 THEN
    RAISE EXCEPTION 'claim_compute_jobs: p_batch_size % exceeds cap of 1000', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_worker_id IS NULL OR length(p_worker_id) = 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs: p_worker_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  UPDATE compute_jobs
     SET status = 'running',
         claimed_at = now(),
         claimed_by = p_worker_id,
         attempts = attempts + 1
   WHERE id IN (
     SELECT id FROM compute_jobs
       WHERE status = 'pending'
         AND next_attempt_at <= now()
       ORDER BY next_attempt_at
       LIMIT p_batch_size
       FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;

COMMENT ON FUNCTION claim_compute_jobs IS
  'Atomically claims up to N ready-to-run jobs for a worker using SELECT FOR UPDATE SKIP LOCKED. Two concurrent callers get disjoint result sets. Each claimed row moves to status=running, attempts incremented, claimed_at/claimed_by set. See migration 032.';

REVOKE ALL ON FUNCTION claim_compute_jobs FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 11: check_fan_in_ready helper
-- --------------------------------------------------------------------------
-- Returns true when every parent of the given child job is in status=done.
-- Called by mark_compute_job_done after a parent completes, and during the
-- tick endpoint to advance done_pending_children children.
CREATE OR REPLACE FUNCTION check_fan_in_ready(
  p_child_job_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_parent_ids UUID[];
  v_unready_count INTEGER;
BEGIN
  SELECT parent_job_ids INTO v_parent_ids
    FROM compute_jobs
    WHERE id = p_child_job_id;

  IF v_parent_ids IS NULL THEN
    RETURN false;
  END IF;

  IF array_length(v_parent_ids, 1) IS NULL OR array_length(v_parent_ids, 1) = 0 THEN
    -- No parents -> always ready (leaf job).
    RETURN true;
  END IF;

  SELECT count(*) INTO v_unready_count
    FROM compute_jobs
    WHERE id = ANY(v_parent_ids)
      AND status <> 'done';

  RETURN v_unready_count = 0;
END;
$$;

COMMENT ON FUNCTION check_fan_in_ready IS
  'Returns true when every parent job of the child is status=done. Used by fan-in advancement. See migration 032.';

REVOKE ALL ON FUNCTION check_fan_in_ready FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 12: mark_compute_job_done RPC
-- --------------------------------------------------------------------------
-- Terminal success transition. Sets status=done. If the job has any
-- children waiting on it (rows with this job's id in their parent_job_ids),
-- flip any that are now fully ready from done_pending_children to pending
-- so the next tick picks them up.
CREATE OR REPLACE FUNCTION mark_compute_job_done(
  p_job_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_child_id UUID;
BEGIN
  UPDATE compute_jobs
     SET status = 'done'
   WHERE id = p_job_id
     AND status = 'running';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_compute_job_done: job % not found or not running', p_job_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Advance any children that are now fully ready.
  FOR v_child_id IN
    SELECT id FROM compute_jobs
      WHERE p_job_id = ANY(parent_job_ids)
        AND status = 'done_pending_children'
  LOOP
    IF check_fan_in_ready(v_child_id) THEN
      UPDATE compute_jobs
         SET status = 'pending',
             next_attempt_at = now()
       WHERE id = v_child_id
         AND status = 'done_pending_children';
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION mark_compute_job_done IS
  'Transitions a running job to done. Advances any done_pending_children children whose parents are now all complete. See migration 032.';

REVOKE ALL ON FUNCTION mark_compute_job_done FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 13: mark_compute_job_failed RPC (backoff schedule lives here)
-- --------------------------------------------------------------------------
-- Handles both transient (retry) and permanent (final) failures. Backoff
-- schedule: attempt 1 -> +30s, 2 -> +2min, 3 -> failed_final. Returns the
-- scheduled next_attempt_at so the Python runner can log it without
-- re-implementing the schedule (DRY decision from /plan-eng-review).
CREATE OR REPLACE FUNCTION mark_compute_job_failed(
  p_job_id     UUID,
  p_error      TEXT,
  p_error_kind TEXT DEFAULT 'unknown'
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_attempts INTEGER;
  v_max_attempts INTEGER;
  v_next_attempt TIMESTAMPTZ;
  v_new_status TEXT;
BEGIN
  IF p_error_kind IS NOT NULL
     AND p_error_kind NOT IN ('transient', 'permanent', 'unknown') THEN
    RAISE EXCEPTION 'mark_compute_job_failed: p_error_kind must be transient/permanent/unknown, got %', p_error_kind
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT attempts, max_attempts
    INTO v_attempts, v_max_attempts
    FROM compute_jobs
    WHERE id = p_job_id
      AND status = 'running'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mark_compute_job_failed: job % not found or not running', p_job_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Permanent failures skip retries regardless of attempt count.
  IF p_error_kind = 'permanent' THEN
    v_new_status := 'failed_final';
    v_next_attempt := now();
  ELSIF v_attempts >= v_max_attempts THEN
    v_new_status := 'failed_final';
    v_next_attempt := now();
  ELSE
    v_new_status := 'failed_retry';
    -- Backoff schedule: attempt 1 -> +30s, attempt 2 -> +2min, anything
    -- else -> +8min. Under the default invariant max_attempts=3, this
    -- function is only reached with v_attempts in {1, 2}, but the ELSE
    -- arm is a safety net for:
    --   (a) v_attempts=0, which shouldn't happen under the normal
    --       claim_compute_jobs path (claim always increments) but could
    --       arise from a manual row INSERT or a future schema change.
    --   (b) v_attempts>=3 under a higher max_attempts, if that's ever
    --       raised without updating this schedule.
    -- The ELSE intentionally does NOT RAISE EXCEPTION because RAISE would
    -- roll back the UPDATE on line below, leaving the row stuck in
    -- `running` forever and spawning a watchdog -> claim -> RAISE -> ...
    -- loop. Better to pick a conservative backoff and keep the row
    -- advancing; a Sentry alert on attempts>3 is the right signal for
    -- operator attention, handled at the monitoring layer.
    CASE
      WHEN v_attempts <= 1 THEN v_next_attempt := now() + interval '30 seconds';
      WHEN v_attempts = 2 THEN v_next_attempt := now() + interval '2 minutes';
      ELSE                      v_next_attempt := now() + interval '8 minutes';
    END CASE;
  END IF;

  UPDATE compute_jobs
     SET status = v_new_status,
         last_error = p_error,
         error_kind = COALESCE(p_error_kind, 'unknown'),
         next_attempt_at = v_next_attempt,
         claimed_at = NULL,
         claimed_by = NULL
   WHERE id = p_job_id;

  RETURN v_next_attempt;
END;
$$;

COMMENT ON FUNCTION mark_compute_job_failed IS
  'Transitions a running job to failed_retry (with backoff) or failed_final. Backoff schedule: attempt 1 -> +30s, 2 -> +2min, 3+ -> failed_final. Permanent errors go straight to failed_final regardless of attempts. Returns the scheduled next_attempt_at. See migration 032.';

REVOKE ALL ON FUNCTION mark_compute_job_failed FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 14: reclaim_stuck_compute_jobs (watchdog)
-- --------------------------------------------------------------------------
-- Any job in status=running whose claimed_at is older than p_older_than
-- gets reset to pending. Protects against worker crashes mid-run. Also
-- reclaims stale done_pending_children rows (child enqueue may have
-- failed transiently).
CREATE OR REPLACE FUNCTION reclaim_stuck_compute_jobs(
  p_older_than INTERVAL DEFAULT interval '10 minutes'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reclaimed INTEGER;
BEGIN
  UPDATE compute_jobs
     SET status = 'pending',
         claimed_at = NULL,
         claimed_by = NULL,
         next_attempt_at = now()
   WHERE status = 'running'
     AND claimed_at IS NOT NULL
     AND claimed_at < (now() - p_older_than);

  GET DIAGNOSTICS v_reclaimed = ROW_COUNT;

  RETURN v_reclaimed;
END;
$$;

COMMENT ON FUNCTION reclaim_stuck_compute_jobs IS
  'Watchdog: resets running jobs whose claimed_at is older than p_older_than back to pending. Returns the reclaim count. See migration 032.';

REVOKE ALL ON FUNCTION reclaim_stuck_compute_jobs FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 15: update_api_key_rate_limit helper
-- --------------------------------------------------------------------------
-- Stamps api_keys.last_429_at = now() for the given key. Called by the
-- Python job runner when an exchange returns 429. The per-exchange
-- cooldown window is enforced in Python (it varies by exchange).
CREATE OR REPLACE FUNCTION update_api_key_rate_limit(
  p_api_key_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_api_key_id IS NULL THEN
    RAISE EXCEPTION 'update_api_key_rate_limit: p_api_key_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _assert_owner('api_keys'::regclass, p_api_key_id, 'update_api_key_rate_limit');

  UPDATE api_keys
     SET last_429_at = now()
   WHERE id = p_api_key_id;
END;
$$;

COMMENT ON FUNCTION update_api_key_rate_limit IS
  'Stamps api_keys.last_429_at = now() for the given key. Read by the Python job runner to decide circuit-breaker backoff. See migration 032.';

REVOKE ALL ON FUNCTION update_api_key_rate_limit FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 16: get_user_compute_jobs (user-scoped read path)
-- --------------------------------------------------------------------------
-- Returns compute_jobs rows visible to the calling user. Filters to jobs
-- whose target strategy_id (or portfolio_id) is owned by auth.uid(). Used
-- by the wizard SyncPreviewStep Realtime subscription and any user-facing
-- query that needs current queue state for one user's strategies.
--
-- Column narrowing: `last_error` is REDACTED (always NULL in the returned
-- row set). The raw column may contain exception strings from the Python
-- runner (stack traces, API response bodies, partial URLs, internal host
-- names, sometimes leaked credentials) that must not leak to strategy
-- owners. Users see `error_kind` + a synthetic user-facing message
-- translated by the wizard / admin UI layer instead. Service-role callers
-- that need the raw `last_error` (the admin /admin/compute-jobs page)
-- must read compute_jobs directly via the service-role client, not via
-- this function. The Python runner is responsible for sanitizing
-- `last_error` before storage (see analytics-service/services/jobs.py
-- classify_exception in Round 2+); the narrowing here is defense in depth
-- in case a raw message slips through Python-side sanitization.
CREATE OR REPLACE FUNCTION get_user_compute_jobs(
  p_strategy_id UUID DEFAULT NULL,
  p_limit       INTEGER DEFAULT 100
)
RETURNS TABLE(
  id              UUID,
  strategy_id     UUID,
  portfolio_id    UUID,
  kind            TEXT,
  parent_job_ids  UUID[],
  status          TEXT,
  attempts        INTEGER,
  max_attempts    INTEGER,
  next_attempt_at TIMESTAMPTZ,
  claimed_at      TIMESTAMPTZ,
  claimed_by      TEXT,
  last_error      TEXT,
  error_kind      TEXT,
  idempotency_key TEXT,
  exchange        TEXT,
  trade_count     INTEGER,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  metadata        JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
BEGIN
  IF v_auth_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    cj.id, cj.strategy_id, cj.portfolio_id, cj.kind, cj.parent_job_ids,
    cj.status, cj.attempts, cj.max_attempts, cj.next_attempt_at,
    cj.claimed_at, cj.claimed_by,
    NULL::TEXT AS last_error,   -- redacted; see function comment above
    cj.error_kind, cj.idempotency_key, cj.exchange, cj.trade_count,
    cj.created_at, cj.updated_at, cj.metadata
    FROM compute_jobs cj
    LEFT JOIN strategies s ON s.id = cj.strategy_id
    LEFT JOIN portfolios p ON p.id = cj.portfolio_id
   WHERE (s.user_id = v_auth_uid OR p.user_id = v_auth_uid)
     AND (p_strategy_id IS NULL OR cj.strategy_id = p_strategy_id)
   ORDER BY cj.created_at DESC
   LIMIT GREATEST(1, LEAST(p_limit, 1000));
END;
$$;

COMMENT ON FUNCTION get_user_compute_jobs IS
  'Returns compute_jobs rows visible to auth.uid(), optionally filtered to a single strategy. last_error is REDACTED to NULL — users see error_kind + a synthetic message instead. Admin UI service-role reads go around this function. See migration 032.';

REVOKE ALL ON FUNCTION get_user_compute_jobs FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_user_compute_jobs TO authenticated;

-- --------------------------------------------------------------------------
-- STEP 17: self-verifying DO block
-- --------------------------------------------------------------------------
-- Loop-driven verification. Array literals name the expected functions,
-- indexes, and secdef subset — adding a new RPC later is a one-line
-- change to an array, not a new ~10-line check block.
DO $$
DECLARE
  v_kinds_count INTEGER;
  v_rls_enabled BOOLEAN;
  v_exists BOOLEAN;
  v_secdef BOOLEAN;
  v_fn_name TEXT;
  v_idx_name TEXT;
  -- Every public.function this migration installs. Order mirrors the
  -- STEP sections above so drift between the steps and this list is
  -- visible during code review.
  -- v_expected_fns must include every function this migration installs.
  -- v_expected_secdef_fns is the subset that must also be SECURITY DEFINER
  -- (the trigger function compute_jobs_set_updated_at is intentionally
  -- SECURITY INVOKER and is the only entry omitted). Adding a new RPC =
  -- add one line here AND one line in the secdef list; forgetting either
  -- makes the verification loop fail loudly at apply time.
  v_expected_fns CONSTANT TEXT[] := ARRAY[
    '_assert_owner',
    '_enqueue_compute_job_internal',
    'enqueue_compute_job',
    'enqueue_compute_portfolio_job',
    'claim_compute_jobs',
    'mark_compute_job_done',
    'mark_compute_job_failed',
    'reclaim_stuck_compute_jobs',
    'check_fan_in_ready',
    'update_api_key_rate_limit',
    'get_user_compute_jobs',
    'compute_jobs_set_updated_at'
  ];
  v_expected_secdef_fns CONSTANT TEXT[] := ARRAY[
    '_assert_owner',
    '_enqueue_compute_job_internal',
    'enqueue_compute_job',
    'enqueue_compute_portfolio_job',
    'claim_compute_jobs',
    'mark_compute_job_done',
    'mark_compute_job_failed',
    'reclaim_stuck_compute_jobs',
    'check_fan_in_ready',
    'update_api_key_rate_limit',
    'get_user_compute_jobs'
  ];
  -- Every index this migration installs on compute_jobs.
  v_expected_indexes CONSTANT TEXT[] := ARRAY[
    'compute_jobs_one_inflight_per_kind_strategy',
    'compute_jobs_one_inflight_per_kind_portfolio',
    'compute_jobs_claim_ready',
    'compute_jobs_stuck_running',
    'compute_jobs_parent_lookup',
    'compute_jobs_exchange_status'
  ];
BEGIN
  -- 1. compute_job_kinds seeded
  SELECT count(*) INTO v_kinds_count FROM compute_job_kinds;
  IF v_kinds_count < 3 THEN
    RAISE EXCEPTION 'Migration 032 failed: compute_job_kinds has % rows, expected >= 3', v_kinds_count;
  END IF;

  -- 2. compute_jobs table
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'compute_jobs'
  ) THEN
    RAISE EXCEPTION 'Migration 032 failed: compute_jobs table missing';
  END IF;

  -- 3. XOR constraint
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint WHERE conname = 'compute_jobs_target_xor'
  ) THEN
    RAISE EXCEPTION 'Migration 032 failed: compute_jobs_target_xor constraint missing';
  END IF;

  -- 4. api_keys.last_429_at column
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'api_keys'
      AND column_name = 'last_429_at'
  ) THEN
    RAISE EXCEPTION 'Migration 032 failed: api_keys.last_429_at column missing';
  END IF;

  -- 5. RLS enabled + deny policy on compute_jobs
  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'compute_jobs'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'Migration 032 failed: RLS not enabled on compute_jobs';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'compute_jobs'
      AND policyname = 'compute_jobs_deny_all'
  ) THEN
    RAISE EXCEPTION 'Migration 032 failed: compute_jobs_deny_all policy missing';
  END IF;

  -- 6. All expected functions present
  FOREACH v_fn_name IN ARRAY v_expected_fns LOOP
    SELECT EXISTS(
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = v_fn_name
    ) INTO v_exists;
    IF NOT v_exists THEN
      RAISE EXCEPTION 'Migration 032 failed: function public.% missing', v_fn_name;
    END IF;
  END LOOP;

  -- 7. Functions requiring SECURITY DEFINER actually have it
  FOREACH v_fn_name IN ARRAY v_expected_secdef_fns LOOP
    SELECT COALESCE(
      (SELECT p.prosecdef FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = v_fn_name
        LIMIT 1),
      FALSE)
    INTO v_secdef;
    IF NOT v_secdef THEN
      RAISE EXCEPTION 'Migration 032 failed: function public.% is not SECURITY DEFINER', v_fn_name;
    END IF;
  END LOOP;

  -- 8. All expected indexes present
  FOREACH v_idx_name IN ARRAY v_expected_indexes LOOP
    IF NOT EXISTS(
      SELECT 1 FROM pg_class WHERE relname = v_idx_name
    ) THEN
      RAISE EXCEPTION 'Migration 032 failed: index % missing', v_idx_name;
    END IF;
  END LOOP;

  -- 9. updated_at trigger on compute_jobs
  IF NOT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'compute_jobs'
      AND t.tgname = 'compute_jobs_set_updated_at_trigger'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Migration 032 failed: compute_jobs_set_updated_at_trigger missing';
  END IF;

  RAISE NOTICE
    'Migration 032: compute_jobs queue + kinds registry + % RPCs + 1 trigger function + % indexes + RLS + api_keys.last_429_at installed and verified.',
    array_length(v_expected_fns, 1) - 1,  -- minus the trigger function
    array_length(v_expected_indexes, 1);
END
$$;

COMMIT;
