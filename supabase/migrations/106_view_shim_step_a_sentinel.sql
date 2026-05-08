-- Migration 106: Phase 19 / BACKBONE-04 step (a) sentinel.
--
-- The actual change is the Next.js route handler at
--   src/app/api/verify-strategy/route.ts:114-117
-- changing FROM:
--   .from("verification_requests").update({...})
-- TO:
--   .from("strategy_verifications").update({...})
--
-- This migration carries NO schema change. It exists so the migration
-- sequence preserves the 4-PR VIEW-shim ordering for audit (BACKBONE-04
-- step (a) per Phase 19 entry-gate migration-plan.md).
--
-- Plan-checker note: this migration MUST be applied in commit (a) alongside
-- the route.ts repoint. Commit message convention: `phase-19-shim-step-a:`.
--
-- The 4-PR VIEW-shim sequence:
--   (a) Repoint verify-strategy/route.ts writes from verification_requests
--       to strategy_verifications. This migration is the sentinel.
--   (b) Flip the kill-switch flag (process_key_unified_backbone) to 'on'.
--   (c) ≥168h soak window — observe error budgets via flag-monitor cron.
--   (d) Migration 107 — rename verification_requests to _legacy + create
--       VIEW + INSTEAD OF triggers.

DO $$
BEGIN
  RAISE NOTICE 'Migration 106: Phase 19 / BACKBONE-04 step (a) — verify-strategy/route.ts repoint sentinel.';
END
$$;
