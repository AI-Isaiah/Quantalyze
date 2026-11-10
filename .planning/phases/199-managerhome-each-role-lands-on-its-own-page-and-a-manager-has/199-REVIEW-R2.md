---
phase: 199-managerhome
round: 2
reviewed: 2026-11-10T16:28:07Z
depth: standard
base: 9bc83f894
fix_base: 6843933a8
head: 2b2130a4c
files_reviewed: 22
files_reviewed_list:
  - src/app/error.tsx
  - src/app/(dashboard)/admin/error.tsx
  - src/app/(dashboard)/allocations/error.tsx
  - src/app/(dashboard)/strategies/error.tsx
  - src/app/(dashboard)/strategies/error.test.tsx
  - src/__tests__/role-home-call-sites.test.ts
  - src/app/home/page.tsx
  - src/app/home/page.test.tsx
  - src/app/(dashboard)/strategies/page.tsx
  - src/app/(dashboard)/strategies/page.merged.test.tsx
  - src/lib/degrade-warnings.ts
  - src/lib/degrade-warnings.test.tsx
  - src/__tests__/degrade-warning-scan.test.ts
  - src/app/(dashboard)/discovery/layout.tsx
  - src/lib/auth/requireRolePage.ts
  - src/lib/admin.ts
  - src/app/(auth)/pending-approval/page.tsx
  - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
  - src/app/(dashboard)/allocations/components/MissingDataMessage.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - src/components/degrade/DegradeLine.tsx
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
status: issues_found
---

# Phase 199: Code Review Report, Round 2

**Reviewed:** 2026-11-10
**Depth:** standard. I traced the fix paths across modules: the boundary escape targets through their segment guards, and `/home` through `isAdminUser` and `/pending-approval`.
**Files Reviewed:** 22. That is the full fix diff (`6843933a8..2b2130a4c`) plus the guards it routes through. For Task 3 I skimmed the round-1-unread source files: `AllocationDashboardV2`, `MissingDataMessage`, `HoldingsTable`, `AlertBanner`, `FactsheetView`, factsheet `page`, `factsheet-share`, tearsheet, `DegradeLine`, `StrategiesSection`, `DashboardChrome`, `closed-sets`, `route-contract-manifest`, `next.config.ts` and the `ci.yml` hunk.
**Status:** issues_found

## Summary

Five of the six round-1 findings are closed. WR-01's fix creates a new user-facing MEDIUM on the strategies boundary (WR-01-R2 below). I report MEDIUM and above only, as the caller asked, and record MEDIUM as `warning`. Necessity was not assessed: this round is scoped to fix verification.

Evidence I ran: `npx vitest run` on page.merged, degrade-warnings, degrade-warning-scan, role-home-call-sites, home/page and strategies/error gave 6 files and 200 tests green. The whole `src/app/(dashboard)/strategies` directory was also green.

### Round-1 closure

| Finding | Closed? | Notes |
|---|---|---|
| WR-01 (escape links) | **Partly.** Closed for root, admin and allocations. **Regressed on `strategies/error.tsx`**, see WR-01-R2. | Discovery is allocator-only, so the new link fails for managers on their own surface. |
| WR-02 (no-job row claims a read failure) | Yes | Only a derived `unreadable` state prints the reload line. A successful read with no job prints `strategies.analytics-failed-undated` with the `ownerRemedy` action: the shape remedy for `never_started`, and the edit, Exchanges or contact page for the viewer. The census moved in all three id lists (scan `LIST_PAGE`, `SAMPLES`, `DETAIL_IDS`). No other file enumerates these ids. |
| WR-03 (`/home` and `/admin` bounce) | Yes, to the bar | `/home` now asks `isAdminUser`, the same function the admin guards call. The residual is judged below. |
| SFH-01 (`isAdminUser` catch only logs) | Yes | The catch now captures and throws. It is close to dead: `isAdminUser` returns `false` on database errors (`hasIsAdminFlag` and `hasAdminRoleRow` both call `reportNonRlsError` and return false). It only fires if the client itself throws. That is harmless, and the function already does its own Sentry report. |
| SFH-02 (missing profile goes to `/pending-approval`) | Yes | The profile row is written by the `AFTER INSERT ON auth.users` trigger in the signup transaction (`20260405061912_rls_policies.sql:82`, which raises on failure). A new signup cannot reach `/home` without a row, so the throw cannot hit a legitimate first login. |
| SFH-03 (stale-no-data remedy hardcoded) | Yes | The remedy comes from the row's real compute state. A failed or non-exhaustive read prints the unreadable line. |

