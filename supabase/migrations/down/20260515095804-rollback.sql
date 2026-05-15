-- Rollback for migration 132: Phase 19 / PR-X5 teaser-anchor sentinel.
--
-- Removes the three rows seeded by 132_teaser_anchor_strategy.sql in
-- reverse FK order (strategies → profiles → auth.users) so each delete
-- never trips an FK constraint on the row that comes next.
--
-- Pre-condition: no strategy_verifications rows still reference the
-- sentinel strategy. The teaser flow writes SV rows with
-- strategy_id='00000000-0000-0000-0000-000000000001', so if PR-X5 (or
-- successors) has shipped and processed any teaser submissions, those
-- SV rows must be deleted (or re-anchored) FIRST. This rollback file
-- does NOT cascade-delete SVs by design — it errors loudly via the FK
-- constraint so the operator notices.

BEGIN;

-- 1) Remove the teaser-anchor strategy. FK from strategy_verifications
-- to strategies(id) will block the delete if any SV row still
-- references the sentinel; that's the intended safety check.
DELETE FROM public.strategies
 WHERE id = '00000000-0000-0000-0000-000000000001'::uuid;

-- 2) Remove the sentinel profile. ON DELETE CASCADE on strategies.user_id
-- would have already removed the strategies row above if we did this in
-- the opposite order; explicit ordering keeps the audit trail clear.
DELETE FROM public.profiles
 WHERE id = '00000000-0000-0000-0000-000000000000'::uuid;

-- 3) Remove the sentinel auth.users row. profiles.id FKs to auth.users
-- ON DELETE CASCADE, so this must come AFTER the profiles delete above
-- (or it would cascade-delete the profile we wanted to delete
-- explicitly for the audit log).
DELETE FROM auth.users
 WHERE id = '00000000-0000-0000-0000-000000000000'::uuid
   AND email = 'system-phase-19-sentinel@quantalyze.internal';

COMMIT;
