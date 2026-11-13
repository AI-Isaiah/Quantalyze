## Round 1 fixes (topic A)

Branch `fix/199-r1a`. Findings fixed: WR-01, WR-03, SFH-01, SFH-02. WR-02 and SFH-03 belong to the other fixer (`strategies/page.tsx`) and are not touched here.

Each test was proven by neutering the fix (source restored to its pre-fix bytes), seeing RED, then restoring from a byte backup. Checked in the worktree: `npx vitest run` on the touched files (all green), `npx tsc --noEmit -p .` (clean), `eslint` on the touched files (clean).

### WR-01: error-boundary escape links leave the failing surface

**Commit:** `431c0018a`
**Files:** `src/app/error.tsx`, `src/app/(dashboard)/admin/error.tsx`, `src/app/(dashboard)/allocations/error.tsx`, `src/app/(dashboard)/strategies/error.tsx`, their four tests, and `src/__tests__/role-home-call-sites.test.ts`.
**Fix:** the four boundaries now link "Go to Discovery" to `DISCOVERY_LANDING_ROUTE`, a page outside every failing surface. `strategies/error.tsx` no longer offers the manager-only "Add a strategy" link, which an allocator (admitted to `/strategies` by D-01) was silently bounced away from.
**Left alone on purpose:** `(dashboard)/error.tsx` and `compare/error.tsx` keep the role-home link. Every role-home surface (`/allocations`, `/strategies`, `/admin`) has its own boundary, so neither can catch the page `/home` redirects to. `not-found.tsx` is not a render failure.
**Census change:** `role-home-call-sites.test.ts` forbade the root, admin and allocations boundaries from importing `DISCOVERY_LANDING_ROUTE`. Those three plus strategies moved from `BOUNDARIES` to a new `ESCAPE_BOUNDARIES` list that joins `DISCOVERY_CONSTANT_CONSUMERS` (3 to 7), and `HOME_SITES` drops from 24 to 21. The invariant "a Discovery consumer never also names `ROLE_HOME_ROUTE`" still holds for all seven.
**Tests:** one new or rewritten arm per boundary test (`src/app/error.test.tsx`, admin, allocations, strategies `error.test.tsx`), plus the census. Neutered: 6 failures (4 boundary arms, 2 census arms).
**Status:** fixed

### SFH-02: `/home` sent a missing profile row to `/pending-approval`

**Commit:** `06cd0607a`
**Files:** `src/app/home/page.tsx`, `src/app/home/page.test.tsx`.
**Fix:** `maybeSingle()` returning `{ data: null, error: null }` now logs, calls `captureToSentry` (level `warning`, tags `route: "home"`, `stage: "profile-missing"`, matching `strategies/page.tsx`) and throws. It never redirects.
**Test:** "a missing profile row throws and reports, never lands on /pending-approval" replaces the test that pinned the old behaviour. Neutered: RED.
**Status:** fixed

### WR-03 + SFH-01: `/home` and the admin pages share one admin decision; a failed admin check reports

**Commit:** `aa9a92959`
**Files:** `src/app/home/page.tsx`, `src/app/home/page.test.tsx`.
**Fix:** `/home` no longer short-circuits on `profile.is_admin`. It calls `isAdminUser`, the call every admin page guard makes, and passes that answer to `roleHomeFor` (overriding `is_admin` on the profile it hands over, so the one answer also decides the approval short-circuit). If `isAdminUser` throws, `/home` logs, calls `captureToSentry` (level `error`, `stage: "admin"`) and throws instead of landing an admin on a non-admin home. The false "can never disagree" docblock is rewritten: it now says the two sides share a decision, and states the residual limit (see below).
**Tests:** "follows isAdminUser over the profile flag, so a refused admin page never bounces back to /admin" (a profile with `is_admin` but `isAdminUser` false must not go to `/admin`) and "a throwing isAdminUser reports to Sentry and throws". The old "failing claim check keeps the profile's answer" test, which pinned the silent fall-through, is replaced. Neutered: both new tests RED.
**Residual, not closed:** the admin pages still redirect a refused visitor to `/home` (CD-03 and the census arm "every admin guard bounces a non-admin to ROLE_HOME_ROUTE" are unchanged). The loop is now only possible if `isAdminUser` flaps between two consecutive requests. A sustained failure makes both sides refuse, and `/home` then lands the user on their role surface, which never redirects back. A provably terminal fix would redirect refusals to a non-`/home` target (Discovery or `roleSurfaceHome` after a profile read), which changes CD-03 and touches 13 pages, so it was not done. Flagged for the founder.
**Status:** fixed: requires human verification (logic change in routing)

