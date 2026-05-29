-- audit-2026-05-07 cluster CL10 (NEW-C12-10) — single-DB-clock circuit
-- breaker for the per-exchange 429 cooldown.
--
-- Background.
--   The worker's circuit breaker (services/job_worker.py) stamps
--   api_keys.last_429_at on a 429 and defers subsequent jobs for that key
--   until the per-exchange cooldown expires. Pre-fix, BOTH ends used a
--   Python wall clock:
--     * _stamp_429 wrote last_429_at = datetime.now() on the STAMPING
--       replica's clock (a direct table().update()).
--     * _check_circuit_breaker computed
--       remaining = cooldown - (datetime.now() - last_429_at) on the
--       CHECKING replica's clock.
--   On Railway these are distinct containers with no DB-side now()
--   normalization, so the subtraction mixes two wall clocks. If the
--   checker's clock runs ahead, `remaining` goes negative early and the
--   breaker releases INSIDE the rate-limit window → a fresh 429 / IP-ban
--   risk (the exact storm the breaker exists to damp); if behind, jobs
--   over-defer and each defer decrements attempts (churn). A prior change
--   re-read last_429_at fresh from the DB, but that only fixed STALENESS —
--   the value re-read is still a stamping-replica wall-clock timestamp
--   compared against the checking replica's datetime.now(). The "drift is
--   sub-second" code comment was a risk-acceptance, not a fix.
--
--   update_api_key_rate_limit (mig 111) already stamps with the DB clock,
--   but it asserts caller ownership (_assert_owner) and applies a 60s dedup
--   + audit row for the USER-facing grief path — neither fits the
--   service-role worker breaker (which must stamp any key it processes and
--   always reset the cooldown to the latest 429). So this migration adds
--   two small, dedicated SECURITY DEFINER RPCs that put BOTH the stamp and
--   the remaining-time computation on the single DB clock.
--
-- Scope.
--   1. stamp_api_key_429(p_api_key_id) — UPDATE last_429_at = now() (DB
--      clock). No dedup/audit/owner-assert: matches the worker's prior
--      always-stamp-latest behavior, just sourced from the DB clock.
--   2. api_key_cooldown_remaining(p_api_key_id, p_cooldown_seconds) — return
--      remaining cooldown seconds (0 if expired / no stamp / key gone),
--      computed as cooldown - EXTRACT(EPOCH FROM (now() - last_429_at))
--      ENTIRELY in the DB. Because the stamp (now()) and the comparison
--      (now()) are both the DB clock, cross-replica wall-clock skew is gone.
--   3. REVOKE ALL FROM PUBLIC, anon, authenticated (service_role EXECUTE via
--      schema default privilege, matching the compute_jobs RPC posture).
--
-- Production impact.
--   Additive (two new functions). The worker is rewired to call these in
--   the same PR; equity_reconstruction.py's _stamp_429 callers inherit the
--   DB-clock stamp via the unchanged _stamp_429 signature. No schema change.

SET LOCAL search_path = public, pg_catalog;

