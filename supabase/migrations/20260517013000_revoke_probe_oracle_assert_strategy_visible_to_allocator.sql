-- PR #182 retroactive audit follow-up (Task #57)
-- Closes: rls-policy-auditor HIGH #1 (conf 8) — SECDEF probe-oracle live in prod.
--
-- Source artifact:
--   /Users/helios-mammut/claude-projects/quantalyze/.review/retro-audit-pr182.rls-policy-auditor.jsonl  line 1
-- Source migration (already applied, do NOT edit):
--   supabase/migrations/20260516170000_match_decisions_visibility_check_secdef_fix.sql line 114
--
-- Issue:
--   `20260516170000` STEP 2 ships
--     GRANT EXECUTE ON FUNCTION public._assert_strategy_visible_to_allocator(uuid,uuid)
--       TO service_role, authenticated;
--   The helper is SECURITY DEFINER + STABLE, takes a (strategy_id, allocator_id)
--   pair, and returns BOOLEAN. SECDEF + boolean + row-identifier args =
--   probe-oracle: any `authenticated` user can call the function directly to
--   enumerate
--     (a) which strategy_id UUIDs exist in `strategies`,
--     (b) owner-scoped (organization_id IS NULL) vs org-scoped classification
--         per strategy_id (owner-scoped returns TRUE for any allocator;
--         org-scoped returns FALSE for non-members), and
--     (c) for a known strategy_id, whether any chosen allocator_id is in the
--         owning organization's `organization_members`.
--   This bypasses `strategies_org_read` RLS, which otherwise hides org-scoped
--   strategy existence from non-members. (See migration-reviewer invariant #19
--   "SECDEF helper EXECUTE-to-authenticated = probe-oracle" at
--   .claude/agents/migration-reviewer.md line 142.)
--
-- Why authenticated does not need EXECUTE:
--   * The trigger `_match_decisions_visibility_check` (BEFORE INSERT on
--     match_decisions) is SECURITY INVOKER and fires under the role doing
--     the INSERT. The two PR-182 routes
--       src/app/api/match/decisions/holding/route.ts
--       src/app/api/admin/match/decisions/route.ts
--     both call `createAdminClient()` -> service_role. service_role keeps
--     EXECUTE here.
--   * Migration 011's `match_decisions` RLS allows only admin + service_role
--     to INSERT, so an `authenticated` session cannot ever fire the trigger
--     directly. There is no path where `authenticated` legitimately needs
--     EXECUTE on this helper.
--   * The SECDEF `commit_scenario_batch` RPC (mig 20260516160700/160800)
--     runs as DEFINER (postgres-owned) and trivially has EXECUTE inside the
--     function body regardless of the role-level ACL.
--
-- Fix:
--   REVOKE EXECUTE FROM `authenticated`. Keep EXECUTE for `service_role`
--   (the INSERT-originating role) so the trigger continues to succeed for
--   the two routes above. Re-assert REVOKE FROM PUBLIC, anon defensively.
--
-- Idempotent: REVOKE/GRANT are idempotent; re-applying this migration is a
-- no-op. The function definition itself is unchanged.
--
-- Rollback:
--   GRANT EXECUTE ON FUNCTION public._assert_strategy_visible_to_allocator(uuid, uuid)
--     TO authenticated;
--   (Only do this if a future authenticated-context caller is added and the
--   leak-surface review concludes the probe-oracle is acceptable. The cleaner
--   alternative is a wrapper that returns a strategy_id IN (...) predicate
--   that respects strategies RLS.)

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: REVOKE the authenticated GRANT (closes the probe-oracle)
-- --------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._assert_strategy_visible_to_allocator(UUID, UUID) FROM authenticated;

-- Defensive: re-assert PUBLIC + anon REVOKE so the ACL is uniform across
-- environments where the historical default-PUBLIC may have leaked in.
REVOKE ALL ON FUNCTION public._assert_strategy_visible_to_allocator(UUID, UUID) FROM PUBLIC, anon;

-- service_role retains EXECUTE — the trigger fires for service_role INSERTs.
-- Re-assert defensively in case a future migration drops it.
GRANT EXECUTE ON FUNCTION public._assert_strategy_visible_to_allocator(UUID, UUID) TO service_role;

COMMENT ON FUNCTION public._assert_strategy_visible_to_allocator(UUID, UUID) IS
  'audit-2026-05-07 M-0825 + specialist-review take 2 (MED-3 fail-closed) + '
  'PR #182 retro audit (Task #57) REVOKE authenticated to close SECDEF '
  'probe-oracle. Returns TRUE iff a strategy is visible to an allocator. '
  'Org-scoped strategies require allocator to be a member of the owning '
  'organization. Orphaned orgs (no members) return FALSE (fail-closed; '
  'prior orphan-org fast-path was a visibility regression). SECURITY DEFINER '
  '+ STABLE so callers can invoke in CHECK / trigger / cron contexts. '
  'EXECUTE restricted to service_role only (the INSERT-originating role for '
  'the BEFORE INSERT trigger on match_decisions); authenticated callers go '
  'through SECDEF RPC commit_scenario_batch which has EXECUTE via DEFINER '
  'ownership, not via role-level ACL.';

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_role_can_execute BOOLEAN;
BEGIN
  -- (a) authenticated must NOT have EXECUTE
  SELECT has_function_privilege(
    'authenticated',
    'public._assert_strategy_visible_to_allocator(uuid, uuid)',
    'execute'
  ) INTO v_role_can_execute;
  IF v_role_can_execute THEN
    RAISE EXCEPTION 'PR #182 retro audit verification failed: authenticated still has EXECUTE on _assert_strategy_visible_to_allocator — probe-oracle still open';
  END IF;

  -- (b) anon must NOT have EXECUTE
  SELECT has_function_privilege(
    'anon',
    'public._assert_strategy_visible_to_allocator(uuid, uuid)',
    'execute'
  ) INTO v_role_can_execute;
  IF v_role_can_execute THEN
    RAISE EXCEPTION 'PR #182 retro audit verification failed: anon has EXECUTE on _assert_strategy_visible_to_allocator';
  END IF;

  -- (c) service_role MUST retain EXECUTE — the BEFORE INSERT trigger fires
  -- for service_role INSERTs on match_decisions and PERFORMs this helper.
  -- Without EXECUTE every direct admin-client INSERT 42501s. Reference:
  -- the CRITICAL-1 finding 170000 STEP 2 closed.
  SELECT has_function_privilege(
    'service_role',
    'public._assert_strategy_visible_to_allocator(uuid, uuid)',
    'execute'
  ) INTO v_role_can_execute;
  IF NOT v_role_can_execute THEN
    RAISE EXCEPTION 'PR #182 retro audit verification failed: service_role lost EXECUTE on _assert_strategy_visible_to_allocator — direct match_decisions INSERTs would 42501';
  END IF;
END $$;

COMMIT;
