-- Migration 033: compute_jobs admin surface + defer helper + position-polling enqueue
-- Sprint 3 Task 2.9 Round 2 / 3.2: Admin visibility + circuit-breaker defer + daily polling fanout
--
-- Why this migration exists
-- -------------------------
-- Migration 032 shipped the compute_jobs queue substrate (table, claim/mark
-- RPCs, reclaim_stuck watchdog, api_keys.last_429_at circuit breaker). The
-- header of 032 reserved migration 033 for "pg_cron tick scheduling", but
-- Sprint 3 went with a dedicated Railway worker dyno instead of pg_cron
-- (per /plan-ceo-review + Grok adversarial review 2026-04-11). The worker
-- drives its own ticks; there is no pg_cron dependency.
--
-- What this migration ships
-- -------------------------
-- 1. compute_jobs_admin view joining compute_jobs + strategies + portfolios
--    + api_keys + profiles with readable columns for the admin UI. Exposes
--    last_error un-redacted (admin-only read path, bypasses the redaction
--    that get_user_compute_jobs enforces for user-scoped reads).
-- 2. compute_jobs_status_created index (compound on status + created_at DESC)
--    for admin-page filter-by-status scans.
-- 3. defer_compute_job RPC — decrements attempts and reschedules a running
--    job back to pending. Used by the worker when the per-exchange circuit
--    breaker (api_keys.last_429_at) indicates a cooldown is active, so a
--    claimed job can yield its slot WITHOUT burning a retry. This solves the
--    attempt-burn bug: claim_compute_jobs increments attempts at claim time
--    (032:565), so mark_compute_job_failed(transient) would double-count if
--    the worker wanted to defer after claim. defer_compute_job cancels the
--    claim's increment via attempts - 1.
-- 4. enqueue_poll_positions_for_all_strategies RPC — loops strategies with
--    non-null api_key_id and at least one successful sync_trades in the last
--    30 days, and enqueues a poll_positions job via enqueue_compute_job for
--    each. Called by the worker's daily enqueue loop. Wrapped in a named
--    advisory lock to handle multi-replica scenarios: only one worker per
--    day actually enqueues.
-- 5. get_admin_compute_jobs RPC — service-definer function gated on
--    profiles.is_admin that returns filtered rows from compute_jobs_admin.
--    Route for /api/admin/compute-jobs to call.
-- 6. Self-verifying DO block matching the 032 pattern.
--
-- Transaction wrapping, search_path, REVOKE defaults, and comment conventions
-- mirror migration 032 exactly.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: compute_jobs_admin view
-- --------------------------------------------------------------------------
-- Admin-only read path. Exposes un-redacted last_error because the admin
-- UI specifically needs the raw error string for debugging. User-scoped
-- reads go through get_user_compute_jobs() which redacts last_error to
-- NULL (see 032:859-912 comment for why). Callers of this view MUST
-- verify is_admin — the RLS on compute_jobs denies all non-service-role
-- reads regardless, but this view is accessed via get_admin_compute_jobs
-- (SECURITY DEFINER + is_admin check) so the admin gate is enforced at
-- the RPC layer, not the view layer.
--
-- SECURITY INVOKER: the view does not bypass RLS on the base tables. It
-- exists for query convenience (pre-joined, pre-formatted columns) and the
-- get_admin_compute_jobs RPC is the real gate.
CREATE OR REPLACE VIEW compute_jobs_admin
WITH (security_invoker = true) AS
SELECT
  cj.id,
  cj.strategy_id,
  cj.portfolio_id,
  cj.kind,
  cj.status,
  cj.attempts,
  cj.max_attempts,
  cj.next_attempt_at,
  cj.claimed_at,
  cj.claimed_by,
  cj.last_error,
  cj.error_kind,
  cj.idempotency_key,
  cj.exchange,
  cj.trade_count,
  cj.created_at,
  cj.updated_at,
  cj.metadata,
  s.name        AS strategy_name,
  s.user_id     AS strategy_user_id,
  p.name        AS portfolio_name,
  p.user_id     AS portfolio_user_id,
  COALESCE(sp.email, pp.email) AS user_email
FROM compute_jobs cj
LEFT JOIN strategies s ON s.id = cj.strategy_id
LEFT JOIN portfolios p ON p.id = cj.portfolio_id
LEFT JOIN profiles sp ON sp.id = s.user_id
LEFT JOIN profiles pp ON pp.id = p.user_id;

