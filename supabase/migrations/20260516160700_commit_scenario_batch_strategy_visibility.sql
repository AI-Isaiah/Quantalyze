-- audit-2026-05-07 mitigation
-- Closes: M-0825 (data-migration c8)
-- Source file: supabase/migrations/20260426131720_commit_scenario_batch_rpc.sql (was 082)
-- Issue: commit_scenario_batch checks `WHERE id = ... AND status =
--   'published'` for voluntary_add / bridge_recommended. There is no
--   org / visibility join. If "published" is meant to be globally
--   visible, this is intentional; if some "published" strategies are
--   org-scoped, any allocator can commit any "published" strategy
--   bypassing Browse RLS filters.
-- Mitigation: install (a) a `_assert_strategy_visible_to_allocator`
--   helper and (b) a `match_decisions_visibility_check` BEFORE-INSERT
--   trigger that gates voluntary_add / bridge_recommended inserts on
--   the org-visibility predicate. The trigger fires regardless of
--   which RPC or route is inserting — so commit_scenario_batch,
--   send_intro_with_decision, or any future writer is automatically
--   covered. Failure raises 42501 insufficient_privilege with the
--   strategy id in the message so the route can map it back to UI.
--
--   Visibility predicate: if strategies.organization_id IS NULL OR
--   the owning org has zero members (orphaned post-sanitize state),
--   the strategy is treated as globally visible. Otherwise the
--   allocator must be in organization_members for that org.
--
--   The trigger ONLY fires for voluntary_add (strategy_id NOT NULL,
--   originals NULL) and bridge_recommended (strategy_id NOT NULL,
--   one of originals NOT NULL). voluntary_remove / voluntary_modify
--   have strategy_id NULL by CHECK; the trigger is a no-op for them.
--
-- Idempotent: DROP TRIGGER IF EXISTS + CREATE TRIGGER, CREATE OR
-- REPLACE on the trigger function and helper. Safe to re-apply.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: install the strategy-visibility helper
-- --------------------------------------------------------------------------
-- STABLE SECURITY DEFINER — read-only access to strategies +
-- organization_members. Returns BOOLEAN. False ONLY when the strategy
-- belongs to an organization that the allocator is not a member of.
CREATE OR REPLACE FUNCTION public._assert_strategy_visible_to_allocator(
  p_strategy_id UUID,
  p_allocator_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_org_id UUID;
  v_org_member_count INTEGER;
  v_is_member BOOLEAN;
BEGIN
  IF p_strategy_id IS NULL THEN
    -- voluntary_remove / voluntary_modify have NULL strategy_id by
    -- CHECK; treat as visible (the visibility gate is for strategy-
    -- bearing kinds only).
    RETURN TRUE;
  END IF;

  -- Look up the strategy's organization scope. If organization_id is
  -- NULL, the strategy is owner-scoped (no org gate) and globally
  -- visible while published — return TRUE.
  SELECT organization_id INTO v_org_id
    FROM strategies
   WHERE id = p_strategy_id;

  IF v_org_id IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Strategy is org-scoped. Check whether the org has any members.
  -- Orphaned orgs (zero members) are treated as globally visible
  -- to avoid frozen scenario commits when the owning org was
  -- post-sanitize emptied.
  SELECT COUNT(*) INTO v_org_member_count
    FROM organization_members
   WHERE organization_id = v_org_id;

  IF v_org_member_count = 0 THEN
    RETURN TRUE;
  END IF;

  -- Org has members. Allocator must be one of them.
  SELECT EXISTS (
    SELECT 1 FROM organization_members
     WHERE organization_id = v_org_id
       AND user_id = p_allocator_id
  ) INTO v_is_member;

  RETURN v_is_member;
END;
$fn$;

COMMENT ON FUNCTION public._assert_strategy_visible_to_allocator(UUID, UUID) IS
  'audit-2026-05-07 M-0825. Returns TRUE iff a strategy is visible to '
  'an allocator. Org-scoped strategies require allocator to be a member of '
  'the owning organization. Orphaned orgs (no members) are treated as '
  'globally visible to avoid frozen scenario commits. SECURITY DEFINER + '
  'STABLE so callers can invoke in CHECK / trigger / cron contexts.';

REVOKE ALL ON FUNCTION public._assert_strategy_visible_to_allocator(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 2: install the trigger function
-- --------------------------------------------------------------------------
-- BEFORE INSERT trigger. Inspects NEW.kind + NEW.strategy_id +
-- NEW.allocator_id and invokes _assert_strategy_visible_to_allocator.
-- Raises 42501 insufficient_privilege on visibility failure with the
-- strategy id in the message so the calling RPC can rethrow / map
-- to a 403 / 404 at the HTTP layer.
CREATE OR REPLACE FUNCTION public._match_decisions_visibility_check()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $trg$
BEGIN
  -- Only gate kinds that carry a strategy_id. voluntary_remove and
  -- voluntary_modify INSERT with strategy_id IS NULL per CHECK; the
  -- helper would short-circuit on NULL anyway.
  IF NEW.kind IN ('voluntary_add', 'bridge_recommended')
     AND NEW.strategy_id IS NOT NULL
     AND NEW.allocator_id IS NOT NULL THEN
    IF NOT public._assert_strategy_visible_to_allocator(NEW.strategy_id, NEW.allocator_id) THEN
      RAISE EXCEPTION
        'match_decisions visibility check: strategy % is not visible to allocator % (org-scoped, allocator not a member). audit-2026-05-07 M-0825.',
        NEW.strategy_id, NEW.allocator_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$trg$;

COMMENT ON FUNCTION public._match_decisions_visibility_check() IS
  'audit-2026-05-07 M-0825. BEFORE INSERT trigger function for '
  'match_decisions. Gates voluntary_add / bridge_recommended INSERTs on '
  '_assert_strategy_visible_to_allocator. Raises 42501 with strategy_id + '
  'allocator_id in the message on visibility failure.';

-- --------------------------------------------------------------------------
-- STEP 3: install (or re-install) the trigger
-- --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS match_decisions_visibility_check ON public.match_decisions;
CREATE TRIGGER match_decisions_visibility_check
  BEFORE INSERT ON public.match_decisions
  FOR EACH ROW
  EXECUTE FUNCTION public._match_decisions_visibility_check();

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_helper_present BOOLEAN;
  v_trigger_present BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = '_assert_strategy_visible_to_allocator'
  ) INTO v_helper_present;
  IF NOT v_helper_present THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0825 verification failed: _assert_strategy_visible_to_allocator missing';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'match_decisions'
     AND t.tgname = 'match_decisions_visibility_check'
     AND NOT t.tgisinternal
  ) INTO v_trigger_present;
  IF NOT v_trigger_present THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0825 verification failed: match_decisions_visibility_check trigger missing';
  END IF;

  -- Re-assert PUBLIC EXECUTE absence on the helper
  PERFORM public._assert_no_public_execute('public._assert_strategy_visible_to_allocator(uuid, uuid)');
END $$;

COMMIT;
