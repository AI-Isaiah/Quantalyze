---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 08
subsystem: browse
tags: [browse, session, auth, route-02, server-components]
requires: ["196-02", "196-17"]
provides:
  - hasBrowseSession(): React-cached, server-validated session boolean for /browse
  - session-aware BrowseLayout with a client Go to Discovery link
  - root and category sign-up prompts hidden for a signed-in reader
affects: [196-14]
tech-stack:
  added: []
  patterns: [React cache() around auth.getUser(), errors read as no session]
key-files:
  created:
    - src/app/browse/session.ts
    - src/app/browse/BrowseDiscoveryLink.tsx
    - src/app/browse/layout.session.test.tsx
    - src/app/browse/[slug]/page.session.test.tsx
  modified:
    - src/app/browse/layout.tsx
    - src/app/browse/page.tsx
    - src/app/browse/[slug]/page.tsx
    - src/app/browse/page.test.tsx
    - src/app/browse/breadcrumb-root.test.tsx
    - src/app/browse/disclaimer-once.test.tsx
decisions:
  - "A getUser error, rejection or null user is no session: the public page shows the visitor prompt when unsure"
  - "The category page reads the session inside its existing Promise.all fan-out; the root page reads it after the single-category redirect"
metrics:
  duration: "~20 min"
  completed: 2026-11-09
status: complete
actuals:
  tokens: 5200
  tasks: 2
  commits: 2
plan_head_before: 056a4e5ea1283034cbd11a552fc18938044af49f
plan_head_after: 1906cb1680e1df0495f27860de95caebfc61f394
---

# Phase 196 Plan 08: /browse session awareness Summary

A signed-in reader on /browse sees one "Go to Discovery" link instead of Log in / Sign up, and neither the root's Get Started Free block nor the category page's Sign up free box; a visitor sees all three exactly as before (ROUTE-02).

## What was built

- `src/app/browse/session.ts`: `hasBrowseSession = cache(async () => boolean)` over `createClient()` + `auth.getUser()` (never `getSession()`); any error, rejection or null user returns false (T-196-19).
- `BrowseLayout` is now async. With a session it renders `BrowseDiscoveryLink` (client, `usePathname`): `/browse/<known category slug>` goes to `/discovery/<slug>`, anything else (`/browse`, unknown slug) goes to `DEFAULT_AUTHENTICATED_ROUTE`. Classes per UI-SPEC: `text-body text-text-secondary hover:text-text-primary min-h-[44px] inline-flex items-center`, no underline, no accent.
- `page.tsx` and `[slug]/page.tsx` wrap their prompt blocks in `{!signedIn && (...)}`; copy and classes untouched.

## Per-request rendering (Task 1 acceptance, T-196-18)

The browse pages already render per request: `getBrowseCategories()` (`src/app/browse/browse-categories.ts`) awaits `getPopulatedCategorySlugs`, and `getStrategiesByCategory` / `getPercentiles` in `src/lib/queries.ts` each call `await createClient()` from `src/lib/supabase/server.ts`, which reads `cookies()` from `next/headers` (a dynamic API). No `dynamic`/`revalidate` export exists under `src/app/browse`. The root page reaches the same cookie-bound client through `getBrowseCategories`. So the session read does not change the caching class, and the helper exposes only a boolean.

## Verification

- `npx vitest run src/app/browse`: 5 files, 24 tests pass.
- `npx tsc --noEmit`: exit 0. `npm run lint`: exit 0 (two pre-existing unused-var warnings in `MetricsColumn.tsx` and `composite-read-path.ts`, not touched here).
- Acceptance greps: `hasBrowseSession` count 2 in `page.tsx`, 3 in `[slug]/page.tsx`, present in `layout.tsx`; `cache(` count 1 in `session.ts`; `Get Started Free` 1 and `Sign up free` 1 (copy unchanged).

## Neuter evidence (RED, restore, GREEN)

Each neuter was made from a `cp -p` backup in the scratchpad, run, restored with `cp -p`, then `cmp` (exit 0) and the full folder re-run GREEN.

| Neutered | Change | RED arm | cmp after restore |
|---|---|---|---|
| `layout.tsx` | `{signedIn ? (` to `{false ? (` | 3 signed-in arms in `layout.session.test.tsx` (Go to Discovery, default route, unknown slug) | 0 |
| `[slug]/page.tsx` | `{!signedIn && (` to `{true && (` | `is not rendered for a signed-in reader` | 0 |
| `page.tsx` | `{!signedIn && (` to `{true && (` | `hides the Get Started Free block for a signed-in reader and keeps the cards` | 0 |

## Deviations from Plan

None in design. Test plumbing beyond the plan text: `BrowseLayout` became async, so `disclaimer-once.test.tsx` now awaits `BrowseLayout({ children })` instead of rendering it as an element, and `usePathname` was added to the `next/navigation` mocks of that file and `breadcrumb-root.test.tsx`. Their assertions are unchanged.

## EDGE-ROUTE-02 (flagged assumption, recorded for the verifier)

Expired session: `getUser` returns a null user, visitor chrome. `getUser` error or throw: treated as no session (arms in `layout.session.test.tsx` and `[slug]/page.session.test.tsx`). A signed-in manager sees "Go to Discovery"; per the plan's note `/discovery` hides for managers in `Sidebar.tsx`, so the link may bounce them to their own workspace. Not measured in a browser.

## Known Stubs

None.

## Threat Flags

None. No new endpoints or trust boundaries beyond the session-cookie read the plan's threat model already covers.

## Not measured

No PROD access, no browser or e2e run in this plan (unit and static-markup tests only).

## Self-Check: PASSED

- Created files present: session.ts, BrowseDiscoveryLink.tsx, layout.session.test.tsx, [slug]/page.session.test.tsx.
- Commits b76f9b89f and 1906cb168 are ancestors of HEAD.