### Residuals the fixers recorded

**(a) WR-03 residual: a refused admin page still redirects to `/home`. Below the bar, not MEDIUM.**
A loop needs `isAdminUser` to answer true and false alternately, by independent failures, on each hop of the browser's redirect chain (about 20 hops before `ERR_TOO_MANY_REDIRECTS`). A single flap costs one wrong landing, and the next hop corrects it. A sustained failure makes both sides refuse, and the user stops at a terminal page.

One caveat for whoever books it: the rewritten docblock says a sustained failure "lands the user on their role surface". That is not true for an admin whose approval rests only on `is_admin`. `/home` overrides `is_admin` to false and sends that admin to `/pending-approval`. `/pending-approval` re-reads the raw flag and redirects to `/admin`, which refuses and sends the admin back to `/home`. That chain still needs `isAdminUser`'s `profiles.is_admin` read to fail while `/pending-approval`'s identical read succeeds, so it is the same flap condition. Correct the docblock sentence when it is next touched. No code change is needed for this round.

A related trade-off, also below the bar: `/home` now ignores the `profile.is_admin` it has just read. One transient error in `isAdminUser` therefore lands an admin on `/allocations` (role `both`) for one page view, with a Sentry event from `reportNonRlsError`. That is the price of the shared decision, and it heals on the next navigation.

**(b) Topic B residual: a stale-no-data row with a queued or running job says "No figures yet, and no computation is running." Below the bar. Book it as LOW.**
I checked reachability:
- `strategies.stale-no-data` is chosen only when `strategyHealthOf` finds the analytics status is not `failed`, not `pending` or `computing` (`deriveEmptySeriesState` treats both as computing, so they show "Updating"), and not computed. In practice that means a **missing** analytics row on a strategy older than the 16 h `MISSING_ROW_COMPUTING_WINDOW_MS`, or an unrecognised status.
- **Queued:** the sentence "no computation is running" is literally true. The remedy is reload, which now matches.
- **Retrying:** `mark_compute_job_failed` calls `sync_strategy_analytics_status`, which writes `computing`, so the row becomes "Updating".
- **Running, compute phase:** `analytics_runner._mark_computing` writes `computing` (writer census at `src/app/api/keys/sync/route.ts:57-108`), so the row becomes "Updating".
- What is left is a missing-row strategy whose first job is in its fetch phase, before `_mark_computing`. That window lasts minutes, and the remedy shown ("Reload this page to see the latest status.") is the right next step and clears the line.

This is a false clause in a transient, narrow state with a correct remedy beside it. It does not reach the user-facing MEDIUM bar. Fix it with the next copy pass: suppress the "no computation is running" clause, or add an in-progress variant, for `queued` and `running`.

## Warnings

### WR-01-R2: The strategies boundary's new escape link sends a manager back into the page that crashed (user-facing, regression from the WR-01 fix)

**File:** `src/app/(dashboard)/strategies/error.tsx:51-54`. Pinned by `src/app/(dashboard)/strategies/error.test.tsx:82-90` and by `ESCAPE_BOUNDARIES` in `src/__tests__/role-home-call-sites.test.ts:121-126`.

**Issue:** The fix replaced "Add a strategy" (`/strategies/new`) with "Go to Discovery" (`DISCOVERY_LANDING_ROUTE` = `/discovery/crypto-sma`). Discovery is allocator-only: `src/app/(dashboard)/discovery/layout.tsx:45` calls `requireRolePage(supabase, user, "allocator")`. For a manager-only user, `requireRolePage` takes its wrong-role branch, `redirect(roleSurfaceHome("manager"))`, which goes to `/strategies` (`src/lib/auth/requireRolePage.ts` final line; `src/lib/routing/role-home.ts` `roleSurfaceHome`).

