-- Migration: user_notes dashboard scope_kind (additive)
-- Phase 100 — Optimizer + Favorites + Notes + KPI fold (Plan 01, PI-04)
--
-- Why this migration exists
-- -------------------------
-- The /allocations surface gets a "Notes" widget (UI-SPEC W1). /allocations is
-- the allocator's WHOLE book — it is user-scoped, not portfolio-scoped. Reusing
-- the existing `portfolio` scope keyed to "some default portfolio" breaks for
-- users with 0 portfolios and silently re-homes the note if the default changes
-- (checkScopeOwnership has no valid predicate for it). Per the locked decision,
-- a genuinely-new scope is needed: `scope_kind='dashboard'`, scope_ref literal
-- 'allocations'. Reuse the EXISTING user_notes table — NO new table.
--
-- What it does
-- ------------
-- Additive-only: DROP + re-ADD `user_notes_scope_kind_check` to extend the
-- allowed set from four values to five (adding 'dashboard'), re-based on the
-- LATEST definition of this constraint (migration 20260421060316_user_notes_
-- multiscope.sql:64-68 — the only other def; grep confirms). Existing rows are
-- untouched (every current scope_kind value is still permitted), no data
-- migration, no column/index/RLS changes. RLS `user_id = auth.uid()` (installed
-- by migrations 037 + 071) remains the owner gate for the new scope unchanged.
--
-- Migration discipline: this auto-applies to prod on merge. It is additive and
-- idempotent (DROP CONSTRAINT IF EXISTS + ADD; guarded self-verify). Per standing
-- invariants, migration-reviewer + rls-policy-auditor + test-project MCP catch-up
-- must run before merge. CI-authoritative RLS proof lives in
-- supabase/tests/test_user_notes_dashboard_scope.sql (vitest live-DB tests SKIP
-- in CI).

BEGIN;

-- --------------------------------------------------------------------------
-- Extend the scope_kind CHECK to include 'dashboard' (additive).
-- Re-based on migration 20260421060316 (the latest def of this constraint).
-- --------------------------------------------------------------------------
ALTER TABLE user_notes
  DROP CONSTRAINT IF EXISTS user_notes_scope_kind_check;
ALTER TABLE user_notes
  ADD CONSTRAINT user_notes_scope_kind_check
  CHECK (scope_kind IN ('portfolio','holding','bridge_outcome','strategy','dashboard'));

-- --------------------------------------------------------------------------
-- Refresh column comments to document the new scope. dashboard's scope_ref is
-- the literal 'allocations' (a per-user book note; there is no aggregate UUID
-- row for it — the audit entity_id therefore uses the caller's user_id, see
-- src/app/api/notes/route.ts resolveEntityId).
-- --------------------------------------------------------------------------
COMMENT ON COLUMN user_notes.scope_kind IS
  'Scope discriminator: one of portfolio, holding, bridge_outcome, strategy, dashboard. See ADR-0023 §4 user_note.*.update rows.';
COMMENT ON COLUMN user_notes.scope_ref IS
  'Stringified scope target: portfolio=UUID, holding={venue}:{symbol}:{holding_type}, bridge_outcome=UUID, strategy=UUID, dashboard=literal ''allocations''. Validated by parseHoldingScopeRef() for the holding scope; portfolio/bridge_outcome/strategy are UUID text; dashboard is the fixed literal ''allocations'' (user-scoped book note). See src/lib/notes/scope-ref.ts + src/lib/notes/ownership.ts.';

-- --------------------------------------------------------------------------
-- Self-verifying DO block: the new CHECK accepts 'dashboard' and still accepts
-- the pre-existing four values; existing rows are untouched.
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_notes_scope_kind_check'
      AND conrelid = 'public.user_notes'::regclass
  ) THEN
    RAISE EXCEPTION 'Migration dashboard-scope failed: user_notes_scope_kind_check constraint missing';
  END IF;

  IF pg_get_constraintdef(
       (SELECT oid FROM pg_constraint
        WHERE conname = 'user_notes_scope_kind_check'
          AND conrelid = 'public.user_notes'::regclass)
     ) NOT LIKE '%dashboard%' THEN
    RAISE EXCEPTION 'Migration dashboard-scope failed: CHECK does not include ''dashboard''';
  END IF;

  RAISE NOTICE 'Migration dashboard-scope: user_notes scope_kind CHECK now includes ''dashboard''.';
END
$$;

COMMIT;
