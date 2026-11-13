---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 08
subsystem: routing
tags: [routing, role-home, error-boundaries, admin-guards, census]
requires: ["199-06"]
provides:
  - "six error and not-found boundaries link to ROLE_HOME_ROUTE under the label Go to your home page"
  - "OnboardingWizard pushes ROLE_HOME_ROUTE after a successful update"
  - "all 13 admin page guards bounce a non-admin to ROLE_HOME_ROUTE"
  - "src/__tests__/role-home-call-sites.test.ts: NAVIGATION_ALLOWLIST, DISCOVERY_CONSTANT_CONSUMERS, positive and loop arms"
affects: [ship CHANGELOG]
status: complete
commits: 3
plan_head_before: 65cf394c42466c383817a8e63ee28a1efd3e99c6
plan_head_after: a8de6f0d7e9c892e958ccab78fdb5d21ae5896c7
actuals:
  tokens: 20000
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns: ["comment-stripped call-site census with a count-pinned allowlist and vacuity fences"]
key-files:
  created:
    - src/__tests__/role-home-call-sites.test.ts
  modified:
    - src/app/error.tsx
    - src/app/error.test.tsx
    - src/app/not-found.tsx
    - src/app/(dashboard)/error.tsx
    - src/app/(dashboard)/admin/error.tsx
    - src/app/(dashboard)/admin/error.test.tsx
    - src/app/(dashboard)/allocations/error.tsx
    - src/app/(dashboard)/allocations/error.test.tsx
    - src/app/(dashboard)/compare/error.tsx
    - src/app/(dashboard)/compare/error.test.tsx
    - src/app/(dashboard)/admin/page.tsx
    - src/app/(dashboard)/admin/page.test.tsx
    - src/components/auth/OnboardingWizard.tsx
    - src/components/auth/OnboardingWizard.noseeed.test.tsx
    - "the twelve other src/app/(dashboard)/admin/**/page.tsx guards (compute-jobs, csv-status, deletion-requests, for-quants-leads, intros, match, match/[allocator_id], match/eval, partner-pilot/[partner_tag], usage, users, users/[id])"
key-decisions:
  - "OnboardingWizard's profile role load had no reader besides the destination ternary, so the useEffect, role state and Role import were removed rather than kept dead."
  - "not-found has no test of its own, so its home link is asserted inside src/app/error.test.tsx as the plan allows."
requirements-completed: [ROUTE-01]
---

# Phase 199 Plan 08: Every other home site moves to the role home, and a census keeps it there

**Six boundaries, OnboardingWizard and 13 admin guards read ROLE_HOME_ROUTE; a comment-stripped census fails on any new hard-coded Discovery path used as home, and on any home site that reaches Discovery through DISCOVERY_LANDING_ROUTE.**

## What was done

1. **Task 1 (tracer), 3ce607150.** `src/app/error.tsx` home link: `href={ROLE_HOME_ROUTE}`, label `Go to your home page`, `Try again` still first, variant and size unchanged. `/admin` wrong-role branch: `redirect(ROLE_HOME_ROUTE)`. Tests: root boundary link target and order, and a new non-admin bounce test in `admin/page.test.tsx` (the file had none). Both new tests were RED first (link not found; `REDIRECT:/discovery/crypto-sma` received).
2. **Task 2, c387a241a.** `not-found.tsx`, `(dashboard)/error.tsx`, `admin/error.tsx`, `allocations/error.tsx`, `compare/error.tsx` swapped the same way (bodies untouched). Three boundary tests plus `OnboardingWizard.noseeed.test.tsx` gained a link-target / push assertion; not-found is asserted in `error.test.tsx`. OnboardingWizard now pushes `ROLE_HOME_ROUTE`; its role load was dead afterwards and was removed.
3. **Task 3, a8de6f0d7.** The other twelve admin guards swapped (one identical token each plus one import line). `role-home-call-sites.test.ts` created.

### Census design (`src/__tests__/role-home-call-sites.test.ts`)

- Scans every production `.ts`/`.tsx` under `src` comment-stripped via `stripCommentsPreserveLines`; string contents survive, so the route-contract manifest note counts.
- `NAVIGATION_ALLOWLIST` (count-pinned, total 8, a reason each, a missing or miscounted file fails): `compare/page.tsx` 2 (breadcrumbs), `decks/page.tsx` 1 (breadcrumb), `discovery/[slug]/page.tsx` 1 (breadcrumb), `discovery/layout.tsx` 1 (Discovery login target), `Sidebar.tsx` 1 (filler), `route-contract-manifest.ts` 1 (manifest note), `default-route.ts` 1 ("holds DISCOVERY_LANDING_ROUTE, the Discovery landing").
- The factsheet Discovery links (`BackLink.tsx`, `origin.ts`) and `BrowseDiscoveryLink.tsx` carry no literal after 199-06; they are pinned by `DISCOVERY_CONSTANT_CONSUMERS`, so they are not on the literal allowlist.
- Positive arm: 24 home sites (proxy, marketing page, MarketingHeaderActions, LoginForm, OnboardingWizard, six boundaries, 13 guards) contain `ROLE_HOME_ROUTE`; `/home` and pending-approval contain `roleHomeFor(`.
- Discovery-constant arm: files naming `DISCOVERY_LANDING_ROUTE` are exactly `default-route.ts` plus the three consumers; a consumer that names `ROLE_HOME_ROUTE` fails; a home site naming the Discovery path or the constant fails.
- Loop arm (T-199-28): `/home` and all 13 guards call `isAdminUser(`; every guard redirects with `redirect(ROLE_HOME_ROUTE)`.
- Vacuity fences: production file count above 500, both constants found in default-route.ts, and the proxy docblock names the path while its stripped code does not (proves the comment strip bites).

