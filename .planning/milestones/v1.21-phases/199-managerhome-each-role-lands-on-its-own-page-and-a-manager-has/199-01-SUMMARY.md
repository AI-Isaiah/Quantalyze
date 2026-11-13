---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 01
subsystem: auth
tags: [routing, redirect, open-redirect, role-home, next-proxy]
requires: []
provides:
  - "src/lib/routing/role-home.ts: roleSurfaceHome, roleHomeFor, safeRedirectPath (pure)"
  - "A sanitised deep link at sign-in (login page, LoginForm, proxy bounce share one rule)"
  - "PendingApprovalPage and requireRolePage read the shared role map"
affects: [199-06 (home constant flip), 199-08 (other home sites)]
status: complete
commits: 4
plan_head_before: 1157767ef061176922916f1da92f3276a9083efd
plan_head_after: 1a00e850fbab2824fffc575900d3580642cd1d34
actuals:
  tokens: 6650
  tasks: 3
  commits: 4
tech-stack:
  added: []
  patterns: ["one pure role-home module imported by proxy, server pages and client forms"]
key-files:
  created:
    - src/lib/routing/role-home.ts
    - src/lib/routing/role-home.test.ts
    - src/app/(auth)/login/page.test.tsx
    - src/components/auth/LoginForm.test.tsx
  modified:
    - src/app/(auth)/login/page.tsx
    - src/components/auth/LoginForm.tsx
    - src/proxy.ts
    - src/proxy.test.ts
    - src/lib/auth/requireRolePage.ts
    - src/app/(auth)/pending-approval/page.tsx
    - src/app/(auth)/pending-approval/page.test.tsx
key-decisions:
  - "requireRolePage keeps the role-only surface home (not /home): it selects role only and `both` is never redirected (RESEARCH Pattern 1, item 3)."
  - "Spec-less edge probe not run (no SPEC.md); coverage authored from UI-SPEC UI Considerations and RESEARCH Validation Architecture (recorded choice, per plan)."
patterns-established:
  - "safeRedirectPath is the single sanitiser for any redirect/next query value"
requirements-completed: [ROUTE-01]
---

# Phase 199 Plan 01: Role-home lib and safe deep link Summary

One pure `role-home.ts` now decides a role's home and sanitises every `redirect`/`next` value, so a sign-in from `/login?redirect=/compare` lands on `/compare` and a hostile value never navigates.

## Tasks

| # | Task | Commit |
|---|------|--------|
| 1 (tracer) | role-home lib, login page `redirectTo`, LoginForm `redirectTo` prop, closed the open redirect in the login page's email-confirm code branch | 74cd413ee |
| 2 | proxy signed-in bounce reads `safeRedirectPath`; `requireRolePage` redirects to `roleSurfaceHome(role)` | 3aff97d2a |
| 3 | `PendingApprovalPage` sends an approved, onboarded user to `roleHomeFor(profile)` | 6d2d64b03 |
| (docblock) | `requireRolePage` docblock updated to name `roleSurfaceHome` | 1a00e850f |

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 8 claims, no stale.
- `npx vitest run src/lib/routing/role-home.test.ts "src/app/(auth)/login/page.test.tsx" src/components/auth/LoginForm.test.tsx src/components/auth/AuthForms.test.tsx src/proxy.test.ts src/lib/auth/requireRolePage.test.ts "src/app/(auth)/pending-approval/page.test.tsx"`: 7 files, 196 tests, all passed, none skipped. `requireRolePage.test.ts` is unmodified.
- `npx tsc --noEmit`: clean (no output).
- `npm run lint`: 0 errors. 4 pre-existing unused-variable warnings in files this plan does not touch (`MetricsColumn.tsx`, `composite-read-path.ts`, `queries.stale-analytics-detail.test.ts`); out of scope, not fixed. All four repo check scripts (admin-route manifest, route contract, planning hygiene, canonical domain) OK.
- Acceptance greps: `export function safeRedirectPath` 1; `"/discovery/crypto-sma"` in LoginForm 0; `params.redirect ||` in login page 0; `a-z]/.test(redirect)` in proxy 0; `safeRedirectPath(` in proxy 1; `const homeHref` in requireRolePage 0; `"/discovery/crypto-sma"` in pending-approval page 0; `roleHomeFor(` in pending-approval page 1.
- RED was seen before GREEN for every test file (role-home test failed on the missing module, login page / LoginForm / pending-approval cases failed against the HEAD behavior).

## Neuter evidence

Each neuter was made on a `cp -p` byte backup held outside the worktree, the failures named, the file restored, `cmp` exit 0, then GREEN again. Backups were deleted afterwards.

- gc-199-01-neuter: gate=role-home.test.ts + login/page.test.tsx + LoginForm.test.tsx (safeRedirectPath returns its input unchecked) result=red restored=identical. 19 failures: hostile-value cases (protocol-relative host, absolute URL, backslash host, uppercase start, empty, undefined, array, number), login page null/code-branch cases, LoginForm hostile pushes.
- gc-199-01-neuter: gate=proxy.test.ts (safeRedirectPath keeps only a non-empty-string check, slash-lowercase rule dropped) result=red restored=identical. 3 failures: the three hostile proxy bounce cases.
- gc-199-01-neuter: gate=pending-approval/page.test.tsx (roleHomeFor drops the admin arm) result=red restored=identical. 1 failure: the admin case got `/allocations`, expected `/admin`.
- gc-199-01-gates: vitest=green tsc=clean lint=clean

## Deviations from Plan

None to the plan's intent. Two small notes:

1. **[Rule 3 - acceptance wording]** The plan's acceptance requires `grep -c "const homeHref"` to print 0 in `requireRolePage.ts`, while the action text says "replace the ternary with roleSurfaceHome(role)". I inlined the call (`redirect(roleSurfaceHome(role))`) rather than keeping a `const homeHref = roleSurfaceHome(role)`, and updated the docblock lines that named `homeHref`. Behavior is identical. Commit 3aff97d2a and 1a00e850f.
2. **[Housekeeping]** The docblock fix is its own commit (`1a00e850f`) because I noticed the stale `redirect(homeHref)` reference after committing Task 2.

## Left to CI / not run

- No SQL, supabase or analytics-service files were touched, so no SQL gates, mypy or pytest apply. The local Supabase stack and Docker were not used (disk rule).
- Playwright/e2e specs that sign in (they select `input[name="email"]`, still pinned by `AuthForms.test.tsx`) were not run locally; CI covers them. LoginForm's push target moved from the literal to the shared constant, same value (`/discovery/crypto-sma`) until plan 199-06.

## Observations (not fixed, out of scope)

- `src/proxy.ts` assigns `url.pathname = safePath`. A `redirect` value carrying a query string (which `safeRedirectPath` accepts, as the proxy rule always did) would have its `?` percent-encoded into the path on the signed-in bounce. This is pre-existing behavior of the unchanged assignment; the plan says "no other proxy change". Worth a look in a later plan if deep links with queries must survive the proxy bounce (the LoginForm and login page paths do preserve them).

## Known Stubs

None.

## Threat Flags

None. T-199-01 (open redirect) is mitigated on all three paths with neuter evidence; T-199-02 (requireRolePage refactor) is output-identical with its test unmodified and green.

## Self-Check: PASSED

- FOUND: src/lib/routing/role-home.ts, role-home.test.ts, login/page.test.tsx, LoginForm.test.tsx
- FOUND commits 74cd413ee, 3aff97d2a, 6d2d64b03, 1a00e850f (ancestors of HEAD)
