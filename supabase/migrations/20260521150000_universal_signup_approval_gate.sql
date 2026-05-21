-- Universal signup-approval gate (task #14, dogfood report 2026-05-21).
--
-- BEFORE this migration: profiles.{allocator,manager}_status default to
-- 'newbie' on signup but no code path GATED on those statuses. New users
-- dropped straight into the dashboard with no signal that anything was
-- expected of them.
--
-- AFTER: the (dashboard)/layout + (auth)/onboarding pages call
-- isProfileApproved() and redirect un-verified rows to /pending-approval.
-- Existing convention is `'verified'` (see allocator-approve route which
-- writes `allocator_status='verified'`); we reuse that vocabulary instead
-- of inventing a parallel `approval_status` column.
--
-- Migration body: backfill every CURRENT profile to 'verified' so the
-- application of the gate does NOT silently lock out real users on the
-- next deploy. Only brand-new signups (which hit the schema default of
-- 'newbie') will encounter the pending-review screen.
--
-- The is_admin override applies regardless of status; the helper short-
-- circuits on is_admin=true. Explicitly set both status columns on admin
-- rows here too so a future helper change cannot regress admin access.

UPDATE profiles
SET allocator_status = 'verified'
WHERE allocator_status <> 'verified'
  AND role IN ('allocator', 'both');

UPDATE profiles
SET manager_status = 'verified'
WHERE manager_status <> 'verified'
  AND role IN ('manager', 'both');

UPDATE profiles
SET allocator_status = 'verified', manager_status = 'verified'
WHERE is_admin = true;
