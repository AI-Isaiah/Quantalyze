-- ============================================================================
-- ROLLBACK for 20261125132334_api_keys_venue_server_owner_read.sql
-- Phase 225 ONEACCOUNTONCE, plan 13 (CONN-03, PR-2b-1).
-- ============================================================================
-- Manual, off the auto-apply path. Run it against the database the marker query in
-- CLAUDE.md names. Run that query FIRST:
--
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
--
-- current_database() is `postgres` on BOTH projects and proves nothing; if the marker is
-- NULL, re-set it before running anything here.
--
-- ⛔ ROLL THE READERS BACK FIRST. Once PR-2b-2 has deployed, the browser's key-list
-- projection (API_KEY_USER_COLUMNS_ARR) and the TypeScript identity twin select
-- api_keys.venue_server. Issuing the REVOKE while that code is still deployed answers
-- PostgREST 42501 on every user-scoped api_keys SELECT, and getUserApiKeys deliberately
-- throws, so the allocations and exchanges pages hard-error for every allocator. Revert
-- and DEPLOY the roster and the reads, then run this file.
--
-- What it undoes: the authenticated SELECT grant on api_keys.venue_server, and the COMMENT
-- of the column, which returns to the text 20261123180000 wrote. It touches no data, no
-- constraint and no other privilege. The column and every value in it are KEPT.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records version
-- 20261125132334 as applied and `supabase db push` will not re-apply the migration. To
-- re-apply it, delete that ledger row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261125132334` against the intended
-- database, after the marker query above names that database).
--
-- The BEGIN and COMMIT are carried IN THIS FILE so the REVOKE, the COMMENT and the verify
-- happen whole or not at all (a migration carries none; this file is not auto-applied).
-- The DO block at the end is catalogue-only: it RAISEs, and so aborts the whole rollback,
-- if the grant survives or a browser role holds a write.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

REVOKE SELECT (venue_server) ON public.api_keys FROM authenticated;

COMMENT ON COLUMN public.api_keys.venue_server IS
  'Phase 225 ONEACCOUNTONCE (CONN-03, founder ruling Q2). The normalised broker server of an MT5 key (trimmed, lower-cased), stored beside the bare login in venue_account_id so the same login on two different brokers is two different accounts. PLAINTEXT by founder ruling: a broker server name is not a credential. NULL means "not captured yet" and every app fence treats NULL as a wildcard that matches any server; a blank or over-128-character value is refused by api_keys_venue_server_valid. MT5 only. NOT granted to anon or authenticated, and not part of the browser column allowlist.';

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF has_column_privilege('authenticated', 'public.api_keys', 'venue_server', 'SELECT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'venue_server', 'INSERT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'venue_server', 'UPDATE') THEN
    RAISE EXCEPTION 'Rollback 20261125132334 failed: authenticated still holds a privilege on api_keys.venue_server';
  END IF;
  IF has_column_privilege('anon', 'public.api_keys', 'venue_server', 'SELECT')
     OR has_column_privilege('anon', 'public.api_keys', 'venue_server', 'INSERT')
     OR has_column_privilege('anon', 'public.api_keys', 'venue_server', 'UPDATE') THEN
    RAISE EXCEPTION 'Rollback 20261125132334 failed: anon holds a privilege on api_keys.venue_server';
  END IF;

  RAISE NOTICE 'Rollback 20261125132334: the authenticated grant on api_keys.venue_server is revoked and the plan-01 COMMENT is restored. The column and its data are kept. The migration ledger row is left in place (see the header).';
END
$verify$;

COMMIT;
