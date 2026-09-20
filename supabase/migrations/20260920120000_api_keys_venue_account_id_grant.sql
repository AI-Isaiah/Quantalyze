-- ===========================================================================
-- Migration: GRANT SELECT (venue_account_id) ON api_keys TO authenticated
-- ===========================================================================
-- Phase 164.5.3 (MT5CREDS) — a founder viewing a wizard-created MT5 key's
-- card currently cannot tell WHICH MT5 account it belongs to; every MT5 key
-- falls back to the optional nickname field and several accounts render
-- indistinguishably.
--
-- `api_keys.venue_account_id` ALREADY EXISTS — migration 20260812083206
-- (Phase 154 / WIZCONT-02): a nullable text column holding the non-secret
-- MT5 broker login, generically named, MT5-only today (ccxt's
-- ValidationResult carries no account-identity field, so ccxt venues stay
-- NULL). It is populated only by the wizard's SECURITY DEFINER
-- create_wizard_strategy RPC. It is NOT currently readable by any client —
-- no GRANT extends migration 027's REVOKE-then-allowlist to this column.
--
-- ⛔ THIS MIGRATION ONLY CHANGES READABILITY. No column is added, no row is
-- read, no row is written. It extends the allowlist introduced in migration
-- 20260410225608 (SEC-005) — see also migration 20260420103151 (068) for the
-- last_429_at precedent, which this migration is modeled on verbatim. RLS
-- still applies — callers only see their own rows via the existing
-- user_id-scoped policy, unchanged by this migration.
--
-- ⛔ OVERRIDES AN EXPLICIT PROHIBITION IN SHIPPED CODE, DELIBERATELY. The
-- venue_account_id column COMMENT (20260812083206) says: "Never echo this
-- value to the browser (UI-SPEC): non-secret is not the same as publish."
-- Founder decision D-01-PRIME (2026-09-20, recorded in full in
-- 164.5.3-CONTEXT.md's "⛔ AMENDMENT" section) deliberately overrides that
-- prohibition: the harm it named — a browser session forging the value via
-- the SECURITY DEFINER RPC and colliding two different accounts onto one
-- row — is CLOSED (Phase 156 / 20260814120000 withdrew `authenticated`
-- EXECUTE on create_wizard_strategy, so the RPC is unreachable from a
-- browser; the value can only be the one the server derived). What
-- survives is a provenance residual, NOT confidentiality: the database
-- cannot PROVE the value came from a live broker probe, only that the
-- server (not the browser) supplied it. The row is RLS-scoped to its
-- owner, so publishing it discloses nothing across a tenant boundary. See
-- 164.5.3-CONTEXT.md for the full reasoning — not restated here.
--
-- After this migration, src/lib/constants.ts → API_KEY_USER_COLUMNS_ARR (and
-- its derived API_KEY_USER_COLUMNS literal type) AND src/lib/types.ts →
-- the ApiKey interface must both add "venue_account_id". All three ship
-- together (this migration + constants.ts + types.ts) — the same
-- three-way sync contract every prior GRANT-extension migration
-- (066/068/075) established.
--
-- ROLLBACK: `REVOKE SELECT (venue_account_id) ON api_keys FROM authenticated;`
-- and remove "venue_account_id" from API_KEY_USER_COLUMNS_ARR + ApiKey.
-- Safe to revert: this migration changes readability only, nothing else.
-- ===========================================================================

-- Guarded pre-check: this migration ONLY extends a GRANT on a column that
-- must already exist (20260812083206, Phase 154/WIZCONT-02). This must
-- NEVER fire at HEAD — it exists so a future re-order, or a stripped-down
-- TEST restore that dropped 20260812083206 out of the applied set, fails
-- loud instead of silently GRANTing SELECT on a column that isn't there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'api_keys'
       AND column_name = 'venue_account_id'
  ) THEN
    RAISE EXCEPTION 'Migration 20260920120000 failed: public.api_keys.venue_account_id does not exist. It must be created by migration 20260812083206 (Phase 154/WIZCONT-02) before this migration can extend its GRANT.';
  END IF;
END
$$;

GRANT SELECT (venue_account_id) ON api_keys TO authenticated;

-- ===========================================================================
-- Self-verify
-- ===========================================================================
DO $$
BEGIN
  IF NOT has_column_privilege('authenticated', 'api_keys', 'venue_account_id', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20260920120000 failed: authenticated lacks SELECT on api_keys.venue_account_id';
  END IF;

  -- Anti-leak check: anon MUST NOT have the grant. If it does, migration
  -- 20260410225608's REVOKE is not holding — abort and flag.
  IF has_column_privilege('anon', 'api_keys', 'venue_account_id', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20260920120000 failed: anon unexpectedly has SELECT on api_keys.venue_account_id (migration 20260410225608 REVOKE broken?)';
  END IF;

  RAISE NOTICE 'Migration 20260920120000: authenticated can SELECT api_keys.venue_account_id; anon cannot.';
END
$$;
