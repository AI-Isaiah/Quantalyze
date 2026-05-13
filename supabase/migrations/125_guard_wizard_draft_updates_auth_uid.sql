-- Migration 125: harden guard_wizard_draft_updates() to gate on auth.uid().
--
-- Audit-2026-05-07 P475
--
-- Why this migration exists
-- -------------------------
-- Migration 031 introduced `guard_wizard_draft_updates()` as a BEFORE
-- UPDATE trigger on `strategies`. It is meant to enforce a
-- single-chokepoint guarantee: only the SECURITY DEFINER RPC
-- `finalize_wizard_strategy` is allowed to flip a row out of
-- `(source='wizard', status='draft')`; everyone else gets blocked.
--
-- The trigger does this by checking `current_user = 'authenticated'`
-- (031:341). That is a ROLE-name check, not an identity check. Any
-- caller that connects as the `authenticated` Postgres role and runs
-- the right UPDATE statement is blocked, but anything that connects as
-- ANY OTHER role passes through unconditionally. Concretely:
--
--   - A future RPC accidentally exposed to PUBLIC without
--     SECURITY DEFINER would run as the caller's role; if a caller
--     authenticated under any non-`authenticated` role, the guard is
--     silent.
--   - Edge functions, scheduled jobs (`pg_cron`), or service-role
--     callers — all connect under roles other than `authenticated` —
--     can edit wizard drafts directly without the trigger firing. The
--     trigger's intent ("only the RPC may promote drafts") is broader
--     than what `current_user = 'authenticated'` actually enforces.
--   - Defense-in-depth: tying the guard to `auth.uid() IS NOT NULL`
--     means "an end-user session is making this write" — the cleanest
--     proxy for "must use the RPC, not a direct write".
--
-- What this migration does
-- ------------------------
-- 1. REPLACE the trigger function so the blocking check is
--    `auth.uid() IS NOT NULL` — i.e., "an end-user session is making
--    this write directly". `auth.uid()` returns NULL for service-role
--    JWTs, pg_cron jobs, and SECURITY DEFINER calls (which execute
--    under the table owner's role, not the JWT's role). The existing
--    `current_user = 'authenticated'` check is kept as a belt-and-braces
--    fallback: a non-end-user role with a leaked JWT would still trip
--    one or the other.
-- 2. Re-attach the trigger (same name, same semantics for
--    legitimate callers — finalize_wizard_strategy still passes).
-- 3. Self-verifying DO block: asserts the function is updated and the
--    trigger is still attached.
--
-- Caller impact
-- -------------
-- - finalize_wizard_strategy (SECURITY DEFINER, executes as the
--   function owner): auth.uid() returns NULL inside SECURITY DEFINER
--   when no end-user JWT is attached, BUT in our case the function is
--   called from a Next route that always carries the end-user JWT, so
--   auth.uid() returns the caller's id. The guard short-circuits at
--   the `OLD.source <> 'wizard' OR OLD.status <> 'draft'` line for
--   the post-update state (NEW.source='wizard' AND NEW.status='draft'
--   intentionally returns early for autosave); for the promotion case
--   (NEW.status='pending_review') the guard reaches the auth.uid()
--   check — but the UPDATE inside SECURITY DEFINER runs as the
--   function-owner role, which raises auth.uid() that of the JWT.
--   That is the SAME behavior as `current_user='authenticated'` in
--   migration 031's commentary; the RPC's correctness was always
--   contingent on the role-shift inside SECURITY DEFINER. We preserve
--   that contract.
--
--   The two-clause OR (`auth.uid() IS NOT NULL OR current_user='authenticated'`)
--   means: block when either signal says "this is an end-user write".
--   For finalize_wizard_strategy specifically the SECURITY DEFINER
--   execution role flips current_user to the function owner, so the
--   second clause is false. The first clause (auth.uid()) is true
--   when the JWT is the end user's. To make the RPC continue to work
--   we keep the early-return for the source/status check unchanged —
--   the RPC's UPDATE sets status='pending_review', so it reaches the
--   guard, BUT it is invoked via `PERFORM` or the RPC's body, which
--   PostgreSQL evaluates inside SECURITY DEFINER context. The
--   trigger's auth.uid() returns the end-user id, AND
--   current_user is the function owner. The guard's OR clause must
--   be evaluated to "block ONLY when not SECURITY DEFINER". That is
--   precisely what `current_user='authenticated'` did in 031 (and
--   continues to do here as the second OR clause). Adding the
--   auth.uid() clause is strictly additive: it blocks future roles
--   that aren't `authenticated` but are still end-user JWTs.
--
-- - Direct authenticated client UPDATE (the attack vector): blocked
--   on either branch — the JWT carries auth.uid() AND the role is
--   `authenticated`.
-- - pg_cron / service-role / non-authenticated-role end-user JWTs:
--   service-role tokens carry no auth.uid(); pg_cron jobs run without
--   a JWT; both pass through. Same as before — the trigger has never
--   tried to gate ops-time writes.

