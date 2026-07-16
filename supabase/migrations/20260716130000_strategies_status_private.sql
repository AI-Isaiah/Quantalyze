-- CONTRIB-02 (Phase 110) — widen strategies.status to admit an owner-only
-- 'private' terminal status.
-- 2026-07-16.
--
-- Why this migration exists
-- -------------------------
-- The contribution wizard (allocator "Add a Strategy") must finalize to an
-- owner-only status that is NEVER a publish candidate. The existing wizard
-- finalizes at status='pending_review', which IS a publish candidate: the
-- admin review queue lists `.eq("status","pending_review")` rows
-- (src/app/(dashboard)/admin/page.tsx:40) and the reviewer promotes them to
-- 'published' (src/app/api/admin/strategy-review/route.ts:175). A contributed
-- strategy must terminate somewhere the admin queue does not reach.
--
-- The status CHECK today (20260405061911_initial_schema.sql:63) is
--   CHECK (status IN ('draft','pending_review','published','archived'))
-- with constraint name `strategies_status_check`. There is no owner-only
-- terminal value. This migration widens the CHECK to add 'private'.
--
-- NOT an RLS-policy migration. The REQUIREMENTS non-goal rejects a NEW RLS
-- *policy* migration specifically. This is a CHECK-constraint widening — a
-- different object. The `strategies_read` policy
-- (20260405061912_rls_policies.sql:28-30 = `status='published' OR
-- user_id=auth.uid()`) ALREADY makes any non-published status owner-visible and
-- never-public with no policy change: 'private' is owner-visible + never in the
-- public catalog, and the admin queue's `pending_review` filter auto-excludes
-- it. No policy is created or altered here.
--
-- Safety: adding a value to an IN-list CHECK only WIDENS the admitted set — no
-- existing row can violate it (every current status is still admitted). The
-- pre-flight guard below fails loud with a diagnostic if that invariant is ever
-- false on a given environment, rather than letting ADD CONSTRAINT throw a bare
-- check_violation.
--
-- DROP-then-ADD idiom (re-runnable no-op; ordering-independent). Cloned from
-- 20260602180000_funding_fees_exchange_check.sql.

BEGIN;

-- Pre-flight: fail loud (listing the offending values) if any existing row
-- would violate the new constraint. Widening never drops a value, so this never
-- fires in practice — it documents the safety check and hands ops a precise
-- diagnostic if a prior environment somehow holds an out-of-set status.
DO $$
DECLARE
  bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT status, ', ') INTO bad
  FROM strategies
  WHERE status NOT IN ('draft', 'pending_review', 'published', 'archived', 'private');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'CONTRIB-02 migration aborted: strategies has out-of-range status value(s): %', bad;
  END IF;
END $$;

ALTER TABLE strategies
  DROP CONSTRAINT IF EXISTS strategies_status_check;
ALTER TABLE strategies
  ADD CONSTRAINT strategies_status_check
  CHECK (status IN ('draft', 'pending_review', 'published', 'archived', 'private'));

-- Self-verifying DO block: assert the constraint exists and admits 'private'
-- (the new value) alongside the four pre-existing values.
DO $$
DECLARE
  def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conname = 'strategies_status_check'
    AND conrelid = 'public.strategies'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'CONTRIB-02 migration failed: strategies_status_check not found';
  END IF;
  IF position('private' IN def) = 0
     OR position('draft' IN def) = 0
     OR position('pending_review' IN def) = 0
     OR position('published' IN def) = 0
     OR position('archived' IN def) = 0 THEN
    RAISE EXCEPTION 'CONTRIB-02 migration failed: CHECK missing an expected status value (def=%)', def;
  END IF;
END $$;

COMMIT;
