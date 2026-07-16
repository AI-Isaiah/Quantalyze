-- Test: Phase 109 ROLE-05 staff role='both' empty-set invariant (the atomic GATE).
--
-- audit / Phase 109 (role-predicate unification).
--
-- Background
-- ----------
-- Phase 109 retires the `|| isAdmin` OR-in from the nav derivations
-- (Sidebar.tsx) so `profiles.role` is the sole workspace persona predicate and
-- `is_admin` gates only the Admin section. That drop is SAFE for staff ONLY if
-- every `is_admin` account has been backfilled to role='both' (the dashboard
-- layout lights both workspaces for role='both'). Landing the drop without the
-- backfill self-locks staff out of the allocator workspace (threat T-109-06).
--
-- Invariant asserted
-- ------------------
-- After migration 20260716120000_backfill_staff_role_both.sql has been applied,
-- NO staff row may have a role other than 'both', where "staff" is the SAME
-- union the dropped `|| isAdmin` nav OR-in consumed: profiles.is_admin=true OR a
-- user_app_roles.role='admin' row (isAdminUser(), src/lib/admin.ts). Keying the
-- assertion on the union (not just profiles.is_admin) is what catches a future
-- user_app_roles-only admin that the backfill missed — that account would be
-- self-locked out of the allocator workspace (threat T-109-06). This is the
-- CI-enforced proof that the atomic GATE held: the backfill ran AND the active
-- prevent_profile_privileged_change trigger (20260529150000, SECURITY INVOKER)
-- did not block it (assumption A2 / threat T-109-07 — a nonzero count means the
-- UPDATE was no-op'd or the runner was not on the privileged allowlist).
--
-- RED-guard: this assertion PASSES only once the backfill migration is applied
-- to this database. On the shared test project it therefore fails until the
-- Task 3 MCP apply catches the test project up (test-project catch-up rule);
-- merging to main AUTO-applies the migration to PROD.
--
-- Isolation: read-only SELECT wrapped in a transaction that ROLLBACKs — no
-- rows are written or mutated on the shared test DB.

BEGIN;

DO $$
DECLARE
  v_violations int;
BEGIN
  SELECT count(*)
    INTO v_violations
    FROM public.profiles p
   WHERE p.role NOT IN ('both')
     AND (
       p.is_admin = true
       OR EXISTS (
         SELECT 1 FROM public.user_app_roles r
         WHERE r.user_id = p.id
           AND r.role = 'admin'
       )
     );

  IF v_violations <> 0 THEN
    RAISE EXCEPTION
      'GATE FAILED: % staff rows (is_admin=true OR user_app_roles admin) have '
      'role NOT IN (both) — the Phase 109 role=''both'' backfill (20260716120000) '
      'did not fully apply, or a join-table-only admin was not covered, or the '
      'prevent_profile_privileged_change trigger blocked it (A2 / T-109-07).',
      v_violations;
  END IF;

  RAISE NOTICE 'Phase 109 staff role=both empty-set invariant holds (0 violations).';
END $$;

ROLLBACK;
