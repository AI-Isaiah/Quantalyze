-- audit-2026-05-07 mitigation (specialist-review apply pass take 2)
-- Closes:
--   CRITICAL-1 (code-reviewer c9 + security c9 + data-migration c9):
--     `_match_decisions_visibility_check` trigger fires as the caller's
--     role and `PERFORM`s `_assert_strategy_visible_to_allocator` which
--     mig 20260516160700 REVOKEd from service_role. Every direct
--     service_role INSERT into match_decisions with kind in
--     ('voluntary_add','bridge_recommended') + non-null strategy_id
--     would fail with `42501 permission denied for function
--     _assert_strategy_visible_to_allocator`. PRODUCTION-BREAKING.
--   MED-2 (code-reviewer c8 + security c6): trigger function lacked
--     `SET search_path = public, pg_catalog` — convention drift from
--     the codebase's 89-prior-migration norm.
--   MED-3 (data-migration c7 + security c7 + red-team c7): orphan-org
--     branch returned TRUE → strategies in orphan-orgs became globally
--     allocator-visible. Fail-closed: orphan-org now returns FALSE.
--
-- Source migration: supabase/migrations/20260516160700_commit_scenario_batch_strategy_visibility.sql
-- (do NOT edit that file — this is a forward-only delta on the same objects.)
--
-- Strategy:
--   * GRANT EXECUTE on `_assert_strategy_visible_to_allocator(UUID,UUID)`
--     to `service_role, authenticated` — matches the 160100 sanitize_user
--     GRANT pattern (REVOKE PUBLIC/anon + GRANT service_role). The helper
--     is STABLE + read-only — no security gain from REVOKEing from app
--     roles since it only reads strategies + organization_members which
--     already have RLS. The GRANT here closes the trigger ACL trap.
--   * CREATE OR REPLACE the trigger function with `SET search_path` for
--     convention parity.
--   * CREATE OR REPLACE the helper with fail-closed orphan-org branch.
--
-- Idempotent: CREATE OR REPLACE preserves the trigger / function bindings.
-- The GRANT is reapplied defensively.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: replace helper with fail-closed orphan-org branch
-- --------------------------------------------------------------------------
-- audit-2026-05-07 MED-3 — Before this migration, an org with zero members
-- (post-sanitize emptied state, or freshly-created un-onboarded state)
-- caused the helper to RETURN TRUE → ANY allocator could commit voluntary_add
-- / bridge_recommended against strategies in that org. This widened
-- visibility beyond the strategies_org_read RLS predicate. Fix: orphan-org
-- now returns FALSE; rare legitimate sanitize-orphan-recovery is handled
-- via manual admin override (separate runbook), not via a permanent
-- code-path that doubles as a probe-existence oracle.
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

  -- Strategy is org-scoped. Allocator must be in organization_members.
  -- audit-2026-05-07 MED-3: orphan-org (zero members) no longer
  -- returns TRUE. The prior fast-path silently flipped sanitize-orphan
  -- strategies to globally allocator-visible. Failing closed is safer;
  -- legitimate post-sanitize unblock is via manual admin override.
  SELECT EXISTS (
    SELECT 1 FROM organization_members
     WHERE organization_id = v_org_id
       AND user_id = p_allocator_id
  ) INTO v_is_member;

  RETURN COALESCE(v_is_member, FALSE);
END;
$fn$;

COMMENT ON FUNCTION public._assert_strategy_visible_to_allocator(UUID, UUID) IS
  'audit-2026-05-07 M-0825 + specialist-review take 2 (MED-3 fail-closed). '
  'Returns TRUE iff a strategy is visible to an allocator. Org-scoped '
  'strategies require allocator to be a member of the owning organization. '
  'Orphaned orgs (no members) return FALSE (fail-closed; prior orphan-org '
  'fast-path was a visibility regression). SECURITY DEFINER + STABLE so '
  'callers can invoke in CHECK / trigger / cron contexts.';

-- --------------------------------------------------------------------------
-- STEP 2: re-apply ACL with service_role + authenticated EXECUTE
-- --------------------------------------------------------------------------
-- audit-2026-05-07 CRITICAL-1: the trigger fires as the calling role.
-- service_role + authenticated need EXECUTE so direct admin / route
-- INSERTs (src/app/api/match/decisions/holding/route.ts,
-- src/app/api/admin/match/decisions/route.ts, src/__tests__/*) can
-- complete without 42501 permission denied. Matches the 160100
-- sanitize_user GRANT pattern.
REVOKE ALL ON FUNCTION public._assert_strategy_visible_to_allocator(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._assert_strategy_visible_to_allocator(UUID, UUID) TO service_role, authenticated;

-- --------------------------------------------------------------------------
-- STEP 3: replace trigger function with SET search_path (MED-2)
-- --------------------------------------------------------------------------
-- Body unchanged from mig 20260516160700; only the `SET search_path = public, pg_catalog`
-- clause is added for convention parity with the 89-prior-migration norm.
CREATE OR REPLACE FUNCTION public._match_decisions_visibility_check()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
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
  'audit-2026-05-07 M-0825 + specialist-review take 2 (MED-2 search_path). '
  'BEFORE INSERT trigger function for match_decisions. Gates voluntary_add / '
  'bridge_recommended INSERTs on _assert_strategy_visible_to_allocator. '
  'Raises 42501 with strategy_id + allocator_id in the message on '
  'visibility failure. SET search_path = public, pg_catalog locks lookups.';

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_helper_present BOOLEAN;
  v_trigger_present BOOLEAN;
  v_role_can_execute BOOLEAN;
BEGIN
  -- (a) helper still present after CREATE OR REPLACE
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = '_assert_strategy_visible_to_allocator'
  ) INTO v_helper_present;
  IF NOT v_helper_present THEN
    RAISE EXCEPTION 'audit-2026-05-07 specialist-review take 2 verification failed: _assert_strategy_visible_to_allocator missing';
  END IF;

  -- (b) trigger still present
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
    RAISE EXCEPTION 'audit-2026-05-07 specialist-review take 2 verification failed: match_decisions_visibility_check trigger missing';
  END IF;

  -- (c) CRITICAL-1: service_role has EXECUTE on the helper. Probe via
  -- has_function_privilege which evaluates the ACL exactly the way
  -- Postgres would at function call time.
  SELECT has_function_privilege(
    'service_role',
    'public._assert_strategy_visible_to_allocator(uuid, uuid)',
    'execute'
  ) INTO v_role_can_execute;
  IF NOT v_role_can_execute THEN
    RAISE EXCEPTION 'audit-2026-05-07 CRITICAL-1 verification failed: service_role lacks EXECUTE on _assert_strategy_visible_to_allocator — direct match_decisions INSERTs would 42501';
  END IF;

  SELECT has_function_privilege(
    'authenticated',
    'public._assert_strategy_visible_to_allocator(uuid, uuid)',
    'execute'
  ) INTO v_role_can_execute;
  IF NOT v_role_can_execute THEN
    RAISE EXCEPTION 'audit-2026-05-07 CRITICAL-1 verification failed: authenticated lacks EXECUTE on _assert_strategy_visible_to_allocator';
  END IF;

  -- (d) trigger function has SET search_path (MED-2)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = '_match_decisions_visibility_check'
     AND 'search_path=public, pg_catalog' = ANY(p.proconfig)
  ) THEN
    RAISE EXCEPTION 'audit-2026-05-07 MED-2 verification failed: _match_decisions_visibility_check missing SET search_path = public, pg_catalog';
  END IF;
END $$;

COMMIT;
