---
phase: 109-role-predicate-unification-page-guards
reviewed: 2026-07-16T00:00:00Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - src/lib/auth/requireRolePage.ts
  - src/lib/auth/requireRolePage.test.ts
  - src/components/layout/Sidebar.tsx
  - src/components/layout/Sidebar.test.tsx
  - src/components/layout/MobileNav.test.tsx
  - src/app/(dashboard)/allocations/page.tsx
  - src/app/(dashboard)/compare/page.tsx
  - src/app/(dashboard)/decks/page.tsx
  - src/app/(dashboard)/recommendations/page.tsx
  - src/app/(dashboard)/discovery/layout.tsx
  - src/app/(dashboard)/strategies/layout.tsx
  - src/app/(dashboard)/portfolios/layout.tsx
  - supabase/migrations/20260716120000_backfill_staff_role_both.sql
  - supabase/tests/test_staff_role_both_backfill.sql
findings:
  critical: 0
  blocker: 0
  high: 1
  medium: 1
  low: 1
  total: 3
status: findings
---

# Phase 109: Code Review Report

**Reviewed:** 2026-07-16
**Depth:** deep (cross-file: call chains from dashboard layout → guards → admin.ts, marketplace consumers of `role`)
**Files Reviewed:** 14
**Status:** findings

## Summary

The core access-control mechanism is sound. `requireRolePage` correctly implements the
three-branch discipline (DB-error → throw/503-equivalent, missing-profile → throw,
wrong-role → `redirect()`), keeps every `redirect()` OUTSIDE any `try/catch` (no
NEXT_REDIRECT swallow / fail-open), and derives `homeHref` internally from the actual
role so the redirect matrix is provably loop-free. All four allocator flat-pages and
the discovery layout attach the guard before their attestation `try` blocks; the two
new segment layouts (`strategies`, `portfolios`) correctly guard entire subtrees (not
just index pages) and pin `force-dynamic` to prevent a future cached-render fail-open.
Tests are strong and assert the new pure-role behavior (including that a bare-`isAdmin`
fixture surfaces NO workspace). `profiles.role` is `NOT NULL DEFAULT 'manager' CHECK IN
(manager,allocator,both)`, so the migration's `role <> 'both'` predicate and the SQL
test's `role NOT IN ('both')` have NO three-valued-logic hole, and the guard's
unknown-role branch is unreachable defensive code (fine).

The defects below concern the **completeness of the "atomic gate" reasoning**, not the
guard mechanics. The migration and guards key on `profiles.is_admin` / `profiles.role`,
but the dashboard layout's `isAdmin` — the exact value the dropped `|| isAdmin` OR-in
consumed — is BROADER than `profiles.is_admin`. That mismatch leaves a residual
self-lockout (HIGH) and a marketplace-visibility side effect (MEDIUM).

## Narrative Findings (AI reviewer)

### HIGH-01: Backfill under-covers the admin predicate the `|| isAdmin` drop actually relied on — join-table-only admins self-lock out (T-109-06 not fully closed)

**File:** `supabase/migrations/20260716120000_backfill_staff_role_both.sql:44-47`,
`src/app/(dashboard)/layout.tsx:44,63-73`, `src/lib/admin.ts:283-308`

