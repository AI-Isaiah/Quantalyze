-- Gate A5: is the MT5 broker-server backfill done, so the server index may ship?
-- Phase 225 plan 12 (CONN-03, CONTEXT Q2 "column first, then the writers and the
-- backfill, then the index change"). READ-ONLY: SELECTs only, one per MCP call.
-- Run docs/runbooks/oneaccountonce/marker.sql FIRST and stop unless it names PROD.
-- Output is counts and cause classes only: no id, login, server or email.

-- ============================================================================
-- Census 1: live, active MT5 keys that still have no broker server.
-- PASSES at zero rows. A non-zero row is acceptable ONLY when the orchestrator
-- names its cause class in the report (below) and judges it: for example an
-- 'unstamped' key whose session cannot be built, or a key whose polls keep
-- failing. Anything not named blocks the index change.
--   unstamped                the poll never stamped the login (venue_account_id null)
--   marked_against_a_holder  the stamp was refused, so it carries a same-account marker
--   stamped_not_backfilled   the login is stamped, the poll has not filled the server
-- ============================================================================
SELECT CASE
         WHEN k.account_shared_with_api_key_id IS NOT NULL THEN 'marked_against_a_holder'
         WHEN k.venue_account_id IS NULL THEN 'unstamped'
         ELSE 'stamped_not_backfilled'
       END AS cause_class,
       k.sync_status AS last_sync_status,
       count(*) AS keys
  FROM public.api_keys k
 WHERE k.exchange = 'mt5'
   AND k.disconnected_at IS NULL
   AND k.is_active
   AND k.venue_server IS NULL
 GROUP BY 1, 2
 ORDER BY 1, 2;

-- ============================================================================
-- Census 2: did a daily poll run after the PR-2 deploy?
-- Replace the token {{PR2_DEPLOYED_AT}} by hand with the PR-2 Railway deploy time
-- as a UTC timestamp, for example 2026-12-01T06:00:00Z, keeping the quotes.
-- PASSES when a_poll_ran_after_deploy is true: at least one live active MT5 key
-- synced after the deploy, so the backfill code has had a poll to run in. It does
-- not prove every key was reached, which is what Census 1 is for; read the two
-- together. A NULL newest_mt5_last_sync_at (no live active MT5 key ever synced)
-- is not a pass.
-- ============================================================================
SELECT max(k.last_sync_at) AS newest_mt5_last_sync_at,
       '{{PR2_DEPLOYED_AT}}'::timestamptz AS pr2_deployed_at,
       coalesce(max(k.last_sync_at) > '{{PR2_DEPLOYED_AT}}'::timestamptz, false) AS a_poll_ran_after_deploy
  FROM public.api_keys k
 WHERE k.exchange = 'mt5'
   AND k.disconnected_at IS NULL
   AND k.is_active;
