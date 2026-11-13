---
phase: 199-managerhome
reviewed: 2026-11-10T00:00:00Z
depth: standard
base: 9bc83f894fa4a249ea3582fb26282c86d86797b3
head: 4906ed664
files_reviewed: 32
files_reviewed_list:
  - src/app/home/page.tsx
  - src/lib/routing/role-home.ts
  - src/lib/routing/default-route.ts
  - src/proxy.ts
  - next.config.ts
  - src/lib/auth/requireRolePage.ts
  - src/app/(auth)/login/page.tsx
  - src/components/auth/LoginForm.tsx
  - src/app/(auth)/pending-approval/page.tsx
  - src/components/auth/OnboardingWizard.tsx
  - src/app/(marketing)/page.tsx
  - src/app/error.tsx
  - src/app/not-found.tsx
  - src/app/(dashboard)/error.tsx
  - src/app/(dashboard)/admin/error.tsx
  - src/app/(dashboard)/admin/page.tsx
  - src/app/(dashboard)/admin/usage/page.tsx
  - src/app/(dashboard)/allocations/error.tsx
  - src/app/(dashboard)/allocations/components/AlertBanner.tsx
  - src/app/(dashboard)/strategies/layout.tsx
  - src/app/(dashboard)/strategies/[id]/layout.tsx
  - src/app/(dashboard)/strategies/new/layout.tsx
  - src/app/(dashboard)/strategies/page.tsx
  - src/app/(dashboard)/strategies/error.tsx
  - src/components/layout/Sidebar.tsx
  - src/components/strategy/StrategyTable.tsx
  - src/components/exchanges/AllocatorSyncStatus.tsx
  - src/lib/strategy-health.ts
  - src/lib/status-surface-copy.ts
  - src/lib/degrade-warnings.ts
  - src/lib/factsheet/origin.ts
  - src/app/factsheet/[id]/v2/page.tsx
  - e2e/helpers/login.ts
  - e2e/role-home.spec.ts
findings:
  critical: 0
  warning: 3
  info: 0
  total: 3
  necessity: 0
status: issues_found
---

# Phase 199: Code Review Report

**Reviewed:** 2026-11-10
**Depth:** standard (routing and health paths traced across modules)
**Files Reviewed:** 34 of the 153 files in the diff. I read the routing, guard, merged-list, health and degrade-copy paths in full. I only skimmed tests and the bulk-edited admin pages.
**Status:** issues_found

## Summary

The role-home redirect, the deep-link sanitiser and the guard split are sound. `safeRedirectPath` holds against `//host`, `/\host`, absolute URLs and arrays. The `/login?code=` exchange used to redirect to an unsanitised `params.redirect`, and this phase fixes that open redirect. The guard split from `/strategies` into `[id]/layout.tsx` and `new/layout.tsx` covers every subdirectory. `/pending-approval` cannot loop on itself, because approval implies a known role or `is_admin`. Placeholder rows render all three manager cells, so table columns stay aligned for allocator viewers.

I found three MEDIUM defects, all user-facing. Only MEDIUM and above are reported, as the caller asked. Severity mapping: MEDIUM is recorded as `warning`.

Executor-reported points I checked and dismissed (not defects introduced by this phase):
- `admin/partner-import` and `admin/partner-roi` have no page-level guard. This predates the phase, neither directory is in the diff, and both are client shells over `/api/admin/*`. It is out of scope here.
- The 308 from `/my-strategies` is browser-cached. The founder accepted this in D-01. Legacy `from=my-strategies` is mapped to `strategies` in `origin.ts` (`LEGACY_ORIGIN_KEYS`), and no live `/my-strategies` literal remains outside the manifest and comments.
- The `strategy_shares` read for allocator-only viewers is owner-scoped by RLS (`created_by = auth.uid()`). `liveShareIds` is used only under `isManager`. It is a wasted read, not a defect.
- `degrade-warnings.ts` pulling `status-surface-copy` into client bundles: both are pure modules with no server-only imports. That affects bundle size, not correctness.
- R-05 / D-06: the list uses 197's 7/10-day ladder while the factsheet chip and SyncBadge stay on 3d/7d. The founder accepted this on 2026-11-10 and routed it to Phase 201, so it is not re-raised.
- The `/home` catch around `isAdminUser`: `isAdminUser` returns `false` on database errors rather than throwing, so the catch is near-dead. The real consequence is WR-03.

## Warnings

### WR-01: Error-boundary escape link now leads back into the page that crashed (user-facing)

**File:** `src/app/(dashboard)/allocations/error.tsx:52`, `src/app/(dashboard)/admin/error.tsx:52`, `src/app/error.tsx:58` (also `src/app/(dashboard)/error.tsx:41`)
**Issue:** Each boundary's only escape besides "Try again" used to be "Go to Discovery", a different, stable page. It is now "Go to your home page", which points at `/home`. `/home` redirects by role to `/allocations`, `/strategies` or `/admin`, which are exactly the pages these boundaries most often catch. The escape is a dead end in these cases:
- An allocator whose `/allocations` render throws clicks "Go to your home page" and goes `/home` → `/allocations` → the same boundary.
- An admin whose `/admin` throws goes `/home` → `/admin` → the same boundary.
- When `/home` itself throws on a profile-read failure (`src/app/home/page.tsx:54`, a deliberate `throw error`), or the dashboard layout throws, the root boundary's link points back at `/home`, which throws again.

