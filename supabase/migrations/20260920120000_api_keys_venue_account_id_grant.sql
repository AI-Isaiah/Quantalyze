-- ===========================================================================
-- Migration: GRANT SELECT (venue_account_id) ON api_keys TO authenticated
-- ===========================================================================
--
-- ⛔⛔ DEPLOY ORDER — READ BEFORE MERGING. THIS MIGRATION MUST BE LIVE ON PROD
-- BEFORE THE VERCEL DEPLOYMENT THAT ADDS "venue_account_id" TO
-- API_KEY_USER_COLUMNS_ARR (src/lib/constants.ts) AND TO THE ApiKey INTERFACE
-- (src/lib/types.ts). Same hazard the DEPLOY ORDER header of migration
-- 20260812083206_api_keys_venue_account_id.sql documents for this same
-- column, same remedy.
--
-- Merging supabase/migrations/** to `main` fires the Supabase auto-apply AND
-- the Vercel build, with NO ordering between them — and per CLAUDE.md, the
-- Supabase side runs `apply-test` on shared TEST first, then PROD's `apply`
-- behind the `Production` environment's human reviewer gate, which is a
-- human-length approval window, not seconds. If the Vercel deployment wins
-- that race, every user-scoped `api_keys` SELECT that projects
-- `venue_account_id` via `API_KEY_USER_COLUMNS_ARR` — the four live call
-- sites: src/lib/queries.ts::getUserApiKeys and ::getStrategylessActiveKeys,
-- ApiKeyManager::loadKeys, and AllocatorExchangeManager's client refetch —
-- answers PostgREST 42501 "permission denied for column". `getUserApiKeys`
-- does not degrade on that error — it deliberately THROWS so the page error
-- boundary fires — so the allocations and exchanges pages hard-error for
-- EVERY allocator, MT5 or not, for the whole approval window.
--
-- APPLY ORDER: get this migration approved and green on PROD FIRST, confirm
-- green, and only THEN let the Vercel production promotion land — or split
-- the merge into two PRs (this migration first, applied and confirmed; the
-- constants.ts/types.ts change second). The ordering cannot be enforced from
-- inside this file; record whichever is chosen in the ship notes.
--
-- ROLLBACK ORDER (the same hazard, in reverse): revert constants.ts and
-- types.ts first — dropping "venue_account_id" from API_KEY_USER_COLUMNS_ARR
-- and from the ApiKey interface — and let THAT deployment land BEFORE issuing
-- `REVOKE SELECT (venue_account_id) ON api_keys FROM authenticated;`. Issuing
-- the REVOKE first, while a still-deployed frontend keeps projecting the
-- column, reproduces the identical 42501 outage in reverse.
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
-- venue_account_id column COMMENT (20260812083206, corrected in place by
-- this migration below) said: "Never echo this value to the browser
-- (UI-SPEC): non-secret is not the same as publish." Founder decision
-- D-01-PRIME (2026-09-20, recorded in full in 164.5.3-CONTEXT.md's "⛔
-- AMENDMENT" section) deliberately overrides that prohibition.
--
-- ⛔ HONEST ACCOUNTING OF THE DELTA — an earlier draft of this header said no
-- confidentiality change occurred. THAT OVERSTATED IT. Migration 027's
-- threat model is stated as "a compromised user account (or an XSS-captured
-- JWT)"; under exactly that threat an attacker could already read `exchange`
-- and `label`, and after this migration also reads the MT5 broker account
-- number, rendered unmasked on the key card. That is a confidentiality
-- change. It is accepted here as a small, BOUNDED delta rather than denied:
-- migration 027's own disqualifying test — "the user does not need it to use
-- the product" — does not hold here, because the founder demonstrably DOES
-- need the identifier to tell same-venue MT5 cards apart, which is the
-- defect this phase exists to fix. The row stays RLS-scoped to its owner, so
-- this discloses nothing ACROSS a tenant boundary — only to the one
-- credential holder who can already read the same number off their own
-- broker terminal.
--
-- What IS closed is the forgery vector the original prohibition was written
-- against — a browser session forging the value via a wizard SECURITY
-- DEFINER RPC and colliding two different accounts onto one row. FOUR
-- independent fences close it, not one, so the argument is over-determined:
--   1. Direct client INSERT on api_keys is fully revoked (migration
--      20260823120000_revoke_api_keys_insert.sql).
--   2. Direct client UPDATE on api_keys is fully revoked, with no re-grant
--      (migration 20260810120000_lock_api_keys_exchange_column.sql).
--   3. `authenticated` holds NO EXECUTE on either wizard RPC —
--      create_wizard_strategy or add_wizard_composite_key (migration
--      20260814120000_wizard_rpcs_revoke_authenticated.sql). ⚠️ That
--      migration's own header names this REVOKE as NOT DURABLE: a future
--      migration that DROPs and re-CREATEs either RPC without re-issuing the
--      REVOKE/GRANT pair silently re-grants both `anon` and `authenticated`
--      via Supabase's `pg_default_acl`. Assertion 5h in
--      supabase/tests/test_api_keys_exchange_not_user_writable.sql is the
--      durable, self-arming backstop for that regression class — re-verify
--      it holds before leaning on this fence in isolation.
--   4. `scrub_client_supplied_venue_account_id` NULLs any client-supplied
--      venue_account_id on a direct table INSERT for every current_user
--      outside the postgres/service_role/supabase_admin allowlist (migration
--      20260812083206, section 4).
-- A future reader who finds one fence re-opened — most plausibly #3, per its
-- own warning above — should re-check the remaining three before concluding
-- this override's premise has collapsed.
--
-- ⛔ THE PROVENANCE GUARANTEE, STATED PRECISELY — stronger than "the server
-- supplied it" alone, but still short of "venue-confirmed". The value is
-- persisted ONLY after the credentials it is derived from have authenticated
-- read-only against the live broker (the wizard create path:
-- mt5_probe.py's assert_expected_login); on a credential update it is
-- re-derived by decrypting the row's own stored ciphertext, never accepted
-- as a fresh caller-supplied string with nothing behind it. The real
-- guarantee is: a login this server has authenticated credentials for — the
-- caller can choose WHICH of their own working broker logins to connect, but
-- cannot mint a login they do not hold. ⚠️ The CR-01 provenance residual
-- (164.5.3-CONTEXT.md AMENDMENT, D-01-PRIME) stays OPEN and is NOT closed by
-- this migration — the database still cannot independently PROVE the value
-- came from a live probe, only that a server-side path derived it. See
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
-- Column COMMENT — override, recorded honestly (finding 4, 164.5.3-REVIEW.md)
-- ===========================================================================
-- CATALOG-ONLY, idempotent, safe on every database (PROD, TEST, local, CI
-- alike): a COMMENT ON COLUMN reads no rows and cannot fail the guarded
-- pre-check or the self-verify block above/below. It re-stamps the comment
-- migration 20260812083206 wrote, which this migration's GRANT statement
-- above makes partly false (it said this column is unreadable by
-- authenticated, and said never to echo it to the browser). Left
-- uncorrected, the catalogue would keep asserting a prohibition this
-- migration deliberately overrides.
COMMENT ON COLUMN public.api_keys.venue_account_id IS
  'Phase 154/WIZCONT-02, RE-STAMPED by 164.5.3/MT5CREDS (founder decision '
  'D-01-PRIME, 2026-09-20; full reasoning in 164.5.3-CONTEXT.md AMENDMENT '
  'section, not restated here). NON-SECRET account identity for the '
  'credential in this row: the MT5 broker login today, which '
  'analytics-service/services/mt5_probe.py asserts against the gateway at '
  'validation time. It is an ACCOUNT NUMBER, not a credential. The secret '
  'half lives in api_key_encrypted and never comes near this column. '
  'TRUST BOUNDARY, STATED HONESTLY: DO NOT CALL THIS VALUE '
  'VENUE-CONFIRMED. What is enforced, by FOUR independent fences (see the '
  'header of this migration file for the full argument): a direct client '
  'INSERT is scrubbed to NULL by the scrub_client_supplied_venue_account_id '
  'trigger (20260812083206); direct client INSERT and UPDATE on api_keys '
  'are both fully revoked (20260823120000, 20260810120000 respectively); '
  'and authenticated holds NO EXECUTE on either wizard RPC (20260814120000), '
  'though that REVOKE is NOT durable across a future DROP+CREATE of either '
  'RPC unless the REVOKE/GRANT pair is re-issued in the same change (see '
  'the header of that migration). What is NOT enforced: the value has no '
  'in-database oracle. The real guarantee is a login the server has '
  'authenticated credentials for. The value is persisted only after the '
  'credentials it is derived from authenticated read-only against the live '
  'broker at connect time, or by decrypting the stored ciphertext already '
  'on this same row on an update, never accepted as a fresh caller-supplied '
  'string with no server-side step behind it. A caller can choose which of '
  'their own working broker logins to connect; they cannot mint one they '
  'do not hold. Treat the value as what the server derived, not what the '
  'venue confirmed: the CR-01 provenance residual (164.5.3-CONTEXT.md '
  'AMENDMENT, D-01-PRIME) stays OPEN. '
  'NULL is the NORMAL value and means this venue exposes no stable '
  'non-secret account id at validation: every ccxt venue today, whose '
  'ValidationResult carries no account-identity field at all. That is why '
  'api_keys_user_exchange_venue_account_uniq is PARTIAL: under a total '
  'index every NULL would collide and no user could hold two ccxt keys. '
  'api_keys_venue_account_id_nonblank forbids blank and whitespace-only '
  'values, because a blank string is non-NULL and would otherwise be '
  'governed by that index as if it were a real identity, collapsing two '
  'DIFFERENT accounts onto one row. '
  'OVERRIDE, RECORDED HONESTLY (164.5.3/MT5CREDS, founder decision '
  'D-01-PRIME, 2026-09-20): the prior form of this comment said never to '
  'echo this value to the browser, and said it was not readable by anon or '
  'authenticated anyway. BOTH ARE NOW FALSE BY DESIGN. This migration '
  'GRANTs authenticated SELECT on this column so the key card can display '
  'it. That is a bounded confidentiality delta under the threat model '
  'migration 027 states: a compromised user account or an XSS-captured '
  'JWT can now also read this identifier, not just exchange/label. It is '
  'accepted because the founder demonstrably needs the identifier to tell '
  'same-venue MT5 cards apart, and because publishing discloses nothing '
  'ACROSS a tenant boundary, since RLS still scopes every row to its own '
  'owner. anon still has NO grant on this column: migration 20260410225608 '
  'REVOKE-then-allowlist governs it and anon is not on the allowlist.';

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
