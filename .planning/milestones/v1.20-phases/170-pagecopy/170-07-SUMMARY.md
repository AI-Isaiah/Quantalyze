---
phase: 170-pagecopy
plan: 07
subsystem: ui
tags: [marketing, header, session, compare, routing]

requires:
  - phase: 170-01
    provides: the seeded authed sweep that expects Go to app on /security and /legal/privacy
  - phase: 170-02
    provides: the layout-narrow /compare row that forbids the missing-control wording
provides:
  - a signed-in marketing masthead with one Go to app link and no identity
  - DEFAULT_AUTHENTICATED_ROUTE in one data-only module
  - /compare empty and one-item copy that names a control that exists
affects: [170-08, reflow-sweep-authed, layout-narrow N-CMP]

actuals:
  tokens: 4264
  tasks: 3
  commits: 6

plan_head_before: ab747147433917dcc15f6edf3e60fc7060a98f00
plan_head_after: ae616eb2d63d57c0c72a06aed6b44092896ef04c

tech-stack:
  added: []
  patterns:
    - "MarketingHeaderActions is an async server component; the layout function stays synchronous and renders it as a child"
    - "The session read is the only statement in the try. JSX is returned after it"

key-files:
  created:
    - src/lib/routing/default-route.ts
    - src/components/marketing/MarketingHeaderActions.tsx
    - src/components/marketing/MarketingHeaderActions.test.tsx
  modified:
    - src/app/(marketing)/layout.tsx
    - src/app/(marketing)/page.tsx
    - src/proxy.ts
    - src/app/(dashboard)/compare/page.tsx
    - src/app/(dashboard)/compare/page.test.tsx

key-decisions:
  - "JSX stays outside the session try so react-hooks/error-boundaries stays clean. A failed read still fails closed."
  - "Other hardcoded copies of /discovery/crypto-sma were left. This plan moves the proxy, the landing page and the masthead only."
  - "The one-item note keys off resolved items, so one holding uses the same sentence as one strategy."

patterns-established:
  - "DEFAULT_AUTHENTICATED_ROUTE is imported from src/lib/routing/default-route.ts and is not declared in src/proxy.ts"
  - "Signed-out masthead classes stay the previous Sign in and Sign up strings. Go to app reuses the Sign up string"

requirements-completed: ["SC2-HEADER", "SC2-COMPARE"]

coverage:
  - id: D1
    description: "Signed in, the marketing masthead is one Go to app link to the default route and renders no email or id. Signed out, or on an auth failure, Sign in and Sign up keep today's classes."
    requirement: SC2-HEADER
    verification:
      - kind: unit
        ref: "src/components/marketing/MarketingHeaderActions.test.tsx#renders one Go to app link and no identity when getUser resolves a user"
        status: pass
      - kind: unit
        ref: "src/components/marketing/MarketingHeaderActions.test.tsx#renders Sign in and Sign up, and no Go to app, when getUser resolves no user"
        status: pass
      - kind: unit
        ref: "src/components/marketing/MarketingHeaderActions.test.tsx#renders the signed-out links when getUser returns an error"
        status: pass
      - kind: unit
        ref: "src/components/marketing/MarketingHeaderActions.test.tsx#renders the signed-out links when getUser rejects"
        status: pass
      - kind: unit
        ref: "src/components/marketing/MarketingHeaderActions.test.tsx#renders the signed-out links when createClient rejects"
        status: pass
    human_judgment: false
  - id: D2
    description: "/compare with no ids keeps the Compare Strategies heading and names the factsheet control. One resolved item shows the caption note. Two resolved items do not."
    requirement: SC2-COMPARE
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/compare/page.test.tsx#with no ids, keeps Compare Strategies and names the factsheet control"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/compare/page.test.tsx#with one resolvable id, shows the one-strategy note in text-caption text-text-muted"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/compare/page.test.tsx#with two resolvable ids, does not show the one-strategy note"
        status: pass
    human_judgment: false
  - id: D3
    description: "The proxy and the landing page read DEFAULT_AUTHENTICATED_ROUTE from the shared module. PUBLIC_ROUTES is unchanged."
    requirement: SC2-HEADER
    verification:
      - kind: unit
        ref: "src/proxy.test.ts (101 tests; authenticated bounce still lands on /discovery/crypto-sma)"
        status: pass
      - kind: unit
        ref: "src/components/marketing/MarketingHeaderActions.test.tsx#renders one Go to app link and no identity when getUser resolves a user"
        status: pass
      - kind: other
        ref: "npm run lint (check-route-contract OK — 58 page routes)"
        status: pass
    human_judgment: true
    rationale: "No test renders Home and asserts the redirect argument is the imported constant. The landing change is the import plus the redirect call, checked by reading the diff and by tsc."

