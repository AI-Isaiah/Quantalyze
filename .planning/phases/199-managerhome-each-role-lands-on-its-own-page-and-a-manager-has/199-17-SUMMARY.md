---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 17
subsystem: testing
tags: [e2e, playwright, role-home, redirect-canary, axe, reflow, ci-wiring, cd-01]
requires:
  - phase: 199-08
    provides: "the /home role-home redirect and the roleHomeFor decision"
  - phase: 199-13
    provides: "the /my-strategies 308 to /strategies"
  - phase: 199-16
    provides: "the merged list's final DOM (legend, Health column, registered Health detail lines)"
provides:
  - "e2e/role-home.spec.ts: a seeded allocator, manager and admin sign in through the real form and land on /allocations, /strategies, /admin; a safe ?redirect= wins; an off-origin one is ignored. In ci.yml's seeded list, pinned at 24, bound to the hydration guard"
  - "isPostLoginPath, the one pathname-anchored post-login predicate in e2e/helpers/login.ts, used by every wait that lacked a role's new landing"
  - "A /my-strategies?x=1 308 canary, the owner-list spec retargeted to /strategies with the R-04 origin, a /strategies reflow row and axe rows for allocator, manager and both"
affects: [199-18]
requirements-completed: [ROUTE-01, LEAN-01, ROUTE-11]
actuals:
  tokens: 8800
  tasks: 3
  commits: 3
plan_head_before: 299032e2722a85ae8eb5ae806726a0e2e0e72f96
plan_head_after: 01a3597b8562cc5ae5898cf4d61a76bf2868328d
status: complete
completed: 2026-11-10
tech-stack:
  added: []
  patterns:
    - "A spec that asserts WHERE a role lands passes loginAs `landing` (exact pathname), not the wide post-login predicate"
    - "A per-role scan seeds a row whose state forces the registered markup under test and asserts that markup is on screen before scanning"
key-files:
  created:
    - e2e/role-home.spec.ts
  modified:
    - e2e/helpers/login.ts
    - .github/workflows/ci.yml
    - src/__tests__/e2e-seeded-hydration-guard.test.ts
    - e2e/discovery-watchlist.spec.ts
    - e2e/layout-narrow.spec.ts
    - e2e/match-queue.spec.ts
    - e2e/full-flow.spec.ts
    - e2e/strategy-detail-tabs.spec.ts
    - e2e/for-quants-onboarding.spec.ts
    - e2e/my-strategies.spec.ts
    - e2e/route-redirects.spec.ts
    - e2e/reflow-sweep-authed.spec.ts
    - e2e/axe-app-wide.spec.ts
decisions:
  - "The /strategies reflow row runs at the three supported widths (V390, V640, V960), not 320px: reflow-sweep-authed's founder decision (2026-09-27) says 320px is not a supported width, and the plan's 320px wording predates reading it"
  - "The /strategies reflow row has its own describe and seeded `both` account instead of joining AUTHED_ROUTES: an owned strategy changes the wizard and allocation routes' resume and empty states the existing sweep anchors on"
---

# Phase 199 Plan 17: role landings, the 308 and the merged list under e2e Summary

The landing per role, the old path's 308, and the merged list's reflow and accessibility per role are now e2e specs, and the new landing spec is wired into CI's seeded list.

**Nothing seeded was run locally** (disk rule: no local Supabase stack). The seeded proof is read from the CI `e2e-seeded` run bound to the head SHA. This is a manual-only row in 199-VALIDATION.md.

## What was built