### Not run

No e2e (`e2e/role-home.spec.ts`) and no full-repo `eslint src/`. The three `scripts/check-*` lint steps (admin-route-manifest, route-contract, planning-hygiene) pass.

## Round 2 fixes

Branch `fix/199-r2` (off `feat/199-managerhome` at `450d70f6b`). Findings fixed: WR-01-R2 and SFH-R2-01. SFH-R2-02 is booked as LOW and not touched. Each test was proven by neutering the fix, seeing RED, then restoring from a byte backup. Verification ran in the worktree `quantalyze-199-fix2`: targeted `npx vitest run` (the `strategies` directory, `src/lib/admin.test.ts`, `src/app/home`, `src/lib/auth`, the census and the root boundary test, all green), `npx tsc --noEmit -p .` (clean), `eslint` on the touched files (clean), `check-admin-route-manifest` and `check-route-contract` (OK).

### SFH-R2-01: `/home`'s admin check could not fail loudly

**Commit:** `9bb76ca76`
**Files:** `src/lib/admin.ts`, `src/lib/admin.test.ts`, `src/app/home/page.tsx`, `src/app/home/page.test.tsx`.
**Fix:** `isAdminUser` takes an optional `{ strict: true }`. With it, a non-RLS error on the `profiles.is_admin` read or the `user_app_roles` read is reported as before and then thrown. RLS rejections (42501) and a missing profile row (PGRST116) still answer false. `/home` passes `{ strict: true }`, so its catch is now live: it reports (`stage: "admin"`) and throws to the error boundary instead of overriding a true `profiles.is_admin` with a fail-closed false. The 13 admin page guards and `withRole` keep the default and still refuse on an error; they were not changed, because a sustained failure now ends at the error boundary and the `/home` -> `/pending-approval` -> `/admin` -> `/home` cycle needs a flapping read, not a failing one. The `/home` docblock sentence about a sustained failure landing the user on their role surface is replaced with the strict behaviour.
**Tests:** `/home`'s test no longer mocks `isAdminUser`. It mocks the supabase client, so the admin read returns `{ error }` the way a real one does, and asserts a throw, one Sentry capture and no redirect, for both the `profiles` read (with a true `is_admin` on the profile row) and the `user_app_roles` read. The earlier arms (admin by flag, admin by role row, refused flag) now drive the real function. `src/lib/admin.test.ts` gains three strict arms (throws on each read, still false on 42501 and PGRST116). Neutered (the throws removed): 2 `admin.test.ts` and 2 `/home` arms RED. Neutered (`/home` without `strict`): the 2 `/home` arms RED.
**Status:** fixed: requires human verification (logic change in routing)

### WR-01-R2: strategies boundary escape sent a manager back into the crashed page

**Commit:** `2307a02f5`
**Files:** `src/app/(dashboard)/strategies/error.tsx`, `src/app/(dashboard)/strategies/error.test.tsx`, `src/__tests__/role-home-call-sites.test.ts`.
**Fix:** the escape link is now "Go to your profile" -> `/profile`. `/profile` has no `requireRolePage` and no role layout (the `(dashboard)` layout checks approval only). Discovery is allocator-only, so a manager sent there was bounced straight back to `/strategies`.
**Census:** `strategies/error.tsx` moves out of `ESCAPE_BOUNDARIES` (7 Discovery-constant consumers become 6). A new `ROLE_FREE_ESCAPE_BOUNDARIES` arm asserts each listed boundary links to its declared target and that the target's route directory and ancestors have no `layout.tsx` or `page.tsx` calling `requireRolePage(`. A second arm proves the detector sees Discovery's guard, so the first can fail.
**Tests:** neutered by restoring the Discovery link: the strategies boundary arm, the Discovery-consumer census and the role-free arm RED. Neutered by pointing the target at `/discovery/crypto-sma`: the guard assertion fails naming `discovery/layout.tsx`.
**Not changed on purpose:** the root boundary (`src/app/error.tsx`) and `admin/error.tsx` still say "Go to Discovery". Per the reviewer these are label-only, with no dead end: a manager lands on `/strategies` and an admin on a role surface, neither of which is the crashed page. Changing them would touch two more boundaries and tests for a label, so they are left for the founder to book if wanted.
**Status:** fixed

### Not fixed

SFH-R2-02 (stale-no-data "no computation is running" for a queued or running job): booked as LOW by the orchestrator, per instruction.