COMMENT ON VIEW compute_jobs_admin IS
  'Admin-only join view over compute_jobs. Exposes un-redacted last_error. Accessed via get_admin_compute_jobs RPC which enforces the is_admin gate. See migration 033.';

-- --------------------------------------------------------------------------
-- STEP 2: status_created compound index
-- --------------------------------------------------------------------------
-- The admin /admin/compute-jobs page filters by status (e.g., "show only
-- failed_retry") and orders by created_at DESC. The existing 032 indexes
-- cover claim (next_attempt_at WHERE status='pending'), watchdog
-- (claimed_at WHERE status='running'), and per-exchange observability,
-- but none cover the "filter by status, sort by age" scan pattern. This
-- index is a compound (status, created_at DESC) so filtered queries hit
-- it directly without a full table scan as compute_jobs grows.
CREATE INDEX IF NOT EXISTS compute_jobs_status_created
  ON compute_jobs (status, created_at DESC);

-- --------------------------------------------------------------------------
-- STEP 3: defer_compute_job RPC
-- --------------------------------------------------------------------------
-- Transitions a running job back to pending for circuit-breaker defers.
-- Crucially, this function DECREMENTS attempts by 1 to cancel out the
-- increment that claim_compute_jobs performs at claim time (032:565).
-- The net effect is a "no-op claim": the job was picked up, the worker
-- looked at api_keys.last_429_at, decided the exchange is in cooldown,
-- and yielded the slot without consuming a retry.
--
-- Contrast with mark_compute_job_failed which INTENDS to consume a retry
-- (transient failures count against the retry budget). defer is for the
-- case where no work was actually attempted because the circuit breaker
-- said "wait". Without this function, circuit-breaker defers would burn
-- through max_attempts=3 via pure lock contention and terminal-fail
-- healthy jobs. See /plan-eng-review Finding 1-B + Codex final pass
-- Finding #4.
--
-- next_attempt_at is advanced by p_defer_seconds so the same job can be
-- re-claimed when the cooldown expires. Typical values: 120 (Binance
-- 2min), 300 (OKX 5min), 600 (Bybit 10min). The worker reads
-- api_keys.last_429_at and computes the remaining cooldown.
CREATE OR REPLACE FUNCTION defer_compute_job(
  p_job_id        UUID,
  p_defer_seconds INTEGER,
  p_reason        TEXT DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_current_attempts INTEGER;
  v_next_attempt TIMESTAMPTZ;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'defer_compute_job: p_job_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_defer_seconds IS NULL OR p_defer_seconds < 0 THEN
    RAISE EXCEPTION 'defer_compute_job: p_defer_seconds must be >= 0, got %', p_defer_seconds
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Cap defer at 1 hour to prevent a misconfigured caller from parking a
  -- job for days and silently breaking downstream widgets that expect
  -- recent data. The longest legitimate cooldown today is Bybit at
  -- 10 minutes.
  IF p_defer_seconds > 3600 THEN
    RAISE EXCEPTION 'defer_compute_job: p_defer_seconds % exceeds cap of 3600 (1 hour)', p_defer_seconds
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Lock and read the current attempts value. Must be running + claimed
  -- or we raise — deferring a non-running job doesn't make sense and
  -- would silently corrupt state if we let it through.
  SELECT attempts
    INTO v_current_attempts
    FROM compute_jobs
    WHERE id = p_job_id
      AND status = 'running'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'defer_compute_job: job % not found or not running', p_job_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_next_attempt := now() + (p_defer_seconds * interval '1 second');

  -- GREATEST(0, ...) defense: if attempts somehow landed at 0 before this
  -- call (shouldn't happen under the normal claim path but migrations
  -- or manual INSERTs could), don't let us go negative.
  UPDATE compute_jobs
     SET status          = 'pending',
         attempts        = GREATEST(0, v_current_attempts - 1),
         next_attempt_at = v_next_attempt,
         claimed_at      = NULL,
         claimed_by      = NULL,
         last_error      = p_reason
   WHERE id = p_job_id;

  RETURN v_next_attempt;
END;
$$;

COMMENT ON FUNCTION defer_compute_job IS
  'Defers a running job back to pending for circuit-breaker cooldowns. Decrements attempts by 1 to cancel claim_compute_jobs increment so the defer does not burn a retry. Used by worker when api_keys.last_429_at indicates a cooldown is active. See migration 033.';

REVOKE ALL ON FUNCTION defer_compute_job FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 4: enqueue_poll_positions_for_all_strategies RPC
-- --------------------------------------------------------------------------
-- Daily fanout helper called by the Railway worker's 24h enqueue loop.
-- Loops strategies that are (a) published or in-review (i.e. not drafts),
-- (b) have a non-null api_key_id, and (c) have had at least one successful
-- sync_trades job in the last 30 days (indicating the key still works).
-- For each qualifying strategy, calls enqueue_compute_job which is
-- idempotent via the partial unique index — a second call within the same
-- day returns the existing in-flight row.
--
-- Returns the number of rows actually enqueued (excludes duplicates that
-- returned existing in-flight jobs). Called exclusively by the worker;
-- REVOKE from all non-service roles.
--
-- The multi-worker race (two workers running the daily loop concurrently)
-- is handled at the worker layer via pg_try_advisory_lock('daily_position_polling').
-- This function is safe to call multiple times — the idempotency of
-- enqueue_compute_job guarantees no duplicate jobs — but advisory locking
-- at the call site saves the unnecessary work.
CREATE OR REPLACE FUNCTION enqueue_poll_positions_for_all_strategies()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_strategy_id UUID;
  v_exchange TEXT;
  v_enqueued INTEGER := 0;
  v_job_id UUID;
  v_existing_count INTEGER;
BEGIN
  FOR v_strategy_id, v_exchange IN
    SELECT DISTINCT s.id, ak.exchange
      FROM strategies s
      JOIN api_keys ak ON ak.id = s.api_key_id
      WHERE s.api_key_id IS NOT NULL
        AND s.status IN ('published', 'pending_review')
        AND EXISTS (
          SELECT 1 FROM compute_jobs cj
            WHERE cj.strategy_id = s.id
              AND cj.kind = 'sync_trades'
              AND cj.status = 'done'
              AND cj.updated_at > (now() - interval '30 days')
        )
  LOOP
    -- Count pre-existing in-flight poll_positions jobs for this strategy
    -- BEFORE the enqueue call, so we can detect whether enqueue_compute_job
    -- returned an existing id (no new row) vs created a new one.
    SELECT count(*) INTO v_existing_count
      FROM compute_jobs
      WHERE strategy_id = v_strategy_id
        AND kind = 'poll_positions'
        AND status IN ('pending', 'running', 'done_pending_children');

    v_job_id := enqueue_compute_job(
      v_strategy_id,
      'poll_positions',
      'daily-poll-' || to_char(now(), 'YYYY-MM-DD') || '-' || v_strategy_id::text,
      '{}'::UUID[],
      v_exchange,
      jsonb_build_object('enqueued_by', 'daily_loop', 'enqueued_at', now())
    );

    IF v_existing_count = 0 AND v_job_id IS NOT NULL THEN
      v_enqueued := v_enqueued + 1;
    END IF;
  END LOOP;

  RETURN v_enqueued;
END;
$$;

COMMENT ON FUNCTION enqueue_poll_positions_for_all_strategies IS
  'Daily fanout: enqueues a poll_positions job per qualifying strategy. Idempotent via enqueue_compute_job partial unique index. Returns count of newly-enqueued jobs. Called by worker daily loop under advisory lock to prevent multi-replica duplication. See migration 033.';

REVOKE ALL ON FUNCTION enqueue_poll_positions_for_all_strategies FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 5: get_admin_compute_jobs RPC
-- --------------------------------------------------------------------------
-- Admin-gated read path over compute_jobs_admin. Gates on profiles.is_admin
-- (NOT profiles.role — role is manager|allocator|both per 001:12, is_admin
-- is the actual admin flag per 011:19 + src/lib/admin.ts::isAdminUser).
--
-- Returns un-redacted last_error (unlike get_user_compute_jobs which NULLs
-- it). The admin UI needs raw error strings to debug failing jobs.
--
-- Non-admin callers get an empty result set (not an exception, matching
-- the get_user_compute_jobs shape for the no-auth case). The calling API
-- route must also perform an isAdminUser check before invoking this — the
-- RPC gate is defense in depth.
CREATE OR REPLACE FUNCTION get_admin_compute_jobs(
  p_limit  INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_status TEXT    DEFAULT NULL,
  p_kind   TEXT    DEFAULT NULL,
  p_exchange TEXT  DEFAULT NULL
)
RETURNS TABLE(
  id               UUID,
  strategy_id      UUID,
  portfolio_id     UUID,
  kind             TEXT,
  status           TEXT,
  attempts         INTEGER,
  max_attempts     INTEGER,
  next_attempt_at  TIMESTAMPTZ,
  claimed_at       TIMESTAMPTZ,
  claimed_by       TEXT,
  last_error       TEXT,
  error_kind       TEXT,
  idempotency_key  TEXT,
  exchange         TEXT,
  trade_count      INTEGER,
  created_at       TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ,
  metadata         JSONB,
  strategy_name    TEXT,
  portfolio_name   TEXT,
  user_email       TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_effective_limit INTEGER;
  v_effective_offset INTEGER;
BEGIN
  -- Admin gate: EXISTS check on profiles.is_admin, matches migration 011
  -- pattern verbatim.
  SELECT COALESCE(
    (SELECT is_admin FROM profiles WHERE id = auth.uid() LIMIT 1),
    false
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN;
  END IF;

  -- Clamp limit + offset to safe ranges.
  v_effective_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
  v_effective_offset := GREATEST(0, COALESCE(p_offset, 0));

  RETURN QUERY
  SELECT
    v.id, v.strategy_id, v.portfolio_id, v.kind, v.status,
    v.attempts, v.max_attempts, v.next_attempt_at,
    v.claimed_at, v.claimed_by,
    v.last_error, v.error_kind, v.idempotency_key,
    v.exchange, v.trade_count, v.created_at, v.updated_at, v.metadata,
    v.strategy_name, v.portfolio_name, v.user_email
  FROM compute_jobs_admin v
  WHERE (p_status IS NULL OR v.status = p_status)
    AND (p_kind IS NULL OR v.kind = p_kind)
    AND (p_exchange IS NULL OR v.exchange = p_exchange)
  ORDER BY v.created_at DESC
  LIMIT v_effective_limit
  OFFSET v_effective_offset;
END;
$$;

COMMENT ON FUNCTION get_admin_compute_jobs IS
  'Admin-gated read over compute_jobs_admin. Gates on profiles.is_admin. Returns un-redacted last_error for debugging. Non-admin callers get an empty result set. See migration 033.';

REVOKE ALL ON FUNCTION get_admin_compute_jobs FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_admin_compute_jobs TO authenticated;

-- --------------------------------------------------------------------------
-- STEP 6: reset_stalled_compute_jobs RPC (per-kind watchdog)
-- --------------------------------------------------------------------------
-- Per-kind watchdog called by the Railway worker's 60s loop. Mirrors the
-- existing 032 `reclaim_stuck_compute_jobs(INTERVAL)` but accepts a JSONB
-- of per-kind thresholds so compute_analytics (15-20 min realistic bound
-- for large portfolios) can coexist with sync_trades (10 min) and
-- poll_positions (5 min) under a single call. Grok final pass Finding #8.
--
-- Semantics per row:
--   * status='running' AND claimed_at < now() - effective_threshold → reset
--   * effective_threshold = p_per_kind_overrides ->> kind (if present)
--     else p_stale_threshold
--   * Row moves back to status='pending', clears claimed_at/claimed_by,
--     sets next_attempt_at=now() so the next tick picks it up, sets
--     last_error='worker_stalled' as an audit trail.
--   * attempts is NOT touched — claim_compute_jobs already incremented at
--     claim time (032:565), so the dead worker already consumed its retry
--     budget. The next claim will increment again, and backoff/failed_final
--     kicks in naturally on subsequent failures.
--
-- Returns total rows reset across all kinds.
CREATE OR REPLACE FUNCTION reset_stalled_compute_jobs(
  p_stale_threshold    INTERVAL DEFAULT interval '10 minutes',
  p_per_kind_overrides JSONB    DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reset     INTEGER := 0;
  v_partial   INTEGER;
  v_kind      TEXT;
  v_threshold INTERVAL;
BEGIN
  IF p_stale_threshold IS NULL OR p_stale_threshold <= interval '0' THEN
    RAISE EXCEPTION 'reset_stalled_compute_jobs: p_stale_threshold must be > 0, got %', p_stale_threshold
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Per-kind overrides: one UPDATE per kind with its bespoke threshold.
  -- The jsonb values are TEXT-castable INTERVAL strings (e.g. '20 minutes').
  IF p_per_kind_overrides IS NOT NULL THEN
    FOR v_kind IN SELECT jsonb_object_keys(p_per_kind_overrides) LOOP
      v_threshold := (p_per_kind_overrides ->> v_kind)::INTERVAL;

      UPDATE compute_jobs
         SET status          = 'pending',
             claimed_at      = NULL,
             claimed_by      = NULL,
             next_attempt_at = now(),
             last_error      = 'worker_stalled'
       WHERE status = 'running'
         AND kind = v_kind
         AND claimed_at IS NOT NULL
         AND claimed_at < (now() - v_threshold);

      GET DIAGNOSTICS v_partial = ROW_COUNT;
      v_reset := v_reset + v_partial;
    END LOOP;
  END IF;

  -- Default threshold: handle kinds NOT in the override map. Use a NOT ?
  -- predicate against the jsonb object so kinds listed in overrides are
  -- skipped by this pass (they were already handled above, possibly with
  -- a different threshold).
  UPDATE compute_jobs
     SET status          = 'pending',
         claimed_at      = NULL,
         claimed_by      = NULL,
         next_attempt_at = now(),
         last_error      = 'worker_stalled'
   WHERE status = 'running'
     AND claimed_at IS NOT NULL
     AND claimed_at < (now() - p_stale_threshold)
     AND (
       p_per_kind_overrides IS NULL
       OR NOT (p_per_kind_overrides ? kind)
     );

  GET DIAGNOSTICS v_partial = ROW_COUNT;
  v_reset := v_reset + v_partial;

  RETURN v_reset;
END;
$$;

COMMENT ON FUNCTION reset_stalled_compute_jobs IS
  'Per-kind watchdog: resets running jobs whose claimed_at is older than threshold (global or per-kind) back to pending. Does NOT touch attempts (already incremented at claim time). Called by Railway worker 60s loop. Returns total rows reset. See migration 033.';

REVOKE ALL ON FUNCTION reset_stalled_compute_jobs FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 7: self-verifying DO block
-- --------------------------------------------------------------------------
-- Matches the migration 032 pattern: one loop per expected artifact, fail
-- loudly at apply time if anything is missing.
DO $$
DECLARE
  v_exists BOOLEAN;
  v_secdef BOOLEAN;
  v_fn_name TEXT;
  v_expected_fns CONSTANT TEXT[] := ARRAY[
    'defer_compute_job',
    'enqueue_poll_positions_for_all_strategies',
    'get_admin_compute_jobs',
    'reset_stalled_compute_jobs'
  ];
BEGIN
  -- 1. compute_jobs_admin view exists
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'compute_jobs_admin'
  ) THEN
    RAISE EXCEPTION 'Migration 033 failed: compute_jobs_admin view missing';
  END IF;

  -- 2. compute_jobs_status_created index exists
  IF NOT EXISTS(
    SELECT 1 FROM pg_class WHERE relname = 'compute_jobs_status_created'
  ) THEN
    RAISE EXCEPTION 'Migration 033 failed: compute_jobs_status_created index missing';
  END IF;

  -- 3. All expected functions present and SECURITY DEFINER
  FOREACH v_fn_name IN ARRAY v_expected_fns LOOP
    SELECT EXISTS(
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = v_fn_name
    ) INTO v_exists;
    IF NOT v_exists THEN
      RAISE EXCEPTION 'Migration 033 failed: function public.% missing', v_fn_name;
    END IF;

    SELECT COALESCE(
      (SELECT p.prosecdef FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = v_fn_name
        LIMIT 1),
      FALSE)
    INTO v_secdef;
    IF NOT v_secdef THEN
      RAISE EXCEPTION 'Migration 033 failed: function public.% is not SECURITY DEFINER', v_fn_name;
    END IF;
  END LOOP;

  -- 4. defer_compute_job signature sanity check: must accept (UUID, INTEGER, TEXT)
  -- and return TIMESTAMPTZ. Guards against silent signature drift.
  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'defer_compute_job'
      AND pg_get_function_arguments(p.oid) ILIKE '%uuid%integer%text%'
  ) THEN
    RAISE EXCEPTION 'Migration 033 failed: defer_compute_job signature drift';
  END IF;

  RAISE NOTICE
    'Migration 033: compute_jobs_admin view + compute_jobs_status_created index + % admin/defer/enqueue/watchdog RPCs installed and verified.',
    array_length(v_expected_fns, 1);
END
$$;

COMMIT;