Neither button can get the user out. Related: `src/app/(dashboard)/strategies/error.tsx:50` (not edited) still offers "Add a strategy" → `/strategies/new`. D-01 now admits allocators to `/strategies`, and `/strategies/new` is manager-only, so an allocator who clicks it is silently redirected to `/allocations` by `requireRolePage`.
**Fix:** Point segment boundaries at a destination outside the failing segment. For example, keep `DISCOVERY_LANDING_ROUTE` ("Go to Discovery") on `allocations/error.tsx`, `admin/error.tsx` and the root `error.tsx`, or add both links:
```tsx
<Link href={DISCOVERY_LANDING_ROUTE}><Button variant="ghost">Go to Discovery</Button></Link>
```
In `strategies/error.tsx`, offer "Add a strategy" only on a manager surface, or replace it with a neutral link.

### WR-02: Analytics-failed row with no job on record claims a read failure and says reload (user-facing)

**File:** `src/app/(dashboard)/strategies/page.tsx:1157-1165` (with `failedFactsOf` at 1031-1085 and `jobDayOf` at 208)
**Issue:** `if (!facts || facts.jobDay === null)` renders `strategies.compute-status-unreadable`: "We could not read this strategy's computation status. Reload this page to try again." `jobDay` is also `null` when the jobs read succeeded and simply returned no factsheet job. That happens when done jobs are purged after 30 days, or when the failure was recorded without a job. So every strategy whose analytics failed more than about 30 days ago reads "Analytics failed", followed by a false read-failure sentence and a reload remedy that can never work. It also hides the real remedy (`ownerRemedy` with `analyticsFailed`, i.e. contact or resync). This is the false-remedy class KCS-21 exists to prevent. 199-16-SUMMARY records it as "known limit, recorded not fixed".
**Fix:** Separate the two null causes. Only a real read failure gets the unreadable line. A successful read with no job renders the analytics-failed remedy without a day:
```ts
const readFailed = !facts || facts.state?.state === "unreadable";
if (readFailed) return <DegradeLine id="strategies.compute-status-unreadable" … />;
if (facts.jobDay === null) {
  // no job on record: state the failure and the remedy, no day
  const remedy = ownerRemedy(facts.state ?? { state: "never_started" }, shapeOf(s, facts.compositeHistory), s.id, { buildUnreadable: false, analyticsFailed: true });
  return <DegradeLine id="strategies.analytics-failed-undated" … />; // new registry entry, undated scope
}
```
`facts.state` comes from `deriveComputeState({ readError: true })` on the read-error branches, so it can tell the two cases apart. A new registry entry needs its `degrade-warning-scan` census row.

### WR-03: `/admin` and `/home` can bounce an admin between them; the "can never disagree" claim is false (user-facing)

**File:** `src/app/home/page.tsx:17-19,56-67`; `src/app/(dashboard)/admin/page.tsx:23` (and the 12 other admin pages now ending in `redirect(ROLE_HOME_ROUTE)`)
**Issue:** `/home` sends a user to `/admin` when `profiles.is_admin` (read by `/home`'s own query) is true. `/admin` denies with `isAdminUser`, whose `hasIsAdminFlag` swallows any non-RLS error and returns `false` (`src/lib/admin.ts`, the `reportNonRlsError` branch). It then falls through to `hasAdminRoleRow`, which also returns `false` on error. Before this phase a denied `/admin` went to `/discovery/crypto-sma`, which ends the chain. Now it goes to `/home`. If the `/admin` gate query fails while the `/home` profile read succeeds (statement timeout, pool exhaustion, a PostgREST blip on one of two back-to-back reads), the browser follows `/home → /admin → /home → …`. It shows `ERR_TOO_MANY_REDIRECTS` and never reaches an error boundary or Sentry with a useful signal. Each hop re-queries, so this needs a sustained partial failure, which keeps the likelihood low. But the file's doc comment (T-199-08) asserts the two "can never disagree", and that is not true while `isAdminUser` fails open to `false`.
**Fix:** Make the admin-page denial terminal again. Redirect non-admins to `roleSurfaceHome(role)`, or to `DISCOVERY_LANDING_ROUTE`, never to `/home`. Alternatively, have `/home` decide admin with the exact `isAdminUser` call the admin pages use, without the separate `profile.is_admin` short-circuit, so both make the same query and fail the same way. Correct the T-199-08 comment either way.

---

_Reviewed: 2026-11-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunt (round 1, pr-review-toolkit:silent-failure-hunter)

### SFH-01 (MEDIUM, user-facing): /home catch around isAdminUser only console.errors
`src/app/home/page.tsx:54-62`. No captureToSentry (the sibling profile branch has it); admin falls through to a non-admin home. Overlaps WR-03 (isAdminUser mostly returns false instead of throwing). Fix together with WR-03: capture at level error and make /home and the admin pages agree on one admin check.

### SFH-02 (MEDIUM, user-facing, data-integrity signal): /home sends a missing profile row to /pending-approval
`src/app/home/page.tsx:40-49` + `src/lib/routing/role-home.ts:40-42`. `.maybeSingle()` returns `{data:null,error:null}`; `roleHomeFor(null)` gives /pending-approval. `strategies/page.tsx` and `requireRolePage` treat a missing profile as impossible (log, Sentry, throw). Fix: same in /home.

### SFH-03 (MEDIUM, user-facing, lower confidence): stale_no_data row remedy hardcodes `{ state: "never_started" }`
`src/app/(dashboard)/strategies/page.tsx` `healthDetailFor`, `stale_no_data` branch. Compute jobs are only read for analytics_failed rows, so a failed_permanent or stalled job under a pending/missing analytics row still shows the never-started remedy. Fix: derive the remedy from the row's real compute state (same facts path WR-02 uses), never a hardcoded state.
