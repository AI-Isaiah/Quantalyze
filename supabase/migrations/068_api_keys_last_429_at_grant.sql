-- ===========================================================================
-- Migration 068: GRANT SELECT (last_429_at) ON api_keys TO authenticated
-- ===========================================================================
-- ISSUE-006 fix: the rate_limited pill always rendered "retry in 0s"
-- because the client had no way to compute the retry countdown.
-- `api_keys.last_429_at` is stamped by the Python worker on ccxt 429s
-- (migration 032 STEP 4 + services/job_worker.py `stamp_last_429_at`),
-- but migration 027's column-level GRANTs do NOT include last_429_at, so
-- the user-scoped Supabase projection silently returns NULL.
--
-- This migration extends the allowlist introduced in migration 027 (see
-- also migration 066 STEP 5 for the sync_error precedent) to expose
-- `last_429_at` to authenticated readers. RLS still applies — callers
-- only see their own rows.
--
-- After this migration, the frontend constants file
-- (src/lib/constants.ts → API_KEY_USER_COLUMNS_ARR) must append
-- "last_429_at" to the projection tuple. Both changes ship together.
--
-- ROLLBACK: `REVOKE SELECT (last_429_at) ON api_keys FROM authenticated;`
-- and remove "last_429_at" from API_KEY_USER_COLUMNS_ARR. Safe to revert
-- because the column is not sensitive (it's a UTC timestamp of when the
-- last 429 hit — reveals nothing about exchange credentials).
-- ===========================================================================

GRANT SELECT (last_429_at) ON api_keys TO authenticated;

-- ===========================================================================
-- Self-verify
-- ===========================================================================
DO $$
BEGIN
  IF NOT has_column_privilege('authenticated', 'api_keys', 'last_429_at', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 068 failed: authenticated lacks SELECT on api_keys.last_429_at';
  END IF;

  -- Anti-leak check: anon MUST NOT have the grant. If it does, migration
  -- 027's REVOKE is not holding — abort and flag.
  IF has_column_privilege('anon', 'api_keys', 'last_429_at', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 068 failed: anon unexpectedly has SELECT on api_keys.last_429_at (migration 027 REVOKE broken?)';
  END IF;

  RAISE NOTICE 'Migration 068: ISSUE-006 grant verified — authenticated can SELECT api_keys.last_429_at.';
END
$$;
