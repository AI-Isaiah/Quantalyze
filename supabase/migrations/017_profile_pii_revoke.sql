-- Migration 017: REVOKE SELECT on profiles.email and profiles.linkedin
--
-- The profiles_read_public RLS policy (migration 002) is USING (true), which
-- lets any anon/authenticated client read every column on profiles. This was
-- fine for display_name + company + role, but email and linkedin are PII
-- that should only be accessible to: (a) the profile owner, (b) admins via
-- the service-role client.
--
-- Mirrors migration 012's column-level REVOKE pattern for bio/years_trading/
-- aum_range. Callers that need email or linkedin for non-self reads must go
-- through createAdminClient() with an explicit ownership check.
--
-- --------------------------------------------------------------------------
-- Caller audit (completed 2026-04-08 by PR 1 — hardening quick wins)
-- --------------------------------------------------------------------------
-- Every src/**/*.ts{,x} caller that SELECTs from `profiles` has been checked.
-- Admin-client sites are safe; user-client self-reads are safe; there are no
-- non-self non-admin reads of `email` or `linkedin` post-audit. The grid
-- below was the grep filter baseline — each site reviewed by hand.
--
--   ADMIN CLIENT (service_role, can still read email/linkedin) — OK:
--     src/lib/queries.ts                                  (manager identity)
--     src/app/(dashboard)/admin/page.tsx                  (admin triage)
--     src/app/(dashboard)/admin/partner-pilot/[partner_tag]/page.tsx
--     src/app/(dashboard)/profile/page.tsx                (self-read via admin)
--     src/app/api/admin/match/allocators/route.ts
--     src/app/api/admin/match/[allocator_id]/route.ts
--     src/app/api/admin/match/send-intro/route.ts
--     src/app/api/admin/match/preferences/[allocator_id]/route.ts
--     src/app/api/admin/intro-request/route.ts
--     src/app/api/admin/notify-submission/route.ts
--     src/app/api/admin/partner-import/route.ts
--     src/app/api/admin/strategy-review/route.ts
--     src/app/api/admin/allocator-approve/route.ts
--     src/app/api/demo/match/[allocator_id]/route.ts      (admin, seeded UUID)
--     src/app/api/intro/route.ts                          (admin for manager fetch)
--     src/app/demo/page.tsx                               (admin, seeded UUID)
--
--   USER CLIENT — NON-PII SELECTS ONLY (display_name/company/role) — OK:
--     src/app/(dashboard)/layout.tsx                      (select: role)
--     src/app/api/preferences/route.ts                    (no profiles select)
--
--   USER CLIENT — SELF-WRITE UPDATES (writes, not reads) — OK:
--     src/components/auth/OnboardingWizard.tsx            (update, not select)
--     src/components/auth/ProfileForm.tsx                 (update, not select)
--     src/lib/admin.ts                                    (is_admin only)
--
-- Strategy & tearsheet pages route manager identity (including linkedin)
-- through `loadManagerIdentity()` in src/lib/queries.ts, which is already
-- admin-client. No direct profiles reads from src/app/factsheet/**.
-- --------------------------------------------------------------------------

REVOKE SELECT (email, linkedin) ON profiles FROM anon, authenticated;

-- service_role already has full access via the owner privilege, but be
-- explicit for future grants that `email` + `linkedin` stay privileged.
GRANT  SELECT (email, linkedin) ON profiles TO service_role;

COMMENT ON COLUMN profiles.email IS
  'PII. REVOKEd from anon/authenticated per migration 017. Access via createAdminClient() only for non-self reads.';
COMMENT ON COLUMN profiles.linkedin IS
  'PII. REVOKEd from anon/authenticated per migration 017. Access via createAdminClient() only for non-self reads.';

-- --------------------------------------------------------------------------
-- TODO (post-merge verification)
-- --------------------------------------------------------------------------
-- After this migration lands in staging, confirm with a REST probe using the
-- anon key that `email` and `linkedin` return NULL (or a permission error)
-- for non-self rows:
--
--   curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/profiles?select=id,email,linkedin" \
--     -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
--     -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"
--
-- Expected: rows are returned but every `email` and `linkedin` field is null.
-- (Supabase's column-level REVOKE returns nulls rather than erroring, same
-- behaviour as migration 012's bio/years_trading/aum_range.)