So when the `/strategies` list page throws, the path is: manager clicks "Go to Discovery", lands on `/discovery/crypto-sma`, gets a 307 to `/strategies`, and the same page throws into the same boundary. Neither "Try again" nor the escape gets the user out. This is the exact dead end WR-01 was raised to remove, and it now sits on the primary role's home surface: `/strategies` is where `/home` sends every manager. Before the fix, "Add a strategy" was a working exit for a manager, because `/strategies/new` renders outside the list page.

The link label also contradicts `default-route.ts`: "a link labelled Discovery that lands on a role page lies". The same lie, without a dead end, appears for a manager-role user on the root boundary and for a manager-role admin on `admin/error.tsx`. Both get a page that is not Discovery.

The new test cannot catch this. It asserts only `href === DISCOVERY_LANDING_ROUTE`, and its comment claims the link is "valid for every role".

**Fix:** Point the strategies boundary, and preferably all four escape boundaries, at a destination that every approved role can open and that sits outside every role surface. `/profile` qualifies: `src/app/(dashboard)/profile/page.tsx` has no `requireRolePage`, only `!user` → `/login` and `!profile` → `/onboarding`.

```tsx
// strategies/error.tsx (and root/admin/allocations if the label lie is fixed too)
<Link href="/profile">
  <Button variant="ghost">Go to your profile</Button>
</Link>
```

If Discovery stays on the allocations boundary, which only allocator and `both` users reach, that boundary is fine as it is. Move `strategies/error.tsx` out of `ESCAPE_BOUNDARIES` / `DISCOVERY_CONSTANT_CONSUMERS` in the census. Then make the test able to fail: assert that the escape target is not under a segment whose `layout.tsx` or `page.tsx` calls `requireRolePage`, for example by mapping the href to its `src/app/(dashboard)/<segment>` directory and reading the file the way the census test already does.

## Task 3: rest of the phase diff

I found no further MEDIUM+ defect in the files listed above. I checked the following and dismissed them:
- `FactsheetBody`'s `ownerView` derivation (T-199-22): every non-owner mount passes `layout="document"` with no `ownerShare` and fails closed to the recipient line. Before the phase, member names showed to every viewer, so there is no regression either way.
- `StalenessBanner` with no active keys: the registry has an explicit `labels.length === 0` sentence.
- The strategies-page Sentry stage tag `analytics-failed-day` is now also emitted for stale-no-data rows. The tag is wrong for those rows, but this is observability only.
- A non-exhaustive (window-full) jobs read on a stale-no-data row now prints the reload line, where it used to print a shape remedy. A reload cannot fix a window-full read. The analytics-failed rows have shown the same pre-existing behaviour since plan 16. It is rare. LOW.
- `StrategiesSection`'s `categorySlug` changes from `my-strategies` to `strategies`, so an allocator's saved sort and density preferences reset once. That is a one-time UX reset, not a defect.

---

_Reviewed: 2026-11-10T16:28:07Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunt (round 2)

### SFH-R2-01 (MEDIUM, user-facing, admins): /home's admin check cannot fail loudly; its test exercises an impossible throw
`src/app/home/page.tsx` isAdminUser try/catch + `roleHomeFor({ ...profile, is_admin: isAdmin }, { isAdmin })`; test `src/app/home/page.test.tsx` "a throwing isAdminUser reports to Sentry and throws". `isAdminUser` (`src/lib/admin.ts`) never throws: non-RLS errors become false. So the catch is dead, a DB blip on the admin read overrides a true `profiles.is_admin` and lands an admin on a role surface or /pending-approval, and an is_admin + newbie-status admin under a sustained admin-read failure cycles /home -> /pending-approval -> /admin -> /home. Fix: a strict admin check that throws on non-RLS errors (option or sibling in src/lib/admin.ts), used by /home (and the admin guards if minimal), dead catch removed or made live, test rewritten so the mocked supabase returns an error for the admin read and asserts throw, not redirect. Also correct the /home docblock sentence the reviewer flagged (Task 2a).

### SFH-R2-02 (judged LOW by orchestrator, booked, not fixed)
stale-no-data sentence "no computation is running" for in-flight jobs. Reviewer R2 Task 2b measured that retrying/running jobs write `computing` (row reads Updating), leaving only a short pre-`_mark_computing` fetch window where the reload remedy is correct.
