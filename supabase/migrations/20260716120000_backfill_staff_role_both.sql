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
-- `prevent_profile_role_change` (20260520222848) is a BEFORE UPDATE OF role
-- trigger that RAISES when the role actually changes — EXCEPT it explicitly
-- bypasses when `current_user IN ('postgres', 'service_role', 'supabase_admin')`.
-- A migration runs as a privileged session role, which is on that allowlist,
-- so this backfill UPDATE is NOT blocked by the trigger. This is verified
-- definitively at the Task 3 test-project apply: if the trigger HAD silently
-- no-op'd the UPDATE, the post-apply empty-set count would be nonzero.
--
-- Idempotency
-- -----------
-- The `role <> 'both'` guard makes the UPDATE a no-op on re-run: once a staff
-- row is at role='both' it is excluded from the WHERE clause, so re-applying
-- the migration touches zero rows.
-- ============================================================================

UPDATE profiles
SET role = 'both'
WHERE is_admin = true
  AND role <> 'both';
