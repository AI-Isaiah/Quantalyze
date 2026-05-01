-- Migration 094: strategy_verifications RLS polish
-- Phase 15 / WR-05 follow-up — replace the strategy_verifications_owner_select
-- IN-subquery form with the equivalent EXISTS clause.
--
-- Why this migration exists
-- -------------------------
-- Migration 093 shipped strategy_verifications_owner_select as:
--
--   USING (strategy_id IN (SELECT id FROM strategies WHERE user_id = auth.uid()))
--
-- The IN-subquery is functionally correct for Phase 15: a strategy owner can
-- always see their own strategies regardless of `status`, so the inner SELECT
-- returns the right id set. But the policy is brittle — when strategies' RLS
-- itself has predicates (e.g. `status='published'` for public reads), the
-- inner subquery does NOT inherit the embedding context. A future stricter
-- strategies-RLS that restricts SELECT on the owner's own draft rows would
-- silently break trust-tier reads.
--
-- The EXISTS form is the idiomatic Postgres-RLS pattern. It is functionally
-- equivalent today (same row set returned for the same auth.uid()) but is
-- explicit about the join column and signals intent. The
-- strategy-verifications-rls.test.ts integration suite (Phase 15 / Plan 15-06
-- Task 2B) pins the contract end-to-end, so the refactor is verified by the
-- same anti-leak invariant tests that verified the IN form.
--
-- Why this is a separate migration (not an amendment to 093)
-- -----------------------------------------------------------
-- Migration 093 is already applied to the linked Supabase TEST project
-- (qmnijlgmdhviwzwfyzlc). Modifying 093 in-place after it shipped would
-- diverge the production migration from what was applied. The clean path is
-- a forward migration that DROPs and recreates the policy with the new body.
--
-- What this migration does
-- ------------------------
-- 1. DROP POLICY strategy_verifications_owner_select (IF EXISTS — idempotent
--    re-runs).
-- 2. CREATE POLICY strategy_verifications_owner_select with the EXISTS form.
-- 3. Self-verifying DO block: assert the policy exists with the expected
--    name (1 assertion). The EXISTS-vs-IN body difference is verified by
--    src/__tests__/strategy-verifications-rls.test.ts at runtime.
--
-- What this migration does NOT do
-- -------------------------------
-- - Does NOT touch strategy_verifications_admin_select or
--   strategy_verifications_service_all (both keep their migration 093
--   bodies — those policies don't have the IN-subquery brittleness).
-- - Does NOT alter table shape / columns / indexes.
-- - Does NOT modify the finalize_csv_strategy RPC.
-- - Does NOT change the policy semantics — same auth.uid() filter, same
--   row visibility, just a more explicit join expression.
--
-- Application path
-- ----------------
-- Same as 093 — applied to the linked Supabase TEST project via
-- mcp__plugin_supabase_supabase__apply_migration. The self-verifying DO
-- block raises EXCEPTION on assertion failure; the migration is wrapped in
-- BEGIN/COMMIT so a failed assert rolls the whole thing back.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: Drop the IN-subquery owner-select policy from migration 093.
-- ==========================================================================
DROP POLICY IF EXISTS strategy_verifications_owner_select ON strategy_verifications;

-- ==========================================================================
-- STEP 2: Recreate with the EXISTS form (Phase 15 / WR-05 fix).
-- ==========================================================================
-- The EXISTS body is functionally equivalent to the IN-subquery for any
-- value of auth.uid() (both return rows whose strategy_id belongs to a
-- strategies row with user_id = auth.uid()). The advantage is explicit
-- about the join column (strategy_verifications.strategy_id = s.id) and
-- does not rely on the inner subquery re-evaluating strategies' RLS in a
-- separate context — the EXISTS predicate joins on the row's own
-- strategy_id without engaging the implicit IN-rewrite.
CREATE POLICY strategy_verifications_owner_select ON strategy_verifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM strategies s
      WHERE s.id = strategy_verifications.strategy_id
        AND s.user_id = auth.uid()
    )
  );

-- ==========================================================================
-- STEP 3: Self-verifying DO block — 1 assertion.
-- ==========================================================================
DO $$
DECLARE
  v_policy_count INT;
BEGIN
  SELECT count(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname='public' AND tablename='strategy_verifications'
      AND policyname='strategy_verifications_owner_select';
  IF v_policy_count <> 1 THEN
    RAISE EXCEPTION 'Migration 094 failed: expected 1 owner_select policy, found %',
      v_policy_count;
  END IF;

  RAISE NOTICE 'Migration 094: strategy_verifications_owner_select rebuilt with EXISTS form.';
END
$$;

COMMIT;

-- ==========================================================================
-- END OF MIGRATION 094
-- ==========================================================================
-- Summary:
--   Step 1 — DROP POLICY strategy_verifications_owner_select (IN-subquery form)
--   Step 2 — CREATE POLICY strategy_verifications_owner_select (EXISTS form)
--   Step 3 — self-verifying DO block: 1 assertion
--
-- Verification at runtime:
--   src/__tests__/strategy-verifications-rls.test.ts — pins the anti-leak
--   invariant (foreign-user SELECT returns []) end-to-end against this
--   policy. A regression that breaks the EXISTS body trips the suite.
