-- ============================================================================
-- Phase 109 ROLE-05 — atomic staff role='both' backfill (2026-07-16)
-- ============================================================================
--
-- Background
-- ----------
-- Phase 109 makes `profiles.role` the SOLE persona predicate for the nav,
-- page guards, and APIs; `is_admin` becomes an ops-overlay that gates ONLY
-- the Admin section (never a workspace persona). Before this phase the nav
-- derivations OR-ed `is_admin` into the allocator/manager workspace flags
-- (`showsAllocatorWorkspace = isAllocator || isAdmin`), so every staff/admin
-- account saw both workspaces regardless of its role.
--
-- Why this ships in the SAME PR as the Sidebar `|| isAdmin` drop (ATOMIC GATE)
-- -------------------------------------------------------------------------
-- Dropping the `|| isAdmin` OR-in WITHOUT this backfill would lock every
-- `is_admin` account out of the allocator (and, unless role already grants it,
-- manager) workspace — a staff self-lockout (threat T-109-06, Denial of
-- Service). `role='both'` is the durable replacement predicate: the dashboard
-- layout derives `isAllocator = role IN ('allocator','both')` and
-- `isManager = role IN ('manager','both')`, so a staff row at role='both'
-- lights BOTH workspaces after the OR-in is gone. The migration and the
-- Sidebar edit are therefore inseparable and land together; the empty-set SQL
-- assertion (supabase/tests/test_staff_role_both_backfill.sql) is the
-- CI-enforced proof of the invariant.
--
-- Trigger note (assumption A2 — threat T-109-07)
-- ----------------------------------------------
-- The active BEFORE UPDATE OF role trigger on `profiles` is
-- `prevent_profile_privileged_change()` (20260529150000, SECURITY INVOKER),
-- which RAISES `insufficient_privilege` on a privileged-column change EXCEPT
-- when `current_user IN ('postgres', 'service_role', 'supabase_admin')`. A
-- migration runs as owner `postgres` (see the precedent backfill
-- 20260530120000_admin_role_mutate.sql), which is on that allowlist, so this
-- UPDATE is permitted. NOTE: the older `prevent_profile_role_change`
-- (20260520222848) is NOT the guard here — its trigger `profiles_lock_role`
-- was DROPPED by 20260529150000 and the function left orphaned, and it was
-- SECURITY DEFINER (a no-op that never blocked). Do not revive it.
-- Crucially, the INVOKER trigger does NOT silently skip rows: a non-privileged
-- runner RAISES (loud red CI / failed apply), never a silent lockout. The
-- Task 3 test-project apply confirmed the empty-set count went 2->0.
--
-- Which admins are backfilled (must match what the dropped `|| isAdmin`
-- OR-in consumed)
-- ----------------------------------------------------------------------
-- The nav derivation the OR-in fed (`(dashboard)/layout.tsx`) computed its
-- admin signal from `isAdminUser()`, which is `profiles.is_admin = true` OR a
-- `user_app_roles.role = 'admin'` row (src/lib/admin.ts). So the staff-access
-- backfill MUST cover that same UNION — a `user_app_roles`-only admin
-- (profiles.is_admin = false) that this migration missed would be silently
-- redirected off the allocator workspace after the drop (threat T-109-06).
-- There are zero such accounts today, but keying the backfill (and the CI
-- empty-set assertion) on the union closes the future blind spot honestly.
--
-- Idempotency
-- -----------
-- The `role <> 'both'` guard makes the UPDATE a no-op on re-run: once a staff
-- row is at role='both' it is excluded from the WHERE clause, so re-applying
-- the migration touches zero rows.
-- ============================================================================

UPDATE profiles
SET role = 'both'
WHERE role <> 'both'
  AND (
    is_admin = true
    OR EXISTS (
      SELECT 1 FROM public.user_app_roles r
      WHERE r.user_id = profiles.id
        AND r.role = 'admin'
    )
  );
