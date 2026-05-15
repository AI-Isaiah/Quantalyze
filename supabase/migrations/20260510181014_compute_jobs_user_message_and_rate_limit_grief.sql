-- Migration 111: get_user_compute_jobs user_message + update_api_key_rate_limit grief defenses
-- (audit-2026-05-07 P11 / G10.B.15 + P16 / G10.B.16)
--
-- Why this migration exists
-- -------------------------
-- audit-2026-05-07 G10.B contains two HIGH items that need RPC body
-- changes (vs. mig 109's correctness sweep):
--
-- * P11 (G10.B.15): get_user_compute_jobs hard-redacts last_error to
--   NULL but Round-1 ships no UI translation. If the wizard ever
--   surfaces a failed compute_jobs row in the current shape, users see
--   error_kind='unknown' with no human text and an infinite spinner —
--   the runbook acknowledges Round 2 was supposed to ship the wizard
--   translator but Round 2 is still deferred. Fix: add a synthetic
--   user_message TEXT computed inside the RPC based on
--   (status, error_kind) so the contract is self-contained.
--
-- * P16 (G10.B.16): update_api_key_rate_limit can be used by a
--   compromised analytics-service deployment (or rogue service-role
--   token) to stamp last_429_at on every api_keys row in a loop,
--   freezing every user's syncing for 10min. Today the function has no
--   audit trail, no dedup, and no operator visibility. Fix: (a)
--   per-key 60s dedup (no-op if last_429_at within 60s); (b)
--   audit_log row on every successful stamp via log_audit_event_service.
--
-- Items NOT in this migration
-- ---------------------------
-- * P11 wizard UI integration: client-side translator that consumes
--   the new user_message column. Out of scope for this SQL migration.
--   The new column is non-breaking (additive on the RPC return shape)
--   so the UI can adopt at any later cadence.
-- * P16 Sentry alert on stamp spikes: cross-system, out of scope.
--
-- Compatibility
-- -------------
-- * get_user_compute_jobs gains ONE new RETURNS-TABLE column,
--   user_message TEXT, appended at the end of the column list. The PG
--   function signature does not break — Supabase JS rpc() returns row
--   objects keyed by column name, not positional. Existing callers
--   continue to work; new callers can read user_message.
-- * update_api_key_rate_limit signature unchanged. New behavior: dedup
--   plus audit trail. Callers in analytics-service/services/exchange.py
--   continue to call as today.
-- * REVOKE / GRANT posture preserved.

BEGIN;

-- --------------------------------------------------------------------
-- P16: update_api_key_rate_limit — per-key 60s dedup + audit_log row
-- --------------------------------------------------------------------
-- Defense in depth against a compromised service-role token (or buggy
-- worker) that loops over api_keys.id stamping last_429_at to grief
-- the user base.
--
-- Dedup: SELECT FOR UPDATE the api_keys row, then NO-OP if the
-- existing last_429_at is within 60 seconds. Two legitimate concurrent
-- 429s for the same key collapse to one stamp; an attacker re-loop
-- collapses to zero new stamps after the first.
--
-- Audit: on every stamp (after the dedup check passes), insert via
-- log_audit_event_service so SOC review can detect anomalous patterns
-- (e.g. stamps for keys not in the worker's strategy scope, stamps
-- happening at 3am with no syncing traffic). user_id comes from the
-- api_keys row so the audit attribution is per-owner. action namespace
-- is 'api_key.rate_limit_stamped' to match the audit_log convention.
CREATE OR REPLACE FUNCTION update_api_key_rate_limit(
  p_api_key_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id        UUID;
  v_last_429_at    TIMESTAMPTZ;
  v_now            TIMESTAMPTZ := now();
BEGIN
  IF p_api_key_id IS NULL THEN
    RAISE EXCEPTION 'update_api_key_rate_limit: p_api_key_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _assert_owner('api_keys'::regclass, p_api_key_id, 'update_api_key_rate_limit');

  -- Lock the row so concurrent calls collapse correctly.
  SELECT user_id, last_429_at
    INTO v_user_id, v_last_429_at
    FROM api_keys
    WHERE id = p_api_key_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_api_key_rate_limit: api_key % not found', p_api_key_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Per-key 60s dedup. (mig 111 P16 / G10.B.16) An attacker re-stamping
  -- in a loop produces one row update + one audit_log row, then no-ops
  -- for 60s. Legitimate rapid 429 bursts collapse to one stamp.
  IF v_last_429_at IS NOT NULL
     AND v_last_429_at >= v_now - interval '60 seconds' THEN
    RETURN;
  END IF;

  UPDATE api_keys
     SET last_429_at = v_now
   WHERE id = p_api_key_id;

  -- Audit trail. log_audit_event_service is the canonical service-role
  -- audit RPC (mig 058) and writes via the SECURITY DEFINER fast path.
  -- Fail-soft: if the audit insert fails (table missing, RLS
  -- regression), we do NOT roll back the rate-limit stamp — the
  -- circuit-breaker function is more important than the audit.
  BEGIN
    PERFORM log_audit_event_service(
      v_user_id,
      'api_key.rate_limit_stamped',
      'api_key',
      p_api_key_id,
      jsonb_build_object(
        'previous_last_429_at', v_last_429_at,
        'stamped_at',           v_now,
        'source',               'update_api_key_rate_limit'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'update_api_key_rate_limit: audit_log write failed for api_key % (sqlstate=%, msg=%); rate-limit stamp succeeded',
      p_api_key_id, SQLSTATE, SQLERRM;
  END;
END;
$$;

COMMENT ON FUNCTION update_api_key_rate_limit IS
  'Stamps api_keys.last_429_at = now() with per-key 60s dedup + audit_log row '
  '(mig 111 P16 / G10.B.16). Idempotent within a 60s window; second call inside '
  'the window is a no-op. See migration 111.';

REVOKE ALL ON FUNCTION update_api_key_rate_limit FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------
-- P11: get_user_compute_jobs — synthetic user_message column
-- --------------------------------------------------------------------
-- Because Postgres functions cannot CHANGE their RETURNS TABLE shape
-- via CREATE OR REPLACE (a column add throws "cannot change return
-- type of existing function"), we DROP the function first then
-- re-CREATE with the additional column appended.
--
-- The user_message text is computed from (status, error_kind) so the
-- wizard / admin UI does not need to ship a translator in lockstep
-- with this migration. Mappings are deliberately conservative — vague
-- enough that they remain accurate as more error_kind values are
-- introduced, specific enough that an end user knows whether to wait
-- or contact support.
DROP FUNCTION IF EXISTS get_user_compute_jobs(UUID, INTEGER);

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
  metadata        JSONB,
  user_message    TEXT
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
    NULL::TEXT AS last_error,   -- redacted; see mig 032 STEP 16 comment
    cj.error_kind, cj.idempotency_key, cj.exchange, cj.trade_count,
    cj.created_at, cj.updated_at, cj.metadata,
    -- (mig 111 P11 / G10.B.15) Synthetic user-facing message based on
    -- (status, error_kind). NULL for non-failure rows so the UI
    -- distinguishes "in flight" from "needs operator attention".
    CASE
      WHEN cj.status = 'failed_final' AND cj.error_kind = 'permanent' THEN
        'We hit a problem we can''t retry automatically. Please contact support.'
      WHEN cj.status = 'failed_final' THEN
        'Tried multiple times without success. Please contact support.'
      WHEN cj.status = 'failed_retry' THEN
        'Temporary issue — retrying automatically.'
      WHEN cj.status IN ('pending', 'running', 'done_pending_children') THEN
        NULL
      WHEN cj.status = 'done' THEN
        NULL
      ELSE
        NULL
    END::TEXT AS user_message
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
  'Returns compute_jobs rows visible to auth.uid(). last_error REDACTED; '
  'user_message TEXT (mig 111 P11) synthesised from (status, error_kind) so the '
  'wizard / admin UI does not depend on a separate Round-2 translator. See migration 111.';

REVOKE ALL ON FUNCTION get_user_compute_jobs FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_user_compute_jobs TO authenticated;

-- --------------------------------------------------------------------
-- Self-verifying assertions
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_body         TEXT;
  v_args         TEXT;
BEGIN
  -- P16: update_api_key_rate_limit body has dedup + audit branch
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'update_api_key_rate_limit';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Migration 111 verification failed: update_api_key_rate_limit not found';
  END IF;
  IF v_body NOT ILIKE '%interval ''60 seconds''%' THEN
    RAISE EXCEPTION 'Migration 111 verification failed: update_api_key_rate_limit lacks 60s dedup branch';
  END IF;
  IF v_body NOT ILIKE '%api_key.rate_limit_stamped%' THEN
    RAISE EXCEPTION 'Migration 111 verification failed: update_api_key_rate_limit lacks audit_log call';
  END IF;

  -- P11: get_user_compute_jobs returns the new user_message column
  SELECT pg_get_function_result(p.oid) INTO v_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'get_user_compute_jobs';
  IF v_args IS NULL OR v_args NOT ILIKE '%user_message text%' THEN
    RAISE EXCEPTION 'Migration 111 verification failed: get_user_compute_jobs RETURNS TABLE missing user_message text column (got: %)', v_args;
  END IF;
END $$;

COMMIT;