**Task 1 (tracer), `418617983`.**
- `isPostLoginPath(pathname)` in `e2e/helpers/login.ts`: `^/(discovery|strategies|allocations|admin|dashboard|pending-approval)(/|$)`, so a failed-login bounce to `/login?next=/discovery/...` still does not satisfy it. `loginAs` uses it, and gains two options: `redirect` (sign in through `/login?redirect=<path>`) and `landing` (wait for that exact pathname).
- `e2e/role-home.spec.ts`, `test` from `./helpers/hydration-guard`, `HAS_SEED_ENV` self-skip: allocator to `/allocations`, manager to `/strategies`, `both` plus `is_admin` to `/admin`, each by an exact pathname wait plus an exact pathname assertion; allocator via `?redirect=/compare` to `/compare`; allocator via `?redirect=//evil.example.test/steal` to `/allocations` (T-199-24, one case beyond the plan's four, same mechanism).
- `ci.yml`: `e2e/role-home.spec.ts` added to the seed-gated else-arm list (place 1; the spec's `HAS_SEED_ENV` is place 2). `SEEDED_SPEC_COUNT` re-measured: 23 at HEAD, 24 now.

**Task 2, `22b9b4f64`.** Each changed site (all kept their own timeout):

| Spec | Site | Before | After |
|---|---|---|---|
| discovery-watchlist | `loginViaForm` wait | discovery, strategies, dashboard (no allocations) | `isPostLoginPath` |
| layout-narrow | `loginViaForm` wait | all but admin (its admin legs) | `isPostLoginPath` |
| match-queue | `login` wait (admin account) | discovery, strategies | `isPostLoginPath` |
| full-flow | two waits (Authenticated flows, Admin flows) | discovery, strategies | `isPostLoginPath` |
| strategy-detail-tabs | one wait | discovery, strategies | `isPostLoginPath` |
| for-quants-onboarding | two waits | discovery, strategies, allocations (no admin) | `isPostLoginPath` |

No spec assumed it was on Discovery after login: each already `page.goto`s its own target, so no explicit Discovery navigation was added. match-queue's two unauthenticated-bounce assertions (`/(login|discovery)`) are untouched. `grep -a -l isPostLoginPath` over the six specs prints 6.

**Task 3, `01a3597b8`.**
- `route-redirects.spec.ts`: `/my-strategies?x=1` answers 308 (chain not followed), location contains `/strategies` and `x=1`, not `/login`, beside the `/scenarios` canary.
- `my-strategies.spec.ts` (file name and ci.yml entry unchanged): navigates by `a[href="/strategies"]:visible`, waits for `/strategies`, keeps every ownership-boundary assertion, and the factsheet href is `/factsheet/${draftA.strategyId}?from=strategies` with a comment saying the merged page passes the strategies origin (R-04, 199-09). Counts: `a[href="/my-strategies"]` 0 (HEAD 2), `from=my-strategies` 0 (HEAD 1), `?from=strategies` 1 (HEAD 0).
- `layout-narrow.spec.ts`: the `/my-strategies — N-TABLE` describe is now `/strategies — N-TABLE` and visits `/strategies`.
- `reflow-sweep-authed.spec.ts`: a describe with its own seeded `both` account, a published strategy and a placeholder key (an active key feeding no strategy), both with a long wrapping text, anchored on `#strategies-legend-heading` (rendered only when the list has rows) at V390/V640/V960.
- `axe-app-wide.spec.ts`: a describe over allocator, manager and both, across the spec's three viewports. Each account owns a published strategy whose newest return is ~200 days old (reads Stale), and the test asserts `[data-degrade-id="strategies.stale"]` is visible before scanning. Allocator and both also own a placeholder key and assert its label is visible. Strict, all impacts.

## Verification

All commands in the worktree.

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 4 claims (before the first edit).
- Precondition: `src/app/home/page.tsx` present, `src/app/(dashboard)/my-strategies/page.tsx` absent, `grep -a -c NOT_D04_SUBTREES src/__tests__/degrade-warning-scan.test.ts` prints 8.
- `npx vitest run src/__tests__/e2e-seeded-hydration-guard.test.ts`: 30 passed.
- `npx playwright test e2e/role-home.spec.ts --list`: 5 tests in 1 file. The Task 2 six-spec list: 108 tests in 6 files. The Task 3 five-spec list: 185 tests in 5 files. No compile error.
- `npx tsc --noEmit`: exit 0 (tsconfig includes `e2e/`).
- `npx eslint --no-cache` on every touched `.ts` file, per task: exit 0. Full-tree `eslint --cache` not run (brief).
- `npx vitest run src/__tests__`: **180 passed, 18 skipped** (4862 tests passed, 273 skipped), the base numbers. No new failure.
- Acceptance greps: `grep -a -c "e2e/role-home.spec.ts" .github/workflows/ci.yml` prints 2 (the list entry and my comment naming the spec), not the plan's 1; the list parse itself is exactly one entry (the pin test, 24 distinct specs). `grep -a -c "export function isPostLoginPath" e2e/helpers/login.ts` prints 1.

gc-199-17-neuter: `SEEDED_SPEC_COUNT` forced back to 23 on a byte copy: the pin test went RED (`Parsed 24 spec(s) ... expected 23`); restored, `cmp` identical, GREEN.

gc-199-17-neuter: `role-home.spec.ts` on a byte copy, `test` imported from `@playwright/test` instead of the guard: the guard test went RED naming `e2e/role-home.spec.ts: binds \`test\` from "@playwright/test"`; restored, `cmp` identical, 30/30 GREEN.

gc-199-17-gates: list=green vitest=green

## Left to CI (not run here)

Nothing in `supabase/`, `analytics-service/` or SQL was touched, so no SQL gate, mypy or local-stack lane applies. The disk rule kept every spec that needs the local Supabase stack or a seeded database from running. Their proof is the CI `e2e-seeded` run bound to the head SHA:

- `e2e/role-home.spec.ts` (all 5 cases), `e2e/my-strategies.spec.ts`, the `/strategies — N-TABLE` describe in `e2e/layout-narrow.spec.ts`, the `/strategies` row in `e2e/reflow-sweep-authed.spec.ts`, the per-role rows in `e2e/axe-app-wide.spec.ts`, and the six specs whose waits changed.
- `e2e/route-redirects.spec.ts`'s new canary is unseeded but needs a running Next server; it runs in the `e2e` job's unseeded list. It was compiled and listed, not run.
- The two Task 1 pin neuters above are the only RED/GREEN evidence for the new gates. The e2e cases themselves have not been seen to fail; they were written to fail on a wrong landing (exact-pathname wait) but that is unproven until CI runs them. If a CI run is red, the likeliest causes are the unmeasured seeds: a stale-row seed that reads Stale (series dated ~200 days back, crypto or other threshold), and the `getByText(keyLabel)` placeholder-row match.

## Deviations from Plan

**1. [Rule 1 - Bug] `full-flow.spec.ts` "admin dashboard loads" asserted a redirect to `/discovery`.** A non-admin hitting `/admin` is now sent through `/home` to its role home (`redirect(ROLE_HOME_ROUTE)`), so the old check would be false for a manual run. It now reads "left `/admin`". Not a wait, but the same landing assumption. The case is skipped by design in CI (no `E2E_TEST_*` secrets).

**2. [Rule 3 - decision] 320px became V390/V640/V960 for the reflow row.** See `decisions`. The plan's truth says 320px; `reflow-sweep-authed.spec.ts` records a founder decision that 320px is not supported and these three widths are. The legend and long-text rows are measured at those.

**3. [Rule 3 - decision] The reflow row is its own describe, not an `AUTHED_ROUTES` entry.** Same reason as `decisions`; the existing sweep's per-route anchors on the wizard and allocation pages depend on that account owning nothing.

**4. [Scope, small] `my-strategies.spec.ts`, `reflow-sweep-authed.spec.ts` and `axe-app-wide.spec.ts`'s inline `loginViaForm` waits also use `isPostLoginPath`.** They were already correct for their roles (`both` and allocator land on `/allocations`); the change keeps one predicate across the specs this plan touches, as the must-have says.

**5. [Plan wording] `grep -a -c "e2e/role-home.spec.ts" .github/workflows/ci.yml` prints 2, not 1.** The extra hit is the comment I added beside the list. The list holds the entry once (pin test).

**6. [Beyond the plan, same mechanism] An off-origin `?redirect=` case in `role-home.spec.ts`.** Cheap, and it is the case T-199-24 names.

## Known Stubs

None. No placeholder or empty-data wiring was added.

## Threat Flags

None. No new endpoint, auth path or schema; seeded accounts are throwaway TEST users.

## Self-Check: PASSED

- Files: `e2e/role-home.spec.ts` FOUND; the other twelve modified files exist in the tree and the three commits touch them.
- Commits: `418617983`, `22b9b4f64`, `01a3597b8` are ancestors of HEAD (checked with `git merge-base --is-ancestor`).
