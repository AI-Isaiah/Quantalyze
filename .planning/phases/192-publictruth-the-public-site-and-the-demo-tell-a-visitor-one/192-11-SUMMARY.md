---
phase: 192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one
plan: 11
subsystem: routing
tags: [next, proxy, route-contract, cdn-headers, demo-retirement]

requires:
  - phase: 192-publictruth
    provides: "192-05 plan (demo page loud-failure code, removed here with the page)"
provides:
  - "/demo page tree deleted; no /demo route in the production build"
  - "/demo out of PUBLIC_ROUTES, the bounce-exempt set, the route-contract manifest and the CDN header rules"
  - "proxy.test.ts pins /demo and sub-paths as non-public in both directions"
  - "192-EVIDENCE.md placeholder-build probe for the retirement"
affects: [192-12, 192-13, 192-14, 192-15, 192-10]

actuals:
  tokens: 15000
  tasks: 2
  commits: 2
plan_head_before: 40574c28a9232b8fe39d4a4501986a5d3444fbcf
plan_head_after: 43ac8bb908e67195d95b8b545e09bbefa64bc18f

tech-stack:
  added: []
  patterns:
    - "Retired public route: removed from PUBLIC_ROUTES so the proxy answers it like an unknown URL; a proxy test pins the anonymous redirect"

key-files:
  created: []
  modified:
    - src/proxy.ts
    - src/proxy.test.ts
    - src/lib/routing/route-contract-manifest.ts
    - src/__tests__/display-sign-single-source.test.ts
    - next.config.ts
    - eslint.config.mjs
    - "src/app/(marketing)/layout.tsx"
    - .planning/phases/192-publictruth-the-public-site-and-the-demo-tell-a-visitor-one/192-EVIDENCE.md
  deleted:
    - "src/app/(marketing)/demo/page.tsx"
    - "src/app/(marketing)/demo/layout.tsx"
    - "src/app/(marketing)/demo/page.max-dd-tone.test.tsx"
    - "src/app/(marketing)/demo/page.truth.test.tsx"

key-decisions:
  - "A signed-out request for a retired /demo gets the unknown-URL answer (307 to /login), not a 404, because the proxy gates every signed-out path outside PUBLIC_ROUTES before Next routes it; D-11 wins over the 404 wish (plan Decision note, reversible)"

requirements-completed: [ROUTE-03, TRUST-01]

coverage:
  - id: D1
    description: "A production build of the phase branch has no /demo page and lists /security"
    requirement: ROUTE-03
    verification:
      - kind: other
        ref: "192-EVIDENCE.md 'D-11 /demo: build-route=absent' (from .next/app-path-routes-manifest.json)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A signed-out GET of /demo, /demo?persona=active and /demo/founder-view gets the same status and Location path as a never-existing control URL"
    requirement: ROUTE-03
    verification:
      - kind: integration
        ref: "192-EVIDENCE.md 'D-11 /demo anon answer: matches control' (next start on placeholder build, curl)"
        status: pass
    human_judgment: false
  - id: D3
    description: "/demo is in neither PUBLIC_ROUTES nor the bounce-exempt set, and proxy.test.ts fails if it returns"
    requirement: TRUST-01
    verification:
      - kind: unit
        ref: "src/proxy.test.ts#anonymous request to a non-public route redirects to /login (3 /demo rows, shown RED before the edit)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Route-contract manifest has no /demo entry and reports 56 page routes"
    requirement: ROUTE-03
    verification:
      - kind: other
        ref: "npx tsx scripts/check-route-contract.ts -> OK — 56 page routes"
        status: pass
    human_judgment: false
  - id: D5
    description: "next.config.ts sets s-maxage nowhere; the /demo probe responses carry no cache-control header"
    requirement: TRUST-01
    verification:
      - kind: other
        ref: "grep -c s-maxage next.config.ts -> 0; probe table in 192-EVIDENCE.md"
        status: pass
    human_judgment: false
  - id: D6
    description: "Display-sign census no longer names the deleted page and passes with every other row unchanged"
    verification:
      - kind: unit
        ref: "src/__tests__/display-sign-single-source.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "Lint scope and marketing shell docblock no longer name the deleted page; lint chain green"
    verification:
      - kind: other
        ref: "npm run lint exit 0; npx tsc --noEmit exit 0"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-11-07
status: complete
---

# Phase 192 Plan 11: Retire the public /demo page Summary

**The public /demo page, its PUBLIC_ROUTES and bounce-exempt entries, its route-contract row and its s-maxage CDN rule are gone in one lockstep commit, and a placeholder production build shows /demo answering a signed-out visitor exactly like a URL that never existed.**

## Performance

- **Duration:** about 8 min
- **Started:** 2026-11-07T01:50Z
- **Completed:** 2026-11-07T01:58Z
- **Tasks:** 2
- **Files modified:** 8 edited, 4 deleted

## Accomplishments

