-- Phase 110 CONTRIB — table-level enforcement of the never-published invariant.
--
-- Red-team Finding 1 (Fable, 2026-07-16), PROVEN live on the test DB: the
-- "only the admin review route publishes" invariant (SC-1) was enforced only in
-- CODE (the finalize RPCs RAISE on p_terminal_status='published'; the
-- strategies-published-sole-writer source-scan guard bans a second TS/SQL
-- writer). NEITHER covers a DIRECT authenticated write to the strategies table:
--   • RLS strategies_update USING (user_id = auth.uid()) — no status gate.
--   • RLS strategies_insert WITH CHECK (user_id = auth.uid()) — no status gate.
-- So a strategy OWNER could self-publish without admin review via a raw
-- PostgREST call, bypassing the publish gate entirely:
--   PATCH /rest/v1/strategies?id=eq.<own row>   {"status":"published"}   (proven)
--   POST  /rest/v1/strategies                    {"status":"published", ...} (same class, via INSERT)
-- This is owner-only (no cross-tenant escalation — RLS still blocks writing
-- another user's row), but it defeats the admin review gate: a 'published' row is
-- world-readable via strategies_read (status='published' OR user_id=auth.uid()),
-- so it lands in every allocator's public catalog un-vetted. Phase 110 newly
-- extended the exposed surface to the 'private' contribution status and asserts
-- never-published as a named security invariant, so we close the table path here
-- (root cause), not just the RPC path.
--
-- Mechanism: a BEFORE INSERT OR UPDATE trigger that blocks any transition INTO
-- status='published' when current_user='authenticated' — the same unforgeable
-- current_user idiom as guard_wizard_draft_updates (migration
-- 20260515114310, red-team Finding 1). The admin review route writes via the
-- service_role client (createAdminClient, strategy-review/route.ts), whose
-- current_user is 'service_role', NOT 'authenticated', so the sole sanctioned
-- publisher passes. SECURITY DEFINER RPCs (none write 'published', but for
-- completeness) run under the function owner and also pass. An authenticated
-- session cannot forge current_user (no SET ROLE privilege).
--
-- No explicit BEGIN/COMMIT — Supabase wraps each migration in one implicit
-- transaction (migration-reviewer invariant #14).

SET LOCAL lock_timeout = '3s';

-- SECURITY INVOKER (default): current_user at trigger time reflects the effective
-- role of the statement that fired it — 'authenticated' for a direct end-user
-- write, the function owner for a SECURITY DEFINER RPC body, 'service_role' for
-- the admin route's service client. Only the first is blocked.
CREATE OR REPLACE FUNCTION public.guard_strategies_publish_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Only guard the transition INTO 'published'. On UPDATE, an already-published
  -- row being edited (OLD.status = 'published') is untouched, so owners/admins
  -- can still update other columns on a published strategy. On INSERT there is
  -- no OLD row, so any inserted 'published' row is a fresh transition.
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    IF current_user = 'authenticated' THEN
      RAISE EXCEPTION
        'Direct publish of strategy % blocked. Strategies reach status=published '
        'only through the admin review route.', NEW.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_strategies_publish_transition() IS
  'Blocks a direct authenticated-role transition into strategies.status=published '
  '(INSERT or UPDATE). Gated on current_user=authenticated; the admin review '
  'route (service_role) and SECURITY DEFINER RPCs pass. Enforces SC-1 '
  '"admin route is the sole publisher" at the table layer. See Phase 110 '
  'red-team Finding 1 and migration 20260515114310 (current_user idiom).';

-- Trigger function: never invocable via PostgREST RPC. Revoke from the API roles
-- too (not just PUBLIC) — matches the guard_wizard_draft_updates convention and
-- clears the anon/authenticated SECURITY DEFINER-executable advisor.
REVOKE ALL ON FUNCTION public.guard_strategies_publish_transition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_strategies_publish_transition_trigger ON public.strategies;
CREATE TRIGGER guard_strategies_publish_transition_trigger
  BEFORE INSERT OR UPDATE ON public.strategies
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_strategies_publish_transition();

COMMENT ON TRIGGER guard_strategies_publish_transition_trigger ON public.strategies IS
  'CONTRIB / SC-1: authenticated clients cannot INSERT or UPDATE a strategy to '
  'status=published directly; only the admin review route (service_role) may.';

-- Self-verifying DO block — fail loud at apply if the guard did not land.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'guard_strategies_publish_transition_trigger'
      AND tgrelid = 'public.strategies'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'guard_strategies_publish_transition_trigger missing after migration';
  END IF;
  RAISE NOTICE 'guard_strategies_publish_transition self-check passed.';
END $$;