## Neuter proofs (RED seen, restored from byte copy under the scratchpad, `cmp` identical)

gc-199-08-neuter: Task 1 - `src/app/error.tsx` home href put back to the Discovery path and label to Go to Discovery; `error.test.tsx` "links home to the role-home route" went RED (link not found); restored, cmp identical, 4/4 green.
gc-199-08-neuter: Task 2 - `(dashboard)/admin/error.tsx` href put back to the Discovery path; `admin/error.test.tsx` "home link targets the role-home route" went RED (1 failed, 6 passed); restored, cmp identical, 7/7 green.
gc-199-08-neuter: Task 3a - Discovery literal put back into `LoginForm.tsx`; the census went RED naming `src/components/auth/LoginForm.tsx (1x)` in the allowlist arm and in the no-home-site arm (2 failed, 8 passed); restored, cmp identical.
gc-199-08-neuter: Task 3b - `src/app/error.tsx` made to import and use `DISCOVERY_LANDING_ROUTE` instead of `ROLE_HOME_ROUTE`; the census went RED naming `src/app/error.tsx` in the positive arm, the no-home-site arm and the Discovery-constant arm (3 failed); restored, cmp identical, 10/10 green.

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 6 claims, no stale.
- `npx vitest run src/app/error.test.tsx "src/app/(dashboard)/admin/page.test.tsx" src/app/home/page.test.tsx`: 3 files, 19 tests green.
- `npx vitest run src/app/error.test.tsx "src/app/(dashboard)/admin/error.test.tsx" "src/app/(dashboard)/allocations/error.test.tsx" "src/app/(dashboard)/compare/error.test.tsx" src/components/auth/OnboardingWizard.noseeed.test.tsx`: 5 files, 28 tests green (error.test.tsx later gained the not-found test, 5 tests green).
- `npx vitest run src/__tests__/role-home-call-sites.test.ts "src/app/(dashboard)/admin" src/app/home/page.test.tsx`: 15 files, 88 tests green.
- `npx tsc --noEmit`: clean (no output).
- `npm run lint`: 0 errors; 4 pre-existing warnings in files this plan does not touch (`factsheet/[id]/v2/MetricsColumn.tsx`, `lib/factsheet/composite-read-path.ts`, `lib/queries.stale-analytics-detail.test.ts` x2); admin-route-manifest, route-contract, planning-hygiene and canonical-domain checks OK.
- Acceptance greps: `Go to Discovery` in boundary files (excluding tests, factsheet, BrowseDiscoveryLink) prints 0; `BrowseDiscoveryLink.tsx` keeps 1; `ROLE_HOME_ROUTE` in OnboardingWizard 3 (at least 1); `redirect("/discovery/crypto-sma")` under admin prints 0.

gc-199-08-gates: vitest=green tsc=clean lint=clean

## Deviations from Plan

None to the plan's behaviour. Notes:

- Task 1's `files_modified` did not list `src/app/(dashboard)/admin/page.test.tsx`; it had no non-admin case, so a test was added there to give the guard swap a failing-first arm (Rule 2, test coverage for a mitigation, T-199-10 / T-199-28).
- I edited all six boundary sources in one pass but committed only Task 1's two source files in the Task 1 commit and the rest in Task 2, so the commits match the plan's task split.
- `src/app/strategy/[id]/error.tsx` is still absent (`ls src/app/strategy` fails), so no seventh boundary was edited.

## Observations (not changed)

- `admin/partner-import/page.tsx` and `admin/partner-roi/page.tsx` carry no `isAdminUser` guard of their own. They are outside the 13 the plan names and do not redirect to Discovery, so the census does not cover them. Worth a look by whoever owns the admin surface; not touched here.
- `src/app/(dashboard)/error.tsx` has no test file; its link is covered by the census positive arm only.

## Left to CI

No SQL, Supabase or Docker lane was touched or run (disk rule); this plan changes no migration or SQL gate, so no SQL census moved. The full vitest shards, coverage ratchet and e2e jobs were not run locally; only the targeted files above were.

## Known Stubs

None.

## Threat Flags

None. The guards keep `isAdminUser`; only the bounce target changed (T-199-10), and the census loop arm pins that `/home` and every guard decide admin with the same predicate (T-199-28).

## Self-Check: PASSED

- src/__tests__/role-home-call-sites.test.ts present; commits 3ce607150, c387a241a, a8de6f0d7 verified ancestors of HEAD.
