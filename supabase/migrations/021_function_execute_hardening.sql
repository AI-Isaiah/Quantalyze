-- Migration 021: HARDEN EXECUTE grants on SECURITY DEFINER RPCs.
--
-- Why this migration exists
-- -------------------------
-- Migration 011 intended to restrict `send_intro_with_decision` to admins
-- by doing `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated`.
-- Migration 013 intended to restrict `latest_cron_success` to service_role
-- by doing `REVOKE ALL ... FROM PUBLIC; REVOKE ALL ... FROM authenticated`.
--
-- Both assumed `REVOKE ALL FROM PUBLIC` would drop the auto-grants that
-- Supabase's default-privileges event trigger adds for `anon`, `authenticated`,
-- and `service_role` on any new function in public. It doesn't. Those grants
-- are per-role entries, not PUBLIC entries, so `REVOKE FROM PUBLIC` leaves
-- them in place.
--
-- Audit at 2026-04-09 (via Supabase MCP + pg_proc.proacl):
--
--   proname                        | anon | auth | public | svc
--   -------------------------------+------+------+--------+-----
--   send_intro_with_decision       | YES  | YES  | no     | YES
--   sync_trades                    | YES  | YES  | no     | YES
--   latest_cron_success            | YES  | no   | no     | YES
--   handle_new_user                | YES  | YES  | no     | YES  (trigger-only, benign)
--   get_allocator_latest_batch_meta| no   | YES  | no     | YES  (correct)
--   get_allocator_recommendations  | no   | YES  | no     | YES  (correct)
--
-- Blast radius per function (what anon could do with the public anon key
-- via PostgREST `/rest/v1/rpc/<name>`):
--
-- * send_intro_with_decision — SECURITY DEFINER, ZERO internal auth check.
--   Lets anyone forge `contact_requests` + `match_decisions` for any
--   (allocator, strategy) pair with any `p_decided_by`. CRITICAL.
--
-- * sync_trades — SECURITY DEFINER, ZERO internal auth check. First line
--   is `DELETE FROM trades WHERE strategy_id = p_strategy_id`, followed
--   by an INSERT of the caller-supplied JSONB. Lets anyone wipe trades
--   for any strategy and replace them with arbitrary data. CRITICAL.
--
-- * latest_cron_success — SECURITY DEFINER, has an `is_admin` guard
--   inside the body that returns NULL for non-admins. Anon calling this
--   gets NULL. Low data-leak risk, but still an unintended exposure
--   surface. Medium.
--
-- * handle_new_user — trigger function called by an AFTER INSERT trigger
--   on auth.users. Directly calling it as anon errors with
--   "record 'new' is not assigned yet" because NEW is not a bound
--   parameter. Benign — left alone by this migration.
--
-- Caller impact
-- -------------
-- Both privileged callers use the service-role Supabase client:
--   - src/app/api/admin/match/send-intro/route.ts:49  → createAdminClient()
--   - analytics-service/routers/exchange.py:121       → service-role client
--   - analytics-service/routers/cron.py:81            → service-role client
-- Revoking EXECUTE from `anon` and `authenticated` on these functions
-- does NOT break any existing code path. The admin client stays on the
-- privileged path; nothing in user-client code calls these RPCs directly.
--
-- Pattern — use the same self-verifying DO block as migration 020 so
-- that if a future upstream change re-adds one of these grants, the
-- migration fails loudly instead of silently no-op'ing.

-- --------------------------------------------------------------------------
-- STEP 1: revoke the unintended anon/authenticated EXECUTE
-- --------------------------------------------------------------------------
-- IMPORTANT: we also revoke from PUBLIC because `sync_trades` inherits
-- EXECUTE via a direct PUBLIC grant in its ACL (`{=X/postgres, ...}`),
-- and anon/authenticated inherit from PUBLIC. Without this, REVOKEing
-- only the anon/authenticated explicit grants leaves the inherited
-- permission intact and the DO-block assertion below catches it.
REVOKE ALL ON FUNCTION send_intro_with_decision(UUID, UUID, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sync_trades(UUID, JSONB)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION latest_cron_success(TEXT)                              FROM PUBLIC, anon, authenticated;

-- service_role keeps EXECUTE via the owner default. Admin clients calling
-- `.rpc(...)` with the service role key stay on the privileged path.

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying assertion
-- --------------------------------------------------------------------------
DO $$
DECLARE
  violations int;
BEGIN
  SELECT count(*) INTO violations
  FROM (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('send_intro_with_decision', 'sync_trades', 'latest_cron_success')
      AND (
        has_function_privilege('anon',          p.oid, 'EXECUTE') OR
        has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )
  ) AS v;

  IF violations > 0 THEN
    RAISE EXCEPTION
      'Migration 021 failed: % of {send_intro_with_decision, sync_trades, latest_cron_success} still has anon/authenticated EXECUTE. Rolling back.',
      violations;
  END IF;
END
$$;

-- Defensive confirmation that service_role still has EXECUTE on all three —
-- the admin client + Python analytics client depend on that.
DO $$
DECLARE
  missing int;
BEGIN
  SELECT count(*) INTO missing
  FROM (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('send_intro_with_decision', 'sync_trades', 'latest_cron_success')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
  ) AS v;

  IF missing > 0 THEN
    RAISE EXCEPTION
      'Migration 021 failed: % of {send_intro_with_decision, sync_trades, latest_cron_success} lost service_role EXECUTE — this would break the admin + analytics clients. Rolling back.',
      missing;
  END IF;
END
$$;
