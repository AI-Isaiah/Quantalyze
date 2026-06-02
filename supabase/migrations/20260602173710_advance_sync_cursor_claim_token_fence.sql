-- audit-2026-05-07 cluster CL12 (NEW-C12-05) — claim_token fence on the
-- sync_trades epilogue cursor/balance writes.
--
-- Background.
--   Migration 117 (`20260515114555_compute_jobs_claim_token_fencing.sql`)
--   added a per-claim `claim_token UUID` to compute_jobs and gated the
--   TERMINAL mark RPCs (`mark_compute_job_done` / `mark_compute_job_failed`)
--   on it. Migration `20260529170000` extended the fence to
--   `defer_compute_job`. But the fence still guards only the terminal/defer
--   transitions — NOT the epilogue writes `run_sync_trades_job` makes to
--   `api_keys` AFTER a successful fetch:
--     • `last_fetched_trade_timestamp` (granular fetch checkpoint)
--     • `last_sync_at`                  (daily-PnL sync checkpoint)
--     • `account_balance_usdt`          (latest balance snapshot)
--
--   Split-brain (NEW-C12-05): the watchdog (`reset_stalled_compute_jobs`)
--   can reclaim a SLOW-but-alive worker W1 mid-epilogue and another worker
--   W2 re-claims the SAME job row under a fresh token. W1, unaware, still
--   runs its epilogue and writes the cursor. The cursor columns already
--   carry a MONOTONIC guard in the worker (`last_* IS NULL OR last_* < new`)
--   so a stale orphaned W1 cannot REGRESS the timestamp — but:
--     1. `account_balance_usdt` has NO ordering semantics (no monotonic
--        guard), so an orphaned W1 clobbers W2's fresher balance with an
--        older snapshot, with nothing to stop it.
--     2. The monotonic guard is per-column defence-in-depth, not an
--        ownership check; this migration adds the actual ownership fence so
--        the whole orphaned-W1 epilogue write is dropped at "do I still own
--        this job".
--
--   SCOPE / what this fence does and does NOT close. It closes the
--   ORPHAN-vs-owner race: a W1 whose specific job was watchdog-reclaimed and
--   re-claimed by W2 fails the EXISTS (status/token mismatch) and writes
--   nothing. It does NOT impose a global ordering on `account_balance_usdt`:
--   if two DISTINCT, both-legitimately-owned jobs ever wrote the same
--   api_key's balance concurrently, that is plain last-writer-wins (balance
--   has no timestamp source to guard on) and self-heals on the next sync.
--   In practice the per-(strategy_id,kind) / (api_key_id,kind) in-flight
--   unique indexes make concurrent same-key sync_trades writes unreachable,
--   so this residual is theoretical; we scope the claim precisely rather
--   than overstate the fence.
--
-- Scope.
--   New SECURITY DEFINER `advance_sync_cursor(...)` that the worker calls in
--   place of the two `api_keys.update(...)` epilogue writes. It:
--     1. When `p_claim_token IS NOT NULL` (fence active), verifies the caller
--        still owns the job — `compute_jobs` row is still `running` under the
--        SAME token. If not (watchdog reclaim → status flipped or token
--        rotated), it RETURNS FALSE and writes NOTHING (orphan blocked).
--     2. When `p_claim_token IS NULL` (back-compat / WORKER_FENCE_V2 off),
--        the fence is fully INERT and the write proceeds unconditionally —
--        identical to today's behaviour. This is the deploy-window arm: the
--        migration auto-applies to PROD on merge, but until the Railway
--        worker redeploys threading the token (or with the kill-switch off)
--        nothing changes. NOTE this differs from the `defer_compute_job`
--        back-compat arm, which keeps an unconditional `status='running'`
--        precondition because deferring a non-running job is meaningless;
--        here the legacy epilogue write had NO compute_jobs precondition at
--        all, so the NULL arm must bypass the fence entirely to preserve it.
--     3. Re-applies the worker's MONOTONIC guards inside one UPDATE
--        statement (CASE per timestamp column; COALESCE for balance) so the
--        defence-in-depth survives even when the fence is inert. The UPDATE
--        statement is itself atomic, but — unlike the sibling mark/defer
--        fences which `SELECT ... FOR UPDATE` the compute_jobs row — the
--        EXISTS check and the UPDATE here are intentionally LOCK-FREE: they
--        touch different tables (compute_jobs read, api_keys write), and the
--        only value an orphan could slip through the narrow EXISTS→UPDATE
--        window is a timestamp the CASE guard then refuses (self-correcting)
--        or a balance that is last-writer-wins anyway. A FOR UPDATE on
--        compute_jobs would not protect the api_keys write, so it is omitted.
--
-- Production impact.
--   The worker (`services/job_worker.run_sync_trades_job`) is the sole
--   caller. With the token threaded, an orphaned W1's epilogue write is
--   dropped (FALSE → worker logs `worker_orphan_write_blocked` WARNING)
--   instead of racing W2. Legitimate writes are unchanged. SECDEF is strictly
--   LESS privileged than the worker's existing service_role access: it can
--   touch only 3 cursor columns of one api_key by id — no tenant surface
--   beyond what the worker already holds.