- RED first: three new anonymous-redirect rows in `src/proxy.test.ts` (`/demo`, `/demo?persona=active`, `/demo/founder-view`) failed with `expected 200 to be 307` while `PUBLIC_ROUTES` still listed `/demo`; then went green once the entry was removed.
- Deleted the four files under `src/app/(marketing)/demo/`, the manifest row, the `isDemoRoute` const and its `isAuthBounceExempt` arm, the `/demo` `PUBLIC_ROUTES` entry, the `/demo/:path*` headers block in `next.config.ts` (`s-maxage` count 3 to 0; closes the 500-page caching finding of plan 192-08 at its source) and the census rows for the page.
- Added a signed-in case: a signed-in GET of `/demo` is not redirected by the proxy (passes to Next, which has no route).
- Placeholder production build (CI env of `frontend-build`) succeeded; `.next/app-path-routes-manifest.json` lists `/security` and nothing equal to or under `/demo`. Probe on `next start -p 3197` recorded in 192-EVIDENCE.md: all three `/demo` rows and the control `/no-such-page-192` answer 307 with Location path `/login` and no cache-control header.
- The lint scope and the `(marketing)` layout docblock no longer name the deleted page (the docblock change is comment-only).

## Task Commits

1. **Task 1: /demo leaves the page tree, manifest, proxy and CDN rules, proved on a placeholder build** - `b2a3f7b22` (feat)
2. **Task 2: lint scope and marketing shell docblock stop naming the deleted page** - `43ac8bb90` (chore)

**Plan metadata:** the SUMMARY commit follows these (docs).

Measured: `git rev-list --count 40574c28a..HEAD` is 2 at SUMMARY write (before the SUMMARY commit).

## Importer check (classification before deletion)

`git grep -n -E "\(marketing\)/demo/(page|layout)" -- src e2e scripts eslint.config.mjs` hits, as the plan expected:

- `e2e/demo-public.spec.ts:13` (a comment; the spec is deleted by plan 192-14, left alone here)
- `eslint.config.mjs:266` (Task 2, removed)
- `src/__tests__/display-sign-single-source.test.ts:96, :162, :867` (SCAN_FILES, CENSUS_FILES, allowlist entry; removed)

The two page test files import the page by relative path and were deleted with it. No other importer, so no checkpoint.

## Task 2 acceptance

Task 2 commit `43ac8bb90`: `git show --format= 43ac8bb90 -- "src/app/(marketing)/layout.tsx"` has 2 hunks; every added or removed line starts with ` *` after the marker (a filter for non-comment lines printed nothing).

## Gate readings (real numbers)

- `npx vitest run` on the five Task 1 verify files: 5 files, 329 tests passed.
- `npx vitest run` on every test reading a changed file (proxy, manifest, next.config, route-contract, contracts, share-lane headers, frozen spine, critical-regressions, seed-integrity, app-url-guard, legacy-host-redirect, factsheet pdf/og/tearsheet tests, display-sign census): 23 files, 814 tests passed.
- `npx tsx scripts/check-route-contract.ts`: `OK — 56 page routes`.
- `npm run lint`: exit 0 (eslint 0 errors; 2 pre-existing unused-var warnings in `MetricsColumn.tsx` and `composite-read-path.ts`, files this plan did not touch; admin manifest, route contract, planning hygiene and canonical domain checks all OK).
- `npx tsc --noEmit`: exit 0.
- Not run here: Playwright e2e (needs a seeded environment); `e2e/demo-public.spec.ts` still exists and is removed by plan 192-14.
- Acceptance greps: demo dir gone; `"/demo"` in proxy.ts 0; `isDemoRoute` 0; `"/api/demo"` 1; manifest `route: "/demo"` 0; `s-maxage` in next.config.ts 0; `turbopack` in next.config.ts 0 (restored from a byte backup, `cmp` silent); census page string 0; eslint `(marketing)/demo` 0 and `demo/layout` 0; marketing layout `/demo` 0; UUID grep on the evidence file 0.

## Deviations from Plan

None - plan executed exactly as written. Two notes that are not deviations:

- The `turbopack.root` workaround was needed (the first build failed with "Could not find the Next.js package" under the symlinked `node_modules`); it was applied, then removed before any commit.
- The docblock at the top of `src/proxy.test.ts` (audit lineage from 2026-05-07 naming `/demo` and `/demonstration`) was left as dated history; it is not an active entry.

## Known Stubs

None.

## Threat Flags

None. The change removes public surface and adds none.

## Left for sibling plans (not touched)

`/api/demo` PUBLIC_ROUTES entry and `src/app/api/demo` (192-15); demo-only components and readers (192-13); demo e2e specs and CI wiring (192-14); match-queue demo props (192-12). `next.config.ts` line `"/api/demo/portfolio-pdf/\\[id\\]": CHROMIUM_BIN` stays with 192-15. Phase 193 fence respected: nothing under `src/app/factsheet` or `src/lib/factsheet` was touched. No PROD access or write.

## Self-Check

- Files created/deleted verified: demo dir absent; evidence section present.
- Commits `b2a3f7b22` and `43ac8bb90` exist on `wt/192-p11`.

## Self-Check: PASSED
