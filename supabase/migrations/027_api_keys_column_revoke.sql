-- Migration 027: SEC-005 — column-level REVOKE on api_keys encrypted columns.
--
-- Why this migration exists
-- -------------------------
-- `api_keys` stores envelope-encrypted exchange credentials: a per-row DEK
-- wrapped under a KEK (stored in Supabase Vault), with the credential JSON
-- encrypted under the DEK. The Python analytics service on Railway is the
-- ONLY caller that should ever read the encrypted columns; it uses the
-- service-role client to unwrap the DEK and decrypt.
--
-- Today the `api_keys` table inherits Supabase's default
-- `GRANT ALL ON TABLE api_keys TO anon, authenticated`. RLS scopes rows to
-- `user_id = auth.uid()`, but a compromised user account (or an XSS-captured
-- JWT) can still SELECT its own encrypted columns. That's a violation of
-- defense-in-depth: the user does not need ciphertext to use the product,
-- so the user-scoped client should not be able to read it.
--
-- Fix pattern (template: migration 020)
-- -------------------------------------
-- 1. REVOKE SELECT on api_keys from anon + authenticated at the TABLE level.
--    This nukes SELECT on every column. Column-level REVOKE is a silent
--    no-op when the role has SELECT via a broader table-level grant (the
--    same bug that broke migrations 012 and 017 — discovered 2026-04-09).
-- 2. GRANT SELECT (<allowlist>) back for the non-sensitive metadata columns
--    the user-scoped client actually projects. The allowlist is defined in
--    `src/lib/constants.ts::API_KEY_USER_COLUMNS` and must stay in sync.
-- 3. Self-verifying DO block that RAISES EXCEPTION if the intended state is
--    not achieved, rolling back the transaction. Never again a silent no-op.
--
-- Allowlist rationale (per-column)
-- --------------------------------
-- Safe for user-scoped read (the wizard, ApiKeyManager, and exchanges list
-- all project these):
--   id                   — primary key, used for linking strategies → keys
--   user_id              — FK (the user already knows their own id; not PII)
--   exchange             — 'binance' | 'okx' | 'bybit', non-sensitive label
--   label                — user-chosen display name
--   is_active            — boolean status flag
--   sync_status          — 'idle' | 'syncing' | 'complete' | 'failed'
--   last_sync_at         — timestamp, surfaced in the UI
--   account_balance_usdt — displayed alongside the key, non-sensitive number
--   created_at           — join date, displayed in the UI
--
-- Service-role only (never exposed to anon/authenticated):
--   api_key_encrypted      — Fernet ciphertext blob of the credential JSON
--   api_secret_encrypted   — legacy column, currently NULL
--   passphrase_encrypted   — legacy column, currently NULL
--   dek_encrypted          — KEK-wrapped per-row DEK
--   nonce                  — legacy column, currently NULL (Fernet internal)
--
-- Non-sensitive but NOT in the allowlist (future expansion requires a new
-- migration extending the grant):
--   sync_started_at, sync_error, kek_version
--
-- Caller impact
-- -------------
-- Full audit of `from("api_keys")` call sites in src/** (done 2026-04-10):
--   - src/lib/queries.ts:562 getUserApiKeys — projects API_KEY_USER_COLUMNS ✓
--   - src/components/strategy/ApiKeyManager.tsx:49 — WAS .select("*"); fixed
--     to projects API_KEY_USER_COLUMNS in the same PR as this migration.
--   - src/components/exchanges/AllocatorExchangeManager.tsx:146 — now projects
--     API_KEY_USER_COLUMNS (previously a hardcoded 8-column string).
--   - src/components/strategy/SyncProgress.tsx:97 — projects only "exchange".
--   - INSERT/DELETE paths: unaffected (RLS still gates via api_keys_owner).
--
-- The Python analytics service uses the service-role client via
-- `get_supabase()` (analytics-service/routers/*.py) — it retains full
-- table access and can still read the encrypted columns to decrypt them.

-- --------------------------------------------------------------------------
-- STEP 1: drop the broad table-level SELECT
-- --------------------------------------------------------------------------
REVOKE SELECT ON api_keys FROM anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 2: grant back the allowlist (must match API_KEY_USER_COLUMNS in
-- src/lib/constants.ts)
-- --------------------------------------------------------------------------
GRANT SELECT (
  id,
  user_id,
  exchange,
  label,
  is_active,
  sync_status,
  last_sync_at,
  account_balance_usdt,
  created_at
) ON api_keys TO authenticated;

-- Note: no anon grant. The `api_keys` table has no public-read use case.
-- anon access is blocked at both the RLS layer (api_keys_owner requires
-- `auth.uid()`, which is NULL for anon) and now the column-grant layer.

-- --------------------------------------------------------------------------
-- STEP 3: document the protected columns
-- --------------------------------------------------------------------------
COMMENT ON COLUMN api_keys.api_key_encrypted IS
  'Encrypted credential payload (Fernet ciphertext). Table-level SELECT revoked from anon/authenticated per migration 027. Access via service-role client only.';
COMMENT ON COLUMN api_keys.api_secret_encrypted IS
  'Encrypted. Revoked per migration 027. Currently NULL for all rows (payload bundled into api_key_encrypted).';
COMMENT ON COLUMN api_keys.passphrase_encrypted IS
  'Encrypted. Revoked per migration 027. Currently NULL for all rows.';
COMMENT ON COLUMN api_keys.dek_encrypted IS
  'KEK-wrapped per-row DEK (Fernet). Revoked per migration 027. Service-role only.';
COMMENT ON COLUMN api_keys.nonce IS
  'Legacy wrapper metadata. Revoked per migration 027. Currently NULL (Fernet handles nonce internally).';

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying assertion — encrypted columns must NOT be readable
-- --------------------------------------------------------------------------
-- If any of the protected columns still has anon or authenticated SELECT,
-- RAISE and roll back the whole transaction. Same self-verifying pattern
-- as migration 020, which exists specifically to prevent the silent no-op
-- that broke migrations 012 and 017.
DO $$
DECLARE
  leaks int;
BEGIN
  SELECT count(*) INTO leaks
  FROM information_schema.column_privileges
  WHERE table_schema = 'public'
    AND table_name   = 'api_keys'
    AND column_name  IN ('api_key_encrypted', 'api_secret_encrypted', 'passphrase_encrypted', 'dek_encrypted', 'nonce')
    AND grantee      IN ('anon', 'authenticated')
    AND privilege_type = 'SELECT';

  IF leaks > 0 THEN
    RAISE EXCEPTION
      'Migration 027 failed: % anon/authenticated SELECT privileges still exist on api_keys encrypted columns. Rolling back.',
      leaks;
  END IF;
END
$$;

-- --------------------------------------------------------------------------
-- STEP 5: self-verifying assertion — allowlist columns must still be readable
-- --------------------------------------------------------------------------
-- If the REVOKE-then-GRANT pattern accidentally dropped coverage for one of
-- the allowlist columns, the ApiKeyManager and exchanges UI would break at
-- runtime and the bug would only surface on the next page load. Better to
-- fail here.
DO $$
DECLARE
  missing int;
BEGIN
  SELECT count(*) INTO missing
  FROM (
    VALUES
      ('id'), ('user_id'), ('exchange'), ('label'), ('is_active'),
      ('sync_status'), ('last_sync_at'), ('account_balance_usdt'), ('created_at')
  ) AS expected(col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name   = 'api_keys'
      AND column_name  = expected.col
      AND grantee      = 'authenticated'
      AND privilege_type = 'SELECT'
  );

  IF missing > 0 THEN
    RAISE EXCEPTION
      'Migration 027 failed: % allowlist columns lost authenticated SELECT coverage. Rolling back.',
      missing;
  END IF;
END
$$;