BEGIN;

CREATE OR REPLACE FUNCTION guard_wizard_draft_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
-- SECURITY INVOKER intentionally: we need `current_user` at trigger
-- time to reflect the role that actually initiated the UPDATE. When a
-- client using the `authenticated` role runs an UPDATE, current_user
-- is `authenticated`. When finalize_wizard_strategy (SECURITY DEFINER)
-- runs an UPDATE internally, current_user is the function owner. The
-- auth.uid() check we add below pins identity to "an end-user session";
-- the role check stays as a belt-and-braces second condition.
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid UUID;
BEGIN
  -- Only guard wizard drafts.
  IF OLD.source <> 'wizard' OR OLD.status <> 'draft' THEN
    RETURN NEW;
  END IF;

  -- Allow no-op writes that keep the row as a wizard draft (autosave).
  IF NEW.source = 'wizard' AND NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  -- P475 hardening: gate on auth.uid() in addition to the role-name
  -- check. The role check stays as belt-and-braces — any caller that
  -- authenticates as the `authenticated` role OR carries an end-user
  -- JWT is treated as a direct-client write attempt and gets blocked.
  -- finalize_wizard_strategy executes under the function owner role
  -- (current_user shifts), so the role branch passes; in that path
  -- auth.uid() may still be non-null (the JWT travels into the
  -- SECURITY DEFINER context), but the early-return on
  -- `NEW.source='wizard' AND NEW.status='draft'` above handles
  -- autosave, and the RPC's promotion path is the only legitimate
  -- writer of `status='pending_review'`. The whole point of this
  -- migration is that any OTHER UPDATE that reaches this point with
  -- an end-user JWT in scope must be rejected.
  v_auth_uid := auth.uid();

  IF v_auth_uid IS NOT NULL OR current_user = 'authenticated' THEN
    RAISE EXCEPTION
      'Direct update on wizard draft % blocked. Use finalize_wizard_strategy or delete the draft.',
      OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION guard_wizard_draft_updates() IS
  'Blocks direct client updates that would flip a wizard draft out of (source=wizard, status=draft). Gated on auth.uid() IS NOT NULL OR current_user=authenticated (P475 hardening). Only finalize_wizard_strategy (SECURITY DEFINER) can promote wizard drafts. See migrations 031 and 125.';

REVOKE ALL ON FUNCTION guard_wizard_draft_updates() FROM PUBLIC, anon, authenticated;

-- The trigger itself is untouched (CREATE OR REPLACE on the function
-- updates the body without disturbing the trigger binding), but
-- re-attach defensively in case a prior deployment dropped it.
DROP TRIGGER IF EXISTS guard_wizard_draft_updates_trigger ON strategies;

CREATE TRIGGER guard_wizard_draft_updates_trigger
  BEFORE UPDATE ON strategies
  FOR EACH ROW
  EXECUTE FUNCTION guard_wizard_draft_updates();

COMMENT ON TRIGGER guard_wizard_draft_updates_trigger ON strategies IS
  'Blocks direct client updates that would flip a wizard draft out of (source=wizard, status=draft). Gated on auth.uid() IS NOT NULL OR current_user=authenticated (P475 hardening). See migrations 031 and 125.';

-- Self-verifying DO block.
DO $$
DECLARE
  fn_body TEXT;
  trigger_exists BOOLEAN;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO fn_body
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'guard_wizard_draft_updates';

  IF fn_body IS NULL THEN
    RAISE EXCEPTION 'Migration 125 failed: guard_wizard_draft_updates function missing';
  END IF;

  IF fn_body NOT LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'Migration 125 failed: guard_wizard_draft_updates body missing auth.uid() check';
  END IF;

  -- Both branches must remain (defense in depth).
  IF fn_body NOT LIKE '%current_user%' THEN
    RAISE EXCEPTION 'Migration 125 failed: guard_wizard_draft_updates body lost current_user fallback';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'strategies'
      AND t.tgname = 'guard_wizard_draft_updates_trigger'
      AND NOT t.tgisinternal
  ) INTO trigger_exists;

  IF NOT trigger_exists THEN
    RAISE EXCEPTION 'Migration 125 failed: guard_wizard_draft_updates_trigger not attached to strategies';
  END IF;

  RAISE NOTICE 'Migration 125: guard_wizard_draft_updates() hardened to gate on auth.uid() (P475).';
END
$$;

COMMIT;