SET LOCAL search_path = public, pg_catalog;

CREATE OR REPLACE FUNCTION advance_sync_cursor(
  p_api_key_id      UUID,
  p_job_id          UUID,
  p_claim_token     UUID        DEFAULT NULL,
  p_last_fetched_ts TIMESTAMPTZ DEFAULT NULL,
  p_last_sync_at    TIMESTAMPTZ DEFAULT NULL,
  p_account_balance NUMERIC     DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_api_key_id IS NULL THEN
    RAISE EXCEPTION 'advance_sync_cursor: p_api_key_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- NEW-C12-05 ownership fence. Only active when a token is supplied; the
  -- NULL arm preserves the legacy unconditional-write path (see header).
  IF p_claim_token IS NOT NULL THEN
    IF p_job_id IS NULL THEN
      RAISE EXCEPTION 'advance_sync_cursor: p_job_id is required when p_claim_token is supplied'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM compute_jobs
       WHERE id = p_job_id
         AND status = 'running'
         AND claim_token = p_claim_token
    ) THEN
      -- Orphan: the watchdog reclaimed this job (status no longer 'running'
      -- or token rotated to W2). Drop the epilogue write rather than race the
      -- owner. Caller distinguishes FALSE (owned-check failed) from an
      -- exception (DB error) and logs the orphan-blocked signal.
      RETURN FALSE;
    END IF;
  END IF;

  -- Owned (or back-compat NULL arm): apply the monotonic-guarded write in a
  -- single atomic UPDATE. Each timestamp advances only when strictly newer
  -- (defence-in-depth that survives even when the fence is inert); the
  -- balance has no ordering so it is overwritten when supplied.
  UPDATE api_keys
     SET last_fetched_trade_timestamp = CASE
           WHEN p_last_fetched_ts IS NOT NULL
                AND (last_fetched_trade_timestamp IS NULL
                     OR last_fetched_trade_timestamp < p_last_fetched_ts)
             THEN p_last_fetched_ts
             ELSE last_fetched_trade_timestamp
           END,
         last_sync_at = CASE
           WHEN p_last_sync_at IS NOT NULL
                AND (last_sync_at IS NULL OR last_sync_at < p_last_sync_at)
             THEN p_last_sync_at
             ELSE last_sync_at
           END,
         account_balance_usdt = COALESCE(p_account_balance, account_balance_usdt)
   WHERE id = p_api_key_id;

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION advance_sync_cursor(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC) IS
  'Fenced sync_trades epilogue cursor/balance write. NEW-C12-05 (CL12): when '
  'p_claim_token is supplied, verifies the caller still owns the compute_job '
  '(status=running AND claim_token match) and RETURNS FALSE writing nothing if '
  'a watchdog reclaim handed the job to another worker; the NULL arm preserves '
  'the legacy unconditional write for the deploy window / WORKER_FENCE_V2 off. '
  'Monotonic guards re-applied inside one atomic UPDATE. Worker is sole caller '
  '(services/job_worker.run_sync_trades_job). See migrations 117 + 20260529170000.';

REVOKE ALL ON FUNCTION advance_sync_cursor(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC)
  FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- Verification — exercise both branches WITHOUT seeding a compute_jobs row
-- (compute_jobs.strategy_id → strategies.id → profiles.id NOT NULL would
-- 23503 and abort the whole migration). The owned-path token-match fence on a
-- real running row is pinned by the live-DB regression test
-- tests/test_compute_jobs_fencing.py.
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_orphan_result   BOOLEAN;
  v_backcompat_res  BOOLEAN;
  v_dummy_key UUID := gen_random_uuid();
  v_dummy_job UUID := gen_random_uuid();
BEGIN
  -- Probe A: fence active (token supplied), no matching running job → orphan
  -- path returns FALSE and writes nothing. Proves the 6-arg signature routes
  -- and the ownership branch fires.
  v_orphan_result := advance_sync_cursor(
    v_dummy_key, v_dummy_job, gen_random_uuid(),
    now(), now(), 1234.5
  );
  IF v_orphan_result IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'CL12 verification failed: advance_sync_cursor with a non-owned token returned % (expected FALSE)', v_orphan_result;
  END IF;

  -- Probe B: back-compat arm (token NULL) → write path returns TRUE even with
  -- no matching api_key row (UPDATE affects 0 rows, still owned/legacy-write).
  v_backcompat_res := advance_sync_cursor(
    v_dummy_key, NULL, NULL,
    now(), now(), NULL
  );
  IF v_backcompat_res IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'CL12 verification failed: advance_sync_cursor back-compat (NULL token) returned % (expected TRUE)', v_backcompat_res;
  END IF;
END;
$verify$;