-- --------------------------------------------------------------------------
-- STEP 1: stamp_api_key_429 — stamp last_429_at = now() on the DB clock.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION stamp_api_key_429(
  p_api_key_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_api_key_id IS NULL THEN
    RAISE EXCEPTION 'stamp_api_key_429: p_api_key_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Defense-in-depth ownership gate, mirroring the sibling user-facing stamp
  -- update_api_key_rate_limit (mig 111). _assert_owner is a NO-OP under the
  -- service role (auth.uid() IS NULL → returns early), so the worker — the
  -- sole intended caller — pays nothing. Its only effect is to block a
  -- cross-tenant write (stamping ANY user's last_429_at to force-trip their
  -- breaker / DoS their syncs) should EXECUTE ever be re-granted to
  -- authenticated by a future migration. Without it the cross-tenant write
  -- path would be gated by the REVOKE alone — a single line, in a table with
  -- a documented history of REVOKEs silently no-opping (mig 027).
  PERFORM _assert_owner('api_keys'::regclass, p_api_key_id, 'stamp_api_key_429');

  -- Always stamp the latest 429 from the DB clock. A missing row (key
  -- deleted between claim and stamp) is a no-op: the breaker stamp is
  -- best-effort and must never convert a 429 into a hard error that would
  -- fail the job.
  UPDATE api_keys
     SET last_429_at = now()
   WHERE id = p_api_key_id;
END;
$$;

COMMENT ON FUNCTION stamp_api_key_429(UUID) IS
  'NEW-C12-10 (CL10): stamps api_keys.last_429_at = now() using the DB clock '
  'so the worker circuit breaker (see api_key_cooldown_remaining) compares a '
  'single clock across Railway replicas. No per-key dedup/audit/owner-assert '
  '(distinct from update_api_key_rate_limit, mig 111, which serves the '
  'user-facing rate-limit grief path). Service-role worker only.';

REVOKE ALL ON FUNCTION stamp_api_key_429(UUID) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 2: api_key_cooldown_remaining — remaining cooldown, single DB clock.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api_key_cooldown_remaining(
  p_api_key_id       UUID,
  p_cooldown_seconds INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_last_429_at TIMESTAMPTZ;
  v_remaining   NUMERIC;
BEGIN
  IF p_api_key_id IS NULL THEN
    RAISE EXCEPTION 'api_key_cooldown_remaining: p_api_key_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_cooldown_seconds IS NULL OR p_cooldown_seconds < 0 THEN
    RAISE EXCEPTION 'api_key_cooldown_remaining: p_cooldown_seconds must be >= 0, got %', p_cooldown_seconds
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT last_429_at
    INTO v_last_429_at
    FROM api_keys
    WHERE id = p_api_key_id;

  -- No stamp (or key gone) → no active cooldown.
  IF NOT FOUND OR v_last_429_at IS NULL THEN
    RETURN 0;
  END IF;

  -- Both now() and last_429_at are DB-clock values → no cross-container
  -- wall-clock skew. CEIL so we never under-report and release the breaker a
  -- fraction early.
  v_remaining := p_cooldown_seconds - EXTRACT(EPOCH FROM (now() - v_last_429_at));
  IF v_remaining <= 0 THEN
    RETURN 0;
  END IF;
  RETURN CEIL(v_remaining)::INTEGER;
END;
$$;

COMMENT ON FUNCTION api_key_cooldown_remaining(UUID, INTEGER) IS
  'NEW-C12-10 (CL10): returns remaining circuit-breaker cooldown seconds '
  '(0 if expired / no stamp / key missing) computed ENTIRELY with the DB '
  'clock (now() - last_429_at), so a stamp written by one Railway replica '
  'and a check run on another are compared against one clock — eliminating '
  'the wall-clock-skew window where the breaker released early into a 429 '
  'storm. Paired with stamp_api_key_429. Service-role worker only.';

REVOKE ALL ON FUNCTION api_key_cooldown_remaining(UUID, INTEGER) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- Verification — signatures + validations + no-row path WITHOUT a seed.
-- (api_keys.user_id → profiles.id NOT NULL + encrypted-credential NOT NULL
-- columns make an inline seed abort the migration; the stamp+remaining math
-- against a seeded key is pinned by tests/test_job_worker.py wiring tests +
-- the live-DB path.)
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_remaining          INTEGER;
  v_raised_stamp_null  BOOLEAN := false;
  v_raised_cd_null     BOOLEAN := false;
  v_raised_cd_negative BOOLEAN := false;
BEGIN
  -- No-row path → 0 (no active cooldown for an unknown key).
  v_remaining := api_key_cooldown_remaining(gen_random_uuid(), 120);
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'CL10 verification failed: api_key_cooldown_remaining(unknown key) returned % (expected 0)', v_remaining;
  END IF;

  -- stamp_api_key_429(NULL) → invalid_parameter_value.
  BEGIN
    PERFORM stamp_api_key_429(NULL);
  EXCEPTION
    WHEN invalid_parameter_value THEN
      v_raised_stamp_null := true;
  END;
  IF NOT v_raised_stamp_null THEN
    RAISE EXCEPTION 'CL10 verification failed: stamp_api_key_429(NULL) did not raise invalid_parameter_value';
  END IF;

  -- api_key_cooldown_remaining(NULL, ...) → invalid_parameter_value.
  BEGIN
    PERFORM api_key_cooldown_remaining(NULL, 120);
  EXCEPTION
    WHEN invalid_parameter_value THEN
      v_raised_cd_null := true;
  END;
  IF NOT v_raised_cd_null THEN
    RAISE EXCEPTION 'CL10 verification failed: api_key_cooldown_remaining(NULL,120) did not raise invalid_parameter_value';
  END IF;

  -- Negative cooldown → invalid_parameter_value.
  BEGIN
    PERFORM api_key_cooldown_remaining(gen_random_uuid(), -1);
  EXCEPTION
    WHEN invalid_parameter_value THEN
      v_raised_cd_negative := true;
  END;
  IF NOT v_raised_cd_negative THEN
    RAISE EXCEPTION 'CL10 verification failed: api_key_cooldown_remaining(...,-1) did not raise invalid_parameter_value';
  END IF;
END;
$verify$;
