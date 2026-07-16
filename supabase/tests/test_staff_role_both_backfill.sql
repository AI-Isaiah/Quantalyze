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
-- NO staff row may have is_admin=true with a role other than 'both'. This is
-- the CI-enforced proof that the atomic GATE held: the backfill ran AND the
-- prevent_profile_role_change trigger did not silently block it (assumption A2 /
-- threat T-109-07 — a nonzero count here means the UPDATE was no-op'd and the
-- trigger exempted the migration runner incorrectly).
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
    FROM public.profiles
   WHERE is_admin = true
     AND role NOT IN ('both');

  IF v_violations <> 0 THEN
    RAISE EXCEPTION
      'GATE FAILED: % staff rows have is_admin=true but role NOT IN (both) — '
      'the Phase 109 role=''both'' backfill (20260716120000) did not fully '
      'apply (or the prevent_profile_role_change trigger blocked it — A2).',
      v_violations;
  END IF;

  RAISE NOTICE 'Phase 109 staff role=both empty-set invariant holds (0 violations).';
END $$;

ROLLBACK;
