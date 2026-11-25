-- ============================================================================
-- Phase 225 ONEACCOUNTONCE, plan 13 (CONN-03, PR-2b-1): the OWNER of an api_keys row may
-- read its venue_server.
--
-- WHAT: one column grant. `GRANT SELECT (venue_server) ON public.api_keys TO
-- authenticated`, and the column COMMENT re-stamped so it stops saying the column is
-- ungranted. Nothing else changes: no column, no index, no function, no policy.
--
-- WHY (CONTEXT Q6 item 1, founder ruling 2026-11-25): two keys with the same login on two
-- different set servers never share an identity token, in Python (account_identity_tokens),
-- in TypeScript (accountIdentityTokens) and in SQL (commit_scenario_batch account_edges).
-- Every TypeScript caller of accountIdentityTokens reads api_keys as `authenticated`
-- through the API_KEY_USER_COLUMNS allowlist, and venue_server was ungranted, so the
-- TypeScript twin could not become server-aware until this column is readable. If it stayed
-- login-only, commit_scenario_batch (SECURITY DEFINER) would refuse the browser's
-- fingerprint for every owner holding one login on two servers.
--
-- ⛔ THIS REVERSES PLAN 01's POSTURE, ON PURPOSE. Migration 20261123180000 left the column
-- ungranted on RESEARCH F-4's reason "no UI reads it", and its gate arm 6v-no-grant called
-- that "founder ruling Q2". CONTEXT Q2 records only that the server is stored in plaintext
-- because it is not a credential. F-4's reason no longer holds once the TypeScript twin
-- reads the column. Plan 13 Task 1 put the choice in front of the founder, who chose
-- "Owner-only read (Recommended)" on 2026-11-25 (CONTEXT Q6). Row scope is the existing
-- owner-only RLS on api_keys, unchanged, so one user never reads another's server.
--
-- ⛔ NO WRITE AND NO ANON. No INSERT or UPDATE privilege is issued to any browser role, so
-- the analytics worker and the service-role connect writers stay the only writers of the
-- column (CONTEXT Q2), and anon is granted nothing. The shape is the one
-- 20260920120000 used for venue_account_id and 20261010120000 used for the BTCUSDVIEW
-- columns.
--
-- ⛔⛔ DEPLOY ORDER. THIS PR (PR-2b-1) CARRIES THE GRANT AND NOTHING THAT READS IT. The code
-- that adds venue_server to API_KEY_USER_COLUMNS_ARR (src/lib/constants.ts) and selects it
-- ships in PR-2b-2 and merges ONLY AFTER PROD HAS APPLIED THIS MIGRATION. A roster ahead of
-- the GRANT makes every user-scoped api_keys SELECT answer PostgREST 42501 "permission
-- denied for column", and getUserApiKeys deliberately throws, so the allocations and
-- exchanges pages hard-error for every allocator. A merge touching supabase/migrations/**
-- applies to shared TEST and then to PROD with no human stop, and the Vercel build has no
-- ordering against it, so the split into two PRs is the control and careful sequencing is
-- not.
--
-- ROLLBACK ORDER (the same hazard, in reverse): revert the roster and the TypeScript reads
-- FIRST and let that deployment land, THEN run
-- supabase/migrations/down/20261125132334-rollback.sql.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue and none
-- of its data, and a failed TEST apply blocks the PROD apply, so the verify block below
-- reads pg_catalog only (scripts/lint-migration-data-dependence.mjs). It reads no row.
--
-- No function is added or redefined, so no SECURITY DEFINER / search_path rule applies and
-- there is no CREATE OR REPLACE to re-base.
--
-- Transaction style: NO explicit transaction statements (migration-reviewer invariant 14;
-- Supabase wraps each migration). SET LOCAL lock_timeout applies to that wrap.
--
-- Rollback (manual, off the auto-apply path):
-- supabase/migrations/down/20261125132334-rollback.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1 - the owner-only column grant. authenticated only; nothing for anon; no
-- INSERT or UPDATE for anyone in the browser.
-- --------------------------------------------------------------------------
GRANT SELECT (venue_server) ON public.api_keys TO authenticated;

-- --------------------------------------------------------------------------
-- STEP 2 - re-stamp the COMMENT of 20261123180000: every sentence is kept except the last,
-- which said the column is "NOT granted to anon or authenticated", false from here on.
-- --------------------------------------------------------------------------
COMMENT ON COLUMN public.api_keys.venue_server IS
  'Phase 225 ONEACCOUNTONCE (CONN-03, founder ruling Q2). The normalised broker server of an MT5 key (trimmed, lower-cased), stored beside the bare login in venue_account_id so the same login on two different brokers is two different accounts. PLAINTEXT by founder ruling: a broker server name is not a credential. NULL means "not captured yet" and every app fence treats NULL as a wildcard that matches any server; a blank or over-128-character value is refused by api_keys_venue_server_valid. MT5 only. READABLE BY authenticated through a column grant (20261125132334, plan 13, founder answer "Owner-only read" 2026-11-25), scoped to the key''s owner by the existing owner-only RLS on api_keys, so the TypeScript identity twin reads the server the way it reads venue_account_id. anon holds NO privilege on it, and no browser role may write it: the analytics worker and the service-role connect writers are its only writers.';

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read. Asserted: authenticated can SELECT the column and can neither INSERT nor
-- UPDATE it, and anon holds none of the three. The twins of the gate arms that mutate
-- these privileges run against the lane AFTER this migration has applied, so asserting the
-- post-grant state here cannot abort a twin's apply.
DO $verify$
BEGIN
  IF NOT has_column_privilege('authenticated', 'public.api_keys', 'venue_server', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261125132334 failed: authenticated lacks SELECT on api_keys.venue_server, so the TypeScript identity twin could not read the broker server';
  END IF;

  IF has_column_privilege('authenticated', 'public.api_keys', 'venue_server', 'INSERT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'venue_server', 'UPDATE') THEN
    RAISE EXCEPTION 'Migration 20261125132334 failed: authenticated unexpectedly holds INSERT or UPDATE on api_keys.venue_server. The analytics worker and the service-role connect writers must stay its only writers';
  END IF;

  IF has_column_privilege('anon', 'public.api_keys', 'venue_server', 'SELECT')
     OR has_column_privilege('anon', 'public.api_keys', 'venue_server', 'INSERT')
     OR has_column_privilege('anon', 'public.api_keys', 'venue_server', 'UPDATE') THEN
    RAISE EXCEPTION 'Migration 20261125132334 failed: anon unexpectedly holds a privilege on api_keys.venue_server (migration 20260410225608 REVOKE broken?)';
  END IF;

  RAISE NOTICE 'Migration 20261125132334: authenticated can SELECT api_keys.venue_server and write none of it, anon holds none.';
END
$verify$;