duration: 12min
completed: 2026-09-27
status: complete
---

# Phase 170 Plan 07: Signed-in marketing header and compare pointer Summary

**Signed-in /security and legal pages offer Go to app, and /compare names the factsheet control instead of a control that does not exist**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-27T22:24:43Z
- **Completed:** 2026-09-27T22:36:30Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Signed in, `MarketingHeaderActions` renders one `Go to app` link to `DEFAULT_AUTHENTICATED_ROUTE` with the previous Sign up class, and the output contains neither the email nor the id. Signed out, and when `getUser` or `createClient` fails, Sign in and Sign up render with the previous class strings.
- The layout stays a synchronous server component and renders that async child. `createClient` reads cookies (`src/lib/supabase/server.ts`), which opts the marketing routes into dynamic rendering (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`). No cache directive was added.
- `/compare` with no ids keeps the `Compare Strategies` heading and says to open a factsheet and choose "Compare strategies". One resolved item shows the caption note. Two resolved items do not.

## Task Commits

Each task was committed atomically:

1. **Task 1: the marketing masthead reads the session and shows Go to app when signed in** - `3a5620927` (test), `2839bdeaf` (feat), `10ef2a268` (fix)
2. **Task 2: the proxy and the landing page read the default route from the shared module** - `752c9dc84` (feat)
3. **Task 3: /compare names the control that exists and states the one-strategy limit** - `b9556fc2a` (test), `ae616eb2d` (feat)

**Plan metadata:** pending docs commit

## Files Created/Modified

- `src/lib/routing/default-route.ts` - data-only `DEFAULT_AUTHENTICATED_ROUTE`
- `src/components/marketing/MarketingHeaderActions.tsx` - async server component for the masthead actions
- `src/components/marketing/MarketingHeaderActions.test.tsx` - signed-out, signed-in, and fail-closed cases
- `src/app/(marketing)/layout.tsx` - the two static links replaced by the child; wordmark and masthead classes unchanged
- `src/proxy.ts` - imports the constant; `PUBLIC_ROUTES` unchanged
- `src/app/(marketing)/page.tsx` - authed redirect uses the constant
- `src/app/(dashboard)/compare/page.tsx` - empty-state sentence and the one-item note
- `src/app/(dashboard)/compare/page.test.tsx` - zero, one and two id cases

## Decisions Made

- The session read is the only statement inside the try. Both link trees are returned after it. The error-boundaries lint rejects JSX constructed in try/catch, and a render error is not what that catch is for.
- The one-item note uses `items.length === 1`. A single resolved holding gets the same sentence as a single strategy. The plan's action is "exactly one item resolved", and the sentence is the Copywriting Contract literal.
- The two "not available yet" sentences are that contract (AD-11). They are the product copy, not a stub.

## Known duplication

`/discovery/crypto-sma` is still hardcoded outside the three importers this plan was allowed to touch. Left as-is, per the plan: `src/components/auth/LoginForm.tsx`, `src/components/auth/OnboardingWizard.tsx`, `src/app/(auth)/pending-approval/page.tsx`, `src/app/(dashboard)/discovery/layout.tsx`, the non-admin redirects under `src/app/(dashboard)/admin/`, and the error-page links that point at the discovery listing. Nav links and breadcrumbs that name that page were also left alone. They are a page URL, not a second declaration of the constant.

## RED at HEAD

Task 1, `npx vitest run src/components/marketing/MarketingHeaderActions.test.tsx`, exit 1. The suite did not collect: `Failed to resolve import "./MarketingHeaderActions"`. The plan's step 1 is that missing module. Tests: 0.

Task 3, `npx vitest run "src/app/(dashboard)/compare/"`, exit 1. 2 failed, 49 passed:

- `with no ids, keeps Compare Strategies and names the factsheet control` — the new sentence was not in the DOM
- `with one resolvable id, shows the one-strategy note in text-caption text-text-muted` — unable to find the note
- `with two resolvable ids, does not show the one-strategy note` passed at HEAD, which is the unchanged 2+ branch

## Neuter

- Task 1: the signed-in branch was forced down the signed-out return (`if (error || !user || user)`). `renders one Go to app link and no identity when getUser resolves a user` went RED: expected 1 link, got 2. The condition was restored. The file then passed 5 tests.
- Task 3: the one-item paragraph was removed. `with one resolvable id` went RED: unable to find `One strategy selected. Adding a second strategy from this page is not available yet.` The paragraph was restored. The compare directory then passed 51 tests.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Masthead JSX moved out of the session try**
- **Found during:** Task 2 (`npm run lint`)
- **Issue:** `react-hooks/error-boundaries` rejects JSX constructed inside try/catch. Both returns in `MarketingHeaderActions` were inside the try, so lint exited 1.
- **Fix:** The try now only reads the session and sets a boolean. The links render after it. A thrown `createClient` or `getUser` still renders Sign in / Sign up.
- **Files modified:** `src/components/marketing/MarketingHeaderActions.tsx`
- **Verification:** the five masthead tests passed, and `npm run lint` then exited 0
- **Committed in:** `10ef2a268`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fail-closed behavior is unchanged. No new surface.

## Issues Encountered

- `SC2-HEADER` and `SC2-COMPARE` are not rows in `.planning/REQUIREMENTS.md` (phase-local ids, ROADMAP says Requirements TBD). Nothing there was checked off. Both ids are also declared by 170-01 and 170-02, which already have summaries. No later plan declares them.
- Seeded `e2e/reflow-sweep-authed.spec.ts` (`/security`, `/legal/privacy`) and `e2e/layout-narrow.spec.ts` (`/compare — N-CMP`) were not run here. No browser check. What was verified: `npx vitest run src/components/marketing/ "src/app/(dashboard)/compare/" src/proxy.test.ts` — 7 files, 157 tests, passed; `npx tsc --noEmit -p .` clean; `npm run lint` clean (admin-route manifest 20 routes, route contract 58 pages).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for 170-08. CI `e2e-seeded` still has to show `Go to app` on the signed-in `/security` and `/legal/privacy` rows, and the `/compare — N-CMP` row green. The unseeded signed-out marketing shell was not run locally.

## Self-Check: PASSED

- FOUND: `src/lib/routing/default-route.ts`
- FOUND: `src/components/marketing/MarketingHeaderActions.tsx`
- FOUND: `src/components/marketing/MarketingHeaderActions.test.tsx`
- FOUND: `src/app/(marketing)/layout.tsx`
- FOUND: `src/proxy.ts`
- FOUND: `src/app/(marketing)/page.tsx`
- FOUND: `src/app/(dashboard)/compare/page.tsx`
- FOUND: `3a5620927`
- FOUND: `2839bdeaf`
- FOUND: `10ef2a268`
- FOUND: `752c9dc84`
- FOUND: `b9556fc2a`
- FOUND: `ae616eb2d`

---
*Phase: 170-pagecopy*
*Completed: 2026-09-27*