**Issue:** The migration's atomic-gate contract is "dropping `|| isAdmin` is safe because
every admin is backfilled to `role='both'`." But it backfills only
`WHERE is_admin = true` — i.e. `profiles.is_admin`. The `isAdmin` value the OR-in
consumed comes from the dashboard layout, which sets it via `profiles.is_admin` OR, when
that is false, `isAdminUser()` (layout.tsx:63-65). `isAdminUser` grants admin on a
SECOND signal — a `user_app_roles.role='admin'` row — even when `profiles.is_admin=false`
(admin.ts:299, explicitly documented as a supported "manual INSERT into user_app_roles
without a corresponding profiles flip still grants admin here").

Such a "join-table-only admin" (profiles.is_admin=false, user_app_roles admin=true) is
NOT touched by the backfill, so its `profiles.role` stays whatever it was (default
`'manager'`). After the OR-in drop:
- **Nav:** loses the allocator workspace (`isAllocator = role IN ('allocator','both')`
  is now false) — Sidebar/MobileNav surface only the manager set + Admin.
- **Page guards (worse):** `requireRolePage(user,'allocator')` on `/allocations`,
  `/compare`, `/decks`, `/recommendations`, `/discovery/*` reads `profiles.role` only and
  actively `redirect()`s them to `/strategies`. Before Phase 109 there were no such
  guards, so this is a hard new access regression for that population — the very
  T-109-06 self-lockout the "inseparable" migration claims to prevent, still open for the
  subset where `admin ≠ profiles.is_admin`.

The SQL invariant test shares the blind spot: it asserts only
`is_admin=true → role='both'` (test_staff_role_both_backfill.sql:37-41) and says nothing
about `user_app_roles` admins, so CI cannot catch this gap.

Whether the prod population is non-empty is not verifiable from source, but the code path
is explicitly designed and supported, so the gate's own safety claim is incomplete.

**Fix:** Either (a) widen the backfill/guard reasoning to the true admin predicate, or
(b) prove the population is empty and document it. Concretely, extend the backfill to
cover join-table admins:
```sql
UPDATE profiles p
SET role = 'both'
WHERE role <> 'both'
  AND (
    p.is_admin = true
    OR EXISTS (
      SELECT 1 FROM user_app_roles r
      WHERE r.user_id = p.id AND r.role = 'admin'
    )
  );
```
and add the corresponding empty-set assertion (no `user_app_roles.role='admin'` user with
`profiles.role <> 'both'`) to the SQL test. If the intent is that ONLY `profiles.is_admin`
counts as staff, then `layout.tsx` must stop widening `isAdmin` via `isAdminUser`, so the
nav/guard predicate and the backfill predicate agree.

### MEDIUM-01: Blanket `role='both'` promotion surfaces staff/admin accounts in marketplace `role IN (...,'both')` consumers

**File:** `supabase/migrations/20260716120000_backfill_staff_role_both.sql:44-47`,
consumers: `src/app/api/admin/match/allocators/route.ts:39-42`,
`src/app/(dashboard)/admin/page.tsx:47,60`,
`src/app/(dashboard)/admin/partner-pilot/[partner_tag]/page.tsx:77-78`

**Issue:** `profiles.role` defaults to `'manager'` and is `NOT NULL`, so before this
migration an ops-only admin (default `role='manager'`, or a genuine single-role staff
member) was absent from the allocator pool. The backfill flips EVERY admin to `'both'`,
and multiple consumers treat `role='both'` as a first-class allocator/manager for
purposes unrelated to nav/guards:
- `match/allocators` loads `.in("role", ["allocator","both"])` to build the admin match
  candidate pool — staff accounts now appear as matchable allocators.
- `admin/page.tsx` counts allocators (`.in("role", ["allocator","both"])`) and managers
  (`["manager","both"]`) — staff now double-count in both.

The Phase 109 design intent for `role='both'` is "what the staff member SEES" (nav +
guards), but the same column also drives "who the staff member IS" to the marketplace.
Promoting all admins couples the two. Blast radius is admin-internal (no public leak),
hence MEDIUM, but it is real data pollution in the match queue.

**Fix:** Exclude staff from marketplace role consumers rather than relying on `role`
alone, e.g. `match/allocators` → add `.eq("is_admin", false)` (or an explicit staff
filter) to the candidate query; or narrow the backfill so ops-only admins are not
promoted into pools they should not populate. Confirm with product which admins are
genuine marketplace participants.

### LOW-01: Page-level `redirect("/login")` now redundant with (and inconsistent with) the layout guard's `?redirect=` target

**File:** `src/app/(dashboard)/allocations/page.tsx:51`,
`src/app/(dashboard)/decks/page.tsx`, `src/app/(dashboard)/compare/page.tsx`,
`src/app/(dashboard)/strategies/page.tsx:15`

**Issue:** Segment layouts render and `await getUser()` before their child page, so the
new `strategies`/`portfolios` layouts already handle the unauthenticated case with a
`redirect("/login?redirect=/strategies")`. The child pages still run their own
`if (!user) redirect("/login")` — harmless defensive redundancy, but inconsistent
(bare `/login` vs the layout's `?redirect=` deep-link, so the surviving path drops the
return-to target). Not a security issue (both fail closed).

**Fix:** Optional — align the page-level redirects to include the same `?redirect=`
param, or drop them where the layout already covers auth. Low priority; leave if you
prefer defense-in-depth.

---

_Reviewed: 2026-07-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
